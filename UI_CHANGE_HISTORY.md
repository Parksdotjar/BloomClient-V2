# Bloom Client UI Decision and Fix History

## October 2026 — instance collection bottom fade

- Mods, Resource Packs, Shaders, and their shared catalog state now use one edge-to-edge curved fade from the final visible rows into a darker solid pagination well instead of ending at a hard horizontal cutoff behind the floating search surface.
- The fade rises higher at both panel walls, dips softly through the center, begins above the search overlap, and reaches every edge of the lower panel. It does not capture input; search, filters, page controls, messages, and the collection scrollbar remain functional and visually sharp above it.
- The rejected first pass was an inset rectangular overlay that read as a solid footer block and left the lighter parent surface exposed at both edges. Do not recreate that treatment.
- The curved mask must be fully transparent across its complete top edge before interpolating continuously to full opacity. Partial opacity at the overlay boundary creates a visible horizontal seam and stepped bands even when the remaining gradient is smooth.

## October 2026 — sidebar artwork Play action

- Instance artwork in the sidebar is now its own real Play target. Hovering or keyboard-focusing the PNG dims only that media square and fades/scales in one larger white Play icon with no colored or circular backing tile.
- Clicking the artwork launches that exact instance through the existing launch pipeline and shared click-pop response. Clicking the name/rest of the row still opens the instance page, preserving double-click-to-play behavior there.
- The instance row and artwork never move on hover. Show Animations off, Reduced Motion, and Ultra Performance Mode remove the reveal transition without removing the Play action.

## October 2026 — Locker categories and Minecraft wardrobe

- Retained the centered Locker platform; added a compact darker underlapping shelf for Cloaks / Capes / Skins and a separate catalog box below a 22px gap.
- Renamed the visible custom catalog to Cloaks without changing backend cape identifiers or URLs.
- Added authenticated Minecraft cape ownership and equip/unequip through native commands; a public UUID response is not treated as the full owned collection.
- Added account-scoped PNG imports, Classic/Slim selection, cached angled skin thumbnails and one focused live preview. Only Use skin sends the upload to Minecraft.
- New controls remain stationary on hover; the pre-existing cloak reveal was corrected to opacity-only feedback with no glow. Account switches discard stale view results.
- Checks: frontend typecheck/build and locked Cargo check passed. Native live account changes still require signed-in acceptance; no test cape/skin was applied to the user's account automatically.

## Free cape restoration — integration checkpoint

- Added free Locker and separate local Cape Studio with raised headers, recessed content, bold identity text and focused 3D previews.
- Equip and badge preferences use verified backend state. No prices, cart, claims or cosmetic-only success states.
- Installed Studio was opened and visually inspected. Live publishing and multiplayer acceptance remain gated; see `CAPES_IMPLEMENTATION_STATUS.md`.
- **Locker correction:** The first integration pass used a flat utility screen and two custom checkbox controls above the catalog. Those controls duplicated Settings and did not follow Bloom's established row/toggle system. The Locker now uses one raised identity header over a recessed catalog workspace, a restrained centered empty state, responsive cape collection cards, one focused preview, and standard pagination. Cosmetics integration and the ParksVAL badge preference moved into a dedicated Cosmetics category in Settings and use the shared authoritative toggle component.
- **Regression checks:** Locker loading, empty, offline, signed-out, populated, selected, equipped, and saving states; nine-item desktop pages; narrow reflow; theme/custom-background parity; Settings scrolling; disabled integration; account switching; failed reconcile and failed badge saves.
- **Cape Studio correction:** Replaced the first dense UV-first utility layout with a restrained project rail, raised project header, recessed editor workspace, and focused live preview. PNG import now opens a genuine draggable cape-ratio frame with a longer zoom range, clear 256/512/1024/2K output choices, mirrored back option, and automatic edge wrapping. Cape and elytra views update from the same draft; exact pixel editing remains a separate mode rather than cluttering image placement.

