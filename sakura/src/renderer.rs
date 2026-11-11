//! Native textured renderer. Section snapshots, CPU meshing and GPU residency are
//! separate: receiving one block update never rebuilds the entire world.
#[path = "renderer_entities.rs"]
mod entities;
#[path = "renderer_weather.rs"]
mod weather;

use crate::{
    assets::{AssetPack, BakedQuad, Face, RenderLayer},
    shared::{
        EntitySnapshot, HotbarSlot, InputState, InventoryAction, InventoryActionKind,
        InventorySnapshot, RendererConfig, SceneSnapshot, SectionSnapshot,
    },
};
use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3, Vec4, camera::rh};
use std::{
    collections::{HashMap, HashSet},
    hash::{Hash, Hasher},
    num::NonZeroU64,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    time::{Duration, Instant},
};
use wgpu::util::DeviceExt;
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalSize, PhysicalSize},
    event::{DeviceEvent, DeviceId, ElementState, MouseButton, MouseScrollDelta, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop},
    keyboard::{KeyCode, PhysicalKey},
    window::{CursorGrabMode, Window, WindowId},
};

const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
const MAX_SECTIONS: usize = 4096;
const MAX_GEOMETRY_BYTES: u64 = 256 * 1024 * 1024;
const UPLOAD_BYTES_PER_FRAME: usize = 4 * 1024 * 1024;
const MAX_QUADS_PER_SECTION: usize = 65_536;
const SOLID: u32 = u32::MAX;
#[path = "gui.rs"]
mod gui;
#[path = "inventory_ui.rs"]
mod inventory_ui;
#[path = "renderer_hud.rs"]
mod java_hud;
#[path = "menu_blur.rs"]
mod menu_blur;
#[path = "player_preview.rs"]
mod player_preview;
#[path = "ui_audio.rs"]
mod ui_audio;
#[cfg(test)]
#[path = "ui_capture.rs"]
mod ui_capture;
#[path = "ui_options.rs"]
mod ui_options;
use gui::GuiMetrics;

pub fn run(
    input: Arc<Mutex<InputState>>,
    scene: Arc<Mutex<SceneSnapshot>>,
    stop: Arc<AtomicBool>,
    assets: Arc<AssetPack>,
    config: RendererConfig,
    options_path: Option<&std::path::Path>,
) -> Result<(), String> {
    let event_loop = EventLoop::new().map_err(|e| e.to_string())?;
    let mut app = Viewer {
        audio: ui_audio::UiAudio::new(&assets),
        ui_options: ui_options::UiOptions::load(options_path),
        settings: false,
        menu_focus: None,
        volume_drag: false,
        worker: MeshWorker::new(assets.clone())?,
        assets,
        config,
        input,
        scene,
        stop: stop.clone(),
        window: None,
        graphics: None,
        keys: HashSet::new(),
        forward_tap: Default::default(),
        jump_tap: Default::default(),
        captured: false,
        paused: false,
        chat_input: None,
        cursor: [0.0; 2],
        occluded: false,
        next_frame: Instant::now(),
        started: Instant::now(),
        first_present: false,
        first_world: false,
        error: None,
        title: String::new(),
        epoch: u64::MAX,
        scene_revision: u64::MAX,
        sections: HashMap::new(),
        pending: HashMap::new(),
        deferred_mesh: None,
        frame_count: 0,
        mesh_us: 0,
        uploaded_bytes: 0,
        last_metrics: Instant::now(),
        wheel_remainder: 0.0,
        frame_state: FrameState::default(),
        motion: CameraMotion::default(),
        needs_scheduling: true,
        last_presented: false,
        inventory: inventory_ui::InventoryUi::default(),
        focused: true,
        shift_down: false,
        control_down: false,
        frame_intervals: Vec::with_capacity(4096),
        previous_present: None,
    };
    let result = event_loop.run_app(&mut app).map_err(|e| e.to_string());
    stop.store(true, Ordering::Release);
    result?;
    app.error.map_or(Ok(()), Err)
}

struct Viewer {
    audio: ui_audio::UiAudio,
    ui_options: ui_options::UiOptions,
    settings: bool,
    menu_focus: Option<usize>,
    volume_drag: bool,
    input: Arc<Mutex<InputState>>,
    scene: Arc<Mutex<SceneSnapshot>>,
    stop: Arc<AtomicBool>,
    assets: Arc<AssetPack>,
    config: RendererConfig,
    window: Option<Arc<Window>>,
    graphics: Option<Graphics>,
    worker: MeshWorker,
    sections: HashMap<[i32; 3], Arc<SectionSnapshot>>,
    pending: HashMap<[i32; 3], (u64, u64)>,
    deferred_mesh: Option<MeshResult>,
    epoch: u64,
    scene_revision: u64,
    keys: HashSet<KeyCode>,
    forward_tap: crate::movement_input::DoubleTap,
    jump_tap: crate::movement_input::DoubleTap,
    captured: bool,
    paused: bool,
    chat_input: Option<String>,
    cursor: [f32; 2],
    wheel_remainder: f32,
    occluded: bool,
    next_frame: Instant,
    started: Instant,
    first_present: bool,
    first_world: bool,
    title: String,
    error: Option<String>,
    frame_count: u64,
    mesh_us: u64,
    uploaded_bytes: u64,
    last_metrics: Instant,
    frame_state: FrameState,
    motion: CameraMotion,
    needs_scheduling: bool,
    last_presented: bool,
    inventory: inventory_ui::InventoryUi,
    focused: bool,
    shift_down: bool,
    control_down: bool,
    frame_intervals: Vec<u64>,
    previous_present: Option<Instant>,
}

struct FrameState {
    environment: crate::lighting::Environment,
    light_debug: crate::lighting::DebugSample,
    local_skin: Option<Arc<crate::shared::PlayerSkin>>,
    player: [f64; 3],
    eye_height: f32,
    fov_multiplier:f32,
    connected: bool,
    status: String,
    hotbar: [HotbarSlot; 9],
    health: f32,
    food: u8,
    chat: Vec<String>,
    entities: Vec<EntitySnapshot>,
    target: Option<[i32; 3]>,
    inventory: Arc<InventorySnapshot>,
    hud: Arc<crate::shared::HudSnapshot>,
}
impl Default for FrameState {
    fn default() -> Self {
        Self {
            local_skin: None,
            environment: Default::default(),
            light_debug: Default::default(),
            player: [0.; 3],
            eye_height: 1.62,
            fov_multiplier:1.,
            connected: false,
            status: String::new(),
            hotbar: std::array::from_fn(|_| HotbarSlot::default()),
            health: 20.,
            food: 20,
            chat: Vec::new(),
            entities: Vec::new(),
            target: None,
            inventory: Arc::new(InventorySnapshot::default()),
            hud: Arc::new(crate::shared::HudSnapshot::default()),
        }
    }
}
#[derive(Default)]
struct CameraMotion {
    from: [f64; 3],
    target: [f64; 3],
    received: Option<Instant>,
    duration: f64,
}
impl CameraMotion {
    fn sample(&self, now: Instant) -> [f64; 3] {
        let t = self.received.map_or(1., |last| {
            (now.duration_since(last).as_secs_f64() / self.duration.max(0.001)).clamp(0., 1.)
        });
        std::array::from_fn(|a| self.from[a] + (self.target[a] - self.from[a]) * t)
    }
    fn update(&mut self, position: [f64; 3], now: Instant) -> [f64; 3] {
        if position != self.target || self.received.is_none() {
            let distance = (0..3)
                .map(|a| (position[a] - self.target[a]).powi(2))
                .sum::<f64>();
            self.from = if distance > 64. || self.received.is_none() {
                position
            } else {
                self.sample(now)
            };
            self.duration = self.received.map_or(0.033, |last| {
                now.duration_since(last).as_secs_f64().clamp(0.015, 0.050)
            });
            self.target = position;
            self.received = Some(now);
        }
        self.sample(now)
    }
}

