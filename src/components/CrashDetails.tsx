import { useEffect, useRef, useState } from "react";
import { askRemote, scope, shortText, usageMessage, validResult, type Context } from "../services/ask-delight";
import { AnswerText } from "./AskDelight";

type Entry = { id: string; instanceId: string; stream: string; message: string; timestamp: number };

export function crashSummary(failure: Entry, entries: Entry[], instance?: { version: string; loader: string }) {
  const related = entries.filter(entry => entry.instanceId === failure.instanceId);
  const start = related.slice(0, related.findIndex(entry => entry.id === failure.id) + 1)
    .filter(entry => entry.stream === "launcher" && entry.id.endsWith("-launch")).at(-1);
  const evidence = new Set<string>();
  // Extract diagnostic identifiers. Console lines can also contain chat, paths or credentials.
  const lines = [failure.message, ...related.filter(entry => start && entry.timestamp >= start.timestamp &&
    entry.timestamp <= failure.timestamp + 500 && entry.stream !== "launcher").map(entry => entry.message).reverse()];
  for (const line of lines) {
    for (const match of line.matchAll(/\b(?:[\w$.]{1,100}(?:Exception|Error)|exit code -?\d+|incompatible mods|out of memory|could not reserve enough space|failed to download|permission denied|access denied|connection timed out|unable to access jarfile|unsupported class file major version \d+)\b/gi)) evidence.add(match[0]);
    for (const match of line.matchAll(/\bMod '[^'\r\n]{1,80}' \(([\w-]{1,64})\) ([\w.+-]{1,32}) requires ([^'\r\n]{1,60}) of (?:mod )?'([\w .-]{1,64})'/gi))
      evidence.add(match[1] + " " + match[2] + " requires " + match[3].replace(/[^\w .<>=+-]/g, "") + " of " + match[4]);
  }
  return shortText(["Why did this Minecraft launch fail?", instance && "Minecraft " + instance.version + " · " + instance.loader,
    ...([...evidence].length ? [...evidence].slice(0, 10) : ["No specific error identified."])].filter(Boolean).join("\n"), 1500);
}

export function CrashDetails({ initial, context, close }: { initial: string; context: Context; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function send() {
    if (busy.current || !draft.trim()) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const account = await scope();
      const reply = await askRemote(account, context, { id: crypto.randomUUID(), at: Date.now(), role: "question", status: "ready", text: draft.trim() }, []);
      const result = validResult(reply.result, context);
      if (result) setAnswer(result.text);
      else setError(usageMessage[reply.error ?? "provider_unavailable"] ?? usageMessage.offline);
    } catch (reason) { setError(usageMessage[String(reason)] ?? usageMessage.offline); }
    finally { busy.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className="crash-details" aria-labelledby="crash-title" onCancel={close}>
    <h2 id="crash-title">{answer ? "Alula’s reply" : "Share crash details"}</h2>
    {answer ? <AnswerText text={answer} /> : <>
      <p>Review or edit the crash details before sending them to Alula.</p>
      <textarea aria-label="Crash details to share" value={draft} disabled={pending} onChange={e => setDraft(shortText(e.target.value, 1600))} />
      <small>Client {context.build} · {context.platform} · Screen: {context.page} · Loader: {context.loader ?? "unknown"}</small>
    </>}
    {error && <p role="alert">{error}</p>}
    <footer><button onClick={close}>{answer || pending ? "Close" : "Cancel"}</button>
      {!answer && <button disabled={pending || !draft.trim()} onClick={() => void send()}>{pending ? "Sending…" : "Send to Alula"}</button>}
    </footer>
  </dialog>;
}
