# Sakura: native Minecraft client research and implementation plan

Researched and extended November 8, 2026. Status: native Alpha under `sakura/` with version-matched texture/model loading, section streaming, basic human controls and Bloom engine integration. This is not full vanilla gameplay parity. The engine selector is gated by a trusted executable capability check. See `sakura/README.md` for verified checks and remaining limitations.

## User requirements

- Name the new runtime Sakura. Bloom's launcher uses Bloom's design language; the latest scoped UI request makes Minecraft Java 26.1 the visual/behavioral reference inside the native runtime.
- Build an original Rust client; do not use or fork Horizon.
- First target: joining vanilla Java Minecraft servers. Parks explicitly selected this over standalone worlds and existing modpack compatibility.
- Choose Sakura when creating an instance in Bloom, with a real native launch path.
- Performance is the highest priority: fast cached startup, responsive chunk arrival, smooth frame times, no repeated whole-world rebuilding, and no avoidable idle work. Keep playability and correctness; measure before claiming speed.
- Investigate performance seriously, including focused Rust libraries; do not equate Rust, a niche dependency, or a small synthetic benchmark with proven faster gameplay.

## Recommended architecture

Use a separate native executable: Sakura owns rendering, controls, menus, HUD, asset/model baking and the boundary between network state and visible world. Use selected Azalea client libraries for Minecraft connection/state infrastructure. Bloom owns accounts, instance persistence, trusted installation, updates and process lifecycle. This is an original client built using libraries, not a reskinned existing client.

| Concern | Starting choice | Reason / boundary |
| --- | --- | --- |
| GPU rendering | `wgpu`, own WGSL terrain/model renderer | Native DX12/Vulkan on Windows with portable backends; control chunk rendering directly. |
| Window/input | Stable `winit` 0.30 line | Native window, pointer capture, resize and input; separate from Tauri's web UI. |
| Math | `glam` | Compact vector/matrix math; choose a tested compatible release. |
| Minecraft client state | Pinned `azalea-client` and required subcrates | Connection, chunks, movement and inventory infrastructure; graphics remain Sakura's work. Avoid umbrella bot pathfinding/swarms. |
| ECS/runtime | Reuse the exact Bevy ECS/Tokio versions required by the pinned protocol stack | Do not introduce multiple competing simulation clocks or oversized worker pools. No need to adopt Bevy's entire renderer. |
| NBT decoding | Azalea's `simdnbt` path | SIMD-oriented decoding is relevant to real incoming Minecraft data. Avoid duplicate parsers until profiling justifies one. |
| Meshing | Correct 16-cube section baseline, then measured greedy/bit-mask optimization | Full-cube merging is only one part of Minecraft rendering. Preserve separate model/fluid paths. |
| Assets | Version-matched client JAR/resources from Bloom's existing verified cache | Do not distribute game assets inside Sakura or use Java's whole launch/install pipeline unnecessarily. |

The renderer recommendation is engineering judgment, not a measured speed comparison. Wgpu supports native Vulkan, Metal, DX12 and GLES; its current checked crate is 30.0.1. Winit's stable line includes 0.30.13. [wgpu](https://wgpu.rs/), [winit releases](https://github.com/rust-windowing/winit/releases), [glam](https://github.com/bitshifter/glam-rs)

## Version and toolchain decision

