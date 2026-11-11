# Sakura

An original native Rust client for Bloom, targeting vanilla Java Minecraft **26.1** (protocol 775). Sakura uses the published Azalea client libraries and its own wgpu/winit renderer. It does not use or fork Horizon.

**Stage: early Alpha.** Real terrain, movement, inventory, 2×2/3×3 crafting, chest transfers, furnace smelting, mining, placement, and basic chat have passed acceptance against an isolated official vanilla server. Authenticated online-mode joining also passed; secure-profile chat and full Minecraft compatibility remain unverified. Bloom checks the executable's capabilities before offering its engine option; an unready build remains unavailable.

The native UI now targets the actual **Java 26.1** interface rather than Bloom-styled game panels. [UI_PARITY.md](UI_PARITY.md) records the imported assets, shared GUI scale, real inventory/recipe interactions, HUD/text/sound work, reproducible checks, measured resource/runtime costs and precise remaining differences. This is not a claim of complete Java UI or gameplay parity.

## Implemented

- A separate Rust workspace, lockfile, and pinned `nightly-2026-04-15` toolchain. Bloom keeps its stable Rust toolchain.
- Real status/version checks, login/configuration/game transport, movement, collision, gravity, jumping, server state, and clean disconnects through the pinned Azalea 26.1 client stack.
- Actual Minecraft textures and block models from the locally installed, version-matched official client JAR. Baking handles parent models, texture aliases, 26.1 material objects, variants, multipart states, rotations, UVs, cutout/translucent materials, and explicit fluid geometry. The current catalog contains 29,873 state IDs, 1,862 terrain/item/font texture layers, 1,423 item icons, and a separate 199-layer entity texture array, plus the default Steve skin.
- Native terrain rendering with separate sky/block channels, bounded local lighting updates, the 26.1 lightmap calculation, initial smooth lighting/AO and entity shadows, separate opaque/cutout/translucent passes, neighboring-face culling, camera-relative coordinates, and bounded GPU residency. Normal blocks, stairs, fences, plants, and glass use their asset geometry. See [LIGHTING.md](LIGHTING.md) for torch/server verification, performance measurements and remaining parity requirements.
- Packet-driven section revisions: chunk, block, light, and unload changes produce immutable 18³ section snapshots, including a one-block neighbor halo. Meshing runs on a bounded worker, prioritizes nearby sections, rejects stale revisions/worlds, and limits uploads per frame. Unchanged idle terrain is not periodically rebuilt.
- First-person controls, target outline and actual Java HUD assets: hotbar/items/counts/decorations, hearts/absorption/armor/food/air, XP/level, attack indicator, offhand, effects/cooldowns, boss bars, chat, action bar and titles connected to server state. Basic mining/use/attack/respawn controls remain native.
- E opens the actual player inventory with armor/offhand and a 2×2 crafting grid. Using a crafting table opens its 3×3 grid. Chest/shulker, hopper, dispenser, furnace/smoker/blast-furnace and brewing layouts use the real server menu and reference backgrounds. Left/right clicks, split/place, Shift transfers, number-key swaps, Q dropping, atomic drag distribution and double-click collection use native transactions. Crafting results/remainders come from the server. Workstation progress uses server properties.
- The recipe book searches actual server-provided recipes, filters categories/craftability, paginates and places recipes through server display IDs. Shared integer GUI scale governs drawing and hit testing. Actual font providers, styled/translated text, reference tooltips, keyboard menu focus, persisted GUI scale/volume and the real UI button sound replace the earlier custom controls; remaining details are listed in the UI parity document.
- Common mobs use real textures and shared cuboid models, including baby meshes, climate variants, head rotation and walking poses. Movement updates bounded GPU instance transforms; it does not rebuild terrain or mob meshes. Dropped items use their actual item icons. Closed single/double/ender chests now have visible geometry.
- Asset cache loading overlaps network connection setup. Native frame limits, VSync, reduced work while minimized, and stage metrics make startup/render work observable.
- A private stdin account bridge from Bloom, using only the refreshed Minecraft session. Offline test identities are restricted to literal loopback addresses. Required server resource packs are rejected truthfully until applying them is supported.
- A narrowly patched protocol reader with bounded frame/decompression buffers and fatal malformed-connection handling. See [vendor/README.md](vendor/README.md) for attribution and regression coverage; this is not a complete hostile-server security audit.

