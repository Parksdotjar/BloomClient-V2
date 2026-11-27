# Delight cosmetics authoring and delivery

## Author and stage

In Delight Animations, open the editable wing project and choose **File → Publish wings**. Connect using the existing owner Studio passphrase. Choose the left and right rig groups, the looping sequence, materials that use the trim color, the default colors, and a PNG thumbnail. **Prepare build package** stages the compiled runtime assets in the selected Delight Client feature checkout and registers an owner-only catalog draft. **Publish to Shop** changes the draft's availability. The updated launcher offers only revisions bundled with its own build.

The release uses one revisioned archive with quads, texture UVs, neutral PNG masks, and sampled transforms for the authored joints. The game attaches the model to the torso and evaluates the baked sequence locally. The editable project remains in the editor.

For emotes, use **File → New emote**, or import the two existing runtime JSON files together. The seven player bones can be animated using the editor timeline. **Prepare emote** stages the validated in-game JSON in the same build checkout. Replacing an existing emote preserves its wheel order and moves the previous folder into a hidden backup.

## Author a head-mounted hat

Seat the base of a worn hat approximately half a model pixel inside the bare head. The runtime hat socket sits 0.625 model pixels below the crown so the small authored offsets on current hats leave that overlap. Check the underside in the side view.

Select the **Head** socket and position the model in its local coordinates. Assign a distinct material to each customizable region. Neutral pixel shading in the atlas continues to show through the tint. Choose **File → Publish hat** to stage the runtime package through Studio. A static hat needs no sequence. A hat with motion can use a looping transform sequence.

The runtime index marks hats with `slot: "hat"`. Packages without a slot use the existing back attachment and palette. Bunny Ears uses `left` and `right` for the inner regions, `trim` for the left outer region and `rightOuter` for the right outer region. The game applies the player's head transform and hides the hat while the head equipment slot is occupied.

## Build and publish

The existing build command validates wing and hat packages and bundles the same immutable revisions into all four managed JARs. The launcher gets its index and thumbnails from that same staged directory. Stage changes on a feature branch and include the new index, thumbnail, and archive when the item is intended for the next release. Follow the regular updater workflow for shipping the client.

The wing and hat endpoints use the SQLite cosmetics backend. Deploy the updated backend before enabling the new Shop path in a public build. Owner operations require the existing Studio session and a single owner in the existing allowlist. Production Studio calls use the established HTTPS endpoint with redirect following disabled. The editor holds the session only in native memory and revokes it on sign-out. Shop art and equipped RGB settings are public cosmetic data. Ownership and equipment changes require the account's Minecraft-authenticated request. Unpublished revisions cannot be collected or equipped.

Players open **Locker → Shop → Wings**, add an item, then use **Locker → Wings** to equip it. Left Wing, Right Wing, and Metal Trim tint the shaded source texture in the preview and in game. Saving records the colors with that account and wing. Unequipping preserves the saved colors. **Shop → Hats** and **Locker → Hats** use the same workflow with four color pickers. A hat and wings occupy independent equipment slots.

While a player's wings are ready to render, Minecraft hides that player's cape layer. This applies to official capes and Delight cloaks. The cape equips separately and returns automatically when the wings are removed or unavailable. Elytra rendering is independent.

## Local Minecraft verification

Start the launcher with `npm run tauri dev` from the client checkout. With Node 22.13 or later, Vite starts the loopback-only Wings service on port 19192 and seeds the bundled Eclipse Angel Wings and Bunny Ears for the preview player. The checkout keeps local equipment and colors under its build cache. The launcher uses the signed-in Minecraft skin when available and a mannequin for guest preview. A supported Minecraft instance started by the debug launcher renders this local loadout on your own character and keeps using the live service for other players. The preview account is separate from real cosmetic ownership.

For a standalone 1.21.11 renderer check with the local service running, use:

    .\benchmark-mod\gradlew.bat -p .\bloom-cosmetics-mod :1.21.11:runClient -PdelightLocalWings

Change the test player’s equipped colors through **Locker → Wings** or **Locker → Hats**. Use a third-person view in the isolated world to check the attachment, material colors, and motion. Set `DELIGHT_WINGS_LOCAL_PREVIEW=0` before launching to use the configured remote backend in a debug build. Release builds always use the configured backend.


## Art and release handoff

1. Read the Delight Animations project and format notes in Obsidian. Start from the approved attachment reference for the requested slot. For back-mounted wings, use Compact Flap for fit and motion. Use distinct shapes and artwork for each cosmetic.
2. Choose a material-appropriate default palette. Use realistic colors for fur, feathers, metal, felt and similar materials unless the brief specifies an intentionally stylized palette. Start from the approved hex values when provided. Preserve texture shading and expose only the requested color regions. Keep the editable material colors, runtime defaults, Shop thumbnail and catalog metadata in sync. Bunny Ears uses rose pink (#EAB6CE) inside both ears and white (#FFFFFF) outside both ears, with four independent controls.
3. Save the native .delight project, any .delightsequence files, and nearest-sampled PNGs in the format’s standard folder layout. Deliver an editable ZIP and transparent artwork centered on the cosmetic. Validate the folder and archive. Sample classic and slim through idle, walk, sneak and all authored motion. Record which contacts are intentional.
4. Stage the runtime revision and update the bundled index and thumbnail together. For unpublished design iterations, remove superseded assets from the next build. Preserve revisions needed by already-released clients and existing equipped items. Keep the editable source under P:\Documents\Delight Animations Projects.
5. Run the actual Tauri development client. Preview the default colors in Shop, claim using the local test service, and open Locker. Check skin and mannequin previews, each independent picker, Save colors, reset, unequip and re-equip. Use a separate preview profile when the installed launcher is open. Check compounding slots in Equipped look.
6. Build the managed Fabric JARs with npm run build:cosmetics. Verify that every supported JAR contains the same catalog entry and ZIP digest. Check third person in Minecraft and make sure the mount follows the correct bone. For head-mounted items, test front and side angles, head turns, and head equipment. For wings, test the flap, cape suppression and reappearance. Verify actual multiplayer observation where available and record which game/runtime combinations were used.
7. Run the relevant backend integration, frontend typecheck and build, and locked Rust check. Compare the candidate against current upstream main and isolate it from unrelated work. Record the exact revision and required release inputs. Keep the launcher version, commit, merge, update push and tag actions subject to the repository’s release authorization.
8. When backend work is authorized, compare with live source, keep a rollback image and an online SQLite backup, and rehearse the migration privately. Confirm that old clients still see their expected items. Register the matching revision through the owner workflow and enable the catalog at the authorized stage. Verify public catalog and auth boundaries. A server catalog entry becomes visible in the launcher only when the client bundles that revision.

The [copy-ready request](COSMETIC_REQUEST_PROMPT.md) supplies the brief and preferred handoff.

## Back cosmetics

Green Syringe appears under Back in Shop and Locker. Its runtime uses slot "back" and shares the torso equipment position and API with wings. Equipping either replaces the previous back item. The local development service grants the syringe to the preview account. Five chosen colors recolor the authored pixel shades. Liquid batches carry a row counted from the plunger end, allowing a five-texel shine to travel toward the needle once per five seconds. The launcher respects its motion setting.

Each customizable section owns every pixel of its fill, texture, shadow, highlight and animated shine. Derive custom shades from the selected accent using a neutral brightness ramp. Test black for dark-gray highlights, gray for zero saturation, and a contrasting hue for any trace of the original pigment.
