# Bloom Client V2 Bug Ledger

This file is the durable, context-independent record of bugs found in Bloom Client V2. Search by the bug ID, error text, or symptom before investigating a new report.

## Status values

- **Open** — reproduced and still needs a fix.
- **Fixed** — a fix is in the code and has been verified.
- **Monitoring** — fixed, but worth watching for regressions.

## Bug index

| ID | Status | Area | Short description |
| --- | --- | --- | --- |
| BLIM-001 | Fixed | Development | Tauri waited for port 1420 while Vite used port 5173 |
| BLIM-002 | Fixed | Development | Vite watched Rust build binaries and crashed with Windows `EBUSY` |
| BLIM-003 | Open | Packaging | Tauri packaging needs the supplied icon assets enabled |
| BLIM-004 | Fixed | Launcher | Download completed before Minecraft was actually ready |
| BLIM-005 | Fixed | Fabric | Fabric profile installed without its Maven libraries |
| BLOOM-006 | Fixed | Packaging | Production client opened with a terminal window |
| BLOOM-007 | Fixed | Accounts | Microsoft session exceeded Windows' 2,560-character credential limit |
| BLOOM-008 | Fixed | Settings | Settings controls persisted visually but were not connected to application behavior |
| BLOOM-009 | Fixed | Instance content | Resource-pack and shader tabs could not browse or install from Modrinth |
| BLOOM-010 | Fixed | Performance | Low-end PCs had delayed buttons and freezes during log output or Skin Locker rendering |
| BLOOM-011 | Fixed | Performance | Packaged client froze during navigation while browser development stayed responsive |
| BLOOM-012 | Fixed | Native tasks | Child processes briefly flashed terminal windows |
| BLOOM-013 | Fixed | Cape Shop | Uploaded capes lost metadata and did not appear in the catalog |
| BLOOM-014 | Fixed | Bloom Cosmetics | Equipped Bloom cape fell back to the Minecraft account cape |
| BLOOM-015 | Fixed | Cosmetics Manager | Minecraft JSON hat textures sampled the wrong pixels |
| BLOOM-016 | Fixed | Cosmetics services | Rapid category switching caused account-service failures |
| BLOOM-017 | Fixed | Bloom Cosmetics | In-game wings rendered inside out |
| BLOOM-018 | Fixed | Release Manager | Repository paths containing spaces prevented startup |
| BLOOM-019 | Fixed | Bloom Cosmetics | Fabric Loader 0.19.2 was incorrectly rejected |
| BLOOM-020 | Fixed | Downloads | Sidebar download badge became stuck at 99 |
| BLOOM-021 | Fixed | Startup | A white screen appeared for roughly 15 seconds |
| BLOOM-022 | Fixed | Bloom Cosmetics | Wing placement reset after proxy server transfers |
| BLOOM-023 | Fixed | Cosmetics | Services duplicated network work and reused stale placement data |
| BLOOM-024 | Fixed | Cosmetics Manager | Java Block/Item wing groups were not recognized as hinges |
| BLOOM-025 | Fixed | Cosmetics Manager | Republishing an existing wing returned 502 Bad Gateway |
| BLOOM-026 | Fixed | Settings | Enabled toggle thumb could remain on the left |
| BLOOM-027 | Fixed | Accounts | Custom profile picture reset when Microsoft accounts changed |
| BLOOM-028 | Fixed | Settings | Profile status text and dropdown menus could be clipped |
| BLOOM-029 | Fixed | Settings | Profile account selector was not centered against its card |
| BLOOM-030 | Fixed | Modrinth import | Import button label had insufficient contrast and visual weight |
| BLOOM-031 | Fixed | Modrinth browser | Header X sometimes teleported downward and corrupted its next state |
| BLOOM-032 | Fixed | Instance creation | Game Directory folder button was a mock control and did not change the real destination |

---

## BLIM-001 — Vite/Tauri development port mismatch

- **Status:** Fixed
- **Symptom:** Tauri repeatedly printed `Waiting for your frontend dev server to start on http://localhost:1420/` while Vite served on `http://localhost:5173/`.
- **Root cause:** `src-tauri/tauri.conf.json` configured `devUrl` as port `1420`, but Vite had no explicit port and selected its default `5173`.
- **Fix:** Set Vite `server.port` to `1420` and `strictPort` to `true` in `vite.config.ts`.
- **Verification:** `npm run build` passes. Start development with `npm run tauri:dev`.

## BLIM-002 — Windows `EBUSY` watcher crash during Tauri startup

- **Status:** Fixed
- **Symptom:** `Error: EBUSY: resource busy or locked, watch '...src-tauri\\target\\debug\\build\\...exe'`, followed by `The "beforeDevCommand" terminated with a non-zero status code.`
- **Root cause:** Vite’s watcher scanned Rust’s generated `src-tauri/target` binaries while Cargo was compiling them. Windows does not allow the active build executable to be watched reliably.
- **Fix:** Exclude `**/src-tauri/target/**` and `**/src-tauri/gen/**` from Vite’s file watcher in `vite.config.ts`.
- **Verification:** `npm run build` passes. Re-run `npm run tauri:dev`; the Rust target directory should no longer appear in Vite watcher errors.
- **Do not “fix” by:** deleting the target folder on every run or switching ports again. The failure is caused by watching generated Rust output, not by the frontend port.

