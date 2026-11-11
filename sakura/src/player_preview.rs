//! The inventory avatar reuses the existing skin mesh and a small cached GPU target.
use super::*;
pub(super) struct PlayerPreview {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    depth: wgpu::TextureView,
    camera: wgpu::Buffer,
    camera_group: wgpu::BindGroup,
    section_group: wgpu::BindGroup,
    pipeline: wgpu::RenderPipeline,
    geometry: GpuGeometry,
    last: Option<[i32; 2]>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires a native GPU; validates the production inventory portrait and atlas copy"]
    fn portrait_renders_in_local_coordinates_and_reuses_unchanged_pixels() {
        pollster::block_on(async {
            let adapter = wgpu::Instance::default()
                .request_adapter(&wgpu::RequestAdapterOptions::default())
                .await
                .unwrap();
            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor::default())
                .await
                .unwrap();
            let camera_layout = uniform_layout(&device, false, "Preview test camera");
            let section_layout = uniform_layout(&device, true, "Preview test section");
            let textures = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("Preview test skin"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                            view_dimension: wgpu::TextureViewDimension::D2Array,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("Preview production layout"),
                bind_group_layouts: &[Some(&camera_layout), Some(&textures), Some(&section_layout)],
                ..Default::default()
            });
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("Preview production shader"),
                source: wgpu::ShaderSource::Wgsl(include_str!("terrain.wgsl").into()),
            });
            let skin = upload_textures(
                &device,
                &queue,
                &textures,
                64,
                64,
                1,
                &vec![255; 64 * 64 * 4],
                "Preview opaque test skin",
            )
            .unwrap();
            let mut preview = PlayerPreview::new(&device, &queue, &camera_layout, &layout, &shader);
            // The atlas uses raw encoded pixels. Copying the sRGB preview into
            // its UNORM counterpart must preserve both the pixels and alpha.
            let atlas = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Preview test atlas"),
                size: wgpu::Extent3d {
                    width: 128,
                    height: 192,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let sprite = crate::gui_assets::GuiSprite {
                x: 0,
                y: 0,
                width: 128,
                height: 192,
                scaling: crate::gui_assets::SpriteScaling::Stretch,
            };
            let readback = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Preview test pixels"),
                size: 128 * 192 * 4,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            let mut draw = |cursor| {
                let mut encoder = device.create_command_encoder(&Default::default());
                preview.update(
                    &mut encoder,
                    &queue,
                    &skin,
                    &atlas,
                    &sprite,
                    cursor,
                    [0., 0., 128., 192.],
                );
                encoder.copy_texture_to_buffer(
                    wgpu::TexelCopyTextureInfo {
                        texture: &atlas,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::TexelCopyBufferInfo {
                        buffer: &readback,
                        layout: wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(512),
                            rows_per_image: Some(192),
                        },
                    },
                    wgpu::Extent3d {
                        width: 128,
                        height: 192,
                        depth_or_array_layers: 1,
                    },
                );
                queue.submit([encoder.finish()]);
                let (tx, rx) = std::sync::mpsc::channel();
                readback
                    .slice(..)
                    .map_async(wgpu::MapMode::Read, move |result| {
                        tx.send(result).unwrap();
                    });
                device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
                rx.recv().unwrap().unwrap();
                let bytes = readback.slice(..).get_mapped_range().unwrap();
                let pixels = bytes.to_vec();
                drop(bytes);
                readback.unmap();
                pixels
            };
            let centered = draw([64., 96.]);
            let opaque = centered.chunks_exact(4).filter(|rgba| rgba[3] > 0).count();
            assert!(
                opaque > 3500 && opaque < 18000,
                "portrait clipped or absent: {opaque} pixels"
            );
            assert_eq!(centered[(96 * 128 + 64) * 4 + 3], 255);
            assert_eq!(centered[3], 0);
            assert_eq!(
                centered,
                draw([64., 96.]),
                "unchanged pose lost its cached pixels"
            );
            assert_ne!(
                centered,
                draw([110., 50.]),
                "cursor pose did not update the portrait"
            );
        });
    }
}
impl PlayerPreview {
    pub fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        camera_layout: &wgpu::BindGroupLayout,
        world_layout: &wgpu::PipelineLayout,
        shader: &wgpu::ShaderModule,
    ) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Inventory player preview"),
            size: wgpu::Extent3d {
                width: 128,
                height: 192,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let depth = device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("Inventory preview depth"),
                size: wgpu::Extent3d {
                    width: 128,
                    height: 192,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: DEPTH_FORMAT,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            })
            .create_view(&Default::default());
        let camera = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Inventory avatar camera"),
            contents: bytemuck::bytes_of(&CameraUniform::zeroed()),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let camera_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Inventory avatar camera"),
            layout: camera_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera.as_entire_binding(),
            }],
        });
        let pipeline = world_pipeline(
            device,
            world_layout,
            shader,
            wgpu::TextureFormat::Rgba8UnormSrgb,
            false,
            false,
        );
        // World slot zero follows the player's floating origin. The portrait
        // always uses local model coordinates, including while that origin moves.
        let section = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Inventory avatar fixed origin"),
            contents: bytemuck::cast_slice(&[0i32; 4]),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let section_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Inventory avatar fixed origin"),
            layout: &pipeline.get_bind_group_layout(2),
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: section.as_entire_binding(),
            }],
        });
        let mesh = preview_mesh(false);
        let mut geometry = GpuGeometry::default();
        geometry.upload(device, queue, &mesh);
        Self {
            texture,
            view,
            depth,
            camera,
            camera_group,
            section_group,
            pipeline,
            geometry,
            last: None,
        }
    }
    pub fn set_model(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, slim: bool) {
        self.geometry.upload(device, queue, &preview_mesh(slim));
        self.last = None;
    }
    pub fn update(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        queue: &wgpu::Queue,
        skin: &wgpu::BindGroup,
        atlas: &wgpu::Texture,
        sprite: &crate::gui_assets::GuiSprite,
        cursor: [f32; 2],
        rect: [f32; 4],
    ) {
        let offset = [
            (cursor[0] - rect[0] - rect[2] / 2.).round() as i32,
            (cursor[1] - rect[1] - rect[3] / 2.).round() as i32,
        ];
        if self.last == Some(offset) {
            return;
        }
        self.last = Some(offset);
        let yaw = (offset[0] as f32 / 40.).atan() * 0.35;
        let pitch = (offset[1] as f32 / 40.).atan() * 0.15;
        let transform = Mat4::from_translation(Vec3::Y)
            * Mat4::from_rotation_y(yaw)
            * Mat4::from_rotation_x(pitch)
            * Mat4::from_translation(-Vec3::Y);
        let projection = rh::proj::directx::orthographic(-0.74, 0.74, -0.1, 2.12, 0.1, 100.);
        let view = rh::view::look_at_mat4(Vec3::new(0., 0., 5.), Vec3::ZERO, Vec3::Y);
        let camera = CameraUniform {
            view_projection: (projection * view * transform).to_cols_array_2d(),
            eye: [0., 0., 5., 1000.],
            origin: [0; 4],
            viewport: [128., 192., 0., 0.],
            glint: [0.; 4],
            fog: [0.;4], fog_range:[1000.,1001.,0.,0.],
            lightmap: [[1.;4];256],
        };
        queue.write_buffer(&self.camera, 0, bytemuck::bytes_of(&camera));
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Inventory player preview"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.camera_group, &[]);
            pass.set_bind_group(1, skin, &[]);
            pass.set_bind_group(2, &self.section_group, &[0]);
            self.geometry.draw(&mut pass);
        }
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: atlas,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: sprite.x,
                    y: sprite.y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::Extent3d {
                width: 128,
                height: 192,
                depth_or_array_layers: 1,
            },
        );
    }
}

