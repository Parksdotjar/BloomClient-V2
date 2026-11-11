//! Read packets from a stream.

use std::{
    backtrace::Backtrace,
    env,
    fmt::Debug,
    io,
    io::Cursor,
    sync::LazyLock,
};

use azalea_buf::{AzBufVar, BufReadError};
use azalea_crypto::Aes128CfbDec;
use flate2::{Decompress, FlushDecompress, Status};
use futures::StreamExt;
use futures_lite::future;
use thiserror::Error;
use tokio::io::AsyncRead;
use tokio_util::{
    bytes::Buf,
    codec::{BytesCodec, FramedRead},
};
use tracing::trace;

use crate::packets::ProtocolPacket;

#[derive(Debug, Error)]
pub enum ReadPacketError {
    #[error("Error reading packet {packet_name} (id {packet_id}): {source}")]
    Parse {
        packet_id: u32,
        packet_name: String,
        backtrace: Box<Backtrace>,
        source: BufReadError,
    },
    #[error("Unknown packet id {id} in state {state_name}")]
    UnknownPacketId { state_name: String, id: u32 },
    #[error("Couldn't read packet id")]
    ReadPacketId { source: BufReadError },
    #[error(transparent)]
    Decompress {
        #[from]
        #[backtrace]
        source: DecompressionError,
    },
    #[error(transparent)]
    FrameSplitter {
        #[from]
        #[backtrace]
        source: FrameSplitterError,
    },
    #[error("Leftover data after reading packet {packet_name}: {data:?}")]
    LeftoverData { data: Vec<u8>, packet_name: String },
    #[error(transparent)]
    IoError {
        #[from]
        #[backtrace]
        source: io::Error,
    },
    #[error("Connection closed")]
    ConnectionClosed,
}

#[derive(Debug, Error)]
pub enum FrameSplitterError {
    #[error("Couldn't read VarInt length for packet. The previous packet may have been corrupted")]
    LengthRead {
        #[from]
        source: BufReadError,
    },
    #[error("Io error")]
    Io {
        #[from]
        #[backtrace]
        source: io::Error,
    },
    #[error("Packet is longer than {max} bytes (is {size})")]
    BadLength { max: usize, size: usize },
    #[error("Packet exceeds the wire frame limit of {maximum} bytes (is {size})")]
    FrameTooLarge { maximum: usize, size: usize },
    #[error("Pending packet data exceeds the receive buffer limit")]
    BufferTooLarge,
    #[error("Connection reset by peer")]
    ConnectionReset,
    #[error("Connection closed")]
    ConnectionClosed,
}

// Sakura transport patch: cap the advertised frame before buffering its body.
// Keep this separate from BadLength, which means an incomplete frame and is
// intentionally retried by frame_splitter.
pub const MAXIMUM_FRAME_LENGTH: usize = 8_388_608;
const READ_CHUNK_SIZE: usize = 8_192;
const MAXIMUM_BUFFER_LENGTH: usize = MAXIMUM_FRAME_LENGTH + READ_CHUNK_SIZE + 5;

/// Read a length, then read that amount of bytes from the `Cursor<Vec<u8>>`. If
/// there's not enough data, `None` is returned.
fn parse_frame(buffer: &mut Cursor<Vec<u8>>) -> Result<Box<[u8]>, FrameSplitterError> {
    // copy the buffer first and read from the copy, then once we make sure
    // the packet is all good we read it fully
    let mut buffer_copy = Cursor::new(&buffer.get_ref()[buffer.position() as usize..]);
    // Packet Length
    let length = match u32::azalea_read_var(&mut buffer_copy) {
        Ok(length) => length as usize,
        Err(err) => match err {
            BufReadError::Io { source } => return Err(FrameSplitterError::Io { source }),
            _ => return Err(err.into()),
        },
    };

    if length > MAXIMUM_FRAME_LENGTH {
        return Err(FrameSplitterError::FrameTooLarge {
            maximum: MAXIMUM_FRAME_LENGTH,
            size: length,
        });
    }

    if length > buffer_copy.remaining() {
        return Err(FrameSplitterError::BadLength {
            max: buffer_copy.remaining(),
            size: length,
        });
    }

    // we read from the copy and we know it's legit, so we can take those bytes
    // from the real buffer now

    // the length of the varint that says the length of the whole packet
    let varint_length = buffer.remaining() - buffer_copy.remaining();

    buffer.advance(varint_length);
    let data =
        buffer.get_ref()[buffer.position() as usize..buffer.position() as usize + length].to_vec();
    buffer.advance(length);

    if buffer.position() == buffer.get_ref().len() as u64 {
        // reset the inner vec once we've reached the end of the buffer so we don't keep
        // leaking memory
        buffer.get_mut().clear();

        // we just cap the capacity to 64KB instead of resetting it to save some
        // allocations.
        // and the reason we bother capping it at all is to avoid wasting memory if we
        // get a big packet once and then never again.
        buffer.get_mut().shrink_to(1024 * 64);

        buffer.set_position(0);
    }

    Ok(data.into_boxed_slice())
}