## BLIM-003 — Tauri packaging icon configuration

- **Status:** Open
- **Symptom:** Earlier Rust checks reported ``icons/icon.ico` not found` during Tauri packaging.
- **Root cause:** Packaging was enabled before the project’s real icon set had been added.
- **Current state:** The icon set now exists in `src-tauri/icons/`, but packaging remains disabled in `src-tauri/tauri.conf.json` until the assets are explicitly wired into the release configuration.
- **Next fix:** Enable the Tauri bundle and configure the supplied `.ico`, `.png`, and `.icns` assets, then verify a Windows release build.

## BLIM-004 — Launcher progress completed before game readiness

- **Status:** Fixed
- **Symptom:** Fabric and fresh instances appeared complete immediately after Java spawned, while dependencies or Minecraft startup were still running.
- **Root cause:** Progress used an estimated event counter, the dependency library did not emit its advertised byte events, and `running` was emitted at process spawn rather than game readiness. Each instance also used a separate dependency root.
- **Fix:** Bloom now streams official download plans itself with byte counts, transfer speed, checksum verification, cancellation, and exact task completion. Libraries/assets use a shared Bloom cache, while saves/mods remain isolated per instance. Startup remains active until Minecraft logs a real renderer/resource/audio readiness milestone.
- **Verification:** `cargo check` and `npm run build` pass.

## BLIM-005 — Fabric Maven libraries were missing

- **Status:** Fixed
- **Symptom:** Fabric installation disappeared from Active Downloads, but no playable Minecraft window opened and no new game log was created.
- **Root cause:** Fabric metadata exposes loader libraries through Maven coordinates and repository URLs without Mojang-style `downloads` objects. The dependency planner ignored those legacy Maven entries, leaving the Fabric library cache empty.
- **Fix:** Bloom now resolves those Maven coordinates, streams every Fabric library into the shared cache, and keeps failed tasks visible on Downloads with their error message.
- **Verification:** The generated Fabric Maven URL returns HTTP 200; `cargo check` and `npm run build` pass.

## BLOOM-006 — Production client opened with a terminal window

- **Status:** Fixed
- **Symptom:** Opening the installed Bloom Client also opened a blank terminal. Closing that terminal closed the client.
- **Root cause:** The Rust executable used Windows' console subsystem in release builds, making the terminal the owner of the application process.
- **Fix:** Production builds now use the Windows GUI subsystem. Debug builds keep their console output for development diagnostics.
- **Verification:** Build Bloom in release mode and confirm the PE subsystem is `Windows GUI`; launching the installed client must not create a terminal window.

## BLOOM-007 — Microsoft session exceeded Windows credential limit

- **Status:** Fixed
- **Symptom:** Microsoft sign-in completed, but Bloom displayed `Attribute 'password' encoded as UTF-16 is longer than platform limit of 2560 chars` and could not persist the account.
- **Root cause:** The profile, Minecraft access token, and Microsoft refresh token were serialized into one Windows Credential Manager password value. Refreshed token payloads can make that combined value exceed Windows' per-credential limit.
- **Fix:** Bloom stores the small account profile separately and splits each sensitive token into bounded secure credential chunks. Existing single-entry accounts remain readable and migrate automatically after refresh. Signing out deletes both formats.
- **Verification:** Rust tests reconstruct a 7,001-character token exactly from chunks no larger than 1,200 characters; the complete native test suite and `cargo check` pass.

## BLOOM-008 — Settings controls were cosmetic

- **Status:** Fixed
- **Symptom:** Several dropdowns and toggles displayed choices but used hard-coded values or empty change handlers. Launcher lifecycle, defaults, update checks, recommendations, logging, and download concurrency did not consistently follow the selected preferences.
- **Root cause:** The settings screen was built before each native/application consumer existed, so presentation state and operational state diverged.
- **Fix:** Every remaining setting now persists and has a concrete consumer. Startup and window behavior control Tauri, Minecraft defaults seed new instances, launch mode patches `options.txt`, Java choices use detected executables, the download queue runs native parallel workers, updates honor automatic-check preference, and privacy choices control local-only records. Unsupported language and loader choices were removed instead of being presented as functional.
- **Verification:** `npm run build` and `cargo test --manifest-path src-tauri/Cargo.toml` pass.

## BLOOM-009 — Resource-pack and shader catalogs were unavailable

- **Status:** Fixed
- **Symptom:** Instance Resource Packs and Shaders tabs showed Add buttons, but only the Mods tab could open a Modrinth catalog or install content.
- **Root cause:** The catalog state, search command, installer command, destination folder, labels, and Downloads metadata were all hard-coded to Fabric mods.
- **Fix:** Bloom now uses one category-aware catalog UI for mods, resource packs, and shaders. Mod results retain Bloom's dependency-aware Fabric backend flow; resource packs and shaders resolve exact Minecraft-compatible files through Modrinth and install into the owning instance's correct folder with genuine download progress.
- **Verification:** Run the focused frontend/native checks, then install one item from each tab in a Fabric instance.

## BLOOM-010 — Launcher interactions lagged on lower-end computers

