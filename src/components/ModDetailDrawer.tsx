import { useEffect } from "react";
import { ExternalLink, FileArchive, Puzzle, RefreshCw, ShieldCheck, X } from "lucide-react";
import "./mod-detail-drawer.css";

export type ModProjectDetails = {
  description: string;
  dependencies: Array<{ projectId: string; title: string; dependencyType: string }>;
  versions: Array<{ id: string; versionNumber: string; versionType: string; datePublished: string; gameVersions: string[] }>;
  files: Array<{ fileName: string; fileSize: number; primary: boolean }>;
};

export type ModDrawerSelection = {
  key: string;
  title: string;
  icon?: string | null;
  author: string;
  installedVersion: string;
  source: string;
  summary: string;
  fileName: string;
  fileSize: number;
  projectUrl?: string;
  projectId?: string;
  canInstall: boolean;
  installed: boolean;
};

type Props = {
  selection: ModDrawerSelection;
  details: ModProjectDetails | null;
  loading: boolean;
  error: string;
  actionPending: boolean;
  onClose: () => void;
  onAction: () => void;
  onOpenSource?: () => void;
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const dependencyLabel = (value: string) => value === "required" ? "Required" : value === "optional" ? "Optional" : value === "incompatible" ? "Incompatible" : value;

export function ModDetailDrawer({ selection, details, loading, error, actionPending, onClose, onAction, onOpenSource }: Props) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const description = details?.description.trim() || selection.summary.trim();
  const catalogProject = Boolean(selection.projectId);
  return <><button className="mod-detail-dismiss-layer" type="button" tabIndex={-1} aria-label="Close mod details" onClick={onClose} /><aside className="mod-detail-drawer" aria-label={`${selection.title} details`}>
    <header className="mod-detail-header">
      <span className="mod-detail-icon">{selection.icon ? <img src={selection.icon} alt="" /> : <Puzzle size={28} />}</span>
      <div className="mod-detail-identity">
        <h2>{selection.title}</h2>
        <p>by {selection.author}</p>
        <div><span>{selection.installedVersion}</span><i aria-hidden="true" /><span>{selection.source}</span></div>
      </div>
      <button className="mod-detail-close" type="button" onClick={onClose} aria-label="Close mod details" title="Close"><X size={20} /></button>
    </header>

    <div className="mod-detail-body">
      {loading && <div className="mod-detail-loading" role="status"><RefreshCw className="spin" size={20} /><span>Loading project details</span></div>}
      {error && <p className="mod-detail-error">{error}</p>}

      <section className="mod-detail-section">
        <h3>Description</h3>
        <p>{description || "No description is available for this local mod file."}</p>
        {selection.projectUrl && onOpenSource && <button type="button" className="mod-detail-source" onClick={onOpenSource}><ExternalLink size={15} />View on Modrinth</button>}
      </section>

      <section className="mod-detail-section">
        <h3>Dependencies</h3>
        {details ? details.dependencies.length ? <div className="mod-detail-rows">{details.dependencies.map(item => <div className="mod-detail-row" key={`${item.projectId}:${item.dependencyType}`}><ShieldCheck size={17} /><span><b>{item.title}</b><small>{dependencyLabel(item.dependencyType)}</small></span></div>)}</div> : <p className="mod-detail-muted">No declared dependencies for this compatible version.</p> : <p className="mod-detail-muted">{catalogProject && loading ? "Loading declared dependencies…" : catalogProject ? "Dependency details are temporarily unavailable." : "Dependency data is not attached to local files."}</p>}
      </section>

      <section className="mod-detail-section">
        <h3>Versions</h3>
        {details ? details.versions.length ? <div className="mod-version-list">{details.versions.map(item => <div key={item.id}><b>{item.versionNumber}</b><span>{item.versionType}</span><small>{item.gameVersions.slice(0, 2).join(" · ")}</small></div>)}</div> : <p className="mod-detail-muted">No compatible versions were returned.</p> : <div className="mod-version-list"><div><b>{selection.installedVersion}</b><span>{catalogProject ? loading ? "Loading…" : "Compatible" : "Installed"}</span></div></div>}
      </section>

      <section className="mod-detail-section">
        <h3>Files</h3>
        <div className="mod-detail-rows">{(details?.files.length ? details.files : [{ fileName: selection.fileName, fileSize: selection.fileSize, primary: true }]).map(item => <div className="mod-detail-row" key={item.fileName}><FileArchive size={17} /><span><b title={item.fileName}>{item.fileName}</b><small>{formatBytes(item.fileSize)}{item.primary ? " · Primary" : ""}</small></span></div>)}</div>
      </section>
    </div>

    <footer className="mod-detail-footer">
      <button className={`${selection.installed ? "is-installed" : ""} ${actionPending ? "is-pending" : ""}`} type="button" disabled={!selection.canInstall || actionPending} onClick={onAction}>{actionPending ? "Installing…" : selection.installed ? "Installed" : "Install"}</button>
    </footer>
  </aside></>;
}
