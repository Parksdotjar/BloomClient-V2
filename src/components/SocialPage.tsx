import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import QRCode from "qrcode";
import { BrowserQRCodeReader } from "@zxing/browser";
import {
  ArrowRightLeft,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  Inbox,
  LockKeyhole,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Reply,
  Search,
  ScanLine,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smile,
  UserPlus,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import "./social.css";
import { reconcileSocialMessages, summarizeReactions, type ReactionSummary } from "./social-message-state";

type SocialUser = {
  id: string;
  username: string | null;
  displayName: string | null;
  minecraftUuid: string | null;
  minecraftUsername: string | null;
  avatarUrl: string | null;
  provider: string | null;
};
type SessionState = { signedIn: boolean; user: SocialUser | null; needsUsername: boolean };
type FriendRequests = { incoming: SocialUser[]; outgoing: SocialUser[] };
type Conversation = { id: string; friend: SocialUser; updatedAt: number };
type Group = { id: string; name: string; iconDataUrl: string | null; ownerId: string; updatedAt: number; members: SocialUser[]; canManage: boolean };
type InstanceInvite = { id: string; sender: SocialUser; recipient: SocialUser; shareMode: "copy" | "synced"; role: "member" | "editor"; instanceName: string; minecraftVersion: string; loader: string; iconDataUrl: string | null; status: "pending" | "installing" | "accepted" | "declined" | "revoked" | "expired"; createdAt: number; updatedAt: number; expiresAt: number };
type InstanceInviteClaim = { claimToken: string; shareCode: string; shareMode: "copy" | "synced"; role: "member" | "editor" };
type ModpackShareImport = { instanceId: string; missingMods: string[] };
type Message = {
  id: string;
  conversationId: string;
  friendId: string;
  groupId: string | null;
  senderId: string;
  kind: "message" | "reaction";
  text: string | null;
  targetId: string | null;
  emoji: string | null;
  reactionOperation: "add" | "remove" | "reply" | null;
  imageDataUrl: string | null;
  pinned: boolean;
  editedAt: number | null;
  createdAt: number;
  deliveryState: string;
};
type Snapshot = { session: SessionState; friends: SocialUser[]; requests: FriendRequests; conversations: Conversation[]; groups: Group[]; invites: InstanceInvite[]; messages: Message[]; syncWarning: string | null };
type SocialChange = { cursor: string; changed: boolean; scopes: string[] };
type SocialMessageSync = { messages: Message[]; syncWarning: string | null };
type SocialSection = "messages" | "friends" | "inbox";
type EncryptionDetails = {
  friendId: string;
  status: "not_verified" | "verified" | "key_changed";
  safetyNumber: string;
  qrPayload: string;
  firstSeenAt: number;
  lastChangedAt: number | null;
  verifiedAt: number | null;
  localDeviceCount: number;
  friendDeviceCount: number;
};

const emptySession: SessionState = { signedIn: false, user: null, needsUsername: false };
const emptySnapshot: Snapshot = { session: emptySession, friends: [], requests: { incoming: [], outgoing: [] }, conversations: [], groups: [], invites: [], messages: [], syncWarning: null };
const reactionChoices = ["👍", "❤️", "😂", "🔥", "🎉", "👀"];

const userLabel = (user: SocialUser) => user.displayName || user.username || "Bloom user";
const initials = (user: SocialUser) => userLabel(user).slice(0, 2).toUpperCase();
const formatTime = (value: number) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));

async function groupIconData(file: File) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [.86, .72, .58]) {
      const value = canvas.toDataURL("image/webp", quality);
      if (value.length <= 160_000) return value;
    }
    throw new Error("That image is too detailed. Choose a smaller image.");
  } finally { URL.revokeObjectURL(source); }
}

function Avatar({ user, large = false }: { user: SocialUser; large?: boolean }) {
  const image = user.avatarUrl || (user.minecraftUuid ? `https://mc-heads.net/avatar/${encodeURIComponent(user.minecraftUuid)}/96` : null);
  return <span className={`social-avatar ${large ? "large" : ""}`} aria-hidden="true">{image ? <img src={image} alt="" referrerPolicy="no-referrer" /> : initials(user)}</span>;
}

function SignInView({ busy, onSignIn }: { busy: boolean; onSignIn: () => void }) {
  return <section className="social-auth-state">
    <img className="social-auth-flower" src={new URL("bloom-logo.png", document.baseURI).href} alt="" />
    <h1>Sign in to use Social</h1>
    <p>Connect a Bloom account to message friends.</p>
    <button onClick={onSignIn} disabled={busy}>{busy ? <RefreshCw className="spin" size={18} /> : <LockKeyhole size={18} />} {busy ? "Waiting for approval…" : "Connect account"}</button>
  </section>;
}

function UsernameSetup({ busy, onSave }: { busy: boolean; onSave: (username: string) => void }) {
  const [username, setUsername] = useState("");
  return <section className="social-auth-state social-name-setup">
    <span className="social-auth-icon"><UserPlus size={34} /></span>
    <h1>Choose your Bloom account username.</h1>
    <p>Friends add you using this exact name. Use 3–20 letters, numbers, or underscores.</p>
    <form onSubmit={event => { event.preventDefault(); onSave(username); }}>
      <label htmlFor="social-username">Username</label>
      <div><input id="social-username" value={username} onChange={event => setUsername(event.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20))} autoFocus autoComplete="off" placeholder="Parks" /><button disabled={busy || username.length < 3}>{busy ? <RefreshCw className="spin" size={18} /> : <Check size={18} />} Save</button></div>
    </form>
  </section>;
}

function FriendRow({ user, active, preview, time, unread, onClick }: { user: SocialUser; active?: boolean; preview?: string; time?: number; unread?: boolean; onClick: () => void }) {
  return <button className={`social-friend-row ${active ? "active" : ""}`} onClick={onClick}>
    <Avatar user={user} />
    <span className="social-friend-copy"><b>{userLabel(user)}</b>{preview && <small>{preview}</small>}</span>
    <span className="social-friend-meta">{time ? <time>{formatTime(time)}</time> : null}{unread && <i />}</span>
  </button>;
}

function FriendsView({ snapshot, busy, onAdd, onOpen, onRemove }: { snapshot: Snapshot; busy: boolean; onAdd: (name: string) => Promise<boolean>; onOpen: (user: SocialUser) => void; onRemove: (id: string) => void }) {
  const [name, setName] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  return <section className="social-directory-view">
    <header className="social-directory-heading-simple"><h2>Friends</h2><b>{snapshot.friends.length}</b></header>
    <form className="social-add-friend" onSubmit={async event => { event.preventDefault(); const submitted = name.trim(); if (submitted && await onAdd(submitted)) setName(""); }}>
      <Search size={18} /><input value={name} onChange={event => setName(event.target.value)} placeholder="Enter an exact Bloom account username" autoComplete="off" /><button disabled={busy || name.trim().length < 3}><UserPlus size={18} /> Add friend</button>
    </form>
    <div className="social-people-list">
      {snapshot.friends.length ? snapshot.friends.map(friend => <div key={friend.id} className="social-friend-manage-row"><button className="social-friend-manage-main" onClick={() => onOpen(friend)}><Avatar user={friend} /><span><b>{userLabel(friend)}</b><small>@{friend.username}</small></span></button><button className="social-friend-manage-more" onClick={() => setMenuFor(value => value === friend.id ? null : friend.id)} aria-label={`Actions for ${userLabel(friend)}`}><MoreHorizontal size={18} /></button>{menuFor === friend.id && <div className="social-member-menu"><button onClick={() => { if (friend.username) void navigator.clipboard.writeText(friend.username); setMenuFor(null); }}>Copy username</button><button onClick={() => onOpen(friend)}>Open direct message</button><button className="danger" disabled={busy} onClick={() => { setMenuFor(null); onRemove(friend.id); }}>Remove friend</button></div>}</div>) : <div className="social-empty-list"><UsersRound size={28} /><b>No friends yet</b><span>Add someone by their exact Bloom account username.</span></div>}
    </div>
  </section>;
}

