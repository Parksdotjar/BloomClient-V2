import {
  StrictMode,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { animate } from "animejs";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Clipboard,
  Cuboid,
  Download,
  FolderOpen,
  House,
  Layers3,
  ImagePlus,
  MoreHorizontal,
  Minus,
  PackageOpen,
  Palette,
  Play,
  Plus,
  Puzzle,
  Rocket,
  Search,
  Settings as SettingsIcon,
  Shield,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  UserRound,
  ArrowLeft as X,
  Square,
  X as CloseIcon,
} from "lucide-react";
import "./styles.css";
import { monitorBackend } from "./services/backend";

type Theme = "dark" | "oled" | "dusk";
type SettingsState = {
  theme: Theme;
  accent: string;
  animations: boolean;
  tray: boolean;
  updates: boolean;
  memory: string;
  java: string;
  closeAfterLaunch: boolean;
  analytics: boolean;
  crashReports: boolean;
  debugLogging: boolean;
};
const defaults: SettingsState = {
  theme: "dark",
  accent: "#8ee365",
  animations: true,
  tray: true,
  updates: true,
  memory: "4096 MB",
  java: "Automatic",
  closeAfterLaunch: false,
  analytics: false,
  crashReports: true,
  debugLogging: false,
};
const nav = [
  [House, "Home"],
  [Layers3, "Instances"],
  [SettingsIcon, "Settings"],
] as const;
const settingTabs = [
  [SettingsIcon, "General"],
  [Palette, "Appearance"],
  [SlidersHorizontal, "Performance"],
  [Cuboid, "Minecraft"],
  [Rocket, "Launcher"],
  [Shield, "Privacy"],
  [UserRound, "My Profile"],
  [TerminalSquare, "Advanced"],
] as const;

