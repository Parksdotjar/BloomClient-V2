import { invoke } from "@tauri-apps/api/core";
import catalog from "../../backend/ask-delight/catalog.json";

import targets from "../../backend/ask-delight/destinations.json";
export const destinations: Record<string, {label:string; section?:string; selector?:string}> = targets;
export const help = catalog.entries;
export type Action = "instances" | "memory" | "mods" | "resourcepacks" | "shaderpacks";
export type Context = { build: string; platform: string; page: string; loader: string | null };
export type Pack = {name:string; minecraft:string; loader:"fabric"; mods:{id:string; title:string; slug:string}[]};
type Inventory = {
  name: string; minecraft: string; loader: string; loaderVersion: string;
  source: "installed" | "draft"; mods: string[]; disabled: string[];
};
export type PackContext = { name: string; loader: Context["loader"]; inventory: Inventory; instanceId?: string };
export type PackInstance = { id: string; name: string; version: string; loader: string; loaderVersion?: string | null };
export const questionLimit = 1600;
export const textBytes = (text: string) => new TextEncoder().encode(text).length;

export function describePack(name: string, minecraft: string, loader: string, mods: string[], instanceId?: string, loaderVersion = "", disabled: string[] = []): PackContext {
  const inventory: Inventory = { name, minecraft, loader, loaderVersion, source: instanceId ? "installed" : "draft", mods, disabled };
  if (textBytes(JSON.stringify(inventory)) > 49152) throw new RangeError("This pack’s inventory is too large to attach in full.");
  const normalized = loader.toLowerCase();
  return { name, loader: normalized === "fabric" || normalized === "vanilla" ? normalized : null, inventory, instanceId };
}

export function inventoryPreview(pack: PackContext) {
  const { minecraft, loader, loaderVersion, source, mods, disabled } = pack.inventory;
  return [`Minecraft ${minecraft} · ${[loader, loaderVersion].filter(Boolean).join(" ")}`,
    `${source === "draft" ? "Draft" : "Enabled"} mods (${mods.length}): ${mods.join(", ") || "None"}`,
    ...(disabled.length ? [`Disabled mods (${disabled.length}): ${disabled.join(", ")}`] : [])].join("\n");
}

export async function readInstancePack(instance: PackInstance) {
  const items = await invoke<{ name: string; version: string; fileName: string; enabled: boolean }[]>("list_instance_content", {
    instanceId: instance.id, category: "mods",
  });
  const mods: string[] = [], disabled: string[] = [];
  for (const item of items) {
    if (!/\.jar(?:\.disabled)?$/i.test(item.fileName)) continue;
    (item.enabled ? mods : disabled).push([item.name || item.fileName, item.version].filter(Boolean).join(" "));
  }
  return describePack(instance.name, instance.version, instance.loader, mods, instance.id, instance.loaderVersion ?? "", disabled);
}
export type Message = {
  id: string; at: number; role: "question" | "answer"; text: string;
  status: "ready" | "pending" | "failed" | "clarify" | "unsupported";
  pack?: Pack;
  choices?: string[]; instanceId?: string; action?: string; helpIds?: string[];
};
export type Thread = { id: string; updated: number; messages: Message[] };
export type History = { version: 1; save: boolean; selected: string | null; threads: Thread[] };
type Edit =
  | { type: "select"; id: string | null }
  | { type: "saveThread"; thread: Thread; select: boolean }
  | { type: "delete"; id: string }
  | { type: "clear" }
  | { type: "setSaving"; save: boolean };
export type Usage = {
  monthlyLimit?: number; dailyLimit: number; dailyRemaining: number | null; monthlyRemaining: number | null;
  dailyReset: number; monthlyReset: number; serverTime: number; blocking: string | null; mode: "mock" | "ai";
};
type Reply = { usage?: Usage; error?: string; result?: { choices?: string[]; destination?: string; pack?: Pack; answer: string; helpIds: string[]; status: string; action: string | null } };

export const scope = () => invoke<string>("ask_delight_scope");
export const readHistory = (account: string) => invoke<History>("ask_delight_history", { account });
export const editHistory = (account: string, edit: Edit) => invoke<void>("ask_delight_history", { account, edit });
export const getUsage = (account: string) => invoke<Reply>("ask_delight_remote", { account });

export function shortText(text: string, bytes: number) {
  const encoder = new TextEncoder();
  let result = "";
  let length = 0;
  for (const char of text) {
    length += encoder.encode(char).length;
    if (length > bytes) break;
    result += char;
  }
  return result;
}

