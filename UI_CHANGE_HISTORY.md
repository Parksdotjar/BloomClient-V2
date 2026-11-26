## November 25, 2026 — Updates settings layout

Parks approved the revised Updates page on November 25, 2026, calling it “INFINITLY BETTER.” Use this page as the reference for grouping each settings action with its status and for left-aligned, actionable instance results.

Parks flagged the Updates page with separate version/status rows, a tight section break and generic centered result buttons. In **Settings → Updates**, put the installed launcher version beside its update action. Separate launcher and mod checks. Give check results the instance artwork, left-aligned name and runtime, a short status and a trailing arrow. Keep the result list with the action that produced it and route each result to its relevant Mods or release view. Local results needing attention sort first. Duplicate cleanup is separate from check results and retains its existing action. TypeScript, the production build, locked Cargo check and the mod-maintenance browser tests passed. The tests covered row alignment, direct Mods navigation, startup options and manual checks in OLED and compact Light.

## November 25, 2026 — Align the Shop wing preview navigation arrow

Parks flagged the inline chevron on Eclipse Angel Wings in Shop. In the Shop wing preview, center the **In Locker** label independently of the navigation glyph. Use the existing right-arrow icon at the trailing edge, vertically centered, with muted resting color and normal text color on hover or keyboard focus. The Wings renderer regression verified the label center, arrow inset and navigation into Locker. TypeScript, the production build, and locked Cargo check passed.

## November 25, 2026 — Align notification feed text

Parks approved the compact notification feed and bell-row action and asked to left-align the row text. Set the notification row's content column to fill its track, so every title and detail starts at the same edge beside its icon. Keep the short timestamp alongside the title.

## November 25, 2026 — Compact Notification Center history

Parks wanted less space above the list and clearer notification rows. The Mark all as read icon shares the existing bell row. The history uses compact timestamps, fine dividers, and an unread dot. Retain wrapping details and accessible names.

## November 25, 2026 — Keep Mod updates going when a dependency blocks one update

Parks reported repeated aggregate failures for mod dependency conflicts. **Update all** now keeps the installed versions when the staged Fabric metadata blocks a proposed update and applies compatible changes. The skipped reason stays on the affected mod row. The orange issue summary remains reserved for installed problems and failed checks or operations.

## November 25, 2026 — Now Playing prefers the matching Windows mixer

Parks reported that Zen showed PC volume despite having a mixer in Windows. Delight now resolves the registered desktop executable before choosing a fallback. With a matching mixer, the slider controls the app and keeps the same inline treatment. The labeled PC slider remains available when no app mixer can be matched.

## November 25, 2026 — Fabric API version compatibility

The Mods chooser now applies Fabric's prerelease-aware lower bound before matching the major or minor version. SMP can recognize Fabric API's `~26.3-` requirement on Minecraft 26.3. The chooser still checks installed dependencies before archiving other copies.

## November 25, 2026 — Direct mod updates

Parks replaced the combined picker and update review with one current-runtime action. **Update all** in the instance menu now starts compatible mod and dependency updates directly or queues while the game runs. The previous version and dependency review for routine updates were removed. The independent Minecraft version and recovery UI moved into Instance settings.

## November 25, 2026 — Quieter Mods warnings

Parks flagged an orange panel that listed every duplicate mod ID, an unsupported catalog label and an optional skipped update equally. A read-only SMP audit confirmed the extra JARs and showed Fabric had selected a version per group in its latest run. The popover now has one duplicate entry and focuses on installed problems or a failed check. Catalog and optional update notices use neutral row text.

## November 25, 2026 — Duplicate mod rows and notifications

Parks asked to prevent duplicate enabled JARs, bring affected players straight to the chooser, and choose the newest safe version automatically from Settings. Group known conflicts into one Mods row. Focus **Choose version** from **Attention needed**. Keep both backup and safety checks in the native apply path.

## November 25, 2026 — Version updates and a shorter publish review

Parks moved **Update all** into the instance three-dot menu and requested that it handle Minecraft upgrades for the existing pack. The in-page review uses the current version by default, names removals, and keeps the orange issue summary beside **Add mods** with the warning on its affected row. Pack Workspace opens a clean check directly to Publish and lists optional local omissions there. Added the Fabric metadata regression, reused checks and native recovery. The revised controls await hands-on visual approval.


## November 25, 2026 — Horizontal launcher update confirmation and progress

Parks rejected the downward update menu and required the full **Update available** label. The centered pill now expands sideways for **Update and restart** and an X. After confirmation it uses the launch-style track and the download percentage when reported. Download, install, restart and retry share the title-bar row. Parks approved the transition from **Update available** and inline confirmation into the launch-style progress bar on November 25, 2026.

## November 25, 2026 — Balanced compact launcher update face

Parks flagged **Update available** sitting to the right inside an oversized pill. The compact update face now measures its caption and arrow with balanced side padding. The review grows beneath the same centered trigger.

## November 25, 2026 — Cosmetic unlock celebration

Parks approved a separate Cosmetic unlocked face with artwork and an Equip shortcut to the claimed cloak. Added a short, falling and fading burst just under the pill after a fresh redemption. Reduced motion skips the particles. Equip selects the cloak and the existing Wear action applies it. The face expires or yields to active launch, installer progress and Admin notices.

## November 25, 2026 — Longer Admin notice preview and slower opening

Parks asked to see about 10–12 words before the ellipsis. Fixed the short-text clipping by deriving the width from the preview, icon and padding together. Display up to 12 words in the compact pill and keep the available title-bar width as a fallback. Opening uses a slower eased transition. The icon travels to the center while the full message glides down from the top.

## November 25, 2026 — Client-wide Admin notice

Parks requested an orange warning triangle, configurable lifetime and a compact preview that grows for reading. The active notice takes one island slot, preserves in-progress launch and updater controls, and clears at the shared expiration or when ended. Clicking shows the full plain-text message over the fixed workspace.

## November 25, 2026 — Suppress the tooltip over open notification history

Parks still saw Notifications after the heading was removed. The bell inherited its native hover tooltip into the open state. Hide that tooltip while history is open and restore it on the compact bell. The panel and bell retain their accessible names.

## November 25, 2026 — Remove the visible notification heading

Parks asked to remove the redundant Notifications text from the open island. The named region starts with Mark all as read when entries are unread. Otherwise, it starts with the history or empty state.

## November 25, 2026 — Keep the island face visible during transitions

Parks reported a blank bell and media content shifted out of the pill. The island surface now clips without scrolling, so focus and retained detail content cannot leave hidden scroll offsets on the compact face. Added coverage for the dismissed Notifications view and long media metadata.

## November 25, 2026 — Genuine Now Playing logos and readable notifications

Parks asked for authentic app icons, starting with Spotify’s full green disk and dark waves. He also reduced the idle bell to a short pill and asked the history to use the available text width. The Notification Center can grow wider on open while keeping the window chrome and workspace in place. Parks identified Spotify’s Windows mixer slider as the desired target and allowed a labeled PC output fallback when the app mixer is unavailable.

## November 25, 2026 — Now Playing row and horizontal app volume

Parks approved a persistent single media row with circular app icon, title, optional dimmed credit, three transport actions and Volume. Volume expands the pill horizontally while retaining its height and radius. Its slider reads the selected app’s Windows mixer and updates during drag. This supersedes the unfinished elapsed-time and cover design. Verified the horizontal reveal and live input through development and production renderer tests, and verified native mixer reads and writes in an isolated silent session.

## November 25, 2026 — Earlier Now Playing artwork and click expansion draft

Parks approved the horizontal launch X. He requested elapsed time in the compact media pill, with artwork, track, artist and transport on click, plus a smoothly adaptive width for short and long titles. Clicked island details widen slightly and open mainly downward over the stationary workspace.

## November 25, 2026 — Horizontal launch cancellation

Parks requested a horizontal launch cancel action inside the title bar. The progress pill itself receives hover and keyboard focus and keeps its flat fill. Its width grows around the window center while a right-side **Cancel launch** X fades in and turns red on hover. The title bar and workspace stay fixed. Renderer checks verified eased width, X opacity, mouse and keyboard behavior and the scoped cancellation command.

## November 25, 2026 — Dark pill for Top Bar Island

Parks requested a dark pill across the island’s activity states after providing two shape references. The pill uses more horizontal than vertical spacing and eases to half-radius corners as details open over the stationary workspace. He explicitly removed the visible perimeter and requested an Island color picker with the other Appearance panel colors. The default fill is darker than the default title bar and rail. TypeScript, the production build and locked Cargo check passed. The renderer checks verified the shape, stationary overlay and theme-specific color persistence.

## November 25, 2026 — Top Bar Island overlay correction

Parks rejected the title bar growing to hold detail panels because it moved the entire workspace. He requested a single outlined island that eases wider from the window center and downward over the existing page. Compact faces fit inside the normal bar. Notifications, update review, Now Playing and launch cancellation share the anchored overlay. An intermediate interpretation of a follow-up screenshot placed the outline below the bell and hid the trigger tooltip. Parks clarified that the full outline includes the bell area. The top edge stays visible in front of the trigger highlight during hover and press. The original tooltip behavior was restored. The title bar, rail, workspace margins and scroll position stay in place. Parks approved the corrected overlay and outline on November 25, 2026.

## November 25, 2026 — Centered Top Bar Island

Parks authorized the island and clarified that its full width should remain centered as it changes. Notifications, launcher updates, launch progress and opted-in Windows media share the same slot. Active launch keeps its compact track and percentage. A hover or keyboard-focus extension reveals **Cancel launch** over the work area. Explicit Notifications, update and media details expand into the header. The launcher remembers confirmed updates and suppresses Now Playing while they are pending.

## November 25, 2026 — Top-bar launcher update cycle

Parks approved the Notification Center and launch pill, then moved launcher update availability into the same slot. **Update available** extends left and replaces the bell with a download arrow at its fixed anchor. The shared panel shows versions, optional notes, explicit update consent, progress and retry. Notifications remain reachable inside the panel. The verified download and installer handoff use the existing signed updater.

## November 25, 2026 — Notification Center and title-bar launch progress

Implemented the flat top-bar bell, unread dot and activity panel with locally saved history. The bell expands to reveal native launch progress, with a fixed percentage beside the filling track. A confirmed game-ready event compacts the track to **Launched** and then restores the bell. Failure and cancellation restore the bell. Window controls stay in place and reduced motion uses immediate transitions.

## November 25, 2026 — Simpler Mods update state

Parks asked to remove the second progress line and standalone dependency button from ordinary Mods. **Update all** now applies eligible updates or verified dependency repairs, with **Updating…** on the same green button through the recheck. The in-page approval is used only when the proposed update needs to enable an explicitly disabled mod.

## November 25, 2026 — Mod maintenance and neutral action buttons

Parks approved implementing the mod maintenance plan with a green ceramic **Update all** and in-page dependency fixes. Added startup and manual checks under Settings → Updates, Mods toolbar and dependency review actions, and inline import and enable failures. Ordinary mod installs share native dependency validation and verified staging with maintenance.

During review, Parks pointed to the two check buttons in Settings and explicitly rejected black-gradient button faces everywhere in the client. The flat neutral button rule supersedes the earlier dark ceramic treatment. Colored ceramic actions retain their emphasis.

Parks requested cached mod rows, a scoped check under Instance Settings, and intentional inline error placement. The cache keeps rows visible during refresh and discards removed entries. Instance Settings runs the check for that instance and offers **View Mods** when needed. Compact in-page errors group a short message, retry and collapsed technical details.

## November 25, 2026 — Pack reviews in the workspace

Parks rejected the revised modal itself, including the black Cancel button and corner X. **Choose version** and **Review dependencies** now open as views within the existing Pack Workspace instance frame. They use normal file rows, the header’s **Back to contents** action, and ceramic confirmation buttons. Returning preserves the inventory tab and originating focus. A confirmed operation reruns the sharing check.

## November 25, 2026 — Current pack dialogs and dependency review

Parks rejected the legacy transfer styling on **Choose version**. Both that picker and **Review dependencies** now use the current folder-dialog shell, inset rows, and ceramic actions. The picker shows exact filenames and enabled outcomes. Dependency review identifies each proposed download or enable action and explains remaining requirements before confirmation.

In SMP, 35 of 37 dependency-warning rows pointed to installed Fabric API versions already flagged as a duplicate group. The check now treats a matching installed provider as present while its duplicate group remains blocking. The native dependency planner deduplicates required files, preserves exact pins, and stages verified files before writing.

Verified the two dialogs in OLED and Light and passed 15 native compatibility and installer checks. Left the rebuilt native preview open with its populated review copy.

## November 25, 2026 — Pack Workspace file warnings and local mods

Parks asked for yellow warning dots, a way to resolve duplicate mods from review, and an explicit choice to leave unmatched mods local. The SMP inspection found 12 real conflict groups by Fabric mod ID. **Choose version** lists the exact JARs and previews the enabled state changes. **Keep local** stages an unmatched mod’s omission, and **Apply choices** checks it again before release or draft review. No instance files were edited during the SMP investigation.

Verified the browser workflow in OLED and minimum-size Light, 10 native compatibility tests and 14 sharing service tests. The browser checks use isolated native-command fixtures. Visual approval is pending.

## November 25, 2026 — Sharing controls and pack recovery

