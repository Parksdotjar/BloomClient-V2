//! Bounded server HUD state. Immutable snapshots change on data changes; timed
//! animations use monotonic timestamps without copying every frame.
use crate::{
    inventory_state::{item, rich_text, snake_case},
    shared::*,
};
use azalea_client::{
    attack::AttackStrengthScale,
    chat::{ChatPacket, ChatReceivedEvent},
    local_player::{Hunger, LocalGameMode},
    packet::game::ReceiveGamePacketEvent,
};
use azalea_core::{
    attribute_modifier_operation::AttributeModifierOperation, entity_id::MinecraftEntityId,
};
use azalea_entity::{
    EntityDataValue,
    inventory::Inventory,
    metadata::{AirSupply, Health, PlayerAbsorption, TicksFrozen},
};
use azalea_protocol::packets::game::{
    ClientboundGamePacket as Packet, c_boss_event::Operation as BossOperation,
    c_update_attributes::AttributeSnapshot,
};
use azalea_registry::builtin::Attribute;
use bevy_ecs::prelude::*;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};

#[derive(Resource)]
pub struct HudState {
    data: HudSnapshot,
    cached: Arc<HudSnapshot>,
    dirty: bool,
    selected_identity: Option<(u32, u64)>,
    last_sample: Instant,
    // Azalea's generated metadata bundle uses i32::default() for air, but the
    // wire default is 300 and servers need not send unchanged metadata. Apply
    // the lifecycle default or the latest explicit packet once to the ECS.
    pending_air: Option<i32>,
}
impl Default for HudState {
    fn default() -> Self {
        Self {
            data: HudSnapshot::default(),
            cached: Arc::new(HudSnapshot::default()),
            dirty: true,
            selected_identity: None,
            last_sample: Instant::now() - Duration::from_secs(1),
            pending_air: Some(300),
        }
    }
}

fn finite(value: f32, fallback: f32, max: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0., max)
    } else {
        fallback
    }
}
fn attribute_value(value: &AttributeSnapshot) -> f64 {
    let mut base = value.base;
    for m in &value.modifiers {
        if matches!(m.operation, AttributeModifierOperation::AddValue) {
            base += m.amount;
        }
    }
    let mut total = base;
    for m in &value.modifiers {
        if matches!(m.operation, AttributeModifierOperation::AddMultipliedBase) {
            total += base * m.amount;
        }
    }
    for m in &value.modifiers {
        if matches!(m.operation, AttributeModifierOperation::AddMultipliedTotal) {
            total *= 1. + m.amount;
        }
    }
    total
}

impl HudState {
    fn set_health(&mut self, health: f32, now: Instant) {
        let health = finite(health, self.data.health, 1024.);
        if health != self.data.health {
            self.data.previous_health = self.data.health;
            self.data.health = health;
            self.data.health_changed_at = Some(now);
            self.dirty = true;
        }
    }

