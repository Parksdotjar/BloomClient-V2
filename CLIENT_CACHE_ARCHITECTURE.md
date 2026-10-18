# Bloom Client Cache Architecture

Bloom uses a bounded, local-only cache to make instance content and Modrinth browsing feel immediate without treating cached data as authoritative.

## Cached data

- Parsed instance-content metadata and embedded artwork are keyed by absolute file path, file size, modification time, and enabled state. A changed, renamed, enabled, disabled, or replaced archive therefore misses the old entry and is read again.
- Modrinth catalog responses are keyed by content category, Minecraft version, normalized query, and page offset. They expire after 15 minutes. Catalog pages contain 50 results and page counts follow Modrinth's reported total without a client-side cap.
- Trusted Modrinth CDN artwork is warmed in the background, stored inside Bloom's managed capacity, and served as cached data on later catalog reads. Each image is limited to 2 MB and must pass HTTPS host and image-signature checks.
- The active catalog page and installed-content lists are also kept in process memory so revisiting a page does not flash an empty state while the native cache is read.
- After a catalog response arrives, the next two valid pages and their managed artwork are warmed in the background.
- Official Minecraft skin and cape textures, generated skin thumbnails, and Bloom cloak artwork are stored inside the same managed capacity. The last good Bloom cloak catalog is retained for temporary service outages.
- The complete Minecraft wardrobe response is retained without an automatic expiry. Opening or switching Locker tabs reads that saved response; only the explicit reload control contacts Minecraft again and replaces it.
- Locker collections remain populated while a background refresh runs. Cape cards use nearest-neighbor pixel rendering, while the 3D preview renders at a minimum 2x pixel ratio.
- A cold instance-content read shows a compact loading state until its cached list is ready instead of briefly claiming that no content is installed.
- When the off-by-default `Recent mod searches` setting is enabled, the five newest unique Mods searches are retained locally and shared between the installed-mod list and the Add Mods catalog. Focusing the Mods search reveals them upward behind the search bar, whose overlapping shadow preserves the correct depth; choosing one immediately reruns it.
- Catalog responses, page warming, artwork warming, expiry, and cache keys remain unchanged. The view waits for the first ten uncached result rows to be visually ready, reveals them from top to bottom, and mounts later rows in groups of ten near the scroll boundary rather than creating all fifty row elements at once.

## Screenshot images

- Screenshot thumbnails (480px) and previews (1920px) persist in the existing managed `screenshot-images` cache without a time-based expiry. Each native read still resolves the owning instance and validates the source path and size before serving cached data. Keys include canonical path, byte size, nanosecond modification time, render size/mode, and format revision. Copy always reads the original image.
- The launcher discovers screenshots shortly after startup, then every 30 seconds while visible, and warms both image sizes with at most two frontend jobs and the existing serialized native decoder. Revision tracking avoids repeatedly decoding or warming an unchanged collection. New/changed images are picked up on the next discovery; Refresh remains available.
- A shared in-memory cache retains decoded browser images plus their source strings across navigation, with an estimated 160 MiB budget. Visible/newest shots receive retention preference; clicks, focus, and hover take priority over background work. Duplicate requests coalesce. Large collections remain on disk even when an image leaves hot memory, subject to the user's normal total cache capacity.
- Gallery metadata is shared in process. Revisiting Screenshot Shelf retains its populated grid while refreshing metadata; active shelves subscribe to discovery changes. Previews and comparisons initialize directly from warm memory instead of deliberately clearing their image state on mount. A genuinely cold or evicted image may still need to load; the first discovery cannot be instantaneous.
- Clear cache removes the managed disk entries and clears queued/in-memory images and warm tracking. Already-running image jobs cannot repopulate the cleared memory generation. Normal discovery may warm the cache again later.

## Launch preparation

- Successful preparation saves a `launch-installations` receipt covering the downloaded game/libraries/assets, both version metadata files, extracted native tree, and instance mod tree. Warm launches validate file sizes, high-resolution timestamps, and sorted directory entries before reusing the prepared version. Receipts expire after 24 hours and include instance/version/loader/path/platform identity. Missing, altered, added, or removed inputs fall back to the existing installer and checksum checks. Unpinned Fabric loader selection continues resolving the latest loader through the full path.
- `launch-natives` receipts separately cover the library graph, existing library artifacts, and extracted tree. Unchanged libraries avoid redundant extraction even if another installation input changed. Repair bypasses both installation reuse and native-extraction reuse. Download verification remains in the original downloader; these receipts are metadata-based acceleration, not continuous byte-for-byte integrity verification.
- `launch-java` receipts retain the successfully selected executable and JVM binary for the same required major/profile, with the same bounded age and metadata checks. Discovery runs alongside file preparation only when there is no valid prior selection. Java flags, heap size, garbage collector, mods, and graphics settings are unchanged.
- Minecraft login records now retain the service-reported expiry in the existing secure credential store. Legacy/unknown/near-expiry records use the established full refresh. A reusable token still validates its Minecraft profile; HTTP 401/403 triggers the full Microsoft/Xbox/Minecraft refresh rather than launching with a rejected identity. Unchanged credentials are not rewritten to Windows Credential Manager on every launch.
- Account validation and cosmetics-session preparation run alongside installation work. Scoped cosmetics sessions are held in memory only and conservatively reused for at most 11 hours (server lifetime: 12 hours). No token enters ordinary cache records, logs, arguments, or timing output. Preparation tasks are aborted when the launch worker exits early.
- Logs report file preparation, account/cosmetics preparation, Java/command preparation, Play-to-process, and the existing game-ready signal in milliseconds. These measurements expose actual bottlenecks; the game-ready log signal is not a benchmark of title-screen interactivity.
- During launch/gameplay, automatic screenshot discovery and queued warming pause. Explicit preview opens remain usable and can promote an already queued job. Up to two in-flight image tasks may finish. Decorative accent/background/UI motion suspends through the existing animation controls and resumes afterward without rewriting the saved preference.

## Limits and cleanup

- The default capacity is 2 GB. The supported range is 0.5–12 GB.
- Cache files live in Bloom's app-data `cache` directory by default. A custom location always uses a dedicated `BloomCache` child directory.
- Writes are atomic. Cleanup removes the oldest cache files when the configured capacity is exceeded and is throttled during bulk archive scans.
- `Clear cache` deletes only the validated dedicated cache directory, recreates it, clears the in-process cache maps, and removes recent Mods searches.

## Correctness boundaries

- Cached instance data never replaces the filesystem as the source of truth. File identity inputs invalidate stale entries automatically.
- Cached catalog results never authorize installation; the existing install path still resolves and validates the selected project and download.
- Cache failures may reduce performance but must not prevent the normal instance or catalog path from working.

## Content installs while Minecraft is running

Resource packs and shader packs may install into the selected instance while its game process runs. Downloads finish into temporary files, verify hashes, and rename into the normal resourcepacks/shaderpacks directory. Minecraft's pack screen and Iris's shader list watch those directories and refresh available entries; users still choose which pack to apply. No forced resource/shader reload interrupts gameplay. Mods still require Minecraft to close, including local file imports.

The native task lock stays held until both the game process and content worker have finished. Content cancellation has its own atomic flag so cancelling a pack download cannot kill Minecraft. A separate process-state event/query drives the frontend's running state; an install error/completion is not a process-exit signal.
