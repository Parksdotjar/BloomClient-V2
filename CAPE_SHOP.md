# Free Shop and owned Locker

Parks requested a free collection flow in October 2026: one Shop / Locker platform, a large featured cloak above a scrolling Shop grid, then a personal Locker for equipping. The implementation uses compact Cloaks / Capes / Skins controls inside Locker's collection heading instead of another full-width navigation shelf. The global sidebar and normal button styles stay unchanged. The new layout is awaiting visual review, not an explicitly approved reference.

## Behavior

- Shop lists published, public capes with Shop availability enabled. One owner-selected cape occupies the hero; the first available cape is the fallback. Search filters the collection below it.
- Add to Locker requires a Minecraft sign-in, records server ownership and reports success through the existing bottom bar. It does not auto-equip or navigate. In Locker opens that item for preview/equip.
- Locker lists only that account's collected or code-redeemed capes. Official Minecraft capes and locally imported skins retain their existing independent workflows. Shop/Locker refresh on focus and every 15 seconds while visible; cached data remains usable during refresh.
- Disabling Show in Shop ends collection availability while keeping owners' access. Archive disables the cape for everyone until restored. Restore retains ownership and the previous Shop visibility setting.
- Code-only capes cannot appear in Shop or be featured. Redemption remains one-use, account-bound, transactional and safe to retry for the original claimant.
- Anonymous users may browse Shop. Offline snapshots never pretend a claim succeeded; Add is disabled when the native bridge explicitly returns cached offline data.

## Storage and API

The existing VPS SQLite cape store remains authoritative. `cape_claims` is shared by free collection and code redemption. Additive `cape_shop` rows control availability; omitted rows default to available for existing public capes. `cape_shop_settings` holds one featured ID. `cape_migrations` records completed upgrades.

- `GET /v1/capes/shop`: public catalog, optional verified Minecraft authentication adds per-account `owned`; returns `featuredId`.
- `GET /v1/capes/locker`: verified Minecraft identity required; owned published capes only.
- `POST /v1/capes/claim`: verified Minecraft identity required; accepts `capeId`, ignores any supplied player UUID. A transaction rechecks publication/availability and inserts ownership once. An existing owner may safely retry after a drop ends. Archived capes remain unavailable.
- Existing `PUT /v1/capes/equipped` also records ownership when released launchers directly equip an available public cape. New clients collect first, then equip from Locker.
- Existing public catalog and equipped-player routes remain compatible with released clients and game renderers. Private or ended-drop texture lookups require entitlement; in-game equipped-player responses can still provide a short-lived texture lease so others can see a legitimately worn cape.
- Owner publishing accepts optional `shopListed` and `featured` booleans alongside existing revision validation. Legacy omitted settings are preserved. Code-only or unlisted capes cannot be featured. Client requests never receive owner credentials.

Native requests reuse existing token refresh, active-account guards and asset hydration. New disk caches are scoped to account (`cape-shop-v1-*`, `cape-locker-owned-v2-*`); the owned cache cannot read the old public-inclusive Locker snapshot. Failed network fallbacks are explicitly marked `offline`. Component keys, request generations and mutation guards prevent stale refreshes or account changes from overwriting successful claims.

## Upgrade and rollback

The one-time `owned-locker-v1` migration preserves currently equipped public capes as owned. Existing code claims remain intact; unclaimed code-only capes are never granted. Historical unequipped choices were not recorded, so this migration cannot recover them. Those players can collect currently available capes normally.

Deploy only the focused cosmetics API/store/owner-handler changes and Admin build. The working tree also contains unrelated unfinished emote integration; do not copy its server entry point or unshipped helper into production. Before replacing the image, retain a source/image backup and take an online SQLite backup. Verify existing cape IDs, artwork revisions and publication state remain identical after startup.

Database changes are additive. Prefer a forward fix. A rollback must retain ownership, code-only authorization and Shop availability enforcement: the earlier API image does not understand ended drops, and a pre-redemption image does not enforce private-code ownership. Never blindly restore an older database over new claims or roll back to an image that exposes restricted capes. If rollback is necessary, preserve those access rules in the previous application version and validate them against the current database first.

Backend/Admin deployment makes publication settings and claims available immediately. The full Shop UI is in client source and needs a separately authorized client release to reach installed launchers. Do not claim that deployment alone updates every client interface. The game renderer continues its existing equipped-texture polling.

## Verification

- `node --test backend/cosmetics/*.test.mjs`: real HTTP/SQLite checks for claim authentication, account isolation, concurrent/idempotent claims, featured selection, drop closure, private-code separation, legacy equip compatibility, archive/restore, persistence and migration.
- `tests/locker-ui.mjs`: existing loading/disabled-action reveal, skin/cape operations, preview selection, pagination, concurrent mutations, themes and motion preferences.
- Sibling `BloomAdmin/tests/cape-shop-ui.mjs`: Admin publication and feature controls through real local HTTP APIs, Shop claim/pending state, explicit equip, ended-drop ownership, account isolation, search and wardrobe navigation. The native bridge and Minecraft identity are fixtures; storage and APIs are real.
- Main client and Admin TypeScript/build checks and locked Cargo checks. Admin native packaging is separate from any client release.

Keep synthetic cape publication and redemption tests in isolated fixture databases. Production smoke checks should inspect the real catalog, owner settings and authorization failures without publishing test cosmetics or consuming real codes.

## Verified deployment — October 22, 2026

The focused cosmetics service and web Admin are deployed. Server backup: `/opt/bloom-backups/cape-shop-20261022-165003`. The production image passed all 14 combined cosmetics/content tests and is healthy. Live checks verified owner availability/feature metadata, public Shop filtering, anonymous ownership flags, claim/locker/redemption authentication and the new Admin asset. Existing cape IDs, artwork revisions and publication states were unchanged; no synthetic live cape or code claim was created.

The local standalone `BloomAdmin/Bloom Admin.exe` was rebuilt. Client and Admin TypeScript/build checks, both locked Cargo checks, the existing Locker UI regression, and Shop/redemption browser integration checks passed. Browser checks simulate the native bridge and Minecraft identity against real isolated HTTP/SQLite APIs. No new client version, release, tag, commit or push was created. The client UI still requires a separately authorized release for other users.
