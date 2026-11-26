import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { renderWorkspacePreview, renderWorkspaceSharingPaused } from "./workspace-preview.mjs";
import { workspaceAccess } from "./workspace-access.mjs";
import { workspaceDrafts } from "./workspace-drafts.mjs";
import { workspaceRestore } from "./workspace-restore.mjs";

const categories = { mods: ".jar", resourcepacks: ".zip", shaderpacks: ".zip" };
const allowedExclusions = new Set(["config", "defaultconfigs", "kubejs", "scripts", "global_packs", "datapacks"]);
const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const runtimeId = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;
const sourceId = /^[a-zA-Z0-9]{1,64}$/;
const sha512 = /^[0-9a-f]{128}$/;
const bodyLimit = 512 * 1024;
const hour = 3_600_000;
const providerHeaders = { "user-agent": "DelightClient/PackWorkspace (support@bloomclient.org)" };

class PublicationError extends Error {
  constructor(status, code) { super(code); this.status = status; }
}

function reject(status, code) { throw new PublicationError(status, code); }

function send(response, status, value, html = false, scriptHash) {
  const text = html ? value : JSON.stringify(value);
  const headers = {
    "content-type": html ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (html) {
    headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    if (scriptHash) headers["content-security-policy"] += "; script-src 'sha256-" + scriptHash + "'";
  }
  response.writeHead(status, headers);
  response.end(text);
  return true;
}

async function readPublication(request) {
  if (Number(request.headers["content-length"]) > bodyLimit) reject(413, "publication_too_large");
  const chunks = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > bodyLimit) reject(413, "publication_too_large");
    chunks.push(part);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { reject(400, "invalid_publication"); }
}

function plainText(value, max, multiline = false) {
  if (typeof value !== "string" || [...value].length > max) return false;
  return !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value);
}

function normalizePublication(body, publisher) {
  if (!body || typeof body.publicationId !== "string" || !uuidPattern.test(body.publicationId)) reject(400, "invalid_publication_id");
  if (body.publisherId !== publisher.id) reject(403, "publisher_changed");
  if (body.termsVersion !== "1") reject(400, "sharing_terms_required");
  if (!plainText(body.releaseNote, 1000, true)) reject(400, "invalid_release_note");
  return { termsVersion: body.termsVersion, releaseNote: body.releaseNote.trim(), manifest: normalizeManifest(body.manifest) };
}

