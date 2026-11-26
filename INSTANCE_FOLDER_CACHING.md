# Delight Client instance folder caching

Opening an instance should change its selection and detail view in place. The sidebar should show its saved group on the first frame, even when a native disk read is slow.

## What persists

| Data | Owner | Lifetime |
| --- | --- | --- |
| Folder names, order and ordered member IDs | The launcher's application-data file `instance-folders.json` | Across restarts |
| Last confirmed folder layout | `useInstanceFolders`, owned by the React app | Until the launcher window reloads |
| Collapsed folder IDs | Webview local storage, under `delight-instance-folders-collapsed` | Across restarts |

The native folder file is the source of truth. Selecting an instance, expanding a folder, searching, or leaving and returning to the library reuses the confirmed layout. Filtering can reveal matching members temporarily while preserving the saved collapse preference.

## When the layout changes

- **Startup.** After the instance library loads, read its folder layout once. Until that read finishes, hold back instance rows so grouped members never flash in the loose list. A successful empty list means all instances are genuinely ungrouped.
- **Instance additions and removals.** A change to the set of instance IDs triggers a native refresh. Keep the last confirmed grouping visible while waiting. Sorting instances or changing a display name or icon does not invalidate membership.
- **Folder edits.** Creating, renaming, moving, reordering and ungrouping use the native folder command. Its successful response replaces the in-memory layout, including when the sidebar was closed during the save. Reads and writes run in request order.
- **Recovery.** A failed read or write leaves the last confirmed layout available and exposes Retry. If the first read fails, the sidebar still offers the instances in a flat list and waits for a successful read before enabling folder edits. Retry reloads the native layout.

## Regression check

`tests/instance-folders-ui.mjs` delays the first read to catch provisional loose rows. It counts folder reads while selecting a grouped instance and returning from another page, exercises delayed and failed saves, and checks saved group order and collapse state after a reload. The Rust tests in `src-tauri/src/instance_folders.rs` cover native persistence and membership.