- **Status:** Fixed
- **Symptom:** Buttons felt delayed, live log output could make the client stutter or freeze, and opening a populated Skin Locker caused heavy GPU usage on some systems.
- **Root cause:** Bloom blocked every button action for 620 ms to finish a decorative animation, committed a full React update for every Minecraft log line, and created a separate WebGL renderer for every visible skin card.
- **Fix:** Button actions now execute immediately while the press animation runs independently, log events are committed in batches, debug-log persistence is debounced, inactive instance folders are no longer polled continuously, and skin cards use lightweight 2D previews while retaining one interactive 3D main preview.
- **Verification:** Compare button response, a noisy Fabric launch, and a 12-skin locker on a lower-end PC with normal animations and Ultra Performance Mode.

## BLOOM-011 — Packaged client froze during navigation

- **Status:** Fixed
- **Symptom:** The installed Tauri build froze for several seconds after ordinary clicks and page changes, while the browser development build remained responsive.
- **Root cause:** Several synchronous native commands performed Java process detection, credential access, hardware inspection, directory scans, ZIP metadata parsing, and skin image encoding on Tauri's UI thread. The frontend also forced a synchronous layout calculation and restarted Animate.css on every button press.
- **Fix:** Slow native reads now run on Tauri's blocking worker pool, Java discovery is cached briefly, launcher session state can safely cross worker tasks, and button feedback uses lightweight CSS without forced layout or global click timers.
- **Verification:** `cargo check --manifest-path src-tauri/Cargo.toml`, `npm run typecheck`, and `npm run tauri:build -- --no-bundle` pass. In a cold release build, opening Settings took 88 ms, reading the updated window took 88 ms, and clicking Home while Java discovery was still running took 53 ms. Repeated page clicks remained around 50 ms.

## BLOOM-012 — Terminal windows flashed during native tasks

- **Status:** Fixed
- **Symptom:** Launching an instance or running certain native checks could briefly flash one or more terminal windows before they disappeared.
- **Root cause:** Bloom's release executable already used the Windows GUI subsystem, but child console programs such as PowerShell, Java version probes, and Java itself could still request a temporary console window.
- **Fix:** All native child processes created by Bloom now share a Windows no-console launch policy. Minecraft still pipes standard output and errors into Bloom's Logs page, but no terminal is attached or shown. Native folder-opening commands use the same safe process helper for consistency.
- **Verification:** Run a packaged build, launch both a fresh and previously installed instance, run AutoTune hardware detection, and trigger Java detection. No terminal should flash, while Minecraft output should continue appearing in Logs.

## BLOOM-013 — Cape uploads lost their metadata and did not appear in the Shop

- **Status:** Fixed
- **Symptom:** A cape reached the owner catalog as `null`, `cape/null`, and did not create a live card in Bloom Client.
- **Root cause:** The owner app passed upload metadata through a nested command payload without rejecting placeholder values. The backend also accepted the literal strings `null` and `undefined` as valid metadata.
- **Fix:** Cape Manager now sends explicit title, slug, collection, and publish fields and validates them in both TypeScript and Rust. The API rejects placeholder metadata, the client refreshes its catalog on focus, and repeated cape cards use cached one-frame 3D mannequin previews instead of persistent WebGL renderers.
- **Verification:** The recovered cape is live as `Meadows of Memories` with slug `meadowsofmemories`; the public catalog returns it, and both frontend and Rust compile checks pass.

## BLOOM-014 — Equipped Bloom cape fell back to the Minecraft account cape

- **Status:** Fixed
- **Symptom:** Bloom Cosmetics loaded in a supported Fabric instance, but the player continued to display their official Minecraft cape instead of the cape equipped in Bloom Client.
- **Root cause:** The mod's first scheduled catalog refresh ran before any player skin had rendered. The empty-player fast path returned without releasing its refresh guard, permanently blocking every later cape lookup.
- **Fix:** Empty startup refreshes now release the guard so the next two-second refresh fetches the observed player's assignment. Bloom Cosmetics was rebuilt as 1.0.1 and the corrected JAR was bundled for automatic instance synchronization.
- **Verification:** ParksAE's `Bloom Beta` assignment is present in the live cape API; the rebuilt bundled and installed JARs have matching SHA-256 hashes. Relaunch Minecraft and verify Bloom Beta replaces the official cape.

## BLOOM-015 — Minecraft JSON hat textures sampled the wrong pixels

- **Status:** Fixed
- **Symptom:** The clown-mask model had the correct general shape, but its face rendered as disconnected white, red, pink, and black blocks instead of the clown shown in Blockbench.
- **Root cause:** Exported Minecraft Java model JSON keeps face UV coordinates in a virtual `16×16` space even when the PNG is `32×32` or larger. Bloom incorrectly divided those UV values by the physical PNG dimensions, sampling only the upper-left portion of each mapped face. Face-level UV rotation was also ignored.
- **Fix:** The owner manager now distinguishes Minecraft Java JSON from native `.bbmodel` files, persists the UV coordinate-space dimensions with the normalized model, applies face rotations in the 3D preview, and the 1.21.11 in-game renderer reads the same UV metadata with backward-compatible fallbacks.
- **Verification:** `clown_mask.json` normalizes to texture `32×32`, UV space `16×16`, and five cubes; its north-face UV `[0,0,5,5]` now resolves to the complete 10×10 clown face. Manager typecheck, native packaging, and the Fabric cosmetics build all pass.
- **Do not repeat:** Do not add arbitrary texture-offset sliders to compensate for a format-conversion bug. UV coordinate space must be derived from the source model format so preview and in-game rendering remain identical.

