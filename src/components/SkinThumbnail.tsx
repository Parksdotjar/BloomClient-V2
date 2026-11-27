import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "../services/invoke";
import { UserCircleIcon as UserRound } from "@phosphor-icons/react";
import { playerSkin, skinKey } from "../services/player-skin";
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

// Serialize GPU work and reuse content-addressed thumbnails on disk.
function renderThumbnail(texture:string, variant:Variant, framing:Framing, cancelled?:()=>boolean): Promise<string> {
  const render = queue.then(async () => {
      if (cancelled?.()) return "";
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
      return png;
  });
  queue = render.then(()=>{},()=>{});
  return render;
}

export function SkinThumbnail({ texture, variant, framing = "full" }: { texture: string; variant: Variant; framing?: Framing }) {
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stopped = false;
    setImage(""); setFailed(false);
    void renderThumbnail(texture,variant,framing,()=>stopped).then(png => { if (!stopped) setImage(png); }, () => { if (!stopped) setFailed(true); });
    return () => { stopped = true; };
  }, [texture, variant, framing]);
  if (framing === "account") {
    if (image) return <img src={image} alt="" />;
    if (failed) return <svg viewBox="8 8 8 8" aria-hidden="true"><image href={texture} width="64" /><image href={texture} x="-32" width="64" /></svg>;
    return <UserRound size={26} />;
  }
  return image ? <img className="locker-skin-thumbnail" src={image} alt="" /> : <span className="locker-skin-placeholder">{failed ? "Preview unavailable" : "Loading…"}</span>;
}

type Portrait = {png?:string; updated:number; pending?:Promise<void>};
const portraits = new Map<string,Portrait>();
const listeners = new Set<()=>void>();
function notify() { for (const listener of listeners) listener(); }
function subscribe(listener:()=>void) { listeners.add(listener); return () => {listeners.delete(listener);}; }

function loadPortrait(id:string) {
  const entry = portraits.get(id) ?? {updated:0};
  if (entry.pending || Date.now()-entry.updated < 300_000) return;
  if (!portraits.has(id) && portraits.size >= 128) portraits.delete(portraits.keys().next().value!);
  portraits.set(id,entry);
  entry.pending = playerSkin(id).then(texture => renderThumbnail(texture,"auto","account")).then(png => {
    entry.png = png; entry.updated = Date.now();
  }).catch(() => { entry.updated = Date.now()-285_000; }).finally(()=>{entry.pending=undefined; notify();});
}
window.addEventListener("bloom-clear-transient-caches",()=>{portraits.clear(); notify();});
window.addEventListener("locker-skin-saved",event=>{
  const id=skinKey((event as CustomEvent<string>).detail);
  const previous=portraits.get(id);
  if (previous) { portraits.set(id,{png:previous.png,updated:0}); loadPortrait(id); }
});

export function AccountSkinPortrait({accountId}:{accountId:string}) {
  const id = skinKey(accountId);
  const png = useSyncExternalStore(subscribe,()=>portraits.get(id)?.png);
  useEffect(()=>{loadPortrait(id);},[id,png]);
  return <span className="account-skin-portrait" aria-hidden="true">{png ? <img src={png} alt=""/> : <UserRound size={22}/>}</span>;
}
