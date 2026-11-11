use std::{fs, io::Write, path::Path, sync::atomic::Ordering};

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid instance identifier.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn rename_instance(instance_id: String, name: String) -> Result<super::InstanceConfig, String> {
    validate_id(&instance_id)?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Use an instance name of 1–80 characters without control characters.".into());
    }
    let mut config = super::load_instance(&instance_id)?;
    config.name = name.to_owned();
    super::write_instance(&config)?;
    Ok(config)
}

fn linked(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_type().is_symlink() || metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    { metadata.file_type().is_symlink() }
}

fn append(zip: &mut zip::ZipWriter<fs::File>, root: &Path, path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if linked(&meta) { return Err("Export does not follow linked folders or files. Export their original instance instead.".into()); }
    if meta.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            append(zip, root, &entry.map_err(|e| e.to_string())?.path())?;
        }
    } else if meta.is_file() {
        let relative = path.strip_prefix(root).map_err(|e| e.to_string())?.to_str().ok_or("A file name cannot be exported as UTF-8.")?.replace('\\', "/");
        zip.start_file(format!("minecraft/{relative}"), zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(meta.len() >= u32::MAX as u64)).map_err(|e| e.to_string())?;
        std::io::copy(&mut fs::File::open(path).map_err(|e| e.to_string())?, zip).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// A local backup, never a network upload or a distributable Modrinth pack.
fn write_archive(root: &Path, destination: &Path, manifest: &serde_json::Value) -> Result<(), String> {
    if destination.exists() { return Err("Choose a new filename; Bloom will not overwrite an existing export.".into()); }
    if linked(&fs::symlink_metadata(root).map_err(|e| e.to_string())?) { return Err("Export does not follow a linked instance directory.".into()); }
    let parent = destination.parent().ok_or("Choose an export folder.")?;
    let stage = parent.join(format!(".bloom-export-{}.part", uuid::Uuid::new_v4()));
    let result = (|| {
        let file = fs::OpenOptions::new().write(true).create_new(true).open(&stage).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("bloom-instance.json", zip::write::SimpleFileOptions::default()).map_err(|e| e.to_string())?;
        zip.write_all(&serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        for name in ["mods", "resourcepacks", "shaderpacks", "config", "saves", "screenshots", "options.txt", "optionsof.txt", "servers.dat"] {
            let path = root.join(name);
            if path.try_exists().map_err(|e| e.to_string())? { append(&mut zip, root, &path)?; }
        }
        zip.finish().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
        // Publish only the complete archive, atomically refusing an existing destination.
        fs::hard_link(&stage, destination).map_err(|e| format!("Could not save export (choose a local drive and a new filename): {e}"))?;
        Ok(())
    })();
    let _ = fs::remove_file(stage);
    result
}

#[tauri::command]
pub(crate) async fn export_instance(instance_id: String, state: tauri::State<'_, super::LauncherState>) -> Result<Option<String>, String> {
    validate_id(&instance_id)?;
    if state.game_running.load(Ordering::SeqCst) || state.content_install_active.load(Ordering::SeqCst) || *state.launch_active.lock().map_err(|e| e.to_string())? {
        return Err("Wait for the game and active downloads to finish before exporting.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let config = super::load_instance(&instance_id)?;
        let filename: String = config.name.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == ' ' { c } else { '_' }).collect();
        let Some(destination) = rfd::FileDialog::new().set_title("Export local instance backup").add_filter("ZIP backup", &["zip"]).set_file_name(format!("{filename}.zip")).save_file() else { return Ok(None); };
        let root = Path::new(&config.directory).canonicalize().map_err(|e| e.to_string())?;
        if destination.parent().ok_or("Choose an export folder.")?.canonicalize().map_err(|e| e.to_string())?.starts_with(&root) {
            return Err("Save the ZIP outside the instance folder.".into());
        }
        let manifest = serde_json::json!({"formatVersion":1,"name":config.name,"minecraft":config.version,"engine":config.engine,"sakura":config.sakura,"loader":config.loader,"memory":config.memory});
        write_archive(Path::new(&config.directory), &destination, &manifest)?;
        Ok(Some(destination.to_string_lossy().into_owned()))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_is_complete_scoped_and_never_overwrites() {
        let dir = std::env::temp_dir().join(format!("bloom-export-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(dir.join("game/mods")).unwrap();
        fs::write(dir.join("game/mods/test.jar"), b"test content").unwrap();
        fs::write(dir.join("game/accounts.json"), b"must not export").unwrap();
        let out = dir.join("test.zip");
        write_archive(&dir.join("game"), &out, &serde_json::json!({"name":"Test"})).unwrap();
        let bytes = fs::read(&out).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
        assert_eq!(zip.len(), 2);
        assert!(zip.by_name("minecraft/mods/test.jar").is_ok());
        assert!(zip.by_name("bloom-instance.json").is_ok());
        assert!(write_archive(&dir.join("game"), &out, &serde_json::json!({})).is_err());
        assert_eq!(fs::read(&out).unwrap(), bytes);
        assert!(!fs::read_dir(&dir).unwrap().any(|e| e.unwrap().path().extension().is_some_and(|s| s == "part")));
        fs::remove_dir_all(dir).unwrap();
    }
}