function InstanceInviteCard({ invite, me, busy, onAccept, onDecline, onRevoke }: { invite: InstanceInvite; me: SocialUser; busy: boolean; onAccept: (invite: InstanceInvite) => void; onDecline: (id: string) => void; onRevoke: (id: string) => void }) {
  const incoming = invite.recipient.id === me.id;
  const other = incoming ? invite.sender : invite.recipient;
  const pending = invite.status === "pending" || invite.status === "installing";
  const status = invite.status === "installing" ? "Installing…" : invite.status.charAt(0).toUpperCase() + invite.status.slice(1);
  return <article className={`social-instance-invite ${incoming ? "incoming" : "outgoing"} ${invite.status}`}>
    <span className="social-invite-art"><img src={invite.iconDataUrl || new URL("bloom-logo.png", document.baseURI).href} alt="" /></span>
    <div className="social-invite-copy"><b>{incoming ? `${userLabel(other)} invited you to play ${invite.instanceName}` : `You invited ${userLabel(other)} to play ${invite.instanceName}`}</b><small>{invite.minecraftVersion} • {invite.loader}</small>{!pending && <em>{status}</em>}</div>
    {incoming && pending ? <div className="social-invite-actions"><button disabled={busy || invite.status === "installing"} onClick={() => onAccept(invite)}><Check size={16} /> Accept</button><button className="social-invite-x" disabled={busy || invite.status === "installing"} onClick={() => onDecline(invite.id)} aria-label="Decline invite" title="Decline"><X size={18} /></button></div> : !incoming && pending ? <button className="social-invite-x social-invite-revoke" disabled={busy || invite.status === "installing"} onClick={() => onRevoke(invite.id)} aria-label="Cancel invite" title="Cancel invite"><X size={18} /></button> : null}
  </article>;
}

function InboxView({ snapshot, busy, onAcceptFriend, onDeclineFriend }: { snapshot: Snapshot; busy: boolean; onAcceptFriend: (id: string) => void; onDeclineFriend: (id: string) => void }) {
  return <section className="social-directory-view">
    <header><div><span>INBOX</span><h2>Friend requests</h2></div><b>{snapshot.requests.incoming.length}</b></header>
    <div className="social-request-list">
      {snapshot.requests.incoming.map(user => <article key={user.id}><Avatar user={user} large /><div><b>{userLabel(user)}</b><span>wants to be friends</span></div><button className="accept" disabled={busy} onClick={() => onAcceptFriend(user.id)}><Check size={18} /> Accept</button><button className="decline" disabled={busy} onClick={() => onDeclineFriend(user.id)} aria-label={`Decline ${userLabel(user)}`}><X size={18} /></button></article>)}
      {!snapshot.requests.incoming.length && <div className="social-empty-list"><Inbox size={28} /><b>Your inbox is clear</b><span>New friend requests will appear here.</span></div>}
    </div>
    {snapshot.requests.outgoing.length > 0 && <><h3 className="social-outgoing-title">Sent</h3><div className="social-request-list">{snapshot.requests.outgoing.map(user => <FriendRow key={user.id} user={user} onClick={() => {}} />)}</div></>}
  </section>;
}

function PinnedMessagesDrawer({ messages, me, authorFor, busy, onClose, onUnpin }: { messages: Message[]; me: SocialUser; authorFor: (message: Message) => SocialUser; busy: boolean; onClose: () => void; onUnpin: (messageId: string) => void }) {
  return <aside className="social-pinned-drawer">
    <header><div><Pin size={18} fill="currentColor" /><span><b>Pinned messages</b><small>{messages.length} saved</small></span></div><button onClick={onClose} aria-label="Close pinned messages"><X size={18} /></button></header>
    <div className="social-pinned-list">
      {messages.length ? messages.map(message => { const author = authorFor(message); return <article key={message.id}>
        <Avatar user={author} />
        <div><span><b>{message.senderId === me.id ? "You" : userLabel(author)}</b><time>{formatTime(message.createdAt)}</time></span>{message.text && <p>{message.text}</p>}{message.imageDataUrl && <img src={message.imageDataUrl} alt="Pinned encrypted screenshot" />}</div>
        <button disabled={busy} onClick={() => onUnpin(message.id)} aria-label="Unpin message" title="Unpin"><Pin size={16} fill="currentColor" /></button>
      </article>; }) : <div className="social-pinned-empty"><Pin size={27} /><b>No pinned messages</b><span>Right-click a message and pin it to keep it beyond 24 hours.</span></div>}
    </div>
  </aside>;
}

function EncryptionDrawer({ friend, details, loading, busy, onClose, onVerify, onContinue }: { friend: SocialUser; details: EncryptionDetails | null; loading: boolean; busy: boolean; onClose: () => void; onVerify: () => void; onContinue: () => void }) {
  const [qrImage, setQrImage] = useState("");
  const [copied, setCopied] = useState(false);
  const [scanError, setScanError] = useState("");
  const scanInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    setQrImage("");
    if (details?.qrPayload) void QRCode.toDataURL(details.qrPayload, { width: 216, margin: 1, color: { dark: "#050607", light: "#ffffff" }, errorCorrectionLevel: "M" }).then(value => { if (active) setQrImage(value); });
    return () => { active = false; };
  }, [details?.qrPayload]);
  const status = details?.status;
  const changed = status === "key_changed";
  const verified = status === "verified";
  const copyNumber = async () => {
    if (!details) return;
    await navigator.clipboard.writeText(details.safetyNumber);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const scanQr = async (file: File) => {
    if (!details) return;
    const source = URL.createObjectURL(file);
    try {
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(source);
      if (result.getText() !== details.qrPayload) {
        setScanError("That code belongs to a different encryption identity.");
        return;
      }
      setScanError("");
      onVerify();
    } catch {
      setScanError("Bloom could not read a verification QR code from that image.");
    } finally { URL.revokeObjectURL(source); }
  };
  return <aside className={`social-encryption-drawer ${changed ? "changed" : ""}`}>
    <header><div><LockKeyhole size={18} /><span><b>Encryption</b><small>@{friend.username}</small></span></div><button onClick={onClose} aria-label="Close encryption details"><X size={19} /></button></header>
    {loading || !details ? <div className="social-security-loading"><RefreshCw className="spin" size={20} /> Checking encryption…</div> : <div className="social-security-body">
      <section className="social-security-status">
        {changed ? <ShieldAlert size={28} /> : <ShieldCheck size={28} />}
        <div><b>{changed ? "Encryption identity changed" : verified ? "Identity verified" : "Messages are encrypted"}</b><p>{changed ? "Bloom found encryption keys that differ from the ones remembered on this device. Review them before sending anything new." : verified ? "You confirmed this safety number matches the one shown by your friend." : "Verification is optional. It is an extra check for the rare case that an encryption identity is unexpectedly replaced."}</p></div>
      </section>
      <section className="social-security-identity"><Avatar user={friend} large /><span><b>{userLabel(friend)}</b><small>{details.friendDeviceCount} active encrypted {details.friendDeviceCount === 1 ? "device" : "devices"}</small></span></section>
      <section className="social-security-code">
        <div><span>Safety number</span><button onClick={() => void copyNumber()}><Copy size={15} /> {copied ? "Copied" : "Copy"}</button></div>
        <p>{details.safetyNumber.split(" ").map((group, index) => <span key={`${group}-${index}`}>{group}</span>)}</p>
      </section>
      <section className="social-security-qr">{qrImage ? <img src={qrImage} alt="Encryption safety number QR code" /> : <RefreshCw className="spin" size={20} />}<p>Compare this QR code or safety number with {userLabel(friend)} through another trusted method.</p></section>
      <div className="social-security-meta"><span>{verified && details.verifiedAt ? "Verified on this device" : changed && details.lastChangedAt ? "Change detected" : "First seen on this device"}</span><b>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(verified && details.verifiedAt ? details.verifiedAt : changed && details.lastChangedAt ? details.lastChangedAt : details.firstSeenAt))}</b></div>
      {!verified ? <div className="social-security-actions">
        <button className="primary" disabled={busy} onClick={onVerify}><Check size={17} /> The numbers match</button>
        <button className="scan" disabled={busy} onClick={() => scanInput.current?.click()}><ScanLine size={17} /> Scan QR image</button>
        <input ref={scanInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) void scanQr(file); event.currentTarget.value = ""; }} />
        {scanError && <p className="social-security-scan-error">{scanError}</p>}
        {changed && <button className="secondary" disabled={busy} onClick={onContinue}>Continue without verifying</button>}
      </div> : <div className="social-security-confirmed"><Check size={16} /><span>This identity is verified on this device.</span></div>}
    </div>}
  </aside>;
}

