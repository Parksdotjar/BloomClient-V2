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
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update as TauriUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { animate } from "animejs";
import { waapi, type WAAPIAnimation } from "animejs/waapi";
import {
  Check,
  Activity,
  ArrowRightLeft,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Clipboard,
  Cpu,
  Cuboid,
  Feather,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  House,
  Inbox,
  Layers3,
  ImagePlus,
  MoreHorizontal,
  Monitor,
  MemoryStick,
  PackageOpen,
  Palette,
  Play,
  Plus,
  Puzzle,
  Rocket,
  RotateCw,
  Search,
  Settings as SettingsIcon,
  Shield,
  SlidersHorizontal,
  TerminalSquare,
  Timer,
  TriangleAlert,
  Trash2,
  Upload,
  UserRound,
  WandSparkles,
  LockKeyhole,
  LogOut,
  ArrowLeft as X,
  X as CloseIcon,
} from "lucide-react";
import "./styles.css";
import { monitorBackend } from "./services/backend";
import { Locker } from "./components/Locker";

type Theme = "oled";
type HomeLayout = "Dashboard" | "Spotlight";
type AppPage = "home" | "settings" | "autotune" | "new-instance" | "downloads" | "logs" | "instance" | "instances" | "locker";
type WindowMenuName = "file" | "edit" | "view" | "help";
const PROFILE_ICON_STORAGE_KEY = "bloom-profile-icon";

function HangerIcon({ size = 17 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 9V7.5A2.5 2.5 0 1 0 9.5 5" />
    <path d="m12 9-8.4 5.4A1 1 0 0 0 4.1 16h15.8a1 1 0 0 0 .5-1.6L12 9Z" />
  </svg>;
}

function WindowMinimizeIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 13h12" /></svg>;
}

function WindowExpandIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5H6a1 1 0 0 0-1 1v3M15 5h3a1 1 0 0 1 1 1v3M9 19H6a1 1 0 0 1-1-1v-3M15 19h3a1 1 0 0 0 1-1v-3" />
  </svg>;
}

function WindowCloseIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>;
}

type SettingsState = {
  theme: Theme;
  accent: string;
  animations: boolean;
  buttonPressDuration: number;
  customBackground: boolean;
  backgroundOpacity: number;
  sidebarOpacity: number;
  elementOpacity: number;
  ultraPerformance: boolean;
  tray: boolean;
  updates: boolean;
  memory: string;
  java: string;
  closeAfterLaunch: boolean;
  analytics: boolean;
  crashReports: boolean;
  debugLogging: boolean;
  startupBehavior: "Open Home" | "Open Settings" | "Remember last page";
  javaArguments: string;
  defaultVersion: string;
  defaultLoader: "Vanilla" | "Fabric";
  launchMethod: "Standard window" | "Fullscreen";
  homeLayout: HomeLayout;
  doubleClickToPlay: boolean;
  downloadWorkers: 1 | 3 | 5;
  recommendations: boolean;
  gameDirectory: string;
};
const defaults: SettingsState = {
  theme: "oled",
  accent: "#a56bff",
  animations: true,
  buttonPressDuration: 750,
  customBackground: false,
  backgroundOpacity: 100,
  sidebarOpacity: 92,
  elementOpacity: 35,
  ultraPerformance: false,
  tray: true,
  updates: true,
  memory: "4096 MB",
  java: "Automatic",
  closeAfterLaunch: false,
  analytics: false,
  crashReports: true,
  debugLogging: false,
  startupBehavior: "Open Home",
  javaArguments: "",
  defaultVersion: "Latest release",
  defaultLoader: "Fabric",
  launchMethod: "Standard window",
  homeLayout: "Spotlight",
  doubleClickToPlay: false,
  downloadWorkers: 3,
  recommendations: true,
  gameDirectory: ".minecraft/instances/",
};
const spotlightDefaultMigrationKey = "bloom-home-layout-spotlight-v1";
const customBackgroundDefaultsMigrationKey = "bloom-custom-background-defaults-v1";
const nav = [
  [House, "Home"],
  [Layers3, "Instances"],
  [WandSparkles, "AutoTune"],
  [HangerIcon, "Locker"],
  [SettingsIcon, "Settings"],
] as const;
const settingTabs = [
  [SettingsIcon, "General"],
  [Palette, "Appearance"],
  [ImagePlus, "Background"],
  [SlidersHorizontal, "Performance"],
  [Cuboid, "Minecraft"],
  [Feather, "Cosmetics"],
  [Rocket, "Launcher"],
  [Shield, "Privacy"],
  [Download, "Updates"],
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
  disabled = false,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={"toggle " + (value ? "on" : "off")}
      onClick={() => onChange(!value)}
      aria-pressed={value}
      disabled={disabled}
    >
      <span />
    </button>
  );
}
function FillCheckbox({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button className={`fill-checkbox ${value ? "checked" : ""}`} onClick={() => onChange(!value)} aria-pressed={value} aria-label={label}><span /></button>;
}
function PercentSlider({ value, onChange, label, min = 0, max = 100 }: { value: number; onChange: (value: number) => void; label: string; min?: number; max?: number }) {
  const safeValue = Math.max(min, Math.min(max, value));
  const fill = max === min ? 100 : ((safeValue - min) / (max - min)) * 100;
  return <div className="setting-percent-slider" style={{ "--setting-range-fill": `${fill}%` } as CSSProperties}>
    <input type="range" min={min} max={max} step="1" value={safeValue} aria-label={label} aria-valuetext={`${safeValue} percent`} onChange={event => onChange(Number(event.target.value))} />
    <output>{safeValue}%</output>
  </div>;
}

const closedDropdownStyle: CSSProperties = {
  opacity: 0,
  clipPath: "inset(0 0 100% 0)",
  transformOrigin: "top center",
};

type FloatingMenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

function fitFloatingMenu(
  bounds: DOMRect,
  width: number,
  contentHeight: number,
  preferredLeft: number,
): FloatingMenuPosition {
  const viewportPadding = 8;
  const viewportHeight = window.innerHeight;
  const desiredHeight = Math.min(330, Math.max(44, contentHeight));
  const spaceBelow = Math.max(0, viewportHeight - bounds.bottom - viewportPadding);
  const spaceAbove = Math.max(0, bounds.top - viewportPadding);
  const openAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
  const availableHeight = Math.max(44, openAbove ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(330, availableHeight);
  const renderedHeight = Math.min(desiredHeight, maxHeight);
  const top = openAbove
    ? Math.max(viewportPadding, bounds.top - renderedHeight + 1)
    : Math.min(bounds.bottom - 1, viewportHeight - viewportPadding - renderedHeight);

  return {
    top,
    left: Math.max(viewportPadding, Math.min(preferredLeft, window.innerWidth - width - viewportPadding)),
    width,
    maxHeight,
  };
}

function fitActionMenuBelow(
  ownerBounds: DOMRect,
  width: number,
  contentHeight: number,
  preferredLeft: number,
): FloatingMenuPosition {
  const viewportPadding = 8;
  return {
    top: ownerBounds.bottom - 1,
    left: Math.max(viewportPadding, Math.min(preferredLeft, window.innerWidth - width - viewportPadding)),
    width,
    maxHeight: Math.min(330, Math.max(48, contentHeight + 6)),
  };
}

function revealDropdown(menu: HTMLDivElement) {
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(":scope > button"));
  const motionEnabled = document.documentElement.dataset.animations === "on"
    && document.documentElement.dataset.performance !== "ultra";
  if (!motionEnabled) {
    menu.style.opacity = "1";
    menu.style.clipPath = "none";
    menu.style.transform = "none";
    items.forEach(item => { item.style.opacity = "1"; item.style.transform = "none"; });
    return;
  }

  waapi.animate(menu, {
    opacity: [0, 1],
    clipPath: ["inset(0 0 100% 0)", "inset(0 0 0% 0)"],
    transform: ["translateY(-7px)", "translateY(0)"],
    duration: 310,
    ease: "cubic-bezier(.65,0,.35,1)",
    persist: true,
  });

  // Only stagger rows that can be visible. Long version lists remain cheap.
  items.forEach((item, index) => {
    if (index >= 10) {
      item.style.opacity = "1";
      return;
    }
    waapi.animate(item, {
      opacity: [0, 1],
      transform: ["translateY(-5px)", "translateY(0)"],
      delay: 75 + index * 25,
      duration: 165,
      ease: "cubic-bezier(.22,.7,.24,1)",
      persist: true,
    });
  });
}

function revealWindowMenu(menu: HTMLDivElement) {
  const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(":scope > button"));
  const motionEnabled = document.documentElement.dataset.animations === "on"
    && document.documentElement.dataset.performance !== "ultra";
  if (!motionEnabled) {
    menu.style.opacity = "1";
    menu.style.clipPath = "none";
    items.forEach(item => { item.style.opacity = "1"; });
    return;
  }
  waapi.animate(menu, {
    opacity: [0, 1],
    clipPath: ["inset(0 0 100% 0)", "inset(0 0 0% 0)"],
    duration: 260,
    ease: "cubic-bezier(.65,0,.35,1)",
    persist: true,
  });
  items.forEach((item, index) => {
    waapi.animate(item, {
      opacity: [0, 1],
      delay: 45 + index * 22,
      duration: 145,
      ease: "linear",
      persist: true,
    });
  });
}

