// Use a single brightness ramp so no channel carries the original pigment into a custom accent.
function brightness(rgb: number) {
  return ((rgb >> 16) * 0.2126) + (((rgb >> 8) & 255) * 0.7152) + ((rgb & 255) * 0.0722);
}

export function cosmeticShade(chosen: number, base: number, original: number, shine: number) {
  const reference = brightness(base);
  const delta = brightness(original) - reference;
  const shadow = 1 + Math.min(0, delta) / Math.max(1, reference);
  const highlight = Math.min(0.30, Math.max(0, delta) / 255);
  let result = 0;
  for (const shift of [0, 8, 16]) {
    const channel = (chosen >> shift) & 255;
    const shaded = chosen === base ? (original >> shift) & 255
      : channel * shadow + (255 - channel) * highlight;
    result |= Math.round(shaded + (255 - shaded) * shine) << shift;
  }
  return result;
}
