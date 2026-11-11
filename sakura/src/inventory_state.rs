//! Server-backed menus. Rendering consumes immutable snapshots; all writes use
//! Azalea's state-id/prediction click path, never invented crafting results.
use crate::shared::{
    HotbarSlot, InventoryAction, InventoryActionKind, InventoryKind, InventorySlot,
    InventorySlotRole as Role, InventorySnapshot, RecipeSnapshot, RichText, SceneSnapshot,
};
use azalea_client::{
    inventory::CloseContainerEvent,
    packet::game::{ReceiveGamePacketEvent, SendGamePacketEvent},
};
use azalea_entity::inventory::Inventory;
use azalea_inventory::{
    ItemStack, Menu, components,
    operations::{
        ClickOperation, PickupAllClick, PickupClick, QuickCraftClick, QuickCraftKind,
        QuickCraftStatus, QuickMoveClick, SwapClick, ThrowClick,
    },
};
use azalea_protocol::packets::game::{
    ClientboundGamePacket as Packet,
    s_container_click::{HashedStack, ServerboundContainerClick},
};
use bevy_ecs::prelude::*;
use std::{
    collections::{BTreeMap, VecDeque},
    hash::{Hash, Hasher},
    sync::Arc,
};

#[derive(Resource)]
pub struct InventoryUi {
    open: bool,
    epoch: u64,
    revision: u64,
    dirty: bool,
    properties: BTreeMap<u16, i16>,
    cached: Arc<InventorySnapshot>,
    recipes: Arc<Vec<RecipeSnapshot>>,
    burst: Option<(std::time::Instant, std::time::Instant)>,
}
impl Default for InventoryUi {
    fn default() -> Self {
        Self {
            open: false,
            epoch: 0,
            revision: 0,
            dirty: true,
            properties: BTreeMap::new(),
            cached: Arc::new(InventorySnapshot::default()),
            recipes: Arc::new(Vec::new()),
            burst: None,
        }
    }
}
impl InventoryUi {
    fn changed_menu(&mut self, open: bool) {
        self.open = open;
        self.epoch = self.epoch.wrapping_add(1);
        self.dirty = true;
        self.properties.clear();
        self.burst = None;
    }
}

pub fn is_open(ecs: &World) -> bool {
    ecs.get_resource::<InventoryUi>().is_some_and(|ui| ui.open)
}

/// These modern packets are incomplete in the pinned upstream client. Replay
/// only inventory state in wire order after its normal packet handling, fixing
/// cursor/full-content state IDs and keeping container/player slots coherent.
pub fn capture(
    mut packets: MessageReader<ReceiveGamePacketEvent>,
    mut inventories: Query<&mut Inventory>,
    mut ui: ResMut<InventoryUi>,
) {
    for event in packets.read() {
        let Ok(mut inventory) = inventories.get_mut(event.entity) else {
            continue;
        };
        apply_server_packet(&mut inventory, &mut ui, event.packet.as_ref());
    }
}

fn player_slot(protocol_slot: u32) -> Option<usize> {
    match protocol_slot {
        0..=8 => Some(protocol_slot as usize + 36),
        9..=35 => Some(protocol_slot as usize),
        36..=39 => Some(44 - protocol_slot as usize),
        40 => Some(45),
        _ => None,
    }
}

fn set_player_slot(inventory: &mut Inventory, slot: usize, stack: &ItemStack) {
    if let Some(target) = inventory.inventory_menu.slot_mut(slot) {
        *target = stack.clone();
    }
    if (9..45).contains(&slot) {
        if let Some(menu) = inventory.container_menu.as_mut() {
            let target = *menu.player_slots_range().start() + slot - 9;
            if let Some(target) = menu.slot_mut(target) {
                *target = stack.clone();
            }
        }
    }
}

fn sync_container_player(inventory: &mut Inventory) {
    let Some(menu) = inventory.container_menu.as_ref() else {
        return;
    };
    let start = *menu.player_slots_range().start();
    let stacks: Vec<_> = (0..36)
        .filter_map(|offset| menu.slot(start + offset).cloned())
        .collect();
    for (offset, stack) in stacks.into_iter().enumerate() {
        if let Some(target) = inventory.inventory_menu.slot_mut(9 + offset) {
            *target = stack;
        }
    }
}

