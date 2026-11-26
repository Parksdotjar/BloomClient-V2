import type { ContentCategory, InstanceContentItem } from "../components/InstalledContentRow";

export type ExcludedLocalPackFile = { fileName: string; sha512: string };
export type MissingPackDependency = { projectId: string | null; versionId: string | null; requiredBy: string[] };
export type PackDependencyReview = {
  reviewToken: string | null;
  actions: { name: string; version: string; fileName: string; kind: "install" | "enable"; requiredBy: string[] }[];
  issues: string[];
};

export type CheckedPackFile = {
  category: ContentCategory;
  fileName: string;
  size: number;
  enabled: boolean;
  state: "verified" | "managed" | "issue" | "localOnly";
  message: string;
  canKeepLocal?: boolean;
  duplicateGroup?: string | null;
  projectId: string | null;
  versionId: string | null;
  sha512: string | null;
};

export type PackCompatibility = {
  reviewToken: string | null;
  instanceId: string;
  name: string;
  minecraftVersion: string;
  loader: string;
  loaderVersion: string | null;
  files: CheckedPackFile[];
  issues: string[];
  excludedFolders: string[];
  excludedLocalFiles?: ExcludedLocalPackFile[];
  missingDependencies?: MissingPackDependency[];
};

export const packFileKey = (category: ContentCategory, fileName: string) => category + "/" + fileName;

// The display inventory and source check read disk independently. Only combine
// them when every row, including disabled files, belongs to the same inventory.
export function matchCheckedFiles(instanceId: string, report: PackCompatibility,
  inventory: Record<ContentCategory, InstanceContentItem[]>) {
  if (report.instanceId !== instanceId) return null;
  const files = new Map(report.files.map(file => [packFileKey(file.category, file.fileName), file]));
  if (files.size !== report.files.length) return null;
  const unmatched = new Set(files.keys());
  for (const category of Object.keys(inventory) as ContentCategory[]) {
    for (const item of inventory[category]) {
      const key = packFileKey(category, item.fileName);
      const file = files.get(key);
      if (!file || file.size !== item.size || file.enabled !== item.enabled || !unmatched.delete(key)) return null;
    }
  }
  return unmatched.size === 0 ? files : null;
}
