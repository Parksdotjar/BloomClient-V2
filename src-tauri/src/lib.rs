use std::sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}};
use tauri::Emitter;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct MinecraftSession { username: String, uuid: String, access_token: String, refresh_token: String, client_id: String }

#[derive(Default)]
struct LauncherState { session: Mutex<Option<MinecraftSession>>, launch_active: Arc<Mutex<bool>>, cancel_requested: Arc<AtomicBool> }

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LaunchProgress { instance_id: String, state: String, progress: u8, message: String, downloaded_bytes: u64, total_bytes: u64, bytes_per_second: u64 }

static CURRENT_LAUNCH: OnceLock<Mutex<LaunchProgress>> = OnceLock::new();

fn current_launch() -> &'static Mutex<LaunchProgress> {
    CURRENT_LAUNCH.get_or_init(|| Mutex::new(LaunchProgress { instance_id: String::new(), state: "idle".into(), progress: 0, message: String::new(), downloaded_bytes: 0, total_bytes: 0, bytes_per_second: 0 }))
}

fn emit_launch(app: &tauri::AppHandle, instance_id: &str, state: &str, progress: u8, message: impl Into<String>) {
    let payload = LaunchProgress { instance_id: instance_id.to_string(), state: state.to_string(), progress, message: message.into(), downloaded_bytes: 0, total_bytes: 0, bytes_per_second: 0 };
    if let Ok(mut current) = current_launch().lock() { *current = payload.clone(); }
    let _ = app.emit("minecraft-launch-progress", payload);
}

fn emit_download(app: &tauri::AppHandle, instance_id: &str, progress: u8, message: String, downloaded_bytes: u64, total_bytes: u64, bytes_per_second: u64) {
    let payload = LaunchProgress { instance_id: instance_id.to_string(), state: "installing".into(), progress, message, downloaded_bytes, total_bytes, bytes_per_second };
    if let Ok(mut current) = current_launch().lock() { *current = payload.clone(); }
    let _ = app.emit("minecraft-launch-progress", payload);
}

#[tauri::command]
fn get_minecraft_launch_status() -> LaunchProgress { current_launch().lock().map(|status| status.clone()).unwrap_or(LaunchProgress { instance_id: String::new(), state: "idle".into(), progress: 0, message: String::new(), downloaded_bytes: 0, total_bytes: 0, bytes_per_second: 0 }) }

