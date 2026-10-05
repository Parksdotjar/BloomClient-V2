import { SqliteCosmeticsStore } from './sqlite-store.mjs';

// Provision only private local storage; do not enable routes or publish assets.
// Usage: node cosmetics/provision-vps.mjs /absolute/private/data/directory
let store;
try {
  store = new SqliteCosmeticsStore({directory:process.argv[2],publicUrl:'https://api.north.bloomclient.org/minecraft'});
  await store.checkReadiness();
  console.log('Private cape database initialized and checked. Cosmetics remain disabled.');
} catch {
  console.error('Storage provisioning failed. Check the absolute directory, permissions, runtime and available disk space.');
  process.exitCode=1;
} finally { store?.close(); }
