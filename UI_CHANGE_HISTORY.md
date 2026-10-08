# Bloom Client UI Decision and Fix History

## October 2026 — structured instance action drawer

- Rebuilt the instance header's three-dot menu as a 320px attached action drawer while preserving the approved squared upper edge, rounded lower corners, and under-card reveal.
- Added a compact instance identity header, white unboxed icons, quiet file/action groups, short descriptions for sharing and duplication, a direct route to Instance Settings, and a separated dark-red two-step deletion row.
- Every visible row performs real work. Duplicate instance uses a native safe recursive copy into a unique sibling folder and refuses symbolic links or unverified source paths; deletion retains the existing guarded native removal path.
- Regression checks: long names, missing artwork, short viewports and menu scrolling, outside dismissal, reduced motion, Ultra Performance Mode, duplicate-name suffixing, copy failure cleanup, settings navigation, and two-step destructive confirmation.

## October 2026 — synced-pack access management

- Synced packs now issue one server-enforced credential per recipient instead of reusing the channel code. Owners can open `Manage access` from the Share flow to see the owner, active recipients, permissions, and pending invitations.
- `Can view` and `Can edit` changes take effect against the stored credential. Removing someone blocks future revision reads and publishes; invalidating a pending invitation makes its single-use capability fail.
- Older channels stay usable in legacy mode until the owner explicitly enables managed access. The upgrade view explains that old reusable links stop working and those people must be reinvited.

## October 2026 — removed global placeholder quick actions

- Removed the app-wide placeholder context menu labeled `Quick actions` with three nonfunctional `Coming soon` rows.
- Social messages retain their real right-click menu for Reply, reactions, Pin/Unpin, and sender-only Edit. Message handlers stop propagation so the app shell cannot replace the message menu again.

## October 2026 — message context actions and per-person reactions

- Removed the hover-only pin/reaction controls from direct and group messages. Right-clicking a delivered message now opens one compact menu with Reply, encrypted reaction choices, Pin/Unpin, and Edit message for the sender's own text.
- Replies retain the referenced encrypted message ID and show a restrained quoted preview above the new bubble. Edits are encrypted control events, apply optimistically with rollback, show a quiet `edited` label, and use durable encrypted pin updates when the edited message is pinned.
- Reaction state is keyed by message, emoji, and sender. Multiple people using the same emoji produce one plain chip with an inline count; toggling removes only the current person's reaction. Pending adds/removes retain the existing dimmed delivery treatment and cannot be clicked again until confirmed.
- Regression checks: two or more people sharing one emoji, toggle own reaction off while another remains, pending add/remove success and rollback, right-click at each viewport edge, outside-click/Escape/scroll dismissal, reply to either sender, edit own versus another person's message, edit pinned content, rapid conversation switching, and old-client handling of the distinct edit envelope.

## October 2026 — realtime incremental Social delivery

- Replaced the fixed four-second complete Social snapshot loop with one authenticated long-poll watcher backed by an opaque durable database cursor. Incoming message, reaction, and pin events wake the recipient immediately and decrypt only envelopes after the existing direct/group device cursors.
- Relationship, group, invite, profile, and device-identity changes still request one authoritative snapshot because those collections are small and correctness-sensitive. Missed signals and backend restarts are recovered from durable state; network failures fall back through two-to-thirty-second adaptive reconciliation, with a five-minute full repair pass.
- Account changes logically cancel the previous watcher, duplicate wakeups remain idempotent, and realtime results participate in the same sequence and mutation barriers as optimistic sends so rapid chat switching cannot restore stale state.
- Regression checks: idle timeout with no snapshot rebuild, immediate direct/group delivery, reactions and pins, duplicate idempotency keys, hundred-message ordering, backend restart, offline exponential fallback, resumed connectivity, friend/group/invite mutations, device identity changes, rapid conversation switching, sign-out/account switch during a pending wait, and five-minute drift repair.

## October 2026 — Social optimistic-send race and burst ordering

- Direct and group messages now participate in the same mutation barrier as reactions and pins, so an older four-second snapshot cannot erase a message immediately after its optimistic state becomes confirmed.
- Recent confirmed sends receive a short reconciliation grace period, pending and failed sends survive snapshot refreshes, and outbound encrypted mutations are serialized in submission order.
- Message composers remain responsive during encryption, allowing rapid sends to appear immediately while the queue processes them safely.
- Backend idempotent retries no longer consume another rate-limit slot, and one group event sent to several members counts as one logical event rather than one event per recipient.

## October 2026 — quiet encryption verification fail-safe

- The labeled Encryption action now opens a real full-height Bloom drawer instead of emitting an informational toast. It shows the selected Bloom identity, active encrypted-device count, deterministic twelve-group safety number, matching QR, first-seen date, copy action, manual confirmation, and QR-image scanning.
- Verification is optional and locally stored inside the encrypted Social vault. Normal conversations continue to show only `Encryption`; unverified status never nags or blocks ordinary messaging.
- Every outbound encrypted event checks the recipient's authenticated active-device directory. A directory differing from the locally remembered fingerprint is persisted as `Key changed`, invalidates the normal send path, changes the header to `Review encryption`, and replaces the composer with one contained review action while leaving existing history visible.
- `The numbers match` adopts and verifies the observed identity. `Continue without verifying` requires an explicit decision, adopts the replacement without claiming verification, and restores encrypted sending. A changed identity can never become verified automatically.
- The live Social backend now returns both Curve25519 and Ed25519 public device identities to the account owner, accepted friends, or shared group members. It continues to expose no private key material.
- Regression checks: first observation, verified relaunch, deterministic number on both sides, QR match/mismatch, reordered device response, added/removed/rotated device, changed identity before text/screenshot/reaction/pin, continue-unverified, existing history visibility, group send containing a changed member, offline directory fetch, minimum window width, reduced motion, and complete close-button hitboxes.

## October 2026 — persistent Locker media and stable cache hydration

