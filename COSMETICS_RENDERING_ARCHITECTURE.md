# Bloom cosmetics rendering architecture

> Current v1.1.5 integration: only capes and the single-label nametag badge initialize. Hat/wing/bracelet sources remain dormant. Vanilla elytra is preserved. Renderer downloads are bounded and textures have memory accounting/disposal. Game-session credentials arrive through the child environment, not command arguments. See `CAPES_IMPLEMENTATION_STATUS.md` for remaining multiplayer acceptance work.

## System flow

Bloom cosmetics were split across four responsibilities:

1. The external manager authored and published catalogs, models, textures, previews, pivots, and animations.
2. The backend stored authoritative catalog/ownership/equipped records and returned short-lived URLs for private assets.
3. Bloom Client provides the free Locker and equip UI and installs the Bloom Fabric renderer into supported managed instances.
4. The Fabric renderer looked up cosmetics for visible player UUIDs and attached them to Minecraft's player model parts.

Locker is active. Shop, ownership, and paid catalog behavior remain removed. `bloom-cosmetics-mod/` is active source: its remapped JAR is embedded in Bloom and reconciled into supported Fabric 1.21.11 instances without deleting unknown user files.

## Runtime identity, batching, and performance

`BloomCosmeticsRuntime` uses `https://api.north.bloomclient.org/minecraft` as its historical API base and identifies itself as Bloom Cosmetics 1.5.0. It has one low-priority refresh worker, polls every two seconds, remembers players observed in the last 20 seconds, and caps a batch at 100 UUIDs.

For the local player it uses the stable UUID from the Minecraft account session, not a world-scoped entity UUID. That distinction prevents cosmetics from disappearing or crossing identities after proxy/server transfers. Other players use their entity UUIDs.

Model downloads are limited to 2 MB. Static cape and elytra downloads are limited to 40 MB and 4096 by 2048 pixels; animation atlases retain their separate 32 MB and 4096 by 4096 limits. Network work happens asynchronously; texture registration is handed back to Minecraft's render thread. Model/texture/atlas data is cached by cosmetic ID and immutable revision. Animation frames are selected locally—there is no request per rendered frame.

## Player renderer integration

`PlayerEntityRendererMixin` installs feature renderers for hats, wings, and bracelets. `AbstractClientPlayerEntityMixin` supplies Bloom cape/elytra textures. A wing with `hideCape` makes the vanilla cape and elytra texture unavailable for that player so the two visuals do not overlap.

Attachment behavior:

- Hats attach to the player root and then the head model part. Their configured offset is converted from model pixels to Minecraft units by dividing by 16, followed by uniform scale.
- Wings attach to the player root and then the body model part.
- Bracelets attach to the selected left or right arm. Offset, pivot, X/Y/Z rotation, and uniform scale are applied from published metadata.

Hats can set `hideWithHelmet`. A spin animation uses elapsed monotonic time and rotates locally around the Y axis; it does not contact the backend per frame.

## Models, groups, and “bones”

The runtime model is a constrained cuboid mesh, not a general-purpose skeletal animation package. Its bone-like behavior comes from preserving named groups, animation parts, and pivots from the authoring tool.

The JSON format contains `formatVersion`, texture and UV dimensions, and at most 512 cuboids. Each cuboid can include `from`, `to`, `pivot`, `rotation`, faces, UV coordinates, face rotations, and animation metadata. The manager must preserve the meaningful Blockbench hierarchy when converting a model; flattening everything into anonymous cubes destroys hinge placement.

Supported animation metadata includes:

- Spin: `{ "type": "spin", "speed": ... }`
- Flap: `{ "type": "flap", "speed": ..., "amplitude": ..., "axis": "x|y|z" }`

Runtime validation clamps spin/flap speed to 0.05–4 and flap amplitude to 1–60 degrees.

## Wing bone/hinge animation

The wing mesh parser separates geometry into fixed parts, left flap, and right flap. The preferred manager output explicitly labels groups as `left_root`, `right_root`, `left_flap`, and `right_flap`. If the labels are absent, the runtime falls back to classifying cuboids by their X-axis center; that fallback is less reliable and should not replace correct manager metadata.

