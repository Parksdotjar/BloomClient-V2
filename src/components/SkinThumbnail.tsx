import { useEffect, useState } from "react";
import { invoke } from "../services/invoke";
import { UserRound } from "lucide-react";
import { SkinViewer } from "skinview3d";

const cache = new Map<string, string>();
window.addEventListener("bloom-clear-transient-caches", () => cache.clear());
let queue = Promise.resolve();

type Variant = "classic" | "slim" | "auto";
type Framing = "full" | "account";

async function thumbnailKey(texture: string, variant: Variant, framing: Framing) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texture));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${framing === "account" ? "account-bust-v1" : "skin-v1"}:${variant}:${hash}`;
}

// One short-lived renderer at a time, then cached PNGs: no WebGL loop per tile.
export function SkinThumbnail({ texture, variant, framing = "full" }: { texture: string; variant: Variant; framing?: Framing }) {
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    setImage(""); setFailed(false);
    queue = queue.then(async () => {
      if (stopped) return;
      const key = await thumbnailKey(texture, variant, framing);
      let png = cache.get(key);
      if (!png) {
        png = await invoke<string | null>("get_cached_thumbnail", { key }).catch(() => null) || undefined;
        if (png) cache.set(key, png);
      }
      if (!png) {
        const portrait = framing === "account";
        const model = variant === "auto" ? "auto-detect" : variant === "slim" ? "slim" : "default";
        const viewer = new SkinViewer({ width: portrait ? 192 : 360, height: portrait ? 192 : 480, pixelRatio: 1, renderPaused: true, model });
        try {
          await viewer.loadSkin(texture, { model });
          viewer.playerObject.rotation.y = portrait ? 0.56 : 0.38;
          if (portrait) {
            const { skin } = viewer.playerObject;
            skin.rightArm.rotation.set(-0.82, 0, -0.14);
            skin.leftArm.rotation.set(0.72, 0, 0.17);
            skin.head.rotation.y = -0.12;
            viewer.fov = 23;
            viewer.camera.position.set(0, 15, 43);
            viewer.camera.lookAt(0, 9.4, 0);
          }
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
  }, [texture, variant, framing]);
  if (framing === "account") {
    if (image) return <img src={image} alt="" />;
    if (failed) return <svg viewBox="8 8 8 8" aria-hidden="true"><image href={texture} width="64" /><image href={texture} x="-32" width="64" /></svg>;
    return <UserRound size={26} />;
  }
  return image ? <img className="locker-skin-thumbnail" src={image} alt="" /> : <span className="locker-skin-placeholder">{failed ? "Preview unavailable" : "Loading…"}</span>;
}

// Request the saved player's public skin only while the account list is visible.
export function AccountSkinPortrait({ accountId }: { accountId: string }) {
  const [texture, setTexture] = useState("");
  useEffect(() => {
    let current = true;
    setTexture("");
    void invoke<string>("get_minecraft_skin", { accountId })
      .then(result => { if (current) setTexture(result); })
      .catch(() => {});
    return () => { current = false; };
  }, [accountId]);
  return <span className="account-skin-portrait" aria-hidden="true">
    {texture ? <SkinThumbnail texture={texture} variant="auto" framing="account" /> : <UserRound size={26} />}
  </span>;
}
