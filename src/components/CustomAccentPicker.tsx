import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { LauncherEyedropper } from "./LauncherEyedropper";
import { EyedropperIcon as Pipette } from "@phosphor-icons/react";

type UndoColor = { owner: symbol; undo: () => boolean };
const colorHistory: UndoColor[] = [];
function undoColor(event: KeyboardEvent) {
  if (event.key.toLowerCase() !== "z" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
  if (event.target instanceof Element && event.target.closest('textarea,input:not([type="range"]),[contenteditable="true"]')) return;
  while (colorHistory.length) {
    if (colorHistory.pop()!.undo()) { event.preventDefault(); event.stopPropagation(); break; }
  }
}
document.addEventListener("keydown", undoColor, true);

type HsvColor = { hue: number; saturation: number; value: number };

function clampColorChannel(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hsvToHex({ hue, saturation, value }: HsvColor) {
  const chroma = value / 100;
  const saturationRatio = saturation / 100;
  const channel = (segment: number) => {
    const k = (segment + hue / 60) % 6;
    return chroma - chroma * saturationRatio * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[channel(5), channel(3), channel(1)]
    .map(value => Math.round(value * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToHsv(input: string): HsvColor {
  const clean = input.trim().replace(/^#/, "");
  const expanded = clean.length === 3 ? clean.split("").map(character => character.repeat(2)).join("") : clean;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return { hue: 0, saturation: 0, value: 100 };
  const [red, green, blue] = [0, 2, 4].map(offset => Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  return {
    hue: Math.round((hue + 360) % 360),
    saturation: maximum ? Math.round((delta / maximum) * 100) : 0,
    value: Math.round(maximum * 100),
  };
}

type PickerProps = {
  value: string;
  onApply: (color: string) => void;
  onPreview?: (color: string | undefined) => void;
  label?: string;
  rainbow?: boolean;

};

export function CustomAccentPicker({ value, onApply, onPreview, rainbow, label = "Custom accent color" }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState<HsvColor>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState(value.toUpperCase());
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentHex = /^#[0-9a-f]{6}$/i.test(hexDraft) ? hexDraft.toLowerCase() : hsvToHex(color);
  const hexValid = /^#[0-9a-f]{6}$/i.test(hexDraft);
  const preview = useRef(onPreview);
  preview.current = onPreview;
  useEffect(() => { preview.current?.(open && hexValid ? currentHex : undefined); }, [open, hexValid, currentHex]);
  useEffect(() => () => preview.current?.(undefined), []);

  const owner = useRef(Symbol());
  const latest = useRef({ value, onApply });
  latest.current = { value, onApply };
  const sample = useRef<AbortController | undefined>(undefined);
  const [sampling, setSampling] = useState<{ x: number; y: number }>();
  const [sampleError, setSampleError] = useState("");
  const dropperButton = useRef<HTMLButtonElement>(null);
  function finishSample(hex?: string) {
    sample.current = undefined;
    setSampling(undefined);
    if (hex) { changeHex(hex); commit(hex); }
    requestAnimationFrame(() => dropperButton.current?.focus({ preventScroll: true }));
  }
  const draftRef = useRef(hexDraft);
  draftRef.current = hexDraft;
  useEffect(() => () => {
    sample.current?.abort();
    for (let i = colorHistory.length - 1; i >= 0; i--) {
      if (colorHistory[i].owner === owner.current) colorHistory.splice(i, 1);
    }
  }, []);
  function commit(hex = draftRef.current) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const before = latest.current.value.toLowerCase(), after = hex.toLowerCase();
    if (before === after) return;
    colorHistory.push({ owner: owner.current, undo: () => {
      if (latest.current.value.toLowerCase() !== after) return false;
      changeHex(before);
      latest.current.onApply(before);
      return true;
    } });
    if (colorHistory.length > 100) colorHistory.shift();
    latest.current.onApply(after);
  }
  async function pickPixel(x: number, y: number) {
    setSampleError("");
    if ("__TAURI_INTERNALS__" in window && /Windows/i.test(navigator.userAgent)) {
      sample.current = new AbortController();
      setSampling({ x, y });
      return;
    }
    const Dropper = (window as Window & { EyeDropper?: new () => {
      open(options: { signal: AbortSignal }): Promise<{ sRGBHex: string }>;
    } }).EyeDropper;
    if (!Dropper) { setSampleError("Screen sampling is unavailable in this browser."); return; }
    const controller = new AbortController();
    sample.current = controller;
    try {
      const picked = await new Dropper().open({ signal: controller.signal });
      if (!controller.signal.aborted) { changeHex(picked.sRGBHex); commit(picked.sRGBHex); }
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) setSampleError("Couldn’t sample the screen. Try again.");
    } finally { sample.current = undefined; }
  }
  const setHsv = (next: HsvColor) => {
    const normalized = {
      hue: ((next.hue % 360) + 360) % 360,
      saturation: clampColorChannel(next.saturation),
      value: clampColorChannel(next.value),
    };
    setColor(normalized);
    draftRef.current = hsvToHex(normalized).toUpperCase();
    setHexDraft(draftRef.current);
  };
  const placePicker = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = pickerRef.current?.offsetWidth || 320;
    const height = pickerRef.current?.offsetHeight || 390;
    const viewportPadding = 12;
    const preferredTop = bounds.bottom + 13;
    const top = preferredTop + height <= window.innerHeight - viewportPadding
      ? preferredTop
      : Math.max(viewportPadding, bounds.top - height - 13);
    setPosition({
      top,
      left: Math.max(viewportPadding, Math.min(bounds.right - width, window.innerWidth - width - viewportPadding)),
    });
  };
  const openPicker = () => {
    const next = hexToHsv(value);
    setColor(next);
    setHexDraft(value.toUpperCase());
    setPosition({ top: 0, left: 0 });
    setSampleError("");
    setOpen(true);
  };
  const closePicker = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  };
  const updateFromSquare = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setHsv({
      ...color,
      saturation: ((event.clientX - bounds.left) / bounds.width) * 100,
      value: 100 - ((event.clientY - bounds.top) / bounds.height) * 100,
    });
  };
  const changeHex = (next: string) => {
    const prefixed = next.startsWith("#") ? next : `#${next}`;
    draftRef.current = prefixed.toUpperCase();
    setHexDraft(draftRef.current);
    if (/^#[0-9a-f]{6}$/i.test(prefixed)) setColor(hexToHsv(prefixed));
  };

  useLayoutEffect(() => {
    if (open) placePicker();
  }, [open]);
  const positioned = position.top > 0;
  useEffect(() => {
    if (open && positioned) pickerRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus({ preventScroll: true });
  }, [open, positioned]);

  useEffect(() => {
    if (!open) return;
    const observer = new ResizeObserver(placePicker);
    if (pickerRef.current) observer.observe(pickerRef.current);
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sample.current && !triggerRef.current?.contains(target) && !pickerRef.current?.contains(target)) { commit(); closePicker(); }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (!sample.current && event.key === "Escape") { event.stopPropagation(); closePicker(true); } };
    window.addEventListener("resize", placePicker);
    window.addEventListener("scroll", placePicker, true);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", placePicker);
      window.removeEventListener("scroll", placePicker, true);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  return <>
    <button ref={triggerRef} type="button" className={rainbow ? "appearance-color-chip rainbow-trigger" : "appearance-color-chip"}
      aria-label={`Choose ${label.toLowerCase()}`} aria-expanded={open} aria-haspopup="dialog"
      onClick={() => { if (open) { commit(); closePicker(); } else openPicker(); }}>
      <span aria-hidden="true" style={rainbow ? undefined : { background: value }} />{rainbow ? "Custom" : value.toUpperCase()}
    </button>
    {sampling && createPortal(<LauncherEyedropper start={sampling} onPick={finishSample}
      onCancel={() => finishSample()} onError={() => { finishSample(); setSampleError("Couldn’t sample the launcher. Try again."); }}/>, document.body)}
    {open && createPortal(
      <div
        ref={pickerRef}
        className="accent-picker-popover"
        role="dialog"
        aria-modal="false"
        aria-label={label}
        style={{
          position: "fixed",
          top: position.top,
          left: position.left,
          visibility: position.top && !sampling ? "visible" : "hidden",
          "--picker-hue": `hsl(${color.hue} 100% 50%)`,
          "--picker-color": currentHex,
          "--picker-saturation": `${color.saturation}%`,
          "--picker-value": `${100 - color.value}%`,
        } as CSSProperties}
      >
        <div
          className="accent-saturation-field"
          role="slider"
          tabIndex={0}
          aria-label="Saturation and brightness"
          aria-valuenow={Math.round(color.saturation)}
          aria-valuetext={`${Math.round(color.saturation)}% saturation, ${Math.round(color.value)}% brightness`}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); updateFromSquare(event); }}
          onPointerUp={() => commit()}
          onKeyUp={event => { if (event.key.startsWith("Arrow")) commit(); }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromSquare(event); }}
          onKeyDown={event => {
            const step = event.shiftKey ? 10 : 2;
            if (event.key === "ArrowLeft") setHsv({ ...color, saturation: color.saturation - step });
            else if (event.key === "ArrowRight") setHsv({ ...color, saturation: color.saturation + step });
            else if (event.key === "ArrowUp") setHsv({ ...color, value: color.value + step });
            else if (event.key === "ArrowDown") setHsv({ ...color, value: color.value - step });
            else return;
            event.preventDefault();
          }}
        >
          <i aria-hidden="true" />
        </div>
        <label className="accent-hue-control">
          <input
            type="range"
            min="0"
            max="359"
            value={Math.round(color.hue)}
            aria-label="Hue"
            onPointerUp={() => commit()}
            onKeyUp={() => commit()}
            onChange={event => setHsv({ ...color, hue: Number(event.target.value) })}
          />
        </label>
        <label className="accent-hex-control">
          <span aria-hidden="true" className="hex-preview" />
          <input
            value={hexDraft}
            maxLength={7}
            spellCheck={false}
            className={hexValid ? "" : "invalid"}
            aria-invalid={!hexValid}
            aria-label="Hex color"
            onChange={event => changeHex(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && hexValid) { commit(currentHex); closePicker(true); }
            }}
          />
        </label>
        <button type="button" className="color-picker-dropper" aria-label="Pick a color from the screen" title="Pick a color from the screen" ref={dropperButton} aria-pressed={!!sampling} onClick={event => void pickPixel(event.clientX, event.clientY)}><Pipette size={16}/></button>
        <button type="button" className="color-picker-apply" disabled={!hexValid} onClick={() => { commit(currentHex); closePicker(true); }}>Apply color</button>
        {sampleError && <span className="eyedropper-error" role="alert">{sampleError}</span>}
      </div>,
      document.body,
    )}
  </>;
}
