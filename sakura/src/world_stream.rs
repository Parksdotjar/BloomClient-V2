//! Packet-driven, bounded section snapshots. Idle terrain is never rescanned.
use crate::shared::SectionSnapshot;
use azalea_client::{local_player::WorldHolder, packet::game::ReceiveGamePacketEvent};
use azalea_core::position::{ChunkPos, ChunkSectionBlockPos};
use azalea_protocol::packets::game::{
    ClientboundGamePacket as Packet, c_light_update::ClientboundLightUpdatePacketData,
};
use azalea_world::Section;
use bevy_ecs::prelude::*;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::Arc,
};

const DIRECTIONS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
];
const MAX_SECTIONS: usize = 32768;
pub type Key = [i32; 3];
#[derive(Clone, Default)]
struct Light {
    sky: Option<Arc<[u8]>>,
    block: Option<Arc<[u8]>>,
}

#[derive(Resource, Default)]
pub struct Changes {
    biome_cache: crate::weather::Weather,
    biome_samples: HashMap<Key,Arc<[crate::weather::BiomeColors]>>,
    dirty: HashMap<Key, u64>,
    lights: HashMap<Key, Light>,
    pub unloaded: HashSet<[i32; 2]>,
    serial: u64,
    pub epoch: u64,
    error: Option<String>,
    relight: VecDeque<[i32; 3]>,
    queued: HashSet<[i32; 3]>,
    light_dirty: HashSet<Key>,
    missing: HashSet<Key>,
    has_sky: bool,
    pub visited: u64,
}
impl Changes {
    fn invalidate_biomes(&mut self,x:i32,z:i32) {
        self.biome_samples.retain(|k,_|(i64::from(k[0])-i64::from(x)).abs()>1 || (i64::from(k[2])-i64::from(z)).abs()>1);
    }
    fn mark(&mut self, key: Key) {
        if !valid_key(key) {
            return;
        }
        if self.dirty.len() < MAX_SECTIONS || self.dirty.contains_key(&key) {
            self.serial = self.serial.wrapping_add(1);
            self.dirty.insert(key, self.serial);
        } else {
            self.error = Some("Lighting work exceeds supported world bounds".into());
        }
    }
    fn around(&mut self, key: Key) {
        if !valid_key(key) {
            return;
        }
        // A one-block halo is used for face visibility and ambient occlusion.
        for y in -1..=1 {
            for z in -1..=1 {
                for x in -1..=1 {
                    self.mark([key[0] + x, key[1] + y, key[2] + z]);
                }
            }
        }
    }
    fn block(&mut self, position: [i32; 3]) {
        let key = position.map(|v| v.div_euclid(16));
        if !valid_key(key) {
            return;
        }
        self.enqueue_around(position);
        let local = position.map(|v| v.rem_euclid(16));
        let offsets = local.map(|v| match v {
            0 => vec![0, -1],
            15 => vec![0, 1],
            _ => vec![0],
        });
        // Interior edits change one snapshot; boundaries invalidate only halos
        // actually containing that block, including diagonal corner halos.
        for &y in &offsets[1] {
            for &z in &offsets[2] {
                for &x in &offsets[0] {
                    self.mark([key[0] + x, key[1] + y, key[2] + z]);
                }
            }
        }
    }
    fn light(
        &mut self,
        x: i32,
        z: i32,
        min_y: i32,
        height: u32,
        data: &ClientboundLightUpdatePacketData,
    ) {
        if !valid_key([x, 0, z]) {
            return;
        }
        for (sky, mask, empty, arrays) in [
            (
                true,
                &data.sky_y_mask,
                &data.empty_sky_y_mask,
                &data.sky_updates,
            ),
            (
                false,
                &data.block_y_mask,
                &data.empty_block_y_mask,
                &data.block_updates,
            ),
        ] {
            if mask.iter_ones().count() != arrays.len()
                || arrays.iter().any(|b| b.len() != 2048)
                || mask.iter_ones().any(|bit| {
                    bit > height as usize / 16 + 1 || empty.iter_ones().any(|e| e == bit)
                })
                || empty.iter_ones().any(|bit| bit > height as usize / 16 + 1)
            {
                self.error = Some("Server sent invalid light section masks or arrays".into());
                return;
            }
            for (bit, bytes) in mask.iter_ones().zip(arrays.iter()) {
                if bit > height as usize / 16 + 1 || bytes.len() != 2048 {
                    continue;
                }
                let key = [x, min_y.div_euclid(16) - 1 + bit as i32, z];
                if self.lights.len() >= MAX_SECTIONS && !self.lights.contains_key(&key) {
                    self.error = Some("Server light data exceeds section budget".into());
                    return;
                }
                let light = self.lights.entry(key).or_default();
                let old = if sky { &light.sky } else { &light.block };
                if old
                    .as_ref()
                    .is_some_and(|old| old.as_ref() == bytes.as_ref())
                {
                    continue;
                }
                if sky {
                    light.sky = Some(Arc::from(bytes.as_ref()));
                } else {
                    light.block = Some(Arc::from(bytes.as_ref()));
                }
                self.around(key);
            }
            for bit in empty.iter_ones().take(258) {
                if bit > height as usize / 16 + 1 {
                    continue;
                }
                let key = [x, min_y.div_euclid(16) - 1 + bit as i32, z];
                if self.lights.len() >= MAX_SECTIONS && !self.lights.contains_key(&key) {
                    self.error = Some("Server light data exceeds section budget".into());
                    return;
                }
                let light = self.lights.entry(key).or_default();
                let old = if sky { &light.sky } else { &light.block };
                if old.as_ref().is_some_and(|b| b.iter().all(|v| *v == 0)) {
                    continue;
                }
                static ZERO: std::sync::OnceLock<Arc<[u8]>> = std::sync::OnceLock::new();
                let zero = Some(ZERO.get_or_init(|| Arc::from(vec![0; 2048])).clone());
                if sky {
                    light.sky = zero;
                } else {
                    light.block = zero;
                }
                self.around(key);
            }
        }
    }
    fn enqueue(&mut self, p: [i32; 3]) {
        if !valid_key(p.map(|v| v.div_euclid(16))) {
            return;
        }
        if self.queued.contains(&p) {
            return;
        }
        if self.queued.len() >= 262144 {
            self.error =
                Some("Light update exceeds bounded queue; reconnect after the edit settles".into());
            return;
        }
        if self.queued.insert(p) {
            self.relight.push_back(p);
        }
    }
    fn enqueue_around(&mut self, p: [i32; 3]) {
        self.enqueue(p);
        for d in DIRECTIONS {
            self.enqueue(std::array::from_fn(|i| p[i] + d[i]));
        }
    }
    fn write_light(&mut self, p: [i32; 3], value: crate::lighting::LightSample) {
        let key = p.map(|v| v.div_euclid(16));
        let [x, y, z] = p.map(|v| v.rem_euclid(16) as usize);
        let n = x + 16 * (z + 16 * y);
        let l = self.lights.entry(key).or_default();
        for (slot, v) in [(&mut l.block, value.block), (&mut l.sky, value.sky)] {
            if let (Some(slot), Some(v)) = (slot, v) {
                let b = Arc::make_mut(slot);
                let shift = (n % 2) * 4;
                b[n / 2] = (b[n / 2] & !(15 << shift)) | (v.min(15) << shift);
            }
        }
        self.light_dirty.insert(key);
    }
    /// Incremental fixed-point relaxation. Decreases are recomputed from current
    /// neighbors/sources, so overlapping sources survive and stale owners cannot win.
    /// Kept off the renderer; a bounded batch runs under one shared-world read.
    fn propagate(&mut self, world: &azalea_world::World) {
        let started = std::time::Instant::now();
        let min = world.chunks.min_y();
        let top = min + world.chunks.height() as i32;
        let sample = |this: &Self, p: [i32; 3]| {
            if p[1] < min {
                crate::lighting::LightSample {
                    block: Some(0),
                    sky: Some(0),
                }
            } else if p[1] >= top {
                crate::lighting::LightSample {
                    block: Some(0),
                    sky: Some(if this.has_sky { 15 } else { 0 }),
                }
            } else {
                this.sample(p)
            }
        };
        for iteration in 0..8192 {
            if iteration % 128 == 0 && started.elapsed() > std::time::Duration::from_millis(2) {
                break;
            }
            let Some(p) = self.relight.pop_front() else {
                break;
            };
            self.queued.remove(&p);
            self.visited += 1;
            if p[1] < min || p[1] >= top {
                continue;
            }
            let Some(state) =
                world.get_block_state(azalea_core::position::BlockPos::new(p[0], p[1], p[2]))
            else {
                self.missing.insert(p.map(|v| v.div_euclid(16)));
                continue;
            };
            let old = self.sample(p);
            if !old.complete() {
                self.missing.insert(p.map(|v| v.div_euclid(16)));
                continue;
            }
            let state = u32::from(state.id());
            let prop = crate::light_properties::get(state);
            let mut block = prop.emission();
            let mut sky = 0;
            let mut unavailable = false;
            for (face, d) in DIRECTIONS.iter().enumerate() {
                let n = std::array::from_fn(|i| p[i] + d[i]);
                let light = sample(self, n);
                if !light.complete() {
                    self.missing.insert(n.map(|v| v.div_euclid(16)));
                    unavailable = true;
                    continue;
                }
                let neighbor = if n[1] < min || n[1] >= top {
                    Some(0)
                } else {
                    world
                        .get_block_state(azalea_core::position::BlockPos::new(n[0], n[1], n[2]))
                        .map(|s| u32::from(s.id()))
                };
                let Some(neighbor) = neighbor else {
                    self.missing.insert(n.map(|v| v.div_euclid(16)));
                    unavailable = true;
                    continue;
                };
                if crate::light_properties::occluded(neighbor, state, face ^ 1) {
                    continue;
                }
                let decay = prop.attenuation().max(1);
                block = block.max(light.block.unwrap().saturating_sub(decay));
                let skylight = light.sky.unwrap();
                let down =
                    face == 2 && skylight == 15 && prop.sky_down() && prop.attenuation() == 0;
                sky = sky.max(if down {
                    15
                } else {
                    skylight.saturating_sub(decay)
                });
            }
            // Retain valid boundary data until the unavailable dependency returns.
            if unavailable {
                continue;
            }
            let new = crate::lighting::LightSample {
                block: Some(block),
                sky: Some(if self.has_sky { sky } else { 0 }),
            };
            if old != new {
                self.write_light(p, new);
                for d in DIRECTIONS {
                    self.enqueue(std::array::from_fn(|i| p[i] + d[i]));
                }
            }
        }
        if self.relight.is_empty() {
            let dirty = std::mem::take(&mut self.light_dirty);
            for k in dirty {
                self.around(k);
            }
        }
    }
    pub fn sample(&self, pos: [i32; 3]) -> crate::lighting::LightSample {
        let key = pos.map(|v| v.div_euclid(16));
        let Some(l) = self.lights.get(&key) else {
            return Default::default();
        };
        let [x, y, z] = pos.map(|v| v.rem_euclid(16) as usize);
        let n = x + 16 * (z + 16 * y);
        let read = |a: &Option<Arc<[u8]>>| a.as_ref().map(|a| (a[n / 2] >> ((n % 2) * 4)) & 15);
        crate::lighting::LightSample {
            block: read(&l.block),
            sky: read(&l.sky),
        }
    }
    fn reconcile_missing(&mut self, world: &azalea_world::World) {
        let ready: Vec<_> = self
            .missing
            .iter()
            .filter(|k| {
                self.lights
                    .get(*k)
                    .is_some_and(|l| l.block.is_some() && l.sky.is_some())
                    && world
                        .get_block_state(azalea_core::position::BlockPos::new(
                            k[0] * 16,
                            k[1] * 16,
                            k[2] * 16,
                        ))
                        .is_some()
            })
            .copied()
            .collect();
        // An edit may have been deferred inside the section, not only at its faces.
        // Repair the section once on availability, including both sides of each seam.
        for k in ready {
            self.missing.remove(&k);
            for y in 0..16 {
                for z in 0..16 {
                    for x in 0..16 {
                        let p = [k[0] * 16 + x, k[1] * 16 + y, k[2] * 16 + z];
                        self.enqueue(p);
                        if x == 0 || x == 15 || y == 0 || y == 15 || z == 0 || z == 15 {
                            self.enqueue_around(p);
                        }
                    }
                }
            }
        }
    }
    pub fn revision(&self) -> u64 {
        self.serial
    }
    pub fn pending(&self) -> usize {
        self.dirty.len() + self.relight.len() + self.missing.len() + self.light_dirty.len()
    }
    pub fn fresh(&self, key: &Key, revision: u64) -> bool {
        self.dirty.get(key).is_none_or(|next| *next <= revision)
    }
    pub fn trim(&mut self, center: [i32; 2], distance: i32) {
        let inside = |key: &Key| {
            (key[0] - center[0]).abs() <= distance + 1 && (key[2] - center[1]).abs() <= distance + 1
        };
        self.biome_samples.retain(|key,_|inside(key));
        self.dirty.retain(|key, _| inside(key));
        self.lights.retain(|key, _| inside(key));
        self.missing.retain(|key| inside(key));
        self.light_dirty.retain(|key| inside(key));
        self.relight
            .retain(|p| inside(&p.map(|v| v.div_euclid(16))));
        self.queued.retain(|p| inside(&p.map(|v| v.div_euclid(16))));
    }
}

