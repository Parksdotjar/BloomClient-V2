use std::{path::{Path, PathBuf}, time::UNIX_EPOCH};
use base64::Engine;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot { instance_id: String, instance_name: String, name: String, modified: u64 }
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
                let modified = entry.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
                shelf.items.push(Screenshot { instance_id: instance.id.clone(), instance_name: instance.name.clone(), name: entry.file_name().to_string_lossy().into_owned(), modified });
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
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024 { return Err("Screenshot exceeds 32 MB.".into()); }
        static DECODE: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = DECODE.lock().map_err(|_| "Screenshot decoder unavailable")?;
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
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
        Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(output.into_inner())))
    }).await.map_err(|e| e.to_string())?
}
