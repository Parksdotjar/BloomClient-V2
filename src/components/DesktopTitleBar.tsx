import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Copy, Minus, PanelLeftOpen, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "../services/invoke";
import { DesktopNotificationCenter, type DesktopNotifications } from "./DesktopNotificationCenter";
import type { DesktopCosmeticUnlock } from "./DesktopCosmeticUnlock";
import type { DesktopLauncherUpdate } from "./DesktopIslandUpdate";
import type { TitleBarLaunchProgress } from "../services/use-titlebar-launch-progress";
import type { ClientNotice } from "../services/client-notice";
import type { DesktopNowPlaying, NowPlayingAction, NowPlayingVolume } from "../services/now-playing";

type MenuItem = { label: string; run: () => void };
export type DesktopMenu = { label: string; items: MenuItem[] };
export type { DesktopLauncherUpdate } from "./DesktopIslandUpdate";

function ApplicationMenus({ menus }: { menus: DesktopMenu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const focusMenu = (index: number, item = 0) => {
    setCurrent(index);
    setOpen(index);
    requestAnimationFrame(() => {
      const choices = bar.current?.querySelectorAll<HTMLButtonElement>('[role="menu"] button');
      choices?.[item < 0 ? choices.length - 1 : item]?.focus();
    });
  };
  useEffect(() => {
    if (open === null) return;
    const dismiss = (event: PointerEvent) => { if (!bar.current?.contains(event.target as Node)) setOpen(null); };
    const blur = () => setOpen(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", blur);
    return () => { document.removeEventListener("pointerdown", dismiss); window.removeEventListener("blur", blur); };
  }, [open]);
  const keys = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const inPopup = !!(event.target as HTMLElement).closest('[role="menu"]');
    switch (event.key) {
      case "Escape":
        if (open === null) return;
        setOpen(null);
        triggers.current[index]?.focus();
        break;
      case "ArrowLeft":
      case "ArrowRight": {
        const next = (index + menus.length + (event.key === "ArrowRight" ? 1 : -1)) % menus.length;
        if (open !== null) focusMenu(next);
        else { setCurrent(next); triggers.current[next]?.focus(); }
        break;
      }
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End": {
        if (!inPopup) {
          if (event.key === "Home" || event.key === "End") {
            const next = event.key === "Home" ? 0 : menus.length - 1;
            setCurrent(next); setOpen(null); triggers.current[next]?.focus();
          } else focusMenu(index, event.key === "ArrowUp" ? -1 : 0);
        } else {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menu"] button'));
          const active = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : (active + items.length + (event.key === "ArrowDown" ? 1 : -1)) % items.length;
          items[next]?.focus();
        }
        break;
      }
      default: return;
    }
    event.preventDefault(); event.stopPropagation();
  };
  return <div className="desktop-menubar" ref={bar} role="menubar" aria-label="Application"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(null); }}>
    {menus.map(({ label, items }, index) => <div className="desktop-menu-group" key={label} role="none" onKeyDown={event => keys(event, index)}>
      <button ref={node => { triggers.current[index] = node; }} role="menuitem" tabIndex={current === index ? 0 : -1}
        aria-haspopup="menu" aria-expanded={open === index} onFocus={() => setCurrent(index)}
        onPointerEnter={() => { if (open !== null && open !== index) { triggers.current[index]?.focus(); setOpen(index); } }}
        onClick={event => { if (open === index) setOpen(null); else if (event.detail === 0) focusMenu(index); else { setCurrent(index); setOpen(index); } }}>
        {label}
      </button>
      {open === index && <div role="menu" aria-label={label} className="desktop-menu-popup">
        {items.map(item => <button role="menuitem" tabIndex={-1} key={item.label} onClick={() => { setOpen(null); triggers.current[index]?.focus(); item.run(); }}>{item.label}</button>)}
      </div>}
    </div>)}
  </div>;
}

