import { useEffect, useRef, useState, type ReactNode } from "react";
import { chooseEquipment, equipmentSlot, readEquipment, useEquipment } from "../services/locker-equipment";
import { invoke } from "../services/invoke";
import { ChevronLeft, ChevronRight, Plus, RotateCw } from "lucide-react";
import { LockerInlineAction } from "./LockerInlineAction";
import { CapeDisplay } from "./CapeDisplay";
import { CapePreview, type CapeAnimation } from "./CapePreview";
import { SkinThumbnail } from "./SkinThumbnail";

type Skin = { id: string; name: string; texture: string; variant: "classic" | "slim" };
type Cape = { id: string; name: string; texture: string; active: boolean };
export type Wardrobe = { capes: Cape[]; currentSkin: Skin | null; skins: Skin[] };
type PreviewCloak = {textureUrl: string; animation?: CapeAnimation | null};
type Props = { getCloak: (id: string) => Promise<PreviewCloak | undefined>; heading?: ReactNode; accountId: string; tab: "capes" | "skins"; motion: boolean; onNotify: (message: string, kind?: "success" | "error") => void };
const wardrobeMemoryCache = new Map<string, Wardrobe>();
window.addEventListener("bloom-clear-transient-caches", () => wardrobeMemoryCache.clear());

function skinLibrary(data: Wardrobe | null) {
  const saved = data?.skins || [];
  const current = data?.currentSkin;
  const matching = current && saved.find(item => item.texture === current.texture);
  return {
    items: current && !matching ? [current, ...saved] : saved,
    worn: matching?.id || current?.id,
  };
}

// One trailing save per account; a mounted view is not required to finish it.
type SkinSync = { wanted: Skin; confirmed: Skin | null; timer: number; running: boolean; after: number; failed: (message: string) => void };
const skinSync = new Map<string, SkinSync>();
const sameSkin = (a: Skin | null, b: Skin) => a?.texture === b.texture && a.variant === b.variant;

function scheduleSkin(accountId: string, sync: SkinSync) {
  clearTimeout(sync.timer);
  if (sync.running) return;
  sync.timer = window.setTimeout(async () => {
    const item = sync.wanted;
    let throttled = false;
    sync.running = true;
    try {
      if (!sameSkin(sync.confirmed, item)) {
        await invoke("apply_locker_skin", { accountId, skinId: item.id, variant: item.variant,
          currentTexture: item.id === "current" ? item.texture : null });
        sync.confirmed = item;
        const cached = wardrobeMemoryCache.get(accountId);
        if (cached) wardrobeMemoryCache.set(accountId, { ...cached, currentSkin: { ...item, id: "current", name: "Current skin" } });
        window.dispatchEvent(new CustomEvent("locker-skin-saved", { detail: accountId }));
      }
    } catch (error) {
      throttled = /rate limit|too many|429/i.test(String(error));
      if (throttled) sync.after = Date.now() + 60_000;
      else if (sync.wanted === item) sync.failed(String(error));
    } finally {
      sync.running = false;
      if (throttled || sync.wanted !== item) scheduleSkin(accountId, sync);
      else skinSync.delete(accountId);
    }
  }, Math.max(850, sync.after - Date.now()));
}

