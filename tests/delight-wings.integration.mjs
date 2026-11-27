import assert from "node:assert/strict";
import { createHash, scryptSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createCosmeticsApi } from "../backend/cosmetics/api.mjs";
import { ApiError } from "../backend/cosmetics/assets.mjs";
import { SqliteCosmeticsStore } from "../backend/cosmetics/sqlite-store.mjs";
import { check } from "../scripts/delight-wings.mjs";

const serving = process.argv.includes("--serve");
const cache = new URL("../node_modules/.cache/", import.meta.url);
await mkdir(cache, { recursive: true });
const directory = await mkdtemp(fileURLToPath(new URL("model-cosmetics-", cache)));
const host = "127.0.0.1";
const store = new SqliteCosmeticsStore({ directory, publicUrl: "https://local.invalid" });
const idBytes = createHash("md5").update("OfflinePlayer:DelightPreview").digest();
idBytes[6] = (idBytes[6] & 0x0f) | 0x30;
idBytes[8] = (idBytes[8] & 0x3f) | 0x80;
const previewPlayer = idBytes.toString("hex");
const other = "b".repeat(32), ownerId = "a".repeat(32);
const password = "test-only-delight-studio";
const salt = "a".repeat(32);
const api = createCosmeticsApi({
  store, owners: [ownerId], studioPasswordHash: salt + ":" + scryptSync(password, salt, 32).toString("hex"),
  verify: async token => {
    if (token === "local-preview-player") return previewPlayer;
    if (token === "local-other-player") return other;
    if (token === "local-owner-player") return ownerId;
    throw new ApiError(401, "sign_in_required");
  },
});
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (!(await api.handle(request, response, url.pathname, url))) response.writeHead(404).end();
});
server.listen(serving ? 19192 : 0, host);
await once(server, "listening");
const base = "http://" + host + ":" + server.address().port;
const { entries } = JSON.parse(await readFile(new URL("../public/delight-wings/catalog.json", import.meta.url), "utf8"));
const wing = entries.find(item => item.slot === undefined);
const hat = entries.find(item => item.slot === "hat");
const hatKey = { id: hat.id, revision: hat.revision };
const hatColors = { left: "#ab5f72", right: "#b2aced", trim: "#362650", rightOuter: "#18a6a0" };
const colors = { left: "#385acb", right: "#f2eee3", trim: "#d8aa55" };
const key = { id: wing.id, revision: wing.revision };

async function call(method, path, token, body, status = 200) {
  const response = await fetch(base + "/v1/" + path, {
    method,
    headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
async function run() {
  assert(check() >= 1);
  assert.deepEqual((await call("GET", "wings/shop")).items, []);
  await call("PUT", "admin/studio/wings", "local-owner-player", wing, 403);
  await call("POST", "admin/studio/session", null, { password: "test-invalid-passphrase" }, 401);
  const { token } = await call("POST", "admin/studio/session", null, { password }, 201);
  await call("PUT", "admin/studio/wings", token, wing);
  await call("PUT", "admin/studio/wings", token, { ...wing, name: "Conflicting name" }, 409);
  await call("POST", "wings/claim", "local-preview-player", key, 404);
  await call("POST", "admin/studio/wings/publish", token, key);
  await call("PUT", "admin/studio/hats", "local-owner-player", hat, 403);
  await call("PUT", "admin/studio/hats", token, { ...hat, defaults: colors }, 400);
  await call("PUT", "admin/studio/hats", token, hat);
  assert.deepEqual((await call("GET", "hats/shop")).items, []);
  await call("POST", "admin/studio/hats/publish", token, hatKey);
  await call("DELETE", "admin/studio/session", token);
  await call("PUT", "admin/studio/wings", token, wing, 401);
  assert.deepEqual((await call("GET", "wings/shop")).items.map(item => item.revision), [wing.revision]);
  await call("PUT", "wings/equipped", "local-preview-player", { ...key, colors }, 403);
  await call("POST", "wings/claim", "local-preview-player", key);
  await call("POST", "wings/claim", "local-preview-player", key);
  await call("PUT", "wings/equipped", "local-preview-player", { ...key, colors: { ...colors, trim: "invalid" } }, 400);
  await call("PUT", "wings/equipped", "local-preview-player", { ...key, colors });
  assert.deepEqual((await call("GET", "wings/equipped?uuids=" + previewPlayer + "," + other)).items,
    [{ uuid: previewPlayer, ...key, colors }]);
  assert.deepEqual((await call("GET", "wings/locker", "local-other-player")).items, []);
  await call("PUT", "wings/equipped", "local-preview-player", { id: null });
  assert.deepEqual((await call("GET", "hats/shop")).items.map(item => item.id), [hat.id]);
  await call("GET", "hats/locker", null, undefined, 401);
  await call("PUT", "hats/equipped", "local-preview-player", { ...hatKey, colors: hatColors }, 403);
  await call("POST", "hats/claim", "local-preview-player", hatKey);
  await call("PUT", "hats/equipped", "local-preview-player", { ...hatKey, colors }, 400);
  await call("PUT", "hats/equipped", "local-preview-player", { ...hatKey, colors: hatColors });
  await call("PUT", "wings/equipped", "local-preview-player", { ...key, colors });
  assert.deepEqual((await call("GET", "hats/equipped?uuids=" + previewPlayer + "," + other)).items,
    [{ uuid: previewPlayer, ...hatKey, colors: hatColors }]);
  assert.equal((await call("GET", "wings/locker", "local-preview-player")).equipped.id, wing.id);
  await call("PUT", "hats/equipped", "local-preview-player", { id: null });
  const hatLocker = await call("GET", "hats/locker", "local-preview-player");
  assert.equal(hatLocker.equipped, null);
  assert.deepEqual(hatLocker.items[0].configured, hatColors);
  await call("PUT", "wings/equipped", "local-preview-player", { id: null });
  const locker = await call("GET", "wings/locker", "local-preview-player");
  assert.equal(locker.equipped, null);
  assert.deepEqual(locker.items[0].configured, colors);
  const syringe = entries.find(item => item.slot === "back");
  const owner = await call("POST", "admin/studio/session", null, { password }, 201);
  await call("PUT", "admin/studio/wings", owner.token, syringe);
  await call("POST", "admin/studio/wings/publish", owner.token, syringe);
  await call("POST", "wings/claim", "local-preview-player", syringe);
  const custom = { ...syringe.defaults, plunger: "#060508", rightOuter: "#445566" };
  await call("PUT", "wings/equipped", "local-preview-player", { ...syringe, colors }, 400);
  await call("PUT", "wings/equipped", "local-preview-player", { ...syringe, colors: custom });
  assert.deepEqual((await call("GET", "wings/equipped?uuids=" + previewPlayer)).items[0].colors, custom);
  await call("PUT", "wings/equipped", "local-preview-player", { ...key, colors });
  assert.deepEqual((await call("GET", "wings/locker", "local-preview-player")).items.find(i => i.id === syringe.id).configured, custom);
  if (serving) {
    await call("PUT", "wings/equipped", "local-preview-player", { ...key, colors: wing.defaults });
    await call("PUT", "hats/equipped", "local-preview-player", { ...hatKey, colors: hat.defaults });
  }
}
async function close() {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  store.close();
  await rm(directory, { recursive: true, force: true });
}
try {
  await run();
  console.log(serving ? "Local wing preview running at " + base : "Wing and hat publishing, ownership, independent slots and saved colors passed.");
  if (serving) {
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
  } else await close();
} catch (error) {
  await close();
  throw error;
}