impl Viewer {
    fn activate_menu(&mut self, index: usize) {
        self.audio.click(self.ui_options.volume);
        if self.settings {
            match index {
                0 => {
                    let max = self
                        .graphics
                        .as_ref()
                        .map(|g| GuiMetrics::new(g.size, 0).scale as u8)
                        .unwrap_or(1);
                    self.ui_options.gui_scale = (self.ui_options.gui_scale + 1) % (max + 1);
                }
                1 => {
                    self.ui_options.volume = if self.ui_options.volume <= 0. {
                        1.
                    } else {
                        (self.ui_options.volume - 0.25).max(0.)
                    };
                }
                2 => {self.ui_options.brightness=(self.ui_options.brightness+0.25)%1.25;}
                3 => {
                    self.ui_options.smooth_lighting=!self.ui_options.smooth_lighting;
                    self.pending.clear();self.deferred_mesh=None;
                    if let Some(g)=&mut self.graphics {g.rejected.clear();}
                    self.needs_scheduling=true;
                }
                4 => {
                    self.finish_volume();
                    self.settings = false;
                    self.menu_focus = None;
                }
                _ => return,
            }
            if let Err(error) = self.ui_options.save() {
                eprintln!("Cannot save UI options: {error}");
            }
        } else if self.frame_state.health <= 0. {
            if index == 0 {
                if let Ok(mut input) = self.input.lock() {
                    input.respawn = input.respawn.wrapping_add(1);
                }
                self.capture_pointer();
            } else if index == 1 {
                self.stop.store(true, Ordering::Release);
            }
        } else {
            match index {
                0 => self.capture_pointer(),
                1 => {
                    self.settings = true;
                    self.menu_focus = None;
                }
                2 => self.stop.store(true, Ordering::Release),
                _ => {}
            }
        }
    }
    fn fail(&mut self, event_loop: &ActiveEventLoop, message: String) {
        self.error = Some(message);
        self.stop.store(true, Ordering::Release);
        self.release_pointer();
        event_loop.exit();
    }
    fn drag_volume(&mut self) {
        if let Some(g) = &self.graphics {
            let metrics = GuiMetrics::new(g.size, self.ui_options.gui_scale);
            let buttons = java_hud::menu_buttons(
                metrics,
                false,
                true,
                self.ui_options.gui_scale,
                self.ui_options.volume,
                self.ui_options.brightness,
                self.ui_options.smooth_lighting,
            );
            let rect = buttons[1].0;
            self.ui_options.volume =
                ((metrics.pointer(self.cursor)[0] - rect[0] - 4.) / (rect[2] - 8.)).clamp(0., 1.);
        }
    }
    fn finish_volume(&mut self) {
        if self.volume_drag {
            self.volume_drag = false;
            self.audio.click(self.ui_options.volume);
            if let Err(e) = self.ui_options.save() {
                eprintln!("Cannot save UI options: {e}");
            }
        }
    }
    fn capture_pointer(&mut self) {
        self.finish_volume();
        if !self.focused || self.inventory.active(&self.frame_state.inventory) {
            return;
        }
        let Some(window) = &self.window else { return };
        if window
            .set_cursor_grab(CursorGrabMode::Locked)
            .or_else(|_| window.set_cursor_grab(CursorGrabMode::Confined))
            .is_ok()
        {
            window.set_cursor_visible(false);
            self.captured = true;
            self.paused = false;
        }
    }
    fn release_pointer(&mut self) {
        self.captured = false;
        self.keys.clear();
        self.forward_tap.reset();self.jump_tap.reset();
        if let Some(window) = &self.window {
            let _ = window.set_cursor_grab(CursorGrabMode::None);
            window.set_cursor_visible(true);
        }
        if let Ok(mut input) = self.input.lock() {
            input.attack = false;
        }
        self.update_input();
    }
    fn update_input(&self) {
        if let Ok(mut input) = self.input.lock() {
            let key = |code| {
                self.captured
                    && !self.inventory.active(&self.frame_state.inventory)
                    && self.keys.contains(&code)
            };
            input.forward =
                i32::from(key(KeyCode::KeyW)) as f32 - i32::from(key(KeyCode::KeyS)) as f32;
            input.strafe =
                i32::from(key(KeyCode::KeyD)) as f32 - i32::from(key(KeyCode::KeyA)) as f32;
            input.jump = key(KeyCode::Space);
            input.sprint = key(KeyCode::ControlLeft) || key(KeyCode::ControlRight);
            input.sneak = key(KeyCode::ShiftLeft) || key(KeyCode::ShiftRight);
        }
    }
    fn read_scene(&mut self) -> Result<(), String> {
        let scene = self
            .scene
            .lock()
            .map_err(|_| "The network scene is unavailable.")?;
        if self.epoch != scene.world_epoch {
            self.epoch = scene.world_epoch;
            self.scene_revision = u64::MAX;
            self.pending.clear();
            self.deferred_mesh = None;
            self.motion = CameraMotion::default();
            if let Some(graphics) = &mut self.graphics {
                graphics.clear_sections();
            }
        }
        if self.scene_revision != scene.revision {
            // Only Arc handles are copied. Halo blocks and models stay shared with workers.
            self.sections.clone_from(&scene.sections);
            self.scene_revision = scene.revision;
            self.needs_scheduling = true;
        }
        let state = &mut self.frame_state;
        state.player = self.motion.update(scene.player_position, Instant::now());
        state.eye_height=scene.eye_height;state.fov_multiplier=scene.fov_multiplier;
        state.connected = scene.connected;
        state.status.clear();
        state
            .status
            .extend(scene.status.chars().filter(|c| !c.is_control()).take(180));
        for (to, from) in state.hotbar.iter_mut().zip(&scene.hotbar) {
            if to.item_id != from.item_id
                || to.count != from.count
                || to.component_fingerprint != from.component_fingerprint
            {
                to.clone_from(from);
            }
        }
        if !Arc::ptr_eq(&state.hud, &scene.hud) {
            state.hud = scene.hud.clone();
        }
        state.local_skin = scene.local_skin.clone();
        state.environment=scene.environment.clone();
        state.light_debug=scene.light_debug.clone();
        state.health = scene.health;
        state.food = scene.food;
        state.target = scene.target;
        if !Arc::ptr_eq(&state.inventory, &scene.inventory) {
            state.inventory = scene.inventory.clone();
        }
        state.chat.resize_with(scene.chat.len().min(6), String::new);
        for (to, from) in state
            .chat
            .iter_mut()
            .zip(scene.chat.iter().skip(scene.chat.len().saturating_sub(6)))
        {
            to.clear();
            to.extend(from.chars().take(360));
        }
        let entities = &scene.entities[..scene.entities.len().min(256)];
        state.entities.truncate(entities.len());
        for (i, from) in entities.iter().enumerate() {
            if let Some(to) = state.entities.get_mut(i) {
                to.id = from.id;
                to.position = from.position;
                to.yaw = from.yaw;
                to.width = from.width;
                to.height = from.height;
                to.is_player = from.is_player;
                to.kind.clone_from(&from.kind);
                to.head_yaw = from.head_yaw;
                to.pitch = from.pitch;
                to.baby = from.baby;
                to.variant.clone_from(&from.variant);
                to.size = from.size;
                to.sheep_color = from.sheep_color;
                to.sheared = from.sheared;
                to.sitting = from.sitting;
                to.tamed = from.tamed;
                to.angry = from.angry;
                to.villager_type.clone_from(&from.villager_type);
                to.villager_profession.clone_from(&from.villager_profession);
                to.item_id = from.item_id;
                to.item_count = from.item_count;
            } else {
                state.entities.push(from.clone());
            }
        }
        Ok(())
    }
    fn frame(&mut self) -> Result<(), String> {
        self.read_scene()?;
        let inventory_transition = self.inventory.sync(
            &self.frame_state.inventory,
            self.frame_state.connected,
            Instant::now(),
        );
        if self.inventory.active(&self.frame_state.inventory) {
            self.chat_input = None;
            if self.captured {
                self.release_pointer();
            }
            if inventory_transition == inventory_ui::Transition::Opened {
                self.paused = false;
            }
        } else if inventory_transition == inventory_ui::Transition::Closed
            && self.frame_state.connected
            && self.frame_state.health > 0.
            && !self.paused
        {
            self.capture_pointer();
        }
        if let Some(action) = self.inventory.deferred_close(&self.frame_state.inventory) {
            self.queue_inventory(action);
        }
        if self.frame_state.connected && self.frame_state.health <= 0. {
            self.finish_volume();
            self.settings = false;
            self.menu_focus = self.menu_focus.filter(|index| *index < 2);
            self.chat_input = None;
            if self.captured {
                self.release_pointer();
            }
        }
        if let Some(action) = self.inventory.next_sort_action(&self.frame_state.inventory) { self.queue_inventory(action); }
        let state = &self.frame_state;
        let graphics = self
            .graphics
            .as_mut()
            .ok_or("The renderer is unavailable.")?;
        graphics.retain_sections(&self.sections);
        let upload_start = Instant::now();
        let mut bytes = 0usize;
        // A result larger than the budget may upload alone; it cannot starve forever.
        loop {
            let result = self
                .deferred_mesh
                .take()
                .or_else(|| self.worker.results.try_recv().ok());
            let Some(mesh) = result else { break };
            if mesh.smooth!=self.ui_options.smooth_lighting {continue;}
            if mesh.epoch != self.epoch
                || self
                    .sections
                    .get(&mesh.position)
                    .is_none_or(|s| s.revision != mesh.revision)
            {
                if self.pending.get(&mesh.position) == Some(&(mesh.epoch, mesh.revision)) {
                    self.pending.remove(&mesh.position);
                }
                continue;
            }
            let size = mesh.bytes();
            if bytes > 0
                && (bytes + size > UPLOAD_BYTES_PER_FRAME
                    || upload_start.elapsed() > Duration::from_millis(2))
            {
                self.deferred_mesh = Some(mesh);
                break;
            }
            self.pending.remove(&mesh.position);
            self.mesh_us += mesh.mesh_us;
            bytes += size;
            graphics.upload(mesh)?;
            if bytes >= UPLOAD_BYTES_PER_FRAME {
                break;
            }
        }
        self.uploaded_bytes += bytes as u64;
        if self.needs_scheduling && self.pending.len() < 6 {
            let mut candidates: Vec<_> = self
                .sections
                .values()
                .filter(|section| {
                    !self.pending.contains_key(&section.position)
                        && graphics.rejected.get(&section.position) != Some(&section.revision)
                        && graphics
                            .sections
                            .get(&section.position)
                            .is_none_or(|g| g.revision != section.revision || g.smooth != self.ui_options.smooth_lighting)
                })
                .collect();
            candidates.sort_unstable_by(|a, b| {
                section_distance(a.position, state.player)
                    .total_cmp(&section_distance(b.position, state.player))
            });
            self.needs_scheduling = false;
            for section in candidates {
                if self.pending.len() >= 6 {
                    self.needs_scheduling = true;
                    break;
                }
                let request = MeshRequest {
                    smooth: self.ui_options.smooth_lighting,
                    epoch: self.epoch,
                    section: section.clone(),
                };
                if self.worker.requests.try_send(request).is_err() {
                    self.needs_scheduling = true;
                    break;
                }
                self.pending
                    .insert(section.position, (self.epoch, section.revision));
            }
        }
        let input = {
            let input = self
                .input
                .lock()
                .map_err(|_| "Input state is unavailable.")?;
            // Drawing never needs to clone queued network actions or chat text.
            InputState {
                hide_hud: input.hide_hud,
                light_debug: input.light_debug,
                yaw: input.yaw,
                pitch: input.pitch,
                hotbar: input.hotbar,
                ..Default::default()
            }
        };
        let ui = UiState {
            gui_scale: self.ui_options.gui_scale,
            volume: self.ui_options.volume,
            brightness: self.ui_options.brightness,
            smooth_lighting: self.ui_options.smooth_lighting,
            settings: self.settings,
            focus: self.menu_focus,
            time: self.started.elapsed().as_secs_f32(),
            paused: self.paused,
            captured: self.captured,
            chat_input: self.chat_input.as_deref(),
            inventory: &self.inventory,
            cursor: self.cursor,
        };
        let report = graphics.draw(state, &input, &ui, &self.assets, self.config)?;
        self.last_presented = report.presented;
        if report.presented {
            let now = Instant::now();
            if let Some(previous) = self.previous_present {
                if self.frame_intervals.len() < 4096 {
                    self.frame_intervals
                        .push(now.duration_since(previous).as_micros() as u64);
                }
            }
            self.previous_present = Some(now);
            self.frame_count += 1;
            if !self.first_present {
                self.first_present = true;
                println!("{}", serde_json::json!({"event":"ready"}));
                println!(
                    "{}",
                    serde_json::json!({"event":"renderer_first_present","elapsed_ms":self.started.elapsed().as_millis(),"assets_cache_hit":self.assets.cache_hit})
                );
            }
            if !self.first_world && report.drawn_sections > 0 {
                self.first_world = true;
                println!(
                    "{}",
                    serde_json::json!({"event":"first_world_present","elapsed_ms":self.started.elapsed().as_millis(),"sections":report.drawn_sections})
                );
            }
        }
        if self.last_metrics.elapsed() >= Duration::from_secs(5) {
            let elapsed = self.last_metrics.elapsed().as_secs_f64();
            println!(
                "{}",
                serde_json::json!({"event":"renderer_metrics","frames":self.frame_count,
                "interval_ms":(elapsed*1000.0) as u64,"fps":(self.frame_count as f64/elapsed).round(),
                "meshing_cpu_us":self.mesh_us,"uploaded_bytes":self.uploaded_bytes,
                "resident_sections":graphics.sections.len(),"visible_sections":report.drawn_sections,
                "resident_geometry_bytes":graphics.geometry_bytes,
                "weather_instances":graphics.weather.instances(),"weather_buffer_bytes":graphics.weather.allocated_bytes(),"pending_sections":self.pending.len(),
                "geometry_limited":graphics.limited,"entities":graphics.mobs.take_metrics(),
                "frame_intervals": timing_summary(&mut self.frame_intervals),"ui":graphics.ui_metrics.take(),
                "window":[graphics.size.width,graphics.size.height],"gui_scale":GuiMetrics::new(graphics.size,self.ui_options.gui_scale).scale,"paused":self.paused,"inventory_open":state.inventory.open})
            );
            self.frame_count = 0;
            self.mesh_us = 0;
            self.uploaded_bytes = 0;
            self.last_metrics = Instant::now();
        }
        let title = format!(
            "Sakura · {}{}",
            state.status,
            if graphics.limited {
                " · geometry budget reached"
            } else {
                ""
            }
        );
        if self.title != title {
            if let Some(window) = &self.window {
                window.set_title(&title);
            }
            self.title = title;
        }
        Ok(())
    }
    fn queue_inventory(&mut self, action: InventoryAction) {
        let accepted = self
            .input
            .lock()
            .map(|mut input| input.queue_inventory(action.clone()))
            .unwrap_or(false);
        if accepted {
            self.inventory
                .queued(&self.frame_state.inventory, &action.kind, Instant::now());
            self.chat_input = None;
            self.release_pointer();
        } else {
            self.inventory.cancel_pointer();
        }
    }
    fn press(&mut self, key: KeyCode) {
        if key==KeyCode::F3 && self.captured {if let Ok(mut i)=self.input.lock(){i.light_debug=(i.light_debug+1)%6;}return;}
        if key == KeyCode::F1 && self.captured { if let Ok(mut input)=self.input.lock(){input.hide_hud=!input.hide_hud;} return; }
        self.inventory.cancel_sort();
        let hotbar = if key == KeyCode::KeyF && self.frame_state.inventory.open { Some(40) } else { hotbar_key(key) };
        if self.inventory.active(&self.frame_state.inventory) {
            if self.inventory.text_focused() && key != KeyCode::Escape {
                if key == KeyCode::Backspace {
                    self.inventory.backspace();
                }
                return;
            }
            if matches!(key, KeyCode::Escape | KeyCode::KeyE) {
                if key == KeyCode::Escape {
                    if let Some(g) = &self.graphics {
                        if self
                            .inventory
                            .dismiss_overlay(GuiMetrics::new(g.size, self.ui_options.gui_scale))
                        {
                            return;
                        }
                    }
                }
                if let Some(action) = self.inventory.request_close(&self.frame_state.inventory) {
                    self.queue_inventory(action);
                }
            } else if !self.inventory.busy() {
                if let Some(graphics) = &self.graphics {
                    let metrics = GuiMetrics::new(graphics.size, self.ui_options.gui_scale);
                    if let Some(action) = self.inventory.key_action(
                        &self.frame_state.inventory,
                        metrics,
                        metrics.pointer(self.cursor),
                        hotbar,
                        key == KeyCode::KeyQ,
                        self.control_down,
                    ) {
                        self.queue_inventory(action);
                    }
                }
            }
            return;
        }
        if key == KeyCode::Escape {
            if self.settings {
                self.finish_volume();
                self.settings = false;
                self.menu_focus = None;
                return;
            }
            if self.chat_input.take().is_some() {
                self.capture_pointer();
            } else if self.captured {
                self.paused = true;
                self.release_pointer();
            } else {
                self.capture_pointer();
            }
            return;
        }
        if self.paused || self.frame_state.health <= 0. {
            if self.settings
                && self.menu_focus == Some(1)
                && matches!(key, KeyCode::ArrowLeft | KeyCode::ArrowRight)
            {
                self.ui_options.volume = (self.ui_options.volume
                    + if key == KeyCode::ArrowRight {
                        0.01
                    } else {
                        -0.01
                    })
                .clamp(0., 1.);
                let _ = self.ui_options.save();
                return;
            }
            if key == KeyCode::Tab {
                let count = if self.frame_state.health <= 0. { 2 } else if self.settings {5} else { 3 };
                self.menu_focus = Some(self.menu_focus.map_or(0, |v| {
                    if self.shift_down {
                        (v + count - 1) % count
                    } else {
                        (v + 1) % count
                    }
                }));
            }
            if matches!(key, KeyCode::Enter | KeyCode::NumpadEnter | KeyCode::Space) {
                if let Some(index) = self.menu_focus {
                    self.activate_menu(index);
                }
            }
            return;
        }
        if self.chat_input.is_some() {
            match key {
                KeyCode::Backspace => {
                    self.chat_input.as_mut().unwrap().pop();
                }
                KeyCode::Enter | KeyCode::NumpadEnter => {
                    let text = self.chat_input.as_ref().unwrap().trim().to_string();
                    let accepted = if let Ok(mut input) = self.input.lock() {
                        if input.chat_submit.is_none() {
                            if !text.is_empty() {
                                input.chat_submit = Some(text);
                            }
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    };
                    if accepted {
                        self.chat_input = None;
                        self.capture_pointer();
                    }
                }
                _ => {}
            }
            return;
        }
        if key == KeyCode::KeyE
            && self.captured
            && self.frame_state.connected
            && self.frame_state.health > 0.
        {
            self.queue_inventory(inventory_ui::action(
                &self.frame_state.inventory,
                InventoryActionKind::OpenPlayer,
            ));
            return;
        }
        if self.captured && matches!(key, KeyCode::KeyT | KeyCode::Slash) {
            self.chat_input = Some(if key == KeyCode::Slash {
                "/".into()
            } else {
                String::new()
            });
            self.release_pointer();
            return;
        }
        if self.captured {
            if let Some(slot) = hotbar {
                if let Ok(mut input) = self.input.lock() {
                    input.hotbar = slot;
                }
            }
            if !self.keys.contains(&key) {
                let now=Instant::now();
                if key==KeyCode::KeyW && !self.keys.contains(&KeyCode::ShiftLeft) && !self.keys.contains(&KeyCode::ShiftRight) && self.forward_tap.press(now) {
                    if let Ok(mut i)=self.input.lock(){i.sprint_tap=i.sprint_tap.wrapping_add(1);}
                }
                if key==KeyCode::Space && self.jump_tap.press(now) {
                    if let Ok(mut i)=self.input.lock(){i.fly_tap=i.fly_tap.wrapping_add(1);}
                }
            }
            self.keys.insert(key);
            self.update_input();
        }
    }
}

impl ApplicationHandler for Viewer {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let window = match event_loop.create_window(
            Window::default_attributes()
                .with_title("Sakura · Connecting")
                .with_inner_size(LogicalSize::new(1100.0, 720.0)),
        ) {
            Ok(window) => Arc::new(window),
            Err(e) => {
                self.fail(event_loop, format!("Cannot create Sakura's window: {e}"));
                return;
            }
        };
        match pollster::block_on(Graphics::new(window.clone(), &self.assets, self.config)) {
            Ok(graphics) => {
                self.window = Some(window);
                self.graphics = Some(graphics);
            }
            Err(e) => self.fail(event_loop, e),
        }
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => {
                self.stop.store(true, Ordering::Release);
                self.release_pointer();
                event_loop.exit();
            }
            WindowEvent::Resized(size) => {
                if let Some(g) = &mut self.graphics {
                    g.resize(size);
                }
            }
            WindowEvent::Occluded(value) => {
                self.occluded = value;
                self.previous_present = None;
                if value {
                    self.release_pointer();
                }
            }
            WindowEvent::Focused(focused) => {
                self.focused = focused;
                if !focused {
                    self.finish_volume();
                    self.inventory.cancel_pointer();
                    if !self.inventory.active(&self.frame_state.inventory) {
                        self.paused = true;
                    }
                    self.shift_down = false;
                    self.control_down = false;
                    self.release_pointer();
                }
            }
            WindowEvent::ModifiersChanged(modifiers) => {
                self.shift_down = modifiers.state().shift_key();
                self.control_down = modifiers.state().control_key();
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.cursor = [position.x as f32, position.y as f32];
                if self.volume_drag {
                    self.drag_volume();
                }
                self.menu_focus = None;
                if let Some(graphics) = &self.graphics {
                    let metrics = GuiMetrics::new(graphics.size, self.ui_options.gui_scale);
                    let actions = self.inventory.pointer_move(
                        &self.frame_state.inventory,
                        metrics,
                        metrics.pointer(self.cursor),
                    );
                    for action in actions {
                        self.queue_inventory(action);
                    }
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let PhysicalKey::Code(code) = event.physical_key else {
                    return;
                };
                if event.state == ElementState::Pressed {
                    let was_chat = self.chat_input.is_some();
                    let was_search = self.inventory.text_focused();
                    if !event.repeat
                        || was_chat
                        || was_search
                        || self.settings && matches!(code, KeyCode::ArrowLeft | KeyCode::ArrowRight)
                    {
                        self.press(code);
                    }
                    if was_search
                        && !matches!(
                            code,
                            KeyCode::Escape
                                | KeyCode::Backspace
                                | KeyCode::Enter
                                | KeyCode::NumpadEnter
                        )
                    {
                        if let Some(text) = &event.text {
                            self.inventory.input_text(text);
                        }
                    }
                    if was_chat
                        && !matches!(
                            code,
                            KeyCode::Enter
                                | KeyCode::NumpadEnter
                                | KeyCode::Escape
                                | KeyCode::Backspace
                        )
                    {
                        if let (Some(buffer), Some(text)) = (&mut self.chat_input, event.text) {
                            for ch in text.chars().filter(|c| !c.is_control()) {
                                if buffer.chars().count() < 256 {
                                    buffer.push(ch);
                                }
                            }
                        }
                    }
                } else {
                    self.keys.remove(&code);
                    self.update_input();
                }
            }
            WindowEvent::MouseWheel { delta, .. } if self.frame_state.inventory.open => {
                self.inventory.cancel_sort();
                let amount=match delta { MouseScrollDelta::LineDelta(_,y)=>y,MouseScrollDelta::PixelDelta(p)=>p.y as f32/40. };
                self.wheel_remainder+=amount;
                if self.wheel_remainder.abs()>=1. && !self.inventory.text_focused() && !self.inventory.busy() {
                    self.wheel_remainder=0.;
                    if let Some(g)=&self.graphics {
                        let m=GuiMetrics::new(g.size,self.ui_options.gui_scale);
                        if self.inventory.panel_visible(&self.frame_state.inventory,m) {
                            if let Some(slot)=self.inventory.layout(&self.frame_state.inventory,m).hovered(&self.frame_state.inventory,m.pointer(self.cursor)) {
                                if self.frame_state.inventory.slots.iter().any(|s|s.index==slot && matches!(s.role,crate::shared::InventorySlotRole::Player|crate::shared::InventorySlotRole::Hotbar|crate::shared::InventorySlotRole::Storage)) {
                                    self.queue_inventory(InventoryAction{menu_id:self.frame_state.inventory.menu_id,epoch:self.frame_state.inventory.epoch,kind:InventoryActionKind::QuickMove{slot}});
                                }
                            }
                        }
                    }
                }
            }
            WindowEvent::MouseWheel { delta, .. } if self.captured => {
                self.wheel_remainder += match delta {
                    MouseScrollDelta::LineDelta(_, y) => y,
                    MouseScrollDelta::PixelDelta(p) => p.y as f32 / 40.0,
                };
                let steps = self.wheel_remainder.trunc() as i32;
                self.wheel_remainder -= steps as f32;
                if steps != 0 {
                    if let Ok(mut input) = self.input.lock() {
                        input.hotbar = (i32::from(input.hotbar) - steps).rem_euclid(9) as u8;
                    }
                }
            }
            WindowEvent::MouseInput { state, button, .. } => {
                if state == ElementState::Pressed {
                    self.inventory.cancel_sort();
                    if button==MouseButton::Middle && self.frame_state.inventory.open {
                        if let Some(g)=&self.graphics {let m=GuiMetrics::new(g.size,self.ui_options.gui_scale);self.inventory.start_sort(&self.frame_state.inventory,m,m.pointer(self.cursor));}
                        return;
                    }
                }

                if button == MouseButton::Left
                    && state == ElementState::Released
                    && self.volume_drag
                {
                    self.finish_volume();
                    return;
                }
                if self.inventory.active(&self.frame_state.inventory) {
                    if matches!(button, MouseButton::Left | MouseButton::Right) {
                        if let Some(graphics) = &self.graphics {
                            let metrics = GuiMetrics::new(graphics.size, self.ui_options.gui_scale);
                            let button_activations = self.inventory.button_activations();
                            let actions = if state == ElementState::Pressed {
                                self.inventory.pointer_down(
                                    &self.frame_state.inventory,
                                    metrics,
                                    metrics.pointer(self.cursor),
                                    button == MouseButton::Right,
                                    self.shift_down,
                                    Instant::now(),
                                )
                            } else {
                                self.inventory.pointer_up(
                                    &self.frame_state.inventory,
                                    metrics,
                                    metrics.pointer(self.cursor),
                                    button == MouseButton::Right,
                                )
                            };
                            if self.inventory.button_activations() != button_activations {
                                self.audio.click(self.ui_options.volume);
                            }
                            for action in actions {
                                self.queue_inventory(action);
                            }
                        }
                    }
                } else if self.captured {
                    if let Ok(mut input) = self.input.lock() {
                        if button == MouseButton::Left {
                            input.attack = state == ElementState::Pressed;
                        }
                        if button == MouseButton::Right && state == ElementState::Pressed {
                            input.use_item = input.use_item.wrapping_add(1);
                        }
                    }
                } else if state == ElementState::Pressed
                    && button == MouseButton::Left
                    && self.chat_input.is_none()
                {
                    let dead = self
                        .scene
                        .lock()
                        .map(|s| s.connected && s.health <= 0.0)
                        .unwrap_or(false);
                    if let Some(g) = &self.graphics {
                        let metrics = GuiMetrics::new(g.size, self.ui_options.gui_scale);
                        if self.paused || dead {
                            let buttons = java_hud::menu_buttons(
                                metrics,
                                dead,
                                self.settings,
                                self.ui_options.gui_scale,
                                self.ui_options.volume,
                                self.ui_options.brightness,
                self.ui_options.smooth_lighting,
                            );
                            if let Some(index) = buttons
                                .iter()
                                .position(|(rect, _)| inside(metrics.pointer(self.cursor), *rect))
                            {
                                if self.settings && index == 1 {
                                    self.volume_drag = true;
                                    self.menu_focus = Some(1);
                                    self.drag_volume();
                                } else {
                                    self.activate_menu(index);
                                }
                            }
                        } else {
                            self.capture_pointer();
                        }
                    }
                }
            }
            WindowEvent::RedrawRequested => {
                let frame_started = Instant::now();
                if self.stop.load(Ordering::Acquire) {
                    self.release_pointer();
                    event_loop.exit();
                    return;
                }
                if !self.occluded {
                    if let Err(error) = self.frame() {
                        self.fail(event_loop, error);
                    }
                }
                self.next_frame = frame_started
                    + if !self.last_presented {
                        Duration::from_millis(50)
                    } else if self.config.fps_limit == 0 {
                        Duration::ZERO
                    } else {
                        Duration::from_secs_f64(1.0 / self.config.fps_limit.clamp(15, 1000) as f64)
                    };
            }
            _ => {}
        }
    }
    fn device_event(&mut self, _: &ActiveEventLoop, _: DeviceId, event: DeviceEvent) {
        if let DeviceEvent::MouseMotion { delta } = event {
            if self.captured {
                if let Ok(mut input) = self.input.lock() {
                    input.yaw = (input.yaw + delta.0 as f32 * 0.13).rem_euclid(360.0);
                    input.pitch = (input.pitch + delta.1 as f32 * 0.13).clamp(-89.9, 89.9);
                }
            }
        }
    }
    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.stop.load(Ordering::Acquire) {
            self.release_pointer();
            event_loop.exit();
            return;
        }
        let minimized = self.occluded
            || self
                .graphics
                .as_ref()
                .is_some_and(|g| g.size.width == 0 || g.size.height == 0);
        if minimized {
            event_loop.set_control_flow(ControlFlow::WaitUntil(
                Instant::now() + Duration::from_millis(250),
            ));
        } else if let Some(window) = &self.window {
            if Instant::now() >= self.next_frame {
                window.request_redraw();
            }
            event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_frame));
        }
    }
}

