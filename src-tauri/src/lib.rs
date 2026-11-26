mod platform;
mod runtime_archive;
mod fabric_loader;
mod catalog_filters;
mod launch_cache;
mod screenshots;
mod pack_artwork;
mod content_transfer;
mod content_downloads;
mod client_notice;
mod notifications;
mod mod_duplicates;
mod now_playing;
#[cfg(windows)]
mod now_playing_app_icon;
#[cfg(windows)]
mod now_playing_volume;
mod instance_folders;
mod instance_actions;
mod portal;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::{Emitter, Manager};
mod cache;
mod cosmetics;
mod modpack_sharing;
mod pack_compatibility;
mod workspace_publication;
mod workspace_player;
mod workspace_install;
mod player_links;
mod social;
mod ask_delight;

mod wardrobe;

mod utilities;

const BACKEND_URL: &str = match option_env!("BLOOM_BACKEND_URL") {
    Some(value) => value,
    None => "https://api.north.bloomclient.org/minecraft",
};
static DOWNLOAD_WORKERS: AtomicUsize = AtomicUsize::new(3);
static BLOOM_HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

fn bloom_http_client() -> Result<&'static reqwest::Client, String> {
    BLOOM_HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(6))
                .pool_idle_timeout(std::time::Duration::from_secs(90))
                .tcp_nodelay(true)
                .user_agent(concat!(
                    "BloomClient/",
                    env!("CARGO_PKG_VERSION"),
                    " (support@bloomclient.org)"
                ))
                .build()
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn bloom_backend_request(
    method: reqwest::Method,
    path: &str,
    timeout_seconds: u64,
) -> Result<reqwest::RequestBuilder, String> {
    Ok(bloom_http_client()?
        .request(
            method,
            format!("{}{}", BACKEND_URL.trim_end_matches('/'), path),
        )
        .timeout(std::time::Duration::from_secs(timeout_seconds)))
}

fn command_without_console(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendCapabilities {
    catalog: bool,
    modrinth: bool,
    curseforge: bool,
    modpacks: bool,
    #[serde(default)]
    cosmetics: bool,
    #[serde(default)]
    pack_sharing: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    service: String,
    status: String,
    api_version: String,
    capabilities: BackendCapabilities,
    timestamp: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogMod {
    provider: String,
    project_id: String,
    slug: String,
    title: String,
    summary: String,
    icon_url: Option<String>,
    #[serde(default)]
    icon_source_url: Option<String>,
    author: String,
    downloads: u64,
    loader: String,
    game_version: String,
    version_id: String,
    version_number: String,
    file_name: String,
    file_size: u64,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default)]
    game_versions: Vec<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSearchResult {
    items: Vec<CatalogMod>,
    offset: u64,
    limit: u64,
    total: u64,
}

#[derive(serde::Deserialize)]
struct ModrinthSearchResponse {
    hits: Vec<ModrinthSearchHit>,
    offset: u64,
    limit: u64,
    total_hits: u64,
}

#[derive(serde::Deserialize)]
struct ModrinthSearchHit {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    icon_url: Option<String>,
    author: String,
    downloads: u64,
}

#[derive(Clone, serde::Deserialize)]
struct ModrinthVersion {
    id: String,
    #[serde(default)]
    project_id: Option<String>,
    version_number: String,
    version_type: String,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default)]
    date_published: String,
    #[serde(default)]
    dependencies: Vec<ModrinthDependency>,
    files: Vec<ModrinthFile>,
}

