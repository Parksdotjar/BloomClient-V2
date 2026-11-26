import { useEffect, useRef, useState } from "react";
import { ArrowRight, RotateCw } from "lucide-react";
import { installedWings, tintKeys, wingLabels, wingRequest,
  type EquippedWing, type Tint, type WingCatalog, type WingColors, type WingOffer } from "../services/delight-wings";
import { CustomAccentPicker } from "./CustomAccentPicker";
import { WingPreview } from "./WingPreview";
import "./wings-shelf.css";

type Props = {
  mode: "shop" | "locker";
  accountId?: string;
  motion: boolean;
  initialId?: string;
  onOpenLocker: (id: string) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
};

export function WingsShelf({ mode, accountId, motion, initialId, onOpenLocker, onNotify }: Props) {
  const [catalog, setCatalog] = useState<WingCatalog>();
  const [selected, setSelected] = useState(initialId);
  const [draft, setDraft] = useState<WingColors>();
  const [preview, setPreview] = useState<{ key: Tint; color: string }>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  const shop = mode === "shop";
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    setError("");
    void Promise.all([installedWings(), wingRequest<WingCatalog>("GET", mode, accountId)]).then(([assets, data]) => {
      if (!current) return;
      const items = data.items.flatMap(item => {
        const local = assets.get(item.id + ":" + item.revision);
        return local ? [{ ...item, previewRevision: local.previewRevision }] : [];
      });
      setCatalog({ ...data, items });
      setSelected(previous => items.some(item => item.revision === previous) ? previous :
        items.find(item => item.id === initialId || item.revision === data.equipped?.revision)?.revision ?? items[0]?.revision);
      setDraft(undefined);
    }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [mode, accountId, initialId, refresh]);

  async function change(action: () => Promise<void>) {
    setPending(true);
    try { await action(); }
    catch (error) { if (alive.current) onNotify(String(error), "error"); }
    finally { if (alive.current) setPending(false); }
  }

  const item = catalog?.items.find(item => item.revision === selected);
  const equipped = catalog?.equipped;
  const wearing = !!item && equipped?.id === item.id && equipped?.revision === item.revision;
  const finish = item ? draft ?? item.configured ?? item.defaults : undefined;
  const dirty = !!finish && wearing && tintKeys.some(key => finish[key] !== equipped?.colors[key]);

  function claim(offer: WingOffer) {
    void change(async () => {
      await wingRequest("POST", "claim", accountId, { id: offer.id, revision: offer.revision });
      if (alive.current) {
        setCatalog(previous => previous && { ...previous, items: previous.items.map(item => item.id === offer.id ? { ...item, owned: true } : item) });
        onNotify("Added " + offer.name + " to Locker.", "success");
      }
    });
  }

  function equip(next: EquippedWing | { id: null }) {
    void change(async () => {
      const result = await wingRequest<{ equipped: EquippedWing | null }>("PUT", "equipped", accountId, next);
      if (!alive.current) return;
      const saved = result.equipped;
      setCatalog(previous => previous && {
        ...previous, equipped: saved, items: previous.items.map(offer => saved && offer.id === saved.id
          ? { ...offer, configured: saved.colors } : offer),
      });
      setDraft(undefined);
      onNotify(saved ? "Wing colors and equipment saved." : "Wings unequipped.", "success");
    });
  }

  if (error) return <div className="locker-inline-state" role="alert">
    {error}<button onClick={() => setRefresh(value => value + 1)}>Try again</button>
  </div>;
  if (!catalog) return <div className="locker-inline-state" role="status"><RotateCw size={16} className="shop-spinner"/> Loading wings…</div>;
  return <div className={"locker-content wings-layout" + (item ? " has-selection" : "")}>
    <section className="locker-collection wings-collection">
      <header className="locker-collection-heading"><div><h2>{shop ? "Available wings" : "Collection"}</h2>
        {catalog.localPreview && <span>Local preview</span>}</div>
        <button className="locker-refresh" onClick={() => setRefresh(value => value + 1)} disabled={pending} aria-label="Refresh wings"><RotateCw size={16}/></button>
      </header>
      {catalog.items.length ? <div className="locker-grid">
        {catalog.items.map(offer => {
          const active = selected === offer.revision, worn = equipped?.revision === offer.revision;
          return <article key={offer.revision} className={"locker-cape wing-card" + (active ? " selected" : "")}>
            <button className="locker-art" type="button" aria-label={"Preview " + offer.name} aria-pressed={active}
              aria-description={worn ? "Equipped" : undefined} disabled={pending}
              onClick={() => { setSelected(offer.revision); setDraft(undefined); }}>
              <WingPreview item={offer} colors={offer.configured ?? offer.defaults} motion={motion} cosmeticOnly/>
            </button>
            <div className="locker-cape-name"><div className="locker-cape-identity"><strong>{offer.name}</strong></div>
              </div>
          </article>;
        })}
      </div> : <div className="locker-inline-state">{shop ? "No wings are available for this build." : "Wings you add from Shop appear here."}</div>}
    </section>
    {item && finish && <aside className="locker-detail wing-detail" aria-label={item.name + " preview"}>
      <WingPreview key={item.revision} item={item} motion={motion} accountId={accountId}
        colors={preview ? { ...finish, [preview.key]: preview.color } : finish}/>
      <div className="locker-detail-copy"><h2>{item.name}</h2></div>
      {shop ? <button className={item.owned ? "locker-equip wing-open-locker" : "locker-equip"} disabled={pending || !accountId} onClick={() => item.owned ? onOpenLocker(item.id) : claim(item)}>
        {item.owned ? <><span>In Locker</span><ArrowRight size={16} aria-hidden="true" /></> : !accountId ? "Sign in to add" : pending ? "Adding…" : "Add to Locker"}
      </button> : <>
        <fieldset className="wing-colors" disabled={pending}>
          <legend>Colors</legend>
          {tintKeys.map(key => <div className="wing-color" key={key}>
            <span>{wingLabels[key]}</span>
            <CustomAccentPicker label={wingLabels[key] + " color"} value={finish[key]} onApply={color => setDraft({ ...finish, [key]: color })}
              onPreview={color => setPreview(current => color ? { key, color } : current?.key === key ? undefined : current)}/>
          </div>)}
          <button type="button" className="wing-reset" onClick={() => setDraft(item.defaults)}>Restore default colors</button>
        </fieldset>
        <div className="wing-actions">
          <button className="locker-equip" disabled={pending || (wearing && !dirty)} onClick={() => equip({ id: item.id, revision: item.revision, colors: finish })}>
            {pending ? "Saving…" : wearing ? dirty ? "Save colors" : "Equipped" : "Equip"}
          </button>
          {wearing && <button className="locker-equip" disabled={pending} onClick={() => equip({ id: null })}>Unequip</button>}
        </div>
      </>}
    </aside>}
  </div>;
}