- Added managed caching for official Minecraft skins and capes, generated skin thumbnails, and Bloom cloak artwork/catalog data.
- Stopped re-fetching the Minecraft wardrobe during ordinary Locker navigation. The reload icon is now the explicit, user-controlled refresh path, preventing avoidable Minecraft rate limits.
- Kept Locker collections populated during background refreshes to remove category-switch flicker.
- Sharpened official cape presentation with nearest-neighbor card rendering and a higher-resolution 3D canvas.
- Prevented cached instance pages from flashing an empty-content state before their installed-content list finishes hydrating.

## October 2026 — website-backed Bloom accounts

- Added the website account system needed by future Social and support-ticket work: Google/GitHub OAuth, durable Bloom sessions, explicit provider linking, account switching, and a real dashboard.
- Kept website identities isolated from Microsoft/Minecraft launch credentials. Matching provider emails never silently merge accounts, and OAuth tokens are encrypted at rest.
- The website header now replaces Sign in with the authenticated avatar and a small account menu; the dashboard owns profile, connection, session, and deletion controls.

## October 2026 — Social narrowed to encrypted direct messages

- **Requested:** Replace visible pack-sharing codes with a future Social system, but begin with only a strong direct-message rail and central chat inspired by a dense community-chat reference. Keep reactions, emoji, and small screenshot uploads while deferring status, downloads, groups, channels, and other side content.
- **Decision:** Social v1 is a two-pane page with recent direct messages at left and one end-to-end encrypted conversation at right. It includes exact-name friend requests, a labeled per-friend Encryption drawer with safety-number and QR verification, encrypted reactions, Unicode emoji, and one normalized encrypted image per message. Pack rooms and pack-sharing migration remain deferred; Utilities keeps the current sharing flow until the encrypted replacement is production-ready.
- **Regression checks:** Do not add a third permanent rail, fake contacts, public channels, presence dots, typing indicators, activity statistics, or unexplained security icons. Message hover actions stay stationary. The backend must receive only encrypted envelopes and encrypted image blobs; all signed-out, empty, offline, blocked, key-change, upload-failure, and retry states must be functional before Social navigation is enabled.
- **24-hour retention and pins:** Regular messages, reactions, encrypted envelopes, and screenshot blobs now expire after 24 hours. A delivered message exposes a white pin on hover, conversations expose one compact unbadged pin button beside their existing header actions, and a rounded drawer shows only durable pinned content. Pin snapshots remain end-to-end encrypted; the backend retains opaque pin envelopes without learning the saved text or attachment key. Pin/unpin success toasts are intentionally omitted. This keeps routine sync and decryption bounded while explicitly pinned items remain available.
- **Titlebar hitbox correction:** The Social pin control and the close buttons in pinned/member drawers previously extended beneath a full-width transparent drag surface, leaving only their lower halves clickable. The titlebar now owns a bounded empty-space drag handle instead of covering the complete window. Drawer surfaces, titles, and close controls can therefore remain flush to the top with complete hitboxes; page controls still never stack over native window controls.
- **Stale Social refresh correction:** Four-second polling previously captured an old selected-DM value and could apply a snapshot that began before a pin mutation. That made conversations jump back, drawers appear to close, and pin state visually undo itself. Social now rejects out-of-order or mutation-stale loads, selects the first DM only through a functional null fallback, applies pin state optimistically without success notifications, and serializes native vault snapshot/send/pin writes so an older save cannot overwrite a newer one.
- **Identity revision:** Replaced Minecraft-only Social login with a branded Delight Productions account authenticated through Google or GitHub. A user chooses a Delight username, may explicitly link both providers, and links Minecraft separately for game ownership and skin identity. Provider emails never auto-merge accounts, provider tokens are not retained for unrelated API access, and OAuth recovery cannot silently recover or replace E2EE keys.
- **Website revision:** The browser entry for that Delight account now belongs to a new standalone Bloom Client website, not a Delight Productions company site. The launcher opens Bloom's account route; the account remains provider-backed and may later serve other Delight products without changing Bloom's direct product website into a company portfolio.

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

### Custom accent color picker

- **Request:** Add a recognizable custom-color option beside the existing accent presets, opening the familiar large saturation/brightness gradient with a full-spectrum hue control.
- **Decision:** The seventh swatch is locked to the exact 25px size of every preset and uses no icon. A restrained light-to-dark gray split and gray border communicate that it is customizable; once applied, the same tonal treatment adopts the chosen accent. The undersized eyedropper treatment and the earlier rainbow treatment were both rejected and must not return. The trigger opens a compact Bloom top-layer picker with a raised identity header, live color preview, two-dimensional saturation/brightness field, hue slider, and validated hex input.
- **Behavior:** Color changes remain draft-only until Apply. Cancel, Escape, and outside click preserve the prior accent; Enter from a valid hex field applies. The same `settings.accent` hex value and existing persistence pipeline serve both presets and custom colors, so every accent-aware surface updates without a second theme system.
- **Visual rules:** Use dark borders that remain darker than their surfaces, restrained black depth, no glow, no browser-native color control, and an accent-filled Apply action darkened enough for white text. The picker renders through `document.body` and repositions on scrolling/resizing so the Settings card cannot crop it.
- **Accessibility and performance:** The gradient supports pointer dragging and keyboard arrow adjustment, the hue uses a labeled range, invalid hex values are announced and blocked, and entry animation respects Show Animations, Ultra Performance Mode, and reduced motion.
- **Regression checks:** Every preset, arbitrary custom color, reopening an existing custom color, invalid/valid hex editing, Enter/Apply/Cancel/Escape/outside click, scrolling Settings while open, short and narrow windows, every theme, custom backgrounds, disabled animation, Ultra Performance, and keyboard-only adjustment.

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
- Active-page experiment replaces the flat selected surface and inset outline with one restrained accent-to-neutral gradient. It uses no dots, bars, streaks, glow, or extra ornament, and follows the selected route rather than special-casing Utilities.
- OLED selector correction: the first experiment only changed the retired Dark-theme override, so the selectable OLED theme still showed its old flat surface. The gradient now lives on the real base active-navigation rule with a deliberately stronger accent mix that remains visible against the near-black sidebar.
- Gradient direction follow-up reverses that active surface: it now begins neutral beside the icon and label, then develops the accent toward the row's right edge.
- Gray diagonal experiment removes the accent from the selected surface itself. The background now travels diagonally from dark gray at the bottom-right to lighter gray at the top-left, while the existing accent remains limited to the icon and label.

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

