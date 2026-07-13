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

## How to add a bug

Use the next ID and record the same fields every time:

1. Status
2. Area
3. Exact symptom and error text
4. Root cause
5. Fix
6. Verification command or result
7. Any tempting workaround that should not be repeated
