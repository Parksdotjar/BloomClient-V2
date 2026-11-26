export async function previewCapeArtwork() {
  const image = new Image();
  // The local concept artwork is optional in other development checkouts.
  image.src = "/artwork/capes/christmas-delight-cape-v2.png";
  await image.decode();

  // The image is the front only. CapeDisplay reads that face from a 64×32 UV atlas.
  const scale = image.naturalWidth / 10;
  const atlas = document.createElement("canvas");
  atlas.width = 64 * scale;
  atlas.height = 32 * scale;
  const context = atlas.getContext("2d");
  if (!context) return undefined;
  context.drawImage(image, scale, scale);
  return atlas.toDataURL();
}
