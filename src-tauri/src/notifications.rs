use crate::{
    bloom_data_dir, instance_actions, list_instances_blocking, load_instance, InstanceConfig,
};
use semver::{BuildMetadata, Version};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const FORMAT_VERSION: u32 = 1;
const MAX_ENTRIES: usize = 50;
const MAX_FOLLOWED_SOURCES: usize = 512;
const MAX_DISK_BYTES: u64 = 256 * 1024;
const HISTORY_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1000;
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
const UNAVAILABLE: &str = "Could not access notification history.";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Kind {
    ModUpdateCompleted,
    ModUpdateFailed,
    LauncherUpdate,
    FollowedRelease,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Notification {
    id: String,
    kind: Kind,
    instance_id: Option<String>,
    instance_name: Option<String>,
    version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mod_id: Option<String>,
    required: bool,
    created_at: u64,
    read: bool,
    available: bool,
}

impl Notification {
    fn new(
        id: String,
        kind: Kind,
        instance: Option<&InstanceConfig>,
        version: Option<String>,
        required: bool,
        now: u64,
    ) -> Self {
        Self {
            id,
            kind,
            instance_id: instance.map(|item| item.id.clone()),
            instance_name: instance.map(|item| instance_name(&item.name)),
            version,
            mod_id: None,
            required,
            created_at: now,
            read: false,
            available: true,
        }
    }

    fn pending(&self) -> bool {
        self.available && (self.mod_id.is_some() || matches!(self.kind, Kind::LauncherUpdate | Kind::FollowedRelease))
    }

    fn valid(&self) -> bool {
        let instance = self
            .instance_id
            .as_deref()
            .filter(|id| valid_instance_id(id));
        let has_instance = instance.is_some() && self.instance_name.is_some();
        let version = self.version.as_deref().unwrap_or_default();
        let valid_label = self
            .instance_name
            .as_ref()
            .is_none_or(|name| name == &instance_name(name));
        if !valid_label || self.created_at > MAX_SAFE_INTEGER {
            return false;
        }
        if self.mod_id.as_ref().is_some_and(|id| self.kind != Kind::ModUpdateFailed
            || !(2..=64).contains(&id.len())
            || !id.as_bytes()[0].is_ascii_lowercase()
            || !id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte)))
        {
            return false;
        }
        match self.kind {
            Kind::ModUpdateCompleted | Kind::ModUpdateFailed => {
                has_instance
                    && self
                        .id
                        .strip_prefix("mod-update:")
                        .is_some_and(|id| Uuid::parse_str(id).is_ok())
                    && self.version.is_none()
                    && !self.required
            }
            Kind::LauncherUpdate => {
                self.instance_id.is_none()
                    && self.instance_name.is_none()
                    && parse_version(version).is_some_and(|value| value.to_string() == version)
                    && self.id == format!("launcher-update:{version}")
                    && !self.required
            }
            Kind::FollowedRelease => instance.is_some_and(|id| {
                has_instance
                    && version
                        .parse::<u64>()
                        .is_ok_and(|revision| valid_revision(revision))
                    && self.id == format!("followed-release:{id}:{version}")
            }),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FollowWatermark {
    installed: u64,
    latest: u64,
    changed_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct History {
    schema_version: u32,
    #[serde(default)]
    entries: Vec<Notification>,
    #[serde(default)]
    latest_launcher: Option<String>,
    #[serde(default)]
    followed: BTreeMap<String, FollowWatermark>,
}

impl Default for History {
    fn default() -> Self {
        Self {
            schema_version: FORMAT_VERSION,
            entries: Vec::new(),
            latest_launcher: None,
            followed: BTreeMap::new(),
        }
    }
}

impl History {
    fn add(&mut self, entry: Notification) {
        if entry.valid() && !self.entries.iter().any(|item| item.id == entry.id) {
            self.entries.push(entry);
        }
    }

    fn remove_superseded_launcher_updates(&mut self, current: &Version) {
        self.entries.retain(|entry| {
            entry.kind != Kind::LauncherUpdate
                || entry
                    .version
                    .as_deref()
                    .and_then(parse_version)
                    .is_some_and(|version| version > *current)
        });
    }

    fn observe_launcher(
        &mut self,
        current: &Version,
        available: Option<&Version>,
        authoritative: bool,
        now: u64,
    ) {
        self.remove_superseded_launcher_updates(current);
        if authoritative {
            let available = available.filter(|version| *version > current);
            let version = available.map(Version::to_string);
            self.entries.retain(|entry| {
                entry.kind != Kind::LauncherUpdate || entry.version == version
            });
            self.latest_launcher = Some(available.unwrap_or(current).to_string());
            if let Some(version) = version {
                self.add(Notification::new(
                    format!("launcher-update:{version}"),
                    Kind::LauncherUpdate,
                    None,
                    Some(version),
                    false,
                    now,
                ));
            }
            return;
        }
        let previous = self.latest_launcher.as_deref().and_then(parse_version);
        if previous.as_ref().is_none_or(|previous| current > previous) {
            self.latest_launcher = Some(current.to_string());
        }
        if let Some(available) = available.filter(|version| {
            *version > current && previous.as_ref().is_none_or(|previous| *version > previous)
        }) {
            let version = available.to_string();
            self.entries
                .retain(|entry| entry.kind != Kind::LauncherUpdate);
            self.latest_launcher = Some(version.clone());
            self.add(Notification::new(
                format!("launcher-update:{version}"),
                Kind::LauncherUpdate,
                None,
                Some(version),
                false,
                now,
            ));
        }
    }

    fn observe_followed(
        &mut self,
        instance: &InstanceConfig,
        installed: u64,
        latest: u64,
        required: bool,
        now: u64,
    ) {
        let watermark = self.followed.entry(instance.id.clone()).or_default();
        let effective_installed = watermark.installed.max(installed);
        let previous_latest = watermark.latest;
        if effective_installed != watermark.installed || latest > previous_latest {
            *watermark = FollowWatermark {
                installed: effective_installed,
                latest: previous_latest.max(latest),
                changed_at: now,
            };
        }
        let belongs = |entry: &Notification| {
            entry.kind == Kind::FollowedRelease && entry.instance_id.as_ref() == Some(&instance.id)
        };
        self.entries.retain(|entry| {
            !belongs(entry)
                || entry
                    .version
                    .as_deref()
                    .and_then(|value| value.parse::<u64>().ok())
                    .is_some_and(|revision| revision > effective_installed && revision >= latest)
        });
        if latest <= effective_installed {
            return;
        }
        let id = format!("followed-release:{}:{latest}", instance.id);
        if latest > previous_latest {
            self.entries
                .retain(|entry| entry.id != id || entry.available);
            self.add(Notification::new(
                id,
                Kind::FollowedRelease,
                Some(instance),
                Some(latest.to_string()),
                required,
                now,
            ));
        } else if latest == previous_latest && installed >= effective_installed {
            if let Some(entry) = self
                .entries
                .iter_mut()
                .find(|entry| entry.id == id && entry.available)
            {
                entry.required = required;
            }
        }
    }

    fn reconcile_library(&mut self, library: &BTreeMap<String, String>) {
        for entry in &mut self.entries {
            if let Some(id) = &entry.instance_id {
                match library.get(id) {
                    Some(name) if entry.available => entry.instance_name = Some(name.clone()),
                    None => entry.available = false,
                    _ => {}
                }
            }
        }
        self.followed.retain(|id, _| library.contains_key(id));
    }

    fn mark_read(&mut self, id: Option<&str>) {
        for item in &mut self.entries {
            if id.is_none_or(|id| item.id == id) {
                item.read = true;
            }
        }
    }

    fn prune(&mut self, now: u64) {
        self.latest_launcher = self
            .latest_launcher
            .as_deref()
            .and_then(parse_version)
            .map(|v| v.to_string());
        self.followed.retain(|id, value| {
            valid_instance_id(id) && valid_revision(value.installed) && valid_revision(value.latest)
        });
        if self.followed.len() > MAX_FOLLOWED_SOURCES {
            let mut oldest: Vec<_> = self
                .followed
                .iter()
                .map(|(id, value)| (value.changed_at, id.clone()))
                .collect();
            oldest.sort_unstable();
            let excess = oldest.len() - MAX_FOLLOWED_SOURCES;
            for (_, id) in oldest.into_iter().take(excess) {
                self.followed.remove(&id);
            }
        }
        self.entries.retain(|entry| {
            entry.valid()
                && (entry.pending() || now.saturating_sub(entry.created_at) <= HISTORY_AGE_MS)
        });
        self.entries.sort_by(|a, b| {
            b.pending()
                .cmp(&a.pending())
                .then_with(|| b.created_at.cmp(&a.created_at))
                .then_with(|| a.id.cmp(&b.id))
        });
        let mut ids = BTreeSet::new();
        self.entries.retain(|entry| ids.insert(entry.id.clone()));
        self.entries.truncate(MAX_ENTRIES);
        self.entries.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
    }
}

fn instance_name(name: &str) -> String {
    let name: String = name
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(80)
        .collect();
    let name = name.trim();
    if name.is_empty() {
        "Unnamed instance".into()
    } else {
        name.into()
    }
}

fn valid_instance_id(id: &str) -> bool {
    id.len() <= 240 && instance_actions::validate_id(id).is_ok()
}

fn valid_revision(revision: u64) -> bool {
    (1..=MAX_SAFE_INTEGER).contains(&revision)
}

fn parse_version(raw: &str) -> Option<Version> {
    if raw.len() > 128 {
        return None;
    }
    let mut version = Version::parse(raw.strip_prefix('v').unwrap_or(raw)).ok()?;
    version.build = BuildMetadata::EMPTY;
    Some(version)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(MAX_SAFE_INTEGER.into()) as u64
}

enum Stored {
    Missing,
    Invalid,
    Ready(History),
}

fn regular_file(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !instance_actions::linked(&meta) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        _ => Err(UNAVAILABLE.into()),
    }
}

fn read_history(path: &Path) -> Result<Stored, String> {
    if !regular_file(path)? {
        return Ok(Stored::Missing);
    }
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| UNAVAILABLE)?
        .take(MAX_DISK_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNAVAILABLE)?;
    if bytes.len() as u64 > MAX_DISK_BYTES {
        return Err(UNAVAILABLE.into());
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Header {
        schema_version: u32,
    }
    let Ok(header) = serde_json::from_slice::<Header>(&bytes) else {
        return Ok(Stored::Invalid);
    };
    if header.schema_version != FORMAT_VERSION {
        return Err("This notification history uses an unavailable format.".into());
    }
    Ok(serde_json::from_slice(&bytes)
        .map(Stored::Ready)
        .unwrap_or(Stored::Invalid))
}

fn replace_history(path: &Path, history: &History) -> Result<(), String> {
    let staged = path.with_extension("next");
    if regular_file(&staged)? {
        fs::remove_file(&staged).map_err(|_| UNAVAILABLE)?;
    }
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)
            .map_err(|_| UNAVAILABLE)?;
        serde_json::to_writer(&mut file, history).map_err(|_| UNAVAILABLE)?;
        file.flush()
            .and_then(|()| file.sync_all())
            .map_err(|_| UNAVAILABLE)?;
        drop(file);
        fs::rename(&staged, path).map_err(|_| UNAVAILABLE)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&staged);
    }
    result.map_err(str::to_owned)
}

