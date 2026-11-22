import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Select } from "../main";
import { InfoTip } from "./InfoTip";
import "./fabric-loader-setting.css";

type LoaderVersion = { version: string; stable: boolean };
type LoaderOptions = { currentVersion: string | null; versions: LoaderVersion[] };

export function FabricLoaderSetting({ instanceId, minecraftVersion, currentVersion, value, onChange, disabled, busy }: {
  instanceId: string;
  minecraftVersion: string;
  currentVersion?: string | null;
  value?: string;
  onChange: (version: string) => void;
  disabled: boolean;
  busy: boolean;
}) {
  const [metadata, setMetadata] = useState<LoaderOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setMetadata(null);
    void invoke<LoaderOptions>("list_instance_fabric_loaders", { instanceId }).then(result => {
      if (!cancelled) setMetadata(result);
    }).catch(reason => {
      if (!cancelled) setError(String(reason));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [instanceId, minecraftVersion, attempt]);

  const selected = value ?? (currentVersion?.trim() || metadata?.currentVersion || "");
  const versions = metadata?.versions ?? [];
  const latestStable = versions.find(loader => loader.stable)?.version;
  const label = (version: string) => {
    const loader = versions.find(item => item.version === version);
    return `${version}${version === latestStable ? " (latest stable)" : loader && !loader.stable ? " (prerelease)" : ""}`;
  };
  const options = [...new Set([...(selected ? [selected] : []), ...versions.map(loader => loader.version)])];
  return <div className="instance-preference-row instance-fabric-loader">
    <div className="instance-preference-label">Fabric Loader</div>
    <div className="fabric-loader-control">
      <Select ariaLabel="Fabric Loader version" value={selected ? label(selected) : loading ? "Loading versions…" : "Automatic"}
        options={options.map(label)} disabled={disabled || loading || Boolean(error) || !versions.length}
        onChange={choice => { const version = options.find(item => label(item) === choice); if (version) onChange(version); }} />
      {loading && selected && <span className="fabric-loader-note" role="status">Loading versions…</span>}
      {error && <div className="fabric-loader-error" role="alert"><span>{error}</span><button type="button" disabled={disabled} onClick={() => setAttempt(value => value + 1)}>Retry</button></div>}
      {busy && <span className="fabric-loader-note">Available when Minecraft and downloads have stopped.</span>}
    </div>
    <InfoTip label="Fabric Loader version">Choose the loader used on the next launch, then save changes. This changes Fabric Loader, not Minecraft or Fabric API. Your mods may require a particular loader version.</InfoTip>
  </div>;
}
