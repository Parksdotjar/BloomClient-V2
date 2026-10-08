import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronLeft, ChevronRight, Feather, RotateCw } from "lucide-react";
import { CapePreview, type CapeAnimation } from "./CapePreview";
import { CapeDisplay } from "./CapeDisplay";
import "./locker.css";
import { MinecraftWardrobe } from "./MinecraftWardrobe";

type Cape = { id: string; name: string; textureUrl: string; textureRevision: string; animation?: CapeAnimation | null };
type Profile = { id: string; name: string };
type Me = { capeId: string | null; badgeVisible: boolean };
const api = <T,>(method: string, path: string, accountId?: string, body?: unknown) => invoke<T>("cosmetics_request", { method, path, body: body ?? null, accountId: accountId ?? null });
let cloakCatalogMemoryCache: Cape[] | null = null;
window.addEventListener("bloom-clear-transient-caches", () => { cloakCatalogMemoryCache = null; });

function CloakCollection({ profile, motion, onNotify }: { profile: Profile | null; motion: boolean; onNotify: (message: string, kind?: "success" | "error") => void }) {
  const [items, setItems] = useState<Cape[]>(() => cloakCatalogMemoryCache || []);
  const [selected, setSelected] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!cloakCatalogMemoryCache);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const notify = useRef(onNotify);
  notify.current = onNotify;

  useEffect(() => {
    const current = ++generation.current;
    let stopped = false;
    if (!cloakCatalogMemoryCache) setLoading(true);
    setError(""); setMe(null); setBusy(false); setPage(1);
    void (async () => {
      const catalog = await api<{ items: Cape[] }>("GET", "/v1/capes");
      if (stopped) return;
      cloakCatalogMemoryCache = catalog.items;
      setItems(catalog.items);
      setSelected(old => catalog.items.some(cape => cape.id === old) ? old : catalog.items[0]?.id || null);
      if (profile) {
        try {
          const result = await api<Me>("GET", "/v1/cosmetics/me", profile.id);
          if (!stopped) setMe(result);
        } catch (reason) {
          if (!stopped) {
            setError(String(reason));
            notify.current(String(reason), "error");
          }
        }
      }
    })().catch(reason => {
      if (!stopped) {
        setError(String(reason));
        notify.current(String(reason), "error");
      }
    })
      .finally(() => { if (!stopped && current === generation.current) setLoading(false); });
    return () => { stopped = true; ++generation.current; };
  }, [profile?.id, refresh]);

  const action = async (work: () => Promise<void>) => {
    const current = generation.current;
    setBusy(true); setError("");
    try { await work(); }
    catch (reason) {
      if (current === generation.current) {
        setError(String(reason));
        notify.current(String(reason), "error");
      }
    }
    finally { if (current === generation.current) setBusy(false); }
  };

  const equipItem = (item: Cape) => {
    setSelected(item.id);
    if (!profile) {
      notify.current("Sign in with Minecraft to equip a cloak.", "error");
      return;
    }
    if (!me || busy) return;
    const capeId = me.capeId === item.id ? null : item.id;
    const current = generation.current;
    void action(async () => {
      await api("PUT", "/v1/capes/equipped", profile.id, { capeId });
      if (current !== generation.current) return;
      setMe(previous => previous && ({ ...previous, capeId }));
      notify.current(capeId ? "Cloak equipped" : "Cloak unequipped", "success");
    });
  };

  const cape = items.find(item => item.id === selected);
  const pages = Math.max(1, Math.ceil(items.length / 9));
  const equipped = cape && me?.capeId === cape.id;

  return <>
      {loading ? <div className="locker-state" role="status">
        <span className="locker-state-mark loading"><Feather size={27} /></span>
        <h2>Opening your locker</h2>
        <p>Loading the latest cloaks.</p>
      </div> : items.length === 0 ? <div className="locker-state">
        <span className="locker-state-mark"><img src="/bloom-logo.png" alt="" /></span>
        <h2>{error ? "Locker unavailable" : "Cloaks coming soon"}</h2>
        <p>{error ? "Bloom could not load the cloak catalog." : "Published cloaks will appear here automatically."}</p>
        <button className="locker-state-action" onClick={() => setRefresh(value => value + 1)}><RotateCw size={15} />Try again</button>
      </div> : <div className="locker-content">
        <div className="locker-collection">
          <div className="locker-collection-heading"><h2>Cloaks</h2><div><span>{items.length}</span><button className="locker-refresh" aria-label="Refresh cloaks" title="Refresh cloaks" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}><RotateCw size={16} /></button></div></div>
          <div className="locker-grid">
            {items.slice((page - 1) * 9, page * 9).map(item => {
              const isSelected = selected === item.id;
              const isEquipped = me?.capeId === item.id;
              return <article className={`locker-cape ${isSelected ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)}>
                <button className="locker-art" aria-label={`Preview ${item.name}`} aria-pressed={isSelected}><CapeDisplay texture={item.textureUrl} animation={item.animation} motion={motion} /></button>
                <div className="locker-cape-name">
                  <div className="locker-cape-identity"><strong>{item.name}</strong>{isEquipped && <span className="locker-equipped-mark" aria-label="Equipped" title="Equipped"><Check size={14} strokeWidth={3.2} /></span>}</div>
                  <button className={`locker-card-equip ${isEquipped ? "equipped" : ""}`} disabled={busy || Boolean(profile && !me)} onClick={(event) => { event.stopPropagation(); equipItem(item); }}>
                    {!profile ? "Sign in" : busy && isSelected ? "Saving…" : isEquipped ? "Unequip" : "Equip cloak"}
                  </button>
                </div>
              </article>;
            })}
          </div>
          {pages > 1 && <div className="locker-pagination">
            <button aria-label="Previous page" title="Previous page" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button>
            <span>{page} / {pages}</span>
            <button aria-label="Next page" title="Next page" disabled={page >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight /></button>
          </div>}
        </div>

        <aside className="locker-detail">
          <div className="locker-preview"><CapePreview texture={cape?.textureUrl} animation={cape?.animation} skinUuid={profile?.id} motion={motion} /></div>
          <div className="locker-detail-base">
            <div className="locker-detail-copy"><small>Selected cloak</small><h2>{cape?.name}</h2></div>
            {!profile ? <div className="locker-signin-note">Sign in to equip this cloak.</div> : <button className={`locker-equip ${equipped ? "equipped" : ""}`} disabled={busy || !cape || !me} onClick={() => { if (cape) equipItem(cape); }}>{busy ? "Saving…" : equipped ? "Unequip" : "Equip cloak"}</button>}
          </div>
        </aside>
      </div>}
  </>;
}

export function Locker(props: { profile: Profile | null; motion: boolean; onNotify: (message: string, kind?: "success" | "error") => void }) {
  const [tab, setTab] = useState<"cloaks" | "capes" | "skins">("cloaks");
  const tabs = ["cloaks", "capes", "skins"] as const;
  return <section className="locker-workspace">
    <div className="locker-heading-shell">
      <header className="locker-platform"><h1>Locker</h1></header>
      <div className="locker-tab-shelf"><div className="locker-tabs" role="tablist" aria-label="Locker category">
        {tabs.map((name, index) => <button key={name} id={`locker-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls="locker-panel" tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
          const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!offset && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : tabs[(index + offset + 3) % 3];
          setTab(target); document.getElementById(`locker-tab-${target}`)?.focus();
        }}>{name[0].toUpperCase() + name.slice(1)}</button>)}
      </div></div>
    </div>
    <div className="locker-recess" id="locker-panel" role="tabpanel" aria-labelledby={`locker-tab-${tab}`}>
      {tab === "cloaks" ? <CloakCollection key={props.profile?.id || "guest"} {...props} /> : props.profile ? <MinecraftWardrobe key={props.profile.id + tab} accountId={props.profile.id} tab={tab} motion={props.motion} onNotify={props.onNotify} /> : <div className="locker-state"><h2>Sign in to Minecraft</h2><p>Your account’s {tab} will appear here.</p></div>}
    </div>
  </section>;
}
