import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowRight,
  Copy,
  ExternalLink,
  Maximize2,
  Minus,
  RefreshCw,
  X,
} from "lucide-react";
import "./onboarding.css";

export type OnboardingProfile = { id: string; name: string };

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
      <button aria-label="Minimize Bloom Client" onClick={() => void getCurrentWindow().minimize()}><Minus size={16} /></button>
      <button aria-label="Maximize or restore Bloom Client" onClick={() => void getCurrentWindow().toggleMaximize()}><Maximize2 size={15} /></button>
      <button className="close" aria-label="Close Bloom Client" onClick={() => void invoke("exit_application")}><X size={17} /></button>
    </div>
  </header>;
}

export function OnboardingSplash() {
  return <div className="onboarding-shell onboarding-splash">
    <OnboardingTitlebar />
    <main className="onboarding-main"><div className="onboarding-brand" aria-label="Starting Bloom Client"><img src={new URL("bloom-logo.png", document.baseURI).href} alt="" /></div></main>
  </div>;
}

export function OnboardingFlow({
  clientId,
  onComplete,
}: {
  clientId: string;
  onComplete: (profile: OnboardingProfile) => void;
}) {
  const attempt = useRef(0);
  const [phase, setPhase] = useState<Phase>("welcome");
  const [code, setCode] = useState("");
  const [verificationUrl, setVerificationUrl] = useState("https://microsoft.com/devicelogin");
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => { attempt.current += 1; }, []);

  const begin = async () => {
    const attemptId = ++attempt.current;
    setPhase("requesting");
    setCode("");
    setCopied(false);
    setCopying(false);
    setProfile(null);
    setError("");
    try {
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
    try {
      await openUrl(verificationUrl);
    } catch {
      setError("Bloom could not open your browser.");
    }
  };

  return (
    <div className="onboarding-shell">
      <OnboardingTitlebar />

      <main className="onboarding-main">
        <section className={`onboarding-flow phase-${phase}`} aria-live="polite">
          {phase === "welcome" && <div className="onboarding-step onboarding-welcome">
            <img className="onboarding-step-logo" src={new URL("bloom-logo.png", document.baseURI).href} alt="" />
            <h1>Welcome to Bloom</h1>
            <button className="onboarding-primary microsoft" onClick={() => void begin()}>
              <span><img src={new URL("microsoft-logo.svg", document.baseURI).href} alt="" /></span>
              Connect Microsoft
            </button>
          </div>}

          {phase === "requesting" && <div className="onboarding-step onboarding-requesting">
            <RefreshCw size={25} aria-hidden="true" />
            <h1>Getting your code</h1>
          </div>}

          {phase === "authorize" && <div className="onboarding-step onboarding-authorize">
            <img className="onboarding-step-logo" src={new URL("bloom-logo.png", document.baseURI).href} alt="" />
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
            <button className="onboarding-primary" onClick={() => onComplete(profile)}>
              Continue to launcher <ArrowRight size={18} />
            </button>
          </div>}

          {phase === "error" && <div className="onboarding-step onboarding-failed">
            <h1>Couldn’t connect</h1>
            <p>{error}</p>
            <button className="onboarding-primary" onClick={() => void begin()}><RefreshCw size={17} /> Try again</button>
          </div>}
        </section>
      </main>
    </div>
  );
}