### Regular Dark

- Rebuilt the regular Dark theme from the complete surface-token system instead of isolated gray overrides. The palette is now neutral charcoal with a deep canvas, progressively lifted panels, darker controls, cool neutral muted copy, slate borders, and matching ad/scrollbar surfaces; OLED Dark and Dusk remain unchanged.
- Removed the logo area's hard black rectangular cutoff. The sidebar now stays one continuous charcoal surface with a darker top fade behind the centered Bloom mark and a short faded separator beneath it; the account zone receives the matching lower fade.
- Calibrated depth separately for regular Dark instead of inheriting shadows designed for OLED black. Raised page/category headers, account platforms, instance cards, floating menus, catalog/search surfaces, and the custom accent picker now use shorter translucent shadows. The color picker also replaces heavy 2px pure-black outlines with restrained 1px theme-aware dark edges, and opened dropdown rings are quieter without losing keyboard visibility.

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
- Refined Spotlight's instance selector without changing its interaction. The selected card now has cleaner spacing, weight, and restrained dark depth; its inset option menu remains attached beneath it with a square underlapping top and rounded lower corners. Opening no longer swaps the dark card edge for a thin accent outline, while keyboard focus retains a separate muted accessibility ring.
- Cleaned every installed Mods, Resource Packs, and Shaders row into one cohesive identity-and-actions banner. Version, loader/type, and file size now form a compact metadata line beneath the name instead of floating in separate columns; artwork is slightly larger, the row uses restrained dark depth, and enable/overflow controls stay grouped at the right without changing their real behavior.
- Consolidated installed-content sorting and enabled-state filtering into one 42px rounded-square three-line filter action beside Add for Mods, Resource Packs, and Shaders. Its attached Bloom menu separates Sort by (Name/Size) from Show (All/Enabled/Disabled), indicates non-default filtering through the accent, closes through outside click or Escape, and resets pagination whenever search, sort, or status changes. The bottom floating control is now search-only instead of carrying a second long dropdown.
- Corrected the installed-content filter menu's depth anchor. Its horizontal edge still follows the filter action, but its vertical edge now follows the bottom of the complete raised Mods/Resource Packs/Shaders header, placing the menu directly beneath that platform and above the scrolling file banners instead of opening inside the header.
- Simplified that shared content-filter menu after the first version still felt too busy. Sort and Show now use two compact horizontal segmented rows with no section divider or individually outlined choices; only the current choice has a quiet accent fill. Opening changes the filter icon color without introducing a blue outline, while a tiny accent dot communicates a non-default sort or enabled-state filter. The real filtering, page reset, outside-click/Escape handling, and under-header depth anchor remain unchanged.
- Redesigned the shared installed-content search as a noticeably more expressive floating command dock without changing its filtering logic or overlap position. A 48px search tile anchors the left; focus widens and lifts the whole surface with a longer, softer ease while gently articulating the icon, and a functional clear action enters only when text exists. Follow-up removed the lower accent beam and per-keystroke pixel burst so the interaction stays calm. The content-list viewport now remains 475px tall across full, filtered, loading, and empty states, preventing the dock and active input from teleporting as result counts change. The placeholder, caret, selection, and shadows share the active theme, and every decorative animation is removed by Show Animations off, Reduced Motion, and Ultra Performance Mode.
- Replaced the generic installed-content empty panel with a branded fractured Bloom state shared by Mods, Resource Packs, and Shaders. The initial CSS split and colored crack were rejected; the final implementation uses one static `bloom-logo-broken.png` made directly from the real flower pixels. Its two clean halves sit visibly apart around transparent heart-style negative space cut through the center circle, with no line outside the logo and no animation. Genuine empty folders expose real Browse Modrinth and Open folder actions; empty search/filter results correctly explain that nothing matched and provide Reset view instead of falsely saying nothing is installed. Catalog searches receive the same visual state and a real Clear search recovery.
- Replaced the signed updater's centered confirmation modal with one continuous bottom-edge update surface. Availability now appears automatically as a compact blue bar; Update now, Settings, and the sidebar update affordance start the real verified download and expand that same surface upward. The full state shows actual download percentage, installation/restart status, and a recoverable retry path without changing updater verification or release metadata.
- Added a development-only updater visual test on Ctrl+Shift+U. It exposes the same bottom bar and runs a timed local progress/install sequence, but is removed from production builds and never downloads, installs, relaunches, or substitutes for the signed updater path.

## Utilities and Global File Sync — October 5, 2026

