import { useEffect, useRef, useState } from "react";
import { SignOutIcon as LogOut, ArrowArcLeftIcon as Undo2 } from "@phosphor-icons/react";
import { ToolbarIconSwap } from "./ConnectedToolbar";
import "./undo-logout.css";

const UNDO_MS = 5000;

/** A reversible request. Only the deadline commits the existing native action. */
export function UndoLogoutButton({ accountId, open, disabled = false, animations, onConfirm }: {
  accountId: string; open: boolean; disabled?: boolean; animations: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [phase, setPhase] = useState<"idle" | "pending" | "committing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [size, setSize] = useState({ width: 180, height: 53, tl: 13, tr: 13, br: 13, bl: 13 });
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const progressTimer = useRef<number | undefined>(undefined);
  const pending = useRef<{ accountId: string; deadline: number } | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ accountId, open, disabled, onConfirm });
  latest.current = { accountId, open, disabled, onConfirm };

  const clearTimers = () => {
    window.clearTimeout(timer.current);
    window.clearInterval(progressTimer.current);
    timer.current = undefined; progressTimer.current = undefined;
  };
  const cancel = (announce = false) => {
    pending.current = null;
    clearTimers();
    if (mounted.current) {
      setPhase("idle"); setElapsed(0);
      setAnnouncement(announce ? "Log out canceled. You are still signed in." : "");
    }
  };

  useEffect(() => {
    mounted.current = true;
    const element = button.current;
    const measure = () => {
      if (!element) return;
      const style = getComputedStyle(element);
      setSize({ width: element.clientWidth, height: element.clientHeight,
        tl: parseFloat(style.borderTopLeftRadius) || 0, tr: parseFloat(style.borderTopRightRadius) || 0,
        br: parseFloat(style.borderBottomRightRadius) || 0, bl: parseFloat(style.borderBottomLeftRadius) || 0 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (element) observer.observe(element);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => setReducedMotion(media.matches);
    media.addEventListener("change", preference);
    const visibility = () => { if (document.hidden && pending.current) cancel(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false; pending.current = null; clearTimers();
      observer.disconnect(); media.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!open || disabled || (pending.current && pending.current.accountId !== accountId)) cancel();
  }, [open, disabled, accountId]);

  const start = () => {
    if (!open || disabled || phase === "committing") return;
    if (pending.current) { cancel(true); return; }
    const request = { accountId, deadline: Date.now() + UNDO_MS };
    pending.current = request;
    setElapsed(0); setPhase("pending");
    setAnnouncement("Signing out in five seconds. Choose Undo to stay signed in.");
    progressTimer.current = window.setInterval(() => {
      if (pending.current === request) setElapsed(Math.min(UNDO_MS, Math.max(0, UNDO_MS - (request.deadline - Date.now()))));
    }, 100);
    timer.current = window.setTimeout(async () => {
      if (pending.current !== request) return;
      const current = latest.current;
      if (!mounted.current || !current.open || current.disabled || document.hidden || current.accountId !== request.accountId) { cancel(); return; }
      pending.current = null; clearTimers();
      setElapsed(UNDO_MS); setPhase("committing"); setAnnouncement("Signing out.");
      try { await current.onConfirm(); }
      catch { if (mounted.current) setAnnouncement("Could not sign out. Please try again."); }
      finally { if (mounted.current) setPhase("idle"); }
    }, UNDO_MS);
  };

  const motion = animations && !reducedMotion;
  const progress = motion ? elapsed / UNDO_MS : Math.floor(elapsed / 1000) / 5;
  const undo = phase === "pending";
  const right = Math.max(1, size.width - 1), bottom = Math.max(1, size.height - 1);
  const radius = (value: number) => Math.max(0, Math.min(value - 1, (size.height - 2) / 2, (size.width - 2) / 2));
  const [tl, tr, br, bl] = [size.tl, size.tr, size.br, size.bl].map(radius);
  const outline = `M ${size.width / 2} 1 H ${right - tr} A ${tr} ${tr} 0 0 1 ${right} ${1 + tr} V ${bottom - br} A ${br} ${br} 0 0 1 ${right - br} ${bottom} H ${1 + bl} A ${bl} ${bl} 0 0 1 1 ${bottom - bl} V ${1 + tl} A ${tl} ${tl} 0 0 1 ${1 + tl} 1 Z`;
  return <>
    <button ref={button} type="button" className="profile-logout undo-logout" role="menuitem" tabIndex={open ? 0 : -1}
      data-phase={phase} data-motion={motion} disabled={disabled || phase === "committing"}
      aria-label={undo ? "Undo log out" : phase === "committing" ? "Signing out" : "Log out"}
      onClick={start} onKeyDown={event => { if (event.key === "Escape" && pending.current) cancel(true); }}>
      {undo && <svg className="logout-countdown" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
        <path d={outline}
          pathLength="100" strokeDasharray="100 100" strokeDashoffset={-100 * progress} />
      </svg>}
      <span className="undo-logout-icon"><ToolbarIconSwap active={undo} resting={<LogOut size={18} weight="bold" />} engaged={<Undo2 size={18} weight="bold" />} /></span>
      <div><b key={phase} className="undo-logout-label toolbar-copy">{undo ? "Undo" : phase === "committing" ? "Signing out…" : "Log out"}</b></div>
    </button>
    <span className="logout-announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  </>;
}
