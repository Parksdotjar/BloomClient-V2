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

## Limits and cleanup

- The default capacity is 2 GB. The supported range is 0.5–12 GB.
- Cache files live in Bloom's app-data `cache` directory by default. A custom location always uses a dedicated `BloomCache` child directory.
- Writes are atomic. Cleanup removes the oldest cache files when the configured capacity is exceeded and is throttled during bulk archive scans.
- `Clear cache` deletes only the validated dedicated cache directory, recreates it, clears the in-process cache maps, and removes recent Mods searches.

## Correctness boundaries

- Cached instance data never replaces the filesystem as the source of truth. File identity inputs invalidate stale entries automatically.
- Cached catalog results never authorize installation; the existing install path still resolves and validates the selected project and download.
- Cache failures may reduce performance but must not prevent the normal instance or catalog path from working.
