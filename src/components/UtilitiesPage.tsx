import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileCog,
  FolderOpen,
  Image as ImageIcon,
  Mic,
  RefreshCw,
  Save,
  Server,
  Share2,
  ShieldCheck,
  Sparkles,
  Users,
  WandSparkles,
} from "lucide-react";
import "./utilities.css";

export type UtilityInstance = {
  id: string;
  name: string;
  version: string;
};

type GlobalFileSyncSettings = {
  optionsSource: string | null;
  serversSource: string | null;
  voiceChatSource: string | null;
  voiceChatTargets: string[];
  shareResourcePacks: boolean;
  shareShaderPacks: boolean;
};

type UtilitySyncStatus = {
  key: UtilityKey;
  configured: boolean;
  sourceExists: boolean;
  affectedInstances: number;
  activeInstances: number;
  sharedPath: string | null;
};

type GlobalFileSyncState = {
  settings: GlobalFileSyncSettings;
  statuses: UtilitySyncStatus[];
  backupRoot: string;
};

type GlobalFileSyncReport = {
  changedFiles: number;
  unchangedFiles: number;
  linkedFolders: number;
  detachedFolders: number;
  backupPath: string | null;
};

type UtilityKey = "options" | "servers" | "voicechat" | "resourcepacks" | "shaderpacks";
type SelectControlProps = { value: string; options: string[]; onChange: (value: string) => void };
type ModpackShare = { code: string; url: string; expiresAt: string };
export type ModpackShareImport = { instanceId: string; missingMods: string[] };
type PackChannel = { code: string; url: string; revision: number; editorCount: number };
type PackChannelState = { instanceId: string; code: string; revision: number; latestRevision: number; role: "owner" | "editor" | "member"; editorCount: number; updateAvailable: boolean };

const defaultSettings: GlobalFileSyncSettings = {
  optionsSource: null,
  serversSource: null,
  voiceChatSource: null,
  voiceChatTargets: [],
  shareResourcePacks: false,
  shareShaderPacks: false,
};

const sourceKeys: Record<"options" | "servers" | "voicechat", keyof GlobalFileSyncSettings> = {
  options: "optionsSource",
  servers: "serversSource",
  voicechat: "voiceChatSource",
};

function UtilityToggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <button type="button" className={`utility-toggle ${checked ? "on" : ""}`} aria-pressed={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}

