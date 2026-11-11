use azalea_buf::AzBuf;
use azalea_core::entity_id::MinecraftEntityId;
use azalea_protocol_macros::ServerboundGamePacket;

#[derive(Clone, Debug, AzBuf, PartialEq, ServerboundGamePacket)]
pub struct ServerboundAttack {
    #[var]
    pub entity_id: MinecraftEntityId,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn attack_entity_id_uses_protocol_varint_not_fixed_i32() {
        for (id, expected) in [
            (1, vec![1]),
            (300, vec![0xac, 0x02]),
            (-1, vec![0xff, 0xff, 0xff, 0xff, 0x0f]),
        ] {
            let packet = ServerboundAttack {
                entity_id: MinecraftEntityId(id),
            };
            let mut bytes = Vec::new();
            packet.azalea_write(&mut bytes).unwrap();
            assert_eq!(bytes, expected);
            let mut reader = Cursor::new(bytes.as_slice());
            assert_eq!(ServerboundAttack::azalea_read(&mut reader).unwrap(), packet);
            assert_eq!(reader.position(), bytes.len() as u64);
        }
    }
}
