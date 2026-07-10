use std::sync::{Arc, Mutex, OnceLock};
use tauri::Emitter;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct MinecraftSession { username: String, uuid: String, access_token: String, refresh_token: String, client_id: String }

#[derive(Default)]
struct LauncherState { session: Mutex<Option<MinecraftSession>>, launch_active: Arc<Mutex<bool>> }

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LaunchProgress { instance_id: String, state: String, progress: u8, message: String }

static CURRENT_LAUNCH: OnceLock<Mutex<LaunchProgress>> = OnceLock::new();

fn current_launch() -> &'static Mutex<LaunchProgress> {
    CURRENT_LAUNCH.get_or_init(|| Mutex::new(LaunchProgress { instance_id: String::new(), state: "idle".into(), progress: 0, message: String::new() }))
}

fn emit_launch(app: &tauri::AppHandle, instance_id: &str, state: &str, progress: u8, message: impl Into<String>) {
    let payload = LaunchProgress { instance_id: instance_id.to_string(), state: state.to_string(), progress, message: message.into() };
    if let Ok(mut current) = current_launch().lock() { *current = payload.clone(); }
    let _ = app.emit("minecraft-launch-progress", payload);
}

#[tauri::command]
fn get_minecraft_launch_status() -> LaunchProgress { current_launch().lock().map(|status| status.clone()).unwrap_or(LaunchProgress { instance_id: String::new(), state: "idle".into(), progress: 0, message: String::new() }) }

fn saved_session() -> Option<MinecraftSession> {
    let entry = keyring::Entry::new("Bloom Client", "minecraft-session").ok()?;
    serde_json::from_str(&entry.get_password().ok()?).ok()
}

fn save_session(session: &MinecraftSession) -> Result<(), String> {
    let entry = keyring::Entry::new("Bloom Client", "minecraft-session").map_err(|error| format!("Windows could not prepare secure account storage: {error}"))?;
    let value = serde_json::to_string(session).map_err(|error| error.to_string())?;
    entry.set_password(&value).map_err(|error| format!("Windows could not save your sign-in securely: {error}"))
}

#[tauri::command]
fn sign_out_minecraft(state: tauri::State<'_, LauncherState>) -> Result<(), String> {
    *state.session.lock().map_err(|_| "Unable to clear the Minecraft sign-in session.")? = None;
    let entry = keyring::Entry::new("Bloom Client", "minecraft-session").map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Windows could not remove the saved sign-in: {error}")),
    }
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
    let refresh_token = tokens["refresh_token"].as_str().ok_or("Microsoft did not return a refresh token. Reconnect your account once more.")?.to_string();
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

async fn refresh_minecraft_session(previous: MinecraftSession) -> Result<MinecraftSession, String> {
    let client = reqwest::Client::new();
    let response = client.post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token").form(&[("client_id", previous.client_id.clone()), ("grant_type", "refresh_token".into()), ("refresh_token", previous.refresh_token.clone())]).send().await.map_err(|error| error.to_string())?;
    let tokens = read_auth_response(response, "Microsoft sign-in").await?;
    let access_token = tokens["access_token"].as_str().ok_or("Microsoft did not return a refreshed access token.")?;
    let refresh_token = tokens["refresh_token"].as_str().unwrap_or(&previous.refresh_token).to_string();
    let xbl = read_auth_response(client.post("https://user.auth.xboxlive.com/user/authenticate").json(&serde_json::json!({"Properties":{"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket":format!("d={access_token}")},"RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"})).send().await.map_err(|error| error.to_string())?, "Xbox Live").await?;
    let xsts = read_auth_response(client.post("https://xsts.auth.xboxlive.com/xsts/authorize").json(&serde_json::json!({"Properties":{"SandboxId":"RETAIL","UserTokens":[xbl["Token"]]},"RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"})).send().await.map_err(|error| error.to_string())?, "Xbox security").await?;
    let identity = xsts["DisplayClaims"]["xui"][0]["uhs"].as_str().ok_or("Xbox authentication did not return a user identity.")?;
    let xsts_token = xsts["Token"].as_str().ok_or("Xbox authentication did not return an XSTS token.")?;
    let minecraft = read_auth_response(client.post("https://api.minecraftservices.com/authentication/login_with_xbox").json(&serde_json::json!({"identityToken":format!("XBL3.0 x={identity};{xsts_token}")})).send().await.map_err(|error| error.to_string())?, "Minecraft services").await?;
    let minecraft_token = minecraft["access_token"].as_str().ok_or("Minecraft services did not return an access token.")?.to_string();
    let profile = read_auth_response(client.get("https://api.minecraftservices.com/minecraft/profile").bearer_auth(&minecraft_token).send().await.map_err(|error| error.to_string())?, "Minecraft profile").await?;
    Ok(MinecraftSession { username: profile["name"].as_str().ok_or("No Minecraft profile was found on this account.")?.to_string(), uuid: profile["id"].as_str().ok_or("No Minecraft profile was found on this account.")?.to_string(), access_token: minecraft_token, refresh_token, client_id: previous.client_id })
}