- Added Utilities as a first-class sidebar destination between AutoTune and Settings. It is intentionally the home for real cross-instance tools rather than another copy of instance-local Mods, Resource Packs, or Shaders pages.
- Established the Utilities home pattern: a normal Bloom header above a responsive grid with one near-square card per complete utility. Global File Sync is represented by one card rather than splitting its five settings into separate products. Each card uses the instance-library structure: one rounded raised identity surface with a restrained Lucide icon, direct title and combined status, followed by a recessed action row with an accent-filled Configure button. The complete card receives no hover outline. Avoid marketing copy, illustration-heavy tiles, permanent glows, and UI-only controls.
- Added the first complete utility, Global File Sync, covering `options.txt`, `servers.dat`, Simple Voice Chat client properties, globally shared resource packs, and globally shared shader packs.
- Source-file sync always chooses an authoritative instance, compares bytes before writing, creates timestamped backups for changed destinations, and reports missing source files instead of creating fake empty settings. Simple Voice Chat allows explicit per-instance destinations rather than silently affecting every instance.
- Resource and shader sharing uses one live Bloom-managed folder connected to every instance through platform-native directory links. Existing instance content is merged before linking; conflicting filenames preserve both files by adding the source instance name. Disabling sharing materializes local copies again before removing the link. Links owned by another tool or a manual setup are never replaced or detached.
- Corrected the first Utilities presentation, which exposed Global File Sync's five settings as if they were separate utilities and expanded configuration below the library. Configure now opens a dedicated instance-style detail view with a real Back button; the five behaviors are organized as settings sections inside it. A final consequence summary remains required before filesystem changes, and saving setup and running sync remain separate real actions.
- Simplified the Global File Sync landing card after its subtitle, configured-count line, and boxed icon made it feel undersized and overexplained. The card now keeps only a larger unboxed sync icon, larger title, and larger accent Configure action; detailed status remains available inside the utility.
- Removed the remaining explanatory clutter from Utilities and Global File Sync. The landing header no longer carries a generic subtitle or library count, and the detail view removes instance/configuration totals, file-path captions, destination statuses, repeated behavior descriptions, selected totals, and instance-version subtext. Section names, essential labels, and real controls remain; the final apply confirmation retains only the materially important backup warning.
- Simplified the Global File Sync detail header to one action. Removed its duplicate refresh control and moved Back into the far-right action position, leaving the utility identity uninterrupted on the left.
- Added Modpack Sharing as the second real Utilities feature. A user can select a Fabric instance, generate an expiring eight-character code and copyable backend link, or paste either form to create a new instance through Bloom's existing `.mrpack` downloader and progress UI. The launcher publishes only Modrinth-verified paths, HTTPS downloads, and SHA-1 hashes—never local JAR bytes, account data, saves, server lists, options, or configs. The backend persists validated manifests with expiry, request/file limits, collision-resistant codes, and per-address creation limits on the existing Cloudflare-routed Minecraft API.
- Corrected mixed-source pack sharing so private or otherwise unresolved local JARs no longer reject the whole share. Bloom installs every file Modrinth can verify, carries unresolved entries as filename-only metadata, and keeps a dismissible Find these mods list in Downloads across restarts. JAR bytes and local paths remain private.
- Added revisioned Group packs inside the existing Modpack Sharing utility. The initial ownership-transfer idea was replaced with stable ownership plus up to five one-time Editor invitations: the original creator cannot be displaced, editors can publish conflict-checked revisions, ordinary members remain read-only, and clients check the small revision marker every fifteen minutes while the utility is open. Applying an update verifies every Modrinth file, backs up replaced managed files, and preserves unrelated or locally modified mods.
- Rebuilt Modpack Sharing after the first stacked settings-card layout felt repetitive and made editor invitations undiscoverable. It now follows the approved instance/Locker structure: one raised identity platform, an attached darker shelf with Shared Packs and Group Packs tabs, and a separate recessed workspace below. Shared creation/import actions balance across two columns; Group Packs has a focused management view, and Create editor code is an explicit labeled action instead of an unexplained people icon.
- Replaced the second sharing revision after its tab content still exposed a dense configuration form. Shared Packs and Group Packs now begin with large New Instance-inspired action choices and drill into one task at a time through a centered step surface with a real Back control. Group creation, member joining, editor joining, and existing-pack management are separate flows; the management dashboard keeps the group code, revision publishing, update application, and labeled editor invitation action visually distinct.
- Replaced the generic Group management form and its incorrectly balanced three-column copy bar with a project-control surface. Group identity now lives in one raised header row with the code and metadata on the left and a labeled Copy control pinned to the far-right edge. Publish, editor invitation, and update actions use separate compact command rows beneath it; generated editor codes appear as their own clearly labeled ticket rather than reusing the ambiguous share-result bar.
- Added durable group-role visibility to connected instances. Bloom reads the local group membership registry once for the instance collection. Instance Settings always states Owner, Editor, or Guest; outside Settings, Owner is intentionally unmarked while Guest and Editor use distinct colored vertical role strips tucked behind the right rounded edge of the instance image in the sidebar, full library, and opened header. The markers reflect the real persisted publishing role and do not require a backend request per card.
- Corrected the first image-attached role marker: narrow cards had collapsed it into an unlabeled colored bump, while the opened header made it read as a full-height adjacent block. The strip is now shorter than the artwork, remains behind the image with only a controlled rounded edge exposed, carries a readable whole-word label rotated upward, and uses enough dark side shadow to preserve the layered relationship at every icon size.
- Refined the marker again after the shortened backing still read as a pill and left too little room for its label. The backing now spans the complete artwork height, exactly repeats each icon's right-side corner radius, remains underneath the artwork, and exposes a wider colored edge with larger high-contrast whole-word text. Sidebar and opened-header sizing are calibrated separately so neither collapses the label.
- Simplified the role edge to an unlabeled, slightly thinner resting state. Only hovering the exposed role strip expands its color left across the complete artwork and reveals a centered GUEST or EDITOR label; hovering the image or surrounding card does nothing. The requested slide is limited to this role disclosure and is disabled with Bloom's animation, reduced-motion, and Ultra Performance controls.
- Corrected the disclosure direction after the first hover treatment covered the artwork. The thin resting strip remains tucked beneath the icon, but its reveal now grows only to the right across the title/version region while the icon stays fully visible and stationary. The sidebar, opened-instance header, and full Instances library use that same ownership-preserving reveal.
- Removed external role decoration entirely after the image-attached and expanding-strip approaches remained visually distracting. Group role now appears only as the first dedicated surface in Instance Settings: OWNER uses gold lettering, EDITOR uses orange, and GUEST uses blue. Sidebar, library, Spotlight, and opened-instance identities remain clean.
- Deployment verification caught two reusable backend hazards: Windows CRLF broke Bash `pipefail`, and `systemctl enable --now` left the already-running old container active after a rebuild. Shell scripts are now forced to LF through `.gitattributes`, and the installer explicitly restarts `bloom-api`. Live verification must confirm the public health capability changed, not merely trust a successful image build.
- Saved drafts and successfully applied setups are persisted separately. Newly created instances inherit only the active file sources and shared pack links, preventing a draft from unexpectedly changing their files; Simple Voice Chat remains opt-in.
- Active file rules are reapplied to the selected instance before Minecraft launches. A sync failure stops launch and reports the cause rather than silently using stale settings; resource and shader folders remain live through their directory links.
- Corrected the original feature-branch base after testing revealed the v1.1.5 Locker was absent and the client offered its own current release as an update. Utilities now sits on the v1.1.5 `main` history beside Locker, cosmetics, wardrobe, and cape integration. Future feature verification must confirm current `main` ancestry before UI review.
- Fixed the v1.1.5 development client exposing Locker without an embedded cape renderer. Both normal Tauri development and production builds now prepare the real managed renderer first, while release compilation rejects missing or checksum-mismatched renderer assets instead of producing a broken distributable.
- Regression checks: zero instances, one instance, missing source files, duplicate instance names, identical destination files, conflicting pack filenames, existing directory links, failed link creation with rollback, disabled sharing, reduced motion, custom backgrounds, minimum width, and remembered Utilities startup navigation.
- Standardized the missing-artwork state for newly created instances. The opened-instance header now uses the same bold `?` shown by the sidebar and instance library instead of switching to an unrelated blue cube; choosing or importing custom artwork continues to replace the fallback everywhere.
- Corrected the opened-instance artwork picker alignment. The fallback question mark and hover swap icon now occupy independent absolute overlays centered against the full 112px artwork square; they no longer become two implicit grid rows that push one above center and the other below it.

