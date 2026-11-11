use serde::Deserialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
    time::Instant,
};

/// This payload is only accepted on private stdin, never in arguments or files.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionCredentials {
    pub minecraft_access_token: String,
    pub uuid: String,
    pub username: String,
}

pub struct ConnectionConfig {
    pub address: String,
    pub username: String,
    pub session: Option<SessionCredentials>,
    pub render_distance: u8,
}

#[derive(Clone, Default)]
pub struct InputState {
    pub hide_hud: bool,
    pub light_debug: u8,
    pub forward: f32,
    pub strafe: f32,
    pub jump: bool,
    pub sprint: bool,
    pub sneak: bool,
    pub sprint_tap: u64,
    pub fly_tap: u64,
    /// Minecraft yaw/pitch in degrees, not radians.
    pub yaw: f32,
    pub pitch: f32,
    pub attack: bool,
    pub use_item: u64,
    pub hotbar: u8,
    pub chat_submit: Option<String>,
    pub respawn: u64,
    pub inventory_actions: VecDeque<InventoryAction>,
}

impl InputState {
    pub fn queue_inventory(&mut self, action: InventoryAction) -> bool {
        if self.inventory_actions.len() >= 32 {
            return false;
        }
        self.inventory_actions.push_back(action);
        true
    }
}

#[derive(Clone, Debug)]
pub struct InventoryAction {
    pub menu_id: i32,
    pub epoch: u64,
    pub kind: InventoryActionKind,
}