function EmptySlot({
  title = "Empty slot",
  sub = "Create an instance to get started",
}: {
  title?: string;
  sub?: string;
}) {
  return (
    <div className="empty-slot">
      <span className="empty-plus">
        <CirclePlus size={16} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{sub}</p>
      </div>
    </div>
  );
}
function Toggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const change = () => {
    const next = !value;
    onChange(next);
    if (ref.current)
      animate(ref.current, {
        translateX: next ? 16 : 0,
        duration: 220,
        ease: "out(3)",
      });
  };
  return (
    <button
      className={"toggle " + (value ? "on" : "off")}
      onClick={change}
      aria-pressed={value}
    >
      <span ref={ref} />
    </button>
  );
}
function Select({
  value,
  options,
  onChange,
  variant = "default",
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  variant?: "default" | "filter";
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 184 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (bounds) setMenuPosition({ top: bounds.bottom + 6, left: Math.min(bounds.left, window.innerWidth - Math.max(bounds.width, 150) - 8), width: Math.max(bounds.width, 150) });
    };
    const closeOutside = (event: PointerEvent) => { const target = event.target as Node; if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false); };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", closeOutside);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", closeOutside); };
  }, [open]);
  return (
    <div className={`select-wrap ${variant === "filter" ? `filter-select ${value !== "All" ? "filtered" : ""}` : ""}`}>
      <button
        ref={triggerRef}
        className="select-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={variant === "filter" ? `Filter instances: ${value}` : undefined}
        title={variant === "filter" ? `Filter: ${value}` : undefined}
      >
        {variant === "filter" ? <SlidersHorizontal size={17} /> : <>{value}<ChevronDown size={15} className={open ? "rotated" : ""} /></>}
      </button>
      {open && createPortal(
        <div ref={menuRef} className="select-menu select-menu-portal" style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, right: "auto", width: menuPosition.width }}>
          {options.map((option) => (
            <button
              className={option === value ? "chosen" : ""}
              key={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>, document.body
      )}
    </div>
  );
}
function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <b>{title}</b>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

// Temporary: Prism's recognized public client ID. Replace with Bloom's approved ID via VITE_MICROSOFT_CLIENT_ID later.
const MICROSOFT_CLIENT_ID =
  import.meta.env.VITE_MICROSOFT_CLIENT_ID ||
  "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";

type MinecraftProfile = { id: string; name: string };

function SignInPanel({
  onClose,
  onSignedIn,
}: {
  onClose: () => void;
  onSignedIn: (profile: MinecraftProfile) => void;
}) {
  const loginStarted = useRef(false);
  const [copied, setCopied] = useState(false);
  const [handoffReady, setHandoffReady] = useState(false);
  const [status, setStatus] = useState("Requesting a Microsoft sign-in code…");
  const [code, setCode] = useState("");
  const [verificationUri, setVerificationUri] = useState(
    "https://microsoft.com/devicelogin",
  );
  const copyCode = async () => {
    if (!code) return;
    await navigator.clipboard?.writeText(code);
    setHandoffReady(true);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  const startMicrosoftLogin = async () => {
    try {
      const device = await invoke<{
        user_code: string;
        verification_uri: string;
        message: string;
        device_code: string;
        interval: number;
        expires_in: number;
      }>("request_microsoft_device_code", { clientId: MICROSOFT_CLIENT_ID });
      setCode(device.user_code);
      setVerificationUri(device.verification_uri);
      setStatus("Code ready. Copy it, then open Microsoft sign-in below.");
      const profile = await invoke<MinecraftProfile>(
        "complete_microsoft_login",
        {
          clientId: MICROSOFT_CLIENT_ID,
          deviceCode: device.device_code,
          interval: device.interval,
          expiresIn: device.expires_in,
        },
      );
      onSignedIn(profile);
    } catch (error) {
      setStatus(String(error));
    }
  };
  useEffect(() => {
    if (loginStarted.current) return;
    loginStarted.current = true;
    void startMicrosoftLogin();
  }, []);
  return (
    <div className={"signin-panel " + (copied ? "copied" : "")}>
      <div
        className={
          "device-code handoff-box " + (handoffReady ? "handoff-ready" : "")
        }
      >
        {handoffReady ? (
          <button
            className="handoff-link"
            onClick={() => openUrl(verificationUri)}
          >
            Open Microsoft sign-in <ChevronRight size={15} />
          </button>
        ) : (
          <>
            <strong>{code || "•••• ••••"}</strong>
            <button onClick={copyCode} aria-label="Copy sign-in code">
              {copied ? <Check size={17} /> : <Clipboard size={17} />}
            </button>
          </>
        )}
      </div>
      {copied && <div className="copy-toast">Copied</div>}
      {!status.startsWith("Requesting") && !status.startsWith("Code ready") && <div className="signin-error">{status}</div>}
    </div>
  );
}
function SettingsPage({
  settings,
  setSettings,
  onSignOut,
  profile,
  profileIcon,
  onProfileIconChange,
  initialTab,
  navigationKey,
}: {
  settings: SettingsState;
  setSettings: (s: SettingsState) => void;
  onSignOut: () => void;
  profile: MinecraftProfile | null;
  profileIcon: string | null;
  onProfileIconChange: (icon: string) => void;
  initialTab?: string;
  navigationKey: number;
}) {
  const update = <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K],
  ) => setSettings({ ...settings, [key]: value });
  const [activeTab, setActiveTab] = useState("General");
  const [profileMessage, setProfileMessage] = useState("");
  const profileIconInput = useRef<HTMLInputElement>(null);
  const sections = useRef<Record<string, HTMLDivElement | null>>({});
  const jumpTo = (label: string) => {
    const target = sections.current[label];
    const scroller = document.querySelector(".content") as HTMLElement | null;
    if (!target || !scroller) return;
    setActiveTab(label);
    const destination = label === "General" ? 0 : Math.max(0, target.offsetTop - scroller.clientHeight / 2 + target.offsetHeight / 2);
    const distance = Math.abs(scroller.scrollTop - destination);
    animate(scroller, {
      scrollTop: destination,
      duration: Math.min(1050, Math.max(420, 420 + distance * 0.45)),
      ease: "inOut(3)",
    });
  };
  useEffect(() => { if (!initialTab) return; const timer = window.setTimeout(() => jumpTo(initialTab), 0); return () => window.clearTimeout(timer); }, [initialTab, navigationKey]);
  const section = (label: string) => ({
    ref: (node: HTMLDivElement | null) => {
      sections.current[label] = node;
    },
  });
  const chooseProfileIcon = (file?: File) => {
    if (!file) return;
    if (!profile) { setProfileMessage("Sign in before choosing a profile picture."); return; }
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 2_500_000) { setProfileMessage("Choose a PNG or JPEG smaller than 2.5 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { onProfileIconChange(String(reader.result)); setProfileMessage("Profile picture updated."); };
    reader.readAsDataURL(file);
  };
  return (
    <div className="settings-page">
      <div className="settings-heading">
        <h1>Settings</h1>
        <p>Configure Bloom Client to your liking.</p>
      </div>
      <div className="settings-layout">
        <aside className="settings-tabs">
          {settingTabs.map(([Icon, label]) => (
            <button
              className={activeTab === label ? "selected" : ""}
              key={label}
              onClick={() => jumpTo(label)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </aside>
        <div className="settings-content">
          <div className="settings-section" {...section("General")}>
            <h2>General</h2>
            <p className="section-subtitle">Basic settings for Bloom Client.</p>
            <div className="settings-card">
              <SettingRow
                title="Language"
                description="Choose your preferred language."
              >
                <Select
                  value="English (US)"
                  options={["English (US)", "Spanish", "French", "German"]}
                  onChange={() => {}}
                />
              </SettingRow>
              <SettingRow
                title="Startup Behavior"
                description="Choose what happens when Bloom Client starts."
              >
                <Select
                  value="Open Home"
                  options={["Open Home", "Open Settings", "Remember last page"]}
                  onChange={() => {}}
                />
              </SettingRow>
              <SettingRow
                title="Minimize to System Tray"
                description="Close button will minimize Bloom Client to your system tray."
              >
                <Toggle
                  value={settings.tray}
                  onChange={(v) => update("tray", v)}
                />
              </SettingRow>
              <SettingRow
                title="Check for Updates"
                description="Automatically check for updates on startup."
              >
                <Toggle
                  value={settings.updates}
                  onChange={(v) => update("updates", v)}
                />
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("Appearance")}>
            <h2>Appearance</h2>
            <p className="section-subtitle">
              Customize how Bloom Client looks.
            </p>
            <div className="settings-card">
              <SettingRow
                title="Theme"
                description="Choose your preferred theme."
              >
                <Select
                  value={
                    settings.theme === "dark"
                      ? "Dark"
                      : settings.theme === "oled"
                        ? "OLED Dark"
                        : "Dusk"
                  }
                  options={["Dark", "OLED Dark", "Dusk"]}
                  onChange={(v) =>
                    update(
                      "theme",
                      v === "OLED Dark"
                        ? "oled"
                        : v === "Dusk"
                          ? "dusk"
                          : "dark",
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                title="Accent Color"
                description="Choose the accent color for the client."
              >
                <div className="accent-picks">
                  {[
                    "#8ee365",
                    "#5d9dff",
                    "#a56bff",
                    "#e957ad",
                    "#f4a340",
                    "#f05454",
                  ].map((color) => (
                    <button
                      key={color}
                      className={settings.accent === color ? "picked" : ""}
                      style={{ background: color }}
                      onClick={() => update("accent", color)}
                      aria-label={color}
                    />
                  ))}
                </div>
              </SettingRow>
              <SettingRow
                title="Show Animations"
                description="Enable subtle animations throughout the client."
              >
                <Toggle
                  value={settings.animations}
                  onChange={(v) => update("animations", v)}
                />
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("Performance")}>
            <h2>Performance</h2>
            <p className="section-subtitle">
              Optimize performance and resource usage.
            </p>
            <div className="settings-card">
              <SettingRow
                title="Memory Allocation"
                description="Set how much RAM Minecraft can use."
              >
                <Select
                  value={settings.memory}
                  options={["2048 MB", "4096 MB", "6144 MB", "8192 MB"]}
                  onChange={(v) => update("memory", v)}
                />
              </SettingRow>
              <SettingRow
                title="Java Runtime"
                description="Choose which Java installation launches Minecraft."
              >
                <Select
                  value={settings.java}
                  options={["Automatic", "Java 8", "Java 17", "Java 21"]}
                  onChange={(v) => update("java", v)}
                />
              </SettingRow>
              <SettingRow
                title="Java Arguments"
                description="Advanced JVM arguments for Minecraft launches."
              >
                <input className="text-input" placeholder="-XX:+UseG1GC" />
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("Minecraft")}>
            <h2>Minecraft</h2>
            <p className="section-subtitle">
              Minecraft-specific defaults for future instances.
            </p>
            <div className="settings-card">
              <SettingRow
                title="Default Game Version"
                description="Used when creating a new instance."
              >
                <Select
                  value="Latest release"
                  options={["Latest release", "1.21.1", "1.20.4", "1.8.9"]}
                  onChange={() => {}}
                />
              </SettingRow>
              <SettingRow
                title="Default Mod Loader"
                description="The loader selected for new instances."
              >
                <Select
                  value="Fabric"
                  options={["Fabric", "Quilt", "Forge", "Vanilla"]}
                  onChange={() => {}}
                />
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("Launcher")}>
            <h2>Launcher</h2>
            <p className="section-subtitle">
              Control how Bloom Client starts and launches games.
            </p>
            <div className="settings-card">
              <SettingRow
                title="Launch Method"
                description="Choose how Minecraft windows open."
              >
                <Select
                  value="Standard window"
                  options={[
                    "Standard window",
                    "Borderless window",
                    "Fullscreen",
                  ]}
                  onChange={() => {}}
                />
              </SettingRow>
              <SettingRow
                title="Close Launcher After Launch"
                description="Automatically close Bloom Client after Minecraft starts."
              >
                <Toggle
                  value={settings.closeAfterLaunch}
                  onChange={(v) => update("closeAfterLaunch", v)}
                />
              </SettingRow>
              <SettingRow
                title="Download Queue"
                description="Choose how many downloads can run at once."
              >
                <Select
                  value="3 simultaneous downloads"
                  options={[
                    "1 simultaneous download",
                    "3 simultaneous downloads",
                    "5 simultaneous downloads",
                  ]}
                  onChange={() => {}}
                />
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("Privacy")}>
            <h2>Privacy</h2>
            <p className="section-subtitle">
              Choose what Bloom Client stores and shares.
            </p>
            <div className="settings-card">
              <SettingRow
                title="Usage Analytics"
                description="Help improve Bloom Client with anonymous usage data."
              >
                <Toggle
                  value={settings.analytics}
                  onChange={(v) => update("analytics", v)}
                />
              </SettingRow>
              <SettingRow
                title="Crash Reports"
                description="Send anonymous crash details when something goes wrong."
              >
                <Toggle
                  value={settings.crashReports}
                  onChange={(v) => update("crashReports", v)}
                />
              </SettingRow>
              <SettingRow
                title="News and Recommendations"
                description="Show relevant client updates and sponsored content."
              >
                <Select
                  value="Show recommendations"
                  options={["Show recommendations", "Hide recommendations"]}
                  onChange={() => {}}
                />
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("My Profile")}>
            <h2>My Profile</h2>
            <p className="section-subtitle">Your connected Minecraft account.</p>
            <div className="settings-card profile-settings-card">
              <button className="profile-settings-avatar" disabled={!profile} onClick={() => profileIconInput.current?.click()} aria-label="Change profile picture">{profileIcon ? <img src={profileIcon} alt="" /> : profile?.name.slice(0, 1).toUpperCase() || "?"}<i><ImagePlus size={13} /></i></button>
              <input ref={profileIconInput} type="file" accept="image/png,image/jpeg" hidden onChange={event => chooseProfileIcon(event.target.files?.[0])} />
              <div><b>{profile?.name || "Not signed in"}</b><span>{profile ? "Click your picture to choose a new one." : "Connect a Microsoft account from the sidebar."}</span>{profileMessage && <small>{profileMessage}</small>}</div>
            </div>
          </div>
          <div className="settings-section" {...section("Advanced")}>
            <h2>Advanced</h2>
            <p className="section-subtitle">
              Power-user settings for troubleshooting and development.
            </p>
            <div className="settings-card">
              <SettingRow
                title="Debug Logging"
                description="Write more detailed logs for troubleshooting."
              >
                <Toggle
                  value={settings.debugLogging}
                  onChange={(v) => update("debugLogging", v)}
                />
              </SettingRow>
              <SettingRow
                title="Game Directory"
                description="Choose where Minecraft files and instances are stored."
              >
                <input
                  className="text-input"
                  value="Default directory"
                  readOnly
                />
              </SettingRow>
              <SettingRow
                title="Minecraft Account"
                description="Remove the saved Microsoft account from this device."
              >
                <button className="danger-button" onClick={onSignOut}>
                  Sign out
                </button>
              </SettingRow>
              <SettingRow
                title="Reset Preferences"
                description="Return Bloom Client settings to their defaults."
              >
                <button
                  className="danger-button"
                  onClick={() => setSettings(defaults)}
                >
                  Reset settings
                </button>
              </SettingRow>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
type InstanceDraft = {
  id: string;
  name: string;
  icon?: string | null;
  loader: string;
  loaderVersion?: string | null;
  version: string;
  directory: string;
  java: string;
  memory: number;
  jvmArguments: string;
  mods: boolean;
  resourcePacks: boolean;
  shaderPacks: boolean;
  config: boolean;
  customResolution: boolean;
  visible: boolean;
  shortcut: boolean;
};
type JavaInstallation = {
  path: string;
  majorVersion: number | null;
  usable: boolean;
};
type Release = { id: string; type: string; url: string };

function NewInstancePage({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (destination: "home" | "downloads") => void;
}) {
  const [draft, setDraft] = useState<InstanceDraft>({
    id: "",
    name: "",
    loader: "Vanilla",
    version: "Latest release",
    directory: ".minecraft/instances/",
    java: "Automatic (Recommended)",
    memory: 4096,
    jvmArguments: "",
    mods: true,
    resourcePacks: true,
    shaderPacks: true,
    config: true,
    customResolution: false,
    visible: true,
    shortcut: false,
  });
  const [releases, setReleases] = useState<Release[]>([]);
  const [javas, setJavas] = useState<JavaInstallation[]>([]);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    void Promise.all([
      invoke<Release[]>("get_minecraft_releases"),
      invoke<JavaInstallation[]>("detect_java_installations"),
    ])
      .then(([releaseList, javaList]) => {
        setReleases(releaseList);
        setJavas(javaList);
        setDraft((current) => ({
          ...current,
          version: releaseList[0]?.id || current.version,
        }));
      })
      .catch((error) => setMessage(String(error)));
  }, []);
  const update = <K extends keyof InstanceDraft>(
    key: K,
    value: InstanceDraft[K],
  ) => setDraft({ ...draft, [key]: value });
  const create = async () => {
    try {
      const saved = await invoke<InstanceDraft>("save_instance", {
        config: draft,
      });
      setDraft(saved);
      setMessage(
        `${saved.loader} instance created and ready to install.`,
      );
      onCreated("home");
    } catch (error) {
      setMessage(String(error));
    }
  };
  const importPack = async () => {
    setImporting(true);
    setMessage("");
    try {
      const importedId = await invoke<string | null>("import_fabric_modpack");
      if (importedId) onCreated("downloads");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setImporting(false);
    }
  };
  const components: Array<[keyof InstanceDraft, string, string]> = [
    ["mods", "Include Mods Folder", "Create a mods folder for this instance"],
    [
      "resourcePacks",
      "Include Resource Packs Folder",
      "Create a resourcepacks folder",
    ],
    [
      "shaderPacks",
      "Include Shader Packs Folder",
      "Create a shaderpacks folder",
    ],
    ["config", "Include Config Folder", "Create a config folder"],
  ];
  const javaOptions = [
    "Automatic (Recommended)",
    ...javas
      .filter((java) => java.usable)
      .map((java) => `Java ${java.majorVersion} — ${java.path}`),
  ];
  return (
    <div className="instance-page">
      <div className="instance-heading">
        <div><h1>New Instance</h1><p>Create a new Minecraft instance to start playing.</p></div>
        <button className="import-pack-action" disabled={importing} onClick={() => void importPack()}><CirclePlus size={17} /><span>{importing ? "Opening…" : "Import"}</span></button>
      </div>
      <div className="instance-layout">
        <section className="instance-main">
          <h2>Basic Information</h2>
          <label className="instance-field">
            <span>Name</span>
            <input
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Enter instance name…"
            />
          </label>
          <label className="instance-field">
            <span>Loader</span>
            <Select value={draft.loader} options={["Vanilla", "Fabric"]} onChange={(value) => update("loader", value)} />
          </label>
          <label className="instance-field">
            <span>Version</span>
            <Select
              value={draft.version}
              options={
                releases.map((release) => release.id).length
                  ? releases.map((release) => release.id)
                  : [draft.version]
              }
              onChange={(value) => update("version", value)}
            />
          </label>
          <label className="instance-field">
            <span>Game Directory</span>
            <div className="directory-input">
              <input
                value={draft.directory}
                onChange={(event) => update("directory", event.target.value)}
              />
              <button title="Folder selection will be wired to the native backend">
                <FolderOpen size={18} />
              </button>
            </div>
          </label>
          <h2>Java Settings</h2>
          <label className="instance-field">
            <span>Java Version</span>
            <Select
              value={draft.java}
              options={javaOptions}
              onChange={(value) => update("java", value)}
            />
          </label>
          <p className="java-note">
            Detected {javas.length} Java installation
            {javas.length === 1 ? "" : "s"}. Automatic will choose the required
            runtime during launch.
          </p>
          <h2>Memory Allocation</h2>
          <div className="memory-control">
            <div>
              <b>Allocate Memory</b>
              <input
                type="range"
                min="1024"
                max="8192"
                step="512"
                value={draft.memory}
                onChange={(event) =>
                  update("memory", Number(event.target.value))
                }
                style={
                  {
                    "--memory-fill": `${((draft.memory - 1024) / 7168) * 100}%`,
                  } as CSSProperties
                }
              />
              <div className="memory-scale">
                <span>1024 MB</span>
                <span>4096 MB</span>
                <span>8192 MB</span>
              </div>
            </div>
            <output>{draft.memory} MB</output>
          </div>
          <h2>Additional Options</h2>
          <label className="instance-field">
            <span>
              JVM Arguments <small>Optional</small>
            </span>
            <textarea
              value={draft.jvmArguments}
              onChange={(event) => update("jvmArguments", event.target.value)}
              placeholder="e.g. -Xmx2G -XX:+UseG1GC"
            />
          </label>
        </section>
        <section className="instance-side">
          <h2>Select Components</h2>
          <p className="section-subtitle">
            Choose what to include in your instance.
          </p>
          <div className="settings-card">
            {components.map(([key, title, description]) => (
              <SettingRow title={title} description={description} key={key}>
                <Toggle
                  value={draft[key] as boolean}
                  onChange={(value) => update(key, value)}
                />
              </SettingRow>
            ))}
          </div>
          <h2>More Options</h2>
          <div className="settings-card">
            <SettingRow
              title="Resolution"
              description="Use custom resolution for this instance."
            >
              <Toggle
                value={draft.customResolution}
                onChange={(value) => update("customResolution", value)}
              />
            </SettingRow>
            <SettingRow
              title="Launcher Visibility"
              description="Show this instance in the launcher."
            >
              <Toggle
                value={draft.visible}
                onChange={(value) => update("visible", value)}
              />
            </SettingRow>
            <SettingRow
              title="Create Shortcut"
              description="Create a desktop shortcut for this instance."
            >
              <Toggle
                value={draft.shortcut}
                onChange={(value) => update("shortcut", value)}
              />
            </SettingRow>
          </div>
        </section>
      </div>
      <div className="instance-actions">
        <span>
          {message ||
            "Configuration will be saved to the selected game directory."}
        </span>
        <div>
          <button className="secondary-action" onClick={onCancel}>
            Cancel
          </button>
          <button className="create-instance-action" onClick={create}>
            Create Instance
          </button>
        </div>
      </div>
    </div>
  );
}
type InstanceContentItem = { id: string; name: string; version: string; fileName: string; size: number; enabled: boolean; icon?: string | null };
type CatalogMod = { provider: string; projectId: string; slug: string; title: string; summary: string; iconUrl?: string | null; author: string; downloads: number; loader: string; gameVersion: string; versionId: string; versionNumber: string; fileName: string; fileSize: number };
type CatalogSearchResult = { items: CatalogMod[]; offset: number; limit: number; total: number };
type InstanceTab = "mods" | "resourcepacks" | "shaderpacks" | "settings";

function InstancePage({ instance, busy, onPlay, onChanged, onInstallMod }: { instance: InstanceDraft; busy: boolean; onPlay: () => void; onChanged: (instance: InstanceDraft) => void; onInstallMod: (mod: CatalogMod) => void }) {
  const [tab, setTab] = useState<InstanceTab>("mods");
  const [items, setItems] = useState<InstanceContentItem[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("Name");
  const [filter, setFilter] = useState("All");
  const [contentPage, setContentPage] = useState(1);
  const [addingMods, setAddingMods] = useState(false);
  const [catalog, setCatalog] = useState<CatalogSearchResult>({ items: [], offset: 0, limit: 20, total: 0 });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState(instance.name);
  const [memory, setMemory] = useState(instance.memory);
  const [jvmArguments, setJvmArguments] = useState(instance.jvmArguments);
  const iconInput = useRef<HTMLInputElement>(null);
  const loadContent = async () => { if (tab === "settings") return; try { setItems(await invoke<InstanceContentItem[]>("list_instance_content", { instanceId: instance.id, category: tab })); } catch (error) { setMessage(String(error)); } };
  useEffect(() => { void loadContent(); const timer = window.setInterval(() => void loadContent(), 2500); const focus = () => void loadContent(); window.addEventListener("focus", focus); return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); }; }, [tab, instance.id]);
  useEffect(() => { setName(instance.name); setMemory(instance.memory); setJvmArguments(instance.jvmArguments); }, [instance]);
  useEffect(() => { if (tab !== "mods") setAddingMods(false); }, [tab]);
  useEffect(() => { setContentPage(1); }, [tab, search, filter, sort, instance.id]);
  useEffect(() => {
    if (!addingMods || tab !== "mods") return;
    setCatalogLoading(true);
    const timer = window.setTimeout(() => {
      void invoke<CatalogSearchResult>("search_modrinth_mods", { query: search, gameVersion: instance.version, offset: (contentPage - 1) * 20 })
        .then((result) => { setCatalog(result); setMessage(""); })
        .catch((error) => setMessage(String(error)))
        .finally(() => setCatalogLoading(false));
    }, search ? 320 : 0);
    return () => window.clearTimeout(timer);
  }, [addingMods, tab, search, contentPage, instance.version]);
  const toggleItem = async (item: InstanceContentItem, enabled: boolean) => { try { await invoke("toggle_instance_content", { instanceId: instance.id, category: tab, fileName: item.fileName, enabled }); await loadContent(); } catch (error) { setMessage(String(error)); } };
  const chooseIcon = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => { void invoke<InstanceDraft>("set_instance_icon", { instanceId: instance.id, icon: String(reader.result) }).then(onChanged).catch(error => setMessage(String(error))); }; reader.readAsDataURL(file); };
  const saveSettings = async () => { try { const saved = await invoke<InstanceDraft>("update_instance_settings", { instanceId: instance.id, name, memory, jvmArguments }); onChanged(saved); setMessage("Instance settings saved."); } catch (error) { setMessage(String(error)); } };
  const categoryLabel = tab === "mods" ? "Mods" : tab === "resourcepacks" ? "Resource Packs" : "Shaders";
  const visibleItems = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()) && (filter === "All" || (filter === "Enabled" ? item.enabled : !item.enabled))).sort((a, b) => sort === "Size" ? b.size - a.size : a.name.localeCompare(b.name));
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / 20));
  const safePage = Math.min(contentPage, pageCount);
  const pagedItems = visibleItems.slice((safePage - 1) * 20, safePage * 20);
  const catalogPages = Math.max(1, Math.ceil(catalog.total / 20));
  const openCatalog = () => {
    if (!instance.loader.toLowerCase().includes("fabric")) { setMessage("The built-in mod catalog currently supports Fabric instances only."); return; }
    setSearch(""); setContentPage(1); setAddingMods(true); setMessage("");
  };
  const closeCatalog = () => { setAddingMods(false); setSearch(""); setContentPage(1); setMessage(""); void loadContent(); };
  const tabs: Array<[InstanceTab, typeof Puzzle, string, string]> = [["mods", Puzzle, "Mods", "Manage your mods"], ["resourcepacks", PackageOpen, "Resource Packs", "Manage resource packs"], ["shaderpacks", Cuboid, "Shaders", "Manage shader packs"], ["settings", SettingsIcon, "Settings", "Configure instance settings"]];
  return <div className="instance-workspace">
    <section className="instance-hero-panel"><div className="instance-identity"><button className="instance-icon-picker" onClick={() => iconInput.current?.click()}>{instance.icon ? <img src={instance.icon} alt="" /> : <Cuboid size={32} />}<span><ImagePlus size={14} /></span></button><input ref={iconInput} type="file" accept="image/png,image/jpeg" hidden onChange={event => chooseIcon(event.target.files?.[0])} /><div><h1>{instance.name}</h1><p>{instance.version} • {instance.loader}</p><small>{instance.directory}</small></div></div><div className="instance-hero-actions"><button className="instance-play" disabled={busy} onClick={onPlay}><Play size={17} fill="currentColor" />Play</button><div className="instance-more-wrap"><button className="instance-more" onClick={() => setMenuOpen(value => !value)}><MoreHorizontal size={20} /></button>{menuOpen && <div className="instance-folder-menu"><button onClick={() => { setMenuOpen(false); void invoke("open_instance_folder", { instanceId: instance.id }); }}>Show in folder</button><button onClick={() => { setMenuOpen(false); void invoke("open_instance_folder", { instanceId: instance.id, category: "mods" }); }}>Open mods folder</button></div>}</div></div>
    <div className="instance-tabs">{tabs.map(([id, Icon, title, description]) => <button key={id} className={tab === id ? "selected" : ""} onClick={() => setTab(id)}><span><Icon size={22} /></span><div><b>{title}</b><small>{description}</small></div></button>)}</div></section>
    {tab === "settings" ? <section className="instance-manager settings-manager"><div className="manager-heading"><div><h2>Instance Settings</h2><p>Change settings used when this instance launches.</p></div><button className="add-content" onClick={saveSettings}>Save Changes</button></div><div className="instance-settings-grid"><label><span>Name</span><input value={name} onChange={event => setName(event.target.value)} /></label><label><span>Memory <b>{memory} MB</b></span><input type="range" min="1024" max="16384" step="512" value={memory} onChange={event => setMemory(Number(event.target.value))} /></label><label className="wide"><span>JVM Arguments</span><textarea value={jvmArguments} onChange={event => setJvmArguments(event.target.value)} placeholder="Optional Java arguments" /></label></div>{message && <p className="instance-message">{message}</p>}</section> : <section className={`instance-manager ${addingMods ? "catalog-manager" : ""}`}><div className="manager-heading"><div><h2>{addingMods ? (search ? "Search Results" : "Featured Mods") : `Installed ${categoryLabel}`} {!addingMods && <span>{items.length}</span>}</h2><p>{addingMods ? `Compatible Fabric mods for Minecraft ${instance.version} from Modrinth.` : `Files placed in this instance's ${tab} folder appear automatically.`}</p></div><div className="manager-tools">{addingMods ? <button className="catalog-close" onClick={closeCatalog} aria-label="Back to installed mods"><X size={17} /></button> : <><Select value={sort} options={["Name", "Size"]} onChange={setSort} /><button className="add-content" onClick={tab === "mods" ? openCatalog : undefined} title={tab === "mods" ? "Browse compatible Modrinth mods" : `Installing ${categoryLabel.toLowerCase()} in-app is coming later`}><CirclePlus size={16} />Add {categoryLabel}</button></>}</div></div><div className="content-list">{addingMods ? (catalogLoading ? <div className="catalog-loading"><i className="loading-dots" /><span>{search ? "Searching Modrinth" : "Loading featured mods"}</span></div> : catalog.items.length ? catalog.items.map(mod => <div className="content-item catalog-item" key={mod.projectId}><span className="content-icon">{mod.iconUrl ? <img src={mod.iconUrl} alt="" /> : <Puzzle size={22} />}</span><div className="content-name"><b>{mod.title}</b><small>{mod.versionNumber} • by {mod.author}</small></div><span className="content-loader">Fabric</span><span className="content-size">{formatBytes(mod.fileSize)}</span><button className="catalog-install" disabled={busy} onClick={() => onInstallMod(mod)} aria-label={`Install ${mod.title}`}><Plus size={18} /></button></div>) : <div className="content-empty"><Search size={24} /><b>No compatible mods found</b><span>Try a different search for Minecraft {instance.version}.</span></div>) : visibleItems.length ? pagedItems.map(item => <div className="content-item" key={item.id}><span className="content-icon">{item.icon ? <img src={item.icon} alt="" /> : <PackageOpen size={22} />}</span><div className="content-name"><b>{item.name}</b><small>{item.version || item.fileName}</small></div><span className="content-loader">{instance.loader}</span><span className="content-size">{formatBytes(item.size)}</span><Toggle value={item.enabled} onChange={value => void toggleItem(item, value)} /><button className="content-dots"><MoreHorizontal size={18} /></button></div>) : <div className="content-empty"><PackageOpen size={24} /><b>No {categoryLabel.toLowerCase()} installed</b><span>Open the folder and drag files here to get started.</span><button onClick={() => void invoke("open_instance_folder", { instanceId: instance.id, category: tab })}>Open folder</button></div>}</div>{addingMods ? catalog.total > 20 && <div className="content-pagination"><button disabled={contentPage === 1 || catalogLoading} onClick={() => setContentPage(page => page - 1)}>Previous</button><span>Page <b>{contentPage}</b> of {catalogPages}</span><button disabled={contentPage >= catalogPages || catalogLoading} onClick={() => setContentPage(page => page + 1)}>Next</button></div> : visibleItems.length > 20 && <div className="content-pagination"><button disabled={safePage === 1} onClick={() => setContentPage(safePage - 1)}>Previous</button><span>Page <b>{safePage}</b> of {pageCount}</span><button disabled={safePage === pageCount} onClick={() => setContentPage(safePage + 1)}>Next</button></div>}<div className="content-search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={addingMods ? "Search Modrinth mods..." : `Search ${categoryLabel.toLowerCase()}...`} />{!addingMods && <Select value={filter} options={["All", "Enabled", "Disabled"]} onChange={setFilter} />}</div>{message && <p className="instance-message">{message}</p>}</section>}
  </div>;
}

