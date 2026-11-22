import { useEffect, useRef, useState } from "react";
import { invoke } from "../services/invoke";
import { SkinViewer } from "skinview3d";

// Keep recently displayed images decoded so revisiting a skin takes one texture swap.
const skinImages = new Map<string, HTMLImageElement>();
window.addEventListener("bloom-clear-transient-caches", () => skinImages.clear());

export type CapeAnimation = { atlasUrl: string; frameCount: number; columns: number; rows: number; frameWidth: number; frameHeight: number; fps: number; loop: boolean };
export function CapePreview({ texture, animation, skinUuid, skinTexture, variant, front = false, motion = true }: { texture?: string; animation?: CapeAnimation | null; skinUuid?: string; skinTexture?: string; variant?: "classic" | "slim"; front?: boolean; motion?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLCanvasElement | null>(null);
  const renderer = useRef<SkinViewer | null>(null);
  const [accountSkin, setAccountSkin] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    setAccountSkin(null);
    if (!skinUuid || skinTexture) return;
    void invoke<string>("get_minecraft_skin", { accountId: skinUuid })
      .then(skin => { if (!stopped) setAccountSkin(skin); })
      .catch(() => { if (!stopped) setAccountSkin(null); });
    return () => { stopped = true; };
  }, [skinUuid, skinTexture]);

  useEffect(() => {
    if (!canvas.current) return;
    let viewer: SkinViewer;

    const skin = document.createElement("canvas"); skin.width = skin.height = 64;
    const ctx = skin.getContext("2d")!;
    ctx.fillStyle = "#616570"; ctx.fillRect(0, 0, 64, 32);
    ctx.fillRect(16, 48, 32, 16);
    ctx.fillStyle = "#9297a1"; ctx.fillRect(8, 8, 8, 8);
    ctx.clearRect(32, 0, 32, 16);
    fallback.current = skin;
    setError("");
    try {
      viewer = new SkinViewer({ canvas: canvas.current, width: 320, height: 430, skin, model: "default", pixelRatio: Math.min(Math.max(window.devicePixelRatio, 2), 3) });
      renderer.current = viewer;
      viewer.playerObject.rotation.y = (front ? 0 : Math.PI) + 0.35;
      viewer.controls.enableZoom = false;
      viewer.controls.enablePan = false;
      viewer.controls.enableDamping = motion;
      viewer.controls.dampingFactor = 0.055;
      viewer.controls.rotateSpeed = 0.78;
      viewer.autoRotate = false;

    } catch { setError("3D preview unavailable on this device"); }
    return () => { renderer.current = null; viewer?.dispose(); };
  }, [front, motion]);

  useEffect(() => {
    const viewer = renderer.current;
    if (!viewer) return;
    let stopped = false, timer = 0;
      const load = async () => {
        if (!texture) { viewer.resetCape(); return; }
        let image = skinImages.get(texture);
        if (!image) {
          image = new Image(); image.crossOrigin = "anonymous"; image.src = texture;
          await image.decode();
          if (stopped) return;
          if (skinImages.size >= 24) skinImages.delete(skinImages.keys().next().value!);
          skinImages.set(texture, image);
        }
        viewer.loadCape(image);
        if (stopped || !motion || !animation) return;
        const atlas = new Image(); atlas.crossOrigin = "anonymous"; atlas.src = animation.atlasUrl;
        await atlas.decode(); if (stopped) return;
        const frame = document.createElement("canvas"); frame.width = animation.frameWidth; frame.height = animation.frameHeight;
        const frameContext = frame.getContext("2d")!; const start = performance.now(); let previous = -1;
        timer = window.setInterval(() => {
          if (document.hidden) return;
          const elapsed = Math.floor((performance.now() - start) / 1000 * animation.fps);
          const index = animation.loop ? elapsed % animation.frameCount : Math.min(elapsed, animation.frameCount - 1);
          if (index === previous) return; previous = index;
          frameContext.clearRect(0, 0, frame.width, frame.height);
          frameContext.drawImage(atlas, index % animation.columns * frame.width, Math.floor(index / animation.columns) * frame.height, frame.width, frame.height, 0, 0, frame.width, frame.height);
          void viewer.loadCape(frame);
        }, 1000 / Math.min(animation.fps, 30));
      };
      void load().catch(() => { if (!stopped) setError("Preview unavailable"); });
    return () => { stopped = true; clearInterval(timer); };
  }, [texture, animation, front, motion]);

  useEffect(() => {
    const viewer = renderer.current;
    const source = skinTexture || accountSkin;
    if (!viewer) return;
    const model = variant === "slim" ? "slim" : variant === "classic" ? "default" : "auto-detect";
    if (!source) {
      if (fallback.current) viewer.loadSkin(fallback.current, {model: "default"});
      return;
    }
    const cached = skinImages.get(source);
    if (cached) {
      viewer.loadSkin(cached, {model});
      setError("");
      return;
    }
    let current = true;
    const image = new Image();
    image.onload = () => {
      if (!current || viewer !== renderer.current) return;
      if (skinImages.size >= 24) skinImages.delete(skinImages.keys().next().value!);
      skinImages.set(source, image);
      viewer.loadSkin(image, {model});
      setError("");
    };
    image.onerror = () => { if (current) setError("Preview unavailable"); };
    image.src = source;
    return () => { current = false; };
  }, [skinTexture, accountSkin, variant, front, motion]);
  return <div className="cape-preview"><canvas ref={canvas} aria-label="Drag to rotate your Minecraft player and cape" />{error && <p role="status">{error}</p>}</div>;
}
