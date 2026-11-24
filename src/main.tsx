import { captureAppearance } from "./services/appearance-presets";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { ShortcutContext, binding, shortcuts, chord, recording, shortcutMatches, type Bindings } from "./services/shortcuts";
import { fitFloatingMenu, type FloatingMenuPosition } from "./services/menu-position";
import "./components/winter-launch-scene.css";
import { HomeStories } from "./components/HomeStories";
import { CatalogArtwork, CatalogFeedRow } from "./components/CatalogFeedRow";
import { useContentDownloads, contentPending, contentKind, type ContentDownload } from "./services/use-content-downloads";
import { DownloadHistory } from "./components/DownloadHistory";
import "./services/desktop-interactions";
import { useToggleFeedback } from "./services/toggle-feedback";
import { userError } from "./services/user-error";
import { AppearancePresets } from "./components/AppearancePresets";
import { ContentTransferContext, useContentTransfer, useContentTransferController } from "./components/ContentTransfer";
import { DesktopTitleBar, type DesktopMenu } from "./components/DesktopTitleBar";
import { InstanceFolders } from "./components/InstanceFolders";
import { Server } from "lucide-react";
import { PortalPage } from "./components/PortalPage";
import type { PortalEntry, PortalLibrary, PortalTarget } from "./services/portal";

import { CrashDetails, crashSummary } from "./components/CrashDetails";
import { destinations as alulaDestinations, type Context as AlulaContext } from "./services/ask-delight";
import { AskDelight } from "./components/AskDelight";
import { CustomImageSidebar, DownloadQueueSidebar, FriendsSidebar, SidebarImageSettings, useLauncherImage } from "./components/WorkspaceSidebar";
import { version as bundledVersion } from "../package.json";
import { QuickSwitcher, type SwitchTarget } from "./components/QuickSwitcher";
import { FilterMenu, FilterReset, FilterSection } from "./components/FilterMenu";
import { ContentToolbar } from "./components/ContentToolbar";
import { setScreenshotActivity, startScreenshotWarming } from "./services/screenshots";
import { CustomAccentPicker } from "./components/CustomAccentPicker";
import { accentPresets, normalizeAccent, type AccentPreferences } from "./services/accent-preferences";
import { AccountSkinPortrait } from "./components/SkinThumbnail";
import { SettingsRow } from "./components/SettingsRow";
import { InfoTip } from "./components/InfoTip";
import { UndoLogoutButton } from "./components/UndoLogoutButton";
import { FabricLoaderSetting } from "./components/FabricLoaderSetting";
import { CatalogFilterControls } from "./components/CatalogFilterControls";
import { defaultCatalogFilters, catalogFiltersChanged, catalogInstallRestriction, type CatalogFilters } from "./services/catalog-filters";
import { ScreenshotShelf } from "./components/ScreenshotShelf";
import {
  Fragment,
  useEffect,
  useMemo,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "./services/invoke";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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
  Clipboard,
  Keyboard,
  Cpu,
  Cuboid,
  Copy,
  Database,
  Shirt,
  Download,
  ExternalLink,
  Info,
  CircleHelp,
  House,
  FileDown,
  FolderPlus,
  Layers3,
  Globe,
  FolderInput,
  ImagePlus,
  MoreHorizontal,
  Monitor,
  MemoryStick,
  MessageCircle,
  PackageOpen,
  Orbit,
  Palette,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Rocket,
  RotateCw,
  Search,
  Share2,
  Settings as SettingsIcon,
  Shield,
  SlidersHorizontal,
  TerminalSquare,
  Timer,
  TriangleAlert,
  Trash2,
  UserRound,
  WandSparkles,
  BotMessageSquare,
  Wrench,
  LockKeyhole,
  ArrowLeft as X,
  X as CloseIcon,
} from "lucide-react";
import "./styles.css";
import "./components/toggle-feedback.css";
import "./components/instance-controls.css";
import { InstanceName } from "./components/InstanceName";
import { FloatingInstancePlayer } from "./components/FloatingInstancePlayer";
import "./themes/light.css";
import "./components/dropdowns.css";
import "./components/interface-details.css";
import { FolderOpen, ListOrdered, CircleAlert } from "lucide-react";
import "./components/sidebar-navigation.css";
import "./components/interface-depth.css";
import "./components/account-depth.css";
import "./components/ceramic-actions.css";
import { PixelPlayButton } from "./components/PixelPlayButton";
import { useLauncherActivity } from "./services/use-launcher-activity";
import { monitorBackend } from "./services/backend";
import { Locker, lockerSections, type LockerSection } from "./components/Locker";
import { UtilitiesPage } from "./components/UtilitiesPage";
import { SocialPage, type SocialDestination } from "./components/SocialPage";
import { ShareInstanceDialog } from "./components/ShareInstanceDialog";
import { ModDetailDrawer, type ModDrawerSelection, type ModProjectDetails } from "./components/ModDetailDrawer";
import { OnboardingFlow, OnboardingSplash } from "./components/OnboardingFlow";
import "./components/desktop-redesign.css";
import "./components/launcher-controls.css";
import "./components/instance-creation.css";
import "./components/desktop-surfaces.css";
import "./components/utility-workspace.css";
import "./components/wallpaper.css";
import { backgroundDefaults, readBackground, type BackgroundSettings } from "./services/background-settings";

type Theme = "oled" | "light" | "system";

type HomeLayout = "Dashboard" | "Spotlight";
type AppPage = "alula" | "portal" | "screenshots" | "home" | "settings" | "utilities" | "social" | "new-instance" | "downloads" | "logs" | "instance" | "instances" | "locker";
const PROFILE_ICON_STORAGE_KEY = "bloom-profile-icon";
const RECENT_PLAY_STORAGE_KEY = "delight-recently-played-instances";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "bloom-sidebar-collapsed";
const ONBOARDING_COMPLETE_STORAGE_KEY = "bloom-onboarding-complete-v1";

function HangerIcon({ size = 17, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 6.5a2.5 2.5 0 1 1 4 2c-.9.7-1.5 1-1.5 2.5v1" />
    <path d="m12 12 8.5 5.7a1.25 1.25 0 0 1-.7 2.3H4.2a1.25 1.25 0 0 1-.7-2.3L12 12Z" />
  </svg>;
}

const sidebarChoices = ["Download Queue", "Custom Image", "Friends", "Hidden"] as const;
type SidebarChoice = (typeof sidebarChoices)[number];
const isSidebarChoice = (value: string): value is SidebarChoice => sidebarChoices.some(choice => choice === value);

const interfaceFonts = ["Segoe UI", "Arial", "Bahnschrift", "Calibri", "Consolas", "Georgia", "Tahoma", "Trebuchet MS", "Verdana"] as const;
const defaultColors = {
  oled: { Background: "#0b0b0b", Foreground: "#ffffff", Sidebar: "#151515", Panel: "#101010" },
  light: { Background: "#f6f6f6", Foreground: "#1b1b1b", Sidebar: "#e6e6e6", Panel: "#dadada" },
};
function paletteKey(mode: keyof typeof defaultColors, part: keyof typeof defaultColors.oled) {
  return `${mode}${part}` as const;
}
function validColor(value: string) { return /^#[0-9a-f]{6}$/i.test(value); }

export type SettingsState = AccentPreferences & {
  theme: Theme;
  oledBackground: string;
  oledForeground: string;
  lightBackground: string;
  lightForeground: string;
  interfaceFont: typeof interfaceFonts[number];
  interfaceSize: number;
  spacing: "comfortable" | "compact";
  oledSidebar: string;
  lightSidebar: string;
  oledPanel: string;
  lightPanel: string;
  dividerStrength: number;
  animations: boolean;
  buttonPressDuration: number;
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
  shortcuts: Bindings;
  backdrop: BackgroundSettings;
  redesignAppearanceV1?: boolean;
  rightSidebar: SidebarChoice;
  doubleClickToPlay: boolean;
  downloadWorkers: 1 | 3 | 5;
  recommendations: boolean;
  gameDirectory: string;
};
const defaults: SettingsState = {
  backdrop: backgroundDefaults,
  customAccent: false, lastCustomAccent: "",
  oledSidebar: "", lightSidebar: "", oledPanel: "", lightPanel: "", dividerStrength: 13,
  theme: "oled",
  oledBackground: "", oledForeground: "", lightBackground: "", lightForeground: "",
  interfaceFont: "Segoe UI",
  interfaceSize: 95,
  spacing: "compact",
  accent: "#87a9f3",
  animations: true,
  buttonPressDuration: 750,
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
  shortcuts: {},
  rightSidebar: "Hidden",
  doubleClickToPlay: false,
  downloadWorkers: 3,
  recommendations: true,
  gameDirectory: ".minecraft/instances/",
};
function resetLauncherAppearance(settings: SettingsState): SettingsState {
  return { ...settings, ...captureAppearance(defaults), animations: defaults.animations, buttonPressDuration: defaults.buttonPressDuration };
}
const spotlightDefaultMigrationKey = "bloom-home-layout-spotlight-v1";
const nav = [
  [House, "Home", "home"],
  [Layers3, "Instances", "instances"],
  [HangerIcon, "Locker", "locker"],
  [MessageCircle, "Social", "social"],
  [ImagePlus, "Screenshots", "screenshots"],
  [Wrench, "Utilities", "utilities"],
  [Orbit, "Portal", "portal"],
] as const;
function settingsLabel(label: string) {
  return label === "My Profile" ? "Accounts" : label === "Cache" ? "Storage" : label;
}
const settingTabs = [
  [SettingsIcon, "General"], [Palette, "Appearance"], [ImagePlus, "Background"], [Cuboid, "Minecraft"], [Download, "Downloads"],
  [Database, "Cache"], [UserRound, "My Profile"], [Keyboard, "Shortcuts"],
  [SlidersHorizontal, "Performance"], [Shirt, "Cosmetics"], [Rocket, "Launcher"],
  [Shield, "Privacy"], [RefreshCw, "Updates"], [TerminalSquare, "Advanced"],
] as const;

const settingsGroups = [
  { title: "Profile", sections: ["My Profile"] },
  { title: "Launcher", sections: ["General", "Appearance", "Background", "Shortcuts"] },
  { title: "Game", sections: ["Minecraft", "Launcher", "Performance", "Cosmetics"] },
  { title: "System", sections: ["Downloads", "Cache", "Privacy", "Updates", "Advanced"] },
] satisfies { title: string; sections: (typeof settingTabs[number][1])[] }[];

export function Toggle({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const feedbackRef = useToggleFeedback(value);
  return (
    <button
      ref={feedbackRef}
      type="button"
      className={"toggle " + (value ? "on" : "off")}
      onClick={() => onChange(!value)}
      aria-pressed={value}
      aria-label={label}
      disabled={disabled}
    >
      <span />
    </button>
  );
}
function FillCheckbox({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button className={`fill-checkbox ${value ? "checked" : ""}`} onClick={() => onChange(!value)} aria-pressed={value} aria-label={label}><span /></button>;
}
function PercentSlider({ value, onChange, label, min = 0, max = 100, step = 1, unit = "%", disabled = false }: { value: number; onChange: (value: number) => void; label: string; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean }) {
  const safeValue = Math.max(min, Math.min(max, value));
  const fill = max === min ? 100 : ((safeValue - min) / (max - min)) * 100;
  return <div className="setting-percent-slider" style={{ "--setting-range-fill": `${fill}%` } as CSSProperties}>
    <input type="range" min={min} max={max} step={step} disabled={disabled} value={safeValue} aria-label={label} aria-valuetext={`${safeValue}${unit}`} onChange={event => onChange(Number(event.target.value))} />
    <output>{safeValue}{unit}</output>
  </div>;
}

const closedDropdownStyle: CSSProperties = {
  opacity: 0,
  clipPath: "inset(0 0 100% 0)",
  transformOrigin: "top center",
};

function revealDropdown(menu: HTMLDivElement) {
  menu.style.clipPath = "none";
  menu.style.opacity = "1";
  menu.style.transform = "none";
  menu.querySelectorAll<HTMLElement>(":scope > button").forEach(button => { button.style.opacity = "1"; });
  if (document.documentElement.dataset.animations === "on" && document.documentElement.dataset.performance !== "ultra" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    waapi.animate(menu, { opacity: [0, 1], duration: 100, ease: "outQuad" });
  }
}

function useLauncherMenu(open: boolean, close: (value: boolean) => void, trigger: React.RefObject<HTMLButtonElement | null>,
  menu: React.RefObject<HTMLDivElement | null>, width: number, alignEnd = false, anchor?: { readonly current: HTMLElement | null }, contentKey?: unknown) {
  const [position, setPosition] = useState<FloatingMenuPosition>({ left: 0, top: 0, width, maxHeight: 380 });
  useLayoutEffect(() => {
    const panel = menu.current, button = trigger.current;
    if (!open || !panel || !button) return;
    const place = () => {
      const bounds = button.getBoundingClientRect();
      const wide = Math.max(bounds.width, width);
      const height = panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
      setPosition(fitFloatingMenu(anchor?.current?.getBoundingClientRect() || bounds, wide, height, alignEnd ? bounds.right - wide : bounds.left));
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(button); observer.observe(panel);
    const outside = (event: PointerEvent) => { if (!panel.contains(event.target as Node) && !button.contains(event.target as Node)) close(false); };
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(false); button.focus({ preventScroll: true }); return; }
      if (!panel.contains(event.target as Node) && event.target !== button) return;
      if (event.key === "Tab") { close(false); button.focus({ preventScroll: true }); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      if (event.target instanceof HTMLInputElement && !event.key.startsWith("Arrow")) return;
      const choices = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      if (!choices.length) return;
      event.preventDefault();
      const index = choices.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1
        : event.key === "ArrowDown" ? (index + 1) % choices.length : (Math.max(index, 0) + choices.length - 1) % choices.length;
      choices[next].focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keyboard);
      window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, width, alignEnd, anchor, contentKey, close, menu, trigger]);
  useLayoutEffect(() => { if (open && menu.current) revealDropdown(menu.current); }, [open, menu]);
  return position;
}

export function Select({
  value,
  options,
  onChange,
  variant = "default",
  disabledOptions = [],
  menuAnchorRef,
  disabled = false,
  ariaLabel,
  menuOwner,
  menuPortalRef,
  renderOption,

}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  variant?: "default" | "filter";
  disabledOptions?: string[];
  menuAnchorRef?: { readonly current: HTMLDivElement | null };
  disabled?: boolean;
  ariaLabel?: string;
  renderOption?: (option: string) => React.ReactNode;
  menuOwner?: string;
  menuPortalRef?: { readonly current: HTMLElement | null };
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const menuPosition = useLauncherMenu(open, setOpen, triggerRef, menuRef, variant === "filter" ? 150 : 116, true, menuAnchorRef, options.length);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return (
    <div className={`select-wrap ${variant === "filter" ? `filter-select ${value !== "All" ? "filtered" : ""}` : ""}`}>
      <button
        type="button"
        ref={triggerRef}
        className="select-trigger"
        onKeyDown={event => { if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); requestAnimationFrame(() => { const panel = menuRef.current; (panel?.querySelector<HTMLButtonElement>(".chosen:not(:disabled)") ?? panel?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus(); }); } }}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? menuId : undefined}
        data-menu-side={menuPosition.top < (triggerRef.current?.getBoundingClientRect().top ?? 0) ? "above" : "below"}
        aria-label={ariaLabel ?? (variant === "filter" ? `Filter instances: ${value}` : undefined)}
        title={variant === "filter" ? `Filter: ${value}` : undefined}
      >
        {variant === "filter" ? <SlidersHorizontal size={17} /> : <><span className="select-value">{renderOption ? renderOption(value) : value}</span><ChevronDown size={15} className={open ? "rotated" : ""} /></>}
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuId} role="dialog" aria-label={ariaLabel ?? `Choose an option, currently ${value}`} data-content-filter-owner={menuOwner} className="select-menu select-menu-portal" style={{ ...closedDropdownStyle, position: "fixed", top: menuPosition.top, left: menuPosition.left, right: "auto", width: menuPosition.width, maxHeight: menuPosition.maxHeight }}>
          {options.map((option) => (
            <button
        type="button"
              style={{ opacity: 0 }}
              className={option === value ? "chosen" : ""}
              key={option}
              disabled={disabled || disabledOptions.includes(option)}
              aria-pressed={option === value}
              onClick={() => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); onChange(option); }}
            ><span>{renderOption ? renderOption(option) : option}</span>{option === value && <Check size={17} aria-hidden="true" />}
            </button>
          ))}
        </div>, menuPortalRef?.current ?? triggerRef.current?.closest("dialog[open]") ?? document.body
      )}
    </div>
  );
}

// Keep the thumb and readout live while expensive changes wait for the end of the gesture.
function CommitSlider({ value, minimum, maximum, step, unit, label, disabled, onCommit, children }: {
  value: number; minimum: number; maximum: number; step: number; unit: string; label: string;
  disabled?: boolean; onCommit: (value: number) => void; children: (preview: number) => ReactNode;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const gesture = useRef<"pointer" | "keyboard" | null>(null);
  const size = draft ?? value;
  const commit = (next: number) => {
    gesture.current = null;
    setDraft(null);
    if (next !== value) onCommit(next);
  };
  const finish = (field: HTMLInputElement) => {
    if (gesture.current) commit(field.valueAsNumber);
  };
  return <div className="setting-commit-slider">
    <div className="size-track" style={{ "--size-fill": (size - minimum) / (maximum - minimum) * 100 + "%" } as CSSProperties}>
      <input type="range" min={minimum} max={maximum} step={step} value={size} disabled={disabled} aria-label={label} aria-valuetext={size + unit}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          gesture.current = "pointer";
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={event => finish(event.currentTarget)}
        onPointerCancel={() => { gesture.current = null; setDraft(null); }}
        onLostPointerCapture={event => finish(event.currentTarget)}
        onKeyDown={event => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) gesture.current = "keyboard";
        }}
        onKeyUp={event => { if (gesture.current === "keyboard") finish(event.currentTarget); }}
        onBlur={event => finish(event.currentTarget)}
        onChange={event => {
          if (gesture.current) setDraft(event.currentTarget.valueAsNumber);
          else commit(event.currentTarget.valueAsNumber);
        }} />
      <div aria-hidden="true"><span>{minimum}{unit}</span><span>{maximum}{unit}</span></div>
    </div>
    {children(size)}
  </div>;
}

function PaginationControls({ page, pages, onPage, busy = false }: {
  page: number; pages: number; onPage: (page: number) => void; busy?: boolean;
}) {
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  return <nav className="content-pagination page-navigation" aria-label="Pagination">
    <button disabled={busy || page === 1} aria-label="Previous page" onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
    {numbers.map((number, index) => <Fragment key={number}>
      {index > 0 && number - numbers[index - 1] > 1 && <span aria-hidden="true">…</span>}
      <button disabled={busy} aria-current={number === page ? "page" : undefined} aria-label={`Page ${number}`} onClick={() => onPage(number)}>{number}</button>
    </Fragment>)}
    <button disabled={busy || page === pages} aria-label="Next page" onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
  </nav>;
}

function SettingsHeading({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <header className="settings-section-heading" data-section-help={description}>
    <h2>{title}</h2>{children}<InfoTip label={title}>{description}</InfoTip>
  </header>;
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
          <button disabled={busy !== null} onClick={() => void remove(runtime.majorVersion)} aria-label={`Remove Delight-managed Java ${runtime.majorVersion}`}>
            <Trash2 size={13} />
          </button>
        </span>
      )) : <small>No runtimes installed</small>}
      {message && <small className="managed-java-error">{message}</small>}
    </div>
  );
}

