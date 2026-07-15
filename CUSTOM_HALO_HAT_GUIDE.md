# Creating a Custom Halo Hat for Bloom Client

This guide covers the complete workflow for making a static 3D halo in Blockbench, previewing it in Bloom Cosmetics Manager, publishing it to the live catalog, and testing it in Minecraft.

It is written for Bloom Cosmetics on Fabric 1.21.11 and matches Bloom's current model importer.

## What you will create

You will finish with two matching files:

- `your-halo.bbmodel` — the cuboid model and UV layout.
- `your-halo.png` — the one texture used by every cube in the model.

Bloom Cosmetics Manager accepts `.bbmodel` and compatible exported `.json` files. Use `.bbmodel` unless you have a specific reason not to; it preserves the Blockbench project data Bloom needs and avoids Minecraft Java JSON texture-coordinate quirks.

## Important Bloom limitations

Read these before modeling:

- Use **cubes only**. Bloom currently does not import mesh elements, curves, toruses, locators, particles, or animations.
- A model can contain at most **512 cubes**.
- The model file must be valid UTF-8 JSON and smaller than **2 MB**.
- Use exactly **one PNG texture** for the whole halo.
- The PNG must be smaller than **8 MB**.
- The PNG dimensions must exactly match the Blockbench project texture resolution.
- Supported texture dimensions are from `1×1` through `4096×4096`; `64×64` is recommended.
- Transparency works. Emissive lighting and animated textures are not supported yet.
- Groups are useful for organization inside Blockbench, but Bloom currently imports the cubes themselves rather than group animation behavior.

## 1. Create the Blockbench project

1. Open the Blockbench desktop app.
2. Select **File → New → Generic Model**.
3. Use these project settings:

| Setting | Recommended value |
| --- | --- |
| Project name | `bloom_halo` |
| Model format | Generic Model |
| Texture width | `64` |
| Texture height | `64` |
| UV mode | Per-face UV / Box UV disabled |

4. Create the project.
5. Save immediately using **File → Save Project As** and name it `bloom_halo.bbmodel`.

Why Generic Model: it supports unrestricted cube sizing, individual cube rotation, per-face UV mapping, and `.bbmodel` project files. Those are the parts Bloom's importer uses.

## 2. Understand Bloom's hat coordinate system

Use this orientation while modeling:

| Axis | Meaning in Bloom |
| --- | --- |
| X | Left and right |
| Y | Vertical position |
| Z | Front and back |

Bloom performs two automatic corrections when the model is loaded:

1. It centers the complete model on X and Z.
2. It places the model's lowest point on top of the player's head.

This means empty vertical space below the halo in Blockbench will **not** create an in-game hovering gap. Bloom removes that empty space while anchoring the model. You create the final gap later with the **Y offset** in Cosmetics Manager.

### Optional reference head

You can temporarily create an `8×8×8` cube centered on X and Z to judge the halo's width against a Minecraft head.

Name it:

`REFERENCE_HEAD_DELETE_BEFORE_EXPORT`

Delete this cube before saving the final model. Bloom imports every cube element, so a forgotten reference head would become part of the cosmetic.

## 3. Build a reliable segmented halo

Do not use Blockbench's mesh or torus tools. Build the ring from cuboids.

### Recommended proportions

- Outer diameter: approximately `10–12` Blockbench units.
- Segment thickness: approximately `0.75–1.25` units.
- Segment height: approximately `0.5–1` unit.
- Segment count: `8` for a rounded pixel halo or `4` for a square halo.

A Minecraft head is 8 units wide, so a 10–12 unit halo leaves a visible margin around it.

### Eight-segment method

1. Add one cube.
2. Resize it to approximately:

   - X size: `3.5–4`
   - Y size: `0.75`
   - Z size: `0.75`

3. Place it at the front of the ring, centered on X.
4. Keep its pivot in the center of the cube.
5. Duplicate the segment seven times with `Ctrl+D`.
6. Arrange the eight segment centers around X=`0`, Z=`0`.
7. Rotate the diagonal segments around Y by `45°` or `-45°` so every piece follows the ring.
8. Inspect the ring from the top view and close any visible gaps.
9. Select every halo segment and place them in a group named `halo` for organization.

The group name does not affect Minecraft. It simply keeps the project clean.

### Cleaner symmetry

