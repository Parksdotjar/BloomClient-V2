import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Cuboid, RotateCw } from "lucide-react";
import { hasCompatibleModUpdates, isModAdvisory, isModDuplicateIssue, modMaintenanceNeedsAttention, type ModMaintenance, type ModMaintenanceEntry } from "../services/mod-maintenance";
import { InstanceContentIssue } from "./InstanceContentIssue";
import type { FollowUpdate } from "../services/follow-updates";
import { hasUpdate } from "../services/follow-updates";
import { CatalogArtwork } from "./CatalogFeedRow";
import { SettingsRow } from "./SettingsRow";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import "./mod-maintenance.css";

export function ModMaintenanceSettings({ maintenance, instances, libraryReady, followUpdates, onOpenInstance }: {
  maintenance: ModMaintenance;
  instances: { id: string; name: string; icon?: string | null; version: string; loader: string }[];
  libraryReady: boolean;
  followUpdates: Record<string, FollowUpdate | null>;
  onOpenInstance: (id: string, release: boolean) => void;
}) {
  const { entries, sweeping, lastCheck } = maintenance;
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ message: string; details?: string }>();
  const clean = async () => {
    setCleaning(true);
    setCleanupResult(undefined);
    try {
      const result = await invoke<{ archived: number; remaining: number; errors: string[] }>("keep_newest_mod_versions");
      const message = result.archived ? "Older copies moved to local backups." :
        result.remaining || result.errors.length ? "Some versions need attention." : "No duplicate versions found.";
      setCleanupResult({
        message: result.archived && result.remaining ? message + " Check Notifications for remaining conflicts." : message,
        details: result.errors.join("\n") || undefined,
      });
    } catch (error) {
      setCleanupResult({ message: "Couldn’t check duplicate versions.", details: userError(error) });
    } finally {
      setCleaning(false);
    }
  };
  const time = lastCheck ? new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(lastCheck.at) : "";
  const instanceResults = instances.flatMap(instance => {
    const entry = entries[instance.id];
    const status = modMaintenanceNeedsAttention(entry) ? "attention"
      : hasCompatibleModUpdates(entry?.report) ? "updates"
        : hasUpdate(followUpdates[instance.id]) ? "release" : null;
    return status ? [{ ...instance, status }] : [];
  }).sort((left, right) => Number(right.status === "attention") - Number(left.status === "attention"));
  return <>
    <SettingsRow title="Mod maintenance" description="Check all instances for compatible updates and required dependencies.">
      <button type="button" className="settings-action" disabled={!libraryReady || sweeping}
        onClick={() => void maintenance.checkAll(instances.map(item => item.id))}>
        <RotateCw className={sweeping ? "spinning" : undefined} size={15} aria-hidden="true" />
        {sweeping ? "Checking mods…" : "Check for mod updates"}
      </button>
    </SettingsRow>
    {(lastCheck || sweeping) && <div className="mod-maintenance-settings-results">
      <p role="status">{sweeping ? "Checking instances…" : !instances.length ? "No instances to check."
        : lastCheck?.complete ? `Checked ${time}` : `Check incomplete · ${time}`}</p>
      {!!instanceResults.length && <ul aria-label="Instances with mod maintenance results">
        {instanceResults.map(({ id, name, icon, version, loader, status }) => {
          const result = status === "attention" ? "Needs attention" : status === "release" ? "Pack update available" : "Updates available";
          return <li key={id}>
            <button type="button" className="mod-maintenance-instance" data-status={status}
              aria-label={[name, version, loader, result].join(", ")} onClick={() => onOpenInstance(id, status === "release")}>
              <span className="mod-maintenance-instance-art" aria-hidden="true">
                <CatalogArtwork source={icon} fallback={<Cuboid size={17} />} />
              </span>
              <span className="mod-maintenance-instance-copy"><strong>{name}</strong><small>{version} · {loader}</small></span>
              <span className="mod-maintenance-instance-status">{result}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </li>;
        })}
      </ul>}
    </div>}
    <SettingsRow title="Duplicate mods" description="Keep the newest compatible versions across your instances and back up older copies.">
      <button type="button" className="settings-action" disabled={!libraryReady || cleaning || Boolean(maintenance.active)}
        onClick={() => void clean()}>{cleaning ? "Checking versions…" : "Keep newest compatible versions"}</button>
    </SettingsRow>
    {cleanupResult && (cleanupResult.details
      ? <InstanceContentIssue title={cleanupResult.message} details={cleanupResult.details} />
      : <p className="instance-mod-maintenance-result" role="status">{cleanupResult.message}</p>)}
  </>;
}

