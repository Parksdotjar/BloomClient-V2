//! Java 26.1 HUD in logical GUI pixels; values originate in server snapshots.
//! Animation timing/layout follows Gui, ChatComponent and MobEffectInstance in
//! the pinned official client. Timed geometry is rebuilt at 20 Hz, not every frame.
use super::{
    gui::{GuiMetrics, Painter},
    *,
};
use crate::shared::{HudEffect, HudSnapshot};
use std::cmp::Ordering;

pub(super) fn draw(
    state: &FrameState,
    input: &InputState,
    ui: &UiState<'_>,
    assets: &AssetPack,
    size: PhysicalSize<u32>,
    lightmap: &[[f32;4];256],
) -> (Vec<HudVertex>, u32) {
    let mut out = Vec::with_capacity(8192);
    let metrics = GuiMetrics::new(size, ui.gui_scale);
    let mut p = Painter {
        vertices: &mut out,
        assets,
        metrics,
        time: ui.time,
    };
    let (w, h) = (metrics.width, metrics.height);
    let center = (w / 2.).floor();
    let now = Instant::now();
    let data = &state.hud;
    if state.connected && !input.hide_hud {
        if has_hotbar(data.game_mode) {
            p.sprite("gui/sprites/hud/hotbar", [center - 91., h - 22., 182., 22.]);
            p.sprite(
                "gui/sprites/hud/hotbar_selection",
                [
                    center - 92. + input.hotbar.min(8) as f32 * 20.,
                    h - 23.,
                    24.,
                    23.,
                ],
            );
            for (i, slot) in state.hotbar.iter().enumerate() {
                let x = center - 88. + i as f32 * 20.;
                p.item(slot, x, h - 19., true);
                draw_cooldown(&mut p, slot, x, h - 19., data, now);
            }
            // Sakura currently negotiates the vanilla right-handed default.
            if data.offhand.count > 0 {
                p.sprite(
                    "gui/sprites/hud/hotbar_offhand_left",
                    [center - 120., h - 23., 29., 24.],
                );
                p.item(&data.offhand, center - 117., h - 19., true);
                draw_cooldown(&mut p, &data.offhand, center - 117., h - 19., data, now);
            }
        }
        if has_survival_hud(data.game_mode) {
            draw_survival(&mut p, data, now, gui_tick(ui.time));
        }
        // Spectator crosshairs require a menu-bearing hit target, which is not
        // yet part of the renderer's target snapshot. Do not imply an action.
        if ui.captured && data.health > 0. && data.game_mode != 3 {
            p.sprite(
                "gui/sprites/hud/crosshair",
                [((w - 15.) / 2.).floor(), ((h - 15.) / 2.).floor(), 15., 15.],
            );
            if data.attack_strength < 1. {
                let x = center - 8.;
                let y = (h / 2.).floor() + 9.;
                p.sprite(
                    "gui/sprites/hud/crosshair_attack_indicator_background",
                    [x, y, 16., 4.],
                );
                let progress = (data.attack_strength.clamp(0., 1.) * 17.).floor().min(16.);
                p.sprite_crop(
                    "gui/sprites/hud/crosshair_attack_indicator_progress",
                    [x, y, progress, 4.],
                    [0., 0., progress, 4.],
                );
            }
        }
        let selected = &state.hotbar[input.hotbar.min(8) as usize];
        if has_hotbar(data.game_mode) && selected.count > 0 {
            let elapsed = data
                .selected_item_changed_at
                .map(|t| now.saturating_duration_since(t).as_secs_f32())
                .unwrap_or(5.);
            // Java's forty-tick highlight fades during its final ten ticks.
            let alpha = ((2. - elapsed) * (512. / 255.)).clamp(0., 1.);
            if alpha > 0. {
                p.centered_item_name(
                    selected,
                    center,
                    h - if has_survival_hud(data.game_mode) {
                        59.
                    } else {
                        45.
                    },
                    [1., 1., 1., alpha],
                    true,
                );
            }
        }
        draw_effects(&mut p, data, now);
        draw_boss_bars(&mut p, data);
        draw_chat(&mut p, data, now, ui.chat_input.is_some());
        if let Some(message) = &data.action_bar {
            let alpha = fade_out(
                now.saturating_duration_since(message.received_at)
                    .as_secs_f32(),
                3.,
                1.,
            );
            if alpha > 0. {
                let x = center - (p.rich_text_width(&message.text) / 2.).floor();
                p.rich_text(&message.text, x, h - 72., [1., 1., 1., alpha], true);
            }
        }
        if let Some(title) = &data.title {
            let age = now.saturating_duration_since(title.received_at).as_millis() as u64;
            let alpha = title_alpha(data, age);
            if alpha > 0. {
                // The Java title pose translates to center first, then scales
                // local y=-10 and y=5 respectively.
                p.scaled_rich_text(&title.text, center, h / 2. - 40., 4., [1., 1., 1., alpha]);
                p.scaled_rich_text(
                    &data.subtitle,
                    center,
                    h / 2. + 10.,
                    2.,
                    [1., 1., 1., alpha],
                );
            }
        }
    }
    if input.light_debug>0 && !input.hide_hud {
        let d=&state.light_debug;let prop=crate::light_properties::get(d.state);
        let lines=[format!("Lighting / Java 26.1 | F3: next view"),format!("{:?} state {} emission {} attenuation {}",d.position,d.state,prop.emission(),prop.attenuation()),format!("Block {:?} Sky {:?} Effective {:?}",d.light.block,d.light.sky,d.light.effective(state.environment.sky_level(now))),format!("Revision {} / pending {} / {}",d.revision,d.pending,if d.light.complete(){"server data received"}else{"waiting for server data"}),format!("Shape occlusion {} / direct sky {}",prop.shape_occlusion(),prop.sky_down())];
        for (i,line) in lines.iter().enumerate(){p.solid([2.,2.+i as f32*11.,p.text_width(line)+4.,11.],[0.,0.,0.,0.7]);p.text(line,4.,3.+i as f32*11.,[1.;4],true);}
        if input.light_debug==4 {for sky in 0..16 {for block in 0..16 {let c=lightmap[block as usize+sky as usize*16];p.solid([4.+block as f32*5.,64.+(15-sky) as f32*5.,5.,5.],[c[0],c[1],c[2],1.]);}}}
    }
    inventory_ui::draw(
        &mut p,
        ui.inventory,
        &state.inventory,
        metrics.pointer(ui.cursor),
    );
    let overlay_start = p.vertices.len() as u32;
    if let Some(text) = ui.chat_input {
        p.solid([2., h - 14., w - 4., 12.], [0., 0., 0., 0.5]);
        let mut tail = text;
        while p.text_width(tail) > w - 14. {
            tail = &tail[tail
                .char_indices()
                .nth(1)
                .map(|(i, _)| i)
                .unwrap_or(tail.len())..];
        }
        p.text(tail, 4., h - 12., [1.; 4], true);
        if (ui.time * 2.) as u32 % 2 == 0 {
            p.text("_", 4. + p.text_width(tail), h - 12., [1.; 4], true);
        }
    } else if ui.paused || state.connected && data.health <= 0. {
        let dead = state.connected && data.health <= 0.;
        if dead {
            let start=p.vertices.len();
            p.solid([0.,0.,w,h],[80./255.,0.,0.,96./255.]);
            for vertex in &mut p.vertices[start..] {
                if vertex.position[1]>0. {vertex.color=[128./255.,48./255.,48./255.,160./255.];}
            }
        } else {
            // Screen.extractMenuBackground uses the official black alpha-64
            // in-world texture after blur, without another darkening layer.
            p.sprite("gui/inworld_menu_background", [0., 0., w, h]);
        }
        let heading = if dead {
            "deathScreen.title"
        } else if ui.settings {
            "options.title"
        } else {
            "menu.game"
        };
        if dead {
            p.scaled_text(&p.label(heading), center, 30., 2., [1.; 4]);
        } else {
            p.centered_text(&p.label(heading), center, 40., [1.; 4], true);
        }
        for (index, (rect, label)) in
            menu_buttons(metrics, dead, ui.settings, ui.gui_scale, ui.volume, ui.brightness, ui.smooth_lighting)
                .into_iter()
                .enumerate()
        {
            let hovered = inside(metrics.pointer(ui.cursor), rect) || ui.focus == Some(index);
            if ui.settings && index == 1 {
                p.slider(rect, &p.label(&label), ui.volume, hovered);
            } else {
                p.button(rect, &p.label(&label), hovered, true);
            }
        }
    } else if !ui.captured && !ui.inventory.active(&state.inventory) {
        p.centered_text(
            if state.connected {
                "Click to play"
            } else {
                &state.status
            },
            center,
            h / 2.,
            [1.; 4],
            true,
        );
    }
    (out, overlay_start)
}