    fn packet(&mut self, packet: &Packet, local_id: Option<i32>, now: Instant) {
        match packet {
            Packet::Login(p) => {
                self.data = HudSnapshot::default();
                self.data.hardcore = p.hardcore;
                self.data.game_mode = p.common.game_type as u8;
                self.selected_identity = None;
                self.pending_air = Some(300);
            }
            Packet::Respawn(p) => {
                self.data.effects.clear();
                self.data.cooldowns.clear();
                self.data.boss_bars.clear();
                self.data.game_mode = p.common.game_type as u8;
                self.data.title = None;
                self.data.action_bar = None;
                self.selected_identity = None;
                // KEEP_ENTITY_DATA=2 preserves air across dimension changes.
                if p.data_to_keep & 2 == 0 {
                    self.pending_air = Some(300);
                }
            }
            Packet::SetEntityData(p) if Some(p.id.0) == local_id => {
                let Some(air) = p.packed_items.0.iter().find_map(|item| {
                    if item.index == 1 {
                        if let EntityDataValue::Int(air) = item.value {
                            return Some(air);
                        }
                    }
                    None
                }) else {
                    return;
                };
                // Process packet order, including a real zero/negative value
                // arriving in the same batch as login or respawn.
                self.pending_air = Some(air);
            }
            Packet::SetHealth(p) => {
                self.set_health(p.health, now);
                self.data.food = p.food.min(20) as u8;
                self.data.saturation = finite(p.saturation, 0., 20.);
            }
            Packet::SetExperience(p) => {
                self.data.experience = finite(p.experience_progress, 0., 1.);
                self.data.level = p.experience_level;
            }
            Packet::Cooldown(p) => {
                let group = p.cooldown_group.to_string();
                self.data
                    .cooldowns
                    .retain(|c| c.group != group && c.ends_at > now);
                if p.duration > 0 && self.data.cooldowns.len() < 128 {
                    self.data.cooldowns.push(HudCooldown {
                        group,
                        started_at: now,
                        ends_at: now + Duration::from_millis(p.duration.min(1728000) as u64 * 50),
                    });
                }
            }
            Packet::UpdateAttributes(p) if Some(p.entity_id.0) == local_id => {
                for value in p.values.iter().take(128) {
                    let total = attribute_value(value) as f32;
                    match value.attribute {
                        Attribute::MaxHealth => {
                            self.data.max_health = finite(total, 20., 1024.).max(1.)
                        }
                        Attribute::Armor => self.data.armor = finite(total, 0., 255.).ceil() as u8,
                        _ => {}
                    }
                }
            }
            Packet::UpdateMobEffect(p) if Some(p.entity_id.0) == local_id => {
                let effect = HudEffect {
                    id: p.mob_effect as u32,
                    name: snake_case(&format!("{:?}", p.mob_effect)),
                    amplifier: p.data.amplifier.clamp(0, 255) as u8,
                    expires_at: if p.data.duration < 0 {
                        None
                    } else {
                        Some(now + Duration::from_millis(p.data.duration.min(1728000) as u64 * 50))
                    },
                    ambient: p.data.flags.ambient,
                    show_icon: p.data.flags.show_icon,
                };
                if let Some(old) = self.data.effects.iter_mut().find(|e| e.id == effect.id) {
                    *old = effect;
                } else if self.data.effects.len() < 64 {
                    self.data.effects.push(effect);
                }
            }
            Packet::RemoveMobEffect(p) if Some(p.entity_id.0) == local_id => {
                self.data.effects.retain(|e| e.id != p.effect as u32)
            }
            Packet::BossEvent(p) => match &p.operation {
                BossOperation::Add(v) => {
                    self.data.boss_bars.retain(|bar| bar.id != p.id);
                    if self.data.boss_bars.len() < 32 {
                        self.data.boss_bars.push(HudBossBar {
                            id: p.id,
                            name: rich_text(&v.name),
                            progress: finite(v.progress, 0., 1.),
                            color: v.style.color as u8,
                            overlay: v.style.overlay as u8,
                            darken_screen: v.properties.darken_screen,
                            play_music: v.properties.play_music,
                            create_fog: v.properties.create_world_fog,
                        });
                    }
                }
                BossOperation::Remove => self.data.boss_bars.retain(|bar| bar.id != p.id),
                change => {
                    if let Some(bar) = self.data.boss_bars.iter_mut().find(|bar| bar.id == p.id) {
                        match change {
                            BossOperation::UpdateProgress(v) => {
                                bar.progress = finite(*v, bar.progress, 1.)
                            }
                            BossOperation::UpdateName(v) => bar.name = rich_text(v),
                            BossOperation::UpdateStyle(v) => {
                                bar.color = v.color as u8;
                                bar.overlay = v.overlay as u8;
                            }
                            BossOperation::UpdateProperties(v) => {
                                bar.darken_screen = v.darken_screen;
                                bar.play_music = v.play_music;
                                bar.create_fog = v.create_world_fog;
                            }
                            _ => {}
                        }
                    }
                }
            },
            Packet::SetActionBarText(p) => {
                self.data.action_bar = Some(HudText {
                    text: rich_text(&p.text),
                    received_at: now,
                })
            }
            Packet::SystemChat(p) if p.overlay => {
                self.data.action_bar = Some(HudText {
                    text: rich_text(&p.content),
                    received_at: now,
                })
            }
            Packet::SetTitleText(p) => {
                self.data.title = Some(HudText {
                    text: rich_text(&p.text),
                    received_at: now,
                })
            }
            Packet::SetSubtitleText(p) => self.data.subtitle = rich_text(&p.text),
            Packet::SetTitlesAnimation(p) => {
                // Protocol uses signed -1 encoded in u32 to keep a duration.
                if p.fade_in != u32::MAX {
                    self.data.title_fade_in_ms = p.fade_in.min(72000) as u64 * 50;
                }
                if p.stay != u32::MAX {
                    self.data.title_stay_ms = p.stay.min(72000) as u64 * 50;
                }
                if p.fade_out != u32::MAX {
                    self.data.title_fade_out_ms = p.fade_out.min(72000) as u64 * 50;
                }
            }
            Packet::ClearTitles(p) => {
                self.data.title = None;
                self.data.subtitle = RichText::default();
                if p.reset_times {
                    self.data.title_fade_in_ms = 500;
                    self.data.title_stay_ms = 3500;
                    self.data.title_fade_out_ms = 1000;
                }
            }
            _ => return,
        }
        self.dirty = true;
    }
}

