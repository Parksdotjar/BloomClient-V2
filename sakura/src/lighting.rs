//! Minecraft Java 26.1 lightmap. Raw server channels never depend on options.
use azalea_client::local_player::WorldHolder;
use azalea_client::packet::game::ReceiveGamePacketEvent;
use azalea_protocol::packets::game::{ClientboundGamePacket as Packet, c_game_event::EventType};
use azalea_registry::{DataRegistry, identifier::Identifier};
use bevy_ecs::prelude::*;
use std::time::Instant;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LightSample {
    pub block: Option<u8>,
    pub sky: Option<u8>,
}
impl LightSample {
    pub fn packed(self) -> u8 {
        self.block.unwrap_or(0).min(15) | (self.sky.unwrap_or(0).min(15) << 4)
    }
    pub fn complete(self) -> bool {
        self.block.is_some() && self.sky.is_some()
    }
    pub fn effective(self, sky_level: f32) -> Option<u8> {
        Some(
            self.block?.max(
                self.sky?
                    .saturating_sub(15 - (sky_level.clamp(0., 15.).floor() as u8)),
            ),
        )
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Dimension {
    #[default]
    Overworld,
    Nether,
    End,
    Custom,
}
#[derive(Clone, Debug, Resource)]
pub struct Environment {
    pub weather: crate::weather::Weather,
    pub atmosphere: crate::atmosphere::Atmosphere,
    pub dimension: Dimension,
    pub ticks: f64,
    pub rate: f32,
    pub received: Instant,
    pub rain: f32,
    pub thunder: f32,
    pub revision: u64,
    pub clock: std::sync::Arc<str>,
    pub ambient: Option<[f32; 3]>,
    pub sky_color: Option<[f32; 3]>,
    pub sky_factor: Option<f32>,
    pub block_tint: Option<[f32; 3]>,
    pub night_color: Option<[f32; 3]>,
    pub fog_color: Option<[f32; 3]>,
}
impl Default for Environment {
    fn default() -> Self {
        Self {
            weather: Default::default(),
            atmosphere: Default::default(),
            dimension: Dimension::Overworld,
            ticks: 6000.,
            rate: 0.,
            received: Instant::now(),
            rain: 0.,
            thunder: 0.,
            revision: 0,
            clock: "minecraft:overworld".into(),
            ambient: None,
            sky_color: None,
            sky_factor: None,
            block_tint: None,
            night_color: None,
            fog_color: None,
        }
    }
}
impl Environment {
    pub fn time(&self, now: Instant) -> f32 {
        (self.ticks
            + now.saturating_duration_since(self.received).as_secs_f64() * 20. * self.rate as f64)
            .rem_euclid(24000.) as f32
    }
    pub fn sky_level(&self, now: Instant) -> f32 {
        if self.dimension == Dimension::Nether {
            return 4.;
        }
        if self.dimension == Dimension::End {
            return 15.;
        }
        let base = 15. * day_track(self.time(now), 133., 11867., 13670., 22330., 1., 0.26666668);
        weather(base, 4., self.rain, self.thunder)
    }
    pub fn fog(&self, now: Instant) -> [f32; 4] {
        let base = self.atmosphere.fog_color.or(self.fog_color).unwrap_or_else(|| {
            rgb(match self.dimension {
                Dimension::Nether => 0x330808,
                Dimension::End => 0x181318,
                _ => 0xc0d8ff,
            })
        });
        let c = if matches!(self.dimension, Dimension::Overworld | Dimension::Custom) {
            let day = day_track(self.time(now), 133., 11867., 13670., 22330., 1., 0.);
            let night = rgb(0x0f0f16);
            std::array::from_fn(|i| {
                base[i]
                    * mix(night[i], 1., day)
                    * (1. - self.rain * 0.5)
                    * (1. - self.thunder * 0.5)
            })
        } else {
            base
        };
        [c[0], c[1], c[2], 1.]
    }
    fn enter(&mut self, name: &str) {
        let rev = self.revision + 1;
        *self = Self::default();
        self.revision = rev;
        self.dimension = match name {
            "minecraft:overworld" => Dimension::Overworld,
            "minecraft:the_nether" => Dimension::Nether,
            "minecraft:the_end" => Dimension::End,
            _ => Dimension::Custom,
        };
    }
}
pub fn capture(
    mut events: MessageReader<ReceiveGamePacketEvent>,
    mut env: ResMut<Environment>,
    holders: Query<&WorldHolder>,
) {
    env.atmosphere.tick(Instant::now());
    for event in events.read() {
        let holder = holders.get(event.entity).ok();
        let world = holder.map(|h| h.shared.read());
        let common = match event.packet.as_ref() {
            Packet::Login(p) => Some(&p.common),
            Packet::Respawn(p) => Some(&p.common),
            _ => None,
        };
        if let Some(common) = common {
            env.enter(&common.dimension.to_string());
            if let Some(world) = &world {
                if let Some((_, data)) = world
                    .registries
                    .dimension_type
                    .map
                    .get_index(common.dimension_type.protocol_id() as usize)
                {
                    if let Some(clock) = data._extra.get("default_clock").and_then(|v| v.string()) {
                        env.clock = clock.to_string_lossy().into_owned().into();
                    }
                    if let Some(attrs) = data._extra.get("attributes").and_then(|v| v.compound()) {
                        let color = |name: &str| {
                            attrs
                                .get(name)
                                .and_then(|v| {
                                    v.int().map(|v| v as u32).or_else(|| {
                                        v.string().and_then(|v| {
                                            u32::from_str_radix(
                                                v.to_string_lossy().trim_start_matches('#'),
                                                16,
                                            )
                                            .ok()
                                        })
                                    })
                                })
                                .map(rgb)
                        };
                        let number=|name:&str|attrs.get(name).and_then(|v|v.float().or_else(||v.double().map(|v|v as f32))).filter(|v|v.is_finite());
                        if let Some(end)=number("minecraft:visual/fog_end_distance") {env.atmosphere.range=Some([number("minecraft:visual/fog_start_distance").unwrap_or(0.),end.max(0.001)]);}
                        if let Some(c)=color("minecraft:visual/water_fog_color") {env.atmosphere.water_color=c;}
                        if let Some(v)=number("minecraft:visual/water_fog_start_distance") {env.atmosphere.water_range[0]=v;}
                        if let Some(v)=number("minecraft:visual/water_fog_end_distance") {env.atmosphere.water_range[1]=v.max(0.001);}
                        env.ambient = color("minecraft:visual/ambient_light_color");
                        env.sky_color = color("minecraft:visual/sky_light_color");
                        env.block_tint = color("minecraft:visual/block_light_tint");
                        env.night_color = color("minecraft:visual/night_vision_color");
                        env.fog_color = color("minecraft:visual/fog_color");
                        env.sky_factor = attrs
                            .get("minecraft:visual/sky_light_factor")
                            .and_then(|v| v.float())
                            .filter(|v| v.is_finite())
                            .map(|v| v.clamp(0., 16.));
                    }
                }
            }
        }
        match event.packet.as_ref() {
            Packet::AddEntity(p) if p.entity_type == azalea_registry::builtin::EntityKind::LightningBolt => { env.atmosphere.lightning(p.id.0 as u64,[p.position.x,p.position.y,p.position.z]); }
            Packet::SetTime(p) => {
                env.atmosphere.game_time=p.game_time;env.atmosphere.received=Instant::now();
                if let Some(c) = p.clock_updates.iter().find_map(|(id, value)| {
                    world
                        .as_ref()
                        .and_then(|w| {
                            w.registries.protocol_id_to_identifier(
                                Identifier::new("minecraft:world_clock"),
                                id.protocol_id(),
                            )
                        })
                        .filter(|id| id.to_string() == env.clock.as_ref())
                        .map(|_| value)
                }) {
                    if c.rate.is_finite() && c.partial_tick.is_finite() {
                        env.ticks = c.total_ticks as f64 + c.partial_tick as f64;
                        env.rate = c.rate.clamp(-1000., 1000.);
                        env.received = Instant::now();
                        env.revision = env.revision.wrapping_add(1);
                    }
                }
            }
            Packet::GameEvent(p) if p.param.is_finite() => {
                match p.event {
                    EventType::StartRaining => env.rain = 1.,
                    EventType::StopRaining => env.rain = 0.,
                    EventType::RainLevelChange => env.rain = p.param.clamp(0., 1.),
                    EventType::ThunderLevelChange => env.thunder = p.param.clamp(0., 1.),
                    _ => continue,
                }
                env.revision = env.revision.wrapping_add(1);
            }
            _ => {}
        }
    }
}
fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
fn weather(a: f32, b: f32, r: f32, t: f32) -> f32 {
    mix(mix(a, b, (r - t).max(0.) * 0.3125), b, t * 0.52734375)
}
fn rgb(c: u32) -> [f32; 3] {
    [
        (c >> 16 & 255) as f32 / 255.,
        (c >> 8 & 255) as f32 / 255.,
        (c & 255) as f32 / 255.,
    ]
}
pub fn day_track(t: f32, a: f32, b: f32, c: f32, d: f32, day: f32, night: f32) -> f32 {
    if (a..=b).contains(&t) {
        day
    } else if (b..c).contains(&t) {
        mix(day, night, (t - b) / (c - b))
    } else if (c..=d).contains(&t) {
        night
    } else {
        let t = if t < a { t + 24000. } else { t };
        mix(night, day, (t - d) / (24000. + a - d))
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LightmapInputs {
    pub sky_factor: f32,
    pub block_factor: f32,
    pub night_vision: f32,
    pub darkness: f32,
    pub boss: f32,
    pub brightness: f32,
    pub block_tint: [f32; 3],
    pub sky_color: [f32; 3],
    pub ambient: [f32; 3],
    pub night_color: [f32; 3],
}
impl Default for LightmapInputs {
    fn default() -> Self {
        Self {
            sky_factor: 1.,
            block_factor: 1.4,
            night_vision: 0.,
            darkness: 0.,
            boss: 0.,
            brightness: 0.5,
            block_tint: rgb(0xffd88c),
            sky_color: [1.; 3],
            ambient: rgb(0x0a0a0a),
            night_color: [0.6; 3],
        }
    }
}
impl LightmapInputs {
    pub fn environment(
        env: &Environment,
        now: Instant,
        brightness: f32,
        hud: &crate::shared::HudSnapshot,
    ) -> Self {
        let mut s = Self {
            brightness: brightness.clamp(0., 1.),
            ..Default::default()
        };
        match env.dimension {
            Dimension::Nether => {
                s.sky_factor = 0.;
                s.ambient = rgb(0x302821);
                s.sky_color = rgb(0x7a7aff);
            }
            Dimension::End => {
                s.sky_factor = 0.;
                s.ambient = rgb(0x3f473f);
                s.sky_color = rgb(0xac60cd);
            }
            _ => {
                let day = day_track(env.time(now), 730., 11270., 13140., 22860., 1., 0.);
                s.sky_factor = weather(mix(0.24, 1., day), 0.24, env.rain, env.thunder);
                let night = rgb(0x7a7aff);
                s.sky_color = std::array::from_fn(|i| {
                    weather(mix(night[i], 1., day), night[i], env.rain, env.thunder)
                });
            }
        }
        if let Some(c) = env.ambient {
            s.ambient = c;
        }
        if let Some(c) = env.sky_color {
            s.sky_color = c;
        }
        if let Some(v) = env.sky_factor {
            s.sky_factor = v;
        }
        if let Some(c) = env.block_tint {
            s.block_tint = c;
        }
        if let Some(c) = env.night_color {
            s.night_color = c;
        }
        if env.atmosphere.flashing() {s.sky_factor=1.;}
        if env.dimension==Dimension::End {s.sky_factor+=env.atmosphere.end_flash(now);}
        s.boss = if hud.boss_bars.iter().any(|b| b.darken_screen) {
            1.
        } else {
            0.
        };
        for e in &hud.effects {
            let ticks = e
                .expires_at
                .map(|end| end.saturating_duration_since(now).as_secs_f32() * 20.)
                .unwrap_or(10000.);
            if ticks <= 0. {
                continue;
            }
            if e.name == "NightVision" || e.name == "night_vision" {
                s.night_vision = if ticks > 200. {
                    1.
                } else {
                    0.7 + (ticks * std::f32::consts::PI * 0.2).sin() * 0.3
                };
            }
        }
        s
    }
    /// Algebra follows the installed 26.1 lightmap.fsh, including chroma-preserving brightness.
    pub fn color(&self, block: u8, sky: u8) -> [f32; 3] {
        let b = block.min(15) as f32 / 15.;
        let s = sky.min(15) as f32 / 15.;
        let bb = b / (4. - 3. * b) * self.block_factor;
        let sb = s / (4. - 3. * s) * self.sky_factor;
        let parabola = 0.9 * (2. * b - 1.).powi(2);
        let mut c = std::array::from_fn(|i| {
            let c = self.ambient[i].max(self.night_color[i] * self.night_vision)
                + self.sky_color[i] * sb
                + mix(self.block_tint[i], 1., parabola) * bb;
            (mix(c, c * [0.7, 0.6, 0.6][i], self.boss) - self.darkness).clamp(0., 1.)
        });
        let max = c.iter().copied().fold(0f32, f32::max);
        if max > 0. {
            let gain = (1. - (1. - max).powi(4)) / max;
            for v in &mut c {
                *v = mix(*v, *v * gain, self.brightness);
            }
        }
        c
    }
    pub fn table(&self) -> [[f32; 4]; 256] {
        std::array::from_fn(|i| {
            let c = self.color((i % 16) as u8, (i / 16) as u8);
            [
                (c[0] * 255.).round() / 255.,
                (c[1] * 255.).round() / 255.,
                (c[2] * 255.).round() / 255.,
                1.,
            ]
        })
    }
}

/// Visual effects advance at the client tick rate, independently of world time.
/// Changing /time or freezing the sun must not freeze Darkness or block flicker.
pub struct VisualEffects {
    tick: u64,
    random: u64,
    flicker: f32,
    boss: f32,
    darkness: f32,
}
impl Default for VisualEffects {
    fn default() -> Self {
        Self {
            tick: 0,
            random: 0x5deece66d,
            flicker: 0.,
            boss: 0.,
            darkness: 0.,
        }
    }
}
impl VisualEffects {
    pub fn darkness(&self)->f32 {self.darkness}
    fn random(&mut self) -> f32 {
        self.random = self.random.wrapping_mul(0x5deece66d).wrapping_add(11) & ((1u64 << 48) - 1);
        (self.random >> 24) as f32 / 16777216.
    }
    pub fn apply(
        &mut self,
        inputs: &mut LightmapInputs,
        seconds: f32,
        hud: &crate::shared::HudSnapshot,
        now: Instant,
    ) {
        let tick = (seconds.max(0.) * 20.) as u64;
        let dark = hud.effects.iter().any(|e| {
            (e.name == "Darkness" || e.name == "darkness")
                && e.expires_at.is_none_or(|end| end > now)
        });
        for _ in 0..tick.saturating_sub(self.tick).min(20) {
            self.flicker = (self.flicker
                + (self.random() - self.random()) * self.random() * self.random() * 0.1)
                * 0.9;
            self.boss += (inputs.boss - self.boss) * 0.05;
            self.darkness +=
                (if dark { 1. } else { 0. } - self.darkness).clamp(-1. / 22., 1. / 22.);
        }
        self.tick = tick;
        inputs.block_factor = 1.4 + self.flicker;
        inputs.boss = self.boss;
        inputs.brightness = (inputs.brightness - self.darkness).max(0.);
        inputs.darkness =
            (seconds * 20. * std::f32::consts::PI * 0.025).cos().max(0.) * 0.45 * self.darkness;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_light_is_not_screen_brightness() {
        let l = LightSample {
            block: Some(0),
            sky: Some(15),
        };
        assert_eq!(l.effective(4.), Some(4));
        assert_eq!(LightSample::default().effective(15.), None);
        assert!(LightmapInputs::default().color(0, 0)[0] > 0.);
    }
    #[test]
    fn grid_is_finite_and_channels_remain_distinct() {
        for brightness in [0., 0.5, 1.] {
            let p = LightmapInputs {
                brightness,
                ..Default::default()
            };
            for c in p.table() {
                assert!(c.iter().all(|v| v.is_finite() && *v >= 0. && *v <= 1.));
            }
            assert_ne!(p.color(8, 0), p.color(0, 8));
        }
        let black = LightmapInputs {
            ambient: [0.; 3],
            ..Default::default()
        };
        assert_eq!(black.color(0, 0), [0.; 3]);
    }
    #[test]
    fn noon_midnight_and_weather_follow_26_1_track() {
        let mut e = Environment::default();
        let n = e.received;
        let h = crate::shared::HudSnapshot::default();
        assert_eq!(LightmapInputs::environment(&e, n, 0., &h).sky_factor, 1.);
        e.ticks = 18000.;
        assert_eq!(LightmapInputs::environment(&e, n, 0., &h).sky_factor, 0.24);
        e.ticks = 6000.;
        e.rain = 1.;
        assert!((LightmapInputs::environment(&e, n, 0., &h).sky_factor - 0.7625).abs() < 1e-6);
        e.dimension = Dimension::Nether;
        assert_eq!(LightmapInputs::environment(&e, n, 0., &h).sky_factor, 0.);
    }
}

#[derive(Clone, Debug, Default)]
pub struct DebugSample {
    pub position: [i32; 3],
    pub state: u32,
    pub light: LightSample,
    pub revision: u64,
    pub pending: usize,
}

pub fn to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

pub fn shadow_radius(e: &crate::shared::EntitySnapshot) -> f32 {
    let radius = match e.kind.as_str() {
        "Player" | "Zombie" | "Skeleton" | "Creeper" | "Villager" | "Enderman" => 0.5,
        "Cow" | "Pig" | "Sheep" => 0.7,
        "Spider" => 0.8,
        "CaveSpider" => 0.7,
        "Chicken" | "Rabbit" => 0.3,
        "Wolf" => 0.5,
        "Cat" => 0.4,
        "Item" => 0.15,
        _ => return 0.,
    };
    radius * if e.baby { 0.5 } else { 1. }
}
/// Reference 26.1 blob shadows only receive on full collision blocks, in local
/// brightness above three, and fade with camera distance and height.
pub fn shadows(
    e: &mut crate::shared::EntitySnapshot,
    eye: [f64; 3],
    world: &azalea_world::World,
    light: &crate::world_stream::Changes,
    sky: f32,
) {
    e.shadows.clear();
    let radius = shadow_radius(e) as f64;
    let distance = (0..3)
        .map(|i| (e.position[i] - eye[i]).powi(2))
        .sum::<f64>();
    let strength = (1. - distance / 256.) as f32;
    if radius <= 0. || strength <= 0. {
        return;
    }
    let height = (strength / 0.5 - 1.).min(radius as f32) as f64;
    for z in (e.position[2] - radius).floor() as i32..=(e.position[2] + radius).floor() as i32 {
        for x in (e.position[0] - radius).floor() as i32..=(e.position[0] + radius).floor() as i32 {
            for y in (e.position[1] - height).floor() as i32..=e.position[1].floor() as i32 {
                let Some(state) =
                    world.get_block_state(azalea_core::position::BlockPos::new(x, y - 1, z))
                else {
                    continue;
                };
                if !crate::light_properties::get(u32::from(state.id())).shadow_receiver() {
                    continue;
                }
                let Some(level) = light.sample([x, y, z]).effective(sky).filter(|v| *v > 3) else {
                    continue;
                };
                let b = level as f32 / 15.;
                let opacity = ((strength - (e.position[1] - y as f64) as f32 * 0.5)
                    * 0.5
                    * (b / (4. - 3. * b)))
                    .clamp(0., 1.);
                if opacity > 0. {
                    e.shadows.push(crate::shared::ShadowPiece {
                        position: [x, y, z],
                        opacity,
                    });
                }
            }
        }
    }
}
