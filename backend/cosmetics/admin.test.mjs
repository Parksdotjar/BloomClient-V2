import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomFillSync} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createCapeAdmin} from './admin.mjs';
import {createCosmeticsApi} from './api.mjs';
import {SqliteCosmeticsStore} from './sqlite-store.mjs';
import {decodeAsset,validateCape} from './assets.mjs';

function png(width=64,height=32,noise=false){
 const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);let crc=0xffffffff;for(const byte of b.subarray(4,-4)){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const raw=Buffer.alloc((width*4+1)*height);if(noise)randomFillSync(raw);for(let y=0;y<height;y++)raw[y*(width*4+1)]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
test('detailed 4K PNG validation remains bounded and accepts real image data',()=>{
 const image=png(4096,2048,true);assert.ok(image.length>32*1024*1024);
 assert.equal(validateCape({name:'Detailed 4K',texture:image.toString('base64')}).width,4096);
 for(const invalid of ['a','a===','a=aa','AAAA====','AA A','AAAA\n'])assert.throws(()=>decodeAsset(invalid,100));
});
test('admin publishes into the existing live catalog and equipped-player flow',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'bloom-admin-capes-'));
 const store=new SqliteCosmeticsStore({directory,publicUrl:'https://fixture.invalid'});
 const owner='a'.repeat(32),player='b'.repeat(32);
 const admin=createCapeAdmin({store,ownerUuid:owner,authorize:async req=>{if(req.headers.authorization!=='Bearer fixture-owner')throw Object.assign(new Error('Unauthorized'),{status:401});}});
 const publicApi=createCosmeticsApi({store,owners:[owner],verify:async()=>player});
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(await admin.handle(req,res,url.pathname))return;if(await publicApi.handle(req,res,url.pathname,url))return;res.writeHead(404).end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.close();store.close();rmSync(directory,{recursive:true,force:true});});
 const call=async(path,method='GET',body,authorized=true)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',...(authorized?{authorization:'Bearer fixture-owner'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const prefix='/v1/owner/content/capes',input={name:'First cape',texture:png().toString('base64'),elytra:png().toString('base64')};
 assert.equal((await call(prefix,'GET',undefined,false)).status,401);
 assert.equal((await call(prefix+'/publish','POST',null)).status,400);
 assert.equal((await call(prefix+'/publish','POST',{...input,texture:'broken'})).status,400);
 const created=await call(prefix+'/publish','POST',input);assert.equal(created.status,201);
 const {id,revision}=created.data;
 assert.equal((await call('/v1/capes')).data.items[0].id,id);
 await call('/v1/capes/equipped','PUT',{capeId:id});
 const equipped=async()=>(await call('/v1/capes/equipped?uuids='+player)).data.items[0];
 const before=await equipped();assert.equal(before.textureRevision,revision);
 assert.deepEqual(await store.leasedAsset(before.textureUrl.split('/').pop()),png());
 const update=await call(prefix+'/publish','POST',{...input,capeId:id,expectedRevision:revision,name:'Updated cape'});assert.equal(update.status,201);
 assert.equal((await equipped()).textureRevision,update.data.revision);
 await assert.rejects(store.leasedAsset(before.textureUrl.split('/').pop()));
 assert.equal((await call(prefix+'/'+id+'/remove','POST',{expectedRevision:revision})).status,409);
 const expectedRevision=update.data.revision;
 assert.equal((await call(prefix+'/'+id+'/remove','POST',{expectedRevision})).status,200);
 assert.equal((await equipped()).capeId,null);assert.equal((await call('/v1/capes')).data.items.length,0);
 assert.equal((await call(prefix)).data.items[0].published,false);
 assert.equal((await call(prefix+'/'+id+'/restore','POST',{expectedRevision})).status,200);
 assert.equal((await equipped()).capeId,id);
 const concurrent=await Promise.all([call(prefix+'/publish','POST',{...input,capeId:id,expectedRevision,name:'A'}),call(prefix+'/publish','POST',{...input,capeId:id,expectedRevision,name:'B'})]);
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);
});
