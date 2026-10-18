export type AccentStop = { id: string; color: string; position: number };
export type AnimatedAccent = { accentMode: "solid" | "animated"; accentStops: AccentStop[]; accentDuration: number; accentIntensity: number };
export const defaultAnimatedAccent: AnimatedAccent = {
  accentMode: "solid",
  accentStops: [{ id: "pink", color: "#ed83b5", position: 0 }, { id: "purple", color: "#a56bff", position: 50 }, { id: "blue", color: "#5d9dff", position: 100 }],
  accentDuration: 20,
  accentIntensity: 100,
};
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function normalizeAnimatedAccent(value: Partial<AnimatedAccent>): AnimatedAccent {
  const valid = Array.isArray(value.accentStops) ? value.accentStops.filter(s => s && typeof s.color === "string" && /^#[\da-f]{6}$/i.test(s.color) && Number.isFinite(s.position)).slice(0, 5) : [];
  return {
    accentMode: value.accentMode === "animated" ? "animated" : "solid",
    accentStops: valid.length >= 2 ? valid.map((s, i) => ({ id: `stop-${i}`, color: s.color, position: clamp(s.position, 0, 100) })) : defaultAnimatedAccent.accentStops.map(s => ({ ...s })),
    accentDuration: Number.isFinite(value.accentDuration) ? clamp(value.accentDuration!, 4, 60) : 20,
    accentIntensity: Number.isFinite(value.accentIntensity) ? clamp(value.accentIntensity!, 0, 100) : 100,
  };
}
export const sortedStops = (stops: AccentStop[]) => [...stops].sort((a, b) => a.position - b.position);
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export function sampleAccent(stops: AccentStop[], position: number, intensity = 100): string {
  const sorted = sortedStops(stops);
  let left = sorted[0], right = sorted[sorted.length - 1];
  for (const stop of sorted) {
    if (stop.position <= position) left = stop;
    if (stop.position > position) { right = stop; break; }
  }
  const t = right.position <= left.position ? 0 : clamp((position - left.position) / (right.position - left.position), 0, 1);
  const a = rgb(left.color), b = rgb(right.color);
  const channels = a.map((v, i) => v + (b[i] - v) * t);
  const gray = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return "#" + channels.map(v => Math.round(gray + (v - gray) * clamp(intensity, 0, 100) / 100).toString(16).padStart(2, "0")).join("");
}
export function accentGradient(stops: AccentStop[]) {
  return `linear-gradient(90deg, ${sortedStops(stops).map(s => `${s.color} ${s.position}%`).join(", ")})`;
}
