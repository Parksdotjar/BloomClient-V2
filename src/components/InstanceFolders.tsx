import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Folder, FolderInput, FolderOpen, Pencil, UnfoldVertical, X } from "lucide-react";
import type { FolderChange, InstanceFolderCache } from "../services/use-instance-folders";
import { useInstanceFolderDrag, type FolderDragItem } from "./instance-folder-drag";
import "./instance-folders.css";

type Item = FolderDragItem & { loader: string };
type Editor = { kind: "create"; ids: string[] } | { kind: "rename"; folderId: string } | { kind: "move"; instance: Item };
const collapseKey = "delight-instance-folders-collapsed";

export function InstanceFolders<T extends Item>({ cache, instances, query, loader, createOpen, onCloseCreate, renderInstance }: {
  cache: InstanceFolderCache; instances: T[]; query: string; loader: string; createOpen: boolean; onCloseCreate: () => void;
  renderInstance: (instance: T, organize: () => void) => ReactNode;
}) {
  const { snapshot, error, busy, refresh, save } = cache;
  const ready = snapshot !== null;
  const folders = snapshot ?? [];
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(collapseKey) || "[]");
      return Array.isArray(saved) ? saved.filter((v): v is string => typeof v === "string") : [];
    } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(collapseKey, JSON.stringify(collapsed)); } catch { /* Session state still works. */ } }, [collapsed]);
  const [editor, setEditor] = useState<Editor | null>(null), [name, setName] = useState("");
  const [actions, setActions] = useState<string | null>(null);
  const [dissolving, setDissolving] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), nameInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const change = async (request: FolderChange, message: string) => {
    const next = await save(request);
    if (next) setAnnouncement(message);
    return next;
  };
  const showEditor = (next: Editor, initialName = "") => {
    focusReturn.current = document.activeElement as HTMLElement;
    setActions(null); setDissolving(null); setEditor(next); setName(initialName);
  };
  const closeEditor = () => {
    if (busy) return;
    setEditor(null); onCloseCreate();
    requestAnimationFrame(() => (focusReturn.current?.isConnected ? focusReturn.current : root.current)?.focus());
  };
  useEffect(() => { if (createOpen) showEditor({ kind: "create", ids: [] }); }, [createOpen]);
  useEffect(() => {
    if (editor?.kind === "move") dialog.current?.showModal();
    else if (editor) { nameInput.current?.focus(); nameInput.current?.select(); }
  }, [editor]);
  const move = async (item: Item, folderId: string | null) => {
    const current = folders.find(f => f.instanceIds.includes(item.id));
    if ((current?.id || null) === folderId) return true;
    return change({ action: "move", instanceId: item.id, folderId }, folderId ? `${item.name} moved to ${folders.find(f => f.id === folderId)?.name}.` : `${item.name} moved out of its folder.`);
  };
  const reorder = (folderId: string, targetId: string, after: boolean) =>
    change({ action: "reorder", folderId, targetId, after }, "Folder order updated.");
  const drag = useInstanceFolderDrag((item, target, after) => {
    if (item.kind === "folder") {
      if (target.startsWith("folder:")) void reorder(item.id, target.slice(7), after);
      return;
    }
    const instance = instances.find(i => i.id === item.id); if (!instance) return;
    if (target === "loose") void move(instance, null);
    else if (target.startsWith("folder:")) void move(instance, target.slice(7));
  }, !ready || busy || !!editor);
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
  const card = (instance: T) => <div key={instance.id} className="instance-organizable"
    onPointerDownCapture={event => drag.start(event, instance)} onDragStart={event => event.preventDefault()}>
    {renderInstance(instance, () => showEditor({ kind: "move", instance }))}
  </div>;
  const nameForm = (mode: Extract<Editor, { kind: "create" | "rename" }>) => <form className="folder-name-row" onSubmit={async event => {
    event.preventDefault();
    if (!name.trim()) return;
    const adding = mode.kind === "create";
    const result = await change(adding ? { action: "create", name: name.trim(), instanceIds: mode.ids }
      : { action: "rename", folderId: mode.folderId, name: name.trim() }, adding ? "Folder created." : "Folder renamed.");
    if (!result) return;
    const id = adding ? result.find(f => !folders.some(old => old.id === f.id))?.id : mode.folderId;
    closeEditor();
    requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-folder-toggle="${CSS.escape(id || "")}"]`)?.focus());
  }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeEditor(); } }}>
    <input ref={nameInput} aria-label="Folder name" placeholder="Folder name" value={name} maxLength={48} onChange={e => setName(e.target.value)} disabled={busy} />
    <button title="Save folder" aria-label="Save folder" disabled={busy || !ready || !name.trim()}><Check size={15} /></button>
    <button type="button" title="Cancel" aria-label="Cancel folder edit" disabled={busy} onClick={closeEditor}><X size={15} /></button>
  </form>;
  const filtering = !!queryText || loader !== "All";
  const filterKey = JSON.stringify([queryText, loader]);
  const [filterCollapse, setFilterCollapse] = useState<{ key: string; ids: string[] }>({ key: "", ids: [] });
  const folded = filtering ? (filterCollapse.key === filterKey ? filterCollapse.ids : []) : collapsed;
  const toggle = (id: string) => {
    const ids = folded.includes(id) ? folded.filter(f => f !== id) : [...folded, id];
    if (filtering) setFilterCollapse({ key: filterKey, ids }); else setCollapsed(ids);
    setActions(null); setDissolving(null);
  };
  return <>
    <nav ref={root} className="instance-folders-grid" tabIndex={-1} aria-label="Your instances" aria-busy={busy || (!ready && !error)}
      data-dragging={!!drag.dragging} data-instance-folder-drop="loose" data-folder-drop-label="Move outside folders">
      {error && <div className="instance-folders-error" role="alert"><span>{error}</span><button onClick={() => void refresh()} disabled={busy}>Retry</button></div>}
      {editor?.kind === "create" && nameForm(editor)}
      <div className="instance-folder-loose" data-instance-folder-drop="loose" data-folder-drop-label="Move outside folders">{(ready || error) && loose.map(card)}</div>
      {shown.map(({ folder, matching }, index) => {
        const expanded = !folded.includes(folder.id);
        const FolderIcon = expanded ? FolderOpen : Folder;
        return <section key={folder.id} className="folder-section" data-instance-folder-drop={`folder:${folder.id}`} data-folder-drop-label={`Move to ${folder.name}`}>
          {editor?.kind === "rename" && editor.folderId === folder.id ? nameForm(editor) : <div className="folder-section-heading">
            <button type="button" className="folder-toggle" title={folder.name} data-folder-toggle={folder.id} aria-expanded={expanded}
              data-folder-drag-handle aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              onPointerDown={e => drag.start(e, { id: folder.id, name: folder.name, kind: "folder" })}
              onContextMenu={e => { e.preventDefault(); setActions(folder.id); setDissolving(null); }}
              onKeyDown={e => {
                if (e.key === "Escape") { setActions(null); setDissolving(null); }
                if (!e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
                e.preventDefault();
                const down = e.key === "ArrowDown";
                const neighbor = shown[index + (down ? 1 : -1)];
                if (neighbor) void reorder(folder.id, neighbor.folder.id, down);
              }}
              aria-controls={`folder-members-${folder.id}`} onClick={() => toggle(folder.id)}>
              <FolderIcon size={15} aria-hidden="true" /><span>{folder.name}</span>
            </button>
          </div>}
          {actions === folder.id && <div className="folder-actions">
            {dissolving === folder.id ? <>
              <span>Remove folder and keep its instances?</span>
              <button disabled={busy} onClick={async () => {
                if (await change({ action: "dissolve", folderId: folder.id }, "Folder removed.")) {
                  setDissolving(null); setActions(null); setCollapsed(ids => ids.filter(id => id !== folder.id)); root.current?.focus();
                }
              }}>Remove folder</button><button disabled={busy} onClick={() => setDissolving(null)}>Cancel</button>
            </> : <>
              <button disabled={busy} onClick={() => showEditor({ kind: "rename", folderId: folder.id }, folder.name)}><Pencil size={13}/>Rename</button>
              <button disabled={busy} onClick={() => setDissolving(folder.id)}><UnfoldVertical size={13}/>Ungroup</button>
            </>}
          </div>}
          <div className="folder-section-members" id={`folder-members-${folder.id}`} hidden={!expanded}>
            {expanded && matching.map(card)}
          </div>
        </section>;
      })}
      {ready && !shown.length && !loose.length && <p className="folder-empty">{instances.length ? "No matching instances" : "No instances yet"}</p>}
    </nav>
    <span className="instance-folder-sr" role="status">{announcement}</span>
    {drag.overlay}
    {editor?.kind === "move" && <dialog ref={dialog} className="instance-folder-dialog" aria-labelledby="folder-editor-title" onCancel={e => { e.preventDefault(); closeEditor(); }} onClick={e => { if (e.target === e.currentTarget) closeEditor(); }}>
      <header><h2 id="folder-editor-title">Move {editor.instance.name}</h2><button onClick={closeEditor} disabled={busy} aria-label="Close"><X size={18}/></button></header>
      <div className="instance-folder-destinations">
        <button disabled={busy || !ready} onClick={async () => { if (await move(editor.instance, null)) closeEditor(); }}><FolderInput size={16}/><span>Outside folders</span>{!assigned.has(editor.instance.id) && <Check size={15}/>}</button>
        {folders.map(f => <button key={f.id} disabled={busy || !ready} onClick={async () => { if (await move(editor.instance, f.id)) closeEditor(); }}><Folder size={16}/><span>{f.name}</span>{f.instanceIds.includes(editor.instance.id) && <Check size={15}/>}</button>)}
        <button disabled={busy || !ready} onClick={() => showEditor({ kind: "create", ids: [editor.instance.id] })}>New folder</button>
        {error && <p role="alert">{error}</p>}
      </div>
    </dialog>}
  </>;
}
