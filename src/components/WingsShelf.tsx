import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon as ArrowRight, ArrowClockwiseIcon as RotateCw } from "@phosphor-icons/react";
import { installedWings, cosmeticColorLabels, wingRequest,
  type CosmeticCategory, type EquippedWing, type Tint, type WingCatalog, type WingColors, type WingOffer } from "../services/delight-wings";
import { CustomAccentPicker } from "./CustomAccentPicker";
import { WingPreview } from "./WingPreview";
import "./wings-shelf.css";

type Props = {
  mode: "shop" | "locker";
  category?: CosmeticCategory;
  accountId?: string;
  motion: boolean;
  initialId?: string;
  onOpenLocker: (id: string) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
};

export function WingsShelf({ mode, category = "wings", accountId, motion, initialId, onOpenLocker, onNotify }: Props) {
  const [catalog, setCatalog] = useState<WingCatalog>();
  const [selected, setSelected] = useState(initialId);
  const [draft, setDraft] = useState<WingColors>();
  const [preview, setPreview] = useState<{ key: Tint; color: string }>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  const equipmentWrites = useRef(Promise.resolve());
  const latestWrite = useRef(0);
  const confirmed = useRef<EquippedWing | null>(null);
  const shop = mode === "shop";
  const hats = category === "hats";
  const label = category === "back" ? "back cosmetics" : category;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    setError("");
    void Promise.all([installedWings(), wingRequest<WingCatalog>("GET", mode, accountId, undefined, category)]).then(([assets, data]) => {
      if (!current) return;
      const items = data.items.flatMap(item => {
        const local = assets.get(item.id + ":" + item.revision);
        return local && local.slot === (hats ? "hat" : category === "back" ? "back" : undefined)
          ? [{ ...item, slot: local.slot, previewRevision: local.previewRevision }] : [];
      });
      confirmed.current = data.equipped ?? null;
      setCatalog({ ...data, items });
      setSelected(previous => items.some(item => item.revision === previous) ? previous :
        items.find(item => item.id === initialId || item.revision === data.equipped?.revision)?.revision ?? items[0]?.revision);
      setDraft(undefined);
    }).catch(reason => { if (current) setError(String(reason)); });
    return () => { current = false; };
  }, [mode, accountId, initialId, refresh, category, hats]);

  async function change(action: () => Promise<void>) {
    setPending(true);
    try { await action(); }
    catch (error) { if (alive.current) onNotify(String(error), "error"); }
    finally { if (alive.current) setPending(false); }
  }

  const item = catalog?.items.find(item => item.revision === selected);
  const labels = item?.id === "mushroom-cap"
    ? { left: "Crown", right: "Spores", trim: "Brim", rightOuter: "Stem" }
    : item?.id === "miners-helmet"
      ? { left: "Center strip", right: "Helmet shell", trim: "Lamp lens", rightOuter: "Lamp housing" }
      : item?.id === "northstar-witch-hat"
        ? { left: "Crown felt", rightOuter: "Brim felt", right: "Woven band", trim: "Brass buckle" }
        : item?.id === "cinder-horns"
          ? { left: "Left horn", right: "Right horn", trim: "Left ember tip", rightOuter: "Right ember tip" }
          : cosmeticColorLabels[category];
  const colorControls = Object.entries(labels) as [Tint, string][];
  const tintKeys = colorControls.map(([key]) => key);
  const equipped = catalog?.equipped;
  const wearing = !!item && equipped?.id === item.id && equipped?.revision === item.revision;
  const finish = item ? draft ?? item.configured ?? item.defaults : undefined;
  const dirty = !!finish && wearing && tintKeys.some(key => finish[key] !== equipped?.colors[key]);

  function claim(offer: WingOffer) {
    void change(async () => {
      await wingRequest("POST", "claim", accountId, { id: offer.id, revision: offer.revision }, category);
      if (alive.current) {
        setCatalog(previous => previous && { ...previous, items: previous.items.map(item => item.id === offer.id ? { ...item, owned: true } : item) });
      }
    });
  }

  function equip(next: EquippedWing | { id: null }) {
    const sequence = ++latestWrite.current;
    setPending(true);
    setCatalog(current => current && { ...current, equipped: next.id === null ? null : next });
    equipmentWrites.current = equipmentWrites.current.then(async () => {
      try {
        const { equipped: saved } = await wingRequest<{ equipped: EquippedWing | null }>("PUT", "equipped", accountId, next, category);
        if (!alive.current) return;
        confirmed.current = saved;
        setCatalog(current => current && {
          ...current, equipped: sequence === latestWrite.current ? saved : current.equipped,
          items: current.items.map(offer => saved && offer.revision === saved.revision
            ? { ...offer, configured: saved.colors } : offer),
        });
      } catch (error) {
        if (alive.current && sequence === latestWrite.current) {
          const previous = confirmed.current;
          setCatalog(current => current && { ...current, equipped: previous });
          if (previous && catalog?.items.some(offer => offer.revision === previous.revision)) setSelected(previous.revision);
          onNotify(String(error), "error");
        }
      } finally {
        if (alive.current && sequence === latestWrite.current) {
          setDraft(undefined);
          setPending(false);
        }
      }
    });
  }

  if (error) return <div className="locker-inline-state" role="alert">
    {error}<button onClick={() => setRefresh(value => value + 1)}>Try again</button>
  </div>;
  if (!catalog) return <div className="locker-inline-state" role="status"><RotateCw size={16} className="shop-spinner"/> Loading {label}…</div>;
  return <div className={"locker-content wings-layout" + (item ? " has-selection" : "")}>
    <section className="locker-collection wings-collection">
      <header className="locker-collection-heading"><div><h2>{shop ? "Available " + label : "Collection"}</h2>
        {catalog.localPreview && <span>Local preview</span>}</div>
        <button className="locker-refresh" onClick={() => setRefresh(value => value + 1)} disabled={pending} aria-label={"Refresh " + label}><RotateCw size={16}/></button>
      </header>
      {catalog.items.length ? <div className="locker-grid">
        {catalog.items.map(offer => {
          const active = selected === offer.revision, worn = equipped?.revision === offer.revision;
          return <article key={offer.revision} className={"locker-cape wing-card" + ((shop ? active : worn) ? " selected" : "")} onClick={() => {
                if (pending || (!shop && worn && active)) return;
                setSelected(offer.revision);
                setDraft(undefined);
                setPreview(undefined);
                if (!shop && !worn) equip({ id: offer.id, revision: offer.revision, colors: offer.configured ?? offer.defaults });
              }}>
            <button className="locker-art" type="button" aria-label={(shop ? "Preview " : "Wear ") + offer.name} aria-pressed={shop ? active : worn}
              aria-description={worn ? "Equipped" : undefined} disabled={pending}>
              <WingPreview item={offer} colors={offer.configured ?? offer.defaults} motion={motion} cosmeticOnly/>
            </button>
            <div className="locker-cape-name"><div className="locker-cape-identity"><strong>{offer.name}</strong></div>
              </div>
          </article>;
        })}
      </div> : <div className="locker-inline-state">{shop ? "No " + label + " are available for this build." : hats ? "Hats you add from Shop appear here." : category === "back" ? "Back cosmetics you add from Shop appear here." : "Wings you add from Shop appear here."}</div>}
    </section>
    {item && finish && <aside className="locker-detail wing-detail" aria-label={item.name + " preview"}>
      <WingPreview item={item} motion={motion} accountId={accountId}
        colors={preview ? { ...finish, [preview.key]: preview.color } : finish}/>
      <div className="locker-detail-copy"><h2>{item.name}</h2></div>
      {shop ? <button className={item.owned ? "locker-equip wing-open-locker" : "locker-equip"} disabled={pending || !accountId} onClick={() => item.owned ? onOpenLocker(item.id) : claim(item)}>
        {item.owned ? <><span>In Locker</span><ArrowRight size={16} aria-hidden="true" /></> : !accountId ? "Sign in to add" : pending ? "Adding…" : "Add to Locker"}
      </button> : <>
        <fieldset className="wing-colors" disabled={pending}>
          <legend>Colors</legend>
          {colorControls.map(([key, name]) => <div className="wing-color" key={item.revision + key}>
            <span>{name}</span>
            <CustomAccentPicker label={name + " color"} value={finish[key] ?? "#ffffff"} onApply={color => {
              const colors = { ...finish, [key]: color };
              setDraft(colors);
              if (wearing) equip({ id: item.id, revision: item.revision, colors });
            }}
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
