import { useEffect, useRef } from "react";
import { Ticket } from "lucide-react";
import { invoke } from "../services/invoke";
import { LockerInlineAction } from "./LockerInlineAction";

export function CapeRedemption({ accountId, onClaim, onNotify }: {
  accountId?: string;
  onClaim: (id: string) => void;
  onNotify: (message: string, kind?: "success" | "error") => void;
}) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return <LockerInlineAction label="Redeem code" icon={Ticket} field="Enter cape code" submitLabel="Claim cape"
    placeholder={accountId ? "Enter code" : "Sign in to Minecraft to redeem"} signedOut={!accountId}
    maxLength={80} pending="Redeeming…" submit={async code => {
      const result = await invoke<{id: string; name: string; alreadyClaimed: boolean}>("cosmetics_request", {
        method: "POST", path: "/v1/capes/redeem", body: { code }, accountId,
      });
      if (alive.current) {
        onClaim(result.id);
        onNotify(result.alreadyClaimed ? `“${result.name}” is already in your locker.` : `Cape claimed: “${result.name}”`, "success");
      }
      return result.alreadyClaimed ? "Already claimed" : "Redeemed";
    }} onError={message => {
      onNotify(message, "error");
      if (/expired/i.test(message)) return "Code expired";
      if (/already been claimed/i.test(message)) return "Already claimed";
      if (/already have/i.test(message)) return "Already owned";
      if (/invalid|doesn't look right|unavailable/i.test(message)) return "Invalid code";
      return "Couldn’t redeem";
    }}/>;
}