fn apply_server_packet(inventory: &mut Inventory, ui: &mut InventoryUi, packet: &Packet) {
    if matches!(packet, Packet::ContainerSetContent(_) | Packet::ContainerSetSlot(_) | Packet::SetCursorItem(_) | Packet::SetPlayerInventory(_)) {
        let now = std::time::Instant::now();
        let first = ui.burst.map_or(now, |b| b.0);
        ui.burst = Some((first, now));
    }
    match packet {
        Packet::OpenScreen(_) => ui.changed_menu(true),
        Packet::ContainerClose(_) | Packet::Login(_) | Packet::Respawn(_) => ui.changed_menu(false),
        Packet::ContainerSetContent(p) => {
            if p.container_id == 0 {
                for (index, stack) in p.items.iter().take(46).enumerate() {
                    set_player_slot(inventory, index, stack);
                }
            } else if p.container_id == inventory.id {
                for (index, stack) in p.items.iter().take(128).enumerate() {
                    if let Some(slot) = inventory.menu_mut().slot_mut(index) {
                        *slot = stack.clone();
                    }
                }
                sync_container_player(inventory);
            }
            if p.container_id == inventory.id {
                inventory.state_id = p.state_id;
                inventory.carried = p.carried_item.clone();
            }
            ui.dirty = true;
        }
        Packet::ContainerSetSlot(p) => {
            if p.container_id == -1 {
                inventory.carried = p.item_stack.clone();
            } else if p.container_id == -2 || p.container_id == 0 {
                set_player_slot(inventory, usize::from(p.slot), &p.item_stack);
            } else if p.container_id == inventory.id {
                if let Some(slot) = inventory.menu_mut().slot_mut(usize::from(p.slot)) {
                    *slot = p.item_stack.clone();
                }
                sync_container_player(inventory);
            }
            if p.container_id == inventory.id {
                inventory.state_id = p.state_id;
            }
            ui.dirty = true;
        }
        Packet::SetCursorItem(p) => {
            inventory.carried = p.contents.clone();
            ui.dirty = true;
        }
        Packet::SetPlayerInventory(p) => {
            if let Some(slot) = player_slot(p.slot) {
                set_player_slot(inventory, slot, &p.contents);
                ui.dirty = true;
            }
        }
        Packet::RecipeBookAdd(p) => {
            let mut recipes = if p.replace {
                Vec::new()
            } else {
                ui.recipes.as_ref().clone()
            };
            for entry in p.entries.iter().take(4096) {
                if let Some(recipe) = recipe_snapshot(&entry.contents) {
                    if let Some(old) = recipes.iter_mut().find(|r| r.id == recipe.id) {
                        *old = recipe;
                    } else if recipes.len() < 4096 {
                        recipes.push(recipe);
                    }
                }
            }
            ui.recipes = Arc::new(recipes);
            ui.dirty = true;
        }
        Packet::RecipeBookRemove(p) => {
            let recipes = Arc::make_mut(&mut ui.recipes);
            recipes.retain(|r| !p.recipes.contains(&r.id));
            ui.dirty = true;
        }
        Packet::ContainerSetData(p)
            if p.container_id == inventory.id
                && (ui.properties.len() < 32 || ui.properties.contains_key(&p.id)) =>
        {
            ui.properties.insert(p.id, p.value as i16);
            ui.dirty = true;
        }
        _ => {}
    }
}

fn operation(action: &InventoryActionKind, slot_count: usize) -> Option<ClickOperation> {
    let valid = |slot: u16| usize::from(slot) < slot_count;
    match action {
        InventoryActionKind::Pickup { slot, right } if slot.is_none_or(valid) => Some(
            if *right {
                PickupClick::Right { slot: *slot }
            } else {
                PickupClick::Left { slot: *slot }
            }
            .into(),
        ),
        InventoryActionKind::QuickMove { slot } if valid(*slot) => {
            Some(QuickMoveClick::Left { slot: *slot }.into())
        }
        InventoryActionKind::SwapHotbar { slot, hotbar } if valid(*slot) && (*hotbar < 9 || *hotbar == 40) => Some(
            SwapClick {
                source_slot: *slot,
                target_slot: *hotbar,
            }
            .into(),
        ),
        InventoryActionKind::Drop { slot, whole_stack } if valid(*slot) => Some(
            if *whole_stack {
                ThrowClick::All { slot: *slot }
            } else {
                ThrowClick::Single { slot: *slot }
            }
            .into(),
        ),
        InventoryActionKind::PickupAll { slot } if valid(*slot) => Some(
            PickupAllClick {
                slot: *slot,
                reversed: false,
            }
            .into(),
        ),
        _ => None,
    }
}

/// Use the real menu transaction without unsafe optimistic quantities. The
/// pinned upstream simulator has unconditional slot permissions and an incorrect
/// stack merge. Empty changed_slots preserve the server's remote baseline, so
/// vanilla returns every changed slot and cursor through its normal correction.
fn send_click(ecs: &mut World, id: Entity, operation: ClickOperation) {
    let Some(name) = ecs.get::<azalea_world::WorldName>(id).cloned() else {
        return;
    };
    let Some(world) = ecs
        .get_resource::<azalea_world::Worlds>()
        .and_then(|w| w.get(&name))
    else {
        return;
    };
    let Some(inventory) = ecs.get::<Inventory>(id) else {
        return;
    };
    let carried_item = HashedStack::from_item_stack(&inventory.carried, &world.read().registries);
    let packet = ServerboundContainerClick {
        container_id: inventory.id,
        state_id: inventory.state_id,
        slot_num: operation.slot_num().map_or(-999, |slot| slot as i16),
        button_num: operation.button_num(),
        click_type: operation.click_type(),
        changed_slots: Default::default(),
        carried_item,
    };
    ecs.trigger(SendGamePacketEvent::new(id, packet));
}

