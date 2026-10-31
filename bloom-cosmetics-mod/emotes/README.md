# Published emote sources

This library starts empty. The previous nine starter animations were removed from the catalog.

In Bloom Animation Creator, use **Send to Bloom**, name your animation **Wave**, and use the ID `wave`. That creates `wave/` here with the animation, metadata, Blockbench source and editable Creator project. If it is the only folder, it is the only emote in the mod.

Run `npm run tauri dev` from the Bloom Client root. Its prebuild validates this library, rebuilds all four cosmetic-mod targets and prints the included emote count. Launch a supported Fabric instance with cosmetics enabled. An already-running Minecraft process must restart to read a changed JAR.

The build does not generate demo animations. Empty libraries are valid. Dot-prefixed staging and backup folders are excluded.
