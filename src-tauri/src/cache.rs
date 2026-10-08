use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime},
};

const DEFAULT_CAPACITY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MIN_CAPACITY_BYTES: u64 = 512 * 1024 * 1024;
const MAX_CAPACITY_BYTES: u64 = 12 * 1024 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCacheSettings {
    pub directory: String,
    pub capacity_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCacheStatus {
    pub directory: String,
    pub capacity_bytes: u64,
    pub used_bytes: u64,
    pub item_count: u64,
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(super::bloom_data_dir()?.join("cache-settings.json"))
}

fn default_settings() -> Result<ClientCacheSettings, String> {
    Ok(ClientCacheSettings {
        directory: super::bloom_data_dir()?
            .join("cache")
            .to_string_lossy()
            .into_owned(),
        capacity_bytes: DEFAULT_CAPACITY_BYTES,
    })
}

pub fn load_settings() -> Result<ClientCacheSettings, String> {
    let path = settings_path()?;
    if !path.is_file() {
        return default_settings();
    }
    let mut settings: ClientCacheSettings = serde_json::from_slice(
        &fs::read(&path)
            .map_err(|error| format!("Bloom could not read cache settings: {error}"))?,
    )
    .map_err(|error| format!("Bloom cache settings are invalid: {error}"))?;
    settings.capacity_bytes = settings
        .capacity_bytes
        .clamp(MIN_CAPACITY_BYTES, MAX_CAPACITY_BYTES);
    Ok(settings)
}

fn cache_root() -> Result<PathBuf, String> {
    let path = PathBuf::from(load_settings()?.directory);
    validate_cache_directory(&path)?;
    fs::create_dir_all(&path)
        .map_err(|error| format!("Bloom could not create the cache folder: {error}"))?;
    Ok(path)
}

fn validate_cache_directory(path: &Path) -> Result<(), String> {
    let allowed_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| {
            value.eq_ignore_ascii_case("BloomCache") || value.eq_ignore_ascii_case("cache")
        })
        .unwrap_or(false);
    if !path.is_absolute() || path.parent().is_none() || !allowed_name {
        return Err("Bloom's cache must use a dedicated BloomCache folder.".into());
    }
    Ok(())
}

fn cache_file(namespace: &str, key: &str) -> Result<PathBuf, String> {
    let safe_namespace: String = namespace
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect();
    let digest = format!("{:x}", Sha256::digest(key.as_bytes()));
    Ok(cache_root()?
        .join(safe_namespace)
        .join(format!("{digest}.json")))
}

