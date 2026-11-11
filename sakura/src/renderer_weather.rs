use super::*;
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Column {
    position: [f32; 3],
    snow: u32,
    light: [f32; 2],
    phase: f32,
    strength: f32,
}
pub(super) struct WeatherRenderer {
    pipeline: wgpu::RenderPipeline,
    textures: wgpu::BindGroup,
    buffer: Option<wgpu::Buffer>,
    capacity: u64,
    data: Vec<Column>,
    key: Option<(u64, [i32; 3], u32, usize)>,
}
impl WeatherRenderer {
    pub(super) fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        camera: &wgpu::BindGroupLayout,
        textures: &wgpu::BindGroupLayout,
        assets: &AssetPack,
        format: wgpu::TextureFormat,
    ) -> Result<Self, String> {
        let group = upload_textures(
            device,
            queue,
            textures,
            64,
            256,
            2,
            &assets.weather_rgba,
            "Java precipitation textures",
        )?;
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Stable precipitation"),
            source: wgpu::ShaderSource::Wgsl(include_str!("weather.wgsl").into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Precipitation"),
            bind_group_layouts: &[Some(camera), Some(textures)],
            ..Default::default()
        });
        let pipeline=device.create_render_pipeline(&wgpu::RenderPipelineDescriptor{
            label:Some("Instanced rain and snow"),layout:Some(&layout),
            vertex:wgpu::VertexState{module:&shader,entry_point:Some("vs_main"),compilation_options:Default::default(),buffers:&[Some(wgpu::VertexBufferLayout{array_stride:32,step_mode:wgpu::VertexStepMode::Instance,attributes:&wgpu::vertex_attr_array![0=>Float32x3,1=>Uint32,2=>Float32x2,3=>Float32,4=>Float32]})]},
            primitive:wgpu::PrimitiveState{cull_mode:None,..Default::default()},
            depth_stencil:Some(wgpu::DepthStencilState{format:DEPTH_FORMAT,depth_write_enabled:Some(false),depth_compare:Some(wgpu::CompareFunction::LessEqual),stencil:Default::default(),bias:Default::default()}),multisample:Default::default(),
            fragment:Some(wgpu::FragmentState{module:&shader,entry_point:Some("fs_main"),compilation_options:Default::default(),targets:&[Some(wgpu::ColorTargetState{format,blend:Some(wgpu::BlendState::ALPHA_BLENDING),write_mask:wgpu::ColorWrites::ALL})]}),multiview_mask:None,cache:None,
        });
        Ok(Self {
            pipeline,
            textures: group,
            buffer: None,
            capacity: 0,
            data: Vec::with_capacity(441),
            key: None,
        })
    }
    pub(super) fn instances(&self) -> usize {
        self.data.len()
    }
    pub(super) fn allocated_bytes(&self) -> u64 {
        self.capacity
    }
    pub(super) fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        env: &crate::lighting::Environment,
        origin: [i32; 3],
        connected: bool,
    ) {
        if !connected {
            self.key = None;
            self.data.clear();
            return;
        }
        let key = (
            env.weather.revision,
            origin,
            env.rain.to_bits(),
            env.weather.columns.as_ptr() as usize,
        );
        if self.key == Some(key) {
            return;
        }
        self.key = Some(key);
        self.data.clear();
        if env.rain <= 0.001 {
            return;
        }
        for c in env.weather.columns.iter().take(441) {
            let seed =
                c.x.wrapping_mul(c.x)
                    .wrapping_mul(3121)
                    .wrapping_add(c.x.wrapping_mul(45238971))
                    ^ c.z
                        .wrapping_mul(c.z)
                        .wrapping_mul(418711)
                        .wrapping_add(c.z.wrapping_mul(13761));
            self.data.push(Column {
                position: [
                    (c.x as f64 - origin[0] as f64) as f32 + 0.5,
                    (c.floor as f64 - origin[1] as f64) as f32,
                    (c.z as f64 - origin[2] as f64) as f32 + 0.5,
                ],
                snow: u32::from(c.snow),
                light: c.light.map(|v| {
                    if c.snow {
                        (v as f32 * 3. + 15.) / 4.
                    } else {
                        v as f32
                    }
                }),
                phase: (seed as u32 & 65535) as f32 / 65536.,
                strength: env.rain.clamp(0., 1.),
            });
        }
        if !self.data.is_empty() {
            write_buffer(
                device,
                queue,
                &mut self.buffer,
                &mut self.capacity,
                bytemuck::cast_slice(&self.data),
                wgpu::BufferUsages::VERTEX,
                "Weather columns",
            );
        }
    }
    pub(super) fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>, camera: &'a wgpu::BindGroup) {
        if self.data.is_empty() {
            return;
        }
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, camera, &[]);
        pass.set_bind_group(1, &self.textures, &[]);
        pass.set_vertex_buffer(0, self.buffer.as_ref().unwrap().slice(..));
        pass.draw(0..6, 0..self.data.len() as u32);
    }
}
