import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ContentCategory, InstanceContentItem } from "../components/InstalledContentRow";
import { invoke } from "./invoke";
import { userError } from "./user-error";

type InstanceContentSource = { id: string; directory: string };
type Snapshot = { items?: InstanceContentItem[]; error?: string; checkedAt?: number };

const recheckAfterMs = 60_000;
const empty: Snapshot = {};
const noItems: InstanceContentItem[] = [];
const snapshots = new Map<string, Snapshot>();
const requests = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

const keyFor = (instance: InstanceContentSource, category: ContentCategory) =>
  JSON.stringify([instance.id, instance.directory, category]);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(key: string, snapshot: Snapshot) {
  snapshots.set(key, snapshot);
  for (const listener of listeners) listener();
}

export function refreshInstalledContent(instance: InstanceContentSource, category: ContentCategory, force = false): Promise<void> {
  const key = keyFor(instance, category);
  const previous = snapshots.get(key);
  const pending = requests.get(key);
  if (!force) {
    if (pending) return pending;
    if (previous?.checkedAt && Date.now() - previous.checkedAt < recheckAfterMs) return Promise.resolve();
  }

  const args = { instanceId: instance.id, category };
  const request = invoke<InstanceContentItem[]>("list_instance_content", args).then(items => {
    if (requests.get(key) === request) publish(key, { items, checkedAt: Date.now() });
  }, error => {
    if (requests.get(key) === request) {
      publish(key, { ...snapshots.get(key), error: userError(error) });
    }
  }).finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
  requests.set(key, request);
  if (previous?.error) publish(key, { ...previous, error: undefined });

  if (!force && !previous?.items) {
    void invoke<InstanceContentItem[] | null>("get_cached_instance_content", args).then(cached => {
      if (cached?.length && requests.get(key) === request && !snapshots.get(key)?.items) {
        publish(key, { items: cached });
      }
    }).catch(() => { /* A fresh inventory can still load when the disk cache is unavailable. */ });
  }
  return request;
}

export function pruneInstalledContent(instances: InstanceContentSource[]) {
  const valid = new Set(instances.flatMap(instance => (["mods", "resourcepacks", "shaderpacks"] as const)
    .map(category => keyFor(instance, category))));
  for (const key of snapshots.keys()) if (!valid.has(key)) snapshots.delete(key);
  for (const key of requests.keys()) if (!valid.has(key)) requests.delete(key);
}

export function clearInstalledContent() {
  snapshots.clear();
  requests.clear();
  for (const listener of listeners) listener();
}

export function useInstalledContent({ id, directory }: InstanceContentSource, category: ContentCategory | null) {
  const key = category ? keyFor({ id, directory }, category) : "";
  const getSnapshot = useCallback(() => snapshots.get(key) ?? empty, [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const refresh = useCallback((force = false) => category
    ? refreshInstalledContent({ id, directory }, category, force) : Promise.resolve(), [category, id, directory]);
  useEffect(() => {
    if (!category) return;
    void refresh();
    const onFocus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [category, refresh]);

  return { items: snapshot.items ?? noItems, ready: !category || Boolean(snapshot.items || snapshot.error), hasInventory: Boolean(snapshot.items),
    error: snapshot.error ?? "", refresh };
}
