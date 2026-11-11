//! Bounded environmental state. Reference: installed Java 26.1 fog environments,
//! LightningBolt and EndFlashState. None of these effects remesh terrain.
use crate::lighting::{Dimension, Environment};
use std::time::Instant;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Medium {
    #[default]
    Air,
    Water,
    Lava,
    PowderSnow,
}

#[derive(Clone, Debug)]
pub struct Atmosphere {
    pub medium: Medium,
    pub water_since: Option<Instant>,
    pub fog_color: Option<[f32; 3]>,
    pub water_color: [f32; 3],
    pub range: Option<[f32; 2]>,
    pub water_range: [f32; 2],
    pub game_time: u64,
    pub received: Instant,
    ticked: Instant,
    bolts: [Option<Bolt>; 16],
    flash_ticks: u8,
}
#[derive(Clone, Copy, Debug)]
struct Bolt {
    life: i16,
    flashes: u8,
    random: Random,
    position: [f64; 3],
    seed: u64,
}
#[derive(Clone, Copy, Debug)]
struct Random(u64);
impl Random {
    fn new(seed: u64) -> Self {
        Self((seed ^ 0x5deece66d) & ((1 << 48) - 1))
    }
    fn bits(&mut self, n: u32) -> u32 {
        self.0 = self.0.wrapping_mul(0x5deece66d).wrapping_add(11) & ((1 << 48) - 1);
        (self.0 >> (48 - n)) as u32
    }
    fn int(&mut self, n: u32) -> u32 {
        if n.is_power_of_two() {
            return ((n as u64 * self.bits(31) as u64) >> 31) as u32;
        }
        loop {
            let bits = self.bits(31);
            let value = bits % n;
            if bits.wrapping_sub(value).wrapping_add(n - 1) < 0x80000000 {
                return value;
            }
        }
    }
}
impl Default for Atmosphere {
    fn default() -> Self {
        let now = Instant::now();
        Self {
            medium: Medium::Air,
            water_since: None,
            fog_color: None,
            water_color: rgb(0x050533),
            range: None,
            water_range: [-8., 96.],
            game_time: 0,
            received: now,
            ticked: now,
            bolts: [None; 16],
            flash_ticks: 0,
        }
    }
}
fn rgb(v: u32) -> [f32; 3] {
    [
        (v >> 16 & 255) as f32 / 255.,
        (v >> 8 & 255) as f32 / 255.,
        (v & 255) as f32 / 255.,
    ]
}
impl Atmosphere {
    pub fn lightning(&mut self, seed: u64, position: [f64; 3]) {
        if position
            .iter()
            .any(|p| !p.is_finite() || p.abs() > 30_000_000.)
        {
            return;
        }
        let mut random = Random::new(seed);
        let flashes = (random.int(3) + 1) as u8;
        // Fixed capacity: replace the shortest remaining effect in extreme storms.
        let i = self
            .bolts
            .iter()
            .position(Option::is_none)
            .unwrap_or_else(|| {
                self.bolts
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, b)| b.unwrap().flashes)
                    .unwrap()
                    .0
            });
        self.bolts[i] = Some(Bolt {
            life: 2,
            flashes,
            random,
            position,
            seed,
        });
        self.flash_ticks = 2;
    }
    pub fn tick(&mut self, now: Instant) {
        let steps = (now.saturating_duration_since(self.ticked).as_millis() / 50).min(40);
        if steps == 0 {
            return;
        }
        self.ticked += std::time::Duration::from_millis(steps as u64 * 50);
        if now.saturating_duration_since(self.ticked).as_secs() > 2 {
            self.ticked = now;
        }
        for _ in 0..steps {
            self.flash_ticks = self.flash_ticks.saturating_sub(1);
            for slot in &mut self.bolts {
                let Some(b) = slot else { continue };
                b.life -= 1;
                if b.life < 0 {
                    if b.flashes == 0 {
                        *slot = None;
                        continue;
                    }
                    if b.life < -(b.random.int(10) as i16) {
                        b.flashes -= 1;
                        b.life = 1;
                        b.seed = (b.random.bits(32) as u64) << 32 | b.random.bits(32) as u64;
                    }
                }
                if b.life >= 0 {
                    self.flash_ticks = 2;
                }
            }
        }
    }
    pub fn flashing(&self) -> bool {
        self.flash_ticks > 0
    }
    pub fn bolts(&self) -> impl Iterator<Item = ([f64; 3], u64)> + '_ {
        self.bolts
            .iter()
            .flatten()
            .filter(|b| b.life >= 0)
            .map(|b| (b.position, b.seed))
    }
    pub fn end_flash(&self, now: Instant) -> f32 {
        let t = self.game_time as f64
            + now.saturating_duration_since(self.received).as_secs_f64() * 20.;
        let cycle = (t / 600.) as u64;
        if cycle == 0 {
            return 0.;
        }
        let mut r = Random::new(cycle);
        r.bits(24);
        let start = r.int(201) as f64;
        let duration = 100. + r.int((380f64.min(600. - start) - 100.) as u32 + 1) as f64;
        let phase = t % 600. - start;
        if phase < 0. || phase > duration {
            0.
        } else {
            (phase * std::f64::consts::PI / duration).sin() as f32
        }
    }
    pub fn set_medium(&mut self, medium: Medium, now: Instant) {
        if medium != self.medium {
            self.water_since = if medium == Medium::Water {
                Some(now)
            } else {
                None
            };
            self.medium = medium;
        }
    }
    pub fn water_vision(&self, now: Instant) -> f32 {
        let t = self
            .water_since
            .map_or(0., |s| now.saturating_duration_since(s).as_secs_f32() * 20.);
        (t / 100.).clamp(0., 1.) * 0.6 + ((t - 100.) / 500.).clamp(0., 1.) * 0.4
    }
    /// Called on the network snapshot cadence (10 Hz), never per draw/vertex.
    pub fn sample(&mut self, world: &azalea_world::World, eye: [f64; 3], now: Instant) {
        use azalea_block::fluid_state::{FluidKind, FluidState};
        use azalea_core::position::BlockPos;
        let p = BlockPos::new(
            eye[0].floor() as i32,
            eye[1].floor() as i32,
            eye[2].floor() as i32,
        );
        if let Some(state) = world.get_block_state(p) {
            let mut fluid = FluidState::from(state);
            // Azalea represents falling levels (8..15) as zero; Java still has a full flowing column.
            if fluid.kind != FluidKind::Empty && fluid.amount == 0 {
                fluid.amount = 8;
            }
            let above = world
                .get_block_state(BlockPos::new(p.x, p.y + 1, p.z))
                .map(FluidState::from);
            let height = if above.is_some_and(|a| a.kind == fluid.kind) {
                1.
            } else {
                fluid.height()
            };
            let medium = if azalea_registry::builtin::BlockKind::from(state)
                == azalea_registry::builtin::BlockKind::PowderSnow
            {
                Medium::PowderSnow
            } else if eye[1] < (p.y as f64 + height as f64) {
                match fluid.kind {
                    FluidKind::Water => Medium::Water,
                    FluidKind::Lava => Medium::Lava,
                    _ => Medium::Air,
                }
            } else {
                Medium::Air
            };
            self.set_medium(medium, now);
        }
        // Missing chunks retain the last valid sample instead of flashing to air.

    }
}

