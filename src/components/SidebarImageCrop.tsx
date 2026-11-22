import { useLayoutEffect, useRef, useState } from "react";

export type SidebarCrop = { x: number; y: number; zoom: number };
export const defaultSidebarCrop: SidebarCrop = { x: .5, y: .5, zoom: 1 };

type Size = { width: number; height: number };
type Props = {
  source: string;
  natural: Size;
  rail: HTMLElement;
  initial: SidebarCrop;
  busy: boolean;
  error: string;
  onApply: (crop: SidebarCrop) => void;
  onClose: () => void;
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const photoOffset = (position: number, travel: number) => travel > .01 ? clamp(position / travel) : .5;

export function SidebarImageCrop({ source, natural, rail, initial, busy, error, onApply, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number }>(null);
  const [crop, setCrop] = useState(initial);
  const [layout, setLayout] = useState({ left: 0, top: 0, width: 0, height: 0, photoWidth: 0, photoHeight: 0 });

  useLayoutEffect(() => {
    const surface = dialog.current!;
    const canvas = stage.current!;
    if (!surface.open) surface.showModal();
    canvas.focus();
    const measure = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = rail.clientWidth / rail.clientHeight;
      const scale = Math.min(width * .88 / natural.width, height * .88 / natural.height);
      const photoWidth = natural.width * scale, photoHeight = natural.height * scale;
      const frameHeight = Math.min(photoHeight, photoWidth / ratio);
      const frameWidth = frameHeight * ratio;
      setLayout({ left: (width - frameWidth) / 2, top: (height - frameHeight) / 2,
        width: frameWidth, height: frameHeight, photoWidth, photoHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [natural, rail]);

  function pan(dx: number, dy: number) {
    setCrop(current => {
      const travelX = layout.photoWidth * current.zoom - layout.width;
      const travelY = layout.photoHeight * current.zoom - layout.height;
      return { ...current, x: photoOffset(travelX * current.x - dx, travelX), y: photoOffset(travelY * current.y - dy, travelY) };
    });
  }

  useLayoutEffect(() => {
    const canvas = stage.current!;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (busy) return;
      const bounds = canvas.getBoundingClientRect();
      const anchorX = clamp(event.clientX - bounds.left - layout.left, 0, layout.width);
      const anchorY = clamp(event.clientY - bounds.top - layout.top, 0, layout.height);
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      zoomAt(Math.exp(-clamp(delta, -210, 210) * .0025), anchorX, anchorY);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [layout, busy]);

  function zoomAt(factor: number, anchorX = layout.width / 2, anchorY = layout.height / 2) {
    setCrop(current => {
      const zoom = clamp(current.zoom * factor, 1, 5);
      if (zoom === current.zoom) return current;
      const travelX = layout.photoWidth * current.zoom - layout.width;
      const travelY = layout.photoHeight * current.zoom - layout.height;
      return { zoom,
        x: photoOffset((travelX * current.x + anchorX) * zoom / current.zoom - anchorX, layout.photoWidth * zoom - layout.width),
        y: photoOffset((travelY * current.y + anchorY) * zoom / current.zoom - anchorY, layout.photoHeight * zoom - layout.height),
      };
    });
  }

  const width = layout.photoWidth * crop.zoom, height = layout.photoHeight * crop.zoom;
  return <dialog ref={dialog} className="sidebar-crop-dialog" aria-labelledby="sidebar-crop-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header>
      <h2 id="sidebar-crop-title">Adjust Sidebar Image</h2>
      <p id="sidebar-crop-help">Drag to position. Scroll to zoom.</p>
    </header>
    <div ref={stage} className="sidebar-crop-stage" tabIndex={0}
      aria-label="Crop preview. Use arrow keys to move and plus or minus to zoom." aria-describedby="sidebar-crop-help"
      onPointerDown={event => {
        if (busy || event.button !== 0 || pointer.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={event => {
        const start = pointer.current;
        if (start?.id !== event.pointerId) return;
        pan(event.clientX - start.x, event.clientY - start.y);
        pointer.current = { id: start.id, x: event.clientX, y: event.clientY };
      }}
      onLostPointerCapture={() => { pointer.current = null; }}
      onKeyDown={event => {
        if (busy) return;
        const steps: Record<string, [number, number]> = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
        const step = steps[event.key];
        if (step) pan(...step);
        else if (event.key === "+" || event.key === "=") zoomAt(1.15);
        else if (event.key === "-") zoomAt(1 / 1.15);
        else return;
        event.preventDefault();
      }}>
      <img src={source} alt="" draggable={false} style={{ width, height,
        left: layout.left - (width - layout.width) * crop.x, top: layout.top - (height - layout.height) * crop.y }} />
      <div className="sidebar-crop-frame" aria-hidden="true"
        style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height }} />
    </div>
    {error && <p className="sidebar-crop-error" role="alert">{error}</p>}
    <footer>
      <button type="button" onClick={() => setCrop(defaultSidebarCrop)} disabled={busy}>Reset</button>
      <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="sidebar-crop-apply" onClick={() => onApply(crop)} disabled={busy}>{busy ? "Saving…" : "Apply"}</button>
    </footer>
  </dialog>;
}
