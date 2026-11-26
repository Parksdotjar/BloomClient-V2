import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Plus, SlidersHorizontal } from "lucide-react";
import { ToolbarIconSwap } from "./ConnectedToolbar";
import { FilterMenu, FilterReset, FilterSection } from "./FilterMenu";
import "./content-toolbar.css";

type Props = {
  category: string;
  browsing: boolean;
  version: string;
  loader: string;
  sort: string;
  filter: string;
  onSortChange: (value: string) => void;
  onFilterChange: (value: string) => void;
  onAdd: () => void;
  onBack: () => void;
  catalogControls?: ReactNode;
  catalogFiltered?: boolean;
  searchField: ReactNode;
  installedAction?: ReactNode;
};

export function ContentToolbar({ category, browsing,
  version, loader, sort, filter, onSortChange, onFilterChange, onAdd, onBack, catalogControls, catalogFiltered = false, searchField, installedAction }: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const catalogFilters = browsing && Boolean(catalogControls);
  const expanded = filtersOpen && (!browsing || catalogFilters);
  const filtered = browsing ? catalogFiltered : sort !== "Name" || filter !== "All";
  const mode = browsing ? "catalog" : "installed";

  const action = <button type="button" className={`content-toolbar-action ${browsing ? "catalog-close" : "add-content"}`}
          onClick={browsing ? onBack : onAdd}
          aria-label={browsing ? `Back to installed ${category.toLowerCase()}` : `Add ${category}`}>
          <ToolbarIconSwap active={browsing} resting={<Plus size={17} />} engaged={<ArrowLeft size={17} />} />
          <span key={mode} className="content-toolbar-action-label">{browsing ? "Back to installed" : `Add ${category.toLowerCase()}`}</span>
        </button>;

  useEffect(() => { setFiltersOpen(false); }, [browsing]);
  return <div className="manager-heading content-toolbar" data-mode={mode} data-filters-open={expanded} data-catalog-filters={catalogFilters}>
    <div className="content-toolbar-face">
      {searchField}
      <div className="manager-tools">
        <div className="content-toolbar-filter-slot" inert={browsing && !catalogFilters} aria-hidden={browsing && !catalogFilters}>
          <button ref={trigger} type="button" className="content-filter-trigger"
            data-filtered={filtered} aria-label={catalogFilters ? `Filter ${category.toLowerCase()}` : `Filter content: sorted by ${sort}, showing ${filter.toLowerCase()}`}
            aria-haspopup="menu" aria-expanded={expanded} aria-controls={expanded ? menuId : undefined} title="Sort and filter"
            onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={17} strokeWidth={1.7} /><span>Filter</span></button>
        </div>
        <div className="content-toolbar-actions">
          {!browsing && installedAction}
          {action}
        </div>
      </div>
    </div>
    {expanded && <FilterMenu anchor={trigger} id={menuId} title={browsing ? "Modrinth filters" : "Filter " + category.toLowerCase()} onClose={() => setFiltersOpen(false)}>
        {catalogFilters ? catalogControls : <>
        <FilterSection label="Show" options={["All", "Enabled", "Disabled"]} value={filter} onChange={onFilterChange} />
        <FilterSection label="Sort by" options={["Name", "Size"]} value={sort} onChange={onSortChange} />
        <FilterReset label="Reset" disabled={!filtered} onReset={() => { onSortChange("Name"); onFilterChange("All"); }} />
        </>}
    </FilterMenu>}
    {browsing && <div className="content-toolbar-identity">
      <h2>{category} Library</h2>
      <div className="content-toolbar-readout">Minecraft {version} · {loader}</div>
    </div>}
  </div>;
}
