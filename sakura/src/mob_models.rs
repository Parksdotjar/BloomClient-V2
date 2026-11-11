//! Original native entity mesh/pose implementation for the supported 26.1 mobs.
//! Cuboid dimensions, pivots and skin-UV locations were checked against the
//! model classes in the locally installed official 26.1 client JAR. Textures
//! remain in that installation; this module contains no copied image assets.
//!
//! Templates bake once. A visible entity updates at most MAX_PARTS transforms;
//! walking/head movement never rebuilds vertices or allocates a per-frame mesh.

use glam::{EulerRot, Mat4, Quat, Vec3};
use std::{collections::HashMap, sync::LazyLock};

pub const MAX_PARTS: usize = 32;
pub const TEXTURE_SIZE: u32 = 64;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MobAppearance {
    pub baby: bool,
    /// Registry resource path: e.g. temperate, snowy, tabby, brown.
    pub variant: String,
    /// Dye-color protocol index, used for wool/collars.
    pub color: u8,
    pub sheared: bool,
    pub sitting: bool,
    pub tamed: bool,
    pub angry: bool,
    pub size: u8,
    pub villager_type: String,
    pub profession: String,
}
impl Default for MobAppearance {
    fn default() -> Self {
        Self {
            baby: false,
            variant: String::new(),
            color: 0,
            sheared: false,
            sitting: false,
            tamed: false,
            angry: false,
            size: 1,
            villager_type: String::new(),
            profession: String::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MaterialSlot {
    Base,
    Wool,
    Eyes,
    Collar,
    VillagerType,
    VillagerProfession,
    Overlay,
    SlimeOuter,
}

#[derive(Clone, Debug)]
pub struct ModelQuad {
    /// Local joint coordinates in model pixels; pose_into converts to blocks.
    pub positions: [[f32; 3]; 4],
    /// Original texture pixels normalized against the separate 64px array.
    pub uv: [[f32; 2]; 4],
}
#[derive(Clone, Debug)]
pub struct ModelPart {
    pub name: &'static str,
    pub parent: Option<usize>,
    pub pivot: [f32; 3],
    pub rotation: [f32; 3],
    pub quads: Vec<ModelQuad>,
    pub material: MaterialSlot,
    // Material overlays often share the exact base joint. Resolve this once
    // while baking, rather than recomputing their trigonometry every frame.
    pose_source: Option<usize>,
}
#[derive(Clone, Debug)]
pub struct ModelDesc {
    pub key: &'static str,
    pub parts: Vec<ModelPart>,
    scale: f32,
    family: Family,
}
#[derive(Clone, Copy, Debug)]
enum Family {
    Quadruped,
    Zombie,
    Skeleton,
    Creeper,
    Enderman,
    Chicken,
    Wolf,
    Spider,
    Slime,
    Villager,
    Rabbit,
    Cat,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MobPose {
    /// Head yaw relative to body, in degrees.
    pub head_yaw: f32,
    pub pitch: f32,
    /// Continuous distance-driven gait phase, in radians.
    pub walk_phase: f32,
    pub walk_amount: f32,
    pub age_seconds: f32,
}

#[derive(Clone, Copy)]
struct Cube {
    from: [f32; 3],
    size: [f32; 3],
    uv: [f32; 2],
    inflate: f32,
    mirror: bool,
}
struct PartSpec {
    name: &'static str,
    parent: Option<usize>,
    pivot: [f32; 3],
    rotation: [f32; 3],
    cubes: &'static [Cube],
}

fn cube_quads(cube: &Cube, out: &mut Vec<ModelQuad>) {
    let [x, y, z] = cube.from.map(|v| v - cube.inflate);
    let [mut a, b, c] = std::array::from_fn(|i| cube.from[i] + cube.size[i] + cube.inflate);
    let mut x = x;
    if cube.mirror {
        std::mem::swap(&mut x, &mut a);
    }
    let p = [
        [x, y, z],
        [a, y, z],
        [a, b, z],
        [x, b, z],
        [x, y, c],
        [a, y, c],
        [a, b, c],
        [x, b, c],
    ];
    let [u, v] = cube.uv;
    let [w, h, d] = cube.size;
    // Vanilla's unfolded cuboid skin layout: side strip plus two top panels.
    // Polygon ordering/UV corners match the documented model pixel convention.
    let faces = [
        ([5, 1, 2, 6], [u + d + w, v + d, u + d + w + d, v + d + h]),
        ([0, 4, 7, 3], [u, v + d, u + d, v + d + h]),
        ([5, 4, 0, 1], [u + d, v, u + d + w, v + d]),
        ([2, 3, 7, 6], [u + d + w, v + d, u + d + w + w, v]),
        (
            [4, 5, 6, 7],
            [u + d + w + d, v + d, u + d + w + d + w, v + d + h],
        ),
        ([1, 0, 3, 2], [u + d, v + d, u + d + w, v + d + h]),
    ];
    for (indices, [u0, v0, u1, v1]) in faces {
        let mut positions = indices.map(|i| p[i]);
        let mut uv =
            [[u1, v0], [u0, v0], [u0, v1], [u1, v1]].map(|p| p.map(|v| v / TEXTURE_SIZE as f32));
        if cube.mirror {
            positions.reverse();
            uv.reverse();
        }
        // Zero-depth faces are intentional (ears, feathers, baby chicken feet).
        // Omit only zero-area triangles, retaining the opposite planar faces.
        let ab = Vec3::from(positions[1]) - Vec3::from(positions[0]);
        let ac = Vec3::from(positions[2]) - Vec3::from(positions[0]);
        if ab.cross(ac).length_squared() > 0.000001 {
            out.push(ModelQuad { positions, uv });
        }
    }
}

/// Shared skin-layout baker for static block entities such as closed chests.
pub(crate) fn cuboid_quads(from: [f32; 3], size: [f32; 3], uv: [f32; 2]) -> Vec<ModelQuad> {
    let mut quads = Vec::with_capacity(6);
    cube_quads(
        &Cube {
            from,
            size,
            uv,
            inflate: 0.,
            mirror: false,
        },
        &mut quads,
    );
    quads
}

fn template(
    key: &'static str,
    specs: &'static [PartSpec],
    family: Family,
    scale: f32,
) -> ModelDesc {
    let parts = specs
        .iter()
        .map(|spec| {
            let mut quads = Vec::with_capacity(spec.cubes.len() * 6);
            for cube in spec.cubes {
                cube_quads(cube, &mut quads);
            }
            ModelPart {
                name: spec.name,
                parent: spec.parent,
                pivot: spec.pivot,
                rotation: spec.rotation,
                quads,
                material: MaterialSlot::Base,
                pose_source: None,
            }
        })
        .collect();
    ModelDesc {
        key,
        parts,
        family,
        scale,
    }
}
fn overlay(model: &mut ModelDesc, specs: &'static [PartSpec], slot: MaterialSlot) {
    let start = model.parts.len();
    let mut layer = template("overlay", specs, model.family, 1.);
    for part in &mut layer.parts {
        part.pose_source = model.parts.iter().position(|base| {
            base.material == MaterialSlot::Base
                && base.name == part.name
                && base.parent == part.parent
                && base.pivot == part.pivot
                && base.rotation == part.rotation
        });
        part.parent = part.parent.map(|p| p + start);
        part.material = slot;
    }
    model.parts.extend(layer.parts);
    assert!(model.parts.len() <= MAX_PARTS);
}

fn safe_variant<'a>(value: &'a str, allowed: &[&str], fallback: &'a str) -> &'a str {
    let value = value.strip_prefix("minecraft:").unwrap_or(value);
    if allowed.contains(&value) {
        value
    } else {
        fallback
    }
}
fn climate(appearance: &MobAppearance) -> &str {
    safe_variant(
        &appearance.variant,
        &["temperate", "warm", "cold"],
        "temperate",
    )
}

pub fn model_for(kind: &str, appearance: &MobAppearance) -> Option<&'static ModelDesc> {
    let key = match kind {
        "Zombie" | "Husk" | "Drowned" => {
            if appearance.baby {
                "baby_zombie"
            } else {
                "zombie"
            }
        }
        "ZombieVillager" => {
            if appearance.baby {
                "baby_zombie_villager"
            } else {
                "zombie_villager"
            }
        }
        "Skeleton" | "Stray" => "skeleton",
        "WitherSkeleton" => "wither_skeleton",
        "Creeper" => "creeper",
        "Enderman" => "enderman",
        "Cow" => {
            if appearance.baby {
                "baby_cow"
            } else {
                match climate(appearance) {
                    "warm" => "warm_cow",
                    "cold" => "cold_cow",
                    _ => "cow",
                }
            }
        }
        "Pig" => {
            if appearance.baby {
                "baby_pig"
            } else if climate(appearance) == "cold" {
                "cold_pig"
            } else {
                "pig"
            }
        }
        "Chicken" => {
            if appearance.baby {
                "baby_chicken"
            } else if climate(appearance) == "cold" {
                "cold_chicken"
            } else {
                "chicken"
            }
        }
        "Sheep" => {
            if appearance.baby {
                "baby_sheep"
            } else {
                "sheep"
            }
        }
        "Wolf" => {
            if appearance.baby {
                "baby_wolf"
            } else {
                "wolf"
            }
        }
        "Spider" => "spider",
        "CaveSpider" => "cave_spider",
        "Slime" => "slime",
        "Villager" => {
            if appearance.baby {
                "baby_villager"
            } else {
                "villager"
            }
        }
        "Cat" => {
            if appearance.baby {
                "baby_cat"
            } else {
                "cat"
            }
        }
        "Ocelot" => {
            if appearance.baby {
                "baby_ocelot"
            } else {
                "ocelot"
            }
        }
        "Rabbit" => {
            if appearance.baby {
                "baby_rabbit"
            } else {
                "rabbit"
            }
        }
        _ => return None,
    };
    MODELS.get(key)
}

pub fn texture_for(kind: &str, a: &MobAppearance, slot: MaterialSlot) -> Option<String> {
    let baby = if a.baby { "_baby" } else { "" };
    match slot {
        MaterialSlot::Wool => {
            return (!a.sheared && kind == "Sheep").then(|| format!("sheep/sheep_wool{baby}"));
        }
        MaterialSlot::Eyes => {
            return match kind {
                "Spider" | "CaveSpider" => Some("spider/spider_eyes".into()),
                "Enderman" => Some("enderman/enderman_eyes".into()),
                _ => None,
            };
        }
        MaterialSlot::Collar => {
            return (a.tamed && matches!(kind, "Wolf" | "Cat")).then(|| {
                if kind == "Wolf" {
                    format!("wolf/wolf_collar{baby}")
                } else {
                    format!("cat/cat_collar{baby}")
                }
            });
        }
        MaterialSlot::VillagerType | MaterialSlot::VillagerProfession => {
            if !matches!(kind, "Villager" | "ZombieVillager") {
                return None;
            }
            let root = if kind == "Villager" {
                "villager"
            } else {
                "zombie_villager"
            };
            if slot == MaterialSlot::VillagerType {
                let variant = safe_variant(
                    &a.villager_type,
                    &[
                        "desert", "jungle", "plains", "savanna", "snow", "swamp", "taiga",
                    ],
                    "plains",
                );
                return Some(format!(
                    "{root}/{}/{variant}",
                    if a.baby { "baby" } else { "type" }
                ));
            }
            if a.baby {
                return None;
            }
            let profession = safe_variant(
                &a.profession,
                &[
                    "armorer",
                    "butcher",
                    "cartographer",
                    "cleric",
                    "farmer",
                    "fisherman",
                    "fletcher",
                    "leatherworker",
                    "librarian",
                    "mason",
                    "nitwit",
                    "shepherd",
                    "toolsmith",
                    "weaponsmith",
                ],
                "",
            );
            return (!profession.is_empty()).then(|| format!("{root}/profession/{profession}"));
        }
        MaterialSlot::Overlay => {
            return match kind {
                "Drowned" => Some(format!("zombie/drowned_outer_layer{baby}")),
                "Stray" => Some("skeleton/stray_overlay".into()),
                _ => None,
            };
        }
        MaterialSlot::SlimeOuter => return (kind == "Slime").then(|| "slime/slime".into()),
        MaterialSlot::Base => {}
    }
    Some(match kind {
        "Zombie" => format!("zombie/zombie{baby}"),
        "Husk" => format!("zombie/husk{baby}"),
        "Drowned" => format!("zombie/drowned{baby}"),
        "ZombieVillager" => format!("zombie_villager/zombie_villager{baby}"),
        "Skeleton" => "skeleton/skeleton".into(),
        "WitherSkeleton" => "skeleton/wither_skeleton".into(),
        "Stray" => "skeleton/stray".into(),
        "Creeper" => "creeper/creeper".into(),
        "Enderman" => "enderman/enderman".into(),
        "Cow" => format!("cow/cow_{}{baby}", climate(a)),
        "Pig" => format!("pig/pig_{}{baby}", climate(a)),
        "Chicken" => format!("chicken/chicken_{}{baby}", climate(a)),
        "Sheep" => format!("sheep/sheep{baby}"),
        "Wolf" => {
            let variant = safe_variant(
                &a.variant,
                &[
                    "pale", "ashen", "black", "chestnut", "rusty", "snowy", "spotted", "striped",
                    "woods",
                ],
                "pale",
            );
            format!(
                "wolf/wolf{}{}{baby}",
                if variant == "pale" {
                    String::new()
                } else {
                    format!("_{variant}")
                },
                if a.angry {
                    "_angry"
                } else if a.tamed {
                    "_tame"
                } else {
                    ""
                }
            )
        }
        "Spider" => "spider/spider".into(),
        "CaveSpider" => "spider/cave_spider".into(),
        "Slime" => "slime/slime".into(),
        "Villager" => format!("villager/villager{baby}"),
        "Cat" => format!(
            "cat/cat_{}{baby}",
            safe_variant(
                &a.variant,
                &[
                    "all_black",
                    "black",
                    "british_shorthair",
                    "calico",
                    "jellie",
                    "persian",
                    "ragdoll",
                    "red",
                    "siamese",
                    "tabby",
                    "white"
                ],
                "tabby"
            )
        ),
        "Ocelot" => format!("cat/ocelot{baby}"),
        "Rabbit" => format!(
            "rabbit/rabbit_{}{baby}",
            safe_variant(
                &a.variant,
                &[
                    "black",
                    "brown",
                    "caerbannog",
                    "gold",
                    "salt",
                    "toast",
                    "white",
                    "white_splotched"
                ],
                "brown"
            )
        ),
        _ => return None,
    })
}

pub fn tint_for(_kind: &str, a: &MobAppearance, slot: MaterialSlot) -> [f32; 4] {
    const DYE: [u32; 16] = [
        0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52, 0x9d9d97,
        0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21,
    ];
    if matches!(slot, MaterialSlot::Wool | MaterialSlot::Collar) {
        let c = DYE[a.color.min(15) as usize];
        return [
            ((c >> 16) & 255) as f32 / 255.,
            ((c >> 8) & 255) as f32 / 255.,
            (c & 255) as f32 / 255.,
            1.,
        ];
    }
    [
        1.,
        1.,
        1.,
        if slot == MaterialSlot::SlimeOuter {
            0.65
        } else {
            1.
        },
    ]
}

/// No world position or body yaw is included. Output is ground-origin block
/// space, facing +Z; the renderer adds its camera-relative entity transform.
pub fn pose_into(model: &ModelDesc, a: &MobAppearance, p: &MobPose, out: &mut [Mat4; MAX_PARTS]) {
    let finite = |v: f32| if v.is_finite() { v } else { 0. };
    let amount = finite(p.walk_amount).clamp(0., 1.);
    let phase = finite(p.walk_phase);
    let yaw = finite(p.head_yaw).clamp(-85., 85.).to_radians();
    let pitch = finite(p.pitch).clamp(-80., 80.).to_radians();
    let size = if matches!(model.family, Family::Slime) {
        a.size.clamp(1, 16) as f32
    } else {
        1.
    };
    let root = Mat4::from_scale(Vec3::splat(model.scale * size))
        * Mat4::from_translation(Vec3::new(0., 1.5, 0.))
        * Mat4::from_scale(Vec3::new(1. / 16., -1. / 16., -1. / 16.));
    for (i, part) in model.parts.iter().enumerate() {
        if let Some(source) = part.pose_source {
            out[i] = out[source];
            continue;
        }
        let mut pivot = Vec3::from(part.pivot);
        let mut rotation = part.rotation;
        let head = part.name == "head" || (model.key == "baby_chicken" && part.name == "body");
        if head {
            rotation[0] += pitch;
            rotation[1] += yaw;
        }
        let leg = part.name.ends_with("leg") || part.name.ends_with("foot");
        let right = part.name.starts_with("right");
        let hind = part.name.contains("hind");
        let swing = (phase
            + if right ^ hind {
                std::f32::consts::PI
            } else {
                0.
            })
        .cos()
            * amount;
        match model.family {
            Family::Spider => {
                if leg {
                    let pair = if part.name.contains("middle_hind") {
                        1.
                    } else if part.name.contains("middle_front") {
                        2.
                    } else if part.name.contains("front") {
                        3.
                    } else {
                        0.
                    };
                    rotation[1] += (phase * 2. + pair * std::f32::consts::FRAC_PI_2).cos()
                        * 0.35
                        * amount
                        * if right { 1. } else { -1. };
                    rotation[2] += (phase + pair * std::f32::consts::FRAC_PI_2).sin().abs()
                        * 0.5
                        * amount
                        * if right { 1. } else { -1. };
                }
            }
            Family::Zombie => {
                if leg {
                    rotation[0] += swing * 1.1;
                }
                if part.name.ends_with("arm") {
                    rotation[0] =
                        -std::f32::consts::FRAC_PI_2 + 0.08 * (finite(p.age_seconds) * 2.2).sin();
                    rotation[2] = if right { -0.05 } else { 0.05 };
                }
            }
            Family::Enderman => {
                if leg || part.name.ends_with("arm") {
                    rotation[0] += swing * 0.3;
                }
            }
            Family::Rabbit => {
                if part.name.contains("haunch") || leg || part.name.ends_with("foot") {
                    rotation[0] += phase.sin().max(0.) * amount * 0.5;
                }
                if part.parent.is_none() {
                    pivot.y -= phase.sin().max(0.) * amount * 1.5;
                }
            }
            Family::Chicken => {
                if leg {
                    rotation[0] += swing * 1.2;
                }
                if part.name.ends_with("wing") {
                    rotation[2] += (finite(p.age_seconds) * 6.).sin()
                        * 0.08
                        * amount
                        * if right { -1. } else { 1. };
                }
            }
            Family::Wolf | Family::Cat => {
                if leg {
                    rotation[0] += swing * 1.0 * if a.sitting { 0. } else { 1. };
                }
                if part.name == "tail" || part.name == "tail1" {
                    rotation[1] += (phase * 0.8).sin() * 0.15 * if a.angry { 0. } else { 1. };
                }
                if a.sitting && !a.baby {
                    if part.name == "body" {
                        rotation[0] = std::f32::consts::FRAC_PI_4;
                        pivot.y += 3.;
                        pivot.z -= 1.;
                    }
                    if part.name == "upper_body" {
                        rotation[0] = 1.2566;
                        pivot.y += 2.;
                    }
                    if hind && leg {
                        rotation[0] = -std::f32::consts::FRAC_PI_2;
                        pivot.y = 22.;
                        pivot.z = 2.;
                    }
                    if part.name == "tail" {
                        pivot.y += 6.;
                    }
                }
            }
            _ => {
                if leg || matches!(model.family, Family::Skeleton) && part.name.ends_with("arm") {
                    rotation[0] += swing * 1.0;
                }
            }
        }
        let transform = Mat4::from_rotation_translation(
            Quat::from_euler(EulerRot::ZYX, rotation[2], rotation[1], rotation[0]),
            pivot,
        );
        out[i] = part.parent.map_or(root, |parent| out[parent]) * transform;
    }
}

static MODELS: LazyLock<HashMap<&'static str, ModelDesc>> = LazyLock::new(build_models);

fn build_models() -> HashMap<&'static str, ModelDesc> {
    let definitions: [(&str, &[PartSpec], Family, f32); 33] = [
        ("zombie", ZOMBIE, Family::Zombie, 1.),
        ("baby_zombie", BABY_ZOMBIE, Family::Zombie, 1.),
        ("zombie_villager", ZOMBIE_VILLAGER, Family::Zombie, 1.),
        (
            "baby_zombie_villager",
            BABY_ZOMBIE_VILLAGER,
            Family::Zombie,
            1.,
        ),
        ("skeleton", SKELETON, Family::Skeleton, 1.),
        ("wither_skeleton", SKELETON, Family::Skeleton, 1.2),
        ("creeper", CREEPER, Family::Creeper, 1.),
        ("enderman", ENDERMAN, Family::Enderman, 1.),
        ("cow", COW, Family::Quadruped, 1.),
        ("warm_cow", WARM_COW, Family::Quadruped, 1.),
        ("cold_cow", COLD_COW, Family::Quadruped, 1.),
        ("baby_cow", BABY_COW, Family::Quadruped, 1.),
        ("pig", PIG, Family::Quadruped, 1.),
        ("cold_pig", COLD_PIG, Family::Quadruped, 1.),
        ("baby_pig", BABY_PIG, Family::Quadruped, 1.),
        ("chicken", CHICKEN, Family::Chicken, 1.),
        ("cold_chicken", COLD_CHICKEN, Family::Chicken, 1.),
        ("baby_chicken", BABY_CHICKEN, Family::Chicken, 1.),
        ("sheep", SHEEP, Family::Quadruped, 1.),
        ("baby_sheep", BABY_SHEEP, Family::Quadruped, 1.),
        ("wolf", WOLF, Family::Wolf, 1.),
        ("baby_wolf", BABY_WOLF, Family::Wolf, 1.),
        ("spider", SPIDER, Family::Spider, 1.),
        ("cave_spider", SPIDER, Family::Spider, 0.7),
        ("slime", SLIME, Family::Slime, 1.),
        ("villager", VILLAGER, Family::Villager, 1.),
        ("baby_villager", BABY_VILLAGER, Family::Villager, 1.),
        ("cat", CAT, Family::Cat, 0.8),
        ("baby_cat", BABY_CAT, Family::Cat, 1.),
        ("ocelot", CAT, Family::Cat, 1.),
        ("baby_ocelot", BABY_CAT, Family::Cat, 1.),
        ("rabbit", RABBIT, Family::Rabbit, 1.),
        ("baby_rabbit", BABY_RABBIT, Family::Rabbit, 1.),
    ];
    let mut models = HashMap::new();
    for (key, specs, family, scale) in definitions {
        let mut model = template(key, specs, family, scale);
        match key {
            "sheep" => overlay(&mut model, WOOL, MaterialSlot::Wool),
            "baby_sheep" => overlay(&mut model, BABY_SHEEP, MaterialSlot::Wool),
            "wolf" | "baby_wolf" | "cat" | "baby_cat" => {
                overlay(&mut model, specs, MaterialSlot::Collar)
            }
            "spider" | "cave_spider" | "enderman" => overlay(&mut model, specs, MaterialSlot::Eyes),
            "slime" => overlay(&mut model, SLIME_OUTER, MaterialSlot::SlimeOuter),
            "villager" | "zombie_villager" => {
                overlay(&mut model, specs, MaterialSlot::VillagerType);
                overlay(&mut model, specs, MaterialSlot::VillagerProfession);
            }
            "baby_villager" | "baby_zombie_villager" => {
                overlay(&mut model, specs, MaterialSlot::VillagerType)
            }
            "zombie" | "baby_zombie" | "skeleton" => {
                overlay(&mut model, specs, MaterialSlot::Overlay)
            }
            _ => {}
        }
        models.insert(key, model);
    }
    models
}

pub const SUPPORTED_KINDS: &[&str] = &[
    "Zombie",
    "Husk",
    "Drowned",
    "ZombieVillager",
    "Skeleton",
    "Stray",
    "WitherSkeleton",
    "Creeper",
    "Enderman",
    "Cow",
    "Pig",
    "Chicken",
    "Sheep",
    "Wolf",
    "Spider",
    "CaveSpider",
    "Slime",
    "Villager",
    "Cat",
    "Ocelot",
    "Rabbit",
];
pub const MATERIAL_SLOTS: [MaterialSlot; 8] = [
    MaterialSlot::Base,
    MaterialSlot::Wool,
    MaterialSlot::Eyes,
    MaterialSlot::Collar,
    MaterialSlot::VillagerType,
    MaterialSlot::VillagerProfession,
    MaterialSlot::Overlay,
    MaterialSlot::SlimeOuter,
];

/// Only skins actually used by supported templates/variants are decoded. Other
/// game entity assets remain in the JAR and do not occupy startup RAM/VRAM.
pub fn texture_catalog() -> &'static [String] {
    static CATALOG: LazyLock<Vec<String>> = LazyLock::new(|| {
        let mut textures = std::collections::BTreeSet::new();
        textures.insert("shadow".to_string());
        for kind in SUPPORTED_KINDS {
            let variants: &[&str] = match *kind {
                "Cow" | "Pig" | "Chicken" => &["temperate", "warm", "cold"],
                "Wolf" => &[
                    "pale", "ashen", "black", "chestnut", "rusty", "snowy", "spotted", "striped",
                    "woods",
                ],
                "Cat" => &[
                    "all_black",
                    "black",
                    "british_shorthair",
                    "calico",
                    "jellie",
                    "persian",
                    "ragdoll",
                    "red",
                    "siamese",
                    "tabby",
                    "white",
                ],
                "Rabbit" => &[
                    "black",
                    "brown",
                    "caerbannog",
                    "gold",
                    "salt",
                    "toast",
                    "white",
                    "white_splotched",
                ],
                _ => &[""],
            };
            for baby in [false, true] {
                for variant in variants {
                    for mood in 0..3 {
                        let a = MobAppearance {
                            baby,
                            variant: (*variant).into(),
                            tamed: mood == 1,
                            angry: mood == 2,
                            ..Default::default()
                        };
                        for slot in MATERIAL_SLOTS {
                            if let Some(path) = texture_for(kind, &a, slot) {
                                textures.insert(path);
                            }
                        }
                    }
                }
            }
            if matches!(*kind, "Villager" | "ZombieVillager") {
                for baby in [false, true] {
                    for region in [
                        "desert", "jungle", "plains", "savanna", "snow", "swamp", "taiga",
                    ] {
                        let a = MobAppearance {
                            baby,
                            villager_type: region.into(),
                            ..Default::default()
                        };
                        textures.insert(texture_for(kind, &a, MaterialSlot::VillagerType).unwrap());
                    }
                }
                for profession in [
                    "armorer",
                    "butcher",
                    "cartographer",
                    "cleric",
                    "farmer",
                    "fisherman",
                    "fletcher",
                    "leatherworker",
                    "librarian",
                    "mason",
                    "nitwit",
                    "shepherd",
                    "toolsmith",
                    "weaponsmith",
                ] {
                    let a = MobAppearance {
                        profession: profession.into(),
                        ..Default::default()
                    };
                    textures
                        .insert(texture_for(kind, &a, MaterialSlot::VillagerProfession).unwrap());
                }
            }
        }
        textures.into_iter().collect()
    });
    &CATALOG
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_templates_have_bounded_uvs_and_parent_before_child() {
        for model in MODELS.values() {
            assert!(model.parts.len() <= MAX_PARTS, "{}", model.key);
            let mut faces = 0;
            for (i, part) in model.parts.iter().enumerate() {
                assert!(
                    part.parent.is_none_or(|p| p < i),
                    "{}:{}",
                    model.key,
                    part.name
                );
                for q in &part.quads {
                    faces += 1;
                    assert!(
                        q.positions
                            .iter()
                            .flatten()
                            .all(|v| v.is_finite() && v.abs() <= 64.)
                    );
                    assert!(
                        q.uv.iter()
                            .flatten()
                            .all(|v| v.is_finite() && (-0.001..=1.001).contains(v)),
                        "UVs {}:{} {:?}",
                        model.key,
                        part.name,
                        q.uv
                    );
                }
            }
            assert!((24..=512).contains(&faces), "{} {faces}", model.key);
        }
        assert!(model_for("EnderDragon", &Default::default()).is_none());
        assert!(model_for("Piglin", &Default::default()).is_none());
    }

    #[test]
    fn cuboid_skin_front_uses_the_actual_head_panel_and_outward_faces() {
        for mirror in [false, true] {
            let cube = Cube {
                from: [-4., -8., -4.],
                size: [8.; 3],
                uv: [0.; 2],
                inflate: 0.,
                mirror,
            };
            let mut quads = Vec::new();
            cube_quads(&cube, &mut quads);
            assert_eq!(quads.len(), 6);
            for q in &quads {
                let points = q.positions.map(Vec3::from);
                let normal = (points[1] - points[0]).cross(points[2] - points[0]);
                let center = points.iter().sum::<Vec3>() / 4. - Vec3::new(0., -4., 0.);
                assert!(normal.dot(center) > 0.);
            }
            let front = quads
                .iter()
                .find(|q| q.positions.iter().all(|p| p[2] == -4.))
                .unwrap();
            assert!(
                front
                    .uv
                    .iter()
                    .all(|p| (0.125..=0.25).contains(&p[0]) && (0.125..=0.25).contains(&p[1]))
            );
        }
    }

    fn bounds(model: &ModelDesc, a: &MobAppearance) -> (Vec3, Vec3) {
        let mut poses = [Mat4::IDENTITY; MAX_PARTS];
        pose_into(model, a, &MobPose::default(), &mut poses);
        let (mut min, mut max) = (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY));
        for (i, part) in model.parts.iter().enumerate() {
            for q in &part.quads {
                for p in q.positions {
                    let p = poses[i].transform_point3(Vec3::from(p));
                    min = min.min(p);
                    max = max.max(p);
                }
            }
        }
        (min, max)
    }