type ClientCacheStatus = { directory: string; capacityBytes: number; usedBytes: number; itemCount: number };
const formatCacheUsage = (bytes: number) => bytes >= 10_737_418 ? `${(bytes / 1073741824).toFixed(2)} GB` : bytes >= 1_048_576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(0, bytes / 1024).toFixed(1)} KB`;

function ClientCacheControl({ active }: { active: boolean }) {
  const [status, setStatus] = useState<ClientCacheStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const revision = useRef(0);
  useEffect(() => {
    if (!active || busy) return;
    let current = true;
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      const stamp = revision.current;
      try {
        const next = await invoke<ClientCacheStatus>("get_client_cache_status");
        if (current && revision.current === stamp) setStatus(next);
      } catch (error) {
        if (current && revision.current === stamp) setMessage(String(error));
      } finally { reading = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => { current = false; window.clearInterval(timer); };
  }, [active, busy]);
  const run = async (operation: () => Promise<ClientCacheStatus | null>, success = "") => {
    if (busy) return;
    revision.current++;
    setBusy(true);
    setMessage("");
    try {
      const next = await operation();
      if (next) { setStatus(next); setMessage(success); }
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  const save = (directory: string, capacityBytes: number) => invoke<ClientCacheStatus>("save_client_cache_settings", { directory, capacityBytes });
  const capacity = status ? status.capacityBytes / 1073741824 : 2;
  const usedRatio = status ? Math.min(1, status.usedBytes / Math.max(1, status.capacityBytes)) : 0;
  return <div className="storage-settings">
    <div className="storage-overview">
      <span className="storage-label">Cache usage</span>
      <div className="storage-amount"><strong>{status ? formatCacheUsage(status.usedBytes) : "—"}</strong>
        {status && <span>of {capacity} GB</span>}</div>
      <div className="storage-meter" role="progressbar" aria-label="Client cache usage" aria-valuemin={0}
        aria-valuemax={status?.capacityBytes || 1} aria-valuenow={status?.usedBytes}><i style={{ width: usedRatio * 100 + "%" }} /></div>
      <small>{status ? `${status.itemCount.toLocaleString()} cached ${status.itemCount === 1 ? "item" : "items"}` : "Reading cache…"}</small>
    </div>
    <div className="settings-card">
      <SettingsRow title="Cache capacity" description="Maximum space Delight can use for cached files.">
        <CommitSlider label="Cache capacity" minimum={0.5} maximum={12} step={0.5} unit=" GB" disabled={!status || busy} value={capacity}
          onCommit={gb => { if (status) void run(() => save(status.directory, Math.round(gb * 1073741824))); }}>
          {gb => <output>{gb} GB</output>}
        </CommitSlider>
      </SettingsRow>
      <SettingsRow title="Cache folder" description={status ? "Cached files are stored in " + status.directory : "Reading the cache folder…"}>
        <button className="settings-action" disabled={!status || busy} onClick={() => void run(async () => {
          const folder = await invoke<string | null>("choose_client_cache_directory");
          return folder && status ? save(folder, status.capacityBytes) : null;
        })}><FolderOpen size={16} />Change folder</button>
      </SettingsRow>
      <SettingsRow title="Clear cache" description="Remove cached files. Delight will fetch them again as needed.">
        <button className="settings-action" disabled={!status?.usedBytes || busy} onClick={() => void run(async () => {
          const next = await invoke<ClientCacheStatus>("clear_client_cache");
          clearTransientClientCaches();
          return next;
        }, "Cache cleared.")}><Trash2 size={16} />Clear cache</button>
      </SettingsRow>
    </div>
    {message && <p className="settings-inline-status" role="status">{message}</p>}
  </div>;
}

// Temporary: Prism's recognized public client ID. Replace with Delight's approved ID via VITE_MICROSOFT_CLIENT_ID later.
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
    <SettingsRow title="Delight Cosmetics" description="Install and maintain Delight capes for supported Fabric 1.21.11 instances.">
      <Toggle value={preferences?.enabled ?? false} disabled={!preferences?.available || busy || !preferences} onChange={value => void setIntegration(value)} />
    </SettingsRow>
    <SettingsRow title="Nametag Badge" description={profile ? "Show the Delight wing beside your name while playing through Delight." : "Sign in to choose whether your Delight badge is visible."}>
      <Toggle value={accountState?.badgeVisible ?? false} disabled={!profile || !accountState || busy || !preferences?.enabled} onChange={value => void setBadge(value)} />
    </SettingsRow>
    {message && <div className="cosmetics-settings-message" role="status">{message}</div>}
  </div>;
}
type MinecraftAccountList = { activeId: string | null; accounts: MinecraftProfile[] };

function SignInPanel({
  open,
  onSignedIn,
  onSettings,
  variant = "drawer",
}: {
  open: boolean;
  onSignedIn: (profile: MinecraftProfile) => void;
  onSettings?: () => void;
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
  if (variant === "inline") return <section className="account-signin" role="group" aria-label="Microsoft sign-in">
    <b>Microsoft sign-in</b>
    <p role="status">{status}</p>
    {code && !hasError && <div className="account-device-actions"><code>{code}</code>
      <button className="settings-action" disabled={copied} onClick={copyCode}>{copied ? <Check size={15}/> : <Clipboard size={15}/>}{copied ? "Copied" : "Copy code"}</button>
      <button className="settings-action" disabled={!handoffReady} onClick={() => void openUrl(verificationUri)}><ExternalLink size={15}/>Open Microsoft sign-in</button>
    </div>}
    {hasError && <button className="settings-action" onClick={() => { setCode(""); setCopied(false); setHandoffReady(false); setStatus("Requesting a Microsoft sign-in code…"); void startMicrosoftLogin(); }}>Try again</button>}
  </section>;
  return (
    <div className={`profile-popover signin-drawer ${open ? "open" : ""}`} role="menu" aria-label="Microsoft sign-in" aria-hidden={!open} onClick={event => event.stopPropagation()}>
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
        {onSettings && <button role="menuitem" aria-label="Client settings" tabIndex={open ? 0 : -1} onClick={onSettings}>
          <span><SettingsIcon size={17} /></span><div><b>Client settings</b></div><ChevronRight size={16} aria-hidden="true" />
        </button>}
      </div>
    </div>
  );
}
function SettingsPage({
  resolvedTheme,
  settings,
  setSettings,
  onSignOut,
  profile,
  profileIcon,
  onProfileIconChange,
  sidebarImage,
  wallpaper,
  initialTab,
  query,
  onNavigate,
  addAccount,
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
  onRestartOnboarding,
}: {
  resolvedTheme: keyof typeof defaultColors;
  settings: SettingsState;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState>>;
  onSignOut: () => void;
  profile: MinecraftProfile | null;
  profileIcon: string | null;
  onProfileIconChange: (icon: string) => void;
  sidebarImage: ReturnType<typeof useLauncherImage>;
  wallpaper: ReturnType<typeof useLauncherImage>;
  initialTab?: string;
  query: string;
  onNavigate: (section: string) => void;
  addAccount: boolean;
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
  onRestartOnboarding: () => void;
}) {
  const update = <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K],
  ) => setSettings({ ...settings, [key]: value });
  const backdrop = settings.backdrop;
  const changeBackdrop = (patch: Partial<BackgroundSettings>) =>
    setSettings(current => ({ ...current, backdrop: { ...current.backdrop, ...patch } }));
  const saveWallpaper = async (file: File | null) => {
    if (await wallpaper.save(file)) changeBackdrop({ source: file ? "Image" : "Solid color" });
  };
  const canvasKey = paletteKey(resolvedTheme, "Background");
  const selectedAccent = settings.customAccent ? "Custom" : accentPresets.find(preset => preset.color === settings.accent)?.name ?? "Custom";
  const activeTab = initialTab || "Appearance";
  const [aboutMessage, setAboutMessage] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [releaseOptions, setReleaseOptions] = useState<string[]>([]);
  const [javaOptions, setJavaOptions] = useState<string[]>(["Automatic"]);
  const [addingAccount, setAddingAccount] = useState(false);
  const [pendingProfileAccountId, setPendingProfileAccountId] = useState<string | null>(null);
  const profileIconInput = useRef<HTMLInputElement>(null);
  const sections = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingRow = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const scroller = sections.current[activeTab]?.closest("main");
    if (scroller) scroller.scrollTop = 0;
    if (pendingRow.current) {
      const row = pendingRow.current;
      pendingRow.current = null;
      row.closest("details")?.setAttribute("open", "");
      row.scrollIntoView({ block: "nearest" });
      (row.querySelector<HTMLElement>("button:not(:disabled):not(.info-tip-trigger),input:not([hidden]):not(:disabled),select,textarea") ?? row.querySelector<HTMLElement>(".info-tip-trigger"))?.focus({ preventScroll: true });
    }
    setAddingAccount(activeTab === "My Profile" && addAccount);
    setPendingProfileAccountId(null);
  }, [navigationKey, activeTab, addAccount]);
  const searchResults = Object.entries(sections.current).flatMap(([label, node]) => {
    if (!query.trim() || !node) return [];
    const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());
    const results: { section: string; title: string; row: HTMLElement | null }[] = [];
    if (matches(label) || matches(settingsLabel(label)) || matches(node.querySelector<HTMLElement>(".settings-section-heading")?.dataset.sectionHelp ?? "")) results.push({ section: label, title: settingsLabel(label), row: null });
    for (const row of node.querySelectorAll<HTMLElement>("[data-setting-help]")) {
      const title = row.getAttribute("aria-label") ?? row.querySelector("b, label, h3")?.textContent;
      if (title && matches(title + " " + (row.dataset.settingHelp ?? ""))) results.push({ section: label, title, row });
    }
    return results;
  });
  useEffect(() => {
    void Promise.all([invoke<Release[]>("get_minecraft_releases"), invoke<JavaInstallation[]>("detect_java_installations")]).then(([releases, javas]) => {
      setReleaseOptions(releases.map(release => release.id));
      setJavaOptions(["Automatic", ...javas.filter(java => java.usable).map(java => `Java ${java.majorVersion} — ${java.path}`)]);
    }).catch(() => {});
  }, []);
  const section = (label: string) => ({
    hidden: Boolean(query.trim()) || label !== activeTab,
    "data-settings-section": label,
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
    reader.onerror = () => setProfileMessage("Delight could not read that profile picture.");
    reader.readAsDataURL(file);
  };
  return (
    <div className="settings-page">
      {query.trim() && <section className="settings-search-results" aria-label="Settings search results">
        <h2>Search results</h2>
        {searchResults.length ? searchResults.map(({ section, title, row }) => <button key={section + title} onClick={() => { pendingRow.current = row; onNavigate(section); }}>
          <span>{title}</span><small>{settingsLabel(section)}</small><ChevronRight size={16} />
        </button>) : <p>No settings match “{query.trim()}”.</p>}
      </section>}
      <div className="settings-layout">
        <div className="settings-content">
          <div className="settings-section" {...section("General")}>
            <SettingsHeading title="General" description="Choose how Delight opens and closes. Changes save automatically." />
            <div className="settings-card">
              <SettingsRow
                title="Startup Behavior"
                description="Choose what happens when Delight Client starts."
              >
                <Select
                  value={settings.startupBehavior}
                  options={["Open Home", "Open Settings", "Remember last page"]}
                  onChange={(v) => update("startupBehavior", v as SettingsState["startupBehavior"])}
                />
              </SettingsRow>
              <SettingsRow
                title="Minimize to System Tray"
                description="Close button will minimize Delight Client to your system tray."
              >
                <Toggle
                  value={settings.tray}
                  onChange={(v) => update("tray", v)}
                />
              </SettingsRow>
              <SettingsRow title="Right Sidebar" description="Choose what to show beside the main workspace.">
                <Select ariaLabel={`Right Sidebar: ${settings.rightSidebar}`} value={settings.rightSidebar} options={[...sidebarChoices]}
                  onChange={value => { if (isSidebarChoice(value)) update("rightSidebar", value); }} />
              </SettingsRow>
              {settings.rightSidebar === "Custom Image" && <SidebarImageSettings {...sidebarImage} />}
            </div>
          </div>
          <div className="settings-section" {...section("Appearance")}>
            <SettingsHeading title="Appearance" description="Personalize the look and feel of Delight.">
              <button onClick={() => setSettings(resetLauncherAppearance(settings))}>
                <RotateCw size={15} />Reset appearance
              </button>
            </SettingsHeading>
            <div className="settings-card appearance-options">
              <h3 className="appearance-group-heading">Visual style</h3>
              <SettingsRow title="Color mode" description="Choose how the launcher looks.">
                <div className="theme-choices" role="group" aria-label="Theme">
                  {(["system", "oled", "light"] as const).map(theme => <button key={theme} aria-pressed={theme === settings.theme} onClick={() => {
                    update("theme", theme);
                  }}>
                    <span className="theme-preview" data-preview={theme} aria-hidden="true"><i/><i/><i/><i/>{theme === settings.theme && <Check size={15}/>}</span>
                    {theme === "system" ? "System" : theme === "oled" ? "Dark" : "Light"}
                  </button>)}
                </div>
              </SettingsRow>
              <AppearancePresets positionMenu={fitFloatingMenu} revealMenu={revealDropdown} settings={settings} onApply={appearance => setSettings(current => ({ ...current, ...appearance }))} />
              <SettingsRow title="Accent" description="The highlight color for buttons, selections and active controls.">
                <div className="appearance-accent-controls">
                  <Select ariaLabel="Accent" value={selectedAccent} options={[...accentPresets.map(preset => preset.name), "Custom"]}
                    renderOption={name => {
                      const preset = accentPresets.find(item => item.name === name);
                      return <span className="accent-option">{preset && <i style={{ background: preset.color }} />}{name}</span>;
                    }}
                    onChange={name => {
                      const preset = accentPresets.find(item => item.name === name);
                      const accent = preset?.color ?? (settings.lastCustomAccent || settings.accent);
                      setSettings({ ...settings, accent, customAccent: !preset, lastCustomAccent: preset ? settings.lastCustomAccent : accent });
                    }} />
                  {settings.customAccent && <CustomAccentPicker label="Custom accent color" value={settings.accent}
                    onApply={accent => setSettings({ ...settings, accent, lastCustomAccent: accent })} />}
                </div>
              </SettingsRow>
              {(["Background", "Sidebar", "Panel", "Foreground"] as const).map(part => {
                const key = paletteKey(resolvedTheme, part);
                const name = part === "Foreground" ? "Text" : part === "Panel" ? "Context sidebar" : part === "Sidebar" ? "Icon rail" : part;
                const color = validColor(settings[key]) ? settings[key] : defaultColors[resolvedTheme][part];
                return <SettingsRow key={part} title={name} description={{ Background: "The workspace background in this color mode.", Sidebar: "The narrow icon rail and title bar.", Panel: "The wider navigation panel beside the icon rail.", Foreground: "The main text color in this mode." }[part]}>
                  <CustomAccentPicker label={name + " color"} value={color} onApply={value => update(key, value)} />
                </SettingsRow>;
              })}
              <SettingsRow title="Dividers" description="Adjust the visibility of lines between sections and rows.">
                <PercentSlider label="Divider strength" value={settings.dividerStrength} onChange={value => update("dividerStrength", value)} />
              </SettingsRow>
              <SettingsRow title="Font" description="Choose the typeface for launcher menus and controls.">
                <Select ariaLabel="Interface font" value={settings.interfaceFont} options={[...interfaceFonts]} onChange={font => update("interfaceFont", font as SettingsState["interfaceFont"])} />
              </SettingsRow>
              <h3 className="appearance-group-heading">Interface</h3>
              <SettingsRow title="Interface size" description="Adjust the size of text and controls.">
                <CommitSlider label="Interface size" minimum={90} maximum={125} step={5} unit="%" value={settings.interfaceSize} onCommit={size => update("interfaceSize", size)}>
                  {size => <Select value={size + "%"} ariaLabel="Interface size percentage"
                    options={[...new Set([90, defaults.interfaceSize, 100, 110, 125, settings.interfaceSize])].sort((a, b) => a - b).map(n => n + "%")}
                    onChange={next => update("interfaceSize", parseInt(next, 10))} />}
                </CommitSlider>
              </SettingsRow>
              <SettingsRow title="Spacing" description="Choose how much room the interface uses.">
                <div className="spacing-choices" role="group" aria-label="Spacing">{(["comfortable", "compact"] as const).map(value => <button key={value} aria-pressed={settings.spacing === value} onClick={() => update("spacing", value)}>{value === "compact" ? "Compact" : "Comfortable"}</button>)}</div>
              </SettingsRow>
              <SettingsRow title="Reduce motion" description="Use fewer animations throughout the launcher.">
                <Toggle label="Reduce motion" value={!settings.animations} onChange={value => update("animations", !value)} />
              </SettingsRow>
              <details className="appearance-extra"><summary>More appearance options<ChevronDown size={15} /></summary>
              <SettingsRow
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
              </SettingsRow>
              </details>
            </div>
          </div>
          <div className="settings-section" {...section("Background")}>
            <SettingsHeading title="Background" description="Choose a local wallpaper and adjust how much shows through the launcher." />
            <div className="settings-card appearance-options">
              <h3 className="appearance-group-heading">Workspace</h3>
              <SettingsRow title="Background source" description="Switch to a solid color or use a saved image. Switching to solid keeps your image for later.">
                <Select ariaLabel="Background source" value={backdrop.source} options={["Solid color", "Image"]} disabled={!!wallpaper.operation}
                  onChange={value => changeBackdrop({ source: value as BackgroundSettings["source"] })} />
              </SettingsRow>
              <SettingsRow title="Canvas color" description="The workspace color in this theme. It also tints the wallpaper.">
                <CustomAccentPicker label="Canvas color" value={settings[canvasKey] || defaultColors[resolvedTheme].Background} onApply={value => update(canvasKey, value)} />
              </SettingsRow>
              <SettingsRow title="Wallpaper" description="Choose a local PNG, JPEG, or WebP up to 32 MB. Delight saves a copy on this device.">
                <div className="wallpaper-file-actions">
                  <input ref={wallpaper.input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Wallpaper file"
                    onChange={event => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void saveWallpaper(file);
                    }} />
                  {wallpaper.source && <img src={wallpaper.source} alt="Current wallpaper" />}
                  <button className="settings-action" disabled={wallpaper.image === undefined || !!wallpaper.operation} onClick={wallpaper.choose}>
                    {wallpaper.operation === "saving" ? "Saving…" : wallpaper.image ? "Change image" : "Choose image"}
                  </button>
                  {wallpaper.image && <button className="settings-action" disabled={!!wallpaper.operation} onClick={() => void saveWallpaper(null)}>Remove</button>}
                </div>
              </SettingsRow>
              {wallpaper.error && <p role="alert">{wallpaper.error}</p>}
              {backdrop.source === "Image" && wallpaper.image && <>
                <SettingsRow title="Image fit" description="Fill crops the edges. Fit shows the entire image against the canvas color.">
                  <Select ariaLabel="Image fit" value={backdrop.fit} options={["Fill", "Fit"]} onChange={value => changeBackdrop({ fit: value as BackgroundSettings["fit"] })} />
                </SettingsRow>
                <SettingsRow title="Image opacity" description="Adjust how strongly the photograph shows through the canvas color.">
                  <PercentSlider label="Image opacity" value={backdrop.opacity} onChange={opacity => changeBackdrop({ opacity })} />
                </SettingsRow>
                <h3 className="appearance-group-heading">Surfaces</h3>
                <SettingsRow title="Sidebar opacity" description="Adjust the tint on the icon rail, title bar and navigation panels.">
                  <PercentSlider label="Sidebar opacity" value={backdrop.sidebar} onChange={sidebar => changeBackdrop({ sidebar })} />
                </SettingsRow>
                <SettingsRow title="Element opacity" description="Adjust the fill on fields, list rows and neutral controls.">
                  <PercentSlider label="Element opacity" value={backdrop.elements} onChange={elements => changeBackdrop({ elements })} />
                </SettingsRow>
                <SettingsRow title="Sidebar blur" description="Frost both navigation rails and the title bar. Set to zero for clear glass. Ultra Performance disables blur.">
                  <PercentSlider label="Sidebar blur" disabled={settings.ultraPerformance} max={40} unit=" px" value={backdrop.blur} onChange={blur => changeBackdrop({ blur })} />
                </SettingsRow>
                <SettingsRow title="Element blur" description="Frost fields and neutral controls independently of the sidebar. Ultra Performance disables blur.">
                  <PercentSlider label="Element blur" disabled={settings.ultraPerformance} max={40} unit=" px" value={backdrop.elementBlur} onChange={elementBlur => changeBackdrop({ elementBlur })} />
                </SettingsRow>
              </>}
            </div>
          </div>
          <div className="settings-section" data-ask-target="memory" {...section("Performance")}>
            <SettingsHeading title="Performance" description="Optimize performance and resource usage." />
            <div className="settings-card">
              <SettingsRow title="Ultra Performance Mode" description="Disable motion, glow, blur, and continuous visual rendering for lower-end computers.">
                <Toggle value={settings.ultraPerformance} onChange={(v) => setSettings({ ...settings, ultraPerformance: v, animations: v ? false : settings.animations })} />
              </SettingsRow>
              <SettingsRow
                title="Memory Allocation"
                description="Set how much RAM Minecraft can use."
              >
                <Select
                  value={settings.memory}
                  options={["2048 MB", "4096 MB", "6144 MB", "8192 MB"]}
                  onChange={(v) => update("memory", v)}
                />
              </SettingsRow>
              <SettingsRow
                title="Java Runtime"
                description="Automatic detects or securely installs the exact Java Minecraft needs."
              >
                <Select
                  value={settings.java}
                  options={javaOptions.includes(settings.java) ? javaOptions : [settings.java, ...javaOptions]}
                  onChange={(v) => update("java", v)}
                />
              </SettingsRow>
              <SettingsRow
                title="Delight-managed Java"
                description="Delight installs private runtimes automatically when needed. Your system Java and PATH stay the same."
              >
                <ManagedJavaControl />
              </SettingsRow>
              <SettingsRow
                title="Java Arguments"
                description="Advanced JVM arguments for Minecraft launches."
              >
                <input className="text-input" value={settings.javaArguments} onChange={event => update("javaArguments", event.target.value)} placeholder="-XX:+UseG1GC" />
              </SettingsRow>
            </div>
          </div>
          <div className="settings-section" {...section("Cache")}>
            <SettingsHeading title="Storage" description="Manage the space Delight uses for cached content." />
            <ClientCacheControl active={activeTab === "Cache"} />
          </div>
          <div className="settings-section" {...section("Minecraft")}>
            <SettingsHeading title="Minecraft" description="Minecraft-specific defaults for future instances." />
            <div className="settings-card">
              <SettingsRow
                title="Default Game Version"
                description="Used when creating a new instance."
              >
                <Select
                  value={settings.defaultVersion}
                  options={["Latest release", ...releaseOptions]}
                  onChange={(v) => update("defaultVersion", v)}
                />
              </SettingsRow>
              <SettingsRow
                title="Default Mod Loader"
                description="The loader selected for new instances."
              >
                <Select
                  value={settings.defaultLoader}
                  options={["Fabric", "Vanilla"]}
                  onChange={(v) => update("defaultLoader", v as SettingsState["defaultLoader"])}
                />
              </SettingsRow>
            </div>
          </div>
          <div className="settings-section" {...section("Cosmetics")}>
            <SettingsHeading title="Cosmetics" description="Control capes and your in-game Delight identity." />
            <CosmeticsSettings profile={profile} />
          </div>
          <div className="settings-section" {...section("Launcher")}>
            <SettingsHeading title="Launcher" description="Control how Delight Client starts and launches games." />
            <div className="settings-card">
              <SettingsRow
                title="Home Layout"
                description="Choose between Delight's full dashboard and a focused traditional launcher."
              >
                <Select
                  value={settings.homeLayout}
                  options={["Dashboard", "Spotlight"]}
                  onChange={(v) => update("homeLayout", v as HomeLayout)}
                />
              </SettingsRow>
              <SettingsRow
                title="Double Click to Play"
                description="Quickly double-click an instance to launch it. A single click still opens its page."
              >
                <Toggle
                  value={settings.doubleClickToPlay}
                  onChange={(v) => update("doubleClickToPlay", v)}
                />
              </SettingsRow>
              <SettingsRow
                title="Launch Method"
                description="Choose how Minecraft windows open."
              >
                <Select
                  value={settings.launchMethod}
                  options={["Standard window", "Fullscreen"]}
                  onChange={(v) => update("launchMethod", v as SettingsState["launchMethod"])}
                />
              </SettingsRow>
              <SettingsRow
                title="Close Launcher After Launch"
                description="Automatically close Delight Client after Minecraft starts."
              >
                <Toggle
                  value={settings.closeAfterLaunch}
                  onChange={(v) => update("closeAfterLaunch", v)}
                />
              </SettingsRow>

            </div>
          </div>
          <div className="settings-section" {...section("Downloads")}>
            <SettingsHeading title="Downloads" description="Manage simultaneous downloads." />
            <div className="settings-card">
              <SettingsRow
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
              </SettingsRow>
            </div>
          </div>
          <div className="settings-section" {...section("Shortcuts")}>
            <h2>Shortcuts</h2>
            <KeyboardShortcuts saved={settings.shortcuts} change={value => update("shortcuts", value)} />
          </div>
          <div className="settings-section" {...section("Privacy")}>
            <SettingsHeading title="Privacy" description="Choose what Delight Client stores and shares." />
            <div className="settings-card">
              <SettingsRow
                title="Usage Analytics"
                description="Store anonymous feature-use counters locally on this device."
              >
                <Toggle
                  value={settings.analytics}
                  onChange={(v) => update("analytics", v)}
                />
              </SettingsRow>
              <SettingsRow
                title="Crash Reports"
                description="Save crash details locally so they can be reviewed in Logs."
              >
                <Toggle
                  value={settings.crashReports}
                  onChange={(v) => update("crashReports", v)}
                />
              </SettingsRow>
              <SettingsRow
                title="News and Recommendations"
                description="Show relevant client updates on Home."
              >
                <Select
                  value={settings.recommendations ? "Show recommendations" : "Hide recommendations"}
                  options={["Show recommendations", "Hide recommendations"]}
                  onChange={(v) => update("recommendations", v === "Show recommendations")}
                />
              </SettingsRow>
            </div>
          </div>
          <div className="settings-section" {...section("About Delight")}>
            <h2>About Delight</h2>
            <div className="settings-card">
              <SettingsRow title="Delight Client" description={`Version ${currentVersion}`}><button className="secondary-btn" onClick={() => void openUrl("https://delightproductions.org").catch(error => setAboutMessage(String(error)))}>Visit website <ExternalLink size={14}/></button></SettingsRow>
              {aboutMessage && <p role="alert">{aboutMessage}</p>}
            </div>
          </div>
          <div className="settings-section" {...section("Updates")}>
            <SettingsHeading title="Updates" description="Keep Delight Client secure and up to date." />
            <div className="settings-card updates-settings-card">
              <SettingsRow title="Automatic Checks" description="Check GitHub Releases once whenever Delight Client opens.">
                <Toggle value={settings.updates} onChange={(v) => update("updates", v)} />
              </SettingsRow>
              <SettingsRow title="Current Version" description="The version currently installed on this computer.">
                <span className="current-app-version">v{currentVersion}</span>
              </SettingsRow>
              <SettingsRow
                title={availableVersion ? `Version ${availableVersion} available` : "Update Status"}
                description={availableVersion ? `Delight can update from v${currentVersion} to v${availableVersion}.` : "Delight automatically checks once whenever the launcher opens."}
              >
                {availableVersion
                  ? <button className="settings-update-button available" onClick={onOpenUpdate}><Download size={15} />View update</button>
                  : <button className="settings-update-button" disabled={updateChecking} onClick={onCheckUpdates}><RotateCw className={updateChecking ? "spinning" : ""} size={15} />{updateChecking ? "Checking…" : "Check for updates"}</button>}
              </SettingsRow>
            </div>
          </div>
          <div className="settings-section" {...section("My Profile")}>
            <SettingsHeading title="Accounts" description="Manage your launcher picture and Microsoft accounts." />
            <div className="accounts-workspace">
              <section className="accounts-picture" aria-label="Profile picture" data-setting-help="Shown for all accounts on this launcher.">
                <button className="accounts-portrait" aria-label="Change picture" title="Change picture" disabled={!profile} onClick={() => profileIconInput.current?.click()}>
                  {profileIcon ? <img src={profileIcon} alt="" /> : profile ? <span aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</span> : <UserRound size={42}/>}
                  {profile && <i aria-hidden="true"><ImagePlus size={16}/></i>}
                </button>
                <input ref={profileIconInput} type="file" aria-label="Upload profile picture" accept="image/png,image/jpeg" hidden onChange={event => { chooseProfileIcon(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                {profileMessage && <p className="settings-inline-status" role="status">{profileMessage}</p>}
              </section>
              <section className="accounts-library" aria-label="Minecraft accounts">
                <ul className="settings-account-list" aria-label="Saved Minecraft accounts">
                  {(accounts.length ? accounts : profile ? [profile] : []).map(account => <li key={account.id}>
                    {activeTab === "My Profile" && !query.trim() && <AccountSkinPortrait accountId={account.id} />}
                    <b>{account.name}</b>
                    {account.id === profile?.id ? <span className="account-current"><Check size={16}/>Active</span>
                      : pendingProfileAccountId === account.id ? <div className="account-confirm-actions" role="group" aria-label={`Switch to ${account.name}?`}>
                        <button className="settings-action" disabled={switchingAccount} onClick={() => void onSwitchAccount(account).then(() => setPendingProfileAccountId(null))}>{switchingAccount ? "Switching…" : "Confirm switch"}</button>
                        <button className="settings-action" disabled={switchingAccount} onClick={() => setPendingProfileAccountId(null)}>Cancel</button>
                      </div> : <button className="settings-action" disabled={switchingAccount} aria-label={`Switch to ${account.name}`} onClick={() => setPendingProfileAccountId(account.id)}><ArrowRightLeft size={15}/>Switch</button>}
                  </li>)}
                </ul>
                {!profile && !accounts.length && !addingAccount && <p className="settings-inline-status">No saved accounts.</p>}
                {addingAccount ? <div className="settings-account-connect">
                  <SignInPanel open variant="inline" onSignedIn={next => { onAccountAdded(next); setAddingAccount(false); }} />
                  <button className="settings-action" onClick={() => setAddingAccount(false)}>Close</button>
                </div> : <button className="settings-action accounts-add" aria-label="Add Minecraft account" disabled={switchingAccount}
                  onClick={() => { setPendingProfileAccountId(null); setAddingAccount(true); }}><Plus size={16}/>Add account</button>}
              </section>
            </div>
          </div>
          <div className="settings-section" {...section("Advanced")}>
            <SettingsHeading title="Advanced" description="Power-user settings for troubleshooting and development." />
            <div className="settings-card">
              <SettingsRow
                title="Debug Logging"
                description="Write more detailed logs for troubleshooting."
              >
                <Toggle
                  value={settings.debugLogging}
                  onChange={(v) => update("debugLogging", v)}
                />
              </SettingsRow>
              <SettingsRow
                title="Game Directory"
                description="Choose where Minecraft files and instances are stored."
              >
                <button className="directory-setting" onClick={async () => { const chosen = await invoke<string | null>("choose_game_directory"); if (chosen) update("gameDirectory", chosen); }}><FolderOpen size={15} /><span title={settings.gameDirectory}>{settings.gameDirectory}</span></button>
              </SettingsRow>
              <SettingsRow
                title="Onboarding"
                description="Run the Microsoft setup again."
              >
                <button className="restart-onboarding-button" onClick={onRestartOnboarding}>
                  <RotateCw size={15} /> Restart onboarding
                </button>
              </SettingsRow>
              <SettingsRow
                title="Minecraft Account"
                description="Remove the saved Microsoft account from this device."
              >
                <button className="danger-button" onClick={onSignOut}>
                  Sign out
                </button>
              </SettingsRow>
              <SettingsRow
                title="Reset Preferences"
                description="Return Delight Client settings to their defaults."
              >
                <button
                  className="danger-button"
                  onClick={() => setSettings(defaults)}
                >
                  Reset settings
                </button>
              </SettingsRow>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
type InstanceDraft = {
  lastGameLogMs?: number | null;
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
type PackChannelRole = "owner" | "editor" | "member";
type PackChannelMembership = { instanceId: string; role: PackChannelRole };
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
  initialStep,
}: {
  initialStep: "source" | "file";
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
  const [releaseAttempt, setReleaseAttempt] = useState(0);
  const [releaseIssue, setReleaseIssue] = useState("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [javas, setJavas] = useState<JavaInstallation[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<"source" | "scratch" | "file" | "catalog" | "review-scratch" | "review-file">(initialStep);
  const [pack, setPack] = useState<{path: string; name: string; minecraft: string; fabric: string} | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = (next: typeof step) => { setMessage(""); setStep(next); };
  useLayoutEffect(() => {
    heading.current?.closest("main")?.scrollTo(0,0);
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  const [importing, setImporting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    let current = true;
    setReleaseIssue("");
    void invoke<Release[]>("get_minecraft_releases").then(list => {
      if (!current) return;
      setReleases(list);
      if (!list.length) { setReleaseIssue("No Minecraft releases returned."); return; }
      setDraft(old => old.version === "Latest release" ? { ...old, version: list[0].id } : old);
    }).catch(error => { if (current) setReleaseIssue(String(error)); });
    return () => { current = false; };
  }, [releaseAttempt]);
  useEffect(() => {
    let current = true;
    void invoke<JavaInstallation[]>("detect_java_installations")
      .then(list => { if (current) setJavas(list); })
      .catch(error => { if (current) setMessage(String(error)); });
    return () => { current = false; };
  }, []);
  const versionReady = Boolean(draft.version && draft.version !== "Latest release");
  const update = <K extends keyof InstanceDraft>(
    key: K,
    value: InstanceDraft[K],
  ) => setDraft(current => ({ ...current, [key]: value }));
  const create = async () => {
    if (saving || importing || !versionReady || !draft.name.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const saved = await invoke<InstanceDraft>("save_instance", {
        config: { ...draft, mods: draft.loader === "Fabric" || draft.mods },
      });
      setDraft(saved);
      setMessage(
        `${saved.loader} instance created and ready to play.`,
      );
      onCreated("home");
    } catch (error) {
      setMessage(String(error));
    } finally { setSaving(false); }
  };
  const importPack = async () => {
    setImporting(true);
    setMessage("");
    try {
      if (!pack) return;
      const importedId = await invoke<string | null>("import_fabric_modpack", { packPath: pack.path });
      if (importedId) onCreated("downloads");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setImporting(false);
    }
  };
  const choosePackFile = async () => {
    setImporting(true);
    setMessage("");
    try {
      const chosen = await invoke<typeof pack>("choose_fabric_modpack_file");
      if (chosen) setPack(chosen);
    } catch (error) { setMessage(String(error)); }
    finally { setImporting(false); }
  };
  const chooseDirectory = async () => {
    setMessage("");
    try {
      const chosen = await invoke<string | null>("choose_game_directory");
      if (chosen) {
        setDraft((current) => ({ ...current, directory: chosen }));
      }
    } catch (error) {
      setMessage(`Delight could not open the folder picker: ${String(error)}`);
    }
  };
  const folderOptions = [
    ["mods", "Mods"], ["resourcePacks", "Resource packs"], ["shaderPacks", "Shaders"], ["config", "Configuration"],
  ] as const;
  const behaviorOptions = [
    ["customResolution", "Custom resolution"], ["visible", "Show in launcher"],
  ] as const;
  const javaOptions = [...new Set(["Automatic (Recommended)", draft.java, ...javas.filter(java => java.usable).map(java => `Java ${java.majorVersion} — ${java.path}`)])];
  const busy = saving || importing;
  if (step === "catalog") return <ModrinthPackBrowser initialVersion={draft.version} versions={releases} onClose={() => navigate("source")} onImported={() => onCreated("downloads")} />;
  const review = step === "review-file" || step === "review-scratch";
  const reviewRows = step === "review-file" && pack ? [
    ["Modpack", pack.name], ["File", pack.path], ["Minecraft", pack.minecraft], ["Fabric Loader", pack.fabric],
  ] : [
    ["Instance name", draft.name], ["Minecraft", draft.version], ["Mod loader", draft.loader], ["Game directory", draft.directory],
    ["Memory", draft.memory + " MB"], ["Java runtime", draft.java],
    ["Instance folders", folderOptions.filter(([key]) => draft[key] || (key === "mods" && draft.loader === "Fabric")).map(([,title]) => title).join(", ") || "None"],
    ["Launch behavior", behaviorOptions.filter(([key]) => draft[key]).map(([,title]) => title).join(", ") || "None"],
    ...(draft.jvmArguments ? [["JVM arguments", draft.jvmArguments]] : []),
  ];
  return <section className="creation-workspace" aria-label="Create an instance" aria-busy={busy}>
    <header className="creation-header"><h1 ref={heading} tabIndex={-1}>New instance</h1>
      <button className="creation-button" onClick={onCancel} disabled={busy}>Cancel</button>
    </header>
    <CreationSteps current={step === "source" ? 1 : review ? 3 : 2} />
    {message && <p className="creation-notice" role="alert"><TriangleAlert size={16}/>{message}</p>}
    {releaseIssue && (step === "source" || step === "scratch") && <div className="creation-notice" role="alert">{releaseIssue}<button className="creation-button" onClick={() => setReleaseAttempt(n => n + 1)}>Retry versions</button></div>}
    {step === "source" ? <section className="creation-source"><h2>Choose a source</h2>
      <button onClick={() => navigate("scratch")}><Cuboid/><span>Start from scratch</span><ChevronRight/></button>
      <button disabled={!versionReady} onClick={() => navigate("catalog")}><span className="modrinth-brand" aria-hidden="true"/><span>Add from Modrinth</span><ChevronRight/></button>
      <button onClick={() => navigate("file")}><FolderInput/><span>Import from file</span><ChevronRight/></button>
    </section> : step === "file" ? <section className="creation-file-setup"><h2>Choose a modpack file</h2>
      <p>Fabric modpacks in .mrpack or Modrinth .zip format.</p>
      {pack && <div className="creation-file"><PackageOpen size={20}/><span>{pack.path}</span></div>}
      <button className="creation-button" disabled={busy} onClick={() => void choosePackFile()}><FolderOpen size={16}/>{pack ? "Change file" : "Choose file"}</button>
    </section> : review ? <section className="creation-review"><h2>{step === "review-file" ? "Review modpack" : "Review instance"}</h2>
      <dl>{reviewRows.map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    </section> : <>
    <div className="creation-columns">
      <section className="creation-group"><h2>Instance details</h2>
        <label className="creation-field"><span>Instance name</span><input value={draft.name} onChange={e => update("name", e.target.value)} placeholder="Enter instance name…" /></label>
        <div className="creation-pair">
          <div className="creation-field"><span>Mod loader</span><Select ariaLabel="Mod loader" value={draft.loader} options={["Vanilla", "Fabric"]} onChange={v => update("loader", v)} /></div>
          <div className="creation-field"><span>Minecraft version</span><Select ariaLabel="Minecraft version" disabled={!versionReady} value={versionReady ? draft.version : "Loading releases…"} options={[...new Set([draft.version, ...releases.map(release => release.id)])]} onChange={v => update("version", v)} /></div>
        </div>
        <div className="creation-field"><label htmlFor="creation-directory">Game directory</label>
          <div className="creation-directory"><input id="creation-directory" value={draft.directory} onChange={e => update("directory", e.target.value)} /><button aria-label="Choose game directory" title="Choose game directory" onClick={() => void chooseDirectory()}><FolderOpen size={18}/></button></div>
        </div>
      </section>
      <section className="creation-group"><h2>Memory &amp; Java</h2>
        <div className="creation-field"><span>Memory allocation</span>
          <CommitSlider label="Memory allocation" minimum={1024} maximum={8192} step={512} unit=" MB" value={draft.memory} onCommit={v => update("memory",v)}>
            {value => <MemoryAmount value={value} onChange={v => update("memory",v)} />}
          </CommitSlider>
        </div>
        <div className="creation-field"><span>Java runtime</span><Select ariaLabel="Java runtime" value={draft.java} options={javaOptions} onChange={v => update("java",v)}/></div>
      </section>
    </div>
    <button className="creation-disclosure" aria-expanded={advancedOpen} aria-controls="new-instance-advanced-options" onClick={() => setAdvancedOpen(!advancedOpen)}>
      <SlidersHorizontal size={17}/><span>Advanced options</span><ChevronDown size={17}/>
    </button>
    {advancedOpen && <div id="new-instance-advanced-options" className="creation-columns creation-advanced">
      <section className="creation-group"><h2>Instance folders</h2>
        {folderOptions.map(([key,title]) => {
          const required = key === "mods" && draft.loader === "Fabric";
          return <div className="creation-switch" key={key}><span>{title}{required && <small>Required by Fabric</small>}</span>
            <Toggle label={title} value={required || draft[key]} disabled={required} onChange={v => update(key,v)}/></div>;
        })}
      </section>
      <section className="creation-group"><h2>Launch behavior</h2>
        {behaviorOptions.map(([key,title]) => <div className="creation-switch" key={key}><span>{title}</span><Toggle label={title} value={draft[key]} onChange={v => update(key,v)}/></div>)}
        <label className="creation-field"><span>JVM arguments</span><textarea spellCheck={false} value={draft.jvmArguments} onChange={e => update("jvmArguments", e.target.value)} placeholder="Optional Java flags" /></label>
      </section>
    </div>}
    </>}
    {step !== "source" && <footer className="creation-footer">
      <button className="creation-button" disabled={busy} onClick={() => navigate(step === "review-scratch" ? "scratch" : step === "review-file" ? "file" : "source")}><X size={16}/>Back</button>
      {review ? <button className="creation-button creation-primary" disabled={busy} onClick={() => void (step === "review-file" ? importPack() : create())}>
        {step === "review-file" ? <Download size={16}/> : <Plus size={16}/>}
        {step === "review-file" ? importing ? "Importing…" : "Import" : saving ? "Creating…" : "Create instance"}
      </button> : <button className="creation-button creation-primary" disabled={busy || (step === "file" ? !pack : !draft.name.trim() || !versionReady)}
        onClick={() => navigate(step === "file" ? "review-file" : "review-scratch")}>Review<ChevronRight size={16}/></button>}
    </footer>}
  </section>;
}

function CreationSteps({ current }: { current: 1 | 2 | 3 }) {
  return <ol className="creation-steps" aria-label="Creation progress">{["Source", "Setup", "Review"].map((label,index) =>
    <li key={label} aria-current={index + 1 === current ? "step" : undefined}>{index > 0 && <ChevronRight size={13} aria-hidden="true"/>}{label}</li>)}</ol>;
}

function MemoryAmount({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  return <label className="creation-memory-amount"><input type="number" aria-label="Memory in megabytes" min={1024} max={8192} step={512}
    value={editing ?? value} onFocus={e => e.target.select()} onChange={e => setEditing(e.target.value)}
    onBlur={() => {
      if (editing?.trim()) onChange(Math.max(1024,Math.min(8192,Math.round(Number(editing) / 512) * 512)));
      setEditing(null);
    }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} /><span>MB</span></label>;
}
type InstanceContentItem = { id: string; name: string; version: string; fileName: string; size: number; enabled: boolean; icon?: string | null };

type CatalogItem = { provider: string; projectId: string; slug: string; title: string; summary: string; iconUrl?: string | null; iconSourceUrl?: string | null; author: string; downloads: number; loader: string; gameVersion: string; versionId: string; versionNumber: string; fileName: string; fileSize: number; loaders?: string[]; gameVersions?: string[] };
type CatalogSearchResult = { items: CatalogItem[]; offset: number; limit: number; total: number };
const instanceContentMemoryCache = new Map<string, InstanceContentItem[]>();
const catalogMemoryCache = new Map<string, CatalogSearchResult>();
const instanceContentCacheKey = (instanceId: string, category: Exclude<InstanceTab, "settings">) => `${instanceId}:${category}`;
const catalogCacheKey = (category: string, gameVersion: string, query: string, page: number, filters?: CatalogFilters) => `${category}:${gameVersion}:${query.trim().toLowerCase()}:${page}${filters ? `:${JSON.stringify(filters)}` : ""}`;
function warmCatalogImages(result: CatalogSearchResult) { for (const item of result.items) if (item.iconUrl) { const image = new Image(); image.src = item.iconUrl; } }
async function waitForCatalogFirstBatch(items: CatalogItem[]) {
  await Promise.all(items.slice(0, 10).map(item => new Promise<void>(resolve => {
    if (!item.iconUrl) { resolve(); return; }
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, 2_500);
    image.onload = finish;
    image.onerror = finish;
    image.src = item.iconUrl;
  })));
}
function CatalogLoadingState({ label }: { label: string }) {
  return <div className="catalog-loading catalog-loading-social" role="status" aria-live="polite">
    <RefreshCw className="spin" size={22} aria-hidden="true" />
    <span>{label}</span>
  </div>;
}
function clearTransientClientCaches() {
  instanceContentMemoryCache.clear();
  catalogMemoryCache.clear();
  window.dispatchEvent(new Event("bloom-clear-transient-caches"));
}
type ModrinthModpackRelease = { id: string; versionNumber: string; versionType: string; gameVersions: string[]; datePublished: string; fileName: string; fileSize: number };
function ModrinthPackBrowser({ initialVersion, versions, onClose, onImported }: {
  initialVersion: string;
  versions: Release[];
  onClose: () => void;
  onImported: (instanceId: string) => void;
}) {
  const [gameVersion, setGameVersion] = useState(initialVersion);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<CatalogSearchResult>({ items: [], offset: 0, limit: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState<CatalogItem | null>(null);
  const [releases, setReleases] = useState<ModrinthModpackRelease[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [selectedGameVersion, setSelectedGameVersion] = useState("");
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const [retry, setRetry] = useState(0);
  const [releaseError, setReleaseError] = useState("");
  const [installError, setInstallError] = useState("");
  const releaseRequest = useRef(0);
  const packActionRef = useRef<HTMLButtonElement>(null);
  const searchSequence = useRef(0);
  useLayoutEffect(() => {
    packActionRef.current?.closest("main")?.scrollTo(0, 0);
    packActionRef.current?.focus({ preventScroll: true });
  }, [selectedPack?.projectId]);
  useEffect(() => {
    const key = catalogCacheKey("modpacks", gameVersion, query, page);
    const cached = catalogMemoryCache.get(key);
    if (cached) { setCatalog(cached); setLoading(false); } else setLoading(true);
    const request = ++searchSequence.current;
    const timer = window.setTimeout(() => {
      setError("");
      void invoke<CatalogSearchResult>("search_modrinth_content", { query, gameVersion, offset: (page - 1) * 50, category: "modpacks" })
        .then(result => {
          catalogMemoryCache.set(key, result);
          warmCatalogImages(result);
          if (request === searchSequence.current) setCatalog(result);
          const pages = Math.ceil(result.total / Math.max(1, result.limit));
          for (const nextPage of [page + 1, page + 2].filter(value => value <= pages)) {
            const nextKey = catalogCacheKey("modpacks", gameVersion, query, nextPage);
            if (catalogMemoryCache.has(nextKey)) continue;
            void invoke<CatalogSearchResult>("search_modrinth_content", { query, gameVersion, offset: (nextPage - 1) * 50, category: "modpacks" }).then(next => { catalogMemoryCache.set(nextKey, next); warmCatalogImages(next); }).catch(() => {});
          }
        })
        .catch((reason) => { if (request === searchSequence.current && !cached) { setCatalog({ items: [], offset: 0, limit: 50, total: 0 }); setError(String(reason)); } })
        .finally(() => { if (request === searchSequence.current) setLoading(false); });
    }, query ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [query, gameVersion, page, retry]);
  useEffect(() => setPage(1), [query, gameVersion]);
  const pageCount = Math.max(1, Math.ceil(catalog.total / Math.max(1, catalog.limit)));
  const changePage = (nextPage: number) => {
    const cached = catalogMemoryCache.get(catalogCacheKey("modpacks", gameVersion, query, nextPage));
    if (cached) { setCatalog(cached); setLoading(false); } else setLoading(true);
    setPage(nextPage);
  };
  const supportedGameVersions = Array.from(new Set(releases.flatMap((release) => release.gameVersions)));
  const compatibleReleases = releases.filter((release) => release.gameVersions.includes(selectedGameVersion));
  const releaseLabel = (release: ModrinthModpackRelease) => {
    const duplicate = compatibleReleases.some(other => other.id !== release.id && other.versionNumber === release.versionNumber && other.versionType === release.versionType);
    return `${release.versionNumber} · ${release.versionType}${duplicate ? " · " + release.id : ""}`;
  };
  const selectedRelease = compatibleReleases.find((release) => release.id === selectedReleaseId) || compatibleReleases[0] || null;
  useEffect(() => {
    if (!compatibleReleases.length) {
      setSelectedReleaseId("");
      return;
    }
    if (!compatibleReleases.some((release) => release.id === selectedReleaseId)) setSelectedReleaseId(compatibleReleases[0].id);
  }, [selectedGameVersion, releases]);
  const choosePack = async (item: CatalogItem) => {
    const request = ++releaseRequest.current;
    setReleaseError("");
    setInstallError("");
    setSelectedPack(item);
    setReleases([]);
    setSelectedGameVersion("");
    setSelectedReleaseId("");
    setReleasesLoading(true);
    setError("");
    try {
      const available = await invoke<ModrinthModpackRelease[]>("list_modrinth_modpack_releases", { projectId: item.projectId });
      if (request !== releaseRequest.current) return;
      setReleases(available);
      const supported = Array.from(new Set(available.flatMap((release) => release.gameVersions)));
      const initialGameVersion = supported.includes(gameVersion) ? gameVersion : supported[0] || "";
      setSelectedGameVersion(initialGameVersion);
      setSelectedReleaseId(available.find((release) => release.gameVersions.includes(initialGameVersion))?.id || "");
    } catch (reason) {
      if (request === releaseRequest.current) setReleaseError(String(reason));
    } finally {
      if (request === releaseRequest.current) setReleasesLoading(false);
    }
  };
  const returnToPacks = () => {
    releaseRequest.current++;
    setSelectedPack(null);
    setReleases([]);
    setSelectedGameVersion("");
    setSelectedReleaseId("");
    setError("");
  };
  const install = async (item: CatalogItem, versionId: string) => {
    if (installingId) return;
    setInstallingId(item.projectId);
    setInstallError("");
    try {
      const instanceId = await invoke<string>("import_modrinth_modpack", { projectId: item.projectId, versionId });
      onImported(instanceId);
    } catch (reason) {
      setInstallError(String(reason));
      setInstallingId(null);
    }
  };
  const goBack = selectedPack ? returnToPacks : onClose;
  return <section className="creation-workspace creation-catalog" aria-label="Add a Modrinth modpack" onKeyDown={event => {
    if (event.key === "Escape" && !installingId && !document.querySelector(".select-menu-portal")) {
      event.stopPropagation(); goBack();
    }
  }}>
    <header className="creation-header">
      <div className="creation-catalog-title"><button ref={packActionRef} className="creation-back" disabled={Boolean(installingId)} onClick={goBack}
        aria-label={selectedPack ? "Back to modpacks" : "Close Modpacks"} title={selectedPack ? "Back to modpacks" : "Back to new instance"}><X size={18}/></button>
        <h1>{selectedPack ? "Choose version" : "Modrinth modpacks"}</h1></div>
    </header>
    <CreationSteps current={selectedPack ? 3 : 2} />
    {selectedPack ? <section className="creation-release">
      <header className="creation-pack-identity"><span className="creation-pack-art"><CatalogArtwork source={selectedPack.iconUrl} fallback={<PackageOpen size={28}/>} /></span>
        <div><h2>{selectedPack.title}</h2><span>{selectedPack.author}</span></div></header>
      {selectedPack.summary && <p>{selectedPack.summary}</p>}
      {releasesLoading ? <p className="creation-status" role="status">Loading supported versions…</p>
        : releaseError ? <div className="creation-notice" role="alert">{releaseError}<button className="creation-button" onClick={() => void choosePack(selectedPack)}>Retry</button></div>
        : selectedRelease ? <>
          <div className="creation-pair">
            <div className="creation-field"><span>Minecraft version</span><Select ariaLabel="Supported Minecraft version" disabled={Boolean(installingId)} value={selectedGameVersion} options={supportedGameVersions} onChange={setSelectedGameVersion} /></div>
            <div className="creation-field"><span>Modpack release</span><Select ariaLabel="Modpack release" disabled={Boolean(installingId)} value={releaseLabel(selectedRelease)} options={compatibleReleases.map(releaseLabel)} onChange={value => setSelectedReleaseId(compatibleReleases.find(release => releaseLabel(release) === value)!.id)} /></div>
          </div>
          <div className="creation-file"><PackageOpen size={19}/><span>{selectedRelease.fileName}</span><small>{formatBytes(selectedRelease.fileSize)}</small></div>
          {installError && <p className="creation-notice" role="alert">{installError}</p>}
          <button className="creation-button creation-primary" disabled={Boolean(installingId)} onClick={() => void install(selectedPack, selectedRelease.id)}>
            <Download size={16}/>{installingId ? "Importing…" : "Import"}</button>
        </> : <p className="creation-status" role="status">No compatible Fabric releases for this pack.</p>}
    </section> : <>
      <div className="creation-searchbar"><label><Search size={17}/><input aria-label="Search Modrinth modpacks" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Modrinth modpacks…" /></label><Select ariaLabel="Filter packs by Minecraft version" value={gameVersion} options={[...new Set([initialVersion, ...versions.map(release => release.id)])]} onChange={setGameVersion} /><span>Fabric</span></div>
      {loading ? <p className="creation-status" role="status">{query ? "Searching Modrinth…" : "Loading modpacks…"}</p>
        : error ? <div className="creation-notice" role="alert">{error}<button className="creation-button" onClick={() => setRetry(n => n + 1)}>Retry</button></div>
        : catalog.items.length ? <ul className="creation-results">{catalog.items.map(item => <li key={item.projectId}>
          <span className="creation-pack-art"><CatalogArtwork source={item.iconUrl} fallback={<PackageOpen size={22}/>} /></span>
          <div className="creation-pack-copy"><b>{item.title}</b><small>{item.summary || item.author}</small></div>
          <span className="creation-result-size">{formatBytes(item.fileSize)}</span>
          <button className="creation-back" aria-label={`View ${item.title} on Modrinth`} title="View on Modrinth" onClick={() => void openUrl(`https://modrinth.com/modpack/${item.slug}`).catch(reason => setError(String(reason)))}><ExternalLink size={16}/></button>
          <button className="creation-button" onClick={() => void choosePack(item)} aria-label={`Choose a version of ${item.title}`}>Select<ChevronRight size={15}/></button>
        </li>)}</ul> : <p className="creation-status" role="status">No compatible packs found. Try another search or Minecraft version.</p>}
      {pageCount > 1 && <PaginationControls page={page} pages={pageCount} busy={loading} onPage={changePage} />}
    </>}
  </section>;
}
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
  onCopy,
}: {
  item: InstanceContentItem;
  category: Exclude<InstanceTab, "settings">;
  onDelete: () => Promise<void>;
  onCopy: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useLauncherMenu(open, setOpen, triggerRef, menuRef, 184, true);
  const modrinthSection = category === "mods" ? "mods" : category === "resourcepacks" ? "resourcepacks" : "shaders";
  return <>
    <button ref={triggerRef} className="content-dots" aria-haspopup="dialog" aria-label={`Actions for ${item.name}`} aria-expanded={open} onClick={() => setOpen(value => !value)}><MoreHorizontal size={18} /></button>
    {open && createPortal(
      <div ref={menuRef} role="dialog" aria-label={`Actions for ${item.name}`} className="select-menu select-menu-portal content-actions-menu" style={{ ...closedDropdownStyle, position: "fixed", top: position.top, left: position.left, right: "auto", width: position.width, maxHeight: position.maxHeight }}>
        <button style={{ opacity: 0 }} onClick={() => { setOpen(false); onCopy(); }}><Copy size={14} />Copy to instance…</button>
        <button style={{ opacity: 0 }} className="view-modrinth-action" onClick={() => { setOpen(false); void openUrl(`https://modrinth.com/${modrinthSection}?q=${encodeURIComponent(item.name)}`); }}><ExternalLink size={14} />View on Modrinth</button>
        <button style={{ opacity: 0 }} className="delete-content-action" onClick={() => { setOpen(false); void onDelete(); }}><Trash2 size={14} />Delete</button>
      </div>,
      document.body,
    )}
  </>;
}

