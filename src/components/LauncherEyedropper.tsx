import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const cells = 11;
const middle = Math.floor(cells / 2);

type Props = {
  start: { x: number; y: number };
  onPick: (hex: string) => void;
  onCancel: () => void;
  onError: () => void;
};

export function LauncherEyedropper({ start, onPick, onCancel, onError }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLCanvasElement>(null);
  const pointer = useRef(start);
  const pendingClick = useRef<{ x: number; y: number } | null>(null);
  const [frame, setFrame] = useState<HTMLImageElement>();
  const handlers = useRef({ onCancel, onError });
  handlers.current = { onCancel, onError };

  useEffect(() => {
    let active = true;
    // Let the picker disappear before freezing the composited WebGL skin and the rest of the viewport.
    let paint = requestAnimationFrame(() => { paint = requestAnimationFrame(async () => {
      try {
        const data = await invoke<string>("capture_picker_view");
        if (!active) return;
        if (!data) throw new Error("Empty launcher capture");
        const image = new Image();
        image.src = "data:image/png;base64," + data;
        await image.decode();
        if (active) setFrame(image);
      } catch { if (active) handlers.current.onError(); }
    }); });
    const cancel = () => handlers.current.onCancel();
    window.addEventListener("resize", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      active = false;
      cancelAnimationFrame(paint);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("blur", cancel);
    };
  }, []);

  function magnify(x: number, y: number) {
    pointer.current = { x, y };
    const bounds = surface.current?.getBoundingClientRect();
    const canvas = lens.current;
    if (!bounds || !canvas || !frame || !bounds.width || !bounds.height) return;
    const px = Math.min(frame.width - 1, Math.max(0, Math.floor((x - bounds.left) * frame.width / bounds.width)));
    const py = Math.min(frame.height - 1, Math.max(0, Math.floor((y - bounds.top) * frame.height / bounds.height)));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, cells, cells);
    ctx.drawImage(frame, px - middle, py - middle, cells, cells, 0, 0, cells, cells);
    const box = canvas.parentElement!;
    box.style.left = ((x - bounds.left) / bounds.width * 100) + "%";
    box.style.top = ((y - bounds.top) / bounds.height * 100) + "%";
    box.dataset.right = String(x - bounds.left < box.offsetWidth + 14);
    box.dataset.below = String(y - bounds.top < box.offsetHeight + 14);
    return ctx;
  }

  function pick(x: number, y: number) {
    const ctx = magnify(x, y);
    if (!ctx) { pendingClick.current = { x, y }; return; }
    const rgb = ctx.getImageData(middle, middle, 1, 1).data;
    onPick("#" + Array.from(rgb.subarray(0, 3), channel => channel.toString(16).padStart(2, "0")).join(""));
  }
  useLayoutEffect(() => {
    if (!frame) return;
    const click = pendingClick.current;
    if (click) { pendingClick.current = null; pick(click.x, click.y); }
    else magnify(pointer.current.x, pointer.current.y);
  }, [frame]);
  useLayoutEffect(() => { surface.current?.focus({ preventScroll: true }); }, []);
  return <div className="launcher-eyedropper" ref={surface} tabIndex={-1}
    role="dialog" aria-label="Pick a pixel. Escape cancels."
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      if (event.key === "Tab") event.preventDefault();
    }}
    onPointerMove={event => magnify(event.clientX, event.clientY)}
    onPointerDown={event => event.preventDefault()}
    onClick={event => {
      event.stopPropagation();
      pick(event.clientX, event.clientY);
    }}>
    {frame && <><img className="eyedropper-frame" alt="" src={frame.src} draggable={false}/>
      <div className="eyedropper-lens" aria-hidden="true"><canvas ref={lens} width={cells} height={cells}/></div></>}
  </div>;
}
