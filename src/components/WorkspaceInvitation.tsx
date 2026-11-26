import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Cuboid, Link2, UserRoundPlus } from "lucide-react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import { connectDelightAccount } from "../services/connect-delight-account";
import "./player-link.css";

type Preview = {name: string; creator: string; role: "view" | "edit" | "owner"; playerUrl: string};
export const isWorkspaceInvite = (link: string) => /(?:^delight:\/\/invite\/|\/share\/invite#|\/invite\/)[A-Za-z0-9_-]{43}$/.test(link.trim());

export function WorkspaceInvitation({initialLink, busy, onBack, onPlayerLink, onDownload, onOpen}: {
  initialLink: string;
  busy: boolean;
  onBack: () => void;
  onPlayerLink: (link: string) => void;
  onDownload: (link: string | null) => void;
  onOpen: (id: string, stillHere: () => boolean) => Promise<void>;
}) {
  const [link, setLink] = useState(initialLink);
  const [request, setRequest] = useState(initialLink ? {link:initialLink} : null);
  const [preview, setPreview] = useState<Preview>();
  const [accepted, setAccepted] = useState<Preview>();
  const [loading, setLoading] = useState(!!initialLink);
  const [joining, setJoining] = useState(false);
  const [needsAccount, setNeedsAccount] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    return () => active.abort();
  }, []);
  useEffect(() => {
    if (!request) { field.current?.focus(); return; }
    let current = true;
    setLoading(true);
    setError("");
    void invoke<Preview>("workspace_invitation", {link:request.link, accept:false}).then(
      result => { if (current) setPreview(result); },
      reason => { if (current) setError(userError(reason)); },
    ).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [request]);
  useEffect(() => { if (preview) heading.current?.focus(); }, [preview]);

  const accept = async () => {
    if (!preview || joining) return;
    const signal = controller.current?.signal;
    setJoining(true);
    setError("");
    try {
      if (needsAccount) await connectDelightAccount(signal);
      if (signal?.aborted) return;
      const result = await invoke<Preview>("workspace_invitation", {link:request?.link, accept:true});
      if (signal?.aborted) return;
      setNeedsAccount(false);
      if (result.role === "edit") setAccepted(result);
      else onPlayerLink(result.playerUrl);
    } catch (reason) {
      if (!signal?.aborted) {
        const message = userError(reason);
        setNeedsAccount(message === "Connect your Delight account to continue.");
        setError(message);
      }
    } finally {
      if (!signal?.aborted) setJoining(false);
    }
  };
  const create = async () => {
    if (!accepted || joining || busy) return;
    const signal = controller.current?.signal;
    setJoining(true);
    setError("");
    onDownload(accepted.playerUrl);
    try {
      const id = await invoke<string>("create_workspace_working_copy", {playerUrl:accepted.playerUrl});
      await onOpen(id, () => !signal?.aborted);
    } catch (reason) {
      if (!signal?.aborted) setError(userError(reason));
    } finally {
      onDownload(null);
      if (!signal?.aborted) setJoining(false);
    }
  };

  return <section className="instance-workspace pack-workspace-overview player-link-page" aria-label="Pack invitation">
    <div className="desktop-breadcrumb"><Cuboid size={16} aria-hidden="true"/>Instances<ChevronRight size={13} aria-hidden="true"/><strong>Pack invitation</strong></div>
    <header className="instance-hero-panel"><div className="instance-hero-main"><div className="instance-identity">
      <span className="pack-workspace-art"><Link2 aria-hidden="true"/></span>
      <div><h1 ref={heading} tabIndex={-1}>{preview?.name || "Open invite link"}</h1>
        {preview && <p>{preview.creator} · {preview.role === "edit" ? "Editor invitation" : "Viewer invitation"}</p>}</div>
    </div>
      {preview && <div className="instance-hero-actions">
        <button type="button" className="instance-play ceramic-action pack-workspace-action" disabled={joining || (busy && !!accepted)}
          onClick={() => void (accepted ? create() : accept())}><UserRoundPlus size={16} aria-hidden="true"/>
          {joining ? accepted ? "Preparing working copy…" : "Joining…" : accepted ? "Open working copy" : needsAccount ? "Connect and accept" : "Accept invite"}</button>
      </div>}
    </div></header>
    {preview ? <>
      {error && <p role="alert" className="player-link-error">{error}</p>}
      <button type="button" className="settings-action player-back" disabled={joining} onClick={onBack}><ArrowLeft size={15} aria-hidden="true"/>Back</button>
    </> : <form className="player-link-form" onSubmit={event => {
      event.preventDefault();
      if (link.trim()) setRequest({link:link.trim()});
    }}>
      <label className="creation-field"><span>Invite link</span><input ref={field} value={link} autoComplete="off" spellCheck={false}
        onChange={event => { setLink(event.currentTarget.value); setRequest(null); setLoading(false); setError(""); }}/></label>
      {error && <p role="alert" className="player-link-error">{error}</p>}
      <div className="player-link-actions">
        <button type="button" className="settings-action" onClick={onBack}><ArrowLeft size={15} aria-hidden="true"/>Back</button>
        <button type="submit" className="instance-play ceramic-action pack-workspace-action" disabled={loading || !link.trim()}>
          {loading ? "Opening invite…" : "Preview invite"}<ChevronRight size={15} aria-hidden="true"/></button>
      </div>
    </form>}
  </section>;
}
