import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createWorkspacePacks, workspacePacksFromEnvironment } from "./workspace-packs.mjs";

test("workspace public links require a hostname over HTTPS", () => {
  for (const url of ["http://api.north.bloomclient.org/minecraft", "https://127.0.0.1/minecraft",
    "https://[::1]/minecraft", "https://preview.localhost/minecraft", "https://user:secret@api.example/minecraft"]) {
    assert.throws(() => workspacePacksFromEnvironment(() => null, {BLOOM_SHARE_PUBLIC_URL:url}), /public HTTPS hostname/);
  }
});

const runtime = { name: "Meadow & Grove", minecraftVersion: "1.21.1", loader: "fabric", loaderVersion: "0.16.10" };
const mod = { category: "mods", fileName: "meadow.jar", enabled: true, size: 12, source: "modrinth", sha512: "a".repeat(128), projectId: "PeA", versionId: "VeA" };
const pack = { category: "resourcepacks", fileName: "paint.zip.disabled", enabled: false, size: 14, source: "modrinth", sha512: "b".repeat(128), projectId: "PeB", versionId: "VeB" };
const bodyFor = () => ({ publicationId: randomUUID(), termsVersion: "1", publisherId: "private-owner-id", releaseNote: "Our first build",
  manifest: { ...runtime, files: [mod, pack], excludedFolders: ["config"] } });
function version(file) {
  return { id: file.versionId, project_id: file.projectId, game_versions: [runtime.minecraftVersion],
    loaders: file.category === "mods" ? ["fabric"] : ["minecraft"], dependencies: [],
    files: [{ hashes: { sha512: file.sha512 }, size: file.size, url: "https://cdn.modrinth.com/data/" + file.projectId + "/versions/" + file.versionId + "/download" }] };
}