function MessageContextMenu({ message, reactions, x, y, mine, disabled, onClose, onReply, onReact, onEdit, onPin }: { message: Message; reactions: ReactionSummary[]; x: number; y: number; mine: boolean; disabled: boolean; onClose: () => void; onReply: () => void; onReact: (emoji: string, add: boolean) => void; onEdit: () => void; onPin: () => void }) {
  const available = message.deliveryState === "sent" || message.deliveryState === "delivered";
  return <div className="social-message-context" role="menu" style={{ left: x, top: y }} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <button role="menuitem" disabled={!available} onClick={() => { onReply(); onClose(); }}><Reply size={16} /> Reply</button>
    {mine && message.text && <button role="menuitem" disabled={!available || disabled} onClick={() => { onEdit(); onClose(); }}><Pencil size={16} /> Edit message</button>}
    <button role="menuitem" disabled={!available || disabled} onClick={() => { onPin(); onClose(); }}><Pin size={16} fill={message.pinned ? "currentColor" : "none"} /> {message.pinned ? "Unpin message" : "Pin message"}</button>
    <div className="social-context-reactions" aria-label="Reactions">{reactionChoices.map(emoji => { const reaction = reactions.find(value => value.emoji === emoji); return <button key={emoji} className={reaction?.reactedByMe ? "active" : ""} disabled={!available || disabled || reaction?.pending} onClick={() => { onReact(emoji, !reaction?.reactedByMe); onClose(); }}>{emoji}</button>; })}</div>
  </div>;
}

function ConversationView({ me, friend, messages, invites, busy, encryption, onOpenEncryption, onSend, onEdit, onScreenshot, onReact, onPin, onAcceptInvite, onDeclineInvite, onRevokeInvite }: { me: SocialUser; friend: SocialUser; messages: Message[]; invites: InstanceInvite[]; busy: boolean; encryption: EncryptionDetails | null; onOpenEncryption: () => void; onSend: (text: string, replyTo?: string) => void; onEdit: (messageId: string, text: string) => void; onScreenshot: () => void; onReact: (messageId: string, emoji: string, add: boolean) => void; onPin: (messageId: string, pinned: boolean) => void; onAcceptInvite: (invite: InstanceInvite) => void; onDeclineInvite: (id: string) => void; onRevokeInvite: (id: string) => void }) {
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [contextMenu, setContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [friend.id, messages.length]);
  const visible = messages.filter(message => message.friendId === friend.id && message.kind === "message");
  const pinnedMessages = visible.filter(message => message.pinned);
  const visibleInvites = invites.filter(invite => (invite.sender.id === me.id && invite.recipient.id === friend.id) || (invite.recipient.id === me.id && invite.sender.id === friend.id));
  const timeline = [...visible.map(message => ({ type: "message" as const, createdAt: message.createdAt, message })), ...visibleInvites.map(invite => ({ type: "invite" as const, createdAt: invite.createdAt, invite }))].sort((left, right) => left.createdAt - right.createdAt);
  const reactions = useMemo(() => summarizeReactions(messages.filter(message => message.friendId === friend.id && message.kind === "reaction"), me.id), [friend.id, me.id, messages]);
  useEffect(() => {
    const close = () => setContextMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); window.removeEventListener("blur", close); };
  }, []);
  useEffect(() => { setReplyTo(null); setEditing(null); setDraft(""); setContextMenu(null); }, [friend.id]);
  const blocked = encryption?.status === "key_changed";
  const submit = () => { const value = draft.trim(); if (!value || busy || blocked) return; if (editing) onEdit(editing.id, value); else onSend(value, replyTo?.id); setDraft(""); setReplyTo(null); setEditing(null); setEmojiOpen(false); };
  return <section className="social-conversation">
    <header><div><Avatar user={friend} large /><span><b>{userLabel(friend)}</b><small>@{friend.username}</small></span></div><div className="social-header-actions"><button className={`social-encryption ${blocked ? "warning" : ""}`} onClick={onOpenEncryption}>{blocked ? <ShieldAlert size={17} /> : <LockKeyhole size={17} />} {blocked ? "Review encryption" : "Encryption"}</button><button className={`social-pins-button ${pinsOpen ? "active" : ""}`} onClick={() => setPinsOpen(value => !value)} aria-label="Pinned messages" title="Pinned messages"><Pin size={17} fill={pinnedMessages.length ? "currentColor" : "none"} /></button></div></header>
    <div className="social-message-list" onScroll={() => setContextMenu(null)}>
      {!timeline.length && <div className="social-conversation-empty"><Avatar user={friend} large /><h3>Start a conversation with {userLabel(friend)}</h3><p>Only you and {userLabel(friend)} can read what is sent here.</p></div>}
      {timeline.map(item => {
        if (item.type === "invite") return <InstanceInviteCard key={item.invite.id} invite={item.invite} me={me} busy={busy} onAccept={onAcceptInvite} onDecline={onDeclineInvite} onRevoke={onRevokeInvite} />;
        const message = item.message;
        const mine = message.senderId === me.id;
        const replied = message.reactionOperation === "reply" && message.targetId ? visible.find(value => value.id === message.targetId) : null;
        return <article key={message.id} className={`social-message ${mine ? "mine" : "theirs"} ${message.deliveryState}`} title={message.deliveryState === "pending" ? "Sending…" : message.deliveryState === "failed" ? "Message could not be sent" : undefined} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContextMenu({ messageId: message.id, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 250) }); }}>
          {!mine && <Avatar user={friend} />}
          <div><span className="social-message-author"><b>{mine ? "You" : userLabel(friend)}</b><time>{formatTime(message.createdAt)}</time>{message.editedAt && <small>edited</small>}</span>{replied && <div className="social-message-reply"><Reply size={13} /><span><b>{replied.senderId === me.id ? "You" : userLabel(friend)}</b>{replied.text || "Screenshot"}</span></div>}{message.text && <p>{message.text}</p>}{message.imageDataUrl && <div className="social-message-image"><img src={message.imageDataUrl} alt="Encrypted screenshot" /></div>}{reactions.get(message.id)?.length ? <span className="social-reaction-row">{reactions.get(message.id)?.map(reaction => <button key={reaction.emoji} className={`${reaction.pending ? "pending" : ""} ${reaction.reactedByMe ? "mine" : ""}`} disabled={reaction.pending || blocked} aria-busy={reaction.pending} onClick={() => onReact(message.id, reaction.emoji, !reaction.reactedByMe)}><span>{reaction.emoji}</span><b>{reaction.count}</b></button>)}</span> : null}</div>
        </article>;
      })}
      <div ref={endRef} />
    </div>
    {blocked ? <div className="social-encryption-stop"><ShieldAlert size={21} /><span><b>Review encryption before sending</b><small>Your existing messages are still available.</small></span><button onClick={onOpenEncryption}>Review</button></div> : <div className="social-composer">
      <button className="social-attach" onClick={onScreenshot} disabled={busy} aria-label="Attach encrypted screenshot"><Paperclip size={19} /></button>
      <div className="social-compose-stack">{(replyTo || editing) && <div className="social-compose-reference"><span>{editing ? <Pencil size={14} /> : <Reply size={14} />}<b>{editing ? "Editing message" : `Replying to ${replyTo?.senderId === me.id ? "yourself" : userLabel(friend)}`}</b><small>{editing?.text || replyTo?.text || "Screenshot"}</small></span><button onClick={() => { setReplyTo(null); setEditing(null); if (editing) setDraft(""); }} aria-label="Cancel"><X size={15} /></button></div>}<div className="social-compose-field"><textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, 2000))} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} rows={1} placeholder={editing ? "Edit message" : `Message @${friend.username}`} /><button onClick={() => setEmojiOpen(value => !value)} aria-label="Add emoji"><Smile size={19} /></button>{emojiOpen && <div className="social-emoji-picker">{reactionChoices.map(emoji => <button key={emoji} onClick={() => { setDraft(value => `${value}${emoji}`); setEmojiOpen(false); }}>{emoji}</button>)}</div>}</div></div>
      <button className="social-send" onClick={submit} disabled={busy || !draft.trim()} aria-label="Send message"><Send size={20} fill="currentColor" /></button>
    </div>}
    {pinsOpen && <PinnedMessagesDrawer messages={pinnedMessages} me={me} authorFor={message => message.senderId === me.id ? me : friend} busy={busy} onClose={() => setPinsOpen(false)} onUnpin={messageId => onPin(messageId, false)} />}
    {contextMenu && (() => { const message = visible.find(value => value.id === contextMenu.messageId); return message ? <MessageContextMenu message={message} reactions={reactions.get(message.id) || []} x={contextMenu.x} y={contextMenu.y} mine={message.senderId === me.id} disabled={busy || blocked} onClose={() => setContextMenu(null)} onReply={() => { setReplyTo(message); setEditing(null); setDraft(""); }} onEdit={() => { setEditing(message); setReplyTo(null); setDraft(message.text || ""); }} onReact={(emoji, add) => onReact(message.id, emoji, add)} onPin={() => onPin(message.id, !message.pinned)} /> : null; })()}
  </section>;
}

