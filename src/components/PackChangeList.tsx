import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react";
import { workspaceChangeCategories, type WorkspaceChange } from "../services/workspace-release-changes";
import "./follow-updates.css";

const kinds = {added: "Added", removed: "Removed", changed: "Changed"};

export function PackChangeList({changes, label = "Changes"}: {changes: WorkspaceChange[]; label?: string}) {
  if (!changes.length) return null;
  return <ul className="follow-release-diff" aria-label={label}>
    {changes.map((change, index) => <li key={index}>
      <div><strong>{change.before && change.after && change.before !== change.after
        ? <>{change.before} <ArrowRight size={13} aria-label="to"/> {change.after}</>
        : change.after ?? change.before}</strong><small>{workspaceChangeCategories[change.category]}</small></div>
      <span>{kinds[change.kind]}</span>
    </li>)}
  </ul>;
}
