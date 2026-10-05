# Free capes — implementation checkpoint

## Locations

- Client/backend/mod: `C:/Users/Parks/Documents/BloomClient-Capes`, branch `codex/free-capes`.
- Private standalone app: `C:/Users/Parks/Documents/Bloom-Cape-Studio`.
- Installed app: `C:/Users/Parks/AppData/Local/Bloom Cape Studio/bloom-cape-studio.exe`.
- Original dirty worktree preserved. No release tooling, secrets, tags, version bumps, commits or pushes used.

## VPS checkpoint — October 3, 2026

- Replaced the suspended Pterodactyl origin with an owner-controlled Ubuntu 24.04
  VPS at `83.147.217.229`. Cloudflare proxying now targets that address and the
  legacy Origin Rule uses standard HTTPS port 443 instead of port 25604.
- Owner explicitly approved new storage on this VPS. Implemented a SQLite adapter
  with private PNG blobs, atomic drafts/publication, persistent account choices,
  expiring hashed asset leases and invalidation on revision changes/unpublish.
- Installed Docker and Caddy, built the API image on the VPS, and initialized
  `/var/lib/bloom/capes/capes.sqlite` privately outside the source/image tree.
  The restricted container is managed by `bloom-api.service`; Caddy manages TLS.
- Public `/minecraft/health` returns 200 through Cloudflare with `cosmetics:true`;
  capabilities and the currently empty cape catalog respond publicly. Owner routes
  reject unsigned requests. Existing catalog
  functionality remains active.
- Readiness checks now disable just capes when configuration/storage fails, so a
  cape configuration mistake does not stop the existing catalog at startup.
- Re-ran client typecheck/build and locked Rust check: passed (bundle-size warning).
- ParksVAL is the only publishing owner (`2790c9887660460491068944f4ea2dcb`).
  The VPS uses private SQLite storage and the cosmetics service is active.
  Real Studio publishing and two-player Minecraft tests are still required;
  local mock-identity tests are not proof of Microsoft sign-in or game rendering.
- No Supabase migration or database credentials are needed for the approved VPS
  SQLite mode. The Supabase adapter remains available for other deployments.

## Implemented locally

- Additive Supabase migration/API: verified Minecraft identity, publishing allowlist, immutable draft uploads, transactional publication, unpublish, free equip/unequip, signed texture leases, scoped sessions and badge preferences.
- PNG checksum/bounded decompression and atlas/memory validation; automated API lifecycle and authorization tests.
- Locker with account-specific backend operations, nine-item pagination, one focused 3D preview, and distinct loading/empty/offline states. Integration and badge controls live in a dedicated Cosmetics Settings category using Bloom's shared toggles.
- Managed renderer build/checksum embedding and reconciliation. Instance listing no longer deletes cosmetics. Unknown duplicate JARs receive repair errors rather than silent deletion.
- Cape-only Fabric 1.21.11 renderer, vanilla elytra preservation, single-label badge hook, bounded texture downloads, memory accounting/disposal, backoff and static fallback.
- Redesigned Tauri Cape Studio around direct image positioning for separate cape and exact-shape elytra cutouts. It provides draggable positioning, smooth zoom, 256-to-4096 texture output, nearest-border edge extrusion, optional mirrored reverse placement, live previews, local drafts, and two-step draft deletion. Painting and manual UV tools remain intentionally removed.
- Studio publishing no longer depends on a third-party Microsoft application registration. It exchanges a private password for a short-lived server session, stores only that session in Windows Credential Manager, and never embeds the password in the executable or project data.

## Verified

- Backend: `node --test backend/cosmetics/api.test.mjs` — 4 tests passed, including invalid/valid Studio password exchange and owner-route authorization.
- Client: typecheck, production frontend build, locked Rust check passed.
- Fabric: remapped JAR build passed.
- Studio: frontend/native checks, release executable and NSIS installer passed; the latest installer was installed and the native app launched successfully. Editor, preview and saved draft state were previously observed. This remains a startup smoke test, not full publishing acceptance.
- Live launcher: the redesigned Locker and Cosmetics Settings section were inspected in the real Tauri dev client. The managed renderer JAR and ownership manifest were verified in the visible Fabric 1.21.11 instance; unsupported/hidden instances were untouched.

## Activation requirements

The live API is reachable, the backend/private database are deployed, and cosmetics
are active for integration testing. The launcher enables the integration unless an
emergency build explicitly sets `BLOOM_COSMETICS_ENABLED=false`. Do not publish a
production client update until the tests below pass. Use `backend/CAPES_VPS_DEPLOYMENT.md`
for the approved SQLite configuration; the Supabase requirements below apply only
if switching back to that adapter.

1. Privately configure `BLOOM_CAPE_STUDIO_PASSWORD_HASH` on the VPS and restart the API. Connect the installed Studio once and verify its saved Windows Credential Manager session survives an app restart. The password and hash must never enter source control.
2. Publish an owned test asset, equip as account A and observe as account B in Fabric 1.21.11. Test animation, revision changes, unpublish, account switching, badge hiding/expiry, offline behavior, disabled/locked/duplicate JARs and new/imported instances.
3. Inspect ranks, teams, scoreboard labels, sneaking, Sodium/Iris and third-party nametag renderers. Measure frame-time and memory with many visible animated capes. No production release until passed.

## Outstanding work / limits

- SQLite lifecycle tests pass on the VPS; live authenticated publishing and multiplayer remain unverified. Supabase SQL remains untested and is not used by the VPS adapter.
- Dedicated filesystem crash-recovery tests, cross-process locking and externally launched Minecraft detection remain outstanding. Current installer locking coordinates one launcher process only.
- Session handoff uses child-process environment, not command arguments or a token file. Session credentials expire after 12 hours; longer sessions need renewal. Expired database sessions need scheduled pruning.
- Runtime asset hash enforcement, nametag-mod compatibility and load testing need further hardening/verification.
- Static artwork now has a visual crop/positioning surface and live equipment previews. Animation import still uses normalized trim/crop controls; undo after conversion, close-during-autosave, keyboard canvas interaction and interrupted publication need further acceptance work.
- SQLite drafts commit images and metadata atomically; the Supabase adapter still needs orphan cleanup. Aggregate ingress/memory limits need more work before production. Rate limiting is currently per API process.
- Locker thumbnails crop UV textures rather than using generated thumbnails. Lease renewal, cache behavior, background/theme parity and reduced-motion rendering need the final UI pass.
- Frontend builds warn about large bundles; npm reports vulnerabilities requiring an audit before release.

This is a local integration build, not a completed production rollout. Historical restoration guides are background, not proof that capes are currently live.
