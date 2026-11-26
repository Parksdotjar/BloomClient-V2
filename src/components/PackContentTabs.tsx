import { type Ref } from "react";
import { Layers3, Puzzle, WandSparkles, type LucideIcon } from "lucide-react";

export const packContentCategories = [
  { category: "mods", label: "Mods", icon: Puzzle },
  { category: "resourcepacks", label: "Resource packs", icon: Layers3 },
  { category: "shaderpacks", label: "Shaders", icon: WandSparkles },
] as const;

export function PackContentTabs({ id, selected, onSelect, tabsRef }: {
  id: string; selected: number; onSelect: (index: number) => void; tabsRef?: Ref<HTMLDivElement>;
}) {
  return <PackTabs id={id} panelId={id + "-files"} label="Pack contents" tabs={packContentCategories}
    selected={selected} onSelect={onSelect} tabsRef={tabsRef} />;
}

export function PackTabs({id, panelId, label, tabs, selected, onSelect, tabsRef}: {
  id: string; panelId: string; label: string;
  tabs: readonly {category: string; label: string; icon: LucideIcon}[];
  selected: number; onSelect: (index: number) => void; tabsRef?: Ref<HTMLDivElement>;
}) {
  return <div className="instance-tabbar">
    <div ref={tabsRef} className="instance-content-segments" role="tablist" aria-label={label}>
      {tabs.map(({ category, label, icon: Icon }, index) => <button key={category} type="button"
        role="tab" id={id + category} aria-controls={panelId} aria-selected={selected === index}
        tabIndex={selected === index ? 0 : -1} className={selected === index ? "active" : ""} onClick={() => onSelect(index)}
        onKeyDown={event => {
          const count = tabs.length;
          let next: number;
          switch (event.key) {
            case "ArrowLeft": next = (index + count - 1) % count; break;
            case "ArrowRight": next = (index + 1) % count; break;
            case "Home": next = 0; break;
            case "End": next = count - 1; break;
            default: return;
          }
          event.preventDefault();
          onSelect(next);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>
        <Icon size={16} aria-hidden="true" />{label}
      </button>)}
    </div>
  </div>;
}
