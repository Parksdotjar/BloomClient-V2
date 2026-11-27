import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon as Check } from "@phosphor-icons/react";
import "./download-feedback.css";

function HistoryRow({ id, leaving, delay, motion, onExited, children }: {
  id: string; leaving: boolean; delay: number; motion: boolean;
  onExited: (id: string) => void; children: ReactNode;
}) {
  const shell = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!leaving) return;
    const element = shell.current;
    const row = element?.firstElementChild;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    if (!element || !(row instanceof HTMLElement) || !motion || reduced.matches || document.hidden) {
      onExited(id);
      return;
    }
    let live = true;
    const animations = [
      row.animate([
        { transform: getComputedStyle(row).transform },
        { transform: "translateY(28px) scale(.9)" },
      ], { duration: 720, delay, easing: "cubic-bezier(.4,0,.2,1)", fill: "both" }),
      row.animate([
        { opacity: 1, filter: "blur(0px)" },
        { opacity: 0, filter: "blur(2px)" },
      ], { duration: 540, delay: delay + 180, easing: "cubic-bezier(.4,0,.3,1)", fill: "both" }),
      // Let the row depart before closing its space; don't squash readable text.
      element.animate([
        { height: `${element.getBoundingClientRect().height}px`, marginTop: getComputedStyle(element).marginTop },
        { height: "0px", marginTop: "0px" },
      ], { duration: 560, delay: delay + 480, easing: "cubic-bezier(.45,0,.18,1)", fill: "both" }),
    ];
    const finish = () => {
      if (!live) return;
      live = false;
      onExited(id);
    };
    const preference = () => { if (reduced.matches) finish(); };
    const visibility = () => { if (document.hidden) finish(); };
    void Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    reduced.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      live = false;
      animations.forEach(animation => animation.cancel());
      reduced.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [id, leaving, delay, motion, onExited]);
  return <div ref={shell} className="download-history-entry" data-leaving={leaving ? "true" : undefined}
    data-history-id={id} aria-hidden={leaving || undefined} inert={leaving}>{children}</div>;
}

export function DownloadHistory<T extends { id: string }>({ items, filtered = false, motion, onClear, renderItem }: {
  items: T[]; filtered?: boolean; motion: boolean; onClear: () => void; renderItem: (item: T) => ReactNode;
}) {
  // Exiting rows are presentation only. The parent remains the source of saved history.
  const [exiting, setExiting] = useState<Array<{ item: T; delay: number }>>([]);
  const finish = useCallback((id: string) => setExiting(current => current.filter(entry => entry.item.id !== id)), []);
  useLayoutEffect(() => {
    const liveIds = new Set(items.map(item => item.id));
    setExiting(current => current.some(entry => liveIds.has(entry.item.id))
      ? current.filter(entry => !liveIds.has(entry.item.id)) : current);
  }, [items]);
  const clear = () => {
    if (!items.length) return;
    if (motion && !matchMedia("(prefers-reduced-motion: reduce)").matches && !document.hidden) {
      const ids = new Set(items.map(item => item.id));
      const stagger = Math.min(80, 400 / Math.max(1, items.length - 1));
      setExiting(current => [...items.map((item, index) => ({ item, delay: (items.length - 1 - index) * stagger })), ...current.filter(entry => !ids.has(entry.item.id))]);
    }
    onClear();
  };
  const liveIds = new Set(items.map(item => item.id));
  const rows = [
    ...items.map(item => ({ item, leaving: false, delay: 0 })),
    ...exiting.filter(entry => !liveIds.has(entry.item.id)).map(entry => ({ ...entry, leaving: true })),
  ];
  return <>
    <section className="download-section completed-section" data-motion={motion ? "on" : "off"}>
      <form id="clear-download-history" onSubmit={event => { event.preventDefault(); clear(); }} />
      <div className="download-history-list">
        {rows.length ? rows.map(entry => <HistoryRow key={entry.item.id} id={entry.item.id} leaving={entry.leaving}
          delay={entry.delay} motion={motion} onExited={finish}>{renderItem(entry.item)}</HistoryRow>)
          : <div className="downloads-empty compact download-history-empty" role="status"><Check size={18} /><div><b>{filtered ? "No matching completed downloads" : "No completed downloads yet"}</b></div></div>}
      </div>
    </section>

  </>;
}
