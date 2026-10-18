import { useEffect, useRef, useState } from "react";
import { Search, X, Layers3, Settings, ArrowUpRight } from "lucide-react";
import "./library-navigation.css";
export type SwitchTarget = {
    id: string;
    label: string;
    detail: string;
    keywords?: string;
    kind: "instance" | "page" | "setting";
    run: () => void;
};
export function QuickSwitcher({ targets }: {
    targets: SwitchTarget[];
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState(0);
    const dialog = useRef<HTMLDialogElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const previous = useRef<HTMLElement | null>(null);
    const results = targets.filter(target => query.toLowerCase().trim().split(/\s+/).every(word => `${target.label} ${target.detail} ${target.keywords || ""}`.toLowerCase().includes(word))).slice(0, 40);
    const active = Math.min(selected, Math.max(0, results.length - 1));
    const close = () => { setOpen(false); dialog.current?.close(); previous.current?.focus(); };
    useEffect(() => {
        const key = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || event.altKey || event.isComposing)
                return;
            if (document.querySelector("dialog[open]") && !dialog.current?.open)
                return;
            event.preventDefault();
            event.stopPropagation();
            if (dialog.current?.open) {
                close();
                return;
            }
            previous.current = document.activeElement as HTMLElement;
            setQuery("");
            setSelected(0);
            setOpen(true);
        };
        document.addEventListener("keydown", key, true);
        return () => document.removeEventListener("keydown", key, true);
    }, []);
    useEffect(() => { if (open) {
        dialog.current?.showModal();
        input.current?.focus();
    } }, [open]);
    useEffect(() => { dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active, query]);
    if (!open)
        return null;
    return <dialog ref={dialog} className="quick-switcher" aria-label="Quick switcher" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) {
        const box = event.currentTarget.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
            close();
    } }}>
    <div className="switcher-search"><Search size={21}/><input ref={input} role="combobox" aria-label="Search instances, pages and settings" aria-expanded="true" aria-controls="switcher-results" aria-activedescendant={results[active] ? `switch-result-${active}` : undefined} autoComplete="off" placeholder="Where to?" value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % (results.length || 1));
            }
            if (event.key === "Enter" && !event.nativeEvent.isComposing && results[active]) {
                event.preventDefault();
                close();
                results[active].run();
            }
        }}/><button aria-label="Close switcher" onClick={close}><X size={18}/></button></div>
    <div id="switcher-results" role="listbox" aria-label="Destinations" className="switcher-results">{results.map((target, index) => <button id={`switch-result-${index}`} key={target.id} role="option" aria-selected={index === active} tabIndex={-1} onMouseMove={() => setSelected(index)} onClick={() => { close(); target.run(); }}>{target.kind === "setting" ? <Settings size={19}/> : target.kind === "instance" ? <Layers3 size={19}/> : <ArrowUpRight size={19}/>}<span><b>{target.label}</b><small>{target.detail}</small></span></button>)}{!results.length && <p className="switcher-empty">No matches</p>}</div>
    <footer><span>↑ ↓ Navigate</span><span>Enter Open</span><span>Esc Close</span></footer>
  </dialog>;
}
