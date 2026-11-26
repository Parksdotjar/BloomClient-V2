import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { ToolbarIconSwap } from "./ConnectedToolbar";
import "./content-toolbar.css";

type Props = {
  category: string;
  browsing: boolean;
  onAdd: () => void;
  onBack: () => void;
  searchField: ReactNode;
  installedAction?: ReactNode;
};

export function ContentToolbar({ category, browsing, onAdd, onBack, searchField, installedAction }: Props) {
  const actionCopy = useRef<HTMLSpanElement>(null);
  const addLabel = useRef<HTMLSpanElement>(null);
  const backLabel = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const copy = actionCopy.current, add = addLabel.current, back = backLabel.current;
    if (!copy || !add || !back) return;
    const updateWidths = () => {
      copy.style.setProperty("--content-add-width", `${add.offsetWidth + 1}px`);
      copy.style.setProperty("--content-back-width", `${back.offsetWidth + 1}px`);
    };
    updateWidths();
    const observer = new ResizeObserver(updateWidths);
    observer.observe(add);
    observer.observe(back);
    return () => observer.disconnect();
  }, [category]);

  return <div className="manager-heading content-toolbar" data-mode={browsing ? "catalog" : "installed"}>
    <div className="content-toolbar-face">
      {searchField}
      <div className="content-toolbar-actions">
        {!browsing && installedAction}
        <button type="button" className="content-toolbar-action" onClick={browsing ? onBack : onAdd}
          aria-label={browsing ? `Back to installed ${category.toLowerCase()}` : `Add ${category}`}>
          <ToolbarIconSwap active={browsing} resting={<Plus size={17} />} engaged={<ArrowLeft size={17} />} />
          <span ref={actionCopy} className="content-toolbar-action-copy" aria-hidden="true">
            <span ref={addLabel} className="content-toolbar-action-label" data-action-label="add">Add {category.toLowerCase()}</span>
            <span ref={backLabel} className="content-toolbar-action-label" data-action-label="back">Back to installed</span>
          </span>
        </button>
      </div>
    </div>
    {browsing && <h2 className="content-toolbar-catalog-title">{category} Library</h2>}
  </div>;
}
