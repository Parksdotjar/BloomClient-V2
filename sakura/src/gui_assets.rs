//! Minecraft Java 26.1 GUI resources. Preparation runs on the asset worker;
//! drawing only reads baked sprites and a bounded, in-memory Unicode cache.
//! The game archive and hashed resources remain outside the source package.

use image::{ImageDecoder, ImageReader, RgbaImage};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

const FORMAT: u32 = 7;
const ATLAS: u32 = 4096;
const FONT_Y: u32 = 3072;
const GLYPH_W: u32 = 32;
const GLYPH_H: u32 = 16;
const GLYPH_SLOTS: usize = (ATLAS / GLYPH_W * (ATLAS - FONT_Y) / GLYPH_H) as usize;
const MAX_FILE: usize = 96 * 1024 * 1024;
const INDEX_SHA1: &str = "b9d6fa3dac4ba9d951b661f712ebf9ca38403be2";
const VERSION_SHA1: &str = "90d81d9cd00c1ce55eb2b40aad4f1112bb58f12a";
const VERSION_URL: &str =
    "https://piston-meta.mojang.com/v1/packages/90d81d9cd00c1ce55eb2b40aad4f1112bb58f12a/26.1.json";
const INDEX_URL: &str =
    "https://piston-meta.mojang.com/v1/packages/b9d6fa3dac4ba9d951b661f712ebf9ca38403be2/30.json";