#[derive(Clone, serde::Deserialize)]
struct ModrinthDependency {
    project_id: Option<String>,
    version_id: Option<String>,
    dependency_type: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ModrinthModpackRelease {
    id: String,
    version_number: String,
    version_type: String,
    game_versions: Vec<String>,
    date_published: String,
    file_name: String,
    file_size: u64,
}

#[derive(Clone, serde::Deserialize)]
struct ModrinthFile {
    filename: String,
    url: String,
    size: u64,
    primary: bool,
    hashes: std::collections::HashMap<String, String>,
}

#[derive(serde::Deserialize)]
struct ModrinthProject {
    #[serde(default)]
    id: String,
    title: String,
    #[serde(default)]
    description: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogProjectDependency {
    project_id: String,
    title: String,
    dependency_type: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogProjectVersion {
    id: String,
    version_number: String,
    version_type: String,
    date_published: String,
    game_versions: Vec<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogProjectFile {
    file_name: String,
    file_size: u64,
    primary: bool,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogProjectDetails {
    description: String,
    dependencies: Vec<CatalogProjectDependency>,
    versions: Vec<CatalogProjectVersion>,
    files: Vec<CatalogProjectFile>,
}

fn catalog_category(category: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    match category {
        "mods" => Ok(("mod", "Fabric", "mods")),
        "resourcepacks" => Ok(("resourcepack", "Minecraft", "resourcepacks")),
        "shaderpacks" => Ok(("shader", "Shader", "shaderpacks")),
        "modpacks" => Ok(("modpack", "Fabric", "")),
        _ => Err("Unsupported Modrinth content category.".into()),
    }
}

fn valid_modrinth_project_id(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

fn primary_modrinth_file(version: &ModrinthVersion) -> Option<&ModrinthFile> {
    version
        .files
        .iter()
        .find(|file| file.primary)
        .or_else(|| version.files.first())
}

async fn direct_modrinth_search(
    query: String,
    game_version: String,
    offset: u64,
    category: &str,
    filters: Option<&catalog_filters::Filters>,
) -> Result<CatalogSearchResult, String> {
    use futures_util::future::join_all;

    let (project_type, loader_label, _) = catalog_category(category)?;
    let mut facets = vec![
        vec![format!("project_type:{project_type}")],
        vec![format!("versions:{game_version}")],
    ];
    if category == "mods" || category == "modpacks" {
        facets.push(vec!["categories:fabric".to_string()]);
    }
    if let Some(filters) = filters { facets = filters.facets(&game_version); }
    let requested_loader = filters.map(|value| value.loader.as_str()).unwrap_or("fabric");
    let index = filters.filter(|value| value.sort != "auto").map(|value| value.sort.as_str()).unwrap_or(if query.is_empty() { "downloads" } else { "relevance" });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!(
            "BloomClient/",
            env!("CARGO_PKG_VERSION"),
            " (support@bloomclient.org)"
        ))
        .build()
        .map_err(|error| error.to_string())?;
    let result = client
        .get("https://api.modrinth.com/v2/search")
        .query(&[
            ("query", query.as_str()),
            (
                "facets",
                serde_json::to_string(&facets)
                    .map_err(|error| error.to_string())?
                    .as_str(),
            ),
            (
                "index",
                index,
            ),
            ("limit", "50"),
            ("offset", offset.to_string().as_str()),
        ])
        .send()
        .await
        .map_err(|error| format!("The Modrinth catalog is unavailable: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Modrinth rejected the catalog search: {error}"))?
        .json::<ModrinthSearchResponse>()
        .await
        .map_err(|error| format!("Modrinth returned invalid catalog data: {error}"))?;

    let requests = result.hits.into_iter().map(|hit| {
        let client = client.clone();
        let game_version = game_version.clone();
        let category = category.to_string();
        async move {
            let game_versions = serde_json::to_string(&[game_version.as_str()]).ok()?;
            let mut request = client
                .get(format!(
                    "https://api.modrinth.com/v2/project/{}/version",
                    hit.project_id
                ))
                .query(&[("include_changelog", "false")]);
            if !game_version.is_empty() { request = request.query(&[("game_versions", game_versions.as_str())]); }
            let loaders;
            if (category == "mods" || category == "modpacks") && !requested_loader.is_empty() {
                loaders = serde_json::to_string(&[requested_loader]).ok()?;
                request = request.query(&[("loaders", loaders.as_str())]);
            }
            let versions = request
                .send()
                .await
                .ok()?
                .error_for_status()
                .ok()?
                .json::<Vec<ModrinthVersion>>()
                .await
                .ok()?;
            let version = if filters.is_some() { catalog_filters::matching_version(&versions, &game_version, requested_loader) }
                else { versions.iter().find(|version| version.version_type == "release").or_else(|| versions.first()) }?;
            let file = primary_modrinth_file(version)?;
            let icon_source_url = hit.icon_url.clone();
            Some(CatalogMod {
                provider: "modrinth".into(),
                project_id: hit.project_id,
                slug: hit.slug,
                title: hit.title,
                summary: hit.description,
                icon_url: hit.icon_url,
                icon_source_url,
                author: hit.author,
                downloads: hit.downloads,
                loader: if filters.is_some() { version.loaders.join(", ") } else { loader_label.into() },
                game_version: if game_version.is_empty() { version.game_versions.first().cloned().unwrap_or_default() } else { game_version.clone() },
                version_id: version.id.clone(),
                version_number: version.version_number.clone(),
                file_name: file.filename.clone(),
                file_size: file.size,
                loaders: version.loaders.clone(),
                game_versions: version.game_versions.clone(),
            })
        }
    });
    let items = join_all(requests).await.into_iter().flatten().collect();
    Ok(CatalogSearchResult {
        items,
        offset: result.offset,
        limit: result.limit,
        total: result.total_hits,
    })
}

#[tauri::command]
async fn get_backend_status() -> Result<BackendStatus, String> {
    bloom_backend_request(reqwest::Method::GET, "/health", 6)?
        .send()
        .await
        .map_err(|error| format!("Delight backend is unavailable: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Delight backend rejected the health check: {error}"))?
        .json::<BackendStatus>()
        .await
        .map_err(|error| format!("Delight backend returned an invalid response: {error}"))
}

#[tauri::command]
async fn search_modrinth_content(
    query: String,
    game_version: String,
    offset: u64,
    category: String,
    filters: Option<catalog_filters::Filters>,
) -> Result<CatalogSearchResult, String> {
    catalog_category(&category)?;
    if let Some(filters) = &filters {
        if category != "mods" { return Err("These filters apply to mods only.".into()); }
        filters.validate()?;
    }
    let filters = filters.filter(|value| !value.is_default() || game_version.is_empty());
    let mut cache_key = format!(
        "v2-50\n{category}\n{game_version}\n{offset}\n{}",
        query.trim().to_ascii_lowercase()
    );
    if let Some(filters) = &filters { cache_key.push_str(&format!("\nfilters:{}", serde_json::to_string(filters).map_err(|error| error.to_string())?)); }
    if let Some(mut cached) = cache::read_json::<CatalogSearchResult>(
        "catalog",
        &cache_key,
        Some(std::time::Duration::from_secs(15 * 60)),
    ) {
        cache::apply_cached_catalog_artwork(&mut cached.items);
        return Ok(cached);
    }
    if category != "mods" || filters.is_some() {
        let mut result = direct_modrinth_search(query, game_version, offset, &category, filters.as_ref()).await?;
        let _ = cache::write_json("catalog", &cache_key, &result);
        let artwork = result.items.iter().filter_map(|item| item.icon_url.clone()).collect();
        tauri::async_runtime::spawn(cache::warm_catalog_artwork(artwork));
        cache::apply_cached_catalog_artwork(&mut result.items);
        return Ok(result);
    }
    let mut result = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("BloomClient/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!(
            "{}/v1/catalog/search",
            BACKEND_URL.trim_end_matches('/')
        ))
        .query(&[
            ("query", query),
            ("gameVersion", game_version),
            ("loader", "fabric".to_string()),
            ("offset", offset.to_string()),
        ])
        .send()
        .await
        .map_err(|error| format!("The Delight mod catalog is unavailable: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The Delight mod catalog rejected the search: {error}"))?
        .json::<CatalogSearchResult>()
        .await
        .map_err(|error| format!("The Delight mod catalog returned invalid data: {error}"))?;
    let _ = cache::write_json("catalog", &cache_key, &result);
    let artwork = result.items.iter().filter_map(|item| item.icon_url.clone()).collect();
    tauri::async_runtime::spawn(cache::warm_catalog_artwork(artwork));
    cache::apply_cached_catalog_artwork(&mut result.items);
    Ok(result)
}

#[tauri::command]
async fn get_modrinth_project_details(
    project_id: String,
    game_version: String,
    category: String,
    loader: Option<String>,
    version_id: Option<String>,
) -> Result<CatalogProjectDetails, String> {
    catalog_category(&category)?;
    if !valid_modrinth_project_id(project_id.trim()) {
        return Err("That Modrinth project selection is invalid.".into());
    }
    let loader = loader.unwrap_or_else(|| "fabric".into());
    let cache_key = format!("v2\n{category}\n{game_version}\n{loader}\n{version_id:?}\n{}", project_id.trim());
    if let Some(cached) = cache::read_json::<CatalogProjectDetails>(
        "catalog-details",
        &cache_key,
        Some(std::time::Duration::from_secs(30 * 60)),
    ) {
        return Ok(cached);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!(
            "BloomClient/",
            env!("CARGO_PKG_VERSION"),
            " (support@bloomclient.org)"
        ))
        .build()
        .map_err(|error| error.to_string())?;
    let project = client
        .get(format!("https://api.modrinth.com/v2/project/{}", project_id.trim()))
        .send()
        .await
        .map_err(|error| format!("Delight could not load that project's details: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Modrinth rejected that project request: {error}"))?
        .json::<ModrinthProject>()
        .await
        .map_err(|error| format!("Modrinth returned invalid project details: {error}"))?;

    let game_versions = serde_json::to_string(&[game_version.as_str()])
        .map_err(|error| error.to_string())?;
    let mut request = client
        .get(format!(
            "https://api.modrinth.com/v2/project/{}/version",
            project_id.trim()
        ))
        .query(&[
            ("game_versions", game_versions.as_str()),
            ("include_changelog", "false"),
        ]);
    let loaders;
    if category == "mods" {
        loaders = serde_json::to_string(&[loader.as_str()]).map_err(|error| error.to_string())?;
        request = request.query(&[("loaders", loaders.as_str())]);
    }
    let versions = request
        .send()
        .await
        .map_err(|error| format!("Delight could not load compatible versions: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Modrinth rejected that version request: {error}"))?
        .json::<Vec<ModrinthVersion>>()
        .await
        .map_err(|error| format!("Modrinth returned invalid version data: {error}"))?;

    let latest = if let Some(id) = version_id.as_deref() {
        Some(versions.iter().find(|version| version.id == id).ok_or("This mod version is no longer available. Refresh the search and try again.")?)
    } else { versions.iter().find(|version| version.version_type == "release").or_else(|| versions.first()) };
    let dependency_ids: Vec<String> = latest
        .into_iter()
        .flat_map(|version| version.dependencies.iter())
        .filter_map(|dependency| dependency.project_id.clone())
        .take(20)
        .collect();
    let dependency_titles: std::collections::HashMap<String, String> = if dependency_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        let ids = serde_json::to_string(&dependency_ids).map_err(|error| error.to_string())?;
        let projects = match client
            .get("https://api.modrinth.com/v2/projects")
            .query(&[("ids", ids.as_str())])
            .send()
            .await
        {
            Ok(response) => match response.error_for_status() {
                Ok(response) => response.json::<Vec<ModrinthProject>>().await.unwrap_or_default(),
                Err(_) => Vec::new(),
            },
            Err(_) => Vec::new(),
        };
        projects
            .into_iter()
            .map(|project| (project.id, project.title))
            .collect()
    };
    let dependencies = latest
        .into_iter()
        .flat_map(|version| version.dependencies.iter())
        .filter_map(|dependency| {
            let project_id = dependency.project_id.clone()?;
            Some(CatalogProjectDependency {
                title: dependency_titles
                    .get(&project_id)
                    .cloned()
                    .unwrap_or_else(|| project_id.clone()),
                project_id,
                dependency_type: dependency.dependency_type.clone(),
            })
        })
        .collect();
    let files = latest
        .into_iter()
        .flat_map(|version| version.files.iter())
        .map(|file| CatalogProjectFile {
            file_name: file.filename.clone(),
            file_size: file.size,
            primary: file.primary,
        })
        .collect();
    let details = CatalogProjectDetails {
        description: project.description,
        dependencies,
        versions: versions
            .iter()
            .take(12)
            .map(|version| CatalogProjectVersion {
                id: version.id.clone(),
                version_number: version.version_number.clone(),
                version_type: version.version_type.clone(),
                date_published: version.date_published.clone(),
                game_versions: version.game_versions.clone(),
            })
            .collect(),
        files,
    };
    let _ = cache::write_json("catalog-details", &cache_key, &details);
    Ok(details)
}

#[tauri::command]
async fn list_modrinth_modpack_releases(
    project_id: String,
) -> Result<Vec<ModrinthModpackRelease>, String> {
    let project_id = project_id.trim();
    if !valid_modrinth_project_id(project_id) {
        return Err("That Modrinth modpack selection is invalid.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!(
            "BloomClient/",
            env!("CARGO_PKG_VERSION"),
            " (support@bloomclient.org)"
        ))
        .build()
        .map_err(|error| error.to_string())?;
    let loaders = serde_json::to_string(&["fabric"]).map_err(|error| error.to_string())?;
    let versions = client
        .get(format!(
            "https://api.modrinth.com/v2/project/{project_id}/version"
        ))
        .query(&[
            ("loaders", loaders.as_str()),
            ("include_changelog", "false"),
        ])
        .send()
        .await
        .map_err(|error| format!("Delight could not load that modpack's releases: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Modrinth rejected that modpack release request: {error}"))?
        .json::<Vec<ModrinthVersion>>()
        .await
        .map_err(|error| format!("Modrinth returned invalid modpack release data: {error}"))?;

    Ok(versions
        .into_iter()
        .filter_map(|version| {
            if !version.loaders.iter().any(|loader| loader == "fabric") {
                return None;
            }
            let file = version
                .files
                .iter()
                .find(|file| {
                    file.primary && file.filename.to_ascii_lowercase().ends_with(".mrpack")
                })
                .or_else(|| {
                    version
                        .files
                        .iter()
                        .find(|file| file.filename.to_ascii_lowercase().ends_with(".mrpack"))
                })?;
            Some(ModrinthModpackRelease {
                id: version.id,
                version_number: version.version_number,
                version_type: version.version_type,
                game_versions: version.game_versions,
                date_published: version.date_published,
                file_name: file.filename.clone(),
                file_size: file.size,
            })
        })
        .collect())
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct MinecraftSession {
    username: String,
    uuid: String,
    access_token: String,
    refresh_token: String,
    client_id: String,
    #[serde(default)]
    expires_at: u64,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MinecraftAccountProfile {
    id: String,
    name: String,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MinecraftAccountStore {
    active_id: Option<String>,
    accounts: Vec<MinecraftAccountProfile>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MinecraftAccountList {
    active_id: Option<String>,
    accounts: Vec<MinecraftAccountProfile>,
}

#[derive(Default)]
struct LauncherState {
    session: Arc<Mutex<Option<MinecraftSession>>>,
    launch_active: Arc<Mutex<bool>>,
    cancel_requested: Arc<AtomicBool>,
    content_install_queue: Arc<Mutex<content_downloads::ContentQueue>>,
    content_install_active: Arc<AtomicBool>,
    content_cancel_requested: Arc<AtomicBool>,
    game_running: Arc<AtomicBool>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LaunchProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    launch_id: Option<String>,
    instance_id: String,
    state: String,
    progress: u8,
    message: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    bytes_per_second: u64,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameLogLine {
    instance_id: String,
    stream: String,
    line: String,
}

fn emit_game_log(app: &tauri::AppHandle, instance_id: &str, stream: &str, line: String) {
    let _ = app.emit(
        "minecraft-log-line",
        GameLogLine {
            instance_id: instance_id.to_string(),
            stream: stream.to_string(),
            line,
        },
    );
}

static CURRENT_LAUNCH: OnceLock<Mutex<LaunchProgress>> = OnceLock::new();

fn current_launch() -> &'static Mutex<LaunchProgress> {
    CURRENT_LAUNCH.get_or_init(|| {
        Mutex::new(LaunchProgress {
            completed_at: None,
            launch_id: None,
            instance_id: String::new(),
            state: "idle".into(),
            progress: 0,
            message: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            bytes_per_second: 0,
        })
    })
}

fn emit_launch(
    app: &tauri::AppHandle,
    instance_id: &str,
    state: &str,
    progress: u8,
    message: impl Into<String>,
) {
    let payload = LaunchProgress {
        completed_at: (state == "complete").then(|| std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64),
        launch_id: None,
        instance_id: instance_id.to_string(),
        state: state.to_string(),
        progress,
        message: message.into(),
        downloaded_bytes: 0,
        total_bytes: 0,
        bytes_per_second: 0,
    };
    publish_launch_progress(app, payload);
}

fn emit_download(
    app: &tauri::AppHandle,
    instance_id: &str,
    progress: u8,
    message: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    bytes_per_second: u64,
) {
    let payload = LaunchProgress {
        completed_at: None,
        launch_id: None,
        instance_id: instance_id.to_string(),
        state: "installing".into(),
        progress,
        message,
        downloaded_bytes,
        total_bytes,
        bytes_per_second,
    };
    publish_launch_progress(app, payload);
}

fn publish_launch_progress(app: &tauri::AppHandle, mut payload: LaunchProgress) {
    if let Ok(mut current) = current_launch().lock() {
        // Only the native Play path begins with "launching" at zero. Repair and
        // import also emit installation progress, without starting a launch.
        if payload.state == "launching" && payload.progress == 0 {
            payload.launch_id = Some(uuid::Uuid::new_v4().to_string());
        } else if payload.instance_id == current.instance_id
            && matches!(current.state.as_str(), "launching" | "installing" | "running")
        {
            payload.launch_id = current.launch_id.clone();
        }
        *current = payload.clone();
    }
    workspace_install::runtime_progress(app, &payload);
    let _ = app.emit("minecraft-launch-progress", payload);
}

#[tauri::command]
fn get_minecraft_launch_status() -> LaunchProgress {
    current_launch()
        .lock()
        .map(|status| status.clone())
        .unwrap_or(LaunchProgress {
            completed_at: None,
            launch_id: None,
            instance_id: String::new(),
            state: "idle".into(),
            progress: 0,
            message: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            bytes_per_second: 0,
        })
}

#[tauri::command]
fn get_minecraft_process_running(state: tauri::State<'_, LauncherState>) -> bool {
    state.game_running.load(Ordering::SeqCst)
}

fn cancel_active_task(state: &LauncherState) {
    if state.content_install_active.load(Ordering::SeqCst) {
        state.content_cancel_requested.store(true, Ordering::SeqCst);
    } else {
        state.cancel_requested.store(true, Ordering::SeqCst);
    }
}

#[tauri::command]
fn cancel_minecraft_launch(state: tauri::State<'_, LauncherState>) {
    cancel_active_task(&state);
}

#[tauri::command]
fn cancel_titlebar_launch(
    launch_id: String,
    state: tauri::State<'_, LauncherState>,
) -> Result<(), String> {
    let progress = current_launch()
        .lock()
        .map_err(|_| "Couldn’t cancel the Minecraft launch.")?;
    if progress.launch_id.as_deref() == Some(launch_id.as_str())
        && matches!(progress.state.as_str(), "installing" | "launching")
    {
        state.cancel_requested.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn validate_content_install_activity(category: &str, active: bool, running: bool) -> Result<(), String> {
    if running && category == "mods" {
        return Err("Close Minecraft before installing mods.".into());
    }
    if active && !running {
        return Err("Minecraft is currently being installed or launched.".into());
    }
    Ok(())
}

fn legacy_saved_session() -> Option<MinecraftSession> {
    let profile_entry = keyring::Entry::new("Bloom Client", "minecraft-profile").ok()?;
    let profile: serde_json::Value =
        serde_json::from_str(&profile_entry.get_password().ok()?).ok()?;
    let access_token = keyring::Entry::new("Bloom Client", "minecraft-access-token")
        .ok()?
        .get_password()
        .ok()?;
    let refresh_token = keyring::Entry::new("Bloom Client", "microsoft-refresh-token")
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .unwrap_or_default();
    Some(MinecraftSession {
        username: profile["username"].as_str()?.to_string(),
        uuid: profile["uuid"].as_str()?.to_string(),
        client_id: profile["clientId"].as_str()?.to_string(),
        access_token,
        refresh_token,
        expires_at: 0,
    })
}

fn account_store_path() -> Result<std::path::PathBuf, String> {
    Ok(bloom_data_dir()?.join("minecraft-accounts.json"))
}

fn read_account_store() -> MinecraftAccountStore {
    account_store_path()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_account_store(store: &MinecraftAccountStore) -> Result<(), String> {
    let path = account_store_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(
        path,
        serde_json::to_vec_pretty(store).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn account_credential_name(uuid: &str) -> String {
    format!(
        "minecraft-account-{}",
        uuid.chars()
            .filter(|value| value.is_ascii_alphanumeric())
            .collect::<String>()
    )
}

fn account_credential_part(uuid: &str, part: &str) -> String {
    format!("{}-{part}", account_credential_name(uuid))
}

fn split_credential_secret(value: &str) -> Vec<String> {
    const CHUNK_CHARACTERS: usize = 1200;
    let characters = value.chars().collect::<Vec<_>>();
    characters
        .chunks(CHUNK_CHARACTERS)
        .map(|chunk| chunk.iter().collect())
        .collect()
}

fn save_chunked_credential(uuid: &str, kind: &str, value: &str) -> Result<(), String> {
    let chunks = split_credential_secret(value);
    for (index, chunk) in chunks.iter().enumerate() {
        keyring::Entry::new(
            "Bloom Client",
            &account_credential_part(uuid, &format!("{kind}-{index}")),
        )
        .map_err(|error| format!("The system credential store could not prepare secure account storage: {error}"))?
        .set_password(chunk)
        .map_err(|error| format!("The system credential store could not save this account securely: {error}"))?;
    }
    keyring::Entry::new(
        "Bloom Client",
        &account_credential_part(uuid, &format!("{kind}-count")),
    )
    .map_err(|error| format!("The system credential store could not prepare secure account storage: {error}"))?
    .set_password(&chunks.len().to_string())
    .map_err(|error| format!("The system credential store could not save this account securely: {error}"))?;
    for index in chunks.len()..32 {
        delete_credential_entry(&account_credential_part(uuid, &format!("{kind}-{index}")))?;
    }
    Ok(())
}

fn load_chunked_credential(uuid: &str, kind: &str) -> Option<String> {
    let count = keyring::Entry::new(
        "Bloom Client",
        &account_credential_part(uuid, &format!("{kind}-count")),
    )
    .ok()?
    .get_password()
    .ok()?
    .parse::<usize>()
    .ok()?;
    if count > 32 {
        return None;
    }
    let mut value = String::new();
    for index in 0..count {
        value.push_str(
            &keyring::Entry::new(
                "Bloom Client",
                &account_credential_part(uuid, &format!("{kind}-{index}")),
            )
            .ok()?
            .get_password()
            .ok()?,
        );
    }
    Some(value)
}

fn delete_credential_entry(name: &str) -> Result<(), String> {
    let entry = keyring::Entry::new("Bloom Client", name).map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn delete_account_credentials(uuid: &str) -> Result<(), String> {
    delete_credential_entry(&account_credential_name(uuid))?;
    delete_credential_entry(&account_credential_part(uuid, "profile"))?;
    for kind in ["access", "refresh"] {
        delete_credential_entry(&account_credential_part(uuid, &format!("{kind}-count")))?;
        for index in 0..32 {
            delete_credential_entry(&account_credential_part(uuid, &format!("{kind}-{index}")))?;
        }
    }
    Ok(())
}

fn load_account_session(uuid: &str) -> Option<MinecraftSession> {
    let profile_name = account_credential_part(uuid, "profile");
    if let Ok(entry) = keyring::Entry::new("Bloom Client", &profile_name) {
        if let Ok(value) = entry.get_password() {
            if let Ok(profile) = serde_json::from_str::<MinecraftSession>(&value) {
                return Some(MinecraftSession {
                    access_token: load_chunked_credential(uuid, "access")?,
                    refresh_token: load_chunked_credential(uuid, "refresh")?,
                    ..profile
                });
            }
        }
    }
    let value = keyring::Entry::new("Bloom Client", &account_credential_name(uuid))
        .ok()?
        .get_password()
        .ok()?;
    serde_json::from_str(&value).ok()
}

fn save_account_session(session: &MinecraftSession, make_active: bool) -> Result<(), String> {
    save_chunked_credential(&session.uuid, "access", &session.access_token)?;
    save_chunked_credential(&session.uuid, "refresh", &session.refresh_token)?;
    let profile = MinecraftSession {
        username: session.username.clone(),
        uuid: session.uuid.clone(),
        client_id: session.client_id.clone(),
        access_token: String::new(),
        refresh_token: String::new(),
        expires_at: session.expires_at,
    };
    keyring::Entry::new(
        "Bloom Client",
        &account_credential_part(&session.uuid, "profile"),
    )
    .map_err(|error| format!("The system credential store could not prepare secure account storage: {error}"))?
    .set_password(&serde_json::to_string(&profile).map_err(|error| error.to_string())?)
    .map_err(|error| format!("The system credential store could not save this account securely: {error}"))?;
    delete_credential_entry(&account_credential_name(&session.uuid))?;
    let mut store = read_account_store();
    if let Some(account) = store
        .accounts
        .iter_mut()
        .find(|account| account.id == session.uuid)
    {
        account.name = session.username.clone();
    } else {
        store.accounts.push(MinecraftAccountProfile {
            id: session.uuid.clone(),
            name: session.username.clone(),
        });
    }
    if make_active {
        store.active_id = Some(session.uuid.clone());
    }
    write_account_store(&store)
}

fn delete_legacy_session() -> Result<(), String> {
    for name in [
        "minecraft-profile",
        "minecraft-access-token",
        "microsoft-refresh-token",
        "minecraft-session",
    ] {
        let entry = keyring::Entry::new("Bloom Client", name).map_err(|error| error.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => {
                return Err(format!(
                    "The system credential store could not remove the saved sign-in: {error}"
                ))
            }
        }
    }
    Ok(())
}

fn ensure_account_store() -> Result<MinecraftAccountStore, String> {
    let store = read_account_store();
    if !store.accounts.is_empty() {
        return Ok(store);
    }
    if let Some(session) = legacy_saved_session() {
        save_account_session(&session, true)?;
        delete_legacy_session()?;
        return Ok(read_account_store());
    }
    Ok(store)
}

fn saved_session() -> Option<MinecraftSession> {
    let store = ensure_account_store().ok()?;
    load_account_session(store.active_id.as_deref()?)
}

#[tauri::command]
async fn list_minecraft_accounts() -> Result<MinecraftAccountList, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let store = ensure_account_store()?;
        Ok(MinecraftAccountList {
            active_id: store.active_id,
            accounts: store.accounts,
        })
    })
    .await
    .map_err(|error| format!("The account reader stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn sign_out_minecraft(
    state: tauri::State<'_, LauncherState>,
) -> Result<Option<serde_json::Value>, String> {
    let session_store = state.session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = ensure_account_store()?;
        let Some(active_id) = store.active_id.clone() else {
            return Ok(None);
        };
        delete_account_credentials(&active_id)
            .map_err(|error| format!("The system credential store could not remove the saved account: {error}"))?;
        store.accounts.retain(|account| account.id != active_id);
        store.active_id = store.accounts.first().map(|account| account.id.clone());
        write_account_store(&store)?;
        let next = store.active_id.as_deref().and_then(load_account_session);
        *session_store
            .lock()
            .map_err(|_| "Unable to clear the Minecraft sign-in session.")? = next.clone();
        Ok(next.map(|session| serde_json::json!({ "id": session.uuid, "name": session.username })))
    })
    .await
    .map_err(|error| format!("The sign-out task stopped unexpectedly: {error}"))?
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Welcome to Delight Client, {name}!")
}

#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    if text.is_empty() || text.len() > 128 || text.chars().any(char::is_control) {
        return Err("That text cannot be copied.".into());
    }
    let mut last_error = None;
    for _ in 0..6 {
        match arboard::Clipboard::new() {
            Ok(mut clipboard) => match clipboard.set_text(text.clone()) {
                Ok(()) => {
                    std::thread::sleep(std::time::Duration::from_millis(15));
                    match clipboard.get_text() {
                        Ok(copied) if copied == text => return Ok(()),
                        Ok(_) => last_error = Some("The system replaced the clipboard contents".into()),
                        Err(error) => last_error = Some(format!("clipboard verification failed: {error}")),
                    }
                }
                Err(error) => last_error = Some(error.to_string()),
            },
            Err(error) => last_error = Some(error.to_string()),
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    Err(format!(
        "The system could not copy the code: {}",
        last_error.unwrap_or_else(|| "the clipboard is unavailable".into())
    ))
}

#[tauri::command]
async fn request_microsoft_device_code(client_id: String) -> Result<serde_json::Value, String> {
    let response = reqwest::Client::new()
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
        .form(&[
            ("client_id", client_id),
            ("scope", "XboxLive.signin offline_access".to_string()),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(body
            .get("error_description")
            .and_then(|v| v.as_str())
            .unwrap_or("Microsoft device authorization failed.")
            .to_string());
    }
    Ok(body)
}

async fn read_auth_response(
    response: reqwest::Response,
    service: &str,
) -> Result<serde_json::Value, String> {
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    let body: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({ "raw": text }));
    if !status.is_success() {
        let detail = body
            .get("Message")
            .or_else(|| body.get("error_description"))
            .or_else(|| body.get("error"))
            .and_then(|value| value.as_str())
            .unwrap_or("No additional details.");
        return Err(format!(
            "{service} rejected the account (HTTP {status}): {detail}"
        ));
    }
    Ok(body)
}

async fn minecraft_session_from_microsoft(
    client: &reqwest::Client,
    client_id: String,
    microsoft_access_token: String,
    refresh_token: String,
) -> Result<MinecraftSession, String> {
    let xbl_response = client.post("https://user.auth.xboxlive.com/user/authenticate").json(&serde_json::json!({"Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket":format!("d={microsoft_access_token}")},"RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"})).send().await.map_err(|error| error.to_string())?;
    let xbl = read_auth_response(xbl_response, "Xbox Live").await?;
    let xsts_response = client.post("https://xsts.auth.xboxlive.com/xsts/authorize").json(&serde_json::json!({"Properties":{"SandboxId":"RETAIL","UserTokens":[xbl["Token"]]},"RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"})).send().await.map_err(|error| error.to_string())?;
    let xsts = read_auth_response(xsts_response, "Xbox security").await?;
    let identity = xsts["DisplayClaims"]["xui"][0]["uhs"]
        .as_str()
        .ok_or("Xbox authentication did not return a user identity.")?;
    let xsts_token = xsts["Token"]
        .as_str()
        .ok_or("Xbox authentication did not return an XSTS token.")?;
    let minecraft_response = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&serde_json::json!({"identityToken":format!("XBL3.0 x={identity};{xsts_token}")}))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let minecraft = read_auth_response(minecraft_response, "Minecraft services").await?;
    let minecraft_token = minecraft["access_token"].as_str().ok_or(
        "Minecraft services login failed. Make sure this Microsoft account owns Minecraft.",
    )?;
    let profile_response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(minecraft_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let profile = read_auth_response(profile_response, "Minecraft profile").await?;
    let username = profile
        .get("name")
        .and_then(|value| value.as_str())
        .ok_or("No Minecraft profile was found on this account.")?
        .to_string();
    let uuid = profile
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or("No Minecraft profile was found on this account.")?
        .to_string();
    Ok(MinecraftSession {
        username,
        uuid,
        access_token: minecraft_token.to_string(),
        refresh_token,
        client_id,
        expires_at: minecraft["expires_in"].as_u64().filter(|seconds| *seconds <= 86400).map(|seconds| launch_cache::now().saturating_add(seconds)).unwrap_or(0),
    })
}

async fn refresh_minecraft_session(session: &MinecraftSession) -> Result<MinecraftSession, String> {
    if session.refresh_token.is_empty() {
        return Err("This saved account needs to reconnect with Microsoft.".into());
    }
    let client = reqwest::Client::new();
    let response = client
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", session.client_id.clone()),
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", session.refresh_token.clone()),
            ("scope", "XboxLive.signin offline_access".to_string()),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let tokens = read_auth_response(response, "Microsoft sign-in refresh").await?;
    let access_token = tokens
        .get("access_token")
        .and_then(|value| value.as_str())
        .ok_or("Microsoft did not return a refreshed access token.")?
        .to_string();
    let refresh_token = tokens
        .get("refresh_token")
        .and_then(|value| value.as_str())
        .unwrap_or(&session.refresh_token)
        .to_string();
    minecraft_session_from_microsoft(
        &client,
        session.client_id.clone(),
        access_token,
        refresh_token,
    )
    .await
}

async fn launch_session(stored: &MinecraftSession) -> Result<MinecraftSession, String> {
    // Unknown/old expiry metadata forces the established full refresh path.
    if !launch_cache::fresh_session(stored.expires_at, launch_cache::now()) {
        return refresh_minecraft_session(stored).await;
    }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build().map_err(|e| e.to_string())?;
    let response = client.get("https://api.minecraftservices.com/minecraft/profile").bearer_auth(&stored.access_token).send().await.map_err(|_| "Minecraft account validation could not be reached.".to_string())?;
    if response.status() == 401 || response.status() == 403 { return refresh_minecraft_session(stored).await; }
    let profile = read_auth_response(response, "Minecraft profile").await?;
    if profile["id"].as_str() != Some(stored.uuid.as_str()) { return Err("The Minecraft account changed. Sign in again.".into()); }
    let mut session = stored.clone();
    if let Some(name) = profile["name"].as_str() { session.username = name.to_owned(); }
    Ok(session)
}

#[tauri::command]
async fn complete_microsoft_login(
    state: tauri::State<'_, LauncherState>,
    client_id: String,
    device_code: String,
    interval: u64,
    expires_in: u64,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(expires_in);
    let mut wait_seconds = interval.max(5);
    let tokens = loop {
        if std::time::Instant::now() >= deadline {
            return Err("The Microsoft sign-in code expired.".into());
        }
        tokio::time::sleep(std::time::Duration::from_secs(wait_seconds)).await;
        let response = client
            .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
            .form(&[
                ("client_id", client_id.clone()),
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:device_code".into(),
                ),
                ("device_code", device_code.clone()),
            ])
            .send()
            .await
            .map_err(|error| error.to_string())?;
        let body: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
        if body.get("access_token").and_then(|v| v.as_str()).is_some() {
            break body;
        }
        match body.get("error").and_then(|v| v.as_str()) {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                wait_seconds += 5;
                continue;
            }
            _ => {
                return Err(body
                    .get("error_description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Microsoft sign-in failed.")
                    .to_string())
            }
        }
    };
    let access_token = tokens["access_token"]
        .as_str()
        .ok_or("Microsoft did not return an access token.")?
        .to_string();
    let refresh_token = tokens["refresh_token"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    let session =
        minecraft_session_from_microsoft(&client, client_id, access_token, refresh_token).await?;
    save_account_session(&session, true)?;
    *state
        .session
        .lock()
        .map_err(|_| "Unable to save the Minecraft sign-in session.")? = Some(session.clone());
    Ok(serde_json::json!({ "id": session.uuid, "name": session.username }))
}

#[tauri::command]
async fn switch_minecraft_account(
    state: tauri::State<'_, LauncherState>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let stored =
        load_account_session(&account_id).ok_or("This saved account could not be found.")?;
    let session = refresh_minecraft_session(&stored)
        .await
        .map_err(|error| format!("This account needs to reconnect: {error}"))?;
    save_account_session(&session, true)?;
    *state
        .session
        .lock()
        .map_err(|_| "Unable to switch the Minecraft account.")? = Some(session.clone());
    Ok(serde_json::json!({ "id": session.uuid, "name": session.username }))
}

#[tauri::command]
async fn get_saved_minecraft_profile(
    state: tauri::State<'_, LauncherState>,
) -> Result<Option<serde_json::Value>, String> {
    let session_store = state.session.clone();
    let profile = tauri::async_runtime::spawn_blocking(move || {
        let session = session_store
            .lock()
            .ok()
            .and_then(|session| session.clone())
            .or_else(saved_session)?;
        Some(serde_json::json!({ "id": session.uuid, "name": session.username }))
    })
    .await
    .map_err(|error| format!("The saved-account reader stopped unexpectedly: {error}"))?;
    Ok(profile)
}

#[tauri::command]
async fn get_minecraft_skin(account_id: String) -> Result<String, String> {
    let (skin_url, _) = minecraft_skin_metadata(&account_id).await?;
    wardrobe::texture(&skin_url).await
}

async fn minecraft_skin_metadata(account_id: &str) -> Result<(String, &'static str), String> {
    use base64::Engine;

    let uuid: String = account_id
        .chars()
        .filter(|character| *character != '-')
        .collect();
    if uuid.len() != 32 || !uuid.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("The selected Minecraft account has an invalid UUID.".to_string());
    }

    let profile = bloom_http_client()?
        .get(format!(
            "https://sessionserver.mojang.com/session/minecraft/profile/{uuid}"
        ))
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .map_err(|error| format!("Minecraft did not return this account's skin: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Minecraft did not return this account's skin: {error}"))?
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Minecraft returned an unreadable skin profile: {error}"))?;

    let encoded_textures = profile["properties"]
        .as_array()
        .and_then(|properties| {
            properties.iter().find_map(|property| {
                (property["name"].as_str() == Some("textures"))
                    .then(|| property["value"].as_str())
                    .flatten()
            })
        })
        .ok_or("Minecraft did not provide a skin for this account.")?;
    let decoded_textures = base64::engine::general_purpose::STANDARD
        .decode(encoded_textures)
        .map_err(|_| "Minecraft returned invalid skin metadata.".to_string())?;
    let textures: serde_json::Value = serde_json::from_slice(&decoded_textures)
        .map_err(|_| "Minecraft returned invalid skin metadata.".to_string())?;
    let skin_url = textures["textures"]["SKIN"]["url"]
        .as_str()
        .ok_or("Minecraft did not provide a skin for this account.")?;
    let model = if textures["textures"]["SKIN"]["metadata"]["model"] == "slim" {
        "slim"
    } else {
        "classic"
    };
    Ok((skin_url.to_owned(), model))
}

#[derive(serde::Serialize, Clone)]
struct JavaInstallation {
    path: String,
    major_version: Option<u32>,
    usable: bool,
}

static JAVA_INSTALLATION_CACHE: OnceLock<
    Mutex<Option<(std::time::Instant, Vec<JavaInstallation>)>>,
> = OnceLock::new();

fn java_installation_cache() -> &'static Mutex<Option<(std::time::Instant, Vec<JavaInstallation>)>>
{
    JAVA_INSTALLATION_CACHE.get_or_init(|| Mutex::new(None))
}

fn invalidate_java_installation_cache() {
    if let Ok(mut cache) = java_installation_cache().lock() {
        *cache = None;
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ManagedJavaRuntime {
    major_version: u32,
    architecture: String,
    provider: String,
    java_path: String,
}

fn managed_java_root() -> Result<std::path::PathBuf, String> {
    let root = bloom_data_dir()?.join("runtimes").join("java");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn managed_java_runtimes() -> Vec<ManagedJavaRuntime> {
    let Ok(root) = managed_java_root() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| std::fs::read(entry.path().join("runtime.json")).ok())
        .filter_map(|bytes| serde_json::from_slice::<ManagedJavaRuntime>(&bytes).ok())
        .filter(|runtime| std::path::Path::new(&runtime.java_path).is_file())
        .collect()
}

#[tauri::command]
async fn list_managed_java_runtimes() -> Vec<ManagedJavaRuntime> {
    tauri::async_runtime::spawn_blocking(managed_java_runtimes)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn remove_managed_java_runtime(
    state: tauri::State<'_, LauncherState>,
    major_version: u32,
) -> Result<(), String> {
    if *state
        .launch_active
        .lock()
        .map_err(|_| "The launcher is busy.")?
    {
        return Err("Close Minecraft and wait for current downloads before removing Java.".into());
    }
    let architecture = adoptium_architecture()?;
    let folder = managed_java_root()?.join(format!("temurin-{major_version}-{architecture}"));
    if folder.exists() {
        std::fs::remove_dir_all(folder)
            .map_err(|error| format!("Java {major_version} could not be removed: {error}"))?;
    }
    invalidate_java_installation_cache();
    Ok(())
}

fn adoptium_architecture() -> Result<&'static str, String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("x64"),
        "aarch64" => Ok("aarch64"),
        architecture => Err(format!(
            "Automatic Java installation is not available for architecture {architecture}."
        )),
    }
}

fn find_java_executable(folder: &std::path::Path) -> Option<std::path::PathBuf> {
    runtime_archive::find_java(folder, platform::JAVA_EXECUTABLE)
}

fn download_managed_java(
    app: &tauri::AppHandle,
    instance_id: &str,
    major: u32,
    cancel: &AtomicBool,
) -> Result<std::path::PathBuf, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};

    let architecture = adoptium_architecture()?;
    let root = managed_java_root()?;
    let destination = root.join(format!("temurin-{major}-{architecture}"));
    let manifest_path = destination.join("runtime.json");
    if let Ok(bytes) = std::fs::read(&manifest_path) {
        if let Ok(runtime) = serde_json::from_slice::<ManagedJavaRuntime>(&bytes) {
            let java = std::path::PathBuf::from(runtime.java_path);
            if java.is_file() {
                return Ok(java);
            }
        }
    }

    emit_download(
        app,
        instance_id,
        89,
        format!("Finding Java {major}"),
        0,
        0,
        0,
    );
    let client = reqwest::blocking::Client::builder()
        .user_agent("BloomClient/1.0 (https://delightproductions.org)")
        .build()
        .map_err(|error| error.to_string())?;
    let mut package = None;
    let provider_os = platform::JAVA_PROVIDER_OS;
    for image in ["jre", "jdk"] {
        let url = format!("https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={architecture}&heap_size=normal&image_type={image}&jvm_impl=hotspot&os={provider_os}&project=jdk&vendor=eclipse");
        let response = client.get(url).send()
            .map_err(|error| format!("Java provider could not be reached: {error}"))?;
        // Some supported OS/Java combinations ship only a JDK, not a standalone JRE.
        if response.status() == reqwest::StatusCode::NOT_FOUND { continue; }
        let assets: serde_json::Value = response.error_for_status()
            .map_err(|error| format!("Java provider rejected the request: {error}"))?
            .json()
            .map_err(|error| format!("Java provider returned invalid data: {error}"))?;
        package = assets
            .as_array()
            .and_then(|items| items.first())
            .and_then(|asset| asset.get("binary"))
            .and_then(|binary| binary.get("package"))
            .cloned();
        if package.is_some() {
            break;
        }
    }
    let package = package.ok_or_else(|| format!("No supported {provider_os} Java {major} runtime is currently available from Eclipse Adoptium."))?;
    let url = package["link"]
        .as_str()
        .ok_or("The Java provider response did not include a download link.")?;
    let expected = package["checksum"]
        .as_str()
        .ok_or("The Java provider response did not include a SHA-256 checksum.")?
        .to_ascii_lowercase();
    let total = package["size"].as_u64().unwrap_or(0);
    let extension = platform::JAVA_ARCHIVE_EXTENSION;
    let archive = root.join(format!("temurin-{major}-{architecture}.{extension}"));
    let partial = root.join(format!("temurin-{major}-{architecture}.{extension}.part"));
    let mut response = client
        .get(url)
        .send()
        .map_err(|error| format!("Java download failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Java download failed: {error}"))?;
    let total = response.content_length().unwrap_or(total);
    let mut output = std::fs::File::create(&partial).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut received = 0u64;
    let started = std::time::Instant::now();
    loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&partial);
            return Err("__cancelled__".into());
        }
        let count = response
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        hasher.update(&buffer[..count]);
        received += count as u64;
        let fraction = if total > 0 {
            received as f64 / total as f64
        } else {
            0.0
        };
        emit_download(
            app,
            instance_id,
            (89.0 + fraction * 5.0).round() as u8,
            format!("Downloading Java {major}"),
            received,
            total,
            (received as f64 / started.elapsed().as_secs_f64().max(0.1)) as u64,
        );
    }
    drop(output);
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected {
        let _ = std::fs::remove_file(&partial);
        return Err("The downloaded Java runtime failed its SHA-256 security check.".into());
    }
    if archive.exists() {
        std::fs::remove_file(&archive).map_err(|error| error.to_string())?;
    }
    std::fs::rename(&partial, &archive).map_err(|error| error.to_string())?;

    emit_download(
        app,
        instance_id,
        95,
        format!("Installing Java {major}"),
        received,
        total,
        0,
    );
    let staging = root.join(format!(".temurin-{major}-{architecture}-installing"));
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
    }
    std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    if let Err(error) = runtime_archive::extract(&archive, &staging, extension, cancel) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    let staged_java = find_java_executable(&staging)
        .ok_or("The installed Java package did not contain its Java executable.")?;
    let relative_java = staged_java
        .strip_prefix(&staging)
        .map_err(|error| error.to_string())?
        .to_path_buf();
    if destination.exists() {
        std::fs::remove_dir_all(&destination).map_err(|error| error.to_string())?;
    }
    std::fs::rename(&staging, &destination).map_err(|error| error.to_string())?;
    let java = destination.join(relative_java);
    let runtime = ManagedJavaRuntime {
        major_version: major,
        architecture: architecture.into(),
        provider: "Eclipse Temurin".into(),
        java_path: java.to_string_lossy().into_owned(),
    };
    std::fs::write(
        destination.join("runtime.json"),
        serde_json::to_vec_pretty(&runtime).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let _ = std::fs::remove_file(archive);
    invalidate_java_installation_cache();
    Ok(java)
}

// Reject retired instance formats rather than silently treating them as Java.
#[derive(Default, serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "lowercase")]
enum InstanceEngine {
    #[default]
    Java,
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstanceConfig {
    id: String,
    name: String,
    #[serde(default)]
    engine: InstanceEngine,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default = "default_loader")]
    loader: String,
    #[serde(default)]
    loader_version: Option<String>,
    version: String,
    directory: String,
    java: String,
    memory: u32,
    jvm_arguments: String,
    mods: bool,
    resource_packs: bool,
    shader_packs: bool,
    config: bool,
    custom_resolution: bool,
    visible: bool,
    shortcut: bool,
}

fn default_loader() -> String {
    "Vanilla".to_string()
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceContentItem {
    id: String,
    name: String,
    version: String,
    file_name: String,
    size: u64,
    enabled: bool,
    icon: Option<String>,
}

fn bloom_data_dir() -> Result<std::path::PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(override_path) = std::env::var_os("BLOOM_DEV_DATA_DIR") {
        let path = std::path::PathBuf::from(override_path);
        if !path.is_absolute() {
            return Err("BLOOM_DEV_DATA_DIR must be an absolute development-only path.".into());
        }
        std::fs::create_dir_all(path.join("instances")).map_err(|error| {
            format!("Could not create the isolated Delight development profile: {error}")
        })?;
        return Ok(path);
    }
    let path = platform::data_directory()?;
    std::fs::create_dir_all(path.join("instances")).map_err(|error| error.to_string())?;
    Ok(path)
}

fn patch_options(path: &std::path::Path, updates: &[(&str, String)]) -> Result<(), String> {
    let existing = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.to_string()),
    };
    let mut handled = std::collections::HashSet::new();
    let mut output = Vec::new();
    for line in existing.lines() {
        let Some((key, _)) = line.split_once(':') else {
            output.push(line.to_string());
            continue;
        };
        if let Some((_, value)) = updates.iter().find(|(candidate, _)| *candidate == key) {
            output.push(format!("{key}:{value}"));
            handled.insert(key.to_string());
        } else {
            output.push(line.to_string());
        }
    }
    for (key, value) in updates {
        if !handled.contains(*key) {
            output.push(format!("{key}:{value}"));
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(path, format!("{}\n", output.join("\n"))).map_err(|error| error.to_string())
}

fn java_major(path: &str) -> Option<u32> {
    let output = command_without_console(path)
        .arg("-version")
        .output()
        .ok()?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let quoted = text.split('"').nth(1)?;
    let first = quoted.split('.').next()?;
    if first == "1" {
        quoted.split('.').nth(1)?.parse().ok()
    } else {
        first.parse().ok()
    }
}

fn detect_java_installations_blocking() -> Vec<JavaInstallation> {
    if let Ok(cache) = java_installation_cache().lock() {
        if let Some((created_at, installations)) = cache.as_ref() {
            if created_at.elapsed() < std::time::Duration::from_secs(120) {
                return installations.clone();
            }
        }
    }
    let mut candidates: Vec<String> = Vec::new();
    let managed = managed_java_runtimes();
    let known_managed = managed
        .iter()
        .map(|runtime| (runtime.java_path.clone(), runtime.major_version))
        .collect::<std::collections::HashMap<_, _>>();
    candidates.extend(managed.into_iter().map(|runtime| runtime.java_path));
    candidates.extend(platform::discover_java());
    candidates.sort();
    candidates.dedup();
    let installations = candidates
        .into_iter()
        .map(|path| {
            let major_version = known_managed
                .get(&path)
                .copied()
                .or_else(|| java_major(&path));
            let usable = major_version.is_some() && platform::java_matches_host(std::path::Path::new(&path));
            JavaInstallation {
                path,
                usable,
                major_version,
            }
        })
        .collect::<Vec<_>>();
    if let Ok(mut cache) = java_installation_cache().lock() {
        *cache = Some((std::time::Instant::now(), installations.clone()));
    }
    installations
}

#[tauri::command]
async fn detect_java_installations() -> Vec<JavaInstallation> {
    tauri::async_runtime::spawn_blocking(detect_java_installations_blocking)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn get_minecraft_releases() -> Result<Vec<serde_json::Value>, String> {
    let manifest: serde_json::Value =
        bloom_http_client()?
            .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|_| "Could not load Minecraft releases. Check your connection and retry.")?
            .json()
            .await
            .map_err(|error| error.to_string())?;
    Ok(manifest["versions"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter(|version| version["type"] == "release")
        .cloned()
        .collect())
}

fn resolve_instance_target(
    directory: &str,
    instance_id: &str,
) -> Result<std::path::PathBuf, String> {
    let mut target = match platform::default_game_alias(directory)? {
        Some(path) => path,
        None => std::path::PathBuf::from(directory).join(instance_id),
    };
    if target
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("instances"))
        .unwrap_or(false)
    {
        target = target.join(instance_id);
    }
    Ok(target)
}

fn save_instance_with_id(config: InstanceConfig, pack_id: Option<String>) -> Result<InstanceConfig, String> {
    if config.name.trim().is_empty() {
        return Err("Choose an instance name first.".into());
    }
    let mut config = config;
    config.id = config
        .name
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if pack_id.is_none() && config.id.is_empty() {
        return Err("Choose an instance name containing letters or numbers.".into());
    }
    let creating_pack = pack_id.is_some();
    let target = if let Some(id) = pack_id {
        config.id = id;
        let root = bloom_data_dir()?.join("alula-packs");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let target = root.join(&config.id);
        if bloom_data_dir()?.join("instances").join(format!("{}.json", config.id)).exists() {
            return load_instance(&config.id).and_then(|saved| {
                if saved.directory == target.to_string_lossy() && saved.version == config.version && saved.loader == config.loader {
                    Ok(saved)
                } else { Err("This draft already belongs to another instance.".into()) }
            });
        }
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        target
    } else { resolve_instance_target(&config.directory, &config.id)? };
    std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    for (enabled, folder) in [
        (
            config.mods || config.loader.eq_ignore_ascii_case("fabric"),
            "mods",
        ),
        (config.resource_packs, "resourcepacks"),
        (config.shader_packs, "shaderpacks"),
        (config.config, "config"),
    ] {
        if enabled {
            std::fs::create_dir_all(target.join(folder)).map_err(|error| error.to_string())?;
        }
    }
    config.directory = target.to_string_lossy().to_string();
    if !creating_pack { utilities::apply_active_setup_to_instance(&config)?; }
    let path = bloom_data_dir()?
        .join("instances")
        .join(format!("{}.json", config.id));
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(config)
}

#[tauri::command]
async fn create_alula_instance(config: InstanceConfig, pack_draft: uuid::Uuid) -> Result<InstanceConfig, String> {
    static PACK_CREATE: Mutex<()> = Mutex::new(());
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = PACK_CREATE.lock().map_err(|_| "Instance creation is busy.")?;
        save_instance_with_id(config, Some(format!("alula-{pack_draft}")))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_instance(config: InstanceConfig) -> Result<InstanceConfig, String> {
    tauri::async_runtime::spawn_blocking(move || save_instance_with_id(config, None))
        .await
        .map_err(|error| format!("The instance creator stopped unexpectedly: {error}"))?
}

fn list_instances_blocking() -> Result<Vec<InstanceConfig>, String> {
    let folder = bloom_data_dir()?.join("instances");
    let mut entries = std::fs::read_dir(folder)
        .map_err(|error| error.to_string())?
        .flatten()
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        std::cmp::Reverse(
            entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok(),
        )
    });
    let mut instances = Vec::new();
    for entry in entries {
        if entry
            .path()
            .extension()
            .and_then(|extension| extension.to_str())
            == Some("json")
        {
            if let Ok(bytes) = std::fs::read(entry.path()) {
                if let Ok(instance) = serde_json::from_slice::<InstanceConfig>(&bytes) {
                    if instance.visible {
                        instances.push(instance);
                    }
                }
            }
        }
    }
    Ok(instances)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryInstance {
    #[serde(flatten)]
    config: InstanceConfig,
    last_game_log_ms: Option<u64>,
}

#[tauri::command]
async fn list_instances() -> Result<Vec<LibraryInstance>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(list_instances_blocking()?.into_iter().map(|config| {
            let last_game_log_ms = std::fs::metadata(std::path::Path::new(&config.directory).join("logs/latest.log"))
                .and_then(|metadata| metadata.modified()).ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|elapsed| elapsed.as_millis() as u64);
            LibraryInstance { config, last_game_log_ms }
        }).collect())
    })
    .await
    .map_err(|error| format!("The instance library reader stopped unexpectedly: {error}"))?
}

