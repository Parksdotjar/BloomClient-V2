import { useEffect, useState } from "react";
import { SkinViewer } from "skinview3d";

const cache = new Map<string, string>();
let queue = Promise.resolve();

// One short-lived renderer at a time, then cached PNGs: no WebGL loop per tile.
export function SkinThumbnail({ texture, variant }: { texture: string; variant: "classic" | "slim" }) {
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    setImage(""); setFailed(false);
    const key = variant + texture;
    queue = queue.then(async () => {
      if (stopped) return;
      let png = cache.get(key);
      if (!png) {
        const viewer = new SkinViewer({ width: 180, height: 240, renderPaused: true, model: variant === "slim" ? "slim" : "default" });
        try {
          await viewer.loadSkin(texture, { model: variant === "slim" ? "slim" : "default" });
          viewer.playerObject.rotation.y = 0.38;
          viewer.render();
          png = viewer.canvas.toDataURL("image/png");
          if (cache.size >= 36) cache.delete(cache.keys().next().value!);
          cache.set(key, png);
        } finally { viewer.dispose(); }
      }
      if (!stopped) setImage(png);
    }).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; };
  }, [texture, variant]);
  return image ? <img className="locker-skin-thumbnail" src={image} alt="" /> : <span className="locker-skin-placeholder">{failed ? "Preview unavailable" : "Loading…"}</span>;
}
