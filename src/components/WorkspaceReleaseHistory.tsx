import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { invoke as invokeNative } from "@tauri-apps/api/core";
import { ArrowCounterClockwiseIcon as RotateCcw } from "@phosphor-icons/react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import { connectDelightAccount, socialDirectoryChanged } from "../services/connect-delight-account";
import { workspaceManifestChanges, type ReleaseManifest } from "../services/workspace-release-changes";
import { PackChangeList } from "./PackChangeList";
import { PackPublicationTerms, PackReleaseNote, PackReleasePolicy, type PackPublication, type PackPublisher } from "./PackPublication";

type ReleaseSummary = {
  revision: number;
  releaseNote: string;
  creator: string;
  createdAt: string;
  required: boolean;
};

type ReleaseRestore = {
  playerUrl: string;
  actionHost: HTMLDivElement | null;
  onRestored: (publication: PackPublication) => void;
};

type ReleaseDetails = ReleaseSummary & {manifest: ReleaseManifest};

export function WorkspaceReleaseHistory({ instanceId, restore }: { instanceId: string; restore?: ReleaseRestore }) {
  const [releases, setReleases] = useState<ReleaseSummary[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState<number>();
  const [restored, setRestored] = useState<number>();
  const returnToSource = useRef<number>(undefined);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const announcement = useRef<HTMLParagraphElement>(null);
  const latest = releases?.reduce((revision, release) => Math.max(revision, release.revision), 0);
  useEffect(() => {
    let current = true;
    setError("");
    setReleases(null);
    void invoke<ReleaseSummary[]>("get_workspace_release_history", { instanceId }).then(
      result => { if (current) setReleases(result); },
      reason => { if (current) setError(userError(reason)); },
    );
    return () => { current = false; };
  }, [instanceId, attempt]);
  useEffect(() => { if (source === undefined && restored === undefined) selectedButton.current?.focus(); }, [source, restored]);
  useEffect(() => { if (restored !== undefined) announcement.current?.focus(); }, [restored]);

  if (restore && source !== undefined) {
    return <RestoreReleaseReview key={source} instanceId={instanceId} source={source} restore={restore}
      onCancel={() => setSource(undefined)} onPublished={publication => {
        setSource(undefined);
        setRestored(publication.revision);
        setAttempt(value => value + 1);
        restore.onRestored(publication);
      }} />;
  }
  return <section className="pack-release-history" aria-label="Release history">
    {restored !== undefined && <p ref={announcement} tabIndex={-1} role="status">Version {restored} published.</p>}
    {error ? <div className="pack-check-line"><p role="alert">{error}</p>
      <button type="button" className="settings-action" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
      : releases === null ? <p role="status">Loading releases…</p>
      : releases.length === 0 ? <p>No releases yet.</p> : <ol>
        {releases.map(release => <li key={release.revision}>
          <div className="pack-history-heading">
            <div className="pack-history-line"><strong>Version {release.revision}</strong>
              {release.revision > 1 && <span>{release.required ? "Required" : "Optional"}</span>}
            </div>
            {restore && latest !== undefined && release.revision < latest &&
              <button ref={returnToSource.current === release.revision ? selectedButton : undefined} type="button"
                className="settings-action" aria-label={`Restore version ${release.revision}`}
                onClick={() => { returnToSource.current = release.revision; setRestored(undefined); setSource(release.revision); }}>
                Restore…
              </button>}
          </div>
          <p className="pack-history-meta">{release.creator} · <time dateTime={release.createdAt}>
            {new Date(release.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </time></p>
          {release.releaseNote && <p className="pack-history-note">{release.releaseNote}</p>}
        </li>)}
      </ol>}
  </section>;
}

function RestoreReleaseReview({instanceId, source, restore, onCancel, onPublished}: {
  instanceId: string;
  source: number;
  restore: ReleaseRestore;
  onCancel: () => void;
  onPublished: (publication: PackPublication) => void;
}) {
  const formId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const session = useRef<AbortController>(null);
  const submission = useRef<{key: string; id: string}>(null);
  const publishing = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [comparison, setComparison] = useState<{source: ReleaseDetails; latest: ReleaseDetails}>();
  const [publisher, setPublisher] = useState<PackPublisher | null>();
  const [error, setError] = useState<{message: string; refresh?: boolean}>();
  const [required, setRequired] = useState(false);
  const [note, setNote] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const {playerUrl, actionHost} = restore;

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const refresh = () => {
      setConnecting(false);
      setAttempt(value => value + 1);
    };
    window.addEventListener(socialDirectoryChanged, refresh);
    return () => window.removeEventListener(socialDirectoryChanged, refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    setComparison(undefined);
    setPublisher(undefined);
    setError(undefined);
    setAccepted(false);
    void Promise.all([
      invoke<ReleaseDetails>("get_workspace_release", {playerUrl, revision: source}),
      invoke<ReleaseDetails>("get_workspace_release", {playerUrl}),
      invoke<PackPublisher | null>("get_pack_publisher", {instanceId}),
    ]).then(([snapshot, latest, account]) => {
      if (controller.signal.aborted) return;
      if (snapshot.revision >= latest.revision) {
        setError({message:"Choose an earlier release to restore."});
        return;
      }
      setComparison({source: snapshot, latest});
      setPublisher(account);
    }, reason => {
      if (!controller.signal.aborted) setError({message:userError(reason), refresh:true});
    });
    return () => controller.abort();
  }, [instanceId, playerUrl, source, attempt]);

  const canRestore = !!publisher && publisher.canRequire !== false && publisher.canPublish !== false;
  const consent = !!publisher?.termsAccepted || accepted;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!comparison || !publisher || !canRestore || !consent || publishing.current || error?.refresh || (required && !note.trim())) return;
    const signal = session.current?.signal;
    const payload = {instanceId, sourceRevision: source, baseRevision: comparison.latest.revision, releaseNote: note.trim(), required};
    const key = JSON.stringify([publisher.id, payload]);
    if (submission.current?.key !== key) submission.current = {key, id: crypto.randomUUID()};
    publishing.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const publication = await invokeNative<PackPublication>("restore_workspace_release", {
        ...payload, requestId: submission.current.id, acceptedTerms: consent,
      });
      if (signal?.aborted) {
        window.dispatchEvent(new CustomEvent("workspace-publication-updated", {detail:{instanceId}}));
      } else onPublished(publication);
    } catch (reason) {
      if (signal?.aborted) return;
      const details = typeof reason === "object" && reason !== null && "code" in reason && "message" in reason ? reason : null;
      setError({message: userError(details?.message ?? reason), refresh: details?.code === "stale_base" || details?.code === "stale_review"});
      if (details?.code === "signed_out") setPublisher(null);
    } finally {
      publishing.current = false;
      if (!session.current?.signal.aborted) setBusy(false);
    }
  };
  const connect = async () => {
    const signal = session.current?.signal;
    setConnecting(true);
    setError(undefined);
    try { await connectDelightAccount(signal); }
    catch (reason) {
      if (!signal?.aborted) setError({message:userError(reason)});
    } finally {
      if (!signal?.aborted) setConnecting(false);
    }
  };
  const changes = comparison ? workspaceManifestChanges(comparison.latest.manifest, comparison.source.manifest) : [];
  return <section className="pack-revision-review" aria-label="Restore release">
    <div className="pack-history-heading">
      <h2 ref={heading} tabIndex={-1}>Restore release</h2>
      <button type="button" className="settings-action" disabled={busy} onClick={onCancel}>Back to releases</button>
    </div>
    {error && <div className="pack-publication-error">
      <span role="alert">{error.message}</span>
      {error.refresh && <button type="button" className="settings-action" onClick={() => setAttempt(value => value + 1)}>Refresh review</button>}
    </div>}
    {!comparison ? !error && <p role="status">Loading release comparison…</p> : <>
      <p className="pack-revision-base">Restore version {source} as version {comparison.latest.revision + 1}</p>
      {changes.length ? <PackChangeList changes={changes} label="Changes in the restore" /> : <p>The pack files and settings are already the same.</p>}
      {!publisher ? <button type="button" className="settings-action" disabled={connecting}
        onClick={() => void connect()}>{connecting ? "Waiting for approval…" : "Connect account"}</button>
        : !canRestore ? <p>Only the pack owner can restore a release.</p> : <>
          <form id={formId} className="pack-publication" onSubmit={submit}>
            <PackReleasePolicy required={required} onRequired={setRequired} disabled={busy} />
            <PackReleaseNote note={note} onNote={setNote} required={required} disabled={busy} />
            {!publisher.termsAccepted && <PackPublicationTerms accepted={accepted} onAccepted={setAccepted} disabled={busy}
              onError={reason => setError({message:userError(reason)})} />}
          </form>
          {actionHost && createPortal(<button type="submit" form={formId} className="instance-play ceramic-action pack-workspace-action"
            disabled={busy || !consent || !!error?.refresh || (required && !note.trim())}>
            <RotateCcw size={16} aria-hidden="true" />{busy ? "Publishing…" : "Restore as new release"}
          </button>, actionHost)}
        </>}
    </>}
  </section>;
}
