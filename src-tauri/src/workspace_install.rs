use crate::{
    bloom_data_dir, cosmetics, install_instance_files, instance_actions, list_instances_blocking,
    workspace_player::{PlayerFile, PlayerLink, PlayerRelease},
    InstanceConfig, InstanceEngine, LauncherState,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha512};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Emitter;

const RECEIPT: &str = ".delight-follow.json";
#[path = "workspace_updates.rs"]
pub(crate) mod updates;
const STALE: &str =
    "The release changed since your preview. Open the preview again before installing.";

#[derive(Serialize, Deserialize)]
struct FollowReceipt {
    instance_id: String,
    release: PlayerRelease,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FollowedPack {
    pub(crate) player_url: String,
    revision: u64,
    creator: String,
    release_note: String,
}

fn instance_id(link: &str) -> String {
    // Ordinary instance creation trims leading hyphens. This namespace cannot
    // collide with a name-derived ID, even while another client creates one.
    format!("-follow-{:x}", Sha256::digest(link.as_bytes()))
}

fn follower_id(id: &str) -> bool {
    id.strip_prefix("-follow-")
        .is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn directory(root: &Path, id: &str) -> PathBuf {
    root.join("followed-packs").join("games").join(id)
}

// The canonical path also keeps ordinary copies and unrelated same-name instances independent.
pub(super) fn uses_published_files(config: &InstanceConfig) -> bool {
    follower_id(&config.id)
        && bloom_data_dir()
            .is_ok_and(|root| Path::new(&config.directory) == directory(&root, &config.id))
}

fn read_optional<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read the installed pack record: {error}")),
    };
    const MAX_RECORD: u64 = 32 * 1024 * 1024;
    if !metadata.is_file() || instance_actions::linked(&metadata) || metadata.len() > MAX_RECORD {
        return Err("The installed pack record has an unsupported file type or size.".into());
    }
    let file = File::open(path).map_err(|e| e.to_string())?;
    serde_json::from_reader(file.take(MAX_RECORD + 1))
        .map(Some)
        .map_err(|_| "The installed pack record is damaged.".into())
}

fn lookup(root: &Path, id: &str) -> Result<Option<FollowReceipt>, String> {
    if !follower_id(id) {
        return Ok(None);
    }
    let record = root.join("instances").join(format!("{id}.json"));
    let Some(config) = read_optional::<InstanceConfig>(&record)? else {
        return Ok(None);
    };
    let game = directory(root, id);
    if config.id != id || Path::new(&config.directory) != game {
        return Ok(None);
    }
    let receipt = read_optional::<FollowReceipt>(&game.join(RECEIPT))?.ok_or(
        "The followed instance is missing its saved release. Check the instance directory.",
    )?;
    if receipt.instance_id != id || instance_id(&receipt.release.url) != id {
        return Err("The saved release belongs to a different instance.".into());
    }
    receipt
        .release
        .validate(&PlayerLink::parse(&receipt.release.url)?)?;
    Ok(Some(receipt))
}

pub(super) fn installed_release(link: &str) -> Result<Option<(String, PlayerRelease)>, String> {
    let root = bloom_data_dir()?;
    let id = instance_id(link);
    if let Some(saved) = lookup(&root, &id)? {
        return Ok(Some((id, saved.release)));
    }
    if !directory(&root, &id)
        .try_exists()
        .map_err(|e| e.to_string())?
    {
        return Ok(None);
    }
    // If the process stopped after promoting the verified files, complete
    // registration from its receipt before attempting any network access.
    let base = root.join("followed-packs");
    check_real_directory(&base)?;
    let _lock = install_lock(&base)?;
    let saved = match lookup(&root, &id)? {
        Some(saved) => Some(saved),
        None => recover(
            &root,
            &PlayerLink::parse(link)?,
            &id,
            list_instances_blocking,
        )?,
    };
    Ok(saved.map(|r| (id, r.release)))
}