fn preview_mesh(slim: bool) -> Geometry {
        let mut mesh = Geometry::default();
        for (min, size, uv) in [
            ([-4., 24., -4.], [8., 8., 8.], [0., 0.]),
            ([-4., 12., -2.], [8., 12., 4.], [16., 16.]),
            ([if slim { -7. } else { -8. }, 12., -2.], [if slim { 3. } else { 4. }, 12., 4.], [40., 16.]),
            ([4., 12., -2.], [if slim { 3. } else { 4. }, 12., 4.], [32., 48.]),
            ([-4., 0., -2.], [4., 12., 4.], [0., 16.]),
            ([0., 0., -2.], [4., 12., 4.], [16., 48.]),
        ] {
            skin_cuboid(&mut mesh, min, size, uv, [0.; 3], 0.);
        }
        // Inflate geometry without changing the hat layer's 8×8 texture UVs.
        let start = mesh.vertices.len();
        skin_cuboid(
            &mut mesh,
            [-4., 24., -4.],
            [8., 8., 8.],
            [32., 0.],
            [0.; 3],
            0.,
        );
        for vertex in &mut mesh.vertices[start..] {
            let center = [0., 1.75, 0.];
            for (axis, value) in vertex.position.iter_mut().enumerate() {
                *value = center[axis] + (*value - center[axis]) * 1.125;
            }
        }

    // Actual jacket, sleeves and trouser layers, inflated without altering UVs.
    for (min,size,uv) in [
        ([-4.,12.,-2.],[8.,12.,4.],[16.,32.]),
        ([if slim {-7.}else{-8.},12.,-2.],[if slim {3.}else{4.},12.,4.],[40.,32.]),
        ([4.,12.,-2.],[if slim {3.}else{4.},12.,4.],[48.,48.]),
        ([-4.,0.,-2.],[4.,12.,4.],[0.,32.]),
        ([0.,0.,-2.],[4.,12.,4.],[0.,48.]),
    ] {
        let start=mesh.vertices.len();skin_cuboid(&mut mesh,min,size,uv,[0.;3],0.);
        for vertex in &mut mesh.vertices[start..] {for axis in 0..3 {let center=(min[axis]+size[axis]/2.)/16.;vertex.position[axis]=center+(vertex.position[axis]-center)*(1.+0.5/size[axis]);}}
    }

    mesh
}
