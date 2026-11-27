import { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon as ArrowLeft, ArrowsClockwiseIcon as RefreshCw } from "@phosphor-icons/react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import type { PackCompatibility } from "../services/pack-compatibility";
import { workspaceReleaseChanges, type ReleaseManifest } from "../services/workspace-release-changes";
import { PackChangeList } from "./PackChangeList";
import { PackLocalExclusions, PackPublicationForm, type PackPublication } from "./PackPublication";
import { PackDraftSave } from "./PackDraftSave";
import type { DraftEditing } from "../services/workspace-drafts";

export function PackRevisionReview({ base, report, note, required, onNote, onRequired, onBusy, onPublished, onRecheck, onReviewContents, onRefreshHead, editor }: {
  base: PackPublication; report: PackCompatibility; note: string; required: boolean;
  onNote: (note: string) => void; onRequired: (required: boolean) => void; onBusy: (busy: boolean) => void;
  onPublished: (publication: PackPublication) => void; onRecheck: () => void; onRefreshHead: () => void;
  onReviewContents?: () => void;
  editor?: DraftEditing;
}) {
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [savingDraft, setSavingDraft] = useState(false);
  const [openingCopy, setOpeningCopy] = useState(false);
  const [copyError, setCopyError] = useState("");
  const baseRevision = editor?.workingBaseRevision ?? base.revision;
  const stale = baseRevision < base.revision;
  useEffect(() => {
    let current = true;
    setManifest(null); setError("");
    void invoke<{manifest: ReleaseManifest}>("get_workspace_release", { playerUrl: base.playerUrl, revision: baseRevision }).then(
      release => { if (current) setManifest(release.manifest); },
      reason => { if (current) setError(userError(reason)); },
    );
    return () => { current = false; };
  }, [base.playerUrl, baseRevision, attempt]);
  const changes = useMemo(() => manifest && workspaceReleaseChanges(manifest, report, !!editor), [manifest, report, !!editor]);
  const openLatest = async () => {
    if (!editor || openingCopy) return;
    setOpeningCopy(true);
    setCopyError("");
    try { await editor.onOpenLatest(base.playerUrl, base.revision); }
    catch (reason) { setCopyError(userError(reason)); }
    finally { setOpeningCopy(false); }
  };
  return <section className="pack-revision-review" aria-label="Release changes">
    <div className="pack-check-line">
      <span className="pack-revision-base">Since version {baseRevision}</span>
      <div className="pack-check-actions">
        {onReviewContents && <button type="button" className="settings-action" disabled={busy || savingDraft || openingCopy}
          onClick={onReviewContents}><ArrowLeft size={14} aria-hidden="true" />Back to contents</button>}
        <button type="button" className="settings-action" disabled={busy || savingDraft || openingCopy} onClick={onRecheck}>
          <RefreshCw size={14} aria-hidden="true"/>Check again</button>
      </div>
    </div>
    {stale && <div className="pack-check-line">
      <p>Version {base.revision} is available. A draft from this copy can still be saved.</p>
      <button type="button" className="settings-action" disabled={savingDraft || openingCopy}
        onClick={() => void openLatest()}>{openingCopy ? "Preparing working copy…" : "Open latest working copy"}</button>
    </div>}
    {copyError && <p role="alert" className="pack-publication-error">{copyError}</p>}
    {error ? <div className="pack-publication-error"><p role="alert">{error}</p>
      <button type="button" className="settings-action" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
      : !changes ? <p role="status">Comparing the release…</p>
      : <>
        <PackLocalExclusions report={report} />
        {changes.length ? <PackChangeList changes={changes} label="Unpublished changes" /> : <p>No content changes.</p>}
        {editor && <PackDraftSave editor={editor} report={report} baseRevision={baseRevision} note={note} onNote={onNote}
          disabled={busy || openingCopy || (!editor.existing && !changes.length && !note.trim())}
          onBusy={value => { setSavingDraft(value); onBusy(value); }} />}
        {(!editor || (editor.canPublish && !stale)) && <PackPublicationForm report={report} note={note} onNote={onNote}
          showNote={!editor} disabled={savingDraft}
          revision={{base: baseRevision, hasChanges: changes.length > 0, required, onRequired, refreshHead: onRefreshHead}}
          onBusy={value => { setBusy(value); onBusy(value); }} onPublished={onPublished} onRecheck={onRecheck} />}
      </>}
  </section>;
}
