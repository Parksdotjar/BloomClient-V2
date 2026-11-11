//! State-indexed facts extracted from the official Java 26.1 registry.
//! Not derived from textures, collision boxes, or model names.
const DATA: &[u8] = include_bytes!("../reference/lighting-26.1.bin");
const STATES: usize = 29873;
#[derive(Clone, Copy)]
pub struct Properties {
    data: &'static [u8],
}
pub fn get(state: u32) -> Properties {
    let state = if (state as usize) < STATES {
        state as usize
    } else {
        0
    };
    let i = 8 + state * 2;
    let id = u16::from_le_bytes([DATA[i], DATA[i + 1]]) as usize;
    let start = 8 + STATES * 2 + id * 196;
    Properties {
        data: &DATA[start..start + 196],
    }
}
impl Properties {
    pub fn emission(self) -> u8 {
        self.data[0]
    }
    pub fn attenuation(self) -> u8 {
        self.data[1]
    }
    pub fn ao(self) -> f32 {
        self.data[2] as f32 / 255.
    }
    pub fn sky_down(self) -> bool {
        self.data[3] & 1 != 0
    }
    pub fn shape_occlusion(self) -> bool {
        self.data[3] & 2 != 0
    }
    pub fn solid(self) -> bool {
        self.data[3] & 4 != 0
    }
    pub fn shadow_receiver(self) -> bool {
        self.data[3] & 8 != 0
    }
    pub fn face(self, face: usize) -> &'static [u8] {
        &self.data[4 + face * 32..4 + (face + 1) * 32]
    }
}
pub fn occluded(from: u32, to: u32, face: usize) -> bool {
    let a = get(from);
    let b = get(to);
    if !a.shape_occlusion() && !b.shape_occlusion() {
        return false;
    }
    let af = a.face(face);
    let bf = b.face(face ^ 1);
    (0..32).all(|i| {
        (if a.shape_occlusion() { af[i] } else { 0 })
            | (if b.shape_occlusion() { bf[i] } else { 0 })
            == 255
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use azalea_block::{BlockTrait, blocks};
    #[test]
    fn versioned_registry_and_source_strengths() {
        assert_eq!(
            u32::from_le_bytes(DATA[0..4].try_into().unwrap()),
            STATES as u32
        );
        assert_eq!(
            get(blocks::Torch.as_block_state().id() as u32).emission(),
            14
        );
        assert_eq!(
            get(blocks::Glowstone.as_block_state().id() as u32).emission(),
            15
        );
        assert_eq!(
            get(blocks::Stone.as_block_state().id() as u32).attenuation(),
            15
        );
        assert!(get(0).sky_down());
        assert_eq!(get(0).emission(), 0);
    }
}
