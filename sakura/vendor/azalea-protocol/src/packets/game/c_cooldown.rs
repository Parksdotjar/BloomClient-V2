use azalea_buf::AzBuf;
use azalea_protocol_macros::ClientboundGamePacket;
use azalea_registry::identifier::Identifier;

#[derive(AzBuf, ClientboundGamePacket, Clone, Debug, PartialEq)]
pub struct ClientboundCooldown {
    pub cooldown_group: Identifier,
    #[var]
    pub duration: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn cooldown_group_is_an_identifier_before_varint_duration() {
        let group = "minecraft:ender_pearl";
        let mut bytes = vec![group.len() as u8];
        bytes.extend_from_slice(group.as_bytes());
        bytes.extend_from_slice(&[0xac, 0x02]);
        let packet = ClientboundCooldown::azalea_read(&mut Cursor::new(&bytes)).unwrap();
        assert_eq!(packet.cooldown_group.to_string(), group);
        assert_eq!(packet.duration, 300);
        let mut written = Vec::new();
        packet.azalea_write(&mut written).unwrap();
        assert_eq!(written, bytes);
    }
}
