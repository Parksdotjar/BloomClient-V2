//! Fixed-radius precipitation snapshots. Sampling is off the render thread;
//! world-anchored phases and GPU UV motion keep columns stable between snapshots.
use azalea_core::{
    heightmap_kind::HeightmapKind,
    position::{BlockPos, ChunkPos},
};
use azalea_registry::{DataRegistry, identifier::Identifier};
use azalea_world::World;
use std::{collections::HashMap, sync::Arc};

pub const RADIUS: i32 = 10;
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Column {
    pub x: i32,
    pub z: i32,
    pub floor: i32,
    pub snow: bool,
    pub light: [u8; 2],
}
#[derive(Clone, Copy, Debug)]
pub struct Biome {
    pub fog: Option<[f32; 3]>,
    pub water_fog: [f32; 3],
    pub precipitation: bool,
    pub temperature: f32,
    pub colors: BiomeColors,
}
#[derive(Clone, Debug, Default)]
pub struct Weather {
    pub columns: Arc<[Column]>,
    pub revision: u64,
    biomes: Arc<HashMap<u32, Biome>>,
}
fn rgb(v: u32) -> [f32; 3] {
    [
        (v >> 16 & 255) as f32 / 255.,
        (v >> 8 & 255) as f32 / 255.,
        (v & 255) as f32 / 255.,
    ]
}
impl Weather {
    pub fn biome(&mut self, world: &World, p: BlockPos) -> Option<Biome> {
        let id = biome_at(world, p)?.protocol_id();
        if let Some(b) = self.biomes.get(&id) {
            return Some(*b);
        }
        let registry = world
            .registries
            .extra
            .get(&Identifier::new("minecraft:worldgen/biome"))?;
        let (_, data) = registry.map.get_index(id as usize)?;
        let attrs = data.get("attributes").and_then(|t| t.compound());
        let color = |name: &str| {
            attrs
                .and_then(|a| a.get(name))
                .and_then(|t| {
                    t.int().map(|v| v as u32).or_else(|| {
                        t.string().and_then(|v| {
                            u32::from_str_radix(v.to_string_lossy().trim_start_matches('#'), 16)
                                .ok()
                        })
                    })
                })
                .map(rgb)
        };
        let effects = data.get("effects").and_then(|t| t.compound());
        let effect_color = |name: &str| {
            effects.and_then(|a| a.get(name)).and_then(|t| {
                t.int().map(|v| v as u32).or_else(|| {
                    t.string().and_then(|v| {
                        u32::from_str_radix(v.to_string_lossy().trim_start_matches('#'), 16).ok()
                    })
                })
            })
        };
        let modifier = effects
            .and_then(|a| a.get("grass_color_modifier"))
            .and_then(|t| t.string())
            .map(|v| v.to_string_lossy().into_owned())
            .unwrap_or_default();
        let temperature = data
            .get("temperature")
            .and_then(|t| t.float())
            .unwrap_or(0.8);
        let b = Biome {
            colors: BiomeColors {
                temperature,
                downfall: data.get("downfall").and_then(|t| t.float()).unwrap_or(0.4),
                grass: effect_color("grass_color"),
                foliage: effect_color("foliage_color"),
                water: effect_color("water_color").unwrap_or(0x3f76e4),
                modifier: match modifier.as_str() {
                    "swamp" => 1,
                    "dark_forest" => 2,
                    _ => 0,
                },
            },
            fog: color("minecraft:visual/fog_color"),
            water_fog: color("minecraft:visual/water_fog_color").unwrap_or(rgb(0x050533)),
            precipitation: data
                .get("has_precipitation")
                .and_then(|t| t.byte())
                .unwrap_or(0)
                != 0,
            temperature: data
                .get("temperature")
                .and_then(|t| t.float())
                .unwrap_or(0.8),
        };
        if self.biomes.len() < 4096 {
            Arc::make_mut(&mut self.biomes).insert(id, b);
        }
        Some(b)
    }
    pub fn clear(&mut self) {
        if !self.columns.is_empty() {
            self.columns = Arc::from([]);
            self.revision = self.revision.wrapping_add(1);
        }
    }
    pub fn sample(&mut self, world: &World, eye: [f64; 3], light: &crate::world_stream::Changes) {
        let [cx, cy, cz] = eye.map(|v| v.floor() as i32);
        let mut columns = Vec::with_capacity(((RADIUS * 2 + 1).pow(2)) as usize);
        for z in cz - RADIUS..=cz + RADIUS {
            for x in cx - RADIUS..=cx + RADIUS {
                let height = world
                    .chunks
                    .get(&ChunkPos {
                        x: x.div_euclid(16),
                        z: z.div_euclid(16),
                    })
                    .and_then(|c| {
                        c.read()
                            .heightmaps
                            .get(&HeightmapKind::MotionBlocking)
                            .map(|h| {
                                h.get_first_available(
                                    x.rem_euclid(16) as u8,
                                    z.rem_euclid(16) as u8,
                                )
                            })
                    });
                let Some(floor) = height else { continue };
                let Some(b) = self.biome(world, BlockPos::new(x, cy, z)) else {
                    continue;
                };
                if !b.precipitation {
                    continue;
                }
                // Java's altitude lapse starts at sea level + 17. The small biome
                // temperature-noise term is tracked as a remaining parity gap.
                let snow = b.temperature - (cy - 80).max(0) as f32 * 0.05 / 40. < 0.15;
                let l = light.sample([x, cy.max(floor), z]);
                columns.push(Column {
                    x,
                    z,
                    floor,
                    snow,
                    light: [l.block.unwrap_or(0), l.sky.unwrap_or(15)],
                });
            }
        }
        if self.columns.as_ref() != columns.as_slice() {
            self.columns = columns.into();
            self.revision = self.revision.wrapping_add(1);
        }
    }
    /// Java 26.1's six-tap Gaussian kernel on the quart-biome lattice.
    /// Ignore unavailable samples and normalize, rather than blending to black.
    pub fn blend(
        &mut self,
        world: &World,
        eye: [f64; 3],
        fallback: [f32; 3],
    ) -> Option<([f32; 3], [f32; 3])> {
        let q = eye.map(|v| v / 4. - 0.5);
        let base = q.map(|v| v.floor() as i32);
        let weights = q.map(|v| kernel((v - v.floor()) as f32));
        let mut fog = [0.; 3];
        let mut water = [0.; 3];
        let mut total = 0.;
        for y in 0..6 {
            for z in 0..6 {
                for x in 0..6 {
                    let w = weights[0][x] * weights[1][y] * weights[2][z];
                    if w == 0. {
                        continue;
                    }
                    let p = BlockPos::new(
                        (base[0] + x as i32 - 2) * 4,
                        (base[1] + y as i32 - 2) * 4,
                        (base[2] + z as i32 - 2) * 4,
                    );
                    let Some(b) = self.biome(world, p) else {
                        continue;
                    };
                    let f = b.fog.unwrap_or(fallback);
                    for i in 0..3 {
                        fog[i] += f[i] * w;
                        water[i] += b.water_fog[i] * w;
                    }
                    total += w;
                }
            }
        }
        (total > 0.).then(|| (fog.map(|v| v / total), water.map(|v| v / total)))
    }
}
fn kernel(t: f32) -> [f32; 6] {
    const K: [f32; 7] = [0., 1., 4., 6., 4., 1., 0.];
    std::array::from_fn(|i| K[i + 1] + t * (K[i] - K[i + 1]))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn biome_addressing_uses_block_height_and_negative_coordinates() {
        let mut world = World::default();
        world.chunks = azalea_world::ChunkStorage::new(96, -64);
        let mut chunk = azalea_world::Chunk {
            sections: vec![azalea_world::Section::default(); 6].into(),
            heightmaps: Default::default(),
        };
        for (i, section) in chunk.sections.iter_mut().enumerate() {
            for y in 0..4 {
                for z in 0..4 {
                    for x in 0..4 {
                        section.get_and_set_biome(
                            azalea_core::position::ChunkSectionBiomePos { x, y, z },
                            azalea_registry::data::Biome::new_raw(i as u32 + 1),
                        );
                    }
                }
            }
        }
        let _keep = world.chunks.upsert(ChunkPos { x: -1, z: -1 }, chunk);
        for (y, expected) in [
            (-80, 1),
            (-64, 1),
            (-49, 1),
            (-48, 2),
            (-1, 4),
            (0, 5),
            (31, 6),
            (48, 6),
        ] {
            assert_eq!(
                biome_at(&world, BlockPos::new(-1, y, -1))
                    .unwrap()
                    .protocol_id(),
                expected,
                "at y={y}"
            );
        }
        assert!(biome_at(&world, BlockPos::new(1, 0, 1)).is_none());
    }
    #[test]
    fn gaussian_is_normalized_and_continuous() {
        for i in 0..101 {
            let k = kernel(i as f32 / 100.);
            assert!((k.iter().sum::<f32>() - 16.).abs() < 0.00001);
            assert!(k.iter().all(|v| *v >= 0.));
        }
        assert_eq!(&kernel(1.)[1..], &kernel(0.)[..5]);
    }
}

