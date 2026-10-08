use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{bloom_data_dir, list_instances_blocking, InstanceConfig};

const OPTIONS_FILE: &str = "options.txt";
const SERVERS_FILE: &str = "servers.dat";
const VOICE_CHAT_FILE: &str = "config/voicechat/voicechat-client.properties";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GlobalFileSyncSettings {
    options_source: Option<String>,
    servers_source: Option<String>,
    voice_chat_source: Option<String>,
    voice_chat_targets: Vec<String>,
    share_resource_packs: bool,
    share_shader_packs: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UtilitySyncStatus {
    key: String,
    configured: bool,
    source_exists: bool,
    affected_instances: usize,
    active_instances: usize,
    shared_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalFileSyncState {
    settings: GlobalFileSyncSettings,
    statuses: Vec<UtilitySyncStatus>,
    backup_root: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalFileSyncReport {
    changed_files: usize,
    unchanged_files: usize,
    linked_folders: usize,
    detached_folders: usize,
    backup_path: Option<String>,
}

fn utility_root() -> Result<PathBuf, String> {
    let root = bloom_data_dir()?.join("utilities").join("global-file-sync");
    std::fs::create_dir_all(root.join("shared"))
        .map_err(|error| format!("Bloom could not create the Global File Sync folder: {error}"))?;
    std::fs::create_dir_all(root.join("backups"))
        .map_err(|error| format!("Bloom could not create the sync backup folder: {error}"))?;
    Ok(root)
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(utility_root()?.join("settings.json"))
}

fn active_settings_path() -> Result<PathBuf, String> {
    Ok(utility_root()?.join("active-settings.json"))
}

fn load_settings() -> Result<GlobalFileSyncSettings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(GlobalFileSyncSettings::default());
    }
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Bloom could not read Global File Sync settings: {error}"))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Global File Sync settings are invalid: {error}"))
}

fn save_settings(settings: &GlobalFileSyncSettings) -> Result<(), String> {
    std::fs::write(
        settings_path()?,
        serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Bloom could not save Global File Sync settings: {error}"))
}

fn load_active_settings() -> Result<Option<GlobalFileSyncSettings>, String> {
    let path = active_settings_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path).map_err(|error| {
        format!("Bloom could not read the active Global File Sync setup: {error}")
    })?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("The active Global File Sync setup is invalid: {error}"))
}

fn save_active_settings(settings: &GlobalFileSyncSettings) -> Result<(), String> {
    std::fs::write(
        active_settings_path()?,
        serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Bloom could not save the active Global File Sync setup: {error}"))
}

fn instance_map() -> Result<HashMap<String, InstanceConfig>, String> {
    Ok(list_instances_blocking()?
        .into_iter()
        .map(|instance| (instance.id.clone(), instance))
        .collect())
}

fn instance_file(instance: &InstanceConfig, relative: &str) -> PathBuf {
    PathBuf::from(&instance.directory).join(relative)
}

fn source_exists(
    instances: &HashMap<String, InstanceConfig>,
    source: &Option<String>,
    relative: &str,
) -> bool {
    source
        .as_ref()
        .and_then(|id| instances.get(id))
        .map(|instance| instance_file(instance, relative).is_file())
        .unwrap_or(false)
}

fn same_file(left: &Path, right: &Path) -> bool {
    let Ok(left_metadata) = std::fs::metadata(left) else {
        return false;
    };
    let Ok(right_metadata) = std::fs::metadata(right) else {
        return false;
    };
    if left_metadata.len() != right_metadata.len() {
        return false;
    }
    match (std::fs::read(left), std::fs::read(right)) {
        (Ok(left_bytes), Ok(right_bytes)) => left_bytes == right_bytes,
        _ => false,
    }
}

fn timestamp_label() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn same_resolved_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn backup_file(
    target: &Path,
    backup_root: &Path,
    instance_id: &str,
    relative: &str,
) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    let backup = backup_root.join(instance_id).join(relative);
    if let Some(parent) = backup.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::copy(target, backup).map_err(|error| {
        format!(
            "Bloom could not back up {} before syncing: {error}",
            target.display()
        )
    })?;
    Ok(())
}