pub fn apply(ecs: &mut World, id: Entity, actions: &VecDeque<InventoryAction>) {
    if ecs
        .get::<azalea_entity::metadata::Health>(id)
        .is_some_and(|health| health.0 <= 0.0)
    {
        if let Some(menu_id) = ecs
            .get::<Inventory>(id)
            .filter(|_| is_open(ecs))
            .map(|inventory| inventory.id)
        {
            ecs.trigger(CloseContainerEvent {
                entity: id,
                id: menu_id,
            });
            ecs.resource_mut::<InventoryUi>().changed_menu(false);
        }
        return;
    }
    for action in actions.iter().take(32) {
        let Some(inventory) = ecs.get::<Inventory>(id) else {
            return;
        };
        let menu_id = inventory.id;
        let count = inventory.menu().len();
        let Some(ui) = ecs.get_resource::<InventoryUi>() else {
            return;
        };
        if action.menu_id != menu_id || action.epoch != ui.epoch {
            continue;
        }
        match action.kind {
            InventoryActionKind::OpenPlayer if menu_id == 0 && !ui.open => {
                ecs.resource_mut::<InventoryUi>().changed_menu(true)
            }
            InventoryActionKind::Close if ui.open => {
                ecs.trigger(CloseContainerEvent {
                    entity: id,
                    id: menu_id,
                });
                ecs.resource_mut::<InventoryUi>().changed_menu(false);
            }
            InventoryActionKind::Distribute { ref slots, right } if ui.open => {
                if slots.is_empty()
                    || slots.len() > 128
                    || inventory.carried.is_empty()
                    || slots.iter().any(|slot| usize::from(*slot) >= count)
                {
                    continue;
                }
                let mut unique = Vec::with_capacity(slots.len());
                for slot in slots {
                    if !unique.contains(slot) {
                        unique.push(*slot);
                    }
                }
                let kind = if right {
                    QuickCraftKind::Right
                } else {
                    QuickCraftKind::Left
                };
                send_click(
                    ecs,
                    id,
                    ClickOperation::QuickCraft(QuickCraftClick {
                        kind: kind.clone(),
                        status: QuickCraftStatus::Start,
                    }),
                );
                for slot in unique {
                    send_click(
                        ecs,
                        id,
                        ClickOperation::QuickCraft(QuickCraftClick {
                            kind: kind.clone(),
                            status: QuickCraftStatus::Add { slot },
                        }),
                    );
                }
                send_click(
                    ecs,
                    id,
                    ClickOperation::QuickCraft(QuickCraftClick {
                        kind,
                        status: QuickCraftStatus::End,
                    }),
                );
            }
            InventoryActionKind::PlaceRecipe {
                recipe_id,
                craft_all,
            } if ui.open => {
                let supported = matches!(
                    inventory.menu(),
                    Menu::Player(_)
                        | Menu::Crafting { .. }
                        | Menu::Furnace { .. }
                        | Menu::BlastFurnace { .. }
                        | Menu::Smoker { .. }
                );
                if supported && ui.recipes.iter().any(|r| r.id == recipe_id) {
                    ecs.trigger(SendGamePacketEvent::new(
                        id,
                        azalea_protocol::packets::game::ServerboundPlaceRecipe {
                            container_id: menu_id,
                            recipe: recipe_id,
                            shift_down: craft_all,
                        },
                    ));
                }
            }
            _ if ui.open => {
                if let Some(operation) = operation(&action.kind, count) {
                    send_click(ecs, id, operation);
                    ecs.resource_mut::<InventoryUi>().dirty = true;
                }
            }
            _ => {}
        }
    }
}

pub fn item(stack: &ItemStack) -> HotbarSlot {
    match stack {
        ItemStack::Present(stack) if stack.count > 0 => {
            let patch = serde_json::to_value(&stack.component_patch).unwrap_or_default();
            let mut fingerprint = std::collections::hash_map::DefaultHasher::new();
            (stack.kind as u32).hash(&mut fingerprint);
            patch.to_string().hash(&mut fingerprint);
            let name = format!("{:?}", stack.kind);
            let cooldown_group = stack
                .get_component::<components::UseCooldown>()
                .and_then(|c| c.cooldown_group.as_ref().map(ToString::to_string))
                .unwrap_or_else(|| format!("minecraft:{}", snake_case(&name)));
            let (hide_tooltip, tooltip_lines, lore) = item_tooltip(stack);
            HotbarSlot {
                item_id: stack.kind as u32,
                count: stack.count.min(65535) as u16,
                name,
                max_count: stack
                    .get_component::<components::MaxStackSize>()
                    .map_or(64, |c| c.count.clamp(1, 99) as u16),
                damage: stack
                    .get_component::<components::Damage>()
                    .map_or(0, |c| c.amount.max(0) as u32),
                max_damage: if stack.get_component::<components::Unbreakable>().is_some() {
                    0
                } else {
                    stack
                        .get_component::<components::MaxDamage>()
                        .map_or(0, |c| c.amount.max(0) as u32)
                },
                enchantment_glint: stack
                    .get_component::<components::EnchantmentGlintOverride>()
                    .map(|c| c.show_glint)
                    .unwrap_or_else(|| {
                        stack
                            .get_component::<components::Enchantments>()
                            .is_some_and(|c| !c.levels.is_empty())
                            || stack
                                .get_component::<components::StoredEnchantments>()
                                .is_some_and(|c| !c.enchantments.is_empty())
                    }),
                component_fingerprint: fingerprint.finish(),
                custom_name: stack
                    .get_component::<components::CustomName>()
                    .map(|c| rich_text(&c.name)),
                lore,
                tooltip_lines,
                hide_tooltip,
                item_model: stack
                    .get_component::<components::ItemModel>()
                    .map(|c| c.resource_location.to_string()),
                cooldown_group,
                rarity: {
                    let rarity = stack.get_component::<components::Rarity>().map_or(0, |c| *c as u8);
                    if stack.get_component::<components::Enchantments>().is_some_and(|c| !c.levels.is_empty()) {
                        if rarity < 2 { 2 } else { 3 }
                    } else { rarity }
                },
                dyed_color: stack
                    .get_component::<components::DyedColor>()
                    .map(|c| c.rgb as u32 & 0xffffff),
                potion_color: stack
                    .get_component::<components::PotionContents>()
                    .and_then(|c| c.custom_color.map(|v| v as u32 & 0xffffff)),
                charged: stack
                    .get_component::<components::ChargedProjectiles>()
                    .is_some_and(|c| !c.items.is_empty()),
                model_floats: stack
                    .get_component::<components::CustomModelData>()
                    .map_or_else(Vec::new, |c| {
                        c.floats
                            .iter()
                            .take(64)
                            .map(|v| if v.is_finite() { *v } else { 0. })
                            .collect()
                    }),
                model_flags: stack
                    .get_component::<components::CustomModelData>()
                    .map_or_else(Vec::new, |c| c.flags.iter().take(64).copied().collect()),
                model_strings: stack
                    .get_component::<components::CustomModelData>()
                    .map_or_else(Vec::new, |c| {
                        c.strings
                            .iter()
                            .take(64)
                            .map(|v| v.chars().take(256).collect())
                            .collect()
                    }),
                model_colors: stack
                    .get_component::<components::CustomModelData>()
                    .map_or_else(Vec::new, |c| {
                        c.colors
                            .iter()
                            .take(64)
                            .map(|v| *v as u32 & 0xffffff)
                            .collect()
                    }),
            }
        }
        _ => HotbarSlot::default(),
    }
}

