import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChatCircleIcon as MessageCircle } from "@phosphor-icons/react";

export type SocialDockMode = "closed" | "pinned";

export function SocialDock({ mode, setMode, children }: {
  mode: SocialDockMode; setMode: (next: SocialDockMode) => void; children: ReactNode;
}) {
  const open = mode !== "closed";
  const [retained, setRetained] = useState(false);
  const dock = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) { setRetained(true); return; }
    const close = window.setTimeout(() => setRetained(false), 400);
    return () => window.clearTimeout(close);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || dock.current?.contains(target)) return;
      // Chat action menus are rendered in document.body.
      if (target.closest(".social-message-context,.social-person-popup")) return;
      setMode("closed");
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => document.removeEventListener("pointerdown", dismissOutside, true);
  }, [open, setMode]);
  function close() { setMode("closed"); trigger.current?.focus({preventScroll:true}); }
  return (
  <aside ref={dock} className="social-dock" data-open={open} aria-label="Social drawer"
    onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && (event.target === trigger.current || (event.currentTarget.contains(event.target as Node) && !event.currentTarget.querySelector(".social-encryption-drawer,.social-pinned-drawer,.social-group-drawer,.social-emoji-picker") && !document.querySelector(".social-message-context,.social-person-popup")))) close(); }}>
    {["top","bottom"].map(edge=><svg key={edge} className={`social-wall-return ${edge}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M0 15.5 Q15.5 15.5 15.5 0 H22 V16 H0 Z" fill="var(--desktop-frame)"/>
      <path d="M0 15.5 Q15.5 15.5 15.5 0" fill="none" stroke="var(--desktop-line)"/>
    </svg>)}
    <button ref={trigger} className="social-dock-tab" aria-label="Social" aria-expanded={open} aria-controls="social-dock-panel"
      onPointerEnter={event => { if (!open && event.pointerType === "mouse") setMode("pinned"); }}
      onClick={() => { if (mode === "pinned") close(); else setMode("pinned"); }}>
      <svg aria-hidden="true" className="social-tab-shape" viewBox="0 0 34 144" preserveAspectRatio="none"><path className="social-tab-fill" d="M33 0 C33 17 29 20 19 22 C6 24 1 30 1 43 V101 C1 114 6 120 19 122 C29 124 33 127 33 144 H36 V0 Z"/><path className="social-tab-line" d="M33 0 C33 17 29 20 19 22 C6 24 1 30 1 43 V101 C1 114 6 120 19 122 C29 124 33 127 33 144"/></svg><MessageCircle size={16}/><span>Social</span>
    </button>
    <div id="social-dock-panel" className="social-dock-panel social-content" inert={!open}>
      {(open || retained) && children}
    </div>
  </aside>);
}
