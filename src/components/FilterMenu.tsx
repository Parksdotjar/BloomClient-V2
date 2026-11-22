import { createContext, useContext, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, RotateCcw } from "lucide-react";
import "./catalog-filter-controls.css";
import { fitFloatingMenu } from "../services/menu-position";

type Anchor = RefObject<HTMLButtonElement | null>;
type MenuState = { owner: string; section: string | null; openSection: (id: string | null) => void; close: () => void };
const FilterContext = createContext<MenuState | null>(null);

function usePosition(menu: RefObject<HTMLDivElement | null>, anchor: Anchor, child: boolean, visible: boolean) {
  useLayoutEffect(() => {
    const element = menu.current, button = anchor.current;
    if (!visible || !element || !button) return;
    const place = () => {
      const row = button.getBoundingClientRect();
      const edge = 8, gap = 4;
      const width = Math.min(child ? 204 : 196, window.innerWidth - 2 * edge);
      const size = fitFloatingMenu(row, width, element.scrollHeight + 2, row.left);
      if (child) {
        const parent = button.closest('[role="menu"]')!.getBoundingClientRect();
        size.left = parent.right + gap + width <= window.innerWidth - edge
          ? parent.right + gap : Math.max(edge, parent.left - gap - width);
        size.top = Math.max(edge, Math.min(row.top, window.innerHeight - edge - Math.min(120, element.scrollHeight + 2)));
        size.maxHeight = Math.min(380, window.innerHeight - edge - size.top);
      }
      Object.assign(element.style, { left: size.left + "px", top: size.top + "px", width: size.width + "px", maxHeight: size.maxHeight + "px" });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(button); observer.observe(element);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, menu, child, visible]);
}

function navigateRows(event: KeyboardEvent<HTMLDivElement>) {
  if (event.target instanceof HTMLInputElement || event.defaultPrevented) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled"));
  if (!rows.length) return;
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  let next: HTMLButtonElement | undefined;
  if (event.key === "ArrowDown") next = rows[(index + 1) % rows.length];
  else if (event.key === "ArrowUp") next = rows[(index - 1 + rows.length) % rows.length];
  else if (event.key === "Home") next = rows[0];
  else if (event.key === "End") next = rows.at(-1);
  else if (event.key.length === 1 && event.key.trim() && !event.ctrlKey && !event.metaKey)
    next = [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find(row => row.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
  if (next) { event.preventDefault(); event.stopPropagation(); next.focus(); }
}

export function FilterMenu({ id, title, anchor, onClose, children }: {
  id: string; title: string; anchor: Anchor; onClose: () => void; children: ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [section, openSection] = useState<string | null>(null);
  const close = () => { onClose(); anchor.current?.focus({ preventScroll: true }); };
  usePosition(menu, anchor, false, true);
  useLayoutEffect(() => {
    menu.current?.querySelector<HTMLElement>("input,button:enabled")?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const outside = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || anchor.current?.contains(target) || target.closest("[data-filter-owner]")?.getAttribute("data-filter-owner") === id) return;
      onClose();
    };
    document.addEventListener("pointerdown", outside); document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [id, anchor, onClose]);
  return createPortal(<FilterContext.Provider value={{owner:id,section,openSection,close}}>
    <div ref={menu} id={id} data-filter-owner={id} role="menu" aria-label={title} className="launcher-filter-menu"
      onKeyDown={e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === "Tab") { close(); }
        else navigateRows(e);
      }}>
      {children}
    </div></FilterContext.Provider>, document.body);
}

export function FilterSection({ label, value, options, onChange, disabled }: {
  label: string; value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  const state = useContext(FilterContext)!;
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const id = useId(), open = state.section === id;
  usePosition(menu, button, true, open);
  useLayoutEffect(() => {
    if (open) (menu.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current?.querySelector('button'))?.focus({preventScroll:true});
    if (open) menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.scrollIntoView({block:"nearest"});
  }, [open]);
  return <>
    <button type="button" ref={button} role="menuitem" disabled={disabled} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => state.openSection(open ? null : id)}
      onKeyDown={e => { if (e.key === "ArrowRight") {e.preventDefault(); state.openSection(id);} }}>
      <span>{label}</span><ChevronRight size={15} aria-hidden="true"/>
    </button>
    {open && createPortal(<div ref={menu} id={id} className="launcher-filter-menu filter-choice-menu" data-filter-owner={state.owner} role="menu" aria-label={label}
      onKeyDown={e => {
        if (e.key === "Escape" || e.key === "ArrowLeft") {
          e.preventDefault(); e.stopPropagation(); state.openSection(null); button.current?.focus();
        } else navigateRows(e);
      }}>
      {options.map(option => <button type="button" role="menuitemradio" key={option} aria-checked={option === value}
        onClick={() => { onChange(option); state.close(); }}>
        <span>{option}</span>{value === option && <Check size={15} aria-hidden="true"/>}
      </button>)}
    </div>, document.body)}
  </>;
}


export function FilterReset({ disabled, onReset, label = "Reset filters" }: {
  disabled: boolean; onReset: () => void; label?: string;
}) {
  const { close } = useContext(FilterContext)!;
  return <button type="button" className="filter-reset" role="menuitem" disabled={disabled}
    onClick={() => { onReset(); close(); }}><RotateCcw size={14}/>{label}</button>;
}