fn tooltip_component(value: serde_json::Value, plain: String) -> RichText {
    RichText { plain, json: value.to_string() }
}

/// Tooltips consume the effective component defaults as well as server patches.
/// Unknown data-registry enchantments are intentionally omitted here: protocol
/// indices cannot safely be interpreted as built-in enchantment names.
fn item_tooltip(stack: &azalea_inventory::ItemStackData) -> (bool, Vec<RichText>, Vec<RichText>) {
    use azalea_core::attribute_modifier_operation::AttributeModifierOperation as Operation;
    use azalea_registry::builtin::{Attribute, DataComponentKind as Kind};
    use components::{AttributeModifierDisplay as Display, EquipmentSlotGroup as Slot};
    let display = stack.get_component::<components::TooltipDisplay>();
    let hidden = display.as_ref().is_some_and(|d| d.hide_tooltip);
    let visible = |kind| !hidden && display.as_ref().is_none_or(|d| !d.hidden_components.contains(&kind));
    let lore: Vec<_> = if visible(Kind::Lore) {
        stack.get_component::<components::Lore>().map_or_else(Vec::new, |c| c.lines.iter().take(24).map(rich_text).collect())
    } else { Vec::new() };
    let mut lines = Vec::new();
    for line in &lore {
        let contents = serde_json::from_str::<serde_json::Value>(&line.json)
            .unwrap_or_else(|_| serde_json::json!({"text":line.plain}));
        lines.push(tooltip_component(serde_json::json!({"color":"dark_purple","italic":true,"extra":[contents]}), line.plain.clone()));
    }
    if visible(Kind::AttributeModifiers) {
        if let Some(attributes) = stack.get_component::<components::AttributeModifiers>() {
            for group in [Slot::Any, Slot::Mainhand, Slot::Offhand, Slot::Hand, Slot::Feet, Slot::Legs,
                Slot::Chest, Slot::Head, Slot::Armor, Slot::Body] {
                let mut group_lines = Vec::new();
                for entry in attributes.modifiers.iter().take(64).filter(|e| e.slot == group) {
                    if let Display::Hidden = &entry.display { continue; }
                    if let Display::Override { text } = &entry.display { group_lines.push(rich_text(text)); continue; }
                    let id = entry.modifier.id.to_string();
                    let base = match (entry.kind, id.as_str()) {
                        (Attribute::AttackDamage, "minecraft:base_attack_damage") => Some(1.),
                        (Attribute::AttackSpeed, "minecraft:base_attack_speed") => Some(4.),
                        _ => None,
                    };
                    let mut amount = entry.modifier.amount;
                    if !amount.is_finite() { continue; }
                    if let Some(base) = base { amount += base; }
                    let operation = match entry.modifier.operation {
                        Operation::AddValue => 0,
                        Operation::AddMultipliedBase => 1,
                        Operation::AddMultipliedTotal => 2,
                    };
                    let displayed = if operation != 0 { amount * 100. }
                        else if entry.kind == Attribute::KnockbackResistance { amount * 10. }
                        else { amount };
                    if !displayed.is_finite() || (amount == 0. && base.is_none()) { continue; }
                    let amount_text = format!("{:.2}", if base.is_some() { displayed } else { displayed.abs() }).trim_end_matches('0').trim_end_matches('.').to_string();
                    let attribute = entry.kind.to_str().trim_start_matches("minecraft:").to_string();
                    let (prefix, color) = if base.is_some() { ("equals", "dark_green") }
                        else if amount > 0. { ("plus", "blue") } else { ("take", "red") };
                    let translated = serde_json::json!({"translate":format!("attribute.modifier.{prefix}.{operation}"),
                        "with":[amount_text,{"translate":format!("attribute.name.{attribute}")}],"color":color});
                    // Java prefixes base attack attributes with one space.
                    let value = if base.is_some() { serde_json::json!({"text":" ","extra":[translated]}) } else { translated };
                    group_lines.push(tooltip_component(value, format!("{amount_text} {attribute}")));
                }
                if !group_lines.is_empty() && lines.len() < 48 {
                    lines.push(tooltip_component(serde_json::json!({"text":" "}), " ".into()));
                    let group = format!("{group:?}").to_ascii_lowercase();
                    lines.push(tooltip_component(serde_json::json!({"translate":format!("item.modifiers.{group}"),"color":"gray"}), format!("item.modifiers.{group}")));
                    lines.extend(group_lines.into_iter().take(48usize.saturating_sub(lines.len())));
                }
            }
        }
    }
    if visible(Kind::Unbreakable) && stack.get_component::<components::Unbreakable>().is_some() {
        lines.push(tooltip_component(serde_json::json!({"translate":"item.unbreakable","color":"blue"}), "Unbreakable".into()));
    }
    if visible(Kind::DyedColor) && stack.get_component::<components::DyedColor>().is_some() {
        lines.push(tooltip_component(serde_json::json!({"translate":"item.dyed","color":"gray","italic":true}), "Dyed".into()));
    }
    lines.truncate(50);
    (hidden, lines, lore)
}

pub fn snake_case(name: &str) -> String {
    let mut result = String::with_capacity(name.len() + 4);
    for (index, c) in name.chars().enumerate() {
        if c.is_ascii_uppercase() && index > 0 {
            result.push('_');
        }
        result.push(c.to_ascii_lowercase());
    }
    result
}

