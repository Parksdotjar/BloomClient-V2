import { cosmeticsFromEnvironment, createCosmeticsApi } from './api.mjs';

// A cape configuration problem must not turn a catalog restart into an outage.
// Never print caught errors: provider responses can contain deployment details.
export async function initializeCosmetics(env = process.env, report = console.warn) {
  try {
    const api = cosmeticsFromEnvironment(env);
    if (api.enabled) await api.checkReadiness();
    return api;
  } catch {
    report('Cape integration is unavailable; catalog remains enabled. Run the cape deployment preflight.');
    return createCosmeticsApi();
  }
}
