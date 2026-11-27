import { useEffect, useState, type ComponentType } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowCounterClockwiseIcon as RotateCcw } from "@phosphor-icons/react";
import { catalogFilterLabel, type CatalogFilters } from "../services/catalog-filters";

type Choices = { categories: string[]; loaders: string[]; versions: string[] };
let savedChoices: Choices | null = null;
export function CatalogFilterControls({ active, value, version, instanceVersion, onChange, onVersion, onReset, changed, SelectControl }: {
  active: boolean; value: CatalogFilters; version: string; instanceVersion: string; changed: boolean;
  onChange: (value: CatalogFilters) => void; onVersion: (value: string) => void; onReset: () => void;
  SelectControl: ComponentType<{ value: string; options: string[]; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean }>;
}) {
  const [choices, setChoices] = useState(savedChoices);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    let current = true; setError(false);
    if (savedChoices) { setChoices(savedChoices); return; }
    void invoke<Choices>("get_catalog_filter_choices").then(result => { if (result) { savedChoices = result; if (current) setChoices(result); } }).catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [active, attempt]);
  const update = (patch: Partial<CatalogFilters>) => onChange({ ...value, ...patch });
  const categories = [...new Set([...(value.category ? [value.category] : []), ...(choices?.categories || [])])];
  const loaders = [...new Set(["fabric", "forge", "neoforge", "quilt", ...(choices?.loaders || [])])];
  const versions = [...new Set([instanceVersion, ...(version ? [version] : []), ...(choices?.versions || [])])];
  const environments = { any: "Any environment", client: "Client-side", server: "Server-side", both: "Client + server", either: "Either side" };
  const sorts = { auto: "Automatic", relevance: "Best match", downloads: "Most downloaded", follows: "Most followed", updated: "Recently updated", newest: "Newest" };
  const fields = [
    { label: "Minecraft version", value: version || "Any version", options: ["Any version", ...versions], onChange: (label: string) => onVersion(label === "Any version" ? "" : label) },
    { label: "Environment", value: environments[value.environment as keyof typeof environments], options: Object.values(environments), onChange: (label: string) => update({ environment: Object.entries(environments).find(([, text]) => text === label)![0] }) },
    { label: "Category", value: value.category ? catalogFilterLabel(value.category) : "All categories", options: ["All categories", ...categories.map(catalogFilterLabel)], onChange: (label: string) => update({ category: categories.find(category => catalogFilterLabel(category) === label) || "" }), disabled: !choices },
    { label: "Mod loader", value: value.loader ? catalogFilterLabel(value.loader) : "Any loader", options: ["Any loader", ...loaders.map(catalogFilterLabel)], onChange: (label: string) => update({ loader: loaders.find(loader => catalogFilterLabel(loader) === label) || "" }) },
    { label: "Sort results", value: sorts[value.sort as keyof typeof sorts], options: Object.values(sorts), onChange: (label: string) => update({ sort: Object.entries(sorts).find(([, text]) => text === label)![0] }) },
  ];
  return <>
    {fields.map(({ label, ...field }) => <div className="catalog-filter-field" key={label}>
      <span>{label}</span>
      <SelectControl {...field} ariaLabel={label} />
    </div>)}
    {error ? <button type="button" className="content-toolbar-reset" onClick={() => setAttempt(value => value + 1)}>Retry filter choices</button> : !choices && <span className="catalog-filter-status" role="status">Loading choices…</span>}
    <button type="button" className="content-toolbar-reset" disabled={!changed} onClick={onReset}><RotateCcw size={14} aria-hidden="true" />Reset filters</button>
  </>;
}
