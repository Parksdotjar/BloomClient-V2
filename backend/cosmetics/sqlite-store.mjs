import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from './assets.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const objectPath = /^[a-f0-9-]{36}\/[a-f0-9-]{36}\/(cape|elytra|atlas)\.png$/;

// Single-node VPS storage. PNG bytes and revision metadata commit together, so
// an interrupted upload cannot publish partial files or leave an orphan image.
export class SqliteCosmeticsStore {
  constructor({directory, publicUrl, now = Date.now}) {
    if (!directory || !isAbsolute(directory)) throw new Error('Absolute cape storage directory required');
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Public HTTPS API URL required');
    this.publicUrl = publicUrl.replace(/\/$/, ''); this.now = now;
    mkdirSync(directory, {recursive:true,mode:0o700});
    if (process.platform !== 'win32') chmodSync(directory, 0o700);
    this.db = new DatabaseSync(resolve(directory, 'capes.sqlite'));
    if (process.platform !== 'win32') chmodSync(resolve(directory, 'capes.sqlite'), 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA max_page_count=524288;
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,cape_id TEXT NOT NULL,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS capes(id TEXT PRIMARY KEY,name TEXT NOT NULL,current_revision TEXT NOT NULL REFERENCES revisions(id),published INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS players(uuid TEXT PRIMARY KEY,cape_id TEXT REFERENCES capes(id),badge_visible INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,uuid TEXT NOT NULL,last_seen TEXT NOT NULL,expires_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_presence ON sessions(uuid,last_seen);
      CREATE TABLE IF NOT EXISTS objects(path TEXT PRIMARY KEY,revision TEXT NOT NULL REFERENCES revisions(id),bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(token_hash TEXT PRIMARY KEY,path TEXT NOT NULL REFERENCES objects(path),expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS leases_expiry ON leases(expires);
      CREATE TABLE IF NOT EXISTS cape_access(cape_id TEXT PRIMARY KEY REFERENCES capes(id),requires_code INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS cape_claims(player_uuid TEXT NOT NULL,cape_id TEXT NOT NULL REFERENCES capes(id),claimed_at INTEGER NOT NULL,PRIMARY KEY(player_uuid,cape_id));
      CREATE TABLE IF NOT EXISTS cape_codes(id TEXT PRIMARY KEY,cape_id TEXT NOT NULL REFERENCES capes(id),code_hash TEXT NOT NULL UNIQUE,suffix TEXT NOT NULL,created_at INTEGER NOT NULL,claimed_by TEXT,claimed_at INTEGER,revoked_at INTEGER);
      CREATE INDEX IF NOT EXISTS cape_codes_cape ON cape_codes(cape_id,created_at);
      CREATE TABLE IF NOT EXISTS cape_shop(cape_id TEXT PRIMARY KEY REFERENCES capes(id),listed INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS cape_shop_settings(id INTEGER PRIMARY KEY CHECK(id=1),featured_id TEXT REFERENCES capes(id));
      CREATE TABLE IF NOT EXISTS cape_migrations(id TEXT PRIMARY KEY);`);
    this.transaction(() => {
      if(this.db.prepare('SELECT 1 FROM cape_migrations WHERE id=?').get('owned-locker-v1'))return;
      // Preserve legitimately equipped public capes; never grant an unclaimed code-only cape.
      this.db.prepare(`INSERT OR IGNORE INTO cape_claims(player_uuid,cape_id,claimed_at)
        SELECT p.uuid,c.id,? FROM players p JOIN capes c ON c.id=p.cape_id LEFT JOIN cape_access a ON a.cape_id=c.id
        WHERE COALESCE(a.requires_code,0)=0`).run(this.now());
      this.db.prepare('INSERT INTO cape_migrations VALUES(?)').run('owned-locker-v1');
    });
  }
  close() { this.db.close(); }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async checkReadiness() {
    if (this.db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new ApiError(503,'storage_check_failed');
  }
  async catalog(player = null) {
    return this.db.prepare(`SELECT c.* FROM capes c LEFT JOIN cape_access a ON a.cape_id=c.id LEFT JOIN cape_shop s ON s.cape_id=c.id
      WHERE c.published=1 AND ((COALESCE(a.requires_code,0)=0 AND COALESCE(s.listed,1)=1) OR EXISTS(SELECT 1 FROM cape_claims WHERE cape_id=c.id AND player_uuid=?)) ORDER BY c.name`).all(player);
  }
  async locker(player) {
    return this.db.prepare(`SELECT c.* FROM capes c JOIN cape_claims o ON o.cape_id=c.id WHERE c.published=1 AND o.player_uuid=? ORDER BY c.name`).all(player);
  }
  async shop(player=null) {
    return this.db.prepare(`SELECT c.*,EXISTS(SELECT 1 FROM cape_claims WHERE cape_id=c.id AND player_uuid=?) AS owned
      FROM capes c LEFT JOIN cape_access a ON a.cape_id=c.id LEFT JOIN cape_shop s ON s.cape_id=c.id
      WHERE c.published=1 AND COALESCE(a.requires_code,0)=0 AND COALESCE(s.listed,1)=1 ORDER BY c.name`).all(player);
  }
  shopSettings(id) {
    return {shopListed:this.db.prepare('SELECT listed FROM cape_shop WHERE cape_id=?').get(id)?.listed!==0,
      featured:this.db.prepare('SELECT featured_id FROM cape_shop_settings WHERE id=1').get()?.featured_id===id};
  }
  async featuredCape() { return this.db.prepare('SELECT featured_id FROM cape_shop_settings WHERE id=1').get()?.featured_id || null; }
  claimCape(player,id) {
    return this.transaction(()=>{
      const cape=this.db.prepare('SELECT * FROM capes WHERE id=?').get(id);
      if(!cape?.published)throw new ApiError(404,'cape_unavailable');
      if(this.db.prepare('SELECT 1 FROM cape_claims WHERE player_uuid=? AND cape_id=?').get(player,id))return {id,name:cape.name,alreadyClaimed:true};
      if(this.requiresCode(id)||!this.shopSettings(id).shopListed)throw new ApiError(404,'cape_unavailable');
      this.db.prepare('INSERT INTO cape_claims VALUES(?,?,?)').run(player,id,this.now());
      return {id,name:cape.name,alreadyClaimed:false};
    });
  }
  requiresCode(id) { return !!this.db.prepare('SELECT requires_code FROM cape_access WHERE cape_id=?').get(id)?.requires_code; }
  canUseCape(player, id) {
    return !!this.db.prepare(`SELECT 1 FROM capes c LEFT JOIN cape_access a ON a.cape_id=c.id LEFT JOIN cape_shop s ON s.cape_id=c.id WHERE c.id=? AND c.published=1
      AND ((COALESCE(a.requires_code,0)=0 AND COALESCE(s.listed,1)=1) OR EXISTS(SELECT 1 FROM cape_claims WHERE cape_id=c.id AND player_uuid=?))`).get(id,player);
  }
  codes(id) {
    return this.db.prepare(`SELECT id,suffix,created_at AS createdAt,claimed_at AS claimedAt,revoked_at AS revokedAt FROM cape_codes WHERE cape_id=? ORDER BY (claimed_at IS NOT NULL OR revoked_at IS NOT NULL),created_at DESC,id LIMIT 200`).all(id);
  }
  generateCode(id, expectedRevision) {
    return this.transaction(() => {
      const cape=this.db.prepare('SELECT * FROM capes WHERE id=?').get(id);
      if(!cape || !cape.published || !this.requiresCode(id))throw new ApiError(409,'Publish this cape as code-only before generating codes.');
      if(cape.current_revision!==expectedRevision)throw new ApiError(409,'This cape changed. Reopen it before generating codes.');
      if(this.db.prepare('SELECT count(*) AS n FROM cape_codes WHERE cape_id=? AND claimed_at IS NULL AND revoked_at IS NULL').get(id).n>=200)throw new ApiError(409,'Revoke unused codes before generating more.');
      const secret=randomBytes(12).toString('hex').toUpperCase(),code='BLM-'+secret.match(/.{4}/g).join('-'),codeId=randomUUID(),createdAt=this.now();
      this.db.prepare('INSERT INTO cape_codes(id,cape_id,code_hash,suffix,created_at) VALUES(?,?,?,?,?)').run(codeId,id,digest('BLM'+secret),secret.slice(-4),createdAt);
      return {id:codeId,code,createdAt};
    });
  }
  revokeCode(capeId, codeId) {
    return this.transaction(() => {
      const row=this.db.prepare('SELECT * FROM cape_codes WHERE id=? AND cape_id=?').get(codeId,capeId);
      if(!row)throw new ApiError(404,'Code not found');
      if(row.claimed_by)throw new ApiError(409,'This code has already been claimed.');
      this.db.prepare('UPDATE cape_codes SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(this.now(),codeId);
    });
  }
  redeemCode(player, value) {
    if(typeof value!=='string'||value.length>80)throw new ApiError(400,'invalid_code');
    const code=value.toUpperCase().replace(/[\s-]/g,'');
    if(!/^BLM[A-F0-9]{24}$/.test(code))throw new ApiError(400,'invalid_code');
    return this.transaction(() => {
      const row=this.db.prepare(`SELECT k.*,c.name,c.published FROM cape_codes k JOIN capes c ON c.id=k.cape_id WHERE k.code_hash=?`).get(digest(code));
      if(!row || row.revoked_at || !row.published || !this.requiresCode(row.cape_id))throw new ApiError(400,'code_unavailable');
      // Retrying after a lost response succeeds for the original claimant only.
      if(row.claimed_by===player)return {id:row.cape_id,name:row.name,alreadyClaimed:true};
      if(row.claimed_by)throw new ApiError(409,'code_already_used');
      if(this.db.prepare('SELECT 1 FROM cape_claims WHERE player_uuid=? AND cape_id=?').get(player,row.cape_id))throw new ApiError(409,'cape_already_claimed');
      const time=this.now();
      this.db.prepare('UPDATE cape_codes SET claimed_by=?,claimed_at=? WHERE id=?').run(player,time,row.id);
      this.db.prepare('INSERT INTO cape_claims VALUES(?,?,?)').run(player,row.cape_id,time);
      return {id:row.cape_id,name:row.name,alreadyClaimed:false};
    });
  }
  async cape(id) { return this.db.prepare('SELECT * FROM capes WHERE id=?').get(id); }
  async revision(id) { const r = this.db.prepare('SELECT record FROM revisions WHERE id=?').get(id); return r ? JSON.parse(r.record) : null; }
  async commitDraft(record, texture, atlas, elytra) {
    if (!objectPath.test(record.texture_path) || (record.atlas_path && !objectPath.test(record.atlas_path)) || (record.elytra_path && !objectPath.test(record.elytra_path))) throw new ApiError(400,'invalid_asset_path');
    this.transaction(() => {
      this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(record.id,record.cape_id,JSON.stringify(record));
      const insert = this.db.prepare('INSERT INTO objects VALUES(?,?,?)');
      insert.run(record.texture_path,record.id,texture);
      if (record.elytra_path) insert.run(record.elytra_path,record.id,elytra);
      if (record.atlas_path) insert.run(record.atlas_path,record.id,atlas);
    });
  }
  async publish(id, revision, owner, requiresCode, shopOptions = {}) {
    this.transaction(() => {
      const row = this.db.prepare('SELECT record FROM revisions WHERE id=? AND cape_id=?').get(revision,id);
      const record = row && JSON.parse(row.record);
      if (!record || record.owner_uuid !== owner) throw new ApiError(404,'revision_not_found');
      this.db.prepare('INSERT INTO capes VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,current_revision=excluded.current_revision,published=1').run(id,record.name,revision);
      if(typeof requiresCode==='boolean') {
        if(this.requiresCode(id)!==requiresCode)this.db.prepare('DELETE FROM leases WHERE path IN (SELECT o.path FROM objects o JOIN revisions r ON r.id=o.revision WHERE r.cape_id=?)').run(id);
        this.db.prepare('INSERT INTO cape_access VALUES(?,?) ON CONFLICT(cape_id) DO UPDATE SET requires_code=excluded.requires_code').run(id,requiresCode?1:0);
      }
      if(typeof shopOptions.shopListed==='boolean')this.db.prepare('INSERT INTO cape_shop VALUES(?,?) ON CONFLICT(cape_id) DO UPDATE SET listed=excluded.listed').run(id,shopOptions.shopListed?1:0);
      if(shopOptions.featured===true && !this.requiresCode(id) && this.shopSettings(id).shopListed)this.db.prepare('INSERT INTO cape_shop_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET featured_id=excluded.featured_id').run(id);
      else if(shopOptions.featured===false || this.requiresCode(id) || !this.shopSettings(id).shopListed)this.db.prepare('UPDATE cape_shop_settings SET featured_id=NULL WHERE featured_id=?').run(id);
    });
  }
  async unpublish(id) { this.db.prepare('UPDATE capes SET published=0 WHERE id=?').run(id); }
  async equip(player, cape) {
    this.transaction(() => {
      if (cape && !this.canUseCape(player,cape)) throw new ApiError(404,'cape_unavailable');
      // Released launchers equip public capes directly. That action also saves ownership.
      if(cape)this.db.prepare('INSERT OR IGNORE INTO cape_claims VALUES(?,?,?)').run(player,cape,this.now());
      this.db.prepare('INSERT INTO players(uuid,cape_id) VALUES(?,?) ON CONFLICT(uuid) DO UPDATE SET cape_id=excluded.cape_id').run(player,cape);
    });
  }
  async players(ids) { return ids.map(id => this.db.prepare('SELECT * FROM players WHERE uuid=?').get(id)).filter(Boolean).map(p=>({...p,badge_visible:!!p.badge_visible})); }
  async badge(player, visible) { this.db.prepare('INSERT INTO players(uuid,badge_visible) VALUES(?,?) ON CONFLICT(uuid) DO UPDATE SET badge_visible=excluded.badge_visible').run(player,visible?1:0); }
  async createSession(s) {
    this.prune();
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(s.token_hash,s.uuid,s.last_seen,s.expires_at);
  }
  async session(hash) { return this.db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash); }
  async heartbeat(hash, time) { this.db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(time,hash); }
  async revoke(hash) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); }
  async presence(ids,since,now) { return ids.filter(id=>this.db.prepare('SELECT 1 FROM sessions WHERE uuid=? AND last_seen>? AND expires_at>? LIMIT 1').get(id,since,now)).map(uuid=>({uuid})); }
  prune() {
    this.db.prepare('DELETE FROM leases WHERE expires<=?').run(this.now());
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date(this.now()).toISOString());
  }
  async lease(path) {
    this.prune();
    // Bound issuance even under public catalog traffic; old links expire in 5m.
    if (this.db.prepare('SELECT count(*) AS n FROM leases').get().n >= 50000) throw new ApiError(503,'asset_leases_busy');
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO leases VALUES(?,?,?)').run(digest(token),path,this.now()+300000);
    return `${this.publicUrl}/v1/capes/assets/${token}`;
  }
  async leasedAsset(token) {
    if (!/^[\w-]{43}$/.test(token)) throw new ApiError(404,'asset_unavailable');
    // Existing leases stop serving as soon as a cape is unpublished or updated.
    const row = this.db.prepare(`SELECT o.bytes FROM leases l JOIN objects o ON o.path=l.path
      JOIN revisions r ON r.id=o.revision JOIN capes c ON c.id=r.cape_id
      WHERE l.token_hash=? AND l.expires>? AND c.published=1 AND c.current_revision=r.id`).get(digest(token),this.now());
    if (!row) throw new ApiError(404,'asset_unavailable');
    return Buffer.from(row.bytes);
  }
}
