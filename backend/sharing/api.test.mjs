import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createSharingApi, MemoryShareStore, SqliteShareStore } from "./api.mjs";

const manifest = {
  schemaVersion: 1,
  name: "Friends Pack",
  minecraftVersion: "1.21.1",
  loader: "fabric",
  loaderVersion: "0.16.10",
  missingMods: ["private-helper.jar"],
  files: [{ path: "mods/example.jar", hashes: { sha1: "a".repeat(40) }, downloads: ["https://cdn.modrinth.com/data/a/versions/b/example.jar"] }],
};

test("creates and retrieves a short-lived pack share", async (t) => {
  let now = 1_000;
  const api = createSharingApi({ store: new MemoryShareStore({ now: () => now }), now: () => now, ttlMs: 1_000, publicUrl: "https://api.example/minecraft", codeFactory: () => "BCDF2345" });
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (!(await api.handle(request, response, path))) response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await fetch(`${base}/v1/packs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(manifest) });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).code, "BCDF2345");
  const loaded = await fetch(`${base}/v1/packs/BCDF2345`);
  assert.equal(loaded.status, 200);
  assert.deepEqual((await loaded.json()).manifest, { ...manifest, files: [{ ...manifest.files[0], env: { client: "required", server: "required" } }] });
  now = 2_001;
  assert.equal((await fetch(`${base}/v1/packs/BCDF2345`)).status, 404);
});

test("rejects untrusted downloads and unsafe paths", async () => {
  const store = new MemoryShareStore();
  const api = createSharingApi({ store, codeFactory: () => "BCDF2345" });
  const run = async (changed) => {
    const server = http.createServer((request, response) => api.handle(request, response, new URL(request.url, "http://localhost").pathname));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/packs`, { method: "POST", body: JSON.stringify(changed) });
    server.close(); return response.status;
  };
  assert.equal(await run({ ...manifest, files: [{ ...manifest.files[0], path: "../bad.jar" }] }), 400);
  assert.equal(await run({ ...manifest, files: [{ ...manifest.files[0], downloads: ["https://evil.example/mod.jar"] }] }), 400);
  assert.equal(await run({ ...manifest, missingMods: ["../private.jar"] }), 400);
});

