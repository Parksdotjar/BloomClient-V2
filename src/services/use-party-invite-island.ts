import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "./invoke";

type Invite = {id: string; name: string; expires?: number};
type PartySnapshot = {invites: Invite[]};
export type IslandPartyInvite = {
  key: string; name: string; busy: boolean;
  dismiss: () => void; respond: (action: "accept" | "decline") => void;
};
const keyOf = (invite: Invite) => invite.id + "/" + (invite.expires ?? "");
export function publishPartySnapshot(player: string, snapshot: PartySnapshot) {
  window.dispatchEvent(new CustomEvent("delight-party-snapshot", {detail:{player,snapshot}}));
}
export function usePartyInviteIsland(account: string | undefined, onError: (message: string, kind: "error") => void): IslandPartyInvite | undefined {
  const player = account?.toLowerCase().replace(/^([\da-f]{8})([\da-f]{4})([\da-f]{4})([\da-f]{4})([\da-f]{12})$/, "$1-$2-$3-$4-$5");
  const [pending,setPending] = useState<{player:string; invites:Invite[]}>();
  const dismissed = useRef(new Set<string>());
  const [working,setWorking] = useState("");
  const inFlight = useRef("");
  const activePlayer = useRef(player);
  activePlayer.current = player;
  useEffect(()=>{
    dismissed.current.clear();
    setPending(undefined);
    if (!player) return;
    let active=true, reading=false, lastRead=0, revision=0;
    function apply(snapshot: PartySnapshot) {
      revision++;
      lastRead=Date.now();
      const current=new Set(snapshot.invites.map(keyOf));
      for (const key of dismissed.current) if (!current.has(key)) dismissed.current.delete(key);
      setPending({player:player!,invites:snapshot.invites.filter(i=>!dismissed.current.has(keyOf(i)))});
    }
    function received(event: Event) {
      const detail=(event as CustomEvent).detail;
      if (detail.player===player) apply(detail.snapshot);
    }
    async function read() {
      if(document.hidden || reading || Date.now()-lastRead<10000) return;
      reading=true;
      const at=revision;
      try {
        const snapshot=await invoke<PartySnapshot>("social_party",{player});
        if(active && revision===at) apply(snapshot);
      } catch { /* A signed-out or offline player has no new invitations to display. */ }
      finally {reading=false;}
    }
    window.addEventListener("delight-party-snapshot",received);
    document.addEventListener("visibilitychange",read);
    void read();
    const timer=window.setInterval(read,12000);
    return ()=>{active=false;clearInterval(timer);window.removeEventListener("delight-party-snapshot",received);document.removeEventListener("visibilitychange",read);};
  },[player]);
  const invite=pending?.player===player ? pending?.invites[0] : undefined;
  const key=invite && keyOf(invite);
  const dismiss=useCallback(()=>{
    if (!key || activePlayer.current!==player) return;
    dismissed.current.add(key);
    setPending(state=>state && {...state,invites:state.invites.filter(i=>keyOf(i)!==key)});
  },[player,key]);
  if (!invite || !key || !player) return;
  const identity=player+"/"+key;
  return {key:identity,name:invite.name,busy:working===identity,dismiss,respond:async action=>{
    if(inFlight.current===identity) return;
    inFlight.current=identity;setWorking(identity);
    try {
      const snapshot=await invoke<PartySnapshot>("social_party",{player,change:{action,partyId:invite.id}});
      if(activePlayer.current===player) {
        publishPartySnapshot(player,snapshot);
        window.dispatchEvent(new Event("delight-party-changed"));
      }
    } catch(e){if(activePlayer.current===player) onError(String(e),"error");}
    finally {if(inFlight.current===identity){inFlight.current="";setWorking("");}}
  }};
}
