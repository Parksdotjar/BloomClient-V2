import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, renameSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const contentRoot = join(root, 'bloom-cosmetics-mod/emotes');
export const bones = ['body', 'torso', 'head', 'right_arm', 'left_arm', 'right_leg', 'left_leg'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const MAX_ANIMATION_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
function check(condition, message) { if (!condition) throw new Error(message); }
function readAnimation(file) {
  // Bound parsing separately from the compact payload shipped to Minecraft.
  // Older Creator/Blockbench exports can exceed 256 KiB from indentation alone.
  check(statSync(file).size <= MAX_SOURCE_BYTES, 'Animation source exceeds 2 MiB');
  return JSON.parse(readFileSync(file,'utf8'));
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function validate(meta, data) {
  check(object(meta) && meta.schemaVersion === 1 && meta.rigVersion === 1, 'Unsupported metadata or rig version');
  check(/^bloom:[a-z][a-z0-9_]{0,47}$/.test(meta.id), 'ID must be bloom:lower_case_name');
  check(typeof meta.name === 'string' && meta.name.trim().length > 0 && meta.name.length <= 40, 'Name must contain 1–40 characters');
  check(typeof meta.author === 'string' && meta.author.length <= 80, 'Author must be at most 80 characters');
  check(Number.isSafeInteger(meta.order) && meta.order >= 0, 'Order must be a nonnegative integer');
  check(/^[a-z][a-z0-9_]{0,47}$/.test(meta.animation), 'Invalid animation name');
  check(['once','loop','hold'].includes(meta.playback), 'Playback must be once, loop, or hold');
  check(meta.traversal === undefined || typeof meta.traversal === 'boolean', 'Traversal must be a boolean');
  check(!meta.traversal || meta.playback === 'loop', 'Traversal emotes must loop');
  check(object(data) && data.format_version === '1.8.0', 'Export format_version must be 1.8.0');
  check(Object.keys(data).every(k => ['format_version','geckolib_format_version','animations'].includes(k)), 'Unsupported export fields');
  check(data.geckolib_format_version === undefined || data.geckolib_format_version === 2, 'Unsupported GeckoLib format');
  check(object(data.animations) && Object.keys(data.animations).length === 1, 'Export exactly one animation per emote');
  const clip = data.animations[meta.animation];
  check(object(clip), `Export does not contain animation ${meta.animation}`);
  check(Object.keys(clip).every(k => ['animation_length','loop','bones'].includes(k)), 'Unsupported animation fields (expressions and effects are not supported)');
  check(Number.isFinite(clip.animation_length) && clip.animation_length >= 0.1 && clip.animation_length <= 30, 'Animation length must be 0.1–30 seconds');
  const expectedLoop = {once:false,loop:true,hold:'hold_on_last_frame'}[meta.playback];
  check((clip.loop ?? false) === expectedLoop, 'Export loop mode does not match metadata');
  check(object(clip.bones) && Object.keys(clip.bones).length > 0, 'Animation has no bones');
  let count = 0;
  for (const [bone, tracks] of Object.entries(clip.bones)) {
    check(bones.includes(bone), `Unsupported bone: ${bone}`);
    check(object(tracks) && Object.keys(tracks).length > 0, `${bone}: no tracks`);
    for (const [channel, track] of Object.entries(tracks)) {
      check(['rotation','position'].includes(channel), `${bone}: unsupported channel ${channel}`);
      const vector = value => {
        if (object(value)) {
          check(Object.keys(value).every(k => ['vector','easing'].includes(k)), `${bone}/${channel}: unsupported keyframe fields`);
          check(value.easing === undefined || ['linear','easeInSine','easeOutSine','easeInOutSine','easeinsine','easeoutsine','easeinoutsine'].includes(value.easing), `${bone}/${channel}: use Linear or Sine easing`);
          value = value.vector;
        }
        check(Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && Math.abs(n) <= (channel === 'position' ? 12 : bone === 'body' ? 720 : 180)), `${bone}/${channel}: expected three bounded numeric values`);
      };
      if (Array.isArray(track) || object(track) && Object.hasOwn(track,'vector')) { vector(track); count++; continue; }
      check(object(track) && Object.keys(track).length > 0, `${bone}/${channel}: empty track`);
      const times = new Set();
      for (const [time, value] of Object.entries(track)) {
        const t = Number(time);
        check(/^\d+(\.\d+)?$/.test(time) && Number.isFinite(t) && t >= 0 && t <= clip.animation_length && !times.has(t), `${bone}/${channel}: invalid or duplicate time ${time}`);
        times.add(t); vector(value); count++;
      }
    }
  }
  check(count <= 4096, 'Animation exceeds 4096 keyframes');
  check(Buffer.byteLength(JSON.stringify(data)) <= MAX_ANIMATION_BYTES, 'Animation exceeds 256 KiB');
  // Preserve existing revisions; traversal changes observer playback semantics.
  const traversal = meta.traversal ? {traversal:true} : {};
  const revision = createHash('sha256').update(canonical({rigVersion:meta.rigVersion, animation:meta.animation, playback:meta.playback, ...traversal, data})).digest('hex');
  return {id:meta.id,name:meta.name,author:meta.author,order:meta.order,animation:meta.animation,playback:meta.playback,...traversal,duration:clip.animation_length,revision};
}
export function readCatalog(directory = contentRoot) {
  const entries = readdirSync(directory, {withFileTypes:true}).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => {
    const dir = join(directory,e.name);
    const file = join(dir,'animation.json');
    try {
      const data = readAnimation(file);
      const meta = JSON.parse(readFileSync(join(dir,'emote.json'),'utf8'));
      return {entry:validate(meta,data),data};
    } catch (error) { throw new Error(`${e.name}: ${error.message}`); }
  }).sort((a,b) => a.entry.order-b.entry.order);
  for (const key of ['id','order','animation']) check(new Set(entries.map(e => e.entry[key])).size === entries.length, `Duplicate catalog ${key}`);
  check(entries.length <= 256, 'Catalog must contain at most 256 emotes');
  return entries;
}
export function build(directory = contentRoot, output = join(root,'bloom-cosmetics-mod/build/generated/emotes')) {
  const entries = readCatalog(directory);
  // This is one fixed generated directory, never an authoring source directory.
  const sourceRelative = relative(resolve(output),resolve(directory));
  const outputRelative = relative(resolve(directory),resolve(output));
  const outside = path => path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
  check(outside(sourceRelative) && outside(outputRelative), 'Build output and authoring sources must be separate directories');
  mkdirSync(output,{recursive:true});
  const assetDir = join(output,'assets/bloom_cosmetics/emotes');
  mkdirSync(assetDir,{recursive:true});
  // Runtime reads classpath assets directly, so resource packs cannot substitute clips.
  for (const {entry,data} of entries) writeFileSync(join(assetDir,`${entry.revision}.json`),JSON.stringify(data));
  const keep = new Set(entries.map(e => `${e.entry.revision}.json`).concat('catalog.json'));
  for (const file of readdirSync(assetDir)) if (!keep.has(file) && /^[a-f0-9]{64}\.json$/.test(file)) rmSync(join(assetDir,file));
  writeFileSync(join(assetDir,'catalog.json'),JSON.stringify({schemaVersion:1,entries:entries.map(e=>e.entry)}));
  return entries.length;
}

