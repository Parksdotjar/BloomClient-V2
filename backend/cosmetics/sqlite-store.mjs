import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
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
      CREATE INDEX IF NOT EXISTS leases_expiry ON leases(expires);`);
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
  async catalog() { return this.db.prepare('SELECT * FROM capes WHERE published=1 ORDER BY name').all(); }
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
  async publish(id, revision, owner) {
    this.transaction(() => {
      const row = this.db.prepare('SELECT record FROM revisions WHERE id=? AND cape_id=?').get(revision,id);
      const record = row && JSON.parse(row.record);
      if (!record || record.owner_uuid !== owner) throw new ApiError(404,'revision_not_found');
      this.db.prepare('INSERT INTO capes VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,current_revision=excluded.current_revision,published=1').run(id,record.name,revision);
    });
  }
  async unpublish(id) { this.db.prepare('UPDATE capes SET published=0 WHERE id=?').run(id); }
  async equip(player, cape) {
    this.transaction(() => {
      if (cape && !this.db.prepare('SELECT id FROM capes WHERE id=? AND published=1').get(cape)) throw new ApiError(404,'cape_unavailable');
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
