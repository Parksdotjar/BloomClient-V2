//! Version-matched, local Minecraft assets. Cold loading bakes JSON once; warm
//! loading reads a bounded, checksummed binary cache without decoding PNG/JSON.
//! No archive member is ever extracted and no network request is made here.

use azalea_block::{BlockState, BlockTrait};
use azalea_registry::{Registry, builtin::ItemKind};
use image::{ImageDecoder, ImageReader, RgbaImage};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Cursor, Read, Write},
    path::Path,
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

// Bump for any change to the serialized layout OR model/material baking rules.
const SCHEMA: u32 = 7;
const TILE: u32 = 16;
const MAX_LAYERS: usize = 2048;
const MAX_CACHE: usize = 128 * 1024 * 1024;
const MAX_QUADS: usize = 4096;
const MAX_TOTAL_QUADS: usize = 500_000;
const MAX_ENTITY_LAYERS: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Face {
    East,
    West,
    Up,
    Down,
    South,
    North,
}
impl Face {
    pub fn offset(self) -> [i32; 3] {
        match self {
            Self::East => [1, 0, 0],
            Self::West => [-1, 0, 0],
            Self::Up => [0, 1, 0],
            Self::Down => [0, -1, 0],
            Self::South => [0, 0, 1],
            Self::North => [0, 0, -1],
        }
    }
    fn parse(s: &str) -> Option<Self> {
        match s {
            "east" => Some(Self::East),
            "west" => Some(Self::West),
            "up" => Some(Self::Up),
            "down" => Some(Self::Down),
            "south" => Some(Self::South),
            "north" => Some(Self::North),
            _ => None,
        }
    }
}
const FACES: [Face; 6] = [
    Face::East,
    Face::West,
    Face::Up,
    Face::Down,
    Face::South,
    Face::North,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum RenderLayer {
    Opaque,
    Cutout,
    Translucent,
}

#[derive(Clone, Debug)]
pub struct BakedQuad {
    pub shade: bool,
    pub ambient_occlusion: bool,
    pub positions: [[f32; 3]; 4],
    pub uv: [[f32; 2]; 4],
    pub layer: u32,
    pub cull_face: Option<Face>,
    pub tint: [f32; 3],
    pub render_layer: RenderLayer,
}

#[derive(Debug)]
pub struct BlockModel {
    pub quads: Vec<BakedQuad>,
    pub opaque_full_cube: bool,
    pub cull_group: u16,
}

pub struct AssetPack {
    /// Original Java rain/snow textures, two 64 x 256 RGBA layers.
    pub weather_rgba: Vec<u8>,
    pub biome_colormaps: Vec<u8>,
    pub gui: Arc<crate::gui_assets::GuiAssets>,
    pub textures_rgba: Vec<u8>,
    pub texture_size: u32,
    pub texture_layers: u32,
    pub models: Vec<Arc<BlockModel>>,
    pub font_layers: [u32; 128],
    pub font_widths: [f32; 128],
    pub default_skin_rgba: Vec<u8>,
    pub default_skin_size: [u32; 2],
    pub item_textures: HashMap<u32, u32>,
    /// Original entity texels, padded (not resized) into a separate 64px array.
    pub entity_textures_rgba: Vec<u8>,
    pub entity_texture_size: u32,
    pub entity_texture_layers: u32,
    pub entity_textures: HashMap<String, u32>,
    pub cache_hit: bool,
    pub load_ms: u64,
    /// Models intentionally requiring a block-entity renderer, not cube substitutes.
    pub unsupported_block_models: usize,
}

#[derive(Clone, Default)]
struct Model {
    disable_ao: bool,
    textures: HashMap<String, String>,
    translucent_textures: std::collections::HashSet<String>,
    elements: Vec<Value>,
    gui: Value,
    generated: bool,
    front_light: bool,
}

struct Baker {
    zip: zip::ZipArchive<File>,
    json: HashMap<String, Arc<Value>>,
    models: HashMap<String, Arc<Model>>,
    textures: HashMap<String, (u32, RenderLayer)>,
    rgba: Vec<u8>,
    decoded_bytes: usize,
    entity_pngs: HashMap<String, Arc<RgbaImage>>,
}

impl Baker {
    fn new(path: &Path) -> Result<Self, String> {
        let zip = zip::ZipArchive::new(File::open(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if zip.len() > 100_000 {
            return Err("Asset archive contains too many members".into());
        }
        Ok(Self {
            zip,
            json: HashMap::new(),
            models: HashMap::new(),
            textures: HashMap::new(),
            rgba: Vec::new(),
            decoded_bytes: 0,
            entity_pngs: HashMap::new(),
        })
    }
    fn read(&mut self, path: &str, cap: usize) -> Result<Vec<u8>, String> {
        let mut entry = self
            .zip
            .by_name(path)
            .map_err(|_| format!("Missing Minecraft asset: {path}"))?;
        if entry.size() > cap as u64 {
            return Err(format!("Oversized Minecraft asset: {path}"));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .by_ref()
            .take(cap as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > cap {
            return Err("Asset decompression limit exceeded".into());
        }
        self.decoded_bytes += bytes.len();
        if self.decoded_bytes > 256 * 1024 * 1024 {
            return Err("Total asset decoding budget exceeded".into());
        }
        Ok(bytes)
    }
    fn json_path(&mut self, path: &str) -> Result<Arc<Value>, String> {
        if let Some(v) = self.json.get(path) {
            return Ok(v.clone());
        }
        let v: Arc<Value> = Arc::new(
            serde_json::from_slice(&self.read(path, 1024 * 1024)?)
                .map_err(|e| format!("Invalid asset JSON {path}: {e}"))?,
        );
        self.json.insert(path.into(), v.clone());
        Ok(v)
    }
    fn model(&mut self, name: &str, depth: usize) -> Result<Arc<Model>, String> {
        let name = resource(name)?;
        if let Some(model) = self.models.get(&name) {
            return Ok(model.clone());
        }
        if depth >= 32 {
            return Err(format!("Model parent cycle/depth limit: {name}"));
        }
        if name.ends_with(":builtin/entity") || name.ends_with(":builtin/generated") {
            return Ok(Arc::new(Model {
                generated: name.ends_with(":builtin/generated"),
                ..Model::default()
            }));
        }
        let path = asset_path(&name, "models", "json")?;
        let value = self.json_path(&path)?;
        let mut model = if let Some(parent) = value["parent"].as_str() {
            (*self.model(parent, depth + 1)?).clone()
        } else {
            Model::default()
        };
        if let Some(textures) = value["textures"].as_object() {
            for (key, value) in textures {
                if let Some(sprite) = value.as_str().or_else(|| value["sprite"].as_str()) {
                    model.textures.insert(key.clone(), sprite.into());
                    if value["force_translucent"].as_bool().unwrap_or(false) {
                        model.translucent_textures.insert(key.clone());
                    } else {
                        model.translucent_textures.remove(key);
                    }
                }
            }
        }
        if let Some(ao)=value["ambientocclusion"].as_bool(){model.disable_ao=!ao;}
        if let Some(elements) = value["elements"].as_array() {
            if elements.len() > 512 {
                return Err("Too many elements in block model".into());
            }
            model.elements = elements.clone();
        }
        if value["display"]["gui"].is_object() {
            model.gui = value["display"]["gui"].clone();
        }
        if let Some(light) = value["gui_light"].as_str() {
            model.front_light = light == "front";
        }
        let model = Arc::new(model);
        self.models.insert(name, model.clone());
        Ok(model)
    }
    fn png(&mut self, path: &str) -> Result<RgbaImage, String> {
        let bytes = self.read(path, 4 * 1024 * 1024)?;
        let decoder = ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png)
            .into_decoder()
            .map_err(|e| e.to_string())?;
        let (w, h) = decoder.dimensions();
        if w == 0 || h == 0 || w > 2048 || h > 16384 || (w as u64 * h as u64) > 4_194_304 {
            return Err("PNG dimensions exceed asset limits".into());
        }
        image::DynamicImage::from_decoder(decoder)
            .map(|i| i.to_rgba8())
            .map_err(|e| e.to_string())
    }
    fn push_tile(&mut self, tile: &RgbaImage) -> Result<u32, String> {
        let layer = self.rgba.len() / (TILE * TILE * 4) as usize;
        if layer >= MAX_LAYERS {
            return Err("Texture array exceeds the supported 2048-layer budget".into());
        }
        self.rgba.extend(
            image::imageops::resize(tile, TILE, TILE, image::imageops::FilterType::Nearest)
                .into_raw(),
        );
        Ok(layer as u32)
    }
    fn texture(&mut self, name: &str) -> Result<(u32, RenderLayer), String> {
        let name = resource(name)?;
        if let Some(v) = self.textures.get(&name) {
            return Ok(*v);
        }
        let image = self.png(&asset_path(&name, "textures", "png")?)?;
        // Vanilla animated terrain textures are vertically stacked square frames.
        // Keep the first actual frame; animation later belongs in a GPU UV table.
        let tile = image::imageops::crop_imm(
            &image,
            0,
            0,
            image.width(),
            image.width().min(image.height()),
        )
        .to_image();
        let mut render = RenderLayer::Opaque;
        for p in tile.pixels() {
            if p[3] > 0 && p[3] < 255 {
                render = RenderLayer::Translucent;
                break;
            }
            if p[3] == 0 {
                render = RenderLayer::Cutout;
            }
        }
        let layer = self.push_tile(&tile)?;
        self.textures.insert(name, (layer, render));
        Ok((layer, render))
    }
}

fn resource(name: &str) -> Result<String, String> {
    let (ns, path) = name.split_once(':').unwrap_or(("minecraft", name));
    if name.len() > 256
        || ns.is_empty()
        || path.is_empty()
        || !ns
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"_.-".contains(&c))
        || !path
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"_/.-".contains(&c))
        || path
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
    {
        return Err("Invalid Minecraft asset identifier".into());
    }
    Ok(format!("{ns}:{path}"))
}
fn asset_path(name: &str, category: &str, extension: &str) -> Result<String, String> {
    let name = resource(name)?;
    let (ns, path) = name.split_once(':').unwrap();
    Ok(format!("assets/{ns}/{category}/{path}.{extension}"))
}
fn resolve_texture(model: &Model, name: &str) -> Result<String, String> {
    let mut name = name;
    for _ in 0..32 {
        // Some official 26.1 faces (heavy_core) use an unprefixed local slot.
        let Some(key) = name
            .strip_prefix('#')
            .or_else(|| model.textures.contains_key(name).then_some(name))
        else {
            return resource(name);
        };
        name = model
            .textures
            .get(key)
            .ok_or_else(|| format!("Missing model texture variable: {key}"))?;
    }
    Err("Texture alias cycle/depth limit".into())
}

fn force_translucent(model: &Model, name: &str) -> bool {
    let mut name = name;
    for _ in 0..32 {
        let Some(key) = name
            .strip_prefix('#')
            .or_else(|| model.textures.contains_key(name).then_some(name))
        else {
            return false;
        };
        if model.translucent_textures.contains(key) {
            return true;
        }
        let Some(next) = model.textures.get(key) else {
            return false;
        };
        name = next;
    }
    false
}

type Properties = HashMap<&'static str, &'static str>;
fn value_matches(actual: Option<&&str>, expected: &str) -> bool {
    let Some(actual) = actual else {
        return false;
    };
    if let Some(not) = expected.strip_prefix('!') {
        return !not.split('|').any(|v| v == *actual);
    }
    expected.split('|').any(|v| v == *actual)
}
fn condition_matches(value: &Value, properties: &Properties, depth: usize) -> bool {
    if depth > 16 {
        return false;
    }
    let Some(object) = value.as_object() else {
        return false;
    };
    object.iter().all(|(key, value)| match key.as_str() {
        "OR" => value.as_array().is_some_and(|values| {
            values
                .iter()
                .any(|v| condition_matches(v, properties, depth + 1))
        }),
        "AND" => value.as_array().is_some_and(|values| {
            values
                .iter()
                .all(|v| condition_matches(v, properties, depth + 1))
        }),
        _ => value
            .as_str()
            .is_some_and(|v| value_matches(properties.get(key.as_str()), v)),
    })
}
fn selections<'a>(state: &'a Value, properties: &Properties) -> Vec<&'a Value> {
    let mut out = Vec::new();
    if let Some(variants) = state["variants"].as_object() {
        for (key, choice) in variants {
            if key.is_empty()
                || key.split(',').all(|pair| {
                    pair.split_once('=')
                        .is_some_and(|(k, v)| value_matches(properties.get(k), v))
                })
            {
                // Select a stable weighted alternative. Position-dependent variation
                // requires a separate renderer selector, not random bake-time assets.
                out.push(choice.as_array().and_then(|v| v.first()).unwrap_or(choice));
                break;
            }
        }
    }
    if let Some(parts) = state["multipart"].as_array() {
        for part in parts {
            if part
                .get("when")
                .is_none_or(|v| condition_matches(v, properties, 0))
            {
                let choice = &part["apply"];
                out.push(choice.as_array().and_then(|v| v.first()).unwrap_or(choice));
            }
        }
    }
    out
}