#[tauri::command]
fn cancel_minecraft_launch(state: tauri::State<'_, LauncherState>) { state.cancel_requested.store(true, Ordering::SeqCst); }

fn saved_session() -> Option<MinecraftSession> {
    let profile_entry = keyring::Entry::new("Bloom Client", "minecraft-profile").ok()?;
    let profile: serde_json::Value = serde_json::from_str(&profile_entry.get_password().ok()?).ok()?;
    let access_token = keyring::Entry::new("Bloom Client", "minecraft-access-token").ok()?.get_password().ok()?;
    let refresh_token = keyring::Entry::new("Bloom Client", "microsoft-refresh-token").ok().and_then(|entry| entry.get_password().ok()).unwrap_or_default();
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
    for (name, value) in [("minecraft-profile", profile.as_str()), ("minecraft-access-token", session.access_token.as_str()), ("microsoft-refresh-token", session.refresh_token.as_str())] {
        let entry = keyring::Entry::new("Bloom Client", name).map_err(|error| format!("Windows could not prepare secure account storage: {error}"))?;
        entry.set_password(value).map_err(|error| format!("Windows could not save your sign-in securely: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn sign_out_minecraft(state: tauri::State<'_, LauncherState>) -> Result<(), String> {
    *state.session.lock().map_err(|_| "Unable to clear the Minecraft sign-in session.")? = None;
    for name in ["minecraft-profile", "minecraft-access-token", "microsoft-refresh-token", "minecraft-session"] {
        let entry = keyring::Entry::new("Bloom Client", name).map_err(|error| error.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(format!("Windows could not remove the saved sign-in: {error}")),
        }
    }
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String { format!("Welcome to Bloom Client, {name}!") }

#[tauri::command]
async fn request_microsoft_device_code(client_id: String) -> Result<serde_json::Value, String> {
    let response = reqwest::Client::new()
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
        .form(&[("client_id", client_id), ("scope", "XboxLive.signin offline_access".to_string())])
        .send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let body: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
    if !status.is_success() { return Err(body.get("error_description").and_then(|v| v.as_str()).unwrap_or("Microsoft device authorization failed.").to_string()); }
    Ok(body)
}

async fn read_auth_response(response: reqwest::Response, service: &str) -> Result<serde_json::Value, String> {
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    let body: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({ "raw": text }));
    if !status.is_success() {
        let detail = body.get("Message").or_else(|| body.get("error_description")).or_else(|| body.get("error")).and_then(|value| value.as_str()).unwrap_or("No additional details.");
        return Err(format!("{service} rejected the account (HTTP {status}): {detail}"));
    }
    Ok(body)
}

#[tauri::command]
async fn complete_microsoft_login(state: tauri::State<'_, LauncherState>, client_id: String, device_code: String, interval: u64, expires_in: u64) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(expires_in);
    let mut wait_seconds = interval.max(5);
    let tokens = loop {
        if std::time::Instant::now() >= deadline { return Err("The Microsoft sign-in code expired.".into()); }
        tokio::time::sleep(std::time::Duration::from_secs(wait_seconds)).await;
        let response = client.post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token").form(&[("client_id", client_id.clone()), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code".into()), ("device_code", device_code.clone())]).send().await.map_err(|error| error.to_string())?;
        let body: serde_json::Value = response.json().await.map_err(|error| error.to_string())?;
        if body.get("access_token").and_then(|v| v.as_str()).is_some() { break body; }
        match body.get("error").and_then(|v| v.as_str()) { Some("authorization_pending") => continue, Some("slow_down") => { wait_seconds += 5; continue; }, _ => return Err(body.get("error_description").and_then(|v| v.as_str()).unwrap_or("Microsoft sign-in failed.").to_string()) }
    };
    let access_token = tokens["access_token"].as_str().ok_or("Microsoft did not return an access token.")?.to_string();
    let refresh_token = tokens["refresh_token"].as_str().unwrap_or_default().to_string();
    let xbl_response = client.post("https://user.auth.xboxlive.com/user/authenticate").json(&serde_json::json!({"Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket":format!("d={access_token}")},"RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"})).send().await.map_err(|error| error.to_string())?;
    let xbl = read_auth_response(xbl_response, "Xbox Live").await?;
    let xsts_response = client.post("https://xsts.auth.xboxlive.com/xsts/authorize").json(&serde_json::json!({"Properties":{"SandboxId":"RETAIL","UserTokens":[xbl["Token"]]},"RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"})).send().await.map_err(|error| error.to_string())?;
    let xsts = read_auth_response(xsts_response, "Xbox security").await?;
    let identity = xsts["DisplayClaims"]["xui"][0]["uhs"].as_str().ok_or("Xbox authentication did not return a user identity.")?;
    let xsts_token = xsts["Token"].as_str().ok_or("Xbox authentication did not return an XSTS token.")?;
    let minecraft_response = client.post("https://api.minecraftservices.com/authentication/login_with_xbox").json(&serde_json::json!({"identityToken":format!("XBL3.0 x={identity};{xsts_token}")})).send().await.map_err(|error| error.to_string())?;
    let minecraft = read_auth_response(minecraft_response, "Minecraft services").await?;
    let minecraft_token = minecraft["access_token"].as_str().ok_or("Minecraft services login failed. Make sure this Microsoft account owns Minecraft.")?;
    let profile_response = client.get("https://api.minecraftservices.com/minecraft/profile").bearer_auth(minecraft_token).send().await.map_err(|error| error.to_string())?;
    let profile = read_auth_response(profile_response, "Minecraft profile").await?;
    if profile.get("id").and_then(|v| v.as_str()).is_none() || profile.get("name").and_then(|v| v.as_str()).is_none() { return Err("No Minecraft profile was found on this account.".into()); }
    let username = profile["name"].as_str().unwrap_or_default().to_string();
    let uuid = profile["id"].as_str().unwrap_or_default().to_string();
    let session = MinecraftSession { username, uuid, access_token: minecraft_token.to_string(), refresh_token, client_id };
    save_session(&session)?;
    *state.session.lock().map_err(|_| "Unable to save the Minecraft sign-in session.")? = Some(session);
    Ok(profile)
}