type DownloadViewState = { active: boolean; progress: number; state: string; message: string; instanceId?: string; downloadedBytes?: number; totalBytes?: number; bytesPerSecond?: number; taskName?: string; taskVersion?: string; taskKind?: "mod" | "game" };
type CompletedDownload = { id: string; name: string; version: string; loader?: string; targetName?: string; kind?: "mod" | "game"; completedAt: number };

const formatBytes = (bytes = 0) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

function InstancesPage({ instances, busy, onOpen, onPlay, onCreate }: { instances: InstanceDraft[]; busy: boolean; onOpen: (instance: InstanceDraft) => void; onPlay: (instance: InstanceDraft) => void; onCreate: () => void }) {
  const [query, setQuery] = useState("");
  const [loader, setLoader] = useState("All");
  const visible = instances.filter((instance) => instance.name.toLowerCase().includes(query.toLowerCase()) && (loader === "All" || instance.loader.toLowerCase() === loader.toLowerCase()));
  const loaders = ["All", ...Array.from(new Set(instances.map((instance) => instance.loader)))];
  return <div className="instances-page">
    <header className="instances-page-heading"><div><span className="instances-eyebrow">YOUR LIBRARY</span><h1>All Instances</h1><p>Every world, pack, and client setup in one place.</p></div><button className="instances-create" onClick={onCreate}><CirclePlus size={17} />New instance</button></header>
    <section className="instances-toolbar"><div className="instances-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your instances..." /></div><Select value={loader} options={loaders} onChange={setLoader} variant="filter" /><span className="instances-count">{visible.length} {visible.length === 1 ? "instance" : "instances"}</span></section>
    {visible.length ? <div className="instances-grid">{visible.map((instance) => <article className="instance-library-card" key={instance.id} onClick={() => onOpen(instance)}>
      <div className="library-card-top"><span className="library-instance-icon">{instance.icon ? <img src={instance.icon} alt="" /> : <span aria-hidden="true">?</span>}</span><span className="library-loader">{instance.loader}</span></div>
      <div className="library-card-copy"><h2>{instance.name}</h2><p>Minecraft {instance.version}</p><small title={instance.directory}>{instance.directory}</small></div>
      <div className="library-card-actions"><button className="library-play" disabled={busy} onClick={(event) => { event.stopPropagation(); onPlay(instance); }}><Play size={15} fill="currentColor" />Play</button><button className="library-folder" onClick={(event) => { event.stopPropagation(); void invoke("open_instance_folder", { instanceId: instance.id }); }}><FolderOpen size={16} /></button></div>
    </article>)}</div> : <div className="instances-empty"><Cuboid size={30} /><h2>{instances.length ? "No matching instances" : "Your library is empty"}</h2><p>{instances.length ? "Try another name or loader filter." : "Create your first instance to start building your library."}</p>{!instances.length && <button onClick={onCreate}><CirclePlus size={16} />New instance</button>}</div>}
  </div>;
}

