import { useEffect, useState, type CSSProperties } from "react";
import { StackIcon as Layers } from "@phosphor-icons/react";
import { CapeDisplay } from "./CapeDisplay";
import type { CosmeticUnlock } from "./Locker";

export type DesktopCosmeticUnlock = CosmeticUnlock & { sequence: number; receivedAt: number; preview?: true };

const pieces = [
  [-26, -43, 88, -155, 0], [-18, -31, 112, 145, 55], [-12, -16, 74, -120, 0],
  [-5, -39, 124, 210, 95], [-2, 10, 96, 170, 30], [7, 27, 110, -190, 65],
  [11, 12, 82, 125, 0], [16, 36, 130, 185, 90], [21, 46, 100, -205, 15],
  [26, 55, 77, 135, 55], [-23, -52, 104, 195, 25], [2, -4, 135, -215, 100],
] as const;

export function CosmeticConfetti({ motion }: { motion: boolean }) {
  const [show, setShow] = useState(() => motion && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    if (!show) return;
    const timeout = window.setTimeout(() => setShow(false), 1200);
    return () => window.clearTimeout(timeout);
  }, [show]);

  if (!show || !motion) return null;
  return <span className="desktop-island-confetti" aria-hidden="true">
    {pieces.map(([start, drift, fall, turn, delay], index) =>
      <i key={index} style={{
        "--confetti-start": `${start}px`,
        "--confetti-drift": `${drift}px`,
        "--confetti-fall": `${fall}px`,
        "--confetti-turn": `${turn}deg`,
        "--confetti-delay": `${delay}ms`,
      } as CSSProperties} />)}
  </span>;
}

export function CosmeticUnlockArtwork({ textureUrl }: { textureUrl?: string }) {
  return <span className="desktop-island-cosmetic-art" aria-hidden="true">
    {textureUrl ? <CapeDisplay texture={textureUrl} motion={false} /> : <Layers size={14} />}
  </span>;
}
