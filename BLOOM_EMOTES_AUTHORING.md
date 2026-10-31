# Creating and adding Bloom emotes

Updated October 18, 2026. Templates, Creator, validator, importer, catalog generation and the hold-B wheel are implemented. The active library starts empty; old starter animations were removed. See [acceptance status](BLOOM_EMOTES.md) for actual test evidence.

## Animation review comes first

Parks’s standing preference: assistants provide new animations as standalone `.bloom.json` files for review, with an optional runtime JSON alongside. Never automatically export, install, replace, or add them to `bloom-cosmetics-mod/emotes`. Parks uses **File → Send to Bloom** after reviewing. Updating runtime/editor support and building existing content does not authorize installing new content. Test fixtures are excluded from the shipped catalog.

## Traversal emotes

Choose **Traversal** in Creator’s existing Playback mode dropdown. This saves `mode: "loop"` plus `traversal: true` in the project; native export saves `playback: "loop"` plus `traversal: true` in `emote.json`. The raw animation file stays standard looping numeric motion. Missing traversal defaults to false, including older projects and Blockbench imports. To keep this setting, open the `.bloom.json`, not just its raw animation file.

Hold B and release toward the emote to start. It keeps looping while walking, sprinting, strafing, jumping, crouching, idle, taking damage or using items. Tap B again to stop; holding that stopping press does not reopen the wheel. Another fresh hold opens the wheel. B typed in chat or other screens does not stop playback. Death, spectator mode, mounting, swimming, gliding, or changing worlds still cancel an incompatible pose. Player speed, jump height, collision and hitboxes are unchanged.

The metadata flag is included in the content revision only when true. Stationary emote revisions remain compatible. Observers read traversal from their matching bundled entry, never from a peer-supplied flag; the existing looping relay lease and stop messages need no protocol or backend change. Multiplayer still requires matching installed content and a working relay (see acceptance status).

## Easiest workflow

Ask an assistant:

> Read BLOOM_EMOTES_AUTHORING.md and bloom-cosmetics-mod/emote-authoring/TEMPLATE.md. Make a smooth [motion] as a standalone editable .bloom.json for me to review. Validate its curves, layered export and loop seam. Do not add it to the active catalog; I will send it from Creator myself.

There is now a separate local **Bloom Animation Creator** in the sibling `../BloomAnimationCreator` folder. Its [guide](../BloomAnimationCreator/README.md) covers the 3D editor, independent rotation/position timelines, project files, and **File → Send to Bloom**. Content still lives in this repository; a later normal Bloom release distributes the rebuilt mod.

### Create directly in Bloom Animation Creator

1. Open `../BloomAnimationCreator/Bloom Animation Creator.exe`. Start with a new animation or **File → Open Bloom emote**.
2. Select a bone, scrub to a time, and rotate/move it with the 3D gizmo or X/Y/Z fields. Auto key records the channel you changed; **I / Key pose** records both channels. Use Space to preview.
3. Save a `.bloom.json` project. **Send to Bloom** opens the export setup: choose this checkout, name, stable ID, and whether to build the mod. For your first emote, name it **Wave** and use ID `wave`; Name updates the suggested ID until you edit the ID yourself. Replacements preserve the entry's order and retain a `.creator-backup-*` directory.
4. The editor writes validated `animation.json`, `emote.json`, `source.bbmodel`, and `project.bloom.json`. Dot-prefixed staging/backups are excluded from catalog discovery and Git.
5. Keep **Build emote mod after export** enabled for immediate feedback, or turn it off and run `npm run tauri dev` from this repository. Tauri runs the same four-version mod build automatically and prints the included emote count. Launch a supported Fabric instance with cosmetics enabled; restart an already running game to load new content. Hold **B**, point toward Wave, and release. Exporting never publishes an update.

To remove an exported emote, use Creator's **File → Manage emotes** (also available from Send to Bloom), click its trash icon, and confirm **Remove emote**. This archives the source in an ignored `.creator-removed-*` backup. The next Send/build, Manage emotes → Build mod, or Tauri dev prebuild includes only the remaining active entries. Restart Minecraft to load the rebuilt library. Separately saved projects and the current editor project remain available; exporting the same ID again adds it back.

