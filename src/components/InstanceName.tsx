import { useEffect, useId, useRef, useState } from "react";

/** Only commits through the native rename callback; blur and Escape discard drafts. */
export function InstanceName({ name, onRename, request = 0, disabled = false }: {
  name: string; onRename: (name: string) => Promise<void>; request?: number; disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const errorId = useId();
  const start = () => { if (!disabled) { setDraft(name); setError(""); setEditing(true); } };
  useEffect(() => { if (request) start(); }, [request]);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  const cancel = (focus = false) => {
    if (inFlight.current) return;
    setEditing(false); setError("");
    if (focus) requestAnimationFrame(() => trigger.current?.focus());
  };
  return <span className="instance-inline-name" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
    {editing ? <form onSubmit={async e => {
      e.preventDefault(); e.stopPropagation();
      if (inFlight.current) return;
      const next = draft.trim();
      if (!next) { setError("Enter an instance name."); return; }
      if (next === name) { cancel(true); return; }
      inFlight.current = true; setSaving(true); setError("");
      try { await onRename(next); setEditing(false); requestAnimationFrame(() => trigger.current?.focus()); }
      catch (reason) { setError(String(reason)); requestAnimationFrame(() => input.current?.focus()); }
      finally { inFlight.current = false; setSaving(false); }
    }}>
      <input ref={input} aria-label="Instance name" value={draft} maxLength={80} readOnly={saving}
        aria-busy={saving} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
        onChange={e => { setDraft(e.target.value); setError(""); }}
        onBlur={() => { if (!inFlight.current) cancel(); }}
        onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(true); } if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault(); }} />
      {error && <span id={errorId} className="instance-name-error" role="alert">{error}</span>}
    </form> : <button ref={trigger} type="button" disabled={disabled} className="instance-name-trigger" onClick={start} title="Rename instance" aria-label={`Rename ${name}`}>{name}</button>}
  </span>;
}
