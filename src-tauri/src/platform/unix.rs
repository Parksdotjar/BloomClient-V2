// Keep non-Mac Unix builds explicit; this task does not claim Linux feature parity.
use super::{Hardware, Path, PathBuf};
pub const JAVA_PROVIDER_OS: &str = "linux";
pub const JAVA_ARCHIVE_EXTENSION: &str = "tar.gz";
pub const JAVA_EXECUTABLE: &str = "java";
pub const DEVICE_NAME: &str = "Bloom Client on Linux";
fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or("HOME is unavailable.".into())
}
pub fn data_directory() -> Result<PathBuf, String> {
    Ok(std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or(home()?.join(".local/share"))
        .join("BloomClient"))
}
pub fn game_directory() -> Result<PathBuf, String> {
    Ok(home()?.join(".minecraft"))
}
pub fn open_folder(path: &Path) -> Result<(), String> {
    crate::command_without_console("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
pub fn launch_java(path: PathBuf) -> PathBuf {
    path
}
pub fn java_matches_host(_: &Path) -> bool {
    true
}
pub fn discover_java() -> Vec<String> {
    std::env::var_os("PATH")
        .map(|value| {
            std::env::split_paths(&value)
                .map(|p| p.join("java"))
                .filter(|p| p.is_file())
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}
pub fn detect_hardware() -> Result<Hardware, String> {
    Err("AutoTune hardware detection is currently supported on Windows and macOS.".into())
}