function normalizeManifest(m) {
  if (!m || !plainText(m.name, 80) || !m.name.trim() || m.loader !== "fabric" ||
      typeof m.minecraftVersion !== "string" || !runtimeId.test(m.minecraftVersion) ||
      typeof m.loaderVersion !== "string" || !runtimeId.test(m.loaderVersion)) reject(400, "invalid_pack_manifest");
  if (m.modDependencyPolicy !== undefined && m.modDependencyPolicy !== "fabric") reject(400, "invalid_pack_manifest");
  if (!Array.isArray(m.excludedFolders) || m.excludedFolders.some(x => !allowedExclusions.has(x)) ||
      new Set(m.excludedFolders).size !== m.excludedFolders.length) reject(400, "invalid_folder_exclusions");
  if (!Array.isArray(m.files) || m.files.length > 1500) reject(400, "invalid_pack_files");
  const paths = new Set();
  const files = m.files.map(f => {
    if (!f || typeof f.category !== "string" || !Object.hasOwn(categories, f.category) || typeof f.enabled !== "boolean" ||
        !Number.isSafeInteger(f.size) || f.size < 1 || !plainText(f.fileName, 255)) reject(400, "invalid_pack_file");
    const fileName = f.fileName;
    if (fileName.trim() !== fileName || /^[.]/.test(fileName) || /[<>:"/\\|?*]/.test(fileName) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(fileName)) reject(400, "invalid_pack_file");
    const lowerName = fileName.toLowerCase();
    const extension = categories[f.category] + (f.enabled ? "" : ".disabled");
    if (!lowerName.endsWith(extension) || lowerName.length <= extension.length) reject(400, "invalid_pack_file");
    const key = f.category + "/" + lowerName.replace(/\.disabled$/, "").normalize("NFC");
    if (paths.has(key)) reject(400, "duplicate_pack_file");
    paths.add(key);
    if (typeof f.sha512 !== "string" || !sha512.test(f.sha512)) reject(400, "invalid_source_pin");
    if (f.source === "modrinth") {
      if (typeof f.projectId !== "string" || !sourceId.test(f.projectId) ||
          typeof f.versionId !== "string" || !sourceId.test(f.versionId)) reject(400, "invalid_source_pin");
    } else if (f.source === "delight") {
      const managed = "bloom-cosmetics-" + m.minecraftVersion + extension;
      if (f.category !== "mods" || fileName !== managed || f.projectId != null || f.versionId != null) reject(400, "invalid_managed_file");
    } else { reject(400, "invalid_source_pin"); }
    return { category: f.category, fileName, enabled: f.enabled, size: f.size, source: f.source,
      sha512: f.sha512, projectId: f.projectId ?? null, versionId: f.versionId ?? null };
  }).sort((a, b) => {
    const first = a.category + "/" + a.fileName;
    const second = b.category + "/" + b.fileName;
    return first === second ? 0 : first < second ? -1 : 1;
  });
  return { name: m.name.trim(), minecraftVersion: m.minecraftVersion, loader: m.loader, loaderVersion: m.loaderVersion,
    ...(m.modDependencyPolicy === "fabric" ? {modDependencyPolicy: "fabric"} : {}),
    excludedFolders: [...m.excludedFolders].sort(), files };
}

async function providerJson(fetchImpl, url, options = {}) {
  try {
    const response = await fetchImpl(url, { ...options, headers: { ...providerHeaders, ...options.headers },
      signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { reject(503, "source_check_unavailable"); }
}

function trustedUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "cdn.modrinth.com" && !url.port &&
      !url.username && !url.password && !url.hash;
  } catch { return false; }
}

function checkDependency(dep, enabled) {
  if (dep.dependency_type !== "required" && dep.dependency_type !== "incompatible") return;
  const match = (dep.project_id || dep.version_id) && enabled.some(f =>
    (!dep.project_id || dep.project_id === f.projectId) && (!dep.version_id || dep.version_id === f.versionId));
  if ((dep.dependency_type === "required" && !match) || (dep.dependency_type === "incompatible" && match)) reject(422, "pack_dependencies_changed");
}

async function resolveManifest(manifest, fetchImpl) {
  const builds = await providerJson(fetchImpl, "https://meta.fabricmc.net/v2/versions/loader/" + encodeURIComponent(manifest.minecraftVersion));
  if (!Array.isArray(builds)) reject(503, "source_check_unavailable");
  if (!builds.some(build => build?.loader?.version === manifest.loaderVersion)) reject(422, "pack_runtime_changed");
  const verified = new Map();
  const hashes = [...new Set(manifest.files.filter(f => f.source === "modrinth").map(f => f.sha512))];
  for (let i = 0; i < hashes.length; i += 100) {
    const releases = await providerJson(fetchImpl, "https://api.modrinth.com/v2/version_files", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ algorithm: "sha512", hashes: hashes.slice(i, i + 100) }),
    });
    if (!releases || typeof releases !== "object" || Array.isArray(releases)) reject(503, "source_check_unavailable");
    for (const [hash, version] of Object.entries(releases)) verified.set(hash, version);
  }
  const enabled = manifest.files.filter(f => f.source === "modrinth" && f.enabled);
  const files = manifest.files.map(f => {
    if (f.source === "delight") return { ...f, downloadUrl: null };
    const v = verified.get(f.sha512);
    const targets = f.category === "mods" ? ["fabric"] : f.category === "resourcepacks" ? ["minecraft"] : ["iris", "canvas", "vanilla"];
    if (!v || v.project_id !== f.projectId || v.id !== f.versionId || !v.game_versions?.includes(manifest.minecraftVersion) ||
        !Array.isArray(v.loaders) || !v.loaders.some(loader => targets.includes(loader))) reject(422, "pack_source_changed");
    const exact = v.files?.find(x => x.hashes?.sha512 === f.sha512 && x.size === f.size && trustedUrl(x.url));
    if (!exact) reject(422, "pack_source_changed");
    if (f.enabled) for (const dep of v.dependencies || []) {
      // The publishing and receiving launchers verify Fabric's required
      // dependencies from these exact archives, including nested providers.
      // Preserve catalog conflicts, non-mod checks, and the legacy policy.
      if (manifest.modDependencyPolicy === "fabric" && f.category === "mods" && dep.dependency_type === "required") continue;
      checkDependency(dep, enabled);
    }
    return { ...f, downloadUrl: exact.url };
  });
  return { ...manifest, files };
}

