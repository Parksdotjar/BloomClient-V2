import { publishPartySnapshot } from "../services/use-party-invite-island";
import { useEffect, useRef, useState } from "react";
import { CheckIcon as Check, PlusIcon as Plus, UsersIcon as UsersRound, XIcon as X } from "@phosphor-icons/react";
import { invoke } from "../services/invoke";
import { Avatar, type SocialUser } from "./SocialPage";
import "./social-play.css";

type Member = { id: string; name: string; server?: string };
type Party = { id: string; host: string; members: Member[]; invited: string[] };
type State = { party?: Party; invites: Member[]; currentServer?: {server:string;visit:string} };
export type PlayLauncher = {
  instances: { id: string; name: string; version: string }[];
  onJoinServer: (instanceId: string, server: string) => void;
  launchBusy: boolean;
};
type Props = PlayLauncher & {
  me: SocialUser;
  friends: SocialUser[];
  onFriends: () => void;
};

export function SocialPlay({me, friends, instances, onFriends, onJoinServer, launchBusy}: Props) {
  const player = me.id;
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const revision = useRef(0);
  const [rowMenu, setRowMenu] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!rowMenu) return;
    const outside = (event: PointerEvent) => {
      if (!menuAnchor.current?.contains(event.target as Node)) setRowMenu(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [rowMenu]);
  const [sentFeedback,setSentFeedback] = useState("");
  const [inviting, setInviting] = useState(false);
  const inviteAnchor = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if (!inviting) return;
    function outside(e:PointerEvent) {
      if (!inviteAnchor.current?.contains(e.target as Node)) setInviting(false);
    }
    document.addEventListener("pointerdown",outside,true);
    return ()=>document.removeEventListener("pointerdown",outside,true);
  },[inviting]);
  const party = state?.party;
  const host = party?.host === player;
  const compatible = instances.filter(item => /^1\.(\d+)(?:\.\d+)?$/.test(item.version) && Number(item.version.split(".")[1]) >= 20 || /^\d{2,}\.\d+(?:\.\d+)?$/.test(item.version));
  useEffect(() => {
    let active = true;
    let loading = false;
    async function refresh() {
      if (document.hidden || writing.current || loading) return;
      loading = true;
      const current = revision.current;
      try {
        const next = await invoke<State>("social_party", {player});
        if (active && revision.current === current) { setState(next); publishPartySnapshot(player,next); setError(""); }
      } catch (e) { if (active && revision.current === current) setError(String(e)); }
      finally { loading = false; }
    }
    window.addEventListener("delight-party-changed", refresh);
    void refresh();
    const interval = window.setInterval(refresh, 12000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("delight-party-changed",refresh); clearInterval(interval); document.removeEventListener("visibilitychange",refresh); window.removeEventListener("focus",refresh); };
  }, [player]);
  useEffect(() => { setRowMenu(null); }, [party?.id,player]);
  useEffect(()=>{setInviting(false);},[party?.id]);
  async function change(action: string, fields: Record<string,string> = {}) {
    if (writing.current) return;
    writing.current = true;
    revision.current++;
    setBusy(true);
    try {
      const next = await invoke<State>("social_party", {player, change:{action, partyId:party?.id, ...fields}});
      setState(next); publishPartySnapshot(player,next); setError("");
      if (action === "invite" && next.party?.invited.includes(fields.friendId)) setSentFeedback(fields.friendId);
      setRowMenu(null);
    } catch (e) { setError(String(e)); }
    finally { writing.current = false; setBusy(false); }
  }

  return <section className="social-play"><div className="play-inner">
    {error && <p role="alert" className="play-error">{error}</p>}
    {state?.invites.map(invite => <div className="play-invite" key={invite.id}>
      <UsersRound size={16} aria-hidden="true"/>
      <span className="play-invite-message"><strong title={invite.name}>{invite.name}</strong><span> invited you to a party</span></span>
      <button className="play-accept" disabled={busy} aria-label={`Accept party invite from ${invite.name}`} title="Accept invitation" onClick={()=>void change("accept",{partyId:invite.id})}><Check size={17} weight="bold"/></button>
      <button className="play-decline" disabled={busy} aria-label={`Decline party invite from ${invite.name}`} title="Decline invitation" onClick={()=>void change("decline",{partyId:invite.id})}><X size={16} weight="bold"/></button>
    </div>)}
    <>
    <section className="party-card party-roster" aria-busy={!state && !error}>
      <header><UsersRound size={22}/><h2>Party roster</h2>{host && party && <div className="party-invite-anchor" ref={inviteAnchor} onKeyDown={e=>{
        if(e.key==="Escape" && inviting){e.stopPropagation();setInviting(false);inviteAnchor.current?.querySelector("button")?.focus();}
      }}>
        <button className="party-add" aria-label="Invite players" aria-haspopup="dialog" aria-expanded={inviting} disabled={party.members.length>=8} onClick={()=>{setSentFeedback("");setInviting(value=>!value);}}><Plus size={17}/></button>
        {inviting && <div className="party-invite-menu" role="dialog" aria-label="Invite players">
      {friends.map(friend=>{
        const name = friend.minecraftUsername || friend.displayName || friend.username;
        const status = party.members.some(member=>member.id===friend.id) ? "In party" : party.invited.includes(friend.id) ? "Invited" : "Invite";
        return <div className="party-invite-person" key={friend.id}><Avatar user={friend}/><span><strong>{name}</strong><small>{friend.online?"Online":"Offline"}</small></span>
          {status === "In party" ? <small>{status}</small> : <button
            className={`invite-action ${status === "Invited" ? "is-sent" : ""} ${sentFeedback === friend.id ? "just-sent" : ""}`}
            disabled={busy || status !== "Invite" || party.members.length >= 8}
            aria-label={status === "Invite" ? "Invite "+name : "Invited"} title={status === "Invite" ? "Invite "+name : "Invitation sent"}
            onAnimationEnd={()=>setSentFeedback(current=>current===friend.id?"":current)}
            onClick={()=>void change("invite",{friendId:friend.id})}>
            <Plus className="invite-plus" size={16}/><Check className="invite-check" size={17}/>
          </button>}
        </div>;
      })}
      {!friends.length && <div className="party-start"><p>No friends yet.</p><button onClick={onFriends}>Add a friend</button></div>}
        </div>}
      </div>}{party && <span className="party-count">{party.members.length} / 8</span>}</header>
      {party ? <ul className="party-members">{[...party.members].sort((a,b)=>Number(b.id===party.host)-Number(a.id===party.host)).map(member => {
        const profile = member.id === player ? me : friends.find(friend => friend.id === member.id);
        const mine = member.id === player;
        const leader = member.id === party.host;
        const expanded = rowMenu === member.id;
        function join(instanceId: string) {
          if (member.server && !launchBusy) { setRowMenu(null); onJoinServer(instanceId, member.server); }
        }
        return <li key={member.id} ref={expanded ? menuAnchor : undefined} className="party-player"
          onKeyDown={event=>{if (expanded && event.key==="Escape") {event.stopPropagation();setRowMenu(null);event.currentTarget.querySelector<HTMLButtonElement>(".party-player-join")?.focus();}}}>
          <span className="party-player-portrait">{leader && <img className="party-player-crown" src="/party-crown.svg" alt="Party host"/>}
            <Avatar user={profile ?? {...me,id:member.id,username:member.name,displayName:member.name,minecraftUsername:member.name,minecraftUuid:member.id,avatarUrl:null}}/>
          </span>
          <div className="party-player-info"><strong>{member.name}</strong>
            {member.server && <small>{member.server}</small>}
          </div>
          {mine ? <button className={member.server ? "party-player-join party-stop-sharing" : "party-player-join"} disabled={busy || (!member.server && !state?.currentServer)}
            title={member.server ? "Stop sharing this server" : state?.currentServer?.server || "Join a multiplayer server first"}
            onClick={()=>member.server ? void change("stop") : state?.currentServer && void change("share",{visit:state.currentServer.visit})}>
            {member.server ? "Stop sharing" : "Share"}
          </button> : member.server && <button className="party-player-join party-join-server" disabled={launchBusy || !compatible.length}
            title={!compatible.length ? "No Quick Play instance available" : undefined}
            aria-expanded={compatible.length > 1 ? expanded : undefined}
            onClick={()=>compatible.length===1 ? join(compatible[0].id) : setRowMenu(expanded?null:member.id)}>Join</button>}
          {!mine && member.server && expanded && compatible.length > 1 && <div className="party-player-menu">
            {compatible.map(item=><button key={item.id} disabled={launchBusy} onClick={()=>join(item.id)}>Join with {item.name}<small>{item.version}</small></button>)}
          </div>}
        </li>;
      })}</ul> : state && <div className="party-start"><p>Start a party to invite up to seven friends.</p><button className="play-primary" disabled={busy} onClick={()=>void change("create")}>Create party</button></div>}
    </section>
    </>
  </div>
    {party && <footer className="party-roster-actions"><button className="party-exit" disabled={busy} onClick={()=>void change("leave")}>{host?"End party":"Leave party"}</button></footer>}
  </section>;
}