This is the durable record of user-directed UI decisions, regressions, and proven fixes. Review it before changing an existing component. Update it whenever a UI request changes a visual rule, fixes a regression, or establishes a reusable interaction pattern.

## Required workflow for UI changes

1. Read the relevant entries here, the matching rules in `DESIGN_RULES.md`, and any approved related pattern in `GOOD_DESIGNS.md`.
2. Identify the intended reference frame before aligning anything: the control itself, its row, its card, or the viewport.
3. Check both axes. “Centered” means horizontally and vertically centered unless the request explicitly limits it to one axis.
4. Check the CSS cascade for broader descendant rules that can override component-specific typography, margins, transforms, or sizing.
5. Verify the default window, minimum supported width, short viewport, long text, transient helper/error text, and open-menu state.
6. Run `npm run typecheck` and `npm run build`.
7. Add or update an entry below with the request, cause, fix, and regression checks.

## Current interaction decisions

### Buttons

- Hover and focus do not move interface geometry. Buttons, cards, search fields, menu triggers, and menu rows remain at their exact resting coordinates and use restrained color, surface, border, or opacity feedback instead.
- Do not add shared CSS hover transforms. A prior global `translateY(-2px) scale(1.025)` rule repeatedly reintroduced the unwanted lift across unrelated features.
- Click-pop remains an independent pointer-down response where appropriate, but it is not used by window controls, title-bar menus, dropdown options, full-bleed artwork, or any control whose geometry must remain fixed.
- Button layout must not use `translate` or `scale` longhands for resting placement. Use grid or flexbox for centering so optional press feedback can never teleport a control.
- Accent-color swatches do not use click-pop compression. The swatch and selected ring remain enlarged together until unhover, then scale down as one unit.

### Accent selection ring

- The selected accent uses a separate pseudo-element ring.
- The ring fades and expands monotonically into place; it does not immediately shrink after appearing.
- Ring animation respects Show Animations, Ultra Performance Mode, and reduced-motion preferences.

### Toggles

- Toggle thumb position comes only from React state and CSS classes: off is left, on is right.
- Never animate a toggle thumb with persistent inline transforms. A CSS transition may animate between the two authoritative state positions.
- Both positions use protected state selectors so stale inline styles cannot leave a thumb on the wrong side.

### Dropdowns and floating menus

- Dropdowns render through a document-level portal and cannot be clipped by cards, paint containment, or scroll regions.
- Floating menus measure the viewport, open upward when there is insufficient room below, and use an internal scrollbar when neither side has enough space.
- Helper, success, and error text belongs in normal layout flow with reserved space and wrapping; never position it outside a card where containment can crop it.

## Current visual decisions

### Retired sidebar brand alignment

- The former logo-and-name lockup is no longer part of the client. Home begins beneath the draggable title-menu region, as recorded in “Brandless sidebar and fourth sponsored slot.”
- Keep this record only as a superseded decision. Do not restore the Bloom wordmark, its dedicated surface, separator, subtitle, optical offsets, or reserved height.

### Primary sidebar navigation typography

- Home, Instances, AutoTune, and Settings use the same bold 800-weight label treatment as sidebar instance names and profile account names.
- Active and inactive navigation labels keep the same weight, preventing selection from changing text width or causing layout movement. Existing icon alignment, spacing, and active colors remain unchanged.

### Two-surface sidebar instance cards

- **Request:** Replace the tiny flat sidebar instance row with a horizontal version of the instance-page header's layered platform.
- **Structure:** Each recent instance is one rounded rectangle containing a darker rounded-square media block on the left and the normal raised-header panel color on the right.
- **Icon behavior:** Custom instance artwork fills the entire left square with `object-fit: cover`. The no-icon state uses a thick rounded question mark centered in a theme-derived dark square.
- **Fallback edge fix:** The fallback square previously stopped one border-width short on each edge because the card's 1px border reduced its inner grid track by 2px. The card now draws that boundary as an inset shadow and gives the media track the card's full height, so fallback and uploaded icons reach identical clipping edges.
- **Typography:** The name keeps the profile account selector's bold visual treatment at 13px/800 weight, truncates safely, and keeps the Minecraft version beneath it in muted text. The compact 940px sidebar uses 12px.
- **Interaction:** The active instance remains neutral and stationary. It gains only a restrained darker border; sidebar cards do not inherit the shared button lift, scale animation, accent fill, or glow.
- **Regression checks:** Custom and missing icons, very long names, three recent instances, active/inactive states, every theme, blurred sidebars, default sidebar width, and the 940px compact sidebar.