## BLOOM-016 — Rapid cosmetic tab switching caused account-service failures

- **Status:** Fixed
- **Symptom:** Quickly switching between Capes, Hats, and Wings could make Hats or Wings fail with `502 Bad Gateway`. Waiting before opening the next category made it work again.
- **Root cause:** Each category remount independently revalidated the same Minecraft access token against Minecraft Services. Rapid navigation produced overlapping profile requests until Minecraft returned HTTP 429, which Bloom surfaced as a 502.
- **Fix:** All three cosmetic services now cache catalog results and coalesce identical in-flight requests. Hat and Wing account state is cached per account with a safe local fallback during transient failures. The backend coalesces account verification by a SHA-256 token key, keeps a short verified-profile cache, and can use recently verified state while Minecraft Services is temporarily rate-limited. Raw access tokens are never cached.
- **Verification:** The frontend production build and backend syntax check pass, the updated API is deployed, and its health endpoint reports `ok`. Rapidly switch among Capes, Hats, and Wings to verify no category requires a cooldown.

## BLOOM-017 — In-game wings rendered inside out

- **Status:** Fixed
- **Symptom:** Wings looked correct in Cosmetics Manager and Shop cards, but in Minecraft each wing's inner root appeared on the outside while its tip pointed toward the player's back.
- **Root cause:** Three.js and Bloom's Minecraft quad renderer assign horizontal UV coordinates in opposite directions on north/south box faces. Flat wing planes therefore sampled their textures horizontally reversed in-game.
- **Fix:** Wing models now use a wing-specific mesh parser that reverses U only on north/south faces. Geometry, offsets, scale, hats, and capes remain unchanged. Bloom Cosmetics 1.2.1 was rebuilt and synchronized to the bundled resource and active test instance.
- **Verification:** The Fabric mod build passes, and the built, bundled, and installed JARs have matching SHA-256 hashes.

## BLOOM-018 — Release Manager silently failed when the repository path contained spaces

- **Status:** Fixed
- **Symptom:** `npm run release:manager` exited successfully, but no Release Manager window or lasting Task Manager process appeared.
- **Root cause:** PowerShell split the `--repo` value at the space in `BloomClient v2`. The manager searched for `C:\Users\Parks\BloomClient\VERSION`, threw before creating its window, and had no startup error dialog.
- **Fix:** The manager now reconstructs split repository arguments, accepts the repository through an inherited environment variable, validates the resolved directory before creating the window, and displays a visible startup error if initialization fails.
- **Verification:** Launch with `npm run release:manager`; the process must remain open and load the current repository version.

## BLOOM-019 — Bloom Cosmetics rejected Fabric Loader 0.19.2

- **Status:** Fixed
- **Symptom:** Minecraft stopped at `Incompatible mods found` because Bloom Cosmetics required Fabric Loader 0.19.3 or later while an otherwise valid imported instance used 0.19.2.
- **Root cause:** The mod metadata inherited the loader version used to compile the project as its minimum runtime requirement, even though Bloom Cosmetics does not call any Fabric Loader-specific API that requires 0.19.3.
- **Fix:** Bloom Cosmetics 1.3.1 now compiles against and supports Fabric Loader 0.19.2 or later. The corrected JAR is embedded in Bloom Client, whose existing synchronization removes older `bloom-cosmetics-*.jar` files before installing the bundled version.
- **Verification:** The Fabric build succeeds and the bundled JAR declares `fabricloader >=0.19.2`, Minecraft `1.21.11`, and Java 21.
- **Do not repeat:** Do not automatically turn the development loader version into a stricter runtime minimum unless the mod actually depends on APIs introduced by that loader release.

## How to add a bug

Use the next ID and record the same fields every time:

1. Status
2. Area
3. Exact symptom and error text
4. Root cause
5. Fix
6. Verification command or result
7. Any tempting workaround that should not be repeated
# Hat collection can return `hat_not_found`

- **Symptom:** Adding a hat can fail with `404 Not Found: {"error":"hat_not_found"}`.
- **Cause:** A locally saved cart may contain the previous database ID of a hat that was deleted and republished.
- **Fix:** Reconcile cart IDs with the live catalog before display. If the catalog changes between browsing and confirmation, refresh once, remap the selection by stable name and collection, retry, or remove the unavailable entry with a readable message.

## BLOOM-020 — Sidebar download badge became stuck at 99

- **Status:** Fixed
- **Area:** Sidebar download progress
- **Symptom:** The circular Downloads badge could show `99` while the real Downloads page showed a much lower current percentage.
- **Root cause:** The badge treated progress as a permanent high-water mark and refused to decrease. Native launch stages may reset or lower progress when moving into another real installation phase, and a new task could also inherit the previous badge value.
- **Fix:** The sidebar badge now mirrors the current native progress value exactly, clamps it to `0–100`, and accepts legitimate phase decreases instead of retaining stale progress.
- **Verification:** Launch an instance requiring downloads and compare the sidebar number with the Downloads page throughout every phase; the rounded integer values must remain synchronized.
- **Do not repeat:** Do not smooth staged download progress with logic that only allows increases unless the backend supplies one globally monotonic aggregate percentage.

## BLOOM-021 — Startup displayed a white screen for roughly 15 seconds