function ContentEmptyState({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="content-empty">
    <div role="status"><p>{title}</p>{description && <p>{description}</p>}</div>
    {actions && <div className="content-empty-actions">{actions}</div>}
  </div>;
}

function InstanceWorlds({ instanceId, busy, onPlay }: {
  instanceId: string;
  busy: boolean;
  onPlay: (target: PortalTarget) => void;
}) {
  const [worlds, setWorlds] = useState<PortalEntry[] | null>(null);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailure("");
    void invoke<PortalLibrary>("list_portal").then(library => {
      if (live) setWorlds(library.entries.filter(entry => entry.instanceId === instanceId && entry.kind === "world"));
    }).catch(error => { if (live) setFailure(String(error)); });
    return () => { live = false; };
  }, [instanceId, attempt]);

  if (failure) return <ContentEmptyState title="Could not load worlds" description={failure}
    actions={<button onClick={() => setAttempt(value => value + 1)}>Try again</button>} />;
  if (!worlds) return <CatalogLoadingState label="Loading worlds" />;
  if (!worlds.length) return <ContentEmptyState title="No saved worlds yet." />;
  return <ul className="desktop-worlds" aria-label="Saved worlds">
    {worlds.map(world => <li className="instance-list-row" key={world.id}>
      <span className="content-icon"><CatalogArtwork source={world.icon} fallback={<Cuboid size={22} />} /></span>
      <span className="content-name"><b>{world.name}</b>{world.unavailableReason && <small>{world.unavailableReason}</small>}</span>
      <button disabled={busy || Boolean(world.unavailableReason)} onClick={() => onPlay({ kind: "world", target: world.target })}><Play size={15} />Play</button>
    </li>)}
  </ul>;
}

