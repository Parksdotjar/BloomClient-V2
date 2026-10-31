import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Ticket, X } from "lucide-react";
import { ToolbarDrawer } from "./ConnectedToolbar";
import { invoke } from "../services/invoke";
import "./cape-redemption.css";

export function CapeRedemption({ accountId, onClaim, onNotify }: {
  accountId?: string;
  onClaim: (id: string) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const alive = useRef(true), inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const redeem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountId || !code.trim() || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); close();
    try {
      const result = await invoke<{ id: string; name: string; alreadyClaimed: boolean }>("cosmetics_request", {
        method: "POST", path: "/v1/capes/redeem", body: { code: code.trim() }, accountId,
      });
      if (!alive.current) return;
      setCode(""); onClaim(result.id);
      onNotify(result.alreadyClaimed ? `“${result.name}” is already in your locker.` : `Cape claimed: “${result.name}”`, "success");
    } catch (reason) {
      if (!alive.current) return;
      const message = String(reason); setError(message); setOpen(true); onNotify(message, "error");
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return <div className="cape-redemption" data-open={open}>
    <button ref={trigger} className="cape-redeem-trigger" aria-label={busy ? "Claiming cape" : open ? "Close redeem code" : "Redeem code"} aria-expanded={open} aria-controls="cape-redeem-drawer" disabled={busy}
      onClick={() => open ? close() : setOpen(true)}>
      {busy ? <LoaderCircle size={17} className="cape-redeem-spinner" /> : open ? <X size={17} /> : <Ticket size={17} />}
      <span>{busy ? "Claiming…" : open ? "Close" : "Redeem code"}</span>
    </button>
    <ToolbarDrawer id="cape-redeem-drawer" open={open} className="cape-redeem-drawer">
      <form onSubmit={redeem} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
        <div className="cape-redeem-field toolbar-reveal-item">
          <Ticket size={19} aria-hidden="true" />
          <input ref={input} id="cape-redeem-input" autoComplete="off" spellCheck={false} maxLength={80}
            placeholder={accountId ? "Enter code" : "Sign in to Minecraft to redeem"} aria-label="Enter cape code" aria-invalid={!!error} aria-describedby={error ? "cape-redeem-error" : undefined}
            value={code} onChange={event => { setCode(event.target.value); setError(""); }} disabled={!accountId || busy} />
          <button type="submit" disabled={!accountId || !code.trim() || busy} aria-label="Claim cape"><ArrowRight size={20} /></button>
        </div>
        {error && <p id="cape-redeem-error" className="cape-redeem-error">{error}</p>}
      </form>
    </ToolbarDrawer>
  </div>;
}
