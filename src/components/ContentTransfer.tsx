import { createContext, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Copy, PackageOpen, X } from "lucide-react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import "./content-transfer.css";

type Category = "mods" | "resourcepacks" | "shaderpacks";
type Destination = { id: string; name: string; version: string; loader: string };
type Content = { sourceId: string; category: Category; fileName: string; name: string; icon?: string | null; enabled: boolean };
type Preview = { fingerprint: string; verified: boolean; message: string };
type Pending = { content: Content; target?: Destination; preview?: Preview; error?: string; checking?: boolean };
type TransferControls = {
  start: (event: ReactPointerEvent, content: Content) => void;
  choose: (content: Content) => void;
};
export const ContentTransferContext = createContext<TransferControls>({ start: () => {}, choose: () => {} });
export const useContentTransfer = () => useContext(ContentTransferContext);

export function useContentTransferController(
  instances: Destination[],
  onCopied: (targetId: string, category: Category, message: string) => void,
) {
  const [dragging, setDragging] = useState<Content | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [copying, setCopying] = useState(false);
  const ghost = useRef<HTMLDivElement>(null);
  const ghostOrigin = useRef({ x: 0, y: 0 });
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const copyInFlight = useRef(false);
  const latest = useRef({ instances, onCopied });
  latest.current = { instances, onCopied };

  useEffect(() => () => { cancelDrag.current?.(); generation.current++; }, []);
  useEffect(() => {
    if (pending && !dialog.current?.open) dialog.current?.showModal();
  }, [pending]);

  const close = () => {
    if (copyInFlight.current) return;
    generation.current++;
    setPending(null);
  };
  const review = async (content: Content, target: Destination) => {
    const sequence = ++generation.current;
    setPending({ content, target, checking: true });
    try {
      const preview = await invoke<Preview>("preview_content_transfer", {
        request: { sourceId: content.sourceId, targetId: target.id, category: content.category, fileName: content.fileName },
      });
      if (sequence === generation.current) setPending({ content, target, preview });
    } catch (error) {
      if (sequence === generation.current) setPending({ content, target, error: userError(error) });
    }
  };
  const choose = (content: Content) => {
    cancelDrag.current?.();
    generation.current++;
    setPending({ content });
  };
  const copy = async () => {
    if (!pending?.target || !pending.preview || copyInFlight.current) return;
    const { content, target, preview } = pending;
    copyInFlight.current = true;
    setCopying(true);
    try {
      await invoke("copy_instance_content", {
        request: { sourceId: content.sourceId, targetId: target.id, category: content.category, fileName: content.fileName },
        fingerprint: preview.fingerprint,
        allowUnverified: !preview.verified,
      });
      latest.current.onCopied(target.id, content.category, `Copied ${content.name} to ${target.name}.`);
      setPending(null);
    } catch (error) {
      setPending({ content, target, error: userError(error) });
    } finally {
      copyInFlight.current = false;
      setCopying(false);
    }
  };

  const start = (event: ReactPointerEvent, content: Content) => {
    if (event.button !== 0 || !event.isPrimary || pending || copyInFlight.current) return;
    cancelDrag.current?.();
    const row = event.currentTarget.closest<HTMLElement>(".installed-content-item");
    const startX = event.clientX, startY = event.clientY, pointerId = event.pointerId;
    let x = startX, y = startY, active = false, frame = 0;
    let target: HTMLElement | null = null;
    const suppressClick = (click: Event) => { click.preventDefault(); click.stopImmediatePropagation(); };
    const clear = (waitForRelease = false) => {
      if (active) {
        // Escape/pointer cancellation can still be followed by the browser's click.
        // Consume that click as well as the normal drop click, so it cannot open details.
        const remove = () => {
          window.removeEventListener("click", consume, true);
          window.removeEventListener("pointerup", release);
          window.removeEventListener("pointerdown", remove, true);
          window.removeEventListener("blur", remove);
        };
        const consume = (click: Event) => { suppressClick(click); remove(); };
        const release = () => window.setTimeout(remove, 0);
        window.addEventListener("click", consume, true);
        if (waitForRelease) {
          window.addEventListener("pointerup", release, { once: true });
          window.addEventListener("pointerdown", remove, { once: true, capture: true });
          window.addEventListener("blur", remove, { once: true });
        } else release();
      }
      cancelAnimationFrame(frame);
      target?.removeAttribute("data-content-drop-active");
      row?.removeAttribute("data-content-dragging");
      document.documentElement.removeAttribute("data-content-transfer");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("blur", abort);
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("dragstart", suppressClick, true);
      cancelDrag.current = null;
      setDragging(null);
    };
    const abort = () => clear();
    const hidden = () => { if (document.hidden) clear(); };
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key === "Escape") { pressed.preventDefault(); pressed.stopImmediatePropagation(); clear(true); }
    };
    const paint = () => {
      const hit = document.elementFromPoint(x, y);
      const candidate = hit?.closest<HTMLElement>("[data-content-drop-id]") || null;
      const next = candidate?.dataset.contentDropId === content.sourceId ? null : candidate;
      if (next !== target) {
        target?.removeAttribute("data-content-drop-active");
        target = next;
        target?.setAttribute("data-content-drop-active", "true");
      }
      if (ghost.current) {
        ghost.current.style.transform = `translate3d(${Math.min(x + 18, window.innerWidth - 274)}px, ${Math.min(y + 14, window.innerHeight - 80)}px, 0)`;
        const label = ghost.current.querySelector("[data-transfer-label]");
        if (label) label.textContent = target ? `Copy to ${target.dataset.contentDropName}` : "Drop onto an instance";
      }
      const list = hit?.closest<HTMLElement>(".instance-list");
      if (list) {
        const bounds = list.getBoundingClientRect();
        const distance = y < bounds.top + 28 ? y - bounds.top - 28 : y > bounds.bottom - 28 ? y - bounds.bottom + 28 : 0;
        list.scrollTop += distance * .25;
      }
      frame = requestAnimationFrame(paint);
    };
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      x = moved.clientX; y = moved.clientY;
      if (!active && Math.hypot(x - startX, y - startY) >= 7) {
        active = true;
        ghostOrigin.current = { x: Math.min(x + 18, window.innerWidth - 274), y: Math.min(y + 14, window.innerHeight - 80) };
        setDragging(content);
        row?.setAttribute("data-content-dragging", "true");
        document.documentElement.setAttribute("data-content-transfer", "true");
        document.addEventListener("dragstart", suppressClick, true);
        frame = requestAnimationFrame(paint);
      }
      if (active) moved.preventDefault();
    };
    const up = (released: PointerEvent) => {
      if (released.pointerId !== pointerId) return;
      const destination = active ? document.elementFromPoint(released.clientX, released.clientY)?.closest<HTMLElement>("[data-content-drop-id]") : null;
      const selected = latest.current.instances.find(instance => instance.id === destination?.dataset.contentDropId && instance.id !== content.sourceId);
      if (active) {
        released.preventDefault();
      }
      clear();
      if (active && selected) void review(content, selected);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("blur", abort);
    window.addEventListener("keydown", key, true);
    document.addEventListener("visibilitychange", hidden);
    cancelDrag.current = clear;
  };

  const overlay = createPortal(<>
    {dragging && <div ref={ghost} className="content-transfer-ghost" style={{ transform: `translate3d(${ghostOrigin.current.x}px, ${ghostOrigin.current.y}px, 0)` }} aria-hidden="true">
      <span className="content-transfer-art">{dragging.icon ? <img src={dragging.icon} alt="" /> : <PackageOpen size={23} />}</span>
      <span><b>{dragging.name}</b><small data-transfer-label>Drop onto an instance</small></span><Copy size={15} />
    </div>}
    {pending && <dialog ref={dialog} className="content-transfer-dialog" aria-labelledby="content-transfer-title"
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="content-transfer-panel">
        <header><h2 id="content-transfer-title">{pending.target ? `Copy to ${pending.target.name}` : "Copy to instance"}</h2><button aria-label="Close copy dialog" disabled={copying} onClick={close}><X size={18} /></button></header>
        <div className="content-transfer-body">
          <div className="content-transfer-file"><span className="content-transfer-art">{pending.content.icon ? <img src={pending.content.icon} alt="" /> : <PackageOpen size={23} />}</span><span><b>{pending.content.name}</b><small>{pending.content.fileName}</small></span></div>
          {!pending.target ? <div className="content-transfer-targets">
            {instances.filter(instance => instance.id !== pending.content.sourceId).map(instance => <button key={instance.id} onClick={() => void review(pending.content, instance)}><span><b>{instance.name}</b><small>{instance.version} · {instance.loader}</small></span><ArrowRight size={16} /></button>)}
            {instances.every(instance => instance.id === pending.content.sourceId) && <p>Create another instance to copy content to it.</p>}
          </div> : <>
            <p className={pending.error ? "content-transfer-error" : ""} role={pending.error ? "alert" : "status"}>{copying ? "Copying…" : pending.checking ? "Checking compatibility…" : pending.error || pending.preview?.message}</p>
            {pending.preview && <small className="content-transfer-note">{pending.content.category === "mods" ? "Required mods aren’t copied automatically. " : pending.content.category === "shaderpacks" ? "A shader loader is needed in the destination. " : ""}{!pending.content.enabled ? "This copy will stay disabled." : ""}</small>}
          </>}
        </div>
        {pending.target && <footer><button disabled={copying} onClick={close}>Cancel</button><button className="content-transfer-confirm" disabled={!pending.preview || copying} onClick={() => void copy()}><Copy size={15} />{copying ? "Copying…" : pending.preview && !pending.preview.verified ? "Copy anyway" : `Copy to ${pending.target.name}`}</button></footer>}
      </div>
    </dialog>}
  </>, document.body);
  return { controls: { start, choose }, dragging: !!dragging, overlay };
}
