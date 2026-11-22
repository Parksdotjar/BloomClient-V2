//! Read-only discovery of Minecraft destinations. Delight bookmarks live separately;
//! we never rewrite servers.dat or level.dat. Recents come from actual joins.
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, io::{Read, Write}, path::{Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};

static STORE_LOCK: Mutex<()> = Mutex::new(());
const MAX_FILE: usize = 8 * 1024 * 1024;
const MAX_ENTRIES: usize = 2048;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind { Server, World }

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target { pub kind: Kind, pub target: String }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String, instance_id: String, instance_name: String, version: String,
    kind: Kind, target: String, name: String, icon: Option<String>,
    last_played: Option<u64>, favorite: bool, removable: bool, unavailable_reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library { entries: Vec<Entry>, warnings: Vec<String> }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Bookmark {
    instance_id: String, kind: Kind, target: String, name: String,
    #[serde(default)] favorite: bool,
    #[serde(default)] saved: bool,
    #[serde(default)] last_played: Option<u64>,
}

#[derive(Default, Deserialize, Serialize)]
struct Store { #[serde(default)] entries: Vec<Bookmark> }

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Change {
    Favorite { id: String, favorite: bool },
    AddServer { instance_id: String, name: String, address: String },
    Remove { id: String },
}

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn identity(instance: &str, kind: &Kind, target: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(instance); hash.update([0]); hash.update(if *kind == Kind::Server { b"server".as_slice() } else { b"world".as_slice() }); hash.update([0]); hash.update(target);
    format!("{:x}", hash.finalize())
}
fn bounded_read(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|e| e.to_string())?.take(max as u64 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > max { return Err("File exceeds the supported size.".into()); }
    Ok(bytes)
}
fn read_store(path: &Path) -> Result<Store, String> {
    if !path.exists() { return Ok(Store::default()); }
    let store: Store = serde_json::from_slice(&bounded_read(path, MAX_FILE)?)
        .map_err(|_| "Portal's saved data could not be read. It has not been overwritten.")?;
    if store.entries.len() > MAX_ENTRIES { return Err("Portal's saved data exceeds its entry limit.".into()); }
    Ok(store)
}
fn write_store(path: &Path, store: &Store) -> Result<(), String> {
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temp).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(store).map_err(|e| e.to_string())?).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(temp); }
    result.map_err(|e| format!("Could not save Portal: {e}"))
}

