import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, cpSync, mkdtempSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalog, validate, canonical, build, contentRoot, importEmote, bones } from '../scripts/emotes.mjs';
const fixtureRoot = new URL('./fixtures/emotes/',import.meta.url);
const waveFixture = new URL('./fixtures/emotes/wave/',import.meta.url);
const sample = () => ({meta:JSON.parse(readFileSync(new URL('emote.json',waveFixture))),data:JSON.parse(readFileSync(new URL('animation.json',waveFixture)))});
test('full Body turns are bounded without expanding limb or position limits',()=>{
 const {meta,data}=sample();data.animations.wave.bones.body={rotation:{'0':[0,0,0],'1':[360,-720,720]}};
 assert.doesNotThrow(()=>validate(meta,data));data.animations.wave.bones.body.rotation['1'][0]=721;
 assert.throws(()=>validate(meta,data),/bounded/);data.animations.wave.bones.body.rotation['1'][0]=360;
 data.animations.wave.bones.head={rotation:[181,0,0]};assert.throws(()=>validate(meta,data),/bounded/);delete data.animations.wave.bones.head;
 data.animations.wave.bones.body.position=[0,13,0];assert.throws(()=>validate(meta,data),/bounded/);
});
function denseSample() {
 const result=sample(),clip=result.data.animations.wave;clip.animation_length=3;
 clip.bones=Object.fromEntries(bones.map(b=>[b,Object.fromEntries(['rotation','position'].map(c=>[c,Object.fromEntries(Array.from({length:280},(_,i)=>[String(i/100),[.125,-.25,.375]]))]))]));
 return result;
}
test('catalogs use unique immutable revisions and stable order without requiring demos',()=>{
 const entries=readCatalog();assert.ok(entries.length<=256);
 assert.equal(new Set(entries.map(e=>e.entry.revision)).size,entries.length);
 const fixture=readCatalog(fileURLToPath(fixtureRoot));assert.equal(fixture.length,1);assert.equal(fixture[0].entry.id,'bloom:wave');
});

test('revision depends on motion and playback, not label or JSON ordering',()=>{
 const {meta,data}=sample();const a=validate(meta,data).revision;
 assert.equal(validate({...meta,name:'Hello'},data).revision,a);
 assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));
 data.animations.wave.bones.right_arm.rotation['0'][0]=1;
 assert.notEqual(validate(meta,data).revision,a);
});

test('traversal requires a loop and changes the revision without invalidating legacy emotes',()=>{
 const {meta,data}=sample();const legacy=validate(meta,data);
 assert.deepEqual(validate({...meta,traversal:false},data),legacy);
 assert.throws(()=>validate({...meta,traversal:true},data),/must loop/);
 assert.throws(()=>validate({...meta,traversal:'true'},data),/boolean/);
 meta.playback='loop';data.animations.wave.loop=true;
 const ordinary=validate(meta,data),traversal=validate({...meta,traversal:true},data);
 assert.equal(traversal.traversal,true);assert.notEqual(ordinary.revision,traversal.revision);
 assert.equal(traversal.playback,'loop');
});
test('reject expressions, effects, geometry, unknown bones, oversized motion, and ambiguous times',()=>{
 const cases=[
  d=>d.animations.wave.bones.right_arm.rotation['0'][0]='query.life_time',
  d=>d.animations.wave.sound_effects={},
  d=>d.animations.wave.bones.finger={rotation:[0,0,0]},
  d=>d.animations.wave.bones.right_arm.scale=[1,1,1],
  d=>d.animations.wave.bones.right_arm.position=[1000,0,0],
  d=>d.animations.wave.bones.right_arm.rotation['0.0']=[0,0,0],
  d=>d.animations.wave.bones.right_arm.rotation['100']=[0,0,0],
  d=>d.animations.wave.loop=true
 ];
 for(const mutate of cases){const {meta,data}=sample();mutate(data);assert.throws(()=>validate(meta,data));}
});
test('generated bundle contains only runtime catalog and clips; rebuild is deterministic',()=>{
 const output=mkdtempSync(join(tmpdir(),'bloom-emotes-test-'));
 const count=readCatalog().length;assert.equal(build(contentRoot,output),count);
 const dir=join(output,'assets/bloom_cosmetics/emotes');const before=readFileSync(join(dir,'catalog.json'),'utf8');
 assert.equal(readdirSync(dir).length,count+1);assert.equal(build(contentRoot,output),count);
 assert.equal(readFileSync(join(dir,'catalog.json'),'utf8'),before);
 assert.throws(()=>build(contentRoot,contentRoot),/separate directories/);
 assert.throws(()=>build(contentRoot,join(contentRoot,'generated')),/separate directories/);
});

