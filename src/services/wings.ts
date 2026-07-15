import { invoke } from "@tauri-apps/api/core";

export type WingCatalogItem = {
  id: string;
  name: string;
  collection: string;
  modelRevision: string;
  textureRevision: string;
  previewRevision: string;
  offset: [number, number, number];
  scale: number;
  hideCape: boolean;
};

export type WingPreviewData = { dataUrl: string; revision: string };

export type WingAccountState = {
  cartIds: string[];
  collectionIds: string[];
  equippedWingId: string | null;
};

type RemoteWingAccountState = { collectionIds: string[]; equippedWingId: string | null };
type WingStorageDocument = { schemaVersion: 1; accounts: Record<string, WingAccountState> };

const STORAGE_KEY = "bloom-wings-v1";
const CATALOG_CACHE_MS = 15_000;
const ACCOUNT_CACHE_MS = 30_000;
const emptyState = (): WingAccountState => ({ cartIds: [], collectionIds: [], equippedWingId: null });
const accountKey = (accountId: string | null) => accountId?.replaceAll("-", "").toLowerCase() || "signed-out";
let catalogCache: { expiresAt: number; items: WingCatalogItem[] } | null = null;
let catalogRequest: Promise<WingCatalogItem[]> | null = null;
const accountCache = new Map<string, { expiresAt: number; state: WingAccountState }>();
const accountRequests = new Map<string, Promise<WingAccountState>>();

const readDocument = (): WingStorageDocument => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "") as WingStorageDocument;
    if (parsed?.schemaVersion === 1 && parsed.accounts && typeof parsed.accounts === "object") return parsed;
  } catch { /* A damaged local cache should never block the shop. */ }
  return { schemaVersion: 1, accounts: {} };
};

const sanitize = (value: Partial<WingAccountState> | undefined): WingAccountState => {
  const collectionIds = Array.isArray(value?.collectionIds) ? [...new Set(value.collectionIds.filter((id): id is string => typeof id === "string"))] : [];
  const cartIds = Array.isArray(value?.cartIds) ? [...new Set(value.cartIds.filter((id): id is string => typeof id === "string" && !collectionIds.includes(id)))] : [];
  const equippedWingId = typeof value?.equippedWingId === "string" && collectionIds.includes(value.equippedWingId) ? value.equippedWingId : null;
  return { cartIds, collectionIds, equippedWingId };
};

export const loadWingAccountState = (accountId: string | null) => sanitize(readDocument().accounts[accountKey(accountId)] || emptyState());

export const saveWingAccountState = (accountId: string | null, state: WingAccountState) => {
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
  catalogRequest = invoke<WingCatalogItem[]>("list_bloom_wings")
    .then((items) => {
      catalogCache = { expiresAt: Date.now() + CATALOG_CACHE_MS, items };
      return items;
    })
    .finally(() => { catalogRequest = null; });
  return catalogRequest;
};

const loadAccountState = (accountId: string | null) => {
  const local = loadWingAccountState(accountId);
  if (!accountId) return Promise.resolve(local);
  const key = accountKey(accountId);
  const cached = accountCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.state);
  const active = accountRequests.get(key);
  if (active) return active;
  const request = invoke<RemoteWingAccountState>("get_bloom_wing_account_state")
    .then((remote) => saveWingAccountState(accountId, { ...local, collectionIds: remote.collectionIds, equippedWingId: remote.equippedWingId }))
    .catch((error) => {
      if (cached || local.collectionIds.length || local.equippedWingId) return local;
      throw error;
    })
    .finally(() => { accountRequests.delete(key); });
  accountRequests.set(key, request);
  return request;
};

export const wingProvider = {
  listCatalog,
  loadPreviewData: (wingId: string) => invoke<WingPreviewData>("load_bloom_wing_preview_data", { wingId }),
  loadAccountState,
  addToCollection: (_accountId: string | null, wingIds: string[]) => invoke<void>("add_bloom_wings_to_collection", { wingIds }),
  setEquipped: (_accountId: string | null, wingId: string | null) => invoke<void>("set_bloom_equipped_wing", { wingId }),
};
