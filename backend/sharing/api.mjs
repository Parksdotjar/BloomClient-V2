import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_FILES = 500;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 20;
const EDITOR_LIMIT = 5;
const MEMBER_LIMIT = 10;
const ACCESS_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const json = (response, status, body, cacheControl = "no-store") => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(payload);
  return true;
};

const readJson = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ShareError(413, "share_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ShareError(400, "invalid_share_manifest");
  }
};

class ShareError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const validToken = (value, max = 64) => typeof value === "string" && value.length > 0 && value.length <= max && /^[0-9A-Za-z._+ -]+$/.test(value);
const validSha1 = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const validDownload = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "cdn.modrinth.com";
  } catch { return false; }
};
const validJarName = (value) => typeof value === "string"
  && value.length > 4
  && value.length <= 180
  && value.trim() === value
  && /\.jar$/i.test(value)
  && !/[\/\\\u0000-\u001f\u007f]/.test(value)
  && value !== "."
  && value !== "..";
const validPath = (value) => typeof value === "string"
  && value.startsWith("mods/")
  && validJarName(value.slice(5));
const validMissingMod = validJarName;

export function validateShareManifest(input) {
  if (!input || input.schemaVersion !== 1 || !validToken(input.name, 80)) throw new ShareError(400, "invalid_share_manifest");
  if (!validToken(input.minecraftVersion, 32) || input.loader !== "fabric" || !validToken(input.loaderVersion, 64)) throw new ShareError(400, "unsupported_share_runtime");
  if (!Array.isArray(input.files) || input.files.length > MAX_FILES) throw new ShareError(400, "invalid_share_files");
  if (input.missingMods !== undefined && !Array.isArray(input.missingMods)) throw new ShareError(400, "invalid_missing_mods");
  const missingMods = [...new Set((input.missingMods || []).map(value => {
    if (!validMissingMod(value)) throw new ShareError(400, "invalid_missing_mod");
    return value;
  }))];
  if (missingMods.length > MAX_FILES || input.files.length + missingMods.length < 1 || input.files.length + missingMods.length > MAX_FILES) throw new ShareError(400, "invalid_share_files");
  const paths = new Set();
  const files = input.files.map((file) => {
    if (!file || !validPath(file.path) || paths.has(file.path.toLowerCase())) throw new ShareError(400, "invalid_share_file");
    if (!Array.isArray(file.downloads) || file.downloads.length !== 1 || !validDownload(file.downloads[0])) throw new ShareError(400, "untrusted_share_download");
    if (!file.hashes || !validSha1(file.hashes.sha1)) throw new ShareError(400, "invalid_share_hash");
    paths.add(file.path.toLowerCase());
    return {
      path: file.path,
      hashes: { sha1: file.hashes.sha1 },
      env: { client: "required", server: "required" },
      downloads: [file.downloads[0]],
    };
  });
  return {
    schemaVersion: 1,
    name: input.name.trim(),
    minecraftVersion: input.minecraftVersion,
    loader: "fabric",
    loaderVersion: input.loaderVersion,
    files,
    missingMods,
  };
}