pub fn capture(
    mut packets: MessageReader<ReceiveGamePacketEvent>,
    mut chat: MessageReader<ChatReceivedEvent>,
    players: Query<&MinecraftEntityId>,
    mut hud: ResMut<HudState>,
) {
    let now = Instant::now();
    for event in packets.read() {
        hud.packet(
            &event.packet,
            players.get(event.entity).ok().map(|id| id.0),
            now,
        );
    }
    for event in chat.read() {
        if matches!(&event.packet, ChatPacket::System(p) if p.overlay) {
            continue;
        }
        hud.data.chat.push(HudText {
            text: rich_text(&event.packet.message()),
            received_at: now,
        });
        if hud.data.chat.len() > 100 {
            hud.data.chat.remove(0);
        }
        hud.dirty = true;
    }
}

pub fn publish(ecs: &mut World, id: Entity, scene: &mut SceneSnapshot) {
    let now = Instant::now();
    if !ecs.contains_resource::<HudState>() {
        return;
    }
    if let Some(air) = ecs.resource::<HudState>().pending_air {
        if let Ok(mut player) = ecs.get_entity_mut(id) {
            player.insert(AirSupply(air));
            let mut hud = ecs.resource_mut::<HudState>();
            hud.pending_air = None;
            if hud.data.air != air.clamp(-20, 300) {
                hud.data.air = air.clamp(-20, 300);
                hud.dirty = true;
            }
        }
    }
    // Tick-dependent gameplay fields are sampled at 20Hz. Packet-driven data
    // publishes immediately, and immutable snapshots remain shared while idle.
    if now.duration_since(ecs.resource::<HudState>().last_sample) >= Duration::from_millis(50) {
        let health = ecs.get::<Health>(id).map(|v| v.0);
        let absorption = ecs
            .get::<PlayerAbsorption>(id)
            .map_or(0., |v| finite(v.0, 0., 1024.));
        let air = ecs
            .get::<AirSupply>(id)
            .map_or(300, |v| v.0.clamp(-20, 300));
        let frozen = ecs
            .get::<TicksFrozen>(id)
            .map_or(0, |v| v.0.clamp(0, 65535) as u16);
        let mode = ecs.get::<LocalGameMode>(id).map(|v| v.current as u8);
        let attack = ecs
            .get::<AttackStrengthScale>(id)
            .map_or(1., |v| finite(v.0, 1., 1.));
        let hunger = ecs
            .get::<Hunger>(id)
            .map(|v| (v.food.min(20) as u8, finite(v.saturation, 0., 20.)));
        let inventory = scene.inventory.clone();
        let offhand = inventory
            .slots
            .iter()
            .find(|s| s.role == InventorySlotRole::Offhand)
            .map(|s| s.stack.clone())
            .or_else(|| {
                ecs.get::<Inventory>(id)
                    .and_then(|i| i.inventory_menu.slot(45))
                    .map(item)
            })
            .unwrap_or_default();
        let selected = ecs
            .get::<Inventory>(id)
            .and_then(|i| i.inventory_menu.slot(36 + i.selected_hotbar_slot as usize))
            .map(item)
            .unwrap_or_default();
        let mut hud = ecs.resource_mut::<HudState>();
        hud.last_sample = now;
        if let Some(health) = health {
            hud.set_health(health, now);
        }
        macro_rules! set {
            ($field:ident,$value:expr) => {
                if hud.data.$field != $value {
                    hud.data.$field = $value;
                    hud.dirty = true;
                }
            };
        }
        set!(absorption, absorption);
        set!(air, air);
        set!(frozen_ticks, frozen);
        set!(attack_strength, attack);
        set!(offhand, offhand);
        if let Some(mode) = mode {
            set!(game_mode, mode);
        }
        if let Some((food, saturation)) = hunger {
            set!(food, food);
            set!(saturation, saturation);
        }
        let identity = (selected.item_id, selected.component_fingerprint);
        if hud.selected_identity != Some(identity) {
            hud.selected_identity = Some(identity);
            hud.data.selected_item_changed_at = Some(now);
            hud.dirty = true;
        }
    }
    let mut hud = ecs.resource_mut::<HudState>();
    if hud.dirty {
        hud.data.revision = hud.data.revision.wrapping_add(1);
        hud.cached = Arc::new(hud.data.clone());
        hud.dirty = false;
    }
    if !Arc::ptr_eq(&scene.hud, &hud.cached) {
        scene.hud = hud.cached.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use azalea_registry::DataRegistry;

    fn air_packet(entity: i32, air: i32) -> Packet {
        Packet::SetEntityData(azalea_protocol::packets::game::ClientboundSetEntityData {
            id: MinecraftEntityId(entity),
            packed_items: azalea_entity::EntityMetadataItems(vec![azalea_entity::EntityDataItem {
                index: 1,
                value: EntityDataValue::Int(air),
            }]),
        })
    }

    fn respawn_packet(data_to_keep: u8) -> Packet {
        Packet::Respawn(azalea_protocol::packets::game::ClientboundRespawn {
            common: azalea_protocol::packets::common::CommonPlayerSpawnInfo {
                dimension_type: azalea_registry::data::DimensionKind::new_raw(0),
                dimension: azalea_registry::identifier::Identifier::new("minecraft:overworld"),
                seed: 0,
                game_type: azalea_core::game_type::GameMode::Survival,
                previous_game_type: azalea_core::game_type::OptionalGameType(None),
                is_debug: false,
                is_flat: true,
                last_death_location: None,
                portal_cooldown: 0,
                sea_level: 63,
            },
            data_to_keep,
        })
    }

    #[test]
    fn omitted_default_air_initializes_the_native_player_once() {
        let mut ecs = World::new();
        ecs.init_resource::<HudState>();
        let id = ecs.spawn(AirSupply(0)).id();
        let mut scene = SceneSnapshot::default();
        // Another entity's metadata cannot cancel our uninitialized default.
        ecs.resource_mut::<HudState>()
            .packet(&air_packet(99, 0), Some(1), Instant::now());
        publish(&mut ecs, id, &mut scene);
        assert_eq!(ecs.get::<AirSupply>(id).unwrap().0, 300);
        assert_eq!(scene.hud.air, 300);
        assert_eq!(ecs.resource::<HudState>().pending_air, None);
        ecs.get_mut::<AirSupply>(id).unwrap().0 = 17;
        ecs.resource_mut::<HudState>().last_sample = Instant::now() - Duration::from_secs(1);
        publish(&mut ecs, id, &mut scene);
        assert_eq!(scene.hud.air, 17); // Never reset ordinary subsequent state.
    }

    #[test]
    fn explicit_drowning_air_wins_over_the_lifecycle_default() {
        let mut ecs = World::new();
        ecs.init_resource::<HudState>();
        let id = ecs.spawn(AirSupply(0)).id();
        let mut scene = SceneSnapshot::default();
        for air in [0, -20, 12, 300] {
            ecs.resource_mut::<HudState>()
                .packet(&air_packet(1, air), Some(1), Instant::now());
            publish(&mut ecs, id, &mut scene);
            assert_eq!(ecs.get::<AirSupply>(id).unwrap().0, air);
            assert_eq!(scene.hud.air, air);
        }
    }

    #[test]
    fn respawn_air_respects_keep_entity_data_and_later_metadata() {
        let mut ecs = World::new();
        ecs.init_resource::<HudState>();
        let id = ecs.spawn(AirSupply(0)).id();
        let mut scene = SceneSnapshot::default();
        let now = Instant::now();
        ecs.resource_mut::<HudState>()
            .packet(&air_packet(1, 18), Some(1), now);
        publish(&mut ecs, id, &mut scene);
        ecs.resource_mut::<HudState>()
            .packet(&respawn_packet(2), Some(1), now);
        publish(&mut ecs, id, &mut scene);
        assert_eq!(scene.hud.air, 18);
        ecs.resource_mut::<HudState>()
            .packet(&respawn_packet(0), Some(1), now);
        publish(&mut ecs, id, &mut scene);
        assert_eq!(scene.hud.air, 300);
        ecs.resource_mut::<HudState>()
            .packet(&respawn_packet(0), Some(1), now);
        ecs.resource_mut::<HudState>()
            .packet(&air_packet(1, 0), Some(1), now);
        publish(&mut ecs, id, &mut scene);
        assert_eq!(scene.hud.air, 0);
    }

    #[test]
    fn unchanged_hud_reuses_snapshot_and_health_change_records_animation_origin() {
        let mut ecs = World::new();
        ecs.init_resource::<HudState>();
        let id = ecs.spawn_empty().id();
        let mut scene = SceneSnapshot::default();
        publish(&mut ecs, id, &mut scene);
        let first = scene.hud.clone();
        publish(&mut ecs, id, &mut scene);
        assert!(Arc::ptr_eq(&first, &scene.hud));
        let now = Instant::now();
        ecs.resource_mut::<HudState>().set_health(11., now);
        publish(&mut ecs, id, &mut scene);
        assert_eq!(scene.hud.health, 11.);
        assert_eq!(scene.hud.previous_health, 20.);
        assert_eq!(scene.hud.health_changed_at, Some(now));
    }
    #[test]
    fn title_timings_preserve_signed_keep_values_and_ignore_nonfinite_health() {
        let mut hud = HudState::default();
        let now = Instant::now();
        hud.packet(
            &Packet::SetTitlesAnimation(
                azalea_protocol::packets::game::ClientboundSetTitlesAnimation {
                    fade_in: u32::MAX,
                    stay: 40,
                    fade_out: 5,
                },
            ),
            None,
            now,
        );
        assert_eq!(hud.data.title_fade_in_ms, 500);
        assert_eq!(hud.data.title_stay_ms, 2000);
        assert_eq!(hud.data.title_fade_out_ms, 250);
        hud.set_health(f32::NAN, now);
        assert_eq!(hud.data.health, 20.);
    }
    #[test]
    fn cooldown_groups_replace_cancel_and_expire_without_unbounded_history() {
        let mut hud = HudState::default();
        let now = Instant::now();
        let packet = |duration| {
            Packet::Cooldown(azalea_protocol::packets::game::ClientboundCooldown {
                cooldown_group: azalea_registry::identifier::Identifier::new(
                    "minecraft:ender_pearl",
                ),
                duration,
            })
        };
        hud.packet(&packet(20), None, now);
        assert_eq!(hud.data.cooldowns.len(), 1);
        assert_eq!(
            hud.data.cooldowns[0].ends_at.duration_since(now),
            Duration::from_secs(1)
        );
        hud.packet(&packet(40), None, now);
        assert_eq!(hud.data.cooldowns.len(), 1);
        hud.packet(&packet(0), None, now);
        assert!(hud.data.cooldowns.is_empty());
    }
}