test('imports a real GeckoLib-style vector export and rejects duplicate imports without changing content',()=>{
 const directory=mkdtempSync(join(tmpdir(),'bloom-emote-import-'));
 cpSync(waveFixture,join(directory,'wave'),{recursive:true});
 const {data}=sample();data.animations.salute=data.animations.wave;delete data.animations.wave;
 for(const [t,vector] of Object.entries(data.animations.salute.bones.right_arm.rotation))data.animations.salute.bones.right_arm.rotation[t]={vector,easing:'easeInOutSine'};
 const file=join(directory,'export.json');writeFileSync(file,JSON.stringify(data));
 const imported=importEmote(file,'salute','Salute',directory);
 assert.equal(JSON.parse(readFileSync(join(imported,'emote.json'))).order,20);
 assert.equal(readCatalog(directory).length,2);
 assert.throws(()=>importEmote(file,'salute','Again',directory),/already exists/);
 assert.equal(JSON.parse(readFileSync(join(imported,'emote.json'))).name,'Salute');
});

test('editable Blockbench files match the runtime clips and canonical hierarchy',()=>{
 for(const dir of readdirSync(contentRoot)){
  if(dir.startsWith('.')||!existsSync(join(contentRoot,dir,'source.bbmodel')))continue;
  const model=JSON.parse(readFileSync(join(contentRoot,dir,'source.bbmodel')));
  const exported=JSON.parse(readFileSync(join(contentRoot,dir,'animation.json')));
  const animation=model.animations[0],clip=exported.animations[animation.name];
  assert.equal(animation.length,clip.animation_length);
  assert.equal(model.groups.length,7);assert.equal(model.outliner[0].children.length,6);
  for(const animator of Object.values(animation.animators))for(const frame of animator.keyframes){
   const point=frame.data_points[0];const v=[Number(point.x),Number(point.y),Number(point.z)];
   v[0]=-v[0];if(frame.channel==='rotation')v[1]=-v[1];
   const track=clip.bones[animator.name][frame.channel];
   const value=Array.isArray(track)||track.vector?track:Object.entries(track).find(([time])=>Number(time)===frame.time)?.[1];
   assert.deepEqual(v.map(n=>n||0),value?.vector??value);
  }
 }
});


