//! Pause-only Minecraft 26.1 menu blur: the official six-pass box-blur chain.
//! Construct lazily on the first paused frame; no allocation or work is needed
//! on a gameplay frame. Targets, sampler, uniforms and bind groups are reused.
//! World shading writes through its SRGB view; GUI composition and the official
//! post-processing kernel operate on encoded display values through UNORM views.
use wgpu::util::DeviceExt;
use winit::dpi::PhysicalSize;

const DEFAULT_RADIUS: f32 = 5.; // Options.menuBackgroundBlurriness default.
const PASS_COUNT: usize = 6;

struct Target {
    _texture: wgpu::Texture,
    view: wgpu::TextureView,
    gui_view: wgpu::TextureView,
}
pub(super) struct MenuBlur {
    size: PhysicalSize<u32>,
    format: wgpu::TextureFormat,
    world: Target,
    swap: Target,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    horizontal: wgpu::Buffer,
    vertical: wgpu::Buffer,
    groups: [wgpu::BindGroup; 2],
    pipeline: wgpu::RenderPipeline,
}
impl MenuBlur {
    pub(super) fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        size: PhysicalSize<u32>,
    ) -> Self {
        let size = nonzero_size(size);
        let gui_format = format.remove_srgb_suffix();
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Paused menu blur layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
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
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(16),
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Paused menu blur pipeline layout"),
            bind_group_layouts: &[Some(&layout)],
            ..Default::default()
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Java 26.1 menu box blur"),
            source: wgpu::ShaderSource::Wgsl(include_str!("menu_blur.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Paused menu box blur"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: gui_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Menu blur bilinear clamp"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            min_filter: wgpu::FilterMode::Linear,
            mag_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let horizontal = uniform(device, [1., 0., DEFAULT_RADIUS, 0.]);
        let vertical = uniform(device, [0., 1., DEFAULT_RADIUS, 0.]);
        let world = target(device, format, size, "Paused world and HUD");
        let swap = target(device, gui_format, size, "Menu blur intermediate");
        let groups = [
            group(device, &layout, &world.gui_view, &sampler, &horizontal),
            group(device, &layout, &swap.view, &sampler, &vertical),
        ];
        Self {
            size,
            format,
            world,
            swap,
            layout,
            sampler,
            horizontal,
            vertical,
            groups,
            pipeline,
        }
    }
    pub(super) fn resize(&mut self, device: &wgpu::Device, size: PhysicalSize<u32>) {
        let size = nonzero_size(size);
        if size == self.size {
            return;
        }
        self.world = target(device, self.format, size, "Paused world and HUD");
        self.swap = target(
            device,
            self.format.remove_srgb_suffix(),
            size,
            "Menu blur intermediate",
        );
        self.groups = [
            group(
                device,
                &self.layout,
                &self.world.gui_view,
                &self.sampler,
                &self.horizontal,
            ),
            group(
                device,
                &self.layout,
                &self.swap.view,
                &self.sampler,
                &self.vertical,
            ),
        ];
        self.size = size;
    }
    pub(super) fn world_view(&self) -> &wgpu::TextureView {
        &self.world.view
    }
    /// UNORM view of the same backing world texture, used for GUI composition.
    pub(super) fn gui_view(&self) -> &wgpu::TextureView {
        &self.world.gui_view
    }
    /// Draw world shading into world_view, then gameplay HUD into gui_view.
    /// This submits six UNORM blur passes; destination must also have the
    /// surface format's SRGB suffix removed. Draw menu controls afterward.
    pub(super) fn encode(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        destination: &wgpu::TextureView,
    ) {
        for index in 0..PASS_COUNT {
            let horizontal = index % 2 == 0;
            let view = if index == PASS_COUNT - 1 {
                destination
            } else if horizontal {
                &self.swap.view
            } else {
                &self.world.gui_view
            };
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Paused menu blur pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.groups[usize::from(!horizontal)], &[]);
            pass.draw(0..3, 0..1);
        }
    }
}
fn nonzero_size(size: PhysicalSize<u32>) -> PhysicalSize<u32> {
    PhysicalSize::new(size.width.max(1), size.height.max(1))
}
fn uniform(device: &wgpu::Device, data: [f32; 4]) -> wgpu::Buffer {
    device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Menu blur direction and radius"),
        contents: bytemuck::cast_slice(&data),
        usage: wgpu::BufferUsages::UNIFORM,
    })
}
fn target(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
    size: PhysicalSize<u32>,
    label: &'static str,
) -> Target {
    let gui_format = format.remove_srgb_suffix();
    let view_formats = [gui_format];
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: size.width,
            height: size.height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: if format.is_srgb() { &view_formats } else { &[] },
    });
    let view = texture.create_view(&Default::default());
    let gui_view = texture.create_view(&wgpu::TextureViewDescriptor {
        format: Some(gui_format),
        ..Default::default()
    });
    Target {
        _texture: texture,
        view,
        gui_view,
    }
}
fn group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    view: &wgpu::TextureView,
    sampler: &wgpu::Sampler,
    uniform: &wgpu::Buffer,
) -> wgpu::BindGroup {
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("Menu blur source and direction"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: uniform.as_entire_binding(),
            },
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires a native GPU; headless production blur validation without opening a window"]
    fn six_pass_gpu_blur_is_normalized_centered_and_resizable() {
        pollster::block_on(async {
            let adapter = wgpu::Instance::default()
                .request_adapter(&wgpu::RequestAdapterOptions::default())
                .await
                .unwrap();
            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor::default())
                .await
                .unwrap();
            let mut reference_square = None;
            for format in [
                wgpu::TextureFormat::Rgba8Unorm,
                wgpu::TextureFormat::Rgba8UnormSrgb,
                wgpu::TextureFormat::Bgra8UnormSrgb,
            ] {
                let gui_format = format.remove_srgb_suffix();
                let size = PhysicalSize::new(64, 64);
                let mut blur = MenuBlur::new(&device, format, PhysicalSize::new(1, 1));
                blur.resize(&device, size);
                blur.resize(&device, size); // Same-size frames reuse targets and groups.
                let view_formats = [gui_format];
                let destination = device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("Blur readback"),
                    size: wgpu::Extent3d {
                        width: 64,
                        height: 64,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                    view_formats: if format.is_srgb() { &view_formats } else { &[] },
                });
                let view = destination.create_view(&wgpu::TextureViewDescriptor {
                    format: Some(gui_format),
                    ..Default::default()
                });
                let readback = device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("Blur test pixels"),
                    size: 64 * 64 * 4,
                    usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                    mapped_at_creation: false,
                });
                let source_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {label: Some("Blur reference input"), source: wgpu::ShaderSource::Wgsl(r#"
                @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
                    let uv=vec2<f32>(f32((i<<1u)&2u),f32(i&2u)); return vec4<f32>(uv*2.0-1.0,0.0,1.0);
                }
                @fragment fn fs(@builtin(position) p:vec4<f32>)->@location(0) vec4<f32>{
                    let white = all(p.xy>=vec2<f32>(24.0)) && all(p.xy<vec2<f32>(40.0));
                    return vec4<f32>(vec3<f32>(select(0.0,1.0,white)),1.0);
                }
            "#.into())});
                let source_pipeline =
                    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                        label: Some("Blur reference square"),
                        layout: None,
                        vertex: wgpu::VertexState {
                            module: &source_shader,
                            entry_point: Some("vs"),
                            compilation_options: Default::default(),
                            buffers: &[],
                        },
                        primitive: Default::default(),
                        depth_stencil: None,
                        multisample: Default::default(),
                        fragment: Some(wgpu::FragmentState {
                            module: &source_shader,
                            entry_point: Some("fs"),
                            compilation_options: Default::default(),
                            targets: &[Some(wgpu::ColorTargetState {
                                format,
                                blend: None,
                                write_mask: wgpu::ColorWrites::ALL,
                            })],
                        }),
                        multiview_mask: None,
                        cache: None,
                    });
                // 0: SRGB world clear, 1: raw GUI clear through the same backing
                // texture's UNORM view, 2: black/white edge through the world view.
                for scenario in 0..3 {
                    let square = scenario == 2;
                    let mut encoder = device.create_command_encoder(&Default::default());
                    {
                        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                            label: Some("Blur input"),
                            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                                view: if scenario == 1 {
                                    blur.gui_view()
                                } else {
                                    blur.world_view()
                                },
                                depth_slice: None,
                                resolve_target: None,
                                ops: wgpu::Operations {
                                    load: wgpu::LoadOp::Clear(wgpu::Color {
                                        r: 0.5,
                                        g: 0.25,
                                        b: 0.125,
                                        a: 1.,
                                    }),
                                    store: wgpu::StoreOp::Store,
                                },
                            })],
                            ..Default::default()
                        });
                        if square {
                            pass.set_pipeline(&source_pipeline);
                            pass.draw(0..3, 0..1);
                        }
                    }
                    blur.encode(&mut encoder, &view);
                    encoder.copy_texture_to_buffer(
                        wgpu::TexelCopyTextureInfo {
                            texture: &destination,
                            mip_level: 0,
                            origin: wgpu::Origin3d::ZERO,
                            aspect: wgpu::TextureAspect::All,
                        },
                        wgpu::TexelCopyBufferInfo {
                            buffer: &readback,
                            layout: wgpu::TexelCopyBufferLayout {
                                offset: 0,
                                bytes_per_row: Some(256),
                                rows_per_image: Some(64),
                            },
                        },
                        wgpu::Extent3d {
                            width: 64,
                            height: 64,
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
                    let mut canonical = bytes.to_vec();
                    if format == wgpu::TextureFormat::Bgra8UnormSrgb {
                        for pixel in canonical.chunks_exact_mut(4) {
                            pixel.swap(0, 2);
                        }
                    }
                    if !square {
                        let expected = if scenario == 0 && format.is_srgb() {
                            [188i16, 137, 99, 255]
                        } else {
                            [128i16, 64, 32, 255]
                        };
                        for rgba in canonical.chunks_exact(4) {
                            for (actual, expected) in rgba.iter().zip(expected) {
                                assert!((*actual as i16 - expected).abs() <= 1);
                            }
                        }
                    } else {
                        let pixel = |x: usize, y: usize| canonical[(y * 64 + x) * 4] as i16;
                        if let Some(reference) = &reference_square {
                            assert_eq!(
                                &canonical, reference,
                                "SRGB view changed encoded blur colors for {format:?}"
                            );
                        } else {
                            reference_square = Some(canonical.clone());
                        }
                        assert_eq!(pixel(8, 32), 0);
                        assert!(pixel(14, 32) > 0);
                        assert!(pixel(31, 31) > 128 && pixel(31, 31) < 255);
                        for y in 0..64 {
                            for x in 0..64 {
                                assert!(
                                    (pixel(x, y) - pixel(63 - x, y)).abs() <= 1,
                                    "horizontal blur shifted at {x},{y}"
                                );
                                assert!(
                                    (pixel(x, y) - pixel(y, x)).abs() <= 2,
                                    "unequal axis kernels at {x},{y}"
                                );
                            }
                        }
                    }
                    drop(bytes);
                    readback.unmap();
                }
            }
        });
    }
}
