use super::{Hardware, Path, PathBuf};
use crate::command_without_console;
pub const JAVA_PROVIDER_OS: &str = "windows";
pub const JAVA_ARCHIVE_EXTENSION: &str = "zip";
pub const JAVA_EXECUTABLE: &str = "javaw.exe";
pub const DEVICE_NAME: &str = "Bloom Client on Windows";
pub fn data_directory() -> Result<PathBuf, String> {
    Ok(appdata()?.join("BloomClient"))
}
fn appdata() -> Result<PathBuf, String> {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .map_err(|_| "APPDATA is unavailable on this computer.".into())
}
pub fn game_directory() -> Result<PathBuf, String> {
    Ok(appdata()?.join(".minecraft"))
}
pub fn open_folder(path: &Path) -> Result<(), String> {
    command_without_console("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
pub fn launch_java(path: PathBuf) -> PathBuf {
    let javaw = path.with_file_name("javaw.exe");
    if javaw.is_file() {
        javaw
    } else {
        path
    }
}
pub fn java_matches_host(_: &Path) -> bool {
    true
}
pub fn discover_java() -> Vec<String> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        for entry in std::env::split_paths(&path) {
            let java = entry.join("java.exe");
            if java.exists() {
                candidates.push(java.to_string_lossy().to_string());
            }
        }
    }
    for root in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(base) = std::env::var(root) {
            for folder in ["Java", "Eclipse Adoptium", "Microsoft"] {
                let parent = std::path::PathBuf::from(&base).join(folder);
                if let Ok(entries) = std::fs::read_dir(parent) {
                    for entry in entries.flatten() {
                        let java = entry.path().join("bin").join("java.exe");
                        if java.exists() {
                            candidates.push(java.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }
    candidates
}
pub fn detect_hardware() -> Result<Hardware, String> {
    let script = r#"$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; $system=Get-CimInstance Win32_ComputerSystem; $video=@(Get-CimInstance Win32_VideoController); [pscustomobject]@{cpu=[string]$cpu.Name;cores=[uint32]$cpu.NumberOfCores;threads=[uint32]$cpu.NumberOfLogicalProcessors;ramBytes=[uint64]$system.TotalPhysicalMemory;gpus=@($video | ForEach-Object {[string]$_.Name});refreshRate=[uint32](($video | Measure-Object CurrentRefreshRate -Maximum).Maximum)} | ConvertTo-Json -Compress"#;
    let output = command_without_console("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|error| format!("Hardware scan could not start: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Hardware scan failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let hardware: Hardware = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Hardware scan returned invalid data: {error}"))?;
    Ok(hardware)
}