fn copy_instance_directory(source: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in std::fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err("Delight refused to duplicate an instance containing a symbolic link.".into());
        }
        let destination = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_instance_directory(&entry.path(), &destination)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), destination).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn duplicate_instance_blocking(instance_id: String) -> Result<InstanceConfig, String> {
    let _edit = workspace_install::updates::edit_lease(&instance_id)?;
    if instance_id.is_empty()
        || !instance_id.chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Delight refused to duplicate an invalid instance identifier.".into());
    }
    let source_config = load_instance(&instance_id)?;
    let source = std::path::PathBuf::from(&source_config.directory);
    let source_name = source.file_name().and_then(|name| name.to_str()).ok_or("Delight could not verify this instance folder.")?;
    if !source_name.eq_ignore_ascii_case(&instance_id) || !source.is_dir() {
        return Err("Delight refused to duplicate an unsafe or missing instance folder.".into());
    }
    if source_config.loader.eq_ignore_ascii_case("fabric") {
        mod_duplicates::verify_staged_mods(&source.join("mods"))?;
    }
    let parent = source.parent().ok_or("Delight could not find the instance parent folder.")?;
    let records = bloom_data_dir()?.join("instances");
    let mut suffix = 1u32;
    let (name, id, target) = loop {
        let name = if suffix == 1 { format!("{} Copy", source_config.name) } else { format!("{} Copy {suffix}", source_config.name) };
        let id = name.to_lowercase().chars().map(|character| if character.is_ascii_alphanumeric() { character } else { '-' }).collect::<String>().trim_matches('-').to_string();
        let target = parent.join(&id);
        if !target.exists() && !records.join(format!("{id}.json")).exists() { break (name, id, target); }
        suffix = suffix.checked_add(1).ok_or("Delight could not choose a unique duplicate name.")?;
    };
    if let Err(error) = copy_instance_directory(&source, &target) {
        let _ = std::fs::remove_dir_all(&target);
        return Err(format!("Delight could not duplicate the instance files: {error}"));
    }
    let mut duplicate = source_config;
    duplicate.id = id.clone();
    duplicate.name = name;
    duplicate.directory = target.to_string_lossy().to_string();
    let record = records.join(format!("{id}.json"));
    if let Err(error) = serde_json::to_vec_pretty(&duplicate)
        .map_err(|error| error.to_string())
        .and_then(|bytes| std::fs::write(&record, bytes).map_err(|error| error.to_string()))
    {
        let _ = std::fs::remove_dir_all(&target);
        return Err(format!("The files were copied, but Delight could not save the duplicate: {error}"));
    }
    Ok(duplicate)
}