    #[test]
    fn species_proportions_and_new_baby_shapes_are_not_generic_scaled_boxes() {
        let adult = MobAppearance::default();
        let baby = MobAppearance {
            baby: true,
            ..Default::default()
        };
        let enderman = model_for("Enderman", &adult).unwrap();
        let (_, end) = bounds(enderman, &adult);
        assert!(end.y > 2.7 && end.y < 3.1);
        let creeper = model_for("Creeper", &adult).unwrap();
        let (min, max) = bounds(creeper, &adult);
        assert!(min.y.abs() < 0.001);
        assert!((max.y - 1.625).abs() < 0.001);
        for kind in [
            "Cow", "Pig", "Chicken", "Sheep", "Wolf", "Villager", "Zombie", "Cat", "Rabbit",
        ] {
            let a = model_for(kind, &adult).unwrap();
            let b = model_for(kind, &baby).unwrap();
            assert_ne!(a.key, b.key);
            let (_, amax) = bounds(a, &adult);
            let (bmin, bmax) = bounds(b, &baby);
            assert!(
                bmax.y < amax.y,
                "{kind} baby was not smaller: {bmax} {amax}"
            );
            assert!(bmin.y > -0.2, "{kind} feet below ground: {bmin}");
        }
        assert_ne!(
            model_for("Chicken", &adult).unwrap().parts.len(),
            model_for("Chicken", &baby).unwrap().parts.len()
        );
    }

