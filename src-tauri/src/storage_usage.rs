use super::{
    bloom_data_dir, cache, list_instances_blocking, reserve_update_activity, LauncherState,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, Metadata},
    io,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const OLD_FILE_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const REVIEW_LIMIT: usize = 200;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceUsage {
    id: String,
    name: String,
    bytes: u64,
    worlds: u64,
    packs: u64,
    screenshots: u64,
    logs: u64,
    other: u64,
    unavailable: bool,
    shared_folder: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupItem {
    id: Uuid,
    name: String,
    location: String,
    bytes: u64,
    modified_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StorageUsage {
    total_bytes: u64,
    minecraft_bytes: u64,
    cache_bytes: u64,
    skipped: usize,
    instances: Vec<InstanceUsage>,
    cleanup: Vec<CleanupItem>,
    more_cleanup: bool,
}

struct ReviewedFile {
    item: CleanupItem,
    path: PathBuf,
    root: PathBuf,
    instance_id: Option<String>,
    modified: SystemTime,
}

fn reviewed_files() -> &'static Mutex<HashMap<Uuid, ReviewedFile>> {
    static REVIEW: OnceLock<Mutex<HashMap<Uuid, ReviewedFile>>> = OnceLock::new();
    REVIEW.get_or_init(|| Mutex::new(HashMap::new()))
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}

fn regular_path(path: &Path) -> io::Result<Metadata> {
    let metadata = fs::symlink_metadata(path)?;
    if is_link(&metadata) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Linked path"));
    }
    Ok(metadata)
}

fn safe_root(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Relative path"));
    }
    for ancestor in path.ancestors() {
        if !regular_path(ancestor)?.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Expected a folder",
            ));
        }
    }
    path.canonicalize()
}

fn walk_files(
    root: &Path,
    excluded: &HashSet<PathBuf>,
    mut file: impl FnMut(&Path, &Path, Metadata),
) -> usize {
    let mut folders = vec![root.to_owned()];
    let mut skipped = 0;
    while let Some(folder) = folders.pop() {
        if !regular_path(&folder).is_ok_and(|metadata| metadata.is_dir()) {
            skipped += 1;
            continue;
        }
        let Ok(entries) = fs::read_dir(&folder) else {
            skipped += 1;
            continue;
        };
        for entry in entries {
            let Ok(entry) = entry else {
                skipped += 1;
                continue;
            };
            let path = entry.path();
            if excluded.contains(&path) {
                continue;
            }
            match regular_path(&path) {
                Ok(metadata) if metadata.is_dir() => folders.push(path),
                Ok(metadata) if metadata.is_file() => {
                    file(
                        &path,
                        path.strip_prefix(root).expect("walk stays below its root"),
                        metadata,
                    );
                }
                Ok(_) | Err(_) => skipped += 1,
            }
        }
    }
    skipped
}

fn cleanup_name(relative: &Path, instance: bool) -> Option<String> {
    let parent = relative.parent()?;
    let name = relative.file_name()?.to_str()?;
    if instance {
        // Minecraft rolls logs into date-prefixed archives. The live logs are never eligible.
        let date = name.as_bytes().get(..10)?;
        let dated = date.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        });
        return (parent == Path::new("logs")
            && dated
            && (name.ends_with(".log.gz") || name.ends_with(".log")))
        .then(|| name.to_owned());
    }
    let digest = name.strip_suffix(".json")?;
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    match parent.to_str()? {
        "catalog-artwork" => Some("Cached mod artwork".into()),
        "rendered-thumbnails" => Some("Cached thumbnail".into()),
        "cosmetic-artwork" => Some("Cached cosmetic artwork".into()),
        _ => None,
    }
}