fn valid_key(key: Key) -> bool {
    (-1_875_001..=1_875_001).contains(&key[0])
        && (-1_875_001..=1_875_001).contains(&key[2])
        && (-62_501..=62_757).contains(&key[1])
}

pub fn capture(
    mut packets: MessageReader<ReceiveGamePacketEvent>,
    holders: Query<&WorldHolder>,
    mut changes: ResMut<Changes>,
) {
    for event in packets.read() {
        let Ok(holder) = holders.get(event.entity) else {
            continue;
        };
        let world = holder.shared.read();
        let min_y = world.chunks.min_y();
        let height = world.chunks.height();
        if height > 4096 || !(-1_000_000..=1_000_000).contains(&min_y) {
            continue;
        }
        match event.packet.as_ref() {
            Packet::Login(_) | Packet::Respawn(_) => {
                changes.biome_cache=Default::default();changes.biome_samples.clear();
                changes.dirty.clear();
                changes.lights.clear();
                changes.unloaded.clear();
                changes.epoch = changes.epoch.wrapping_add(1);
                changes.error = None;
                changes.relight.clear();
                changes.queued.clear();
                changes.light_dirty.clear();
                changes.missing.clear();
                let common = match event.packet.as_ref() {
                    Packet::Login(p) => &p.common,
                    Packet::Respawn(p) => &p.common,
                    _ => unreachable!(),
                };
                use azalea_registry::DataRegistry;
                changes.has_sky = world
                    .registries
                    .dimension_type
                    .map
                    .get_index(common.dimension_type.protocol_id() as usize)
                    .and_then(|(_, v)| v._extra.get("has_skylight"))
                    .and_then(|v| v.byte())
                    .is_some_and(|v| v != 0);
            }
            Packet::LevelChunkWithLight(p) => {
                changes.invalidate_biomes(p.x,p.z);
                changes.unloaded.remove(&[p.x, p.z]);
                for y in 0..height / 16 {
                    changes.around([p.x, min_y.div_euclid(16) + y as i32, p.z]);
                }
                changes.light(p.x, p.z, min_y, height, &p.light_data);
            }
            Packet::ChunksBiomes(p) => {
                for data in p.chunk_biome_data.iter().take(1024) {
                    let Some(chunk)=world.chunks.get(&data.pos) else {continue};
                    let mut chunk=chunk.write();
                    if data.buffer.len()>1024*1024 {continue;}
                    let mut cursor=std::io::Cursor::new(data.buffer.as_slice());
                    let decoded=(0..chunk.sections.len()).map(|_|azalea_world::palette::PalettedContainer::<azalea_registry::data::Biome>::read(&mut cursor)).collect::<Result<Vec<_>,_>>();
                    // Atomic replacement: malformed/partial palettes cannot leave
                    // half a column with new colors and the other half stale.
                    if let Ok(palettes)=decoded {
                        if cursor.position() as usize!=data.buffer.len() {continue;}
                        changes.invalidate_biomes(data.pos.x,data.pos.z);
                        for (section,biomes) in chunk.sections.iter_mut().zip(palettes) {section.biomes=biomes;}
                        for y in 0..height/16 {changes.around([data.pos.x,min_y.div_euclid(16)+y as i32,data.pos.z]);}
                    }
                }
            }
            Packet::LightUpdate(p) => changes.light(p.x, p.z, min_y, height, &p.light_data),
            Packet::BlockUpdate(p) => changes.block([p.pos.x, p.pos.y, p.pos.z]),
            Packet::SectionBlocksUpdate(p) => {
                let key = [p.section_pos.x, p.section_pos.y, p.section_pos.z];
                if !valid_key(key) {
                    continue;
                }
                if p.states.len() > 64 {
                    changes.around(key);
                    for update in p.states.iter().take(4096) {
                        changes.enqueue_around([
                            key[0] * 16 + i32::from(update.pos.x),
                            key[1] * 16 + i32::from(update.pos.y),
                            key[2] * 16 + i32::from(update.pos.z),
                        ]);
                    }
                } else {
                    for update in &p.states {
                        changes.block([
                            key[0] * 16 + i32::from(update.pos.x),
                            key[1] * 16 + i32::from(update.pos.y),
                            key[2] * 16 + i32::from(update.pos.z),
                        ]);
                    }
                }
            }
            Packet::ForgetLevelChunk(p) => {
                changes.invalidate_biomes(p.pos.x,p.pos.z);
                if !valid_key([p.pos.x, 0, p.pos.z]) {
                    continue;
                }
                changes.unloaded.insert([p.pos.x, p.pos.z]);
                changes
                    .lights
                    .retain(|k, _| k[0] != p.pos.x || k[2] != p.pos.z);
                changes
                    .dirty
                    .retain(|k, _| k[0] != p.pos.x || k[2] != p.pos.z);
                for y in 0..height / 16 {
                    for [x, z] in [[-1, 0], [1, 0], [0, -1], [0, 1]] {
                        changes.mark([p.pos.x + x, min_y.div_euclid(16) + y as i32, p.pos.z + z]);
                    }
                }
            }
            _ => {}
        }
    }
}