#[tauri::command]
fn get_saved_minecraft_profile(state: tauri::State<'_, LauncherState>) -> Option<serde_json::Value> {
    let session = state.session.lock().ok().and_then(|session| session.clone()).or_else(saved_session)?;
    Some(serde_json::json!({ "id": session.uuid, "name": session.username }))
}

#[derive(serde::Serialize)]
struct JavaInstallation { path: String, major_version: Option<u32>, usable: bool }

#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstanceConfig {
    id: String, name: String, #[serde(default = "default_loader")] loader: String, version: String, directory: String, java: String, memory: u32,
    jvm_arguments: String, mods: bool, resource_packs: bool, shader_packs: bool, config: bool,
    custom_resolution: bool, visible: bool, shortcut: bool,
}

fn default_loader() -> String { "Vanilla".to_string() }

fn bloom_data_dir() -> Result<std::path::PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA is unavailable on this computer.".to_string())?;
    let path = std::path::PathBuf::from(appdata).join("BloomClient");
    std::fs::create_dir_all(path.join("instances")).map_err(|error| error.to_string())?;
    Ok(path)
}

fn java_major(path: &str) -> Option<u32> {
    let output = std::process::Command::new(path).arg("-version").output().ok()?;
    let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    let quoted = text.split('"').nth(1)?;
    let first = quoted.split('.').next()?;
    if first == "1" { quoted.split('.').nth(1)?.parse().ok() } else { first.parse().ok() }
}

#[tauri::command]
fn detect_java_installations() -> Vec<JavaInstallation> {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(path) = std::env::var("PATH") { for entry in std::env::split_paths(&path) { let java = entry.join("java.exe"); if java.exists() { candidates.push(java.to_string_lossy().to_string()); } } }
    for root in ["ProgramFiles", "ProgramFiles(x86)"] { if let Ok(base) = std::env::var(root) { for folder in ["Java", "Eclipse Adoptium", "Microsoft"] { let parent = std::path::PathBuf::from(&base).join(folder); if let Ok(entries) = std::fs::read_dir(parent) { for entry in entries.flatten() { let java = entry.path().join("bin").join("java.exe"); if java.exists() { candidates.push(java.to_string_lossy().to_string()); } } } } } }
    candidates.sort(); candidates.dedup();
    candidates.into_iter().map(|path| { let major_version = java_major(&path); JavaInstallation { path, usable: major_version.is_some(), major_version } }).collect()
}

#[tauri::command]
async fn get_minecraft_releases() -> Result<Vec<serde_json::Value>, String> {
    let manifest: serde_json::Value = reqwest::get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json").await.map_err(|error| error.to_string())?.json().await.map_err(|error| error.to_string())?;
    Ok(manifest["versions"].as_array().unwrap_or(&Vec::new()).iter().filter(|version| version["type"] == "release").cloned().collect())
}