fn candidate(
    path: &Path,
    root: &Path,
    relative: &Path,
    metadata: &Metadata,
    instance_id: Option<&str>,
    location: &str,
    now: SystemTime,
) -> Option<ReviewedFile> {
    let modified = metadata.modified().ok()?;
    if now.duration_since(modified).ok()? < OLD_FILE_AGE || metadata.len() == 0 {
        return None;
    }
    Some(ReviewedFile {
        item: CleanupItem {
            id: Uuid::new_v4(),
            name: cleanup_name(relative, instance_id.is_some())?,
            location: location.into(),
            bytes: metadata.len(),
            modified_ms: modified.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64,
        },
        path: path.into(),
        root: root.into(),
        instance_id: instance_id.map(str::to_owned),
        modified,
    })
}

fn optional_root(path: &Path, skipped: &mut usize) -> Option<PathBuf> {
    match safe_root(path) {
        Ok(root) => Some(root),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(_) => {
            *skipped += 1;
            None
        }
    }
}

fn configured_cache() -> Result<PathBuf, String> {
    let path = PathBuf::from(cache::load_settings()?.directory);
    cache::validate_cache_directory(&path)?;
    Ok(path)
}

fn scan_storage() -> Result<StorageUsage, String> {
    let mut skipped = 0;
    let base = bloom_data_dir()?;
    let minecraft = optional_root(&base.join("minecraft"), &mut skipped);
    let cache = match configured_cache() {
        Ok(path) => optional_root(&path, &mut skipped),
        Err(_) => {
            skipped += 1;
            None
        }
    };
    let instances = list_instances_blocking()?
        .into_iter()
        .map(|instance| (safe_root(Path::new(&instance.directory)).ok(), instance))
        .collect::<Vec<_>>();
    let instance_roots: HashSet<_> = instances
        .iter()
        .filter_map(|(root, _)| root.clone())
        .collect();
    let cache_can_clean = cache.as_ref().is_some_and(|root| {
        !instance_roots
            .iter()
            .any(|instance| root.starts_with(instance) || instance.starts_with(root))
            && !minecraft
                .as_ref()
                .is_some_and(|shared| root.starts_with(shared) || shared.starts_with(root))
    });
    let roots: HashSet<_> = instance_roots
        .iter()
        .cloned()
        .chain(minecraft.iter().cloned())
        .chain(cache.iter().cloned())
        .collect();
    let now = SystemTime::now();
    let mut cleanup = Vec::new();
    let mut counted = HashSet::new();
    let mut minecraft_bytes = 0;
    let mut cache_bytes = 0;
    for (root, bytes, review) in [
        (minecraft, &mut minecraft_bytes, false),
        (cache, &mut cache_bytes, cache_can_clean),
    ] {
        if let Some(root) = root.filter(|root| counted.insert(root.clone())) {
            skipped += walk_files(&root, &roots, |path, relative, metadata| {
                *bytes += metadata.len();
                if review {
                    cleanup.extend(candidate(
                        path,
                        &root,
                        relative,
                        &metadata,
                        None,
                        "Launcher cache",
                        now,
                    ));
                }
            });
        }
    }
    let mut usage = Vec::new();
    for (root, instance) in instances {
        let mut row = InstanceUsage {
            id: instance.id,
            name: instance.name,
            ..Default::default()
        };
        match root {
            Some(root) if counted.insert(root.clone()) => {
                skipped += walk_files(&root, &roots, |path, relative, metadata| {
                    let bytes = metadata.len();
                    row.bytes += bytes;
                    match relative
                        .components()
                        .next()
                        .and_then(|part| part.as_os_str().to_str())
                    {
                        Some("saves") => row.worlds += bytes,
                        Some("mods" | "resourcepacks" | "shaderpacks" | "datapacks") => {
                            row.packs += bytes
                        }
                        Some("screenshots") => row.screenshots += bytes,
                        Some("logs" | "crash-reports") => row.logs += bytes,
                        _ => row.other += bytes,
                    }
                    cleanup.extend(candidate(
                        path,
                        &root,
                        relative,
                        &metadata,
                        Some(&row.id),
                        &row.name,
                        now,
                    ));
                });
            }
            Some(_) => row.shared_folder = true,
            None => {
                row.unavailable = true;
                skipped += 1;
            }
        }
        usage.push(row);
    }
    usage.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
    cleanup.sort_by_key(|file| std::cmp::Reverse(file.item.bytes));
    let more_cleanup = cleanup.len() > REVIEW_LIMIT;
    cleanup.truncate(REVIEW_LIMIT);
    let items = cleanup.iter().map(|file| file.item.clone()).collect();
    *reviewed_files()
        .lock()
        .map_err(|_| "Storage review is busy.")? = cleanup
        .into_iter()
        .map(|file| (file.item.id, file))
        .collect();
    Ok(StorageUsage {
        total_bytes: minecraft_bytes + cache_bytes + usage.iter().map(|row| row.bytes).sum::<u64>(),
        minecraft_bytes,
        cache_bytes,
        skipped,
        instances: usage,
        cleanup: items,
        more_cleanup,
    })
}

