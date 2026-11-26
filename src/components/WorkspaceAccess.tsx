import { useEffect, useId, useRef, useState, type ComponentType, type FormEvent } from "react";
import { Copy, Plus, RefreshCw } from "lucide-react";
import { invoke } from "../services/invoke";
import { userError } from "../services/user-error";
import { connectDelightAccount, socialDirectoryChanged } from "../services/connect-delight-account";
import { WorkspaceFrame, type WorkspaceInstance } from "./PackWorkspace";
import "./workspace-access.css";

type Role = "view" | "edit";
type Link = {id: string; role: Role; expiresAt: number | null; maxUses: number | null; uses: number; revokedAt: number | null};
type Person = {id: string; name: string; role: Role; canPublish: boolean};
type Access = {role: "owner" | Role | null; sharingEnabled?: boolean; links?: Link[]; people?: Person[]};
export type AccessSelectControl = ComponentType<{
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled: boolean;
  ariaLabel: string;
  menuOwner: string;
  showCheckmark: boolean;
}>;
const date = new Intl.DateTimeFormat(undefined, {dateStyle: "medium", timeStyle: "short"});

function linkState(link: Link) {
  if (link.revokedAt !== null) return "Revoked";
  if (link.expiresAt !== null && link.expiresAt <= Date.now()) return "Expired";
  if (link.maxUses !== null && link.uses >= link.maxUses) return "Used up";
  return "Active";
}

