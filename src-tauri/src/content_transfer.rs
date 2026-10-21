use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha512};

use crate::{cache, cosmetics, load_instance, InstanceConfig, LauncherState};

static COPY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Transfer {
    source_id: String,
    target_id: String,
    category: String,
    file_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    fingerprint: String,
    verified: bool,
    message: String,
}

struct Paths {
    source: PathBuf,
    folder: PathBuf,
    target: InstanceConfig,
}

fn identifier(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 160
        || !value.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid instance identifier.".into());
    }
    Ok(())
}

fn filename(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.starts_with('.')
        || value.ends_with(['.', ' '])
        || value.chars().any(|c| c.is_control() || "/\\:<>\"|?*".contains(c))
    {
        return Err("Invalid content filename.".into());
    }
    Ok(())
}

fn plain_path(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    let mut linked = metadata.file_type().is_symlink();
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        linked |= metadata.file_attributes() & 0x400 != 0;
    }
    if linked {
        return Err("Linked content folders or files cannot be copied this way.".into());
    }
    Ok(())
}

fn paths(request: &Transfer) -> Result<Paths, String> {
    identifier(&request.source_id)?;
    identifier(&request.target_id)?;
    filename(&request.file_name)?;
    if request.source_id == request.target_id {
        return Err("Choose a different instance.".into());
    }
    let (extension, _) = crate::content_import_details(&request.category)?;
    let visible = request.file_name.strip_suffix(".disabled").unwrap_or(&request.file_name);
    if !visible.to_ascii_lowercase().ends_with(&format!(".{extension}")) {
        return Err(format!("Only .{extension} files can be copied here."));
    }
    if request.category == "mods" && cosmetics::is_managed_file(&request.file_name) {
        return Err("Bloom manages this mod separately for each instance.".into());
    }
    let source_config = load_instance(&request.source_id)?;
    let target = load_instance(&request.target_id)?;
    let source_folder = Path::new(&source_config.directory).join(&request.category);
    let folder = Path::new(&target.directory).join(&request.category);
    plain_path(Path::new(&source_config.directory))?;
    plain_path(Path::new(&target.directory))?;
    if folder.exists() && source_folder.canonicalize().ok() == folder.canonicalize().ok() {
        return Err("These instances already share this content folder.".into());
    }
    plain_path(&source_folder)?;
    if folder.exists() {
        plain_path(&folder)?;
    }
    let source = source_folder.join(&request.file_name);
    plain_path(&source)?;
    let metadata = fs::metadata(&source).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 * 1024 {
        return Err("Choose a content file smaller than 2 GB.".into());
    }
    Ok(Paths { source, folder, target })
}

fn hash(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha512::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn manifest(path: &Path, category: &str) -> Result<Option<Value>, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "This file is not a valid content archive.")?;
    if category == "shaderpacks" {
        if !zip.file_names().any(|name| name.starts_with("shaders/")) {
            return Err("This archive does not contain a shader pack.".into());
        }
        return Ok(None);
    }
    let entry = if category == "mods" { "fabric.mod.json" } else { "pack.mcmeta" };
    let member = zip.by_name(entry).map_err(|_| {
        if category == "mods" { "This file is not a Fabric mod." } else { "This archive does not contain a resource pack." }
    })?;
    let mut bytes = Vec::new();
    member.take(256 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 256 * 1024 { return Err("The content metadata is too large.".into()); }
    let metadata: Value = serde_json::from_slice(&bytes).map_err(|_| "The content metadata is invalid.")?;
    if (category == "mods" && metadata["id"].as_str().is_none())
        || (category == "resourcepacks" && !metadata["pack"].is_object())
    {
        return Err("The content metadata is invalid.".into());
    }
    Ok(Some(metadata))
}

