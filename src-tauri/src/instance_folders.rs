//! Library organization only. Membership never changes an instance's game directory.
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::Path, sync::Mutex};

static STORE_LOCK: Mutex<()> = Mutex::new(());
const MAX_FOLDERS: usize = 256;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceFolder {
    pub id: String,
    pub name: String,
    pub instance_ids: Vec<String>,
}

#[derive(Default, Debug, PartialEq, Serialize, Deserialize)]
struct Store {
    folders: Vec<InstanceFolder>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum FolderChange {
    Create { name: String, instance_ids: Vec<String> },
    Rename { folder_id: String, name: String },
    Move { instance_id: String, folder_id: Option<String> },
    Dissolve { folder_id: String },
}

fn read_store(path: &Path) -> Result<Store, String> {
    match fs::read(path) {
        Ok(bytes) => {
            if bytes.len() > 4 * 1024 * 1024 { return Err("The instance folder file is too large.".into()); }
            let store: Store = serde_json::from_slice(&bytes)
                .map_err(|_| "Your instance folder file could not be read. It has not been overwritten.")?;
            let mut ids = HashSet::new();
            if store.folders.len() > MAX_FOLDERS || store.folders.iter().any(|f| !ids.insert(&f.id)) {
                return Err("Your instance folder file is invalid. It has not been overwritten.".into());
            }
            Ok(store)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(error) => Err(format!("Bloom could not read instance folders: {error}")),
    }
}

fn write_store(path: &Path, store: &Store) -> Result<(), String> {
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        drop(file);
        // Replace only after the complete new file is on disk. Never remove the old file first.
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result.map_err(|error| format!("Bloom could not save instance folders: {error}"))
}

fn prune(store: &mut Store, valid: &HashSet<String>) {
    let mut assigned = HashSet::new();
    for folder in &mut store.folders {
        folder.instance_ids.retain(|id| valid.contains(id) && assigned.insert(id.clone()));
    }
}

fn folder_name(store: &Store, name: &str, except: Option<&str>) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 48 || name.chars().any(char::is_control) {
        return Err("Use a folder name between 1 and 48 characters.".into());
    }
    if store.folders.iter().any(|f| Some(f.id.as_str()) != except && f.name.to_lowercase() == name.to_lowercase()) {
        return Err("A folder already uses that name.".into());
    }
    Ok(name.into())
}

fn apply(store: &mut Store, change: FolderChange, valid: &HashSet<String>) -> Result<(), String> {
    match change {
        FolderChange::Create { name, instance_ids } => {
            let name = folder_name(store, &name, None)?;
            if store.folders.len() >= MAX_FOLDERS { return Err("You have reached the folder limit.".into()); }
            if instance_ids.iter().any(|id| !valid.contains(id)) { return Err("An instance is no longer available. Refresh and try again.".into()); }
            let mut seen = HashSet::new();
            let ids: Vec<_> = instance_ids.into_iter().filter(|id| seen.insert(id.clone())).collect();
            for folder in &mut store.folders { folder.instance_ids.retain(|id| !seen.contains(id)); }
            store.folders.push(InstanceFolder { id: uuid::Uuid::new_v4().to_string(), name, instance_ids: ids });
        }
        FolderChange::Rename { folder_id, name } => {
            let name = folder_name(store, &name, Some(&folder_id))?;
            store.folders.iter_mut().find(|f| f.id == folder_id).ok_or("That folder no longer exists.")?.name = name;
        }
        FolderChange::Move { instance_id, folder_id } => {
            if !valid.contains(&instance_id) { return Err("That instance no longer exists.".into()); }
            if folder_id.as_ref().is_some_and(|id| !store.folders.iter().any(|f| &f.id == id)) { return Err("That folder no longer exists.".into()); }
            // Validate the destination before removing the source membership.
            for folder in &mut store.folders { folder.instance_ids.retain(|id| id != &instance_id); }
            if let Some(id) = folder_id { store.folders.iter_mut().find(|f| f.id == id).unwrap().instance_ids.push(instance_id); }
        }
        FolderChange::Dissolve { folder_id } => {
            if !store.folders.iter().any(|f| f.id == folder_id) { return Err("That folder no longer exists.".into()); }
            store.folders.retain(|f| f.id != folder_id);
        }
    }
    Ok(())
}

fn access(change: Option<FolderChange>) -> Result<Vec<InstanceFolder>, String> {
    let _guard = STORE_LOCK.lock().map_err(|_| "Instance folders are temporarily unavailable.")?;
    let path = super::bloom_data_dir()?.join("instance-folders.json");
    let mut store = read_store(&path)?;
    let valid = super::list_instances_blocking()?.into_iter().map(|i| i.id).collect();
    let before = store.folders.clone();
    prune(&mut store, &valid);
    let changed = change.is_some();
    if let Some(change) = change { apply(&mut store, change, &valid)?; }
    if changed || before != store.folders { write_store(&path, &store)?; }
    Ok(store.folders)
}

#[tauri::command]
pub async fn list_instance_folders() -> Result<Vec<InstanceFolder>, String> {
    tauri::async_runtime::spawn_blocking(|| access(None)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn change_instance_folder(change: FolderChange) -> Result<Vec<InstanceFolder>, String> {
    tauri::async_runtime::spawn_blocking(|| access(Some(change))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn valid() -> HashSet<String> { ["one", "two", "three"].map(String::from).into() }
    fn create(s: &mut Store, name: &str, ids: &[&str]) -> String {
        apply(s, FolderChange::Create { name: name.into(), instance_ids: ids.iter().map(|s| s.to_string()).collect() }, &valid()).unwrap();
        s.folders.last().unwrap().id.clone()
    }
    #[test]
    fn moving_is_exclusive_and_dissolving_keeps_instances_available() {
        let mut s = Store::default(); let a = create(&mut s, "Survival", &["one", "two", "one"]); let b = create(&mut s, "Creative", &[]);
        assert_eq!(s.folders[0].instance_ids.len(), 2);
        apply(&mut s, FolderChange::Move { instance_id: "one".into(), folder_id: Some(b.clone()) }, &valid()).unwrap();
        assert_eq!(s.folders[0].instance_ids, ["two"]); assert_eq!(s.folders[1].instance_ids, ["one"]);
        apply(&mut s, FolderChange::Move { instance_id: "one".into(), folder_id: None }, &valid()).unwrap();
        assert!(s.folders[1].instance_ids.is_empty());
        apply(&mut s, FolderChange::Dissolve { folder_id: a }, &valid()).unwrap();
        assert_eq!(s.folders.len(), 1); assert_eq!(valid().len(), 3);
    }
    #[test]
    fn invalid_requests_do_not_remove_membership() {
        let mut s = Store::default(); create(&mut s, "One", &["one"]); let before = serde_json::to_vec(&s).unwrap();
        for change in [FolderChange::Create { name: " one ".into(), instance_ids: vec![] }, FolderChange::Create { name: "Missing".into(), instance_ids: vec!["missing".into()] }, FolderChange::Move { instance_id: "one".into(), folder_id: Some("missing".into()) }, FolderChange::Rename { folder_id: s.folders[0].id.clone(), name: "\n".into() }] {
            assert!(apply(&mut s, change, &valid()).is_err()); assert_eq!(serde_json::to_vec(&s).unwrap(), before);
        }
    }
    #[test]
    fn metadata_survives_reopen_and_corruption_is_not_overwritten() {
        let dir = std::env::temp_dir().join(format!("bloom-folders-test-{}", uuid::Uuid::new_v4())); fs::create_dir(&dir).unwrap();
        let path = dir.join("instance-folders.json"); let mut s = read_store(&path).unwrap(); let id = create(&mut s, "Test", &["one"]);
        write_store(&path, &s).unwrap(); assert_eq!(read_store(&path).unwrap(), s);
        apply(&mut s, FolderChange::Rename { folder_id: id, name: "Renamed".into() }, &valid()).unwrap();
        write_store(&path, &s).unwrap(); assert_eq!(read_store(&path).unwrap().folders[0].name, "Renamed");
        fs::write(&path, b"invalid").unwrap(); assert!(read_store(&path).is_err()); assert_eq!(fs::read(&path).unwrap(), b"invalid");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn stale_memberships_are_removed_without_removing_empty_folders() {
        let mut s = Store::default(); create(&mut s, "Keep", &["one", "two"]); prune(&mut s, &["two".into()].into());
        assert_eq!(s.folders[0].instance_ids, ["two"]); prune(&mut s, &HashSet::new()); assert_eq!(s.folders.len(), 1); assert!(s.folders[0].instance_ids.is_empty());
    }
}
