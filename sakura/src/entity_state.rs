//! Bounded visual snapshots, including metadata omitted by the protocol client's renderer-free ECS.
use crate::shared::{EntitySnapshot, SceneSnapshot};
use azalea_client::{local_player::WorldHolder, packet::game::ReceiveGamePacketEvent};
use azalea_core::{entity_id::MinecraftEntityId, registry_holder::RegistryHolder};
use azalea_entity::{
    EntityDataValue, EntityKindComponent, LookDirection, Position, dimensions::EntityDimensions,
    metadata as m,
};
use azalea_inventory::ItemStack;
use azalea_protocol::packets::game::ClientboundGamePacket as Packet;
use azalea_registry::{DataRegistry, builtin::EntityKind};
use bevy_ecs::prelude::*;
use std::collections::{BinaryHeap, HashMap};

const MAX_TRACKED: usize = 8192;
const MAX_VISIBLE: usize = 512;
#[derive(Clone, Copy)]
struct Extra {
    kind: EntityKind,
    head_yaw: f32,
    yaw: f32,
    pitch: f32,
    sheep_color: u8,
}
#[derive(Resource, Default)]
pub struct VisualMetadata {
    values: HashMap<i32, Extra>,
    game_time: u64,
    pub camera_revision: u64,
}
impl VisualMetadata {
    fn apply(&mut self, packet: &Packet) {
        match packet {
            Packet::PlayerPosition(_) => {
                self.camera_revision = self.camera_revision.wrapping_add(1)
            }
            Packet::Login(_) | Packet::Respawn(_) => {
                self.values.clear();
                self.game_time = 0;
            }
            Packet::AddEntity(p) => {
                if self.values.len() < MAX_TRACKED || self.values.contains_key(&p.id.0) {
                    self.values.insert(
                        p.id.0,
                        Extra {
                            kind: p.entity_type,
                            head_yaw: byte_angle(p.y_head_rot),
                            yaw: byte_angle(p.y_rot),
                            pitch: byte_angle(p.x_rot),
                            sheep_color: 0,
                        },
                    );
                }
            }
            Packet::RotateHead(p) => {
                if let Some(v) = self.values.get_mut(&p.entity_id.0) {
                    v.head_yaw = byte_angle(p.y_head_rot);
                }
            }
            Packet::MoveEntityRot(p) => {
                if let Some(v) = self.values.get_mut(&p.entity_id.0) {
                    v.yaw = byte_angle(p.look_direction.y_rot);
                    v.pitch = byte_angle(p.look_direction.x_rot);
                }
            }
            Packet::MoveEntityPosRot(p) => {
                if let Some(v) = self.values.get_mut(&p.entity_id.0) {
                    v.yaw = byte_angle(p.look_direction.y_rot);
                    v.pitch = byte_angle(p.look_direction.x_rot);
                }
            }
            Packet::EntityPositionSync(p) => {
                if let Some(v) = self.values.get_mut(&p.id.0) {
                    v.yaw = p.values.look_direction.y_rot();
                    v.pitch = p.values.look_direction.x_rot();
                }
            }
            Packet::TeleportEntity(p) => {
                if let Some(v) = self.values.get_mut(&p.id.0) {
                    v.yaw = p.change.look_direction.y_rot()
                        + if p.relative.y_rot { v.yaw } else { 0.0 };
                    v.pitch = p.change.look_direction.x_rot()
                        + if p.relative.x_rot { v.pitch } else { 0.0 };
                }
            }
            Packet::SetEntityData(p) => {
                if let Some(v) = self.values.get_mut(&p.id.0) {
                    if v.kind == EntityKind::Sheep {
                        for item in &p.packed_items.0 {
                            if item.index == 18 {
                                if let EntityDataValue::Byte(flags) = item.value {
                                    v.sheep_color = flags & 15;
                                }
                            }
                        }
                    }
                }
            }
            Packet::RemoveEntities(p) => {
                for id in &p.entity_ids {
                    self.values.remove(&id.0);
                }
            }
            Packet::SetTime(p) => self.game_time = p.game_time,
            _ => {}
        }
    }
}
fn byte_angle(value: i8) -> f32 {
    f32::from(value) * (360.0 / 256.0)
}
pub fn capture(
    mut packets: MessageReader<ReceiveGamePacketEvent>,
    mut visuals: ResMut<VisualMetadata>,
) {
    for event in packets.read() {
        visuals.apply(event.packet.as_ref());
    }
}
fn registry_name<T: DataRegistry>(value: &T, registries: Option<&RegistryHolder>) -> String {
    registries
        .and_then(|r| r.protocol_id_to_identifier(T::NAME.into(), value.protocol_id()))
        .filter(|name| name.namespace() == "minecraft")
        .map(|name| name.path().to_owned())
        .unwrap_or_default()
}

#[derive(Clone, Copy)]
struct Candidate {
    distance: f64,
    entity: Entity,
}
impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.entity == other.entity && self.distance == other.distance
    }
}
impl Eq for Candidate {}
impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.distance
            .total_cmp(&other.distance)
            .then_with(|| self.entity.to_bits().cmp(&other.entity.to_bits()))
    }
}