fn frame_splitter(buffer: &mut Cursor<Vec<u8>>) -> Result<Option<Box<[u8]>>, FrameSplitterError> {
    // https://tokio.rs/tokio/tutorial/framing
    let read_frame = parse_frame(buffer);
    match read_frame {
        Ok(frame) => return Ok(Some(frame)),
        Err(err) => match err {
            FrameSplitterError::BadLength { .. } | FrameSplitterError::Io { .. } => {
                // we probably just haven't read enough yet
            }
            _ => return Err(err),
        },
    }

    Ok(None)
}

pub fn deserialize_packet<P: ProtocolPacket + Debug>(
    stream: &mut Cursor<&[u8]>,
) -> Result<P, Box<ReadPacketError>> {
    // Packet ID
    let packet_id =
        u32::azalea_read_var(stream).map_err(|e| ReadPacketError::ReadPacketId { source: e })?;
    P::read(packet_id, stream)
}

// this is always true in multiplayer, false in singleplayer
static VALIDATE_DECOMPRESSED: bool = true;

pub static MAXIMUM_UNCOMPRESSED_LENGTH: u32 = 8_388_608;

#[derive(Debug, Error)]
pub enum DecompressionError {
    #[error("Couldn't read VarInt length for data")]
    LengthReadError {
        #[from]
        source: BufReadError,
    },
    #[error("Io error")]
    Io {
        #[from]
        #[backtrace]
        source: io::Error,
    },
    #[error("Badly compressed packet - size of {size} is below server threshold of {threshold}")]
    BelowCompressionThreshold { size: u32, threshold: u32 },
    #[error(
        "Badly compressed packet - size of {size} is larger than protocol maximum of {maximum}"
    )]
    AboveCompressionThreshold { size: u32, maximum: u32 },
    #[error("Decompressed length does not match the advertised {expected} bytes (read {actual})")]
    LengthMismatch { expected: usize, actual: usize },
    #[error("Compressed packet is truncated, corrupt, or contains trailing data")]
    InvalidStream,
    #[error("Uncompressed packet exceeds the size or compression threshold")]
    InvalidUncompressedLength,
}

/// Get the decompressed bytes from a packet.
///
/// The stream must have already been decrypted before passing it to this
/// function.
pub fn compression_decoder(
    stream: &mut Cursor<&[u8]>,
    compression_threshold: u32,
) -> Result<Box<[u8]>, DecompressionError> {
    // Data Length
    let n = u32::azalea_read_var(stream)?;
    if n == 0 {
        // no data size, no compression
        let length = stream.get_ref().len() - stream.position() as usize;
        if length > MAXIMUM_UNCOMPRESSED_LENGTH as usize
            || length >= compression_threshold as usize
        {
            return Err(DecompressionError::InvalidUncompressedLength);
        }
        let buf = stream.get_ref()[stream.position() as usize..]
            .to_vec()
            .into_boxed_slice();
        stream.set_position(stream.get_ref().len() as u64);
        return Ok(buf);
    }

    if VALIDATE_DECOMPRESSED {
        if n < compression_threshold {
            return Err(DecompressionError::BelowCompressionThreshold {
                size: n,
                threshold: compression_threshold,
            });
        }
        if n > MAXIMUM_UNCOMPRESSED_LENGTH {
            return Err(DecompressionError::AboveCompressionThreshold {
                size: n,
                maximum: MAXIMUM_UNCOMPRESSED_LENGTH,
            });
        }
    }

    // One fixed-size destination prevents a dishonest advertised length from
    // turning read_to_end into an unbounded decompression allocation. The extra
    // byte detects overflow, including streams that claim a very small output.
    let expected = n as usize;
    let mut decoded_buf = vec![0; expected + 1];
    let compressed = &stream.get_ref()[stream.position() as usize..];
    let mut decoder = Decompress::new(true);
    let status = decoder
        .decompress(compressed, &mut decoded_buf, FlushDecompress::Finish)
        .map_err(|_| DecompressionError::InvalidStream)?;
    let actual = decoder.total_out() as usize;
    if actual != expected {
        return Err(DecompressionError::LengthMismatch { expected, actual });
    }
    if status != Status::StreamEnd || decoder.total_in() as usize != compressed.len() {
        return Err(DecompressionError::InvalidStream);
    }
    decoded_buf.truncate(expected);
    stream.set_position(stream.get_ref().len() as u64);
    Ok(decoded_buf.into_boxed_slice())
}

