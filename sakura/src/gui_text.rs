//! Bounded component/layout cache and actual-font drawing shared by menus, HUD,
//! and tooltips. Glyph atlas entries are resolved during drawing, never cached:
//! the Unicode atlas can safely evict a glyph without retaining stale UVs here.
use super::Painter;
use crate::{
    gui_assets::{Glyph, GuiAssets},
    shared::{HotbarSlot, RichText},
};
use serde_json::Value;
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    rc::Rc,
};

const MAX_CHARACTERS: usize = 4096;
const MAX_CACHE: usize = 128;
const BOLD: u8 = 1;
const ITALIC: u8 = 2;
const UNDERLINE: u8 = 4;
const STRIKE: u8 = 8;
const OBFUSCATED: u8 = 16;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Style {
    color: Option<u32>,
    shadow: Option<u32>,
    flags: u8,
}
#[derive(Clone, Copy, Debug)]
struct Character {
    ch: char,
    style: Style,
}
#[derive(Clone, Copy, Debug)]
struct Positioned {
    character: Character,
    x: f32,
    y: f32,
    advance: f32,
}
#[derive(Default)]
struct Layout {
    glyphs: Vec<Positioned>,
    width: f32,
    height: f32,
    lines: Vec<String>,
}
struct Entry {
    source: String,
    fallback: String,
    assets: usize,
    width: u32,
    rich: bool,
    base: Style,
    layout: Rc<Layout>,
}
thread_local! { static CACHE: RefCell<VecDeque<Entry>> = RefCell::new(VecDeque::new()); }

