import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import http from 'node:http';
import {SqliteCosmeticsStore} from './sqlite-store.mjs';
import {createCosmeticsApi} from './api.mjs';

function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'bloom-access-security-'));
 const store=new SqliteCosmeticsStore({directory,publicUrl:'https://fixture.invalid'});
 t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});return store;
}
async function cape(store,restricted=false){
 const id=randomUUID(),revision=randomUUID(),owner='a'.repeat(32),path=`${id}/${revision}/cape.png`;
 await store.commitDraft({id:revision,cape_id:id,owner_uuid:owner,name:'Security fixture',texture_path:path,atlas_path:null},Buffer.from('fixture'),null);
 await store.publish(id,revision,owner,restricted);return {id,revision,owner,path};
}
test('old asset links never revive after archive/restore, delist/relist or access changes',async t=>{
 const store=fixture(t),c=await cape(store);
 const lease=async()=> (await store.lease(c.path)).split('/').pop();
 const archived=await lease();await store.unpublish(c.id);await store.publish(c.id,c.revision,c.owner);
 await assert.rejects(store.leasedAsset(archived),/asset_unavailable/);
 const listed=await lease();await store.publish(c.id,c.revision,c.owner,undefined,{shopListed:false});
 await assert.rejects(store.leasedAsset(listed),/asset_unavailable/);
 await store.publish(c.id,c.revision,c.owner,undefined,{shopListed:true});await assert.rejects(store.leasedAsset(listed));
 const publicLink=await lease();await store.publish(c.id,c.revision,c.owner,true);await store.publish(c.id,c.revision,c.owner,false);
 await assert.rejects(store.leasedAsset(publicLink));assert.equal((await store.leasedAsset(await lease())).toString(),'fixture');
});
test('every restricted cape requires its own valid redemption, including after republication',async t=>{
 const store=fixture(t),player='b'.repeat(32),other='c'.repeat(32),capes=[];
 for(let i=0;i<4;i++){
  const c=await cape(store);capes.push(c);store.claimCape(player,c.id);await store.publish(c.id,c.revision,c.owner,true);
  assert.equal(store.canUseCape(player,c.id),false);assert.equal(store.canUseCape(other,c.id),false);
  assert.throws(()=>store.claimCape(player,c.id),/cape_unavailable/);
 }
 const c=capes[0],code=store.generateCode(c.id,c.revision);
 store.redeemCode(player,code.code);
 assert.equal(store.canUseCape(player,c.id),true);
 assert.throws(()=>store.redeemCode(other,code.code),/code_already_used/);
 assert.deepEqual((await store.locker(player)).map(c=>c.id),[c.id]);
 for(const x of capes){await store.publish(x.id,x.revision,x.owner);assert.equal(store.requiresCode(x.id),true);assert.equal(store.canUseCape(player,x.id),x.id===c.id);}
 const revoked=store.generateCode(capes[1].id,capes[1].revision);store.revokeCode(capes[1].id,revoked.id);
 assert.throws(()=>store.redeemCode(player,revoked.code),/code_unavailable/);
 // Removing ownership must not leave a successful redemption retry response.
 store.db.prepare('DELETE FROM cape_claims WHERE player_uuid=? AND cape_id=?').run(player,c.id);
 assert.equal(store.canUseCape(player,c.id),false);
 assert.throws(()=>store.redeemCode(player,code.code),/code_unavailable/);
});
test('malformed session expiry and non-object request bodies fail closed',async t=>{
 const store=fixture(t),player='b'.repeat(32),api=createCosmeticsApi({store,verify:async()=>player});
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(!await api.handle(req,res,url.pathname,url))res.writeHead(404).end();});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const token='bcs_'+'x'.repeat(43),hash=createHash('sha256').update(token).digest('hex');
 const call=(path,body,auth=token)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'PUT',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify(body)});
 for(const expires_at of ['garbage','','2000-01-01T00:00:00Z']){
  store.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?,?)').run(hash,player,new Date(0).toISOString(),expires_at);
  assert.equal((await call('/v1/cosmetics/sessions/current',{})).status,401);
 }
 for(const body of [null,[],true,'text',42])assert.equal((await call('/v1/capes/equipped',body,'minecraft-fixture')).status,400);
 assert.equal((await call('/v1/capes/equipped',{capeId:null},'minecraft-fixture')).status,200);
});
