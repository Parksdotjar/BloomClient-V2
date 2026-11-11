import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "./connected-toolbar.css";

// Space belongs to the tools while open, so the drawer never covers results.
export function ToolbarDrawer({ id, open, children, className = "" }: {
  id: string; open: boolean; children: ReactNode; className?: string;
}) {
  return <div id={id} className={`connected-toolbar-drawer ${className}`} data-open={open} inert={!open} aria-hidden={!open}>
    <div className="toolbar-drawer-clip"><div className="toolbar-drawer-body">{children}</div></div>
  </div>;
}

export function ToolbarSegments({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (value: string) => void;
}) {
  return <div className="toolbar-field">
    <span>{label}</span>
    <div className="toolbar-segments" role="group" aria-label={label}
      style={{ "--segments": options.length, "--selected": Math.max(0, options.indexOf(value)) } as CSSProperties}>
      <i aria-hidden="true" />
      {options.map(option => <button type="button" key={option} className="toolbar-reveal-item" aria-pressed={value === option}
        onClick={() => onChange(option)}>{option}</button>)}
    </div>
  </div>;
}

export function ToolbarIconSwap({ active, resting, engaged }: { active: boolean; resting: ReactNode; engaged: ReactNode }) {
  return <span className="toolbar-icon-swap" data-active={active} aria-hidden="true">{resting}{engaged}</span>;
}

// For transient filters only. Workflows such as screenshot selection stay open
// while interacting with their results, and own their explicit cancellation.
export function useToolbarDisclosure() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target)) return;
      if (root.current?.querySelector('.select-trigger[aria-expanded="true"]') && event.target instanceof Element && event.target.closest(".select-menu-portal")) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (root.current?.querySelector('.select-trigger[aria-expanded="true"]')) return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return { open, setOpen, root, trigger };
}
