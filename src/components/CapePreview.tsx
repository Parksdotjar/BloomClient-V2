import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SkinViewer } from "skinview3d";

export type CapeAnimation = { atlasUrl: string; frameCount: number; columns: number; rows: number; frameWidth: number; frameHeight: number; fps: number; loop: boolean };
export function CapePreview({ texture, animation, skinUuid, skinTexture, variant, front = false, motion = true }: { texture?: string; animation?: CapeAnimation | null; skinUuid?: string; skinTexture?: string; variant?: "classic" | "slim"; front?: boolean; motion?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
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
    let stopped = false, timer = 0;
    const skin = document.createElement("canvas"); skin.width = skin.height = 64;
    const ctx = skin.getContext("2d")!;
    ctx.fillStyle = "#616570"; ctx.fillRect(0, 0, 64, 32);
    ctx.fillRect(16, 48, 32, 16);
    ctx.fillStyle = "#9297a1"; ctx.fillRect(8, 8, 8, 8);
    ctx.clearRect(32, 0, 32, 16);
    setError("");
    try {
      viewer = new SkinViewer({ canvas: canvas.current, width: 320, height: 430, skin: skinTexture || accountSkin || skin, model: variant === "slim" ? "slim" : variant === "classic" ? "default" : (skinTexture || accountSkin) ? "auto-detect" : "default", pixelRatio: Math.min(window.devicePixelRatio, 2) });
      viewer.playerObject.rotation.y = (front ? 0 : Math.PI) + 0.35;
      viewer.controls.enableZoom = false;
      viewer.controls.enablePan = false;
      viewer.controls.enableDamping = motion;
      viewer.controls.dampingFactor = 0.055;
      viewer.controls.rotateSpeed = 0.78;
      viewer.autoRotate = false;
      const load = async () => {
        if (texture) await viewer.loadCape(texture);
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
    } catch { setError("3D preview unavailable on this device"); }
    return () => { stopped = true; window.clearInterval(timer); viewer?.dispose(); };
  }, [texture, animation, accountSkin, skinTexture, variant, front, motion]);
  return <div className="cape-preview"><canvas ref={canvas} aria-label="Drag to rotate your Minecraft player and cape" />{error && <p role="status">{error}</p>}</div>;
}
