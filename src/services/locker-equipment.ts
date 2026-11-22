import { useSyncExternalStore } from "react";

type Slot = { choice?: string | null; saved?: string | null; revision: number; active: boolean; timer?: number; after: number };
const slots = new Map<string, Slot>();
const listeners = new Set<() => void>();
const publish = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function equipmentSlot(key: string) {
  let slot = slots.get(key);
  if (!slot) { slot = {revision: 0, active: false, after: 0}; slots.set(key, slot); }
  return slot;
}
export function useEquipment(key: string) {
  return useSyncExternalStore(subscribe, () => equipmentSlot(key).choice);
}
export function readEquipment(key: string, revision: number, saved: string | null) {
  const slot = equipmentSlot(key);
  if (revision !== slot.revision || slot.active || slot.timer !== undefined) return;
  slot.saved = slot.choice = saved;
  publish();
}
export function chooseEquipment(key: string, choice: string | null, save: (id: string | null) => Promise<void>, fail: (message: string) => void) {
  const slot = equipmentSlot(key);
  if (slot.choice === choice) return;
  slot.choice = choice;
  slot.revision++;
  publish();
  const schedule = () => {
    clearTimeout(slot.timer);
    if (slot.active) return;
    slot.timer = window.setTimeout(async () => {
      slot.timer = undefined;
      const target = slot.choice;
      if (target === undefined || target === slot.saved) return;
      slot.active = true;
      try { await save(target); slot.saved = target; slot.after = 0; }
      catch (error) {
        if (/rate limit|too many|429/i.test(String(error))) slot.after = Date.now() + 60_000;
        else if (slot.choice === target) { slot.choice = slot.saved; fail(String(error)); publish(); }
      } finally {
        slot.active = false;
        slot.revision++;
        if (slot.choice !== slot.saved) schedule();
      }
    }, Math.max(850, slot.after - Date.now()));
  };
  schedule();
}
