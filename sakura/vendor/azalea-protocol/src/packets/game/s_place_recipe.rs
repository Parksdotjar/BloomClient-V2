use azalea_buf::AzBuf;
use azalea_protocol_macros::ServerboundGamePacket;

#[derive(AzBuf, Clone, Debug, PartialEq, ServerboundGamePacket)]
pub struct ServerboundPlaceRecipe {
    #[var]
    pub container_id: i32,
    #[var]
    pub recipe: u32,
    pub shift_down: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn recipe_placement_uses_display_index_varint_not_a_resource_name() {
        let packet = ServerboundPlaceRecipe {
            container_id: 130,
            recipe: 300,
            shift_down: true,
        };
        let mut bytes = Vec::new();
        packet.azalea_write(&mut bytes).unwrap();
        assert_eq!(bytes, [0x82, 0x01, 0xac, 0x02, 0x01]);
        assert_eq!(
            ServerboundPlaceRecipe::azalea_read(&mut Cursor::new(&bytes)).unwrap(),
            packet
        );
    }
}