#[derive(Clone, Debug)]
pub enum InventoryActionKind {
    OpenPlayer,
    Close,
    Pickup { slot: Option<u16>, right: bool },
    QuickMove { slot: u16 },
    SwapHotbar { slot: u16, hotbar: u8 },
    Drop { slot: u16, whole_stack: bool },
    Distribute { slots: Vec<u16>, right: bool },
    PickupAll { slot: u16 },
    PlaceRecipe { recipe_id: u32, craft_all: bool },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InventoryKind {
    #[default]
    Player,
    Crafting,
    Chest {
        rows: u8,
    },
    Dispenser,
    Hopper,
    Furnace,
    Brewing,
    Grindstone,
    Smithing,
    Cartography,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InventorySlotRole {
    Storage,
    Player,
    Hotbar,
    CraftingInput,
    Result,
    Armor,
    Offhand,
    Fuel,
    Ingredient,
}

#[derive(Clone, Debug, PartialEq)]
pub struct InventorySlot {
    pub index: u16,
    pub x: u16,
    pub y: u16,
    pub role: InventorySlotRole,
    pub stack: HotbarSlot,
    pub may_place_cursor: bool,
    pub max_count: u16,
}

#[derive(Clone, Debug, PartialEq)]
pub struct InventorySnapshot {
    pub open: bool,
    pub menu_id: i32,
    pub epoch: u64,
    pub revision: u64,
    pub kind: InventoryKind,
    pub screen: String,
    pub title: String,
    pub width: u16,
    pub height: u16,
    pub slots: Vec<InventorySlot>,
    pub cursor: HotbarSlot,
    pub properties: Vec<(u16, i16)>,
    pub recipes: Arc<Vec<RecipeSnapshot>>,
}

impl Default for InventorySnapshot {
    fn default() -> Self {
        Self {
            open: false,
            menu_id: 0,
            epoch: 0,
            revision: 0,
            kind: InventoryKind::Player,
            screen: "inventory".into(),
            title: "Inventory".into(),
            width: 176,
            height: 166,
            slots: Vec::new(),
            cursor: HotbarSlot::default(),
            properties: Vec::new(),
            recipes: Arc::new(Vec::new()),
        }
    }
}

#[derive(Clone, Copy)]
pub struct RendererConfig {
    pub render_distance: u8,
    /// Zero uses vsync; positive values use an explicit frame cap.
    pub fps_limit: u32,
}

impl Default for RendererConfig {
    fn default() -> Self {
        Self {
            render_distance: 8,
            fps_limit: 0,
        }
    }
}

pub struct SectionSnapshot {
    /// 6 cubed quart-biome climate samples, including one sample of border.
    pub biomes: Arc<[crate::weather::BiomeColors]>,
    pub position: [i32; 3],
    pub revision: u64,
    /// 16³ core plus a one-block halo. x + 18 * (z + 18 * y).
    pub blocks: Vec<u32>,
    /// Sky light in high nibble, block light in low nibble, same halo.
    pub light: Vec<u8>,
    /// bit 0: block known, bit 1: sky known; zero is unavailable, not darkness.
    pub light_known: Vec<u8>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct HotbarSlot {
    pub item_id: u32,
    pub count: u16,
    pub name: String,
    pub max_count: u16,
    pub damage: u32,
    pub max_damage: u32,
    pub enchantment_glint: bool,
    pub component_fingerprint: u64,
    pub custom_name: Option<RichText>,
    pub lore: Vec<RichText>,
    /// Visible details derived from effective components, in Java tooltip order.
    pub tooltip_lines: Vec<RichText>,
    pub hide_tooltip: bool,
    pub item_model: Option<String>,
    pub cooldown_group: String,
    pub rarity: u8,
    pub dyed_color: Option<u32>,
    pub potion_color: Option<u32>,
    pub charged: bool,
    pub model_floats: Vec<f32>,
    pub model_flags: Vec<bool>,
    pub model_strings: Vec<String>,
    pub model_colors: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RichText {
    pub plain: String,
    /// The actual component tree retains styles and translation arguments.
    pub json: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RecipeSnapshot {
    pub id: u32,
    pub result: HotbarSlot,
    pub width: u8,
    pub height: u8,
    pub ingredients: Vec<Vec<u32>>,
    pub furnace: bool,
    pub shapeless: bool,
    pub station: String,
    pub category: String,
    pub group: u32,
    pub ingredients_resolved: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HudEffect {
    pub id: u32,
    pub name: String,
    pub amplifier: u8,
    pub expires_at: Option<Instant>,
    pub ambient: bool,
    pub show_icon: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HudBossBar {
    pub id: uuid::Uuid,
    pub name: RichText,
    pub progress: f32,
    pub color: u8,
    pub overlay: u8,
    pub darken_screen: bool,
    pub play_music: bool,
    pub create_fog: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HudCooldown {
    pub group: String,
    pub started_at: Instant,
    pub ends_at: Instant,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HudText {
    pub text: RichText,
    pub received_at: Instant,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HudSnapshot {
    pub revision: u64,
    pub health: f32,
    pub previous_health: f32,
    pub health_changed_at: Option<Instant>,
    pub max_health: f32,
    pub absorption: f32,
    pub armor: u8,
    pub air: i32,
    pub max_air: i32,
    pub food: u8,
    pub saturation: f32,
    pub experience: f32,
    pub level: u32,
    /// Survival=0, creative=1, adventure=2, spectator=3.
    pub game_mode: u8,
    pub hardcore: bool,
    pub frozen_ticks: u16,
    pub attack_strength: f32,
    pub offhand: HotbarSlot,
    pub selected_item_changed_at: Option<Instant>,
    pub effects: Vec<HudEffect>,
    pub cooldowns: Vec<HudCooldown>,
    pub boss_bars: Vec<HudBossBar>,
    pub chat: Vec<HudText>,
    pub action_bar: Option<HudText>,
    pub title: Option<HudText>,
    pub subtitle: RichText,
    pub title_fade_in_ms: u64,
    pub title_stay_ms: u64,
    pub title_fade_out_ms: u64,
}

impl Default for HudSnapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            health: 20.,
            previous_health: 20.,
            health_changed_at: None,
            max_health: 20.,
            absorption: 0.,
            armor: 0,
            air: 300,
            max_air: 300,
            food: 20,
            saturation: 5.,
            experience: 0.,
            level: 0,
            game_mode: 0,
            hardcore: false,
            frozen_ticks: 0,
            attack_strength: 1.,
            offhand: HotbarSlot::default(),
            selected_item_changed_at: None,
            effects: Vec::new(),
            cooldowns: Vec::new(),
            boss_bars: Vec::new(),
            chat: Vec::new(),
            action_bar: None,
            title: None,
            subtitle: RichText::default(),
            title_fade_in_ms: 500,
            title_stay_ms: 3500,
            title_fade_out_ms: 1000,
        }
    }
}

#[derive(Clone)]
pub struct ShadowPiece {pub position:[i32;3],pub opacity:f32}
#[derive(Clone)]
pub struct EntitySnapshot {
    pub light: crate::lighting::LightSample,
    pub shadows:Vec<ShadowPiece>,
    pub id: i32,
    pub position: [f64; 3],
    pub yaw: f32,
    pub width: f32,
    pub height: f32,
    pub is_player: bool,
    pub kind: String,
    pub head_yaw: f32,
    pub pitch: f32,
    pub baby: bool,
    pub variant: String,
    pub size: u8,
    pub sheep_color: u8,
    pub sheared: bool,
    pub sitting: bool,
    pub tamed: bool,
    pub angry: bool,
    pub villager_type: String,
    pub villager_profession: String,
    pub item_id: u32,
    pub item_count: u16,
}

pub struct PlayerSkin {
    pub rgba: Vec<u8>,
    pub slim: bool,
}

pub struct SceneSnapshot {
    pub environment: crate::lighting::Environment,
    pub light_debug: crate::lighting::DebugSample,
    pub local_skin: Option<Arc<PlayerSkin>>,
    pub status: String,
    pub connected: bool,
    pub player_position: [f64; 3],
    pub eye_height: f32,
    pub fov_multiplier:f32,
    pub revision: u64,
    pub sections: HashMap<[i32; 3], Arc<SectionSnapshot>>,
    pub world_epoch: u64,
    pub hotbar: [HotbarSlot; 9],
    pub health: f32,
    pub food: u8,
    pub chat: Vec<String>,
    pub entities: Vec<EntitySnapshot>,
    pub target: Option<[i32; 3]>,
    pub inventory: Arc<InventorySnapshot>,
    pub hud: Arc<HudSnapshot>,
}

impl Default for SceneSnapshot {
    fn default() -> Self {
        Self {
            local_skin: None,
            environment: Default::default(),
            light_debug: Default::default(),
            status: "Starting Sakura…".into(),
            connected: false,
            player_position: [0.0; 3],
            eye_height: 1.62,
            fov_multiplier:1.,
            revision: 0,
            sections: HashMap::new(),
            world_epoch: 0,
            hotbar: std::array::from_fn(|_| HotbarSlot::default()),
            health: 20.0,
            food: 20,
            chat: Vec::new(),
            entities: Vec::new(),
            target: None,
            inventory: Arc::new(InventorySnapshot::default()),
            hud: Arc::new(HudSnapshot::default()),
        }
    }
}