fn vec3(value: &Value, fallback: [f32; 3]) -> Result<[f32; 3], String> {
    let Some(a) = value.as_array() else {
        return Ok(fallback);
    };
    if a.len() != 3 {
        return Err("Invalid model vector".into());
    }
    let mut out = [0.; 3];
    for i in 0..3 {
        out[i] = a[i].as_f64().ok_or("Invalid model coordinate")? as f32;
        if !out[i].is_finite() || out[i].abs() > 256. {
            return Err("Model coordinate exceeds limits".into());
        }
    }
    Ok(out)
}
fn rotate(v: [f32; 3], axis: usize, degrees: f32) -> [f32; 3] {
    let (s, c) = degrees.to_radians().sin_cos();
    let [x, y, z] = v;
    match axis {
        0 => [x, y * c - z * s, y * s + z * c],
        1 => [x * c + z * s, y, -x * s + z * c],
        _ => [x * c - y * s, x * s + y * c, z],
    }
}
fn state_rotate(v: [f32; 3], x: f32, y: f32) -> [f32; 3] {
    rotate(rotate(v, 0, -x), 1, -y)
}
fn rotate_face(face: Face, x: f32, y: f32) -> Face {
    let v = state_rotate(face.offset().map(|v| v as f32), x, y);
    *FACES
        .iter()
        .max_by(|a, b| {
            dot(a.offset().map(|v| v as f32), v).total_cmp(&dot(b.offset().map(|v| v as f32), v))
        })
        .unwrap()
}
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn basis(face: Face) -> ([f32; 3], [f32; 3]) {
    match face {
        Face::East => ([0., 0., -1.], [0., -1., 0.]),
        Face::West => ([0., 0., 1.], [0., -1., 0.]),
        Face::Up => ([1., 0., 0.], [0., 0., 1.]),
        Face::Down => ([1., 0., 0.], [0., 0., -1.]),
        Face::South => ([1., 0., 0.], [0., -1., 0.]),
        Face::North => ([-1., 0., 0.], [0., -1., 0.]),
    }
}
fn positions(face: Face, from: [f32; 3], to: [f32; 3]) -> [[f32; 3]; 4] {
    let [a, b, c] = from;
    let [x, y, z] = to;
    match face {
        Face::East => [[x, y, z], [x, b, z], [x, b, c], [x, y, c]],
        Face::West => [[a, y, c], [a, b, c], [a, b, z], [a, y, z]],
        Face::Up => [[a, y, c], [a, y, z], [x, y, z], [x, y, c]],
        Face::Down => [[a, b, z], [a, b, c], [x, b, c], [x, b, z]],
        Face::South => [[a, y, z], [a, b, z], [x, b, z], [x, y, z]],
        Face::North => [[x, y, c], [x, b, c], [a, b, c], [a, y, c]],
    }
}
fn default_uv(face: Face, from: [f32; 3], to: [f32; 3]) -> [f32; 4] {
    let [a, b, c] = from;
    let [x, y, z] = to;
    match face {
        Face::Down => [a, 16. - z, x, 16. - c],
        Face::Up => [a, c, x, z],
        Face::North => [16. - x, 16. - y, 16. - a, 16. - b],
        Face::South => [a, 16. - y, x, 16. - b],
        Face::West => [c, 16. - y, z, 16. - b],
        Face::East => [16. - z, 16. - y, 16. - c, 16. - b],
    }
}
fn tint(name: &str, properties: &Properties) -> [f32; 3] {
    let rgb = if name == "redstone_wire" {
        let power = properties
            .get("power")
            .and_then(|p| p.parse::<u32>().ok())
            .unwrap_or(0) as f32
            / 15.;
        return [
            if power == 0. { 0.3 } else { power * 0.6 + 0.4 },
            (power * power * 0.7 - 0.5).max(0.),
            (power * power * 0.6 - 0.7).max(0.),
        ];
    } else if name.contains("spruce") {
        0x619961
    } else if name.contains("birch") {
        0x80a755
    } else if name.contains("leaves") || name.contains("vine") {
        0x77ab2f
    } else if name == "water" || name.contains("cauldron") {
        0x3f76e4
    } else if name == "lily_pad" {
        0x208030
    } else if name.contains("stem") {
        0x70a000
    } else {
        0x91bd59
    };
    [
        ((rgb >> 16) & 255) as f32 / 255.,
        ((rgb >> 8) & 255) as f32 / 255.,
        (rgb & 255) as f32 / 255.,
    ]
}
fn translucent(name: &str) -> bool {
    name.contains("stained_glass")
        || matches!(
            name,
            "glass"
                | "glass_pane"
                | "tinted_glass"
                | "ice"
                | "frosted_ice"
                | "slime_block"
                | "honey_block"
                | "nether_portal"
        )
}
fn complete_face(quad: &BakedQuad, face: Face) -> bool {
    if quad.render_layer != RenderLayer::Opaque {
        return false;
    }
    let expected = positions(face, [0.; 3], [1.; 3]);
    expected.iter().all(|p| {
        quad.positions
            .iter()
            .any(|q| (0..3).all(|i| (p[i] - q[i]).abs() < 0.0001))
    })
}
impl Baker {
    fn bake_choice(
        &mut self,
        choice: &Value,
        name: &str,
        properties: &Properties,
        out: &mut Vec<BakedQuad>,
    ) -> Result<(), String> {
        let id = choice["model"].as_str().ok_or("Blockstate has no model")?;
        let model = self.model(id, 0)?;
        let x = choice["x"].as_i64().unwrap_or(0);
        let y = choice["y"].as_i64().unwrap_or(0);
        if ![0, 90, 180, 270].contains(&x) || ![0, 90, 180, 270].contains(&y) {
            return Err("Invalid blockstate rotation".into());
        }
        let (x, y) = (x as f32, y as f32);
        let uvlock = choice["uvlock"].as_bool().unwrap_or(false);
        for element in &model.elements {
            let from = vec3(&element["from"], [0.; 3])?;
            let to = vec3(&element["to"], [16.; 3])?;
            let Some(faces) = element["faces"].as_object() else {
                continue;
            };
            for (direction, face_data) in faces {
                let Some(face) = Face::parse(direction) else {
                    continue;
                };
                let texture_id = face_data["texture"]
                    .as_str()
                    .ok_or("Model face has no texture")?;
                let texture = resolve_texture(&model, texture_id)?;
                let (layer, mut render_layer) = self.texture(&texture)?;
                if translucent(name) || force_translucent(&model, texture_id) {
                    render_layer = RenderLayer::Translucent;
                }
                let mut points = positions(face, from.map(|v| v / 16.), to.map(|v| v / 16.));
                if let Some(rotation) = element.get("rotation") {
                    let origin = vec3(&rotation["origin"], [8.; 3])?.map(|v| v / 16.);
                    let axis = match rotation["axis"].as_str() {
                        Some("x") => 0,
                        Some("y") => 1,
                        Some("z") => 2,
                        _ => return Err("Invalid element rotation axis".into()),
                    };
                    let angle = rotation["angle"]
                        .as_f64()
                        .ok_or("Invalid element rotation angle")?
                        as f32;
                    if !angle.is_finite() || angle.abs() > 45. {
                        return Err("Element rotation exceeds supported range".into());
                    }
                    let rescale = if rotation["rescale"].as_bool().unwrap_or(false) {
                        1. / angle.to_radians().cos()
                    } else {
                        1.
                    };
                    for point in &mut points {
                        let mut p = std::array::from_fn(|i| point[i] - origin[i]);
                        p = rotate(p, axis, angle);
                        for i in 0..3 {
                            point[i] = origin[i] + p[i] * if i == axis { 1. } else { rescale };
                        }
                    }
                }
                for point in &mut points {
                    *point = state_rotate(point.map(|v| v - 0.5), x, y).map(|v| v + 0.5);
                }
                let mut rectangle = default_uv(face, from, to);
                if let Some(a) = face_data["uv"].as_array() {
                    if a.len() != 4 {
                        return Err("Invalid face UV rectangle".into());
                    }
                    for i in 0..4 {
                        rectangle[i] = a[i].as_f64().ok_or("Invalid UV coordinate")? as f32;
                        if !rectangle[i].is_finite() || rectangle[i].abs() > 256. {
                            return Err("UV coordinate exceeds limits".into());
                        }
                    }
                }
                let [u0, v0, u1, v1] = rectangle.map(|v| v / 16.);
                let mut uv = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
                let rotation = face_data["rotation"].as_u64().unwrap_or(0);
                if ![0, 90, 180, 270].contains(&rotation) {
                    return Err("Invalid face UV rotation".into());
                }
                uv.rotate_left((rotation / 90) as usize);
                if uvlock {
                    let (u, v) = basis(face);
                    let (target_u, target_v) = basis(rotate_face(face, x, y));
                    let (u, v) = (state_rotate(u, x, y), state_rotate(v, x, y));
                    for p in &mut uv {
                        let t: [f32; 3] =
                            std::array::from_fn(|i| u[i] * (p[0] - 0.5) + v[i] * (p[1] - 0.5));
                        *p = [dot(t, target_u) + 0.5, dot(t, target_v) + 0.5];
                    }
                }
                out.push(BakedQuad {
                    shade: element["shade"].as_bool().unwrap_or(true), ambient_occlusion: !model.disable_ao,
                    positions: points,
                    uv,
                    layer,
                    cull_face: face_data["cullface"]
                        .as_str()
                        .and_then(Face::parse)
                        .map(|f| rotate_face(f, x, y)),
                    tint: if face_data["tintindex"].as_i64().is_some_and(|v| v >= 0) {
                        tint(name, properties)
                    } else {
                        [1.; 3]
                    },
                    render_layer,
                });
                if out.len() > MAX_QUADS {
                    return Err("Block model exceeds quad budget".into());
                }
            }
        }
        Ok(())
    }
    fn fluid(&mut self, name: &str, properties: &Properties) -> Result<BlockModel, String> {
        let level = properties
            .get("level")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        let height = if level >= 8 {
            8. / 9.
        } else {
            (8 - level) as f32 / 9.
        };
        let (layer, _) = self.texture(&format!("block/{name}_still"))?;
        Ok(BlockModel {
            quads: FACES
                .into_iter()
                .map(|face| BakedQuad {
                    shade: true, ambient_occlusion: true,
                    positions: positions(face, [0.; 3], [1., height, 1.]),
                    uv: [[0., 0.], [0., 1.], [1., 1.], [1., 0.]],
                    layer,
                    cull_face: Some(face),
                    tint: if name == "water" {
                        tint(name, properties)
                    } else {
                        [1.; 3]
                    },
                    render_layer: if name == "water" {
                        RenderLayer::Translucent
                    } else {
                        RenderLayer::Opaque
                    },
                })
                .collect(),
            opaque_full_cube: false,
            cull_group: if name == "water" { 1 } else { 2 },
        })
    }

