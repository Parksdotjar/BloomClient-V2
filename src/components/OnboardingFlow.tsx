import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "../services/invoke";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRightIcon as ArrowRight,
  ArrowLeftIcon as ArrowLeft,
  MonitorIcon as Monitor,
  MoonIcon as Moon,
  SunIcon as Sun,
  CheckIcon as Check,
  FolderOpenIcon as FolderOpen,
  CopyIcon as Copy,
  ArrowSquareOutIcon as ExternalLink,
  ArrowsOutSimpleIcon as Maximize2,
  MinusIcon as Minus,
  ArrowsClockwiseIcon as RefreshCw,
  XIcon as X } from "@phosphor-icons/react";
import { accentPresets } from "../services/accent-preferences";
import { CustomAccentPicker } from "./CustomAccentPicker";
import { AppearanceThumbnail } from "./AppearanceThumbnail";
import "./onboarding.css";

export type OnboardingProfile = { id: string; name: string };

type SetupChoices = { theme: "oled" | "light" | "system"; accent: string };
const modes = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "oled", label: "Dark", Icon: Moon },
  { value: "light", label: "Light", Icon: Sun },
] as const;
const steps = ["Appearance", "Accent", "Client location", "Minecraft account"];

type DeviceCode = {
  user_code: string;
  verification_uri: string;
  device_code: string;
  interval: number;
  expires_in: number;
};

type Phase = "welcome" | "requesting" | "authorize" | "success" | "error";

function safeMicrosoftUrl(value: string) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol === "https:" && (host === "microsoft.com" || host.endsWith(".microsoft.com") || host === "microsoftonline.com" || host.endsWith(".microsoftonline.com") || host === "live.com" || host.endsWith(".live.com"))) return parsed.href;
  } catch {}
  return "https://microsoft.com/devicelogin";
}

function OnboardingTitlebar() {
  return <header className="onboarding-titlebar" data-tauri-drag-region>
    <div className="onboarding-window-controls">
      <button aria-label="Minimize Delight Client" onClick={() => void getCurrentWindow().minimize()}><Minus size={16} /></button>
      <button aria-label="Maximize or restore Delight Client" onClick={() => void getCurrentWindow().toggleMaximize()}><Maximize2 size={15} /></button>
      <button className="close" aria-label="Close Delight Client" onClick={() => void invoke("exit_application")}><X size={17} /></button>
    </div>
  </header>;
}

export function OnboardingSplash() {
  return <div className="onboarding-shell onboarding-splash">
    <OnboardingTitlebar />
    <main className="onboarding-main"><div className="onboarding-brand" aria-label="Starting Delight Client"><img src={new URL("delight-logo.png", document.baseURI).href} alt="" /></div></main>
  </div>;
}

