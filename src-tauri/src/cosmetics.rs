use super::*;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path, sync::Mutex};

include!(concat!(env!("OUT_DIR"), "/cosmetics_bundle.rs"));
const MANIFEST: &str = ".bloom-cosmetics.json";
const VERSIONS: &[&str] = &["1.21.11", "26.1", "26.2", "26.3"];
fn legacy_file() -> String {
    "bloom-cosmetics-1.21.11.jar".into()
}
fn filename(version: &str) -> String {
    format!("bloom-cosmetics-{version}.jar")
}
static INSTALL_LOCK: Mutex<()> = Mutex::new(());
// The cape backend is live. Development/emergency builds can still compile the
// integration out explicitly with BLOOM_COSMETICS_ENABLED=false.
pub fn live() -> bool {
    option_env!("BLOOM_COSMETICS_ENABLED") != Some("false")
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Preferences {
    pub enabled: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self { enabled: true }
    }
}
#[derive(serde::Serialize, serde::Deserialize)]
struct Ownership {
    #[serde(default = "legacy_file")]
    file: String,
    sha256: String,
    disabled: bool,
    #[serde(default)]
    global_disabled: bool,
    #[serde(default)]
    previous_sha256: Option<String>,
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn preferences() -> Result<Preferences, String> {
    let path = bloom_data_dir()?.join("cosmetics-preferences.json");
    if !path.exists() {
        return Ok(Preferences::default());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("bloom-part");
    use std::io::Write;
    let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temporary)
        .map_err(|_|"An interrupted cape update needs attention. Remove only the .bloom-part file after closing Minecraft.".to_string())?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|e| e.to_string())
}
fn mod_id(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let entry = archive.by_name("fabric.mod.json").ok()?;
    if entry.size() > 65536 {
        return None;
    }
    let mut bytes = Vec::new();
    entry.take(65537).read_to_end(&mut bytes).ok()?;
    serde_json::from_slice::<serde_json::Value>(&bytes).ok()?["id"]
        .as_str()
        .map(str::to_owned)
}
pub fn supported(config: &InstanceConfig) -> bool {
    config.visible
        && config.loader.eq_ignore_ascii_case("fabric")
        && VERSIONS.contains(&config.version.as_str())
}
pub fn reconcile(config: &InstanceConfig) -> Result<(), String> {
    if !live() || !supported(config) {
        return Ok(());
    }
    reconcile_with_preference(config, preferences()?.enabled)
}

