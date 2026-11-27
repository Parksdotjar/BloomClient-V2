import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FloppyDiskIcon as Save } from "@phosphor-icons/react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import type { DraftEditing, DraftSummary } from "../services/workspace-drafts";
import type { PackCompatibility } from "../services/pack-compatibility";

export function PackDraftSave({editor, report, baseRevision, note, onNote, disabled, onBusy}: {
  editor: DraftEditing;
  report: PackCompatibility;
  baseRevision: number;
  note: string;
  onNote: (note: string) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const id = useRef(editor.existing?.id);
  const active = useRef(false);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const save = async () => {
    if (disabled || saving.current || !report.reviewToken) return;
    saving.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      id.current ??= crypto.randomUUID();
      const saved = await invoke<DraftSummary>("save_workspace_draft", {
        instanceId: report.instanceId, reviewToken: report.reviewToken, excludedFolders: report.excludedFolders,
        excludedLocalFiles: report.excludedLocalFiles,
        baseRevision, note: note.trim(), draftId: id.current, version: editor.existing?.version,
      });
      if (active.current) editor.onSaved(saved);
    } catch (reason) {
      if (active.current) setError(userError(reason));
    } finally {
      saving.current = false;
      if (active.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  return <div className="pack-publication">
    {editor.existing?.reviewNote && <p className="pack-draft-note">{editor.existing.reviewNote}</p>}
    <label className="pack-note-label">Draft note <span>(optional)</span>
      <textarea value={note} onChange={event => onNote(event.currentTarget.value)} maxLength={1000} rows={2} disabled={busy} />
    </label>
    {editor.actionHost && createPortal(
      <button type="button" className="instance-play ceramic-action pack-workspace-action" disabled={disabled || busy}
        onClick={() => void save()}><Save size={16} aria-hidden="true" />{busy ? "Saving…" : "Save draft"}</button>,
      editor.actionHost,
    )}
    {error && <p role="alert" className="pack-publication-error">{error}</p>}
  </div>;
}