class MemoryShareStore {
  constructor({ now = Date.now } = {}) { this.now = now; this.items = new Map(); this.channels = new Map(); this.invites = new Map(); }
  put(code, manifest, expiresAt) { this.items.set(code, { manifest, expiresAt }); }
  get(code) {
    const item = this.items.get(code);
    if (!item || item.expiresAt <= this.now()) { this.items.delete(code); return null; }
    return item;
  }
  has(code) { return Boolean(this.get(code)); }
  createChannel(code, manifest, tokenHash) { this.channels.set(code, { code, manifest, revision: 1, ownerHash: tokenHash, accessEnabled: true, access: new Map(), updatedAt: this.now() }); }
  getChannel(code) { const channel = this.channels.get(code); if (!channel) return null; return { ...channel, editorCount: [...channel.access.values()].filter(item => item.role === "editor").length }; }
  updateChannel(code, manifest) { const item = this.channels.get(code); item.manifest = manifest; item.revision += 1; item.updatedAt = this.now(); return item; }
  createInvite(code, channelCode, recipientId, role, expiresAt) { this.invites.set(code, { id: code, channelCode, recipientId, role, expiresAt, createdAt: this.now() }); }
  hasInvite(code) { return this.invites.has(code); }
  listInvites(channelCode) { return [...this.invites.values()].filter(item => item.channelCode === channelCode && item.expiresAt > this.now()); }
  updateInviteRole(channelCode, id, role) { const invite = this.invites.get(id); if (!invite || invite.channelCode !== channelCode) return null; invite.role = role; return invite; }
  deleteInvite(channelCode, id) { const invite = this.invites.get(id); if (!invite || invite.channelCode !== channelCode) return false; return this.invites.delete(id); }
  deleteInviteByCode(id) { return this.invites.delete(id); }
  redeemInvite(code, id, tokenHash) { const invite = this.invites.get(code); if (!invite || invite.expiresAt <= this.now()) return null; const channel = this.channels.get(invite.channelCode); if (!channel || channel.access.size >= MEMBER_LIMIT || (invite.role === "editor" && [...channel.access.values()].filter(item => item.role === "editor").length >= EDITOR_LIMIT)) return null; this.invites.delete(code); const grant = { id, recipientId: invite.recipientId, role: invite.role, tokenHash, createdAt: this.now() }; channel.access.set(id, grant); return { channel, grant }; }
  listAccess(channelCode) { return [...(this.channels.get(channelCode)?.access.values() || [])].map(({ tokenHash: _tokenHash, ...grant }) => grant); }
  accessFor(channel, hash) { if (channel.ownerHash === hash) return { id: "owner", role: "owner" }; return [...channel.access.values()].find(item => item.tokenHash === hash) || null; }
  updateAccess(channelCode, id, role) { const channel = this.channels.get(channelCode); const grant = channel?.access.get(id); if (!grant) return null; if (role === "editor" && grant.role !== "editor" && [...channel.access.values()].filter(item => item.role === "editor").length >= EDITOR_LIMIT) return false; grant.role = role; return { id: grant.id, recipientId: grant.recipientId, role: grant.role, createdAt: grant.createdAt }; }
  removeAccess(channelCode, id) { return this.channels.get(channelCode)?.access.delete(id) || false; }
  enableAccess(code) { const channel = this.channels.get(code); if (!channel) return false; channel.accessEnabled = true; return true; }
  cleanup() { for (const code of this.items.keys()) this.get(code); for (const [code, invite] of this.invites) if (invite.expiresAt <= this.now()) this.invites.delete(code); }
}

