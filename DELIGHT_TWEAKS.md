# Delight Tweaks

Delight Tweaks runs inside Minecraft through the launcher's managed Fabric mod. Open it from Options or press Right Shift in a world. Players can rebind both the menu shortcut and Zoom in Controls. All choices are local to the game instance.

## Run the development build

Use the main Delight Client project, `BloomClient-Main-V2`. Run `npm.cmd run tauri dev`, then launch a Fabric instance for Minecraft 1.21.11, 26.1, 26.2 or 26.3 with the managed Delight Cosmetics & Tweaks mod enabled. The normal launcher build uses Stonecutter to compile all four JARs. A game that was already running needs a restart to load a rebuilt JAR.

Open **Options → Delight Tweaks** or press **Right Shift** while playing. Choose **Edit HUD** in a world or open **Moduals** to browse the tweaks. Switch on an element and use its gear for appearance and behavior. Press **C** to try Zoom. Rebind either shortcut in Minecraft Controls. Settings are stored in the instance’s `config/delight-tweaks.properties`.

Enable **Screenshot Tools** to take a clean screenshot with **F8**. Enable **Inventory Preview** and hold **I** to show the inventory slots. Both shortcuts are rebindable in Minecraft Controls under **Delight Tweaks**.

## First playable batch

| Tweak | Expected behavior and settings |
| --- | --- |
| Zoom | Hold C to zoom. Offer toggle mode, strength, scroll adjustment, smooth transition and sensitivity adjustment. Restore the player's normal view on release or when a screen opens. |
| Armor HUD | Draw equipped armor with Minecraft's item renderer over the actual hotbar slot texture, helmet first. Support vertical/horizontal layout, independent slot opacity, empty slots and durability display. Use sample equipment only in the editor when needed. |
| CPS | Count actual left and right mouse presses in gameplay over the preceding second. Offer separate or combined counts, button selection and labels. |
| FPS | Plain Minecraft text in a corner. Offer label, refresh interval and a low-FPS threshold. |
| Coordinates | Block or decimal positions, single or stacked lines, optional facing and dimension conversion. |
| Keystrokes | Use the player's bound movement keys. Allow jump, sprint and mouse inputs, pressed opacity and spacing. |
| Held-item Durability | Main hand, offhand or both. Icon, remaining points or percentage, optional low-durability color. |
| Effects HUD | Active status effects with icons, names, amplifier and time. Offer organization and expiry warning. |
| Item Counter | Select tracked inventory items. Offer hotbar or full inventory, icon and low-stock threshold. |
| Ping | Display measured player-list latency, with label, refresh interval and warning threshold. |

Start with Zoom enabled and HUD elements disabled. The first-batch table is the design target. Consult the verification record below for what is available in this build.

## Native screens and appearance

- Keep the shortcut menu to **Edit HUD** and **Moduals**. Moduals shows Visual, Input, HUD, and Equipment in one horizontal row, each with a heading, divider and vertical stack of tweaks. On narrower windows, use the footer arrows to pan across whole category columns in that same row. Put the red or green dot inside the OFF or ON button, to the right of its text. Shade both dot colors diagonally from a lighter top-left to a darker bottom-right, with a stronger range on green and a borderless edge on both. Give the settings gear a feature-specific tooltip and narration. Restore the page's scroll position when backing out of settings.
- Use Minecraft's native header and footer layout for Moduals, with a centered title, the standard Done button and the list background and separator textures spanning the screen. Keep the categories and scrollbar centered within the content area.
- Use Minecraft's native options screen, two-column scrolling options list, sliders and Done button for module settings. Group related controls with native section headings. Keep the Crosshair and Block Outline previews above the list.
- Use actual game widgets, font, item models, durability overlays and resource-pack sprites. FPS starts as plain shadowed text. Global HUD panel opacity defaults to 0%. Each element can inherit or override panel opacity and text shadow. Slot opacity defaults to 100% and is independent of panel opacity.
- Use measured content bounds for drawing, selection, dragging and screen-edge constraints. Show four small scale handles only on the hovered element and hold the opposite corner in place as each handle is dragged, within the screen bounds. Check at the minimum GUI size as well as a larger window.
- Edit HUD shows the world, the enabled elements and their saved positions. Allow every HUD element to reach the viewport edges. Default Coordinates above FPS at the upper left. Default Armor HUD beside the hotbar, opposite the vanilla offhand, using the same seven-pixel gap. Place Held-item Durability beyond Armor HUD on the baseline where it fits. On narrow windows where the readout would hit the side edge, put it just above the hotbar instead. Reset position restores these defaults. Let players move the editor controls between the bottom and top to keep the hotbar area clear. Armor HUD matches the hotbar's 20-pixel slot pitch. Crop the one-pixel black framing rows from vertical slots, including both ends of the stack. Keep selection across settings. Save on release. Retain edge/center alignment on resize. Provide a useful empty state.

