import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { contentRoot, readCatalog, validate } from "./emotes.mjs";

export function stageEmote(file, { root = contentRoot, replace = false } = {}) {
  const bytes = readFileSync(file);
  if (bytes.length > 512 * 1024) throw new Error("Emote package exceeds 512 KiB.");
  let count = 0;
  const names = new Set();
  const files = unzipSync(bytes, { filter({ name, originalSize }) {
    if (++count > 2 || originalSize > 256 * 1024 || names.has(name) || !["emote.json", "animation.json"].includes(name)) {
      throw new Error("The package must contain two bounded emote JSON files.");
    }
    names.add(name);
    return true;
  }});
  if (count !== 2) throw new Error("Both emote.json and animation.json are required.");
  const metadata = JSON.parse(strFromU8(files["emote.json"]));
  const animation = JSON.parse(strFromU8(files["animation.json"]));
  validate(metadata, animation);
  mkdirSync(root, { recursive: true });
  const id = metadata.id.slice(6), destination = join(root, id);
  const catalog = readCatalog(root);
  const current = catalog.find(({ entry }) => entry.id === metadata.id);
  if (current) metadata.order = current.entry.order;
  const entry = validate(metadata, animation);
  if (existsSync(destination) && !replace) throw new Error("Pass --replace to update an existing emote.");
  if (catalog.some(({ entry: item }) => item.id !== entry.id &&
      (item.animation === entry.animation || item.order === entry.order))) throw new Error("The emote name or wheel order is already used.");
  const staging = mkdtempSync(join(root, ".delight-stage-"));
  const backup = staging + "-previous";
  let moved = false;
  try {
    writeFileSync(join(staging, "emote.json"), JSON.stringify(metadata) + "\n");
    writeFileSync(join(staging, "animation.json"), JSON.stringify(animation) + "\n");
    if (existsSync(destination)) {
      renameSync(destination, backup);
      moved = true;
    }
    renameSync(staging, destination);
  } catch (error) {
    if (moved) renameSync(backup, destination);
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { entry, backup: moved ? backup : undefined };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error("Use stage-delight-emote.mjs <emote.zip> [--replace].");
    const { entry } = stageEmote(file, { replace: process.argv.includes("--replace") });
    console.log(entry.name + " is staged for the mod build.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