fn text_color(value: &str) -> Option<u32> {
    Some(match value {
        "black" => 0x000000,
        "dark_blue" => 0x0000aa,
        "dark_green" => 0x00aa00,
        "dark_aqua" => 0x00aaaa,
        "dark_red" => 0xaa0000,
        "dark_purple" => 0xaa00aa,
        "gold" => 0xffaa00,
        "gray" => 0xaaaaaa,
        "dark_gray" => 0x555555,
        "blue" => 0x5555ff,
        "green" => 0x55ff55,
        "aqua" => 0x55ffff,
        "red" => 0xff5555,
        "light_purple" => 0xff55ff,
        "yellow" => 0xffff55,
        "white" => 0xffffff,
        _ => u32::from_str_radix(value.strip_prefix('#')?, 16)
            .ok()
            .filter(|c| *c <= 0xffffff)?,
    })
}
fn inherited_style(value: &Value, mut style: Style) -> Style {
    if let Some(nested) = value.get("style") {
        style = inherited_style(nested, style);
    }
    if let Some(color) = value.get("color").and_then(Value::as_str) {
        style.color = text_color(color);
    }
    if let Some(color) = value.get("shadow_color") {
        style.shadow = color
            .as_i64()
            .map(|v| v as u32)
            .or_else(|| color.as_u64().map(|v| v as u32));
    }
    for (key, bit) in [
        ("bold", BOLD),
        ("italic", ITALIC),
        ("underlined", UNDERLINE),
        ("strikethrough", STRIKE),
        ("obfuscated", OBFUSCATED),
    ] {
        if let Some(enabled) = value.get(key).and_then(Value::as_bool) {
            if enabled {
                style.flags |= bit;
            } else {
                style.flags &= !bit;
            }
        }
    }
    style
}
fn append(value: &str, original: Style, out: &mut Vec<Character>) {
    let mut style = original;
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if out.len() >= MAX_CHARACTERS {
            break;
        }
        if ch == '\u{00a7}' {
            let Some(code) = chars.next().map(|c| c.to_ascii_lowercase()) else {
                break;
            };
            const COLORS: [u32; 16] = [
                0, 0xaa, 0xaa00, 0xaaaa, 0xaa0000, 0xaa00aa, 0xffaa00, 0xaaaaaa, 0x555555,
                0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
            ];
            if let Some(index) = code.to_digit(16) {
                style.color = Some(COLORS[index as usize]);
                style.flags = 0;
            } else {
                match code {
                    'k' => style.flags |= OBFUSCATED,
                    'l' => style.flags |= BOLD,
                    'm' => style.flags |= STRIKE,
                    'n' => style.flags |= UNDERLINE,
                    'o' => style.flags |= ITALIC,
                    'r' => style = original,
                    _ => {}
                }
            }
        } else if ch == '\n' || !ch.is_control() {
            out.push(Character { ch, style });
        }
    }
}
fn component(
    value: &Value,
    parent: Style,
    language: &HashMap<String, String>,
    out: &mut Vec<Character>,
    depth: u8,
) {
    if depth > 24 || out.len() >= MAX_CHARACTERS {
        return;
    }
    match value {
        Value::String(text) => append(text, parent, out),
        Value::Number(_) | Value::Bool(_) => append(&value.to_string(), parent, out),
        Value::Array(children) => {
            let style = children
                .first()
                .map_or(parent, |first| inherited_style(first, parent));
            for child in children.iter().take(256) {
                component(child, style, language, out, depth + 1);
            }
        }
        Value::Object(_) => {
            let style = inherited_style(value, parent);
            if let Some(text) = value.get("text").and_then(Value::as_str) {
                append(text, style, out);
            } else if let Some(key) = value.get("translate").and_then(Value::as_str) {
                let format = language
                    .get(key)
                    .map(String::as_str)
                    .or_else(|| value.get("fallback").and_then(Value::as_str))
                    .unwrap_or(key);
                let arguments = value
                    .get("with")
                    .and_then(Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                translate(format, arguments, style, language, out, depth + 1);
            } else if let Some(key) = value.get("keybind").and_then(Value::as_str) {
                append(
                    language.get(key).map(String::as_str).unwrap_or(key),
                    style,
                    out,
                );
            } else if let Some(score) = value
                .get("score")
                .and_then(|v| v.get("value"))
                .and_then(Value::as_str)
            {
                append(score, style, out);
            }
            if let Some(children) = value.get("extra").and_then(Value::as_array) {
                for child in children.iter().take(256) {
                    component(child, style, language, out, depth + 1);
                }
            }
        }
        _ => {}
    }
}
fn translate(
    format: &str,
    arguments: &[Value],
    style: Style,
    language: &HashMap<String, String>,
    out: &mut Vec<Character>,
    depth: u8,
) {
    let mut start = 0;
    let mut sequential = 0;
    let bytes = format.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            index += 1;
            continue;
        }
        append(&format[start..index], style, out);
        let percent = index;
        index += 1;
        if bytes.get(index) == Some(&b'%') {
            append("%", style, out);
            index += 1;
            start = index;
            continue;
        }
        let number_start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        let argument = if index > number_start && bytes.get(index) == Some(&b'$') {
            let id = format[number_start..index]
                .parse::<usize>()
                .ok()
                .and_then(|v| v.checked_sub(1));
            index += 1;
            id
        } else if index == number_start {
            let id = sequential;
            sequential += 1;
            Some(id)
        } else {
            None
        };
        if bytes.get(index) == Some(&b's') {
            index += 1;
            if let Some(arg) = argument.and_then(|i| arguments.get(i)) {
                component(arg, style, language, out, depth + 1);
            } else {
                append(&format[percent..index], style, out);
            }
        } else {
            append("%", style, out);
            index = percent + 1;
        }
        start = index;
    }
    append(&format[start..], style, out);
}
#[cfg(test)]
fn parse(
    source: &str,
    fallback: &str,
    rich: bool,
    language: &HashMap<String, String>,
) -> Vec<Character> {
    parse_styled(source, fallback, rich, language, Style::default())
}
fn parse_styled(
    source: &str,
    fallback: &str,
    rich: bool,
    language: &HashMap<String, String>,
    base: Style,
) -> Vec<Character> {
    let mut chars = Vec::new();
    if rich && source.len() <= 32768 {
        if let Ok(value) = serde_json::from_str::<Value>(source) {
            component(&value, base, language, &mut chars, 0);
        }
    }
    if chars.is_empty() {
        append(if rich { fallback } else { source }, base, &mut chars);
    }
    chars
}