Parks requested the invitation revocation fix, release recovery and a stop-sharing control before release. Older releases open a comparison with the latest version, the shared release-policy and note fields, and a ceramic **Restore as new release** header action. Followers can repair managed files in Releases and see backup locations when available. Access shows the player link state and the pause or resume control. Removed **Share instance** below **Open Pack Workspace** in the regular instance menu.

## November 25, 2026 — Draft avatar placement restored

Parks preferred the original leading avatar after identifying the large test initial as the profile picture slot. The draft list and review use the 34 px avatar beside the title and By line.

## November 25, 2026 — Draft author byline

Parks specified the draft author order as By, profile picture, name. Moved the 18 px image inline beneath the title in the draft list and review detail. Profiles use their verified account image, linked Minecraft avatar when available, or initial.

## November 24, 2026 — Private drafts and owner review

Editors save a reviewed snapshot from Changes and send it from Drafts. The owner opens the same comparison under Review, can return it with feedback and publishes the exact submitted snapshot. The existing ceramic header action carries Save draft, Send for review and Publish version. Parks approved the preceding Access revision.

Parks asked for draft states to use the existing Mods-style tab bar and flagged the large default note field. Editors get Drafts, In review, Changes requested and Published tabs. Owners get In review and Published. The note and feedback controls now use the shared compact publication styling.

Parks asked for clearer actor labels and a two-column review. The editor sees Send to owner, the owner sees Merge & publish, and the row shows the draft title with a By line and profile image when available. The comparison puts green additions on the left and red removals on the right.

## November 24, 2026 — Access controls matched to Pack Workspace

Parks pointed out that Create link belonged with the ceramic header actions and that the permission dropdown needed the launcher treatment. Create link now submits from the same header slot as Copy player link. Parks flagged an eye icon under the View arrow during review. The revised selector uses centered text and the standard chevron and popover.

## November 24, 2026 — Sharing Access

Added a sidebar destination for invitation management. Owners create View and Edit links, set expiration and use limits, revoke unused access paths and set publishing permissions beside each editor. The recipient sees the pack and invitation role before accepting. Hands-on layout review is pending.

## November 24, 2026 — Shared-pack revisions and sidebar groups

Parks requested a folding Sharing group with independently reachable pages and a single guide into the bottom child. Creator changes and follower updates have separate destinations. The creator chooses the release policy and the player reviews changes to the followed instance. Hands-on design review is pending.

## November 24, 2026 — Player-link preview corrections

Parks wanted direct access to resource packs in long releases, a legible download bar at the bottom right and less explanatory copy. The recipient now shares the inventory tabs and row styling. The active install reports its stage and progress across pages. The preview omits the separate-install explanation and shows the local name only when it differs. Parks will test in the open client.

## November 24, 2026 — Install a shared pack from a player link

Parks requested a recipient preview and a separate followed installation. **Open in Delight** on a player page and **Open player link** in the launcher’s File menu or New instance screen now lead to the same preview. The creator, release, runtime, pack download estimate, optional note and excluded folders sit above the published contents. Files reuse the installed-content row with Name and Status columns, a filled ceramic dot for enabled files and a hollow ring for disabled files. Headings and section labels carry no file totals.

