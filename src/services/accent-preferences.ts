import { normalizeAnimatedAccent, sampleAccent, type AnimatedAccent } from "./animated-accent";

export const accentPresets = [
  { name: "Blue", color: "#87a9f3" },
  { name: "Lavender", color: "#ac94e9" },
  { name: "Sage", color: "#8aba82" },
  { name: "Chalk", color: "#d4d0cd" },
  { name: "Slate", color: "#737b85" },
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
