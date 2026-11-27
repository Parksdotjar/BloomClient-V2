import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftIcon as ArrowLeft, CaretRightIcon as ChevronRight, FileTextIcon as FilePenLine, GitMergeIcon as GitMerge, ChatIcon as MessageSquare, PackageIcon as PackageCheck, PaperPlaneTiltIcon as Send } from "@phosphor-icons/react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import { socialDirectoryChanged } from "../services/connect-delight-account";
import { workspaceManifestChanges, type ReleaseManifest } from "../services/workspace-release-changes";
import type { DraftAction, DraftDetail, DraftInbox, DraftSummary } from "../services/workspace-drafts";
import type { PackPublication } from "./PackPublication";
import { DraftDiff } from "./DraftDiff";
import { PackTabs } from "./PackContentTabs";
import { WorkspaceFrame, type WorkspaceInstance } from "./PackWorkspace";
import { CatalogArtwork } from "./CatalogFeedRow";
import "./workspace-drafts.css";

const status = {saved: "Saved", submitted: "In review", returned: "Changes requested", published: "Published"};
const reviewTab = {category:"submitted", label:status.submitted, icon:Send, empty:"No submissions yet."} as const;
const publishedTab = {category:"published", label:status.published, icon:PackageCheck, empty:"No published drafts yet."} as const;
const ownerTabs = [reviewTab, publishedTab] as const;
const editorTabs = [
  {category:"saved", label:"Drafts", icon:FilePenLine, empty:"No saved drafts yet."},
  reviewTab,
  {category:"returned", label:status.returned, icon:MessageSquare, empty:"No changes requested."},
  publishedTab,
] as const;
const date = new Intl.DateTimeFormat(undefined, {dateStyle:"medium", timeStyle:"short"});
const draftTitle = (note: string) => note.trim().split(/\r?\n/, 1)[0] || "Pack changes";

function DraftAvatar({author, authorAvatarUrl}: Pick<DraftSummary, "author" | "authorAvatarUrl">) {
  return <span className="workspace-draft-avatar" aria-hidden="true">
    <CatalogArtwork source={authorAvatarUrl} fallback={Array.from(author.trim())[0]?.toUpperCase() || "?"} />
  </span>;
}