export function createWorkspacePacks({ database, authenticate, authorProfile = () => null, publicUrl, fetchImpl = fetch, now = Date.now }) {
  database.exec(`CREATE TABLE IF NOT EXISTS workspace_packs (
    code TEXT PRIMARY KEY, owner_id TEXT NOT NULL, publication_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    terms_version TEXT NOT NULL, creator TEXT NOT NULL, release_note TEXT NOT NULL, manifest_json TEXT NOT NULL,
    created_at INTEGER NOT NULL, UNIQUE(owner_id, publication_id))`);
  // Existing pack rows remain the immutable first release, including on older databases.
  database.exec(`CREATE TABLE IF NOT EXISTS workspace_pack_updates (
    code TEXT NOT NULL REFERENCES workspace_packs(code), revision INTEGER NOT NULL CHECK (revision >= 2),
    required INTEGER NOT NULL, minimum_playable_revision INTEGER NOT NULL,
    owner_id TEXT NOT NULL, publication_id TEXT NOT NULL, request_hash TEXT NOT NULL,
    terms_version TEXT NOT NULL, creator TEXT NOT NULL, release_note TEXT NOT NULL, manifest_json TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY(code, revision), UNIQUE(owner_id, publication_id));
    CREATE VIEW IF NOT EXISTS workspace_pack_versions AS
      SELECT code, 1 AS revision, 0 AS required, 1 AS minimum_playable_revision, owner_id, publication_id,
        request_hash, terms_version, creator, release_note, manifest_json, created_at FROM workspace_packs
      UNION ALL SELECT code, revision, required, minimum_playable_revision, owner_id, publication_id,
        request_hash, terms_version, creator, release_note, manifest_json, created_at FROM workspace_pack_updates`);
  const byId = database.prepare("SELECT * FROM workspace_pack_versions WHERE owner_id = ? AND publication_id = ?");
  const byCode = database.prepare("SELECT * FROM workspace_pack_versions WHERE code = ? ORDER BY revision DESC LIMIT 1");
  const byRevision = database.prepare("SELECT * FROM workspace_pack_versions WHERE code = ? AND revision = ?");
  const history = database.prepare(`SELECT code, revision, required, minimum_playable_revision, creator, release_note, created_at
    FROM workspace_pack_versions WHERE code = ? ORDER BY revision DESC`);
  const insert = database.prepare(`INSERT INTO workspace_packs
    (code,owner_id,publication_id,request_hash,terms_version,creator,release_note,manifest_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`);
  const insertUpdate = database.prepare(`INSERT INTO workspace_pack_updates
    (code,revision,required,minimum_playable_revision,owner_id,publication_id,request_hash,terms_version,creator,release_note,manifest_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const attempts = new Map();
  const base = publicUrl.replace(/\/$/, "");
  const access = workspaceAccess({database, authenticate, base, byCode, now, reject, send, read:readPublication});
  const receipt = row => ({ code: row.code, revision: row.revision, url: base + "/share/pack/" + row.code,
    required: Boolean(row.required), minimumPlayableRevision: row.minimum_playable_revision,
    releaseNote: row.release_note, creator: row.creator, createdAt: new Date(row.created_at).toISOString() });
  function replay(row, digest) {
    if (row.request_hash !== digest) reject(409, "publication_changed");
    return receipt(row);
  }
  function checkPublisher(code, publisher, required) {
    const previous = byCode.get(code);
    if (!previous) reject(404, "pack_not_found");
    const grant = access.roleFor(previous, publisher);
    if (!grant.canPublish || (required && !grant.canRequire)) reject(403, "publication_forbidden");
    return previous;
  }
  function checkBase(code, publisher, baseRevision, required) {
    const previous = checkPublisher(code, publisher, required);
    if (previous.revision !== baseRevision) reject(409, "stale_base_revision");
    return previous;
  }
  function admit(id) {
    const time = now();
    for (const [key, value] of attempts) if (value.start + hour <= time) attempts.delete(key);
    const usage = attempts.get(id) || { start: time, count: 0 };
    if (usage.count >= 20) reject(429, "publication_rate_limited");
    usage.count++; attempts.set(id, usage);
  }
  function append(head, required, values) {
    const revision = head.revision + 1;
    insertUpdate.run(head.code, revision, Number(required), required ? revision : head.minimum_playable_revision, ...values);
    return receipt(byRevision.get(head.code, revision));
  }
  const drafts = workspaceDrafts({ database, authenticate, authorProfile, byCode, byRevision, roleFor: access.roleFor, append, admit,
    now, reject, send, read: readPublication, normalizeManifest, resolveManifest: manifest => resolveManifest(manifest, fetchImpl),
    plainText, uuidPattern, receipt });
  const restore = workspaceRestore({ database, authenticate, byId, byCode, byRevision, roleFor: access.roleFor, append, admit,
    now, reject, send, read: readPublication, normalizeManifest, resolveManifest: manifest => resolveManifest(manifest, fetchImpl),
    plainText, uuidPattern, receipt });
  return {
    async handle(request, response, pathname) {
      const collection = pathname === "/v1/workspace-packs";
      const owner = pathname.startsWith("/v1/workspace-publications/");
      const playerPath = ["/share/pack/", "/p/"].find(prefix => pathname.startsWith(prefix));
      const detail = pathname.startsWith("/v1/workspace-packs/");
      const installRoute = /^\/v1\/workspace-packs\/([23456789A-HJ-NP-Z]{8})\/install$/.exec(pathname);
      const versionRoute = /^\/v1\/workspace-packs\/([23456789A-HJ-NP-Z]{8})\/releases(?:\/([1-9][0-9]*))?$/.exec(pathname);
      const updateCode = request.method === "POST" && versionRoute && !versionRoute[2] ? versionRoute[1] : null;
      try {
        if (await access.handle(request, response, pathname)) return true;
        if (await drafts(request, response, pathname)) return true;
        if (await restore(request, response, pathname)) return true;
        if (!collection && !owner && !playerPath && !detail) return false;
        if (request.method !== (collection || updateCode ? "POST" : "GET")) {
          response.setHeader("allow", collection ? "POST" : versionRoute && !versionRoute[2] ? "GET, POST" : "GET");
          reject(405, "method_not_allowed");
        }
        if ((detail || playerPath) && !updateCode) {
          const code = installRoute?.[1] ?? versionRoute?.[1] ?? pathname.slice((playerPath || "/v1/workspace-packs/").length);
          if (!/^[23456789A-HJ-NP-Z]{8}$/.test(code)) reject(404, "pack_not_found");
          if (versionRoute && !versionRoute[2]) {
            const entries = history.all(code);
            if (!entries.length) reject(404, "pack_not_found");
            return send(response, 200, entries.map(receipt));
          }
          const revision = Number(versionRoute?.[2] || 1);
          if (!Number.isSafeInteger(revision)) reject(404, "release_not_found");
          const row = versionRoute ? byRevision.get(code, revision) : byCode.get(code);
          if (!row) reject(404, "pack_not_found");
          if ((installRoute || playerPath) && !access.sharingEnabled(code)) {
            return playerPath ? send(response, 403, renderWorkspaceSharingPaused(), true)
              : send(response, 403, {error:"sharing_paused"});
          }
          const pack = { ...receipt(row), manifest: JSON.parse(row.manifest_json) };
          return send(response, 200, playerPath ? renderWorkspacePreview(pack) : pack, Boolean(playerPath));
        }
        const publisher = await authenticate(request);
        if (!publisher?.id) reject(401, "not_authenticated");
        if (owner) {
          const id = pathname.slice("/v1/workspace-publications/".length).toLowerCase();
          const row = uuidPattern.test(id) && byId.get(publisher.id, id);
          if (!row) reject(404, "publication_not_found");
          return send(response, 200, receipt(row));
        }
        const body = await readPublication(request);
        const input = normalizePublication(body, publisher);
        const id = body.publicationId.toLowerCase();
        if (updateCode) {
          if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 1 || body.baseRevision >= Number.MAX_SAFE_INTEGER ||
              typeof body.required !== "boolean") reject(400, "invalid_update_policy");
          if (body.required && !input.releaseNote) reject(400, "required_update_needs_note");
          Object.assign(input, { code: updateCode, baseRevision: body.baseRevision, required: body.required });
        }
        const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        if (updateCode) checkPublisher(updateCode, publisher.id, input.required);
        const previous = byId.get(publisher.id, id);
        if (previous) return send(response, 200, replay(previous, digest));
        if (updateCode) checkBase(updateCode, publisher.id, input.baseRevision, input.required);
        admit(publisher.id);
        const manifest = await resolveManifest(input.manifest, fetchImpl);
        const currentUser = await authenticate(request);
        if (!currentUser || currentUser.id !== publisher.id) reject(401, "not_authenticated");
        // Recheck the idempotency key and reviewed head under the same write lock as the append.
        database.exec("BEGIN IMMEDIATE");
        let committed;
        let status = 201;
        try {
          if (updateCode) checkPublisher(updateCode, publisher.id, input.required);
          const concurrent = byId.get(publisher.id, id);
          if (concurrent) {
            committed = replay(concurrent, digest);
            status = 200;
          } else {
            const values = [publisher.id, id, digest, input.termsVersion, currentUser.username || "Delight creator",
              input.releaseNote, JSON.stringify(manifest), now()];
            if (updateCode) {
              const head = checkBase(updateCode, publisher.id, input.baseRevision, input.required);
              committed = append(head, input.required, values);
            } else {
              for (let attempt = 0; !committed && attempt < 8; attempt++) {
                const code = [...randomBytes(8)].map(byte => codeAlphabet[byte % codeAlphabet.length]).join("");
                if (insert.run(code, ...values).changes === 1) committed = receipt(byRevision.get(code, 1));
              }
              if (!committed) reject(503, "pack_code_unavailable");
            }
          }
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        return send(response, status, committed);
      } catch (error) {
        if (error instanceof PublicationError) return send(response, error.status, { error: error.message });
        return send(response, 503, { error: "publication_unavailable" });
      }
    },
  };
}

export function workspacePacksFromEnvironment(authenticate, env = process.env, authorProfile) {
  const publicUrl = new URL(env.BLOOM_SHARE_PUBLIC_URL || "https://api.north.bloomclient.org/minecraft");
  const hostname = publicUrl.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash ||
      isIP(hostname) || !hostname.includes(".") || hostname.endsWith(".localhost")) {
    throw new Error("The workspace sharing service requires a public HTTPS hostname.");
  }
  const dir = resolve(env.BLOOM_SHARE_DATA_DIR || env.BLOOM_AUTH_DATA_DIR || ".bloom-auth");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(resolve(dir, "workspace-packs.sqlite"));
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  return createWorkspacePacks({ database, authenticate, authorProfile, publicUrl: publicUrl.href });
}
