//! Shared immutable mob meshes with bounded, reused per-part instance buffers.
//! Animation updates transforms only; neither terrain nor mob geometry is rebuilt.
use super::*;
use crate::mob_models::{self, MAX_PARTS, MaterialSlot, MobAppearance, MobPose, ModelDesc};
use std::{
    hash::{Hash, Hasher},
    ops::Range,
};

const MAX_ENTITIES: usize = 512;
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct ModelVertex {
    position: [f32; 3],
    uv: [f32; 2],
    shade: f32,
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PartInstance {
    matrix: [[f32; 4]; 4],
    tint: [f32; 4],
    layer: u32,
    padding: [u32; 3],
}
struct Part {
    vertices: Range<u32>,
    instances: Vec<PartInstance>,
    translucent: bool,
}
struct Mesh {
    vertices: wgpu::Buffer,
    parts: Vec<Part>,
}
struct Resident {
    fingerprint: u64,
    appearance: MobAppearance,
    model: Option<&'static ModelDesc>,
    layers: [Option<u32>; MAX_PARTS],
    tints: [[f32; 4]; MAX_PARTS],
    from: [f64; 3],
    to: [f64; 3],
    changed: Instant,
    phase: f32,
    walk: f32,
    last_frame: u64,
    rotation_from: [f32; 3],
    rotation_to: [f32; 3],
    rotation_changed: Instant,
}
struct Draw {
    model: &'static str,
    vertices: Range<u32>,
    instances: Range<u32>,
    translucent: bool,
}
pub(super) struct MobRenderer {
    opaque: wgpu::RenderPipeline,
    translucent: wgpu::RenderPipeline,
    textures: wgpu::BindGroup,
    meshes: HashMap<&'static str, Mesh>,
    residents: HashMap<i32, Resident>,
    data: Vec<PartInstance>,
    buffer: Option<wgpu::Buffer>,
    capacity: u64,
    draws: Vec<Draw>,
    item_vertices: wgpu::Buffer,
    items: Vec<PartInstance>,
    item_range: Range<u32>,
    clock: Instant,
    previous: Instant,
    frame: u64,
    frame_cpu_us: Vec<u64>,
    shadow_pipeline:wgpu::RenderPipeline,
    shadow_buffer:Option<wgpu::Buffer>,
    shadow_capacity:u64,
    shadow_vertices:Vec<ModelVertex>,
}

fn appearance(entity: &EntitySnapshot) -> MobAppearance {
    MobAppearance {
        baby: entity.baby,
        variant: entity.variant.clone(),
        color: entity.sheep_color,
        sheared: entity.sheared,
        sitting: entity.sitting,
        tamed: entity.tamed,
        angry: entity.angry,
        size: entity.size,
        villager_type: entity.villager_type.clone(),
        profession: entity.villager_profession.clone(),
    }
}
fn fingerprint(e: &EntitySnapshot) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    e.kind.hash(&mut h);
    e.baby.hash(&mut h);
    e.variant.hash(&mut h);
    e.sheep_color.hash(&mut h);
    e.sheared.hash(&mut h);
    e.sitting.hash(&mut h);
    e.tamed.hash(&mut h);
    e.angry.hash(&mut h);
    e.size.hash(&mut h);
    e.villager_type.hash(&mut h);
    e.villager_profession.hash(&mut h);
    h.finish()
}
fn lerp_position(resident: &Resident, now: Instant) -> [f64; 3] {
    let t = (now.duration_since(resident.changed).as_secs_f64() / 0.1).clamp(0.0, 1.0);
    std::array::from_fn(|i| resident.from[i] + (resident.to[i] - resident.from[i]) * t)
}
fn angle_delta(a: f32, b: f32) -> f32 {
    (a - b + 180.0).rem_euclid(360.0) - 180.0
}
fn lerp_rotation(resident: &Resident, now: Instant) -> [f32; 3] {
    let t = (now.duration_since(resident.rotation_changed).as_secs_f32() / 0.1).clamp(0.0, 1.0);
    std::array::from_fn(|i| {
        resident.rotation_from[i]
            + angle_delta(resident.rotation_to[i], resident.rotation_from[i]) * t
    })
}

