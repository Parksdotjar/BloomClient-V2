/** Export the visible composition from the same bounded previews used by the viewer. */
export async function renderComparison(sources: [string, string], position: number, aspect: number, background = "#030405", divider = "#ffffff"): Promise<string> {
  if (!Number.isFinite(position) || position < 0 || position > 100 || !Number.isFinite(aspect) || aspect < .1 || aspect > 10) throw new Error("The comparison size is invalid.");
  const images = await Promise.all(sources.map(async source => { const image = new Image(); image.src = source; await image.decode(); return image; }));
  const width = Math.max(...images.map(image => image.naturalWidth));
  const height = width / aspect;
  const scale = Math.min(1, 1920 / width, 1920 / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The comparison could not be exported.");
  const paint = (image: HTMLImageElement) => {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const fit = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const w = image.naturalWidth * fit, h = image.naturalHeight * fit;
    context.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
  };
  paint(images[1]);
  const split = canvas.width * position / 100;
  context.save();
  context.beginPath(); context.rect(0, 0, split, canvas.height); context.clip();
  paint(images[0]);
  context.restore();
  if (position > 0 && position < 100) { context.fillStyle = divider; context.fillRect(Math.round(split) - 1, 0, 2, canvas.height); }
  return canvas.toDataURL("image/png");
}
