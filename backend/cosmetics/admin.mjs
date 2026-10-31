import { randomUUID } from 'node:crypto';
import { validateCape, ApiError, uuid } from './assets.mjs';
import { SqliteCosmeticsStore } from './sqlite-store.mjs';
export function createCapeAdmin({authorize,store,ownerUuid}) {
  let queue=Promise.resolve();
  let windowStart=0, mutations=0;
  const locked=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  const summary=async c=>{const r=await store.revision(c.current_revision);return {id:c.id,name:c.name,revision:r.id,published:!!c.published,width:r.width,animated:!!r.animation,requiresCode:store.requiresCode(c.id),...store.shopSettings(c.id)};};
  const check=async(id,revision)=>{const c=await store.cape(id);if(!c)throw new ApiError(404,'Cape not found');if(c.current_revision!==revision)throw new ApiError(409,'This cape changed. Refresh before publishing.');return c;};
  return {async handle(req,res,path){
    if(!path.startsWith('/v1/owner/content/capes'))return false;
    try {
      await authorize(req,req.method!=='GET');
      if(!store||!ownerUuid)throw new ApiError(503,'Cape storage unavailable');
      const suffix=path.slice('/v1/owner/content/capes'.length);
      if(req.method==='GET'&&suffix==='') {
        const rows=store.db.prepare('SELECT * FROM capes ORDER BY published DESC,name').all();
        json(res,200,{items:await Promise.all(rows.map(summary))});return true;
      }
      const match=suffix.match(/^\/([a-f0-9-]{36})(?:\/(remove|restore|codes)(?:\/([a-f0-9-]{36})\/revoke)?)?$/);
      if(req.method==='GET'&&match?.[2]==='codes'&&!match[3]) {
        if(!await store.cape(match[1]))throw new ApiError(404,'Cape not found');
        json(res,200,{items:store.codes(match[1])});return true;
      }
      if(req.method==='GET'&&match&&!match[2]) {
        const c=await store.cape(match[1]);if(!c)throw new ApiError(404,'Cape not found');const r=await store.revision(c.current_revision);
        const bytes=p=>p?Buffer.from(store.db.prepare('SELECT bytes FROM objects WHERE path=?').get(p).bytes).toString('base64'):null;
        json(res,200,{...await summary(c),texture:bytes(r.texture_path),elytra:bytes(r.elytra_path)});return true;
      }
      if(Date.now()-windowStart>60000){windowStart=Date.now();mutations=0;}
      if(++mutations>20)throw new ApiError(429,'Too many changes. Try again shortly.');
      if(req.method!=='POST'||!(suffix==='/publish'||match?.[2]))throw new ApiError(404,'Not found');
      if(!req.headers['content-type']?.startsWith('application/json'))throw new ApiError(415,'JSON required');
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>115*1024*1024)throw new ApiError(413,'Images too large');chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new ApiError(400,'Invalid JSON');}
      if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiError(400,'JSON object required');
      await locked(async()=>{
        if(match?.[2]) {
          const c=await check(match[1],body.expectedRevision);
          if(match[2]==='codes') {
            if(match[3]){store.revokeCode(c.id,match[3]);json(res,200,{ok:true});}
            else json(res,201,store.generateCode(c.id,body.expectedRevision));
            return;
          }
          if(match[2]==='remove')await store.unpublish(c.id);
          else {const r=await store.revision(c.current_revision);await store.publish(c.id,r.id,r.owner_uuid);}
          json(res,200,{ok:true});return;
        }
        if(body.capeId){if(!/^[a-f0-9-]{36}$/.test(body.capeId))throw new ApiError(400,'Invalid cape');const c=await check(body.capeId,body.expectedRevision);const r=await store.revision(c.current_revision);if(r.animation)throw new ApiError(400,'Animated capes require the animation editor; publish a separate static cape.');}
        if(body.animation)throw new ApiError(400,'This workspace publishes static capes');
        if(body.requiresCode!==undefined&&typeof body.requiresCode!=='boolean')throw new ApiError(400,'Invalid code-only setting');
        for(const key of ['shopListed','featured'])if(body[key]!==undefined&&typeof body[key]!=='boolean')throw new ApiError(400,'Invalid Shop setting');
        if(body.featured && (body.requiresCode || body.shopListed===false))throw new ApiError(400,'Only a public Shop cape can be featured.');
        const cape=validateCape(body),id=randomUUID(),capeId=body.capeId||randomUUID();
        const record={id,cape_id:capeId,name:cape.name,owner_uuid:ownerUuid,texture_path:`${capeId}/${id}/cape.png`,texture_sha256:cape.sha256,width:cape.width,height:cape.height,elytra_path:cape.elytra?`${capeId}/${id}/elytra.png`:null,elytra_sha256:cape.elytraSha256,elytra_width:cape.elytraWidth,elytra_height:cape.elytraHeight,atlas_path:null,animation:null};
        await store.commitDraft(record,cape.texture,null,cape.elytra);await store.publish(capeId,id,ownerUuid,body.requiresCode,{shopListed:body.shopListed,featured:body.featured});
        json(res,201,{id:capeId,revision:id,published:true});
      });
    }catch(e){json(res,e.status||503,{error:e.status?e.message:'Cape operation failed'});}return true;
  }};
}
export function capeAdminFromEnvironment(authorize,env=process.env){
  const owners=(env.BLOOM_CAPE_OWNER_UUIDS||'').split(',').map(value=>value.trim()).filter(Boolean);
  const store=env.BLOOM_COSMETICS_ENABLED==='true'&&env.BLOOM_CAPE_STORAGE==='sqlite'?new SqliteCosmeticsStore({directory:env.BLOOM_CAPE_DATA_DIR,publicUrl:env.BLOOM_CAPE_PUBLIC_URL}):null;
  return createCapeAdmin({authorize,store,ownerUuid:owners.length===1?uuid(owners[0]):null});
}