fn has_hotbar(mode: u8) -> bool {
    mode != 3
}
fn has_survival_hud(mode: u8) -> bool {
    matches!(mode, 0 | 2)
}
fn gui_tick(time: f32) -> u32 {
    (time.max(0.) * 20.).floor() as u32
}

#[derive(Debug)]
struct HeartLayout {
    health: usize,
    total: usize,
    rows: usize,
    spacing: f32,
    effective_max: f32,
}
fn heart_layout(data: &HudSnapshot, now: Instant) -> HeartLayout {
    let display_health = if data
        .health_changed_at
        .is_some_and(|t| now.saturating_duration_since(t) < Duration::from_secs(1))
    {
        data.previous_health
    } else {
        data.health
    };
    let effective_max = data
        .max_health
        .max(data.health.ceil())
        .max(display_health.ceil())
        .clamp(0., 400.);
    let health = (effective_max / 2.).ceil() as usize;
    // Separate rounding preserves a half absorption heart when max health is odd.
    let total = (health + (data.absorption.max(0.) / 2.).ceil() as usize).min(200);
    let rows = total.div_ceil(10).max(1);
    HeartLayout {
        health,
        total,
        rows,
        spacing: (10. - (rows as f32 - 2.)).max(3.),
        effective_max,
    }
}

