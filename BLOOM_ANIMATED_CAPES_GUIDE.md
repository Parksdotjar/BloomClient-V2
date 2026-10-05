# Bloom Animated Capes Guide

> Current Studio: `C:/Users/Parks/Documents/Bloom-Cape-Studio`. In addition to the limits below, decoded animation frames must fit 32 MiB. Publication requires the configured owner account and reachable backend. Automatic injection exists in the gated integration branch, not the currently running main client. See `CAPES_IMPLEMENTATION_STATUS.md` before treating this guide as production behavior.

Bloom's animated-cape pipeline turns a short MP4, WebM, or GIF into a normal Minecraft cape texture plus a private animation atlas. The first frame remains a regular static cape, so older Bloom Cosmetics versions still show a valid fallback.

## Recommended source

- Export an H.264 MP4 from After Effects for the most reliable quality and file size.
- Use a 2:1 composition such as 1920x960 or 2048x1024.
- Keep the important artwork away from the extreme edges so the side wrapping has room.
- Make the first and last frames flow together if the cape should loop seamlessly.
- Do not include audio; Bloom only samples video frames.

## Recommended Bloom settings

For most capes, start with:

- Frame resolution: **512x256**
- Playback speed: **12-16 FPS**
- Duration: **2-4 seconds**
- Animated elytra: enable it only when the cosmetic should animate while gliding

Higher resolution, FPS, and duration all increase atlas size and Minecraft texture memory. Bloom limits an animation to 120 frames and a 4096x4096 atlas so a single cosmetic cannot grow without bounds.

## Create and publish an animated cape

1. Open **Bloom Cosmetics Manager**.
2. Select **Animated Capes** in the left navigation.
3. Click **Choose animation** and select an MP4, WebM, or GIF.
4. Use **Front**, **Back**, and **Elytra** to position the source for each part of the Minecraft texture.
5. Adjust **Crop zoom** until the artwork fills each face correctly.
6. Choose the frame resolution, playback FPS, and clip duration.
7. Click **Use this cape**. Bloom decodes and maps every sampled frame locally.
8. Review the static fallback frame, enter the title, slug, and collection, then click **Publish to Bloom**.

The published shop preview uses frame one. The complete atlas is stored separately in Bloom's private cape storage.

## How Minecraft plays it

Bloom Cosmetics downloads the animation atlas once for each texture revision, splits it into registered Minecraft textures, and advances frames from the local game clock. It does not request a new image for every frame. If the atlas cannot load, the mod automatically uses the static first frame instead.

The launcher auto-injects the current Bloom Cosmetics JAR into supported Fabric 1.21.11 instances and replaces older `bloom-cosmetics-*.jar` files during launch.

## Making an animated Bloom-logo cape in After Effects

1. Create a 2:1 composition, preferably 1920x960.
2. Place the Bloom logo in the center with enough padding for cape edges.
3. Animate a clean loop, such as a slow petal pulse, shimmer, or rotation.
4. Keep the loop around 2-3 seconds.
5. Export H.264 MP4 with no audio.
6. Import it into **Animated Capes**, begin at 512x256 and 15 FPS, and inspect the generated preview before publishing.

## Troubleshooting

- **The animation feels choppy:** raise FPS slightly, but keep it under 20 unless the motion truly needs more.
- **The atlas limit is reached:** shorten the clip, lower FPS, or lower the frame resolution.
- **The seam is obvious:** adjust the Front and Back crops and keep edge pixels visually similar.
- **The cape is static in game:** relaunch through the updated Bloom Client so Cosmetics 1.5.0 is synchronized into the instance.
- **An older client is used:** it will safely display frame one as a static cape.