function GroupAvatar({ group, size = "normal", editable = false, onPick }: { group: Group; size?: "normal" | "large" | "hero"; editable?: boolean; onPick?: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const contents = <>{group.iconDataUrl ? <img src={group.iconDataUrl} alt="" /> : <UsersRound size={size === "hero" ? 27 : size === "large" ? 21 : 18} />}{editable && <span className="social-group-avatar-change" aria-hidden="true"><ArrowRightLeft size={size === "hero" ? 27 : 20} strokeWidth={2.4} /></span>}</>;
  if (!editable) return <span className={`social-group-avatar ${size}`}>{contents}</span>;
  return <><button className={`social-group-avatar social-group-avatar-picker ${size}`} onClick={() => input.current?.click()} aria-label="Change group icon" title="Change group icon">{contents}</button><input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; if (file) onPick?.(file); event.currentTarget.value = ""; }} /></>;
}

function GroupRow({ group, active, message, onClick }: { group: Group; active: boolean; message?: Message; onClick: () => void }) {
  return <button className={`social-group-row ${active ? "active" : ""}`} onClick={onClick}>
    <GroupAvatar group={group} />
    <span><b>{group.name}</b><small>{message?.text || `${group.members.length} members`}</small></span>
    {message && <time>{formatTime(message.createdAt)}</time>}
  </button>;
}

function GroupConversationView({ me, group, messages, busy, onMembers, onRename, onIcon, onSend, onEdit, onReact, onPin }: { me: SocialUser; group: Group; messages: Message[]; busy: boolean; onMembers: () => void; onRename: (name: string) => void; onIcon: (file: File) => void; onSend: (text: string, replyTo?: string) => void; onEdit: (messageId: string, text: string) => void; onReact: (messageId: string, emoji: string, add: boolean) => void; onPin: (messageId: string, pinned: boolean) => void }) {
  const [draft, setDraft] = useState("");
  const [nameDraft, setNameDraft] = useState(group.name);
  const [editingName, setEditingName] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [contextMenu, setContextMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const visible = messages.filter(message => message.groupId === group.id && message.kind === "message");
  const pinnedMessages = visible.filter(message => message.pinned);
  const member = (id: string) => group.members.find(user => user.id === id) || me;
  const reactions = useMemo(() => summarizeReactions(messages.filter(message => message.groupId === group.id && message.kind === "reaction"), me.id), [group.id, me.id, messages]);
  useEffect(() => {
    const close = () => setContextMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); window.removeEventListener("blur", close); };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [group.id, messages.length]);
  useEffect(() => { setNameDraft(group.name); setEditingName(false); setReplyTo(null); setEditing(null); setDraft(""); setContextMenu(null); }, [group.id, group.name]);
  const submit = () => { const value = draft.trim(); if (!value || busy) return; if (editing) onEdit(editing.id, value); else onSend(value, replyTo?.id); setDraft(""); setReplyTo(null); setEditing(null); setEmojiOpen(false); };
  const commitName = () => { const value = nameDraft.trim(); setEditingName(false); if (value.length >= 2 && value !== group.name) onRename(value); else setNameDraft(group.name); };
  return <section className="social-conversation social-group-conversation">
    <header><div><GroupAvatar group={group} size="large" editable onPick={onIcon} /><span>{editingName ? <input className="social-group-title-input" value={nameDraft} maxLength={48} autoFocus onChange={event => setNameDraft(event.target.value)} onBlur={commitName} onKeyDown={event => { if (event.key === "Enter") commitName(); if (event.key === "Escape") { setNameDraft(group.name); setEditingName(false); } }} /> : <b className="social-group-title" onDoubleClick={() => setEditingName(true)} title="Double-click to rename">{group.name}</b>}<small>{group.members.length} members</small></span></div><div className="social-header-actions"><button className={`social-pins-button ${pinsOpen ? "active" : ""}`} onClick={() => setPinsOpen(value => !value)} aria-label="Pinned messages" title="Pinned messages"><Pin size={17} fill={pinnedMessages.length ? "currentColor" : "none"} /></button><button className="social-encryption social-members-button" onClick={onMembers}><UsersRound size={17} /> Members</button></div></header>
    <div className="social-message-list" onScroll={() => setContextMenu(null)}>
      {!visible.length && <div className="social-conversation-empty"><GroupAvatar group={group} size="hero" /><h3>{group.name}</h3><p>Messages are encrypted separately for every member device.</p></div>}
      {visible.map(message => { const mine = message.senderId === me.id; const author = member(message.senderId); const replied = message.reactionOperation === "reply" && message.targetId ? visible.find(value => value.id === message.targetId) : null; return <article key={message.id} className={`social-message ${mine ? "mine" : "theirs"} ${message.deliveryState}`} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setContextMenu({ messageId: message.id, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 250) }); }}>
        {!mine && <Avatar user={author} />}
        <div><span className="social-message-author"><b>{mine ? "You" : userLabel(author)}</b><time>{formatTime(message.createdAt)}</time>{message.editedAt && <small>edited</small>}</span>{replied && <div className="social-message-reply"><Reply size={13} /><span><b>{replied.senderId === me.id ? "You" : userLabel(member(replied.senderId))}</b>{replied.text || "Screenshot"}</span></div>}{message.text && <p>{message.text}</p>}{reactions.get(message.id)?.length ? <span className="social-reaction-row">{reactions.get(message.id)?.map(reaction => <button key={reaction.emoji} className={`${reaction.pending ? "pending" : ""} ${reaction.reactedByMe ? "mine" : ""}`} disabled={reaction.pending} aria-busy={reaction.pending} onClick={() => onReact(message.id, reaction.emoji, !reaction.reactedByMe)}><span>{reaction.emoji}</span><b>{reaction.count}</b></button>)}</span> : null}</div>
      </article>; })}
      <div ref={endRef} />
    </div>
    <div className="social-composer social-group-composer">
      <div className="social-compose-stack">{(replyTo || editing) && <div className="social-compose-reference"><span>{editing ? <Pencil size={14} /> : <Reply size={14} />}<b>{editing ? "Editing message" : `Replying to ${replyTo?.senderId === me.id ? "yourself" : userLabel(member(replyTo?.senderId || ""))}`}</b><small>{editing?.text || replyTo?.text || "Screenshot"}</small></span><button onClick={() => { setReplyTo(null); setEditing(null); if (editing) setDraft(""); }} aria-label="Cancel"><X size={15} /></button></div>}<div className="social-compose-field"><textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, 2000))} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} rows={1} placeholder={editing ? "Edit message" : `Message ${group.name}`} /><button onClick={() => setEmojiOpen(value => !value)} aria-label="Add emoji"><Smile size={19} /></button>{emojiOpen && <div className="social-emoji-picker">{reactionChoices.map(emoji => <button key={emoji} onClick={() => { setDraft(value => `${value}${emoji}`); setEmojiOpen(false); }}>{emoji}</button>)}</div>}</div></div>
      <button className="social-send" onClick={submit} disabled={busy || !draft.trim()} aria-label="Send message"><Send size={20} fill="currentColor" /></button>
    </div>
    {pinsOpen && <PinnedMessagesDrawer messages={pinnedMessages} me={me} authorFor={message => member(message.senderId)} busy={busy} onClose={() => setPinsOpen(false)} onUnpin={messageId => onPin(messageId, false)} />}
    {contextMenu && (() => { const message = visible.find(value => value.id === contextMenu.messageId); return message ? <MessageContextMenu message={message} reactions={reactions.get(message.id) || []} x={contextMenu.x} y={contextMenu.y} mine={message.senderId === me.id} disabled={busy} onClose={() => setContextMenu(null)} onReply={() => { setReplyTo(message); setEditing(null); setDraft(""); }} onEdit={() => { setEditing(message); setReplyTo(null); setDraft(message.text || ""); }} onReact={(emoji, add) => onReact(message.id, emoji, add)} onPin={() => onPin(message.id, !message.pinned)} /> : null; })()}
  </section>;
}

