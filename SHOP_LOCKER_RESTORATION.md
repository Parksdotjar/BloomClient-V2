# Shop and Locker restoration blueprint

> Integration update: free Locker, backend endpoints, Cape Studio and renderer restoration now exist locally on `codex/free-capes`. Production remains disabled. Read `CAPES_IMPLEMENTATION_STATUS.md` for verified checks and remaining work. Historical Shop/cart/ownership designs below are superseded by free direct equip; no purchase or claim step will return.

## Current status

Shop and Locker are intentionally removed from the shipped Bloom Client for the VPS migration. The navigation entries, pages, frontend services, native commands, automatic cosmetics-mod build, automatic JAR bundling, and automatic JAR injection are not part of the active client.

The renderer source in `bloom-cosmetics-mod/`, the manual builder in `scripts/build-cosmetics-mod.mjs`, and the detailed authoring guides remain in this repository as dormant restoration material. The client also removes previously injected Bloom-owned `bloom-cosmetics-*.jar` files from an instance when that instance is inspected or prepared, preventing a retired backend integration from silently remaining active.

Do not decommission the current cosmetics service until its database records, private objects, manager configuration, and signing/authentication secrets have been exported. The cosmetics backend and the manager application are not implemented in this repository. The included `backend/` service is only the Modrinth catalog adapter.

## What the Locker did

Locker was a local Minecraft skin library plus an authenticated “apply skin” action.

- Skin files lived in Bloom's app-data `skins/` directory. Metadata lived in `skins.json`.
- Imported images were validated as PNG files, limited to 4 MB, and required Minecraft-compatible proportions: a width divisible by 64 and a height equal to either the width or half the width. Supported widths were 64–1024 pixels.
- Files were written through a temporary `.part` file and renamed after a successful write.
- The page generated small 2D thumbnails and opened a larger `skinview3d` preview. The preview supported classic/slim arms and optional automatic rotation.
- Applying a skin refreshed the active Microsoft/Minecraft session if needed, then sent the PNG and selected variant to `https://api.minecraftservices.com/minecraft/profile/skins`.
- The selected arm model was a per-Minecraft-profile UI preference. The actual imported skin library was local to the Bloom installation.

To restore Locker, recreate the page and native commands for listing, saving, opening, and applying local skins; restore `skinview3d`; then test PNG validation, atomic writes, classic/slim variants, expired-token refresh, account switching, and narrow layouts.

## What the Shop did

Shop was the launcher UI for four cosmetic catalogs: capes, hats, wings, and bracelets. It displayed public catalog data and previews, kept a local cart, and used the active Minecraft identity for owned/equipped state.

The launcher did not render hats, wings, or bracelets as live 3D models in the Shop. The manager generated preview PNGs and the launcher requested short-lived preview leases. Cape cards used the cape texture and `skinview3d` for their launcher preview. In-game rendering was performed by the separate Fabric mod described in `COSMETICS_RENDERING_ARCHITECTURE.md`.

The old launcher cached catalogs for about 15 seconds, preview/texture leases for about 5 minutes, and authenticated account state for about 30 seconds. Local account caches used these keys:

- `bloom-capes-v1`
- `bloom-hats-v1`
- `bloom-wings-v1`
- `bloom-bracelets-v1`

Those records were indexed by normalized Minecraft account ID. The cart was local. Hats, wings, and bracelets synchronized collection and equipped state with the backend. Cape equip synchronized with the backend, while the launcher-side cape collection action was only a local placeholder and must not be treated as the authoritative ownership implementation.

## Required VPS API contract

The prior public base URL was `https://api.north.bloomclient.org/minecraft`. A restored service can keep that URL behind Cloudflare or introduce a new one, but the launcher, Fabric mod, and deployment configuration must all agree.

Public catalog and asset-lease routes:

- `GET /v1/capes`
- `GET /v1/capes/:id/texture`
- `GET /v1/capes/:id/colorways/:colorwayId/texture`
- `GET /v1/hats`, `GET /v1/wings`, `GET /v1/bracelets`
- `GET /v1/{hats|wings|bracelets}/:id/preview`
- `GET /v1/{hats|wings|bracelets}/:id/colorways/:colorwayId/preview`

Authenticated launcher routes used a Minecraft access token as a Bearer token:

