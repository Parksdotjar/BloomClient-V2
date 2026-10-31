import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';
import {createCosmeticsApi} from './api.mjs';
import {createCapeAdmin} from './admin.mjs';
import {SqliteCosmeticsStore} from './sqlite-store.mjs';
import {ApiError} from './assets.mjs';

function png(){
 const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);let crc=0xffffffff;for(const byte of b.subarray(4,-4)){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;};
 const header=Buffer.alloc(13);header.writeUInt32BE(64);header.writeUInt32BE(32,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(257*32))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
test('free Shop claims, featured selection, drop closure, legacy equipment and account ownership',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'bloom-shop-')),owner='a'.repeat(32),one='b'.repeat(32),two='c'.repeat(32);
 const store=new SqliteCosmeticsStore({directory,publicUrl:'https://fixture.invalid'});
 const admin=createCapeAdmin({store,ownerUuid:owner,authorize:async req=>{if(req.headers.authorization!=='Bearer owner')throw new ApiError(401,'owner_required');}});
 const api=createCosmeticsApi({store,verify:async token=>{if(![one,two].includes(token))throw new ApiError(401,'sign_in_required');return token;}});
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(await admin.handle(req,res,url.pathname))return;if(await api.handle(req,res,url.pathname,url))return;res.writeHead(404).end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.close();store.close();rmSync(directory,{recursive:true,force:true});});
 const call=async(path,method='GET',body,token)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const prefix='/v1/owner/content/capes',input={name:'Sakura',texture:png(),shopListed:true,featured:true};
 const publish=async body=>{const result=await call(prefix+'/publish','POST',body,'owner');assert.equal(result.status,201);return result.data;};
 const shop=async token=>(await call('/v1/capes/shop','GET',undefined,token)).data;
 const locker=async token=>(await call('/v1/capes/locker','GET',undefined,token)).data.items;
 const claim=(capeId,token)=>call('/v1/capes/claim','POST',{capeId,uuid:two},token);
 let first=await publish(input);const second=await publish({...input,name:'Cloud',featured:false});
 assert.equal((await shop()).featuredId,first.id);assert.equal((await shop()).items.length,2);
 assert.equal((await locker(one)).length,0);assert.equal((await claim(first.id)).status,401);
 assert.equal((await claim('invalid',one)).status,400);
 const claims=await Promise.all([claim(first.id,one),claim(first.id,one)]);
 assert.deepEqual(claims.map(c=>c.status),[200,200]);assert.equal(claims.filter(c=>c.data.alreadyClaimed).length,1);
 assert.equal((await locker(one))[0].id,first.id);assert.equal((await locker(two)).length,0,'Request UUID cannot redirect a claim');
 assert.equal((await shop(one)).items.find(c=>c.id===first.id).owned,true);assert.equal((await shop(two)).items.some(c=>c.owned),false);
 assert.equal((await call('/v1/capes/equipped','PUT',{capeId:first.id},one)).status,200);
 first=await publish({...input,capeId:first.id,expectedRevision:first.revision,shopListed:false,featured:false});
 assert.equal((await shop()).items.some(c=>c.id===first.id),false);assert.equal((await shop()).featuredId,null);
 assert.equal((await locker(one))[0].id,first.id);assert.equal((await claim(first.id,one)).status,200,'An interrupted claim can safely retry after the drop ends');
 assert.equal((await claim(first.id,two)).status,404);assert.equal((await call('/v1/capes/equipped','PUT',{capeId:first.id},two)).status,404);
 assert.equal((await call('/v1/capes/'+first.id+'/texture')).status,401);
 assert.equal((await call('/v1/capes/equipped?uuids='+one)).data.items[0].capeId,first.id);
 assert.equal((await call('/v1/capes/equipped','PUT',{capeId:second.id},one)).status,200);
 assert.equal((await locker(one)).length,2,'Direct equip by a released launcher also saves ownership');
 const privateCape=await publish({...input,name:'Secret',requiresCode:true,featured:false});
 assert.equal((await shop()).items.some(c=>c.id===privateCape.id),false);assert.equal((await claim(privateCape.id,two)).status,404);
 const code=(await call(prefix+'/'+privateCape.id+'/codes','POST',{expectedRevision:privateCape.revision},'owner')).data.code;
 assert.equal((await call('/v1/capes/redeem','POST',{code},two)).status,200);assert.equal((await locker(two))[0].id,privateCape.id);
 assert.equal((await call(prefix+'/publish','POST',{...input,requiresCode:true},'owner')).status,400);
 assert.equal((await call(prefix+'/publish','POST',{...input,capeId:first.id,expectedRevision:'stale'},'owner')).status,409);
 assert.equal((await call(prefix+'/'+first.id+'/remove','POST',{expectedRevision:first.revision},'owner')).status,200);
 assert.equal((await locker(one)).length,1);assert.equal((await call('/v1/capes/equipped','PUT',{capeId:first.id},one)).status,404);
 assert.equal((await call(prefix+'/'+first.id+'/restore','POST',{expectedRevision:first.revision},'owner')).status,200);
 assert.equal((await locker(one)).length,2);assert.equal((await shop()).items.some(c=>c.id===first.id),false,'Restore keeps the drop closed');
 const connection=new SqliteCosmeticsStore({directory,publicUrl:'https://fixture.invalid'});
 try{assert.equal((await connection.locker(one)).length,2);}finally{connection.close();}
 // Simulate upgrading the pre-ownership schema: only previously equipped public capes migrate.
 store.db.prepare('INSERT INTO players(uuid,cape_id) VALUES(?,?)').run('d'.repeat(32),second.id);
 store.db.prepare('INSERT INTO players(uuid,cape_id) VALUES(?,?)').run('e'.repeat(32),privateCape.id);
 store.db.prepare('DELETE FROM cape_migrations WHERE id=?').run('owned-locker-v1');
 const upgraded=new SqliteCosmeticsStore({directory,publicUrl:'https://fixture.invalid'});
 try{assert.equal((await upgraded.locker('d'.repeat(32))).length,1);assert.equal((await upgraded.locker('e'.repeat(32))).length,0);}finally{upgraded.close();}
});
