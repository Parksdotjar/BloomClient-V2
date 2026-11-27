import { FolderOpenIcon as FolderOpen } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { invoke } from "../services/invoke";
import { ArrowLeftIcon as ArrowLeft,
  CheckIcon as Check,
  CaretRightIcon as ChevronRight,
  CopyIcon as Copy,
  DownloadIcon as Download,
  FileCodeIcon as FileCog,
  ImageSquareIcon as ImageIcon,
  MicrophoneIcon as Mic,
  ArrowsClockwiseIcon as RefreshCw,
  FloppyDiskIcon as Save,
  HardDrivesIcon as Server,
  ShareNetworkIcon as Share2,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkles,
  UsersIcon as Users } from "@phosphor-icons/react";
import "./utilities.css";
import { InfoTip } from "./InfoTip";
import { useToggleFeedback } from "../services/toggle-feedback";

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
type SelectControlProps = { ariaLabel?: string; value: string; options: string[]; onChange: (value: string) => void };
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
  const feedbackRef = useToggleFeedback(checked);
  return <button ref={feedbackRef} type="button" className={`utility-toggle ${checked ? "on" : ""}`} aria-pressed={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>;
}

export function UtilitiesPage({
  instances,
  SelectControl,
  onMessage,
}: {
  instances: UtilityInstance[];
  SelectControl: ComponentType<SelectControlProps>;
  onMessage: (message: string, kind?: "notification" | "error") => void;
}) {
  const [settings, setSettings] = useState<GlobalFileSyncSettings>(defaultSettings);
  const [report, setReport] = useState<GlobalFileSyncReport | null>(null);
  const [loadError, setLoadError] = useState("");
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
  const instanceOptions = useMemo(() => ["Off — don’t copy", ...instanceChoices.map(instance => instance.label)], [instanceChoices]);

  const load = async () => {
    setLoading(true); setLoadError("");
    try {
      const next = await invoke<GlobalFileSyncState>("get_global_file_sync_state");
      setSettings(next.settings);
    } catch (error) {
      setLoadError(String(error));
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
      setReport(report);
      await load();
      setConfirming(false);
    } catch (error) {
      onMessage(String(error), "error");
    } finally {
      setApplying(false);
    }
  };

  const renderSource = (key: "options" | "servers" | "voicechat") => {
    const sourceId = settings[sourceKeys[key]] as string | null;
    const value = sourceId ? labels.get(sourceId) ?? "Off — don’t copy" : "Off — don’t copy";
    return <div className="utility-setting-stack">
      <label><span>Copy from</span></label>
      <SelectControl ariaLabel={sourceLabels[key] + " source"} value={value} options={instanceOptions} onChange={label => chooseSource(key, label)} />
      {key !== "voicechat" && <div className="utility-copy-destination"><span>Copy to</span><b>All other instances</b></div>}
    </div>;
  };

  const sourceLabels = {options: "Game settings", servers: "Saved servers", voicechat: "Voice chat"};
  return <div className="sync-workspace">
    <header className="sync-heading"><h1>{confirming ? "Review sync" : report ? "Sync results" : "Global File Sync"}</h1>
      {!confirming && !report && <button disabled={loading || saving} onClick={() => void load()} aria-label="Refresh Global File Sync" title="Refresh"><RefreshCw size={17}/></button>}
    </header>
    {loadError && <div role="alert">{loadError} <button onClick={() => void load()}>Retry</button></div>}
    {loading && !applying && <p role="status">Loading sync setup…</p>}
    {!confirming && !report && !loading && !loadError && <section>
      <fieldset disabled={saving} className="sync-rules">
        <UtilityRule Icon={FileCog} title="Game Settings" help="Copy Minecraft settings, including controls, video, and sound, from the selected instance to every other instance. This replaces their game settings. Choose Off to leave them alone.">
          {renderSource("options")}
        </UtilityRule>

        <UtilityRule Icon={Server} title="Saved Servers" help="Copy the selected instance’s multiplayer server list to every other instance. This replaces each destination’s list rather than combining lists.">
          {renderSource("servers")}
        </UtilityRule>

        <UtilityRule Icon={Mic} title="Voice Chat Settings" help="Copy Simple Voice Chat client settings from the chosen instance to only the instances you select below. This does not install the voice chat mod.">
          {renderSource("voicechat")}
          <div className="utility-targets"><div className="utility-targets-heading"><b>Copy to selected instances</b></div>
            {instances.filter(instance => instance.id !== settings.voiceChatSource).map(instance => {
              const checked = settings.voiceChatTargets.includes(instance.id);
              return <button key={instance.id} className={checked ? "selected" : ""} aria-pressed={checked} onClick={() => setSettings(current => ({ ...current, voiceChatTargets: checked ? current.voiceChatTargets.filter(id => id !== instance.id) : [...current.voiceChatTargets, instance.id] }))}><span>{checked && <Check size={14} weight="bold" />}</span><div><b>{labels.get(instance.id) ?? instance.name}</b></div></button>;
            })}
          </div>
        </UtilityRule>

        <UtilityRule Icon={ImageIcon} title="Shared Resource Packs" help="Connect every instance to one resource-pack folder. Packs are available everywhere, but each instance still chooses which ones to enable. Changes to the shared files affect all connected instances.">
          <SharedFolderConfiguration checked={settings.shareResourcePacks} onChange={checked => setSettings(current => ({ ...current, shareResourcePacks: checked }))} onOpen={() => void invoke("open_global_sync_folder", { category: "resourcepacks" }).catch(error => onMessage(String(error), "error"))} />
        </UtilityRule>

        <UtilityRule Icon={Sparkles} title="Shared Shader Packs" help="Connect every instance to one shader-pack folder. Each instance still needs a compatible shader mod and chooses its own active shader. Changes to the shared files affect all connected instances.">
          <SharedFolderConfiguration checked={settings.shareShaderPacks} onChange={checked => setSettings(current => ({ ...current, shareShaderPacks: checked }))} onOpen={() => void invoke("open_global_sync_folder", { category: "shaderpacks" }).catch(error => onMessage(String(error), "error"))} />
        </UtilityRule>
      </fieldset>
      <footer className="sync-actions">
        <InfoTip label="saving and syncing">Save setup remembers your choices without changing game files or the active sync rules. Sync now applies and activates these choices. Changed files are backed up first.</InfoTip>
        <button className="sync-save" disabled={saving || applying} onClick={() => void save()}><Save size={15} />{saving ? "Saving…" : "Save setup"}</button>
        <button className="sync-apply" disabled={saving || applying || !instances.length} onClick={() => setConfirming(true)}><RefreshCw size={15} />Sync now</button>
      </footer>
    </section>}
    {confirming && <section className="sync-review" aria-label="Confirm Global File Sync">
      <p>Changed files are backed up before replacement.</p>
      <dl>{(["options", "servers", "voicechat"] as const).map(key => {
        const id = settings[sourceKeys[key]] as string | null;
        const targets = instanceChoices.filter(item => item.id !== id && (key !== "voicechat" || settings.voiceChatTargets.includes(item.id)));
        return <div key={key}><dt>{sourceLabels[key]}</dt><dd>{id && labels.has(id)
          ? <>{labels.get(id)} → {targets.map(item => item.label).join(", ") || "No destinations"}</> : "Off"}</dd></div>;
      })}
      <div><dt>Resource pack folders</dt><dd>{settings.shareResourcePacks ? "Share across all instances" : "Use individual folders"}</dd></div>
      <div><dt>Shader pack folders</dt><dd>{settings.shareShaderPacks ? "Share across all instances" : "Use individual folders"}</dd></div></dl>
      {applying && <p role="status">Syncing files and updating folder connections…</p>}
      <footer className="sync-actions"><button onClick={() => setConfirming(false)} disabled={applying}>Cancel</button>
      <button onClick={() => void apply()} disabled={applying}>{applying ? "Syncing…" : "Apply sync"}</button></footer>
    </section>}
    {report && !confirming && <section className="sync-review" aria-label="Global File Sync results">
      <dl>{[["Files copied",report.changedFiles],["Files already matched",report.unchangedFiles],["Folders connected",report.linkedFolders],["Folders disconnected",report.detachedFolders]].map(([label,value]) =>
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        {report.backupPath && <div><dt>Backup location</dt><dd>{report.backupPath}</dd></div>}
      </dl><button onClick={() => setReport(null)}>Back to setup</button>
    </section>}
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

function UtilityRule({ Icon, title, help, children }: { help?: string; Icon: ComponentType<{ size?: number; strokeWidth?: number }>; title: string; children: ReactNode }) {
  return <section className="utility-rule">
    <header><span><Icon size={21} /></span><div className="utility-rule-title"><h2>{title}</h2>{help && <InfoTip label={title}>{help}</InfoTip>}</div></header>
    <div className="utility-rule-body">{children}</div>
  </section>;
}

function SharedFolderConfiguration({ checked, onChange, onOpen }: { checked: boolean; onChange: (checked: boolean) => void; onOpen: () => void }) {
  return <>
    <div className="utility-shared-control"><div><b>Use one shared folder</b></div><UtilityToggle checked={checked} onChange={onChange} label="Use one shared folder" /></div>
    <button className="utility-open-folder" onClick={onOpen}><FolderOpen size={16} />Open shared folder</button>
  </>;
}
