import { createContext } from "react";

const primary = /Mac/i.test(navigator.platform) ? "Cmd" : "Ctrl";
export const shortcuts = [
  ["switch", "Quick switcher", primary + "+K"],
  ["rename", "Rename focused instance", "F2"],
  ["cancelRename", "Cancel instance rename", "Escape"],
  ["sendAlula", "Send Alula message", "Enter"],
  ...(import.meta.env.DEV ? [
    ["mockUpdate", "Preview launcher update (development)", "Ctrl+Shift+U"],
    ["mockUpdateAlt", "Alternate update preview (development)", "Ctrl+Shift+F10"],
  ] as const : []),
  ["page:home", "Home", "Alt+1"],
  ["page:instances", "Instances", "Alt+2"],
  ["page:downloads", "Downloads", "Alt+3"],
  ["page:utilities", "Utilities", "Alt+4"],
  ["page:social", "Social", "Alt+5"],
  ["page:locker", "Locker", "Alt+6"],
  ["page:portal", "Portal", "Alt+7"],
  ["page:alula", "Alula", "Alt+8"],
  ["page:screenshots", "Screenshots", "Alt+9"],
  ["page:logs", "Launch logs", "Alt+0"],
  ["page:new-instance", "New instance", primary + "+N"],
  ["import", "Import modpack", primary + "+Shift+O"],
  ["folder", "Open game folder", primary + "+Shift+G"],
  ["setting:Appearance", "Appearance", primary + "+,"],
  ["setting:My Profile", "Accounts", "Alt+Shift+A"],
  ["setting:Shortcuts", "Keyboard shortcuts", "Alt+Shift+K"],
  ["setting:Cache", "Storage settings", "Alt+Shift+S"],
  ["setting:Minecraft", "Minecraft defaults", "Alt+Shift+M"],
  ["setting:Downloads", "Download settings", "Alt+Shift+D"],
  ["setting:Performance", "Performance settings", "Alt+Shift+P"],
] as const;

export type ShortcutId = typeof shortcuts[number][0];
export type Bindings = Partial<Record<ShortcutId, string>>;
export const ShortcutContext = createContext<Bindings>({});
export const binding = (row: typeof shortcuts[number], saved: Bindings) => saved[row[0]] || row[2];
export const formatKeys = (keys: string) => keys.split("+").join(" + ");

export function modifiers(e: KeyboardEvent) {
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Cmd"].filter(Boolean).join("+");
}
export function chord(e: KeyboardEvent) {
  if (e.isComposing || e.getModifierState("AltGraph") || ["Control", "Meta", "Alt", "Shift", "Dead", "Process", "Unidentified"].includes(e.key)) return "";
  // Option can produce a symbol on macOS even when the shortcut uses a letter or digit.
  const optionKey = e.altKey && /Mac/i.test(navigator.platform) && /^(Key[A-Z]|Digit[0-9])$/.test(e.code)
    ? e.code.replace(/^(Key|Digit)/, "") : undefined;
  const key = optionKey ?? (e.key === " " ? "Space" : e.key === "+" ? "Plus" : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return [modifiers(e), key].filter(Boolean).join("+");
}
export function recording(e: KeyboardEvent) {
  return e.target instanceof Element && !!e.target.closest("[data-recording-shortcut]");
}
export function shortcutMatches(id: ShortcutId, saved: Bindings, e: KeyboardEvent) {
  const row = shortcuts.find(item => item[0] === id)!;
  return !!row && !recording(e) && chord(e) === binding(row, saved);
}