function DownloadsPage({ download, instances, completed, onClear, onCancel }: { download: DownloadViewState; instances: InstanceDraft[]; completed: CompletedDownload[]; onClear: () => void; onCancel: () => void }) {
  const activeInstance = instances.find(instance => instance.id === download.instanceId) || instances[0];
  const failed = download.state === "error";
  const status = failed ? "Failed" : download.state === "launching" ? "Starting" : download.state === "running" ? "Ready" : download.state === "complete" ? "Completed" : "Downloading";
  return <div className="downloads-page">
    <header className="downloads-heading"><h1>Downloads</h1><p>Monitor Minecraft installations and launch tasks.</p></header>
    <section className="download-section"><h2>Active</h2>
      {download.active || failed ? <div className={`download-task active-task ${failed ? "failed-task" : ""}`}>
        <span className="download-task-icon"><Cuboid size={24} /></span>
        <div className="download-task-main"><div className="download-task-title"><div><b>{download.taskName || activeInstance?.name || "Minecraft"}</b><small>{download.taskKind === "mod" ? `${download.taskVersion || "Fabric mod"} • Installing to ${activeInstance?.name || "instance"}` : activeInstance ? `${activeInstance.version} • ${activeInstance.loader}` : "Preparing instance"}</small></div><span>{Math.round(download.progress)}%</span></div><div className="download-linear"><i style={{ width: `${download.progress}%` }} /></div></div>
        <div className="download-metrics"><span>{failed ? "Task stopped" : download.totalBytes ? `${formatBytes(download.downloadedBytes)} / ${formatBytes(download.totalBytes)}` : "Scanning files"}</span><small>{failed ? "See error" : download.bytesPerSecond ? `${formatBytes(download.bytesPerSecond)}/s` : "Calculating speed"}</small></div>
        <div className="download-task-status"><b>{status}</b><small title={download.message}>{download.message || "Preparing files"}{download.message === "Loading assets" && <i className="loading-dots" />}</small></div>{!failed && <button className="cancel-download" onClick={onCancel} aria-label="Cancel task">×</button>}
      </div> : <div className="downloads-empty"><Download size={20} /><div><b>No active downloads</b><span>New Minecraft installations will appear here.</span></div></div>}
    </section>
    <section className="download-section completed-section"><h2>Completed</h2>
      {completed.length ? completed.map(item => <div className="download-task completed-task" key={item.id}>
        <span className="download-task-icon">{item.kind === "mod" ? <Puzzle size={22} /> : <Cuboid size={22} />}</span><div className="download-task-main"><b>{item.name}</b><small>{item.kind === "mod" ? `${item.version} • Installed to ${item.targetName}` : `${item.version} • ${item.loader || "Vanilla"}`}</small></div><span className="completed-time">Completed {new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-Math.max(1, Math.round((Date.now() - item.completedAt) / 60000)), "minute")}</span><Check className="completed-check" size={20} />
      </div>) : <div className="downloads-empty compact"><Check size={18} /><div><b>No completed downloads yet</b><span>Finished installations will be saved here.</span></div></div>}
    </section>
    <footer className="downloads-footer"><span>Downloads are saved inside each instance directory.</span><button disabled={!completed.length} onClick={onClear}><Trash2 size={16} />Clear Completed</button></footer>
  </div>;
}

