import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import { ChevronDown, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { SettingsState } from '../main';
import { captureAppearance, sameAppearance, deletePreset, readPresets, writePreset, type Appearance, type AppearancePreset } from '../services/appearance-presets';
import { accentGradient } from '../services/animated-accent';
import { invoke } from '../services/invoke';
import './appearance-presets.css';

export function AppearancePresets({ settings, backgroundImage, onApply, positionMenu, revealMenu }: { settings: SettingsState; backgroundImage: string | null; onApply: (appearance: Appearance, image: string | null) => void; positionMenu: (bounds: DOMRect, width: number, height: number, left: number) => { top: number; left: number; width: number; maxHeight: number }; revealMenu: (menu: HTMLDivElement) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusFirst = useRef(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 200, maxHeight: 330 });
  const [presets, setPresets] = useState<AppearancePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (bounds) setPosition(positionMenu(bounds, bounds.width - 10, menu.current?.scrollHeight || 200, bounds.left + 5));
    };
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(true); } };
    place();
    if (menu.current) revealMenu(menu.current);
    if (focusFirst.current) { menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); focusFirst.current = false; }
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, presets.length, positionMenu, revealMenu]);
  const load = async () => { setLoading(true); setError(''); try { setPresets((await readPresets()).sort((a, b) => a.created - b.created)); } catch (e) { setError(String(e)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const save = () => run(async () => {
    const title = name.trim();
    if (!title) return;
    if (presets.some(p => p.name.toLocaleLowerCase() === title.toLocaleLowerCase())) throw new Error('An appearance already has that name.');
    const record: AppearancePreset = { id: crypto.randomUUID(), name: title, appearance: captureAppearance(settings), image: backgroundImage ?? await invoke<string | null>('load_custom_background'), created: Date.now() };
    if (record.appearance.customBackground && record.appearance.backgroundMode === 'image' && !record.image) throw new Error('Choose a background image before saving this appearance.');
    await writePreset(record);
    setPresets(current => [...current, record]);
    setEditor(null); setNotice('Appearance saved.');
  });
  const apply = (preset: AppearancePreset) => run(async () => {
    let image: string | null = null;
    if (preset.image) {
      const bytes = Array.from(new Uint8Array(await (await fetch(preset.image)).arrayBuffer()));
      image = await invoke<string>('save_custom_background', { bytes });
    } else { await invoke('clear_custom_background'); }
    onApply(preset.appearance, image);
    setNotice(`${preset.name} applied.`);
  });
  const selected = presets.find(p => sameAppearance(captureAppearance(settings), p.appearance) && backgroundImage === p.image);
  const edit = () => { close(); setEditor('new'); setName(''); setRemoving(null); setError(''); };
  return <div className="appearance-presets" aria-busy={busy || loading}>
    <div className="setting-row appearance-preset-row">
      <div><b>Appearance preset</b></div>
      <div className="select-wrap" data-menu-side={position.top < (trigger.current?.getBoundingClientRect().top ?? 0) ? 'above' : 'below'}>
        <button ref={trigger} className="select-trigger" disabled={busy || loading} aria-label="Appearance preset" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-haspopup="dialog" onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); focusFirst.current = true; setOpen(true); if (open) { menu.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); focusFirst.current = false; } } }}>
          <span className="select-value">{loading ? 'Loading…' : busy ? 'Applying…' : selected?.name ?? 'Custom'}</span><ChevronDown size={15} className={open ? 'rotated' : ''} />
        </button>
      </div>
    </div>
    {open && createPortal(<div id={menuId} ref={menu} role="dialog" aria-label="Saved appearances" className="select-menu select-menu-portal appearance-preset-menu" style={{ opacity: 0, clipPath: 'inset(0 0 100% 0)', position: 'fixed', top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight, right: 'auto' }} onKeyDown={event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      if ((event.target as HTMLElement).tagName === 'INPUT') return;
      event.preventDefault(); const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(current + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
    }}>
      <button className="appearance-preset-new" onClick={() => edit()}><Plus size={15} /><span>Save new</span></button>
      {presets.map(preset => <div className={`appearance-preset-option ${selected?.id === preset.id ? 'selected' : ''}`} key={preset.id}>
        <button className="appearance-preset-pick" aria-pressed={selected?.id === preset.id} aria-label={`Apply ${preset.name}`} onClick={() => { close(true); void apply(preset); }}>
          <span className="appearance-preset-swatch" aria-hidden="true" style={{ background: preset.appearance.accentMode === 'animated' ? accentGradient(preset.appearance.accentStops) : preset.appearance.accent }} />
          <span>{preset.name}</span>
        </button>
        <button className="appearance-preset-action" aria-label={`Remove ${preset.name}`} onClick={() => { close(); setRemoving(preset.id); setEditor(null); setError(''); }}><Trash2 size={13} /></button>
      </div>)}
    </div>, document.body)}
    {editor !== null && <form className="appearance-preset-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
      <input autoFocus aria-label="Appearance name" placeholder="Name your appearance" maxLength={48} value={name} disabled={busy} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && !busy) { setEditor(null); trigger.current?.focus(); } }} />
      <button className="appearance-preset-save" disabled={busy || !name.trim()} type="submit">{busy ? <RefreshCw size={16} className="spin" /> : 'Save'}</button>
      <button type="button" aria-label="Cancel naming appearance" disabled={busy} onClick={() => { setEditor(null); trigger.current?.focus(); }}><X size={17} /></button>
    </form>}
    {removing && <div className="appearance-preset-editor"><span>Remove “{presets.find(p => p.id === removing)?.name}”?</span><button disabled={busy} onClick={() => void run(async () => { await deletePreset(removing); setPresets(current => current.filter(p => p.id !== removing)); setRemoving(null); trigger.current?.focus(); setNotice('Preset removed.'); })}>Remove</button><button aria-label="Cancel removing preset" disabled={busy} onClick={() => { setRemoving(null); trigger.current?.focus(); }}><X size={17} /></button></div>}
    {error && <div className="appearance-preset-error" role="alert">{error}{!presets.length && <button disabled={busy || loading} onClick={() => void load()}>Retry</button>}</div>}
    <span className="appearance-preset-announcement" role="status">{notice}</span>
  </div>;
}