fn reconcile_with_preference(config: &InstanceConfig, enabled: bool) -> Result<(), String> {
    let file = filename(&config.version);
    let (_, _, bundled_jar, bundled_sha) = BUNDLES.iter().find(|entry| entry.0 == config.version)
        .ok_or("This build has no cosmetics renderer for this Minecraft version. Run npm run build:cosmetics.")?;
    let _guard = INSTALL_LOCK.lock().map_err(|_| "Cape installer is busy")?;
    let mods = Path::new(&config.directory).join("mods");
    fs::create_dir_all(&mods).map_err(|e| e.to_string())?;
    let manifest_path = mods.join(MANIFEST);
    let mut ownership: Option<Ownership> = if manifest_path.exists() {
        Some(
            serde_json::from_slice(&fs::read(&manifest_path).map_err(|e| e.to_string())?)
                .map_err(|_| "The cape ownership record is invalid; no files were changed.")?,
        )
    } else {
        None
    };
    let installed = mods.join(&file);
    let disabled = mods.join(format!("{file}.disabled"));
    if let Some(ref mut record) = ownership {
        if record.file != file {
            if !is_managed_file(&record.file) || record.file.ends_with(".disabled") {
                return Err("Invalid managed cape filename; no files were changed.".into());
            }
            let old = mods.join(&record.file);
            let old_disabled = mods.join(format!("{}.disabled", record.file));
            if (installed.exists() && disabled.exists())
                || (old.exists() && old_disabled.exists())
                || ((installed.exists() || disabled.exists())
                    && (old.exists() || old_disabled.exists()))
            {
                return Err(
                    "Duplicate Bloom cape files; close Minecraft and resolve them before retrying."
                        .into(),
                );
            }
            // Carry the verified owned file forward before installing the matching build.
            // Keep the old manifest until the replacement transaction commits, so retries recover.
            let (source, target) = if old.exists() {
                (&old, &installed)
            } else {
                (&old_disabled, &disabled)
            };
            if source.exists() {
                let actual = digest(&fs::read(source).map_err(|e| e.to_string())?);
                if actual != record.sha256 && Some(&actual) != record.previous_sha256.as_ref() {
                    return Err(
                        "The managed Bloom cape mod was modified; no files were changed.".into(),
                    );
                }
                fs::rename(source, target).map_err(|e| e.to_string())?;
            }
            // Validate the destination too when recovering after an interrupted rename.
            let destination = if installed.exists() {
                &installed
            } else {
                &disabled
            };
            if destination.exists() {
                let actual = digest(&fs::read(destination).map_err(|e| e.to_string())?);
                if actual != record.sha256 && Some(&actual) != record.previous_sha256.as_ref() {
                    return Err(
                        "The managed cape destination was modified; no files were replaced.".into(),
                    );
                }
            }
            record.file = file.clone();
            atomic(
                &manifest_path,
                &serde_json::to_vec(record).map_err(|e| e.to_string())?,
            )?;
        }
        let path = if installed.exists() {
            &installed
        } else {
            &disabled
        };
        if path.exists() && {
            let actual = digest(&fs::read(path).map_err(|e| e.to_string())?);
            actual != record.sha256 && Some(&actual) != record.previous_sha256.as_ref()
        } {
            return Err("The managed Bloom cape mod was modified. Move it out of mods before repairing; it was not overwritten.".into());
        }
        if installed.exists() && disabled.exists() {
            return Err("Both enabled and disabled Bloom cape files exist. Close Minecraft and resolve the duplicate before retrying.".into());
        }
        // Only an explicit disabled record or its owned `.disabled` file means the
        // player opted out. An enabled manifest with both files missing is an
        // interrupted/deleted managed install and must be repaired below.
        if record.disabled || (!record.global_disabled && disabled.exists()) {
            return Ok(());
        }
    }
    if !enabled {
        if ownership.is_some() && installed.exists() {
            if disabled.exists() {
                return Err("Both enabled and disabled Bloom cape files exist.".into());
            }
            let mut record = ownership.unwrap();
            record.global_disabled = true;
            atomic(
                &manifest_path,
                &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
            )?;
            fs::rename(installed, disabled).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    if ownership
        .as_ref()
        .is_some_and(|record| record.global_disabled)
        && disabled.exists()
    {
        if installed.exists() {
            return Err(
                "Both enabled and disabled cape files exist. No files were replaced.".into(),
            );
        }
        fs::rename(&disabled, &installed).map_err(|e| e.to_string())?;
    }
    for entry in fs::read_dir(&mods).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("jar") {
            continue;
        }
        if mod_id(&path).as_deref() == Some("bloom_cosmetics")
            && (path != installed || ownership.is_none())
        {
            return Err("Another Bloom cosmetics mod is already in this instance. Move it out of mods, then retry; no user files were removed.".into());
        }
    }
    if let Some(version) = config.loader_version.as_deref() {
        let numbers: Vec<u32> = version.split('.').map(|v| v.parse().unwrap_or(0)).collect();
        if numbers.as_slice() < [0, 19, 2].as_slice() {
            return Err("Bloom capes need Fabric Loader 0.19.2 or newer. Update the instance loader or disable Bloom cosmetics.".into());
        }
    }
    if bundled_jar.is_empty() {
        return Err("This development build has no cape renderer. Build cosmetics first or disable the integration.".into());
    }
    let sha = digest(bundled_jar);
    if sha != *bundled_sha {
        return Err("The bundled cape renderer failed its checksum.".into());
    }
    if ownership.as_ref().is_some_and(|o| o.sha256 == sha)
        && installed.exists()
        && digest(&fs::read(&installed).map_err(|e| e.to_string())?) == sha
    {
        if ownership
            .as_ref()
            .is_some_and(|o| o.global_disabled || o.previous_sha256.is_some())
        {
            atomic(
                &manifest_path,
                &serde_json::to_vec(&Ownership {
                    file: file.clone(),
                    sha256: sha,
                    disabled: false,
                    global_disabled: false,
                    previous_sha256: None,
                })
                .map_err(|e| e.to_string())?,
            )?;
        }
        return Ok(());
    }
    if installed.exists() && ownership.is_none() {
        return Err("The cape filename is occupied by an unmanaged file.".into());
    }
    let previous = ownership.as_ref().map(|o| o.sha256.clone());
    atomic(
        &manifest_path,
        &serde_json::to_vec(&Ownership {
            file: file.clone(),
            sha256: sha.clone(),
            disabled: false,
            global_disabled: false,
            previous_sha256: previous,
        })
        .map_err(|e| e.to_string())?,
    )?;
    atomic(&installed, bundled_jar)?;
    atomic(
        &manifest_path,
        &serde_json::to_vec(&Ownership {
            file: file.clone(),
            sha256: sha,
            disabled: false,
            global_disabled: false,
            previous_sha256: None,
        })
        .map_err(|e| e.to_string())?,
    )
}

#[tauri::command]
pub fn get_cosmetics_preferences() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({"enabled":preferences()?.enabled,"available":live()}))
}
#[tauri::command]
pub fn set_cosmetics_preferences(
    enabled: bool,
    state: tauri::State<'_, LauncherState>,
) -> Result<(), String> {
    let active = state.launch_active.lock().map_err(|_| "Launcher busy")?;
    if *active {
        return Err("Close Minecraft before changing its cosmetics integration.".into());
    }
    let _guard = INSTALL_LOCK.lock().map_err(|_| "Cape installer busy")?;
    atomic(
        &bloom_data_dir()?.join("cosmetics-preferences.json"),
        &serde_json::to_vec(&Preferences { enabled }).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
pub async fn reconcile_cosmetics(
    state: tauri::State<'_, LauncherState>,
) -> Result<Vec<String>, String> {
    let active = state.launch_active.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let busy = active.lock().map_err(|_| "Launcher busy")?;
        if *busy {
            return Ok(Vec::new());
        }
        let mut errors = Vec::new();
        for config in list_instances_blocking()? {
            if let Err(error) = reconcile(&config) {
                errors.push(format!("{}: {}", config.name, error));
            }
        }
        Ok(errors)
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn hydrate_cosmetic_catalog(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(items) = value["items"].as_array_mut() {
        for item in items {
            if let Some(url) = item["textureUrl"].as_str().map(str::to_owned) {
                if let Some(cached) = super::cache::cached_bloom_cosmetic_artwork(&url).await {
                    item["textureUrl"] = serde_json::Value::String(cached);
                }
            }
            if let Some(url) = item["animation"]["atlasUrl"].as_str().map(str::to_owned) {
                if let Some(cached) = super::cache::cached_bloom_cosmetic_artwork(&url).await {
                    item["animation"]["atlasUrl"] = serde_json::Value::String(cached);
                }
            }
        }
    }
    value
}

#[tauri::command]
pub async fn cosmetics_request(
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    account_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let authorized = matches!(
        (method.as_str(), path.as_str()),
        ("GET", "/v1/cosmetics/me")
            | ("PUT", "/v1/capes/equipped")
            | ("PUT", "/v1/cosmetics/badge")
    );
    if !authorized && !(method == "GET" && path == "/v1/capes") {
        return Err("Unsupported cape operation".into());
    }
    if !live() {
        return Err(
            "Capes are awaiting backend activation and multiplayer verification in this build."
                .into(),
        );
    }
    let mut session = if authorized {
        Some(saved_session().ok_or("Sign in to Minecraft first.")?)
    } else {
        None
    };
    if let Some(ref value) = session {
        if account_id.as_deref() != Some(value.uuid.as_str()) {
            return Err("The account changed. Open Locker again.".into());
        }
    }
    for attempt in 0..2 {
        let mut request = bloom_backend_request(
            reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?,
            &path,
            12,
        )?;
        if let Some(ref s) = session {
            request = request.bearer_auth(&s.access_token);
        }
        if let Some(ref value) = body {
            request = request.json(value);
        }
        let response = match request.send().await {
            Ok(response) => response,
            Err(_) if method == "GET" && path == "/v1/capes" => {
                if let Some(cached) = super::cache::read_json::<serde_json::Value>(
                    "cosmetic-catalog",
                    "published-cape-catalog-v1",
                    None,
                ) {
                    return Ok(hydrate_cosmetic_catalog(cached).await);
                }
                return Err("The cape service could not be reached.".into());
            }
            Err(_) => return Err("The cape service could not be reached.".into()),
        };
        if response.status() == 401 && attempt == 0 {
            if let Some(ref s) = session {
                let refreshed = refresh_minecraft_session(s).await?;
                save_account_session(&refreshed, false)?;
                session = Some(refreshed);
                continue;
            }
        }
        if !response.status().is_success() {
            return Err(format!(
                "The cape service could not complete this action ({}).",
                response.status()
            ));
        }
        let mut value: serde_json::Value = response
            .json()
            .await
            .map_err(|_| "Invalid cape service response.".to_string())?;
        if method == "GET" && path == "/v1/capes" {
            let cache_key = "published-cape-catalog-v1";
            let _ = super::cache::write_json("cosmetic-catalog", cache_key, &value);
            value = hydrate_cosmetic_catalog(value).await;
        }
        return Ok(value);
    }
    Err("Sign in again to update your cape.".into())
}

// Environment handoff is inherited only by the child; no long-lived token is
// written to disk, logged, or exposed in command-line arguments.
pub fn prepare_session(config: &InstanceConfig, session: &MinecraftSession) -> Option<String> {
    if !live() || !supported(config) || !preferences().map(|p| p.enabled).unwrap_or(false) {
        return None;
    }
    type GameSessions = std::collections::HashMap<String, (std::time::Instant, String)>;
    static SESSIONS: std::sync::OnceLock<Mutex<GameSessions>> = std::sync::OnceLock::new();
    let sessions = SESSIONS.get_or_init(|| Mutex::new(GameSessions::new()));
    let key = digest(format!("{}:{}", session.uuid, session.access_token).as_bytes());
    if let Ok(cache) = sessions.lock() {
        if let Some((created, token)) = cache.get(&key) {
            // Server sessions last 12 hours; leave a one-hour safety margin.
            if created.elapsed() < std::time::Duration::from_secs(11 * 3600) { return Some(token.clone()); }
        }
    }
    let result = (|| -> Result<serde_json::Value, reqwest::Error> {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .build()?
            .post(format!(
                "{}/v1/cosmetics/sessions",
                BACKEND_URL.trim_end_matches('/')
            ))
            .bearer_auth(&session.access_token)
            .send()?
            .error_for_status()?
            .json()
    })();
    let token = result.ok()?["token"].as_str()?.to_owned();
    if !token.starts_with("bcs_") || token.len() != 47 { return None; }
    if let Ok(mut cache) = sessions.lock() {
        if cache.len() >= 8 { cache.clear(); }
        cache.insert(key, (std::time::Instant::now(), token.clone()));
    }
    Some(token)
}

pub fn attach_session(process: &mut std::process::Command, session: &MinecraftSession, token: &Option<String>) {
    if let Some(token) = token {
        process.env("BLOOM_COSMETICS_SESSION", token).env("BLOOM_COSMETICS_UUID", &session.uuid);
    }
}

pub fn is_managed_file(file: &str) -> bool {
    VERSIONS.iter().any(|version| {
        file == filename(version) || file == format!("{}.disabled", filename(version))
    })
}

pub fn set_file_enabled(
    config: &InstanceConfig,
    file: &str,
    enabled: bool,
) -> Result<bool, String> {
    if !is_managed_file(file) {
        return Ok(false);
    }
    let _guard = INSTALL_LOCK.lock().map_err(|_| "Cape installer busy")?;
    let folder = Path::new(&config.directory).join("mods");
    let path = folder.join(MANIFEST);
    if !path.exists() {
        return Ok(false);
    }
    let mut record: Ownership =
        serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if !is_managed_file(&record.file)
        || record.file.ends_with(".disabled")
        || file.trim_end_matches(".disabled") != record.file
    {
        return Err("The cape ownership record does not match this file.".into());
    }
    let source = folder.join(file);
    let target = folder.join(if enabled {
        record.file.clone()
    } else {
        format!("{}.disabled", record.file)
    });
    if digest(&fs::read(&source).map_err(|e| e.to_string())?) != record.sha256 {
        return Err("Managed cape file has changed; no files were replaced.".into());
    }
    if source != target {
        if target.exists() {
            return Err("Target cape file already exists.".into());
        }
        fs::rename(source, target).map_err(|e| e.to_string())?;
    }
    record.disabled = !enabled;
    record.global_disabled = false;
    atomic(
        &path,
        &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
    )?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versioned_installation_lifecycle() {
        let directory =
            std::env::temp_dir().join(format!("bloom-cosmetics-test-{}", uuid::Uuid::new_v4()));
        let mut config: InstanceConfig = serde_json::from_value(serde_json::json!({
            "id":"test", "name":"Test", "loader":"Fabric", "loaderVersion":"0.19.2",
            "version":"1.21.11", "directory":directory.join("instance"), "java":"auto",
            "memory":2048, "jvmArguments":"", "mods":true, "resourcePacks":true,
            "shaderPacks":true, "config":true, "customResolution":false,
            "visible":true, "shortcut":false
        }))
        .unwrap();
        let mods = Path::new(&config.directory).join("mods");
        for version in VERSIONS {
            if *version == "26.1" {
                let path = mods.join(MANIFEST);
                let mut old: serde_json::Value =
                    serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
                old.as_object_mut().unwrap().remove("file");
                fs::write(path, serde_json::to_vec(&old).unwrap()).unwrap();
            }
            config.version = version.to_string();
            reconcile_with_preference(&config, true).unwrap();
            let file = filename(version);
            let bytes = fs::read(mods.join(&file)).unwrap();
            let bundle = BUNDLES.iter().find(|b| b.0 == *version).unwrap();
            assert_eq!(digest(&bytes), bundle.3);
            let mut jar = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
            let metadata: serde_json::Value =
                serde_json::from_reader(jar.by_name("fabric.mod.json").unwrap()).unwrap();
            assert_eq!(metadata["depends"]["minecraft"], *version);
            assert_eq!(
                metadata["depends"]["java"],
                if *version == "1.21.11" {
                    ">=21"
                } else {
                    ">=25"
                }
            );
            assert!(set_file_enabled(&config, &file, false).unwrap());
            reconcile_with_preference(&config, true).unwrap();
            assert!(!mods.join(&file).exists());
            assert!(set_file_enabled(&config, &format!("{file}.disabled"), true).unwrap());
            reconcile_with_preference(&config, true).unwrap();
            assert_eq!(fs::read(mods.join(&file)).unwrap(), bytes);
            assert_eq!(
                fs::read_dir(&mods)
                    .unwrap()
                    .filter_map(Result::ok)
                    .filter(|e| e.path().extension().is_some_and(|v| v == "jar"))
                    .count(),
                1
            );
        }
        // Global disable and restore uses the correct versioned filename.
        reconcile_with_preference(&config, false).unwrap();
        assert!(mods
            .join(format!("{}.disabled", filename(&config.version)))
            .exists());
        reconcile_with_preference(&config, true).unwrap();
        // An unknown duplicate is reported and preserved.
        let file = mods.join(filename(&config.version));
        let duplicate = mods.join("user-bloom.jar");
        fs::copy(&file, &duplicate).unwrap();
        assert!(reconcile_with_preference(&config, true).is_err());
        assert!(duplicate.exists());
        fs::remove_file(&duplicate).unwrap();
        fs::write(&file, b"user modification").unwrap();
        assert!(reconcile_with_preference(&config, true).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"user modification");
        config.version = "26.4".into();
        assert!(!supported(&config));
        config.version = "26.3".into();
        config.loader = "Vanilla".into();
        assert!(!supported(&config));
        fs::remove_dir_all(&directory).unwrap();
    }
}
