import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { createCosmeticsApi } from "../backend/cosmetics/api.mjs";
import { ApiError } from "../backend/cosmetics/assets.mjs";
import { SqliteCosmeticsStore } from "../backend/cosmetics/sqlite-store.mjs";

const host = "127.0.0.1";
const port = 19192;
const previewToken = "local-preview-player";
const playerBytes = createHash("md5").update("OfflinePlayer:DelightPreview").digest();
playerBytes[6] = (playerBytes[6] & 0x0f) | 0x30;
playerBytes[8] = (playerBytes[8] & 0x3f) | 0x80;
const player = playerBytes.toString("hex");

export async function startLocalWings(root, viteHttpServer) {
  const { entries } = JSON.parse(await readFile(join(root, "public/delight-wings/catalog.json"), "utf8"));
  if (!entries.length || !viteHttpServer) return;

  const key = createHash("sha256").update(root).digest("hex").slice(0, 16);
  const store = new SqliteCosmeticsStore({
    directory: join(root, "node_modules/.cache", "delight-dev-wings-" + key),
    publicUrl: "https://local.invalid",
  });
  const api = createCosmeticsApi({
    store,
    verify: async token => {
      if (token === previewToken) return player;
      throw new ApiError(401, "sign_in_required");
    },
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://" + host);
    if (!/^\/v1\/(wings|hats)\//.test(url.pathname) || !(await api.handle(request, response, url.pathname, url))) {
      response.writeHead(404).end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    store.close();
    if (error.code !== "EADDRINUSE") throw error;
    for (const category of ["wings", "hats"]) {
      const expected = entries.filter(entry => (entry.slot === "hat") === (category === "hats"));
      if (!expected.length) continue;
      const response = await fetch(`http://${host}:${port}/v1/${category}/shop`, { signal: AbortSignal.timeout(2000) });
      const catalog = response.ok ? await response.json() : null;
      if (!expected.every(entry => catalog?.items?.some(item => item.id === entry.id && item.revision === entry.revision))) {
        throw new Error("Port 19192 is in use by a service that does not serve this checkout's cosmetics.");
      }
    }
    return;
  }

  server.once("close", () => store.close());
  viteHttpServer.once("close", () => {
    server.close();
    server.closeAllConnections();
  });
  try {
    for (const category of ["wings", "hats"]) {
      const collection = store[category];
      const offers = entries.filter(entry => (entry.slot === "hat") === (category === "hats"));
      if (!offers.length) continue;
      const previous = collection.equipped(player);
      const preview = offers.find(entry => entry.id === previous?.id) ?? offers[0];
      for (const entry of offers) {
        collection.stage(entry);
        collection.publish(entry);
        collection.claim(player, entry);
      }
      if (!collection.owns(player, preview.id)) {
        collection.claim(player, preview);
        collection.equip(player, { ...preview, colors: preview.defaults });
      } else if (previous && previous.id === preview.id && previous.revision !== preview.revision) {
        collection.equip(player, { ...preview, colors: previous.colors });
      }
    }
  } catch (error) {
    server.close();
    throw error;
  }
}
