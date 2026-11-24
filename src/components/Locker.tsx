import { useEffect, useRef, useState, type ReactNode } from "react";
import { chooseEquipment, equipmentSlot, readEquipment, useEquipment } from "../services/locker-equipment";
import { invoke } from "../services/invoke";
import { ChevronLeft, ChevronRight, Shirt, RotateCw, Layers, PersonStanding, Flag, Store, Bird } from "lucide-react";
import { CapePreview, type CapeAnimation } from "./CapePreview";
import { CapeDisplay } from "./CapeDisplay";
import "./locker.css";
import { CapeRedemption } from "./CapeRedemption";
import "./connected-toolbar.css";
import { MinecraftWardrobe, type Wardrobe } from "./MinecraftWardrobe";
import { CosmeticsShop } from "./CosmeticsShop";
import { WingPreview } from "./WingPreview";
import { installedWings, wingRequest, type WingCatalog, type WingRevision, type WingColors } from "../services/delight-wings";
import { WingsShelf } from "./WingsShelf";

export type LockerCloak = { id: string; name: string; textureUrl: string; textureRevision: string; animation?: CapeAnimation | null };
type Profile = { id: string; name: string };
type Me = { capeId: string | null; badgeVisible: boolean };
const api = <T,>(method: string, path: string, accountId?: string, body?: unknown) => invoke<T>("cosmetics_request", { method, path, body: body ?? null, accountId: accountId ?? null });
const cloakCatalogMemoryCache = new Map<string, LockerCloak[]>();
window.addEventListener("bloom-clear-transient-caches", () => { cloakCatalogMemoryCache.clear(); });

