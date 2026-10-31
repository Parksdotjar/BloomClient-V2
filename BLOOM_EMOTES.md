# Bloom emotes: start here

Updated October 18, 2026. Branch: `codex/emote-system`. Bloom remains 1.1.8; the cosmetics mod is 1.6.0. No client release, push, tag, or production deployment has occurred.

## Implemented behavior

Hold **B** in Minecraft to open the OLED-black wheel, point toward an emote, and release B to play it and close. Selection wedges extend beyond the visible circle to the screen edges; visual separators do not create dead hit zones. Escape cancels. Releasing over an empty slot closes without playing; the center stops existing playback. Click or **1–8** also selects; arrows/Enter navigate; scroll or Page Up/Down changes pages. **C** toggles auto third person. The binding remains configurable in Minecraft Controls. Repeated B key events do not toggle or reopen the wheel while held.

The nine starter animations have been removed from the active catalog. Empty libraries build and open correctly. Send your own **Wave** from Creator with ID `wave`; if it is the only authored folder, it is the only emote shipped. No demo generator runs during export or build. Ordinary emotes cancel on movement, jump, attack, item use, damage, incompatible poses, focus loss, and world changes. Traversal loops persist through movement/jumping and idle until the next B press; death, spectator/mounted/swimming/gliding states and world changes still stop them. The stopping B press never opens the wheel; a subsequent fresh hold does. Bloom restores a camera it changed unless the player manually changes it first. Physics and hitboxes remain normal.

Clips are bundled and parsed once; opening the wheel does not download anything. Preferences live in the instance's `config/bloom-emotes.json`. The existing managed-mod reconciler installs new bundled content on the next Minecraft launch. No launcher emote screen, uploader, store, or live asset service was added.

`npm run tauri dev` already runs `build:cosmetics` before starting Bloom. Its output lists the emote count/names and confirms all four bundles. Creator can also build immediately after export. Restart Minecraft after any rebuilt content change.

Multiplayer source uses the existing verified cosmetics session over a new WebSocket relay. Local playback works without it. Observers require the mod, matching content revision, matching loaded player UUIDs, and the same server-address/dimension scope. Other clients see ordinary Minecraft behavior. No Minecraft server plugin is required.

## Read together

- [Architecture](BLOOM_EMOTES_SYSTEM_PLAN.md)
- [Adding animations and the first Blockbench tutorial](BLOOM_EMOTES_AUTHORING.md)
- [Bloom Animation Creator desktop editor](../BloomAnimationCreator/README.md)
- [Rig contract and tested export procedure](bloom-cosmetics-mod/emote-authoring/TEMPLATE.md)
- [Relay tests and deployment](backend/emotes/README.md)
- [Existing cosmetics architecture](COSMETICS_RENDERING_ARCHITECTURE.md)

## Acceptance evidence

Build success does not establish visual or multiplayer acceptance. Preserve this distinction when continuing work.

| Area | Evidence / remaining work |
| --- | --- |
| Four targets | Stonecutter builds and actual PAL parser tests pass for 1.21.11, 26.1, 26.2, 26.3. Controller playback tests are included. |
| Minecraft 1.21.11 | Isolated world: B wheel, Sit, Wave, and manual camera changes observed on the slim-arm model. Full cancellation/armor/cape/rendering-mod acceptance remains pending. |
| Minecraft 26.3 | Mod/PAL initialized in a real client. In-world visual acceptance remains pending. |
| Minecraft 26.1 / 26.2 | Build/parser coverage; in-world visual acceptance remains pending. |
| Blockbench | Classic/slim rigs remain. Earlier Nod export validation used Blockbench 5.2.2; the sample animations were subsequently retired. No plugin is required. |
| Content tooling | Seven Node tests cover validation/import, empty libraries, first-emote import, stale-clip removal, deterministic generation and source/export consistency. Creator export tests also cover sending the first Wave into an empty library. |
| Backend | 32 tests pass, including real WebSocket identity/scope/snapshot/expiry/reconnect/revocation tests and session authentication against memory/SQLite stores. |
| Managed installation | Rust lifecycle test passes across four bundles, including disable/restore, duplicates, and user-modified-file protection. |
| Repository checks | TypeScript, frontend build, and locked Cargo check pass. Existing frontend large-chunk warning remains. |
| Two Minecraft clients | Loopback harness and separate A/B profiles prepared; A authenticated. Windows firewall prompt requires Parks to dismiss it before the two-client visual test can continue. |
| Production | Relay source and Dockerfile prepared; no deployment or two-real-account acceptance yet. Local Docker executable is unavailable. |

