import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
export const PRESET_ACCENTS = ["#8ee365", "#5d9dff", "#a56bff", "#e957ad", "#f4a340", "#f05454"] as const;

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

export function CustomAccentPicker({ value, onApply, label = "Custom accent color", description = "Build your own Bloom accent.", showValue = false, selected, trigger }: { value: string; onApply: (color: string) => void; label?: string; description?: string; showValue?: boolean; selected?: boolean; trigger?: (props: { ref: RefObject<HTMLButtonElement | null>; onClick: () => void; expanded: boolean }) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState<HsvColor>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState(value.toUpperCase());
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentHex = /^#[0-9a-f]{6}$/i.test(hexDraft) ? hexDraft.toLowerCase() : hsvToHex(color);
  const hexValid = /^#[0-9a-f]{6}$/i.test(hexDraft);
  const customSelected = selected ?? !PRESET_ACCENTS.some(preset => preset.toLowerCase() === value.toLowerCase());

  const setHsv = (next: HsvColor) => {
    const normalized = {
      hue: ((next.hue % 360) + 360) % 360,
      saturation: clampColorChannel(next.saturation),
      value: clampColorChannel(next.value),
    };
    setColor(normalized);
    setHexDraft(hsvToHex(normalized).toUpperCase());
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
    setOpen(true);
  };
  const closePicker = () => setOpen(false);
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
    setHexDraft(prefixed.toUpperCase());
    if (/^#[0-9a-f]{6}$/i.test(prefixed)) setColor(hexToHsv(prefixed));
  };

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(placePicker);
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !pickerRef.current?.contains(target)) closePicker();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") closePicker(); };
    window.addEventListener("resize", placePicker);
    window.addEventListener("scroll", placePicker, true);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", placePicker);
      window.removeEventListener("scroll", placePicker, true);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <>
    {trigger ? trigger({ ref: triggerRef, onClick: () => open ? closePicker() : openPicker(), expanded: open }) : <button
      ref={triggerRef}
      type="button"
      className={`accent-custom-trigger ${customSelected ? "picked" : ""}`}
      aria-label={`Choose ${label.toLowerCase()}`}
      style={showValue ? { background: value } : undefined}
      aria-expanded={open}
      title={label}
      onClick={() => open ? closePicker() : openPicker()}
    />}
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
          visibility: position.top ? "visible" : "hidden",
          "--picker-hue": `hsl(${color.hue} 100% 50%)`,
          "--picker-color": currentHex,
          "--picker-saturation": `${color.saturation}%`,
          "--picker-value": `${100 - color.value}%`,
        } as CSSProperties}
      >
        <div className="accent-picker-heading">
          <div><b>Custom color</b><span>{description}</span></div>
          <span className="accent-picker-preview" aria-hidden="true" />
        </div>
        <div
          className="accent-saturation-field"
          role="slider"
          tabIndex={0}
          aria-label="Accent saturation and brightness"
          aria-valuetext={`${Math.round(color.saturation)}% saturation, ${Math.round(color.value)}% brightness`}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); updateFromSquare(event); }}
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
          <span>Hue</span>
          <input
            type="range"
            min="0"
            max="359"
            value={Math.round(color.hue)}
            aria-label="Accent hue"
            onChange={event => setHsv({ ...color, hue: Number(event.target.value) })}
          />
        </label>
        <label className="accent-hex-control">
          <span>Hex</span>
          <input
            value={hexDraft}
            maxLength={7}
            spellCheck={false}
            className={hexValid ? "" : "invalid"}
            aria-invalid={!hexValid}
            aria-label="Custom accent hex color"
            onChange={event => changeHex(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && hexValid) { onApply(currentHex); closePicker(); }
            }}
          />
        </label>
        <div className="accent-picker-actions">
          <button type="button" className="accent-picker-cancel" onClick={closePicker}>Cancel</button>
          <button type="button" className="accent-picker-apply" disabled={!hexValid} onClick={() => { onApply(currentHex); closePicker(); }}><Check size={15} />Apply color</button>
        </div>
      </div>,
      document.body,
    )}
  </>;
}