fn transact(
    root: &Path,
    now: u64,
    change: impl FnOnce(&mut History),
    notify: impl FnOnce(&[Notification]),
) -> Result<Vec<Notification>, String> {
    fs::create_dir_all(root).map_err(|_| UNAVAILABLE)?;
    let lock_path = root.join("notifications.lock");
    regular_file(&lock_path)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .map_err(|_| UNAVAILABLE)?;
    lock.lock().map_err(|_| UNAVAILABLE)?;

    let primary = root.join("notifications.json");
    let backup = root.join("notifications.previous.json");
    let stored = read_history(&primary)?;
    let (original, recovering) = match &stored {
        Stored::Ready(history) => (history.clone(), false),
        other => match read_history(&backup)? {
            Stored::Ready(history) => (history, true),
            _ => (History::default(), matches!(other, Stored::Invalid)),
        },
    };
    let mut history = original.clone();
    change(&mut history);
    history.prune(now);
    if recovering || history != original {
        if let Stored::Ready(previous) = &stored {
            replace_history(&backup, previous)?;
        }
        replace_history(&primary, &history)?;
        notify(&history.entries);
    }
    Ok(history.entries)
}

fn update(
    app: &AppHandle,
    change: impl FnOnce(&mut History, u64),
) -> Result<Vec<Notification>, String> {
    let now = now_ms();
    transact(
        &bloom_data_dir()?,
        now,
        |history| change(history, now),
        |entries| {
            let _ = app.emit("notifications-changed", entries);
        },
    )
}

