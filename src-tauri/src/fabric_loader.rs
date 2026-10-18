use crate::InstanceConfig;
use std::io::Read;

fn configured(config: &InstanceConfig) -> Option<&str> {
    config
        .loader_version
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn logged_version(log: &str, minecraft_version: &str) -> Option<String> {
    log.lines().find_map(|line| {
        let (_, startup) = line.split_once("Loading Minecraft ")?;
        let (minecraft, loader) = startup.split_once(" with Fabric Loader ")?;
        let loader = loader.trim();
        // Only accept the exact game version and a loader version, never log text or URL/path data.
        (minecraft == minecraft_version
            && !loader.is_empty()
            && loader.len() <= 80
            && loader.as_bytes()[0].is_ascii_digit()
            && loader.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+' | b'_')
            }))
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