fn health_blink(data: &HudSnapshot, now: Instant) -> bool {
    let Some(changed) = data.health_changed_at else {
        return false;
    };
    let length: u128 = if data.health < data.previous_health {
        20
    } else if data.health > data.previous_health {
        10
    } else {
        return false;
    };
    let elapsed = now.saturating_duration_since(changed).as_millis() / 50;
    elapsed < length && ((length - elapsed) / 3) % 2 == 1
}

fn has_effect(data: &HudSnapshot, name: &str, now: Instant) -> bool {
    data.effects
        .iter()
        .any(|effect| effect.name == name && effect_active(effect, now))
}
fn effect_active(effect: &HudEffect, now: Instant) -> bool {
    effect.expires_at.is_none_or(|end| end > now)
}

// LegacyRandomSource's 48-bit generator keeps the subtle jitter stable during
// each GUI tick and identical at 30, 60 or 144 rendered frames per second.
struct HudRandom(u64);
impl HudRandom {
    fn new(tick: u32) -> Self {
        let seed = (tick as i32).wrapping_mul(312871) as i64 as u64;
        Self((seed ^ 0x5deece66d) & ((1 << 48) - 1))
    }
    fn bits(&mut self) -> u32 {
        self.0 = self.0.wrapping_mul(0x5deece66d).wrapping_add(11) & ((1 << 48) - 1);
        (self.0 >> 17) as u32
    }
    fn below(&mut self, bound: u32) -> u32 {
        if bound.is_power_of_two() {
            return ((u64::from(bound) * u64::from(self.bits())) >> 31) as u32;
        }
        loop {
            let bits = self.bits();
            let value = bits % bound;
            if bits - value + (bound - 1) < (1 << 31) {
                return value;
            }
        }
    }
}

