export const releaseTool = {
  type: "function", name: "latest_modrinth_release", strict: true,
  description: "Look up the latest stable Modrinth release for a named project and exact Minecraft version. Ask for a missing version. Use the requested loader or null for all loaders.",
  parameters: {
    type: "object", additionalProperties: false, required: ["project", "minecraft", "loader"],
    properties: {
      project: { type: "string", description: "Modrinth project slug or ID, e.g. iris." },
      minecraft: { type: "string", description: "Exact game version supplied by the user, including in recent turns." },
      loader: { type: ["string", "null"], enum: ["fabric", "quilt", "forge", "neoforge", null] },
    },
  },
};

const result = (answer, status = "answered") => ({ answer, status, scope: "minecraft", action: null, helpIds: [] });
const slugPattern = /^[A-Za-z0-9_-]{1,64}$/;
const projectTypes = new Set(["mod", "modpack", "shader", "resourcepack", "datapack", "plugin"]);
const loaderNames = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge" };

export async function lookupRelease(args, { question, recent }) {
  const { project, minecraft, loader } = args ?? {};
  if (typeof project !== "string" || !slugPattern.test(project)) return result("Which Modrinth project should I check? Send its name or project link.", "clarify");
  const userVersions = [question, ...recent.map(([user]) => user)].flatMap(text => text.match(/\b\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.-]+)?\b/gi) ?? []);
  if (!userVersions.includes(minecraft)) return result("Which exact Minecraft version should I check on Modrinth?", "clarify");
  if (loader !== null && !Object.hasOwn(loaderNames, loader)) return result("Which mod loader are you using?", "clarify");
  const projectApi = new URL("https://api.modrinth.com/v2/project/" + project);
  const versionsApi = new URL(projectApi + "/version");
  versionsApi.searchParams.set("game_versions", JSON.stringify([minecraft]));
  versionsApi.searchParams.set("include_changelog", "false");
  if (loader) versionsApi.searchParams.set("loaders", JSON.stringify([loader]));
  const options = { headers: { "User-Agent": "DelightClient/Alula (support@bloomclient.org)" }, redirect: "error", signal: AbortSignal.timeout(4000) };
  try {
    const [metadata, releases] = await Promise.all([fetch(projectApi, options), fetch(versionsApi, options)]);
    if (metadata.status === 404) return result("I couldn’t find that project on Modrinth. What’s its Modrinth project link?", "clarify");
    if (!metadata.ok || !releases.ok) throw Error();
    const [info, versions] = await Promise.all([metadata.json(), releases.json()]);
    if (!slugPattern.test(info.slug ?? "") || !projectTypes.has(info.project_type) || typeof info.title !== "string" || !Array.isArray(versions)) throw Error();
    const page = "https://modrinth.com/" + info.project_type + "/" + info.slug;
    const matches = versions.filter(v => v.project_id === info.id && v.version_type === "release"
      && v.game_versions?.includes(minecraft) && Array.isArray(v.loaders) && (!loader || v.loaders.includes(loader))
      && /^[A-Za-z0-9]+$/.test(v.id) && typeof v.version_number === "string" && Number.isFinite(Date.parse(v.date_published)))
      .sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published));
    const target = info.title + " for Minecraft " + minecraft + (loader ? " on " + loaderNames[loader] : "");
    if (!matches.length) return result("Modrinth lists no stable release of " + target + ".\n" + page + "/versions");
    if (loader) return result("The latest stable release of " + target + " is " + matches[0].version_number + ".\n" + page + "/version/" + matches[0].id);
    const seen = new Set();
    const builds = [];
    for (const version of matches) {
      const loaders = version.loaders.filter(name => !seen.has(name));
      if (!loaders.length) continue;
      loaders.forEach(name => seen.add(name));
      builds.push(loaders.map(name => loaderNames[name] ?? name).join(" / ") + ": " + version.version_number + "\n" + page + "/version/" + version.id);
      if (builds.length === 4) break;
    }
    if (!builds.length) throw Error();
    return result("Latest stable builds of " + target + "\n\n" + builds.join("\n\n"));
  } catch {
    return result("I couldn’t verify the release with Modrinth just now. Try the lookup again in a moment.", "unsupported");
  }
}
