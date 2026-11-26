use crate::InstanceConfig;
use std::io::Read;

#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub(crate) struct LoaderVersion {
    pub(super) version: String,
    pub(super) stable: bool,
}

#[derive(serde::Deserialize)]
struct LoaderEntry {
    loader: LoaderVersion,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoaderOptions {
    current_version: Option<String>,
    versions: Vec<LoaderVersion>,
}

fn safe_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value.as_bytes()[0].is_ascii_digit()
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+' | b'_'))
}

pub(super) async fn available(minecraft_version: &str) -> Result<Vec<LoaderVersion>, String> {
    let mut url = reqwest::Url::parse("https://meta.fabricmc.net/v2/versions/loader/").unwrap();
    url.path_segments_mut().unwrap().pop_if_empty().push(minecraft_version);
    let entries = super::bloom_http_client()?
        .get(url)
        .timeout(std::time::Duration::from_secs(15))
        .send().await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Could not load Fabric versions. Check your connection and retry: {error}"))?
        .json::<Vec<LoaderEntry>>().await
        .map_err(|error| format!("Fabric returned unreadable loader versions: {error}"))?;
    let mut seen = std::collections::HashSet::new();
    let versions: Vec<_> = entries.into_iter().map(|entry| entry.loader)
        .filter(|loader| safe_version(&loader.version) && seen.insert(loader.version.clone())).collect();
    if versions.is_empty() {
        return Err(format!("Fabric has no loader versions for Minecraft {minecraft_version}."));
    }
    Ok(versions)
}

#[tauri::command]
pub(crate) async fn list_instance_fabric_loaders(instance_id: String) -> Result<LoaderOptions, String> {
    let config = super::load_instance(&instance_id)?;
    if !config.loader.eq_ignore_ascii_case("fabric") {
        return Err("This instance does not use Fabric.".into());
    }
    let current_version = current_version(&config);
    let versions = available(&config.version).await?;
    Ok(LoaderOptions { current_version, versions })
}

// None means leave the persisted pin alone, including callers predating this setting.
pub(super) fn requested_change(config: &InstanceConfig, requested: Option<&str>) -> Result<Option<String>, String> {
    let Some(version) = requested else { return Ok(None); };
    if !config.loader.eq_ignore_ascii_case("fabric") {
        return Err("Only Fabric instances have a Fabric Loader version.".into());
    }
    let version = version.trim();
    if !safe_version(version) {
        return Err("Choose a valid Fabric Loader version from the list.".into());
    }
    Ok((configured(config) != Some(version)).then(|| version.to_owned()))
}

pub(super) fn check_available(version: &str, versions: &[LoaderVersion]) -> Result<(), String> {
    if !versions.iter().any(|loader| loader.version == version) {
        return Err("That Fabric Loader version is no longer available for this Minecraft version. Reload the version list and choose again.".into());
    }
    Ok(())
}

pub(super) fn apply_change(current: &mut InstanceConfig, expected: &InstanceConfig, version: String, busy: bool) -> Result<(), String> {
    if busy {
        return Err("Close Minecraft and wait for active downloads before changing Fabric Loader.".into());
    }
    if current.id != expected.id || current.loader != expected.loader || current.version != expected.version
        || current.directory != expected.directory || configured(current) != configured(expected) {
        return Err("The instance changed while checking Fabric Loader. Reopen its settings and try again.".into());
    }
    current.loader_version = Some(version);
    Ok(())
}

