import type { ComponentType } from "react";

export type SakuraSettings = { server: string; renderDistance: number; fpsLimit: number };
export const defaultSakuraSettings: SakuraSettings = { server: "", renderDistance: 8, fpsLimit: 0 };

export function SakuraSettingsFields({ value, onChange, SelectControl }: {
  value: SakuraSettings;
  onChange: (settings: SakuraSettings) => void;
  SelectControl: ComponentType<{ value: string; options: string[]; onChange: (value: string) => void }>;
}) {
  return <>
    <label className="instance-field"><span>Server address</span><input value={value.server} onChange={event => onChange({ ...value, server: event.target.value })} placeholder="play.example.com:25565" autoComplete="off" spellCheck={false} maxLength={253} /></label>
    <label className="instance-field"><span>Render distance</span><SelectControl value={`${value.renderDistance} chunks`} options={[2, 4, 6, 8, 10, 12, 16].map(distance => `${distance} chunks`)} onChange={distance => onChange({ ...value, renderDistance: Number.parseInt(distance, 10) })} /></label>
    <label className="instance-field"><span>Frame limit</span><SelectControl value={value.fpsLimit === 0 ? "VSync" : `${value.fpsLimit} FPS`} options={["VSync", "60 FPS", "120 FPS", "144 FPS", "165 FPS", "240 FPS", "360 FPS", "1000 FPS"]} onChange={limit => onChange({ ...value, fpsLimit: limit === "VSync" ? 0 : Number.parseInt(limit, 10) })} /></label>
  </>;
}
