import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeftIcon as ArrowLeft, CaretRightIcon as ChevronRight, CubeIcon as Cuboid, DownloadIcon as Download, FolderOpenIcon as FolderOpen, LinkIcon as Link2 } from "@phosphor-icons/react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import { formatBytes } from "../services/format-bytes";
import { FollowUpdateContext, hasUpdate } from "../services/follow-updates";
import { InstalledContentRow, type ContentCategory } from "./InstalledContentRow";
import { packContentCategories, PackContentTabs } from "./PackContentTabs";
import "./player-link.css";
import { isWorkspaceInvite } from "./WorkspaceInvitation";

type PlayerFile = { category: ContentCategory; fileName: string; enabled: boolean; size: number; source: "modrinth" | "delight" };
type PlayerRelease = {
  revision: number; creator: string; releaseNote: string;
  manifest: { name: string; minecraftVersion: string; loaderVersion: string; excludedFolders: string[]; files: PlayerFile[] };
};
type PackPreview = {
  playerUrl: string; release: PlayerRelease | null; reviewToken: string | null; downloadBytes: number; installedInstanceId: string | null;
};

function PlayerReleaseFiles({ files }: { files: PlayerFile[] }) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(() => Math.max(0,
    packContentCategories.findIndex(({ category }) => files.some(file => file.category === category))));
  const { category, label } = packContentCategories[selected];
  const visibleFiles = files.filter(file => file.category === category);
  const select = (index: number) => {
    if (index === selected) return;
    if (list.current && tabs.current && list.current.getBoundingClientRect().top < tabs.current.getBoundingClientRect().top - 1) {
      list.current.scrollIntoView({ block: "start", behavior: "instant" });
    }
    setSelected(index);
  };
  return <div className="player-release-files" ref={list}>
    <PackContentTabs id={id} selected={selected} onSelect={select} tabsRef={tabs} />
    <div className="pack-contents-panel instance-content-list-shell" id={id + "-files"}
      role="tabpanel" aria-labelledby={id + category} tabIndex={0}>
      {visibleFiles.length ? <>
        <div className="desktop-content-columns pack-contents-columns" aria-hidden="true"><span>Name</span><span>Status</span></div>
        <ul className="pack-contents-list">{visibleFiles.map(file => <InstalledContentRow key={file.fileName} category={category} loader="Fabric"
          item={{...file, id: file.fileName, name: file.fileName.replace(/\.disabled$/i, ""), version: file.source === "modrinth" ? "Modrinth" : "Delight" }}/>)}</ul>
      </> : <p>No {label.toLowerCase()}.</p>}
    </div>
  </div>;
}

