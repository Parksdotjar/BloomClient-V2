import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronLeft, ChevronRight, Plus, RotateCw } from "lucide-react";
import { CapeDisplay } from "./CapeDisplay";
import { CapePreview } from "./CapePreview";
import { SkinThumbnail } from "./SkinThumbnail";

type Skin = { id: string; name: string; texture: string; variant: "classic" | "slim" };
type Cape = { id: string; name: string; texture: string; active: boolean };
type Wardrobe = { capes: Cape[]; currentSkin: Skin | null; skins: Skin[] };
type Props = { accountId: string; tab: "capes" | "skins"; motion: boolean; onNotify: (message: string, kind?: "success" | "error") => void };
const wardrobeMemoryCache = new Map<string, Wardrobe>();
window.addEventListener("bloom-clear-transient-caches", () => wardrobeMemoryCache.clear());

export function MinecraftWardrobe({ accountId, tab, motion, onNotify }: Props) {
  const cachedWardrobe = wardrobeMemoryCache.get(accountId) || null;
  const [data, setData] = useState<Wardrobe | null>(cachedWardrobe);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!cachedWardrobe);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(() => tab === "skins" ? (cachedWardrobe?.currentSkin ? "current" : cachedWardrobe?.skins[0]?.id || "") : cachedWardrobe?.capes.find(cape => cape.active)?.id || cachedWardrobe?.capes[0]?.id || "");
  const [variant, setVariant] = useState<"classic" | "slim">("classic");
  const [page, setPage] = useState(1);
  const alive = useRef(true);
  const working = useRef(false);
  const request = useRef(0);
  const reload = async (selectId?: string, refresh = false) => {
    const version = ++request.current;
    if (!wardrobeMemoryCache.has(accountId)) setLoading(true);
    setError("");
    try {
      const result = await invoke<Wardrobe>("get_minecraft_wardrobe", { accountId, refresh });
      if (!alive.current || version !== request.current) return;
      wardrobeMemoryCache.set(accountId, result);
      setData(result);
      setSelected(selectId || (tab === "skins" ? "current" : result.capes.find(cape => cape.active)?.id || result.capes[0]?.id || ""));
      setVariant(selectId ? "classic" : result.currentSkin?.variant || "classic");
    } catch (reason) {
      if (alive.current && version === request.current) {
        if (wardrobeMemoryCache.has(accountId)) onNotify(String(reason), "error");
        else setError(String(reason));
      }
    }
    finally { if (alive.current && version === request.current) setLoading(false); }
  };
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false; ++request.current; }; }, [accountId, tab]);
  const work = async (operation: () => Promise<void>) => {
    if (working.current) return;
    working.current = true; setBusy(true);
    try { await operation(); }
    catch (reason) { if (alive.current) onNotify(String(reason), "error"); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  const upload = () => void work(async () => {
    const id = await invoke<string | null>("import_locker_skin", { accountId });
    if (id && alive.current) { setPage(1); await reload(id); }
  });
  const capes = data?.capes || [];
  const skins = data ? [...(data.currentSkin ? [data.currentSkin] : []), ...data.skins] : [];
  const cape = capes.find(item => item.id === selected);
  const skin = skins.find(item => item.id === selected);
  const list = tab === "skins" ? skins : capes;
  const pages = Math.max(1, Math.ceil((list.length + (tab === "skins" ? 1 : 0)) / 9));
  const equip = () => void work(async () => {
    if (tab === "capes" && cape) {
      const capeId = cape.active ? null : cape.id;
      await invoke("set_official_cape", { accountId, capeId });
      if (alive.current) {
        setData(previous => {
          if (!previous) return previous;
          const next = { ...previous, capes: previous.capes.map(item => ({ ...item, active: item.id === capeId })) };
          wardrobeMemoryCache.set(accountId, next);
          return next;
        });
        onNotify(cape.active ? "Cape unequipped" : "Minecraft cape equipped", "success");
      }
    } else if (tab === "skins" && skin && skin.id !== "current") {
      await invoke("apply_locker_skin", { accountId, skinId: skin.id, variant });
      if (alive.current) {
        setData(previous => {
          if (!previous) return previous;
          const next = { ...previous, currentSkin: { ...skin, id: "current", name: "Current skin", variant } };
          wardrobeMemoryCache.set(accountId, next);
          return next;
        });
        setSelected("current");
        onNotify("Minecraft skin updated", "success");
      }
    } else return;
  });
  const pick = (item: Skin | Cape) => { setSelected(item.id); if ("variant" in item) setVariant(item.variant); };
  const entries: (Skin | Cape | null)[] = tab === "skins" ? [null, ...skins] : capes;
  return <div className="locker-content">
    <div className="locker-collection">
      <div className="locker-collection-heading"><h2>{tab === "skins" ? "Skins" : "Capes"}</h2><div><span>{list.length}</span><button className="locker-refresh" title="Reload from Minecraft" aria-label="Reload wardrobe from Minecraft" disabled={busy || loading} onClick={() => void reload(undefined, true)}><RotateCw size={16} /></button></div></div>
      {loading ? <div className="locker-inline-state" role="status">Loading your Minecraft wardrobe…</div> : error ? <div className="locker-inline-state" role="alert">{error}<button className="locker-state-action" onClick={() => void reload()}>Try again</button></div> : <>
        <div className="locker-grid">{entries.slice((page - 1) * 9, page * 9).map(item => item === null ? <button key="upload" className="locker-upload-skin" onClick={upload} disabled={busy}><Plus size={30} strokeWidth={2.5} /><strong>Upload skin</strong></button> : <article key={item.id} className={`locker-cape ${selected === item.id ? "selected" : ""}`}>
          <button className="locker-art" aria-label={`Preview ${item.name}`} aria-pressed={selected === item.id} onClick={() => pick(item)}>{"variant" in item ? <SkinThumbnail texture={item.texture} variant={item.variant} /> : <CapeDisplay texture={item.texture} motion={false} />}</button>
          <div className="locker-cape-name"><div className="locker-wardrobe-identity"><strong>{item.name}</strong>{(("active" in item && item.active) || item.id === "current") && <span className="locker-equipped-mark" aria-label="Equipped"><Check size={14} strokeWidth={3.2} /></span>}</div></div>
        </article>)}</div>
        {list.length === 0 && tab === "capes" && <div className="locker-inline-state">This Minecraft account has no official capes.</div>}
        {pages > 1 && <div className="locker-pagination"><button aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft /></button><span>{page} / {pages}</span><button aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight /></button></div>}
      </>}
    </div>
    <aside className="locker-detail">
      <div className="locker-preview"><CapePreview texture={tab === "capes" ? cape?.texture : capes.find(item => item.active)?.texture} skinTexture={tab === "skins" ? skin?.texture : data?.currentSkin?.texture} skinUuid={accountId} variant={tab === "skins" ? variant : data?.currentSkin?.variant} front={tab === "skins"} motion={motion} /></div>
      <div className="locker-detail-base"><div className="locker-detail-copy"><small>{tab === "skins" ? "Selected skin" : "Official Minecraft cape"}</small><h2>{tab === "skins" ? skin?.name || "Skins" : cape?.name || "Capes"}</h2></div>
        {tab === "skins" && skin && skin.id !== "current" && <div className="locker-skin-model" role="group" aria-label="Skin arm model"><button aria-pressed={variant === "classic"} onClick={() => setVariant("classic")}>Classic</button><button aria-pressed={variant === "slim"} onClick={() => setVariant("slim")}>Slim</button></div>}
        <button className="locker-equip" disabled={loading || busy || !!error || (tab === "skins" ? !skin || skin.id === "current" : !cape)} onClick={equip}>{busy ? "Saving…" : tab === "skins" ? skin?.id === "current" ? "Current skin" : "Use skin" : cape?.active ? "Unequip" : "Equip cape"}</button>
        {tab === "capes" && cape && <p className="locker-precedence-note">Unequip your Bloom cloak to show this cape in Bloom.</p>}
      </div>
    </aside>
  </div>;
}
