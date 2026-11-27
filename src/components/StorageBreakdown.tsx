import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CaretDownIcon as ChevronDown, FolderOpenIcon as FolderOpen, ArrowsClockwiseIcon as RefreshCw } from "@phosphor-icons/react";
import "./storage-breakdown.css";

const categories = [
  ["worlds", "Worlds"],
  ["packs", "Mods and packs"],
  ["screenshots", "Screenshots"],
  ["logs", "Logs and crash reports"],
  ["other", "Other files"],
] as const;

type InstanceUsage = Record<(typeof categories)[number][0], number> & {
  id: string;
  name: string;
  bytes: number;
  unavailable: boolean;
  sharedFolder: boolean;
};

type CleanupItem = { id: string; name: string; location: string; bytes: number; modifiedMs: number };
type StorageUsage = {
  totalBytes: number;
  minecraftBytes: number;
  cacheBytes: number;
  skipped: number;
  instances: InstanceUsage[];
  cleanup: CleanupItem[];
  moreCleanup: boolean;
};
type CleanupResult = { removed: number; skipped: number; removedBytes: number };

function StorageUsageChart({ report }: { report: StorageUsage }) {
  const entries = [
    ...categories.map(([key, label]) => ({
      key, label, bytes: report.instances.reduce((sum, instance) => sum + instance[key], 0),
    })),
    { key: "minecraft", label: "Shared Minecraft downloads", bytes: report.minecraftBytes },
    { key: "cache", label: "Launcher cache", bytes: report.cacheBytes },
  ];

  return <div className="storage-usage-chart">
    <div className="storage-meter storage-usage-bar" aria-hidden="true">
      {entries.filter(entry => entry.bytes > 0).map(({ key, label, bytes }) =>
        <span key={key} className="storage-meter-fill" data-storage-category={key} style={{ flexGrow: bytes }}
          title={`${label} · ${formatStorageSize(bytes)}`} />)}
    </div>
    <ul className="storage-usage-legend" aria-label="Storage usage by category">
      {entries.map(({ key, label, bytes }) => <li key={key} data-storage-category={key}>
        <span className="storage-meter-fill storage-usage-swatch" aria-hidden="true" />
        <span>{label}</span><small>{formatStorageSize(bytes)}</small>
      </li>)}
    </ul>
  </div>;
}

