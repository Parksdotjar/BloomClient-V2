import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Copy, Minus, PanelLeftOpen, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "../services/invoke";

type MenuItem = { label: string; run: () => void };
export type DesktopMenu = { label: string; items: MenuItem[] };

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

export function DesktopTitleBar({ onHome, onExpand, menus }: { onHome: () => void; onExpand?: () => void; menus: DesktopMenu[] }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    let active = true;
    const refresh = () => { void win.isMaximized().then(value => { if (active) setMaximized(value); }).catch(() => {}); };
    refresh();
    window.addEventListener("resize", refresh);
    return () => { active = false; window.removeEventListener("resize", refresh); };
  }, []);
  return <header className="desktop-titlebar">
    <button className="desktop-title-brand" onClick={onHome} aria-label="Delight home" title="Home">
      <img src={new URL("delight-logo.png", document.baseURI).href} alt="" />
    </button>
    <ApplicationMenus menus={menus} />
    <div className="desktop-title-drag" data-tauri-drag-region />
    {onExpand && <button className="desktop-frame-control" onClick={onExpand} aria-label="Expand sidebar" title="Expand sidebar"><PanelLeftOpen size={16} /></button>}
    <div className="desktop-frame-controls" role="group" aria-label="Window controls">
      <button className="desktop-frame-control" aria-label="Minimize Delight Client" title="Minimize" onClick={() => void getCurrentWindow().minimize()}><Minus /></button>
      <button className="desktop-frame-control" aria-label="Maximize or restore Delight Client" title={maximized ? "Restore" : "Maximize"} onClick={() => void getCurrentWindow().toggleMaximize()}>{maximized ? <Copy /> : <Square />}</button>
      <button className="desktop-frame-control frame-close" aria-label="Close Delight Client" title="Close" onClick={() => void invoke("exit_application")}><X /></button>
    </div>
  </header>;
}
