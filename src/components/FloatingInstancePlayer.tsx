import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { GripHorizontal, Minimize2, Play } from "lucide-react";
import "./floating-instance-player.css";

type Box = { x: number; y: number; width: number };
type Bounds = { left: number; right: number; top: number; bottom: number };
const STORAGE = "bloom-floating-player-layout-v1";
const MIN = 56, MAX = 480;
const fraction = (n: number) => Math.max(0, Math.min(1, n));
const height = (width: number) => 56 + 8 * fraction((width - MIN) / 240);
const motion = () => document.documentElement.dataset.animations === "on"
  && document.documentElement.dataset.performance !== "ultra" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
function bounds(): Bounds {
  const content = document.querySelector("main.content")?.getBoundingClientRect();
  return { left: (content?.left ?? 0) + 16, right: (content?.right ?? innerWidth) - 16,
    top: 78, bottom: innerHeight - 18 };
}
function clamp(box: Box, area = bounds()): Box {
  const width = Math.max(MIN, Math.min(MAX, box.width, area.right - area.left));
  return { width, x: Math.max(area.left, Math.min(box.x, area.right - width)),
    y: Math.max(area.top, Math.min(box.y, area.bottom - height(width))) };
}
function restore(): Box {
  const area = bounds();
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (value && [value.x, value.y, value.width].every(n => typeof n === "number" && Number.isFinite(n))) return clamp(value, area);
  } catch { /* An unavailable preference must not block launching. */ }
  const width = Math.min(360, area.right - area.left);
  return clamp({ x: (area.left + area.right - width) / 2, y: area.bottom - height(width), width }, area);
}
function save(box: Box) { try { localStorage.setItem(STORAGE, JSON.stringify(box)); } catch { /* Optional local preference. */ } }

export function FloatingInstancePlayer({ instance, busy, onPlay, onClose }: {
  instance: { id: string; name: string; icon?: string | null }; busy: boolean; onPlay: () => void; onClose: () => void;
}) {
  const [box, setBox] = useState(restore);
  const [gesture, setGesture] = useState(false);
  const target = useRef(box), drawn = useRef(box), frame = useRef(0), previousTime = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const cancel = useRef<(() => void) | null>(null);
  const update = (next: Box, immediate = false) => {
    target.current = clamp(next);
    if (immediate || !motion()) {
      cancelAnimationFrame(frame.current); frame.current = 0;
      drawn.current = target.current; setBox(target.current); return;
    }
    if (frame.current) return;
    previousTime.current = performance.now();
    const tick = (now: number) => {
      const step = motion() ? 1 - Math.exp(-Math.min(64, now - previousTime.current) / 32) : 1;
      previousTime.current = now;
      const current = drawn.current, to = target.current;
      const distance = Math.abs(to.x - current.x) + Math.abs(to.y - current.y) + Math.abs(to.width - current.width);
      const next = distance < .15 ? to : { x: current.x + (to.x - current.x) * step,
        y: current.y + (to.y - current.y) * step, width: current.width + (to.width - current.width) * step };
      drawn.current = next; setBox(next);
      frame.current = distance < .15 ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useLayoutEffect(() => {
    const reflow = () => { cancel.current?.(); update(target.current, true); save(target.current); };
    const observer = new ResizeObserver(reflow);
    const content = document.querySelector("main.content");
    if (content) observer.observe(content);
    window.addEventListener("resize", reflow);
    return () => { observer.disconnect(); window.removeEventListener("resize", reflow); cancel.current?.(); cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(() => {
    // Opening from another instance replaces the target without creating a second widget.
    cancel.current?.();
  }, [instance.id]);

  const begin = (event: ReactPointerEvent, mode: "move" | "resize") => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (mode === "move" && (event.target as Element).closest("button,[role=separator]")) return;
    event.preventDefault(); event.stopPropagation(); cancel.current?.();
    const element = event.currentTarget as HTMLElement;
    const start = { ...drawn.current }, px = event.clientX, py = event.clientY, id = event.pointerId;
    update(start, true); element.setPointerCapture(id); setGesture(true);
    let finished = false;
    const finish = (revert = false) => {
      if (finished) return; finished = true;
      if (revert) update(start);
      save(target.current); setGesture(false);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", abort);
      element.removeEventListener("lostpointercapture", abort);
      window.removeEventListener("keydown", key, true); window.removeEventListener("blur", abort);
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      cancel.current = null;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (mode === "move") update({ ...start, x: start.x + e.clientX - px, y: start.y + e.clientY - py });
      else update({ ...start, width: Math.min(bounds().right - start.x, Math.max(MIN, start.width + e.clientX - px)) });
    };
    const up = (e: PointerEvent) => { if (e.pointerId === id) { move(e); finish(); } };
    const abort = () => finish(true);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(true); } };
    element.addEventListener("pointermove", move); element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", abort); element.addEventListener("lostpointercapture", abort);
    window.addEventListener("keydown", key, true); window.addEventListener("blur", abort); cancel.current = abort;
  };
  const details = fraction((box.width - 100) / 100), art = fraction((box.width - 210) / 90), label = fraction((box.width - 80) / 90);
  const style = { transform: `translate3d(${box.x}px, ${box.y}px, 0)`, width: box.width, height: height(box.width),
    "--float-art": `${40 * art}px`, "--float-art-opacity": art, "--float-detail-opacity": details,
    "--float-gap": `${10 * details}px`, "--float-play-width": `${44 + 50 * label}px`, "--float-label-width": `${38 * label}px`, "--float-label-opacity": label } as CSSProperties;
  return <div ref={root} className="floating-instance-player" role="region" aria-label={`Floating Play controls for ${instance.name}`}
    data-gesture={gesture} style={style} onPointerDown={event => begin(event, "move")}>
    <div className="floating-player-tools">
      <div role="button" tabIndex={0} className="floating-player-move" aria-label="Move floating controls" title="Drag to move · Arrow keys to position"
        onPointerDown={e => begin(e, "move")} onKeyDown={e => {
          const delta = e.shiftKey ? 40 : 10;
          const direction = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }[e.key];
          if (direction) { e.preventDefault(); update({ ...target.current, x: target.current.x + direction[0], y: target.current.y + direction[1] }); save(target.current); }
        }}><GripHorizontal size={17} /></div>
      <button className="floating-player-return" aria-label="Put away floating controls" title="Put away floating controls" onClick={onClose}><Minimize2 size={15} /></button>
    </div>
    <div className="floating-player-body">
      <span className="floating-player-art" aria-hidden="true">{instance.icon ? <img src={instance.icon} alt="" draggable={false} /> : <b>?</b>}</span>
      <span className="floating-player-identity" title={instance.name}><strong>{instance.name}</strong></span>
      <button className="floating-player-play instance-play" disabled={busy} onClick={onPlay} aria-label={`Play ${instance.name}`} title={`Play ${instance.name}`}><Play size={17} fill="currentColor" /><span>Play</span></button>
    </div>
    <div role="separator" tabIndex={0} aria-label="Resize floating controls" aria-orientation="vertical" aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={Math.round(box.width)}
      className="floating-player-resize" title="Drag to resize · Left/Right arrows · Home for icon only" onPointerDown={e => begin(e, "resize")}
      onKeyDown={e => {
        const width = e.key === "Home" ? MIN : e.key === "End" ? 360 : e.key === "ArrowLeft" ? target.current.width - 20 : e.key === "ArrowRight" ? target.current.width + 20 : null;
        if (width !== null) { e.preventDefault(); update({ ...target.current, width }); save(target.current); }
      }} />
  </div>;
}