pub struct Work {
    biomes: Arc<[crate::weather::BiomeColors]>,
    key: Key,
    revision: u64,
    sections: Vec<Option<Section>>,
    lights: Vec<Option<Light>>,
}
/// Clone compressed palettes only. Expansion runs on a single bounded worker.
pub fn prepare(
    world: &Arc<parking_lot::RwLock<azalea_world::World>>,
    changes: &mut Changes,
    position: [f64; 3],
    distance: u8,
) -> Result<Vec<Work>, String> {
    if let Some(error) = &changes.error {
        return Err(error.clone());
    }
    let center = position.map(|v| (v.floor() as i32).div_euclid(16));
    changes.trim([center[0], center[2]], i32::from(distance));
    {
        let world = world.read();
        changes.reconcile_missing(&world);
        changes.propagate(&world);
    }
    if !changes.relight.is_empty() {
        return Ok(Vec::new());
    }
    let mut keys: Vec<_> = changes.dirty.iter().map(|(k, r)| (*k, *r)).collect();
    keys.sort_unstable_by_key(|(k, _)| {
        (i64::from(k[0]) - i64::from(center[0])).pow(2)
            + (i64::from(k[2]) - i64::from(center[2])).pow(2)
            + (i64::from(k[1]) - i64::from(center[1])).pow(2)
    });
    let world = world.read();
    let min_y = world.chunks.min_y().div_euclid(16);
    let height = world.chunks.height();
    if height > 4096 || !(-62500..=62500).contains(&min_y) {
        return Err("Server dimension exceeds Sakura's supported limits".into());
    }
    let mut work = Vec::new();
    let mut populated = 0;
    for (key, revision) in keys.into_iter().take(1024) {
        if populated >= 16 {
            break;
        }
        changes.dirty.remove(&key);
        let core = world.chunks.get(&ChunkPos {
            x: key[0],
            z: key[2],
        });
        let nonempty = core.as_ref().is_some_and(|c| {
            let c = c.read();
            usize::try_from(key[1] - min_y)
                .ok()
                .and_then(|i| c.sections.get(i))
                .is_some_and(|s| s.block_count > 0 || s.fluid_count > 0)
        });
        if !nonempty {
            work.push(Work {
                key,
                revision,
                sections: vec![None; 27],
                lights: Vec::new(),
                biomes: Arc::from([]),
            });
            continue;
        }
        populated += 1;
        let mut sections = vec![None; 27];
        let mut lights = vec![None; 27];
        for z in -1..=1 {
            for x in -1..=1 {
                let chunk = world.chunks.get(&ChunkPos {
                    x: key[0] + x,
                    z: key[2] + z,
                });
                let guard = chunk.as_ref().map(|c| c.read());
                for y in -1..=1 {
                    let index = (x + 1 + 3 * (z + 1 + 3 * (y + 1))) as usize;
                    let p = [key[0] + x, key[1] + y, key[2] + z];
                    sections[index] = guard.as_ref().and_then(|c| {
                        usize::try_from(p[1] - min_y)
                            .ok()
                            .and_then(|i| c.sections.get(i))
                            .cloned()
                    });
                    lights[index] = changes.lights.get(&p).cloned();
                }
            }
        }
        let biomes=if let Some(cached)=changes.biome_samples.get(&key) {cached.clone()}else {
        let mut biomes=Vec::with_capacity(216);
        let fallback=changes.biome_cache.biome(&world,azalea_core::position::BlockPos::new(key[0]*16+8,key[1]*16+8,key[2]*16+8)).map(|b|b.colors).unwrap_or_default();
        for y in -1..=4 {for z in -1..=4 {for x in -1..=4 {
            let p=azalea_core::position::BlockPos::new(key[0]*16+x*4,key[1]*16+y*4,key[2]*16+z*4);
            biomes.push(changes.biome_cache.biome(&world,p).map(|b|b.colors).unwrap_or(fallback));
        }}}
            let biomes:Arc<[_]>=biomes.into();
            if changes.biome_samples.len()<MAX_SECTIONS {changes.biome_samples.insert(key,biomes.clone());}
            biomes
        };
        work.push(Work { key, revision, sections, lights, biomes });
    }
    Ok(work)
}
pub fn expand(work: Vec<Work>) -> Vec<(Key, u64, Option<Arc<SectionSnapshot>>)> {
    work.into_iter()
        .map(|w| {
            if w.sections[13]
                .as_ref()
                .is_none_or(|s| s.block_count == 0 && s.fluid_count == 0)
            {
                return (w.key, w.revision, None);
            }
            let mut blocks = vec![0; 18 * 18 * 18];
            let mut light = vec![0; 18 * 18 * 18];
            let mut light_known = vec![0; 18 * 18 * 18];
            for y in 0..18i32 {
                for z in 0..18i32 {
                    for x in 0..18i32 {
                        let [lx, ly, lz] = [x - 1, y - 1, z - 1];
                        let index = (lx.div_euclid(16)
                            + 1
                            + 3 * (lz.div_euclid(16) + 1 + 3 * (ly.div_euclid(16) + 1)))
                            as usize;
                        let pos = ChunkSectionBlockPos {
                            x: lx.rem_euclid(16) as u8,
                            y: ly.rem_euclid(16) as u8,
                            z: lz.rem_euclid(16) as u8,
                        };
                        let dst = (x + 18 * (z + 18 * y)) as usize;
                        blocks[dst] = w.sections[index]
                            .as_ref()
                            .map_or(0, |s| u32::from(s.get_block_state(pos).id()));
                        if let Some(l) = &w.lights[index] {
                            let n = usize::from(pos.x)
                                + 16 * (usize::from(pos.z) + 16 * usize::from(pos.y));
                            let read = |bytes: &Option<Arc<[u8]>>| {
                                bytes
                                    .as_ref()
                                    .map_or(0, |b| (b[n / 2] >> ((n % 2) * 4)) & 15)
                            };
                            light[dst] = (read(&l.sky) << 4) | read(&l.block);
                            light_known[dst] =
                                u8::from(l.block.is_some()) | (u8::from(l.sky.is_some()) << 1);
                        }
                    }
                }
            }
            (
                w.key,
                w.revision,
                Some(Arc::new(SectionSnapshot {
                    biomes: w.biomes,
                    position: w.key,
                    revision: w.revision,
                    blocks,
                    light,
                    light_known,
                })),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use azalea_block::BlockTrait;
    #[test]
    fn sky_shaft_repairs_far_below_roof_and_rapid_edits_use_final_state() {
        use azalea_block::blocks;
        use azalea_core::position::BlockPos;
        let mut world = azalea_world::World::default();
        world.chunks = azalea_world::ChunkStorage::new(96, 0);
        let mut keep = Vec::new();
        let mut c = Changes {
            has_sky: true,
            ..Default::default()
        };
        let stone = blocks::Stone.as_block_state();
        let air = blocks::Air.as_block_state();
        for z in -1..=1 {
            for x in -1..=1 {
                let chunk = azalea_world::Chunk {
                    sections: vec![Section::default(); 6].into(),
                    heightmaps: Default::default(),
                };
                keep.push(world.chunks.upsert(ChunkPos { x, z }, chunk));
                for y in 0..6 {
                    c.lights.insert(
                        [x, y, z],
                        Light {
                            sky: Some(Arc::from(vec![0xff; 2048])),
                            block: Some(Arc::from(vec![0; 2048])),
                        },
                    );
                }
            }
        }
        for y in 0..96 {
            for z in 7..=9 {
                for x in 7..=9 {
                    if x != 8 || z != 8 || y == 0 {
                        world.chunks.set_block_state(BlockPos::new(x, y, z), stone);
                        c.write_light(
                            [x, y, z],
                            crate::lighting::LightSample {
                                block: Some(0),
                                sky: Some(0),
                            },
                        );
                    }
                }
            }
        }
        let settle = |c: &mut Changes| {
            for _ in 0..10000 {
                c.propagate(&world);
                if c.relight.is_empty() {
                    return;
                }
            }
            panic!("shaft never settled");
        };
        let roof = BlockPos::new(8, 80, 8);
        world.chunks.set_block_state(roof, stone);
        c.block([8, 80, 8]);
        settle(&mut c);
        assert_eq!(c.sample([8, 2, 8]).sky, Some(0), "78 blocks below roof");
        for _ in 0..10 {
            world.chunks.set_block_state(roof, air);
            c.block([8, 80, 8]);
            world.chunks.set_block_state(roof, stone);
            c.block([8, 80, 8]);
        }
        world.chunks.set_block_state(roof, air);
        c.block([8, 80, 8]);
        settle(&mut c);
        assert_eq!(c.sample([8, 2, 8]).sky, Some(15));
        let before = c.visited;
        settle(&mut c);
        assert_eq!(before, c.visited);
    }
    #[test]
    fn incremental_random_edits_match_independent_flood_fill() {
        use azalea_block::{BlockTrait, blocks};
        use azalea_core::position::BlockPos;
        let mut world = azalea_world::World::default();
        world.chunks = azalea_world::ChunkStorage::new(32, 0);
        let mut keep = Vec::new();
        let mut changes = Changes::default();
        for z in -1..=1 {
            for x in -1..=1 {
                let chunk = azalea_world::Chunk {
                    sections: vec![Section::default(); 2].into(),
                    heightmaps: Default::default(),
                };
                keep.push(world.chunks.upsert(ChunkPos { x, z }, chunk));
                for y in 0..2 {
                    changes.lights.insert(
                        [x, y, z],
                        Light {
                            sky: Some(Arc::from(vec![0; 2048])),
                            block: Some(Arc::from(vec![0; 2048])),
                        },
                    );
                }
            }
        }
        let variants = [
            blocks::Air.as_block_state(),
            blocks::Glowstone.as_block_state(),
            blocks::Torch.as_block_state(),
            blocks::Stone.as_block_state(),
            blocks::Glass.as_block_state(),
        ];
        let mut edited = HashMap::new();
        let mut random = 719u64;
        for step in 0..40 {
            random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
            let p = [
                4 + (random % 8) as i32,
                4 + ((random >> 8) % 8) as i32,
                4 + ((random >> 16) % 8) as i32,
            ];
            let state = variants[((random >> 24) % 5) as usize];
            edited.insert(p, u32::from(state.id()));
            world
                .chunks
                .set_block_state(BlockPos::new(p[0], p[1], p[2]), state);
            changes.block(p);
            for _ in 0..10000 {
                changes.propagate(&world);
                if changes.relight.is_empty() {
                    break;
                }
            }
            assert!(changes.relight.is_empty(), "relaxation failed to settle");
            // Independent from-zero, increasing-only oracle; no incremental state is reused.
            let mut expected = HashMap::<[i32; 3], u8>::new();
            let mut queue = VecDeque::new();
            for (&p, &state) in &edited {
                let emission = crate::light_properties::get(state).emission();
                if emission > 0 {
                    expected.insert(p, emission);
                    queue.push_back(p);
                }
            }
            while let Some(p) = queue.pop_front() {
                let value = expected[&p];
                let from = *edited.get(&p).unwrap_or(&0);
                for (face, d) in DIRECTIONS.iter().enumerate() {
                    let n = std::array::from_fn(|i| p[i] + d[i]);
                    if n[1] < 0
                        || n[1] >= 32
                        || !(-16..32).contains(&n[0])
                        || !(-16..32).contains(&n[2])
                    {
                        continue;
                    }
                    let to = *edited.get(&n).unwrap_or(&0);
                    if crate::light_properties::occluded(from, to, face) {
                        continue;
                    }
                    let value =
                        value.saturating_sub(crate::light_properties::get(to).attenuation().max(1));
                    if value > expected.get(&n).copied().unwrap_or(0) {
                        expected.insert(n, value);
                        queue.push_back(n);
                    }
                }
            }
            for y in 0..24 {
                for z in -8..28 {
                    for x in -8..28 {
                        let p = [x, y, z];
                        assert_eq!(
                            changes.sample(p).block,
                            Some(expected.get(&p).copied().unwrap_or(0)),
                            "edit {step} at {p:?}"
                        );
                    }
                }
            }
        }
        let before = changes.visited;
        changes.propagate(&world);
        assert_eq!(
            before, changes.visited,
            "settled worlds must do no propagation work"
        );
    }
    #[test]
    fn partial_light_updates_preserve_other_channel_and_known_zero() {
        use azalea_core::bitset::BitSet;
        let mut c = Changes::default();
        let mut p = ClientboundLightUpdatePacketData::default();
        p.sky_y_mask = BitSet::new(64);
        p.sky_y_mask.set(1);
        p.sky_updates = Arc::new(vec![vec![0xff; 2048].into_boxed_slice()].into_boxed_slice());
        c.light(-1, 0, -64, 384, &p);
        let pos = [-16, -64, 0];
        assert_eq!(c.sample(pos).sky, Some(15));
        assert_eq!(c.sample(pos).block, None);
        let mut b = ClientboundLightUpdatePacketData::default();
        b.empty_block_y_mask = BitSet::new(64);
        b.empty_block_y_mask.set(1);
        c.light(-1, 0, -64, 384, &b);
        assert_eq!(
            c.sample(pos),
            crate::lighting::LightSample {
                block: Some(0),
                sky: Some(15)
            }
        );
        c.dirty.clear();
        c.light(-1, 0, -64, 384, &b);
        assert!(c.dirty.is_empty(), "identical zero updates must not remesh");
        c.light(-1, 0, -64, 384, &p);
        assert!(c.dirty.is_empty(), "identical arrays must not remesh");
        b.block_y_mask = BitSet::new(64);
        b.block_y_mask.set(1);
        c.light(-1, 0, -64, 384, &b);
        assert!(c.error.is_some(), "conflicting/missing data rejected");
    }
    #[test]
    fn halo_preserves_negative_section_boundary_and_light_nibbles() {
        let mut core = Section::default();
        let stone = azalea_block::blocks::Stone.as_block_state();
        core.get_and_set_block_state(ChunkSectionBlockPos { x: 15, y: 1, z: 15 }, stone);
        let mut sections = vec![None; 27];
        sections[13] = Some(core.clone());
        sections[12] = Some(core);
        let mut lights = vec![None; 27];
        lights[13] = Some(Light {
            sky: Some(Arc::from(vec![0xF4; 2048])),
            block: None,
        });
        let result = expand(vec![Work {
            biomes:Arc::from([]),
            key: [-1, -4, -1],
            revision: 7,
            sections,
            lights,
        }]);
        let snapshot = result[0].2.as_ref().unwrap();
        assert_eq!(
            snapshot.blocks[16 + 18 * (16 + 18 * 2)],
            u32::from(stone.id())
        );
        assert_eq!(snapshot.blocks[18 * (16 + 18 * 2)], u32::from(stone.id()));
        assert_eq!(snapshot.light[16 + 18 * (16 + 18 * 2)], 0xF0);
        assert_eq!(snapshot.position, [-1, -4, -1]);
    }
    #[test]
    fn idle_changes_create_no_work_and_newer_updates_invalidate_results() {
        let mut changes = Changes::default();
        assert!(changes.dirty.is_empty());
        changes.mark([0, 0, 0]);
        let first = changes.dirty[&[0, 0, 0]];
        changes.mark([0, 0, 0]);
        assert!(!changes.fresh(&[0, 0, 0], first));
    }
    #[test]
    fn hostile_section_coordinates_cannot_overflow_neighbor_arithmetic() {
        let mut changes = Changes::default();
        changes.around([i32::MAX, 0, i32::MIN]);
        changes.around([0, i32::MAX, 0]);
        assert!(changes.dirty.is_empty());
    }
    #[test]
    fn single_block_edits_only_invalidate_intersecting_halos() {
        let mut changes = Changes::default();
        changes.block([5, 5, 5]);
        assert_eq!(changes.dirty.len(), 1);
        changes.dirty.clear();
        changes.block([-1, -1, -1]);
        assert_eq!(changes.dirty.len(), 8);
        assert!(changes.dirty.contains_key(&[-1, -1, -1]));
        assert!(changes.dirty.contains_key(&[0, 0, 0]));
    }
}
