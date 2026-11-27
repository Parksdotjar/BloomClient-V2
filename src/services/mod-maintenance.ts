import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "./invoke";
import type { FollowUpdate } from "./follow-updates";
import { userError } from "./user-error";

export type ModDuplicate = { modId: string; name: string; candidates: { fileName: string; sha512: string }[] };
export type ModDuplicateReport = { conflicts: ModDuplicate[]; archived: number; restorableFiles?: string[] };
export type ModMaintenanceIssue = {
  fileName: string | null;
  message: string;
  kind?: "installed" | "duplicate" | "update" | "catalog";
};

export const isModAdvisory = (issue: ModMaintenanceIssue) => issue.kind === "update" || issue.kind === "catalog";
export const isModDuplicateIssue = (issue: ModMaintenanceIssue) =>
  issue.kind === "duplicate" || (issue.kind === undefined && issue.message.startsWith("Multiple enabled files provide"));

export type ModMaintenanceReport = {
  updates: { fileName: string; title: string; fromVersion: string; toVersion: string }[];
  repairsAvailable: boolean;
  dependencyIssues: string[];
  issues: ModMaintenanceIssue[];
  complete: boolean;
};

export type ModMaintenanceEntry = {
  checking?: boolean;
  report?: ModMaintenanceReport;
  scanError?: string;
  applyError?: string;
  revision?: number;
};

export function hasCompatibleModUpdates(report?: ModMaintenanceReport) {
  return Boolean(report?.updates.length || report?.repairsAvailable);
}

export function modMaintenanceNeedsAttention(entry?: ModMaintenanceEntry) {
  const report = entry?.report;
  return Boolean(entry?.scanError || entry?.applyError || (report &&
    (!report.complete || report.issues.some(issue => !isModAdvisory(issue)) || report.repairsAvailable || report.dependencyIssues.length)));
}

type InstanceRuntime = { version: string; loader: string; loaderVersion?: string | null };

export function runtimeKey(instance: InstanceRuntime) {
  return JSON.stringify([instance.version, instance.loader.toLowerCase(), instance.loaderVersion?.trim() || null]);
}

