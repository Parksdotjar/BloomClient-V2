import { createContext, useEffect, useState } from "react";
import { wallpaperPalette } from "../services/wallpaper-palette";
import "./wallpaper-accents.css";

export const WallpaperSourceContext = createContext<string | null | undefined>(undefined);

export function WallpaperAccents({ source, value, onApply }: { source: string | null; value: string | null; onApply: (color: string) => void }) {
  const [result, setResult] = useState<{ source: string; colors: string[] } | null>(null);
  useEffect(() => {
    if (!source) return;
    let current = true;
    void wallpaperPalette(source).then(colors => { if (current) setResult({ source, colors }); });
    return () => { current = false; };
  }, [source]);
  if (!source) return <div className="wallpaper-accents"><span>Add an image in Background to sample colors.</span></div>;
  if (result?.source !== source) return <div className="wallpaper-accents" role="status"><span>Sampling wallpaper…</span></div>;
  if (!result.colors.length) return <div className="wallpaper-accents"><span>No colors could be sampled from this image.</span></div>;
  return <div className="wallpaper-accents" role="group" aria-label="Colors from wallpaper">
    <span>From wallpaper</span>
    <div className="accent-picks wallpaper-accent-swatches">{result.colors.map(color => <button key={color} type="button" className={value?.toLowerCase() === color ? "picked" : ""} style={{ background: color }} aria-label={`Use wallpaper color ${color}`} aria-pressed={value?.toLowerCase() === color} title={color.toUpperCase()} onClick={() => onApply(color)} />)}</div>
  </div>;
}