Model one half first, duplicate it, and use Blockbench's X-axis Flip feature for the opposite half. This keeps both sides symmetrical. Check the UV layout after flipping so text or one-sided details do not become unintentionally mirrored.

## 4. Set pivots and rotations correctly

For a static halo, each segment's pivot should normally stay at that segment's center.

- Select a cube.
- Choose the **Pivot Tool**.
- Center the pivot on that cube.
- Apply rotation after the pivot is correct.

Do not place every cube's pivot at a random shared point unless you intentionally want the geometry to swing around that point. Incorrect pivots are a common reason models look right in Blockbench but shift after conversion.

Bloom supports individual cube rotations. It does not currently apply Blockbench animations or animated group transforms.

## 5. Create the texture

1. Open the **Textures** panel.
2. Select **Create Texture**.
3. Use:

   - Width: `64`
   - Height: `64`
   - Background: transparent

4. Name the texture `bloom_halo`.
5. Assign this one texture to every halo cube.
6. Select all halo cubes.
7. In the UV editor, use per-face UV mapping and run **Auto UV** as a starting point.
8. Check that no face UVs overlap unless you intentionally want those faces to share pixels.
9. Switch to Paint mode and paint the halo.

### Texture recommendations

- Use hard pixel edges rather than antialiasing.
- Keep transparent pixels fully transparent.
- Use one pixel per model unit when practical for a Minecraft-style result.
- Give visible side, top, and bottom faces intentional colors; do not paint only the top face.
- Avoid multiple textures. Cosmetics Manager asks for one PNG and expects all UVs to reference that image.

## 6. Verify the model in Blockbench

Before saving, check all of the following:

- The halo is centered on X and Z.
- It is level when viewed from the front and side.
- The left and right halves are symmetrical.
- Every visible piece is a cube, not a mesh.
- All cubes use the same texture.
- No face displays the missing-texture pattern.
- Transparent areas look transparent.
- There is no accidental reference-head cube.
- There are no overlapping faces flickering from Z-fighting.

If two surfaces flicker, move one by about `0.1–0.25` units or slightly change its thickness.

## 7. Save the two files Bloom needs

### Save the model

Use **File → Save Project** or **File → Save Project As**.

Your model should be:

`bloom_halo.bbmodel`

Do **not** export OBJ, FBX, glTF, or an image of the model. Bloom's current cosmetic pipeline does not import those formats.

### Save the texture

In the Textures panel, save/export the active texture as:

`bloom_halo.png`

Confirm that the exported PNG is exactly `64×64`, matching the project.

Keep the `.bbmodel` and `.png` together in the same folder so you do not accidentally select a texture from a different revision.

## 8. Load the halo into Bloom Cosmetics Manager

1. Open **Bloom Cosmetics Manager**.
2. Open **3D Hats**.
3. Select **New hat**.
4. Under **Choose Blockbench model**, select `bloom_halo.bbmodel`.
5. Under **Choose texture**, select `bloom_halo.png`.
6. Wait for the gray mannequin preview to appear.
7. Drag the preview to inspect the front, back, sides, and top.
8. Use the lock button if you want to stop automatic rotation while adjusting placement.

If the Publish button remains unavailable, verify that:

- Both files are selected.
- The model and PNG dimensions match.
- The title, slug, and collection are filled in.
- The live preview finished generating.

## 9. Position the halo

Start with these values:

| Control | Starting value | Effect |
| --- | ---: | --- |
| X offset | `0` | Moves left/right |
| Y offset | `-4` | Raises the halo approximately 4 model pixels above the head |
| Z offset | `0` | Keeps it centered front-to-back |
| Scale | `1` | Uses the modeled size |

Bloom's offset behavior:

- Negative Y raises the halo.
- Positive Y lowers the halo toward the face.
- Negative Z moves it toward the front/face.
- Positive Z moves it toward the back of the head.
- X moves it sideways.

Use the live mannequin as the source of truth. Small adjustments such as `-3.5` are allowed.

### Recommended halo placement workflow

1. Set X=`0`, Z=`0`, Scale=`1`.
2. Start Y at `-4`.
3. Lock preview rotation.
4. View the mannequin from the side.
5. Adjust Y until there is a clean gap above the head.
6. Rotate to the front and confirm the halo remains centered.
7. Adjust scale only after the position is correct.

