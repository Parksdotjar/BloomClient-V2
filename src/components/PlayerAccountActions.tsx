import { AccountSkinPortrait } from "./SkinThumbnail";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowsLeftRightIcon as ArrowRightLeft, CheckIcon as Check, CaretRightIcon as ChevronRight, CopyIcon as Copy, ArrowSquareOutIcon as ExternalLink, LinkIcon as Link2, UserCircleIcon as UserRound } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "../services/invoke";

type Player = { id: string; name: string };
type Panel = "status" | "link" | "switch";
type Props = { player: string; accounts: Player[]; switching: boolean; onSwitch: (account: Player) => void;
  onSettings: () => void; onNotify: (message: string, kind: "error") => void };

export function PlayerAccountActions({player, accounts, switching, onSwitch, onSettings, onNotify}: Props) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);
  const [copied, setCopied] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const close = () => { setPanel(null); anchor.current?.focus(); };

  useLayoutEffect(() => {
    const el = popup.current, button = anchor.current;
    if (!panel || !el || !button) return;
    const place = () => {
      const r = button.getBoundingClientRect(), parent = button.closest('[role="menu"]')!.getBoundingClientRect();
      const maxX = window.innerWidth - el.offsetWidth - 8, maxY = window.innerHeight - el.offsetHeight - 8;
      const x = parent.right + 6 <= maxX ? parent.right + 6 : parent.left - el.offsetWidth - 6;
      el.style.left = Math.max(8, Math.min(x, maxX)) + "px";
      el.style.top = Math.max(8, Math.min(r.bottom - el.offsetHeight >= 8 ? r.bottom - el.offsetHeight : r.top, maxY)) + "px";
    };
    place();
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const observer = new ResizeObserver(place);
    observer.observe(el); observer.observe(button);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [panel]);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        await invoke("social_session_state");
        const result = await invoke<{hidden:boolean}>("social_player_settings", {player, action:"visibility"});
        if (live) setHidden(result.hidden);
      } catch { if (live) setHidden(null); }
    }
    void load();
    return () => { live = false; };
  }, [player]);
  useEffect(() => {
    if (!code) return;
    const timer = setTimeout(() => setCode(""), 300000);
    return () => clearTimeout(timer);
  }, [code]);

  useEffect(() => {
    if (panel !== "link") return;
    let live = true, checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const result = await invoke<{linked:boolean}>("social_player_settings", {player, action:"linkStatus"});
        if (live) {
          setLinked(result.linked);
          if (result.linked) setCode("");
        }
      } catch { /* Retry on focus or while a code is pending. */ }
      finally { checking = false; }
    };
    void check();
    window.addEventListener("focus", check);
    const timer = code ? window.setInterval(check, 4000) : undefined;
    return () => { live = false; window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [panel, player, code]);

  async function act(task: () => Promise<void>) {
    setBusy(true);
    try { await task(); } catch (error) { onNotify(String(error), "error"); }
    finally { setBusy(false); }
  }
  function row(id: Panel, icon: ReactNode, label: string) {
    return <button role="menuitem" aria-haspopup="menu" aria-expanded={panel === id}
      onClick={event => { anchor.current = event.currentTarget; setPanel(panel === id ? null : id); }}>
      {icon}<span>{label}</span><ChevronRight size={14}/></button>;
  }
  const status = hidden === null ? "Player status" : hidden ? "Invisible" : "Online";
  return <div className="account-menu-actions rail-player-rows">
    {row("status", <i className={`social-status-dot ${hidden === false ? "online" : ""}`}/>, status)}
    {row("link", <Link2 size={16}/>, "Link website account")}
    <button role="menuitem" onClick={onSettings}><UserRound size={16}/><span>Account settings</span></button>
    {row("switch", <ArrowRightLeft size={16}/>, "Switch account")}
    {panel && createPortal(<div ref={popup} className="account-menu-actions rail-player-flyout" role="menu"
      aria-label={{status:"Player status",link:"Link website account",switch:"Switch account"}[panel]}
      onClick={e => e.stopPropagation()} onKeyDown={e => {
        if (["Escape","ArrowLeft"].includes(e.key)) { e.stopPropagation(); e.preventDefault(); close(); }
        if (["ArrowDown","ArrowUp","Home","End"].includes(e.key)) {
          e.stopPropagation(); e.preventDefault();
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const i = items.indexOf(document.activeElement as HTMLButtonElement);
          items[e.key === "Home" ? 0 : e.key === "End" ? items.length-1 : (i + items.length + (e.key === "ArrowDown" ? 1 : -1)) % items.length]?.focus();
        }
      }}>
      {panel === "status" && [false,true].map(value => <button key={String(value)} role="menuitemradio" aria-checked={hidden === value} disabled={busy}
        onClick={() => void act(async () => {
          const result = await invoke<{hidden:boolean}>("social_player_settings", {player, action:"setVisibility", hidden:value});
          setHidden(result.hidden); close();
        })}><i className={`social-status-dot ${value ? "" : "online"}`}/><span>{value ? "Invisible" : "Online"}</span>{hidden === value && <Check size={14}/>}</button>)}
      {panel === "switch" && accounts.map(account => <button key={account.id} role="menuitemradio" aria-checked={account.id === player}
        disabled={switching || account.id === player} onClick={() => onSwitch(account)}><AccountSkinPortrait accountId={account.id}/>{account.name}{account.id === player && <Check size={14}/>}</button>)}
      {panel === "link" && linked && <div className="rail-link-code" role="status"><span><Check size={15} aria-hidden="true" /> Account linked</span></div>}
      {panel === "link" && !linked && <>
        {code ? <div className="rail-link-code"><code>{code.slice(0,4)} {code.slice(4)}</code><small>Expires in 5 minutes</small></div> : null}
        <button role="menuitem" disabled={busy} onClick={() => void act(async () => {
          if (code) { await navigator.clipboard.writeText(code); setCopied(true); }
          else { const result = await invoke<{code:string}>("social_player_settings", {player,action:"linkCode"}); setCode(result.code); setCopied(false); }
        })}>{code ? <Copy size={16}/> : <Link2 size={16}/>} {code ? copied ? "Copied" : "Copy code" : "Get link code"}</button>
        <button role="menuitem" onClick={() => void act(() => openUrl(import.meta.env.VITE_PLAYER_LINK_LOCAL === "1" ? "http://127.0.0.1:4176/link-player/" : "https://delightproductions.org/link-player/"))}><ExternalLink size={16}/>Open linking page</button>
      </>}
    </div>, document.body)}
  </div>;
}
