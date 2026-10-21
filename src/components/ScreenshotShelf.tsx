import { FolderOpen } from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { invoke } from "../services/invoke";
import { ArrowLeftRight, Check, Copy, Image as ImageIcon, RefreshCw, X } from "lucide-react";
import type { UtilityInstance } from "./UtilitiesPage";
import "./utilities.css";
import "./screenshot-shelf.css";
import { ScreenshotComparison } from "./ScreenshotComparison";
import { ToolbarIconSwap } from "./ConnectedToolbar";
import { cachedScreenshotShelf, listScreenshots, subscribeScreenshotShelf, screenshotImages, warmScreenshots, type ScreenshotShot as Shot } from "../services/screenshots";
const action = (shot: Shot, action: string) => invoke<string>("screenshot_action", { instanceId: shot.instanceId, name: shot.name, action });
const loadComparisonImage = (shot: Shot) => screenshotImages.get(shot, "preview");
const shotKey = (shot: Shot) => JSON.stringify([shot.instanceId, shot.name]);
const shotDate = (modified: number) => {
  const date = new Date(modified);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
function ScreenshotImage({ shot, preview = false }: { shot: Shot; preview?: boolean }) {
  const [src, setSrc] = useState(() => screenshotImages.peek(shot, preview ? "preview" : "thumbnail") || ""); const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const kind = preview ? "preview" : "thumbnail";
    setSrc(screenshotImages.peek(shot, kind) || ""); setError("");
    screenshotImages.get(shot, kind, preview ? 100 : 60).then(value => { if (live) setSrc(value); }).catch(error => { if (live) setError(String(error)); });
    return () => { live = false; };
  }, [shot.instanceId, shot.name, shot.modified, shot.revision, preview]);
  return src ? <img src={src} alt={shot.name} /> : <span className="shelf-image-placeholder" title={error}>{error ? <><ImageIcon size={28} /><span>Preview unavailable</span></> : <RefreshCw className="spin" size={24} />}</span>;
}
function Preview({ shot, close }: { shot: Shot; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="shelf-preview" onClose={close} onClick={e => { if(e.target === e.currentTarget) close(); }}><header><strong>{shot.name}</strong><button onClick={close} aria-label="Close preview"><X size={20} /></button></header><ScreenshotImage shot={shot} preview /><p>{shot.instanceName}</p></dialog>;
}
export function ScreenshotShelf({ instances, SelectControl, onMessage }: { onMessage: (message: string, kind?: "notification" | "error") => void; instances: UtilityInstance[]; SelectControl: ComponentType<{value: string; options: string[]; onChange: (value: string) => void}> }) {
  const [shots, setShots] = useState<Shot[]>(() => cachedScreenshotShelf()?.items || []); const [filter, setFilter] = useState(""); const [limit, setLimit] = useState(24);
  const [loading, setLoading] = useState(!cachedScreenshotShelf()); const [error, setError] = useState(""); const [warnings, setWarnings] = useState<string[]>([]);
  const [preview, setPreview] = useState<Shot | null>(null); const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelHovered, setCancelHovered] = useState(false);
  const [cancelFocused, setCancelFocused] = useState(false);
  const compareTrigger = useRef<HTMLButtonElement>(null);
  const comparisonStatusId = useId();
  const cancelSelection = () => { setSelecting(false); setSelected([]); setCancelHovered(false); setCancelFocused(false); compareTrigger.current?.focus(); };
  useEffect(() => {
    if (!selecting || comparing || preview) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Let the instance filter consume Escape before cancelling selection.
      if (compareTrigger.current?.closest(".shelf-toolbar")?.querySelector('.select-trigger[aria-expanded="true"]')) return;
      cancelSelection();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selecting, comparing, preview]);
  const selectedShots = selected.map(key => shots.find(shot => shotKey(shot) === key)).filter((shot): shot is Shot => !!shot);
  const showCancel = selecting && selectedShots.length < 2 && (cancelHovered || cancelFocused);
  const compareLabel = showCancel ? "Cancel" : selecting ? `Compare (${selectedShots.length}/2)` : "Compare";
  const request = useRef(0);
  const toggleShot = (shot: Shot) => {
    const key = shotKey(shot);
    setSelected(current => current.includes(key) ? current.filter(item => item !== key) : current.length < 2 ? [...current, key] : current);
  };
  useEffect(() => {
    setSelected(current => current.filter(key => shots.some(shot => shotKey(shot) === key)));
  }, [shots]);
  async function refresh() { const id = ++request.current; setRefreshing(true); setLoading(!cachedScreenshotShelf()); setError(""); try { const data = await listScreenshots(); if(id === request.current) {setShots(data.items);setWarnings(data.warnings);warmScreenshots(data.items);} } catch(e) { if(id === request.current) { setError(String(e)); onMessage(String(e), "error"); } } finally { if(id === request.current) { setLoading(false); setRefreshing(false); } } }
  useEffect(() => { void refresh(); return () => { request.current++; }; }, []);
  useEffect(() => subscribeScreenshotShelf(data => {
    setShots(data.items); setWarnings(data.warnings);
    setPreview(current => current ? data.items.find(shot => shotKey(shot) === shotKey(current)) || null : null);
  }), []);
  const choices = instances.map(i => ({id: i.id, label: instances.filter(other => other.name === i.name).length > 1 ? `${i.name} · ${i.id}` : i.name}));
  const filtered = shots.filter(s => !filter || s.instanceId === filter);
  useEffect(() => {
    const visible = filtered.slice(0, limit);
    screenshotImages.prefer(visible);
    warmScreenshots(visible, 50);
  }, [shots, filter, limit]);
  async function run(shot: Shot, operation: string) {setBusy(true);try {await action(shot, operation);onMessage(operation === "copy" ? "Image copied to clipboard." : "Screenshot folder opened.");}catch(e){onMessage(String(e), "error");}finally{setBusy(false);}}
  async function exportComparison(render: () => Promise<string>) {
    try {
      const png = await render();
      if (await invoke<boolean>("save_screenshot_comparison", { png })) onMessage("Comparison exported.");
    } catch (error) { onMessage(String(error), "error"); }
  }
  return <div className="utilities-page screenshot-shelf"><div className="shelf-heading-shell"><header className="utilities-heading shelf-heading"><h1 key={String(selecting)} className="toolbar-copy">{selecting ? "Compare screenshots" : "Screenshot Shelf"}</h1></header>
    <div className="connected-toolbar-shelf">
    <div className="shelf-toolbar toolbar-shelf-actions"><SelectControl value={choices.find(c=>c.id===filter)?.label ?? "All instances"} options={["All instances", ...choices.map(c=>c.label)]} onChange={v=>{setFilter(choices.find(c=>c.label===v)?.id ?? "");setLimit(24);}} /><button className="shelf-refresh" onClick={()=>void refresh()} disabled={refreshing} aria-label="Refresh screenshots" title="Refresh screenshots"><RefreshCw size={18} className={refreshing ? "spin" : ""} /></button>
      <div className="shelf-comparison-toolbar"><button ref={compareTrigger} type="button" className={showCancel ? "shelf-compare-cancel" : selecting ? "shelf-compare-launch" : ""}
        disabled={!selecting ? loading || shots.length < 2 : selectedShots.length === 2 && loading}
        aria-label={showCancel ? "Cancel comparison" : undefined} aria-describedby={selecting ? comparisonStatusId : undefined}
        onPointerEnter={event => { if (event.pointerType !== "touch") setCancelHovered(true); }} onPointerLeave={() => setCancelHovered(false)}
        onFocus={event => setCancelFocused(event.currentTarget.matches(":focus-visible"))} onBlur={() => setCancelFocused(false)}
        onClick={() => {
          if (!selecting) { setSelecting(true); setCancelHovered(false); setCancelFocused(false); }
          else if (selectedShots.length < 2) cancelSelection();
          else if (!loading) setComparing(true);
        }}>
        <ToolbarIconSwap active={showCancel} resting={<ArrowLeftRight size={17} />} engaged={<X size={17} strokeWidth={2.5} />} />
        <span key={compareLabel} className="toolbar-copy">{compareLabel}</span>
      </button></div>
      <span id={comparisonStatusId} className="shelf-selection-status" role="status">{selecting ? `${selectedShots.length} of 2 screenshots selected. ${selectedShots.length < 2 ? "Activate this button to cancel selection, or press Escape." : "Ready to compare."}` : ""}</span>
    </div></div></div>
    {warnings.length > 0 && <details><summary>Some folders could not be read</summary>{warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
    {loading ? <div className="shelf-empty" role="status"><RefreshCw className="spin" />Loading screenshots…</div> : error ? <div className="shelf-empty"><ImageIcon size={40} /><h2>Screenshots unavailable</h2><p>Use refresh to try again.</p></div> : !filtered.length ? <div className="shelf-empty"><ImageIcon size={40} /><h2>No screenshots yet</h2><p>Take a screenshot in Minecraft with F2, then refresh.</p></div> : <div className="shelf-grid">{filtered.slice(0,limit).map(shot=><article key={`${shot.instanceId}/${shot.name}`} className={selecting && selected.includes(shotKey(shot)) ? "comparison-selected" : ""}><button className="shelf-thumbnail" onPointerEnter={() => { void screenshotImages.get(shot, "preview", 150).catch(() => {}); }} onFocus={() => { void screenshotImages.get(shot, "preview", 150).catch(() => {}); }} onClick={()=>selecting ? toggleShot(shot) : setPreview(shot)} disabled={selecting && selectedShots.length === 2 && !selected.includes(shotKey(shot))} aria-pressed={selecting ? selected.includes(shotKey(shot)) : undefined} aria-label={`${selecting ? "Select" : "Preview"} ${shot.name} from ${shot.instanceName}${selecting ? " for comparison" : ""}`}><ScreenshotImage shot={shot} />{selecting && <span className={`shelf-selection-mark ${selected.includes(shotKey(shot)) ? "selected" : ""}`} aria-hidden="true">{selected.includes(shotKey(shot)) ? <><Check size={13} />{selected.indexOf(shotKey(shot)) === 0 ? "A" : "B"}</> : null}</span>}</button><footer><div className="shelf-caption"><strong title={`${shot.instanceName} — ${shot.name}`}>{shot.instanceName}</strong><small title={shot.modified ? new Date(shot.modified).toLocaleString() : undefined}>{shot.modified ? shotDate(shot.modified) : "Unknown date"}</small></div><div className="shelf-card-actions"><button disabled={busy} onClick={()=>void run(shot,"copy")} aria-label={`Copy image ${shot.name}`} title="Copy image"><Copy size={16} /></button><button disabled={busy} onClick={()=>void run(shot,"folder")} aria-label={`Open screenshot folder for ${shot.instanceName}`} title="Open folder"><FolderOpen size={17} /></button></div></footer></article>)}</div>}
    {!loading && filtered.length > limit && <button className="shelf-more" onClick={()=>setLimit(v=>v+24)}>Show more</button>}
    {comparing && selectedShots.length === 2 && <ScreenshotComparison shots={[selectedShots[0], selectedShots[1]]} loadImage={loadComparisonImage} initialImages={(() => { const a = screenshotImages.peek(selectedShots[0], "preview"), b = screenshotImages.peek(selectedShots[1], "preview"); return a && b ? [a, b] : undefined; })()} close={() => setComparing(false)} exportImage={exportComparison} />}
    {preview && <Preview shot={preview} close={()=>setPreview(null)} />}
  </div>;
}