fn hotbar_key(key: KeyCode) -> Option<u8> {
    match key {
        KeyCode::Digit1 => Some(0),
        KeyCode::Digit2 => Some(1),
        KeyCode::Digit3 => Some(2),
        KeyCode::Digit4 => Some(3),
        KeyCode::Digit5 => Some(4),
        KeyCode::Digit6 => Some(5),
        KeyCode::Digit7 => Some(6),
        KeyCode::Digit8 => Some(7),
        KeyCode::Digit9 => Some(8),
        _ => None,
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
struct Vertex {
    position: [f32; 3],
    uv: [f32; 2],
    layer: u32,
    color: [f32; 3],
    light: [f32; 2],
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct HudVertex {
    position: [f32; 2],
    uv: [f32; 2],
    layer: u32,
    color: [f32; 4],
}
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct CameraUniform {
    view_projection: [[f32; 4]; 4],
    eye: [f32; 4],
    origin: [i32; 4],
    viewport: [f32; 4],
    glint: [f32; 4],
    fog: [f32;4],
    fog_range: [f32;4],
    lightmap: [[f32;4];256],
}

#[derive(Default)]
struct Geometry {
    vertices: Vec<Vertex>,
    indices: Vec<u32>,
}
impl Geometry {
    fn bytes(&self) -> usize {
        self.vertices.len() * std::mem::size_of::<Vertex>() + self.indices.len() * 4
    }
    fn quad(&mut self, quad: &BakedQuad, offset: [f32; 3], light: [[f32;3];4]) {
        let base = self.vertices.len() as u32;
        for i in 0..4 {
            self.vertices.push(Vertex {
                position: std::array::from_fn(|a| quad.positions[i][a] + offset[a]),
                uv: quad.uv[i],
                layer: quad.layer,
                color: quad.tint.map(|v| v * light[i][2]),
                light: [light[i][0],light[i][1]],
            });
        }
        self.indices
            .extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
    }
}
struct MeshRequest {
    smooth: bool,
    epoch: u64,
    section: Arc<SectionSnapshot>,
}
struct MeshResult {
    smooth: bool,
    epoch: u64,
    position: [i32; 3],
    revision: u64,
    opaque: Geometry,
    translucent: Geometry,
    limited: bool,
    mesh_us: u64,
}
impl MeshResult {
    fn bytes(&self) -> usize {
        self.opaque.bytes() + self.translucent.bytes()
    }
}
struct MeshWorker {
    requests: SyncSender<MeshRequest>,
    results: Receiver<MeshResult>,
}
impl MeshWorker {
    fn new(assets: Arc<AssetPack>) -> Result<Self, String> {
        let (requests, receiver) = mpsc::sync_channel::<MeshRequest>(4);
        let receiver = Arc::new(Mutex::new(receiver));
        let (sender, results) = mpsc::sync_channel(4);
        for n in 0..2 {
            let receiver = receiver.clone();
            let sender = sender.clone();
            let assets = assets.clone();
            std::thread::Builder::new()
                .name(format!("sakura-section-mesh-{n}"))
                .spawn(move || {
                    loop {
                        let request = match receiver.lock() {
                            Ok(r) => r.recv(),
                            Err(_) => break,
                        };
                        let Ok(request) = request else { break };
                        if sender.send(mesh_section(request, &assets)).is_err() {
                            break;
                        }
                    }
                })
                .map_err(|e| format!("Cannot start section meshing worker: {e}"))?;
        }
        Ok(Self { requests, results })
    }
}
fn halo(x: usize, y: usize, z: usize) -> usize {
    x + 18 * (z + 18 * y)
}
#[derive(Clone, Copy, PartialEq, Eq)]
struct MergeCell {
    tint: [u32;3],
    state: u32,
    quad: u16,
    light: [u32;3],
}
fn mergeable_cube(model: &crate::assets::BlockModel) -> bool {
    model.opaque_full_cube
        && model.quads.len() == 6
        && model.quads.iter().all(|q| {
            q.render_layer == RenderLayer::Opaque
                && q.cull_face.is_some()
                && q.positions.iter().flatten().all(|p| *p == 0. || *p == 1.)
                && q.uv.iter().flatten().all(|v| *v == 0. || *v == 1.)
                && (0..3)
                    .filter(|a| q.positions[0][*a] != q.positions[1][*a])
                    .count()
                    == 1
                && (0..3)
                    .filter(|a| q.positions[0][*a] != q.positions[3][*a])
                    .count()
                    == 1
                && (0..2).filter(|a| q.uv[0][*a] != q.uv[1][*a]).count() == 1
                && (0..2).filter(|a| q.uv[0][*a] != q.uv[3][*a]).count() == 1
        })
}
fn face_axes(face: Face) -> (usize, usize, usize) {
    match face {
        Face::East | Face::West => (0, 2, 1),
        Face::Up | Face::Down => (1, 0, 2),
        Face::South | Face::North => (2, 0, 1),
    }
}
fn quad_light(packed:u8, face:Option<Face>)->[f32;3] {
    let shade=match face {Some(Face::Up)=>1.,Some(Face::Down)=>0.5,Some(Face::East|Face::West)=>0.6,_=>0.8};
    [(packed&15) as f32,(packed>>4) as f32,shade]
}
/// Corner light and AO are separate from the authoritative two-channel arrays.
fn corner_light(s:&SectionSnapshot, _assets:&AssetPack, xyz:[usize;3], q:&BakedQuad, smooth:bool)->[[f32;3];4] {
    let face=q.cull_face.unwrap_or_else(||{
        let a=Vec3::from_array(q.positions[1])-Vec3::from_array(q.positions[0]);
        let b=Vec3::from_array(q.positions[3])-Vec3::from_array(q.positions[0]);let n=a.cross(b);
        if n.x.abs()>n.y.abs() && n.x.abs()>n.z.abs(){if n.x>0.{Face::East}else{Face::West}}
        else if n.y.abs()>n.z.abs(){if n.y>0.{Face::Up}else{Face::Down}}else if n.z>0.{Face::South}else{Face::North}
    });
    let (normal,u,v)=face_axes(face);let delta=face.offset();
    let exterior=q.positions.iter().all(|p|if delta[normal]>0 {p[normal]>=0.999}else{p[normal]<=0.001});
    let base: [i32;3]=std::array::from_fn(|i|xyz[i] as i32+if exterior{delta[i]}else{0});
    let idx=|p:[i32;3]|halo(p[0].clamp(0,17) as usize,p[1].clamp(0,17) as usize,p[2].clamp(0,17) as usize);
    let base_i=idx(base);let packed=s.light.get(base_i).copied().unwrap_or(0);
    let flat=quad_light(packed,Some(face));
    if !smooth || !q.ambient_occlusion || !q.shade || crate::light_properties::get(s.blocks[halo(xyz[0],xyz[1],xyz[2])]).emission()>0 {return [[flat[0],flat[1],if q.shade {flat[2]}else{1.}];4];}
    let occludes=|p|crate::light_properties::get(s.blocks[idx(p)]).solid();
    let corners: [[f32;3];4]=std::array::from_fn(|corner|{
        let mut a=base;let mut b=base;let mut c=base;
        let du=if corner&1==0{-1}else{1};let dv=if corner&2==0{-1}else{1};
        a[u]+=du;b[v]+=dv;c[u]+=du;c[v]+=dv;
        let blocked_a=occludes(a);let blocked_b=occludes(b);
        if blocked_a && blocked_b {c=a;}
        let points=[base,a,b,c];let mut sum=[0.;2];let mut weights=[0.;2];let mut ao=0.;
        for p in points {let i=idx(p);let known=s.light_known.get(i).copied().unwrap_or(0);let l=s.light[i];
            for channel in 0..2 {if known&(1<<channel)!=0 {sum[channel]+=if channel==0 {(l&15) as f32}else{(l>>4) as f32};weights[channel]+=1.;}}
            ao+=crate::light_properties::get(s.blocks[i]).ao();
        }
        [if weights[0]>0.{sum[0]/weights[0]}else{flat[0]},if weights[1]>0.{sum[1]/weights[1]}else{flat[1]},ao*0.25*flat[2]]
    });
    q.positions.map(|p| {let u=p[u].clamp(0.,1.);let v=p[v].clamp(0.,1.);std::array::from_fn(|i|corners[0][i]*(1.-u)*(1.-v)+corners[1][i]*u*(1.-v)+corners[2][i]*(1.-u)*v+corners[3][i]*u*v)})
}
fn biome_tint(tint:[f32;3],palette:&[[[f32;3];3]],pos:[usize;3])->[f32;3] {
    if palette.len()!=216 {return tint;}
    let rgb=|v:u32|[(v>>16&255) as f32/255.,(v>>8&255) as f32/255.,(v&255) as f32/255.];
    let kind=if tint==rgb(0x91bd59){0}else if tint==rgb(0x77ab2f){1}else if tint==rgb(0x3f76e4){2}else{return tint};
    // Trilinear quart sampling has bounded cost and no visible section seams.
    let q=pos.map(|v|(v as f32+0.5)/4.+0.5);let b=q.map(|v|v.floor() as usize);let t=q.map(|v|v-v.floor());
    let mut out=[0.;3];
    for y in 0..2 {for z in 0..2 {for x in 0..2 {
        let w=(if x==0{1.-t[0]}else{t[0]})*(if y==0{1.-t[1]}else{t[1]})*(if z==0{1.-t[2]}else{t[2]});
        let c=palette[(b[0]+x)+6*((b[2]+z)+6*(b[1]+y))][kind];
        for i in 0..3 {out[i]+=c[i]*w;}
    }}}
    out.map(|v|(v*255.).round()/255.)
}
fn mesh_section(request: MeshRequest, assets: &AssetPack) -> MeshResult {
    let started = Instant::now();
    let s = &request.section;
    let mut out = MeshResult {
        smooth: request.smooth,
        epoch: request.epoch,
        position: s.position,
        revision: s.revision,
        opaque: Geometry::default(),
        translucent: Geometry::default(),
        limited: false,
        mesh_us: 0,
    };
    if s.blocks.len() != 18 * 18 * 18 {
        return out;
    }
    let palette:Vec<_>=s.biomes.iter().map(|b|b.palette(&assets.biome_colormaps)).collect();
    let mut quads = 0;
    let mut eligible = HashMap::<u32, bool>::new();
    let mut masks: Vec<Option<MergeCell>> = Vec::new();
    'blocks: for y in 1..=16 {
        for z in 1..=16 {
            for x in 1..=16 {
                let state = s.blocks[halo(x, y, z)];
                let Some(model) = assets.models.get(state as usize) else {
                    continue;
                };
                if model.quads.is_empty() {
                    continue;
                }
                let mergeable = *eligible
                    .entry(state)
                    .or_insert_with(|| mergeable_cube(model));
                let stacked_fluid = matches!(model.cull_group, 1 | 2)
                    && assets
                        .models
                        .get(s.blocks[halo(x, y + 1, z)] as usize)
                        .is_some_and(|above| above.cull_group == model.cull_group);
                for (quad_index, quad) in model.quads.iter().enumerate() {
                    if let Some(face) = quad.cull_face {
                        let d = face.offset();
                        let light_index = halo(
                            (x as i32 + d[0]) as usize,
                            (y as i32 + d[1]) as usize,
                            (z as i32 + d[2]) as usize,
                        );
                        if let Some(neighbor) = assets.models.get(s.blocks[light_index] as usize) {
                            if neighbor.opaque_full_cube
                                || (model.cull_group != 0
                                    && model.cull_group == neighbor.cull_group)
                            {
                                continue;
                            }
                        }
                    }
                    let light=corner_light(s,assets,[x,y,z],quad,request.smooth);
                    let tinted=biome_tint(quad.tint,&palette,[x-1,y-1,z-1]);
                    if mergeable && light.iter().all(|v|*v==light[0]) {
                        let face = quad.cull_face.unwrap();
                        let (normal, u, v) = face_axes(face);
                        let pos = [x - 1, y - 1, z - 1];
                        if masks.is_empty() {
                            masks.resize(6 * 4096, None)
                        }
                        masks[face as usize * 4096 + pos[normal] * 256 + pos[v] * 16 + pos[u]] =
                            Some(MergeCell {
                                state,
                                quad: quad_index as u16,
                                tint:tinted.map(f32::to_bits),
                                light: light[0].map(f32::to_bits),
                            });
                        continue;
                    }
                    if quads >= MAX_QUADS_PER_SECTION {
                        out.limited = true;
                        break 'blocks;
                    }
                    quads += 1;

                    let geometry = if quad.render_layer == RenderLayer::Translucent {
                        &mut out.translucent
                    } else {
                        &mut out.opaque
                    };
                    let mut colored=quad.clone();colored.tint=tinted;let quad=&colored;
                    if stacked_fluid {
                        let mut full = quad.clone();
                        for p in &mut full.positions {
                            if p[1] > 0. {
                                p[1] = 1.
                            }
                        }
                        geometry.quad(
                            &full,
                            [(x - 1) as f32, (y - 1) as f32, (z - 1) as f32],
                            light,
                        );
                    } else {
                        geometry.quad(
                            quad,
                            [(x - 1) as f32, (y - 1) as f32, (z - 1) as f32],
                            light,
                        );
                    }
                }
            }
        }
    }
    if !masks.is_empty() {
        'merge: for face in [
            Face::East,
            Face::West,
            Face::Up,
            Face::Down,
            Face::South,
            Face::North,
        ] {
            let (normal, u_axis, v_axis) = face_axes(face);
            for plane in 0..16 {
                for v in 0..16 {
                    for u in 0..16 {
                        let base = face as usize * 4096 + plane * 256;
                        let Some(cell) = masks[base + v * 16 + u] else {
                            continue;
                        };
                        let mut width = 1;
                        while u + width < 16 && masks[base + v * 16 + u + width] == Some(cell) {
                            width += 1
                        }
                        let mut height = 1;
                        while v + height < 16
                            && (0..width)
                                .all(|dx| masks[base + (v + height) * 16 + u + dx] == Some(cell))
                        {
                            height += 1
                        }
                        for dy in 0..height {
                            for dx in 0..width {
                                masks[base + (v + dy) * 16 + u + dx] = None;
                            }
                        }
                        if quads >= MAX_QUADS_PER_SECTION {
                            out.limited = true;
                            break 'merge;
                        }
                        quads += 1;
                        let source = &assets.models[cell.state as usize].quads[cell.quad as usize];
                        let mut quad = source.clone();
                        quad.tint=cell.tint.map(f32::from_bits);
                        let mut offset = [0.; 3];
                        offset[normal] = plane as f32;
                        offset[u_axis] = u as f32;
                        offset[v_axis] = v as f32;
                        let mut scale = [1.; 3];
                        scale[u_axis] = width as f32;
                        scale[v_axis] = height as f32;
                        for p in &mut quad.positions {
                            for a in 0..3 {
                                p[a] *= scale[a];
                            }
                        }
                        let edge1 = (0..3)
                            .find(|a| source.positions[1][*a] != source.positions[0][*a])
                            .unwrap();
                        let edge3 = (0..3)
                            .find(|a| source.positions[3][*a] != source.positions[0][*a])
                            .unwrap();
                        for a in 0..2 {
                            quad.uv[1][a] = source.uv[0][a]
                                + (source.uv[1][a] - source.uv[0][a]) * scale[edge1];
                            quad.uv[3][a] = source.uv[0][a]
                                + (source.uv[3][a] - source.uv[0][a]) * scale[edge3];
                            quad.uv[2][a] = quad.uv[1][a] + quad.uv[3][a] - quad.uv[0][a];
                        }
                        out.opaque
                            .quad(&quad, offset, [cell.light.map(f32::from_bits);4]);
                    }
                }
            }
        }
    }
    out.mesh_us = started.elapsed().as_micros() as u64;
    out
}

#[derive(Default)]
struct GpuGeometry {
    vertices: Option<wgpu::Buffer>,
    indices: Option<wgpu::Buffer>,
    vertex_capacity: u64,
    index_capacity: u64,
    index_count: u32,
}
impl GpuGeometry {
    fn allocated(&self) -> u64 {
        self.vertex_capacity + self.index_capacity
    }
    fn upload(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, geometry: &Geometry) {
        self.index_count = geometry.indices.len() as u32;
        write_buffer(
            device,
            queue,
            &mut self.vertices,
            &mut self.vertex_capacity,
            bytemuck::cast_slice(&geometry.vertices),
            wgpu::BufferUsages::VERTEX,
            "Section vertices",
        );
        write_buffer(
            device,
            queue,
            &mut self.indices,
            &mut self.index_capacity,
            bytemuck::cast_slice(&geometry.indices),
            wgpu::BufferUsages::INDEX,
            "Section indices",
        );
    }
    fn draw<'a>(&'a self, pass: &mut wgpu::RenderPass<'a>) {
        if self.index_count == 0 {
            return;
        }
        if let (Some(vertices), Some(indices)) = (&self.vertices, &self.indices) {
            pass.set_vertex_buffer(0, vertices.slice(..));
            pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.index_count, 0, 0..1);
        }
    }
}
fn write_buffer(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    buffer: &mut Option<wgpu::Buffer>,
    capacity: &mut u64,
    bytes: &[u8],
    usage: wgpu::BufferUsages,
    label: &str,
) {
    if bytes.is_empty() {
        return;
    }
    if bytes.len() as u64 > *capacity {
        *capacity = (bytes.len() as u64).next_power_of_two().max(256);
        *buffer = Some(device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size: *capacity,
            usage: usage | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));
    }
    queue.write_buffer(buffer.as_ref().unwrap(), 0, bytes);
}
struct GpuSection {
    smooth: bool,
    revision: u64,
    slot: u32,
    opaque: GpuGeometry,
    translucent: GpuGeometry,
}
impl GpuSection {
    fn allocated(&self) -> u64 {
        self.opaque.allocated() + self.translucent.allocated()
    }
}
struct DrawReport {
    presented: bool,
    drawn_sections: usize,
}
struct Graphics {
    instance: wgpu::Instance,
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    size: PhysicalSize<u32>,
    opaque_pipeline: wgpu::RenderPipeline,
    translucent_pipeline: wgpu::RenderPipeline,
    hud_pipeline: wgpu::RenderPipeline,
    gui_pipeline: wgpu::RenderPipeline,
    gui_texture: wgpu::Texture,
    gui_group: wgpu::BindGroup,
    player_preview: player_preview::PlayerPreview,
    menu_blur: Option<menu_blur::MenuBlur>,
    line_pipeline: wgpu::RenderPipeline,
    camera: wgpu::Buffer,
    camera_group: wgpu::BindGroup,
    textures_group: wgpu::BindGroup,
    skin_group: Option<wgpu::BindGroup>,
    portrait_skin: Option<wgpu::BindGroup>,
    portrait_source: Option<Arc<crate::shared::PlayerSkin>>,
    section_uniforms: wgpu::Buffer,
    section_group: wgpu::BindGroup,
    section_stride: u32,
    free_slots: Vec<u32>,
    sections: HashMap<[i32; 3], GpuSection>,
    geometry_bytes: u64,
    rejected: HashMap<[i32; 3], u64>,
    depth: wgpu::TextureView,
    entities: GpuGeometry,
    mobs: entities::MobRenderer,
    weather: weather::WeatherRenderer,
    camera_eye_height:f32,
    camera_fov:f32,
    camera_updated:Instant,
    lightning_pipeline: wgpu::RenderPipeline,
    lightning: Option<wgpu::Buffer>,
    lightning_capacity: u64,
    lightning_vertices: Vec<Vertex>,
    lines: Option<wgpu::Buffer>,
    lines_capacity: u64,
    hud: Option<wgpu::Buffer>,
    hud_capacity: u64,
    labels: Option<wgpu::Buffer>,
    labels_capacity: u64,
    hud_key: Option<u64>,
    hud_count: u32,
    overlay_start: u32,
    limited: bool,
    error: Arc<Mutex<Option<String>>>,
    ui_metrics: UiMetrics,
    lightmap_inputs: Option<crate::lighting::LightmapInputs>,
    lightmap_table: [[f32;4];256],
    lightmap_tick: u64,
    light_effects: crate::lighting::VisualEffects,
}