#[derive(serde::Serialize)]
struct JavaInstallation { path: String, major_version: Option<u32>, usable: bool }

#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstanceConfig {
    id: String, name: String, version: String, directory: String, java: String, memory: u32,
    jvm_arguments: String, mods: bool, resource_packs: bool, shader_packs: bool, config: bool,
    custom_resolution: bool, visible: bool, shortcut: bool,
}

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
    let target = if config.directory.starts_with(".minecraft") { game_dir.join(&config.directory) } else { game_dir };
    std::fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    for (enabled, folder) in [(config.mods, "mods"), (config.resource_packs, "resourcepacks"), (config.shader_packs, "shaderpacks"), (config.config, "config")] { if enabled { std::fs::create_dir_all(target.join(folder)).map_err(|error| error.to_string())?; } }
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
    let saved = state.session.lock().map_err(|_| "Unable to read the Minecraft sign-in session.")?.clone().or_else(saved_session)
        .ok_or_else(|| { if let Ok(mut active) = state.launch_active.lock() { *active = false; } "Sign in with Microsoft before launching Minecraft.".to_string() })?;
    let session = match refresh_minecraft_session(saved).await {
        Ok(session) => session,
        Err(error) => { if let Ok(mut active) = state.launch_active.lock() { *active = false; } return Err(format!("Your Microsoft session could not be refreshed. Reconnect only if this continues: {error}")); }
    };
    save_session(&session)?;
    *state.session.lock().map_err(|_| "Unable to save the refreshed Minecraft session.")? = Some(session.clone());
    let active = Arc::new(state.launch_active.clone());
    std::thread::spawn(move || {
        let config = match load_instance(&instance_id) { Ok(config) => config, Err(error) => { emit_launch(&app, &instance_id, "error", 0, error); if let Ok(mut value) = active.lock() { *value = false; } return; } };
        emit_launch(&app, &instance_id, "installing", 2, "Preparing Minecraft files");
        let launcher = mc_launcher_core::launcher::Launcher::new(&config.directory);
        let mut finished_tasks = 0u8;
        let app_for_progress = app.clone();
        let id_for_progress = instance_id.clone();
        let install = launcher.install_with_progress(mc_launcher_core::install::InstallRequest::vanilla(&config.version), &mut move |event| {
            use mc_launcher_core::progress::ProgressEvent;
            match event {
                ProgressEvent::StageStarted { stage } => emit_launch(&app_for_progress, &id_for_progress, "installing", 4, format!("{:?}", stage)),
                ProgressEvent::TaskFinished { label } | ProgressEvent::TaskSkipped { label, .. } => { finished_tasks = finished_tasks.saturating_add(1); let progress = 5 + finished_tasks.saturating_mul(2).min(88); emit_launch(&app_for_progress, &id_for_progress, "installing", progress, label); }
                _ => {}
            }
        });
        let result = (|| -> Result<(), String> {
            let installed = install.map_err(|error| format!("Minecraft installation failed: {error}"))?;
            let version = launcher.load_version(&installed.version_id).map_err(|error| format!("Minecraft metadata could not be loaded: {error}"))?;
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
            process.args(args).current_dir(command.working_dir).envs(command.env);
            let mut child = process.spawn().map_err(|error| format!("Minecraft could not start: {error}"))?;
            emit_launch(&app, &instance_id, "running", 100, "Minecraft is running");
            let _ = child.wait();
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
        .invoke_handler(tauri::generate_handler![greet, request_microsoft_device_code, complete_microsoft_login, detect_java_installations, get_minecraft_releases, save_instance, list_instances, launch_minecraft, get_minecraft_launch_status, sign_out_minecraft])
        .run(tauri::generate_context!())
        .expect("error while running Bloom Client");
}
