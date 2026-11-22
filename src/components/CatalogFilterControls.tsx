import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FilterReset, FilterSection } from "./FilterMenu";
import { catalogFilterLabel, type CatalogFilters } from "../services/catalog-filters";

type Choices = { categories: string[]; loaders: string[]; versions: string[] };
let savedChoices: Choices | null = null;
export function CatalogFilterControls({ value, version, instanceVersion, onChange, onVersion, onReset, changed }: {
  value: CatalogFilters; version: string; instanceVersion: string; changed: boolean;
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
  return <>
    <FilterSection label="Category" value={value.category ? catalogFilterLabel(value.category) : "All categories"} disabled={!choices} options={["All categories", ...categories.map(catalogFilterLabel)]} onChange={label => update({ category: categories.find(category => catalogFilterLabel(category) === label) || "" })} />
    <FilterSection label="Environment" value={environments[value.environment as keyof typeof environments]} options={Object.values(environments)} onChange={label => update({ environment: Object.entries(environments).find(([, text]) => text === label)![0] })} />
    <FilterSection label="Mod loader" value={value.loader ? catalogFilterLabel(value.loader) : "Any loader"} options={["Any loader", ...loaders.map(catalogFilterLabel)]} onChange={label => update({ loader: loaders.find(loader => catalogFilterLabel(loader) === label) || "" })} />
    <FilterSection label="Minecraft version" value={version || "Any version"} options={["Any version", ...versions]} onChange={label => onVersion(label === "Any version" ? "" : label)} />
    <FilterSection label="Sort results" value={sorts[value.sort as keyof typeof sorts]} options={Object.values(sorts)} onChange={label => update({ sort: Object.entries(sorts).find(([, text]) => text === label)![0] })} />
    <div className="filter-menu-actions">{error ? <button type="button" role="menuitem" className="filter-reset" onClick={() => setAttempt(value => value + 1)}>Retry filter choices</button> : !choices && <span role="status">Loading choices…</span>}<FilterReset disabled={!changed} onReset={onReset} /></div>
  </>;
}