fn append_frame_bytes(
    buffer: &mut Cursor<Vec<u8>>,
    bytes: &[u8],
) -> Result<(), FrameSplitterError> {
    // A stream can continually leave a partial next frame. Compact consumed
    // prefixes before each read instead of retaining every preceding packet.
    let consumed = buffer.position() as usize;
    if consumed > 0 {
        let remaining = buffer.get_ref().len() - consumed;
        buffer.get_mut().copy_within(consumed.., 0);
        buffer.get_mut().truncate(remaining);
        buffer.set_position(0);
    }
    if bytes.len() > MAXIMUM_BUFFER_LENGTH.saturating_sub(buffer.get_ref().len()) {
        return Err(FrameSplitterError::BufferTooLarge);
    }
    buffer.get_mut().extend_from_slice(bytes);
    Ok(())
}

fn fatal_transport_error(error: impl std::fmt::Display) -> ReadPacketError {
    // azalea-client only closes RawConnection for IO/closed errors. A corrupt
    // frame cannot be retried safely; exposing it as a recoverable parse error
    // would leave a malicious peer connected (or reread the same header).
    ReadPacketError::IoError {
        source: io::Error::new(io::ErrorKind::InvalidData, error.to_string()),
    }
}

/// Read a single packet from a stream.
///
/// The buffer is required because servers may send multiple packets in the
/// same frame, so we need to store the packet data that's left to read.
///
/// The current protocol state must be passed as a generic.
///
/// For the non-waiting version, see [`try_read_packet`].
pub async fn read_packet<P: ProtocolPacket + Debug, R>(
    stream: &mut R,
    buffer: &mut Cursor<Vec<u8>>,
    compression_threshold: Option<u32>,
    cipher: &mut Option<Aes128CfbDec>,
) -> Result<P, Box<ReadPacketError>>
where
    R: AsyncRead + Unpin + Send + Sync,
{
    let raw_packet = read_raw_packet(stream, buffer, compression_threshold, cipher).await?;
    let packet = deserialize_packet(&mut Cursor::new(&raw_packet))?;
    Ok(packet)
}

/// Try to read a single packet from a stream. Returns None if we haven't
/// received a full packet yet.
pub fn try_read_packet<P: ProtocolPacket + Debug, R>(
    stream: &mut R,
    buffer: &mut Cursor<Vec<u8>>,
    compression_threshold: Option<u32>,
    cipher: &mut Option<Aes128CfbDec>,
) -> Result<Option<P>, Box<ReadPacketError>>
where
    R: AsyncRead + Unpin + Send + Sync,
{
    let Some(raw_packet) = try_read_raw_packet(stream, buffer, compression_threshold, cipher)?
    else {
        return Ok(None);
    };
    let packet = deserialize_packet(&mut Cursor::new(&raw_packet))?;
    Ok(Some(packet))
}