fn configured(config: &InstanceConfig) -> Option<&str> {
    config
        .loader_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(super) fn current_version(config: &InstanceConfig) -> Option<String> {
    configured(config).map(str::to_owned).or_else(|| installed(config))
}

fn logged_version(log: &str, minecraft_version: &str) -> Option<String> {
    log.lines().find_map(|line| {
        let (_, startup) = line.split_once("Loading Minecraft ")?;
        let (minecraft, loader) = startup.split_once(" with Fabric Loader ")?;
        let loader = loader.trim();
        // Only accept the exact game version and a loader version, never log text or URL/path data.
        (minecraft == minecraft_version && safe_version(loader))
        .then(|| loader.to_owned())
    })
}

fn installed(config: &InstanceConfig) -> Option<String> {
    let path = std::path::Path::new(&config.directory)
        .join("logs")
        .join("latest.log");
    let mut log = Vec::new();
    // Fabric writes its identity at startup; do not scan an arbitrarily large game log.
    std::fs::File::open(path)
        .ok()?
        .take(64 * 1024)
        .read_to_end(&mut log)
        .ok()?;
    logged_version(&String::from_utf8_lossy(&log), &config.version)
}

fn resolve_with(
    config: &InstanceConfig,
    latest: impl FnOnce() -> Result<String, String>,
) -> Result<String, String> {
    if let Some(version) = configured(config) {
        return Ok(version.to_owned());
    }
    if let Some(version) = installed(config) {
        return Ok(version);
    }
    latest().map_err(|error| format!("Could not resolve Fabric Loader automatically. Check your connection and try again: {error}"))
}

pub(super) fn resolve(config: &InstanceConfig) -> Result<String, String> {
    resolve_with(config, || {
        let loaders = mc_launcher_core::loader::fabric::list_loader_versions()
            .map_err(|error| error.to_string())?;
        Ok(
            mc_launcher_core::loader::fabric::latest_stable_loader(&loaders)
                .map_err(|error| error.to_string())?
                .version
                .clone(),
        )
    })
}

fn pin_missing_version(
    current: &mut InstanceConfig,
    expected: &InstanceConfig,
    version: &str,
) -> bool {
    if current.loader.eq_ignore_ascii_case("fabric")
        && current.id == expected.id
        && current.version == expected.version
        && current.directory == expected.directory
        && configured(current).is_none()
    {
        current.loader_version = Some(version.to_owned());
        return true;
    }
    false
}

pub(super) fn remember(config: &InstanceConfig, version: &str) -> Result<(), String> {
    if configured(config).is_some() {
        return Ok(());
    }
    // Reload to preserve settings edited while a download or share was being prepared.
    let mut current = super::load_instance(&config.id)?;
    if pin_missing_version(&mut current, config, version) {
        super::write_instance(&current).map_err(|error| {
            format!("Could not save the resolved Fabric Loader version: {error}")
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> InstanceConfig {
        serde_json::from_value(serde_json::json!({
            "id":"fabric-test", "name":"Fabric Test", "loader":"Fabric", "loaderVersion":null,
            "version":"1.21.11", "directory":"unused-test-directory", "java":"auto", "memory":2048,
            "jvmArguments":"", "mods":true, "resourcePacks":true, "shaderPacks":true,
            "config":true, "customResolution":false, "visible":true, "shortcut":false
        }))
        .unwrap()
    }

    #[test]
    fn setting_omission_and_same_version_preserve_existing_pins_offline() {
        let mut current = config();
        current.loader_version = Some("0.18.4".into());
        assert_eq!(requested_change(&current, None).unwrap(), None);
        assert_eq!(requested_change(&current, Some(" 0.18.4 ")).unwrap(), None);
        current.loader = "Vanilla".into();
        assert_eq!(requested_change(&current, None).unwrap(), None);
        assert!(requested_change(&current, Some("0.18.4")).is_err());
    }

    #[test]
    fn settings_reject_unsafe_or_unpublished_versions() {
        for value in ["", " ", "../../loader", "0.18/4", "0.18.4?query", "0.18.4 extra"] {
            assert!(requested_change(&config(), Some(value)).is_err());
        }
        let versions = vec![LoaderVersion { version: "0.18.4".into(), stable: true }];
        assert!(check_available("0.18.4", &versions).is_ok());
        assert!(check_available("0.19.0", &versions).is_err());
        assert!(check_available("0.18.4", &[]).is_err());
    }

    #[test]
    fn upgrade_and_downgrade_change_launch_cache_and_preserve_other_settings() {
        let mut current = config();
        current.loader_version = Some("0.18.4".into());
        current.jvm_arguments = "-Dexample=true".into();
        let root = std::path::Path::new("test-root");
        for version in ["0.19.0", "0.17.3"] {
            let expected = current.clone();
            let old_key = crate::launch_cache::key(&expected, root);
            let change = requested_change(&expected, Some(version)).unwrap().unwrap();
            // A concurrent artwork edit is preserved when applying the checked loader choice.
            current.icon = Some("data:image/png;base64,test".into());
            apply_change(&mut current, &expected, change, false).unwrap();
            let restored: InstanceConfig = serde_json::from_slice(&serde_json::to_vec(&current).unwrap()).unwrap();
            assert_eq!(resolve_with(&restored, || panic!("must use the saved loader")).unwrap(), version);
            assert_ne!(crate::launch_cache::key(&restored, root), old_key);
            assert_eq!(restored.jvm_arguments, "-Dexample=true");
            assert_eq!(restored.memory, expected.memory);
            assert_eq!(restored.version, expected.version);
            assert_eq!(restored.icon, current.icon);
        }
    }

    #[test]
    fn changing_loader_rechecks_busy_and_target_after_metadata() {
        let expected = config();
        for field in ["busy", "id", "loader", "minecraft", "directory", "pin"] {
            let mut current = expected.clone();
            match field {
                "id" => current.id = "other".into(),
                "loader" => current.loader = "Vanilla".into(),
                "minecraft" => current.version = "26.3".into(),
                "directory" => current.directory = "other".into(),
                "pin" => current.loader_version = Some("0.20.0".into()),
                _ => {}
            }
            let before = serde_json::to_value(&current).unwrap();
            assert!(apply_change(&mut current, &expected, "0.18.4".into(), field == "busy").is_err());
            assert_eq!(serde_json::to_value(&current).unwrap(), before);
        }
    }

    #[test]
    fn explicit_versions_never_use_automatic_resolution() {
        let mut config = config();
        config.loader_version = Some(" 0.18.4 ".into());
        assert_eq!(
            resolve_with(&config, || panic!("must not request metadata")).unwrap(),
            "0.18.4"
        );
    }

    #[test]
    fn missing_and_blank_versions_use_the_launch_fallback() {
        for value in [None, Some("".into()), Some("  \t".into())] {
            let mut config = config();
            config.loader_version = value;
            assert_eq!(
                resolve_with(&config, || Ok("0.18.4".into())).unwrap(),
                "0.18.4"
            );
        }
    }

    #[test]
    fn startup_identity_requires_matching_minecraft_and_a_safe_loader_version() {
        let log = "[12:00:00] [main/INFO] (FabricLoader/GameProvider) Loading Minecraft 1.21.11 with Fabric Loader 0.18.4\n";
        assert_eq!(logged_version(log, "1.21.11").as_deref(), Some("0.18.4"));
        assert!(logged_version(log, "26.1").is_none());
        for value in [
            "",
            "../../loader",
            "0.18.4/other",
            "0.18.4?query",
            "0.18.4 extra text",
        ] {
            assert!(logged_version(
                &format!("Loading Minecraft 1.21.11 with Fabric Loader {value}"),
                "1.21.11"
            )
            .is_none());
        }
        assert_eq!(
            logged_version(
                "Loading Minecraft 26.3 with Fabric Loader 0.19.0-beta.1",
                "26.3"
            )
            .as_deref(),
            Some("0.19.0-beta.1")
        );
    }

    #[test]
    fn legacy_instances_recover_their_own_installed_version_without_network() {
        let directory = std::env::temp_dir().join(format!("bloom-fabric-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(directory.join("logs")).unwrap();
        std::fs::write(
            directory.join("logs/latest.log"),
            "[main/INFO]: Loading Minecraft 1.21.11 with Fabric Loader 0.18.4\n",
        )
        .unwrap();
        let mut config = config();
        config.directory = directory.to_string_lossy().into_owned();
        assert_eq!(
            resolve_with(&config, || panic!("must preserve the installed loader")).unwrap(),
            "0.18.4"
        );
        config.version = "26.1".into();
        assert_eq!(
            resolve_with(&config, || Ok("0.19.0".into())).unwrap(),
            "0.19.0"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn log_recovery_is_bounded_and_tolerates_unrelated_encoding_errors() {
        let directory = std::env::temp_dir().join(format!("bloom-fabric-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(directory.join("logs")).unwrap();
        let path = directory.join("logs/latest.log");
        let mut bytes = b"Loading Minecraft 1.21.11 with Fabric Loader 0.18.4\n".to_vec();
        bytes.extend_from_slice(&[0xff, 0xfe]);
        std::fs::write(&path, bytes).unwrap();
        let mut config = config();
        config.directory = directory.to_string_lossy().into_owned();
        assert_eq!(
            resolve_with(&config, || panic!("startup identity remains readable")).unwrap(),
            "0.18.4"
        );
        let mut bytes = vec![b' '; 64 * 1024];
        bytes.extend_from_slice(b"\nLoading Minecraft 1.21.11 with Fabric Loader 0.18.4\n");
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(
            resolve_with(&config, || Ok("0.19.0".into())).unwrap(),
            "0.19.0"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unavailable_metadata_returns_an_actionable_error() {
        let error = resolve_with(&config(), || Err("offline".into())).unwrap_err();
        assert!(error.contains("Check your connection"));
        assert!(error.contains("offline"));
    }

    #[test]
    fn remembering_a_version_preserves_newer_instance_settings() {
        let expected = config();
        let mut current = expected.clone();
        current.memory = 8192;
        current.name = "Renamed".into();
        current.jvm_arguments = "-Dexample=true".into();
        assert!(pin_missing_version(&mut current, &expected, "0.18.4"));
        assert_eq!(current.loader_version.as_deref(), Some("0.18.4"));
        assert_eq!(current.memory, 8192);
        assert_eq!(current.name, "Renamed");
        assert_eq!(current.jvm_arguments, "-Dexample=true");
    }

    #[test]
    fn remembering_never_overwrites_an_explicit_version_or_changed_target() {
        let expected = config();
        for field in ["loader", "version", "directory", "id", "loader_version"] {
            let mut current = expected.clone();
            match field {
                "loader" => current.loader = "Vanilla".into(),
                "version" => current.version = "26.1".into(),
                "directory" => current.directory = "different-instance".into(),
                "id" => current.id = "other-instance".into(),
                _ => current.loader_version = Some("0.19.0".into()),
            }
            let before = serde_json::to_value(&current).unwrap();
            assert!(!pin_missing_version(&mut current, &expected, "0.18.4"));
            assert_eq!(serde_json::to_value(&current).unwrap(), before);
        }
    }
}
