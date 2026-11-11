//! Human controls around the existing 20 Hz collision/ground physics.
use azalea_client::{PhysicsState, local_player::LocalGameMode, packet::game::SendGamePacketEvent};
use azalea_core::{game_type::GameMode, position::Vec3, tick::GameTick};
use azalea_entity::{
    Attributes, HasClientLoaded, Jumping, LocalEntity, LookDirection, OnClimbable, Physics,
    PlayerAbilities, Pose, Position, metadata::Sprinting, move_relative,
};
use azalea_physics::{
    PhysicsSystems,
    collision::{
        MoveCtx, MoverType,
        entity_collisions::{AabbQuery, CollidableEntityQuery},
        move_colliding,
    },
};
use azalea_world::{WorldName, Worlds};
use bevy_app::{App, Plugin, Update};
use bevy_ecs::prelude::*;
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct DoubleTap {
    previous: Option<Instant>,
}
impl DoubleTap {
    pub fn press(&mut self, now: Instant) -> bool {
        if self
            .previous
            .take()
            .is_some_and(|p| now.saturating_duration_since(p) < Duration::from_millis(350))
        {
            true
        } else {
            self.previous = Some(now);
            false
        }
    }
    pub fn reset(&mut self) {
        self.previous = None;
    }
}
#[derive(Component, Default)]
pub struct Controls {
    pub sprint: bool,
    pub sneak: bool,
    pub jump: bool,
    pub sprint_tap: u64,
    pub fly_tap: u64,
    sprint_seen: u64,
    fly_seen: u64,
}
pub struct MovementPlugin;
impl Plugin for MovementPlugin {
    fn build(&self, app: &mut App) {
        // Same ordering as the upstream physics plugin, with a separate flight
        // path. Do not run normal gravity and then undo its positional effects.
        app.add_systems(GameTick, controls.before(PhysicsSystems));
        app.add_systems(
            GameTick,
            flight_pose
                .in_set(PhysicsSystems)
                .after(azalea_client::movement::update_pose)
                .before(azalea_physics::ai_step),
        );
        app.add_systems(
            GameTick,
            (
                azalea_physics::fluids::update_in_water_state_and_do_fluid_pushing
                    .run_if(ground_physics),
                azalea_physics::update_old_position,
                azalea_physics::fluids::update_swimming,
                azalea_physics::ai_step.run_if(ground_physics),
                azalea_physics::travel::travel.run_if(ground_physics),
                flight,
                azalea_physics::apply_effects_from_blocks,
            )
                .chain()
                .in_set(PhysicsSystems)
                .after(azalea_entity::update_in_loaded_chunk),
        );
        app.add_systems(
            Update,
            azalea_physics::collision::entity_collisions::update_last_bounding_box
                .after(azalea_entity::update_bounding_box),
        );
    }
}
fn ground_physics(q: Query<&PlayerAbilities, With<LocalEntity>>) -> bool {
    !q.iter().any(|a| a.flying)
}
fn controls(
    mut q: Query<(
        Entity,
        &mut Controls,
        &mut PhysicsState,
        &mut PlayerAbilities,
        &mut Physics,
        &LocalGameMode,
    )>,
    mut commands: Commands,
) {
    for (id, mut c, mut p, mut a, mut body, mode) in &mut q {
        p.trying_to_sprint = c.sprint || c.sprint_tap != c.sprint_seen;
        p.trying_to_crouch = c.sneak;
        c.sprint_seen = c.sprint_tap;
        let was = a.flying;
        if mode.current == GameMode::Spectator {
            a.flying = true;
        } else if !a.can_fly {
            a.flying = false;
        } else if c.fly_tap != c.fly_seen {
            a.flying = !a.flying;
            if a.flying && body.on_ground() {
                body.velocity.y = 0.42;
            }
        }
        c.fly_seen = c.fly_tap;
        if was != a.flying {
            commands.trigger(SendGamePacketEvent::new(
                id,
                azalea_protocol::packets::game::s_player_abilities::ServerboundPlayerAbilities {
                    is_flying: a.flying,
                },
            ));
        }
    }
}
#[allow(clippy::type_complexity)]
fn flight(
    mut q: Query<
        (
            Entity,
            &Attributes,
            &WorldName,
            &OnClimbable,
            &Jumping,
            &PhysicsState,
            &Sprinting,
            &Pose,
            &mut PlayerAbilities,
            &mut Physics,
            &LookDirection,
            &mut Position,
            &Controls,
            &LocalGameMode,
        ),
        (With<LocalEntity>, With<HasClientLoaded>),
    >,
    worlds: Res<Worlds>,
    aabb_query: AabbQuery,
    collidable_entity_query: CollidableEntityQuery,
    mut commands: Commands,
) {
    for (
        entity,
        attributes,
        name,
        climb,
        jump,
        state,
        sprint,
        pose,
        mut abilities,
        mut physics,
        direction,
        mut position,
        input,
        mode,
    ) in &mut q
    {
        if !abilities.flying {
            continue;
        }
        let Some(world) = worlds.get(name) else {
            continue;
        };
        let world = world.read();
        let speed = abilities.flying_speed;
        physics.velocity.y +=
            (i32::from(input.jump) - i32::from(input.sneak)) as f64 * (speed * 3.) as f64;
        let accel = Vec3::new(
            physics.x_acceleration as f64,
            0.,
            physics.z_acceleration as f64,
        );
        move_relative(
            &mut physics,
            *direction,
            speed * if **sprint { 2. } else { 1. },
            accel,
        );
        let velocity = physics.velocity;
        if mode.current == GameMode::Spectator {
            position.x += velocity.x;
            position.y += velocity.y;
            position.z += velocity.z;
        } else {
            let mut ctx = MoveCtx {
                mover_type: MoverType::Own,
                world: &world,
                position,
                physics: &mut physics,
                source_entity: entity,
                aabb_query: &aabb_query,
                collidable_entity_query: &collidable_entity_query,
                physics_state: Some(state),
                attributes,
                abilities: Some(&abilities),
                direction: *direction,
                sprinting: *sprint,
                on_climbable: *climb,
                pose: Some(*pose),
                jumping: *jump,
            };
            move_colliding(&mut ctx, velocity);
        }
        physics.velocity.x *= 0.91f32 as f64;
        physics.velocity.z *= 0.91f32 as f64;
        physics.velocity.y = velocity.y * 0.6;
        if physics.on_ground() && velocity.y < 0. && mode.current != GameMode::Spectator {
            abilities.flying = false;
            commands.trigger(SendGamePacketEvent::new(
                entity,
                azalea_protocol::packets::game::s_player_abilities::ServerboundPlayerAbilities {
                    is_flying: false,
                },
            ));
        }
    }
}
fn flight_pose(
    mut q: Query<(
        Entity,
        &mut Pose,
        &PlayerAbilities,
        &Physics,
        &Position,
        &azalea_client::local_player::WorldHolder,
    )>,
    aabb_query: AabbQuery,
    collidable_entity_query: CollidableEntityQuery,
) {
    for (id, mut pose, abilities, physics, position, holder) in &mut q {
        if !abilities.flying || *pose == Pose::Standing {
            continue;
        }
        let bounds = azalea_entity::dimensions::calculate_dimensions(
            azalea_registry::builtin::EntityKind::Player,
            Pose::Standing,
        )
        .make_bounding_box(**position)
        .deflate_all(1.0e-7);
        if azalea_physics::travel::no_collision(
            &holder.shared.read(),
            Some(id),
            &aabb_query,
            &collidable_entity_query,
            physics,
            &bounds,
            false,
        ) {
            *pose = Pose::Standing;
        }
    }
}
pub fn eye_height(pose: Option<&Pose>) -> f32 {
    match pose {
        Some(Pose::Crouching) => 1.27,
        Some(Pose::Swimming | Pose::FallFlying | Pose::SpinAttack) => 0.4,
        Some(Pose::Sleeping) => 0.2,
        _ => 1.62,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn double_tap_window_and_reset() {
        let mut t = DoubleTap::default();
        let now = Instant::now();
        assert!(!t.press(now));
        assert!(t.press(now + Duration::from_millis(300)));
        assert!(!t.press(now + Duration::from_millis(400)));
        assert!(!t.press(now + Duration::from_millis(750)));
        t.reset();
        assert!(!t.press(now + Duration::from_millis(800)));
    }
}
