# Delight branding

Requested by Parks on November 17, 2026. The former Bloom brand is now Delight, to avoid confusion or affiliation with an unrelated hacked Minecraft client. Delight Client's purpose and features are unchanged.

The supplied `delightLogo.png` wing is used for interface artwork and native/mod icons. Desktop ICO files contain dedicated 16, 24, 32, 48, 64, 128 and 256 pixel layers. Original web artwork is `public/delight-logo.png`; the server's packaged icon is `src/main/resources/server-icon.png`.

Internal compatibility identifiers retain their historical spelling: application IDs, Cargo binary names, Java packages and mod IDs, credential services, storage keys and folders, existing source folder paths, emote project format, managed JAR filenames, service URLs and GitHub repository names. Do not rename these as a text-only branding change. Existing animation files still open; new animation filenames end in `.delight.json`.

For NSIS apps, `src-tauri/windows/installer.nsi` is the Tauri CLI 2.11.4 template with stable old product registry keys and target-checked shortcut renaming. It keeps existing install-location and upgrade detection while presenting the Delight product name. Upstream: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi (Apache-2.0 OR MIT). Review these small customizations when upgrading the CLI. Existing accounts, instances and reading state are not migrated or deleted.

No version, release tag, signing key, deployed service or historical release copy is changed by this local rebrand. Installed-build acceptance and production publication remain separate from source/build checks.