fn draw_survival(p: &mut Painter, data: &HudSnapshot, now: Instant, tick: u32) {
    let (w, h) = (p.metrics.width, p.metrics.height);
    let center = (w / 2.).floor();
    let (left, right, bottom) = (center - 91., center + 91., h - 39.);
    let layout = heart_layout(data, now);
    let armor_y = bottom - (layout.rows as f32 - 1.) * layout.spacing - 10.;
    if data.armor > 0 {
        for i in 0..10 {
            let value = data.armor as i32 - i * 2;
            let kind = if value >= 2 {
                "full"
            } else if value == 1 {
                "half"
            } else {
                "empty"
            };
            p.sprite(
                &format!("gui/sprites/hud/armor_{kind}"),
                [left + i as f32 * 8., armor_y, 9., 9.],
            );
        }
    }
    let blink = health_blink(data, now);
    let effect = if has_effect(data, "poison", now) {
        "poisoned_"
    } else if has_effect(data, "wither", now) {
        "withered_"
    } else if data.frozen_ticks >= 140 {
        "frozen_"
    } else {
        ""
    };
    let regeneration = has_effect(data, "regeneration", now)
        .then(|| tick as usize % (layout.effective_max + 5.).ceil().max(1.) as usize);
    let health = data.health.ceil();
    let absorption = data.absorption.ceil();
    let mut random = HudRandom::new(tick);
    for i in (0..layout.total).rev() {
        let x = left + (i % 10) as f32 * 8.;
        let mut y = bottom - (i / 10) as f32 * layout.spacing;
        if health + absorption <= 4. {
            y += random.below(2) as f32;
        }
        if i < layout.health && regeneration == Some(i) {
            y -= 2.;
        }
        let hard = if data.hardcore { "_hardcore" } else { "" };
        let flashing = if blink { "_blinking" } else { "" };
        p.sprite(
            &format!("gui/sprites/hud/heart/container{hard}{flashing}"),
            [x, y, 9., 9.],
        );
        if blink && i < layout.health {
            draw_heart(
                p,
                x,
                y,
                data.previous_health.ceil() - i as f32 * 2.,
                effect,
                data.hardcore,
                true,
            );
        }
        let (value, prefix) = if i >= layout.health {
            (
                absorption - (i - layout.health) as f32 * 2.,
                if effect == "withered_" {
                    "withered_"
                } else {
                    "absorbing_"
                },
            )
        } else {
            (health - i as f32 * 2., effect)
        };
        draw_heart(p, x, y, value, prefix, data.hardcore, false);
    }
    let hungry = has_effect(data, "hunger", now);
    for i in 0..10 {
        let x = right - i as f32 * 8. - 9.;
        let mut y = bottom;
        if data.saturation <= 0. && tick % (u32::from(data.food) * 3 + 1) == 0 {
            y += random.below(3) as f32 - 1.;
        }
        p.sprite(
            if hungry {
                "gui/sprites/hud/food_empty_hunger"
            } else {
                "gui/sprites/hud/food_empty"
            },
            [x, y, 9., 9.],
        );
        let value = data.food as i32 - i * 2;
        if value > 0 {
            let part = if value >= 2 { "full" } else { "half" };
            p.sprite(
                &format!(
                    "gui/sprites/hud/food_{part}{}",
                    if hungry { "_hunger" } else { "" }
                ),
                [x, y, 9., 9.],
            );
        }
    }
    // The current snapshot has air supply, but not eye-fluid immersion; a full
    // air row at the instant of submersion awaits that native snapshot field.
    if data.air < data.max_air {
        let air = data.air.clamp(0, data.max_air.max(1));
        let max = data.max_air.max(1) as f32;
        let full = (((air - 2) as f32 * 10.) / max).ceil().clamp(0., 10.) as i32;
        let current = ((air as f32 * 10.) / max).ceil() as i32;
        for i in 0..10 {
            let y = bottom - 10.
                + if air == 0 && tick % 2 == 0 {
                    random.below(2) as f32
                } else {
                    0.
                };
            p.sprite(
                if i < full {
                    "gui/sprites/hud/air"
                } else if i < current {
                    "gui/sprites/hud/air_bursting"
                } else {
                    "gui/sprites/hud/air_empty"
                },
                [right - i as f32 * 8. - 9., y, 9., 9.],
            );
        }
    }
    p.sprite(
        "gui/sprites/hud/experience_bar_background",
        [left, h - 29., 182., 5.],
    );
    let progress = (data.experience.clamp(0., 1.) * 183.).floor().min(182.);
    p.sprite_crop(
        "gui/sprites/hud/experience_bar_progress",
        [left, h - 29., progress, 5.],
        [0., 0., progress, 5.],
    );
    if data.level > 0 {
        let text = data.level.to_string();
        let x = center - (p.text_width(&text) / 2.).floor();
        let y = h - 35.;
        for [dx, dy] in [[1., 0.], [-1., 0.], [0., 1.], [0., -1.]] {
            p.text(&text, x + dx, y + dy, [0., 0., 0., 1.], false);
        }
        p.text(&text, x, y, [128. / 255., 1., 32. / 255., 1.], false);
    }
}

