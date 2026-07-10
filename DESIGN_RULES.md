# Bloom Client Design Rules

These rules apply to every future screen, component, and interaction in Bloom Client.

## Visual language

- Use the existing dark Bloom Client visual system: layered charcoal surfaces, soft borders, restrained shadows, and the active accent color.
- Use Lucide icons consistently. Do not introduce text-symbol icons, emoji, or mixed icon families.
- Keep controls slightly rounded, compact, and intentional. Avoid browser-default controls.
- Every green highlight must use the shared `--accent` variable so themes and accent choices remain coherent.
- Themes must be complete surface systems. Adding or changing a theme must update the page background, sidebar, content panels, settings cards, controls, ad rail, borders, muted text, active states, hover states, and scrollbars together.
- OLED Dark should use true-black outer surfaces with slightly lifted dark-gray panels and sidebar surfaces so hierarchy remains visible.
- Dusk should use coordinated blue-gray surfaces across every client region, not only the main content background.
- Use clear visual hierarchy: page title, section title, helper text, then the control.

## Layout

- The left sidebar is viewport-locked. Its navigation, downloads, logs, and account area must not move when the main page gets taller.
- Only the main content pane scrolls. Long pages must never increase the sidebar height or create a page-level scrollbar.
- Keep navigation icons and labels aligned on one consistent grid.
- Use the same spacing rhythm and card treatment across settings, home, and future screens.

## Borders and separators

- Never use bright white borders, focus rings, dividers, or selection outlines.
- Structural horizontal and vertical separators use the theme's low-contrast border token, only slightly lighter than the surrounding surface.
- Selected outlines use a dark, muted mix of the active accent color and the theme border—not the full-strength accent and never white.
- Focus-visible states use a restrained translucent accent ring so keyboard navigation remains clear without introducing bright lines.

## Controls and interaction

- Never use native browser dropdown menus. Use the Bloom custom dropdown component so the open menu matches the client.
- Toggles must follow standard semantics: off is gray with the thumb left; on is accent-colored with the thumb right.
- Every toggle must be backed by real state and an `onChange` handler before it is added to the UI. Never ship a hardcoded toggle with a no-op handler.
- Interactive controls need hover, focus, and pressed states.
- Use Anime.js for purposeful UI motion, including toggle thumb movement and subtle state transitions. Respect the Show Animations setting.
- Do not expose browser context menus or browser-looking actions inside the client.
- File imports must use a clearly labeled accent-colored action and report genuine native progress through Downloads; never simulate import progress.

## Large collections

- Content libraries such as mods, resource packs, and shaders show at most 20 entries per page.
- Search, sorting, and filters apply before pagination, and changing any of them returns the user to page one.
- Pagination controls use Bloom's custom button styling and remain theme- and accent-aware.
- Provider catalogs must filter by the instance's exact Minecraft version and loader before showing an install action.
- Catalog installation uses the accent-filled plus action, reports genuine byte progress through Downloads, and returns to the installed list through an accent-filled close action.
- Instance collection search and filters live in a taller, narrower floating surface overlapping the collection's bottom edge by roughly half its height; its icon, text, and filter scale together, and pagination sits beneath it while the list scrolls independently.

## Scrollbars

- Every scrollable surface gets the custom Bloom scrollbar styling.
- Scrollbars should be narrow, dark, rounded, and use the accent color only on the thumb hover state.
- Do not allow nested scrollbars unless the nested area has a clear independent purpose.

## Implementation checklist

- Test the screen at a short viewport and a tall viewport.
- Verify the sidebar stays fixed while the content scrolls.
- Verify theme and accent changes affect every intended highlight.
- Verify dropdowns, toggles, and inputs work without browser-default UI.
- Run `npm run typecheck` and `npm run build` before committing.