pub fn snapshot(ecs: &mut World, id: Entity, scene: &mut SceneSnapshot) {
    let local_world = ecs.get::<azalea_world::WorldName>(id).cloned();
    let mut candidates = BinaryHeap::with_capacity(MAX_VISIBLE + 1);
    let mut query = ecs.query::<(
        Entity,
        &Position,
        &azalea_world::WorldName,
        Option<&m::Invisible>,
    )>();
    for (entity, position, world, invisible) in query.iter(ecs) {
        if entity == id || local_world.as_ref() != Some(world) || invisible.is_some_and(|v| v.0) {
            continue;
        }
        let delta = [
            position.x - scene.player_position[0],
            position.y - scene.player_position[1],
            position.z - scene.player_position[2],
        ];
        let distance = delta.iter().map(|v| v * v).sum::<f64>();
        if !distance.is_finite() || distance > 256.0 * 256.0 {
            continue;
        }
        candidates.push(Candidate { distance, entity });
        if candidates.len() > MAX_VISIBLE {
            candidates.pop();
        }
    }
    let world = ecs.get::<WorldHolder>(id).map(|v| v.shared.read());
    let registries = world.as_ref().map(|w| &w.registries);
    let extras = ecs.get_resource::<VisualMetadata>();
    scene.entities.clear();
    for candidate in candidates.into_sorted_vec() {
        let entity = candidate.entity;
        let (Some(network_id), Some(pos), Some(kind)) = (
            ecs.get::<MinecraftEntityId>(entity),
            ecs.get::<Position>(entity),
            ecs.get::<EntityKindComponent>(entity),
        ) else {
            continue;
        };
        let look = ecs.get::<LookDirection>(entity);
        let dimensions = ecs.get::<EntityDimensions>(entity);
        let extra = extras.and_then(|v| v.values.get(&network_id.0));
        let mut variant = String::new();
        macro_rules! variant {
            ($component:ident) => {
                if let Some(v) = ecs.get::<m::$component>(entity) {
                    variant = registry_name(&v.0, registries);
                }
            };
        }
        variant!(CowVariant);
        variant!(PigVariant);
        variant!(ChickenVariant);
        variant!(WolfVariant);
        variant!(CatVariant);
        variant!(FrogVariant);
        if let Some(rabbit) = ecs.get::<m::RabbitKind>(entity) {
            variant = match rabbit.0 {
                1 => "white",
                2 => "black",
                3 => "white_splotched",
                4 => "gold",
                5 => "salt",
                99 => "caerbannog",
                _ => "brown",
            }
            .into();
        }
        let villager = ecs
            .get::<m::VillagerVillagerData>(entity)
            .map(|v| &v.0)
            .or_else(|| {
                ecs.get::<m::ZombieVillagerVillagerData>(entity)
                    .map(|v| &v.0)
            });
        let (item_id, item_count) = match ecs.get::<m::ItemItem>(entity).map(|v| &v.0) {
            Some(ItemStack::Present(item)) => (item.kind as u32, item.count.clamp(0, 65535) as u16),
            _ => (0, 0),
        };
        let yaw = extra.map_or_else(|| look.map_or(0.0, |l| l.y_rot()), |v| v.yaw);
        scene.entities.push(EntitySnapshot {
            light: Default::default(),
              shadows:Vec::new(),
            id: network_id.0,
            position: [pos.x, pos.y, pos.z],
            yaw: if yaw.is_finite() { yaw } else { 0.0 },
            width: dimensions.map_or(0.6, |d| d.width),
            height: dimensions.map_or(1.8, |d| d.height),
            is_player: kind.0 == EntityKind::Player,
            kind: format!("{:?}", kind.0),
            head_yaw: extra.map_or(yaw, |v| v.head_yaw),
            pitch: extra.map_or_else(|| look.map_or(0.0, |l| l.x_rot()), |v| v.pitch),
            baby: ecs
                .get::<m::AbstractAgeableBaby>(entity)
                .is_some_and(|v| v.0)
                || ecs.get::<m::ZombieBaby>(entity).is_some_and(|v| v.0)
                || ecs.get::<m::PiglinBaby>(entity).is_some_and(|v| v.0)
                || ecs.get::<m::ZoglinBaby>(entity).is_some_and(|v| v.0),
            variant,
            size: ecs
                .get::<m::SlimeSize>(entity)
                .map_or(1, |v| v.0.clamp(1, 64) as u8),
            sheep_color: ecs
                .get::<m::WolfCollarColor>(entity)
                .map(|v| v.0.clamp(0, 15) as u8)
                .or_else(|| {
                    ecs.get::<m::CatCollarColor>(entity)
                        .map(|v| v.0.clamp(0, 15) as u8)
                })
                .unwrap_or_else(|| extra.map_or(0, |v| v.sheep_color)),
            sheared: ecs.get::<m::SheepSheared>(entity).is_some_and(|v| v.0),
            sitting: ecs.get::<m::InSittingPose>(entity).is_some_and(|v| v.0),
            tamed: ecs.get::<m::Tame>(entity).is_some_and(|v| v.0),
            angry: ecs
                .get::<m::WolfAngerEndTime>(entity)
                .is_some_and(|v| v.0 > 0 && v.0 as u64 > extras.map_or(0, |e| e.game_time)),
            villager_type: villager
                .map_or_else(String::new, |v| format!("{:?}", v.kind).to_lowercase()),
            villager_profession: villager.map_or_else(String::new, |v| {
                format!("{:?}", v.profession).to_lowercase()
            }),
            item_id,
            item_count,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn angles_keep_negative_rotation() {
        assert_eq!(byte_angle(-64), -90.0);
        assert_eq!(byte_angle(64), 90.0);
    }
    #[test]
    fn nearest_entity_selection_is_bounded() {
        let mut heap = BinaryHeap::new();
        for i in (0..2048).rev() {
            heap.push(Candidate {
                distance: i as f64,
                entity: Entity::from_raw_u32(i + 1).unwrap(),
            });
            if heap.len() > MAX_VISIBLE {
                heap.pop();
            }
        }
        assert_eq!(heap.len(), MAX_VISIBLE);
        assert_eq!(heap.peek().unwrap().distance, 511.0);
    }
}
