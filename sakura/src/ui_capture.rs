//! Opt-in GPU visual regression fixture. Uses the production painter and shader.
//! Fixtures are test data, never substituted for server data in the application.
use super::*;
use crate::shared::{
    HudSnapshot, InventoryKind, InventorySlot, InventorySlotRole as Role, RichText,
};
use azalea_registry::builtin::ItemKind as Item;

fn stack(item: Item, count: u16) -> HotbarSlot {
    HotbarSlot {
        item_id: item as u32,
        count,
        name: crate::inventory_state::snake_case(&format!("{item:?}")),
        max_count: 64,
        ..Default::default()
    }
}
fn slot(index: u16, x: u16, y: u16, item: HotbarSlot, role: Role) -> InventorySlot {
    InventorySlot {
        index,
        x,
        y,
        stack: item,
        role,
        may_place_cursor: true,
        max_count: 64,
    }
}
fn fixture(kind: &str) -> FrameState {
    let mut frame = FrameState {
        connected: true,
        ..Default::default()
    };
    frame.hotbar = [
        stack(Item::DiamondPickaxe, 1),
        stack(Item::OakLog, 64),
        stack(Item::CraftingTable, 12),
        stack(Item::Cobblestone, 32),
        stack(Item::Apple, 5),
        stack(Item::OakStairs, 24),
        stack(Item::Torch, 64),
        stack(Item::OakFence, 20),
        stack(Item::WaterBucket, 1),
    ];
    frame.hotbar[0].enchantment_glint = true;
    frame.hotbar[0].damage = 300;
    frame.hotbar[0].max_damage = 1561;
    let mut hud = HudSnapshot {
        health: 17.,
        food: 17,
        armor: 13,
        experience: 0.65,
        level: 27,
        offhand: stack(Item::Shield, 1),
        ..Default::default()
    };
    hud.chat.push(crate::shared::HudText{text:RichText{plain:"<Sakura> Hello, 世界! Vanilla Java 26.1".into(),json:r#"{"text":"<Sakura> ","color":"aqua","extra":[{"text":"Hello, 世界! Vanilla Java 26.1","color":"white"}]}"#.into()},received_at:Instant::now()});
    frame.hud = Arc::new(hud);
    if matches!(kind, "inventory" | "crafting" | "tooltip" | "furnace") {
        let mut inventory = InventorySnapshot {
            open: true,
            ..Default::default()
        };
        if kind == "crafting" {
            inventory.kind = InventoryKind::Crafting;
            inventory.screen = "crafting_table".into();
            inventory.title = "Crafting".into();
            for i in 0..9 {
                inventory.slots.push(slot(
                    i + 1,
                    30 + i % 3 * 18,
                    17 + i / 3 * 18,
                    if i < 3 {
                        stack(Item::Diamond, 1)
                    } else if i % 3 == 1 {
                        stack(Item::Stick, 1)
                    } else {
                        HotbarSlot::default()
                    },
                    Role::CraftingInput,
                ));
            }
            inventory.slots.push(slot(
                0,
                124,
                35,
                stack(Item::DiamondPickaxe, 1),
                Role::Result,
            ));
        } else if kind == "furnace" {
            inventory.kind = InventoryKind::Furnace;
            inventory.screen = "furnace".into();
            inventory.title = "Furnace".into();
            inventory.slots = vec![
                slot(0, 56, 17, stack(Item::RawIron, 16), Role::Ingredient),
                slot(1, 56, 53, stack(Item::Coal, 12), Role::Fuel),
                slot(2, 116, 35, stack(Item::IronIngot, 8), Role::Result),
            ];
            inventory.properties = vec![(0, 800), (1, 1600), (2, 120), (3, 200)];
        } else {
            for i in 0..4 {
                inventory.slots.push(slot(
                    i + 1,
                    98 + i % 2 * 18,
                    18 + i / 2 * 18,
                    if i == 0 {
                        stack(Item::OakLog, 8)
                    } else {
                        HotbarSlot::default()
                    },
                    Role::CraftingInput,
                ));
                inventory.slots.push(slot(
                    i + 5,
                    8,
                    8 + i * 18,
                    HotbarSlot::default(),
                    Role::Armor,
                ));
            }
            inventory
                .slots
                .push(slot(0, 154, 28, stack(Item::OakPlanks, 4), Role::Result));
            inventory
                .slots
                .push(slot(45, 77, 62, stack(Item::Shield, 1), Role::Offhand));
        }
        for i in 0..27 {
            inventory.slots.push(slot(
                9 + i,
                8 + i % 9 * 18,
                84 + i / 9 * 18,
                frame.hotbar[i as usize % 9].clone(),
                Role::Player,
            ));
        }
        for i in 0..9 {
            inventory.slots.push(slot(
                36 + i,
                8 + i * 18,
                142,
                frame.hotbar[i as usize].clone(),
                Role::Hotbar,
            ));
        }
        if kind == "tooltip" {
            inventory
                .slots
                .iter_mut()
                .find(|s| s.index == 9)
                .unwrap()
                .stack
                .custom_name = Some(RichText {
                plain: "The Sakura Pickaxe — 世界".into(),
                json: r#"{"text":"The Sakura Pickaxe — 世界","color":"aqua","bold":true}"#.into(),
            });
        }
        frame.inventory = Arc::new(inventory);
    }
    frame
}

#[test]
#[ignore = "requires verified installed 26.1 assets and a native GPU; writes PNG captures outside source"]
fn capture_java_ui_fixtures() {
    pollster::block_on(capture()).unwrap();
}
async fn capture() -> Result<(), Box<dyn std::error::Error>> {
    let jar = std::path::PathBuf::from(std::env::var("SAKURA_REFERENCE_JAR")?);
    let cache = std::path::PathBuf::from(std::env::var("SAKURA_TEST_CACHE")?);
    let output = std::path::PathBuf::from(std::env::var("SAKURA_UI_CAPTURE_DIR")?);
    std::fs::create_dir_all(&output)?;
    let assets = crate::assets::load(&jar, &cache)?;
    let instance = wgpu::Instance::default();
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        })
        .await?;
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor::default())
        .await?;
    let camera_layout = uniform_layout(&device, false, "UI fixture camera");
    let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: None,
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
    let (atlas, atlas_group) = upload_texture_data(
        &device,
        &queue,
        &texture_layout,
        assets.gui.width,
        assets.gui.height,
        1,
        &assets.gui.rgba,
        "UI fixture atlas",
        true,
    )?;
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: &[Some(&camera_layout), Some(&texture_layout)],
        ..Default::default()
    });
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: None,
        source: wgpu::ShaderSource::Wgsl(include_str!("gui.wgsl").into()),
    });
    let pipeline=device.create_render_pipeline(&wgpu::RenderPipelineDescriptor{label:Some("Production GUI fixture"),layout:Some(&layout),vertex:wgpu::VertexState{module:&shader,entry_point:Some("vs_hud"),compilation_options:Default::default(),buffers:&[Some(wgpu::VertexBufferLayout{array_stride:std::mem::size_of::<HudVertex>() as u64,step_mode:wgpu::VertexStepMode::Vertex,attributes:&wgpu::vertex_attr_array![0=>Float32x2,1=>Float32x2,2=>Uint32,3=>Float32x4]})]},primitive:wgpu::PrimitiveState{cull_mode:None,..Default::default()},depth_stencil:None,multisample:Default::default(),fragment:Some(wgpu::FragmentState{module:&shader,entry_point:Some("fs_hud"),compilation_options:Default::default(),targets:&[Some(wgpu::ColorTargetState{format:wgpu::TextureFormat::Rgba8Unorm,blend:Some(wgpu::BlendState::ALPHA_BLENDING),write_mask:wgpu::ColorWrites::ALL})]}),multiview_mask:None,cache:None});
    let mut results = Vec::new();
    for (width, height, scale) in [(800, 600, 1), (1100, 720, 2), (1920, 1080, 3)] {
        for kind in [
            "hud",
            "inventory",
            "crafting",
            "furnace",
            "tooltip",
            "pause",
            "settings",
        ] {
            let size = PhysicalSize::new(width, height);
            let state = fixture(kind);
            let mut inventory = inventory_ui::InventoryUi::default();
            inventory.sync(&state.inventory, true, Instant::now());
            let metrics = GuiMetrics::new(size, scale);
            let panel = inventory.layout(&state.inventory, metrics).panel;
            let cursor = if kind == "tooltip" {
                [
                    (panel[0] + 16.) * metrics.scale,
                    (panel[1] + 90.) * metrics.scale,
                ]
            } else {
                [0.; 2]
            };
            let ui = UiState {
                paused: matches!(kind, "pause" | "settings"),
                captured: kind == "hud",
                chat_input: None,
                inventory: &inventory,
                cursor,
                gui_scale: scale,
                volume: 1.,
                brightness: 0.5,
                smooth_lighting: true,
                settings: kind == "settings",
                focus: None,
                time: 2.,
            };
            assets.gui.begin_frame();
            let first = Instant::now();
            let (vertices, _) = java_hud::draw(&state, &InputState::default(), &ui, &assets, size, &crate::lighting::LightmapInputs::default().table());
            let first_us = first.elapsed().as_micros();
            let mut timings = Vec::with_capacity(100);
            for _ in 0..100 {
                let started = Instant::now();
                let _ = java_hud::draw(&state, &InputState::default(), &ui, &assets, size, &crate::lighting::LightmapInputs::default().table());
                timings.push(started.elapsed().as_micros() as u64);
            }
            for u in assets.gui.take_glyph_uploads() {
                queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &atlas,
                        mip_level: 0,
                        origin: wgpu::Origin3d {
                            x: u.x,
                            y: u.y,
                            z: 0,
                        },
                        aspect: wgpu::TextureAspect::All,
                    },
                    &u.rgba,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(u.width * 4),
                        rows_per_image: Some(u.height),
                    },
                    wgpu::Extent3d {
                        width: u.width,
                        height: u.height,
                        depth_or_array_layers: 1,
                    },
                );
            }
            let uniform = CameraUniform {
                viewport: [width as f32, height as f32, 2., 0.],
                glint: assets
                    .gui
                    .sprites
                    .get("misc/enchanted_glint_item")
                    .map(|s| {
                        [
                            s.x as f32 / assets.gui.width as f32,
                            s.y as f32 / assets.gui.height as f32,
                            s.width as f32 / assets.gui.width as f32,
                            s.height as f32 / assets.gui.height as f32,
                        ]
                    })
                    .unwrap_or([0.; 4]),
                ..CameraUniform::zeroed()
            };
            let camera = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::bytes_of(&uniform),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let camera_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: None,
                layout: &camera_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: camera.as_entire_binding(),
                }],
            });
            let vertex_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let extent = wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            };
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size: extent,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            let row = (width * 4).div_ceil(256) * 256;
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: row as u64 * height as u64,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            let mut encoder = device.create_command_encoder(&Default::default());
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: None,
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color {
                                r: 0.12,
                                g: 0.21,
                                b: 0.1,
                                a: 1.,
                            }),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
                pass.set_pipeline(&pipeline);
                pass.set_bind_group(0, &camera_group, &[]);
                pass.set_bind_group(1, &atlas_group, &[]);
                pass.set_vertex_buffer(0, vertex_buffer.slice(..));
                pass.draw(0..vertices.len() as u32, 0..1);
            }
            encoder.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyBufferInfo {
                    buffer: &buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(row),
                        rows_per_image: Some(height),
                    },
                },
                extent,
            );
            queue.submit([encoder.finish()]);
            let (tx, rx) = std::sync::mpsc::channel();
            buffer
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |result| {
                    let _ = tx.send(result);
                });
            device.poll(wgpu::PollType::wait_indefinitely())?;
            rx.recv()??;
            let mapped = buffer.slice(..).get_mapped_range()?;
            let mut pixels = Vec::with_capacity((width * height * 4) as usize);
            for line in mapped.chunks(row as usize) {
                pixels.extend_from_slice(&line[..(width * 4) as usize]);
            }
            image::save_buffer(
                output.join(format!("{kind}-{width}x{height}-scale{scale}.png")),
                &pixels,
                width,
                height,
                image::ColorType::Rgba8,
            )?;
            drop(mapped);
            buffer.unmap();
            results.push(serde_json::json!({"screen":kind,"width":width,"height":height,"gui_scale":scale,"first_layout_us":first_us,"warm_layout":timing_summary(&mut timings),"vertices":vertices.len(),"draw_calls":1}));
        }
    }
    std::fs::write(
        output.join("fixture-metrics.json"),
        serde_json::to_vec_pretty(
            &serde_json::json!({"adapter":format!("{:?}",adapter.get_info()),"optimized":!cfg!(debug_assertions),"scope":"CPU UI geometry fixtures, not full game frame performance; green test background and default-avatar preview omitted", "results":results}),
        )?,
    )?;
    Ok(())
}