The reproducible first candidate is the published **Azalea 0.16.0+mc26.1**, targeting **Minecraft 26.1 only**. Its downloaded crate manifest uses Bevy ECS 0.18.1. Current development source instead identifies Minecraft 26.2 and uses Bevy 0.20; do not combine documentation or types from those two dependency sets. Azalea is unfinished and does not promise simultaneous multi-version support. Neither candidate establishes 26.3 support. [Published client](https://docs.rs/azalea-client/0.16.0+mc26.1/azalea_client/), [current workspace](https://github.com/azalea-rs/azalea/blob/main/Cargo.toml), [project scope](https://github.com/azalea-rs/azalea)

Azalea uses unstable Rust features. Its published source contains `#![feature(error_generic_member_access)]`, and current upstream selects nightly. Sakura's separate workspace is verified with **nightly-2026-04-15** and its own dependency lockfile; Bloom retains stable Rust and its existing dependencies. Do not use `RUSTC_BOOTSTRAP` to disguise this requirement. Initial testing of nightly-2026-11-07 exposed a generic-constant inference failure in Azalea's published dependency chain. [Upstream toolchain](https://github.com/azalea-rs/azalea/blob/main/rust-toolchain.toml), [upstream compiler issue](https://github.com/azalea-rs/azalea/issues/384)

Expose only the protocol/version that passes real server acceptance tests. A newer Minecraft version requires a deliberate adapter/library upgrade and the same tests, not a different label in a dropdown.

## Alternatives investigated

| Alternative | Finding | Decision |
| --- | --- | --- |
| Full Bevy engine | Maintained, modular, useful for building a complete game quickly; 0.20.1 requires Rust 1.97.1. | Valid alternative, but not necessary for a specialized terrain renderer. Reuse its ECS where required. |
| Raw Vulkan through `ash` | Thin unsafe bindings give direct API control and significant synchronization/resource-lifetime responsibility. | Reserve for a demonstrated wgpu bottleneck; no automatic speed advantage established. |
| `vulkano` | A maintained higher-level Vulkan option including synchronization support. | Viable if Vulkan-only becomes an explicit requirement; weaker portability fit here. |
| `rend3` | Archived June 7, 2025. | Do not choose as a new long-term foundation. |
| `wgpu-mc` | Minecraft renderer replacement integrated through a Fabric/Java backend; undergoing a major rewrite. | Different scope from an independent Minecraft client. |
| Azalea protocol only | Typed low-level Minecraft connection and packets. | Viable later if Sakura needs to own more client simulation; substantially more initial state-machine work. |
| `mc_protocol` | Generic framing/serialization/transport tools. | Not a complete modern client implementation. |
| Pumpkin / SteelMC / FerrumC / Valence | Server implementations or a server framework. | Not substitutes for client networking, player prediction and rendering. |
| Existing whole Rust clients | Useful evidence about the amount of work involved. | Do not adopt their finished applications as Sakura's implementation. |

Sources: [Bevy](https://bevy.org/news/bevy-0-20/), [ash](https://github.com/ash-rs/ash), [vulkano](https://github.com/vulkano-rs/vulkano), [rend3](https://github.com/BVE-Reborn/rend3), [wgpu-mc](https://github.com/wgpu-mc/wgpu-mc), [Azalea protocol](https://azalea.rs/azalea_protocol/index.html), [mc_protocol](https://docs.rs/mc_protocol/latest/mc_protocol/), [Pumpkin](https://github.com/Pumpkin-MC/Pumpkin), [SteelMC](https://github.com/Steel-Foundation/SteelMC), [FerrumC](https://github.com/ferrumc-rs/ferrumc), [Valence](https://github.com/valence-rs/valence).

## Focused performance opportunities

`binary-greedy-meshing` is worth benchmarking: it uses bit masks and packed quads, but its current API uses 62-cube active chunks inside padded 64-cube arrays. Minecraft's section boundaries are different. Do not reorganize the whole world around that library without measuring update/neighbor costs. Its meshing microbenchmarks do not establish client FPS. `block-mesh` provides flexible visible-face and greedy-quad implementations suitable as an independent correctness/performance baseline. [Binary greedy meshing](https://github.com/Inspirateur/binary-greedy-meshing), [block-mesh](https://github.com/bonsairobo/block-mesh-rs)

`simdnbt` provides borrowed and owned decoding paths. Borrowed reads may reduce copying, but buffers must outlive those views. Treat malformed data and allocation limits as part of the network boundary. [simdnbt](https://github.com/azalea-rs/simdnbt)

Sakura-specific design priorities:

1. Store blocks densely or in palettes per section; do not create an ECS entity/draw call per block.
2. Split optimized full cubes, baked block-model quads and fluid surfaces. Handle blockstates, model parents, multipart variants, rotations, UVs and biome tint explicitly.
3. Use opaque, alpha-cutout and translucent passes. Merge only faces compatible in material, texture orientation, lighting and ambient occlusion. Texture animation should not remesh terrain.
4. Feed bounded mesh jobs immutable section/neighbor snapshots and revisions; discard obsolete results. Prioritize near sections and cap GPU uploads per frame to prevent arrival stutter.
5. Start with CPU frustum culling and pooled GPU allocations. Add GPU occlusion/indirect drawing only where supported and measured beneficial.
6. Use precise world coordinates with camera-relative GPU coordinates. Apply actual server skylight/block-light data.
7. Keep simulation ticks, network work and render frames decoupled. Never block rendering on DNS, token refresh, chunk decoding, model loading or a long ECS/world lock.
8. Cap worker counts and queues instead of allowing every subsystem to occupy every logical CPU. Suspend unnecessary work when minimized.

These are engineering recommendations. Minecraft models require more than a cube mesher; [Fabric's model documentation](https://docs.fabricmc.net/develop/blocks/block-models) describes relevant model structure. [Rayon pool configuration](https://docs.rs/rayon/latest/rayon/struct.ThreadPoolBuilder.html) supports explicitly bounded workers.

## Bloom integration boundaries

Use a serialized `engine` enum with a backward-compatible Java default, plus a Sakura-specific configuration object. Do **not** store Sakura only in `loader`: Bloom currently treats non-Fabric loader values as vanilla Java in its launch path.

Current Alpha creation flow:

- Choose **Minecraft Java** or **Sakura — Experimental** using Bloom's existing selection controls.
- Java keeps its current Vanilla/Fabric loader, versions and JVM settings.
- Sakura shows a genuinely supported protocol, server address and native graphics controls. It does not display Java memory/JVM options or advertise Fabric/Java shader support.
- Keep existing instance identity, artwork, folder, normal buttons and sidebar presentation.
- Availability comes from a native capability check against a trusted Sakura executable/build. Do not expose a working-looking engine option before a real binary can run it.

Native work belongs in a focused `src-tauri/src/sakura.rs` adapter; game code belongs in a separate `sakura/` workspace. Dispatch before Java preparation. Preserve the active-game lock, cancellation, logs and process lifecycle. Missing or incompatible Sakura must report an actionable error, never silently launch Java. Sidecar readiness is structured (`ready`, `connecting`, `joined`, `disconnected`, `error`), not guessed from Java/OpenAL log strings.

Other existing paths need explicit capabilities: mod installation, content transfers, shader folders, shared packs, AutoTune, utility synchronization, duplicate/export/import and instance settings. Old instance files must continue loading as Java.

Inspected integration points: `src/main.tsx` (`InstanceDraft`, `NewInstancePage`, `InstancePage`, launch handler); `src-tauri/src/lib.rs` (`InstanceConfig`, `save_instance_blocking`, `launch_session`, `prepare_instance_files`, `launch_minecraft`); `src-tauri/tauri.conf.json` and `src-tauri/build.rs`. The local build now stages the optimized sidecar at `src-tauri/resources/sakura/sakura.exe`; the build script fingerprints sources and reuses unchanged output. No release has been published.

## Authentication and untrusted server data

Reuse Bloom's refreshed Minecraft session and OS keyring. Provide only the Minecraft access token, UUID and username to the trusted native child through an inherited private pipe. Never put authentication payloads in React, command-line arguments, environment variables, instance JSON or logs. A custom account adapter must redact its Debug output. Do not send the Microsoft refresh token or create a second plaintext authentication cache.

Azalea exposes `AccountTrait` for a custom account and online-mode session joining. Its convenience Microsoft-access-token constructor expects a Microsoft token, not Bloom's already-exchanged Minecraft token. Implement the correct sessionserver join, certificate and refresh behavior against the pinned version. [Account adapter](https://docs.rs/azalea-client/0.16.0+mc26.1/azalea_client/account/trait.AccountTrait.html), [Microsoft account API](https://docs.rs/azalea-client/0.16.0+mc26.1/azalea_client/account/microsoft/index.html)

Bound packet and decompression sizes, NBT depth/allocations, chunk residency and pending jobs. Resource packs need bounded downloads, archive-path checks and a real applied/failed response. Never acknowledge a required resource pack as loaded if it was not applied. Server text, URLs and content must not become shell commands or unprompted native execution.

The prototype review found missing wire-frame limits and unbounded zlib expansion in the published protocol reader. Sakura now uses a local, attributed `azalea-protocol` override with bounded frames/buffers/output, exact zlib validation and fatal malformed-connection handling. See `sakura/vendor/README.md` for the precise patch and regression tests. This fixes those specific transport issues; it does not establish a complete hostile-server or NBT security audit.

## First playable milestone and acceptance

This is a substantial client project. A connection probe, a bot, a floating camera or a generated block scene does not meet the playable milestone.

1. Server list/status ping, clear protocol mismatch reporting and cancellation.
2. Real online-mode authentication, encrypted/compressed transport, configuration/registry exchange and transition to Play.
3. Actual server terrain rendered with the matching version's textures/models and lighting.
4. Keyboard/mouse movement, camera, collision, gravity, server correction, keepalive and clean disconnect/reconnect.
5. Basic entities/players, HUD/hotbar, signed chat, block interaction and inventory transactions.
6. Bloom creates the native instance and launches that verified implementation end to end.

Use a version-matched official vanilla server as the acceptance oracle. Cover online mode, expired token handling, secure-profile chat, compression, teleport correction, death/respawn, dimension changes, chunk updates/unloads, disconnects and required packs. A successful offline-mode development test is not proof of online-mode compatibility.

Java mod JAR execution, arbitrary Minecraft versions, full resource-pack compatibility and singleplayer world generation are separate milestones. They must not be inferred from the first server connection.

## Performance evidence required

Benchmark release builds on identical routes/scenes, resolution, settings, render distance and server conditions. Include vanilla Java and a documented optimized Java/Sodium baseline, discrete and integrated GPUs, cold/warm caches, static scenes and rapid exploration. Report p50/p95/p99 frame time, CPU/GPU time, chunk-arrival stalls, decode/mesh/upload costs, RAM/VRAM and laptop power use. Record machine, drivers, build revisions and repetitions. Do not publish a faster-than-Minecraft/Horizon claim from different scenes or a meshing-only benchmark.

The original prototype passed isolated vanilla loopback movement/collision checks. The Alpha replaces its quarter-second whole-world sampling with packet-driven section revisions and actual asset models. Current acceptance evidence and remaining compatibility limits belong in the runtime README; do not treat offline acceptance or first-frame timing as proof of complete online gameplay or comparative performance.


## Implemented performance boundaries

Lighting now has its own [implementation and verification record](sakura/LIGHTING.md). Server light arrays seed separate known/unknown block and sky channels; block edits also run bounded local propagation, including decreases and direct sky shafts. Raw lighting must never depend on display brightness. The installed 26.1 state registry supplies lighting properties, and rendering uses the 26.1 lightmap calculation rather than a maximum-channel brightness approximation. Complete Java visual parity and the full lighting benchmark matrix remain outstanding; see that record before extending or describing the feature.

- Inventory snapshots are shared through `Arc` and published only when packets/actions mark them dirty. Every queued click includes the current menu ID and generation; the connection thread drains the bounded queue once. Crafting output comes from the server, and the pinned client's missing cursor/state-ID packet handling is repaired in a narrow ordered adapter.
- Creature appearance metadata is sampled separately from terrain. Shared immutable model meshes and a separate bounded texture array avoid terrain-array growth; per-frame movement changes camera-relative part transforms in reused instance buffers. Distance/frustum culling precedes pose work. Entity CPU update percentiles and transform-upload bytes are reported separately from terrain metrics.
- Protocol visual metadata must include initial body/head rotations, later head-rotation packets, sheep dye flags, age/variant state and removal/world changes. Invisible entities are excluded. The renderer never infers ownership, gameplay authority or collision from its visuals.

- Bloom validates/downloads the official26.1 client JAR once and records a file receipt. Warm launches reuse a valid keyring session instead of making a redundant profile request; server/session authentication still validates it.
- Sakura overlaps asset-cache loading with connection setup. Cold setup bakes JSON/models and PNGs; a bounded binary cache with schema/source metadata/checksum removes those decodes on later launches. No proprietary assets ship with the executable.
- Chunk/block/light/unload packets identify dirty sections. Immutable18³ snapshots include a one-block neighbor halo; only changed sections are expanded/meshed. Empty sections are discarded early. World epochs and revisions discard stale worker output.
- Section work is near-first, bounded and off the rendering thread. GPU residency and per-frame uploads are bounded; frustum culling avoids drawing unseen terrain. Mesh buffers are reused, and minimized windows stop unnecessary frame work.
- Default presentation follows vsync; an explicit native frame limit is available. Render distance is native server/view distance, independent of Java heap/JVM settings.
- Stage timings report asset cache hit/load, server join, first sections, first present, first visible world, mesh CPU and upload volume. Log stages truthfully: asset-cache load alone is not total launch time.