    fn chest(&mut self, name: &str, properties: &Properties) -> Result<BlockModel, String> {
        self.chest_skin(name, properties, None)
    }
    fn chest_skin(
        &mut self,
        name: &str,
        properties: &Properties,
        override_skin: Option<&str>,
    ) -> Result<BlockModel, String> {
        let chest_type = if name == "ender_chest" {
            "single"
        } else {
            properties.get("type").copied().unwrap_or("single")
        };
        let skin = override_skin.unwrap_or(match name {
            "trapped_chest" => "trapped",
            "ender_chest" => "ender",
            _ => "normal",
        });
        let skin = if chest_type == "single" {
            skin.to_owned()
        } else {
            format!("{skin}_{chest_type}")
        };
        let path = format!("assets/minecraft/textures/entity/chest/{skin}.png");
        let bitmap = if let Some(image) = self.entity_pngs.get(&path) {
            image.clone()
        } else {
            let image = Arc::new(self.png(&path)?);
            self.entity_pngs.insert(path.clone(), image.clone());
            image
        };
        if bitmap.dimensions() != (64, 64) {
            return Err("Unexpected chest skin dimensions".into());
        }
        // Measurements/UVs match 26.1 ChestModel's closed single/left/right meshes.
        let (x, width, lock_x, lock_width, joined) = match chest_type {
            "left" => (0., 15., 0., 1., Some(Face::West)),
            "right" => (1., 15., 15., 1., Some(Face::East)),
            _ => (1., 14., 7., 2., None),
        };
        let yaw = match properties.get("facing").copied().unwrap_or("south") {
            "west" => 90.,
            "north" => 180.,
            "east" => 270.,
            _ => 0.,
        };
        let cubes = [
            ([x, 0., 1.], [width, 10., 14.], [0., 19.]),
            ([x, 9., 1.], [width, 5., 14.], [0., 0.]),
            ([lock_x, 7., 15.], [lock_width, 4., 1.], [0., 0.]),
        ];
        let mut quads = Vec::new();
        for (from, size, uv) in cubes {
            for (face, q) in FACES
                .into_iter()
                .zip(crate::mob_models::cuboid_quads(from, size, uv))
            {
                if Some(face) == joined {
                    continue;
                }
                let min_u =
                    q.uv.iter()
                        .map(|p| p[0] * 64.)
                        .fold(f32::INFINITY, f32::min)
                        .round() as u32;
                let max_u = q.uv.iter().map(|p| p[0] * 64.).fold(0., f32::max).round() as u32;
                let min_v =
                    q.uv.iter()
                        .map(|p| p[1] * 64.)
                        .fold(f32::INFINITY, f32::min)
                        .round() as u32;
                let max_v = q.uv.iter().map(|p| p[1] * 64.).fold(0., f32::max).round() as u32;
                let (w, h) = (max_u - min_u, max_v - min_v);
                if w == 0 || h == 0 || w > TILE || h > TILE || max_u > 64 || max_v > 64 {
                    return Err("Invalid chest UV patch".into());
                }
                let key = format!("@chest/{skin}/{min_u},{min_v},{max_u},{max_v}");
                let layer = if let Some((layer, _)) = self.textures.get(&key) {
                    *layer
                } else {
                    let cropped =
                        image::imageops::crop_imm(&*bitmap, min_u, min_v, w, h).to_image();
                    let mut tile = RgbaImage::new(TILE, TILE);
                    image::imageops::replace(&mut tile, &cropped, 0, 0);
                    let layer = self.push_tile(&tile)?;
                    self.textures.insert(key, (layer, RenderLayer::Cutout));
                    layer
                };
                quads.push(BakedQuad {
                    shade: true, ambient_occlusion: true,
                    positions: q
                        .positions
                        .map(|p| state_rotate(p.map(|v| v / 16. - 0.5), 0., yaw).map(|v| v + 0.5)),
                    uv: q.uv.map(|p| {
                        [
                            (p[0] * 64. - min_u as f32) / 16.,
                            (p[1] * 64. - min_v as f32) / 16.,
                        ]
                    }),
                    layer,
                    cull_face: None,
                    tint: [1.; 3],
                    render_layer: RenderLayer::Cutout,
                });
            }
        }
        Ok(BlockModel {
            quads,
            opaque_full_cube: false,
            cull_group: 0,
        })
    }
    fn font(
        &mut self,
        id: &str,
        depth: usize,
        layers: &mut [u32; 128],
        widths: &mut [f32; 128],
    ) -> Result<(), String> {
        if depth > 8 {
            return Err("Font reference depth exceeded".into());
        }
        let font = self.json_path(&asset_path(id, "font", "json")?)?;
        let Some(providers) = font["providers"].as_array() else {
            return Ok(());
        };
        for provider in providers {
            match provider["type"].as_str() {
                Some("reference") => self.font(
                    provider["id"].as_str().ok_or("Missing font reference")?,
                    depth + 1,
                    layers,
                    widths,
                )?,
                Some("bitmap") => {
                    let Some(rows) = provider["chars"].as_array() else {
                        continue;
                    };
                    if rows.is_empty() || rows.len() > 512 {
                        continue;
                    }
                    let rows: Vec<Vec<char>> = rows
                        .iter()
                        .map(|r| r.as_str().unwrap_or("").chars().collect())
                        .collect();
                    if !rows.iter().flatten().any(|c| *c >= '!' && *c <= '~') {
                        continue;
                    }
                    let cols = rows[0].len();
                    if cols == 0 || cols > 512 || rows.iter().any(|r| r.len() != cols) {
                        return Err("Invalid bitmap font grid".into());
                    }
                    let file = provider["file"]
                        .as_str()
                        .ok_or("Missing font bitmap")?
                        .trim_end_matches(".png");
                    let bitmap = self.png(&asset_path(file, "textures", "png")?)?;
                    if bitmap.width() % cols as u32 != 0 || bitmap.height() % rows.len() as u32 != 0
                    {
                        return Err("Invalid font bitmap dimensions".into());
                    }
                    let (w, h) = (
                        bitmap.width() / cols as u32,
                        bitmap.height() / rows.len() as u32,
                    );
                    for (y, row) in rows.iter().enumerate() {
                        for (x, ch) in row.iter().enumerate() {
                            if !ch.is_ascii() || *ch < '!' || *ch > '~' {
                                continue;
                            }
                            let tile = image::imageops::crop_imm(
                                &bitmap,
                                x as u32 * w,
                                y as u32 * h,
                                w,
                                h,
                            )
                            .to_image();
                            let visible_width = (0..w)
                                .rev()
                                .find(|x| (0..h).any(|y| tile.get_pixel(*x, y)[3] > 0))
                                .map_or(0, |x| x + 1);
                            layers[*ch as usize] = self.push_tile(&tile)?;
                            widths[*ch as usize] = (visible_width + 1) as f32 / w as f32;
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}

fn bake(jar: &Path) -> Result<AssetPack, String> {
    let mut baker = Baker::new(jar)?;
    let version = baker.json_path("version.json")?;
    if version["id"].as_str() != Some("26.1") {
        return Err("Sakura needs the official Minecraft 26.1 client JAR; this asset version does not match its protocol".into());
    }
    // Layer zero is transparent: spaces/control characters must not draw terrain.
    baker.push_tile(&RgbaImage::new(TILE, TILE))?;
    let mut font_layers = [0; 128];
    let mut font_widths = [0.5; 128];
    baker.font("default", 0, &mut font_layers, &mut font_widths)?;
    if (33..127).any(|c| font_layers[c] == 0) {
        return Err("Minecraft ASCII bitmap font is incomplete".into());
    }
    let skin = baker.png("assets/minecraft/textures/entity/player/wide/steve.png")?;
    if skin.dimensions() != (64, 64) {
        return Err("Unexpected default player skin dimensions".into());
    }
    let mut models = Vec::with_capacity(BlockState::MAX_STATE as usize + 1);
    let empty = Arc::new(BlockModel {
        quads: Vec::new(),
        opaque_full_cube: false,
        cull_group: 0,
    });
    let mut geometry: HashMap<String, Arc<BlockModel>> = HashMap::new();
    let mut block_icons = HashMap::new();
    let mut unsupported = std::collections::HashSet::new();
    let mut groups = HashMap::<String, u16>::new();
    let mut total_quads = 0;
    for id in 0..=BlockState::MAX_STATE {
        let state =
            BlockState::try_from(id).map_err(|_| "Invalid baked-in block state registry")?;
        let block = Box::<dyn BlockTrait>::from(state);
        let name = block.id();
        if matches!(
            name,
            "air" | "cave_air" | "void_air" | "structure_void" | "barrier" | "light"
        ) {
            models.push(empty.clone());
            continue;
        }
        let properties = block.property_map();
        let definition = baker.json_path(&format!("assets/minecraft/blockstates/{name}.json"))?;
        let choices = selections(&definition, &properties);
        // Irrelevant block-state properties share exactly one allocation/quad list.
        let choice_ids: Vec<usize> = choices
            .iter()
            .map(|v| *v as *const Value as usize)
            .collect();
        let key = if matches!(name, "chest" | "trapped_chest" | "ender_chest") {
            format!(
                "{name}:{}:{}",
                properties.get("facing").unwrap_or(&"south"),
                properties.get("type").unwrap_or(&"single")
            )
        } else if name == "water" || name == "lava" {
            format!("{name}:{}", properties.get("level").unwrap_or(&"0"))
        } else {
            format!(
                "{name}:{choice_ids:?}:{:?}",
                tint(name, &properties).map(f32::to_bits)
            )
        };
        if let Some(model) = geometry.get(&key) {
            models.push(model.clone());
            continue;
        }
        let model = if matches!(name, "chest" | "trapped_chest" | "ender_chest") {
            baker.chest(name, &properties)?
        } else if name == "water" || name == "lava" {
            baker.fluid(name, &properties)?
        } else {
            let mut quads = Vec::new();
            for choice in choices {
                baker
                    .bake_choice(choice, name, &properties, &mut quads)
                    .map_err(|e| format!("Block {name}: {e}"))?;
            }
            let opaque_full_cube = FACES
                .iter()
                .all(|face| quads.iter().any(|q| complete_face(q, *face)));
            let cull_group = if translucent(name) {
                let next = groups.len() as u16 + 3;
                *groups.entry(name.into()).or_insert(next)
            } else {
                0
            };
            if quads.is_empty() {
                unsupported.insert(name);
            }
            BlockModel {
                quads,
                opaque_full_cube,
                cull_group,
            }
        };
        total_quads += model.quads.len();
        if total_quads > MAX_TOTAL_QUADS {
            return Err("Combined block geometry exceeds asset budget".into());
        }
        if let Some(icon) = model
            .quads
            .iter()
            .find(|q| q.cull_face == Some(Face::Up))
            .or(model.quads.first())
        {
            block_icons.entry(name.to_owned()).or_insert(icon.layer);
        }
        let model = Arc::new(model);
        geometry.insert(key, model.clone());
        models.push(model);
    }
    let mut item_textures = HashMap::new();
    for id in 0..4096 {
        let Some(item) = ItemKind::from_u32(id) else {
            break;
        };
        let name = item.to_str();
        let name = name.strip_prefix("minecraft:").unwrap_or(name);
        let path = format!("assets/minecraft/textures/item/{name}.png");
        if baker.zip.index_for_name(&path).is_some() {
            let (layer, _) = baker.texture(&format!("item/{name}"))?;
            item_textures.insert(id, layer);
        } else if let Some(layer) = block_icons.get(name) {
            item_textures.insert(id, *layer);
        }
    }
    let entity_size = crate::mob_models::TEXTURE_SIZE;
    let mut entity_textures = HashMap::new();
    let mut entity_rgba = Vec::new();
    for name in crate::mob_models::texture_catalog() {
        if entity_textures.len() >= MAX_ENTITY_LAYERS {
            return Err("Entity texture budget exceeded".into());
        }
        let bitmap = baker.png(&if name=="shadow" {"assets/minecraft/textures/misc/shadow.png".into()}else{format!("assets/minecraft/textures/entity/{name}.png")})?;
        if bitmap.width() > entity_size || bitmap.height() > entity_size {
            return Err(format!(
                "Entity skin exceeds its verified model dimensions: {name}"
            ));
        }
        let mut tile = RgbaImage::new(entity_size, entity_size);
        image::imageops::replace(&mut tile, &bitmap, 0, 0);
        entity_textures.insert(name.clone(), entity_textures.len() as u32);
        entity_rgba.extend(tile.into_raw());
    }
    let mut biome_colormaps=Vec::with_capacity(256*256*4*2);
    for name in ["grass","foliage"] {
        let image=baker.png(&format!("assets/minecraft/textures/colormap/{name}.png"))?;
        if image.dimensions()!=(256,256) {return Err("Unsupported biome colormap size".into());}
        biome_colormaps.extend(image.into_raw());
    }
    let mut weather_rgba = Vec::with_capacity(64*256*4*2);
    for name in ["rain", "snow"] {
        let image = baker.png(&format!("assets/minecraft/textures/environment/{name}.png"))?;
        if image.dimensions() != (64,256) {return Err("Unsupported precipitation texture size".into());}
        weather_rgba.extend(image.into_raw());
    }
    Ok(AssetPack {
        weather_rgba,
        biome_colormaps,
        gui: Arc::new(crate::gui_assets::GuiAssets::empty()),
        texture_layers: (baker.rgba.len() / (TILE * TILE * 4) as usize) as u32,
        texture_size: TILE,
        textures_rgba: baker.rgba,
        models,
        font_layers,
        font_widths,
        default_skin_size: [skin.width(), skin.height()],
        default_skin_rgba: skin.into_raw(),
        item_textures,
        entity_texture_layers: entity_textures.len() as u32,
        entity_texture_size: entity_size,
        entity_textures_rgba: entity_rgba,
        entity_textures,
        cache_hit: false,
        load_ms: 0,
        unsupported_block_models: unsupported.len(),
    })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

struct GuiPiece {
    quads: Vec<BakedQuad>,
    transform: glam::Mat4,
    front_light: bool,
    tints: Vec<(crate::gui_assets::ItemTintSource, u32)>,
}
pub(crate) struct GuiItems {
    pub icons: Vec<(u32, RgbaImage)>,
    pub layers: Vec<(
        u32,
        Vec<(RgbaImage, crate::gui_assets::ItemTintSource, u32)>,
    )>,
    pub names: HashMap<String, u32>,
    pub missing: Vec<String>,
}

/// The GUI uses the actual item definition and inherited GUI display transform,
/// not a block's particle/top texture. Generated items keep their real layers.
pub(crate) fn bake_gui_items(jar: &Path) -> Result<GuiItems, String> {
    let mut baker = Baker::new(jar)?;
    let mut icons = Vec::new();
    let mut missing = Vec::new();
    let mut layers = Vec::new();
    let mut names = HashMap::new();
    let mut native: HashMap<u32, Arc<RgbaImage>> = HashMap::new();
    for id in 1..8192 {
        let Some(item) = ItemKind::from_u32(id) else {
            break;
        };
        let name = item.to_str();
        let name = name.strip_prefix("minecraft:").unwrap_or(name);
        let definition = match baker.json_path(&format!("assets/minecraft/items/{name}.json")) {
            Ok(v) => v,
            Err(e) => {
                missing.push(format!("{name}: {e}"));
                continue;
            }
        };
        let mut nodes = Vec::new();
        if let Err(e) = gui_item_nodes(&definition["model"], 0, &mut nodes) {
            missing.push(format!("{name}: {e}"));
            continue;
        }
        let mut pieces = Vec::new();
        let mut failed = false;
        for (node, transform) in nodes {
            match gui_item_piece(&mut baker, node, name, transform) {
                Ok(piece) => pieces.push(piece),
                Err(e) => {
                    missing.push(format!("{name}: {e}"));
                    failed = true;
                    break;
                }
            }
        }
        if failed || pieces.is_empty() {
            continue;
        }
        for piece in &pieces {
            for quad in &piece.quads {
                if native.contains_key(&quad.layer) {
                    continue;
                }
                let name = baker
                    .textures
                    .iter()
                    .find(|(key, value)| value.0 == quad.layer && !key.starts_with('@'))
                    .map(|(key, _)| key.clone());
                let image = if let Some(name) = name {
                    let image = baker.png(&asset_path(&name, "textures", "png")?)?;
                    image::imageops::crop_imm(
                        &image,
                        0,
                        0,
                        image.width(),
                        image.width().min(image.height()),
                    )
                    .to_image()
                } else {
                    let start = quad.layer as usize * (TILE * TILE * 4) as usize;
                    RgbaImage::from_raw(
                        TILE,
                        TILE,
                        baker
                            .rgba
                            .get(start..start + (TILE * TILE * 4) as usize)
                            .ok_or("Invalid GUI model texture layer")?
                            .to_vec(),
                    )
                    .ok_or("Invalid GUI model texture")?
                };
                native.insert(quad.layer, Arc::new(image));
            }
        }
        let image = raster_gui_item(&pieces, &native);
        if image.pixels().any(|p| p[3] > 0) {
            icons.push((id, image));
            names.insert(name.into(), id);
            names.insert(format!("minecraft:{name}"), id);
            if pieces.iter().all(|p| p.tints.len() == p.quads.len())
                && pieces
                    .iter()
                    .flat_map(|p| &p.tints)
                    .any(|(source, _)| *source != crate::gui_assets::ItemTintSource::Fixed)
            {
                let mut item_layers = Vec::new();
                for p in &pieces {
                    for (q, (source, color)) in p.quads.iter().zip(&p.tints) {
                        let mut q = q.clone();
                        q.tint = [1.; 3];
                        let layer = GuiPiece {
                            quads: vec![q],
                            transform: p.transform,
                            front_light: p.front_light,
                            tints: Vec::new(),
                        };
                        item_layers.push((raster_gui_item(&[layer], &native), *source, *color));
                    }
                }
                layers.push((id, item_layers));
            }
        } else {
            missing.push(format!(
                "{name}: item definition has no supported visible geometry"
            ));
        }
    }
    Ok(GuiItems {
        icons,
        layers,
        names,
        missing,
    })
}
fn gui_item_nodes<'a>(
    node: &'a Value,
    depth: usize,
    out: &mut Vec<(&'a Value, glam::Mat4)>,
) -> Result<(), String> {
    gui_item_nodes_transform(node, depth, glam::Mat4::IDENTITY, out)
}
fn gui_item_nodes_transform<'a>(
    node: &'a Value,
    depth: usize,
    parent: glam::Mat4,
    out: &mut Vec<(&'a Value, glam::Mat4)>,
) -> Result<(), String> {
    if depth > 24 || out.len() > 32 {
        return Err("Item model recursion limit".into());
    }
    let transform = parent * gui_node_transform(&node["transformation"])?;
    match node["type"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches("minecraft:")
    {
        "model" | "special" => out.push((node, transform)),
        "empty" => {}
        "composite" => {
            for child in node["models"].as_array().ok_or("Invalid composite item")? {
                gui_item_nodes_transform(child, depth + 1, transform, out)?;
            }
        }
        "condition" => gui_item_nodes_transform(&node["on_false"], depth + 1, transform, out)?,
        "select" => {
            let mut selected = &node["fallback"];
            if node["property"].as_str() == Some("minecraft:display_context") {
                for case in node["cases"].as_array().ok_or("Invalid item selector")? {
                    if case["when"].as_str() == Some("gui")
                        || case["when"]
                            .as_array()
                            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some("gui")))
                    {
                        selected = &case["model"];
                        break;
                    }
                }
            }
            gui_item_nodes_transform(selected, depth + 1, transform, out)?;
        }
        "range_dispatch" => {
            let mut selected = &node["fallback"];
            let mut threshold = f64::NEG_INFINITY;
            if let Some(entries) = node["entries"].as_array() {
                for e in entries {
                    let t = e["threshold"].as_f64().ok_or("Invalid item threshold")?;
                    if t <= 0. && t >= threshold {
                        threshold = t;
                        selected = &e["model"];
                    }
                }
            }
            gui_item_nodes_transform(selected, depth + 1, transform, out)?;
        }
        other => return Err(format!("unsupported item definition {other}")),
    }
    Ok(())
}
fn gui_node_transform(value: &Value) -> Result<glam::Mat4, String> {
    if value.is_null() {
        return Ok(glam::Mat4::IDENTITY);
    }
    let quaternion = |key: &str| -> Result<glam::Quat, String> {
        let Some(a) = value[key].as_array() else {
            return Ok(glam::Quat::IDENTITY);
        };
        if a.len() != 4 {
            return Err("Unsupported item quaternion".into());
        }
        let mut q = [0.; 4];
        for (i, v) in a.iter().enumerate() {
            q[i] = v.as_f64().ok_or("Invalid item quaternion")? as f32;
        }
        if q.iter().any(|v| !v.is_finite() || v.abs() > 1.01) {
            return Err("Invalid item quaternion".into());
        }
        let q = glam::Quat::from_array(q);
        if q.length_squared() < 0.001 {
            return Err("Zero item quaternion".into());
        }
        Ok(q.normalize())
    };
    let translation = glam::Vec3::from_array(vec3(&value["translation"], [0.; 3])?);
    let scale = glam::Vec3::from_array(vec3(&value["scale"], [1.; 3])?);
    Ok(glam::Mat4::from_translation(translation)
        * glam::Mat4::from_quat(quaternion("left_rotation")?)
        * glam::Mat4::from_scale(scale)
        * glam::Mat4::from_quat(quaternion("right_rotation")?))
}
fn gui_item_piece(
    baker: &mut Baker,
    node: &Value,
    item: &str,
    node_transform: glam::Mat4,
) -> Result<GuiPiece, String> {
    let special = node["type"].as_str() == Some("minecraft:special");
    let model_id = if special {
        node["base"].as_str()
    } else {
        node["model"].as_str()
    }
    .ok_or("Item model missing base")?;
    let model = baker.model(model_id, 0)?;
    let rotation = vec3(&model.gui["rotation"], [0.; 3])?.map(f32::to_radians);
    let translation = vec3(&model.gui["translation"], [0.; 3])?.map(|v| v / 16.);
    let scale = vec3(&model.gui["scale"], [1.; 3])?;
    if scale.iter().any(|v| !v.is_finite() || v.abs() > 4.) {
        return Err("Invalid item GUI scale".into());
    }
    let transform = glam::Mat4::from_translation(glam::Vec3::from_array(translation))
        * glam::Mat4::from_quat(glam::Quat::from_euler(
            glam::EulerRot::XYZ,
            rotation[0],
            rotation[1],
            rotation[2],
        ))
        * glam::Mat4::from_scale(glam::Vec3::from_array(scale))
        * glam::Mat4::from_translation(glam::Vec3::splat(-0.5))
        * node_transform;
    let mut quads = Vec::new();
    let mut tints = Vec::new();
    if special {
        quads = gui_special_item(baker, &node["model"], item)?;
    } else if model.generated {
        for layer_index in 0..5 {
            let key = format!("layer{layer_index}");
            if !model.textures.contains_key(&key) {
                break;
            }
            let texture = resolve_texture(&model, &format!("#{key}"))?;
            let (layer, render_layer) = baker.texture(&texture)?;
            let color = node["tints"]
                .as_array()
                .and_then(|a| a.get(layer_index))
                .map(gui_default_tint)
                .unwrap_or([1.; 3]);
            let binding = node["tints"].as_array().and_then(|a| a.get(layer_index));
            let source = match binding.and_then(|v| v["type"].as_str()) {
                Some("minecraft:dye") => crate::gui_assets::ItemTintSource::Dye,
                Some("minecraft:potion") => crate::gui_assets::ItemTintSource::Potion,
                _ => crate::gui_assets::ItemTintSource::Fixed,
            };
            let packed = ((color[0] * 255.).round() as u32) << 16
                | ((color[1] * 255.).round() as u32) << 8
                | (color[2] * 255.).round() as u32;
            tints.push((source, packed));
            let z = 0.5 + layer_index as f32 * 0.0001;
            quads.push(BakedQuad {
                    shade: true, ambient_occlusion: true,
                positions: [[0., 1., z], [0., 0., z], [1., 0., z], [1., 1., z]],
                uv: [[0., 0.], [0., 1.], [1., 1.], [1., 0.]],
                layer,
                cull_face: None,
                tint: color,
                render_layer,
            });
        }
    } else {
        baker.bake_choice(
            &serde_json::json!({"model":model_id}),
            item,
            &Properties::new(),
            &mut quads,
        )?;
    }
    Ok(GuiPiece {
        quads,
        transform,
        front_light: model.front_light,
        tints,
    })
}
// Special-renderer dimensions/UV offsets are verified against the corresponding
// 26.1 model classes. They use real entity skins, never replacement item art.
fn gui_special_item(
    baker: &mut Baker,
    value: &Value,
    _item: &str,
) -> Result<Vec<BakedQuad>, String> {
    use glam::{Mat4, Vec3};
    let kind = value["type"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches("minecraft:");
    let texture = value["texture"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches("minecraft:");
    if kind == "decorated_pot" {
        return gui_decorated_pot(baker);
    }
    if kind == "chest" {
        return Ok(baker
            .chest_skin(
                "chest",
                &HashMap::from([("type", "single"), ("facing", "south")]),
                Some(texture),
            )?
            .quads);
    }
    type Cube = ([f32; 3], [f32; 3], [f32; 2], Mat4, [f32; 3]);
    let mut cubes: Vec<Cube> = Vec::new();
    let white = [1.; 3];
    let identity = Mat4::IDENTITY;
    let skin = match kind {
        "shulker_box" => {
            cubes.push(([-8., 8., -8.], [16., 12., 16.], [0., 0.], identity, white));
            cubes.push(([-8., 16., -8.], [16., 8., 16.], [0., 28.], identity, white));
            format!("entity/shulker/{texture}")
        }
        "shield" => {
            cubes.push(([-6., -11., -2.], [12., 22., 1.], [0., 0.], identity, white));
            cubes.push(([-1., -3., -1.], [2., 6., 6.], [26., 0.], identity, white));
            "entity/shield/shield_base_nopattern".into()
        }
        "banner" => {
            let names = [
                "white",
                "orange",
                "magenta",
                "light_blue",
                "yellow",
                "lime",
                "pink",
                "gray",
                "light_gray",
                "cyan",
                "purple",
                "blue",
                "brown",
                "green",
                "red",
                "black",
            ];
            let index = names
                .iter()
                .position(|name| Some(*name) == value["color"].as_str())
                .unwrap_or(0);
            let a = crate::mob_models::MobAppearance {
                color: index as u8,
                ..Default::default()
            };
            let color =
                crate::mob_models::tint_for("sheep", &a, crate::mob_models::MaterialSlot::Wool);
            let color = [color[0], color[1], color[2]];
            cubes.push(([-1., -42., -1.], [2., 42., 2.], [44., 0.], identity, white));
            cubes.push(([-10., -44., -1.], [20., 2., 2.], [0., 42.], identity, white));
            cubes.push(([-10., -44., -2.], [20., 40., 1.], [0., 0.], identity, color));
            "entity/banner/banner_base".into()
        }
        "bed" => {
            let head = value["part"].as_str() == Some("head");
            let z = if head { 0. } else { -16. };
            cubes.push((
                [0., 0., 0.],
                [16., 16., 6.],
                [0., if head { 0. } else { 22. }],
                identity,
                white,
            ));
            cubes.push((
                [0., 6., z],
                [3.; 3],
                [50., if head { 6. } else { 0. }],
                Mat4::from_euler(
                    glam::EulerRot::ZYX,
                    if head {
                        std::f32::consts::FRAC_PI_2
                    } else {
                        0.
                    },
                    0.,
                    std::f32::consts::FRAC_PI_2,
                ),
                white,
            ));
            cubes.push((
                [-16., 6., z],
                [3.; 3],
                [50., if head { 18. } else { 12. }],
                Mat4::from_euler(
                    glam::EulerRot::ZYX,
                    if head {
                        std::f32::consts::PI
                    } else {
                        std::f32::consts::PI * 1.5
                    },
                    0.,
                    std::f32::consts::FRAC_PI_2,
                ),
                white,
            ));
            format!("entity/bed/{texture}")
        }
        "head" | "player_head" => {
            let kind = if kind == "player_head" {
                "player"
            } else {
                value["kind"].as_str().unwrap_or("")
            };
            let path = match kind {
                "skeleton" => "entity/skeleton/skeleton",
                "wither_skeleton" => "entity/skeleton/wither_skeleton",
                "zombie" => "entity/zombie/zombie",
                "creeper" => "entity/creeper/creeper",
                "player" => "entity/player/wide/steve",
                "piglin" => "entity/piglin/piglin",
                "dragon" => "entity/enderdragon/dragon",
                _ => return Err(format!("unsupported special head {kind}")),
            };
            if kind == "piglin" {
                for (from, size, uv) in [
                    ([-5., -8., -4.], [10., 8., 8.], [0., 0.]),
                    ([-2., -4., -5.], [4., 4., 1.], [31., 1.]),
                    ([2., -2., -5.], [1., 2., 1.], [2., 4.]),
                    ([-3., -2., -5.], [1., 2., 1.], [2., 0.]),
                ] {
                    cubes.push((from, size, uv, identity, white));
                }
                cubes.push((
                    [0., 0., -2.],
                    [1., 5., 4.],
                    [51., 6.],
                    Mat4::from_translation(Vec3::new(4.5, -6., 0.))
                        * Mat4::from_rotation_z(-std::f32::consts::PI / 6.),
                    white,
                ));
                cubes.push((
                    [-1., 0., -2.],
                    [1., 5., 4.],
                    [39., 6.],
                    Mat4::from_translation(Vec3::new(-4.5, -6., 0.))
                        * Mat4::from_rotation_z(std::f32::consts::PI / 6.),
                    white,
                ));
            } else if kind == "dragon" {
                let head = Mat4::from_translation(Vec3::new(0., -7.986666, 0.))
                    * Mat4::from_scale(Vec3::splat(0.75));
                for (from, size, uv) in [
                    ([-6., -1., -24.], [12., 5., 16.], [176., 44.]),
                    ([-8., -8., -10.], [16., 16., 16.], [112., 30.]),
                    ([-5., -12., -4.], [2., 4., 6.], [0., 0.]),
                    ([-5., -3., -22.], [2., 2., 4.], [112., 0.]),
                    ([3., -12., -4.], [2., 4., 6.], [0., 0.]),
                    ([3., -3., -22.], [2., 2., 4.], [112., 0.]),
                ] {
                    cubes.push((from, size, uv, head, white));
                }
                cubes.push((
                    [-6., 0., -16.],
                    [12., 4., 16.],
                    [176., 65.],
                    head * Mat4::from_translation(Vec3::new(0., 4., -8.)),
                    white,
                ));
            } else {
                cubes.push(([-4., -8., -4.], [8.; 3], [0., 0.], identity, white));
            }
            if kind == "zombie" || kind == "player" {
                let inflate = Mat4::from_translation(Vec3::new(0., -4., 0.))
                    * Mat4::from_scale(Vec3::splat(1.0625))
                    * Mat4::from_translation(Vec3::new(0., 4., 0.));
                cubes.push(([-4., -8., -4.], [8.; 3], [32., 0.], inflate, white));
            }
            path.into()
        }
        "copper_golem_statue" => {
            let root = Mat4::from_rotation_z(std::f32::consts::PI);
            for (from, size, uv) in [
                ([-4., -11., -3.], [8., 6., 6.], [0., 15.]),
                ([-4., -16., -5.], [8., 5., 10.], [0., 0.]),
                ([-1., -13., -6.], [2., 3., 2.], [56., 0.]),
                ([-1., -20., -1.], [2., 4., 2.], [37., 8.]),
                ([-2., -24., -2.], [4., 4., 4.], [37., 0.]),
                ([-7., -12., -2.], [3., 10., 4.], [36., 16.]),
                ([4., -12., -2.], [3., 10., 4.], [50., 16.]),
                ([-4., -5., -2.], [4., 5., 4.], [0., 27.]),
                ([0., -5., -2.], [4., 5., 4.], [16., 27.]),
            ] {
                cubes.push((from, size, uv, root, white));
            }
            texture
                .trim_start_matches("textures/")
                .trim_end_matches(".png")
                .into()
        }
        "conduit" => {
            cubes.push(([-3.; 3], [6.; 3], [0., 0.], identity, white));
            "entity/conduit/base".into()
        }
        other => {
            return Err(format!(
                "unsupported special item renderer minecraft:{other}"
            ));
        }
    };
    let bitmap = baker.png(&asset_path(&skin, "textures", "png")?)?;
    let dimensions = bitmap.dimensions();
    let (layer, render_layer) = baker.texture(&skin)?;
    let mut quads = Vec::new();
    for (from, size, uv, transform, tint) in cubes {
        for q in crate::mob_models::cuboid_quads(from, size, uv) {
            quads.push(BakedQuad {
                    shade: true, ambient_occlusion: true,
                positions: q
                    .positions
                    .map(|p| (transform.transform_point3(Vec3::from_array(p)) / 16.).to_array()),
                uv: q.uv.map(|uv| {
                    [
                        uv[0] * 64. / dimensions.0 as f32,
                        uv[1] * 64. / dimensions.1 as f32,
                    ]
                }),
                layer,
                cull_face: None,
                tint,
                render_layer,
            });
        }
    }
    Ok(quads)
}
fn gui_decorated_pot(baker: &mut Baker) -> Result<Vec<BakedQuad>, String> {
    use glam::{Mat4, Vec3};
    let mut out = Vec::new();
    let (base_layer, base_render) = baker.texture("entity/decorated_pot/decorated_pot_base")?;
    let neck = Mat4::from_translation(Vec3::new(0., 37., 16.))
        * Mat4::from_rotation_x(std::f32::consts::PI);
    for (from, size, uv, pose, inflate) in [
        ([4., 17., 4.], [8., 3., 8.], [0., 0.], neck, -0.1),
        ([5., 20., 5.], [6., 1., 6.], [0., 5.], neck, 0.2),
        (
            [0., 0., 0.],
            [14., 0., 14.],
            [-14., 13.],
            Mat4::from_translation(Vec3::new(1., 16., 1.)),
            0.,
        ),
        (
            [0., 0., 0.],
            [14., 0., 14.],
            [-14., 13.],
            Mat4::from_translation(Vec3::new(1., 0., 1.)),
            0.,
        ),
    ] {
        let center = Vec3::from_array(from) + Vec3::from_array(size) * 0.5;
        let scale =
            Vec3::from_array(size.map(|v| if v == 0. { 1. } else { 1. + 2. * inflate / v }));
        let pose = pose
            * Mat4::from_translation(center)
            * Mat4::from_scale(scale)
            * Mat4::from_translation(-center);
        for q in crate::mob_models::cuboid_quads(from, size, uv) {
            out.push(BakedQuad {
                    shade: true, ambient_occlusion: true,
                positions: q
                    .positions
                    .map(|p| (pose.transform_point3(Vec3::from_array(p)) / 16.).to_array()),
                uv: q.uv.map(|v| v.map(|v| v * 2.)),
                layer: base_layer,
                cull_face: None,
                tint: [1.; 3],
                render_layer: base_render,
            });
        }
    }
    let (side_layer, side_render) = baker.texture("entity/decorated_pot/decorated_pot_side")?;
    // Each side is the north face of a14x16 plane with its reference part pose.
    for (offset, rot) in [
        ([15., 16., 1.], [0., 0., std::f32::consts::PI]),
        (
            [1., 16., 1.],
            [0., -std::f32::consts::FRAC_PI_2, std::f32::consts::PI],
        ),
        (
            [15., 16., 15.],
            [0., std::f32::consts::FRAC_PI_2, std::f32::consts::PI],
        ),
        ([1., 16., 15.], [std::f32::consts::PI, 0., 0.]),
    ] {
        let pose = Mat4::from_translation(Vec3::from_array(offset))
            * Mat4::from_euler(glam::EulerRot::ZYX, rot[2], rot[1], rot[0]);
        let q = crate::mob_models::cuboid_quads([0.; 3], [14., 16., 0.], [1., 0.])
            .into_iter()
            .find(|q| {
                let p = q.positions.map(Vec3::from_array);
                (p[1] - p[0]).cross(p[2] - p[0]).z < 0.
            })
            .ok_or("Missing pot side")?;
        out.push(BakedQuad {
                    shade: true, ambient_occlusion: true,
            positions: q
                .positions
                .map(|p| (pose.transform_point3(Vec3::from_array(p)) / 16.).to_array()),
            uv: q.uv.map(|v| v.map(|v| v * 4.)),
            layer: side_layer,
            cull_face: None,
            tint: [1.; 3],
            render_layer: side_render,
        });
    }
    Ok(out)
}
fn gui_default_tint(value: &Value) -> [f32; 3] {
    let color = value["value"]
        .as_i64()
        .or_else(|| value["default"].as_i64())
        .unwrap_or(0xffffff) as u32;
    [
        (color >> 16 & 255) as f32 / 255.,
        (color >> 8 & 255) as f32 / 255.,
        (color & 255) as f32 / 255.,
    ]
}
fn raster_gui_item(pieces: &[GuiPiece], textures: &HashMap<u32, Arc<RgbaImage>>) -> RgbaImage {
    use glam::{Mat4, Vec2, Vec3};
    const SIDE: usize = 32;
    let mut image = RgbaImage::new(SIDE as u32, SIDE as u32);
    let mut depth = [f32::NEG_INFINITY; SIDE * SIDE];
    // Vanilla26.1 Lighting.ITEMS_3D, verified from the installed client.
    let light_matrix = Mat4::from_scale(Vec3::new(1., -1., 1.))
        * Mat4::from_euler(glam::EulerRot::YXZ, 1.0821041, 3.2375858, 0.)
        * Mat4::from_euler(glam::EulerRot::YXZ, -0.3926991, 2.3561945, 0.);
    let lights = [Vec3::new(0.2, 1., -0.7), Vec3::new(-0.2, 1., 0.7)]
        .map(|v| light_matrix.transform_vector3(v.normalize()));
    for piece in pieces {
        for q in &piece.quads {
            let Some(texture) = textures.get(&q.layer) else {
                continue;
            };
            let model = q
                .positions
                .map(|p| piece.transform.transform_point3(Vec3::from_array(p)));
            let points =
                model.map(|p| Vec3::new((p.x + 0.5) * SIDE as f32, (0.5 - p.y) * SIDE as f32, p.z));
            let normal = (model[1] - model[0])
                .cross(model[2] - model[0])
                .normalize_or_zero();
            // Java's GUI model-view flips Y. Apply that flip to normals as well
            // as positions before using its ITEMS_3D lighting directions.
            let normal = Vec3::new(normal.x, -normal.y, normal.z);
            let shade = if piece.front_light {
                1.
            } else {
                (0.4 + 0.6 * (normal.dot(lights[0]).max(0.) + normal.dot(lights[1]).max(0.)))
                    .min(1.)
            };
            for indices in [[0, 1, 2], [0, 2, 3]] {
                let p = indices.map(|i| points[i]);
                let uv = indices.map(|i| Vec2::from_array(q.uv[i]));
                let edge = |a: Vec3, b: Vec3, x: f32, y: f32| {
                    (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)
                };
                let area = edge(p[0], p[1], p[2].x, p[2].y);
                if area.abs() < 0.0001 {
                    continue;
                }
                let x0 = p
                    .iter()
                    .map(|v| v.x.floor() as i32)
                    .min()
                    .unwrap()
                    .clamp(0, SIDE as i32);
                let x1 = p
                    .iter()
                    .map(|v| v.x.ceil() as i32)
                    .max()
                    .unwrap()
                    .clamp(0, SIDE as i32);
                let y0 = p
                    .iter()
                    .map(|v| v.y.floor() as i32)
                    .min()
                    .unwrap()
                    .clamp(0, SIDE as i32);
                let y1 = p
                    .iter()
                    .map(|v| v.y.ceil() as i32)
                    .max()
                    .unwrap()
                    .clamp(0, SIDE as i32);
                for y in y0..y1 {
                    for x in x0..x1 {
                        let px = x as f32 + 0.5;
                        let py = y as f32 + 0.5;
                        let a = edge(p[1], p[2], px, py) / area;
                        let b = edge(p[2], p[0], px, py) / area;
                        let c = 1. - a - b;
                        if a < -0.00001 || b < -0.00001 || c < -0.00001 {
                            continue;
                        }
                        let z = a * p[0].z + b * p[1].z + c * p[2].z;
                        let index = y as usize * SIDE + x as usize;
                        if z < depth[index] - 0.00001 {
                            continue;
                        }
                        let coord = uv[0] * a + uv[1] * b + uv[2] * c;
                        let sx = (coord.x.clamp(0., 0.999999) * texture.width() as f32) as u32;
                        let sy = (coord.y.clamp(0., 0.999999) * texture.height() as f32) as u32;
                        let pixel = texture.get_pixel(sx, sy);
                        if pixel[3] == 0 {
                            continue;
                        }
                        let alpha = pixel[3] as f32 / 255.;
                        let old = image.get_pixel(x as u32, y as u32);
                        let out_alpha = alpha + old[3] as f32 / 255. * (1. - alpha);
                        let rgb = std::array::from_fn::<u8, 3, _>(|i| {
                            ((pixel[i] as f32 * q.tint[i] * shade * alpha
                                + old[i] as f32 * (old[3] as f32 / 255.) * (1. - alpha))
                                / out_alpha)
                                .round()
                                .clamp(0., 255.) as u8
                        });
                        image.put_pixel(
                            x as u32,
                            y as u32,
                            image::Rgba([rgb[0], rgb[1], rgb[2], (out_alpha * 255.).round() as u8]),
                        );
                        depth[index] = z;
                    }
                }
            }
        }
    }
    image
}

pub fn load(jar: &Path, cache_dir: &Path) -> Result<AssetPack, String> {
    let started = Instant::now();
    let metadata = fs::metadata(jar).map_err(|e| format!("Cannot read client JAR: {e}"))?;
    if !metadata.is_file() || metadata.len() > 512 * 1024 * 1024 {
        return Err("Invalid client asset JAR size".into());
    }
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let canonical = fs::canonicalize(jar).map_err(|e| e.to_string())?;
    let stamp = Sha256::digest(
        format!(
            "{SCHEMA}:26.1:{}:{}:{modified}",
            canonical.display(),
            metadata.len()
        )
        .as_bytes(),
    );
    let index = cache_dir.join(format!("assets-v{SCHEMA}-{}.ref", hex(&stamp)));
    // Bloom already verifies the official JAR hash on install. This local source
    // stamp avoids re-reading tens of MB before every warm launch.
    if let Ok(hash) = read_bounded(&index, 32) {
        if hash.len() == 32 {
            let cache = cache_dir.join(format!("assets-v{SCHEMA}-{}.bin", hex(&hash)));
            if let Ok(bytes) = read_bounded(&cache, MAX_CACHE) {
                if let Ok(mut pack) = decode_cache(&bytes, &hash) {
                    pack.gui = Arc::new(crate::gui_assets::load(jar, cache_dir, &hash)?);
                    pack.cache_hit = true;
                    pack.load_ms = started.elapsed().as_millis() as u64;
                    return Ok(pack);
                }
            }
        }
    }
    let mut source = File::open(jar).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash: [u8; 32] = hasher.finalize().into();
    let mut pack = bake(jar)?;
    let after = fs::metadata(jar).map_err(|e| e.to_string())?;
    if after.len() != metadata.len() || after.modified().ok() != metadata.modified().ok() {
        return Err(
            "Client assets changed while baking; retry after installation completes".into(),
        );
    }
    if let Ok(bytes) = encode_cache(&pack, &hash) {
        if fs::create_dir_all(cache_dir).is_ok() {
            let cache = cache_dir.join(format!("assets-v{SCHEMA}-{}.bin", hex(&hash)));
            if atomic_write(&cache, &bytes).is_ok() {
                let _ = atomic_write(&index, &hash);
            }
        }
    }
    pack.gui = Arc::new(crate::gui_assets::load(jar, cache_dir, &hash)?);
    pack.load_ms = started.elapsed().as_millis() as u64;
    Ok(pack)
}

pub(crate) fn read_bounded(path: &Path, cap: usize) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let length = file.metadata().map_err(|e| e.to_string())?.len();
    if length > cap as u64 {
        return Err("Asset cache exceeds size budget".into());
    }
    // Reserve once: growing a ~20 MB binary cache repeatedly costs more startup
    // memory traffic than the small header checks themselves.
    let mut bytes = Vec::with_capacity(length as usize);
    Read::by_ref(&mut file)
        .take(cap as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > cap {
        return Err("Asset cache exceeds size budget".into());
    }
    Ok(bytes)
}
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_CACHE {
        return Err("Asset cache exceeds write budget".into());
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = path.with_extension(format!("{}-{nonce}.tmp", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        replace_file(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}
#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    // Both pointers reference NUL-terminated strings that remain alive for the
    // call. MOVEFILE_REPLACE_EXISTING permits atomic corrupt-cache replacement.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 1 | 8) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn put_u32(out: &mut Vec<u8>, value: usize) {
    out.extend((value as u32).to_le_bytes());
}
fn put_f32(out: &mut Vec<u8>, value: f32) {
    out.extend(value.to_le_bytes());
}
fn encode_cache(pack: &AssetPack, hash: &[u8; 32]) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    put_u32(&mut body, pack.texture_layers as usize);
    body.extend(&pack.textures_rgba);
    for layer in pack.font_layers {
        put_u32(&mut body, layer as usize);
    }
    for width in pack.font_widths {
        put_f32(&mut body, width);
    }
    body.extend(&pack.default_skin_rgba);
    body.extend(&pack.weather_rgba);
    body.extend(&pack.biome_colormaps);
    put_u32(&mut body, pack.entity_texture_layers as usize);
    body.extend(&pack.entity_textures_rgba);
    let mut entity_names: Vec<_> = pack.entity_textures.iter().collect();
    entity_names.sort_unstable_by_key(|(_, layer)| **layer);
    put_u32(&mut body, entity_names.len());
    for (name, layer) in entity_names {
        put_u32(&mut body, name.len());
        body.extend(name.as_bytes());
        put_u32(&mut body, *layer as usize);
    }
    put_u32(&mut body, pack.unsupported_block_models);
    let mut icons: Vec<_> = pack.item_textures.iter().collect();
    icons.sort_unstable_by_key(|(id, _)| *id);
    put_u32(&mut body, icons.len());
    for (id, layer) in icons {
        put_u32(&mut body, *id as usize);
        put_u32(&mut body, *layer as usize);
    }
    let mut unique = Vec::new();
    let mut indices = HashMap::new();
    let mut state_indices = Vec::with_capacity(pack.models.len());
    for model in &pack.models {
        let index = *indices.entry(Arc::as_ptr(model)).or_insert_with(|| {
            let i = unique.len();
            unique.push(model);
            i
        });
        state_indices.push(index);
    }
    put_u32(&mut body, unique.len());
    for model in unique {
        body.push(model.opaque_full_cube as u8);
        body.extend(model.cull_group.to_le_bytes());
        put_u32(&mut body, model.quads.len());
        for q in &model.quads {
            for p in q.positions {
                for v in p {
                    put_f32(&mut body, v);
                }
            }
            for p in q.uv {
                for v in p {
                    put_f32(&mut body, v);
                }
            }
            put_u32(&mut body, q.layer as usize);
            body.push(q.cull_face.map_or(255, |f| f as u8));
            body.push(q.render_layer as u8 | (u8::from(q.shade)<<2) | (u8::from(q.ambient_occlusion)<<3));
            for v in q.tint {
                put_f32(&mut body, v);
            }
        }
    }
    put_u32(&mut body, state_indices.len());
    for index in state_indices {
        put_u32(&mut body, index);
    }
    if body.len() + 76 > MAX_CACHE {
        return Err("Baked cache exceeds size budget".into());
    }
    let mut bytes = Vec::with_capacity(body.len() + 76);
    bytes.extend(b"SKRABAKE");
    bytes.extend(SCHEMA.to_le_bytes());
    bytes.extend(hash);
    bytes.extend(Sha256::digest(&body));
    bytes.extend(body);
    Ok(bytes)
}
struct Decoder<'a> {
    bytes: &'a [u8],
    position: usize,
}
impl<'a> Decoder<'a> {
    fn bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self
            .position
            .checked_add(n)
            .ok_or("Cache length overflow")?;
        let bytes = self
            .bytes
            .get(self.position..end)
            .ok_or("Truncated asset cache")?;
        self.position = end;
        Ok(bytes)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.bytes(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.bytes(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.bytes(4)?.try_into().unwrap()))
    }
    fn count(&mut self, cap: usize) -> Result<usize, String> {
        let n = self.u32()? as usize;
        if n > cap {
            Err("Asset cache count exceeds budget".into())
        } else {
            Ok(n)
        }
    }
    fn f32(&mut self, limit: f32) -> Result<f32, String> {
        let value = f32::from_le_bytes(self.bytes(4)?.try_into().unwrap());
        if value.is_finite() && value.abs() <= limit {
            Ok(value)
        } else {
            Err("Invalid cached model coordinate".into())
        }
    }
}
fn decode_cache(bytes: &[u8], hash: &[u8]) -> Result<AssetPack, String> {
    if bytes.len() > MAX_CACHE {
        return Err("Asset cache exceeds read budget".into());
    }
    let mut d = Decoder { bytes, position: 0 };
    if d.bytes(8)? != b"SKRABAKE" || d.u32()? != SCHEMA || d.bytes(32)? != hash {
        return Err("Stale asset cache header".into());
    }
    let checksum = d.bytes(32)?;
    if checksum != Sha256::digest(&bytes[d.position..]).as_slice() {
        return Err("Asset cache checksum mismatch".into());
    }
    let layers = d.count(MAX_LAYERS)?;
    if layers == 0 {
        return Err("Empty texture cache".into());
    }
    let rgba = d.bytes(layers * (TILE * TILE * 4) as usize)?.to_vec();
    let mut font_layers = [0; 128];
    let mut font_widths = [0.; 128];
    for layer in &mut font_layers {
        *layer = d.count(layers - 1)? as u32;
    }
    for width in &mut font_widths {
        *width = d.f32(4.)?;
        if *width < 0. {
            return Err("Negative font advance".into());
        }
    }
    let skin = d.bytes(64 * 64 * 4)?.to_vec();
    let weather_rgba = d.bytes(64*256*4*2)?.to_vec();
    let biome_colormaps=d.bytes(256*256*4*2)?.to_vec();
    let entity_layers = d.count(MAX_ENTITY_LAYERS)?;
    let entity_size = crate::mob_models::TEXTURE_SIZE;
    let entity_rgba = d
        .bytes(entity_layers * (entity_size * entity_size * 4) as usize)?
        .to_vec();
    let name_count = d.count(MAX_ENTITY_LAYERS)?;
    if name_count != entity_layers {
        return Err("Entity skin cache count mismatch".into());
    }
    let mut entity_textures = HashMap::with_capacity(name_count);
    for _ in 0..name_count {
        let length = d.count(256)?;
        let name = std::str::from_utf8(d.bytes(length)?)
            .map_err(|_| "Invalid cached entity texture name")?
            .to_owned();
        resource(&name)?;
        let layer = d.count(entity_layers.saturating_sub(1))? as u32;
        if entity_textures.insert(name, layer).is_some() {
            return Err("Duplicate cached entity texture".into());
        }
    }
    let unsupported = d.count(4096)?;
    let count = d.count(4096)?;
    let mut item_textures = HashMap::with_capacity(count);
    for _ in 0..count {
        let id = d.count(4095)? as u32;
        let layer = d.count(layers - 1)? as u32;
        item_textures.insert(id, layer);
    }
    let count = d.count(BlockState::MAX_STATE as usize + 1)?;
    let mut unique = Vec::with_capacity(count);
    let mut total_quads = 0;
    for _ in 0..count {
        let opaque = d.u8()?;
        if opaque > 1 {
            return Err("Invalid cached model flags".into());
        }
        let group = d.u16()?;
        let count = d.count(MAX_QUADS)?;
        total_quads += count;
        if total_quads > MAX_TOTAL_QUADS || count * 98 > bytes.len() - d.position {
            return Err("Asset cache geometry budget exceeded".into());
        }
        let mut quads = Vec::with_capacity(count);
        for _ in 0..count {
            let mut positions = [[0.; 3]; 4];
            let mut uv = [[0.; 2]; 4];
            let mut tint = [0.; 3];
            for p in &mut positions {
                for v in p {
                    *v = d.f32(32.)?;
                }
            }
            for p in &mut uv {
                for v in p {
                    *v = d.f32(32.)?;
                }
            }
            let layer = d.count(layers - 1)? as u32;
            let face = d.u8()?;
            let cull_face = if face == 255 {
                None
            } else {
                Some(*FACES.get(face as usize).ok_or("Invalid cached face")?)
            };
            let flags=d.u8()?;
            if flags & !15 != 0 {return Err("Invalid cached shading flags".into());}
            let render_layer = match flags & 3 {
                0 => RenderLayer::Opaque,
                1 => RenderLayer::Cutout,
                2 => RenderLayer::Translucent,
                _ => return Err("Invalid cached render layer".into()),
            };
            for v in &mut tint {
                *v = d.f32(1.)?;
                if *v < 0. {
                    return Err("Invalid cached tint".into());
                }
            }
            quads.push(BakedQuad {
                    shade: flags & 4 != 0, ambient_occlusion: flags & 8 != 0,
                positions,
                uv,
                layer,
                cull_face,
                tint,
                render_layer,
            });
        }
        unique.push(Arc::new(BlockModel {
            quads,
            opaque_full_cube: opaque == 1,
            cull_group: group,
        }));
    }
    let count = d.count(BlockState::MAX_STATE as usize + 1)?;
    if count != BlockState::MAX_STATE as usize + 1 {
        return Err("Cached registry does not match protocol".into());
    }
    let mut models = Vec::with_capacity(count);
    for _ in 0..count {
        let index = d.u32()? as usize;
        models.push(
            unique
                .get(index)
                .ok_or("Invalid cached model index")?
                .clone(),
        );
    }
    if d.position != bytes.len() {
        return Err("Trailing asset cache data".into());
    }
    Ok(AssetPack {
        weather_rgba,
        biome_colormaps,
        gui: Arc::new(crate::gui_assets::GuiAssets::empty()),
        textures_rgba: rgba,
        texture_size: TILE,
        texture_layers: layers as u32,
        models,
        font_layers,
        font_widths,
        default_skin_rgba: skin,
        default_skin_size: [64, 64],
        item_textures,
        entity_textures_rgba: entity_rgba,
        entity_texture_size: entity_size,
        entity_texture_layers: entity_layers as u32,
        entity_textures,
        cache_hit: true,
        load_ms: 0,
        unsupported_block_models: unsupported,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn item_gui_selection_keeps_parent_transform_and_uses_gui_branch() {
        let node = json!({"type":"minecraft:select","property":"minecraft:display_context","transformation":{"translation":[0.5,0.,0.]},"cases":[{"when":"gui","model":{"type":"minecraft:model","model":"minecraft:item/diamond_sword","transformation":{"scale":[2.,2.,2.]}}}],"fallback":{"type":"minecraft:empty"}});
        let mut choices = Vec::new();
        gui_item_nodes(&node, 0, &mut choices).unwrap();
        assert_eq!(choices.len(), 1);
        assert_eq!(choices[0].0["model"], "minecraft:item/diamond_sword");
        let p = choices[0].1.transform_point3(glam::Vec3::X);
        assert!((p.x - 2.5).abs() < 0.001);
    }
    #[test]
    fn generated_item_gui_raster_preserves_original_texels() {
        let piece = GuiPiece {
            tints: Vec::new(),
            front_light: true,
            transform: glam::Mat4::from_translation(glam::Vec3::splat(-0.5)),
            quads: vec![BakedQuad {
                    shade: true, ambient_occlusion: true,
                positions: [[0., 1., 0.5], [0., 0., 0.5], [1., 0., 0.5], [1., 1., 0.5]],
                uv: [[0., 0.], [0., 1.], [1., 1.], [1., 0.]],
                layer: 0,
                cull_face: None,
                tint: [1.; 3],
                render_layer: RenderLayer::Cutout,
            }],
        };
        let source = RgbaImage::from_fn(16, 16, |x, y| {
            image::Rgba([x as u8 * 16, y as u8 * 16, 80, 255])
        });
        let rendered = raster_gui_item(&[piece], &HashMap::from([(0, Arc::new(source.clone()))]));
        for y in 0..32 {
            for x in 0..32 {
                assert_eq!(rendered.get_pixel(x, y), source.get_pixel(x / 2, y / 2));
            }
        }
    }

    struct Fixture(std::path::PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    fn archive(entries: Vec<(&str, Vec<u8>)>) -> Fixture {
        let path = std::env::temp_dir().join(format!(
            "sakura-asset-fixture-{}-{}.zip",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut writer = zip::ZipWriter::new(File::create(&path).unwrap());
        for (name, bytes) in entries {
            writer
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(&bytes).unwrap();
        }
        writer.finish().unwrap();
        Fixture(path)
    }
    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            width,
            height,
            image::Rgba([255, 255, 255, 255]),
        ))
        .write_to(&mut output, image::ImageFormat::Png)
        .unwrap();
        output.into_inner()
    }

    #[test]
    fn actual_archive_bakes_inherited_material_objects_and_unprefixed_slots() {
        let fixture=archive(vec![
            ("assets/minecraft/models/block/parent.json",serde_json::to_vec(&json!({"textures":{"side":"#all"},"elements":[{"from":[0,0,0],"to":[16,16,16],"faces":{"north":{"texture":"side","cullface":"north"}}}]})).unwrap()),
            ("assets/minecraft/models/block/child.json",serde_json::to_vec(&json!({"parent":"block/parent","textures":{"all":{"sprite":"block/test","force_translucent":true}}})).unwrap()),
            ("assets/minecraft/textures/block/test.png",png(16,16)),
        ]);
        let mut baker = Baker::new(&fixture.0).unwrap();
        let mut quads = Vec::new();
        baker
            .bake_choice(
                &json!({"model":"block/child","y":90,"uvlock":true}),
                "fixture",
                &HashMap::new(),
                &mut quads,
            )
            .unwrap();
        assert_eq!(quads.len(), 1);
        assert_eq!(quads[0].cull_face, Some(Face::East));
        assert_eq!(quads[0].render_layer, RenderLayer::Translucent);
        assert!(
            quads[0]
                .positions
                .iter()
                .all(|p| (p[0] - 1.).abs() < 0.0001)
        );
        assert_eq!(baker.rgba.len(), 16 * 16 * 4);
    }

    #[test]
    fn archive_caps_reject_large_members_png_dimensions_and_parent_cycles() {
        let fixture = archive(vec![
            ("large.json", vec![b' '; 1024 * 1024 + 1]),
            ("wide.png", png(2049, 1)),
            (
                "assets/minecraft/models/block/a.json",
                br#"{"parent":"block/b"}"#.to_vec(),
            ),
            (
                "assets/minecraft/models/block/b.json",
                br#"{"parent":"block/a"}"#.to_vec(),
            ),
        ]);
        let mut baker = Baker::new(&fixture.0).unwrap();
        assert!(baker.json_path("large.json").is_err());
        assert!(baker.png("wide.png").is_err());
        assert!(baker.model("block/a", 0).is_err());
    }

    #[test]
    fn resource_identifiers_cannot_escape_an_archive_namespace() {
        for invalid in [
            "../private",
            "/absolute",
            "minecraft:../../x",
            "minecraft:a/../b",
            "minecraft:a\\b",
            "minecraft:a//b",
            "minecraft:a:bad",
            "C:/data",
        ] {
            assert!(resource(invalid).is_err(), "accepted {invalid}");
        }
        assert_eq!(
            asset_path("block/stone", "models", "json").unwrap(),
            "assets/minecraft/models/block/stone.json"
        );
    }

    #[test]
    fn texture_aliases_resolve_child_overrides_and_reject_cycles() {
        let model = Model {
            textures: HashMap::from([
                ("all".into(), "#side".into()),
                ("side".into(), "block/stone".into()),
            ]),
            elements: vec![],
            ..Default::default()
        };
        assert_eq!(
            resolve_texture(&model, "#all").unwrap(),
            "minecraft:block/stone"
        );
        let cyclic = Model {
            textures: HashMap::from([("a".into(), "#b".into()), ("b".into(), "#a".into())]),
            elements: vec![],
            ..Default::default()
        };
        assert!(resolve_texture(&cyclic, "#a").is_err());
    }

    #[test]
    fn multipart_supports_nested_boolean_and_pipe_conditions() {
        let properties = HashMap::from([
            ("facing", "east"),
            ("waterlogged", "false"),
            ("north", "true"),
        ]);
        assert!(condition_matches(
            &json!({"AND":[{"facing":"north|east"},{"OR":[{"north":"true"},{"waterlogged":"true"}]}]}),
            &properties,
            0
        ));
        assert!(!condition_matches(
            &json!({"facing":"south|west"}),
            &properties,
            0
        ));
        let state = json!({"multipart":[{"apply":{"model":"block/post"}},{"when":{"north":"true"},"apply":{"model":"block/side"}},{"when":{"waterlogged":"true"},"apply":{"model":"block/no"}}]});
        assert_eq!(selections(&state, &properties).len(), 2);
        let variants = json!({"variants":{"facing=east,waterlogged=false":{"model":"block/right"},"facing=west":{"model":"block/wrong"}}});
        assert_eq!(
            selections(&variants, &properties)[0]["model"],
            "block/right"
        );
    }

    #[test]
    fn faces_have_outward_winding_and_rotated_culling() {
        for face in FACES {
            let p = positions(face, [0.; 3], [1.; 3]);
            let a: [f32; 3] = std::array::from_fn(|i| p[1][i] - p[0][i]);
            let b: [f32; 3] = std::array::from_fn(|i| p[2][i] - p[0][i]);
            let cross = [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ];
            assert!(dot(cross, face.offset().map(|v| v as f32)) > 0.9);
        }
        assert_eq!(rotate_face(Face::North, 0., 90.), Face::East);
        assert_eq!(rotate_face(Face::North, 90., 0.), Face::Down);
    }

    fn pack() -> AssetPack {
        let cube = Arc::new(BlockModel {
            quads: FACES
                .into_iter()
                .map(|face| BakedQuad {
                    shade: true, ambient_occlusion: true,
                    positions: positions(face, [0.; 3], [1.; 3]),
                    uv: [[0., 0.], [0., 1.], [1., 1.], [1., 0.]],
                    layer: 1,
                    cull_face: Some(face),
                    tint: [1.; 3],
                    render_layer: RenderLayer::Opaque,
                })
                .collect(),
            opaque_full_cube: true,
            cull_group: 0,
        });
        AssetPack {
            gui: Arc::new(crate::gui_assets::GuiAssets::empty()),
            textures_rgba: vec![255; 2 * 16 * 16 * 4],
            texture_size: 16,
            texture_layers: 2,
            models: vec![cube; BlockState::MAX_STATE as usize + 1],
            font_layers: [1; 128],
            font_widths: [0.75; 128],
            default_skin_rgba: vec![255; 64 * 64 * 4],
            default_skin_size: [64, 64],
            item_textures: HashMap::from([(1, 1)]),
            weather_rgba: vec![255;64*256*4*2],
            biome_colormaps: vec![255;256*256*4*2],
            entity_textures_rgba: vec![255; 64 * 64 * 4],
            entity_texture_size: 64,
            entity_texture_layers: 1,
            entity_textures: HashMap::from([("creeper/creeper".into(), 0)]),
            cache_hit: false,
            load_ms: 0,
            unsupported_block_models: 0,
        }
    }

    #[test]
    fn binary_cache_preserves_shared_geometry_and_rejects_corruption() {
        let original = pack();
        let hash = [42; 32];
        let mut bytes = encode_cache(&original, &hash).unwrap();
        let loaded = decode_cache(&bytes, &hash).unwrap();
        assert_eq!(loaded.textures_rgba, original.textures_rgba);
        assert_eq!(loaded.entity_textures_rgba, original.entity_textures_rgba);
        assert_eq!(loaded.entity_textures, original.entity_textures);
        assert_eq!(loaded.models[0].quads.len(), 6);
        assert!(Arc::ptr_eq(&loaded.models[0], &loaded.models[100]));
        assert_eq!(loaded.models[0].quads[2].cull_face, Some(Face::Up));
        assert!(decode_cache(&bytes, &[43; 32]).is_err());
        assert!(decode_cache(&bytes[..bytes.len() - 1], &hash).is_err());
        bytes[100] ^= 1;
        assert!(decode_cache(&bytes, &hash).is_err());
    }

    #[test]
    fn even_checksummed_cache_cannot_request_unbounded_allocations() {
        let hash = [1; 32];
        let mut bytes = encode_cache(&pack(), &hash).unwrap();
        bytes[76..80].copy_from_slice(&u32::MAX.to_le_bytes());
        let checksum = Sha256::digest(&bytes[76..]);
        bytes[44..76].copy_from_slice(&checksum);
        assert!(decode_cache(&bytes, &hash).is_err());
        let nan = f32::NAN.to_le_bytes();
        assert!(
            Decoder {
                bytes: &nan,
                position: 0
            }
            .f32(32.)
            .is_err()
        );
    }

    #[test]
    fn only_complete_opaque_faces_occlude_neighbors() {
        let mut q = pack().models[0].quads[0].clone();
        assert!(complete_face(&q, Face::East));
        q.positions[0][1] = 0.5;
        assert!(!complete_face(&q, Face::East));
        q.positions = positions(Face::East, [0.; 3], [1.; 3]);
        q.render_layer = RenderLayer::Cutout;
        assert!(!complete_face(&q, Face::East));
    }

    #[test]
    fn atomic_cache_write_replaces_an_existing_corrupt_entry() {
        let directory = std::env::temp_dir().join(format!(
            "sakura-cache-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("cache.bin");
        fs::write(&path, b"broken").unwrap();
        atomic_write(&path, b"complete").unwrap();
        assert_eq!(read_bounded(&path, 8).unwrap(), b"complete");
        assert!(read_bounded(&path, 7).is_err());
        fs::remove_file(&path).unwrap();
        fs::remove_dir(&directory).unwrap();
    }

    /// Uses the user's separately installed, hash-verified game assets; never
    /// checks game files into this repository or downloads during a test.
    #[test]
    #[ignore = "set SAKURA_TEST_CLIENT_JAR to a verified Minecraft 26.1 client.jar"]
    fn real_version_matched_assets_cold_and_warm() {
        let path = std::env::var_os("SAKURA_TEST_CLIENT_JAR").expect("SAKURA_TEST_CLIENT_JAR");
        let cache = std::env::temp_dir().join(format!(
            "sakura-assets-acceptance-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let cold = load(Path::new(&path), &cache).expect("cold bake");
        let warm = load(Path::new(&path), &cache).expect("warm cache");
        assert!(!cold.cache_hit);
        assert!(warm.cache_hit);
        assert_eq!(cold.models.len(), BlockState::MAX_STATE as usize + 1);
        assert_eq!(cold.texture_layers, warm.texture_layers);
        assert_eq!(cold.textures_rgba, warm.textures_rgba);
        assert!(cold.texture_layers > 1000 && cold.texture_layers <= 2048);
        assert!(cold.font_layers[b'A' as usize] > 0);
        assert!(cold.item_textures.len() > 1000);
        assert_eq!(cold.entity_textures_rgba, warm.entity_textures_rgba);
        assert_eq!(cold.entity_textures, warm.entity_textures);
        assert_eq!(
            cold.entity_texture_layers as usize,
            crate::mob_models::texture_catalog().len()
        );
        assert!(cold.entity_texture_layers > 100 && cold.entity_texture_layers <= 256);
        assert!(cold.entity_textures.contains_key("cow/cow_temperate"));
        assert!(cold.entity_textures.contains_key("pig/pig_temperate_baby"));
        // Verify unscaled original texels, including transparent padded rows.
        let mut source = Baker::new(Path::new(&path)).unwrap();
        let creeper = source
            .png("assets/minecraft/textures/entity/creeper/creeper.png")
            .unwrap();
        let layer = cold.entity_textures["creeper/creeper"] as usize;
        let pixels = &cold.entity_textures_rgba[layer * 64 * 64 * 4..(layer + 1) * 64 * 64 * 4];
        for y in 0..creeper.height() as usize {
            let start = y * creeper.width() as usize * 4;
            assert_eq!(
                &pixels[y * 64 * 4..y * 64 * 4 + creeper.width() as usize * 4],
                &creeper.as_raw()[start..start + creeper.width() as usize * 4]
            );
        }
        assert!(
            pixels[creeper.height() as usize * 64 * 4..]
                .iter()
                .all(|v| *v == 0)
        );
        let mut checked = std::collections::HashSet::new();
        for id in 0..=BlockState::MAX_STATE {
            let block = Box::<dyn BlockTrait>::from(BlockState::try_from(id).unwrap());
            let model = &cold.models[id as usize];
            match block.id() {
                "stone" => {
                    assert!(model.opaque_full_cube);
                    assert_eq!(model.quads.len(), 6);
                    checked.insert("stone");
                }
                "oak_stairs" => {
                    assert!(!model.opaque_full_cube);
                    assert!(model.quads.len() >= 10);
                    checked.insert("stairs");
                }
                "oak_fence" => {
                    assert!(!model.opaque_full_cube);
                    assert!(!model.quads.is_empty());
                    checked.insert("fence");
                }
                "dandelion" => {
                    assert!(
                        model
                            .quads
                            .iter()
                            .all(|q| q.render_layer == RenderLayer::Cutout)
                    );
                    checked.insert("flower");
                }
                "water" => {
                    assert_eq!(model.cull_group, 1);
                    assert_eq!(model.quads.len(), 6);
                    checked.insert("water");
                }
                "chest" | "trapped_chest" | "ender_chest" => {
                    assert!(!model.opaque_full_cube);
                    assert!([15, 18].contains(&model.quads.len()));
                    assert!(
                        model
                            .quads
                            .iter()
                            .flat_map(|q| q.positions.iter().flatten())
                            .all(|v| (-0.001..=1.001).contains(v))
                    );
                    checked.insert("chest");
                }
                _ => {}
            }
        }
        assert_eq!(checked.len(), 6);
        eprintln!(
            "ASSET_ACCEPTANCE cold_ms={} warm_ms={} states={} layers={} icons={} block_entity_models={} cache={}",
            cold.load_ms,
            warm.load_ms,
            cold.models.len(),
            cold.texture_layers,
            cold.item_textures.len(),
            cold.unsupported_block_models,
            cache.display()
        );
    }
}
