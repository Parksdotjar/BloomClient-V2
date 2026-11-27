import { useId } from "react";
import "./appearance-thumbnail.css";

export function AppearanceThumbnail({ mode }: { mode: "system" | "oled" | "light" }) {
  const clip = useId().replace(/:/g, "");
  const pane = (light: boolean) => <g className={light ? "appearance-mini-light" : "appearance-mini-dark"}>
    <rect width="120" height="72" fill="var(--mini-frame)" />
    <rect x="12" y="8" width="106" height="62" rx="3" fill="var(--mini-page)" />
    <rect x="49" y="2" width="17" height="3" rx="1.5" fill="var(--mini-ink)" opacity=".55" />
    {[12,23,34,45,61].map(y => <rect key={y} x="3" y={y} width="5" height="5" rx="1" fill="var(--mini-ink)" opacity=".6" />)}
    <rect x="18" y="14" width="94" height="32" rx="3" fill="var(--mini-banner)" />
    <path d="m18 42 23-17 15 11 16-13 40 20v3H18Z" fill="var(--mini-page)" opacity=".4" />
    <rect x="24" y="25" width="26" height="3" rx="1" fill="var(--mini-ink)" />
    <rect x="24" y="32" width="18" height="7" rx="2" fill="var(--mini-accent)" />
    {[18,50,82].map(x => <rect key={x} x={x} y="51" width="29" height="13" rx="2" fill="var(--mini-banner)" />)}
  </g>;
  return <svg className="appearance-mini" aria-hidden="true" viewBox="0 0 120 72">
    {pane(mode === "light")}
    {mode === "system" && <><defs><clipPath id={clip}><rect width="60" height="72" /></clipPath></defs><g clipPath={`url(#${clip})`}>{pane(true)}</g></>}
  </svg>;
}
