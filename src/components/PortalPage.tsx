import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowUpRight, Check, Copy, Globe2, Layers3, ListFilter, MoreHorizontal, Play, Plus, RefreshCw, RotateCcw, Search, Server, Star, TriangleAlert, Trash2, X } from "lucide-react";
import { invoke } from "../services/invoke";
import type { PortalChange, PortalEntry, PortalLibrary, PortalTarget } from "../services/portal";
import { ToolbarDrawer, ToolbarIconSwap, ToolbarSegments, useToolbarDisclosure } from "./ConnectedToolbar";
import "./portal.css";

type Instance = { id: string; name: string; version: string };
type SelectControl = ComponentType<{ value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean; ariaLabel?: string; menuPortalRef?: { readonly current: HTMLElement | null } }>;
function PlaceIcon({ entry }: { entry: PortalEntry }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className="portal-place-icon" data-artwork={Boolean(entry.icon && failed !== entry.icon)}>
    {entry.icon && failed !== entry.icon ? <img src={entry.icon} alt="" loading="lazy" onError={() => setFailed(entry.icon)} />
      : entry.kind === "world" ? <img className="portal-world-fallback" src={new URL("loader-vanilla.png", document.baseURI).href} alt="" /> : <img className="portal-server-fallback" src={new URL("minecraft-default-server.png", document.baseURI).href} alt="" />}
  </span>;
}

function instanceLabels(instances: Instance[]) {
  return instances.map((instance, i) => `${instance.name} · ${instance.version}${instances.some((other, j) => j !== i && other.name === instance.name && other.version === instance.version) ? ` · ${i + 1}` : ""}`);
}

