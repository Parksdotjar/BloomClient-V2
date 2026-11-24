import { ApiError, requireValue, uuid } from './assets.mjs';

const idPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const colorPattern = /^#[a-fA-F0-9]{6}$/;

function itemKey(value) {
  requireValue(value && typeof value.id === 'string' && idPattern.test(value.id), 'invalid_wing_id');
  requireValue(typeof value.revision === 'string' && revisionPattern.test(value.revision), 'invalid_wing_revision');
  return { id: value.id, revision: value.revision };
}

function colors(value) {
  const keys = ['left', 'right', 'trim'];
  requireValue(value && typeof value === 'object' && Object.keys(value).length === keys.length, 'invalid_wing_colors');
  requireValue(keys.every(key => typeof value[key] === 'string' && colorPattern.test(value[key])), 'invalid_wing_colors');
  return Object.fromEntries(keys.map(key => [key, value[key].toLowerCase()]));
}

export class WingStorage {
  constructor(db, transaction) {
    this.db = db;
    this.transaction = transaction;
    db.exec(
      'CREATE TABLE IF NOT EXISTS wing_revisions (' +
      'id TEXT NOT NULL, revision TEXT NOT NULL, name TEXT NOT NULL, colors TEXT NOT NULL, ' +
      'published INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(id,revision)); ' +
      'CREATE TABLE IF NOT EXISTS wing_claims (uuid TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(uuid,id)); ' +
      'CREATE TABLE IF NOT EXISTS wing_colors (uuid TEXT NOT NULL,id TEXT NOT NULL,colors TEXT NOT NULL,PRIMARY KEY(uuid,id)); ' +
      'CREATE TABLE IF NOT EXISTS wing_equipment (' +
      'uuid TEXT PRIMARY KEY,id TEXT NOT NULL,revision TEXT NOT NULL,colors TEXT NOT NULL,' +
      'FOREIGN KEY(id,revision) REFERENCES wing_revisions(id,revision));'
    );
  }

  available({id, revision}) {
    return !!this.db.prepare('SELECT 1 FROM wing_revisions WHERE id=? AND revision=? AND published=1').get(id, revision);
  }

  owns(player, id) {
    return !!this.db.prepare('SELECT 1 FROM wing_claims WHERE uuid=? AND id=?').get(player, id);
  }

  stage(value) {
    const { id, revision } = itemKey(value);
    requireValue(typeof value.name === 'string' && !!value.name.trim() && value.name.length <= 120, 'invalid_wing_name');
    const defaults = colors(value.defaults);
    const name = value.name.trim();
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM wing_revisions WHERE id=? AND revision=?').get(id, revision);
      if (previous) {
        if (previous.name !== name || previous.colors !== JSON.stringify(defaults)) throw new ApiError(409, 'immutable_wing_revision');
        return { id, revision, published: !!previous.published };
      }
      this.db.prepare('INSERT INTO wing_revisions(id,revision,name,colors) VALUES(?,?,?,?)')
        .run(id, revision, name, JSON.stringify(defaults));
      return { id, revision, published: false };
    });
  }

  publish(value) {
    const { id, revision } = itemKey(value);
    const change = this.db.prepare('UPDATE wing_revisions SET published=1 WHERE id=? AND revision=?').run(id, revision);
    if (!change.changes) throw new ApiError(404, 'wing_draft_required');
    return { id, revision, published: true };
  }

  catalog(player, ownedOnly) {
    return this.db.prepare(
      'SELECT r.*, c.uuid AS owner, p.colors AS configured FROM wing_revisions r LEFT JOIN wing_claims c ON c.id=r.id AND c.uuid=? ' +
      'LEFT JOIN wing_colors p ON p.id=r.id AND p.uuid=c.uuid ' +
      'WHERE r.published=1 AND (?=0 OR c.uuid IS NOT NULL) ORDER BY r.name,r.revision LIMIT 1000'
    ).all(player, +ownedOnly).map(row => ({
      id: row.id, revision: row.revision, name: row.name, defaults: JSON.parse(row.colors), owned: !!row.owner,
      configured: row.configured ? JSON.parse(row.configured) : null,
    }));
  }

  claim(player, value) {
    const key = itemKey(value);
    return this.transaction(() => {
      if (!this.available(key)) throw new ApiError(404, 'wing_unavailable');
      this.db.prepare('INSERT OR IGNORE INTO wing_claims VALUES(?,?)').run(player, key.id);
      return key;
    });
  }

  equip(player, value) {
    if (value?.id === null) {
      this.db.prepare('DELETE FROM wing_equipment WHERE uuid=?').run(player);
      return null;
    }
    const key = itemKey(value);
    const selected = colors(value.colors);
    return this.transaction(() => {
      if (!this.available(key)) throw new ApiError(404, 'wing_unavailable');
      if (!this.owns(player, key.id)) throw new ApiError(403, 'wing_not_owned');
      this.db.prepare('INSERT INTO wing_equipment VALUES(?,?,?,?) ON CONFLICT(uuid) DO UPDATE SET ' +
        'id=excluded.id,revision=excluded.revision,colors=excluded.colors')
        .run(player, key.id, key.revision, JSON.stringify(selected));
      this.db.prepare('INSERT INTO wing_colors VALUES(?,?,?) ON CONFLICT(uuid,id) DO UPDATE SET colors=excluded.colors')
        .run(player, key.id, JSON.stringify(selected));
      return { ...key, colors: selected };
    });
  }

  equipped(player) {
    const row = this.db.prepare(
      'SELECT e.* FROM wing_equipment e JOIN wing_revisions r ON r.id=e.id AND r.revision=e.revision ' +
      'WHERE e.uuid=? AND r.published=1'
    ).get(player);
    return row ? { id: row.id, revision: row.revision, colors: JSON.parse(row.colors) } : null;
  }
}

export async function wingRequest(path, method, { store, request, url, json, response, owner, identity, readBody, limit }) {
  const wings = store.wings;
  if (!wings) throw new ApiError(503, 'wings_unavailable');
  let result;
  if (path === '/v1/admin/studio/wings' && method === 'PUT') {
    await owner(request);
    result = wings.stage(await readBody(request, 2048));
  } else if (path === '/v1/admin/studio/wings/publish' && method === 'POST') {
    await owner(request);
    result = wings.publish(await readBody(request, 1024));
  } else if (path === '/v1/wings/shop' && method === 'GET') {
    result = { items: wings.catalog(request.headers.authorization ? await identity(request) : null, false) };
  } else if (path === '/v1/wings/locker' && method === 'GET') {
    const player = await identity(request);
    result = { items: wings.catalog(player, true), equipped: wings.equipped(player) };
  } else if (path === '/v1/wings/claim' && method === 'POST') {
    const player = await identity(request);
    limit('wing-claim:' + player, 30);
    result = wings.claim(player, await readBody(request, 1024));
  } else if (path === '/v1/wings/equipped' && method === 'PUT') {
    const player = await identity(request);
    limit('wing-equip:' + player, 30);
    result = { equipped: wings.equip(player, await readBody(request, 2048)) };
  } else if (path === '/v1/wings/equipped' && method === 'GET') {
    const players = [...new Set((url.searchParams.get('uuids') || '').split(',').map(uuid))];
    requireValue(players.length > 0 && players.length <= 100, 'invalid_batch');
    result = { items: players.flatMap(player => {
      const current = wings.equipped(player);
      return current ? [{ uuid: player, ...current }] : [];
    }) };
  } else throw new ApiError(404, 'not_found');
  json(response, 200, result);
}