pub fn rich_text(value: &(impl serde::Serialize + std::fmt::Display)) -> RichText {
    let plain: String = value
        .to_string()
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(4096)
        .collect();
    let json = serde_json::to_string(value)
        .ok()
        .filter(|s| s.len() <= 32768)
        .unwrap_or_else(|| serde_json::json!({"text":plain}).to_string());
    RichText { plain, json }
}

fn screen(menu: &Menu) -> &'static str {
    match menu {
        Menu::Player(_) => "inventory",
        Menu::Crafting { .. } => "crafting_table",
        Menu::Generic9x1 { .. }
        | Menu::Generic9x2 { .. }
        | Menu::Generic9x3 { .. }
        | Menu::Generic9x4 { .. }
        | Menu::Generic9x5 { .. }
        | Menu::Generic9x6 { .. } => "generic_54",
        Menu::ShulkerBox { .. } => "shulker_box",
        Menu::Furnace { .. } => "furnace",
        Menu::BlastFurnace { .. } => "blast_furnace",
        Menu::Smoker { .. } => "smoker",
        Menu::Generic3x3 { .. } => "dispenser",
        Menu::Crafter3x3 { .. } => "crafter",
        Menu::Hopper { .. } => "hopper",
        Menu::BrewingStand { .. } => "brewing_stand",
        Menu::Grindstone { .. } => "grindstone",
        Menu::Smithing { .. } => "smithing",
        Menu::CartographyTable { .. } => "cartography_table",
        _ => "unsupported",
    }
}

fn may_place_cursor(menu: &Menu, index: usize, role: Role, cursor: &ItemStack) -> bool {
    if role == Role::Result {
        return false;
    }
    let Some(cursor) = cursor.as_present() else {
        return false;
    };
    if role == Role::Armor {
        let expected = match index {
            5 => components::EquipmentSlot::Head,
            6 => components::EquipmentSlot::Chest,
            7 => components::EquipmentSlot::Legs,
            8 => components::EquipmentSlot::Feet,
            _ => return false,
        };
        if !cursor
            .get_component::<components::Equippable>()
            .is_some_and(|c| c.slot == expected)
        {
            return false;
        }
    }
    match menu.slot(index).and_then(ItemStack::as_present) {
        Some(stack) => {
            stack.is_same_item_and_components(cursor)
                && stack.count
                    < cursor
                        .get_component::<components::MaxStackSize>()
                        .map_or(64, |c| c.count)
                        .min(if role == Role::Armor { 1 } else { 64 })
        }
        None => true,
    }
}

fn recipe_snapshot(
    entry: &azalea_protocol::packets::game::c_recipe_book_add::RecipeDisplayEntry,
) -> Option<RecipeSnapshot> {
    use azalea_protocol::common::recipe::RecipeDisplayData as R;
    let (width, height, ingredients, result, furnace, station) = match &entry.display {
        R::Shaped(r) => (
            r.width.min(3) as u8,
            r.height.min(3) as u8,
            r.ingredients.as_slice(),
            &r.result,
            false,
            &r.crafting_station,
        ),
        R::Shapeless(r) => (
            if r.ingredients.len() <= 4 {
                r.ingredients.len().min(2) as u8
            } else {
                3
            },
            if r.ingredients.len() <= 4 {
                ((r.ingredients.len() + 1) / 2) as u8
            } else {
                ((r.ingredients.len() + 2) / 3).min(3) as u8
            },
            r.ingredients.as_slice(),
            &r.result,
            false,
            &r.crafting_station,
        ),
        R::Furnace(r) => (
            1,
            1,
            std::slice::from_ref(&r.ingredient),
            &r.result,
            true,
            &r.crafting_station,
        ),
        _ => return None,
    };
    let result = display_items(result, 0).into_iter().next()?;
    Some(RecipeSnapshot {
        id: entry.id,
        result: item(&result),
        width,
        height,
        ingredients: ingredients
            .iter()
            .take(9)
            .map(|d| {
                display_items(d, 0)
                    .iter()
                    .map(|s| s.kind() as u32)
                    .collect()
            })
            .collect(),
        furnace,
        shapeless: matches!(&entry.display, R::Shapeless(_)),
        station: display_items(station, 0)
            .first()
            .map(|s| snake_case(&format!("{:?}", s.kind())))
            .unwrap_or_default(),
        category: snake_case(&format!("{:?}", entry.category)),
        group: entry.group,
        ingredients_resolved: ingredients.iter().all(|d| {
            matches!(d, azalea_protocol::common::recipe::SlotDisplayData::Empty)
                || !display_items(d, 0).is_empty()
        }),
    })
}

fn display_items(
    display: &azalea_protocol::common::recipe::SlotDisplayData,
    depth: u8,
) -> Vec<ItemStack> {
    use azalea_protocol::common::recipe::SlotDisplayData as D;
    if depth > 8 {
        return Vec::new();
    }
    match display {
        D::Item(d) => vec![ItemStack::new(d.item, 1)],
        D::ItemStack(d) => vec![d.stack.clone()],
        D::WithRemainder(d) => display_items(&d.input, depth + 1),
        D::Composite(d) => d
            .contents
            .iter()
            .take(64)
            .flat_map(|v| display_items(v, depth + 1))
            .take(64)
            .collect(),
        D::WithAnyPotion(d) => display_items(&d.contents, depth + 1),
        D::OnlyWithComponent(d) => display_items(&d.contents, depth + 1),
        _ => Vec::new(),
    }
}

