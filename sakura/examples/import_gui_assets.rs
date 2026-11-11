//! Repeatable local resource import, also useful without starting a GPU/window.
//! cargo run --release --example import_gui_assets -- <26.1.jar> <external-cache>
#![allow(dead_code)]
#[path = "../src/assets.rs"]
mod assets;
#[path = "../src/gui_assets.rs"]
mod gui_assets;
#[path = "../src/mob_models.rs"]
mod mob_models;

fn main() -> Result<(), String> {
    let mut args = std::env::args_os().skip(1);
    let jar = std::path::PathBuf::from(
        args.next()
            .ok_or("Usage: import_gui_assets <26.1.jar> <external-cache> [--preview]")?,
    );
    let cache = std::path::PathBuf::from(args.next().ok_or("Missing external cache directory")?);
    let preview = args.next().is_some_and(|v| v == "--preview");
    let started = std::time::Instant::now();
    let pack = assets::load(&jar, &cache)?;
    let gui = &pack.gui;
    println!(
        "reference=Java26.1 elapsed_ms={} terrain_cache={} gui_cache={} sprites={} bitmap_glyphs={} item_icons={} animations={} unsupported_item_models={}",
        started.elapsed().as_millis(),
        pack.cache_hit,
        gui.cache_hit,
        gui.sprites.len(),
        gui.glyphs.len(),
        gui.items.len(),
        gui.animations.len(),
        gui.missing.len()
    );
    if preview {
        let atlas = image::RgbaImage::from_raw(gui.width, gui.height, gui.rgba.clone())
            .ok_or("Invalid atlas")?;
        let mut entries: Vec<_> = gui.items.iter().collect();
        entries.sort_by_key(|e| *e.0);
        let mut sheet = image::RgbaImage::from_pixel(
            32 * 16,
            32 * ((entries.len() + 15) / 16) as u32,
            image::Rgba([70, 70, 70, 255]),
        );
        for (i, (_, sprite)) in entries.into_iter().enumerate() {
            let icon =
                image::imageops::crop_imm(&atlas, sprite.x, sprite.y, sprite.width, sprite.height)
                    .to_image();
            image::imageops::overlay(
                &mut sheet,
                &icon,
                (i % 16 * 32) as i64,
                (i / 16 * 32) as i64,
            );
        }
        sheet
            .save(cache.join("item-preview.png"))
            .map_err(|e| e.to_string())?;
        use azalea_registry::Registry;
        let names = [
            "stone",
            "oak_stairs",
            "oak_fence",
            "diamond_sword",
            "white_bed",
            "red_bed",
            "white_shulker_box",
            "purple_shulker_box",
            "white_banner",
            "red_banner",
            "shield",
            "chest",
            "copper_chest",
            "skeleton_skull",
            "piglin_head",
            "dragon_head",
            "copper_golem_statue",
            "oxidized_copper_golem_statue",
            "decorated_pot",
            "conduit",
        ];
        let mut details =
            image::RgbaImage::from_pixel(4 * 96, 5 * 96, image::Rgba([70, 70, 70, 255]));
        for (i, name) in names.iter().enumerate() {
            let id = (0..8192).find(|id| {
                azalea_registry::builtin::ItemKind::from_u32(*id)
                    .is_some_and(|item| item.to_str().trim_start_matches("minecraft:") == *name)
            });
            if let Some(sprite) = id.and_then(|id| gui.items.get(&id)) {
                let icon = image::imageops::crop_imm(
                    &atlas,
                    sprite.x,
                    sprite.y,
                    sprite.width,
                    sprite.height,
                )
                .to_image();
                let icon =
                    image::imageops::resize(&icon, 64, 64, image::imageops::FilterType::Nearest);
                image::imageops::overlay(
                    &mut details,
                    &icon,
                    (i % 4 * 96 + 16) as i64,
                    (i / 4 * 96 + 16) as i64,
                );
            }
        }
        details
            .save(cache.join("special-item-preview.png"))
            .map_err(|e| e.to_string())?;
        std::fs::write(
            cache.join("special-item-preview-labels.txt"),
            names.join("\n"),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
