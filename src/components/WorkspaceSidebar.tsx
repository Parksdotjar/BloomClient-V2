import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRightLeft, Crop, X } from "lucide-react";
import { invoke } from "../services/invoke";
import { Avatar, socialDirectoryChanged, userLabel, type SocialUser } from "./SocialPage";
import { defaultSidebarCrop, SidebarImageCrop, type SidebarCrop } from "./SidebarImageCrop";
import "./workspace-sidebar.css";

function WorkspaceSidebar({ title, children }: { title: string; children: ReactNode }) {
  return <aside className="workspace-rail" aria-label={title}>
    <div className="rail-column">
      <header className="rail-header"><h2 className="rail-title">{title}</h2></header>
      <div className="rail-scroll">{children}</div>
    </div>
  </aside>;
}

type QueueItem = { id: string; title: string; status: string; progress?: number };

export function DownloadQueueSidebar({ tasks, openDownloads }: { tasks: QueueItem[]; openDownloads: () => void }) {
  return <WorkspaceSidebar title="Download Queue">
    {tasks.length ? <ul className="rail-items">{tasks.map(task => <li key={task.id} className="rail-card">
      <b>{task.title}</b>
      <small>{task.status}{task.progress !== undefined && <> · {task.progress}%</>}</small>
      {task.progress !== undefined && <progress value={task.progress} max={100} aria-label={`${task.title} progress`} />}
    </li>)}</ul> : <p className="rail-note">No active or queued downloads.</p>}
    <button className="rail-action" onClick={openDownloads}>Open Downloads</button>
  </WorkspaceSidebar>;
}