function GroupDrawer({ group, friends, me, busy, onClose, onCreate, onAdd, onRemove, onOpenFriend }: { group: Group | null; friends: SocialUser[]; me: SocialUser; busy: boolean; onClose: () => void; onCreate: (name: string, ids: string[]) => Promise<boolean>; onAdd: (id: string) => void; onRemove: (id: string) => void; onOpenFriend: (user: SocialUser) => void }) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const candidates = group ? friends.filter(friend => !group.members.some(member => member.id === friend.id)) : friends;
  if (!group) return <aside className="social-group-drawer">
    <header><div><b>New group chat</b><span>Up to 10 people</span></div><button onClick={onClose} aria-label="Close"><X size={19} /></button></header>
    <label className="social-group-name"><span>Group name</span><input value={name} onChange={event => setName(event.target.value.slice(0, 48))} placeholder="Group name" autoFocus /></label>
    <div className="social-drawer-list">{candidates.map(friend => <button key={friend.id} className={`social-drawer-person ${selected.includes(friend.id) ? "selected" : ""}`} onClick={() => setSelected(current => current.includes(friend.id) ? current.filter(id => id !== friend.id) : current.length < 9 ? [...current, friend.id] : current)}><Avatar user={friend} /><span><b>{userLabel(friend)}</b><small>@{friend.username}</small></span><i>{selected.includes(friend.id) && <Check size={15} />}</i></button>)}</div>
    <button className="social-drawer-primary" disabled={busy || name.trim().length < 2 || !selected.length} onClick={() => void onCreate(name.trim(), selected).then(ok => { if (ok) onClose(); })}><UsersRound size={18} /> Create group</button>
  </aside>;
  return <aside className="social-group-drawer">
    <header><div><b>{group.name}</b><span>{group.members.length} of 10 people</span></div><button onClick={onClose} aria-label="Close"><X size={19} /></button></header>
    <button className="social-group-add-toggle" disabled={group.members.length >= 10} onClick={() => setAdding(value => !value)}><UserRoundPlus size={18} /><span>Add people</span><Plus size={16} /></button>
    {adding && <div className="social-group-candidates">{candidates.length ? candidates.map(friend => <button key={friend.id} disabled={busy} onClick={() => onAdd(friend.id)}><Avatar user={friend} /><span>{userLabel(friend)}</span><Plus size={16} /></button>) : <p>No more friends are available to add.</p>}</div>}
    <div className="social-drawer-list social-member-list">{group.members.map(member => <div key={member.id} className="social-drawer-person"><Avatar user={member} /><span><b>{userLabel(member)}</b><small>{member.id === group.ownerId ? "Owner" : member.id === me.id ? "You" : `@${member.username}`}</small></span><button className="social-member-menu-trigger" onClick={() => setMenuFor(value => value === member.id ? null : member.id)} aria-label={`Actions for ${userLabel(member)}`}><MoreHorizontal size={18} /></button>{menuFor === member.id && <div className="social-member-menu"><button onClick={() => { if (member.username) void navigator.clipboard.writeText(member.username); setMenuFor(null); }}>Copy username</button>{friends.some(friend => friend.id === member.id) && member.id !== me.id && <button onClick={() => onOpenFriend(member)}>Open direct message</button>}{group.canManage && member.id !== group.ownerId && <button className="danger" onClick={() => onRemove(member.id)}>Remove from group</button>}{member.id === me.id && !group.canManage && <button className="danger" onClick={() => onRemove(member.id)}>Leave group</button>}</div>}</div>)}</div>
  </aside>;
}