## Regression records

### Social account approval and provider identity

- **Requested:** Social must never silently reuse a browser session or ask the user to recreate profile information already owned by their Bloom account.
- **Decision:** Every native connection opens a focused website approval step. Saved Bloom accounts are shown explicitly, one must be selected, and approval is required on every connection.
- **Identity:** The selected account's current Google or GitHub display name and avatar are copied through the short-lived PKCE authorization record into Social. A stable unique friend name is derived automatically on first use, while the client prefers the provider avatar over Minecraft or initials.
- **Signed-out state:** Social uses a small flower, direct title, one sentence, and one real Connect account action; the rejected oversized marketing block is removed.
- **Rail correction:** The nested Social rail is flush with the global sidebar and every viewport edge, with rounded outer-right corners framing its divider. Its header is one centered white Social title, and the redundant blue eyebrow and Direct messages subtitle are removed.
- **Account menu:** Clicking the bottom Social identity toggles one compact rounded popover above it, separated by a small gap, with only a real Sign out action. Account changes deliberately require signing out and completing the normal website approval flow again; no separate Switch account shortcut is shown.
- **Optimistic sending:** A text message enters the conversation immediately at reduced opacity, encrypts and sends in the background, then becomes fully bright only after server acceptance. Established device sessions reuse a recent device-key discovery result for sixty seconds, and successful sends return the confirmed message directly instead of blocking on a complete five-request Social refresh.

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
### Social sync failure isolation

- **Reported:** One encrypted-envelope failure made Social appear to have no friends or conversations even though the account and backend data were intact.
- **Cause:** Snapshot loading treated message decryption as an all-or-nothing prerequisite for returning account, friendship, and cached-history data.
- **Fix:** Account and friendship data plus the last known-good local message vault now remain visible when encrypted synchronization pauses. The failing envelope is left uncommitted for a future retry, and the client reports the specific encryption error once instead of blanking the complete Social surface.
- **Regression checks:** Offline API, expired session, damaged envelope, stale device session, valid new envelope, cached screenshot history, and four-second background refresh.
### AutoTune utility navigation

- **Requested:** Remove AutoTune from the global sidebar, expose it as a Utilities grid item, and place Social directly below Locker with Utilities below Social.
- **Fix:** The sidebar now follows Home, Instances, Locker, Social, Utilities, Settings. Utilities includes an AutoTune card whose Configure action routes to the existing AutoTune flow unchanged; no parallel settings or mock configuration surface was created.
- **Regression checks:** Sidebar active states, Social rail layout, Utilities grid at responsive widths, AutoTune onboarding and completed-state flow, browser Back-independent navigation, and Remember last page startup behavior.

### Social native account handoff

- **Reported:** Website approval could remain on “Finishing in Bloom Client…” while Edge rejected or stalled the page's request to a random localhost callback port.
- **Cause:** A public HTTPS page was attempting a cross-origin request into the browser's loopback/private-network boundary. That transport depends on browser CORS and private-network behavior and is not a reliable native-app handoff.
- **Fix:** New clients generate a high-entropy state plus PKCE challenge, open the normal explicit website approval, and poll Bloom's HTTPS API for that single-use approval. The website records approve or cancel and completes immediately; the native client verifies the returned profile, exchanges the one-time code, and stores tokens under that profile. Legacy releases retain a top-level loopback redirect without a page-level fetch.
- **Session reliability:** Temporary backend failures preserve the last verified local profile instead of presenting a false signed-out state. Legacy unscoped credentials are removed after migration and during sign-out so an old account cannot silently reappear.
- **Regression checks:** Approve, cancel, refresh/retry approval, multiple browser accounts, PKCE mismatch, expired and reused approvals, offline API, backend restart, legacy loopback client, explicit sign-out, and relaunch after sign-out.

### Bloom account username wording and friend entry

- **Reported:** Social still exposed the retired Delight identity name, retained a successfully submitted friend username in the field, and repeated Friends as a blue eyebrow above the real page title.
- **Fix:** User-facing Social language now consistently says Bloom account username. A friend-request field clears only after the backend accepts the request and stays intact after an error. The Friends directory uses one white title with its count aligned at right and removes the redundant accent eyebrow and reserved gap.
- **Regression checks:** First-time username setup, saved notification, add-friend placeholder and empty states, successful request, failed/duplicate request, Friends count alignment, and narrow client widths.