    #[test]
    fn texture_variants_and_metadata_do_not_allocate_new_mesh_templates() {
        let white = MobAppearance::default();
        let red = MobAppearance {
            color: 14,
            ..Default::default()
        };
        assert!(std::ptr::eq(
            model_for("Sheep", &white).unwrap(),
            model_for("Sheep", &red).unwrap()
        ));
        assert_ne!(
            tint_for("Sheep", &white, MaterialSlot::Wool),
            tint_for("Sheep", &red, MaterialSlot::Wool)
        );
        let winter = MobAppearance {
            variant: "cold".into(),
            ..Default::default()
        };
        assert_eq!(model_for("Cow", &winter).unwrap().key, "cold_cow");
        assert_eq!(
            texture_for("Cow", &winter, MaterialSlot::Base).as_deref(),
            Some("cow/cow_cold")
        );
        let invalid = MobAppearance {
            variant: "../../private".into(),
            profession: "../../private".into(),
            ..Default::default()
        };
        assert_eq!(
            texture_for("Wolf", &invalid, MaterialSlot::Base).as_deref(),
            Some("wolf/wolf")
        );
        assert!(texture_for("Villager", &invalid, MaterialSlot::VillagerProfession).is_none());
        let catalog = texture_catalog();
        assert!(catalog.len() > 100 && catalog.len() <= 256);
        assert!(catalog.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn walking_and_head_look_only_change_finite_joint_transforms() {
        let appearance = MobAppearance::default();
        let model = model_for("Cow", &appearance).unwrap();
        let mut idle = [Mat4::IDENTITY; MAX_PARTS];
        let mut walking = idle;
        pose_into(model, &appearance, &MobPose::default(), &mut idle);
        pose_into(
            model,
            &appearance,
            &MobPose {
                head_yaw: 35.,
                pitch: 20.,
                walk_phase: 0.5,
                walk_amount: 0.8,
                age_seconds: 12.,
            },
            &mut walking,
        );
        assert_ne!(idle[0], walking[0]);
        assert!(walking[..model.parts.len()].iter().all(|m| m.is_finite()));
        assert!(
            model
                .parts
                .iter()
                .enumerate()
                .any(|(i, p)| p.name.ends_with("leg") && idle[i] != walking[i])
        );
        pose_into(
            model,
            &appearance,
            &MobPose {
                head_yaw: f32::NAN,
                pitch: f32::INFINITY,
                walk_phase: f32::NAN,
                walk_amount: f32::NAN,
                age_seconds: f32::NAN,
            },
            &mut walking,
        );
        assert!(walking[..model.parts.len()].iter().all(|m| m.is_finite()));
    }

    #[test]
    fn prelinked_overlay_poses_match_independent_joint_evaluation() {
        let mut shared_joints = 0;
        for model in MODELS.values() {
            let mut independent = model.clone();
            for part in &mut independent.parts {
                shared_joints += usize::from(part.pose_source.is_some());
                part.pose_source = None;
            }
            for sitting in [false, true] {
                let appearance = MobAppearance {
                    sitting,
                    size: 3,
                    ..Default::default()
                };
                let pose = MobPose {
                    head_yaw: -38.,
                    pitch: 24.,
                    walk_phase: 1.7,
                    walk_amount: 0.65,
                    age_seconds: 17.,
                };
                let mut fast = [Mat4::IDENTITY; MAX_PARTS];
                let mut reference = fast;
                pose_into(model, &appearance, &pose, &mut fast);
                pose_into(&independent, &appearance, &pose, &mut reference);
                for i in 0..model.parts.len() {
                    assert!(
                        fast[i].abs_diff_eq(reference[i], 0.000001),
                        "{} joint{i}",
                        model.key
                    );
                }
            }
        }
        assert!(shared_joints > 100);
    }
}

// Model-space measurements and UV origins verified against the local26.1 model builders.
static RABBIT: &[PartSpec] = &[
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 23., 4.],
        rotation: [-0.3927, 0., 0.],
        cubes: &[Cube {
            from: [-4., -6., -9.],
            size: [8., 6., 10.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "tail",
        parent: Some(0),
        pivot: [0., -4.9916, 0.0125],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., -3.0084, -1.0125],
            size: [4., 4., 4.],
            uv: [20., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "head",
        parent: Some(0),
        pivot: [0., -5.2929, -8.1213],
        rotation: [0.3927, 0., 0.],
        cubes: &[Cube {
            from: [-2.5, -3., -4.],
            size: [5., 5., 5.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_ear",
        parent: Some(2),
        pivot: [1.5, -3.7071, -0.8787],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -4.2929, -0.1213],
            size: [2., 5., 1.],
            uv: [32., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_ear",
        parent: Some(2),
        pivot: [-1.5, -3.7071, -0.8787],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -4.2929, -0.1213],
            size: [2., 5., 1.],
            uv: [26., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "frontlegs",
        parent: Some(0),
        pivot: [0., -1.5349, -6.3108],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "right_front_leg",
        parent: Some(5),
        pivot: [-2., 1.9239, 0.3827],
        rotation: [0.3927, 0., 0.],
        cubes: &[Cube {
            from: [-0.9, -1., -0.9],
            size: [2., 4., 2.],
            uv: [36., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: Some(5),
        pivot: [2., 1.9239, 0.4827],
        rotation: [0.3927, 0., 0.],
        cubes: &[Cube {
            from: [-1., -1., -1.],
            size: [2., 4., 2.],
            uv: [44., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "backlegs",
        parent: None,
        pivot: [0., 23., 4.],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: Some(8),
        pivot: [-3., 0.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "right_haunch",
        parent: Some(9),
        pivot: [0., -0.5, 0.],
        rotation: [0., 0.3927, 0.],
        cubes: &[Cube {
            from: [-1., 0., -5.],
            size: [2., 1., 6.],
            uv: [20., 24.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: Some(8),
        pivot: [3., 0.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "left_haunch",
        parent: Some(11),
        pivot: [0., -0.5, 0.],
        rotation: [0., -0.3927, 0.],
        cubes: &[Cube {
            from: [-1., 0., -5.],
            size: [2., 1., 6.],
            uv: [36., 24.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static BABY_RABBIT: &[PartSpec] = &[
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 23., 1.6],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "body_r1",
        parent: Some(0),
        pivot: [0., -2., -1.6],
        rotation: [-0.5236, 0., 0.],
        cubes: &[Cube {
            from: [-2., -2., -3.],
            size: [4., 3., 6.],
            uv: [0., 8.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "tail",
        parent: Some(0),
        pivot: [0., -2.2, 2.],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "tail_r1",
        parent: Some(2),
        pivot: [-0.1, 0., 0.],
        rotation: [-0.5236, 0., 0.],
        cubes: &[Cube {
            from: [-1.4, -2.0268, -1.0177],
            size: [3., 3., 3.],
            uv: [0., 21.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "head",
        parent: Some(0),
        pivot: [0., -5., -2.6],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2.5, -3., -3.],
            size: [5., 4., 4.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_ear",
        parent: Some(4),
        pivot: [-1.5, -3.5, -0.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -3.5, -0.5],
            size: [2., 4., 1.],
            uv: [18., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_ear",
        parent: Some(4),
        pivot: [1.5, -3.5, -0.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -3.5, -0.5],
            size: [2., 4., 1.],
            uv: [24., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "frontlegs",
        parent: Some(0),
        pivot: [0., -2.5, -2.6],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "left_front_leg",
        parent: Some(7),
        pivot: [1., 1., -0.5],
        rotation: [0.3927, 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "left_front_leg_r1",
        parent: Some(8),
        pivot: [0., 1., 0.],
        rotation: [-0.3927, 0., 0.],
        cubes: &[Cube {
            from: [-0.5, -1.5, -0.5],
            size: [1., 3., 1.],
            uv: [18., 8.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: Some(7),
        pivot: [-1., 1., -0.5],
        rotation: [0.3927, 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "right_front_leg_r1",
        parent: Some(10),
        pivot: [0., 1., 0.],
        rotation: [-0.3927, 0., 0.],
        cubes: &[Cube {
            from: [-0.5, -1.5, -0.5],
            size: [1., 3., 1.],
            uv: [14., 8.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "backlegs",
        parent: None,
        pivot: [0., 23., 2.],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: Some(12),
        pivot: [1.5, 0.5, 0.5],
        rotation: [0., 3.1416, 0.],
        cubes: &[],
    },
    PartSpec {
        name: "left_haunch",
        parent: Some(13),
        pivot: [1., 0., 0.5],
        rotation: [0., -0.7854, 0.],
        cubes: &[Cube {
            from: [-2., -0.5, 0.],
            size: [2., 1., 3.],
            uv: [10., 17.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: Some(12),
        pivot: [-1.5, 0.5, 0.5],
        rotation: [0., 3.1416, 0.],
        cubes: &[],
    },
    PartSpec {
        name: "right_haunch",
        parent: Some(15),
        pivot: [0.5, 0., -0.9],
        rotation: [0., 0.7854, 0.],
        cubes: &[Cube {
            from: [-2., -0.5, 0.],
            size: [2., 1., 3.],
            uv: [0., 17.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static CAT: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 15., -9.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-2.5, -2., -3.],
                size: [5., 4., 5.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-1.5, -0.001, -4.],
                size: [3., 2., 2.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-2., -3., 0.],
                size: [1., 1., 2.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [1., -3., 0.],
                size: [1., 1., 2.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 12., -10.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[Cube {
            from: [-2., 3., -8.],
            size: [4., 16., 6.],
            uv: [20., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "tail1",
        parent: None,
        pivot: [0., 15., 8.],
        rotation: [0.9, 0., 0.],
        cubes: &[Cube {
            from: [-0.5, 0., 0.],
            size: [1., 8., 1.],
            uv: [0., 15.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "tail2",
        parent: None,
        pivot: [0., 20., 14.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-0.5, 0., 0.],
            size: [1., 8., 1.],
            uv: [4., 15.],
            inflate: -0.02,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [1.1, 18., 5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., 1.],
            size: [2., 6., 2.],
            uv: [8., 13.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-1.1, 18., 5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., 1.],
            size: [2., 6., 2.],
            uv: [8., 13.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [1.2, 14.1, -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., 0.],
            size: [2., 10., 2.],
            uv: [40., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-1.2, 14.1, -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., 0.],
            size: [2., 10., 2.],
            uv: [40., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static BABY_CAT: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 20., -3.125],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-2.5, -3., -2.875],
                size: [5., 4., 4.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-2., -4., -0.875],
                size: [1., 1., 2.],
                uv: [18., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [1., -4., -0.875],
                size: [1., 1., 2.],
                uv: [24., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-1.5, -1., -3.875],
                size: [3., 2., 1.],
                uv: [18., 3.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [1., 22., -1.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-0.5, 0., -1.],
            size: [1., 2., 2.],
            uv: [18., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-1., 22., -1.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-0.5, 0., -1.],
            size: [1., 2., 2.],
            uv: [12., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [1., 22., 2.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-0.5, 0., -1.],
            size: [1., 2., 2.],
            uv: [18., 22.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 20.5, 0.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., -1.5, -3.5],
            size: [4., 3., 7.],
            uv: [0., 8.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-1., 22., 2.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-0.5, 0., -1.],
            size: [1., 2., 2.],
            uv: [12., 22.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "tail1",
        parent: None,
        pivot: [0., 19.107, 3.9151],
        rotation: [-0.567232, 0., 0.],
        cubes: &[Cube {
            from: [-0.5, -0.107, 0.0849],
            size: [1., 1., 5.],
            uv: [0., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "tail2",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
];
static ZOMBIE_VILLAGER: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-4., -10., -4.],
                size: [8., 10., 8.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-1., -3., -6.],
                size: [2., 4., 2.],
                uv: [24., 0.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "hat",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -10., -4.],
            size: [8., 10., 8.],
            uv: [32., 0.],
            inflate: 0.5,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat_rim",
        parent: Some(1),
        pivot: [0., 0., 0.],
        rotation: [-1.5707964, 0., 0.],
        cubes: &[Cube {
            from: [-8., -8., -6.],
            size: [16., 16., 1.],
            uv: [30., 47.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-4., 0., -3.],
                size: [8., 12., 6.],
                uv: [16., 20.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-4., 0., -3.],
                size: [8., 20., 6.],
                uv: [0., 38.],
                inflate: 0.05,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_arm",
        parent: None,
        pivot: [-5., 2., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3., -2., -2.],
            size: [4., 12., 4.],
            uv: [44., 22.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_arm",
        parent: None,
        pivot: [5., 2., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -2., -2.],
            size: [4., 12., 4.],
            uv: [44., 22.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-2., 12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 22.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [2., 12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 22.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static BABY_ZOMBIE_VILLAGER: &[PartSpec] = &[
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 18.75, 0.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-2., -2.75, -1.5],
                size: [4., 5., 3.],
                uv: [0., 15.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-2., -2.75, -1.5],
                size: [4., 6., 3.],
                uv: [16., 22.],
                inflate: 0.1,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 16., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -8., -3.5],
            size: [8., 8., 7.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat",
        parent: Some(1),
        pivot: [0., -4., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -4., -3.5],
            size: [8., 8., 7.],
            uv: [0., 31.],
            inflate: 0.3,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat_rim",
        parent: Some(1),
        pivot: [0., -4.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-7., -0.5, -6.],
            size: [14., 1., 12.],
            uv: [0., 46.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "nose",
        parent: Some(1),
        pivot: [0., -1., -4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -1., -0.5],
            size: [2., 2., 1.],
            uv: [23., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_arm",
        parent: None,
        pivot: [-3., 15.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -0.5, -1.],
            size: [2., 5., 2.],
            uv: [24., 15.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_arm",
        parent: None,
        pivot: [3., 15.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -0.5, -1.],
            size: [2., 5., 2.],
            uv: [16., 15.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-1., 21.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -0.5, -1.],
            size: [2., 3., 2.],
            uv: [8., 23.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [1., 21.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -0.5, -1.],
            size: [2., 3., 2.],
            uv: [0., 23.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static CREEPER: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 6., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -8., -4.],
            size: [8., 8., 8.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 6., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., 0., -2.],
            size: [8., 12., 4.],
            uv: [16., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-2., 18., 4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [2., 18., 4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-2., 18., -4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [2., 18., -4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static COW: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 4., -8.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-4., -4., -6.],
                size: [8., 8., 6.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-3., 1., -7.],
                size: [6., 3., 1.],
                uv: [1., 33.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-5., -5., -5.],
                size: [1., 3., 1.],
                uv: [22., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [4., -5., -5.],
                size: [1., 3., 1.],
                uv: [22., 0.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 5., 2.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[
            Cube {
                from: [-6., -10., -7.],
                size: [12., 18., 10.],
                uv: [18., 4.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-2., 2., -8.],
                size: [4., 6., 1.],
                uv: [52., 0.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-4., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [4., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-4., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [4., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static WARM_COW: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 4., -8.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-4., -4., -6.],
                size: [8., 8., 6.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-3., 1., -7.],
                size: [6., 3., 1.],
                uv: [1., 33.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-8., -3., -5.],
                size: [4., 2., 2.],
                uv: [27., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-8., -5., -5.],
                size: [2., 2., 2.],
                uv: [39., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [4., -3., -5.],
                size: [4., 2., 2.],
                uv: [27., 0.],
                inflate: 0.,
                mirror: true,
            },
            Cube {
                from: [6., -5., -5.],
                size: [2., 2., 2.],
                uv: [39., 0.],
                inflate: 0.,
                mirror: true,
            },
        ],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 5., 2.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[
            Cube {
                from: [-6., -10., -7.],
                size: [12., 18., 10.],
                uv: [18., 4.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-2., 2., -8.],
                size: [4., 6., 1.],
                uv: [52., 0.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-4., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [4., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-4., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [4., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static COLD_COW: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 4., -8.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-4., -4., -6.],
                size: [8., 8., 6.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-3., 1., -7.],
                size: [6., 3., 1.],
                uv: [9., 33.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_horn",
        parent: Some(0),
        pivot: [-4.5, -2.5, -3.5],
        rotation: [1.5708, 0., 0.],
        cubes: &[Cube {
            from: [-1.5, -4.5, -0.5],
            size: [2., 6., 2.],
            uv: [0., 40.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_horn",
        parent: Some(0),
        pivot: [5.5, -2.5, -5.],
        rotation: [1.5708, 0., 0.],
        cubes: &[Cube {
            from: [-1.5, -3., -0.5],
            size: [2., 6., 2.],
            uv: [0., 32.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 5., 2.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[
            Cube {
                from: [-6., -10., -7.],
                size: [12., 18., 10.],
                uv: [20., 32.],
                inflate: 0.5,
                mirror: false,
            },
            Cube {
                from: [-6., -10., -7.],
                size: [12., 18., 10.],
                uv: [18., 4.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-2., 2., -8.],
                size: [4., 6., 1.],
                uv: [52., 0.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-4., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [4., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-4., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [4., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static BABY_COW: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 13.569, -5.1667],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-3., -4.569, -4.8333],
                size: [6., 6., 5.],
                uv: [0., 18.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [3., -5.569, -3.8333],
                size: [1., 2., 1.],
                uv: [8., 29.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-4., -5.569, -3.8333],
                size: [1., 2., 1.],
                uv: [4., 29.],
                inflate: 0.,
                mirror: true,
            },
            Cube {
                from: [-2., -1.569, -5.8333],
                size: [4., 3., 1.],
                uv: [12., 29.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [3., 19., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-7., -7., -1.],
            size: [8., 6., 12.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-2.5, 18., -3.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1.5, 0., -1.5],
            size: [3., 6., 3.],
            uv: [22., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [2.5, 18., -3.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1.5, 0., -1.5],
            size: [3., 6., 3.],
            uv: [34., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-2.5, 18., 3.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1.5, 0., -1.5],
            size: [3., 6., 3.],
            uv: [22., 27.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [2.5, 18., 3.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1.5, 0., -1.5],
            size: [3., 6., 3.],
            uv: [34., 27.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static PIG: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 12., -6.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-4., -4., -8.],
                size: [8., 8., 8.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-2., 0., -9.],
                size: [4., 3., 1.],
                uv: [16., 16.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 11., 2.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[Cube {
            from: [-5., -10., -7.],
            size: [10., 16., 8.],
            uv: [28., 8.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-3., 18., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [3., 18., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-3., 18., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [3., 18., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static COLD_PIG: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 12., -6.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-4., -4., -8.],
                size: [8., 8., 8.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-2., 0., -9.],
                size: [4., 3., 1.],
                uv: [16., 16.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 11., 2.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[
            Cube {
                from: [-5., -10., -7.],
                size: [10., 16., 8.],
                uv: [28., 8.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-5., -10., -7.],
                size: [10., 16., 8.],
                uv: [28., 32.],
                inflate: 0.5,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-3., 18., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [3., 18., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-3., 18., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [3., 18., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static BABY_PIG: &[PartSpec] = &[
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 19., 0.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3.5, -3., -4.5],
            size: [7., 6., 9.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 19., -2.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-3.5, -5., -5.],
                size: [7., 6., 6.],
                uv: [0., 15.],
                inflate: 0.025,
                mirror: false,
            },
            Cube {
                from: [-1.5, -1.975, -6.],
                size: [3., 2., 1.],
                uv: [6., 27.],
                inflate: 0.015,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [2.5, 22., -3.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 2., 2.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-2.5, 22., -3.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 2., 2.],
            uv: [23., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [2.5, 22., 4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 2., 2.],
            uv: [0., 4.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-2.5, 22., 4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 2., 2.],
            uv: [23., 4.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static CHICKEN: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 15., -4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., -6., -2.],
            size: [4., 6., 3.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "beak",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., -4., -4.],
            size: [4., 2., 2.],
            uv: [14., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "red_thing",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -2., -3.],
            size: [2., 2., 2.],
            uv: [14., 4.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 16., 0.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[Cube {
            from: [-3., -4., -3.],
            size: [6., 8., 6.],
            uv: [0., 9.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-2., 19., 1.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -3.],
            size: [3., 5., 3.],
            uv: [26., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [1., 19., 1.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -3.],
            size: [3., 5., 3.],
            uv: [26., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_wing",
        parent: None,
        pivot: [-4., 13., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [0., 0., -3.],
            size: [1., 4., 6.],
            uv: [24., 13.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_wing",
        parent: None,
        pivot: [4., 13., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -3.],
            size: [1., 4., 6.],
            uv: [24., 13.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static COLD_CHICKEN: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 15., -4.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-2., -6., -2.],
                size: [4., 6., 3.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-3., -7., -2.015],
                size: [6., 3., 4.],
                uv: [44., 0.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "beak",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., -4., -4.],
            size: [4., 2., 2.],
            uv: [14., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "red_thing",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -2., -3.],
            size: [2., 2., 2.],
            uv: [14., 4.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 16., 0.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[
            Cube {
                from: [-3., -4., -3.],
                size: [6., 8., 6.],
                uv: [0., 9.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [0., 3., -1.],
                size: [0., 3., 5.],
                uv: [38., 9.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-2., 19., 1.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -3.],
            size: [3., 5., 3.],
            uv: [26., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [1., 19., 1.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -3.],
            size: [3., 5., 3.],
            uv: [26., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_wing",
        parent: None,
        pivot: [-4., 13., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [0., 0., -3.],
            size: [1., 4., 6.],
            uv: [24., 13.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_wing",
        parent: None,
        pivot: [4., 13., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -3.],
            size: [1., 4., 6.],
            uv: [24., 13.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static BABY_CHICKEN: &[PartSpec] = &[
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 20.25, -1.25],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-2., -2.25, -0.75],
                size: [4., 4., 4.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-1., -0.25, -1.75],
                size: [2., 1., 1.],
                uv: [10., 8.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [1., 22., 0.5],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-0.5, 0., 0.],
                size: [1., 2., 0.],
                uv: [2., 2.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-0.5, 2., -1.],
                size: [1., 0., 1.],
                uv: [0., 1.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-1., 22., 0.5],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-0.5, 0., 0.],
                size: [1., 2., 0.],
                uv: [0., 2.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-0.5, 2., -1.],
                size: [1., 0., 1.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_wing",
        parent: None,
        pivot: [2., 20., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [0., 0., -1.],
            size: [1., 0., 2.],
            uv: [6., 8.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_wing",
        parent: None,
        pivot: [-2., 20., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [1., 0., 2.],
            uv: [4., 8.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static SHEEP: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 6., -8.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3., -4., -6.],
            size: [6., 6., 8.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 5., 2.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[Cube {
            from: [-4., -10., -7.],
            size: [8., 16., 6.],
            uv: [28., 8.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-3., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [3., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-3., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [3., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static WOOL: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 6., -8.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3., -4., -4.],
            size: [6., 6., 6.],
            uv: [0., 0.],
            inflate: 0.6,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 5., 2.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[Cube {
            from: [-4., -10., -7.],
            size: [8., 16., 6.],
            uv: [28., 8.],
            inflate: 1.75,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-3., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.5,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [3., 12., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.5,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-3., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.5,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [3., 12., -5.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 6., 4.],
            uv: [0., 16.],
            inflate: 0.5,
            mirror: false,
        }],
    },
];
static BABY_SHEEP: &[PartSpec] = &[
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 17., 0.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3., -2., -4.5],
            size: [6., 4., 9.],
            uv: [0., 10.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 15.5, -2.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2.5, -4.5, -3.5],
            size: [5., 5., 5.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-2., 19., 3.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 5., 2.],
            uv: [0., 23.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [2., 19., 3.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 5., 2.],
            uv: [24., 12.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-2., 19., -2.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 5., 2.],
            uv: [8., 23.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [2., 19., -2.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 5., 2.],
            uv: [24., 5.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static WOLF: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [-1., 13.5, -7.],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "real_head",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-2., -3., -2.],
                size: [6., 6., 4.],
                uv: [0., 0.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-2., -5., 0.],
                size: [2., 2., 1.],
                uv: [16., 14.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [2., -5., 0.],
                size: [2., 2., 1.],
                uv: [16., 14.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-0.5, -0.001, -5.],
                size: [3., 3., 4.],
                uv: [0., 10.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 14., 2.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[Cube {
            from: [-3., -2., -3.],
            size: [6., 9., 6.],
            uv: [18., 14.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "upper_body",
        parent: None,
        pivot: [-1., 14., -3.],
        rotation: [1.5707964, 0., 0.],
        cubes: &[Cube {
            from: [-3., -3., -3.],
            size: [8., 6., 7.],
            uv: [21., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-2.5, 16., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [0., 0., -1.],
            size: [2., 8., 2.],
            uv: [0., 18.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [0.5, 16., 7.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [0., 0., -1.],
            size: [2., 8., 2.],
            uv: [0., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-2.5, 16., -4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [0., 0., -1.],
            size: [2., 8., 2.],
            uv: [0., 18.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [0.5, 16., -4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [0., 0., -1.],
            size: [2., 8., 2.],
            uv: [0., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "tail",
        parent: None,
        pivot: [-1., 12., 8.],
        rotation: [0.62831855, 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "real_tail",
        parent: Some(8),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [0., 0., -1.],
            size: [2., 8., 2.],
            uv: [9., 18.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static BABY_WOLF: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 18.25, -4.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-2.99, -3.25, -3.],
                size: [6., 5., 5.],
                uv: [0., 12.],
                inflate: 0.025,
                mirror: false,
            },
            Cube {
                from: [-1.5, -0.24, -5.],
                size: [3., 2., 2.],
                uv: [17., 12.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_ear",
        parent: Some(0),
        pivot: [-2., -4.25, -0.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -1., -0.5],
            size: [2., 2., 1.],
            uv: [0., 5.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_ear",
        parent: Some(0),
        pivot: [2., -4.25, -0.5],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -1., -0.5],
            size: [2., 2., 1.],
            uv: [20., 5.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 19., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3., -2., -4.],
            size: [6., 4., 8.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-1.5, 21., 3.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 3., 2.],
            uv: [0., 22.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [1.5, 21., 3.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 3., 2.],
            uv: [8., 22.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-1.5, 21., -3.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 3., 2.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [1.5, 21., -3.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 3., 2.],
            uv: [20., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "tail",
        parent: None,
        pivot: [0., 19., 3.],
        rotation: [-0.5236, 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "tail_r1",
        parent: Some(8),
        pivot: [0., -0.6, 0.2],
        rotation: [-3.1, 0., 0.],
        cubes: &[Cube {
            from: [-1., -5.7, -1.],
            size: [2., 6., 2.],
            uv: [22., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static SPIDER: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 15., -3.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -4., -8.],
            size: [8., 8., 8.],
            uv: [32., 4.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body0",
        parent: None,
        pivot: [0., 15., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3., -3., -3.],
            size: [6., 6., 6.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body1",
        parent: None,
        pivot: [0., 15., 9.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-5., -4., -6.],
            size: [10., 8., 12.],
            uv: [0., 12.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_hind_leg",
        parent: None,
        pivot: [-4., 15., 2.],
        rotation: [0., 0.7853982, -0.7853982],
        cubes: &[Cube {
            from: [-15., -1., -1.],
            size: [16., 2., 2.],
            uv: [18., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_hind_leg",
        parent: None,
        pivot: [4., 15., 2.],
        rotation: [0., -0.7853982, 0.7853982],
        cubes: &[Cube {
            from: [-1., -1., -1.],
            size: [16., 2., 2.],
            uv: [18., 0.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_middle_hind_leg",
        parent: None,
        pivot: [-4., 15., 1.],
        rotation: [0., 0.3926991, -0.58119464],
        cubes: &[Cube {
            from: [-15., -1., -1.],
            size: [16., 2., 2.],
            uv: [18., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_middle_hind_leg",
        parent: None,
        pivot: [4., 15., 1.],
        rotation: [0., -0.3926991, 0.58119464],
        cubes: &[Cube {
            from: [-1., -1., -1.],
            size: [16., 2., 2.],
            uv: [18., 0.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_middle_front_leg",
        parent: None,
        pivot: [-4., 15., 0.],
        rotation: [0., -0.3926991, -0.58119464],
        cubes: &[Cube {
            from: [-15., -1., -1.],
            size: [16., 2., 2.],
            uv: [18., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_middle_front_leg",
        parent: None,
        pivot: [4., 15., 0.],
        rotation: [0., 0.3926991, 0.58119464],
        cubes: &[Cube {
            from: [-1., -1., -1.],
            size: [16., 2., 2.],
            uv: [18., 0.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_front_leg",
        parent: None,
        pivot: [-4., 15., -1.],
        rotation: [0., -0.7853982, -0.7853982],
        cubes: &[Cube {
            from: [-15., -1., -1.],
            size: [16., 2., 2.],
            uv: [18., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_front_leg",
        parent: None,
        pivot: [4., 15., -1.],
        rotation: [0., 0.7853982, 0.7853982],
        cubes: &[Cube {
            from: [-1., -1., -1.],
            size: [16., 2., 2.],
            uv: [18., 0.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static SLIME: &[PartSpec] = &[
    PartSpec {
        name: "cube",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3., 17., -3.],
            size: [6., 6., 6.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_eye",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3.25, 18., -3.5],
            size: [2., 2., 2.],
            uv: [32., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_eye",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [1.25, 18., -3.5],
            size: [2., 2., 2.],
            uv: [32., 4.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "mouth",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [0., 21., -3.5],
            size: [1., 1., 1.],
            uv: [32., 8.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static SLIME_OUTER: &[PartSpec] = &[PartSpec {
    name: "cube",
    parent: None,
    pivot: [0., 0., 0.],
    rotation: [0., 0., 0.],
    cubes: &[Cube {
        from: [-4., 16., -4.],
        size: [8., 8., 8.],
        uv: [0., 0.],
        inflate: 0.,
        mirror: false,
    }],
}];
static ENDERMAN: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., -13., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -8., -4.],
            size: [8., 8., 8.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -8., -4.],
            size: [8., 8., 8.],
            uv: [0., 16.],
            inflate: -0.5,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., -14., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., 0., -2.],
            size: [8., 12., 4.],
            uv: [32., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_arm",
        parent: None,
        pivot: [-5., -12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -2., -1.],
            size: [2., 30., 2.],
            uv: [56., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_arm",
        parent: None,
        pivot: [5., -12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -2., -1.],
            size: [2., 30., 2.],
            uv: [56., 0.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-2., -5., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 30., 2.],
            uv: [56., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [2., -5., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 30., 2.],
            uv: [56., 0.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static SKELETON: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -8., -4.],
            size: [8., 8., 8.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -8., -4.],
            size: [8., 8., 8.],
            uv: [32., 0.],
            inflate: 0.5,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., 0., -2.],
            size: [8., 12., 4.],
            uv: [16., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_arm",
        parent: None,
        pivot: [-5., 2., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -2., -1.],
            size: [2., 12., 2.],
            uv: [40., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_arm",
        parent: None,
        pivot: [5., 2., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -2., -1.],
            size: [2., 12., 2.],
            uv: [40., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-2., 12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 12., 2.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [2., 12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 12., 2.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static ZOMBIE: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -8., -4.],
            size: [8., 8., 8.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -8., -4.],
            size: [8., 8., 8.],
            uv: [32., 0.],
            inflate: 0.5,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., 0., -2.],
            size: [8., 12., 4.],
            uv: [16., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_arm",
        parent: None,
        pivot: [-5., 2., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-3., -2., -2.],
            size: [4., 12., 4.],
            uv: [40., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_arm",
        parent: None,
        pivot: [5., 2., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -2., -2.],
            size: [4., 12., 4.],
            uv: [40., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-1.9, 12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [1.9, 12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static BABY_ZOMBIE: &[PartSpec] = &[
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 17.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., -2.5, -1.],
            size: [4., 5., 2.],
            uv: [16., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 15.25, 0.],
        rotation: [0., 0., 0.],
        cubes: &[
            Cube {
                from: [-3., -6.25, -3.],
                size: [6., 6., 6.],
                uv: [3., 3.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-3., -6.15, -3.],
                size: [6., 6., 6.],
                uv: [35., 3.],
                inflate: 0.25,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "hat",
        parent: Some(1),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "right_arm",
        parent: None,
        pivot: [-3., 15.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -0.5, -1.],
            size: [2., 5., 2.],
            uv: [36., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_arm",
        parent: None,
        pivot: [3., 15.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -0.5, -1.],
            size: [2., 5., 2.],
            uv: [28., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-1., 20., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 4., 2.],
            uv: [8., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [1., 20., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -1.],
            size: [2., 4., 2.],
            uv: [0., 16.],
            inflate: 0.,
            mirror: false,
        }],
    },
];
static VILLAGER: &[PartSpec] = &[
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -10., -4.],
            size: [8., 10., 8.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat",
        parent: Some(0),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -10., -4.],
            size: [8., 10., 8.],
            uv: [32., 0.],
            inflate: 0.51,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat_rim",
        parent: Some(1),
        pivot: [0., 0., 0.],
        rotation: [-1.5707964, 0., 0.],
        cubes: &[Cube {
            from: [-8., -8., -6.],
            size: [16., 16., 1.],
            uv: [30., 47.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "nose",
        parent: Some(0),
        pivot: [0., -2., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -1., -6.],
            size: [2., 4., 2.],
            uv: [24., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., 0., -3.],
            size: [8., 12., 6.],
            uv: [16., 20.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "jacket",
        parent: Some(4),
        pivot: [0., 0., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., 0., -3.],
            size: [8., 20., 6.],
            uv: [0., 38.],
            inflate: 0.5,
            mirror: false,
        }],
    },
    PartSpec {
        name: "arms",
        parent: None,
        pivot: [0., 3., -1.],
        rotation: [-0.75, 0., 0.],
        cubes: &[
            Cube {
                from: [-8., -2., -2.],
                size: [4., 8., 4.],
                uv: [44., 22.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [4., -2., -2.],
                size: [4., 8., 4.],
                uv: [44., 22.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [-4., 2., -2.],
                size: [8., 4., 4.],
                uv: [40., 38.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-2., 12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 22.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [2., 12., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., 0., -2.],
            size: [4., 12., 4.],
            uv: [0., 22.],
            inflate: 0.,
            mirror: true,
        }],
    },
];
static BABY_VILLAGER: &[PartSpec] = &[
    PartSpec {
        name: "arms",
        parent: None,
        pivot: [0., 17.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[],
    },
    PartSpec {
        name: "right_hand",
        parent: Some(0),
        pivot: [-3., 1.4025, -0.9599],
        rotation: [-1.0472, 0., 0.],
        cubes: &[
            Cube {
                from: [-1., -2.4925, -1.8401],
                size: [2., 4., 2.],
                uv: [36., 15.],
                inflate: 0.,
                mirror: false,
            },
            Cube {
                from: [5., -2.4925, -1.8401],
                size: [2., 4., 2.],
                uv: [16., 15.],
                inflate: 0.,
                mirror: false,
            },
        ],
    },
    PartSpec {
        name: "middlearm_r1",
        parent: Some(0),
        pivot: [0., 0.9024, -1.8175],
        rotation: [-1.0472, 0., 0.],
        cubes: &[Cube {
            from: [-2., -0.9924, -0.9825],
            size: [4., 2., 2.],
            uv: [24., 17.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "right_leg",
        parent: None,
        pivot: [-1., 21.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -0.5, -1.],
            size: [2., 3., 2.],
            uv: [8., 23.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "left_leg",
        parent: None,
        pivot: [1., 21.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., -0.5, -1.],
            size: [2., 3., 2.],
            uv: [0., 23.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "head",
        parent: None,
        pivot: [0., 16., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -8., -3.5],
            size: [8., 8., 7.],
            uv: [0., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat",
        parent: Some(5),
        pivot: [0., -4., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-4., -4., -3.5],
            size: [8., 8., 7.],
            uv: [0., 30.],
            inflate: 0.3,
            mirror: false,
        }],
    },
    PartSpec {
        name: "hat_rim",
        parent: Some(5),
        pivot: [0., -4.5, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-7., -0.5, -6.],
            size: [14., 1., 12.],
            uv: [0., 45.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "nose",
        parent: Some(5),
        pivot: [0., -2., -4.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-1., 0., -0.5],
            size: [2., 2., 1.],
            uv: [23., 0.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "body",
        parent: None,
        pivot: [0., 18.75, 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2., -2.75, -1.5],
            size: [4., 5., 3.],
            uv: [0., 15.],
            inflate: 0.,
            mirror: false,
        }],
    },
    PartSpec {
        name: "bb_main",
        parent: None,
        pivot: [0.5, 24., 0.],
        rotation: [0., 0., 0.],
        cubes: &[Cube {
            from: [-2.5, -8., -1.5],
            size: [4., 6., 3.],
            uv: [16., 21.],
            inflate: 0.2,
            mirror: false,
        }],
    },
];
