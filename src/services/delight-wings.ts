import { strFromU8, unzipSync } from "fflate";
import { invoke } from "./invoke";

export type CosmeticCategory = "wings" | "hats" | "back";
export type Tint = "left" | "right" | "trim" | "rightOuter" | "plunger";
export type WingColors = Record<Exclude<Tint, "rightOuter" | "plunger">, string> & { rightOuter?: string; plunger?: string };
export type WingRevision = { id: string; revision: string; name: string; defaults: WingColors; previewRevision?: string; slot?: "hat" | "back" };
export type WingOffer = WingRevision & { owned: boolean; configured?: WingColors | null };
export type EquippedWing = Pick<WingRevision, "id" | "revision"> & { colors: WingColors };
export type WingCatalog = { items: WingOffer[]; equipped?: EquippedWing | null; localPreview?: boolean };
export type WingBatch = { matrix: number; texture: string; tint: Tint | "fixed"; color?: string; shineRow?: number; vertices: number[] };
export type WingRuntime = {
  id: string; duration: number; slot?: "hat" | "back";
  frames: { time: number; matrices: number[][] }[];
  batches: WingBatch[];
};
export const cosmeticColorLabels = {
  back: { left: "Needle tip", right: "Nozzle", trim: "Casing", rightOuter: "Liquid", plunger: "Plunger" },
  wings: { left: "Left wing", right: "Right wing", trim: "Metal trim" },
  hats: { left: "Left inner ear", trim: "Left outer ear", right: "Right inner ear", rightOuter: "Right outer ear" },
};
const assets = "./delight-wings/";

export function wingRequest<T>(method: string, endpoint: string, accountId?: string, body?: unknown, category: CosmeticCategory = "wings") {
  return invoke<T>("cosmetics_request", { method, path: "/v1/" + (category === "back" ? "wings" : category) + "/" + endpoint, accountId: accountId ?? null, body: body ?? null });
}

let installedRequest: Promise<Map<string, WingRevision>> | undefined;
export function installedWings() {
  installedRequest ??= fetch(assets + "catalog.json").then(async response => {
    if (!response.ok) throw new Error("The bundled wing index could not be opened.");
    const { format, entries }: { format: number; entries: WingRevision[] } = await response.json();
    if (format !== 1 || !Array.isArray(entries)) throw new Error("Unsupported wing index.");
    return new Map(entries.map(item => [item.id + ":" + item.revision, item]));
  }).catch(error => { installedRequest = undefined; throw error; });
  return installedRequest;
}

function revisionPath(revision: string) {
  if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid wing revision.");
  return assets + revision;
}

export function wingThumbnail(item: WingRevision) {
  const hash = item.previewRevision;
  return revisionPath(item.revision) + ".png" + (hash && /^[a-f0-9]{64}$/.test(hash) ? "?v=" + hash : "");
}

export async function readWingRuntime(item: WingRevision, signal: AbortSignal) {
  const response = await fetch(revisionPath(item.revision) + ".zip", { signal });
  if (!response.ok) throw new Error("The wing preview is unavailable.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("The wing preview is too large.");
  const files = unzipSync(new Uint8Array(bytes), { filter: item => item.name !== "preview.png" });
  const model: WingRuntime = JSON.parse(strFromU8(files["wing.json"]));
  if (model.id !== item.id || model.slot !== item.slot || !model.frames.length) throw new Error("The wing preview has a different revision.");
  return { model, files };
}