function CloakCollection({ profile, motion, onNotify, catalogRevision, claimedId, heading, onBrowse }: { heading: ReactNode; onBrowse: () => void; catalogRevision: number; claimedId?: string; profile: Profile | null; motion: boolean; onNotify: (message: string, kind?: "success" | "error") => void }) {
  const cacheKey = profile?.id || "public";
  const [items, setItems] = useState<LockerCloak[]>(() => cloakCatalogMemoryCache.get(cacheKey) || []);
  const [selected, setSelected] = useState<string | null>(() => cloakCatalogMemoryCache.get(cacheKey)?.[0]?.id || null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!cloakCatalogMemoryCache.has(cacheKey));
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState("");
  const slot = "cloak:" + cacheKey;
  const worn = useEquipment(slot);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const backgroundRefresh = useRef(false);
  const pendingClaim = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const update = () => {
      if (!document.hidden && !refreshing) {
        backgroundRefresh.current = true;
        setRefresh(value => value + 1);
      }
    };
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [refreshing]);
  const generation = useRef(0);
  const notify = useRef(onNotify);
  notify.current = onNotify;

  useEffect(() => { if (claimedId) { setSelected(claimedId); pendingClaim.current = claimedId; } }, [claimedId, catalogRevision]);

  useEffect(() => {
    const current = ++generation.current;
    const revision = equipmentSlot(slot).revision;
    const silent = backgroundRefresh.current;
    backgroundRefresh.current = false;
    let stopped = false;
    if (!cloakCatalogMemoryCache.has(cacheKey)) setLoading(true);
    setRefreshing(true); setError("");
    void (async () => {
      const catalog = profile ? await api<{ items: LockerCloak[] }>("GET", "/v1/capes/locker", profile.id) : {items: []};
      if (stopped) return;
      cloakCatalogMemoryCache.set(cacheKey, catalog.items);
      setItems(catalog.items);
      setSelected(old => catalog.items.some(cape => cape.id === old) ? old : old === null && equipmentSlot(slot).choice === null ? null : catalog.items[0]?.id || null);
      const claimIndex = catalog.items.findIndex(item => item.id === pendingClaim.current);
      if (claimIndex >= 0) { setPage(Math.floor(claimIndex / 9) + 1); pendingClaim.current = undefined; }
      else setPage(old => Math.min(old, Math.max(1, Math.ceil(catalog.items.length / 9))));
      if (profile) {
        try {
          const result = await api<Me>("GET", "/v1/cosmetics/me", profile.id);
          if (!stopped) { setMe(result); readEquipment(slot, revision, result.capeId); }
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

  const wear = (id: string | null) => {
    if (!profile) return;
    setSelected(id);
    chooseEquipment(slot, id, async capeId => {
      await api("PUT", "/v1/capes/equipped", profile.id, { capeId });
    }, message => {
      if (alive.current) { setSelected(equipmentSlot(slot).saved || null); notify.current(message, "error"); }
    });
  };
  const previewId = claimedId && selected === claimedId ? claimedId : worn === undefined ? selected : worn;
  const cape = items.find(item => item.id === previewId);
  const pages = Math.max(1, Math.ceil(items.length / 9));
  const equipped = worn !== undefined ? worn : me?.capeId;

  return <div className={`locker-content ${items.length ? "" : "locker-content-empty"}`}>
        <div className="locker-collection">
          <div className="locker-collection-heading">{heading}<div><span>{items.length}</span><button className="locker-refresh" aria-label="Refresh cloaks" title="Refresh cloaks" disabled={refreshing} onClick={() => setRefresh(value => value + 1)}><RotateCw size={16} className={refreshing ? "spin" : ""} /></button></div></div>
          {loading ? <div className="locker-inline-state" role="status"><Shirt size={30} /><h2>Loading locker…</h2></div> : items.length === 0 ? <div className="locker-inline-state">
            <h2>{error ? "Locker unavailable" : !profile ? "Sign in to Minecraft" : "Your collection starts here"}</h2>
            <p>{error ? "Delight could not load your cloaks." : !profile ? "Your claimed cloaks are saved to your Minecraft account." : "Pick a free cloak in Shop or redeem a code."}</p>
            <button className="locker-state-action" onClick={error ? () => setRefresh(value => value + 1) : onBrowse}>{error ? "Try again" : "Browse Shop"}</button>
          </div> : <>
          <div className="locker-grid">
            {items.slice((page - 1) * 9, page * 9).map(item => {
              const isSelected = selected === item.id;
              const isEquipped = equipped === item.id;
              return <article className={`locker-cape ${isSelected ? "selected" : ""}`} key={item.id} onClick={() => wear(item.id)}>
                <button className="locker-art" aria-label={`Wear ${item.name}`} aria-pressed={isEquipped} aria-description={isEquipped ? "Equipped" : undefined}><CapeDisplay texture={item.textureUrl} animation={item.animation} motion={motion} /></button>
                <div className="locker-cape-name">
                  <div className="locker-cape-identity"><strong>{item.name}</strong></div>

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
            <div className="locker-detail-copy"><h2>{cape?.name}</h2></div>
            {!profile ? <div className="locker-signin-note">Sign in to equip this cloak.</div> : equipped && <button className="locker-equip" onClick={() => wear(null)}>Unequip</button>}
          </div>
        </aside>}
      </div>;
}

export const lockerSections = [
  ["Equipped look", PersonStanding], ["Cloaks", Layers], ["Capes", Flag], ["Wings", Bird], ["Skins", Shirt], ["Shop", Store],
] as const;
export type LockerSection = typeof lockerSections[number][0];

export async function getEquippedCloak(accountId: string) {
  const slot = equipmentSlot("cloak:" + accountId);
  const revision = slot.revision;
  if (slot.timer === undefined && !slot.active) {
    const me = await api<Me>("GET", "/v1/cosmetics/me", accountId);
    readEquipment("cloak:" + accountId, revision, me.capeId);
  }
  if (!slot.choice) return undefined;
  const cached = cloakCatalogMemoryCache.get(accountId)?.find(item => item.id === slot.choice);
  if (cached) return cached;
  const catalog = await api<{items: LockerCloak[]}>("GET", "/v1/capes/locker", accountId);
  cloakCatalogMemoryCache.set(accountId, catalog.items);
  return catalog.items.find(item => item.id === slot.choice);
}

function EquippedLook({ accountId, motion, onSection }: { accountId: string; motion: boolean; onSection: (section: LockerSection) => void }) {
  const localCape = useEquipment("cape:" + accountId);
  const localCloak = useEquipment("cloak:" + accountId);
  const [look, setLook] = useState<{ wardrobe: Wardrobe; cloak?: LockerCloak; wing?: { item: WingRevision; colors: WingColors } } | null>(null);
  const [error, setError] = useState("");
  const [revision, retry] = useState(0);
  useEffect(() => {
    let current = true;
    setError("");
    Promise.all([
      invoke<Wardrobe>("get_minecraft_wardrobe", { accountId, refresh: false }),
      getEquippedCloak(accountId),
      Promise.all([wingRequest<WingCatalog>("GET", "locker", accountId), installedWings()]),
    ]).then(([wardrobe, cloak, [wings, installed]]) => {
      const equipped = wings.equipped;
      const item = equipped && installed.get(equipped.id + ":" + equipped.revision);
      if (current) setLook({ wardrobe, cloak, wing: item && equipped ? { item, colors: equipped.colors } : undefined });
    }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [accountId, revision]);
  if (error) return <div className="locker-inline-state" role="alert">{error}<button onClick={() => retry(value => value + 1)}>Try again</button></div>;
  if (!look) return <div className="locker-inline-state" role="status">Loading equipped look…</div>;
  const skin = look.wardrobe.currentSkin;
  const cape = look.wardrobe.capes.find(item => localCape === undefined ? item.active : item.id === localCape);
  const cloak = localCloak === undefined ? look.cloak : cloakCatalogMemoryCache.get(accountId)?.find(item => item.id === localCloak);
  return <div className="locker-content">
    <div className="look-slots">{([
      ["Skins", "Skin", skin?.name || "Default skin", Shirt],
      ["Cloaks", "Delight cloak", cloak?.name || "None equipped", Layers],
      ["Capes", "Minecraft cape", cape?.name || "None equipped", Flag],
      ["Wings", "Wings", look.wing?.item.name || "None equipped", Bird],
    ] as const).map(([section, label, name, Icon]) => <button key={section} onClick={() => onSection(section)}><Icon size={19}/><span><small>{label}</small><strong>{name}</strong></span><ChevronRight size={16}/></button>)}</div>
    <aside className="locker-detail" aria-label="Equipped character">{look.wing ? <WingPreview item={look.wing.item} colors={look.wing.colors} accountId={accountId} skinTexture={skin?.texture} variant={skin?.variant} front motion={motion}/> : <div className="locker-preview"><CapePreview skinUuid={accountId} skinTexture={skin?.texture} variant={skin?.variant} texture={cloak?.textureUrl || cape?.texture} animation={cloak?.animation} front={!cloak && !cape} motion={motion}/></div>}</aside>
  </div>;
}

export function Locker(props: { section: LockerSection; onSection: (section: LockerSection) => void; profile: Profile | null; motion: boolean; onNotify: (message: string, kind?: "success" | "error") => void }) {
  const { section, onSection, profile } = props;
  const [claim, setClaim] = useState<{id: string; account?: string; sequence: number}>({id: "", sequence: 0});
  const [shopCategory, setShopCategory] = useState<"Cloaks" | "Wings">("Cloaks");
  const [wing, setWing] = useState<{ id: string; account?: string }>();
  const recordClaim = (id: string) => setClaim(previous => ({id, account: profile?.id, sequence: previous.sequence + 1}));
  const openLocker = (id: string) => { recordClaim(id); onSection("Cloaks"); };
  const openWings = (id: string) => { setWing({ id, account: profile?.id }); onSection("Wings"); };
  const wingShelf = { accountId: profile?.id, motion: props.motion, onNotify: props.onNotify, onOpenLocker: openWings };
  return <section className="locker-workspace desktop-locker">
    <header className="look-heading"><h1>{section}</h1><CapeRedemption key={profile?.id || "guest"} accountId={profile?.id} onNotify={props.onNotify} onClaim={openLocker}/></header>
    {section === "Shop" ? <>
      <div className="shop-cosmetic-categories" role="group" aria-label="Shop categories">
        {(["Cloaks", "Wings"] as const).map(category => <button key={category} aria-pressed={shopCategory === category} onClick={() => setShopCategory(category)}>{category}</button>)}
      </div>
      {shopCategory === "Wings" ? <WingsShelf mode="shop" key={profile?.id || "guest"} {...wingShelf}/> :
        <CosmeticsShop key={profile?.id || "guest"} accountId={profile?.id} motion={props.motion} onNotify={props.onNotify} onAdded={recordClaim} onOpenLocker={openLocker}/>}
    </> :
      section === "Cloaks" ? <CloakCollection key={profile?.id || "guest"} {...props} heading={<span>Collection</span>} onBrowse={() => onSection("Shop")} catalogRevision={claim.sequence} claimedId={claim.account === profile?.id ? claim.id : undefined}/> :
      !profile ? <div className="locker-inline-state"><h2>Sign in to Minecraft</h2><p>Your equipped look and wardrobe appear here when signed in.</p></div> :
      section === "Wings" ? <WingsShelf mode="locker" key={profile.id} {...wingShelf} initialId={wing && wing.account === profile.id ? wing.id : undefined}/> :
      section === "Equipped look" ? <EquippedLook key={profile.id} accountId={profile.id} motion={props.motion} onSection={onSection}/> :
      <MinecraftWardrobe getCloak={getEquippedCloak} key={profile.id + section} accountId={profile.id} tab={section === "Skins" ? "skins" : "capes"} heading={<span>Collection</span>} motion={props.motion} onNotify={props.onNotify}/>}
  </section>;
}
