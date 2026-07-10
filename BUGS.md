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

## How to add a bug

Use the next ID and record the same fields every time:

1. Status
2. Area
3. Exact symptom and error text
4. Root cause
5. Fix
6. Verification command or result
7. Any tempting workaround that should not be repeated