function InstancePage({ instance, contentTasks, groupRole, busy, initialTab = "mods", initialCatalog = false, onPopOut, floating, onPlay, onRename, onExport, onShare, onDuplicate, onDelete, onChanged, onInstallContent, onMessage }: { onMessage: (message: string, kind?: "notification" | "error") => void; instance: InstanceDraft; contentTasks: ContentDownload[]; groupRole?: PackChannelRole; busy: boolean; initialTab?: InstanceTab; initialCatalog?: boolean; onPopOut: () => void; floating: boolean; onPlay: (target?: PortalTarget) => void; onRename: (name: string) => Promise<void>; onExport: () => Promise<void>; onShare: () => void; onDuplicate: () => Promise<void>; onDelete: () => Promise<void>; onChanged: (instance: InstanceDraft) => void; onInstallContent: (item: CatalogItem, category: Exclude<InstanceTab, "settings">) => Promise<void> }) {
  const contentTransfer = useContentTransfer();
  const [tab, setTab] = useState<InstanceTab>(initialTab);
  const [worldsOpen, setWorldsOpen] = useState(false);
  const [items, setItems] = useState<InstanceContentItem[]>(() => initialTab === "settings" ? [] : instanceContentMemoryCache.get(instanceContentCacheKey(instance.id, initialTab)) || []);
  const [contentReady, setContentReady] = useState(() => initialTab === "settings" || instanceContentMemoryCache.has(instanceContentCacheKey(instance.id, initialTab)));
  const [contentError, setContentError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("Name");
  const [filter, setFilter] = useState("All");
  const [packArtwork, setPackArtwork] = useState<Record<string, string>>({});
  const artworkKey = tab === "shaderpacks" || tab === "resourcepacks" ? JSON.stringify(items.map(item => [item.fileName, item.size])) : "";
  useEffect(() => {
    let current = true;
    setPackArtwork({});
    if (contentReady && items.length && (tab === "shaderpacks" || tab === "resourcepacks")) {
      void invoke<Record<string, string>>("get_pack_artwork", { instanceId: instance.id, category: tab })
        .then(images => { if (current) setPackArtwork(images ?? {}); }).catch(() => {});
    }
    return () => { current = false; };
  }, [instance.id, tab, artworkKey, contentReady]);
  const [contentPage, setContentPage] = useState(1);
  const [browsingCatalog, setBrowsingCatalog] = useState(initialCatalog && instance.loader.toLowerCase().includes("fabric"));
  const [catalog, setCatalog] = useState<CatalogSearchResult>({ items: [], offset: 0, limit: 50, total: 0 });
  const [catalogLoading, setCatalogLoading] = useState(initialCatalog && instance.loader.toLowerCase().includes("fabric"));
  const [catalogFilters, setCatalogFilters] = useState(defaultCatalogFilters);
  const [catalogVersion, setCatalogVersion] = useState(instance.version);
  const catalogFiltered = catalogFiltersChanged(catalogFilters, catalogVersion, instance.version);
  const activeCatalogFilters = tab === "mods" && catalogFiltered ? catalogFilters : undefined;
  const catalogGameVersion = tab === "mods" ? catalogVersion : instance.version;
  const [catalogError, setCatalogError] = useState("");
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [renderedItemCount, setRenderedItemCount] = useState(10);
  const [pendingRequests, setPendingCatalogItems] = useState<Set<string>>(() => new Set());
  const pendingCatalogItems = new Set([...pendingRequests, ...contentTasks.filter(task => task.instanceId === instance.id && contentPending(task)).map(task => `${task.category}:${task.projectId}`)]);
  const contentCompletions = contentTasks.filter(task => task.instanceId === instance.id && task.category === tab && task.state === "installed");
  const contentCompletionKey = contentCompletions.map(task => task.id).join(":");
  const [draggingContent, setDraggingContent] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [instanceMenuBusy, setInstanceMenuBusy] = useState<"duplicate" | "delete" | "export" | null>(null);
  const [confirmInstanceDelete, setConfirmInstanceDelete] = useState(false);

  const [modDrawer, setModDrawer] = useState<ModDrawerSelection | null>(null);
  const [modDrawerDetails, setModDrawerDetails] = useState<ModProjectDetails | null>(null);
  const [modDrawerLoading, setModDrawerLoading] = useState(false);
  const [modDrawerError, setModDrawerError] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [advancedJvmOpen, setAdvancedJvmOpen] = useState(false);
  const [name, setName] = useState(instance.name);
  useEffect(() => setName(instance.name), [instance.name]);
  const [memory, setMemory] = useState(instance.memory);
  const [loaderVersion, setLoaderVersion] = useState<string>();
  useEffect(() => setLoaderVersion(undefined), [instance.id, instance.loaderVersion]);
  const [jvmArguments, setJvmArguments] = useState(instance.jvmArguments);
  const preserveInitialCatalog = useRef(initialCatalog);
  const jvmPreset = Object.entries(JVM_PRESETS).find(([, args]) => args === jvmArguments)?.[0] || "Custom";
  const iconInput = useRef<HTMLInputElement>(null);
  const contentListRef = useRef<HTMLDivElement>(null);
  const instanceMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const instanceMenuRef = useRef<HTMLDivElement>(null);
  const contentLoadSequence = useRef(0);
  const catalogLoadSequence = useRef(0);
  const loadContent = async () => {
    if (tab === "settings") return;
    const category = tab;
    const key = instanceContentCacheKey(instance.id, category);
    const cached = instanceContentMemoryCache.get(key);
    setContentError("");
    if (cached) {
      setItems(cached);
      setContentReady(true);
    } else {
      setContentReady(false);
    }
    const request = ++contentLoadSequence.current;
    try {
      const next = await invoke<InstanceContentItem[]>("list_instance_content", { instanceId: instance.id, category });
      instanceContentMemoryCache.set(key, next);
      if (request === contentLoadSequence.current) { setItems(next); setContentReady(true); }
    } catch (error) {
      if (request !== contentLoadSequence.current) return;
      setContentReady(true);
      if (cached?.length) onMessage(String(error), "error");
      else {
        setItems([]);
        setContentError(String(error));
      }
    }
  };
  useEffect(() => { void loadContent(); const focus = () => { if (!document.hidden) void loadContent(); }; window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [tab, instance.id]);
  useEffect(() => {
    if (!contentCompletions.length) return;
    setModDrawer(current => {
      const installed = contentCompletions.find(task => task.projectId === current?.projectId);
      return current && installed ? { ...current, installed: true, canInstall: false, installedVersion: installed.version || current.installedVersion } : current;
    });
    void loadContent();
  }, [instance.id, tab, contentCompletionKey]);
  useEffect(() => { setName(instance.name); setMemory(instance.memory); setJvmArguments(instance.jvmArguments); }, [instance]);
  useEffect(() => { setModDrawer(null); setModDrawerDetails(null); setModDrawerError(""); }, [instance.id, tab, browsingCatalog, catalogFilters, catalogVersion]);
  const drawerCatalogItem = browsingCatalog ? catalog.items.find(item => item.projectId === modDrawer?.projectId) : undefined;
  useEffect(() => {
    if (!modDrawer?.projectId) { setModDrawerDetails(null); setModDrawerLoading(false); return; }
    let current = true;
    setModDrawerDetails(null);
    setModDrawerError("");
    setModDrawerLoading(true);
    void invoke<ModProjectDetails>("get_modrinth_project_details", { projectId: modDrawer.projectId, gameVersion: drawerCatalogItem?.gameVersion || instance.version, category: "mods", loader: drawerCatalogItem?.loaders?.[0] || drawerCatalogItem?.loader.toLowerCase().split(",")[0], versionId: drawerCatalogItem?.versionId })
      .then(details => { if (current) setModDrawerDetails(details); })
      .catch(error => { if (current) setModDrawerError(String(error)); })
      .finally(() => { if (current) setModDrawerLoading(false); });
    return () => { current = false; };
  }, [modDrawer?.projectId, instance.version, drawerCatalogItem?.versionId]);
  const instanceMenuPosition = useLauncherMenu(menuOpen, setMenuOpen, instanceMenuTriggerRef, instanceMenuRef, 240, true);
  useEffect(() => { if (!menuOpen) setConfirmInstanceDelete(false); }, [menuOpen]);
  useEffect(() => {
    if (preserveInitialCatalog.current) { preserveInitialCatalog.current = false; return; }
    setBrowsingCatalog(false); setSearch("");
  }, [tab]);
  useEffect(() => { setContentPage(1); }, [tab, search, filter, sort, instance.id]);
  useEffect(() => {
    setRenderedItemCount(10);
    if (contentListRef.current) contentListRef.current.scrollTop = 0;
  }, [tab, browsingCatalog, search, contentPage, instance.id, catalogFilters, catalogVersion]);
  useEffect(() => {
    if (!browsingCatalog || tab === "settings") return;
    const category = tab;
    const page = contentPage;
    let cancelled = false;
    setCatalogError("");
    const key = catalogCacheKey(category, catalogGameVersion, search, page, activeCatalogFilters);
    const cached = catalogMemoryCache.get(key);
    if (cached) { setCatalog(cached); setCatalogLoading(false); } else { setCatalogLoading(true); setCatalog({ items: [], total: 0, offset: 0, limit: 50 }); }
    const request = ++catalogLoadSequence.current;
    const timer = window.setTimeout(() => {
      void invoke<CatalogSearchResult>("search_modrinth_content", { query: search, gameVersion: catalogGameVersion, offset: (page - 1) * 50, category, ...(activeCatalogFilters ? { filters: activeCatalogFilters } : {}) })
        .then(async (result) => {
          catalogMemoryCache.set(key, result);
          warmCatalogImages(result);
          if (cancelled || request !== catalogLoadSequence.current) return;
          const pages = Math.ceil(result.total / Math.max(1, result.limit));
          for (const nextPage of [page + 1, page + 2].filter(value => value <= pages)) {
            const nextKey = catalogCacheKey(category, catalogGameVersion, search, nextPage, activeCatalogFilters);
            if (catalogMemoryCache.has(nextKey)) continue;
            void invoke<CatalogSearchResult>("search_modrinth_content", { query: search, gameVersion: catalogGameVersion, offset: (nextPage - 1) * 50, category, ...(activeCatalogFilters ? { filters: activeCatalogFilters } : {}) }).then(next => { catalogMemoryCache.set(nextKey, next); warmCatalogImages(next); }).catch(() => {});
          }
          if (!cached && request === catalogLoadSequence.current) await waitForCatalogFirstBatch(result.items);
          if (!cancelled && request === catalogLoadSequence.current) { setCatalog(result); }
        })
        .catch((error) => { if (!cancelled && request === catalogLoadSequence.current && !cached) { setCatalogError(String(error)); onMessage(String(error), "error"); } })
        .finally(() => { if (!cancelled && request === catalogLoadSequence.current) setCatalogLoading(false); });
    }, search ? 320 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [browsingCatalog, tab, search, contentPage, instance.version, catalogFilters, catalogVersion, catalogRetry]);
  const toggleItem = async (item: InstanceContentItem, enabled: boolean) => { try { await invoke("toggle_instance_content", { instanceId: instance.id, category: tab, fileName: item.fileName, enabled }); await loadContent(); } catch (error) { onMessage(String(error), "error"); } };
  const deleteItem = async (item: InstanceContentItem) => {
    if (tab === "settings") return;
    try {
      await invoke("delete_instance_content", { instanceId: instance.id, category: tab, fileName: item.fileName });
      onMessage(`${item.name} was deleted.`);
      await loadContent();
    } catch (error) { onMessage(String(error), "error"); }
  };
  const chooseIcon = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => { void invoke<InstanceDraft>("set_instance_icon", { instanceId: instance.id, icon: String(reader.result) }).then(onChanged).catch(error => onMessage(String(error), "error")); }; reader.readAsDataURL(file); };
  const saveSettings = async () => { if (savingSettings || (busy && loaderVersion !== undefined)) return; setSavingSettings(true); try { const saved = await invoke<InstanceDraft>("update_instance_settings", { instanceId: instance.id, name, memory, jvmArguments, ...(loaderVersion !== undefined ? { loaderVersion } : {}) }); onChanged(saved); setLoaderVersion(undefined); onMessage("Instance settings saved."); } catch (error) { onMessage(String(error), "error"); } finally { setSavingSettings(false); } };
  const applyJvmPreset = (preset: string) => { if (preset === "Custom") setAdvancedJvmOpen(true); if (preset in JVM_PRESETS) setJvmArguments(JVM_PRESETS[preset as keyof typeof JVM_PRESETS]); };
  const categoryLabel = tab === "mods" ? "Mods" : tab === "resourcepacks" ? "Resource Packs" : "Shaders";
  const catalogKey = (item: CatalogItem, category: Exclude<InstanceTab, "settings"> = tab as Exclude<InstanceTab, "settings">) => `${category}:${item.projectId}`;
  const normalizedIdentity = (value: string) => value.toLowerCase().replace(/\.disabled$/i, "").replace(/\.(jar|zip)$/i, "").replace(/[^\p{L}\p{N}]+/gu, "");
  const matchingInstalledItem = (item: CatalogItem) => {
    const exactFile = item.fileName.toLowerCase().replace(/\.disabled$/i, "");
    const targets = [item.title, item.slug].map(normalizedIdentity).filter(Boolean);
    return items.find(installed => {
      if (installed.fileName.toLowerCase().replace(/\.disabled$/i, "") === exactFile) return true;
      return [installed.name, installed.fileName].some(name => targets.includes(normalizedIdentity(name)));
    });
  };
  const catalogItemInstalled = (item: CatalogItem) => Boolean(matchingInstalledItem(item));
  const showCatalogModDetails = (item: CatalogItem) => {
    const installedItem = matchingInstalledItem(item);
    setModDrawerDetails(null);
    setModDrawerError("");
    setModDrawerLoading(true);
    setModDrawer({
      key: `catalog:${item.projectId}`,
      projectId: item.projectId,
      title: item.title,
      icon: item.iconUrl,
      author: item.author || "Modrinth creator",
      installedVersion: installedItem?.version || item.versionNumber,
      source: "Modrinth",
      summary: item.summary,
      fileName: item.fileName,
      fileSize: item.fileSize,
      projectUrl: `https://modrinth.com/mod/${encodeURIComponent(item.slug || item.projectId)}`,
      canInstall: !installedItem && !catalogInstallRestriction(item, instance),
      installed: Boolean(installedItem),
    });
  };
  const showInstalledModDetails = (item: InstanceContentItem) => {
    setModDrawerDetails(null);
    setModDrawerError("");
    setModDrawerLoading(false);
    setModDrawer({
      key: `installed:${item.id}`,
      title: item.name,
      icon: item.icon,
      author: "Local installation",
      installedVersion: item.version || "Installed",
      source: "Local instance",
      summary: "This mod is installed directly in this instance. Catalog details are unavailable until it is opened from the Modrinth library.",
      fileName: item.fileName,
      fileSize: item.size,
      canInstall: false,
      installed: true,
    });
  };
  const queueCatalogInstall = async (item: CatalogItem) => {
    if (tab === "settings" || catalogItemInstalled(item) || (tab === "mods" && catalogInstallRestriction(item, instance))) return;
    const key = catalogKey(item, tab);
    if (pendingCatalogItems.has(key)) return;
    setPendingCatalogItems(current => new Set(current).add(key));
    try {
      await onInstallContent(item, tab);
    } catch (error) {
      onMessage(String(error), "error");
    } finally {
      setPendingCatalogItems(current => { const next = new Set(current); next.delete(key); return next; });
    }
  };
  const visibleItems = items.filter(item => item.name.toLowerCase().includes(search.toLowerCase()) && (filter === "All" || (filter === "Enabled" ? item.enabled : !item.enabled))).sort((a, b) => sort === "Size" ? b.size - a.size : a.name.localeCompare(b.name));
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / 50));
  const safePage = Math.min(contentPage, pageCount);
  const pagedItems = visibleItems.slice((safePage - 1) * 50, safePage * 50);
  const renderedInstalledItems = tab === "mods" ? pagedItems.slice(0, renderedItemCount) : pagedItems;
  const renderedCatalogItems = tab === "mods" ? catalog.items.slice(0, renderedItemCount) : catalog.items;
  const catalogPages = Math.max(1, Math.ceil(catalog.total / Math.max(1, catalog.limit)));
  const updateListFade = (node: HTMLDivElement) => {
    const remaining = node.scrollHeight - node.clientHeight - node.scrollTop;
    node.toggleAttribute("data-fade-bottom", remaining > 1);
    node.style.setProperty("--list-bottom-fade", (remaining <= 1 ? 0 : Math.min(28, remaining)) + "px");
  };
  const revealMoreContent = (node: HTMLDivElement) => {
    updateListFade(node);
    if (tab !== "mods" || node.scrollTop + node.clientHeight < node.scrollHeight - 110) return;
    if (browsingCatalog ? catalogLoading : !contentReady) return;
    const total = browsingCatalog ? catalog.items.length : pagedItems.length;
    // Scroll events during list replacement must never hide the initial batch.
    setRenderedItemCount(current => Math.max(current, Math.min(total, current + 10)));
  };
  const totalOnPage = browsingCatalog ? catalog.items.length : pagedItems.length;
  useEffect(() => {
    const list = contentListRef.current;
    if (!list) return;
    // A tall window can fit the initial batch without ever producing a scroll event.
    const fillViewport = () => {
      updateListFade(list);
      if (tab === "mods" && renderedItemCount < totalOnPage && (browsingCatalog ? !catalogLoading : contentReady)
          && list.clientHeight && list.scrollHeight <= list.clientHeight)
        setRenderedItemCount(count => Math.min(totalOnPage, count + 10));
    };
    const observer = new ResizeObserver(fillViewport);
    observer.observe(list);
    return () => observer.disconnect();
  }, [tab, worldsOpen, renderedItemCount, totalOnPage, browsingCatalog, catalogLoading, contentReady, contentPage, instance.id, search, filter]);
  const changeCatalogPage = (nextPage: number) => {
    if (tab === "settings") return;
    const cached = catalogMemoryCache.get(catalogCacheKey(tab, catalogGameVersion, search, nextPage, activeCatalogFilters));
    if (cached) { setCatalog(cached); setCatalogLoading(false); } else setCatalogLoading(true);
    setContentPage(nextPage);
  };
  const openCatalogProject = (item: CatalogItem) => {
    const section = tab === "mods" ? "mod" : tab === "resourcepacks" ? "resourcepack" : "shader";
    void openUrl(`https://modrinth.com/${section}/${encodeURIComponent(item.slug || item.projectId)}`);
  };
  const openCatalog = () => {
    if (tab === "mods" && !instance.loader.toLowerCase().includes("fabric")) { onMessage("The built-in mod catalog currently supports Fabric instances only."); return; }
    const cached = tab === "settings" ? undefined : catalogMemoryCache.get(catalogCacheKey(tab, catalogGameVersion, "", 1, activeCatalogFilters));
    if (cached) { setCatalog(cached); setCatalogLoading(false); } else setCatalogLoading(true);
    setSearch(""); setContentPage(1); setBrowsingCatalog(true);
  };
  const closeCatalog = () => { setBrowsingCatalog(false); setSearch(""); setContentPage(1);  void loadContent(); };
  const resetCatalogFilters = () => {
    setCatalogFilters(defaultCatalogFilters());
    setCatalogVersion(instance.version);
    setContentPage(1);
  };
  const updateContentSearch = (value: string) => {
    setSearch(value);
    setContentPage(1);
    if (!browsingCatalog || tab === "settings") return;
    const cached = catalogMemoryCache.get(catalogCacheKey(tab, catalogGameVersion, value, 1, activeCatalogFilters));
    if (cached) { setCatalog(cached); setCatalogLoading(false); } else setCatalogLoading(true);
  };
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
        onMessage(`Importing ${paths.length} ${itemLabel}${paths.length === 1 ? "" : "s"}…`);
        const importRequest = category === "mods"
          ? invoke<string[]>("import_instance_mod_files", { instanceId: instance.id, paths })
          : invoke<string[]>("import_instance_content_files", { instanceId: instance.id, category, paths });
        void importRequest
          .then((names) => { setBrowsingCatalog(false); setSearch(""); setContentPage(1); onMessage(`${names.length} ${itemLabel}${names.length === 1 ? "" : "s"} added to ${instance.name}.`); return loadContent(); })
          .catch((error) => onMessage(String(error), "error"));
      }
    }).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, [tab, instance.id]);
  const contentTabs: Array<[Exclude<InstanceTab, "settings">, string, typeof Puzzle]> = [["mods", "Mods", Puzzle], ["resourcepacks", "Resource packs", Layers3], ["shaderpacks", "Shaders", WandSparkles]];
  const openContentTab = (nextTab: Exclude<InstanceTab, "settings">) => {
    const cached = instanceContentMemoryCache.get(instanceContentCacheKey(instance.id, nextTab));
    setItems(cached || []);
    setContentReady(Boolean(cached));
    setTab(nextTab);
  };
  return <div className="instance-workspace">
    {draggingContent && <div className="content-drop-overlay" role="status" aria-label={`Drop files into ${categoryLabel}`}><FileDown className="content-drop-symbol" size={58} strokeWidth={1.75} aria-hidden="true" /></div>}
    <div className="desktop-breadcrumb"><Cuboid size={16} />Instances <ChevronRight size={13} /><strong>{instance.name}</strong></div>
    <section className="instance-hero-panel"><div className="instance-hero-main"><div className="instance-identity"><button className="instance-icon-picker" onClick={() => iconInput.current?.click()} aria-label="Change instance icon" title="Change instance icon">{instance.icon ? <img src={instance.icon} alt="" /> : <b className="instance-icon-fallback" aria-hidden="true">?</b>}<span aria-hidden="true"><ArrowRightLeft size={27} strokeWidth={2.4} /></span></button><input ref={iconInput} type="file" accept="image/png,image/jpeg" hidden onChange={event => chooseIcon(event.target.files?.[0])} /><div><h1 aria-label={instance.name}><InstanceName name={instance.name} onRename={onRename} disabled={savingSettings} /></h1><p>{instance.version} • {instance.loader}</p><small>{instance.directory}</small></div></div><div className="instance-hero-actions"><button className="instance-play" disabled={busy} onClick={() => onPlay()}><Play size={17} fill="currentColor" />Play</button><button className="instance-more desktop-open-folder" aria-label="Open instance folder" title="Open instance folder" onClick={() => void invoke("open_instance_folder", { instanceId: instance.id }).catch(error => onMessage(String(error), "error"))}><FolderOpen size={20} /></button><div className="instance-more-wrap"><button ref={instanceMenuTriggerRef} className="instance-more" aria-haspopup="dialog" aria-expanded={menuOpen} aria-label={`Actions for ${instance.name}`} onClick={() => setMenuOpen(value => !value)}><MoreHorizontal size={20} /></button>{menuOpen && createPortal(<div ref={instanceMenuRef} role="dialog" aria-label={`Actions for ${instance.name}`} className="select-menu select-menu-portal instance-folder-menu" style={{ ...closedDropdownStyle, position: "fixed", top: instanceMenuPosition.top, left: instanceMenuPosition.left, right: "auto", width: instanceMenuPosition.width, maxHeight: instanceMenuPosition.maxHeight }}>
      <button className="instance-menu-action" style={{ opacity: 0 }} onClick={() => { setMenuOpen(false); onPopOut(); }}><ExternalLink size={18} /><span><b>{floating ? "Put away floating controls" : "Pop out Play controls"}</b></span></button>
      <button className="instance-menu-action" style={{ opacity: 0 }} onClick={() => { setMenuOpen(false); void invoke("open_instance_folder", { instanceId: instance.id }); }}><FolderOpen size={18} /><span><b>Open folder</b></span></button>
      <button className="instance-menu-action" style={{ opacity: 0 }} onClick={() => { setMenuOpen(false); void invoke("open_instance_folder", { instanceId: instance.id, category: "mods" }); }}><PackageOpen size={18} /><span><b>Open mods folder</b></span></button>
      <span className="instance-menu-divider" />
      <button className="instance-menu-action described" style={{ opacity: 0 }} onClick={() => { setMenuOpen(false); onShare(); }}><Share2 size={18} /><span><b>Share instance</b></span></button>
      <button className="instance-menu-action described" style={{ opacity: 0 }} disabled={instanceMenuBusy !== null || busy} onClick={() => { setInstanceMenuBusy("duplicate"); void onDuplicate().finally(() => { setInstanceMenuBusy(null); setMenuOpen(false); }); }}><Copy size={18} /><span><b>{instanceMenuBusy === "duplicate" ? "Duplicating…" : "Duplicate instance"}</b></span></button>
      <button className="instance-menu-action" style={{ opacity: 0 }} onClick={() => { setWorldsOpen(false); setTab("settings"); setMenuOpen(false); }}><SettingsIcon size={18} /><span><b>Instance settings</b></span></button>
      <button className="instance-menu-action" style={{ opacity: 0 }} disabled={busy || instanceMenuBusy !== null} onClick={() => { setInstanceMenuBusy("export"); void onExport().catch(() => {}).finally(() => { setInstanceMenuBusy(null); setMenuOpen(false); }); }}><Download size={18} /><span><b>{instanceMenuBusy === "export" ? "Exporting…" : "Export ZIP"}</b></span></button>
      <span className="instance-menu-divider danger" />
      <button className={`instance-menu-action instance-menu-delete ${confirmInstanceDelete ? "confirm" : ""}`} style={{ opacity: 0 }} disabled={instanceMenuBusy !== null || busy} onClick={() => { if (!confirmInstanceDelete) { setConfirmInstanceDelete(true); return; } setInstanceMenuBusy("delete"); void onDelete().finally(() => { setInstanceMenuBusy(null); setMenuOpen(false); }); }}><Trash2 size={18} /><span><b>{instanceMenuBusy === "delete" ? "Deleting…" : confirmInstanceDelete ? "Delete instance and files?" : "Delete instance"}</b></span></button>
    </div>, document.body)}</div></div></div>
    <div className="instance-tabbar">
      <div className="instance-content-segments" role="tablist" aria-label="Instance content">
        {contentTabs.map(([id, label, Icon]) => <button key={id} className={!worldsOpen && tab === id ? "active" : ""} role="tab" data-ask-target={id} aria-selected={!worldsOpen && tab === id} onClick={() => { setWorldsOpen(false); openContentTab(id); }}><Icon size={16} aria-hidden="true" />{label}</button>)}
        <button className={worldsOpen ? "active" : ""} role="tab" aria-selected={worldsOpen} onClick={() => setWorldsOpen(true)}><Globe size={16} aria-hidden="true" />Worlds</button>
        <button className={!worldsOpen && tab === "settings" ? "active" : ""} role="tab" aria-label="Instance settings" aria-selected={!worldsOpen && tab === "settings"} onClick={() => { setWorldsOpen(false); setTab("settings"); }}><SettingsIcon size={16} aria-hidden="true" />Settings</button>
      </div>
    </div></section>
    {worldsOpen ? <InstanceWorlds instanceId={instance.id} busy={busy} onPlay={onPlay} /> : tab === "settings" ? (
      <section className="instance-manager settings-manager instance-preferences">
        <header className="instance-preferences-heading">
          <h2>Instance settings</h2>
          {groupRole && <span className="instance-role-badge">{groupRole === "editor" ? "Editor" : groupRole === "member" ? "Guest" : "Owner"}</span>}
          <button className="instance-preferences-save" disabled={savingSettings || !name.trim() || (busy && loaderVersion !== undefined)} onClick={() => void saveSettings()}>{savingSettings ? "Saving…" : "Save changes"}</button>
        </header>
        <fieldset className="instance-preferences-fields" disabled={savingSettings}>
          <div className="instance-preference-row">
            <label htmlFor="instance-display-name">Instance name</label>
            <input id="instance-display-name" value={name} onChange={event => setName(event.target.value)} />
            <InfoTip label="Instance name">The name shown in your instance list and on Home.</InfoTip>
          </div>
          {instance.loader.toLowerCase() === "fabric" && <FabricLoaderSetting instanceId={instance.id} minecraftVersion={instance.version} currentVersion={instance.loaderVersion} value={loaderVersion} onChange={setLoaderVersion} disabled={busy || savingSettings} busy={busy} />}
          <div className="instance-preference-row">
            <div className="instance-preference-label">Memory</div>
            <PercentSlider value={memory} onChange={setMemory} label="Minecraft memory" min={1024} max={16384} step={512} unit=" MB" />
            <InfoTip label="Minecraft memory">The maximum RAM Minecraft can use for this instance. Larger modpacks may need more. Leave enough RAM for your system and other apps; allocating more does not always improve performance.</InfoTip>
          </div>
          <div className="instance-preference-row">
            <div className="instance-preference-label">Java profile</div>
            <Select value={jvmPreset} options={["Default", "Performance", "Overdrive", "Custom"]} onChange={applyJvmPreset} />
            <InfoTip label="Java profile">Default uses launcher-managed Java settings. Performance uses conservative garbage-collection tuning. Overdrive is experimental and may use more memory or fail with incompatible Java versions. FPS gains are not guaranteed. Custom opens the argument editor.</InfoTip>
          </div>
          <details className="instance-java-advanced" open={advancedJvmOpen} onToggle={event => setAdvancedJvmOpen(event.currentTarget.open)}>
            <summary>Advanced Java options<ChevronDown size={17} /></summary>
            <div className="instance-java-editor">
              <div className="instance-java-editor-heading"><label htmlFor="instance-jvm-arguments">JVM arguments</label><button type="button" disabled={!jvmArguments || savingSettings} onClick={() => applyJvmPreset("Default")}>Reset to default</button><InfoTip label="JVM arguments">Extra flags passed to Java when this instance launches. Choosing a profile replaces these flags. Invalid or conflicting arguments can prevent launch. Reset to default clears the custom flags. Save changes applies your edits.</InfoTip></div>
              <textarea id="instance-jvm-arguments" value={jvmArguments} onChange={event => setJvmArguments(event.target.value)} placeholder="No custom arguments" spellCheck={false} />
            </div>
          </details>
        </fieldset>
      </section>
    ) : (
      <section className={`instance-manager ${browsingCatalog ? "catalog-manager" : ""}`}>
        <ContentToolbar key={`${instance.id}:${tab}`} category={categoryLabel}
          browsing={browsingCatalog}
          version={instance.version} loader={instance.loader} sort={sort} filter={filter}
          onSortChange={value => { setSort(value); setContentPage(1); }}
          onFilterChange={value => { setFilter(value); setContentPage(1); }}
          catalogFiltered={catalogFiltered}
          catalogControls={tab === "mods" ? <CatalogFilterControls value={catalogFilters} version={catalogVersion} instanceVersion={instance.version} changed={catalogFiltered}
            onChange={value => { setCatalogFilters(value); setContentPage(1); }} onVersion={value => { setCatalogVersion(value); setContentPage(1); }}
            onReset={resetCatalogFilters} /> : undefined}
          searchField={<div
            className={`content-search ${search ? "has-query" : ""}`}
            role="search"
          >
            <span className="content-search-mark" aria-hidden="true">
              <Search size={27} />
            </span>
            <input
              value={search}
              aria-label={browsingCatalog ? `Search Modrinth ${categoryLabel.toLowerCase()}` : `Search installed ${categoryLabel.toLowerCase()}`}
              onChange={event => updateContentSearch(event.target.value)}
              placeholder={browsingCatalog ? `Search Modrinth ${categoryLabel.toLowerCase()}...` : `Search ${categoryLabel.toLowerCase()}...`}
            />
            {search && <button type="button" className="content-search-clear" aria-label="Clear search" title="Clear search" onClick={() => updateContentSearch("")}><CloseIcon size={17} /></button>}
          </div>}
          onAdd={openCatalog} onBack={closeCatalog} />
        {!browsingCatalog && contentReady && visibleItems.length > 0 && <div className="desktop-content-columns" aria-hidden="true"><span>{categoryLabel}</span><span>Enabled</span></div>}
        <div className="instance-content-list-shell">
          <div ref={contentListRef} className="content-list" onScroll={event => revealMoreContent(event.currentTarget)}>
          {browsingCatalog ? (
            catalogLoading ? <CatalogLoadingState label={search ? "Searching Modrinth" : `Loading featured ${categoryLabel.toLowerCase()}`} /> : catalogError ? <ContentEmptyState title="Couldn’t load Modrinth results." description={catalogError} actions={<button onClick={() => setCatalogRetry(value => value + 1)}>Try again</button>} /> : catalog.items.length ? renderedCatalogItems.map(item => {
              const installed = catalogItemInstalled(item);
              const pending = pendingCatalogItems.has(catalogKey(item));
              const restriction = tab === "mods" ? catalogInstallRestriction(item, instance) : undefined;
              return <CatalogFeedRow key={item.projectId} title={item.title} icon={item.iconUrl} fallback={tab === "mods" ? <Puzzle size={22}/> : tab === "resourcepacks" ? <PackageOpen size={22}/> : <Cuboid size={22}/>} subtitle={`${item.versionNumber} • by ${item.author}`} loader={item.loader} detail={formatBytes(item.fileSize)} installed={installed} pending={pending} restriction={restriction} detailLabel={tab === "mods" ? undefined : `View ${item.title} on Modrinth`} openDetails={() => tab === "mods" ? showCatalogModDetails(item) : openCatalogProject(item)} openProject={() => openCatalogProject(item)} install={() => void queueCatalogInstall(item)}/>;
            }) : <ContentEmptyState
              title={search ? `No ${categoryLabel.toLowerCase()} match “${search}”.` : activeCatalogFilters ? "No mods match these filters." : `No ${categoryLabel.toLowerCase()} for Minecraft ${catalogGameVersion}.`}
              actions={(search || activeCatalogFilters) && <>
                {search && <button onClick={() => updateContentSearch("")}>Clear search</button>}
                {activeCatalogFilters && <button onClick={resetCatalogFilters}>Reset filters</button>}
              </>}
            />
          ) : !contentReady ? <CatalogLoadingState label={`Loading ${categoryLabel.toLowerCase()}`} /> : contentError ? <ContentEmptyState
            title={`Couldn’t load ${categoryLabel.toLowerCase()}.`} description={contentError}
            actions={<button onClick={() => void loadContent()}>Try again</button>}
          /> : visibleItems.length ? renderedInstalledItems.map(item => <div className="content-item installed-content-item instance-list-row" key={item.id}>
            <button type="button" className="content-detail-hitarea" draggable={false} onDragStart={event => event.preventDefault()} onPointerDown={event => contentTransfer.start(event, { ...item, sourceId: instance.id, category: tab })} onClick={() => { if (tab === "mods") showInstalledModDetails(item); }} aria-label={tab === "mods" ? `Open details for ${item.name}` : `${item.name}; drag to another instance to copy`}>
            <span className="content-icon"><CatalogArtwork source={packArtwork[item.fileName]} embedded={item.icon}
              fallback={tab === "mods" ? <Puzzle size={22} /> : tab === "shaderpacks" ? <Cuboid size={22} /> : <PackageOpen size={22} />} /></span>
            <div className="content-name">
              <b>{item.name}</b>
              <small className="content-metadata">
                <span>{item.version || item.fileName}</span>
                <i aria-hidden="true" />
                <span>{tab === "mods" ? instance.loader : tab === "resourcepacks" ? "Minecraft" : "Shader"}</span>
                <i aria-hidden="true" />
                <span>{formatBytes(item.size)}</span>
              </small>
            </div>
            </button>
            <div className="content-row-actions">
              <Toggle value={item.enabled} onChange={value => void toggleItem(item, value)} />
              <InstanceContentActions item={item} category={tab} onDelete={() => deleteItem(item)} onCopy={() => contentTransfer.choose({ ...item, sourceId: instance.id, category: tab })} />
            </div>
          </div>) : items.length ? <ContentEmptyState
            title={search ? `No ${categoryLabel.toLowerCase()} match “${search}”.` : `No ${filter.toLowerCase()} ${categoryLabel.toLowerCase()}.`}
            actions={<>
              {search && <button onClick={() => updateContentSearch("")}>Clear search</button>}
              {filter !== "All" && <button onClick={() => { setFilter("All"); setContentPage(1); }}>Reset filters</button>}
            </>}
          /> : <ContentEmptyState
            title={`No ${categoryLabel.toLowerCase()} yet.`}
            description={tab !== "mods" ? "Drop a ZIP file here to add it." : instance.loader.toLowerCase() === "fabric" ? "Drop a mod JAR here to add it." : undefined}
            actions={<>
              {(tab !== "mods" || instance.loader.toLowerCase().includes("fabric")) && <button onClick={openCatalog}><Search size={15} />Browse Modrinth</button>}
              <button onClick={() => void invoke("open_instance_folder", { instanceId: instance.id, category: tab }).catch(error => onMessage(String(error), "error"))}><FolderOpen size={15} />Open folder</button>
            </>}
          />}
          </div>
        </div>
        {browsingCatalog
          ? catalog.total > catalog.limit && <PaginationControls page={contentPage} pages={catalogPages} busy={catalogLoading} onPage={changeCatalogPage} />
          : visibleItems.length > 50 && <PaginationControls page={safePage} pages={pageCount} onPage={setContentPage} />}


        {modDrawer && <ModDetailDrawer
          key={modDrawer.key}
          selection={modDrawer}
          details={modDrawerDetails}
          loading={modDrawerLoading}
          error={modDrawerError}
          actionPending={Boolean(modDrawer.projectId && pendingCatalogItems.has(`mods:${modDrawer.projectId}`))}
          onClose={() => setModDrawer(null)}
          onOpenSource={modDrawer.projectUrl ? () => void openUrl(modDrawer.projectUrl!) : undefined}
          onAction={() => {
            if (!modDrawer.projectId) return;
            const selected = catalog.items.find(item => item.projectId === modDrawer.projectId);
            if (selected) void queueCatalogInstall(selected);
          }}
        />}
      </section>
    )}
  </div>;
}