const RESOURCE_NAMES: &[&str] = &[
    "minecraft/font/include/unifont.json",
    "minecraft/font/include/unifont_pua.json",
    "minecraft/font/unifont.zip",
    "minecraft/font/unifont_jp.zip",
    "minecraft/font/unifont_pua.zip",
    "minecraft/sounds.json",
    "minecraft/sounds/random/click_stereo.ogg",
];

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub enum SpriteScaling {
    #[default]
    Stretch,
    Tile {
        width: u32,
        height: u32,
    },
    NineSlice {
        width: u32,
        height: u32,
        left: u32,
        right: u32,
        top: u32,
        bottom: u32,
        stretch_inner: bool,
    },
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct GuiSprite {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub scaling: SpriteScaling,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Glyph {
    pub sprite: GuiSprite,
    pub width: f32,
    pub height: f32,
    pub bearing_x: f32,
    pub bearing_y: f32,
    pub advance: f32,
    pub shadow_offset: f32,
    pub bold_offset: f32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GuiSound {
    pub path: PathBuf,
    pub volume: f32,
    pub pitch: f32,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum ItemTintSource {
    Fixed,
    Dye,
    Potion,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct GuiItemLayer {
    pub sprite: GuiSprite,
    pub tint: ItemTintSource,
    pub default_color: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SpriteAnimation {
    pub frames: Vec<(GuiSprite, u32)>,
    pub duration: u32,
}
pub struct GlyphUpload {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Clone, Copy)]
struct UniGlyph {
    rows: [u32; 16],
    left: u8,
    right: u8,
    width: u8,
}
#[derive(Default)]
struct GlyphCache {
    epoch: u64,
    generation: u64,
    cursor: usize,
    glyphs: HashMap<char, (Glyph, usize, u64)>,
    slots: Vec<Option<char>>,
    uploads: Vec<GlyphUpload>,
}

pub struct GuiAssets {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub sprites: HashMap<String, GuiSprite>,
    pub animations: HashMap<String, SpriteAnimation>,
    /// Always resident bitmap providers. Use glyph() for Unicode fallback.
    pub glyphs: HashMap<char, Glyph>,
    pub items: HashMap<u32, GuiSprite>,
    pub item_layers: HashMap<u32, Vec<GuiItemLayer>>,
    pub item_models: HashMap<String, u32>,
    pub language: HashMap<String, String>,
    pub sounds: HashMap<String, Vec<GuiSound>>,
    pub missing: Vec<String>,
    pub cache_hit: bool,
    unicode: HashMap<char, UniGlyph>,
    missing_glyph: Glyph,
    font: Mutex<GlyphCache>,
}
impl GuiAssets {
    pub fn empty() -> Self {
        Self {
            rgba: vec![0; 4],
            width: 1,
            height: 1,
            sprites: HashMap::new(),
            animations: HashMap::new(),
            glyphs: HashMap::new(),
            items: HashMap::new(),
            item_layers: HashMap::new(),
            item_models: HashMap::new(),
            language: HashMap::new(),
            sounds: HashMap::new(),
            missing: Vec::new(),
            cache_hit: false,
            unicode: HashMap::new(),
            missing_glyph: Glyph {
                advance: 6.,
                ..Glyph::default()
            },
            font: Mutex::new(GlyphCache::default()),
        }
    }
    pub fn sprite(&self, name: &str) -> Option<GuiSprite> {
        self.sprites.get(name).copied()
    }
    pub fn sprite_at(&self, name: &str, game_ticks: u64) -> Option<GuiSprite> {
        if let Some(animation) = self.animations.get(name) {
            let mut t = (game_ticks % u64::from(animation.duration.max(1))) as u32;
            for (sprite, time) in &animation.frames {
                if t < *time {
                    return Some(*sprite);
                }
                t -= *time;
            }
        }
        self.sprite(name)
    }
    pub fn item(&self, id: u32) -> Option<GuiSprite> {
        self.items.get(&id).copied()
    }
    pub fn text<'a>(&'a self, key: &'a str) -> &'a str {
        self.language.get(key).map(String::as_str).unwrap_or(key)
    }
    pub fn begin_frame(&self) {
        let mut c = self.font.lock();
        c.epoch = c.epoch.wrapping_add(1);
    }
    pub fn font_generation(&self) -> u64 {
        self.font.lock().generation
    }
    pub fn take_glyph_uploads(&self) -> Vec<GlyphUpload> {
        std::mem::take(&mut self.font.lock().uploads)
    }
    pub fn glyph(&self, ch: char) -> Glyph {
        if let Some(g) = self.glyphs.get(&ch) {
            return *g;
        }
        let Some(source) = self.unicode.get(&ch) else {
            return self.missing_glyph;
        };
        let mut c = self.font.lock();
        let epoch = c.epoch;
        if let Some((g, _, touched)) = c.glyphs.get_mut(&ch) {
            *touched = epoch;
            return *g;
        }
        if c.uploads.len() >= GLYPH_SLOTS {
            return self.missing_glyph;
        }
        if c.slots.is_empty() {
            c.slots.resize(GLYPH_SLOTS, None);
        }
        let mut chosen = None;
        for _ in 0..GLYPH_SLOTS {
            let i = c.cursor;
            c.cursor = (c.cursor + 1) % GLYPH_SLOTS;
            // Preserve this frame AND the previous frame, including cached HUD
            // vertices. A generation change makes the renderer rebuild old text.
            if c.slots[i].is_none_or(|old| {
                c.glyphs
                    .get(&old)
                    .is_none_or(|(_, _, seen)| seen.saturating_add(1) < epoch)
            }) {
                chosen = Some(i);
                break;
            }
        }
        let Some(slot) = chosen else {
            return self.missing_glyph;
        };
        if let Some(old) = c.slots[slot] {
            c.glyphs.remove(&old);
            c.generation = c.generation.wrapping_add(1);
        }
        let x = slot as u32 % (ATLAS / GLYPH_W) * GLYPH_W;
        let y = FONT_Y + slot as u32 / (ATLAS / GLYPH_W) * GLYPH_H;
        let width = u32::from(source.right.saturating_sub(source.left)) + 1;
        let g = Glyph {
            sprite: GuiSprite {
                x,
                y,
                width,
                height: 16,
                scaling: SpriteScaling::Stretch,
            },
            width: width as f32 / 2.,
            height: 8.,
            bearing_x: 0.,
            bearing_y: 0.,
            advance: (width / 2 + 1) as f32,
            shadow_offset: 0.5,
            bold_offset: 0.5,
        };
        let mut pixels = vec![0; (GLYPH_W * GLYPH_H * 4) as usize];
        for row in 0..16 {
            for col in 0..width {
                let bit = u32::from(source.width) - 1 - (col + u32::from(source.left));
                if source.rows[row] & (1u32 << bit) != 0 {
                    let i = (row * GLYPH_W as usize + col as usize) * 4;
                    pixels[i..i + 4].copy_from_slice(&[255; 4]);
                }
            }
        }
        c.uploads.push(GlyphUpload {
            x,
            y,
            width: GLYPH_W,
            height: GLYPH_H,
            rgba: pixels,
        });
        c.slots[slot] = Some(ch);
        c.glyphs.insert(ch, (g, slot, epoch));
        g
    }
}

#[derive(Serialize, Deserialize)]
struct CacheMeta {
    sprites: HashMap<String, GuiSprite>,
    animations: HashMap<String, SpriteAnimation>,
    glyphs: HashMap<char, Glyph>,
    items: HashMap<u32, GuiSprite>,
    item_layers: HashMap<u32, Vec<GuiItemLayer>>,
    item_models: HashMap<String, u32>,
    language: HashMap<String, String>,
    sounds: HashMap<String, Vec<GuiSound>>,
    missing: Vec<String>,
    missing_glyph: Glyph,
}

struct AtlasBuilder {
    rgba: Vec<u8>,
    x: u32,
    y: u32,
    row: u32,
}
impl AtlasBuilder {
    fn new() -> Self {
        Self {
            rgba: vec![0; (ATLAS * FONT_Y * 4) as usize],
            x: 1,
            y: 1,
            row: 0,
        }
    }
    fn insert(&mut self, image: &RgbaImage, scaling: SpriteScaling) -> Result<GuiSprite, String> {
        let (w, h) = image.dimensions();
        if w == 0 || h == 0 || w + 2 > ATLAS || h + 2 > FONT_Y {
            return Err("GUI image dimensions exceed atlas bounds".into());
        }
        if self.x + w + 1 > ATLAS {
            self.x = 1;
            self.y += self.row + 2;
            self.row = 0;
        }
        if self.y + h + 1 > FONT_Y {
            return Err("GUI atlas exhausted; refusing to reduce asset quality".into());
        }
        let sprite = GuiSprite {
            x: self.x,
            y: self.y,
            width: w,
            height: h,
            scaling,
        };
        // One duplicated edge texel protects adjacent sprites even if sampling
        // precision lands on an atlas boundary. GUI sampling remains nearest.
        for dy in 0..h + 2 {
            for dx in 0..w + 2 {
                let pixel = image.get_pixel(
                    dx.saturating_sub(1).min(w - 1),
                    dy.saturating_sub(1).min(h - 1),
                );
                let p = (((self.y + dy - 1) * ATLAS + self.x + dx - 1) * 4) as usize;
                self.rgba[p..p + 4].copy_from_slice(&pixel.0);
            }
        }
        self.x += w + 2;
        self.row = self.row.max(h);
        Ok(sprite)
    }
    fn finish(mut self) -> Vec<u8> {
        self.rgba.resize((ATLAS * ATLAS * 4) as usize, 0);
        self.rgba
    }
}

#[derive(Clone, Deserialize)]
struct Object {
    hash: String,
    size: u64,
}
#[derive(Deserialize)]
struct AssetIndex {
    objects: HashMap<String, Object>,
}
#[derive(Serialize, Deserialize, PartialEq)]
struct SourceStamp {
    path: String,
    size: u64,
    modified: u128,
}

fn stamp(path: &Path, name: &str) -> Result<SourceStamp, String> {
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(SourceStamp {
        path: name.into(),
        size: m.len(),
        modified: m
            .modified()
            .map_err(|e| e.to_string())?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos(),
    })
}
fn sha1(bytes: &[u8]) -> String {
    format!("{:x}", sha1::Sha1::digest(bytes))
}
fn object_path(root: &Path, object: &Object) -> Result<PathBuf, String> {
    if object.hash.len() != 40
        || !object.hash.bytes().all(|b| b.is_ascii_hexdigit())
        || object.size > 16 * 1024 * 1024
    {
        return Err("Invalid official resource object".into());
    }
    Ok(root
        .join("objects")
        .join(&object.hash[..2])
        .join(&object.hash))
}

/// Repeatable, version-pinned import. Call only from the existing asset worker.
/// A valid receipt avoids network requests and repeated hashing on warm starts.
pub fn prepare_resources(cache_dir: &Path) -> Result<PathBuf, String> {
    let root = cache_dir.join("resources-26.1");
    let receipt = root.join("verified.json");
    if let Ok(bytes) = crate::assets::read_bounded(&receipt, 64 * 1024) {
        if let Ok(saved) = serde_json::from_slice::<Vec<SourceStamp>>(&bytes) {
            if saved.len() == RESOURCE_NAMES.len() + 2
                && saved.iter().all(|s| {
                    let safe = s.path == "26.1.json"
                        || s.path == "indexes/30.json"
                        || (s.path.starts_with("objects/")
                            && s.path.len() == 51
                            && !s.path.contains("..")
                            && !s.path.contains('\\'));
                    safe && stamp(&root.join(&s.path), &s.path).ok().as_ref() == Some(s)
                })
            {
                return Ok(root);
            }
        }
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(import_resources(&root))?;
    Ok(root)
}

async fn import_resources(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut candidates = Vec::new();
    if let Some(v) = std::env::var_os("APPDATA") {
        candidates.push(PathBuf::from(v).join("BloomClient/minecraft/assets"));
    }
    // This is a verified local source optimization, never a runtime dependency.
    if let Some(v) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(v).join("SakuraDevelopment/reference-assets26.1"));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
    ensure_resource(
        &client,
        root,
        "26.1.json",
        VERSION_URL,
        VERSION_SHA1,
        None,
        &candidates,
    )
    .await?;
    ensure_resource(
        &client,
        root,
        "indexes/30.json",
        INDEX_URL,
        INDEX_SHA1,
        Some(548391),
        &candidates,
    )
    .await?;
    let index: AssetIndex = serde_json::from_slice(&crate::assets::read_bounded(
        &root.join("indexes/30.json"),
        1024 * 1024,
    )?)
    .map_err(|e| e.to_string())?;
    let mut stamps = vec![
        stamp(&root.join("26.1.json"), "26.1.json")?,
        stamp(&root.join("indexes/30.json"), "indexes/30.json")?,
    ];
    let mut resources = serde_json::Map::new();
    for &name in RESOURCE_NAMES {
        let object = index
            .objects
            .get(name)
            .ok_or_else(|| format!("Reference asset index is missing {name}"))?;
        let _ = object_path(root, object)?;
        let relative = format!("objects/{}/{}", &object.hash[..2], object.hash);
        let url = format!(
            "https://resources.download.minecraft.net/{}/{}",
            &object.hash[..2],
            object.hash
        );
        ensure_resource(
            &client,
            root,
            &relative,
            &url,
            &object.hash,
            Some(object.size),
            &candidates,
        )
        .await?;
        stamps.push(stamp(&root.join(&relative), &relative)?);
        resources.insert(
            name.into(),
            serde_json::json!({"sha1":object.hash,"size":object.size,"url":url}),
        );
    }
    let manifest = serde_json::json!({"reference":"Minecraft Java Edition 26.1","version_metadata":{"url":VERSION_URL,"sha1":VERSION_SHA1},"asset_index":{"id":"30","url":INDEX_URL,"sha1":INDEX_SHA1},"resources":resources,"note":"Official game assets imported locally; not included in the Sakura source package."});
    crate::assets::atomic_write(
        &root.join("sources.json"),
        &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )?;
    crate::assets::atomic_write(
        &root.join("verified.json"),
        &serde_json::to_vec(&stamps).map_err(|e| e.to_string())?,
    )
}
async fn ensure_resource(
    client: &reqwest::Client,
    root: &Path,
    name: &str,
    url: &str,
    hash: &str,
    size: Option<u64>,
    sources: &[PathBuf],
) -> Result<(), String> {
    let path = root.join(name);
    let valid = |bytes: &[u8]| size.is_none_or(|n| n == bytes.len() as u64) && sha1(bytes) == hash;
    if crate::assets::read_bounded(&path, 16 * 1024 * 1024).is_ok_and(|b| valid(&b)) {
        return Ok(());
    }
    let mut found = None;
    for source in sources {
        if let Ok(b) = crate::assets::read_bounded(&source.join(name), 16 * 1024 * 1024) {
            if valid(&b) {
                found = Some(b);
                break;
            }
        }
    }
    let bytes = if let Some(b) = found {
        b
    } else {
        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Cannot fetch reference asset {name}: {e}"))?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        if response
            .content_length()
            .is_some_and(|n| n > 16 * 1024 * 1024)
        {
            return Err("Reference download exceeds limit".into());
        }
        let mut bytes = Vec::with_capacity(size.unwrap_or(65536) as usize);
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
                return Err("Reference download exceeds limit".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if !valid(&bytes) {
            return Err(format!(
                "Official reference asset failed SHA-1/size verification: {name}"
            ));
        }
        bytes
    };
    fs::create_dir_all(path.parent().ok_or("Invalid reference path")?)
        .map_err(|e| e.to_string())?;
    crate::assets::atomic_write(&path, &bytes)
}

struct Resources {
    zip: zip::ZipArchive<File>,
    root: PathBuf,
    index: AssetIndex,
    decoded: usize,
}
impl Resources {
    fn new(jar: &Path, root: PathBuf) -> Result<Self, String> {
        let zip = zip::ZipArchive::new(File::open(jar).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if zip.len() > 100_000 {
            return Err("Too many archive entries".into());
        }
        let index = serde_json::from_slice(&crate::assets::read_bounded(
            &root.join("indexes/30.json"),
            1024 * 1024,
        )?)
        .map_err(|e| e.to_string())?;
        Ok(Self {
            zip,
            root,
            index,
            decoded: 0,
        })
    }
    fn read(&mut self, path: &str, limit: usize) -> Result<Vec<u8>, String> {
        let bytes = if let Some(object) = path
            .strip_prefix("assets/")
            .and_then(|p| self.index.objects.get(p))
        {
            crate::assets::read_bounded(&object_path(&self.root, object)?, limit)
                .map_err(|e| format!("Cannot read indexed reference resource {path}: {e}"))?
        } else {
            let mut member = self
                .zip
                .by_name(path)
                .map_err(|_| format!("Missing reference resource {path}"))?;
            if member.size() > limit as u64 {
                return Err(format!("Oversized reference resource {path}"));
            }
            let mut bytes = Vec::with_capacity(member.size() as usize);
            member
                .by_ref()
                .take(limit as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > limit {
                return Err("Reference resource exceeded read limit".into());
            }
            bytes
        };
        self.decoded += bytes.len();
        if self.decoded > 256 * 1024 * 1024 {
            return Err("GUI resource decode budget exceeded".into());
        }
        Ok(bytes)
    }
    fn json(&mut self, path: &str) -> Result<Value, String> {
        serde_json::from_slice(&self.read(path, 4 * 1024 * 1024)?)
            .map_err(|e| format!("Invalid JSON {path}: {e}"))
    }
    fn png(&mut self, path: &str) -> Result<RgbaImage, String> {
        let decoder = ImageReader::with_format(
            Cursor::new(self.read(path, 8 * 1024 * 1024)?),
            image::ImageFormat::Png,
        )
        .into_decoder()
        .map_err(|e| e.to_string())?;
        let (w, h) = decoder.dimensions();
        if w == 0 || h == 0 || w > 4096 || h > 4096 || w as u64 * h as u64 > 4_194_304 {
            return Err("GUI PNG dimensions exceed limits".into());
        }
        image::DynamicImage::from_decoder(decoder)
            .map(|v| v.to_rgba8())
            .map_err(|e| e.to_string())
    }
}

fn scaling(value: &Value, w: u32, h: u32) -> Result<SpriteScaling, String> {
    let value = &value["gui"]["scaling"];
    let number = |key: &str, default: u32| -> Result<u32, String> {
        let n = value[key].as_u64().unwrap_or(default as u64);
        if n == 0 || n > 4096 {
            Err("Invalid GUI logical dimensions".into())
        } else {
            Ok(n as u32)
        }
    };
    Ok(match value["type"].as_str().unwrap_or("stretch") {
        "stretch" => SpriteScaling::Stretch,
        "tile" => SpriteScaling::Tile {
            width: number("width", w)?,
            height: number("height", h)?,
        },
        "nine_slice" => {
            let width = number("width", w)?;
            let height = number("height", h)?;
            let b = &value["border"];
            let edge = |name: &str| -> Result<u32, String> {
                let n = b.as_u64().or_else(|| b[name].as_u64()).unwrap_or(0);
                if n > 4096 {
                    Err("Invalid GUI border".into())
                } else {
                    Ok(n as u32)
                }
            };
            let (left, right, top, bottom) =
                (edge("left")?, edge("right")?, edge("top")?, edge("bottom")?);
            if left + right > width || top + bottom > height {
                return Err("GUI borders exceed logical sprite size".into());
            }
            SpriteScaling::NineSlice {
                width,
                height,
                left,
                right,
                top,
                bottom,
                stretch_inner: value["stretch_inner"].as_bool().unwrap_or(false),
            }
        }
        other => return Err(format!("Unsupported GUI scaling {other}")),
    })
}

fn resource_path(id: &str, folder: &str, extension: &str) -> Result<String, String> {
    let (namespace, path) = id.split_once(':').unwrap_or(("minecraft", id));
    if namespace.is_empty()
        || path.is_empty()
        || id.len() > 256
        || !namespace.bytes().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || b"_- .".contains(&c) && c != b' '
        })
        || !path.bytes().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || b"_-/ .".contains(&c) && c != b' '
        })
        || path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err("Invalid resource identifier".into());
    }
    Ok(if folder.is_empty() {
        format!("assets/{namespace}/{path}")
    } else {
        format!("assets/{namespace}/{folder}/{path}.{extension}")
    })
}
fn load_font(
    resources: &mut Resources,
    atlas: &mut AtlasBuilder,
    id: &str,
    depth: usize,
    glyphs: &mut HashMap<char, Glyph>,
    unicode: &mut HashMap<char, UniGlyph>,
) -> Result<(), String> {
    if depth > 16 {
        return Err("Font provider cycle/depth limit".into());
    }
    let definition = resources.json(&resource_path(id, "font", "json")?)?;
    let providers = definition["providers"]
        .as_array()
        .ok_or("Font has no providers")?;
    if providers.len() > 128 {
        return Err("Font provider limit exceeded".into());
    }
    for provider in providers {
        if provider["filter"]["jp"].as_bool() == Some(true)
            || provider["filter"]["uniform"].as_bool() == Some(true)
        {
            continue;
        }
        match provider["type"]
            .as_str()
            .unwrap_or("")
            .trim_start_matches("minecraft:")
        {
            "reference" => load_font(
                resources,
                atlas,
                provider["id"].as_str().ok_or("Missing font reference")?,
                depth + 1,
                glyphs,
                unicode,
            )?,
            "space" => {
                for (key, value) in provider["advances"]
                    .as_object()
                    .ok_or("Invalid font advances")?
                {
                    let mut chars = key.chars();
                    let Some(ch) = chars.next() else { continue };
                    if chars.next().is_some() {
                        return Err("Font advance key is not a code point".into());
                    }
                    let advance = value.as_f64().ok_or("Invalid font advance")? as f32;
                    if !advance.is_finite() || advance.abs() > 256. {
                        return Err("Font advance out of range".into());
                    }
                    glyphs.entry(ch).or_insert(Glyph {
                        advance,
                        shadow_offset: 1.,
                        bold_offset: 1.,
                        ..Glyph::default()
                    });
                }
            }
            "bitmap" => {
                let file = provider["file"].as_str().ok_or("Missing bitmap font")?;
                let file = file.strip_suffix(".png").ok_or("Bitmap font must be PNG")?;
                let image = resources.png(&resource_path(file, "textures", "png")?)?;
                let rows = provider["chars"].as_array().ok_or("Missing bitmap rows")?;
                let columns = rows
                    .first()
                    .and_then(Value::as_str)
                    .ok_or("Empty bitmap font")?
                    .chars()
                    .count() as u32;
                if columns == 0
                    || rows.len() > 1024
                    || image.width() % columns != 0
                    || image.height() % rows.len() as u32 != 0
                {
                    return Err("Invalid bitmap font grid".into());
                }
                let (w, h) = (image.width() / columns, image.height() / rows.len() as u32);
                let height = provider["height"].as_f64().unwrap_or(8.) as f32;
                let ascent = provider["ascent"].as_f64().unwrap_or(7.) as f32;
                if height <= 0.
                    || height > 64.
                    || !height.is_finite()
                    || !ascent.is_finite()
                    || ascent.abs() > 64.
                {
                    return Err("Invalid bitmap font metrics".into());
                }
                let scale = height / h as f32;
                for (y, row) in rows.iter().enumerate() {
                    let row = row.as_str().ok_or("Invalid bitmap character row")?;
                    if row.chars().count() != columns as usize {
                        return Err("Bitmap rows differ in width".into());
                    }
                    for (x, ch) in row.chars().enumerate() {
                        if ch == '\0' || glyphs.contains_key(&ch) {
                            continue;
                        }
                        let tile =
                            image::imageops::crop_imm(&image, x as u32 * w, y as u32 * h, w, h)
                                .to_image();
                        let visible = (0..w)
                            .rev()
                            .find(|x| (0..h).any(|y| tile.get_pixel(*x, y)[3] != 0))
                            .map_or(0, |x| x + 1);
                        let sprite = atlas.insert(&tile, SpriteScaling::Stretch)?;
                        glyphs.insert(
                            ch,
                            Glyph {
                                sprite,
                                width: w as f32 * scale,
                                height,
                                bearing_x: 0.,
                                bearing_y: 7. - ascent,
                                advance: (visible as f32 * scale + 0.5).floor() + 1.,
                                shadow_offset: 1.,
                                bold_offset: 1.,
                            },
                        );
                    }
                }
            }
            "unihex" => {
                let path = resource_path(
                    provider["hex_file"]
                        .as_str()
                        .ok_or("Missing unihex archive")?,
                    "",
                    "",
                )?;
                let bytes = resources.read(&path, 8 * 1024 * 1024)?;
                let mut zip =
                    zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
                if zip.len() > 64 {
                    return Err("Unicode archive entry limit exceeded".into());
                }
                let mut total = 0usize;
                for i in 0..zip.len() {
                    let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
                    if !entry.name().ends_with(".hex") {
                        continue;
                    }
                    if entry.size() > 32 * 1024 * 1024 {
                        return Err("Unicode font too large".into());
                    }
                    let mut data = Vec::with_capacity(entry.size() as usize);
                    entry
                        .by_ref()
                        .take(32 * 1024 * 1024 + 1)
                        .read_to_end(&mut data)
                        .map_err(|e| e.to_string())?;
                    total += data.len();
                    if total > 32 * 1024 * 1024 {
                        return Err("Unicode decompression budget exceeded".into());
                    }
                    for line in data.split(|b| *b == b'\n') {
                        let line = line.strip_suffix(b"\r").unwrap_or(line);
                        if line.is_empty() {
                            continue;
                        }
                        let Some((ch, mut glyph)) = parse_unihex(line)? else {
                            continue;
                        };
                        if let Some(overrides) = provider["size_overrides"].as_array() {
                            for o in overrides {
                                let from = o["from"]
                                    .as_str()
                                    .and_then(|s| s.chars().next())
                                    .ok_or("Invalid Unicode override")?;
                                let to = o["to"]
                                    .as_str()
                                    .and_then(|s| s.chars().next())
                                    .ok_or("Invalid Unicode override")?;
                                if (from..=to).contains(&ch) {
                                    let left =
                                        o["left"].as_u64().ok_or("Invalid Unicode left bearing")?;
                                    let right = o["right"]
                                        .as_u64()
                                        .ok_or("Invalid Unicode right bearing")?;
                                    if left > right || right >= 32 {
                                        return Err("Unicode override exceeds glyph budget".into());
                                    }
                                    if right >= u64::from(glyph.width) {
                                        // Java's line data is left-aligned in a
                                        // 32-bit row; overrides may expose blank
                                        // columns beyond an 8px source glyph.
                                        let width = ((right as u8 / 8) + 1) * 8;
                                        for row in &mut glyph.rows {
                                            *row <<= width - glyph.width;
                                        }
                                        glyph.width = width;
                                    }
                                    glyph.left = left as u8;
                                    glyph.right = right as u8;
                                    break;
                                }
                            }
                        }
                        unicode.entry(ch).or_insert(glyph);
                        if unicode.len() > 150_000 {
                            return Err("Unicode glyph limit exceeded".into());
                        }
                    }
                }
            }
            other => return Err(format!("Unsupported reference font provider {other}")),
        }
    }
    Ok(())
}
fn parse_unihex(line: &[u8]) -> Result<Option<(char, UniGlyph)>, String> {
    let colon = line
        .iter()
        .position(|b| *b == b':')
        .ok_or("Invalid unihex line")?;
    if !(4..=6).contains(&colon) {
        return Err("Invalid unihex code point".into());
    }
    let ch = u32::from_str_radix(
        std::str::from_utf8(&line[..colon]).map_err(|_| "Non-ASCII unihex")?,
        16,
    )
    .map_err(|_| "Invalid unihex code point")?;
    let Some(ch) = char::from_u32(ch) else {
        return Ok(None);
    };
    let data = &line[colon + 1..];
    let width = (data.len() / 16 * 4) as u8;
    if ![8, 16, 24, 32].contains(&width) || data.len() != width as usize * 4 {
        return Err("Invalid unihex bitmap width".into());
    }
    let mut rows = [0u32; 16];
    let mut occupied = 0u32;
    for (row, encoded) in data.chunks_exact(width as usize / 4).enumerate() {
        rows[row] = u32::from_str_radix(
            std::str::from_utf8(encoded).map_err(|_| "Non-ASCII unihex")?,
            16,
        )
        .map_err(|_| "Invalid unihex pixels")?;
        occupied |= rows[row];
    }
    let (left, right) = if occupied == 0 {
        (0, width - 1)
    } else {
        (
            (occupied.leading_zeros() - (32 - u32::from(width))) as u8,
            (u32::from(width) - occupied.trailing_zeros() - 1) as u8,
        )
    };
    Ok(Some((
        ch,
        UniGlyph {
            rows,
            left,
            right,
            width,
        },
    )))
}

fn pack_animation(
    atlas: &mut AtlasBuilder,
    image: &RgbaImage,
    mode: SpriteScaling,
    value: &Value,
) -> Result<SpriteAnimation, String> {
    let default = image.width().min(image.height());
    let width = value["width"]
        .as_u64()
        .unwrap_or(if value["height"].is_number() {
            image.width()
        } else {
            default
        } as u64) as u32;
    let height = value["height"]
        .as_u64()
        .unwrap_or(if value["width"].is_number() {
            image.height()
        } else {
            default
        } as u64) as u32;
    if width == 0
        || height == 0
        || width > image.width()
        || height > image.height()
        || image.width() % width != 0
        || image.height() % height != 0
    {
        return Err("Invalid GUI animation frame dimensions".into());
    }
    let count = image.width() / width * (image.height() / height);
    if count > 1024 {
        return Err("GUI animation frame count limit exceeded".into());
    }
    let default_time = value["frametime"].as_u64().unwrap_or(1);
    if default_time == 0 || default_time > 10000 {
        return Err("Invalid GUI animation frame time".into());
    }
    let mut references = Vec::new();
    if let Some(frames) = value["frames"].as_array() {
        if frames.is_empty() || frames.len() > 1024 {
            return Err("Invalid GUI animation timeline".into());
        }
        for frame in frames {
            let index = frame
                .as_u64()
                .or_else(|| frame["index"].as_u64())
                .ok_or("Invalid GUI animation index")?;
            let time = frame["time"].as_u64().unwrap_or(default_time);
            if index >= count as u64 || time == 0 || time > 10000 {
                return Err("Invalid GUI animation frame".into());
            }
            references.push((index as u32, time as u32));
        }
    } else {
        references.extend((0..count).map(|i| (i, default_time as u32)));
    }
    let mut packed = HashMap::new();
    let mut frames = Vec::with_capacity(references.len());
    let mut duration = 0;
    for (index, time) in references {
        let sprite = if let Some(s) = packed.get(&index) {
            *s
        } else {
            let frame = image::imageops::crop_imm(
                image,
                index % (image.width() / width) * width,
                index / (image.width() / width) * height,
                width,
                height,
            )
            .to_image();
            let s = atlas.insert(&frame, mode)?;
            packed.insert(index, s);
            s
        };
        frames.push((sprite, time));
        duration += time;
    }
    Ok(SpriteAnimation { frames, duration })
}

fn bake(jar: &Path, root: PathBuf) -> Result<GuiAssets, String> {
    let mut resources = Resources::new(jar, root)?;
    if resources.json("version.json")?["id"].as_str() != Some("26.1") {
        return Err("GUI reference requires Minecraft Java26.1".into());
    }
    let gui_atlas = resources.json("assets/minecraft/atlases/gui.json")?;
    let sources = gui_atlas["sources"]
        .as_array()
        .ok_or("Missing reference GUI atlas sources")?;
    if !sources.iter().all(|source| {
        source["type"].as_str() == Some("minecraft:directory")
            && matches!(
                source["source"].as_str(),
                Some("gui/sprites" | "mob_effect")
            )
    }) {
        return Err("Unsupported GUI atlas source definition".into());
    }
    let mut atlas = AtlasBuilder::new();
    let mut sprites = HashMap::new();
    let mut animations = HashMap::new();
    let mut paths: Vec<String> = resources
        .zip
        .file_names()
        .filter(|p| {
            (p.starts_with("assets/minecraft/textures/gui/")
                || p.starts_with("assets/minecraft/textures/mob_effect/"))
                && p.ends_with(".png")
                && !p.starts_with("assets/minecraft/textures/gui/title/background/panorama")
        })
        .map(str::to_owned)
        .collect();
    paths.extend([
        "assets/minecraft/textures/misc/enchanted_glint_item.png".into(),
        "assets/minecraft/textures/misc/enchanted_glint_armor.png".into(),
    ]);
    // Shelf packing tall images first greatly reduces atlas waste. All PNGs
    // are decoded once here, never when a screen opens.
    let mut images = Vec::with_capacity(paths.len());
    paths.sort();
    for path in paths {
        let image = resources.png(&path)?;
        let meta_path = format!("{path}.mcmeta");
        let metadata = if resources.zip.index_for_name(&meta_path).is_some()
            || resources
                .index
                .objects
                .contains_key(meta_path.trim_start_matches("assets/"))
        {
            resources.json(&meta_path)?
        } else {
            Value::Null
        };
        let mode = scaling(&metadata, image.width(), image.height())?;
        images.push((path, image, mode, metadata));
    }
    images.sort_by(|a, b| {
        b.1.height()
            .cmp(&a.1.height())
            .then(b.1.width().cmp(&a.1.width()))
            .then(a.0.cmp(&b.0))
    });
    for (path, image, mode, metadata) in images {
        let key = path
            .trim_start_matches("assets/minecraft/textures/")
            .trim_end_matches(".png")
            .to_owned();
        if metadata["animation"].is_object() {
            let animation = pack_animation(&mut atlas, &image, mode, &metadata["animation"])?;
            sprites.insert(key.clone(), animation.frames[0].0);
            animations.insert(key, animation);
        } else {
            sprites.insert(key, atlas.insert(&image, mode)?);
        }
    }
    sprites.insert(
        "sakura/internal/player_preview".into(),
        atlas.insert(&RgbaImage::new(128, 192), SpriteScaling::Stretch)?,
    );
    let mut glyphs = HashMap::new();
    let mut unicode = HashMap::new();
    load_font(
        &mut resources,
        &mut atlas,
        "minecraft:default",
        0,
        &mut glyphs,
        &mut unicode,
    )?;
    let missing_image = RgbaImage::from_fn(5, 8, |x, y| {
        if x == 0 || x == 4 || y == 0 || y == 7 {
            image::Rgba([255; 4])
        } else {
            image::Rgba([0; 4])
        }
    });
    let missing_glyph = Glyph {
        sprite: atlas.insert(&missing_image, SpriteScaling::Stretch)?,
        width: 5.,
        height: 8.,
        bearing_x: 0.,
        bearing_y: 0.,
        advance: 6.,
        shadow_offset: 1.,
        bold_offset: 1.,
    };
    let language = serde_json::from_value(resources.json("assets/minecraft/lang/en_us.json")?)
        .map_err(|e| format!("Invalid en_us language resource: {e}"))?;
    let sound_defs = resources.json("assets/minecraft/sounds.json")?;
    let mut sounds = HashMap::new();
    let event = &sound_defs["ui.button.click"];
    let mut click = Vec::new();
    if let Some(entries) = event["sounds"].as_array() {
        for entry in entries {
            let name = entry
                .as_str()
                .or_else(|| entry["name"].as_str())
                .ok_or("Invalid UI click sound")?;
            let key = format!(
                "minecraft/sounds/{}.ogg",
                name.trim_start_matches("minecraft:")
            );
            let object = resources
                .index
                .objects
                .get(&key)
                .ok_or("UI click missing from official asset index")?;
            click.push(GuiSound {
                path: object_path(&resources.root, object)?,
                volume: entry["volume"].as_f64().unwrap_or(1.) as f32,
                pitch: entry["pitch"].as_f64().unwrap_or(1.) as f32,
            });
        }
    }
    if click.is_empty() {
        return Err("Reference UI sound event has no files".into());
    }
    sounds.insert("ui.button.click".into(), click);
    let baked = crate::assets::bake_gui_items(jar)?;
    let mut items = HashMap::with_capacity(baked.icons.len());
    for (id, image) in baked.icons {
        items.insert(id, atlas.insert(&image, SpriteScaling::Stretch)?);
    }
    let mut item_layers = HashMap::new();
    for (id, layers) in baked.layers {
        let mut packed = Vec::with_capacity(layers.len());
        for (image, tint, default_color) in layers {
            packed.push(GuiItemLayer {
                sprite: atlas.insert(&image, SpriteScaling::Stretch)?,
                tint,
                default_color,
            });
        }
        item_layers.insert(id, packed);
    }
    Ok(GuiAssets {
        rgba: atlas.finish(),
        width: ATLAS,
        height: ATLAS,
        sprites,
        animations,
        glyphs,
        items,
        item_layers,
        item_models: baked.names,
        language,
        sounds,
        missing: baked.missing,
        cache_hit: false,
        unicode,
        missing_glyph,
        font: Mutex::new(GlyphCache::default()),
    })
}

pub(crate) fn load(jar: &Path, cache_dir: &Path, jar_hash: &[u8]) -> Result<GuiAssets, String> {
    let root = prepare_resources(cache_dir)?;
    let key: [u8; 32] = Sha256::digest(
        format!("{FORMAT}:26.1:{INDEX_SHA1}:{jar_hash:?}:{}", root.display()).as_bytes(),
    )
    .into();
    let path = cache_dir.join(format!("gui-v{FORMAT}-{:x}.bin", Sha256::digest(key)));
    if let Ok(bytes) = crate::assets::read_bounded(&path, MAX_FILE) {
        if let Ok(mut gui) = decode_cache(&bytes, &key) {
            gui.cache_hit = true;
            return Ok(gui);
        }
    }
    let gui = bake(jar, root)?;
    if let Ok(bytes) = encode_cache(&gui, &key) {
        let _ = crate::assets::atomic_write(&path, &bytes);
    }
    let manifest = serde_json::json!({"reference":"Minecraft Java Edition 26.1","gui_cache_format":FORMAT,"client_archive_sha256":jar_hash.iter().map(|b|format!("{b:02x}")).collect::<String>(),"asset_index_sha1":INDEX_SHA1,"gui_atlas_definition":"assets/minecraft/atlases/gui.json","gui_sprites":gui.sprites.len(),"bitmap_glyphs":gui.glyphs.len(),"unicode_glyphs":gui.unicode.len(),"item_icons":gui.items.len(),"dynamic_tint_items":gui.item_layers.len(),"unsupported_item_models":gui.missing,"atlas":[ATLAS,ATLAS],"unicode_resident_limit":GLYPH_SLOTS,"not_imported":"Unused title panorama; Sakura currently launches directly into a server","item_variant_limits":"Default model states; installed item_model overrides and generated dye/potion tint layers supported. Runtime trim palettes, banner patterns, custom player-head skins, clock/compass dispatch, bundle contents, animated item textures and arbitrary resource-pack models remain unsupported."});
    if let Ok(bytes) = serde_json::to_vec_pretty(&manifest) {
        let _ = crate::assets::atomic_write(&cache_dir.join("gui-source-manifest.json"), &bytes);
    }
    Ok(gui)
}
fn encode_cache(gui: &GuiAssets, key: &[u8; 32]) -> Result<Vec<u8>, String> {
    let meta = CacheMeta {
        sprites: gui.sprites.clone(),
        animations: gui.animations.clone(),
        glyphs: gui.glyphs.clone(),
        items: gui.items.clone(),
        item_layers: gui.item_layers.clone(),
        item_models: gui.item_models.clone(),
        language: gui.language.clone(),
        sounds: gui.sounds.clone(),
        missing: gui.missing.clone(),
        missing_glyph: gui.missing_glyph,
    };
    let json = serde_json::to_vec(&meta).map_err(|e| e.to_string())?;
    if json.len() > 8 * 1024 * 1024 {
        return Err("GUI cache metadata exceeds limit".into());
    }
    let rows = gui
        .sprites
        .values()
        .chain(gui.items.values())
        .chain(
            gui.item_layers
                .values()
                .flat_map(|layers| layers.iter().map(|l| &l.sprite)),
        )
        .chain(
            gui.animations
                .values()
                .flat_map(|a| a.frames.iter().map(|(s, _)| s)),
        )
        .chain(gui.glyphs.values().map(|g| &g.sprite))
        .chain(std::iter::once(&gui.missing_glyph.sprite))
        .map(|s| s.y + s.height + 1)
        .max()
        .unwrap_or(1)
        .min(FONT_Y);
    let mut body =
        Vec::with_capacity(json.len() + (rows * ATLAS * 4) as usize + gui.unicode.len() * 71 + 12);
    body.extend_from_slice(&(json.len() as u32).to_le_bytes());
    body.extend_from_slice(&json);
    body.extend_from_slice(&rows.to_le_bytes());
    body.extend_from_slice(&gui.rgba[..(rows * ATLAS * 4) as usize]);
    body.extend_from_slice(&(gui.unicode.len() as u32).to_le_bytes());
    for (ch, g) in &gui.unicode {
        body.extend_from_slice(&(*ch as u32).to_le_bytes());
        body.extend_from_slice(&[g.width, g.left, g.right]);
        for row in g.rows {
            body.extend_from_slice(&row.to_le_bytes());
        }
    }
    if body.len() > MAX_FILE - 76 {
        return Err("GUI cache size exceeds limit".into());
    }
    let mut bytes = Vec::with_capacity(body.len() + 76);
    bytes.extend_from_slice(b"SKRGUI01");
    bytes.extend_from_slice(&FORMAT.to_le_bytes());
    bytes.extend_from_slice(key);
    bytes.extend_from_slice(&Sha256::digest(&body));
    bytes.extend_from_slice(&body);
    Ok(bytes)
}
fn decode_cache(bytes: &[u8], key: &[u8; 32]) -> Result<GuiAssets, String> {
    if bytes.len() < 76
        || bytes.len() > MAX_FILE
        || &bytes[..8] != b"SKRGUI01"
        || bytes[8..12] != FORMAT.to_le_bytes()
        || &bytes[12..44] != key
        || bytes[44..76] != Sha256::digest(&bytes[76..])[..]
    {
        return Err("Invalid GUI cache header/checksum".into());
    }
    let mut d = GuiDecoder {
        bytes: &bytes[76..],
        at: 0,
    };
    let json_len = d.u32()? as usize;
    if json_len > 8 * 1024 * 1024 {
        return Err("GUI metadata allocation limit".into());
    }
    let meta: CacheMeta = serde_json::from_slice(d.bytes(json_len)?).map_err(|e| e.to_string())?;
    if meta.sprites.len() > 4096
        || meta.items.len() > 8192
        || meta.glyphs.len() > 16384
        || meta.language.len() > 50000
        || meta.missing.len() > 8192
    {
        return Err("GUI cache entry count exceeds limits".into());
    }
    if meta.item_layers.len() > 8192
        || meta.item_models.len() > 16384
        || meta.item_layers.values().any(|a| a.len() > 16)
        || meta
            .item_models
            .iter()
            .any(|(name, id)| name.len() > 256 || !meta.items.contains_key(id))
    {
        return Err("Invalid item layer/model cache".into());
    }
    let rows = d.u32()?;
    if rows == 0 || rows > FONT_Y {
        return Err("Invalid GUI cache atlas rows".into());
    }
    let mut rgba = d.bytes((rows * ATLAS * 4) as usize)?.to_vec();
    rgba.resize((ATLAS * ATLAS * 4) as usize, 0);
    let check_sprite = |s: &GuiSprite| -> bool {
        s.x < ATLAS
            && s.y < rows
            && s.width <= ATLAS - s.x
            && s.height <= rows - s.y
            && match s.scaling {
                SpriteScaling::Stretch => true,
                SpriteScaling::Tile { width, height } => {
                    width > 0 && height > 0 && width <= 4096 && height <= 4096
                }
                SpriteScaling::NineSlice {
                    width,
                    height,
                    left,
                    right,
                    top,
                    bottom,
                    ..
                } => {
                    width > 0
                        && height > 0
                        && width <= 4096
                        && height <= 4096
                        && left <= width
                        && right <= width - left
                        && top <= height
                        && bottom <= height - top
                }
            }
    };
    if !meta
        .sprites
        .values()
        .chain(meta.items.values())
        .chain(
            meta.item_layers
                .values()
                .flat_map(|layers| layers.iter().map(|l| &l.sprite)),
        )
        .all(check_sprite)
        || !meta
            .glyphs
            .values()
            .chain(std::iter::once(&meta.missing_glyph))
            .all(|g| {
                check_sprite(&g.sprite)
                    && [
                        g.width,
                        g.height,
                        g.bearing_x,
                        g.bearing_y,
                        g.advance,
                        g.shadow_offset,
                        g.bold_offset,
                    ]
                    .iter()
                    .all(|f| f.is_finite() && f.abs() <= 256.)
            })
    {
        return Err("Invalid GUI cache sprite/glyph".into());
    }
    if meta.animations.len() > 1024
        || !meta.animations.values().all(|a| {
            !a.frames.is_empty()
                && a.frames.len() <= 1024
                && a.frames
                    .iter()
                    .all(|(s, t)| check_sprite(s) && *t > 0 && *t <= 10000)
                && a.frames.iter().map(|(_, t)| u64::from(*t)).sum::<u64>() == u64::from(a.duration)
        })
    {
        return Err("Invalid GUI animation cache".into());
    }
    let count = d.u32()? as usize;
    if count > 150000 || count > d.remaining() / 71 {
        return Err("Invalid Unicode cache count".into());
    }
    let mut unicode = HashMap::with_capacity(count);
    for _ in 0..count {
        let ch = char::from_u32(d.u32()?).ok_or("Invalid Unicode cache code point")?;
        let dimensions = d.bytes(3)?;
        let (width, left, right) = (dimensions[0], dimensions[1], dimensions[2]);
        if ![8, 16, 24, 32].contains(&width) || left > right || right >= width {
            return Err("Invalid Unicode cache dimensions".into());
        }
        let mut lines = [0; 16];
        for row in &mut lines {
            *row = d.u32()?;
            if width < 32 && *row >> width != 0 {
                return Err("Invalid Unicode cache row".into());
            }
        }
        if unicode
            .insert(
                ch,
                UniGlyph {
                    rows: lines,
                    width,
                    left,
                    right,
                },
            )
            .is_some()
        {
            return Err("Duplicate Unicode cache entry".into());
        }
    }
    if d.remaining() != 0 {
        return Err("Trailing GUI cache data".into());
    }
    Ok(GuiAssets {
        rgba,
        width: ATLAS,
        height: ATLAS,
        sprites: meta.sprites,
        animations: meta.animations,
        glyphs: meta.glyphs,
        items: meta.items,
        item_layers: meta.item_layers,
        item_models: meta.item_models,
        language: meta.language,
        sounds: meta.sounds,
        missing: meta.missing,
        cache_hit: true,
        unicode,
        missing_glyph: meta.missing_glyph,
        font: Mutex::new(GlyphCache::default()),
    })
}
struct GuiDecoder<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> GuiDecoder<'a> {
    fn bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self
            .at
            .checked_add(n)
            .filter(|end| *end <= self.bytes.len())
            .ok_or("Truncated GUI cache")?;
        let out = &self.bytes[self.at..end];
        self.at = end;
        Ok(out)
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    fn remaining(&self) -> usize {
        self.bytes.len() - self.at
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn metadata_preserves_nine_slice_borders_and_rejects_impossible_sizes() {
        assert_eq!(scaling(&json!({"gui":{"scaling":{"type":"nine_slice","width":200,"height":20,"border":3}}}),200,20).unwrap(),SpriteScaling::NineSlice{width:200,height:20,left:3,right:3,top:3,bottom:3,stretch_inner:false});
        assert!(
            scaling(
                &json!({"gui":{"scaling":{"type":"nine_slice","width":10,"height":10,"border":8}}}),
                10,
                10
            )
            .is_err()
        );
        assert_eq!(
            scaling(
                &json!({"gui":{"scaling":{"type":"tile","width":8,"height":8}}}),
                16,
                16
            )
            .unwrap(),
            SpriteScaling::Tile {
                width: 8,
                height: 8
            }
        );
    }
    #[test]
    fn unihex_preserves_original_pixels_and_metrics() {
        let line = format!("4E00:{}", "00FF".repeat(16));
        let (ch, g) = parse_unihex(line.as_bytes()).unwrap().unwrap();
        assert_eq!(ch, '一');
        assert_eq!((g.width, g.left, g.right), (16, 8, 15));
        let mut gui = GuiAssets::empty();
        gui.unicode.insert(ch, g);
        gui.begin_frame();
        let glyph = gui.glyph(ch);
        assert_eq!(glyph.width, 4.);
        assert_eq!(glyph.advance, 5.);
        assert_eq!(glyph.shadow_offset, 0.5);
        let uploads = gui.take_glyph_uploads();
        assert_eq!(uploads.len(), 1);
        assert_eq!(&uploads[0].rgba[..32], &[255; 32]);
        assert!(uploads[0].rgba[32..128].iter().all(|v| *v == 0));
        assert_eq!(gui.glyph(ch).sprite, glyph.sprite);
        assert!(gui.take_glyph_uploads().is_empty());
        assert!(parse_unihex(b"0041:FF").is_err());
    }
    #[test]
    fn unicode_cache_preserves_live_frame_glyphs_and_signals_eviction() {
        let (_, g) = parse_unihex(format!("4E00:{}", "FFFF".repeat(16)).as_bytes())
            .unwrap()
            .unwrap();
        let mut gui = GuiAssets::empty();
        gui.unicode.insert('一', g);
        {
            let mut c = gui.font.lock();
            c.epoch = 3;
            c.slots = vec![Some('A'); GLYPH_SLOTS];
            c.glyphs.insert('A', (Glyph::default(), 0, 2));
        }
        assert_eq!(gui.glyph('一').advance, 6.);
        assert_eq!(gui.font_generation(), 0); // previous frame is protected
        gui.begin_frame();
        assert_eq!(gui.glyph('一').advance, 9.);
        assert_eq!(gui.font_generation(), 1);
        assert_eq!(gui.take_glyph_uploads().len(), 1);
    }
    #[test]
    fn animation_uses_reference_frame_times_and_atlas_edges_stay_separate() {
        let mut atlas = AtlasBuilder::new();
        let image = RgbaImage::from_fn(2, 4, |_, y| {
            if y < 2 {
                image::Rgba([255, 0, 0, 255])
            } else {
                image::Rgba([0, 255, 0, 255])
            }
        });
        let a = pack_animation(
            &mut atlas,
            &image,
            SpriteScaling::Stretch,
            &json!({"frames":[{"index":0,"time":10},{"index":1,"time":4}]}),
        )
        .unwrap();
        assert_eq!(a.duration, 14);
        let mut gui = GuiAssets::empty();
        gui.animations.insert("test".into(), a.clone());
        assert_eq!(gui.sprite_at("test", 9), Some(a.frames[0].0));
        assert_eq!(gui.sprite_at("test", 10), Some(a.frames[1].0));
        assert_eq!(gui.sprite_at("test", 14), Some(a.frames[0].0));
        let s = a.frames[0].0;
        let offset = ((s.y * ATLAS + s.x - 1) * 4) as usize;
        assert_eq!(&atlas.rgba[offset..offset + 4], &[255, 0, 0, 255]);
    }
    #[test]
    fn gui_cache_bounds_and_checksum_are_verified() {
        let mut gui = GuiAssets::empty();
        gui.rgba = vec![0; (ATLAS * 4) as usize];
        gui.missing_glyph = Glyph::default();
        let key = [3; 32];
        let mut encoded = encode_cache(&gui, &key).unwrap();
        let decoded = decode_cache(&encoded, &key).unwrap();
        assert_eq!(decoded.width, ATLAS);
        assert!(decode_cache(&encoded, &[4; 32]).is_err());
        encoded[100] ^= 1;
        assert!(decode_cache(&encoded, &key).is_err());
        let mut encoded = encode_cache(&gui, &key).unwrap();
        encoded[76..80].copy_from_slice(&u32::MAX.to_le_bytes());
        let digest = Sha256::digest(&encoded[76..]);
        encoded[44..76].copy_from_slice(&digest);
        assert!(decode_cache(&encoded, &key).is_err());
    }
    #[test]
    #[ignore = "requires SAKURA_TEST_CLIENT_JAR pointing to a verified local26.1 client"]
    fn actual_reference_assets_round_trip() {
        let jar = PathBuf::from(
            std::env::var_os("SAKURA_TEST_CLIENT_JAR").expect("SAKURA_TEST_CLIENT_JAR"),
        );
        let cache = std::env::temp_dir().join(format!(
            "sakura-gui-acceptance-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&cache).unwrap();
        let hash: [u8; 32] =
            Sha256::digest(crate::assets::read_bounded(&jar, 64 * 1024 * 1024).unwrap()).into();
        let started = std::time::Instant::now();
        let cold = load(&jar, &cache, &hash).unwrap();
        let cold_ms = started.elapsed().as_millis();
        let started = std::time::Instant::now();
        let warm = load(&jar, &cache, &hash).unwrap();
        let warm_ms = started.elapsed().as_millis();
        assert!(!cold.cache_hit);
        assert!(warm.cache_hit);
        assert_eq!(cold.rgba, warm.rgba);
        assert_eq!(cold.unicode.len(), warm.unicode.len());
        assert!(cold.unicode.len() > 100000);
        assert!(cold.glyphs.len() > 2000);
        assert!(cold.items.len() > 1200);
        assert!(cold.missing.is_empty());
        let leather = cold.item_models["minecraft:leather_chestplate"];
        assert_eq!(leather, cold.item_models["leather_chestplate"]);
        assert_eq!(cold.item_layers[&leather][0].tint, ItemTintSource::Dye);
        let potion = cold.item_models["minecraft:potion"];
        assert_eq!(cold.item_layers[&potion][0].tint, ItemTintSource::Potion);
        assert!(cold.sprites.contains_key("mob_effect/regeneration"));
        assert_eq!(cold.text("gui.done"), "Done");
        assert_eq!(cold.glyph('A').advance, 6.);
        assert_eq!(cold.glyph(' ').advance, 4.);
        assert_eq!(cold.animations.len(), 5);
        assert!(cold.sprites.contains_key("misc/enchanted_glint_item"));
        assert_eq!(cold.sprites["sakura/internal/player_preview"].width, 128);
        let mut source = Resources::new(&jar, prepare_resources(&cache).unwrap()).unwrap();
        let original = source
            .png("assets/minecraft/textures/gui/container/inventory.png")
            .unwrap();
        let sprite = cold.sprites["gui/container/inventory"];
        for y in 0..original.height() {
            let offset = ((sprite.y + y) * ATLAS + sprite.x) as usize * 4;
            assert_eq!(
                &cold.rgba[offset..offset + original.width() as usize * 4],
                &original.as_raw()[y as usize * original.width() as usize * 4
                    ..(y + 1) as usize * original.width() as usize * 4]
            );
        }
        cold.begin_frame();
        for ch in "中文 日本語 한국어 😀".chars() {
            cold.glyph(ch);
        }
        assert!(!cold.take_glyph_uploads().is_empty());
        println!(
            "GUI_ACCEPTANCE cold_ms={cold_ms} warm_ms={warm_ms} sprites={} bitmap={} unicode={} items={} missing={} cache={}",
            cold.sprites.len(),
            cold.glyphs.len(),
            cold.unicode.len(),
            cold.items.len(),
            cold.missing.len(),
            cache.display()
        );
    }
}
