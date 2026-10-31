# Bloom player rig, version 1

Open `bloom-player-template.bbmodel` (classic arms) or `bloom-player-slim-template.bbmodel` (slim arms) in Blockbench. These use its built-in **Bedrock Entity** format. No plugin is required. The model is an authoring mannequin; Minecraft supplies the actual skin, armor, and outer layers.

Validated editor: Blockbench **5.2.2**, web edition, October 18, 2026. The Nod source opened with its geometry and six head keyframes, played in the preview, and exported through **Animation → Export Animations… → nod → Confirm**. That historical export was accepted by Bloom's validator; the starter samples have since been removed from the active catalog. Start new work from the blank templates. Runtime parser tests run against the separately pinned PAL versions for all four Minecraft targets.

## Skeleton

All six model bones are direct children of the `body` root. Never change names or pivots. Units are model pixels (16 per block).

| Bone | Pivot X, Y, Z | Purpose |
| --- | --- | --- |
| body | 0, 12, 0 | Visual whole-body offset/rotation |
| torso | 0, 24, 0 | Torso model part |
| head | 0, 24, 0 | Head and skin overlay |
| right_arm | 5, 22, 0 | Whole right arm |
| left_arm | -5, 22, 0 | Whole left arm |
| right_leg | 2, 12, 0 | Whole right leg |
| left_leg | -2, 12, 0 | Whole left leg |

Classic/slim preview models share these bone names and pivots. Slim preview arm cubes are three pixels wide. Do not add elbows, fingers, cameras, or preview geometry to the animation tracks.

## Supported export

- Animate bones with numeric **rotation** and **position** keyframes.
- Use **Linear** interpolation in the standard editor. Optional GeckoLib exports with numeric `vector` frames and Linear/Sine easing are also accepted and parser-tested; GeckoLib is not required for the supplied files.
- Exactly one named animation per JSON file, length 0.1–30 seconds. Maximum 4,096 keyframes and 256 KiB per exported animation.
- Body rotation components support unwrapped full turns within ±720 degrees; the other six bones stay within ±180 degrees. Position components stay within ±12 pixels. A backflip runs Body X continuously from 0 to 360; do not wrap 180 to -180 or animate it back to 0 at the end.
- Use Once, Loop, or Hold. Their metadata values are `once`, `loop`, and `hold`.
- No expressions, effects, scripts, scale, Catmull-Rom, Bezier, custom skeletons, or external asset paths in this first version. Validation rejects unsupported exports before packaging.

Blockbench's exporter flips X/Y rotation and X position from editor coordinates. Work normally in the editor; do not negate values in the exported JSON. For the previously tested Nod sample, editor X was **-15°** at 0.3 and 0.9 seconds and the exported X was +15°. Creator round-trip tests check the same coordinate mapping.

The `body` bone moves the rendered model only. It never changes position, physics, or the player's hitbox. Keep motions small and stationary.

## Source and license

The mannequin geometry was authored for Bloom. The nine original starter animations have been retired. No commercial emote files or GPL Emotecraft project/template are included. Pivot values follow PAL's `HumanoidAnimationController.BONE_POSITIONS` contract. PAL and its runtime dependency notices are included under the mod's `META-INF/licenses/`; upstream library license terms still apply to those libraries.

The main authoring guide is [BLOOM_EMOTES_AUTHORING.md](../../BLOOM_EMOTES_AUTHORING.md).
