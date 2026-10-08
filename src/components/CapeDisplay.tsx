import { useEffect, useRef } from "react";
import type { CapeAnimation } from "./CapePreview";

type Props = {
  texture?: string;
  animation?: CapeAnimation | null;
  motion?: boolean;
  size?: "card" | "detail";
};

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Cape image unavailable"));
    image.src = source;
  });
}

export function CapeDisplay({ texture, animation, motion = true, size = "card" }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const output = canvas.current;
    if (!output || !texture) return;
    let stopped = false;
    let timer = 0;
    const context = output.getContext("2d")!;
    const draw = (source: CanvasImageSource, frameX: number, frameY: number, frameWidth: number, frameHeight: number) => {
      if (stopped) return;
      const unitX = frameWidth / 64;
      const unitY = frameHeight / 32;
      context.clearRect(0, 0, output.width, output.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(source, frameX + unitX, frameY + unitY, unitX * 10, unitY * 16, 0, 0, output.width, output.height);
    };

    void loadImage(texture).then(still => draw(still, 0, 0, still.width, still.height)).catch(() => undefined);
    if (motion && animation) {
      void loadImage(animation.atlasUrl).then(atlas => {
        if (stopped) return;
        const started = performance.now();
        let previous = -1;
        timer = window.setInterval(() => {
          const elapsed = Math.floor((performance.now() - started) / 1000 * animation.fps);
          const index = animation.loop ? elapsed % animation.frameCount : Math.min(elapsed, animation.frameCount - 1);
          if (index === previous) return;
          previous = index;
          draw(atlas, (index % animation.columns) * animation.frameWidth, Math.floor(index / animation.columns) * animation.frameHeight, animation.frameWidth, animation.frameHeight);
        }, 1000 / Math.min(animation.fps, 30));
      }).catch(() => undefined);
    }
    return () => { stopped = true; window.clearInterval(timer); };
  }, [texture, animation, motion]);

  return <div className={`cape-display ${size}`} aria-hidden="true">
    <div className="cape-display-shadow" />
    <div className="cape-display-object">
      <canvas ref={canvas} width="300" height="480" />
      <span className="cape-display-edge" />
      <span className="cape-display-bottom" />
    </div>
  </div>;
}