export function WorkspaceDrafts({instance, playerUrl, owner, selectedDraft, onSelect, onEdit, onPublished, onOpenLatest}: {
  instance: WorkspaceInstance;
  playerUrl: string;
  owner: boolean;
  selectedDraft?: string;
  onSelect: (id?: string) => void;
  onEdit: (draft: DraftSummary) => void;
  onPublished: (publication: PackPublication) => void;
  onOpenLatest: (playerUrl: string, revision: number) => Promise<void>;
}) {
  const [inbox, setInbox] = useState<DraftInbox>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const id = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  const [actionHost, setActionHost] = useState<HTMLDivElement | null>(null);
  const [category, setCategory] = useState<DraftSummary["state"]>(owner ? "submitted" : "saved");
  const draft = inbox?.drafts.find(item => item.id === selectedDraft);
  useEffect(() => {
    const reset = () => {
      setInbox(undefined);
      setAttempt(value => value + 1);
    };
    window.addEventListener(socialDirectoryChanged, reset);
    return () => window.removeEventListener(socialDirectoryChanged, reset);
  }, []);
  useEffect(() => {
    let active = true;
    setError("");
    void invoke<DraftInbox>("get_workspace_drafts", {instanceId:instance.id}).then(
      result => { if (active) setInbox(result); },
      reason => { if (active) { setInbox(undefined); setError(userError(reason)); } },
    );
    return () => { active = false; };
  }, [instance.id, attempt]);

  const page = owner ? "review" : "drafts";
  const label = owner ? "Review submissions" : "Pack drafts";
  const tabs = owner ? ownerTabs : editorTabs;
  const selectedTab = Math.max(0, tabs.findIndex(tab => tab.category === (draft?.state ?? category)));
  const tab = tabs[selectedTab];
  const rows = inbox?.drafts.filter(item => item.state === tab.category);
  const showList = () => {
    setCategory(tab.category);
    onSelect();
    tabsRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({preventScroll:true});
  };
  return <WorkspaceFrame instance={instance} label={label} page={page} actionHost={draft ? setActionHost : undefined}>
    <PackTabs id={id} panelId={id + "-results"} tabs={tabs} tabsRef={tabsRef} label={owner ? "Review status" : "Draft status"}
      selected={selectedTab} onSelect={index => {
        setCategory(tabs[index].category);
        onSelect();
      }} />
    <div id={id + "-results"} className="workspace-drafts" role="tabpanel" aria-labelledby={id + tab.category} tabIndex={0}>
      {inbox && draft ? <DraftReview key={draft.id} instance={instance} playerUrl={playerUrl}
        owner={inbox.role === "owner"} ownerName={inbox.ownerName || "the pack owner"} draft={draft} head={inbox.headRevision} onBack={showList}
        actionHost={actionHost} onEdit={() => onEdit(draft)} onPublished={onPublished}
        onOpenLatest={() => onOpenLatest(playerUrl, inbox.headRevision)} onChange={updated => {
          if (!updated || (inbox.role === "owner" && updated.state === "returned")) showList();
          setAttempt(value => value + 1);
        }} /> : error ? <div className="pack-check-line"><p role="alert">{error}</p>
        <button type="button" className="settings-action" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
        : !rows ? <p role="status">{owner ? "Loading submissions…" : "Loading drafts…"}</p>
        : !rows.length ? <p>{tab.empty}</p>
        : <ul className="workspace-draft-rows" aria-label={owner && tab.category === "submitted" ? "Submissions" : tab.label}>
          {rows.map(item => <li key={item.id}><button type="button" onClick={() => onSelect(item.id)}>
            <span className="workspace-draft-identity">
              <DraftAvatar author={item.author} authorAvatarUrl={item.authorAvatarUrl} />
              <span className="workspace-draft-copy">
                <strong>{draftTitle(item.note)}</strong>
                <small>By {item.author}</small>
              </span>
            </span>
            <span className="workspace-draft-tail">
              <span className="workspace-draft-copy">
                <small>{item.publishedRevision ? `Version ${item.publishedRevision}` : `Based on version ${item.baseRevision}`}</small>
                <time dateTime={item.updatedAt}>{date.format(new Date(item.updatedAt))}</time>
              </span>
              <ChevronRight size={16} aria-hidden="true" />
            </span>
          </button></li>)}
        </ul>}
    </div>
  </WorkspaceFrame>;
}