/// Compact climate samples travel with terrain snapshots, not with every vertex.
#[derive(Clone, Copy, Debug)]
pub struct BiomeColors {
    pub temperature: f32,
    pub downfall: f32,
    pub grass: Option<u32>,
    pub foliage: Option<u32>,
    pub water: u32,
    pub modifier: u8,
}
impl Default for BiomeColors {
    fn default() -> Self {
        Self {
            temperature: 0.8,
            downfall: 0.4,
            grass: None,
            foliage: None,
            water: 0x3f76e4,
            modifier: 0,
        }
    }
}
impl BiomeColors {
    pub fn palette(self, maps: &[u8]) -> [[f32; 3]; 3] {
        let t = self.temperature.clamp(0., 1.);
        let d = self.downfall.clamp(0., 1.) * t;
        let i = ((255. * (1. - t)) as usize + 256 * (255. * (1. - d)) as usize) * 4;
        let lookup = |offset: usize, fallback: u32| -> u32 {
            maps.get(offset + i..offset + i + 3).map_or(fallback, |p| {
                (p[0] as u32) << 16 | (p[1] as u32) << 8 | p[2] as u32
            })
        };
        let mut grass = self.grass.unwrap_or_else(|| lookup(0, 0x91bd59));
        if self.modifier == 1 {
            grass = 0x6a7039;
        } else if self.modifier == 2 {
            grass = ((grass & 0xfefefe) + 0x28340a) >> 1;
        }
        [
            rgb(grass),
            rgb(self
                .foliage
                .unwrap_or_else(|| lookup(256 * 256 * 4, 0x77ab2f))),
            rgb(self.water),
        ]
    }
}

/// The upstream get_biome passes quart Y into a block-Y section lookup.
/// Keep section addressing in blocks and only convert the local palette index.
pub fn biome_at(world: &World, p: BlockPos) -> Option<azalea_registry::data::Biome> {
    let min = world.chunks.min_y();
    let y = p.y.clamp(min, min + world.chunks.height() as i32 - 1);
    let chunk = world.chunks.get(&ChunkPos {
        x: p.x.div_euclid(16),
        z: p.z.div_euclid(16),
    })?;
    let chunk = chunk.read();
    let section = chunk.sections.get(((y - min) / 16) as usize)?;
    Some(
        section.get_biome(azalea_core::position::ChunkSectionBiomePos {
            x: p.x.rem_euclid(16) as u8 / 4,
            y: y.rem_euclid(16) as u8 / 4,
            z: p.z.rem_euclid(16) as u8 / 4,
        }),
    )
}