### Full instance-library card hover

- The complete instance card is one clickable hover target with a pointer cursor. It scales to 1.025 over the established 800ms ease without changing its colors; disabling animations or enabling Ultra Performance removes the transform.
- Card height increased by 6px so the Play/folder/action row has a slightly larger gap beneath the raised identity platform while preserving its existing bottom inset.
- Clicking the non-button area of a full card now participates in the shared Button Pop Duration system. Event targeting chooses the closest nested button first, preventing simultaneous button and card compression.
- The library toolbar no longer shows the right-side instance count. Removing it makes the filter the final far-right control while search keeps all remaining width.

### Instance content tabs

- Mods, Resource Packs, and Shaders keep their shared sliding selection indicator, but the selector is a rounded rectangle rather than a pill.
- The outer selector uses the adjacent Settings button's 13px corner radius; its inset active surface and individual tab hit areas use 9px corners.
- The instance header platform uses the same 12px radius on its top and bottom corners; the former larger 21px lower radius was removed while retaining the curved drop shadow.
- Instance artwork now fills a 112px square flush against the header's top, bottom, and left edges, echoing the sidebar cards without adding their two-surface color split. A restrained right-side shadow adds separation while the identity copy remains layered above it.
- The permanently overlapping image-edit badge was removed. Hover or keyboard focus now dims the full artwork and fades/scales in a centered horizontal-switch icon; this full-bleed media control is excluded from lift and click-pop transforms so its edges never separate from the header.

### Simplified AutoTune introduction

- **Reported:** Opening AutoTune for the first time felt dense and overwhelming.
- **Decision:** Use a centered reference-inspired introduction with “What is AutoTune?”, one short explanation, and four restrained rows covering hardware scanning, measured Minecraft performance, tuned recommendations, and user control.
- **Actions:** Keep Bloom's single “Accept and scan hardware” button. Do not copy the reference's previous/next arrows or pagination controls.
- **Behavior:** Accept now genuinely begins the hardware scan immediately instead of only unlocking a second screen that requires another scan click.
- **Visual rules:** Use Bloom's existing theme surfaces, border tokens, typography, and selected accent. Keep every row concise and avoid a large outer consent card, internal scrollbar, long fine print, or unrelated branding.
- **Regression checks:** Default and minimum window heights, every theme/accent, keyboard focus, first acceptance, immediate scanning state, and returning users with saved AutoTune progress.

### New Instance progressive disclosure

- **Reported:** The initial New Instance page felt overwhelming, and the Create Instance action was difficult to find because Java, memory, JVM, and secondary behavior controls pushed it below the first viewport.
- **Decision:** Keep Basic Information and Select Components visible. Collapse Java version, memory allocation, JVM arguments, custom resolution, launcher visibility, and shortcut creation behind one right-aligned “Show advanced options” disclosure.
- **Behavior:** Create Instance remains in the normal action row and is visible without opening advanced settings. Opening advanced options inserts one two-column panel above the action row, rotates the chevron, and moves the actions downward through normal layout rather than absolute positioning.
- **Regression checks:** Default and minimum window heights, collapsed and expanded states, long Java paths, custom accents/themes, keyboard focus, reduced motion, and open dropdown menus inside the advanced panel.
- **Game directory:** The folder icon opens the native operating-system directory picker. Its selected absolute path updates the field and is the real parent used by instance creation; it must never be a mock or display-only value.

### Temporarily removed Shop and Locker