- **Status:** Fixed
- **Area:** Application startup
- **Symptom:** Both installed and development builds could sit on a blank white window for roughly 15 seconds before Bloom Client appeared.
- **Root cause:** The webview had no native or inline dark first frame, while update, backend, account, background-image, and persisted-log restoration all began during the initial startup window. The automatic update request also uses a 15-second network timeout.
- **Fix:** The native window and initial HTML now paint black immediately with a lightweight Bloom loading frame. External update/backend checks and nonessential local restoration are deferred until after the client has rendered; large custom backgrounds are loaded only when that feature is enabled.
- **Verification:** TypeScript and a full debug Tauri build complete successfully. Test the installed update by cold-opening Bloom several times; the dark first frame should appear immediately and navigation should become available without waiting for update or backend requests.
- **Do not repeat:** Never place network checks or large persisted-data restoration on Bloom's first-paint path, and never rely on bundled CSS alone to color the webview before the frontend loads.

## BLOOM-022 — Wing placement reset after a proxy server transfer

- **Status:** Fixed
- **Area:** Bloom Cosmetics / wings
- **Symptom:** A wing used its saved placement in a server lobby, but could fall back into the player's back after the network moved the player to a duels world or another downstream server.
- **Root cause:** Wing assignments were resolved only through the current player entity UUID. Proxy transfers can destroy and rebuild the local player entity, making that temporary identity unsafe for local cosmetic placement. Placement values were also omitted from the wing asset cache key, so a placement-only catalog update could reuse stale geometry metadata.
- **Fix:** The local player now resolves cosmetics through the stable signed-in Minecraft account UUID across entity and world replacements. Wing cache identities now include offsets, scale, and cape-hiding state so placement-only updates cannot reuse stale values.
- **Verification:** Join a proxy-based server lobby, confirm wing placement, enter and leave a duels match, and confirm the wing remains in the identical position after every transfer.
- **Do not repeat:** Never key the local player's durable cosmetic state solely to a world-scoped entity identity, and never omit placement metadata from a cache key whose value contains that placement.

## BLOOM-023 — Cosmetic services duplicated network work and reused stale placement data

- **Status:** Fixed
- **Area:** Bloom Client and Bloom Cosmetics runtime
- **Symptom:** Opening cosmetic categories or refreshing in-game cosmetics could repeat identical account, catalog, model, texture, and preview requests. Placement-only hat, wing, or bracelet updates could also keep old geometry metadata until an asset changed.
- **Root cause:** Capes, hats, wings, and bracelets each owned separate HTTP clients, refresh threads, parsing helpers, and unbounded frontend preview request paths. Downloaded model data and mutable placement settings were cached as one value, so changing only placement could either trigger unnecessary downloads or reuse stale placement.
- **Fix:** Cosmetic services now share pooled HTTP clients, one low-priority refresh scheduler, common identity and texture helpers, bounded frontend preview caches, and in-flight request deduplication. Downloaded model/texture resources are cached separately from placement settings, allowing placement to update immediately without downloading unchanged files again.
- **Verification:** The Fabric cosmetics build, Rust native check, and TypeScript typecheck all pass. The rebuilt 1.4.2 JAR is synchronized with Bloom Client's bundled resource.
- **Do not repeat:** Do not create a new HTTP client, scheduler, or preview cache for each cosmetic type, and do not combine immutable downloaded assets with mutable placement state in one cache entry.

## BLOOM-024 — Java Block/Item wing groups were not recognized as animation hinges

- **Status:** Fixed
- **Area:** Cosmetics Manager / animated wing import
- **Symptom:** Correctly named `left_wing_flap` and `right_wing_flap` folders still produced the “Whole-wing flap mode” message, and the articulated sections did not flap independently.
- **Root cause:** Some native Java Block/Item `.bbmodel` projects store group names and origins in the top-level `groups` table while the `outliner` contains only group UUIDs and cube children. Bloom read only the outliner record, so it lost every animation group name.
- **Fix:** The model normalizer now joins `groups` metadata to matching `outliner` entries by UUID before assigning root/flap parts and hinge pivots. When a Java Block/Item folder still has a clearly unrelated default origin, Bloom safely falls back to the flap cube's explicit pivot. Generic Model files and the previous inline outliner format remain supported.
- **Verification:** The supplied `angel_wings.bbmodel` now normalizes into one left root, one right root, one left flap, and one right flap with both flap pivots present; Cosmetics Manager typechecking passes.
- **Do not repeat:** Never assume a Blockbench outliner entry contains its own name or origin. Resolve group metadata by UUID for every supported native project format.

## BLOOM-025 — Republishing an existing wing returned 502 Bad Gateway

- **Status:** Fixed
- **Area:** Cosmetics Manager / owner API
- **Symptom:** Publishing a revised wing with an existing slug, such as `angel-wings`, showed `Bloom API returned 502 Bad Gateway: error code: 502` even though its files uploaded successfully.
- **Root cause:** The owner API always generated a new database row for a publish request. Supabase rejected the duplicate slug, the API removed the newly uploaded files, and the gateway surfaced the unclassified database conflict as a generic 502.
- **Fix:** Wing publishing is now idempotent by slug. A matching wing is updated in place with new model, texture, preview, placement, and publication metadata while preserving its database ID, ownership, equipped state, and added colorways. Its default colorway follows the replacement texture, old core files are cleaned up only after the database update succeeds, and failed updates roll back safely.
- **Verification:** A live republish of `angel-wings` now returns HTTP 200, preserves the original wing ID, retains its default colorway, and the deployed API health endpoint reports `ok`.
- **Do not repeat:** Do not implement owner-side cosmetic replacement as delete-and-recreate or as an unconditional insert; both break stable references and turn expected revisions into duplicate-key failures.

