use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(super) struct Stamp {
    path: PathBuf,
    size: u64,
    modified: u128,
    directory: bool,
    children: Option<Vec<String>>,
}
impl Stamp {
    pub(super) fn read(path: &Path) -> Option<Self> {
        let metadata = std::fs::metadata(path).ok()?;
        let children = if metadata.is_dir() {
            let mut entries = std::fs::read_dir(path)
                .ok()?
                .map(|entry| {
                    entry
                        .ok()
                        .map(|entry| entry.file_name().to_string_lossy().into_owned())
                })
                .collect::<Option<Vec<_>>>()?;
            entries.sort();
            Some(entries)
        } else {
            None
        };
        Some(Self {
            path: path.to_owned(),
            size: metadata.len(),
            modified: metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_nanos(),
            directory: metadata.is_dir(),
            children,
        })
    }
    fn unchanged(&self) -> bool {
        Self::read(&self.path).as_ref() == Some(self)
    }
}
#[derive(Serialize, Deserialize)]
pub(super) struct Receipt {
    version: u8,
    pub(super) version_id: String,
    created: u64,
    files: Vec<Stamp>,
}
pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
impl Receipt {
    pub(super) fn capture(version_id: String, paths: Vec<PathBuf>) -> Option<Self> {
        let mut paths = paths;
        paths.sort();
        paths.dedup();
        let files: Option<Vec<_>> = paths.iter().map(|p| Stamp::read(p)).collect();
        Some(Self {
            version: 1,
            version_id,
            created: now(),
            files: files?,
        })
    }
    pub(super) fn valid(&self) -> bool {
        self.version == 1
            && now() >= self.created
            && now() - self.created < 86400
            && !self.files.is_empty()
            && self.files.iter().all(Stamp::unchanged)
    }
}
pub(super) fn tree(path: &Path, output: &mut Vec<PathBuf>) -> std::io::Result<()> {
    fn visit(
        path: &Path,
        output: &mut Vec<PathBuf>,
        seen: &mut std::collections::HashSet<PathBuf>,
        depth: usize,
    ) -> std::io::Result<()> {
        if depth > 16 || output.len() > 100_000 || !seen.insert(path.canonicalize()?) {
            return Err(std::io::Error::other(
                "Unbounded or repeated launch-cache directory",
            ));
        }
        output.push(path.to_owned());
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            if entry.file_type()?.is_symlink() {
                return Err(std::io::Error::other("Untracked symbolic link"));
            }
            if entry.file_type()?.is_dir() {
                visit(&entry.path(), output, seen, depth + 1)?;
            } else {
                if output.len() > 100_000 {
                    return Err(std::io::Error::other("Too many cache inputs"));
                }
                output.push(entry.path());
            }
        }
        Ok(())
    }
    visit(path, output, &mut std::collections::HashSet::new(), 0)
}
pub(super) fn key(config: &super::InstanceConfig, root: &Path) -> String {
    format!(
        "v1:{}:{}:{}:{:?}:{}:{}:{}",
        root.display(),
        config.directory,
        config.version,
        config.loader_version,
        config.loader,
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}
pub(super) fn fresh_session(expires: u64, now: u64) -> bool {
    expires > now.saturating_add(120) && expires <= now.saturating_add(86400)
}

pub(super) struct AbortTask<T>(pub(super) tauri::async_runtime::JoinHandle<T>);
impl<T> Drop for AbortTask<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(super) fn reusable(config: &super::InstanceConfig) -> bool {
    !config.loader.eq_ignore_ascii_case("fabric") || config.loader_version.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn receipts_reject_changed_missing_and_added_native_files() {
        let root = std::env::temp_dir().join(format!("bloom-launch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let file = root.join("native.dll");
        std::fs::write(&file, b"original").unwrap();
        let mut files = Vec::new();
        tree(&root, &mut files).unwrap();
        let receipt = Receipt::capture("test".into(), files).unwrap();
        assert!(receipt.valid());
        std::fs::write(&file, b"changed length").unwrap();
        assert!(!receipt.valid());
        let receipt = Receipt::capture("test".into(), vec![file.clone()]).unwrap();
        std::fs::remove_file(file).unwrap();
        assert!(!receipt.valid());
        let receipt = Receipt::capture("test".into(), vec![root.clone()]).unwrap();
        std::fs::write(root.join("extra.dll"), b"extra").unwrap();
        assert!(!receipt.valid());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn session_expiry_is_conservative() {
        assert!(!fresh_session(0, 1000));
        assert!(!fresh_session(1120, 1000));
        assert!(fresh_session(2000, 1000));
        assert!(!fresh_session(u64::MAX, 1000));
    }
    #[test]
    fn legacy_accounts_have_unknown_expiry_and_force_refresh() {
        let session: crate::MinecraftSession = serde_json::from_value(serde_json::json!({
            "username":"test", "uuid":"test", "access_token":"dummy", "refresh_token":"dummy", "client_id":"test"
        })).unwrap();
        assert_eq!(session.expires_at, 0);
        assert!(!fresh_session(session.expires_at, now()));
    }
    #[test]
    fn missing_inputs_never_create_a_valid_receipt() {
        let path = std::env::temp_dir().join(format!("bloom-missing-{}", uuid::Uuid::new_v4()));
        assert!(Receipt::capture("test".into(), vec![path]).is_none());
        assert!(!Receipt::capture("empty".into(), vec![]).unwrap().valid());
    }
    #[test]
    fn receipts_expire_and_old_formats_fail_closed() {
        let path = std::env::temp_dir().join(format!("bloom-launch-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"test").unwrap();
        let mut r = Receipt::capture("test".into(), vec![path.clone()]).unwrap();
        r.created = now() - 86401;
        assert!(!r.valid());
        r.created = now();
        r.version = 0;
        assert!(!r.valid());
        std::fs::remove_file(path).unwrap();
    }
}
