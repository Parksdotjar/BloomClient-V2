import { useEffect, useId, useRef, useState } from "react";
import { invoke as invokeNative } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Upload } from "lucide-react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import { connectDelightAccount } from "../services/connect-delight-account";
import type { PackCompatibility } from "../services/pack-compatibility";

export type PackPublication = { revision: number; code: string; playerUrl: string; releaseNote: string; required?: boolean; minimumPlayableRevision?: number };
export type PackPublisher = { id: string; name: string; termsAccepted: boolean; canPublish?: boolean; canRequire?: boolean; canEdit?: boolean };
type PublicationError = { code: string; message: string };

const termsUrl = "https://bloomclient.org/tos/";

export function PackReleasePolicy({required, onRequired, disabled}: {
  required: boolean;
  onRequired: (required: boolean) => void;
  disabled: boolean;
}) {
  const group = useId();
  return <fieldset className="pack-update-policy" disabled={disabled}>
    <legend>Update policy</legend>
    <label><input type="radio" name={group} checked={!required} onChange={() => onRequired(false)} />Optional</label>
    <label><input type="radio" name={group} checked={required} onChange={() => onRequired(true)} />Required before play</label>
  </fieldset>;
}

export function PackReleaseNote({note, onNote, required, disabled}: {
  note: string;
  onNote: (note: string) => void;
  required: boolean;
  disabled: boolean;
}) {
  return <label className="pack-note-label">{required ? "Reason for required update" : <>Release note <span>(optional)</span></>}
    <textarea value={note} onChange={event => onNote(event.target.value)} disabled={disabled}
      maxLength={1000} rows={2} required={required} />
  </label>;
}

export function PackPublicationTerms({accepted, onAccepted, disabled, onError}: {
  accepted: boolean;
  onAccepted: (accepted: boolean) => void;
  disabled: boolean;
  onError: (error: unknown) => void;
}) {
  return <div className="pack-terms">
    <label><input type="checkbox" disabled={disabled} checked={accepted}
      onChange={event => onAccepted(event.currentTarget.checked)} />I agree to the Delight Terms of Service.</label>
    <a href={termsUrl} onClick={event => {
      event.preventDefault();
      void openUrl(termsUrl).catch(onError);
    }}>Read terms <ExternalLink size={13} aria-hidden="true" /></a>
  </div>;
}

export function PackLocalExclusions({ report }: { report: PackCompatibility }) {
  const names = [...new Set([...report.excludedFolders, ...(report.excludedLocalFiles ?? []).map(file => file.fileName)])];
  if (!names.length) return null;
  return <div className="pack-local-exclusions">
    <strong>Stays on this device</strong>
    <p>{names.join(", ")}</p>
  </div>;
}