impl Graphics {
    async fn new(
        window: Arc<Window>,
        assets: &AssetPack,
        settings: RendererConfig,
    ) -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_with_display_handle(
            Box::new(window.clone()),
        ));
        let surface = instance
            .create_surface(window.clone())
            .map_err(|e| e.to_string())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
                ..Default::default()
            })
            .await
            .map_err(|e| format!("No compatible GPU: {e}"))?;
        let supported = adapter.limits();
        if assets.texture_layers == 0 || assets.texture_layers > supported.max_texture_array_layers
        {
            return Err(format!(
                "This GPU supports {} texture layers; the Minecraft assets need {}.",
                supported.max_texture_array_layers, assets.texture_layers
            ));
        }
        let limits = wgpu::Limits {
            max_texture_array_layers: assets.texture_layers.max(256),
            ..Default::default()
        };
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("Sakura"),
                required_limits: limits,
                ..Default::default()
            })
            .await
            .map_err(|e| format!("Cannot initialize GPU: {e}"))?;
        let error = Arc::new(Mutex::new(None));
        let errors = error.clone();
        device.on_uncaptured_error(Arc::new(move |e: wgpu::Error| {
            if let Ok(mut slot) = errors.lock() {
                if slot.is_none() {
                    *slot = Some(format!("GPU error: {e}"));
                }
            }
        }));
        let errors = error.clone();
        device.set_device_lost_callback(move |reason, message| {
            if reason != wgpu::DeviceLostReason::Destroyed {
                if let Ok(mut slot) = errors.lock() {
                    if slot.is_none() {
                        *slot = Some(format!("Graphics device lost: {message}"));
                    }
                }
            }
        });
        let size = window.inner_size();
        let mut config = surface
            .get_default_config(&adapter, size.width.max(1), size.height.max(1))
            .ok_or("GPU cannot present to this window")?;
        if let Some(format) = surface
            .get_capabilities(&adapter)
            .formats
            .iter()
            .find(|f| f.is_srgb())
        {
            config.format = *format;
        }
        config.present_mode = if settings.fps_limit == 0 {
            wgpu::PresentMode::AutoVsync
        } else {
            wgpu::PresentMode::AutoNoVsync
        };
        config.desired_maximum_frame_latency = 2;
        // Java's RGBA8 GUI blends encoded colors. Keep the world sRGB, then draw
        // the interface through a compatible UNORM view of the same surface.
        config.view_formats = vec![config.format.remove_srgb_suffix()];
        surface.configure(&device, &config);
        let camera = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Camera"),
            contents: bytemuck::bytes_of(&CameraUniform::zeroed()),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let camera_layout = uniform_layout(&device, false, "Camera layout");
        let camera_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Camera"),
            layout: &camera_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera.as_entire_binding(),
            }],
        });
        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Texture array layout"),
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
        let textures_group = upload_textures(
            &device,
            &queue,
            &texture_layout,
            assets.texture_size,
            assets.texture_size,
            assets.texture_layers,
            &assets.textures_rgba,
            "Minecraft textures",
        )?;
        let skin_group = if assets.default_skin_size[0] > 0 {
            Some(upload_textures(
                &device,
                &queue,
                &texture_layout,
                assets.default_skin_size[0],
                assets.default_skin_size[1],
                1,
                &assets.default_skin_rgba,
                "Default player skin",
            )?)
        } else {
            None
        };
        let (gui_texture, gui_group) = upload_texture_data(
            &device,
            &queue,
            &texture_layout,
            assets.gui.width,
            assets.gui.height,
            1,
            &assets.gui.rgba,
            "Minecraft GUI atlas",
            true,
        )?;
        let section_stride = device.limits().min_uniform_buffer_offset_alignment.max(16);
        let section_uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Section origins"),
            size: u64::from(section_stride) * (MAX_SECTIONS as u64 + 1),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let section_layout = uniform_layout(&device, true, "Section origin layout");
        let section_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Section origins"),
            layout: &section_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer: &section_uniforms,
                    offset: 0,
                    size: NonZeroU64::new(16),
                }),
            }],
        });
        let world_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("World pipeline"),
            bind_group_layouts: &[
                Some(&camera_layout),
                Some(&texture_layout),
                Some(&section_layout),
            ],
            ..Default::default()
        });
        let hud_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("HUD pipeline"),
            bind_group_layouts: &[Some(&camera_layout), Some(&texture_layout)],
            ..Default::default()
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Textured world and HUD"),
            source: wgpu::ShaderSource::Wgsl(include_str!("terrain.wgsl").into()),
        });
        let opaque_pipeline =
            world_pipeline(&device, &world_layout, &shader, config.format, false, false);
        let translucent_pipeline =
            world_pipeline(&device, &world_layout, &shader, config.format, true, false);
        let weather=weather::WeatherRenderer::new(&device,&queue,&camera_layout,&texture_layout,assets,config.format)?;
        let lightning_pipeline = lightning_pipeline(&device,&world_layout,&shader,config.format);
        let line_pipeline =
            world_pipeline(&device, &world_layout, &shader, config.format, false, true);
        let hud_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:Some("HUD"),layout:Some(&hud_layout),
            vertex:wgpu::VertexState{module:&shader,entry_point:Some("vs_hud"),compilation_options:Default::default(),
                buffers:&[Some(wgpu::VertexBufferLayout{array_stride:std::mem::size_of::<HudVertex>() as u64,step_mode:wgpu::VertexStepMode::Vertex,
                    attributes:&wgpu::vertex_attr_array![0=>Float32x2,1=>Float32x2,2=>Uint32,3=>Float32x4]})]},
            primitive:wgpu::PrimitiveState{cull_mode:None,..Default::default()},depth_stencil:None,multisample:Default::default(),
            fragment:Some(wgpu::FragmentState{module:&shader,entry_point:Some("fs_hud"),compilation_options:Default::default(),
                targets:&[Some(wgpu::ColorTargetState{format:config.format,blend:Some(wgpu::BlendState::ALPHA_BLENDING),write_mask:wgpu::ColorWrites::ALL})]}),
            multiview_mask:None,cache:None,
        });
        let gui_shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Minecraft GUI"),
            source: wgpu::ShaderSource::Wgsl(include_str!("gui.wgsl").into()),
        });
        let gui_pipeline=device.create_render_pipeline(&wgpu::RenderPipelineDescriptor{
            label:Some("Minecraft GUI"),layout:Some(&hud_layout),
            vertex:wgpu::VertexState{module:&gui_shader,entry_point:Some("vs_hud"),compilation_options:Default::default(),buffers:&[Some(wgpu::VertexBufferLayout{array_stride:std::mem::size_of::<HudVertex>() as u64,step_mode:wgpu::VertexStepMode::Vertex,attributes:&wgpu::vertex_attr_array![0=>Float32x2,1=>Float32x2,2=>Uint32,3=>Float32x4]})]},
            primitive:wgpu::PrimitiveState{cull_mode:None,..Default::default()},depth_stencil:None,multisample:Default::default(),
            fragment:Some(wgpu::FragmentState{module:&gui_shader,entry_point:Some("fs_hud"),compilation_options:Default::default(),targets:&[Some(wgpu::ColorTargetState{format:config.format.remove_srgb_suffix(),blend:Some(wgpu::BlendState::ALPHA_BLENDING),write_mask:wgpu::ColorWrites::ALL})]}),multiview_mask:None,cache:None,
        });
        let depth = create_depth(&device, &config);
        let mobs = entities::MobRenderer::new(
            &device,
            &queue,
            &camera_layout,
            &texture_layout,
            assets,
            config.format,
        )?;
        let player_preview = player_preview::PlayerPreview::new(
            &device,
            &queue,
            &camera_layout,
            &world_layout,
            &shader,
        );
        Ok(Self {
            instance,
            window,
            surface,
            device,
            queue,
            config,
            size,
            opaque_pipeline,
            translucent_pipeline,
            hud_pipeline,
            gui_pipeline,
            gui_texture,
            gui_group,
            player_preview,
            menu_blur: None,
            line_pipeline,
            camera,
            camera_group,
            textures_group,
            skin_group,
            portrait_skin: None,
            portrait_source: None,
            section_uniforms,
            section_group,
            section_stride,
            free_slots: (1..=MAX_SECTIONS as u32).rev().collect(),
            sections: HashMap::new(),
            geometry_bytes: 0,
            rejected: HashMap::new(),
            depth,
            entities: GpuGeometry::default(),
            mobs,
            weather,camera_eye_height:1.62,camera_fov:1.,camera_updated:Instant::now(),
            lightning_pipeline,lightning:None,lightning_capacity:0,lightning_vertices:Vec::new(),
            lines: None,
            lines_capacity: 0,
            hud: None,
            hud_capacity: 0,
            labels: None,
            labels_capacity: 0,
            hud_key: None,
            hud_count: 0,
            overlay_start: 0,
            limited: false,
            error,
            ui_metrics: UiMetrics::default(),
            lightmap_inputs: None, lightmap_table:[[0.;4];256], lightmap_tick:u64::MAX,
            light_effects:Default::default(),
        })
    }
    fn resize(&mut self, size: PhysicalSize<u32>) {
        if let Some(blur) = &mut self.menu_blur {
            if size.width > 0 && size.height > 0 {
                blur.resize(&self.device, size);
            }
        }
        self.size = size;
        if size.width == 0 || size.height == 0 {
            return;
        }
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
        self.depth = create_depth(&self.device, &self.config);
    }
    fn clear_sections(&mut self) {
        self.mobs.clear();
        self.sections.clear();
        self.geometry_bytes = 0;
        self.limited = false;
        self.rejected.clear();
        self.free_slots = (1..=MAX_SECTIONS as u32).rev().collect();
    }
    fn retain_sections(&mut self, sections: &HashMap<[i32; 3], Arc<SectionSnapshot>>) {
        let Self {
            sections: resident,
            geometry_bytes,
            free_slots,
            rejected,
            ..
        } = self;
        let previous = resident.len();
        resident.retain(|position, section| {
            if sections.contains_key(position) {
                true
            } else {
                *geometry_bytes = geometry_bytes.saturating_sub(section.allocated());
                free_slots.push(section.slot);
                false
            }
        });
        if resident.len() < previous {
            rejected.clear();
        }
        rejected.retain(|position, _| sections.contains_key(position));
    }
    fn upload(&mut self, mesh: MeshResult) -> Result<(), String> {
        self.limited |= mesh.limited;
        let old_bytes = self
            .sections
            .get(&mesh.position)
            .map_or(0, GpuSection::allocated);
        let prior = self.sections.get(&mesh.position).map_or([0; 4], |s| {
            [
                s.opaque.vertex_capacity,
                s.opaque.index_capacity,
                s.translucent.vertex_capacity,
                s.translucent.index_capacity,
            ]
        });
        let estimate = [
            mesh.opaque.vertices.len() * std::mem::size_of::<Vertex>(),
            mesh.opaque.indices.len() * 4,
            mesh.translucent.vertices.len() * std::mem::size_of::<Vertex>(),
            mesh.translucent.indices.len() * 4,
        ]
        .iter()
        .zip(prior)
        .map(|(b, old)| {
            if *b == 0 {
                old
            } else {
                old.max((*b as u64).next_power_of_two().max(256))
            }
        })
        .sum::<u64>();
        if self.geometry_bytes.saturating_sub(old_bytes) + estimate > MAX_GEOMETRY_BYTES {
            self.limited = true;
            self.rejected.insert(mesh.position, mesh.revision);
            return Ok(());
        }
        let section = if let Some(section) = self.sections.get_mut(&mesh.position) {
            section
        } else {
            let Some(slot) = self.free_slots.pop() else {
                self.limited = true;
                self.rejected.insert(mesh.position, mesh.revision);
                return Ok(());
            };
            let origin = [
                mesh.position[0].saturating_mul(16),
                mesh.position[1].saturating_mul(16),
                mesh.position[2].saturating_mul(16),
                0,
            ];
            self.queue.write_buffer(
                &self.section_uniforms,
                u64::from(slot * self.section_stride),
                bytemuck::cast_slice(&origin),
            );
            self.sections.entry(mesh.position).or_insert(GpuSection {
                revision: mesh.revision, smooth:mesh.smooth,
                slot,
                opaque: GpuGeometry::default(),
                translucent: GpuGeometry::default(),
            })
        };
        section.revision = mesh.revision;
        section.smooth=mesh.smooth;
        section
            .opaque
            .upload(&self.device, &self.queue, &mesh.opaque);
        section
            .translucent
            .upload(&self.device, &self.queue, &mesh.translucent);
        self.geometry_bytes = self.geometry_bytes.saturating_sub(old_bytes) + section.allocated();
        Ok(())
    }
    fn draw(
        &mut self,
        state: &FrameState,
        input: &InputState,
        ui: &UiState<'_>,
        assets: &AssetPack,
        settings: RendererConfig,
    ) -> Result<DrawReport, String> {
        if let Some(error) = self
            .error
            .lock()
            .map_err(|_| "GPU error state is unavailable")?
            .take()
        {
            return Err(error);
        }
        let skipped = DrawReport {
            presented: false,
            drawn_sections: 0,
        };
        if self.size.width == 0 || self.size.height == 0 {
            return Ok(skipped);
        }
        if state.player.iter().any(|v| !v.is_finite())
            || !input.yaw.is_finite()
            || !input.pitch.is_finite()
        {
            return Err("Invalid server camera position".into());
        }
        let (frame, reconfigure) = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f) => (f, false),
            wgpu::CurrentSurfaceTexture::Suboptimal(f) => (f, true),
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                return Ok(skipped);
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                return Ok(skipped);
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                self.surface = self
                    .instance
                    .create_surface(self.window.clone())
                    .map_err(|e| e.to_string())?;
                self.surface.configure(&self.device, &self.config);
                return Ok(skipped);
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                return Err("Graphics surface failed validation".into());
            }
        };
        let origin = state.player.map(|v| v.floor() as i32);
        let dt=self.camera_updated.elapsed().as_secs_f32().min(0.25);self.camera_updated=Instant::now();
        self.camera_fov+=(state.fov_multiplier-self.camera_fov)*(1.-(-13.862944*dt).exp());
        self.camera_eye_height+=(state.eye_height-self.camera_eye_height)*(1.-(-13.862944*dt).exp());
        let eye = Vec3::new(
            (state.player[0] - origin[0] as f64) as f32,
            (state.player[1] - origin[1] as f64) as f32 + self.camera_eye_height,
            (state.player[2] - origin[2] as f64) as f32,
        );
        let (yaw, pitch) = (input.yaw.to_radians(), input.pitch.to_radians());
        let direction = Vec3::new(
            -yaw.sin() * pitch.cos(),
            -pitch.sin(),
            yaw.cos() * pitch.cos(),
        );
        let far = (settings.render_distance.clamp(2, 32) as f32 * 16.0 + 32.0).max(64.0);
        let projection = rh::proj::directx::perspective(
            (70.*self.camera_fov).to_radians(),
            self.size.width as f32 / self.size.height as f32,
            0.05,
            far,
        );
        let view_projection = projection * rh::view::look_at_mat4(eye, eye + direction, Vec3::Y);
        let now=Instant::now();
        let mut lm=crate::lighting::LightmapInputs::environment(&state.environment,now,ui.brightness,&state.hud);
        self.light_effects.apply(&mut lm,ui.time,&state.hud,now);
        let (fog,fog_range)=crate::atmosphere::fog(&state.environment,now,far,&state.hud,self.light_effects.darkness());
        let tick=(ui.time*20.) as u64;
        let update_lightmap=(tick!=self.lightmap_tick || self.lightmap_inputs.is_none()) && self.lightmap_inputs!=Some(lm);
        if update_lightmap {self.lightmap_table=lm.table();self.lightmap_inputs=Some(lm);}
        self.lightmap_tick=tick;
        let uniform = CameraUniform {
            fog,
            fog_range,
            lightmap: self.lightmap_table,
            view_projection: view_projection.to_cols_array_2d(),
            eye: [eye.x, eye.y, eye.z, far],
            origin: [origin[0], origin[1], origin[2], 0],
            viewport: [
                self.size.width as f32,
                self.size.height as f32,
                ui.time,
                input.light_debug as f32,
            ],
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
        };
        let bytes=bytemuck::bytes_of(&uniform);
        let offset=std::mem::offset_of!(CameraUniform,lightmap);
        self.queue.write_buffer(&self.camera,0,&bytes[..offset]);
        if update_lightmap {self.queue.write_buffer(&self.camera,offset as u64,&bytes[offset..]);}
        // Slot zero is the frame-relative origin for moving entities and target lines.
        self.queue.write_buffer(
            &self.section_uniforms,
            0,
            bytemuck::cast_slice(&[origin[0], origin[1], origin[2], 0]),
        );
        let planes = frustum_planes(view_projection);
        self.mobs.update(
            &self.device,
            &self.queue,
            if state.connected {
                &state.entities
            } else {
                &[]
            },
            assets,
            origin,
            eye,
            far,
            input.yaw,
            &planes,
            &lm,
        );
        let mut visible: Vec<_> = if state.connected {
            self.sections
                .iter()
                .filter_map(|(position, section)| {
                    let min = Vec3::new(
                        (i64::from(position[0]) * 16 - i64::from(origin[0])) as f32,
                        (i64::from(position[1]) * 16 - i64::from(origin[1])) as f32,
                        (i64::from(position[2]) * 16 - i64::from(origin[2])) as f32,
                    );
                    aabb_visible(min - Vec3::splat(1.0), min + Vec3::splat(17.0), &planes)
                        .then_some((
                            *position,
                            section,
                            section_distance(*position, state.player),
                        ))
                })
                .collect()
        } else {
            Vec::new()
        };
        visible.sort_unstable_by(|a, b| a.2.total_cmp(&b.2));
        let player_geometry = player_geometry(&state.entities, origin, far);
        self.entities
            .upload(&self.device, &self.queue, &player_geometry);
        self.weather.prepare(&self.device,&self.queue,&state.environment,origin,state.connected);
        self.lightning_vertices.clear();
        if state.connected {lightning_geometry(&state.environment.atmosphere,origin,eye,far,&mut self.lightning_vertices);}
        if !self.lightning_vertices.is_empty(){write_buffer(&self.device,&self.queue,&mut self.lightning,&mut self.lightning_capacity,bytemuck::cast_slice(&self.lightning_vertices),wgpu::BufferUsages::VERTEX,"Lightning");}
        let mut lines = target_lines(state.target, origin);
        if input.light_debug==5 {let p=state.player.map(|v|(v.floor() as i32).div_euclid(16)*16);let min=std::array::from_fn(|i|(p[i]-origin[i]) as f32);box_lines(&mut lines,min,[16.;3],[1.,0.8,0.1]);}

        let mut labels = Vec::new();
        // Unsupported entity models retain real positions and collision bounds.
        // Wireframes identify that fallback instead of impersonating a mob model.
        if state.connected {
            for entity in state.entities.iter().filter(|e| !e.is_player).take(128) {
                if self.mobs.supports(entity) || entity.kind=="LightningBolt" {
                    continue;
                }
                let p = std::array::from_fn::<_, 3, _>(|a| {
                    (entity.position[a] - origin[a] as f64) as f32
                });
                if p.iter().any(|v| !v.is_finite())
                    || p.iter().map(|v| v * v).sum::<f32>() > 96. * 96.
                {
                    continue;
                }
                let width = entity.width.clamp(0.05, 8.);
                let height = entity.height.clamp(0.05, 16.);
                box_lines(
                    &mut lines,
                    [p[0] - width / 2., p[1], p[2] - width / 2.],
                    [width, height, width],
                    [0.95, 0.68, 0.26],
                );
                let clip = view_projection * Vec4::new(p[0], p[1] + height + 0.2, p[2], 1.);
                if clip.w > 0. && clip.z > 0. {
                    let x = (clip.x / clip.w + 1.) * self.size.width as f32 / 2.;
                    let y = (1. - clip.y / clip.w) * self.size.height as f32 / 2.;
                    if x > 0. && x < self.size.width as f32 && y > 0. && y < self.size.height as f32
                    {
                        let name: String = entity.kind.chars().take(32).collect();
                        let width = text_width(&name, assets, 13.);
                        hud_quad(
                            &mut labels,
                            [x - width / 2. - 4., y - 2., width + 8., 17.],
                            SOLID,
                            [0.02, 0.02, 0.025, 0.7],
                        );
                        centered_text(&mut labels, &name, x, y, 13., [1., 0.85, 0.52, 1.], assets);
                    }
                }
            }
        }
        write_buffer(
            &self.device,
            &self.queue,
            &mut self.labels,
            &mut self.labels_capacity,
            bytemuck::cast_slice(&labels),
            wgpu::BufferUsages::VERTEX,
            "Entity labels",
        );
        write_buffer(
            &self.device,
            &self.queue,
            &mut self.lines,
            &mut self.lines_capacity,
            bytemuck::cast_slice(&lines),
            wgpu::BufferUsages::VERTEX,
            "Target outline",
        );
        let ui_started = Instant::now();
        assets.gui.begin_frame();
        let hud_key = hud_key(state, input, ui, self.size) ^ assets.gui.font_generation();
        if self.hud_key != Some(hud_key) {
            let (hud, overlay_start) = java_hud::draw(state, input, ui, assets, self.size, &self.lightmap_table);
            self.overlay_start = overlay_start;
            self.hud_count = hud.len() as u32;
            write_buffer(
                &self.device,
                &self.queue,
                &mut self.hud,
                &mut self.hud_capacity,
                bytemuck::cast_slice(&hud),
                wgpu::BufferUsages::VERTEX,
                "HUD vertices",
            );
            self.hud_key = Some(hud_key);
            self.ui_metrics.rebuilds += 1;
            self.ui_metrics.uploaded_bytes += hud.len() * std::mem::size_of::<HudVertex>();
        }
        for upload in assets.gui.take_glyph_uploads() {
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.gui_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: upload.x,
                        y: upload.y,
                        z: 0,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                &upload.rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(upload.width * 4),
                    rows_per_image: Some(upload.height),
                },
                wgpu::Extent3d {
                    width: upload.width,
                    height: upload.height,
                    depth_or_array_layers: 1,
                },
            );
        }
        if self.ui_metrics.cpu.len() < 4096 {
            self.ui_metrics
                .cpu
                .push(ui_started.elapsed().as_micros() as u64);
        }
        self.ui_metrics.draw_calls += u64::from(self.hud_count > 0);
        let view = frame.texture.create_view(&Default::default());
        let gui_view = frame.texture.create_view(&wgpu::TextureViewDescriptor {
            format: Some(self.config.format.remove_srgb_suffix()),
            ..Default::default()
        });
        if ui.paused && self.menu_blur.is_none() {
            self.menu_blur = Some(menu_blur::MenuBlur::new(
                &self.device,
                self.config.format,
                self.size,
            ));
        }
        let world_view = if ui.paused {
            self.menu_blur
                .as_ref()
                .map(|blur| blur.world_view())
                .unwrap_or(&view)
        } else {
            &view
        };
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Sakura frame"),
            });
        if let Some(skin) = &state.local_skin {
            if self.portrait_source.as_ref().is_none_or(|old| !Arc::ptr_eq(old, skin)) {
                let (_, group) = upload_texture_data(&self.device, &self.queue,
                    &self.opaque_pipeline.get_bind_group_layout(1), 64, 64, 1,
                    &skin.rgba, "Account inventory skin", false)?;
                self.portrait_skin = Some(group);
                self.portrait_source = Some(skin.clone());
                self.player_preview.set_model(&self.device, &self.queue, skin.slim);
                self.hud_key = None;
            }
        }
        if state.inventory.open && state.inventory.kind == crate::shared::InventoryKind::Player {
            let metrics = GuiMetrics::new(self.size, ui.gui_scale);
            if ui.inventory.panel_visible(&state.inventory, metrics) {
                if let (Some(skin), Some(sprite)) = (
                    self.portrait_skin.as_ref().or(self.skin_group.as_ref()),
                    assets.gui.sprites.get("sakura/internal/player_preview"),
                ) {
                    self.player_preview.update(
                        &mut encoder,
                        &self.queue,
                        skin,
                        &self.gui_texture,
                        sprite,
                        metrics.pointer(ui.cursor),
                        ui.inventory
                            .layout(&state.inventory, metrics)
                            .player_preview(),
                    );
                }
            }
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("World"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: world_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear({let mut c=fog;if state.environment.atmosphere.flashing() && state.environment.atmosphere.medium==crate::atmosphere::Medium::Air {for i in 0..3 {c[i]+=([0.8,0.8,1.][i]-c[i])*0.22;}}wgpu::Color{r:crate::lighting::to_linear(c[0]) as f64,g:crate::lighting::to_linear(c[1]) as f64,b:crate::lighting::to_linear(c[2]) as f64,a:1.}}),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            pass.set_bind_group(0, &self.camera_group, &[]);
            pass.set_bind_group(1, &self.textures_group, &[]);
            pass.set_pipeline(&self.opaque_pipeline);
            for (_, section, _) in &visible {
                pass.set_bind_group(
                    2,
                    &self.section_group,
                    &[section.slot * self.section_stride],
                );
                section.opaque.draw(&mut pass);
            }
            if let Some(skin) = &self.skin_group {
                pass.set_bind_group(1, skin, &[]);
                pass.set_bind_group(2, &self.section_group, &[0]);
                self.entities.draw(&mut pass);
            }
            self.mobs
                .draw(&mut pass, &self.camera_group, &self.textures_group, false);
            self.mobs.draw_shadows(&mut pass,&self.camera_group);
            pass.set_bind_group(1, &self.textures_group, &[]);
            pass.set_pipeline(&self.translucent_pipeline);
            for (_, section, _) in visible.iter().rev() {
                pass.set_bind_group(
                    2,
                    &self.section_group,
                    &[section.slot * self.section_stride],
                );
                section.translucent.draw(&mut pass);
            }
            self.mobs
                .draw(&mut pass, &self.camera_group, &self.textures_group, true);
            self.weather.draw(&mut pass,&self.camera_group);
            if !self.lightning_vertices.is_empty() {
                pass.set_pipeline(&self.lightning_pipeline);pass.set_bind_group(1,&self.textures_group,&[]);pass.set_bind_group(2,&self.section_group,&[0]);
                pass.set_vertex_buffer(0,self.lightning.as_ref().unwrap().slice(..));pass.draw(0..self.lightning_vertices.len() as u32,0..1);
            }
            if !lines.is_empty() {
                pass.set_pipeline(&self.line_pipeline);
                pass.set_bind_group(1, &self.textures_group, &[]);
                pass.set_bind_group(2, &self.section_group, &[0]);
                pass.set_vertex_buffer(0, self.lines.as_ref().unwrap().slice(..));
                pass.draw(0..lines.len() as u32, 0..1);
            }
        }
        if ui.paused {
            if self.overlay_start > 0 {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("HUD beneath pause blur"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: self.menu_blur.as_ref().map(|blur| blur.gui_view()).unwrap_or(&gui_view),
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
                pass.set_pipeline(&self.gui_pipeline);
                pass.set_bind_group(0, &self.camera_group, &[]);
                pass.set_bind_group(1, &self.gui_group, &[]);
                pass.set_vertex_buffer(0, self.hud.as_ref().unwrap().slice(..));
                pass.draw(0..self.overlay_start, 0..1);
            }
            if let Some(blur) = &self.menu_blur {
                blur.encode(&mut encoder, &gui_view);
                self.ui_metrics.draw_calls += 6 + u64::from(self.overlay_start > 0);
            }
        }
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("HUD"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &gui_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            if self.hud_count > 0 {
                pass.set_pipeline(&self.gui_pipeline);
                pass.set_bind_group(0, &self.camera_group, &[]);
                pass.set_bind_group(1, &self.gui_group, &[]);
                pass.set_vertex_buffer(0, self.hud.as_ref().unwrap().slice(..));
                pass.draw(
                    if ui.paused { self.overlay_start } else { 0 }..self.hud_count,
                    0..1,
                );
            }
        }
        if !labels.is_empty() && !ui.paused && !ui.inventory.active(&state.inventory) {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("World labels"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                    })],
                    ..Default::default()
                });
                pass.set_pipeline(&self.hud_pipeline);
                pass.set_bind_group(0, &self.camera_group, &[]);
                pass.set_bind_group(1, &self.textures_group, &[]);
                pass.set_vertex_buffer(0, self.labels.as_ref().unwrap().slice(..));
                pass.draw(0..labels.len() as u32, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        self.window.pre_present_notify();
        self.queue.present(frame);
        if reconfigure {
            self.surface.configure(&self.device, &self.config)
        }
        Ok(DrawReport {
            presented: true,
            drawn_sections: visible
                .iter()
                .filter(|(_, s, _)| s.opaque.index_count + s.translucent.index_count > 0)
                .count(),
        })
    }
}