export function askRemote(account: string, context: Context, question: Message, messages: Message[], attachment?: PackContext) {
  const pairs: string[][] = [];
  for (let index = messages.length - 1; index >= 1 && pairs.length < 2; index--) {
    const user = messages[index - 1], answer = messages[index];
    if (user.role === "question" && answer.role === "answer" && (answer.status === "ready" || answer.status === "clarify")) {
      pairs.unshift([shortText(user.text, 650), shortText(answer.text, 650)]);
    }
  }
  const latestPack = [...messages].reverse().find(m => m.pack)?.pack;
  const wantsPack = (text: string) =>
    /\b(?:build|make|draft|create|assemble|design|generate|put together|recommend|want|need)\b/i.test(text)
    && /\b(?:mod\s?pack|pack|lineup|mods)\b/i.test(text)
    && !/\b(?:resource|texture|shader) packs?\b/i.test(text);
  const packRequest = wantsPack(question.text) || (messages.at(-1)?.status === "clarify" && pairs.some(([q]) => wantsPack(q)));
  const pack = !attachment && (latestPack ? { ...latestPack, mods: latestPack.mods.map(mod => mod.slug) } : packRequest || undefined);
  return invoke<Reply>("ask_delight_remote", { account, body: {
    id: question.id, question: question.text, recent: pairs,
    context: attachment ? { ...context, loader: attachment.loader, inventory: attachment.inventory } : pack ? { ...context, pack } : context,
  } });
}

export function entryFor(action: string, context: Context) {
  return help.find(entry => {
    if (entry.action !== action || !entry.platforms.includes(context.platform)) return false;
    const build = context.build.split(".").map(Number);
    const minimum = entry.minBuild.split(".").map(Number);
    const index = minimum.findIndex((part, offset) => part !== build[offset]);
    return index < 0 || build[index] > minimum[index];
  });
}

export function localAnswer(question: string, context: Context, inConversation: boolean) {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const query = normalize(question);
  const intent = /^(?:how (?:do|can) i|where (?:do|can) i|where is|where are|show me|open|go to|find|what is|what are)\s+/;
  if (inConversation && !intent.test(query)) return undefined;
  const exact = (query.match(intent) ? query.replace(intent, "") : query)
    .replace(/^(?:(?:find|add|install|open|change|set|create|manage|enable|adjust|allocate|view)\s+)+/, "")
    .replace(/^(?:the|my)\s+/, "").replace(/\s+(?:settings|in delight|in delight client)$/, "");
  return help.find(entry => entryFor(entry.action, context)
    && (normalize(entry.question) === query || entry.aliases.includes(exact)));
}

export function validResult(result: Reply["result"], context: Context, question = "") {
  if (!result || typeof result.answer !== "string" || !result.answer.trim() || result.answer.length > 2200
      || !["answered", "clarify", "unsupported"].includes(result.status) || !Array.isArray(result.helpIds)
      || !result.helpIds.every(id => help.some(entry => entry.id === id && entryFor(entry.action, context)))) return null;
  const entry = typeof result.action === "string" && entryFor(result.action, context);
  let destination = result.destination && Object.hasOwn(destinations, result.destination) ? result.destination : undefined;
  // Older servers return the route in prose and omit their internal help IDs.
  if (!destination && !result.pack && !result.action) {
    for (const [id, target] of Object.entries(destinations)) {
      if (target.section && result.answer.toLowerCase().includes("settings → " + target.section.toLowerCase())) {
        destination = id;
        break;
      }
    }
    if (/\bmy profile\b/i.test(result.answer) && /\baccounts?\b/i.test(question)) destination = "minecraft-accounts";
  }
  const asksForInstanceMemory = /\b(?:instance|modpack|this pack)\b/i.test(question) && /\b(?:ram|memory)\b/i.test(question)
    && !/\b(default|global)\b/i.test(question);
  if (asksForInstanceMemory && (result.helpIds.includes("memory") || /\binstance.{0,24}settings\b/i.test(result.answer))) destination = "instance-memory";
  const choices = result.status === "clarify" && Array.isArray(result.choices) && result.choices.length === 2
    && result.choices.every(s => typeof s === "string" && s.trim() && s.length <= 100) ? result.choices : undefined;
  return { choices, pack: result.pack, text: result.answer, helpIds: result.helpIds,
    status: (result.status === "answered" ? "ready" : result.status) as Message["status"],
    action: result.status === "answered" ? destination ?? (entry && result.helpIds.includes(entry.id) ? entry.action : undefined) : undefined };
}

export const usageMessage: Record<string, string> = {
  loading: "Alula usage is still being checked. Try again once the check finishes.",
  unavailable: "Alula replies aren’t available in this launcher environment yet. Local help still works.",
  daily: "You’ve used today’s Alula allowance. Local help still works.",
  monthly: "You’ve used this month’s Alula allowance. Local help still works.",
  budget: "Alula replies are temporarily unavailable because the shared budget is paused. Local help still works.",
  paused: "Alula replies are temporarily unavailable. Local help still works.",
  rollout: "Alula replies aren’t available for this account yet. Local help still works.",
  signed_out: "Sign in to your Delight account through Social to use Alula. Local help still works.",
  offline: "Can’t reach Alula right now. Local help still works.",
  duplicate: "That request was already submitted.",
  in_flight: "An answer is already in progress.",
  burst: "Wait a moment before asking another Alula question.",
  ip_limit: "Alula is temporarily busy. Try again in a minute.",
  invalid_request: "Try a shorter launcher question. Leave out logs and private information.",
  provider_unavailable: "Alula couldn’t answer this time. Local help still works.",
  account_changed: "The launcher account changed. Open Alula again.",
};