async function serve(t, options = {}) {
  const database = new DatabaseSync(options.filename || ":memory:");
  let api;
  const server = http.createServer(async (request, response) => {
    if (!await api.handle(request, response, new URL(request.url, "http://localhost").pathname)) response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const catalog = { [mod.sha512]: version(mod), [pack.sha512]: version(pack) };
  const provider = async (url, init) => {
    if (url.startsWith("https://meta.fabricmc.net/")) return Response.json([{ loader: { version: runtime.loaderVersion } }]);
    assert.equal(url, "https://api.modrinth.com/v2/version_files");
    assert.equal(JSON.parse(init.body).algorithm, "sha512");
    return Response.json(catalog);
  };
  let signedIn = true;
  api = createWorkspacePacks({ database, publicUrl: base, fetchImpl: options.fetchImpl || provider, authorProfile: options.authorProfile,
    authenticate: request => {
      if (!signedIn) return null;
      const auth = request.headers.authorization;
      if (auth === "Bearer fixture-owner") return { id: "private-owner-id", username: "meadow-builder" };
      if (auth === "Bearer fixture-other") return { id: "private-other-id", username: "other" };
      if (auth === "Bearer fixture-third") return { id: "private-third-id", username: "third" };
      return null;
    }, ...(options.now ? {now: options.now} : {}) });
  let open = true;
  const close = async () => {
    if (!open) return;
    open = false;
    await new Promise(resolve => server.close(resolve));
    database.close();
  };
  t.after(close);
  return { base, database, catalog, close, revoke: () => { signedIn = false; },
    post: (body, account = "owner") => fetch(base + "/v1/workspace-packs", { method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer fixture-" + account }, body: JSON.stringify(body) }),
    update: (code, body, account = "owner") => fetch(base + "/v1/workspace-packs/" + code + "/releases", { method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer fixture-" + account }, body: JSON.stringify(body) }),
  };
}

test("collaborator links consume uses atomically and only named publishers can append optional releases", async t => {
  let time = Date.now();
  const svc = await serve(t, {now: () => time});
  const {code, url} = await svc.post(bodyFor()).then(res => res.json());
  const route = "/v1/workspace-packs/" + code + "/access";
  const access = (path, account, body) => fetch(svc.base + path, {
    method: body ? "POST" : "GET",
    headers: account ? {authorization:"Bearer fixture-" + account} : {},
    body: body && JSON.stringify(body),
  });
  const create = (role, expiresInHours, maxUses) => access(route, "owner", {action:"create", role, expiresInHours, maxUses});
  const invite = (action, token, account) => access("/v1/workspace-invites", account, {action, token});
  assert.equal((await access(route, null)).status, 401);
  assert.equal((await access(route, "other", {action:"create",role:"edit",expiresInHours:1,maxUses:1})).status, 403);
  assert.equal((await create("edit", 0, 1)).status, 400);
  const {url: viewUrl} = await create("view", 1, 1).then(res => res.json());
  const viewLink = new URL(viewUrl);
  const viewToken = viewLink.hash.slice(1);
  assert.equal(viewLink.pathname, "/share/invite");
  assert.match(viewToken, /^[A-Za-z0-9_-]{43}$/);
  const landing = await fetch(viewUrl);
  assert.equal(landing.headers.get("referrer-policy"), "no-referrer");
  assert.equal(landing.headers.get("cache-control"), "no-store");
  const landingHtml = await landing.text();
  assert.ok(!landingHtml.includes(viewToken));
  const [, script] = landingHtml.match(/<script>([\s\S]+)<\/script>/);
  assert.ok(landing.headers.get("content-security-policy").includes("'sha256-" + createHash("sha256").update(script).digest("base64") + "'"));
  const launch = { hidden:true, removeAttribute() { delete this.href; } };
  const invalid = { hidden:true };
  const location = { hash:viewLink.hash };
  let onHashChange;
  runInNewContext(script, {
    location,
    document: {getElementById: id => id === "open-in-delight" ? launch : invalid},
    addEventListener: (type, handler) => { if (type === "hashchange") onHashChange = handler; },
  });
  assert.ok(!launch.hidden && launch.href === "delight://invite/" + viewToken);
  location.hash = "#invalid";
  onHashChange();
  assert.ok(launch.hidden && !launch.href && !invalid.hidden);
  location.hash = "#" + "B".repeat(43);
  onHashChange();
  assert.ok(!launch.hidden && launch.href === "delight://invite/" + "B".repeat(43));
  const legacyLanding = await fetch(svc.base + "/invite/" + viewToken);
  assert.ok((await legacyLanding.text()).includes("delight://invite/" + viewToken));
  assert.equal((await invite("preview", viewToken)).status, 200);
  assert.equal((await invite("accept", viewToken)).status, 401);
  const contenders = await Promise.all(["other","third"].map(user => invite("accept", viewToken, user)));
  assert.deepEqual(contenders.map(item => item.status).sort(), [200,409]);
  const winner = contenders[0].ok ? "other" : "third";
  const loser = winner === "other" ? "third" : "other";
  assert.equal((await invite("accept", viewToken, winner)).status, 200);
  assert.equal((await access(route, winner).then(res => res.json())).role, "view");
  assert.equal((await access(route, winner).then(res => res.json())).people, undefined);
  const expired = new URL((await create("edit", 1, 1).then(res => res.json())).url).hash.slice(1);
  time += 3_600_000;
  assert.equal((await invite("accept", expired, loser)).status, 404);
  const edit = await create("edit", null, 2).then(res => res.json());
  const editToken = new URL(edit.url).hash.slice(1);
  assert.equal((await invite("accept", editToken, "other")).status, 200);
  const owner = await access(route, "owner").then(res => res.json());
  assert.ok(!JSON.stringify(owner).includes(editToken));
  assert.equal(owner.links.find(link => link.id === edit.id).uses, 1);
  const person = owner.people.find(person => person.name === "other");
  assert.equal(person.role, "edit");
  assert.equal(person.canPublish, false);
  const update = {...bodyFor(), publisherId:"private-other-id", baseRevision:1, required:false};
  assert.equal((await svc.update(code, update, "other")).status, 403);
  assert.equal((await access(route, "owner", {action:"publish",id:person.id,enabled:true})).status, 200);
  assert.equal((await svc.update(code, {...update, required:true}, "other")).status, 403);
  assert.equal((await svc.update(code, update, "other")).status, 201);
  assert.equal((await access(route, "owner").then(res => res.json())).role, "owner");
  const drafting = await draftFixture(svc, code).list("other").then(res => res.json());
  assert.equal(drafting.ownerName, "meadow-builder", "new publication authors do not change the review recipient");
  const ownerUpdate = {...bodyFor(), baseRevision:2, required:true};
  assert.equal((await svc.update(code, ownerUpdate)).status, 201);
  assert.equal((await access(route, "owner", {action:"publish",id:person.id,enabled:false})).status, 200);
  assert.equal((await svc.update(code, {...update, baseRevision:3, publicationId:randomUUID()}, "other")).status, 403);
  assert.equal((await access(route, "owner", {action:"remove",id:person.id})).status, 200);
  assert.equal((await invite("accept", editToken, "other")).status, 403);
  assert.equal((await access(route, "owner", {action:"revoke",id:edit.id})).status, 200);
  assert.equal((await invite("accept", editToken, loser)).status, 404);
  assert.equal((await fetch(url)).status, 200);
});

test("re-inviting a removed collaborator keeps older privilege links invalid", async t => {
  let time = Date.now();
  const svc = await serve(t, {now: () => time});
  const {code} = await svc.post(bodyFor()).then(res => res.json());
  const {request} = draftFixture(svc, code);
  const makeLink = async role => {
    const response = await request("/access", "owner", {action:"create",role,expiresInHours:1,maxUses:10});
    assert.equal(response.status, 201);
    const link = await response.json();
    return {...link, token:new URL(link.url).hash.slice(1)};
  };
  const accept = token => fetch(svc.base + "/v1/workspace-invites", {
    method:"POST", headers:{authorization:"Bearer fixture-other"}, body:JSON.stringify({action:"accept",token}),
  });

  const oldEdit = await makeLink("edit");
  assert.equal((await accept(oldEdit.token)).status, 200);
  const people = await request("/access", "owner").then(res => res.json());
  time++;
  assert.equal((await request("/access", "owner", {action:"remove",id:people.people[0].id})).status, 200);
  time++;
  const newView = await makeLink("view");
  assert.equal((await accept(newView.token).then(res => res.json())).role, "view");
  const rejected = await accept(oldEdit.token);
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error, "invite_needs_replacement");
  assert.equal((await request("/access", "other").then(res => res.json())).role, "view");
  const available = await request("/access", "owner").then(res => res.json());
  assert.equal(available.links.find(link => link.id === oldEdit.id).uses, 1);
  const newEdit = await makeLink("edit");
  assert.equal((await accept(newEdit.token).then(res => res.json())).role, "edit");
});

test("pausing public sharing survives restart, stops new installs and invites, and leaves follower release reads available", async t => {
  const directory = mkdtempSync(join(tmpdir(), "workspace-sharing-state-"));
  const filename = join(directory, "test.sqlite");
  let restarted;
  const svc = await serve(t, {filename});
  t.after(async () => {
    await svc.close();
    await restarted?.close();
    rmSync(directory, {recursive:true, force:true});
  });
  const {code, url} = await svc.post(bodyFor()).then(res => res.json());
  const {endpoint, request} = draftFixture(svc, code);
  const invited = await request("/access", "owner", {action:"create",role:"edit",expiresInHours:1,maxUses:2}).then(res => res.json());
  const token = new URL(invited.url).hash.slice(1);
  const invitation = (base, action, account) => fetch(base + "/v1/workspace-invites", {
    method:"POST", headers:account ? {authorization:`Bearer fixture-${account}`} : {},
    body:JSON.stringify({action,token}),
  });
  assert.equal((await invitation(svc.base,"accept","other")).status, 200);
  assert.equal((await request("/access", "owner").then(res => res.json())).sharingEnabled, true);
  assert.equal((await fetch(endpoint + "/install")).status, 200);
  assert.equal((await request("/access", "other", {action:"setSharing",enabled:false})).status, 403);
  assert.equal((await request("/access", "owner", {action:"setSharing",enabled:1})).status, 400);
  assert.deepEqual(await request("/access", "owner", {action:"setSharing",enabled:false}).then(res => res.json()),
    {sharingEnabled:false});
  for (const playerLink of [url, svc.base + "/p/" + code]) {
    const response = await fetch(playerLink);
    assert.equal(response.status, 403);
    const html = await response.text();
    assert.match(html,/Sharing is paused/);
    assert.doesNotMatch(html,/delight:\/\/pack|Our first build/);
  }
  const paused = await fetch(endpoint + "/install");
  assert.equal(paused.status, 403);
  assert.equal((await paused.json()).error, "sharing_paused");
  assert.equal((await invitation(svc.base,"preview")).status, 403);
  assert.equal((await invitation(svc.base,"accept","third")).status, 403);
  assert.equal((await request("/access", "owner", {action:"create",role:"view",expiresInHours:1,maxUses:1})).status, 403);
  assert.equal((await request("/access", "other").then(res => res.json())).role, "edit");
  const admin = await request("/access","owner").then(res => res.json());
  assert.equal(admin.links.find(link => link.id === invited.id).uses, 1);
  assert.equal((await svc.update(code,{...bodyFor(),baseRevision:1,required:false})).status, 201);
  assert.equal((await fetch(endpoint).then(res => res.json())).revision, 2);
  assert.equal((await fetch(endpoint + "/releases/1").then(res => res.json())).revision, 1);
  assert.equal((await fetch(endpoint + "/releases").then(res => res.json())).length, 2);
  await svc.close();

  restarted = await serve(t, {filename});
  const reloaded = draftFixture(restarted,code);
  assert.equal((await reloaded.request("/access","owner").then(res => res.json())).sharingEnabled, false);
  assert.equal((await fetch(reloaded.endpoint + "/install")).status, 403);
  assert.deepEqual(await reloaded.request("/access", "owner", {action:"setSharing",enabled:true}).then(res => res.json()),
    {sharingEnabled:true});
  const allowed = await fetch(reloaded.endpoint + "/install").then(res => res.json());
  assert.equal(allowed.revision, 2);
  assert.equal((await fetch(allowed.url)).status, 200);
  assert.equal((await invitation(restarted.base,"accept","third")).status, 200);
  await restarted.close();
});

test("publishes an exact immutable Version 1 with durable, owner-scoped recovery and a public read-only page", async t => {
  const tmp = mkdtempSync(join(tmpdir(), "workspace-service-"));
  const filename = join(tmp, "test.sqlite");
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const svc = await serve(t, { filename });
  const input = bodyFor();
  const create = await svc.post(input);
  assert.equal(create.status, 201);
  const receipt = await create.json();
  assert.equal(receipt.creator, "meadow-builder");
  assert.equal(receipt.revision, 1);
  assert.equal(receipt.url, svc.base + "/share/pack/" + receipt.code);
  const publicData = await fetch(svc.base + "/v1/workspace-packs/" + receipt.code).then(r => r.json());
  assert.equal(publicData.manifest.files[1].enabled, false);
  assert.equal(publicData.manifest.files[1].sha512, pack.sha512);
  assert.match(publicData.manifest.files[0].downloadUrl, /^https:\/\/cdn\.modrinth\.com\//);
  assert.deepEqual(publicData.manifest.excludedFolders, ["config"]);
  assert.ok(!JSON.stringify(publicData).includes(input.publisherId));
  assert.ok(!JSON.stringify(publicData).includes(input.publicationId));
  const landing = await fetch(receipt.url);
  assert.match(landing.headers.get("content-type"), /text\/html/);
  assert.match(landing.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const html = await landing.text();
  assert.match(html, /Meadow &amp; Grove/);
  assert.ok(html.includes(`href="delight://pack/${receipt.code}">Open in Delight</a>`));
  assert.ok(html.includes('class="brand" href="https://delightproductions.org/"'));
  assert.match(html, /paint.zip.disabled/);
  assert.ok(!html.includes(input.publicationId));
  assert.equal(await fetch(svc.base + "/p/" + receipt.code).then(r => r.text()), html);
  assert.equal((await fetch(receipt.url, { method: "PUT" })).status, 405);
  await svc.close();
  const restart = await serve(t, { filename, fetchImpl: async () => { throw new Error("offline"); } });
  try {
    const lookup = "/v1/workspace-publications/" + input.publicationId;
    assert.equal((await fetch(restart.base + lookup)).status, 401);
    assert.equal((await fetch(restart.base + lookup, { headers: { authorization: "Bearer fixture-other" } })).status, 404);
    const recovered = await fetch(restart.base + lookup, { headers: { authorization: "Bearer fixture-owner" } }).then(r => r.json());
    assert.equal(recovered.code, receipt.code);
    input.manifest.files.reverse();
    const replay = await restart.post(input);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).code, receipt.code);
    input.releaseNote = "Different request";
    assert.equal((await restart.post(input)).status, 409);
    assert.equal(restart.database.prepare("SELECT COUNT(*) AS n FROM workspace_packs").get().n, 1);
  } finally { await restart.close(); }
});

test("releases append to an existing first-version database, keep the player link and carry a required floor across optional releases", async t => {
  const tmp = mkdtempSync(join(tmpdir(), "workspace-revisions-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const filename = join(tmp, "test.sqlite");
  const old = await serve(t, {filename});
  const first = bodyFor();
  const {code} = await old.post(first).then(response => response.json());
  // Reopen the exact schema used by the first-release-only prototype.
  old.database.exec("DROP VIEW workspace_pack_versions; DROP TABLE workspace_pack_updates");
  await old.close();
  const svc = await serve(t, {filename});
  const path = svc.base + "/v1/workspace-packs/" + code;
  const update = {...bodyFor(), baseRevision: 1, required: true, releaseNote: "Updated for our server."};
  update.manifest.files.pop();
  assert.equal((await svc.update(code, {...update, releaseNote: " "})).status,400);
  assert.equal((await svc.update(code, {...update, publisherId:"private-other-id"}, "other")).status,403);
  assert.equal((await svc.update(code, update, "none")).status,401);
  const created = await svc.update(code, update);
  assert.equal(created.status,201);
  const second = await created.json();
  assert.equal(second.url, svc.base + "/share/pack/" + code);
  assert.equal(second.required,true);
  assert.equal(second.minimumPlayableRevision,2);
  assert.equal((await svc.update(code, update)).status,200);
  assert.equal((await svc.update(code, {...update, required:false})).status,409);
  assert.equal((await svc.update(code, {...update, publicationId: randomUUID()})).status,409);
  const optional = {...bodyFor(), baseRevision:2, required:false, releaseNote: "Optional textures."};
  const responses = await Promise.all([svc.update(code,optional),svc.update(code,{...optional,publicationId:randomUUID()})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const latest = await fetch(path).then(r=>r.json());
  assert.deepEqual([latest.revision,latest.required,latest.minimumPlayableRevision],[3,false,2]);
  assert.equal(latest.manifest.files.length,2);
  assert.equal((await fetch(path + "/releases/2").then(r=>r.json())).manifest.files.length,1);
  const original = await fetch(path + "/releases/1").then(r=>r.json());
  assert.deepEqual([original.revision,original.releaseNote,original.minimumPlayableRevision],[1,first.releaseNote,1]);
  assert.equal((await fetch(path + "/releases/4")).status,404);
  const history = await fetch(path + "/releases").then(r=>r.json());
  assert.deepEqual(history.map(row=>row.revision),[3,2,1]);
  assert.ok(history.every(row=>row.code===code && !row.manifest && !row.owner_id && !row.publication_id));
  assert.equal((await svc.update(code,update)).status,200,"old reviewed requests recover after a newer release");
  const recovery = await fetch(svc.base + "/v1/workspace-publications/" + update.publicationId,
    {headers:{authorization:"Bearer fixture-owner"}}).then(r=>r.json());
  assert.deepEqual(recovery,second);
  const landing = await fetch(second.url).then(r=>r.text());
  assert.match(landing,/Optional textures\./);
  assert.match(landing,/Optional from version 2/);
  await svc.close();
});

test("rejects malformed manifests, wrong publisher, unsafe names, unaccepted terms and invalid distribution metadata without persistence", async t => {
  const svc = await serve(t);
  const input = bodyFor();
  assert.equal((await svc.post(input, "none")).status, 401);
  assert.equal((await svc.post(input, "other")).status, 403);
  for (const mutate of [
    b => { b.termsVersion = "0"; },
    b => { b.manifest.excludedFolders = ["worlds", "C:/private"]; },
    b => { b.manifest.files[0].fileName = "../outside.jar"; },
    b => { b.manifest.files[0].fileName = "con.jar"; },
    b => { b.manifest.files[0].enabled = false; },
    b => { b.manifest.files.push({ ...b.manifest.files[0], fileName: "Meadow.jar" }); },
    b => { b.manifest.files.push({ ...b.manifest.files[0], fileName: "Meadow.jar.disabled", enabled: false }); },
    b => { b.manifest.files[0].source = "delight"; },
  ]) {
    const invalid = structuredClone(input); mutate(invalid);
    assert.equal((await svc.post(invalid)).status, 400);
  }
  svc.catalog[mod.sha512].dependencies = [{ dependency_type: "required", project_id: pack.projectId, version_id: pack.versionId }];
  assert.equal((await svc.post(input)).status, 422, "disabled content does not satisfy a required dependency");
  svc.catalog[mod.sha512].dependencies = [];
  svc.catalog[mod.sha512].files[0].url = "https://example.org/elsewhere.jar";
  assert.equal((await svc.post(input)).status, 422);
  delete svc.catalog[mod.sha512];
  assert.equal((await svc.post(input)).status, 422);
  assert.equal(svc.database.prepare("SELECT COUNT(*) AS n FROM workspace_packs").get().n, 0);
});

test("Fabric archive dependency policy retains exact download and conflict verification", async t => {
  const svc = await serve(t);
  svc.catalog[mod.sha512].dependencies = [{ dependency_type: "required", project_id: "EmbeddedProject", version_id: "OlderVersion" }];
  assert.equal((await svc.post(bodyFor())).status, 422, "legacy releases still require catalog pins");
  const input = bodyFor();
  input.manifest.modDependencyPolicy = "fabric";
  const source = svc.catalog[mod.sha512].files[0];
  source.size += 1;
  assert.equal((await svc.post(input)).status, 422, "archives still require the exact downloadable bytes");
  source.size -= 1;
  assert.equal((await svc.post(input)).status, 201);
  const manifest = JSON.parse(svc.database.prepare("SELECT manifest_json FROM workspace_packs").get().manifest_json);
  assert.equal(manifest.modDependencyPolicy, "fabric");
  assert.equal(manifest.files[0].sha512, mod.sha512);
});

test("concurrent identical publishes have one durable receipt; transient errors can be retried", async t => {
  let online = false;
  const svc = await serve(t, { fetchImpl: async url => {
    if (!online) throw new Error("unavailable");
    await new Promise(resolve => setImmediate(resolve));
    return Response.json(url.includes("fabricmc.net") ? [{ loader: { version: runtime.loaderVersion } }] : { [mod.sha512]: version(mod), [pack.sha512]: version(pack) });
  } });
  const input = bodyFor();
  assert.equal((await svc.post(input)).status, 503);
  online = true;
  const receipts = await Promise.all([svc.post(input), svc.post(input)]);
  assert.deepEqual(receipts.map(r => r.status).sort(), [200, 201]);
  const [a,b] = await Promise.all(receipts.map(r => r.json()));
  assert.deepEqual(a,b);
  assert.equal(svc.database.prepare("SELECT COUNT(*) AS n FROM workspace_packs").get().n, 1);
});

test("revocation during source verification prevents the insert", async t => {
  let svc;
  svc = await serve(t, { fetchImpl: async url => {
    svc.revoke();
    return Response.json(url.includes("fabricmc.net") ? [{ loader: { version: runtime.loaderVersion } }] : { [mod.sha512]: version(mod), [pack.sha512]: version(pack) });
  } });
  assert.equal((await svc.post(bodyFor())).status, 401);
  assert.equal(svc.database.prepare("SELECT COUNT(*) AS n FROM workspace_packs").get().n, 0);
});

test("managed or empty packs can publish, and an existing receipt survives a publisher's rate limit", async t => {
  let providerCalls = 0;
  const svc = await serve(t, { fetchImpl: async url => {
    assert.match(url, /^https:\/\/meta\.fabricmc\.net\//);
    providerCalls++;
    return Response.json([{ loader: { version: runtime.loaderVersion } }]);
  } });
  const input = bodyFor();
  input.manifest.files = [{ category: "mods", fileName: "bloom-cosmetics-1.21.1.jar", source: "delight",
    size: 12, enabled: true, sha512: "c".repeat(128), projectId: null, versionId: null,
    downloadUrl: "https://creator.example/cosmetics.jar" }];
  for (const invalidHash of [undefined, null, "c".repeat(127), "x".repeat(128)]) {
    const invalid = structuredClone(input);
    invalid.manifest.files[0].sha512 = invalidHash;
    const response = await svc.post(invalid);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_source_pin");
  }
  assert.equal(providerCalls, 0);
  const created = await svc.post(input);
  assert.equal(created.status, 201);
  const receipt = await created.json();
  const pack = await fetch(svc.base + "/v1/workspace-packs/" + receipt.code).then(response => response.json());
  assert.deepEqual(pack.manifest.files, [{ ...input.manifest.files[0], downloadUrl: null }]);
  const empty = { ...input, manifest: { ...input.manifest, files: [] } };
  for (let i = 1; i < 20; i++) {
    assert.equal((await svc.post({ ...empty, publicationId: randomUUID() })).status, 201);
  }
  assert.equal((await svc.post({ ...empty, publicationId: randomUUID() })).status, 429);
  const replay = await svc.post(input);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), receipt);
  assert.equal(providerCalls, 20);
});

function draftFixture(svc, code) {
  const endpoint = `${svc.base}/v1/workspace-packs/${code}`;
  const grant = (account, role) => {
    const id = randomUUID();
    svc.database.prepare("INSERT INTO workspace_collaborators(code,account,id,name,role) VALUES (?,?,?,?,?)")
      .run(code, `private-${account}-id`, id, account, role);
    return id;
  };
  const request = (path, account, body) => fetch(endpoint + path, {
    method: body ? "POST" : "GET",
    headers: account ? {authorization: `Bearer fixture-${account}`} : {},
    body: body && JSON.stringify(body),
  });
  const list = account => request("/drafts", account);
  const get = (account, id) => request("/drafts/" + id, account);
  const act = (account, body) => request("/drafts", account, body);
  return {endpoint, grant, request, list, get, act};
}

test("editors save privately, owners review exact submissions, and duplicate approval appends once", async t => {
  const directory = mkdtempSync(join(tmpdir(), "workspace-drafts-"));
  const filename = join(directory, "test.sqlite");
  let restartedService;
  const svc = await serve(t, {filename});
  t.after(async () => {
    await svc.close();
    await restartedService?.close();
    rmSync(directory, {recursive:true, force:true});
  });
  const {code} = await svc.post(bodyFor()).then(response => response.json());
  const first = draftFixture(svc, code);
  first.grant("other","edit");
  first.grant("third","view");
  const id = randomUUID();
  const candidate = {...bodyFor().manifest, files:[{...mod, downloadUrl:"https://example.invalid/replaced.jar"}]};
  const original = {action:"save", id, baseRevision:1, note:"Private notes", manifest:candidate,
    author:"Claimed identity", authorAvatarUrl:"https://avatars.githubusercontent.com/u/999",
    minecraftUuid:"123e4567-e89b-12d3-a456-426614174000"};
  assert.equal((await first.act("owner", original)).status,403);
  assert.equal((await first.act("third", original)).status,403);
  assert.equal((await first.list(null)).status,401);
  assert.equal((await first.act("other", {...original,note:"x".repeat(1001)})).status,400);
  const saved = await first.act("other", original).then(response => response.json());
  assert.equal(saved.state,"saved");
  assert.equal(saved.version,1);
  assert.equal(saved.manifest.files[0].downloadUrl,undefined);
  assert.equal(saved.author,"other");
  assert.equal(saved.authorAvatarUrl,null);
  assert.deepEqual(await first.act("other", original).then(response => response.json()), saved);
  assert.equal((await first.get("owner", id)).status,404);
  assert.deepEqual((await first.list("owner").then(response => response.json())).drafts,[]);
  await svc.close();

  let avatarUrl = "https://avatars.githubusercontent.com/u/42?v=4#ignored", minecraftUuid = null;
  restartedService = await serve(t, {filename, authorProfile: account => account === "private-other-id"
    ? {displayName:"Meadow Editor", avatarUrl, minecraftUuid} : null});
  const restarted = draftFixture(restartedService, code);
  const ownList = await restarted.list("other").then(response => response.json());
  assert.equal(ownList.headRevision,1);
  assert.equal(ownList.ownerName,"meadow-builder");
  assert.equal(ownList.drafts.at(0).note,"Private notes");
  assert.equal(ownList.drafts.at(0).manifest,undefined);
  assert.equal(ownList.drafts.at(0).author,"Meadow Editor");
  assert.equal(ownList.drafts.at(0).authorAvatarUrl,"https://avatars.githubusercontent.com/u/42");
  for (const unsafe of ["https://127.0.0.1/local.png", "https://profiles.example/picture.png",
    "https://avatars.githubusercontent.com.evil.example/u/42", "https://lh3.googleusercontent.com:9876/a/profile",
    "https://fake:credential@lh3.googleusercontent.com/a/profile", "http://lh3.googleusercontent.com/a/profile"]) {
    avatarUrl = unsafe;
    assert.equal((await restarted.get("other",id).then(res=>res.json())).authorAvatarUrl,null);
  }
  const linkedAvatar = "https://mc-heads.net/avatar/123e4567e89b12d3a456426614174000/96";
  for (const uuid of ["123E4567-E89B-12D3-A456-426614174000", "123e4567e89b12d3a456426614174000"]) {
    minecraftUuid = uuid;
    assert.equal((await restarted.get("other",id).then(res=>res.json())).authorAvatarUrl,linkedAvatar);
  }
  minecraftUuid = "123e4567e89b12d3a456426614174000/../external";
  assert.equal((await restarted.get("other",id).then(res=>res.json())).authorAvatarUrl,null);
  minecraftUuid = "123e4567-e89b-12d3-a456-426614174000";
  avatarUrl = "https://lh3.googleusercontent.com/a/profile=s96-c";
  const submit = {action:"submit",id,version:saved.version};
  const sent = await restarted.act("other", submit).then(response => response.json());
  assert.equal(sent.state,"submitted");
  assert.deepEqual(await restarted.act("other", submit).then(response => response.json()), sent);
  assert.equal((await restarted.act("other", {...original,version:sent.version})).status,409);
  const ownerAccess = await restarted.get("owner",id).then(response => response.json());
  assert.equal(ownerAccess.canReview,true);
  assert.equal(ownerAccess.author,"Meadow Editor");
  assert.equal(ownerAccess.authorAvatarUrl,avatarUrl);
  assert.equal(ownerAccess.manifest.files.length,1);
  assert.ok(!JSON.stringify(ownerAccess).includes("private-other-id"));
  assert.equal((await restarted.act("other",{action:"publish",id,version:sent.version,required:false,termsVersion:"1"})).status,403);
  const sendBack = {action:"return",id,version:sent.version,reviewNote:"Restore the resource pack."};
  assert.equal((await restarted.act("owner",{...sendBack,reviewNote:"\u0000"})).status,400);
  const returned = await restarted.act("owner",sendBack).then(response => response.json());
  assert.equal(returned.reviewNote,sendBack.reviewNote);
  assert.equal(returned.state,"returned");
  assert.deepEqual(await restarted.act("owner",sendBack).then(response => response.json()),returned);
  assert.equal((await restarted.get("owner",id)).status,404);
  const edited = await restarted.act("other",{...original,version:returned.version,note:"Restored textures",
    manifest:{...candidate,files:[pack]}}).then(response => response.json());
  const ready = await restarted.act("other",{action:"submit",id,version:edited.version}).then(response => response.json());
  const parallel = await restarted.act("other",{...original,id:randomUUID()}).then(response => response.json());
  const competing = await restarted.act("other",{action:"submit",id:parallel.id,version:parallel.version}).then(response => response.json());
  const approve = {action:"publish",id,version:ready.version,required:true,releaseNote:"Changes needed for the server",termsVersion:"1",
    manifest:{...candidate,files:[]}};
  assert.equal((await restarted.act("owner",{...approve,termsVersion:"0"})).status,400);
  assert.equal((await restarted.act("owner",{...approve,version:sent.version})).status,409);
  const publications = await Promise.all([restarted.act("owner",approve),restarted.act("owner",approve)]);
  assert.deepEqual(publications.map(response=>response.status).sort(),[200,201]);
  const receipts = await Promise.all(publications.map(response=>response.json()));
  assert.deepEqual(receipts[0],receipts[1]);
  assert.equal(receipts[0].minimumPlayableRevision,2);
  const staleApproval = await restarted.act("owner",{...approve,id:competing.id,version:competing.version});
  assert.equal(staleApproval.status,409);
  assert.equal((await staleApproval.json()).error,"stale_base_revision");
  const published = await fetch(restarted.endpoint).then(response=>response.json());
  assert.deepEqual(published.manifest.files.map(file=>file.fileName),[pack.fileName]);
  assert.match(published.manifest.files[0].downloadUrl,/^https:\/\/cdn\.modrinth\.com\//);
  const completed = await restarted.get("other",id).then(response=>response.json());
  assert.equal(completed.state,"published");
  assert.equal(completed.publishedRevision,2);
  await restartedService.close();
});

test("submission checks stale bases and a removed editor cannot publish through an already-open owner review", async t => {
  let markStarted, continueProvider, pause = false;
  const started = new Promise(resolve => { markStarted = resolve; });
  const gate = new Promise(resolve => { continueProvider = resolve; });
  const svc = await serve(t,{fetchImpl: async url => {
    if (url.includes("fabricmc.net")) {
      if (pause) { markStarted(); await gate; }
      return Response.json([{loader:{version:runtime.loaderVersion}}]);
    }
    return Response.json({[mod.sha512]:version(mod),[pack.sha512]:version(pack)});
  }});
  const {code} = await svc.post(bodyFor()).then(response => response.json());
  const {endpoint, grant, request, get, act} = draftFixture(svc, code);
  const editor = grant("other","edit");
  grant("third","edit");
  const draft = {action:"save",id:randomUUID(),baseRevision:1,note:"A local draft",manifest:bodyFor().manifest};
  const initial = await act("other",draft).then(response=>response.json());
  assert.equal((await get("third",draft.id)).status,404);
  assert.equal((await act("third",{action:"discard",id:draft.id,version:initial.version})).status,404);
  assert.equal((await svc.update(code,{...bodyFor(),baseRevision:1,required:false})).status,201);
  const outOfDate = await act("other",{action:"submit",id:draft.id,version:initial.version});
  assert.equal(outOfDate.status,409);
  assert.equal((await outOfDate.json()).error,"stale_base_revision");
  const rebased = await act("other",{...draft,baseRevision:2,version:initial.version}).then(response=>response.json());
  const submitted = await act("other",{action:"submit",id:draft.id,version:rebased.version}).then(response=>response.json());
  const withdrawn = await act("other",{action:"withdraw",id:draft.id,version:submitted.version}).then(response=>response.json());
  assert.equal((await get("owner",draft.id)).status,404);
  assert.equal((await act("other",{action:"discard",id:draft.id,version:withdrawn.version})).status,200);
  assert.equal((await act("other",draft)).status,409,"a discarded identity cannot acquire an earlier review version");

  const second = await act("other",{...draft,baseRevision:2,id:randomUUID()}).then(response=>response.json());
  const active = await act("other",{action:"submit",id:second.id,version:second.version}).then(response=>response.json());
  pause = true;
  const approving = act("owner",{action:"publish",id:active.id,version:active.version,required:false,termsVersion:"1"});
  try {
    await started;
    assert.equal((await request("/access","owner",{action:"remove",id:editor})).status,200);
  } finally { continueProvider(); }
  const forbidden = await approving;
  assert.equal(forbidden.status,403);
  assert.equal((await forbidden.json()).error,"draft_author_removed");
  assert.equal((await fetch(endpoint).then(response=>response.json())).revision,2);
  const pending = await get("owner",active.id).then(response=>response.json());
  assert.equal(pending.canReview,false);
  assert.equal((await get("other",active.id)).status,403);
  assert.equal((await act("owner",{action:"return",id:active.id,version:active.version,reviewNote:"Superseded."})).status,200);
});

test("only the owner can restore immutable releases and an optional restore retains the required floor", async t => {
  const svc = await serve(t);
  const {code, url} = await svc.post(bodyFor()).then(response => response.json());
  const endpoint = svc.base + "/v1/workspace-packs/" + code;
  const restore = (body, account = "owner") => fetch(endpoint + "/restore", {
    method:"POST", headers:{"content-type":"application/json", authorization:"Bearer fixture-" + account},
    body:JSON.stringify(body),
  });
  const {grant} = draftFixture(svc, code);
  const editor = grant("other", "edit");
  const permission = await fetch(endpoint + "/access", {
    method:"POST", headers:{"content-type":"application/json", authorization:"Bearer fixture-owner"},
    body:JSON.stringify({action:"publish", id:editor, enabled:true}),
  });
  assert.equal(permission.status, 200);
  const original = await fetch(endpoint + "/releases/1").then(response => response.json());
  const changed = bodyFor();
  changed.manifest.files.pop();
  assert.equal((await svc.update(code, {...changed, baseRevision:1, required:true})).status, 201);

  const input = {publicationId:randomUUID(), termsVersion:"1", sourceRevision:1, baseRevision:2,
    releaseNote:"Bring the resource pack back.", required:false};
  assert.equal((await restore(input, "other")).status, 403);
  assert.equal((await restore(input, "unsigned")).status, 401);
  assert.equal((await restore({...input, sourceRevision:2})).status, 400);
  assert.equal((await restore({...input, required:true, releaseNote:" "})).status, 400);
  const attempts = await Promise.all([restore({...input, manifest:changed.manifest}), restore(input)]);
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 201]);
  const response = attempts.find(response => response.status === 201);
  assert.deepEqual(await response.json(), {
    code, url, revision:3, required:false, minimumPlayableRevision:2, releaseNote:input.releaseNote,
    creator:"meadow-builder", createdAt:(await fetch(endpoint).then(response => response.json())).createdAt,
  });
  const replay = await restore(input);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).revision, 3);
  assert.equal((await restore({...input, releaseNote:"Different review"})).status, 409);
  assert.deepEqual((await fetch(endpoint).then(response => response.json())).manifest, original.manifest);
  assert.deepEqual(await fetch(endpoint + "/releases/1").then(response => response.json()), original);

  const required = await restore({...input, publicationId:randomUUID(), sourceRevision:2, baseRevision:3,
    required:true, releaseNote:"Our server now requires that release’s files."});
  assert.equal(required.status, 201);
  const latest = await required.json();
  assert.equal(latest.minimumPlayableRevision, 4);
  assert.equal(latest.required, true);
  assert.deepEqual((await fetch(endpoint + "/releases").then(response => response.json())).map(release => release.revision), [4, 3, 2, 1]);
});

test("restore verifies old file sources and rechecks the head after a concurrent publication", async t => {
  let pauseVerification = false;
  let missingPack = false;
  let notifyStarted, continueProvider;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const verificationGate = new Promise(resolve => { continueProvider = resolve; });
  const svc = await serve(t, {fetchImpl:async url => {
    if (url.startsWith("https://meta.fabricmc.net/")) {
      if (pauseVerification) {
        pauseVerification = false;
        notifyStarted();
        await verificationGate;
      }
      return Response.json([{loader:{version:runtime.loaderVersion}}]);
    }
    return Response.json({
      [mod.sha512]:version(mod),
      ...(missingPack ? {} : {[pack.sha512]:version(pack)}),
    });
  }});
  const {code} = await svc.post(bodyFor()).then(response => response.json());
  const endpoint = svc.base + "/v1/workspace-packs/" + code;
  const changed = bodyFor();
  changed.manifest.files.pop();
  assert.equal((await svc.update(code, {...changed, baseRevision:1, required:false})).status, 201);
  const restore = () => fetch(endpoint + "/restore", {
    method:"POST", headers:{"content-type":"application/json", authorization:"Bearer fixture-owner"},
    body:JSON.stringify({publicationId:randomUUID(), termsVersion:"1", sourceRevision:1, baseRevision:2,
      releaseNote:"An older copy of the pack", required:false}),
  });
  missingPack = true;
  const unavailable = await restore();
  assert.equal(unavailable.status, 422);
  assert.equal((await unavailable.json()).error, "pack_source_changed");
  assert.equal((await fetch(endpoint).then(response => response.json())).revision, 2);
  missingPack = false;

  pauseVerification = true;
  const restoring = restore();
  try {
    await Promise.race([started, restoring.then(response => assert.fail(
      "Restore completed before the provider check with status " + response.status,
    ))]);
    assert.equal((await svc.update(code, {...changed, publicationId:randomUUID(), baseRevision:2,
      required:false, releaseNote:"A separate release"})).status, 201);
  } finally {
    continueProvider();
  }
  const stale = await restoring;
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, "stale_base_revision");
  assert.equal((await fetch(endpoint).then(response => response.json())).releaseNote, "A separate release");
});