type DownloadTaskKind = "mod" | "resourcepack" | "shaderpack" | "game";
type DownloadViewState = { completedAt?: number; launch?: boolean; active: boolean; progress: number; state: string; message: string; instanceId?: string; downloadedBytes?: number; totalBytes?: number; bytesPerSecond?: number; taskName?: string; taskVersion?: string; taskKind?: DownloadTaskKind; taskIcon?: string };
type LogEntry = { id: string; instanceId: string; instanceName: string; stream: string; level: "info" | "warn" | "error"; message: string; timestamp: number };

function LogsPage({ entries, running, onClear, onShare }: { onShare?: () => void; entries: LogEntry[]; running: boolean; onClear: () => void }) {
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
    <header className="logs-heading"><div><h1>Live Logs</h1></div><span className={`logs-live ${running ? "active" : ""}`}><i />{running ? "Live session" : "Console idle"}</span></header>
    <section className="log-stats">
      <div><small>Session output</small><b>{entries.length.toLocaleString()} lines</b></div>
      <div><small>Warnings</small><b>{warnings}</b></div>
      <div><small>Errors</small><b>{errors}</b></div>
      <div><small>Session time</small><b>{first && last ? `${Math.max(0, Math.round((last - first) / 1000))}s` : "—"}</b></div>
    </section>
    <section className="console-shell">
      <div className="console-toolbar"><div className="console-title"><TerminalSquare size={16} /><span>Minecraft Console</span><em>{filtered.length} visible</em></div><div className="console-actions">{onShare && <button onClick={onShare}>Share crash details</button>}<button onClick={copyLogs}><Clipboard size={15} />Copy</button><button onClick={onClear}><Trash2 size={15} />Clear</button></div></div>
      <div className="console-filter"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search console output" placeholder="Search console output…" /><Select ariaLabel="Log level" value={level} options={["All levels", "Info", "Warn", "Error"]} onChange={setLevel} /></div>
      <div className="console-output">
        {filtered.length ? filtered.map(entry => <div className={`console-line ${entry.level}`} key={entry.id}><time>{new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}</time><span className="console-level">{entry.level}</span><span className="console-instance">{entry.instanceName}</span><code>{entry.message}</code></div>) : <div className="console-empty"><TerminalSquare size={25} /><b>{entries.length ? "No matching log entries" : "No log output yet"}</b>{entries.length ? <button onClick={() => { setSearch(""); setLevel("All levels"); }}>Clear filters</button> : <span>Launch an instance to see its console output.</span>}</div>}
        <div ref={consoleEnd} />
      </div>

    </section>
  </div>;
}
type CompletedDownload = { id: string; name: string; version: string; loader?: string; targetName?: string; kind?: DownloadTaskKind; iconUrl?: string; completedAt: number };

function normalizeCompletedDownloads(records: CompletedDownload[]): CompletedDownload[] {
  const result: CompletedDownload[] = [];
  const recentLegacy = new Map<string, number>();
  for (const item of [...new Map(records.map(item => [item.id, item])).values()].sort((a, b) => b.completedAt - a.completedAt)) {
    // Old game completions used instanceId + a UI timestamp. Multiple observers
    // could save one terminal event a few milliseconds apart.
    const legacy = item.kind === "game" && /^(.*)-(\d{13})$/.exec(item.id);
    if (legacy && Math.abs(Number(legacy[2]) - item.completedAt) <= 1) {
      const newest = recentLegacy.get(legacy[1]);
      if (newest !== undefined && newest - item.completedAt <= 150) continue;
      recentLegacy.set(legacy[1], item.completedAt);
    }
    result.push(item);
  }
  return result.slice(0, 50);
}

function readCompletedDownloads(): CompletedDownload[] {
  try {
    const records = JSON.parse(localStorage.getItem("bloom-completed-downloads") || "[]");
    if (!Array.isArray(records)) return [];
    return normalizeCompletedDownloads(records.filter(item => item && typeof item.id === "string" && Number.isFinite(item.completedAt)));
  } catch { return []; }
}


function DownloadArtwork({ source, progress }: { source: string; progress?: number }) {
  const [image, setImage] = useState(source);
  useEffect(() => {
    let current = true;
    setImage(source);
    if (source.startsWith("data:")) return;
    void invoke<string | null>("get_cached_catalog_artwork", { sourceUrl: source })
      .then(cached => { if (current && cached) setImage(cached); })
      .catch(() => {});
    return () => { current = false; };
  }, [source]);
  const percent = progress === undefined ? 100 : Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  return <span className={`download-artwork ${progress === undefined ? "" : "download-artwork-progress"}`} aria-hidden="true"><img src={image} alt="" />{progress !== undefined && <img className="download-artwork-fill" src={image} alt="" style={{ clipPath: `inset(${100 - percent}% 0 0)` }} />}</span>;
}

const formatBytes = (bytes = 0) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;

type InstanceLibraryDestination = "view" | "add-mods" | InstanceTab;

function instanceLaunchProgress(activity: DownloadViewState, instanceId: string) {
  if (!activity.launch || !activity.active || activity.instanceId !== instanceId || !["installing", "launching"].includes(activity.state)) return null;
  return Math.min(100, Math.max(0, Math.round(activity.progress) || 0));
}

function LaunchFill({ activity, instanceId }: { activity: DownloadViewState; instanceId: string }) {
  const progress = instanceLaunchProgress(activity, instanceId);
  if (progress === null) return null;
  return <span className="instance-launch-fill" role="progressbar" aria-label="Launching Minecraft" aria-valuenow={progress}
    style={{ clipPath: `inset(0 0 0 ${progress}%)` }} />;
}

