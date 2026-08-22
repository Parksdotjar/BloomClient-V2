import http from "node:http";
import https from "node:https";
import fs from "node:fs";

const port = Number(process.env.PORT || 8110);
const service = "bloom-minecraft-api";
const apiVersion = "v1";
const modrinthBase = "https://api.modrinth.com/v2";
const userAgent = "BloomClient/0.1.0 (support@bloomclient.org)";
const capabilities = Object.freeze({ catalog: true, modrinth: true, curseforge: false, modpacks: false });
const cache = new Map();

const sendJson = (response, status, body, cacheControl = "no-store") => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(payload);
};

const cached = async (key, lifetimeMs, load) => {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  const value = await load();
  cache.set(key, { value, expiresAt: Date.now() + lifetimeMs });
  return value;
};

const modrinth = async (path, parameters = {}) => {
  const url = new URL(`${modrinthBase}${path}`);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, { headers: { "user-agent": userAgent } });
  if (!response.ok) throw new Error(`Modrinth returned HTTP ${response.status}`);
  return response.json();
};

const validGameVersion = (value) => typeof value === "string" && /^[0-9A-Za-z._+-]{1,32}$/.test(value);
const validProjectId = (value) => typeof value === "string" && /^[0-9A-Za-z_-]{3,64}$/.test(value);
const primaryFile = (version) => version?.files?.find((file) => file.primary) || version?.files?.[0];

const compatibleVersions = (projectId, gameVersion) => cached(
  `versions:${projectId}:fabric:${gameVersion}`,
  5 * 60_000,
  () => modrinth(`/project/${encodeURIComponent(projectId)}/version`, {
    loaders: JSON.stringify(["fabric"]),
    game_versions: JSON.stringify([gameVersion]),
    include_changelog: false,
  }),
);

const chooseVersion = async (projectId, gameVersion) => {
  const versions = await compatibleVersions(projectId, gameVersion);
  return versions.find((version) => version.version_type === "release") || versions[0] || null;
};

const searchCatalog = async ({ query, gameVersion, offset }) => {
  const facets = JSON.stringify([["project_type:mod"], ["categories:fabric"], [`versions:${gameVersion}`]]);
  const result = await modrinth("/search", {
    query,
    facets,
    index: query ? "relevance" : "downloads",
    limit: 20,
    offset,
  });
  const items = (await Promise.all(result.hits.map(async (hit) => {
    const version = await chooseVersion(hit.project_id, gameVersion);
    const file = primaryFile(version);
    if (!version || !file) return null;
    return {
      provider: "modrinth",
      projectId: hit.project_id,
      slug: hit.slug,
      title: hit.title,
      summary: hit.description,
      iconUrl: hit.icon_url,
      author: hit.author,
      downloads: hit.downloads,
      loader: "Fabric",
      gameVersion,
      versionId: version.id,
      versionNumber: version.version_number,
      fileName: file.filename,
      fileSize: file.size,
    };
  }))).filter(Boolean);
  return { items, offset, limit: 20, total: result.total_hits };
};

const resolveInstallPlan = async (projectId, gameVersion) => {
  const files = [];
  const visited = new Set();
  let rootTitle = projectId;
  const resolve = async (nextProjectId, requestedVersionId, root = false) => {
    if (visited.has(nextProjectId) || visited.size >= 40) return;
    visited.add(nextProjectId);
    const version = requestedVersionId
      ? await modrinth(`/version/${encodeURIComponent(requestedVersionId)}`)
      : await chooseVersion(nextProjectId, gameVersion);
    if (!version || !version.loaders?.includes("fabric") || !version.game_versions?.includes(gameVersion)) {
      throw new Error(`No compatible Fabric ${gameVersion} version exists for ${nextProjectId}`);
    }
    if (root) {
      const project = await modrinth(`/project/${encodeURIComponent(nextProjectId)}`);
      rootTitle = project.title || nextProjectId;
    }
    for (const dependency of version.dependencies || []) {
      if (dependency.dependency_type !== "required") continue;
      if (dependency.project_id) {
        await resolve(dependency.project_id, dependency.version_id, false);
      } else if (dependency.version_id) {
        const dependencyVersion = await modrinth(`/version/${encodeURIComponent(dependency.version_id)}`);
        await resolve(dependencyVersion.project_id, dependency.version_id, false);
      } else if (dependency.file_name) {
        throw new Error(`Required external dependency ${dependency.file_name} cannot be installed automatically`);
      }
    }
    const file = primaryFile(version);
    if (!file) throw new Error(`Modrinth version ${version.id} has no downloadable file`);
    files.push({
      projectId: nextProjectId,
      versionId: version.id,
      versionNumber: version.version_number,
      fileName: file.filename,
      fileSize: file.size,
      downloadUrl: file.url,
      sha1: file.hashes?.sha1 || null,
    });
  };
  await resolve(projectId, null, true);
  return { provider: "modrinth", title: rootTitle, gameVersion, loader: "Fabric", files };
};

const requestHandler = async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const pathname = url.pathname.startsWith("/minecraft/") ? url.pathname.slice("/minecraft".length) : url.pathname;
    if (request.method !== "GET") {
      response.setHeader("allow", "GET");
      return sendJson(response, 405, { error: "method_not_allowed" });
    }
    if (pathname === "/health") {
      return sendJson(response, 200, { service, status: "ok", apiVersion, capabilities, timestamp: new Date().toISOString() });
    }
    if (pathname === "/v1/capabilities") return sendJson(response, 200, { service, apiVersion, capabilities });
    if (pathname === "/v1/catalog/search") {
      const query = (url.searchParams.get("query") || "").trim().slice(0, 100);
      const gameVersion = url.searchParams.get("gameVersion") || "";
      const loader = (url.searchParams.get("loader") || "fabric").toLowerCase();
      const offset = Math.max(0, Math.min(10_000, Number(url.searchParams.get("offset") || 0) || 0));
      if (!validGameVersion(gameVersion) || loader !== "fabric") return sendJson(response, 400, { error: "invalid_catalog_filter" });
      const key = `search:${query}:${gameVersion}:${offset}`;
      const result = await cached(key, query ? 60_000 : 5 * 60_000, () => searchCatalog({ query, gameVersion, offset }));
      return sendJson(response, 200, result, "public, max-age=30");
    }
    const installMatch = pathname.match(/^\/v1\/catalog\/modrinth\/([^/]+)\/install$/);
    if (installMatch) {
      const projectId = decodeURIComponent(installMatch[1]);
      const gameVersion = url.searchParams.get("gameVersion") || "";
      if (!validProjectId(projectId) || !validGameVersion(gameVersion)) return sendJson(response, 400, { error: "invalid_install_request" });
      const plan = await cached(`install:${projectId}:${gameVersion}`, 5 * 60_000, () => resolveInstallPlan(projectId, gameVersion));
      return sendJson(response, 200, plan, "public, max-age=60");
    }
    return sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    return sendJson(response, 502, { error: "provider_unavailable", message: String(error?.message || error) });
  }
};

const tlsKeyPath = process.env.TLS_KEY_PATH;
const tlsCertPath = process.env.TLS_CERT_PATH;
const server = tlsKeyPath && tlsCertPath
  ? https.createServer({ key: fs.readFileSync(tlsKeyPath), cert: fs.readFileSync(tlsCertPath) }, requestHandler)
  : http.createServer(requestHandler);

server.listen(port, "0.0.0.0", () => console.log(`${service} listening on ${port}${tlsKeyPath ? " with TLS" : ""}`));
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