export function useModMaintenance(
  instances: (InstanceRuntime & { id: string })[],
  libraryReady: boolean,
  checkAtStartup: boolean,
  checkFollowedPack: (id: string) => Promise<FollowUpdate | null>,
  writesBlocked: boolean,
  onApplied: (instanceId: string) => void,
) {
  const [entries, setEntries] = useState<Record<string, ModMaintenanceEntry>>({});
  const [sweeping, setSweeping] = useState(false);
  const [lastCheck, setLastCheck] = useState<{ at: number; complete: boolean }>();
  const [active, setActive] = useState<string>();
  const [queued, setQueued] = useState<string[]>([]);
  const writing = useRef<string | undefined>(undefined);
  const sweep = useRef<Promise<void> | undefined>(undefined);
  const startupAccountedFor = useRef(false);
  // Checking a populated library should share one queue with retries and inventory refreshes.
  const scanQueue = useRef(Promise.resolve());
  const scanRequests = useRef(new Map<string, Promise<ModMaintenanceReport | undefined>>());
  const scanning = useRef(new Set<string>());
  const previousRuntimes = useRef(new Map<string, string>());
  const staleResults = useRef(new Set<string>());
  const offlineInstances = useRef(new Set<string>());
  const callbacks = useRef({ onApplied, checkFollowedPack });
  callbacks.current = { onApplied, checkFollowedPack };

  const check = useCallback(function scan(id: string, fresh = false): Promise<ModMaintenanceReport | undefined> {
    const pending = scanRequests.current.get(id);
    if (pending) {
      if (fresh && scanning.current.has(id)) staleResults.current.add(id);
      return pending.then(result => staleResults.current.delete(id) ? scan(id) : (scanRequests.current.get(id) ?? result));
    }
    setEntries(previous => ({ ...previous, [id]: { ...previous[id], checking: true } }));
    const request = scanQueue.current.then(async () => {
      if (!navigator.onLine) {
        offlineInstances.current.add(id);
        throw new Error("You’re offline. Check again when connected.");
      }
      offlineInstances.current.delete(id);
      scanning.current.add(id);
      return invoke<ModMaintenanceReport>("check_mod_maintenance", { instanceId: id });
    }).then(report => {
      if (!staleResults.current.has(id)) {
        setEntries(previous => ({ ...previous, [id]: { ...previous[id], checking: false, report, scanError: undefined } }));
      }
      return report;
    }, reason => {
      if (!staleResults.current.has(id)) {
        setEntries(previous => ({ ...previous, [id]: { ...previous[id], checking: false, report: undefined, scanError: userError(reason) } }));
      }
      return undefined;
    }).finally(() => {
      scanning.current.delete(id);
      scanRequests.current.delete(id);
    });
    scanRequests.current.set(id, request);
    scanQueue.current = request.then(() => {});
    return request;
  }, []);

  useEffect(() => {
    if (!libraryReady) return;
    const next = new Map<string, string>();
    for (const instance of instances) {
      const key = runtimeKey(instance);
      next.set(instance.id, key);
      const previous = previousRuntimes.current.get(instance.id);
      if (previous !== undefined && previous !== key) {
        setEntries(entries => ({ ...entries, [instance.id]: { revision: entries[instance.id]?.revision, checking: true } }));
        void check(instance.id, true);
      }
    }
    previousRuntimes.current = next;
  }, [instances, libraryReady, check]);

  const checkAll = useCallback((ids: string[]) => {
    if (sweep.current) return sweep.current;
    setSweeping(true);
    const request = (async () => {
      let complete = true;
      for (const id of ids) {
        const report = await check(id);
        if (!report?.complete) complete = false;
        if (!navigator.onLine) continue;
        try {
          const follow = await callbacks.current.checkFollowedPack(id);
          if (follow?.offline) complete = false;
        } catch { complete = false; }
      }
      setLastCheck({ at: Date.now(), complete });
    })().finally(() => {
      sweep.current = undefined;
      setSweeping(false);
    });
    sweep.current = request;
    return request;
  }, [check]);

  useEffect(() => {
    if (!libraryReady || startupAccountedFor.current) return;
    startupAccountedFor.current = true;
    if (checkAtStartup) void checkAll(instances.map(item => item.id));
  }, [checkAll, checkAtStartup, instances, libraryReady]);

  useEffect(() => {
    const onOnline = async () => {
      await sweep.current;
      const retry = [...offlineInstances.current];
      if (retry.length) void checkAll(retry);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [checkAll]);

  const requestUpdate = useCallback((id: string) => {
    setQueued(current => current.includes(id) || writing.current === id ? current : [...current, id]);
  }, []);

  useEffect(() => {
    const [instanceId] = queued;
    if (!instanceId || writesBlocked || active || writing.current) return;
    writing.current = instanceId;
    setActive(instanceId);
    setQueued(current => current.filter(id => id !== instanceId));
    setEntries(previous => ({ ...previous, [instanceId]: { ...previous[instanceId], applyError: undefined } }));

    void (async () => {
      try {
        const result = await invoke<{ applied: boolean; skipped: ModMaintenanceIssue[] }>("update_instance_mods", { instanceId });
        if (result.applied) {
          setEntries(previous => ({ ...previous, [instanceId]: { ...previous[instanceId], revision: (previous[instanceId]?.revision ?? 0) + 1 } }));
          callbacks.current.onApplied(instanceId);
        }
        const report = await check(instanceId, true);
        if (report && result.skipped.length) {
          const skipped = new Set(result.skipped.map(issue => issue.fileName));
          setEntries(previous => previous[instanceId]?.report !== report ? previous : ({
            ...previous,
            [instanceId]: {
              ...previous[instanceId],
              report: {
                ...report,
                updates: report.updates.filter(update => !skipped.has(update.fileName)),
                issues: [...report.issues, ...result.skipped],
              },
            },
          }));
        }
      } catch (reason) {
        setEntries(previous => ({ ...previous, [instanceId]: { ...previous[instanceId], applyError: userError(reason) } }));
      } finally {
        writing.current = undefined;
        setActive(undefined);
      }
    })();
  }, [active, check, queued, writesBlocked]);

  const recheck = (id: string) => {
    setEntries(previous => ({ ...previous, [id]: { ...previous[id], applyError: undefined } }));
    return check(id);
  };

  return { entries, sweeping, lastCheck, active, queued, check, recheck, checkAll, requestUpdate };
}

export type ModMaintenance = ReturnType<typeof useModMaintenance>;