- Shop and Locker are fully removed from the active launcher while their backend is migrated to the VPS: navigation, pages, frontend providers, native commands, automatic renderer build/bundling, and renderer injection are inactive.
- Existing Bloom-owned cosmetics JARs are removed from managed instances when Bloom inspects or prepares them, so an obsolete bridge cannot remain silently active.
- The Fabric renderer source and authoring guides remain dormant and rebuildable. `SHOP_LOCKER_RESTORATION.md` records the product/API restoration plan; `COSMETICS_RENDERING_ARCHITECTURE.md` records in-game attachment, pivots/bones, wing flapping, and animated cape atlases.
- Restore the feature only as one end-to-end system after the VPS API, private objects, manager publishing, launcher equip flow, and in-game renderer all pass the documented test matrix.

### OLED Dark

- OLED Dark uses the original hierarchy: a true-black page with near-black sidebar, panel, control, border, and advertising surfaces. Do not apply the experimental inverted charcoal-canvas treatment unless explicitly requested again.
- OLED Black is now the sole selectable theme. Saved Dark or Dusk values migrate to OLED automatically; the Theme dropdown remains visible with a disabled “Coming soon” row so future expansion has a clear home without exposing unfinished palettes.

### Modrinth modpack browser

- The top title is centered and reads “Modpacks.”
- The title sits on the same raised-header platform used by Settings: a slightly lifted panel with rounded lower corners and a restrained black shadow that follows the curve over the recessed catalog surface.
- The top-right X returns from release selection to the pack list; from the pack list it closes the browser.
- The X is placed by the header grid, never by a centering transform. Switching between its back and close meanings remounts a clean button so no active press animation can leak into the next state.
- The Minecraft version and modpack release selectors are vertically stacked, use dark borders, and avoid light-gray outlines.
- Fabric is represented by its bundled icon rather than a text label.
- The import action reads “Import,” retains its download icon, and uses a larger restrained darker-accent button. Its white label must remain readable across every selectable accent without a glow or bright border.
- Catalog plus actions use 9px rounded corners instead of circles so they match the neighboring provider-link control and Bloom's established control radii.
- The floating modpack search bar is pulled 16px farther upward into the catalog. To remain obvious against the near-black catalog, it uses a raised `--panel-strong` dark fill, a pure-black 2px edge that stays darker than the interior, a strong semi-soft two-layer black shadow, an accent search icon, and higher-contrast muted placeholder text. It never uses a purple/accent outline or glow.
- The search surface is intentionally large: 70px tall, up to 800px wide, with a 20px icon, 14px text, 22px horizontal padding, and a matching 17px radius.
- The entire search surface acts as the input label. Focus scales it smoothly to 1.025 and blur returns it to 1 over 420ms, without a color change; reduced-motion, disabled-animation, and Ultra Performance states remove the transition.
- Pagination is now one shared design across Modpacks and every instance content collection: installed Mods, Resource Packs, Shaders, and each matching Modrinth catalog. All use borderless 44px rounded-square chevrons around a centered `current / total` status surface with no “Page” label, plus accessible labels/tooltips and consistent disabled states.
- The Modpacks header uses a uniform 16px radius on all four corners so its top and bottom curves match.

### Profile area

