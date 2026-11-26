import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "./invoke";
import type { WorkspaceChange } from "./workspace-release-changes";

export type FollowUpdate = {
  installedRevision: number;
  latestRevision: number;
  required: boolean;
  minimumPlayableRevision: number;
  releaseNote: string;
  creator: string;
  playerUrl: string;
  reviewToken: string;
  offline?: boolean;
  repairNeeded?: boolean;
  repairReason?: string | null;
  minecraftVersionChanged?: boolean;
  worldBackupDirectory?: string | null;
  changes: WorkspaceChange[];
};

export type FollowRepair = {repairedFiles: number; backupDirectory: string | null};

export function hasUpdate(review?: FollowUpdate | null): boolean {
  return !!review && review.latestRevision > review.installedRevision;
}

export function useFollowUpdateChecks(instances: {id: string}[], backgroundChecks = true,
  onObserved?: (id: string, review: FollowUpdate | null) => void) {
  const [reviews, setReviews] = useState<Record<string, FollowUpdate | null>>({});
  const requests = useRef(new Map<string, Promise<FollowUpdate | null>>());
  const latestObserver = useRef(onObserved);
  latestObserver.current = onObserved;
  const ids = JSON.stringify(instances.map(instance => instance.id));

  const check = useCallback((id: string) => {
    const pending = requests.current.get(id);
    if (pending) return pending;
    const request = invoke<FollowUpdate | null>("check_followed_pack_update", {instanceId: id}).then(review => {
      if (requests.current.get(id) === request) {
        setReviews(previous => previous[id] === review ? previous : {...previous, [id]: review});
        latestObserver.current?.(id, review);
      }
      return review;
    }).finally(() => {
      if (requests.current.get(id) === request) requests.current.delete(id);
    });
    requests.current.set(id, request);
    return request;
  }, []);
  const invalidate = useCallback((id: string) => {
    requests.current.delete(id);
    setReviews(previous => {
      const next = {...previous};
      delete next[id];
      return next;
    });
  }, []);
  useEffect(() => {
    if (!backgroundChecks) return;
    const instanceIds: string[] = JSON.parse(ids);
    const independent = new Set<string>();
    let active = true;
    let running = false;
    const poll = async () => {
      if (document.hidden || running) return;
      running = true;
      try {
        for (const id of instanceIds) {
          if (!active) break;
          if (independent.has(id)) continue;
          try {
            if (await check(id) === null) independent.add(id);
          } catch { /* An explicit check in Releases offers retry. */ }
        }
      } finally { running = false; }
    };
    // The startup and manual Mods sweeps check once; the release poll keeps that result current.
    const interval = window.setInterval(() => void poll(), 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [backgroundChecks, check, ids]);
  return {reviews, check, invalidate};
}

export type FollowUpdateActions = {
  reviews: Record<string, FollowUpdate | null>;
  check: (id: string) => Promise<FollowUpdate | null>;
  busy: boolean;
  playRequested: (id: string) => boolean;
  apply: (id: string, review: FollowUpdate, stillHere: () => boolean) => Promise<void>;
  repair: (id: string, review: FollowUpdate) => Promise<FollowRepair>;
  playInstalled: (id: string) => void;
};
export const FollowUpdateContext = createContext<FollowUpdateActions | null>(null);
