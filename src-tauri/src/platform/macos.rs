use super::{Path, PathBuf};
use crate::command_without_console;

pub const JAVA_PROVIDER_OS: &str = "mac";
pub const JAVA_ARCHIVE_EXTENSION: &str = "tar.gz";
pub const JAVA_EXECUTABLE: &str = "java";
pub const DEVICE_NAME: &str = "Delight Client on macOS";

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| "The macOS home directory is unavailable.".into())
}
pub fn data_directory() -> Result<PathBuf, String> {
    super::launcher_folder(&home()?.join("Library/Application Support"))
}
pub(super) fn legacy_game_directory() -> Result<PathBuf, String> {
    Ok(home()?.join("Library/Application Support/minecraft"))
}
pub fn open_folder(path: &Path) -> Result<(), String> {
    command_without_console("/usr/bin/open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}
pub fn launch_java(path: PathBuf) -> PathBuf {
    path
}

pub fn discover_java() -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(java_home) = std::env::var_os("JAVA_HOME") {
        candidates.push(PathBuf::from(java_home).join("bin/java"));
    }
    let mut roots = vec![PathBuf::from("/Library/Java/JavaVirtualMachines")];
    if let Ok(home) = home() {
        roots.push(home.join("Library/Java/JavaVirtualMachines"));
    }
    for root in roots {
        if let Ok(entries) = std::fs::read_dir(root) {
            candidates.extend(
                entries
                    .flatten()
                    .map(|entry| entry.path().join("Contents/Home/bin/java")),
            );
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|path| path.join("java")));
    }
    // Finder launches have a minimal PATH. Ask Apple's locator without invoking its install prompt.
    if let Ok(output) = command_without_console("/usr/libexec/java_home")
        .arg("-F")
        .output()
    {
        if output.status.success() {
            candidates.push(
                PathBuf::from(String::from_utf8_lossy(&output.stdout).trim()).join("bin/java"),
            );
        }
    }
    candidates
        .into_iter()
        .filter(|path| path.is_file() && path != Path::new("/usr/bin/java"))
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

pub fn java_matches_host(path: &Path) -> bool {
    let Ok(output) = command_without_console(path)
        .args(["-XshowSettings:properties", "-version"])
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    text.lines()
        .filter_map(|line| line.trim().strip_prefix("os.arch = "))
        .any(|arch| match std::env::consts::ARCH {
            "aarch64" => matches!(arch.trim(), "aarch64" | "arm64"),
            "x86_64" => matches!(arch.trim(), "x86_64" | "amd64"),
            _ => false,
        })
}