pub async fn read_raw_packet<R>(
    stream: &mut R,
    buffer: &mut Cursor<Vec<u8>>,
    compression_threshold: Option<u32>,
    // this has to be a &mut Option<T> instead of an Option<&mut T> because
    // otherwise the borrow checker complains about the cipher being moved
    cipher: &mut Option<Aes128CfbDec>,
) -> Result<Box<[u8]>, Box<ReadPacketError>>
where
    R: AsyncRead + Unpin + Send + Sync,
{
    loop {
        if let Some(buf) = read_raw_packet_from_buffer::<R>(buffer, compression_threshold)? {
            // we got a full packet!!
            return Ok(buf);
        };

        let bytes = read_and_decrypt_frame(stream, cipher).await?;
        append_frame_bytes(buffer, &bytes).map_err(fatal_transport_error)?;
    }
}
/// Read a packet from the stream, then if necessary decrypt it, decompress
/// it, and split it.
pub fn try_read_raw_packet<R>(
    stream: &mut R,
    buffer: &mut Cursor<Vec<u8>>,
    compression_threshold: Option<u32>,
    cipher: &mut Option<Aes128CfbDec>,
) -> Result<Option<Box<[u8]>>, Box<ReadPacketError>>
where
    R: AsyncRead + Unpin + Send + Sync,
{
    loop {
        if let Some(buf) = read_raw_packet_from_buffer::<R>(buffer, compression_threshold)? {
            // we got a full packet!!
            return Ok(Some(buf));
        };
        let Some(bytes) = try_read_and_decrypt_frame(stream, cipher)? else {
            // no data received
            return Ok(None);
        };
        // we got some data, so add it to the buffer and try again
        append_frame_bytes(buffer, &bytes).map_err(fatal_transport_error)?;
    }
}

async fn read_and_decrypt_frame<R>(
    stream: &mut R,
    cipher: &mut Option<Aes128CfbDec>,
) -> Result<Box<[u8]>, Box<ReadPacketError>>
where
    R: AsyncRead + Unpin + Send + Sync,
{
    let mut framed = FramedRead::with_capacity(stream, BytesCodec::new(), READ_CHUNK_SIZE);

    let Some(message) = framed.next().await else {
        return Err(Box::new(ReadPacketError::ConnectionClosed));
    };
    let bytes = message.map_err(ReadPacketError::from)?;

    let mut bytes = bytes.to_vec().into_boxed_slice();

    // decrypt if necessary
    if let Some(cipher) = cipher {
        azalea_crypto::decrypt_packet(cipher, &mut bytes);
    }

    Ok(bytes)
}
fn try_read_and_decrypt_frame<R>(
    stream: &mut R,
    cipher: &mut Option<Aes128CfbDec>,
) -> Result<Option<Box<[u8]>>, Box<ReadPacketError>>
where
    R: AsyncRead + Unpin + Send + Sync,
{
    let mut framed = FramedRead::with_capacity(stream, BytesCodec::new(), READ_CHUNK_SIZE);

    let Some(message) = future::block_on(future::poll_once(framed.next())) else {
        // nothing yet
        return Ok(None);
    };
    let Some(message) = message else {
        return Err(Box::new(ReadPacketError::ConnectionClosed));
    };
    let bytes = message.map_err(ReadPacketError::from)?;
    let mut bytes = bytes.to_vec().into_boxed_slice();

    // decrypt if necessary
    if let Some(cipher) = cipher {
        azalea_crypto::decrypt_packet(cipher, &mut bytes);
    }

    Ok(Some(bytes))
}

