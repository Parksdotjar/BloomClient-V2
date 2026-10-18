import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { accentGradient, sampleAccent, sortedStops, type AnimatedAccent } from "../services/animated-accent";
import { CustomAccentPicker } from "./CustomAccentPicker";
import "./animated-accent.css";

export function useAnimatedAccent(settings: AnimatedAccent & { accent: string; animations: boolean; ultraPerformance: boolean }) {
  const latest = useRef(settings);
  latest.current = settings;
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, phase = 0, painted = 0;
    const root = document.documentElement;
    const staticColor = () => {
      const s = latest.current;
      root.style.setProperty("--accent", s.accentMode === "animated" ? sampleAccent(s.accentStops, 0, s.accentIntensity) : s.accent);
    };
    const tick = (now: number) => {
      const s = latest.current;
      if (last) phase = (phase + Math.min(now - last, 100) / (s.accentDuration * 1000)) % 1;
      last = now;
      if (now - painted >= 33) {
        // A forward-and-back cycle avoids a hard jump between the end colors.
        const position = (1 - Math.cos(phase * Math.PI * 2)) * 50;
        root.style.setProperty("--accent", sampleAccent(s.accentStops, position, s.accentIntensity));
        painted = now;
      }
      frame = window.requestAnimationFrame(tick);
    };
    const sync = () => {
      window.cancelAnimationFrame(frame); last = 0;
      const s = latest.current;
      staticColor();
      if (s.accentMode === "animated" && s.animations && !s.ultraPerformance && !reduced.matches && !document.hidden) frame = window.requestAnimationFrame(tick);
    };
    sync();
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => { window.cancelAnimationFrame(frame); reduced.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, [settings.accentMode, settings.animations, settings.ultraPerformance, settings.accent, settings.accentStops, settings.accentIntensity]);
}

export function AnimatedAccentEditor({ value, onChange, slider }: {
  value: AnimatedAccent;
  onChange: (patch: Partial<AnimatedAccent>) => void;
  slider: (value: number, change: (value: number) => void, label: string, min: number, max: number, unit: string) => ReactNode;
}) {
  const [selected, setSelected] = useState(value.accentStops[0].id);
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef({ id: "", startX: 0, moved: false });
  const stop = value.accentStops.find(s => s.id === selected) || value.accentStops[0];
  const updateStop = (id: string, patch: { color?: string; position?: number }) => onChange({ accentStops: value.accentStops.map(s => s.id === id ? { ...s, ...patch } : s) });
  const move = (id: string, x: number) => {
    const bounds = rail.current?.getBoundingClientRect();
    if (bounds?.width) updateStop(id, { position: Math.round(Math.max(0, Math.min(100, (x - bounds.left) / bounds.width * 100))) });
  };
  const add = () => {
    if (value.accentStops.length >= 5) return;
    const positions = [0, ...sortedStops(value.accentStops).map(s => s.position), 100];
    let position = 50, largest = -1;
    for (let i = 1; i < positions.length; i++) if (positions[i] - positions[i - 1] > largest) { largest = positions[i] - positions[i - 1]; position = Math.round((positions[i] + positions[i - 1]) / 2); }
    const id = crypto.randomUUID();
    onChange({ accentStops: [...value.accentStops, { id, color: sampleAccent(value.accentStops, position), position }] });
    setSelected(id);
  };
  return <div className="animated-accent-editor">
    <div className="animated-accent-heading"><div><b>Color stops</b><small>Drag to adjust the fade. Click a square to edit its color.</small></div><button type="button" onClick={add} disabled={value.accentStops.length >= 5}><Plus size={14} />Add color <span>{value.accentStops.length}/5</span></button></div>
    <div className="accent-gradient-rail" ref={rail} style={{ background: accentGradient(value.accentStops) }}>
      {value.accentStops.map((s, index) => <CustomAccentPicker key={s.id} value={s.color} onApply={color => updateStop(s.id, { color })} label={`Gradient stop ${index + 1} color`} description="Choose this gradient stop’s color." trigger={({ ref, onClick, expanded }) => <button ref={ref} type="button" role="slider" aria-expanded={expanded} aria-haspopup="dialog" className={`accent-gradient-stop ${s.id === stop.id ? "selected" : ""}`} style={{ left: `${s.position}%`, "--stop-color": s.color } as CSSProperties} aria-label={`Color stop ${index + 1} position`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.position} aria-valuetext={`${s.position}%, ${s.color}`} onFocus={() => setSelected(s.id)} onClick={() => { if (!drag.current.moved || drag.current.id !== s.id) onClick(); drag.current.moved = false; }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: s.id, startX: event.clientX, moved: false }; setSelected(s.id); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { if (Math.abs(event.clientX - drag.current.startX) > 4) drag.current.moved = true; if (drag.current.moved) move(s.id, event.clientX); } }} onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") drag.current.moved = false;
        const step = event.shiftKey ? 10 : 1;
        const position = event.key === "Home" ? 0 : event.key === "End" ? 100 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? Math.max(0, s.position - step) : event.key === "ArrowRight" || event.key === "ArrowUp" ? Math.min(100, s.position + step) : null;
        if (position !== null) { event.preventDefault(); updateStop(s.id, { position }); }
      }} />} />)}
    </div>
    <div className="accent-stop-controls"><span className="accent-stop-hex">{stop.color.toUpperCase()}</span><label>Position <input type="number" min={0} max={100} value={stop.position} onChange={e => { if (e.target.value !== "") updateStop(stop.id, { position: Math.max(0, Math.min(100, Number(e.target.value))) }); }} />%</label><button type="button" className="accent-stop-remove" aria-label="Remove selected color stop" disabled={value.accentStops.length <= 2} onClick={() => { onChange({ accentStops: value.accentStops.filter(s => s.id !== stop.id) }); }}><Trash2 size={15} /></button></div>
    <div className="accent-motion-control"><span>Cycle duration</span>{slider(value.accentDuration, accentDuration => onChange({ accentDuration }), "Accent cycle duration", 4, 60, "s")}</div>
    <div className="accent-motion-control"><span>Intensity</span>{slider(value.accentIntensity, accentIntensity => onChange({ accentIntensity }), "Accent color intensity", 0, 100, "%")}</div>
    <p className="accent-motion-note">One shared color cycle across Bloom. Motion pauses with reduced motion, animations off, or Ultra Performance.</p>
  </div>;
}
