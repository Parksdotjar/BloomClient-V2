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

## How to add a bug

Use the next ID and record the same fields every time:

1. Status
2. Area
3. Exact symptom and error text
4. Root cause
5. Fix
6. Verification command or result
7. Any tempting workaround that should not be repeated