- A custom Bloom profile picture is launcher-wide on the local device. It persists across Microsoft account additions, switches, sign-outs, sign-ins, and restarts.
- The profile status message is in normal flow and states that the picture applies to every account.
- The account selector label is 15px, bold, and centered on both axes. Its chevron is positioned independently and must not bias the text.
- The account selector is centered against the entire profile card—not merely the flex space remaining between neighboring controls.
- Because the avatar and add-account button have different widths, the normal row uses equal outer grid tracks. Future side-control size changes must preserve those symmetric tracks.
- The sidebar profile footer was redesigned from a flat username plus gear into a contained account dock with a larger avatar, live presence dot, provider label, and rotating disclosure chevron. The redundant standalone Settings gear was removed.
- Its popover is now an account hub: an identity/status header, descriptive Profile & Accounts and Client Settings rows, and a visually isolated logout action. Opening uses a restrained scale/rise plus short staged row entrances; Escape and outside click close it, and all motion settings are honored.
- Follow-up direction removed redundant provider/status/action subtitles and vertically centers each remaining label. This establishes a broader rule: obvious controls should not carry filler subtext.
- Both the closed dock and open account hub now use a full-height, full-bleed avatar on the left. The open identity row became an edge-to-edge raised platform with the same curved black shadow hierarchy used by Settings, Modpacks, and instance headers.
- The account hub no longer appears as a detached dropdown above the footer. The real account dock now slides upward over Downloads and Logs, revealing an attached action drawer below it; the underlying links retain their positions. Closing, outside click, and action selection slide the dock back down while the drawer retracts.
- Follow-up animation correction: the revealed actions must never translate with the dock or run their own slide. They stay fixed at their final coordinates while the account card alone moves upward; a bottom-anchored clip mask reveals and conceals the stationary drawer.
- Expanded-dock edge fix: right-side container padding made the chevron area resemble a separate rounded cap. Padding moved into the trigger/update controls and the open surface moved to the full dock, producing one continuous raised platform across both top corners.
- Drawer underlap fix: the recessed surface originally began exactly at the raised card's bottom edge, exposing the sidebar through both rounded lower corners. The drawer now extends 14px behind the dock, with equal compensating top padding so controls do not move.
- Rebuilt the instance content header as one shared raised platform across Mods, Resource Packs, Shaders, and their Modrinth browsing states. Removed the redundant folder-description sentence and “Installed” prefix, added category identity icons, changed the item count from a pill to a compact rounded badge, made sorting icon-led, strengthened the Add action, and preserved the same header structure while browsing.
- Header refinement removed the decorative category tile and moved the title/count into the freed left space. The sort control also returned to a single dropdown chevron after the added arrows icon created two competing indicators.
- Replaced the Fabric-only catalog drag overlay with a shared instance content drop state. The overlay now uses one restrained raised card with category-specific copy and file type, appears from installed and browsing views, and routes JAR mods or ZIP resource/shader packs into the active tab's real instance folder.
- Drop-overlay visual correction removed that raised card, copy, badge, and borders. The accepted design keeps the correct dimmed workspace and scales a single white drop-box icon into the center, matching the icon-reveal treatment already used on editable artwork.
- Rebuilt the forgotten signed-out account footer to match the current signed-in dock instead of the old transparent login row. It now has the same 58px rounded surface, full-height left identity tile, bold single-line label, right affordance, and no redundant “Connect your account” subtitle; the placeholder blue M was replaced with a bundled four-color Microsoft logo.
- Signed-out follow-up replaced the remaining separate sign-in popover with the exact sliding account-dock interaction. The closed dock now says only “Sign In”; opening slides it over Downloads/Logs and mask-reveals a stationary two-row drawer. Copying the visible device code dims that row as “Copied” and unlocks the Microsoft redirect row.
- Microsoft-logo correction replaced the tiny mark floating on the dark dock with its proper presentation: a slightly larger official four-color mark, optically centered inside a full-height soft-white identity tile with the same curved edge and sideways depth as profile artwork.
- Microsoft-logo centering regression was traced to the legacy `.profile span` rule overriding the tile's `display: grid` and margin. The identity tile now owns higher-specificity display, margin, font, and two-axis placement rules, so the mark is mathematically centered rather than visually nudged.
- Added the missing 20px top page inset to Settings so its raised header has the same breathing room beneath the window chrome as the other main workspaces; the existing header shadow and attached layout move together.
- Consolidated custom backgrounds into one coherent surface system. Removed separate sidebar/button blur switches in favor of one readable Interface Darkness slider; both side rails now share a dark blurred tint, the center uses the identical darkness without blur, and filled neutral/accent controls plus slider surfaces use a slightly denser dark glass treatment throughout the client.
- Added an independent Element Darkness slider for custom backgrounds. It changes the opacity/darkness of glass buttons, dropdowns, cards, slider readouts, and similar controls without altering the center canvas or either sidebar.
- Corrected Element Darkness so low values remain visibly different over dark parent surfaces. Coverage now includes every sidebar navigation button, bottom sidebar action, account card, settings shell and navigation tabs, plus instance content tabs; the center settings shell remains sharp rather than blurred.
- Updated custom-background defaults to the approved 100% image opacity, 92% interface darkness, and 35% element darkness. A one-time migration moves untouched legacy 78%/83% surface defaults to the new values while preserving custom values users already chose.
- Redesigned the sidebar New Instance action as a compact two-surface creation card. A full-height accent-tinted plus tile anchors the left edge, the main surface carries only a centered bold label, and restrained sideways depth replaces the old thin outlined button. The later global hover correction supersedes its original lift behavior; it now remains stationary and uses color/surface feedback plus the optional click-pop response.
- Follow-up moved instance creation into the section heading and removed the separate top action entirely. `INSTANCES` is centered at rest; section hover/focus scales in a rounded accent plus on its left and slides the label right without reflowing the list. Only that plus opens New Instance.
- Fixed the Instances-heading plus shifting left at the end of its reveal. Its 30px button hitbox now remains fixed while only an inner visual tile scales, preventing reveal, focus, and click-pop transforms from competing for the positioned element.
- Final reveal correction removed the fractional absolute position and scale compositor entirely. The heading now expands a centered `0px → 30px` grid track beside the label, while the plus tile reveals symmetrically through clipping; this slides the label naturally and leaves no final-frame coordinate to snap.
- Replaced the sidebar's no-instance dashed placeholder and explanatory subtext with an account-dock-style creation card. A full-height accent plus tile anchors the left, `Create instance` is the only label, a restrained chevron closes the row, and clicking anywhere on the card opens the real New Instance UI.
- Rebuilt Spotlight Home as Bloom's bare launcher view. Removed the welcome eyebrow, giant “Ready when you are” headline, helper sentence, and rounded stage slab. The center now contains only the selected instance's 88px artwork and bold name, a wide darkened-accent `Play` action, and the existing slightly narrower selector stacked below. Selection refreshes only the identity with a short compositor entrance, while the controls stay fixed.
- Spotlight scale follow-up enlarged the complete focused stack: 112px instance artwork, stronger 27px identity, taller/wider launch and selector controls, and larger selector metadata. The Play label and triangle receive an additional size/weight increase so they remain the primary action inside the expanded surface.
- Tightened the Locker detail footer by roughly half, bringing the selected-cape label and action closer to the cape preview while reducing the dead space below the action.
- Rebuilt every post-acceptance AutoTune state into one shared focused flow. Completed phase dashboards no longer remain stacked on screen; one centered title leads to a single action, progress, result, or confirmation surface for hardware scan, benchmark installation, the Minecraft test, profile generation, and final apply. Five small dots sit beneath that content with no numeric step label or line-style progress bar. They are driven by those real workflow states, including the installation-to-ready transition, rather than by a coarse decorative phase number. The benchmark install step keeps a concise honest summary visible and provides optional details covering exact downloads, the roughly 75-second workload, measured data, local privacy, and benchmark-world replacement. The native benchmark, saved measurements, profile calculation, and explicit apply confirmation remain real and unchanged beneath the simpler presentation.
- Standardized compact overflow menus across installed content rows, full instance-library cards, and the instance header. Each portaled menu now begins directly behind the complete owning card/platform with a 1px underlap and no air gap. Its square recessed top, rounded lower corners, and short downward black shadow make the card read as the raised layer in 3D space rather than a detached menu positioned lower in 2D. Short menus size to their actions and hide scrollbar tracks/thumbs. Expanded three-dot controls keep a rounded accent overlay.
- Regenerated Bloom's complete native icon family from the clean transparent 1024px flower source. The Windows taskbar icon now has dedicated 16, 24, 32, 48, 64, and 256px layers with the flower filling the canvas instead of the old padded dark-square artwork being scaled down.
- Extended the sidebar's darker account-footer backing surface through the full account section so it meets the divider instead of ending below it. Locker navigation now uses a purpose-built hanger mark rather than reusing the cosmetics feather.

