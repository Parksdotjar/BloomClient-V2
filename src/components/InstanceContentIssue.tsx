import { CircleAlert, RotateCw } from "lucide-react";

export function InstanceContentIssue({ title, details, onRetry, retryLabel = "Try again", checking = false }: {
  title: string;
  details?: string;
  onRetry?: () => void;
  retryLabel?: string;
  checking?: boolean;
}) {
  return <div className="instance-content-issue">
    <p className="instance-content-issue-title" role="alert"><CircleAlert size={15} aria-hidden="true" />{title}</p>
    {onRetry && <button type="button" className="settings-action" onClick={onRetry} disabled={checking}>
      <RotateCw size={14} aria-hidden="true" />{checking ? "Checking…" : retryLabel}
    </button>}
    {details && details !== title && <details>
      <summary>Details</summary>
      <p>{details}</p>
    </details>}
  </div>;
}
