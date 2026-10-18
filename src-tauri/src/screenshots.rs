use std::{path::{Path, PathBuf}, time::UNIX_EPOCH};
use base64::Engine;

fn comparison_png(png: &str) -> Result<Vec<u8>, String> {
    if png.len() > 48 * 1024 * 1024 { return Err("Comparison export is too large.".into()); }
    let encoded = png.strip_prefix("data:image/png;base64,").ok_or("Comparison must be a PNG image.")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "Comparison PNG is invalid.")?;
    let reader = image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Png);
    let (width, height) = reader.into_dimensions().map_err(|_| "Comparison PNG is invalid.")?;
    if width == 0 || height == 0 || width > 1920 || height > 1920 { return Err("Comparison export exceeds 1920 pixels.".into()); }
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).map_err(|_| "Comparison PNG is damaged.")?;
    Ok(bytes)
}

#[tauri::command]
pub async fn save_screenshot_comparison(png: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = comparison_png(&png)?;
        let Some(path) = rfd::FileDialog::new().set_title("Export comparison").add_filter("PNG image", &["png"]).set_file_name("Bloom-comparison.png").save_file() else { return Ok(false); };
        if !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("png")) { return Err("Choose a filename ending in .png.".into()); }
        std::fs::write(path, bytes).map_err(|error| format!("The comparison could not be saved: {error}"))?;
        Ok(true)
    }).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod export_tests {
    use super::*;
    fn png(width: u32, height: u32) -> (Vec<u8>, String) {
        let image = image::RgbaImage::new(width, height);
        let mut output = std::io::Cursor::new(Vec::new());
        image.write_to(&mut output, image::ImageFormat::Png).unwrap();
        let bytes = output.into_inner();
        let data = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
        (bytes, data)
    }
    #[test]
    fn exported_png_is_preserved_and_invalid_or_oversized_inputs_are_rejected() {
        let (bytes, data) = png(32, 16);
        assert_eq!(comparison_png(&data).unwrap(), bytes);
        assert!(comparison_png("data:image/jpeg;base64,AAAA").is_err());
        assert!(comparison_png("data:image/png;base64,???").is_err());
        assert!(comparison_png("data:image/png;base64,AAAA").is_err());
        assert!(comparison_png(&png(1921, 1).1).is_err());
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot { instance_id: String, instance_name: String, name: String, modified: u64, revision: String }
#[derive(serde::Serialize)]
pub struct Shelf { items: Vec<Screenshot>, warnings: Vec<String> }
fn folder(id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.contains(['/', '\\', ':']) || id == "." || id == ".." { return Err("Invalid instance ID.".into()); }
    let instance = super::load_instance(id)?;
    let root = PathBuf::from(instance.directory).canonicalize().map_err(|e| e.to_string())?;
    let path = root.join("screenshots").canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&root) { return Err("Screenshot folder is outside this instance.".into()); }
    Ok(path)
}
fn revision(path: &Path, metadata: &std::fs::Metadata) -> String {
    use sha2::{Digest, Sha256};
    let modified = metadata.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}", Sha256::digest(format!("{}:{}:{modified}", path.to_string_lossy(), metadata.len()).as_bytes()))
}
fn supported(path: &Path) -> bool { matches!(path.extension().and_then(|v| v.to_str()).unwrap_or("").to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "webp") }
fn resolve(id: &str, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." { return Err("Invalid screenshot name.".into()); }
    let root = folder(id)?;
    let path = root.join(name).canonicalize().map_err(|e| e.to_string())?;
    if path.parent() != Some(root.as_path()) || !supported(&path) || !path.is_file() { return Err("Invalid screenshot.".into()); }
    Ok(path)
}
#[tauri::command]
pub async fn list_screenshots() -> Result<Shelf, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut shelf = Shelf { items: vec![], warnings: vec![] };
        for instance in super::list_instances_blocking()? {
            if !Path::new(&instance.directory).join("screenshots").exists() { continue; }
            let entries = match folder(&instance.id).and_then(|p| std::fs::read_dir(p).map_err(|e| e.to_string())) { Ok(v) => v, Err(e) => { shelf.warnings.push(format!("{}: {e}", instance.name)); continue; } };
            for entry in entries {
                let entry = match entry { Ok(e) => e, Err(e) => { shelf.warnings.push(e.to_string()); continue; } };
                if !supported(&entry.path()) || !entry.file_type().map(|t| t.is_file()).unwrap_or(false) { continue; }
                let metadata = match entry.metadata() { Ok(value) => value, Err(_) => continue };
                let revision = revision(&entry.path(), &metadata);
                let modified = metadata.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
                shelf.items.push(Screenshot { instance_id: instance.id.clone(), instance_name: instance.name.clone(), name: entry.file_name().to_string_lossy().into_owned(), modified, revision });
            }
        }
        shelf.items.sort_by(|a,b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
        Ok(shelf)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn screenshot_action(instance_id: String, name: String, action: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve(&instance_id, &name)?;
        if action == "folder" { tauri_plugin_opener::open_path(path.parent().ok_or("Missing folder")?, None::<&str>).map_err(|e| e.to_string())?; return Ok(String::new()); }
        if !matches!(action.as_str(), "thumbnail" | "preview" | "copy") { return Err("Unknown screenshot action.".into()); }
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let cache_key = format!("v1:{}:{action}", revision(&path, &metadata));
        if metadata.len() > 32 * 1024 * 1024 { return Err("Screenshot exceeds 32 MB.".into()); }
        static DECODE: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = DECODE.lock().map_err(|_| "Screenshot decoder unavailable")?;
        if action != "copy" {
            if let Some(cached) = super::cache::read_json::<String>("screenshot-images", &cache_key, None) {
                if cached.starts_with("data:image/png;base64,") { return Ok(cached); }
            }
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let reader = image::ImageReader::new(std::io::Cursor::new(&bytes)).with_guessed_format().map_err(|e| e.to_string())?;
        let (w,h) = reader.into_dimensions().map_err(|e| e.to_string())?;
        if u64::from(w) * u64::from(h) > 32_000_000 { return Err("Screenshot exceeds 32 megapixels.".into()); }
        let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
        if action == "copy" {
            let rgba = img.to_rgba8();
            arboard::Clipboard::new().map_err(|e| e.to_string())?.set_image(arboard::ImageData { width: w as usize, height: h as usize, bytes: std::borrow::Cow::Owned(rgba.into_raw()) }).map_err(|e| e.to_string())?;
            return Ok(String::new());
        }
        let size = if action == "thumbnail" { 480 } else { 1920 };
        let mut output = std::io::Cursor::new(Vec::new());
        img.thumbnail(size,size).write_to(&mut output, image::ImageFormat::Png).map_err(|e| e.to_string())?;
        let data = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(output.into_inner()));
        // Never persist a render if the source changed while it was being decoded.
        if std::fs::metadata(&path).ok().is_some_and(|current| revision(&path, &current) == revision(&path, &metadata)) {
            let _ = super::cache::write_json("screenshot-images", &cache_key, &data);
        }
        Ok(data)
    }).await.map_err(|e| e.to_string())?
}