- `GET /v1/{hats|wings|bracelets}/me`
- `PUT /v1/{hats|wings|bracelets}/collection`
- `PUT /v1/{capes|hats|wings|bracelets}/equipped`

Collection bodies used `hatIds`, `wingIds`, or `braceletIds`. Equipped bodies used the relevant cosmetic ID and optional `colorwayId`; bracelets also stored `arm`. The launcher retried once after refreshing an expired Minecraft credential on an HTTP 401.

Public Fabric lookup routes:

- `GET /v1/{capes|hats|wings|bracelets}/equipped?uuids=<comma-separated UUIDs>`

The response must provide only the records needed to render observed players plus short-lived object URLs. Private bucket credentials and service-role/database secrets must never be shipped to either client.

## Catalog data that must survive migration

All cosmetics use stable IDs, display names, collection names, revision identifiers, publication state, and colorways. A colorway includes an ID, slug, name, display color, texture revision, optional preview revision, and default flag.

Additional required fields:

- Hats: model/texture/preview revisions, offset, scale, `hideWithHelmet`, and colorways.
- Wings: model/texture/preview revisions, offset, scale, `hideCape`, and colorways.
- Bracelets: model/texture/preview revisions, offset, rotation, pivot, scale, colorways, and the equipped arm.
- Capes: texture revision, colorways, and optional animation metadata/atlas revision.

The precise old database schema is not present here. On the VPS, the logical data model needs catalogs, colorways, accounts, collections/ownership, equipped state, immutable asset revisions, cape-animation metadata, publication state, and manager ownership/audit fields. UUIDs should have one canonical normalized representation so Java, Rust, JavaScript, Microsoft profiles, and database keys cannot disagree.

## Manager and other-app responsibilities

The external manager is the authoring/publishing app. It should:

1. Import and validate textures, models, and animations.
2. Preserve model groups, attachment parts, pivots, and animation metadata.
3. Generate the launcher preview PNGs for hats, wings, and bracelets.
4. Convert animated capes to a static fallback plus a frame atlas.
5. Upload immutable, revisioned objects to private storage.
6. Write catalog and publication metadata to the VPS database.
7. Invalidate or version caches without replacing an object behind an existing revision.

The Bloom launcher consumes catalogs, previews, collection state, and equip actions. The Fabric mod consumes public equipped-state batches plus leased model/texture/atlas URLs. Minecraft itself supplies stable player identities and the render skeleton/model parts to which Bloom cosmetics attach.

## Safe VPS restoration order

1. Export the old database, private object storage, generated previews, animation atlases, and manager configuration.
2. Build the VPS database and private object storage. Keep database and storage admin credentials server-side.
3. Implement Minecraft-token verification and every API route above.
4. Import data and assets without changing stable cosmetic IDs or revisions.
5. Run contract tests for anonymous catalogs, authenticated ownership/equip, batched UUID lookup, missing objects, expired leases, and token refresh.
6. Point the Cloudflare API hostname/path to the VPS and verify TLS, caching, request-size limits, and rate limits.
7. Update the Fabric `API_BASE`, restore the launcher's service layer/native bridge, and test against a staging hostname.
8. Build the Fabric JAR, restore it as a Tauri resource, and deliberately re-enable per-instance injection.
9. Restore Shop and Locker navigation only after end-to-end tests pass.

## Release test matrix

- Switch Microsoft accounts and verify collection/equipped state cannot bleed between accounts.
- Join a server with local and remote players; verify UUID normalization and player churn.
- Test default and non-default colorways, missing assets, revised assets, and expired leases.
- Test helmet-hidden hats, cape-hidden wings, both bracelet arms, wing pivots, and animated cape fallback.
- Test offline startup and a temporarily unavailable VPS without crashing Minecraft.
- Test low-performance mode, a full 100-player observation set, and repeated world/server changes.
- Test Locker import/apply with classic and slim skins and an expired Microsoft token.

See `COSMETICS_RENDERING_ARCHITECTURE.md`, `BLOOM_ANIMATED_CAPES_GUIDE.md`, `BLOOM_ANIMATED_MINI_WINGS_GUIDE.md`, `ANIMATED_COSMETICS_GUIDE.md`, and `CUSTOM_HALO_HAT_GUIDE.md` for the rendering and authoring details.
