import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { ApiError, requireValue, uuid, validateCape } from './assets.mjs';
import { SupabaseCosmeticsStore } from './store.mjs';
import { SqliteCosmeticsStore } from './sqlite-store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const assetId = value => { requireValue(typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value), 'invalid_id'); return value; };
const bearer = request => {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(value)) throw new ApiError(401,'sign_in_required');
  return value.slice(7);
};
async function readBody(request, limit = 16384) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError(415,'json_required');
  if (Number(request.headers['content-length']) > limit) throw new ApiError(413,'request_too_large');
  const parts = []; let size = 0;
  for await (const part of request) { size += part.length; if (size > limit) throw new ApiError(413,'request_too_large'); parts.push(part); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new ApiError(400,'invalid_json'); }
}
export async function verifyMinecraft(token) {
  const response = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers:{authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(8000), redirect:'error'
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) throw new ApiError(401,'minecraft_sign_in_required');
  if (!response.ok) throw new ApiError(503,'identity_service_unavailable');
  return uuid((await response.json()).id);
}

export function createCosmeticsApi({ store, owners = [], verify = verifyMinecraft, now = Date.now, studioPasswordHash = '' } = {}) {
  const enabled = !!store;
  const ownerSet = new Set(owners.map(uuid));
  const rates = new Map(), identities = new Map(), studioSessions = new Map();
  const json = (res,status,data) => { res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(data)); };
  const limit = (key, maximum) => {
    const time = now(), item = rates.get(key);
    if (!item || item.until <= time) rates.set(key,{count:1,until:time+60000});
    else if (++item.count > maximum) throw new ApiError(429,'too_many_requests');
    if (rates.size > 10000) { for (const [k,v] of rates) if (v.until <= time) rates.delete(k); if (rates.size > 10000) throw new ApiError(503,'busy'); }
  };
  const identity = async request => {
    const token = bearer(request), key = hash(token), cached = identities.get(key);
    if (cached && cached.until > now()) return cached.uuid;
    const player = uuid(await verify(token));
    if (identities.size >= 1000) identities.delete(identities.keys().next().value);
    identities.set(key,{uuid:player,until:now()+30000});
    return player;
  };
  const studioOwner = ownerSet.size === 1 ? ownerSet.values().next().value : null;
  const studioPassword = value => {
    if (!studioPasswordHash || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(studioPasswordHash)) return false;
    const [salt, expected] = studioPasswordHash.split(':'), actual = scryptSync(value,salt,32);
    return timingSafeEqual(actual,Buffer.from(expected,'hex'));
  };
  const owner = async request => {
    const token = bearer(request);
    if (/^bst_[\w-]{43}$/.test(token)) {
      const key = hash(token), session = studioSessions.get(key);
      if (!session || session.until <= now()) { studioSessions.delete(key); throw new ApiError(401,'studio_session_expired'); }
      limit(`publish:${session.uuid}`,12); return session.uuid;
    }
    const player = await identity(request); if (!ownerSet.has(player)) throw new ApiError(403,'owner_required'); limit(`publish:${player}`,12); return player;
  };
  const describe = async cape => {
    const r = await store.revision(cape.current_revision);
    if (!r) throw new ApiError(503,'revision_unavailable');
    return { id:cape.id, capeId:cape.id, name:cape.name, textureRevision:r.id, textureUrl:await store.lease(r.texture_path),
      textureSha256:r.texture_sha256, width:r.width,height:r.height,
      elytraUrl:r.elytra_path ? await store.lease(r.elytra_path) : null, elytraSha256:r.elytra_sha256 || null,
      elytraWidth:r.elytra_width || null, elytraHeight:r.elytra_height || null,
      animation:r.animation ? {...r.animation,revision:r.id,atlasUrl:await store.lease(r.atlas_path)} : null };
  };
  return { enabled, async checkReadiness() { if (enabled) await store.checkReadiness(); }, async handle(request,response,pathname,url) {
    if (!/^\/v1\/(capes(?:\/|$)|cosmetics(?:\/|$)|admin\/(?:capes|studio)(?:\/|$))/.test(pathname)) return false;
    try {
      if (!enabled) throw new ApiError(503,'cosmetics_not_configured');
      // Do not trust forwarded headers without a deployment-specific proxy allowlist.
      limit(`ip:${request.socket.remoteAddress}`,240);
      const method = request.method;
      if (pathname === '/v1/admin/studio/session' && method === 'POST') {
        limit(`studio-login:${request.socket.remoteAddress}`,5);
        const body = await readBody(request,1024);
        requireValue(studioOwner && typeof body.password === 'string' && body.password.length >= 16 && body.password.length <= 256,'studio_password_required');
        if (!studioPassword(body.password)) throw new ApiError(401,'studio_password_invalid');
        const token = `bst_${randomBytes(32).toString('base64url')}`, until = now()+30*24*60*60*1000;
        if (studioSessions.size >= 16) studioSessions.delete(studioSessions.keys().next().value);
        studioSessions.set(hash(token),{uuid:studioOwner,until});
        json(response,201,{token,ownerUuid:studioOwner,expiresAt:new Date(until).toISOString()});
      } else if (pathname === '/v1/admin/studio/session' && method === 'GET') {
        const player = await owner(request); json(response,200,{ownerUuid:player,valid:true});
      } else if (/^\/v1\/capes\/assets\/[^/]+$/.test(pathname) && method === 'GET' && store.leasedAsset) {
        const bytes = await store.leasedAsset(pathname.split('/')[4]);
        response.writeHead(200,{'content-type':'image/png','content-length':bytes.length,'cache-control':'private, no-store','x-content-type-options':'nosniff','access-control-allow-origin':'*','referrer-policy':'no-referrer'});
        response.end(bytes);
      } else if (pathname === '/v1/capes' && method === 'GET') {
        const capes = await store.catalog();
        json(response,200,{items:await Promise.all(capes.map(describe))});
      } else if (pathname === '/v1/capes/equipped' && method === 'GET') {
        const ids = [...new Set((url.searchParams.get('uuids') || '').split(',').map(uuid))];
        requireValue(ids.length > 0 && ids.length <= 100,'invalid_batch');
        const players = await store.players(ids);
        const active = new Set((await store.presence(ids,new Date(now()-180000).toISOString(),new Date(now()).toISOString())).map(p=>p.uuid));
        const assets = new Map();
        for (const p of players) if (p.cape_id && !assets.has(p.cape_id)) {
          const cape = await store.cape(p.cape_id);
          assets.set(p.cape_id,cape?.published ? await describe(cape) : null);
        }
        json(response,200,{items:ids.map(id=>{
          const p = players.find(p=>p.uuid===id), cape = p && assets.get(p.cape_id);
          return {uuid:id,...(cape || {capeId:null}),badgeVisible:active.has(id) && p?.badge_visible !== false};
        })});
      } else if (pathname === '/v1/capes/equipped' && method === 'PUT') {
        const player = await identity(request), body = await readBody(request);
        const id = body.capeId === null ? null : assetId(body.capeId);
        if (id && !(await store.cape(id))?.published) throw new ApiError(404,'cape_unavailable');
        await store.equip(player,id); json(response,200,{uuid:player,capeId:id});
      } else if (pathname === '/v1/cosmetics/me' && method === 'GET') {
        const player = await identity(request), p = (await store.players([player]))[0];
        json(response,200,{uuid:player,capeId:p?.cape_id || null,badgeVisible:p?.badge_visible !== false,canPublish:ownerSet.has(player)});
      } else if (pathname === '/v1/cosmetics/badge' && method === 'PUT') {
        const player = await identity(request), body = await readBody(request);
        requireValue(typeof body.visible === 'boolean'); await store.badge(player,body.visible);
        json(response,200,{visible:body.visible});
      } else if (pathname === '/v1/cosmetics/sessions' && method === 'POST') {
        const player = await identity(request); limit(`session:${player}`,12);
        const token = `bcs_${randomBytes(32).toString('base64url')}`, expiresAt = new Date(now()+12*60*60*1000).toISOString();
        await store.createSession({token_hash:hash(token),uuid:player,last_seen:new Date(0).toISOString(),expires_at:expiresAt});
        json(response,201,{token,uuid:player,expiresAt,heartbeatSeconds:60});
      } else if (pathname === '/v1/cosmetics/sessions/current' && ['PUT','DELETE'].includes(method)) {
        const token = bearer(request); if (!/^bcs_[\w-]{43}$/.test(token)) throw new ApiError(401,'invalid_game_session');
        const tokenHash = hash(token), session = await store.session(tokenHash);
        if (!session || Date.parse(session.expires_at) <= now()) throw new ApiError(401,'game_session_expired');
        limit(`heartbeat:${tokenHash}`,6);
        if (method === 'DELETE') await store.revoke(tokenHash); else await store.heartbeat(tokenHash,new Date(now()).toISOString());
        json(response,200,{ok:true});
      } else if (pathname === '/v1/admin/capes/drafts' && method === 'POST') {
        const player = await owner(request), body = await readBody(request,128*1024*1024);
        const capeId = body.capeId ? assetId(body.capeId) : randomUUID();
        const cape = validateCape(body), id = randomUUID(), texturePath = `${capeId}/${id}/cape.png`;
        const elytraPath = cape.elytra ? `${capeId}/${id}/elytra.png` : null;
        const atlasPath = cape.atlas ? `${capeId}/${id}/atlas.png` : null;
        const record = {id,cape_id:capeId,name:cape.name,owner_uuid:player,texture_path:texturePath,texture_sha256:cape.sha256,
          width:cape.width,height:cape.height,elytra_path:elytraPath,elytra_sha256:cape.elytraSha256,
          elytra_width:cape.elytraWidth,elytra_height:cape.elytraHeight,atlas_path:atlasPath,animation:cape.animation};
        if (store.commitDraft) await store.commitDraft(record,cape.texture,cape.atlas,cape.elytra);
        else {
          await store.upload(texturePath,cape.texture);
          if (elytraPath) await store.upload(elytraPath,cape.elytra);
          if (atlasPath) await store.upload(atlasPath,cape.atlas);
          await store.createRevision(record);
        }
        json(response,201,{capeId,revision:id});
      } else if (/^\/v1\/admin\/capes\/[^/]+\/publish$/.test(pathname) && method === 'POST') {
        const player = await owner(request), id = assetId(pathname.split('/')[4]), body = await readBody(request);
        const revision = assetId(body.revision), record = await store.revision(revision);
        if (!record || record.cape_id !== id || record.owner_uuid !== player) throw new ApiError(404,'revision_not_found');
        await store.publish(id,revision,player); json(response,200,{id,revision,published:true});
      } else if (/^\/v1\/admin\/capes\/[^/]+$/.test(pathname) && method === 'DELETE') {
        await owner(request); const id = assetId(pathname.split('/')[4]); await store.unpublish(id); json(response,200,{id,published:false});
      } else if (/^\/v1\/capes\/[^/]+\/texture$/.test(pathname) && method === 'GET') {
        const cape = await store.cape(assetId(pathname.split('/')[3]));
        if (!cape?.published) throw new ApiError(404,'cape_unavailable');
        const info = await describe(cape); json(response,200,{url:info.textureUrl,revision:info.textureRevision,sha256:info.textureSha256});
      } else throw new ApiError(404,'not_found');
    } catch (error) { json(response,error instanceof ApiError ? error.status : 503,{error:error instanceof ApiError ? error.message : 'cosmetics_unavailable'}); }
    return true;
  }};
}