**Install & follow** opens the new instance when installation finishes. Reopening the same link shows **Open instance**. **Following shared pack** on its workspace Overview identifies the creator and installed release and gives access to the player link. Parks’s visual review is pending. [Pack Workspace design references](design-references/current-client/library.md#pack-workspace)

## November 24, 2026 — Publish a first release from Pack Workspace

The first-release review now offers a release note, shows the publishing account and explains exactly which files and enabled states players can see. A first-time publisher can read and accept the Delight Terms of Service in this flow. A creator who switches accounts sees the new account’s consent state. If the reviewed files change, Recheck contents preserves the note and asks the creator to confirm any excluded folders again.

After publication, Overview shows the version, the creator’s note when present, and the saved player link. Keyboard focus moves to Copy player link. If clipboard access fails, the field selects the URL for manual copying. The version stays in the release details and the file rows retain the shared Name and Status layout. The OLED and minimum-size Light flows passed browser checks with isolated fixtures. Parks’s visual review is pending. [Full-window design references](design-references/current-client/library.md#pack-workspace)

## November 24, 2026 — Pack Workspace source check and first release

Create shared pack now checks file sources automatically. A problem appears under its file name and leaves the Status dot available for enabled state. The first-release preview shows the reviewed files and any folders the creator chose to omit. Its header action returns to contents and restores focus. Sidebar Back continues to return to the entry instance and tab. These screens are a local prototype awaiting Parks’s visual review.

## November 24, 2026 — Workspace inventory and independent features

Parks preferred the revised full-width instance layout and asked to keep future independent tools at home in this workspace. The frame now takes the selected instance, action and page body. Sharing owns its status lookup and inventory. The workspace and ordinary instance use the same installed-content row. Removed counts beside the category names and the “Review pack contents” heading. Populated inventories have small Name and Status labels, a green ceramic enabled dot and a hollow disabled ring. Both states have accessible names. The editable instance row keeps its existing controls. Parks requested a current-client screenshot catalog as the design reference.

## November 24, 2026 — Pack Workspace unshared Overview

Parks identified the initial Overview/review composition as old Bloom styling. His screenshot records the rejected implementation. The replacement uses the current Delight instance shell, the Create/Back action at the right of the identity header, and content tabs with an installed-file list. The previously approved sidebar switcher is outside this correction. Visual approval of the replacement is pending.

Parks approved the revised instance dropdown and requested the first-run Overview and Create shared pack action. The local-instance surface uses its artwork, name, game and loader versions, a sentence explaining sharing, and one accent action. Create shared pack opens a review of local contents. This Overview awaits visual approval.

## November 24, 2026 — Pack Workspace navigation prototype

After reviewing the prototype, Parks rejected the instance switcher’s checkmark and requested a sidebar-width menu over the tabs. He then revised the width so the popup comes close to the sidebar edges with a small inset. Each edge now sits halfway between the trigger edge and the corresponding sidebar edge, including after resize. Selection retains its row highlight and accessible pressed state.

Parks approved the navigation plan and requested a working first slice in a separate P: worktree. More opens an instance-specific workspace, the wide sidebar switches between real library entries, and Back returns to the original instance tab. The main instance page keeps its usual controls. Visual review is pending.

## November 7, 2026 — Optional sound and mechanical toggle feedback

## November 22, 2026 — Launcher wallpaper and frost

Parks requested frost on prominent Add and Filter controls and a compact replacement for the full-size black empty-list panel. Instance lists now show a short message with contextual text actions. Only the compact message area receives a tint when wallpaper is active.

Parks approved the overall frosted look and flagged a darker patch beneath the wing and an exposed corner. The title strip and slim rail now share a single frost layer that follows the workspace curve. Hovering the wing keeps its surface steady.

Parks requested a dedicated Background tab alongside Appearance. It uses the same hex picker, selectors, sliders and help controls. A local image can span the rail, navigation panel and workspace. Tint and blur can be adjusted independently for sidebars and controls. Switching to solid color retains the image, and removing the wallpaper leaves right-sidebar artwork intact.

## November 22, 2026 — Rectangular source images in icon slots

The SMP instance on Home showed a wide strip inside its square button. Parks requested rounded-square artwork wherever the launcher displays these icons. Home and Portal now center-crop the image to fill the slot. Instance picker rows reserve the icon’s full width even with long names.


## Delight branding — November 17, 2026

Parks requested the Delight name and supplied wing logo for the client and every Bloom-named companion project. Use Delight Client, Delight Cosmetics, Delight Benchmark, Delight Admin, Delight Animation Creator, Delight Books and Delight Servers in visible copy and native product metadata. Preserve existing layouts and theme behavior. This approves the name and source artwork, not a redesigned interface.

Keep account/keyring names, storage paths, mod IDs, Java namespaces, emote format identifiers, live URLs, updater endpoint and signing configuration compatible. See [BRANDING.md](BRANDING.md) for installer and asset details.


- Parks selected gentle thumb compression and optional interaction audio. The initial request emphasized deeper thocks and a tiny echo, with master/advanced settings and independent effect switches.
- **Correction during implementation:** A thock for every action was too uniform. Buttons should feel like an osu! click/hit; toggles should sweep with their movement into a higher on or lower off landing sound; scrolling must tick faster or slower with actual movement. These newer requirements supersede the uniform-thock interpretation. The osu! reference describes a feel, not an approved exact asset or new visual style.
- Settings > General now contains Interface sounds, volume and connected Advanced sounds: Buttons, Toggles, Scrolling and Confirmations each have a switch and preview, plus depth and a tiny echo. Master and scrolling default off. Previews are explicitly available while switches are off; zero volume and Ultra Performance remain silent.
- Toggle sound is tied to a deliberately requested state change, while native-operation confirmations only follow success. Visual compression respects motion settings independently of audio. No new runtime package, website/backend change or release is involved. See `INTERACTION_FEEDBACK.md` for implementation and test boundaries.
- Verification passed: 25 focused audio/cadence tests and the real-browser interaction suite (native calls stubbed), including fast/slow scrolling, failed/pending saves, sound previews/mutes, persistence, themes and motion modes. Fixed passive-wheel position timing, OLED slider-thumb token fallback and reduced-motion selector specificity found during these checks. Exact sound quality remains for listening review.

## November 2026 — Wings in Locker

Parks requested that wing cards match the existing Locker cards, with wing and sigil artwork, quick highlight fades, and the signed-in player's skin in the right preview. The new Wings category reuses the equipped highlight and the shared color picker. Color edits update the preview live and save to the account through Equip or Save colors. The updated treatment is ready for review.

## October 2026 — Free Shop and owned Locker

- Parks requested one main Shop / Locker switch, a large featured cape above a scrolling free catalog, and collecting capes before equipping them from Locker. The suggested inner category sidebar was optional; implementation uses compact Cloaks / Capes / Skins controls inside the collection heading to avoid two main top bars. Existing sidebar and flat action buttons remain unchanged.
- This supersedes the earlier “Shop stays removed” rule and the darker full-width category shelf. No prices, purchases or cart were requested. The layout has not yet received visual approval.
- Add to Locker performs an authenticated, idempotent server claim. It leaves the user in Shop and does not equip automatically. In Locker opens that collected cape for preview/equip. Official Minecraft capes, imported skins and one-use code redemption retain their own real workflows.
- Admin adds Show in Shop and Feature in Shop. Ending a drop keeps existing owners’ capes; Archive disables a cape for everyone until restored. Existing equipped public capes migrate to ownership once. Code-only claims remain private and are never automatically granted.
- Regression coverage exercises real isolated HTTP storage through both UIs: publish, feature, claim, duplicate/pending behavior, explicit equip, end drop, account isolation, search, categories, themes and compact layout. Existing Locker hover/loading/pagination checks remain. Backend/Admin deployment does not publish a client release.


## October 21, 2026 — cape redemption spacing correction

- Parks requested removing “A little something for your locker” and moving the input up to sit centrally between the Locker title platform and the darker category shelf.
- Removed the introductory line, kept the accessible input name, and gave the field equal visible top/bottom spacing. The category shelf no longer overlaps the redeem area's bottom padding. Sign-in guidance stays in the disabled input placeholder.
- This correction is specific to the redemption drawer; normal buttons and sidebar styles are unchanged.

This is a historical record of requests, implementations, corrections and rejections. Entries are not strictly date-sorted. Earlier wording such as “now” or “current” describes the decision at that time; it does not override a later correction. [DESIGN_RULES.md](DESIGN_RULES.md) contains the reconciled current requirements, and [GOOD_DESIGNS.md](GOOD_DESIGNS.md) identifies explicitly approved references and implementations.

## October 21, 2026 — Bloom Admin cape workspace

- **Requested, not visually approved yet:** separate cape face and diagonal elytra artwork frames, up to 4K output, direct mouse pan/zoom and corner resizing without framing sliders, parameter adjustments, publishing, current catalog removal and live client updates.
- Added the workspace to the separate `BloomAdmin` app using its existing theme, flat actions and owner session. Brightness/contrast/saturation sliders affect artwork; a single focused 3D preview switches between cape and wings. Added undo/redo, local draft recovery, PNG export and reversible archive/restore.
- Existing published static artwork opens in the same frames and is preserved exactly for a metadata-only republish. Animated capes can be archived/restored, but are guarded against replacement by this static editor.
- The backend adapter writes existing revisioned cosmetics storage. Equipped game clients already poll for revision/removal changes. Automatic launcher catalog polling and focus refresh were added to source; distribution still requires a separately authorized client release.
- Checked 4K editor publish/reopen, authenticated access, origin rejection, stale/conflicting edits, archive/restore and recovery against an isolated real API. Detailed 4K PNG validation also exposed and fixed a regexp stack overflow. Live deployment retained all three existing cape revisions.

## October 20, 2026 — Locker loading and refresh fixes

- Parks reported Equip/Unequip flashing over cloak names while opening the page, and requested a check of Cloaks, Capes and Skins. A shared disabled-button opacity rule overrode the hidden card-action state; disabled actions now stay hidden until hover/focus, including during saves. Reduced motion also disables the reveal transitions.
- Cached cloaks start with a valid preview. Refresh preserves selections, equipped markers and edited skin arm models; imports use their saved model, missing current skins fall back to a local skin, and shrinking catalogs clamp pagination. Refresh feedback follows the real request and overlapping refresh/equip actions are disabled.
- Card density responds to the catalog column's width. The side preview keeps its own height alongside long desktop grids; compact stacked layouts scroll normally.
- Regression evidence: `tests/locker-ui.mjs` first reproduced all three hidden actions at 45% opacity during a delayed account response, then verified the fix, native-call sequencing, selection/model preservation, pagination, both themes, keyboard reveals and motion preferences using fixtures.
- Parks separately approved the final screenshot Compare/Cancel interaction as looking great; it is now an explicit reference in GOOD_DESIGNS.md. The Locker fixes are implementation work, not a blanket visual approval.

## October 20, 2026 — connected main toolbars and continuous-shelf correction

- Parks requested the approved Mods toolbar's connected feel for other suitable main toolbars, preserving normal button styling and the sidebar.
- All Instances reveals working loader choices inside its existing shelf; the card grid yields height while bottom search stays anchored. Screenshot comparison retains selections across instance filters and preserves the existing comparison action. Refresh feedback follows the actual request while cached images stay visible.
- Locker's existing category track gets a moving neutral selection with immediate keyboard/content updates. Modpacks keeps one Close/Back button as its icon and header context change; returning retains focus and the native import path remains unchanged.
- **First user correction:** The first attempt appended a lighter drawer below the dark control shelf. Parks rejected the light–dark–light stack. The existing shelf now expands downward as one continuous surface, with a smaller gap below the controls. Apply this correction to both Screenshot Shelf and All Instances; never reproduce the rejected extra tray.
- **Second user correction:** Parks rejected the oversized empty A/B slots, tiny letter captions and plain Cancel button. Screenshot selection now uses a compact centered prompt, small removable thumbnails only for actual selections, and a prominent rounded red X. Motion emerges vertically at each element's own position; multiple elements are staggered left to right. The whole group must not travel from the left, and a single centered group remains centered throughout its reveal.
- **Third user correction:** Parks liked the rounded X shape but requested a white X centered in a solid red button, replacing the bare red icon. He also rejected the plain muted selection sentence. The implementation now pairs an unboxed Lucide image symbol with a stronger two-line prompt and accent emphasis on the remaining selection; it changes from “Select two” to “Select one more” after a real selection. The row retains its compact height and in-place motion. This prompt treatment is an implementation of the request, not a newly approved reference.
- **Fourth user correction — current:** Parks removed the entire lower selection area. The existing Compare button starts at `Compare (0/2)` after activation and updates directly as gallery images are selected or deselected. At zero or one selection it changes to Cancel on hover (also keyboard focus); activating it clears selection. At two it stays Compare and opens the existing viewer. Keep the button mounted, preserve its width and transition the label/icon in place. No prompt, thumbnail tray or separate cancel button remains. Escape and cross-instance selection still work. This supersedes the screenshot-specific tray treatments above, while the continuous-shelf rule still applies to drawers that have useful controls.
- Shared toolbar primitives preserve the original Mods behavior. Closed drawers are inert; Escape, outside dismissal for transient filters, comparison cancellation and return focus work with all motion preferences. A StrictMode focus-restoration issue in screenshot comparison was corrected by remembering its original trigger across effect replay.
- These adaptations are not a blanket visual approval. The original content toolbar and the final single-button screenshot Compare/Cancel interaction are explicitly approved; the earlier screenshot trays remain superseded.

## October 20, 2026 — design memory reconciled

- Parks explicitly approved the interactive content toolbar as “actually perfect” and “beautiful,” and asked for durable documentation that prevents repeating rejected ideas or misreading preferences.
- Recorded the toolbar's composition, purposeful motion, contextual counts, reuse limits and regression checks in GOOD_DESIGNS.md with a local visual reference. Kept the established flat buttons and navigation highlights distinct from workspace depth.
- Reconciled active rules for hidden scrollbars, the full-width content filter drawer, bare bottom-search icons, the direct New Instance form, current library/navigation layouts and content empty/import icons. External references now defer to Bloom's current themes and selected accent.
- Historical attempts remain below as evidence. In particular, the small content-filter popup, three-card New Instance chooser and entire raised-button experiment are superseded; do not restore them from an old entry. AGENTS.md now requires reconciliation when future feedback changes a design decision.

### Current outcomes for commonly confused decisions

| Topic | Current outcome | Historical treatment superseded |
| --- | --- | --- |
| Content toolbar | Approved connected header, contextual readout, attached filter drawer and Add/Back transition | Boxed mod-count badge and compact 276px popup |
| Action buttons | Original flat component styling | Raised lip, surrounding darker rim and thick bottom edge, including every contrast variant |
| Navigation selection | Neutral raised highlight; separate from action-button styling | Old diagonal-gradient selection treatment |
| New Instance | Direct form; Memory Allocation and Java visible; folder options under Advanced | Three-card entry chooser and hiding all launch settings under Advanced |
| Scrollbars | Chrome hidden globally; scrolling remains functional | Earlier visible thin tracks/thumbs |
| Instance content search | Anchored bottom dock with bare icon and approved focus motion | Boxed search icon or moving filters into the dock |
| Content icons | PackageOpen for empty content; FileDown for import | Broken flower and Inbox empty-state experiments |

## October 20, 2026 — drag content between instances

- Added a translucent, eased copy ghost for installed mods/resource packs/shaders, neutral sidebar drop targets, and temporary access to every instance while dragging.
- Dropping or using the existing action menu opens a focused compatibility review before any copy. Known version/loader conflicts block; unverified files require acknowledgement.
- Native copies preserve source bytes and disabled state, prevent replacement and duplicate mod IDs, protect managed Bloom mods, and invalidate destination content caches after success.
- Escape and cancelled drags consume the release click rather than opening details. Light/OLED, reduced motion and keyboard/menu paths share the same workflow.

## October 19, 2026 — local server manager removed

- Removed Servers navigation, workspace, quick-switcher entries, Downloads integration and background polling at Parks's request.
- Removed native hosting commands, server-specific launch/update/exit hooks, dependencies, tests and planning documents. Existing server folders in application data are untouched.
- The global hidden-scrollbar rule and unrelated UI improvements remain. Earlier Servers entries below are historical and superseded by this removal.

## October 19, 2026 — invisible scrollbars and Social-style Servers layout

- Hide vertical and horizontal native scrollbar chrome across every screen and body-portaled dropdown, retaining each container's scroll behavior. This supersedes earlier visible/thin scrollbar treatments.
- Servers now uses Social's outlined rail with rounded top-right and bottom-right corners. Its lighter center fills the remaining column with a flush header and scrolling content; removed the inset outer card and its responsive margins.

## October 19, 2026 — local server workspace

- Added Servers beside Social, with its own compact rail and lighter content panel rounded at both top corners. Overview, Console, Plugins, Players, World, Backups and Settings use native commands.
- Shared neutral dropdowns/toggles cover OLED and Light. Setup has an unchecked EULA gate; server selection, local join and quick-switcher navigation target specific records.
- Draft settings survive section/page navigation; repeated saves refresh their revision. Console is virtualized. Pending plugin changes, busy operations and force stop are explicit.
- Native and browser simulations were used; real Minecraft was not started. The implementation and its accompanying documents were subsequently removed at Parks's request. No release or version change.


## October 2026 — full-turn Body animation

- Creator’s existing Body rotation fields accept ±720 degrees; other bones retain ±180 and positions retain ±12 pixels. No new controls or layout changes.
- The Body gizmo keeps the Euler turn nearest the authored rotation rather than reducing a 360-degree key to zero. Layers, import, native Send and the Bloom validator retain full turns. Existing projects and revisions remain unchanged.

## October 2026 — traversal playback

- Added Traversal to Creator’s existing Playback mode dropdown, sharing the same sizing, themes and menu. It stores a looping traversal mode through project save/open, native Send, catalog build and multiplayer revision lookup. Choosing any ordinary mode disables traversal.
- Traversal keeps playing through movement, jumping and idle. B stops it directly, consuming that physical press; the next hold opens the existing wheel. Screen text input remains unaffected. Ordinary emote cancellation is unchanged.
- New animation drafts are JSON-only review artifacts. Parks adds them himself; never silently install an assistant-created animation.


## October 2026 — Creator emote library removal

- Added File → Manage emotes and an entry from the Send/Open dialogs. The existing modal, theme tokens, restrained list rows and Lucide trash action expose the actual exported library, with one inline removal confirmation.
- Removal archives the complete source directory and refreshes the catalog after success. Build mod uses the existing Stonecutter build; a later Send/build also excludes removed entries. Empty libraries remain supported, and the UI distinguishes a saved removal from a completed build requiring a Minecraft restart.

## October 2026 — hold-to-select in-game emote wheel

- Hold B to open; point and release to play/close. The wheel uses opaque OLED black with restrained pink selection and readable text. Drawing remains circular; angular hit regions continue beyond its edge, including screen corners. Visual seams do not become unselectable hit gaps. Escape/focus loss cancel; center stops active playback; empty slots close without playing.
- Retired the nine demo emotes. Empty libraries work throughout import, Creator export and packaging. Creator Name suggests the animation ID until manually edited. Tauri dev prebuild reports included emotes and confirms all four updated cosmetic-mod bundles. Existing Minecraft processes restart to load changed bundled content.

## October 2026 — separate Bloom Animation Creator

- Animation authoring lives in the sibling `BloomAnimationCreator` app, with the current OLED Black/Light palette, Bloom logo, Lucide controls, pill switches, custom attached dropdowns, restrained raised headers, and bottom notifications.
- The editing workspace uses a left bone hierarchy, central 3D player/gizmos, right transform inspector, and resizable bottom timeline with independent position and rotation tracks. Selecting a bone reveals its track; dropdowns remain visible near panel and window edges.
- Creator refinements: rounded title-bar hover states, Edit → Preview skin (PNG or public Minecraft username/UUID), ruler-only scrubbing with marquee key selection, and a square easing graph with saved presets and explicit Apply. Bones/Graph share one panel size; switching tabs never expands it. Both side panels and Timeline resize with bounded, persistent dimensions. Curves bake into the existing numeric animation format and keep editable handles in the project. Backspace/Delete remove selected keys with undo; native browser context menus, devtools and browser shortcuts are disabled while editor shortcuts and text editing remain available.
- Timeline body parts are collapsible groups. A compact + menu adds independent additive Rotation/Position layers; each keeps its own keys and easing. The selected-layer inspector owns naming and enable/remove controls, with a per-row eye toggle. Numeric fields edit the selected contribution; the viewport and exports combine enabled layers. Schema-2 projects retain the layers and migrate older projects. Hidden groups are excluded from marquee selection. Bones/Graph sizing remains shared and the graph remains square.
- File → Send to Bloom opens a focused native export/build dialog. It reuses this checkout's validator and Stonecutter build, preserves replacement backups, and never publishes releases. See the sibling app's README and IMPLEMENTATION.md for behavior and acceptance evidence.

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

## Interaction decisions recorded at the time

These notes preserve earlier decisions. Apply the current rules in DESIGN_RULES.md, including its explicitly scoped motion exceptions; do not read the original blanket hover/focus prohibition as a rejection of the later approved search, reveal or toolbar interactions.

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

### October 19, 2026 — clearer main sidebar selection

- Replaced the old active gradient/flat background override with a neutral rounded raised surface, brighter text/icons, and quieter inactive rows. OLED uses a lifted dark surface; Light uses white with restrained slate depth.
- Custom Image/Organic styling previously assigned identical fills and ink to selected and inactive navigation. The scoped navigation stylesheet preserves selection with custom opacity and text colors, without changing other sidebar controls.
- Icons inherit their row's ink; hover/focus preserve geometry and keyboard focus remains visible. Collapsed navigation keeps the same selected treatment. Reduced Motion, disabled animations, and Ultra Performance disable the transition.
- Route selection and `aria-current` share the same destination mapping. Instance detail/creation retain Instances; AutoTune retains Utilities.
- Regression coverage: both themes, plain/custom backgrounds, collapsed/expanded navigation, mouse and keyboard navigation, minimum window size, and motion settings.

### Primary sidebar navigation typography

- Home, Instances, AutoTune, and Settings use the same bold 800-weight label treatment as sidebar instance names and profile account names.
- Active and inactive navigation labels keep the same weight, preventing selection from changing text width or causing layout movement. Existing icon alignment, spacing, and active colors remain unchanged.
- Active-page experiment replaces the flat selected surface and inset outline with one restrained accent-to-neutral gradient. It uses no dots, bars, streaks, glow, or extra ornament, and follows the selected route rather than special-casing Utilities.
- OLED selector correction: the first experiment only changed the retired Dark-theme override, so the selectable OLED theme still showed its old flat surface. The gradient now lives on the real base active-navigation rule with a deliberately stronger accent mix that remains visible against the near-black sidebar.
- Gradient direction follow-up reverses that active surface: it now begins neutral beside the icon and label, then develops the accent toward the row's right edge.
- Gray diagonal experiment removed the accent from the selected surface itself. Superseded by the October 19 neutral raised selection above, including neutral theme-aware icon and label colors.

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

### Custom background controls and frost

- Upload is always available and enables the background after saving. Browser-decodable images are normalized to WebP and resized to a maximum 4096-pixel edge, preserving native local storage.
- Interface and element darkness now span 0–100%; neutral glass mixes with transparency. Sidebar and element frost independently span 0–40px, with a reset action and Ultra Performance override.

### Background editor refinement
- Replaced verbose rows and checkbox with a preview picker, labeled Enabled/Disabled action, compact sliders, and Interface/Sidebar disclosure groups.
- Sidebar surfaces and navigation controls now have independent persisted darkness/frost values. Reset uses shared defaults.
- Removed blanket button backdrop blur that obscured sidebar instance artwork under the play overlay.

### Sidebar appearance and settings layout
- Restored the dark Settings header and rounded navigation panel with symmetric insets.
- Added persisted outline strength and text/icon color for navigation. Fill, frost and outline are independently adjustable, including transparent zero endpoints.
- Verified native Bloom screenshots: sharp instance artwork, transparent buttons over maximum panel frost, and dark full-strength outlines with transparent centers.

### Background controls: shared treatments
- Account dock and dropdown now retain the same opaque dark surface, independently of sidebar customization. Removed navigation underlines.
- Sidebar text color reuses the circular custom HSV/hex picker with Apply and Cancel.
- Existing background artwork now dims on hover/focus and reveals the same scaling swap icon as instance artwork. Empty state is a labeled upload target; save continues through native local storage.
- Consolidated superseded shared-darkness and charcoal-floor rules in DESIGN_RULES.md. Current groups use independent fills/frost, truly transparent zero values, and stable opaque overlapping account surfaces.

### Sponsored rail removed
- Removed the entire sponsored rail and placeholder ads. Main content now fills the workspace beside navigation; settings content stays centered in its column.
- Removed rail-only responsive, theme, glass, scrollbar, and update-overlay offsets. Recommendations now describes client updates only.

### Sponsored rail restored
- Reversed the sponsored-rail removal at Parks’s request. Restored the recommendations-controlled rail, responsive widths, main-content sizing, and update-overlay offsets. Background and sidebar appearance refinements remain in place.

### Sponsored title drag area
- Added a dedicated drag handle above the sponsored rail; previously this empty strip fell outside the main title drag target. It supports native dragging and double-click maximize, follows the 330px/220px rail widths, and excludes window controls.

### Continuous title drag and tab highlight correction
- Replaced disconnected drag targets with one continuous 32px strip, reserving real space above main content so page actions remain clickable.
- Removed per-button glass from instance content tabs. The shared track owns fill/frost; the moving indicator keeps its rounded silhouette across tab boundaries.

### Invisible title drag strip
- Extended the content surface tint into the reserved 32px title strip. It now uses the exact same theme fill or custom-background darkness as the content below, without a border, blur, or separate drag-box fill. The continuous drag target remains unchanged.

### Instance search readability
- Removed the search icon tile and its focus fill; enlarged the bare icon to 27px. Search text is now 17px with stronger weights, and the field uses a lighter charcoal fill while preserving custom-background opacity.

### Play brightness and search contrast
- Removed instance and Spotlight Play from the translucent accent glass override. Both now use the solid accent and dark text used by Add Mods.
- Darkened the default search surface to #121719; preserved the existing #202629 custom-background fill and user opacity.

### Search focus motion
- Extended focus motion from 640ms to 1440ms and removed simultaneous width, radius, and shadow animation that forced layout/paint during the movement. Retained a gentle compositor transform and coordinated icon/color easing.
- Entrance animation no longer retains transform ownership after finishing. Removed competing icon/placeholder transforms and lowered input text by 1px. Reduced-motion and Ultra Performance overrides remain active.

- Search focus scale increased from 1.012 to 1.035 at Parks’s request for a more noticeable expansion; timing remains 1440ms.

- Search focus timing adjusted to 1040ms; the 1.035 focus scale remains unchanged.

### Library action brightness and settings panel
- Removed New Instance and library Play from the dimmed accent glass rule, matching Add Mods and the other Play actions.
- Added independent Settings panel fill at 96% by default, with a persisted slider and reset support. Existing sidebar preferences remain intact.

- Settings title bar now uses opaque #050607, matching the sidebar control black instead of the lighter #090c0e tint.

### Content empty-state icon
- Replaced the large broken Bloom logo with a small, muted Lucide Inbox outline in instance-content empty states. Existing explanatory text and browse/folder actions remain.

- Replaced the empty-content Inbox with PackageOpen. Drag-and-drop now uses FileDown (a document with a downward arrow), distinguishing file import from the empty-library state.

### Live organic backgrounds
- Added Aurora, Tide, Bloom, Dunes, and Mist under Background, with accent-aware preview tiles, selected indicators, and saved source/style. Selecting a style enables the background; switching back preserves uploaded artwork.
- Procedural CSS artwork uses slow transform motion, existing background opacity and surface controls, and static rendering for reduced motion or performance settings. No downloads or remote assets are required.

### Twelve live styles and segmented source switch
- Added Petals, Ripple, Silk, Lagoon, Ribbons, Halo, and Contour, all accent-aware and using the existing motion/performance handling.
- Centered Image/Live backgrounds in the shared instance-style segmented track with a sliding selection overlay and reduced-motion support.

### Maximized right-edge strip
- Removed the outer main pane’s 1500px cap so the sponsored rail reaches the window edge at wide resolutions without exposing the live/image background beside it.
- Made the rail scrollbar track transparent so it blends with its containing dark surface. Scrolling and the thumb remain available.

- Renamed the Background source tab from Live backgrounds to Organic.

### Screenshot Shelf
- Added Screenshots to the main and collapsed sidebar. All-instance gallery sorts newest first, filters by instance, and loads 24 cards at a time.
- Added native bounded screenshot enumeration, resized previews, full-image clipboard copy, and Open Folder. PNG/JPEG/WebP supported; decoding is serialized and limited to 32 MB/32 megapixels. Unreadable previews and folder errors surface visibly.
- Enabled arboard image-data support and updated its required lockfile dependencies.

### Screenshot Shelf header and feedback
- Centered and enlarged the title, removed the subtitle, and moved instance filtering, count, and refresh into the header. The gallery now follows directly below with an 18px gap.
- Clipboard and folder actions reuse the green rising bottom notification; failures use its red variant. Removed inline action messages.

### Toggle visibility and content notifications
- Removed the Screenshot Shelf count from its header.
- Excluded the shared toggle from background glass styling so every settings and content toggle keeps its distinct on/off track and thumb position for Image and Organic backgrounds.
- Routed instance content import, deletion, settings-save feedback, and errors to the shared bottom tray; removed both inline message slots. Successive tool notifications reset their dismissal timer.

- Screenshot Shelf now matches Locker’s layered header: a lighter rounded title platform over an attached darker control section containing the centered instance filter and reload button.

### Simplified Locker loading state
- Replaced the boxed accent feather with a bare white Shirt outline and the single label “Loading locker…”. Removed the secondary loading sentence; existing motion preferences still apply.

### First-open mod catalog visibility
- Prevented progressive scrolling from reducing the initial visible batch to zero while catalog results load. The first result batch now remains visible without leaving and reopening Add Mods; later scrolling still reveals more rows.

### First-use sync guidance
- Renamed the utility to Sync Across Instances, clarified Game Settings / Saved Servers, and exposed Copy from / Copy to directions. The Off choice explicitly disables copying.
- Added custom info buttons for each sync category, the overall workflow, and Save versus Sync. Tooltips use an opaque portal above clipped panels, open on hover/focus/click, stay within the viewport, and dismiss with Escape or an outside click. No persistent explanatory subtext was added.

### Global primary-action brightness
- Removed the shared accent-glass override affecting AutoTune, catalog installs, account actions, updates, and benchmark controls, restoring their normal fills for Image and Organic backgrounds.
- Made AutoTune primary actions and the Modrinth version-import button solid accent with dark text. Checked fill controls are also excluded from neutral glass styling. Disabled and pending states retain their visual feedback.

### Instance settings cleanup
- Combined name, memory, and Java profile into one aligned settings panel. Replaced the native memory track with the shared styled slider, preserving 512 MB steps.
- Moved JVM arguments and a clearly labeled reset into an Advanced Java options disclosure; Custom opens it. Replaced profile description boxes with custom info tips. Group membership is a compact badge only for shared instances.
- Save stays a solid accent action, prevents duplicate submissions, and reports through the existing bottom tray.

### Development update isolation
- Development frontend checks and real installs are disabled; debug Rust binaries do not register the native updater. Release builds continue using signed GitHub updates, and the dev-only mock preview remains available.


### Internal content records and instance download artwork
- Hide dotfiles and interrupted `.bloom-part` writes before installed-content cache lookup, so `.bloom-cosmetics.json` never appears as a Fabric mod or exposes content actions.
- Modrinth modpack imports retain the project's cached artwork in the instance before installation starts. Downloads uses that artwork for active instance tasks and saves it in completed history. New import progress refreshes the instance identity; instances without artwork use the shared question-mark placeholder.
- Download artwork resets when its source changes and renders local image data directly.

### Bloom Cosmetics mod identity
- The actual Bloom Cosmetics mod uses the existing `public/bloom-logo.png` Bloom logo, centered at approximately 72% of a pink (#ed83b5) square. Preserve the original logo artwork; do not redraw or simplify it. Fabric metadata points to the PNG so the installed list reads real artwork from every versioned JAR rather than showing its generic package icon.

### Connected account dropdown centering
- Removed asymmetric right padding from the connected account card's symmetric three-column grid. The add-account button keeps its 18px inset through its own margin, so the dropdown centers against the full card while the avatar stays flush left.


### Custom animated accents
- Added an opt-in Animated Accent under Appearance, with two to five draggable color stops, keyboard and numeric positioning, add/remove, cycle duration (4–60 seconds), and saturation intensity (0–100%). Stop spacing controls the fade timing and crossing stops changes their order.
- Reused the custom color picker as a shared component; colors retain draft/Cancel/Apply semantics and typed hex values now apply exactly rather than being rounded through HSV conversion.
- One throttled animation worker updates the existing accent token throughout the client, with a smooth forward/back cycle. Reduced motion, animations off, Ultra Performance, and hidden windows suspend it. Solid selections exit animation without discarding custom stops; existing settings migrate to solid mode and malformed gradients recover to safe defaults.
- Verified interpolation, shifted/coincident stops, bounds, malformed persisted data, five-color limit, pointer dragging, keyboard movement, and picker application in an isolated component preview. Full native-app appearance remains a separate hands-on check.


### Gradient swatch and direct stop editing
- Animated Accent is now its own gradient circle beside the existing accent colors, using the same size and selection ring. Solid swatches exit gradient mode; the separate toggle is removed.
- Gradient handles are equal-width/height squares. A click opens the existing color picker directly from that square; dragging adjusts the fade without opening it. Removed the extra selected-color circle, retaining numeric positioning, hex display, and removal.
- Verified mode selection, direct picker opening, and pointer dragging without an accidental picker in the isolated editor preview.


### Screenshot comparison
- Added Compare screenshots to Screenshot Shelf. Comparison mode selects exactly two cards, marks their A/B order, and retains selection across instance filters. Normal thumbnail clicks still open the original preview outside comparison mode.
- Added a native modal with a draggable wipe divider, arrow-key/Shift/Home/End positioning, Swap, centered Reset, Escape/backdrop/close, and focus restoration. Both images use the existing bounded native preview command and retain their proportions on one shared canvas.
- Loading/missing-image errors offer Retry. Source screenshots remain unchanged. Verified image loading, dragging, keyboard adjustment, swap/reset, Escape/focus return, and failure feedback in an isolated component preview using repository reference images.


### Persistent, prewarmed screenshots
- Screenshot thumbnails/previews now persist in the existing managed cache. File revision keys include path, size, and high-resolution mtime; native path validation and decoder limits remain in place.
- Discovery and two-worker background warming begin at startup and continue every 30 seconds while visible. Visible shots, hover/focus, and clicks take priority; identical requests share work. Unchanged collections are not repeatedly warmed.
- Shared decoded image memory survives navigation within a 160 MiB estimate. Gallery, image preview, and comparison initialize from warm entries, avoiding forced loading flashes. Open shelves receive new/changed/deleted file revisions from background discovery.
- First discovery and images evicted from hot memory can still load. Persistent entries obey the existing configurable disk capacity and Clear cache; source screenshots are untouched.
- Six cache tests cover reuse, synchronous warm access, revision/instance/mode isolation, queue priority, concurrency, bounded retention, clearing in-flight work, and retry after failure.


### Faster launch preparation and game resource priority
- Added verified-installation, native-extraction, and Java-selection receipts; metadata changes or expiry use the original preparation path, and Repair always verifies/extracts through that path. Directory membership is checked explicitly because Windows directory timestamps alone did not reliably identify additions in testing.
- Login validation/refresh and scoped cosmetics-session preparation run alongside file preparation. Secure expiry migration avoids needless full refreshes and credential writes while retaining profile validation and rejection fallback. Java discovery overlaps preparation only when the previous selection cannot be reused.
- Added credential-free launch phase timings to Logs. Screenshot warming/discovery and decorative launcher motion suspend during launch/gameplay; explicit screenshot opens still work, including promoting a paused queued preview.
- No JVM flags, RAM, graphics settings, or in-game mods were changed. Live launch-time and frame-time measurements remain needed before quoting a speedup.

### Organic artwork and motion redesign
- Replaced the shared gradient-blob treatment across all twelve styles with distinct local SVG compositions: aurora curtains, layered waves/dunes, a folded flower, mist veils, broad petals, ripples, silk folds, lagoon terraces, crossing ribbons, an eclipse ring, and topographic contours. Existing preset IDs, accent selection, opacity, glass settings, and saved image/source choices remain compatible.
- Larger full-bleed 16:9 thumbnails use the exact same artwork component as the desktop background. Selection retains the accent outline/check and a visible keyboard focus ring. No generated thumbnail assets, requests, SVG filters, or new dependencies.
- Added gentle brighten/dim breathing to Aurora, Mist, Ripple, Halo, and Contour. Contour's nested lines share one smoothly morphing curve with 12-second wave passes, keeping them aligned while the surface undulates; overall drift uses 22/29-second passes. Previews stay still, and reduced motion, Show Animations off, Ultra Performance, and launch/gameplay pause disable every effect.

### Sharing immediately after startup
- Share instance now restores the saved Bloom session through Social's shared native restoration helper before fetching friends. Users no longer need to visit Social to initialize their profile.
- Authenticated Social requests renew a rejected access token and retry once. Credential refresh and sign-out share a lock to avoid competing token rotations or restoring credentials after sign-out.
- Sharing displays the actual loading error with Try again; temporary service failures no longer claim the user is signed out.

### Content filter readability

**Superseded:** The October 20 approved content toolbar replaces this compact popup with a full-width drawer and neutral moving selection surfaces. Preserve the working filter/sort behavior, not this older geometry.

- Reworked the cramped content filter into a 276px attached panel. Sort by and Show labels now sit above their full-width segmented controls, giving Name/Size and All/Enabled/Disabled equal, comfortable targets with larger type and clearer spacing.
- Selected segments use white text over a restrained accent tint, avoiding low-contrast colored text with red or other dark accents. Keyboard focus uses a visible accent outline; hovering and clicking do not move the options.
- Kept the existing live sort/status callbacks, pagination reset, active trigger dot, header attachment, and outside-click/Escape dismissal for Mods, Resource Packs, and Shaders.

### Focused screenshot comparison and PNG export
- Removed the comparison helper sentence, filenames/instance captions, footer note, and Shelf comparison marketing copy. Only the active selection count remains outside the viewer.
- Made the divider's visible handle a true 40×40 rounded square with the same ArrowRightLeft icon and stroke weight as Change profile picture. Dragging and keyboard control remain intact.
- Added PNG export of the current split and swapped order, preserving both images' proportions and letterboxing. The export uses existing previews up to 1920px on the longest edge, includes the divider, and excludes viewer controls. A native PNG Save dialog chooses the destination; cancellation does not show a success message, and errors/success use the existing notification tray. Source screenshots remain untouched.

### Complete Light theme
- Added Light beside OLED Black in Appearance, persisted through the existing settings. Startup restores its palette before rendering; window color-scheme, native window theme/background, browser theme color, and default custom-sidebar ink follow the selected theme.
- Audited every UI stylesheet: main launcher/settings, Social and encryption panels, sharing/access dialogs, Locker/wardrobe, mod details, Utilities/Sync/AutoTune, screenshots/comparison, onboarding, tooltips, and accent editor. Shared surface/ink/status/depth tokens adapt hardcoded UI colors while keeping the original OLED values as fallbacks.
- Light uses white controls, near-black text, cool-gray corner shading on the sidebar/main surface, and soft slate shadows. Accent foregrounds use a darker readable variant of the chosen accent. Neutral, selected, hover/focus, disabled, warning/error/success, glass, and scrollbar states are included.
- Preserved media and color spectra. Comparison letterboxing, divider/handle, and PNG export follow the selected viewer palette; screenshot pixels and proportions remain unchanged. Built-in white identity marks switch to dark only in Light.
- Added `npm run test:theme` to check every UI sheet for unthemed color declarations and undefined light tokens, with explicit artwork/picker exceptions.


### Charcoal theme and independent Frosted finish
- Added warm-graphite Charcoal across the complete theme token contract, with distinct panels/controls, soft ivory text, warm shadows, themed comparison canvas/export colors, status states, and native/boot appearance. Accent-fill labels use a separate foreground token.
- Added the requested wider theme picker plus a compact 44px chevron button beside it. Its menu selects Unfrosted/Frosted, saved independently of theme. Escape returns focus to the trigger; outside clicks dismiss it.
- Frosted uses translucent navigation and floating surfaces with restrained highlight edges, preserving readable content and real artwork. Existing custom-background controls keep their values. Ultra Performance suspends the finish; reduced-transparency and unsupported-blur environments use safe solid surfaces.
- Extended the theme audit to validate complete Light and Charcoal token sets and contrast.


### Retired Charcoal and desktop-aware Frosted shell
- Removed Charcoal from the picker, startup palette, and runtime styles; persisted Charcoal values migrate to OLED while keeping the finish/background preferences.
- Frosted uses Windows Acrylic to reveal the desktop behind the title strip, sidebar, and ad rail. The native window supports transparency, the webview/root layers clear, and Bloom's selected Image/Organic artwork stays inside the main pane. Navigation, Downloads and Logs lose the opaque boxes; instance rows and the account dock use light washes with visible interaction states. The overlapping account menu keeps a stronger glass tint for readable text.
- Removed the main content pane's opaque top-strip shadow only in Frosted. Main content fill and media remain unchanged. Unfrosted clears native effects and restores an opaque window plus existing Background slider behavior without changing saved values; Ultra Performance and reduced-transparency do the same. Native appearance changes are serialized; native configuration requires a desktop app rebuild/restart.

### Restored normal Light and OLED Black themes
- At Parks's request, removed the Frosted selector, styling, saved finish preference, native Acrylic setup, and transparency permissions/configuration. The native window and normal theme surfaces are opaque again.
- Theme uses one standard dropdown with only OLED Black and Light. Charcoal remains retired. Existing Image/Organic backgrounds, their controls, and the complete Light palette are preserved.

### Instance folders and quick switcher
- Instances now offers named folders with create/rename/remove, folder filtering, pointer dragging from a card grip, and a keyboard-accessible Move to menu. Removing a folder keeps every instance and returns its members to Ungrouped. Folder metadata uses `bloom-instance-folders-v1` in the existing local settings store; no game directories move. Search and loader filters compose with the selected folder. The sidebar remains the recent-access list.
- Ctrl+K (Cmd+K on macOS) opens a focused search dialog for instances, pages, and Settings sections. Arrow keys select, Enter opens the existing destination, and Escape/backdrop dismisses with focus restoration. Common setting keywords such as theme, RAM, Java, and account find the relevant section. It does not launch Minecraft or interrupt an existing modal/onboarding flow.
- Verified create, rename, drag, menu-based movement, filtering, persistence after reload, switcher search/navigation, and Escape focus restoration in an isolated component preview. Both Light and OLED use shared theme tokens.

### Instance library header and bottom search
- Simplified the raised library header to All Instances only. Removed the eyebrow and subtitle. Folder controls and New instance share a darker action bar underneath.
- Reused the Mods search dock at the bottom, including its search mark, focus treatment, clear action, and loader filter. The card grid scrolls independently so the title, folder destinations, and bottom search stay accessible while filtering or dragging.

### Locker-style instance header and cleaner cards
- Matched Locker's centered title platform, rounded lower corners, shadow, and underlapping darker segmented shelf. Folder tabs use the same quiet selected tint; New instance remains on the shelf.
- Removed the permanent grip, folder label, and second menu beneath instance cards. Move to actions now live in each card's existing overflow menu. Dragging starts from the card body and suppresses navigation after a drop; Play and other buttons remain independent.

### Recessed folder editor drawer
- Folder creation and management now share one centered, inset drawer beneath the darker folder shelf. The selected folder's chevron toggles its editor; the plus opens the same drawer for creation. Removed the separate rename/remove row.
- Successful persistence replaces the form with a centered green Saved confirmation for one second, then retracts the drawer. Remove keeps every instance and shows Folder removed. Duplicate names remain editable with validation feedback; storage failures never show success. Escape/cancel restores trigger focus, and closed controls are inert.
- Reveal and retraction respect reduced motion, Show Animations off, and Ultra Performance. Verified creation, green confirmation, retraction, and unified edit controls visually in an isolated preview.

### 2026-10-15 — Remove instance organization folders

- Removed folder tabs, creation/rename/removal drawers, drag grouping, and Move to menu entries. The library displays all instances directly.
- Kept the centered title, New instance action, bottom search/loader filter, native folder opening, and Ctrl+K quick switcher. No instance files or saved installations are deleted.

### 2026-10-15 — Top instance search and centered creation

- Moved the complete search and loader-filter bar above the instance cards, retaining the existing search styling and working filters.
- Centered New instance within the darker shelf directly beneath All Instances. The card grid still scrolls independently.

### 2026-10-15 — Separate top filters from bottom search

- Corrected the previous interpretation: search returns to the bottom with no filter control. Only the loader-filter button moves beside New instance, centered together on the darker header shelf.
- The existing dropdown now anchors to the shelf bottom rather than the trigger bottom, so options emerge beneath the full darker bar. Search and loader filtering still combine.

### 2026-10-17 — Badge artwork, live pack installs, and rate-limit copy

- Restored the current Bloom logo in the name-tag font at atlas-safe high resolution, with explicit spacing and no duplicate label renderer. Badge-only players are observed independently of cape rendering.
- Resource packs and shaders can install while Minecraft runs; mods remain blocked. Pack-list directory watchers discover completed files. Download cancellation and errors no longer stop or clear the game's running state.
- Shared native invocation errors and status notifications normalize HTTP 429/rate-limit errors to “Whoa, slow down! Too many attempts. Please try again later.” Internal URLs and technical payloads are omitted from that message. Native Social 429 handling preserves the rate-limit meaning even for non-JSON responses.

### October 19, 2026 — saved appearance presets

- Settings > Appearance includes named preview cards with Save current, Apply, Rename, and confirmed Remove. Save captures theme, solid/animated accent (all stops, duration, intensity), Image/Organic choice, background opacity, and every main/sidebar surface, frost, outline, and text-color control. Performance, accounts, game settings, and animation preferences are unchanged.
- Presets own their image data in a versioned local IndexedDB store, avoiding the localStorage image quota. A preset remains intact when the current wallpaper is replaced. Mutations report success only after transaction completion; errors remain visible and retryable.
- Applying restores the image through the existing native background writer (or clears it with the bounded app-data command), then merges only appearance fields into the latest settings. An older startup image read cannot overwrite an applied preset. Removal deletes only the saved preset, not the active appearance.
- Preview cards reuse Organic artwork and show the saved accent and surface balance. Both OLED and Light use the existing semantic controls and focus styling.

### October 19, 2026 — compact appearance preset dropdown

- Replaced the separate preset card gallery with one normal Settings row above Theme, sharing its trigger styling, portal placement, and reveal animation. The first dropdown action is + Save new, followed by saved names, accent swatches, and a check on the current preset.
- Rename and remove remain compact actions inside each menu row. Naming and removal confirmation reveal inline only when requested. Success is announced without a permanent status paragraph. Existing saved records and wallpaper copies are preserved.
- Width correction: measure the trigger's exact border-box width and left edge. Do not impose a wider minimum or a horizontal inset on the preset menu; both edges remain aligned while resizing and scrolling.
- Verified save/apply/rename/delete and reload persistence in an isolated browser, keyboard arrows/Enter/Escape, outside dismissal, OLED/Light, and viewport placement. Native calls were stubbed; typecheck, build, theme audit and locked Rust check passed.

## October 19, 2026 — shared dropdown surface and corner underlap

- Standard selectors and saved appearances share a lighter opaque menu surface, full trigger width, and an underlap behind the rounded trigger corners. Above-opening menus move the underlap to the upper corners. The Home selector also uses its full width and complete corner depth.
- Apply this treatment to future dropdowns; retain content-sized icon menus and their header anchors. OLED uses a lifted neutral menu and Light uses white with the existing restrained edge/shadow tokens.

## October 19, 2026 — final dropdown preference

- Supersedes the full-width/lighter-surface direction above: restore original menu colors and center menus with a 5px inset per side. Keep the corner attachment within the inset.
- Saved appearances expose Save new, Apply and confirmed Remove only. Removed Rename; existing saved names and records remain intact.

## October 19, 2026 — unified preset rows

- Saved appearance selection and hover use one neutral rounded highlight across the complete row, including Remove. No accent-filled selection, checkmark, separate delete tile or rename action. The apply button exposes its selected state through aria-pressed; deletion remains independently clickable with confirmation.

## October 19, 2026 — neutral dropdown selections throughout Bloom

- Settings selectors, instance selectors and filter choices now share the same neutral selected/hover tokens as saved appearances. Selected Home instance subtitles stay muted rather than accent-colored. Window-menu hover uses the same neutral treatment; destructive text keeps its semantic color.
- Preset row highlighting uses those shared tokens while preserving its full-row treatment and separate Remove action.

## October 19, 2026 — image-focused Screenshot Shelf

- Retained the centered layered header, with Filter, Refresh and Compare together on its lower shelf. Comparison selection replaces Compare with Cancel and the live two-image count; removed the separate toolbar above the grid.
- Larger responsive cards show complete uncropped images above one compact footer: instance name, short local date/time, and permanently available copy/folder icons. Filenames remain in preview, accessible labels and the title tooltip; full timestamps remain available on hover.
- Preserved native action paths, caching, selection across filters, loading/error states and comparison export. Browser checks used actual local screenshots read-only and stubbed native commands; typecheck, production build, theme audit and locked Rust check passed.

## October 19, 2026 — recessed tabs, artwork progress and folder flap

- Added shared recessed selected-tab surfaces for Settings, Locker, pack sharing, instance content/settings and background source tabs, preserving sliding indicators and custom-background visibility.
- Active download artwork uses the existing cached source and actual progress, revealing full color from bottom to top without a boundary accent. Completed entries stay fully colored and error states preserve their partial fill.
- Replaced folder-action icons with a shared split-path Lucide folder. Only the flap moves; buttons stay stationary, press settles the flap and all motion preferences are respected.
- Browser checks covered custom-background tab depth, stationary folder buttons, hover/press, all motion overrides, and event-driven progress at 0/25/50/100 and failure. Native calls were stubbed; screenshots reviewed in OLED and Light.

## October 19, 2026 — static folder icons restored

- Removed the folder flap animation at Parks’s request and restored standard Lucide FolderOpen icons. Recessed tabs and download artwork progress remain.

## October 19, 2026 — Settings selection matches main sidebar

- Removed the recessed slot and under-label line from Settings navigation. It now shares the main sidebar selection stylesheet, including raised fill, subtle edge/shadow, ink, corner radius, inactive/hover styling and motion preferences in both themes and custom backgrounds.

## October 19, 2026 — wallpaper accent swatches

- Added a compact From wallpaper row beneath Accent Color with up to five distinct actual sampled colors, reusing circular swatches and selection rings. Clicking applies and persists the exact solid color while retaining stored gradient settings.
- Sampling uses the existing local wallpaper, a maximum 96px canvas, bounded color buckets and a one-image promise cache. Disabled/Organic/missing/unreadable backgrounds hide the row; source changes cannot show stale samples. Monochrome images show only their available colors.
- Verified real-image sampling, exact application and reload persistence, Organic hiding, transparent/solid/unreadable image cases and OLED/Light layouts with a stubbed native bridge.

## October 19, 2026 — wallpaper colors inside the picker

- Moved From wallpaper into the bottom of the custom accent picker below Cancel/Apply. The Settings row shows only its normal swatches. Clicking a sampled color applies that exact solid hex and closes the picker.
- The picker observes its size so asynchronously loaded samples remain within the viewport. Verified popup-only placement, exact selection persistence, cancellation and OLED/Light positioning.

## October 19, 2026 — wallpaper picker visibility correction

- Shared the saved wallpaper source with every Settings color picker, including gradient-stop popups. Removed the active Image-mode gate and load the saved wallpaper even when backgrounds are disabled.
- Missing/loading/unreadable sources now show concise states rather than silently disappearing. Sampling a gradient color updates that stop through its existing callback.
- Verified sampled buttons in main and gradient pickers while Organic is selected and backgrounds are disabled; exact solid application, popup positioning, typecheck, build and locked Rust check pass.

## October 19, 2026 — removed decorative tab underlines

- Removed the fading under-label line from every recessed tab, including Image/Organic, instance content, Locker and pack sharing. Selection keeps its continuous surface and depth. Do not reintroduce fading underlines or decorative edge beams.

## October 19, 2026 — three-card New Instance chooser

**Rejected implementation:** Superseded by the direct form restoration and visible launch-setting correction immediately below. The original external reference remains inspiration only.

- Added Vanilla, Modded and Import pack cards with unboxed Lucide icons, aligned actions and a restrained accent hover/focus surface, adapting the approved choice-dialog reference to Bloom.
- Vanilla/Fabric setup now starts with Name, Version and Directory; folder options join Java/performance under Advanced. Back retains the draft. Empty names and duplicate pending submissions are blocked.
- Import pack exposes local Fabric .mrpack/Modrinth ZIP import and the existing Modrinth browser. No mock actions, new backend routes or native packaging changes.
- Verified native-command arguments for Vanilla/Fabric creation, save error/retry, import cancellation/error/success, Modrinth open/close, advanced options, draft retention and responsive OLED/Light rendering using a stubbed native bridge. Typecheck, build, theme audit and locked Rust check passed.

## October 19, 2026 — original New Instance form restored

- Removed the three-card chooser at Parks’s request. Restored the original direct setup form, Loader selector, visible Select Components, header Import/Add from Modrinth actions and Cancel/Create footer.
- Kept all unrelated appearance, navigation, screenshot and download changes. The earlier choice-dialog reference remains inspiration only; its New Instance implementation was rejected.

## October 19, 2026 — prioritize launch settings during creation

- Replaced the always-visible folder toggles with Memory Allocation and Java selection. Automatic Java remains the default; both controls retain their existing draft and native save path.
- Moved folder creation into Advanced alongside JVM arguments and optional instance behavior. Kept the original direct form, import actions and responsive two-column layout.

## October 19, 2026 — disable browser inspection in development too

- Explicitly disabled native DevTools in the Tauri window configuration, including debug builds.
- Replaced the root-only keyboard guard with startup-level browser-context-menu and inspector/source-shortcut suppression covering onboarding, portals and the entire document. Custom Social context menus still receive events; copy, paste, undo and unrelated Ctrl+Shift shortcuts are not suppressed. Hot reload cleans up the global listeners.

## October 20, 2026 — original flat buttons restored

- Parks rejected the entire raised-button experiment, including the initial inset lip, thicker surrounding border and darker contrast variants. Removed the added action stylesheet, import and depth token to restore the exact component styles from before this request.
- Preserve the original flat buttons. Sidebar highlights and unrelated earlier work remain unchanged.

## October 20, 2026 — interactive instance content toolbar

**Explicitly approved by Parks:** “actually perfect” and “beautiful.” The approved example and reuse limits are recorded in [GOOD_DESIGNS.md](GOOD_DESIGNS.md#connected-instance-content-toolbar).

- Replaced the boxed count with a quiet installed/enabled readout beneath the category title. Search and status filters display matching versus total counts from the existing list, including confirmed toggle changes.
- Filter reveals a full-width drawer under the header. Neutral selection surfaces slide between Show and Sort by choices; Reset restores both defaults. The list lends height to the drawer, keeping search/pagination stationary and results visible below the tools. Compact widths use two rows. Escape restores focus, outside click closes and hidden controls are inert.
- Add/Back retain one focusable control while its icon and header copy transition into the existing catalog. Version/loader identify the catalog context. Existing compatibility, loading, caching, installation and pagination paths remain in place. All decorative motion respects reduced motion, animations off and Ultra Performance. Original flat buttons and sidebars remain unchanged.

## October 31, 2026 — modpack builder removed

Parks requested removal of the just-added modpack builder. Removed its workspace, native resolver/creation commands, tests and feature document; restored the pre-builder client entry points. Existing modpack sharing and unrelated client/Admin work remain unchanged. Do not treat the removed implementation as approved design.


## November 3, 2026 — inline names, quiet cards, and optional floating Play

- Requested: click-to-rename instance titles (Enter saves, Escape restores), quieter artwork/name/Play cards with a corner Rename/Duplicate/Export/Delete menu, and initially a bottom workspace Play dock.
- Correction: Parks rejected the permanent bottom bar before handoff. Restore Play and overflow to the header. Offer an optional floating copy from the menu, drag it by its empty middle, preserve it across tabs, and resize continuously into an icon-only Play button. Use a Put away action rather than duplicating the full overflow menu on the floating copy. This is direction approval; final visuals await review.
- Implemented: native rename changes only the current record's name; blank/failed edits remain editable. All shared instance identities update after save. Existing duplicate/delete/sharing/organization actions remain connected. Export ZIP uses a native save dialog and writes a local backup containing mods, resource packs, shaders, config, saves, screenshots, options and server list plus basic instance metadata. It excludes launcher credentials, runtime caches and logs; it is not a Modrinth pack or a new automatic import format. Existing exports are not overwritten, links are rejected, and publication waits for a completed archive. The atomic export requires a filesystem supporting hard links (such as the current local Windows drive).
- Floating Play is session-scoped, retains its target across navigation, and remembers size/position locally for reopening. Drag/resize uses pointer capture, bounded frame-based easing and continuous layout; Escape restores the starting geometry. Arrow keys move the grip; Left/Right resize, Home reduces to icon-only, and End expands. Reflow keeps controls inside the workspace when sidebar/window dimensions change. Reduced-motion modes apply geometry immediately. The original flat buttons and sidebar remain unchanged.
- Verification: `tests/instance-controls-ui.mjs` uses the real React UI with a native-command fixture to cover rename cancellation/failure, card actions, floating drag/resize/cancellation, cross-page instance targeting, busy launch controls, preference restoration and minimum window/theme/motion behavior. Rust export tests exercise actual ZIP bytes, credential-file exclusion, cleanup and overwrite refusal. Native window dialogs and an actual Minecraft launch are not exercised by the browser fixture.
- Handoff checks passed: TypeScript, production build (existing bundle-size warning), locked Cargo check, Rust export test, instance-controls UI checks and existing content-toolbar/instance-folder UI regressions. Reviewed expanded/icon-only and Light/minimum-window screenshots. Changes remain local on `codex/instance-controls`; no version, release, tag, commit or push was created.

## November 3, 2026 — restore original instance appearance

Parks requested resetting how instances and the instance page look. Restored the library card's original dimensions, loader mark, Minecraft version, directory text, and bottom Play/Folder/More row; removed the compact-card and header-width overrides. The permanent bottom dock remains removed and the original instance header/page composition remains in place. Inline renaming, working menu actions and the optional user-controlled floating Play copy are retained; this is an appearance rollback, not removal of those capabilities. Reconciled DESIGN_RULES and GOOD_DESIGNS so the rejected quiet-card layout is no longer active guidance.


## November 10, 2026 — AutoTune reliability and Minecraft 26.3

- Reported: the benchmark stopped with a missing `launchMethod` argument. The launch now supplies all three required settings through one tested payload; normal launch settings and unrelated local work are preserved.
- Parks requested stable 26.3 for the benchmark. Updated the actual Fabric instrumentation and embedded JAR, not just the UI label. This is a fixed supported version, not an unimplemented multi-version selector.
- Retained the focused five-step shell, theme tokens and flat controls. Added an explicit measured-result review, expandable reasons, a bounded session run log with report copy, retry/stop paths, confirmed completion, and optional Sodium/Lithium/FerriteCore project links. This implementation awaits Parks's visual approval; it is not a new approved reference.
- Corrected long-stall filtering, percentile rank, per-frame status-file writes, stale-result reuse and silent early-exit waits. New runs carry a shared run ID; incomplete, interrupted and inconsistent results cannot produce a profile. Benchmark setup avoids Global File Sync and cosmetics injection to preserve its workload.
- Recommendations respect system-memory headroom and the tested distances; they no longer infer garbage-collector faults from FPS alone or extrapolate a heavier graphics mode. Applying uses the display target for the frame limiter, preserves fullscreen/VSync preferences, skips native-engine instances, and restores previous files on reported save failures before returning an error.
- See `AUTOTUNE_ARCHITECTURE.md` for the build/test commands, measurement scope and remaining limitations. No application version, commit, push, tag or release action is included.


## November 10, 2026 — Mac compatibility copy

- Preserved the shared interface, layout, themes and controls. Java and memory help refer to the system instead of assuming Windows.
- AutoTune labels its 60 FPS fallback when display refresh is unavailable, including variable-refresh macOS modes.
- Native Mac appearance and interaction acceptance remain pending on Parks's Apple Silicon Mac. This is not a newly approved design. Platform boundaries, build commands and the acceptance matrix are in `MACOS_SUPPORT.md`.


## November 11, 2026 — selected Soft ceramic sidebar

Parks selected the Soft ceramic preview and requested its drop shadow on the existing main sidebar. Applied its radius, neutral gradient, 600-weight labels, 46px minimum height, inset lighting, diffuse shadow and selected-button press. Scoped styles to main navigation and excluded those buttons from the global press animation to prevent double compression. Settings tabs and other actions remain unchanged. Earlier shared-navigation styling guidance is superseded for the main sidebar only; this does not reverse the rejection of application-wide raised buttons.


## November 11, 2026 — darker ceramic and sliding navigation

Darkened the ceramic gradient and standard sidebar in both themes. Replaced separate selected-button fills with one measured, pointer-transparent surface that slides with a subtle fade/scale settle. Active routes and clicks remain immediate. Rapid changes begin from the current visual position; first render, resized layouts and reduced-motion modes position immediately. Kept existing wallpaper controls and Settings navigation.


## November 11, 2026 — restore press feedback and fix glass menu seams

Parks reported a harsh opaque underlap in Home's instance selector and rejected removal of the click-pop timing. Restored configurable press motion on both navigation labels and the shared ceramic surface, removed the separate held-button transform, dimmed inactive labels, and added a bounded 6px overshoot with 480ms settle. Body-portaled dropdowns now receive the owner's translucent fill/frost explicitly; Home no longer overlaps the trigger by 15px and standard glass selectors omit their opaque underlap patch. Tests verified material equality, edge alignment, actual instance selection, rapid navigation reversal, compact alignment and reduced motion.

## November 11, 2026 — continuous ceramic corners and softer settling

Parks reported bright corner flicker during travel, uneven gradient lighting and harsh stops, and requested a substantially darker highlight. Inspection reproduced stationary rounded button blur/fill layers cutting across the moving surface. Main navigation now paints its background only on the shared highlight; buttons remain transparent and unfiltered even on hover. Lowered the dark gradient to #191b1f–#14161a, softened the inset edge, matched compact corner radii, and replaced the segmented 480ms fade/overshoot with a continuous 720ms damped spring at stable opacity. The small overshoot settles gradually; configurable click-pop remains intact. Noise was not added because the suggestion was tentative. Settings navigation and dropdown materials retain their previous behavior. The integrated revision awaits visual review.

## November 11, 2026 — remove interface sounds

Parks requested removal of interface sound. Removed the sound settings, preview controls, synthesized playback, input listeners and success cues, plus their obsolete tests. Settings loading drops the retired sound preference even when previously enabled. Visual toggle compression and configurable button press feedback remain. Game audio is outside this removal. This supersedes the November 7 optional-audio direction.

## November 11, 2026 — ceramic workspace depth and silent feedback

Parks requested more depth on the shown instance panels and controls, then invited consistent tactile detail elsewhere. Added a scoped interface-depth stylesheet: dark ceramic header lighting across existing workspace title platforms, recessed connected shelves, a raised neutral content indicator, soft bevels/shadows on instance Play/Add content and adjacent controls, quiet installed-row hover/focus edges, and recessed toggle tracks with shaded thumbs. Existing geometry, artwork, blur controls, real actions and configured click-pop remain; no new sound or decorative movement was added. Light uses its own semantic surfaces/shadows, custom-background headers retain their chosen opacity, and motion preferences suppress the new transitions. Corrected two earlier sidebar literals to pass the shared theme audit. This direction supersedes flat-action guidance only within the requested instance-workspace scope; visual approval is pending.

## November 11, 2026 — pull back repetitive ceramic depth

Parks rejected the broad depth pass as repetitive and trying too hard, while allowing ceramic on the top. Removed the newly added bevels, toggle shading, row treatment, selected-tab material and repeated header/shelf styling. Retained ceramic only on the top instance identity header (and the separately approved main sidebar). Restored the original Mods toolbar, flat Play/Add Mods/Settings controls, lower panels and other page headers. Add Mods remains in its existing toolbar. Interface sounds stay removed and existing visual click/toggle feedback remains. This supersedes the broader workspace-depth direction above.

## November 11, 2026 — remove recent-search history

Parks clarified that “the research thing” meant recent searches and requested its complete removal. Removed the Cache preference, five-item history recording, suggestion panel, focus/keyboard hooks and dedicated CSS. App settings loading removes the old history key and retired preference, including previously enabled histories. Installed-content filtering, Add Mods search, catalog/result caching and the search bar's existing appearance remain. This supersedes the earlier Recent Mods searches entry.

## November 11, 2026 — near-black grayscale header and sidebar

Parks rejected the dusky/cool tint and bright glint, requesting a much blacker grayscale treatment. Changed the main sidebar selection and top instance identity header to #0d0d0d–#080808, removed their bright upper inset edge in OLED, and made the standard sidebar pure black. Light keeps readable neutral-gray counterparts. Layout, artwork, accents, existing press/slide motion and the previously restored flat lower controls remain.

## November 11, 2026 — slight grayscale visibility lift

Parks approved the near-black grayscale direction and requested only a small lift because the surfaces were hard to see. Raised both instance-header and sidebar-selection gradient stops by five RGB levels, from #0d0d0d–#080808 to #121212–#0d0d0d. Kept the sidebar background black and preserved the lack of tint/glint, layout, shadows and animation.

## November 11, 2026 — match the Mods toolbar color

Parks perceived the slightly lifted equal-RGB gray as brown and supplied the Mods toolbar as the desired lighter color. Sampled #0c0e0f from three unobstructed areas, matching the existing `--panel-strong` token. Both the instance identity header and sidebar selection now start at that color, hold it through the upper 20%, then fade vertically to a 25% mix over the page near black. Retained shadows and no bright upper glint. The flat Mods toolbar itself is the reference and remains unchanged. This supersedes the previous exact grayscale stop values.

## November 11, 2026 — restore ceramic bevels and diagonal shading

Parks clarified that the Mods-toolbar color change must retain Soft ceramic bevels, roundness and depth, and explicitly rejected the vertical gradient. Restored the 160-degree diagonal on the instance identity header and sidebar highlight, with soft upper-left inset lighting and lower-right inset shading. Retained the sampled Mods-toolbar palette, dark falloff, existing radii/drop shadows and single-layer sidebar movement. This supersedes the vertical/no-edge interpretation above.

## November 11, 2026 — approved sidebar frame and five text previews

Parks explicitly approved the pictured Instances frame as beautiful and requested five click-through options for its text. Prepared isolated typography previews with the same ceramic frame, label and icon; only font, size, weight and letter spacing vary. The live sidebar remains unchanged while Parks chooses. The frame approval is recorded in GOOD_DESIGNS; none of the new text treatments is an approved implementation yet.

## November 11, 2026 — Home Play pixel-fill hover

Parks requested a slowly spreading circular fill from the mouse-entry point, a noisy edge made of large pixels, S-curve easing and gentle enlargement on the pictured wide Home Play button. Added a focused component using fixed 10px edge noise, 1250ms entrance, 850ms withdrawal and 2.5% scale. The overlay uses the existing theme text/page pair for a pale fill in OLED and dark fill in Light; the final palette and animation await visual review. Quick reversals retain the existing front, keyboard focus begins in the center, and motion preferences snap color without scaling. Disabled/busy and hidden states stop the effect. Preserved native launch timing and target, global click-pop, the selector, other Play actions and the approved sidebar frame. The five sidebar typography previews remain unselected.

### November 12 revision — quicker fill and smoother S-curve

Parks requested a slightly quicker Home Play hover fill with better S-curve easing. Shortened the entrance from 1250ms to 1000ms and replaced cubic smoothstep with quintic smootherstep, giving zero speed and acceleration at both ends and a stronger middle. Kept the 850ms withdrawal duration, pointer origin, fixed pixel noise, scale, palette, geometry and immediate launch. This narrow motion revision awaits visual review.

### November 12 preview — ceramic Home Play

Parks asked to try ceramic bevel depth on this Play button. Added a restrained 160-degree face gradient, soft upper-left/lower-right inset bevel and diffuse theme-aware shadow, scoped to Home Play. One pointer-transparent rim sits above the accent and pixel-fill faces so the edge stays continuous during hover. Kept its size, accent, label, hover timing, press feedback and launch behavior. This reversible preview is not approval of the treatment or permission to restyle other buttons.

## November 11, 2026 — keep launcher responsive across Minecraft launches

Parks reported that animations stopped and buttons appeared randomly unresponsive after launch. Reproduced the global animation flag switching off on Play: both download activity and the entire game lifetime were overriding the saved animation preference. Removed those overrides from global feedback, sidebar movement and animated accent. Existing user motion/performance settings still apply; actual game/file-operation guards remain.

The prior fallback polled only active downloads and ignored terminal states; process liveness was checked only once. Replaced those paths with stable event subscriptions and bounded native snapshot recovery, including focus/visibility return, completion, error, cancellation and process exit. Older responses cannot overwrite newer events or local requests. Removed the delayed idle reset that could clear a newer launch, scoped completion cleanup, and prevented duplicate pending launch requests. Regression coverage uses native fixtures and does not constitute real gameplay or Mac acceptance.

## November 12, 2026 — archive the native remake outside Bloom

Parks paused the unfinished Rust remake and requested that all progress be preserved outside the client. Moved the entire engine workspace, its build cache, adapter, settings component, build script, architecture notes and staged executable to the sibling `Sakura-Archive-2026-11-12` folder. The archive includes verified originals of all mixed integration files and the earlier runtime-specific UI/design records.

Removed the engine picker/settings/launcher path, native content exceptions, nightly engine build hooks and Windows/Mac sidecar packaging. Bloom remains a Java/Fabric launcher with its existing UI, AutoTune, cosmetics and platform support. Existing non-Java records are rejected/hidden without rewriting their data, rather than being accidentally launched or tuned as Java. The archived work is paused, not discarded or approved as finished. No version change, release, push or publication was requested.


## November 12, 2026 — centered sidebar press and release-only travel

Parks rejected the ceramic highlight lifting vertically during click-pop. He requested compression in place, retaining the normal slide but starting navigation only after release/completion. The global pointer-down animation was scaling/translating the positioning track and completing its pop while the pointer was still held. Main navigation now owns a held native `:active` compression on the label and a separate inner ceramic face; the outer track keeps its existing spring translation. Release restores scale with the configured duration, and existing native clicks/keyboard activation remain authoritative. No palette, typography, frame bevel, sidebar layout or other button treatment changed. The correction is requested direction, not a new visual approval.


## November 12, 2026 — hold interrupted sidebar slides; contain download artwork

Parks reported that the previous centered press fix still moved the highlight on lower rows while holding. Reproduced an in-flight slide continuing more than 100px underneath the compressed face. Pointer/Space holds now freeze the visible track transform immediately, and completed/canceled releases resume from there toward the appropriate existing route. Regression checks exercise every navigation destination, interruption, outside cancellation and the existing motion preferences. The original 720ms spring and ceramic material remain unchanged.

Parks also reported a stray question mark and blocked Downloads controls. Its missing-artwork fallback used absolute positioning without a containing icon tile, covering the content pane. The 48px tile now establishes its containing block, clips artwork and rejects pointer input. The legitimate placeholder stays inside the tile; cancellation, Clear Completed and navigation remain wired to their original operations. Browser fixtures verified active and completed placeholders, hit targets, cancellation and persisted history clearing. No live download history was cleared.


## November 12, 2026 — restrained Downloads hover and clearing feedback

Parks requested more reactive Downloads, especially a simple satisfying delete effect and hover animation. Added a 1px hover lift and quiet neutral edge/fill response to the existing rows, plus a restrained danger-ink/trash-icon tilt on Clear Completed. Clearing uses a short shrink/fade and gap collapse with 20ms staggering (capped at 80ms); the empty state fades in. Saved history clears at once, and exiting rows are inert/hidden to accessibility. New completions remain independent of the deleted snapshot. No files are removed, and the existing active Cancel action, layout, artwork containment and other pages remain unchanged. This is an implemented request awaiting visual review, not a new approved reference.

Browser verification covers hover, immediate persistence before the animation finishes, incoming completion during removal, keyboard clearing, active cancellation, placeholder hit testing and motion-disabled/Light states. Native commands and history are isolated fixtures; real user history was not cleared.

## November 12, 2026 — slower Downloads clearing with a directional exit

Parks rejected the first fast shrink/collapse as unsatisfying and requested a slower, more creative eased deletion. Replaced it with a slight pull-back followed by a 720ms rightward sweep, a delayed soft fade/blur, and a separate 560ms eased space closure beginning at 360ms. Rows follow with a 65ms stagger capped at 260ms; the empty state fades in more gently. Existing hover feedback, flat surfaces and actual immediate history clearing remain. The implemented motion awaits visual review and is not an approved reference. Browser checks now verify the pull-back, visible rightward departure before any gap closes, and later collapse while retaining persistence, concurrent completion and motion-preference checks.

## November 12, 2026 — show every content installation in Downloads

Parks rapidly installed four mods and saw only the last in Downloads. The native worker already queued requests, but the UI exposed one mutable launch record and deduplicated completion by instance/state. Added native per-task identity and revisioned snapshots; Downloads now shows the active install, each queued item with its position, stopped outcomes, and independent completed records. Per-item cancellation preserves the rest of the FIFO; errors continue to the next task. The catalog reads the same pending state after navigation. Snapshot recovery handles missed events and webview reloads, and a persisted acknowledgement prevents cleared history returning. Retained the flat cards and existing hover/delete animations; no new visual approval is inferred. Completed history now retains 50 records instead of five. The queue remains in memory and does not resume after fully quitting Bloom.

Regression fixtures cover four same-turn catalog clicks, all queue rows, per-task progress, navigation/reload, stale snapshots, missed terminal events, all four completions, clearing/reload, queued and active cancellation, failure continuation, dismissal and compact Light layout. Native queue tests exercise FIFO identity, deduplication checks, isolated cancellation and bounded terminal retention. These checks do not download mods into the user's real instances.

## November 12, 2026 — bottom-first falling history deletion

Parks approved the slower deletion as “much better” and requested falling down, scaling inward and fading out, starting from the bottom row. Kept the 720ms eased departure and delayed fade, changed the path to a straight 28px fall with 90% final scale, and reversed the stagger to bottom-to-top. Gaps close later, with the same soft 560ms ease; long lists compress the stagger to a maximum 400ms spread. Removed clipping on the inert presentation wrapper so the moving card keeps its corners. Actual clearing, incoming completions and motion preferences remain unchanged. Approval is limited to the improved pacing; the revised path awaits visual review.

## November 12, 2026 — ceramic account dock and recessed logout footer

Parks requested the existing ceramic finish on the pictured sidebar account card, and more depth for Log out with an explicit exclusion of ceramic. Reused the sidebar's 160-degree palette, subtle inset bevels and diffuse shadow on the moving account identity dock, preserving its avatar, typography, dimensions and attached drawer. The trigger stays transparent so custom-background overrides cannot double-paint the face. Log out keeps its existing edge-to-edge footprint and bare icon, with a solid matte red surface, recessed upper shadow and a small eased icon movement on hover/focus. Existing sign-out, keyboard operation, compact sidebar and motion preferences remain. The screenshot identifies the target; this implementation is a requested revision awaiting visual review, not a new approved reference.

## November 12, 2026 — lighter account ceramic without an outline

Parks said the account card still looked the same and requested removing its outline and lightening the ceramic. Raised the dark-theme gradient stops to make the face visibly distinct while preserving the 160-degree direction, soft bevels and drop shadow. Removed the trigger's enclosing focus outline; keyboard focus instead brightens the material, including the compact dock. Kept the avatar, drawer motion, other ceramic surfaces and logout treatment unchanged. This correction supersedes the account dock's original near-black palette; the new rendering awaits review.

## November 12, 2026 — per-instance Fabric Loader selection

Parks requested changing Fabric Loader versions from Instance settings. Added a shared-dropdown row for Fabric instances, showing the saved or locally recovered version, latest-stable/prerelease labels, loading and retry states. Choices remain drafts until the existing Save changes action succeeds. Native saves verify the published version for the instance Minecraft version, recheck activity and target identity after metadata returns, preserve independent settings, and write the existing loaderVersion field. Launch resolution and the existing version-aware cache key use that exact pin, including downgrades. Omitted loader fields preserve existing pins and legacy automatic behavior; Vanilla and all instance game/content files remain unchanged. UI and native fixtures cover persistence, failures, stale results and busy guards. The new row awaits visual review.

## November 12, 2026 — Add Mods sidebar redesign reverted

Parks rejected the in-progress Add Mods filter-sidebar redesign and requested exactly the previous behavior. Restored the pre-redesign frontend and native catalog sources and removed the new filter components, styles, service and native module. The previous Add/Back toolbar, full-width results, search, installed-content filters, caching and installation flow remain the active design. The earlier Fabric Loader setting is outside this rollback. Do not treat the rejected sidebar proposal as approved.

## November 12, 2026 — Add Mods filters in the existing drawer

Parks replaced the rejected sidebar request with a filter button beside the existing return action and the same slide-down drawer used by installed-content filters, explicitly asking to change nothing else. Added category, client/server environment, loader, Minecraft version and sorting dropdowns with compact icon labels and existing theme-aware Select controls. The surrounding headers, full-width rows, anchored search, pagination, Add/Back action and installed filters retain their layout.

Selections reach native Modrinth search and distinct cache keys. Defaults retain the existing search path; reset restores Fabric and the instance version. Dropdown clicks stay inside the drawer, Escape closes a submenu before its parent and restores focus, metadata/search failures can retry, and stale responses cannot replace newer selections. Browsing other loaders/versions never enables installing an incompatible file; details describe the selected file. This implements the requested direction and awaits visual approval.


## November 14, 2026 — Portal and account-menu Settings

Parks clarified that he meant the global Settings tab in the sidebar, then authorized replacing it with Portal and moving Settings to the account menu. Kept the instance header, Mods/Resource Packs/Shaders navigation, instance-settings gear and Home unchanged. The existing signed-in Client settings action is reused; signed-out accounts now also have that action in their drawer. Portal is included in remembered-page navigation and Ctrl+K. This supersedes earlier sidebar-order entries that placed Settings last. Earlier proposed instance-header redesigns remain rejected.

Portal reads actual instance worlds and saved server lists, groups recent successful sessions above the destination list, and offers favorites, search, All/Servers/Worlds and additional server shortcuts. Play/Join uses the existing launch flow and correct owning instance. Minecraft's Quick Play log records actual joins; attempts are not treated as recent servers. Native validation blocks missing worlds, unsafe targets and world downgrades. Bookmark changes persist separately without rewriting game saves/server files. The dropdown's optional modal host keeps its options interactive inside the Add server dialog; existing dropdown placement is unchanged. Requested placement is approved; this implementation awaits visual review.


## November 17, 2026 — Portal library rejected; simplified server list requested

After rejecting the original Portal, Parks initially selected a launcher game library. The first replacement used cards and a compact Continue section. Parks rejected that direction before handoff: “no no again i want more of a serverlist format.” He then said there was far too much information and requested simple animations like the Add Mods button on instance pages.

Replaced the proposed cards, Continue area, repeated counts, labels and metadata with full-width rows: small icon, name, one secondary line, favorite, options and Join/Play. Instance/version details and launch restrictions remain accessible in options. Add server now reveals a connected form, with the same persistent Add/Back icon swap used by the content toolbar. Filters, removal confirmation and action feedback use restrained transitions; favorite state and copy/save feedback follow native success. The form retains values on failure. Animation-off, Ultra and reduced motion are respected. Discovery, persistence, launch guards and account-menu Settings remain unchanged.

The requested format and feedback references are recorded; this implementation has not yet received visual approval.

Parks then requested an easier, unobtrusive way to distinguish servers and worlds on All. Added separate Servers and Worlds groups with small icon headings. Dedicated tabs omit these headings, empty groups disappear under filtering, and sorting applies within each group. This refinement also awaits visual review.

Parks requested the actual Minecraft default server image instead of the server-stack fallback. Server rows without a working custom icon use Minecraft’s actual default server image (`public/minecraft-default-server.png`), extracted unchanged from `assets/minecraft/textures/misc/unknown_server.png` in the locally installed Minecraft 26.3 client. Keep its pixel art crisp; custom server icons retain precedence.

Parks rejected the continuous workspace block below the header and supplied a Locker screenshot as a reference for separation. Search now has its own surface; the view selector and filter controls are visually separate; Servers and Worlds each have their own list panel beneath an outside heading. The overall workspace background was removed. The screenshot is a reference, and this Portal layout still awaits visual review.

## November 18, 2026 — Portal favorite and filter hover refinement

Parks requested more unique, less awkward hover feedback for Favorites and Filters. Removed the persistent star tilt. Row favorites and the Favorites filter now keep an upright star, preview a faint accent fill on hover/focus, and retain solid fill only for the saved/selected state. Filters subtly adjusts its icon’s line lengths in place. Neutral surface feedback stays restrained; button geometry, labels and existing actions remain unchanged. Motion preferences disable the transitions. The request is recorded; this implementation awaits visual review.

Parks approved the favorite/filter refinement (“way better, almost perfect”) and requested the same hover treatment for All/Servers/Worlds with a cooler selected state. Portal’s existing moving selector now uses a restrained accent tint, fine border and small leading marker. Hover and keyboard focus share the icon controls’ quiet accent feedback, with stable label positions. The shared ToolbarSegments behavior remains unchanged and this styling is scoped to Portal. Approval covers the favorite/filter effects; the tab styling awaits review.

Parks rejected the proposed selected-tab dot and accent fill/border, explicitly prohibiting dots, underlines, side lines and similar selection decorations. He requested a material treatment related to sidebar ceramic but different. Removed the marker, accent fill and border, restored centered labels, and replaced them with a neutral softly raised face using subtle gradient and inset/lower shading. The moving selection stays on the existing shared indicator; tab hover is neutral. Favorite/filter hover approval remains scoped to those controls. The revised selected face awaits review.

## November 18, 2026 — reversible account-menu logout

Parks supplied three Archive/Undo images and requested that Log out turn into Undo with a ring retreating around the button before sign-out. Added a dedicated `UndoLogoutButton` inside the existing account drawer. The first proposal used a matte pill; Parks immediately rejected its roundness and requested the existing button and font design. The implementation now retains the original logout footer’s geometry, red material, alignment and typography. Only its icon/label transition and functional SVG perimeter are new. The perimeter reports the actual five-second window without changing the identity dock or other menu actions.

Undo and keyboard activation cancel before any native action occurs. Menu dismissal, account changes, document hiding and unmount clear the timer. Expiry invokes the existing sign-out flow once; the control disables during that request, native failures retain the existing error reporting, and successful completion refreshes accounts. Reduced/off/Ultra motion preserves the time window and uses discrete ring progress. The new functional ring is explicitly requested and does not reinstate decorative selection outlines. The supplied screenshots are references; this implementation awaits visual review.

Parks clarified that the reference applies to feedback, not pill geometry: match the client’s existing roundness, button and font design. Removed the proposed pill/centered label and restored the original Log out footer. The ring now follows the button’s measured individual corner radii, including its square upper corners and rounded lower corners.

Parks then rejected the red-filled footer with the orange ring and asked for a dark grayscale surface, a red outline, and a bolder icon and label. The footer now uses a neutral inset/hover surface and divider, the existing font family at 12px/900 weight, and an 18px icon with a stronger stroke. Only the functional countdown is red. Its existing corner geometry and five-second behavior remain; this refinement awaits visual review.

Parks subsequently requested rounded top corners, a darker logout surface and a shadow cast upward onto the rest of the dropdown. The top corners now match the existing 13px bottom radius, the neutral face is nearly black with a restrained hover increase, and an upward diffuse shadow replaces the straight divider. The measured red countdown follows all four corners. This supersedes the square-top treatment above and awaits visual review.

Parks then explicitly requested an even darker ceramic finish for Log out. This supersedes the November 12 matte-only exclusion: the footer now reuses the account dock's 160-degree shading and inset bevels over a nearly black face while retaining its upward shadow, 13px corners, heavier content and red countdown. The revised implementation awaits visual review.

## November 18, 2026 — borderless account menu and ceramic controls

Parks requested redesigning the entire account dropdown to remove its outline while retaining a distinct menu. The revision uses an opaque shaded panel, diffuse shadow, neutral hover/focus rows and an inset ceramic logout button. It preserves the moving identity dock, stationary reveal, compact layout and five-second Undo flow. Increased action-label readability and recovered width so Profile & accounts does not truncate. The screenshot identifies the prior treatment; the revision awaits review.

Parks then requested red versions of Home Play's ceramic finish for Settings Sign out and Reset settings, followed by that finish on Add Minecraft account (+) and all on-state toggles. The + control and toggle tracks retain the current accent, off states and existing behavior. Found and corrected the global button-shadow reset suppressing the intended material bevels and logout's upward shadow; scoped overrides restore them while Ultra suppresses the depth. These changes supersede earlier ceramic-only scope limits for the named controls and await visual approval.

## November 18, 2026 — complete action coverage and softer ceramic corrections

Parks expanded the finish to every accent action, naming New folder, New instance, Add Mods/Back, comparison Cancel and Settings Enabled, then identified missed Clear cache/Change and photo buttons. Audited accent-background rules and neutral action rows and consolidated their finish in `ceramic-actions.css`, preserving component behavior and geometry. This supersedes earlier named-controls-only scope; navigation selections, artwork and off toggles retain their own treatment.

Parks rejected the bright, tight bevel on the small options control, requesting darker, duller material, softer corners and a slight hover lift below the rejected brightness. The first softening blurred the inset highlight broadly; he then reported it looked like a rim around the entire button. The revised finish uses a faint upper-left highlight with negative spread, removes the enclosing inner shade and fades compact controls' hover/focus brightness in and out over 200ms, respecting motion preferences. These are corrections and requested implementations, not visual approval.

## November 22, 2026 — sidebar launch row

Parks flagged the floating X and the surrounding overlay in the launching instance row, then rejected the proposed progress bar beneath it. The shared rounded row background now fills left to right with its normal selected color as native progress advances. The name, artwork and trailing Cancel button stay fully visible above the fill. The revised row awaits visual review.

## November 23, 2026 — wing catalog cards

Parks rejected the editor screenshot and equipped check mark on wing cards. Wing cards now use the cape card treatment with a transparent render of only the cosmetic. The detail pane retains the account skin and color controls. This implementation awaits visual review.

Wing card artwork uses a straight-on camera centered on the cosmetic bounds, with equal horizontal margins. Character preview rotation belongs to the detail pane.

Home Play uses a dimmed surface during launch with a left-to-right fill driven by native launch percentage for the selected instance. It reads Running… while that instance is running. The Locker Wings category uses the flight bird icon. This implementation awaits visual review.

Equipped look includes the Wings slot and renders the equipped wing revision with its saved colors and animation. Visible wings take precedence over capes in the character preview, matching the game.

Equipped look passes its loaded skin texture and arm variant directly into the wing preview and starts facing the player, so the wings cannot obscure the skin from the initial rear view. Dragging still rotates the full preview.
Equipped look wing preview must reserve its explicit preview height. Its absolutely positioned canvas cannot size a flex child with a zero flex basis. The wing preview uses flex none within the detail pane.

## November 23, 2026 — Home Play launch fill correction

Parks reported that Home Play still did not become a loading bar. The desktop accent background was overriding the dim loading surface, making the fill indistinguishable. The native process-start flag also hid the bar during renderer and resource loading. Home Play now keeps native launch percentage visible until the loading phase ends, then shows Running… for its running instance. A browser regression exercises process start before game ready, native percentage widths, cancellation, completion and disabled motion settings. This correction awaits user visual review.
