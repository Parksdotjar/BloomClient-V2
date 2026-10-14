import { useEffect, useRef, useState, type ComponentType } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, FolderOpen, Image as ImageIcon, RefreshCw, X } from "lucide-react";
import type { UtilityInstance } from "./UtilitiesPage";
import "./utilities.css";
import "./screenshot-shelf.css";
type Shot = { instanceId: string; instanceName: string; name: string; modified: number };
const action = (shot: Shot, action: string) => invoke<string>("screenshot_action", { instanceId: shot.instanceId, name: shot.name, action });
function ScreenshotImage({ shot, preview = false }: { shot: Shot; preview?: boolean }) {
  const [src, setSrc] = useState(""); const [error, setError] = useState("");
  useEffect(() => { let live = true; setSrc(""); setError(""); action(shot, preview ? "preview" : "thumbnail").then(v => { if (live) setSrc(v); }).catch(e => { if (live) setError(String(e)); }); return () => { live = false; }; }, [shot.instanceId, shot.name, shot.modified, preview]);
  return src ? <img src={src} alt={shot.name} /> : <span className="shelf-image-placeholder" title={error}>{error ? <><ImageIcon size={28} /><span>Preview unavailable</span></> : <RefreshCw className="spin" size={24} />}</span>;
}
function Preview({ shot, close }: { shot: Shot; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="shelf-preview" onClose={close} onClick={e => { if(e.target === e.currentTarget) close(); }}><header><strong>{shot.name}</strong><button onClick={close} aria-label="Close preview"><X size={20} /></button></header><ScreenshotImage shot={shot} preview /><p>{shot.instanceName}</p></dialog>;
}
export function ScreenshotShelf({ instances, SelectControl, onMessage }: { onMessage: (message: string, kind?: "notification" | "error") => void; instances: UtilityInstance[]; SelectControl: ComponentType<{value: string; options: string[]; onChange: (value: string) => void}> }) {
  const [shots, setShots] = useState<Shot[]>([]); const [filter, setFilter] = useState(""); const [limit, setLimit] = useState(24);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState<Shot | null>(null); const [busy, setBusy] = useState(false);
  const request = useRef(0);
  async function refresh() { const id = ++request.current; setLoading(true); setError(""); try { const data = await invoke<{items: Shot[]; warnings: string[]}>("list_screenshots"); if(id === request.current) {setShots(data.items);setWarnings(data.warnings);} } catch(e) { if(id === request.current) { setError(String(e)); onMessage(String(e), "error"); } } finally { if(id === request.current) setLoading(false); } }
  useEffect(() => { void refresh(); return () => { request.current++; }; }, []);
  const choices = instances.map(i => ({id: i.id, label: instances.filter(other => other.name === i.name).length > 1 ? `${i.name} · ${i.id}` : i.name}));
  const filtered = shots.filter(s => !filter || s.instanceId === filter);
  async function run(shot: Shot, operation: string) {setBusy(true);try {await action(shot, operation);onMessage(operation === "copy" ? "Image copied to clipboard." : "Screenshot folder opened.");}catch(e){onMessage(String(e), "error");}finally{setBusy(false);}}
  return <div className="utilities-page screenshot-shelf"><div className="shelf-heading-shell"><header className="utilities-heading shelf-heading"><h1>Screenshot Shelf</h1></header>
    <div className="shelf-toolbar"><SelectControl value={choices.find(c=>c.id===filter)?.label ?? "All instances"} options={["All instances", ...choices.map(c=>c.label)]} onChange={v=>{setFilter(choices.find(c=>c.label===v)?.id ?? "");setLimit(24);}} /><button onClick={()=>void refresh()} disabled={loading} aria-label="Refresh screenshots"><RefreshCw size={20} className={loading ? "spin" : ""} /></button></div></div>
    {warnings.length > 0 && <details><summary>Some folders could not be read</summary>{warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
    {loading ? <div className="shelf-empty" role="status"><RefreshCw className="spin" />Loading screenshots…</div> : error ? <div className="shelf-empty"><ImageIcon size={40} /><h2>Screenshots unavailable</h2><p>Use refresh to try again.</p></div> : !filtered.length ? <div className="shelf-empty"><ImageIcon size={40} /><h2>No screenshots yet</h2><p>Take a screenshot in Minecraft with F2, then refresh.</p></div> : <div className="shelf-grid">{filtered.slice(0,limit).map(shot=><article key={`${shot.instanceId}/${shot.name}`}><button className="shelf-thumbnail" onClick={()=>setPreview(shot)} aria-label={`Preview ${shot.name} from ${shot.instanceName}`}><ScreenshotImage shot={shot} /></button><div className="shelf-caption"><strong title={shot.name}>{shot.name}</strong><span>{shot.instanceName}</span><small>{shot.modified ? new Date(shot.modified).toLocaleString() : "Unknown date"}</small></div><footer><button disabled={busy} onClick={()=>void run(shot,"copy")}><Copy size={15} />Copy image</button><button disabled={busy} onClick={()=>void run(shot,"folder")} aria-label={`Open screenshot folder for ${shot.instanceName}`} title="Open folder"><FolderOpen size={18} /></button></footer></article>)}</div>}
    {!loading && filtered.length > limit && <button className="shelf-more" onClick={()=>setLimit(v=>v+24)}>Show more</button>}
    {preview && <Preview shot={preview} close={()=>setPreview(null)} />}
  </div>;
}