export function SocialPage({ onNotify, onInstanceImported }: { onNotify: (message: string, kind?: "error" | "notification") => void; onInstanceImported: (result: ModpackShareImport) => void }) {
  const [session, setSession] = useState<SessionState>(emptySession);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [section, setSection] = useState<SocialSection>("messages");
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [directOpen, setDirectOpen] = useState(true);
  const [groupDrawer, setGroupDrawer] = useState<"create" | "members" | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [encryptionOpen, setEncryptionOpen] = useState(false);
  const [encryptionLoading, setEncryptionLoading] = useState(false);
  const [encryptionDetails, setEncryptionDetails] = useState<EncryptionDetails | null>(null);
  const selectedFriendIdRef = useRef<string | null>(null);
  const encryptionSequence = useRef(0);
  const lastSyncWarning = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const hydrationSequence = useRef(0);
  const mutationVersion = useRef(0);
  const mutationInFlight = useRef(0);
  const outboundQueue = useRef<Promise<void>>(Promise.resolve());
  const selectedFriend = snapshot.friends.find(friend => friend.id === selectedFriendId) || snapshot.friends[0] || null;
  const selectedGroup = snapshot.groups.find(group => group.id === selectedGroupId) || null;

  const load = async (quiet = false, replace = false) => {
    const requestNumber = ++loadSequence.current;
    const versionAtStart = mutationVersion.current;
    try {
      const state = await invoke<SessionState>("social_session_state");
      if (requestNumber !== loadSequence.current || mutationInFlight.current > 0 || versionAtStart !== mutationVersion.current) return false;
      if (state.signedIn && !state.needsUsername) {
        const next = await invoke<Snapshot>("social_snapshot");
        if (requestNumber !== loadSequence.current || mutationInFlight.current > 0 || versionAtStart !== mutationVersion.current) return false;
        setSnapshot(current => {
          if (replace) return next;
          return { ...next, messages: reconcileSocialMessages(current.messages, next.messages) };
        });
        setSession(next.session);
        if (next.syncWarning && next.syncWarning !== lastSyncWarning.current) onNotify(next.syncWarning, "error");
        lastSyncWarning.current = next.syncWarning;
        setSelectedFriendId(current => current ?? next.friends[0]?.id ?? null);
      } else {
        setSession(state);
        if (!state.signedIn) setSnapshot(emptySnapshot);
      }
      // Dismiss Loading Social only after the authoritative state for this
      // account has been applied. Stale or superseded requests never reveal a
      // partially hydrated Social page.
      if (requestNumber === loadSequence.current) setLoading(false);
      return true;
    } catch (error) {
      if (!quiet) onNotify(String(error), "error");
      return false;
    }
  };
  const hydrate = async (replace = false) => {
    const hydration = ++hydrationSequence.current;
    let attempts = 0;
    while (hydration === hydrationSequence.current) {
      if (await load(attempts > 0, replace)) return true;
      attempts += 1;
      const delay = Math.min(30_000, 2_000 * (2 ** Math.min(attempts - 1, 4)));
      await new Promise(resolve => window.setTimeout(resolve, delay));
    }
    return false;
  };
  useEffect(() => {
    void hydrate();
    return () => { hydrationSequence.current += 1; };
  }, []);

  const syncMessages = async () => {
    const requestNumber = ++loadSequence.current;
    const versionAtStart = mutationVersion.current;
    try {
      const next = await invoke<SocialMessageSync>("social_sync_messages");
      if (requestNumber !== loadSequence.current || versionAtStart !== mutationVersion.current) return;
      setSnapshot(current => ({ ...current, messages: reconcileSocialMessages(current.messages, next.messages), syncWarning: next.syncWarning }));
      if (next.syncWarning && next.syncWarning !== lastSyncWarning.current) onNotify(next.syncWarning, "error");
      lastSyncWarning.current = next.syncWarning;
    } catch (error) {
      if (requestNumber === loadSequence.current) throw error;
    }
  };

  const refreshEncryption = async (friendId: string, open = false) => {
    const requestNumber = ++encryptionSequence.current;
    if (open) setEncryptionOpen(true);
    setEncryptionLoading(true);
    try {
      const details = await invoke<EncryptionDetails>("social_encryption_details", { friendId });
      if (requestNumber === encryptionSequence.current) setEncryptionDetails(details);
      return details;
    } catch (error) {
      if (open && requestNumber === encryptionSequence.current) onNotify(String(error), "error");
      return null;
    } finally { if (requestNumber === encryptionSequence.current) setEncryptionLoading(false); }
  };
  useEffect(() => {
    selectedFriendIdRef.current = selectedFriendId;
    setEncryptionOpen(false);
    setEncryptionDetails(null);
    if (selectedFriendId && session.signedIn) void refreshEncryption(selectedFriendId);
  }, [selectedFriendId, session.signedIn]);

  useEffect(() => {
    if (!session.signedIn || session.needsUsername || !session.user?.id) return;
    let cancelled = false;
    let cursor: string | null = null;
    let failures = 0;
    let lastFullReconcile = 0;
    let retryTimer: number | null = null;
    const pause = (milliseconds: number) => new Promise<void>(resolve => {
      retryTimer = window.setTimeout(resolve, milliseconds);
    });
    const watch = async () => {
      while (!cancelled) {
        try {
          const change = await invoke<SocialChange>("social_wait_for_updates", { cursor });
          if (cancelled) return;
          const firstCursor = cursor === null;
          cursor = change.cursor;
          failures = 0;
          if (firstCursor) {
            // Close the small startup window between the initial snapshot and
            // registering the durable change cursor.
            await load(true);
            lastFullReconcile = Date.now();
          } else if (change.changed) {
            const scopes = new Set(change.scopes);
            if (scopes.size === 1 && scopes.has("messages")) await syncMessages();
            else {
              await load(true);
              if (scopes.has("identity") && selectedFriendIdRef.current) void refreshEncryption(selectedFriendIdRef.current);
            }
          }
          if (!cancelled && Date.now() - lastFullReconcile >= 5 * 60_000) {
            await load(true);
            lastFullReconcile = Date.now();
          }
        } catch {
          if (cancelled) return;
          failures += 1;
          const delay = Math.min(30_000, 2_000 * (2 ** Math.min(failures - 1, 4)));
          await pause(delay);
          if (!cancelled) {
            await load(true);
            lastFullReconcile = Date.now();
          }
        }
      }
    };
    void watch();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [session.signedIn, session.needsUsername, session.user?.id]);

  const acknowledgeEncryption = async (friendId: string, verified: boolean) => {
    setBusy(true);
    try {
      const details = await invoke<EncryptionDetails>("social_acknowledge_identity", { friendId, verified });
      setEncryptionDetails(details);
    } catch (error) { onNotify(String(error), "error"); }
    finally { setBusy(false); }
  };

  const beginMutation = () => {
    mutationInFlight.current += 1;
    mutationVersion.current += 1;
  };
  const finishMutation = () => {
    mutationInFlight.current = Math.max(0, mutationInFlight.current - 1);
    mutationVersion.current += 1;
    if (mutationInFlight.current === 0) void load(true);
  };
  const enqueueOutbound = <T,>(task: () => Promise<T>) => {
    const result = outboundQueue.current.then(task, task);
    outboundQueue.current = result.then(() => undefined, () => undefined);
    return result;
  };

  const action = async (task: () => Promise<Snapshot>, success?: string) => {
    setBusy(true);
    try { const next = await task(); setSnapshot(next); setSession(next.session); if (success) onNotify(success); return true; }
    catch (error) { onNotify(String(error), "error"); return false; }
    finally { setBusy(false); }
  };
  const createGroup = async (name: string, memberIds: string[]) => {
    const previous = new Set(snapshot.groups.map(group => group.id));
    setBusy(true);
    try {
      const next = await invoke<Snapshot>("social_create_group", { name, memberIds });
      const created = next.groups.find(group => !previous.has(group.id)) || next.groups[0];
      setSnapshot(next);
      setSession(next.session);
      setGroupsOpen(true);
      if (created) { setSelectedGroupId(created.id); setSelectedFriendId(null); setSection("messages"); }
      onNotify("Group chat created.");
      return true;
    } catch (error) { onNotify(String(error), "error"); return false; }
    finally { setBusy(false); }
  };
  const beginSignIn = async () => {
    setBusy(true);
    try {
      const start = await invoke<{ authorizationUrl: string }>("social_prepare_sign_in");
      await openUrl(start.authorizationUrl);
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 650));
        const result = await invoke<SessionState | null>("social_poll_sign_in");
        if (result) {
          setLoading(true);
          setSnapshot(emptySnapshot);
          setSelectedFriendId(null);
          setSelectedGroupId(null);
          setGroupDrawer(null);
          setEncryptionOpen(false);
          setEncryptionDetails(null);
          lastSyncWarning.current = null;
          onNotify("Bloom account connected.");
          await hydrate(true);
          return;
        }
      }
      throw new Error("Sign-in timed out. Try again when you are ready.");
    } catch (error) { onNotify(String(error), "error"); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    hydrationSequence.current += 1;
    setAccountMenuOpen(false);
    setBusy(true);
    setLoading(true);
    try {
      await Promise.all([
        invoke("social_sign_out"),
        new Promise(resolve => window.setTimeout(resolve, 320)),
      ]);
      setSession(emptySession);
      setSnapshot(emptySnapshot);
      setSelectedFriendId(null);
      setSelectedGroupId(null);
      setGroupDrawer(null);
      setGroupsOpen(false);
      setEncryptionOpen(false);
      setEncryptionDetails(null);
      lastSyncWarning.current = null;
      onNotify("Signed out of Bloom Social.");
    } catch (error) { onNotify(String(error), "error"); }
    finally { setBusy(false); setLoading(false); }
  };
  if (loading) return <div className="social-loading"><RefreshCw className="spin" size={22} /> Loading Social…</div>;
  if (!session.signedIn) return <SignInView busy={busy} onSignIn={() => void beginSignIn()} />;
  if (session.needsUsername) return <UsernameSetup busy={busy} onSave={username => { setBusy(true); void invoke<SocialUser>("social_set_username", { username }).then(() => { setLoading(true); onNotify("Bloom account username saved."); return hydrate(true); }).catch(error => { setLoading(false); onNotify(String(error), "error"); }).finally(() => setBusy(false)); }} />;
  if (!session.user) return <SignInView busy={busy} onSignIn={() => void beginSignIn()} />;

  const lastFor = (friendId: string) => snapshot.messages.filter(message => !message.groupId && message.friendId === friendId && message.kind === "message").at(-1);
  const lastInviteFor = (friendId: string) => snapshot.invites
    .filter(invite => (invite.sender.id === session.user?.id && invite.recipient.id === friendId) || (invite.recipient.id === session.user?.id && invite.sender.id === friendId))
    .reduce<InstanceInvite | undefined>((latest, invite) => !latest || invite.createdAt > latest.createdAt ? invite : latest, undefined);
  const lastForGroup = (groupId: string) => snapshot.messages.filter(message => message.groupId === groupId && message.kind === "message").at(-1);
  const openFriend = (friend: SocialUser) => { setSelectedFriendId(friend.id); setSelectedGroupId(null); setGroupDrawer(null); setSection("messages"); };
  const openGroup = (group: Group) => { setSelectedGroupId(group.id); setSelectedFriendId(null); setGroupDrawer(null); setSection("messages"); };
  const sendScreenshot = async (friendId: string) => {
    beginMutation();
    setBusy(true);
    try {
      const message = await invoke<Message | null>("social_send_screenshot", { friendId });
      if (message) { setSnapshot(current => ({ ...current, messages: reconcileSocialMessages(current.messages, [...current.messages, message]) })); onNotify("Encrypted screenshot sent."); }
    } catch (error) { if (String(error).includes("encryption identity changed")) void refreshEncryption(friendId, true); onNotify(String(error), "error"); }
    finally { setBusy(false); finishMutation(); }
  };
  const sendMessage = async (friendId: string, body: string, replyTo?: string) => {
    if (!session.user) return;
    const temporaryId = `pending-${crypto.randomUUID()}`;
    const pending: Message = {
      id: temporaryId,
      conversationId: snapshot.conversations.find(conversation => conversation.friend.id === friendId)?.id || "",
      friendId,
      groupId: null,
      senderId: session.user.id,
      kind: "message",
      text: body,
      targetId: replyTo || null,
      emoji: null,
      reactionOperation: replyTo ? "reply" : null,
      imageDataUrl: null,
      pinned: false,
      editedAt: null,
      createdAt: Date.now(),
      deliveryState: "pending",
    };
    beginMutation();
    setSnapshot(current => ({ ...current, messages: [...current.messages, pending] }));
    try {
      const sent = await enqueueOutbound(() => invoke<Message>("social_send_message", { friendId, text: body, replyTo: replyTo || null }));
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === temporaryId ? sent : message) }));
    } catch (error) {
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === temporaryId ? { ...message, deliveryState: "failed" } : message) }));
      if (String(error).includes("encryption identity changed")) void refreshEncryption(friendId, true);
      onNotify(String(error), "error");
    } finally { finishMutation(); }
  };
  const editMessage = async (friendId: string, messageId: string, body: string) => {
    const previous = snapshot.messages.find(message => message.id === messageId);
    beginMutation();
    setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === messageId ? { ...message, text: body, editedAt: Date.now() } : message) }));
    try {
      const updated = await enqueueOutbound(() => invoke<Message>("social_edit_message", { friendId, messageId, text: body }));
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === updated.id ? updated : message) }));
    } catch (error) {
      if (previous) setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === messageId ? previous! : message) }));
      if (String(error).includes("encryption identity changed")) void refreshEncryption(friendId, true);
      onNotify(String(error), "error");
    } finally { finishMutation(); }
  };
  const sendReaction = async (friendId: string, messageId: string, emoji: string, add: boolean) => {
    if (!session.user) return;
    const temporaryId = `pending-reaction-${crypto.randomUUID()}`;
    const pending: Message = { id: temporaryId, conversationId: snapshot.conversations.find(conversation => conversation.friend.id === friendId)?.id || "", friendId, groupId: null, senderId: session.user.id, kind: "reaction", text: null, targetId: messageId, emoji, reactionOperation: add ? "add" : "remove", imageDataUrl: null, pinned: false, editedAt: null, createdAt: Date.now(), deliveryState: "pending" };
    beginMutation();
    setSnapshot(current => ({ ...current, messages: [...current.messages, pending] }));
    try {
      const reaction = await enqueueOutbound(() => invoke<Message>("social_react", { friendId, messageId, emoji, add }));
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === temporaryId ? reaction : message) }));
    } catch (error) {
      setSnapshot(current => ({ ...current, messages: current.messages.filter(message => message.id !== temporaryId) }));
      if (String(error).includes("encryption identity changed")) void refreshEncryption(friendId, true);
      onNotify(String(error), "error");
    } finally {
      finishMutation();
    }
  };
  const pinMessage = async (friendId: string, messageId: string, pinned: boolean) => {
    beginMutation();
    setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === messageId ? { ...message, pinned } : message) }));
    setBusy(true);
    try {
      const updated = await enqueueOutbound(() => invoke<Message>("social_pin_message", { friendId, messageId, pinned }));
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === updated.id ? updated : message) }));
    } catch (error) {
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === messageId ? { ...message, pinned: !pinned } : message) }));
      if (String(error).includes("encryption identity changed")) void refreshEncryption(friendId, true);
      onNotify(String(error), "error");
    } finally {
      setBusy(false);
      finishMutation();
    }
  };
  const sendGroupMessage = async (groupId: string, body: string, replyTo?: string) => {
    if (!session.user) return;
    const temporaryId = `pending-${crypto.randomUUID()}`;
    const pending: Message = { id: temporaryId, conversationId: groupId, friendId: "", groupId, senderId: session.user.id, kind: "message", text: body, targetId: replyTo || null, emoji: null, reactionOperation: replyTo ? "reply" : null, imageDataUrl: null, pinned: false, editedAt: null, createdAt: Date.now(), deliveryState: "pending" };
    beginMutation();
    setSnapshot(current => ({ ...current, messages: [...current.messages, pending] }));
    try {
      const sent = await enqueueOutbound(() => invoke<Message>("social_send_group_message", { groupId, text: body, replyTo: replyTo || null }));
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === temporaryId ? sent : message) }));
    } catch (error) {
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === temporaryId ? { ...message, deliveryState: "failed" } : message) }));
      onNotify(String(error), "error");
    } finally { finishMutation(); }
  };
  const editGroupMessage = async (groupId: string, messageId: string, body: string) => {
    const previous = snapshot.messages.find(message => message.id === messageId);
    beginMutation();
    setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === messageId ? { ...message, text: body, editedAt: Date.now() } : message) }));
    try {
      const updated = await enqueueOutbound(() => invoke<Message>("social_edit_group_message", { groupId, messageId, text: body }));
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === updated.id ? updated : message) }));
    } catch (error) { if (previous) setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === messageId ? previous! : message) })); onNotify(String(error), "error"); }
    finally { finishMutation(); }
  };
  const sendGroupReaction = async (groupId: string, messageId: string, emoji: string, add: boolean) => {
    if (!session.user) return;
    const temporaryId = `pending-group-reaction-${crypto.randomUUID()}`;
    const pending: Message = { id: temporaryId, conversationId: groupId, friendId: "", groupId, senderId: session.user.id, kind: "reaction", text: null, targetId: messageId, emoji, reactionOperation: add ? "add" : "remove", imageDataUrl: null, pinned: false, editedAt: null, createdAt: Date.now(), deliveryState: "pending" };
    beginMutation();
    setSnapshot(current => ({ ...current, messages: [...current.messages, pending] }));
    try {
      const reaction = await enqueueOutbound(() => invoke<Message>("social_react_group", { groupId, messageId, emoji, add }));
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === temporaryId ? reaction : message) }));
    } catch (error) {
      setSnapshot(current => ({ ...current, messages: current.messages.filter(message => message.id !== temporaryId) }));
      onNotify(String(error), "error");
    } finally {
      finishMutation();
    }
  };
  const pinGroupMessage = async (groupId: string, messageId: string, pinned: boolean) => {
    beginMutation();
    setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === messageId ? { ...message, pinned } : message) }));
    setBusy(true);
    try {
      const updated = await enqueueOutbound(() => invoke<Message>("social_pin_group_message", { groupId, messageId, pinned }));
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === updated.id ? updated : message) }));
    } catch (error) {
      setSnapshot(current => ({ ...current, messages: current.messages.map(message => message.id === messageId ? { ...message, pinned: !pinned } : message) }));
      onNotify(String(error), "error");
    } finally {
      setBusy(false);
      finishMutation();
    }
  };
  const updateGroupName = (groupId: string, name: string) => void action(() => invoke("social_update_group", { groupId, name, iconDataUrl: null }), "Group name updated.");
  const updateGroupIcon = async (groupId: string, file: File) => {
    try {
      const iconDataUrl = await groupIconData(file);
      await action(() => invoke("social_update_group", { groupId, name: null, iconDataUrl }), "Group icon updated.");
    } catch (error) { onNotify(String(error), "error"); }
  };
  const acceptInstanceInvite = async (invite: InstanceInvite) => {
    setBusy(true);
    let claim: InstanceInviteClaim | null = null;
    try {
      claim = await invoke<InstanceInviteClaim>("social_claim_instance_invite", { inviteId: invite.id });
      const command = claim.shareMode === "copy" ? "import_modpack_share" : claim.role === "editor" ? "join_pack_as_editor" : "import_pack_channel";
      const result = await invoke<ModpackShareImport>(command, { code: claim.shareCode });
      const next = await invoke<Snapshot>("social_complete_instance_invite", { inviteId: invite.id, claimToken: claim.claimToken });
      setSnapshot(next);
      setSession(next.session);
      onNotify(`${invite.instanceName} was added to your library.`);
      onInstanceImported(result);
    } catch (error) {
      if (claim) await invoke("social_release_instance_invite", { inviteId: invite.id, claimToken: claim.claimToken }).catch(() => undefined);
      onNotify(String(error), "error");
    } finally { setBusy(false); }
  };
  const declineInstanceInvite = (inviteId: string) => void action(() => invoke("social_decline_instance_invite", { inviteId }), "Invite declined.");
  const revokeInstanceInvite = (inviteId: string) => void action(() => invoke("social_revoke_instance_invite", { inviteId }), "Invite revoked.");
  return <div className="social-page" onClick={() => setAccountMenuOpen(false)}>
    <aside className="social-rail">
      <header><h1>Social</h1></header>
      <nav aria-label="Social views">
        <button className={section === "messages" ? "active" : ""} onClick={() => setSection("messages")}><MessageCircle size={18} /><span>Messages</span></button>
        <button className={section === "friends" ? "active" : ""} onClick={() => setSection("friends")}><UsersRound size={18} /><span>Friends</span><b>{snapshot.friends.length}</b></button>
        <button className={section === "inbox" ? "active" : ""} onClick={() => setSection("inbox")}><Inbox size={18} /><span>Inbox</span>{snapshot.requests.incoming.length > 0 && <b className="unread">{snapshot.requests.incoming.length}</b>}</button>
      </nav>
      <div className="social-rail-lists">
        <section className={`social-rail-section ${groupsOpen ? "open" : "closed"}`}>
          <div className="social-rail-heading"><button className="social-rail-collapse" onClick={() => setGroupsOpen(value => !value)}><ChevronDown size={15} /><span>GROUP CHATS</span></button><button onClick={() => setGroupDrawer("create")} aria-label="Create group chat"><Plus size={17} /></button></div>
          {groupsOpen && <div className="social-conversation-list">{snapshot.groups.map(group => <GroupRow key={group.id} group={group} active={section === "messages" && selectedGroup?.id === group.id} message={lastForGroup(group.id)} onClick={() => openGroup(group)} />)}</div>}
        </section>
        <section className={`social-rail-section ${directOpen ? "open" : "closed"}`}>
          <div className="social-rail-heading"><button className="social-rail-collapse" onClick={() => setDirectOpen(value => !value)}><ChevronDown size={15} /><span>DIRECT MESSAGES</span></button><button onClick={() => setSection("friends")} aria-label="Add friend"><Plus size={17} /></button></div>
          {directOpen && <div className="social-conversation-list">{snapshot.friends.map(friend => { const message = lastFor(friend.id); const invite = lastInviteFor(friend.id); const inviteIsLatest = invite && (!message || invite.createdAt > message.createdAt); const incoming = invite?.recipient.id === session.user?.id; return <FriendRow key={friend.id} user={friend} active={section === "messages" && selectedFriend?.id === friend.id && !selectedGroup} preview={inviteIsLatest ? (incoming ? `Invited you to play ${invite.instanceName}` : `Invite sent: ${invite.instanceName}`) : message ? (message.text || "Image") : "Start a conversation"} time={inviteIsLatest ? invite.createdAt : message?.createdAt} onClick={() => openFriend(friend)} />; })}</div>}
        </section>
      </div>
      <div className="social-account" onClick={event => event.stopPropagation()}>
        {accountMenuOpen && <div className="social-account-menu" role="menu" aria-label="Social account menu">
          <button className="danger" role="menuitem" disabled={busy} onClick={() => void signOut()}><LogOut size={17} /><span>Sign out</span></button>
        </div>}
        <button className="social-account-trigger" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(open => !open)}>
          <Avatar user={session.user} /><span><b>{userLabel(session.user)}</b><small>@{session.user.username}</small></span><ChevronUp className={accountMenuOpen ? "open" : ""} size={17} />
        </button>
      </div>
    </aside>
    <div className="social-main">
      {section === "friends" ? <FriendsView snapshot={snapshot} busy={busy} onAdd={name => action(() => invoke("social_send_friend_request", { username: name }), "Friend request sent.")} onOpen={openFriend} onRemove={id => void action(() => invoke("social_remove_friend", { userId: id }), "Friend removed.")} /> : section === "inbox" ? <InboxView snapshot={snapshot} busy={busy} onAcceptFriend={id => void action(() => invoke("social_accept_friend_request", { userId: id }), "Friend request accepted.")} onDeclineFriend={id => void action(() => invoke("social_decline_friend_request", { userId: id }))} /> : selectedGroup ? <GroupConversationView me={session.user} group={selectedGroup} messages={snapshot.messages} busy={busy} onMembers={() => setGroupDrawer("members")} onRename={name => updateGroupName(selectedGroup.id, name)} onIcon={file => void updateGroupIcon(selectedGroup.id, file)} onSend={(text, replyTo) => void sendGroupMessage(selectedGroup.id, text, replyTo)} onEdit={(messageId, text) => void editGroupMessage(selectedGroup.id, messageId, text)} onReact={(messageId, emoji, add) => void sendGroupReaction(selectedGroup.id, messageId, emoji, add)} onPin={(messageId, pinned) => void pinGroupMessage(selectedGroup.id, messageId, pinned)} /> : selectedFriend ? <ConversationView me={session.user} friend={selectedFriend} messages={snapshot.messages} invites={snapshot.invites} busy={busy} encryption={encryptionDetails?.friendId === selectedFriend.id ? encryptionDetails : null} onOpenEncryption={() => void refreshEncryption(selectedFriend.id, true)} onSend={(text, replyTo) => void sendMessage(selectedFriend.id, text, replyTo)} onEdit={(messageId, text) => void editMessage(selectedFriend.id, messageId, text)} onScreenshot={() => void sendScreenshot(selectedFriend.id)} onReact={(messageId, emoji, add) => void sendReaction(selectedFriend.id, messageId, emoji, add)} onPin={(messageId, pinned) => void pinMessage(selectedFriend.id, messageId, pinned)} onAcceptInvite={invite => void acceptInstanceInvite(invite)} onDeclineInvite={declineInstanceInvite} onRevokeInvite={revokeInstanceInvite} /> : <section className="social-no-conversation"><MessageCircle size={34} /><h2>No conversations yet</h2><p>Create a group chat or add a friend by their exact Bloom account username.</p><button onClick={() => setSection("friends")}><UserPlus size={18} /> Add a friend</button></section>}
      {groupDrawer && <GroupDrawer group={groupDrawer === "members" ? selectedGroup : null} friends={snapshot.friends} me={session.user} busy={busy} onClose={() => setGroupDrawer(null)} onCreate={createGroup} onAdd={userId => void action(() => invoke("social_add_group_member", { groupId: selectedGroup?.id, userId }), "Person added to the group.")} onRemove={userId => void action(() => invoke("social_remove_group_member", { groupId: selectedGroup?.id, userId }), userId === session.user?.id ? "You left the group." : "Person removed from the group.")} onOpenFriend={openFriend} />}
      {encryptionOpen && selectedFriend && <EncryptionDrawer friend={selectedFriend} details={encryptionDetails?.friendId === selectedFriend.id ? encryptionDetails : null} loading={encryptionLoading} busy={busy} onClose={() => setEncryptionOpen(false)} onVerify={() => void acknowledgeEncryption(selectedFriend.id, true)} onContinue={() => void acknowledgeEncryption(selectedFriend.id, false)} />}
    </div>
  </div>;
}