export function PlayerLinkPage({ initialLink, instances, otherInstallActive, onBack, onInstallLinkChange, onOpen, onInviteLink, onOpenEditor }: {
  initialLink: string;
  instances: { id: string; name: string }[];
  otherInstallActive: boolean;
  onBack: () => void;
  onInviteLink: (link: string) => void;
  onOpenEditor: (id: string, stillHere: () => boolean) => Promise<void>;
  onInstallLinkChange: (link: string | null) => void;
  onOpen: (id: string, stillHere: () => boolean, showUpdate: boolean) => Promise<void>;
}) {
  const [link, setLink] = useState(initialLink);
  const [request, setRequest] = useState(initialLink ? { link: initialLink } : null);
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [loading, setLoading] = useState(!!initialLink);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [recheck, setRecheck] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const active = useRef(true);
  const locked = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const release = preview?.release;
  const installed = preview?.installedInstanceId;
  const follow = useContext(FollowUpdateContext)!;
  const checkUpdate = follow.check;
  const updateAvailable = !!installed && hasUpdate(follow.reviews[installed]);
  useEffect(() => {
    if (installed) void checkUpdate(installed).catch(() => {});
  }, [installed, checkUpdate]);
  const localName = instances.find(item => item.id === installed)?.name;
  const playerUrl = preview?.playerUrl;
  useEffect(() => {
    let current = true;
    setCanEdit(false);
    if (playerUrl) void invoke<boolean>("workspace_can_edit", {playerUrl})
      .then(value => { if (current) setCanEdit(value === true); }).catch(() => {});
    return () => { current = false; };
  }, [playerUrl]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (!request) return;
    let current = true;
    setLoading(true); setError(""); setRecheck(false);
    void invoke<PackPreview>("preview_player_pack", { link: request.link }).then(result => {
      if (current) setPreview(result);
    }).catch(reason => { if (current) { setError(userError(reason)); setPreview(null); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [request]);
  useLayoutEffect(() => {
    if (preview) title.current?.focus();
    else if (!loading) input.current?.focus();
  }, [preview, loading]);

  const installOrOpen = async () => {
    if (!preview || locked.current || (!installed && (!preview.reviewToken || otherInstallActive))) return;
    locked.current = true;
    if (!installed) onInstallLinkChange(preview.playerUrl);
    setError(""); setInstalling(true);
    try {
      const id = installed ?? await invoke<string>("install_followed_pack", { link: preview.playerUrl, reviewToken: preview.reviewToken });
      if (active.current && !installed) setPreview({ ...preview, installedInstanceId: id });
      await onOpen(id, () => active.current, updateAvailable);
    } catch (reason) {
      if (active.current) {
        const message = userError(reason);
        setError(message); setRecheck(message === "The release changed since your preview. Open the preview again before installing.");
      }
    } finally {
      locked.current = false;
      if (!installed) onInstallLinkChange(null);
      if (active.current) setInstalling(false);
    }
  };

  const back = () => {
    if (!preview) { onBack(); return; }
    setRequest(null); setPreview(null); setError(""); setRecheck(false);
  };
  const openEditor = async () => {
    if (!playerUrl || locked.current || follow.busy) return;
    locked.current = true;
    setOpeningEditor(true);
    setError("");
    onInstallLinkChange(playerUrl);
    try {
      const id = await invoke<string>("create_workspace_working_copy", {playerUrl});
      await onOpenEditor(id, () => active.current);
    } catch (reason) {
      if (active.current) setError(userError(reason));
    } finally {
      locked.current = false;
      onInstallLinkChange(null);
      if (active.current) setOpeningEditor(false);
    }
  };
  return <section className="instance-workspace pack-workspace-overview player-link-page" aria-label="Open player link">
    <div className="desktop-breadcrumb"><Cuboid size={16} aria-hidden="true" />Instances<ChevronRight size={13} aria-hidden="true" /><strong>Shared pack</strong></div>
    <header className="instance-hero-panel"><div className="instance-hero-main">
      <div className="instance-identity">
        <span className="pack-workspace-art">{preview ? <Cuboid aria-hidden="true"/> : <Link2 aria-hidden="true"/>}</span>
        <div><h1 ref={title} tabIndex={-1}>{release?.manifest.name || localName || (installed ? "Followed pack" : "Open player link")}</h1>
          {release && <p>Shared by {release.creator}</p>}</div>
      </div>
      {preview && <div className="instance-hero-actions">
        {canEdit && <button type="button" className="settings-action" disabled={installing || openingEditor || follow.busy}
          onClick={() => void openEditor()}>{openingEditor ? "Preparing working copy…" : "Open working copy"}</button>}
        <button type="button" className="instance-play ceramic-action pack-workspace-action" disabled={installing || openingEditor || loading || recheck || (!installed && otherInstallActive)}
          onClick={() => void installOrOpen()}>{installed && !updateAvailable ? <FolderOpen size={16}/> : <Download size={16}/>}
          {installing ? installed ? "Opening…" : "Installing…" : updateAvailable ? "View update" : installed ? "Open instance" : "Install & follow"}</button>
      </div>}
    </div></header>
    {!preview ? <form className="player-link-form" onSubmit={event => {
      event.preventDefault();
      const value = link.trim();
      if (isWorkspaceInvite(value)) onInviteLink(value);
      else if (value) setRequest({link:value});
    }}>
      <label className="creation-field"><span>Player link</span><input ref={input} value={link} onChange={event => {
        setLink(event.target.value); setRequest(null); setLoading(false); setError("");
      }} placeholder="Paste a Delight player link" autoCapitalize="off" spellCheck={false} autoComplete="off" /></label>
      {error && <p className="player-link-error" role="alert">{error}</p>}
      <div className="player-link-actions"><button type="button" className="settings-action" onClick={back}><ArrowLeft size={15}/>Back</button>
        <button type="submit" className="instance-play ceramic-action pack-workspace-action" disabled={loading || !link.trim()}>
          {loading ? "Opening preview…" : "Preview pack"}<ChevronRight size={15}/></button></div>
    </form> : <div className="pack-contents-review pack-release-preview">
      {release && <dl className="pack-release-facts">
        <div><dt>{installed ? "Installed release" : "Release"}</dt><dd>Version {release.revision}</dd></div>
        <div><dt>Minecraft</dt><dd>{release.manifest.minecraftVersion}</dd></div>
        <div><dt>Loader</dt><dd>Fabric {release.manifest.loaderVersion}</dd></div>
        {!installed && <div><dt>Pack download</dt><dd>{formatBytes(preview.downloadBytes)}</dd></div>}
        {installed && localName && localName !== release.manifest.name && <div><dt>Installed as</dt><dd>{localName}</dd></div>}
        {release.manifest.excludedFolders.length > 0 && <div><dt>Excluded folders</dt><dd>{release.manifest.excludedFolders.join(", ")}</dd></div>}
      </dl>}
      {release?.releaseNote && <section className="player-release-note"><h2>Release note</h2><p>{release.releaseNote}</p></section>}
      {!installed && !installing && otherInstallActive && <p role="status">Another shared pack is installing.</p>}
      {error && <p role="alert" className="player-link-error">{error}</p>}
      {recheck && <button className="settings-action" disabled={loading} onClick={() => setRequest({link: preview.playerUrl})}>Refresh preview</button>}
      {release && <PlayerReleaseFiles key={preview.playerUrl} files={release.manifest.files} />}
      <button type="button" className="settings-action player-back" disabled={installing || loading} onClick={back}><ArrowLeft size={15}/>Back to player link</button>
    </div>}
  </section>;
}
