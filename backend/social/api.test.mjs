import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createSocialApi } from "./api.mjs";

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "bloom-social-"));
const auth = { api: {
  getSession: async () => ({ user: { id: "account-a", name: "Parks", email: "parks@example.com", image: "https://images.example/avatar.png" } }),
  listUserAccounts: async () => [{ providerId: "google" }],
} };

const call = async (api, { method = "GET", path: requestPath, body, token } = {}) => {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.url = requestPath;
  request.headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", origin: "https://bloomclient.org" };
  const chunks = [];
  const response = {
    statusCode: 200,
    headers: {},
    writeHead(status, headers = {}) { this.statusCode = status; this.headers = headers; },
    end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); },
  };
  const url = new URL(requestPath, "https://bloomclient.org");
  await api.handle(request, response, url.pathname, url);
  const raw = Buffer.concat(chunks).toString("utf8");
  return { status: response.statusCode, body: raw ? JSON.parse(raw) : null, headers: response.headers };
};

const authorize = async (api, accountId, deviceId, identity = {}) => {
  const displayName = accountId === "account-a" ? "Parks" : accountId === "account-b" ? "Karsten" : "Alex";
  auth.api.getSession = async () => ({ user: { id: accountId, name: displayName, email: `${displayName.toLowerCase()}@example.com`, image: `https://images.example/${accountId}.png` } });
  const verifier = crypto.randomBytes(40).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");
  const start = await call(api, { path: `/v1/social/native/authorize?challenge=${challenge}&state=${state}` });
  assert.equal(start.status, 302);
  assert.equal(new URL(start.headers.location).pathname, "/connect/");
  assert.equal(new URL(start.headers.location).searchParams.has("port"), false);
  const pending = await call(api, { method: "POST", path: "/v1/social/native/status", body: { challenge, state } });
  assert.equal(pending.status, 202);
  const approval = await call(api, { method: "POST", path: "/v1/social/native/approve", body: { challenge, state } });
  assert.equal(approval.status, 200);
  assert.equal(approval.body.approved, true);
  assert.equal(approval.body.callbackUrl, undefined);
  const ready = await call(api, { method: "POST", path: "/v1/social/native/status", body: { challenge, state } });
  assert.equal(ready.status, 200);
  const { code } = ready.body;
  assert.equal(code, state);
  assert.match(ready.body.profile, /^[0-9a-f-]{36}$/i);
  const exchange = await call(api, { method: "POST", path: "/v1/social/native/exchange", body: { code, verifier, deviceId, deviceName: "Test", curve25519Key: identity.curve25519Key || "curve-key-material-123456789", ed25519Key: identity.ed25519Key || "signing-key-material-123456789" } });
  assert.equal(exchange.status, 200);
  return { ...exchange.body, authorization: { challenge, state, code, verifier, deviceId } };
};