#[tauri::command]
async fn duplicate_instance(instance_id: String) -> Result<InstanceConfig, String> {
    tauri::async_runtime::spawn_blocking(move || duplicate_instance_blocking(instance_id))
        .await
        .map_err(|error| format!("The instance duplication task stopped unexpectedly: {error}"))?
}

fn delete_instance_blocking(instance_id: String) -> Result<(), String> {
    let _edit = workspace_install::updates::edit_lease(&instance_id)?;
    if instance_id.is_empty()
        || !instance_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Delight refused to delete an invalid instance identifier.".into());
    }
    let config = load_instance(&instance_id)?;
    let target = std::path::PathBuf::from(&config.directory);
    let target_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Delight could not verify this instance folder.")?;
    if !target_name.eq_ignore_ascii_case(&instance_id) {
        return Err("Delight refused to delete this folder because it does not match the instance identifier.".into());
    }
    if target.exists() {
        let metadata = std::fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("Delight refused to recursively delete an unsafe instance path.".into());
        }
        std::fs::remove_dir_all(&target)
            .map_err(|error| format!("Delight could not delete the instance files: {error}"))?;
    }
    let record = bloom_data_dir()?
        .join("instances")
        .join(format!("{instance_id}.json"));
    if record.exists() {
        std::fs::remove_file(record)
            .map_err(|error| format!("The instance files were deleted, but Delight could not remove its library record: {error}"))?;
    }
    for category in ["mods", "resourcepacks", "shaderpacks"] {
        for sharing in [false, true] {
            cache::forget_json(INSTANCE_CONTENT_CACHE, &instance_content_key(&instance_id, category, sharing));
        }
    }
    Ok(())
}

#[tauri::command]
async fn delete_instance(instance_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_instance_blocking(instance_id))
        .await
        .map_err(|error| format!("The instance deletion task stopped unexpectedly: {error}"))?
}

fn load_instance(instance_id: &str) -> Result<InstanceConfig, String> {
    let path = bloom_data_dir()?
        .join("instances")
        .join(format!("{instance_id}.json"));
    let bytes = std::fs::read(path).map_err(|_| {
        "This instance could not be found. Create it again and try once more.".to_string()
    })?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "This instance configuration is invalid.".to_string())
}

fn write_instance(config: &InstanceConfig) -> Result<(), String> {
    let path = bloom_data_dir()?
        .join("instances")
        .join(format!("{}.json", config.id));
    std::fs::write(
        path,
        serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn content_folder_path(config: &InstanceConfig, category: &str) -> Result<std::path::PathBuf, String> {
    content_import_details(category)?;
    Ok(std::path::Path::new(&config.directory).join(category))
}

fn content_folder(config: &InstanceConfig, category: &str) -> Result<std::path::PathBuf, String> {
    let path = content_folder_path(config, category)?;
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn readable_instance_root(config: &InstanceConfig, for_sharing: bool) -> Result<&std::path::Path, String> {
    let root = std::path::Path::new(&config.directory);
    let metadata = if for_sharing { std::fs::symlink_metadata(root) } else { std::fs::metadata(root) }
        .map_err(|_| "The instance directory is unavailable. Check its location and try again.")?;
    if !metadata.is_dir() || (for_sharing && instance_actions::linked(&metadata)) {
        return Err("Choose the original local instance directory to check its contents.".into());
    }
    Ok(root)
}

// A read must never recreate an instance that moved or was disconnected.
fn existing_content_folder(config: &InstanceConfig, category: &str, for_sharing: bool) -> Result<Option<std::path::PathBuf>, String> {
    readable_instance_root(config, for_sharing)?;
    let path = content_folder_path(config, category)?;
    let metadata = if for_sharing { std::fs::symlink_metadata(&path) } else { std::fs::metadata(&path) };
    match metadata {
        // Compatibility reports the linked category itself without listing or fingerprinting its target.
        Ok(meta) if for_sharing && instance_actions::linked(&meta) => Ok(None),
        Ok(meta) if meta.is_dir() => Ok(Some(path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => Err(format!("Could not read the {category} directory. Check its location and permissions.")),
    }
}

fn is_content_metadata(category: &str, file_name: &str) -> bool {
    file_name.starts_with('.') || file_name.ends_with(".bloom-part")
        || (category == "shaderpacks" && file_name.to_ascii_lowercase().ends_with(".zip.txt"))
}

fn archive_icon(archive: &mut zip::ZipArchive<std::fs::File>, icon_path: &str) -> Option<String> {
    use base64::Engine;
    use std::io::Read;
    let mut icon = archive.by_name(icon_path).ok()?;
    if icon.size() > 2_500_000 {
        return None;
    }
    let mut bytes = Vec::new();
    icon.read_to_end(&mut bytes).ok()?;
    let mime = if icon_path.to_ascii_lowercase().ends_with(".jpg")
        || icon_path.to_ascii_lowercase().ends_with(".jpeg")
    {
        "image/jpeg"
    } else {
        "image/png"
    };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

const INSTANCE_CONTENT_CACHE: &str = "instance-content-list";

#[derive(serde::Serialize, serde::Deserialize)]
struct CachedInstanceContent {
    directory: String,
    files: std::collections::BTreeMap<String, CachedInstanceFile>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct CachedInstanceFile {
    modified: std::time::SystemTime,
    created: Option<std::time::SystemTime>,
    item: InstanceContentItem,
}

fn instance_content_key(id: &str, category: &str, for_sharing: bool) -> String {
    format!("{id}\n{category}\n{for_sharing}")
}

fn sort_instance_content(items: &mut [InstanceContentItem]) {
    items.sort_by_cached_key(|item| (item.name.to_ascii_lowercase(), item.file_name.to_ascii_lowercase()));
}

#[tauri::command]
async fn get_cached_instance_content(
    instance_id: String,
    category: String,
) -> Result<Option<Vec<InstanceContentItem>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        content_import_details(&category)?;
        instance_actions::validate_id(&instance_id)?;
        let config = load_instance(&instance_id)?;
        let key = instance_content_key(&instance_id, &category, false);
        Ok(cache::read_json::<CachedInstanceContent>(INSTANCE_CONTENT_CACHE, &key, None)
            .filter(|snapshot| snapshot.directory == config.directory)
            .map(|snapshot| {
                let mut items: Vec<_> = snapshot.files.into_values().map(|file| file.item).collect();
                sort_instance_content(&mut items);
                items
            }))
    })
    .await
    .map_err(|_| "The cached instance content could not be read.")?
}

fn list_instance_content_blocking(
    instance_id: String,
    category: String,
    for_sharing: bool,
) -> Result<Vec<InstanceContentItem>, String> {
    use std::io::Read;
    instance_actions::validate_id(&instance_id)?;
    let config = load_instance(&instance_id)?;
    let key = instance_content_key(&instance_id, &category, for_sharing);
    let Some(folder) = existing_content_folder(&config, &category, for_sharing)? else {
        cache::forget_json(INSTANCE_CONTENT_CACHE, &key);
        return Ok(Vec::new());
    };
    let mut previous = cache::read_json::<CachedInstanceContent>(INSTANCE_CONTENT_CACHE, &key, None)
        .filter(|snapshot| snapshot.directory == config.directory)
        .map(|snapshot| snapshot.files)
        .unwrap_or_default();
    let mut snapshot = CachedInstanceContent { directory: config.directory, files: Default::default() };
    let mut cache_changed = false;
    let mut items = Vec::new();
    for entry in std::fs::read_dir(folder)
        .map_err(|error| error.to_string())?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if is_content_metadata(&category, &file_name) {
            continue;
        }
        let metadata = match if for_sharing { std::fs::symlink_metadata(&path) } else { std::fs::metadata(&path) } {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if !metadata.is_file() || (for_sharing && instance_actions::linked(&metadata)) { continue; }
        let enabled = !file_name.to_ascii_lowercase().ends_with(".disabled");
        let visible_name = file_name.strip_suffix(".disabled").unwrap_or(&file_name);
        let file_size = metadata.len();
        let modified = metadata.modified().ok();
        let created = metadata.created().ok();
        let previous_file = previous.remove(&file_name);
        let first_snapshot = previous_file.is_none();
        if let Some(cached) = previous_file
            .filter(|cached| Some(cached.modified) == modified && cached.created == created && cached.item.size == file_size)
        {
            items.push(cached.item.clone());
            snapshot.files.insert(file_name, cached);
            continue;
        }
        let legacy_modified = modified
            .and_then(|value| value.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
            .map(|value| value.as_millis())
            .unwrap_or_default();
        let cache_key = format!(
            "{}\n{file_size}\n{legacy_modified}\n{enabled}",
            path.to_string_lossy()
        );
        if let Some(cached) = (first_snapshot && modified.is_some())
            .then(|| cache::read_json::<InstanceContentItem>("instance-content", &cache_key, None))
            .flatten()
        {
            items.push(cached.clone());
            if let Some(modified) = modified {
                snapshot.files.insert(file_name, CachedInstanceFile { modified, created, item: cached });
            }
            cache_changed = true;
            continue;
        }
        let mut name = visible_name
            .rsplit_once('.')
            .map(|(stem, _)| stem)
            .unwrap_or(visible_name)
            .to_string();
        let mut version = String::new();
        let mut icon = None;
        if let Ok(file) = std::fs::File::open(&path) {
            if let Ok(mut archive) = zip::ZipArchive::new(file) {
                if category == "mods" {
                    let metadata = {
                        let mut text = String::new();
                        archive
                            .by_name("fabric.mod.json")
                            .ok()
                            .and_then(|file| file.take(256 * 1024 + 1).read_to_string(&mut text).ok())
                            .and_then(|_| serde_json::from_str::<serde_json::Value>(&text).ok())
                    };
                    if let Some(metadata) = metadata {
                        name = metadata["name"].as_str().unwrap_or(&name).to_string();
                        version = metadata["version"].as_str().unwrap_or_default().to_string();
                        let icon_path =
                            metadata["icon"].as_str().map(str::to_string).or_else(|| {
                                metadata["icon"].as_object().and_then(|icons| {
                                    icons
                                        .iter()
                                        .max_by_key(|(size, _)| size.parse::<u32>().unwrap_or(0))
                                        .and_then(|(_, value)| value.as_str())
                                        .map(str::to_string)
                                })
                            });
                        if let Some(icon_path) = icon_path {
                            icon = archive_icon(&mut archive, &icon_path);
                        }
                    }
                } else {
                    icon = archive_icon(&mut archive, "pack.png");
                }
            }
        }
        let item = InstanceContentItem {
            id: file_name.clone(),
            name,
            version,
            file_name: file_name.clone(),
            size: file_size,
            enabled,
            icon,
        };
        if let Some(modified) = modified {
            snapshot.files.insert(file_name, CachedInstanceFile { modified, created, item: item.clone() });
        }
        cache_changed = true;
        items.push(item);
    }
    if snapshot.files.is_empty() {
        cache::forget_json(INSTANCE_CONTENT_CACHE, &key);
    } else if cache_changed || !previous.is_empty() {
        let _ = cache::write_json(INSTANCE_CONTENT_CACHE, &key, &snapshot);
    }
    sort_instance_content(&mut items);
    Ok(items)
}

#[tauri::command]
async fn list_instance_content(
    instance_id: String,
    category: String,
    for_sharing: Option<bool>,
) -> Result<Vec<InstanceContentItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_instance_content_blocking(instance_id, category, for_sharing.unwrap_or(false))
    })
    .await
    .map_err(|error| format!("The instance content reader stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn toggle_instance_content(
    instance_id: String,
    category: String,
    file_name: String,
    enabled: bool,
    state: tauri::State<'_, LauncherState>,
) -> Result<(), String> {
    if std::path::Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        != Some(file_name.as_str())
    {
        return Err("Invalid content filename.".into());
    }
    if category == "mods" {
        return run_mod_edit(&state, move || {
            let config = load_instance(&instance_id)?;
            let pins = workspace_install::updates::mod_maintenance_pins(&instance_id)?;
            if pins.iter().any(|pin| {
                pin.file_name.trim_end_matches(".disabled").eq_ignore_ascii_case(file_name.trim_end_matches(".disabled"))
            }) {
                return Err("This mod is managed by the shared pack. Open Releases to repair its files.".into());
            }
            if cosmetics::is_managed_file(&file_name)
                && cosmetics::set_file_enabled(&config, &file_name, enabled)?
            {
                return Ok(());
            }
            if enabled && file_name.to_ascii_lowercase().ends_with(".jar.disabled") {
                let mods = existing_content_folder(&config, "mods", true)?
                    .ok_or("The mods folder is unavailable.")?;
                pack_compatibility::dependencies::catalog::install_local(
                    &config, vec![mods.join(&file_name)], Some(file_name),
                )?;
                return Ok(());
            }
            toggle_local_file(&config, &category, &file_name, enabled)
        }).await;
    }
    toggle_local_file(&load_instance(&instance_id)?, &category, &file_name, enabled)
}

fn toggle_local_file(
    config: &InstanceConfig,
    category: &str,
    file_name: &str,
    enabled: bool,
) -> Result<(), String> {
    let _edit = workspace_install::updates::edit_lease(&config.id)?;
    let folder = content_folder(config, category)?;
    let source = folder.join(&file_name);
    if !source.exists() {
        return Err("That file no longer exists.".into());
    }
    let target_name = if enabled {
        file_name
            .strip_suffix(".disabled")
            .unwrap_or(&file_name)
            .to_string()
    } else if file_name.ends_with(".disabled") {
        file_name.to_owned()
    } else {
        format!("{file_name}.disabled")
    };
    if target_name != file_name {
        let destination = folder.join(target_name);
        if std::fs::symlink_metadata(&destination).is_ok() {
            return Err("A file already uses that name.".into());
        }
        std::fs::rename(source, destination).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn delete_instance_content(
    instance_id: String,
    category: String,
    file_name: String,
) -> Result<(), String> {
    let _edit = workspace_install::updates::edit_lease(&instance_id)?;
    if std::path::Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        != Some(file_name.as_str())
    {
        return Err("Invalid content filename.".into());
    }
    let folder = content_folder(&load_instance(&instance_id)?, &category)?;
    let target = folder.join(&file_name);
    if !target.is_file() {
        return Err("That file no longer exists.".into());
    }
    std::fs::remove_file(target).map_err(|error| error.to_string())
}

fn set_instance_icon_blocking(instance_id: String, icon: String) -> Result<InstanceConfig, String> {
    let _edit = workspace_install::updates::edit_lease(&instance_id)?;
    if !icon.starts_with("data:image/") || icon.len() > 4_000_000 {
        return Err("Choose a PNG or JPEG image smaller than about 3 MB.".into());
    }
    let mut config = load_instance(&instance_id)?;
    config.icon = Some(icon);
    write_instance(&config)?;
    Ok(config)
}

#[tauri::command]
async fn set_instance_icon(instance_id: String, icon: String) -> Result<InstanceConfig, String> {
    tauri::async_runtime::spawn_blocking(move || set_instance_icon_blocking(instance_id, icon))
        .await
        .map_err(|error| format!("The instance icon writer stopped unexpectedly: {error}"))?
}

#[tauri::command]
async fn update_instance_settings(
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
    name: String,
    memory: u32,
    jvm_arguments: String,
    loader_version: Option<String>,
) -> Result<InstanceConfig, String> {
    if name.trim().is_empty() {
        return Err("Instance name cannot be empty.".into());
    }
    if !(1024..=16384).contains(&memory) {
        return Err("Memory must be between 1024 MB and 16384 MB.".into());
    }
    let expected = load_instance(&instance_id)?;
    let change = fabric_loader::requested_change(&expected, loader_version.as_deref())?;
    if let Some(version) = &change {
        if state.game_running.load(Ordering::SeqCst) || state.content_install_active.load(Ordering::SeqCst)
            || *state.launch_active.lock().map_err(|error| error.to_string())? {
            return Err("Close Minecraft and wait for active downloads before changing Fabric Loader.".into());
        }
        fabric_loader::check_available(version, &fabric_loader::available(&expected.version).await?)?;
    }
    // Re-read after metadata resolves; keep artwork and other independently edited fields.
    // Holding the launch gate through the write prevents a launch starting with a half-applied change.
    let _edit = workspace_install::updates::edit_lease(&instance_id)?;
    let launch_guard = state.launch_active.lock().map_err(|error| error.to_string())?;
    let mut config = load_instance(&instance_id)?;
    if let Some(version) = change {
        fabric_loader::apply_change(&mut config, &expected, version, *launch_guard
            || state.game_running.load(Ordering::SeqCst) || state.content_install_active.load(Ordering::SeqCst))?;
    }
    config.name = name.trim().to_string();
    config.memory = memory;
    config.jvm_arguments = jvm_arguments;
    write_instance(&config)?;
    Ok(config)
}

#[tauri::command]
fn open_instance_folder(instance_id: String, category: Option<String>) -> Result<(), String> {
    let config = load_instance(&instance_id)?;
    let target = if let Some(category) = category {
        content_folder(&config, &category)?
    } else {
        std::path::PathBuf::from(config.directory)
    };
    std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    let target = target
        .canonicalize()
        .map_err(|error| format!("Delight could not resolve this instance folder: {error}"))?;

    tauri_plugin_opener::open_path(&target, None::<&str>)
        .map_err(|error| format!("Delight could not open this instance folder: {error}"))
}

fn content_import_details(category: &str) -> Result<(&'static str, &'static str), String> {
    match category {
        "mods" => Ok(("jar", "mod")),
        "resourcepacks" => Ok(("zip", "resource pack")),
        "shaderpacks" => Ok(("zip", "shader")),
        _ => Err("Unsupported instance content category.".into()),
    }
}

fn import_instance_content_files_blocking(
    instance_id: String,
    category: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let (extension, item_label) = content_import_details(&category)?;
    if paths.is_empty() {
        return Err(format!("Drop one or more {item_label} files."));
    }
    let config = load_instance(&instance_id)?;
    if category == "mods" && !config.loader.eq_ignore_ascii_case("fabric") {
        return Err(
            "Drag-and-drop mod installation currently supports Fabric instances only.".into(),
        );
    }
    let target_folder = content_folder(&config, &category)?;
    std::fs::create_dir_all(&target_folder).map_err(|error| error.to_string())?;
    let mut imported = Vec::new();
    for raw in paths {
        let source = std::path::PathBuf::from(raw);
        if !source.is_file()
            || !source
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case(extension))
                .unwrap_or(false)
        {
            return Err(format!(
                "Only .{extension} files can be dropped into {}.",
                match category.as_str() {
                    "mods" => "Mods",
                    "resourcepacks" => "Resource Packs",
                    _ => "Shaders",
                }
            ));
        }
        let file = std::fs::File::open(&source)
            .map_err(|error| format!("Could not read {}: {error}", source.display()))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|_| format!("{} is not a valid archive.", source.display()))?;
        if category == "mods" && archive.by_name("fabric.mod.json").is_err() {
            return Err(format!(
                "{} is not a Fabric mod.",
                source
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("That file")
            ));
        }
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("A dropped {item_label} has an invalid filename."))?
            .to_string();
        let destination = target_folder.join(&name);
        if source.canonicalize().ok() != destination.canonicalize().ok() {
            let temporary = target_folder.join(format!(".{name}.bloom-import"));
            std::fs::copy(&source, &temporary)
                .map_err(|error| format!("Could not import {name}: {error}"))?;
            if destination.exists() {
                std::fs::remove_file(&destination)
                    .map_err(|error| format!("Could not replace {name}: {error}"))?;
            }
            std::fs::rename(&temporary, &destination)
                .map_err(|error| format!("Could not finish importing {name}: {error}"))?;
        }
        imported.push(name);
    }
    Ok(imported)
}

struct LauncherActivityReservation(Arc<Mutex<bool>>);

impl Drop for LauncherActivityReservation {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0.lock() {
            *active = false;
        }
    }
}

impl tauri::Resource for LauncherActivityReservation {}

fn reserve_update_activity(state: &LauncherState) -> Result<LauncherActivityReservation, String> {
    let mut active = state.launch_active.lock().map_err(|_| "The launcher is busy.")?;
    if state.game_running.load(Ordering::SeqCst) {
        return Err("Close Minecraft before updating Delight.".into());
    }
    if *active || state.content_install_active.load(Ordering::SeqCst) {
        return Err("Wait for the active launcher task to finish.".into());
    }
    *active = true;
    Ok(LauncherActivityReservation(state.launch_active.clone()))
}

#[tauri::command]
fn reserve_launcher_update(
    webview: tauri::Webview,
    state: tauri::State<'_, LauncherState>,
) -> Result<tauri::ResourceId, String> {
    let reservation = reserve_update_activity(&state)?;
    Ok(webview.resources_table().add(reservation))
}

async fn run_mod_edit<T: Send + 'static>(
    state: &LauncherState,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    {
        let mut active = state.launch_active.lock().map_err(|_| "The launcher is busy.")?;
        validate_content_install_activity("mods", *active, state.game_running.load(Ordering::SeqCst))?;
        *active = true;
    }
    let activity = LauncherActivityReservation(state.launch_active.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let _activity = activity;
        operation()
    })
    .await
    .map_err(|_| "The mod operation stopped unexpectedly. Review Mods and try again.")?
}