fn reconcile(history: &mut History) {
    if let Ok(instances) = list_instances_blocking() {
        let library = instances
            .into_iter()
            .map(|instance| (instance.id, instance_name(&instance.name)))
            .collect();
        history.reconcile_library(&library);
    }
}

#[tauri::command]
pub(crate) async fn get_notifications(app: AppHandle) -> Result<Vec<Notification>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut current = app.package_info().version.clone();
        current.build = BuildMetadata::EMPTY;
        update(&app, |history, _| {
            history.remove_superseded_launcher_updates(&current);
            reconcile(history);
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub(crate) async fn mark_notifications_read(
    app: AppHandle,
    id: Option<String>,
) -> Result<Vec<Notification>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update(&app, |history, _| {
            reconcile(history);
            history.mark_read(id.as_deref());
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub(crate) async fn observe_launcher_notification(
    app: AppHandle,
    current_version: String,
    available_version: Option<String>,
    authoritative: Option<bool>,
) -> Result<Vec<Notification>, String> {
    let current = parse_version(&current_version).ok_or("Invalid launcher version.")?;
    let available = available_version
        .as_deref()
        .map(|version| parse_version(version).ok_or("Invalid launcher update version."))
        .transpose()?;
    tauri::async_runtime::spawn_blocking(move || {
        update(&app, |history, now| {
            history.observe_launcher(
                &current,
                available.as_ref(),
                authoritative.unwrap_or(false),
                now,
            )
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

#[tauri::command]
pub(crate) async fn observe_followed_notification(
    app: AppHandle,
    instance_id: String,
    installed_revision: u64,
    latest_revision: u64,
    required: bool,
) -> Result<Vec<Notification>, String> {
    if !valid_instance_id(&instance_id)
        || !valid_revision(installed_revision)
        || !valid_revision(latest_revision)
    {
        return Err("Invalid followed release.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let instance = load_instance(&instance_id)
            .ok()
            .filter(|value| value.visible && value.id == instance_id);
        update(&app, |history, now| {
            if let Some(instance) = &instance {
                history.observe_followed(
                    instance,
                    installed_revision,
                    latest_revision,
                    required,
                    now,
                );
            } else {
                reconcile(history);
            }
        })
    })
    .await
    .map_err(|_| UNAVAILABLE.to_owned())?
}

pub(crate) fn record_mod_update(
    app: &AppHandle,
    instance: &InstanceConfig,
    task_id: &str,
    succeeded: bool,
) {
    if let Ok(id) = Uuid::parse_str(task_id) {
        let kind = if succeeded {
            Kind::ModUpdateCompleted
        } else {
            Kind::ModUpdateFailed
        };
        let _ = update(app, |history, now| {
            history.add(Notification::new(
                format!("mod-update:{id}"),
                kind,
                Some(instance),
                None,
                false,
                now,
            ));
        });
    }
}

pub(crate) fn observe_mod_conflicts<'a>(
    app: &AppHandle,
    instance: &InstanceConfig,
    mods: impl Iterator<Item = &'a str>,
) {
    use sha2::{Digest, Sha256};
    let mods: BTreeSet<_> = mods.collect();
    let _ = update(app, |history, now| {
        history.entries.retain(|entry| {
            entry.instance_id.as_deref() != Some(instance.id.as_str())
                || entry.mod_id.as_deref().is_none_or(|id| mods.contains(id))
        });
        for id in mods {
            let hash = Sha256::digest(format!("mod-conflict:{}:{id}", instance.id));
            let uuid = Uuid::from_bytes(hash[..16].try_into().expect("SHA-256 contains 32 bytes"));
            let mut entry = Notification::new(
                format!("mod-update:{uuid}"), Kind::ModUpdateFailed, Some(instance), None, false, now,
            );
            entry.mod_id = Some(id.into());
            history.add(entry);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn instance(id: &str) -> InstanceConfig {
        serde_json::from_value(serde_json::json!({
            "id": id, "name": "Meadow", "version": "1.21.1", "directory": "",
            "java": "System Java", "memory": 4096, "jvmArguments": "",
            "mods": true, "resourcePacks": true, "shaderPacks": true, "config": true,
            "customResolution": false, "visible": true, "shortcut": false
        }))
        .unwrap()
    }

    fn batch(instance: &InstanceConfig, now: u64) -> Notification {
        Notification::new(
            format!("mod-update:{}", Uuid::new_v4()),
            Kind::ModUpdateCompleted,
            Some(instance),
            None,
            false,
            now,
        )
    }

    struct TestProfile(PathBuf);

    impl TestProfile {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("delight-notifications-{}", Uuid::new_v4()));
            fs::create_dir(&root).unwrap();
            Self(root)
        }

        fn change(&self, change: impl FnOnce(&mut History)) -> Vec<Notification> {
            transact(&self.0, 600, change, |_| {}).unwrap()
        }
    }

    impl Drop for TestProfile {
        fn drop(&mut self) {
            for path in [
                "notifications.json",
                "notifications.previous.json",
                "notifications.lock",
                "notifications.next",
                "notifications.previous.next",
            ] {
                let _ = fs::remove_file(self.0.join(path));
            }
            let _ = fs::remove_dir(&self.0);
        }
    }

    #[test]
    fn launcher_versions_use_precedence_and_preserve_read_state() {
        let mut history = History::default();
        let current = parse_version("v1.3.3-rc.2").unwrap();
        let next = parse_version("1.3.3-rc.10+build.2").unwrap();
        history.observe_launcher(&current, Some(&next), false, 100);
        assert_eq!(history.entries[0].version.as_deref(), Some("1.3.3-rc.10"));
        history.mark_read(None);
        history.observe_launcher(&current, Some(&next), true, 110);
        assert!(history.entries[0].read);
        assert_eq!(history.entries[0].created_at, 100);

        let stable = parse_version("1.3.3").unwrap();
        history.observe_launcher(&current, Some(&stable), false, 120);
        assert_eq!(history.entries.len(), 1);
        assert!(!history.entries[0].read);
        history.observe_launcher(&stable, None, false, 121);
        history.observe_launcher(&current, Some(&next), false, 122);
        assert!(history.entries.is_empty());
        assert!(parse_version("https://example.invalid/install").is_none());
    }

    #[test]
    fn launcher_update_survives_read_and_offline_start_but_can_be_withdrawn() {
        let mut history = History::default();
        let current = parse_version("1.3.2").unwrap();
        let next = parse_version("1.3.3").unwrap();

        history.observe_launcher(&current, Some(&next), true, 100);
        history.mark_read(None);
        history.observe_launcher(&current, None, false, 110);
        assert!(history.entries[0].pending() && history.entries[0].read);
        history.observe_launcher(&current, None, true, 120);
        assert!(history.entries.is_empty());
        history.observe_launcher(&current, Some(&next), true, 130);
        assert!(history.entries[0].pending() && !history.entries[0].read);
        history.remove_superseded_launcher_updates(&next);
        assert!(history.entries.is_empty());
    }

    #[test]
    fn followed_release_supersedes_stale_results_and_retires_on_install() {
        let mut history = History::default();
        let meadow = instance("meadow");
        history.observe_followed(&meadow, 2, 3, false, 100);
        let original = history.entries[0].id.clone();
        history.mark_read(Some(&original));
        history.observe_followed(&meadow, 2, 3, true, 101);
        assert!(history.entries[0].read && history.entries[0].required);
        assert_eq!(history.entries[0].created_at, 100);
        history.observe_followed(&meadow, 2, 4, false, 102);
        history.observe_followed(&meadow, 2, 3, true, 103);
        assert_eq!(history.entries.len(), 1);
        assert_eq!(history.entries[0].version.as_deref(), Some("4"));
        assert!(!history.entries[0].read);
        history.observe_followed(&meadow, 4, 4, false, 104);
        history.observe_followed(&meadow, 2, 4, false, 105);
        assert!(history.entries.is_empty());
    }

    #[test]
    fn removed_instances_are_unavailable_and_can_be_marked_read() {
        let meadow = instance("meadow");
        let mut history = History::default();
        history.add(batch(&meadow, 100));
        history.observe_followed(&meadow, 2, 3, true, 101);
        history.reconcile_library(&BTreeMap::new());
        assert_eq!(history.entries.len(), 2);
        assert!(history.entries.iter().all(|entry| !entry.available));
        history.mark_read(None);
        assert!(history.entries.iter().all(|entry| entry.read));
        history.observe_followed(&meadow, 2, 3, true, 102);
        assert_eq!(
            history
                .entries
                .iter()
                .filter(|entry| entry.available)
                .count(),
            1
        );
    }

    #[test]
    fn history_limit_preserves_current_actions_and_expires_old_batches() {
        let mut history = History::default();
        let meadow = instance("meadow");
        let now = HISTORY_AGE_MS + 100;
        history.observe_followed(&meadow, 2, 3, true, 100);
        let expired = batch(&meadow, 50);
        let expired_id = expired.id.clone();
        history.add(expired);
        for time in 0..60 {
            history.add(batch(&meadow, now - time));
        }
        history.prune(now);
        assert_eq!(history.entries.len(), MAX_ENTRIES);
        assert_eq!(history.entries.last().unwrap().kind, Kind::FollowedRelease);
        assert!(!history.entries.iter().any(|entry| entry.id == expired_id));
        assert!(history
            .entries
            .windows(2)
            .all(|items| items[0].created_at >= items[1].created_at));
    }

    #[test]
    fn disk_recovers_last_valid_read_state_and_preserves_unknown_formats() {
        let profile = TestProfile::new();
        let meadow = instance("meadow");
        let completed = batch(&meadow, 100);
        profile.change(|history| history.add(completed.clone()));
        profile.change(|history| history.mark_read(Some(&completed.id)));
        let before = profile.change(|history| {
            history.add(completed.clone());
            history.add(batch(&meadow, 101));
        });
        assert_eq!(before.len(), 2);
        assert!(
            before
                .iter()
                .find(|entry| entry.id == completed.id)
                .unwrap()
                .read
        );
        let path = profile.0.join("notifications.json");
        fs::write(&path, b"{\"schemaVersion\":1,\"entries\":[").unwrap();
        let recovered = profile.change(|_| {});
        assert_eq!(recovered.len(), 1);
        assert!(recovered[0].read);
        assert_eq!(profile.change(|_| {}), recovered);

        let future = b"{\"schemaVersion\":2,\"entries\":[]}";
        fs::write(&path, future).unwrap();
        assert!(transact(&profile.0, 600, |_| {}, |_| {}).is_err());
        assert_eq!(fs::read(&path).unwrap(), future);
    }

    #[test]
    fn concurrent_commits_and_replayed_batches_keep_one_entry_per_task() {
        let profile = TestProfile::new();
        let meadow = instance("meadow");
        let events: Vec<_> = (0..12).map(|event| batch(&meadow, 100 + event)).collect();
        std::thread::scope(|scope| {
            for entry in events.iter().chain(&events) {
                let profile = &profile;
                scope.spawn(move || {
                    profile.change(|history| history.add(entry.clone()));
                });
            }
        });
        assert_eq!(profile.change(|_| {}).len(), events.len());
        let json = fs::read_to_string(profile.0.join("notifications.json")).unwrap();
        assert!(!json.contains("directory") && !json.contains("message"));
    }
}