The editor uses the existing seven-bone player rig and numeric linear tracks. Its project file preserves editable keys and classic/slim preview choice. If animation JSON was subsequently edited outside the Creator, opening the emote imports that newer JSON instead of silently restoring an older project copy. Blockbench remains supported below.

## Preferred motion style

Direction check: Creator's face points toward negative Z. Arms extend downward from their shoulder pivots, so positive local X rotation swings a fist forward; negative local X sends it backward. Compose that arm rotation with the shoulder/upper-body orientation before exporting. Do not reverse every bone's X axis: the torso extends upward, so a forward chest lean uses the opposite sign, and the approved crouch leg direction below stays unchanged. Check strike poses against the actual face direction, not only a three-quarter silhouette. The standalone `exports/Shadow Boxer V2/shadow-boxer-v2.bloom.json` corrects the arm direction while preserving the original timing, footwork, and non-arm keyframes.

Parks's approved direction (October 18): keep pronounced easing while carrying velocity through intermediate poses. Repeated full ease-in/ease-out curves can make every key feel like a stop; match incoming/outgoing motion through keys instead. Do not solve that by flattening the whole motion toward Linear. Preserve separate curves/layers and coordinate secondary movement with the main action.

For crouches on the fixed Minecraft rig, move the hips/top of the legs forward so the lower legs slope back toward the planted feet, and lower the torso, head and both arms together. In Creator coordinates the character faces negative Z: the refined Star Jump uses negative X leg rotation (−10 to −11 degrees), with a matching forward Body Z translation to keep the feet from sliding. Positive X leg rotation reverses the intended slope. A small intentional overlap of the upper legs into the torso suggests a bend without knee bones or scale changes. The refined jump uses about 1.8–1.9 model pixels of upper-body compression. These upper-body bones are siblings under Body: moving Torso alone will not carry the head or shoulders with it. Keep their vertical movement aligned, maintain foot contact, and use restrained head/arm follow-through to suggest weight. Avoid a separate forward torso shove or backward rebound on landing.

The approved smooth Star Jump and the subsequent crouch refinements remain separate editable JSON files under the sibling Creator's `exports/Star Jump/` folder. Parks explicitly approved `star-jump-crouch-v2.bloom.json` end to end: it corrects the leg direction while preserving the 2.4-second timing and airborne apex poses. Use that corrected revision as the crouch reference. Treat these as authoring references; exports are installed only through the normal Send to Bloom/import workflow.

`exports/Sleepy Stretch/sleepy-stretch.bloom.json` is a separate 3.2-second candidate using the same easing and crouch approach: staggered overhead reaches, a restrained side stretch, and delayed head/arm settling. Upper-body pivot offsets follow the shared lean so the sibling bones stay connected. Its matching runtime JSON passed export validation and sampled pose comparisons; code-rendered key poses were inspected, but it has not been installed or tested in Minecraft.

For looping choreography, match both the first/last pose and their incoming/outgoing velocity on every enabled track. Matching the pose alone can still produce a visible pause or snap in motion. `exports/Smooth Shuffle/smooth-shuffle.bloom.json` uses a 4.4-second loop, periodic easing, alternating foot placement, a heel flick, a small outward kick and delayed upper-body motion. Its planted-foot targets stay fixed; the leg/hip offsets solve contact on the rigid Minecraft rig without adding knee bones. The editable source and flattened runtime export are installed under `bloom-cosmetics-mod/emotes/smooth_shuffle/`. Use the matching Creator source to retain curves/layers.