## Regression records

### Locker gallery and account-aware preview

- **Reported:** The first restored Locker looked like a generic two-panel admin screen. Its title was left aligned with redundant helper copy and a large Refresh button, cape tiles were short raw texture crops with bright selected outlines, and the selected preview used a placeholder player instead of the signed-in account.
- **Decision:** Locker now uses the exact centered Settings-style raised header with only the page title. Refresh moves to a compact icon beside the catalog count. Catalog entries become taller instance-inspired cards with a lighter media stage and a curved near-black raised name base; selection uses typography and depth instead of an accent outline.
- **Interaction:** Catalog cards retain the efficient cape-only texture render. Hover/focus fades the name base into a real Equip/Unequip button with a restrained hover bloom and the client-wide configurable press response. The focused side panel renders the selected cape on the active account's official Minecraft skin, looked up from its UUID through the native client. Drag rotation uses damping so a release glides briefly instead of stopping abruptly.
- **Notification correction:** Transient launcher outcomes no longer appear as detached top cards. One full-width bottom bar rises from below the window, centers the outcome copy, uses green for normal/success states, and switches to the error surface for failures. Locker equip failures and successes use this same path instead of inserting an extra alert into the catalog layout.
- **Regression checks:** Nine-item pagination, animated cape frames, official/default/slim skins, account switching, drag inertia, Equip/Unequip, signed-out messaging, loading/offline states, narrow layouts, custom themes, disabled animations, and Ultra Performance Mode.