Do not describe the system as fully accepted or live for all players until pending in-game and deployment checks are completed.

The hold-release wheel and extended hit regions have automated geometry coverage. Earlier in-world evidence above predates this gesture change; a new physical-input/in-world playtest is still required. Removed sample sources have a local recovery copy under the ignored `bloom-cosmetics-mod/build/retired-starter-emotes-*` folder and are never bundled.

October 18 clean-library validation: all four Stonecutter targets build with six Java tests each (zero failures), including real PAL playback and wheel geometry. Each final bundled JAR was inspected: zero catalog entries, no stale animation JSON, and a matching SHA-256 sidecar. Seven content tests and 22 Creator tests pass, including an isolated first-Wave export. No user-authored Wave was synthesized or exported by this cleanup; send the project from Creator when ready.

October 18 motion-order correction: the user's exported Wave retained both extra rotation layers and 695 baked right-arm rotation keys. The loss occurred during PAL loading because JSON whole-second keys preceded fractional timestamps. EmoteCatalog now numerically orders timelines before parsing, and playback no longer overlays four-tick fades on authored entry/exit curves. The user's project/export/source files were left unchanged; no re-export is required.

All four Stonecutter targets build with nine Java tests each (36 total, zero failures). New coverage reproduces the original linear-entry failure, compares 403 editor preview poses with actual PAL tick/render playback and fractional seeking, checks constant/vector/Sine data in reverse timestamp order, and samples every current bundled transform at 80 Hz. Creator's 23 tests include regeneration parity for that shared fixture; seven content tests pass. All four bundled JARs contain only the user's Wave, match their SHA-256 sidecars, and exclude test fixtures. This is automated controller coverage, not a new visual Minecraft playtest or multiplayer acceptance. Restart the Tauri dev launcher and Minecraft to use the rebuilt runtime.

## Prompts for future work

**Continue:** Read AGENTS.md and all three BLOOM_EMOTES guides. Continue the current implementation and finish in-game acceptance, two-client playback, cancellation, armor/cape compatibility, and packaged-mod loading. Update actual evidence. Keep launcher UI unchanged. Do not publish, deploy, change application versions, commit, push, or tag without the applicable authorization.

**Create an animation:** Read BLOOM_EMOTES_AUTHORING.md and the rig contract. Create a simple [motion] with source.bbmodel, matching animation.json, and emote.json. Preserve the skeleton and existing IDs/order. Validate/build and report actual previews. Do not publish an update.

**Import:** Import this export through `npm run emotes:import`, preserve existing slots, save the editable source beside it, and test the exported motion. Report actual results; do not publish.

Versions 1.1.9/1.1.10 from the discussion are examples, not release reservations or publication permission.


October 18 traversal validation: all four Stonecutter builds pass with 15 Java tests each (60 total), including cancellation/gesture regressions and ten moving loops of the review-only Comet Run fixture through PAL. Eight catalog tests and 30 Creator tests pass. Both projects pass typecheck, frontend build and locked Cargo check; the optimized Creator executable was rebuilt and hash-verified at its portable location, with the previous executable retained in verification. The exact delivered Comet Run project passed native bridge export/read/catalog-build in a disposable isolated workspace. Every active emote source file is unchanged by SHA-256; all four JARs still contain only Wave, Star Jump and Smooth Shuffle, and exclude test fixtures. A code-rendered eight-pose sheet was inspected; no physical B-key, live Minecraft traversal, Creator UI or two-client visual acceptance was performed in this turn. Restart Creator to use the new selector and Minecraft after the user sends/builds the reviewed animation.