function InstanceSidebar({ instances, selectedId, activity, onCancelLaunch, transferring, onCreate, onOpen }: {
  instances: InstanceDraft[]; selectedId?: string; activity: DownloadViewState; onCancelLaunch: () => void; transferring: boolean;
  onCreate: () => void; onOpen: (instance: InstanceDraft) => void;
}) {
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [query, setQuery] = useState("");
  const [loader, setLoader] = useState("All");
  const filtered = instances.filter(item => (loader === "All" || item.loader === loader) && item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const grouped = organizing && !transferring;
  const row = (item: InstanceDraft, organize?: () => void) => {
    const progress = instanceLaunchProgress(activity, item.id);
    return <div key={item.id} className="desktop-instance-link" data-launching={progress !== null || undefined} data-content-drop-id={item.id} data-content-drop-name={item.name}>
      <button className="instance-nav-name" data-folder-drag-handle={grouped || undefined} title={item.name} aria-current={selectedId === item.id ? "page" : undefined}
        onClick={() => onOpen(item)}>
        {item.icon ? <img src={item.icon} alt="" draggable={false} /> : <Cuboid size={17} />}<span>{item.name}</span>
      </button>
      {progress !== null ? <>
        <button className="instance-row-action launch-cancel" aria-label={`Cancel launch of ${item.name}`} title="Cancel launch" onClick={onCancelLaunch}><CloseIcon size={15} /></button>
        <span className="instance-launch-progress" role="progressbar" aria-label="Launching Minecraft" aria-valuenow={progress}>
          <i style={{ width: `${progress}%` }} />
        </span>
      </> : organize ? <button className="instance-row-action" aria-label={`Move ${item.name} to folder`} title="Move to folder" onClick={organize}><FolderInput size={15} /></button> : null}
    </div>;
  };
  return <section className="instance-navigation" aria-label="Instance library" data-ask-target="instances">
    <button className="desktop-create" onClick={onCreate}><Plus size={17} />New instance</button>
    <div className="instance-nav-heading">
      <h2>Instances</h2>
      <button ref={filterTrigger} aria-label="Filter instances" title="Filter instances" aria-haspopup="menu" aria-controls={filterOpen ? "instance-library-filters" : undefined} aria-expanded={filterOpen} data-filtered={Boolean(query || loader !== "All")} onClick={() => setFilterOpen(value => !value)}><SlidersHorizontal size={15} /></button>
      <button aria-label="Organize folders" title="Organize folders" aria-pressed={organizing} onClick={() => setOrganizing(!organizing)}><FolderOpen size={15} /></button>
    </div>
    {filterOpen && <FilterMenu anchor={filterTrigger} id="instance-library-filters" title="Filter instances" onClose={() => setFilterOpen(false)}><div className="instance-nav-filters">
      <label><Search size={15} /><input autoFocus aria-label="Search instances" placeholder="Search instances…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <FilterSection label="Mod loader" value={loader} options={["All", ...new Set(instances.map(item => item.loader))]} onChange={setLoader} />
      <FilterReset disabled={!query && loader === "All"} onReset={() => { setQuery(""); setLoader("All"); }} />
    </div></FilterMenu>}
    {grouped ? <>
      <button className="instance-folder-create" onClick={() => setCreatingFolder(true)}><FolderPlus size={16} />New folder</button>
      <InstanceFolders instances={instances} query={query} loader={loader} createOpen={creatingFolder} onCloseCreate={() => setCreatingFolder(false)} renderInstance={row} />
    </> : <div className="instance-nav-list" role="navigation" aria-label="Your instances">
      {(transferring ? instances : filtered).map(item => row(item))}
      {instances.length > 0 && !filtered.length && !transferring && <p>No matching instances</p>}
    </div>}
  </section>;
}

function ContentDownloadRow({ task, position, onCancel, onDismiss }: { task: ContentDownload; position?: number; onCancel: (id: string) => void; onDismiss: (id: string) => void }) {
  const pending = contentPending(task);
  const queued = task.state === "queued";
  const active = task.state === "installing" || task.state === "cancelling";
  return <div className={`download-task content-download-task ${task.state === "error" ? "failed-task" : ""}`} data-task-id={task.id} data-state={task.state}>
    <span className={`download-task-icon ${task.iconUrl ? "has-artwork" : ""}`}>{task.iconUrl ? <DownloadArtwork source={task.iconUrl} progress={active ? task.progress : undefined} /> : task.category === "mods" ? <Puzzle size={24} /> : task.category === "resourcepacks" ? <PackageOpen size={24} /> : <Cuboid size={24} />}</span>
    <div className="download-task-main"><div className="download-task-title"><div><b>{task.title}</b><small>{task.version} • {active ? "Installing to" : "For"} {task.instanceName}</small></div>{active && <span>{task.progress}%</span>}</div>
      {active && <div className="download-linear" role="progressbar" aria-label={`${task.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress}><i style={{ width: `${task.progress}%` }} /></div>}
      {(task.state === "error" || task.state === "cancelled") && <small className="content-download-error">{userError(task.message)}</small>}
    </div>
    {active && task.totalBytes > 0 && <div className="download-metrics"><span>{formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes)}</span><small>{task.bytesPerSecond ? `${formatBytes(task.bytesPerSecond)}/s` : ""}</small></div>}
    <div className="download-task-status"><b>{queued ? `Queued · ${position}` : task.state === "cancelling" ? "Cancelling…" : task.state === "error" ? "Failed" : task.state === "cancelled" ? "Cancelled" : "Downloading"}</b>{active && <small title={task.message}>{task.message}</small>}</div>
    <button className="cancel-download" disabled={task.state === "cancelling"} onClick={() => pending ? onCancel(task.id) : onDismiss(task.id)} aria-label={`${pending ? "Cancel" : "Dismiss"} ${task.title}`} title={pending ? (queued ? "Remove from queue" : "Cancel this download") : "Dismiss"}><CloseIcon size={17} /></button>
  </div>;
}

type DownloadSection = "Downloading" | "Queued" | "Completed" | "Stopped";

function DownloadsPage({ section, download, contentTasks, onCancelContent, onDismissContent, instances, completed, missingMods, motion, onClear, onCancel, onDismissMissing }: { section: DownloadSection; contentTasks: ContentDownload[]; onCancelContent: (id: string) => void; onDismissContent: (id: string) => void; motion: boolean; download: DownloadViewState; instances: InstanceDraft[]; completed: CompletedDownload[]; missingMods: string[]; onClear: (ids: string[]) => void; onCancel: () => void; onDismissMissing: () => void }) {
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("All types");
  const queryText = query.trim().toLowerCase();
  const matches = (label: string, type: string) => (kind === "All types" || kind === type) && label.toLowerCase().includes(queryText);
  const types = { game: "Minecraft", mod: "Mods", resourcepack: "Resource packs", shaderpack: "Shaders" } as const;
  const filteredTasks = contentTasks.filter(task => matches(`${task.title} ${task.instanceName} ${task.version}`, types[contentKind(task)]));
  const history = completed.filter(item => matches(`${item.name} ${item.targetName || ""} ${item.version}`, types[item.kind || "game"]));
  const isFiltered = Boolean(queryText) || kind !== "All types";
  const activeInstance = instances.find(instance => instance.id === download.instanceId);
  const gameTask = !download.taskKind || download.taskKind === "game";
  const activeArtwork = download.taskIcon || (gameTask ? activeInstance?.icon : undefined);
  const failed = download.state === "error";
  const status = failed ? "Failed" : download.state === "launching" ? "Starting" : download.state === "running" ? "Ready" : download.state === "complete" ? "Completed" : "Downloading";
  const activeContent = filteredTasks.filter(task => task.state === "installing" || task.state === "cancelling");
  const queuedContent = contentTasks.filter(task => task.state === "queued")
    .map((task, index) => ({ task, position: index + 1 }))
    .filter(({ task }) => matches(`${task.title} ${task.instanceName} ${task.version}`, types[contentKind(task)]));
  const stoppedContent = filteredTasks.filter(task => task.state === "error" || task.state === "cancelled");
  const gameVisible = !download.launch && (download.active || failed) && matches(`${download.taskName || "Minecraft"} ${activeInstance?.name || ""}`, types[download.taskKind || "game"]);
  const contentRow = (task: ContentDownload, position?: number) => <ContentDownloadRow key={task.id} task={task} position={position} onCancel={onCancelContent} onDismiss={onDismissContent} />;
  return <div className="downloads-page">
    <header className="downloads-heading"><h1>{section}</h1>
      <div className="download-search-tools">{section === "Completed" && <button className="clear-history-button" form="clear-download-history" type="submit" disabled={!history.length}><Trash2 size={15}/>{isFiltered ? "Clear results" : "Clear completed"}</button>}<label className="download-search"><Search size={18}/><input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search downloads" placeholder="Search downloads…"/></label>
        <button ref={filterTrigger} type="button" className="download-filter-trigger" aria-haspopup="menu" aria-expanded={filtersOpen} aria-controls={filtersOpen ? "download-type-filters" : undefined} data-filtered={kind !== "All types"} onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={16}/>Filter</button>
        {filtersOpen && <FilterMenu anchor={filterTrigger} id="download-type-filters" title="Filter downloads" onClose={() => setFiltersOpen(false)}>
          <FilterSection label="Download type" value={kind} options={["All types", ...Object.values(types)]} onChange={setKind} />
          <FilterReset disabled={kind === "All types"} onReset={() => setKind("All types")} />
        </FilterMenu>}</div>
    </header>
    {missingMods.length > 0 && <section className="missing-mods-panel" aria-labelledby="missing-mods-title">
      <div className="missing-mods-heading"><div><h2 id="missing-mods-title">Find these mods</h2><span>{missingMods.length} not available through Modrinth</span></div><button onClick={onDismissMissing} aria-label="Dismiss missing mods" title="Dismiss"><CloseIcon size={18} /></button></div>
      <div className="missing-mods-list">{missingMods.map(fileName => <span key={fileName}>{fileName}</span>)}</div>
    </section>}
    <div className="download-list" aria-label={section + " downloads"}>
      {(section === "Downloading" || section === "Stopped") && <>
      {gameVisible && (failed ? section === "Stopped" : section === "Downloading") && <div className={`download-task active-task ${failed ? "failed-task" : ""}`}>
        <span className={`download-task-icon ${activeArtwork ? "has-artwork" : ""}`}>{activeArtwork ? <DownloadArtwork source={activeArtwork} progress={download.state === "complete" || download.state === "running" ? 100 : download.progress} /> : gameTask ? <b className="instance-icon-fallback" aria-hidden="true">?</b> : download.taskKind === "mod" ? <Puzzle size={24} /> : download.taskKind === "resourcepack" ? <PackageOpen size={24} /> : <Cuboid size={24} />}</span>
        <div className="download-task-main"><div className="download-task-title"><div><b>{download.taskName || activeInstance?.name || "Minecraft"}</b><small>{download.taskKind && download.taskKind !== "game" ? `${download.taskVersion || (download.taskKind === "mod" ? "Fabric mod" : download.taskKind === "resourcepack" ? "Resource pack" : "Shader")} • Installing to ${activeInstance?.name || "instance"}` : activeInstance ? `${activeInstance.version} • ${activeInstance.loader}` : "Preparing instance"}</small></div><span>{Math.round(download.progress)}%</span></div><div className="download-linear"><i style={{ width: `${download.progress}%` }} /></div></div>
        <div className="download-metrics"><span>{failed ? "Task stopped" : download.totalBytes ? `${formatBytes(download.downloadedBytes)} / ${formatBytes(download.totalBytes)}` : "Scanning files"}</span><small>{failed ? "See error" : download.bytesPerSecond ? `${formatBytes(download.bytesPerSecond)}/s` : "Calculating speed"}</small></div>
        <div className="download-task-status"><b>{status}</b><small title={download.message}>{download.message || "Preparing files"}{download.message === "Loading assets" && <i className="loading-dots" />}</small></div>{["installing", "launching"].includes(download.state) && <button className="cancel-download" onClick={onCancel} aria-label="Cancel task" title="Cancel download"><CloseIcon size={17} /></button>}
      </div>}
      {section === "Downloading" ? activeContent.map(task => contentRow(task)) : stoppedContent.map(task => contentRow(task))}
      {section === "Downloading" && !activeContent.length && !(gameVisible && !failed) && <p className="downloads-list-empty" role="status">{isFiltered ? "No matching active downloads" : "No active downloads"}</p>}
      {section === "Stopped" && !stoppedContent.length && !(gameVisible && failed) && <p className="downloads-list-empty" role="status">{isFiltered ? "No matching stopped downloads" : "No stopped downloads"}</p>}
      </>}
      {section === "Queued" && (queuedContent.length ? queuedContent.map(({ task, position }) => contentRow(task, position)) : <p className="downloads-list-empty" role="status">{isFiltered ? "No matching queued downloads" : "The queue is empty."}</p>)}
      {section === "Completed" && <DownloadHistory items={history} filtered={isFiltered} motion={motion} onClear={() => onClear(history.map(item => item.id))} renderItem={item => <div className="download-task completed-task">
        <span className={`download-task-icon ${item.iconUrl ? "has-artwork" : ""}`}>{item.iconUrl ? <DownloadArtwork source={item.iconUrl} /> : (!item.kind || item.kind === "game") ? <b className="instance-icon-fallback" aria-hidden="true">?</b> : item.kind === "mod" ? <Puzzle size={22} /> : item.kind === "resourcepack" ? <PackageOpen size={22} /> : <Cuboid size={22} />}</span><div className="download-task-main"><b>{item.name}</b><small>{item.kind && item.kind !== "game" ? `${item.version} • Installed to ${item.targetName}` : `${item.version} • ${item.loader || "Vanilla"}`}</small></div><span className="completed-time">Completed {new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-Math.max(1, Math.round((Date.now() - item.completedAt) / 60000)), "minute")}</span><button type="button" className="remove-history" aria-label={`Remove ${item.name} from history`} title="Remove from history" onClick={() => onClear([item.id])}><Trash2 size={17}/></button>
      </div>} />}
    </div>
  </div>;
}

function SpotlightInstanceSelect({ instances, selected, onSelect, activity }: {
  instances: InstanceDraft[]; selected: InstanceDraft; activity: DownloadViewState; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const position = useLauncherMenu(open, setOpen, trigger, panel, 250, false, undefined, instances.length);
  useLayoutEffect(() => {
    if (open) panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }, [open]);
  const toggle = () => { setOpen(!open); };
  return <div className="spotlight-instance-picker">
    <button ref={trigger} className="spotlight-select-trigger" aria-label={`Choose instance: ${selected.name}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={toggle} onKeyDown={event => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); toggle(); } }}>
      <span>Switch instance</span><ChevronDown size={15} />
    </button>
    <LaunchFill activity={activity} instanceId={selected.id} />
    {open && createPortal(<div ref={panel} role="dialog" aria-label="Choose instance" className="select-menu select-menu-portal launcher-instance-picker"
      style={{ position: "fixed", ...position, right: "auto" }}>
      <div className="picker-choices">{instances.map(item => <button key={item.id} title={item.version + " · " + item.loader} aria-pressed={item.id === selected.id}
        onClick={() => { onSelect(item.id); setOpen(false); trigger.current?.focus(); }}>
        {item.icon ? <img src={item.icon} alt="" /> : <Cuboid size={23}/>}<span>{item.name}</span>
        {item.id === selected.id && <Check size={18}/>}
      </button>)}</div>
    </div>, document.body)}
  </div>;
}

function SpotlightHome({
  activity, instances, running,
  selectedId,
  busy,
  onSelect,
  onPlay,
  onCreate,
  onMods,
}: {
  activity: DownloadViewState;
  running: boolean;
  instances: InstanceDraft[];
  selectedId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onPlay: (instance: InstanceDraft) => void;
  onCreate: () => void;
  onMods: (instance: InstanceDraft) => void;
}) {
  const selected = instances.find(instance => instance.id === selectedId) || instances[0] || null;
  return (
    <section className="home-launch" aria-label="Launch Minecraft">
      <div className="winter-lights" aria-hidden="true" />
      {selected ? <div className="home-launch-stack">
        <button className="home-instance-art" onClick={() => onMods(selected)} aria-label={`Manage ${selected.name}`}>
          <img src={selected.icon || "/delight-logo.png"} alt="" />
        </button>
        <h1>{selected.name}</h1><p>{selected.version} · {selected.loader}</p>
        <PixelPlayButton disabled={busy} onClick={() => onPlay(selected)}
          running={running && activity.instanceId === selected.id}
          progress={activity.active && activity.launch && activity.instanceId === selected.id && ["installing", "launching"].includes(activity.state) ? activity.progress : undefined}/>
        <SpotlightInstanceSelect activity={activity} instances={instances} selected={selected} onSelect={onSelect}/>
      </div> : <button className="home-create-instance" onClick={onCreate}><Plus size={18}/>Create an instance</button>}
    </section>
  );
}