test('an empty library builds cleanly, drops stale clips and accepts the first Wave',t=>{
 const temp=mkdtempSync(join(tmpdir(),'bloom-empty-emotes-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const directory=join(temp,'emotes'),output=join(temp,'generated');mkdirSync(directory);cpSync(waveFixture,join(directory,'wave'),{recursive:true});
 assert.equal(build(directory,output),1);rmSync(join(directory,'wave'),{recursive:true});assert.equal(build(directory,output),0);
 const assets=join(output,'assets/bloom_cosmetics/emotes');assert.deepEqual(readdirSync(assets),['catalog.json']);assert.deepEqual(JSON.parse(readFileSync(join(assets,'catalog.json'))).entries,[]);
 const exported=join(temp,'wave.json');writeFileSync(exported,JSON.stringify(sample().data));const added=importEmote(exported,'wave','Wave',directory);
 assert.equal(JSON.parse(readFileSync(join(added,'emote.json'))).order,10);assert.equal(readCatalog(directory).length,1);assert.equal(build(directory,output),1);
});

test('formatted source size does not change runtime payload, revision, or authored files',t=>{
 const temp=mkdtempSync(join(tmpdir(),'bloom-formatted-emote-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const directory=join(temp,'emotes'),dir=join(directory,'wave');mkdirSync(dir,{recursive:true});
 const {meta,data}=denseSample(),pretty=JSON.stringify(data,null,2)+'\n',compact=JSON.stringify(data);
 assert.ok(Buffer.byteLength(pretty)>256*1024);assert.ok(Buffer.byteLength(compact)<256*1024);
 writeFileSync(join(dir,'emote.json'),JSON.stringify(meta));writeFileSync(join(dir,'animation.json'),pretty);
 const entry=readCatalog(directory)[0].entry;assert.equal(entry.revision,validate(meta,data).revision);
 const output=join(temp,'generated');assert.equal(build(directory,output),1);
 const bundled=readFileSync(join(output,'assets/bloom_cosmetics/emotes',entry.revision+'.json'),'utf8');
 assert.equal(bundled,compact);assert.equal(readFileSync(join(dir,'animation.json'),'utf8'),pretty);
});

test('dense imports accept readable exports and always save a bounded runtime file',t=>{
 const temp=mkdtempSync(join(tmpdir(),'bloom-dense-import-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const {data}=denseSample(),source=join(temp,'source.json');
 for(const formatted of [false,true]) {
  const directory=join(temp,formatted?'formatted':'compact');mkdirSync(directory);
  writeFileSync(source,JSON.stringify(data,null,formatted?2:undefined));
  const imported=importEmote(source,'wave','Wave',directory),saved=readFileSync(join(imported,'animation.json'));
  assert.ok(saved.length<=256*1024);assert.deepEqual(JSON.parse(saved),data);assert.equal(readCatalog(directory).length,1);
 }
});

test('formatting allowance keeps source, payload and key-count limits enforced',t=>{
 const temp=mkdtempSync(join(tmpdir(),'bloom-emote-limits-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const directory=join(temp,'emotes'),dir=join(directory,'wave');mkdirSync(dir,{recursive:true});
 const {meta,data}=denseSample(),file=join(dir,'animation.json');writeFileSync(join(dir,'emote.json'),JSON.stringify(meta));
 const unreadable=JSON.stringify(data)+' '.repeat(2*1024*1024);writeFileSync(file,unreadable);
 assert.throws(()=>readCatalog(directory),/wave: Animation source exceeds 2 MiB/);
 const empty=join(temp,'empty');mkdirSync(empty);assert.throws(()=>importEmote(file,'other','Other',empty),/source exceeds 2 MiB/);assert.deepEqual(readdirSync(empty),[]);
 for(const b of Object.values(data.animations.wave.bones))for(const track of Object.values(b))for(const time of Object.keys(track))track[time]={vector:[.12345678901234567,-.23456789012345678,.34567890123456789],easing:'easeInOutSine'};
 assert.ok(Buffer.byteLength(JSON.stringify(data))>256*1024);writeFileSync(file,JSON.stringify(data));
 assert.throws(()=>readCatalog(directory),/Animation exceeds 256 KiB/);
 assert.throws(()=>importEmote(file,'other','Other',empty),/Animation exceeds 256 KiB/);assert.deepEqual(readdirSync(empty),[]);
 const excessive=denseSample().data;excessive.animations.wave.bones.body.rotation=Object.fromEntries(Array.from({length:500},(_,i)=>[String(i/200),[0,0,0]]));
 writeFileSync(file,JSON.stringify(excessive));assert.throws(()=>readCatalog(directory),/exceeds 4096 keyframes/);
});
