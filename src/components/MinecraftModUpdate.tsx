import { useEffect, useRef, useState, type ComponentType } from "react";
import { ArrowLeft, Download, RefreshCw } from "lucide-react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";

type Preview = {
  token: string | null;
  target: string;
  loaderVersion: string;
  changes: { kind: "update" | "dependency" | "remove"; name: string; detail: string }[];
  issues: string[];
  backsUpWorlds: boolean;
  createCopy?: boolean;
};

type VersionSelect = ComponentType<{
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  showCheckmark?: boolean;
}>;

export function MinecraftModUpdate<T>({ instanceId, current, busy,
  Select, onBusy, onUpdated, onBack }: {
  instanceId: string;
  current: string;
  busy: boolean;
  Select: VersionSelect;
  onBusy: (busy: boolean) => void;
  onUpdated: (instance: T) => void;
  onBack: () => void;
}) {
  const [target, setTarget] = useState(current);
  const [versions, setVersions] = useState<string[]>([]);
  const [versionsError, setVersionsError] = useState("");
  const [preview, setPreview] = useState<Preview>();
  const [previewError, setPreviewError] = useState("");
  const [applyError, setApplyError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [writing, setWriting] = useState(false);
  const [recovery, setRecovery] = useState<{ previous: string } | null>(null);
  const [recoveryError, setRecoveryError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const otherVersion = target !== current;
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let live = true;
    void invoke<{ previous: string } | null>("get_minecraft_mod_recovery", { instanceId }).then(
      value => { if (live) setRecovery(value); },
      () => { if (live) setRecovery(null); },
    );
    return () => { live = false; };
  }, [instanceId, current]);
  useEffect(() => {
    let live = true;
    setVersionsError("");
    void invoke<{ id: string }[]>("get_minecraft_releases").then(releases => {
      if (live) setVersions([...new Set(releases.map(release => release.id))]);
    }, error => { if (live) setVersionsError(userError(error)); });
    return () => { live = false; };
  }, [attempt]);
  useEffect(() => {
    if (target === current) return;
    let live = true;
    void invoke<Preview>("preview_minecraft_mod_update", { instanceId, target }).then(result => {
      if (live) setPreview(result);
    }, error => { if (live) setPreviewError(userError(error)); });
    return () => { live = false; };
  }, [target, current, instanceId, attempt]);

  const choose = (next: string) => {
    if (next === target) return;
    setPreview(undefined);
    setPreviewError("");
    setApplyError("");
    setTarget(next);
  };
  const retry = () => {
    setPreview(undefined);
    setPreviewError("");
    setApplyError("");
    setAttempt(count => count + 1);
  };
  const apply = async () => {
    if (!preview?.token || busy || writing) return;
    setWriting(true);
    onBusy(true);
    setApplyError("");
    try {
      onUpdated(await invoke<T>("apply_minecraft_mod_update", { instanceId, target, token: preview.token }));
    } catch (error) {
      setApplyError(userError(error));
    } finally {
      setWriting(false);
      onBusy(false);
    }
  };
  const restore = async () => {
    if (!recovery || busy || writing) return;
    setWriting(true);
    onBusy(true);
    setRecoveryError("");
    try {
      onUpdated(await invoke<T>("restore_minecraft_mod_update", { instanceId, previous: recovery.previous }));
    } catch (error) {
      setRecoveryError(userError(error));
    } finally {
      setWriting(false);
      onBusy(false);
    }
  };
  const removals = preview?.changes.filter(change => change.kind === "remove") ?? [];
  const changes = preview?.changes.filter(change => change.kind !== "remove") ?? [];
  return <section className="minecraft-mod-update" aria-label="Change Minecraft version">
    <div className="minecraft-mod-update-header">
      <h2 ref={heading} tabIndex={-1}>Change Minecraft version</h2>
      <button type="button" className="settings-action" disabled={writing} onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />Back to settings
      </button>
    </div>
    <div className="minecraft-mod-update-version">
      <span>Minecraft version</span>
      <Select value={target} options={[...new Set([current, ...versions])]} onChange={choose}
        ariaLabel="Minecraft version" disabled={writing} showCheckmark={false} />
    </div>
    {(versionsError || previewError || applyError) && <div className="minecraft-mod-update-error">
      <p role="alert">{applyError || previewError || versionsError}</p>
      <button type="button" className="settings-action" onClick={retry}><RefreshCw size={14} />Check again</button>
    </div>}
    {otherVersion && !preview && !previewError && <p role="status">Checking mods for Minecraft {target}…</p>}
    {!!preview?.issues.length && <ul className="minecraft-mod-update-list" aria-label="Issues to resolve">
      {preview.issues.map(issue => <li key={issue}>{issue}</li>)}
    </ul>}
    {!!removals.length && <>
      <h3>{preview?.createCopy ? "Left out of the copy" : "Will be removed from this instance"}</h3>
      <ul className="minecraft-mod-update-list">
        {removals.map(change => <li key={change.name}><strong>{change.name}</strong><span>{change.detail}</span></li>)}
      </ul>
    </>}
    {preview?.createCopy && <p>Creates a separate instance. Worlds stay with the original.</p>}
    {preview?.token && preview.backsUpWorlds &&
      <p>Your worlds will be backed up before the update.{removals.length ? " Removing mods can change worlds when you open them." : ""}</p>}
    {!!changes.length && <details className="minecraft-mod-update-changes">
      <summary>Changes</summary>
      <ul className="minecraft-mod-update-list">
        {changes.map(change => <li key={change.kind + change.name}>
          <strong>{change.name}</strong><span>{change.kind === "dependency" ? "Add dependency · " : "Update · "}{change.detail}</span>
        </li>)}
      </ul>
    </details>}
    {otherVersion && preview?.token && <button type="button"
      className="instance-play ceramic-action"
      disabled={busy || writing}
      onClick={() => void apply()}>
      <Download size={16} aria-hidden="true" />{writing ? "Updating\u2026" : preview.createCopy ? "Create " + target + " copy" : "Update to " + target}
    </button>}
    {!otherVersion && recovery && <details className="minecraft-mod-update-changes">
      <summary>Previous version</summary>
      <div className="minecraft-mod-recovery">
        <button type="button" className="settings-action" disabled={busy || writing}
          onClick={() => void restore()}>Restore Minecraft {recovery.previous}</button>
        <button type="button" className="settings-action" disabled={writing} onClick={() =>
          void invoke("open_minecraft_mod_recovery", { instanceId }).catch(error => setRecoveryError(userError(error)))}>
          Open backup
        </button>
      </div>
      {recoveryError && <p role="alert">{recoveryError}</p>}
    </details>}
  </section>;
}
