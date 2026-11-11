import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Produces a local candidate only. Never uploads assets or changes the existing release workflow.
export function mergeUpdaterManifests(manifests) {
  if (!manifests.length) throw new Error("Provide at least one updater manifest.");
  const merged = { ...manifests[0], platforms: {} };
  if (typeof merged.version !== "string" || !merged.version.trim()) throw new Error("Missing updater version.");
  for (const manifest of manifests) {
    if (manifest.version !== merged.version) throw new Error("Cannot combine updater manifests for different versions.");
    if (!manifest.platforms || typeof manifest.platforms !== "object" || Array.isArray(manifest.platforms)
        || !Object.keys(manifest.platforms).length) throw new Error("Missing updater platforms.");
    for (const [platform, artifact] of Object.entries(manifest.platforms)) {
      if (!artifact || typeof artifact.signature !== "string" || !artifact.signature.trim()
          || typeof artifact.url !== "string" || new URL(artifact.url).protocol !== "https:") {
        throw new Error(`Invalid signed updater artifact for ${platform}.`);
      }
      if (Object.hasOwn(merged.platforms, platform)) {
        const existing = merged.platforms[platform];
        if (existing.url !== artifact.url || existing.signature !== artifact.signature) {
          throw new Error(`Conflicting updater artifacts for ${platform}; refusing to replace one silently.`);
        }
      } else Object.defineProperty(merged.platforms, platform, { value: { ...artifact }, enumerable: true });
    }
  }
  return merged;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const paths = process.argv.slice(2);
  if (paths.length < 2) throw new Error("Usage: node scripts/merge-updater-manifests.mjs windows.json mac.json > combined.json");
  console.log(JSON.stringify(mergeUpdaterManifests(paths.map(path => JSON.parse(readFileSync(path, "utf8")))), null, 2));
}