fn arrange(chars: &[Character], width: f32, mut measure: impl FnMut(char, bool) -> f32) -> Layout {
    let width = if width.is_finite() {
        width.max(1.)
    } else {
        f32::INFINITY
    };
    let advances: Vec<_> = chars
        .iter()
        .map(|c| measure(c.ch, c.style.flags & BOLD != 0))
        .collect();
    let mut ranges = Vec::new();
    let mut start = 0;
    let mut index = 0;
    let mut used = 0.;
    let mut space = None;
    while index < chars.len() {
        if chars[index].ch == '\n' {
            ranges.push(start..index);
            index += 1;
            start = index;
            used = 0.;
            space = None;
            continue;
        }
        if used + advances[index] > width && index > start {
            let end = space.filter(|last| *last >= start).unwrap_or(index);
            ranges.push(start..end);
            start = if end == index { index } else { end + 1 };
            while start < chars.len() && chars[start].ch == ' ' {
                start += 1;
            }
            index = start;
            used = 0.;
            space = None;
            continue;
        }
        used += advances[index];
        if chars[index].ch == ' ' {
            space = Some(index);
        }
        index += 1;
    }
    if start < chars.len() || chars.last().is_some_and(|c| c.ch == '\n') {
        ranges.push(start..chars.len());
    }
    let mut layout = Layout::default();
    for (line, range) in ranges.iter().enumerate() {
        let mut x = 0.;
        let mut text = String::new();
        for index in range.clone() {
            layout.glyphs.push(Positioned {
                character: chars[index],
                x,
                y: line as f32 * 9.,
                advance: advances[index],
            });
            text.push(chars[index].ch);
            x += advances[index];
        }
        layout.width = layout.width.max(x);
        layout.lines.push(text);
    }
    layout.height = ranges.len() as f32 * 9.;
    layout
}
fn cached(assets: &GuiAssets, source: &str, fallback: &str, rich: bool, width: f32) -> Rc<Layout> {
    cached_styled(assets, source, fallback, rich, width, Style::default())
}
fn cached_styled(
    assets: &GuiAssets,
    source: &str,
    fallback: &str,
    rich: bool,
    width: f32,
    base: Style,
) -> Rc<Layout> {
    let asset_key = assets as *const GuiAssets as usize;
    CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if let Some(index) = cache.iter().position(|e| {
            e.assets == asset_key
                && e.source == source
                && e.fallback == fallback
                && e.rich == rich
                && e.base == base
                && e.width == width.to_bits()
        }) {
            let entry = cache.remove(index).unwrap();
            let layout = entry.layout.clone();
            cache.push_back(entry);
            return layout;
        }
        let chars = parse_styled(source, fallback, rich, &assets.language, base);
        let layout = Rc::new(arrange(&chars, width, |ch, bold| {
            let g = assets.glyph(ch);
            g.advance + if bold { g.bold_offset } else { 0. }
        }));
        if cache.len() >= MAX_CACHE {
            cache.pop_front();
        }
        cache.push_back(Entry {
            source: source.chars().take(32768).collect(),
            fallback: fallback.chars().take(MAX_CHARACTERS).collect(),
            assets: asset_key,
            width: width.to_bits(),
            rich,
            base,
            layout: layout.clone(),
        });
        layout
    })
}

fn rgba(rgb: u32, alpha: f32) -> [f32; 4] {
    [
        ((rgb >> 16) & 255) as f32 / 255.,
        ((rgb >> 8) & 255) as f32 / 255.,
        (rgb & 255) as f32 / 255.,
        alpha,
    ]
}
#[derive(Clone, Copy, Default, Debug)]
struct Vertex {
    p: [f32; 2],
    uv: [f32; 2],
}
fn clip_quad(points: [Vertex; 4], clip: [f32; 4]) -> ([Vertex; 12], usize) {
    let mut polygon = [Vertex::default(); 12];
    polygon[..4].copy_from_slice(&points);
    let mut count = 4;
    for (axis, boundary, greater) in [
        (0, clip[0], true),
        (0, clip[0] + clip[2], false),
        (1, clip[1], true),
        (1, clip[1] + clip[3], false),
    ] {
        if count == 0 {
            break;
        }
        let mut output = [Vertex::default(); 12];
        let mut total = 0;
        for index in 0..count {
            let a = polygon[index];
            let b = polygon[(index + 1) % count];
            let inside = |v: Vertex| {
                if greater {
                    v.p[axis] >= boundary
                } else {
                    v.p[axis] <= boundary
                }
            };
            let ia = inside(a);
            let ib = inside(b);
            if ia {
                output[total] = a;
                total += 1;
            }
            if ia != ib {
                let ratio = (boundary - a.p[axis]) / (b.p[axis] - a.p[axis]);
                output[total] = Vertex {
                    p: [
                        a.p[0] + ratio * (b.p[0] - a.p[0]),
                        a.p[1] + ratio * (b.p[1] - a.p[1]),
                    ],
                    uv: [
                        a.uv[0] + ratio * (b.uv[0] - a.uv[0]),
                        a.uv[1] + ratio * (b.uv[1] - a.uv[1]),
                    ],
                };
                total += 1;
            }
        }
        polygon = output;
        count = total;
    }
    (polygon, count)
}

