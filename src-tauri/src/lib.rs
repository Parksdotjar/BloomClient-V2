use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::{Emitter, Manager};

const BACKEND_URL: &str = match option_env!("BLOOM_BACKEND_URL") {
    Some(value) => value,
    None => "https://api.north.bloomclient.org/minecraft",
};
static DOWNLOAD_WORKERS: AtomicUsize = AtomicUsize::new(3);

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackendCapabilities {
    catalog: bool,
    modrinth: bool,
    curseforge: bool,
    modpacks: bool,
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

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogMod {
    provider: String,
    project_id: String,
    slug: String,
    title: String,
    summary: String,
    icon_url: Option<String>,
    author: String,
    downloads: u64,
    loader: String,
    game_version: String,
    version_id: String,
    version_number: String,
    file_name: String,
    file_size: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSearchResult {
    items: Vec<CatalogMod>,
    offset: u64,
    limit: u64,
    total: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogInstallFile {
    file_name: String,
    download_url: String,
    sha1: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogInstallPlan {
    title: String,
    files: Vec<CatalogInstallFile>,
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

#[derive(serde::Deserialize)]
struct ModrinthVersion {
    id: String,
    version_number: String,
    version_type: String,
    files: Vec<ModrinthFile>,
}

#[derive(serde::Deserialize)]
struct ModrinthFile {
    filename: String,
    url: String,
    size: u64,
    primary: bool,
    hashes: std::collections::HashMap<String, String>,
}

#[derive(serde::Deserialize)]
struct ModrinthProject {
    title: String,
}

fn catalog_category(category: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    match category {
        "mods" => Ok(("mod", "Fabric", "mods")),
        "resourcepacks" => Ok(("resourcepack", "Minecraft", "resourcepacks")),
        "shaderpacks" => Ok(("shader", "Shader", "shaderpacks")),
        _ => Err("Unsupported Modrinth content category.".into()),
    }
}

fn primary_modrinth_file(version: &ModrinthVersion) -> Option<&ModrinthFile> {
    version.files.iter().find(|file| file.primary).or_else(|| version.files.first())
}

async fn direct_modrinth_search(
    query: String,
    game_version: String,
    offset: u64,
    category: &str,
) -> Result<CatalogSearchResult, String> {
    use futures_util::future::join_all;

    let (project_type, loader_label, _) = catalog_category(category)?;
    let mut facets = vec![
        vec![format!("project_type:{project_type}")],
        vec![format!("versions:{game_version}")],
    ];
    if category == "mods" {
        facets.push(vec!["categories:fabric".to_string()]);
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("BloomClient/", env!("CARGO_PKG_VERSION"), " (support@bloomclient.org)"))
        .build()
        .map_err(|error| error.to_string())?;
    let result = client
        .get("https://api.modrinth.com/v2/search")
        .query(&[
            ("query", query.as_str()),
            ("facets", serde_json::to_string(&facets).map_err(|error| error.to_string())?.as_str()),
            ("index", if query.is_empty() { "downloads" } else { "relevance" }),
            ("limit", "20"),
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
                .get(format!("https://api.modrinth.com/v2/project/{}/version", hit.project_id))
                .query(&[("game_versions", game_versions.as_str()), ("include_changelog", "false")]);
            let loaders;
            if category == "mods" {
                loaders = serde_json::to_string(&["fabric"]).ok()?;
                request = request.query(&[("loaders", loaders.as_str())]);
            }
            let versions = request.send().await.ok()?.error_for_status().ok()?.json::<Vec<ModrinthVersion>>().await.ok()?;
            let version = versions.iter().find(|version| version.version_type == "release").or_else(|| versions.first())?;
            let file = primary_modrinth_file(version)?;
            Some(CatalogMod {
                provider: "modrinth".into(),
                project_id: hit.project_id,
                slug: hit.slug,
                title: hit.title,
                summary: hit.description,
                icon_url: hit.icon_url,
                author: hit.author,
                downloads: hit.downloads,
                loader: loader_label.into(),
                game_version: game_version.clone(),
                version_id: version.id.clone(),
                version_number: version.version_number.clone(),
                file_name: file.filename.clone(),
                file_size: file.size,
            })
        }
    });
    let items = join_all(requests).await.into_iter().flatten().collect();
    Ok(CatalogSearchResult { items, offset: result.offset, limit: result.limit, total: result.total_hits })
}

#[tauri::command]
async fn get_backend_status() -> Result<BackendStatus, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent(concat!("BloomClient/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{}/health", BACKEND_URL.trim_end_matches('/')))
        .send()
        .await
        .map_err(|error| format!("Bloom backend is unavailable: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Bloom backend rejected the health check: {error}"))?
        .json::<BackendStatus>()
        .await
        .map_err(|error| format!("Bloom backend returned an invalid response: {error}"))
}

#[tauri::command]
async fn search_modrinth_content(
    query: String,
    game_version: String,
    offset: u64,
    category: String,
) -> Result<CatalogSearchResult, String> {
    catalog_category(&category)?;
    if category != "mods" {
        return direct_modrinth_search(query, game_version, offset, &category).await;
    }
    reqwest::Client::builder()
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
        .map_err(|error| format!("The Bloom mod catalog is unavailable: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The Bloom mod catalog rejected the search: {error}"))?
        .json::<CatalogSearchResult>()
        .await
        .map_err(|error| format!("The Bloom mod catalog returned invalid data: {error}"))
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct MinecraftSession {
    username: String,
    uuid: String,
    access_token: String,
    refresh_token: String,
    client_id: String,
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
    session: Mutex<Option<MinecraftSession>>,
    launch_active: Arc<Mutex<bool>>,
    cancel_requested: Arc<AtomicBool>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LaunchProgress {
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
        instance_id: instance_id.to_string(),
        state: state.to_string(),
        progress,
        message: message.into(),
        downloaded_bytes: 0,
        total_bytes: 0,
        bytes_per_second: 0,
    };
    if let Ok(mut current) = current_launch().lock() {
        *current = payload.clone();
    }
    let _ = app.emit("minecraft-launch-progress", payload);
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
        instance_id: instance_id.to_string(),
        state: "installing".into(),
        progress,
        message,
        downloaded_bytes,
        total_bytes,
        bytes_per_second,
    };
    if let Ok(mut current) = current_launch().lock() {
        *current = payload.clone();
    }
    let _ = app.emit("minecraft-launch-progress", payload);
}

#[tauri::command]
fn get_minecraft_launch_status() -> LaunchProgress {
    current_launch()
        .lock()
        .map(|status| status.clone())
        .unwrap_or(LaunchProgress {
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
fn cancel_minecraft_launch(state: tauri::State<'_, LauncherState>) {
    state.cancel_requested.store(true, Ordering::SeqCst);
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
        .map_err(|error| format!("Windows could not prepare secure account storage: {error}"))?
        .set_password(chunk)
        .map_err(|error| format!("Windows could not save this account securely: {error}"))?;
    }
    keyring::Entry::new(
        "Bloom Client",
        &account_credential_part(uuid, &format!("{kind}-count")),
    )
    .map_err(|error| format!("Windows could not prepare secure account storage: {error}"))?
    .set_password(&chunks.len().to_string())
    .map_err(|error| format!("Windows could not save this account securely: {error}"))?;
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
    };
    keyring::Entry::new(
        "Bloom Client",
        &account_credential_part(&session.uuid, "profile"),
    )
    .map_err(|error| format!("Windows could not prepare secure account storage: {error}"))?
    .set_password(&serde_json::to_string(&profile).map_err(|error| error.to_string())?)
    .map_err(|error| format!("Windows could not save this account securely: {error}"))?;
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
                    "Windows could not remove the saved sign-in: {error}"
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
fn list_minecraft_accounts() -> Result<MinecraftAccountList, String> {
    let store = ensure_account_store()?;
    Ok(MinecraftAccountList {
        active_id: store.active_id,
        accounts: store.accounts,
    })
}

#[tauri::command]
fn sign_out_minecraft(
    state: tauri::State<'_, LauncherState>,
) -> Result<Option<serde_json::Value>, String> {
    let mut store = ensure_account_store()?;
    let Some(active_id) = store.active_id.clone() else {
        return Ok(None);
    };
    delete_account_credentials(&active_id)
        .map_err(|error| format!("Windows could not remove the saved account: {error}"))?;
    store.accounts.retain(|account| account.id != active_id);
    store.active_id = store.accounts.first().map(|account| account.id.clone());
    write_account_store(&store)?;
    let next = store.active_id.as_deref().and_then(load_account_session);
    *state
        .session
        .lock()
        .map_err(|_| "Unable to clear the Minecraft sign-in session.")? = next.clone();
    Ok(next.map(|session| serde_json::json!({ "id": session.uuid, "name": session.username })))
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Welcome to Bloom Client, {name}!")
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
fn get_saved_minecraft_profile(
    state: tauri::State<'_, LauncherState>,
) -> Option<serde_json::Value> {
    let session = state
        .session
        .lock()
        .ok()
        .and_then(|session| session.clone())
        .or_else(saved_session)?;
    Some(serde_json::json!({ "id": session.uuid, "name": session.username }))
}

#[derive(serde::Serialize)]
struct JavaInstallation {
    path: String,
    major_version: Option<u32>,
    usable: bool,
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
fn list_managed_java_runtimes() -> Vec<ManagedJavaRuntime> {
    managed_java_runtimes()
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
    Ok(())
}

fn adoptium_architecture() -> Result<&'static str, String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("x64"),
        "aarch64" => Ok("aarch64"),
        architecture => Err(format!(
            "Automatic Java installation is not available for {architecture} Windows yet."
        )),
    }
}

fn find_java_executable(folder: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut pending = vec![folder.to_path_buf()];
    while let Some(current) = pending.pop() {
        let entries = std::fs::read_dir(current).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("javaw.exe"))
            {
                return Some(path);
            }
        }
    }
    None
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
        .user_agent("BloomClient/1.0 (https://bloomclient.org)")
        .build()
        .map_err(|error| error.to_string())?;
    let mut package = None;
    for image in ["jre", "jdk"] {
        let url = format!("https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={architecture}&heap_size=normal&image_type={image}&jvm_impl=hotspot&os=windows&project=jdk&vendor=eclipse");
        let assets: serde_json::Value = client
            .get(url)
            .send()
            .map_err(|error| format!("Java provider could not be reached: {error}"))?
            .error_for_status()
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
    let package = package.ok_or_else(|| format!("No supported Windows Java {major} runtime is currently available from Eclipse Adoptium."))?;
    let url = package["link"]
        .as_str()
        .ok_or("The Java provider response did not include a download link.")?;
    let expected = package["checksum"]
        .as_str()
        .ok_or("The Java provider response did not include a SHA-256 checksum.")?
        .to_ascii_lowercase();
    let total = package["size"].as_u64().unwrap_or(0);
    let archive = root.join(format!("temurin-{major}-{architecture}.zip"));
    let partial = archive.with_extension("zip.part");
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
    let file = std::fs::File::open(&archive).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|error| format!("Java archive could not be opened: {error}"))?;
    for index in 0..zip.len() {
        if cancel.load(Ordering::SeqCst) {
            let _ = std::fs::remove_dir_all(&staging);
            return Err("__cancelled__".into());
        }
        let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
        let relative = entry
            .enclosed_name()
            .ok_or("The Java archive contained an unsafe path.")?;
        let target = staging.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut file = std::fs::File::create(target).map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut file).map_err(|error| error.to_string())?;
        }
    }
    let staged_java = find_java_executable(&staging)
        .ok_or("The installed Java package did not contain javaw.exe.")?;
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
    Ok(java)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsHardware {
    cpu: String,
    cores: u32,
    threads: u32,
    ram_bytes: u64,
    gpus: Vec<String>,
    refresh_rate: Option<u32>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HardwareReport {
    cpu: String,
    cores: u32,
    threads: u32,
    ram_bytes: u64,
    gpus: Vec<String>,
    refresh_rate: Option<u32>,
    java_versions: Vec<u32>,
    recommended_memory_mb: u32,
    recommended_render_distance: u32,
    recommended_simulation_distance: u32,
    recommended_graphics: String,
}

#[tauri::command]
fn detect_hardware_report() -> Result<HardwareReport, String> {
    let script = r#"$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; $system=Get-CimInstance Win32_ComputerSystem; $video=@(Get-CimInstance Win32_VideoController); [pscustomobject]@{cpu=[string]$cpu.Name;cores=[uint32]$cpu.NumberOfCores;threads=[uint32]$cpu.NumberOfLogicalProcessors;ramBytes=[uint64]$system.TotalPhysicalMemory;gpus=@($video | ForEach-Object {[string]$_.Name});refreshRate=[uint32](($video | Measure-Object CurrentRefreshRate -Maximum).Maximum)} | ConvertTo-Json -Compress"#;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|error| format!("Hardware scan could not start: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Hardware scan failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let hardware: WindowsHardware = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Hardware scan returned invalid data: {error}"))?;
    let ram_gb = hardware.ram_bytes / 1_073_741_824;
    let recommended_memory_mb = match ram_gb {
        0..=7 => 2048,
        8..=15 => 4096,
        16..=31 => 6144,
        _ => 8192,
    };
    let has_dedicated_gpu = hardware.gpus.iter().any(|gpu| {
        let name = gpu.to_ascii_lowercase();
        name.contains("nvidia") || name.contains("radeon") || name.contains("arc")
    });
    let recommended_render_distance = if has_dedicated_gpu && hardware.cores >= 8 {
        16
    } else if hardware.cores >= 6 {
        12
    } else {
        8
    };
    let recommended_simulation_distance = if hardware.cores >= 8 {
        10
    } else if hardware.cores >= 6 {
        8
    } else {
        6
    };
    let mut java_versions = detect_java_installations()
        .into_iter()
        .filter(|java| java.usable)
        .filter_map(|java| java.major_version)
        .collect::<Vec<_>>();
    java_versions.sort_unstable();
    java_versions.dedup();
    Ok(HardwareReport {
        cpu: hardware.cpu.trim().to_string(),
        cores: hardware.cores,
        threads: hardware.threads,
        ram_bytes: hardware.ram_bytes,
        gpus: hardware.gpus,
        refresh_rate: hardware.refresh_rate,
        java_versions,
        recommended_memory_mb,
        recommended_render_distance,
        recommended_simulation_distance,
        recommended_graphics: if has_dedicated_gpu && ram_gb >= 16 {
            "High".into()
        } else {
            "Balanced".into()
        },
    })
}

#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstanceConfig {
    id: String,
    name: String,
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

#[derive(serde::Serialize)]
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
    let appdata = std::env::var("APPDATA")
        .map_err(|_| "APPDATA is unavailable on this computer.".to_string())?;
    let path = std::path::PathBuf::from(appdata).join("BloomClient");
    std::fs::create_dir_all(path.join("instances")).map_err(|error| error.to_string())?;
    Ok(path)
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LockerSkin {
    id: String,
    name: String,
    created_at: u64,
    #[serde(default)]
    data_url: String,
}

fn skins_directory() -> Result<std::path::PathBuf, String> {
    let directory = bloom_data_dir()?.join("skins");
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn skins_index_path() -> Result<std::path::PathBuf, String> {
    Ok(skins_directory()?.join("skins.json"))
}

fn read_skin_index() -> Vec<LockerSkin> {
    skins_index_path()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn valid_skin_png(bytes: &[u8]) -> bool {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return false;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap_or_default());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap_or_default());
    width >= 64 && width <= 1024 && width % 64 == 0 && (height == width || height * 2 == width)
}

#[tauri::command]
fn list_locker_skins() -> Result<Vec<LockerSkin>, String> {
    use base64::Engine;
    let directory = skins_directory()?;
    let mut skins = read_skin_index();
    skins.retain(|skin| directory.join(format!("{}.png", skin.id)).is_file());
    for skin in &mut skins {
        let bytes = std::fs::read(directory.join(format!("{}.png", skin.id)))
            .map_err(|error| error.to_string())?;
        skin.data_url = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
    }
    skins.sort_by_key(|skin| std::cmp::Reverse(skin.created_at));
    Ok(skins)
}

#[tauri::command]
fn save_locker_skin(name: String, bytes: Vec<u8>) -> Result<LockerSkin, String> {
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("Skin files must be smaller than 4 MB.".into());
    }
    if !valid_skin_png(&bytes) {
        return Err("Choose a valid 64×64 or 64×32 Minecraft PNG skin.".into());
    }
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64;
    let id = format!("skin-{created_at}");
    let clean_name = name.trim().trim_end_matches(".png").trim();
    let skin = LockerSkin {
        id: id.clone(),
        name: if clean_name.is_empty() {
            "Custom Skin".into()
        } else {
            clean_name.chars().take(48).collect()
        },
        created_at,
        data_url: String::new(),
    };
    let directory = skins_directory()?;
    let temporary = directory.join(format!("{id}.png.part"));
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, directory.join(format!("{id}.png")))
        .map_err(|error| error.to_string())?;
    let mut index = read_skin_index();
    index.push(skin.clone());
    std::fs::write(
        skins_index_path()?,
        serde_json::to_vec_pretty(&index).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    list_locker_skins()?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or("Bloom saved the skin but could not reload it.".into())
}

#[tauri::command]
fn open_skins_folder() -> Result<(), String> {
    std::process::Command::new("explorer.exe")
        .arg(skins_directory()?)
        .spawn()
        .map_err(|error| format!("The skins folder could not be opened: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn apply_locker_skin(
    state: tauri::State<'_, LauncherState>,
    skin_id: String,
    variant: String,
) -> Result<serde_json::Value, String> {
    if !matches!(variant.as_str(), "classic" | "slim") {
        return Err("Skin model must be Classic or Slim.".into());
    }
    let skin = read_skin_index()
        .into_iter()
        .find(|item| item.id == skin_id)
        .ok_or("That skin is no longer in your locker.")?;
    let bytes = std::fs::read(skins_directory()?.join(format!("{}.png", skin.id)))
        .map_err(|error| format!("Bloom could not read that skin: {error}"))?;
    if !valid_skin_png(&bytes) {
        return Err("That skin file is not a valid Minecraft skin PNG.".into());
    }
    let stored = state
        .session
        .lock()
        .map_err(|_| "Bloom could not read the active Minecraft account.")?
        .clone()
        .or_else(saved_session)
        .ok_or("Sign in with Microsoft before applying a skin.")?;
    let session = refresh_minecraft_session(&stored)
        .await
        .map_err(|error| format!("Your selected Microsoft account needs to reconnect: {error}"))?;
    let file = reqwest::multipart::Part::bytes(bytes)
        .file_name(format!("{}.png", skin.name))
        .mime_str("image/png")
        .map_err(|error| format!("Bloom could not prepare the skin upload: {error}"))?;
    let form = reqwest::multipart::Form::new()
        .text("variant", variant)
        .part("file", file);
    let response = reqwest::Client::new()
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(&session.access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Minecraft skin upload could not start: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let details = response.text().await.unwrap_or_default();
        return Err(if details.is_empty() {
            format!("Minecraft rejected the skin upload ({status}).")
        } else {
            format!("Minecraft rejected the skin upload ({status}): {details}")
        });
    }
    save_account_session(&session, true)?;
    *state
        .session
        .lock()
        .map_err(|_| "Bloom could not save the refreshed Minecraft account.")? = Some(session.clone());
    Ok(serde_json::json!({ "id": session.uuid, "name": session.username }))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutoTuneProfile {
    target_fps: u32,
    memory_mb: u32,
    jvm_profile: String,
    graphics: String,
    render_distance: u32,
    simulation_distance: u32,
    average_fps: f64,
    one_percent_low: f64,
    low_ratio: f64,
    confidence: String,
    benchmark_completed_at: u64,
    #[serde(default)]
    reasons: Vec<serde_json::Value>,
}

fn saved_autotune_profile() -> Option<AutoTuneProfile> {
    let path = bloom_data_dir().ok()?.join("autotune-profile.json");
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn autotune_jvm_arguments(profile: &str) -> String {
    if profile.eq_ignore_ascii_case("performance") {
        "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:+DisableExplicitGC -XX:MaxGCPauseMillis=50"
            .into()
    } else {
        String::new()
    }
}

fn patch_options(path: &std::path::Path, updates: &[(&str, String)]) -> Result<(), String> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
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

fn apply_autotune_to_config(
    config: &mut InstanceConfig,
    profile: &AutoTuneProfile,
) -> Result<(), String> {
    config.memory = profile.memory_mb.clamp(1024, 16384);
    config.jvm_arguments = autotune_jvm_arguments(&profile.jvm_profile);
    let preset = match profile.graphics.to_ascii_lowercase().as_str() {
        "fast" => "fast",
        "high" => "fabulous",
        _ => "fancy",
    };
    let (
        ao,
        blend,
        updates,
        particles,
        mipmaps,
        shadows,
        entity_scale,
        blur,
        cloud_range,
        leaves,
        transparency,
        weather,
        anisotropy,
        filtering,
    ) = match preset {
        "fast" => (
            "false", "1", "0", "1", "2", "false", "0.75", "2", "32", "false", "false", "5", "1",
            "0",
        ),
        "fabulous" => (
            "true", "2", "1", "0", "4", "true", "1.25", "5", "128", "true", "true", "10", "2", "2",
        ),
        _ => (
            "true", "2", "1", "0", "4", "true", "1.0", "5", "64", "true", "false", "10", "1", "1",
        ),
    };
    let (clouds, vignette, chunk_fade) = match preset {
        "fast" => ("\"fast\"", "false", "0.0"),
        "fabulous" => ("\"true\"", "true", "0.75"),
        _ => ("\"true\"", "true", "0.5"),
    };
    patch_options(
        &std::path::PathBuf::from(&config.directory).join("options.txt"),
        &[
            ("graphicsPreset", format!("\"{preset}\"")),
            ("maxFps", "260".into()),
            ("enableVsync", "false".into()),
            ("fullscreen", "true".into()),
            ("exclusiveFullscreen", "false".into()),
            ("ao", ao.into()),
            ("biomeBlendRadius", blend.into()),
            ("prioritizeChunkUpdates", updates.into()),
            ("particles", particles.into()),
            ("mipmapLevels", mipmaps.into()),
            ("entityShadows", shadows.into()),
            ("entityDistanceScaling", entity_scale.into()),
            ("menuBackgroundBlurriness", blur.into()),
            ("cloudRange", cloud_range.into()),
            ("cutoutLeaves", leaves.into()),
            ("improvedTransparency", transparency.into()),
            ("weatherRadius", weather.into()),
            ("maxAnisotropyBit", anisotropy.into()),
            ("textureFiltering", filtering.into()),
            ("renderClouds", clouds.into()),
            ("vignette", vignette.into()),
            ("chunkSectionFadeInTime", chunk_fade.into()),
            (
                "renderDistance",
                profile.render_distance.clamp(2, 32).to_string(),
            ),
            (
                "simulationDistance",
                profile.simulation_distance.clamp(5, 32).to_string(),
            ),
        ],
    )
}

#[tauri::command]
fn apply_autotune_profile(profile: AutoTuneProfile) -> Result<usize, String> {
    let data = bloom_data_dir()?;
    std::fs::write(
        data.join("autotune-profile.json"),
        serde_json::to_vec_pretty(&profile).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let folder = data.join("instances");
    let mut applied = 0;
    for entry in std::fs::read_dir(folder)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(mut config) = serde_json::from_slice::<InstanceConfig>(
            &std::fs::read(entry.path()).unwrap_or_default(),
        ) else {
            continue;
        };
        if !config.visible || config.id == AUTOTUNE_INSTANCE_ID {
            continue;
        }
        apply_autotune_to_config(&mut config, &profile)?;
        write_instance(&config)?;
        applied += 1;
    }
    Ok(applied)
}

fn java_major(path: &str) -> Option<u32> {
    let output = std::process::Command::new(path)
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

#[tauri::command]
fn detect_java_installations() -> Vec<JavaInstallation> {
    let mut candidates: Vec<String> = Vec::new();
    let managed = managed_java_runtimes();
    let known_managed = managed
        .iter()
        .map(|runtime| (runtime.java_path.clone(), runtime.major_version))
        .collect::<std::collections::HashMap<_, _>>();
    candidates.extend(managed.into_iter().map(|runtime| runtime.java_path));
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
    candidates.sort();
    candidates.dedup();
    candidates
        .into_iter()
        .map(|path| {
            let major_version = known_managed
                .get(&path)
                .copied()
                .or_else(|| java_major(&path));
            JavaInstallation {
                path,
                usable: major_version.is_some(),
                major_version,
            }
        })
        .collect()
}

#[tauri::command]
async fn get_minecraft_releases() -> Result<Vec<serde_json::Value>, String> {
    let manifest: serde_json::Value =
        reqwest::get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
            .await
            .map_err(|error| error.to_string())?
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

#[tauri::command]
fn save_instance(config: InstanceConfig) -> Result<InstanceConfig, String> {
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
    if config.id.is_empty() {
        return Err("Choose an instance name containing letters or numbers.".into());
    }
    let game_dir = if config.directory.starts_with(".minecraft") {
        std::env::var("APPDATA")
            .map_err(|_| "APPDATA is unavailable.".to_string())?
            .into()
    } else {
        std::path::PathBuf::from(&config.directory)
    };
    let mut target = if config.directory.starts_with(".minecraft") {
        game_dir.join(&config.directory)
    } else {
        game_dir.join(&config.id)
    };
    if target
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("instances"))
        .unwrap_or(false)
    {
        target = target.join(&config.id);
    }
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
    if config.visible {
        if let Some(profile) = saved_autotune_profile() {
            apply_autotune_to_config(&mut config, &profile)?;
        }
    }
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
fn list_instances() -> Result<Vec<InstanceConfig>, String> {
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

fn content_folder(config: &InstanceConfig, category: &str) -> Result<std::path::PathBuf, String> {
    let folder = match category {
        "mods" => "mods",
        "resourcepacks" => "resourcepacks",
        "shaderpacks" => "shaderpacks",
        _ => return Err("Unsupported instance content category.".into()),
    };
    let path = std::path::PathBuf::from(&config.directory).join(folder);
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
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

#[tauri::command]
fn list_instance_content(
    instance_id: String,
    category: String,
) -> Result<Vec<InstanceContentItem>, String> {
    use std::io::Read;
    let config = load_instance(&instance_id)?;
    let folder = content_folder(&config, &category)?;
    let mut items = Vec::new();
    for entry in std::fs::read_dir(folder)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().to_string();
        let enabled = !file_name.to_ascii_lowercase().ends_with(".disabled");
        let visible_name = file_name.strip_suffix(".disabled").unwrap_or(&file_name);
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
                            .and_then(|mut file| file.read_to_string(&mut text).ok())
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
        items.push(InstanceContentItem {
            id: file_name.clone(),
            name,
            version,
            file_name,
            size: entry.metadata().map(|value| value.len()).unwrap_or(0),
            enabled,
            icon,
        });
    }
    items.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
    });
    Ok(items)
}

#[tauri::command]
fn toggle_instance_content(
    instance_id: String,
    category: String,
    file_name: String,
    enabled: bool,
) -> Result<(), String> {
    if std::path::Path::new(&file_name)
        .file_name()
        .and_then(|name| name.to_str())
        != Some(file_name.as_str())
    {
        return Err("Invalid content filename.".into());
    }
    let folder = content_folder(&load_instance(&instance_id)?, &category)?;
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
        file_name.clone()
    } else {
        format!("{file_name}.disabled")
    };
    if target_name != file_name {
        std::fs::rename(source, folder.join(target_name)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_instance_icon(instance_id: String, icon: String) -> Result<InstanceConfig, String> {
    if !icon.starts_with("data:image/") || icon.len() > 4_000_000 {
        return Err("Choose a PNG or JPEG image smaller than about 3 MB.".into());
    }
    let mut config = load_instance(&instance_id)?;
    config.icon = Some(icon);
    write_instance(&config)?;
    Ok(config)
}

#[tauri::command]
fn update_instance_settings(
    instance_id: String,
    name: String,
    memory: u32,
    jvm_arguments: String,
) -> Result<InstanceConfig, String> {
    if name.trim().is_empty() {
        return Err("Instance name cannot be empty.".into());
    }
    if !(1024..=16384).contains(&memory) {
        return Err("Memory must be between 1024 MB and 16384 MB.".into());
    }
    let mut config = load_instance(&instance_id)?;
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
    let target = target.canonicalize().map_err(|error| {
        format!("Bloom could not resolve this instance folder: {error}")
    })?;

    tauri_plugin_opener::open_path(&target, None::<&str>).map_err(|error| {
        format!("Bloom could not open this instance folder: {error}")
    })
}

#[tauri::command]
fn import_instance_mod_files(instance_id: String, paths: Vec<String>) -> Result<Vec<String>, String> {
    if paths.is_empty() { return Err("Drop one or more Fabric mod JAR files.".into()); }
    let config = load_instance(&instance_id)?;
    if !config.loader.eq_ignore_ascii_case("fabric") { return Err("Drag-and-drop mod installation currently supports Fabric instances only.".into()); }
    let mods = content_folder(&config, "mods")?;
    std::fs::create_dir_all(&mods).map_err(|error| error.to_string())?;
    let mut imported = Vec::new();
    for raw in paths {
        let source = std::path::PathBuf::from(raw);
        if !source.is_file() || !source.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("jar")).unwrap_or(false) { return Err("Only .jar mod files can be dropped into Mods.".into()); }
        let file = std::fs::File::open(&source).map_err(|error| format!("Could not read {}: {error}", source.display()))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|_| format!("{} is not a valid mod JAR.", source.display()))?;
        if archive.by_name("fabric.mod.json").is_err() { return Err(format!("{} is not a Fabric mod.", source.file_name().and_then(|value| value.to_str()).unwrap_or("That file"))); }
        let name = source.file_name().and_then(|value| value.to_str()).ok_or("A dropped mod has an invalid filename.")?.to_string();
        let destination = mods.join(&name);
        if source.canonicalize().ok() != destination.canonicalize().ok() {
            let temporary = mods.join(format!(".{name}.bloom-import"));
            std::fs::copy(&source, &temporary).map_err(|error| format!("Could not import {name}: {error}"))?;
            if destination.exists() { std::fs::remove_file(&destination).map_err(|error| format!("Could not replace {name}: {error}"))?; }
            std::fs::rename(&temporary, &destination).map_err(|error| format!("Could not finish importing {name}: {error}"))?;
        }
        imported.push(name);
    }
    Ok(imported)
}

#[tauri::command]
fn open_game_folder() -> Result<(), String> {
    let target = bloom_data_dir()?.join("minecraft");
    std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    std::process::Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

const AUTOTUNE_INSTANCE_ID: &str = "bloom-autotune-benchmark";
const AUTOTUNE_VERSION: &str = "26.2";
const AUTOTUNE_FABRIC_LOADER: &str = "0.19.3";
const AUTOTUNE_FABRIC_API: &str = "0.154.0+26.2";
const AUTOTUNE_MOD: &[u8] = include_bytes!("../resources/bloom-autotune-benchmark-26.2.jar");

fn write_autotune_options(game_directory: &std::path::Path) -> Result<(), String> {
    let options = concat!(
        "version:4903\n",
        "enableVsync:false\n",
        "fullscreen:true\n",
        "maxFps:260\n",
        "narrator:0\n",
        "narratorHotkey:false\n",
        "onboardAccessibility:false\n",
        "soundCategory_master:0.0\n",
        "soundCategory_music:0.0\n",
        "soundCategory_record:0.0\n",
        "soundCategory_weather:0.0\n",
        "soundCategory_block:0.0\n",
        "soundCategory_hostile:0.0\n",
        "soundCategory_neutral:0.0\n",
        "soundCategory_player:0.0\n",
        "soundCategory_ambient:0.0\n",
        "soundCategory_voice:0.0\n",
        "soundCategory_ui:0.0\n",
    );
    std::fs::write(game_directory.join("options.txt"), options).map_err(|error| error.to_string())
}

#[tauri::command]
fn install_autotune_benchmark(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
) -> Result<String, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA is unavailable.")?;
    let game_directory = std::path::PathBuf::from(appdata)
        .join(".minecraft")
        .join("instances")
        .join(AUTOTUNE_INSTANCE_ID);
    let config = InstanceConfig {
        id: AUTOTUNE_INSTANCE_ID.into(),
        name: "Bloom AutoTune Benchmark".into(),
        icon: None,
        loader: "Fabric".into(),
        loader_version: Some(AUTOTUNE_FABRIC_LOADER.into()),
        version: AUTOTUNE_VERSION.into(),
        directory: game_directory.to_string_lossy().to_string(),
        java: "Automatic (Recommended)".into(),
        memory: 4096,
        jvm_arguments: String::new(),
        mods: true,
        resource_packs: false,
        shader_packs: false,
        config: true,
        custom_resolution: false,
        visible: false,
        shortcut: false,
    };
    write_instance(&config)?;
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
    let instance_id = AUTOTUNE_INSTANCE_ID.to_string();
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            emit_launch(
                &app,
                &instance_id,
                "installing",
                1,
                "Preparing the private AutoTune instance",
            );
            if game_directory.exists() {
                std::fs::remove_dir_all(&game_directory).map_err(|error| error.to_string())?;
            }
            let mods = game_directory.join("mods");
            std::fs::create_dir_all(&mods).map_err(|error| error.to_string())?;
            std::fs::write(game_directory.join(".bloom-autotune-managed"), b"managed")
                .map_err(|error| error.to_string())?;
            write_autotune_options(&game_directory)?;
            std::fs::write(mods.join("bloom-autotune-benchmark-26.2.jar"), AUTOTUNE_MOD)
                .map_err(|error| error.to_string())?;
            let mut plan = mc_launcher_core::net::download::DownloadPlan::default();
            plan.tasks.push(mc_launcher_core::net::download::DownloadTask {
                url: format!("https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/{0}/fabric-api-{0}.jar", AUTOTUNE_FABRIC_API),
                destination: mods.join(format!("fabric-api-{AUTOTUNE_FABRIC_API}.jar")), checksum: None,
                label: "Downloading Fabric API".into(),
            });
            execute_download_plan(
                &app,
                &instance_id,
                &plan,
                &cancel,
                2,
                18,
                "Downloading Fabric API",
                false,
            )?;
            let shared = bloom_data_dir()?.join("minecraft");
            install_instance_files(&app, &instance_id, &config, &shared, &cancel, 19, 99)?;
            Ok(())
        })();
        match result {
            Ok(()) => emit_launch(
                &app,
                &instance_id,
                "complete",
                100,
                "AutoTune benchmark installed",
            ),
            Err(error) if error == "__cancelled__" => emit_launch(
                &app,
                &instance_id,
                "cancelled",
                0,
                "Benchmark installation cancelled",
            ),
            Err(error) => emit_launch(&app, &instance_id, "error", 0, error),
        }
        if let Ok(mut value) = active.lock() {
            *value = false;
        }
    });
    Ok(AUTOTUNE_INSTANCE_ID.into())
}

#[tauri::command]
fn get_autotune_benchmark_result() -> Result<Option<serde_json::Value>, String> {
    let config = load_instance(AUTOTUNE_INSTANCE_ID)?;
    let path = std::path::PathBuf::from(config.directory).join("bloom-benchmark-result.json");
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("Benchmark result is invalid: {error}"))
}

#[tauri::command]
fn get_autotune_benchmark_status() -> Result<Option<serde_json::Value>, String> {
    let config = load_instance(AUTOTUNE_INSTANCE_ID)?;
    let path = std::path::PathBuf::from(config.directory).join("bloom-benchmark-status.json");
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("Benchmark status is invalid: {error}"))
}

fn safe_pack_path(raw: &str) -> Result<std::path::PathBuf, String> {
    use std::path::Component;
    let path = std::path::Path::new(raw);
    if path.is_absolute()
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

#[tauri::command]
fn import_fabric_modpack(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
) -> Result<Option<String>, String> {
    use std::io::Read;
    let Some(pack_path) = rfd::FileDialog::new()
        .add_filter("Fabric Modrinth pack", &["mrpack", "zip"])
        .pick_file()
    else {
        return Ok(None);
    };
    let file = std::fs::File::open(&pack_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "Choose a valid .mrpack or ZIP containing modrinth.index.json.".to_string())?;
    let mut index_text = String::new();
    archive.by_name("modrinth.index.json").map_err(|_| "This ZIP is not a Modrinth modpack. Bloom currently imports Fabric Modrinth packs only.".to_string())?.read_to_string(&mut index_text).map_err(|error| error.to_string())?;
    let index: serde_json::Value = serde_json::from_str(&index_text)
        .map_err(|_| "The modrinth.index.json file is invalid.".to_string())?;
    if index["game"] != "minecraft" {
        return Err("Bloom only imports Minecraft modpacks.".into());
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
        std::path::PathBuf::from(std::env::var("APPDATA").map_err(|_| "APPDATA is unavailable.")?)
            .join(".minecraft")
            .join("instances")
            .join(&id);
    let mut config = InstanceConfig {
        id: id.clone(),
        name,
        icon: None,
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
    if let Some(profile) = saved_autotune_profile() {
        apply_autotune_to_config(&mut config, &profile)?;
    }
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
        let result = (|| -> Result<(), String> {
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
            let shared = bloom_data_dir()?.join("minecraft");
            install_instance_files(
                &app_for_task,
                &id_for_task,
                &config,
                &shared,
                &cancel,
                61,
                99,
            )?;
            Ok(())
        })();
        match result {
            Ok(()) => emit_launch(
                &app_for_task,
                &id_for_task,
                "complete",
                100,
                "Fabric modpack imported",
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
    Ok(Some(id))
}

fn install_fabric_api(config: &InstanceConfig) -> Result<(), String> {
    let mods = std::path::PathBuf::from(&config.directory).join("mods");
    std::fs::create_dir_all(&mods).map_err(|error| error.to_string())?;
    let destination = mods.join("fabric-api-bloom.jar");
    if destination.exists() {
        return Ok(());
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent("BloomClient/0.1.0 (https://bloomclient.org)")
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
    use std::io::{Read, Write};
    let client = reqwest::blocking::Client::builder()
        .user_agent("BloomClient/0.1.0 (https://bloomclient.org)")
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
                            emit_download(
                                app,
                                instance_id,
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
                            emit_download(
                                app,
                                instance_id,
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
            emit_download(
                app,
                instance_id,
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
            emit_download(
                app,
                instance_id,
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

#[tauri::command]
fn install_modrinth_content(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
    project_id: String,
    category: String,
) -> Result<(), String> {
    let config = load_instance(&instance_id)?;
    let (_, content_label, destination_folder) = catalog_category(&category)?;
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
    let category_for_task = category.clone();
    std::thread::spawn(move || {
        emit_launch(
            &app,
            &instance_id,
            "installing",
            1,
            format!("Resolving Modrinth {}", content_label.to_lowercase()),
        );
        let result = (|| -> Result<String, String> {
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .user_agent(concat!("BloomClient/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|error| error.to_string())?;
            let plan: CatalogInstallPlan = if category_for_task == "mods" {
                client
                    .get(format!(
                        "{}/v1/catalog/modrinth/{}/install",
                        BACKEND_URL.trim_end_matches('/'),
                        project_id
                    ))
                    .query(&[("gameVersion", config.version.as_str())])
                    .send()
                    .map_err(|error| format!("Unable to resolve the Modrinth file: {error}"))?
                    .error_for_status()
                    .map_err(|error| format!("Modrinth could not provide a compatible file: {error}"))?
                    .json()
                    .map_err(|error| format!("The mod install plan is invalid: {error}"))?
            } else {
                let versions: Vec<ModrinthVersion> = client
                    .get(format!("https://api.modrinth.com/v2/project/{}/version", project_id))
                    .query(&[("game_versions", serde_json::to_string(&[config.version.as_str()]).map_err(|error| error.to_string())?), ("include_changelog", "false".into())])
                    .send()
                    .map_err(|error| format!("Unable to resolve the Modrinth file: {error}"))?
                    .error_for_status()
                    .map_err(|error| format!("Modrinth could not provide compatible content: {error}"))?
                    .json()
                    .map_err(|error| format!("The Modrinth version response is invalid: {error}"))?;
                let version = versions.iter().find(|version| version.version_type == "release").or_else(|| versions.first()).ok_or_else(|| format!("No compatible {content_label} exists for Minecraft {}.", config.version))?;
                let file = primary_modrinth_file(version).ok_or_else(|| format!("The selected {content_label} has no downloadable file."))?;
                let project: ModrinthProject = client
                    .get(format!("https://api.modrinth.com/v2/project/{}", project_id))
                    .send()
                    .map_err(|error| format!("Unable to load the Modrinth project: {error}"))?
                    .error_for_status()
                    .map_err(|error| format!("Modrinth rejected the project request: {error}"))?
                    .json()
                    .map_err(|error| format!("The Modrinth project response is invalid: {error}"))?;
                CatalogInstallPlan {
                    title: project.title,
                    files: vec![CatalogInstallFile { file_name: file.filename.clone(), download_url: file.url.clone(), sha1: file.hashes.get("sha1").cloned() }],
                }
            };
            if plan.files.is_empty() {
                return Err(format!("The selected {content_label} has no compatible files to install."));
            }
            let destination = std::path::PathBuf::from(&config.directory).join(destination_folder);
            std::fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
            let mut downloads = mc_launcher_core::net::download::DownloadPlan::default();
            for file in plan.files {
                if std::path::Path::new(&file.file_name)
                    .file_name()
                    .and_then(|name| name.to_str())
                    != Some(file.file_name.as_str())
                {
                    return Err(format!("Modrinth returned an unsafe {content_label} filename."));
                }
                if !allowed_pack_download(&file.download_url) {
                    return Err("Modrinth returned an untrusted download address.".into());
                }
                downloads
                    .tasks
                    .push(mc_launcher_core::net::download::DownloadTask {
                        url: file.download_url,
                        destination: destination.join(&file.file_name),
                        checksum: file
                            .sha1
                            .map(mc_launcher_core::net::download::Checksum::Sha1),
                        label: file.file_name,
                    });
            }
            execute_download_plan(
                &app,
                &instance_id,
                &downloads,
                &cancel,
                3,
                99,
                &format!("Installing {}", plan.title),
                false,
            )?;
            Ok(plan.title)
        })();
        match result {
            Ok(title) => emit_launch(
                &app,
                &instance_id,
                "complete",
                100,
                format!("Installed {title}"),
            ),
            Err(error) if error == "__cancelled__" => emit_launch(
                &app,
                &instance_id,
                "cancelled",
                0,
                format!("{content_label} installation cancelled"),
            ),
            Err(error) => emit_launch(&app, &instance_id, "error", 0, error),
        }
        if let Ok(mut value) = active.lock() {
            *value = false;
        }
    });
    Ok(())
}

fn install_instance_files(
    app: &tauri::AppHandle,
    instance_id: &str,
    config: &InstanceConfig,
    minecraft_dir: &std::path::Path,
    cancel: &AtomicBool,
    range_start: u8,
    range_end: u8,
) -> Result<String, String> {
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
        let loader_version = if let Some(version) = config.loader_version.as_deref() {
            version.to_string()
        } else {
            let loaders = mc_launcher_core::loader::fabric::list_loader_versions()
                .map_err(|error| error.to_string())?;
            mc_launcher_core::loader::fabric::latest_stable_loader(&loaders)
                .map_err(|error| error.to_string())?
                .version
                .clone()
        };
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
        mc_launcher_core::install::natives::extract_natives(
            &merged.libraries,
            minecraft_dir,
            &version_id,
        )
        .map_err(|error| error.to_string())?;
        if !instance_has_fabric_api(config) {
            emit_launch(
                app,
                instance_id,
                "installing",
                scale(94),
                "Installing Fabric API",
            );
            install_fabric_api(config)?;
        }
    } else {
        mc_launcher_core::install::natives::extract_natives(
            &vanilla.libraries,
            minecraft_dir,
            &version_id,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(version_id)
}

fn selected_java(
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
        let javaw = path.with_file_name("javaw.exe");
        return Ok(if javaw.is_file() { javaw } else { path });
    }
    if let Some(java) = detect_java_installations()
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
        let javaw = path.with_file_name("javaw.exe");
        return Ok(if javaw.is_file() { javaw } else { path });
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
) -> Result<(), String> {
    if !matches!(download_workers, 1 | 3 | 5) {
        return Err("Download workers must be 1, 3, or 5.".into());
    }
    DOWNLOAD_WORKERS.store(download_workers as usize, Ordering::Relaxed);
    {
        let mut active = state
            .launch_active
            .lock()
            .map_err(|_| "The launcher is busy. Try again.")?;
        if *active {
            return Err("Something is already downloading or running. Please wait.".into());
        }
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
    let session = refresh_minecraft_session(&stored_session)
        .await
        .map_err(|error| {
            if let Ok(mut active) = state.launch_active.lock() {
                *active = false;
            }
            format!("The selected Microsoft account needs to reconnect: {error}")
        })?;
    save_account_session(&session, true).map_err(|error| {
        if let Ok(mut active) = state.launch_active.lock() {
            *active = false;
        }
        error
    })?;
    *state
        .session
        .lock()
        .map_err(|_| "Unable to refresh the active account.")? = Some(session.clone());
    let active = Arc::new(state.launch_active.clone());
    let cancel_requested = state.cancel_requested.clone();
    std::thread::spawn(move || {
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
        let installed_version = match install_instance_files(
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
                emit_launch(&app, &instance_id, "cancelled", 0, "Download cancelled");
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
        let result = (|| -> Result<(), String> {
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
                launcher_name: "Bloom Client".into(),
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
            args.insert(main_index, format!("-Xmx{}M", config.memory));
            for argument in config.jvm_arguments.split_whitespace().rev() {
                args.insert(main_index, argument.to_string());
            }
            let mut process = std::process::Command::new(command.executable);
            process
                .args(args)
                .current_dir(command.working_dir)
                .envs(command.env)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            let mut child = process
                .spawn()
                .map_err(|error| format!("Minecraft could not start: {error}"))?;
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
            loop {
                if cancel_requested.load(Ordering::SeqCst) {
                    let _ = child.kill();
                    return Err("Minecraft launch was cancelled.".into());
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
                    if line.contains("Loading ") && line.contains(" mods") {
                        emit_launch(&app, &instance_id, "launching", 97, "Loading Fabric mods");
                    } else if line.contains("Backend library") || line.contains("LWJGL Version") {
                        emit_launch(
                            &app,
                            &instance_id,
                            "launching",
                            98,
                            "Initializing game renderer",
                        );
                    } else if line.contains("Reloading ResourceManager") {
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
                        emit_launch(&app, &instance_id, "running", 100, "Minecraft is ready");
                    }
                }
                if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                    if !ready && !status.success() {
                        return Err(format!(
                            "Minecraft exited before opening (exit code {}).",
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
            Ok(()) => emit_launch(&app, &instance_id, "idle", 0, "Minecraft closed"),
            Err(error) => emit_launch(&app, &instance_id, "error", 0, error),
        }
        if let Ok(mut value) = active.lock() {
            *value = false;
        }
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
                install_instance_files(&app, &instance_id, &config, &shared, &cancel, 1, 100)
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
    tauri::Builder::default()
        .manage(LauncherState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };
            let show = MenuItem::with_id(app, "show", "Show Bloom Client", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Bloom Client", true, None::<&str>)?;
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
            get_backend_status,
            search_modrinth_content,
            request_microsoft_device_code,
            complete_microsoft_login,
            detect_java_installations,
            list_managed_java_runtimes,
            remove_managed_java_runtime,
            list_locker_skins,
            save_locker_skin,
            open_skins_folder,
            apply_locker_skin,
            detect_hardware_report,
            apply_autotune_profile,
            get_minecraft_releases,
            save_instance,
            list_instances,
            list_instance_content,
            toggle_instance_content,
            set_instance_icon,
            update_instance_settings,
            open_instance_folder,
            import_instance_mod_files,
            open_game_folder,
            install_autotune_benchmark,
            get_autotune_benchmark_result,
            get_autotune_benchmark_status,
            import_fabric_modpack,
            install_modrinth_content,
            launch_minecraft,
            choose_game_directory,
            exit_application,
            get_minecraft_launch_status,
            cancel_minecraft_launch,
            repair_minecraft_installation,
            sign_out_minecraft,
            get_saved_minecraft_profile,
            list_minecraft_accounts,
            switch_minecraft_account
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bloom Client");
}

#[cfg(test)]
mod tests {
    use super::{
        account_credential_name, allowed_pack_download, patch_options, safe_pack_path,
        split_credential_secret, valid_skin_png,
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
    fn locker_accepts_minecraft_png_dimensions_only() {
        let mut standard = vec![0; 24];
        standard[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        standard[16..20].copy_from_slice(&64u32.to_be_bytes());
        standard[20..24].copy_from_slice(&64u32.to_be_bytes());
        assert!(valid_skin_png(&standard));
        standard[16..20].copy_from_slice(&65u32.to_be_bytes());
        assert!(!valid_skin_png(&standard));
    }

    #[test]
    fn modpack_paths_stay_inside_the_instance() {
        assert!(safe_pack_path("mods/example.jar").is_ok());
        assert!(safe_pack_path("../outside.jar").is_err());
        assert!(safe_pack_path("C:\\outside.jar").is_err());
        assert!(safe_pack_path("/outside.jar").is_err());
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
    fn autotune_only_patches_selected_options() {
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
