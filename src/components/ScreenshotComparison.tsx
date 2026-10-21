import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRightLeft, Download, RefreshCw, RotateCcw, X } from "lucide-react";
import { renderComparison } from "../services/comparison-export";
import "./screenshot-comparison.css";

export type ComparisonShot = { instanceId: string; instanceName: string; name: string; modified: number; revision?: string };
export function ScreenshotComparison({ shots, loadImage, initialImages, close, exportImage }: { shots: [ComparisonShot, ComparisonShot]; loadImage: (shot: ComparisonShot) => Promise<string>; initialImages?: [string, string]; close: () => void; exportImage: (render: () => Promise<string>) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [images, setImages] = useState<[string, string] | null>(initialImages || null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [position, setPosition] = useState(50);
  const [swapped, setSwapped] = useState(false);
  useEffect(() => {
    // Keep the original trigger across StrictMode's effect replay.
    if (!returnFocus.current) returnFocus.current = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { returnFocus.current?.focus(); };
  }, []);
  const [a, b] = shots;
  useEffect(() => {
    let active = true;
    if (!initialImages) setImages(null); setError("");
    Promise.all([loadImage(a), loadImage(b)]).then(result => { if (active) setImages(result); }).catch(() => {
      if (active) setError("One of these screenshots could not be loaded. It may have moved or been deleted.");
    });
    return () => { active = false; };
  }, [a.instanceId, a.name, a.modified, a.revision, b.instanceId, b.name, b.modified, b.revision, loadImage, attempt]);
  const ordered = swapped ? [b, a] : [a, b];
  const sources = images && (swapped ? [images[1], images[0]] : images);
  const exportCurrent = async () => {
    if (!sources || !canvas.current || exporting) return;
    const box = canvas.current.getBoundingClientRect();
    const background = getComputedStyle(canvas.current).backgroundColor;
    const divider = canvas.current.querySelector(".comparison-divider");
    const dividerColor = divider ? getComputedStyle(divider).backgroundColor : "#ffffff";
    const selected: [string, string] = [sources[0], sources[1]];
    setExporting(true);
    try { await exportImage(() => renderComparison(selected, position, box.width / box.height, background, dividerColor)); }
    finally { setExporting(false); }
  };
  const move = (element: HTMLDivElement, x: number) => {
    const box = element.getBoundingClientRect();
    if (box.width) setPosition(Math.max(0, Math.min(100, (x - box.left) / box.width * 100)));
  };
  return <dialog ref={dialog} className="screenshot-comparison" aria-labelledby="screenshot-comparison-title" onClose={close} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  }}>
    <header><h2 id="screenshot-comparison-title">Compare screenshots</h2><div className="comparison-actions"><button type="button" disabled={!sources || !!error || exporting} onClick={() => void exportCurrent()}><Download size={16} />{exporting ? "Exporting…" : "Export"}</button><button type="button" disabled={!sources || !!error} onClick={() => setSwapped(value => !value)} title="Swap screenshots"><ArrowRightLeft size={16} />Swap</button><button type="button" disabled={!sources || !!error} onClick={() => setPosition(50)} title="Center divider"><RotateCcw size={16} />Reset</button><button type="button" onClick={close} aria-label="Close comparison"><X size={20} /></button></div></header>
    {error ? <div className="comparison-state" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} />Try again</button></div> : !sources ? <div className="comparison-state" role="status"><RefreshCw className="spin" size={24} /><p>Loading screenshots…</p></div> : <div ref={canvas} className="comparison-canvas" style={{ "--comparison-position": `${position}%` } as CSSProperties} onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); handle.current?.focus(); event.currentTarget.setPointerCapture(event.pointerId); move(event.currentTarget, event.clientX);
    }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event.currentTarget, event.clientX); }}>
      <img className="comparison-image" src={sources[1]} alt={`Right: ${ordered[1].name}`} draggable={false} onError={() => setError("A screenshot could not be displayed. Try loading the comparison again.")} />
      <div className="comparison-left"><img className="comparison-image" src={sources[0]} alt={`Left: ${ordered[0].name}`} draggable={false} onError={() => setError("A screenshot could not be displayed. Try loading the comparison again.")} /></div>
      <span className="comparison-side comparison-side-left" aria-hidden="true">A</span><span className="comparison-side comparison-side-right" aria-hidden="true">B</span>
      <i className="comparison-divider" aria-hidden="true" />
      <button ref={handle} type="button" className="comparison-handle" role="slider" aria-label="Screenshot comparison divider" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position)} aria-valuetext={`${Math.round(position)}% left screenshot`} onKeyDown={event => {
        const step = event.shiftKey ? 10 : 1;
        const next = event.key === "Home" ? 0 : event.key === "End" ? 100 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? Math.max(0, position - step) : event.key === "ArrowRight" || event.key === "ArrowUp" ? Math.min(100, position + step) : null;
        if (next !== null) { event.preventDefault(); setPosition(next); }
      }}><span><ArrowRightLeft size={23} strokeWidth={2.4} /></span></button>
    </div>}
  </dialog>;
}