export function DesktopTitleBar({
  onHome, onExpand, menus, notificationCenter, notificationRequest, launcherUpdate, clientNotice,
  cosmeticUnlock, onDismissCosmeticUnlock, onOpenUnlockedCloak,
  launchProgress, onCancelLaunch, nowPlaying, nowPlayingVolume, onNowPlayingControl,
  onNowPlayingDetailsChange, onNowPlayingVolumeChange, motion = true,
}: {
  onHome: () => void;
  onExpand?: () => void;
  menus: DesktopMenu[];
  notificationCenter?: DesktopNotifications;
  notificationRequest?: number;
  launcherUpdate?: DesktopLauncherUpdate;
  clientNotice?: ClientNotice | null;
  cosmeticUnlock?: DesktopCosmeticUnlock;
  onDismissCosmeticUnlock?: (sequence: number) => void;
  onOpenUnlockedCloak?: (item: DesktopCosmeticUnlock) => void;
  launchProgress?: TitleBarLaunchProgress;
  onCancelLaunch?: () => void;
  nowPlaying?: DesktopNowPlaying;
  nowPlayingVolume?: NowPlayingVolume | null;
  onNowPlayingControl?: (sessionId: string, action: NowPlayingAction) => void;
  onNowPlayingDetailsChange?: (sessionId: string | null) => void;
  onNowPlayingVolumeChange?: (sessionId: string, level: number) => void;
  motion?: boolean;
}) {
  const [maximized, setMaximized] = useState(false);
  const header = useRef<HTMLElement>(null);
  const start = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = header.current;
    const left = start.current;
    const right = end.current;
    if (!bar || !left || !right) return;
    const measure = () => {
      const leftWidth = left.offsetWidth;
      const rightWidth = right.offsetWidth;
      const centerWidth = Math.max(0, bar.clientWidth - 2 * (Math.max(leftWidth, rightWidth) + 12));
      bar.style.setProperty("--desktop-title-start-width", `${leftWidth}px`);
      bar.style.setProperty("--desktop-title-end-width", `${rightWidth}px`);
      bar.style.setProperty("--desktop-island-fit", `${centerWidth}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    [bar, left, right].forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const win = getCurrentWindow();
    let active = true;
    const refresh = () => { void win.isMaximized().then(value => { if (active) setMaximized(value); }).catch(() => {}); };
    refresh();
    window.addEventListener("resize", refresh);
    return () => { active = false; window.removeEventListener("resize", refresh); };
  }, []);
  return <header className="desktop-titlebar" ref={header}>
    <div className="desktop-title-start" ref={start}>
      <button className="desktop-title-brand" onClick={onHome} aria-label="Delight home" title="Home">
        <img src={new URL("delight-logo.png", document.baseURI).href} alt="" />
      </button>
      <ApplicationMenus menus={menus} />
    </div>
    <div className="desktop-title-drag" data-tauri-drag-region />
    {notificationCenter && <DesktopNotificationCenter center={notificationCenter} notificationRequest={notificationRequest}
      launcherUpdate={launcherUpdate} clientNotice={clientNotice} launchProgress={launchProgress} onCancelLaunch={onCancelLaunch}
      cosmeticUnlock={cosmeticUnlock} onDismissCosmeticUnlock={onDismissCosmeticUnlock} onOpenUnlockedCloak={onOpenUnlockedCloak}
      nowPlaying={nowPlaying} nowPlayingVolume={nowPlayingVolume} onNowPlayingControl={onNowPlayingControl}
      onNowPlayingDetailsChange={onNowPlayingDetailsChange} onNowPlayingVolumeChange={onNowPlayingVolumeChange} motion={motion} />}
    <div className="desktop-title-end" ref={end}>
      {onExpand && <button className="desktop-frame-control" onClick={onExpand} aria-label="Expand sidebar" title="Expand sidebar"><PanelLeftOpen size={16} /></button>}
      <div className="desktop-frame-controls" role="group" aria-label="Window controls">
        <button className="desktop-frame-control" aria-label="Minimize Delight Client" title="Minimize" onClick={() => void getCurrentWindow().minimize()}><Minus /></button>
        <button className="desktop-frame-control" aria-label="Maximize or restore Delight Client" title={maximized ? "Restore" : "Maximize"} onClick={() => void getCurrentWindow().toggleMaximize()}>{maximized ? <Copy /> : <Square />}</button>
        <button className="desktop-frame-control frame-close" aria-label="Close Delight Client" title="Close" onClick={() => void invoke("exit_application")}><X /></button>
      </div>
    </div>
  </header>;
}
