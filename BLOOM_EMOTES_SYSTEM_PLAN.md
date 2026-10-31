# Bloom emote system architecture

Updated October 18, 2026. This replaces the proposal with the implemented architecture. [BLOOM_EMOTES.md](BLOOM_EMOTES.md) records actual acceptance and pending tests; source implementation does not establish production deployment.

## Components

| Component | Responsibility |
| --- | --- |
| scripts/emotes.mjs | Bounded validation, additive import, deterministic catalog/revision generation |
| EmoteCatalog | Parse bundled clips once using PAL |
| BloomEmotes | Per-player layer, gameplay cancellation, camera ownership and world lifecycle |
| EmoteWheelScreen | Hold-B wheel, eight slots/page, outward-extended hit wedges, release-to-select, Stop and camera preference |
| EmoteSettings | Atomic instance preferences, preserving unknown fields |
| EmoteNetwork | Scoped auth, serialized WebSocket traffic, snapshots, timing, retries and cleanup |
| backend/emotes/relay.mjs | Verified identities, scoped fan-out, ordering, leases, revocation and budgets |
| Existing native reconciler | Versioned installation/update with ownership and opt-out protections |

## Versions and packaging

Stonecutter builds 1.21.11 (Java 21/Yarn) and 26.1/26.2/26.3 (Java 25/unobfuscated). Shared source adapts keybindings, screens, render extraction, player state, sessions and PAL bone access. Emotes animate the existing player; they add no player/nametag renderer.

| Minecraft | PAL | Fabric API | Minimum loader |
| --- | --- | --- | --- |
| 1.21.11 | 1.1.10+mc.1.21.11 | 0.141.6+1.21.11 | 0.19.2 |
| 26.1 | 1.2.8+mc.26.1 | 0.145.1+26.1 | 0.19.2 |
| 26.2 | 1.2.8+mc.26.2 | 0.161.0+26.2 | 0.19.3 |
| 26.3 | 1.2.8+mc.26.3 | 0.163.0+26.3 | 0.19.5 |

Dependencies are pinned and packaged with Fabric nested JAR metadata. Modern PAL includes its separate Core artifact; the older Fabric artifact embeds Core. Notices remain under META-INF/licenses and within upstream JARs.

Gradle resource processing depends on content validation/generation. Runtime assets are generated under assets/bloom_cosmetics/emotes as catalog.json and revision-named clips. Authoring geometry stays out of the mod. Existing tooling copies all four built JARs and SHA-256 sidecars into Tauri resources.

## Loading and playback

The catalog reads its classpath once and shares parsed clips. Resource packs cannot replace these assets. The JAR is the persistent cache: no redundant disk copies, per-frame parsing or wheel-time fetching. Per-player state clears on unload/world changes.

Before PAL parses a clip, EmoteCatalog orders each rotation/position timeline by numeric timestamp. Never depend on JSON object insertion order: JavaScript emits whole-number keys ahead of fractional keys, and native serializers can sort lexically. PAL builds segment durations from member order rather than sorting them. Passing raw editor JSON directly caused negative segment lengths, skipped layered motion, and linear-looking entry curves. Sorting happens once on load, preserves all values/easing, and fixes already-exported projects without modifying their source or revisions. Constant arrays/vector tracks remain intact.

Bloom registers PAL layer priority 1000 with first-person hand animation disabled. Actual skins, outer layers and PAL armor integration remain. Visual compatibility beyond the recorded test matrix requires testing.

Playback starts locally immediately. Authored curves control entry and exit; no automatic fade multiplies the first/last four ticks of a clip. Gameplay cancellation is immediate. Once ends, Loop repeats, Hold retains its final pose. Late loops normalize elapsed time modulo duration; held poses clamp to the end.

Starts require a living grounded player outside spectating, riding, swimming, gliding, swinging and item-use states. Movement, input, damage, incompatible poses, focus loss, world changes and completion clear playback. Observers also cancel on observed movement/pose changes. Animation never changes position, velocity, reach or collision; Sit retains its standing hitbox.

Auto third person defaults on and toggles with C. Bloom restores only a camera it owns; manual changes release ownership. Preferences use the instance's config/bloom-emotes.json and preserve unknown fields.

## Multiplayer

WSS uses the existing API base plus /v1/emotes/socket. Launcher games receive BLOOM_COSMETICS_SESSION; authenticated standalone Minecraft launches can bootstrap through the existing session endpoint. Only a scoped session reaches the relay, in Authorization. No tokens appear in URLs or event payloads.

The server derives UUIDs from the real session store and checks expiry/revocation. Clients verify handshake identity and refuse remote publication when the account UUID differs from the local entity. Offline/spoofed mappings retain local playback.

