# Locker Design Rules

These rules are specific to Bloom Client's Locker and must be read before changing its UI.

## Keep the Locker structural, not decorative

- The main platform contains one centered Shop / Locker switch. A functional Redeem code action may sit at the header's right edge. Do not add decorative icons or a second title bar.
- Do not add wardrobe rails, clothes-rack lines, hooks, hangers, or other literal closet decoration behind cape cards.
- Do not add spotlight rings, halos, stages, pedestals, fake floors, or blurred floor shadows behind the player preview.
- Do not fill intentional empty space with ornaments, watermarks, gradients, ambient glows, or extra copy.
- Do not invent a visual motif merely because the layout feels sparse. Sparse space is preferable to decorative noise.

## What may change

### Free Shop and owned Locker (October 2026)

- Shop and Locker are the only main tabs. Shop opens with one large featured cloak and a scrolling catalog of free items. Add to Locker saves ownership through the backend without equipping or switching views. In Locker opens the collected item for preview/equip.
- Locker shows only collected or code-redeemed Bloom cloaks. Keep Cloaks / Capes / Skins as compact category controls inside its collection heading, including empty/loading states. This replaces the old full-width category shelf and avoids two stacked top bars. The sidebar and normal buttons retain their existing appearance.
- Cloaks means Bloom's custom cosmetics. Capes means official Minecraft-owned capes, read from the authenticated account, not guessed from a public UUID profile. This naming is a product decision, not a legal conclusion.
- Shop availability and account ownership are separate. Ending a drop removes it from Shop while existing owners retain it. Code-only cosmetics remain out of the public Shop. Archive is a stronger action that disables the cosmetic for everyone until restored.
- Shop uses a responsive scrolling grid; owned Locker keeps its existing paginated collection and one account-aware preview. Do not render a WebGL player per Shop card or duplicate the full preview in every tile.
- Feature selection and drop availability come from Bloom Admin. Claims require a signed-in Minecraft account, persist on the server, and become visually owned only after success. Cached/offline browsing must not pretend to save ownership. No prices, cart, payment flow, invented scarcity or fake products.
- Skins starts with an Upload skin tile, then the current skin and account-local imports as angled mannequin thumbnails. No invented skin catalog. Keep one interactive preview to the side; thumbnails are cached static renders.
- Import saves locally; Use skin explicitly uploads to Minecraft. Offer Classic/Slim arms before applying. Never report success before Minecraft accepts the change.
- Official capes and Bloom cloaks are independent selections. Bloom's existing mod gives its cloak priority; state this when choosing an official cape rather than silently clearing either selection.

- Improve hierarchy through proportion, alignment, spacing, typography, and the active theme's surface levels (OLED Black or Light).
- Adjust cape-card size, grid density, preview scale, or panel proportions when the composition feels unbalanced.
- Keep the player preview floating cleanly on its existing flat surface and the main navigation centered.
- Reuse existing Bloom controls and interaction behavior; avoid adding non-functional visual objects.
- Code redemption uses one attached input area under the main platform, with equal visible vertical margins around the field. No introductory tagline above the input. Keep sign-in guidance in the disabled input placeholder and preserve accessible labels. Successful redemption opens the claimed cloak in Locker; reuse the existing bottom notification.

## Loading and refresh stability

- Hidden card actions stay fully hidden until hover or keyboard focus, including while disabled for account loading or saving. Disabled opacity must never override the resting reveal state and paint Equip/Unequip over the item name.
- Cached catalog contents have a valid selected preview immediately. Refresh keeps the selected item, confirmed equipped marker and an edited Classic/Slim choice when the item still exists. Imported skins use their recorded arm model; missing selections fall back to an available item and pagination clamps when a catalog shrinks.
- Show refresh progress on the existing refresh icon and prevent overlapping refresh/equip actions. Apply/equip indicators change only after the native operation succeeds.
- Card columns respond to the catalog's available width, not just the window width. Keep cards readable beside the preview; the preview keeps its own height and stays alongside long desktop grids rather than stretching with every row. The stacked compact layout scrolls normally.
- Hover/focus reveals respect reduced motion, Show Animations off and Ultra Performance. Keep these cases in `tests/locker-ui.mjs`.

## Rejected treatment

The October 2026 experiment that added a hanger/title lockup, a rail behind cape cards, a circular preview halo, and a fake floor shadow was rejected and fully reverted. Do not recreate or reinterpret that treatment.