export function PortalPage({ instances, busy, onPlay, onOpenInstance, onCreate, SelectControl }: {
  instances: Instance[]; busy: boolean;
  onPlay: (instanceId: string, target: PortalTarget) => void;
  onOpenInstance: (instanceId: string) => void;
  onCreate: () => void;
  SelectControl: SelectControl;
}) {
  const [library, setLibrary] = useState<PortalLibrary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [instanceFilter, setInstanceFilter] = useState("");
  const [sort, setSort] = useState("Recently played");
  const [message, setMessage] = useState("");
  const filters = useToolbarDisclosure();
  const [adding, setAdding] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const closeAdd = () => { setAdding(false); addTrigger.current?.focus(); };
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [message]);
  const [removing, setRemoving] = useState<string | null>(null);
  const request = useRef(0);
  const mutation = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (mutation.current) return;
    const generation = ++request.current;
    setLoading(true);
    try {
      const next = await invoke<PortalLibrary>("list_portal");
      if (mounted.current && generation === request.current) { setLibrary(next); setError(""); }
    } catch (reason) {
      if (mounted.current && generation === request.current) setError(String(reason));
    } finally { if (mounted.current && generation === request.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current++; };
  }, []);
  const instanceKey = instances.map(instance => `${instance.id}:${instance.version}`).join("|");
  useEffect(() => { void refresh(); }, [refresh, instanceKey, busy]);
  useEffect(() => {
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    const subscription = listen("portal-changed", focus).catch(() => null);
    return () => { window.removeEventListener("focus", focus); void subscription.then(off => off?.()); };
  }, [refresh]);
  const change = async (change: PortalChange) => {
    if (mutation.current) return false;
    mutation.current = true; ++request.current;
    setChanging(true); setError("");
    try {
      const next = await invoke<PortalLibrary>("change_portal", { change });
      if (mounted.current) { setLibrary(next); setRemoving(null); }
      return true;
    } catch (reason) { if (mounted.current) setError(String(reason)); return false; }
    finally { mutation.current = false; if (mounted.current) { setChanging(false); setLoading(false); } }
  };
  // Filter by the stable instance ID; names can be duplicated or renamed.
  const scope = instances.some(instance => instance.id === instanceFilter) ? instanceFilter : "";
  const labels = instanceLabels(instances);
  const needle = query.trim().toLocaleLowerCase();
  const entries = (library?.entries ?? []).filter(entry =>
    (filter === "All" || entry.kind === (filter === "Servers" ? "server" : "world")) &&
    (!favorites || entry.favorite) && (!scope || entry.instanceId === scope) &&
    `${entry.name} ${entry.target} ${entry.instanceName} ${entry.version}`.toLocaleLowerCase().includes(needle));
  const sorted = entries.slice().sort((a, b) =>
    (sort === "Recently played" ? (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)
      : sort === "Instance" ? a.instanceName.localeCompare(b.instanceName) : 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const filtered = Boolean(needle || favorites || scope || filter !== "All");
  const groups = (filter === "All" ? ["Servers", "Worlds"] : [filter]).map(label => ({
    label, entries: sorted.filter(entry => entry.kind === (label === "Servers" ? "server" : "world")),
  })).filter(group => group.entries.length > 0);
  const reset = () => { setFilter("All"); setFavorites(false); setInstanceFilter(""); setQuery(""); setSort("Recently played"); };
  const play = (entry: PortalEntry) => { if (!busy && !entry.unavailableReason) onPlay(entry.instanceId, { kind: entry.kind, target: entry.target }); };
  const launchButton = (entry: PortalEntry) => <button className="portal-play" disabled={busy || Boolean(entry.unavailableReason)}
    title={entry.unavailableReason || (busy ? "Wait for the current game or download to finish." : `Launch ${entry.instanceName} directly into ${entry.name}`)}
    onClick={() => play(entry)} aria-label={`${entry.kind === "server" ? "Join" : "Play"} ${entry.name}`}>
    <Play size={14} fill="currentColor" />{entry.kind === "server" ? "Join" : "Play"}
  </button>;
  const copyAddress = async (entry: PortalEntry) => {
    setMessage("");
    try { await invoke("copy_text_to_clipboard", { text: entry.target }); setMessage(`Address copied for ${entry.name}.`); return true; }
    catch (reason) { setError(String(reason)); return false; }
  };

  return <section className="portal-page" aria-label="Portal">
    <div className="portal-header-panel">
      <header className="portal-heading">
        <h1>Portal</h1>
        <div className="portal-heading-actions">
          <button className="portal-icon-button" aria-label="Refresh Portal" title="Refresh" disabled={loading || changing} onClick={() => void refresh()}><RefreshCw size={17} className={loading ? "portal-refreshing" : undefined} /></button>
          <button ref={addTrigger} className={`portal-add-toggle ${adding ? "portal-back" : "portal-add"}`} disabled={changing} aria-expanded={adding} aria-controls="portal-add-panel" onClick={() => instances.length ? setAdding(value => !value) : onCreate()}>
            <ToolbarIconSwap active={adding} resting={<Plus size={17} />} engaged={<ArrowLeft size={17} />} />
            <span key={String(adding)} className="toolbar-copy">{adding ? "Back to list" : instances.length ? "Add server" : "Create instance"}</span>
          </button>
        </div>
      </header>
      <ToolbarDrawer id="portal-add-panel" open={adding} className="portal-add-drawer">
        <AddServer open={adding} instances={instances} SelectControl={SelectControl} busy={changing} error={error} onClose={closeAdd} onSave={async (instanceId, name, address) => {
          const saved = await change({ action: "addServer", instanceId, name, address });
          if (saved) { closeAdd(); reset(); setMessage("Server added."); }
          return saved;
        }} />
      </ToolbarDrawer>
    </div>
    <div className="portal-workspace">
      <label className="portal-search"><Search size={16} /><input aria-label="Search Portal" placeholder="Search worlds and servers" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Clear Portal search" onClick={() => setQuery("")}><X size={14} /></button>}</label>
      <div ref={filters.root} className="portal-tools">
        <div className="portal-tools-row">
          <ToolbarSegments label="Show" options={["All", "Servers", "Worlds"]} value={filter} onChange={setFilter} />
          <div className="portal-filter-actions">
            <button className="portal-icon-button portal-favorites" aria-label="Favorites" title="Favorites" aria-pressed={favorites} onClick={() => setFavorites(value => !value)}><Star size={17} fill={favorites ? "currentColor" : "none"} /></button>
            <button ref={filters.trigger} className="portal-filter-trigger" aria-label="Filters" title="Filter and sort" aria-expanded={filters.open} aria-controls="portal-filters" data-filtered={Boolean(scope || sort !== "Recently played")} onClick={() => filters.setOpen(value => !value)}><ListFilter size={17} />Filters</button>
          </div>
        </div>
        <ToolbarDrawer id="portal-filters" open={filters.open} className="portal-filter-drawer">
          <div className="toolbar-field toolbar-reveal-item"><span>Instance</span><SelectControl ariaLabel="Filter by instance" value={scope ? labels[instances.findIndex(instance => instance.id === scope)] : "All instances"} options={["All instances", ...labels]} onChange={value => setInstanceFilter(instances[labels.indexOf(value)]?.id ?? "")} /></div>
          <div className="toolbar-field toolbar-reveal-item"><span>Sort by</span><SelectControl ariaLabel="Sort Portal" value={sort} options={["Recently played", "Name", "Instance"]} onChange={setSort} /></div>
          <button className="portal-reset toolbar-reveal-item" disabled={!filtered && sort === "Recently played"} onClick={reset}><RotateCcw size={14} />Reset</button>
        </ToolbarDrawer>
      </div>
      {error && !adding && <div className="portal-notice" role="alert"><TriangleAlert size={16} /><span>{error}</span><button disabled={loading || changing} onClick={() => void refresh()}>Retry</button></div>}
      {message && <div className="portal-feedback" role="status"><Check size={15} /><span>{message}</span><button className="portal-icon-button" aria-label="Dismiss Portal notification" onClick={() => setMessage("")}><X size={14} /></button></div>}
      {library && library.warnings.length > 0 && <details className="portal-notice portal-warnings"><summary>Some folders need attention</summary><ul>{library.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
      {busy && <p className="portal-busy" role="status">Game or download in progress.</p>}
      {!library && loading ? <div className="portal-empty" role="status"><RefreshCw size={24} className="portal-refreshing" /><h2>Loading…</h2></div>
        : !library ? <div className="portal-empty"><Globe2 size={32} /><h2>Couldn’t load Portal</h2><p>Try refreshing your list.</p></div>
        : !entries.length ? <div className="portal-empty">
          {filtered ? <Search size={30} /> : <Layers3 size={32} />}
          <h2>{filtered ? "No matches" : "Nothing here yet"}</h2>
          <p>{filtered ? "Try another search or clear your filters." : !instances.length ? "Create an instance to get started." : "Add a server or play a world in an instance."}</p>
          <div className="portal-empty-actions">{filtered ? <button onClick={reset}>Clear filters</button>
            : !instances.length ? <button className="portal-add" onClick={onCreate}>Create instance</button>
            : <><button className="portal-add" onClick={() => setAdding(true)}>Add a server</button><button onClick={() => onOpenInstance(instances[0].id)}>Open instance<ArrowUpRight size={14} /></button></>}</div>
        </div> : <div className="portal-list" aria-label="Worlds and servers">{groups.map(group => <section key={group.label} className="portal-kind-group" aria-label={group.label}>
          {filter === "All" && <h2 className="portal-group-title">{group.label === "Servers" ? <Server size={14} /> : <Globe2 size={14} />}{group.label}</h2>}
          <div className="portal-group-list">{group.entries.map(entry => <PortalRow key={entry.id} entry={entry} changing={changing} removing={removing === entry.id}
          onFavorite={() => void change({ action: "favorite", id: entry.id, favorite: !entry.favorite })}
          onOpen={() => onOpenInstance(entry.instanceId)} onCopy={() => copyAddress(entry)} onRemove={() => setRemoving(entry.id)} onKeep={() => setRemoving(null)}
          onConfirmRemove={() => void change({ action: "remove", id: entry.id })} launch={launchButton(entry)} />)}</div>
        </section>)}</div>}
    </div>
  </section>;
}

function PortalRow({ entry, changing, removing, onFavorite, onOpen, onCopy, onRemove, onKeep, onConfirmRemove, launch }: {
  entry: PortalEntry; changing: boolean; removing: boolean; onFavorite: () => void; onOpen: () => void;
  onCopy: () => Promise<boolean>; onRemove: () => void; onKeep: () => void; onConfirmRemove: () => void; launch: import("react").ReactNode;
}) {
  const menu = useToolbarDisclosure();
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  return <article className="portal-place" data-place-id={entry.id} data-kind={entry.kind} data-unavailable={Boolean(entry.unavailableReason)}>
    <div className="portal-row">
      <PlaceIcon entry={entry} />
      <div className="portal-row-copy"><h3 title={entry.name}>{entry.name}</h3><p title={entry.kind === "server" ? entry.target : entry.instanceName}>{entry.kind === "server" ? entry.target : entry.instanceName}</p></div>
      <div className="portal-row-actions">
        <button className="portal-icon-button portal-star" disabled={changing} aria-label={`${entry.favorite ? "Unfavorite" : "Favorite"} ${entry.name}`} title={entry.favorite ? "Remove from favorites" : "Add to favorites"} aria-pressed={entry.favorite} onClick={onFavorite}><Star size={17} fill={entry.favorite ? "currentColor" : "none"} /></button>
        <div className="portal-row-menu" ref={menu.root}>
          <button ref={menu.trigger} className="portal-icon-button" aria-label={`Options for ${entry.name}`} title={entry.unavailableReason || "Options"} aria-expanded={menu.open} aria-controls={`portal-menu-${entry.id}`} onClick={() => menu.setOpen(value => !value)}>
            <ToolbarIconSwap active={copied} resting={entry.unavailableReason ? <TriangleAlert size={17} /> : <MoreHorizontal size={18} />} engaged={<Check size={17} />} />
          </button>
          {menu.open && <div className="portal-actions-menu" id={`portal-menu-${entry.id}`} role="group" aria-label={`${entry.name} actions`}>
            <div className="portal-menu-details"><strong>{entry.instanceName}</strong><span>Minecraft {entry.version}</span>{entry.unavailableReason && <p>{entry.unavailableReason}</p>}</div>
            <button onClick={() => { menu.setOpen(false); onOpen(); }}><ArrowUpRight size={14} />Open instance</button>
            {entry.kind === "server" && <button disabled={copying} onClick={async () => { setCopying(true); if (await onCopy()) { setCopied(true); menu.setOpen(false); menu.trigger.current?.focus(); } setCopying(false); }}><Copy size={14} />{copying ? "Copying…" : "Copy address"}</button>}
            {entry.removable && <button disabled={changing} onClick={() => { menu.setOpen(false); onRemove(); }} aria-label={`Remove ${entry.name} shortcut`}><Trash2 size={14} />Remove shortcut</button>}
          </div>}
        </div>
        {launch}
      </div>
    </div>
    <ToolbarDrawer id={`portal-remove-${entry.id}`} open={removing} className="portal-remove-drawer">
      <div className="portal-remove-confirm" role="group" aria-label={`Remove ${entry.name} shortcut`}><p>Remove this shortcut?</p><button disabled={changing} onClick={onKeep}>Keep</button><button disabled={changing} onClick={onConfirmRemove}>Remove</button></div>
    </ToolbarDrawer>
  </article>;
}

function AddServer({ open, instances, SelectControl, busy, error, onClose, onSave }: {
  open: boolean; instances: Instance[]; SelectControl: SelectControl; busy: boolean; error: string; onClose: () => void;
  onSave: (instanceId: string, name: string, address: string) => Promise<boolean>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [name, setName] = useState(""); const [address, setAddress] = useState(""); const [failed, setFailed] = useState(false);
  const labels = instanceLabels(instances);
  useEffect(() => { if (open) { setFailed(false); nameInput.current?.focus({ preventScroll: true }); } }, [open]);
  const selectedId = instances.some(instance => instance.id === instanceId) ? instanceId : instances[0]?.id ?? "";
  return <form ref={form} className="portal-add-form" aria-label="Add a server" onKeyDown={event => {
    if (event.key === "Escape" && !busy && !form.current?.querySelector('.select-trigger[aria-expanded="true"]')) { event.preventDefault(); onClose(); }
  }} onSubmit={async event => { event.preventDefault(); if (busy) return; setFailed(false); if (await onSave(selectedId, name, address)) { setName(""); setAddress(""); } else setFailed(true); }}>
    <label>Name<input ref={nameInput} required maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="My server" /></label>
    <label>Server address<input required maxLength={255} value={address} disabled={busy} onChange={event => setAddress(event.target.value)} placeholder="play.example.com" spellCheck={false} /></label>
    <div className="portal-instance-select"><span>Instance</span><SelectControl ariaLabel="Server instance" value={labels[instances.findIndex(instance => instance.id === selectedId)] ?? "Choose an instance"} options={labels} disabled={busy} onChange={value => setInstanceId(instances[labels.indexOf(value)]?.id ?? "")} /></div>
    <button className="portal-add" type="submit" disabled={busy || !name.trim() || !address.trim() || !selectedId}>{busy ? "Saving…" : "Save server"}</button>
    {failed && <p role="alert" className="portal-form-error">{error || "Couldn’t save. Check the address and try again."}</p>}
  </form>;
}
