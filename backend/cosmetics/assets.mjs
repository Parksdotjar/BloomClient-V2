import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}
export const requireValue = (condition, code = 'invalid_request') => {
  if (!condition) throw new ApiError(400, code);
};
export function uuid(value) {
  const compact = typeof value === 'string' ? value.replaceAll('-', '').toLowerCase() : '';
  requireValue(/^[a-f0-9]{32}$/.test(compact), 'invalid_uuid');
  return compact;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Restrict exports to non-interlaced 8-bit RGB/RGBA PNGs. Validate the decoded
// allocation and every chunk before native clients ever decode these assets.
export function validatePng(bytes, maxBytes = 8 * 1024 * 1024) {
  requireValue(Buffer.isBuffer(bytes) && bytes.length <= maxBytes && bytes.length >= 45, 'invalid_png_size');
  requireValue(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'invalid_png');
  let offset = 8, header, ended = false, idatEnded = false;
  const compressed = [];
  while (offset < bytes.length) {
    requireValue(offset + 12 <= bytes.length, 'truncated_png');
    const length = bytes.readUInt32BE(offset);
    requireValue(length <= maxBytes && offset + 12 + length <= bytes.length, 'truncated_png');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    requireValue(crc32(bytes.subarray(offset + 4, offset + 8 + length)) === bytes.readUInt32BE(offset + 8 + length), 'png_checksum');
    requireValue(header || type === 'IHDR', 'png_header_missing');
    if (type === 'IHDR') {
      requireValue(!header && length === 13, 'invalid_png_header');
      const width = data.readUInt32BE(0), height = data.readUInt32BE(4);
      requireValue(width > 0 && height > 0 && width <= 4096 && height <= 4096, 'png_dimensions');
      requireValue(data[8] === 8 && [2,6].includes(data[9]) && data[10] === 0 && data[11] === 0 && data[12] === 0, 'unsupported_png_encoding');
      header = { width, height, channels: data[9] === 6 ? 4 : 3 };
    } else if (type === 'IDAT') {
      requireValue(!idatEnded, 'noncontiguous_png_data');
      compressed.push(data);
    } else if (type === 'IEND') {
      requireValue(length === 0 && compressed.length > 0, 'invalid_png_end');
      ended = true;
    } else {
      requireValue(type[0] === type[0].toLowerCase() || type === 'PLTE', 'unknown_png_chunk');
      if (compressed.length) idatEnded = true;
    }
    offset += length + 12;
    if (ended) break;
  }
  requireValue(ended && offset === bytes.length, 'invalid_png_end');
  const row = header.width * header.channels + 1;
  let decoded;
  try { decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: row * header.height }); }
  catch { throw new ApiError(400, 'invalid_png_data'); }
  requireValue(decoded.length === row * header.height, 'invalid_png_data');
  for (let y = 0; y < header.height; y++) requireValue(decoded[y * row] <= 4, 'invalid_png_filter');
  return { width: header.width, height: header.height, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function decodeAsset(value, maxBytes) {
  requireValue(typeof value === 'string' && value.length <= Math.ceil(maxBytes / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'invalid_base64');
  return Buffer.from(value, 'base64');
}
export function validateCape(input) {
  requireValue(typeof input?.name === 'string' && input.name.trim().length >= 1 && input.name.trim().length <= 64, 'invalid_name');
  const texture = decodeAsset(input.texture, 40 * 1024 * 1024);
  const still = validatePng(texture, 40 * 1024 * 1024);
  requireValue(still.width === still.height * 2 && still.width >= 64 && still.width <= 4096 && still.width % 64 === 0, 'invalid_cape_dimensions');
  let elytra = null, elytraInfo = null;
  if (input.elytra != null) {
    elytra = decodeAsset(input.elytra, 40 * 1024 * 1024);
    elytraInfo = validatePng(elytra, 40 * 1024 * 1024);
    requireValue(elytraInfo.width === elytraInfo.height * 2 && elytraInfo.width >= 64 && elytraInfo.width <= 4096 && elytraInfo.width % 64 === 0, 'invalid_elytra_dimensions');
  }
  let atlas, animation = null;
  if (input.animation != null) {
    const a = input.animation;
    for (const key of ['frameCount','columns','rows','frameWidth','frameHeight']) requireValue(Number.isInteger(a[key]) && a[key] > 0, 'invalid_animation');
    requireValue(a.frameCount <= 120 && a.columns * a.rows >= a.frameCount && a.frameWidth === still.width && a.frameHeight === still.height, 'invalid_animation');
    requireValue(Number.isFinite(a.fps) && a.fps >= 1 && a.fps <= 30 && typeof a.loop === 'boolean', 'invalid_animation');
    requireValue(a.frameWidth * a.frameHeight * a.frameCount * 4 <= 32 * 1024 * 1024, 'animation_memory_limit');
    atlas = decodeAsset(input.atlas, 32 * 1024 * 1024);
    const info = validatePng(atlas, 32 * 1024 * 1024);
    requireValue(info.width === a.columns * a.frameWidth && info.height === a.rows * a.frameHeight, 'atlas_dimensions');
    animation = { frameCount:a.frameCount, columns:a.columns, rows:a.rows, frameWidth:a.frameWidth, frameHeight:a.frameHeight, fps:a.fps, loop:a.loop, sha256:info.sha256 };
  }
  return { name: input.name.trim(), texture, elytra, atlas, animation, width: still.width, height: still.height, sha256: still.sha256,
    elytraWidth: elytraInfo?.width || null, elytraHeight: elytraInfo?.height || null, elytraSha256: elytraInfo?.sha256 || null };
}
