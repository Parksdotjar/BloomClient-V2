import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronLeft, RefreshCw, Search, Share2, ShieldCheck, UserRoundCog, UsersRound, X } from "lucide-react";
import "./share-instance.css";

type ShareableInstance = { id: string; name: string; version: string; loader: string; icon?: string | null };
type SocialUser = { id: string; username: string | null; displayName: string | null; avatarUrl: string | null; minecraftUuid: string | null };
type ShareContext = { session: { signedIn: boolean; needsUsername: boolean; user: SocialUser | null }; friends: SocialUser[] };
type CreatedShare = { code: string; expiresAt?: string; revision?: number; editorCount?: number };
type ChannelState = { code: string; role: "owner" | "editor" | "member" };
type AccessInvite = { code: string; id: string; recipientId: string; role: "member" | "editor"; expiresAt: string };
type AccessMember = { id: string; recipientId: string; role: "member" | "editor"; createdAt: number };
type PendingAccess = { id: string; recipientId: string; role: "member" | "editor"; createdAt: number; expiresAt: number };
type AccessOverview = { accessEnabled: boolean; members: AccessMember[]; invites: PendingAccess[] };
type SendResult = { warning: string | null };

const label = (user: SocialUser) => user.displayName || user.username || "Bloom user";

function FriendAvatar({ user }: { user: SocialUser }) {
  const source = user.avatarUrl || (user.minecraftUuid ? `https://mc-heads.net/avatar/${encodeURIComponent(user.minecraftUuid)}/96` : null);
  return <span className="share-friend-avatar">{source ? <img src={source} alt="" referrerPolicy="no-referrer" /> : label(user).slice(0, 2).toUpperCase()}</span>;
}

async function inviteArtwork(source?: string | null) {
  if (!source) return null;
  const image = new Image();
  image.src = source;
  await image.decode();
  const scale = Math.min(1, 192 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [.84, .68, .52]) {
    const result = canvas.toDataURL("image/webp", quality);
    if (result.length <= 160_000) return result;
  }
  return null;
}