### Private encrypted group chats

- **Requested:** Add real group chats for at most ten people, keep group and direct lists independently collapsible and wheel-scrollable without visible scrollbar chrome, and manage membership from a rounded drawer entering from the sponsored side of the conversation.
- **Fix:** Social now has server-backed private groups with owner membership, accepted-friend-only additions, a hard ten-person total cap, and encrypted per-device fan-out for text and reactions. Group chats appear above Direct messages in independently collapsible rail sections. The member drawer overlaps the conversation/composer edge, closes through a visible X, exposes a labeled add-person action, and gives every member a three-dot menu with real copy/open-DM/remove-or-leave actions where permitted. The main Friends list uses the same overflow pattern for copy username, open direct message, and real friend removal.
- **Security:** The backend checks group membership on every list, add, remove, key-discovery, and envelope operation. Removed members keep already decrypted local history but cannot fetch future group envelopes or member data.
- **Regression checks:** Empty and long group/direct lists, wheel scrolling with hidden bars, create with 1–9 friends, rejected eleventh member, non-friend addition, owner removal, member leave, indirect group member encryption, relaunch persistence, optimistic send failure, and narrow client widths.

### Compact group rail and shared group identity

- **Reported:** One group consumed half of the Social rail, the empty-conversation group mark rendered as a generic broken-looking glyph, the header Members control was partly covered by the frameless drag region, and group identity could not be changed.
- **Fix:** Group chats now start collapsed, expand automatically after creation, and size to their actual rows before scrolling at a capped height. Group artwork renders consistently in the rail, header, and empty state. The header artwork uses the instance artwork dim-and-swap hover, while double-clicking the header name enables an inline rename; both changes persist to the shared group record for every member. The group header is positioned below the frameless drag hit area so the complete Members control remains interactive.
- **Regression checks:** Zero, one, and long group lists; create/open behavior; rail collapse state after launch; PNG/JPEG/WebP artwork; rename via Enter, blur, and Escape; another member's next refresh; Members hover/click across the complete control; reduced motion and Ultra Performance Mode.

### Collapsible global sidebar

- **Requested:** Add a collapse control opposite Help, reduce the entire client sidebar to icons and compact instance artwork, keep the bottom account menu working as an icon-only upward drawer, and replace File/Edit/View/Help with a hamburger while compact.
- **Fix:** One persisted compact state now changes the existing sidebar instead of creating a parallel navigation tree. Every navigation route, recent-instance open/play target, create-instance action, download indicator, Logs action, update action, and account action remains connected. The title row switches between the four existing menu triggers and one grouped hamburger menu with the same commands; the chevron stays at the sidebar's far edge and rotates to communicate expansion.
- **Regression checks:** Expand/collapse repeatedly, relaunch persistence, all six navigation targets, instance single/double-click and Play hover, empty-instance creation, active download ring, Logs, available update badge, signed-in icon drawer, signed-out expansion into authentication, custom backgrounds, 940/1100/1350 responsive widths, reduced motion, and Ultra Performance Mode.

### Bounded client cache and catalog prefetch

- **Requested:** Revisiting an instance should not visibly rebuild its mod list, and moving through Modrinth pages should not wait on each page. Cache capacity, location, usage, and clearing must be user-controlled.
- **Fix:** Bloom now caches parsed instance metadata/artwork by file identity, keeps recently displayed content in memory, stores catalog pages for 15 minutes, and warms the next two pages and their artwork. Settings includes a Cache destination with an accent usage meter, striped unused capacity, continuous 0.5–12 GB slider, dedicated folder picker, and real clear action.
- **Safety:** Cache writes are atomic and size-bounded. Custom locations are forced into a dedicated `BloomCache` child, and clearing refuses broad or unrelated folders. Cached catalog data never bypasses install validation.
- **Regression checks:** Cold/warm instance opening, file replacement and enable/disable invalidation, cold/warm catalog paging, search and category key separation, offline cached browsing, capacity reduction, cross-volume folder move, clear and immediate repopulation, malformed cache files, and paths outside the dedicated cache folder.
- **Refinement:** Cache usage switches to KB or MB below 0.01 GB instead of displaying a misleading `0.00 GB`. Trusted Modrinth artwork now counts toward the managed cache. Catalog and installed-content pages show 50 items, use the provider's complete reported total, and keep warming the next two pages. Cache actions use true-black/gray and dark-red/red hairline treatments rather than bright outlined buttons.

### Immediate encrypted reaction feedback

- **Requested:** Reactions should feel immediate like optimistic message sending instead of appearing only after encryption and upload finish.
- **Fix:** Direct and group reactions now appear instantly as dimmed, non-interactive reaction chips. The pending chip becomes fully opaque when the encrypted event is confirmed, or disappears with an error if delivery fails. Pending reactions participate in the same mutation ordering guard as pins so a background snapshot cannot erase or prematurely confirm them.
- **Regression checks:** Direct and group reactions on fast and throttled connections, failed delivery rollback, repeated background refreshes during delivery, simultaneous reactions, and conversation switching while a reaction is pending.

### Social account-transition loading and rotated encryption sessions

- **Reported:** Switching Bloom accounts briefly rendered the previous account's Social data before the new vault finished loading, the signed-out Social flower used a broken root-relative asset path, and one reconnected account could send group messages but could not decrypt new messages from other members.
- **Fix:** Account connect and sign-out now keep the full Loading Social state mounted until the replacement session and snapshot are ready, then replace the old snapshot atomically. The signed-out flower resolves from the application's document base so it works in the packaged client. Before every encrypted send, the client checks the recipient's authenticated active-device directory; a missing, revoked, or changed Curve25519 identity removes the stale outbound session and negotiates a fresh prekey session. The backend atomically discards unused prekeys from the previous identity before accepting replacement keys. A fresh incoming prekey also replaces a stale inbound sender session, while irrecoverable legacy envelopes are skipped without blocking later valid messages.
- **Regression checks:** Sign out and reconnect between two locally stored Bloom accounts; packaged asset loading; device identity reset with the same device ID; removed recipient device; direct and group send in both directions; an old undecryptable envelope followed by a new valid prekey envelope; and cached local history during a temporary backend failure.
- **Hydration correction:** Loading Social now remains mounted until the signed-in account's authoritative friends, groups, invites, and decrypted local message history have been applied together. Session discovery no longer starts realtime watching before the first snapshot completes, stale/superseded requests cannot dismiss loading, and failed initial/account-transition hydration retries with bounded backoff instead of exposing an empty intermediate page.

