import type { SettingsState } from '../main';

export const appearanceKeys = ['theme', 'accent', 'accentMode', 'accentStops', 'accentDuration', 'accentIntensity', 'customBackground', 'backgroundMode', 'liveBackground', 'backgroundOpacity', 'settingsPanelDarkness', 'sidebarSurfaceDarkness', 'sidebarElementDarkness', 'sidebarElementFrost', 'sidebarOutline', 'sidebarTextColor', 'sidebarFrost', 'elementFrost', 'sidebarOpacity', 'elementOpacity'] as const;
export type Appearance = Pick<SettingsState, typeof appearanceKeys[number]>;
export type AppearancePreset = { id: string; name: string; appearance: Appearance; image: string | null; created: number };
export function captureAppearance(settings: SettingsState): Appearance {
  return structuredClone(Object.fromEntries(appearanceKeys.map(key => [key, settings[key]]))) as Appearance;
}
export function sameAppearance(a: Appearance, b: Appearance): boolean {
  // Stop IDs are editor identities and are normalized again at startup.
  const comparable = (value: Appearance) => ({ ...value, accentStops: value.accentStops.map(({ color, position }) => ({ color, position })) });
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

// Images belong in IndexedDB rather than the small localStorage settings quota.
// Each record owns its image, so changing the current wallpaper cannot alter a preset.
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bloom-appearance-presets', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('presets', { keyPath: 'id' });
    request.onerror = () => reject(new Error('Could not open saved appearances.'));
    request.onblocked = () => reject(new Error('Close other Bloom windows and try again.'));
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
export const readPresets = () => transact<AppearancePreset[]>('readonly', store => store.getAll());
export const writePreset = (preset: AppearancePreset) => transact('readwrite', store => store.put(preset));
export const deletePreset = (id: string) => transact('readwrite', store => store.delete(id));