## BLOOM-026 — Enabled toggle thumb could remain on the left

- **Status:** Fixed
- **Area:** Settings / toggles
- **Symptom:** Some enabled toggles showed an accent-colored track while their white thumb remained in the off position.
- **Root cause:** JavaScript animation could leave a stale inline transform on the thumb, overriding the transform associated with the current React state class.
- **Fix:** Toggle position now comes exclusively from the on/off state classes. CSS transitions animate between those two authoritative positions, and protected selectors prevent stale inline transforms from winning.
- **Verification:** Check every toggle while animations are enabled, disabled, and in Ultra Performance Mode; off must always be left and on must always be right.
- **Do not repeat:** Never use a persistent inline animation transform as the source of truth for a stateful control.

## BLOOM-027 — Custom profile picture reset when Microsoft accounts changed

- **Status:** Fixed
- **Area:** Accounts / profile picture
- **Symptom:** A custom profile picture disappeared after switching, adding, signing out of, or signing back into a Microsoft account.
- **Root cause:** Account lifecycle handlers cleared profile-picture state even though the picture was intended to customize Bloom Client itself rather than one Minecraft account.
- **Fix:** The profile picture uses one launcher-wide local storage key and is no longer cleared by Microsoft account lifecycle actions. Both profile avatar locations read the same shared state.
- **Verification:** Set a picture, switch accounts, add an account, sign out and in, restart Bloom, and select the same image again; the picture must remain consistent.
- **Do not repeat:** Do not key launcher-wide visual preferences to a Microsoft account or clear them during account authentication changes.

## BLOOM-028 — Profile status text and dropdown menus could be clipped

- **Status:** Fixed
- **Area:** Settings / My Profile
- **Symptom:** The profile-picture success message was cut off below the account selector, and dropdown content could be covered or cropped by nearby elements.
- **Root cause:** Status text was positioned outside the card's reserved flow while rendering containment and ancestor overflow could crop both it and locally rendered floating menus.
- **Fix:** Status text now participates in the picker layout, wraps safely, and increases the card height. Shared dropdowns and follow-up popovers render in a document-level layer, measure available viewport space, flip upward when needed, and scroll internally when space is limited.
- **Verification:** Test success and error text, long account names, menus near every viewport edge, short viewports, and minimum supported width. Nothing may overlap or crop the text or menu.
- **Do not repeat:** Do not place helper text outside a contained card's normal flow or render floating menus inside a clipping ancestor.

## BLOOM-029 — Profile account selector was not centered against its card

- **Status:** Fixed
- **Area:** Settings / My Profile
- **Symptom:** The account label was initially too small and vertically offset; after that was corrected, the selector still sat slightly right of the card's true horizontal center.
- **Root cause:** A broad descendant rule overrode the selector label's typography and margin. The row then centered the selector in flex space remaining between a 47px avatar and a 43px add button, so it was not centered against the full card.
- **Fix:** The selector owns explicit typography, line height, and two-axis centering; its chevron is positioned independently. The normal profile row uses equal outer grid tracks around a centered middle track, so unequal side-control widths cannot move the selector.
- **Verification:** Compare the selector and card center coordinates on both axes in the normal state, with a long account name, with a visible status message, during add-account flow, and at default and minimum widths. Typecheck and production build must pass.
- **Do not repeat:** Never use leftover flex space as the reference frame for a central control when the siblings on each side differ in width.

## BLOOM-030 — Import button label had insufficient contrast and visual weight

- **Status:** Fixed
- **Area:** Modrinth modpack import
- **Symptom:** The compact Import action was difficult to read, especially when a light accent color placed white text on a similarly bright fill.
- **Root cause:** The fill used 82% of the selected accent and referenced an undefined contrast-color variable. The control was also only 45px tall with narrow horizontal padding.
- **Fix:** The action now uses an explicit white foreground over a 55% accent-to-black mix, a 132px minimum width, 50px height, larger type, and wider spacing. It keeps the existing dark border and adds no glow.
- **Verification:** The lightest selectable case, Bloom green, has approximately 4.87:1 contrast against white; the other accent choices exceed that. Typecheck and production build must pass.
- **Do not repeat:** Never assume one light foreground works on a raw user-selectable accent or reference an undefined contrast token.

## BLOOM-031 — Modpacks header X teleported downward and corrupted its next state

- **Status:** Fixed
- **Area:** Modrinth modpack browser
- **Symptom:** The red X sometimes jumped downward while being pressed or failed to behave normally. Returning from a modpack's version selector could leave the next close-button state visibly unstable.
- **Root cause:** The X used `translate: 0 -50%` for vertical centering while Bloom's shared press animation temporarily owns the same `translate` property. The version-back and browser-close meanings also reused one DOM button, allowing an in-progress press animation to survive the state change.
- **Fix:** The header now uses a symmetric three-column grid to center the title and place the X without any positional transform. Back and close states use distinct React keys, so changing meaning remounts a clean button and discards the old interaction animation.
- **Verification:** Open and close the browser repeatedly, enter a modpack version selector, press X to return, then immediately press the new X to close. Repeat with the press duration at 0ms and 1500ms; the button must stay centered and every click must perform its current action. Typecheck and production build must pass.
- **Do not repeat:** Never position an interactive button with the transform longhands owned by a shared interaction animation, and never reuse an animated element when its semantic state changes mid-animation.

