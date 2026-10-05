import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { deflateSync } from 'node:zlib';
import { createCosmeticsApi, cosmeticsFromEnvironment } from './api.mjs';
import { validatePng, validateCape } from './assets.mjs';
import { SqliteCosmeticsStore } from './sqlite-store.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';

const owner = 'a'.repeat(32), other = 'b'.repeat(32);
function png(width=64,height=32) {
  const chunk = (type,data) => {
    const out=Buffer.alloc(data.length+12); out.writeUInt32BE(data.length); out.write(type,4); data.copy(out,8);
    let crc=0xffffffff; for(const byte of out.subarray(4,-4)){ crc^=byte; for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1; }
    out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4); return out;
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]);
}
class MemoryStore {
  capes=new Map(); revisions=new Map(); people=new Map(); sessions=new Map(); objects=new Map();
  async catalog(){return [...this.capes.values()].filter(c=>c.published);}
  async cape(id){return this.capes.get(id);}
  async revision(id){return this.revisions.get(id);}
  async createRevision(r){this.revisions.set(r.id,r);}
  async publish(id,r){this.capes.set(id,{id,current_revision:r,name:this.revisions.get(r).name,published:true});}
  async unpublish(id){if(this.capes.has(id))this.capes.get(id).published=false;}
  async equip(id,cape){this.people.set(id,{uuid:id,badge_visible:true,...this.people.get(id),cape_id:cape});}
  async badge(id,visible){this.people.set(id,{uuid:id,...this.people.get(id),badge_visible:visible});}
  async players(ids){return ids.map(id=>this.people.get(id)).filter(Boolean);}
  async upload(path,bytes){this.objects.set(path,bytes);}
  async lease(path){return `https://assets.example/${path}?temporary=1`;}
  async createSession(s){this.sessions.set(s.token_hash,s);}
  async session(hash){return this.sessions.get(hash);}
  async heartbeat(hash,time){this.sessions.get(hash).last_seen=time;}
  async revoke(hash){this.sessions.delete(hash);}
  async presence(ids,since,now){return [...this.sessions.values()].filter(s=>ids.includes(s.uuid)&&s.last_seen>since&&s.expires_at>now);}
}
test('PNG validation checks real decoded bytes, checksums, geometry and budgets',()=>{
  assert.equal(validatePng(png()).width,64);
  assert.equal(validateCape({name:'4K cape',texture:png(4096,2048).toString('base64')}).width,4096);
  const corrupt=png();corrupt[40]^=1;assert.throws(()=>validatePng(corrupt));
  assert.throws(()=>validatePng(Buffer.concat([png(),Buffer.from('extra')])));
  assert.throws(()=>validateCape({name:'wrong',texture:png(65,32).toString('base64')}));
  assert.throws(()=>validateCape({name:'bad atlas',texture:png().toString('base64'),atlas:png().toString('base64'),animation:{frameCount:121,columns:1,rows:121,frameWidth:64,frameHeight:32,fps:15,loop:true}}));
});
test('configuration defaults closed',()=>{
  assert.equal(cosmeticsFromEnvironment({}).enabled,false);
  assert.throws(()=>cosmeticsFromEnvironment({BLOOM_COSMETICS_ENABLED:'true'}));
});
for (const storage of ['memory','sqlite']) test(`${storage}: publish, free equip, revision replacement, presence, opt-out and unpublish`,async t=>{
  let time=Date.now();
  const directory = storage === 'sqlite' ? mkdtempSync(join(tmpdir(),'bloom-cape-test-')) : null;
  const store = directory ? new SqliteCosmeticsStore({directory,publicUrl:'https://assets.example',now:()=>time}) : new MemoryStore();
  if (directory) t.after(()=>{store.close();rmSync(directory,{recursive:true});});
  const studioPassword='correct horse bloom studio';
  const studioSalt='0123456789abcdef0123456789abcdef';
  const studioPasswordHash=`${studioSalt}:${scryptSync(studioPassword,studioSalt,32).toString('hex')}`;
  const api=createCosmeticsApi({store,owners:[owner],verify:async token=>token==='owner'?owner:other,now:()=>time,studioPasswordHash});
  const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(!await api.handle(req,res,url.pathname,url)){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const request=async(path,method='GET',body,token)=>{
    const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,body:await r.json()};
  };
  const input={name:'First cape',texture:png().toString('base64'),elytra:png().toString('base64')};
  assert.equal((await request('/v1/admin/studio/session','POST',{password:'not the password'})).status,401);
  const studio=(await request('/v1/admin/studio/session','POST',{password:studioPassword}));assert.equal(studio.status,201);
  assert.equal((await request('/v1/admin/studio/session','GET',undefined,studio.body.token)).body.ownerUuid,owner);
  assert.equal((await request('/v1/admin/capes/drafts','POST',input)).status,401);
  assert.equal((await request('/v1/admin/capes/drafts','POST',input,'other')).status,403);
  const draft=await request('/v1/admin/capes/drafts','POST',input,'owner');assert.equal(draft.status,201);
  assert.equal((await request('/v1/admin/capes/drafts','POST',input,studio.body.token)).status,201);
  assert.equal((await request('/v1/capes')).body.items.length,0);
  const {capeId,revision}=draft.body;
  assert.equal((await request(`/v1/admin/capes/${capeId}/publish`,'POST',{revision},'owner')).status,200);
  const catalog=(await request('/v1/capes')).body.items;
  assert.equal(catalog.length,1);
  assert.match(catalog[0].elytraUrl,/^https:\/\//);
  assert.match(catalog[0].elytraSha256,/^[a-f0-9]{64}$/);
  let originalLease;
  if (directory) {
    originalLease = (await request('/v1/capes')).body.items[0].textureUrl.split('/').pop();
    assert.deepEqual(await store.leasedAsset(originalLease), png());
    const elytraLease = catalog[0].elytraUrl.split('/').pop();
    assert.deepEqual(await store.leasedAsset(elytraLease), png());
  }
  assert.equal((await request('/v1/capes/equipped','PUT',{capeId,uuid:owner},'other')).body.uuid,other);
  const assigned=()=>request(`/v1/capes/equipped?uuids=${other}`);
  assert.equal((await assigned()).body.items[0].capeId,capeId);
  assert.equal((await assigned()).body.items[0].badgeVisible,false);
  const session=(await request('/v1/cosmetics/sessions','POST',{},'other')).body;
  assert.equal((await request('/v1/cosmetics/sessions/current','PUT',{},session.token)).status,200);
  assert.equal((await assigned()).body.items[0].badgeVisible,true);
  await request('/v1/cosmetics/badge','PUT',{visible:false},'other');assert.equal((await assigned()).body.items[0].badgeVisible,false);
  await request('/v1/cosmetics/badge','PUT',{visible:true},'other');time+=181000;
  assert.equal((await assigned()).body.items[0].badgeVisible,false);
  const update=(await request('/v1/admin/capes/drafts','POST',{...input,capeId,name:'Updated'},'owner')).body;
  await request(`/v1/admin/capes/${capeId}/publish`,'POST',{revision:update.revision},'owner');
  assert.equal((await assigned()).body.items[0].textureRevision,update.revision);
  assert.ok(await store.revision(revision));
  assert.ok(await store.revision(update.revision));
  if (directory) await assert.rejects(store.leasedAsset(originalLease), /asset_unavailable/);
  await request(`/v1/admin/capes/${capeId}`,'DELETE',undefined,'owner');
  assert.equal((await assigned()).body.items[0].capeId,null);
  assert.equal((await request('/v1/capes/equipped','PUT',{capeId},'other')).status,404);
  assert.equal((await request('/v1/capes/equipped','PUT',{capeId:null},'other')).status,200);
  assert.equal((await request('/v1/capes/equipped?uuids=bad')).status,400);
  time+=13*60*60*1000;
  assert.equal((await request('/v1/cosmetics/sessions/current','PUT',{},session.token)).status,401);
});