function App() {
  const [page, setPage] = useState<"home" | "settings" | "new-instance" | "downloads" | "instance" | "instances">(
    "home",
  );
  const [instances, setInstances] = useState<InstanceDraft[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadViewState>({
    active: false,
    progress: 0,
    state: "idle",
    message: "",
  });
  const [completedDownloads, setCompletedDownloads] = useState<CompletedDownload[]>(() => { try { return JSON.parse(localStorage.getItem("bloom-completed-downloads") || "[]").slice(0, 5); } catch { return []; } });
  const lastCompletedTask = useRef("");
  const [ringProgress, setRingProgress] = useState(0);
  const [gameRunning, setGameRunning] = useState(false);
  const [toast, setToast] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);
  const [profile, setProfile] = useState<MinecraftProfile | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("bloom-profile") || "null");
    } catch {
      return null;
    }
  });
  const [profileIcon, setProfileIcon] = useState<string | null>(() => localStorage.getItem("bloom-profile-icon"));
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState("General");
  const [settingsNavigationKey, setSettingsNavigationKey] = useState(0);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [settings, setSettings] = useState<SettingsState>(() => {
    try {
      return {
        ...defaults,
        ...JSON.parse(localStorage.getItem("bloom-settings") || "{}"),
      };
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    localStorage.setItem("bloom-settings", JSON.stringify(settings));
    document.documentElement.style.setProperty("--accent", settings.accent);
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);
  useEffect(() => monitorBackend((status) => {
    document.documentElement.dataset.backend = status?.status === "ok" ? "online" : "offline";
  }), []);
  useEffect(() => {
    if (profile) localStorage.setItem("bloom-profile", JSON.stringify(profile));
    else localStorage.removeItem("bloom-profile");
  }, [profile]);
  useEffect(() => {
    if (profileIcon) localStorage.setItem("bloom-profile-icon", profileIcon);
    else localStorage.removeItem("bloom-profile-icon");
  }, [profileIcon]);
  useEffect(() => {
    void invoke<MinecraftProfile | null>("get_saved_minecraft_profile")
      .then((savedProfile) => setProfile(savedProfile))
      .catch(() => {});
  }, []);
  useEffect(() => {
    void invoke<InstanceDraft[]>("list_instances").then(setInstances);
  }, []);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<DownloadViewState>(
      "minecraft-launch-progress",
      (event) => {
        const next = event.payload;
        if (next.state === "installing") lastCompletedTask.current = "";
        setDownload((current) => ({
          active: next.state === "installing" || next.state === "launching" || next.state === "running" || next.state === "complete",
          progress: next.progress,
          state: next.state,
          message: next.message,
          instanceId: next.instanceId,
          downloadedBytes: next.downloadedBytes,
          totalBytes: next.totalBytes,
          bytesPerSecond: next.bytesPerSecond,
          taskName: current.instanceId === next.instanceId ? current.taskName : undefined,
          taskVersion: current.instanceId === next.instanceId ? current.taskVersion : undefined,
          taskKind: current.instanceId === next.instanceId ? current.taskKind : undefined,
        }));
        if (next.state === "error") {
          setGameRunning(false);
          setToast(next.message);
          window.setTimeout(() => setToast(""), 5000);
        }
        if (next.state === "running") {
          setGameRunning(true);
        }
        if (next.state === "complete") {
          void invoke<InstanceDraft[]>("list_instances").then(setInstances);
        }
        if (next.state === "idle") {
          setGameRunning(false);
          window.setTimeout(
            () =>
              setDownload({
                active: false,
                progress: 0,
                state: "idle",
                message: "",
              }),
            700,
          );
        }
      },
    ).then((value) => {
      unlisten = value;
    });
    return () => unlisten?.();
  }, []);
  useEffect(() => { localStorage.setItem("bloom-completed-downloads", JSON.stringify(completedDownloads.slice(0, 5))); }, [completedDownloads]);
  useEffect(() => {
    if ((download.state !== "running" && download.state !== "complete") || !download.instanceId) return;
    const completionKey = `${download.state}:${download.instanceId}`;
    if (lastCompletedTask.current === completionKey) return;
    const instance = instances.find(item => item.id === download.instanceId);
    if (!instance) return;
    lastCompletedTask.current = completionKey;
    const completedItem: CompletedDownload = download.taskKind === "mod"
      ? { id: `${instance.id}-${Date.now()}`, name: download.taskName || "Mod", version: download.taskVersion || "Fabric", targetName: instance.name, kind: "mod", completedAt: Date.now() }
      : { id: `${instance.id}-${Date.now()}`, name: instance.name, version: instance.version, loader: instance.loader, kind: "game", completedAt: Date.now() };
    setCompletedDownloads(current => [completedItem, ...current.filter(item => item.name !== completedItem.name || item.targetName !== completedItem.targetName)].slice(0, 5));
  }, [download.state, download.instanceId, download.taskKind, download.taskName, download.taskVersion, instances]);
  useEffect(() => {
    if (!download.active) {
      if (download.state === "idle") setRingProgress(0);
      return;
    }
    let frame = 0;
    const draw = () => {
      setRingProgress(current => {
        const target = Math.max(1, download.progress);
        if (current >= target) return current;
        frame = window.requestAnimationFrame(draw);
        return Math.min(target, current + Math.max(1, (target - current) * 0.1));
      });
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [download.active, download.progress, download.state]);
  useEffect(() => {
    if ((download.state !== "running" && download.state !== "complete") || ringProgress < 99) return;
    const timer = window.setTimeout(() => setDownload(current => ({ ...current, active: false })), 1250);
    return () => window.clearTimeout(timer);
  }, [download.state, ringProgress]);
  useEffect(() => {
    const poll = window.setInterval(() => {
      void invoke<DownloadViewState>("get_minecraft_launch_status").then((status) => {
        if (status.state === "installing" || status.state === "launching") setDownload(current => ({ ...status, active: true, taskName: current.instanceId === status.instanceId ? current.taskName : undefined, taskVersion: current.instanceId === status.instanceId ? current.taskVersion : undefined, taskKind: current.instanceId === status.instanceId ? current.taskKind : undefined }));
      }).catch(() => {});
    }, 250);
    return () => window.clearInterval(poll);
  }, []);
  const launch = async (instance: InstanceDraft) => {
    if (download.active || gameRunning) {
      setToast("Something is already downloading or running. Please wait.");
      window.setTimeout(() => setToast(""), 3500);
      return;
    }
    setDownload({
      active: true,
      progress: 1,
      state: "installing",
      message: "Preparing Minecraft download",
      instanceId: instance.id,
      taskKind: "game",
    });
    try {
      await invoke("launch_minecraft", { instanceId: instance.id });
    } catch (error) {
      const message = String(error);
      if (message.includes("Sign in with Microsoft")) {
        setSignInOpen(true);
        setToast("Your saved profile needs a quick Microsoft reconnect before launching.");
      } else setToast(message);
      setDownload({ active: false, progress: 0, state: "idle", message: "" });
      window.setTimeout(() => setToast(""), 5000);
    }
  };
  const installMod = async (instance: InstanceDraft, mod: CatalogMod) => {
    if (download.active || gameRunning) {
      setToast("Something is already downloading or running. Please wait.");
      window.setTimeout(() => setToast(""), 3500);
      return;
    }
    setDownload({ active: true, progress: 1, state: "installing", message: `Resolving ${mod.title}`, instanceId: instance.id, taskName: mod.title, taskVersion: mod.versionNumber, taskKind: "mod" });
    try {
      await invoke("install_modrinth_mod", { instanceId: instance.id, projectId: mod.projectId });
    } catch (error) {
      setToast(String(error));
      setDownload({ active: false, progress: 0, state: "idle", message: "" });
      window.setTimeout(() => setToast(""), 5000);
    }
  };
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === "F12" ||
      (event.ctrlKey && event.shiftKey) ||
      (event.ctrlKey && event.key.toLowerCase() === "u")
    )
      event.preventDefault();
  };
  const selectedInstance = instances.find(instance => instance.id === selectedInstanceId);
  const mostRecentInstance = instances[0];
  const signOut = () => { void invoke("sign_out_minecraft").finally(() => { setProfile(null); setProfileIcon(null); setSignInOpen(false); setProfileMenuOpen(false); }); };
  const openSettings = (target = "General") => { setSettingsTarget(target); setSettingsNavigationKey(value => value + 1); setPage("settings"); };
  const showToolMessage = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  };
  const importModpack = async () => {
    if (download.active || gameRunning) return showToolMessage("Another download or game launch is already active.");
    try {
      const instanceId = await invoke<string | null>("import_fabric_modpack");
      if (!instanceId) return;
      setDownload({ active: true, progress: 1, state: "installing", message: "Preparing Fabric modpack", instanceId, taskKind: "game" });
      setPage("downloads");
      void invoke<InstanceDraft[]>("list_instances").then(setInstances);
    } catch (error) { showToolMessage(String(error)); }
  };
  const showJavaStatus = async () => {
    try {
      const installations = await invoke<JavaInstallation[]>("detect_java_installations");
      const usable = installations.filter(java => java.usable);
      showToolMessage(usable.length ? `${usable.length} usable Java runtime${usable.length === 1 ? "" : "s"} detected. Automatic selection is ready.` : "No usable Java runtime was detected. Open Settings to review Java setup.");
    } catch (error) { showToolMessage(String(error)); }
  };
  const repairInstallation = async () => {
    if (!mostRecentInstance) return showToolMessage("Create an instance before repairing Minecraft files.");
    if (download.active || gameRunning) return showToolMessage("Another download or game launch is already active.");
    setDownload({ active: true, progress: 1, state: "installing", message: "Verifying Minecraft files", instanceId: mostRecentInstance.id, taskKind: "game" });
    setPage("downloads");
    try { await invoke("repair_minecraft_installation", { instanceId: mostRecentInstance.id }); }
    catch (error) { setDownload({ active: false, progress: 0, state: "idle", message: "" }); showToolMessage(String(error)); }
  };
  return (
    <div
      className="app-shell"
      onContextMenu={handleContextMenu}
      onClick={() => { setContextMenu(null); setProfileMenuOpen(false); }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className="window-drag-region"
        data-tauri-drag-region
        onMouseDown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) {
            void getCurrentWindow().startDragging();
          }
        }}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) {
            void getCurrentWindow().toggleMaximize();
          }
        }}
      >
        <div className="window-controls">
          <button className="window-control" onClick={() => void getCurrentWindow().minimize()} aria-label="Minimize Bloom Client"><Minus size={15} /></button>
          <button className="window-control" onClick={() => void getCurrentWindow().toggleMaximize()} aria-label="Maximize or restore Bloom Client"><Square size={12} /></button>
          <button className="window-control window-close" onClick={() => void getCurrentWindow().close()} aria-label="Close Bloom Client"><CloseIcon size={15} /></button>
        </div>
      </div>
      <aside className="sidebar">
        <div className="brand">
          <img src="/bloom-logo.png" alt="Bloom logo" />
          <div>
            <b>Bloom Client</b>
            <span>Minecraft Client</span>
          </div>
        </div>
        <button
          className="new-instance"
          onClick={() => setPage("new-instance")}
        >
          <CirclePlus size={18} />
          <span>New instance</span>
        </button>
        <nav>
          {nav.map(([Icon, label], index) => (
            <button
              className={
                (page === "home" && index === 0) ||
                (page === "instances" && label === "Instances") ||
                (page === "settings" && label === "Settings")
                  ? "active"
                  : ""
              }
              key={label}
              onClick={() =>
                label === "Settings" ? openSettings() : label === "Instances" ? setPage("instances") : setPage("home")
              }
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-rule" />
        <p className="section-label">INSTANCES</p>
        <div className="instance-list">
          {instances.length ? (
            instances.slice(0, 3).map((instance) => (
              <button
                className={`sidebar-instance ${page === "instance" && selectedInstanceId === instance.id ? "active" : ""}`}
                key={instance.id}
                onClick={() => { setSelectedInstanceId(instance.id); setPage("instance"); }}
              >
                {instance.icon ? <img className="sidebar-instance-icon" src={instance.icon} alt="" /> : <span className="instance-placeholder-icon" aria-hidden="true">?</span>}
                <span>
                  <b>{instance.name}</b>
                  <small>{instance.version}</small>
                </span>
              </button>
            ))
          ) : (
            <EmptySlot
              title="No instances yet"
              sub="Your instances will appear here"
            />
          )}
        </div>
        <div className="sidebar-spacer" />
        <button className={`sidebar-link downloads-link ${page === "downloads" ? "active" : ""}`} onClick={() => setPage("downloads")}>
          <Download size={17} />
          Downloads {download.active && <span className={`download-ring ${(download.state === "running" || download.state === "complete") && ringProgress >= 99 ? "complete" : ""}`} style={{ "--download-progress": `${ringProgress}%` } as CSSProperties}>{(download.state === "running" || download.state === "complete") && ringProgress >= 99 && <Check size={12} />}</span>}
        </button>
        <button className="sidebar-link">
          <TerminalSquare size={17} />
          Logs
        </button>
        <div className="profile">
          {profile ? (
            <div className="signed-in">
              <button className="profile-trigger" onClick={(event) => { event.stopPropagation(); setProfileMenuOpen(value => !value); }}>
                <div className="avatar">{profileIcon ? <img src={profileIcon} alt="" /> : profile.name.slice(0, 1).toUpperCase()}</div>
                <div className="signed-in-name"><b>{profile.name}</b></div>
              </button>
              <button onClick={() => openSettings()}>
                <SettingsIcon size={16} />
              </button>
              {profileMenuOpen && <div className="profile-popover" onClick={event => event.stopPropagation()}>
                <button onClick={() => { setProfileMenuOpen(false); openSettings("My Profile"); }}>My profile</button>
                <div className="profile-popover-rule" />
                <button className="profile-logout" onClick={signOut}>Log out</button>
              </div>}
            </div>
          ) : (
            <button
              className="signin-button"
              onClick={() => setSignInOpen(true)}
            >
              <div className="microsoft-mark">M</div>
              <div>
                <b>Sign in with Microsoft</b>
                <span>Connect your account</span>
              </div>
            </button>
          )}
          {signInOpen && (
            <SignInPanel
              onClose={() => setSignInOpen(false)}
              onSignedIn={(nextProfile) => {
                setProfile(nextProfile);
                setSignInOpen(false);
              }}
            />
          )}
        </div>
      </aside>
      <main className="content">
        {page === "instance" && selectedInstance ? (
          <InstancePage instance={selectedInstance} busy={download.active || gameRunning} onPlay={() => void launch(selectedInstance)} onInstallMod={(mod) => void installMod(selectedInstance, mod)} onChanged={(changed) => setInstances(current => current.map(instance => instance.id === changed.id ? changed : instance))} />
        ) : page === "instances" ? (
          <InstancesPage instances={instances} busy={download.active || gameRunning} onCreate={() => setPage("new-instance")} onPlay={(instance) => void launch(instance)} onOpen={(instance) => { setSelectedInstanceId(instance.id); setPage("instance"); }} />
        ) : page === "downloads" ? (
          <DownloadsPage download={download} instances={instances} completed={completedDownloads} onClear={() => setCompletedDownloads([])} onCancel={() => void invoke("cancel_minecraft_launch")} />
        ) : page === "settings" ? (
          <SettingsPage settings={settings} setSettings={setSettings} onSignOut={signOut} profile={profile} profileIcon={profileIcon} onProfileIconChange={setProfileIcon} initialTab={settingsTarget} navigationKey={settingsNavigationKey} />
        ) : page === "new-instance" ? (
          <NewInstancePage
            onCancel={() => setPage("home")}
            onCreated={(destination) => {
              void invoke<InstanceDraft[]>("list_instances").then(setInstances);
              setPage(destination);
            }}
          />
        ) : (
          <>
            <section className="hero">
              <div>
                <h1>
                  Welcome back, <span>{profile?.name || "Parks"}</span>
                </h1>
                <p>Ready to play? Launch an instance or get started below.</p>
              </div>
              {mostRecentInstance ? <div className="hero-card hero-recent-instance">
                <div className="hero-glow" />
                <span className="hero-instance-icon">{mostRecentInstance.icon ? <img src={mostRecentInstance.icon} alt="" /> : <Cuboid size={25} />}</span>
                <div><em>Most recent instance</em><b>{mostRecentInstance.name}</b><span>{mostRecentInstance.version} • {mostRecentInstance.loader}</span></div>
                <button disabled={download.active || gameRunning} onClick={() => void launch(mostRecentInstance)}><Play size={16} fill="currentColor" /> Play</button>
              </div> : <div className="hero-card">
                <div className="hero-glow" />
                <div><b>Make something new</b><span>Create an instance to start playing</span></div>
                <button onClick={() => setPage("new-instance")}><CirclePlus size={16} /> Create</button>
              </div>}
            </section>
            <div className="rule" />
            <section>
              <h2>Launcher Tools</h2>
              <div className="quick-grid">
                {[
                  { Icon: PackageOpen, title: "Import Modpack", desc: "Import a Fabric .mrpack or ZIP", color: "green", action: importModpack },
                  { Icon: FolderOpen, title: "Open Game Folder", desc: "Browse shared Minecraft files", color: "gold", action: () => void invoke("open_game_folder").catch(error => showToolMessage(String(error))) },
                  { Icon: TerminalSquare, title: "Java Status", desc: "Check detected Java runtimes", color: "blue", action: showJavaStatus },
                  { Icon: Shield, title: "Repair Installation", desc: "Verify the latest instance files", color: "slate", action: repairInstallation },
                ].map(({ Icon, title, desc, color, action }) => (
                  <button className="quick-card launcher-tool" key={title} onClick={() => void action()}>
                    <span className={"quick-icon " + color}>
                      <Icon size={21} />
                    </span>
                    <span>
                      <b>{title}</b>
                      <small>{desc}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <div className="columns">
              <section className="recent">
                <div className="section-heading">
                  <h2>Recent Instances</h2>
                  <button onClick={() => setPage("instances")}>
                    View all <ChevronRight size={15} />
                  </button>
                </div>
                {instances.length
                  ? instances.slice(0, 4).map((instance) => (
                      <div className="instance-card" key={instance.id} onClick={() => { setSelectedInstanceId(instance.id); setPage("instance"); }}>
                        {instance.icon ? <img className="recent-instance-icon" src={instance.icon} alt="" /> : <span className="instance-placeholder-icon" aria-hidden="true">?</span>}
                        <div>
                          <b>{instance.name}</b>
                          <small>{instance.version} • {instance.loader}</small>
                        </div>
                        <button
                          className="play-instance"
                          disabled={download.active || gameRunning}
                          onClick={(event) => { event.stopPropagation(); void launch(instance); }}
                        >
                          <Play size={17} fill="currentColor" />
                        </button>
                      </div>
                    ))
                  : [1, 2, 3, 4].map((i) => <EmptySlot key={i} />)}
                <button className="view-all" onClick={() => setPage("instances")}>
                  View all instances <ChevronRight size={16} />
                </button>
              </section>
              <section className="whats-new">
                <div className="section-heading">
                  <h2>What's New</h2>
                  <button>
                    View all <ChevronRight size={15} />
                  </button>
                </div>
                {[1, 2, 3].map((i) => (
                  <EmptySlot
                    key={i}
                    title="Nothing new yet"
                    sub="Updates and news will appear here"
                  />
                ))}
              </section>
            </div>
          </>
        )}
      </main>
      <aside className="ad-rail">
        <div className="ad-rail-heading">Sponsored</div>
        {[1, 2, 3].map((ad) => (
          <div className="ad-placeholder" key={ad}>
            <span>Ads</span>
          </div>
        ))}
      </aside>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={() => setContextMenu(null)}
        >
          <div className="context-menu-title">Quick actions</div>
          <button>Coming soon</button>
          <button>Coming soon</button>
          <button>Coming soon</button>
        </div>
      )}
      {toast && <div className="launch-toast" role="status"><b>Launch issue</b><span>{toast}</span></div>}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
