# Utilities and Global File Sync

This document defines the first Bloom Utilities feature and the filesystem safety rules future cross-instance tools must follow.

## Product shape

Utilities is a global sidebar destination. Its home remains a responsive grid so future complete tools can be added without redesigning the page. Global File Sync occupies one compact, near-square card with a rounded raised identity surface, one large unboxed Lucide icon, a large title, and a recessed action row containing an accent-filled Configure button. Subtitles and configuration counts stay out of the landing card; detailed status appears after opening the utility. The card itself does not gain a hover outline. Its five managed file types are settings within that utility, not separate products.

Selecting Configure opens a dedicated Global File Sync detail view with a visible Back button, following the same navigation model as opening an instance. The detail view contains the five real configuration sections and no placeholder capabilities. It shows only section names, essential field labels, and functional controls; paths, counts, versions, statuses, and explanatory captions are intentionally omitted. The final apply confirmation keeps one short backup warning because it describes a real file consequence. Every visible control is backed by a Tauri command and persisted configuration.

## Global File Sync behavior

| Utility | Source | Destinations | Behavior |
| --- | --- | --- | --- |
| Game Options | One selected instance | Every other visible Bloom instance | Copies `options.txt` after comparison and backs up each changed destination. |
| Server List | One selected instance | Every other visible Bloom instance | Copies `servers.dat` after comparison and backs up each changed destination. |
| Voice Chat | One selected instance | Explicitly selected instances | Copies `config/voicechat/voicechat-client.properties` only to the chosen destinations. |
| Resource Packs | Bloom shared library | Every visible Bloom instance | Merges existing content, then connects `resourcepacks/` to one live global folder. |
| Shader Packs | Bloom shared library | Every visible Bloom instance | Merges existing content, then connects `shaderpacks/` to one live global folder. |

Settings are stored under Bloom's normal application-data root at `utilities/global-file-sync/settings.json`. The last successfully applied setup is stored separately in `active-settings.json`; a saved draft never changes a newly created instance by surprise. Shared libraries live below `utilities/global-file-sync/shared/`; timestamped backups live below `utilities/global-file-sync/backups/`. These paths are private local state and never enter an instance configuration or release artifact.

## Safety and conflict handling

- Never copy a configured file until its source exists as a real file.
- Compare source and destination bytes first. Identical files are skipped and reported as unchanged.
- Back up every different destination before replacing it. Preserve the original relative path inside the instance's backup directory.
- Never delete an existing resource pack or shader pack while enabling sharing. Merge it into the shared library first.
- When two different pack files use the same name, keep the existing shared file and preserve the incoming file with `-from-<instance-id>` before its extension.
- On Windows, use directory junctions so shared packs update live without administrator-only symbolic-link requirements. Other supported platforms use directory symbolic links.
- If link creation fails after an instance folder moves to backup, restore the original folder immediately.
- Never replace or detach a directory link that points somewhere other than Bloom's own shared library. Stop with a clear error so an external pack manager or manually shared folder is not damaged.
- Disabling a shared library removes only the link, recreates the local directory, and copies the shared content back into it.
- The UI must summarize these consequences and require explicit confirmation before applying filesystem changes.
- New instances automatically inherit `options.txt`, `servers.dat`, and active shared pack links from the last successfully applied setup. Voice Chat stays explicitly targeted and is never added to a new instance implicitly.
- Bloom reapplies the active file rules to the selected destination immediately before launch. This captures later source edits without pretending one-time copies are live links; a preparation failure stops launch with an actionable error instead of starting with stale or partially applied settings.

## What not to do

- Do not call repeated one-time copying a globally shared folder.
- Do not choose a source automatically from whichever instance happens to be newest.
- Do not overwrite a different file without a recoverable backup.
- Do not silently target every instance for settings that may intentionally differ, such as Simple Voice Chat.
- Do not expose raw filesystem paths as the main interaction when an instance identity is available.
- Do not use native browser selects, mock progress, or controls that only update React state.
- Do not remove directory links with recursive deletion; unlink the junction or symlink itself so the shared target remains intact.

## Adding future utilities

1. Add one card to the existing data-driven grid with a Lucide icon and live status.
2. Keep configuration in the shared attached workspace instead of creating a new top-level visual system.
3. Implement and test native commands before exposing the action.
4. Persist only stable identifiers and user choices, never temporary absolute instance paths when an instance ID is available.
5. Document overwrite, backup, rollback, and recovery behavior here or in a dedicated architecture document.
6. Add regression coverage for failure halfway through the native operation, not only the success path.

## Verification checklist

- Run frontend type checking and production build.
- Run Rust formatting, unit tests, and locked Cargo check.
- Test with zero, one, and multiple instances.
- Test missing source files and deleted source instances.
- Test identical and different destination files.
- Test two different packs with the same filename.
- Confirm backup contents before and after a sync.
- Enable, reopen, and disable both shared libraries; verify links and restored local copies.
- Verify custom backgrounds, every accent, reduced motion, Ultra Performance Mode, default size, and minimum supported width.
