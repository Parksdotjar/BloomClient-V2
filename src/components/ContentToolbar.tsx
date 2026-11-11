import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, CirclePlus, ListFilter, RotateCcw } from "lucide-react";
import { ToolbarIconSwap, ToolbarSegments } from "./ConnectedToolbar";
import "./content-toolbar.css";

type Props = {
  category: string;
  total: number;
  enabled: number;
  visible: number;
  ready: boolean;
  searching: boolean;
  browsing: boolean;
  version: string;
  loader: string;
  sort: string;
  filter: string;
  onSortChange: (value: string) => void;
  onFilterChange: (value: string) => void;
  onAdd: () => void;
  onBack: () => void;
};

export function ContentToolbar({ category, total, enabled, visible, ready, searching, browsing,
  version, loader, sort, filter, onSortChange, onFilterChange, onAdd, onBack }: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const drawerId = useId();
  const expanded = filtersOpen && !browsing;
  const filtered = sort !== "Name" || filter !== "All";
  const mode = browsing ? "catalog" : "installed";
  const summary = browsing ? `Minecraft ${version} · ${loader}`
    : !ready ? "Loading installed content…"
    : searching || filter !== "All" ? `${visible.toLocaleString()} of ${total.toLocaleString()}${filter !== "All" ? ` · ${filter}` : " matching"}`
    : `${total.toLocaleString()} installed · ${enabled.toLocaleString()} enabled`;

  useEffect(() => { if (browsing) setFiltersOpen(false); }, [browsing]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setFiltersOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFiltersOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  return <div ref={root} className="manager-heading content-toolbar" data-mode={mode} data-filters-open={expanded}>
    <div className="content-toolbar-face">
      <div className="content-toolbar-identity">
        <h2 key={mode}>{browsing ? `${category} Library` : category}</h2>
        <div className="content-toolbar-readout"><span key={summary}>{summary}</span></div>
      </div>
      <div className="manager-tools">
        <div className="content-toolbar-filter-slot" inert={browsing} aria-hidden={browsing}>
          <button ref={trigger} type="button" className="content-filter-trigger"
            data-filtered={filtered} aria-label={`Filter content: sorted by ${sort}, showing ${filter.toLowerCase()}`}
            aria-expanded={expanded} aria-controls={drawerId} title="Sort and filter"
            onClick={() => setFiltersOpen(value => !value)}><ListFilter size={19} strokeWidth={2.2} /></button>
        </div>
        <button type="button" className={`content-toolbar-action ${browsing ? "catalog-close" : "add-content"}`}
          onClick={browsing ? onBack : onAdd}
          aria-label={browsing ? `Back to installed ${category.toLowerCase()}` : `Add ${category}`}>
          <ToolbarIconSwap active={browsing} resting={<CirclePlus size={17} />} engaged={<ArrowLeft size={17} />} />
          <span key={mode} className="content-toolbar-action-label">{browsing ? "Back to installed" : `Add ${category}`}</span>
        </button>
      </div>
    </div>
    <div id={drawerId} className="content-toolbar-drawer" inert={!expanded} aria-hidden={!expanded}>
      <div className="content-toolbar-drawer-body">
        <ToolbarSegments label="Show" options={["All", "Enabled", "Disabled"]} value={filter} onChange={onFilterChange} />
        <ToolbarSegments label="Sort by" options={["Name", "Size"]} value={sort} onChange={onSortChange} />
        <button type="button" className="content-toolbar-reset" disabled={!filtered}
          onClick={() => { onSortChange("Name"); onFilterChange("All"); }}><RotateCcw size={14} />Reset</button>
      </div>
    </div>
  </div>;
}