class SqliteShareStore {
  constructor(directory, { now = Date.now } = {}) {
    this.now = now;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(resolve(directory, "shares.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS pack_shares (code TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS pack_shares_expiry ON pack_shares(expires_at);");
    this.db.exec("CREATE TABLE IF NOT EXISTS pack_channels (code TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, revision INTEGER NOT NULL, owner_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, access_enabled INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS pack_channel_editors (channel_code TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, PRIMARY KEY(channel_code,token_hash)); CREATE TABLE IF NOT EXISTS pack_editor_invites (code TEXT PRIMARY KEY, channel_code TEXT NOT NULL, expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS pack_channel_access (id TEXT PRIMARY KEY, channel_code TEXT NOT NULL, recipient_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('member','editor')), token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS pack_channel_access_channel ON pack_channel_access(channel_code); CREATE TABLE IF NOT EXISTS pack_channel_access_invites (id TEXT PRIMARY KEY, channel_code TEXT NOT NULL, recipient_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('member','editor')), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS pack_channel_invites_channel ON pack_channel_access_invites(channel_code);");
    const channelColumns = this.db.prepare("PRAGMA table_info(pack_channels)").all().map(row => row.name);
    if (!channelColumns.includes("access_enabled")) this.db.exec("ALTER TABLE pack_channels ADD COLUMN access_enabled INTEGER NOT NULL DEFAULT 0");
  }
  put(code, manifest, expiresAt) { this.db.prepare("INSERT INTO pack_shares(code,manifest_json,created_at,expires_at) VALUES(?,?,?,?)").run(code, JSON.stringify(manifest), this.now(), expiresAt); }
  get(code) {
    const row = this.db.prepare("SELECT manifest_json,expires_at FROM pack_shares WHERE code=? AND expires_at>?").get(code, this.now());
    return row ? { manifest: JSON.parse(row.manifest_json), expiresAt: Number(row.expires_at) } : null;
  }
  has(code) { return Boolean(this.get(code)); }
  cleanup() { this.db.prepare("DELETE FROM pack_shares WHERE expires_at<=?").run(this.now()); this.db.prepare("DELETE FROM pack_channel_access_invites WHERE expires_at<=?").run(this.now()); }
  createChannel(code, manifest, tokenHash) { this.db.prepare("INSERT INTO pack_channels(code,manifest_json,revision,owner_hash,created_at,updated_at,access_enabled) VALUES(?,?,1,?,?,?,1)").run(code, JSON.stringify(manifest), tokenHash, this.now(), this.now()); }
  getChannel(code) { const row = this.db.prepare("SELECT code,manifest_json,revision,owner_hash,updated_at,access_enabled,(SELECT COUNT(*) FROM pack_channel_access WHERE channel_code=pack_channels.code AND role='editor')+(SELECT COUNT(*) FROM pack_channel_editors WHERE channel_code=pack_channels.code) AS editor_count FROM pack_channels WHERE code=?").get(code); return row ? { code: row.code, manifest: JSON.parse(row.manifest_json), revision: Number(row.revision), ownerHash: row.owner_hash, updatedAt: Number(row.updated_at), accessEnabled: Boolean(row.access_enabled), editorCount: Number(row.editor_count) } : null; }
  updateChannel(code, manifest) { this.db.prepare("UPDATE pack_channels SET manifest_json=?, revision=revision+1, updated_at=? WHERE code=?").run(JSON.stringify(manifest), this.now(), code); return this.getChannel(code); }
  createInvite(code, channelCode, recipientId, role, expiresAt) { this.db.prepare("INSERT INTO pack_channel_access_invites(id,channel_code,recipient_id,role,created_at,expires_at) VALUES(?,?,?,?,?,?)").run(code, channelCode, recipientId, role, this.now(), expiresAt); }
  hasInvite(code) { return Boolean(this.db.prepare("SELECT 1 FROM pack_channel_access_invites WHERE id=?").get(code)); }
  listInvites(channelCode) { return this.db.prepare("SELECT id,recipient_id AS recipientId,role,created_at AS createdAt,expires_at AS expiresAt FROM pack_channel_access_invites WHERE channel_code=? AND expires_at>? ORDER BY created_at").all(channelCode, this.now()).map(item => ({ ...item, createdAt: Number(item.createdAt), expiresAt: Number(item.expiresAt) })); }
  updateInviteRole(channelCode, id, role) { this.db.prepare("UPDATE pack_channel_access_invites SET role=? WHERE channel_code=? AND id=?").run(role, channelCode, id); return this.listInvites(channelCode).find(item => item.id === id) || null; }
  deleteInvite(channelCode, id) { return this.db.prepare("DELETE FROM pack_channel_access_invites WHERE channel_code=? AND id=?").run(channelCode, id).changes > 0; }
  deleteInviteByCode(id) { return this.db.prepare("DELETE FROM pack_channel_access_invites WHERE id=?").run(id).changes > 0; }
  redeemInvite(code, id, tokenHash) { const invite = this.db.prepare("SELECT channel_code,recipient_id,role FROM pack_channel_access_invites WHERE id=? AND expires_at>?").get(code, this.now()); if (!invite) return null; const count = Number(this.db.prepare("SELECT COUNT(*) AS count FROM pack_channel_access WHERE channel_code=?").get(invite.channel_code).count); const editors = Number(this.db.prepare("SELECT COUNT(*) AS count FROM pack_channel_access WHERE channel_code=? AND role='editor'").get(invite.channel_code).count); if (count >= MEMBER_LIMIT || (invite.role === "editor" && editors >= EDITOR_LIMIT)) return null; this.db.exec("BEGIN IMMEDIATE"); try { this.db.prepare("DELETE FROM pack_channel_access_invites WHERE id=?").run(code); this.db.prepare("INSERT INTO pack_channel_access(id,channel_code,recipient_id,role,token_hash,created_at) VALUES(?,?,?,?,?,?)").run(id, invite.channel_code, invite.recipient_id, invite.role, tokenHash, this.now()); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; } return { channel: this.getChannel(invite.channel_code), grant: { id, recipientId: invite.recipient_id, role: invite.role, createdAt: this.now() } }; }
  listAccess(channelCode) { return this.db.prepare("SELECT id,recipient_id AS recipientId,role,created_at AS createdAt FROM pack_channel_access WHERE channel_code=? ORDER BY created_at").all(channelCode).map(item => ({ ...item, createdAt: Number(item.createdAt) })); }
  accessFor(channel, hash) { if (channel.ownerHash === hash) return { id: "owner", role: "owner" }; const managed = this.db.prepare("SELECT id,recipient_id AS recipientId,role,created_at AS createdAt FROM pack_channel_access WHERE channel_code=? AND token_hash=?").get(channel.code, hash); if (managed) return managed; if (!channel.accessEnabled && this.db.prepare("SELECT 1 FROM pack_channel_editors WHERE channel_code=? AND token_hash=?").get(channel.code, hash)) return { id: "legacy-editor", role: "editor" }; return null; }
  updateAccess(channelCode, id, role) { const grant = this.db.prepare("SELECT role FROM pack_channel_access WHERE channel_code=? AND id=?").get(channelCode, id); if (!grant) return null; if (role === "editor" && grant.role !== "editor") { const editors = Number(this.db.prepare("SELECT COUNT(*) AS count FROM pack_channel_access WHERE channel_code=? AND role='editor'").get(channelCode).count); if (editors >= EDITOR_LIMIT) return false; } this.db.prepare("UPDATE pack_channel_access SET role=? WHERE channel_code=? AND id=?").run(role, channelCode, id); return this.listAccess(channelCode).find(item => item.id === id); }
  removeAccess(channelCode, id) { return this.db.prepare("DELETE FROM pack_channel_access WHERE channel_code=? AND id=?").run(channelCode, id).changes > 0; }
  enableAccess(code) { return this.db.prepare("UPDATE pack_channels SET access_enabled=1 WHERE code=?").run(code).changes > 0; }
}

const makeCode = () => Array.from(randomBytes(8), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
const makeToken = () => randomBytes(32).toString("base64url");
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const bearer = (request) => /^Bearer ([A-Za-z0-9_-]{40,80})$/.exec(String(request.headers.authorization || ""))?.[1] || null;

export function createSharingApi({ store = new MemoryShareStore(), now = Date.now, ttlMs = DEFAULT_TTL_MS, publicUrl = "https://api.north.bloomclient.org/minecraft", codeFactory = makeCode, onInviteInvalidated = () => {} } = {}) {
  const requests = new Map();
  const allowCreate = (request) => {
    const key = String(request.headers["cf-connecting-ip"] || request.socket?.remoteAddress || "unknown");
    const cutoff = now() - RATE_WINDOW_MS;
    const recent = (requests.get(key) || []).filter(value => value > cutoff);
    if (recent.length >= RATE_LIMIT) return false;
    recent.push(now()); requests.set(key, recent); return true;
  };
  return {
    async handle(request, response, pathname) {
      if (!/^\/v1\/(?:packs|pack-channels)(?:\/|$)/.test(pathname)) return false;
      try {
        if (pathname === "/v1/pack-channels" && request.method === "POST") {
          if (!allowCreate(request)) throw new ShareError(429, "share_rate_limited");
          const manifest = validateShareManifest(await readJson(request));
          let code = ""; for (let attempt = 0; attempt < 8; attempt += 1) { code = codeFactory(); if (!store.getChannel(code) && !store.has(code)) break; }
          const ownerToken = makeToken(); store.createChannel(code, manifest, tokenHash(ownerToken));
          return json(response, 201, { code, url: `${publicUrl.replace(/\/$/, "")}/v1/pack-channels/${code}`, ownerToken, revision: 1, editorCount: 0 });
        }
        if (pathname === "/v1/pack-channels/invites/redeem" && request.method === "POST") {
          const body = await readJson(request); const inviteCode = String(body?.code || "").toUpperCase();
          const accessToken = makeToken(); const redeemed = store.redeemInvite(inviteCode, randomBytes(12).toString("base64url"), tokenHash(accessToken));
          if (!redeemed) throw new ShareError(404, "pack_invite_invalid");
          return json(response, 200, { code: redeemed.channel.code, accessToken, role: redeemed.grant.role, revision: redeemed.channel.revision, manifest: redeemed.channel.manifest });
        }
        const channelMatch = pathname.match(/^\/v1\/pack-channels\/([23456789A-HJ-NP-Z]{8})$/);
        const accessMatch = pathname.match(/^\/v1\/pack-channels\/([23456789A-HJ-NP-Z]{8})\/access$/);
        const accessItemMatch = pathname.match(/^\/v1\/pack-channels\/([23456789A-HJ-NP-Z]{8})\/access\/([A-Za-z0-9_-]{12,32})$/);
        const inviteMatch = pathname.match(/^\/v1\/pack-channels\/([23456789A-HJ-NP-Z]{8})\/invites$/);
        const inviteItemMatch = pathname.match(/^\/v1\/pack-channels\/([23456789A-HJ-NP-Z]{8})\/invites\/([23456789A-HJ-NP-Z]{8})$/);
        const enableMatch = pathname.match(/^\/v1\/pack-channels\/([23456789A-HJ-NP-Z]{8})\/access\/enable$/);
        const requireOwner = (code, request) => { const channel = store.getChannel(code); const token = bearer(request); if (!channel || !token || tokenHash(token) !== channel.ownerHash) throw new ShareError(403, "owner_required"); return channel; };
        if (enableMatch && request.method === "POST") { const channel = requireOwner(enableMatch[1], request); store.enableAccess(channel.code); return json(response, 200, { enabled: true }); }
        if (accessMatch && request.method === "GET") {
          const channel = requireOwner(accessMatch[1], request);
          return json(response, 200, { accessEnabled: channel.accessEnabled, members: store.listAccess(channel.code), invites: store.listInvites(channel.code) });
        }
        if (inviteMatch && request.method === "POST") {
          const channel = requireOwner(inviteMatch[1], request); if (!channel.accessEnabled) throw new ShareError(409, "managed_access_required");
          const body = await readJson(request); const recipientId = String(body?.recipientId || ""); const role = String(body?.role || "");
          if (!/^[0-9A-Za-z_-]{8,128}$/.test(recipientId) || !["member", "editor"].includes(role)) throw new ShareError(400, "invalid_pack_invite");
          const access = store.listAccess(channel.code); const pending = store.listInvites(channel.code);
          if (access.some(item => item.recipientId === recipientId)) throw new ShareError(409, "recipient_already_has_access");
          const existing = pending.find(item => item.recipientId === recipientId);
          if (existing) {
            if (role === "editor" && existing.role !== "editor" && access.filter(item => item.role === "editor").length + pending.filter(item => item.role === "editor").length >= EDITOR_LIMIT) throw new ShareError(409, "editor_limit_reached");
            const updated = existing.role === role ? existing : store.updateInviteRole(channel.code, existing.id, role);
            return json(response, 200, { code: updated.id, id: updated.id, recipientId, role: updated.role, expiresAt: new Date(updated.expiresAt).toISOString() });
          }
          if (access.length + pending.length >= MEMBER_LIMIT) throw new ShareError(409, "member_limit_reached");
          if (role === "editor" && access.filter(item => item.role === "editor").length + pending.filter(item => item.role === "editor").length >= EDITOR_LIMIT) throw new ShareError(409, "editor_limit_reached");
          let code = ""; for (let attempt = 0; attempt < 8; attempt += 1) { code = codeFactory(); if (!store.hasInvite(code)) break; }
          if (!code || store.hasInvite(code)) throw new ShareError(503, "invite_code_unavailable");
          const expiresAt = now() + ACCESS_INVITE_TTL_MS; store.createInvite(code, channel.code, recipientId, role, expiresAt);
          return json(response, 201, { code, id: code, recipientId, role, expiresAt: new Date(expiresAt).toISOString() });
        }
        if (inviteItemMatch && request.method === "DELETE") { const channel = requireOwner(inviteItemMatch[1], request); if (!store.deleteInvite(channel.code, inviteItemMatch[2])) throw new ShareError(404, "pack_invite_not_found"); onInviteInvalidated(inviteItemMatch[2]); return json(response, 200, { removed: true }); }
        if (accessItemMatch && request.method === "PATCH") {
          const channel = requireOwner(accessItemMatch[1], request); const body = await readJson(request); const role = String(body?.role || ""); if (!["member", "editor"].includes(role)) throw new ShareError(400, "invalid_pack_role");
          const current = store.listAccess(channel.code).find(item => item.id === accessItemMatch[2]);
          if (role === "editor" && current?.role !== "editor" && store.listAccess(channel.code).filter(item => item.role === "editor").length + store.listInvites(channel.code).filter(item => item.role === "editor").length >= EDITOR_LIMIT) throw new ShareError(409, "editor_limit_reached");
          const updated = store.updateAccess(channel.code, accessItemMatch[2], role); if (updated === false) throw new ShareError(409, "editor_limit_reached"); if (!updated) throw new ShareError(404, "pack_access_not_found"); return json(response, 200, updated);
        }
        if (accessItemMatch && request.method === "DELETE") { const channel = requireOwner(accessItemMatch[1], request); if (!store.removeAccess(channel.code, accessItemMatch[2])) throw new ShareError(404, "pack_access_not_found"); return json(response, 200, { removed: true }); }
        if (channelMatch && request.method === "GET") {
          const channel = store.getChannel(channelMatch[1]); if (!channel) throw new ShareError(404, "pack_channel_not_found");
          const token = bearer(request); const access = token ? store.accessFor(channel, tokenHash(token)) : null;
          if (channel.accessEnabled && !access) throw new ShareError(403, "pack_access_revoked");
          return json(response, 200, { code: channel.code, revision: channel.revision, updatedAt: new Date(channel.updatedAt).toISOString(), editorCount: channel.editorCount, role: access?.role || "member", manifest: channel.manifest }, "private, max-age=15");
        }
        if (channelMatch && request.method === "PUT") {
          const channel = store.getChannel(channelMatch[1]); const token = bearer(request);
          const access = channel && token ? store.accessFor(channel, tokenHash(token)) : null;
          if (!channel || !access || !["owner", "editor"].includes(access.role)) throw new ShareError(403, "editor_required");
          const body = await readJson(request); if (body.baseRevision !== channel.revision) throw new ShareError(409, "pack_revision_conflict");
          const manifest = validateShareManifest(body.manifest); if (manifest.minecraftVersion !== channel.manifest.minecraftVersion || manifest.loaderVersion !== channel.manifest.loaderVersion) throw new ShareError(400, "pack_runtime_locked");
          const updated = store.updateChannel(channel.code, manifest); return json(response, 200, { code: channel.code, revision: updated.revision, updatedAt: new Date(updated.updatedAt).toISOString() });
        }
        if (pathname === "/v1/packs" && request.method === "POST") {
          if (!allowCreate(request)) throw new ShareError(429, "share_rate_limited");
          const manifest = validateShareManifest(await readJson(request));
          let code = "";
          for (let attempt = 0; attempt < 8; attempt += 1) { code = codeFactory(); if (!store.has(code)) break; }
          if (!code || store.has(code)) throw new ShareError(503, "share_code_unavailable");
          const expiresAt = now() + ttlMs;
          store.put(code, manifest, expiresAt);
          return json(response, 201, { code, url: `${publicUrl.replace(/\/$/, "")}/v1/packs/${code}`, expiresAt: new Date(expiresAt).toISOString() });
        }
        const match = pathname.match(/^\/v1\/packs\/([23456789A-HJ-NP-Z]{8})$/);
        if (match && request.method === "GET") {
          const item = store.get(match[1]);
          if (!item) throw new ShareError(404, "share_not_found");
          return json(response, 200, { code: match[1], expiresAt: new Date(item.expiresAt).toISOString(), manifest: item.manifest }, "public, max-age=60");
        }
        response.setHeader("allow", pathname === "/v1/packs" ? "POST" : "GET");
        throw new ShareError(405, "method_not_allowed");
      } catch (error) {
        return json(response, error instanceof ShareError ? error.status : 503, { error: error instanceof ShareError ? error.message : "sharing_unavailable" });
      }
    },
    checkReadiness() { store.cleanup(); return true; },
    invalidateInvite(code) { return store.deleteInviteByCode(String(code || "").toUpperCase()); },
  };
}

export function sharingFromEnvironment(env = process.env, options = {}) {
  const store = env.BLOOM_SHARE_DATA_DIR ? new SqliteShareStore(env.BLOOM_SHARE_DATA_DIR) : new MemoryShareStore();
  return createSharingApi({ store, publicUrl: env.BLOOM_SHARE_PUBLIC_URL || "https://api.north.bloomclient.org/minecraft", ...options });
}

export { MemoryShareStore, SqliteShareStore };