export function UtilitiesPage({
  instances,
  SelectControl,
  onOpenAutoTune,
  onMessage,
}: {
  instances: UtilityInstance[];
  SelectControl: ComponentType<SelectControlProps>;
  onOpenAutoTune: () => void;
  onMessage: (message: string, kind?: "notification" | "error") => void;
}) {
  const [settings, setSettings] = useState<GlobalFileSyncSettings>(defaultSettings);
  const [activeUtility, setActiveUtility] = useState<"sync" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const instanceChoices = useMemo(() => {
    const nameCounts = new Map<string, number>();
    const versionCounts = new Map<string, number>();
    instances.forEach(instance => {
      nameCounts.set(instance.name, (nameCounts.get(instance.name) ?? 0) + 1);
      const key = `${instance.name}\0${instance.version}`;
      versionCounts.set(key, (versionCounts.get(key) ?? 0) + 1);
    });
    return instances.map(instance => {
      const versionKey = `${instance.name}\0${instance.version}`;
      const label = nameCounts.get(instance.name) === 1
        ? instance.name
        : versionCounts.get(versionKey) === 1
          ? `${instance.name} · ${instance.version}`
          : `${instance.name} · ${instance.version} · ${instance.id}`;
      return { id: instance.id, label };
    });
  }, [instances]);
  const labels = useMemo(() => new Map(instanceChoices.map(instance => [instance.id, instance.label])), [instanceChoices]);
  const idsByLabel = useMemo(() => new Map(instanceChoices.map(instance => [instance.label, instance.id])), [instanceChoices]);
  const instanceOptions = useMemo(() => ["Choose source", ...instanceChoices.map(instance => instance.label)], [instanceChoices]);

  const load = async () => {
    setLoading(true);
    try {
      const next = await invoke<GlobalFileSyncState>("get_global_file_sync_state");
      setSettings(next.settings);
    } catch (error) {
      onMessage(String(error), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const chooseSource = (key: "options" | "servers" | "voicechat", label: string) => {
    const source = idsByLabel.get(label) ?? null;
    const settingKey = sourceKeys[key];
    setSettings(current => ({
      ...current,
      [settingKey]: source,
      ...(key === "voicechat" && source ? { voiceChatTargets: current.voiceChatTargets.filter(id => id !== source) } : {}),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const next = await invoke<GlobalFileSyncState>("save_global_file_sync_settings", { settings });
      setSettings(next.settings);
      onMessage("Global File Sync setup saved.");
    } catch (error) {
      onMessage(String(error), "error");
    } finally {
      setSaving(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const report = await invoke<GlobalFileSyncReport>("apply_global_file_sync", { settings });
      await load();
      setConfirming(false);
      const parts = [
        report.changedFiles ? `${report.changedFiles} file${report.changedFiles === 1 ? "" : "s"} synced` : "files already matched",
        report.linkedFolders ? `${report.linkedFolders} shared folder${report.linkedFolders === 1 ? "" : "s"} connected` : "",
        report.detachedFolders ? `${report.detachedFolders} shared folder${report.detachedFolders === 1 ? "" : "s"} disconnected` : "",
      ].filter(Boolean);
      onMessage(`Global File Sync complete: ${parts.join(", ")}.`);
    } catch (error) {
      onMessage(String(error), "error");
    } finally {
      setApplying(false);
    }
  };

  const renderSource = (key: "options" | "servers" | "voicechat") => {
    const sourceId = settings[sourceKeys[key]] as string | null;
    const value = sourceId ? labels.get(sourceId) ?? "Choose source" : "Choose source";
    return <div className="utility-setting-stack">
      <label><span>Source instance</span></label>
      <SelectControl value={value} options={instanceOptions} onChange={label => chooseSource(key, label)} />
    </div>;
  };

  if (!activeUtility) return <div className="utilities-page">
    <header className="utilities-heading">
      <div><h1>Utilities</h1></div>
      <button className="utilities-refresh" onClick={() => void load()} disabled={loading} aria-label="Refresh Utilities" title="Refresh Utilities"><RefreshCw size={17} /></button>
    </header>
    <section className="utilities-workspace utilities-library">
      <div className="utilities-grid">
        <article className="utility-card utility-product-card">
          <div className="utility-card-main">
            <span className="utility-card-icon"><WandSparkles size={48} strokeWidth={1.8} /></span>
            <h3>AutoTune</h3>
          </div>
          <div className="utility-card-footer"><button onClick={onOpenAutoTune}>Configure<ChevronRight size={15} /></button></div>
        </article>
        <article className="utility-card utility-product-card">
          <div className="utility-card-main">
            <span className="utility-card-icon"><RefreshCw size={48} strokeWidth={1.8} /></span>
            <h3>Global File Sync</h3>
          </div>
          <div className="utility-card-footer"><button onClick={() => { setActiveUtility("sync"); setConfirming(false); }}>Configure<ChevronRight size={15} /></button></div>
        </article>
      </div>
    </section>
  </div>;

  return <div className="utilities-page utility-detail-page">
    <header className="utility-detail-heading">
      <div className="utility-detail-title"><span><RefreshCw size={25} /></span><div><h1>Global File Sync</h1></div></div>
      <button className="utility-back" onClick={() => { setActiveUtility(null); setConfirming(false); }} aria-label="Back to Utilities" title="Back to Utilities"><ArrowLeft size={19} /></button>
    </header>

    <section className="utility-config-panel utility-detail-panel">
      <div className="utility-config-body">
        <UtilityRule Icon={FileCog} title="Game Options">
          {renderSource("options")}
        </UtilityRule>

        <UtilityRule Icon={Server} title="Server List">
          {renderSource("servers")}
        </UtilityRule>

        <UtilityRule Icon={Mic} title="Voice Chat">
          {renderSource("voicechat")}
          <div className="utility-targets"><div className="utility-targets-heading"><b>Destination instances</b></div>
            {instances.filter(instance => instance.id !== settings.voiceChatSource).map(instance => {
              const checked = settings.voiceChatTargets.includes(instance.id);
              return <button key={instance.id} className={checked ? "selected" : ""} onClick={() => setSettings(current => ({ ...current, voiceChatTargets: checked ? current.voiceChatTargets.filter(id => id !== instance.id) : [...current.voiceChatTargets, instance.id] }))}><span>{checked && <Check size={14} strokeWidth={3} />}</span><div><b>{labels.get(instance.id) ?? instance.name}</b></div></button>;
            })}
          </div>
        </UtilityRule>

        <UtilityRule Icon={ImageIcon} title="Resource Packs">
          <SharedFolderConfiguration checked={settings.shareResourcePacks} onChange={checked => setSettings(current => ({ ...current, shareResourcePacks: checked }))} onOpen={() => void invoke("open_global_sync_folder", { category: "resourcepacks" }).catch(error => onMessage(String(error), "error"))} />
        </UtilityRule>

        <UtilityRule Icon={Sparkles} title="Shader Packs">
          <SharedFolderConfiguration checked={settings.shareShaderPacks} onChange={checked => setSettings(current => ({ ...current, shareShaderPacks: checked }))} onOpen={() => void invoke("open_global_sync_folder", { category: "shaderpacks" }).catch(error => onMessage(String(error), "error"))} />
        </UtilityRule>
      </div>
      <footer>
        <button className="utility-save" disabled={saving || applying} onClick={() => void save()}><Save size={15} />{saving ? "Saving…" : "Save setup"}</button>
        <button className="utility-apply" disabled={saving || applying || !instances.length} onClick={() => setConfirming(true)}><RefreshCw size={15} />Sync now</button>
      </footer>
      {confirming && <div className="utility-confirmation">
        <span><ShieldCheck size={22} /></span>
        <div><b>Apply Global File Sync?</b><p>Changed files are backed up first.</p></div>
        <button onClick={() => setConfirming(false)} disabled={applying}>Cancel</button>
        <button onClick={() => void apply()} disabled={applying}>{applying ? "Syncing…" : "Apply sync"}</button>
      </div>}
    </section>
  </div>;
}

function ModpackSharingDetail({ instances, labels, idsByLabel, instanceOptions, SelectControl, onBack, onMessage, onImported, onMembershipChanged }: {
  instances: UtilityInstance[];
  labels: Map<string, string>;
  idsByLabel: Map<string, string>;
  instanceOptions: string[];
  SelectControl: ComponentType<SelectControlProps>;
  onBack: () => void;
  onMessage: (message: string, kind?: "notification" | "error") => void;
  onImported: (result: ModpackShareImport) => void;
  onMembershipChanged: () => void;
}) {
  const [sourceId, setSourceId] = useState<string | null>(instances[0]?.id ?? null);
  const [share, setShare] = useState<ModpackShare | null>(null);
  const [sharing, setSharing] = useState(false);
  const [code, setCode] = useState("");
  const [importing, setImporting] = useState(false);
  const [channel, setChannel] = useState<PackChannel | null>(null);
  const [channelState, setChannelState] = useState<PackChannelState | null>(null);
  const [groupCode, setGroupCode] = useState("");
  const [editorCode, setEditorCode] = useState("");
  const [editorInvite, setEditorInvite] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [sharingTab, setSharingTab] = useState<"shared" | "group">("shared");
  const [sharedFlow, setSharedFlow] = useState<"choose" | "create" | "install">("choose");
  const [groupFlow, setGroupFlow] = useState<"choose" | "create" | "join" | "editor" | "manage">("choose");
  const selectedLabel = sourceId ? labels.get(sourceId) ?? "Choose instance" : "Choose instance";

  useEffect(() => {
    setChannel(null); setEditorInvite(null);
    if (!sourceId) return setChannelState(null);
    void invoke<PackChannelState | null>("get_pack_channel_state", { instanceId: sourceId }).then(setChannelState).catch(() => setChannelState(null));
  }, [sourceId]);
  useEffect(() => {
    if (!sourceId || !channelState) return;
    const timer = window.setInterval(() => void invoke<PackChannelState | null>("get_pack_channel_state", { instanceId: sourceId }).then(setChannelState).catch(() => undefined), 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [sourceId, channelState?.code]);

  const createShare = async () => {
    if (!sourceId) return onMessage("Choose an instance first.", "error");
    setSharing(true);
    setShare(null);
    try {
      const result = await invoke<ModpackShare>("create_modpack_share", { instanceId: sourceId });
      setShare(result);
      onMessage("Share code created.");
    } catch (error) { onMessage(String(error), "error"); }
    finally { setSharing(false); }
  };
  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); onMessage(`${label} copied.`); }
    catch { onMessage(`Could not copy the ${label.toLowerCase()}.`, "error"); }
  };
  const importShare = async () => {
    if (!code.trim()) return onMessage("Enter a share code or link.", "error");
    setImporting(true);
    try {
      const result = await invoke<ModpackShareImport>("import_modpack_share", { code: code.trim() });
      onImported(result);
    } catch (error) { onMessage(String(error), "error"); }
    finally { setImporting(false); }
  };
  const createGroup = async () => {
    if (!sourceId) return onMessage("Choose an instance first.", "error");
    setGroupBusy(true); try { const result = await invoke<PackChannel>("create_pack_channel", { instanceId: sourceId }); setChannel(result); setChannelState({ instanceId: sourceId, code: result.code, revision: result.revision, latestRevision: result.revision, role: "owner", editorCount: result.editorCount, updateAvailable: false }); setGroupFlow("manage"); onMembershipChanged(); onMessage("Group pack created."); } catch (error) { onMessage(String(error), "error"); } finally { setGroupBusy(false); }
  };
  const publishGroup = async () => {
    if (!sourceId) return;
    setGroupBusy(true); try { const result = await invoke<PackChannel>("publish_pack_channel", { instanceId: sourceId }); setChannel(result); setChannelState(current => current ? { ...current, revision: result.revision, latestRevision: result.revision, updateAvailable: false } : current); onMessage(`Revision ${result.revision} published.`); } catch (error) { onMessage(String(error), "error"); } finally { setGroupBusy(false); }
  };
  const createEditorCode = async () => {
    if (!sourceId) return;
    setGroupBusy(true); try { const result = await invoke<{ code: string }>("create_pack_editor_invite", { instanceId: sourceId }); setEditorInvite(result.code); } catch (error) { onMessage(String(error), "error"); } finally { setGroupBusy(false); }
  };
  const importGroup = async (asEditor: boolean) => {
    const value = asEditor ? editorCode : groupCode; if (!value.trim()) return;
    setGroupBusy(true); try { const result = await invoke<ModpackShareImport>(asEditor ? "join_pack_as_editor" : "import_pack_channel", { code: value.trim() }); onImported(result); } catch (error) { onMessage(String(error), "error"); } finally { setGroupBusy(false); }
  };
  const applyGroupUpdate = async () => {
    if (!sourceId) return;
    setGroupBusy(true); try { await invoke<ModpackShareImport>("apply_pack_channel_update", { instanceId: sourceId }); setChannelState(current => current ? { ...current, revision: current.latestRevision, updateAvailable: false } : current); onMessage("Group pack updated."); } catch (error) { onMessage(String(error), "error"); } finally { setGroupBusy(false); }
  };

  const tabs = ["shared", "group"] as const;
  return <div className="utilities-page utility-detail-page pack-sharing-page">
    <div className="pack-sharing-heading-shell">
      <header className="utility-detail-heading pack-sharing-platform">
        <div className="utility-detail-title"><span><Share2 size={25} /></span><div><h1>Modpack Sharing</h1></div></div>
        <button className="utility-back" onClick={onBack} aria-label="Back to Utilities" title="Back to Utilities"><ArrowLeft size={19} /></button>
      </header>
      <div className="pack-sharing-tab-shelf"><div className="pack-sharing-tabs" role="tablist" aria-label="Modpack sharing type">
        {tabs.map((tab, index) => <button key={tab} id={`pack-sharing-tab-${tab}`} role="tab" aria-selected={sharingTab === tab} aria-controls="pack-sharing-panel" tabIndex={sharingTab === tab ? 0 : -1} onClick={() => setSharingTab(tab)} onKeyDown={event => {
          const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!offset && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault(); const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[1] : tabs[(index + offset + 2) % 2];
          setSharingTab(target); document.getElementById(`pack-sharing-tab-${target}`)?.focus();
        }}>{tab === "shared" ? "Shared Packs" : "Group Packs"}</button>)}
      </div></div>
    </div>
    <section className="pack-sharing-workspace" id="pack-sharing-panel" role="tabpanel" aria-labelledby={`pack-sharing-tab-${sharingTab}`}>
      {sharingTab === "shared" ? sharedFlow === "choose" ? <div className="pack-flow-choices two">
        <button onClick={() => setSharedFlow("create")}><span><Share2 size={30} /></span><b>Create share code</b><ChevronRight size={19} /></button>
        <button onClick={() => setSharedFlow("install")}><span><Download size={30} /></span><b>Install shared pack</b><ChevronRight size={19} /></button>
      </div> : <div className="pack-flow-step">
        <header><button onClick={() => setSharedFlow("choose")} aria-label="Back"><ArrowLeft size={18} /></button><h2>{sharedFlow === "create" ? "Create share code" : "Install shared pack"}</h2><span /></header>
        {sharedFlow === "create" ? <div className="pack-flow-form"><SelectControl value={selectedLabel} options={["Choose instance", ...instanceOptions.slice(1)]} onChange={label => { setSourceId(idsByLabel.get(label) ?? null); setShare(null); }} /><button className="utility-apply" disabled={sharing || !sourceId} onClick={() => void createShare()}><Share2 size={16} />{sharing ? "Creating…" : "Create share"}</button>{share && <div className="pack-share-result"><strong>{share.code}</strong><button onClick={() => void copy(share.code, "Code")} aria-label="Copy share code"><Copy size={17} /></button><button onClick={() => void copy(share.url, "Link")} aria-label="Copy share link"><Share2 size={17} /></button></div>}</div> : <div className="pack-flow-form"><input value={code} onChange={event => setCode(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void importShare(); }} placeholder="Share code or link" /><button className="utility-apply" disabled={importing || !code.trim()} onClick={() => void importShare()}><Download size={16} />{importing ? "Importing…" : "Import pack"}</button></div>}
      </div> : groupFlow === "choose" ? <div className="pack-flow-choices group">
        <button onClick={() => setGroupFlow("create")}><span><Share2 size={30} /></span><b>Create group pack</b><ChevronRight size={19} /></button>
        <button onClick={() => setGroupFlow("join")}><span><Download size={30} /></span><b>Join group pack</b><ChevronRight size={19} /></button>
        <button onClick={() => setGroupFlow("editor")}><span><Users size={30} /></span><b>Join as editor</b><ChevronRight size={19} /></button>
        <button onClick={() => setGroupFlow("manage")}><span><ShieldCheck size={30} /></span><b>Manage group pack</b><ChevronRight size={19} /></button>
      </div> : <div className="pack-flow-step">
        <header><button onClick={() => setGroupFlow("choose")} aria-label="Back"><ArrowLeft size={18} /></button><h2>{groupFlow === "create" ? "Create group pack" : groupFlow === "join" ? "Join group pack" : groupFlow === "editor" ? "Join as editor" : "Manage group pack"}</h2><span /></header>
        {groupFlow === "create" ? <div className="pack-flow-form"><SelectControl value={selectedLabel} options={["Choose instance", ...instanceOptions.slice(1)]} onChange={label => setSourceId(idsByLabel.get(label) ?? null)} /><button className="utility-apply" disabled={groupBusy || !sourceId} onClick={() => void createGroup()}><Users size={16} />{groupBusy ? "Creating…" : "Create group"}</button></div> : groupFlow === "join" ? <div className="pack-flow-form"><input value={groupCode} onChange={event => setGroupCode(event.target.value)} placeholder="Group share code" /><button className="utility-apply" disabled={groupBusy || !groupCode.trim()} onClick={() => void importGroup(false)}><Download size={16} />Join pack</button></div> : groupFlow === "editor" ? <div className="pack-flow-form"><input value={editorCode} onChange={event => setEditorCode(event.target.value)} placeholder="One-time editor code" /><button className="utility-apply" disabled={groupBusy || !editorCode.trim()} onClick={() => void importGroup(true)}><Users size={16} />Join as editor</button></div> : <div className="pack-dashboard">
          <SelectControl value={selectedLabel} options={["Choose instance", ...instanceOptions.slice(1)]} onChange={label => setSourceId(idsByLabel.get(label) ?? null)} />
          {channelState ? <div className="pack-console"><div className="pack-console-identity"><span className="pack-console-mark"><Users size={26} /></span><div className="pack-console-code"><small>GROUP PACK</small><strong>{channel?.code ?? channelState.code}</strong><div><span>Revision {channelState.revision}</span><span>{channelState.role}</span><span>{channelState.editorCount + 1} / 6</span></div></div><button className="pack-console-copy" onClick={() => void copy(channel?.code ?? channelState.code, "Share code")}><Copy size={18} /><b>Copy</b></button></div><div className="pack-console-actions">{channelState.role !== "member" && <button disabled={groupBusy} onClick={() => void publishGroup()}><span><Share2 size={20} /></span><b>Publish changes</b><small>Revision {channelState.revision + 1}</small><ChevronRight size={17} /></button>}{channelState.role === "owner" && <button onClick={() => void createEditorCode()} disabled={groupBusy || channelState.editorCount >= 5}><span><Users size={20} /></span><b>Create editor code</b><small>{channelState.editorCount} of 5 editors</small><ChevronRight size={17} /></button>}{channelState.updateAvailable && <button onClick={() => void applyGroupUpdate()} disabled={groupBusy}><span><Download size={20} /></span><b>Apply update</b><small>Revision {channelState.latestRevision}</small><ChevronRight size={17} /></button>}</div>{editorInvite && <div className="pack-editor-ticket"><div><small>EDITOR CODE</small><strong>{editorInvite}</strong></div><button onClick={() => void copy(editorInvite, "Editor code")}><Copy size={18} />Copy</button></div>}</div> : <div className="pack-flow-empty">This instance is not connected to a group pack.</div>}
        </div>}
      </div>}
    </section>
  </div>;
}

function UtilityRule({ Icon, title, children }: { Icon: ComponentType<{ size?: number; strokeWidth?: number }>; title: string; children: ReactNode }) {
  return <section className="utility-rule">
    <header><span><Icon size={21} strokeWidth={1.9} /></span><div><h2>{title}</h2></div></header>
    <div className="utility-rule-body">{children}</div>
  </section>;
}

function SharedFolderConfiguration({ checked, onChange, onOpen }: { checked: boolean; onChange: (checked: boolean) => void; onOpen: () => void }) {
  return <>
    <div className="utility-shared-control"><div><b>Use one shared folder</b></div><UtilityToggle checked={checked} onChange={onChange} label="Use one shared folder" /></div>
    <button className="utility-open-folder" onClick={onOpen}><FolderOpen size={16} />Open shared folder</button>
  </>;
}