## 10. Fill in catalog information

Example values:

| Field | Example |
| --- | --- |
| Title | `Bloom Halo` |
| Slug | `bloom-halo` |
| Collection | `Bloom Collection` |

Slug rules:

- Use lowercase letters and numbers.
- Separate words with hyphens.
- Do not use spaces.
- Treat the slug as a permanent hidden identifier.

### Helmet behavior

For a floating halo, **Hide under helmets** should normally be off so the halo remains visible while armor is equipped. Turn it on only if your design intersects helmets and looks broken with them.

### Publishing behavior

- Leave **Publish immediately** off while the model is unfinished.
- Turn it on only after the preview, placement, scale, and metadata are correct.
- Published cosmetics become available to connected Bloom clients without shipping a launcher update.

## 11. Publish and test in Minecraft

1. Click **Publish hat to Bloom**.
2. Open Bloom Client.
3. Go to **Shop → Hats**.
4. Add the halo to your collection.
5. Open **Equipped** and equip the halo.
6. Launch a supported Fabric 1.21.11 instance containing Bloom Cosmetics.
7. Enter third-person view and inspect the halo from every direction.

Equipped cosmetics normally refresh live within a few seconds. If this is the first time the model was added to the instance, restart Minecraft once to ensure the current bundled cosmetics mod is loaded.

## Troubleshooting

### Cosmetics Manager says the model has no cubes

The project contains meshes or unsupported elements instead of cube elements. Rebuild the visible geometry using Blockbench cubes.

### The texture is scrambled

- Confirm the selected PNG belongs to the selected `.bbmodel`.
- Confirm the PNG dimensions exactly match the Blockbench texture resolution.
- Use one texture only.
- Recheck per-face UVs in Blockbench.
- Save the native `.bbmodel` rather than exporting through an unrelated format.

Do not compensate for incorrect UV mapping with random texture-offset edits. Fix the source UV rectangles so Blockbench, Cosmetics Manager, Shop cards, and Minecraft all use the same mapping.

### The halo sits directly on the head

This is expected before offsets because Bloom anchors the model's lowest point to the top of the head. Set Y offset to a negative value such as `-3`, `-4`, or `-5`.

### The halo is above the face instead of centered

Set X and Z back to `0`, then inspect the model's shape. Bloom centers the complete X/Z bounding box, so an asymmetrical decoration can shift the visual center. Correct it with a small X or Z offset.

### The halo is too large or too small

Keep the model unchanged and adjust Scale in Cosmetics Manager. Start near `1`; common corrections are `0.8`, `0.9`, `1.1`, or `1.2`.

### The halo clips into a helmet

Raise it using a more negative Y offset, reduce its scale, or enable **Hide under helmets**.

### The halo flickers

Two faces occupy the same position. Move one surface by `0.1–0.25` units or alter its thickness to remove Z-fighting.

### It appears in Manager but not in Minecraft

- Confirm the hat is published, owned, and equipped.
- Confirm the instance uses Fabric 1.21.11.
- Confirm `bloom-cosmetics-1.21.11.jar` exists in the instance's `mods` folder.
- Fully restart Minecraft after replacing the cosmetics JAR.
- Wait several seconds for the live assignment refresh.

## Final checklist

- [ ] Generic Model project
- [ ] Cubes only
- [ ] No more than 512 cubes
- [ ] One PNG texture
- [ ] `.bbmodel` and PNG resolutions match
- [ ] Halo centered on X/Z
- [ ] Reference head deleted
- [ ] UVs checked on every visible face
- [ ] `.bbmodel` smaller than 2 MB
- [ ] PNG smaller than 8 MB
- [ ] Manager preview correct from every angle
- [ ] Negative Y offset creates the hovering gap
- [ ] Title, slug, and collection are correct
- [ ] Helmet behavior selected intentionally
- [ ] Tested in Fabric 1.21.11

## Official Blockbench references

- [Blockbench format features](https://www.blockbench.net/wiki/blockbench/formats/)
- [Blockbench overview, pivots, transforms, and UV tools](https://www.blockbench.net/wiki/guides/blockbench-overview-tips/)
- [The `.bbmodel` format](https://www.blockbench.net/wiki/docs/bbmodel/)
- [Minecraft modeling style guidance](https://www.blockbench.net/wiki/guides/minecraft-style-guide/)

