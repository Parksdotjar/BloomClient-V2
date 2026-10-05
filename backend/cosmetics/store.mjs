import { ApiError } from './assets.mjs';

// The service key is supplied by the existing isolated deployment, never by a
// desktop caller. This adapter exposes no arbitrary table/path API to clients.
export class SupabaseCosmeticsStore {
  constructor({ url, key, publicUrl = url, bucket = 'bloom-capes', fetcher = fetch }) {
    this.url = url.replace(/\/$/, ''); this.key = key; this.bucket = bucket; this.fetcher = fetcher;
    this.publicUrl = publicUrl.replace(/\/$/, '');
  }
  async request(path, method = 'GET', body, headers = {}) {
    const response = await this.fetcher(`${this.url}${path}`, { method, signal: AbortSignal.timeout(12000),
      headers: { apikey:this.key, authorization:`Bearer ${this.key}`, 'content-type':'application/json', ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    if (!response.ok) throw new ApiError(503, 'cosmetics_storage_unavailable');
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  async catalog() { return this.request('/rest/v1/bloom_capes?published=eq.true&select=id,name,current_revision&order=name.asc'); }
  async checkReadiness() {
    // Schema-only reads: never enumerate player, session or private revision data.
    for (const [table, columns] of [
      ['bloom_capes', 'id,name,current_revision,published'],
      ['bloom_cape_revisions', 'id,cape_id,name,owner_uuid,texture_path,texture_sha256,width,height,elytra_path,elytra_sha256,elytra_width,elytra_height,atlas_path,animation'],
      ['bloom_cape_players', 'uuid,cape_id,badge_visible'],
      ['bloom_cape_sessions', 'token_hash,uuid,last_seen,expires_at'],
    ]) await this.request(`/rest/v1/${table}?select=${columns}&limit=0`);
    const bucket = await this.request(`/storage/v1/bucket/${this.bucket}`);
    if (bucket?.public !== false || !Number.isFinite(bucket.file_size_limit)
      || bucket.file_size_limit <= 0 || bucket.file_size_limit > 33554432
      || !Array.isArray(bucket.allowed_mime_types)
      || bucket.allowed_mime_types.length !== 1 || bucket.allowed_mime_types[0] !== 'image/png') {
      throw new ApiError(503, 'unsafe_cape_bucket');
    }
  }
  async cape(id) { return (await this.request(`/rest/v1/bloom_capes?id=eq.${id}&select=*`))[0] || null; }
  async revision(id) { return (await this.request(`/rest/v1/bloom_cape_revisions?id=eq.${id}&select=*`))[0] || null; }
  async createRevision(record) { await this.request('/rest/v1/bloom_cape_revisions','POST',record); }
  async publish(id, revision, owner) { return this.request('/rest/v1/rpc/bloom_publish_cape','POST',{p_id:id,p_revision:revision,p_owner:owner}); }
  async unpublish(id) { await this.request(`/rest/v1/bloom_capes?id=eq.${id}`, 'PATCH', {published:false}); }
  async equip(player, cape) { await this.request('/rest/v1/rpc/bloom_equip_cape', 'POST', {p_uuid:player,p_cape:cape}); }
  async players(ids) { return this.request(`/rest/v1/bloom_cape_players?uuid=in.(${ids.join(',')})&select=uuid,cape_id,badge_visible`); }
  async badge(player, visible) { await this.request('/rest/v1/rpc/bloom_set_badge','POST',{p_uuid:player,p_visible:visible}); }
  async createSession(record) { await this.request('/rest/v1/bloom_cape_sessions','POST',record); }
  async session(hash) { return (await this.request(`/rest/v1/bloom_cape_sessions?token_hash=eq.${hash}&select=*`))[0] || null; }
  async heartbeat(hash, time) { await this.request(`/rest/v1/bloom_cape_sessions?token_hash=eq.${hash}`,'PATCH',{last_seen:time}); }
  async revoke(hash) { await this.request(`/rest/v1/bloom_cape_sessions?token_hash=eq.${hash}`,'DELETE'); }
  async presence(ids, since, now) { return this.request(`/rest/v1/bloom_cape_sessions?uuid=in.(${ids.join(',')})&last_seen=gt.${encodeURIComponent(since)}&expires_at=gt.${encodeURIComponent(now)}&select=uuid`); }
  async upload(path, bytes) { await this.request(`/storage/v1/object/${this.bucket}/${path}`,'POST',bytes,{'content-type':'image/png','x-upsert':'false'}); }
  async lease(path) {
    const result = await this.request(`/storage/v1/object/sign/${this.bucket}/${path}`,'POST',{expiresIn:300});
    return `${this.publicUrl}/storage/v1${result.signedURL}`;
  }
}
