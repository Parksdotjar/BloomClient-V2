use serde::{Deserialize, Serialize};
use std::io::Write;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareHashes {
    sha1: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareFile {
    path: String,
    hashes: ShareHashes,
    downloads: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    env: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareManifest {
    schema_version: u32,
    name: String,
    minecraft_version: String,
    loader: String,
    loader_version: String,
    files: Vec<ShareFile>,
    #[serde(default)]
    missing_mods: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModpackShareCreated {
    code: String,
    url: String,
    expires_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModpackShareLoaded {
    code: String,
    manifest: ShareManifest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModpackShareImport {
    instance_id: String,
    missing_mods: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackChannelRecord {
    instance_id: String,
    code: String,
    revision: u64,
    role: String,
    #[serde(default)]
    managed_files: Vec<ShareFile>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackChannelCreated {
    code: String,
    url: String,
    revision: u64,
    editor_count: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackAccessInviteCreated {
    code: String,
    id: String,
    recipient_id: String,
    role: String,
    expires_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackAccessMember {
    id: String,
    recipient_id: String,
    role: String,
    created_at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackAccessPendingInvite {
    id: String,
    recipient_id: String,
    role: String,
    created_at: u64,
    expires_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackAccessOverview {
    access_enabled: bool,
    members: Vec<PackAccessMember>,
    invites: Vec<PackAccessPendingInvite>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackChannelState {
    instance_id: String,
    code: String,
    revision: u64,
    latest_revision: u64,
    role: String,
    editor_count: u32,
    update_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackChannelMembership {
    instance_id: String,
    role: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelResponse {
    code: String,
    revision: u64,
    #[serde(default)]
    editor_count: u32,
    #[serde(default)]
    role: Option<String>,
    manifest: ShareManifest,
}

fn channel_records_path() -> Result<std::path::PathBuf, String> {
    Ok(super::bloom_data_dir()?.join("pack-channels.json"))
}
fn load_channel_records() -> Vec<PackChannelRecord> {
    channel_records_path()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}
fn save_channel_record(record: PackChannelRecord) -> Result<(), String> {
    let mut records = load_channel_records();
    records.retain(|item| item.instance_id != record.instance_id);
    records.push(record);
    std::fs::write(
        channel_records_path()?,
        serde_json::to_vec_pretty(&records).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}
fn channel_credential(code: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("Bloom Client", &format!("pack-channel-{code}"))
        .map_err(|error| error.to_string())
}
fn save_channel_token(code: &str, token: &str) -> Result<(), String> {
    channel_credential(code)?
        .set_password(token)
        .map_err(|error| error.to_string())
}
fn load_channel_token(code: &str) -> Result<String, String> {
    channel_credential(code)?
        .get_password()
        .map_err(|_| "This synced-pack credential is unavailable on this computer.".to_string())
}

fn normalize_code(input: &str) -> Result<String, String> {
    let without_query = input.trim().split(['?', '#']).next().unwrap_or_default();
    let code = without_query
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if code.len() != 8
        || !code
            .chars()
            .all(|value| "23456789ABCDEFGHJKLMNPQRSTUVWXYZ".contains(value))
    {
        return Err("Enter a valid Bloom pack code or link.".into());
    }
    Ok(code)
}

fn resolve_modrinth_file(
    version: &super::ModrinthVersion,
    sha1: &str,
    game_version: &str,
) -> Result<(String, String), String> {
    if !version
        .game_versions
        .iter()
        .any(|value| value == game_version)
        || !version
            .loaders
            .iter()
            .any(|value| value.eq_ignore_ascii_case("fabric"))
    {
        return Err("A mod does not support this instance's Fabric version.".into());
    }
    let file = version
        .files
        .iter()
        .find(|file| file.hashes.get("sha1").map(String::as_str) == Some(sha1))
        .ok_or("Modrinth could not match one of the installed mod files.")?;
    if !super::allowed_pack_download(&file.url) {
        return Err("Modrinth returned an untrusted mod download address.".into());
    }
    Ok((file.filename.clone(), file.url.clone()))
}

fn create_manifest(instance_id: &str) -> Result<ShareManifest, String> {
    let config = super::load_instance(instance_id)?;
    if !config.loader.eq_ignore_ascii_case("fabric") {
        return Err("Pack sharing currently supports Fabric instances only.".into());
    }
    let loader_version = config
        .loader_version
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or("Install or select a Fabric loader version before sharing this pack.")?;
    let mods = std::path::PathBuf::from(&config.directory).join("mods");
    let mut entries = std::fs::read_dir(&mods)
        .map_err(|_| "This instance has no readable mods folder.".to_string())?
        .flatten()
        .filter(|entry| entry.path().is_file())
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!(
            "BloomClient/",
            env!("CARGO_PKG_VERSION"),
            " (support@bloomclient.org)"
        ))
        .build()
        .map_err(|error| error.to_string())?;
    let mut local_files = Vec::new();
    for entry in entries {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.to_ascii_lowercase().ends_with(".disabled")
            || !file_name.to_ascii_lowercase().ends_with(".jar")
            || super::cosmetics::is_managed_file(&file_name)
        {
            continue;
        }
        let sha1 = mc_launcher_core::io::hash::sha1_file(&entry.path())
            .map_err(|error| format!("Could not read {file_name}: {error}"))?;
        local_files.push((file_name, sha1));
    }
    if local_files.is_empty() {
        return Err("This instance has no enabled mods to share.".into());
    }
    let versions = client
        .post("https://api.modrinth.com/v2/version_files")
        .json(&serde_json::json!({
            "hashes": local_files.iter().map(|(_, hash)| hash).collect::<Vec<_>>(),
            "algorithm": "sha1",
        }))
        .send()
        .map_err(|error| format!("Could not identify this pack through Modrinth: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Modrinth rejected the pack lookup: {error}"))?
        .json::<std::collections::HashMap<String, super::ModrinthVersion>>()
        .map_err(|error| format!("Modrinth returned invalid pack information: {error}"))?;
    let mut files = Vec::new();
    let mut unsupported = Vec::new();
    for (file_name, sha1) in local_files {
        let resolved = versions
            .get(&sha1)
            .ok_or_else(|| "One or more mods are not available through Modrinth.".to_string())
            .and_then(|version| resolve_modrinth_file(version, &sha1, &config.version));
        match resolved {
            Ok((resolved_name, download)) => files.push(ShareFile {
                path: format!("mods/{resolved_name}"),
                hashes: ShareHashes { sha1 },
                downloads: vec![download],
                env: None,
            }),
            Err(_) => unsupported.push(file_name),
        }
    }
    Ok(ShareManifest {
        schema_version: 1,
        name: config.name,
        minecraft_version: config.version,
        loader: "fabric".into(),
        loader_version,
        files,
        missing_mods: unsupported,
    })
}

fn create_modpack_share_blocking(instance_id: String) -> Result<ModpackShareCreated, String> {
    let manifest = create_manifest(&instance_id)?;
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent(concat!("BloomClient/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?
        .post(format!(
            "{}/v1/packs",
            super::BACKEND_URL.trim_end_matches('/')
        ))
        .json(&manifest)
        .send()
        .map_err(|error| format!("Bloom's sharing service is unavailable: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Bloom could not publish this pack: {error}"))?
        .json::<ModpackShareCreated>()
        .map_err(|error| format!("Bloom returned an invalid share code: {error}"))
}

#[tauri::command]
pub(crate) async fn create_modpack_share(
    instance_id: String,
) -> Result<ModpackShareCreated, String> {
    tauri::async_runtime::spawn_blocking(move || create_modpack_share_blocking(instance_id))
        .await
        .map_err(|error| format!("The pack sharing task stopped unexpectedly: {error}"))?
}

fn write_share_archive(code: &str, manifest: &ShareManifest) -> Result<std::path::PathBuf, String> {
    let imports = super::bloom_data_dir()?.join("imports");
    std::fs::create_dir_all(&imports).map_err(|error| error.to_string())?;
    let path = imports.join(format!("bloom-share-{}.mrpack", code.to_ascii_lowercase()));
    let file = std::fs::File::create(&path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipWriter::new(file);
    archive
        .start_file(
            "modrinth.index.json",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .map_err(|error| error.to_string())?;
    let index = serde_json::json!({
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": format!("bloom-share-{}", code.to_ascii_lowercase()),
        "name": manifest.name,
        "summary": "",
        "files": manifest.files,
        "dependencies": {
            "minecraft": manifest.minecraft_version,
            "fabric-loader": manifest.loader_version,
        }
    });
    archive
        .write_all(&serde_json::to_vec_pretty(&index).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    archive.finish().map_err(|error| error.to_string())?;
    Ok(path)
}

#[tauri::command]
pub(crate) async fn import_modpack_share(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::LauncherState>,
    code: String,
) -> Result<ModpackShareImport, String> {
    let code = normalize_code(&code)?;
    let loaded =
        super::bloom_backend_request(reqwest::Method::GET, &format!("/v1/packs/{code}"), 20)?
            .send()
            .await
            .map_err(|error| format!("Bloom's sharing service is unavailable: {error}"))?
            .error_for_status()
            .map_err(|error| {
                if error.status() == Some(reqwest::StatusCode::NOT_FOUND) {
                    "That pack code was not found or has expired.".to_string()
                } else {
                    format!("Bloom could not load that pack: {error}")
                }
            })?
            .json::<ModpackShareLoaded>()
            .await
            .map_err(|error| format!("Bloom returned an invalid shared pack: {error}"))?;
    let archive = write_share_archive(&loaded.code, &loaded.manifest)?;
    let instance_id = super::import_fabric_modpack_path(app, &state, archive)?;
    Ok(ModpackShareImport {
        instance_id,
        missing_mods: loaded.manifest.missing_mods,
    })
}

fn import_channel_manifest(
    app: tauri::AppHandle,
    state: &super::LauncherState,
    response: ChannelResponse,
    role: &str,
    token: Option<&str>,
) -> Result<ModpackShareImport, String> {
    let archive = write_share_archive(&response.code, &response.manifest)?;
    let instance_id = super::import_fabric_modpack_path(app, state, archive)?;
    save_channel_record(PackChannelRecord {
        instance_id: instance_id.clone(),
        code: response.code.clone(),
        revision: response.revision,
        role: role.into(),
        managed_files: response.manifest.files.clone(),
    })?;
    if let Some(token) = token {
        save_channel_token(&response.code, token)?;
    }
    Ok(ModpackShareImport {
        instance_id,
        missing_mods: response.manifest.missing_mods,
    })
}

#[tauri::command]
pub(crate) async fn create_pack_channel(instance_id: String) -> Result<PackChannelCreated, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Created {
        code: String,
        url: String,
        owner_token: String,
        revision: u64,
        editor_count: u32,
    }
    tauri::async_runtime::spawn_blocking(move || {
        let manifest = create_manifest(&instance_id)?;
        let created = reqwest::blocking::Client::new()
            .post(format!(
                "{}/v1/pack-channels",
                super::BACKEND_URL.trim_end_matches('/')
            ))
            .json(&manifest)
            .send()
            .map_err(|error| format!("Bloom's sharing service is unavailable: {error}"))?
            .error_for_status()
            .map_err(|error| format!("Bloom could not create the group pack: {error}"))?
            .json::<Created>()
            .map_err(|error| error.to_string())?;
        save_channel_token(&created.code, &created.owner_token)?;
        save_channel_record(PackChannelRecord {
            instance_id,
            code: created.code.clone(),
            revision: created.revision,
            role: "owner".into(),
            managed_files: manifest.files.clone(),
        })?;
        Ok(PackChannelCreated {
            code: created.code,
            url: created.url,
            revision: created.revision,
            editor_count: created.editor_count,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn create_pack_access_invite(
    instance_id: String,
    recipient_id: String,
    role: String,
) -> Result<PackAccessInviteCreated, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if role != "member" && role != "editor" {
            return Err("Choose Can view or Can edit.".into());
        }
        let record = load_channel_records()
            .into_iter()
            .find(|item| item.instance_id == instance_id && item.role == "owner")
            .ok_or("Only the synced-pack owner can invite people.")?;
        let token = load_channel_token(&record.code)?;
        reqwest::blocking::Client::new()
            .post(format!(
                "{}/v1/pack-channels/{}/invites",
                super::BACKEND_URL.trim_end_matches('/'),
                record.code
            ))
            .bearer_auth(token)
            .json(&serde_json::json!({"recipientId": recipient_id, "role": role}))
            .send()
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| format!("Bloom could not create that access invitation: {error}"))?
            .json::<PackAccessInviteCreated>()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn create_pack_editor_invite(
    instance_id: String,
) -> Result<PackAccessInviteCreated, String> {
    create_pack_access_invite(
        instance_id,
        format!("legacy_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()),
        "editor".into(),
    )
    .await
}

async fn redeem_pack_access(
    app: tauri::AppHandle,
    state: &super::LauncherState,
    code: String,
) -> Result<ModpackShareImport, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Joined {
        code: String,
        access_token: String,
        role: String,
        revision: u64,
        manifest: ShareManifest,
    }
    let code = normalize_code(&code)?;
    let joined = super::bloom_backend_request(
        reqwest::Method::POST,
        "/v1/pack-channels/invites/redeem",
        20,
    )?
    .json(&serde_json::json!({"code": code}))
    .send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| format!("That synced-pack invitation is invalid, expired, or already used: {error}"))?
    .json::<Joined>()
    .await
    .map_err(|error| error.to_string())?;
    let response = ChannelResponse {
        code: joined.code,
        revision: joined.revision,
        editor_count: 0,
        role: Some(joined.role.clone()),
        manifest: joined.manifest,
    };
    import_channel_manifest(app, state, response, &joined.role, Some(&joined.access_token))
}

#[tauri::command]
pub(crate) async fn import_pack_channel(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::LauncherState>,
    code: String,
) -> Result<ModpackShareImport, String> {
    redeem_pack_access(app, &state, code).await
}

#[tauri::command]
pub(crate) async fn join_pack_as_editor(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::LauncherState>,
    code: String,
) -> Result<ModpackShareImport, String> {
    redeem_pack_access(app, &state, code).await
}

#[tauri::command]
pub(crate) async fn publish_pack_channel(
    instance_id: String,
) -> Result<PackChannelCreated, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut record = load_channel_records()
            .into_iter()
            .find(|item| item.instance_id == instance_id)
            .ok_or("This instance is not connected to a group pack.")?;
        if record.role == "member" {
            return Err("Members cannot publish. Join with an editor code first.".into());
        }
        let token = load_channel_token(&record.code)?;
        let manifest = create_manifest(&instance_id)?;
        let response = reqwest::blocking::Client::new()
            .put(format!(
                "{}/v1/pack-channels/{}",
                super::BACKEND_URL.trim_end_matches('/'),
                record.code
            ))
            .bearer_auth(token)
            .json(&serde_json::json!({"baseRevision":record.revision,"manifest":&manifest}))
            .send()
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| format!("Bloom could not publish this revision: {error}"))?
            .json::<serde_json::Value>()
            .map_err(|error| error.to_string())?;
        record.revision = response["revision"]
            .as_u64()
            .ok_or("Bloom returned an invalid revision.")?;
        record.managed_files = manifest.files;
        save_channel_record(record.clone())?;
        Ok(PackChannelCreated {
            code: record.code.clone(),
            url: format!(
                "{}/v1/pack-channels/{}",
                super::BACKEND_URL.trim_end_matches('/'),
                record.code
            ),
            revision: record.revision,
            editor_count: 0,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn get_pack_channel_state(
    instance_id: String,
) -> Result<Option<PackChannelState>, String> {
    let Some(mut record) = load_channel_records()
        .into_iter()
        .find(|item| item.instance_id == instance_id)
    else {
        return Ok(None);
    };
    let mut request = super::bloom_backend_request(
        reqwest::Method::GET,
        &format!("/v1/pack-channels/{}", record.code),
        10,
    )?;
    if let Ok(token) = load_channel_token(&record.code) {
        request = request.bearer_auth(token);
    }
    let response = request.send()
    .await
    .map_err(|error| error.to_string())?
    .error_for_status()
    .map_err(|error| error.to_string())?
    .json::<ChannelResponse>()
    .await
    .map_err(|error| error.to_string())?;
    if let Some(role) = response.role.as_ref().filter(|role| *role != &record.role) {
        record.role = role.clone();
        save_channel_record(record.clone())?;
    }
    Ok(Some(PackChannelState {
        instance_id,
        code: record.code,
        revision: record.revision,
        latest_revision: response.revision,
        role: response.role.unwrap_or(record.role),
        editor_count: response.editor_count,
        update_available: response.revision > record.revision,
    }))
}

fn owner_channel_record(instance_id: &str) -> Result<PackChannelRecord, String> {
    load_channel_records()
        .into_iter()
        .find(|item| item.instance_id == instance_id && item.role == "owner")
        .ok_or_else(|| "Only the synced-pack owner can manage access.".to_string())
}

#[tauri::command]
pub(crate) async fn get_pack_access_overview(
    instance_id: String,
) -> Result<PackAccessOverview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let record = owner_channel_record(&instance_id)?;
        let token = load_channel_token(&record.code)?;
        reqwest::blocking::Client::new()
            .get(format!("{}/v1/pack-channels/{}/access", super::BACKEND_URL.trim_end_matches('/'), record.code))
            .bearer_auth(token)
            .send().map_err(|error| error.to_string())?
            .error_for_status().map_err(|error| format!("Bloom could not load pack access: {error}"))?
            .json::<PackAccessOverview>().map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn enable_pack_managed_access(instance_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let record = owner_channel_record(&instance_id)?;
        let token = load_channel_token(&record.code)?;
        reqwest::blocking::Client::new()
            .post(format!("{}/v1/pack-channels/{}/access/enable", super::BACKEND_URL.trim_end_matches('/'), record.code))
            .bearer_auth(token).send().map_err(|error| error.to_string())?
            .error_for_status().map_err(|error| format!("Bloom could not enable managed access: {error}"))?;
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn update_pack_member_role(instance_id: String, access_id: String, role: String) -> Result<PackAccessMember, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if role != "member" && role != "editor" { return Err("Choose Can view or Can edit.".into()); }
        let record = owner_channel_record(&instance_id)?; let token = load_channel_token(&record.code)?;
        reqwest::blocking::Client::new()
            .patch(format!("{}/v1/pack-channels/{}/access/{}", super::BACKEND_URL.trim_end_matches('/'), record.code, access_id))
            .bearer_auth(token).json(&serde_json::json!({"role": role})).send().map_err(|error| error.to_string())?
            .error_for_status().map_err(|error| format!("Bloom could not change that permission: {error}"))?
            .json::<PackAccessMember>().map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn revoke_pack_member(instance_id: String, access_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let record = owner_channel_record(&instance_id)?; let token = load_channel_token(&record.code)?;
        reqwest::blocking::Client::new()
            .delete(format!("{}/v1/pack-channels/{}/access/{}", super::BACKEND_URL.trim_end_matches('/'), record.code, access_id))
            .bearer_auth(token).send().map_err(|error| error.to_string())?
            .error_for_status().map_err(|error| format!("Bloom could not remove that person: {error}"))?;
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn invalidate_pack_invite(instance_id: String, invite_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let record = owner_channel_record(&instance_id)?; let token = load_channel_token(&record.code)?;
        reqwest::blocking::Client::new()
            .delete(format!("{}/v1/pack-channels/{}/invites/{}", super::BACKEND_URL.trim_end_matches('/'), record.code, invite_id))
            .bearer_auth(token).send().map_err(|error| error.to_string())?
            .error_for_status().map_err(|error| format!("Bloom could not invalidate that invitation: {error}"))?;
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn list_pack_channel_memberships() -> Vec<PackChannelMembership> {
    load_channel_records()
        .into_iter()
        .map(|record| PackChannelMembership {
            instance_id: record.instance_id,
            role: record.role,
        })
        .collect()
}

#[tauri::command]
pub(crate) async fn apply_pack_channel_update(
    instance_id: String,
) -> Result<ModpackShareImport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut record = load_channel_records()
            .into_iter()
            .find(|item| item.instance_id == instance_id)
            .ok_or("This instance is not connected to a group pack.")?;
        let mut request = reqwest::blocking::Client::new().get(format!(
                "{}/v1/pack-channels/{}",
                super::BACKEND_URL.trim_end_matches('/'),
                record.code
            ));
        if let Ok(token) = load_channel_token(&record.code) {
            request = request.bearer_auth(token);
        }
        let response = request.send()
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?
            .json::<ChannelResponse>()
            .map_err(|error| error.to_string())?;
        if response.revision <= record.revision {
            return Ok(ModpackShareImport {
                instance_id,
                missing_mods: response.manifest.missing_mods,
            });
        }
        let config = super::load_instance(&instance_id)?;
        let root = std::path::PathBuf::from(config.directory);
        let mods = root.join("mods");
        std::fs::create_dir_all(&mods).map_err(|error| error.to_string())?;
        let data = super::bloom_data_dir()?;
        let backup = data
            .join("backups")
            .join("group-packs")
            .join(&instance_id)
            .join(format!("revision-{}", record.revision));
        let staging = data.join("imports").join(format!(
            "group-pack-{}-revision-{}",
            record.code, response.revision
        ));
        if staging.exists() {
            std::fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
        }
        std::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|error| error.to_string())?;
        for file in &response.manifest.files {
            let name = std::path::Path::new(&file.path)
                .file_name()
                .ok_or("A shared mod has an invalid filename.")?;
            let temporary = staging.join(name);
            let bytes = client
                .get(
                    file.downloads
                        .first()
                        .ok_or("A shared mod has no download URL.")?,
                )
                .send()
                .map_err(|error| error.to_string())?
                .error_for_status()
                .map_err(|error| error.to_string())?
                .bytes()
                .map_err(|error| error.to_string())?;
            std::fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
            if mc_launcher_core::io::hash::sha1_file(&temporary)
                .map_err(|error| error.to_string())?
                != file.hashes.sha1
            {
                let _ = std::fs::remove_file(&temporary);
                return Err(format!("{} failed verification.", name.to_string_lossy()));
            }
        }
        std::fs::create_dir_all(&backup).map_err(|error| error.to_string())?;
        for old in &record.managed_files {
            let Some(name) = std::path::Path::new(&old.path).file_name() else {
                continue;
            };
            let path = mods.join(name);
            if path.exists()
                && mc_launcher_core::io::hash::sha1_file(&path).ok().as_deref()
                    == Some(old.hashes.sha1.as_str())
            {
                std::fs::copy(&path, backup.join(name)).map_err(|error| error.to_string())?;
                std::fs::remove_file(path).map_err(|error| error.to_string())?;
            }
        }
        for file in &response.manifest.files {
            let name = std::path::Path::new(&file.path)
                .file_name()
                .ok_or("A shared mod has an invalid filename.")?;
            let target = mods.join(name);
            let staged = staging.join(name);
            if target.exists() {
                std::fs::copy(&target, backup.join(name)).map_err(|error| error.to_string())?;
                std::fs::remove_file(&target).map_err(|error| error.to_string())?;
            }
            std::fs::rename(staged, target).map_err(|error| error.to_string())?;
        }
        let _ = std::fs::remove_dir_all(staging);
        record.revision = response.revision;
        record.managed_files = response.manifest.files;
        save_channel_record(record)?;
        Ok(ModpackShareImport {
            instance_id,
            missing_mods: response.manifest.missing_mods,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::normalize_code;

    #[test]
    fn share_codes_accept_codes_and_links() {
        assert_eq!(normalize_code("bcdf2345").unwrap(), "BCDF2345");
        assert_eq!(
            normalize_code("https://api.example/v1/packs/BCDF2345").unwrap(),
            "BCDF2345"
        );
        assert!(normalize_code("not-a-code").is_err());
    }
}