export function MinecraftWardrobe({ accountId, tab, motion, onNotify, heading, getCloak }: Props) {
  const capeSlot = "cape:" + accountId;
  const wornCape = useEquipment(capeSlot);
  const [cloak, setCloak] = useState<PreviewCloak>();
  useEffect(() => {
    if (tab !== "skins") return;
    let current = true;
    void getCloak(accountId).then(item => { if (current) setCloak(item); }).catch(() => {});
    return () => { current = false; };
  }, [accountId, tab, getCloak]);
  const cachedWardrobe = wardrobeMemoryCache.get(accountId) || null;
  const [data, setData] = useState<Wardrobe | null>(cachedWardrobe);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!cachedWardrobe);
  const [refreshing, setRefreshing] = useState(true);
  const [operation, setOperation] = useState<"import" | "equip" | null>(null);
  const busy = operation !== null;
  const [selected, setSelected] = useState(() => tab === "skins" ? (skinSync.get(accountId)?.wanted.id || skinLibrary(cachedWardrobe).worn || cachedWardrobe?.skins[0]?.id || "") : cachedWardrobe?.capes.find(cape => cape.active)?.id || cachedWardrobe?.capes[0]?.id || "");
  const [localPick, setLocalPick] = useState<Skin | null>(() => skinSync.get(accountId)?.wanted || null);
  useEffect(() => {
    const saved = (event: Event) => {
      if ((event as CustomEvent).detail === accountId) setData(wardrobeMemoryCache.get(accountId) || null);
    };
    window.addEventListener("locker-skin-saved", saved);
    return () => window.removeEventListener("locker-skin-saved", saved);
  }, [accountId]);
  const [page, setPage] = useState(1);
  const alive = useRef(true);
  const working = useRef(false);
  const request = useRef(0);
  const reload = async (selectId?: string, refresh = false) => {
    const version = ++request.current;
    const capeRevision = equipmentSlot(capeSlot).revision;
    if (!wardrobeMemoryCache.has(accountId)) setLoading(true);
    setRefreshing(true); setError("");
    try {
      const result = await invoke<Wardrobe>("get_minecraft_wardrobe", { accountId, refresh });
      if (!alive.current || version !== request.current) return;
      wardrobeMemoryCache.set(accountId, result);
      setData(result);
      readEquipment(capeSlot, capeRevision, result.capes.find(item => item.active)?.id || null);
      const available = tab === "skins" ? skinLibrary(result).items : result.capes;
      const fallback = tab === "skins" ? skinLibrary(result).worn || available[0]?.id || "" : result.capes.find(cape => cape.active)?.id || available[0]?.id || "";
      setSelected(previous => available.some(item => item.id === (selectId || previous)) ? selectId || previous : fallback);
      const importedIndex = selectId ? available.findIndex(item => item.id === selectId) : -1;
      setPage(previous => importedIndex >= 0 ? Math.floor(importedIndex / 9) + 1 : Math.min(previous, Math.max(1, Math.ceil(available.length / 9))));
    } catch (reason) {
      if (alive.current && version === request.current) {
        if (wardrobeMemoryCache.has(accountId)) onNotify(String(reason), "error");
        else setError(String(reason));
      }
    }
    finally { if (alive.current && version === request.current) { setLoading(false); setRefreshing(false); } }
  };
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; ++request.current; }; }, [accountId, tab]);
  const addSkin = async (username?: string) => {
    if (working.current) return null;
    working.current = true;
    setOperation("import");
    try {
      const id = username === undefined
        ? await invoke<string | null>("import_locker_skin", { accountId })
        : await invoke<string>("import_skin_by_username", { accountId, username });
      if (id && alive.current) { setLocalPick(null); await reload(id); }
      return id ? "Skin added" : null;
    } finally {
      working.current = false;
      if (alive.current) setOperation(null);
    }
  };
  const capes = data?.capes || [];
  const { items: skins, worn } = skinLibrary(data);
  const highlightedSkin = localPick?.id || worn;
  const cape = capes.find(item => item.id === (wornCape === undefined ? selected : wornCape));
  const skin = localPick || skins.find(item => item.id === selected);
  const variant = localPick?.variant || (skin?.id === worn ? data?.currentSkin?.variant : skin?.variant);
  const list = tab === "skins" ? skins : capes;
  const pages = Math.max(1, Math.ceil(list.length / 9));
  const wearCape = (id: string | null) => {
    setSelected(id || "");
    chooseEquipment(capeSlot, id, async capeId => {
      await invoke("set_official_cape", { accountId, capeId });
      const cached = wardrobeMemoryCache.get(accountId);
      if (cached) {
        const next = { ...cached, capes: cached.capes.map(item => ({...item, active: item.id === capeId})) };
        wardrobeMemoryCache.set(accountId, next);
        if (alive.current) setData(next);
      }
    }, message => { if (alive.current) { setSelected(equipmentSlot(capeSlot).saved || ""); onNotify(message, "error"); } });
  };
  const wearSkin = (item: Skin, model: Skin["variant"]) => {
    const wanted = { ...item, variant: model };
    setLocalPick(wanted);
    setSelected(item.id);
    const sync = skinSync.get(accountId) || { wanted, confirmed: data?.currentSkin || null, timer: 0, running: false, after: 0, failed: () => {} };
    sync.wanted = wanted;
    sync.failed = message => {
      if (alive.current) {
        setLocalPick(null);
        setSelected(skinLibrary(wardrobeMemoryCache.get(accountId) || null).worn || "");
        onNotify(message, "error");
      }
    };
    skinSync.set(accountId, sync);
    scheduleSkin(accountId, sync);
  };
  return <div className={`locker-content ${tab === "skins" ? "skin-workspace" : ""}`}>
    <div className="locker-collection">
      <div className="locker-collection-heading wardrobe-heading">
        <div>{heading || <h2>{tab === "skins" ? "Skins" : "Capes"}</h2>}<span>{list.length}</span>
          <button className="locker-refresh" title="Reload from Minecraft" aria-label="Reload wardrobe from Minecraft" disabled={busy || refreshing} onClick={() => void reload(undefined, true)}><RotateCw size={16} className={refreshing ? "spin" : ""}/></button>
        </div>
        {tab === "skins" && <LockerInlineAction label="Add skin" icon={Plus} field="Minecraft Java username" placeholder="Minecraft username"
          submitLabel="Add by username" maxLength={16} pending="Adding…" disabled={busy || refreshing}
          submit={addSkin} upload={() => addSkin()} onError={message => { onNotify(message, "error"); return "Couldn’t add skin"; }}/>}
      </div>
      {loading ? <div className="locker-inline-state" role="status">Loading your Minecraft wardrobe…</div> : error ? <div className="locker-inline-state" role="alert">{error}<button className="locker-state-action" onClick={() => void reload()}>Try again</button></div> : <>
        <div className={`locker-grid ${tab === "skins" ? "skin-grid" : ""}`}>{list.slice((page - 1) * 9, page * 9).map(item => <article key={item.id} className={`locker-cape ${selected === item.id ? "selected" : ""}`}>
          <button className="locker-art" aria-label={`Wear ${item.name}`} aria-pressed={tab === "skins" ? highlightedSkin === item.id : wornCape === item.id} aria-description={(tab === "capes" && wornCape === item.id) || (tab === "skins" && item.id === worn) ? "Equipped" : undefined} title={item.id === "current" ? "Equipped skin" : item.name} onClick={() => "variant" in item ? wearSkin(item, item.id === worn ? data?.currentSkin?.variant || item.variant : item.variant) : wearCape(item.id)}>{"variant" in item ? <SkinThumbnail texture={item.texture} variant={item.variant} /> : <CapeDisplay texture={item.texture} motion={false} />}</button>
          {tab === "capes" && <div className="locker-cape-name"><strong>{item.name}</strong></div>}
        </article>)}</div>
        {list.length === 0 && tab === "capes" && <div className="locker-inline-state">This Minecraft account has no official capes.</div>}
        {pages > 1 && <div className="locker-pagination"><button aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft /></button><span>{page} / {pages}</span><button aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight /></button></div>}
      </>}
    </div>
    <aside className="locker-detail">
      <div className="locker-preview"><CapePreview texture={tab === "capes" ? cape?.texture : cloak?.textureUrl || capes.find(item => item.active)?.texture} animation={tab === "skins" ? cloak?.animation : undefined} skinTexture={tab === "skins" ? skin?.texture : data?.currentSkin?.texture} skinUuid={accountId} variant={tab === "skins" ? variant : data?.currentSkin?.variant} front={tab === "skins"} motion={motion} /></div>
      {tab === "skins" ? skin && skin.id !== "current" && <div className="locker-skin-model" role="group" aria-label="Skin arm model">
        {(["classic", "slim"] as const).map(model => <button key={model} aria-pressed={variant === model} onClick={() => wearSkin(skin, model)}>{model === "classic" ? "Classic" : "Slim"}</button>)}
      </div> : <div className="locker-detail-base">
        <div className="locker-detail-copy"><h2>{cape?.name || "Capes"}</h2></div>
        {wornCape && <button className="locker-equip" onClick={() => wearCape(null)}>Unequip</button>}
        {cape && <p className="locker-precedence-note">Unequip your Delight cloak to show this cape in Delight.</p>}
      </div>}
    </aside>
  </div>;
}
