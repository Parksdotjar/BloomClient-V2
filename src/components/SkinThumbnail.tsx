import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SkinViewer } from "skinview3d";

const cache = new Map<string, string>();
window.addEventListener("bloom-clear-transient-caches", () => cache.clear());
let queue = Promise.resolve();

async function thumbnailKey(texture: string, variant: "classic" | "slim") {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texture));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `skin-v1:${variant}:${hash}`;
}

// One short-lived renderer at a time, then cached PNGs: no WebGL loop per tile.
export function SkinThumbnail({ texture, variant }: { texture: string; variant: "classic" | "slim" }) {
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    setImage(""); setFailed(false);
    queue = queue.then(async () => {
      if (stopped) return;
      const key = await thumbnailKey(texture, variant);
      let png = cache.get(key);
      if (!png) {
        png = await invoke<string | null>("get_cached_thumbnail", { key }).catch(() => null) || undefined;
        if (png) cache.set(key, png);
      }
      if (!png) {
        const viewer = new SkinViewer({ width: 360, height: 480, pixelRatio: 1, renderPaused: true, model: variant === "slim" ? "slim" : "default" });
        try {
          await viewer.loadSkin(texture, { model: variant === "slim" ? "slim" : "default" });
          viewer.playerObject.rotation.y = 0.38;
          viewer.render();
          png = viewer.canvas.toDataURL("image/png");
          if (cache.size >= 36) cache.delete(cache.keys().next().value!);
          cache.set(key, png);
          void invoke("save_cached_thumbnail", { key, dataUrl: png }).catch(() => undefined);
        } finally { viewer.dispose(); }
      }
      if (!stopped) setImage(png);
    }).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; };
  }, [texture, variant]);
  return image ? <img className="locker-skin-thumbnail" src={image} alt="" /> : <span className="locker-skin-placeholder">{failed ? "Preview unavailable" : "Loading…"}</span>;
}