async function sidebarImageStorage<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open("bloom-sidebar", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("images");
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("images", mode);
      const result = request(transaction.objectStore("images"));
      transaction.oncomplete = () => resolve(result.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

type SavedSidebarImage = { file: Blob; crop: SidebarCrop };

function sidebarCropStyle({ x, y, zoom }: SidebarCrop): CSSProperties {
  const position = `${x * 100}% ${y * 100}%`;
  return { objectPosition: position, transformOrigin: position, scale: zoom };
}

export function useSidebarImage(active: boolean) {
  const input = useRef<HTMLInputElement>(null);
  const rail = useRef<HTMLElement>(null);
  const [image, setImage] = useState<SavedSidebarImage | null>();
  const [source, setSource] = useState<string>();
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<"saving" | "removing" | "cropping" | null>(null);
  const file = image?.file;

  useEffect(() => {
    if (!active || image !== undefined) return;
    let current = true;
    void sidebarImageStorage<Blob | SavedSidebarImage | undefined>("readonly", store => store.get("selected"))
      .then(saved => {
        if (current) setImage(saved instanceof Blob ? { file: saved, crop: defaultSidebarCrop } : saved ?? null);
      })
      .catch(() => { if (current) { setImage(null); setError("Couldn’t load the saved image."); } });
    return () => { current = false; };
  }, [active, image]);

  useEffect(() => {
    if (!active || !file) { setSource(undefined); return; }
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [active, file]);

  async function save(file: File | null) {
    setError("");
    if (file && (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 32 * 1024 * 1024)) {
      setError("Choose a PNG, JPEG, or WebP image under 32 MB.");
      return;
    }
    setOperation(file ? "saving" : "removing");
    try {
      if (file) {
        const url = URL.createObjectURL(file);
        try {
          const preview = new Image();
          preview.src = url;
          await preview.decode();
        } finally { URL.revokeObjectURL(url); }
        const next = { file, crop: defaultSidebarCrop };
        await sidebarImageStorage("readwrite", store => store.put(next, "selected"));
        setImage(next);
      } else {
        await sidebarImageStorage("readwrite", store => store.delete("selected"));
        setImage(null);
      }
    } catch {
      setError(file ? "Couldn’t save that image. Try another file." : "Couldn’t remove the image. Try again.");
    } finally { setOperation(null); }
  }

  async function saveCrop(crop: SidebarCrop) {
    if (!image) return false;
    setError("");
    setOperation("cropping");
    try {
      const next = { ...image, crop };
      await sidebarImageStorage("readwrite", store => store.put(next, "selected"));
      setImage(next);
      return true;
    } catch {
      setError("Couldn’t save the crop. Try again.");
      return false;
    } finally { setOperation(null); }
  }

  return { image, source, rail, error, operation, input, choose: () => input.current?.click(), save, saveCrop, clearError: () => setError("") };
}

export function SidebarImageSettings({ image, source, rail, input, choose, save, saveCrop, clearError, error, operation }: ReturnType<typeof useSidebarImage>) {
  const artwork = useRef<HTMLImageElement>(null);
  const cropButton = useRef<HTMLButtonElement>(null);
  const [editor, setEditor] = useState<{ rail: HTMLElement; natural: { width: number; height: number } }>();

  function closeCrop() {
    setEditor(undefined);
    clearError();
    requestAnimationFrame(() => cropButton.current?.focus());
  }

  return <div className="sidebar-image-settings">
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Sidebar image file" hidden
      onChange={event => {
        const selected = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (selected) void save(selected);
      }} />
    <div className="sidebar-image-preview" role="group" aria-label="Sidebar image controls">
      {image && source ? <>
        <img ref={artwork} src={source} alt="Sidebar image preview" draggable={false} style={sidebarCropStyle(image.crop)} />
        <div className="sidebar-image-tools">
          <button type="button" className="sidebar-image-switch" aria-label="Switch Image" title="Switch Image" disabled={operation !== null} onClick={choose}>
            <ArrowRightLeft size={26} aria-hidden="true" />
          </button>
          <span className="sidebar-image-divider" aria-hidden="true" />
          <button ref={cropButton} type="button" className="sidebar-image-crop" aria-label="Adjust Crop" title="Adjust Crop" disabled={operation !== null}
            onClick={() => {
              const photo = artwork.current;
              if (photo?.naturalWidth && rail.current) {
                clearError();
                setEditor({ rail: rail.current, natural: { width: photo.naturalWidth, height: photo.naturalHeight } });
              }
            }}>
            <Crop size={26} aria-hidden="true" />
          </button>
          <button type="button" className="sidebar-image-remove" aria-label="Remove Image" title="Remove Image" disabled={operation !== null} onClick={() => void save(null)}>
            <X size={19} aria-hidden="true" />
          </button>
        </div>
      </> : <button className="sidebar-image-choose" type="button" disabled={image !== null || operation !== null} onClick={choose}>
        {operation === "saving" ? "Saving…" : image === null ? "Choose Image" : "Loading…"}
      </button>}
    </div>
    {image && (operation === "saving" || operation === "removing") &&
      <p className="sidebar-image-status" role="status">{operation === "saving" ? "Saving image…" : "Removing image…"}</p>}
    {editor && image && source
      ? <SidebarImageCrop source={source} natural={editor.natural} rail={editor.rail} initial={image.crop}
          busy={operation === "cropping"} error={error} onClose={closeCrop}
          onApply={crop => { void saveCrop(crop).then(saved => { if (saved) closeCrop(); }); }} />
      : error && <p role="alert">{error}</p>}
  </div>;
}

export function CustomImageSidebar({ image, source, rail }: Pick<ReturnType<typeof useSidebarImage>, "image" | "source" | "rail">) {
  return <aside ref={rail} className="workspace-rail workspace-rail-image" aria-label="Custom Image">
    {image && source
      ? <img src={source} alt="Custom sidebar image" draggable={false} style={sidebarCropStyle(image.crop)} />
      : <p className="rail-note">{image === null ? "Choose an image in Settings → General." : "Loading image…"}</p>}
  </aside>;
}

type Directory = { friends: SocialUser[] };

export function FriendsSidebar({ openSocial }: { openSocial: (friendId?: string) => void }) {
  const [directory, setDirectory] = useState<Directory>();
  const [status, setStatus] = useState<"loading" | "ready" | "signIn" | "username" | "unavailable">("loading");

  useEffect(() => {
    let mounted = true;
    let sequence = 0;
    let checking = false;
    async function refresh() {
      if (document.hidden || checking) return;
      const ticket = ++sequence;
      checking = true;
      try {
        const next = await invoke<Directory>("social_share_context");
        if (!mounted || ticket !== sequence) return;
        setDirectory(next);
        setStatus("ready");
      } catch (error) {
        if (!mounted || ticket !== sequence) return;
        setDirectory(undefined);
        const message = String(error);
        setStatus(message.startsWith("Sign in to your Delight account") ? "signIn"
          : message.startsWith("Choose your Delight username") ? "username" : "unavailable");
      } finally {
        if (ticket === sequence) checking = false;
      }
    }
    const invalidate = () => {
      ++sequence;
      checking = false;
      setDirectory(undefined);
      setStatus("loading");
      void refresh();
    };
    void refresh();
    const timer = window.setInterval(refresh, 45_000);
    window.addEventListener(socialDirectoryChanged, invalidate);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener(socialDirectoryChanged, invalidate);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const emptyText = {
    loading: "Loading friends…", ready: "No friends yet.", signIn: "Sign in to Delight to see your friends.",
    username: "Finish setting up your Delight account in Social.", unavailable: "Couldn’t load friends.",
  };
  return <WorkspaceSidebar title="Friends">
    {directory?.friends.length ? <ul className="rail-items">{directory.friends.map(friend => <li key={friend.id}>
      <button className="rail-friend" onClick={() => openSocial(friend.id)} aria-label={`Message ${userLabel(friend)}`}>
        <Avatar user={friend} />
        <span>{userLabel(friend)}</span>
      </button>
    </li>)}</ul> : <p className="rail-note" role="status">{emptyText[status]}</p>}
    <button className="rail-action" onClick={() => openSocial()}>Open Social</button>
  </WorkspaceSidebar>;
}