#[tauri::command]
pub(super) async fn get_storage_usage() -> Result<StorageUsage, String> {
    tauri::async_runtime::spawn_blocking(scan_storage)
        .await
        .map_err(|error| error.to_string())?
}

fn remove_reviewed_file(
    file: &ReviewedFile,
    current_root: Option<&Path>,
    excluded: &HashSet<PathBuf>,
) -> bool {
    if current_root != Some(file.root.as_path())
        || excluded.iter().any(|root| file.path.starts_with(root))
        || !file
            .path
            .parent()
            .is_some_and(|parent| safe_root(parent).is_ok())
    {
        return false;
    }
    let Ok(metadata) = regular_path(&file.path) else {
        return false;
    };
    metadata.is_file()
        && metadata.len() == file.item.bytes
        && metadata.modified().ok() == Some(file.modified)
        && fs::remove_file(&file.path).is_ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CleanupResult {
    removed: usize,
    skipped: usize,
    removed_bytes: u64,
}

#[tauri::command]
pub(super) async fn clean_reviewed_storage(
    ids: Vec<Uuid>,
    state: tauri::State<'_, LauncherState>,
) -> Result<CleanupResult, String> {
    if ids.is_empty() || ids.len() > REVIEW_LIMIT {
        return Err("Select files from the current cleanup review.".into());
    }
    let activity = reserve_update_activity(&state)
        .map_err(|_| "Close Minecraft and wait for downloads to finish before cleaning up.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _activity = activity;
        let mut review = reviewed_files()
            .lock()
            .map_err(|_| "Storage review is busy.")?;
        let instances: HashMap<_, _> = list_instances_blocking()?
            .into_iter()
            .filter_map(|instance| {
                Some((instance.id, safe_root(Path::new(&instance.directory)).ok()?))
            })
            .collect();
        let cache = configured_cache()
            .ok()
            .and_then(|path| safe_root(&path).ok());
        let minecraft = safe_root(&bloom_data_dir()?.join("minecraft")).ok();
        let roots: HashSet<_> = instances
            .values()
            .cloned()
            .chain(cache.iter().cloned())
            .chain(minecraft.iter().cloned())
            .collect();
        let mut result = CleanupResult {
            removed: 0,
            skipped: 0,
            removed_bytes: 0,
        };
        for id in ids.into_iter().collect::<HashSet<_>>() {
            let Some(file) = review.remove(&id) else {
                result.skipped += 1;
                continue;
            };
            let root = if let Some(instance) = &file.instance_id {
                instances.get(instance)
            } else {
                cache.as_ref()
            };
            let excluded = roots
                .iter()
                .filter(|other| {
                    *other != &file.root
                        && (file.instance_id.is_none() || other.starts_with(&file.root))
                })
                .cloned()
                .collect();
            let cache_overlaps = file.instance_id.is_none()
                && roots.iter().any(|other| {
                    other != &file.root
                        && (other.starts_with(&file.root) || file.root.starts_with(other))
                });
            let shared_logs = file.instance_id.is_some()
                && (cache.as_ref() == Some(&file.root) || minecraft.as_ref() == Some(&file.root));
            let cache_is_shared = file.instance_id.is_none()
                && (instances.values().any(|other| other == &file.root)
                    || minecraft.as_ref() == Some(&file.root));
            if !cache_overlaps
                && !shared_logs
                && !cache_is_shared
                && remove_reviewed_file(&file, root.map(PathBuf::as_path), &excluded)
            {
                result.removed += 1;
                result.removed_bytes += file.item.bytes;
            } else {
                result.skipped += 1;
            }
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../logs/storage-tests")
                .join(Uuid::new_v4().to_string());
            fs::create_dir_all(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }

        fn file(&self, relative: &str, bytes: &[u8]) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, bytes).unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn storage_scan_skips_nested_roots_and_linked_directories() {
        let fixture = Fixture::new();
        fixture.file("instance/saves/level.dat", b"world");
        fixture.file("instance/shared/assets/example", b"shared");
        fixture.file("outside/secret", b"not part of the instance");
        let root = fixture.0.join("instance");
        let link = root.join("link");
        #[cfg(windows)]
        junction::create(fixture.0.join("outside"), &link).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(fixture.0.join("outside"), &link).unwrap();
        assert!(safe_root(&link).is_err());
        let exclusion = HashSet::from([root.join("shared")]);
        let mut counted = Vec::new();
        let skipped = walk_files(&root, &exclusion, |_, path, metadata| {
            counted.push((path.to_owned(), metadata.len()));
        });
        assert_eq!(skipped, 1);
        assert_eq!(counted, vec![(PathBuf::from("saves").join("level.dat"), 5)]);
        #[cfg(windows)]
        junction::delete(&link).unwrap();
    }

    #[test]
    fn storage_review_checks_age_category_and_the_reviewed_file() {
        let fixture = Fixture::new();
        let recent = fixture.file("logs/2024-01-20-1.log.gz", b"archived");
        let metadata = regular_path(&recent).unwrap();
        let relative = recent.strip_prefix(&fixture.0).unwrap();
        assert!(candidate(
            &recent,
            &fixture.0,
            relative,
            &metadata,
            Some("a"),
            "Instance",
            SystemTime::now()
        )
        .is_none());
        let later = SystemTime::now() + OLD_FILE_AGE;
        let file = candidate(
            &recent,
            &fixture.0,
            relative,
            &metadata,
            Some("a"),
            "Instance",
            later,
        )
        .unwrap();
        assert!(cleanup_name(Path::new("logs/latest.log"), true).is_none());
        assert!(cleanup_name(Path::new("saves/2024-01-20.log.gz"), true).is_none());
        let digest = format!("{}.json", "a".repeat(64));
        assert!(cleanup_name(&Path::new("rendered-thumbnails").join(&digest), false).is_some());
        assert!(cleanup_name(&Path::new("launch-installations").join(&digest), false).is_none());
        assert!(!remove_reviewed_file(&file, None, &HashSet::new()));
        assert!(!remove_reviewed_file(
            &file,
            Some(&fixture.0),
            &HashSet::from([fixture.0.join("logs")])
        ));
        fs::write(&recent, b"modified after review").unwrap();
        assert!(!remove_reviewed_file(
            &file,
            Some(&fixture.0),
            &HashSet::new()
        ));
        let metadata = regular_path(&recent).unwrap();
        let fresh = candidate(
            &recent,
            &fixture.0,
            relative,
            &metadata,
            Some("a"),
            "Instance",
            SystemTime::now() + OLD_FILE_AGE,
        )
        .unwrap();
        assert!(remove_reviewed_file(
            &fresh,
            Some(&fixture.0),
            &HashSet::new()
        ));
        assert!(!recent.exists());
    }
}
