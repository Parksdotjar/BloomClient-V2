import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Bell, CheckCheck, ChevronRight, CircleAlert, Download, Package, PackageCheck, Pause, Play, SkipBack, SkipForward, TriangleAlert, Volume2, VolumeX, X } from "lucide-react";
import type { ClientNotice } from "../services/client-notice";
import type { NotificationItem } from "../services/notification-center";
import type { DesktopNowPlaying, NowPlayingAction, NowPlayingVolume } from "../services/now-playing";
import type { TitleBarLaunchProgress } from "../services/use-titlebar-launch-progress";
import { DesktopIslandUpdate, type DesktopLauncherUpdate } from "./DesktopIslandUpdate";
import { CosmeticConfetti, CosmeticUnlockArtwork, type DesktopCosmeticUnlock } from "./DesktopCosmeticUnlock";
import "./desktop-notifications.css";

const notificationContent = {
  modUpdateCompleted: { title: "Mods updated", action: "View Downloads", icon: PackageCheck },
  modUpdateFailed: { title: "Mod update failed", action: "Open Mods", icon: CircleAlert },
  launcherUpdate: { title: "Delight Client update available", action: "View update", icon: Download },
  followedRelease: { title: "New pack release", action: "View release", icon: Package },
} as const;
const notificationTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const notificationClock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const notificationDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const NOTICE_PREVIEW_WORDS = 12;
const COSMETIC_UNLOCK_DISPLAY_MS = 6_000;
const COSMETIC_UNLOCK_WAIT_MS = 15_000;

function previewNotice(message: string) {
  const words = message.trim().split(/\s+/u);
  const preview = words.slice(0, NOTICE_PREVIEW_WORDS).join(" ");
  return words.length > NOTICE_PREVIEW_WORDS ? `${preview}…` : preview;
}

export type DesktopNotifications = {
  items: NotificationItem[];
  onShow?: () => void;
  onOpenItem: (item: NotificationItem) => void | Promise<void>;
  onMarkAllRead: () => void | Promise<void>;
  loadError?: boolean;
  onRetry?: () => void;
};

function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: () => void }) {
  const content = notificationContent[item.kind];
  const title = item.modId ? "Attention needed" : content.title;
  const action = item.modId ? "Choose version" : content.action;
  const Icon = item.modId ? CircleAlert : content.icon;
  const date = new Date(item.createdAt);
  const now = new Date();
  const validDate = Number.isFinite(date.getTime());
  const timestamp = !validDate ? null : date.toDateString() === now.toDateString()
    ? notificationClock.format(date)
    : date.getFullYear() === now.getFullYear() ? notificationDay.format(date) : notificationTime.format(date);
  const detail = [
    item.instanceName,
    item.modId,
    item.version && `Version ${item.version}`,
    item.available ? item.required && "Required before play" : "Unavailable",
  ].filter(Boolean).join(" · ");
  const row = <>
    <span className="desktop-notification-icon" aria-hidden="true"><Icon size={15} /></span>
    <span className="desktop-notification-description">
      <span className="desktop-notification-heading">
        <span className="desktop-notification-title">{title}</span>
        {timestamp && <time dateTime={date.toISOString()} title={notificationTime.format(date)}>{timestamp}</time>}
      </span>
      {detail && <span className="desktop-notification-detail">{detail}</span>}
    </span>
  </>;
  if (!item.available && item.read) return <div className="desktop-notification-row">{row}</div>;

  const itemAction = item.available ? action : "Mark as read";
  return <button
    type="button"
    className="desktop-notification-row"
    data-unread={!item.read}
    aria-label={[title, detail, !item.read && "Unread", itemAction].filter(Boolean).join(", ")}
    title={itemAction}
    onClick={onOpen}
  >
    {row}
    <span className="desktop-notification-indicator" aria-hidden="true">
      {!item.read && <span className="desktop-notification-row-dot" />}
      <ChevronRight className="desktop-notification-chevron" size={13} />
    </span>
  </button>;
}

type IslandPanel = { kind: "update"; version: string } | { kind: "notifications" } | { kind: "media"; sessionId: string } | { kind: "notice"; id: string };
type IslandDetail = "notifications" | "notice";