fn check_destination(request: &Transfer, paths: &Paths, metadata: &Option<Value>) -> Result<(), String> {
    if !paths.folder.exists() { return Ok(()); }
    let base = request.file_name.strip_suffix(".disabled").unwrap_or(&request.file_name);
    for entry in fs::read_dir(&paths.folder).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.strip_suffix(".disabled").unwrap_or(&name).eq_ignore_ascii_case(base) {
            return Err("That filename already exists in this instance. Nothing was replaced.".into());
        }
        if request.category == "mods" && name.strip_suffix(".disabled").unwrap_or(&name).to_ascii_lowercase().ends_with(".jar") {
            plain_path(&entry.path())?;
            if let (Some(source), Ok(Some(existing))) = (metadata, manifest(&entry.path(), "mods")) {
                if source["id"].as_str().is_some() && source["id"] == existing["id"] {
                    return Err("This instance already contains a version of that mod. Nothing was replaced.".into());
                }
            }
        }
    }
    Ok(())
}

fn provider_version(fingerprint: &str) -> Option<Value> {
    if let Some(value) = cache::read_json::<Value>("content-transfer", fingerprint, Some(std::time::Duration::from_secs(86400))) {
        return Some(value);
    }
    let value: Value = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent(concat!("BloomClient/", env!("CARGO_PKG_VERSION")))
        .build().ok()?
        .get(format!("https://api.modrinth.com/v2/version_file/{fingerprint}"))
        .query(&[("algorithm", "sha512")])
        .send().ok()?.error_for_status().ok()?.json().ok()?;
    // Only cache a response that identifies the actual file.
    if !value["files"].as_array()?.iter().any(|f| f["hashes"]["sha512"].as_str() == Some(fingerprint)) {
        return None;
    }
    let _ = cache::write_json("content-transfer", fingerprint, &value);
    Some(value)
}

fn compatibility(category: &str, target: &InstanceConfig, local: &Option<Value>, provider: Option<&Value>) -> Result<bool, String> {
    if category == "mods" {
        if !target.loader.eq_ignore_ascii_case("fabric") {
            return Err("Fabric mods need a Fabric destination instance.".into());
        }
        if local.as_ref().and_then(|v| v["environment"].as_str()) == Some("server") {
            return Err("This mod is intended for a dedicated server.".into());
        }
    }
    let Some(provider) = provider else { return Ok(false); };
    let Some(versions) = provider["game_versions"].as_array() else { return Ok(false); };
    if !versions.iter().any(|v| v.as_str() == Some(target.version.as_str())) {
        return Err(format!("This file does not list support for Minecraft {}.", target.version));
    }
    if category == "mods" {
        let Some(loaders) = provider["loaders"].as_array() else { return Ok(false); };
        if !loaders.iter().any(|v| v.as_str().is_some_and(|s| s.eq_ignore_ascii_case(&target.loader))) {
            return Err("This file does not support the destination's mod loader.".into());
        }
    }
    Ok(true)
}

fn inspect(request: &Transfer) -> Result<(Paths, Preview), String> {
    let paths = paths(request)?;
    let local = manifest(&paths.source, &request.category)?;
    check_destination(request, &paths, &local)?;
    compatibility(&request.category, &paths.target, &local, None)?;
    let fingerprint = hash(&paths.source)?;
    let provider = provider_version(&fingerprint);
    let verified = compatibility(&request.category, &paths.target, &local, provider.as_ref())?;
    let message = if verified {
        format!("Supports Minecraft {}.", paths.target.version)
    } else {
        format!("Compatibility with Minecraft {} could not be verified.", paths.target.version)
    };
    Ok((paths, Preview { fingerprint, verified, message }))
}

#[tauri::command]
pub(crate) async fn preview_content_transfer(request: Transfer) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(&request).map(|(_, preview)| preview))
        .await.map_err(|e| e.to_string())?
}