#[tauri::command]
async fn import_instance_mod_files(
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
    paths: Vec<String>,
    replace_existing: Option<bool>,
) -> Result<Vec<String>, String> {
    if replace_existing == Some(true) {
        let [path]: [String; 1] = paths.try_into().map_err(|_| "Choose one replacement file.")?;
        return run_mod_edit(&state, move || {
            let config = load_instance(&instance_id)?;
            pack_compatibility::dependencies::maintenance::restore_before_play(&config)?;
            pack_compatibility::dependencies::catalog::replace_local(&config, path.into())
        }).await;
    }
    import_instance_content_files(state, instance_id, "mods".into(), paths).await
}

#[tauri::command]
async fn import_instance_content_files(
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
    category: String,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    if category == "mods" {
        if paths.is_empty() {
            return Err("Drop one or more Fabric mod files.".into());
        }
        return run_mod_edit(&state, move || {
            let config = load_instance(&instance_id)?;
            if !config.loader.eq_ignore_ascii_case("fabric") {
                return Err("Drag-and-drop mod installation currently supports Fabric instances only.".into());
            }
            pack_compatibility::dependencies::catalog::install_local(
                &config, paths.into_iter().map(std::path::PathBuf::from).collect(), None,
            )
        }).await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        import_instance_content_files_blocking(instance_id, category, paths)
    })
    .await
    .map_err(|error| format!("The content importer stopped unexpectedly: {error}"))?
}

#[tauri::command]
fn open_game_folder() -> Result<(), String> {
    let target = bloom_data_dir()?.join("minecraft");
    std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    platform::open_folder(&target)
}

fn safe_pack_path(raw: &str) -> Result<std::path::PathBuf, String> {
    use std::path::Component;
    // Modpacks move between operating systems. Interpret both separator styles
    // and reject Windows drive/stream syntax even when running on Unix.
    let normalized = raw.replace('\\', "/");
    let path = std::path::Path::new(&normalized);
    if raw.contains(':') || raw.chars().any(char::is_control) || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!("The modpack contains an unsafe path: {raw}"));
    }
    Ok(path.to_path_buf())
}

fn allowed_pack_download(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .map(|host| {
            matches!(
                host.as_str(),
                "cdn.modrinth.com" | "github.com" | "raw.githubusercontent.com" | "gitlab.com"
            )
        })
        .unwrap_or(false)
}

fn extract_pack_overrides(
    pack_path: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    use std::io::copy;
    let file = std::fs::File::open(pack_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "The selected file is not a valid Modrinth pack ZIP.".to_string())?;
    for root in ["overrides/", "client-overrides/"] {
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
            let name = entry.name().replace('\\', "/");
            let Some(relative) = name.strip_prefix(root) else {
                continue;
            };
            if relative.is_empty() {
                continue;
            }
            let relative = safe_pack_path(relative)?;
            let target = destination.join(relative);
            if entry.is_dir() {
                std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
                continue;
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut output = std::fs::File::create(target).map_err(|error| error.to_string())?;
            copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn import_fabric_modpack_path(
    app: tauri::AppHandle,
    state: &LauncherState,
    pack_path: std::path::PathBuf,
) -> Result<String, String> {
    import_fabric_modpack_path_with_icon(app, state, pack_path, None)
}

fn read_fabric_pack_index(pack_path: &std::path::Path) -> Result<(serde_json::Value, String, String, String), String> {
    use std::io::Read;
    let file = std::fs::File::open(pack_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "Choose a valid .mrpack or ZIP containing modrinth.index.json.".to_string())?;
    let mut index_text = String::new();
    archive.by_name("modrinth.index.json").map_err(|_| "This ZIP is not a Modrinth modpack. Delight currently imports Fabric Modrinth packs only.".to_string())?.read_to_string(&mut index_text).map_err(|error| error.to_string())?;
    let index: serde_json::Value = serde_json::from_str(&index_text)
        .map_err(|_| "The modrinth.index.json file is invalid.".to_string())?;
    if index["game"] != "minecraft" {
        return Err("Delight only imports Minecraft modpacks.".into());
    }
    let dependencies = index["dependencies"]
        .as_object()
        .ok_or("The pack does not declare Minecraft dependencies.")?;
    let minecraft_version = dependencies
        .get("minecraft")
        .and_then(|value| value.as_str())
        .ok_or("The pack does not declare a Minecraft version.")?
        .to_string();
    let fabric_version = dependencies
        .get("fabric-loader")
        .and_then(|value| value.as_str())
        .ok_or("Only Fabric modpacks can be imported right now.")?
        .to_string();
    if dependencies.contains_key("forge")
        || dependencies.contains_key("neoforge")
        || dependencies.contains_key("quilt-loader")
    {
        return Err("Only Fabric modpacks can be imported right now.".into());
    }
    let name = index["name"]
        .as_str()
        .unwrap_or("Imported Fabric Pack")
        .trim();
    let name = if name.is_empty() {
        "Imported Fabric Pack".to_string()
    } else {
        name.to_string()
    };
    Ok((index, name, minecraft_version, fabric_version))
}

fn import_fabric_modpack_path_with_icon(
    app: tauri::AppHandle,
    state: &LauncherState,
    pack_path: std::path::PathBuf,
    icon: Option<String>,
) -> Result<String, String> {
    let (index, name, minecraft_version, fabric_version) = read_fabric_pack_index(&pack_path)?;
    let base_id = name
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let base_id = if base_id.is_empty() {
        "imported-fabric-pack".to_string()
    } else {
        base_id
    };
    let instances_folder = bloom_data_dir()?.join("instances");
    let mut id = base_id.clone();
    let mut suffix = 2;
    while instances_folder.join(format!("{id}.json")).exists() {
        id = format!("{base_id}-{suffix}");
        suffix += 1;
    }
    let game_directory =
        platform::game_directory()?
            .join("instances")
            .join(&id);
    let config = InstanceConfig {
        id: id.clone(),
        name,
        engine: InstanceEngine::Java,
        icon,
        loader: "Fabric".into(),
        loader_version: Some(fabric_version),
        version: minecraft_version,
        directory: game_directory.to_string_lossy().to_string(),
        java: "Automatic (Recommended)".into(),
        memory: 4096,
        jvm_arguments: String::new(),
        mods: true,
        resource_packs: true,
        shader_packs: true,
        config: true,
        custom_resolution: false,
        visible: true,
        shortcut: false,
    };
    let mut plan = mc_launcher_core::net::download::DownloadPlan::default();
    for file in index["files"]
        .as_array()
        .ok_or("The pack does not contain a files list.")?
    {
        if file["env"]["client"] == "unsupported" {
            continue;
        }
        let relative = safe_pack_path(
            file["path"]
                .as_str()
                .ok_or("A pack file is missing its path.")?,
        )?;
        let url = file["downloads"]
            .as_array()
            .and_then(|urls| {
                urls.iter()
                    .filter_map(|url| url.as_str())
                    .find(|url| allowed_pack_download(url))
            })
            .ok_or("A pack file has no allowed download URL.")?;
        let checksum = file["hashes"]["sha1"]
            .as_str()
            .map(|hash| mc_launcher_core::net::download::Checksum::Sha1(hash.to_string()));
        plan.tasks
            .push(mc_launcher_core::net::download::DownloadTask {
                url: url.to_string(),
                destination: game_directory.join(relative),
                checksum,
                label: "Downloading modpack files".into(),
            });
    }
    {
        let mut active = state
            .launch_active
            .lock()
            .map_err(|_| "The task manager is busy.")?;
        if *active {
            return Err("Another download or game launch is already active.".into());
        }
        *active = true;
    }
    if let Err(error) = std::fs::create_dir_all(&game_directory) {
        if let Ok(mut active) = state.launch_active.lock() {
            *active = false;
        }
        return Err(error.to_string());
    }
    if let Err(error) = write_instance(&config) {
        if let Ok(mut active) = state.launch_active.lock() {
            *active = false;
        }
        return Err(error);
    }
    state.cancel_requested.store(false, Ordering::SeqCst);
    let active = state.launch_active.clone();
    let cancel = state.cancel_requested.clone();
    let app_for_task = app.clone();
    let id_for_task = id.clone();
    std::thread::spawn(move || {
        emit_launch(
            &app_for_task,
            &id_for_task,
            "installing",
            1,
            "Preparing Fabric modpack",
        );
        let result = (|| -> Result<Option<String>, String> {
            execute_download_plan(
                &app_for_task,
                &id_for_task,
                &plan,
                &cancel,
                2,
                58,
                "Downloading modpack files",
                false,
            )?;
            emit_launch(
                &app_for_task,
                &id_for_task,
                "installing",
                60,
                "Applying modpack overrides",
            );
            extract_pack_overrides(&pack_path, &game_directory)?;
            let duplicate_issue = mod_duplicates::before_play(&app_for_task, &config).err();
            emit_launch(&app_for_task, &id_for_task, "installing", 61, "Checking required mod dependencies");
            let dependency_issue = pack_compatibility::dependencies::catalog::complete_pack_import(&config, &cancel).err();
            if cancel.load(Ordering::SeqCst) {
                return Err("__cancelled__".into());
            }
            let shared = bloom_data_dir()?.join("minecraft");
            install_instance_files(
                &app_for_task,
                &id_for_task,
                &config,
                &shared,
                &cancel,
                63,
                99,
            )?;
            Ok(duplicate_issue.or(dependency_issue))
        })();
        match result {
            Ok(dependency_issue) => emit_launch(
                &app_for_task,
                &id_for_task,
                "complete",
                100,
                &dependency_issue.map_or_else(
                    || "Fabric modpack imported".to_string(),
                    |issue| format!("Modpack imported. {issue}"),
                ),
            ),
            Err(error) if error == "__cancelled__" => emit_launch(
                &app_for_task,
                &id_for_task,
                "cancelled",
                0,
                "Import cancelled",
            ),
            Err(error) => emit_launch(
                &app_for_task,
                &id_for_task,
                "error",
                0,
                format!("Modpack import failed: {error}"),
            ),
        }
        if let Ok(mut value) = active.lock() {
            *value = false;
        }
    });
    Ok(id)
}

fn pick_fabric_pack() -> Option<std::path::PathBuf> {
    rfd::FileDialog::new()
        .add_filter("Fabric Modrinth pack", &["mrpack", "zip"])
        .pick_file()
}

#[tauri::command]
async fn choose_fabric_modpack_file() -> Result<Option<serde_json::Value>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = pick_fabric_pack() else { return Ok(None) };
        let (_, name, minecraft, fabric) = read_fabric_pack_index(&path)?;
        Ok(Some(serde_json::json!({
            "path": path,
            "name": name,
            "minecraft": minecraft,
            "fabric": fabric,
        })))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn import_fabric_modpack(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    pack_path: Option<std::path::PathBuf>,
) -> Result<Option<String>, String> {
    let Some(pack_path) = pack_path.or_else(pick_fabric_pack) else { return Ok(None) };
    import_fabric_modpack_path(app, &state, pack_path).map(Some)
}

#[tauri::command]
async fn import_modrinth_modpack(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    project_id: String,
    version_id: String,
) -> Result<String, String> {
    if project_id.trim().is_empty() || version_id.trim().is_empty() {
        return Err("That Modrinth modpack selection is invalid.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .user_agent(concat!(
            "BloomClient/",
            env!("CARGO_PKG_VERSION"),
            " (support@bloomclient.org)"
        ))
        .build()
        .map_err(|error| error.to_string())?;
    let version = client
        .get(format!(
            "https://api.modrinth.com/v2/version/{}",
            version_id.trim()
        ))
        .send()
        .await
        .map_err(|error| format!("Delight could not resolve that Modrinth pack: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Modrinth rejected that pack version: {error}"))?
        .json::<ModrinthVersion>()
        .await
        .map_err(|error| format!("Modrinth returned invalid pack information: {error}"))?;
    let file = primary_modrinth_file(&version)
        .ok_or("That Modrinth release has no downloadable pack file.")?;
    if !file.filename.to_ascii_lowercase().ends_with(".mrpack") || !allowed_pack_download(&file.url)
    {
        return Err("Delight only imports trusted Modrinth .mrpack downloads.".into());
    }
    if file.size > 512 * 1024 * 1024 {
        return Err("That Modrinth pack is larger than Delight's 512 MB import limit.".into());
    }
    let bytes = client
        .get(&file.url)
        .send()
        .await
        .map_err(|error| format!("Delight could not download that Modrinth pack: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The Modrinth pack download failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Delight could not read that Modrinth pack: {error}"))?;
    if bytes.len() > 512 * 1024 * 1024 {
        return Err("That Modrinth pack exceeded Delight's 512 MB import limit.".into());
    }
    let imports = bloom_data_dir()?.join("imports");
    std::fs::create_dir_all(&imports).map_err(|error| error.to_string())?;
    let safe_project = project_id
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
        })
        .collect::<String>();
    let safe_version = version_id
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
        })
        .collect::<String>();
    let pack_path = imports.join(format!("{}-{}.mrpack", safe_project, safe_version));
    std::fs::write(&pack_path, bytes)
        .map_err(|error| format!("Delight could not save the downloaded pack: {error}"))?;
    // Keep the canonical project artwork with the instance, including during installation.
    let icon = async {
        let project: serde_json::Value = client
            .get(format!("https://api.modrinth.com/v2/project/{}", project_id.trim()))
            .send().await.ok()?.error_for_status().ok()?.json().await.ok()?;
        let url = project["icon_url"].as_str()?.to_string();
        cache::warm_catalog_artwork(vec![url.clone()]).await;
        // Validate the source and persist its small URL, not base64 image bytes.
        cache::get_cached_catalog_artwork(url.clone()).ok().map(|_| url)
    }.await;
    import_fabric_modpack_path_with_icon(app, &state, pack_path, icon)
}

fn install_fabric_api(config: &InstanceConfig) -> Result<(), String> {
    let mods = std::path::PathBuf::from(&config.directory).join("mods");
    std::fs::create_dir_all(&mods).map_err(|error| error.to_string())?;
    let destination = mods.join("fabric-api-bloom.jar");
    if destination.exists() {
        return Ok(());
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent("BloomClient/0.1.0 (https://delightproductions.org)")
        .build()
        .map_err(|error| error.to_string())?;
    let loaders = serde_json::to_string(&["fabric"]).map_err(|error| error.to_string())?;
    let game_versions =
        serde_json::to_string(&[config.version.as_str()]).map_err(|error| error.to_string())?;
    let versions: serde_json::Value = client
        .get("https://api.modrinth.com/v2/project/fabric-api/version")
        .query(&[
            ("loaders", loaders),
            ("game_versions", game_versions),
            ("include_changelog", "false".to_string()),
        ])
        .send()
        .map_err(|error| format!("Fabric API version lookup failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Fabric API version lookup failed: {error}"))?
        .json()
        .map_err(|error| error.to_string())?;
    let version = versions
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["version_type"] == "release")
                .or_else(|| items.first())
        })
        .ok_or_else(|| {
            format!(
                "Fabric API does not currently provide a build for Minecraft {}.",
                config.version
            )
        })?;
    let file = version["files"]
        .as_array()
        .and_then(|files| {
            files
                .iter()
                .find(|file| file["primary"] == true)
                .or_else(|| files.first())
        })
        .ok_or("Fabric API metadata did not include a downloadable file.")?;
    let url = file["url"]
        .as_str()
        .ok_or("Fabric API metadata did not include a download URL.")?;
    let bytes = client
        .get(url)
        .send()
        .map_err(|error| format!("Fabric API download failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Fabric API download failed: {error}"))?
        .bytes()
        .map_err(|error| error.to_string())?;
    let temporary = mods.join("fabric-api-bloom.jar.part");
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
    Ok(())
}

