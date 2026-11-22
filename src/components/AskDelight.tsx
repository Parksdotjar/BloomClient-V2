import { ShortcutContext, binding, formatKeys, shortcuts, shortcutMatches } from "../services/shortcuts";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root, Element, ElementContent } from "hast";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ChevronDown, CircleEllipsis, CornerDownLeft, Folder, Info, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  destinations, askRemote, editHistory, entryFor, getUsage, help, localAnswer, readHistory, scope, shortText, usageMessage, validResult,
  describePack, questionLimit, readInstancePack, textBytes, inventoryPreview,
  type Pack, type PackContext, type PackInstance, type Context, type History, type Message, type Thread, type Usage,
} from "../services/ask-delight";
import { AlulaHistory } from "./AlulaHistory";
import "./ask-delight.css";

type Props = {
  sidebar: HTMLDivElement | null;
  active: boolean;
  context: Context;
  profileId: string | null;
  motion: boolean;
  instanceId?: string;
  instances: PackInstance[];
  canNavigate: (action: string, instanceId?: string) => boolean;
  openDownloads: () => void;
  createPack: (pack: Pack, draftId: string, onQueued: (count: number) => void) => Promise<void>;
  navigate: (action: string, instanceId?: string) => string | null;
};

function Brand() {
  return <h2 className="rail-title">Alula</h2>;
}

export function AskDelight(props: Props) {
  return <section className="alula-workspace" aria-label="Alula" data-motion={props.motion} hidden={!props.active}>
    <AccountChat key={props.profileId ?? "guest"} {...props} />
  </section>;
}