fn uniform_layout(device: &wgpu::Device, dynamic: bool, label: &str) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some(label),
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: dynamic,
                min_binding_size: if dynamic { NonZeroU64::new(16) } else { None },
            },
            count: None,
        }],
    })
}
fn upload_textures(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    width: u32,
    height: u32,
    layers: u32,
    rgba: &[u8],
    label: &str,
) -> Result<wgpu::BindGroup, String> {
    upload_texture_data(
        device, queue, layout, width, height, layers, rgba, label, false,
    )
    .map(|(_, group)| group)
}
fn upload_texture_data(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    layout: &wgpu::BindGroupLayout,
    width: u32,
    height: u32,
    layers: u32,
    rgba: &[u8],
    label: &str,
    gui: bool,
) -> Result<(wgpu::Texture, wgpu::BindGroup), String> {
    if width == 0
        || height == 0
        || layers == 0
        || rgba.len() != width as usize * height as usize * layers as usize * 4
    {
        return Err(format!("Invalid {label} dimensions"));
    }
    let size = wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: layers,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: if gui { wgpu::TextureFormat::Rgba8Unorm } else { wgpu::TextureFormat::Rgba8UnormSrgb },
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        rgba,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width * 4),
            rows_per_image: Some(height),
        },
        size,
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor {
        dimension: Some(wgpu::TextureViewDimension::D2Array),
        ..Default::default()
    });
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("Nearest repeating texels"),
        address_mode_u: if gui {
            wgpu::AddressMode::ClampToEdge
        } else {
            wgpu::AddressMode::Repeat
        },
        address_mode_v: if gui {
            wgpu::AddressMode::ClampToEdge
        } else {
            wgpu::AddressMode::Repeat
        },
        mag_filter: wgpu::FilterMode::Nearest,
        min_filter: wgpu::FilterMode::Nearest,
        mipmap_filter: wgpu::MipmapFilterMode::Nearest,
        ..Default::default()
    });
    let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(label),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(&sampler),
            },
        ],
    });
    Ok((texture, group))
}
fn world_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat,
    blend: bool,
    lines: bool,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor{
        label:Some(if lines{"Target outline"}else if blend{"Translucent terrain"}else{"Opaque and cutout terrain"}),layout:Some(layout),
        vertex:wgpu::VertexState{module:shader,entry_point:Some("vs_main"),compilation_options:Default::default(),
            buffers:&[Some(wgpu::VertexBufferLayout{array_stride:std::mem::size_of::<Vertex>() as u64,step_mode:wgpu::VertexStepMode::Vertex,
                attributes:&wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x2,2=>Uint32,3=>Float32x3,4=>Float32x2]})]},
        primitive:wgpu::PrimitiveState{topology:if lines{wgpu::PrimitiveTopology::LineList}else{wgpu::PrimitiveTopology::TriangleList},
            front_face:wgpu::FrontFace::Ccw,cull_mode:if lines{None}else{Some(wgpu::Face::Back)},..Default::default()},
        depth_stencil:Some(wgpu::DepthStencilState{format:DEPTH_FORMAT,depth_write_enabled:Some(!blend&&!lines),
            depth_compare:Some(wgpu::CompareFunction::LessEqual),stencil:Default::default(),bias:Default::default()}),multisample:Default::default(),
        fragment:Some(wgpu::FragmentState{module:shader,entry_point:Some(if blend{"fs_translucent"}else{"fs_main"}),compilation_options:Default::default(),
            targets:&[Some(wgpu::ColorTargetState{format,blend:blend.then_some(wgpu::BlendState::ALPHA_BLENDING),write_mask:wgpu::ColorWrites::ALL})]}),
        multiview_mask:None,cache:None,
    })
}
fn lightning_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let blend=true;let lines=false;
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor{
        label:Some(if lines{"Target outline"}else if blend{"Translucent terrain"}else{"Opaque and cutout terrain"}),layout:Some(layout),
        vertex:wgpu::VertexState{module:shader,entry_point:Some("vs_main"),compilation_options:Default::default(),
            buffers:&[Some(wgpu::VertexBufferLayout{array_stride:std::mem::size_of::<Vertex>() as u64,step_mode:wgpu::VertexStepMode::Vertex,
                attributes:&wgpu::vertex_attr_array![0=>Float32x3,1=>Float32x2,2=>Uint32,3=>Float32x3,4=>Float32x2]})]},
        primitive:wgpu::PrimitiveState{topology:if lines{wgpu::PrimitiveTopology::LineList}else{wgpu::PrimitiveTopology::TriangleList},
            front_face:wgpu::FrontFace::Ccw,cull_mode:None,..Default::default()},
        depth_stencil:Some(wgpu::DepthStencilState{format:DEPTH_FORMAT,depth_write_enabled:Some(!blend&&!lines),
            depth_compare:Some(wgpu::CompareFunction::LessEqual),stencil:Default::default(),bias:Default::default()}),multisample:Default::default(),
        fragment:Some(wgpu::FragmentState{module:shader,entry_point:Some("fs_lightning"),compilation_options:Default::default(),
            targets:&[Some(wgpu::ColorTargetState{format,blend:Some(wgpu::BlendState{color:wgpu::BlendComponent{src_factor:wgpu::BlendFactor::SrcAlpha,dst_factor:wgpu::BlendFactor::One,operation:wgpu::BlendOperation::Add},alpha:wgpu::BlendComponent::OVER}),write_mask:wgpu::ColorWrites::ALL})]}),
        multiview_mask:None,cache:None,
    })
}
fn create_depth(device: &wgpu::Device, config: &wgpu::SurfaceConfiguration) -> wgpu::TextureView {
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some("Depth"),
            size: wgpu::Extent3d {
                width: config.width,
                height: config.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
        .create_view(&Default::default())
}
fn section_distance(position: [i32; 3], player: [f64; 3]) -> f64 {
    (0..3)
        .map(|a| (position[a] as f64 * 16.0 + 8.0 - player[a]).powi(2))
        .sum()
}
fn frustum_planes(matrix: Mat4) -> [Vec4; 6] {
    let m = matrix.to_cols_array_2d();
    let row = |r: usize| Vec4::new(m[0][r], m[1][r], m[2][r], m[3][r]);
    [
        row(3) + row(0),
        row(3) - row(0),
        row(3) + row(1),
        row(3) - row(1),
        row(2),
        row(3) - row(2),
    ]
}
fn aabb_visible(min: Vec3, max: Vec3, planes: &[Vec4; 6]) -> bool {
    planes.iter().all(|p| {
        let v = Vec3::new(
            if p.x >= 0.0 { max.x } else { min.x },
            if p.y >= 0.0 { max.y } else { min.y },
            if p.z >= 0.0 { max.z } else { min.z },
        );
        p.truncate().dot(v) + p.w >= 0.0
    })
}
/// Sixteen bolts at most; four nested shells, eight segments. No world meshing.
fn lightning_geometry(atmosphere:&crate::atmosphere::Atmosphere,origin:[i32;3],eye:Vec3,far:f32,out:&mut Vec<Vertex>) {
    for (position,seed) in atmosphere.bolts() {
        let base=Vec3::new((position[0]-origin[0] as f64) as f32,(position[1]-origin[1] as f64) as f32,(position[2]-origin[2] as f64) as f32);
        if (base.x-eye.x).hypot(base.z-eye.z)>far {continue;}
        let mut random=seed;let mut points=[[0.;3];9];
        for i in 1..9 {random=random.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);points[i]=[points[i-1][0]+((random>>32)%11) as f32-5.,i as f32*16.,points[i-1][2]+((random>>48)%11) as f32-5.];}
        for shell in 0..4 {let r=0.1+shell as f32*0.2;
            for i in 0..8 {for side in 0..4 {
                let corners=[[-r,-r],[r,-r],[r,r],[-r,r]];
                let a=corners[side];let b=corners[(side+1)%4];
                let lower=points[i];let upper=points[i+1];
                let quad=[[lower[0]+a[0],lower[1],lower[2]+a[1]],[lower[0]+b[0],lower[1],lower[2]+b[1]],[upper[0]+b[0],upper[1],upper[2]+b[1]],[upper[0]+a[0],upper[1],upper[2]+a[1]]];
                for index in [0,1,2,0,2,3] {let p=quad[index];out.push(Vertex{position:[base.x+p[0],base.y+p[1],base.z+p[2]],uv:[0.;2],layer:u32::MAX,color:[0.8,0.8,1.],light:[-1.;2]});}
            }}
        }
    }
}
fn target_lines(target: Option<[i32; 3]>, origin: [i32; 3]) -> Vec<Vertex> {
    let Some(target) = target else {
        return Vec::new();
    };
    let min = std::array::from_fn::<_, 3, _>(|a| {
        (i64::from(target[a]) - i64::from(origin[a])) as f32 - 0.003
    });
    let mut out = Vec::with_capacity(24);
    box_lines(&mut out, min, [1.006; 3], [0.04; 3]);
    out
}
fn box_lines(out: &mut Vec<Vertex>, min: [f32; 3], size: [f32; 3], color: [f32; 3]) {
    let corners: [[_; 3]; 8] = std::array::from_fn(|i| {
        std::array::from_fn(|a| min[a] + if i & (1 << a) == 0 { 0.0 } else { size[a] })
    });
    for i in 0..8 {
        for a in 0..3 {
            if i & (1 << a) == 0 {
                for j in [i, i | (1 << a)] {
                    out.push(Vertex {
                        position: corners[j],
                        uv: [0.; 2],
                        layer: SOLID,
                        color,
                        light: [-1.;2],
                    });
                }
            }
        }
    }
}