Running motion preference (October 18): the first Comet Run felt like a forward-leaning power walk. A run needs visibly longer front/back strides, larger opposing arm swings, and a flight phase with both feet clear. Translate the hips and shoulders slightly into the reach to suggest stretch on the rigid rig. Lift the body during flight, compress the coordinated upper body briefly after contact, then give it a small, smooth rebound with delayed head follow-through. Avoid random high-frequency shaking or a full stop at every key. The review-only `exports/Comet Run V2/comet-run-v2.bloom.json` applies this direction; its artistic approval is still pending. Reference: [Animation Mentor’s dynamic run-cycle lesson](https://www.animationmentor.com/blog/animating-dynamic-run-cycles/), especially stride/flight poses and offset chest/head motion.

Tempo refinement (October 18): Parks liked V2’s long stride but found the 0.72-second cycle much too fast and jittery. Keep the leg reach, use a substantially longer cycle, and prefer one soft body dip/rise per step. Remove short alternating impact pulses; broad, low-amplitude head/chest follow-through should feel bouncy. The review-only `exports/Comet Run V3/comet-run-v3.bloom.json` uses a 2.4-second cycle (30% of V2 speed), unchanged leg-angle paths, a smaller broad body bounce, and no landing-shake signal. This is a review candidate, not yet visually approved in-game.

Dense animations must fit the **256 KiB compact runtime payload** limit and the 4,096-key limit. Catalog/import readers allow up to **2 MiB of source text** so indentation from older Creator or Blockbench exports does not reject valid motion. Validation still measures the parsed compact animation, and generated bundles always use compact JSON. Creator and the command-line importer keep normal JSON readable but write it compactly if formatting would exceed 256 KiB; this does not change its motion or revision. Catalog reads never rewrite source files. Source projects and Blockbench files remain formatted. After updating the Creator executable, save any work and fully close/reopen it: a process left open still uses its old embedded exporter, which can omit newer metadata such as Traversal.

### Full turns

Body rotations retain their signed, unwrapped angle through the numeric inspector, gizmo, editable layers, Blockbench/runtime export and native Send. Whole-body flips may reach ±720 degrees; limb/head/torso and position bounds remain unchanged. A once-only backflip should progress from 0 to 360 degrees and end there: 360 is visually neutral. Returning to numeric 0 animates a reverse flip. There is no automatic runtime fade, so an authored neutral end pose can stop directly. Save and reopen the updated Creator executable before opening projects that exceed the previous 180-degree limit.

The standalone `exports/Zero Gravity Backflip/zero-gravity-backflip.bloom.json` preserves the original 6.8-second timing, with a monotone 0-to-360 backward turn and matching neutral endpoint geometry. It is a review file, not installed content.

## Files

```text
bloom-cosmetics-mod/
  emote-authoring/
    bloom-player-template.bbmodel
    bloom-player-slim-template.bbmodel
    TEMPLATE.md
  emotes/
    wave/
      source.bbmodel
      animation.json
      emote.json
    # Add further folders only when you create more emotes.
```

The editable source and mannequin geometry do not ship. The build includes only the generated catalog and animation data. The current wheel uses names and slot numbers; external icon assets are not implemented.

## Optional Blockbench tutorial: create Nod from the blank rig

1. Open `bloom-cosmetics-mod/emote-authoring/bloom-player-template.bbmodel` in Blockbench and save a separate working copy. It uses the built-in **Bedrock Entity** format; no plugin is required. The round-trip test used Blockbench **5.2.2**.
2. Choose **Animate**, create a new animation named **nod**, and select **head** in the outliner.
3. The clip lasts **1.4 seconds**, plays once, and has these head rotation frames. Y/Z remain zero:

   | Time | Editor X |
   | --- | --- |
   | 0.0 s | 0 degrees |
   | 0.3 s | -15 degrees |
   | 0.6 s | 0 degrees |
   | 0.9 s | -15 degrees |
   | 1.2 s | 0 degrees |
   | 1.4 s | 0 degrees |

4. Press **Space** to preview. For a gentler nod, change the two -15 values to -10. Keep interpolation **Linear** initially.
5. Save the project. Choose **Animation → Export Animations…**, select only **nod**, then **Confirm**. Save to a temporary `nod.animation.json`, import it with `npm run emotes:import -- "C:\path\nod.animation.json" nod "Nod"`, and save the editable working copy as `bloom-cosmetics-mod/emotes/nod/source.bbmodel`. This optional tutorial adds Nod only if you run it.
6. From the repository root, run:

   ```powershell
   npm run emotes:validate
   npm run test:emotes
   npm run build:cosmetics
   ```

7. Restart the development Minecraft instance with the new build. Hold **B**, point toward **Nod**, and release. A running game still has its old loaded mod.

Blockbench flips X/Y rotation and X position on export. The -15-degree editor nod becomes +15 in JSON. Do not manually negate the export.

## Add a new emote

Save a copy of the classic/slim template as your new project. Create one uniquely named lowercase animation, such as `salute`, animate supported bones, and export to a temporary file. Run:

```powershell
npm run emotes:import -- "C:\path\salute.animation.json" salute "Salute"
```

This creates `bloom-cosmetics-mod/emotes/salute/animation.json` and `emote.json`, derives Once/Loop/Hold, and appends the order after existing entries. Save the editable project as `source.bbmodel` in that folder. Import rejects duplicate IDs/internal names and never overwrites an existing emote.

For existing emotes, edit their source and replace their own export directly. Preserve ID/order. Supported new animations need no Java, Rust, launcher, or relay changes.

## Metadata

```json
{
  "schemaVersion": 1,
  "id": "bloom:nod",
  "name": "Nod",
  "author": "Bloom",
  "rigVersion": 1,
  "animation": "nod",
  "playback": "once",
  "order": 90
}
```

**once** plays and ends; **loop** repeats the whole clip; **hold** plays the entry and retains its final pose. Use Hold for sitting, rather than repeating its sit-down entry.

Supported bones: body, torso, head, right_arm, left_arm, right_leg, left_leg. Preserve names, pivots and hierarchy from [the rig contract](bloom-cosmetics-mod/emote-authoring/TEMPLATE.md).

Use numeric rotation/position with Linear interpolation. Optional GeckoLib exports with numeric `vector` frames and Linear/Sine easing are also accepted and parser-tested. Expressions, scripts, events, scale, extra bones, Catmull-Rom and Bezier are rejected. Bounds are 0.1–30 seconds, 4,096 keyframes, 256 KiB, Body rotation components within +/-720 degrees, all other bone rotations within +/-180 degrees, and position components within +/-12 model pixels.

Names, IDs and orders must be unique. Dot-prefixed folders are ignored as explicit drafts. Eight entries fit on each wheel page. Revisions hash canonical exported data plus rig/animation/playback metadata; display-name edits do not change revisions. Observers skip unknown revisions.

## Build and distribution

`npm run build:cosmetics` validates, builds all four targets, runs Java tests, and copies versioned JARs/checksums to `src-tauri/resources/`. `npm run build` alone builds the launcher frontend.

`npm run tauri dev` automatically runs that mod prebuild before starting the launcher. A separate manual rebuild is not required when restarting Tauri.

Launch a supported Fabric instance through the development Bloom build or the documented Gradle test profile. The reconciler preserves opt-out and user-modified JARs. Minimum Fabric Loader: 0.19.2 for 1.21.11/26.1, 0.19.3 for 26.2, 0.19.5 for 26.3.

Users receive new bundled emotes through a separately authorized Bloom release and a Minecraft restart. Editing files/building locally does not publish an update. Live asset downloads and a launcher browser remain deferred.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No model or Animate tab | Open the supplied .bbmodel, not animation JSON as a model; use Bedrock Entity format. |
| New entry missing | Validate/build, correct version/JAR, cosmetics enabled, then restart Minecraft. |
| Loop snaps | Match endpoints or use Hold for an entry followed by a stationary pose. |
| Wrong limb pivot | Restore the template; animate the bone group rather than its cube. |
| Remote player sees nothing | Relay deployment/session, same address/dimension, matching revision and verified loaded UUID. |
| Start refuses | Stand still on the ground, outside a vehicle, without using an item or an incompatible pose. |
| Export rejected | Use numeric Linear tracks and one clip; remove unsupported fields/effects. |

Templates and motions are original Bloom assets. Keep dependency notices and author attribution. Do not copy proprietary emotes from other clients. Source/export consistency and a Blockbench preview do not replace in-game testing of skins, armor and cosmetics.