pub fn fog(
    env: &Environment,
    now: Instant,
    far: f32,
    hud: &crate::shared::HudSnapshot,
    darkness: f32,
) -> ([f32; 4], [f32; 4]) {
    let a = &env.atmosphere;
    let mut color = env.fog(now);
    let mut range = a.range.unwrap_or(if env.dimension == Dimension::Nether {
        [10., 96.]
    } else {
        [far * 0.75, far]
    });
    let active = |name: &str| {
        hud.effects
            .iter()
            .find(|e| e.name.eq_ignore_ascii_case(name) && e.expires_at.is_none_or(|end| end > now))
    };
    let spectator = hud.game_mode == 3;
    match a.medium {
        Medium::Water => {
            color = [a.water_color[0], a.water_color[1], a.water_color[2], 1.];
            range = [
                a.water_range[0],
                a.water_range[1] * a.water_vision(now).max(0.25),
            ];
        }
        Medium::Lava => {
            let c = rgb((-6743808i32) as u32);
            color = [c[0], c[1], c[2], 1.];
            range = if spectator {
                [-8., far * 0.5]
            } else if active("FireResistance").is_some() || active("fire_resistance").is_some() {
                [0., 5.]
            } else {
                [0.25, 1.]
            };
        }
        Medium::PowderSnow => {
            let c = rgb((-6308916i32) as u32);
            color = [c[0], c[1], c[2], 1.];
            range = if spectator {
                [-8., far * 0.5]
            } else {
                [0., 2.]
            };
        }
        Medium::Air => {}
    }
    // Fluid environments take precedence over status fog in Java.
    if matches!(a.medium, Medium::Air | Medium::Water) {
        let mut dark = darkness;
        if let Some(effect) = active("Blindness") {
            let blend = effect.expires_at.map_or(1., |end| {
                (end.saturating_duration_since(now).as_secs_f32()).min(1.)
            });
            let d = far + (5. - far) * blend;
            range = [d * 0.25, d];
            dark = blend;
        } else if dark > 0. {
            let d = far + (15. - far) * dark;
            range = [d * 0.75, d];
        }
        for c in &mut color[..3] {
            *c *= (1. - dark.clamp(0., 1.)).powi(2);
        }
    }
    let vision = if a.medium == Medium::Water {
        a.water_vision(now)
    } else if active("Darkness").is_none() {
        active("NightVision")
            .or_else(|| active("night_vision"))
            .map_or(0., |e| {
                let ticks = e.expires_at.map_or(10000., |end| {
                    end.saturating_duration_since(now).as_secs_f32() * 20.
                });
                if ticks > 200. {
                    1.
                } else {
                    0.7 + (ticks * std::f32::consts::PI * 0.2).sin() * 0.3
                }
            })
    } else {
        0.
    };
    if color[..3].iter().all(|c| *c > 0.) {
        let gain = 1. / color[..3].iter().copied().fold(0f32, f32::max);
        for c in &mut color[..3] {
            *c += (*c * gain - *c) * vision;
        }
    }
    range[1] = range[1].min(far).max(range[0] + 0.001);
    (color, [range[0], range[1], 0., 0.])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    #[test]
    fn end_flash_matches_actual_java_26_1_output() {
        // Captured by invoking the installed client's EndFlashState.tick/getIntensity.
        let mut a = Atmosphere::default();
        let now = a.received;
        for (time, expected) in [
            (0, 0.),
            (600, 0.),
            (750, 0.17086743),
            (800, 0.62628067),
            (900, 0.9932676),
            (1050, 0.),
            (1350, 0.1269767),
            (1500, 0.98899287),
            (1900, 0.15156534),
            (2050, 0.97763705),
            (2200, 0.),
        ] {
            a.game_time = time;
            assert!(
                (a.end_flash(now) - expected).abs() < 0.0001,
                "time {time}: {} != {expected}",
                a.end_flash(now)
            );
        }
    }
    #[test]
    fn lightning_is_bounded_expires_and_does_not_change_day_clock_or_raw_light() {
        let mut env = Environment::default();
        let now = Instant::now();
        let time = env.ticks;
        for seed in 0..1000 {
            env.atmosphere.lightning(seed, [0.; 3]);
        }
        assert!(env.atmosphere.flashing());
        assert_eq!(env.atmosphere.bolts.len(), 16);
        let hud = crate::shared::HudSnapshot::default();
        assert_eq!(
            crate::lighting::LightmapInputs::environment(&env, now, 0.5, &hud).sky_factor,
            1.
        );
        for tick in 1..200 {
            env.atmosphere.tick(now + Duration::from_millis(tick * 50));
        }
        assert!(!env.atmosphere.flashing());
        assert!(env.atmosphere.bolts.iter().all(Option::is_none));
        assert_eq!(env.ticks, time);
    }
    #[test]
    fn medium_fog_matches_reference_distances_and_water_adaptation() {
        let mut env = Environment::default();
        let now = Instant::now();
        let mut hud = crate::shared::HudSnapshot::default();
        env.atmosphere.set_medium(Medium::Water, now);
        assert_eq!(fog(&env, now, 256., &hud, 0.).1[..2], [-8., 24.]);
        assert!(
            (fog(&env, now + Duration::from_secs(30), 256., &hud, 0.).1[1] - 96.).abs() < 0.001
        );
        env.atmosphere.set_medium(Medium::Lava, now);
        assert_eq!(fog(&env, now, 256., &hud, 0.).1[..2], [0.25, 1.]);
        hud.game_mode = 3;
        assert_eq!(fog(&env, now, 256., &hud, 0.).1[..2], [-8., 128.]);
        hud.game_mode = 0;
        env.atmosphere.set_medium(Medium::PowderSnow, now);
        assert_eq!(fog(&env, now, 256., &hud, 0.).1[..2], [0., 2.]);
        env.atmosphere.set_medium(Medium::Air, now);
        assert_eq!(fog(&env, now, 256., &hud, 1.).1[..2], [11.25, 15.]);
    }
}