export function cosmeticsFromEnvironment(env = process.env) {
  if (env.BLOOM_COSMETICS_ENABLED !== 'true') return createCosmeticsApi();
  if (env.BLOOM_CAPE_STORAGE === 'sqlite') {
    if (!env.BLOOM_CAPE_OWNER_UUIDS) throw new Error('Cape owner allowlist required');
    const owners = env.BLOOM_CAPE_OWNER_UUIDS.split(',').map(v=>uuid(v.trim()));
    return createCosmeticsApi({store:new SqliteCosmeticsStore({directory:env.BLOOM_CAPE_DATA_DIR,publicUrl:env.BLOOM_CAPE_PUBLIC_URL}),owners,studioPasswordHash:env.BLOOM_CAPE_STUDIO_PASSWORD_HASH || ''});
  }
  if (!env.BLOOM_SUPABASE_URL || !env.BLOOM_SUPABASE_SERVICE_KEY || !env.BLOOM_CAPE_OWNER_UUIDS) throw new Error('Cosmetics configuration incomplete');
  const publicUrl = env.BLOOM_ASSET_PUBLIC_URL || env.BLOOM_SUPABASE_URL;
  if (new URL(publicUrl).protocol !== 'https:') throw new Error('Cape leases require a public HTTPS storage endpoint');
  return createCosmeticsApi({store:new SupabaseCosmeticsStore({url:env.BLOOM_SUPABASE_URL,key:env.BLOOM_SUPABASE_SERVICE_KEY,publicUrl}),owners:env.BLOOM_CAPE_OWNER_UUIDS.split(',').map(v=>v.trim()),studioPasswordHash:env.BLOOM_CAPE_STUDIO_PASSWORD_HASH || ''});
}
