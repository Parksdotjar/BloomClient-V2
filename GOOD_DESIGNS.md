# Bloom Client Approved Design Patterns

This is the short list of designs the user has explicitly approved as especially successful. Treat these as visual references for future work—not as components to copy everywhere without considering context.

Before designing a related interface, review this file alongside `DESIGN_RULES.md` and `UI_CHANGE_HISTORY.md`.

## Full-bleed artwork with hover-to-change

**Approved:** August 20, 2026  
**Current example:** The instance-page header artwork selector.

### What makes it work

- Artwork fills its entire media square and reaches the parent card's top, bottom, and left clipping edges. There are no inset gaps or a separate frame around the image.
- The artwork and surrounding card use one continuous surface hierarchy. The left side is not turned into an unrelated second-color platform.
- A restrained horizontal shadow falls only toward the content side. It separates the artwork without creating a glow.
- Identity text is explicitly layered above the artwork shadow, preserving crisp readability regardless of the uploaded image.
- The resting state contains no permanent edit badge, corner bubble, or overlapping control.
- Hovering dims the full artwork by a meaningful amount and reveals one centered horizontal-switch icon. The icon fades in while scaling from slightly smaller to full size.
- Leaving reverses the same animation cleanly. Keyboard focus exposes the same affordance.
- Because the artwork is full-bleed, it does not use positional hover or click-pop transforms; moving or shrinking it would expose gaps along the card edge.
- Reduced Motion, Show Animations off, and Ultra Performance Mode remove the transition without removing the affordance.

### Reuse this pattern for

- Cover art, avatars, thumbnails, and other media that is itself the clickable replacement target.
- Cards where a permanent edit icon would cover important artwork or add visual clutter.
- Full-bleed media sitting beside text that benefits from subtle depth separation.

### Do not reuse it for

- Normal action buttons, navigation, dropdowns, or controls whose resting purpose is not visually obvious.
- Destructive replacement flows that require confirmation or explanatory copy.
- Tiny media where dimming would make the target difficult to recognize.

### Regression checklist

- Uploaded image and fallback artwork both fill the same clipping area.
- No gaps appear at rest, on hover, during click, or when focus leaves.
- The shadow never muddies or overlaps the identity text.
- The switch icon is centered on both axes and remains readable on bright and dark artwork.
- Long names and paths remain above the shadow and truncate safely.
- Mouse, keyboard, reduced-motion, disabled-animation, and Ultra Performance states all work.

## Sliding account dock with a stationary masked drawer

**Approved:** August 20, 2026  
**Current example:** The signed-in account control at the bottom of the sidebar.

### What makes it work

- The closed state is one compact account dock with a full-height, full-bleed avatar on the left, one vertically centered account name, and one disclosure chevron.
- It contains no redundant provider/status subtitle, presence ornament, or separate Settings gear.
- Opening translates only the real account dock upward. Downloads and Logs remain completely stationary underneath.
- The action drawer is already fixed at its final coordinates. It never translates or runs a separate slide animation.
- A clip mask reveals and conceals the stationary controls as the account dock moves, making the dock behave like a physical cover.
- While open, the dock becomes the raised identity platform and casts Bloom's restrained curved shadow over the darker recessed drawer.
- The drawer extends 14px behind the dock, filling beneath both rounded lower corners so the sidebar can never show through as black triangular gaps.
- Profile & Accounts and Client Settings remain concise icon rows. Log out is separated and uses restrained red semantics without unnecessary explanatory copy.
- Clicking the dock again, clicking outside, pressing Escape, or selecting an action closes the drawer and returns the dock to its exact resting position.
- The entire interaction respects Show Animations, Reduced Motion, and Ultra Performance Mode.

### Reuse this pattern for

- Bottom-anchored identity or utility drawers where surrounding navigation must not reflow.
- Small fixed action groups that should feel physically revealed rather than spawned as a detached popover.
- Interfaces where one existing card can naturally become the raised header of its expanded state.

### Do not reuse it for

- Long or dynamically sized menus that cannot use a predictable masked region.
- Menus that need to escape a constrained sidebar or remain open while navigating unrelated pages.
- Content whose controls need explanatory copy, independent scrolling, or complex nested navigation.

### Regression checklist

- Only the account dock changes screen position; every revealed control remains stationary.
- Downloads and Logs retain their exact layout coordinates while the drawer overlays them.
- The drawer fully underlaps both rounded lower corners at every animation frame.
- No separate cap, side strip, seam, or background cutout appears around the chevron or platform edges.
- The avatar fills the left square in both closed and open states.
- Closing works through the trigger, outside click, Escape, Profile, Settings, and Log out.
- Long account names, update-available state, compact sidebar width, every theme, and every animation mode remain usable.

## Reveal-on-hover sidebar section action

**Approved direction:** August 21, 2026  
**Current example:** The sidebar Instances heading.

### What makes it work

- The resting section remains quiet: only the centered uppercase section name is visible.
- Hovering or keyboard-focusing the section scales a compact rounded-square plus into the space left of the label while the label eases right.
- The plus is the only clickable creation target, keeping recent instance cards and the heading itself free of ambiguous behavior.
- The label and plus animate for 800ms with no color swap, glow, reflow, or movement in the instance list below.
- The reveal uses the selected accent sparingly and remains compatible with custom-background element darkness.

### Regression checklist

- `INSTANCES` is centered on both axes at rest and returns to the exact center after hover.
- Revealing the plus never changes the heading height or shifts any recent-instance card.
- The plus remains reachable by keyboard and opens the same real New Instance page.
- Hover-out eases smoothly, click-pop composes without jumping, and reduced-motion modes change state immediately.

## Account-dock-style sidebar empty action

**Approved direction:** August 21, 2026  
**Current example:** The empty Instances list.

### What makes it work

- The empty state is immediately actionable instead of explaining that it is empty.
- It reuses the account dock's familiar silhouette: a full-height left identity tile, one bold centered-height label, and one restrained chevron.
- The left tile uses the active accent sparingly around a real Lucide plus and casts only restrained black depth toward the label.
- The complete card opens New Instance, uses the standard configurable press motion, and has no redundant subtitle or dashed placeholder styling.

### Regression checklist

- The plus tile fills the complete top, bottom, and left edge at normal and compact sidebar widths.
- Label, plus, and chevron are each vertically centered; the label truncates before touching the chevron.
- Custom backgrounds, Element Darkness, themes, accents, keyboard focus, and reduced-motion modes remain coherent.

## Bare Spotlight launcher

**Approved:** August 21, 2026  
**Current example:** Spotlight Home.

### What makes it work

- The center contains only the selected instance's real artwork and bold identity, one wide Play action, and one slightly narrower selector stacked underneath.
- It removes the welcome eyebrow, marketing headline, helper sentence, duplicate version copy, and surrounding dashboard slab because none of them help the immediate launch decision.
- The Play action remains visually dominant while the selector is clearly related but secondary.
- Changing instances refreshes only the artwork and name. The controls stay fixed, so selection feels stable rather than rebuilding the page.
- The composition leaves generous empty space around a very small number of useful controls, producing a calm launcher rather than a dashboard.

### Reuse this pattern for

- High-frequency starting screens where one primary action and one choice cover the common path.
- Flows that have accumulated welcome copy, summaries, or decorative containers around an already-obvious task.

### Regression checklist

- Real and fallback artwork remain crisp and centered.
- Long names truncate without moving Play or the selector.
- Changing selection updates Play's target immediately and preserves the control stack's position.
- Empty-library state still routes clearly to New Instance.
- Every theme, custom background, animation mode, busy launch state, and minimum supported window size remains usable.