pub fn read_raw_packet_from_buffer<R>(
    buffer: &mut Cursor<Vec<u8>>,
    compression_threshold: Option<u32>,
) -> Result<Option<Box<[u8]>>, Box<ReadPacketError>>
where
    R: AsyncRead + Unpin + Send + Sync,
{
    let Some(mut buf) = frame_splitter(buffer).map_err(fatal_transport_error)? else {
        // no full packet yet :(
        return Ok(None);
    };

    if let Some(compression_threshold) = compression_threshold {
        buf = compression_decoder(&mut Cursor::new(&buf[..]), compression_threshold)
            .map_err(fatal_transport_error)?;
    }

    if tracing::enabled!(tracing::Level::TRACE) {
        static DO_NOT_CUT_OFF_PACKET_LOGS: LazyLock<bool> = LazyLock::new(|| {
            env::var("AZALEA_DO_NOT_CUT_OFF_PACKET_LOGS")
                .map(|s| s == "1" || s == "true")
                .unwrap_or(false)
        });

        let buf_string: String = {
            if !*DO_NOT_CUT_OFF_PACKET_LOGS && buf.len() > 500 {
                let cut_off_buf = &buf[..500];
                format!("{cut_off_buf:?}...")
            } else {
                format!("{buf:?}")
            }
        };
        trace!("Reading packet with bytes: {buf_string}");
    };

    Ok(Some(buf))
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use azalea_buf::{AzBuf as _, AzBufVar as _};
    use flate2::{Compression, write::ZlibEncoder};

    use crate::{packets::game::ClientboundGamePacket, read::deserialize_packet};
    use super::{
        append_frame_bytes, compression_decoder, frame_splitter,
        DecompressionError, FrameSplitterError, MAXIMUM_BUFFER_LENGTH,
        MAXIMUM_FRAME_LENGTH, MAXIMUM_UNCOMPRESSED_LENGTH,
    };

    fn compressed(data: &[u8], advertised: u32) -> Vec<u8> {
        let mut result = Vec::new();
        advertised.azalea_write_var(&mut result).unwrap();
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).unwrap();
        result.extend(encoder.finish().unwrap());
        result
    }

    #[test]
    fn sakura_transport_rejections_are_fatal_to_the_client() {
        let mut header = Vec::new();
        (MAXIMUM_FRAME_LENGTH as u32 + 1).azalea_write_var(&mut header).unwrap();
        let body = compressed(&[1; 128], 16);
        let mut bomb = Vec::new();
        (body.len() as u32).azalea_write_var(&mut bomb).unwrap();
        bomb.extend(body);
        for (bytes, threshold) in [(header, None), (bomb, Some(16))] {
            let error = super::read_raw_packet_from_buffer::<tokio::io::Empty>(
                &mut Cursor::new(bytes), threshold,
            ).unwrap_err();
            assert!(matches!(*error, super::ReadPacketError::IoError { ref source }
                if source.kind() == std::io::ErrorKind::InvalidData));
        }
    }

    #[test]
    fn sakura_rejects_oversized_frame_from_header_alone() {
        for length in [MAXIMUM_FRAME_LENGTH as u32 + 1, u32::MAX] {
            let mut bytes = Vec::new();
            length.azalea_write_var(&mut bytes).unwrap();
            let error = frame_splitter(&mut Cursor::new(bytes)).unwrap_err();
            assert!(matches!(error, FrameSplitterError::FrameTooLarge { .. }));
        }
    }

    #[test]
    fn sakura_accepts_fragmented_frames_without_retaining_consumed_prefixes() {
        let mut buffer = Cursor::new(vec![2, 7]);
        assert!(frame_splitter(&mut buffer).unwrap().is_none());
        append_frame_bytes(&mut buffer, &[8, 2, 7]).unwrap();
        assert_eq!(&*frame_splitter(&mut buffer).unwrap().unwrap(), &[7, 8]);
        for _ in 0..1000 {
            assert!(frame_splitter(&mut buffer).unwrap().is_none());
            append_frame_bytes(&mut buffer, &[8, 2, 7]).unwrap();
            assert!(buffer.get_ref().len() <= 5);
            assert_eq!(&*frame_splitter(&mut buffer).unwrap().unwrap(), &[7, 8]);
        }
    }

    #[test]
    fn sakura_rejects_receive_buffer_overflow_before_append() {
        let mut buffer = Cursor::new(vec![0; MAXIMUM_BUFFER_LENGTH]);
        assert!(matches!(append_frame_bytes(&mut buffer, &[1]), Err(FrameSplitterError::BufferTooLarge)));
        assert_eq!(buffer.get_ref().len(), MAXIMUM_BUFFER_LENGTH);
    }

    #[test]
    fn sakura_accepts_complete_compressed_packet_and_consumes_it() {
        let input = compressed(b"a complete packet", 17);
        let mut cursor = Cursor::new(input.as_slice());
        assert_eq!(&*compression_decoder(&mut cursor, 1).unwrap(), b"a complete packet");
        assert_eq!(cursor.position() as usize, input.len());
    }

    #[test]
    fn sakura_compressed_bomb_cannot_expand_past_advertised_destination() {
        // 1 MiB of repeating input, advertised as a single byte. The decoder
        // gets a fixed two-byte destination and cannot allocate the full body.
        let input = compressed(&vec![b'x'; 1024 * 1024], 1);
        let error = compression_decoder(&mut Cursor::new(input.as_slice()), 1).unwrap_err();
        match error {
            DecompressionError::LengthMismatch { expected, actual } => {
                assert_eq!(expected, 1);
                assert!(actual <= 2);
            }
            // Some flate backends report a full output buffer as a stream error.
            DecompressionError::InvalidStream => {}
            other => panic!("unexpected bounded-decode error: {other}"),
        }
    }

    #[test]
    fn sakura_rejects_wrong_advertised_output_length() {
        let input = compressed(b"short", 12);
        assert!(matches!(compression_decoder(&mut Cursor::new(input.as_slice()), 1),
            Err(DecompressionError::LengthMismatch { expected: 12, actual: 5 })));
    }

    #[test]
    fn sakura_rejects_truncated_zlib_checksum_even_if_output_is_complete() {
        let mut input = compressed(b"complete output", 15);
        input.pop();
        assert!(compression_decoder(&mut Cursor::new(input.as_slice()), 1).is_err());
    }

    #[test]
    fn sakura_rejects_corrupt_zlib_checksum() {
        let mut input = compressed(b"complete output", 15);
        *input.last_mut().unwrap() ^= 0xff;
        assert!(compression_decoder(&mut Cursor::new(input.as_slice()), 1).is_err());
    }

    #[test]
    fn sakura_rejects_trailing_compressed_stream_data() {
        let mut input = compressed(b"complete output", 15);
        input.extend([0, 0, 0]);
        assert!(matches!(compression_decoder(&mut Cursor::new(input.as_slice()), 1),
            Err(DecompressionError::InvalidStream)));
    }

    #[test]
    fn sakura_checks_uncompressed_packet_threshold() {
        assert_eq!(&*compression_decoder(&mut Cursor::new(&[0, 1, 2][..]), 3).unwrap(), &[1, 2]);
        assert!(matches!(compression_decoder(&mut Cursor::new(&[0, 1, 2][..]), 2),
            Err(DecompressionError::InvalidUncompressedLength)));
        assert!(compression_decoder(&mut Cursor::new(&[0, 1][..]), 0).is_err());
    }

    #[test]
    fn sakura_rejects_oversized_advertised_output_without_allocating_it() {
        let mut input = Vec::new();
        (MAXIMUM_UNCOMPRESSED_LENGTH + 1).azalea_write_var(&mut input).unwrap();
        assert!(matches!(compression_decoder(&mut Cursor::new(input.as_slice()), 1),
            Err(DecompressionError::AboveCompressionThreshold { .. })));
    }

    #[test]
    fn fuzzed_1() {
        // oom: checks for unbounded TagMap
        let _ = deserialize_packet::<ClientboundGamePacket>(&mut Cursor::new(
            [132, 1, 255, 255, 255, 255, 255].as_slice(),
        ));
    }
    #[test]
    fn fuzzed_2() {
        // oom: also checks for unbounded TagMap
        let _ = deserialize_packet::<ClientboundGamePacket>(&mut Cursor::new(
            [132, 1, 75, 0, 255, 255, 255, 255, 24, 0].as_slice(),
        ));
    }
    #[test]
    fn fuzzed_3() {
        // panic: integer overflow in HolderSet::azalea_read
        let _ = deserialize_packet::<ClientboundGamePacket>(&mut Cursor::new(
            [
                94, 44, 157, 38, 61, 37, 37, 37, 37, 37, 37, 65, 128, 128, 1, 1, 255, 252, 128,
                128, 128, 128, 128, 128, 128, 40, 0,
            ]
            .as_slice(),
        ));
    }
    #[test]
    fn fuzzed_4() {
        // memory leak in DataComponentPatch
        let _ = deserialize_packet::<ClientboundGamePacket>(&mut Cursor::new(
            [94, 94, 70, 52, 0, 6, 0].as_slice(),
        ));
    }
    #[test]
    fn fuzzed_5() {
        // also a memory leak in DataComponentPatch
        let _ = deserialize_packet::<ClientboundGamePacket>(&mut Cursor::new(
            [94, 94, 70, 52, 0, 6, 0, 6, 0].as_slice(),
        ));
    }
    #[test]
    fn fuzzed_6() {
        // memory leak in simdnbt
        let _ = simdnbt::owned::Nbt::azalea_read(&mut Cursor::new([10, 10, 0, 0, 0].as_slice()));
    }
}