## Second playable batch

These ten tweaks are available in the existing Moduals categories and start off. The draggable readouts appear in **Edit HUD** and **Add HUD**.

| Tweak | Behavior and settings |
| --- | --- |
| Crosshair | Customize the first-person crosshair's length, gap, thickness, color and outline, with a live preview above the settings. The default is a black plus with 3 px arms, no center gap, 1 px thickness and outline off. It follows vanilla visibility and keeps the attack indicator. |
| Screenshot Tools | Rebindable shortcut, optional delay and optional temporary HUD hiding. Saves through Minecraft's screenshot flow and restores the HUD state after capture. |
| Chat Timestamps | Prefix visible chat with the local arrival time in 12-hour or 24-hour format. Keep the original messages and signatures in Minecraft's chat history. |
| Hotbar Scroll Controls | Adjust direction, sensitivity and wrapping during gameplay. Menu scrolling and spectator input keep their vanilla behavior. |
| Compass | Show a compact direction with optional degrees or a compass strip that follows the camera at frame rate. |
| Speed Meter | Show horizontal or total movement in blocks per second, with optional smoothing. |
| Clock | Show local or Minecraft time, with 12-hour or 24-hour formatting and optional seconds. |
| Biome & Dimension | Show either or both names, together or on separate lines. |
| Inventory Preview | Hold a rebindable key to show inventory slots. Choose whether to include the hotbar or empty slots and set slot opacity. |
| Equipment Alerts | Show a HUD warning while armor or a held tool is at or below the chosen remaining-durability percentage. |

## Visual effects

| Tweak | Behavior and settings |
| --- | --- |
| Particles | Add local sparks, embers, electric sparks, mist or glow when walking or breaking a block. Set the trigger, particles per burst, spread, speed and trail interval. Minecraft's reduced-particle mode reduces emissions, and minimal mode suppresses the extra particles. |
| Block Outline | Customize the vanilla targeted block outline using solid, pulse or rainbow mode. Set hue, saturation, brightness, opacity, thickness and animation speed. The native target shape and high-contrast backing remain available. |

## Additional candidates

| Tweak | Proposed controls |
| --- | --- |
| Session Timer | Reset on launch or world join, optional break reminder |
| Camera Motion | View bob, hand bob, sprint adjustment and vanilla reset |
| Overlay Adjustments | Fire height and opacity, shield height and per-effect resets |
| Held-item Position | Per-hand offsets, scale, linked hands and vanilla reset |
| Perspective Shortcut | Key, hold/toggle, preferred view and restore behavior |
| Waypoints | Per-world/server name, color, range, distance and compass marker |
| Pickup Feed | Icons, duration, grouping, minimum quantity and maximum visible entries |

## Verification

The second batch built and passed 34 unit tests on Minecraft 1.21.11, 26.1, 26.2, and 26.3. The managed JARs and bundled hashes were verified. The 26.3 Fabric development client reached the title screen with the new chat, crosshair, scroll and capture mixins active. In-world review of the ten new modules remains open.

Parks reviewed the first November 26 revision and requested the scrolling list, corrected slot crop, bottom alignment, and movable editor controls. The resulting layout and armor positioning await in-game review.

The local development build includes all ten starter tweaks, the ten additions above, and the two Visual effects. Effects currently use a vertical list. Item Counter can track up to six items selected from the main hand.

| Check | Result |
| --- | --- |
| Stonecutter builds | All four managed Fabric JARs built. Each passed 27 JUnit tests, including HUD bounds at varied scales and drag-position round trips. Each packaged file passed its SHA-256 check and contained the Tweaks entrypoint. |
| Minecraft Options | The native Options button opens Delight Tweaks. The category and gear flow was exercised on 1.21.11, 26.1, 26.2 and 26.3. The test checked button bounds and pairwise overlap on the visited screens. |
| In-world input on 26.3 | Verified separate left and right mouse presses, reduced and restored camera FOV, and the menu keybinding. Used Minecraft's per-version mouse constants for the SDL input change in 26.3. |
| In-world HUD on 26.3 | Verified Armor HUD with an actual equipped helmet, editing and dragging its slot column, returning to gameplay, and restoring the saved position after restarting. Tested Add HUD, Snap toggle, Reset position and the per-element opacity slider. Its change left global opacity at zero. |
| Visual inspection | Reviewed game-rendered screenshots of the native categories, HUD rows, Armor settings, HUD editor and live overlays. Tested 960 × 600 and 640 × 480 windows. The smaller run rendered all nine HUD elements with real player state. |
| Launcher | Typecheck, production frontend build and locked Rust check passed. |

Testing used local Fabric development clients. A signed launcher update, a multiplayer-server playthrough and in-world HUD walkthroughs on the three earlier versions are outside this verification.
