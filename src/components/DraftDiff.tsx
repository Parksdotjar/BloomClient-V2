import { MinusIcon as Minus, PlusIcon as Plus } from "@phosphor-icons/react";
import { workspaceChangeCategories, type WorkspaceChange } from "../services/workspace-release-changes";

export function DraftDiff({changes}: {changes: WorkspaceChange[]}) {
  if (!changes.length) return <p>No content changes.</p>;
  return <table className="workspace-draft-diff" aria-label="Draft changes">
    <thead><tr>
      <th scope="col" data-diff="added"><Plus size={15} aria-hidden="true"/>Added</th>
      <th scope="col" data-diff="removed"><Minus size={15} aria-hidden="true"/>Removed</th>
    </tr></thead>
    <tbody>
      {changes.map(({category, before, after}, index) => <tr key={index}>
        <td data-diff={after ? "added" : undefined}>
          {after && <div className="workspace-diff-value"><Plus size={14} aria-hidden="true"/>
            <span><strong>{after}</strong><small>{workspaceChangeCategories[category]}</small></span></div>}
        </td>
        <td data-diff={before ? "removed" : undefined}>
          {before && <div className="workspace-diff-value"><Minus size={14} aria-hidden="true"/>
            <span><strong>{before}</strong><small>{workspaceChangeCategories[category]}</small></span></div>}
        </td>
      </tr>)}
    </tbody>
  </table>;
}
