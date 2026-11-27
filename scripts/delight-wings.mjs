import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';

const thisFile = fileURLToPath(import.meta.url);
const directory = resolve(dirname(thisFile), '../public/delight-wings');
const id = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const texture = /^(?:flat|texture-\d{1,3})\.png$/;
const tints = ['left', 'right', 'trim'];
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1024;
const need = (condition, message) => { if (!condition) throw new Error(message); };

function picture(bytes, maxSide) {
  need(bytes?.length >= 33, 'A wing PNG is missing or empty.');
  const buffer = Buffer.from(bytes);
  need(buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' &&
    buffer.toString('ascii', 12, 16) === 'IHDR', 'Invalid wing PNG.');
  const [width, height] = [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
  need(width > 0 && height > 0 && width <= maxSide && height <= maxSide, 'A wing PNG exceeds its dimensions.');
}

export function readWing(bytes) {
  need(bytes.length <= 4 * 1024 * 1024, 'Wing package exceeds 4 MB.');
  let total = 0;
  const seen = new Set();
  const files = unzipSync(bytes, { filter({ name, originalSize }) {
    need(name === 'wing.json' || name === 'preview.png' || texture.test(name), 'Unsupported wing package path.');
    need(!seen.has(name) && originalSize <= 4 * 1024 * 1024, 'Duplicate or oversized wing package file.');
    seen.add(name);
    total += originalSize;
    need(seen.size <= 70 && total <= 12 * 1024 * 1024, 'Wing package exceeds unpacked limits.');
    return true;
  }});
  need(files['wing.json'], 'Wing data is missing.');
  const wing = JSON.parse(strFromU8(files['wing.json']));
  need(wing.format === 1 && typeof wing.id === 'string' && id.test(wing.id), 'Unsupported wing format or ID.');
  need(typeof wing.name === 'string' && !!wing.name.trim() && wing.name.length <= 120, 'Invalid wing name.');
  need(wing.slot === undefined || wing.slot === 'hat' || wing.slot === 'back', 'Invalid cosmetic slot.');
  const palette = wing.slot === 'back' ? [...tints, 'rightOuter', 'plunger'] : wing.slot === 'hat' ? [...tints, 'rightOuter'] : tints;
  need(Object.keys(wing.defaults ?? {}).length === palette.length && palette.every(tint => /^#[a-fA-F0-9]{6}$/.test(wing.defaults[tint])), 'Invalid wing color controls.');
  need(Number.isInteger(wing.duration) && wing.duration >= 1 && wing.duration <= 10000, 'Invalid flap duration.');
  need(Array.isArray(wing.frames) && wing.frames.length >= 2 && wing.frames.length <= 800, 'Invalid flap frames.');
  const matrixCount = wing.frames[0].matrices?.length;
  need(matrixCount >= 1 && matrixCount <= 34, 'Invalid flap matrix count.');
  let previous = -1;
  for (const { time, matrices } of wing.frames) {
    need(Number.isInteger(time) && time > previous && matrices.length === matrixCount &&
      matrices.every(matrix => Array.isArray(matrix) && matrix.length === 16 && matrix.every(finite)), 'Invalid flap matrix.');
    previous = time;
  }
  need(previous === wing.duration && wing.frames[0].time === 0, 'The flap must cover the clip.');
  need(Array.isArray(wing.batches) && wing.batches.length >= 2 && wing.batches.length <= 300, 'Invalid wing batches.');
  let vertices = 0;
  for (const batch of wing.batches) {
    need(Number.isInteger(batch.matrix) && batch.matrix >= 0 && batch.matrix < matrixCount &&
      (palette.includes(batch.tint) || batch.tint === 'fixed' && /^#[a-fA-F0-9]{6}$/.test(batch.color)), 'Invalid wing batch binding.');
    if (wing.slot === 'back') {
      need(/^#[a-fA-F0-9]{6}$/.test(batch.color), 'Invalid source shade.');
      need(batch.shineRow === undefined || (Number.isInteger(batch.shineRow) && batch.shineRow >= 0 && batch.shineRow < 21 && batch.tint === 'rightOuter'), 'Invalid liquid shine row.');
    }
    need(texture.test(batch.texture) && files[batch.texture], 'Wing batch references a missing texture.');
    need(Array.isArray(batch.vertices) && batch.vertices.length > 0 && batch.vertices.length % 32 === 0 &&
      batch.vertices.every(finite), 'Invalid wing geometry.');
    vertices += batch.vertices.length / 8;
  }
  need(vertices <= 9216 && (wing.slot ? palette : ['left', 'right']).every(side => wing.batches.some(batch => batch.tint === side)), 'Invalid wing sides or vertex count.');
  for (const file of Object.keys(files).filter(name => texture.test(name))) picture(files[file], 1024);
  picture(files['preview.png'], 1200);
  need(files['preview.png'].length <= 1024 * 1024, 'Shop thumbnail exceeds 1 MB.');
  return {
    id: wing.id, name: wing.name, defaults: wing.defaults, slot: wing.slot,
    revision: createHash('sha256').update(bytes).digest('hex'),
    preview: files['preview.png'],
  };
}

function catalog(root) {
  const entries = [];
  for (const name of readdirSync(root).sort()) {
    if (!name.endsWith('.zip')) continue;
    need(revisionPattern.test(basename(name, '.zip')), 'A wing package must be named by its revision.');
    const { id, name: title, defaults, revision, slot } = readWing(readFileSync(join(root, name)));
    need(name === revision + '.zip', 'A wing package changed after staging.');
    const preview = readFileSync(join(root, revision + '.png'));
    picture(preview, 1200);
    need(preview.length <= 1024 * 1024, 'Shop thumbnail exceeds 1 MB.');
    entries.push({ id, name: title, defaults, revision, ...(slot ? { slot } : {}), previewRevision: createHash('sha256').update(preview).digest('hex') });
  }
  need(entries.length <= 80, 'A build may contain up to 80 wing revisions.');
  return entries;
}

function indexText(entries) { return JSON.stringify({ format: 1, entries }, null, 2) + '\n'; }

function writeIndex(root) {
  const filePath = join(root, 'catalog.json');
  const temporary = filePath + '.tmp';
  writeFileSync(temporary, indexText(catalog(root)));
  renameSync(temporary, filePath);
}

export function stage(file, root = directory) {
  const bytes = readFileSync(file);
  const { revision, preview } = readWing(bytes);
  mkdirSync(root, { recursive: true });
  const thumbnail = join(root, revision + '.png');
  if (!existsSync(thumbnail)) writeFileSync(thumbnail, preview);
  writeFileSync(join(root, revision + '.zip'), bytes);
  writeIndex(root);
  return revision;
}

export function setThumbnail(key, file, root = directory) {
  need(revisionPattern.test(key) && existsSync(join(root, key + '.zip')), 'Stage the wing package first.');
  const preview = readFileSync(file);
  picture(preview, 1200);
  need(preview.length <= 1024 * 1024, 'Shop thumbnail exceeds 1 MB.');
  writeFileSync(join(root, key + '.png'), preview);
  writeIndex(root);
}

export function check(root = directory) {
  const entries = catalog(root);
  need(readFileSync(join(root, 'catalog.json'), 'utf8').replaceAll('\r\n', '\n') === indexText(entries), 'Wing catalog is stale. Stage the package again.');
  return entries.length;
}

if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  try {
    if (process.argv[2] === 'stage' && process.argv[3]) console.log('Staged', stage(process.argv[3]));
    else if (process.argv[2] === 'thumbnail' && process.argv[3] && process.argv[4]) setThumbnail(process.argv[3], process.argv[4]);
    else if (process.argv[2] === 'check') console.log(check(), 'wing revisions ready');
    else throw new Error('Use delight-wings.mjs stage <wing.zip>, thumbnail <revision> <png>, or check.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
