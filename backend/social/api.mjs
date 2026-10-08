import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fromNodeHeaders } from "better-auth/node";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const sendJson = (response, status, body) => {
  const payload = JSON.stringify(body);
  response.writeHead(status, { ...jsonHeaders, "content-length": Buffer.byteLength(payload) });
  response.end(payload);
};

const readBody = async (request, limit = 96 * 1024) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("request_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
};

const readBytes = async (request, limit) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("request_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const uuid = () => crypto.randomUUID();
const now = () => Date.now();
const MESSAGE_RETENTION_MS = 24 * 60 * 60_000;
const PINNED_BLOB_EXPIRY = 253402300799000;
const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const validUsername = (value) => /^[A-Za-z0-9_]{3,20}$/.test(value);
const validKey = (value) => typeof value === "string" && value.length >= 20 && value.length <= 512;
const validDeviceId = (value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const validCursor = (value) => Math.max(0, Number(value) || 0);
const validNativeRequest = (challenge, state) => /^[A-Za-z0-9_-]{43,128}$/.test(challenge)
  && /^[A-Za-z0-9_-]{32,160}$/.test(state);
const validLoopbackPort = (port) => Number.isInteger(port) && port >= 1024 && port <= 65535;
const safeAvatarUrl = (value) => {
  try {
    const parsed = new URL(typeof value === "string" ? value : "");
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && parsed.href.length <= 2048 ? parsed.href : null;
  } catch { return null; }
};

const canonicalPair = (first, second) => first < second ? [first, second] : [second, first];
const publicUser = (row) => row && ({
  id: row.id,
  username: row.username,
  displayName: row.display_name || row.username,
  minecraftUuid: row.minecraft_uuid || null,
  minecraftUsername: row.minecraft_username || null,
  avatarUrl: row.avatar_url || null,
  provider: row.provider || null,
});

function initializeSchema(database) {
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS social_users (
      id TEXT PRIMARY KEY,
      account_user_id TEXT NOT NULL UNIQUE,
      username TEXT,
      username_lower TEXT UNIQUE,
      display_name TEXT,
      avatar_url TEXT,
      provider TEXT,
      minecraft_uuid TEXT,
      minecraft_username TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS social_native_codes (
      code_hash TEXT PRIMARY KEY,
      account_user_id TEXT NOT NULL,
      challenge TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      provider TEXT,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS social_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      curve25519_key TEXT NOT NULL,
      ed25519_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS social_one_time_prekeys (
      device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
      key_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      claimed_at INTEGER,
      PRIMARY KEY(device_id, key_id)
    );
    CREATE TABLE IF NOT EXISTS social_sessions (
      access_hash TEXT PRIMARY KEY,
      refresh_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
      access_expires_at INTEGER NOT NULL,
      refresh_expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS social_friendships (
      user_low TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      user_high TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
      requested_by TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_low, user_high)
    );
    CREATE TABLE IF NOT EXISTS social_blocks (
      blocker_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(blocker_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS social_conversations (
      id TEXT PRIMARY KEY,
      user_low TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      user_high TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_low, user_high)
    );
    CREATE TABLE IF NOT EXISTS social_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS social_group_members (
      group_id TEXT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      added_by TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY(group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS social_group_envelopes (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      sender_device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      recipient_device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
      client_nonce TEXT NOT NULL,
      event_kind TEXT NOT NULL CHECK(event_kind IN ('message','reaction','security','pin','edit')),
      ciphertext TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(sender_device_id, client_nonce, recipient_device_id)
    );
    CREATE TABLE IF NOT EXISTS social_envelopes (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES social_conversations(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      sender_device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      recipient_device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
      client_nonce TEXT NOT NULL,
      event_kind TEXT NOT NULL CHECK(event_kind IN ('message','reaction','security','pin','edit')),
      ciphertext TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(sender_device_id, client_nonce, recipient_device_id)
    );
    CREATE TABLE IF NOT EXISTS social_read_cursors (
      conversation_id TEXT NOT NULL REFERENCES social_conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      last_read_sequence INTEGER NOT NULL,
      PRIMARY KEY(conversation_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS social_blobs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      ciphertext_size INTEGER NOT NULL,
      ciphertext_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS social_instance_invites (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL,
      share_code TEXT NOT NULL,
      share_mode TEXT NOT NULL CHECK(share_mode IN ('copy','synced')),
      role TEXT NOT NULL CHECK(role IN ('member','editor')),
      instance_name TEXT NOT NULL,
      minecraft_version TEXT NOT NULL,
      loader TEXT NOT NULL,
      icon_data_url TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending','installing','accepted','declined','revoked','expired')),
      claim_hash TEXT,
      claim_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE(sender_id, request_key, recipient_id)
    );
    CREATE INDEX IF NOT EXISTS social_blob_expiry ON social_blobs(expires_at);
    CREATE INDEX IF NOT EXISTS social_friend_low ON social_friendships(user_low, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS social_friend_high ON social_friendships(user_high, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS social_envelope_recipient ON social_envelopes(recipient_device_id, sequence);
    CREATE INDEX IF NOT EXISTS social_conversation_updated ON social_conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS social_group_member_user ON social_group_members(user_id, joined_at DESC);
    CREATE INDEX IF NOT EXISTS social_group_updated ON social_groups(updated_at DESC);
    CREATE INDEX IF NOT EXISTS social_group_envelope_recipient ON social_group_envelopes(recipient_device_id, sequence);
    CREATE INDEX IF NOT EXISTS social_prekeys_available ON social_one_time_prekeys(device_id, claimed_at);
    CREATE INDEX IF NOT EXISTS social_instance_invite_recipient ON social_instance_invites(recipient_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS social_instance_invite_sender ON social_instance_invites(sender_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS social_instance_invite_expiry ON social_instance_invites(status, expires_at);
  `);
  const addColumn = (table, definition) => {
    const name = definition.split(/\s+/, 1)[0];
    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((column) => column.name === name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  };
  addColumn("social_users", "avatar_url TEXT");
  addColumn("social_users", "provider TEXT");
  addColumn("social_native_codes", "display_name TEXT");
  addColumn("social_native_codes", "avatar_url TEXT");
  addColumn("social_native_codes", "provider TEXT");
  addColumn("social_native_codes", "denied_at INTEGER");
  addColumn("social_groups", "icon_data_url TEXT");
  addColumn("social_instance_invites", "icon_data_url TEXT");
  const migrateEnvelopeKinds = (table, group) => {
    const schema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql || "";
    if (schema.includes("'pin'") && schema.includes("'edit'")) return;
    const legacy = `${table}_before_pins`;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`ALTER TABLE ${table} RENAME TO ${legacy}`);
      database.exec(group ? `CREATE TABLE ${table} (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
        sender_device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
        recipient_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
        recipient_device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
        client_nonce TEXT NOT NULL,
        event_kind TEXT NOT NULL CHECK(event_kind IN ('message','reaction','security','pin','edit')),
        ciphertext TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(sender_device_id, client_nonce, recipient_device_id)
      )` : `CREATE TABLE ${table} (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES social_conversations(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
        sender_device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
        recipient_id TEXT NOT NULL REFERENCES social_users(id) ON DELETE CASCADE,
        recipient_device_id TEXT NOT NULL REFERENCES social_devices(id) ON DELETE CASCADE,
        client_nonce TEXT NOT NULL,
        event_kind TEXT NOT NULL CHECK(event_kind IN ('message','reaction','security','pin','edit')),
        ciphertext TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(sender_device_id, client_nonce, recipient_device_id)
      )`);
      const columns = group ? "sequence, group_id, sender_id, sender_device_id, recipient_id, recipient_device_id, client_nonce, event_kind, ciphertext, created_at" : "sequence, conversation_id, sender_id, sender_device_id, recipient_id, recipient_device_id, client_nonce, event_kind, ciphertext, created_at";
      database.exec(`INSERT INTO ${table}(${columns}) SELECT ${columns} FROM ${legacy}`);
      database.exec(`DROP TABLE ${legacy}`);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  migrateEnvelopeKinds("social_envelopes", false);
  migrateEnvelopeKinds("social_group_envelopes", true);
  database.exec("CREATE INDEX IF NOT EXISTS social_envelope_recipient ON social_envelopes(recipient_device_id, sequence); CREATE INDEX IF NOT EXISTS social_group_envelope_recipient ON social_group_envelopes(recipient_device_id, sequence);");
}

export function createSocialApi({ auth, database: accountDatabase, siteOrigin, env = process.env, onInstanceInviteClosed = () => {} } = {}) {
  const dataDirectory = path.resolve(env.BLOOM_SOCIAL_DATA_DIR || env.BLOOM_AUTH_DATA_DIR || path.join(process.cwd(), ".bloom-auth"));
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path.join(dataDirectory, "social.sqlite"));
  initializeSchema(database);
  const blobDirectory = path.join(dataDirectory, "social-blobs");
  fs.mkdirSync(blobDirectory, { recursive: true, mode: 0o700 });
  let lastRetentionSweep = 0;
  const purgeExpiredData = (force = false) => {
    const timestamp = now();
    if (!force && timestamp - lastRetentionSweep < 60_000) return;
    lastRetentionSweep = timestamp;
    const cutoff = timestamp - MESSAGE_RETENTION_MS;
    database.prepare("DELETE FROM social_envelopes WHERE event_kind IN ('message','reaction','edit') AND created_at <= ?").run(cutoff);
    database.prepare("DELETE FROM social_group_envelopes WHERE event_kind IN ('message','reaction','edit') AND created_at <= ?").run(cutoff);
    const expiredBlobs = database.prepare("SELECT id FROM social_blobs WHERE expires_at <= ?").all(timestamp);
    database.prepare("DELETE FROM social_blobs WHERE expires_at <= ?").run(timestamp);
    for (const blob of expiredBlobs) {
      try { fs.unlinkSync(path.join(blobDirectory, `${blob.id}.bin`)); }
      catch (error) { if (error?.code !== "ENOENT") console.error("Social blob cleanup failed", error?.message || error); }
    }
  };
  purgeExpiredData(true);
  const retentionTimer = setInterval(() => {
    try { purgeExpiredData(true); }
    catch (error) { console.error("Social retention cleanup failed", error?.message || error); }
  }, 5 * 60_000);
  retentionTimer.unref?.();
  const rateBuckets = new Map();
  const allowRate = (key, maximum, windowMs, idempotencyKey = null) => {
    const timestamp = now();
    const current = (rateBuckets.get(key) || []).filter((value) => value.at > timestamp - windowMs);
    if (idempotencyKey && current.some((value) => value.idempotencyKey === idempotencyKey)) {
      rateBuckets.set(key, current);
      return true;
    }
    if (current.length >= maximum) { rateBuckets.set(key, current); return false; }
    current.push({ at: timestamp, idempotencyKey });
    rateBuckets.set(key, current);
    return true;
  };

  // Realtime delivery uses short-lived long polls as event hints. The cursor is
  // derived from durable database state, so a restart, missed wake-up, or
  // disconnected client always falls back to an authoritative reconciliation.
  const changeWaiters = new Map();
  const signalUsers = (userIds, scope = "all") => {
    for (const userId of new Set(userIds.filter(Boolean))) {
      const listeners = changeWaiters.get(userId);
      if (!listeners) continue;
      for (const listener of [...listeners]) listener(scope);
    }
  };
  const socialCursor = (session) => {
    const friendships = database.prepare(`SELECT user_low, user_high, status, requested_by, updated_at
      FROM social_friendships WHERE user_low = ? OR user_high = ? ORDER BY user_low, user_high`).all(session.user_id, session.user_id);
    const blocks = database.prepare(`SELECT blocker_id, blocked_id, created_at FROM social_blocks
      WHERE blocker_id = ? OR blocked_id = ? ORDER BY blocker_id, blocked_id`).all(session.user_id, session.user_id);
    const groups = database.prepare(`SELECT g.id, g.name, LENGTH(g.icon_data_url) icon_size, g.owner_id, member.user_id
      FROM social_group_members viewer JOIN social_groups g ON g.id = viewer.group_id
      JOIN social_group_members member ON member.group_id = g.id
      WHERE viewer.user_id = ? ORDER BY g.id, member.user_id`).all(session.user_id);
    const invites = database.prepare(`SELECT id, status, updated_at FROM social_instance_invites
      WHERE sender_id = ? OR recipient_id = ? ORDER BY id`).all(session.user_id, session.user_id);
    const profiles = database.prepare(`SELECT id, username, display_name, avatar_url, updated_at FROM social_users u
      WHERE u.id = ? OR EXISTS (
        SELECT 1 FROM social_friendships f WHERE f.status = 'accepted'
        AND (f.user_low = ? OR f.user_high = ?)
        AND (f.user_low = u.id OR f.user_high = u.id)
      ) OR EXISTS (
        SELECT 1 FROM social_group_members mine JOIN social_group_members theirs ON theirs.group_id = mine.group_id
        WHERE mine.user_id = ? AND theirs.user_id = u.id
      ) ORDER BY id`).all(session.user_id, session.user_id, session.user_id, session.user_id);
    const devices = database.prepare(`SELECT d.user_id, d.id, d.curve25519_key, d.ed25519_key, d.revoked_at
      FROM social_devices d WHERE d.user_id IN (${profiles.map(() => "?").join(",") || "?"})
      ORDER BY d.user_id, d.id`).all(...(profiles.length ? profiles.map((profile) => profile.id) : [session.user_id]));
    const direct = database.prepare("SELECT COALESCE(MAX(sequence), 0) sequence, COUNT(*) count FROM social_envelopes WHERE recipient_device_id = ?").get(session.device_id);
    const grouped = database.prepare("SELECT COALESCE(MAX(sequence), 0) sequence, COUNT(*) count FROM social_group_envelopes WHERE recipient_device_id = ?").get(session.device_id);
    return hash(JSON.stringify({ friendships, blocks, groups, invites, profiles, devices, direct, grouped }));
  };
  const waitForSocialChange = (request, session, after, waitMs) => new Promise((resolve) => {
    let settled = false;
    let timer;
    const listeners = changeWaiters.get(session.user_id) || new Set();
    changeWaiters.set(session.user_id, listeners);
    const finish = (scope = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      listeners.delete(onSignal);
      if (!listeners.size) changeWaiters.delete(session.user_id);
      const cursor = socialCursor(session);
      const changed = Boolean(scope) || cursor !== after;
      resolve({ cursor, changed, scopes: changed ? [scope || "all"] : [] });
    };
    const onSignal = (scope) => finish(scope);
    listeners.add(onSignal);
    // Register before checking to close the mutation-between-check-and-wait race.
    if (socialCursor(session) !== after) { finish("all"); return; }
    timer = setTimeout(() => finish(), waitMs);
    request.once("aborted", () => finish());
  });

  const sessionForBrowser = (request) => auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  const findUser = database.prepare("SELECT * FROM social_users WHERE id = ?");
  const findUserByAccount = database.prepare("SELECT * FROM social_users WHERE account_user_id = ?");
  const findUserByName = database.prepare("SELECT * FROM social_users WHERE username_lower = ?");
  const findDevice = database.prepare("SELECT * FROM social_devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL");

  const availableUsername = (displayName, accountUserId) => {
    const clean = String(displayName || "").normalize("NFKD").replace(/[^A-Za-z0-9_]/g, "").slice(0, 20);
    const base = clean.length >= 3 ? clean : "BloomUser";
    if (!findUserByName.get(base.toLowerCase())) return base;
    const suffix = hash(accountUserId).slice(0, 4);
    return `${base.slice(0, 15)}_${suffix}`;
  };

  const ensureSocialUser = (accountUserId, profile = {}) => {
    let user = findUserByAccount.get(accountUserId);
    if (!user) {
      const timestamp = now();
      const id = uuid();
      const displayName = text(profile.displayName, 80) || "Bloom user";
      const username = availableUsername(displayName, accountUserId);
      database.prepare("INSERT INTO social_users(id, account_user_id, username, username_lower, display_name, avatar_url, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, accountUserId, username, username.toLowerCase(), displayName, safeAvatarUrl(profile.avatarUrl), text(profile.provider, 32) || null, timestamp, timestamp);
      user = findUser.get(id);
    } else {
      const displayName = text(profile.displayName, 80) || user.display_name || user.username || "Bloom user";
      const username = user.username || availableUsername(displayName, accountUserId);
      database.prepare("UPDATE social_users SET username = ?, username_lower = ?, display_name = ?, avatar_url = COALESCE(?, avatar_url), provider = COALESCE(?, provider), updated_at = ? WHERE id = ?")
        .run(username, username.toLowerCase(), displayName, safeAvatarUrl(profile.avatarUrl), text(profile.provider, 32) || null, now(), user.id);
      user = findUser.get(user.id);
    }
    return user;
  };

  const refreshAccountProfile = (user) => {
    if (!user || !accountDatabase) return user;
    const accountUser = accountDatabase.prepare("SELECT name, image FROM user WHERE id = ?").get(user.account_user_id);
    if (!accountUser) return user;
    const account = accountDatabase.prepare("SELECT providerId FROM account WHERE userId = ? AND providerId IN ('google', 'github') ORDER BY createdAt LIMIT 1").get(user.account_user_id);
    return ensureSocialUser(user.account_user_id, {
      displayName: accountUser.name,
      avatarUrl: accountUser.image,
      provider: account?.providerId || null,
    });
  };

  const bearerSession = (request) => {
    const authorization = request.headers.authorization || "";
    if (!authorization.startsWith("Bearer ")) return null;
    const row = database.prepare(`
      SELECT s.*, u.username, u.display_name, u.minecraft_uuid, u.minecraft_username
      FROM social_sessions s JOIN social_users u ON u.id = s.user_id
      WHERE s.access_hash = ? AND s.revoked_at IS NULL AND s.access_expires_at > ?
    `).get(hash(authorization.slice(7)), now());
    if (row) database.prepare("UPDATE social_sessions SET last_used_at = ? WHERE access_hash = ?").run(now(), row.access_hash);
    return row || null;
  };

  const requireSession = (request, response) => {
    const session = bearerSession(request);
    if (!session) sendJson(response, 401, { error: "not_authenticated" });
    return session;
  };

  const friendship = (first, second) => {
    const [low, high] = canonicalPair(first, second);
    return database.prepare("SELECT * FROM social_friendships WHERE user_low = ? AND user_high = ?").get(low, high);
  };
  const isBlocked = (first, second) => Boolean(database.prepare("SELECT 1 FROM social_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)").get(first, second, second, first));
  const acceptedFriends = (first, second) => friendship(first, second)?.status === "accepted" && !isBlocked(first, second);
  const groupMember = (groupId, userId) => database.prepare("SELECT * FROM social_group_members WHERE group_id = ? AND user_id = ?").get(groupId, userId);
  const groupUserIds = (groupId) => database.prepare("SELECT user_id FROM social_group_members WHERE group_id = ?").all(groupId).map((row) => row.user_id);
  const identityAudience = (userId) => database.prepare(`SELECT DISTINCT user_id FROM (
    SELECT CASE WHEN user_low = ? THEN user_high ELSE user_low END user_id
      FROM social_friendships WHERE status = 'accepted' AND (user_low = ? OR user_high = ?)
    UNION SELECT other.user_id FROM social_group_members mine
      JOIN social_group_members other ON other.group_id = mine.group_id
      WHERE mine.user_id = ? AND other.user_id != ?
  )`).all(userId, userId, userId, userId, userId).map((row) => row.user_id);
  const sharedGroup = (first, second) => Boolean(database.prepare(`SELECT 1 FROM social_group_members a
    JOIN social_group_members b ON b.group_id = a.group_id WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`).get(first, second));
  const publicGroup = (group, viewerId) => ({
    id: group.id,
    name: group.name,
    iconDataUrl: group.icon_data_url || null,
    ownerId: group.owner_id,
    updatedAt: group.updated_at,
    members: database.prepare(`SELECT u.* FROM social_group_members m JOIN social_users u ON u.id = m.user_id
      WHERE m.group_id = ? ORDER BY CASE WHEN u.id = ? THEN 0 ELSE 1 END, lower(u.username)`).all(group.id, group.owner_id).map(publicUser),
    canManage: group.owner_id === viewerId,
  });
  const publicInstanceInvite = (invite) => ({
    id: invite.id,
    sender: publicUser(findUser.get(invite.sender_id)),
    recipient: publicUser(findUser.get(invite.recipient_id)),
    shareMode: invite.share_mode,
    role: invite.role,
    instanceName: invite.instance_name,
    minecraftVersion: invite.minecraft_version,
    loader: invite.loader,
    iconDataUrl: invite.icon_data_url || null,
    status: invite.status,
    createdAt: invite.created_at,
    updatedAt: invite.updated_at,
    expiresAt: invite.expires_at,
  });
  const conversationFor = (first, second) => {
    const [low, high] = canonicalPair(first, second);
    let row = database.prepare("SELECT * FROM social_conversations WHERE user_low = ? AND user_high = ?").get(low, high);
    if (!row) {
      const timestamp = now();
      const id = uuid();
      database.prepare("INSERT INTO social_conversations(id, user_low, user_high, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, low, high, timestamp, timestamp);
      row = database.prepare("SELECT * FROM social_conversations WHERE id = ?").get(id);
    }
    return row;
  };

  const issueTokens = (userId, deviceId) => {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(48);
    const timestamp = now();
    const accessExpiresAt = timestamp + 15 * 60_000;
    const refreshExpiresAt = timestamp + 30 * 24 * 60 * 60_000;
    database.prepare("INSERT INTO social_sessions(access_hash, refresh_hash, user_id, device_id, access_expires_at, refresh_expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(hash(accessToken), hash(refreshToken), userId, deviceId, accessExpiresAt, refreshExpiresAt, timestamp, timestamp);
    return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
  };

  return {
    database,
    purgeExpiredData,
    invalidateInstanceInviteByShareCode(code) {
      const invites = database.prepare("SELECT sender_id,recipient_id FROM social_instance_invites WHERE share_code=? AND status IN ('pending','installing')").all(code);
      if (!invites.length) return false;
      database.prepare("UPDATE social_instance_invites SET status='revoked',claim_hash=NULL,claim_expires_at=NULL,updated_at=? WHERE share_code=? AND status IN ('pending','installing')").run(now(), code);
      signalUsers(invites.flatMap(invite => [invite.sender_id, invite.recipient_id]), "invites");
      return true;
    },
    async handle(request, response, pathname, url) {
      purgeExpiredData();
      if (!pathname.startsWith("/v1/social/")) return false;
      try {
        if (pathname === "/v1/social/native/authorize" && request.method === "GET") {
          const challenge = text(url.searchParams.get("challenge"), 160);
          const state = text(url.searchParams.get("state"), 160);
          const suppliedPort = url.searchParams.get("port");
          const port = suppliedPort === null ? null : Number(suppliedPort);
          if (!validNativeRequest(challenge, state) || (port !== null && !validLoopbackPort(port))) {
            sendJson(response, 400, { error: "invalid_authorization_request" }); return true;
          }
          const approval = new URL("/connect/", siteOrigin);
          approval.searchParams.set("challenge", challenge);
          approval.searchParams.set("state", state);
          if (port !== null) approval.searchParams.set("port", String(port));
          response.writeHead(302, { location: approval.href, "cache-control": "no-store", "referrer-policy": "no-referrer" });
          response.end(); return true;
        }

        if (pathname === "/v1/social/native/approve" && request.method === "POST") {
          if (request.headers.origin !== siteOrigin) { sendJson(response, 403, { error: "invalid_origin" }); return true; }
          const body = await readBody(request);
          const challenge = text(body.challenge, 160);
          const state = text(body.state, 160);
          const port = body.port === null || body.port === undefined ? null : Number(body.port);
          if (!validNativeRequest(challenge, state) || (port !== null && !validLoopbackPort(port))) { sendJson(response, 400, { error: "invalid_authorization_request" }); return true; }
          const browserSession = await sessionForBrowser(request);
          if (!browserSession) { sendJson(response, 401, { error: "not_authenticated" }); return true; }
          const accounts = await auth.api.listUserAccounts({ headers: fromNodeHeaders(request.headers) });
          const provider = accounts.find((account) => account.providerId === "google" || account.providerId === "github")?.providerId || null;
          const socialUser = ensureSocialUser(browserSession.user.id, {
            displayName: browserSession.user.name,
            avatarUrl: browserSession.user.image,
            provider,
          });
          // New clients use the high-entropy state itself as the one-time code and
          // poll over HTTPS. Legacy loopback clients still receive a separate code.
          const code = port === null ? state : randomToken(32);
          database.prepare(`INSERT INTO social_native_codes(code_hash, account_user_id, challenge, display_name, avatar_url, provider, expires_at, used_at, denied_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
            ON CONFLICT(code_hash) DO NOTHING`)
            .run(hash(code), browserSession.user.id, challenge, text(browserSession.user.name, 80) || "Bloom user", safeAvatarUrl(browserSession.user.image), provider, now() + 5 * 60_000);
          if (port === null) { sendJson(response, 200, { approved: true }); return true; }
          const callback = new URL(`http://127.0.0.1:${port}/callback`);
          callback.searchParams.set("code", code);
          callback.searchParams.set("state", state);
          callback.searchParams.set("profile", socialUser.id);
          sendJson(response, 200, { callbackUrl: callback.href, approved: true }); return true;
        }

        if (pathname === "/v1/social/native/status" && request.method === "POST") {
          const body = await readBody(request);
          const challenge = text(body.challenge, 160);
          const state = text(body.state, 160);
          if (!validNativeRequest(challenge, state)) { sendJson(response, 400, { error: "invalid_authorization_request" }); return true; }
          const authorization = database.prepare("SELECT * FROM social_native_codes WHERE code_hash = ? AND expires_at > ?").get(hash(state), now());
          if (!authorization) { sendJson(response, 202, { status: "pending" }); return true; }
          if (authorization.challenge !== challenge) { sendJson(response, 400, { error: "invalid_authorization_request" }); return true; }
          if (authorization.denied_at) { sendJson(response, 403, { error: "access_denied" }); return true; }
          if (authorization.used_at) { sendJson(response, 409, { error: "authorization_used" }); return true; }
          const socialUser = ensureSocialUser(authorization.account_user_id, {
            displayName: authorization.display_name,
            avatarUrl: authorization.avatar_url,
            provider: authorization.provider,
          });
          sendJson(response, 200, { code: state, profile: socialUser.id }); return true;
        }

        if (pathname === "/v1/social/native/cancel" && request.method === "POST") {
          if (request.headers.origin !== siteOrigin) { sendJson(response, 403, { error: "invalid_origin" }); return true; }
          const body = await readBody(request);
          const challenge = text(body.challenge, 160);
          const state = text(body.state, 160);
          if (!validNativeRequest(challenge, state)) { sendJson(response, 400, { error: "invalid_authorization_request" }); return true; }
          const browserSession = await sessionForBrowser(request);
          if (!browserSession) { sendJson(response, 401, { error: "not_authenticated" }); return true; }
          database.prepare(`INSERT INTO social_native_codes(code_hash, account_user_id, challenge, expires_at, used_at, denied_at)
            VALUES (?, ?, ?, ?, NULL, ?)
            ON CONFLICT(code_hash) DO NOTHING`)
            .run(hash(state), browserSession.user.id, challenge, now() + 5 * 60_000, now());
          sendJson(response, 200, { cancelled: true }); return true;
        }

        if (pathname === "/v1/social/native/exchange" && request.method === "POST") {
          const body = await readBody(request);
          const code = text(body.code, 160);
          const verifier = text(body.verifier, 160);
          const deviceId = text(body.deviceId, 64);
          const deviceName = text(body.deviceName, 80) || "Bloom Client on Windows";
          if (!code || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier) || !validDeviceId(deviceId) || !validKey(body.curve25519Key) || !validKey(body.ed25519Key)) {
            sendJson(response, 400, { error: "invalid_exchange" }); return true;
          }
          const authorization = database.prepare("SELECT * FROM social_native_codes WHERE code_hash = ? AND used_at IS NULL AND denied_at IS NULL AND expires_at > ?").get(hash(code), now());
          const computedChallenge = crypto.createHash("sha256").update(verifier).digest("base64url");
          if (!authorization || authorization.challenge !== computedChallenge) { sendJson(response, 400, { error: "invalid_or_expired_code" }); return true; }
          const user = ensureSocialUser(authorization.account_user_id, {
            displayName: authorization.display_name,
            avatarUrl: authorization.avatar_url,
            provider: authorization.provider,
          });
          const timestamp = now();
          const existingDevice = database.prepare("SELECT user_id, curve25519_key, ed25519_key FROM social_devices WHERE id = ?").get(deviceId);
          if (existingDevice && existingDevice.user_id !== user.id) { sendJson(response, 409, { error: "device_belongs_to_another_account" }); return true; }
          const identityChanged = existingDevice && (existingDevice.curve25519_key !== body.curve25519Key || existingDevice.ed25519_key !== body.ed25519Key);
          database.exec("BEGIN IMMEDIATE");
          try {
            const claimed = database.prepare(`UPDATE social_native_codes SET used_at = ?
              WHERE code_hash = ? AND used_at IS NULL AND denied_at IS NULL AND expires_at > ? AND challenge = ?`)
              .run(timestamp, authorization.code_hash, timestamp, computedChallenge);
            if (claimed.changes !== 1) {
              database.exec("ROLLBACK");
              sendJson(response, 400, { error: "invalid_or_expired_code" }); return true;
            }
            if (identityChanged) {
              database.prepare("DELETE FROM social_one_time_prekeys WHERE device_id = ?").run(deviceId);
            }
            database.prepare(`INSERT INTO social_devices(id, user_id, name, curve25519_key, ed25519_key, created_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, curve25519_key = excluded.curve25519_key, ed25519_key = excluded.ed25519_key, last_seen_at = excluded.last_seen_at, revoked_at = NULL`)
              .run(deviceId, user.id, deviceName, body.curve25519Key, body.ed25519Key, timestamp, timestamp);
            database.exec("COMMIT");
          } catch (error) { database.exec("ROLLBACK"); throw error; }
          signalUsers([user.id, ...identityAudience(user.id)], "identity");
          sendJson(response, 200, { ...issueTokens(user.id, deviceId), user: publicUser(user), needsUsername: !user.username });
          return true;
        }

        if (pathname === "/v1/social/native/refresh" && request.method === "POST") {
          const body = await readBody(request);
          const refreshToken = text(body.refreshToken, 256);
          const current = database.prepare("SELECT * FROM social_sessions WHERE refresh_hash = ? AND revoked_at IS NULL AND refresh_expires_at > ?").get(hash(refreshToken), now());
          if (!current || !findDevice.get(current.device_id, current.user_id)) { sendJson(response, 401, { error: "invalid_refresh_token" }); return true; }
          database.exec("BEGIN IMMEDIATE");
          try {
            const claimed = database.prepare("UPDATE social_sessions SET revoked_at = ? WHERE refresh_hash = ? AND revoked_at IS NULL")
              .run(now(), current.refresh_hash);
            if (claimed.changes !== 1) {
              database.exec("ROLLBACK");
              sendJson(response, 401, { error: "invalid_refresh_token" }); return true;
            }
            const bundle = issueTokens(current.user_id, current.device_id);
            database.exec("COMMIT");
            sendJson(response, 200, bundle); return true;
          } catch (error) { database.exec("ROLLBACK"); throw error; }
        }

        const session = requireSession(request, response);
        if (!session) return true;
        const user = refreshAccountProfile(findUser.get(session.user_id));

        if (pathname === "/v1/social/changes" && request.method === "GET") {
          const after = text(url.searchParams.get("after"), 128);
          const requestedWait = Number(url.searchParams.get("waitMs"));
          const waitMs = Math.max(0, Math.min(15_000, Number.isFinite(requestedWait) ? requestedWait : 15_000));
          if (waitMs > 0 && (changeWaiters.get(session.user_id)?.size || 0) >= 16) {
            sendJson(response, 429, { error: "too_many_realtime_connections" }); return true;
          }
          const change = after ? await waitForSocialChange(request, session, after, waitMs) : {
            cursor: socialCursor(session), changed: true, scopes: ["all"],
          };
          if (!response.destroyed) sendJson(response, 200, change);
          return true;
        }

        if (pathname === "/v1/social/me" && request.method === "GET") {
          sendJson(response, 200, { user: publicUser(user), needsUsername: !user.username, deviceId: session.device_id }); return true;
        }
        if (pathname === "/v1/social/me/username" && request.method === "PUT") {
          const body = await readBody(request);
          const username = text(body.username, 20);
          if (!validUsername(username)) { sendJson(response, 400, { error: "invalid_username" }); return true; }
          try {
            database.prepare("UPDATE social_users SET username = ?, username_lower = ?, updated_at = ? WHERE id = ?")
              .run(username, username.toLowerCase(), now(), session.user_id);
          } catch (error) {
            if (String(error).includes("UNIQUE")) { sendJson(response, 409, { error: "username_taken" }); return true; }
            throw error;
          }
          signalUsers([session.user_id, ...identityAudience(session.user_id)], "profile");
          sendJson(response, 200, { user: publicUser(findUser.get(session.user_id)) }); return true;
        }

        if (pathname === "/v1/social/prekeys" && request.method === "PUT") {
          const body = await readBody(request);
          const keys = Array.isArray(body.keys) ? body.keys.slice(0, 100) : [];
          if (!findDevice.get(session.device_id, session.user_id) || keys.some((entry) => !entry || !validKey(entry.key) || !/^[A-Za-z0-9_-]{1,80}$/.test(entry.id))) {
            sendJson(response, 400, { error: "invalid_prekeys" }); return true;
          }
          const insert = database.prepare("INSERT OR IGNORE INTO social_one_time_prekeys(device_id, key_id, public_key) VALUES (?, ?, ?)");
          database.exec("BEGIN IMMEDIATE");
          try { for (const entry of keys) insert.run(session.device_id, entry.id, entry.key); database.exec("COMMIT"); }
          catch (error) { database.exec("ROLLBACK"); throw error; }
          sendJson(response, 200, { accepted: keys.length }); return true;
        }

        const exactLookup = pathname === "/v1/social/users/exact" && request.method === "GET";
        if (exactLookup) {
          const username = text(url.searchParams.get("username"), 20);
          if (!validUsername(username)) { sendJson(response, 404, { error: "user_not_found" }); return true; }
          const found = findUserByName.get(username.toLowerCase());
          if (!found || found.id === session.user_id || isBlocked(session.user_id, found.id)) { sendJson(response, 404, { error: "user_not_found" }); return true; }
          const relation = friendship(session.user_id, found.id);
          sendJson(response, 200, { user: publicUser(found), relationship: relation ? { status: relation.status, requestedByMe: relation.requested_by === session.user_id } : null }); return true;
        }

        if (pathname === "/v1/social/friends" && request.method === "GET") {
          const rows = database.prepare(`
            SELECT u.* FROM social_friendships f JOIN social_users u ON u.id = CASE WHEN f.user_low = ? THEN f.user_high ELSE f.user_low END
            WHERE (f.user_low = ? OR f.user_high = ?) AND f.status = 'accepted'
            AND NOT EXISTS (SELECT 1 FROM social_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
            ORDER BY lower(u.username)
          `).all(session.user_id, session.user_id, session.user_id, session.user_id, session.user_id);
          sendJson(response, 200, { friends: rows.map(publicUser) }); return true;
        }
        if (pathname === "/v1/social/friend-requests" && request.method === "GET") {
          const rows = database.prepare(`SELECT f.*, u.* FROM social_friendships f JOIN social_users u ON u.id = f.requested_by
            WHERE (f.user_low = ? OR f.user_high = ?) AND f.status = 'pending' ORDER BY f.created_at DESC`).all(session.user_id, session.user_id);
          sendJson(response, 200, {
            incoming: rows.filter((row) => row.requested_by !== session.user_id).map(publicUser),
            outgoing: rows.filter((row) => row.requested_by === session.user_id).map(publicUser),
          }); return true;
        }
        if (pathname === "/v1/social/friend-requests" && request.method === "POST") {
          if (!allowRate(`friend:${session.user_id}`, 20, 60 * 60_000)) { sendJson(response, 429, { error: "friend_request_rate_limited" }); return true; }
          const body = await readBody(request);
          const target = findUserByName.get(text(body.username, 20).toLowerCase());
          if (!target || target.id === session.user_id || isBlocked(session.user_id, target?.id)) { sendJson(response, 404, { error: "user_not_found" }); return true; }
          const count = database.prepare("SELECT count(*) count FROM social_friendships WHERE requested_by = ? AND status = 'pending'").get(session.user_id).count;
          if (count >= 50) { sendJson(response, 429, { error: "pending_request_limit" }); return true; }
          const targetIncoming = database.prepare("SELECT count(*) count FROM social_friendships WHERE (user_low = ? OR user_high = ?) AND requested_by != ? AND status = 'pending'").get(target.id, target.id, target.id).count;
          if (targetIncoming >= 50) { sendJson(response, 429, { error: "recipient_request_limit" }); return true; }
          const [low, high] = canonicalPair(session.user_id, target.id);
          const existing = friendship(session.user_id, target.id);
          if (existing) { sendJson(response, 409, { error: existing.status === "accepted" ? "already_friends" : "request_exists" }); return true; }
          const timestamp = now();
          database.prepare("INSERT INTO social_friendships(user_low, user_high, status, requested_by, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)")
            .run(low, high, session.user_id, timestamp, timestamp);
          signalUsers([session.user_id, target.id], "relationships");
          sendJson(response, 201, { request: { user: publicUser(target), status: "pending" } }); return true;
        }

        const acceptMatch = pathname.match(/^\/v1\/social\/friend-requests\/([^/]+)\/accept$/);
        if (acceptMatch && request.method === "POST") {
          const requesterId = decodeURIComponent(acceptMatch[1]);
          const row = friendship(session.user_id, requesterId);
          if (!row || row.status !== "pending" || row.requested_by !== requesterId || isBlocked(session.user_id, requesterId)) { sendJson(response, 404, { error: "request_not_found" }); return true; }
          const acceptedCount = database.prepare("SELECT count(*) count FROM social_friendships WHERE (user_low = ? OR user_high = ?) AND status = 'accepted'").get(session.user_id, session.user_id).count;
          const requesterCount = database.prepare("SELECT count(*) count FROM social_friendships WHERE (user_low = ? OR user_high = ?) AND status = 'accepted'").get(requesterId, requesterId).count;
          if (acceptedCount >= 150 || requesterCount >= 150) { sendJson(response, 429, { error: "friend_limit" }); return true; }
          database.prepare("UPDATE social_friendships SET status = 'accepted', updated_at = ? WHERE user_low = ? AND user_high = ?")
            .run(now(), row.user_low, row.user_high);
          const friend = findUser.get(requesterId);
          signalUsers([session.user_id, requesterId], "relationships");
          sendJson(response, 200, { friend: publicUser(friend), conversationId: conversationFor(session.user_id, requesterId).id }); return true;
        }

        const requestDelete = pathname.match(/^\/v1\/social\/friend-requests\/([^/]+)$/);
        const friendDelete = pathname.match(/^\/v1\/social\/friends\/([^/]+)$/);
        if ((requestDelete || friendDelete) && request.method === "DELETE") {
          const otherId = decodeURIComponent((requestDelete || friendDelete)[1]);
          const [low, high] = canonicalPair(session.user_id, otherId);
          database.prepare("DELETE FROM social_friendships WHERE user_low = ? AND user_high = ?").run(low, high);
          signalUsers([session.user_id, otherId], "relationships");
          response.writeHead(204, { "cache-control": "no-store" }); response.end(); return true;
        }

        const blockMatch = pathname.match(/^\/v1\/social\/blocks\/([^/]+)$/);
        if (blockMatch && request.method === "PUT") {
          const otherId = decodeURIComponent(blockMatch[1]);
          if (!findUser.get(otherId) || otherId === session.user_id) { sendJson(response, 404, { error: "user_not_found" }); return true; }
          const [low, high] = canonicalPair(session.user_id, otherId);
          database.exec("BEGIN IMMEDIATE");
          try {
            database.prepare("INSERT OR IGNORE INTO social_blocks(blocker_id, blocked_id, created_at) VALUES (?, ?, ?)").run(session.user_id, otherId, now());
            database.prepare("DELETE FROM social_friendships WHERE user_low = ? AND user_high = ?").run(low, high);
            database.exec("COMMIT");
          } catch (error) { database.exec("ROLLBACK"); throw error; }
          signalUsers([session.user_id, otherId], "relationships");
          response.writeHead(204, { "cache-control": "no-store" }); response.end(); return true;
        }

        if (pathname === "/v1/social/instance-invites" && request.method === "GET") {
          const timestamp = now();
          database.prepare("UPDATE social_instance_invites SET status = 'expired', updated_at = ? WHERE status IN ('pending','installing') AND expires_at <= ?").run(timestamp, timestamp);
          database.prepare("UPDATE social_instance_invites SET status = 'pending', claim_hash = NULL, claim_expires_at = NULL, updated_at = ? WHERE status = 'installing' AND claim_expires_at <= ? AND expires_at > ?").run(timestamp, timestamp, timestamp);
          const rows = database.prepare(`SELECT * FROM social_instance_invites
            WHERE sender_id = ? OR recipient_id = ? ORDER BY updated_at DESC LIMIT 200`).all(session.user_id, session.user_id);
          sendJson(response, 200, { invites: rows.map(publicInstanceInvite) }); return true;
        }

        if (pathname === "/v1/social/instance-invites" && request.method === "POST") {
          if (!allowRate(`instance-invite:${session.user_id}`, 30, 60 * 60_000)) { sendJson(response, 429, { error: "instance_invite_rate_limited" }); return true; }
          const body = await readBody(request, 64 * 1024);
          const requestKey = text(body.requestKey, 80);
          const instanceName = text(body.instanceName, 80);
          const minecraftVersion = text(body.minecraftVersion, 32);
          const loader = text(body.loader, 32);
          const iconDataUrl = typeof body.iconDataUrl === "string" ? body.iconDataUrl : "";
          const shareMode = text(body.shareMode, 16);
          const entries = Array.isArray(body.invites) ? body.invites.slice(0, 10) : [];
          if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestKey) || !instanceName || !minecraftVersion || !loader || !["copy", "synced"].includes(shareMode) || !entries.length
            || (iconDataUrl && (iconDataUrl.length > 160_000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(iconDataUrl)))) {
            sendJson(response, 400, { error: "invalid_instance_invite" }); return true;
          }
          const normalized = entries.map((entry) => ({
            recipientId: text(entry?.recipientId, 64),
            shareCode: text(entry?.shareCode, 16).toUpperCase(),
            role: shareMode === "copy" ? "member" : text(entry?.role, 16),
          }));
          if (new Set(normalized.map((entry) => entry.recipientId)).size !== normalized.length
            || normalized.some((entry) => !acceptedFriends(session.user_id, entry.recipientId)
              || !/^[23456789A-HJ-NP-Z]{8}$/.test(entry.shareCode)
              || !["member", "editor"].includes(entry.role))) {
            sendJson(response, 400, { error: "invalid_instance_invite_recipient" }); return true;
          }
          const timestamp = now();
          const expiresAt = timestamp + 7 * 24 * 60 * 60_000;
          const insert = database.prepare(`INSERT OR IGNORE INTO social_instance_invites
            (id, sender_id, recipient_id, request_key, share_code, share_mode, role, instance_name, minecraft_version, loader, icon_data_url, status, created_at, updated_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`);
          const newInviteIds = [];
          database.exec("BEGIN IMMEDIATE");
          try {
            for (const entry of normalized) {
              const inviteId = uuid();
              if (insert.run(inviteId, session.user_id, entry.recipientId, requestKey, entry.shareCode, shareMode, entry.role, instanceName, minecraftVersion, loader, iconDataUrl || null, timestamp, timestamp, expiresAt).changes === 1) newInviteIds.push(inviteId);
              conversationFor(session.user_id, entry.recipientId);
            }
            database.exec("COMMIT");
          } catch (error) { database.exec("ROLLBACK"); throw error; }
          const rows = database.prepare("SELECT * FROM social_instance_invites WHERE sender_id = ? AND request_key = ? ORDER BY created_at").all(session.user_id, requestKey);
          signalUsers([session.user_id, ...normalized.map((entry) => entry.recipientId)], "invites");
          sendJson(response, 201, { invites: rows.map(publicInstanceInvite), newInviteIds }); return true;
        }

        const instanceInviteAction = pathname.match(/^\/v1\/social\/instance-invites\/([0-9a-f-]{36})\/(claim|complete|release|decline|revoke)$/i);
        if (instanceInviteAction && request.method === "POST") {
          const inviteId = instanceInviteAction[1];
          const action = instanceInviteAction[2];
          const invite = database.prepare("SELECT * FROM social_instance_invites WHERE id = ?").get(inviteId);
          if (!invite || (invite.sender_id !== session.user_id && invite.recipient_id !== session.user_id)) { sendJson(response, 404, { error: "instance_invite_not_found" }); return true; }
          const timestamp = now();
          if (action === "claim") {
            if (invite.recipient_id !== session.user_id) { sendJson(response, 403, { error: "invite_recipient_required" }); return true; }
            if (invite.expires_at <= timestamp) {
              database.prepare("UPDATE social_instance_invites SET status = 'expired', updated_at = ? WHERE id = ?").run(timestamp, inviteId);
              signalUsers([invite.sender_id, invite.recipient_id], "invites");
              sendJson(response, 410, { error: "instance_invite_expired" }); return true;
            }
            if (invite.status === "accepted") { sendJson(response, 409, { error: "instance_invite_already_accepted" }); return true; }
            if (invite.status === "installing" && invite.claim_expires_at > timestamp) { sendJson(response, 409, { error: "instance_invite_installing" }); return true; }
            if (!["pending", "installing"].includes(invite.status)) { sendJson(response, 409, { error: `instance_invite_${invite.status}` }); return true; }
            const claimToken = randomToken(32);
            database.prepare("UPDATE social_instance_invites SET status = 'installing', claim_hash = ?, claim_expires_at = ?, updated_at = ? WHERE id = ?")
              .run(hash(claimToken), timestamp + 30 * 60_000, timestamp, inviteId);
            signalUsers([invite.sender_id, invite.recipient_id], "invites");
            sendJson(response, 200, { claimToken, shareCode: invite.share_code, shareMode: invite.share_mode, role: invite.role }); return true;
          }
          const body = await readBody(request);
          if (action === "complete" || action === "release") {
            const claimToken = text(body.claimToken, 128);
            if (invite.recipient_id !== session.user_id || invite.status !== "installing" || !claimToken || invite.claim_hash !== hash(claimToken) || invite.claim_expires_at <= timestamp) {
              sendJson(response, 409, { error: "instance_invite_claim_invalid" }); return true;
            }
            const status = action === "complete" ? "accepted" : "pending";
            database.prepare("UPDATE social_instance_invites SET status = ?, claim_hash = NULL, claim_expires_at = NULL, updated_at = ? WHERE id = ?").run(status, timestamp, inviteId);
          } else if (action === "decline") {
            if (invite.recipient_id !== session.user_id || invite.status !== "pending") { sendJson(response, 409, { error: "instance_invite_cannot_decline" }); return true; }
            database.prepare("UPDATE social_instance_invites SET status = 'declined', claim_hash = NULL, claim_expires_at = NULL, updated_at = ? WHERE id = ?").run(timestamp, inviteId);
            onInstanceInviteClosed(invite.share_code);
          } else {
            if (invite.sender_id !== session.user_id || invite.status !== "pending") { sendJson(response, 409, { error: "instance_invite_cannot_revoke" }); return true; }
            database.prepare("UPDATE social_instance_invites SET status = 'revoked', claim_hash = NULL, claim_expires_at = NULL, updated_at = ? WHERE id = ?").run(timestamp, inviteId);
            onInstanceInviteClosed(invite.share_code);
          }
          signalUsers([invite.sender_id, invite.recipient_id], "invites");
          sendJson(response, 200, { invite: publicInstanceInvite(database.prepare("SELECT * FROM social_instance_invites WHERE id = ?").get(inviteId)) }); return true;
        }

        const devicesMatch = pathname.match(/^\/v1\/social\/users\/([^/]+)\/devices$/);
        if (devicesMatch && request.method === "GET") {
          const otherId = decodeURIComponent(devicesMatch[1]);
          if (otherId !== session.user_id && !acceptedFriends(session.user_id, otherId) && !sharedGroup(session.user_id, otherId)) { sendJson(response, 403, { error: "friendship_or_group_required" }); return true; }
          const devices = database.prepare("SELECT id, curve25519_key, ed25519_key FROM social_devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at").all(otherId);
          sendJson(response, 200, { devices: devices.map((device) => ({ deviceId: device.id, curve25519Key: device.curve25519_key, ed25519Key: device.ed25519_key })) }); return true;
        }

        const prekeyMatch = pathname.match(/^\/v1\/social\/users\/([^/]+)\/prekey-bundle$/);
        if (prekeyMatch && request.method === "GET") {
          const otherId = decodeURIComponent(prekeyMatch[1]);
          if (!acceptedFriends(session.user_id, otherId) && !sharedGroup(session.user_id, otherId)) { sendJson(response, 403, { error: "friendship_or_group_required" }); return true; }
          const excluded = new Set((url.searchParams.get("exclude") || "").split(",").filter((value) => validDeviceId(value)).slice(0, 12));
          const devices = database.prepare("SELECT * FROM social_devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at").all(otherId).filter((device) => !excluded.has(device.id));
          const bundles = [];
          database.exec("BEGIN IMMEDIATE");
          try {
            for (const device of devices) {
              const key = database.prepare("SELECT * FROM social_one_time_prekeys WHERE device_id = ? AND claimed_at IS NULL ORDER BY rowid LIMIT 1").get(device.id);
              if (!key) continue;
              database.prepare("UPDATE social_one_time_prekeys SET claimed_at = ? WHERE device_id = ? AND key_id = ?").run(now(), device.id, key.key_id);
              bundles.push({ deviceId: device.id, curve25519Key: device.curve25519_key, ed25519Key: device.ed25519_key, oneTimeKeyId: key.key_id, oneTimeKey: key.public_key });
            }
            database.exec("COMMIT");
          } catch (error) { database.exec("ROLLBACK"); throw error; }
          sendJson(response, 200, { user: publicUser(findUser.get(otherId)), devices: bundles }); return true;
        }

        if (pathname === "/v1/social/groups" && request.method === "GET") {
          const groups = database.prepare(`SELECT g.* FROM social_groups g JOIN social_group_members m ON m.group_id = g.id
            WHERE m.user_id = ? ORDER BY g.updated_at DESC`).all(session.user_id);
          sendJson(response, 200, { groups: groups.map((group) => publicGroup(group, session.user_id)) }); return true;
        }
        if (pathname === "/v1/social/groups" && request.method === "POST") {
          if (!allowRate(`group-create:${session.user_id}`, 10, 60 * 60_000)) { sendJson(response, 429, { error: "group_creation_rate_limited" }); return true; }
          const body = await readBody(request);
          const name = text(body.name, 48);
          const memberIds = [...new Set(Array.isArray(body.memberIds) ? body.memberIds.map((value) => text(value, 64)) : [])].filter(Boolean);
          if (name.length < 2 || memberIds.length > 9 || memberIds.some((id) => id === session.user_id || !acceptedFriends(session.user_id, id))) {
            sendJson(response, 400, { error: "invalid_group" }); return true;
          }
          const timestamp = now();
          const id = uuid();
          database.exec("BEGIN IMMEDIATE");
          try {
            database.prepare("INSERT INTO social_groups(id, name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, name, session.user_id, timestamp, timestamp);
            const insert = database.prepare("INSERT INTO social_group_members(group_id, user_id, added_by, joined_at) VALUES (?, ?, ?, ?)");
            insert.run(id, session.user_id, session.user_id, timestamp);
            for (const memberId of memberIds) insert.run(id, memberId, session.user_id, timestamp);
            database.exec("COMMIT");
          } catch (error) { database.exec("ROLLBACK"); throw error; }
          signalUsers([session.user_id, ...memberIds], "groups");
          sendJson(response, 201, { group: publicGroup(database.prepare("SELECT * FROM social_groups WHERE id = ?").get(id), session.user_id) }); return true;
        }

        const groupDetailsMatch = pathname.match(/^\/v1\/social\/groups\/([0-9a-f-]{36})$/i);
        if (groupDetailsMatch && request.method === "PATCH") {
          const groupId = groupDetailsMatch[1];
          const group = database.prepare("SELECT * FROM social_groups WHERE id = ?").get(groupId);
          if (!group || !groupMember(groupId, session.user_id)) { sendJson(response, 404, { error: "group_not_found" }); return true; }
          const body = await readBody(request, 192 * 1024);
          const updates = [];
          const values = [];
          if (Object.hasOwn(body, "name")) {
            const name = text(body.name, 48);
            if (name.length < 2) { sendJson(response, 400, { error: "invalid_group_name" }); return true; }
            updates.push("name = ?"); values.push(name);
          }
          if (Object.hasOwn(body, "iconDataUrl")) {
            const icon = typeof body.iconDataUrl === "string" ? body.iconDataUrl : "";
            if (icon && (icon.length > 160_000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(icon))) {
              sendJson(response, 400, { error: "invalid_group_icon" }); return true;
            }
            updates.push("icon_data_url = ?"); values.push(icon || null);
          }
          if (!updates.length) { sendJson(response, 400, { error: "group_update_required" }); return true; }
          values.push(now(), groupId);
          database.prepare(`UPDATE social_groups SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`).run(...values);
          signalUsers(groupUserIds(groupId), "groups");
          sendJson(response, 200, { group: publicGroup(database.prepare("SELECT * FROM social_groups WHERE id = ?").get(groupId), session.user_id) }); return true;
        }

        const groupMemberMatch = pathname.match(/^\/v1\/social\/groups\/([0-9a-f-]{36})\/members(?:\/([0-9a-f-]{36}))?$/i);
        if (groupMemberMatch && request.method === "POST" && !groupMemberMatch[2]) {
          const groupId = groupMemberMatch[1];
          const group = database.prepare("SELECT * FROM social_groups WHERE id = ?").get(groupId);
          if (!group || !groupMember(groupId, session.user_id)) { sendJson(response, 404, { error: "group_not_found" }); return true; }
          const body = await readBody(request);
          const userId = text(body.userId, 64);
          const count = database.prepare("SELECT count(*) count FROM social_group_members WHERE group_id = ?").get(groupId).count;
          if (count >= 10) { sendJson(response, 409, { error: "group_member_limit" }); return true; }
          if (!acceptedFriends(session.user_id, userId)) { sendJson(response, 403, { error: "friendship_required" }); return true; }
          database.prepare("INSERT OR IGNORE INTO social_group_members(group_id, user_id, added_by, joined_at) VALUES (?, ?, ?, ?)").run(groupId, userId, session.user_id, now());
          signalUsers(groupUserIds(groupId), "groups");
          sendJson(response, 200, { group: publicGroup(group, session.user_id) }); return true;
        }
        if (groupMemberMatch && request.method === "DELETE" && groupMemberMatch[2]) {
          const [groupId, targetId] = [groupMemberMatch[1], groupMemberMatch[2]];
          const group = database.prepare("SELECT * FROM social_groups WHERE id = ?").get(groupId);
          if (!group || !groupMember(groupId, session.user_id) || !groupMember(groupId, targetId)) { sendJson(response, 404, { error: "group_member_not_found" }); return true; }
          if (targetId === group.owner_id || (targetId !== session.user_id && group.owner_id !== session.user_id)) { sendJson(response, 403, { error: "group_owner_required" }); return true; }
          const affectedUsers = groupUserIds(groupId);
          database.prepare("DELETE FROM social_group_members WHERE group_id = ? AND user_id = ?").run(groupId, targetId);
          signalUsers(affectedUsers, "groups");
          sendJson(response, 200, { group: publicGroup(group, session.user_id) }); return true;
        }

        const groupEnvelopeMatch = pathname.match(/^\/v1\/social\/groups\/([0-9a-f-]{36})\/envelopes$/i);
        if (groupEnvelopeMatch && request.method === "POST") {
          const groupId = groupEnvelopeMatch[1];
          if (!groupMember(groupId, session.user_id)) { sendJson(response, 404, { error: "group_not_found" }); return true; }
          const body = await readBody(request, 1024 * 1024);
          const recipientId = text(body.recipientId, 64);
          const clientNonce = text(body.clientNonce, 80);
          const eventKind = text(body.eventKind, 16);
          const envelopes = Array.isArray(body.envelopes) ? body.envelopes.slice(0, 12) : [];
          if (recipientId === session.user_id || !groupMember(groupId, recipientId) || !/^[A-Za-z0-9_-]{16,80}$/.test(clientNonce) || !["message", "reaction", "security", "pin", "edit"].includes(eventKind) || !envelopes.length) {
            sendJson(response, 400, { error: "invalid_group_envelope_batch" }); return true;
          }
          if (!allowRate(`group-message:${session.user_id}`, 60, 60_000, `${groupId}:${clientNonce}`)) { sendJson(response, 429, { error: "message_rate_limited" }); return true; }
          const recipientDevices = new Set(database.prepare("SELECT id FROM social_devices WHERE user_id = ? AND revoked_at IS NULL").all(recipientId).map((row) => row.id));
          if (envelopes.some((entry) => !recipientDevices.has(entry?.deviceId) || typeof entry.ciphertext !== "string" || entry.ciphertext.length > 96_000)) {
            sendJson(response, 400, { error: "invalid_envelope" }); return true;
          }
          const timestamp = now();
          const insert = database.prepare("INSERT OR IGNORE INTO social_group_envelopes(group_id, sender_id, sender_device_id, recipient_id, recipient_device_id, client_nonce, event_kind, ciphertext, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
          database.exec("BEGIN IMMEDIATE");
          try {
            for (const entry of envelopes) insert.run(groupId, session.user_id, session.device_id, recipientId, entry.deviceId, clientNonce, eventKind, entry.ciphertext, timestamp);
            database.prepare("UPDATE social_groups SET updated_at = ? WHERE id = ?").run(timestamp, groupId);
            database.exec("COMMIT");
          } catch (error) { database.exec("ROLLBACK"); throw error; }
          signalUsers([recipientId], "messages");
          sendJson(response, 202, { groupId, accepted: envelopes.length, createdAt: timestamp }); return true;
        }

        if (pathname === "/v1/social/group-envelopes" && request.method === "GET") {
          const after = validCursor(url.searchParams.get("after"));
          const rows = database.prepare(`SELECT e.*, d.curve25519_key sender_curve25519_key FROM social_group_envelopes e
            JOIN social_devices d ON d.id = e.sender_device_id JOIN social_group_members m ON m.group_id = e.group_id AND m.user_id = ?
            WHERE e.recipient_device_id = ? AND e.sequence > ? ORDER BY e.sequence LIMIT 200`).all(session.user_id, session.device_id, after);
          sendJson(response, 200, { envelopes: rows.map((row) => ({ sequence: row.sequence, conversationId: row.group_id, groupId: row.group_id, senderId: row.sender_id, senderDeviceId: row.sender_device_id, senderCurve25519Key: row.sender_curve25519_key, eventKind: row.event_kind, ciphertext: row.ciphertext, createdAt: row.created_at })) }); return true;
        }

        if (pathname === "/v1/social/conversations" && request.method === "GET") {
          const rows = database.prepare(`SELECT c.*, u.* FROM social_conversations c JOIN social_users u ON u.id = CASE WHEN c.user_low = ? THEN c.user_high ELSE c.user_low END
            WHERE (c.user_low = ? OR c.user_high = ?) AND NOT EXISTS (SELECT 1 FROM social_blocks b WHERE (b.blocker_id = ? AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = ?))
            ORDER BY c.updated_at DESC`).all(session.user_id, session.user_id, session.user_id, session.user_id, session.user_id);
          sendJson(response, 200, { conversations: rows.map((row) => ({ id: row.id, friend: publicUser(row), updatedAt: row.updated_at })) }); return true;
        }
        if (pathname === "/v1/social/envelopes" && request.method === "GET") {
          const after = validCursor(url.searchParams.get("after"));
          const rows = database.prepare(`SELECT e.*, u.username sender_username, u.display_name sender_display_name, d.curve25519_key sender_curve25519_key
            FROM social_envelopes e JOIN social_users u ON u.id = e.sender_id JOIN social_devices d ON d.id = e.sender_device_id
            WHERE e.recipient_device_id = ? AND e.sequence > ? ORDER BY e.sequence LIMIT 200`).all(session.device_id, after);
          sendJson(response, 200, { envelopes: rows.map((row) => ({ sequence: row.sequence, conversationId: row.conversation_id, senderId: row.sender_id, senderDeviceId: row.sender_device_id, senderCurve25519Key: row.sender_curve25519_key, senderUsername: row.sender_username, eventKind: row.event_kind, ciphertext: row.ciphertext, createdAt: row.created_at })) }); return true;
        }
        if (pathname === "/v1/social/envelopes" && request.method === "POST") {
          const body = await readBody(request, 512 * 1024);
          const recipientId = text(body.recipientId, 64);
          const clientNonce = text(body.clientNonce, 80);
          const eventKind = text(body.eventKind, 16);
          const envelopes = Array.isArray(body.envelopes) ? body.envelopes.slice(0, 12) : [];
          if (!acceptedFriends(session.user_id, recipientId) || !/^[A-Za-z0-9_-]{16,80}$/.test(clientNonce) || !["message", "reaction", "security", "pin", "edit"].includes(eventKind) || !envelopes.length) {
            sendJson(response, 400, { error: "invalid_envelope_batch" }); return true;
          }
          if (!allowRate(`message:${session.user_id}`, 30, 60_000, `${recipientId}:${clientNonce}`)) { sendJson(response, 429, { error: "message_rate_limited" }); return true; }
          const recipientDevices = new Map(database.prepare("SELECT id FROM social_devices WHERE user_id = ? AND revoked_at IS NULL").all(recipientId).map((row) => [row.id, true]));
          if (envelopes.some((entry) => !recipientDevices.has(entry?.deviceId) || typeof entry.ciphertext !== "string" || entry.ciphertext.length > 96_000)) {
            sendJson(response, 400, { error: "invalid_envelope" }); return true;
          }
          const conversation = conversationFor(session.user_id, recipientId);
          const timestamp = now();
          const insert = database.prepare("INSERT OR IGNORE INTO social_envelopes(conversation_id, sender_id, sender_device_id, recipient_id, recipient_device_id, client_nonce, event_kind, ciphertext, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
          database.exec("BEGIN IMMEDIATE");
          try {
            for (const entry of envelopes) insert.run(conversation.id, session.user_id, session.device_id, recipientId, entry.deviceId, clientNonce, eventKind, entry.ciphertext, timestamp);
            database.prepare("UPDATE social_conversations SET updated_at = ? WHERE id = ?").run(timestamp, conversation.id);
            database.exec("COMMIT");
          } catch (error) { database.exec("ROLLBACK"); throw error; }
          signalUsers([recipientId], "messages");
          sendJson(response, 202, { conversationId: conversation.id, accepted: envelopes.length, createdAt: timestamp }); return true;
        }

        if (pathname === "/v1/social/blobs" && request.method === "POST") {
          if (!allowRate(`blob:${session.user_id}`, 20, 60 * 60_000)) { sendJson(response, 429, { error: "screenshot_rate_limited" }); return true; }
          const recipientId = text(url.searchParams.get("recipientId"), 64);
          if (!acceptedFriends(session.user_id, recipientId)) { sendJson(response, 403, { error: "friendship_required" }); return true; }
          const ciphertext = await readBytes(request, 8 * 1024 * 1024 + 64);
          if (ciphertext.length < 29 || ciphertext.length > 8 * 1024 * 1024 + 64) { sendJson(response, 400, { error: "invalid_blob_size" }); return true; }
          const id = uuid();
          const digest = crypto.createHash("sha256").update(ciphertext).digest("hex");
          const timestamp = now();
          fs.writeFileSync(path.join(blobDirectory, `${id}.bin`), ciphertext, { mode: 0o600, flag: "wx" });
          database.prepare("INSERT INTO social_blobs(id, owner_id, recipient_id, ciphertext_size, ciphertext_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(id, session.user_id, recipientId, ciphertext.length, digest, timestamp, timestamp + MESSAGE_RETENTION_MS);
          sendJson(response, 201, { id, ciphertextSize: ciphertext.length, ciphertextHash: digest, expiresAt: timestamp + MESSAGE_RETENTION_MS }); return true;
        }

        const blobMatch = pathname.match(/^\/v1\/social\/blobs\/([0-9a-f-]{36})$/i);
        if (blobMatch && request.method === "PATCH") {
          const blob = database.prepare("SELECT * FROM social_blobs WHERE id = ? AND (owner_id = ? OR recipient_id = ?)").get(blobMatch[1], session.user_id, session.user_id);
          if (!blob) { sendJson(response, 404, { error: "blob_not_found" }); return true; }
          const body = await readBody(request);
          const pinned = body.pinned === true;
          const expiresAt = pinned ? PINNED_BLOB_EXPIRY : Math.max(now(), blob.created_at + MESSAGE_RETENTION_MS);
          database.prepare("UPDATE social_blobs SET expires_at = ? WHERE id = ?").run(expiresAt, blob.id);
          sendJson(response, 200, { id: blob.id, pinned, expiresAt }); return true;
        }
        if (blobMatch && request.method === "GET") {
          const blob = database.prepare("SELECT * FROM social_blobs WHERE id = ? AND expires_at > ? AND (owner_id = ? OR recipient_id = ?)").get(blobMatch[1], now(), session.user_id, session.user_id);
          if (!blob) { sendJson(response, 404, { error: "blob_not_found" }); return true; }
          const file = path.join(blobDirectory, `${blob.id}.bin`);
          if (!fs.existsSync(file)) { sendJson(response, 404, { error: "blob_not_found" }); return true; }
          response.writeHead(200, { "content-type": "application/octet-stream", "content-length": blob.ciphertext_size, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
          fs.createReadStream(file).pipe(response); return true;
        }

        sendJson(response, 404, { error: "not_found" }); return true;
      } catch (error) {
        console.error("Social API error", error?.message || error);
        sendJson(response, error?.status || 500, { error: error?.message === "request_too_large" ? "request_too_large" : "social_unavailable" });
        return true;
      }
    },
  };
}
