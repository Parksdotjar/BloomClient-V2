import { useId, useRef, useState, type ComponentType } from "react";
import { ChevronDown, Volume2 } from "lucide-react";
import { ToolbarDrawer } from "./ConnectedToolbar";
import { playInteractionSound, type InteractionSoundSettings, type SoundCategory, type SoundCue } from "../services/interaction-sounds";
import "./sound-settings.css";

const effects: { category: SoundCategory; label: string; description: string; cue: SoundCue; toggleLabel: string; previewLabel: string }[] = [
  { category: "buttons", label: "Buttons", description: "A crisp, rounded hit with a short tail.", cue: "button", toggleLabel: "Button sounds", previewLabel: "Preview buttons" },
  { category: "toggles", label: "Toggles", description: "A sweep into a higher on or lower off tone.", cue: "toggleOn", toggleLabel: "Toggle sounds", previewLabel: "Preview toggles" },
  { category: "scroll", label: "Scrolling", description: "Ticks follow your speed, then slow with you.", cue: "scroll", toggleLabel: "Scroll sounds", previewLabel: "Preview scrolling" },
  { category: "success", label: "Confirmations", description: "A short finish for completed actions.", cue: "success", toggleLabel: "Confirmation sounds", previewLabel: "Preview confirmations" },
];

export function SoundSettings({ value, onChange, paused, ToggleControl }: {
  value: InteractionSoundSettings;
  onChange: (value: InteractionSoundSettings) => void;
  paused: boolean;
  ToggleControl: ComponentType<{ value: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string }>;
}) {
  const id = useId();
  const [advanced, setAdvanced] = useState(false);
  const [previewMessage, setPreviewMessage] = useState("");
  const nextToggleOn = useRef(true);
  const previewPending = useRef(false);
  const lastPreview = useRef(-Infinity);
  const preview = async (cue: SoundCue) => {
    if (previewPending.current || performance.now() - lastPreview.current < 260) return;
    lastPreview.current = performance.now();
    previewPending.current = true;
    const selected = cue === "toggleOn" ? nextToggleOn.current ? "toggleOn" : "toggleOff" : cue;
    const played = await playInteractionSound(selected, { preview: true });
    previewPending.current = false;
    if (played && cue === "toggleOn") nextToggleOn.current = !nextToggleOn.current;
    setPreviewMessage(played ? "" : paused ? "Sounds are paused in Ultra Performance Mode." : value.volume === 0 ? "Raise the volume to hear a preview." : "Audio is unavailable right now. Try the preview again.");
  };
  const slider = (key: "volume" | "depth" | "echo", label: string, description: string) => <label className="sound-slider" htmlFor={`${id}-${key}`}>
    <span><b>{label}</b><small>{description}</small></span>
    <span className="sound-slider-control"><input id={`${id}-${key}`} type="range" min="0" max="100" step="1" aria-label={`Sound ${key}`} value={value[key]}
      onChange={event => onChange({ ...value, [key]: Number(event.target.value) })} /><output htmlFor={`${id}-${key}`}>{value[key]}%</output></span>
  </label>;

  return <div className="settings-card sound-settings" data-ui-sound="none">
    <div className="setting-row">
      <div><b>Interface sounds</b><p>A distinct sound for each interaction.</p></div>
      <ToggleControl label="Interface sounds" value={value.enabled} onChange={enabled => onChange({ ...value, enabled })} />
    </div>
    {slider("volume", "Volume", paused ? "Paused in Ultra Performance Mode." : value.enabled ? "Changes apply immediately." : "Sounds are off. You can still preview them.")}
    <button type="button" className="sound-disclosure" aria-label="Advanced sound settings" aria-expanded={advanced} aria-controls={`${id}-advanced`} onClick={() => setAdvanced(!advanced)}>
      <span>Advanced sounds</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    <ToolbarDrawer id={`${id}-advanced`} open={advanced} className="sound-advanced">
      <div className="sound-effects">
        {effects.map(effect => <div className="sound-effect" key={effect.category}>
          <div><b>{effect.label}</b><p>{effect.description}</p></div>
          <div className="sound-effect-controls">
            <button type="button" className="sound-preview" aria-label={effect.previewLabel} title={effect.previewLabel} onClick={() => void preview(effect.cue)}><Volume2 size={17} aria-hidden="true" /></button>
            <ToggleControl label={effect.toggleLabel} value={value.categories[effect.category]} onChange={enabled => onChange({ ...value, categories: { ...value.categories, [effect.category]: enabled } })} />
          </div>
        </div>)}
      </div>
      <div className="sound-tone">
        {slider("depth", "Depth", "From firm and clear to lower and rounder.")}
        {slider("echo", "Tiny echo", "A close reflection. Scroll ticks always stay dry.")}
      </div>
      <p className="sound-preview-hint">Previews play even when an effect is switched off. Toggle previews alternate on and off.</p>
      <p className="sound-preview-status" role="status">{previewMessage}</p>
    </ToolbarDrawer>
  </div>;
}
