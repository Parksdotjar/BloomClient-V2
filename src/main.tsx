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
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  PackageOpen,
  Palette,
  Play,
  Puzzle,
  Rocket,
  Settings as SettingsIcon,
  Shield,
  SlidersHorizontal,
  TerminalSquare,
} from "lucide-react";
import "./styles.css";

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
  [Puzzle, "Mods"],
  [PackageOpen, "Resource Packs"],
  [Layers3, "Shaders"],
  [SettingsIcon, "Settings"],
] as const;
const quickActions = [
  [Puzzle, "Browse Mods", "Find and install mods\nfrom Modrinth", "green"],
  [
    FolderOpen,
    "Resource Packs",
    "Browse and manage\nyour resource packs",
    "gold",
  ],
  [Cuboid, "Shaders", "Manage your\nshader packs", "blue"],
  [SettingsIcon, "Settings", "Configure client\npreferences", "slate"],
] as const;
const settingTabs = [
  [SettingsIcon, "General"],
  [Palette, "Appearance"],
  [SlidersHorizontal, "Performance"],
  [Cuboid, "Minecraft"],
  [Rocket, "Launcher"],
  [Shield, "Privacy"],
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
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="select-wrap">
      <button
        className="select-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {value}
        <ChevronDown size={15} className={open ? "rotated" : ""} />
      </button>
      {open && (
        <div className="select-menu">
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
        </div>
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
    </div>
  );
}
function SettingsPage({
  settings,
  setSettings,
}: {
  settings: SettingsState;
  setSettings: (s: SettingsState) => void;
}) {
  const update = <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K],
  ) => setSettings({ ...settings, [key]: value });
  const [activeTab, setActiveTab] = useState("General");
  const sections = useRef<Record<string, HTMLDivElement | null>>({});
  const jumpTo = (label: string) => {
    const target = sections.current[label];
    const scroller = document.querySelector(".content") as HTMLElement | null;
    if (!target || !scroller) return;
    setActiveTab(label);
    const destination = Math.max(
      0,
      target.offsetTop - scroller.clientHeight / 2 + target.offsetHeight / 2,
    );
    const distance = Math.abs(scroller.scrollTop - destination);
    animate(scroller, {
      scrollTop: destination,
      duration: Math.min(1050, Math.max(420, 420 + distance * 0.45)),
      ease: "inOut(3)",
    });
  };
  const section = (label: string) => ({
    ref: (node: HTMLDivElement | null) => {
      sections.current[label] = node;
    },
  });
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
  onCreated: () => void;
}) {
  const [draft, setDraft] = useState<InstanceDraft>({
    id: "",
    name: "",
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
        "Instance created. Vanilla game installation is the next native step.",
      );
      onCreated();
    } catch (error) {
      setMessage(String(error));
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
        <h1>New Instance</h1>
        <p>Create a new Minecraft instance to start playing.</p>
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
function App() {
  const [page, setPage] = useState<"home" | "settings" | "new-instance">(
    "home",
  );
  const [instances, setInstances] = useState<InstanceDraft[]>([]);
  const [download, setDownload] = useState({
    active: false,
    progress: 0,
    state: "idle",
    message: "",
  });
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
  useEffect(() => {
    if (profile) localStorage.setItem("bloom-profile", JSON.stringify(profile));
    else localStorage.removeItem("bloom-profile");
  }, [profile]);
  useEffect(() => {
    void invoke<InstanceDraft[]>("list_instances").then(setInstances);
  }, []);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ state: string; progress: number; message: string }>(
      "minecraft-launch-progress",
      (event) => {
        const next = event.payload;
        setDownload({
          active: next.state === "installing" || next.state === "launching" || next.state === "running",
          progress: next.progress,
          state: next.state,
          message: next.message,
        });
        if (next.state === "error") {
          setGameRunning(false);
          setToast(next.message);
          window.setTimeout(() => setToast(""), 5000);
        }
        if (next.state === "running") {
          setGameRunning(true);
          window.setTimeout(() => setDownload(current => ({ ...current, active: false })), 900);
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
  const launch = async (instance: InstanceDraft) => {
    if (download.active || gameRunning) {
      setToast("Something is already downloading or running. Please wait.");
      window.setTimeout(() => setToast(""), 3500);
      return;
    }
    try {
      await invoke("launch_minecraft", { instanceId: instance.id });
    } catch (error) {
      const message = String(error);
      if (message.includes("Sign in with Microsoft")) {
        setSignInOpen(true);
        setToast("Your saved profile needs a quick Microsoft reconnect before launching.");
      } else setToast(message);
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
  return (
    <div
      className="app-shell"
      onContextMenu={handleContextMenu}
      onClick={() => setContextMenu(null)}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
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
                (page === "settings" && label === "Settings")
                  ? "active"
                  : ""
              }
              key={label}
              onClick={() =>
                label === "Settings" ? setPage("settings") : setPage("home")
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
            instances.map((instance) => (
              <button
                className="sidebar-instance"
                key={instance.id}
                onClick={() => setPage("home")}
              >
                <span className="instance-dot" />
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
        <button
          className="add-instance"
          onClick={() => setPage("new-instance")}
        >
          <CirclePlus size={16} />
          <span>Add instance</span>
        </button>
        <div className="sidebar-spacer" />
        <button className="sidebar-link downloads-link">
          <Download size={17} />
          Downloads {download.active && <span className={`download-ring ${download.state}`} style={{ "--download-progress": `${download.progress}%` } as CSSProperties}>{download.state === "running" && <Check size={12} />}</span>}
        </button>
        <button className="sidebar-link">
          <TerminalSquare size={17} />
          Logs
        </button>
        <div className="profile">
          {profile ? (
            <div className="signed-in">
              <div className="avatar">
                {profile.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="signed-in-name">
                <b>{profile.name}</b>
              </div>
              <button onClick={() => setPage("settings")}>
                <SettingsIcon size={16} />
              </button>
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
        {page === "settings" ? (
          <SettingsPage settings={settings} setSettings={setSettings} />
        ) : page === "new-instance" ? (
          <NewInstancePage
            onCancel={() => setPage("home")}
            onCreated={() => {
              void invoke<InstanceDraft[]>("list_instances").then(setInstances);
              setPage("home");
            }}
          />
        ) : (
          <>
            <header className="topbar" />
            <section className="hero">
              <div>
                <h1>
                  Welcome back, <span>{profile?.name || "Parks"}</span>
                </h1>
                <p>Ready to play? Launch an instance or get started below.</p>
              </div>
              <div className="hero-card">
                <div className="hero-glow" />
                <div>
                  <b>Make something new</b>
                  <span>Create an instance to start playing</span>
                </div>
                <button onClick={() => setPage("new-instance")}>
                  <CirclePlus size={16} /> Create
                </button>
              </div>
            </section>
            <div className="rule" />
            <section>
              <h2>Quick Actions</h2>
              <div className="quick-grid">
                {quickActions.map(([Icon, title, desc, color]) => (
                  <button className="quick-card" key={title}>
                    <span className={"quick-icon " + color}>
                      <Icon size={25} />
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
                  <button>
                    View all <ChevronRight size={15} />
                  </button>
                </div>
                {instances.length
                  ? instances.map((instance) => (
                      <div className="instance-card" key={instance.id}>
                        <span className="instance-dot" />
                        <div>
                          <b>{instance.name}</b>
                          <small>{instance.version} • Vanilla</small>
                        </div>
                        <button
                          className="play-instance"
                          disabled={download.active || gameRunning}
                          onClick={() => void launch(instance)}
                        >
                          <Play size={17} fill="currentColor" />
                        </button>
                      </div>
                    ))
                  : [1, 2, 3, 4].map((i) => <EmptySlot key={i} />)}
                <button className="view-all">
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