export function importEmote(file, id, name = id.replaceAll('_',' '), directory = contentRoot) {
  check(/^[a-z][a-z0-9_]{0,47}$/.test(id), 'Use a lower_case emote ID');
  const destination = join(directory,id);
  check(!existsSync(destination),'That emote already exists; edit its source/export in place');
  const data = readAnimation(file);
  const animation = Object.keys(data.animations ?? {})[0];
  const loop = data.animations?.[animation]?.loop;
  const entries = readCatalog(directory);
  const meta = {schemaVersion:1,id:`bloom:${id}`,name,author:'Parks',rigVersion:1,animation,playback:loop === true ? 'loop' : loop === 'hold_on_last_frame' ? 'hold' : 'once',order:Math.max(0,...entries.map(e=>e.entry.order))+10};
  validate(meta,data);
  check(!entries.some(e=>e.entry.animation === animation),'Animation name already exists; rename it inside Blockbench before exporting');
  const staging = join(directory,`.import-${randomUUID()}`);
  mkdirSync(staging);
  try {
    const pretty = JSON.stringify(data,null,2)+'\n';
    writeFileSync(join(staging,'animation.json'),Buffer.byteLength(pretty) <= MAX_ANIMATION_BYTES ? pretty : JSON.stringify(data));
    writeFileSync(join(staging,'emote.json'),JSON.stringify(meta,null,2)+'\n');
    renameSync(staging,destination);
  } catch(error) { for (const f of ['animation.json','emote.json']) if (existsSync(join(staging,f))) rmSync(join(staging,f)); rmdirSync(staging); throw error; }
  return destination;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action,...args] = process.argv.slice(2);
    if (action === 'validate') console.log(`Validated ${readCatalog().length} Bloom emotes.`);
    else if (action === 'build') console.log(`Bundled ${build()} Bloom emotes.`);
    else if (action === 'import' && args.length >= 2) console.log(`Imported ${importEmote(...args)}`);
    else throw new Error('Usage: node scripts/emotes.mjs validate | build | import <animation.json> <id> [name]');
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
