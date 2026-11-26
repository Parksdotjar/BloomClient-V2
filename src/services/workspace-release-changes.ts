import type { ContentCategory } from "../components/InstalledContentRow";
import type { PackCompatibility } from "./pack-compatibility";

type ReleaseFile = {
  category: ContentCategory;
  fileName: string;
  size: number;
  enabled: boolean;
  source: string;
  sha512: string | null;
  projectId: string | null;
  versionId: string | null;
};

export type ReleaseManifest = {
  name: string;
  minecraftVersion: string;
  loaderVersion: string;
  excludedFolders: string[];
  files: ReleaseFile[];
};

export type WorkspaceChange = {
  category: ContentCategory | "runtime" | "pack";
  kind: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
};

export const workspaceChangeCategories = {
  mods: "Mod", resourcepacks: "Resource pack", shaderpacks: "Shader", runtime: "Runtime", pack: "Pack",
};

const bareName = (file: ReleaseFile) => file.fileName.replace(/\.disabled$/i, "");
const displayName = (file: ReleaseFile) => bareName(file) + (file.enabled ? "" : " (disabled)");

function uniqueFiles(files: Set<ReleaseFile>, key: (file: ReleaseFile) => string | null) {
  const keys = new Map<string, ReleaseFile | null>();
  for (const file of files) {
    const id = key(file);
    if (id) keys.set(id, keys.has(id) ? null : file);
  }
  return keys;
}

export function workspaceReleaseChanges(base: ReleaseManifest, next: PackCompatibility, preserveName = false): WorkspaceChange[] {
  return workspaceManifestChanges(base, {
    ...next,
    name: preserveName ? base.name : next.name,
    loaderVersion: next.loaderVersion ?? "",
    files: next.files.filter(file => file.state !== "localOnly")
      .map(file => ({ ...file, source: file.state === "managed" ? "delight" : "modrinth" })),
  });
}

export function workspaceManifestChanges(base: ReleaseManifest, next: ReleaseManifest): WorkspaceChange[] {
  const changes: WorkspaceChange[] = [];
  function setting(category: "runtime" | "pack", label: string, before: string, after: string) {
    if (before !== after) changes.push({ category, kind: "changed", before: label + " · " + before, after });
  }
  setting("pack", "Pack name", base.name, next.name);
  setting("runtime", "Minecraft", base.minecraftVersion, next.minecraftVersion);
  setting("runtime", "Fabric", base.loaderVersion, next.loaderVersion);
  setting("pack", "Excluded folders", [...base.excludedFolders].sort().join(", ") || "None",
    [...next.excludedFolders].sort().join(", ") || "None");

  const oldFiles = new Set(base.files);
  const newFiles = new Set(next.files);
  function match(key: (file: ReleaseFile) => string | null) {
    const previous = uniqueFiles(oldFiles, key);
    const current = uniqueFiles(newFiles, key);
    for (const [id, before] of previous) {
      const after = current.get(id);
      if (!before || !after) continue;
      oldFiles.delete(before);
      newFiles.delete(after);
      if (before.fileName !== after.fileName || before.enabled !== after.enabled || before.size !== after.size
        || before.sha512 !== after.sha512 || before.projectId !== after.projectId || before.versionId !== after.versionId
        || before.source !== after.source) {
        let oldLabel = displayName(before);
        let newLabel = displayName(after);
        if (oldLabel === newLabel) {
          if (before.versionId && after.versionId && before.versionId !== after.versionId) {
            oldLabel += " · " + before.versionId;
            newLabel += " · " + after.versionId;
          } else if (before.sha512 && after.sha512 && before.sha512 !== after.sha512) {
            oldLabel += " · " + before.sha512.slice(0, 8);
            newLabel += " · " + after.sha512.slice(0, 8);
          }
        }
        changes.push({ category: after.category, kind: "changed", before: oldLabel, after: newLabel });
      }
    }
  }
  // Match unchanged paths first so variants in the same project remain distinct.
  match(file => file.category + "/" + file.fileName.toLowerCase());
  match(file => file.category + "/" + bareName(file).toLowerCase());
  match(file => file.projectId ? file.category + "/" + file.projectId : null);
  for (const file of newFiles) changes.push({category: file.category, kind: "added", before: null, after: displayName(file)});
  for (const file of oldFiles) changes.push({category: file.category, kind: "removed", before: displayName(file), after: null});
  return changes;
}
