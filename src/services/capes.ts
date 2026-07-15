export type CapeTexturePurpose = "card" | "detail" | "game";

export type CapeCatalogItem = {
  id: string;
  name: string;
  collection: string;
  textureRevision: string;
};

export type CapeTextureLease = {
  url: string;
  expiresAt: number;
  revision: string;
};

export type CapeTextureData = {
  dataUrl: string;
  revision: string;
};

export type CapeAccountState = {
  cartIds: string[];
  collectionIds: string[];
  equippedCapeId: string | null;
};

export interface CapeProvider {
  listCatalog(accountId: string | null): Promise<CapeCatalogItem[]>;
  leaseTexture(capeId: string, purpose: CapeTexturePurpose): Promise<CapeTextureLease>;
  loadTextureData(capeId: string): Promise<CapeTextureData>;
  addToCollection(accountId: string | null, capeIds: string[]): Promise<void>;
  setEquippedCape(accountId: string | null, capeId: string | null): Promise<void>;
}

type CapeStorageDocument = {
  schemaVersion: 1;
  accounts: Record<string, CapeAccountState>;
};

const CAPE_STORAGE_KEY = "bloom-capes-v1";
const CAPE_API_URL = "https://api.north.bloomclient.org/minecraft";
const CAPE_CATALOG_CACHE_MS = 15_000;
let capeCatalogCache: { expiresAt: number; items: CapeCatalogItem[] } | null = null;
let capeCatalogRequest: Promise<CapeCatalogItem[]> | null = null;

const responseJson = async <T>(response: Response, label: string): Promise<T> => {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
};

const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(reader.error || new Error("Unable to read the cape texture."));
  reader.readAsDataURL(blob);
});

export const emptyCapeAccountState = (): CapeAccountState => ({
  cartIds: [],
  collectionIds: [],
  equippedCapeId: null,
});

const storageAccountId = (accountId: string | null) => accountId?.trim() || "local-guest";

const stringList = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]
  : [];

const normalizeState = (value: unknown): CapeAccountState => {
  if (!value || typeof value !== "object") return emptyCapeAccountState();
  const candidate = value as Partial<CapeAccountState>;
  const collectionIds = stringList(candidate.collectionIds);
  const cartIds = stringList(candidate.cartIds).filter(id => !collectionIds.includes(id));
  const equippedCapeId = typeof candidate.equippedCapeId === "string" && collectionIds.includes(candidate.equippedCapeId)
    ? candidate.equippedCapeId
    : null;
  return { cartIds, collectionIds, equippedCapeId };
};

const readDocument = (): CapeStorageDocument => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CAPE_STORAGE_KEY) || "null") as Partial<CapeStorageDocument> | null;
    if (parsed?.schemaVersion === 1 && parsed.accounts && typeof parsed.accounts === "object") {
      return { schemaVersion: 1, accounts: parsed.accounts as Record<string, CapeAccountState> };
    }
  } catch {
    // A damaged local collection should not stop Bloom from opening.
  }
  return { schemaVersion: 1, accounts: {} };
};

export function loadCapeAccountState(accountId: string | null): CapeAccountState {
  const document = readDocument();
  return normalizeState(document.accounts[storageAccountId(accountId)]);
}

export function saveCapeAccountState(accountId: string | null, state: CapeAccountState): CapeAccountState {
  const document = readDocument();
  const normalized = normalizeState(state);
  document.accounts[storageAccountId(accountId)] = normalized;
  localStorage.setItem(CAPE_STORAGE_KEY, JSON.stringify(document));
  return normalized;
}

class BloomCapeProvider implements CapeProvider {
  async listCatalog(_accountId: string | null): Promise<CapeCatalogItem[]> {
    if (capeCatalogCache && capeCatalogCache.expiresAt > Date.now()) return capeCatalogCache.items;
    if (capeCatalogRequest) return capeCatalogRequest;
    capeCatalogRequest = (async () => {
      try {
        return await invoke<CapeCatalogItem[]>("list_bloom_capes");
      } catch (nativeError) {
        try {
          const response = await fetch(`${CAPE_API_URL}/v1/capes`, { cache: "no-store" });
          const document = await responseJson<{ items: CapeCatalogItem[] }>(response, "Bloom's cape catalog");
          return document.items;
        } catch {
          throw nativeError;
        }
      }
    })().then((items) => {
      capeCatalogCache = { expiresAt: Date.now() + CAPE_CATALOG_CACHE_MS, items };
      return items;
    }).finally(() => { capeCatalogRequest = null; });
    return capeCatalogRequest;
  }

  async leaseTexture(capeId: string, _purpose: CapeTexturePurpose): Promise<CapeTextureLease> {
    try {
      return await invoke<CapeTextureLease>("lease_bloom_cape_texture", { capeId });
    } catch (nativeError) {
      try {
        const response = await fetch(`${CAPE_API_URL}/v1/capes/${encodeURIComponent(capeId)}/texture`, { cache: "no-store" });
        return await responseJson<CapeTextureLease>(response, "Bloom's cape texture lease");
      } catch {
        throw nativeError;
      }
    }
  }

  async loadTextureData(capeId: string): Promise<CapeTextureData> {
    try {
      return await invoke<CapeTextureData>("load_bloom_cape_texture_data", { capeId });
    } catch (nativeError) {
      try {
        const lease = await this.leaseTexture(capeId, "card");
        const response = await fetch(lease.url, { cache: "no-store" });
        if (!response.ok) throw new Error(`Bloom's cape texture returned HTTP ${response.status}.`);
        return { dataUrl: await blobDataUrl(await response.blob()), revision: lease.revision };
      } catch {
        throw nativeError;
      }
    }
  }

  async addToCollection(_accountId: string | null, _capeIds: string[]): Promise<void> {
    // Local-only until the authenticated Supabase collection adapter is connected.
  }

  async setEquippedCape(_accountId: string | null, capeId: string | null): Promise<void> {
    await invoke("set_bloom_equipped_cape", { capeId });
  }
}

export const capeProvider: CapeProvider = new BloomCapeProvider();
import { invoke } from "@tauri-apps/api/core";
