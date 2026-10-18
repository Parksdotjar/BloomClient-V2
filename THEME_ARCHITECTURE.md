# Bloom themes

Appearance offers OLED Black (the existing default) and Light through one ordinary theme selector. The existing `bloom-settings.theme` stores `oled` or `light`; retired/invalid theme values, including `charcoal`, migrate to OLED. The retired `finish` preference is removed when loading settings. The document applies the saved theme before loading the app so Light does not begin with a black first frame. React keeps the CSS color scheme, native window appearance/background, and theme-color metadata synchronized. Only window theme/background permissions are needed. The native window remains opaque, with no Frosted mode or desktop transparency.

## Color contract

`src/themes/light.css` defines the complete Light palette. Existing UI declarations use `var(--theme-…, original-color)`: OLED keeps the exact original fallback, while Light supplies semantic values. The original surface variables (`--page`, `--panel`, `--control`, `--text`, `--muted`, borders, rail, and scrollbars) remain the shared primary contract.

- Base, surface, inset, and raised tokens cover page backgrounds and depth levels.
- Ink/muted ink cover black text and secondary copy. Accent text uses `--accent-ink`, a readable foreground derived from the chosen accent; accent fills keep the user's real color.
- Success, danger, warning, info, and violet surface/ink pairs preserve semantic status and contrast.
- Edge, wash, glass, and overlay tokens cover boundaries, hover treatments, transparency, and modal backdrops.
- Slate shadow tokens use 9%/4.5% opacity instead of reusing opaque OLED black. Highlight edges remain separate from depth shadows. Shadow lengths/layout do not change between themes.

Tokens live on the document root so menus, color pickers, tooltips, and dialogs portaled outside the app shell receive the same palette. Custom image/organic artwork is unchanged; existing opacity/frost settings mix neutral surfaces with the theme's light canvas. Default custom-sidebar text follows theme changes; user-picked ink remains a user preference.

## Pixel colors versus UI colors

Never invert or recolor screenshots, capes, skins, user-uploaded identity artwork, the HSV saturation/hue spectrum, or organic artwork to create a theme. Those are content. Built-in monochrome Bloom identity marks may switch to dark in Light for contrast.

Screenshot comparison changes its empty canvas, A/B badges, divider, and handle to Light. Export snapshots that actual background/divider color along with the current split and source ordering. Source pixels stay unchanged, and the 1920px export boundary is unchanged.

## Coverage and validation

`npm run test:theme` walks the main stylesheet and every component stylesheet, checks semantic token definitions, and rejects raw UI color literals outside theme-specific rules. Exceptions are limited to artwork/color spectra and explicitly themed comparison overlays. Native window appearance updates only when the theme changes, not on every slider/input update.

Visually review Home/library, instance content and overflow/filter/detail surfaces, all Settings sections, account/window menus, Social/messages/friends/encryption/group drawers, sharing/access dialogs, Locker/wardrobe, Utilities/Sync/AutoTune, screenshot viewers/comparison, downloads/logs, onboarding, and update/error states. Include portaled overlays, theme switching/reload, the minimum supported window size, custom backgrounds, reduced motion, and OLED fallback. Native/live-account behavior must be distinguished from isolated browser fixtures in handoffs.

Foregrounds on solid accents use `--theme-on-accent`, separate from ordinary ink. The theme audit validates the Light token set and text/status contrast. Existing Image/Organic background controls remain independent of the two themes and never reveal the desktop.