## BLOOM-032 — New Instance directory picker did not change the real destination

- **Status:** Fixed
- **Area:** Instance creation / filesystem
- **Symptom:** Clicking the folder icon beside Game Directory did nothing, and the displayed path never changed.
- **Root cause:** The button was shipped with placeholder tooltip text and no click handler even though the native `choose_game_directory` command already existed.
- **Fix:** The button now opens the operating system's native folder picker, writes the selected absolute folder into the draft, and reports picker failures in the page's normal status area. Instance creation resolves that selected folder as the real parent and creates the instance inside `<selected folder>/<instance id>` before saving the resolved path to Bloom's instance record.
- **Verification:** Select a different drive/folder, confirm the field changes immediately, create an instance, confirm the instance directory and enabled component folders exist beneath the selected folder, restart Bloom, and confirm the saved instance still points there. The native path-resolution regression test asserts the selected directory remains the parent.
- **Do not repeat:** Every visible action must have a real handler and an end-to-end native effect before it ships; placeholder tooltips are not an implementation.

## BLOOM-033 — Drag-and-drop content was limited to the Fabric Modrinth browser

- **Status:** Fixed
- **Area:** Instance content / filesystem
- **Symptom:** The drop overlay only appeared while browsing Fabric mods. Resource Packs and Shaders had no drop state or importer, and installed-content views could not accept files directly.
- **Root cause:** Both the window drag listener and native importer were gated to the Modrinth Mods state, with a hard-coded mods destination and JAR validation.
- **Fix:** The drag listener now follows any active content tab, while the native importer derives the real destination and accepted archive type from Mods, Resource Packs, or Shaders. The old Fabric mod command remains as a compatibility wrapper.
- **Verification:** Drop a Fabric JAR on Mods, a ZIP on Resource Packs, and a ZIP on Shaders from both installed and browsing views. Confirm each appears in its active list and real instance folder; reject wrong extensions and invalid archives without copying them.
- **Do not repeat:** Shared content UI must derive behavior from the active category rather than enabling one category through a screen-specific special case.

## BLOOM-034 — Signed-out account flow did not share the account dock

- **Status:** Fixed
- **Area:** Sidebar / Microsoft authentication
- **Symptom:** Signed-out users saw an old transparent login row with a fake blue M, then a detached sign-in panel that did not match the signed-in account drawer.
- **Root cause:** The signed-out state retained its original standalone component after the signed-in footer was redesigned into a sliding dock with a stationary masked drawer.
- **Fix:** Both states now share the same dock geometry, rise animation, underlap, clipping, and outside/Escape closing behavior. The signed-out drawer presents sequential Copy code and Open Microsoft sign-in actions and uses a bundled four-color Microsoft mark.
- **Verification:** Open and close by trigger, outside click, and Escape; confirm only the dock moves. Before copying, the redirect row stays dim and disabled. After copying, the first row reads “Copied” and dims while the redirect row enables. Confirm Settings can still add another account through its inline variant.
- **Do not repeat:** When a persistent shell component is redesigned, audit authenticated, unauthenticated, loading, error, and alternate-entry states before considering it complete.

## BLOOM-035 — Microsoft mark aligned to the top of its identity tile

- **Status:** Fixed
- **Area:** Sidebar / signed-out account dock
- **Symptom:** The Microsoft identity tile filled the dock correctly, but its four-color mark sat against the tile's top instead of its center.
- **Root cause:** The older `.profile span` descendant selector has greater specificity than `.microsoft-mark` and changed the tile from a grid into a normal block while also adding a top margin.
- **Fix:** The Microsoft tile now overrides the legacy selector with profile-scoped display, margin, font, and explicit child placement rules. The logo is centered by layout on both axes with no positional offsets.
- **Verification:** Compare the logo and tile center coordinates horizontally and vertically in both closed and raised states; they must match. Test default and minimum window sizes.
- **Do not repeat:** Before compensating for misalignment, compare selector specificity and computed display/margins for every ancestor and child involved.

## BLOOM-036 — Custom-background surfaces used unrelated opacity and blur rules

- **Status:** Fixed
- **Area:** Appearance / custom backgrounds
- **Symptom:** The center became fully transparent, side rails used different theme colors and optional blur state, and many filled controls stayed opaque even when button blur was enabled.
- **Root cause:** Image opacity, sidebar opacity, sidebar blur, and button blur evolved as independent settings backed by incomplete selector lists rather than one shared surface model.
- **Fix:** Custom-background mode now keeps the sharp center and blurred side rails on one constrained Interface Darkness value, while blurred controls use their own constrained Element Darkness value and retain accent meaning.
- **Follow-up:** Element Darkness is stored separately from Interface Darkness, so users can tune control opacity without unexpectedly changing the canvas or side rails. The approved custom-background defaults are now 100% image opacity, 92% interface darkness, and 35% element darkness; a one-time migration updates only the untouched legacy 78%/83% pair and preserves intentional custom values.
- **Regression fix:** Transparent black controls composited over the already-dark interface and appeared fully black at every slider value. The low end now resolves toward translucent charcoal, and selector coverage includes inactive sidebar actions, settings tabs/layout, the account card, and instance tabs.
- **Verification:** Test every theme at 55%, the default 78%, and 92% darkness with image opacity at 25%, 50%, and 100%. Confirm the center is never blurred, both rails match its darkness, filled controls remain readable, and Ultra Performance Mode removes blur without removing the dark tint.
- **Do not repeat:** Background transparency controls must be tokenized globally; never add a new surface with its own unrelated opacity formula or opt-in blur toggle.