fn draw_heart(
    p: &mut Painter,
    x: f32,
    y: f32,
    value: f32,
    prefix: &str,
    hardcore: bool,
    blink: bool,
) {
    if value <= 0. {
        return;
    }
    let part = if value > 1. { "full" } else { "half" };
    let hard = if hardcore { "hardcore_" } else { "" };
    let flashing = if blink { "_blinking" } else { "" };
    p.sprite(
        &format!("gui/sprites/hud/heart/{prefix}{hard}{part}{flashing}"),
        [x, y, 9., 9.],
    );
}

fn effect_ticks(effect: &HudEffect, now: Instant) -> i32 {
    effect.expires_at.map_or(-1, |end| {
        end.saturating_duration_since(now)
            .as_millis()
            .div_ceil(50)
            .min(i32::MAX as u128) as i32
    })
}
fn effect_alpha(effect: &HudEffect, now: Instant) -> f32 {
    let duration = effect_ticks(effect, now);
    if effect.ambient || !(0..=200).contains(&duration) {
        return 1.;
    }
    let n = 10 - duration / 20;
    // Gui.extractEffects deliberately blinks only the icon, not its background.
    ((duration as f32 / 100.).clamp(0., 0.5)
        + (duration as f32 * std::f32::consts::PI / 5.).cos()
            * (n as f32 / 10. * 0.25).clamp(0., 0.25))
    .clamp(0., 1.)
}
fn effect_beneficial(name: &str) -> bool {
    matches!(
        name,
        "speed"
            | "haste"
            | "strength"
            | "instant_health"
            | "jump_boost"
            | "regeneration"
            | "resistance"
            | "fire_resistance"
            | "water_breathing"
            | "invisibility"
            | "night_vision"
            | "health_boost"
            | "absorption"
            | "saturation"
            | "luck"
            | "slow_falling"
            | "conduit_power"
            | "dolphins_grace"
            | "hero_of_the_village"
            | "breath_of_the_nautilus"
    )
}
// The registered colors are the final tie-breaker in MobEffectInstance.compareTo.
fn effect_color(name: &str) -> u32 {
    match name {
        "speed" => 3402751,
        "slowness" => 9154528,
        "haste" => 14270531,
        "mining_fatigue" => 4866583,
        "strength" => 16762624,
        "instant_health" => 16262179,
        "instant_damage" => 11101546,
        "jump_boost" => 16646020,
        "nausea" => 5578058,
        "regeneration" => 13458603,
        "resistance" => 9520880,
        "fire_resistance" => 16750848,
        "water_breathing" => 10017472,
        "invisibility" => 16185078,
        "blindness" => 2039587,
        "night_vision" => 12779366,
        "hunger" => 5797459,
        "weakness" => 4738376,
        "poison" => 8889187,
        "wither" => 7561558,
        "health_boost" => 16284963,
        "absorption" => 2445989,
        "saturation" => 16262179,
        "glowing" => 9740385,
        "levitation" => 13565951,
        "luck" => 5882118,
        "unluck" => 12624973,
        "slow_falling" => 15978425,
        "conduit_power" => 1950417,
        "dolphins_grace" => 8954814,
        "bad_omen" => 745784,
        "hero_of_the_village" => 4521796,
        "darkness" => 2696993,
        "trial_omen" => 1484454,
        "raid_omen" => 14565464,
        "wind_charged" => 12438015,
        "weaving" => 7891290,
        "oozing" => 10092451,
        "infested" => 9214860,
        "breath_of_the_nautilus" => 65518,
        _ => 0,
    }
}
fn effect_order(a: &HudEffect, b: &HudEffect, now: Instant) -> Ordering {
    let (ad, bd) = (effect_ticks(a, now), effect_ticks(b, now));
    let ambient = a.ambient.cmp(&b.ambient);
    let order = if ad > 32147 && bd > 32147 || a.ambient && b.ambient {
        ambient.then_with(|| effect_color(&a.name).cmp(&effect_color(&b.name)))
    } else {
        ambient
            .then_with(|| a.expires_at.is_none().cmp(&b.expires_at.is_none()))
            .then_with(|| ad.cmp(&bd))
            .then_with(|| effect_color(&a.name).cmp(&effect_color(&b.name)))
    };
    order.reverse()
}
fn draw_effects(p: &mut Painter, data: &HudSnapshot, now: Instant) {
    let mut effects: Vec<_> = data
        .effects
        .iter()
        .filter(|e| e.show_icon && effect_active(e, now))
        .collect();
    effects.sort_by(|a, b| effect_order(a, b, now));
    let mut counts = [0usize; 2];
    let max_columns = (p.metrics.width / 25.).floor() as usize;
    for effect in effects {
        let row = usize::from(!effect_beneficial(&effect.name));
        if counts[row] >= max_columns {
            continue;
        }
        counts[row] += 1;
        let x = p.metrics.width - counts[row] as f32 * 25.;
        let y = 1. + row as f32 * 26.;
        p.sprite(
            if effect.ambient {
                "gui/sprites/hud/effect_background_ambient"
            } else {
                "gui/sprites/hud/effect_background"
            },
            [x, y, 24., 24.],
        );
        p.sprite_tint(
            &format!("mob_effect/{}", effect.name),
            [x + 3., y + 3., 18., 18.],
            [1., 1., 1., effect_alpha(effect, now)],
        );
    }
}

