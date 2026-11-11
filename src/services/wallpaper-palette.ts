type Sample = { rgb: number[]; count: number };
const distance = (a: number[], b: number[]) => a.reduce((sum, channel, i) => sum + (channel - b[i]) ** 2, 0);

// Bounded color buckets retain a real sampled pixel rather than inventing a tint.
export function colorsFromPixels(pixels: Uint8ClampedArray): string[] {
  const buckets = new Map<number, Sample>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 240) continue;
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const key = (rgb[0] >> 4) * 256 + (rgb[1] >> 4) * 16 + (rgb[2] >> 4);
    const bucket = buckets.get(key);
    if (bucket) bucket.count++;
    else buckets.set(key, { rgb, count: 1 });
  }
  const candidates = [...buckets.values()].sort((a, b) => b.count - a.count);
  if (!candidates.length) return [];
  const chosen = [candidates.shift()!];
  while (chosen.length < 5 && candidates.length) {
    let best = -1, score = -1;
    candidates.forEach((sample, index) => {
      const separation = Math.min(...chosen.map(other => distance(sample.rgb, other.rgb)));
      const weight = separation * Math.sqrt(sample.count);
      if (separation >= 24 ** 2 && weight > score) { best = index; score = weight; }
    });
    if (best < 0) break;
    chosen.push(candidates.splice(best, 1)[0]);
  }
  return chosen.map(({ rgb }) => `#${rgb.map(channel => channel.toString(16).padStart(2, "0")).join("")}`);
}

// Keep only the current image, and reuse work across Settings remounts.
let cached: { source: string; palette: Promise<string[]> } | undefined;
export function wallpaperPalette(source: string): Promise<string[]> {
  if (cached?.source === source) return cached.palette;
  const palette = (async () => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const scale = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return colorsFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
  })().catch(() => []);
  cached = { source, palette };
  return palette;
}