function Select({
  value,
  options,
  onChange,
  variant = "default",
  disabledOptions = [],
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  variant?: "default" | "filter";
  disabledOptions?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0, width: 184, maxHeight: 330 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = variant === "filter" ? 150 : Math.max(bounds.width - 10, 140);
      const preferredLeft = variant === "filter" ? bounds.right - width : bounds.left + 5;
      const contentHeight = menuRef.current?.scrollHeight || options.length * 38 + 10;
      setMenuPosition(fitFloatingMenu(bounds, width, contentHeight, preferredLeft));
    };
    const closeOutside = (event: PointerEvent) => { const target = event.target as Node; if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false); };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", closeOutside);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", closeOutside); };
  }, [open, options.length, variant]);
  useEffect(() => {
    if (open && menuRef.current) revealDropdown(menuRef.current);
  }, [open, options.length]);
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
        {variant === "filter" ? <SlidersHorizontal size={17} /> : <><span className="select-value">{value}</span><ChevronDown size={15} className={open ? "rotated" : ""} /></>}
      </button>
      {open && createPortal(
        <div ref={menuRef} className="select-menu select-menu-portal" style={{ ...closedDropdownStyle, position: "fixed", top: menuPosition.top, left: menuPosition.left, right: "auto", width: menuPosition.width, maxHeight: menuPosition.maxHeight }}>
          {options.map((option) => (
            <button
              style={{ opacity: 0 }}
              className={option === value ? "chosen" : ""}
              key={option}
              disabled={disabledOptions.includes(option)}
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

function PaginationControls({
  page,
  pages,
  onPrevious,
  onNext,
  busy = false,
}: {
  page: number;
  pages: number;
  onPrevious: () => void;
  onNext: () => void;
  busy?: boolean;
}) {
  return (
    <div className="content-pagination friendly-pagination">
      <button type="button" disabled={busy || page <= 1} onClick={onPrevious} aria-label="Previous page" title="Previous page">
        <ChevronLeft size={21} />
      </button>
      <span aria-live="polite">
        <b>{page}</b><i>/</i><b>{pages}</b>
      </span>
      <button type="button" disabled={busy || page >= pages} onClick={onNext} aria-label="Next page" title="Next page">
        <ChevronRight size={21} />
      </button>
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

type ManagedJavaRuntime = {
  majorVersion: number;
  architecture: string;
  provider: string;
  javaPath: string;
};

function ManagedJavaControl() {
  const [runtimes, setRuntimes] = useState<ManagedJavaRuntime[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    try {
      setRuntimes(await invoke<ManagedJavaRuntime[]>("list_managed_java_runtimes"));
    } catch (error) {
      setMessage(String(error));
    }
  };
  useEffect(() => { void refresh(); }, []);
  const remove = async (majorVersion: number) => {
    setBusy(majorVersion);
    setMessage("");
    try {
      await invoke("remove_managed_java_runtime", { majorVersion });
      await refresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="managed-java-control">
      {runtimes.length ? runtimes.map((runtime) => (
        <span key={`${runtime.majorVersion}-${runtime.architecture}`}>
          Java {runtime.majorVersion}
          <button disabled={busy !== null} onClick={() => void remove(runtime.majorVersion)} aria-label={`Remove Bloom-managed Java ${runtime.majorVersion}`}>
            <Trash2 size={13} />
          </button>
        </span>
      )) : <small>Installed automatically when needed</small>}
      {message && <small className="managed-java-error">{message}</small>}
    </div>
  );
}

// Temporary: Prism's recognized public client ID. Replace with Bloom's approved ID via VITE_MICROSOFT_CLIENT_ID later.
const MICROSOFT_CLIENT_ID =
  import.meta.env.VITE_MICROSOFT_CLIENT_ID ||
  "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";

type MinecraftProfile = { id: string; name: string };

type CosmeticsPreferences = { enabled: boolean; available: boolean };
type CosmeticsAccountState = { capeId: string | null; badgeVisible: boolean };

function CosmeticsSettings({ profile }: { profile: MinecraftProfile | null }) {
  const [preferences, setPreferences] = useState<CosmeticsPreferences | null>(null);
  const [accountState, setAccountState] = useState<CosmeticsAccountState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setMessage("");
    void (async () => {
      const local = await invoke<CosmeticsPreferences>("get_cosmetics_preferences");
      if (cancelled) return;
      setPreferences(local);
      if (!profile) { setAccountState(null); return; }
      const remote = await invoke<CosmeticsAccountState>("cosmetics_request", {
        method: "GET",
        path: "/v1/cosmetics/me",
        body: null,
        accountId: profile.id,
      });
      if (!cancelled) setAccountState(remote);
    })().catch(error => { if (!cancelled) setMessage(String(error)); });
    return () => { cancelled = true; };
  }, [profile?.id]);

  const setIntegration = async (enabled: boolean) => {
    if (!preferences || busy) return;
    setBusy(true); setMessage("");
    try {
      await invoke("set_cosmetics_preferences", { enabled });
      const problems = await invoke<string[]>("reconcile_cosmetics");
      setPreferences(current => current && ({ ...current, enabled }));
      if (problems.length) setMessage(problems.join("\n"));
    } catch (error) {
      setMessage(String(error));
      const current = await invoke<CosmeticsPreferences>("get_cosmetics_preferences").catch(() => null);
      if (current) setPreferences(current);
    } finally { setBusy(false); }
  };

  const setBadge = async (badgeVisible: boolean) => {
    if (!profile || !accountState || busy) return;
    setBusy(true); setMessage("");
    try {
      await invoke("cosmetics_request", {
        method: "PUT",
        path: "/v1/cosmetics/badge",
        body: { visible: badgeVisible },
        accountId: profile.id,
      });
      setAccountState(current => current && ({ ...current, badgeVisible }));
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };

  return <div className="settings-card cosmetics-settings-card">
    <SettingRow title="Bloom Cosmetics" description="Install and maintain Bloom capes for supported Fabric 1.21.11 instances.">
      <Toggle value={preferences?.enabled ?? false} disabled={!preferences?.available || busy || !preferences} onChange={value => void setIntegration(value)} />
    </SettingRow>
    <SettingRow title="Nametag Badge" description={profile ? "Show the Bloom flower beside your name while playing through Bloom." : "Sign in to choose whether your Bloom badge is visible."}>
      <Toggle value={accountState?.badgeVisible ?? false} disabled={!profile || !accountState || busy || !preferences?.enabled} onChange={value => void setBadge(value)} />
    </SettingRow>
    {message && <div className="cosmetics-settings-message" role="status">{message}</div>}
  </div>;
}
type MinecraftAccountList = { activeId: string | null; accounts: MinecraftProfile[] };

function SignInPanel({
  open,
  onSignedIn,
  variant = "drawer",
}: {
  open: boolean;
  onSignedIn: (profile: MinecraftProfile) => void;
  variant?: "drawer" | "inline";
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
    if (!open || loginStarted.current) return;
    loginStarted.current = true;
    void startMicrosoftLogin();
  }, [open]);
  const hasError = !status.startsWith("Requesting") && !status.startsWith("Code ready");
  return (
    <div className={variant === "drawer" ? `profile-popover signin-drawer ${open ? "open" : ""}` : "signin-inline"} role={variant === "drawer" ? "menu" : "group"} aria-label="Microsoft sign-in" aria-hidden={!open} onClick={event => event.stopPropagation()}>
      <div className="profile-popover-actions signin-drawer-actions">
        <button className={`signin-copy-action ${copied ? "complete" : ""}`} role="menuitem" tabIndex={open ? 0 : -1} disabled={!code || copied || hasError} onClick={copyCode} title={hasError ? status : undefined}>
          <span>{copied ? <Check size={17} /> : <Clipboard size={17} />}</span>
          <div><b>{copied ? "Copied" : code ? "Copy code" : hasError ? "Code unavailable" : "Getting code"}</b></div>
          <code>{code || "••••••••"}</code>
        </button>
        <button className="signin-open-action" role="menuitem" tabIndex={open && handoffReady ? 0 : -1} disabled={!handoffReady} onClick={() => openUrl(verificationUri)}>
          <span><ExternalLink size={17} /></span>
          <div><b>Open Microsoft sign-in</b></div>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
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
  backgroundImage,
  onBackgroundImageChange,
  initialTab,
  navigationKey,
  currentVersion,
  availableVersion,
  updateChecking,
  onCheckUpdates,
  onOpenUpdate,
  accounts,
  switchingAccount,
  onSwitchAccount,
  onAccountAdded,
}: {
  settings: SettingsState;
  setSettings: (s: SettingsState) => void;
  onSignOut: () => void;
  profile: MinecraftProfile | null;
  profileIcon: string | null;
  onProfileIconChange: (icon: string) => void;
  backgroundImage: string | null;
  onBackgroundImageChange: (image: string) => void;
  initialTab?: string;
  navigationKey: number;
  currentVersion: string;
  availableVersion: string | null;
  updateChecking: boolean;
  onCheckUpdates: () => void;
  onOpenUpdate: () => void;
  accounts: MinecraftProfile[];
  switchingAccount: boolean;
  onSwitchAccount: (account: MinecraftProfile) => Promise<void>;
  onAccountAdded: (profile: MinecraftProfile) => void;
}) {
  const update = <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K],
  ) => setSettings({ ...settings, [key]: value });
  const [activeTab, setActiveTab] = useState("General");
  const [profileMessage, setProfileMessage] = useState("");
  const [backgroundMessage, setBackgroundMessage] = useState("");
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [releaseOptions, setReleaseOptions] = useState<string[]>([]);
  const [javaOptions, setJavaOptions] = useState<string[]>(["Automatic"]);
  const [addingAccount, setAddingAccount] = useState(false);
  const [pendingProfileAccountId, setPendingProfileAccountId] = useState<string | null>(null);
  const [profileConfirmPosition, setProfileConfirmPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const profileIconInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const profileAccountPicker = useRef<HTMLDivElement>(null);
  const sections = useRef<Record<string, HTMLDivElement | null>>({});
  const jumpTo = (label: string) => {
    const target = sections.current[label];
    const scroller = document.querySelector(".content") as HTMLElement | null;
    if (!target || !scroller) return;
    setActiveTab(label);
    const destination = label === "General" ? 0 : Math.max(0, target.offsetTop - scroller.clientHeight / 2 + target.offsetHeight / 2);
    const distance = Math.abs(scroller.scrollTop - destination);
    if (settings.ultraPerformance || !settings.animations) { scroller.scrollTop = destination; return; }
    animate(scroller, {
      scrollTop: destination,
      duration: Math.min(1050, Math.max(420, 420 + distance * 0.45)),
      ease: "inOut(3)",
    });
  };
  useEffect(() => { if (!initialTab) return; const timer = window.setTimeout(() => jumpTo(initialTab), 0); return () => window.clearTimeout(timer); }, [initialTab, navigationKey]);
  useEffect(() => {
    void Promise.all([invoke<Release[]>("get_minecraft_releases"), invoke<JavaInstallation[]>("detect_java_installations")]).then(([releases, javas]) => {
      setReleaseOptions(releases.map(release => release.id));
      setJavaOptions(["Automatic", ...javas.filter(java => java.usable).map(java => `Java ${java.majorVersion} — ${java.path}`)]);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!pendingProfileAccountId) { setProfileConfirmPosition(null); return; }
    const place = () => {
      const bounds = profileAccountPicker.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.max(250, Math.min(bounds.width, 310));
      const left = Math.max(8, Math.min(bounds.left + (bounds.width - width) / 2, window.innerWidth - width - 8));
      const below = bounds.bottom + 7;
      const top = below + 46 <= window.innerHeight - 8 ? below : Math.max(8, bounds.top - 53);
      setProfileConfirmPosition({ top, left, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [pendingProfileAccountId]);
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
    reader.onload = () => { onProfileIconChange(String(reader.result)); setProfileMessage("Profile picture updated for every account."); };
    reader.onerror = () => setProfileMessage("Bloom could not read that profile picture.");
    reader.readAsDataURL(file);
  };
  const chooseBackground = async (file?: File) => {
    if (!file) return;
    setBackgroundMessage("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setBackgroundMessage("Choose a PNG, JPEG, or WebP image."); return; }
    if (file.size > 32 * 1024 * 1024) { setBackgroundMessage("Choose an image smaller than 32 MB."); return; }
    setBackgroundBusy(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("Bloom could not read that image."));
        image.src = objectUrl;
      });
      if (dimensions.width > 4096 || dimensions.height > 4096) throw new Error("Background images can be up to 4096 pixels on either side.");
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const saved = await invoke<string>("save_custom_background", { bytes });
      onBackgroundImageChange(saved);
      setBackgroundMessage(`${dimensions.width}×${dimensions.height} background saved locally.`);
    } catch (error) {
      setBackgroundMessage(String(error));
    } finally {
      URL.revokeObjectURL(objectUrl);
      setBackgroundBusy(false);
      if (backgroundInput.current) backgroundInput.current.value = "";
    }
  };
  return (
    <div className="settings-page">
      <div className="settings-heading">
        <h1>Settings</h1>
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
                title="Startup Behavior"
                description="Choose what happens when Bloom Client starts."
              >
                <Select
                  value={settings.startupBehavior}
                  options={["Open Home", "Open Settings", "Remember last page"]}
                  onChange={(v) => update("startupBehavior", v as SettingsState["startupBehavior"])}
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
                  value="OLED Black"
                  options={["OLED Black", "Coming soon"]}
                  disabledOptions={["Coming soon"]}
                  onChange={() => update("theme", "oled")}
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
              <SettingRow
                title="Button Pop Duration"
                description="Choose how quickly buttons press and spring back. Set to 0 for no button pop."
              >
                <div
                  className="button-pop-control"
                  style={{ "--button-pop-fill": `${settings.buttonPressDuration / 15}%` } as CSSProperties}
                >
                  <input
                    type="range"
                    min="0"
                    max="1500"
                    step="50"
                    value={settings.buttonPressDuration}
                    aria-label="Button pop duration"
                    aria-valuetext={`${settings.buttonPressDuration} milliseconds`}
                    onChange={(event) => update("buttonPressDuration", Number(event.target.value))}
                  />
                  <output>{settings.buttonPressDuration} ms</output>
                </div>
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("Background")}>
            <h2>Background</h2>
            <p className="section-subtitle">Personalize Bloom with an image saved only on this computer.</p>
            <div className="settings-card background-settings-card">
              <SettingRow title="Custom Background" description="Use a local image behind Bloom Client. A 16:9 image is recommended.">
                <FillCheckbox value={settings.customBackground} onChange={value => update("customBackground", value)} label="Use custom background" />
              </SettingRow>
              {settings.customBackground && <>
                <SettingRow title="Background Image" description="Upload a PNG, JPEG, or WebP image up to 4K resolution.">
                  <div className="background-upload-control">
                    {backgroundImage && <span className="background-thumbnail" style={{ backgroundImage: `url(${backgroundImage})` }} />}
                    <button disabled={backgroundBusy} onClick={() => backgroundInput.current?.click()}><Upload size={15} />{backgroundBusy ? "Saving…" : backgroundImage ? "Replace image" : "Upload image"}</button>
                    <input ref={backgroundInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => void chooseBackground(event.target.files?.[0])} />
                  </div>
                </SettingRow>
                <SettingRow title="Image Opacity" description="Lower values fade the background into black so controls remain readable.">
                  <PercentSlider value={settings.backgroundOpacity} onChange={value => update("backgroundOpacity", value)} label="Background image opacity" />
                </SettingRow>
                <SettingRow title="Interface Darkness" description="Darken the sharp center and blurred sidebars together.">
                  <PercentSlider value={settings.sidebarOpacity} min={55} max={92} onChange={value => update("sidebarOpacity", value)} label="Custom background interface darkness" />
                </SettingRow>
                <SettingRow title="Element Darkness" description="Adjust the opacity of buttons, dropdowns, cards, and other glass controls.">
                  <PercentSlider value={settings.elementOpacity} min={35} max={98} onChange={value => update("elementOpacity", value)} label="Custom background element darkness" />
                </SettingRow>
                {backgroundMessage && <div className="background-settings-message">{backgroundMessage}</div>}
              </>}
            </div>
          </div>
          <div className="settings-section" {...section("Performance")}>
            <h2>Performance</h2>
            <p className="section-subtitle">
              Optimize performance and resource usage.
            </p>
            <div className="settings-card">
              <SettingRow title="Ultra Performance Mode" description="Disable motion, glow, blur, and continuous visual rendering for lower-end computers.">
                <Toggle value={settings.ultraPerformance} onChange={(v) => setSettings({ ...settings, ultraPerformance: v, animations: v ? false : settings.animations })} />
              </SettingRow>
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
                description="Automatic detects or securely installs the exact Java Minecraft needs."
              >
                <Select
                  value={settings.java}
                  options={javaOptions.includes(settings.java) ? javaOptions : [settings.java, ...javaOptions]}
                  onChange={(v) => update("java", v)}
                />
              </SettingRow>
              <SettingRow
                title="Bloom-managed Java"
                description="Private runtimes downloaded by Bloom. They do not change Windows or your PATH."
              >
                <ManagedJavaControl />
              </SettingRow>
              <SettingRow
                title="Java Arguments"
                description="Advanced JVM arguments for Minecraft launches."
              >
                <input className="text-input" value={settings.javaArguments} onChange={event => update("javaArguments", event.target.value)} placeholder="-XX:+UseG1GC" />
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
                  value={settings.defaultVersion}
                  options={["Latest release", ...releaseOptions]}
                  onChange={(v) => update("defaultVersion", v)}
                />
              </SettingRow>
              <SettingRow
                title="Default Mod Loader"
                description="The loader selected for new instances."
              >
                <Select
                  value={settings.defaultLoader}
                  options={["Fabric", "Vanilla"]}
                  onChange={(v) => update("defaultLoader", v as SettingsState["defaultLoader"])}
                />
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("Cosmetics")}>
            <h2>Cosmetics</h2>
            <p className="section-subtitle">Control capes and your in-game Bloom identity.</p>
            <CosmeticsSettings profile={profile} />
          </div>
          <div className="settings-section" {...section("Launcher")}>
            <h2>Launcher</h2>
            <p className="section-subtitle">
              Control how Bloom Client starts and launches games.
            </p>
            <div className="settings-card">
              <SettingRow
                title="Home Layout"
                description="Choose between Bloom's full dashboard and a focused traditional launcher."
              >
                <Select
                  value={settings.homeLayout}
                  options={["Dashboard", "Spotlight"]}
                  onChange={(v) => update("homeLayout", v as HomeLayout)}
                />
              </SettingRow>
              <SettingRow
                title="Double Click to Play"
                description="Quickly double-click an instance to launch it. A single click still opens its page."
              >
                <Toggle
                  value={settings.doubleClickToPlay}
                  onChange={(v) => update("doubleClickToPlay", v)}
                />
              </SettingRow>
              <SettingRow
                title="Launch Method"
                description="Choose how Minecraft windows open."
              >
                <Select
                  value={settings.launchMethod}
                  options={["Standard window", "Fullscreen"]}
                  onChange={(v) => update("launchMethod", v as SettingsState["launchMethod"])}
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
                  value={`${settings.downloadWorkers} simultaneous download${settings.downloadWorkers === 1 ? "" : "s"}`}
                  options={[
                    "1 simultaneous download",
                    "3 simultaneous downloads",
                    "5 simultaneous downloads",
                  ]}
                  onChange={(v) => update("downloadWorkers", Number.parseInt(v, 10) as 1 | 3 | 5)}
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
                description="Store anonymous feature-use counters locally on this device."
              >
                <Toggle
                  value={settings.analytics}
                  onChange={(v) => update("analytics", v)}
                />
              </SettingRow>
              <SettingRow
                title="Crash Reports"
                description="Save crash details locally so they can be reviewed in Logs."
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
                  value={settings.recommendations ? "Show recommendations" : "Hide recommendations"}
                  options={["Show recommendations", "Hide recommendations"]}
                  onChange={(v) => update("recommendations", v === "Show recommendations")}
                />
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("Updates")}>
            <h2>Updates</h2>
            <p className="section-subtitle">Keep Bloom Client secure and up to date.</p>
            <div className="settings-card updates-settings-card">
              <SettingRow title="Automatic Checks" description="Check GitHub Releases once whenever Bloom Client opens.">
                <Toggle value={settings.updates} onChange={(v) => update("updates", v)} />
              </SettingRow>
              <SettingRow title="Current Version" description="The version currently installed on this computer.">
                <span className="current-app-version">v{currentVersion}</span>
              </SettingRow>
              <SettingRow
                title={availableVersion ? `Version ${availableVersion} available` : "Update Status"}
                description={availableVersion ? `Bloom can update from v${currentVersion} to v${availableVersion}.` : "Bloom automatically checks once whenever the launcher opens."}
              >
                {availableVersion
                  ? <button className="settings-update-button available" onClick={onOpenUpdate}><Download size={15} />Download update</button>
                  : <button className="settings-update-button" disabled={updateChecking} onClick={onCheckUpdates}><RotateCw className={updateChecking ? "spinning" : ""} size={15} />{updateChecking ? "Checking…" : "Check for updates"}</button>}
              </SettingRow>
            </div>
          </div>
          <div className="settings-section" {...section("My Profile")}>
            <h2>My Profile</h2>
            <p className="section-subtitle">Your connected Minecraft account.</p>
            <div className={`settings-card profile-settings-card ${addingAccount ? "adding-account" : ""}`}>
              <button className="profile-settings-avatar" disabled={!profile} onClick={() => profileIconInput.current?.click()} aria-label="Change profile picture">{profileIcon ? <img src={profileIcon} alt="" /> : profile?.name.slice(0, 1).toUpperCase() || "?"}<i><ImagePlus size={13} /></i></button>
              <input ref={profileIconInput} type="file" accept="image/png,image/jpeg" hidden onChange={event => { chooseProfileIcon(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              <div ref={profileAccountPicker} className="profile-account-picker">
                <Select value={profile?.name || "Not signed in"} options={accounts.length ? accounts.map(account => account.name) : ["Not signed in"]} onChange={(name) => {
                  const account = accounts.find(item => item.name === name);
                  if (account && account.id !== profile?.id) setPendingProfileAccountId(account.id);
                }} />
                {profileMessage && <small>{profileMessage}</small>}
              </div>
              {!addingAccount && <button className="profile-add-account" onClick={() => setAddingAccount(true)} aria-label="Add Minecraft account"><Plus size={20} /></button>}
              {addingAccount && <SignInPanel open={addingAccount} variant="inline" onSignedIn={(next) => { onAccountAdded(next); setAddingAccount(false); setPendingProfileAccountId(null); }} />}
            </div>
            {pendingProfileAccountId && profileConfirmPosition && createPortal(
              <div className="profile-switch-confirm-portal" style={profileConfirmPosition}>
                <div className="profile-switch-confirm">
                  <span>Switch account?</span>
                  <button disabled={switchingAccount} onClick={() => { const account = accounts.find(item => item.id === pendingProfileAccountId); if (account) void onSwitchAccount(account).then(() => setPendingProfileAccountId(null)); }}>{switchingAccount ? "Switching…" : "Confirm"}</button>
                  <button onClick={() => setPendingProfileAccountId(null)}>Cancel</button>
                </div>
              </div>, document.body
            )}
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
                <button className="directory-setting" onClick={async () => { const chosen = await invoke<string | null>("choose_game_directory"); if (chosen) update("gameDirectory", chosen); }}><FolderOpen size={15} /><span title={settings.gameDirectory}>{settings.gameDirectory}</span></button>
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
  defaults: instanceDefaults,
}: {
  onCancel: () => void;
  onCreated: (destination: "home" | "downloads") => void;
  defaults: SettingsState;
}) {
  const [draft, setDraft] = useState<InstanceDraft>({
    id: "",
    name: "",
    loader: instanceDefaults.defaultLoader,
    version: instanceDefaults.defaultVersion,
    directory: instanceDefaults.gameDirectory,
    java: instanceDefaults.java === "Automatic" ? "Automatic (Recommended)" : instanceDefaults.java,
    memory: Number.parseInt(instanceDefaults.memory, 10),
    jvmArguments: instanceDefaults.javaArguments,
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
  const [modrinthOpen, setModrinthOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
          version: current.version === "Latest release" ? releaseList[0]?.id || current.version : current.version,
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
  const chooseDirectory = async () => {
    setMessage("");
    try {
      const chosen = await invoke<string | null>("choose_game_directory");
      if (chosen) {
        setDraft((current) => ({ ...current, directory: chosen }));
      }
    } catch (error) {
      setMessage(`Bloom could not open the folder picker: ${String(error)}`);
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
    <div className={`instance-page ${modrinthOpen ? "modrinth-pack-open" : ""}`}>
      <div className="new-instance-background">
      <div className="instance-heading">
        <div><h1>New Instance</h1><p>Create a new Minecraft instance to start playing.</p></div>
        <div className="new-instance-import-actions">
          <button className="import-pack-action secondary-import" disabled={importing} onClick={() => void importPack()}><PackageOpen size={17} /><span>{importing ? "Opening…" : "Import"}</span></button>
          <button className="import-pack-action" disabled={importing} onClick={() => setModrinthOpen(true)}><CirclePlus size={17} /><span>Add from Modrinth</span></button>
        </div>
      </div>
      <div className="instance-layout instance-layout-essential">
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
              <button
                type="button"
                onClick={() => void chooseDirectory()}
                title="Choose where Bloom should create this instance"
                aria-label="Choose game directory"
              >
                <FolderOpen size={18} />
              </button>
            </div>
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
        </section>
      </div>
      <div className="instance-advanced-disclosure">
        <button
          className={`instance-advanced-toggle ${advancedOpen ? "open" : ""}`}
          type="button"
          aria-expanded={advancedOpen}
          aria-controls="new-instance-advanced-options"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <span>{advancedOpen ? "Hide advanced options" : "Show advanced options"}</span>
          <ChevronDown size={17} />
        </button>
      </div>
      {advancedOpen && (
        <div className="instance-advanced-panel" id="new-instance-advanced-options">
          <section className="instance-advanced-java">
            <h2>Java & Performance</h2>
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
            <h3>Memory Allocation</h3>
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
            <label className="instance-field instance-jvm-field">
              <span>JVM Arguments <small>Optional</small></span>
              <textarea
                value={draft.jvmArguments}
                onChange={(event) => update("jvmArguments", event.target.value)}
                placeholder="e.g. -Xmx2G -XX:+UseG1GC"
              />
            </label>
          </section>
          <section className="instance-advanced-behavior">
            <h2>Instance Behavior</h2>
            <p className="section-subtitle">Optional launch and desktop preferences.</p>
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
      )}
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
      {modrinthOpen && <ModrinthPackBrowser gameVersion={draft.version} onClose={() => setModrinthOpen(false)} onImported={() => { setModrinthOpen(false); onCreated("downloads"); }} />}
    </div>
  );
}
type InstanceContentItem = { id: string; name: string; version: string; fileName: string; size: number; enabled: boolean; icon?: string | null };
type CatalogItem = { provider: string; projectId: string; slug: string; title: string; summary: string; iconUrl?: string | null; author: string; downloads: number; loader: string; gameVersion: string; versionId: string; versionNumber: string; fileName: string; fileSize: number };
type CatalogSearchResult = { items: CatalogItem[]; offset: number; limit: number; total: number };
type ModrinthModpackRelease = { id: string; versionNumber: string; versionType: string; gameVersions: string[]; datePublished: string; fileName: string; fileSize: number };
function ModrinthPackBrowser({ gameVersion, onClose, onImported }: { gameVersion: string; onClose: () => void; onImported: (instanceId: string) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<CatalogSearchResult>({ items: [], offset: 0, limit: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState<CatalogItem | null>(null);
  const [releases, setReleases] = useState<ModrinthModpackRelease[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [selectedGameVersion, setSelectedGameVersion] = useState("");
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panelRef.current) return;
    waapi.animate(panelRef.current, { opacity: [0, 1], transform: ["translateY(28px) scale(.985)", "translateY(0) scale(1)"], duration: 360, ease: "cubic-bezier(.22,.72,.2,1)", persist: true });
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void invoke<CatalogSearchResult>("search_modrinth_content", { query, gameVersion, offset: (page - 1) * 20, category: "modpacks" })
        .then(setCatalog)
        .catch((reason) => { setCatalog({ items: [], offset: 0, limit: 20, total: 0 }); setError(String(reason)); })
        .finally(() => setLoading(false));
    }, query ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [query, gameVersion, page]);
  useEffect(() => setPage(1), [query, gameVersion]);
  const pageCount = Math.max(1, Math.ceil(catalog.total / Math.max(1, catalog.limit)));
  const supportedGameVersions = Array.from(new Set(releases.flatMap((release) => release.gameVersions)));
  const compatibleReleases = releases.filter((release) => release.gameVersions.includes(selectedGameVersion));
  const releaseLabel = (release: ModrinthModpackRelease) => `${release.versionNumber} · ${release.versionType.charAt(0).toUpperCase()}${release.versionType.slice(1)}`;
  const selectedRelease = compatibleReleases.find((release) => release.id === selectedReleaseId) || compatibleReleases[0] || null;
  useEffect(() => {
    if (!compatibleReleases.length) {
      setSelectedReleaseId("");
      return;
    }
    if (!compatibleReleases.some((release) => release.id === selectedReleaseId)) setSelectedReleaseId(compatibleReleases[0].id);
  }, [selectedGameVersion, releases]);
  const choosePack = async (item: CatalogItem) => {
    setSelectedPack(item);
    setReleases([]);
    setSelectedGameVersion("");
    setSelectedReleaseId("");
    setReleasesLoading(true);
    setError("");
    try {
      const available = await invoke<ModrinthModpackRelease[]>("list_modrinth_modpack_releases", { projectId: item.projectId });
      setReleases(available);
      const supported = Array.from(new Set(available.flatMap((release) => release.gameVersions)));
      const initialGameVersion = supported.includes(gameVersion) ? gameVersion : supported[0] || "";
      setSelectedGameVersion(initialGameVersion);
      setSelectedReleaseId(available.find((release) => release.gameVersions.includes(initialGameVersion))?.id || "");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setReleasesLoading(false);
    }
  };
  const returnToPacks = () => {
    setSelectedPack(null);
    setReleases([]);
    setSelectedGameVersion("");
    setSelectedReleaseId("");
    setError("");
  };
  const install = async (item: CatalogItem, versionId: string) => {
    if (installingId) return;
    setInstallingId(item.projectId);
    setError("");
    try {
      const instanceId = await invoke<string>("import_modrinth_modpack", { projectId: item.projectId, versionId });
      onImported(instanceId);
    } catch (reason) {
      setError(String(reason));
      setInstallingId(null);
    }
  };
  return <div className="modrinth-pack-layer" role="dialog" aria-modal="true" aria-label="Add a Modrinth modpack">
    <div className="modrinth-pack-panel" ref={panelRef}>
      <header><h2>Modpacks</h2><button key={selectedPack ? "back-to-packs" : "close-modpacks"} type="button" className="catalog-close" onClick={selectedPack ? returnToPacks : onClose} aria-label={selectedPack ? "Back to modpacks" : "Close Modpacks"}><CloseIcon size={18} /></button></header>
      {selectedPack ? <div className="modrinth-version-picker">
        <div className="modrinth-version-identity">
          <span className="content-icon">{selectedPack.iconUrl ? <img src={selectedPack.iconUrl} alt="" /> : <PackageOpen size={26} />}</span>
          <div><h3>{selectedPack.title}</h3><p>{selectedPack.summary}</p></div>
        </div>
        {releasesLoading ? <div className="catalog-loading modrinth-version-loading"><i className="loading-dots" /><span>Loading supported versions</span></div> : error ? <div className="modrinth-pack-error"><TriangleAlert size={20} /><span>{error}</span></div> : releases.length && selectedRelease ? <>
          <div className="modrinth-version-selectors">
            <label><span>Minecraft version</span><Select value={selectedGameVersion} options={supportedGameVersions} onChange={setSelectedGameVersion} /></label>
            <label><span>Modpack release</span><Select value={releaseLabel(selectedRelease)} options={compatibleReleases.map(releaseLabel)} onChange={(value) => setSelectedReleaseId(compatibleReleases.find((release) => releaseLabel(release) === value)?.id || "")} /></label>
          </div>
          <button className="modrinth-version-import" disabled={Boolean(installingId)} onClick={() => void install(selectedPack, selectedRelease.id)}>{installingId === selectedPack.projectId ? <Timer size={17} /> : <Download size={17} />}<span>Import</span></button>
        </> : <div className="content-empty"><PackageOpen size={25} /><b>No Fabric releases found</b><span>This pack does not currently expose a compatible Modrinth .mrpack release.</span></div>}
      </div> : <div className="modrinth-pack-list">
        {loading ? <div className="catalog-loading"><i className="loading-dots" /><span>{query ? "Searching Modrinth" : "Loading featured modpacks"}</span></div> : error ? <div className="modrinth-pack-error"><TriangleAlert size={20} /><span>{error}</span></div> : catalog.items.length ? catalog.items.map((item) => <div className={`content-item catalog-item modrinth-pack-row ${installingId === item.projectId ? "is-pending" : ""}`} key={item.projectId}>
          <span className="content-icon">{item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <PackageOpen size={22} />}</span>
          <div className="content-name"><b>{item.title}</b><small>{item.summary || `by ${item.author}`}</small></div>
          <span className="content-loader modrinth-fabric-loader" aria-label="Fabric" title="Fabric"><img src={new URL("loader-fabric.png", document.baseURI).href} alt="" /></span><span className="content-size">{formatBytes(item.fileSize)}</span>
          <div className="catalog-item-actions"><button className="catalog-view-project" onClick={() => void openUrl(`https://modrinth.com/modpack/${item.slug}`)} aria-label={`View ${item.title} on Modrinth`}><ExternalLink size={16} /></button><button className="catalog-install" disabled={Boolean(installingId)} onClick={() => void choosePack(item)} aria-label={`Choose a version of ${item.title}`}>{installingId === item.projectId ? <Timer size={16} /> : <Plus size={18} />}</button></div>
        </div>) : <div className="content-empty"><PackageOpen size={25} /><b>No compatible packs found</b><span>Try another search or select a different Minecraft version.</span></div>}
      </div>}
      {!selectedPack && <label className="modrinth-pack-search"><Search size={18} /><input aria-label="Search Modrinth modpacks" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Modrinth modpacks..." /></label>}
      {!selectedPack && pageCount > 1 && (
        <PaginationControls page={page} pages={pageCount} onPrevious={() => setPage(value => value - 1)} onNext={() => setPage(value => value + 1)} />
      )}
    </div>
  </div>;
}
type ContentInstallState = { instanceId: string; projectId: string; category: Exclude<InstanceTab, "settings">; state: "installing" | "installed" | "cancelled" | "error"; message: string; title: string; version: string };
type InstanceTab = "mods" | "resourcepacks" | "shaderpacks" | "settings";
const JVM_PRESETS = {
  Default: "",
  Performance: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:+DisableExplicitGC -XX:MaxGCPauseMillis=50",
  Overdrive: "-XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:+DisableExplicitGC -XX:MaxGCPauseMillis=35 -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:InitiatingHeapOccupancyPercent=15",
} as const;

function InstanceContentActions({
  item,
  category,
  onDelete,
}: {
  item: InstanceContentItem;
  category: Exclude<InstanceTab, "settings">;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0, width: 178, maxHeight: 330 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const bounds = (trigger.closest(".content-item") as HTMLElement | null)?.getBoundingClientRect() || trigger.getBoundingClientRect();
      const width = 178;
      const contentHeight = menuRef.current?.scrollHeight || 92;
      setPosition(fitActionMenuBelow(bounds, width, contentHeight, trigger.getBoundingClientRect().right - width));
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);
  useEffect(() => { if (open && menuRef.current) revealDropdown(menuRef.current); }, [open]);
  const modrinthSection = category === "mods" ? "mods" : category === "resourcepacks" ? "resourcepacks" : "shaders";
  return <>
    <button ref={triggerRef} className="content-dots" aria-label={`Actions for ${item.name}`} aria-expanded={open} onClick={() => setOpen(value => !value)}><MoreHorizontal size={18} /></button>
    {open && createPortal(
      <div ref={menuRef} className="select-menu select-menu-portal content-actions-menu" style={{ ...closedDropdownStyle, position: "fixed", top: position.top, left: position.left, right: "auto", width: position.width, maxHeight: position.maxHeight }}>
        <button style={{ opacity: 0 }} className="view-modrinth-action" onClick={() => { setOpen(false); void openUrl(`https://modrinth.com/${modrinthSection}?q=${encodeURIComponent(item.name)}`); }}><ExternalLink size={14} />View on Modrinth</button>
        <button style={{ opacity: 0 }} className="delete-content-action" onClick={() => { setOpen(false); void onDelete(); }}><Trash2 size={14} />Delete</button>
      </div>,
      document.body,
    )}
  </>;
}

function InstancePage({ instance, busy, initialTab = "mods", initialCatalog = false, onPlay, onChanged, onInstallContent }: { instance: InstanceDraft; busy: boolean; initialTab?: InstanceTab; initialCatalog?: boolean; onPlay: () => void; onChanged: (instance: InstanceDraft) => void; onInstallContent: (item: CatalogItem, category: Exclude<InstanceTab, "settings">) => Promise<void> }) {
  const [tab, setTab] = useState<InstanceTab>(initialTab);
  const [items, setItems] = useState<InstanceContentItem[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("Name");
  const [filter, setFilter] = useState("All");
  const [contentPage, setContentPage] = useState(1);
  const [browsingCatalog, setBrowsingCatalog] = useState(initialCatalog && instance.loader.toLowerCase().includes("fabric"));
  const [catalog, setCatalog] = useState<CatalogSearchResult>({ items: [], offset: 0, limit: 20, total: 0 });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [pendingCatalogItems, setPendingCatalogItems] = useState<Set<string>>(() => new Set());
  const [draggingContent, setDraggingContent] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [instanceMenuPosition, setInstanceMenuPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0, width: 168, maxHeight: 330 });
  const [message, setMessage] = useState("");
  const [name, setName] = useState(instance.name);
  const [memory, setMemory] = useState(instance.memory);
  const [jvmArguments, setJvmArguments] = useState(instance.jvmArguments);
  const instanceSegmentIndicator = useRef<HTMLSpanElement>(null);
  const previousContentTab = useRef<Exclude<InstanceTab, "settings">>("mods");
  const preserveInitialCatalog = useRef(initialCatalog);
  const jvmPreset = Object.entries(JVM_PRESETS).find(([, args]) => args === jvmArguments)?.[0] || "Custom";
  const iconInput = useRef<HTMLInputElement>(null);
  const instanceMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const instanceMenuRef = useRef<HTMLDivElement>(null);
  const loadContent = async () => { if (tab === "settings") return; try { setItems(await invoke<InstanceContentItem[]>("list_instance_content", { instanceId: instance.id, category: tab })); } catch (error) { setMessage(String(error)); } };
  useEffect(() => { void loadContent(); const focus = () => { if (!document.hidden) void loadContent(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [tab, instance.id]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ContentInstallState>("content-install-state", (event) => {
      const update = event.payload;
      if (update.instanceId !== instance.id || update.state === "installing") return;
      const key = `${update.category}:${update.projectId}`;
      const clearPending = () => setPendingCatalogItems(current => { const next = new Set(current); next.delete(key); return next; });
      if (update.state === "installed" && update.category === tab) void loadContent().finally(clearPending);
      else {
        clearPending();
        if (update.state === "error") setMessage(update.message);
      }
    }).then(value => { unlisten = value; });
    return () => unlisten?.();
  }, [instance.id, tab]);
  useEffect(() => { setName(instance.name); setMemory(instance.memory); setJvmArguments(instance.jvmArguments); }, [instance]);
  useEffect(() => {
    if (!menuOpen) return;
    const place = () => {
      const trigger = instanceMenuTriggerRef.current;
      if (!trigger) return;
      const bounds = (trigger.closest(".instance-hero-main") as HTMLElement | null)?.getBoundingClientRect() || trigger.getBoundingClientRect();
      const width = 168;
      const contentHeight = instanceMenuRef.current?.scrollHeight || 86;
      setInstanceMenuPosition(fitActionMenuBelow(bounds, width, contentHeight, trigger.getBoundingClientRect().right - width));
    };
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!instanceMenuTriggerRef.current?.contains(target) && !instanceMenuRef.current?.contains(target)) setMenuOpen(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", dismiss);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", dismiss); };
  }, [menuOpen]);
  useEffect(() => { if (menuOpen && instanceMenuRef.current) revealDropdown(instanceMenuRef.current); }, [menuOpen]);
  useEffect(() => {
    if (preserveInitialCatalog.current) { preserveInitialCatalog.current = false; return; }
    setBrowsingCatalog(false); setSearch("");
  }, [tab]);
  useEffect(() => { setContentPage(1); }, [tab, search, filter, sort, instance.id]);
  useEffect(() => {
    const indicator = instanceSegmentIndicator.current;
    if (!indicator) return;
    if (tab === "settings") {
      indicator.style.opacity = "0";
      return;
    }
    const positions: Record<Exclude<InstanceTab, "settings">, number> = { mods: 0, resourcepacks: 1, shaderpacks: 2 };
    const from = `translateX(${positions[previousContentTab.current] * 100}%)`;
    const to = `translateX(${positions[tab] * 100}%)`;
    previousContentTab.current = tab;
    indicator.style.opacity = "1";
    if (document.documentElement.dataset.animations !== "on" || document.documentElement.dataset.performance === "ultra") {
      indicator.style.transform = to;
      return;
    }
    waapi.animate(indicator, { transform: [from, to], duration: 280, ease: "cubic-bezier(.2,.78,.22,1)", persist: true });
  }, [tab]);
  useEffect(() => {
    if (!browsingCatalog || tab === "settings") return;
    setCatalogLoading(true);
    const timer = window.setTimeout(() => {
      void invoke<CatalogSearchResult>("search_modrinth_content", { query: search, gameVersion: instance.version, offset: (contentPage - 1) * 20, category: tab })
        .then((result) => { setCatalog(result); setMessage(""); })
        .catch((error) => setMessage(String(error)))
        .finally(() => setCatalogLoading(false));
    }, search ? 320 : 0);
    return () => window.clearTimeout(timer);
  }, [browsingCatalog, tab, search, contentPage, instance.version]);
  const toggleItem = async (item: InstanceContentItem, enabled: boolean) => { try { await invoke("toggle_instance_content", { instanceId: instance.id, category: tab, fileName: item.fileName, enabled }); await loadContent(); } catch (error) { setMessage(String(error)); } };
  const deleteItem = async (item: InstanceContentItem) => {
    if (tab === "settings") return;
    try {
      await invoke("delete_instance_content", { instanceId: instance.id, category: tab, fileName: item.fileName });
      setMessage(`${item.name} was deleted.`);
      await loadContent();
    } catch (error) { setMessage(String(error)); }
  };
  const chooseIcon = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => { void invoke<InstanceDraft>("set_instance_icon", { instanceId: instance.id, icon: String(reader.result) }).then(onChanged).catch(error => setMessage(String(error))); }; reader.readAsDataURL(file); };
  const saveSettings = async () => { try { const saved = await invoke<InstanceDraft>("update_instance_settings", { instanceId: instance.id, name, memory, jvmArguments }); onChanged(saved); setMessage("Instance settings saved."); } catch (error) { setMessage(String(error)); } };
  const applyJvmPreset = (preset: string) => { if (preset in JVM_PRESETS) setJvmArguments(JVM_PRESETS[preset as keyof typeof JVM_PRESETS]); };
  const categoryLabel = tab === "mods" ? "Mods" : tab === "resourcepacks" ? "Resource Packs" : "Shaders";
  const catalogKey = (item: CatalogItem, category: Exclude<InstanceTab, "settings"> = tab as Exclude<InstanceTab, "settings">) => `${category}:${item.projectId}`;
  const normalizedIdentity = (value: string) => value.toLowerCase().replace(/\.disabled$/i, "").replace(/\.(jar|zip)$/i, "").replace(/[^a-z0-9]+/g, "");
  const catalogItemInstalled = (item: CatalogItem) => {
    const exactFile = item.fileName.toLowerCase().replace(/\.disabled$/i, "");
    const targets = [item.title, item.slug].map(normalizedIdentity).filter(value => value.length >= 4);
    return items.some(installed => {
      if (installed.fileName.toLowerCase().replace(/\.disabled$/i, "") === exactFile) return true;
      const candidates = [installed.name, installed.fileName].map(normalizedIdentity).filter(value => value.length >= 4);
      return candidates.some(candidate => targets.some(target => candidate === target || candidate.startsWith(target) || target.startsWith(candidate)));
    });
  };
  const queueCatalogInstall = async (item: CatalogItem) => {
    if (tab === "settings" || catalogItemInstalled(item)) return;
    const key = catalogKey(item, tab);
    if (pendingCatalogItems.has(key)) return;
    setPendingCatalogItems(current => new Set(current).add(key));
    try {
      await onInstallContent(item, tab);
    } catch (error) {
      setPendingCatalogItems(current => { const next = new Set(current); next.delete(key); return next; });
      setMessage(String(error));
    }
  };
  const visibleItems = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()) && (filter === "All" || (filter === "Enabled" ? item.enabled : !item.enabled))).sort((a, b) => sort === "Size" ? b.size - a.size : a.name.localeCompare(b.name));
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / 20));
  const safePage = Math.min(contentPage, pageCount);
  const pagedItems = visibleItems.slice((safePage - 1) * 20, safePage * 20);
  const catalogPages = Math.max(1, Math.ceil(catalog.total / 20));
  const openCatalogProject = (item: CatalogItem) => {
    const section = tab === "mods" ? "mod" : tab === "resourcepacks" ? "resourcepack" : "shader";
    void openUrl(`https://modrinth.com/${section}/${encodeURIComponent(item.slug || item.projectId)}`);
  };
  const openCatalog = () => {
    if (tab === "mods" && !instance.loader.toLowerCase().includes("fabric")) { setMessage("The built-in mod catalog currently supports Fabric instances only."); return; }
    setSearch(""); setContentPage(1); setBrowsingCatalog(true); setMessage("");
  };
  const closeCatalog = () => { setBrowsingCatalog(false); setSearch(""); setContentPage(1); setMessage(""); void loadContent(); };
  useEffect(() => {
    if (tab === "settings") { setDraggingContent(false); return; }
    const category = tab;
    const itemLabel = tab === "mods" ? "mod" : tab === "resourcepacks" ? "resource pack" : "shader";
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "enter") setDraggingContent(true);
      if (event.payload.type === "leave") setDraggingContent(false);
      if (event.payload.type === "drop") {
        setDraggingContent(false);
        const paths = event.payload.paths;
        setMessage(`Importing ${paths.length} ${itemLabel}${paths.length === 1 ? "" : "s"}…`);
        const importRequest = category === "mods"
          ? invoke<string[]>("import_instance_mod_files", { instanceId: instance.id, paths })
          : invoke<string[]>("import_instance_content_files", { instanceId: instance.id, category, paths });
        void importRequest
          .then((names) => { setBrowsingCatalog(false); setSearch(""); setContentPage(1); setMessage(`${names.length} ${itemLabel}${names.length === 1 ? "" : "s"} added to ${instance.name}.`); return loadContent(); })
          .catch((error) => setMessage(String(error)));
      }
    }).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, [tab, instance.id]);
  const contentTabs: Array<[Exclude<InstanceTab, "settings">, string]> = [["mods", "Mods"], ["resourcepacks", "Resource Packs"], ["shaderpacks", "Shaders"]];
  return <div className="instance-workspace">
    {draggingContent && <div className="content-drop-overlay" role="status" aria-label={`Drop files into ${categoryLabel}`}><Inbox className="content-drop-symbol" size={58} strokeWidth={2.15} /></div>}
    <section className="instance-hero-panel"><div className="instance-hero-main"><div className="instance-identity"><button className="instance-icon-picker" onClick={() => iconInput.current?.click()} aria-label="Change instance icon" title="Change instance icon">{instance.icon ? <img src={instance.icon} alt="" /> : <Cuboid size={32} />}<span aria-hidden="true"><ArrowRightLeft size={27} strokeWidth={2.4} /></span></button><input ref={iconInput} type="file" accept="image/png,image/jpeg" hidden onChange={event => chooseIcon(event.target.files?.[0])} /><div><h1>{instance.name}</h1><p>{instance.version} • {instance.loader}</p><small>{instance.directory}</small></div></div><div className="instance-hero-actions"><button className="instance-play" disabled={busy} onClick={onPlay}><Play size={17} fill="currentColor" />Play</button><div className="instance-more-wrap"><button ref={instanceMenuTriggerRef} className="instance-more" aria-expanded={menuOpen} aria-label={`Actions for ${instance.name}`} onClick={() => setMenuOpen(value => !value)}><MoreHorizontal size={20} /></button>{menuOpen && createPortal(<div ref={instanceMenuRef} className="select-menu select-menu-portal instance-folder-menu" style={{ ...closedDropdownStyle, position: "fixed", top: instanceMenuPosition.top, left: instanceMenuPosition.left, right: "auto", width: instanceMenuPosition.width, maxHeight: instanceMenuPosition.maxHeight }}><button style={{ opacity: 0 }} onClick={() => { setMenuOpen(false); void invoke("open_instance_folder", { instanceId: instance.id }); }}>Show in folder</button><button style={{ opacity: 0 }} onClick={() => { setMenuOpen(false); void invoke("open_instance_folder", { instanceId: instance.id, category: "mods" }); }}>Open mods folder</button></div>, document.body)}</div></div></div>
    <div className="instance-tabbar">
      <div className="instance-content-segments" role="tablist" aria-label="Instance content">
        <span ref={instanceSegmentIndicator} className="instance-segment-indicator" />
        {contentTabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <button className={`instance-settings-tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")} aria-label="Instance settings" title="Instance settings"><SettingsIcon size={18} /></button>
    </div></section>
    {tab === "settings" && <section className="jvm-preset"><div className="jvm-preset-heading"><div><b>JVM Performance Profile</b><span>Optional Java tuning for this instance</span></div><div className="jvm-preset-actions"><Select value={jvmPreset} options={["Default", "Performance", "Overdrive", "Custom"]} onChange={applyJvmPreset} /><button disabled={!jvmArguments} onClick={() => applyJvmPreset("Default")}>Remove</button></div></div><div className={`jvm-preset-note ${jvmPreset.toLowerCase()}`}><Rocket size={17} /><div><b>{jvmPreset === "Default" ? "Launcher managed" : jvmPreset === "Performance" ? "Stable performance tuning" : jvmPreset === "Overdrive" ? "Experimental overdrive" : "Custom arguments"}</b><span>{jvmPreset === "Default" ? "Uses modern Java defaults. Safest choice and recommended when troubleshooting." : jvmPreset === "Performance" ? "May reduce garbage-collection stutter with conservative G1 settings. Raw FPS gains are not guaranteed." : jvmPreset === "Overdrive" ? "Aggressive G1 tuning for larger modpacks. May increase memory use or fail on an incompatible Java runtime." : "Manually edited arguments. Invalid or conflicting flags can prevent Minecraft from launching."}</span></div></div></section>}
    {tab === "settings" ? (
      <section className="instance-manager settings-manager">
        <div className="manager-heading"><div><h2>Instance Settings</h2><p>Change settings used when this instance launches.</p></div><button className="add-content" onClick={saveSettings}>Save Changes</button></div>
        <div className="instance-settings-grid"><label><span>Name</span><input value={name} onChange={event => setName(event.target.value)} /></label><label><span>Memory <b>{memory} MB</b></span><input type="range" min="1024" max="16384" step="512" value={memory} onChange={event => setMemory(Number(event.target.value))} /></label><label className="wide"><span>JVM Arguments</span><textarea value={jvmArguments} onChange={event => setJvmArguments(event.target.value)} placeholder="Optional Java arguments" /></label></div>
        {message && <p className="instance-message">{message}</p>}
      </section>
    ) : (
      <section className={`instance-manager ${browsingCatalog ? "catalog-manager" : ""}`}>
        <div className="manager-heading">
          <div className="manager-heading-identity">
            <h2>{browsingCatalog ? (search ? "Search Results" : `${categoryLabel} Library`) : categoryLabel} {!browsingCatalog && <span>{items.length}</span>}</h2>
          </div>
          <div className="manager-tools">
            {browsingCatalog ? <button className="catalog-close" onClick={closeCatalog} aria-label={`Back to installed ${categoryLabel.toLowerCase()}`}><X size={17} />Back</button> : <><Select value={sort} options={["Name", "Size"]} onChange={setSort} /><button className="add-content" onClick={openCatalog} title={`Browse compatible Modrinth ${categoryLabel.toLowerCase()}`}><CirclePlus size={17} />Add {categoryLabel}</button></>}
          </div>
        </div>
        <div className="instance-content-list-shell">
          <div className="content-list">
            {browsingCatalog ? (
              catalogLoading ? <div className="catalog-loading"><i className="loading-dots" /><span>{search ? "Searching Modrinth" : `Loading featured ${categoryLabel.toLowerCase()}`}</span></div> : catalog.items.length ? catalog.items.map(item => {
                const installed = catalogItemInstalled(item);
                const pending = pendingCatalogItems.has(catalogKey(item));
                return <div className={`content-item catalog-item ${installed ? "is-installed" : ""} ${pending ? "is-pending" : ""}`} key={item.projectId}><span className="content-icon">{item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : tab === "mods" ? <Puzzle size={22} /> : tab === "resourcepacks" ? <PackageOpen size={22} /> : <Cuboid size={22} />}</span><div className="content-name"><b>{item.title}</b><small>{item.versionNumber} • by {item.author}</small></div><span className="content-loader">{item.loader}</span><span className="content-size">{formatBytes(item.fileSize)}</span><div className="catalog-item-actions"><button className="catalog-view-project" onClick={() => openCatalogProject(item)} aria-label={`View ${item.title} on Modrinth`} title="View on Modrinth"><ExternalLink size={16} /></button><button className="catalog-install" disabled={installed || pending} onClick={() => void queueCatalogInstall(item)} aria-label={installed ? `${item.title} is installed` : pending ? `${item.title} is queued for installation` : `Install ${item.title}`}>{pending ? <Timer size={16} /> : <Plus size={18} />}</button></div>{installed && <span className="catalog-installed-state">Installed</span>}</div>;
              }) : <div className="content-empty"><Search size={24} /><b>No compatible {categoryLabel.toLowerCase()} found</b><span>Try a different search for Minecraft {instance.version}.</span></div>
            ) : visibleItems.length ? pagedItems.map(item => <div className="content-item" key={item.id}><span className="content-icon">{item.icon ? <img src={item.icon} alt="" loading="lazy" /> : tab === "shaderpacks" ? <Cuboid size={22} /> : <PackageOpen size={22} />}</span><div className="content-name"><b>{item.name}</b><small>{item.version || item.fileName}</small></div><span className="content-loader">{tab === "mods" ? instance.loader : tab === "resourcepacks" ? "Minecraft" : "Shader"}</span><span className="content-size">{formatBytes(item.size)}</span><Toggle value={item.enabled} onChange={value => void toggleItem(item, value)} /><InstanceContentActions item={item} category={tab} onDelete={() => deleteItem(item)} /></div>) : <div className="content-empty"><PackageOpen size={24} /><b>No {categoryLabel.toLowerCase()} installed</b><span>Open the folder and add files manually, or browse Modrinth.</span><button onClick={() => void invoke("open_instance_folder", { instanceId: instance.id, category: tab })}>Open folder</button></div>}
          </div>
        </div>
        {browsingCatalog
          ? catalog.total > 20 && <PaginationControls page={contentPage} pages={catalogPages} busy={catalogLoading} onPrevious={() => setContentPage(page => page - 1)} onNext={() => setContentPage(page => page + 1)} />
          : visibleItems.length > 20 && <PaginationControls page={safePage} pages={pageCount} onPrevious={() => setContentPage(safePage - 1)} onNext={() => setContentPage(safePage + 1)} />}
        <div className="content-search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={browsingCatalog ? `Search Modrinth ${categoryLabel.toLowerCase()}...` : `Search ${categoryLabel.toLowerCase()}...`} />{!browsingCatalog && <Select value={filter} options={["All", "Enabled", "Disabled"]} onChange={setFilter} />}</div>
        {message && <p className="instance-message">{message}</p>}
      </section>
    )}
  </div>;
}

type HardwareReport = { cpu: string; cores: number; threads: number; ramBytes: number; gpus: string[]; refreshRate?: number; javaVersions: number[]; recommendedMemoryMb: number; recommendedRenderDistance: number; recommendedSimulationDistance: number; recommendedGraphics: string };

function AutoTuneProgress({ step }: { step: number }) {
  return <div className="autotune-flow-progress" aria-label={`AutoTune step ${step} of 5`}>
    {[1, 2, 3, 4, 5].map(item => <span aria-current={item === step ? "step" : undefined} className={item < step ? "complete" : item === step ? "active" : ""} key={item} />)}
  </div>;
}

function AutoTuneStepHeader({ title }: { title: string }) {
  return <header className="autotune-step-header"><h1>{title}</h1></header>;
}

function AutoTunePage({ onComplete }: { onComplete: () => void }) {
  const [accepted, setAccepted] = useState(() => localStorage.getItem("bloom-autotune-accepted") === "true");
  const [report, setReport] = useState<HardwareReport | null>(() => { try { return JSON.parse(localStorage.getItem("bloom-autotune-hardware") || "null"); } catch { return null; } });
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const scan = async () => { setScanning(true); setError(""); try { const next = await invoke<HardwareReport>("detect_hardware_report"); setReport(next); localStorage.setItem("bloom-autotune-hardware", JSON.stringify(next)); onComplete(); } catch (reason) { setError(String(reason)); } finally { setScanning(false); } };
  useEffect(() => { if (report) onComplete(); }, []);
  useEffect(() => { if (accepted && !report && !scanning) void scan(); }, [accepted]);
  if (!accepted) return (
    <div className="autotune-page consent-view">
      <section className="autotune-intro">
        <header>
          <h1>What is AutoTune?</h1>
          <p>Bloom measures your PC and builds Minecraft settings that fit it. Nothing changes until you approve it.</p>
        </header>
        <div className="autotune-intro-steps">
          <article>
            <span><Cpu size={20} /></span>
            <div><b>Scan your hardware</b><p>Check your CPU, graphics, memory, display, and available Java versions.</p></div>
          </article>
          <article>
            <span><Cuboid size={20} /></span>
            <div><b>Measure Minecraft performance</b><p>Run the same private test world to measure real frame times on your computer.</p></div>
          </article>
          <article>
            <span><SlidersHorizontal size={20} /></span>
            <div><b>Build your tuned profile</b><p>Turn those results into clear memory, graphics, and world-distance recommendations.</p></div>
          </article>
          <article>
            <span><Shield size={20} /></span>
            <div><b>You stay in control</b><p>Everything stays local, and Bloom asks before applying changes to your instances.</p></div>
          </article>
        </div>
        <button
          className="autotune-accept"
          onClick={() => {
            localStorage.setItem("bloom-autotune-accepted", "true");
            setAccepted(true);
            void scan();
          }}
        >
          <WandSparkles size={17} />Accept and scan hardware
        </button>
      </section>
    </div>
  );
  return <div className="autotune-flow-shell"><section className="autotune-step-screen"><AutoTuneStepHeader title="Scan hardware" />{scanning ? <div className="autotune-action-card centered"><span className="autotune-step-mark"><Cpu size={25} /></span><b>Reading your PC</b><p>Checking hardware and Java.</p><div className="autotune-simple-progress"><i /></div></div> : error ? <div className="autotune-action-card"><span className="autotune-step-mark error"><TriangleAlert size={22} /></span><div><b>Scan failed</b><p>{error}</p></div><button onClick={() => void scan()}>Try again</button></div> : report && <div className="autotune-action-card centered"><span className="autotune-step-mark complete"><Check size={24} /></span><b>Hardware ready</b></div>}</section><AutoTuneProgress step={1} /></div>;
}

type BenchmarkResult = { averageFps: number; onePercentLow: number; averageFrameTime: number; stability: number; score: number; completedAt: number };

function AutoTuneBenchmark() {
  const [allowed, setAllowed] = useState(() => localStorage.getItem("bloom-autotune-accepted") === "true");
  const [stage, setStage] = useState<"idle" | "consent" | "running" | "result">(() => localStorage.getItem("bloom-autotune-benchmark") ? "result" : "idle");
  const [result, setResult] = useState<BenchmarkResult | null>(() => { try { return JSON.parse(localStorage.getItem("bloom-autotune-benchmark") || "null"); } catch { return null; } });
  const [progress, setProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const benchmarkRef = useRef({ start: 0, previous: 0, frames: [] as number[] });
  const stopBenchmark = () => { cancelAnimationFrame(frameRef.current); setProgress(0); setStage(result ? "result" : "idle"); };
  const runBenchmark = () => {
    const canvas = canvasRef.current;
    if (!canvas) { setStage("running"); window.setTimeout(runBenchmark, 0); return; }
    setStage("running"); setProgress(0);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) { setStage("idle"); return; }
    const width = Math.max(600, canvas.clientWidth); const height = Math.max(280, canvas.clientHeight); const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); context.scale(ratio, ratio);
    benchmarkRef.current = { start: performance.now(), previous: performance.now(), frames: [] };
    const duration = 30_000;
    const draw = (now: number) => {
      const state = benchmarkRef.current; const elapsed = now - state.start; const delta = now - state.previous; state.previous = now;
      if (delta > 0 && delta < 250) state.frames.push(delta);
      setProgress(Math.min(100, elapsed / duration * 100));
      const t = elapsed / 1000; const gradient = context.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, "#07100c"); gradient.addColorStop(1, "#111b23"); context.fillStyle = gradient; context.fillRect(0, 0, width, height);
      for (let i = 0; i < 1800; i += 1) { const size = 3 + (i % 7); const x = (i * 47 + t * (18 + i % 11)) % (width + 40) - 20; const y = (i * 83 + Math.sin(t * 1.7 + i) * 35 + height) % height; const hue = 105 + (i % 65); context.fillStyle = `hsla(${hue}, 62%, ${30 + i % 28}%, ${.18 + (i % 5) * .08})`; context.fillRect(x, y, size, size); }
      for (let layer = 0; layer < 22; layer += 1) { const depth = layer / 22; const block = 18 + depth * 34; const x = width / 2 + Math.sin(t * (.4 + depth) + layer) * width * .42; const y = height * .18 + depth * height * .68; context.fillStyle = `hsl(${112 + layer * 2}, ${38 + layer}%, ${16 + depth * 34}%)`; context.fillRect(x - block / 2, y - block / 2, block, block); context.strokeStyle = `rgba(180,255,190,${.08 + depth * .2})`; context.strokeRect(x - block / 2, y - block / 2, block, block); }
      if (elapsed < duration) frameRef.current = requestAnimationFrame(draw); else {
        const frames = state.frames.slice(5).sort((a, b) => a - b); const totalSeconds = elapsed / 1000; const averageFps = frames.length / totalSeconds; const worst = frames.slice(Math.floor(frames.length * .99)); const onePercentLow = worst.length ? 1000 / (worst.reduce((sum, value) => sum + value, 0) / worst.length) : 0; const averageFrameTime = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length); const stability = frames.filter(value => value <= averageFrameTime * 1.5).length / Math.max(1, frames.length) * 100; const next = { averageFps, onePercentLow, averageFrameTime, stability, score: Math.round(onePercentLow * .65 + averageFps * .35), completedAt: Date.now() }; localStorage.setItem("bloom-autotune-benchmark", JSON.stringify(next)); setResult(next); setProgress(100); setStage("result");
      }
    };
    frameRef.current = requestAnimationFrame(draw);
  };
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);
  useEffect(() => { if (allowed) return; const timer = window.setInterval(() => setAllowed(localStorage.getItem("bloom-autotune-accepted") === "true"), 250); return () => window.clearInterval(timer); }, [allowed]);
  if (!allowed) return null;
  return <section className="autotune-benchmark-live"><div className="benchmark-live-heading"><div><em>Phase 2 • Measured locally</em><h2>Bloom graphics benchmark</h2><p>A consistent 30-second rendered workload measures frame throughput and frame-time stability on this device.</p></div><span className="phase-two-badge">02</span></div>{stage === "idle" && <div className="benchmark-start"><BarChart3 size={28} /><div><b>Ready to establish a performance baseline</b><span>Close heavy applications and keep Bloom visible during the test for the cleanest result.</span></div><button onClick={() => setStage("consent")}>Start benchmark</button></div>}{stage === "consent" && <div className="benchmark-consent"><Activity size={22} /><div><b>Performance test confirmation</b><span>Bloom will render a demanding animated scene for 30 seconds. Fans may briefly speed up. No files are changed and no result leaves this computer.</span></div><button className="benchmark-cancel" onClick={() => setStage(result ? "result" : "idle")}>Cancel</button><button onClick={runBenchmark}>Begin test</button></div>}{stage === "running" && <div className="benchmark-running"><canvas ref={canvasRef} /><div className="benchmark-overlay"><span><Activity size={15} />Benchmark running</span><b>{Math.ceil((100 - progress) * .3)}s</b></div><div className="benchmark-progress"><i style={{ width: `${progress}%` }} /></div><button onClick={stopBenchmark}>Stop test</button></div>}{stage === "result" && result && <div className="benchmark-results"><div className="benchmark-score"><small>Bloom score</small><b>{result.score}</b><span>{result.stability >= 95 ? "Excellent stability" : result.stability >= 88 ? "Good stability" : "Variable frame times"}</span></div><div className="benchmark-metrics"><div><small>Average FPS</small><b>{result.averageFps.toFixed(1)}</b></div><div><small>1% low</small><b>{result.onePercentLow.toFixed(1)}</b></div><div><small>Frame time</small><b>{result.averageFrameTime.toFixed(2)} ms</b></div><div><small>Stability</small><b>{result.stability.toFixed(1)}%</b></div></div><div className="benchmark-result-actions"><span><Timer size={14} />Completed {new Date(result.completedAt).toLocaleDateString()}</span><button onClick={() => setStage("consent")}><RotateCw size={14} />Run again</button></div></div>}<p className="benchmark-accuracy"><Shield size={13} />This measures Bloom’s representative graphics workload, not Minecraft FPS. In-game validation will arrive with the dedicated benchmark mod.</p></section>;
}

type MinecraftBenchmarkResult = {
  minecraftVersion: string;
  seed: number;
  durationSeconds: number;
  averageFps: number;
  onePercentLow: number;
  averageFrameTimeMs: number;
  p95FrameTimeMs: number;
  averageMemoryBytes: number;
  peakMemoryBytes: number;
  frames: number;
  width: number;
  height: number;
  completedAt: number;
};

function AutoTuneMinecraftBenchmark({ onComplete, onReset }: { onComplete: () => void; onReset: () => void }) {
  const [allowed, setAllowed] = useState(() => localStorage.getItem("bloom-autotune-accepted") === "true");
  const [stage, setStage] = useState<"permission" | "installing" | "ready" | "running" | "result" | "error">("permission");
  const [benchmarkStep, setBenchmarkStep] = useState<2 | 3>(2);
  const [showDetails, setShowDetails] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Ready to install the benchmark environment");
  const [result, setResult] = useState<MinecraftBenchmarkResult | null>(null);
  useEffect(() => {
    localStorage.removeItem("bloom-autotune-benchmark");
    if (allowed) void invoke<MinecraftBenchmarkResult | null>("get_autotune_benchmark_result").then(value => { if (value) { setResult(value); setBenchmarkStep(3); setStage("result"); localStorage.setItem("bloom-autotune-minecraft-complete", String(value.completedAt)); onComplete(); } }).catch(() => {});
  }, [allowed]);
  useEffect(() => { if (allowed) return; const timer = window.setInterval(() => setAllowed(localStorage.getItem("bloom-autotune-accepted") === "true"), 250); return () => clearInterval(timer); }, [allowed]);
  useEffect(() => {
    if (stage !== "installing") return;
    const timer = window.setInterval(() => void invoke<DownloadViewState>("get_minecraft_launch_status").then(next => {
      if (next.instanceId !== "bloom-autotune-benchmark") return;
      setProgress(next.progress); setStatus(next.message || "Installing benchmark files");
      if (next.state === "complete") { setProgress(100); setBenchmarkStep(3); setStage("ready"); setStatus("Benchmark environment installed"); }
      if (next.state === "error" || next.state === "cancelled") { setStage("error"); setStatus(next.message); }
    }).catch(() => {}), 250);
    return () => clearInterval(timer);
  }, [stage]);
  useEffect(() => {
    if (stage !== "running") return;
    const timer = window.setInterval(() => {
      void invoke<{ state: string; progress: number; message: string } | null>("get_autotune_benchmark_status").then(next => {
        if (!next) return; setProgress(next.progress); setStatus(next.message);
        if (next.state === "error") { setStage("error"); return; }
        if (next.state === "complete") void invoke<MinecraftBenchmarkResult | null>("get_autotune_benchmark_result").then(value => { if (value) { setResult(value); setBenchmarkStep(3); setStage("result"); localStorage.setItem("bloom-autotune-minecraft-complete", String(value.completedAt)); onComplete(); } });
      }).catch(() => {});
    }, 500);
    return () => clearInterval(timer);
  }, [stage]);
  if (!allowed) return null;
  const install = async () => {
    onReset(); localStorage.removeItem("bloom-autotune-profile"); localStorage.removeItem("bloom-autotune-minecraft-complete");
    setBenchmarkStep(2); setStage("installing"); setProgress(1); setStatus("Preparing the private benchmark instance");
    try { await invoke("install_autotune_benchmark"); } catch (error) { setStatus(String(error)); setStage("error"); }
  };
  const launch = async () => {
    setBenchmarkStep(3); setStage("running"); setProgress(0); setStatus("Starting Minecraft 26.2");
    try { await invoke("launch_minecraft", { instanceId: "bloom-autotune-benchmark" }); } catch (error) { setStatus(String(error)); setStage("error"); }
  };
  const visibleBenchmarkStep = stage === "error" ? benchmarkStep : stage === "ready" || stage === "running" || stage === "result" ? 3 : 2;
  return <><section className="autotune-step-screen"><AutoTuneStepHeader title="Test Minecraft" />
    {stage === "permission" && <div className="autotune-action-card autotune-benchmark-permission-card"><span className="autotune-step-mark"><Cuboid size={25} /></span><div className="autotune-permission-copy"><b>Install the benchmark</b><p>Bloom creates a hidden Minecraft 26.2 test instance. Your normal instances, worlds, and settings are not changed.</p><button aria-expanded={showDetails} className="autotune-details-toggle" onClick={() => setShowDetails(value => !value)}>{showDetails ? "Hide details" : "Show details"}<ChevronDown className={showDetails ? "rotated" : ""} size={14} /></button></div><button onClick={() => void install()}>Install</button>{showDetails && <div className="autotune-details-panel"><div><Download size={16} /><span><b>What gets installed</b><small>Minecraft 26.2, Fabric API, and Bloom's benchmark mod in one private instance.</small></span></div><div><Activity size={16} /><span><b>What the test measures</b><small>About 75 seconds of real FPS, 1% lows, frame times, and Java memory in a fixed local world.</small></span></div><div><Shield size={16} /><span><b>What stays private</b><small>Results remain on this PC. Bloom does not read or upload your personal worlds or account data.</small></span></div><div><RotateCw size={16} /><span><b>If you run it again</b><small>Only the previous hidden AutoTune benchmark world is replaced.</small></span></div></div>}</div>}
    {(stage === "installing" || stage === "running") && <div className="autotune-action-card centered"><span className="autotune-step-mark">{stage === "installing" ? <Download size={23} /> : <Play size={23} />}</span><b>{stage === "installing" ? "Installing benchmark" : "Testing Minecraft"}</b><p>{status}</p><div className="autotune-simple-progress"><i style={{ width: `${progress}%` }} /></div><small>{Math.round(progress)}%</small></div>}
    {stage === "ready" && <div className="autotune-action-card"><span className="autotune-step-mark complete"><Check size={23} /></span><div><b>Ready to test</b><p>Minecraft opens, measures, and closes automatically.</p></div><button onClick={() => void launch()}><Play size={15} fill="currentColor" />Run test</button></div>}
    {stage === "error" && <div className="autotune-action-card"><span className="autotune-step-mark error"><TriangleAlert size={22} /></span><div><b>Benchmark stopped</b><p>{status}</p></div><button onClick={() => { setBenchmarkStep(2); setStage("permission"); }}>Start over</button></div>}
    {stage === "result" && result && <div className="autotune-result-card"><div className="autotune-result-lead"><span className="autotune-step-mark complete"><Check size={22} /></span><div><b>{result.averageFps.toFixed(1)} FPS</b><p>Benchmark complete</p></div></div><div className="autotune-stat-grid"><div><small>1% low</small><b>{result.onePercentLow.toFixed(1)}</b></div><div><small>Frame time</small><b>{result.averageFrameTimeMs.toFixed(2)} ms</b></div><div><small>Memory</small><b>{formatBytes(result.peakMemoryBytes)}</b></div></div><button className="autotune-secondary-action" onClick={() => { setBenchmarkStep(2); setStage("permission"); }}><RotateCw size={14} />Run again</button></div>}
  </section><AutoTuneProgress step={visibleBenchmarkStep} /></>;
}

type AutoTuneProfile = {
  targetFps: number;
  memoryMb: number;
  jvmProfile: "Default" | "Performance";
  graphics: "Fast" | "Balanced" | "High";
  renderDistance: number;
  simulationDistance: number;
  averageFps: number;
  onePercentLow: number;
  lowRatio: number;
  confidence: "Measured" | "Measured with caution";
  benchmarkCompletedAt: number;
  reasons: Array<{ title: string; detail: string; tone: "good" | "warn" | "info" }>;
};

function AutoTuneTuner({ onComplete, onReset }: { onComplete: () => void; onReset: () => void }) {
  const [profile, setProfile] = useState<AutoTuneProfile | null>(() => { try { return JSON.parse(localStorage.getItem("bloom-autotune-profile") || "null"); } catch { return null; } });
  const [tuning, setTuning] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!profile) return; void invoke<MinecraftBenchmarkResult | null>("get_autotune_benchmark_result").then(benchmark => { if (benchmark && benchmark.completedAt !== profile.benchmarkCompletedAt) { localStorage.removeItem("bloom-autotune-profile"); setProfile(null); onReset(); } }).catch(() => {}); }, []);
  useEffect(() => { if (profile) onComplete(); }, []);
  const tune = async () => {
    setTuning(true); setError("");
    try {
      const [hardware, benchmark] = await Promise.all([invoke<HardwareReport>("detect_hardware_report"), invoke<MinecraftBenchmarkResult | null>("get_autotune_benchmark_result")]);
      if (!benchmark) throw new Error("Run the Minecraft benchmark before generating a tuning profile.");
      const targetFps = Math.max(60, hardware.refreshRate || 60);
      const lowRatio = benchmark.averageFps > 0 ? benchmark.onePercentLow / benchmark.averageFps : 0;
      const totalRamMb = Math.round(hardware.ramBytes / 1048576);
      const measuredNeed = Math.ceil((benchmark.peakMemoryBytes / 1048576 * 1.45 + 768) / 512) * 512;
      const memoryMb = Math.max(3072, Math.min(8192, Math.floor(totalRamMb * .42 / 512) * 512, measuredNeed));
      const severeStutter = lowRatio < .22 || benchmark.p95FrameTimeMs > 1000 / targetFps * 2.5;
      const limitedThroughput = benchmark.averageFps < targetFps * .9;
      const renderDistance = limitedThroughput ? Math.min(8, hardware.recommendedRenderDistance) : severeStutter ? Math.min(12, hardware.recommendedRenderDistance) : hardware.recommendedRenderDistance;
      const simulationDistance = limitedThroughput ? Math.min(6, hardware.recommendedSimulationDistance) : severeStutter ? Math.min(8, hardware.recommendedSimulationDistance) : hardware.recommendedSimulationDistance;
      const graphics: AutoTuneProfile["graphics"] = limitedThroughput ? "Fast" : benchmark.averageFps > targetFps * 1.45 && !severeStutter ? "High" : "Balanced";
      const jvmProfile: AutoTuneProfile["jvmProfile"] = lowRatio < .65 ? "Performance" : "Default";
      const reasons: AutoTuneProfile["reasons"] = [
        { title: "Display target", detail: `${targetFps} FPS target from the detected ${hardware.refreshRate || 60} Hz display. The benchmark remained uncapped.`, tone: "info" },
        { title: "Rendering headroom", detail: `${benchmark.averageFps.toFixed(1)} average FPS is ${(benchmark.averageFps / targetFps).toFixed(1)}× the display target, so Bloom ${limitedThroughput ? "reduced GPU-heavy settings" : "preserved visual quality"}.`, tone: limitedThroughput ? "warn" : "good" },
        { title: "Frame consistency", detail: `${benchmark.onePercentLow.toFixed(1)} FPS 1% low (${(lowRatio * 100).toFixed(1)}% of average). Bloom ${severeStutter ? "reduced chunk and simulation pressure to address severe spikes" : "kept moderate world distances"}.`, tone: severeStutter ? "warn" : "good" },
        { title: "Measured memory", detail: `${formatBytes(benchmark.peakMemoryBytes)} peak Java usage produced a ${memoryMb / 1024} GB heap recommendation while preserving system RAM for Windows.`, tone: "info" },
        { title: "Runtime behavior", detail: `${jvmProfile} JVM tuning selected from measured frame consistency; aggressive Overdrive flags are never applied automatically.`, tone: jvmProfile === "Performance" ? "warn" : "good" },
      ];
      const next: AutoTuneProfile = { targetFps, memoryMb, jvmProfile, graphics, renderDistance, simulationDistance, averageFps: benchmark.averageFps, onePercentLow: benchmark.onePercentLow, lowRatio, confidence: severeStutter ? "Measured with caution" : "Measured", benchmarkCompletedAt: benchmark.completedAt, reasons };
      localStorage.setItem("bloom-autotune-profile", JSON.stringify(next)); setProfile(next); onComplete();
    } catch (reason) { setError(String(reason)); } finally { setTuning(false); }
  };
  return <section className="autotune-step-screen"><AutoTuneStepHeader title="Build profile" />{!profile ? <div className="autotune-action-card centered"><span className="autotune-step-mark"><WandSparkles size={24} /></span><b>{tuning ? "Building your profile" : "Ready to tune"}</b><p>{tuning ? "Comparing your measured results." : "Creates recommended settings from the benchmark."}</p>{tuning && <div className="autotune-simple-progress indeterminate"><i /></div>}<button disabled={tuning} onClick={() => void tune()}>{tuning ? "Tuning…" : "Build profile"}</button></div> : <div className="autotune-result-card"><div className="autotune-result-lead"><span className="autotune-step-mark complete"><Check size={22} /></span><div><b>Profile ready</b><p>{profile.confidence}</p></div></div><div className="autotune-stat-grid five"><div><small>Memory</small><b>{profile.memoryMb / 1024} GB</b></div><div><small>JVM</small><b>{profile.jvmProfile}</b></div><div><small>Graphics</small><b>{profile.graphics}</b></div><div><small>Render</small><b>{profile.renderDistance}</b></div><div><small>Simulation</small><b>{profile.simulationDistance}</b></div></div><button className="autotune-secondary-action" disabled={tuning} onClick={() => void tune()}><RotateCw size={14} />Recalculate</button></div>}{error && <div className="autotune-inline-error"><TriangleAlert size={15} /><span>{error}</span></div>}</section>;
}

function AutoTuneApply() {
  const [profile, setProfile] = useState<AutoTuneProfile | null>(() => { try { return JSON.parse(localStorage.getItem("bloom-autotune-profile") || "null"); } catch { return null; } });
  const [instanceCount, setInstanceCount] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { const timer = window.setInterval(() => { try { setProfile(JSON.parse(localStorage.getItem("bloom-autotune-profile") || "null")); } catch {} }, 400); void invoke<InstanceDraft[]>("list_instances").then(items => setInstanceCount(items.length)); return () => clearInterval(timer); }, []);
  const apply = async () => { if (!profile) return; setApplying(true); setError(""); try { const count = await invoke<number>("apply_autotune_profile", { profile }); setAppliedCount(count); setConfirming(false); } catch (reason) { setError(String(reason)); } finally { setApplying(false); } };
  return <section className="autotune-step-screen"><AutoTuneStepHeader title="Apply AutoTune" />{!profile ? <div className="autotune-action-card centered"><span className="autotune-step-mark"><LockKeyhole size={22} /></span><b>Profile required</b><p>Complete the previous step first.</p></div> : appliedCount !== null ? <div className="autotune-action-card centered"><span className="autotune-step-mark complete"><Check size={24} /></span><b>AutoTune is active</b><p>Updated {appliedCount} instance{appliedCount === 1 ? "" : "s"}. Future instances inherit it automatically.</p><button onClick={() => { setAppliedCount(null); setConfirming(false); }}>Review profile</button></div> : <><div className="autotune-result-card"><div className="autotune-stat-grid"><div><small>Memory</small><b>{profile.memoryMb / 1024} GB</b></div><div><small>JVM</small><b>{profile.jvmProfile}</b></div><div><small>Graphics</small><b>{profile.graphics}</b></div><div><small>Distances</small><b>{profile.renderDistance} / {profile.simulationDistance}</b></div></div>{confirming ? <div className="autotune-confirm-row"><div><b>Apply to {instanceCount} instance{instanceCount === 1 ? "" : "s"}?</b><p>Updates only AutoTune-managed settings.</p></div><button className="autotune-secondary-action" onClick={() => setConfirming(false)}>Cancel</button><button disabled={applying} onClick={() => void apply()}>{applying ? "Applying…" : "Apply"}</button></div> : <button className="autotune-primary-action" onClick={() => setConfirming(true)}>Apply profile</button>}</div></>}{error && <div className="autotune-inline-error"><TriangleAlert size={15} /><span>{error}</span></div>}</section>;
}

function AutoTuneFlow() {
  const [hardwareComplete, setHardwareComplete] = useState(() => Boolean(localStorage.getItem("bloom-autotune-hardware")));
  const [benchmarkComplete, setBenchmarkComplete] = useState(() => Boolean(localStorage.getItem("bloom-autotune-minecraft-complete")));
  const [profileComplete, setProfileComplete] = useState(() => Boolean(localStorage.getItem("bloom-autotune-profile")));
  const resetBenchmarkProgress = () => { setBenchmarkComplete(false); setProfileComplete(false); };
  const phase = profileComplete ? 4 : benchmarkComplete ? 3 : hardwareComplete ? 2 : 1;
  if (phase === 1) return <AutoTunePage onComplete={() => setHardwareComplete(true)} />;
  return <div className="autotune-flow-shell">
    {phase === 2 ? <AutoTuneMinecraftBenchmark onComplete={() => setBenchmarkComplete(true)} onReset={resetBenchmarkProgress} /> : phase === 3 ? <><AutoTuneTuner onComplete={() => setProfileComplete(true)} onReset={() => setProfileComplete(false)} /><AutoTuneProgress step={4} /></> : <><AutoTuneApply /><AutoTuneProgress step={5} /></>}
  </div>;
}

type DownloadTaskKind = "mod" | "resourcepack" | "shaderpack" | "game";
type DownloadViewState = { active: boolean; progress: number; state: string; message: string; instanceId?: string; downloadedBytes?: number; totalBytes?: number; bytesPerSecond?: number; taskName?: string; taskVersion?: string; taskKind?: DownloadTaskKind };
type LogEntry = { id: string; instanceId: string; instanceName: string; stream: string; level: "info" | "warn" | "error"; message: string; timestamp: number };

function LogsPage({ entries, running, onClear }: { entries: LogEntry[]; running: boolean; onClear: () => void }) {
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("All levels");
  const consoleEnd = useRef<HTMLDivElement>(null);
  const filtered = entries.filter(entry => (level === "All levels" || entry.level === level.toLowerCase()) && `${entry.instanceName} ${entry.message}`.toLowerCase().includes(search.toLowerCase()));
  const errors = entries.filter(entry => entry.level === "error").length;
  const warnings = entries.filter(entry => entry.level === "warn").length;
  const first = entries[0]?.timestamp;
  const last = entries.at(-1)?.timestamp;
  useEffect(() => { consoleEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries.length]);
  const copyLogs = () => void navigator.clipboard.writeText(filtered.map(entry => `[${new Date(entry.timestamp).toLocaleTimeString()}] [${entry.level.toUpperCase()}] ${entry.message}`).join("\n"));
  return <div className="logs-page">
    <header className="logs-heading"><div><h1>Live Logs</h1><p>Watch Minecraft output and diagnose launch problems in real time.</p></div><span className={`logs-live ${running ? "active" : ""}`}><i />{running ? "Live session" : "Console idle"}</span></header>
    <section className="log-stats">
      <div><small>Session output</small><b>{entries.length.toLocaleString()} lines</b></div>
      <div><small>Warnings</small><b>{warnings}</b></div>
      <div><small>Errors</small><b>{errors}</b></div>
      <div><small>Session time</small><b>{first && last ? `${Math.max(0, Math.round((last - first) / 1000))}s` : "—"}</b></div>
    </section>
    <section className="console-shell">
      <div className="console-toolbar"><div className="console-title"><TerminalSquare size={16} /><span>Minecraft Console</span><em>{filtered.length} visible</em></div><div className="console-actions"><button onClick={copyLogs}><Clipboard size={15} />Copy</button><button onClick={onClear}><Trash2 size={15} />Clear</button></div></div>
      <div className="console-output">
        {filtered.length ? filtered.map(entry => <div className={`console-line ${entry.level}`} key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}</time><span className="console-level">{entry.level}</span><span className="console-instance">{entry.instanceName}</span><code>{entry.message}</code></div>) : <div className="console-empty"><TerminalSquare size={25} /><b>No log output yet</b><span>Launch an instance and its live console output will appear here.</span></div>}
        <div ref={consoleEnd} />
      </div>
      <div className="console-filter"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search console output…" /><Select value={level} options={["All levels", "Info", "Warn", "Error"]} onChange={setLevel} /></div>
    </section>
  </div>;
}
type CompletedDownload = { id: string; name: string; version: string; loader?: string; targetName?: string; kind?: DownloadTaskKind; completedAt: number };

const formatBytes = (bytes = 0) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

type InstanceLibraryDestination = "view" | "add-mods" | "settings";

function InstanceLibraryCard({ instance, busy, doubleClickToPlay, onNavigate, onPlay, onDelete }: { instance: InstanceDraft; busy: boolean; doubleClickToPlay: boolean; onNavigate: (instance: InstanceDraft, destination: InstanceLibraryDestination) => void; onPlay: (instance: InstanceDraft) => void; onDelete: (instance: InstanceDraft) => Promise<void> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [position, setPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0, width: 190, maxHeight: 330 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
  }, []);
  useEffect(() => {
    if (!menuOpen) { setConfirmDelete(false); return; }
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const bounds = (trigger.closest(".instance-library-card") as HTMLElement | null)?.getBoundingClientRect() || trigger.getBoundingClientRect();
      const width = 190;
      const contentHeight = menuRef.current?.scrollHeight || 188;
      setPosition(fitActionMenuBelow(bounds, width, contentHeight, trigger.getBoundingClientRect().right - width));
    };
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", dismiss);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("pointerdown", dismiss); };
  }, [menuOpen]);
  useEffect(() => { if (menuOpen && menuRef.current) revealDropdown(menuRef.current); }, [menuOpen]);
  const navigate = (destination: InstanceLibraryDestination) => { setMenuOpen(false); onNavigate(instance, destination); };
  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try { await onDelete(instance); } finally { setDeleting(false); }
  };
  const openCard = (event: MouseEvent<HTMLElement>) => {
    if (!doubleClickToPlay) { onNavigate(instance, "view"); return; }
    if (event.detail !== 1) return;
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null;
      onNavigate(instance, "view");
    }, 240);
  };
  const playFromDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (!doubleClickToPlay) return;
    event.preventDefault();
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    openTimer.current = null;
    onPlay(instance);
  };
  return <article className="instance-library-card" onClick={openCard} onDoubleClick={playFromDoubleClick}>
    <div className="library-card-identity"><div className="library-card-top"><span className="library-instance-icon">{instance.icon ? <img src={instance.icon} alt="" /> : <span aria-hidden="true">?</span>}</span><LoaderLogo loader={instance.loader} /></div>
    <div className="library-card-copy"><h2>{instance.name}</h2><p>Minecraft {instance.version}</p><small title={instance.directory}>{instance.directory}</small></div></div>
    <div className="library-card-actions"><button className="library-play" disabled={busy} onClick={(event) => { event.stopPropagation(); onPlay(instance); }}><Play size={15} fill="currentColor" />Play</button><button className="library-folder" onClick={(event) => { event.stopPropagation(); void invoke("open_instance_folder", { instanceId: instance.id }); }} aria-label={`Open ${instance.name} folder`}><span className="animated-folder"><Folder className="folder-closed" size={17} /><FolderOpen className="folder-open" size={17} /></span></button><button ref={triggerRef} className="library-more" onClick={(event) => { event.stopPropagation(); setMenuOpen(value => !value); }} aria-label={`Actions for ${instance.name}`} aria-expanded={menuOpen}><MoreHorizontal size={18} /></button></div>
    {menuOpen && createPortal(<div ref={menuRef} className="select-menu select-menu-portal instance-library-menu" style={{ ...closedDropdownStyle, position: "fixed", top: position.top, left: position.left, right: "auto", width: position.width, maxHeight: position.maxHeight }} onClick={(event) => event.stopPropagation()}>
      <button style={{ opacity: 0 }} onClick={() => navigate("view")}><Layers3 size={15} />View instance</button>
      <button style={{ opacity: 0 }} onClick={() => navigate("add-mods")}><Puzzle size={15} />Add mods</button>
      <button style={{ opacity: 0 }} onClick={() => navigate("settings")}><SettingsIcon size={15} />Settings</button>
      <button style={{ opacity: 0 }} className={`instance-delete-action ${confirmDelete ? "confirm" : ""}`} disabled={deleting || busy} onClick={() => void remove()}><Trash2 size={15} />{deleting ? "Deleting…" : confirmDelete ? "Confirm delete" : "Delete instance"}</button>
    </div>, document.body)}
  </article>;
}

function LoaderLogo({ loader }: { loader: string }) {
  const [failed, setFailed] = useState(false);
  const fabric = loader.toLowerCase().includes("fabric");
  // Packaged Tauri builds may use a local file/asset origin. Resolving from
  // document.baseURI keeps these bundled images beside index.html instead of
  // accidentally pointing at the protocol or Windows drive root.
  const source = new URL(fabric ? "loader-fabric.png" : "loader-vanilla.png", document.baseURI).href;
  if (failed) {
    return <span className="library-loader-logo library-loader-logo-fallback" aria-label={`${loader} loader`} title={`${loader} loader`}>{fabric ? <Feather size={19} /> : <Cuboid size={19} />}</span>;
  }
  return <img className="library-loader-logo" src={source} alt={`${loader} loader`} onError={() => setFailed(true)} />;
}

function InstancesPage({ instances, busy, doubleClickToPlay, onOpen, onDelete, onPlay, onCreate }: { instances: InstanceDraft[]; busy: boolean; doubleClickToPlay: boolean; onOpen: (instance: InstanceDraft, destination: InstanceLibraryDestination) => void; onDelete: (instance: InstanceDraft) => Promise<void>; onPlay: (instance: InstanceDraft) => void; onCreate: () => void }) {
  const [query, setQuery] = useState("");
  const [loader, setLoader] = useState("All");
  const visible = instances.filter((instance) => instance.name.toLowerCase().includes(query.toLowerCase()) && (loader === "All" || instance.loader.toLowerCase() === loader.toLowerCase()));
  const loaders = ["All", ...Array.from(new Set(instances.map((instance) => instance.loader)))];
  return <div className="instances-page">
    <header className="instances-page-heading"><div><span className="instances-eyebrow">YOUR LIBRARY</span><h1>All Instances</h1><p>Every world, pack, and client setup in one place.</p></div><button className="instances-create" onClick={onCreate}><CirclePlus size={17} />New instance</button></header>
    <section className="instances-toolbar"><div className="instances-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your instances..." /></div><Select value={loader} options={loaders} onChange={setLoader} variant="filter" /></section>
    {visible.length ? <div className="instances-grid">{visible.map((instance) => <InstanceLibraryCard key={instance.id} instance={instance} busy={busy} doubleClickToPlay={doubleClickToPlay} onNavigate={onOpen} onDelete={onDelete} onPlay={onPlay} />)}</div> : <div className="instances-empty"><Cuboid size={30} /><h2>{instances.length ? "No matching instances" : "Your library is empty"}</h2><p>{instances.length ? "Try another name or loader filter." : "Create your first instance to start building your library."}</p>{!instances.length && <button onClick={onCreate}><CirclePlus size={16} />New instance</button>}</div>}
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
        <span className="download-task-icon">{download.taskKind === "mod" ? <Puzzle size={24} /> : download.taskKind === "resourcepack" ? <PackageOpen size={24} /> : <Cuboid size={24} />}</span>
        <div className="download-task-main"><div className="download-task-title"><div><b>{download.taskName || activeInstance?.name || "Minecraft"}</b><small>{download.taskKind && download.taskKind !== "game" ? `${download.taskVersion || (download.taskKind === "mod" ? "Fabric mod" : download.taskKind === "resourcepack" ? "Resource pack" : "Shader")} • Installing to ${activeInstance?.name || "instance"}` : activeInstance ? `${activeInstance.version} • ${activeInstance.loader}` : "Preparing instance"}</small></div><span>{Math.round(download.progress)}%</span></div><div className="download-linear"><i style={{ width: `${download.progress}%` }} /></div></div>
        <div className="download-metrics"><span>{failed ? "Task stopped" : download.totalBytes ? `${formatBytes(download.downloadedBytes)} / ${formatBytes(download.totalBytes)}` : "Scanning files"}</span><small>{failed ? "See error" : download.bytesPerSecond ? `${formatBytes(download.bytesPerSecond)}/s` : "Calculating speed"}</small></div>
        <div className="download-task-status"><b>{status}</b><small title={download.message}>{download.message || "Preparing files"}{download.message === "Loading assets" && <i className="loading-dots" />}</small></div>{!failed && <button className="cancel-download" onClick={onCancel} aria-label="Cancel task">×</button>}
      </div> : <div className="downloads-empty"><Download size={20} /><div><b>No active downloads</b><span>New Minecraft installations will appear here.</span></div></div>}
    </section>
    <section className="download-section completed-section"><h2>Completed</h2>
      {completed.length ? completed.map(item => <div className="download-task completed-task" key={item.id}>
        <span className="download-task-icon">{item.kind === "mod" ? <Puzzle size={22} /> : item.kind === "resourcepack" ? <PackageOpen size={22} /> : <Cuboid size={22} />}</span><div className="download-task-main"><b>{item.name}</b><small>{item.kind && item.kind !== "game" ? `${item.version} • Installed to ${item.targetName}` : `${item.version} • ${item.loader || "Vanilla"}`}</small></div><span className="completed-time">Completed {new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-Math.max(1, Math.round((Date.now() - item.completedAt) / 60000)), "minute")}</span><Check className="completed-check" size={20} />
      </div>) : <div className="downloads-empty compact"><Check size={18} /><div><b>No completed downloads yet</b><span>Finished installations will be saved here.</span></div></div>}
    </section>
    <footer className="downloads-footer"><span>Downloads are saved inside each instance directory.</span><button disabled={!completed.length} onClick={onClear}><Trash2 size={16} />Clear Completed</button></footer>
  </div>;
}

function SpotlightInstanceSelect({
  instances,
  selected,
  onSelect,
}: {
  instances: InstanceDraft[];
  selected: InstanceDraft;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FloatingMenuPosition>({ top: 0, left: 0, width: 320, maxHeight: 330 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.max(140, bounds.width - 10);
      const contentHeight = menuRef.current?.scrollHeight || instances.length * 50 + 10;
      const top = bounds.bottom - 10;
      const viewportPadding = 8;
      setPosition({
        top,
        left: Math.max(viewportPadding, Math.min(bounds.left + 5, window.innerWidth - width - viewportPadding)),
        width,
        maxHeight: Math.min(330, Math.max(72, Math.min(contentHeight + 10, window.innerHeight - top - viewportPadding))),
      });
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [instances.length, open]);
  useEffect(() => {
    if (open && menuRef.current) revealDropdown(menuRef.current);
  }, [open, instances.length]);

  return (
    <div className="spotlight-instance-picker">
      <button ref={triggerRef} className="spotlight-select-trigger" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><b>{selected.name}</b><small>{selected.version} • {selected.loader}</small></span>
        <ChevronDown size={17} className={open ? "rotated" : ""} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="select-menu select-menu-portal spotlight-select-menu" style={{ ...closedDropdownStyle, position: "fixed", top: position.top, left: position.left, right: "auto", width: position.width, maxHeight: position.maxHeight }}>
          {instances.map((instance) => (
            <button style={{ opacity: 0 }} className={instance.id === selected.id ? "chosen" : ""} key={instance.id} onClick={() => { onSelect(instance.id); setOpen(false); }}>
              <b>{instance.name}</b><small>{instance.version} • {instance.loader}</small>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function SpotlightHome({
  instances,
  selectedId,
  busy,
  onSelect,
  onPlay,
  onCreate,
}: {
  instances: InstanceDraft[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onPlay: (instance: InstanceDraft) => void;
  onCreate: () => void;
}) {
  const selected = instances.find(instance => instance.id === selectedId) || instances[0] || null;
  return (
    <section className="spotlight-home">
      <div className="spotlight-stage">
        <div className="spotlight-center">
          {selected ? (
            <>
              <div className="spotlight-selected-identity" key={selected.id}>
                <span className="spotlight-selected-art" aria-hidden="true">
                  {selected.icon ? <img src={selected.icon} alt="" /> : <Cuboid size={34} />}
                </span>
                <b>{selected.name}</b>
              </div>
              <div className="spotlight-launch-controls">
                <button className="spotlight-play" disabled={busy} onClick={() => onPlay(selected)}>
                  <Play size={24} fill="currentColor" />
                  <b>Play</b>
                </button>
                <SpotlightInstanceSelect instances={instances} selected={selected} onSelect={onSelect} />
              </div>
            </>
          ) : (
            <div className="spotlight-empty-launch">
              <span className="spotlight-selected-art" aria-hidden="true"><Plus size={32} /></span>
              <button className="spotlight-play spotlight-create" onClick={onCreate}><Plus size={23} /><b>Create instance</b></button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [page, setPage] = useState<AppPage>(
    (() => {
      try {
        const saved = { ...defaults, ...JSON.parse(localStorage.getItem("bloom-settings") || "{}") } as SettingsState;
        if (saved.startupBehavior === "Open Settings") return "settings";
        if (saved.startupBehavior === "Remember last page") {
          const remembered = localStorage.getItem("bloom-last-page");
          const validPages: AppPage[] = ["home", "settings", "autotune", "new-instance", "downloads", "logs", "instance", "instances"];
          return validPages.includes(remembered as AppPage) ? remembered as AppPage : "home";
        }
      } catch {}
      return "home";
    })(),
  );
  const [instances, setInstances] = useState<InstanceDraft[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [instanceDestination, setInstanceDestination] = useState<InstanceLibraryDestination>("view");
  const instanceOpenTimers = useRef(new Map<string, number>());
  const [spotlightInstanceId, setSpotlightInstanceId] = useState<string | null>(() => localStorage.getItem("bloom-spotlight-instance"));
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
  const [toastKind, setToastKind] = useState<"notification" | "error">("notification");
  const [availableUpdate, setAvailableUpdate] = useState<TauriUpdate | null>(null);
  const [currentVersion, setCurrentVersion] = useState("1.0.0");
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updatePanelOpen, setUpdatePanelOpen] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<"ready" | "downloading" | "installing" | "error">("ready");
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateError, setUpdateError] = useState("");
  const [mockUpdateActive, setMockUpdateActive] = useState(false);
  const updateCheckStarted = useRef(false);
  const updateSurfaceRef = useRef<HTMLElement>(null);
  const mockUpdateInterval = useRef<number | null>(null);
  const mockInstallTimer = useRef<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [signInOpen, setSignInOpen] = useState(false);
  const [profile, setProfile] = useState<MinecraftProfile | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("bloom-profile") || "null");
    } catch {
      return null;
    }
  });
  const [profileIcon, setProfileIcon] = useState<string | null>(() => localStorage.getItem(PROFILE_ICON_STORAGE_KEY));
  const [customBackgroundImage, setCustomBackgroundImage] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [windowMenuOpen, setWindowMenuOpen] = useState<WindowMenuName | null>(null);
  const windowMenuRef = useRef<HTMLDivElement>(null);
  const [accounts, setAccounts] = useState<MinecraftProfile[]>([]);
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState("General");
  const [settingsNavigationKey, setSettingsNavigationKey] = useState(0);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [settings, setSettings] = useState<SettingsState>(() => {
    try {
      let loaded = {
        ...defaults,
        ...JSON.parse(localStorage.getItem("bloom-settings") || "{}"),
      } as SettingsState;
      if (localStorage.getItem(spotlightDefaultMigrationKey) !== "complete") {
        loaded = { ...loaded, homeLayout: "Spotlight" as HomeLayout };
        localStorage.setItem(spotlightDefaultMigrationKey, "complete");
      }
      if (localStorage.getItem(customBackgroundDefaultsMigrationKey) !== "complete") {
        loaded = {
          ...loaded,
          sidebarOpacity: loaded.sidebarOpacity === 78 ? 92 : loaded.sidebarOpacity,
          elementOpacity: loaded.elementOpacity === 83 ? 35 : loaded.elementOpacity,
        };
        localStorage.setItem(customBackgroundDefaultsMigrationKey, "complete");
      }
      loaded = { ...loaded, theme: "oled" };
      localStorage.setItem("bloom-settings", JSON.stringify(loaded));
      return loaded;
    } catch {
      return defaults;
    }
  });
  useEffect(() => () => {
    instanceOpenTimers.current.forEach((timer) => window.clearTimeout(timer));
    instanceOpenTimers.current.clear();
  }, []);
  useEffect(() => {
    if (!profileMenuOpen && !signInOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setProfileMenuOpen(false); setSignInOpen(false); }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [profileMenuOpen, signInOpen]);
  useEffect(() => {
    if (!settings.customBackground) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void invoke<string | null>("load_custom_background")
        .then(image => { if (!cancelled) setCustomBackgroundImage(image); })
        .catch(() => {});
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [settings.customBackground]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("bloom-live-logs") || "[]") as LogEntry[];
        if (Array.isArray(saved) && saved.length) {
          setLogs(current => [...saved, ...current].slice(-600));
        }
      } catch {}
    }, 500);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    localStorage.setItem("bloom-settings", JSON.stringify(settings));
    document.documentElement.style.setProperty("--accent", settings.accent);
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.animations = settings.animations && !settings.ultraPerformance ? "on" : "off";
    document.documentElement.dataset.performance = settings.ultraPerformance ? "ultra" : "normal";
    const buttonPressDuration = Math.max(0, Math.min(1500, settings.buttonPressDuration));
    document.documentElement.dataset.buttonPressDuration = String(buttonPressDuration);
  }, [settings]);
  useEffect(() => {
    const activePresses = new WeakMap<HTMLElement, Animation>();
    const press = (event: PointerEvent) => {
      if (event.button !== 0 || document.documentElement.dataset.animations !== "on" || document.documentElement.dataset.performance === "ultra") return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button, .instance-library-card") : null;
      if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
      if (target.closest(".accent-picks") || target.closest(".window-menu") || target.classList.contains("instance-icon-picker") || target.classList.contains("window-control")) return;
      const duration = Number(document.documentElement.dataset.buttonPressDuration || 0);
      activePresses.get(target)?.cancel();
      activePresses.delete(target);
      if (duration <= 0) return;
      const animation = target.animate(
        [
          { translate: "0 0", scale: "1" },
          { translate: "0 1.5px", scale: ".975" },
          { translate: "0 -.5px", scale: "1.008" },
          { translate: "0 0", scale: "1" },
        ],
        {
          duration,
          easing: "cubic-bezier(.2,.72,.22,1)",
          fill: "none",
        },
      );
      activePresses.set(target, animation);
      void animation.finished
        .catch(() => undefined)
        .finally(() => {
          if (activePresses.get(target) === animation) activePresses.delete(target);
        });
    };
    document.addEventListener("pointerdown", press, { passive: true });
    return () => document.removeEventListener("pointerdown", press);
  }, []);
  useEffect(() => { if (page !== "new-instance" && page !== "instance") localStorage.setItem("bloom-last-page", page); }, [page]);
  useEffect(() => {
    if (spotlightInstanceId) localStorage.setItem("bloom-spotlight-instance", spotlightInstanceId);
    else localStorage.removeItem("bloom-spotlight-instance");
  }, [spotlightInstanceId]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(async event => {
      if (!settings.tray) return;
      event.preventDefault();
      await getCurrentWindow().hide();
    }).then(value => { unlisten = value; });
    return () => unlisten?.();
  }, [settings.tray]);
  const checkForUpdates = async (manual = false) => {
    if (updateChecking) return;
    setUpdateChecking(true);
    try {
      const update = await check({ timeout: 15_000 });
      setAvailableUpdate((previous) => {
        if (previous && previous !== update) void previous.close().catch(() => {});
        return update;
      });
      if (manual && !update) {
        setToastKind("notification");
        setToast("Bloom Client is already up to date.");
        window.setTimeout(() => setToast(""), 3200);
      }
    } catch (error) {
      if (manual) {
        setToastKind("error");
        setToast(`Could not check for updates: ${String(error)}`);
        window.setTimeout(() => setToast(""), 4200);
      }
    } finally {
      setUpdateChecking(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void getVersion().then(setCurrentVersion).catch(() => {});
      if (updateCheckStarted.current) return;
      updateCheckStarted.current = true;
      if (settings.updates) void checkForUpdates(false);
    }, 1800);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const showMockUpdate = (event: globalThis.KeyboardEvent) => {
      const isMockUpdateShortcut = event.ctrlKey && event.shiftKey
        && (event.code === "KeyU" || event.code === "F10");
      if (!isMockUpdateShortcut || event.repeat) return;
      if (document.querySelector(".update-surface.expanded")) return;
      event.preventDefault();
      event.stopPropagation();
      setMockUpdateActive(true);
      setUpdatePanelOpen(false);
      setUpdatePhase("ready");
      setUpdateProgress(0);
      setUpdateError("");
    };
    window.addEventListener("keydown", showMockUpdate, { capture: true });
    return () => window.removeEventListener("keydown", showMockUpdate, { capture: true });
  }, []);

  useEffect(() => () => {
    if (mockUpdateInterval.current !== null) window.clearInterval(mockUpdateInterval.current);
    if (mockInstallTimer.current !== null) window.clearTimeout(mockInstallTimer.current);
  }, []);
  useEffect(() => {
    if (windowMenuOpen && windowMenuRef.current) revealWindowMenu(windowMenuRef.current);
  }, [windowMenuOpen]);

  useEffect(() => {
    const surface = updateSurfaceRef.current;
    if (!surface || (!availableUpdate && !mockUpdateActive) || updatePanelOpen) return;
    if (document.documentElement.dataset.animations !== "on" || document.documentElement.dataset.performance === "ultra") return;
    const entrance = surface.animate(
      [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }],
      { duration: 480, easing: "cubic-bezier(.2,.78,.2,1)", fill: "none" },
    );
    return () => entrance.cancel();
  }, [availableUpdate, mockUpdateActive]);

  useEffect(() => {
    const surface = updateSurfaceRef.current;
    if (!surface || !updatePanelOpen) return;
    if (document.documentElement.dataset.animations !== "on" || document.documentElement.dataset.performance === "ultra") return;
    const reveal = surface.animate(
      [
        { clipPath: "inset(calc(100% - 68px) 0 0 0 round 18px 18px 0 0)" },
        { clipPath: "inset(0 0 0 0 round 0)" },
      ],
      { duration: 640, easing: "cubic-bezier(.72,0,.16,1)", fill: "none" },
    );
    return () => reveal.cancel();
  }, [updatePanelOpen]);

  const installUpdate = async () => {
    if ((!availableUpdate && !mockUpdateActive) || !["ready", "error"].includes(updatePhase)) return;
    setUpdatePanelOpen(true);
    setUpdatePhase("downloading");
    setUpdateProgress(0);
    setUpdateError("");
    if (mockUpdateActive) {
      if (mockUpdateInterval.current !== null) window.clearInterval(mockUpdateInterval.current);
      if (mockInstallTimer.current !== null) window.clearTimeout(mockInstallTimer.current);
      let mockProgress = 0;
      mockUpdateInterval.current = window.setInterval(() => {
        mockProgress = Math.min(100, mockProgress + 4);
        setUpdateProgress(mockProgress);
        if (mockProgress < 100) return;
        if (mockUpdateInterval.current !== null) window.clearInterval(mockUpdateInterval.current);
        mockUpdateInterval.current = null;
        setUpdatePhase("installing");
        mockInstallTimer.current = window.setTimeout(() => {
          mockInstallTimer.current = null;
          setUpdatePanelOpen(false);
          setUpdatePhase("ready");
          setUpdateProgress(0);
          setMockUpdateActive(false);
        }, 1500);
      }, 85);
      return;
    }
    const realUpdate = availableUpdate;
    if (!realUpdate) return;
    let downloaded = 0;
    let total = 0;
    try {
      await realUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength || 0;
          setUpdateProgress(0);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) setUpdateProgress(Math.min(100, (downloaded / total) * 100));
        } else {
          setUpdateProgress(100);
          setUpdatePhase("installing");
        }
      });
      await relaunch();
    } catch (error) {
      setUpdatePhase("error");
      setUpdateError(String(error));
    }
  };

  const closeUpdateError = () => {
    if (updatePhase !== "error") return;
    setUpdatePanelOpen(false);
    setUpdatePhase("ready");
    setUpdateProgress(0);
    setUpdateError("");
  };
  const displayedUpdateVersion = mockUpdateActive ? "9.9.9-test" : availableUpdate?.version || "";
  useEffect(() => {
    let stop: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      stop = monitorBackend((status) => {
        document.documentElement.dataset.backend = status?.status === "ok" ? "online" : "offline";
      });
    }, 2400);
    return () => { window.clearTimeout(timer); stop?.(); };
  }, []);
  useEffect(() => {
    if (profile) localStorage.setItem("bloom-profile", JSON.stringify(profile));
    else localStorage.removeItem("bloom-profile");
  }, [profile]);
  useEffect(() => {
    if (profileIcon) localStorage.setItem(PROFILE_ICON_STORAGE_KEY, profileIcon);
  }, [profileIcon]);
  const refreshAccounts = async () => {
    const list = await invoke<MinecraftAccountList>("list_minecraft_accounts");
    setAccounts(list.accounts);
    const active = await invoke<MinecraftProfile | null>("get_saved_minecraft_profile");
    setProfile(active);
    return active;
  };
  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshAccounts().catch(() => {}); }, 250);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    void invoke<InstanceDraft[]>("list_instances").then(setInstances);
  }, []);
  useEffect(() => {
    if (gameRunning || download.active) return;
    const timer = window.setTimeout(() => {
      void invoke<string[]>("reconcile_cosmetics").then(problems => {
        if (problems.length) { setToastKind("error"); setToast(problems.join("\n")); }
      }).catch(error => { setToastKind("error"); setToast(String(error)); });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [instances, gameRunning, download.active]);
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
          setToastKind("error");
          setToast(next.message);
          setLogs(current => [...current, { id: `${Date.now()}-launch-error`, instanceId: next.instanceId || "launcher", instanceName: instances.find(item => item.id === next.instanceId)?.name || next.instanceId || "Launcher", stream: "launcher", level: "error" as const, message: next.message, timestamp: Date.now() }].slice(-600));
          window.setTimeout(() => setToast(""), 5000);
        }
        if (next.state === "running") {
          setGameRunning(true);
          if (settings.closeAfterLaunch) void invoke("exit_application");
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
  }, [settings.closeAfterLaunch, instances]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ContentInstallState>("content-install-state", (event) => {
      const task = event.payload;
      if (task.state !== "installing") return;
      const taskKind: DownloadTaskKind = task.category === "mods" ? "mod" : task.category === "resourcepacks" ? "resourcepack" : "shaderpack";
      setDownload({ active: true, progress: 1, state: "installing", message: task.message, instanceId: task.instanceId, taskName: task.title, taskVersion: task.version, taskKind });
    }).then(value => { unlisten = value; });
    return () => unlisten?.();
  }, []);
  useEffect(() => { localStorage.setItem("bloom-completed-downloads", JSON.stringify(completedDownloads.slice(0, 5))); }, [completedDownloads]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (settings.debugLogging) localStorage.setItem("bloom-live-logs", JSON.stringify(logs.slice(-600)));
      else localStorage.removeItem("bloom-live-logs");
    }, settings.ultraPerformance ? 1500 : 700);
    return () => window.clearTimeout(timer);
  }, [logs, settings.debugLogging, settings.ultraPerformance]);
  useEffect(() => {
    if (!settings.analytics) return;
    const counts = JSON.parse(localStorage.getItem("bloom-local-usage") || "{}") as Record<string, number>;
    counts[page] = (counts[page] || 0) + 1;
    localStorage.setItem("bloom-local-usage", JSON.stringify(counts));
  }, [page, settings.analytics]);
  useEffect(() => {
    if (!settings.crashReports) return;
    const capture = (message: string) => {
      const reports = JSON.parse(localStorage.getItem("bloom-local-crashes") || "[]") as Array<{ message: string; timestamp: number }>;
      localStorage.setItem("bloom-local-crashes", JSON.stringify([{ message, timestamp: Date.now() }, ...reports].slice(0, 20)));
      setLogs(current => [...current, { id: `${Date.now()}-client-crash`, instanceId: "bloom-client", instanceName: "Bloom Client", stream: "client", level: "error" as const, message, timestamp: Date.now() }].slice(-600));
    };
    const onError = (event: ErrorEvent) => capture(event.error?.stack || event.message);
    const onRejection = (event: PromiseRejectionEvent) => capture(String(event.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, [settings.crashReports]);
  useEffect(() => {
    let unlisten: undefined | (() => void);
    let flushTimer: number | undefined;
    const queue: LogEntry[] = [];
    const flush = () => {
      flushTimer = undefined;
      if (!queue.length) return;
      const batch = queue.splice(0);
      setLogs(current => [...current, ...batch].slice(-600));
    };
    void listen<{ instanceId: string; stream: string; line: string }>("minecraft-log-line", event => {
      const line = event.payload.line;
      const level: LogEntry["level"] = event.payload.stream === "stderr" || /\b(error|exception|fatal|crash)\b/i.test(line) ? "error" : /\b(warn|warning)\b/i.test(line) ? "warn" : "info";
      queue.push({ id: `${Date.now()}-${Math.random()}`, instanceId: event.payload.instanceId, instanceName: instances.find(item => item.id === event.payload.instanceId)?.name || event.payload.instanceId, stream: event.payload.stream, level, message: line, timestamp: Date.now() });
      if (queue.length >= 40) flush();
      else if (flushTimer === undefined) flushTimer = window.setTimeout(flush, settings.ultraPerformance ? 450 : 120);
    }).then(value => { unlisten = value; });
    return () => { unlisten?.(); if (flushTimer !== undefined) window.clearTimeout(flushTimer); };
  }, [instances, settings.ultraPerformance]);
  useEffect(() => {
    if ((download.state !== "running" && download.state !== "complete") || !download.instanceId) return;
    const completionKey = `${download.state}:${download.instanceId}`;
    if (lastCompletedTask.current === completionKey) return;
    const instance = instances.find(item => item.id === download.instanceId);
    if (!instance) return;
    lastCompletedTask.current = completionKey;
    const completedItem: CompletedDownload = download.taskKind && download.taskKind !== "game"
      ? { id: `${instance.id}-${Date.now()}`, name: download.taskName || "Content", version: download.taskVersion || (download.taskKind === "mod" ? "Fabric" : download.taskKind === "resourcepack" ? "Resource pack" : "Shader"), targetName: instance.name, kind: download.taskKind, completedAt: Date.now() }
      : { id: `${instance.id}-${Date.now()}`, name: instance.name, version: instance.version, loader: instance.loader, kind: "game", completedAt: Date.now() };
    setCompletedDownloads(current => [completedItem, ...current.filter(item => item.name !== completedItem.name || item.targetName !== completedItem.targetName)].slice(0, 5));
  }, [download.state, download.instanceId, download.taskKind, download.taskName, download.taskVersion, instances]);
  useEffect(() => {
    if (!download.active) {
      if (download.state === "idle") setRingProgress(0);
      return;
    }
    // Native install phases can legitimately report a lower percentage when
    // moving into a new phase. Mirror that real value instead of retaining a
    // stale high-water mark from the previous phase or task.
    setRingProgress(Math.max(0, Math.min(100, download.progress)));
  }, [download.active, download.progress, download.state]);
  useEffect(() => {
    if ((download.state !== "running" && download.state !== "complete") || ringProgress < 99) return;
    const timer = window.setTimeout(() => setDownload(current => ({ ...current, active: false })), 3000);
    return () => window.clearTimeout(timer);
  }, [download.state, ringProgress]);
  useEffect(() => {
    if (!download.active) return;
    const poll = window.setInterval(() => {
      void invoke<DownloadViewState>("get_minecraft_launch_status").then((status) => {
        if (status.state === "installing" || status.state === "launching") setDownload(current => ({ ...status, active: true, taskName: current.instanceId === status.instanceId ? current.taskName : undefined, taskVersion: current.instanceId === status.instanceId ? current.taskVersion : undefined, taskKind: current.instanceId === status.instanceId ? current.taskKind : undefined }));
      }).catch(() => {});
    }, settings.ultraPerformance ? 1200 : 600);
    return () => window.clearInterval(poll);
  }, [download.active, settings.ultraPerformance]);
  const launch = async (instance: InstanceDraft) => {
    if (download.active || gameRunning) {
      setToastKind("notification");
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
    setLogs(current => [...current, { id: `${Date.now()}-launch`, instanceId: instance.id, instanceName: instance.name, stream: "launcher", level: "info" as const, message: `Starting ${instance.name} (${instance.version} • ${instance.loader})`, timestamp: Date.now() }].slice(-600));
    try {
      await invoke("launch_minecraft", { instanceId: instance.id, launchMethod: settings.launchMethod, downloadWorkers: settings.downloadWorkers, debugLogging: settings.debugLogging });
    } catch (error) {
      const message = String(error);
      setToastKind("error");
      if (message.includes("Sign in with Microsoft") || message.toLowerCase().includes("needs to reconnect")) {
        setSignInOpen(true);
        setToast("Your saved profile needs a quick Microsoft reconnect before launching.");
      } else setToast(message);
      setLogs(current => [...current, { id: `${Date.now()}-invoke-error`, instanceId: instance.id, instanceName: instance.name, stream: "launcher", level: "error" as const, message, timestamp: Date.now() }].slice(-600));
      setDownload({ active: false, progress: 0, state: "idle", message: "" });
      window.setTimeout(() => setToast(""), 5000);
    }
  };
  const openInstancePage = (instance: InstanceDraft) => {
    setSelectedInstanceId(instance.id);
    setInstanceDestination("view");
    setPage("instance");
  };
  const handleInstanceClick = (event: MouseEvent<HTMLElement>, instance: InstanceDraft) => {
    if (!settings.doubleClickToPlay) { openInstancePage(instance); return; }
    if (event.detail !== 1) return;
    const previous = instanceOpenTimers.current.get(instance.id);
    if (previous !== undefined) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      instanceOpenTimers.current.delete(instance.id);
      openInstancePage(instance);
    }, 240);
    instanceOpenTimers.current.set(instance.id, timer);
  };
  const handleInstanceDoubleClick = (event: MouseEvent<HTMLElement>, instance: InstanceDraft) => {
    if (!settings.doubleClickToPlay) return;
    event.preventDefault();
    const timer = instanceOpenTimers.current.get(instance.id);
    if (timer !== undefined) window.clearTimeout(timer);
    instanceOpenTimers.current.delete(instance.id);
    void launch(instance);
  };
  const installContent = async (instance: InstanceDraft, item: CatalogItem, category: Exclude<InstanceTab, "settings">) => {
    if (gameRunning) throw new Error("Close Minecraft before installing new instance content.");
    const taskKind: DownloadTaskKind = category === "mods" ? "mod" : category === "resourcepacks" ? "resourcepack" : "shaderpack";
    if (!download.active) setDownload({ active: true, progress: 1, state: "installing", message: `Queueing ${item.title}`, instanceId: instance.id, taskName: item.title, taskVersion: item.versionNumber, taskKind });
    try {
      await invoke("install_modrinth_content", { instanceId: instance.id, projectId: item.projectId, category, title: item.title, version: item.versionNumber });
    } catch (error) {
      setToastKind("error");
      setToast(String(error));
      if (!download.active) setDownload({ active: false, progress: 0, state: "idle", message: "" });
      window.setTimeout(() => setToast(""), 5000);
      throw error;
    }
  };
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") setWindowMenuOpen(null);
    if (
      event.key === "F12" ||
      (event.ctrlKey && event.shiftKey) ||
      (event.ctrlKey && event.key.toLowerCase() === "u")
    )
      event.preventDefault();
  };
  const selectedInstance = instances.find(instance => instance.id === selectedInstanceId);
  const mostRecentInstance = instances[0];
  const signOut = () => { void invoke<MinecraftProfile | null>("sign_out_minecraft").then((next) => { setProfile(next); return refreshAccounts(); }).catch(error => showToolMessage(String(error), "error")).finally(() => { setSignInOpen(false); setProfileMenuOpen(false); setPendingAccountId(null); }); };
  const switchAccount = async (account: MinecraftProfile) => {
    if (switchingAccount) return;
    setSwitchingAccount(true);
    try {
      const next = await invoke<MinecraftProfile>("switch_minecraft_account", { accountId: account.id });
      setProfile(next); setPendingAccountId(null); setProfileMenuOpen(false);
      await refreshAccounts();
      showToolMessage(`Switched to ${next.name}.`);
    } catch (error) { showToolMessage(String(error), "error"); }
    finally { setSwitchingAccount(false); }
  };
  const openSettings = (target = "General") => { setSettingsTarget(target); setSettingsNavigationKey(value => value + 1); setPage("settings"); };
  const showToolMessage = (message: string, kind: "notification" | "error" = "notification") => {
    setToastKind(kind);
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
    } catch (error) { showToolMessage(String(error), "error"); }
  };
  const showJavaStatus = async () => {
    try {
      const installations = await invoke<JavaInstallation[]>("detect_java_installations");
      const usable = installations.filter(java => java.usable);
      showToolMessage(usable.length ? `${usable.length} usable Java runtime${usable.length === 1 ? "" : "s"} detected. Automatic selection is ready.` : "No usable Java runtime was detected. Open Settings to review Java setup.");
    } catch (error) { showToolMessage(String(error), "error"); }
  };
  const repairInstallation = async () => {
    if (!mostRecentInstance) return showToolMessage("Create an instance before repairing Minecraft files.");
    if (download.active || gameRunning) return showToolMessage("Another download or game launch is already active.");
    setDownload({ active: true, progress: 1, state: "installing", message: "Verifying Minecraft files", instanceId: mostRecentInstance.id, taskKind: "game" });
    setPage("downloads");
    try { await invoke("repair_minecraft_installation", { instanceId: mostRecentInstance.id }); }
    catch (error) { setDownload({ active: false, progress: 0, state: "idle", message: "" }); showToolMessage(String(error), "error"); }
  };
  const customBackgroundActive = settings.customBackground && Boolean(customBackgroundImage);
  const customSurfaceDarkness = Math.max(55, Math.min(92, settings.sidebarOpacity));
  const customElementDarkness = Math.max(35, Math.min(98, settings.elementOpacity));
  const customBackgroundStyle = {
    "--custom-background-image": customBackgroundImage ? `url(${customBackgroundImage})` : "none",
    "--custom-background-opacity": String(Math.max(0, Math.min(100, settings.backgroundOpacity)) / 100),
    "--custom-surface-opacity": `${customSurfaceDarkness}%`,
    "--custom-control-opacity": `${customElementDarkness}%`,
  } as CSSProperties;
  return (
    <div
      className="app-shell"
      style={customBackgroundStyle}
      data-custom-background={customBackgroundActive ? "on" : "off"}
      data-blurred-sidebars={customBackgroundActive ? "on" : "off"}
      data-blurred-buttons={customBackgroundActive ? "on" : "off"}
      onContextMenu={handleContextMenu}
      onClick={() => { setContextMenu(null); setProfileMenuOpen(false); setSignInOpen(false); setWindowMenuOpen(null); }}
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
        <div className="window-menu" onClick={event => event.stopPropagation()}>
          {(["file", "edit", "view", "help"] as WindowMenuName[]).map(menu => (
            <div className="window-menu-group" key={menu}>
              <button
                className="window-menu-trigger"
                aria-expanded={windowMenuOpen === menu}
                aria-haspopup="menu"
                onClick={() => setWindowMenuOpen(current => current === menu ? null : menu)}
              >
                {menu[0].toUpperCase() + menu.slice(1)}
              </button>
              {windowMenuOpen === menu && <div ref={windowMenuRef} className="window-menu-dropdown" role="menu">
                {menu === "file" && <>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); setPage("new-instance"); }}>New instance</button>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); setPage("instances"); }}>Instances</button>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); setPage("downloads"); }}>Downloads</button>
                </>}
                {menu === "edit" && <>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); openSettings(); }}>Client settings</button>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); openSettings("My Profile"); }}>Profile &amp; accounts</button>
                </>}
                {menu === "view" && <>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); setPage("home"); }}>Home</button>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); setPage("locker"); }}>Locker</button>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); setPage("autotune"); }}>AutoTune</button>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); setPage("logs"); }}>Logs</button>
                </>}
                {menu === "help" && <>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); void checkForUpdates(true); }}>Check for updates</button>
                  <button style={{ opacity: 0 }} role="menuitem" onClick={() => { setWindowMenuOpen(null); void showJavaStatus(); }}>Check Java</button>
                </>}
              </div>}
            </div>
          ))}
        </div>
        <div className="window-controls">
          <button className="window-control window-minimize" onClick={() => void getCurrentWindow().minimize()} aria-label="Minimize Bloom Client"><WindowMinimizeIcon /></button>
          <button className="window-control window-expand" onClick={() => void getCurrentWindow().toggleMaximize()} aria-label="Maximize or restore Bloom Client"><WindowExpandIcon /></button>
          <button className="window-control window-close" onClick={() => void invoke("exit_application")} aria-label="Close Bloom Client"><WindowCloseIcon /></button>
        </div>
      </div>
      <aside className="sidebar">
        <nav>
          {nav.map(([Icon, label], index) => (
            <button
              className={
                (page === "home" && index === 0) ||
                (page === "instances" && label === "Instances") ||
                (page === "autotune" && label === "AutoTune") ||
                (page === "settings" && label === "Settings") ||
                (page === "locker" && label === "Locker")
                  ? "active"
                  : ""
              }
              key={label}
              onClick={() =>
                label === "Locker" ? setPage("locker") : label === "Settings" ? openSettings() : label === "Instances" ? setPage("instances") : label === "AutoTune" ? setPage("autotune") : setPage("home")
              }
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-rule" />
        <div className="instance-section-heading">
          <button className="instance-section-add" onClick={() => setPage("new-instance")} aria-label="Create a new instance" title="Create a new instance">
            <span aria-hidden="true"><Plus size={17} strokeWidth={2.5} /></span>
          </button>
          <p className="section-label">INSTANCES</p>
        </div>
        <div className="instance-list">
          {instances.length ? (
            instances.slice(0, 3).map((instance) => (
              <div
                className={`sidebar-instance ${page === "instance" && selectedInstanceId === instance.id ? "active" : ""}`}
                key={instance.id}
              >
                <button className="sidebar-instance-open" onClick={(event) => handleInstanceClick(event, instance)} onDoubleClick={(event) => handleInstanceDoubleClick(event, instance)} aria-label={`Open ${instance.name}`}>
                  <span className="sidebar-instance-media" aria-hidden="true">{instance.icon ? <img className="sidebar-instance-icon" src={instance.icon} alt="" /> : <span className="sidebar-instance-fallback">?</span>}</span>
                  <span className="sidebar-instance-copy"><b>{instance.name}</b><small>{instance.version}</small></span>
                </button>
                <button className="sidebar-instance-play" aria-label={`Play ${instance.name}`} title={`Play ${instance.name}`} disabled={download.active || gameRunning} onClick={() => void launch(instance)}>
                  <span aria-hidden="true"><Play size={26} strokeWidth={2.4} fill="currentColor" /></span>
                </button>
              </div>
            ))
          ) : (
            <button className="sidebar-empty-instance" onClick={() => setPage("new-instance")}>
              <span className="sidebar-empty-instance-mark" aria-hidden="true"><Plus size={21} strokeWidth={2.5} /></span>
              <b>Create instance</b>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="sidebar-spacer" />
        <button className={`sidebar-link downloads-link ${page === "downloads" ? "active" : ""} ${download.active ? "has-progress" : ""}`} onClick={() => setPage("downloads")}>
          <Download size={17} />
          Downloads {download.active && (() => {
            const complete = (download.state === "running" || download.state === "complete") && ringProgress >= 99;
            return <span className={`download-ring ${complete ? "complete" : ""}`} aria-label={complete ? "Download complete" : `${Math.round(ringProgress)} percent downloaded`}>{complete ? <Check size={14} strokeWidth={3} /> : <b>{Math.max(1, Math.min(99, Math.round(ringProgress)))}</b>}</span>;
          })()}
        </button>
        <button className={`sidebar-link ${page === "logs" ? "active" : ""}`} onClick={() => setPage("logs")}>
          <TerminalSquare size={17} />
          Logs
        </button>
        <div className="profile">
          {profile ? (
            <>
              <div className={`signed-in ${profileMenuOpen ? "menu-open" : ""}`}>
                <button className="profile-trigger" onClick={(event) => { event.stopPropagation(); setProfileMenuOpen(value => !value); }} aria-expanded={profileMenuOpen} aria-haspopup="menu">
                  <div className="avatar">{profileIcon ? <img src={profileIcon} alt="" /> : profile.name.slice(0, 1).toUpperCase()}</div>
                  <div className="signed-in-name"><b>{profile.name}</b></div>
                  <ChevronDown className={profileMenuOpen ? "rotated" : ""} size={16} aria-hidden="true" />
                </button>
                {availableUpdate && <button className="sidebar-update-button" onClick={() => void installUpdate()} aria-label={`Update to Bloom Client ${availableUpdate.version}`} title={`Update available: ${availableUpdate.version}`}>
                  <Download size={16} />
                  <i />
                </button>}
              </div>
              <div className={`profile-popover ${profileMenuOpen ? "open" : ""}`} role="menu" aria-label="Account menu" aria-hidden={!profileMenuOpen} onClick={event => event.stopPropagation()}>
                <div className="profile-popover-actions">
                  <button role="menuitem" tabIndex={profileMenuOpen ? 0 : -1} onClick={() => { setProfileMenuOpen(false); openSettings("My Profile"); }}>
                    <span><UserRound size={17} /></span>
                    <div><b>Profile & accounts</b></div>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                  <button role="menuitem" tabIndex={profileMenuOpen ? 0 : -1} onClick={() => { setProfileMenuOpen(false); openSettings(); }}>
                    <span><SettingsIcon size={17} /></span>
                    <div><b>Client settings</b></div>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="profile-popover-rule" />
                <button className="profile-logout" role="menuitem" tabIndex={profileMenuOpen ? 0 : -1} onClick={signOut}>
                  <span><LogOut size={17} /></span>
                  <div><b>Log out</b></div>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`signed-in signed-out ${signInOpen ? "menu-open" : ""}`}>
                <button className="profile-trigger signin-button" onClick={(event) => { event.stopPropagation(); setSignInOpen(value => !value); }} aria-expanded={signInOpen} aria-haspopup="menu">
                  <span className="microsoft-mark" aria-hidden="true"><img src={new URL("microsoft-logo.svg", document.baseURI).href} alt="" /></span>
                  <div className="signed-in-name"><b>Sign In</b></div>
                  <ChevronDown className={signInOpen ? "rotated" : ""} size={16} aria-hidden="true" />
                </button>
              </div>
              <SignInPanel
                open={signInOpen}
                onSignedIn={(nextProfile) => {
                  setProfile(nextProfile);
                  setSignInOpen(false);
                  void refreshAccounts();
                }}
              />
            </>
          )}
        </div>
      </aside>
      <main className="content">
        {page === "instance" && selectedInstance ? (
          <InstancePage key={`${selectedInstance.id}:${instanceDestination}`} instance={selectedInstance} busy={download.active || gameRunning} initialTab={instanceDestination === "settings" ? "settings" : "mods"} initialCatalog={instanceDestination === "add-mods"} onPlay={() => void launch(selectedInstance)} onInstallContent={(item, category) => installContent(selectedInstance, item, category)} onChanged={(changed) => setInstances(current => current.map(instance => instance.id === changed.id ? changed : instance))} />
        ) : page === "logs" ? (
          <LogsPage entries={logs} running={gameRunning || download.state === "launching"} onClear={() => setLogs([])} />
        ) : page === "autotune" ? (
          <AutoTuneFlow />
        ) : page === "instances" ? (
          <InstancesPage instances={instances} busy={download.active || gameRunning} doubleClickToPlay={settings.doubleClickToPlay} onCreate={() => setPage("new-instance")} onPlay={(instance) => void launch(instance)} onOpen={(instance, destination) => { setSelectedInstanceId(instance.id); setInstanceDestination(destination); setPage("instance"); }} onDelete={async (instance) => { try { await invoke("delete_instance", { instanceId: instance.id }); setInstances(current => current.filter(item => item.id !== instance.id)); if (selectedInstanceId === instance.id) setSelectedInstanceId(null); if (spotlightInstanceId === instance.id) { setSpotlightInstanceId(null); localStorage.removeItem("bloom-spotlight-instance"); } setToastKind("notification"); setToast(`${instance.name} and all of its files were deleted.`); window.setTimeout(() => setToast(""), 3500); } catch (error) { setToastKind("error"); setToast(String(error)); window.setTimeout(() => setToast(""), 5000); throw error; } }} />
        ) : page === "downloads" ? (
          <DownloadsPage download={download} instances={instances} completed={completedDownloads} onClear={() => setCompletedDownloads([])} onCancel={() => void invoke("cancel_minecraft_launch")} />
        ) : page === "locker" ? (
          <Locker profile={profile} motion={settings.animations && !settings.ultraPerformance} onNotify={(message, kind) => showToolMessage(message, kind === "error" ? "error" : "notification")} />
        ) : page === "settings" ? (
          <SettingsPage settings={settings} setSettings={setSettings} onSignOut={signOut} profile={profile} profileIcon={profileIcon} onProfileIconChange={setProfileIcon} backgroundImage={customBackgroundImage} onBackgroundImageChange={setCustomBackgroundImage} initialTab={settingsTarget} navigationKey={settingsNavigationKey} currentVersion={currentVersion} availableVersion={availableUpdate?.version || null} updateChecking={updateChecking} onCheckUpdates={() => void checkForUpdates(true)} onOpenUpdate={() => void installUpdate()} accounts={accounts} switchingAccount={switchingAccount} onSwitchAccount={switchAccount} onAccountAdded={(next) => { setProfile(next); void refreshAccounts(); }} />
        ) : page === "new-instance" ? (
          <NewInstancePage
            defaults={settings}
            onCancel={() => setPage("home")}
            onCreated={(destination) => {
              void invoke<InstanceDraft[]>("list_instances").then(setInstances);
              setPage(destination);
            }}
          />
        ) : settings.homeLayout === "Spotlight" ? (
          <SpotlightHome
            instances={instances}
            selectedId={spotlightInstanceId}
            busy={download.active || gameRunning}
            onSelect={setSpotlightInstanceId}
            onPlay={(instance) => void launch(instance)}
            onCreate={() => setPage("new-instance")}
          />
        ) : (
          <>
            <section className="hero">
              <div>
                <h1>
                  Welcome back, <span>{profile?.name || "User"}</span>
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
                  { Icon: FolderOpen, title: "Open Game Folder", desc: "Browse shared Minecraft files", color: "gold", action: () => void invoke("open_game_folder").catch(error => showToolMessage(String(error), "error")) },
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
                      <div className="instance-card" key={instance.id} onClick={(event) => handleInstanceClick(event, instance)} onDoubleClick={(event) => handleInstanceDoubleClick(event, instance)}>
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
              {settings.recommendations && <section className="whats-new">
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
              </section>}
            </div>
          </>
        )}
      </main>
      {settings.recommendations && <aside className="ad-rail">
        <div className="ad-rail-heading">Sponsored</div>
        {[1, 2, 3, 4].map((ad) => (
          <div className="ad-placeholder" key={ad}>
            <span>Ads</span>
          </div>
        ))}
      </aside>}
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
      {(availableUpdate || mockUpdateActive) && <section
        ref={updateSurfaceRef}
        className={`update-surface ${updatePanelOpen ? "expanded" : "compact"} ${updatePhase}`}
        role={updatePanelOpen ? "dialog" : "status"}
        aria-modal={updatePanelOpen ? "true" : undefined}
        aria-labelledby="update-title"
      >
        <div className="update-bottom-bar">
          <span className="update-bar-mark"><Download size={20} strokeWidth={2.4} /></span>
          <b id="update-title">Bloom Client {displayedUpdateVersion} is ready</b>
          <button onClick={() => void installUpdate()} disabled={updatePhase !== "ready"}>Update now</button>
        </div>
        {updatePanelOpen && <div className="update-fullscreen-copy">
          <span className="update-fullscreen-mark">{updatePhase === "error" ? <TriangleAlert size={31} /> : <Download size={31} strokeWidth={2.4} />}</span>
          <h2>{updatePhase === "error" ? "Update stopped" : updatePhase === "installing" ? "Installing Bloom" : "Updating Bloom"}</h2>
          <p>{updatePhase === "error" ? updateError : updatePhase === "installing" ? "The launcher will restart when it’s ready." : `Downloading version ${displayedUpdateVersion}`}</p>
          {updatePhase !== "error" && <div className="update-fullscreen-progress" aria-label={updatePhase === "installing" ? "Installing update" : `${Math.round(updateProgress)} percent downloaded`}>
            <i style={{ width: `${updatePhase === "installing" ? 100 : updateProgress}%` }} />
            <span>{updatePhase === "installing" ? "Installing" : `${Math.round(updateProgress)}%`}</span>
          </div>}
          {updatePhase === "error" && <div className="update-fullscreen-actions"><button onClick={closeUpdateError}>Close</button><button onClick={() => void installUpdate()}><RotateCw size={16} />Try again</button></div>}
        </div>}
      </section>}
      {toast && <div className={`launch-toast ${toastKind}`} role={toastKind === "error" ? "alert" : "status"} aria-live={toastKind === "error" ? "assertive" : "polite"}><span>{toast}</span></div>}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