function DraftReview({instance, playerUrl, owner, ownerName, draft, head, actionHost, onBack, onEdit, onPublished, onChange, onOpenLatest}: {
  instance: WorkspaceInstance; playerUrl: string; owner: boolean; ownerName: string; draft: DraftSummary; head: number;
  onBack: () => void; onEdit: () => void; onPublished: (publication: PackPublication) => void; onChange: (updated?: DraftSummary) => void;
  onOpenLatest: () => Promise<void>;
  actionHost: HTMLDivElement | null;
}) {
  const formId = useId();
  const back = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const actionPending = useRef(false);
  const [detail, setDetail] = useState<DraftDetail>();
  const [base, setBase] = useState<ReleaseManifest>();
  const [busy, setBusy] = useState(false);
  const [openingCopy, setOpeningCopy] = useState(false);
  const [pending, setPending] = useState(false);
  const [readError, setReadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [returning, setReturning] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [releaseNote, setReleaseNote] = useState(draft.note);
  const [required, setRequired] = useState(false);
  const [terms, setTerms] = useState<boolean>();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const row = detail ?? draft;
  const noteBody = row.note.trim().split(/\r?\n/).slice(1).join("\n").trim();
  const stale = row.baseRevision < head;
  const canEdit = !owner && (row.state === "saved" || row.state === "returned");
  const canReview = owner && row.state === "submitted" && row.canReview !== false;
  const canPublish = !!detail && !!base && canReview && !stale;

  useLayoutEffect(() => { back.current?.focus({preventScroll:true}); }, []);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    setPending(true);
    setReadError("");
    setDetail(undefined);
    setBase(undefined);
    void Promise.all([
      invoke<DraftDetail>("get_workspace_draft", {instanceId:instance.id, draftId:draft.id}),
      owner && draft.state === "submitted" ? invoke<{termsAccepted: boolean} | null>("get_pack_publisher", {instanceId:instance.id}) : null,
    ]).then(async ([result, account]) => {
      const original = await invoke<{manifest: ReleaseManifest}>("get_workspace_release", {playerUrl, revision:result.baseRevision});
      if (!current) return;
      setDetail(result);
      setBase(original.manifest);
      setTerms(account?.termsAccepted);
      setReleaseNote(result.note);
    }).catch(reason => { if (current) setReadError(userError(reason)); })
      .finally(() => { if (current) setPending(false); });
    return () => { current = false; };
  }, [instance.id, playerUrl, draft.id, draft.version, draft.state, owner, attempt]);

  const change = async (action: DraftAction) => {
    if (!detail || actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setActionError("");
    try {
      const args = {instanceId:instance.id, draftId:detail.id, version:detail.version, action};
      if (action === "publish") {
        const publication = await invoke<PackPublication>("change_workspace_draft", {
          ...args, required, releaseNote:releaseNote.trim(), acceptedTerms:terms || acceptedTerms,
        });
        if (active.current) {
          const merged: DraftDetail = {...detail, state:"published", version:detail.version + 1, publishedRevision:publication.revision};
          setDetail(merged);
          onPublished(publication);
          onChange(merged);
        }
      } else {
        const updated = await invoke<DraftDetail>("change_workspace_draft", {...args, note:action === "return" ? feedback.trim() : undefined});
        if (active.current) {
          setReturning(false);
          setDiscarding(false);
          setFeedback("");
          if (action !== "discard") setDetail(updated);
          onChange(action === "discard" ? undefined : updated);
        }
      }
    } catch (reason) {
      if (active.current) setActionError(userError(reason));
    } finally {
      actionPending.current = false;
      if (active.current) setBusy(false);
    }
  };
  const openLatest = async () => {
    setOpeningCopy(true);
    setActionError("");
    try { await onOpenLatest(); }
    catch (reason) { if (active.current) setActionError(userError(reason)); }
    finally { if (active.current) setOpeningCopy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (owner && canPublish && (terms || acceptedTerms) && (!required || !!releaseNote.trim())) void change("publish");
    if (!owner && canEdit && !stale) void change("submit");
  };
  const action = !returning && !discarding && (canPublish || (canEdit && !stale && !!detail)) && (
    <button type="submit" form={formId} className="instance-play ceramic-action pack-workspace-action"
      disabled={busy || pending || (owner && (!(terms || acceptedTerms) || (required && !releaseNote.trim())))}>
      {owner ? <GitMerge size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
      {owner ? "Merge & publish" : "Send to owner"}
    </button>
  );

  return <section className="workspace-draft-detail" aria-label={owner ? "Review submission" : "Saved draft"}>
      {actionHost && action && createPortal(action, actionHost)}
      <button ref={back} type="button" className="settings-action workspace-draft-back" disabled={busy} onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />{owner ? "Back to review" : "Back to drafts"}
      </button>
      <div className="workspace-draft-summary">
        <span className="workspace-draft-identity">
          <DraftAvatar author={row.author} authorAvatarUrl={row.authorAvatarUrl} />
          <span className="workspace-draft-copy">
            <strong>{draftTitle(row.note)}</strong>
            <small>By {row.author}</small>
          </span>
        </span>
        <span className="workspace-draft-copy workspace-draft-review-meta" role="status">
          <strong>{row.publishedRevision ? `Published · Version ${row.publishedRevision}`
            : canPublish ? `Publishes version ${row.baseRevision + 1}` : status[row.state]}</strong>
          {row.publishedRevision ? null : <small>{!owner && row.state === "submitted" ? `Sent to ${ownerName}`
            : !owner && canEdit ? `To ${ownerName}` : `Based on version ${row.baseRevision}`}</small>}
        </span>
      </div>
      {noteBody && (!canPublish || returning || releaseNote !== row.note) && <p className="workspace-draft-note">{noteBody}</p>}
      {row.reviewNote && <section aria-labelledby={formId + "-feedback"}><h2 id={formId + "-feedback"}>Review feedback</h2>
        <p className="workspace-draft-note">{row.reviewNote}</p></section>}
      {stale && row.state !== "published" && <p role="status">{owner
        ? `Version ${head} is now live. Return this draft so the editor can review it against the current release.`
        : `Version ${head} is now live. Open a working copy of that version and review the draft before sending it.`}</p>}
      {owner && row.state === "submitted" && !canReview && <p role="status">This editor no longer has access.</p>}
      {actionError && <div className="pack-check-line">
        <p role="alert" className="pack-publication-error">{actionError}</p>
        <button type="button" className="settings-action" onClick={() => {
          setActionError("");
          onChange(row);
        }}>Refresh review</button>
      </div>}
      {readError ? <div className="pack-check-line"><p role="alert">{readError}</p>
        <button type="button" className="settings-action" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>
        : pending ? <p role="status">Loading changes…</p>
        : detail && base && <section aria-labelledby={formId + "-changes"} className="workspace-draft-changes">
          <h2 id={formId + "-changes"}>{owner ? "Changes to main pack" : "Draft changes"}</h2>
          <DraftDiff changes={workspaceManifestChanges(base, detail.manifest)} />
        </section>}

      <form id={formId} className="pack-publication workspace-draft-form" onSubmit={submit}>
        {canPublish && !returning && <>
          <fieldset className="pack-update-policy">
            <legend>Update policy</legend>
            <label><input type="radio" name={formId + "-policy"} checked={!required} disabled={busy} onChange={() => setRequired(false)} />Optional</label>
            <label><input type="radio" name={formId + "-policy"} checked={required} disabled={busy} onChange={() => setRequired(true)} />Required before play</label>
          </fieldset>
          <label className="pack-note-label">{required ? "Reason for required update" : "Release note"}
            <textarea maxLength={1000} rows={2} required={required} disabled={busy} value={releaseNote}
              onChange={event => setReleaseNote(event.currentTarget.value)} />
          </label>
          {terms === false && <label className="pack-terms"><input type="checkbox" checked={acceptedTerms} disabled={busy}
            onChange={event => setAcceptedTerms(event.currentTarget.checked)} />I agree to the Delight Terms of Service.</label>}
        </>}
        {canReview && returning && <label className="pack-note-label">Review feedback
          <textarea maxLength={1000} rows={2} autoFocus disabled={busy} value={feedback} onChange={event => setFeedback(event.currentTarget.value)} />
        </label>}
        {!!detail && <div className="pack-publication-actions">
          {canReview && (returning ? <>
            <button type="button" className="settings-action" disabled={busy} onClick={() => setReturning(false)}>Cancel</button>
            <button type="button" className="settings-action" disabled={busy || !feedback.trim()} onClick={() => void change("return")}>Send feedback</button>
          </> : <button type="button" className="settings-action" disabled={busy} onClick={() => setReturning(true)}>Return to editor</button>)}
          {canEdit && !discarding && <>
            <button type="button" className="settings-action" disabled={busy || openingCopy} onClick={onEdit}>Edit draft</button>
            {stale && <button type="button" className="settings-action" disabled={busy || openingCopy} onClick={() => void openLatest()}>
              {openingCopy ? "Preparing working copy…" : "Open latest working copy"}</button>}
            <button type="button" className="settings-action" disabled={busy || openingCopy} onClick={() => setDiscarding(true)}>Discard draft</button>
          </>}
          {canEdit && discarding && <>
            <button type="button" className="settings-action" disabled={busy} onClick={() => setDiscarding(false)}>Cancel</button>
            <button type="button" className="settings-action workspace-remove" disabled={busy} onClick={() => void change("discard")}>Discard draft</button>
          </>}
          {!owner && row.state === "submitted" && <button type="button" className="settings-action" disabled={busy}
            onClick={() => void change("withdraw")}>Withdraw from review</button>}
        </div>}
      </form>
  </section>;
}