function AccountChat({ sidebar, active, profileId, context, instanceId, instances, canNavigate, navigate, createPack, openDownloads }: Props) {
  const [account, setAccount] = useState<string>();
  const [verified, setVerified] = useState(false);
  const [destination, setDestination] = useState<{ selector: string }>();
  const [navigationError, setNavigationError] = useState("");

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    let checking = false;
    async function refresh() {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const next = await scope();
        if (mounted) setAccount(next);
      } catch {
        if (mounted) setAccount("session:" + (profileId ?? "guest"));
      } finally {
        checking = false;
        if (mounted) setVerified(true);
      }
    }
    void refresh();
    const poll = window.setInterval(refresh, 2500);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.clearInterval(poll);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, profileId]);

  useLayoutEffect(() => {
    if (!active) setVerified(false);
  }, [active]);

  useLayoutEffect(() => {
    if (!destination) return;
    const target = document.querySelector<HTMLElement>(destination.selector);
    if (!target) {
      setNavigationError("That screen couldn’t open. Your chat is still here.");
      return;
    }
    if (target.closest('[data-ask-target="memory"]') || target.matches('input[aria-label="Minecraft memory"]')) target.scrollIntoView({ block: "start", behavior: "instant" });
    if (!target.matches("button, input, a, [tabindex]")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, [destination]);

  function openDestination(action: string, instanceId?: string) {
    if (!canNavigate(action, instanceId)) {
      setNavigationError("That screen isn’t available here. Choose an instance or try another question.");
      return;
    }
    try {
      const selector = navigate(action, instanceId);
      if (selector) {
        setNavigationError("");
        setDestination({ selector });
        return;
      }
    } catch { /* The launcher may be changing pages. */ }
    setNavigationError("That screen couldn’t open. Your chat is still here.");
  }

  return <>
    {account && <Chat sidebar={sidebar} openDownloads={openDownloads} instanceId={instanceId} instances={instances} createPack={createPack} key={account} account={account} active={active && verified} context={context} canNavigate={canNavigate}
      openDestination={openDestination} navigationError={navigationError} />}
    {active && !verified && <div className="rail-column">
        <header className="rail-header ask-header"><Brand /></header>
        <p className="rail-scroll ask-notice" role="status">Opening Alula…</p>
      </div>}
  </>;
}

type ChatProps = Pick<Props, "sidebar" | "context" | "canNavigate" | "createPack" | "instanceId" | "instances" | "openDownloads"> & {
  account: string;
  active: boolean;
  openDestination: (action: string, instanceId?: string) => void;
  navigationError: string;
};
const emptyHistory = (): History => ({ version: 1, save: true, selected: null, threads: [] });
const formatReset = (time: number) => new Date(time).toLocaleString(undefined, {
  year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

type UsageState = "loading" | "ready" | "signed_out" | "paused" | "offline" | "unavailable";
const usageLabels: Record<UsageState, string> = {
  loading: "Checking usage", ready: "Replies paused", signed_out: "Sign in for replies",
  paused: "Replies paused", offline: "Usage unavailable", unavailable: "Replies unavailable",
};
function failedUsage(error: unknown): UsageState {
  if (error === "signed_out" || error === "paused") return error;
  return error === "not_found" ? "unavailable" : "offline";
}

function Thinking() {
  return <span className="ask-thinking-dots" role="status" aria-label="Alula is thinking">
    <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
  </span>;
}

function readingTime(word: string) {
  const spoken = word.replace(/[^\p{L}\p{N}]/gu, "");
  // Let an unstressed lead-in run into the word it introduces.
  const leadIn = /^(?:a|an|the|to|of|in|on|for|at|by|with|your|its|and|or)$/i.test(spoken);
  const beat = leadIn ? 48 : 92 + Math.min(spoken.length, 12) * 7;
  if (/[.!?…]["’”')]*$/.test(word)) return beat + 145;
  if (/[,;:—]["’”')]*$/.test(word)) return beat + 70;
  return beat;
}

const sourceNames: Record<string,string> = {
  "modrinth.com":"View on Modrinth", "minecraft.wiki":"View on Minecraft Wiki",
  "docs.fabricmc.net":"View Fabric documentation", "docs.papermc.io":"View Paper documentation",
  "piston-meta.mojang.com":"View Mojang’s version manifest",
};

function markdownTimeline({reveal}: {reveal: boolean}) {
  return (tree: Root) => {
    let delay = 0;
    function visit(parent: Root | Element) {
      if (parent.type === "element") {
        const href = parent.properties.href;
        const onlyChild = parent.children.length === 1 && parent.children[0];
        if (parent.tagName === "a" && typeof href === "string" && onlyChild && onlyChild.type === "text"
            && onlyChild.value === href && URL.canParse(href)) {
          const host = new URL(href).hostname;
          if (Object.hasOwn(sourceNames,host)) onlyChild.value = sourceNames[host];
        }
        if (reveal && ["li","blockquote","pre","code","hr","th","td","a"].includes(parent.tagName)) {
          parent.properties["data-reveal-at"] = delay;
          parent.properties.style = `--ask-block-delay:${delay}ms`;
        }
      }
      const children: ElementContent[] = [];
      for (const child of parent.children) {
        if (child.type === "doctype") continue;
        if (reveal && child.type === "text" && child.value.trim()) {
          for (const value of child.value.split(/(\s+)/).filter(Boolean)) {
            const text = {type: "text" as const, value};
            if (!value.trim()) { children.push(text); continue; }
            children.push({type:"element", tagName:"span", properties:{
              className:["ask-reveal-word"], style:`animation-delay:${delay}ms`
            }, children:[text]});
            delay += readingTime(value);
          }
        } else {
          if (child.type === "element") visit(child);
          children.push(child);
        }
      }
      parent.children = children;
    }
    visit(tree);
    const first = tree.children.find(child => child.type === "element");
    if (reveal && first?.type === "element") first.properties["data-reveal-duration"] = delay + 560;
  };
}

export function AnswerText({ text, reveal = false }: { text: string; reveal?: boolean }) {
  return <div className="ask-markdown"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[[markdownTimeline,{reveal}]]}
    skipHtml disallowedElements={["img","input"]} components={{a: ({href, children, node, ...props}) => {
      if (!href || !/^https:\/\//i.test(href)) return <>{children}</>;
      if (!URL.canParse(href)) return <>{children}</>;
      return <a {...props} className="ask-source" href={href} target="_blank" rel="noreferrer" onClick={event => {
        event.preventDefault();
        void openUrl(href).catch(() => window.open(href,"_blank","noopener,noreferrer"));
      }}>{children}</a>;
    }}}>{text}</Markdown></div>;
}

type PackProgress = {queued: number; phase: "creating" | "queueing" | "done" | "failed"; error?: string};
function PackPreview({pack, progress, create, openDownloads}: {pack:Pack; progress?:PackProgress; create:()=>void; openDownloads:()=>void}) {
  const running = progress?.phase === "creating" || progress?.phase === "queueing";
  return <section className="ask-pack"><strong>{pack.name}</strong>
    <small>Fabric · {pack.minecraft} · {pack.mods.length} mods</small>
    <ul>{pack.mods.map(mod => <li key={mod.id}>{mod.title}</li>)}</ul>
    {progress?.phase === "done" ? <button className="ask-link" onClick={openDownloads}>Open Downloads<ArrowRight size={15} /></button>
      : <button className="ask-link" disabled={running} onClick={create}>{progress?.phase === "creating" ? "Creating instance…" : progress?.phase === "queueing" ? `Queuing mods · ${progress.queued} of ${pack.mods.length}` : progress?.phase === "failed" ? "Retry" : "Create instance"}</button>}
    {progress?.error && <p role="alert">{progress.error}</p>}
  </section>;
}

function Chat({ sidebar, instanceId, instances, createPack, openDownloads, account, active, context, openDestination, canNavigate, navigationError }: ChatProps) {
  const bindings = useContext(ShortcutContext);
  const sendKeys = formatKeys(binding(shortcuts.find(row => row[0] === "sendAlula")!, bindings));
  const composer = useRef<HTMLTextAreaElement>(null);
  const attachmentButton = useRef<HTMLButtonElement>(null);
  const attachmentPicker = useRef<HTMLElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [history, setHistory] = useState(emptyHistory);
  const state = useRef(history);
  const queue = useRef(Promise.resolve());
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<PackContext>();
  const [attachmentPanel, setAttachmentPanel] = useState<"pick" | "review">();
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const attachmentRequest = useRef(0);
  const [usage, setUsage] = useState<Usage>();
  const [usageState, setUsageState] = useState<UsageState>("loading");
  const [details, setDetails] = useState(false);
  const [pending, setPending] = useState(false);
  const [revealing, setRevealing] = useState<string>();
  const [packProgress, setPackProgress] = useState<Record<string, PackProgress>>({});
  const startedPacks = useRef(new Set<string>());
  async function queuePack(pack: Pack, id: string) {
    if (startedPacks.current.has(id)) return;
    startedPacks.current.add(id);
    let queued = 0;
    const show = (phase: PackProgress["phase"], error?: string) =>
      setPackProgress(current => ({...current, [id]: {phase, queued, error}}));
    show("creating");
    try {
      await createPack(pack, id, count => { queued = count; show("queueing"); });
      show("done");
    } catch (error) {
      startedPacks.current.delete(id);
      show("failed", String(error));
    }
  }
  useEffect(() => {
    if (!revealing) return;
    if (!active) { setRevealing(undefined); return; }
    const duration = scroll.current?.querySelector<HTMLElement>("[data-reveal-duration]")?.dataset.revealDuration;
    const timer = window.setTimeout(() => setRevealing(undefined), Number(duration) || 560);
    return () => window.clearTimeout(timer);
  }, [revealing, active]);
  const inFlight = useRef(false);
  const closedThreads = useRef(new Set<string>());
  const sessionThreads = useRef(new Set<string>());
  const alive = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const usageSequence = useRef(0);
  const localOnly = account.startsWith("session:");
  const thread = history.threads.find(item => item.id === history.selected);
  const latestDraft = thread && [...thread.messages].reverse().find(message => message.pack)?.pack;
  const questionTooLong = textBytes(draft.trim()) > questionLimit;

  useLayoutEffect(() => {
    if (attachmentPanel !== "pick") return;
    const picker = attachmentPicker.current;
    (picker?.querySelector("button") ?? picker)?.focus();
  }, [attachmentPanel]);

  function clearAttachment() {
    attachmentRequest.current += 1;
    setAttachment(undefined);
    setAttachmentPanel(undefined);
    setAttachmentLoading(false);
    setAttachmentError("");
  }

  async function attachInstance(instance: PackInstance) {
    const request = ++attachmentRequest.current;
    setAttachmentLoading(true);
    setAttachmentError("");
    try {
      const pack = await readInstancePack(instance);
      if (!alive.current || request !== attachmentRequest.current) return;
      setAttachment(pack);
      setAttachmentPanel(undefined);
      composer.current?.focus();
    } catch (error) {
      if (alive.current && request === attachmentRequest.current) setAttachmentError(error instanceof RangeError ? error.message : "Couldn’t read this instance’s mods. Try again.");
    } finally {
      if (alive.current && request === attachmentRequest.current) setAttachmentLoading(false);
    }
  }

  function update(next: History) { state.current = next; setHistory(next); }

  useEffect(() => {
    alive.current = true;
    let active = true;
    async function load() {
      try {
        if (localOnly) throw new Error();
        const saved = await readHistory(account);
        if (!active) return;
        for (const item of saved.threads) {
          item.messages = item.messages.map(message => message.status === "pending"
            ? { ...message, status: "failed", text: "The previous answer was interrupted." } : message);
        }
        update(saved);
      } catch { if (active) setStorageError(true); }
      finally { if (active) setLoaded(true); }
    }
    void load();
    return () => { active = false; alive.current = false; };
  }, [account, localOnly]);

  function persist(edit: Parameters<typeof editHistory>[1]) {
    if (localOnly) return;
    queue.current = queue.current.then(() => editHistory(account, edit)).catch(() => {
      if (alive.current) setStorageError(true);
    });
  }

  async function refreshUsage() {
    if (!activeRef.current) return;
    const sequence = ++usageSequence.current;
    const apply = (next: UsageState, value?: Usage) => {
      if (alive.current && sequence === usageSequence.current) {
        setUsage(value);
        setUsageState(next);
      }
    };
    if (localOnly) { apply("offline"); return; }
    if (account.endsWith("-guest")) { apply("signed_out"); return; }
    try {
      const response = await getUsage(account);
      apply(response.usage ? "ready" : failedUsage(response.error), response.usage);
    } catch (error) { apply(failedUsage(error)); }
  }

  useEffect(() => {
    const refreshVisibleUsage = () => { if (!document.hidden) void refreshUsage(); };
    refreshVisibleUsage();
    document.addEventListener("visibilitychange", refreshVisibleUsage);
    return () => document.removeEventListener("visibilitychange", refreshVisibleUsage);
  }, [account, active]);

  useEffect(() => {
    if (!active || !usage || usageState !== "ready") return;
    const delay = Math.min(60_000, Math.max(1000, Math.min(usage.dailyReset, usage.monthlyReset) - usage.serverTime + 100));
    const timer = window.setTimeout(() => { if (!document.hidden) void refreshUsage(); }, delay);
    return () => window.clearTimeout(timer);
  }, [active, usage, usageState]);

  useEffect(() => {
    if (!active || !scroll.current) return;
    const arriving = scroll.current.querySelector(".ask-reveal-word")?.closest("article");
    if (arriving && arriving.getBoundingClientRect().bottom > scroll.current.getBoundingClientRect().bottom) {
      const offset = arriving.getBoundingClientRect().top - scroll.current.getBoundingClientRect().top;
      scroll.current.scrollTop += Math.max(0, offset);
    } else scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [active, thread]);

  function saveThread(item: Thread, select = false) {
    const current = state.current;
    const threads = [item, ...current.threads.filter(old => old.id !== item.id && Date.now() - old.updated < 30 * 86_400_000)].slice(0, 50);
    update({ ...current, threads, selected: select ? item.id : current.selected });
    if (current.save && !sessionThreads.current.has(item.id)) {
      persist({ type: "saveThread", thread: item, select });
    }
  }

  function select(id: string | null) {
    setRevealing(undefined);
    update({ ...state.current, selected: id });
    setDraft("");
    clearAttachment();
    if (state.current.save && (!id || !sessionThreads.current.has(id))) persist({ type: "select", id });
    requestAnimationFrame(() => composer.current?.focus());
  }


  function setSaving(save: boolean) {
    update({ ...state.current, save, selected: null });
    persist({ type: "setSaving", save });
    if (save) persist({ type: "select", id: null });
    setDraft("");
    clearAttachment();
  }

  async function submit(text: string) {
    const questionText = text.trim();
    if (!active || !loaded || !questionText || inFlight.current || attachmentLoading
      || textBytes(questionText) > questionLimit) return;
    const current = state.current.threads.find(item => item.id === state.current.selected);
    const previous = current?.messages ?? [];
    const question: Message = { id: crypto.randomUUID(), at: Date.now(), role: "question", text: questionText, status: "ready" };
    const thinking: Message = { id: crypto.randomUUID(), at: Date.now(), role: "answer", text: "Thinking…", status: "pending" };
    const item = { id: current?.id ?? crypto.randomUUID(), updated: Date.now(), messages: [...previous.slice(-58), question, thinking] };
    if (!state.current.save || localOnly) sessionThreads.current.add(item.id);
    const finish = (answer: Partial<Message> & Pick<Message, "text">) => {
      if (!alive.current || closedThreads.current.has(item.id)) return;
      if (activeRef.current && state.current.selected === item.id && answer.status !== "failed") setRevealing(thinking.id);
      saveThread({ ...item, updated: Date.now(), messages: [...item.messages.slice(0, -1), { ...thinking, status: "ready", ...answer }] });
    };
    setDraft("");
    setAttachmentPanel(undefined);
    const local = attachment || previous.at(-1)?.status === "clarify" ? undefined : localAnswer(questionText, context, previous.length > 0);
    if (local) {
      const answer: Message = { ...thinking, text: local.steps, action: local.action, helpIds: [local.id], status: "ready" };
      setRevealing(thinking.id);
      saveThread({ ...item, messages: [...item.messages.slice(0, -1), answer] }, true);
      return;
    }
    saveThread(item, true);
    const blocked = usageState === "ready" ? usage?.blocking : usageState;
    if (blocked || !usage) {
      const text = usageMessage[blocked ?? "offline"] ?? usageMessage.offline;
      finish({ text, status: "failed" });
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      const reply = await askRemote(account, context, question, previous, attachment);
      const answer = validResult(reply.result, context, questionText);
      const targetInstanceId = attachment ? attachment.instanceId : instanceId;
      if (answer?.action === "instance-memory" && !targetInstanceId) answer.action = undefined;
      finish(answer ? {...answer, instanceId: answer.action === "instance-memory" ? targetInstanceId : undefined} : { text: usageMessage[reply.error ?? "provider_unavailable"] ?? usageMessage.provider_unavailable, status: "failed" });
    } catch (error) {
      finish({ text: usageMessage[String(error)] ?? usageMessage.offline, status: "failed" });
    } finally {
      inFlight.current = false;
      if (alive.current) { setPending(false); void refreshUsage(); }
    }
  }

  function remove(id?: string) {
    const current = state.current;
    for (const item of current.threads) if (!id || item.id === id) closedThreads.current.add(item.id);
    update({ ...current, threads: id ? current.threads.filter(item => item.id !== id) : [],
      selected: !id || current.selected === id ? null : current.selected });
    persist(id ? { type: "delete", id } : { type: "clear" });
    if (!id || id === current.selected) clearAttachment();
  }

  const remaining = usageState === "ready" ? usage?.dailyRemaining : null;
  const percent = remaining != null && usage && usage.dailyLimit > 0
    ? Math.max(0, Math.min(100, Math.round(100 * remaining / usage.dailyLimit)))
    : null;
  const usageLabel = remaining != null ? `${percent}% left today` : usageLabels[usageState];
  const preferred = context.page === "instance" ? ["mods", "resourcepacks", "shaderpacks"] : context.page === "settings"
    ? ["memory", "instances", "mods"] : ["instances", "memory", "mods"];
  return <div className="rail-column" hidden={!active}>
    {active && sidebar && loaded && createPortal(<AlulaHistory history={history} sessionThreads={sessionThreads.current}
      onNew={() => select(null)} onSelect={select} onRemove={remove} onSetSaving={setSaving} />, sidebar)}
    <header className="rail-header ask-header"><Brand /></header>
    {navigationError && <p className="ask-notice" role="alert">{navigationError}</p>}
    {storageError && <p className="ask-notice" role="status">Chat history may not be saved. You can keep chatting in this session.</p>}
    <div className="rail-scroll" ref={scroll}>
      {!loaded ? <p role="status">Reading local history…</p> : !thread ? <section className="ask-welcome">
        <h2>How can I help?</h2>
        <p>Ask about Minecraft or find your way around Delight.</p>
        <div className="ask-suggestions">{preferred.map(id => help.find(entry => entry.id === id)).filter(entry => entry && entryFor(entry.action, context)).map(entry =>
          <button key={entry!.id} disabled={pending} onClick={() => void submit(entry!.question)}>{entry!.question}<ArrowRight size={15} /></button>)}</div>
      </section> : <div className="ask-transcript" role="log" aria-label="Conversation">{thread.messages.map(message => {
        const action = message.action;
        const label = action && (entryFor(action, context)?.label ?? (Object.hasOwn(destinations, action) ? destinations[action].label : undefined));
        return <article key={message.id} className={`ask-message ask-${message.role}`} data-status={message.status}>
          <div className="ask-message-content">
            <span className="ask-speaker">{message.role === "question" ? "You" : "Alula"}</span>
            {message.status === "pending" ? <Thinking /> : message.role === "answer" ? <AnswerText text={message.text} reveal={message.id === revealing} /> : <p>{message.text}</p>}
            {message.status === "clarify" && message.choices?.length === 2 && thread.messages.at(-1)?.id === message.id &&
              <div className="ask-choices" role="group" aria-label="Reply to Alula">
                {message.choices.map(choice => <button key={choice} disabled={pending} onClick={() => void submit(choice)}>{choice}</button>)}
                <button className="ask-write-in" onClick={() => composer.current?.focus()}>Type my own answer</button>
              </div>}
            {message.pack && <PackPreview pack={message.pack} progress={packProgress[message.id]} create={() => void queuePack(message.pack!, message.id)} openDownloads={openDownloads} />}
            {action && label && canNavigate(action, message.instanceId) && <button className="ask-link" onClick={() => openDestination(action, message.instanceId)}>{label}<ArrowRight size={15} /></button>}
          </div>
        </article>;
      })}</div>}
    </div>
    <footer className="ask-footer" onKeyDown={event => {
      if (event.key === "Escape" && attachmentPanel) {
        event.stopPropagation();
        setAttachmentPanel(undefined);
        if (event.target !== composer.current) attachmentButton.current?.focus();
      }
    }}>
      <div className="ask-pack-bar">
        <button type="button" ref={attachmentButton} className="ask-pack-selector"
          aria-label={attachment ? `Select modpack, current pack: ${attachment.name}` : "Select modpack"}
          title={attachment?.name ?? "Select modpack"}
          aria-expanded={attachmentPanel === "pick"} disabled={!loaded || pending || attachmentLoading}
          onClick={() => {
            setAttachmentError("");
            setAttachmentPanel(attachmentPanel === "pick" ? undefined : "pick");
          }}><Folder size={17} /><span>{attachment?.name ?? "Select modpack"}</span><ChevronDown size={14} /></button>
        {attachment && <div className="ask-pack-actions">
          <button type="button" aria-label="Preview pack context" title="Double-click to preview pack context" aria-expanded={attachmentPanel === "review"}
            onClick={event => { if (event.detail === 0 || event.detail === 2) setAttachmentPanel(attachmentPanel === "review" ? undefined : "review"); }}><Info size={14} /></button>
          <button type="button" aria-label="Remove pack context" title="Remove pack context"
            onClick={() => { clearAttachment(); composer.current?.focus(); }}><X size={14} /></button>
        </div>}
        {attachmentPanel === "pick" && <section ref={attachmentPicker} className="ask-attachment-panel" aria-label="Choose pack context" tabIndex={-1}>
          {latestDraft && <button type="button" disabled={attachmentLoading} onClick={() => {
            setAttachment(describePack(latestDraft.name, latestDraft.minecraft, latestDraft.loader, latestDraft.mods.map(mod => mod.title)));
            setAttachmentPanel(undefined);
            composer.current?.focus();
          }}><span>{latestDraft.name}</span><small>Alula draft · Minecraft {latestDraft.minecraft}</small></button>}
          {instances.map(instance => <button type="button" key={instance.id} disabled={attachmentLoading}
            onClick={() => void attachInstance(instance)}>
            <span>{instance.name}</span><small>{instance.loader} · Minecraft {instance.version}</small>
          </button>)}
          {!instances.length && !latestDraft && <span>No instances or pack drafts available.</span>}
          {attachmentLoading && <span role="status">Reading installed mods…</span>}
          {attachmentError && <span role="alert">{attachmentError}</span>}
        </section>}
        {attachmentPanel === "review" && attachment && <section className="ask-attachment-panel" aria-label="Review pack context">
          <strong>Pack context</strong>
          <p>{inventoryPreview(attachment)}</p>
        </section>}
      </div>
      <div className="ask-composer" data-ready={loaded && !pending && !attachmentLoading && !questionTooLong && Boolean(draft.trim())}>
          <textarea ref={composer} rows={2} value={draft} placeholder="Ask Alula…" aria-label="Your question"
            aria-describedby="ask-composer-keys" enterKeyHint="send"
            onChange={event => setDraft(shortText(event.target.value, questionLimit))}
            onKeyDown={event => {
              if (shortcutMatches("sendAlula", bindings, event.nativeEvent)) {
                event.preventDefault();
                void submit(draft);
              }
            }} />
          <span className="ask-speaker" id="ask-composer-keys">{sendKeys} sends.</span>
          {questionTooLong && <span className="ask-attachment-warning" role="status">Shorten your question.</span>}
        <div className="ask-composer-meta">
          <div className="ask-tools">
            <div className="ask-usage" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDetails(false); }}>
              <button type="button" className="ask-icon" onClick={() => setDetails(!details)}
                aria-label={usageLabel} title={usageLabel} aria-expanded={details} aria-controls={details ? "ask-usage-details" : undefined}>
                {percent === null
                  ? <CircleEllipsis className="ask-usage-status" size={18} aria-hidden="true" />
                  : <span className="ask-meter" aria-hidden="true" style={{ "--ask-remaining": `${percent}%` } as CSSProperties} />}
              </button>
              {details && <div id="ask-usage-details" className="ask-usage-details">
                {usage && usageState === "ready" && <>
                  <b>{usage.mode === "mock" ? "Mock usage" : "Usage remaining"}</b>
                  {remaining != null && <span>Daily: {percent}% · resets {formatReset(usage.dailyReset)}</span>}
                  {usage.monthlyRemaining != null && <span>Monthly: {Math.ceil(100 * usage.monthlyRemaining / (usage.monthlyLimit ?? 100))}% · resets {formatReset(usage.monthlyReset)}</span>}
                </>}
                {usageState !== "ready" && <span>{usageMessage[usageState] ?? usageLabel}</span>}
                {usage?.blocking && <span>{usageMessage[usage.blocking]}</span>}
                {usageState === "ready" && usage?.mode === "ai" && <p className="ask-usage-privacy">Online replies use your question, any attached pack details, and up to two recent turns.</p>}
              </div>}
            </div>
          </div>
          {pending
            ? !thread?.messages.some(message => message.status === "pending") && <Thinking />
            : <span className="ask-enter-hint" aria-hidden="true"><kbd><CornerDownLeft size={12} /> {sendKeys}</kbd><span>to send</span></span>}
        </div>
      </div>
    </footer>
  </div>;
}