export function WorkspaceAccess({instance, SelectControl}: {instance: WorkspaceInstance; SelectControl: AccessSelectControl}) {
  const instanceId = instance.id;
  const formId = useId();
  const [result, setResult] = useState<Access>();
  const [role, setRole] = useState<Role>("view");
  const [hours, setHours] = useState("");
  const [uses, setUses] = useState("");
  const [createdLink, setCreatedLink] = useState<{id: string; url: string}>();
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remove, setRemove] = useState<string>();
  const [signedOut, setSignedOut] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const session = useRef<AbortController>(null);

  const load = async () => invoke<Access>("workspace_manage_access", {instanceId});
  useEffect(() => {
    const refresh = () => {
      setCreatedLink(undefined);
      setResult(undefined);
      setBusy(false);
      setAttempt(value => value + 1);
    };
    window.addEventListener(socialDirectoryChanged, refresh);
    return () => window.removeEventListener(socialDirectoryChanged, refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    setError("");
    setSignedOut(false);
    void load().then(value => {
      if (!controller.signal.aborted) setResult(value);
    }, reason => {
      if (controller.signal.aborted) return;
      const message = userError(reason);
      setSignedOut(message === "Connect your Delight account to continue.");
      setError(message);
    });
    return () => controller.abort();
  }, [instanceId, attempt]);

  const change = async (action: object) => {
    if (busy) return;
    const signal = session.current?.signal;
    setBusy(true);
    setError("");
    try {
      const reply = await invoke<{id?: string; url?: string; sharingEnabled?: boolean}>("workspace_manage_access", {instanceId, action});
      if (signal?.aborted) return;
      if (reply.id && reply.url) { setCreatedLink({id:reply.id, url:reply.url}); setCopied(false); }
      if (typeof reply.sharingEnabled === "boolean") {
        setResult(current => current && {...current, sharingEnabled: reply.sharingEnabled});
      }
      setRemove(undefined);
      const next = await load();
      if (!signal?.aborted) setResult(next);
    } catch (reason) {
      if (!signal?.aborted) setError(userError(reason));
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  };
  const selectRole = (value: Role) => {
    setRole(value);
    setHours(value === "edit" ? "24" : "");
    setUses(value === "edit" ? "1" : "");
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    void change({action:"create", role, expiresInHours:hours === "" ? null : Number(hours), maxUses:uses === "" ? null : Number(uses)});
  };
  const copy = async () => {
    if (!createdLink) return;
    try { await navigator.clipboard.writeText(createdLink.url); setCopied(true); }
    catch { field.current?.focus(); field.current?.select(); }
  };
  const connect = async () => {
    const signal = session.current?.signal;
    setBusy(true);
    setError("");
    try {
      await connectDelightAccount(signal);
      if (!signal?.aborted) { setBusy(false); setAttempt(value => value + 1); }
    } catch (reason) {
      if (!signal?.aborted) { setError(userError(reason)); setBusy(false); }
    }
  };

  const sharingEnabled = result?.sharingEnabled !== false;
  const roleLabel = role === "edit" ? "Edit" : "View";
  const action = result?.role === "owner" && (
    <button type="submit" form={formId} className="instance-play ceramic-action pack-workspace-action" disabled={busy || !sharingEnabled}>
      <Plus size={16} aria-hidden="true" />Create link
    </button>
  );
  return <WorkspaceFrame instance={instance} label="Pack Workspace access" page="access" action={action}>
    <div className="workspace-access">
      {error && <p role="alert" className="workspace-access-error">{error}</p>}
      {!result ? error ? <button type="button" className="settings-action" disabled={busy}
        onClick={() => signedOut ? void connect() : setAttempt(value => value + 1)}>{signedOut ? "Connect account" : "Retry"}</button>
        : <p role="status">Checking access…</p> : result.role !== "owner" ? <p>Only the pack owner can manage access.</p> : <>
          <section className="workspace-access-heading workspace-player-access" aria-labelledby="workspace-player-access">
            <div>
              <h2 id="workspace-player-access">Player link</h2>
              <p role="status">{sharingEnabled ? "New installs allowed" : "New installs paused"}</p>
            </div>
            <button type="button" className="settings-action" disabled={busy}
              onClick={() => void change({action:"setSharing", enabled:!sharingEnabled})}>
              {sharingEnabled ? "Pause sharing" : "Resume sharing"}
            </button>
          </section>
          <form id={formId} onSubmit={sharingEnabled ? create : event => event.preventDefault()} className="workspace-link-form">
            <div className="workspace-role-field">
              <span>Access</span>
              <SelectControl value={roleLabel} options={["View", "Edit"]} onChange={value => selectRole(value === "Edit" ? "edit" : "view")}
                disabled={busy || !sharingEnabled} ariaLabel={`Access: ${roleLabel}`} menuOwner="workspace-access" showCheckmark={false} />
            </div>
            <label>Expires in (hours)<input type="number" min="1" max="2160" placeholder="Never" value={hours} disabled={busy || !sharingEnabled}
              onChange={event => setHours(event.currentTarget.value)} /></label>
            <label>Use limit<input type="number" min="1" max="250" placeholder="Unlimited" value={uses} disabled={busy || !sharingEnabled}
              onChange={event => setUses(event.currentTarget.value)} /></label>
          </form>
          {createdLink && <div className="workspace-created-link">
            <input ref={field} aria-label="New invitation link" readOnly value={createdLink.url} onFocus={event => event.currentTarget.select()}/>
            <button type="button" className="settings-action" onClick={() => void copy()}><Copy size={14} aria-hidden="true"/>{copied ? "Copied" : "Copy link"}</button>
          </div>}
          <section aria-labelledby="workspace-invite-links">
            <div className="workspace-access-heading">
              <h2 id="workspace-invite-links">Links</h2>
              <button type="button" className="settings-action" aria-label="Refresh access" title="Refresh access" disabled={busy}
                onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14} aria-hidden="true"/></button>
            </div>
            {result.links?.length ? <ul className="workspace-access-rows">
              {result.links.map(link => {
                const status = linkState(link);
                return <li key={link.id}><div><strong>{link.role === "edit" ? "Edit link" : "View link"}</strong>
                  <small>{status} · {link.maxUses === null ? `${link.uses} used` : `${link.uses} of ${link.maxUses} used`}
                    {" · "}{link.expiresAt === null ? "Never expires" : date.format(link.expiresAt)}</small></div>
                  {link.revokedAt === null && <button type="button" className="settings-action" disabled={busy} onClick={() => {
                    if (createdLink?.id === link.id) setCreatedLink(undefined);
                    void change({action:"revoke", id:link.id});
                  }}>Revoke link</button>}
                </li>;
              })}
            </ul> : <p>No invitation links yet.</p>}
          </section>
          <section aria-labelledby="workspace-collaborators">
            <h2 id="workspace-collaborators">Collaborators</h2>
            {result.people?.length ? <ul className="workspace-access-rows">{result.people.map(person => <li key={person.id}>
              <div><strong>{person.name}</strong><small>{person.role === "edit" ? "Editor" : "Viewer"}</small></div>
              <div className="workspace-access-actions">
                {person.role === "edit" && <label><input type="checkbox" checked={person.canPublish} disabled={busy}
                  aria-label={`Can publish · ${person.name}`}
                  onChange={event => void change({action:"publish", id:person.id, enabled:event.currentTarget.checked})}/>Can publish</label>}
                {remove === person.id ? <>
                  <button type="button" className="settings-action" disabled={busy} onClick={() => setRemove(undefined)}>Cancel</button>
                  <button type="button" className="settings-action workspace-remove" disabled={busy}
                    onClick={() => void change({action:"remove", id:person.id})}>Remove access</button>
                </> : <button type="button" className="settings-action" disabled={busy} aria-label={`Remove ${person.name}`}
                  onClick={() => setRemove(person.id)}>Remove</button>}
              </div>
            </li>)}</ul> : <p>No collaborators yet.</p>}
          </section>
        </>}
    </div>
  </WorkspaceFrame>;
}