Subscriptions contain at most 100 loaded UUIDs and a SHA-256 scope derived from server address/dimension. Scope is a routing hint, not proof of server membership. Different aliases currently produce different scopes. Raw server addresses are not sent.

Protocol 1 supports hello, subscribe, snapshot, ping/pong, start, stop and renew. Events contain verified UUID, connection ID, increasing sequence, playback UUID, emote ID/revision, server start time and expiry. No animation bodies or arbitrary asset URLs are transmitted.

Starts are server-timestamped with a bounded reconnect phase offset. Clients estimate clock offset with ping round trips and advance remote playback. Synchronization is approximate, not frame-perfect. New observers receive current state; unknown IDs/revisions are skipped. Stale stops cannot cancel later playback. Duplicate snapshots renew leases without resurrecting cancelled poses.

Loops/holds have 30-second leases renewed every ten seconds. Disconnect/expiry clears state. Client mutations return to Minecraft's thread with generation guards. Sends are serialized and bounded; retries use capped exponential backoff and jitter. Stale sockets abort, and non-authentication outages preserve valid sessions.

The relay is deliberately single-process. Multiple replicas require shared state/routing. [Relay documentation](backend/emotes/README.md) records exact budgets, proxy behavior and deployment. The shared Caddy loopback hop is not counted as one end-user IP.

## Authoring and updates

The original mannequin uses Blockbench's built-in Bedrock Entity format; no plugin is required. Numeric rotation/position accepts Linear interpolation plus a parser-tested GeckoLib vector/Sine subset. Expressions, scripts, events, scale, custom bones and oversized content fail validation.

Each folder declares its permanent ID, unique order and internal clip name. Import adds metadata/export without overwriting existing content; keep source.bbmodel beside it. Generation discovers content, accepts an empty library, ignores dot-prefixed drafts, removes stale generated revisions and rejects overlapping input/output directories. The original nine samples and their generator are retired outside the catalog. First import/export uses order 10. Tests use isolated fixtures, never a requirement to ship demos.

Revisions hash canonical exported data plus rig/animation/playback metadata, excluding display labels. Append content without moving established slots. Unknown revisions are skipped; retaining multiple historical revisions is a future extension.

Normal Bloom updates deliver bundled content on the next game launch. Live downloads, signed remote manifests, launcher browsing, editable favorites, props and audio remain deferred. Supported additions need no Java/Rust/backend edits.

The Tauri before-dev command rebuilds all four cosmetic JARs and prints their emote count/names. Rust watches the bundled JARs/checksums and embeds the current bytes; launch reconciliation compares hashes, so a content update does not need a mod-version bump. Already-running Minecraft processes must restart.

## Hold-wheel input

The wheel draws opaque black slices with a restrained pink selection. Drawing keeps the original radius and visual seams; hit testing only excludes the center, so each angular wedge extends to the screen edge. Mouse position is sampled again at release to handle a fast flick. Escape, focus loss and world loss close without starting an emote. The center stops an existing emote; releasing toward an unassigned slot only closes.

A held binding is polled through Minecraft's input API because opening a screen clears the logical keybinding state. Stonecutter maps that call to GLFW-backed input for 1.21.11/26.1/26.2 and SDL-backed input for 26.3. Key-release events also confirm the selection, repeats are consumed, and the open latch prevents re-opening after an early click/number selection while B is still held. Non-key-symbol bindings use their matching release events. Geometry tests cover all directions, distant corners, the center and visual seams. [Fabric key mapping reference](https://docs.fabricmc.net/develop/key-mappings).

## Verification and deployment

Tests cover valid/invalid imports, source/export axes, generation, actual PAL parsing/controller execution, actual relay sockets, session storage and managed installation. In-game acceptance additionally covers all four versions, both skin models, armor/items/capes/badges, reload, input/camera behavior, two accounts, late joins, reconnects, scope changes and common rendering mods.

The loopback harness only works in Fabric development mode with a literal loopback endpoint. A/B identities are test-only and cannot authenticate to production.

Deploy the backward-compatible relay before publishing the client. A client build does not deploy the backend. The Dockerfile includes relay sources; no database migration is needed. Preserve the previous image and existing databases for rollback. Publication remains subject to repository authorization.

## Primary references

- [PAL introduction](https://docs.zigythebird.com/pal/intro/)
- [PAL dependencies](https://docs.zigythebird.com/pal/gettingstarted/how_to_add_lib_to_mod/)
- [PAL playback/layering](https://docs.zigythebird.com/pal/gettingstarted/how_to_play_animations/)
- [PAL source](https://github.com/PlayerAnimationLibrary/PlayerAnimationLibrary)
- [Blockbench exporter](https://github.com/JannisX11/blockbench/blob/master/js/animations/keyframe.js)
- [GeckoLib exporter](https://github.com/JannisX11/blockbench-plugins/blob/master/plugins/geckolib/geckolib.js)
