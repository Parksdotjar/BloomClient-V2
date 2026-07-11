use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tauri::Emitter;

const BACKEND_URL: &str = match option_env!("BLOOM_BACKEND_URL") {
    Some(value) => value,
    None => "https://api.north.bloomclient.org/minecraft",
};

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
async fn search_modrinth_mods(
    query: String,
    game_version: String,
    offset: u64,
) -> Result<CatalogSearchResult, String> {
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

fn saved_session() -> Option<MinecraftSession> {
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

fn save_session(session: &MinecraftSession) -> Result<(), String> {
    let profile = serde_json::json!({ "username": session.username, "uuid": session.uuid, "clientId": session.client_id }).to_string();
    for (name, value) in [
        ("minecraft-profile", profile.as_str()),
        ("minecraft-access-token", session.access_token.as_str()),
        ("microsoft-refresh-token", session.refresh_token.as_str()),
    ] {
        let entry = keyring::Entry::new("Bloom Client", name).map_err(|error| {
            format!("Windows could not prepare secure account storage: {error}")
        })?;
        entry
            .set_password(value)
            .map_err(|error| format!("Windows could not save your sign-in securely: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn sign_out_minecraft(state: tauri::State<'_, LauncherState>) -> Result<(), String> {
    *state
        .session
        .lock()
        .map_err(|_| "Unable to clear the Minecraft sign-in session.")? = None;
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
    let xbl_response = client.post("https://user.auth.xboxlive.com/user/authenticate").json(&serde_json::json!({"Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket":format!("d={access_token}")},"RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"})).send().await.map_err(|error| error.to_string())?;
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
    if profile.get("id").and_then(|v| v.as_str()).is_none()
        || profile.get("name").and_then(|v| v.as_str()).is_none()
    {
        return Err("No Minecraft profile was found on this account.".into());
    }
    let username = profile["name"].as_str().unwrap_or_default().to_string();
    let uuid = profile["id"].as_str().unwrap_or_default().to_string();
    let session = MinecraftSession {
        username,
        uuid,
        access_token: minecraft_token.to_string(),
        refresh_token,
        client_id,
    };
    save_session(&session)?;
    *state
        .session
        .lock()
        .map_err(|_| "Unable to save the Minecraft sign-in session.")? = Some(session);
    Ok(profile)
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
            let major_version = java_major(&path);
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
        game_dir
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
    std::process::Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
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
fn install_modrinth_mod(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
    project_id: String,
) -> Result<(), String> {
    let config = load_instance(&instance_id)?;
    if !config.loader.eq_ignore_ascii_case("fabric") {
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
    std::thread::spawn(move || {
        emit_launch(
            &app,
            &instance_id,
            "installing",
            1,
            "Resolving Modrinth mod",
        );
        let result = (|| -> Result<String, String> {
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .user_agent(concat!("BloomClient/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|error| error.to_string())?;
            let plan: CatalogInstallPlan = client
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
                .map_err(|error| format!("The mod install plan is invalid: {error}"))?;
            if plan.files.is_empty() {
                return Err("The selected mod has no compatible files to install.".into());
            }
            let mods = std::path::PathBuf::from(&config.directory).join("mods");
            std::fs::create_dir_all(&mods).map_err(|error| error.to_string())?;
            let mut downloads = mc_launcher_core::net::download::DownloadPlan::default();
            for file in plan.files {
                if std::path::Path::new(&file.file_name)
                    .file_name()
                    .and_then(|name| name.to_str())
                    != Some(file.file_name.as_str())
                {
                    return Err("Modrinth returned an unsafe mod filename.".into());
                }
                if !allowed_pack_download(&file.download_url) {
                    return Err("Modrinth returned an untrusted download address.".into());
                }
                downloads
                    .tasks
                    .push(mc_launcher_core::net::download::DownloadTask {
                        url: file.download_url,
                        destination: mods.join(&file.file_name),
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
                "Mod installation cancelled",
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

fn selected_java(config: &InstanceConfig, required: u32) -> Result<std::path::PathBuf, String> {
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
        return Ok(configured_path.into());
    }
    detect_java_installations().into_iter()
        .filter(|java| java.usable && java.major_version.unwrap_or(0) >= required)
        .max_by_key(|java| java.major_version.unwrap_or(0))
        .map(|java| java.path.into())
        .ok_or_else(|| format!("Minecraft {} needs Java {required} or newer. Install that Java version, then launch again.", config.version))
}

#[tauri::command]
async fn launch_minecraft(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
) -> Result<(), String> {
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
    let session = state
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
            100,
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
            let java = selected_java(&config, required_java)?;
            emit_launch(
                &app,
                &instance_id,
                "launching",
                94,
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
                    emit_game_log(&app, &instance_id, &stream, line.clone());
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
        .invoke_handler(tauri::generate_handler![
            greet,
            get_backend_status,
            search_modrinth_mods,
            request_microsoft_device_code,
            complete_microsoft_login,
            detect_java_installations,
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
            open_game_folder,
            install_autotune_benchmark,
            get_autotune_benchmark_result,
            get_autotune_benchmark_status,
            import_fabric_modpack,
            install_modrinth_mod,
            launch_minecraft,
            get_minecraft_launch_status,
            cancel_minecraft_launch,
            repair_minecraft_installation,
            sign_out_minecraft,
            get_saved_minecraft_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bloom Client");
}

#[cfg(test)]
mod tests {
    use super::{allowed_pack_download, patch_options, safe_pack_path};

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