## Using it from Bloom

The New Instance engine control supports **Minecraft Java** and **Sakura (Alpha)**. Sakura is shown only when the trusted local/bundled executable reports the expected 26.1 Alpha capabilities. Its fields are server address, render distance, and frame limit. Its instance page saves those settings and launches with Play. Existing instances without an engine field continue using Java; invalid or missing native engines fail explicitly instead of silently starting Java.

Sakura instances pin Minecraft 26.1 and use native settings instead of JVM arguments or Java memory limits. Java mods, Fabric loaders, shader packs, shared Java packs, and Bloom's Java cosmetics are not available in Sakura. The normal buttons and sidebar keep Bloom's existing design.

Bloom obtains the official 26.1 client JAR through its verified download path, reuses the installed asset receipt on later launches, and keeps baked assets under its `sakura/cache` directory. The GUI importer additionally verifies the version's asset index 30 and required external font/sound objects, then keeps its provenance/receipt and versioned cache outside source. Launch uses the existing account/process lifecycle, with credentials passed directly to the native child through stdin rather than React, arguments, environment variables, or instance files. No Microsoft refresh token is sent to Sakura.

From the repository root:

```powershell
npm.cmd run build:sakura
npm.cmd run tauri dev
```

`build:sakura` builds an optimized executable, checks its protocol capabilities, and stages it in Bloom's native resources. A fingerprint covers native source, WGSL, manifests/lockfile, toolchain configuration, platform/architecture, Rust flags, and the build script. When that fingerprint and the executable's stamp match the stored receipt, the script reuses the optimized build. Ordinary unchanged development starts therefore avoid rerunning the native compilation. The first release compilation can still take several minutes; build time is separate from game launch time.

## Native development and controls

The examples below run from the repository root. The renderer requires a separately installed official 26.1 client JAR; no game assets or server JARs are committed here.

```powershell
cargo +nightly-2026-04-15 test --locked --manifest-path sakura/Cargo.toml --workspace --lib --bins
cargo +nightly-2026-04-15 build --release --locked --manifest-path sakura/Cargo.toml
.\sakura\target\release\sakura.exe --capabilities

$assets = Join-Path $env:APPDATA 'BloomClient\minecraft\versions\26.1\26.1.jar'
$cache = Join-Path $env:LOCALAPPDATA 'SakuraDevelopment\asset-cache'

.\sakura\target\release\sakura.exe --renderer-smoke --assets $assets --cache-dir $cache
.\sakura\target\release\sakura.exe --server 127.0.0.1:25579 --offline-user SakuraTest --assets $assets --cache-dir $cache --render-distance 8 --fps-limit 0
```

Inside `sakura/`, its toolchain file selects the dated nightly automatically. Do not use `RUSTC_BOOTSTRAP` or alter Cargo's downloaded registry source to bypass a toolchain incompatibility. The previously tried `nightly-2026-11-07` failed in an upstream Azalea generic-constant instantiation; see [upstream issue 384](https://github.com/azalea-rs/azalea/issues/384).

| Control | Behavior |
| --- | --- |
| Click viewport | Capture the pointer. |
| WASD / mouse | Move / look. |
| Space / Shift | Jump / sprint. |
| Left / right click | Mine or attack / use the selected item or block. |
| 1–9 / wheel | Select the hotbar slot. |
| Middle click over storage/player/hotbar slots | Sort that section, waiting for server acknowledgements. |
| Wheel over an ordinary inventory stack | Transfer the stack between sections. |
| F over an inventory slot | Swap with offhand. |
| F1 during gameplay | Toggle HUD visibility. |
| E | Open player inventory; E/Escape closes the active menu. |
| Left / right click in a menu | Pick up/place a stack / split or place one item. |
| Shift-click / 1–9 over a slot | Transfer between sections / swap with that hotbar slot. |
| Drag with a carried stack / double-left-click | Distribute across eligible slots / collect matching stacks. |
| Q / Ctrl+Q over a slot | Drop one item / the stack. |
| Recipe-book button / search / recipe | Open the reference book, filter server recipes, request real recipe placement; Shift requests repeated placement. |
| T / slash | Open chat / start a command. |
| Enter / Escape in chat | Submit / dismiss. |
| Escape | Release capture and open the local pause controls. This does not pause the server. |
| Close window | Cancel the connection and exit. |