Each animated wing side has an `animationPivot`. The default pivot is `(0, 6/16, 0)`. On every render frame, the renderer computes:

`angle = sin(time * speed * 2π) * amplitude`

The left flap receives `+angle` and the right flap `-angle` around the chosen axis. The transform order is translate to pivot, rotate, then translate back. Root groups stay fixed while flap groups move, producing a paired hinge/bone effect. This work is local matrix math and remains performance-friendly.

The manager must therefore export the correct side labels and each wing's hinge pivot. A beautiful model with a wrong pivot will flap around its center or detach visually from the player even though the renderer is functioning correctly.

## Animated capes

Cape animation uses a texture atlas rather than bones. The manager converts an MP4, WebM, or GIF into:

- a static first-frame cape texture for previews and fallback;
- a private atlas containing the ordered animation frames; and
- metadata: animation revision, frame count, columns, rows, frame width/height, FPS, and looping behavior.

The Fabric response includes a short-lived `atlasUrl`. The renderer downloads the atlas once per revision, slices each cell into a `NativeImage`, registers the frames as Minecraft textures, and selects the current frame from monotonic time. Looping animations use modulo; non-looping animations clamp to the final frame. If atlas loading fails, the static cape remains available.

The established safety limits are 120 frames, a 4096 by 4096 atlas, 32 MB atlas bytes, 1–30 FPS, and 2:1 frame dimensions with widths from 64–2048. The preferred authoring range is a 512 by 256 source, 12–16 FPS, and a 2–4 second loop. See `BLOOM_ANIMATED_CAPES_GUIDE.md` for the publishing workflow.

## Launcher previews versus in-game rendering

These are deliberately different pipelines:

- The manager renders preview PNGs for hat, wing, and bracelet cards. The launcher requests those previews and never needs to understand their live 3D meshes.
- Cape cards can preview the cape texture through `skinview3d`.
- The Fabric mod downloads the actual revisioned model and texture only when an observed player's equipped record requires them.
- Animated-cape previews can use a static first frame while Minecraft uses the atlas.

Keeping previews separate makes the Shop lightweight and lets the manager control a consistent catalog presentation. It also means preview generation must be part of every publish operation; uploading only the runtime model leaves the launcher with an incomplete item.

## Backend and storage rules

- Catalog IDs and revisions are immutable public identifiers. Publish a new revision instead of replacing bytes under an old one.
- Models, textures, previews, and atlases belong in private object storage. The backend returns narrowly scoped, short-lived URLs.
- Database service credentials, object-storage signing keys, and manager secrets must never be compiled into the launcher or Fabric JAR.
- Public equipped lookup must be batched and rate-limited but fast enough for player joins.
- A missing or invalid item must degrade to no cosmetic/static fallback, never crash the render loop.
- The server should validate the Minecraft identity behind authenticated collection and equip mutations.

## Build and bundle contract

- `bloom-cosmetics-mod/`: active Fabric renderer and model parsers.
- `scripts/build-cosmetics-mod.mjs`: builds the remapped renderer, copies it into Tauri resources, and writes its SHA-256 checksum.
- `npm run tauri:dev`: builds the renderer before the Vite/Tauri development client starts.
- `npm run tauri:build`: builds the renderer and frontend before Tauri creates installer and updater artifacts.
- Enabled release compilation fails if the renderer is absent or its checksum is invalid. Only an explicit emergency `BLOOM_COSMETICS_ENABLED=false` build may omit active integration.
- A locally generated unsigned installer proves compilation and bundling only. A publishable updater additionally requires the owner-only Release Manager to supply Tauri's private signing key; never weaken or bypass that signature requirement.
- `BLOOM_ANIMATED_CAPES_GUIDE.md`: cape atlas authoring.
- `BLOOM_ANIMATED_MINI_WINGS_GUIDE.md`: wing authoring and pivots.
- `ANIMATED_COSMETICS_GUIDE.md`: common animation format.
- `CUSTOM_HALO_HAT_GUIDE.md`: hat model example.

Do not bypass these scripts with a raw release Cargo build. The build contract prevents a distributable client from exposing Locker while silently omitting its renderer. Production publication still requires the live acceptance checks recorded in `CAPES_IMPLEMENTATION_STATUS.md`.