/// Publish only complete bytes, and never replace an existing destination.
fn copy_new(source: &Path, folder: &Path, name: &str, expected: &str, before_publish: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    plain_path(folder)?;
    let temporary = folder.join(format!(".{}.bloom-part", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut input = File::open(source).map_err(|e| e.to_string())?;
        let mut output = OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        let mut digest = Sha512::new();
        let mut buffer = [0; 64 * 1024];
        loop {
            let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 { break; }
            digest.update(&buffer[..count]);
            output.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        if format!("{:x}", digest.finalize()) != expected {
            return Err("The source changed. Drag the file again to review it.".into());
        }
        before_publish(&temporary)?;
        // Atomic no-clobber publication on the same filesystem (NTFS on Windows).
        fs::hard_link(&temporary, folder.join(name)).map_err(|e| format!("Could not add this file without replacing existing content: {e}"))?;
        Ok(())
    })();
    let _ = fs::remove_file(temporary);
    result
}

struct ActivityReservation(Option<Arc<Mutex<bool>>>);
impl Drop for ActivityReservation {
    fn drop(&mut self) {
        if let Some(active) = &self.0 {
            if let Ok(mut active) = active.lock() { *active = false; }
        }
    }
}

#[tauri::command]
pub(crate) async fn copy_instance_content(
    state: tauri::State<'_, LauncherState>,
    request: Transfer,
    fingerprint: String,
    allow_unverified: bool,
) -> Result<(), String> {
    let reservation = {
        let mut active = state.launch_active.lock().map_err(|_| "The launcher is busy.")?;
        crate::validate_content_install_activity(&request.category, *active, state.game_running.load(Ordering::SeqCst))?;
        if state.content_install_active.load(Ordering::SeqCst) {
            return Err("Wait for the current content installation to finish.".into());
        }
        if !*active {
            *active = true;
            ActivityReservation(Some(state.launch_active.clone()))
        } else {
            ActivityReservation(None)
        }
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _copy_lock = COPY_LOCK.lock().map_err(|_| "Another copy is still finishing.")?;
        let (paths, preview) = inspect(&request)?;
        if preview.fingerprint != fingerprint {
            return Err("The source changed. Drag the file again to review it.".into());
        }
        if !preview.verified && !allow_unverified {
            return Err("Review the compatibility warning before copying this file.".into());
        }
        copy_new(&paths.source, &paths.folder, &request.file_name, &fingerprint, |complete_file| {
            let current = self::paths(&request)?;
            if current.source.canonicalize().ok() != paths.source.canonicalize().ok()
                || current.folder.canonicalize().ok() != paths.folder.canonicalize().ok()
            {
                return Err("The instance location changed. Review this copy again.".into());
            }
            check_destination(&request, &current, &manifest(complete_file, &request.category)?)
        })
    }).await.map_err(|e| e.to_string())?;
    drop(reservation);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("bloom-transfer-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Directory { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn instance() -> InstanceConfig {
        serde_json::from_value(json!({
            "id":"smp", "name":"SMP", "loader":"Fabric", "version":"1.21.1",
            "directory":"unused", "java":"", "memory":4096, "jvmArguments":"",
            "mods":true, "resourcePacks":true, "shaderPacks":true, "config":true,
            "customResolution":false, "visible":true, "shortcut":false
        })).unwrap()
    }
    fn archive(path: &Path, entry: &str, metadata: &str) {
        let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
        zip.start_file(entry, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(metadata.as_bytes()).unwrap();
        zip.finish().unwrap();
    }
    #[test]
    fn compatibility_uses_exact_version_and_loader_and_marks_unknown() {
        let mut target = instance();
        let local = Some(json!({"id":"example"}));
        let provider = json!({"game_versions":["1.21.1"],"loaders":["fabric"]});
        assert_eq!(compatibility("mods", &target, &local, Some(&provider)), Ok(true));
        assert_eq!(compatibility("mods", &target, &local, None), Ok(false));
        target.version = "1.20.1".into();
        assert!(compatibility("mods", &target, &local, Some(&provider)).is_err());
        target.version = "1.21.1".into();
        target.loader = "Vanilla".into();
        assert!(compatibility("mods", &target, &local, None).is_err());
        target.loader = "Fabric".into();
        assert!(compatibility("mods", &target, &local, Some(&json!({"game_versions":["1.21.1"],"loaders":["forge"]}))).is_err());
        assert!(compatibility("mods", &target, &Some(json!({"environment":"server"})), None).is_err());
    }
    #[test]
    fn copy_preserves_source_and_disabled_state_and_never_overwrites() {
        let root = Directory::new();
        let source = root.0.join("sample.zip.disabled");
        archive(&source, "pack.mcmeta", r#"{"pack":{"pack_format":34,"description":"Test"}}"#);
        let expected = hash(&source).unwrap();
        let folder = root.0.join("destination");
        copy_new(&source, &folder, "sample.zip.disabled", &expected, |_| Ok(())).unwrap();
        assert_eq!(hash(&folder.join("sample.zip.disabled")).unwrap(), expected);
        assert_eq!(hash(&source).unwrap(), expected);
        fs::write(folder.join("sample.zip.disabled"), b"existing user file").unwrap();
        assert!(copy_new(&source, &folder, "sample.zip.disabled", &expected, |_| Ok(())).is_err());
        assert_eq!(fs::read(folder.join("sample.zip.disabled")).unwrap(), b"existing user file");
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 1);
    }
    #[test]
    fn changed_source_and_late_conflict_leave_no_partial_file() {
        let root = Directory::new();
        let source = root.0.join("sample.zip");
        fs::write(&source, b"before").unwrap();
        let expected = hash(&source).unwrap();
        fs::write(&source, b"after").unwrap();
        let folder = root.0.join("destination");
        assert!(copy_new(&source, &folder, "sample.zip", &expected, |_| Ok(())).is_err());
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
        assert!(copy_new(&source, &folder, "sample.zip", &hash(&source).unwrap(), |_| Err("late conflict".into())).is_err());
        assert_eq!(fs::read_dir(&folder).unwrap().count(), 0);
    }
    #[test]
    fn rejects_duplicate_mod_ids_including_disabled_versions() {
        let root = Directory::new();
        archive(&root.0.join("old-version.jar.disabled"), "fabric.mod.json", r#"{"id":"same-mod"}"#);
        let paths = Paths { source: root.0.join("unused"), folder: root.0.clone(), target: instance() };
        let mut request = Transfer { source_id:"a".into(), target_id:"b".into(), category:"mods".into(), file_name:"new-version.jar".into() };
        assert!(check_destination(&request, &paths, &Some(json!({"id":"same-mod"}))).is_err());
        assert!(check_destination(&request, &paths, &Some(json!({"id":"different-mod"}))).is_ok());
        request.file_name = "OLD-VERSION.jar".into();
        assert!(check_destination(&request, &paths, &None).is_err());
    }
    #[test]
    fn validates_archives_without_extracting_them() {
        let root = Directory::new();
        let file = root.0.join("file.zip");
        archive(&file, "pack.mcmeta", r#"{"pack":{"pack_format":34}}"#);
        assert!(manifest(&file, "resourcepacks").unwrap().is_some());
        assert!(manifest(&file, "mods").is_err());
        archive(&file, "shaders/program.fsh", "shader");
        assert!(manifest(&file, "shaderpacks").is_ok());
        archive(&file, "fabric.mod.json", "null");
        assert!(manifest(&file, "mods").is_err());
        fs::write(&file, "not a zip").unwrap();
        assert!(manifest(&file, "resourcepacks").is_err());
    }
    #[test]
    fn rejects_path_escape_and_releases_activity_on_error() {
        for invalid in ["../other", "C:\\test", ".", "", "a/b"] { assert!(identifier(invalid).is_err()); }
        for invalid in ["../evil.jar", "mod.jar:stream", ".hidden", "mod.jar ", "a\\b.jar"] { assert!(filename(invalid).is_err()); }
        assert!(identifier("fabulously-optimized_123").is_ok());
        assert!(filename("My resource pack.zip.disabled").is_ok());
        let active = Arc::new(Mutex::new(true));
        { let _reservation = ActivityReservation(Some(active.clone())); }
        assert!(!*active.lock().unwrap());
    }
}
