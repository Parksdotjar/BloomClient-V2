import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowDownWideNarrow, Box, Layers, Monitor, Puzzle, RotateCcw } from "lucide-react";
import { Select } from "../main";
import { catalogFilterLabel, type CatalogFilters } from "../services/catalog-filters";
import "./catalog-filter-controls.css";

type Choices = { categories: string[]; loaders: string[]; versions: string[] };
let savedChoices: Choices | null = null;
export function CatalogFilterControls({ value, version, instanceVersion, owner, onChange, onVersion, onReset, changed }: {
  value: CatalogFilters; version: string; instanceVersion: string; owner: string; changed: boolean;
  onChange: (value: CatalogFilters) => void; onVersion: (value: string) => void; onReset: () => void;
}) {
  const [choices, setChoices] = useState(savedChoices);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true; setError(false);
    if (savedChoices && !attempt) return;
    void invoke<Choices>("get_catalog_filter_choices").then(result => { if (result) { savedChoices = result; if (current) setChoices(result); } }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [attempt]);
  const update = (patch: Partial<CatalogFilters>) => onChange({ ...value, ...patch });
  const categories = [...new Set([...(value.category ? [value.category] : []), ...(choices?.categories || [])])];
  const loaders = [...new Set(["fabric", "forge", "neoforge", "quilt", ...(choices?.loaders || [])])];
  const versions = [...new Set([instanceVersion, ...(version ? [version] : []), ...(choices?.versions || [])])];
  const environments = { any: "Any environment", client: "Client-side", server: "Server-side", both: "Client + server", either: "Either side" };
  const sorts = { auto: "Automatic", relevance: "Best match", downloads: "Most downloaded", follows: "Most followed", updated: "Recently updated", newest: "Newest" };
  return <div className="catalog-filter-grid">
    <label className="catalog-filter-field"><span><Puzzle size={13} />Category</span><Select ariaLabel="Mod category" menuOwner={owner} value={value.category ? catalogFilterLabel(value.category) : "All categories"} disabled={!choices} options={["All categories", ...categories.map(catalogFilterLabel)]} onChange={label => update({ category: categories.find(category => catalogFilterLabel(category) === label) || "" })} /></label>
    <label className="catalog-filter-field"><span><Monitor size={13} />Environment</span><Select ariaLabel="Mod environment" menuOwner={owner} value={environments[value.environment as keyof typeof environments]} options={Object.values(environments)} onChange={label => update({ environment: Object.entries(environments).find(([, text]) => text === label)![0] })} /></label>
    <label className="catalog-filter-field"><span><Layers size={13} />Mod loader</span><Select ariaLabel="Mod loader filter" menuOwner={owner} value={value.loader ? catalogFilterLabel(value.loader) : "Any loader"} options={["Any loader", ...loaders.map(catalogFilterLabel)]} onChange={label => update({ loader: loaders.find(loader => catalogFilterLabel(loader) === label) || "" })} /></label>
    <label className="catalog-filter-field"><span><Box size={13} />Minecraft version</span><Select ariaLabel="Minecraft version filter" menuOwner={owner} value={version || "Any version"} options={["Any version", ...versions]} onChange={label => onVersion(label === "Any version" ? "" : label)} /></label>
    <label className="catalog-filter-field"><span><ArrowDownWideNarrow size={13} />Sort results</span><Select ariaLabel="Sort mod results" menuOwner={owner} value={sorts[value.sort as keyof typeof sorts]} options={Object.values(sorts)} onChange={label => update({ sort: Object.entries(sorts).find(([, text]) => text === label)![0] })} /></label>
    <div className="catalog-filter-actions">{error ? <button type="button" className="content-toolbar-reset" onClick={() => setAttempt(value => value + 1)}>Retry filter choices</button> : !choices && <span role="status">Loading choices…</span>}<button type="button" className="content-toolbar-reset" disabled={!changed} onClick={onReset}><RotateCcw size={14} />Reset filters</button></div>
  </div>;
}
