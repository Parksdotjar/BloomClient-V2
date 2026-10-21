# Locker Design Rules

These rules are specific to Bloom Client's Locker and must be read before changing its UI.

## Keep the Locker structural, not decorative

- Do not add decorative icons beside the centered `Locker` title. The header is intentionally just the title.
- Do not add wardrobe rails, clothes-rack lines, hooks, hangers, or other literal closet decoration behind cape cards.
- Do not add spotlight rings, halos, stages, pedestals, fake floors, or blurred floor shadows behind the player preview.
- Do not fill intentional empty space with ornaments, watermarks, gradients, ambient glows, or extra copy.
- Do not invent a visual motif merely because the layout feels sparse. Sparse space is preferable to decorative noise.

## What may change

### Three-category Locker (October 2026)

- Keep the existing centered title platform. A small darker shelf underlaps it and contains only Cloaks, Capes, Skins. Round the shelf's bottom corners; leave a real gap before the separate catalog box.
- Cloaks means Bloom's custom catalog. Capes means official Minecraft-owned capes, read from the authenticated account, not guessed from a public UUID profile. This naming is a product decision, not a legal conclusion.
- Skins starts with an Upload skin tile, then the current skin and account-local imports as angled mannequin thumbnails. No invented skin catalog. Keep one interactive preview to the side; thumbnails are cached static renders.
- Import saves locally; Use skin explicitly uploads to Minecraft. Offer Classic/Slim arms before applying. Never report success before Minecraft accepts the change.
- Official capes and Bloom cloaks are independent selections. Bloom's existing mod gives its cloak priority; state this when choosing an official cape rather than silently clearing either selection.

- Improve hierarchy through proportion, alignment, spacing, typography, and the active theme's surface levels (OLED Black or Light).
- Adjust cape-card size, grid density, preview scale, or panel proportions when the composition feels unbalanced.
- Keep the player preview floating cleanly on its existing flat surface and keep the centered title unadorned.
- Reuse existing Bloom controls and interaction behavior; avoid adding non-functional visual objects.

## Loading and refresh stability

- Hidden card actions stay fully hidden until hover or keyboard focus, including while disabled for account loading or saving. Disabled opacity must never override the resting reveal state and paint Equip/Unequip over the item name.
- Cached catalog contents have a valid selected preview immediately. Refresh keeps the selected item, confirmed equipped marker and an edited Classic/Slim choice when the item still exists. Imported skins use their recorded arm model; missing selections fall back to an available item and pagination clamps when a catalog shrinks.
- Show refresh progress on the existing refresh icon and prevent overlapping refresh/equip actions. Apply/equip indicators change only after the native operation succeeds.
- Card columns respond to the catalog's available width, not just the window width. Keep cards readable beside the preview; the preview keeps its own height and stays alongside long desktop grids rather than stretching with every row. The stacked compact layout scrolls normally.
- Hover/focus reveals respect reduced motion, Show Animations off and Ultra Performance. Keep these cases in `tests/locker-ui.mjs`.

## Rejected treatment

The October 2026 experiment that added a hanger/title lockup, a rail behind cape cards, a circular preview halo, and a fake floor shadow was rejected and fully reverted. Do not recreate or reinterpret that treatment.
