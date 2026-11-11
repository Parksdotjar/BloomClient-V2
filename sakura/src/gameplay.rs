//! Translate human input to the version-pinned client's normal interaction paths.
use crate::shared::{InputState, SceneSnapshot};
use azalea_client::{
    attack::AttackEvent,
    chat::{ChatReceivedEvent, SendChatEvent},
    interact::{StartUseItemEvent, pick::HitResultComponent},
    inventory::SetSelectedHotbarSlotEvent,
    local_player::Hunger,
    mining::{Mining, StartMiningBlockEvent, StopMiningBlockEvent},
    respawn::PerformRespawnEvent,
};
use azalea_core::position::BlockPos;
use azalea_entity::{inventory::Inventory, metadata::Health};
use azalea_protocol::packets::game::s_interact::InteractionHand;
use bevy_ecs::prelude::*;

#[derive(Default)]
pub struct Controls {
    use_serial: u64,
    respawn_serial: u64,
    attack: bool,
    target: Option<BlockPos>,
}
impl Controls {
    pub fn apply(&mut self, ecs: &mut World, id: Entity, input: &InputState) {
        crate::inventory_state::apply(ecs, id, &input.inventory_actions);
        if crate::inventory_state::is_open(ecs) {
            if ecs.get::<Mining>(id).is_some() {
                ecs.write_message(StopMiningBlockEvent { entity: id });
            }
            self.attack = false;
            self.target = None;
            self.use_serial = input.use_item;
            return;
        }
        if ecs
            .get::<Inventory>(id)
            .is_some_and(|i| i.selected_hotbar_slot != input.hotbar.min(8))
        {
            ecs.trigger(SetSelectedHotbarSlotEvent {
                entity: id,
                slot: input.hotbar.min(8),
            });
        }
        let target = ecs
            .get::<HitResultComponent>(id)
            .and_then(|h| h.as_block_hit_result_if_not_miss())
            .map(|h| h.block_pos);
        if (!input.attack || self.target != target) && ecs.get::<Mining>(id).is_some() {
            ecs.write_message(StopMiningBlockEvent { entity: id });
        }
        if input.attack {
            if let Some(position) = target {
                if ecs.get::<Mining>(id).is_none_or(|m| m.pos != position) {
                    ecs.write_message(StartMiningBlockEvent {
                        entity: id,
                        position,
                        force: false,
                    });
                }
            } else if !self.attack {
                if let Some(target) = ecs
                    .get::<HitResultComponent>(id)
                    .and_then(|h| h.as_entity_hit_result())
                    .map(|h| h.entity)
                {
                    ecs.write_message(AttackEvent { entity: id, target });
                }
            }
        }
        self.attack = input.attack;
        self.target = target;
        if input.use_item != self.use_serial {
            self.use_serial = input.use_item;
            if ecs.get::<HitResultComponent>(id).is_some() {
                ecs.write_message(StartUseItemEvent {
                    entity: id,
                    hand: InteractionHand::MainHand,
                    force_block: None,
                });
            }
        }
        if input.respawn != self.respawn_serial {
            self.respawn_serial = input.respawn;
            if ecs.get::<Health>(id).is_some_and(|h| h.0 <= 0.0) {
                ecs.write_message(PerformRespawnEvent { entity: id });
            }
        }
        if let Some(content) = input.chat_submit.as_ref() {
            let content: String = content
                .chars()
                .filter(|c| !c.is_control())
                .take(256)
                .collect();
            if !content.trim().is_empty() {
                ecs.write_message(SendChatEvent {
                    entity: id,
                    content,
                });
            }
        }
    }
}

#[derive(Resource, Default)]
pub struct Chat(pub Vec<String>);
pub fn receive_chat(mut events: MessageReader<ChatReceivedEvent>, mut chat: ResMut<Chat>) {
    for event in events.read() {
        chat.0.push(
            event
                .packet
                .message()
                .to_string()
                .chars()
                .filter(|c| !c.is_control())
                .take(512)
                .collect(),
        );
        if chat.0.len() > 50 {
            chat.0.remove(0);
        }
    }
}

pub fn snapshot(ecs: &mut World, id: Entity, scene: &mut SceneSnapshot) {
    if let Some(health) = ecs.get::<Health>(id) {
        scene.health = health.0;
    }
    if let Some(hunger) = ecs.get::<Hunger>(id) {
        scene.food = hunger.food.min(20) as u8;
    }
    if let Some(inv) = ecs.get::<Inventory>(id) {
        for slot in 0..9 {
            scene.hotbar[slot] = inv
                .inventory_menu
                .slot(36 + slot)
                .map(crate::inventory_state::item)
                .unwrap_or_default();
        }
    }
    scene.target = ecs
        .get::<HitResultComponent>(id)
        .and_then(|h| h.as_block_hit_result_if_not_miss())
        .map(|h| [h.block_pos.x, h.block_pos.y, h.block_pos.z]);
    scene.chat = ecs.resource::<Chat>().0.clone();
    crate::entity_state::snapshot(ecs, id, scene);
}