#[tauri::command]
fn save_instance(config: InstanceConfig) -> Result<InstanceConfig, String> {
    if config.name.trim().is_empty() { return Err("Choose an instance name first.".into()); }
    let mut config = config;
    config.id = config.name.to_lowercase().chars().map(|character| if character.is_ascii_alphanumeric() { character } else { '-' }).collect::<String>().trim_matches('-').to_string();
    if config.id.is_empty() { return Err("Choose an instance name containing letters or numbers.".into()); }
    let game_dir = if config.directory.starts_with(".minecraft") { std::env::var("APPDATA").map_err(|_| "APPDATA is unavailable.".to_string())?.into() } else { std::path::PathBuf::from(&config.directory) };
    let mut target = if config.directory.starts_with(".minecraft") { game_dir.join(&config.directory) } else { game_dir };
    if target.file_name().and_then(|name| name.to_str()).map(|name| name.eq_ignore_ascii_case("instances")).unwrap_or(false) { target = target.join(&config.id); }
    std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    for (enabled, folder) in [(config.mods || config.loader.eq_ignore_ascii_case("fabric"), "mods"), (config.resource_packs, "resourcepacks"), (config.shader_packs, "shaderpacks"), (config.config, "config")] { if enabled { std::fs::create_dir_all(target.join(folder)).map_err(|error| error.to_string())?; } }
    config.directory = target.to_string_lossy().to_string();
    let path = bloom_data_dir()?.join("instances").join(format!("{}.json", config.id));
    std::fs::write(path, serde_json::to_vec_pretty(&config).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    Ok(config)
}

#[tauri::command]
fn list_instances() -> Result<Vec<InstanceConfig>, String> {
    let folder = bloom_data_dir()?.join("instances");
    let mut instances = Vec::new();
    for entry in std::fs::read_dir(folder).map_err(|error| error.to_string())?.flatten() { if entry.path().extension().and_then(|extension| extension.to_str()) == Some("json") { if let Ok(bytes) = std::fs::read(entry.path()) { if let Ok(instance) = serde_json::from_slice(&bytes) { instances.push(instance); } } } }
    Ok(instances)
}

fn load_instance(instance_id: &str) -> Result<InstanceConfig, String> {
    let path = bloom_data_dir()?.join("instances").join(format!("{instance_id}.json"));
    let bytes = std::fs::read(path).map_err(|_| "This instance could not be found. Create it again and try once more.".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "This instance configuration is invalid.".to_string())
}

fn install_fabric_api(config: &InstanceConfig) -> Result<(), String> {
    let mods = std::path::PathBuf::from(&config.directory).join("mods");
    std::fs::create_dir_all(&mods).map_err(|error| error.to_string())?;
    let destination = mods.join("fabric-api-bloom.jar");
    if destination.exists() { return Ok(()); }
    let client = reqwest::blocking::Client::builder().user_agent("BloomClient/0.1.0 (https://bloomclient.org)").build().map_err(|error| error.to_string())?;
    let loaders = serde_json::to_string(&["fabric"]).map_err(|error| error.to_string())?;
    let game_versions = serde_json::to_string(&[config.version.as_str()]).map_err(|error| error.to_string())?;
    let versions: serde_json::Value = client.get("https://api.modrinth.com/v2/project/fabric-api/version").query(&[("loaders", loaders), ("game_versions", game_versions), ("include_changelog", "false".to_string())]).send().map_err(|error| format!("Fabric API version lookup failed: {error}"))?.error_for_status().map_err(|error| format!("Fabric API version lookup failed: {error}"))?.json().map_err(|error| error.to_string())?;
    let version = versions.as_array().and_then(|items| items.iter().find(|item| item["version_type"] == "release").or_else(|| items.first())).ok_or_else(|| format!("Fabric API does not currently provide a build for Minecraft {}.", config.version))?;
    let file = version["files"].as_array().and_then(|files| files.iter().find(|file| file["primary"] == true).or_else(|| files.first())).ok_or("Fabric API metadata did not include a downloadable file.")?;
    let url = file["url"].as_str().ok_or("Fabric API metadata did not include a download URL.")?;
    let bytes = client.get(url).send().map_err(|error| format!("Fabric API download failed: {error}"))?.error_for_status().map_err(|error| format!("Fabric API download failed: {error}"))?.bytes().map_err(|error| error.to_string())?;
    let temporary = mods.join("fabric-api-bloom.jar.part");
    std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;
    Ok(())
}

fn execute_download_plan(app: &tauri::AppHandle, instance_id: &str, plan: &mc_launcher_core::net::download::DownloadPlan, cancel: &AtomicBool, start: u8, end: u8, stage: &str, assets: bool) -> Result<(), String> {
    use std::io::{Read, Write};
    let client = reqwest::blocking::Client::builder().user_agent("BloomClient/0.1.0 (https://bloomclient.org)").build().map_err(|error| error.to_string())?;
    let total_tasks = plan.tasks.len().max(1) as f64;
    for (index, task) in plan.tasks.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) { return Err("__cancelled__".into()); }
        if mc_launcher_core::net::download::should_skip_existing(task).map_err(|error| error.to_string())? {
            let progress = start as f64 + ((index + 1) as f64 / total_tasks) * (end - start) as f64;
            emit_download(app, instance_id, progress.round() as u8, if assets { "Loading assets".into() } else { stage.into() }, 0, 0, 0);
            continue;
        }
        if let Some(parent) = task.destination.parent() { std::fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
        let mut response = client.get(&task.url).send().map_err(|error| format!("Download failed for {}: {error}", task.label))?.error_for_status().map_err(|error| format!("Download failed for {}: {error}", task.label))?;
        let total_bytes = response.content_length().unwrap_or(0);
        let temporary = task.destination.with_extension("bloom-part");
        let mut file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
        let mut buffer = [0u8; 65536];
        let mut received = 0u64;
        let mut sample_bytes = 0u64;
        let mut sample_time = std::time::Instant::now();
        loop {
            if cancel.load(Ordering::SeqCst) { let _ = std::fs::remove_file(&temporary); return Err("__cancelled__".into()); }
            let count = response.read(&mut buffer).map_err(|error| error.to_string())?;
            if count == 0 { break; }
            file.write_all(&buffer[..count]).map_err(|error| error.to_string())?;
            received += count as u64;
            let elapsed = sample_time.elapsed().as_secs_f64();
            let speed = if elapsed >= 0.2 { let value = ((received - sample_bytes) as f64 / elapsed) as u64; sample_bytes = received; sample_time = std::time::Instant::now(); value } else { 0 };
            let file_fraction = if total_bytes > 0 { received as f64 / total_bytes as f64 } else { 0.0 };
            let overall = start as f64 + ((index as f64 + file_fraction) / total_tasks) * (end - start) as f64;
            emit_download(app, instance_id, overall.round() as u8, if assets { "Loading assets".into() } else { stage.into() }, received, total_bytes, speed);
        }
        drop(file);
        if let Some(mc_launcher_core::net::download::Checksum::Sha1(expected)) = &task.checksum {
            let actual = mc_launcher_core::io::hash::sha1_file(&temporary).map_err(|error| error.to_string())?; if &actual != expected { let _ = std::fs::remove_file(&temporary); return Err(format!("Checksum verification failed for {}.", task.label)); }
        }
        if task.destination.exists() { std::fs::remove_file(&task.destination).map_err(|error| error.to_string())?; }
        std::fs::rename(&temporary, &task.destination).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn install_instance_files(app: &tauri::AppHandle, instance_id: &str, config: &InstanceConfig, minecraft_dir: &std::path::Path, cancel: &AtomicBool) -> Result<String, String> {
    emit_launch(app, instance_id, "installing", 2, "Checking Minecraft version");
    let vanilla = mc_launcher_core::install::client::fetch_vanilla_version(&config.version).map_err(|error| error.to_string())?;
    mc_launcher_core::install::client::write_version_json(minecraft_dir, &vanilla).map_err(|error| error.to_string())?;
    let base_plan = mc_launcher_core::install::vanilla::plan_vanilla_downloads(&vanilla, minecraft_dir).map_err(|error| error.to_string())?;
    execute_download_plan(app, instance_id, &base_plan, cancel, 4, 35, "Downloading Minecraft libraries", false)?;
    if let Some(index) = &vanilla.asset_index {
        let path = mc_launcher_core::install::assets::asset_index_path(minecraft_dir, &index.id);
        let data: mc_launcher_core::install::assets::AssetIndexJson = serde_json::from_slice(&std::fs::read(path).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        let assets = mc_launcher_core::install::assets::plan_asset_object_downloads_from_index(&data, minecraft_dir);
        execute_download_plan(app, instance_id, &assets, cancel, 35, 88, "Loading assets", true)?;
    }
    let mut version_id = config.version.clone();
    if config.loader.eq_ignore_ascii_case("fabric") {
        emit_launch(app, instance_id, "installing", 89, "Resolving Fabric Loader");
        let loaders = mc_launcher_core::loader::fabric::list_loader_versions().map_err(|error| error.to_string())?;
        let loader = mc_launcher_core::loader::fabric::latest_stable_loader(&loaders).map_err(|error| error.to_string())?;
        let profile = mc_launcher_core::loader::fabric::fetch_profile(&config.version, &loader.version).map_err(|error| error.to_string())?;
        version_id = profile.id.clone().ok_or("Fabric did not return a launch profile ID.")?;
        mc_launcher_core::install::loader::write_loader_profile(minecraft_dir, &profile).map_err(|error| error.to_string())?;
        let launcher = mc_launcher_core::launcher::Launcher::new(minecraft_dir);
        let merged = launcher.load_version(&version_id).map_err(|error| error.to_string())?;
        let mut loader_plan = mc_launcher_core::install::vanilla::plan_vanilla_downloads(&merged, minecraft_dir).map_err(|error| error.to_string())?;
        for library in &merged.libraries {
            if library.downloads.is_some() { continue; }
            let Some(repository) = library.url.as_deref() else { continue; };
            let coordinate = mc_launcher_core::core::maven::MavenCoordinate::parse(&library.name).map_err(|error| error.to_string())?;
            let path = coordinate.artifact_path();
            let relative = path.to_string_lossy().replace('\\', "/");
            loader_plan.tasks.push(mc_launcher_core::net::download::DownloadTask { url: format!("{}/{}", repository.trim_end_matches('/'), relative), destination: minecraft_dir.join("libraries").join(path), checksum: None, label: library.name.clone() });
        }
        execute_download_plan(app, instance_id, &loader_plan, cancel, 89, 94, "Installing Fabric Loader", false)?;
        mc_launcher_core::install::natives::extract_natives(&merged.libraries, minecraft_dir, &version_id).map_err(|error| error.to_string())?;
        emit_launch(app, instance_id, "installing", 94, "Installing Fabric API");
        install_fabric_api(config)?;
    } else {
        mc_launcher_core::install::natives::extract_natives(&vanilla.libraries, minecraft_dir, &version_id).map_err(|error| error.to_string())?;
    }
    Ok(version_id)
}

fn selected_java(config: &InstanceConfig, required: u32) -> Result<std::path::PathBuf, String> {
    if !config.java.to_ascii_lowercase().starts_with("automatic") && !config.java.trim().is_empty() {
        let configured_path = config.java.rsplit_once(" — ").map(|(_, path)| path).unwrap_or(&config.java);
        let found = java_major(configured_path).ok_or("The Java runtime selected for this instance cannot be used.")?;
        if found < required { return Err(format!("Minecraft {} needs Java {required} or newer, but this instance is set to Java {found}.", config.version)); }
        return Ok(configured_path.into());
    }
    detect_java_installations().into_iter()
        .filter(|java| java.usable && java.major_version.unwrap_or(0) >= required)
        .max_by_key(|java| java.major_version.unwrap_or(0))
        .map(|java| java.path.into())
        .ok_or_else(|| format!("Minecraft {} needs Java {required} or newer. Install that Java version, then launch again.", config.version))
}

#[tauri::command]
async fn launch_minecraft(app: tauri::AppHandle, state: tauri::State<'_, LauncherState>, instance_id: String) -> Result<(), String> {
    {
        let mut active = state.launch_active.lock().map_err(|_| "The launcher is busy. Try again.")?;
        if *active { return Err("Something is already downloading or running. Please wait.".into()); }
        *active = true;
    }
    state.cancel_requested.store(false, Ordering::SeqCst);
    let session = state.session.lock().map_err(|_| "Unable to read the Minecraft sign-in session.")?.clone().or_else(saved_session)
        .ok_or_else(|| { if let Ok(mut active) = state.launch_active.lock() { *active = false; } "Sign in with Microsoft before launching Minecraft.".to_string() })?;
    let active = Arc::new(state.launch_active.clone());
    let cancel_requested = state.cancel_requested.clone();
    std::thread::spawn(move || {
        let config = match load_instance(&instance_id) { Ok(config) => config, Err(error) => { emit_launch(&app, &instance_id, "error", 0, error); if let Ok(mut value) = active.lock() { *value = false; } return; } };
        emit_launch(&app, &instance_id, "installing", 2, "Preparing Minecraft files");
        let shared_minecraft = match bloom_data_dir() { Ok(path) => path.join("minecraft"), Err(error) => { emit_launch(&app, &instance_id, "error", 0, error); if let Ok(mut value) = active.lock() { *value = false; } return; } };
        let launcher = mc_launcher_core::launcher::Launcher::new(&shared_minecraft);
        let installed_version = match install_instance_files(&app, &instance_id, &config, &shared_minecraft, &cancel_requested) {
            Ok(version) => version,
            Err(error) if error == "__cancelled__" => { emit_launch(&app, &instance_id, "cancelled", 0, "Download cancelled"); if let Ok(mut value) = active.lock() { *value = false; } return; }
            Err(error) => { emit_launch(&app, &instance_id, "error", 0, format!("Minecraft installation failed: {error}")); if let Ok(mut value) = active.lock() { *value = false; } return; }
        };
        let result = (|| -> Result<(), String> {
            let version = launcher.load_version(&installed_version).map_err(|error| format!("Minecraft metadata could not be loaded: {error}"))?;
            let required_java = version.java_version.as_ref().map(|value| value.major_version.max(8) as u32).unwrap_or(8);
            let java = selected_java(&config, required_java)?;
            emit_launch(&app, &instance_id, "launching", 94, format!("Launching with Java {required_java}"));
            let account = mc_launcher_core::account::Account::Microsoft { username: session.username.clone(), uuid: session.uuid.clone(), access_token: session.access_token.clone() };
            let options = mc_launcher_core::command::builder::LaunchOptions { account, java_executable: Some(java), game_directory: Some(config.directory.clone().into()), launcher_name: "Bloom Client".into(), launcher_version: env!("CARGO_PKG_VERSION").into(), custom_resolution: if config.custom_resolution { Some((1280, 720)) } else { None }, ..Default::default() };
            let command = launcher.build_launch_command_from_version(&version, options).map_err(|error| format!("Minecraft launch command could not be built: {error}"))?;
            let main_index = command.args.iter().position(|arg| version.main_class.as_deref() == Some(arg.as_str())).ok_or("Minecraft launch metadata did not include a main class.")?;
            let mut args = command.args;
            args.insert(main_index, format!("-Xmx{}M", config.memory));
            for argument in config.jvm_arguments.split_whitespace().rev() { args.insert(main_index, argument.to_string()); }
            let mut process = std::process::Command::new(command.executable);
            process.args(args).current_dir(command.working_dir).envs(command.env).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
            let mut child = process.spawn().map_err(|error| format!("Minecraft could not start: {error}"))?;
            emit_launch(&app, &instance_id, "launching", 96, "Starting Minecraft process");
            let (log_sender, log_receiver) = std::sync::mpsc::channel::<String>();
            if let Some(stdout) = child.stdout.take() { let sender = log_sender.clone(); std::thread::spawn(move || { use std::io::BufRead; for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) { let _ = sender.send(line); } }); }
            if let Some(stderr) = child.stderr.take() { let sender = log_sender.clone(); std::thread::spawn(move || { use std::io::BufRead; for line in std::io::BufReader::new(stderr).lines().map_while(Result::ok) { let _ = sender.send(line); } }); }
            drop(log_sender);
            let mut ready = false;
            loop {
                if cancel_requested.load(Ordering::SeqCst) { let _ = child.kill(); return Err("Minecraft launch was cancelled.".into()); }
                while let Ok(line) = log_receiver.try_recv() {
                    if line.contains("Loading ") && line.contains(" mods") { emit_launch(&app, &instance_id, "launching", 97, "Loading Fabric mods"); }
                    else if line.contains("Backend library") || line.contains("LWJGL Version") { emit_launch(&app, &instance_id, "launching", 98, "Initializing game renderer"); }
                    else if line.contains("Reloading ResourceManager") { emit_launch(&app, &instance_id, "launching", 99, "Loading game resources"); }
                    if !ready && (line.contains("OpenAL initialized") || line.contains("Sound engine started") || line.contains("Created:")) { ready = true; emit_launch(&app, &instance_id, "running", 100, "Minecraft is ready"); }
                }
                if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                    if !ready && !status.success() { return Err(format!("Minecraft exited before opening (exit code {}).", status.code().map(|code| code.to_string()).unwrap_or_else(|| "unknown".into()))); }
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(75));
            }
            Ok(())
        })();
        match result { Ok(()) => emit_launch(&app, &instance_id, "idle", 0, "Minecraft closed"), Err(error) => emit_launch(&app, &instance_id, "error", 0, error) }
        if let Ok(mut value) = active.lock() { *value = false; }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(LauncherState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, request_microsoft_device_code, complete_microsoft_login, detect_java_installations, get_minecraft_releases, save_instance, list_instances, launch_minecraft, get_minecraft_launch_status, cancel_minecraft_launch, sign_out_minecraft, get_saved_minecraft_profile])
        .run(tauri::generate_context!())
        .expect("error while running Bloom Client");
}
