import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { FolderInput } from "lucide-react";

export type FolderDragItem = { id: string; name: string; icon?: string | null };
export function useInstanceFolderDrag(onDrop: (item: FolderDragItem, target: string) => void, disabled: boolean) {
  const [item, setItem] = useState<FolderDragItem | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = useRef<(() => void) | null>(null);
  const latest = useRef(onDrop); latest.current = onDrop;
  useEffect(() => () => cancel.current?.(), []);
  const start = (event: ReactPointerEvent, value: FolderDragItem) => {
    if (disabled || event.button !== 0 || !event.isPrimary || (event.target as Element).closest("button,input,select,textarea,a")) return;
    cancel.current?.();
    const row = event.currentTarget as HTMLElement;
    const root = row.closest<HTMLElement>(".instance-folders-grid")!;
    const startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
    let x = startX, y = startY, active = false, frame = 0;
    let target: HTMLElement | null = null;
    const prevent = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const clear = (waitForRelease = false) => {
      if (active) {
        const remove = () => { window.removeEventListener("click", consume, true); window.removeEventListener("pointerup", release); window.removeEventListener("pointerdown", remove, true); window.removeEventListener("blur", remove); };
        const consume = (e: Event) => { prevent(e); remove(); };
        const release = () => setTimeout(remove, 0);
        window.addEventListener("click", consume, true);
        if (waitForRelease) { window.addEventListener("pointerup", release, { once: true }); window.addEventListener("pointerdown", remove, { once: true, capture: true }); window.addEventListener("blur", remove, { once: true }); }
        else release();
      }
      cancelAnimationFrame(frame); target?.removeAttribute("data-folder-drop-active"); row.removeAttribute("data-folder-dragging");
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", abort); window.removeEventListener("blur", abort); window.removeEventListener("keydown", key, true); document.removeEventListener("visibilitychange", hidden); document.removeEventListener("dragstart", prevent, true);
      cancel.current = null; setItem(null);
    };
    const hit = () => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-instance-folder-drop]") || null;
      return element && root.contains(element) && element.dataset.instanceFolderDrop !== `instance:${value.id}` ? element : null;
    };
    const paint = () => {
      const next = hit();
      if (target !== next) { target?.removeAttribute("data-folder-drop-active"); target = next; target?.setAttribute("data-folder-drop-active", "true"); }
      if (ghost.current) {
        ghost.current.style.transform = `translate3d(${Math.min(x + 16, window.innerWidth - 248)}px,${Math.min(y + 16, window.innerHeight - 72)}px,0)`;
        const label = ghost.current.querySelector("small");
        if (label) label.textContent = target?.dataset.folderDropLabel || "Drop onto a folder or another instance";
      }
      const bounds = root.getBoundingClientRect();
      if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        root.scrollTop += y < bounds.top + 36 ? (y - bounds.top - 36) / 5 : y > bounds.bottom - 36 ? (y - bounds.bottom + 36) / 5 : 0;
      }
      frame = requestAnimationFrame(paint);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX; y = e.clientY;
      if (!active && Math.hypot(x - startX, y - startY) >= 8) {
        active = true; origin.current = { x: x + 16, y: y + 16 }; setItem(value); row.setAttribute("data-folder-dragging", "true");
        document.addEventListener("dragstart", prevent, true); frame = requestAnimationFrame(paint);
      }
      if (active) e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      x = e.clientX; y = e.clientY;
      const destination = active ? hit()?.dataset.instanceFolderDrop : undefined;
      if (active) e.preventDefault();
      clear(); if (destination) latest.current(value, destination);
    };
    const abort = () => clear(true);
    const hidden = () => { if (document.hidden) abort(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { prevent(e); clear(true); } };
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", abort); window.addEventListener("blur", abort); window.addEventListener("keydown", key, true); document.addEventListener("visibilitychange", hidden);
    cancel.current = abort;
  };
  return { start, dragging: item, overlay: item ? createPortal(<div className="instance-folder-ghost" ref={ghost} style={{ transform: `translate3d(${origin.current.x}px,${origin.current.y}px,0)` }} aria-hidden="true"><span>{item.icon ? <img src={item.icon} alt="" /> : <b>?</b>}</span><div><strong>{item.name}</strong><small>Drop onto a folder or another instance</small></div><FolderInput size={17} /></div>, document.body) : null };
}