fn instance_has_fabric_api(config: &InstanceConfig) -> bool {
    let Ok(entries) = std::fs::read_dir(std::path::PathBuf::from(&config.directory).join("mods"))
    else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("jar") {
            return false;
        }
        let Ok(file) = std::fs::File::open(path) else {
            return false;
        };
        let Ok(mut archive) = zip::ZipArchive::new(file) else {
            return false;
        };
        let Ok(mut metadata) = archive.by_name("fabric.mod.json") else {
            return false;
        };
        let mut text = String::new();
        std::io::Read::read_to_string(&mut metadata, &mut text).is_ok()
            && serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|value| value["id"].as_str().map(|id| id == "fabric-api"))
                .unwrap_or(false)
    })
}

fn execute_download_plan(
    app: &tauri::AppHandle,
    instance_id: &str,
    plan: &mc_launcher_core::net::download::DownloadPlan,
    cancel: &AtomicBool,
    start: u8,
    end: u8,
    stage: &str,
    assets: bool,
) -> Result<(), String> {
    execute_content_download_plan(app, instance_id, plan, cancel, start, end, stage, assets, None)
}

fn execute_content_download_plan(
    app: &tauri::AppHandle,
    instance_id: &str,
    plan: &mc_launcher_core::net::download::DownloadPlan,
    cancel: &AtomicBool,
    start: u8,
    end: u8,
    stage: &str,
    assets: bool,
    content_task: Option<&str>,
) -> Result<(), String> {
    use std::io::{Read, Write};
    let report = |progress: u8, message: String, received: u64, total: u64, speed: u64| {
        if let Some(id) = content_task {
            content_downloads::progress(app, id, progress, message, received, total, speed);
        } else {
            emit_download(app, instance_id, progress, message, received, total, speed);
        }
    };
    let client = reqwest::blocking::Client::builder()
        .user_agent("BloomClient/0.1.0 (https://delightproductions.org)")
        .build()
        .map_err(|error| error.to_string())?;
    let total_tasks = plan.tasks.len().max(1) as f64;
    let worker_count = DOWNLOAD_WORKERS
        .load(Ordering::Relaxed)
        .clamp(1, 5)
        .min(plan.tasks.len().max(1));
    if worker_count > 1 && plan.tasks.len() > 1 {
        let next = AtomicUsize::new(0);
        let finished = AtomicUsize::new(0);
        let failure = Mutex::new(None::<String>);
        std::thread::scope(|scope| {
            for _ in 0..worker_count {
                let client = client.clone();
                let next = &next;
                let finished = &finished;
                let failure = &failure;
                scope.spawn(move || loop {
                    if cancel.load(Ordering::SeqCst)
                        || failure.lock().map(|value| value.is_some()).unwrap_or(true)
                    {
                        break;
                    }
                    let index = next.fetch_add(1, Ordering::SeqCst);
                    let Some(task) = plan.tasks.get(index) else {
                        break;
                    };
                    let outcome = (|| -> Result<(), String> {
                        if mc_launcher_core::net::download::should_skip_existing(task)
                            .map_err(|error| error.to_string())?
                        {
                            return Ok(());
                        }
                        if let Some(parent) = task.destination.parent() {
                            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                        }
                        let mut response = client
                            .get(&task.url)
                            .send()
                            .map_err(|error| {
                                format!("Download failed for {}: {error}", task.label)
                            })?
                            .error_for_status()
                            .map_err(|error| {
                                format!("Download failed for {}: {error}", task.label)
                            })?;
                        let total_bytes = response.content_length().unwrap_or(0);
                        let temporary = task.destination.with_extension("bloom-part");
                        let mut file =
                            std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
                        let mut buffer = [0u8; 65536];
                        let mut received = 0u64;
                        let started = std::time::Instant::now();
                        loop {
                            if cancel.load(Ordering::SeqCst) {
                                let _ = std::fs::remove_file(&temporary);
                                return Err("__cancelled__".into());
                            }
                            let count = response
                                .read(&mut buffer)
                                .map_err(|error| error.to_string())?;
                            if count == 0 {
                                break;
                            }
                            file.write_all(&buffer[..count])
                                .map_err(|error| error.to_string())?;
                            received += count as u64;
                            let base = finished.load(Ordering::Relaxed) as f64;
                            let fraction = if total_bytes > 0 {
                                received as f64 / total_bytes as f64
                            } else {
                                0.0
                            };
                            let overall = start as f64
                                + ((base + fraction) / total_tasks) * (end - start) as f64;
                            report(
                                overall.round() as u8,
                                if assets {
                                    "Loading assets".into()
                                } else {
                                    stage.into()
                                },
                                received,
                                total_bytes,
                                (received as f64 / started.elapsed().as_secs_f64().max(0.01))
                                    as u64,
                            );
                        }
                        drop(file);
                        if let Some(mc_launcher_core::net::download::Checksum::Sha1(expected)) =
                            &task.checksum
                        {
                            let actual = mc_launcher_core::io::hash::sha1_file(&temporary)
                                .map_err(|error| error.to_string())?;
                            if &actual != expected {
                                let _ = std::fs::remove_file(&temporary);
                                return Err(format!(
                                    "Checksum verification failed for {}.",
                                    task.label
                                ));
                            }
                        }
                        if task.destination.exists() {
                            std::fs::remove_file(&task.destination)
                                .map_err(|error| error.to_string())?;
                        }
                        std::fs::rename(&temporary, &task.destination)
                            .map_err(|error| error.to_string())?;
                        Ok(())
                    })();
                    match outcome {
                        Ok(()) => {
                            let done = finished.fetch_add(1, Ordering::SeqCst) + 1;
                            let progress =
                                start as f64 + (done as f64 / total_tasks) * (end - start) as f64;
                            report(
                                progress.round() as u8,
                                if assets {
                                    "Loading assets".into()
                                } else {
                                    stage.into()
                                },
                                0,
                                0,
                                0,
                            );
                        }
                        Err(error) => {
                            if let Ok(mut slot) = failure.lock() {
                                if slot.is_none() {
                                    *slot = Some(error);
                                }
                            }
                            break;
                        }
                    }
                });
            }
        });
        if cancel.load(Ordering::SeqCst) {
            return Err("__cancelled__".into());
        }
        if let Some(error) = failure
            .into_inner()
            .map_err(|_| "Download worker failed.".to_string())?
        {
            return Err(error);
        }
        return Ok(());
    }
    for (index, task) in plan.tasks.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("__cancelled__".into());
        }
        if mc_launcher_core::net::download::should_skip_existing(task)
            .map_err(|error| error.to_string())?
        {
            let progress = start as f64 + ((index + 1) as f64 / total_tasks) * (end - start) as f64;
            report(
                progress.round() as u8,
                if assets {
                    "Loading assets".into()
                } else {
                    stage.into()
                },
                0,
                0,
                0,
            );
            continue;
        }
        if let Some(parent) = task.destination.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut response = client
            .get(&task.url)
            .send()
            .map_err(|error| format!("Download failed for {}: {error}", task.label))?
            .error_for_status()
            .map_err(|error| format!("Download failed for {}: {error}", task.label))?;
        let total_bytes = response.content_length().unwrap_or(0);
        let temporary = task.destination.with_extension("bloom-part");
        let mut file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
        let mut buffer = [0u8; 65536];
        let mut received = 0u64;
        let mut sample_bytes = 0u64;
        let mut sample_time = std::time::Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = std::fs::remove_file(&temporary);
                return Err("__cancelled__".into());
            }
            let count = response
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            if count == 0 {
                break;
            }
            file.write_all(&buffer[..count])
                .map_err(|error| error.to_string())?;
            received += count as u64;
            let elapsed = sample_time.elapsed().as_secs_f64();
            let speed = if elapsed >= 0.2 {
                let value = ((received - sample_bytes) as f64 / elapsed) as u64;
                sample_bytes = received;
                sample_time = std::time::Instant::now();
                value
            } else {
                0
            };
            let file_fraction = if total_bytes > 0 {
                received as f64 / total_bytes as f64
            } else {
                0.0
            };
            let overall = start as f64
                + ((index as f64 + file_fraction) / total_tasks) * (end - start) as f64;
            report(
                overall.round() as u8,
                if assets {
                    "Loading assets".into()
                } else {
                    stage.into()
                },
                received,
                total_bytes,
                speed,
            );
        }
        drop(file);
        if let Some(mc_launcher_core::net::download::Checksum::Sha1(expected)) = &task.checksum {
            let actual = mc_launcher_core::io::hash::sha1_file(&temporary)
                .map_err(|error| error.to_string())?;
            if &actual != expected {
                let _ = std::fs::remove_file(&temporary);
                return Err(format!("Checksum verification failed for {}.", task.label));
            }
        }
        if task.destination.exists() {
            std::fs::remove_file(&task.destination).map_err(|error| error.to_string())?;
        }
        std::fs::rename(&temporary, &task.destination).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn perform_modrinth_content_install(
    app: &tauri::AppHandle,
    task: &content_downloads::ContentDownload,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let config = load_instance(&task.instance_id)?;
    let (_, content_label, destination_folder) = catalog_category(&task.category)?;
    if task.category == "mods" && !config.loader.eq_ignore_ascii_case("fabric") {
        return Err("Modrinth mod installation currently supports Fabric instances only.".into());
    }
    if cancel.load(Ordering::SeqCst) { return Err("__cancelled__".into()); }
    if task.category == "mods" {
        return pack_compatibility::dependencies::catalog::install_catalog(app, task, &config, cancel);
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("BloomClient/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let (title, file) = {
        let versions: Vec<ModrinthVersion> = client
            .get(format!(
                "https://api.modrinth.com/v2/project/{}/version",
                task.project_id
            ))
            .query(&[
                (
                    "game_versions",
                    serde_json::to_string(&[config.version.as_str()])
                        .map_err(|error| error.to_string())?,
                ),
                ("include_changelog", "false".into()),
            ])
            .send()
            .map_err(|error| format!("Unable to resolve the Modrinth file: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Modrinth could not provide compatible content: {error}"))?
            .json()
            .map_err(|error| format!("The Modrinth version response is invalid: {error}"))?;
        let version = versions
            .iter()
            .find(|version| version.version_type == "release")
            .or_else(|| versions.first())
            .ok_or_else(|| {
                format!(
                    "No compatible {content_label} exists for Minecraft {}.",
                    config.version
                )
            })?;
        let file = primary_modrinth_file(version)
            .ok_or_else(|| format!("The selected {content_label} has no downloadable file."))?;
        let project: ModrinthProject = client
            .get(format!(
                "https://api.modrinth.com/v2/project/{}",
                task.project_id
            ))
            .send()
            .map_err(|error| format!("Unable to load the Modrinth project: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Modrinth rejected the project request: {error}"))?
            .json()
            .map_err(|error| format!("The Modrinth project response is invalid: {error}"))?;
        (project.title, file.clone())
    };
    let destination = std::path::PathBuf::from(&config.directory).join(destination_folder);
    std::fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    if std::path::Path::new(&file.filename)
        .file_name()
        .and_then(|name| name.to_str())
        != Some(file.filename.as_str())
    {
        return Err(format!("Modrinth returned an unsafe {content_label} filename."));
    }
    if !allowed_pack_download(&file.url) {
        return Err("Modrinth returned an untrusted download address.".into());
    }
    let downloads = mc_launcher_core::net::download::DownloadPlan {
        tasks: vec![mc_launcher_core::net::download::DownloadTask {
            url: file.url,
            destination: destination.join(&file.filename),
            checksum: file.hashes.get("sha1").cloned().map(mc_launcher_core::net::download::Checksum::Sha1),
            label: file.filename,
        }],
    };
    execute_content_download_plan(
        app,
        &task.instance_id,
        &downloads,
        cancel,
        3,
        99,
        &format!("Installing {title}"),
        false,
        Some(&task.id),
    )?;
    Ok(title)
}

#[tauri::command]
fn install_modrinth_content(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
    project_id: String,
    category: String,
    title: String,
    version: String,
    icon_url: Option<String>,
) -> Result<content_downloads::QueueSnapshot, String> {
    let config = load_instance(&instance_id)?;
    catalog_category(&category)?;
    if category == "mods" && state.game_running.load(Ordering::SeqCst) {
        return Err("Close Minecraft before installing mods.".into());
    }
    if category == "mods" && !config.loader.eq_ignore_ascii_case("fabric") {
        return Err("Modrinth mod installation currently supports Fabric instances only.".into());
    }
    if !(3..=64).contains(&project_id.len())
        || !project_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err("That Modrinth project ID is invalid.".into());
    }

    let icon_url = icon_url.filter(|value| {
        value.len() <= 2048
            && url::Url::parse(value)
                .ok()
                .filter(|url| url.scheme() == "https")
                .and_then(|url| url.host_str().map(str::to_owned))
                .map(|host| host == "cdn.modrinth.com" || host.ends_with(".modrinth.com"))
                .unwrap_or(false)
    });
    let mut queue = state.content_install_queue.lock().map_err(|_| "The content queue is busy.")?;
    if queue.contains(&instance_id, &project_id, &category) { return Ok(queue.snapshot()); }
    let task = content_downloads::ContentDownload {
        id: uuid::Uuid::new_v4().to_string(),
        instance_id,
        instance_name: config.name,
        project_id,
        category,
        title: title.chars().take(160).collect(),
        version: version.chars().take(100).collect(),
        icon_url,
        state: "queued".into(), message: "Waiting in queue".into(), progress: 0,
        downloaded_bytes: 0, total_bytes: 0, bytes_per_second: 0, completed_at: None, revision: 0,
    };
    let start_worker = !state.content_install_active.load(Ordering::SeqCst);
    if start_worker {
        let mut active = state.launch_active.lock().map_err(|_| "The task manager is busy.")?;
        validate_content_install_activity(&task.category, *active, state.game_running.load(Ordering::SeqCst))?;
        queue.enqueue(task)?;
        *active = true;
        state.content_cancel_requested.store(false, Ordering::SeqCst);
        state.content_install_active.store(true, Ordering::SeqCst);
    } else {
        queue.enqueue(task)?;
    }
    let snapshot = queue.snapshot();
    drop(queue);
    content_downloads::publish(&app, &snapshot);
    if !start_worker { return Ok(snapshot); }

    let active = state.launch_active.clone();
    let game_running = state.game_running.clone();
    let cancel = state.content_cancel_requested.clone();
    let install_queue = state.content_install_queue.clone();
    let install_active = state.content_install_active.clone();
    std::thread::spawn(move || loop {
        let next = {
            let mut queue = match install_queue.lock() { Ok(queue) => queue, Err(_) => break };
            let task = queue.begin_next();
            if task.is_none() {
                install_active.store(false, Ordering::SeqCst);
                if let Ok(mut value) = active.lock() { *value = game_running.load(Ordering::SeqCst); }
            }
            task.map(|task| (task, queue.snapshot()))
        };
        let Some((task, snapshot)) = next else { break };
        content_downloads::publish(&app, &snapshot);
        let result = perform_modrinth_content_install(&app, &task, &cancel);
        let (state_name, message) = match result {
            Ok(title) => ("installed", format!("Installed {title}")),
            Err(error) if error == "__cancelled__" || cancel.load(Ordering::SeqCst) => ("cancelled", format!("{} installation cancelled", task.title)),
            Err(error) => ("error", error),
        };
        let snapshot = {
            let mut queue = match install_queue.lock() { Ok(queue) => queue, Err(_) => break };
            queue.finish(&task.id, state_name, message);
            // Clear only this task's token while holding the queue lock. A cancellation
            // cannot leak into the next item or discard the remaining queue.
            cancel.store(false, Ordering::SeqCst);
            queue.snapshot()
        };
        content_downloads::publish(&app, &snapshot);
    });
    Ok(snapshot)
}

fn install_instance_files(app: &tauri::AppHandle, instance_id: &str, config: &InstanceConfig, root: &std::path::Path, cancel: &AtomicBool, start: u8, end: u8) -> Result<String, String> {
    install_instance_files_internal(app, instance_id, config, root, cancel, start, end, false)
}

fn extract_natives_cached(libraries: &[mc_launcher_core::core::version::Library], root: &std::path::Path, version: &str, repair: bool) -> Result<std::path::PathBuf, String> {
    let key = format!("v1:{}:{version}:{}:{}:{}", root.display(), std::env::consts::OS, std::env::consts::ARCH, serde_json::to_string(libraries).map_err(|e| e.to_string())?);
    let destination = mc_launcher_core::install::natives::natives_directory(root, version);
    if !repair {
        if let Some(receipt) = cache::read_json::<launch_cache::Receipt>("launch-natives", &key, None) {
            if receipt.valid() { return Ok(destination); }
        }
    }
    mc_launcher_core::install::natives::extract_natives(libraries, root, version).map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    for library in libraries {
        if let Some(downloads) = &library.downloads {
            for artifact in downloads.artifact.iter().chain(downloads.classifiers.values()) {
                let path = root.join("libraries").join(&artifact.path);
                if path.is_file() { paths.push(path); }
            }
        }
    }
    if launch_cache::tree(&destination, &mut paths).is_ok() {
        if let Some(receipt) = launch_cache::Receipt::capture(version.into(), paths) {
            let _ = cache::write_json("launch-natives", &key, &receipt);
        }
    }
    Ok(destination)
}

