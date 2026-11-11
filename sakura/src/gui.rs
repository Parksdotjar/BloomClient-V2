//! Minecraft logical-pixel UI primitives. Drawing and hit testing share this scale.
use super::{HudVertex, SOLID};
use crate::{
    assets::AssetPack,
    gui_assets::{GuiSprite, SpriteScaling},
    shared::HotbarSlot,
};
use winit::dpi::PhysicalSize;
#[path = "gui_text.rs"]
mod text;

#[derive(Clone, Copy, Debug)]
pub(super) struct GuiMetrics {
    pub scale: f32,
    pub width: f32,
    pub height: f32,
}
impl GuiMetrics {
    pub fn new(size: PhysicalSize<u32>, requested: u8) -> Self {
        let mut scale = 1;
        while (requested == 0 || scale < u32::from(requested))
            && size.width / (scale + 1) >= 320
            && size.height / (scale + 1) >= 240
        {
            scale += 1;
        }
        Self {
            scale: scale as f32,
            width: (size.width as f32 / scale as f32).ceil(),
            height: (size.height as f32 / scale as f32).ceil(),
        }
    }
    pub fn pointer(self, point: [f32; 2]) -> [f32; 2] {
        point.map(|p| p / self.scale)
    }
}
pub(super) struct Painter<'a> {
    pub vertices: &'a mut Vec<HudVertex>,
    pub assets: &'a AssetPack,
    pub metrics: GuiMetrics,
    pub time: f32,
}
impl Painter<'_> {
    fn quad(&mut self, rect: [f32; 4], uv: [f32; 4], layer: u32, color: [f32; 4]) {
        let [x, y, w, h] = rect;
        if w <= 0.0 || h <= 0.0 {
            return;
        }
        let p = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
        let [u, v, du, dv] = uv;
        let uv = [[u, v], [u + du, v], [u + du, v + dv], [u, v + dv]];
        for i in [0, 1, 2, 0, 2, 3] {
            self.vertices.push(HudVertex {
                position: p[i].map(|p| p * self.metrics.scale),
                uv: uv[i],
                layer,
                color,
            });
        }
    }
    pub fn solid(&mut self, rect: [f32; 4], color: [f32; 4]) {
        self.quad(rect, [0.; 4], SOLID, color);
    }
    fn region(
        &mut self,
        s: &GuiSprite,
        rect: [f32; 4],
        source: [f32; 4],
        color: [f32; 4],
        flags: u32,
    ) {
        let aw = self.assets.gui.width as f32;
        let ah = self.assets.gui.height as f32;
        self.quad(
            rect,
            [
                (s.x as f32 + source[0]) / aw,
                (s.y as f32 + source[1]) / ah,
                source[2] / aw,
                source[3] / ah,
            ],
            flags,
            color,
        );
    }
    pub fn sprite_crop(&mut self, name: &str, rect: [f32; 4], source: [f32; 4]) {
        if let Some(s) = self.assets.gui.sprites.get(name).cloned() {
            self.region(&s, rect, source, [1.; 4], 0);
        }
    }
    pub fn sprite_tint(&mut self, name: &str, rect: [f32; 4], color: [f32; 4]) {
        if let Some(s) = self.assets.gui.sprite_at(name, (self.time * 20.) as u64) {
            self.scaled(&s, rect, color);
        }
    }
    pub fn sprite(&mut self, name: &str, rect: [f32; 4]) {
        self.sprite_tint(name, rect, [1.; 4]);
    }
    fn tiled(
        &mut self,
        s: &GuiSprite,
        rect: [f32; 4],
        source: [f32; 4],
        tile: [f32; 2],
        color: [f32; 4],
    ) {
        if tile[0] <= 0. || tile[1] <= 0. {
            return;
        }
        // Bound work even if a malformed size reaches the renderer.
        let columns = (rect[2] / tile[0]).ceil().min(1024.) as usize;
        let rows = (rect[3] / tile[1]).ceil().min(1024.) as usize;
        for y in 0..rows {
            for x in 0..columns {
                if y * columns + x >= 16384 {
                    return;
                }
                let w = tile[0].min(rect[2] - x as f32 * tile[0]);
                let h = tile[1].min(rect[3] - y as f32 * tile[1]);
                self.region(
                    s,
                    [
                        rect[0] + x as f32 * tile[0],
                        rect[1] + y as f32 * tile[1],
                        w,
                        h,
                    ],
                    [
                        source[0],
                        source[1],
                        source[2] * w / tile[0],
                        source[3] * h / tile[1],
                    ],
                    color,
                    0,
                );
            }
        }
    }
    fn scaled(&mut self, s: &GuiSprite, rect: [f32; 4], color: [f32; 4]) {
        match s.scaling {
            SpriteScaling::Stretch => {
                self.region(s, rect, [0., 0., s.width as f32, s.height as f32], color, 0)
            }
            SpriteScaling::Tile { width, height } => self.tiled(
                s,
                rect,
                [0., 0., s.width as f32, s.height as f32],
                [width as f32, height as f32],
                color,
            ),
            SpriteScaling::NineSlice {
                width,
                height,
                left,
                right,
                top,
                bottom,
                stretch_inner,
            } => {
                let sw = width.max(1) as f32;
                let sh = height.max(1) as f32;
                let dx = [
                    0.,
                    (left as f32).min(rect[2] / 2.),
                    (rect[2] - (right as f32).min(rect[2] / 2.)).max(0.),
                    rect[2],
                ];
                let dy = [
                    0.,
                    (top as f32).min(rect[3] / 2.),
                    (rect[3] - (bottom as f32).min(rect[3] / 2.)).max(0.),
                    rect[3],
                ];
                let sx = [0., left as f32, sw - right as f32, sw];
                let sy = [0., top as f32, sh - bottom as f32, sh];
                for y in 0..3 {
                    for x in 0..3 {
                        let r = [
                            rect[0] + dx[x],
                            rect[1] + dy[y],
                            dx[x + 1] - dx[x],
                            dy[y + 1] - dy[y],
                        ];
                        let src = [
                            sx[x] / sw * s.width as f32,
                            sy[y] / sh * s.height as f32,
                            (sx[x + 1] - sx[x]) / sw * s.width as f32,
                            (sy[y + 1] - sy[y]) / sh * s.height as f32,
                        ];
                        if stretch_inner || (x != 1 && y != 1) {
                            self.region(s, r, src, color, 0);
                        } else {
                            self.tiled(
                                s,
                                r,
                                src,
                                [
                                    if x == 1 { sx[x + 1] - sx[x] } else { r[2] },
                                    if y == 1 { sy[y + 1] - sy[y] } else { r[3] },
                                ],
                                color,
                            );
                        }
                    }
                }
            }
        }
    }
    pub fn centered_text(&mut self, text: &str, x: f32, y: f32, color: [f32; 4], shadow: bool) {
        self.text(text, x - self.text_width(text) / 2., y, color, shadow);
    }
    pub fn label(&self, key: &str) -> String {
        self.assets
            .gui
            .language
            .get(key)
            .cloned()
            .unwrap_or_else(|| key.into())
    }
    pub fn translated(&self, key: &str) -> String {
        self.label(key)
    }
    pub fn item(&mut self, stack: &HotbarSlot, x: f32, y: f32, decorations: bool) {
        self.item_count(stack, stack.count, x, y, decorations);
    }
    pub fn item_count(
        &mut self,
        stack: &HotbarSlot,
        count: u16,
        x: f32,
        y: f32,
        decorations: bool,
    ) {
        if count == 0 {
            return;
        }
        let assets = self.assets;
        let item_id = stack.item_model.as_deref()
            .and_then(|name| assets.gui.item_models.get(name))
            .copied().unwrap_or(stack.item_id);
        if let Some(layers) = assets.gui.item_layers.get(&item_id) {
            for layer in layers {
                let color = match layer.tint {
                    crate::gui_assets::ItemTintSource::Fixed => layer.default_color,
                    crate::gui_assets::ItemTintSource::Dye => stack.dyed_color.unwrap_or(layer.default_color),
                    crate::gui_assets::ItemTintSource::Potion => stack.potion_color.unwrap_or(layer.default_color),
                };
                self.region(
                    &layer.sprite, [x, y, 16., 16.],
                    [0., 0., layer.sprite.width as f32, layer.sprite.height as f32],
                    [(color >> 16 & 255) as f32 / 255., (color >> 8 & 255) as f32 / 255., (color & 255) as f32 / 255., 1.],
                    u32::from(stack.enchantment_glint),
                );
            }
        } else if let Some(sprite) = assets.gui.items.get(&item_id).copied() {
            self.region(
                &sprite,
                [x, y, 16., 16.],
                [0., 0., sprite.width as f32, sprite.height as f32],
                [1.; 4],
                u32::from(stack.enchantment_glint),
            );
        }
        if decorations {
            if stack.max_damage > 0 && stack.damage > 0 {
                let fraction = 1. - (stack.damage as f32 / stack.max_damage as f32).clamp(0., 1.);
                let width = (13. * fraction).round();
                self.solid([x + 2., y + 13., 13., 2.], [0., 0., 0., 1.]);
                self.solid(
                    [x + 2., y + 13., width, 1.],
                    [
                        (2. - fraction * 2.).min(1.),
                        (fraction * 2.).min(1.),
                        0.,
                        1.,
                    ],
                );
            }
            if count > 1 {
                let text = count.to_string();
                self.text(
                    &text,
                    x + 17. - self.text_width(&text),
                    y + 9.,
                    [1.; 4],
                    true,
                );
            }
        }
    }
    pub fn cooldown(&mut self, x: f32, y: f32, remaining: f32) {
        let h = (16. * remaining.clamp(0., 1.)).ceil();
        self.solid([x, y + 16. - h, 16., h], [1., 1., 1., 0.5]);
    }
    pub fn button(&mut self, rect: [f32; 4], text: &str, hover: bool, enabled: bool) {
        self.sprite(
            if !enabled {
                "gui/sprites/widget/button_disabled"
            } else if hover {
                "gui/sprites/widget/button_highlighted"
            } else {
                "gui/sprites/widget/button"
            },
            rect,
        );
        self.centered_text(
            text,
            rect[0] + rect[2] / 2.,
            rect[1] + (rect[3] - 8.) / 2.,
            if enabled {
                [1.; 4]
            } else {
                [0.63, 0.63, 0.63, 1.]
            },
            true,
        );
    }
    pub fn slider(&mut self,rect:[f32;4],text:&str,value:f32,hover:bool){
        self.sprite("gui/sprites/widget/slider",rect);
        self.sprite(if hover{"gui/sprites/widget/slider_handle_highlighted"}else{"gui/sprites/widget/slider_handle"},[rect[0]+value.clamp(0.,1.)*(rect[2]-8.),rect[1],8.,rect[3]]);
        self.centered_text(text,rect[0]+rect[2]/2.,rect[1]+(rect[3]-8.)/2.,[1.;4],true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn integer_scale_and_hit_coordinates_share_physical_pixels() {
        let m = GuiMetrics::new(PhysicalSize::new(1920, 1080), 3);
        assert_eq!(m.scale, 3.);
        assert_eq!(m.pointer([300., 150.]), [100., 50.]);
        let m = GuiMetrics::new(PhysicalSize::new(640, 480), 0);
        assert_eq!(m.scale, 2.);
        assert_eq!(m.width, 320.);
    }
    #[test]
    fn small_windows_do_not_fractionally_shrink_pixels() {
        let m = GuiMetrics::new(PhysicalSize::new(300, 200), 4);
        assert_eq!(m.scale, 1.);
    }
}