export function formatStorageSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function StorageBreakdown({ active, cacheRevision }: { active: boolean; cacheRevision: number }) {
  const [report, setReport] = useState<StorageUsage>();
  const [refresh, setRefresh] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [scanError, setScanError] = useState("");
  const [actionError, setActionError] = useState("");
  const [outcome, setOutcome] = useState("");
  const pendingScan = useRef<Promise<StorageUsage> | null>(null);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setScanning(true);
    setScanError("");
    const scan = pendingScan.current
      ? pendingScan.current.catch(() => undefined).then(() => invoke<StorageUsage>("get_storage_usage"))
      : invoke<StorageUsage>("get_storage_usage");
    pendingScan.current = scan;
    void scan.then(result => {
      if (!current) return;
      setReport(result);
      setSelected([]);
    }).catch(error => {
      if (current) setScanError(String(error));
    }).finally(() => {
      if (pendingScan.current === scan) pendingScan.current = null;
      if (current) setScanning(false);
    });
    return () => { current = false; };
  }, [active, cacheRevision, refresh]);

  const cleanSelection = async () => {
    setCleaning(true);
    setActionError("");
    setOutcome("");
    try {
      const result = await invoke<CleanupResult>("clean_reviewed_storage", { ids: selected });
      setOutcome(`Removed ${result.removed} ${result.removed === 1 ? "file" : "files"} · ${formatStorageSize(result.removedBytes)} freed.${
        result.skipped ? ` ${result.skipped} ${result.skipped === 1 ? "file was" : "files were"} skipped.` : ""}`);
      setSelected([]);
      setRefresh(value => value + 1);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setCleaning(false);
    }
  };

  const selectedBytes = report?.cleanup.reduce((bytes, item) => selected.includes(item.id) ? bytes + item.bytes : bytes, 0) ?? 0;
  const openFolder = (instanceId: string) => {
    setActionError("");
    void invoke("open_instance_folder", { instanceId }).catch(error => setActionError(String(error)));
  };

  return <section className="storage-breakdown" aria-label="Storage breakdown">
    <div className="storage-breakdown-heading">
      <div className="storage-breakdown-total">
        <span>Space used</span>
        <div className="storage-amount"><strong>{report ? formatStorageSize(report.totalBytes) : "—"}</strong></div>
      </div>
      <button type="button" className="settings-action" disabled={scanning || cleaning}
        onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} />Refresh</button>
    </div>
    {scanning && <p role="status">Scanning storage…</p>}
    {scanError && <p role="alert">{scanError}</p>}
    {report && <>
      <StorageUsageChart report={report} />
      {report.skipped > 0 && <p>Some files or folders were unavailable or linked. The total is partial.</p>}
      <div className="storage-breakdown-instances">
        <h3>Instances</h3>
        {!report.instances.length && <p>No instances yet.</p>}
        {report.instances.map(instance => <details key={instance.id} className="storage-breakdown-detail">
          <summary><span>{instance.name}</span><small>{instance.unavailable ? "Unavailable" : instance.sharedFolder ? "Shared folder" : formatStorageSize(instance.bytes)}</small><ChevronDown size={15} /></summary>
          <div className="storage-breakdown-detail-body">
            {instance.sharedFolder && <p>This folder is counted elsewhere on this page.</p>}
            {instance.unavailable && <p>Delight couldn’t read this instance folder.</p>}
            {!instance.unavailable && !instance.sharedFolder && <dl>
              {categories.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{formatStorageSize(instance[key])}</dd></div>)}
            </dl>}
            {!instance.unavailable && <button type="button" className="settings-action" aria-label={`Open folder for ${instance.name}`}
              onClick={() => openFolder(instance.id)}><FolderOpen size={15} />Open folder</button>}
          </div>
        </details>)}
      </div>
      <details className="storage-breakdown-detail storage-cleanup">
        <summary><span>Review cleanup</span><small>{report.cleanup.length}{report.moreCleanup ? "+" : ""} {report.cleanup.length === 1 ? "file" : "files"}</small><ChevronDown size={15} /></summary>
        <div className="storage-breakdown-detail-body">
          {!report.cleanup.length ? <p>No archived logs or re-downloadable cache files older than 30 days.</p> : <>
            <p>Choose archived logs and re-downloadable cache files older than 30 days.</p>
            {report.moreCleanup && <p>Showing the 200 largest eligible files.</p>}
            <ul className="storage-cleanup-files">
              {report.cleanup.map(item => <li key={item.id}>
                <label>
                  <input type="checkbox" checked={selected.includes(item.id)} disabled={cleaning || scanning || !!scanError}
                    onChange={event => {
                      const checked = event.currentTarget.checked;
                      setSelected(ids => checked ? [...ids, item.id] : ids.filter(id => id !== item.id));
                    }} />
                  <span><strong>{item.name}</strong><small>{item.location} · {new Date(item.modifiedMs).toLocaleDateString()}</small></span>
                  <small>{formatStorageSize(item.bytes)}</small>
                </label>
              </li>)}
            </ul>
            <div className="storage-cleanup-actions">
              <span>{formatStorageSize(selectedBytes)} selected</span>
              <button type="button" className="settings-action" disabled={!selected.length || cleaning || scanning || !!scanError}
                onClick={() => void cleanSelection()}>{cleaning ? "Removing…" : "Remove selected"}</button>
            </div>
          </>}
        </div>
      </details>
    </>}
    {actionError && <p role="alert">{actionError}</p>}
    {outcome && <p role="status">{outcome}</p>}
  </section>;
}
