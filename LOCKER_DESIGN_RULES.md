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

- Improve hierarchy through proportion, alignment, spacing, typography, and the existing OLED surface levels.
- Adjust cape-card size, grid density, preview scale, or panel proportions when the composition feels unbalanced.
- Keep the player preview floating cleanly on its existing flat surface and keep the centered title unadorned.
- Reuse existing Bloom controls and interaction behavior; avoid adding non-functional visual objects.

## Rejected treatment

The October 2026 experiment that added a hanger/title lockup, a rail behind cape cards, a circular preview halo, and a fake floor shadow was rejected and fully reverted. Do not recreate or reinterpret that treatment.