/// Normalize addresses without accepting URLs, credentials, paths or launch flags.
fn server_address(address: &str) -> Result<String, String> {
    let address = address.trim();
    if address.is_empty() || address.len() > 255 || address.chars().any(|c| c.is_whitespace() || c.is_control() || "/\\?#@".contains(c)) || address.starts_with('-') {
        return Err("Enter a server address such as play.example.com or play.example.com:25565.".into());
    }
    let parsed = url::Url::parse(&format!("http://{address}")).map_err(|_| "That server address is invalid.")?;
    let host = parsed.host_str().ok_or("That server address is invalid.")?;
    if parsed.path() != "/" || host.is_empty() || host.starts_with('.') || host.ends_with("..") { return Err("That server address is invalid.".into()); }
    // URL parsing treats port 80 as implicit; Minecraft does not.
    let port = if address.starts_with('[') { address.rsplit_once("]:").map(|(_, p)| p) }
        else { address.rsplit_once(':').map(|(_, p)| p) };
    let port: u16 = port.map(|p| p.parse::<u16>().map_err(|_| "Use a port between 1 and 65535.")).transpose()?.unwrap_or(25565);
    if port == 0 { return Err("Use a port between 1 and 65535.".into()); }
    Ok(if port == 25565 { host.to_lowercase() } else { format!("{}:{port}", host.to_lowercase()) })
}
fn world_folder(folder: &str) -> Result<(), String> {
    if folder.is_empty() || folder == "." || folder == ".." || folder.starts_with('-') || folder.len() > 255 || folder.chars().any(|c| c.is_control() || "/\\:".contains(c)) {
        return Err("That world folder is invalid.".into());
    }
    Ok(())
}
fn release(version: &str) -> Option<Vec<u32>> {
    let numbers: Vec<u32> = version.split('.').map(str::parse).collect::<Result<_, _>>().ok()?;
    if numbers.len() < 2 { return None; }
    let mut padded = numbers; while padded.len() < 3 { padded.push(0); } Some(padded)
}
fn version_reason(version: &str) -> Option<String> {
    match release(version) {
        Some(v) if v >= vec![1, 20, 0] => None,
        _ => Some("Direct play requires Minecraft 1.20 or newer. Open this instance to play normally.".into()),
    }
}
fn world_version_reason(instance: &str, world: &str) -> Option<String> {
    if world.is_empty() || instance == world { return None; }
    match (release(instance), release(world)) {
        (Some(a), Some(b)) if b <= a => None,
        _ => Some(format!("Saved in {world}. Open this instance to review Minecraft's version warning first.")),
    }
}
fn png_data(bytes: &[u8]) -> Option<String> {
    if bytes.len() > 128 * 1024 || bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") { return None; }
    let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?); let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    if w == 0 || h == 0 || w > 512 || h > 512 { return None; }
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}
fn nbt<T: serde::de::DeserializeOwned>(path: &Path, gzip: bool) -> Result<T, String> {
    let bytes = bounded_read(path, MAX_FILE)?;
    let bytes = if gzip {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(bytes.as_slice()).take(MAX_FILE as u64 + 1).read_to_end(&mut out).map_err(|e| e.to_string())?;
        if out.len() > MAX_FILE { return Err("World metadata is too large.".into()); } out
    } else { bytes };
    fastnbt::from_bytes_with_opts(&bytes, fastnbt::DeOpts::new().max_seq_len(65536)).map_err(|e| e.to_string())
}
#[derive(Deserialize)]
struct Servers { #[serde(default)] servers: Vec<SavedServer> }
#[derive(Deserialize)]
struct SavedServer { name: String, ip: String, #[serde(default)] icon: Option<String> }
#[derive(Deserialize)]
struct Level { #[serde(rename = "Data")] data: WorldData }
#[derive(Deserialize)]
struct WorldData {
    #[serde(rename = "LevelName", default)] name: String,
    #[serde(rename = "LastPlayed", default)] last_played: i64,
    #[serde(rename = "Version", default)] version: WorldVersion,
}
#[derive(Default, Deserialize)]
struct WorldVersion { #[serde(rename = "Name", default)] name: String }

fn make_entry(instance: &super::InstanceConfig, kind: Kind, target: String, name: String) -> Entry {
    Entry { id: identity(&instance.id, &kind, &target), instance_id: instance.id.clone(), instance_name: instance.name.clone(), version: instance.version.clone(),
        kind, target, name, icon: None, last_played: None, favorite: false, removable: false, unavailable_reason: version_reason(&instance.version) }
}
fn world_path(instance: &super::InstanceConfig, folder: &str) -> Result<PathBuf, String> {
    world_folder(folder)?;
    let saves = Path::new(&instance.directory).join("saves").canonicalize().map_err(|_| "This instance's worlds folder is unavailable.")?;
    let path = saves.join(folder).canonicalize().map_err(|_| "This world no longer exists. Refresh Portal.")?;
    if path.parent() != Some(saves.as_path()) || !path.is_dir() { return Err("This world is outside the instance's saves folder.".into()); }
    Ok(path)
}
fn scan(instances: &[super::InstanceConfig], store: &Store) -> Library {
    let mut entries = HashMap::new(); let mut warnings = Vec::new();
    for instance in instances {
        let directory = Path::new(&instance.directory);
        if !directory.is_dir() { warnings.push(format!("{}: no local worlds or server list yet. Launch this instance to set it up.", instance.name)); }
        let servers_path = directory.join("servers.dat");
        if servers_path.exists() {
            match nbt::<Servers>(&servers_path, false) {
                Ok(servers) => for server in servers.servers.into_iter().take(MAX_ENTRIES) {
                    if let Ok(target) = server_address(&server.ip) {
                        let mut entry = make_entry(instance, Kind::Server, target, server.name);
                        entry.icon = server.icon.and_then(|icon| base64::engine::general_purpose::STANDARD.decode(icon.strip_prefix("data:image/png;base64,").unwrap_or(&icon)).ok()).and_then(|bytes| png_data(&bytes));
                        entries.insert(entry.id.clone(), entry);
                    }
                },
                Err(_) => warnings.push(format!("{}: saved servers could not be read.", instance.name)),
            }
        }
        let saves_path = directory.join("saves");
        if saves_path.exists() {
            match fs::read_dir(&saves_path) {
                Ok(folders) => for folder in folders.take(MAX_ENTRIES).flatten() {
                    if !folder.path().is_dir() { continue; }
                    let Some(name) = folder.file_name().to_str().map(str::to_string) else { continue; };
                    let Ok(path) = world_path(instance, &name) else { continue; };
                    if !path.join("level.dat").exists() { continue; }
                    match nbt::<Level>(&path.join("level.dat"), true) {
                        Ok(level) => {
                            let mut entry = make_entry(instance, Kind::World, name.clone(), if level.data.name.is_empty() { name } else { level.data.name });
                            entry.last_played = (level.data.last_played > 0).then_some(level.data.last_played as u64).filter(|time| *time <= now_ms() + 60_000);
                            entry.unavailable_reason = entry.unavailable_reason.or_else(|| world_version_reason(&instance.version, &level.data.version.name));
                            entry.icon = bounded_read(&path.join("icon.png"), 128 * 1024).ok().and_then(|b| png_data(&b));
                            entries.insert(entry.id.clone(), entry);
                        },
                        Err(_) => warnings.push(format!("{}: world ‘{}’ could not be read.", instance.name, name)),
                    }
                },
                Err(_) => warnings.push(format!("{}: worlds could not be read.", instance.name)),
            }
        }
        for saved in store.entries.iter().filter(|e| e.instance_id == instance.id) {
            let id = identity(&saved.instance_id, &saved.kind, &saved.target);
            if !entries.contains_key(&id) && saved.kind == Kind::Server && (saved.saved || saved.last_played.is_some()) && server_address(&saved.target).is_ok() {
                let mut entry = make_entry(instance, saved.kind.clone(), saved.target.clone(), saved.name.clone()); entry.removable = true;
                entries.insert(id.clone(), entry);
            }
            if let Some(entry) = entries.get_mut(&id) {
                entry.favorite = saved.favorite;
                entry.last_played = entry.last_played.max(saved.last_played);
                if saved.saved { entry.name = saved.name.clone(); }
            }
        }
    }
    let mut entries: Vec<_> = entries.into_values().collect();
    entries.sort_by(|a, b| b.last_played.cmp(&a.last_played).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())).then_with(|| a.id.cmp(&b.id)));
    Library { entries, warnings }
}

fn apply(change: Change, instances: &[super::InstanceConfig], store: &mut Store) -> Result<(), String> {
    match change {
        Change::AddServer { instance_id, name, address } => {
            if !instances.iter().any(|i| i.id == instance_id) { return Err("That instance is no longer available.".into()); }
            let name = name.trim();
            if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) { return Err("Use a server name between 1 and 80 characters.".into()); }
            let target = server_address(&address)?;
            if let Some(existing) = store.entries.iter_mut().find(|e| e.instance_id == instance_id && e.kind == Kind::Server && e.target == target) {
                existing.name = name.into(); existing.saved = true;
            } else {
                if store.entries.len() >= MAX_ENTRIES { return Err("Portal is full. Remove a saved server before adding another.".into()); }
                store.entries.push(Bookmark { instance_id, kind: Kind::Server, target, name: name.into(), favorite: false, saved: true, last_played: None });
            }
        },
        Change::Favorite { id, favorite } => {
            let library = scan(instances, store);
            let entry = library.entries.into_iter().find(|e| e.id == id).ok_or("That destination is no longer available. Refresh Portal.")?;
            if let Some(saved) = store.entries.iter_mut().find(|e| identity(&e.instance_id, &e.kind, &e.target) == id) { saved.favorite = favorite; }
            else {
                if store.entries.len() >= MAX_ENTRIES { return Err("Portal is full. Remove a saved server before adding a favorite.".into()); }
                store.entries.push(Bookmark { instance_id: entry.instance_id, kind: entry.kind, target: entry.target, name: entry.name, favorite, saved: false, last_played: entry.last_played });
            }
        },
        Change::Remove { id } => {
            if !scan(instances, store).entries.iter().any(|e| e.id == id && e.removable) { return Err("Only Portal shortcuts can be removed here. Manage Minecraft's saved servers in-game.".into()); }
            store.entries.retain(|e| identity(&e.instance_id, &e.kind, &e.target) != id);
        },
    }
    Ok(())
}
fn access(change: Option<Change>) -> Result<Library, String> {
    let _guard = STORE_LOCK.lock().map_err(|_| "Portal is temporarily unavailable.")?;
    let path = super::bloom_data_dir()?.join("portal.json");
    let mut store = read_store(&path)?;
    let instances = super::list_instances_blocking()?;
    if let Some(change) = change { apply(change, &instances, &mut store)?; write_store(&path, &store)?; }
    Ok(scan(&instances, &store))
}
#[tauri::command]
pub async fn list_portal() -> Result<Library, String> { tauri::async_runtime::spawn_blocking(|| access(None)).await.map_err(|e| e.to_string())? }
#[tauri::command]
pub async fn change_portal(change: Change) -> Result<Library, String> { tauri::async_runtime::spawn_blocking(|| access(Some(change))).await.map_err(|e| e.to_string())? }

pub fn validate_target(instance: &super::InstanceConfig, target: &Target) -> Result<(), String> {
    if !instance.visible { return Err("This instance is not available in Portal.".into()); }
    if let Some(reason) = version_reason(&instance.version) { return Err(reason); }
    match target.kind {
        Kind::Server => { server_address(&target.target)?; },
        Kind::World => {
            let path = world_path(instance, &target.target)?;
            let level: Level = nbt(&path.join("level.dat"), true).map_err(|_| "This world's metadata could not be read. Open the instance to inspect it.")?;
            if let Some(reason) = world_version_reason(&instance.version, &level.data.version.name) { return Err(reason); }
        },
    }
    Ok(())
}

/// Vanilla's own metadata determines whether these arguments are understood.
pub fn supports_quick_play(version: &mc_launcher_core::core::version::VersionJson) -> bool {
    serde_json::to_value(&version.arguments.game).ok().is_some_and(|v| v.to_string().contains("--quickPlayPath"))
}
pub fn append_target(args: &mut Vec<String>, target: &Target) {
    args.push(if target.kind == Kind::Server { "--quickPlayMultiplayer" } else { "--quickPlaySingleplayer" }.into());
    args.push(target.target.clone());
}

/// A fresh log per process prevents a failed launch from becoming a recent join.
pub struct JoinTracker { path: PathBuf, relative: String, last: Vec<u8> }
impl JoinTracker {
    pub fn new(directory: &str) -> Self {
        let relative = format!(".bloom/quick-play/{}.json", uuid::Uuid::new_v4());
        Self { path: Path::new(directory).join(&relative), relative, last: Vec::new() }
    }
    pub fn append_args(&self, args: &mut Vec<String>) { args.extend(["--quickPlayPath".into(), self.relative.clone()]); }
    pub fn observe(&mut self, instance: &super::InstanceConfig) -> Result<bool, String> {
        self.observe_at(&instance.id, &super::bloom_data_dir()?.join("portal.json"))
    }
    fn observe_at(&mut self, instance_id: &str, store_path: &Path) -> Result<bool, String> {
        let Ok(bytes) = bounded_read(&self.path, 64 * 1024) else { return Ok(false); };
        if bytes == self.last { return Ok(false); }
        let joins = parse_joins(&bytes);
        if joins.is_empty() { return Ok(false); } // Partial writes are retried.
        let _guard = STORE_LOCK.lock().map_err(|_| "Portal is temporarily unavailable.")?;
        let mut store = read_store(store_path)?;
        for (target, name) in joins {
            record_join(&mut store, instance_id, target, name, now_ms());
        }
        write_store(store_path, &store)?;
        self.last = bytes;
        Ok(true)
    }
}
impl Drop for JoinTracker { fn drop(&mut self) { let _ = fs::remove_file(&self.path); } }
fn parse_joins(bytes: &[u8]) -> Vec<(Target, String)> {
    let Ok(serde_json::Value::Array(logs)) = serde_json::from_slice(bytes) else { return Vec::new(); };
    logs.into_iter().filter_map(|log| {
        // The game writes a list of flat records: type, id, name,
        // gamemode and lastPlayedTime (see Minecraft's QuickPlayLog codec).
        if log.get("lastPlayedTime").is_none() { return None; }
        let kind = match log.get("type")?.as_str()? { "singleplayer" => Kind::World, "multiplayer" => Kind::Server, _ => return None };
        let value = log.get("id").or_else(|| log.get("identifier"))?.as_str()?;
        let target = if kind == Kind::Server { server_address(value).ok()? } else { world_folder(value).ok()?; value.into() };
        let name = log.get("name").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).unwrap_or(&target).chars().take(120).collect();
        Some((Target { kind, target }, name))
    }).take(16).collect()
}
fn record_join(store: &mut Store, instance_id: &str, target: Target, name: String, time: u64) {
    if let Some(saved) = store.entries.iter_mut().find(|e| e.instance_id == instance_id && e.kind == target.kind && e.target == target.target) {
        saved.last_played = Some(time); if !saved.saved { saved.name = name; } return;
    }
    if store.entries.len() >= MAX_ENTRIES {
        if let Some(index) = store.entries.iter().enumerate().filter(|(_, e)| !e.favorite && !e.saved).min_by_key(|(_, e)| e.last_played).map(|(i, _)| i) { store.entries.remove(index); }
        else { return; }
    }
    store.entries.push(Bookmark { instance_id: instance_id.into(), kind: target.kind, target: target.target, name, favorite: false, saved: false, last_played: Some(time) });
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("bloom-portal-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap(); Self(path)
        }
        fn instance(&self, id: &str) -> super::super::InstanceConfig {
            let path = self.0.join(id); fs::create_dir_all(&path).unwrap();
            serde_json::from_value(serde_json::json!({ "id":id, "name":id, "version":"26.3", "directory":path,
                "loader":"Fabric", "java":"Automatic", "memory":2048, "jvmArguments":"", "mods":true,
                "resourcePacks":true, "shaderPacks":true, "config":true, "customResolution":false, "visible":true, "shortcut":false })).unwrap()
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn world(instance: &super::super::InstanceConfig, folder: &str, name: &str, version: &str) {
        let path = Path::new(&instance.directory).join("saves").join(folder); fs::create_dir_all(&path).unwrap();
        let bytes = fastnbt::to_bytes(&serde_json::json!({"Data":{"LevelName":name,"LastPlayed":1_700_000_000_000i64,"Version":{"Name":version},"Player":{"Pos":[1.0,2.0,3.0]}}})).unwrap();
        let mut zip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default()); zip.write_all(&bytes).unwrap();
        fs::write(path.join("level.dat"), zip.finish().unwrap()).unwrap();
    }
    #[test]
    fn discovers_real_nbt_with_unicode_and_deduplicates_servers_per_instance() {
        let f = Fixture::new(); let one = f.instance("one"); let two = f.instance("two");
        world(&one, "A world 🪴", "Meadow 世界", "26.3");
        let servers = fastnbt::to_bytes(&serde_json::json!({"servers":[{"name":"Friends","ip":"PLAY.Example.com:25565"},{"name":"Friends","ip":"play.example.com"}]})).unwrap();
        fs::write(Path::new(&one.directory).join("servers.dat"), &servers).unwrap();
        fs::write(Path::new(&two.directory).join("servers.dat"), &servers).unwrap();
        let library = scan(&[one, two], &Store::default());
        assert!(library.warnings.is_empty()); assert_eq!(library.entries.len(), 3);
        let world = library.entries.iter().find(|e| e.kind == Kind::World).unwrap();
        assert_eq!(world.name, "Meadow 世界"); assert_eq!(world.target, "A world 🪴"); assert_eq!(world.last_played, Some(1_700_000_000_000));
        assert_ne!(library.entries[1].id, library.entries[2].id);
    }
    #[test]
    fn favorites_and_shortcuts_survive_atomic_replacement_without_touching_game_files() {
        let f = Fixture::new(); let one = f.instance("one"); world(&one,"Survival","Survival","26.3");
        let level = Path::new(&one.directory).join("saves/Survival/level.dat"); let original = fs::read(&level).unwrap();
        let mut store = Store::default(); let instances = vec![one];
        apply(Change::AddServer { instance_id:"one".into(), name:"Friends".into(), address:"Example.com:80".into() }, &instances, &mut store).unwrap();
        apply(Change::AddServer { instance_id:"one".into(), name:"Friends renamed".into(), address:"example.com:80".into() }, &instances, &mut store).unwrap();
        assert_eq!(store.entries.len(),1);
        let id = identity("one", &Kind::Server, "example.com:80");
        apply(Change::Favorite {id:id.clone(),favorite:true}, &instances, &mut store).unwrap();
        let path = f.0.join("portal.json"); write_store(&path,&store).unwrap(); write_store(&path,&store).unwrap();
        let mut loaded = read_store(&path).unwrap(); assert!(loaded.entries[0].favorite);
        apply(Change::Remove {id}, &instances, &mut loaded).unwrap(); assert!(loaded.entries.is_empty());
        assert_eq!(fs::read(level).unwrap(),original); assert!(!Path::new(&instances[0].directory).join("servers.dat").exists());
        assert!(apply(Change::AddServer {instance_id:"missing".into(),name:"Missing".into(),address:"example.com".into()}, &instances, &mut loaded).is_err());
    }
    #[test]
    fn isolates_unreadable_worlds_and_removes_missing_worlds_from_results() {
        let f = Fixture::new(); let one = f.instance("one"); world(&one,"Healthy","Healthy","26.3"); world(&one,"Broken","Broken","26.3");
        fs::write(Path::new(&one.directory).join("saves/Broken/level.dat"), b"broken").unwrap();
        let mut store = Store::default();
        record_join(&mut store, "one", Target {kind:Kind::World,target:"Deleted".into()}, "Deleted".into(),1);
        let library = scan(&[one],&store); assert_eq!(library.entries.len(),1); assert_eq!(library.warnings.len(),1);
        let bad = f.0.join("bad.json"); fs::write(&bad,b"{bad").unwrap(); assert!(read_store(&bad).is_err()); assert_eq!(fs::read(bad).unwrap(),b"{bad");
    }
    #[test]
    fn addresses_and_world_targets_cannot_escape_or_become_arguments() {
        for value in ["", "https://example.com", "example.com/path", "-Xmx8G", "user@example.com", "example.com:0", "example.com:65536", "example.com\n--flag"] { assert!(server_address(value).is_err(),"{value}"); }
        assert_eq!(server_address("[::1]:25566").unwrap(),"[::1]:25566");
        assert_eq!(server_address("LOCALHOST:25565").unwrap(),"localhost");
        for value in ["..", "../other", "C:\\World", "/world", "abc/../../world", "-flag"] { assert!(world_folder(value).is_err(),"{value}"); }
        let mut args=vec!["MainClass".into()]; append_target(&mut args,&Target{kind:Kind::World,target:"A world with spaces".into()});
        assert_eq!(args,vec!["MainClass","--quickPlaySingleplayer","A world with spaces"]);
    }
    #[test]
    fn direct_play_blocks_unsupported_versions_missing_worlds_and_downgrades() {
        let f=Fixture::new(); let mut one=f.instance("one"); world(&one,"Future","Future","26.4");
        assert!(validate_target(&one,&Target{kind:Kind::World,target:"Future".into()}).is_err());
        assert!(validate_target(&one,&Target{kind:Kind::World,target:"Deleted".into()}).is_err());
        let target=Target{kind:Kind::Server,target:"example.com".into()};
        for version in ["1.20","1.21.1","1.21.11","26.1","26.2","26.3"] { one.version=version.into(); assert!(validate_target(&one,&target).is_ok()); }
        for version in ["1.19.4","1.8.9","23w13a","bad"] {one.version=version.into();assert!(validate_target(&one,&target).is_err());}
        assert!(world_version_reason("26.3","1.21.11").is_none()); assert!(world_version_reason("26.3","26.4-snapshot-1").is_some());
        let metadata=serde_json::from_value(serde_json::json!({"arguments":{"game":[{"rules":[{"action":"allow","features":{"has_quick_plays_support":true}}],"value":["--quickPlayPath","${quickPlayPath}"]}]}})).unwrap();
        assert!(supports_quick_play(&metadata)); assert!(!supports_quick_play(&Default::default()));
    }
    #[test]
    fn failed_launches_never_become_recents_and_actual_join_logs_are_idempotent() {
        let f=Fixture::new(); let one=f.instance("one"); let store=f.0.join("portal.json");
        let mut tracker=JoinTracker::new(&one.directory);
        assert!(!tracker.observe_at("one",&store).unwrap()); assert!(!store.exists());
        fs::create_dir_all(tracker.path.parent().unwrap()).unwrap(); fs::write(&tracker.path,b"[{\"type\":").unwrap();
        assert!(!tracker.observe_at("one",&store).unwrap());
        fs::write(&tracker.path,br#"[{"type":"multiplayer","id":"PLAY.example.com:25565","name":"Friends","gamemode":"survival","lastPlayedTime":"2026-11-14T15:30:00Z"}]"#).unwrap();
        assert!(tracker.observe_at("one",&store).unwrap()); assert!(!tracker.observe_at("one",&store).unwrap());
        let saved=read_store(&store).unwrap(); assert_eq!(saved.entries.len(),1); assert_eq!(saved.entries[0].target,"play.example.com"); assert!(saved.entries[0].last_played.is_some());
        fs::write(&tracker.path,br#"[{"type":"singleplayer","id":"Meadow","name":"Meadow","gamemode":"creative","lastPlayedTime":"2026-11-14T15:40:00Z"}]"#).unwrap();
        assert!(tracker.observe_at("one",&store).unwrap()); assert_eq!(read_store(&store).unwrap().entries.len(),2);
        let path=tracker.path.clone(); drop(tracker); assert!(!path.exists());
        assert!(parse_joins(br#"[{"type":"realms","id":"123","lastPlayedTime":"x"}]"#).is_empty());
    }
    #[test]
    fn recent_updates_preserve_favorites_names_and_instance_ownership() {
        let mut store=Store::default();
        let target=Target{kind:Kind::Server,target:"example.com".into()};
        record_join(&mut store,"a",target.clone(),"First".into(),10);
        store.entries[0].favorite=true;store.entries[0].saved=true;
        record_join(&mut store,"a",target.clone(),"Changed".into(),20);
        record_join(&mut store,"b",target,"Other".into(),30);
        assert_eq!(store.entries.len(),2); assert_eq!(store.entries[0].name,"First"); assert!(store.entries[0].favorite); assert_eq!(store.entries[0].last_played,Some(20));
    }
}
