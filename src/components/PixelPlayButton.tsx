import { useEffect, useRef } from "react";
import { Play } from "lucide-react";
import "./pixel-play-button.css";

const CELL = 10;
const EMPTY = "inset(50%)";

/** Only Home's primary launch action uses the pointer-origin pixel reveal. */
export function PixelPlayButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const button = buttonRef.current;
    const fill = fillRef.current;
    if (!button || !fill) return;
    const root = document.documentElement;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let phase = 0;
    let target = 0;
    let lastTime = 0;
    let hovered = false;
    let focused = false;
    let origin = { x: .5, y: .5 };
    let width = 0;
    let height = 0;
    let columns = 0;
    let thresholds: number[][] = [];
    let lastClip = "";

    const motionAllowed = () => !reduced.matches && root.dataset.animations !== "off" && root.dataset.performance !== "ultra";
    const stop = () => { cancelAnimationFrame(frame); frame = 0; };
    const prepare = () => {
      width = button.clientWidth;
      height = button.clientHeight;
      columns = Math.ceil(width / CELL);
      const x = origin.x * width;
      const y = origin.y * height;
      const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) + CELL * 2;
      thresholds = Array.from({ length: Math.ceil(height / CELL) }, (_, row) =>
        Array.from({ length: columns }, (_, col) => {
          // Fixed spatial noise: a rough advancing edge, never flickering grain.
          let hash = Math.imul(col + 1, 374761393) ^ Math.imul(row + 1, 668265263);
          hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
          const noise = ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
          const distance = Math.hypot(Math.min(width, (col + .5) * CELL) - x, Math.min(height, (row + .5) * CELL) - y);
          return Math.max(.001, (distance + (noise - .5) * CELL * 3.2) / radius);
        }),
      );
    };
    const paint = () => {
      let clip = EMPTY;
      if (phase >= 1) clip = "inset(0)";
      else if (phase > 0) {
        // Quintic S-curve: zero speed and acceleration at both ends, with a fuller middle.
        const radius = phase * phase * phase * (phase * (phase * 6 - 15) + 10);
        let path = "";
        thresholds.forEach((row, rowIndex) => {
          // Merge adjacent blocks into row runs, keeping a single small clip path.
          for (let col = 0; col < columns;) {
            if (row[col] > radius) { col++; continue; }
            const start = col;
            while (col < columns && row[col] <= radius) col++;
            const left = start * CELL;
            const top = rowIndex * CELL;
            path += `M${left} ${top}H${Math.min(width, col * CELL)}V${Math.min(height, top + CELL)}H${left}Z`;
          }
        });
        if (path) clip = `path("${path}")`;
      }
      if (clip !== lastClip) { fill.style.clipPath = clip; lastClip = clip; }
    };
    const tick = (now: number) => {
      frame = 0;
      const elapsed = now - lastTime;
      lastTime = now;
      phase = target ? Math.min(1, phase + elapsed / 1000) : Math.max(0, phase - elapsed / 850);
      paint();
      if (phase !== target) frame = requestAnimationFrame(tick);
    };
    const update = () => {
      target = !button.disabled && !document.hidden && (hovered || focused) ? 1 : 0;
      button.dataset.pixelActive = String(Boolean(target));
      stop();
      if (!motionAllowed() || document.hidden || button.disabled) {
        phase = target;
        paint();
      } else if (phase !== target) {
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "touch" || button.disabled) return;
      hovered = true;
      // Retarget only a fresh reveal; reversing an unfinished exit keeps its edge intact.
      if (phase === 0) {
        const bounds = button.getBoundingClientRect();
        origin = {
          x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
          y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
        };
        prepare();
      }
      update();
    };
    const leave = () => { hovered = false; update(); };
    const focus = () => {
      focused = button.matches(":focus-visible");
      if (focused && phase === 0) { origin = { x: .5, y: .5 }; prepare(); }
      update();
    };
    const blur = () => { focused = false; update(); };
    const visibility = () => {
      hovered = !document.hidden && button.matches(":hover");
      focused = !document.hidden && button.matches(":focus-visible");
      update();
    };
    const resize = new ResizeObserver(() => { prepare(); paint(); });
    const preferences = new MutationObserver(update);
    const availability = new MutationObserver(update);
    prepare();
    paint();
    resize.observe(button);
    preferences.observe(root, { attributes: true, attributeFilter: ["data-animations", "data-performance"] });
    availability.observe(button, { attributes: true, attributeFilter: ["disabled"] });
    reduced.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    button.addEventListener("pointerenter", enter);
    button.addEventListener("pointerleave", leave);
    button.addEventListener("pointercancel", leave);
    button.addEventListener("focus", focus);
    button.addEventListener("blur", blur);
    return () => {
      stop();
      resize.disconnect();
      preferences.disconnect();
      availability.disconnect();
      reduced.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", visibility);
      button.removeEventListener("pointerenter", enter);
      button.removeEventListener("pointerleave", leave);
      button.removeEventListener("pointercancel", leave);
      button.removeEventListener("focus", focus);
      button.removeEventListener("blur", blur);
    };
  }, []);

  return <button ref={buttonRef} className="spotlight-play pixel-play" disabled={disabled} onClick={onClick}>
    <span className="pixel-play-content"><Play size={24} fill="currentColor" aria-hidden="true" /><b>Play</b></span>
    <span ref={fillRef} className="pixel-play-fill" aria-hidden="true">
      <span className="pixel-play-content"><Play size={24} fill="currentColor" /><b>Play</b></span>
    </span>
  </button>;
}
