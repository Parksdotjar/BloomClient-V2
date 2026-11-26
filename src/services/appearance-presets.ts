import { normalizeAccent } from "./accent-preferences";
import type { SettingsState } from '../main';

export const appearanceKeys = ['theme', 'oledBackground', 'oledForeground', 'lightBackground', 'lightForeground', 'interfaceFont', 'interfaceSize', 'spacing', 'accent', 'customAccent', 'lastCustomAccent', 'oledSidebar', 'lightSidebar', 'oledPanel', 'lightPanel', 'oledIsland', 'lightIsland', 'dividerStrength'] as const;
export type Appearance = Pick<SettingsState, typeof appearanceKeys[number]>;
export type AppearancePreset = { id: string; name: string; appearance: Appearance; created: number };
export function normalizeIslandColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "";
}
export function captureAppearance(settings: SettingsState): Appearance {
  return structuredClone(Object.fromEntries(appearanceKeys.map(key => [key, settings[key]]))) as Appearance;
}
export function sameAppearance(a: Appearance, b: Appearance): boolean {
  // Earlier presets only compare and restore the controls they originally saved.
  return appearanceKeys.every(key => {
    if (!(key in b)) return true;
    return a[key] === b[key];
  });
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bloom-appearance-presets', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('presets', { keyPath: 'id' });
    request.onerror = () => reject(new Error('Could not open saved appearances.'));
    request.onblocked = () => reject(new Error('Close other Delight windows and try again.'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('presets', mode);
      const request = run(transaction.objectStore('presets'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(new Error('Could not save appearances. Your existing presets are unchanged.'));
      transaction.onerror = () => reject(new Error('Appearance storage is unavailable or full.'));
    });
  } finally { db.close(); }
}
export async function readPresets() {
  const presets = await transact<AppearancePreset[]>('readonly', store => store.getAll());
  return presets.map(({ id, name, created, appearance }) => {
    const normalized = normalizeAccent(appearance);
    for (const key of ["oledIsland", "lightIsland"] as const) {
      if (key in normalized) normalized[key] = normalizeIslandColor(normalized[key]);
    }
    // Older presets can omit newer controls. Apply only supported keys they contain.
    const supported = appearanceKeys.filter(key => key in normalized);
    return { id, name, created, appearance: Object.fromEntries(supported.map(key => [key, normalized[key]])) as Appearance };
  });
}
export const writePreset = (preset: AppearancePreset) => transact('readwrite', store => store.put(preset));
export const deletePreset = (id: string) => transact('readwrite', store => store.delete(id));