impl Painter<'_> {
    pub fn text_width(&self, text: &str) -> f32 {
        cached(&self.assets.gui, text, "", false, f32::INFINITY).width
    }
    pub fn rich_text_width(&self, text: &RichText) -> f32 {
        cached(
            &self.assets.gui,
            &text.json,
            &text.plain,
            true,
            f32::INFINITY,
        )
        .width
    }
    pub fn rich_text_height(&self, text: &RichText, width: f32) -> f32 {
        cached(&self.assets.gui, &text.json, &text.plain, true, width).height
    }
    pub fn text(&mut self, text: &str, x: f32, y: f32, color: [f32; 4], shadow: bool) {
        let layout = cached(&self.assets.gui, text, "", false, f32::INFINITY);
        self.draw_layout(
            &layout,
            x,
            y,
            color,
            shadow,
            [0., 0., self.metrics.width, self.metrics.height],
        );
    }
    pub fn rich_text(&mut self, text: &RichText, x: f32, y: f32, color: [f32; 4], shadow: bool) {
        let layout = cached(
            &self.assets.gui,
            &text.json,
            &text.plain,
            true,
            f32::INFINITY,
        );
        self.draw_layout(
            &layout,
            x,
            y,
            color,
            shadow,
            [0., 0., self.metrics.width, self.metrics.height],
        );
    }
    pub fn rich_text_clipped(
        &mut self,
        text: &RichText,
        rect: [f32; 4],
        color: [f32; 4],
        shadow: bool,
    ) -> f32 {
        let layout = cached(&self.assets.gui, &text.json, &text.plain, true, rect[2]);
        self.draw_layout(&layout, rect[0], rect[1], color, shadow, rect);
        layout.height
    }
    pub fn rich_text_in_rect(
        &mut self,
        text: &RichText,
        origin: [f32; 2],
        wrap_width: f32,
        clip: [f32; 4],
        color: [f32; 4],
        shadow: bool,
    ) -> f32 {
        let layout = cached(&self.assets.gui, &text.json, &text.plain, true, wrap_width);
        self.draw_layout(&layout, origin[0], origin[1], color, shadow, clip);
        layout.height
    }
    pub fn scaled_rich_text(
        &mut self,
        text: &RichText,
        center: f32,
        y: f32,
        scale: f32,
        color: [f32; 4],
    ) {
        let layout = cached(
            &self.assets.gui,
            &text.json,
            &text.plain,
            true,
            f32::INFINITY,
        );
        self.draw_scaled_layout(&layout, center, y, scale, color);
    }
    pub fn scaled_text(&mut self, text: &str, center: f32, y: f32, scale: f32, color: [f32; 4]) {
        let layout = cached(&self.assets.gui, text, "", false, f32::INFINITY);
        self.draw_scaled_layout(&layout, center, y, scale, color);
    }
    fn draw_scaled_layout(
        &mut self,
        layout: &Layout,
        center: f32,
        y: f32,
        scale: f32,
        color: [f32; 4],
    ) {
        if !scale.is_finite() || scale <= 0. {
            return;
        }
        let start = self.vertices.len();
        self.draw_layout(
            layout,
            -layout.width / 2.,
            0.,
            color,
            true,
            [
                -center / scale,
                -y / scale,
                self.metrics.width / scale,
                self.metrics.height / scale,
            ],
        );
        let gui_scale = self.metrics.scale;
        for vertex in &mut self.vertices[start..] {
            vertex.position = [
                vertex.position[0] * scale + center * gui_scale,
                vertex.position[1] * scale + y * gui_scale,
            ];
        }
    }
    fn draw_layout(
        &mut self,
        layout: &Layout,
        x: f32,
        y: f32,
        color: [f32; 4],
        shadow: bool,
        clip: [f32; 4],
    ) {
        for pass in [true, false] {
            for positioned in &layout.glyphs {
                if y + positioned.y + 12. < clip[1] || y + positioned.y > clip[1] + clip[3] {
                    continue;
                }
                let style = positioned.character.style;
                let mut ch = positioned.character.ch;
                let original = self.assets.gui.glyph(ch);
                if style.flags & OBFUSCATED != 0 && !ch.is_whitespace() {
                    let salt =
                        (self.time * 20.) as u32 + positioned.x as u32 * 31 + positioned.y as u32;
                    for n in 0..62 {
                        let candidate =
                            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
                                [((salt + n) % 62) as usize] as char;
                        if (self.assets.gui.glyph(candidate).advance - original.advance).abs()
                            < 0.01
                        {
                            ch = candidate;
                            break;
                        }
                    }
                }
                let glyph = self.assets.gui.glyph(ch);
                let mut tint = style.color.map_or(color, |rgb| rgba(rgb, color[3]));
                let offset = if pass {
                    if let Some(argb) = style.shadow {
                        tint = rgba(argb, ((argb >> 24) & 255) as f32 / 255. * color[3]);
                    } else if shadow {
                        tint = [tint[0] * 0.25, tint[1] * 0.25, tint[2] * 0.25, tint[3]];
                    } else {
                        continue;
                    }
                    glyph.shadow_offset
                } else {
                    0.
                };
                if tint[3] <= 0. {
                    continue;
                }
                self.glyph_quad(
                    &glyph,
                    x + positioned.x + offset,
                    y + positioned.y + offset,
                    style.flags & ITALIC != 0,
                    tint,
                    clip,
                );
                if style.flags & BOLD != 0 {
                    self.glyph_quad(
                        &glyph,
                        x + positioned.x + offset + glyph.bold_offset,
                        y + positioned.y + offset,
                        style.flags & ITALIC != 0,
                        tint,
                        clip,
                    );
                }
                for (flag, line_y) in [(STRIKE, 3.5), (UNDERLINE, 8.)] {
                    if style.flags & flag != 0 {
                        self.clipped_solid(
                            [
                                x + positioned.x + offset
                                    - if positioned.x == 0. { 1. } else { 0. },
                                y + positioned.y + offset + line_y,
                                positioned.advance + if positioned.x == 0. { 1. } else { 0. },
                                1.,
                            ],
                            tint,
                            clip,
                        );
                    }
                }
            }
        }
    }
    fn clipped_solid(&mut self, rect: [f32; 4], color: [f32; 4], clip: [f32; 4]) {
        let x = rect[0].max(clip[0]);
        let y = rect[1].max(clip[1]);
        self.solid(
            [
                x,
                y,
                (rect[0] + rect[2]).min(clip[0] + clip[2]) - x,
                (rect[1] + rect[3]).min(clip[1] + clip[3]) - y,
            ],
            color,
        );
    }
    fn glyph_quad(
        &mut self,
        glyph: &Glyph,
        x: f32,
        y: f32,
        italic: bool,
        color: [f32; 4],
        clip: [f32; 4],
    ) {
        if glyph.width <= 0. || glyph.height <= 0. {
            return;
        }
        let top = if italic {
            1. - glyph.bearing_y * 0.25
        } else {
            0.
        };
        let bottom = if italic {
            1. - (glyph.bearing_y + glyph.height) * 0.25
        } else {
            0.
        };
        let x = x + glyph.bearing_x;
        let y = y + glyph.bearing_y;
        let u = glyph.sprite.x as f32 / self.assets.gui.width as f32;
        let v = glyph.sprite.y as f32 / self.assets.gui.height as f32;
        let u1 = (glyph.sprite.x + glyph.sprite.width) as f32 / self.assets.gui.width as f32;
        let v1 = (glyph.sprite.y + glyph.sprite.height) as f32 / self.assets.gui.height as f32;
        let points = [
            Vertex {
                p: [x + top, y],
                uv: [u, v],
            },
            Vertex {
                p: [x + glyph.width + top, y],
                uv: [u1, v],
            },
            Vertex {
                p: [x + glyph.width + bottom, y + glyph.height],
                uv: [u1, v1],
            },
            Vertex {
                p: [x + bottom, y + glyph.height],
                uv: [u, v1],
            },
        ];
        let (polygon, count) = clip_quad(points, clip);
        for i in 1..count.saturating_sub(1) {
            for vertex in [polygon[0], polygon[i], polygon[i + 1]] {
                self.vertices.push(super::super::HudVertex {
                    position: vertex.p.map(|p| p * self.metrics.scale),
                    uv: vertex.uv,
                    layer: 0,
                    color,
                });
            }
        }
    }

    pub fn item_name(&self, stack: &HotbarSlot) -> String {
        if let Some(name) = &stack.custom_name {
            let layout = cached(
                &self.assets.gui,
                &name.json,
                &name.plain,
                true,
                f32::INFINITY,
            );
            return layout.lines.join("\n");
        }
        let mut key = String::new();
        for (index, ch) in stack
            .name
            .trim_start_matches("minecraft:")
            .chars()
            .enumerate()
        {
            if ch.is_ascii_uppercase() && index > 0 {
                key.push('_');
            }
            key.push(ch.to_ascii_lowercase());
        }
        for prefix in ["item.minecraft.", "block.minecraft."] {
            if let Some(value) = self.assets.gui.language.get(&format!("{prefix}{key}")) {
                return value.clone();
            }
        }
        stack.name.clone()
    }
    pub fn centered_item_name(
        &mut self,
        stack: &HotbarSlot,
        center: f32,
        y: f32,
        color: [f32; 4],
        shadow: bool,
    ) {
        let rarity = [0xffffff, 0xffff55, 0x55ffff, 0xff55ff][stack.rarity.min(3) as usize];
        let base = Style {
            color: Some(rarity),
            flags: if stack.custom_name.is_some() {
                ITALIC
            } else {
                0
            },
            shadow: None,
        };
        let layout = if let Some(name) = &stack.custom_name {
            cached_styled(
                &self.assets.gui,
                &name.json,
                &name.plain,
                true,
                f32::INFINITY,
                base,
            )
        } else {
            cached_styled(
                &self.assets.gui,
                &self.item_name(stack),
                "",
                false,
                f32::INFINITY,
                base,
            )
        };
        self.draw_layout(
            &layout,
            center - layout.width / 2.,
            y,
            color,
            shadow,
            [0., 0., self.metrics.width, self.metrics.height],
        );
    }
    pub fn tooltip(&mut self, stack: &HotbarSlot, pointer: [f32; 2]) {
        if stack.count == 0 || stack.hide_tooltip {
            return;
        }
        let name = stack.custom_name.clone().unwrap_or_else(|| RichText {
            plain: self.item_name(stack),
            json: String::new(),
        });
        let maximum = (self.metrics.width - 24.).max(1.);
        let legacy_lore = stack.tooltip_lines.is_empty();
        let details = if legacy_lore {
            &stack.lore
        } else {
            &stack.tooltip_lines
        };
        let preferred = self.rich_text_width(&name).max(
            details
                .iter()
                .take(50)
                .map(|l| self.rich_text_width(l))
                .fold(0., f32::max),
        );
        let mut width = preferred.min(maximum);
        if pointer[0] + 12. + width + 4. > self.metrics.width && pointer[0] - 16. - width < 4. {
            width = (self.metrics.width - pointer[0] - 16.)
                .max(pointer[0] - 20.)
                .max(1.)
                .min(maximum);
        }
        let mut layouts = Vec::with_capacity(details.len().min(50) + 1);
        let rarity = [0xffffff, 0xffff55, 0x55ffff, 0xff55ff][stack.rarity.min(3) as usize];
        layouts.push((
            cached_styled(
                &self.assets.gui,
                &name.json,
                &name.plain,
                true,
                width,
                Style {
                    color: Some(rarity),
                    flags: if stack.custom_name.is_some() {
                        ITALIC
                    } else {
                        0
                    },
                    shadow: None,
                },
            ),
            [1.; 4],
        ));
        for lore in details.iter().take(50) {
            layouts.push((
                cached_styled(
                    &self.assets.gui,
                    &lore.json,
                    &lore.plain,
                    true,
                    width,
                    if legacy_lore {
                        Style {
                            color: Some(0xaa00aa),
                            flags: ITALIC,
                            shadow: None,
                        }
                    } else {
                        Style::default()
                    },
                ),
                [1.; 4],
            ));
        }
        width = layouts
            .iter()
            .map(|(layout, _)| layout.width)
            .fold(0., f32::max)
            .min(width);
        let content_height = layouts.iter().map(|(layout, _)| layout.height).sum::<f32>()
            + if layouts.len() > 1 { 2. } else { 0. };
        let height = content_height.min((self.metrics.height - 24.).max(1.));
        let mut x = pointer[0].floor() + 12.;
        let mut y = pointer[1].floor() - 12.;
        if x + width + 4. > self.metrics.width {
            x = pointer[0].floor() - 16. - width;
        }
        x = x.clamp(4., (self.metrics.width - width - 4.).max(4.));
        y = y.clamp(4., (self.metrics.height - height - 6.).max(4.));
        self.sprite(
            "gui/sprites/tooltip/background",
            [x - 12., y - 12., width + 24., height + 24.],
        );
        self.sprite(
            "gui/sprites/tooltip/frame",
            [x - 12., y - 12., width + 24., height + 24.],
        );
        let clip = [x, y, width + 1., height];
        let mut top = y;
        for (i, (layout, color)) in layouts.iter().enumerate() {
            self.draw_layout(layout, x, top, *color, true, clip);
            top += layout.height + if i == 0 { 2. } else { 0. };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn component_inheritance_explicit_reset_and_translation_preserve_styles() {
        let language = HashMap::from([("chat.type.text".into(), "<%1$s> %2$s %%".into())]);
        let value = serde_json::json!({"translate":"chat.type.text","color":"red","bold":true,
            "with":[{"text":"Name","color":"gold"},{"text":"Hello","bold":false}],
            "extra":[{"text":"!","underlined":true}]});
        let mut chars = Vec::new();
        component(&value, Style::default(), &language, &mut chars, 0);
        assert_eq!(
            chars.iter().map(|c| c.ch).collect::<String>(),
            "<Name> Hello %!"
        );
        let name = chars.iter().find(|c| c.ch == 'N').unwrap();
        assert_eq!(name.style.color, Some(0xffaa00));
        assert_ne!(name.style.flags & BOLD, 0);
        let hello = chars.iter().find(|c| c.ch == 'H').unwrap();
        assert_eq!(hello.style.flags & BOLD, 0);
        assert_eq!(hello.style.color, Some(0xff5555));
        assert_ne!(chars.last().unwrap().style.flags & UNDERLINE, 0);
    }
    #[test]
    fn wrapping_preserves_word_boundaries_newlines_and_bold_advances() {
        let chars = parse("one two\nwide", "", false, &HashMap::new());
        let layout = arrange(&chars, 20., |_, _| 5.);
        assert_eq!(layout.lines, ["one", "two", "wide"]);
        assert_eq!(layout.height, 27.);
        let chars = parse("§lAB§rC", "", false, &HashMap::new());
        let layout = arrange(&chars, 12., |_, bold| if bold { 6. } else { 5. });
        assert_eq!(layout.lines, ["AB", "C"]);
        assert_eq!(layout.width, 12.);
    }
    #[test]
    fn long_words_and_missing_translation_remain_bounded() {
        let chars = parse(&"x".repeat(10_000), "", false, &HashMap::new());
        assert_eq!(chars.len(), MAX_CHARACTERS);
        let layout = arrange(&chars[..4], 1., |_, _| 8.);
        assert_eq!(layout.lines, ["x", "x", "x", "x"]);
        let mut chars = Vec::new();
        component(
            &serde_json::json!({"translate":"unknown","fallback":"%s / %2$s","with":["a","b"]}),
            Style::default(),
            &HashMap::new(),
            &mut chars,
            0,
        );
        assert_eq!(chars.iter().map(|c| c.ch).collect::<String>(), "a / b");
    }
    #[test]
    fn clipping_interpolates_texture_coordinates_and_keeps_italic_quad_inside() {
        let vertices = [
            Vertex {
                p: [-2., -1.],
                uv: [0., 0.],
            },
            Vertex {
                p: [8., -1.],
                uv: [1., 0.],
            },
            Vertex {
                p: [6., 9.],
                uv: [1., 1.],
            },
            Vertex {
                p: [-4., 9.],
                uv: [0., 1.],
            },
        ];
        let (clipped, count) = clip_quad(vertices, [0., 0., 5., 5.]);
        assert!(count >= 4);
        for v in &clipped[..count] {
            assert!(v.p[0] >= 0. && v.p[0] <= 5. && v.p[1] >= 0. && v.p[1] <= 5.);
            assert!(v.uv.iter().all(|u| *u >= 0. && *u <= 1.));
        }
    }
    #[test]
    fn tooltip_defaults_preserve_explicit_nonitalic_and_color_overrides() {
        let base = Style {
            color: Some(0xffff55),
            flags: ITALIC,
            shadow: None,
        };
        let chars = parse_styled(
            r#"{"text":"Custom","italic":false,"extra":[{"text":"!","color":"red"}]}"#,
            "",
            true,
            &HashMap::new(),
            base,
        );
        assert_eq!(chars[0].style.color, Some(0xffff55));
        assert_eq!(chars[0].style.flags & ITALIC, 0);
        assert_eq!(chars.last().unwrap().style.color, Some(0xff5555));
    }
    fn assets() -> crate::assets::AssetPack {
        let mut gui = GuiAssets::empty();
        gui.width = 32;
        gui.height = 32;
        for ch in ' '..='~' {
            gui.glyphs.insert(
                ch,
                Glyph {
                    sprite: crate::gui_assets::GuiSprite {
                        x: 1,
                        y: 1,
                        width: 5,
                        height: 8,
                        scaling: crate::gui_assets::SpriteScaling::Stretch,
                    },
                    width: if ch == ' ' { 0. } else { 5. },
                    height: 8.,
                    bearing_x: 0.,
                    bearing_y: 0.,
                    advance: 6.,
                    shadow_offset: 0.5,
                    bold_offset: 0.5,
                },
            );
        }
        crate::assets::AssetPack {
            weather_rgba: vec![255;64*256*4*2],
            biome_colormaps: Vec::new(),
            gui: std::sync::Arc::new(gui),
            textures_rgba: Vec::new(),
            texture_size: 16,
            texture_layers: 0,
            models: Vec::new(),
            font_layers: [0; 128],
            font_widths: [0.; 128],
            default_skin_rgba: Vec::new(),
            default_skin_size: [0; 2],
            item_textures: HashMap::new(),
            entity_textures_rgba: Vec::new(),
            entity_texture_size: 64,
            entity_texture_layers: 0,
            entity_textures: HashMap::new(),
            cache_hit: false,
            load_ms: 0,
            unsupported_block_models: 0,
        }
    }
    #[test]
    fn scaled_title_keeps_both_halves_and_rich_glyphs_stay_in_clip() {
        let assets = assets();
        let mut vertices = Vec::new();
        let metrics = super::super::GuiMetrics::new(winit::dpi::PhysicalSize::new(640, 480), 2);
        let mut painter = Painter {
            vertices: &mut vertices,
            assets: &assets,
            metrics,
            time: 0.,
        };
        let text = RichText {
            plain: "AB".into(),
            json: r#"{"text":"AB","italic":true,"bold":true,"underlined":true}"#.into(),
        };
        painter.scaled_rich_text(&text, 160., 20., 4., [1.; 4]);
        assert!(painter.vertices.iter().any(|v| v.position[0] < 320.));
        assert!(painter.vertices.iter().any(|v| v.position[0] > 320.));
        painter.vertices.clear();
        painter.rich_text_clipped(&text, [10., 10., 7., 12.], [1.; 4], true);
        assert!(!painter.vertices.is_empty());
        for vertex in painter.vertices.iter() {
            assert!((20.0..=34.0).contains(&vertex.position[0]));
            assert!((20.0..=44.0).contains(&vertex.position[1]));
        }
    }
    #[test]
    fn layout_cache_is_bounded_and_never_stores_glyph_atlas_addresses() {
        let assets = assets();
        for index in 0..MAX_CACHE + 20 {
            cached(&assets.gui, &format!("unique{index}"), "", false, 80.);
        }
        CACHE.with(|cache| assert_eq!(cache.borrow().len(), MAX_CACHE));
        let one = cached(&assets.gui, "same", "", false, 80.);
        let two = cached(&assets.gui, "same", "", false, 80.);
        assert!(Rc::ptr_eq(&one, &two));
        assert!(one.glyphs.iter().all(|g| g.character.ch.is_ascii()));
    }
}