fn sync_file_to_instances(
    instances: &HashMap<String, InstanceConfig>,
    source_id: &str,
    target_ids: &[String],
    relative: &str,
    backup_root: &Path,
    changed: &mut usize,
    unchanged: &mut usize,
) -> Result<(), String> {
    let source_instance = instances
        .get(source_id)
        .ok_or_else(|| "The selected source instance no longer exists.".to_string())?;
    let source = instance_file(source_instance, relative);
    if !source.is_file() {
        return Err(format!(
            "{} was not found in {}. Launch that instance once or choose another source.",
            relative, source_instance.name
        ));
    }

    for target_id in target_ids {
        if target_id == source_id {
            continue;
        }
        let Some(target_instance) = instances.get(target_id) else {
            continue;
        };
        let target = instance_file(target_instance, relative);
        if same_file(&source, &target) {
            *unchanged += 1;
            continue;
        }
        backup_file(&target, backup_root, &target_instance.id, relative)?;
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::copy(&source, &target).map_err(|error| {
            format!(
                "Bloom could not sync {} to {}: {error}",
                relative, target_instance.name
            )
        })?;
        *changed += 1;
    }
    Ok(())
}

fn copy_directory_merge(
    source: &Path,
    destination: &Path,
    source_label: &str,
) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in std::fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let mut target_path = destination.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory_merge(&source_path, &target_path, source_label)?;
            continue;
        }
        if target_path.exists() && !same_file(&source_path, &target_path) {
            let stem = target_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("file");
            let extension = target_path.extension().and_then(|value| value.to_str());
            let renamed = match extension {
                Some(extension) => format!("{stem}-from-{source_label}.{extension}"),
                None => format!("{stem}-from-{source_label}"),
            };
            target_path = destination.join(renamed);
        }
        if !target_path.exists() {
            std::fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "Bloom could not preserve {}: {error}",
                    source_path.display()
                )
            })?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn is_shared_link(path: &Path, shared: &Path) -> bool {
    junction::exists(path)
        .ok()
        .filter(|exists| *exists)
        .and_then(|_| junction::get_target(path).ok())
        .map(|target| same_resolved_path(&target, shared))
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_shared_link(path: &Path, shared: &Path) -> bool {
    std::fs::read_link(path)
        .map(|target| same_resolved_path(&target, shared))
        .unwrap_or(false)
}

#[cfg(windows)]
fn remove_shared_link(path: &Path) -> Result<bool, String> {
    if junction::exists(path).map_err(|error| error.to_string())? {
        junction::delete(path).map_err(|error| error.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

#[cfg(windows)]
fn is_any_directory_link(path: &Path) -> bool {
    junction::exists(path).unwrap_or(false)
}

#[cfg(not(windows))]
fn remove_shared_link(path: &Path) -> Result<bool, String> {
    if std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

#[cfg(not(windows))]
fn is_any_directory_link(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
}

#[cfg(windows)]
fn create_shared_link(shared: &Path, target: &Path) -> Result<(), String> {
    junction::create(shared, target).map_err(|error| {
        format!(
            "Bloom could not connect {} to the shared folder: {error}",
            target.display()
        )
    })
}

#[cfg(not(windows))]
fn create_shared_link(shared: &Path, target: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(shared, target).map_err(|error| error.to_string())
}

fn connect_shared_folder(
    instances: &HashMap<String, InstanceConfig>,
    category: &str,
    backup_root: &Path,
) -> Result<usize, String> {
    let shared = utility_root()?.join("shared").join(category);
    std::fs::create_dir_all(&shared).map_err(|error| error.to_string())?;
    let mut linked = 0;
    for instance in instances.values() {
        let target = PathBuf::from(&instance.directory).join(category);
        if is_shared_link(&target, &shared) {
            continue;
        }
        if is_any_directory_link(&target) {
            return Err(format!(
                "{} already links to a different folder. Disconnect that link before enabling Bloom's shared {} library.",
                target.display(),
                category
            ));
        }
        if target.exists() {
            copy_directory_merge(&target, &shared, &instance.id)?;
            let backup = backup_root.join(&instance.id).join(category);
            if let Some(parent) = backup.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::rename(&target, &backup).map_err(|error| {
                format!(
                    "Bloom could not back up {} before sharing it: {error}",
                    target.display()
                )
            })?;
            if let Err(error) = create_shared_link(&shared, &target) {
                let _ = std::fs::rename(&backup, &target);
                return Err(error);
            }
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            create_shared_link(&shared, &target)?;
        }
        linked += 1;
    }
    Ok(linked)
}

fn disconnect_shared_folder(
    instances: &HashMap<String, InstanceConfig>,
    category: &str,
) -> Result<usize, String> {
    let shared = utility_root()?.join("shared").join(category);
    let mut detached = 0;
    for instance in instances.values() {
        let target = PathBuf::from(&instance.directory).join(category);
        if is_shared_link(&target, &shared) && remove_shared_link(&target)? {
            std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            copy_directory_merge(&shared, &target, "shared")?;
            detached += 1;
        }
    }
    Ok(detached)
}

fn status_for_file(
    key: &str,
    settings_source: &Option<String>,
    relative: &str,
    target_count: usize,
    instances: &HashMap<String, InstanceConfig>,
) -> UtilitySyncStatus {
    UtilitySyncStatus {
        key: key.to_string(),
        configured: settings_source.is_some(),
        source_exists: source_exists(instances, settings_source, relative),
        affected_instances: target_count,
        active_instances: 0,
        shared_path: None,
    }
}

fn shared_status(
    key: &str,
    category: &str,
    configured: bool,
    instances: &HashMap<String, InstanceConfig>,
) -> Result<UtilitySyncStatus, String> {
    let shared = utility_root()?.join("shared").join(category);
    let active = instances
        .values()
        .filter(|instance| {
            is_shared_link(&PathBuf::from(&instance.directory).join(category), &shared)
        })
        .count();
    Ok(UtilitySyncStatus {
        key: key.to_string(),
        configured,
        source_exists: shared.exists(),
        affected_instances: instances.len(),
        active_instances: active,
        shared_path: Some(shared.to_string_lossy().to_string()),
    })
}

fn get_state_blocking() -> Result<GlobalFileSyncState, String> {
    let settings = load_settings()?;
    let instances = instance_map()?;
    let all_target_count = instances.len().saturating_sub(1);
    let voice_targets = settings
        .voice_chat_targets
        .iter()
        .filter(|id| instances.contains_key(*id))
        .count();
    let statuses = vec![
        status_for_file(
            "options",
            &settings.options_source,
            OPTIONS_FILE,
            all_target_count,
            &instances,
        ),
        status_for_file(
            "servers",
            &settings.servers_source,
            SERVERS_FILE,
            all_target_count,
            &instances,
        ),
        status_for_file(
            "voicechat",
            &settings.voice_chat_source,
            VOICE_CHAT_FILE,
            voice_targets,
            &instances,
        ),
        shared_status(
            "resourcepacks",
            "resourcepacks",
            settings.share_resource_packs,
            &instances,
        )?,
        shared_status(
            "shaderpacks",
            "shaderpacks",
            settings.share_shader_packs,
            &instances,
        )?,
    ];
    Ok(GlobalFileSyncState {
        settings,
        statuses,
        backup_root: utility_root()?
            .join("backups")
            .to_string_lossy()
            .to_string(),
    })
}

#[tauri::command]
pub async fn get_global_file_sync_state() -> Result<GlobalFileSyncState, String> {
    tauri::async_runtime::spawn_blocking(get_state_blocking)
        .await
        .map_err(|error| format!("Global File Sync stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub async fn save_global_file_sync_settings(
    settings: GlobalFileSyncSettings,
) -> Result<GlobalFileSyncState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_settings(&settings, &instance_map()?)?;
        save_settings(&settings)?;
        get_state_blocking()
    })
    .await
    .map_err(|error| format!("Global File Sync stopped unexpectedly: {error}"))?
}

fn validate_settings(
    settings: &GlobalFileSyncSettings,
    instances: &HashMap<String, InstanceConfig>,
) -> Result<(), String> {
    for source in [
        &settings.options_source,
        &settings.servers_source,
        &settings.voice_chat_source,
    ] {
        if let Some(source) = source {
            if !instances.contains_key(source) {
                return Err("A selected source instance no longer exists.".into());
            }
        }
    }
    if settings
        .voice_chat_targets
        .iter()
        .any(|target| !instances.contains_key(target))
    {
        return Err("A selected Simple Voice Chat destination no longer exists.".into());
    }
    Ok(())
}

fn apply_sync_blocking(settings: GlobalFileSyncSettings) -> Result<GlobalFileSyncReport, String> {
    let instances = instance_map()?;
    validate_settings(&settings, &instances)?;
    let run_backup = utility_root()?.join("backups").join(timestamp_label());
    let all_ids = instances.keys().cloned().collect::<Vec<_>>();
    let mut changed_files = 0;
    let mut unchanged_files = 0;

    if let Some(source) = settings.options_source.as_deref() {
        sync_file_to_instances(
            &instances,
            source,
            &all_ids,
            OPTIONS_FILE,
            &run_backup,
            &mut changed_files,
            &mut unchanged_files,
        )?;
    }
    if let Some(source) = settings.servers_source.as_deref() {
        sync_file_to_instances(
            &instances,
            source,
            &all_ids,
            SERVERS_FILE,
            &run_backup,
            &mut changed_files,
            &mut unchanged_files,
        )?;
    }
    if let Some(source) = settings.voice_chat_source.as_deref() {
        sync_file_to_instances(
            &instances,
            source,
            &settings.voice_chat_targets,
            VOICE_CHAT_FILE,
            &run_backup,
            &mut changed_files,
            &mut unchanged_files,
        )?;
    }

    let mut linked_folders = 0;
    let mut detached_folders = 0;
    if settings.share_resource_packs {
        linked_folders += connect_shared_folder(&instances, "resourcepacks", &run_backup)?;
    } else {
        detached_folders += disconnect_shared_folder(&instances, "resourcepacks")?;
    }
    if settings.share_shader_packs {
        linked_folders += connect_shared_folder(&instances, "shaderpacks", &run_backup)?;
    } else {
        detached_folders += disconnect_shared_folder(&instances, "shaderpacks")?;
    }
    save_settings(&settings)?;
    save_active_settings(&settings)?;

    let backup_path = if run_backup.exists() {
        Some(run_backup.to_string_lossy().to_string())
    } else {
        None
    };
    Ok(GlobalFileSyncReport {
        changed_files,
        unchanged_files,
        linked_folders,
        detached_folders,
        backup_path,
    })
}

pub(super) fn apply_active_setup_to_instance(config: &InstanceConfig) -> Result<(), String> {
    let Some(settings) = load_active_settings()? else {
        return Ok(());
    };
    let mut instances = instance_map()?;
    instances.insert(config.id.clone(), config.clone());
    validate_settings(&settings, &instances)?;

    let backup_root = utility_root()?.join("backups").join(timestamp_label());
    let target = vec![config.id.clone()];
    let mut changed = 0;
    let mut unchanged = 0;
    if let Some(source) = settings.options_source.as_deref() {
        sync_file_to_instances(
            &instances,
            source,
            &target,
            OPTIONS_FILE,
            &backup_root,
            &mut changed,
            &mut unchanged,
        )?;
    }
    if let Some(source) = settings.servers_source.as_deref() {
        sync_file_to_instances(
            &instances,
            source,
            &target,
            SERVERS_FILE,
            &backup_root,
            &mut changed,
            &mut unchanged,
        )?;
    }
    if settings.voice_chat_targets.contains(&config.id) {
        if let Some(source) = settings.voice_chat_source.as_deref() {
            sync_file_to_instances(
                &instances,
                source,
                &target,
                VOICE_CHAT_FILE,
                &backup_root,
                &mut changed,
                &mut unchanged,
            )?;
        }
    }
    if settings.share_resource_packs {
        connect_shared_folder(&instances, "resourcepacks", &backup_root)?;
    }
    if settings.share_shader_packs {
        connect_shared_folder(&instances, "shaderpacks", &backup_root)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn apply_global_file_sync(
    settings: GlobalFileSyncSettings,
) -> Result<GlobalFileSyncReport, String> {
    tauri::async_runtime::spawn_blocking(move || apply_sync_blocking(settings))
        .await
        .map_err(|error| format!("Global File Sync stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub fn open_global_sync_folder(category: String) -> Result<(), String> {
    let target = match category.as_str() {
        "resourcepacks" | "shaderpacks" => utility_root()?.join("shared").join(category),
        "backups" => utility_root()?.join("backups"),
        _ => return Err("Unsupported Global File Sync folder.".into()),
    };
    std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    tauri_plugin_opener::open_path(&target, None::<&str>)
        .map_err(|error| format!("Bloom could not open the Global File Sync folder: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_instance(id: &str, directory: &Path) -> InstanceConfig {
        InstanceConfig {
            id: id.to_string(),
            name: id.to_string(),
            icon: None,
            loader: "Fabric".to_string(),
            loader_version: None,
            version: "1.21.1".to_string(),
            directory: directory.to_string_lossy().to_string(),
            java: "Automatic".to_string(),
            memory: 4096,
            jvm_arguments: String::new(),
            mods: true,
            resource_packs: true,
            shader_packs: true,
            config: true,
            custom_resolution: false,
            visible: true,
            shortcut: false,
        }
    }

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "bloom-global-sync-{label}-{}-{}",
            std::process::id(),
            timestamp_label()
        ))
    }

    #[test]
    fn file_sync_replaces_destination_after_backup() {
        let root = test_root("files");
        let source_dir = root.join("source");
        let target_dir = root.join("target");
        let backup_dir = root.join("backups");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&target_dir).unwrap();
        std::fs::write(source_dir.join(OPTIONS_FILE), b"source").unwrap();
        std::fs::write(target_dir.join(OPTIONS_FILE), b"target").unwrap();
        let instances = HashMap::from([
            ("source".to_string(), test_instance("source", &source_dir)),
            ("target".to_string(), test_instance("target", &target_dir)),
        ]);
        let mut changed = 0;
        let mut unchanged = 0;
        sync_file_to_instances(
            &instances,
            "source",
            &["target".to_string()],
            OPTIONS_FILE,
            &backup_dir,
            &mut changed,
            &mut unchanged,
        )
        .unwrap();
        assert_eq!(changed, 1);
        assert_eq!(unchanged, 0);
        assert_eq!(
            std::fs::read(target_dir.join(OPTIONS_FILE)).unwrap(),
            b"source"
        );
        assert_eq!(
            std::fs::read(backup_dir.join("target").join(OPTIONS_FILE)).unwrap(),
            b"target"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn shared_merge_keeps_conflicting_files() {
        let root = test_root("merge");
        let source = root.join("source");
        let destination = root.join("shared");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&destination).unwrap();
        std::fs::write(source.join("pack.zip"), b"new").unwrap();
        std::fs::write(destination.join("pack.zip"), b"existing").unwrap();
        copy_directory_merge(&source, &destination, "creative").unwrap();
        assert_eq!(
            std::fs::read(destination.join("pack.zip")).unwrap(),
            b"existing"
        );
        assert_eq!(
            std::fs::read(destination.join("pack-from-creative.zip")).unwrap(),
            b"new"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
