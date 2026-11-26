import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, PackagePlus } from "lucide-react";
import { PackContentsReview, type ReleaseDraft } from "./PackContentsReview";
import type { PackPublication } from "./PackPublication";
import { WorkspaceFrame, type WorkspaceInstance, type WorkspacePage } from "./PackWorkspace";
import { FollowedPackReleases } from "./FollowedPackReleases";
import { WorkspaceReleaseHistory } from "./WorkspaceReleaseHistory";
import { WorkspaceAccess, type AccessSelectControl } from "./WorkspaceAccess";
import { WorkspaceDrafts } from "./WorkspaceDrafts";
import type { DraftSummary } from "../services/workspace-drafts";
import type { useWorkspaceSharing } from "../services/workspace-sharing";

export function SharedPackOverview({ instance, page, sharing, onNavigate, SelectControl, onOpenLatest }: {
  instance: WorkspaceInstance;
  page: WorkspacePage;
  sharing: ReturnType<typeof useWorkspaceSharing>;
  onNavigate: (page: WorkspacePage) => void;
  SelectControl: AccessSelectControl;
  onOpenLatest: (playerUrl: string, revision: number) => Promise<void>;
}) {
  const { channel, failed, error, retry } = sharing;
  const [contentsBack, setContentsBack] = useState<(() => void) | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [newlyPublished, setNewlyPublished] = useState(false);
  const [carriedDraft, setCarriedDraft] = useState<ReleaseDraft>();
  const [selectedDraft, setSelectedDraft] = useState<string>();
  const [editedDraft, setEditedDraft] = useState<DraftSummary>();
  const [draftActionHost, setDraftActionHost] = useState<HTMLDivElement | null>(null);
  const [releaseActionHost, setReleaseActionHost] = useState<HTMLDivElement | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "manual">("idle");
  const copyButton = useRef<HTMLButtonElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const returnToCreate = useRef(false);
  const registerContentsBack = useCallback((back: (() => void) | null) => {
    setContentsBack(() => back);
    if (!back) setPublishing(false);
  }, []);

  useLayoutEffect(() => {
    if (page !== "changes") {
      setPublishing(false);
      setCarriedDraft(undefined);
      setEditedDraft(undefined);
    }
    if (page === "overview" && returnToCreate.current) {
      createButton.current?.focus();
      returnToCreate.current = false;
    }
  }, [page]);
  useLayoutEffect(() => { if (newlyPublished) copyButton.current?.focus(); }, [newlyPublished]);
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  if (page === "access" && channel?.publication && !channel.collaborator && !failed) {
    return <WorkspaceAccess instance={instance} SelectControl={SelectControl} />;
  }

  const followed = channel?.followed;
  const creatorPublication = channel?.publication;
  const canRestore = !!creatorPublication && !channel?.collaborator;
  const published = (result: PackPublication) => {
    sharing.published(result);
    setNewlyPublished(result.revision === 1);
    onNavigate(result.revision === 1 ? "overview" : "releases");
  };
  if ((page === "drafts" || page === "review") && creatorPublication && !failed) {
    return <WorkspaceDrafts instance={instance} playerUrl={creatorPublication.playerUrl} owner={!channel?.collaborator}
      selectedDraft={selectedDraft} onSelect={setSelectedDraft} onPublished={sharing.published} onOpenLatest={onOpenLatest}
      onEdit={draft => { setEditedDraft(draft); onNavigate("changes"); }} />;
  }

  const publication = followed ?? creatorPublication;
  const copyLink = async () => {
    if (!publication) return;
    try {
      await navigator.clipboard.writeText(publication.playerUrl);
      setCopyStatus("copied");
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setCopyStatus("manual");
    }
  };
  const overviewAction = publication ? (
    <button ref={copyButton} type="button" className="instance-play ceramic-action pack-workspace-action" onClick={() => void copyLink()}>
      <Copy size={16} aria-hidden="true" />{copyStatus === "copied" ? "Link copied" : "Copy player link"}
    </button>
  ) : channel === null && (
    <button ref={createButton} type="button" className="instance-play ceramic-action pack-workspace-action" onClick={() => onNavigate("changes")}>
      <PackagePlus size={17} aria-hidden="true" />Create shared pack
    </button>
  );
  const action = page === "overview" ? overviewAction : page === "changes" && (contentsBack || channel === null) ? (
    <button type="button" className="instance-play ceramic-action pack-workspace-action" disabled={publishing}
      onClick={() => {
        if (contentsBack) contentsBack();
        else { returnToCreate.current = true; onNavigate("overview"); }
      }}>
      <ArrowLeft size={17} aria-hidden="true" />{contentsBack ? "Back to contents" : "Back to overview"}
    </button>
  ) : null;

  return <WorkspaceFrame instance={instance} label={`Pack Workspace ${page}`} page={page} action={action}
    actionHost={page === "changes" && channel?.collaborator ? setDraftActionHost
      : page === "releases" && canRestore ? setReleaseActionHost : undefined}>
    {failed ? <div className="pack-workspace-status">
      <p role="alert">{error?.includes("access to this pack was removed") || error?.includes("linked to this working copy")
        ? error : "Couldn't check whether this instance is shared."}</p>
      <button type="button" className="secondary-action" onClick={() => retry()}>Retry</button>
    </div> : channel === undefined ? <p role="status" className="pack-workspace-status">Checking sharing status…</p>
      : page === "releases" ? followed ? <FollowedPackReleases instance={instance} /> : <WorkspaceReleaseHistory instanceId={instance.id}
          restore={canRestore ? {playerUrl:creatorPublication.playerUrl, actionHost:releaseActionHost, onRestored:sharing.published} : undefined} />
      : page === "changes" ? <PackContentsReview key={`${creatorPublication?.revision ?? 0}:${editedDraft?.id ?? ""}`}
          instanceId={instance.id} loader={instance.loader}
          setContentsBack={registerContentsBack}
          basePublication={creatorPublication} carriedDraft={carriedDraft}
          onRefreshHead={draft => { setCarriedDraft(draft); retry(true); }} onBusy={setPublishing}
          editor={channel?.collaborator && {
            ...channel.collaborator,
            existing: editedDraft,
            actionHost: draftActionHost,
            onSaved: draft => { setSelectedDraft(draft.id); onNavigate("drafts"); },
            onOpenLatest,
          }}
          onPublished={published} />
      : publication ? <section className="pack-published" aria-label={followed ? "Following shared pack" : "Published release"}>
        <h2>{followed ? "Following shared pack" : "Published release"}</h2>
        <p role="status">{followed ? `Version ${followed.revision} · Shared by ${followed.creator}` : newlyPublished ? "Version " + publication.revision + " published." : "Version " + publication.revision}</p>
        {publication.releaseNote && <p className="pack-published-note">{publication.releaseNote}</p>}
        <label>Player link<input ref={linkInput} readOnly value={publication.playerUrl} onFocus={event => event.currentTarget.select()} /></label>
        {copyStatus !== "idle" && <p role="status" className={copyStatus === "copied" ? "pack-copy-announcement" : undefined}>
          {copyStatus === "copied" ? "Player link copied." : "Select Copy from the link’s context menu."}</p>}
      </section>
      : channel ? <p className="pack-workspace-status">Shared pack · Version {channel.revision}</p>
      : <p className="pack-workspace-status">Share the files in this instance with a player link.</p>}
  </WorkspaceFrame>;
}