## BLOOM-037 — Instances creation plus shifted after revealing

- **Status:** Fixed
- **Area:** Sidebar / Instances heading
- **Symptom:** The plus tile appeared to jump left as its hover scale-in animation reached the final frame.
- **Root cause:** The first implementation transformed an absolutely positioned button. Separating the visual scale still left its hitbox on a fractional percentage-based coordinate; Chromium could round that coordinate differently when the compositor layer was removed after the transition.
- **Fix:** The control now participates in a centered two-column grid. Hover expands its track from 0px to 30px and the inner tile uses a symmetric clip reveal, eliminating percentage positioning and scale transforms from the complete reveal.
- **Verification:** Repeatedly enter and leave the complete Instances heading, focus the plus by keyboard, and click it at multiple Button Pop Duration values. The tile must grow and shrink around one stable center without a final-frame shift.
- **Do not repeat:** Never animate the transform of an absolutely positioned reveal control when a stable inner visual wrapper can own that animation instead.

## BLOOM-038 — AutoTune dots did not advance when benchmark installation completed

- **Status:** Fixed
- **Area:** AutoTune / workflow progress
- **Symptom:** The interface changed from installing the benchmark to “Ready to test,” but the active progress dot remained in the same position, making the indicator appear cosmetic.
- **Root cause:** The dots represented four persisted high-level milestones while the benchmark installer and benchmark runner were collapsed into one parent phase. Live benchmark states such as permission, installing, ready, and running never reached the indicator.
- **Fix:** Progress now represents five user-facing stages: Scan hardware, Install benchmark, Run test, Build profile, and Apply. The benchmark indicator is derived from its authoritative live stage; ready, running, and result activate dot 3, while an error preserves the stage that actually failed.
- **Verification:** Accept and scan, start installation, wait for Ready to test, launch the benchmark, generate the profile, and reach Apply. The active dot must move 1 → 2 → 3 → 4 → 5, with completed dots retained. Force errors during installation and execution and confirm they retain dots 2 and 3 respectively.
- **Do not repeat:** A progress indicator must subscribe to the same state machine that renders the visible step. Never infer progress only from coarse persistence flags when one phase contains multiple user-facing screens.

## BLOOM-039 — Compact action menus overlapped their owning cards

- **Status:** Fixed
- **Area:** Instance content, instance library, and instance header overflow menus
- **Symptom:** A three-dot menu positioned itself from the small trigger, so its first action began alongside or inside the mod row instead of beneath the row. The trigger's expanded blue surface also had sharp corners.
- **Root cause:** Shared floating-menu placement used the trigger bounds and could flip above based on viewport space. Action menus inherited the attached-select shape even though they are detached from a full card.
- **Fix:** Compact action menus now measure their complete owning row, card, or raised header and use a dedicated downward-only placement function. The menu underlaps the owner's lower edge by 1px, has no visible gap, uses a recessed square top plus rounded lower corners, and adds a downward black inset shadow so it appears to emerge from behind the raised card. Short action menus size to their content and expose no scrollbar track or thumb. Expanded three-dot triggers use an explicit 9px radius.
- **Verification:** Open menus from the first, middle, and last installed Mod, Resource Pack, and Shader rows; from every full instance card; and from the instance header. Confirm each menu emerges directly from behind its complete owner with no air gap, the owner reads above it, every action is visible without a mini scrollbar, the menu follows scroll/resize, and the trigger highlight stays rounded.
- **Do not repeat:** Do not use generic select-menu placement for a card action menu. The visual owner—not the icon-sized trigger—is the anchor.

## BLOOM-040 — Windows taskbar icon appeared tiny and blurry

- **Status:** Fixed
- **Area:** Native Windows branding
- **Symptom:** The taskbar showed a fuzzy, undersized Bloom flower inside a dark square even though the repository contained high-resolution logo artwork.
- **Root cause:** The bundled `icon.ico` was stale. Its small native layers contained an older padded dark-square treatment, so Windows faithfully selected already-blurry artwork rather than the clean transparent logo.
- **Fix:** Regenerated the complete Tauri icon family from `bloom-square-source.png`. The Windows ICO now includes clean transparent 16, 24, 32, 48, 64, and 256px layers, allowing Windows to choose a native-size taskbar image instead of rescaling one bitmap.
- **Verification:** Inspect the ICO directory and render its 16, 24, 32, and 48px frames. Each frame must be transparent outside the flower, fill the available canvas, and contain no dark rounded plate. Confirm the next native Tauri launch at standard and high-DPI Windows scaling.
- **Do not repeat:** Rebuild every platform icon from the canonical transparent source when branding changes; replacing only a PNG does not update the icon embedded in the Windows executable.