export function App() {
  const [requestedPage, navigate] = useState<AppPage>(
    (() => {
      try {
        const saved = { ...defaults, ...JSON.parse(localStorage.getItem("bloom-settings") || "{}") } as SettingsState;
        if (saved.startupBehavior === "Open Settings") return "settings";
        if (saved.startupBehavior === "Remember last page") {
          const remembered = localStorage.getItem("bloom-last-page");
          const validPages: AppPage[] = ["alula", "portal", "home", "settings", "utilities", "social", "screenshots", "new-instance", "downloads", "logs", "instance", "instances", "locker"];
          return validPages.includes(remembered as AppPage) ? remembered as AppPage : "home";
        }
      } catch {}
      return "home";
    })(),
  );
  const [instances, setInstances] = useState<InstanceDraft[]>([]);
  const [playedIds, setPlayedIds] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(RECENT_PLAY_STORAGE_KEY) ?? "[]");
      return Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === "string"))] : [];
    } catch { return []; }
  });
  useEffect(() => {
    localStorage.setItem(RECENT_PLAY_STORAGE_KEY, JSON.stringify(playedIds));
  }, [playedIds]);
  const railInstances = useMemo(() => {
    const library = new Map(instances.map(instance => [instance.id, instance]));
    const ordered: InstanceDraft[] = [];
    for (const id of playedIds) {
      const instance = library.get(id);
      if (!instance) continue;
      ordered.push(instance);
      library.delete(id);
      if (ordered.length === 5) return ordered;
    }
    const remaining = [...library.values()].sort((a, b) => (b.lastGameLogMs ?? 0) - (a.lastGameLogMs ?? 0));
    return ordered.concat(remaining.slice(0, 5 - ordered.length));
  }, [instances, playedIds]);
  const [packMemberships, setPackMemberships] = useState<Map<string, PackChannelRole>>(() => new Map());
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [shareInstance, setShareInstance] = useState<InstanceDraft | null>(null);
  const [floatingInstanceId, setFloatingInstanceId] = useState<string | null>(null);
  const [instanceNavigationKey, setInstanceNavigationKey] = useState(0);
  const [alulaSidebar, setAlulaSidebar] = useState<HTMLDivElement | null>(null);
  const [socialSidebar, setSocialSidebar] = useState<HTMLDivElement | null>(null);
  const [socialDestination, setSocialDestination] = useState<SocialDestination>();
  const [instanceDestination, setInstanceDestination] = useState<InstanceLibraryDestination>("view");
  const [libraryState, setLibraryState] = useState<"loading" | "ready" | "error">("loading");
  const [libraryError, setLibraryError] = useState("");
  const instanceRoute = requestedPage === "instances" || requestedPage === "instance";
  const selectedInstance = instances.find(item => item.id === selectedInstanceId) ?? instances[0];
  const page = instanceRoute
    ? selectedInstance ? "instance" : libraryState === "ready" ? "new-instance" : "instances"
    : requestedPage;
  const [creationEntry, setCreationEntry] = useState({ step: "source" as "source" | "file", revision: 0 });
  const [alulaOrigin, setAlulaOrigin] = useState<AppPage>("home");
  const setPage = (next: AppPage, entry: "source" | "file" = "source") => {
    if (next === "alula" && page !== "alula") setAlulaOrigin(page);
    if (next === "new-instance" || next === "instances") {
      setCreationEntry(previous => ({ step: entry, revision: previous.revision + 1 }));
    }
    if (next === "instances") {
      setInstanceNavigationKey(value => value + 1);
      setSelectedInstanceId(instances[0]?.id ?? null);
      setInstanceDestination("view");
    }
    navigate(next);
  };
  useEffect(() => {
    if (instanceRoute && selectedInstance && selectedInstance.id !== selectedInstanceId) setSelectedInstanceId(selectedInstance.id);
  }, [instanceRoute, selectedInstance, selectedInstanceId]);
  const workspace = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const main = workspace.current;
    if (!main) return;
    main.scrollTop = 0;
    if (document.documentElement.dataset.animations === "on" && document.documentElement.dataset.performance !== "ultra" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const transition = waapi.animate(main, { opacity: [0.86, 1], duration: 120, ease: "outQuad" });
      return () => { transition.cancel(); };
    }
  }, [page, selectedInstance?.id]);
  const instanceOpenTimers = useRef(new Map<string, number>());
  const [spotlightInstanceId, setSpotlightInstanceId] = useState<string | null>(() => localStorage.getItem("bloom-spotlight-instance"));
  const [gameDownload, setDownload] = useState<DownloadViewState>({
    active: false,
    progress: 0,
    state: "idle",
    message: "",
  });
  const [completedDownloads, setCompletedDownloads] = useState<CompletedDownload[]>(readCompletedDownloads);
  const [sharedPackMissingMods, setSharedPackMissingMods] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem("bloom-shared-pack-missing-mods") || "[]"); return Array.isArray(value) ? value.filter(item => typeof item === "string") : []; } catch { return []; } });
  const lastCompletedTask = useRef("");
  const legacyInstallingInstance = useRef<string | undefined>(undefined);
  const [ringProgress, setRingProgress] = useState(0);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [gameRunning, setGameRunning] = useState(false);
  const launchRequestPending = useRef(false);
  const [toast, setToast] = useState("");
  const toolToastTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(toolToastTimer.current), []);
  const [toastKind, setToastKind] = useState<"notification" | "error">("notification");
  const addCompletedDownloads = (additions: CompletedDownload[]) => {
    // Persist before acknowledging a native snapshot, including bursts batched by React.
    const saved = readCompletedDownloads();
    const next = normalizeCompletedDownloads([...saved, ...additions]);
    localStorage.setItem("bloom-completed-downloads", JSON.stringify(next));
    setCompletedDownloads(next);
  };
  const [availableUpdate, setAvailableUpdate] = useState<TauriUpdate | null>(null);
  const [currentVersion, setCurrentVersion] = useState(bundledVersion);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updatePanelOpen, setUpdatePanelOpen] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<"ready" | "downloading" | "installing" | "error">("ready");
  const [updateProgress, setUpdateProgress] = useState<number | undefined>(undefined);
  const [updateError, setUpdateError] = useState("");
  const [mockUpdateActive, setMockUpdateActive] = useState(false);
  const updateCheckStarted = useRef(false);
  const updateDialog = useRef<HTMLDialogElement>(null);
  const mockUpdateInterval = useRef<number | null>(null);
  const mockInstallTimer = useRef<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [crashPreview, setCrashPreview] = useState<{ initial: string; context: AlulaContext }>();
  const failure = logs.filter(entry => entry.stream === "launcher" && /-(launch-error|invoke-error)$/.test(entry.id)).at(-1);
  function previewFailure() {
    if (!failure) return;
    const instance = instances.find(item => item.id === failure.instanceId);
    const loader = instance?.loader.toLowerCase();
    setCrashPreview({ initial: crashSummary(failure, logs, instance), context: {
      build: currentVersion.split(/[+-]/)[0], platform: /Mac/i.test(navigator.platform) ? "macos" : /Win/i.test(navigator.platform) ? "windows" : "linux",
      page: "other", loader: loader === "fabric" || loader === "vanilla" ? loader : null,
    } });
  }
  const [signInOpen, setSignInOpen] = useState(false);
  const [profile, setProfile] = useState<MinecraftProfile | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("bloom-profile") || "null");
    } catch {
      return null;
    }
  });
  const [onboardingOpen, setOnboardingOpen] = useState(() =>
    localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY) !== "complete"
      && !localStorage.getItem("bloom-profile"),
  );
  const [accountHydrated, setAccountHydrated] = useState(() =>
    localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY) === "complete"
      || Boolean(localStorage.getItem("bloom-profile")),
  );
  const [profileIcon, setProfileIcon] = useState<string | null>(() => localStorage.getItem(PROFILE_ICON_STORAGE_KEY));
  const accountMenu = useRef<HTMLDivElement>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const signingOut = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true");
  const [accounts, setAccounts] = useState<MinecraftProfile[]>([]);
  const [accountChoicesOpen, setAccountChoicesOpen] = useState(false);
  useEffect(() => { if (!profileMenuOpen) setAccountChoicesOpen(false); }, [profileMenuOpen]);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [downloadSection, setDownloadSection] = useState<DownloadSection>("Downloading");
  const [settingsTarget, setSettingsTarget] = useState("Appearance");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [addAccount, setAddAccount] = useState(false);
  const [settingsNavigationKey, setSettingsNavigationKey] = useState(0);
  const [settings, setSettings] = useState<SettingsState>(() => {
    try {
      localStorage.removeItem("bloom-cache-recent-mod-searches");
      const stored = JSON.parse(localStorage.getItem("bloom-settings") || "{}");
      for (const retiredKey of ["customBackground", "backgroundMode", "liveBackground", "backgroundOpacity", "settingsPanelDarkness",
        "sidebarSurfaceDarkness", "sidebarElementDarkness", "sidebarElementFrost", "sidebarOutline", "sidebarTextColor",
        "sidebarFrost", "elementFrost", "sidebarOpacity", "elementOpacity"]) delete stored[retiredKey];
      let loaded = { ...defaults, ...normalizeAccent(stored) } as SettingsState;
      if (!stored.redesignAppearanceV1) {
        loaded = resetLauncherAppearance(loaded);
        loaded.redesignAppearanceV1 = true;
      }
      if (localStorage.getItem(spotlightDefaultMigrationKey) !== "complete") {
        loaded = { ...loaded, homeLayout: "Spotlight" as HomeLayout };
        localStorage.setItem(spotlightDefaultMigrationKey, "complete");
      }
      loaded = { ...loaded, theme: loaded.theme === "light" || loaded.theme === "system" ? loaded.theme : "oled" };
      loaded.backdrop = readBackground(stored.backdrop);
      loaded.dividerStrength = Number.isFinite(loaded.dividerStrength) ? Math.max(0, Math.min(100, loaded.dividerStrength)) : defaults.dividerStrength;
      loaded.interfaceSize = Math.max(90, Math.min(125, Number(loaded.interfaceSize) || defaults.interfaceSize));
      loaded.spacing = loaded.spacing === "comfortable" ? "comfortable" : defaults.spacing;
      const savedSidebar = loaded.rightSidebar as string;
      loaded.rightSidebar = isSidebarChoice(savedSidebar) ? savedSidebar
        : savedSidebar === "What’s New" ? "Custom Image" : defaults.rightSidebar;
      delete (loaded as SettingsState & { interactionSounds?: unknown }).interactionSounds;
      delete (loaded as SettingsState & { recentModSearches?: unknown }).recentModSearches;
      delete (loaded as SettingsState & { finish?: unknown }).finish;
      localStorage.setItem("bloom-settings", JSON.stringify(loaded));
      return loaded;
    } catch {
      return defaults;
    }
  });
  const [systemLight, setSystemLight] = useState(() => matchMedia("(prefers-color-scheme: light)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: light)");
    const changed = () => setSystemLight(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const resolvedTheme = settings.theme === "system" ? systemLight ? "light" : "oled" : settings.theme;
  useEffect(() => {
    void getCurrentWebview().setZoom(settings.interfaceSize / 100).catch(() => {});
  }, [settings.interfaceSize]);
  const sidebarImage = useLauncherImage(settings.rightSidebar === "Custom Image", "selected");
  const editingWallpaper = page === "settings" && settingsTarget === "Background";
  const wallpaper = useLauncherImage(settings.backdrop.source === "Image" || editingWallpaper, "wallpaper");
  const showWallpaper = settings.backdrop.source === "Image" && !!wallpaper.source;
  const contentDownloads = useContentDownloads({
    ultraPerformance: settings.ultraPerformance,
    onInstalled: tasks => {
      for (const task of tasks) instanceContentMemoryCache.delete(instanceContentCacheKey(task.instanceId, task.category));
      addCompletedDownloads(tasks.map(task => ({ id: task.id, name: task.title, version: task.version, kind: contentKind(task), targetName: task.instanceName, iconUrl: task.iconUrl || undefined, completedAt: task.completedAt || Date.now() })));
    },
    onFailed: task => {
      showToolMessage(userError(task.message), "error");
      setLogs(current => [...current, { id: `${task.id}-error`, instanceId: task.instanceId, instanceName: task.instanceName, stream: "launcher", level: "error" as const, message: `${task.title}: ${task.message}`, timestamp: task.completedAt || Date.now() }].slice(-600));
    },
  });
  const contentActivity = contentDownloads.current;
  const download: DownloadViewState = contentActivity ? {
    active: true, state: contentActivity.state === "installed" ? "complete" : "installing",
    progress: contentActivity.progress, message: contentActivity.message, instanceId: contentActivity.instanceId,
    taskName: contentActivity.title, taskVersion: contentActivity.version, taskKind: contentKind(contentActivity), taskIcon: contentActivity.iconUrl || undefined,
  } : gameDownload;
  useEffect(() => () => {
    instanceOpenTimers.current.forEach((timer) => window.clearTimeout(timer));
    instanceOpenTimers.current.clear();
  }, []);
  useEffect(() => {
    if (!profileMenuOpen && !signInOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { setProfileMenuOpen(false); setSignInOpen(false); document.querySelector<HTMLButtonElement>(".rail-account-trigger")?.focus(); }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [profileMenuOpen, signInOpen]);
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
  useEffect(startScreenshotWarming, []);
  useEffect(() => { setScreenshotActivity(download.active || gameRunning); }, [download.active, gameRunning]);
  useEffect(() => {
    const nativeWindow = getCurrentWindow();
    void Promise.allSettled([
      nativeWindow.setTheme(settings.theme === "system" ? null : resolvedTheme === "light" ? "light" : "dark"),
      nativeWindow.setBackgroundColor(defaultColors[resolvedTheme].Background),
    ]);
  }, [settings.theme, resolvedTheme]);
  useEffect(() => {
    localStorage.setItem("bloom-settings", JSON.stringify(settings));
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.setProperty("--accent", settings.accent);
    root.style.setProperty("--divider-strength", settings.dividerStrength + "%");
    root.style.setProperty("--row-divider-strength", (settings.dividerStrength * 7 / 13) + "%");
    for (const part of ["Background", "Sidebar", "Panel", "Foreground"] as const) {
      const saved = settings[paletteKey(resolvedTheme, part)];
      const value = validColor(saved) || resolvedTheme === "light" ? saved : defaultColors.oled[part];
      const property = "--user-" + part.toLowerCase();
      root.toggleAttribute(part === "Background" ? "data-custom-canvas" : "data-custom-" + part.toLowerCase(), validColor(value));
      if (validColor(value)) root.style.setProperty(property, value);
      else root.style.removeProperty(property);
    }
    const font = interfaceFonts.includes(settings.interfaceFont) ? settings.interfaceFont : defaults.interfaceFont;
    root.style.setProperty("--interface-font", '"' + font + '"');
    document.documentElement.dataset.spacing = settings.spacing;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", defaultColors[resolvedTheme].Background);
    document.documentElement.dataset.animations = settings.animations && !settings.ultraPerformance ? "on" : "off";
    document.documentElement.dataset.performance = settings.ultraPerformance ? "ultra" : "normal";
    const buttonPressDuration = Math.max(0, Math.min(1500, settings.buttonPressDuration));
    document.documentElement.dataset.buttonPressDuration = String(buttonPressDuration);
  }, [settings, resolvedTheme]);
  useEffect(() => {
    const activePresses = new WeakMap<HTMLElement, Animation>();
    const press = (event: PointerEvent) => {
      if (event.button !== 0 || document.documentElement.dataset.animations !== "on" || document.documentElement.dataset.performance === "ultra") return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button, .instance-library-card") : null;
      if (!target || (target instanceof HTMLButtonElement && target.disabled) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // The icon rail owns its feedback. Instance selection buttons animate their own flat face.
      if (target.closest('.sidebar-navigation, .rail-destinations, .rail-recent-instances, .desktop-context-links, .launcher-filter-menu, [aria-haspopup="menu"]')) return;
      if (target.closest(".desktop-instance-link") && !target.matches(".instance-nav-name:not([data-folder-drag-handle])")) return;
      if (target.closest(".comparison-canvas") || target.closest(".desktop-titlebar") || target.classList.contains("instance-icon-picker") || target.classList.contains("profile-settings-avatar") || target.classList.contains("window-control")) return;
      const duration = Number(document.documentElement.dataset.buttonPressDuration || 0);
      const pressTargets = [target];
      for (const target of pressTargets) {
        activePresses.get(target)?.cancel();
        activePresses.delete(target);
        if (duration <= 0) continue;
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
      }
    };
    document.addEventListener("pointerdown", press, { passive: true });
    return () => document.removeEventListener("pointerdown", press);
  }, []);
  useEffect(() => { if (requestedPage !== "new-instance") localStorage.setItem("bloom-last-page", instanceRoute ? "instances" : requestedPage); }, [requestedPage, instanceRoute]);
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
    if (import.meta.env.DEV) {
      if (manual) { setMockUpdateActive(true); setUpdatePanelOpen(true); }
      return;
    }
    if (availableUpdate) {
      if (manual) setUpdatePanelOpen(true);
      return;
    }
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
        setToast("Delight Client is already up to date.");
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
      if (!import.meta.env.DEV && settings.updates) void checkForUpdates(false);
    }, 1800);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const showMockUpdate = (event: globalThis.KeyboardEvent) => {
      const isMockUpdateShortcut = shortcutMatches("mockUpdate", settings.shortcuts, event) || shortcutMatches("mockUpdateAlt", settings.shortcuts, event);
      if (recording(event) || !isMockUpdateShortcut || event.repeat) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      setMockUpdateActive(true);
      setUpdatePanelOpen(mockUpdateActive);
      setUpdatePhase("ready");
      setUpdateProgress(0);
      setUpdateError("");
    };
    window.addEventListener("keydown", showMockUpdate, { capture: true });
    return () => window.removeEventListener("keydown", showMockUpdate, { capture: true });
  }, [settings.shortcuts, mockUpdateActive]);

  useEffect(() => () => {
    if (mockUpdateInterval.current !== null) window.clearInterval(mockUpdateInterval.current);
    if (mockInstallTimer.current !== null) window.clearTimeout(mockInstallTimer.current);
  }, []);
  useEffect(() => {
    const dialog = updateDialog.current;
    if (!dialog || !updatePanelOpen) return;
    dialog.showModal();
    return () => dialog.close();
  }, [updatePanelOpen]);

  const installUpdate = async () => {
    if (import.meta.env.DEV && !mockUpdateActive) return;
    if ((!availableUpdate && !mockUpdateActive) || !["ready", "error"].includes(updatePhase)) return;
    setUpdatePanelOpen(true);
    setUpdatePhase("downloading");
    setUpdateProgress(0);
    setUpdateError("");
    if (import.meta.env.DEV && mockUpdateActive) {
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
          window.location.reload();
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
          setUpdateProgress(total ? 0 : undefined);
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

  const closeUpdateDialog = () => {
    if (updatePhase === "downloading" || updatePhase === "installing") return;
    setUpdatePanelOpen(false);
  };
  const previewUpdate = import.meta.env.DEV && mockUpdateActive;
  const displayedUpdateVersion = previewUpdate ? "9.9.9-test" : availableUpdate?.version;
  const updateNotes = previewUpdate ? "Preview the launcher download and restart flow." : availableUpdate?.body?.trim();
  const updateBusy = updatePhase === "downloading" || updatePhase === "installing";
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
    const fallback = window.setTimeout(() => {
      setAccountHydrated(true);
      if (!profile && localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY) !== "complete") setOnboardingOpen(true);
    }, 2500);
    const timer = window.setTimeout(() => {
      void refreshAccounts()
        .then(active => {
          if (active && localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY) !== "complete") {
            localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, "complete");
            setOnboardingOpen(false);
          } else if (!active && localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY) !== "complete") {
            setOnboardingOpen(true);
          }
        })
        .catch(() => {
          if (!profile && localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY) !== "complete") setOnboardingOpen(true);
        })
        .finally(() => {
          window.clearTimeout(fallback);
          setAccountHydrated(true);
        });
    }, 250);
    return () => { window.clearTimeout(timer); window.clearTimeout(fallback); };
  }, []);
  const instanceRead = useRef(0);
  const refreshInstances = async () => {
    const request = ++instanceRead.current;
    try {
      const next = await invoke<InstanceDraft[]>("list_instances");
      if (request !== instanceRead.current) return;
      setInstances(next);
      setLibraryState("ready");
    } catch (error) {
      if (request !== instanceRead.current) return;
      setLibraryError(userError(String(error)));
      setLibraryState("error");
    }
  };
  useEffect(() => { void refreshInstances(); return () => { instanceRead.current++; }; }, []);
  const refreshPackMemberships = () => void invoke<PackChannelMembership[]>("list_pack_channel_memberships")
    .then(items => setPackMemberships(new Map(items.map(item => [item.instanceId, item.role]))))
    .catch(() => setPackMemberships(new Map()));
  useEffect(() => { refreshPackMemberships(); }, [instances]);
  useEffect(() => {
    if (gameRunning || download.active) return;
    const timer = window.setTimeout(() => {
      void invoke<string[]>("reconcile_cosmetics").then(problems => {
        if (problems.length) { setToastKind("error"); setToast(problems.join("\n")); }
      }).catch(error => { setToastKind("error"); setToast(String(error)); });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [instances, gameRunning, download.active]);
  useLauncherActivity({
    activity: gameDownload,
    running: gameRunning,
    ultraPerformance: settings.ultraPerformance,
    requestPending: () => launchRequestPending.current,
    onRunning: setGameRunning,
    onProgress: (next) => {
        const playedId = next.instanceId;
        if (next.state === "running" && playedId) {
          setPlayedIds(previous => previous[0] === playedId ? previous : [playedId, ...previous.filter(id => id !== playedId)]);
        }
        if (next.state === "installing" && next.instanceId !== legacyInstallingInstance.current) {
          lastCompletedTask.current = "";
          localStorage.removeItem("delight-legacy-install-completion");
        }
        legacyInstallingInstance.current = next.state === "installing" ? next.instanceId : undefined;
        setDownload((current) => ({
          active: next.state === "installing" || next.state === "launching" || next.state === "running" || next.state === "complete",
          launch: next.state === "launching" || next.state === "running" || (current.instanceId === next.instanceId && current.launch && (current.active || current.state === next.state)),
          progress: next.progress,
          state: next.state,
          message: userError(next.message),
          instanceId: next.instanceId,
          completedAt: next.completedAt,
          downloadedBytes: next.downloadedBytes,
          totalBytes: next.totalBytes,
          bytesPerSecond: next.bytesPerSecond,
          taskName: current.instanceId === next.instanceId ? current.taskName : undefined,
          taskVersion: current.instanceId === next.instanceId ? current.taskVersion : undefined,
          taskKind: current.instanceId === next.instanceId ? current.taskKind : undefined,
          taskIcon: current.instanceId === next.instanceId ? current.taskIcon : undefined,
        }));
        if (next.state === "error") {
          setToastKind("error");
          setToast(userError(next.message));
          setLogs(current => [...current, { id: `${Date.now()}-launch-error`, instanceId: next.instanceId || "launcher", instanceName: instances.find(item => item.id === next.instanceId)?.name || next.instanceId || "Launcher", stream: "launcher", level: "error" as const, message: next.message, timestamp: Date.now() }].slice(-600));
          window.setTimeout(() => setToast(""), 5000);
        }
        if (next.state === "running") {
          if (settings.closeAfterLaunch) void invoke("exit_application");
        }
        if (next.state === "complete") {
          void refreshInstances();
        }
    },
  });
  useEffect(() => {
    if (!download.instanceId || instances.some(instance => instance.id === download.instanceId)) return;
    void refreshInstances();
  }, [download.instanceId]);
  useEffect(() => { localStorage.setItem("bloom-shared-pack-missing-mods", JSON.stringify(sharedPackMissingMods)); }, [sharedPackMissingMods]);
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
      setLogs(current => [...current, { id: `${Date.now()}-client-crash`, instanceId: "bloom-client", instanceName: "Delight Client", stream: "client", level: "error" as const, message, timestamp: Date.now() }].slice(-600));
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
    if (gameDownload.launch || (gameDownload.state !== "running" && gameDownload.state !== "complete") || !gameDownload.instanceId) return;
    const completionKey = gameDownload.completedAt
      ? `${gameDownload.instanceId}-${gameDownload.completedAt}`
      : `${gameDownload.state}:${gameDownload.instanceId}`;
    const marker = gameDownload.completedAt ? "delight-last-install-completion" : "delight-legacy-install-completion";
    if (localStorage.getItem(marker) === completionKey) return;
    if (lastCompletedTask.current === completionKey) return;
    const instance = instances.find(item => item.id === gameDownload.instanceId);
    if (!instance) return;
    lastCompletedTask.current = completionKey;
    const completedAt = gameDownload.completedAt ?? Date.now();
    const id = gameDownload.completedAt ? `install:${instance.id}:${completedAt}` : `${instance.id}-${completedAt}`;
    const completedItem: CompletedDownload = gameDownload.taskKind && gameDownload.taskKind !== "game"
      ? { id: id, name: gameDownload.taskName || "Content", version: gameDownload.taskVersion || (gameDownload.taskKind === "mod" ? "Fabric" : gameDownload.taskKind === "resourcepack" ? "Resource pack" : "Shader"), targetName: instance.name, kind: gameDownload.taskKind, iconUrl: gameDownload.taskIcon, completedAt }
      : { id: id, name: instance.name, version: instance.version, loader: instance.loader, kind: "game", iconUrl: instance.icon || undefined, completedAt };
    addCompletedDownloads([completedItem]);
    localStorage.setItem(marker, completionKey);
  }, [gameDownload.completedAt, gameDownload.launch, gameDownload.state, gameDownload.instanceId, gameDownload.taskKind, gameDownload.taskName, gameDownload.taskVersion, gameDownload.taskIcon, instances]);
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
    if ((gameDownload.state !== "running" && gameDownload.state !== "complete") || gameDownload.progress < 99 || !gameDownload.active) return;
    const timer = window.setTimeout(() => setDownload(current => current.state === gameDownload.state && current.instanceId === gameDownload.instanceId
      ? { ...current, active: false } : current), 3000);
    return () => window.clearTimeout(timer);
  }, [gameDownload.state, gameDownload.instanceId, gameDownload.progress, gameDownload.active]);
  const launch = async (instance: InstanceDraft, portalTarget?: PortalTarget) => {
    if (launchRequestPending.current || download.active || gameRunning) {
      setToastKind("notification");
      setToast("Something is already downloading or running. Please wait.");
      window.setTimeout(() => setToast(""), 3500);
      return;
    }
    launchRequestPending.current = true;
    setDownload({
      active: true,
      progress: 1,
      state: "installing",
      launch: true,
      message: "Preparing Minecraft",
      instanceId: instance.id,
      taskKind: "game",
    });
    setLogs(current => [...current, { id: `${Date.now()}-launch`, instanceId: instance.id, instanceName: instance.name, stream: "launcher", level: "info" as const, message: `Starting ${instance.name} (${instance.version} • ${instance.loader})`, timestamp: Date.now() }].slice(-600));
    try {
      await invoke("launch_minecraft", { instanceId: instance.id, launchMethod: settings.launchMethod, downloadWorkers: settings.downloadWorkers, debugLogging: settings.debugLogging, ...(portalTarget ? { portalTarget } : {}) });
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
    } finally {
      launchRequestPending.current = false;
    }
  };
  const openInstancePage = (instance: InstanceDraft) => {
    setSelectedInstanceId(instance.id);
    setInstanceDestination("view");
    setPage("instance");
  };
  const handleInstanceClick = (event: MouseEvent<HTMLElement>, instance: InstanceDraft) => {
    if (!settings.doubleClickToPlay || event.detail === 0) { openInstancePage(instance); return; }
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
    if (gameRunning && category === "mods") throw new Error("Close Minecraft before installing mods.");
    const taskIcon = item.iconSourceUrl || (item.iconUrl?.startsWith("https://") ? item.iconUrl : undefined);
    await contentDownloads.enqueue({ instanceId: instance.id, projectId: item.projectId, category, title: item.title, version: item.versionNumber, iconUrl: taskIcon || null });
  };
  const floatingInstance = instances.find(instance => instance.id === floatingInstanceId);
  const mostRecentInstance = instances[0];
  const deleteClientInstance = async (instance: InstanceDraft) => {
    try {
      await invoke("delete_instance", { instanceId: instance.id });
      setInstances(current => current.filter(item => item.id !== instance.id));
      if (floatingInstanceId === instance.id) setFloatingInstanceId(null);
      if (selectedInstance?.id === instance.id) { setSelectedInstanceId(null); setInstanceDestination("view"); navigate("instances"); }
      if (spotlightInstanceId === instance.id) { setSpotlightInstanceId(null); localStorage.removeItem("bloom-spotlight-instance"); }
      showToolMessage(`${instance.name} and all of its files were deleted.`, "notification");
    } catch (error) {
      showToolMessage(String(error), "error");
      throw error;
    }
  };
  const renameClientInstance = async (instance: InstanceDraft, name: string) => {
    const changed = await invoke<InstanceDraft>("rename_instance", { instanceId: instance.id, name });
    setInstances(current => current.map(item => item.id === changed.id ? changed : item));
  };
  const exportClientInstance = async (instance: InstanceDraft) => {
    try {
      const path = await invoke<string | null>("export_instance", { instanceId: instance.id });
      if (path) {
        showToolMessage(`Exported ${instance.name} to ${path}`, "notification");
      }
    } catch (error) { showToolMessage(String(error), "error"); throw error; }
  };
  const duplicateClientInstance = async (instance: InstanceDraft) => {
    try {
      const duplicate = await invoke<InstanceDraft>("duplicate_instance", { instanceId: instance.id });
      setInstances(current => [duplicate, ...current.filter(item => item.id !== duplicate.id)]);
      setSelectedInstanceId(duplicate.id);
      setInstanceDestination("view");
      setPage("instance");
      showToolMessage(`${duplicate.name} is ready.`, "notification");
    } catch (error) {
      showToolMessage(String(error), "error");
      throw error;
    }
  };
  const signOut = () => {
    if (signingOut.current) return Promise.resolve();
    signingOut.current = true;
    return invoke<MinecraftProfile | null>("sign_out_minecraft")
      .then(next => { setProfile(next); return refreshAccounts(); })
      .catch(error => showToolMessage(String(error), "error"))
      .finally(() => { signingOut.current = false; setSignInOpen(false); setProfileMenuOpen(false); setAccountChoicesOpen(false); });
  };
  const switchAccount = async (account: MinecraftProfile) => {
    if (switchingAccount) return;
    setSwitchingAccount(true);
    try {
      const next = await invoke<MinecraftProfile>("switch_minecraft_account", { accountId: account.id });
      setProfile(next); setAccountChoicesOpen(false); setProfileMenuOpen(false);
      await refreshAccounts();
      showToolMessage(`Switched to ${next.name}.`);
    } catch (error) { showToolMessage(String(error), "error"); }
    finally { setSwitchingAccount(false); }
  };
  const openSettings = (target = "Appearance", adding = false) => { setSettingsQuery(""); setAddAccount(adding); setSettingsTarget(target); setSettingsNavigationKey(value => value + 1); setPage("settings"); };
  const showToolMessage = (message: string, kind: "notification" | "error" = "notification") => {
    window.clearTimeout(toolToastTimer.current);
    setToastKind(kind);
    setToast(userError(message));
    toolToastTimer.current = window.setTimeout(() => setToast(""), 4000);
  };
  const contentTransfer = useContentTransferController(instances, (targetId, category, message) => {
    instanceContentMemoryCache.delete(instanceContentCacheKey(targetId, category));
    showToolMessage(message);
  });
  const openGameFolder = () => void invoke("open_game_folder").catch(error => showToolMessage(String(error), "error"));
  const importModpack = () => {
    if (download.active || gameRunning) return showToolMessage("Another download or game launch is already active.");
    setPage("new-instance", "file");
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
    setDownloadSection("Downloading"); setPage("downloads");
    try { await invoke("repair_minecraft_installation", { instanceId: mostRecentInstance.id }); }
    catch (error) { setDownload({ active: false, progress: 0, state: "idle", message: "" }); showToolMessage(String(error), "error"); }
  };
  const switchTargets: SwitchTarget[] = [
    ...instances.map(instance => ({ id: `instance:${instance.id}`, label: instance.name, detail: `${instance.version} · ${instance.loader}`, kind: "instance" as const, run: () => openInstancePage(instance) })),
    ...([ ["Home", "home"], ["Instances", "instances"], ["Locker", "locker"], ["Social", "social"], ["Alula", "alula"], ["Screenshots", "screenshots"], ["Utilities", "utilities"], ["Portal", "portal"], ["Downloads", "downloads"], ["Logs", "logs"], ["New instance", "new-instance"] ] as const).map(([label, destination]) => ({ id: `page:${destination}`, label, detail: "Page", kind: "page" as const, run: () => setPage(destination) })),
    ...settingTabs.map(([, label]) => ({ id: `setting:${label}`, label: settingsLabel(label), detail: "Settings", keywords: ({ Appearance: "theme accent color animations", Background: "wallpaper image blur frosted tint opacity", General: "right sidebar download queue image friends hide", Performance: "memory ram java arguments", Minecraft: "version loader", "My Profile": "account login avatar", Cache: "storage disk" } as Record<string, string>)[label], kind: "setting" as const, run: () => openSettings(label) })),
  ];
  useEffect(() => { if (page !== "social") setSocialDestination(undefined); }, [page]);
  const activeNavPage = page === "instance" || page === "new-instance" ? "instances" : page;
  const [lockerSection, setLockerSection] = useState<LockerSection>("Equipped look");
  useEffect(() => { if (page !== "locker") setLockerSection("Equipped look"); }, [page]);
  const [portalSection, setPortalSection] = useState<"All" | "Servers" | "Worlds">("All");
  const [shotLibrary, setShotLibrary] = useState("");
  const shotFilter = instances.some(item => item.id === shotLibrary) ? shotLibrary : "";
  const wideWorkspace = page === "home";
  const chatContextPage = page === "alula" ? alulaOrigin : page;
  const canCollapseContext = page !== "alula" && activeNavPage !== "instances" && page !== "settings" && page !== "downloads" && page !== "screenshots" && page !== "portal" && page !== "locker" && page !== "social" && activeNavPage !== "utilities" && !wideWorkspace;
  const contextCollapsed = sidebarCollapsed && canCollapseContext;
  const showWorkspacePanel = workspacePanelOpen && settings.rightSidebar !== "Hidden";
  const primaryNavigation = [
    [House, "Home", "home", () => setPage("home")],
    [Cuboid, "Instances", "instances", () => setPage("instances")],
    [Download, "Downloads", "downloads", () => setPage("downloads")],
    [Wrench, "Utilities", "utilities", () => setPage("utilities")],
    [MessageCircle, "Social", "social", () => { setSocialDestination({ section: "messages" }); setPage("social"); }],
    [HangerIcon, "Locker", "locker", () => { setLockerSection("Equipped look"); setPage("locker"); }],
    [Orbit, "Portal", "portal", () => setPage("portal")],
    [BotMessageSquare, "Alula", "alula", () => setPage("alula")],
    [ImagePlus, "Screenshots", "screenshots", () => setPage("screenshots")],
    [SettingsIcon, "Settings", "settings", () => openSettings()],
  ] as const;
  const downloadSummary = [
    { title: "Downloading", Icon: Download, count: contentDownloads.tasks.filter(task => task.state === "installing" || task.state === "cancelling").length + Number(!gameDownload.launch && gameDownload.active && gameDownload.state !== "error") },
    { title: "Queued", Icon: ListOrdered, count: contentDownloads.tasks.filter(task => task.state === "queued").length },
    { title: "Completed", Icon: Check, count: completedDownloads.length },
    { title: "Stopped", Icon: CircleAlert, count: contentDownloads.tasks.filter(task => task.state === "error" || task.state === "cancelled").length + Number(!gameDownload.launch && gameDownload.state === "error") },
  ] as const;
  const applicationMenus: DesktopMenu[] = [
    { label: "File", items: [
      { label: "New instance", run: () => setPage("new-instance") },
      { label: "Import modpack", run: importModpack },
      { label: "Open game folder", run: openGameFolder },
    ] },
    { label: "Edit", items: [
      { label: "Client settings", run: () => openSettings() },
      { label: "Profile & accounts", run: () => openSettings("My Profile") },
    ] },
    { label: "View", items: [
      ...primaryNavigation.map(([, label, , run]) => ({ label, run })),
      ...nav.slice(2).filter(([, , destination]) => destination !== "screenshots" && destination !== "portal" && destination !== "utilities" && destination !== "locker" && destination !== "social").map(([, label, destination]) => ({ label, run: () => setPage(destination) })),
      { label: "Logs", run: () => setPage("logs") },
      ...(canCollapseContext && !contextCollapsed ? [{ label: "Collapse sidebar", run: () => {
        setSidebarCollapsed(true);
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
      } }] : []),
      ...(settings.rightSidebar !== "Hidden" ? [{ label: showWorkspacePanel ? "Hide workspace panel" : "Open workspace panel", run: () => setWorkspacePanelOpen(value => !value) }] : []),
    ] },
    { label: "Window", items: [
      { label: "Minimize", run: () => void getCurrentWindow().minimize() },
      { label: "Maximize or restore", run: () => void getCurrentWindow().toggleMaximize() },
      { label: "Close window", run: () => void invoke("exit_application") },
    ] },
    { label: "Help", items: [
      { label: "Check for updates", run: () => void checkForUpdates(true) },
      { label: "Check Java", run: showJavaStatus },
    ] },
  ];
  useEffect(() => {
    if (onboardingOpen || !accountHydrated) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || recording(event) || event.isComposing) return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        if (!(event.ctrlKey || event.metaKey || event.altKey)) return;
        if ((event.ctrlKey || event.metaKey) && !event.altKey && /^[acvxyz]$/i.test(event.key)) return;
      }
      const keys = chord(event);
      const row = shortcuts.find(item => binding(item, settings.shortcuts) === keys);
      if (!row) return;
      const id = row[0];
      const action = id === "import" ? importModpack : id === "folder" ? openGameFolder
        : switchTargets.find(target => target.id === id)?.run;
      if (action) { event.preventDefault(); event.stopPropagation(); action(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  const sectionButton = ([Icon, label]: typeof settingTabs[number]) => <button key={label} aria-current={!settingsQuery && settingsTarget === label ? "location" : undefined} onClick={() => openSettings(label)}><Icon size={17} />{settingsLabel(label)}</button>;
  if (!accountHydrated) return <OnboardingSplash />;
  if (onboardingOpen) {
    return <OnboardingFlow clientId={MICROSOFT_CLIENT_ID} onComplete={(nextProfile) => {
      localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, "complete");
      setProfile(nextProfile);
      setOnboardingOpen(false);
      setPage("home");
      void refreshAccounts();
    }} />;
  }
  return (
    <ShortcutContext.Provider value={settings.shortcuts}><ContentTransferContext.Provider value={contentTransfer.controls}>
    <div
      className="app-shell desktop-redesign"
      data-wallpaper={showWallpaper || undefined}
      style={showWallpaper ? {
        "--wallpaper-image": `url("${wallpaper.source}")`,
        "--wallpaper-fit": settings.backdrop.fit === "Fit" ? "contain" : "cover",
        "--wallpaper-opacity": (100 - settings.backdrop.opacity) + "%",
        "--wallpaper-sidebar": settings.backdrop.sidebar + "%",
        "--wallpaper-elements": settings.backdrop.elements + "%",
        "--wallpaper-element-blur": settings.ultraPerformance || !settings.backdrop.elementBlur ? "none" : `blur(${settings.backdrop.elementBlur}px)`,
        "--wallpaper-blur": settings.ultraPerformance || !settings.backdrop.blur ? "none" : `blur(${settings.backdrop.blur}px)`,
      } as CSSProperties : undefined}
      data-settings-workspace={page === "settings" || undefined}
      data-wide-workspace={wideWorkspace || undefined}
      data-desktop-context-collapsed={contextCollapsed ? "true" : "false"}
      data-workspace-rail={showWorkspacePanel ? "on" : "off"}
      onClick={() => { setProfileMenuOpen(false); setSignInOpen(false); }}
      tabIndex={-1}
    >
      <QuickSwitcher targets={switchTargets} />
      <DesktopTitleBar menus={applicationMenus} onHome={() => setPage("home")} onExpand={contextCollapsed ? () => { setSidebarCollapsed(false); localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "false"); } : undefined} />
      <div className="desktop-rail"><div className="rail-scroll"><nav className="rail-destinations" aria-label="Main navigation">
        {primaryNavigation.map(([Icon, label, destination, action]) => (
          <button key={destination} title={label} aria-label={label}
            aria-current={activeNavPage === destination ? "page" : undefined} onClick={action}>
            <Icon size={21} strokeWidth={1.7} />
            {destination === "downloads" && !download.launch && download.active && <span className="desktop-progress" aria-label={`${Math.round(ringProgress)} percent downloaded`} />}
          </button>
        ))}
      </nav>
        {railInstances.length > 0 && <nav className="rail-recent-instances" aria-label="Instance shortcuts">
          {railInstances.map(instance => <button key={instance.id} type="button" title={instance.name}
            aria-label={instance.name} onClick={() => openInstancePage(instance)}>
            <CatalogArtwork source={instance.icon} fallback={<Cuboid size={32} strokeWidth={1.5} aria-hidden="true" />} />
          </button>)}
        </nav>}
        </div>
        <div className="rail-account">
          {displayedUpdateVersion && <button className="rail-update-trigger" aria-label="Launcher update available" title="Launcher update available"
            aria-haspopup="dialog" onClick={() => setUpdatePanelOpen(true)}><Download size={20} aria-hidden="true" /></button>}
          {profile ? (
            <>
              <div className="rail-account-anchor">
                <button className="rail-account-trigger" aria-label={`Account: ${profile.name}`} title={profile.name}
                  onKeyDown={event => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                    event.preventDefault();
                    setProfileMenuOpen(true);
                    const fromEnd = event.key === "ArrowUp";
                    requestAnimationFrame(() => {
                      const items = accountMenu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
                      if (items?.length) items[fromEnd ? items.length - 1 : 0].focus();
                    });
                  }} onClick={(event) => { event.stopPropagation(); setProfileMenuOpen(value => !value); }} aria-expanded={profileMenuOpen} aria-haspopup="menu">
                  <div className="avatar">{profileIcon ? <img src={profileIcon} alt="" /> : profile.name.slice(0, 1).toUpperCase()}</div>
                </button>

              </div>
              <div ref={accountMenu} className={`profile-popover ${profileMenuOpen ? "open" : ""}`} role="menu" aria-label="Account menu" inert={!profileMenuOpen} aria-hidden={!profileMenuOpen} onKeyDown={event => {
                if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
                const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (at + buttons.length + (event.key === "ArrowUp" ? -1 : 1)) % buttons.length;
                event.preventDefault(); buttons[next]?.focus();
              }} onClick={event => event.stopPropagation()}>
                <header className="account-menu-identity"><span className="avatar">{profileIcon ? <img src={profileIcon} alt=""/> : profile.name.slice(0, 1)}</span><div><b>{profile.name}</b><small>Microsoft account</small></div></header>
                <div className="account-menu-actions">
                  <button role="menuitem" onClick={() => { setProfileMenuOpen(false); openSettings("My Profile"); }}><UserRound size={17}/>Account settings</button>
                  <button role="menuitem" aria-expanded={accountChoicesOpen} onClick={() => setAccountChoicesOpen(value => !value)}><ArrowRightLeft size={17}/>Switch account<ChevronDown size={14}/></button>
                  {accountChoicesOpen && <div className="account-choices">{(accounts.length ? accounts : [profile]).map(account =>
                    <button role="menuitem" key={account.id} disabled={switchingAccount || account.id === profile.id} onClick={() => void switchAccount(account)}>{account.name}{account.id === profile.id && <Check size={16}/>}</button>
                  )}</div>}
                  <button role="menuitem" onClick={() => { setProfileMenuOpen(false); openSettings("My Profile", true); }}><Plus size={17}/>Add account</button>
                </div>
                <div className="profile-popover-rule" />
                <UndoLogoutButton key={profile.id} accountId={profile.id} open={profileMenuOpen}
                  disabled={switchingAccount} animations={settings.animations && !settings.ultraPerformance} onConfirm={signOut} />
              </div>
            </>
          ) : (
            <>
              <div className="rail-account-anchor">
                <button className="rail-account-trigger" aria-label="Sign in" title="Sign in" onClick={event => { event.stopPropagation(); setSignInOpen(value => !value); }} aria-expanded={signInOpen} aria-haspopup="menu">
                  <UserRound size={20} aria-hidden="true" />
                </button>
              </div>
              <SignInPanel
                open={signInOpen}
                onSettings={() => { setSignInOpen(false); openSettings(); }}
                onSignedIn={(nextProfile) => {
                  setProfile(nextProfile);
                  setSignInOpen(false);
                  void refreshAccounts();
                }}
              />
            </>
          )}
        </div>
      </div>
      <aside className="sidebar desktop-context" aria-label="Page navigation">
      {page === "settings" && <header className="settings-workspace-bar"><h1>Settings</h1>
        <label><Search size={16} /><input type="search" aria-label="Search settings" placeholder="Search…" value={settingsQuery} onChange={event => setSettingsQuery(event.target.value)} /></label>
      </header>}
        <div className="desktop-context-body">
          {page === "alula" ? <div className="alula-sidebar" ref={setAlulaSidebar} /> : page === "social" ? <div className="social-sidebar-shell"><h1>Social</h1><div className="social-sidebar-host" ref={setSocialSidebar} /></div> : page === "settings" ? <nav className="desktop-context-links" aria-label="Settings sections">
          {settingsGroups.map(group => <section className="settings-nav-group" key={group.title}>
            <h2>{group.title}</h2>
            {group.sections.map(name => sectionButton(settingTabs.find(([, label]) => label === name)!))}
          </section>)}
        </nav> : page === "downloads" ? <nav className="desktop-context-links download-navigation" aria-label="Download sections">
          <h2>Downloads</h2>
          {downloadSummary.filter(item => item.title !== "Stopped" || item.count || downloadSection === "Stopped").map(({ title, Icon, count }) =>
            <button key={title} aria-label={title} aria-current={downloadSection === title ? "page" : undefined} onClick={() => setDownloadSection(title)}>
              <Icon size={16} aria-hidden="true"/><span>{title}</span><small>{count}</small>
            </button>)}
        </nav> : page === "locker" ? <nav className="desktop-context-links utility-navigation" aria-label="Locker categories">
          <h2>Locker</h2>
          {lockerSections.map(([label, Icon]) => <button key={label} aria-current={label === lockerSection ? "page" : undefined} onClick={() => setLockerSection(label)}><Icon size={17}/>{label}</button>)}
        </nav> : activeNavPage === "utilities" ? <nav className="desktop-context-links utility-navigation" aria-label="Utility tools">
          <h2>Utilities</h2>
          <button aria-current={page === "utilities" ? "page" : undefined} onClick={() => setPage("utilities")}><RefreshCw size={17}/>Global File Sync</button>
        </nav> : page === "portal" ? <nav className="desktop-context-links portal-navigation" aria-label="Portal destinations">
          <h2>Portal</h2>
          {(["All", "Servers", "Worlds"] as const).map(section => {
            const Icon = section === "All" ? Orbit : section === "Servers" ? Server : Cuboid;
            return <button key={section} aria-current={portalSection === section ? "page" : undefined} onClick={() => setPortalSection(section)}>
              <Icon size={17}/>{section}
            </button>;
          })}
        </nav> : page === "screenshots" ? <nav className="desktop-context-links shot-navigation" aria-label="Screenshot library">
          <h2>Screenshots</h2>
          <button aria-current={!shotFilter ? "page" : undefined} onClick={() => setShotLibrary("")}><ImagePlus size={17}/>All screenshots</button>
          {instances.length > 0 && <h3>Instances</h3>}
          {instances.map(item => <button key={item.id} className="shot-instance" aria-current={shotFilter === item.id ? "page" : undefined} onClick={() => setShotLibrary(item.id)}>
            <CatalogArtwork source={item.icon} fallback={<Cuboid size={29} aria-hidden="true" />} /><span>{item.name}{instances.some(other => other.id !== item.id && other.name === item.name) ? ` · ${item.id}` : ""}</span>
          </button>)}
        </nav> : !wideWorkspace && <InstanceSidebar key={instanceNavigationKey} instances={instances} selectedId={page === "instance" ? selectedInstance?.id : undefined}
          activity={gameDownload} onCancelLaunch={() => void invoke("cancel_minecraft_launch").catch(error => showToolMessage(String(error), "error"))} transferring={!!contentTransfer.dragging} onCreate={() => setPage("new-instance")}
          onOpen={openInstancePage} />}
        </div>
        {page === "settings" && <nav className="desktop-context-links" aria-label="Settings help">
            <button onClick={() => openSettings("About Delight")}><Info size={17}/>About Delight</button>
            <button onClick={() => void openUrl("mailto:support@bloomclient.org").catch(error => showToolMessage(String(error), "error"))}><CircleHelp size={17}/>Help &amp; feedback<ExternalLink size={12}/></button>
          </nav>}
      </aside>
      <main ref={workspace} data-desktop-page={page} className={`content ${page === "social" ? "social-content" : ""}`}>
        {page === "alula" ? null : page === "instance" && selectedInstance ? (
          <InstancePage contentTasks={contentDownloads.tasks} floating={floatingInstanceId === selectedInstance.id} onPopOut={() => setFloatingInstanceId(current => current === selectedInstance.id ? null : selectedInstance.id)} onMessage={showToolMessage} key={`${selectedInstance.id}:${instanceDestination}:${instanceNavigationKey}`} instance={selectedInstance} groupRole={packMemberships.get(selectedInstance.id)} busy={download.active || gameRunning} initialTab={instanceDestination === "view" || instanceDestination === "add-mods" ? "mods" : instanceDestination} initialCatalog={instanceDestination === "add-mods"} onPlay={target => void launch(selectedInstance, target)} onRename={name => renameClientInstance(selectedInstance, name)} onExport={() => exportClientInstance(selectedInstance)} onShare={() => setShareInstance(selectedInstance)} onDuplicate={() => duplicateClientInstance(selectedInstance)} onDelete={() => deleteClientInstance(selectedInstance)} onInstallContent={(item, category) => installContent(selectedInstance, item, category)} onChanged={(changed) => setInstances(current => current.map(instance => instance.id === changed.id ? changed : instance))} />
        ) : page === "logs" ? (
          <LogsPage onShare={failure ? previewFailure : undefined} entries={logs} running={gameRunning || download.state === "launching"} onClear={() => setLogs([])} />
        ) : activeNavPage === "utilities" ? (
          <>
            <div hidden={page !== "utilities"}><UtilitiesPage instances={instances} SelectControl={Select} onMessage={showToolMessage} /></div>
          </>
        ) : page === "screenshots" ? (
          <ScreenshotShelf filter={shotFilter} libraryName={instances.find(item => item.id === shotFilter)?.name || "All screenshots"} onMessage={showToolMessage} />
        ) : page === "portal" ? (
          <PortalPage filter={portalSection} instances={instances} busy={download.active || gameRunning} SelectControl={Select} onCreate={() => setPage("new-instance")} onOpenInstance={id => { const instance = instances.find(item => item.id === id); if (instance) openInstancePage(instance); }} onPlay={(id, target) => { const instance = instances.find(item => item.id === id); if (instance) void launch(instance, target); else showToolMessage("That instance is no longer available. Refresh Portal.", "error"); }} />
        ) : page === "social" ? (
          <SocialPage sidebarHost={socialSidebar} destination={socialDestination} onNotify={(message, kind) => showToolMessage(message, kind === "error" ? "error" : "notification")} onInstanceImported={(result) => { setSharedPackMissingMods(result.missingMods); setDownload({ active: true, progress: 1, state: "installing", message: "Importing shared instance", instanceId: result.instanceId, taskKind: "game" }); refreshPackMemberships(); setDownloadSection("Downloading"); setPage("downloads"); void refreshInstances(); }} />
        ) : page === "instances" ? (
          <section className="library-load-state" aria-live="polite">
            {libraryState === "error" ? <><h1>Couldn’t load your instances</h1><p>{libraryError}</p><button onClick={() => { setLibraryState("loading"); void refreshInstances(); }}><RefreshCw size={16} />Retry</button></>
              : <p>Loading instances…</p>}
          </section>
        ) : page === "downloads" ? (
          <DownloadsPage section={downloadSection} motion={settings.animations && !settings.ultraPerformance} download={gameDownload} contentTasks={contentDownloads.tasks} onCancelContent={id => void contentDownloads.cancel(id).catch(error => showToolMessage(String(error), "error"))} onDismissContent={id => void contentDownloads.dismiss(id).catch(error => showToolMessage(String(error), "error"))} instances={instances} completed={completedDownloads} missingMods={sharedPackMissingMods} onClear={ids => {
            const removed = new Set(ids);
            const remaining = completedDownloads.filter(item => !removed.has(item.id));
            localStorage.setItem("bloom-completed-downloads", JSON.stringify(remaining));
            setCompletedDownloads(remaining);
          }} onCancel={() => void invoke("cancel_minecraft_launch")} onDismissMissing={() => setSharedPackMissingMods([])} />
        ) : page === "locker" ? (
          <Locker section={lockerSection} onSection={setLockerSection} profile={profile} motion={settings.animations && !settings.ultraPerformance} onNotify={(message, kind) => showToolMessage(message, kind === "error" ? "error" : "notification")} />
        ) : page === "settings" ? (
          <SettingsPage resolvedTheme={resolvedTheme} settings={settings} setSettings={setSettings} onSignOut={signOut} profile={profile} profileIcon={profileIcon} onProfileIconChange={setProfileIcon} sidebarImage={sidebarImage} wallpaper={wallpaper} initialTab={settingsTarget} query={settingsQuery} onNavigate={openSettings} addAccount={addAccount} navigationKey={settingsNavigationKey} currentVersion={currentVersion} availableVersion={displayedUpdateVersion || null} updateChecking={updateChecking} onCheckUpdates={() => void checkForUpdates(true)} onOpenUpdate={() => setUpdatePanelOpen(true)} accounts={accounts} switchingAccount={switchingAccount} onSwitchAccount={switchAccount} onAccountAdded={(next) => { setProfile(next); void refreshAccounts(); }} onRestartOnboarding={() => { setProfileMenuOpen(false); setSignInOpen(false); setOnboardingOpen(true); }} />
        ) : page === "new-instance" ? (
          <NewInstancePage key={creationEntry.revision} initialStep={creationEntry.step}
            defaults={settings}
            onCancel={() => setPage(instances.length ? "instances" : "home")}
            onCreated={(destination) => {
              void refreshInstances();
              setPage(destination);
            }}
          />
        ) : settings.homeLayout === "Spotlight" ? (
          <SpotlightHome activity={gameDownload} running={gameRunning}
            instances={instances}
            selectedId={spotlightInstanceId}
            onMods={openInstancePage}
            busy={download.active || gameRunning}
            onSelect={setSpotlightInstanceId}
            onPlay={(instance) => void launch(instance)}
            onCreate={() => setPage("new-instance")}
          />
        ) : (
          <section className="desktop-dashboard">
            <header><h1>Your instances</h1><button onClick={() => setPage("new-instance")}><Plus size={16} />New instance</button></header>
            {instances.slice(0, 4).map(item => <div key={item.id} className="dashboard-instance"><LaunchFill activity={gameDownload} instanceId={item.id} />
              <button onClick={event => handleInstanceClick(event, item)} onDoubleClick={event => handleInstanceDoubleClick(event, item)}>
                {item.icon ? <img src={item.icon} alt="" /> : <Cuboid size={20} />}<span><strong>{item.name}</strong><small>{item.version} · {item.loader}</small></span>
              </button>
              <button disabled={download.active || gameRunning} aria-label={`Play ${item.name}`} onClick={() => void launch(item)}><LaunchFill activity={gameDownload} instanceId={item.id}/><Play size={16} />{instanceLaunchProgress(gameDownload, item.id) !== null ? "Launching…" : gameRunning && gameDownload.instanceId === item.id ? "Running…" : "Play"}</button>
            </div>)}
            {instances.length > 4 && <button onClick={() => setPage("instances")}>View all instances<ChevronRight size={15} /></button>}
            <h2>Launcher tools</h2>
            <div className="dashboard-tools">{[
              { Icon: PackageOpen, title: "Import modpack", action: importModpack },
              { Icon: FolderOpen, title: "Open game folder", action: () => invoke("open_game_folder").catch(error => showToolMessage(String(error), "error")) },
              { Icon: TerminalSquare, title: "Check Java", action: showJavaStatus },
              { Icon: Shield, title: "Repair installation", action: repairInstallation },
            ].map(({ Icon, title, action }) => <button key={title} onClick={() => void action()}><Icon size={17} />{title}</button>)}</div>
          </section>
        )}
        {page === "home" && settings.recommendations && <HomeStories />}
      <AskDelight sidebar={alulaSidebar} instances={instances} instanceId={chatContextPage === "instance" ? selectedInstance?.id : undefined} openDownloads={() => setPage("downloads")} createPack={async (pack, draftId, onQueued) => {
        if (gameRunning) throw new Error("Close Minecraft before installing the pack.");
        const instance = await invoke<InstanceDraft>("create_alula_instance", { packDraft: draftId, config: {
          id: "", name: pack.name, loader: "Fabric", version: pack.minecraft, directory: settings.gameDirectory,
          java: settings.java === "Automatic" ? "Automatic (Recommended)" : settings.java,
          memory: Number.parseInt(settings.memory, 10), jvmArguments: settings.javaArguments,
          mods: true, resourcePacks: true, shaderPacks: true, config: true, customResolution: false, visible: true, shortcut: false,
        }});
        setInstances(current => [...current.filter(item => item.id !== instance.id), instance]);
        onQueued(0);
        for (const [index, mod] of pack.mods.entries()) {
          await contentDownloads.enqueue({instanceId: instance.id, projectId: mod.id, category: "mods", title: mod.title, version: pack.minecraft, iconUrl: null});
          onQueued(index + 1);
        }
      }} active={page === "alula"} profileId={profile?.id ?? null} motion={settings.animations && !settings.ultraPerformance}
        context={{
          build: currentVersion.split(/[+-]/)[0],
          platform: /Mac/i.test(navigator.platform) ? "macos" : /Win/i.test(navigator.platform) ? "windows" : "linux",
          page: chatContextPage,
          loader: chatContextPage === "instance" && selectedInstance
            ? (selectedInstance.loader.toLowerCase() === "fabric" ? "fabric" : selectedInstance.loader.toLowerCase() === "vanilla" ? "vanilla" : null)
            : null,
        }}
        canNavigate={(action, id) => (action === "instance-memory" ? instances.some(item => item.id === id) : Object.hasOwn(alulaDestinations, action)) || action === "memory" || action === "instances" ||
          (chatContextPage === "instance" && Boolean(selectedInstance) && ["mods", "resourcepacks", "shaderpacks"].includes(action))}
        navigate={(action, id) => {
          if (Object.hasOwn(alulaDestinations, action)) {
            const target = alulaDestinations[action];
            if (target.section) {
              openSettings(target.section);
              return `[data-settings-section="${target.section}"] ${target.selector ?? "h2"}`;
            }
            if (action === "instance-memory" && id && instances.some(item => item.id === id)) {
              setSelectedInstanceId(id);
              setInstanceDestination("settings");
              setInstanceNavigationKey(value => value + 1);
              setPage("instance");
              return target.selector!;
            }
            return null;
          }
          if (action === "memory") { openSettings("Performance"); return '[data-ask-target="memory"] h2'; }
          if (action === "instances") { setPage("instances"); return '[data-ask-target="instances"]'; }
          if (chatContextPage !== "instance" || !selectedInstance || (action !== "mods" && action !== "resourcepacks" && action !== "shaderpacks")) return null;
          setInstanceDestination(action);
          setInstanceNavigationKey(value => value + 1);
          setPage("instance");
          return `[data-ask-target="${action}"][aria-selected="true"]`;
        }} />
      </main>
      {showWorkspacePanel && settings.rightSidebar === "Download Queue" && <DownloadQueueSidebar
        tasks={[
          ...(!gameDownload.launch && gameDownload.active && (gameDownload.state === "installing" || gameDownload.state === "launching") ? [{
            id: "minecraft", title: gameDownload.taskName || instances.find(item => item.id === gameDownload.instanceId)?.name || "Minecraft",
            status: gameDownload.state === "launching" ? "Starting" : "Downloading",
            progress: Math.round(gameDownload.progress),
          }] : []),
          ...contentDownloads.tasks.filter(contentPending).map(task => ({
            id: task.id, title: task.title,
            status: task.state === "queued" ? "Queued" : task.state === "cancelling" ? "Cancelling…" : "Downloading",
            progress: task.state === "queued" ? undefined : Math.round(task.progress),
          })),
        ]}
        openDownloads={() => setPage("downloads")} />}
      {showWorkspacePanel && settings.rightSidebar === "Custom Image" && <CustomImageSidebar image={sidebarImage.image} source={sidebarImage.source} rail={sidebarImage.rail} />}
      {showWorkspacePanel && settings.rightSidebar === "Friends" && <FriendsSidebar openSocial={friendId => {
        setSocialDestination({ friendId });
        setPage("social");
      }} />}
      {floatingInstance && <FloatingInstancePlayer instance={floatingInstance} busy={download.active || gameRunning} onPlay={() => void launch(floatingInstance)} onClose={() => { setFloatingInstanceId(null); document.querySelector<HTMLButtonElement>(".instance-more")?.focus(); }} />}
      {shareInstance && <ShareInstanceDialog instance={shareInstance} onClose={() => setShareInstance(null)} onNotify={(message, kind) => showToolMessage(message, kind === "error" ? "error" : "notification")} />}
      {updatePanelOpen && <dialog ref={updateDialog} className="launcher-update-dialog" aria-labelledby="update-title"
        onCancel={event => { event.preventDefault(); closeUpdateDialog(); }}>
        <h2 id="update-title">{updatePhase === "error" ? "Update interrupted" : updateBusy ? "Updating Delight Client" : "Update available"}</h2>
        <p className="update-versions">Delight Client {currentVersion} → {displayedUpdateVersion}</p>
        {updatePhase === "ready" && <>
          {updateNotes && <div className="update-notes">{updateNotes}</div>}
          <p>Delight will restart after installation.</p>
        </>}
        {updateBusy && <div role="status">
          <p>{updatePhase === "installing" ? "Installing and restarting…" : updateProgress === undefined ? "Downloading…" : `Downloading · ${Math.round(updateProgress)}%`}</p>
          <progress aria-label="Update progress" max={100} value={updateProgress} />
        </div>}
        {updatePhase === "error" && <p role="alert">{updateError}</p>}
        {!updateBusy && <footer>
          <button autoFocus onClick={closeUpdateDialog}>Later</button>
          <button onClick={() => void installUpdate()}>{updatePhase === "error" ? "Try again" : "Install and restart"}</button>
        </footer>}
      </dialog>}
      {crashPreview && <CrashDetails {...crashPreview} close={() => setCrashPreview(undefined)} />}
      {toast && <div className={`launch-toast ${toastKind}`} role={toastKind === "error" ? "alert" : "status"} aria-live={toastKind === "error" ? "assertive" : "polite"}><span>{toast}</span>{toastKind === "error" && failure && userError(failure.message) === toast && <button className="share-crash" onClick={previewFailure}>Share crash details</button>}</div>}
    </div>
    {contentTransfer.overlay}
    </ContentTransferContext.Provider></ShortcutContext.Provider>
  );
}