### Profile selector typography and centering

- **Reported:** The account label was too small, vertically offset, and later horizontally misaligned.
- **Cause:** A broad `.profile-settings-card span` rule forced the specialized dropdown value to 12px and added a top margin. The row also used asymmetric flex siblings (47px avatar versus 43px add button), so leftover-space centering was not true card centering.
- **Fix:** Explicitly scope the selector value’s size, margin, line height, color, and weight; position the chevron absolutely; use a three-column grid with equal outer tracks for the normal profile row.
- **Regression checks:** Normal account, long account name, visible status message, add-account state, default window, minimum width, horizontal center, and vertical center.

### Profile helper text clipping

- **Reported:** “Profile picture updated for every account” was cropped beneath the selector.
- **Cause:** The message was absolutely positioned outside the card’s reserved height while settings sections use rendering containment.
- **Fix:** Move the message into the picker’s grid flow, reserve card height, allow wrapping, and keep menus in a top-level portal.
- **Regression checks:** Success and error messages must increase layout height instead of overlapping the next section.

### Universal profile picture

- **Reported:** Switching Microsoft accounts reset the custom profile picture.
- **Cause:** Both account-switch and sign-out handlers explicitly cleared the launcher-wide icon state and storage.
- **Fix:** Remove account lifecycle resets, use one stable launcher storage key, and keep both avatar renderers bound to the same shared state.
- **Regression checks:** Switch account, add account, sign out/in, restart, and reselect the same image file.

### Toggle thumb stuck on the left

- **Reported:** Some enabled toggles showed an accent track while the white thumb remained left.
- **Cause:** JavaScript animation left a stale inline `translateX(0)` that competed with the CSS on-state.
- **Fix:** Remove JavaScript thumb positioning and use authoritative CSS state transforms with a transition.
- **Regression checks:** Every toggle must show left/off and right/on correctly with animations enabled, disabled, and in Ultra Performance Mode.

### Bottom-edge updater and development preview