#[tauri::command]
pub(crate) async fn get_followed_pack(instance_id: String) -> Result<Option<FollowedPack>, String> {
    instance_actions::validate_id(&instance_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        lookup(&bloom_data_dir()?, &instance_id)?.map(|r| {
            let player_url = PlayerLink::parse(&r.release.url)?.display_url();
            Ok(FollowedPack {
                player_url,
                revision: r.release.revision,
                creator: r.release.creator,
                release_note: r.release.release_note,
            })
        }).transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        Err("Pack installation cancelled.".into())
    } else {
        Ok(())
    }
}

pub(super) fn verified_copy(
    mut input: impl Read,
    mut output: impl Write,
    file: &PlayerFile,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let mut hash = Sha512::new();
    let mut bytes = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        check_cancel(cancel)?;
        let n = input
            .read(&mut buffer)
            .map_err(|e| format!("Could not read {}: {e}", file.file_name))?;
        if n == 0 {
            break;
        }
        bytes += n as u64;
        if bytes > file.size {
            return Err(format!("{} exceeds its published size.", file.file_name));
        }
        hash.update(&buffer[..n]);
        output
            .write_all(&buffer[..n])
            .map_err(|e| format!("Could not save {}: {e}", file.file_name))?;
    }
    if bytes != file.size || format!("{:x}", hash.finalize()) != file.sha512 {
        return Err(format!(
            "{} did not match its published checksum or size. Try again.",
            file.file_name
        ));
    }
    Ok(())
}

fn stage_file(
    client: &reqwest::blocking::Client,
    stage: &Path,
    release: &PlayerRelease,
    file: &PlayerFile,
    cancel: &AtomicBool,
) -> Result<(), String> {
    // PlayerLink::fetch validates the categories, safe filenames, source IDs, URL and exact hashes.
    // create_new also detects collisions on the actual destination filesystem.
    let path = stage.join(&file.category).join(&file.file_name);
    let mut out =
        File::create_new(path).map_err(|e| format!("Could not create {}: {e}", file.file_name))?;
    if file.source == "delight" {
        let bytes =
            cosmetics::published_bundle(&release.manifest.minecraft_version, &file.file_name)
                .ok_or_else(|| {
                    format!(
                        "This Delight build does not include the required {}.",
                        file.file_name
                    )
                })?;
        verified_copy(bytes, &mut out, file, cancel)?;
    } else {
        download_verified_modrinth(client, &mut out, file, cancel)?;
    }
    out.sync_all()
        .map_err(|e| format!("Could not finish saving {}: {e}", file.file_name))
}

pub(super) fn download_verified_modrinth(
    client: &reqwest::blocking::Client,
    output: impl Write,
    file: &PlayerFile,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let url = file.download_url.as_deref()
        .filter(|url| crate::workspace_player::trusted_file_url(url))
        .ok_or("This file has no trusted Modrinth download source.")?;
    let response = client.get(url).send().and_then(|r| r.error_for_status())
        .map_err(|_| format!("Could not download {} from Modrinth. Check your connection and try again.", file.file_name))?;
    if !response.status().is_success() {
        return Err(format!("Modrinth did not return the file {}.", file.file_name));
    }
    verified_copy(response, output, file, cancel)
}

