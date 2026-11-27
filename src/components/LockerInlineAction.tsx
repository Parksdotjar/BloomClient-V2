import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate } from "animejs";
import { ArrowRightIcon as ArrowRight, UploadIcon as Upload, type Icon as PhosphorIcon } from "@phosphor-icons/react";

type Props = {
  label: string; icon: PhosphorIcon; field: string; placeholder?: string; submitLabel: string;
  pending: string; maxLength: number; disabled?: boolean; signedOut?: boolean;
  submit: (value: string) => Promise<string | null>;
  upload?: () => Promise<string | null>;
  onError: (message: string) => string;
};

export function LockerInlineAction({ label, icon: Icon, field, placeholder = field, submitLabel, pending,
  maxLength, disabled, signedOut, submit, upload, onError }: Props) {
  const [phase, setPhase] = useState<"idle" | "edit" | "pending" | "result">("idle");
  const [value, setValue] = useState("");
  const [result, setResult] = useState("");
  const root = useRef<HTMLFormElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  const returnFocus = useRef(false);
  const compact = upload ? 100 : 124;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const width = phase === "idle" ? compact : phase === "edit" ? 285 : 160;
    const { animations, performance } = document.documentElement.dataset;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || animations === "off" || performance === "ultra";
    const animation = animate(el, { width, duration: reduced ? 0 : 185, ease: "outCubic" });
    if (phase === "edit") input.current?.focus();
    if (phase === "idle" && returnFocus.current) {
      trigger.current?.focus();
      returnFocus.current = false;
    }
    return () => { animation.pause(); };
  }, [phase, compact]);

  useEffect(() => {
    if (phase !== "result") return;
    const timer = window.setTimeout(() => setPhase("idle"), 1900);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (phase === "idle") return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        returnFocus.current = false;
        if (phase === "edit") setPhase("idle");
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [phase]);
  const run = async (action: () => Promise<string | null>) => {
    if (locked.current || disabled || signedOut) return;
    locked.current = true;
    returnFocus.current = true;
    setPhase("pending");
    try {
      const message = await action();
      if (mounted.current) { setResult(message || ""); setPhase(message ? "result" : "idle"); }
    } catch (error) {
      if (mounted.current) { setResult(onError(String(error))); setPhase("result"); }
    } finally { locked.current = false; }
  };
  return <form className="locker-inline-action" ref={root} style={{width: compact}} aria-label={label}
    onSubmit={e => { e.preventDefault(); if (phase === "edit" && value.trim()) void run(() => submit(value.trim())); }}
    onKeyDown={e => { if (e.key === "Escape" && phase === "edit") { e.stopPropagation(); returnFocus.current = true; setPhase("idle"); } }}>
    {phase === "idle" ? <button type="button" ref={trigger} className="inline-trigger" disabled={disabled}
      onClick={() => { setValue(""); setPhase("edit"); }}><Icon size={16}/>{label}</button> :
      phase === "edit" ? <>
        <input ref={input} aria-label={field} placeholder={placeholder} maxLength={maxLength} autoComplete="off"
          onKeyDown={event => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            const typed = event.currentTarget.value.trim();
            if (typed) void run(() => submit(typed));
          }}
          spellCheck={false} readOnly={signedOut} value={value} onChange={e => setValue(e.target.value)}/>
        {upload && <button type="button" aria-label="Choose PNG…" title="Upload skin PNG" onClick={() => void run(upload)}><Upload size={16}/></button>}
        <button type="submit" aria-label={submitLabel} title={submitLabel} disabled={!value.trim() || signedOut}><ArrowRight size={16}/></button>
      </> : <output aria-live="polite">{phase === "pending" ? pending : result}</output>}
  </form>;
}