export function PackPublicationForm({ report, note, onNote, onPublished, onBusy, onRecheck, revision, showNote = true, disabled = false }: {
  report: PackCompatibility;
  note: string;
  onNote: (note: string) => void;
  onPublished: (publication: PackPublication) => void;
  onBusy: (busy: boolean) => void;
  onRecheck: () => void;
  showNote?: boolean;
  disabled?: boolean;
  revision?: { base: number; hasChanges: boolean; required: boolean; onRequired: (required: boolean) => void; refreshHead: () => void };
}) {
  const [publisher, setPublisher] = useState<PackPublisher | null>();
  const [accountError, setAccountError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<PublicationError | null>(null);
  const submission = useRef(false);
  const reconnectAccount = useRef<string | null>(null);
  const session = useRef<AbortController | null>(null);
  const existingInstanceId = revision ? report.instanceId : undefined;
  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    setPublisher(undefined);
    setAccountError("");
    setAccepted(false);
    invoke<PackPublisher | null>("get_pack_publisher", { instanceId: existingInstanceId }).then(
      result => {
        if (controller.signal.aborted) return;
        setPublisher(result?.id === reconnectAccount.current ? null : result);
        setError(previous => previous?.code === "signed_out" ? null : previous);
      },
      reason => { if (!controller.signal.aborted) setAccountError(userError(reason)); },
    );
    return () => controller.abort();
  }, [attempt, existingInstanceId]);

  const connect = async () => {
    const signal = session.current?.signal;
    setConnecting(true);
    setError(null);
    try {
      await connectDelightAccount(signal);
      if (!signal?.aborted) {
        reconnectAccount.current = null;
        setAttempt(current => current + 1);
      }
    } catch (reason) {
      if (!signal?.aborted) setError({ code: "sign_in", message: userError(reason) });
    } finally {
      if (!signal?.aborted) setConnecting(false);
    }
  };
  const consent = !!(publisher?.termsAccepted || accepted);
  const needsReview = error?.code === "stale_review" || error?.code === "stale_base";
  const required = revision?.required === true && publisher?.canRequire !== false;
  const ready = !disabled && consent && publisher?.canPublish !== false && !!report.reviewToken && !needsReview
    && (!revision || !!note.trim() || (revision.hasChanges && !required));
  const publish = async () => {
    if (!publisher || !ready || submission.current) return;
    const signal = session.current?.signal;
    submission.current = true;
    setPublishing(true);
    onBusy(true);
    setError(null);
    try {
      // Preserve the native error code so a changed review has a distinct recovery action.
      const result = await invokeNative<PackPublication>("publish_workspace_release", {
        instanceId: report.instanceId, reviewToken: report.reviewToken, excludedFolders: report.excludedFolders,
        excludedLocalFiles: report.excludedLocalFiles,
        publisherId: publisher.id, acceptedTerms: consent, releaseNote: note.trim(),
        ...(revision && { baseRevision: revision.base, required }),
      });
      if (!signal?.aborted) onPublished(result);
      else window.dispatchEvent(new CustomEvent("workspace-publication-updated", { detail: { instanceId: report.instanceId } }));
    } catch (reason) {
      if (signal?.aborted) return;
      const details = typeof reason === "object" && reason !== null && "code" in reason && "message" in reason
        ? { code: String(reason.code), message: userError(reason.message) }
        : { code: "publication_error", message: userError(reason) };
      setError(details);
      if (details.code === "signed_out") {
        reconnectAccount.current = publisher.id;
        setAttempt(current => current + 1);
      }
    } finally {
      submission.current = false;
      if (!signal?.aborted) { setPublishing(false); onBusy(false); }
    }
  };

  if (publisher?.canPublish === false && publisher.canEdit) return <p className="pack-workspace-status">
    The pack owner can give you publishing access.
  </p>;
  if (publisher?.canPublish === false) return <div className="pack-publication">
    <div className="pack-publication-actions"><span>This release belongs to a different Delight account.</span>
      <button type="button" className="settings-action" disabled={connecting} onClick={() => void connect()}>
        {connecting ? "Waiting for approval…" : "Sign in as publisher"}</button></div>
    {error && <p role="alert">{error.message}</p>}
  </div>;
  return <div className="pack-publication">
    {revision && publisher?.canRequire !== false && <PackReleasePolicy required={revision.required} onRequired={revision.onRequired} disabled={publishing} />}
    {showNote && <PackReleaseNote note={note} onNote={onNote} required={required} disabled={publishing} />}
    {accountError ? <div className="pack-publication-actions"><span role="alert">{accountError}</span>
      <button type="button" className="settings-action" onClick={() => setAttempt(current => current + 1)}>Retry account check</button></div>
      : publisher === undefined ? <p role="status">Checking your Delight account…</p>
      : !publisher ? <div className="pack-publication-actions"><span>Connect your Delight account to publish this pack.</span>
        <button type="button" className="settings-action" disabled={connecting} onClick={() => void connect()}>
          {connecting ? "Waiting for approval…" : "Connect account"}</button></div>
      : <>
        {!publisher.termsAccepted && <PackPublicationTerms accepted={accepted} onAccepted={setAccepted} disabled={publishing}
          onError={reason => setError({code:"terms", message:userError(reason)})} />}
        <div className="pack-publication-actions">
          <button type="button" className="instance-play ceramic-action pack-publish-action" onClick={() => void publish()}
            disabled={!ready || publishing}>
            <Upload size={15} aria-hidden="true" />{publishing ? "Publishing…" : "Publish version " + ((revision?.base ?? 0) + 1)}</button>
          <span>Publishing as <strong>{publisher.name}</strong></span>
        </div>
      </>}
    {error && <div className="pack-publication-error"><span role="alert">{error.message}</span>
      {error.code === "stale_review" && <button type="button" className="settings-action" onClick={onRecheck}>Recheck contents</button>}
      {error.code === "stale_base" && revision && <button type="button" className="settings-action" onClick={revision.refreshHead}>Review latest version</button>}
    </div>}
  </div>;
}