fn install_instance_files_internal(
    app: &tauri::AppHandle,
    instance_id: &str,
    config: &InstanceConfig,
    minecraft_dir: &std::path::Path,
    cancel: &AtomicBool,
    range_start: u8,
    range_end: u8,
    repair: bool,
) -> Result<String, String> {
    let mut prepared_paths = Vec::new();
    let scale =
        |value: u8| range_start + (((range_end - range_start) as u16 * value as u16) / 100) as u8;
    emit_launch(
        app,
        instance_id,
        "installing",
        scale(2),
        "Checking Minecraft version",
    );
    let vanilla = mc_launcher_core::install::client::fetch_vanilla_version(&config.version)
        .map_err(|error| error.to_string())?;
    mc_launcher_core::install::client::write_version_json(minecraft_dir, &vanilla)
        .map_err(|error| error.to_string())?;
    let base_plan =
        mc_launcher_core::install::vanilla::plan_vanilla_downloads(&vanilla, minecraft_dir)
            .map_err(|error| error.to_string())?;
    prepared_paths.extend(base_plan.tasks.iter().map(|task| task.destination.clone()));
    execute_download_plan(
        app,
        instance_id,
        &base_plan,
        cancel,
        scale(4),
        scale(35),
        "Downloading Minecraft libraries",
        false,
    )?;
    if let Some(index) = &vanilla.asset_index {
        let path = mc_launcher_core::install::assets::asset_index_path(minecraft_dir, &index.id);
        let data: mc_launcher_core::install::assets::AssetIndexJson =
            serde_json::from_slice(&std::fs::read(path).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?;
        let assets = mc_launcher_core::install::assets::plan_asset_object_downloads_from_index(
            &data,
            minecraft_dir,
        );
        prepared_paths.extend(assets.tasks.iter().map(|task| task.destination.clone()));
        execute_download_plan(
            app,
            instance_id,
            &assets,
            cancel,
            scale(35),
            scale(88),
            "Loading assets",
            true,
        )?;
    }
    let mut version_id = config.version.clone();
    if config.loader.eq_ignore_ascii_case("fabric") {
        emit_launch(
            app,
            instance_id,
            "installing",
            scale(89),
            "Resolving Fabric Loader",
        );
        let loader_version = fabric_loader::resolve(config)?;
        let profile =
            mc_launcher_core::loader::fabric::fetch_profile(&config.version, &loader_version)
                .map_err(|error| error.to_string())?;
        version_id = profile
            .id
            .clone()
            .ok_or("Fabric did not return a launch profile ID.")?;
        mc_launcher_core::install::loader::write_loader_profile(minecraft_dir, &profile)
            .map_err(|error| error.to_string())?;
        let launcher = mc_launcher_core::launcher::Launcher::new(minecraft_dir);
        let merged = launcher
            .load_version(&version_id)
            .map_err(|error| error.to_string())?;
        let mut loader_plan =
            mc_launcher_core::install::vanilla::plan_vanilla_downloads(&merged, minecraft_dir)
                .map_err(|error| error.to_string())?;
        for library in &merged.libraries {
            if library.downloads.is_some() {
                continue;
            }
            let Some(repository) = library.url.as_deref() else {
                continue;
            };
            let coordinate = mc_launcher_core::core::maven::MavenCoordinate::parse(&library.name)
                .map_err(|error| error.to_string())?;
            let path = coordinate.artifact_path();
            let relative = path.to_string_lossy().replace('\\', "/");
            loader_plan
                .tasks
                .push(mc_launcher_core::net::download::DownloadTask {
                    url: format!("{}/{}", repository.trim_end_matches('/'), relative),
                    destination: minecraft_dir.join("libraries").join(path),
                    checksum: None,
                    label: library.name.clone(),
                });
        }
        prepared_paths.extend(loader_plan.tasks.iter().map(|task| task.destination.clone()));
        execute_download_plan(
            app,
            instance_id,
            &loader_plan,
            cancel,
            scale(89),
            scale(94),
            "Installing Fabric Loader",
            false,
        )?;
        extract_natives_cached(&merged.libraries, minecraft_dir, &version_id, repair)
        .map_err(|error| error.to_string())?;
        if !workspace_install::uses_published_files(config) && !instance_has_fabric_api(config) {
            emit_launch(
                app,
                instance_id,
                "installing",
                scale(94),
                "Installing Fabric API",
            );
            install_fabric_api(config)?;
        }
        if let Err(error) = fabric_loader::remember(config, &loader_version) {
            emit_game_log(app, instance_id, "launcher", error);
        }
    } else {
        extract_natives_cached(&vanilla.libraries, minecraft_dir, &version_id, repair)
        .map_err(|error| error.to_string())?;
    }
    cosmetics::reconcile(config)?;
    prepared_paths.push(minecraft_dir.join("versions").join(&config.version).join(format!("{}.json", config.version)));
    prepared_paths.push(minecraft_dir.join("versions").join(&version_id).join(format!("{version_id}.json")));
    let natives = mc_launcher_core::install::natives::natives_directory(minecraft_dir, &version_id);
    let mut tracked = launch_cache::tree(&natives, &mut prepared_paths).is_ok();
    let mods = std::path::Path::new(&config.directory).join("mods");
    if mods.exists() { tracked &= launch_cache::tree(&mods, &mut prepared_paths).is_ok(); }
    if tracked && launch_cache::reusable(config) {
        if let Some(receipt) = launch_cache::Receipt::capture(version_id.clone(), prepared_paths) {
            let _ = cache::write_json("launch-installations", &launch_cache::key(config, minecraft_dir), &receipt);
        }
    }
    Ok(version_id)
}

fn prepare_instance_files(app: &tauri::AppHandle, instance_id: &str, config: &InstanceConfig, root: &std::path::Path, cancel: &AtomicBool, start: u8, end: u8) -> Result<String, String> {
    if cancel.load(Ordering::SeqCst) { return Err("__cancelled__".into()); }
    if launch_cache::reusable(config) {
        if let Some(receipt) = cache::read_json::<launch_cache::Receipt>("launch-installations", &launch_cache::key(config, root), None) {
            if receipt.valid() {
                cosmetics::reconcile(config)?;
                emit_launch(app, instance_id, "installing", end, "Using verified Minecraft installation");
                return Ok(receipt.version_id);
            }
        }
    }
    install_instance_files(app, instance_id, config, root, cancel, start, end)
}

fn java_selection_key(config: &InstanceConfig, required: u32) -> String {
    format!("java-v1:{required}:{}:{}", config.java, std::env::consts::ARCH)
}
fn cached_selected_java(config: &InstanceConfig, required: u32) -> Option<std::path::PathBuf> {
    let receipt = cache::read_json::<launch_cache::Receipt>("launch-java", &java_selection_key(config, required), None)?;
    receipt.valid().then(|| receipt.version_id.into())
}
fn selected_java(app: &tauri::AppHandle, instance_id: &str, config: &InstanceConfig, required: u32, cancel: &AtomicBool) -> Result<std::path::PathBuf, String> {
    if cancel.load(Ordering::SeqCst) { return Err("__cancelled__".into()); }
    let key = java_selection_key(config, required);
    if let Some(path) = cached_selected_java(config, required) { return Ok(path); }
    let path = selected_java_uncached(app, instance_id, config, required, cancel)?;
    let mut files = vec![path.clone()];
    let jvm = platform::java_library_stamp(&path);
    if jvm.is_file() { files.push(jvm); }
    if let Some(receipt) = launch_cache::Receipt::capture(path.to_string_lossy().into_owned(), files) {
        let _ = cache::write_json("launch-java", &key, &receipt);
    }
    Ok(path)
}

fn selected_java_uncached(
    app: &tauri::AppHandle,
    instance_id: &str,
    config: &InstanceConfig,
    required: u32,
    cancel: &AtomicBool,
) -> Result<std::path::PathBuf, String> {
    if !config.java.to_ascii_lowercase().starts_with("automatic") && !config.java.trim().is_empty()
    {
        let configured_path = config
            .java
            .rsplit_once(" — ")
            .map(|(_, path)| path)
            .unwrap_or(&config.java);
        let found = java_major(configured_path)
            .ok_or("The Java runtime selected for this instance cannot be used.")?;
        if found < required {
            return Err(format!("Minecraft {} needs Java {required} or newer, but this instance is set to Java {found}.", config.version));
        }
        let path = std::path::PathBuf::from(configured_path);
        if !platform::java_matches_host(&path) { return Err("Choose a Java runtime matching this Mac’s architecture, or select Automatic.".into()); }
        return Ok(platform::launch_java(path));
    }
    if let Some(java) = detect_java_installations_blocking()
        .into_iter()
        .filter(|java| java.usable && java.major_version.unwrap_or(0) >= required)
        .min_by_key(|java| {
            (
                java.major_version.unwrap_or(u32::MAX) != required,
                java.major_version.unwrap_or(u32::MAX),
            )
        })
    {
        let path = std::path::PathBuf::from(java.path);
        if !platform::java_matches_host(&path) { return Err("Choose a Java runtime matching this Mac’s architecture, or select Automatic.".into()); }
        return Ok(platform::launch_java(path));
    }
    download_managed_java(app, instance_id, required, cancel)
}

#[tauri::command]
async fn launch_minecraft(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
    launch_method: String,
    download_workers: u8,
    debug_logging: bool,
    portal_target: Option<portal::Target>,
) -> Result<(), String> {
    let launch_started = std::time::Instant::now();
    if !matches!(download_workers, 1 | 3 | 5) {
        return Err("Download workers must be 1, 3, or 5.".into());
    }
    DOWNLOAD_WORKERS.store(download_workers as usize, Ordering::Relaxed);
    let follow_lease = if workspace_install::updates::is_follow(&instance_id) {
        let id = instance_id.clone();
        tauri::async_runtime::spawn_blocking(move || workspace_install::updates::before_play(&id))
            .await.map_err(|_| "The shared pack check stopped unexpectedly.")??
    } else { None };
    let initial_config = load_instance(&instance_id)?;
    if let Some(target) = &portal_target {
        if !list_instances_blocking()?.iter().any(|instance| instance.id == instance_id) {
            return Err("This instance is no longer available in Portal.".into());
        }
        portal::validate_target(&initial_config, target)?;
    }
    {
        let mut active = state
            .launch_active
            .lock()
            .map_err(|_| "The launcher is busy. Try again.")?;
        if *active {
            return Err("Something is already downloading or running. Please wait.".into());
        }
        pack_compatibility::dependencies::maintenance::restore_before_play(&initial_config)?;
        if state.game_running.load(Ordering::SeqCst) {
            return Err("Close Minecraft before starting another instance.".into());
        }
        mod_duplicates::before_play(&app, &load_instance(&instance_id)?)?;
        *active = true;
    }
    state.cancel_requested.store(false, Ordering::SeqCst);
    let stored_session = state
        .session
        .lock()
        .map_err(|_| "Unable to read the Minecraft sign-in session.")?
        .clone()
        .or_else(saved_session)
        .ok_or_else(|| {
            if let Ok(mut active) = state.launch_active.lock() {
                *active = false;
            }
            "Sign in with Microsoft before launching Minecraft.".to_string()
        })?;
    let session_store = state.session.clone();
    let authentication_id = instance_id.clone();
    let authentication_error = Arc::new(Mutex::new(None::<String>));
    let authentication_error_for_task = authentication_error.clone();
    let authentication_cancel = state.cancel_requested.clone();
    let mut authentication = launch_cache::AbortTask(tauri::async_runtime::spawn(async move {
        let outcome = async {
        let auth_started = std::time::Instant::now();
        let session = launch_session(&stored_session).await?;
        if session.access_token != stored_session.access_token || session.username != stored_session.username || session.expires_at != stored_session.expires_at {
            let to_save = session.clone();
            tauri::async_runtime::spawn_blocking(move || save_account_session(&to_save, true)).await.map_err(|_| "Secure account storage stopped unexpectedly.")??;
        }
        *session_store.lock().map_err(|_| "Unable to update the active account.")? = Some(session.clone());
        let auth_ms = auth_started.elapsed().as_millis();
        let cosmetics_started = std::time::Instant::now();
        let cosmetic_session = session.clone();
        let token = tauri::async_runtime::spawn_blocking(move || {
            load_instance(&authentication_id).ok().and_then(|config| cosmetics::prepare_session(&config, &cosmetic_session))
        }).await.map_err(|_| "Cosmetics preparation stopped unexpectedly.")?;
        Ok::<_, String>((session, token, auth_ms, cosmetics_started.elapsed().as_millis()))
        }.await;
        if let Err(error) = &outcome {
            if let Ok(mut saved) = authentication_error_for_task.lock() { *saved = Some(error.clone()); }
            authentication_cancel.store(true, Ordering::SeqCst);
        }
        outcome
    }));
    let active = Arc::new(state.launch_active.clone());
    let cancel_requested = state.cancel_requested.clone();
    let game_running = state.game_running.clone();
    let content_active = state.content_install_active.clone();
    emit_launch(&app, &instance_id, "launching", 0, "Preparing Minecraft launch");
    std::thread::spawn(move || {
        let follow_game = follow_lease;
        let preparation_started = std::time::Instant::now();
        let config = match load_instance(&instance_id) {
            Ok(config) => config,
            Err(error) => {
                emit_launch(&app, &instance_id, "error", 0, error);
                if let Ok(mut value) = active.lock() {
                    *value = false;
                }
                return;
            }
        };
        if let Err(error) = utilities::apply_active_setup_to_instance(&config) {
            emit_launch(
                &app,
                &instance_id,
                "error",
                0,
                format!("Global File Sync could not prepare this instance: {error}"),
            );
            if let Ok(mut value) = active.lock() {
                *value = false;
            }
            return;
        }
        let options_path = std::path::PathBuf::from(&config.directory).join("options.txt");
        if let Err(error) = patch_options(
            &options_path,
            &[("fullscreen", (launch_method == "Fullscreen").to_string())],
        ) {
            emit_launch(
                &app,
                &instance_id,
                "error",
                0,
                format!("Could not apply launch mode: {error}"),
            );
            if let Ok(mut value) = active.lock() {
                *value = false;
            }
            return;
        }
        emit_launch(
            &app,
            &instance_id,
            "installing",
            2,
            "Preparing Minecraft files",
        );
        let shared_minecraft = match bloom_data_dir() {
            Ok(path) => path.join("minecraft"),
            Err(error) => {
                emit_launch(&app, &instance_id, "error", 0, error);
                if let Ok(mut value) = active.lock() {
                    *value = false;
                }
                return;
            }
        };
        let launcher = mc_launcher_core::launcher::Launcher::new(&shared_minecraft);
        let known_java = launcher.load_version(&config.version).ok().and_then(|version| version.java_version).and_then(|java| cached_selected_java(&config, java.major_version.max(8) as u32));
        let java_discovery = if known_java.is_none() { Some(std::thread::spawn(detect_java_installations_blocking)) } else { None };
        let installed_version = match prepare_instance_files(
            &app,
            &instance_id,
            &config,
            &shared_minecraft,
            &cancel_requested,
            0,
            88,
        ) {
            Ok(version) => version,
            Err(error) if error == "__cancelled__" => {
                if let Some(error) = authentication_error.lock().ok().and_then(|error| error.clone()) {
                    emit_launch(&app, &instance_id, "error", 0, format!("The selected Microsoft account needs to reconnect: {error}"));
                } else {
                    emit_launch(&app, &instance_id, "cancelled", 0, "Launch cancelled");
                }
                if let Ok(mut value) = active.lock() {
                    *value = false;
                }
                return;
            }
            Err(error) => {
                emit_launch(
                    &app,
                    &instance_id,
                    "error",
                    0,
                    format!("Minecraft installation failed: {error}"),
                );
                if let Ok(mut value) = active.lock() {
                    *value = false;
                }
                return;
            }
        };
        emit_game_log(&app, &instance_id, "launcher", format!("Launch timing: file preparation {} ms", preparation_started.elapsed().as_millis()));
        let result = (|| -> Result<(), String> {
            let (session, cosmetic_token, auth_ms, cosmetics_ms) = loop {
                if cancel_requested.load(Ordering::SeqCst) {
                    if let Some(error) = authentication_error.lock().ok().and_then(|error| error.clone()) { return Err(format!("The selected Microsoft account needs to reconnect: {error}")); }
                    return Err("__cancelled__".into());
                }
                if let Ok(result) = tauri::async_runtime::block_on(async { tokio::time::timeout(std::time::Duration::from_millis(100), &mut authentication.0).await }) {
                    break result.map_err(|_| "Account preparation stopped unexpectedly.".to_string())??;
                }
            };
            emit_game_log(&app, &instance_id, "launcher", format!("Launch timing: account {auth_ms} ms; cosmetics {cosmetics_ms} ms (parallel with files)"));
            if cancel_requested.load(Ordering::SeqCst) { return Err("Minecraft launch was cancelled.".into()); }
            let discovery_wait = std::time::Instant::now();
            if let Some(discovery) = java_discovery { let _ = discovery.join(); }
            emit_game_log(&app, &instance_id, "launcher", format!("Launch timing: Java discovery wait {} ms", discovery_wait.elapsed().as_millis()));
            let java_started = std::time::Instant::now();
            let version = launcher
                .load_version(&installed_version)
                .map_err(|error| format!("Minecraft metadata could not be loaded: {error}"))?;
            let required_java = version
                .java_version
                .as_ref()
                .map(|value| value.major_version.max(8) as u32)
                .unwrap_or(8);
            let java = selected_java(
                &app,
                &instance_id,
                &config,
                required_java,
                &cancel_requested,
            )?;
            emit_launch(
                &app,
                &instance_id,
                "launching",
                97,
                format!("Launching with Java {required_java}"),
            );
            let account = mc_launcher_core::account::Account::Microsoft {
                username: session.username.clone(),
                uuid: session.uuid.clone(),
                access_token: session.access_token.clone(),
            };
            let options = mc_launcher_core::command::builder::LaunchOptions {
                account,
                java_executable: Some(java),
                game_directory: Some(config.directory.clone().into()),
                launcher_name: "Delight Client".into(),
                launcher_version: env!("CARGO_PKG_VERSION").into(),
                custom_resolution: if config.custom_resolution {
                    Some((1280, 720))
                } else {
                    None
                },
                ..Default::default()
            };
            let command = launcher
                .build_launch_command_from_version(&version, options)
                .map_err(|error| format!("Minecraft launch command could not be built: {error}"))?;
            let main_index = command
                .args
                .iter()
                .position(|arg| version.main_class.as_deref() == Some(arg.as_str()))
                .ok_or("Minecraft launch metadata did not include a main class.")?;
            let mut args = command.args;
            let quick_play = portal::supports_quick_play(&version);
            if let Some(target) = &portal_target {
                if !quick_play { return Err("This Minecraft version does not support direct play. Open the instance to play normally.".into()); }
                portal::validate_target(&config, target)?;
                portal::append_target(&mut args, target);
            }
            let mut portal_tracker = quick_play.then(|| portal::JoinTracker::new(&config.directory));
            if let Some(tracker) = &portal_tracker { tracker.append_args(&mut args); }
            args.insert(main_index, format!("-Xmx{}M", config.memory));
            for argument in config.jvm_arguments.split_whitespace().rev() {
                args.insert(main_index, argument.to_string());
            }
            let mut process = command_without_console(command.executable);
            let child_identity = follow_game.as_ref().map(|guard| guard.prepare(&process)).transpose()?;
            if let Some(identity) = &child_identity {
                args.insert(main_index, identity.argument());
            }
            process
                .args(args)
                .current_dir(command.working_dir)
                .envs(command.env)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            process.stdin(match child_identity.as_ref() {
                Some(identity) => identity.stdin()?,
                None => std::process::Stdio::null(),
            });
            cosmetics::attach_session(&mut process, &config, &session, &cosmetic_token);
            emit_game_log(&app, &instance_id, "launcher", format!("Launch timing: Java selection and command {} ms", java_started.elapsed().as_millis()));
            mod_duplicates::before_play(&app, &config)?;
            let mut child = process
                .spawn()
                .map_err(|error| format!("Minecraft could not start: {error}"))?;
            if let Some(identity) = &child_identity {
                if let Err(error) = identity.record_child(child.id()) {
                    // The pre-spawn marker remains valid if the launcher stops here.
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            }
            game_running.store(true, Ordering::SeqCst);
            let _ = app.emit("minecraft-process-state", true);
            emit_game_log(&app, &instance_id, "launcher", format!("Launch timing: Play to process {} ms", launch_started.elapsed().as_millis()));
            emit_launch(
                &app,
                &instance_id,
                "launching",
                96,
                "Starting Minecraft process",
            );
            let (log_sender, log_receiver) = std::sync::mpsc::channel::<(String, String)>();
            if let Some(stdout) = child.stdout.take() {
                let sender = log_sender.clone();
                std::thread::spawn(move || {
                    use std::io::BufRead;
                    for line in std::io::BufReader::new(stdout)
                        .lines()
                        .map_while(Result::ok)
                    {
                        let _ = sender.send(("stdout".into(), line));
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                let sender = log_sender.clone();
                std::thread::spawn(move || {
                    use std::io::BufRead;
                    for line in std::io::BufReader::new(stderr)
                        .lines()
                        .map_while(Result::ok)
                    {
                        let _ = sender.send(("stderr".into(), line));
                    }
                });
            }
            drop(log_sender);
            let mut ready = false;
            let mut portal_poll = std::time::Instant::now();
            let mut portal_error_reported = false;
            loop {
                if portal_poll.elapsed() >= std::time::Duration::from_secs(1) {
                    if let Some(tracker) = &mut portal_tracker {
                        match tracker.observe(&config) {
                            Ok(true) => { let _ = app.emit("portal-changed", ()); },
                            Err(error) if !portal_error_reported => {
                                emit_game_log(&app, &instance_id, "launcher", format!("Portal history could not be saved: {error}"));
                                portal_error_reported = true;
                            },
                            _ => {},
                        }
                    }
                    portal_poll = std::time::Instant::now();
                }
                if cancel_requested.load(Ordering::SeqCst) {
                    let _ = child.kill();
                    return Err("__cancelled__".into());
                }
                while let Ok((stream, line)) = log_receiver.try_recv() {
                    if debug_logging
                        || stream == "stderr"
                        || line.contains("WARN")
                        || line.contains("ERROR")
                        || line.contains("Loading ")
                        || line.contains("OpenAL")
                        || line.contains("Created:")
                    {
                        emit_game_log(&app, &instance_id, &stream, line.clone());
                    }
                    if !ready && line.contains("Loading ") && line.contains(" mods") {
                        emit_launch(&app, &instance_id, "launching", 97, "Loading Fabric mods");
                    } else if !ready && (line.contains("Backend library") || line.contains("LWJGL Version")) {
                        emit_launch(
                            &app,
                            &instance_id,
                            "launching",
                            98,
                            "Initializing game renderer",
                        );
                    } else if !ready && line.contains("Reloading ResourceManager") {
                        emit_launch(
                            &app,
                            &instance_id,
                            "launching",
                            99,
                            "Loading game resources",
                        );
                    }
                    if !ready
                        && (line.contains("OpenAL initialized")
                            || line.contains("Sound engine started")
                            || line.contains("Created:"))
                    {
                        ready = true;
                        emit_game_log(&app, &instance_id, "launcher", format!("Launch timing: Play to game-ready signal {} ms", launch_started.elapsed().as_millis()));
                        emit_launch(&app, &instance_id, "running", 100, "Minecraft is ready");
                    }
                }
                if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                    if let Some(tracker) = &mut portal_tracker {
                        if matches!(tracker.observe(&config), Ok(true)) { let _ = app.emit("portal-changed", ()); }
                    }
                    if !status.success() {
                        let description = if ready { "Minecraft crashed" } else { "Minecraft exited before opening" };
                        return Err(format!(
                            "{description} (exit code {}).",
                            status
                                .code()
                                .map(|code| code.to_string())
                                .unwrap_or_else(|| "unknown".into())
                        ));
                    }
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(75));
            }
            Ok(())
        })();
        match result {
            Err(error) if error == "__cancelled__" => emit_launch(&app, &instance_id, "cancelled", 0, "Launch cancelled"),
            Ok(()) => emit_launch(&app, &instance_id, "idle", 0, "Minecraft closed"),
            Err(error) => emit_launch(&app, &instance_id, "error", 0, error),
        }
        if let Ok(mut value) = active.lock() {
            game_running.store(false, Ordering::SeqCst);
            *value = content_active.load(Ordering::SeqCst);
        }
        let _ = app.emit("minecraft-process-state", false);
    });
    Ok(())
}

#[tauri::command]
fn choose_game_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn exit_application(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn repair_minecraft_installation(
    app: tauri::AppHandle,
    instance_id: String,
    state: tauri::State<'_, LauncherState>,
) -> Result<(), String> {
    let config = load_instance(&instance_id)?;
    {
        let mut active = state
            .launch_active
            .lock()
            .map_err(|_| "The task manager is busy.")?;
        if *active {
            return Err("Another download or game launch is already active.".into());
        }
        *active = true;
    }
    state.cancel_requested.store(false, Ordering::SeqCst);
    let active = state.launch_active.clone();
    let cancel = state.cancel_requested.clone();
    std::thread::spawn(move || {
        emit_launch(
            &app,
            &instance_id,
            "installing",
            1,
            "Verifying Minecraft files",
        );
        let result = bloom_data_dir()
            .map(|path| path.join("minecraft"))
            .and_then(|shared| {
                install_instance_files_internal(&app, &instance_id, &config, &shared, &cancel, 1, 100, true)
                    .map(|_| ())
            });
        match result {
            Ok(()) => emit_launch(
                &app,
                &instance_id,
                "complete",
                100,
                "Minecraft files verified",
            ),
            Err(error) if error == "__cancelled__" => {
                emit_launch(&app, &instance_id, "cancelled", 0, "Repair cancelled")
            }
            Err(error) => emit_launch(&app, &instance_id, "error", 0, error),
        }
        if let Ok(mut value) = active.lock() {
            *value = false;
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        player_links::show_main_window(app);
    })).plugin(tauri_plugin_deep_link::init());
    let builder = builder
        .manage(player_links::PendingLinks::default())
        .manage(LauncherState::default())
        .manage(now_playing::NowPlayingState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());
    // Development binaries must never download or install production updates.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let context = tauri::generate_context!();
    // A separately launched development profile must receive its own links.
    #[cfg(debug_assertions)]
    let context = {
        let mut context = context;
        if let Some(profile) = std::env::var_os("BLOOM_DEV_DATA_DIR") {
            use sha2::{Digest, Sha256};
            let hash = format!("{:x}", Sha256::digest(profile.as_encoded_bytes()));
            context.config_mut().identifier.push_str(&format!(".preview-{}", &hash[..16]));
        }
        context
    };
    builder
        .setup(|app| {
            #[cfg(desktop)]
            player_links::listen(app.handle())?;
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };
            let show = MenuItem::with_id(app, "show", "Show Delight Client", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Delight Client", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            screenshots::list_screenshots,
            screenshots::screenshot_action,
            screenshots::save_screenshot_comparison,
            get_backend_status,
            cache::get_client_cache_status,
            cache::choose_client_cache_directory,
            cache::save_client_cache_settings,
            cache::clear_client_cache,
            cache::get_cached_thumbnail,
            cache::save_cached_thumbnail,
            cache::get_cached_catalog_artwork,
            cosmetics::cosmetics_request,
            cosmetics::get_cosmetics_preferences,
            cosmetics::set_cosmetics_preferences,
            cosmetics::reconcile_cosmetics,
            search_modrinth_content,
            catalog_filters::get_catalog_filter_choices,
            get_modrinth_project_details,
            list_modrinth_modpack_releases,
            request_microsoft_device_code,
            copy_text_to_clipboard,
            complete_microsoft_login,
            detect_java_installations,
            list_managed_java_runtimes,
            remove_managed_java_runtime,
            get_minecraft_releases,
            save_instance,
            create_alula_instance,
            list_instances,
            portal::list_portal,
            portal::change_portal,
            instance_folders::list_instance_folders,
            instance_folders::change_instance_folder,
            duplicate_instance,
            instance_actions::rename_instance,
            instance_actions::export_instance,
            delete_instance,
            list_instance_content,
            get_cached_instance_content,
            pack_artwork::get_pack_artwork,
            content_transfer::preview_content_transfer,
            content_transfer::copy_instance_content,
            toggle_instance_content,
            delete_instance_content,
            set_instance_icon,
            update_instance_settings,
            fabric_loader::list_instance_fabric_loaders,
            open_instance_folder,
            import_instance_mod_files,
            import_instance_content_files,
            open_game_folder,
            choose_fabric_modpack_file,
            import_fabric_modpack,
            import_modrinth_modpack,
            modpack_sharing::create_modpack_share,
            pack_compatibility::check_pack_compatibility,
            pack_compatibility::preview_pack_publication,
            pack_compatibility::resolve_pack_mod_conflict,
            pack_compatibility::dependencies::review_pack_dependencies,
            pack_compatibility::dependencies::apply_pack_dependencies,
            pack_compatibility::dependencies::maintenance::check_mod_maintenance,
            pack_compatibility::dependencies::maintenance::update_instance_mods,
            pack_compatibility::dependencies::maintenance::minecraft_update::preview_minecraft_mod_update,
            pack_compatibility::dependencies::maintenance::minecraft_update::apply_minecraft_mod_update,
            pack_compatibility::dependencies::maintenance::minecraft_update::get_minecraft_mod_recovery,
            pack_compatibility::dependencies::maintenance::minecraft_update::open_minecraft_mod_recovery,
            pack_compatibility::dependencies::maintenance::minecraft_update::restore_minecraft_mod_update,
            client_notice::get_client_notice,
            notifications::get_notifications,
            now_playing::start_now_playing,
            now_playing::stop_now_playing,
            now_playing::control_now_playing,
            now_playing::get_now_playing_volume,
            now_playing::set_now_playing_volume,
            notifications::mark_notifications_read,
            notifications::observe_launcher_notification,
            notifications::observe_followed_notification,
            mod_duplicates::check_mod_duplicates,
            mod_duplicates::keep_newest_mod_versions,
            mod_duplicates::choose_mod_version,
            mod_duplicates::restore_previous_mod_version,
            workspace_publication::get_workspace_publication,
            workspace_publication::access::workspace_manage_access,
            workspace_publication::access::workspace_invitation,
            workspace_publication::access::get_workspace_collaboration,
            workspace_publication::access::workspace_can_edit,
            workspace_publication::access::create_workspace_working_copy,
            workspace_publication::drafts::get_workspace_drafts,
            workspace_publication::drafts::get_workspace_draft,
            workspace_publication::drafts::save_workspace_draft,
            workspace_publication::drafts::change_workspace_draft,
            workspace_publication::get_pack_publisher,
            workspace_publication::publish_workspace_release,
            workspace_publication::restore::restore_workspace_release,
            player_links::take_workspace_player_links,
            workspace_player::preview_player_pack,
            workspace_install::install_followed_pack,
            workspace_install::get_followed_pack,
            workspace_player::get_workspace_release,
            workspace_publication::get_workspace_release_history,
            workspace_install::updates::check_followed_pack_update,
            workspace_install::updates::update_followed_pack,
            workspace_install::updates::recovery::repair_followed_pack,
            modpack_sharing::import_modpack_share,
            modpack_sharing::create_pack_channel,
            modpack_sharing::create_pack_editor_invite,
            modpack_sharing::create_pack_access_invite,
            modpack_sharing::import_pack_channel,
            modpack_sharing::join_pack_as_editor,
            modpack_sharing::publish_pack_channel,
            modpack_sharing::get_pack_channel_state,
            modpack_sharing::get_pack_access_overview,
            modpack_sharing::enable_pack_managed_access,
            modpack_sharing::update_pack_member_role,
            modpack_sharing::revoke_pack_member,
            modpack_sharing::invalidate_pack_invite,
            modpack_sharing::list_pack_channel_memberships,
            modpack_sharing::apply_pack_channel_update,
            install_modrinth_content,
            content_downloads::get_content_downloads,
            content_downloads::cancel_content_download,
            content_downloads::dismiss_content_download,
            launch_minecraft,
            choose_game_directory,
            exit_application,
            reserve_launcher_update,
            get_minecraft_launch_status,
            get_minecraft_process_running,
            cancel_minecraft_launch,
            cancel_titlebar_launch,
            repair_minecraft_installation,
            sign_out_minecraft,
            get_saved_minecraft_profile,
            get_minecraft_skin,
            wardrobe::get_minecraft_wardrobe,
            wardrobe::set_official_cape,
            wardrobe::import_locker_skin,
            wardrobe::import_skin_by_username,
            wardrobe::apply_locker_skin,
            list_minecraft_accounts,
            switch_minecraft_account,
            utilities::get_global_file_sync_state,
            utilities::save_global_file_sync_settings,
            utilities::apply_global_file_sync,
            utilities::open_global_sync_folder,
            social::social_prepare_sign_in,
            social::social_poll_sign_in,
            social::social_session_state,
            ask_delight::ask_delight_scope,
            ask_delight::ask_delight_history,
            ask_delight::ask_delight_remote,
            social::social_set_username,
            social::social_snapshot,
            social::social_wait_for_updates,
            social::social_sync_messages,
            social::social_encryption_details,
            social::social_acknowledge_identity,
            social::social_share_context,
            social::social_send_friend_request,
            social::social_accept_friend_request,
            social::social_decline_friend_request,
            social::social_remove_friend,
            social::social_create_instance_invites,
            social::social_claim_instance_invite,
            social::social_complete_instance_invite,
            social::social_release_instance_invite,
            social::social_decline_instance_invite,
            social::social_revoke_instance_invite,
            social::social_send_message,
            social::social_edit_message,
            social::social_send_screenshot,
            social::social_react,
            social::social_pin_message,
            social::social_create_group,
            social::social_update_group,
            social::social_add_group_member,
            social::social_remove_group_member,
            social::social_send_group_message,
            social::social_edit_group_message,
            social::social_react_group,
            social::social_pin_group_message,
            social::social_sign_out
        ])
        .run(context)
        .expect("error while running Delight Client");
}

#[cfg(test)]
mod tests {
    use super::{
        account_credential_name, allowed_pack_download, content_import_details, patch_options,
        resolve_instance_target, safe_pack_path,
        split_credential_secret, InstanceConfig,
    };

    #[test]
    fn account_credentials_are_scoped_by_minecraft_uuid() {
        assert_eq!(
            account_credential_name("abc-123"),
            "minecraft-account-abc123"
        );
        assert_ne!(
            account_credential_name("abc-123"),
            account_credential_name("def-456")
        );
    }

    #[test]
    fn long_account_tokens_are_split_below_windows_limits() {
        let token = "x".repeat(7_001);
        let chunks = split_credential_secret(&token);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 1_200));
        assert_eq!(chunks.concat(), token);
    }

    #[test]
    fn modpack_paths_stay_inside_the_instance() {
        assert!(safe_pack_path("mods/example.jar").is_ok());
        assert!(safe_pack_path("../outside.jar").is_err());
        assert!(safe_pack_path("C:\\outside.jar").is_err());
        assert!(safe_pack_path("C:/outside.jar").is_err());
        assert!(safe_pack_path("C:outside.jar").is_err());
        assert!(safe_pack_path("..\\outside.jar").is_err());
        assert!(safe_pack_path("\\\\server\\share\\outside.jar").is_err());
        assert!(safe_pack_path("mods/example.jar:stream").is_err());
        assert_eq!(safe_pack_path("mods\\example.jar").unwrap(), std::path::Path::new("mods/example.jar"));
        assert!(safe_pack_path("/outside.jar").is_err());
    }

    #[test]
    fn selected_instance_directory_is_used_as_the_real_parent() {
        let selected = std::env::temp_dir().join("bloom-selected-game-directory");
        let target = resolve_instance_target(&selected.to_string_lossy(), "my-instance").unwrap();
        assert_eq!(target, selected.join("my-instance"));
    }

    #[test]
    fn dropped_content_uses_the_active_category_file_type() {
        assert_eq!(content_import_details("mods").unwrap().0, "jar");
        assert_eq!(content_import_details("resourcepacks").unwrap().0, "zip");
        assert_eq!(content_import_details("shaderpacks").unwrap().0, "zip");
        assert!(content_import_details("settings").is_err());
    }

    #[test]
    fn modpack_downloads_use_known_hosts() {
        assert!(allowed_pack_download(
            "https://cdn.modrinth.com/data/project/file.jar"
        ));
        assert!(!allowed_pack_download(
            "https://cdn.modrinth.com.evil.example/file.jar"
        ));
        assert!(!allowed_pack_download(
            "file:///C:/Windows/System32/file.jar"
        ));
    }

    #[test]
    fn instance_engine_accepts_legacy_java_and_rejects_unknown_values() {
        let mut config = serde_json::json!({"id":"java","name":"Java","version":"26.3","directory":"game","java":"Automatic","memory":4096,"jvmArguments":"","mods":true,"resourcePacks":true,"shaderPacks":true,"config":true,"customResolution":false,"visible":true,"shortcut":false});
        assert!(serde_json::from_value::<InstanceConfig>(config.clone()).is_ok());
        config["engine"] = "java".into();
        assert!(serde_json::from_value::<InstanceConfig>(config.clone()).is_ok());
        config["engine"] = "retired".into();
        assert!(serde_json::from_value::<InstanceConfig>(config).is_err());
    }

    #[test]
    fn only_patches_selected_options() {
        let path = std::env::temp_dir().join(format!("bloom-options-{}.txt", std::process::id()));
        std::fs::write(&path, "music:0.5\nrenderDistance:8\ncustomSetting:keep\n").unwrap();
        patch_options(
            &path,
            &[
                ("renderDistance", "16".into()),
                ("simulationDistance", "10".into()),
            ],
        )
        .unwrap();
        let updated = std::fs::read_to_string(&path).unwrap();
        assert!(updated.contains("music:0.5"));
        assert!(updated.contains("customSetting:keep"));
        assert!(updated.contains("renderDistance:16"));
        assert!(updated.contains("simulationDistance:10"));
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod live_content_tests {
    use super::*;

    #[test]
    fn launcher_update_reservation_releases_only_its_own_activity() {
        let state = LauncherState::default();
        *state.launch_active.lock().unwrap() = true;
        assert!(reserve_update_activity(&state).is_err());
        assert!(*state.launch_active.lock().unwrap());
        *state.launch_active.lock().unwrap() = false;

        state.game_running.store(true, Ordering::SeqCst);
        assert!(reserve_update_activity(&state).is_err());
        state.game_running.store(false, Ordering::SeqCst);
        state.content_install_active.store(true, Ordering::SeqCst);
        assert!(reserve_update_activity(&state).is_err());
        state.content_install_active.store(false, Ordering::SeqCst);
        assert!(!*state.launch_active.lock().unwrap());

        let mut resources = tauri::ResourceTable::default();
        let id = resources.add(reserve_update_activity(&state).unwrap());
        assert!(*state.launch_active.lock().unwrap());
        assert!(reserve_update_activity(&state).is_err());
        assert!(resources.close(id.wrapping_add(1)).is_err());
        assert!(*state.launch_active.lock().unwrap());

        resources.close(id).unwrap();
        assert!(!*state.launch_active.lock().unwrap());
        let _next = reserve_update_activity(&state).unwrap();
        assert!(*state.launch_active.lock().unwrap());
    }

    #[test]
    fn running_game_allows_packs_but_not_mods() {
        assert!(validate_content_install_activity("resourcepacks", true, true).is_ok());
        assert!(validate_content_install_activity("shaderpacks", true, true).is_ok());
        assert!(validate_content_install_activity("mods", true, true).is_err());
        for category in ["mods", "resourcepacks", "shaderpacks"] {
            assert!(validate_content_install_activity(category, true, false).is_err());
            assert!(validate_content_install_activity(category, false, false).is_ok());
        }
    }

    #[test]
    fn cancelling_a_pack_download_does_not_cancel_minecraft() {
        let state = LauncherState::default();
        state.game_running.store(true, Ordering::SeqCst);
        state.content_install_active.store(true, Ordering::SeqCst);
        cancel_active_task(&state);
        assert!(state.content_cancel_requested.load(Ordering::SeqCst));
        assert!(!state.cancel_requested.load(Ordering::SeqCst));
        assert!(state.game_running.load(Ordering::SeqCst));
    }
}