export function OnboardingFlow({
  clientId,
  initial, onExitPreview, onComplete,
  onPreviewCosmetics,
}: {
  clientId: string;
  initial: SetupChoices;
  onExitPreview?: () => void;
  onComplete: (profile: OnboardingProfile, choices: SetupChoices) => void;
  onPreviewCosmetics?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [choices, setChoices] = useState<SetupChoices>(() => ({
    theme: initial.theme, accent: initial.accent,
  }));
  const [storage, setStorage] = useState<{defaultPath:string; path:string | null; existing:boolean}>();
  const [parentFolder, setParentFolder] = useState("");
  const [useDefault, setUseDefault] = useState(false);
  useEffect(() => {
    invoke<{defaultPath:string; path:string | null; existing:boolean}>("onboarding_storage")
      .then(setStorage).catch(() => setError("Couldn’t read the launcher location."));
  }, []);
  const preview = Boolean(onExitPreview);
  const attempt = useRef(0);
  const [phase, setPhase] = useState<Phase>("welcome");
  const [code, setCode] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("https://microsoft.com/devicelogin");
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [error, setError] = useState("");
  const [localPreview, setLocalPreview] = useState(false);
  const checkLocalPreview = Boolean(onPreviewCosmetics);
  useEffect(() => {
    if (!checkLocalPreview) return;
    let active = true;
    void invoke<{ localPreview?: boolean; items: unknown[] }>("cosmetics_request", {
      method: "GET", path: "/v1/hats/shop", accountId: null, body: null,
    }).then(catalog => {
      if (active) setLocalPreview(catalog.localPreview === true && catalog.items.length > 0);
    }).catch(() => {});
    return () => { active = false; };
  }, [checkLocalPreview]);

  useEffect(() => () => { attempt.current += 1; }, []);

  const begin = async () => {
    const attemptId = ++attempt.current;
    setPhase("requesting");
    setCode("");
    setCopied(false);
    setCopying(false);
    setProfile(null);
    setError("");
    if (preview) {
      setCode("PREVIEW1");
      setPhase("authorize");
      return;
    }
    try {
      if (parentFolder) {
        await invoke("init_onboarding_storage", {parent:parentFolder});
        setStorage(current => current && ({...current, existing:true, path:parentFolder.replace(/[\\/]$/, "") + "/Delight Client"}));
        setUseDefault(false);
        setParentFolder("");
      }
      const device = await invoke<DeviceCode>("request_microsoft_device_code", { clientId });
      if (attempt.current !== attemptId) return;
      setCode(device.user_code);
      setVerificationUrl(safeMicrosoftUrl(device.verification_uri));
      setPhase("authorize");
      const connected = await invoke<OnboardingProfile>("complete_microsoft_login", {
        clientId,
        deviceCode: device.device_code,
        interval: device.interval,
        expiresIn: device.expires_in,
      });
      if (attempt.current !== attemptId) return;
      setProfile(connected);
      setPhase("success");
    } catch (reason) {
      if (attempt.current !== attemptId) return;
      setError(String(reason));
      setPhase("error");
    }
  };

  const copyCode = async () => {
    if (!code || copying || copied) return;
    setCopying(true);
    try {
      await invoke("copy_text_to_clipboard", { text: code });
      setCopied(true);
      setError("");
    } catch (reason) { setError(String(reason)); }
    finally { setCopying(false); }
  };

  const openMicrosoft = async () => {
    if (preview) {
      setProfile({ id: "preview", name: "Preview player" });
      setPhase("success");
      return;
    }
    try {
      await openUrl(verificationUrl);
    } catch {
      setError("Delight could not open your browser.");
    }
  };

  return (
    <div className="onboarding-shell setup-wizard" data-mode={choices.theme}
      style={{ "--setup-accent": choices.accent } as CSSProperties}>
      <OnboardingTitlebar />
      <nav className="setup-navigation" aria-label="Setup progress">
        {step > 0 && (step < 3 || phase === "welcome" || phase === "error") && <button className="setup-back" onClick={() => {if (phase === "error") setPhase("welcome"); setStep(step - 1);}}><ArrowLeft size={16} /> Back</button>}
        <div className="setup-progress" role="progressbar" aria-label={steps[step]} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={step + 1}>
          <i style={{ width: ((step + 1) / steps.length * 100) + "%" }} />
        </div>
        <span className="setup-count">{step + 1} / {steps.length}</span>
      </nav>
      <main className="onboarding-main">
        <section className={`onboarding-flow phase-${phase}`} aria-label={steps[step]}>
          {step < 3 && <div className="onboarding-step setup-choice" key={step}>
            <h1>{["Choose your appearance", "Pick an accent color", "Where should Delight live?"][step]}</h1>
            <p>{["Follow your system appearance or choose a look for Delight.", "Your selection colors highlights and controls across the launcher.", "Choose where Delight stores its launcher data, Minecraft files and new instances."][step]}</p>
            {step === 0 && <div className="setup-modes">{modes.map(({value, label, Icon}) =>
              <button key={value} aria-pressed={choices.theme === value} onClick={() => setChoices({...choices, theme: value})}>
                <AppearanceThumbnail mode={value} />
                <span><Icon size={15}/>{label}{choices.theme === value && <Check size={14}/>}</span>
              </button>)}</div>}
            {step === 1 && <div className="setup-colors">{accentPresets.map(({name,color}) =>
              <button key={name} aria-pressed={choices.accent === color} onClick={() => setChoices({...choices, accent:color})}>
                <i style={{background:color}}>{choices.accent === color && <Check size={18}/>}</i>{name}
              </button>)}
              <CustomAccentPicker rainbow value={choices.accent} onApply={accent => setChoices(current => ({...current, accent}))} />
            </div>}
            {step === 2 && <div className="setup-storage" role="group" aria-label="Client location">
              <button aria-pressed={!parentFolder && (useDefault || !storage?.path)} disabled={!preview && Boolean(storage?.path)}
                onClick={() => {setParentFolder(""); setUseDefault(true); setError("");}}>
                <FolderOpen size={20}/><span><strong>Default location</strong><small>{(preview ? storage?.defaultPath.replace(/([\\/])BloomClient$/i, "$1Delight Client") : storage?.defaultPath) ?? "System application data"}</small></span>
              </button>
              <button aria-pressed={Boolean(parentFolder || (!useDefault && storage?.path))} disabled={!preview && (!storage || storage.existing)}
                onClick={async () => {try {
                  const folder = await invoke<string | null>("choose_game_directory");
                  if (folder) setParentFolder(folder);
                  setError("");
                } catch { setError("Couldn’t open the folder picker. Try again."); }}}>
                <FolderOpen size={20}/><span><strong>Choose a location</strong>
                <small>{parentFolder ? parentFolder.replace(/[\\/]$/, "") + "/Delight Client" : storage?.path ?? "Create a Delight Client folder on another drive"}</small></span>
              </button>
              {!preview && storage?.existing && <small>Your existing library keeps its current location.</small>}
              {error && <p role="alert">{error}</p>}
            </div>}
            <button className="onboarding-primary" onClick={() => {setError(""); setStep(step + 1);}}>Next <ArrowRight size={16}/></button>
          </div>}
          {step === 3 && <>
          {phase === "welcome" && <div className="onboarding-step onboarding-welcome">
            <img className="onboarding-step-logo" src={new URL("delight-logo.png", document.baseURI).href} alt="" />
            <h1>Connect your Minecraft account</h1>
            <p>Use the Microsoft account you play Java Edition with.</p>
            <button className="onboarding-primary microsoft" onClick={() => void begin()}>
              <span><img src={new URL("microsoft-logo.svg", document.baseURI).href} alt="" /></span>
              Connect Microsoft
            </button>
            {preview && <button className="setup-reset" onClick={onExitPreview}>Finish without signing in</button>}
            {localPreview && <button className="onboarding-preview" onClick={onPreviewCosmetics}>Preview local cosmetics <ArrowRight size={16}/></button>}
          </div>}

          {phase === "requesting" && <div className="onboarding-step onboarding-requesting">
            <RefreshCw size={25} aria-hidden="true" />
            <h1>Getting your code</h1>
          </div>}

          {phase === "authorize" && <div className="onboarding-step onboarding-authorize">
            <img className="onboarding-step-logo" src={new URL("delight-logo.png", document.baseURI).href} alt="" />
            <h1>Connect Microsoft</h1>
            <div className={`onboarding-code-stack ${copied ? "copied" : ""}`}>
              <button className="onboarding-code-card" disabled={copying || copied} onClick={() => void copyCode()} aria-label={`Copy Microsoft code ${code}`}>
                {!copied && <small>{copying ? "Copying" : "Copy this code"}</small>}
                <strong>{code}</strong>
                {!copied && <span><Copy size={17} />{copying ? "Copying" : "Copy code"}</span>}
              </button>
              <div className="onboarding-browser-reveal" aria-hidden={!copied}>
                <button tabIndex={copied ? 0 : -1} onClick={() => void openMicrosoft()}>
                  <span><b>Open Microsoft sign-in</b><small>microsoft.com/devicelogin</small></span>
                  <ExternalLink size={19} />
                </button>
              </div>
            </div>
            {error && <p className="onboarding-error" role="alert">{error}</p>}
            <div className="onboarding-waiting"><RefreshCw size={14} aria-hidden="true" /> Waiting for Microsoft</div>
          </div>}

          {phase === "success" && profile && <div className="onboarding-step onboarding-success">
            <h1>You're connected</h1>
            <p>{profile.name}</p>
            <button className="onboarding-primary" onClick={() => preview ? onExitPreview?.() : onComplete(profile, choices)}>
              Continue to launcher <ArrowRight size={18} />
            </button>
          </div>}

          {phase === "error" && <div className="onboarding-step onboarding-failed">
            <h1>Couldn’t connect</h1>
            <p>{error}</p>
            <button className="onboarding-primary" onClick={() => void begin()}><RefreshCw size={17} /> Try again</button>
          </div>}
          </>}
        </section>
      </main>
      {preview && <footer className="setup-preview-footer"><span>Developer preview · Changes are temporary</span><button onClick={onExitPreview}>Exit preview</button></footer>}
    </div>
  );
}