fn library_name(name: &str, existing: &[InstanceConfig]) -> String {
    let used = |value: &str| existing.iter().any(|c| c.name.eq_ignore_ascii_case(value));
    if !used(name) {
        return name.into();
    }
    for n in 2.. {
        let suffix = format!(" ({n})");
        let stem: String = name
            .chars()
            .take(80usize.saturating_sub(suffix.len()))
            .collect();
        let candidate = format!("{stem}{suffix}");
        if !used(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}

fn config_for(root: &Path, receipt: &FollowReceipt, existing: &[InstanceConfig]) -> InstanceConfig {
    let manifest = &receipt.release.manifest;
    let name = if receipt.instance_id.starts_with("-edit-") {
        format!("{} (Working copy)", manifest.name.chars().take(65).collect::<String>())
    } else {
        manifest.name.clone()
    };
    InstanceConfig {
        id: receipt.instance_id.clone(),
        name: library_name(&name, existing),
        engine: InstanceEngine::Java,
        icon: None,
        loader: "Fabric".into(),
        loader_version: Some(manifest.loader_version.clone()),
        version: manifest.minecraft_version.clone(),
        directory: directory(root, &receipt.instance_id)
            .to_string_lossy()
            .into_owned(),
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
    }
}

fn write_new(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let mut out =
        File::create_new(path).map_err(|e| format!("Could not create the instance record: {e}"))?;
    serde_json::to_writer_pretty(&mut out, value).map_err(|e| e.to_string())?;
    out.sync_all().map_err(|e| e.to_string())
}

fn check_real_directory(path: &Path) -> Result<(), String> {
    let info = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !info.is_dir() || instance_actions::linked(&info) {
        return Err("The pack installation folder must be an ordinary directory.".into());
    }
    Ok(())
}

fn make_directory(path: &Path) -> Result<(), String> {
    match fs::create_dir(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => check_real_directory(path),
        Err(e) => Err(e.to_string()),
    }
}

struct Pending(PathBuf);
impl Drop for Pending {
    fn drop(&mut self) {
        if check_real_directory(&self.0).is_ok() {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

struct Active(Arc<Mutex<bool>>);
impl Active {
    fn begin(flag: Arc<Mutex<bool>>, cancel: &AtomicBool) -> Result<Self, String> {
        {
            let mut active = flag.lock().map_err(|_| "The launcher is busy.")?;
            if *active {
                return Err(
                    "Finish the current launch or download before installing this pack.".into(),
                );
            }
            cancel.store(false, Ordering::SeqCst);
            *active = true;
        }
        Ok(Self(flag))
    }
}
impl Drop for Active {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0.lock() {
            *active = false;
        }
    }
}

fn commit_record(root: &Path, stage: Option<&Path>, config: &InstanceConfig) -> Result<(), String> {
    let record = root.join("instances").join(format!("{}.json", config.id));
    if record.try_exists().map_err(|e| e.to_string())? {
        return Err(
            "An existing library record occupies this instance ID. Your instance was preserved."
                .into(),
        );
    }
    // The temp and library records are in the same directory so this rename is atomic.
    let temp = record.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        write_new(&temp, config)?;
        if let Some(stage) = stage {
            fs::rename(stage, &config.directory)
                .map_err(|e| format!("Could not activate the downloaded pack: {e}"))?;
        }
        fs::rename(&temp, &record).map_err(|e| {
            format!("The verified files are ready. Retry to finish adding the instance: {e}")
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

fn publish_progress(app: &tauri::AppHandle, link: &str, progress: u8, message: &str) {
    let _ = app.emit(
        "workspace-install-progress",
        serde_json::json!({"link":link,"progress":progress,"message":message}),
    );
}

struct RuntimeTarget {
    id: String,
    url: String,
    progress: u8,
    sent: Option<Instant>,
}

static RUNTIME_TARGET: Mutex<Option<RuntimeTarget>> = Mutex::new(None);

impl RuntimeTarget {
    fn event(
        &mut self,
        payload: &crate::LaunchProgress,
        now: Instant,
    ) -> Option<serde_json::Value> {
        if self.id != payload.instance_id || payload.state != "installing" {
            return None;
        }
        let progress = self.progress.max(payload.progress);
        if self
            .sent
            .is_some_and(|when| now.duration_since(when) < Duration::from_millis(120))
            && progress == self.progress
        {
            return None;
        }
        self.progress = progress;
        self.sent = Some(now);
        Some(
            serde_json::json!({"link":self.url, "progress":progress, "message":payload.message,
            "downloadedBytes":payload.downloaded_bytes,"totalBytes":payload.total_bytes,
            "bytesPerSecond":payload.bytes_per_second}),
        )
    }
}

pub(super) fn runtime_progress(app: &tauri::AppHandle, payload: &crate::LaunchProgress) {
    if !follower_id(&payload.instance_id) {
        return;
    }
    let event = RUNTIME_TARGET.lock().ok().and_then(|mut target| {
        target
            .as_mut()
            .and_then(|t| t.event(payload, Instant::now()))
    });
    if let Some(event) = event {
        let _ = app.emit("workspace-install-progress", event);
    }
}

struct RuntimeOperation<'a> {
    app: &'a tauri::AppHandle,
    id: &'a str,
}

impl<'a> RuntimeOperation<'a> {
    fn begin(app: &'a tauri::AppHandle, id: &'a str, url: &str) -> Result<Self, String> {
        let mut target = RUNTIME_TARGET
            .lock()
            .map_err(|_| "Could not start pack download progress.")?;
        *target = Some(RuntimeTarget {
            id: id.into(),
            url: url.into(),
            progress: 55,
            sent: None,
        });
        Ok(Self { app, id })
    }
}

impl Drop for RuntimeOperation<'_> {
    fn drop(&mut self) {
        if let Ok(mut target) = RUNTIME_TARGET.lock() {
            *target = None;
        }
        if std::thread::panicking() {
            crate::emit_launch(
                self.app,
                self.id,
                "error",
                0,
                "Pack installation stopped unexpectedly.",
            );
        }
    }
}

fn install_lock(base: &Path) -> Result<File, String> {
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(base.join("install.lock"))
        .map_err(|e| e.to_string())?;
    lock.lock()
        .map_err(|e| format!("Could not lock the local installer: {e}"))?;
    Ok(lock)
}

fn recover(
    root: &Path,
    link: &PlayerLink,
    id: &str,
    library: impl FnOnce() -> Result<Vec<InstanceConfig>, String>,
) -> Result<Option<FollowReceipt>, String> {
    let target = directory(root, id);
    if !target.try_exists().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let base = root.join("followed-packs");
    check_real_directory(&base)?;
    check_real_directory(&base.join("games"))?;
    check_real_directory(&target)?;
    let saved = read_optional::<FollowReceipt>(&target.join(RECEIPT))?
        .ok_or("An unrelated folder occupies the pack installation path.")?;
    if saved.instance_id != id {
        return Err("This release belongs to a different instance.".into());
    }
    saved.release.validate(link)?;
    // A completed install is allowed to have personal changes. Only this
    // interrupted activation must still match the release before registration.
    let intact = saved.release.manifest.files.iter().all(|entry| {
        let folder = target.join(&entry.category);
        let file = folder.join(&entry.file_name);
        if check_real_directory(&folder).is_err()
            || !fs::symlink_metadata(&file).is_ok_and(|m| {
                m.is_file() && !instance_actions::linked(&m) && m.len() == entry.size
            })
        {
            return false;
        }
        File::open(file)
            .is_ok_and(|f| verified_copy(f, io::sink(), entry, &AtomicBool::new(false)).is_ok())
    });
    if !intact {
        // Keep any changed bytes and personal additions. A fresh install can
        // now use the regular transaction without adopting or deleting them.
        let backups = base.join("recovery");
        make_directory(&backups)?;
        let backup = backups.join(format!("{id}-{}", uuid::Uuid::new_v4()));
        fs::rename(&target, &backup)
            .map_err(|e| format!("Could not preserve the interrupted installation: {e}"))?;
        return Err(format!("The interrupted installation had missing or changed files. Delight preserved its folder at {}. Retry to install a verified copy.", backup.display()));
    }
    let config = config_for(root, &saved, &library()?);
    commit_record(root, None, &config)?;
    Ok(Some(saved))
}

fn stage_release(
    app: &tauri::AppHandle, link: &PlayerLink, base: &Path, id: &str, release: &PlayerRelease, cancel: &AtomicBool,
) -> Result<Pending, String> {
    let pending = base.join("pending");
    make_directory(&pending)?;
    let stage = pending.join(id);
    if stage.try_exists().map_err(|e| e.to_string())? {
        check_real_directory(&stage)?;
        fs::remove_dir_all(&stage).map_err(|e| e.to_string())?;
    }
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let pending = Pending(stage);
    for folder in ["mods", "resourcepacks", "shaderpacks"] {
        fs::create_dir(pending.0.join(folder)).map_err(|e| e.to_string())?;
    }
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .user_agent("DelightClient/PackWorkspace")
        .build().map_err(|e| e.to_string())?;
    let progress_url = link.display_url();
    for (index, file) in release.manifest.files.iter().enumerate() {
        check_cancel(cancel)?;
        publish_progress(app, &progress_url, (index * 55 / release.manifest.files.len()) as u8,
            &format!("Verifying {}", file.file_name));
        stage_file(&client, &pending.0, release, file, cancel)?;
    }
    crate::mod_duplicates::verify_staged_mods(&pending.0.join("mods"))?;
    crate::pack_compatibility::runtime::verify_release(release, |file| {
        pending.0.join(&file.category).join(&file.file_name)
    })?;
    Ok(pending)
}

pub(super) fn working_copy_base(id: &str, link: &PlayerLink) -> Result<PlayerRelease, String> {
    instance_actions::validate_id(id)?;
    let root = bloom_data_dir()?;
    let target = directory(&root, id);
    let config = read_optional::<InstanceConfig>(&root.join("instances").join(format!("{id}.json")))?
        .ok_or("The working copy is no longer in the library.")?;
    if config.id != id || Path::new(&config.directory) != target {
        return Err("The working copy has a different folder than its library record.".into());
    }
    for path in [root.join("followed-packs"), root.join("followed-packs").join("games"), target.clone()] {
        check_real_directory(&path)?;
    }
    let saved = read_optional::<FollowReceipt>(&target.join(RECEIPT))?
        .ok_or("The working copy’s original release could not be found.")?;
    if saved.instance_id != id {
        return Err("The release record belongs to a different working copy.".into());
    }
    saved.release.validate(link)?;
    Ok(saved.release)
}

pub(super) fn working_copy(
    app: &tauri::AppHandle, link: &PlayerLink, id: &str, revision: Option<u64>,
    active: Arc<Mutex<bool>>, cancel: &AtomicBool,
    authorize_and_bind: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let _active = Active::begin(active, cancel)?;
    let root = bloom_data_dir()?;
    let base = root.join("followed-packs");
    make_directory(&base)?;
    let _lock = install_lock(&base)?;
    make_directory(&base.join("games"))?;
    let target = directory(&root, id);
    let record = root.join("instances").join(format!("{id}.json"));
    if target.try_exists().map_err(|e| e.to_string())? {
        check_real_directory(&target)?;
        let saved = read_optional::<FollowReceipt>(&target.join(RECEIPT))?
            .ok_or("An unrelated folder occupies the working copy path.")?;
        if saved.instance_id != id || revision.is_some_and(|expected| expected != saved.release.revision) {
            return Err("This folder belongs to another working copy.".into());
        }
        saved.release.validate(link)?;
        authorize_and_bind()?;
        if let Some(config) = read_optional::<InstanceConfig>(&record)? {
            if config.id == id && Path::new(&config.directory) == target { return Ok(()); }
            return Err("An unrelated library entry occupies the working copy ID.".into());
        }
        return recover(&root, link, id, list_instances_blocking).map(|_| ());
    }
    if record.try_exists().map_err(|e| e.to_string())? {
        return Err("An unrelated library entry occupies the working copy ID.".into());
    }
    let release = link.fetch_revision(revision)?;
    if revision.is_some_and(|expected| expected != release.revision) {
        return Err("Delight received a different release than the working copy requested.".into());
    }
    let pending = stage_release(app, link, &base, id, &release, cancel)?;
    let receipt = FollowReceipt {instance_id:id.to_owned(), release};
    let config = config_for(&root, &receipt, &list_instances_blocking()?);
    write_new(&pending.0.join(RECEIPT), &receipt)?;
    check_cancel(cancel)?;
    authorize_and_bind()?;
    commit_record(&root, Some(&pending.0), &config)
}

fn install(
    app: &tauri::AppHandle,
    link: PlayerLink,
    token: &str,
    active: Arc<Mutex<bool>>,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let url = link.display_url();
    let root = bloom_data_dir()?;
    let id = instance_id(&link.url());
    let base = root.join("followed-packs");
    make_directory(&base)?;
    // Serialize across client processes, including commits for packs with the same display name.
    let _lock = install_lock(&base)?;
    if lookup(&root, &id)?.is_some() {
        return Ok(id);
    }
    let _active = Active::begin(active, cancel)?;
    let records = root.join("instances");
    if records
        .join(format!("{id}.json"))
        .try_exists()
        .map_err(|e| e.to_string())?
    {
        return Err("An unrelated instance already occupies the pack installation ID.".into());
    }
    let games = base.join("games");
    make_directory(&games)?;
    if recover(&root, &link, &id, list_instances_blocking)?.is_some() {
        return Ok(id);
    }
    publish_progress(app, &url, 0, "Checking the reviewed release…");
    let release = link.fetch_for_install()?;
    if release.review_token() != token {
        return Err(STALE.into());
    }
    let pending = stage_release(app, &link, &base, &id, &release, cancel)?;
    let stage = &pending.0;
    let receipt = FollowReceipt {
        instance_id: id.clone(),
        release,
    };
    let config = config_for(&root, &receipt, &list_instances_blocking()?);
    check_cancel(cancel)?;
    publish_progress(app, &url, 55, "Preparing Minecraft and Fabric…");
    let runtime = RuntimeOperation::begin(app, &id, &url)?;
    let result = (|| {
        install_instance_files(app, &id, &config, &root.join("minecraft"), cancel, 55, 98)
            .map_err(|e| {
                if e == "__cancelled__" {
                    "Pack installation cancelled.".to_owned()
                } else {
                    e
                }
            })?;
        if link.fetch_for_install()?.review_token() != token {
            return Err(STALE.into());
        }
        check_cancel(cancel)?;
        write_new(&stage.join(RECEIPT), &receipt)?;
        publish_progress(app, &url, 99, "Adding the instance to your library…");
        commit_record(&root, Some(stage), &config)
    })();
    match &result {
        Ok(()) => crate::emit_launch(app, &id, "complete", 100, "Shared pack installed"),
        Err(error) => crate::emit_launch(
            app,
            &id,
            if cancel.load(Ordering::SeqCst) {
                "cancelled"
            } else {
                "error"
            },
            0,
            error,
        ),
    }
    drop(runtime);
    result?;
    Ok(id)
}

#[tauri::command]
pub(crate) async fn install_followed_pack(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    link: String,
    review_token: String,
) -> Result<String, String> {
    let parsed = PlayerLink::parse(&link)?;
    let active = state.launch_active.clone();
    let cancel = state.cancel_requested.clone();
    tauri::async_runtime::spawn_blocking(move || {
        install(&app, parsed, &review_token, active, &cancel)
    })
    .await
    .map_err(|e| format!("The pack installer stopped unexpectedly: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_player::PlayerManifest;

    pub(super) fn sample() -> (PlayerLink, FollowReceipt) {
        let link = PlayerLink {
            base: crate::workspace_publication::sharing_base().unwrap(),
            code: "ABCD2345".into(),
        };
        let file = PlayerFile {
            category: "resourcepacks".into(),
            file_name: "meadow.zip.disabled".into(),
            enabled: false,
            size: 5,
            source: "modrinth".into(),
            sha512: format!("{:x}", Sha512::digest(b"grass")),
            project_id: Some("abc".into()),
            version_id: Some("def".into()),
            download_url: Some("https://cdn.modrinth.com/data/abc/versions/def/meadow.zip".into()),
        };
        let release = PlayerRelease {
            code: link.code.clone(),
            url: link.url(),
            revision: 1,
            required: false,
            minimum_playable_revision: 1,
            creator: "Creator".into(),
            release_note: "First release".into(),
            created_at: "2026-11-24T12:00:00Z".into(),
            manifest: PlayerManifest {
                name: "Meadow".into(),
                minecraft_version: "1.21.1".into(),
                loader: "fabric".into(),
                loader_version: "0.16.10".into(),
                excluded_folders: vec!["config".into()],
                mod_dependency_policy: None,
                files: vec![file],
            },
        };
        let id = instance_id(&link.url());
        (
            link,
            FollowReceipt {
                instance_id: id,
                release,
            },
        )
    }

    #[test]
    fn download_verifies_every_byte_and_stops_at_the_published_size() {
        let (_, receipt) = sample();
        let file = &receipt.release.manifest.files[0];
        let cancel = AtomicBool::new(false);
        let mut bytes = Vec::new();
        verified_copy(&b"grass"[..], &mut bytes, file, &cancel).unwrap();
        assert_eq!(bytes, b"grass");
        for bad in [&b"glass"[..], &b"gras"[..], &b"grassland"[..]] {
            bytes.clear();
            assert!(verified_copy(bad, &mut bytes, file, &cancel).is_err());
            assert!(bytes.len() <= file.size as usize);
        }
        cancel.store(true, Ordering::SeqCst);
        bytes.clear();
        assert!(verified_copy(&b"grass"[..], &mut bytes, file, &cancel).is_err());
        assert!(bytes.is_empty());
    }

    #[test]
    fn interrupted_registration_restores_the_pinned_instance_without_overwriting_a_namesake() {
        let root = std::env::temp_dir().join(format!("delight-follow-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let _cleanup = Pending(root.clone());
        fs::create_dir(root.join("instances")).unwrap();
        let (link, receipt) = sample();
        let id = &receipt.instance_id;
        let game = directory(&root, id);
        fs::create_dir_all(game.join("resourcepacks")).unwrap();
        write_new(&game.join(RECEIPT), &receipt).unwrap();
        fs::write(game.join("resourcepacks/meadow.zip.disabled"), b"grass").unwrap();
        let mut namesake = config_for(&root, &receipt, &[]);
        namesake.id = "meadow".into();
        namesake.directory = root.join("personal").to_string_lossy().into_owned();
        write_new(&root.join("instances/meadow.json"), &namesake).unwrap();

        assert!(lookup(&root, id).unwrap().is_none());
        let saved = recover(&root, &link, id, || Ok(vec![namesake.clone()]))
            .unwrap()
            .unwrap();
        assert_eq!(saved.release.review_token(), receipt.release.review_token());
        let config_path = root.join("instances").join(format!("{id}.json"));
        let mut config: InstanceConfig = read_optional(&config_path).unwrap().unwrap();
        assert_eq!(config.name, "Meadow (2)");
        assert_eq!(config.version, "1.21.1");
        assert_eq!(config.loader_version.as_deref(), Some("0.16.10"));
        assert_eq!(config.directory, game.to_string_lossy());
        assert_eq!(
            read_optional::<InstanceConfig>(&root.join("instances/meadow.json"))
                .unwrap()
                .unwrap()
                .directory,
            namesake.directory
        );

        config.name = "My renamed pack".into();
        fs::write(config_path, serde_json::to_vec(&config).unwrap()).unwrap();
        assert_eq!(lookup(&root, id).unwrap().unwrap().release.url, link.url());
        assert!(lookup(&root, "meadow").unwrap().is_none());
        assert!(commit_record(&root, None, &namesake).is_err());
    }

    #[test]
    fn failed_or_cancelled_staging_never_registers_a_partial_instance() {
        let root = std::env::temp_dir().join(format!("delight-follow-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let _cleanup = Pending(root.clone());
        let (_, receipt) = sample();
        let stage = root.join("pending");
        fs::create_dir(&stage).unwrap();
        {
            let _pending = Pending(stage.clone());
            let file = &receipt.release.manifest.files[0];
            assert!(verified_copy(
                &b"bad"[..],
                File::create(stage.join(&file.file_name)).unwrap(),
                file,
                &AtomicBool::new(false)
            )
            .is_err());
        }
        assert!(!stage.exists());
        assert!(lookup(&root, &receipt.instance_id).unwrap().is_none());
    }

    #[test]
    fn damaged_interrupted_install_is_preserved_and_can_be_retried() {
        let root = std::env::temp_dir().join(format!("delight-follow-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let _cleanup = Pending(root.clone());
        let (link, receipt) = sample();
        let game = directory(&root, &receipt.instance_id);
        fs::create_dir_all(game.join("resourcepacks")).unwrap();
        write_new(&game.join(RECEIPT), &receipt).unwrap();
        fs::write(game.join("personal.txt"), b"keep me").unwrap();
        assert!(recover(&root, &link, &receipt.instance_id, || Ok(vec![])).is_err());
        assert!(!game.exists());
        let backup = fs::read_dir(root.join("followed-packs/recovery"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(fs::read(backup.join("personal.txt")).unwrap(), b"keep me");
        assert!(recover(&root, &link, &receipt.instance_id, || Ok(vec![]))
            .unwrap()
            .is_none());
        assert!(lookup(&root, &receipt.instance_id).unwrap().is_none());
    }

    #[test]
    fn runtime_reports_only_its_instance_with_real_transfer_activity() {
        let (link, receipt) = sample();
        let mut target = RuntimeTarget {
            id: receipt.instance_id.clone(),
            url: link.url(),
            progress: 55,
            sent: None,
        };
        let mut transfer = crate::LaunchProgress {
            instance_id: "elsewhere".into(),
            state: "installing".into(),
            progress: 72,
            message: "Downloading Minecraft libraries".into(),
            completed_at: None,
            launch_id: None,
            downloaded_bytes: 303_000,
            total_bytes: 400_000,
            bytes_per_second: 124_000,
        };
        let now = Instant::now();
        assert!(target.event(&transfer, now).is_none());
        transfer.instance_id = receipt.instance_id;
        let payload = target.event(&transfer, now).unwrap();
        assert_eq!(payload["progress"], 72);
        assert_eq!(payload["totalBytes"], 400_000);
        assert_eq!(payload["downloadedBytes"], 303_000);
        assert_eq!(payload["bytesPerSecond"], 124_000);
        assert_eq!(payload["link"], link.url());
        transfer.progress = 69;
        assert_eq!(
            target
                .event(&transfer, now + Duration::from_secs(1))
                .unwrap()["progress"],
            72
        );
        transfer.state = "complete".into();
        assert!(target
            .event(&transfer, now + Duration::from_secs(2))
            .is_none());
    }

    #[test]
    fn completed_and_failed_tasks_release_the_launch_gate_for_the_next_operation() {
        let flag = Arc::new(Mutex::new(false));
        let cancel = AtomicBool::new(false);
        for outcome in [Ok(()), Err("download failed")] {
            let result = (|| {
                let _guard = Active::begin(flag.clone(), &cancel)?;
                assert!(*flag.lock().unwrap());
                assert!(Active::begin(flag.clone(), &cancel).is_err());
                cancel.store(true, Ordering::SeqCst);
                outcome.map_err(String::from)
            })();
            assert_eq!(result.is_ok(), outcome.is_ok());
            assert!(!*flag.lock().unwrap());
            let _next = Active::begin(flag.clone(), &cancel).unwrap();
            assert!(!cancel.load(Ordering::SeqCst));
        }
    }
}
