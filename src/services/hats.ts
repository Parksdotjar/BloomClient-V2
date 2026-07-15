import { invoke } from "@tauri-apps/api/core";

export type HatCatalogItem = {
  id: string;
  name: string;
  collection: string;
  modelRevision: string;
  textureRevision: string;
  previewRevision: string;
  offset: [number, number, number];
  scale: number;
  hideWithHelmet: boolean;
};

export type HatPreviewData = { dataUrl: string; revision: string };

export type HatAccountState = {
  cartIds: string[];
  collectionIds: string[];
  equippedHatId: string | null;
};

type RemoteHatAccountState = { collectionIds: string[]; equippedHatId: string | null };
type HatStorageDocument = { schemaVersion: 1; accounts: Record<string, HatAccountState> };

const STORAGE_KEY = "bloom-hats-v1";
const CATALOG_CACHE_MS = 15_000;
const ACCOUNT_CACHE_MS = 30_000;
const emptyState = (): HatAccountState => ({ cartIds: [], collectionIds: [], equippedHatId: null });
const accountKey = (accountId: string | null) => accountId?.replaceAll("-", "").toLowerCase() || "signed-out";
let catalogCache: { expiresAt: number; items: HatCatalogItem[] } | null = null;
let catalogRequest: Promise<HatCatalogItem[]> | null = null;
const accountCache = new Map<string, { expiresAt: number; state: HatAccountState }>();
const accountRequests = new Map<string, Promise<HatAccountState>>();

const readDocument = (): HatStorageDocument => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "") as HatStorageDocument;
    if (parsed?.schemaVersion === 1 && parsed.accounts && typeof parsed.accounts === "object") return parsed;
  } catch { /* A damaged local cache should never block the shop. */ }
  return { schemaVersion: 1, accounts: {} };
};

const sanitize = (value: Partial<HatAccountState> | undefined): HatAccountState => {
  const collectionIds = Array.isArray(value?.collectionIds) ? [...new Set(value.collectionIds.filter((id): id is string => typeof id === "string"))] : [];
  const cartIds = Array.isArray(value?.cartIds) ? [...new Set(value.cartIds.filter((id): id is string => typeof id === "string" && !collectionIds.includes(id)))] : [];
  const equippedHatId = typeof value?.equippedHatId === "string" && collectionIds.includes(value.equippedHatId) ? value.equippedHatId : null;
  return { cartIds, collectionIds, equippedHatId };
};

export const loadHatAccountState = (accountId: string | null) => sanitize(readDocument().accounts[accountKey(accountId)] || emptyState());

export const saveHatAccountState = (accountId: string | null, state: HatAccountState) => {
  const document = readDocument();
  const next = sanitize(state);
  const key = accountKey(accountId);
  document.accounts[key] = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  accountCache.set(key, { expiresAt: Date.now() + ACCOUNT_CACHE_MS, state: next });
  return next;
};

const listCatalog = () => {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return Promise.resolve(catalogCache.items);
  if (catalogRequest) return catalogRequest;
  catalogRequest = invoke<HatCatalogItem[]>("list_bloom_hats")
    .then((items) => {
      catalogCache = { expiresAt: Date.now() + CATALOG_CACHE_MS, items };
      return items;
    })
    .finally(() => { catalogRequest = null; });
  return catalogRequest;
};

const loadAccountState = (accountId: string | null) => {
  const local = loadHatAccountState(accountId);
  if (!accountId) return Promise.resolve(local);
  const key = accountKey(accountId);
  const cached = accountCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.state);
  const active = accountRequests.get(key);
  if (active) return active;
  const request = invoke<RemoteHatAccountState>("get_bloom_hat_account_state")
    .then((remote) => saveHatAccountState(accountId, { ...local, collectionIds: remote.collectionIds, equippedHatId: remote.equippedHatId }))
    .catch((error) => {
      if (cached || local.collectionIds.length || local.equippedHatId) return local;
      throw error;
    })
    .finally(() => { accountRequests.delete(key); });
  accountRequests.set(key, request);
  return request;
};

export const hatProvider = {
  listCatalog,
  loadPreviewData: (hatId: string) => invoke<HatPreviewData>("load_bloom_hat_preview_data", { hatId }),
  loadAccountState,
  addToCollection: (_accountId: string | null, hatIds: string[]) => invoke<void>("add_bloom_hats_to_collection", { hatIds }),
  setEquipped: (_accountId: string | null, hatId: string | null) => invoke<void>("set_bloom_equipped_hat", { hatId }),
};
