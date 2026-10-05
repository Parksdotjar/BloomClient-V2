# Locker account integration

October 2026, codex/free-capes, BloomClient-Capes checkout.

## Sources and boundaries

Cloaks retains Bloom's existing cosmetics API and immutable cape IDs. Only visible labels changed. Capes and Skins use native commands and the saved active Minecraft account. The token never enters React or logs; a 401 attempts the existing refresh flow once. API methods were cross-checked against the maintained client implementation at https://github.com/Voxelum/minecraft-launcher-core-node/blob/master/packages/user/mojang.ts.

- GET /minecraft/profile: authenticated UUID, current skin, complete owned cape collection. Public session profiles are not ownership lists.
- PUT /minecraft/profile/capes/active with capeId, or DELETE to hide. Validate ownership before PUT.
- POST /minecraft/profile/skins: PNG multipart and classic/slim variant. Only explicit Use skin performs this write.
- Texture requests pin textures.minecraft.net, upgrade to HTTPS, reject redirects, and enforce a byte limit.
- Local skin imports live under BloomClient/locker-skins/<uuid>. They are bounded PNG inputs (64×64 or legacy 64×32 header); Minecraft performs final upload validation. File IDs are content hashes, never arbitrary user paths. No texture/credential database was added to the backend.
- Skin cards render once into cached PNGs, using one temporary renderer at a time. The detail panel remains the only continuous 3D preview.
- Official capes remain independent of Bloom cloaks. The Fabric renderer's existing Bloom-cloak priority is unchanged and the Capes detail panel explains it.

## Verification

Frontend typecheck and production build passed. Locked Cargo check passed; native input-validation unit test passed. No release, tag, version, secret, backend deployment or account appearance was changed during testing.

The browser-only frontend cannot mount without Tauri window metadata, so a browser screenshot is not a native-client acceptance test. Restart tauri dev in this checkout for new native commands.

## Remaining signed-in acceptance

1. Compare owned Capes against the account's Minecraft profile. Equip, unequip and refresh; verify the service saved the choice. Unequip a Bloom cloak when testing visibility of the official cape.
2. Import modern/legacy PNGs, cancel the picker, reject invalid dimensions, preview Classic/Slim and apply. Confirm the changed skin after a fresh Minecraft profile lookup and in game (profile caching may require reconnecting).
3. Switch accounts during load/save; ensure no old selection or success appears for the next account. Test expired login, network outage, no official capes and repeat refresh.
4. Check the header/shelf gap and skin card wrapping at the native default/minimum window widths; use keyboard arrows/Home/End across tabs. Confirm no hover lift.
