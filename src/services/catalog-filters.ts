export type CatalogFilters = { category: string; environment: string; loader: string; sort: string };
export const defaultCatalogFilters = (): CatalogFilters => ({ category: "", environment: "any", loader: "fabric", sort: "auto" });
export const catalogFiltersChanged = (value: CatalogFilters, version: string, instanceVersion: string) => Boolean(value.category || value.environment !== "any" || value.loader !== "fabric" || value.sort !== "auto" || version !== instanceVersion);
export const catalogFilterLabel = (value: string) => ({ fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt", worldgen: "World generation" }[value] || value.replace(/[-_]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()));
export function catalogInstallRestriction(item: { loader: string; gameVersion: string; loaders?: string[]; gameVersions?: string[] }, instance: { loader: string; version: string }): string | undefined {
  const loaders = item.loaders?.length ? item.loaders : item.loader.toLowerCase().split(/,\s*/);
  const versions = item.gameVersions?.length ? item.gameVersions : [item.gameVersion];
  if (!loaders.some(loader => loader.toLowerCase() === instance.loader.toLowerCase())) return `This file requires ${item.loader}. This instance uses ${instance.loader}.`;
  if (!versions.includes(instance.version)) return `This file is for Minecraft ${item.gameVersion}. This instance uses ${instance.version}.`;
}