Focus loss releases movement and capture. Render distance accepts 2–16 chunks, default 8; frame limit accepts 0–1000, with 0 selecting VSync. `--headless --timeout-seconds 20` runs a bounded connection diagnostic without loading graphics/assets. Headless success requires a connection with actual terrain received. `--renderer-smoke` loads assets, opens an empty native viewport, and exits after five seconds; it tests GPU/window/shader initialization, not server gameplay.

An external authenticated launcher uses `--session-stdin`, sends one bounded JSON object through a private child stdin pipe, and closes the pipe. The fields are `minecraft_access_token`, `uuid`, and `username`; input is limited to 16 KiB and ten seconds. Use Bloom's implemented bridge rather than pasting real sessions into commands, files, screenshots, or logs.

## Historical asset startup measurements

The initial optimized Alpha build was measured on November 8, 2026, on Windows with an Intel Core i5-13450HX (10 cores, 16 logical processors), using the verified official 26.1 client JAR and a new temporary cache directory. OS file caches were not flushed. The first run baked the assets; five subsequent fresh CLI processes reused that cache.

| Measured stage | Result |
| --- | --- |
| First asset bake, one run | 462 ms |
| Warm asset loads, five runs | 32, 32, 33, 32, 33 ms; median 32 ms |
| Whole benchmark CLI process, first run | 1,275 ms |
| Whole benchmark CLI processes, warm | 103, 108, 108, 108, 107 ms; median 108 ms |
| Baked cache size | 20,374,257 bytes, with 13,663 shared model allocations and 187,146 quads |

These are **historical asset-loading measurements**, not time to first frame, time to join a server, FPS, chunk throughput, or a comparison with Java/Sodium/Horizon. Whole-process times include process startup and exit. They used the first optimized terrain-cache schema 1 build, before later models and the separate GUI/font/item atlas. They do not describe current startup cost. Current release measurements and comparison status belong in [UI_PARITY.md](UI_PARITY.md).

Reproduce the asset-only check with an empty cache directory, then run the same command again for a warm load:

```powershell
.\sakura\target\release\sakura.exe --asset-benchmark --assets $assets --cache-dir $cache
```

The runtime emits structured metrics for asset cache hit/load, connection stages, first present/visible world, mesh CPU work, uploads, and visible/resident sections. These stage timings should remain separate when assessing launch speed. No faster-than-Minecraft claim has been established.

The binary asset cache is versioned and checksummed. It validates counts, indices, dimensions, finite coordinates, and total budgets; corrupt or truncated entries rebuild. Cache writes replace atomically. Warm loads use a local source stamp (canonical path, size, modified time, schema) rather than hashing the entire client JAR on every launch. This relies on Bloom's official-JAR verification at installation; it is not an authenticity guarantee against a local file deliberately rewritten while preserving that stamp. Cold baking rechecks the source stamp before publishing its cache. ZIP members are read with size limits and never extracted to filesystem paths.

## Validation and fixtures

Earlier Alpha checks verified November 8, 2026 on Windows are preserved below. The UI pass adds inventory, component-tooltip, text, GUI/font/assets and actual-server conservation/recipe/HUD tests; see [UI_PARITY.md](UI_PARITY.md) for that run and final combined verification status.

