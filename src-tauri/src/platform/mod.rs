//! OS integration belongs here. Shared launcher behavior must not depend on Windows paths.
use std::path::{Path, PathBuf};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::*;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;
#[cfg(not(any(windows, target_os = "macos")))]
mod unix;
#[cfg(not(any(windows, target_os = "macos")))]
pub use unix::*;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub cpu: String,
    pub cores: u32,
    pub threads: u32,
    pub ram_bytes: u64,
    pub gpus: Vec<String>,
    pub refresh_rate: Option<u32>,
}

pub fn default_game_alias(directory: &str) -> Result<Option<PathBuf>, String> {
    let normalized = directory.replace('\\', "/");
    if normalized == ".minecraft" {
        return game_directory().map(Some);
    }
    if let Some(relative) = normalized.strip_prefix(".minecraft/") {
        // This is a default-directory alias, not an escape from the game directory.
        if Path::new(relative).components().any(|part| {
            !matches!(
                part,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        }) {
            return Err("The default Minecraft directory cannot contain parent paths.".into());
        }
        return game_directory().map(|root| Some(root.join(relative)));
    }
    Ok(None)
}

pub fn java_library_stamp(java: &Path) -> PathBuf {
    if cfg!(windows) {
        java.parent().unwrap_or(java).join("server/jvm.dll")
    } else {
        java.parent()
            .and_then(Path::parent)
            .unwrap_or(java)
            .join(if cfg!(target_os = "macos") {
                "lib/server/libjvm.dylib"
            } else {
                "lib/server/libjvm.so"
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn platform_mac_bundle_override_deserializes_with_tauri() {
        let mut config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let patch: serde_json::Value = serde_json::from_str(include_str!("../../tauri.macos.conf.json")).unwrap();
        for (key, value) in patch["bundle"].as_object().unwrap() {
            config["bundle"][key] = value.clone();
        }
        // Use Tauri's actual schema types, including its platform-independent bundle enums.
        serde_json::from_value::<tauri::Config>(config).unwrap();
    }
    #[test]
    fn platform_alias_does_not_treat_arbitrary_relative_paths_as_minecraft() {
        assert_eq!(default_game_alias(".minecraft-other").unwrap(), None);
        assert_eq!(default_game_alias("/custom/location").unwrap(), None);
        assert!(default_game_alias(".minecraft/../../elsewhere").is_err());
        assert!(default_game_alias(".minecraft\\..\\elsewhere").is_err());
    }

    #[test]
    fn platform_default_aliases_keep_instance_subdirectories() {
        let root = game_directory().unwrap();
        assert_eq!(
            default_game_alias(".minecraft").unwrap(),
            Some(root.clone())
        );
        assert_eq!(
            default_game_alias(".minecraft/instances/example").unwrap(),
            Some(root.join("instances/example"))
        );
        assert_eq!(
            default_game_alias(".minecraft\\instances\\example").unwrap(),
            Some(root.join("instances/example"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn platform_windows_locations_and_runtime_format_remain_compatible() {
        let appdata = PathBuf::from(std::env::var_os("APPDATA").unwrap());
        assert_eq!(data_directory().unwrap(), appdata.join("BloomClient"));
        assert_eq!(game_directory().unwrap(), appdata.join(".minecraft"));
        assert_eq!(JAVA_PROVIDER_OS, "windows");
        assert_eq!(JAVA_ARCHIVE_EXTENSION, "zip");
        assert_eq!(JAVA_EXECUTABLE, "javaw.exe");
        assert_eq!(
            java_library_stamp(Path::new("C:/Java/bin/javaw.exe")),
            Path::new("C:/Java/bin/server/jvm.dll")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn platform_mac_locations_and_hardware_are_native() {
        let home = PathBuf::from(std::env::var_os("HOME").unwrap());
        assert_eq!(
            data_directory().unwrap(),
            home.join("Library/Application Support/BloomClient")
        );
        assert_eq!(
            game_directory().unwrap(),
            home.join("Library/Application Support/minecraft")
        );
        assert_eq!(JAVA_PROVIDER_OS, "mac");
        assert_eq!(JAVA_ARCHIVE_EXTENSION, "tar.gz");
        assert_eq!(
            java_library_stamp(Path::new("/jdk/Contents/Home/bin/java")),
            Path::new("/jdk/Contents/Home/lib/server/libjvm.dylib")
        );
        let hardware = detect_hardware().unwrap();
        assert!(hardware.ram_bytes > 0 && hardware.cores > 0 && hardware.threads > 0);
        assert!(!hardware.cpu.is_empty());
    }
}