fn layout(menu: &Menu) -> (InventoryKind, u16, u16, Vec<(u16, u16, Role)>) {
    let mut positions = vec![(8, 18, Role::Storage); menu.len()];
    let kind = match menu {
        Menu::Player(_) => InventoryKind::Player,
        Menu::Crafting { .. } => InventoryKind::Crafting,
        Menu::Generic9x1 { .. } => InventoryKind::Chest { rows: 1 },
        Menu::Generic9x2 { .. } => InventoryKind::Chest { rows: 2 },
        Menu::Generic9x3 { .. } | Menu::ShulkerBox { .. } => InventoryKind::Chest { rows: 3 },
        Menu::Generic9x4 { .. } => InventoryKind::Chest { rows: 4 },
        Menu::Generic9x5 { .. } => InventoryKind::Chest { rows: 5 },
        Menu::Generic9x6 { .. } => InventoryKind::Chest { rows: 6 },
        Menu::Generic3x3 { .. } | Menu::Crafter3x3 { .. } => InventoryKind::Dispenser,
        Menu::Hopper { .. } => InventoryKind::Hopper,
        Menu::Furnace { .. } | Menu::BlastFurnace { .. } | Menu::Smoker { .. } => {
            InventoryKind::Furnace
        }
        Menu::BrewingStand { .. } => InventoryKind::Brewing,
        Menu::Grindstone { .. } => InventoryKind::Grindstone,
        Menu::Smithing { .. } => InventoryKind::Smithing,
        Menu::CartographyTable { .. } => InventoryKind::Cartography,
        _ => InventoryKind::Other,
    };
    let (player_y, height) = match kind {
        InventoryKind::Chest { rows } => (u16::from(rows) * 18 + 31, u16::from(rows) * 18 + 114),
        InventoryKind::Hopper => (51, 133),
        _ => (84, 166),
    };
    let first_player = *menu.player_slots_range().start();
    for index in 0..menu.len() {
        positions[index] = if menu.player_slots_range().contains(&index) {
            let offset = index - first_player;
            if offset < 27 {
                (
                    8 + (offset % 9) as u16 * 18,
                    player_y + (offset / 9) as u16 * 18,
                    Role::Player,
                )
            } else {
                (8 + (offset - 27) as u16 * 18, player_y + 58, Role::Hotbar)
            }
        } else {
            (
                8 + (index % 9) as u16 * 18,
                18 + (index / 9) as u16 * 18,
                Role::Storage,
            )
        };
    }
    match kind {
        InventoryKind::Player => {
            positions[0] = (154, 28, Role::Result);
            for index in 1..=4 {
                positions[index] = (
                    98 + ((index - 1) % 2) as u16 * 18,
                    18 + ((index - 1) / 2) as u16 * 18,
                    Role::CraftingInput,
                );
            }
            for index in 5..=8 {
                positions[index] = (8, 8 + (index - 5) as u16 * 18, Role::Armor);
            }
            positions[45] = (77, 62, Role::Offhand);
        }
        InventoryKind::Crafting => {
            positions[0] = (124, 35, Role::Result);
            for index in 1..=9 {
                positions[index] = (
                    30 + ((index - 1) % 3) as u16 * 18,
                    17 + ((index - 1) / 3) as u16 * 18,
                    Role::CraftingInput,
                );
            }
        }
        InventoryKind::Dispenser => {
            for index in 0..9 {
                positions[index] = (
                    62 + (index % 3) as u16 * 18,
                    17 + (index / 3) as u16 * 18,
                    Role::Storage,
                );
            }
        }
        InventoryKind::Hopper => {
            for index in 0..5 {
                positions[index] = (44 + index as u16 * 18, 20, Role::Storage);
            }
        }
        InventoryKind::Furnace => {
            positions[0] = (56, 17, Role::Ingredient);
            positions[1] = (56, 53, Role::Fuel);
            positions[2] = (116, 35, Role::Result);
        }
        InventoryKind::Grindstone => {
            positions[0]=(49,19,Role::Ingredient);positions[1]=(49,40,Role::Ingredient);positions[2]=(129,34,Role::Result);
        }
        InventoryKind::Smithing => {
            positions[0]=(8,48,Role::Ingredient);positions[1]=(26,48,Role::Ingredient);positions[2]=(44,48,Role::Ingredient);positions[3]=(98,48,Role::Result);
        }
        InventoryKind::Cartography => {
            positions[0]=(15,15,Role::Ingredient);positions[1]=(15,52,Role::Ingredient);positions[2]=(145,39,Role::Result);
        }
        InventoryKind::Brewing => {
            for index in 0..3 {
                positions[index] = (56 + index as u16 * 18, 51, Role::Storage);
            }
            positions[3] = (80, 17, Role::Ingredient);
            positions[4] = (17, 17, Role::Fuel);
        }
        _ => {}
    }
    (kind, 176, height, positions)
}

