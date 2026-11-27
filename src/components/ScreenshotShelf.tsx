import { FolderOpenIcon as FolderOpen } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { invoke } from "../services/invoke";
import { ArrowsLeftRightIcon as ArrowLeftRight, CopyIcon as Copy, ImageSquareIcon as ImageIcon, ArrowsClockwiseIcon as RefreshCw, XIcon as X } from "@phosphor-icons/react";
import { DotsThreeIcon as MoreHorizontal } from "@phosphor-icons/react";
import { FilterMenu } from "./FilterMenu";
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
  return !modified || Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
type ShotAction = (shot: Shot, operation: "copy" | "folder") => void;
function PhotoActions({ shot, busy, run }: { shot: Shot; busy: boolean; run: ShotAction }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  function choose(operation: "copy" | "folder") {
    setOpen(false);
    anchor.current?.focus();
    run(shot, operation);
  }
  return <div className="shot-actions">
    <button ref={anchor} aria-label={`Actions for ${shot.name}`} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}><MoreHorizontal size={18}/></button>
    {open && <FilterMenu anchor={anchor} id={id} title="Screenshot actions" onClose={() => setOpen(false)}>
      <button role="menuitem" onClick={() => choose("copy")}><Copy size={16}/>Copy image</button>
      <button role="menuitem" onClick={() => choose("folder")}><FolderOpen size={16}/>Open folder</button>
    </FilterMenu>}
  </div>;
}
function Preview({ shot, close, run, busy }: { shot: Shot; close: () => void; run: ShotAction; busy: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="shot-viewer" aria-labelledby="shot-viewer-title" onClose={close} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  }}>
    <header>
      <div className="shot-viewer-identity"><h2 id="shot-viewer-title" title={shot.name}>{shot.name}</h2><small>{shot.instanceName} · {shotDate(shot.modified)}</small></div>
      <div className="shot-viewer-actions">
        <button disabled={busy} aria-label="Copy image" title="Copy image" onClick={() => run(shot,"copy")}><Copy size={17}/></button>
        <button disabled={busy} aria-label="Open folder" title="Open folder" onClick={() => run(shot,"folder")}><FolderOpen size={17}/></button>
        <span className="shot-viewer-divider" aria-hidden="true"/>
        <button aria-label="Close preview" title="Close preview" onClick={close}><X size={19}/></button>
      </div>
    </header>
    <div className="shot-stage" onLoadCapture={event => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.naturalHeight) {
        ref.current?.style.setProperty("--shot-aspect", String(image.naturalWidth / image.naturalHeight));
      }
    }}><ScreenshotImage shot={shot} preview /></div>
  </dialog>;
}
export function ScreenshotShelf({ filter, libraryName, onMessage }: { filter: string; libraryName: string; onMessage: (message: string, kind?: "notification" | "error") => void }) {
  const [shots, setShots] = useState<Shot[]>(() => cachedScreenshotShelf()?.items || []);
  const [limit, setLimit] = useState(24);
  useEffect(() => setLimit(24), [filter]);
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
  const cancelSelection = () => { setComparing(false); setSelecting(false); setSelected([]); setCancelHovered(false); setCancelFocused(false); compareTrigger.current?.focus(); };
  useEffect(() => {
    if (!selecting || comparing || preview) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
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
  const filtered = shots.filter(s => !filter || s.instanceId === filter).sort((a, b) => b.modified - a.modified);
  const groups = new Map<string, Shot[]>();
  const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });
  for (const shot of filtered.slice(0, limit)) {
    const day = shot.modified && Number.isFinite(new Date(shot.modified).getTime()) ? dateLabel.format(shot.modified) : "Unknown date";
    const group = groups.get(day);
    if (group) group.push(shot);
    else groups.set(day, [shot]);
  }
  useEffect(() => {
    const visible = filtered.slice(0, limit);
    screenshotImages.prefer(visible);
    warmScreenshots(visible, 50);
  }, [shots, filter, limit]);
  async function run(shot: Shot, operation: string) {setBusy(true);try {await action(shot, operation);if (operation === "copy") onMessage("Image copied to clipboard.");}catch(e){onMessage(String(e), "error");}finally{setBusy(false);}}
  async function exportComparison(render: () => Promise<string>) {
    try {
      const png = await render();
      await invoke("save_screenshot_comparison", { png });
    } catch (error) { onMessage(String(error), "error"); }
  }
  return <section className="shot-library"><header className="shot-library-heading">
    <h1>{libraryName}</h1>
    <div className="shot-tools"><button className="shelf-refresh" onClick={()=>void refresh()} disabled={refreshing} aria-label="Refresh screenshots" title="Refresh screenshots"><RefreshCw size={18} className={refreshing ? "spin" : ""} /></button>
      {selecting && selectedShots.length === 2 && <button type="button" onClick={cancelSelection}>Cancel</button>}
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
        <ToolbarIconSwap active={showCancel} resting={<ArrowLeftRight size={17} />} engaged={<X size={17} weight="bold" />} />
        <span key={compareLabel} className="toolbar-copy">{compareLabel}</span>
      </button></div>
      <span id={comparisonStatusId} className="shelf-selection-status" role="status">{selecting ? `${selectedShots.length} of 2 screenshots selected. ${selectedShots.length < 2 ? "Activate this button to cancel selection, or press Escape." : "Ready to compare."}` : ""}</span>
    </div></header>
    {warnings.length > 0 && <details><summary>Some folders could not be read</summary>{warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
    {loading ? <div className="shelf-empty" role="status"><RefreshCw className="spin" />Loading screenshots…</div> : error ? <div className="shelf-empty"><ImageIcon size={40} /><h2>Screenshots unavailable</h2><p>Use refresh to try again.</p></div> : !filtered.length ? <div className="shelf-empty"><ImageIcon size={40} /><h2>No screenshots yet</h2><p>Take a screenshot in Minecraft with F2, then refresh.</p></div> : Array.from(groups, ([day, items]) =>
      <section className="shot-day" key={day}>
        <h2>{day}</h2>
        <div className="shelf-grid">{items.map(shot => {
          const key = shotKey(shot);
          const index = selected.indexOf(key);
          const chosen = selecting && index >= 0;
          const warm = () => { void screenshotImages.get(shot, "preview", 150).catch(() => {}); };
          return <article key={key} className={chosen ? "comparison-selected" : undefined}>
            <button className="shelf-thumbnail" onPointerEnter={warm} onFocus={warm}
              onClick={() => selecting ? toggleShot(shot) : setPreview(shot)}
              disabled={selecting && selectedShots.length === 2 && !chosen}
              aria-pressed={selecting ? chosen : undefined}
              aria-label={`${selecting ? "Select" : "Preview"} ${shot.name} from ${shot.instanceName}${selecting ? " for comparison" : ""}`}>
              <ScreenshotImage shot={shot}/>
              {chosen && <span className="shot-letter shelf-selection-mark" aria-hidden="true">{index === 0 ? "A" : "B"}</span>}
            </button>
            <footer><div className="shelf-caption">
              <strong title={shot.name}>{shot.name}</strong>
              <small>{shot.instanceName}{shot.modified ? " · " + new Date(shot.modified).toLocaleTimeString(undefined, {hour:"numeric", minute:"2-digit"}) : ""}</small>
            </div><PhotoActions shot={shot} busy={busy} run={run}/></footer>
          </article>;
        })}</div>
      </section>)}

    {!loading && filtered.length > limit && <button className="shelf-more" onClick={()=>setLimit(v=>v+24)}>Show more</button>}
    {comparing && selectedShots.length === 2 && <ScreenshotComparison shots={[selectedShots[0], selectedShots[1]]} loadImage={loadComparisonImage} initialImages={(() => { const a = screenshotImages.peek(selectedShots[0], "preview"), b = screenshotImages.peek(selectedShots[1], "preview"); return a && b ? [a, b] : undefined; })()} close={() => setComparing(false)} cancel={cancelSelection} exportImage={exportComparison} />}
    {preview && <Preview shot={preview} busy={busy} run={run} close={()=>setPreview(null)} />}
  </section>;
}