pub fn read_json<T: DeserializeOwned>(
    namespace: &str,
    key: &str,
    ttl: Option<Duration>,
) -> Option<T> {
    let path = cache_file(namespace, key).ok()?;
    if let Some(ttl) = ttl {
        let modified = fs::metadata(&path).ok()?.modified().ok()?;
        if modified.elapsed().ok()? > ttl {
            let _ = fs::remove_file(path);
            return None;
        }
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

pub fn write_json<T: Serialize>(namespace: &str, key: &str, value: &T) -> Result<(), String> {
    let path = cache_file(namespace, key)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Bloom could not create a cache section: {error}"))?;
    }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    fs::write(
        &temporary,
        serde_json::to_vec(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Bloom could not write cached data: {error}"))?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Bloom could not replace stale cached data: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("Bloom could not finish caching data: {error}"))?;
    static LAST_PRUNE: OnceLock<Mutex<std::time::Instant>> = OnceLock::new();
    let last_prune =
        LAST_PRUNE.get_or_init(|| Mutex::new(std::time::Instant::now() - Duration::from_secs(10)));
    let mut last = last_prune
        .lock()
        .map_err(|_| "Bloom cache cleanup is busy.".to_string())?;
    if last.elapsed() >= Duration::from_secs(5) {
        prune_to_capacity()?;
        *last = std::time::Instant::now();
    }
    Ok(())
}

#[tauri::command]
pub fn get_cached_thumbnail(key: String) -> Result<Option<String>, String> {
    if key.is_empty() || key.len() > 4096 {
        return Err("Invalid thumbnail cache key.".into());
    }
    Ok(read_json("rendered-thumbnails", &key, None))
}

#[tauri::command]
pub fn save_cached_thumbnail(key: String, data_url: String) -> Result<(), String> {
    if key.is_empty() || key.len() > 4096 {
        return Err("Invalid thumbnail cache key.".into());
    }
    if !data_url.starts_with("data:image/png;base64,") || data_url.len() > 2_800_000 {
        return Err("Invalid rendered thumbnail.".into());
    }
    write_json("rendered-thumbnails", &key, &data_url)
}

pub fn apply_cached_catalog_artwork(items: &mut [super::CatalogMod]) {
    for item in items {
        let Some(url) = item.icon_url.as_deref() else {
            continue;
        };
        if item.icon_source_url.is_none() && trusted_catalog_artwork_url(url) {
            item.icon_source_url = Some(url.to_string());
        }
        if url.starts_with("data:image/") {
            continue;
        }
        if let Some(data_url) = read_json::<String>("catalog-artwork", url, None) {
            item.icon_url = Some(data_url);
        }
    }
}

fn trusted_catalog_artwork_url(value: &str) -> bool {
    url::Url::parse(value)
        .ok()
        .filter(|url| url.scheme() == "https")
        .and_then(|url| url.host_str().map(str::to_owned))
        .map(|host| host == "cdn.modrinth.com" || host.ends_with(".modrinth.com"))
        .unwrap_or(false)
}

#[tauri::command]
pub fn get_cached_catalog_artwork(source_url: String) -> Result<Option<String>, String> {
    if !trusted_catalog_artwork_url(&source_url) {
        return Err("That catalog artwork address is not trusted.".into());
    }
    Ok(read_json("catalog-artwork", &source_url, None))
}

fn artwork_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else {
        None
    }
}

pub async fn cached_bloom_cosmetic_artwork(value: &str) -> Option<String> {
    let url = url::Url::parse(value).ok()?;
    let trusted = url.scheme() == "https"
        && url.host_str() == Some("api.north.bloomclient.org")
        && url.path().starts_with("/minecraft/v1/capes/assets/")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none();
    if !trusted {
        return None;
    }
    if let Some(cached) = read_json("cosmetic-artwork", value, None) {
        return Some(cached);
    }
    use base64::Engine;
    let response = super::bloom_http_client()
        .ok()?
        .get(url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    if response.content_length().unwrap_or(0) > 4 * 1024 * 1024 {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    if bytes.len() > 4 * 1024 * 1024 {
        return None;
    }
    let mime = artwork_mime(&bytes)?;
    let data_url = format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    let _ = write_json("cosmetic-artwork", value, &data_url);
    Some(data_url)
}

pub async fn warm_catalog_artwork(urls: Vec<String>) {
    use base64::Engine;
    use futures_util::{stream, StreamExt};
    let unique: std::collections::HashSet<String> = urls
        .into_iter()
        .filter(|url| trusted_catalog_artwork_url(url))
        .collect();
    stream::iter(unique)
        .for_each_concurrent(6, |url| async move {
            if read_json::<String>("catalog-artwork", &url, None).is_some() {
                return;
            }
            let Ok(client) = super::bloom_http_client() else {
                return;
            };
            let Ok(response) = client
                .get(&url)
                .timeout(Duration::from_secs(10))
                .send()
                .await
                .and_then(|response| response.error_for_status())
            else {
                return;
            };
            if response.content_length().unwrap_or(0) > 2 * 1024 * 1024 {
                return;
            }
            let Ok(bytes) = response.bytes().await else {
                return;
            };
            if bytes.len() > 2 * 1024 * 1024 {
                return;
            }
            let Some(mime) = artwork_mime(&bytes) else {
                return;
            };
            let data_url = format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            );
            let _ = write_json("catalog-artwork", &url, &data_url);
        })
        .await;
}

fn collect_files(root: &Path, files: &mut Vec<(PathBuf, u64, SystemTime)>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_files(&path, files);
        } else if metadata.is_file() {
            files.push((
                path,
                metadata.len(),
                metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            ));
        }
    }
}

fn cache_inventory() -> Result<Vec<(PathBuf, u64, SystemTime)>, String> {
    let mut files = Vec::new();
    collect_files(&cache_root()?, &mut files);
    Ok(files)
}

fn prune_to_capacity() -> Result<(), String> {
    let settings = load_settings()?;
    let mut files = cache_inventory()?;
    let mut total: u64 = files.iter().map(|(_, size, _)| *size).sum();
    if total <= settings.capacity_bytes {
        return Ok(());
    }
    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in files {
        if total <= settings.capacity_bytes {
            break;
        }
        if fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_client_cache_status() -> Result<ClientCacheStatus, String> {
    let settings = load_settings()?;
    let files = cache_inventory()?;
    Ok(ClientCacheStatus {
        directory: settings.directory,
        capacity_bytes: settings.capacity_bytes,
        used_bytes: files.iter().map(|(_, size, _)| *size).sum(),
        item_count: files.len() as u64,
    })
}

#[tauri::command]
pub fn choose_client_cache_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.join("BloomCache").to_string_lossy().into_owned())
}

#[tauri::command]
pub fn save_client_cache_settings(
    directory: String,
    capacity_bytes: u64,
) -> Result<ClientCacheStatus, String> {
    let capacity_bytes = capacity_bytes.clamp(MIN_CAPACITY_BYTES, MAX_CAPACITY_BYTES);
    let destination = PathBuf::from(directory.trim());
    validate_cache_directory(&destination)?;
    let previous = cache_root()?;
    if previous != destination {
        if destination.starts_with(&previous) || previous.starts_with(&destination) {
            return Err("Choose a cache folder outside the current cache folder.".into());
        }
        copy_tree(&previous, &destination)
            .map_err(|error| format!("Bloom could not move the cache: {error}"))?;
    }
    let settings = ClientCacheSettings {
        directory: destination.to_string_lossy().into_owned(),
        capacity_bytes,
    };
    fs::write(
        settings_path()?,
        serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Bloom could not save cache settings: {error}"))?;
    if previous != destination {
        let _ = fs::remove_dir_all(previous);
    }
    prune_to_capacity()?;
    get_client_cache_status()
}

#[tauri::command]
pub fn clear_client_cache() -> Result<ClientCacheStatus, String> {
    let root = cache_root()?;
    if root.exists() {
        fs::remove_dir_all(&root)
            .map_err(|error| format!("Bloom could not clear the cache: {error}"))?;
    }
    fs::create_dir_all(root)
        .map_err(|error| format!("Bloom could not recreate the cache folder: {error}"))?;
    get_client_cache_status()
}
