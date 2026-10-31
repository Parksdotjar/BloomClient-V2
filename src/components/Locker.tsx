import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { invoke } from "../services/invoke";
import { Check, ChevronLeft, ChevronRight, Shirt, RotateCw } from "lucide-react";
import { CapePreview, type CapeAnimation } from "./CapePreview";
import { CapeDisplay } from "./CapeDisplay";
import "./locker.css";
import { CapeRedemption } from "./CapeRedemption";
import "./connected-toolbar.css";
import { MinecraftWardrobe } from "./MinecraftWardrobe";
import { CosmeticsShop } from "./CosmeticsShop";

type Cape = { id: string; name: string; textureUrl: string; textureRevision: string; animation?: CapeAnimation | null };
type Profile = { id: string; name: string };
type Me = { capeId: string | null; badgeVisible: boolean };
const api = <T,>(method: string, path: string, accountId?: string, body?: unknown) => invoke<T>("cosmetics_request", { method, path, body: body ?? null, accountId: accountId ?? null });
const cloakCatalogMemoryCache = new Map<string, Cape[]>();
window.addEventListener("bloom-clear-transient-caches", () => { cloakCatalogMemoryCache.clear(); });

function CloakCollection({ profile, motion, onNotify, catalogRevision, claimedId, heading, onBrowse }: { heading: ReactNode; onBrowse: () => void; catalogRevision: number; claimedId?: string; profile: Profile | null; motion: boolean; onNotify: (message: string, kind?: "success" | "error") => void }) {
  const cacheKey = profile?.id || "public";
  const [items, setItems] = useState<Cape[]>(() => cloakCatalogMemoryCache.get(cacheKey) || []);
  const [selected, setSelected] = useState<string | null>(() => cloakCatalogMemoryCache.get(cacheKey)?.[0]?.id || null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!cloakCatalogMemoryCache.has(cacheKey));
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const backgroundRefresh = useRef(false);
  const pendingClaim = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const update = () => {
      if (!document.hidden && !busy && !refreshing) {
        backgroundRefresh.current = true;
        setRefresh(value => value + 1);
      }
    };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [busy, refreshing]);
  const generation = useRef(0);
  const notify = useRef(onNotify);
  notify.current = onNotify;

  useEffect(() => { if (claimedId) { setSelected(claimedId); pendingClaim.current = claimedId; } }, [claimedId, catalogRevision]);

  useEffect(() => {
    const current = ++generation.current;
    const silent = backgroundRefresh.current;
    backgroundRefresh.current = false;
    let stopped = false;
    if (!cloakCatalogMemoryCache.has(cacheKey)) setLoading(true);
    setRefreshing(true); setError("");
    void (async () => {
      const catalog = profile ? await api<{ items: Cape[] }>("GET", "/v1/capes/locker", profile.id) : {items: []};
      if (stopped) return;
      cloakCatalogMemoryCache.set(cacheKey, catalog.items);
      setItems(catalog.items);
      setSelected(old => catalog.items.some(cape => cape.id === old) ? old : catalog.items[0]?.id || null);
      const claimIndex = catalog.items.findIndex(item => item.id === pendingClaim.current);
      if (claimIndex >= 0) { setPage(Math.floor(claimIndex / 9) + 1); pendingClaim.current = undefined; }
      else setPage(old => Math.min(old, Math.max(1, Math.ceil(catalog.items.length / 9))));
      if (profile) {
        try {
          const result = await api<Me>("GET", "/v1/cosmetics/me", profile.id);
          if (!stopped) setMe(result);
        } catch (reason) {
          if (!stopped) {
            setError(String(reason));
            if (!silent) notify.current(String(reason), "error");
          }
        }
      }
    })().catch(reason => {
      if (!stopped) {
        setError(String(reason));
        if (!silent) notify.current(String(reason), "error");
      }
    })
      .finally(() => { if (!stopped && current === generation.current) { setLoading(false); setRefreshing(false); } });
    return () => { stopped = true; ++generation.current; };
  }, [profile?.id, refresh, catalogRevision]);

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
    finally {
      if (alive.current) {
        setBusy(false);
        // A claim can refresh the catalog while an equip request is completing.
        if (current !== generation.current) setRefresh(value => value + 1);
      }
    }
  };

  const equipItem = (item: Cape) => {
    setSelected(item.id);
    if (!profile) {
      notify.current("Sign in with Minecraft to equip a cloak.", "error");
      return;
    }
    if (!me || busy || refreshing) return;
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

  return <div className={`locker-content ${items.length ? "" : "locker-content-empty"}`}>
        <div className="locker-collection">
          <div className="locker-collection-heading">{heading}<div><span>{items.length}</span><button className="locker-refresh" aria-label="Refresh cloaks" title="Refresh cloaks" disabled={busy || refreshing} onClick={() => setRefresh(value => value + 1)}><RotateCw size={16} className={refreshing ? "spin" : ""} /></button></div></div>
          {loading ? <div className="locker-inline-state" role="status"><Shirt size={30} /><h2>Loading locker…</h2></div> : items.length === 0 ? <div className="locker-inline-state">
            <h2>{error ? "Locker unavailable" : !profile ? "Sign in to Minecraft" : "Your collection starts here"}</h2>
            <p>{error ? "Bloom could not load your cloaks." : !profile ? "Your claimed cloaks are saved to your Minecraft account." : "Pick a free cloak in Shop or redeem a code."}</p>
            <button className="locker-state-action" onClick={error ? () => setRefresh(value => value + 1) : onBrowse}>{error ? "Try again" : "Browse Shop"}</button>
          </div> : <>
          <div className="locker-grid">
            {items.slice((page - 1) * 9, page * 9).map(item => {
              const isSelected = selected === item.id;
              const isEquipped = me?.capeId === item.id;
              return <article className={`locker-cape ${isSelected ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)}>
                <button className="locker-art" aria-label={`Preview ${item.name}`} aria-pressed={isSelected}><CapeDisplay texture={item.textureUrl} animation={item.animation} motion={motion} /></button>
                <div className="locker-cape-name">
                  <div className="locker-cape-identity"><strong>{item.name}</strong>{isEquipped && <span className="locker-equipped-mark" aria-label="Equipped" title="Equipped"><Check size={14} strokeWidth={3.2} /></span>}</div>
                  <button className={`locker-card-equip ${isEquipped ? "equipped" : ""}`} disabled={busy || refreshing || Boolean(profile && !me)} onClick={(event) => { event.stopPropagation(); equipItem(item); }}>
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
          </div>}</>}
        </div>

        {items.length > 0 && <aside className="locker-detail">
          <div className="locker-preview"><CapePreview texture={cape?.textureUrl} animation={cape?.animation} skinUuid={profile?.id} motion={motion} /></div>
          <div className="locker-detail-base">
            <div className="locker-detail-copy"><small>Selected cloak</small><h2>{cape?.name}</h2></div>
            {!profile ? <div className="locker-signin-note">Sign in to equip this cloak.</div> : <button className={`locker-equip ${equipped ? "equipped" : ""}`} disabled={busy || refreshing || !cape || !me} onClick={() => { if (cape) equipItem(cape); }}>{busy ? "Saving…" : equipped ? "Unequip" : "Equip cloak"}</button>}
          </div>
        </aside>}
      </div>;
}

export function Locker(props: { profile: Profile | null; motion: boolean; onNotify: (message: string, kind?: "success" | "error") => void }) {
  const [view, setView] = useState<"shop" | "locker">("shop");
  const [tab, setTab] = useState<"cloaks" | "capes" | "skins">("cloaks");
  const [claim, setClaim] = useState<{id: string; account?: string; sequence: number}>({id: "", sequence: 0});
  const tabs = ["cloaks", "capes", "skins"] as const;
  const recordClaim = (id: string) => setClaim(previous => ({id, account: props.profile?.id, sequence: previous.sequence + 1}));
  const openLocker = (id: string) => { recordClaim(id); setTab("cloaks"); setView("locker"); };
  const categories = <div className="locker-category-picker" role="tablist" aria-label="Locker category">
        {tabs.map((name, index) => <button key={name} id={`locker-tab-${name}`} role="tab" aria-selected={tab === name} aria-controls="locker-panel" tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
          const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!offset && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : tabs[(index + offset + 3) % 3];
          setTab(target); requestAnimationFrame(() => document.getElementById(`locker-tab-${target}`)?.focus());
        }}>{name[0].toUpperCase() + name.slice(1)}</button>)}
      </div>;
  return <section className="locker-workspace cosmetics-workspace">
    <div className="locker-heading-shell">
      <header className="locker-platform"><div className="cosmetics-main-tabs toolbar-segments" role="tablist" aria-label="Cosmetics workspace"
        style={{"--segments":2,"--selected":view === "shop" ? 0 : 1} as CSSProperties}><i aria-hidden="true" />
        {(["shop","locker"] as const).map(name => <button key={name} id={`cosmetics-tab-${name}`} role="tab" aria-selected={view === name} aria-controls="cosmetics-panel" tabIndex={view === name ? 0 : -1} onClick={() => setView(name)} onKeyDown={event => {
          if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
          event.preventDefault(); const next = event.key === "Home" ? "shop" : event.key === "End" ? "locker" : view === "shop" ? "locker" : "shop";
          setView(next); document.getElementById(`cosmetics-tab-${next}`)?.focus();
        }}>{name === "shop" ? "Shop" : "Locker"}</button>)}
      </div></header>
      <CapeRedemption key={props.profile?.id || "guest"} accountId={props.profile?.id} onNotify={props.onNotify} onClaim={openLocker} />
    </div>
    <div className="cosmetics-panel" id="cosmetics-panel" role="tabpanel" aria-labelledby={`cosmetics-tab-${view}`}>
      <div key={view} className="toolbar-copy">{view === "shop" ? <CosmeticsShop key={props.profile?.id || "guest"} accountId={props.profile?.id} motion={props.motion} onNotify={props.onNotify} onAdded={recordClaim} onOpenLocker={openLocker} /> :
        <div id="locker-panel" role="tabpanel" aria-labelledby={`locker-tab-${tab}`}>{tab === "cloaks" ? <CloakCollection key={props.profile?.id || "guest"} {...props} heading={categories} onBrowse={() => setView("shop")} catalogRevision={claim.sequence} claimedId={claim.account === props.profile?.id ? claim.id : undefined} /> : props.profile ? <MinecraftWardrobe key={props.profile.id + tab} accountId={props.profile.id} tab={tab} heading={categories} motion={props.motion} onNotify={props.onNotify} /> : <div className="locker-collection"><div className="locker-collection-heading">{categories}</div><div className="locker-inline-state"><h2>Sign in to Minecraft</h2><p>Your account’s {tab} will appear here.</p></div></div>}</div>}
      </div>
    </div>
  </section>;
}