test("native PKCE codes are single-use and create a credentialed social device", async (t) => {
  const directory = temporary();
  const accountDatabase = new DatabaseSync(":memory:");
  accountDatabase.exec("CREATE TABLE user(id TEXT PRIMARY KEY, name TEXT, image TEXT); CREATE TABLE account(id TEXT PRIMARY KEY, userId TEXT, providerId TEXT, createdAt INTEGER);");
  accountDatabase.prepare("INSERT INTO user VALUES (?, ?, ?)").run("account-a", "Parks", "https://images.example/account-a.png");
  accountDatabase.prepare("INSERT INTO account VALUES (?, ?, ?, ?)").run("provider-a", "account-a", "google", 1);
  const api = createSocialApi({ auth, database: accountDatabase, siteOrigin: "https://bloomclient.org", env: { BLOOM_SOCIAL_DATA_DIR: directory } });
  t.after(() => { api.database.close(); accountDatabase.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const session = await authorize(api, "account-a", crypto.randomUUID());
  assert.equal(session.needsUsername, false);
  assert.equal(api.workspacePublisher({ headers: {} }), null);
  assert.deepEqual(api.workspacePublisher({ headers: { authorization: `Bearer ${session.accessToken}` } }),
    { id: session.user.id, username: session.user.username });
  assert.equal(api.workspaceAuthorProfile("unknown"), null);
  assert.deepEqual(api.workspaceAuthorProfile(session.user.id),
    { displayName: "Parks", avatarUrl: "https://images.example/account-a.png", minecraftUuid: null });
  const minecraftUuid = "123e4567-e89b-12d3-a456-426614174000";
  api.database.prepare("UPDATE social_users SET minecraft_uuid = ? WHERE id = ?").run(minecraftUuid, session.user.id);
  assert.equal(api.workspaceAuthorProfile(session.user.id).minecraftUuid, minecraftUuid);
  assert.equal(session.user.displayName, "Parks");
  assert.equal(session.user.avatarUrl, "https://images.example/account-a.png");
  assert.equal(session.user.provider, "google");
  const replayApproval = await call(api, { method: "POST", path: "/v1/social/native/approve", body: { challenge: session.authorization.challenge, state: session.authorization.state } });
  assert.equal(replayApproval.status, 200);
  assert.equal((await call(api, { method: "POST", path: "/v1/social/native/status", body: { challenge: session.authorization.challenge, state: session.authorization.state } })).status, 409);
  const replayExchange = await call(api, { method: "POST", path: "/v1/social/native/exchange", body: { code: session.authorization.code, verifier: session.authorization.verifier, deviceId: session.authorization.deviceId, deviceName: "Replay", curve25519Key: "curve-key-material-123456789", ed25519Key: "signing-key-material-123456789" } });
  assert.equal(replayExchange.status, 400);
  const refreshed = await call(api, { method: "POST", path: "/v1/social/native/refresh", body: { refreshToken: session.refreshToken } });
  assert.equal(refreshed.status, 200);
  assert.equal((await call(api, { method: "POST", path: "/v1/social/native/refresh", body: { refreshToken: session.refreshToken } })).status, 401);
  accountDatabase.prepare("UPDATE user SET name = ?, image = ? WHERE id = ?").run("Parks Updated", "https://images.example/updated.png", "account-a");
  const me = await call(api, { path: "/v1/social/me", token: refreshed.body.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.needsUsername, false);
  assert.equal(me.body.user.displayName, "Parks Updated");
  assert.equal(me.body.user.avatarUrl, "https://images.example/updated.png");
  const logout = await call(api, { method: "POST", path: "/v1/social/native/logout", body: { refreshToken: session.refreshToken } });
  assert.equal(logout.status, 200);
  assert.equal((await call(api, { path: "/v1/social/me", token: refreshed.body.accessToken })).status, 401);
  assert.equal((await call(api, { method: "POST", path: "/v1/social/native/refresh", body: { refreshToken: refreshed.body.refreshToken } })).status, 401);
});

test("native approval supports cancellation and legacy loopback clients", async (t) => {
  const directory = temporary();
  const api = createSocialApi({ auth, siteOrigin: "https://bloomclient.org", env: { BLOOM_SOCIAL_DATA_DIR: directory } });
  t.after(() => { api.database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const verifier = crypto.randomBytes(40).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");
  const cancelled = await call(api, { method: "POST", path: "/v1/social/native/cancel", body: { challenge, state } });
  assert.equal(cancelled.status, 200);
  assert.equal((await call(api, { method: "POST", path: "/v1/social/native/status", body: { challenge, state } })).status, 403);

  const legacyState = crypto.randomBytes(32).toString("base64url");
  const legacy = await call(api, { method: "POST", path: "/v1/social/native/approve", body: { challenge, state: legacyState, port: 17842 } });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.approved, true);
  const callback = new URL(legacy.body.callbackUrl);
  assert.equal(callback.hostname, "127.0.0.1");
  assert.equal(callback.port, "17842");
  assert.match(callback.searchParams.get("profile"), /^[0-9a-f-]{36}$/i);
});

test("rotating an existing device identity removes its stale one-time prekeys", async (t) => {
  const directory = temporary();
  const api = createSocialApi({ auth, siteOrigin: "https://bloomclient.org", env: { BLOOM_SOCIAL_DATA_DIR: directory } });
  t.after(() => { api.database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const deviceId = crypto.randomUUID();
  const first = await authorize(api, "account-a", deviceId);
  assert.equal((await call(api, { method: "PUT", path: "/v1/social/prekeys", token: first.accessToken, body: { keys: [{ id: "key-1", key: "old-one-time-key-material-123456789" }] } })).status, 200);
  assert.equal(api.database.prepare("SELECT COUNT(*) AS count FROM social_one_time_prekeys WHERE device_id = ?").get(deviceId).count, 1);
  const rotated = await authorize(api, "account-a", deviceId, { curve25519Key: "rotated-curve-key-material-123456789", ed25519Key: "rotated-signing-key-material-123456789" });
  assert.equal(api.database.prepare("SELECT COUNT(*) AS count FROM social_one_time_prekeys WHERE device_id = ?").get(deviceId).count, 0);
  assert.equal((await call(api, { method: "PUT", path: "/v1/social/prekeys", token: rotated.accessToken, body: { keys: [{ id: "key-1", key: "fresh-one-time-key-material-123456789" }] } })).status, 200);
  assert.equal(api.database.prepare("SELECT public_key FROM social_one_time_prekeys WHERE device_id = ? AND key_id = ?").get(deviceId, "key-1").public_key, "fresh-one-time-key-material-123456789");
});

test("exact-name requests become accepted friends without exposing a directory", async (t) => {
  const directory = temporary();
  const api = createSocialApi({ auth, siteOrigin: "https://bloomclient.org", env: { BLOOM_SOCIAL_DATA_DIR: directory } });
  t.after(() => { api.database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const first = await authorize(api, "account-a", crypto.randomUUID());
  const second = await authorize(api, "account-b", crypto.randomUUID());
  assert.equal((await call(api, { method: "PUT", path: "/v1/social/me/username", token: first.accessToken, body: { username: "Parks" } })).status, 200);
  assert.equal((await call(api, { method: "PUT", path: "/v1/social/me/username", token: second.accessToken, body: { username: "Karsten" } })).status, 200);
  assert.equal((await call(api, { method: "POST", path: "/v1/social/friend-requests", token: first.accessToken, body: { username: "Karsten" } })).status, 201);
  const sent = await call(api, { path: "/v1/social/friend-requests", token: first.accessToken });
  assert.equal(sent.body.outgoing[0].username, "Karsten");
  const incoming = await call(api, { path: "/v1/social/friend-requests", token: second.accessToken });
  assert.equal(incoming.body.incoming[0].username, "Parks");
  const accepted = await call(api, { method: "POST", path: `/v1/social/friend-requests/${incoming.body.incoming[0].id}/accept`, token: second.accessToken });
  assert.equal(accepted.status, 200);
  const friends = await call(api, { path: "/v1/social/friends", token: first.accessToken });
  assert.equal(friends.body.friends[0].username, "Karsten");
});

test("message envelopes expire after seven days while encrypted pins remain durable", async (t) => {
  const directory = temporary();
  const api = createSocialApi({ auth, siteOrigin: "https://bloomclient.org", env: { BLOOM_SOCIAL_DATA_DIR: directory } });
  t.after(() => { api.database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const parks = await authorize(api, "account-a", crypto.randomUUID());
  const karsten = await authorize(api, "account-b", crypto.randomUUID());
  await call(api, { method: "POST", path: "/v1/social/friend-requests", token: parks.accessToken, body: { username: "Karsten" } });
  assert.equal((await call(api, { method: "POST", path: `/v1/social/friend-requests/${parks.user.id}/accept`, token: karsten.accessToken })).status, 200);

  const send = (eventKind, nonce) => call(api, { method: "POST", path: "/v1/social/envelopes", token: parks.accessToken, body: { recipientId: karsten.user.id, clientNonce: nonce, eventKind, envelopes: [{ deviceId: karsten.authorization.deviceId, ciphertext: `encrypted-${eventKind}` }] } });
  assert.equal((await send("message", "message-retention-nonce-1")).status, 202);
  assert.equal((await send("reaction", "reaction-retention-nonce-1")).status, 202);
  assert.equal((await send("edit", "edit-retention-nonce-0001")).status, 202);
  assert.equal((await send("pin", "pin-retention-nonce-0001")).status, 202);
  api.database.prepare("UPDATE social_envelopes SET created_at = ?").run(Date.now() - 25 * 60 * 60_000);
  api.purgeExpiredData(true);
  assert.equal(api.database.prepare("SELECT count(*) count FROM social_envelopes").get().count, 4);
  api.database.prepare("UPDATE social_envelopes SET created_at = ?").run(Date.now() - 7 * 86400000 - 1000);
  const expiredBlob = crypto.randomUUID();
  const durableBlob = crypto.randomUUID();
  const blobDirectory = path.join(directory, "social-blobs");
  fs.writeFileSync(path.join(blobDirectory, `${expiredBlob}.bin`), "expired");
  fs.writeFileSync(path.join(blobDirectory, `${durableBlob}.bin`), "pinned");
  const insertBlob = api.database.prepare("INSERT INTO social_blobs(id, owner_id, recipient_id, ciphertext_size, ciphertext_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  insertBlob.run(expiredBlob, parks.user.id, karsten.user.id, 7, "expired-hash", Date.now() - 25 * 60 * 60_000, Date.now() - 1);
  insertBlob.run(durableBlob, parks.user.id, karsten.user.id, 6, "pinned-hash", Date.now() - 25 * 60 * 60_000, 253402300799000);
  api.purgeExpiredData(true);
  assert.equal(api.database.prepare("SELECT count(*) count FROM social_envelopes WHERE event_kind IN ('message','reaction','edit')").get().count, 0);
  assert.equal(api.database.prepare("SELECT count(*) count FROM social_envelopes WHERE event_kind = 'pin'").get().count, 1);
  assert.equal(fs.existsSync(path.join(blobDirectory, `${expiredBlob}.bin`)), false);
  assert.equal(fs.existsSync(path.join(blobDirectory, `${durableBlob}.bin`)), true);
});

test("rapid message bursts stay idempotent and bounded", async (t) => {
  const directory = temporary();
  const api = createSocialApi({ auth, siteOrigin: "https://bloomclient.org", env: { BLOOM_SOCIAL_DATA_DIR: directory } });
  t.after(() => { api.database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const parks = await authorize(api, "account-a", crypto.randomUUID());
  const karsten = await authorize(api, "account-b", crypto.randomUUID());
  await call(api, { method: "POST", path: "/v1/social/friend-requests", token: parks.accessToken, body: { username: "Karsten" } });
  assert.equal((await call(api, { method: "POST", path: `/v1/social/friend-requests/${parks.user.id}/accept`, token: karsten.accessToken })).status, 200);

  const baseline = await call(api, { path: "/v1/social/changes?waitMs=0", token: karsten.accessToken });
  assert.equal(baseline.status, 200);
  assert.match(baseline.body.cursor, /^[0-9a-f]{64}$/);
  const idle = await call(api, { path: `/v1/social/changes?after=${baseline.body.cursor}&waitMs=0`, token: karsten.accessToken });
  assert.deepEqual(idle.body, { cursor: baseline.body.cursor, changed: false, scopes: [] });

  const send = (nonce) => call(api, {
    method: "POST",
    path: "/v1/social/envelopes",
    token: parks.accessToken,
    body: { recipientId: karsten.user.id, clientNonce: nonce, eventKind: "message", envelopes: [{ deviceId: karsten.authorization.deviceId, ciphertext: `encrypted-${nonce}` }] },
  });
  const retryNonce = "rapid-retry-message-0001";
  const waiting = Array.from({ length: 16 }, () => call(api, { path: `/v1/social/changes?after=${baseline.body.cursor}&waitMs=1000`, token: karsten.accessToken }));
  await new Promise(resolve => setImmediate(resolve));
  const overflow = await call(api, { path: `/v1/social/changes?after=${baseline.body.cursor}&waitMs=1000`, token: karsten.accessToken });
  assert.equal(overflow.status, 429);
  assert.equal((await send(retryNonce)).status, 202);
  const [pushed, ...otherWaiters] = await Promise.all(waiting);
  assert.equal(pushed.body.changed, true);
  assert.deepEqual(pushed.body.scopes, ["messages"]);
  assert.equal(otherWaiters.every(result => result.body.changed && result.body.scopes[0] === "messages"), true);
  const changed = await call(api, { path: `/v1/social/changes?after=${baseline.body.cursor}&waitMs=0`, token: karsten.accessToken });
  assert.equal(changed.body.changed, true);
  assert.notEqual(changed.body.cursor, baseline.body.cursor);
  assert.equal((await send(retryNonce)).status, 202);
  assert.equal(api.database.prepare("SELECT count(*) count FROM social_envelopes WHERE client_nonce = ?").get(retryNonce).count, 1);

  const burst = await Promise.all(Array.from({ length: 29 }, (_, index) => send(`rapid-message-${String(index).padStart(4, "0")}`)));
  assert.equal(burst.every(result => result.status === 202), true);
  const limited = await Promise.all(Array.from({ length: 5 }, (_, index) => send(`limited-message-${String(index).padStart(4, "0")}`)));
  assert.equal(limited.every(result => result.status === 429), true);

  const inbox = await call(api, { path: "/v1/social/envelopes?after=0", token: karsten.accessToken });
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.envelopes.length, 30);
  const rows = api.database.prepare("SELECT client_nonce FROM social_envelopes ORDER BY sequence").all();
  assert.equal(new Set(rows.map(row => row.client_nonce)).size, 30);
  assert.equal(rows.some(row => row.client_nonce === retryNonce), true);
});

test("existing envelope tables migrate to encrypted pin event routing", (t) => {
  const directory = temporary();
  const file = path.join(directory, "social.sqlite");
  const legacy = new DatabaseSync(file);
  legacy.exec(`CREATE TABLE social_envelopes (sequence INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_device_id TEXT NOT NULL, recipient_id TEXT NOT NULL, recipient_device_id TEXT NOT NULL, client_nonce TEXT NOT NULL, event_kind TEXT NOT NULL CHECK(event_kind IN ('message','reaction','security')), ciphertext TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(sender_device_id, client_nonce, recipient_device_id)); CREATE TABLE social_group_envelopes (sequence INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, sender_id TEXT NOT NULL, sender_device_id TEXT NOT NULL, recipient_id TEXT NOT NULL, recipient_device_id TEXT NOT NULL, client_nonce TEXT NOT NULL, event_kind TEXT NOT NULL CHECK(event_kind IN ('message','reaction','security')), ciphertext TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(sender_device_id, client_nonce, recipient_device_id));`);
  legacy.close();
  const api = createSocialApi({ auth, siteOrigin: "https://bloomclient.org", env: { BLOOM_SOCIAL_DATA_DIR: directory } });
  t.after(() => { api.database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.match(api.database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'social_envelopes'").get().sql, /'pin'/);
  assert.match(api.database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'social_envelopes'").get().sql, /'edit'/);
  assert.equal(api.database.prepare("SELECT count(*) count FROM social_envelopes").get().count, 0);
});

test("instance invites are idempotent, friend-scoped, and claimed exactly once", async (t) => {
  const directory = temporary();
  const closedCodes = [];
  const api = createSocialApi({ auth, siteOrigin: "https://bloomclient.org", env: { BLOOM_SOCIAL_DATA_DIR: directory }, onInstanceInviteClosed: code => closedCodes.push(code) });
  t.after(() => { api.database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const parks = await authorize(api, "account-a", crypto.randomUUID());
  const karsten = await authorize(api, "account-b", crypto.randomUUID());
  const alex = await authorize(api, "account-c", crypto.randomUUID());
  await call(api, { method: "POST", path: "/v1/social/friend-requests", token: parks.accessToken, body: { username: "Karsten" } });
  assert.equal((await call(api, { method: "POST", path: `/v1/social/friend-requests/${parks.user.id}/accept`, token: karsten.accessToken })).status, 200);
  const request = { requestKey: "instance-share-request-1234", instanceName: "SMP Dules", minecraftVersion: "1.21.1", loader: "Fabric", iconDataUrl: "data:image/webp;base64,AAAA", shareMode: "copy", invites: [{ recipientId: karsten.user.id, shareCode: "BCDF2345", role: "member" }] };
  const created = await call(api, { method: "POST", path: "/v1/social/instance-invites", token: parks.accessToken, body: request });
  assert.equal(created.status, 201);
  assert.equal(created.body.invites.length, 1);
  assert.deepEqual(created.body.newInviteIds, [created.body.invites[0].id]);
  assert.equal(created.body.invites[0].sender.username, "Parks");
  assert.equal(created.body.invites[0].recipient.username, "Karsten");
  assert.equal(created.body.invites[0].iconDataUrl, request.iconDataUrl);
  const repeated = await call(api, { method: "POST", path: "/v1/social/instance-invites", token: parks.accessToken, body: request });
  assert.equal(repeated.status, 201);
  assert.equal(repeated.body.invites[0].id, created.body.invites[0].id);
  assert.deepEqual(repeated.body.newInviteIds, []);
  const rejected = await call(api, { method: "POST", path: "/v1/social/instance-invites", token: parks.accessToken, body: { ...request, requestKey: "instance-share-request-5678", invites: [{ recipientId: alex.user.id, shareCode: "BCDF2345", role: "member" }] } });
  assert.equal(rejected.status, 400);
  const inviteId = created.body.invites[0].id;
  const claim = await call(api, { method: "POST", path: `/v1/social/instance-invites/${inviteId}/claim`, token: karsten.accessToken });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.shareCode, "BCDF2345");
  assert.equal((await call(api, { method: "POST", path: `/v1/social/instance-invites/${inviteId}/revoke`, token: parks.accessToken })).status, 409);
  assert.equal((await call(api, { method: "POST", path: `/v1/social/instance-invites/${inviteId}/decline`, token: karsten.accessToken })).status, 409);
  assert.equal((await call(api, { method: "POST", path: `/v1/social/instance-invites/${inviteId}/claim`, token: karsten.accessToken })).status, 409);
  assert.equal((await call(api, { method: "POST", path: `/v1/social/instance-invites/${inviteId}/release`, token: karsten.accessToken, body: { claimToken: claim.body.claimToken } })).status, 200);
  const retry = await call(api, { method: "POST", path: `/v1/social/instance-invites/${inviteId}/claim`, token: karsten.accessToken });
  assert.equal(retry.status, 200);
  assert.equal((await call(api, { method: "POST", path: `/v1/social/instance-invites/${inviteId}/complete`, token: karsten.accessToken, body: { claimToken: retry.body.claimToken } })).status, 200);
  assert.equal((await call(api, { method: "POST", path: `/v1/social/instance-invites/${inviteId}/claim`, token: karsten.accessToken })).status, 409);
  const inbox = await call(api, { path: "/v1/social/instance-invites", token: karsten.accessToken });
  assert.equal(inbox.body.invites[0].status, "accepted");
  assert.equal(inbox.body.invites[0].shareCode, undefined);
  const declineRequest = { ...request, requestKey: "instance-share-request-9012", shareMode: "synced", invites: [{ recipientId: karsten.user.id, shareCode: "GHJK6789", role: "member" }] };
  const declineCreated = await call(api, { method: "POST", path: "/v1/social/instance-invites", token: parks.accessToken, body: declineRequest });
  assert.equal((await call(api, { method: "POST", path: `/v1/social/instance-invites/${declineCreated.body.invites[0].id}/decline`, token: karsten.accessToken })).status, 200);
  assert.deepEqual(closedCodes, ["GHJK6789"]);
  const secureCode = "AB".repeat(32);
  const secureInvite = await call(api, { method: "POST", path: "/v1/social/instance-invites", token: parks.accessToken, body: {
    ...declineRequest, requestKey: "synced-instance-request-123", invites: [{ recipientId: karsten.user.id, shareCode: secureCode, role: "editor" }],
  } });
  assert.equal(secureInvite.status, 201);
  const securePath = `/v1/social/instance-invites/${secureInvite.body.invites[0].id}`;
  const secureClaim = await call(api, { method: "POST", path: `${securePath}/claim`, token: karsten.accessToken });
  const recipient = { headers: { authorization: `Bearer ${karsten.accessToken}` } };
  const outsider = { headers: { authorization: `Bearer ${alex.accessToken}` } };
  const grant = api.authorizePackClaim(recipient, secureCode, secureClaim.body.claimToken);
  assert.equal(grant?.role, "editor");
  assert.equal(api.authorizePackClaim(outsider, secureCode, secureClaim.body.claimToken), null);
  assert.equal(api.packClaimAccepted(secureCode, karsten.user.id, grant.claimHash), false);
  const complete = { method: "POST", path: `${securePath}/complete`, token: karsten.accessToken, body: { claimToken: secureClaim.body.claimToken } };
  assert.equal((await call(api, complete)).status, 200);
  assert.equal((await call(api, complete)).status, 200);
  assert.equal(api.packClaimAccepted(secureCode, karsten.user.id, grant.claimHash), true);
});

test("group chats cap membership, require friendships, and deliver only to members", async (t) => {
  const directory = temporary();
  const api = createSocialApi({ auth, siteOrigin: "https://bloomclient.org", env: { BLOOM_SOCIAL_DATA_DIR: directory } });
  t.after(() => { api.database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const parks = await authorize(api, "account-a", crypto.randomUUID());
  const karsten = await authorize(api, "account-b", crypto.randomUUID());
  const alex = await authorize(api, "account-c", crypto.randomUUID());
  await call(api, { method: "POST", path: "/v1/social/friend-requests", token: parks.accessToken, body: { username: "Karsten" } });
  assert.equal((await call(api, { method: "POST", path: `/v1/social/friend-requests/${parks.user.id}/accept`, token: karsten.accessToken })).status, 200);
  await call(api, { method: "POST", path: "/v1/social/friend-requests", token: karsten.accessToken, body: { username: "Alex" } });
  assert.equal((await call(api, { method: "POST", path: `/v1/social/friend-requests/${karsten.user.id}/accept`, token: alex.accessToken })).status, 200);
  const created = await call(api, { method: "POST", path: "/v1/social/groups", token: parks.accessToken, body: { name: "Bloom Friends", memberIds: [karsten.user.id] } });
  assert.equal(created.status, 201);
  assert.equal(created.body.group.members.length, 2);
  const groupId = created.body.group.id;
  const devices = await call(api, { path: `/v1/social/users/${karsten.user.id}/devices`, token: parks.accessToken });
  assert.equal(devices.status, 200);
  assert.deepEqual(devices.body.devices, [{ deviceId: karsten.authorization.deviceId, curve25519Key: "curve-key-material-123456789", ed25519Key: "signing-key-material-123456789" }]);
  const ownDevices = await call(api, { path: `/v1/social/users/${parks.user.id}/devices`, token: parks.accessToken });
  assert.equal(ownDevices.status, 200);
  assert.equal(ownDevices.body.devices[0].ed25519Key, "signing-key-material-123456789");
  const added = await call(api, { method: "POST", path: `/v1/social/groups/${groupId}/members`, token: karsten.accessToken, body: { userId: alex.user.id } });
  assert.equal(added.status, 200);
  assert.equal(added.body.group.members.length, 3);
  const updated = await call(api, { method: "PATCH", path: `/v1/social/groups/${groupId}`, token: karsten.accessToken, body: { name: "Bloom Crew", iconDataUrl: "data:image/webp;base64,Ymxvb20=" } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.group.name, "Bloom Crew");
  assert.equal(updated.body.group.iconDataUrl, "data:image/webp;base64,Ymxvb20=");
  assert.equal((await call(api, { path: "/v1/social/groups", token: alex.accessToken })).body.groups[0].id, groupId);
  const delivered = await call(api, { method: "POST", path: `/v1/social/groups/${groupId}/envelopes`, token: parks.accessToken, body: { recipientId: karsten.user.id, clientNonce: "group-message-nonce-1234", eventKind: "message", envelopes: [{ deviceId: karsten.authorization.deviceId, ciphertext: "encrypted-message" }] } });
  assert.equal(delivered.status, 202);
  const sameLogicalMessage = await call(api, { method: "POST", path: `/v1/social/groups/${groupId}/envelopes`, token: parks.accessToken, body: { recipientId: alex.user.id, clientNonce: "group-message-nonce-1234", eventKind: "message", envelopes: [{ deviceId: alex.authorization.deviceId, ciphertext: "encrypted-message-for-alex" }] } });
  assert.equal(sameLogicalMessage.status, 202);
  const burst = await Promise.all(Array.from({ length: 59 }, (_, index) => call(api, { method: "POST", path: `/v1/social/groups/${groupId}/envelopes`, token: parks.accessToken, body: { recipientId: karsten.user.id, clientNonce: `group-burst-message-${String(index).padStart(4, "0")}`, eventKind: "message", envelopes: [{ deviceId: karsten.authorization.deviceId, ciphertext: `encrypted-group-${index}` }] } })));
  assert.equal(burst.every(result => result.status === 202), true);
  const limited = await call(api, { method: "POST", path: `/v1/social/groups/${groupId}/envelopes`, token: parks.accessToken, body: { recipientId: karsten.user.id, clientNonce: "group-burst-message-limited", eventKind: "message", envelopes: [{ deviceId: karsten.authorization.deviceId, ciphertext: "encrypted-limited" }] } });
  assert.equal(limited.status, 429);
  const inbox = await call(api, { path: "/v1/social/group-envelopes?after=0", token: karsten.accessToken });
  assert.equal(inbox.body.envelopes[0].groupId, groupId);
  const removed = await call(api, { method: "DELETE", path: `/v1/social/groups/${groupId}/members/${alex.user.id}`, token: parks.accessToken });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.group.members.length, 2);
  assert.equal((await call(api, { path: "/v1/social/groups", token: alex.accessToken })).body.groups.length, 0);
});

test("Java players keep separate social graphs when linked and unlinked from one website login", async t => {
  const directory = temporary();
  const people = Object.fromEntries(["MainPlayer","AltPlayer","Third"].map(name=>[name,{id:crypto.randomUUID().replaceAll("-",""),name}]));
  let owner="web-account";
  const api=createSocialApi({auth:{api:{getSession:async()=>({user:{id:owner}})}},siteOrigin:"https://bloomclient.org",env:{BLOOM_SOCIAL_DATA_DIR:directory},verifyPlayer:async(token)=>{
    if(!people[token])throw Object.assign(new Error("Invalid proof"),{status:401});
    return people[token];
  }});
  t.after(()=>{api.database.close();fs.rmSync(directory,{recursive:true,force:true});});
  const login=async token=>call(api,{path:"/v1/social/native/player",method:"POST",token,body:{deviceId:crypto.randomUUID(),curve25519Key:"verified-device-curve-key",ed25519Key:"verified-device-sign-key"}});
  assert.equal((await login("invalid")).status,401);
  const first=(await login("MainPlayer")).body, second=(await login("AltPlayer")).body, third=(await login("Third")).body;
  assert.ok(first.accessToken && second.accessToken && third.accessToken);
  assert.notEqual(first.user.id,second.user.id);
  const act=(p,path,body,method=body?"POST":"GET")=>call(api,{token:p.accessToken,path:"/v1/social/"+path,body,method});
  for(const p of [first,second]){
    assert.equal((await act(p,"me/link-status")).body.linked,false);
    const {code}=(await act(p,"me/link-code",{})).body;
    assert.match(code,/^[0-9]{8}$/);
    assert.equal((await act(p,"player-links",{code})).status,200);
    assert.equal((await act(p,"me/link-status")).body.linked,true);
    assert.equal((await act(p,"player-links",{code})).status,400);
  }
  assert.equal((await act(first,"player-links")).body.players.length,2);
  owner="another-owner";
  assert.equal((await act(first,"player-links",{code:(await act(first,"me/link-code",{})).body.code})).status,409);
  owner="web-account";
  assert.equal((await act(first,"friend-requests",{username:"Third"})).status,201);
  assert.equal((await act(third,"friend-requests/"+first.user.id+"/accept",{})).status,200);
  assert.equal((await act(second,"friends")).body.friends.length,0);
  const party = (await act(first,"party",{action:"create"})).body.party;
  const change = (player,action,fields={}) => act(player,"party",{action,partyId:party.id,...fields});
  assert.equal((await change(first,"invite",{friendId:second.user.id})).status,409);
  assert.equal((await change(first,"invite",{friendId:third.user.id})).status,200);
  assert.equal((await act(third,"party")).body.invites[0].name,"MainPlayer");
  assert.equal((await change(second,"accept")).status,409);
  assert.equal((await change(third,"accept")).body.party.members.length,2);
  const lease = crypto.randomUUID();
  const sharedAddress = async () => (await act(first,"party")).body.party.members.find(m=>m.id===third.user.id).server;
  assert.equal((await change(third,"share",{lease,server:"https://example.org"})).status,409);
  assert.equal((await change(third,"share",{lease,server:"play.example.org:25565"})).status,200);
  assert.equal(await sharedAddress(),"play.example.org:25565");
  assert.equal((await change(third,"renew",{lease})).status,200);
  await change(third,"stop",{lease:crypto.randomUUID()});
  assert.ok(await sharedAddress());
  await change(third,"stop");
  assert.equal(await sharedAddress(),null);
  assert.equal((await change(third,"renew",{lease})).status,409);
  await change(third,"share",{lease,server:"example.org"});
  api.database.prepare("UPDATE play_shares SET expires=0").run();
  assert.equal(await sharedAddress(),null);
  assert.equal((await change(third,"renew",{lease})).status,409);
  assert.equal((await change(first,"leave")).status,200);
  assert.ok(!(await act(third,"party")).body.party);
  const fresh = (await act(first,"party",{action:"create"})).body.party.id;
  const inviteThird = () => act(first,"party",{action:"invite",partyId:fresh,friendId:third.user.id});
  await inviteThird();
  api.database.prepare("UPDATE play_invites SET expires=0 WHERE party=?").run(fresh);
  assert.equal((await act(third,"party",{action:"accept",partyId:fresh})).status,409);
  await inviteThird();
  assert.equal((await act(third,"party",{action:"decline",partyId:fresh})).status,200);
  assert.equal((await act(third,"party")).body.invites.length,0);
  api.database.prepare("UPDATE play_parties SET expires=0 WHERE id=?").run(fresh);
  assert.ok(!(await act(first,"party")).body.party);


  const invite={requestKey:"player-invite-test-12345",instanceName:"Test",minecraftVersion:"26.3",loader:"fabric",shareMode:"copy",invites:[{recipientId:first.user.id,shareCode:"BCDF2345"}]};
  assert.equal((await act(third,"instance-invites",invite)).status,201);
  assert.equal((await act(second,"instance-invites")).body.invites.length,0);
  assert.equal((await act(first,"me/visibility",{hidden:true},"PUT")).body.hidden,true);
  assert.equal((await act(third,"friends")).body.friends[0].online,false);
  assert.equal((await act(first,"player-links",{id:first.user.id},"DELETE")).status,200);
  assert.equal((await act(first,"friends")).body.friends[0].id,third.user.id);
  assert.equal((await act(first,"instance-invites")).body.invites.length,1);
  people.MainPlayer.name="Renamed";
  assert.equal((await login("MainPlayer")).body.user.id,first.user.id);
});