// Actual server players only. Default Steve skin is deliberately a fallback,
// not a claim that authenticated skin downloads or mob models are implemented.
fn player_geometry(entities: &[EntitySnapshot], origin: [i32; 3], far: f32) -> Geometry {
    let mut geometry = Geometry::default();
    for entity in entities.iter().filter(|e| e.is_player).take(128) {
        let base =
            std::array::from_fn::<_, 3, _>(|a| (entity.position[a] - origin[a] as f64) as f32);
        if base.iter().any(|v| !v.is_finite())
            || base.iter().map(|v| v * v).sum::<f32>() > far * far
        {
            continue;
        }
        let start=geometry.vertices.len();
        let yaw = entity.yaw.to_radians();
        // Classic Minecraft skin cuboids, dimensions expressed in sixteenths.
        for (min, size, uv) in [
            ([-4., 24., -4.], [8., 8., 8.], [0., 0.]),
            ([-4., 12., -2.], [8., 12., 4.], [16., 16.]),
            ([-8., 12., -2.], [4., 12., 4.], [40., 16.]),
            ([4., 12., -2.], [4., 12., 4.], [32., 48.]),
            ([-4., 0., -2.], [4., 12., 4.], [0., 16.]),
            ([0., 0., -2.], [4., 12., 4.], [16., 48.]),
        ] {
            skin_cuboid(&mut geometry, min, size, uv, base, yaw);
        }
        for v in &mut geometry.vertices[start..] {v.light=[entity.light.block.unwrap_or(0) as f32,entity.light.sky.unwrap_or(0) as f32];}
    }
    geometry
}
fn skin_cuboid(
    out: &mut Geometry,
    min: [f32; 3],
    size: [f32; 3],
    uv: [f32; 2],
    base: [f32; 3],
    yaw: f32,
) {
    let [x, y, z] = min;
    let [w, h, d] = size;
    let [u, v] = uv;
    let faces = [
        (
            [[x, y, z], [x, y, z + d], [x, y + h, z + d], [x, y + h, z]],
            [u, v + d, d, h],
        ),
        (
            [
                [x + w, y, z + d],
                [x + w, y, z],
                [x + w, y + h, z],
                [x + w, y + h, z + d],
            ],
            [u + d + w, v + d, d, h],
        ),
        (
            [
                [x, y + h, z + d],
                [x + w, y + h, z + d],
                [x + w, y + h, z],
                [x, y + h, z],
            ],
            [u + d, v, w, d],
        ),
        (
            [[x, y, z], [x + w, y, z], [x + w, y, z + d], [x, y, z + d]],
            [u + d + w, v, w, d],
        ),
        (
            [
                [x, y, z + d],
                [x + w, y, z + d],
                [x + w, y + h, z + d],
                [x, y + h, z + d],
            ],
            [u + d, v + d, w, h],
        ),
        (
            [[x + w, y, z], [x, y, z], [x, y + h, z], [x + w, y + h, z]],
            [u + 2. * d + w, v + d, w, h],
        ),
    ];
    for (positions, rect) in faces {
        let positions = positions.map(|p| {
            let px = p[0] / 16.;
            let pz = p[2] / 16.;
            [
                base[0] + px * yaw.cos() - pz * yaw.sin(),
                base[1] + p[1] / 16.,
                base[2] + px * yaw.sin() + pz * yaw.cos(),
            ]
        });
        let [u, v, w, h] = rect;
        let quad = BakedQuad {
                shade: true, ambient_occlusion: true,
            positions,
            uv: [
                [u / 64., (v + h) / 64.],
                [(u + w) / 64., (v + h) / 64.],
                [(u + w) / 64., v / 64.],
                [u / 64., v / 64.],
            ],
            layer: 0,
            cull_face: None,
            tint: [1.; 3],
            render_layer: RenderLayer::Opaque,
        };
        out.quad(&quad, [0.; 3], [[-1.,-1.,1.];4]);
    }
}

