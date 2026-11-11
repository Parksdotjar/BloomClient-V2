import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronDown, Folder, FolderInput, FolderPlus, Pencil, RefreshCw, UnfoldVertical, X } from "lucide-react";
import { invoke } from "../services/invoke";
import { useInstanceFolderDrag, type FolderDragItem } from "./instance-folder-drag";
import "./instance-folders.css";

type Item = FolderDragItem & { loader: string };
type LibraryFolder = { id: string; name: string; instanceIds: string[] };
type Change = { action: "create"; name: string; instanceIds: string[] } | { action: "rename"; folderId: string; name: string } | { action: "move"; instanceId: string; folderId: string | null } | { action: "dissolve"; folderId: string };
type Editor = { kind: "create"; ids: string[] } | { kind: "move"; instance: Item };

export function InstanceFolders<T extends Item>({ instances, query, loader, createOpen, onCloseCreate, renderInstance }: {
  instances: T[]; query: string; loader: string; createOpen: boolean; onCloseCreate: () => void;
  renderInstance: (instance: T, organize: () => void) => ReactNode;
}) {
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [open, setOpen] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null), [name, setName] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null), [rename, setRename] = useState("");
  const [dissolving, setDissolving] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), nameInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null), pending = useRef(false), generation = useRef(0);
  const focusReturn = useRef<HTMLElement | null>(null);
  const alive = useRef(true);
  const idsKey = instances.map(i => i.id).join("\0");
  const refresh = async () => {
    if (pending.current) return;
    const sequence = ++generation.current;
    try {
      const next = await invoke<LibraryFolder[]>("list_instance_folders");
      if (!alive.current || sequence !== generation.current) return;
      if (!Array.isArray(next)) throw new Error("Instance folders are unavailable. Restart Bloom after updating.");
      setFolders(next); setReady(true); setError("");
    } catch (e) { if (alive.current && sequence === generation.current) setError(String(e)); }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { void refresh(); }, [idsKey]);
  const change = async (request: Change, message: string) => {
    if (pending.current || !ready) return null;
    pending.current = true; generation.current++; setBusy(true); setError("");
    try {
      const next = await invoke<LibraryFolder[]>("change_instance_folder", { change: request });
      if (!alive.current) return null;
      if (!Array.isArray(next)) throw new Error("Bloom could not confirm the saved folders. Please retry.");
      setFolders(next); setAnnouncement(message); return next;
    } catch (e) { if (alive.current) setError(String(e)); return null; }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const showEditor = (next: Editor) => { focusReturn.current = document.activeElement as HTMLElement; if (ready) setError(""); setEditor(next); setName(""); setSelection(next.kind === "create" ? next.ids : []); };
  const closeEditor = () => { if (pending.current) return; setEditor(null); onCloseCreate(); requestAnimationFrame(() => { if (focusReturn.current?.isConnected) focusReturn.current.focus(); else root.current?.focus(); }); };
  useEffect(() => { if (createOpen) showEditor({ kind: "create", ids: [] }); }, [createOpen]);
  useEffect(() => { if (editor) { dialog.current?.showModal(); if (editor.kind === "create") nameInput.current?.focus(); } }, [editor]);
  const move = async (item: Item, folderId: string | null) => {
    const current = folders.find(f => f.instanceIds.includes(item.id));
    if ((current?.id || null) === folderId) return true;
    return change({ action: "move", instanceId: item.id, folderId }, folderId ? `${item.name} moved to ${folders.find(f => f.id === folderId)?.name}.` : `${item.name} moved out of its folder.`);
  };
  const drag = useInstanceFolderDrag((item, target) => {
    const instance = instances.find(i => i.id === item.id); if (!instance) return;
    if (target === "loose") void move(instance, null);
    else if (target.startsWith("folder:")) void move(instance, target.slice(7));
    else if (target.startsWith("instance:")) showEditor({ kind: "create", ids: [item.id, target.slice(9)] });
  }, !ready || busy || !!editor);
  useEffect(() => {
    if (!open || editor) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || renaming || dissolving) return;
      setOpen(null); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-folder-toggle="${open}"]`)?.focus());
    };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [open, editor, renaming, dissolving]);
  useEffect(() => { if (open && !folders.some(f => f.id === open)) setOpen(null); }, [folders, open]);
  const queryText = query.trim().toLocaleLowerCase();
  const matchesLoader = (item: T) => loader === "All" || item.loader.toLowerCase() === loader.toLowerCase();
  const matchesName = (item: T) => item.name.toLocaleLowerCase().includes(queryText);
  const assigned = new Set(folders.flatMap(f => f.instanceIds));
  const loose = instances.filter(i => !assigned.has(i.id) && matchesLoader(i) && matchesName(i));
  const shown = folders.map(folder => {
    const members = folder.instanceIds.map(id => instances.find(i => i.id === id)).filter((i): i is T => !!i);
    const matching = members.filter(i => matchesLoader(i) && (folder.name.toLocaleLowerCase().includes(queryText) || matchesName(i)));
    return { folder, members, matching };
  }).filter(({ folder, matching }) => (!queryText && loader === "All") || matching.length || (!folder.instanceIds.length && loader === "All" && folder.name.toLocaleLowerCase().includes(queryText)));
  const card = (instance: T, index: number, grouped = false) => <div key={instance.id} className="instance-organizable" style={{ "--folder-order": index } as CSSProperties}
    data-instance-folder-drop={grouped ? undefined : `instance:${instance.id}`} data-folder-drop-label={grouped ? undefined : `Create a folder with ${instance.name}`}
    onPointerDownCapture={event => drag.start(event, instance)} onDragStart={event => event.preventDefault()}>
    {renderInstance(instance, () => showEditor({ kind: "move", instance }))}
  </div>;
  return <>
    <div ref={root} className="instances-grid instance-folders-grid" tabIndex={-1} aria-label="Instance library" aria-busy={busy} data-dragging={!!drag.dragging} data-instance-folder-drop="loose" data-folder-drop-label="Move out of folder">
      {error && !editor && <div className="instance-folders-error" role="alert"><span>{error}</span><button onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} />Retry</button></div>}
      {!ready && !error && <div className="instance-folders-loading" role="status"><RefreshCw size={22} className="spin" />Loading instances…</div>}
      {drag.dragging && assigned.has(drag.dragging.id) && <div className="instance-folder-drop-out" data-instance-folder-drop="loose" data-folder-drop-label="Move out of folder"><FolderInput size={20} /><span>Drop here to move out of the folder</span></div>}
      {ready && shown.map(({ folder, members, matching }) => {
        const expanded = open === folder.id;
        return <section key={folder.id} className={`instance-folder-entry ${expanded ? "is-open" : ""}`} data-instance-folder-drop={`folder:${folder.id}`} data-folder-drop-label={`Move to ${folder.name}`}>
          <button type="button" className="instance-folder-cover" data-folder-toggle={folder.id} aria-expanded={expanded} aria-controls={`folder-tray-${folder.id}`} onClick={() => { setOpen(expanded ? null : folder.id); setRenaming(null); setDissolving(null); }}>
            <span className="instance-folder-stack" aria-hidden="true">{members.length ? members.slice(0, 3).map((i, index) => <span key={i.id} style={{ "--stack-index": index } as CSSProperties}>{i.icon ? <img src={i.icon} alt="" draggable={false} /> : <b>?</b>}</span>) : <Folder size={48} strokeWidth={1.4} />}</span>
            <span className="instance-folder-title"><strong>{folder.name}</strong><small>{members.length} {members.length === 1 ? "instance" : "instances"}</small></span><ChevronDown size={19} className="instance-folder-chevron" />
          </button>
          <div className="instance-folder-tray-reveal" data-open={expanded} inert={!expanded} id={`folder-tray-${folder.id}`}>
            <div className="instance-folder-tray-clip"><div className="instance-folder-tray">
              <div className="instance-folder-tools">
                {renaming === folder.id ? <form onSubmit={async e => { e.preventDefault(); if (await change({ action: "rename", folderId: folder.id, name: rename }, "Folder renamed.")) { setRenaming(null); root.current?.querySelector<HTMLButtonElement>(`[data-rename-folder="${folder.id}"]`)?.focus(); } }}><input autoFocus aria-label="Folder name" maxLength={48} value={rename} onChange={e => setRename(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }} /><button disabled={busy || !rename.trim()} aria-label="Save folder name"><Check size={17} /></button><button type="button" aria-label="Cancel rename" onClick={() => setRenaming(null)}><X size={17} /></button></form> : <>
                  <button data-rename-folder={folder.id} disabled={busy} onClick={() => { setRenaming(folder.id); setRename(folder.name); setDissolving(null); }}><Pencil size={15} />Rename</button>
                  <button disabled={busy} onClick={() => setDissolving(dissolving === folder.id ? null : folder.id)}><UnfoldVertical size={16} />Ungroup</button>
                  <span>Drag an instance outside to remove it</span>
                </>}
              </div>
              {dissolving === folder.id && <div className="instance-folder-confirm"><span>Ungroup “{folder.name}”? Your instances stay in the library.</span><button disabled={busy} onClick={async () => { if (await change({ action: "dissolve", folderId: folder.id }, "Folder ungrouped. Your instances are unchanged.")) { setDissolving(null); setOpen(null); root.current?.focus(); } }}>Ungroup folder</button><button disabled={busy} onClick={() => setDissolving(null)}>Cancel</button></div>}
              <div className="instance-folder-members">{matching.map((item, index) => card(item, index, true))}</div>
              {!matching.length && <div className="instance-folder-empty">{members.length ? "No matching instances in this folder." : "Drop instances here, or use Move to folder from their menu."}</div>}
            </div></div>
          </div>
        </section>;
      })}
      {(ready || error) && <div className="instance-folder-loose" data-instance-folder-drop="loose" data-folder-drop-label="Move out of folder" data-receiving={!!drag.dragging && assigned.has(drag.dragging.id)}>
        {loose.map((item, index) => card(item, index))}
      </div>}
      {ready && !shown.length && !loose.length && <div className="instances-library-empty">{instances.length ? "No matching instances" : "No instances yet"}</div>}
    </div>
    <span className="instance-folder-sr" role="status">{announcement}</span>
    {drag.overlay}
    {editor && <dialog ref={dialog} className="instance-folder-dialog" aria-labelledby="folder-editor-title" onCancel={e => { e.preventDefault(); closeEditor(); }} onClick={e => { if (e.target === e.currentTarget) closeEditor(); }}>
      <header><h2 id="folder-editor-title">{editor.kind === "create" ? "New folder" : `Move ${editor.instance.name}`}</h2><button onClick={closeEditor} disabled={busy} aria-label="Close folder editor"><X size={20} /></button></header>
      {editor.kind === "create" ? <form onSubmit={async e => { e.preventDefault(); const old = new Set(folders.map(f => f.id)); const next = await change({ action: "create", name, instanceIds: selection }, `Folder “${name.trim()}” created.`); if (next) { const created = next.find(f => !old.has(f.id)); closeEditor(); if (created) setOpen(created.id); } }}>
        <label className="instance-folder-name">Folder name<input ref={nameInput} value={name} onChange={e => setName(e.target.value)} maxLength={48} placeholder="Name your folder" required /></label>
        <fieldset disabled={busy || !ready}><legend>Choose instances</legend><div className="instance-folder-choices">{instances.map(item => <label key={item.id}><input type="checkbox" checked={selection.includes(item.id)} onChange={e => setSelection(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /><span className="instance-folder-choice-icon">{item.icon ? <img src={item.icon} alt="" /> : <b>?</b>}</span><span><b>{item.name}</b><small>{folders.find(f => f.instanceIds.includes(item.id))?.name || item.loader}</small></span></label>)}{!instances.length && <p>You can add instances later.</p>}</div></fieldset>
        {error && <div className="instance-folder-form-error" role="alert"><p>{error}</p>{!ready && <button type="button" onClick={() => void refresh()}>Retry</button>}</div>}
        <footer><button type="button" onClick={closeEditor} disabled={busy}>Cancel</button><button type="submit" className="instance-folder-primary" disabled={busy || !ready || !name.trim()}><FolderPlus size={17} />{busy ? "Creating…" : "Create folder"}</button></footer>
      </form> : <div className="instance-folder-destinations">
        <button disabled={busy || !ready} onClick={async () => { if (await move(editor.instance, null)) closeEditor(); }}><UnfoldVertical size={20} /><span>Outside folders</span>{!assigned.has(editor.instance.id) && <Check size={17} />}</button>
        {folders.map(folder => <button key={folder.id} disabled={busy || !ready} onClick={async () => { if (await move(editor.instance, folder.id)) closeEditor(); }}><Folder size={20} /><span>{folder.name}</span>{folder.instanceIds.includes(editor.instance.id) && <Check size={17} />}</button>)}
        <button disabled={busy || !ready} onClick={() => { setEditor({ kind: "create", ids: [editor.instance.id] }); setName(""); setSelection([editor.instance.id]); }}><FolderPlus size={20} /><span>New folder</span></button>
        {error && <p className="instance-folder-form-error" role="alert">{error}</p>}
      </div>}
    </dialog>}
  </>;
}
