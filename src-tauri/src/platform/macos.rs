use super::{Hardware, Path, PathBuf};
use crate::command_without_console;

pub const JAVA_PROVIDER_OS: &str = "mac";
pub const JAVA_ARCHIVE_EXTENSION: &str = "tar.gz";
pub const JAVA_EXECUTABLE: &str = "java";
pub const DEVICE_NAME: &str = "Bloom Client on macOS";

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| "The macOS home directory is unavailable.".into())
}
pub fn data_directory() -> Result<PathBuf, String> {
    Ok(home()?.join("Library/Application Support/BloomClient"))
}
pub fn game_directory() -> Result<PathBuf, String> {
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

fn sysctl(name: &str) -> Result<String, String> {
    let output = command_without_console("/usr/sbin/sysctl")
        .args(["-n", name])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!("macOS could not read {name}."));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn detect_hardware() -> Result<Hardware, String> {
    let cpu = sysctl("machdep.cpu.brand_string").or_else(|_| sysctl("hw.model"))?;
    let ram_bytes = sysctl("hw.memsize")?
        .parse()
        .map_err(|_| "macOS returned invalid memory information.")?;
    let cores = sysctl("hw.physicalcpu")?
        .parse()
        .map_err(|_| "macOS returned invalid CPU information.")?;
    let threads = sysctl("hw.logicalcpu")?
        .parse()
        .map_err(|_| "macOS returned invalid CPU information.")?;
    let output = command_without_console("/usr/sbin/system_profiler")
        .args([
            "SPDisplaysDataType",
            "-json",
            "-detailLevel",
            "mini",
            "-timeout",
            "10",
        ])
        .output();
    let gpus = output
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| serde_json::from_slice::<serde_json::Value>(&o.stdout).ok())
        .and_then(|value| {
            value["SPDisplaysDataType"].as_array().map(|items| {
                items
                    .iter()
                    .filter_map(|gpu| gpu["sppci_model"].as_str().map(str::to_owned))
                    .collect()
            })
        })
        .unwrap_or_default();
    Ok(Hardware {
        cpu,
        cores,
        threads,
        ram_bytes,
        gpus,
        refresh_rate: display_refresh_rate(),
    })
}

fn display_refresh_rate() -> Option<u32> {
    use std::ffi::c_void;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGMainDisplayID() -> u32;
        fn CGDisplayCopyDisplayMode(display: u32) -> *const c_void;
        fn CGDisplayModeGetRefreshRate(mode: *const c_void) -> f64;
        fn CGDisplayModeRelease(mode: *const c_void);
    }
    // Copy returns a retained display mode. Some variable-refresh modes report 0: keep that unknown.
    unsafe {
        let mode = CGDisplayCopyDisplayMode(CGMainDisplayID());
        if mode.is_null() {
            return None;
        }
        let hz = CGDisplayModeGetRefreshRate(mode);
        CGDisplayModeRelease(mode);
        (hz.is_finite() && hz >= 1.0).then_some(hz.round() as u32)
    }
}