struct UiState<'a> {
    paused: bool,
    captured: bool,
    chat_input: Option<&'a str>,
    inventory: &'a inventory_ui::InventoryUi,
    cursor: [f32; 2],
    gui_scale: u8,
    volume: f32,
    brightness: f32,
    smooth_lighting: bool,
    settings: bool,
    focus: Option<usize>,
    time: f32,
}
#[derive(Default)]
struct UiMetrics {
    cpu: Vec<u64>,
    rebuilds: u64,
    uploaded_bytes: usize,
    draw_calls: u64,
}
impl UiMetrics {
    fn take(&mut self) -> serde_json::Value {
        let value = serde_json::json!({"processing":timing_summary(&mut self.cpu),"geometry_rebuilds":self.rebuilds,"uploaded_bytes":self.uploaded_bytes,"draw_calls":self.draw_calls});
        self.rebuilds = 0;
        self.uploaded_bytes = 0;
        self.draw_calls = 0;
        value
    }
}
fn timing_summary(values: &mut Vec<u64>) -> serde_json::Value {
    values.sort_unstable();
    let n = values.len();
    let p = |percent: usize| {
        values
            .get(n.saturating_sub(1) * percent / 100)
            .copied()
            .unwrap_or(0)
    };
    let result = serde_json::json!({"samples":n,"mean_us":if n==0{0}else{values.iter().sum::<u64>()/n as u64},"p50_us":p(50),"p95_us":p(95),"p99_us":p(99)});
    values.clear();
    result
}
fn hud_key(
    state: &FrameState,
    input: &InputState,
    ui: &UiState<'_>,
    size: PhysicalSize<u32>,
) -> u64 {
    let mut key = std::collections::hash_map::DefaultHasher::new();
    (
        size.width,
        size.height,
        state.connected,
        state.health.to_bits(),
        state.food,
        input.hotbar,
        ui.paused,
        ui.captured,
        ui.chat_input,
    )
        .hash(&mut key);
    input.hide_hud.hash(&mut key);
    input.light_debug.hash(&mut key);
    if input.light_debug>0 {(state.light_debug.revision,state.light_debug.position,state.light_debug.pending,(ui.time*20.) as u64).hash(&mut key);}
    state.status.hash(&mut key);
    state.chat.hash(&mut key);
    let metrics = GuiMetrics::new(size, ui.gui_scale);
    inventory_ui::hash(
        ui.inventory,
        &state.inventory,
        metrics.pointer(ui.cursor),
        metrics,
        &mut key,
    );
    (
        ui.gui_scale,
        ui.settings,
        ui.focus,
        ui.volume.to_bits(),
        ui.brightness.to_bits(),
        ui.smooth_lighting,
        state.hud.revision,
    )
        .hash(&mut key);
    // Only timed content invalidates geometry. Glint animates in the shader.
    let now = Instant::now();
    let data = &state.hud;
    let timed = java_hud::needs_animation(data, now)
        || ui.chat_input.is_some()
        || ui.inventory.text_focused()
        || data
            .health_changed_at
            .is_some_and(|t| now.duration_since(t).as_secs_f32() < 1.1)
        || data
            .selected_item_changed_at
            .is_some_and(|t| now.duration_since(t).as_secs_f32() < 2.1)
        || data
            .cooldowns
            .iter()
            .any(|c| now < c.ends_at + Duration::from_millis(100))
        || data
            .chat
            .iter()
            .any(|m| now.duration_since(m.received_at).as_secs_f32() < 10.1)
        || data
            .action_bar
            .as_ref()
            .is_some_and(|m| now.duration_since(m.received_at).as_secs_f32() < 3.1)
        || data.title.as_ref().is_some_and(|m| {
            now.duration_since(m.received_at).as_millis()
                < (data.title_fade_in_ms + data.title_stay_ms + data.title_fade_out_ms + 100)
                    as u128
        });
    if timed {
        ((ui.time * 20.) as u64).hash(&mut key);
    }
    if ui.paused || state.health <= 0. {
        (ui.cursor[0] as i32, ui.cursor[1] as i32).hash(&mut key);
    }
    for slot in &state.hotbar {
        slot.item_id.hash(&mut key);
        slot.count.hash(&mut key);
        slot.component_fingerprint.hash(&mut key);
        slot.name.hash(&mut key);
    }
    key.finish()
}
fn inside(point: [f32; 2], rect: [f32; 4]) -> bool {
    point[0] >= rect[0]
        && point[0] <= rect[0] + rect[2]
        && point[1] >= rect[1]
        && point[1] <= rect[1] + rect[3]
}
fn hud_quad(out: &mut Vec<HudVertex>, rect: [f32; 4], layer: u32, color: [f32; 4]) {
    let [x, y, w, h] = rect;
    let positions = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    let uv = [[0., 0.], [1., 0.], [1., 1.], [0., 1.]];
    for i in [0, 1, 2, 0, 2, 3] {
        out.push(HudVertex {
            position: positions[i],
            uv: uv[i],
            layer,
            color,
        })
    }
}
fn text_width(text: &str, assets: &AssetPack, size: f32) -> f32 {
    text.chars()
        .map(|c| {
            let i = if c.is_ascii() {
                c as usize
            } else {
                b'?' as usize
            };
            assets.font_widths[i].max(0.25) * size
        })
        .sum()
}
fn hud_text(
    out: &mut Vec<HudVertex>,
    text: &str,
    mut x: f32,
    y: f32,
    size: f32,
    color: [f32; 4],
    assets: &AssetPack,
) {
    for c in text.chars().take(360) {
        let i = if c.is_ascii() {
            c as usize
        } else {
            b'?' as usize
        };
        if c != ' ' {
            hud_quad(out, [x, y, size, size], assets.font_layers[i], color)
        }
        x += assets.font_widths[i].max(0.25) * size;
    }
}
fn centered_text(
    out: &mut Vec<HudVertex>,
    text: &str,
    x: f32,
    y: f32,
    size: f32,
    color: [f32; 4],
    assets: &AssetPack,
) {
    hud_text(
        out,
        text,
        x - text_width(text, assets, size) / 2.,
        y,
        size,
        color,
        assets,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::BlockModel;
    fn pack() -> AssetPack {
        let cube = BlockModel {
            opaque_full_cube: true,
            cull_group: 0,
            quads: vec![
                BakedQuad {
                shade: true, ambient_occlusion: true,
                    positions: [[0., 0., 0.], [0., 0., 1.], [0., 1., 1.], [0., 1., 0.]],
                    uv: [[0., 0.], [1., 0.], [1., 1.], [0., 1.]],
                    layer: 1,
                    cull_face: Some(Face::West),
                    tint: [1.; 3],
                    render_layer: RenderLayer::Opaque,
                },
                BakedQuad {
                shade: true, ambient_occlusion: true,
                    positions: [[1., 0., 1.], [1., 0., 0.], [1., 1., 0.], [1., 1., 1.]],
                    uv: [[0., 0.], [1., 0.], [1., 1.], [0., 1.]],
                    layer: 1,
                    cull_face: Some(Face::East),
                    tint: [1.; 3],
                    render_layer: RenderLayer::Opaque,
                },
            ],
        };
        AssetPack {
            textures_rgba: vec![],
            texture_size: 16,
            texture_layers: 2,
            models: vec![
                Arc::new(BlockModel {
                    quads: vec![],
                    opaque_full_cube: false,
                    cull_group: 0,
                }),
                Arc::new(cube),
            ],
            gui: Arc::new(crate::gui_assets::GuiAssets::empty()),
            font_layers: [0; 128],
            font_widths: [0.5; 128],
            default_skin_rgba: vec![],
            default_skin_size: [0; 2],
            item_textures: HashMap::new(),
            weather_rgba: vec![255;64*256*4*2],
            biome_colormaps: Vec::new(),
            entity_textures_rgba: vec![255; 64 * 64 * 4],
            entity_texture_size: 64,
            entity_texture_layers: 1,
            entity_textures: HashMap::new(),
            cache_hit: false,
            load_ms: 0,
            unsupported_block_models: 0,
        }
    }
    fn section() -> SectionSnapshot {
        SectionSnapshot {
            biomes: Arc::from([]),
            position: [0; 3],
            revision: 1,
            blocks: vec![0; 18 * 18 * 18],
            light: vec![0xf0; 18 * 18 * 18],
            light_known: vec![3;18*18*18],
        }
    }
    fn complete_cube_pack() -> AssetPack {
        let mut assets = pack();
        let mut quads = assets.models[1].quads.clone();
        for (face, positions) in [
            (
                Face::Up,
                [[0., 1., 1.], [1., 1., 1.], [1., 1., 0.], [0., 1., 0.]],
            ),
            (
                Face::Down,
                [[0., 0., 0.], [1., 0., 0.], [1., 0., 1.], [0., 0., 1.]],
            ),
            (
                Face::South,
                [[0., 0., 1.], [1., 0., 1.], [1., 1., 1.], [0., 1., 1.]],
            ),
            (
                Face::North,
                [[1., 0., 0.], [0., 0., 0.], [0., 1., 0.], [1., 1., 0.]],
            ),
        ] {
            quads.push(BakedQuad {
                shade: true, ambient_occlusion: true,
                positions,
                uv: [[0., 0.], [1., 0.], [1., 1.], [0., 1.]],
                layer: 1,
                cull_face: Some(face),
                tint: [1.; 3],
                render_layer: RenderLayer::Opaque,
            });
        }
        assets.models[1] = Arc::new(BlockModel {
            quads,
            opaque_full_cube: true,
            cull_group: 0,
        });
        assets
    }
    #[test]
    fn greedy_merges_a_solid_section_to_six_repeating_faces() {
        let mut s = section();
        for y in 1..=16 {
            for z in 1..=16 {
                for x in 1..=16 {
                    s.blocks[halo(x, y, z)] = 1;
                }
            }
        }
        let mesh = mesh_section(
            MeshRequest {
                    smooth: true,
                epoch: 0,
                section: Arc::new(s),
            },
            &complete_cube_pack(),
        );
        assert_eq!(mesh.opaque.indices.len(), 36);
        assert_eq!(mesh.opaque.vertices.len(), 24);
        assert!(
            mesh.opaque
                .vertices
                .iter()
                .any(|v| v.uv.iter().any(|u| u.abs() == 16.))
        );
    }
    #[test]
    fn greedy_does_not_merge_different_materials_or_lighting() {
        let mut assets = complete_cube_pack();
        let mut other = assets.models[1].quads.clone();
        for quad in &mut other {
            quad.layer = 2;
        }
        assets.models.push(Arc::new(BlockModel {
            quads: other,
            opaque_full_cube: true,
            cull_group: 0,
        }));
        let mut s = section();
        s.blocks[halo(1, 1, 1)] = 1;
        s.blocks[halo(2, 1, 1)] = 2;
        let mesh = mesh_section(
            MeshRequest {
                    smooth: true,
                epoch: 0,
                section: Arc::new(s),
            },
            &assets,
        );
        assert_eq!(mesh.opaque.indices.len(), 60);
        let mut s = section();
        s.blocks[halo(1, 1, 1)] = 1;
        s.blocks[halo(2, 1, 1)] = 1;
        s.light[halo(1, 2, 1)] = 0x70;
        let mesh = mesh_section(
            MeshRequest {
                    smooth: true,
                epoch: 0,
                section: Arc::new(s),
            },
            &assets,
        );
        assert_eq!(mesh.opaque.indices.len(), 42);
    }
    #[test]
    fn camera_interpolates_updates_but_snaps_teleports() {
        let now = Instant::now();
        let mut motion = CameraMotion::default();
        assert_eq!(motion.update([0.; 3], now), [0.; 3]);
        motion.update([1., 0., 0.], now + Duration::from_millis(32));
        let halfway = motion.sample(now + Duration::from_millis(48));
        assert!((halfway[0] - 0.5).abs() < 0.001);
        assert_eq!(
            motion.update([100., 0., 0.], now + Duration::from_millis(64)),
            [100., 0., 0.]
        );
    }
    #[test]
    fn halo_culls_neighbor_across_section_boundary() {
        let mut s = section();
        s.blocks[halo(16, 1, 1)] = 1;
        s.blocks[halo(17, 1, 1)] = 1;
        let mesh = mesh_section(
            MeshRequest {
                    smooth: true,
                epoch: 0,
                section: Arc::new(s),
            },
            &pack(),
        );
        assert_eq!(mesh.opaque.indices.len(), 6);
        assert!(!mesh.limited);
    }
    #[test]
    fn hidden_faces_are_removed_and_empty_sections_clear() {
        let mut s = section();
        s.blocks[halo(1, 1, 1)] = 1;
        s.blocks[halo(2, 1, 1)] = 1;
        let mesh = mesh_section(
            MeshRequest {
                    smooth: true,
                epoch: 0,
                section: Arc::new(s),
            },
            &pack(),
        );
        assert_eq!(mesh.opaque.indices.len(), 12);
        let empty = mesh_section(
            MeshRequest {
                    smooth: true,
                epoch: 0,
                section: Arc::new(section()),
            },
            &pack(),
        );
        assert_eq!(empty.bytes(), 0);
    }
    #[test]
    fn section_mesh_coordinates_do_not_lose_precision_at_world_border() {
        let mut s = section();
        s.position = [1_875_000, 0, -1_875_000];
        s.blocks[halo(1, 1, 1)] = 1;
        let mesh = mesh_section(
            MeshRequest {
                    smooth: true,
                epoch: 0,
                section: Arc::new(s),
            },
            &pack(),
        );
        assert!(
            mesh.opaque
                .vertices
                .iter()
                .all(|v| v.position.iter().all(|x| *x >= 0. && *x <= 1.))
        );
    }
    #[test]
    fn frustum_culls_behind_camera() {
        let view = rh::view::look_at_mat4(Vec3::ZERO, Vec3::Z, Vec3::Y);
        let projection = rh::proj::directx::perspective(70f32.to_radians(), 1., 0.05, 100.);
        let planes = frustum_planes(projection * view);
        assert!(aabb_visible(
            Vec3::new(-1., -1., 4.),
            Vec3::new(1., 1., 6.),
            &planes
        ));
        assert!(!aabb_visible(
            Vec3::new(-1., -1., -6.),
            Vec3::new(1., 1., -4.),
            &planes
        ));
    }
}
