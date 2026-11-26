import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { snowfallLimits, type SnowfallSettings } from "../services/snowfall-settings";
import "./launcher-snowfall.css";

const frameInterval = 1000 / 30;
const pixelLimit = 1920 * 1080;
const reduceMotion = "(prefers-reduced-motion: reduce)";

function flakeSprite(color: string) {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 12;
  const context = sprite.getContext("2d");
  if (!context) return sprite;

  context.strokeStyle = color;
  context.lineWidth = 1.15;
  context.lineCap = "round";
  context.beginPath();
  for (let axis = 0; axis < 3; axis += 1) {
    const angle = axis * Math.PI / 3;
    const x = Math.cos(angle) * 4.5, y = Math.sin(angle) * 4.5;
    context.moveTo(6 - x, 6 - y);
    context.lineTo(6 + x, 6 + y);
  }
  context.stroke();
  return sprite;
}

type Props = { light: boolean; settings: SnowfallSettings };

export function LauncherSnowfall(props: Props) {
  const [reduced, setReduced] = useState(() => matchMedia(reduceMotion).matches);
  useEffect(() => {
    const media = matchMedia(reduceMotion);
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced ? null : <SnowfallCanvas {...props} />;
}

function SnowfallCanvas({ light, settings }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const options = useRef(settings);
  useLayoutEffect(() => { options.current = settings; }, [settings]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const sprite = flakeSprite(light ? "#486079" : "#f3f8ff");
    const flakes = Array.from({ length: snowfallLimits.count.max }, () => ({
      x: Math.random(),
      y: Math.random(),
      speed: 15 + Math.random() * 22,
      size: 4 + Math.random() * 5,
      phase: Math.random() * Math.PI * 2,
      opacity: (0.17 + Math.random() * 0.2) * (light ? 0.8 : 1),
    }));
    let width = 0, height = 0;
    let frame = 0, lastDraw: number | undefined;
    let minimized = false, disposed = false, windowCheck = 0;
    const nativeWindow = isTauri() ? getCurrentWindow() : null;

    const render = (now: number) => {
      frame = 0;
      if (document.hidden || minimized || !width || !height) return;
      const elapsed = lastDraw === undefined ? frameInterval : now - lastDraw;
      if (elapsed >= frameInterval) {
        const seconds = lastDraw === undefined ? 0 : Math.min(elapsed, 100) / 1000;
        lastDraw = now;
        const { count, speed, size } = options.current;
        const travel = seconds * speed / 100;
        const sizeMultiplier = size / 100;
        context.clearRect(0, 0, width, height);
        for (let index = 0; index < count; index += 1) {
          const flake = flakes[index];
          const flakeSize = flake.size * sizeMultiplier;
          flake.y += flake.speed * travel / height;
          flake.phase += travel * 0.8;
          if (flake.y * height > height + flakeSize) {
            flake.y = -flakeSize / height;
            flake.x = Math.random();
          }
          context.globalAlpha = flake.opacity;
          const x = flake.x * width + Math.sin(flake.phase) * 9 - flakeSize / 2;
          const y = flake.y * height - flakeSize / 2;
          context.drawImage(sprite, x, y, flakeSize, flakeSize);
        }
      }
      frame = requestAnimationFrame(render);
    };

    const syncPlayback = () => {
      if (document.hidden || minimized || !width || !height) {
        cancelAnimationFrame(frame);
        frame = 0;
        lastDraw = undefined;
      } else if (!frame) {
        frame = requestAnimationFrame(render);
      }
    };
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (width && height) {
        const scale = Math.min(1, Math.sqrt(pixelLimit / (width * height)));
        const rasterWidth = Math.max(1, Math.floor(width * scale));
        const rasterHeight = Math.max(1, Math.floor(height * scale));
        if (canvas.width !== rasterWidth) canvas.width = rasterWidth;
        if (canvas.height !== rasterHeight) canvas.height = rasterHeight;
        context.setTransform(rasterWidth / width, 0, 0, rasterHeight / height, 0, 0);
      }
      syncPlayback();
    };
    const checkMinimized = () => {
      if (!nativeWindow) return;
      const check = ++windowCheck;
      void nativeWindow.isMinimized().then(value => {
        if (disposed || check !== windowCheck) return;
        minimized = value === true;
        syncPlayback();
      }).catch(() => {});
    };
    const visibilityChanged = () => {
      syncPlayback();
      checkMinimized();
    };
    const focused = () => {
      windowCheck += 1;
      minimized = false;
      syncPlayback();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("focus", focused);
    window.addEventListener("blur", checkMinimized);
    resize();
    checkMinimized();
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("focus", focused);
      window.removeEventListener("blur", checkMinimized);
    };
  }, [light]);

  return <canvas ref={canvasRef} className="launcher-snowfall" aria-hidden="true" width={1} height={1} />;
}