### Friend-only instance invitations

- **Requested:** Share an instance from its three-dot menu with Social friends, but keep the setup and received message extremely simple while preventing the retry, flicker, and partial-state failures previously found in Social.
- **Decision:** `Share instance` opens one three-step modal for copy/synced choice, friend selection, and an optional short message. Received invitations are gift-style cards sent into the matching direct conversation rather than administrative Inbox rows. They carry the real normalized instance artwork, sender, instance, version/loader, a labeled Accept action, and a compact X decline action; the conversation row previews the invite even when no note was added.
- **Visual refinement:** The selected instance lives in a darker rounded-bottom identity header with a restrained shadow. Choice icons are unboxed white marks, and the centered synced permission selector uses the direct labels `Can view` and `Can edit`.
- **Reliability:** Creation is friend-scoped, transactional, rate-limited, and idempotent. Internal pack codes are omitted from every list response and released only through a recipient claim lease. Import failure releases that lease for retry; acceptance is recorded only after the native import succeeds. Optional encrypted note failure cannot erase a durable invitation or duplicate the note during a retry.
- **Regression checks:** Copy, synced member, synced editor, zero friends, ten-recipient limit, editor limit, retry after timeout, duplicate submit, failed import/retry, concurrent claim, decline, pending revoke, expiry, background refresh, relaunch, and no capability leakage.

### Utilities sharing cleanup

- **Requested:** Remove Modpack Sharing from Utilities without removing instance sharing.
- **Fix:** Utilities now contains only AutoTune and Global File Sync. Instance sharing remains available from each instance's three-dot menu and continues to deliver invites through Social direct messages.
- **Regression checks:** Utilities card layout, AutoTune and Global File Sync navigation, instance three-dot Share instance action, and Social invite acceptance.

### Recent Mods searches

- **Requested:** Keep five recent searches in the instance Mods search and expose them in both the installed list and Add Mods catalog.
- **Fix:** An off-by-default Cache setting enables one local, case-insensitive, five-item history shared by the two Mods views. Focusing the bottom search field reveals a panel upward in screen space but behind the search bar in depth, with the bar overlapping and shadowing its lower edge. Selecting an entry reruns it immediately, and Clear cache removes the history with the other transient caches.
- **Loading refinement:** Catalog and cold-content searches now reuse the exact Loading Social spinning-arrows treatment. Uncached Add Mods results wait until their first ten rows are visually ready, reveal top-to-bottom, and add later rows in batches of ten near the scroll boundary while preserving every existing cache and prefetch path. Already-installed mod rows remain static without the entrance animation.
- **Regression checks:** Default-disabled and enabled history, installed Mods and Add Mods search, duplicate casing, sixth-entry eviction, selecting an entry, Escape and outside focus, empty history, Clear cache, cached and uncached first batches, repeated near-bottom scrolling, page changes, reduced motion, and Ultra Performance Mode.

### Mod details side drawer

- **Requested:** Opening a mod should preserve the current list position and reveal its details from the right instead of navigating away from the instance.
- **Fix:** Installed Mods and Add Mods results now open an isolated right-side drawer. Its identity header shows artwork, name, author, installed or compatible version, and source; restrained Description, Dependencies, Versions, and Files sections scroll independently while the real Install state remains pinned at the bottom. Catalog details come from Modrinth and are cached for thirty minutes; local-only files clearly identify unavailable provider metadata rather than inventing it.
- **Reversibility:** The presentation lives in its own component and stylesheet with only selection wiring in the instance page, so the experiment can be removed without changing catalog search, installed-list rendering, or installation behavior.
- **Layering refinement:** The complete drawer, including its pinned footer, now sits above the floating search and pagination layers. A transparent sibling dismiss layer captures clicks anywhere else in the instance manager while preserving every interaction inside the drawer.
- **Full-width action footer:** Removed the split compatibility/status copy and small trailing control. The drawer's entire pinned bottom section is now one large action: accent-filled Install or Installing when actionable, and one restrained full-width Installed state when the mod is already present.
- **Regression checks:** Installed and catalog mod selection, list scroll-position retention, repeated project opens from cache, dependency-free projects, multiple compatible versions/files, offline detail failure with retained search summary, Install queue state, installed state, Escape/X close, narrow widths, reduced motion, and Ultra Performance Mode.

### Full-width instance content tabs

- **Requested:** Make the Mods, Resource Packs, and Shaders labels easier to read and let the selected highlight occupy the complete tab area instead of floating inside a padded track.
- **Fix:** The labels now use a larger, stronger type treatment. The animated selection surface remains limited to one of the three tabs but reaches the track's top, bottom, and horizontal segment edges, with overflow clipped by the shared outer radius.
- **Regression checks:** All three selected positions, animated and reduced-motion transitions, long Resource Packs label, narrow widths, theme accents, and the separate Settings button.

### Account drawer action surfaces

- **Requested:** Let the red Log out treatment occupy the drawer's complete bottom area and remove the colored boxes behind its action icons.
- **Fix:** Log out now runs edge-to-edge beneath a full-width divider and follows the drawer's bottom radius. Profile, settings, logout, and trailing action icons use plain white marks without icon-box backgrounds.
- **Visual correction:** The initial full-width treatment was too tall and read as a solid maroon slab. The footer is now shorter and nearly black with a restrained red tint, hairline red separation, and a controlled hover increase while retaining the requested edge-to-edge shape.
- **Regression checks:** Drawer open/close motion, all three action hitboxes, hover and keyboard focus, expanded and collapsed sidebar states, and reduced-motion mode.