export function ShareInstanceDialog({ instance, onClose, onNotify }: { instance: ShareableInstance; onClose: () => void; onNotify: (message: string, kind?: "error" | "notification") => void }) {
  const [context, setContext] = useState<ShareContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [mode, setMode] = useState<"copy" | "synced">("copy");
  const [role, setRole] = useState<"member" | "editor">("member");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [channelState, setChannelState] = useState<ChannelState | null>(null);
  const [managing, setManaging] = useState(false);
  const [access, setAccess] = useState<AccessOverview | null>(null);
  const [accessBusy, setAccessBusy] = useState<string | null>(null);
  const requestKey = useRef(`instance-${crypto.randomUUID()}`);
  const prepared = useRef<{ mode: "copy" | "synced"; role: "member" | "editor"; codes: Map<string, string> } | null>(null);
  const preparedArtwork = useRef<string | null | undefined>(undefined);

  const load = async () => {
    setLoadError(null);
    try {
      const [social, channel] = await Promise.all([
        invoke<ShareContext>("social_share_context"),
        invoke<ChannelState | null>("get_pack_channel_state", { instanceId: instance.id }).catch(() => null),
      ]);
      setContext(social);
      setChannelState(channel);
      if (channel?.role === "owner") setAccess(await invoke<AccessOverview>("get_pack_access_overview", { instanceId: instance.id }).catch(() => null));
    }
    catch (error) { setLoadError(String(error)); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !sending) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [sending, onClose]);

  const friends = useMemo(() => (context?.friends || []).filter(friend => `${label(friend)} ${friend.username || ""}`.toLowerCase().includes(query.toLowerCase())), [context?.friends, query]);
  const occupied = access?.accessEnabled ? access.members.length + access.invites.length : 0;
  const occupiedEditors = access?.accessEnabled ? access.members.filter(item => item.role === "editor").length + access.invites.filter(item => item.role === "editor").length : 0;
  const syncedSlots = Math.max(0, 10 - occupied);
  const syncedEditorSlots = Math.max(0, Math.min(syncedSlots, 5 - occupiedEditors));
  const limit = mode === "synced" ? role === "editor" ? syncedEditorSlots : syncedSlots : 10;
  const managedUpgradeRequired = mode === "synced" && channelState?.role === "owner" && access?.accessEnabled === false;
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < limit ? [...current, id] : current);

  const loadAccess = async () => {
    setAccessBusy("load");
    try { setAccess(await invoke<AccessOverview>("get_pack_access_overview", { instanceId: instance.id })); }
    catch (error) { onNotify(String(error), "error"); setManaging(false); }
    finally { setAccessBusy(null); }
  };
  const openAccess = () => { setManaging(true); void loadAccess(); };
  const accessAction = async (key: string, command: string, payload: Record<string, unknown>, message: string) => {
    if (accessBusy) return;
    setAccessBusy(key);
    try { await invoke(command, { instanceId: instance.id, ...payload }); await loadAccess(); onNotify(message); }
    catch (error) { onNotify(String(error), "error"); }
    finally { setAccessBusy(null); }
  };

  const prepareCodes = async () => {
    if (prepared.current?.mode === mode && prepared.current.role === role && selected.every(id => prepared.current?.codes.has(id))) return prepared.current.codes;
    const codes = new Map<string, string>();
    if (mode === "copy") {
      const share = await invoke<CreatedShare>("create_modpack_share", { instanceId: instance.id });
      selected.forEach(id => codes.set(id, share.code));
    } else {
      let channel = await invoke<ChannelState | null>("get_pack_channel_state", { instanceId: instance.id });
      if (!channel) {
        const created = await invoke<CreatedShare>("create_pack_channel", { instanceId: instance.id });
        channel = { code: created.code, role: "owner" };
        setChannelState(channel);
      }
      if (channel.role && channel.role !== "owner") throw new Error("Only the owner of this synced instance can invite more people.");
      for (const recipientId of selected) codes.set(recipientId, (await invoke<AccessInvite>("create_pack_access_invite", { instanceId: instance.id, recipientId, role })).code);
    }
    prepared.current = { mode, role, codes };
    return codes;
  };

  const send = async () => {
    if (!selected.length || sending) return;
    setSending(true);
    try {
      const codes = await prepareCodes();
      if (preparedArtwork.current === undefined) preparedArtwork.current = await inviteArtwork(instance.icon).catch(() => null);
      const result = await invoke<SendResult>("social_create_instance_invites", {
        requestKey: requestKey.current,
        instanceName: instance.name,
        minecraftVersion: instance.version,
        loader: instance.loader,
        iconDataUrl: preparedArtwork.current,
        shareMode: mode,
        invites: selected.map(recipientId => ({ recipientId, shareCode: codes.get(recipientId), role })),
        note: note.trim() || null,
      });
      onNotify(result.warning || `Invite${selected.length === 1 ? "" : "s"} sent.`);
      onClose();
    } catch (error) { onNotify(String(error), "error"); }
    finally { setSending(false); }
  };

  return <div className="share-instance-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose(); }}>
    <section className="share-instance-dialog" role="dialog" aria-modal="true" aria-labelledby="share-instance-title">
      <header>
        <button className="share-back" disabled={(!managing && step === 1) || sending} onClick={() => managing ? setManaging(false) : setStep(value => Math.max(1, value - 1) as 1 | 2 | 3)} aria-label="Back"><ChevronLeft size={21} /></button>
        <div><span className="share-instance-art">{instance.icon ? <img src={instance.icon} alt="" /> : <Share2 size={24} />}</span><span><h2 id="share-instance-title">{managing ? "Manage access" : `Share ${instance.name}`}</h2><small>{managing ? instance.name : `Step ${step} of 3`}</small></span></div>
        <button className="share-close" disabled={sending} onClick={onClose} aria-label="Close"><X size={22} /></button>
      </header>

      {!context && !loadError ? <div className="share-dialog-loading"><RefreshCw className="spin" size={22} /> Loading friends…</div> : loadError ? <div className="share-dialog-empty"><b>Social is not connected</b><span>Sign in to Bloom Social before sharing an instance with friends.</span><button onClick={() => void load()}>Try again</button></div> : managing ? <div className="share-access-step">
        {!access || accessBusy === "load" ? <div className="share-dialog-loading"><RefreshCw className="spin" size={22} /> Loading access…</div> : !access.accessEnabled ? <div className="share-access-legacy"><ShieldCheck size={28} /><b>Turn on individual access</b><p>Older synced links cannot be revoked one person at a time. Turning this on disables those old links; invite each person again to restore access.</p><button disabled={Boolean(accessBusy)} onClick={() => void accessAction("enable", "enable_pack_managed_access", {}, "Individual access enabled.")}>Enable managed access</button></div> : <>
          <section className="share-access-owner"><FriendAvatar user={context!.session.user!} /><span><b>{label(context!.session.user!)}</b><small>Owner</small></span><em>Can edit</em></section>
          <section className="share-access-list"><header><b>People with access</b><small>{access.members.length}</small></header>{access.members.length ? access.members.map(member => { const user = context!.friends.find(friend => friend.id === member.recipientId); return <article key={member.id}><FriendAvatar user={user || { id: member.recipientId, username: null, displayName: "Bloom member", avatarUrl: null, minecraftUuid: null }} /><span><b>{user ? label(user) : "Bloom member"}</b><small>{user?.username ? `@${user.username}` : "No longer in friends"}</small></span><div><button className={member.role === "member" ? "active" : ""} disabled={Boolean(accessBusy)} onClick={() => member.role !== "member" && void accessAction(member.id, "update_pack_member_role", { accessId: member.id, role: "member" }, "Permission changed.")}>Can view</button><button className={member.role === "editor" ? "active" : ""} disabled={Boolean(accessBusy)} onClick={() => member.role !== "editor" && void accessAction(member.id, "update_pack_member_role", { accessId: member.id, role: "editor" }, "Permission changed.")}>Can edit</button></div><button className="share-access-remove" disabled={Boolean(accessBusy)} onClick={() => void accessAction(member.id, "revoke_pack_member", { accessId: member.id }, "Access removed.")} aria-label="Remove access"><X size={17} /></button></article>; }) : <p className="share-access-empty">No one else has access yet.</p>}</section>
          {access.invites.length > 0 && <section className="share-access-list pending"><header><b>Pending invites</b><small>{access.invites.length}</small></header>{access.invites.map(invite => { const user = context!.friends.find(friend => friend.id === invite.recipientId); return <article key={invite.id}><FriendAvatar user={user || { id: invite.recipientId, username: null, displayName: "Bloom member", avatarUrl: null, minecraftUuid: null }} /><span><b>{user ? label(user) : "Bloom member"}</b><small>Pending</small></span><div><button className={invite.role === "member" ? "active" : ""} disabled={Boolean(accessBusy)} onClick={() => invite.role !== "member" && void accessAction(invite.id, "create_pack_access_invite", { recipientId: invite.recipientId, role: "member" }, "Invitation permission changed.")}>Can view</button><button className={invite.role === "editor" ? "active" : ""} disabled={Boolean(accessBusy)} onClick={() => invite.role !== "editor" && void accessAction(invite.id, "create_pack_access_invite", { recipientId: invite.recipientId, role: "editor" }, "Invitation permission changed.")}>Can edit</button></div><button className="share-access-remove" disabled={Boolean(accessBusy)} onClick={() => void accessAction(invite.id, "invalidate_pack_invite", { inviteId: invite.id }, "Invitation invalidated.")} aria-label="Invalidate invitation"><X size={17} /></button></article>; })}</section>}
        </>}
      </div> : step === 1 ? <div className="share-mode-step">
        <button className={mode === "copy" ? "selected" : ""} onClick={() => { setMode("copy"); setRole("member"); prepared.current = null; }}><span><Share2 size={23} /></span><div><b>Send a copy</b><small>They get their own instance.</small></div><i>{mode === "copy" && <Check size={16} />}</i></button>
        <button className={mode === "synced" ? "selected" : ""} onClick={() => { setMode("synced"); setSelected(current => current.slice(0, role === "editor" ? syncedEditorSlots : syncedSlots)); prepared.current = null; }}><span><UsersRound size={23} /></span><div><b>Keep it synced</b><small>Share future pack updates.</small></div><i>{mode === "synced" && <Check size={16} />}</i></button>
        {mode === "synced" && <div className="share-role-choice"><button className={role === "member" ? "active" : ""} onClick={() => { setRole("member"); setSelected(current => current.slice(0, syncedSlots)); prepared.current = null; }}>Can view</button><button className={role === "editor" ? "active" : ""} onClick={() => { setRole("editor"); setSelected(current => current.slice(0, syncedEditorSlots)); prepared.current = null; }}>Can edit</button></div>}
        {managedUpgradeRequired && <p className="share-managed-required">Enable individual access before sending another synced invitation.</p>}
        {channelState?.role === "owner" && <button className="share-manage-access" onClick={openAccess}><UserRoundCog size={19} /><span><b>Manage access</b><small>People, permissions, and pending invites</small></span></button>}
      </div> : step === 2 ? <div className="share-friends-step">
        <label><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a friend" autoFocus /></label>
        <div className="share-friend-list">{friends.map(friend => <button key={friend.id} className={selected.includes(friend.id) ? "selected" : ""} onClick={() => toggle(friend.id)}><FriendAvatar user={friend} /><span><b>{label(friend)}</b><small>@{friend.username}</small></span><i>{selected.includes(friend.id) && <Check size={15} />}</i></button>)}{!friends.length && <div className="share-no-friends">No matching friends.</div>}</div>
        <small className="share-selection-count">{selected.length} of {limit} selected</small>
      </div> : <div className="share-message-step">
        <div className="share-final-copy"><span className="share-instance-art large">{instance.icon ? <img src={instance.icon} alt="" /> : <Share2 size={28} />}</span><div><b>Invite {selected.length === 1 ? label(context!.friends.find(friend => friend.id === selected[0])!) : `${selected.length} friends`}</b><small>{instance.version} • {instance.loader} • {mode === "copy" ? "Copy" : role === "editor" ? "Synced editor" : "Synced"}</small></div></div>
        <label className="share-note"><span>Message <small>Optional</small></span><textarea value={note} onChange={event => setNote(event.target.value.slice(0, 280))} rows={3} placeholder="Add a message…" /><small>{note.length}/280</small></label>
      </div>}

      {context && !managing && <footer><button className="share-next" disabled={sending || managedUpgradeRequired || (step === 2 && !selected.length)} onClick={() => { if (step < 3) setStep((step + 1) as 1 | 2 | 3); else void send(); }}>{sending ? <><RefreshCw className="spin" size={18} /> Sending…</> : step === 3 ? <><Share2 size={18} /> Send invites</> : "Continue"}</button></footer>}
    </section>
  </div>;
}