- **Requested:** Present an available update from the bottom of the client, then let the blue surface rise over the whole window while the update runs.
- **Fix:** The real signed updater now owns one bottom action bar and one expanding full-screen progress state, with retry handling on failure. A development-only mock can be opened with `Ctrl+Shift+U` or the more reliable `Ctrl+Shift+F10`; it is registered in capture phase so focused controls cannot swallow it and is compiled out of production.
- **Regression checks:** Automatic and manual update discovery, download progress, install handoff, failure/retry, ad-rail widths, reduced motion, Ultra Performance Mode, focused text fields, and production builds with no mock shortcut.

### OLED-only theme selector

- **Requested:** Remove unfinished alternate themes while keeping the existing Theme control structurally intact.
- **Fix:** OLED Black is the sole selectable theme. The dropdown retains one disabled Coming soon row so future complete themes have an intentional home without exposing partial palettes.
- **Regression checks:** Restart persistence, custom backgrounds, every settings category, dropdown keyboard navigation, and disabled-row behavior. No alternate palette may remain selectable through stale storage.

### Spotlight scale correction

- **Requested:** Make the centered Spotlight identity, artwork, Play action, type, and selector meaningfully larger without expanding the surrounding home layout.
- **Fix:** Increased the internal scale and weight of the existing composition while preserving its centered reference frame, open space, and fixed control stack. Selection dropdowns keep an attached lighter lower surface with no accent outline on the closed trigger.
- **Regression checks:** Default and minimum window sizes, long instance names, open selector, three or more instances, ad rail present/hidden, and no hover lift.

### Sidebar Bloom wordmark

- **Requested:** Make the logo-and-name area at the top of the sidebar feel like a real Bloom lockup instead of a small generic label.
- **Fix:** Use one horizontal PNG lockup with the original flower preserved pixel-for-pixel and clean rounded `Bloom Client` lettering on the same line. Trim transparent asset padding before centering so the visible artwork—not its canvas—is centered and can fill the fixed-height header without moving the separator. The darker brand-zone surface reaches that existing separator instead of ending above it.
- **Regression checks:** Default and minimum sidebar widths, text/logo vertical alignment, custom backgrounds, accent changes, and Windows display scaling.

### Brandless sidebar and fourth sponsored slot

- **Requested:** Remove the complete sidebar wordmark area, make Home the first usable item at the top, and use the remaining sponsored-rail height for a fourth ad slot.
- **Fix:** Delete the brand markup, top brand surface, and separator. Navigation now starts immediately below the fixed window drag region without changing the lower account dock. The sponsored rail renders four identical slots and drops the final slot's unused bottom margin.
- **Regression checks:** Home remains clickable below the drag region, sidebar spacing holds at responsive widths, the account dock stays bottom-aligned, and four ad slots remain independently visible or scrollable at supported viewport heights.

### Functional title-bar menus

- **Requested:** Use the empty space above Home for simple File/Edit/View/Help text menus with real attached dropdowns instead of another brand block.
- **Fix:** Add text-only title triggers with no resting or active container. Their darker OLED dropdowns reveal downward from the trigger and route to existing instance, settings, profile, navigation, updater, and Java actions.
- **Regression checks:** Every command performs its existing action, only one menu opens at once, outside click and Escape close it, title-bar dragging remains available, window controls remain clear, and reduced-motion modes reveal immediately.

### Global hover-lift removal

- **Reported:** CSS hover lifts kept reappearing on newly added controls despite repeated requests for stationary color-only interaction feedback.
- **Cause:** The stylesheet contained a broad button selector that translated and scaled most buttons, while older design-history text still described that lift as the preferred behavior. Several profile, instance, and search rules repeated the same pattern locally.
- **Fix:** Remove the global hover transform and the remaining one-off profile-action, empty-instance, instance-card, and search-field lifts. Update the durable design rule to prohibit positional hover/focus motion. Title-bar menus are also excluded from the optional pointer-down pop and reveal through clipping/opacity without translating their rows.
- **Regression checks:** Hover and focus every primary button, menu trigger/row, profile action, empty-instance action, instance card, and search field at normal, disabled-animation, reduced-motion, and Ultra Performance settings; no control may change screen position or scale.
