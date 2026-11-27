import { normalizeAnimatedAccent, sampleAccent, type AnimatedAccent } from "./animated-accent";

export const accentPresets = [
  { name: "Blue", color: "#87a9f3" },
  { name: "Purple", color: "#a78bfa" },
  { name: "Pink", color: "#f781b6" },
  { name: "Red", color: "#f57373" },
  { name: "Orange", color: "#fb9c55" },
  { name: "Green", color: "#62cd89" },
  { name: "Teal", color: "#26cfb0" },
];

export type AccentPreferences = { accent: string; customAccent: boolean; lastCustomAccent: string };
export function normalizeAccent<T extends Partial<AccentPreferences & AnimatedAccent>>(saved: T) {
  const { accentMode, accentStops, accentIntensity, accentDuration, ...rest } = saved;
  const isHex = (input: unknown): input is string => typeof input === "string" && /^#[0-9a-f]{6}$/i.test(input);
  let accent = isHex(saved.accent) ? saved.accent.toLowerCase() : accentPresets[0].color;
  if (accentMode === "animated") {
    const legacy = normalizeAnimatedAccent({ accentMode, accentStops, accentIntensity, accentDuration });
    accent = sampleAccent(legacy.accentStops, 0, legacy.accentIntensity);
  }
  const customAccent = saved.customAccent === true || !accentPresets.some(preset => preset.color === accent);
  const previousCustom = isHex(saved.lastCustomAccent) ? saved.lastCustomAccent.toLowerCase() : "";
  const lastCustomAccent = customAccent ? accent : previousCustom;
  return { ...rest, accent, customAccent, lastCustomAccent };
}
