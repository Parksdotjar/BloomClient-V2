import { useEffect, useState } from "react";
import { invoke } from "./invoke";
import type { PackPublication } from "../components/PackPublication";
import type { WorkspacePage } from "../components/PackWorkspace";

type FollowedPack = { playerUrl: string; revision: number; creator: string; releaseNote?: string };
type Collaboration = {canPublish: boolean; workingBaseRevision: number};
type Channel = { revision: number; publication?: PackPublication; followed?: FollowedPack; collaborator?: Collaboration };
type Loaded = { id: string; channel?: Channel | null; error?: string };

export function useWorkspaceSharing(instanceId?: string) {
  const [loaded, setLoaded] = useState<Loaded>();
  const [attempt, setAttempt] = useState({ instanceId: "", count: 0, refresh: false });
  useEffect(() => {
    if (!instanceId) { setLoaded(undefined); return; }
    let current = true;
    setLoaded({ id: instanceId });
    const lookup = async (): Promise<Channel | null> => {
      const followed = await invoke<FollowedPack | null>("get_followed_pack", { instanceId });
      if (followed) return { revision: followed.revision, followed };
      const collaboration = await invoke<({publication: PackPublication} & Collaboration) | null>("get_workspace_collaboration", {instanceId});
      if (collaboration) {
        const {publication, ...permissions} = collaboration;
        return {revision:publication.revision, publication, collaborator:permissions};
      }
      const refresh = attempt.instanceId === instanceId && attempt.refresh;
      const publication = await invoke<PackPublication | null>("get_workspace_publication", { instanceId, refresh });
      if (publication) return { revision: publication.revision, publication };
      return invoke<{ revision: number } | null>("get_pack_channel_state", { instanceId });
    };
    void lookup().then(
      channel => { if (current) setLoaded({id:instanceId, channel}); },
      reason => { if (current) setLoaded({ id: instanceId, error: String(reason) }); },
    );
    return () => { current = false; };
  }, [instanceId, attempt]);
  useEffect(() => {
    if (!instanceId) return;
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{instanceId: string}>).detail?.instanceId === instanceId) {
        setAttempt(previous => ({ instanceId, count: previous.count + 1, refresh: false }));
      }
    };
    window.addEventListener("workspace-follow-updated", refresh);
    window.addEventListener("workspace-publication-updated", refresh);
    return () => {
      window.removeEventListener("workspace-follow-updated", refresh);
      window.removeEventListener("workspace-publication-updated", refresh);
    };
  }, [instanceId]);

  const result = loaded?.id === instanceId ? loaded : undefined;
  const channel = result?.channel;
  const destinations: WorkspacePage[] = ["overview"];
  if (channel === null || channel?.publication) destinations.push("changes");
  if (channel?.publication) destinations.push(channel.collaborator ? "drafts" : "review");
  if (channel?.publication || channel?.followed) destinations.push("releases");
  if (channel?.publication && !channel.collaborator) destinations.push("access");
  return {
    channel, failed: !!result?.error, error: result?.error, destinations,
    retry: (refresh?: boolean) => {
      if (instanceId) setAttempt(previous => ({
        instanceId, count: previous.count + 1, refresh: refresh ?? (previous.instanceId === instanceId && previous.refresh),
      }));
    },
    published: (publication: PackPublication) => {
      if (instanceId) setLoaded({ id: instanceId, channel: { revision: publication.revision, publication, collaborator:channel?.collaborator } });
    },
  };
}