| Check | Result |
| --- | --- |
| Complete unit-test baseline | 52 Sakura tests passed after inventory/mob implementation; explicit acceptance tests are ignored in the ordinary command. Protocol checks additionally cover malformed frames/decompression and the corrected VarInt attack entity ID. |
| Focused asset tests | 10 passed, covering archive/material inheritance, multipart selection, rotation/winding, culling, path rejection, oversized inputs, parent/alias cycles, bounded cache decoding, corruption, and atomic replacement. |
| Real 26.1 asset acceptance | Cold bake and warm cache passed using the separately installed official JAR; checked actual stone, stairs, fences, plants, fluid, font, and icon outputs. |
| Executable lifecycle fixtures | Earlier 12 checks passed for mismatch, rejection, malformed/truncated data, required packs, configuration stalls, oversized frames, and decompression bombs. These fixtures do not enter Play. |
| Real offline vanilla movement/collision | Passed movement, jumping, landing, connected state, and clean shutdown in a disposable flat world. |
| Real offline inventory/mining/placement/chat/idle terrain | Passed server inventory reaching the hotbar, server-confirmed mining and placement, chat/command feedback, and no terrain revision churn after the world settled. |
| Real offline crafting/containers | Passed logs→planks and crafting-table creation in 2×2, wooden pickaxe in 3×3, shift transfers, right-click splitting, number swaps, dropping, stale-menu rejection, close/reopen, and coal-powered iron smelting with server receipts. |
| Native viewport inspection | Real terrain textures, glass, stairs, fences, and hotbar were visually checked in a native window. |
| Authenticated online mode | Passed against the official 26.1 loopback server with online mode enabled: real keyring session, private stdin, authenticated join and live terrain; no credential output. Secure-profile/signed chat remains unverified. |

Run the executable lifecycle checks after building:

```powershell
python sakura/tests/smoke.py sakura/target/release/sakura.exe
```

Real-server tests are opt-in and never create/configure a server or accept agreements. Prepare a disposable official 26.1 flat server listening only on `127.0.0.1:25579`, with offline mode for these fixtures. The interaction test additionally requires operator permission for its `SakuraGameplay` test identity; it creates/removes test blocks and gives inventory in that disposable world.

```powershell
cargo +nightly-2026-04-15 test --locked --manifest-path sakura/Cargo.toml vanilla_loopback_movement_and_ground_collision -- --ignored --nocapture
cargo +nightly-2026-04-15 test --locked --manifest-path sakura/Cargo.toml vanilla_loopback_inventory_mining_placement_chat_and_idle_terrain -- --ignored --nocapture
cargo +nightly-2026-04-15 test --locked --manifest-path sakura/Cargo.toml vanilla_loopback_real_crafting_containers_and_cursor -- --ignored --nocapture

$env:SAKURA_TEST_CLIENT_JAR = $assets
cargo +nightly-2026-04-15 test --locked --manifest-path sakura/Cargo.toml assets::tests::real_version_matched_assets_cold_and_warm -- --ignored --nocapture
```

## Current limits

- Only Minecraft Java 26.1/protocol 775 is supported. No Java/Fabric mods, Java shader packs, singleplayer world generation, or Java-client feature parity is implied.
- Authenticated online-mode joining passed. Expired-session recovery and secure-profile/signed-chat interoperability still need live acceptance. Basic chat/commands passed the offline vanilla fixture.
- 176 block-entity-only block names still need dedicated renderers, including beds and signs. Chests render in their closed state; opening animations are not implemented.
- Other players use the default Steve skin and simple cuboids; personal skins and full player animation are not implemented. Unsupported entity kinds retain an explicit diagnostic fallback. See creature coverage below; equipped mob armor/weapons and full special animations remain outstanding.
- World animated textures show their first frame; imported animated GUI sprites retain their reference frames/timing. Biome-tinted vegetation/water use default plains colors; weighted model alternatives choose one stable variant. Fluids have explicit surfaces and stacked-fluid handling, but not vanilla flow/interpolated-surface parity. Translucency and lighting remain Alpha implementations.
- Inventory/manual crafting, server-backed recipe placement and common containers are implemented. Recipe variants/ghost feedback, the creative catalog, enchanting/trading/anvil and other special workstation controls, advanced item-use parity, and complete death/respawn/dimension-transition acceptance remain outstanding. A bounded unknown menu is not a completed layout; unsupported action buttons must not be faked.
- The native UI has remaining font/language, dynamic item appearance, legacy preview-skin/equipment, tooltip-provider and HUD timing/context gaps documented in [UI_PARITY.md](UI_PARITY.md). The new GUI asset cache is separate from the terrain icon/layer counts quoted above.
- Server resource packs cannot yet be applied; required packs fail explicitly. Full hostile NBT/allocation auditing, long-session stress tests, broad GPU testing, and comparative frame-time/power benchmarks remain outstanding.