pub fn publish(ecs: &mut World, id: Entity, scene: &mut SceneSnapshot) {
    let Some(inventory) = ecs.get::<Inventory>(id) else {
        return;
    };
    let Some(ui) = ecs.get_resource::<InventoryUi>() else {
        return;
    };
    // Native close observers may finish after the frame that hides the panel.
    // Catch that ID transition even when no server packet follows the close.
    if !ui.dirty && ui.cached.menu_id == inventory.id {
        if !Arc::ptr_eq(&scene.inventory, &ui.cached) {
            scene.inventory = ui.cached.clone();
        }
        return;
    }
    // A single vanilla click can update ingredients, result and cursor in
    // separate packets. Present the burst together, without predicting items.
    if ui.cached.open && ui.cached.menu_id == inventory.id && ui.cached.epoch == ui.epoch
        && ui.burst.is_some_and(|(first,last)| last.elapsed().as_millis() < 16 && first.elapsed().as_millis() < 50) {
        scene.inventory = ui.cached.clone();
        return;
    }
    let (kind, width, height, positions) = layout(inventory.menu());
    let title = inventory
        .container_menu_title
        .as_ref()
        .map(|title| title.to_string())
        .unwrap_or_else(|| "Inventory".into())
        .chars()
        .filter(|c| !c.is_control())
        .take(80)
        .collect();
    let mut snapshot = InventorySnapshot {
        open: ui.open,
        menu_id: inventory.id,
        epoch: ui.epoch,
        revision: ui.revision,
        kind,
        screen: screen(inventory.menu()).into(),
        title,
        width,
        height,
        slots: positions
            .into_iter()
            .enumerate()
            .map(|(index, (x, y, role))| InventorySlot {
                index: index as u16,
                x,
                y,
                role,
                stack: inventory.menu().slot(index).map(item).unwrap_or_default(),
                may_place_cursor: may_place_cursor(
                    inventory.menu(),
                    index,
                    role,
                    &inventory.carried,
                ),
                max_count: if role == Role::Armor { 1 } else { 64 },
            })
            .collect(),
        recipes: ui.recipes.clone(),
        cursor: item(&inventory.carried),
        properties: ui
            .properties
            .iter()
            .map(|(key, value)| (*key, *value))
            .collect(),
    };
    let mut ui = ecs.resource_mut::<InventoryUi>();
    ui.dirty = false;
    ui.burst = None;
    if snapshot != *ui.cached {
        ui.revision = ui.revision.wrapping_add(1);
        snapshot.revision = ui.revision;
        ui.cached = Arc::new(snapshot);
    }
    scene.inventory = ui.cached.clone();
}