fn draw_boss_bars(p: &mut Painter, data: &HudSnapshot) {
    let center = (p.metrics.width / 2.).floor();
    for (i, boss) in data.boss_bars.iter().enumerate() {
        let y = 12. + i as f32 * 19.;
        if y >= p.metrics.height / 3. {
            break;
        }
        let color = ["pink", "blue", "red", "green", "yellow", "purple", "white"]
            .get(boss.color as usize)
            .unwrap_or(&"white");
        p.sprite(
            &format!("gui/sprites/boss_bar/{color}_background"),
            [center - 91., y, 182., 5.],
        );
        let width = (boss.progress.clamp(0., 1.) * 182.).floor();
        p.sprite_crop(
            &format!("gui/sprites/boss_bar/{color}_progress"),
            [center - 91., y, width, 5.],
            [0., 0., width, 5.],
        );
        if boss.overlay > 0 {
            let n = [6, 10, 12, 20][(boss.overlay - 1).min(3) as usize];
            p.sprite(
                &format!("gui/sprites/boss_bar/notched_{n}_background"),
                [center - 91., y, 182., 5.],
            );
            p.sprite_crop(
                &format!("gui/sprites/boss_bar/notched_{n}_progress"),
                [center - 91., y, width, 5.],
                [0., 0., width, 5.],
            );
        }
        p.rich_text(
            &boss.name,
            center - (p.rich_text_width(&boss.name) / 2.).floor(),
            y - 9.,
            [1.; 4],
            true,
        );
    }
}

fn fade_out(age: f32, lifetime: f32, fade: f32) -> f32 {
    ((lifetime - age) / fade).clamp(0., 1.)
}
fn chat_alpha(age: f32, focused: bool) -> f32 {
    if focused {
        1.
    } else {
        fade_out(age, 10., 1.).powi(2)
    }
}
fn draw_chat(p: &mut Painter, data: &HudSnapshot, now: Instant, focused: bool) {
    let width = 320f32.min(p.metrics.width - 8.);
    let max_lines = if focused { 20 } else { 10 };
    let bottom = p.metrics.height - 40.;
    let mut used = 0;
    for message in data.chat.iter().rev() {
        let alpha = chat_alpha(
            now.saturating_duration_since(message.received_at)
                .as_secs_f32(),
            focused,
        );
        if alpha <= 3. / 255. {
            continue;
        }
        let height = p.rich_text_height(&message.text, width);
        let lines = (height / 9.).ceil().max(1.) as usize;
        let visible = lines.min(max_lines - used);
        let end = bottom - used as f32 * 9.;
        let clip_top = end - visible as f32 * 9.;
        p.solid(
            [2., clip_top, width + 6., visible as f32 * 9.],
            [0., 0., 0., 0.5 * alpha],
        );
        // Retain the final lines of an oversized message while clipping its
        // formatted glyphs at the chat viewport, not at an arbitrary substring.
        p.rich_text_in_rect(
            &message.text,
            [4., end - height],
            width,
            [4., clip_top, width, visible as f32 * 9.],
            [1., 1., 1., alpha],
            true,
        );
        used += visible;
        if used >= max_lines {
            break;
        }
    }
}
fn title_alpha(data: &HudSnapshot, age: u64) -> f32 {
    let stay_end = data.title_fade_in_ms.saturating_add(data.title_stay_ms);
    let end = stay_end.saturating_add(data.title_fade_out_ms);
    if age < data.title_fade_in_ms {
        age as f32 / data.title_fade_in_ms.max(1) as f32
    } else if age > stay_end {
        end.saturating_sub(age) as f32 / data.title_fade_out_ms.max(1) as f32
    } else {
        1.
    }
}