### Full-height profile artwork control

- **Requested:** Give the profile-picture control the same full-size cover treatment as instance artwork and replace its small corner badge with the shared switch-artwork interaction.
- **Fix:** The connected profile card now uses a flush 112-pixel cover on its left edge. Hover or keyboard focus subtly enlarges and dims the image while the centered white switch icon fades and scales into view; the former corner badge is removed.
- **Regression checks:** Custom and fallback artwork, picker opening, keyboard focus, disabled signed-out state, add-account mode, reduced motion, Ultra Performance Mode, and centered account selection.

### Persistent Modrinth download artwork

- **Reported:** Completed Modrinth installs discarded their project artwork and replaced it with the generic purple content icon.
- **Fix:** Catalog results now retain their original trusted Modrinth artwork URL separately from managed cached image data. That small source URL travels through queued native installs, progress events, completed-history persistence, and active/completed Downloads rows, so real artwork survives navigation and client relaunches without storing large base64 images in local storage.
- **Safety:** Only HTTPS artwork hosted by Modrinth is accepted by the native install command. Older completed records without artwork remain compatible and use the existing type fallback.
- **Regression checks:** Single and queued mod installs, cached and fresh catalog results, active-to-completed transition, navigation away and back, full client relaunch, Clear Completed, missing artwork, and resource-pack/shader fallbacks.

### Drawer install-state synchronization

- **Reported:** Installing from the open Mod details drawer completed successfully and refreshed the catalog row, but the pinned drawer action remained labeled Install.
- **Cause:** The drawer retained the catalog selection snapshot captured before installation while the installed-content list refreshed independently.
- **Fix:** A confirmed native `installed` event now updates the matching open drawer atomically to its non-interactive Installed state and current installed version, then refreshes the underlying list and clears its queued marker.
- **Regression checks:** Install from drawer and row, queued state, successful completion, failed/cancelled install, unrelated queued project completion, drawer closed during installation, and repeated click protection.

### Dependency-aware Modrinth installs

- **Requested:** Installing a mod should automatically install everything it actually requires without downloading a second copy of a shared dependency that is already active in the instance.
- **Fix:** The existing recursive Modrinth resolver remains authoritative for required dependencies and exact dependency versions. Before downloading its plan, the native client now hashes the instance's active JARs, identifies them through Modrinth in bounded batches, and reuses compatible dependency projects already present. The requested root mod is never mistaken for a reusable dependency, and duplicate projects in one install plan are ignored.
- **Correctness:** Optional dependencies remain opt-in. A dependency pinned to an exact Modrinth version is reused only when that exact version is installed; an unpinned dependency may reuse any installed Fabric build compatible with the instance's Minecraft version. Disabled JARs are not treated as installed. If identification is unavailable, Bloom safely follows the verified install plan rather than guessing from filenames.
- **Regression checks:** A mod with no dependencies, one required dependency, nested dependencies, two branches sharing Fabric API, an already-installed compatible dependency with a renamed JAR, a disabled dependency, an exact-version mismatch, the requested mod already installed, malformed/unrecognized local JARs, provider timeout, and duplicate projects returned in one plan.

### First-run Microsoft onboarding

- **Requested:** Replace the first-launch view of the complete signed-out client with one extremely simple Microsoft setup that reveals the device code, browser handoff, confirmed success, and launcher continuation in sequence. Keep a way to replay it for testing.
- **Fix:** A new full-window flow starts with only Bloom identity and Connect Microsoft. The real Microsoft device code becomes the primary copy surface; after a successful copy it compacts upward and reveals the official browser action beneath it while native polling continues. Only a saved Minecraft profile can produce the connected screen and Continue to launcher action. Advanced Settings includes Restart onboarding without signing out, deleting accounts, or resetting preferences.
- **Lifecycle:** Existing saved accounts are migrated past onboarding without a flash of the signed-out client. First-run account discovery uses a logo-only startup gate with a bounded fallback, the completion marker is local to this device, later explicit sign-outs return to the normal sidebar account dock, and failed/expired codes remain retryable.
- **Regression checks:** New install, existing-account upgrade, slow native account lookup, offline code request, clipboard failure, browser-open failure, authorization pending/slow-down/expiry, successful account save, Continue, relaunch, manual restart while signed in, close during replay, reduced motion, Ultra Performance Mode, title-bar dragging, and all three window controls.
- **Visual and clipboard correction:** Every onboarding state now uses a pure-black canvas with no accent halo. Welcome and authorization own their logo inside one centered content group; the Microsoft mark is larger. The connected state contains only its title, username, and launcher action. Copying uses a retrying native Windows clipboard command, then compacts the code into a quiet green confirmation surface without duplicate labels or checkmarks. The browser row is clipped by one shared outer radius so its darker fill reaches the complete bottom curve.
- **Welcome action correction:** The Connect Microsoft action is one solid-white surface. Its larger Microsoft mark and black label are centered together as one compact flex group, keeping the text close to the logo and the empty space balanced at both button edges.
- **Copy verification and positive state:** Bloom now retries the native Windows clipboard write and reads the value back before the UI may claim success, preventing a green false-positive when the clipboard is busy or replaced. The confirmed code uses a brighter saturated green, while the complete code-and-link stack owns one continuous thin outline so both lower curves stay visible against black.
- **Authorization border correction:** Removed competing borders from the code panel and browser button. One real border now belongs to the stationary outer stack, changes to the confirmed green as a unit, and uses a single internal divider, so opening Microsoft sign-in cannot carry a duplicate outline and every curved edge renders at the same thickness.
- **Authorization border ownership correction:** The copied layout deliberately keeps two stationary 2px outlines: saturated green around the complete upper code section and neutral gray around the lower Microsoft section. The action button itself remains borderless, preventing focus or browser launch from moving an outline, while the heavier real borders keep all four curved corners equally visible.
