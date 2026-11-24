# Delight cosmetics authoring and delivery

## Author and stage

In Delight Animations, open the editable wing project and choose **File → Publish wings**. Connect using the existing owner Studio passphrase. Choose the left and right rig groups, the looping sequence, materials that use the trim color, the default colors, and a PNG thumbnail. **Prepare build package** stages the compiled runtime assets in the selected Delight Client feature checkout and registers an owner-only catalog draft. **Publish to Shop** changes the draft's availability. The updated launcher offers only revisions bundled with its own build.

The release uses one revisioned archive with quads, texture UVs, neutral PNG masks, and sampled transforms for the authored joints. The game attaches the model to the torso and evaluates the baked sequence locally. The editable project remains in the editor.

For emotes, use **File → New emote**, or import the two existing runtime JSON files together. The seven player bones can be animated using the editor timeline. **Prepare emote** stages the validated in-game JSON in the same build checkout. Replacing an existing emote preserves its wheel order and moves the previous folder into a hidden backup.

## Build and publish

The existing build command validates wing packages and bundles the same immutable revisions into all four managed JARs. The launcher gets its index and thumbnails from that same staged directory. Stage changes on a feature branch and include the new index, thumbnail, and archive when the item is intended for the next release. Follow the regular updater workflow for shipping the client.

The wing endpoints use the SQLite cosmetics backend. Deploy the updated backend before enabling the new Shop path in a public build. Owner operations require the existing Studio session and a single owner in the existing allowlist. Production Studio calls use the established HTTPS endpoint with redirect following disabled. The editor holds the session only in native memory and revokes it on sign-out. Shop art and equipped RGB settings are public cosmetic data. Ownership and equipment changes require the account's Minecraft-authenticated request. Unpublished revisions cannot be collected or equipped.

Players open **Locker → Shop → Wings**, add an item, then use **Locker → Wings** to equip it. Left Wing, Right Wing, and Metal Trim tint the shaded source texture in the preview and in game. Saving records the colors with that account and wing. Unequipping preserves the saved colors.

While a player's wings are ready to render, Minecraft hides that player's cape layer. This applies to official capes and Delight cloaks. The cape equips separately and returns automatically when the wings are removed or unavailable. Elytra rendering is independent.

## Local Minecraft verification

Start the launcher with `npm run tauri dev` from the client checkout. With Node 22.13 or later, Vite starts the loopback-only Wings service on port 19192 and seeds the bundled Eclipse Angel Wings for the preview player. It keeps preview equipment and colors in a checkout-specific temporary database. The launcher uses the signed-in Minecraft skin for the preview. A supported Minecraft instance started by the debug launcher renders this local loadout on your own character and keeps using the live service for other players. The preview account is separate from real cosmetic ownership.

For a standalone 1.21.11 renderer check with the local service running, use:

    .\benchmark-mod\gradlew.bat -p .\bloom-cosmetics-mod :1.21.11:runClient -PdelightLocalWings

Change the test player's equipped colors through **Locker → Wings**, then use a third-person view in the isolated game's world to inspect the flap. Set `DELIGHT_WINGS_LOCAL_PREVIEW=0` before launching to use the configured remote backend in a debug build. Release builds always use the configured backend.