/// Only active visual animations need the 20 Hz cache key. Effect expiration
/// gets a short final invalidation window so its last cached icon disappears.
pub(super) fn needs_animation(data: &HudSnapshot, now: Instant) -> bool {
    has_survival_hud(data.game_mode)
        && (data.health.ceil() + data.absorption.ceil() <= 4.
            || data.saturation <= 0.
            || data.air <= 0
            || has_effect(data, "regeneration", now))
        || data.effects.iter().any(|effect| {
            effect.show_icon
                && effect.expires_at.is_some_and(|end| {
                    now < end + Duration::from_millis(100)
                        && end.saturating_duration_since(now) <= Duration::from_secs(10)
                })
        })
}
fn draw_cooldown(
    p: &mut Painter,
    slot: &HotbarSlot,
    x: f32,
    y: f32,
    data: &HudSnapshot,
    now: Instant,
) {
    if let Some(cd) = data
        .cooldowns
        .iter()
        .find(|cd| cd.group == slot.cooldown_group)
    {
        let total = cd
            .ends_at
            .saturating_duration_since(cd.started_at)
            .as_secs_f32();
        p.cooldown(
            x,
            y,
            cd.ends_at.saturating_duration_since(now).as_secs_f32() / total.max(0.001),
        );
    }
}