See [SAKURA_ARCHITECTURE.md](../SAKURA_ARCHITECTURE.md) for the design and compatibility boundaries. No release, version bump, tag, or Minecraft asset redistribution is part of this Alpha implementation.

## Creature models

Sakura now renders 21 common creature kinds with reusable textured meshes instead of diagnostic shapes. Cuboid dimensions, joint pivots, skin UV regions, and the new baby proportions were checked against the model classes in the locally installed official 26.1 client JAR. The implementation is native Rust; Minecraft PNGs are read from the verified local installation and are not redistributed with the source.

| Family | Supported kinds |
| --- | --- |
| Farm animals | Cow, pig, chicken, sheep |
| Companions and small animals | Wolf, cat, ocelot, rabbit |
| Humanoids | Zombie, husk, drowned, zombie villager, skeleton, stray, wither skeleton, villager |
| Other hostile mobs | Creeper, enderman, spider, cave spider, slime |

The 33 geometry templates include distinct 26.1 baby models where applicable, warm/cold cow shapes, cold pig/chicken shapes, smaller cave spiders, and taller wither skeletons. Skin selection uses available server metadata for climate and animal variants, baby state, wolf mood/taming, sheep wool, collars, and villager biome/profession layers. Model-space head look and walking update joint transforms; the native renderer interpolates movement. Unknown variants use the appropriate supported default skin rather than becoming arbitrary asset paths.

Supported creatures use a separate array of 199 entity skins plus the 64×64 vanilla shadow texture, each padded to 64×64 without resizing its original pixels. The 200 layers occupy 3.125 MiB of texture pixels and leave the terrain array independent. The catalog loads only skins used by these templates and variants. Both arrays persist in the validated asset cache. Immutable mesh templates and GPU buffers are reused; per-frame animation writes a fixed, bounded set of part transforms. Identical material-overlay joints reuse their base transforms instead of repeating pose calculations.

Five focused model tests passed before the overlay-transform optimization, covering cuboid skin UVs/winding, model bounds/hierarchies, species and baby proportions, material/template reuse, and finite animated transforms. A further regression test compares prelinked overlay transforms with independent joint evaluation; its final combined run is tracked with the main validation results. Actual-JAR cold/warm acceptance also checked every required skin path, byte-for-byte original creeper texels, transparent padding, and cache round trips. Native viewport inspection confirmed recognizable textured cows, pigs, sheep, and wolves; this is not visual acceptance of every supported variant or action.

Remaining creature work includes unsupported families such as horses, piglins, mooshrooms, fish, and bosses; equipment/armor/held-item layers; complete combat, swimming, flying, sitting, and special-state animations; charged/swelling creepers; slime squashing; and full emissive/scene-lighting behavior. Sitting poses and basic gait are early implementations, not exact vanilla animation parity. Remote players still use the existing default-skin path. Unsupported creatures are not presented as completed models.

The same skin-layout baking now provides visible **closed** normal, trapped, and ender chests, including double-chest halves and their facing. Body, lid, and latch use the official chest textures with unscaled pixel patches. Opening animation is not implemented. With these three block families covered, 176 block-entity-only block names still need dedicated rendering. The current terrain array contains 1,862 layers and 1,423 item icons; these counts replace the earlier pre-creature/pre-chest asset baseline above.