impl MobRenderer {
    pub(super) fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        camera_layout: &wgpu::BindGroupLayout,
        texture_layout: &wgpu::BindGroupLayout,
        assets: &AssetPack,
        format: wgpu::TextureFormat,
    ) -> Result<Self, String> {
        let textures = upload_textures(
            device,
            queue,
            texture_layout,
            assets.entity_texture_size,
            assets.entity_texture_size,
            assets.entity_texture_layers,
            &assets.entity_textures_rgba,
            "Minecraft mob textures",
        )?;
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Animated mob shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("entity.wgsl").into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Mob pipeline layout"),
            bind_group_layouts: &[Some(camera_layout), Some(texture_layout)],
            ..Default::default()
        });
        let pipeline = |blend: bool| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:Some("Instanced mob parts"),layout:Some(&layout),
            vertex:wgpu::VertexState {module:&shader,entry_point:Some("vs_main"),compilation_options:Default::default(),buffers:&[
                Some(wgpu::VertexBufferLayout {array_stride:std::mem::size_of::<ModelVertex>() as u64,step_mode:wgpu::VertexStepMode::Vertex,attributes:&wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x2,2=>Float32]}),
                Some(wgpu::VertexBufferLayout {array_stride:std::mem::size_of::<PartInstance>() as u64,step_mode:wgpu::VertexStepMode::Instance,attributes:&wgpu::vertex_attr_array![3=>Float32x4,4=>Float32x4,5=>Float32x4,6=>Float32x4,7=>Float32x4,8=>Uint32]})]},
            primitive:wgpu::PrimitiveState {cull_mode:None,..Default::default()},
            depth_stencil:Some(wgpu::DepthStencilState {format:wgpu::TextureFormat::Depth32Float,depth_write_enabled:Some(!blend),depth_compare:Some(wgpu::CompareFunction::LessEqual),stencil:Default::default(),bias:Default::default()}),multisample:Default::default(),
            fragment:Some(wgpu::FragmentState {module:&shader,entry_point:Some(if blend {"fs_blend"} else {"fs_main"}),compilation_options:Default::default(),targets:&[Some(wgpu::ColorTargetState {format,blend:if blend {Some(wgpu::BlendState::ALPHA_BLENDING)} else {None},write_mask:wgpu::ColorWrites::ALL})]}),multiview_mask:None,cache:None,
        })
        };
        let quad = [
            ([-0.2, 0.0, 0.0], [0.0, 1.0]),
            ([0.2, 0.0, 0.0], [1.0, 1.0]),
            ([0.2, 0.4, 0.0], [1.0, 0.0]),
            ([-0.2, 0.4, 0.0], [0.0, 0.0]),
        ];
        let vertices: Vec<_> = [0, 1, 2, 0, 2, 3]
            .into_iter()
            .map(|i| ModelVertex {
                position: quad[i].0,
                uv: quad[i].1,
                shade: 1.0,
            })
            .collect();
        let item_vertices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Dropped item quad"),
            contents: bytemuck::cast_slice(&vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let now = Instant::now();
        let shadow_shader=device.create_shader_module(wgpu::ShaderModuleDescriptor{label:Some("Entity shadows"),source:wgpu::ShaderSource::Wgsl(include_str!("shadow.wgsl").into())});
        let shadow_pipeline=device.create_render_pipeline(&wgpu::RenderPipelineDescriptor{
            label:Some("Entity shadows"),layout:Some(&layout),
            vertex:wgpu::VertexState{module:&shadow_shader,entry_point:Some("vs_main"),compilation_options:Default::default(),buffers:&[Some(wgpu::VertexBufferLayout{array_stride:std::mem::size_of::<ModelVertex>() as u64,step_mode:wgpu::VertexStepMode::Vertex,attributes:&wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x2,2=>Float32]})]},
            primitive:wgpu::PrimitiveState{cull_mode:None,..Default::default()},
            depth_stencil:Some(wgpu::DepthStencilState{format:wgpu::TextureFormat::Depth32Float,depth_write_enabled:Some(false),depth_compare:Some(wgpu::CompareFunction::LessEqual),stencil:Default::default(),bias:wgpu::DepthBiasState{constant:-1,slope_scale:-1.,clamp:0.}}),multisample:Default::default(),
            fragment:Some(wgpu::FragmentState{module:&shadow_shader,entry_point:Some("fs_main"),compilation_options:Default::default(),targets:&[Some(wgpu::ColorTargetState{format,blend:Some(wgpu::BlendState::ALPHA_BLENDING),write_mask:wgpu::ColorWrites::ALL})]}),multiview_mask:None,cache:None,
        });
        Ok(Self {
            opaque: pipeline(false),
            translucent: pipeline(true),
            textures,
            meshes: HashMap::new(),
            residents: HashMap::new(),
            data: Vec::with_capacity(MAX_ENTITIES * MAX_PARTS),
            buffer: None,
            capacity: 0,
            draws: Vec::new(),
            item_vertices,
            items: Vec::with_capacity(MAX_ENTITIES),
            item_range: 0..0,
            clock: now,
            previous: now,
            frame: 0,
            frame_cpu_us: Vec::with_capacity(8192),
            shadow_pipeline,shadow_buffer:None,shadow_capacity:0,shadow_vertices:Vec::with_capacity(4096),
        })
    }
    pub(super) fn clear(&mut self) {
        self.residents.clear();
    }
    pub(super) fn supports(&self, entity: &EntitySnapshot) -> bool {
        entity.kind == "Item" && entity.item_count > 0
            || self
                .residents
                .get(&entity.id)
                .is_some_and(|v| v.model.is_some())
    }
    pub(super) fn update(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        entities: &[EntitySnapshot],
        assets: &AssetPack,
        origin: [i32; 3],
        eye: Vec3,
        far: f32,
        camera_yaw: f32,
        planes: &[Vec4; 6],
        lightmap: &crate::lighting::LightmapInputs,
    ) {
        let now = Instant::now();
        let dt = now.duration_since(self.previous).as_secs_f32().min(0.1);
        self.previous = now;
        self.frame = self.frame.wrapping_add(1);
        let age = self.clock.elapsed().as_secs_f32();
        for mesh in self.meshes.values_mut() {
            for part in &mut mesh.parts {
                part.instances.clear();
            }
        }
        self.items.clear();
        self.draws.clear();
        self.data.clear();
        self.shadow_vertices.clear();
        if let Some(&layer)=assets.entity_textures.get("shadow") {
            for entity in entities.iter().take(MAX_ENTITIES) {
                let radius=crate::lighting::shadow_radius(entity);if radius<=0.{continue;}
                for piece in &entity.shadows {
                    let [x,y,z]=piece.position;let corners=[[x,y,z],[x+1,y,z],[x+1,y,z+1],[x,y,z+1]];
                    for i in [0,1,2,0,2,3] {let p=corners[i];let uv=[(entity.position[0]-p[0] as f64) as f32/(2.*radius)+0.5,(entity.position[2]-p[2] as f64) as f32/(2.*radius)+0.5];
                        // Opacity uses the low range; the integer part selects the 64px vanilla shadow.
                        self.shadow_vertices.push(ModelVertex{position:std::array::from_fn(|a|(p[a]-origin[a]) as f32+if a==1{0.002}else{0.}),uv:[uv[0],uv[1]],shade:piece.opacity+layer as f32*2.});
                    }
                }
            }
        }
        write_buffer(device,queue,&mut self.shadow_buffer,&mut self.shadow_capacity,bytemuck::cast_slice(&self.shadow_vertices),wgpu::BufferUsages::VERTEX,"Entity shadow pieces");
        for entity in entities.iter().filter(|e| !e.is_player).take(MAX_ENTITIES) {
            if !entity.position.iter().all(|v| v.is_finite())
                || !entity.yaw.is_finite()
                || !entity.head_yaw.is_finite()
                || !entity.pitch.is_finite()
            {
                continue;
            }
            let stamp = fingerprint(entity);
            let rotation = [entity.yaw, entity.head_yaw, entity.pitch];
            let resident = self.residents.entry(entity.id).or_insert_with(|| Resident {
                fingerprint: !stamp,
                appearance: MobAppearance::default(),
                model: None,
                layers: [None; MAX_PARTS],
                tints: [[1.0; 4]; MAX_PARTS],
                from: entity.position,
                to: entity.position,
                changed: now,
                phase: 0.0,
                walk: 0.0,
                last_frame: self.frame,
                rotation_from: rotation,
                rotation_to: rotation,
                rotation_changed: now,
            });
            resident.last_frame = self.frame;
            if resident.rotation_to != rotation {
                resident.rotation_from = lerp_rotation(resident, now);
                resident.rotation_to = rotation;
                resident.rotation_changed = now;
            }
            if resident.fingerprint != stamp {
                resident.fingerprint = stamp;
                resident.appearance = appearance(entity);
                resident.model = mob_models::model_for(&entity.kind, &resident.appearance);
                resident.layers.fill(None);
                if let Some(model) = resident.model {
                    for (index, part) in model.parts.iter().take(MAX_PARTS).enumerate() {
                        resident.layers[index] = mob_models::texture_for(
                            &entity.kind,
                            &resident.appearance,
                            part.material,
                        )
                        .and_then(|key| assets.entity_textures.get(&key).copied());
                        resident.tints[index] =
                            mob_models::tint_for(&entity.kind, &resident.appearance, part.material);
                    }
                }
            }
            if resident.to != entity.position {
                let current = lerp_position(resident, now);
                let distance = ((entity.position[0] - resident.to[0]).powi(2)
                    + (entity.position[2] - resident.to[2]).powi(2))
                .sqrt() as f32;
                resident.from = if distance > 8.0 {
                    entity.position
                } else {
                    current
                };
                resident.to = entity.position;
                resident.changed = now;
                resident.walk = (distance * 10.0).min(1.0);
            } else if now.duration_since(resident.changed).as_secs_f32() > 0.15 {
                resident.walk = (resident.walk - dt * 5.0).max(0.0);
            }
            resident.phase += dt * resident.walk * 8.0;
            let position = lerp_position(resident, now);
            let relative = Vec3::new(
                (position[0] - origin[0] as f64) as f32,
                (position[1] - origin[1] as f64) as f32,
                (position[2] - origin[2] as f64) as f32,
            );
            let width = entity.width.clamp(0.1, 16.0);
            let height = entity.height.clamp(0.1, 32.0);
            if relative.distance_squared(eye) > far.min(160.0).powi(2)
                || !aabb_visible(
                    relative - Vec3::new(width, 0.2, width),
                    relative + Vec3::new(width, height + 0.5, width),
                    planes,
                )
            {
                continue;
            }
            if entity.kind == "Item" && entity.item_count > 0 {
                if let Some(layer) = assets.item_textures.get(&entity.item_id) {
                    let bob = (age * 2.0 + entity.id as f32).sin() * 0.06 + 0.12;
                    let transform = Mat4::from_translation(relative + Vec3::Y * bob)
                        * Mat4::from_rotation_y(-camera_yaw.to_radians());
                    self.items.push(PartInstance {
                        matrix: transform.to_cols_array_2d(),
                        tint: {let c=lightmap.color(entity.light.block.unwrap_or(0),entity.light.sky.unwrap_or(0));[c[0],c[1],c[2],1.]},
                        layer: *layer,
                        padding: [0; 3],
                    });
                }
                continue;
            }
            let Some(model) = resident.model else {
                continue;
            };
            let mesh = self
                .meshes
                .entry(model.key)
                .or_insert_with(|| make_mesh(device, model));
            let mut poses = [Mat4::IDENTITY; MAX_PARTS];
            let rotation = lerp_rotation(resident, now);
            let pose = MobPose {
                head_yaw: angle_delta(rotation[1], rotation[0]),
                pitch: rotation[2].clamp(-90.0, 90.0),
                walk_phase: resident.phase,
                walk_amount: resident.walk,
                age_seconds: age,
            };
            mob_models::pose_into(model, &resident.appearance, &pose, &mut poses);
            let root =
                Mat4::from_translation(relative) * Mat4::from_rotation_y(-rotation[0].to_radians());
            for (index, part) in mesh.parts.iter_mut().enumerate() {
                if let Some(layer) = resident.layers[index] {
                    let mut tint = resident.tints[index];
                    let l=lightmap.color(entity.light.block.unwrap_or(0),entity.light.sky.unwrap_or(0));
                    if model.parts[index].material!=MaterialSlot::Eyes {for i in 0..3 {tint[i]*=l[i];}}
                    if tint[3] <= 0.0 {
                        continue;
                    }
                    part.instances.push(PartInstance {
                        matrix: (root * poses[index]).to_cols_array_2d(),
                        tint,
                        layer,
                        padding: [0; 3],
                    });
                }
            }
        }
        self.residents.retain(|_, v| v.last_frame == self.frame);
        for (key, mesh) in &self.meshes {
            for part in &mesh.parts {
                if part.instances.is_empty() {
                    continue;
                }
                let start = self.data.len() as u32;
                if part.translucent {
                    self.data.extend(part.instances.iter().rev().copied());
                } else {
                    self.data.extend_from_slice(&part.instances);
                }
                self.draws.push(Draw {
                    model: key,
                    vertices: part.vertices.clone(),
                    instances: start..self.data.len() as u32,
                    translucent: part.translucent,
                });
            }
        }
        let start = self.data.len() as u32;
        self.data.extend_from_slice(&self.items);
        self.item_range = start..self.data.len() as u32;
        write_buffer(
            device,
            queue,
            &mut self.buffer,
            &mut self.capacity,
            bytemuck::cast_slice(&self.data),
            wgpu::BufferUsages::VERTEX,
            "Mob transforms",
        );
        if self.frame_cpu_us.len() < 8192 {
            self.frame_cpu_us.push(now.elapsed().as_micros() as u64);
        }
    }
    pub(super) fn take_metrics(&mut self) -> serde_json::Value {
        self.frame_cpu_us.sort_unstable();
        let count = self.frame_cpu_us.len();
        let percentile = |p: usize| {
            self.frame_cpu_us
                .get(count.saturating_sub(1) * p / 100)
                .copied()
                .unwrap_or(0)
        };
        let value = serde_json::json!({"tracked":self.residents.len(),"static_models":self.meshes.len(),"draw_calls":self.draws.len()+usize::from(!self.item_range.is_empty()),"transform_bytes":self.data.len()*std::mem::size_of::<PartInstance>(),"cpu_p50_us":percentile(50),"cpu_p95_us":percentile(95),"cpu_p99_us":percentile(99),"samples":count});
        self.frame_cpu_us.clear();
        value
    }
    pub(super) fn draw<'a>(
        &'a self,
        pass: &mut wgpu::RenderPass<'a>,
        camera: &'a wgpu::BindGroup,
        items: &'a wgpu::BindGroup,
        translucent: bool,
    ) {
        let Some(buffer) = &self.buffer else {
            return;
        };
        pass.set_pipeline(if translucent {
            &self.translucent
        } else {
            &self.opaque
        });
        pass.set_bind_group(0, camera, &[]);
        pass.set_bind_group(1, &self.textures, &[]);
        pass.set_vertex_buffer(1, buffer.slice(..));
        for draw in self.draws.iter().filter(|v| v.translucent == translucent) {
            let mesh = &self.meshes[draw.model];
            pass.set_vertex_buffer(0, mesh.vertices.slice(..));
            pass.draw(draw.vertices.clone(), draw.instances.clone());
        }
        if !translucent && !self.item_range.is_empty() {
            pass.set_bind_group(1, items, &[]);
            pass.set_vertex_buffer(0, self.item_vertices.slice(..));
            pass.draw(0..6, self.item_range.clone());
        }
    }
    pub(super) fn draw_shadows<'a>(&'a self,pass:&mut wgpu::RenderPass<'a>,camera:&'a wgpu::BindGroup){
        if self.shadow_vertices.is_empty(){return;}
        if let Some(buffer)=&self.shadow_buffer {pass.set_pipeline(&self.shadow_pipeline);pass.set_bind_group(0,camera,&[]);pass.set_bind_group(1,&self.textures,&[]);pass.set_vertex_buffer(0,buffer.slice(..));pass.draw(0..self.shadow_vertices.len() as u32,0..1);}
    }
}
fn make_mesh(device: &wgpu::Device, model: &ModelDesc) -> Mesh {
    let mut vertices = Vec::new();
    let mut parts = Vec::new();
    for part in model.parts.iter().take(MAX_PARTS) {
        let start = vertices.len() as u32;
        for quad in &part.quads {
            let p = quad.positions.map(Vec3::from_array);
            let normal = (p[1] - p[0]).cross(p[2] - p[0]).normalize_or_zero();
            let shade = if normal.y.abs() > 0.5 {
                if normal.y < 0.0 { 1.0 } else { 0.65 }
            } else if normal.z.abs() > 0.5 {
                0.9
            } else {
                0.8
            };
            for i in [0, 1, 2, 0, 2, 3] {
                vertices.push(ModelVertex {
                    position: quad.positions[i],
                    uv: quad.uv[i],
                    shade,
                });
            }
        }
        parts.push(Part {
            vertices: start..vertices.len() as u32,
            instances: Vec::new(),
            translucent: matches!(part.material, MaterialSlot::SlimeOuter),
        });
    }
    let vertices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some(model.key),
        contents: bytemuck::cast_slice(&vertices),
        usage: wgpu::BufferUsages::VERTEX,
    });
    Mesh { vertices, parts }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn head_rotation_crosses_wrap_without_spinning() {
        assert_eq!(angle_delta(-179.0, 179.0), 2.0);
        assert_eq!(angle_delta(179.0, -179.0), -2.0);
    }
    #[test]
    fn transforms_are_bounded_and_aligned() {
        assert_eq!(std::mem::size_of::<PartInstance>(), 96);
        assert!(MAX_ENTITIES * MAX_PARTS * 96 < 2 * 1024 * 1024);
    }
}
