import { useState } from "react";
import { binding, chord, formatKeys, modifiers, shortcuts, type Bindings, type ShortcutId } from "../services/shortcuts";
import "./keyboard-shortcuts.css";

export function KeyboardShortcuts({ saved, change }: { saved: Bindings; change: (value: Bindings) => void }) {
  const [editing, setEditing] = useState<ShortcutId>();
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  function begin(id: ShortcutId) { setEditing(id); setPreview(""); setError(""); }
  return <div className="shortcut-settings">
    <p>Double-click a shortcut, or focus it and press Enter. Then press the new keys.</p>
    {shortcuts.map(row => <div className="shortcut-row" key={row[0]} data-setting-help="Keyboard shortcut" aria-label={row[1]}>
      <span>{row[1]}</span>
      <button type="button" aria-label={`Shortcut for ${row[1]}`} data-recording-shortcut={editing === row[0] || undefined}
        onDoubleClick={() => begin(row[0])} onBlur={() => { setEditing(undefined); setError(""); }}
        onKeyUp={e => { if (editing === row[0]) setPreview(modifiers(e.nativeEvent)); }}
        onKeyDown={e => {
          if (editing !== row[0]) {
            if (e.key === "Enter") { e.preventDefault(); begin(row[0]); }
            return;
          }
          e.preventDefault(); e.stopPropagation();
          if (e.repeat) return;
          const keys = chord(e.nativeEvent);
          if (!keys) { setPreview(modifiers(e.nativeEvent)); return; }
          if (keys === "Escape" && row[0] !== "cancelRename") { setEditing(undefined); setError(""); return; }
          const conflict = shortcuts.find(other => other !== row && binding(other, saved) === keys);
          if (conflict) { setError(`Already used by ${conflict[1]}.`); return; }
          if (["Tab", "Shift+Tab", "F12", "Ctrl+U", "Ctrl+Shift+I", "Ctrl+Shift+J", "Ctrl+Shift+C", "Cmd+Alt+I", "Cmd+Alt+J", "Cmd+Alt+C", "Cmd+Alt+U"].includes(keys)) {
            setError("That combination is reserved. Choose another."); return;
          }
          change({ ...saved, [row[0]]: keys }); setEditing(undefined); setError("");
        }}>{editing === row[0] ? preview ? formatKeys(preview) + " + …" : "Press keys…" : formatKeys(binding(row, saved))}</button>
      {editing === row[0] && error && <small role="status">{error}</small>}
    </div>)}
    {Object.keys(saved).length > 0 && <button type="button" className="settings-action" onClick={() => change({})}>Reset shortcuts</button>}
  </div>;
}