pub(super) fn menu_buttons(
    m: GuiMetrics,
    dead: bool,
    settings: bool,
    scale: u8,
    volume: f32,
    brightness: f32,
    smooth: bool,
) -> Vec<([f32; 4], String)> {
    let x = (m.width / 2.).floor() - 100.;
    let y = if dead {
        m.height / 4. + 72.
    } else {
        m.height / 4. + 48.
    };
    if settings {
        vec![
            (
                [x, y, 200., 20.],
                format!(
                    "GUI Scale: {}",
                    if scale == 0 {
                        "Auto".into()
                    } else {
                        scale.to_string()
                    }
                ),
            ),
            (
                [x, y + 24., 200., 20.],
                format!("Master Volume: {}%", (volume * 100.).round() as u32),
            ),
            ([x,y+48.,200.,20.],format!("Brightness: {}%",(brightness*100.).round() as u32)),
            ([x,y+72.,200.,20.],format!("Smooth Lighting: {}",if smooth {"ON"}else{"OFF"})),
            ([x, y + 108., 200., 20.], "gui.done".into()),
        ]
    } else if dead {
        vec![
            ([x, y, 200., 20.], "deathScreen.respawn".into()),
            ([x, y + 24., 200., 20.], "deathScreen.titleScreen".into()),
        ]
    } else {
        vec![
            ([x, y, 200., 20.], "menu.returnToGame".into()),
            ([x, y + 24., 200., 20.], "menu.options".into()),
            ([x, y + 48., 200., 20.], "menu.disconnect".into()),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn effect(name: &str, remaining: Option<Duration>, now: Instant) -> HudEffect {
        HudEffect {
            id: 0,
            name: name.into(),
            amplifier: 0,
            expires_at: remaining.map(|d| now + d),
            ambient: false,
            show_icon: true,
        }
    }
    #[test]
    fn odd_maximum_and_absorption_keep_both_half_hearts() {
        let now = Instant::now();
        let data = HudSnapshot {
            max_health: 21.,
            health: 21.,
            previous_health: 21.,
            absorption: 1.,
            ..Default::default()
        };
        let layout = heart_layout(&data, now);
        assert_eq!((layout.health, layout.total, layout.rows), (11, 12, 2));
        assert_eq!(layout.spacing, 10.);
        let many = heart_layout(
            &HudSnapshot {
                max_health: 4000.,
                absorption: 4000.,
                ..Default::default()
            },
            now,
        );
        assert_eq!(many.total, 200);
        assert!(many.spacing >= 3.);
    }
    #[test]
    fn health_flash_matches_remaining_tick_phase_and_expires() {
        let now = Instant::now();
        let mut data = HudSnapshot {
            health: 14.,
            previous_health: 20.,
            health_changed_at: Some(now),
            ..Default::default()
        };
        assert!(!health_blink(&data, now)); // 20/3 is even.
        assert!(health_blink(&data, now + Duration::from_millis(150)));
        assert!(!health_blink(&data, now + Duration::from_millis(300)));
        assert!(!health_blink(&data, now + Duration::from_secs(1)));
        data.health = 20.;
        data.previous_health = 14.;
        assert!(health_blink(&data, now)); // Healing uses the ten-tick window.
        assert!(!health_blink(&data, now + Duration::from_millis(500)));
    }
    #[test]
    fn recent_display_health_does_not_collapse_before_flash_finishes() {
        let now = Instant::now();
        let data = HudSnapshot {
            max_health: 20.,
            health: 20.,
            previous_health: 40.,
            health_changed_at: Some(now),
            ..Default::default()
        };
        assert_eq!(heart_layout(&data, now).health, 20);
        assert_eq!(heart_layout(&data, now + Duration::from_secs(1)).health, 10);
    }
    #[test]
    fn visual_jitter_uses_ticks_instead_of_render_frames() {
        assert_eq!(gui_tick(1.001), gui_tick(1.049));
        assert_ne!(gui_tick(1.049), gui_tick(1.051));
        let mut a = HudRandom::new(gui_tick(1.001));
        let mut b = HudRandom::new(gui_tick(1.049));
        for _ in 0..200 {
            assert_eq!(a.below(3), b.below(3));
        }
        let mut seed_zero = HudRandom::new(0);
        assert_eq!(
            (0..5).map(|_| seed_zero.below(2)).collect::<Vec<_>>(),
            [1, 1, 0, 1, 1]
        );
    }
    #[test]
    fn effects_expire_use_two_rows_and_keep_java_order() {
        let now = Instant::now();
        assert!(effect_beneficial("regeneration"));
        assert!(effect_beneficial("breath_of_the_nautilus"));
        assert!(!effect_beneficial("bad_omen")); // Neutral belongs in lower row.
        assert!(!effect_beneficial("poison"));
        let short = effect("speed", Some(Duration::from_secs(2)), now);
        let long = effect("poison", Some(Duration::from_secs(20)), now);
        assert_eq!(effect_order(&long, &short, now), Ordering::Less);
        assert!(!effect_active(&short, now + Duration::from_secs(2)));
        assert!((effect_alpha(&short, now) - 0.6).abs() < 0.001);
        let ambient = HudEffect {
            ambient: true,
            ..short.clone()
        };
        assert_eq!(effect_alpha(&ambient, now), 1.);
        assert_eq!(effect_alpha(&long, now), 1.);
    }
    #[test]
    fn hud_cache_only_ticks_while_visible_animation_needs_it() {
        let now = Instant::now();
        let mut data = HudSnapshot::default();
        assert!(!needs_animation(&data, now));
        data.effects
            .push(effect("speed", Some(Duration::from_secs(30)), now));
        assert!(!needs_animation(&data, now));
        assert!(needs_animation(&data, now + Duration::from_secs(21)));
        assert!(needs_animation(&data, now + Duration::from_millis(30050)));
        assert!(!needs_animation(&data, now + Duration::from_secs(31)));
        data.effects.clear();
        data.health = 4.;
        assert!(needs_animation(&data, now));
        data.game_mode = 1;
        assert!(!needs_animation(&data, now));
    }
    #[test]
    fn chat_and_action_bar_fade_for_a_whole_second() {
        assert_eq!(chat_alpha(9., false), 1.);
        assert!((chat_alpha(9.5, false) - 0.25).abs() < 0.001);
        assert_eq!(chat_alpha(10., false), 0.);
        assert_eq!(chat_alpha(600., true), 1.);
        assert_eq!(fade_out(2.5, 3., 1.), 0.5);
        let data = HudSnapshot::default();
        assert_eq!(title_alpha(&data, 0), 0.);
        assert_eq!(title_alpha(&data, 250), 0.5);
        assert_eq!(title_alpha(&data, 4500), 0.5);
        assert_eq!(title_alpha(&data, 5000), 0.);
    }
    #[test]
    fn creative_and_spectator_do_not_show_survival_status() {
        assert!(has_survival_hud(0));
        assert!(has_survival_hud(2));
        assert!(!has_survival_hud(1));
        assert!(!has_survival_hud(3));
        assert!(has_hotbar(1));
        assert!(!has_hotbar(3));
    }
}