test("accepts a filename-only share when no local mods resolve through Modrinth", async () => {
  const store = new MemoryShareStore();
  const api = createSharingApi({ store, codeFactory: () => "BCDF2345" });
  const server = http.createServer((request, response) => api.handle(request, response, new URL(request.url, "http://localhost").pathname));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/packs`, { method: "POST", body: JSON.stringify({ ...manifest, files: [], missingMods: ["[Private] Helper, v2.jar"] }) });
  assert.equal(response.status, 201);
  server.close();
});

test("existing pack-channel databases migrate to managed access without enabling legacy rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "bloom-sharing-access-"));
  let store;
  try {
    const legacy = new DatabaseSync(join(directory, "shares.sqlite"));
    legacy.exec("CREATE TABLE pack_channels (code TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, revision INTEGER NOT NULL, owner_hash TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    legacy.close();
    store = new SqliteShareStore(directory);
    const columns = store.db.prepare("PRAGMA table_info(pack_channels)").all().map(row => row.name);
    assert.equal(columns.includes("access_enabled"), true);
    store.db.prepare("INSERT INTO pack_channels(code,manifest_json,revision,owner_hash,created_at,updated_at,access_enabled) VALUES(?,?,1,?,?,?,0)").run("GHJK6789", JSON.stringify(manifest), "legacy-owner", 1, 1);
    store.db.prepare("INSERT INTO pack_channel_editors(channel_code,token_hash,created_at) VALUES(?,?,?)").run("GHJK6789", "legacy-editor", 1);
    assert.equal(store.accessFor(store.getChannel("GHJK6789"), "legacy-editor").role, "editor");
    store.createChannel("BCDF2345", manifest, "owner-hash");
    assert.equal(store.getChannel("BCDF2345").accessEnabled, true);
  } finally { store?.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("pack channels enforce per-person roles, revocation, and invite invalidation", async (t) => {
  const codes = ["BCDF2345", "GHJK6789", "MNPQ2345", "RSTW6789"];
  const invalidated = [];
  const api = createSharingApi({ store: new MemoryShareStore(), codeFactory: () => codes.shift() || "VWXY2345", onInviteInvalidated: code => invalidated.push(code) });
  const server = http.createServer((request, response) => api.handle(request, response, new URL(request.url, "http://localhost").pathname));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = await fetch(`${base}/v1/pack-channels`, { method: "POST", body: JSON.stringify(manifest) }).then(r => r.json());
  const ownerHeaders = { authorization: `Bearer ${owner.ownerToken}` };
  assert.equal((await fetch(`${base}/v1/pack-channels/${owner.code}`)).status, 403);

  const memberInvite = await fetch(`${base}/v1/pack-channels/${owner.code}/invites`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ recipientId: "member_123", role: "member" }) }).then(r => r.json());
  const member = await fetch(`${base}/v1/pack-channels/invites/redeem`, { method: "POST", body: JSON.stringify({ code: memberInvite.code }) }).then(r => r.json());
  assert.equal(member.role, "member");
  assert.equal((await fetch(`${base}/v1/pack-channels/${owner.code}`, { headers: { authorization: `Bearer ${member.accessToken}` } })).status, 200);
  assert.equal((await fetch(`${base}/v1/pack-channels/${owner.code}`, { method: "PUT", headers: { authorization: `Bearer ${member.accessToken}` }, body: JSON.stringify({ baseRevision: 1, manifest }) })).status, 403);

  const editorInvite = await fetch(`${base}/v1/pack-channels/${owner.code}/invites`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ recipientId: "editor_456", role: "editor" }) }).then(r => r.json());
  const editor = await fetch(`${base}/v1/pack-channels/invites/redeem`, { method: "POST", body: JSON.stringify({ code: editorInvite.code }) }).then(r => r.json());
  const published = await fetch(`${base}/v1/pack-channels/${owner.code}`, { method: "PUT", headers: { authorization: `Bearer ${editor.accessToken}` }, body: JSON.stringify({ baseRevision: 1, manifest: { ...manifest, name: "Friends Pack Updated" } }) });
  assert.equal(published.status, 200); assert.equal((await published.json()).revision, 2);

  const overview = await fetch(`${base}/v1/pack-channels/${owner.code}/access`, { headers: ownerHeaders }).then(r => r.json());
  assert.equal(overview.members.length, 2);
  const memberGrant = overview.members.find(item => item.recipientId === "member_123");
  assert.equal((await fetch(`${base}/v1/pack-channels/${owner.code}/access/${memberGrant.id}`, { method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ role: "editor" }) })).status, 200);
  const editorGrant = overview.members.find(item => item.recipientId === "editor_456");
  assert.equal((await fetch(`${base}/v1/pack-channels/${owner.code}/access/${editorGrant.id}`, { method: "DELETE", headers: ownerHeaders })).status, 200);
  assert.equal((await fetch(`${base}/v1/pack-channels/${owner.code}`, { headers: { authorization: `Bearer ${editor.accessToken}` } })).status, 403);

  const pending = await fetch(`${base}/v1/pack-channels/${owner.code}/invites`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ recipientId: "pending_789", role: "member" }) }).then(r => r.json());
  const changedPending = await fetch(`${base}/v1/pack-channels/${owner.code}/invites`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ recipientId: "pending_789", role: "editor" }) }).then(r => r.json());
  assert.equal(changedPending.id, pending.id); assert.equal(changedPending.role, "editor");
  assert.equal((await fetch(`${base}/v1/pack-channels/${owner.code}/invites/${pending.id}`, { method: "DELETE", headers: ownerHeaders })).status, 200);
  assert.deepEqual(invalidated, [pending.id]);
  assert.equal((await fetch(`${base}/v1/pack-channels/invites/redeem`, { method: "POST", body: JSON.stringify({ code: pending.code }) })).status, 404);
});
