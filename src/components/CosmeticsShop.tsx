import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle, Plus, RotateCw, Search, Shirt } from "lucide-react";
import { invoke } from "../services/invoke";
import { CapeDisplay } from "./CapeDisplay";
import type { CapeAnimation } from "./CapePreview";
import "./cosmetics-shop.css";

type ShopCape = { id: string; name: string; textureUrl: string; textureRevision: string; animation?: CapeAnimation | null; owned: boolean };
type Catalog = { items: ShopCape[]; featuredId: string | null; offline?: boolean };
const cache = new Map<string, Catalog>();
window.addEventListener("bloom-clear-transient-caches", () => cache.clear());

export function CosmeticsShop({ accountId, motion, onAdded, onOpenLocker, onNotify }: {
  accountId?: string; motion: boolean; onAdded: (id: string) => void; onOpenLocker: (id: string) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
}) {
  const key = accountId || "public";
  const [catalog, setCatalog] = useState<Catalog | null>(() => cache.get(key) || null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false), [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const alive = useRef(true), fetching = useRef(false), claiming = useRef(false), generation = useRef(0);
  const refresh = async () => {
    if (fetching.current || claiming.current) return;
    const current = ++generation.current;
    fetching.current = true; setRefreshing(true);
    try {
      const result = await invoke<Catalog>("cosmetics_request", { method: "GET", path: "/v1/capes/shop", accountId: accountId ?? null, body: null });
      if (alive.current && generation.current === current) { cache.set(key, result); setCatalog(result); setError(""); }
    } catch (reason) { if (alive.current && generation.current === current) setError(String(reason)); }
    finally { if (generation.current === current) { fetching.current = false; if (alive.current) setRefreshing(false); } }
  };
  useEffect(() => {
    alive.current = true; fetching.current = false; void refresh();
    const update = () => { if (!document.hidden) void refresh(); };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => { alive.current = false; ++generation.current; window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [accountId]);
  const add = async (cape: ShopCape) => {
    if (!accountId || claiming.current || catalog?.offline) return;
    claiming.current = true; ++generation.current; fetching.current = false; setRefreshing(false); setPending(cape.id);
    try {
      await invoke("cosmetics_request", { method: "POST", path: "/v1/capes/claim", accountId, body: { capeId: cape.id } });
      if (!alive.current) return;
      setCatalog(old => {
        if (!old) return old;
        const next = { ...old, items: old.items.map(item => item.id === cape.id ? { ...item, owned: true } : item) };
        cache.set(key, next); return next;
      });
      onAdded(cape.id); onNotify(`Added to Locker: “${cape.name}”`, "success");
    } catch (reason) { if (alive.current) onNotify(String(reason), "error"); }
    finally { claiming.current = false; if (alive.current) setPending(null); }
  };
  const action = (cape: ShopCape, featured = false) => <button className={`shop-claim ${cape.owned ? "owned" : ""} ${featured ? "featured-action" : ""}`}
    aria-label={cape.owned ? `Open ${cape.name} in Locker` : `Add ${cape.name} to Locker`}
    disabled={!!pending || (!cape.owned && (!accountId || !!catalog?.offline))}
    onClick={() => cape.owned ? onOpenLocker(cape.id) : void add(cape)}>
    {pending === cape.id ? <LoaderCircle size={17} className="shop-spinner" /> : cape.owned ? <Check size={17} /> : <Plus size={17} />}
    <span>{pending === cape.id ? "Adding…" : cape.owned ? "In Locker" : !accountId ? "Sign in to add" : "Add to Locker"}</span>
    {featured && cape.owned && <ArrowRight size={16} />}
  </button>;
  const featured = catalog?.items.find(cape => cape.id === catalog.featuredId) || catalog?.items[0];
  const items = catalog?.items.filter(cape => cape.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || [];
  return <div className="cosmetics-shop" aria-busy={refreshing}>
    {(error || catalog?.offline) && <div className="shop-service-note" role="status"><span>{catalog ? "Showing saved capes. Reconnect to check availability." : error}</span><button onClick={() => void refresh()} disabled={refreshing}>Retry</button></div>}
    {!catalog && !error ? <div className="locker-state" role="status"><span className="locker-state-mark loading"><Shirt size={36} /></span><h2>Loading Shop…</h2></div> : <>
      {featured && <article className="shop-feature" aria-label={`Featured: ${featured.name}`}>
        <div className="shop-feature-copy"><span className="shop-eyebrow">Featured cloak</span><h1>{featured.name}</h1><div className="shop-feature-actions">{action(featured, true)}<span className="shop-free">Free</span></div></div>
        <div className="shop-feature-art"><CapeDisplay texture={featured.textureUrl} animation={featured.animation} motion={motion} size="detail" /></div>
      </article>}
      <section className="shop-collection" aria-label="Available cloaks">
        <header className="shop-collection-heading"><div><h2>All cloaks</h2><span>Free to collect</span></div><div className="shop-collection-tools"><label className="shop-search"><Search size={16} /><input aria-label="Search Shop" placeholder="Find a cloak…" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="locker-refresh" aria-label="Refresh Shop" disabled={refreshing || !!pending} onClick={() => void refresh()}><RotateCw size={16} className={refreshing ? "shop-spinner" : ""} /></button></div></header>
        {items.length ? <div className="shop-grid">{items.map(cape => <article key={cape.id} className="shop-card">
          <div className="shop-card-art"><CapeDisplay texture={cape.textureUrl} animation={cape.animation} motion={motion} /></div>
          <div className="shop-card-details"><h3 title={cape.name}>{cape.name}</h3>{action(cape)}</div>
        </article>)}</div> : <div className="shop-empty"><Shirt size={32} strokeWidth={1.5} /><h3>{query ? "No matching cloaks" : error ? "Shop unavailable" : "No drops right now"}</h3><p>{query ? "Try a different name." : error ? "Retry when you’re back online." : "New cloaks will appear here when they’re available."}</p></div>}
      </section>
    </>}
  </div>;
}