function maintenanceIssue(entry?: ModMaintenanceEntry) {
  if (entry?.applyError) return { title: "Couldn’t apply mod changes.", details: entry.applyError };
  if (!entry?.scanError) return undefined;
  if (/\bcheck_mod_maintenance\b.*(?:not found|unknown)|unknown command.*\bcheck_mod_maintenance\b/i.test(entry.scanError)) {
    return { title: "Restart Delight Client to check mods.", details: entry.scanError };
  }
  if (entry.scanError.startsWith("You’re offline.")) return { title: "You’re offline. Reconnect to check mods." };
  return { title: "Couldn’t check mods.", details: entry.scanError };
}

export function InstanceModMaintenance({ entry, disabled, onCheck, onReview }: {
  entry?: ModMaintenanceEntry;
  disabled: boolean;
  onCheck: () => void;
  onReview: () => void;
}) {
  const checking = Boolean(entry?.checking);
  const problem = maintenanceIssue(entry);
  const report = entry?.report;
  const needsAttention = modMaintenanceNeedsAttention(entry);
  const readyToUpdate = Boolean(hasCompatibleModUpdates(report));
  const result = checking ? "Checking mods…" : report && !problem
    ? !report.complete ? "Check incomplete" : readyToUpdate ? "Updates available" : needsAttention ? "Needs attention" : "Mods are up to date"
    : "";
  return <section className="instance-mod-maintenance instance-preference-row" aria-label="Mod maintenance">
    <h3 className="instance-preference-label">Mod maintenance</h3>
    <div className="instance-mod-maintenance-controls">
      <div className="mod-maintenance-actions">
        <button type="button" className="settings-action" disabled={disabled || checking} onClick={onCheck}>
          <RotateCw size={15} className={checking ? "spinning" : undefined} aria-hidden="true" />Check for mod updates and dependencies
        </button>
        {!checking && (readyToUpdate || needsAttention) &&
          <button type="button" className="settings-action" onClick={onReview}>View Mods</button>}
      </div>
      {result && <p className="instance-mod-maintenance-result" role="status">{result}</p>}
      {problem && !checking && <InstanceContentIssue {...problem} />}
    </div>
  </section>;
}

export function ModMaintenanceIssues({ entry, hasDuplicates, retry }: {
  entry?: ModMaintenanceEntry;
  hasDuplicates?: boolean;
  retry: () => void;
}) {
  const panel = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const problem = maintenanceIssue(entry);
  const canRetry = Boolean(problem || (entry?.report && !entry.report.complete));
  const issues = entry?.report?.issues ?? [];
  const duplicates = hasDuplicates ?? issues.some(isModDuplicateIssue);
  const reasons = [...new Set([
    ...(problem ? [problem.title, ...(problem.details ? [problem.details] : [])] : []),
    ...(duplicates ? ["Review duplicate versions in Mods."] : []),
    ...issues.filter(issue => !isModAdvisory(issue) && !isModDuplicateIssue(issue)).map(issue => issue.message),
    ...(entry?.report?.dependencyIssues ?? []),
  ])];
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false); setPinned(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  if (!reasons.length && !canRetry) return null;
  return <div ref={root} className="mod-issues-trigger-wrap" onPointerEnter={() => setOpen(true)}
    onPointerLeave={() => { if (!pinned && !root.current?.contains(document.activeElement)) setOpen(false); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setPinned(false); } }}
    onKeyDown={event => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      trigger.current?.focus();
      setOpen(false); setPinned(false);
    }}>
    <button ref={trigger} type="button" className="mod-issues-trigger" aria-label="Mod issues" aria-controls={panel}
      aria-expanded={open} onFocus={() => setOpen(true)}
      onClick={() => { setOpen(!pinned); setPinned(!pinned); }}>
      <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
        <path fill="currentColor" d="M9.55 3.55a2.8 2.8 0 0 1 4.9 0l8.17 14.52a2.6 2.6 0 0 1-2.27 3.88H3.65a2.6 2.6 0 0 1-2.27-3.88Z"/>
        <path d="M12 8v5" stroke="#111" strokeWidth="2.35" strokeLinecap="round"/>
        <circle cx="12" cy="16.75" r="1.2" fill="#111"/>
      </svg>
    </button>
    {open && <div id={panel} className="mod-issues-popover" role="group" aria-label="Mod issues">
      <ul>{(reasons.length ? reasons : ["The mods check is incomplete."]).map(reason => <li key={reason}>{reason}</li>)}</ul>
      {canRetry && <button type="button" className="settings-action" onClick={retry} disabled={entry?.checking}>
        <RotateCw size={14} />{entry?.checking ? "Checking\u2026" : "Check again"}
      </button>}
    </div>}
  </div>;
}