#[cfg(test)]
mod tests {
    use super::*;
    use azalea_registry::builtin::{ItemKind, MenuKind};
    #[test]
    fn packet_burst_keeps_last_complete_snapshot_until_settled() {
        let mut ecs=World::new();let id=ecs.spawn(Inventory::default()).id();
        let mut ui=InventoryUi::default();ui.open=true;ecs.insert_resource(ui);
        let mut scene=SceneSnapshot::default();publish(&mut ecs,id,&mut scene);let old=scene.inventory.clone();
        {let mut ui=ecs.resource_mut::<InventoryUi>();ui.dirty=true;let now=std::time::Instant::now();ui.burst=Some((now,now));}
        publish(&mut ecs,id,&mut scene);assert!(Arc::ptr_eq(&old,&scene.inventory));
        {let mut ui=ecs.resource_mut::<InventoryUi>();let past=std::time::Instant::now()-std::time::Duration::from_millis(60);ui.burst=Some((past,past));}
        publish(&mut ecs,id,&mut scene);assert!(ecs.resource::<InventoryUi>().burst.is_none());
    }
    #[test]
    fn layouts_preserve_real_slot_indices_and_fit_the_panel() {
        for menu in [
            Menu::Player(Default::default()),
            Menu::from_kind(MenuKind::Crafting),
            Menu::from_kind(MenuKind::Generic9x6),
            Menu::from_kind(MenuKind::Furnace),
            Menu::from_kind(MenuKind::Hopper),
        ] {
            let (_, width, height, positions) = layout(&menu);
            assert_eq!(positions.len(), menu.len());
            assert!(
                positions
                    .iter()
                    .all(|(x, y, _)| *x + 16 <= width && *y + 16 <= height)
            );
            assert_eq!(
                positions
                    .iter()
                    .filter(|(_, _, role)| *role == Role::Hotbar)
                    .count(),
                9
            );
        }
    }
    #[test]
    fn modern_packets_restore_cursor_state_id_and_player_slots() {
        use azalea_protocol::packets::game::{
            ClientboundContainerSetContent, ClientboundSetCursorItem, ClientboundSetPlayerInventory,
        };
        let mut inventory = Inventory::default();
        let mut ui = InventoryUi::default();
        apply_server_packet(
            &mut inventory,
            &mut ui,
            &Packet::ContainerSetContent(ClientboundContainerSetContent {
                container_id: 0,
                state_id: 42,
                items: vec![ItemStack::Empty; 46],
                carried_item: ItemStack::new(ItemKind::OakPlanks, 12),
            }),
        );
        assert_eq!(inventory.state_id, 42);
        assert_eq!(inventory.carried.count(), 12);
        apply_server_packet(
            &mut inventory,
            &mut ui,
            &Packet::SetCursorItem(ClientboundSetCursorItem {
                contents: ItemStack::Empty,
            }),
        );
        assert!(inventory.carried.is_empty());
        apply_server_packet(
            &mut inventory,
            &mut ui,
            &Packet::SetPlayerInventory(ClientboundSetPlayerInventory {
                slot: 0,
                contents: ItemStack::new(ItemKind::Stone, 16),
            }),
        );
        assert_eq!(inventory.inventory_menu.slot(36).unwrap().count(), 16);
        assert_eq!(player_slot(36), Some(8));
        assert_eq!(player_slot(39), Some(5));
        assert_eq!(player_slot(40), Some(45));
        assert_eq!(player_slot(41), None);
    }
    #[test]
    fn queued_actions_are_bounded_and_invalid_slots_cannot_reach_native_clicks() {
        let mut input = crate::shared::InputState::default();
        for _ in 0..32 {
            assert!(input.queue_inventory(InventoryAction {
                menu_id: 0,
                epoch: 0,
                kind: InventoryActionKind::OpenPlayer
            }));
        }
        assert!(!input.queue_inventory(InventoryAction {
            menu_id: 0,
            epoch: 0,
            kind: InventoryActionKind::Close
        }));
        assert!(
            operation(
                &InventoryActionKind::Pickup {
                    slot: Some(46),
                    right: false
                },
                46
            )
            .is_none()
        );
        assert!(operation(&InventoryActionKind::SwapHotbar { slot: 0, hotbar: 9 }, 46).is_none());
        assert!(
            operation(
                &InventoryActionKind::Pickup {
                    slot: None,
                    right: true
                },
                46
            )
            .is_some()
        );
    }
    #[test]
    fn unchanged_inventory_reuses_snapshot_and_stale_menu_actions_are_rejected() {
        let mut ecs = World::new();
        ecs.init_resource::<InventoryUi>();
        let id = ecs.spawn(Inventory::default()).id();
        let mut scene = SceneSnapshot::default();
        publish(&mut ecs, id, &mut scene);
        let first = scene.inventory.clone();
        publish(&mut ecs, id, &mut scene);
        assert!(Arc::ptr_eq(&first, &scene.inventory));
        apply(
            &mut ecs,
            id,
            &VecDeque::from([InventoryAction {
                menu_id: 0,
                epoch: 0,
                kind: InventoryActionKind::OpenPlayer,
            }]),
        );
        publish(&mut ecs, id, &mut scene);
        assert!(scene.inventory.open);
        assert_eq!(scene.inventory.epoch, 1);
        apply(
            &mut ecs,
            id,
            &VecDeque::from([InventoryAction {
                menu_id: 0,
                epoch: 0,
                kind: InventoryActionKind::Close,
            }]),
        );
        assert!(is_open(&ecs));
    }
    #[test]
    fn deferred_container_close_refreshes_player_snapshot_without_a_server_packet() {
        let mut ecs = World::new();
        ecs.init_resource::<InventoryUi>();
        let id = ecs
            .spawn(Inventory {
                id: 7,
                container_menu: Some(Menu::from_kind(MenuKind::Generic9x3)),
                ..Default::default()
            })
            .id();
        let mut scene = SceneSnapshot::default();
        publish(&mut ecs, id, &mut scene);
        assert_eq!(scene.inventory.menu_id, 7);
        {
            let mut inventory = ecs.get_mut::<Inventory>(id).unwrap();
            inventory.id = 0;
            inventory.container_menu = None;
        }
        publish(&mut ecs, id, &mut scene);
        assert_eq!(scene.inventory.menu_id, 0);
        assert_eq!(scene.inventory.kind, InventoryKind::Player);
        apply(
            &mut ecs,
            id,
            &VecDeque::from([InventoryAction {
                menu_id: 0,
                epoch: scene.inventory.epoch,
                kind: InventoryActionKind::OpenPlayer,
            }]),
        );
        assert!(is_open(&ecs));
    }
    #[test]
    fn stack_identity_ignores_quantity_but_preserves_data_and_durability() {
        let one = ItemStack::new(ItemKind::DiamondSword, 1);
        let damaged = one
            .clone()
            .with_component(components::Damage { amount: 100 });
        let a = item(&one);
        let b = item(&damaged);
        assert_eq!(a.max_count, 1);
        assert_eq!(a.max_damage, 1561);
        assert_eq!(b.damage, 100);
        assert_ne!(a.component_fingerprint, b.component_fingerprint);
        assert_eq!(
            item(&ItemStack::new(ItemKind::Stone, 1)).component_fingerprint,
            item(&ItemStack::new(ItemKind::Stone, 64)).component_fingerprint
        );
        let unbreakable = damaged.with_component(components::Unbreakable);
        assert_eq!(item(&unbreakable).max_damage, 0);
        assert_eq!(
            item(&ItemStack::new(ItemKind::EnderPearl, 1)).cooldown_group,
            "minecraft:ender_pearl"
        );
    }
    #[test]
    fn effective_tool_attributes_match_java_pickaxe_tooltip_and_hidden_components() {
        use azalea_registry::builtin::DataComponentKind;
        let pickaxe = ItemStack::new(ItemKind::DiamondPickaxe, 1);
        let snapshot = item(&pickaxe);
        assert_eq!(snapshot.tooltip_lines.len(), 4);
        let header: serde_json::Value = serde_json::from_str(&snapshot.tooltip_lines[1].json).unwrap();
        assert_eq!(header["translate"], "item.modifiers.mainhand");
        let damage: serde_json::Value = serde_json::from_str(&snapshot.tooltip_lines[2].json).unwrap();
        assert_eq!(damage["extra"][0]["with"][0], "5");
        assert_eq!(damage["extra"][0]["color"], "dark_green");
        let speed: serde_json::Value = serde_json::from_str(&snapshot.tooltip_lines[3].json).unwrap();
        assert_eq!(speed["extra"][0]["with"][0], "1.2");
        let hidden = pickaxe.clone().with_component(components::TooltipDisplay {
            hide_tooltip: false, hidden_components: vec![DataComponentKind::AttributeModifiers],
        });
        assert!(item(&hidden).tooltip_lines.is_empty());
        assert_eq!(item(&hidden).max_damage, snapshot.max_damage, "display controls cannot mutate actual item properties");
        let hidden = pickaxe.with_component(components::TooltipDisplay { hide_tooltip: true, hidden_components: Vec::new() });
        assert!(item(&hidden).hide_tooltip); assert!(item(&hidden).tooltip_lines.is_empty());
    }
    #[test]
    fn tooltip_component_filters_hide_unbreakable_without_changing_durability_logic() {
        use azalea_registry::builtin::DataComponentKind;
        let item_stack = ItemStack::new(ItemKind::DiamondPickaxe, 1).with_component(components::Unbreakable);
        assert!(item(&item_stack).tooltip_lines.iter().any(|line| line.json.contains("item.unbreakable")));
        let hidden = item_stack.with_component(components::TooltipDisplay {
            hide_tooltip: false, hidden_components: vec![DataComponentKind::Unbreakable],
        });
        assert!(!item(&hidden).tooltip_lines.iter().any(|line| line.json.contains("item.unbreakable")));
        assert_eq!(item(&hidden).max_damage, 0);
    }
}