export function DesktopNotificationCenter({
  center, notificationRequest, launcherUpdate, launchProgress, onCancelLaunch, clientNotice,
  cosmeticUnlock, onDismissCosmeticUnlock, onOpenUnlockedCloak,
  nowPlaying, onNowPlayingControl, nowPlayingVolume, onNowPlayingVolumeChange, onNowPlayingDetailsChange, motion,
}: {
  center: DesktopNotifications;
  notificationRequest?: number;
  launcherUpdate?: DesktopLauncherUpdate;
  clientNotice?: ClientNotice | null;
  cosmeticUnlock?: DesktopCosmeticUnlock;
  onDismissCosmeticUnlock?: (sequence: number) => void;
  onOpenUnlockedCloak?: (item: DesktopCosmeticUnlock) => void;
  launchProgress?: TitleBarLaunchProgress;
  onCancelLaunch?: () => void;
  nowPlaying?: DesktopNowPlaying;
  onNowPlayingControl?: (sessionId: string, action: NowPlayingAction) => void;
  nowPlayingVolume?: NowPlayingVolume | null;
  onNowPlayingVolumeChange?: (sessionId: string, level: number) => void;
  onNowPlayingDetailsChange?: (sessionId: string | null) => void;
  motion: boolean;
}) {
  const panelId = useId();
  const volumeId = useId();
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const detailContent = useRef<HTMLDivElement>(null);
  const textMeasure = useRef<HTMLDivElement>(null);
  const lastNoticeId = useRef<string | undefined>(undefined);
  const trigger = useRef<HTMLElement | null>(null);
  const transportButton = useRef<HTMLButtonElement>(null);
  const transportHadFocus = useRef(false);
  const focusWasInside = useRef(false);
  const handledUpdateRequest = useRef(0);
  const handledNotificationsRequest = useRef(0);
  const displayedCosmetic = useRef<number | undefined>(undefined);
  const [focusedCosmetic, setFocusedCosmetic] = useState<number>();
  const [panel, setPanel] = useState<IslandPanel | null>(null);
  const [lastDetail, setLastDetail] = useState<IslandDetail | null>(null);
  const [hoveringLaunch, setHoveringLaunch] = useState(false);
  const [focusedLaunch, setFocusedLaunch] = useState(false);
  const [dismissedLaunch, setDismissedLaunch] = useState(false);
  const installingUpdate = launcherUpdate?.phase === "downloading" || launcherUpdate?.phase === "installing" || launcherUpdate?.phase === "restarting";
  const updateVersion = launcherUpdate?.version;
  const showingUpdate = !installingUpdate && !launchProgress && !!updateVersion &&
    panel?.kind === "update" && panel.version === updateVersion;
  const canShowCosmetic = !!(cosmeticUnlock && onDismissCosmeticUnlock && onOpenUnlockedCloak);
  const face = installingUpdate || showingUpdate ? "update" : launchProgress?.phase ??
    (clientNotice ? "notice" : canShowCosmetic ? "cosmetic" : launcherUpdate ? "update" : nowPlaying ? "media" : "notifications");
  const showingLaunch = face === "launching" || face === "launched";
  const canCancel = face === "launching" && !!onCancelLaunch;
  const launchExpanded = canCancel && !dismissedLaunch && (hoveringLaunch || focusedLaunch);
  const showingNotice = face === "notice" && panel?.kind === "notice" && panel.id === clientNotice?.id;
  const mediaDetails = face === "media" && panel?.kind === "media" && panel.sessionId === nowPlaying?.sessionId ? panel.sessionId : null;
  const showingNotifications = !showingLaunch && panel?.kind === "notifications";
  const detail: IslandDetail | null = showingNotice ? "notice" : showingNotifications ? "notifications" : null;
  const expanded = detail !== null;
  // Retain the previous body during retraction. Inert makes its actions unavailable immediately.
  const canRetainDetail = lastDetail !== "notice" || (face === "notice" && clientNotice?.id === lastNoticeId.current);
  const visibleDetail = detail ?? (motion && canRetainDetail ? lastDetail : null);
  const unread = center.items.some(item => !item.read);
  const updateRequest = launcherUpdate?.request;
  const notificationLabel = unread ? "Notifications, unread" : "Notifications";
  const notificationTooltip = showingNotifications ? undefined : "Notifications";
  const reportedPercent = launchProgress?.percent ?? 0;
  const percent = Number.isFinite(reportedPercent) ? Math.max(0, Math.min(100, Math.round(reportedPercent))) : 0;
  const mediaTransport = nowPlaying?.isPlaying ? "pause" : "play";
  const canControlMedia = !!onNowPlayingControl && (nowPlaying?.isPlaying ? nowPlaying.canPause : nowPlaying?.canPlay);
  const MediaIcon = nowPlaying?.isPlaying ? Pause : Play;
  const artist = nowPlaying?.artist.trim();
  const trackArtist = artist && artist.toLowerCase() !== nowPlaying?.title.trim().toLowerCase()
    && artist.toLowerCase() !== nowPlaying?.source.trim().toLowerCase() ? artist : undefined;
  const volumePercent = nowPlayingVolume ? Math.round(nowPlayingVolume.level * 100) : undefined;
  const VolumeIcon = nowPlayingVolume?.muted || volumePercent === 0 ? VolumeX : Volume2;
  const pcVolume = nowPlayingVolume?.scope === "system";
  const noticeId = clientNotice?.id;
  const noticePreview = clientNotice ? previewNotice(clientNotice.message) : "";
  const cosmeticSequence = cosmeticUnlock?.sequence;
  const cosmeticReceivedAt = cosmeticUnlock?.receivedAt;
  const faceIdentity = face === "notice" ? noticeId : face === "media" ? nowPlaying?.sessionId
    : face === "cosmetic" ? cosmeticSequence : face === "update" ? updateVersion : showingLaunch ? launchProgress?.id : "";

  useEffect(() => {
    if (cosmeticSequence === undefined || cosmeticReceivedAt === undefined || !onDismissCosmeticUnlock) return;
    const dismiss = () => onDismissCosmeticUnlock(cosmeticSequence);
    if (face !== "cosmetic" && displayedCosmetic.current === cosmeticSequence) {
      dismiss();
      return;
    }

    let duration = Math.max(0, cosmeticReceivedAt + COSMETIC_UNLOCK_WAIT_MS - Date.now());
    if (face === "cosmetic") {
      displayedCosmetic.current = cosmeticSequence;
      if (focusedCosmetic === cosmeticSequence) return;
      duration = COSMETIC_UNLOCK_DISPLAY_MS;
    }
    const timer = window.setTimeout(dismiss, duration);
    return () => window.clearTimeout(timer);
  }, [cosmeticSequence, cosmeticReceivedAt, face, focusedCosmetic, onDismissCosmeticUnlock]);

  useEffect(() => {
    setPanel(current => showingLaunch || (current?.kind === "update" && current.version !== updateVersion) ||
      (current?.kind === "notice" && (face !== "notice" || current.id !== noticeId)) ||
      (current?.kind === "media" && current.sessionId !== mediaDetails) ? null : current);
  }, [updateVersion, face, mediaDetails, noticeId, showingLaunch]);
  useEffect(() => onNowPlayingDetailsChange?.(mediaDetails), [mediaDetails, onNowPlayingDetailsChange]);
  useLayoutEffect(() => {
    const island = root.current;
    const text = textMeasure.current;
    if (!island || !text) return;

    // Measure the full preview text independently of the pill's animated width.
    const measure = () => island.style.setProperty("--desktop-island-text-width", `${Math.ceil(text.getBoundingClientRect().width)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => {
      observer.disconnect();
      island.style.removeProperty("--desktop-island-text-width");
    };
  }, [face, faceIdentity]);
  useLayoutEffect(() => {
    const box = surface.current;
    const content = detailContent.current;
    if (!box || !content) return;
    if (!detail) {
      box.style.removeProperty("--desktop-island-detail-height");
      return;
    }
    setLastDetail(detail);
    if (detail === "notice") lastNoticeId.current = noticeId;
    const measure = () => {
      box.style.setProperty("--desktop-island-detail-height", `${content.getBoundingClientRect().height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [detail, noticeId]);
  useLayoutEffect(() => {
    if (focusWasInside.current && !root.current?.contains(document.activeElement)) {
      const nextFocus = (transportHadFocus.current && face === "media" ? transportButton.current : null) ?? trigger.current;
      nextFocus?.focus();
    }
  }, [face, faceIdentity, expanded, showingUpdate, installingUpdate, mediaTransport, canControlMedia]);
  useEffect(() => {
    if (!canCancel) {
      setHoveringLaunch(false);
      setFocusedLaunch(false);
      setDismissedLaunch(false);
    }
  }, [canCancel]);
  useEffect(() => {
    if (!updateRequest || handledUpdateRequest.current === updateRequest) return;
    handledUpdateRequest.current = updateRequest;
    if (updateVersion && !showingLaunch) {
      if (!installingUpdate) setPanel({ kind: "update", version: updateVersion });
      focusWasInside.current = true;
      if (face === "update") trigger.current?.focus();
    }
  }, [face, installingUpdate, showingLaunch, updateRequest, updateVersion]);
  useEffect(() => {
    if (!notificationRequest || handledNotificationsRequest.current === notificationRequest) return;
    handledNotificationsRequest.current = notificationRequest;
    if (!showingLaunch) {
      center.onShow?.();
      setPanel({ kind: "notifications" });
      trigger.current?.focus();
    }
  }, [center, notificationRequest, showingLaunch]);
  useEffect(() => {
    if (!expanded && !showingUpdate && !mediaDetails && !launchExpanded) return;
    const close = () => {
      focusWasInside.current = false;
      setPanel(null);
      if (launchExpanded) setDismissedLaunch(true);
    };
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", close);
    };
  }, [expanded, showingUpdate, mediaDetails, launchExpanded]);

  return <div
    ref={root}
    className="desktop-notification-center"
    data-face={face}
    data-motion={motion ? "on" : "off"}
    data-launch-state={showingLaunch ? face : "idle"}
    data-update-confirm={showingUpdate || undefined}
    data-update-active={installingUpdate || undefined}
    data-expanded={expanded || undefined}
    data-details={visibleDetail || undefined}
    data-notice-reading={showingNotice || undefined}
    data-volume-open={!!mediaDetails || undefined}
    data-launch-cancel={launchExpanded || undefined}
    onKeyDown={event => {
      if ((!expanded && !showingUpdate && !mediaDetails && !launchExpanded) || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPanel(null);
      trigger.current?.focus();
      if (launchExpanded) setDismissedLaunch(true);
    }}
    onPointerEnter={event => {
      if (canCancel && event.pointerType !== "touch") {
        setHoveringLaunch(true);
        setDismissedLaunch(false);
      }
    }}
    onPointerLeave={() => setHoveringLaunch(false)}
    onFocusCapture={event => {
      focusWasInside.current = true;
      transportHadFocus.current = document.activeElement === transportButton.current;
      if (canCancel && !event.currentTarget.contains(event.relatedTarget)) {
        setFocusedLaunch(true);
        setDismissedLaunch(false);
      }
    }}
    onBlur={event => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      if (canCancel) setFocusedLaunch(false);
      if (event.relatedTarget) {
        focusWasInside.current = false;
        setPanel(null);
      }
    }}
  >
    <div className="desktop-island-notice-announcement" role="status">
      {face === "notice" && clientNotice ? `Delight notice: ${clientNotice.message}` : ""}
    </div>
    {face === "cosmetic" && <CosmeticConfetti key={cosmeticSequence} motion={motion} />}
    <div className="desktop-island-surface" ref={surface}>
      <div className="desktop-island-compact">
        {face === "launching" ? <div className="desktop-notification-launch">
          <div ref={node => { trigger.current = node; }} className="desktop-notification-launch-progress"
            role="progressbar" aria-label="Launching Minecraft" tabIndex={canCancel ? 0 : undefined}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span className="desktop-notification-launch-track">
              <span key={launchProgress?.id} style={{ "--launch-fill": percent / 100 } as CSSProperties} />
            </span>
            <span className="desktop-notification-launch-percent">{percent}%</span>
          </div>
          {canCancel && <button type="button" className="desktop-island-cancel-launch" aria-label="Cancel launch"
            inert={!launchExpanded} onClick={onCancelLaunch}><X size={15} aria-hidden="true" /></button>}
        </div> : face === "launched" ? <span ref={node => { trigger.current = node; }}
          className="desktop-notification-launch-complete" role="status" tabIndex={-1}>Launched</span> :
          face === "cosmetic" && cosmeticUnlock ? <div key={cosmeticUnlock.sequence} className="desktop-island-cosmetic-face">
            <CosmeticUnlockArtwork textureUrl={cosmeticUnlock.textureUrl} />
            <span className="desktop-island-cosmetic-label" role="status">Cosmetic unlocked</span>
            <button ref={node => { trigger.current = node; }} className="desktop-island-cosmetic-equip" type="button"
              aria-label={`Equip ${cosmeticUnlock.name}`}
              onFocus={() => setFocusedCosmetic(cosmeticUnlock.sequence)} onBlur={() => setFocusedCosmetic(undefined)}
              onClick={() => { setPanel(null); onOpenUnlockedCloak?.(cosmeticUnlock); }}>Equip</button>
          </div> :
          face === "notice" && clientNotice ? <button key={`notice-${clientNotice.id}`} ref={node => { trigger.current = node; }}
            type="button" className="desktop-notification-trigger desktop-island-notice-trigger"
            aria-label="Delight notice" aria-expanded={showingNotice} aria-controls={showingNotice ? panelId : undefined}
            onClick={() => setPanel(showingNotice ? null : { kind: "notice", id: clientNotice.id })}>
            <TriangleAlert className="desktop-island-notice-icon" size={16} aria-hidden="true" />
            <span className="desktop-island-notice-preview">{noticePreview}</span>
          </button> :
          face === "media" && nowPlaying ? <div key={nowPlaying.sessionId}
            className="desktop-island-media-face" role="group" aria-label="Now Playing">
            {nowPlaying.appIcon && <img key={nowPlaying.appIcon} className="desktop-island-media-app" src={nowPlaying.appIcon}
              alt="" hidden onError={event => { event.currentTarget.hidden = true; }}
              onLoad={event => { event.currentTarget.hidden = false; }} />}
            <div className="desktop-island-media-copy" title={[nowPlaying.title, trackArtist].filter(Boolean).join(" – ")}>
              <span className="desktop-island-media-title">{nowPlaying.title}</span>
              {trackArtist && <span className="desktop-island-media-artist">{" – "}{trackArtist}</span>}
            </div>
            <div className="desktop-island-media-transport">
              <button type="button" className="desktop-island-media-control" aria-label="Previous track"
                disabled={!onNowPlayingControl || !nowPlaying.canPrevious}
                onClick={() => onNowPlayingControl?.(nowPlaying.sessionId, "previous")}><SkipBack size={13} /></button>
              <button ref={transportButton} type="button"
                className="desktop-island-media-control desktop-island-media-primary" disabled={!canControlMedia}
                aria-label={nowPlaying.isPlaying ? "Pause" : "Play"}
                onClick={() => onNowPlayingControl?.(nowPlaying.sessionId, mediaTransport)}><MediaIcon size={14} /></button>
              <button type="button" className="desktop-island-media-control" aria-label="Next track"
                disabled={!onNowPlayingControl || !nowPlaying.canNext}
                onClick={() => onNowPlayingControl?.(nowPlaying.sessionId, "next")}><SkipForward size={13} /></button>
              <button type="button" className="desktop-island-media-control" ref={node => { trigger.current = node; }}
                aria-label="Volume" aria-expanded={!!mediaDetails} aria-controls={volumeId} disabled={!onNowPlayingDetailsChange}
                onClick={() => setPanel(mediaDetails ? null : { kind: "media", sessionId: nowPlaying.sessionId })}><VolumeIcon size={14} /></button>
              <div className="desktop-island-media-volume" id={volumeId} inert={!mediaDetails} data-pc-volume={pcVolume || undefined}>
                {mediaDetails && (volumePercent !== undefined && onNowPlayingVolumeChange
                  ? <>
                    {pcVolume && <span className="desktop-island-volume-scope" aria-hidden="true">PC</span>}
                    <input key={`${nowPlayingVolume?.scope}:${nowPlayingVolume?.targetId ?? ""}`}
                      type="range" min={0} max={100} step={1} className="desktop-island-media-volume-slider"
                      aria-label={pcVolume ? "PC volume" : "App volume"}
                      aria-valuetext={`${volumePercent}%${nowPlayingVolume?.muted ? ", muted" : ""}`}
                      value={volumePercent} style={{ "--media-volume-fill": `${volumePercent}%` } as CSSProperties}
                      onChange={event => onNowPlayingVolumeChange(nowPlaying.sessionId, event.currentTarget.valueAsNumber / 100)} />
                  </>
                  : <span className="desktop-island-media-volume-status" role="status">
                    {nowPlayingVolume === undefined ? "Loading…" : "Volume unavailable"}
                  </span>)}
              </div>
            </div>
          </div> : face === "update" && launcherUpdate ? <DesktopIslandUpdate key={launcherUpdate.version}
            update={launcherUpdate} active={installingUpdate} confirming={showingUpdate}
            measure={textMeasure} focus={node => { trigger.current = node; }}
            onOpen={() => {
              focusWasInside.current = true;
              setPanel({ kind: "update", version: launcherUpdate.version });
            }}
            onDismiss={() => {
              focusWasInside.current = true;
              setPanel(null);
            }} /> : <button ref={node => { trigger.current = node; }}
            type="button" className="desktop-notification-trigger"
            aria-label={notificationLabel} title={notificationTooltip}
            aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
            onClick={() => {
              if (!showingNotifications) center.onShow?.();
              setPanel(showingNotifications ? null : { kind: "notifications" });
            }}>
            <span className="desktop-notification-trigger-icon" aria-hidden="true">
              <span className="desktop-notification-bell">
                <Bell size={16} strokeWidth={1.65} />
                {unread && <span className="desktop-notification-dot" />}
              </span>
            </span>
          </button>}
        {showingNotifications && unread && <button type="button" className="desktop-notification-mark-all"
          aria-label="Mark all as read" title="Mark all as read" onClick={() => {
            trigger.current?.focus();
            void center.onMarkAllRead();
          }}><CheckCheck size={15} aria-hidden="true" /></button>}
      </div>
      {face === "media" && nowPlaying && <div aria-hidden="true" className="desktop-island-text-measure" ref={textMeasure}>
        {nowPlaying.title}{trackArtist && <span className="desktop-island-media-artist">{" – "}{trackArtist}</span>}
      </div>}
      {face === "notice" && clientNotice && <div aria-hidden="true" className="desktop-island-text-measure" ref={textMeasure}>{noticePreview}</div>}
      <div className="desktop-island-details" ref={detailContent} inert={!expanded}>
        {visibleDetail && <section id={panelId} className="desktop-notification-panel"
          aria-label={visibleDetail === "notice" ? "Delight notice" : "Notifications"}>
          {visibleDetail === "notice" && clientNotice ? <div className="desktop-island-notice-message" tabIndex={0}>{clientNotice.message}</div>
            : visibleDetail === "notifications" && <>
            {center.loadError && <div className="desktop-notification-empty">
              <p role="status">Couldn’t load notifications.</p>
              {center.onRetry && <button type="button" className="desktop-notification-text-button" onClick={() => {
                trigger.current?.focus();
                center.onRetry?.();
              }}>Try again</button>}
            </div>}
            {center.items.length ? <ul className="desktop-notification-list">
              {center.items.map(item => <li key={item.id}>
                <NotificationRow item={item} onOpen={() => {
                  if (item.available) setPanel(null);
                  trigger.current?.focus();
                  void center.onOpenItem(item);
                }} />
              </li>)}
            </ul> : !center.loadError && <p className="desktop-notification-empty">No notifications yet.</p>}
          </>}
        </section>}
      </div>
    </div>
  </div>;
}
