use super::*;
use std::collections::{BTreeMap, HashMap};
#[path = "follow_game_process.rs"]
mod follow_game_process;
pub(crate) use follow_game_process::FollowGame;
#[path = "workspace_recovery.rs"]
pub(crate) mod recovery;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseChange {
    kind: &'static str,
    category: String,
    before: Option<String>,
    after: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateReview {
    installed_revision: u64,
    latest_revision: u64,
    required: bool,
    minimum_playable_revision: u64,
    release_note: String,
    creator: String,
    player_url: String,
    review_token: String,
    offline: bool,
    repair_needed: bool,
    repair_reason: Option<String>,
    minecraft_version_changed: bool,
    world_backup_directory: Option<String>,
    changes: Vec<ReleaseChange>,
}

fn file_key(file: &PlayerFile) -> (String, String) {
    (file.category.clone(), file.file_name.to_lowercase())
}

fn file_label(file: &PlayerFile) -> String {
    if file.enabled {
        file.file_name.clone()
    } else {
        format!(
            "{} (disabled)",
            &file.file_name[..file.file_name.len() - ".disabled".len()]
        )
    }
}

fn differences(old: &PlayerRelease, new: &PlayerRelease) -> Vec<ReleaseChange> {
    let mut changes = Vec::new();
    let previous = &old.manifest;
    let latest = &new.manifest;
    for (category, label, before, after) in [
        (
            "runtime",
            "Minecraft",
            &previous.minecraft_version,
            &latest.minecraft_version,
        ),
        (
            "runtime",
            "Fabric",
            &previous.loader_version,
            &latest.loader_version,
        ),
        ("pack", "Name", &previous.name, &latest.name),
        (
            "pack",
            "Excluded folders",
            &previous.excluded_folders.join(", "),
            &latest.excluded_folders.join(", "),
        ),
    ] {
        if before != after {
            let describe =
                |value: &str| format!("{label}: {}", if value.is_empty() { "None" } else { value });
            changes.push(ReleaseChange {
                kind: "changed",
                category: category.into(),
                before: Some(describe(before)),
                after: Some(describe(after)),
            });
        }
    }
    let identity = |file: &PlayerFile| {
        let (category, name) = file_key(file);
        (category, name.trim_end_matches(".disabled").to_owned())
    };
    let mut old_paths: BTreeMap<_, _> = previous.files.iter().map(|f| (identity(f), f)).collect();
    let mut added = Vec::new();
    let changed = |from: &PlayerFile, to: &PlayerFile| {
        let mut before = file_label(from);
        let mut after = file_label(to);
        if before == after && from.sha512 != to.sha512 {
            if from.version_id != to.version_id {
                if let (Some(old), Some(new)) = (&from.version_id, &to.version_id) {
                    before.push_str(&format!(" · {old}"));
                    after.push_str(&format!(" · {new}"));
                }
            } else {
                before.push_str(&format!(" · {}", &from.sha512[..8]));
                after.push_str(&format!(" · {}", &to.sha512[..8]));
            }
        }
        ReleaseChange {
            kind: "changed",
            category: to.category.clone(),
            before: Some(before),
            after: Some(after),
        }
    };
    for next in &latest.files {
        if let Some(old) = old_paths.remove(&identity(next)) {
            if old.sha512 != next.sha512 || old.file_name != next.file_name {
                changes.push(changed(old, next));
            }
        } else {
            added.push(next);
        }
    }
    // Match a renamed provider file only when its project identifies one file on both sides.
    let project = |file: &PlayerFile| {
        file.project_id
            .as_ref()
            .map(|id| (file.category.clone(), id.clone()))
    };
    let mut old_projects = HashMap::new();
    for (path, file) in &old_paths {
        if let Some(key) = project(file) {
            old_projects
                .entry(key)
                .and_modify(|p| *p = None)
                .or_insert_with(|| Some(path.clone()));
        }
    }
    let mut additions = HashMap::new();
    for file in &added {
        if let Some(key) = project(file) {
            *additions.entry(key).or_insert(0) += 1;
        }
    }
    for next in added {
        let previous = project(next)
            .filter(|key| additions.get(key) == Some(&1))
            .and_then(|key| old_projects.remove(&key).flatten())
            .and_then(|path| old_paths.remove(&path));
        changes.push(match previous {
            Some(old) => changed(old, next),
            None => ReleaseChange {
                kind: "added",
                category: next.category.clone(),
                before: None,
                after: Some(file_label(next)),
            },
        });
    }
    for file in old_paths.into_values() {
        changes.push(ReleaseChange {
            kind: "removed",
            category: file.category.clone(),
            before: Some(file_label(file)),
            after: None,
        });
    }
    changes
}

pub(crate) fn is_follow(id: &str) -> bool {
    follower_id(id)
}

pub(crate) fn atomic_record(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result =
        write_new(&temp, value).and_then(|_| fs::rename(&temp, path).map_err(|e| e.to_string()));
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

fn require_real_game(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !follower_id(id) {
        return Err("Choose a followed instance.".into());
    }
    let base = root.join("followed-packs");
    check_real_directory(&base)?;
    check_real_directory(&base.join("games"))?;
    let game = directory(root, id);
    check_real_directory(&game)?;
    Ok(game)
}

fn game_lease(root: &Path, id: &str) -> Result<FollowGame, String> {
    require_real_game(root, id)?;
    let lock = operation_lock(
        root,
        id,
        "game",
        "Close Minecraft and wait for the active pack operation to finish.",
    )?;
    FollowGame::acquire(lock, root.join("followed-packs/locks"), id)
}

// Ordinary edits remain available during play. An update must exclude concurrent
// writes to managed files and changes to the runtime pins in the instance record.
pub(crate) fn edit_lease(id: &str) -> Result<Option<File>, String> {
    if !follower_id(id) {
        return Ok(None);
    }
    operation_lock(
        &bloom_data_dir()?,
        id,
        "edit",
        "Wait for the active shared pack edit or update to finish.",
    )
    .map(Some)
}

fn operation_lock(root: &Path, id: &str, kind: &str, busy: &str) -> Result<File, String> {
    let folder = root.join("followed-packs").join("locks");
    check_real_directory(&root.join("followed-packs"))?;
    make_directory(&folder)?;
    let lease = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(folder.join(format!("{id}.{kind}")))
        .map_err(|e| e.to_string())?;
    lease.try_lock().map_err(|_| busy.to_owned())?;
    Ok(lease)
}

// Monotonic cache shared by preview, launch and update, including after a restart.
fn observe(
    root: &Path,
    saved: &FollowReceipt,
    fetched: Result<PlayerRelease, String>,
    allow_first_offline_play: bool,
) -> Result<(PlayerRelease, bool), String> {
    let base = root.join("followed-packs");
    let folder = base.join("known-releases");
    make_directory(&folder)?;
    let _lock = install_lock(&folder)?;
    let path = folder.join(format!("{}.json", saved.instance_id));
    let link = PlayerLink::parse(&saved.release.url)?;
    let cached: Option<PlayerRelease> = read_optional(&path)?;
    if let Some(release) = &cached {
        release.validate(&link)?;
    }
    let known = cached
        .as_ref()
        .filter(|r| r.revision >= saved.release.revision)
        .unwrap_or(&saved.release);
    match fetched {
        Err(error) => {
            if cached.is_some() || allow_first_offline_play {
                Ok((known.clone(), true))
            } else {
                Err(error)
            }
        }
        Ok(release) => {
            release.validate(&link)?;
            if release.revision < known.revision
                || release.minimum_playable_revision < known.minimum_playable_revision
                || (release.revision == known.revision
                    && release.review_token() != known.review_token())
            {
                return Err(
                    "The sharing service returned a conflicting release. Try again.".into(),
                );
            }
            if cached
                .as_ref()
                .is_none_or(|r| r.revision != release.revision)
            {
                atomic_record(&path, &release)?;
            }
            Ok((release, false))
        }
    }
}

fn read_follow(root: &Path, id: &str) -> Result<FollowReceipt, String> {
    require_real_game(root, id)?;
    lookup(root, id)?.ok_or_else(|| "This instance does not follow a shared pack.".into())
}

pub(crate) fn mod_maintenance_pins(id: &str) -> Result<Vec<PlayerFile>, String> {
    if !follower_id(id) {
        return Ok(Vec::new());
    }
    Ok(read_follow(&bloom_data_dir()?, id)?.release.manifest.files
        .into_iter().filter(|file| file.category == "mods").collect())
}

pub(crate) fn mod_maintenance_game_lease(id: &str) -> Result<Option<FollowGame>, String> {
    if !follower_id(id) {
        return Ok(None);
    }
    game_lease(&bloom_data_dir()?, id).map(Some)
}

fn review_token(installed: &PlayerRelease, latest: &PlayerRelease) -> String {
    format!("{}.{}", installed.review_token(), latest.review_token())
}

#[tauri::command]
pub(crate) async fn check_followed_pack_update(
    instance_id: String,
) -> Result<Option<UpdateReview>, String> {
    if !follower_id(&instance_id) {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = bloom_data_dir()?;
        let saved = read_follow(&root, &instance_id)?;
        let link = PlayerLink::parse(&saved.release.url)?;
        let remote = link.fetch();
        let (new, offline) = observe(&root, &saved, remote, false)?;
        let current = read_follow(&root, &instance_id)?.release;
        let latest = if new.revision < current.revision {
            &current
        } else {
            &new
        };
        let repair_reason = recovery::repair_reason(&root, &instance_id, &current);
        Ok(Some(UpdateReview {
            installed_revision: current.revision,
            latest_revision: latest.revision,
            required: current.revision < latest.minimum_playable_revision,
            minimum_playable_revision: latest.minimum_playable_revision,
            release_note: latest.release_note.clone(),
            creator: latest.creator.clone(),
            player_url: link.display_url(),
            review_token: review_token(&current, latest),
            offline,
            repair_needed: repair_reason.is_some(),
            repair_reason,
            minecraft_version_changed: current.manifest.minecraft_version != latest.manifest.minecraft_version,
            world_backup_directory: recovery::world_backup_directory(&root, &instance_id, current.revision),
            changes: differences(&current, latest),
        }))
    })
    .await
    .map_err(|_| "The pack update check stopped. Try again.".to_owned())?
}

fn touched<'a>(release: &'a PlayerRelease, other: &PlayerRelease) -> Vec<&'a PlayerFile> {
    let files: HashMap<_, _> = other
        .manifest
        .files
        .iter()
        .map(|f| (file_key(f), f))
        .collect();
    release
        .manifest
        .files
        .iter()
        .filter(|f| {
            files
                .get(&file_key(f))
                .is_none_or(|prior| prior.sha512 != f.sha512 || prior.file_name != f.file_name)
        })
        .collect()
}

fn path_for(base: &Path, file: &PlayerFile) -> PathBuf {
    base.join(&file.category).join(&file.file_name)
}

fn exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

fn check_file(path: &Path, file: &PlayerFile, cancel: &AtomicBool) -> Result<(), String> {
    let valid = fs::symlink_metadata(path)
        .is_ok_and(|m| m.is_file() && !instance_actions::linked(&m) && m.len() == file.size);
    if valid {
        let source = File::open(path).map_err(|e| e.to_string())?;
        if verified_copy(source, io::sink(), file, cancel).is_ok() {
            return Ok(());
        }
    }
    check_cancel(cancel)?;
    Err(format!("{} was moved or changed locally. Back up your changes and restore the installed file before updating.", file.file_name))
}

fn content_directories(base: &Path) -> Result<(), String> {
    for name in ["mods", "resourcepacks", "shaderpacks"] {
        make_directory(&base.join(name))?;
    }
    Ok(())
}

fn validate_destinations(
    game: &Path,
    old: &PlayerRelease,
    new: &PlayerRelease,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let owned: HashMap<_, _> = old
        .manifest
        .files
        .iter()
        .map(|f| (file_key(f), path_for(game, f)))
        .collect();
    for file in &old.manifest.files {
        check_file(&path_for(game, file), file, cancel)?;
    }
    for file in &new.manifest.files {
        let name = &file.file_name;
        let other = if file.enabled {
            format!("{name}.disabled")
        } else {
            name[..name.len() - ".disabled".len()].to_owned()
        };
        for name in [name.as_str(), &other] {
            let path = game.join(&file.category).join(name);
            if !exists(&path)? {
                continue;
            }
            // On case-insensitive filesystems an old spelling can identify the same owned entry.
            let previously_owned = owned
                .get(&(file.category.clone(), name.to_lowercase()))
                .is_some_and(|old| {
                    old == &path || same_file::is_same_file(old, &path).unwrap_or(false)
                });
            if !previously_owned {
                return Err(format!(
                    "A personal file uses {}. Move or rename it before updating.",
                    path.file_name().unwrap_or_default().to_string_lossy()
                ));
            }
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct UpdateJournal {
    previous: PlayerRelease,
    next: PlayerRelease,
}

fn pin_config(root: &Path, id: &str, target: &PlayerRelease) -> Result<InstanceConfig, String> {
    let record = root.join("instances").join(format!("{id}.json"));
    let mut config = read_optional::<InstanceConfig>(&record)?
        .ok_or("This instance was removed from the library.")?;
    if config.id != id || Path::new(&config.directory) != directory(root, id) {
        return Err("The followed instance moved during the update.".into());
    }
    let manifest = &target.manifest;
    if config.version != manifest.minecraft_version
        || config.loader_version.as_ref() != Some(&manifest.loader_version)
        || !config.loader.eq_ignore_ascii_case("fabric")
    {
        config.version = manifest.minecraft_version.clone();
        config.loader = "Fabric".into();
        config.loader_version = Some(manifest.loader_version.clone());
        atomic_record(&record, &config)?;
    }
    Ok(config)
}

fn retire(stage: &Path) -> Result<(), String> {
    let finished = stage.with_file_name(format!("finished-{}", uuid::Uuid::new_v4()));
    fs::rename(stage, &finished).map_err(|e| e.to_string())?;
    drop(Pending(finished));
    Ok(())
}

// The old receipt remains authoritative until every file and runtime pin has been activated.
// A stage hard link distinguishes files installed by this transaction from personal files.
fn recover_update(root: &Path, id: &str, stage: &Path) -> Result<(), String> {
    if !exists(stage)? {
        return Ok(());
    }
    check_real_directory(stage)?;
    let Some(journal) = read_optional::<UpdateJournal>(&stage.join("journal.json"))? else {
        return retire(stage);
    };
    let saved = read_follow(root, id)?;
    let link = PlayerLink::parse(&saved.release.url)?;
    journal.previous.validate(&link)?;
    journal.next.validate(&link)?;
    if saved.release.review_token() == journal.next.review_token() {
        return retire(stage);
    }
    if saved.release.review_token() != journal.previous.review_token() {
        return Err(
            "The interrupted update belongs to a different release. Your files were preserved."
                .into(),
        );
    }
    let game = require_real_game(root, id)?;
    let incoming = stage.join("incoming");
    let original = stage.join("original");
    for base in [&game, &incoming, &original] {
        check_real_directory(base)?;
        for category in ["mods", "resourcepacks", "shaderpacks"] {
            check_real_directory(&base.join(category))?;
        }
    }
    for file in touched(&journal.next, &journal.previous) {
        let live = path_for(&game, file);
        if exists(&live)?
            && same_file::is_same_file(&live, path_for(&incoming, file))
                .map_err(|e| e.to_string())?
        {
            // An external edit after a crash must remain available to the player.
            check_file(&live, file, &AtomicBool::new(false))?;
            fs::remove_file(&live).map_err(|e| e.to_string())?;
        }
    }
    for file in touched(&journal.previous, &journal.next) {
        let backup = path_for(&original, file);
        if !exists(&backup)? {
            continue;
        }
        let live = path_for(&game, file);
        if exists(&live)? {
            if !same_file::is_same_file(&backup, &live).map_err(|e| e.to_string())? {
                return Err(format!("Move the personal copy of {} aside so Delight can restore the interrupted update.", file.file_name));
            }
        } else {
            fs::hard_link(&backup, &live)
                .map_err(|e| format!("Could not restore {}: {e}", file.file_name))?;
        }
    }
    pin_config(root, id, &journal.previous)?;
    retire(stage)
}

fn transaction_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    let folder = root.join("followed-packs").join("updates");
    make_directory(&folder)?;
    Ok(folder.join(id))
}

pub(crate) fn before_play(id: &str) -> Result<Option<FollowGame>, String> {
    let root = bloom_data_dir()?;
    let lease = game_lease(&root, id)?;
    {
        let _edit = edit_lease(id)?;
        recover_update(&root, id, &transaction_dir(&root, id)?)?;
        recovery::recover_repair(&root, id)?;
    }
    let saved = read_follow(&root, id)?;
    let fetched = PlayerLink::parse(&saved.release.url)?.fetch();
    let (latest, _) = observe(&root, &saved, fetched, true)?;
    if saved.release.revision < latest.minimum_playable_revision {
        return Err(format!(
            "Update this shared pack to version {} before playing.",
            latest.minimum_playable_revision
        ));
    }
    Ok(Some(lease))
}

fn activate(
    root: &Path,
    id: &str,
    stage: &Path,
    previous: &PlayerRelease,
    next: &PlayerRelease,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let game = require_real_game(root, id)?;
    validate_destinations(&game, previous, next, cancel)?;
    let incoming = stage.join("incoming");
    let original = stage.join("original");
    crate::mod_duplicates::verify_mod_changes(&game.join("mods"), &incoming.join("mods"),
        touched(previous, next).into_iter().filter(|file| file.category == "mods").map(|file| file.file_name.to_ascii_lowercase()))?;
    for file in touched(next, previous) {
        check_file(&path_for(&incoming, file), file, cancel).map_err(|e| {
            if cancel.load(Ordering::SeqCst) {
                e
            } else {
                format!(
                    "The staged copy of {} failed verification. Retry the update.",
                    file.file_name
                )
            }
        })?;
    }
    recovery::backup_worlds(root, id, previous, next, cancel)
        .map_err(|error| format!("Could not back up your worlds. Your instance was not updated. {error}"))?;
    atomic_record(
        &stage.join("journal.json"),
        &UpdateJournal {
            previous: previous.clone(),
            next: next.clone(),
        },
    )?;
    // Verify no-clobber activation and rollback are supported before moving any live file.
    fs::hard_link(stage.join("journal.json"), stage.join("link-check"))
        .map_err(|e| format!("This drive cannot safely activate the shared pack update: {e}"))?;
    for file in touched(previous, next) {
        let backup = path_for(&original, file);
        fs::rename(path_for(&game, file), &backup)
            .map_err(|e| format!("Could not move {} for the update: {e}", file.file_name))?;
        check_file(&backup, file, cancel)?;
    }
    for file in touched(next, previous) {
        check_cancel(cancel)?;
        fs::hard_link(path_for(&incoming, file), path_for(&game, file))
            .map_err(|e| format!("Could not activate {}. Keep the instance on a drive supporting hard links and check for a conflicting file: {e}", file.file_name))?;
    }
    pin_config(root, id, next)?;
    atomic_record(
        &game.join(RECEIPT),
        &FollowReceipt {
            instance_id: id.to_owned(),
            release: next.clone(),
        },
    )
}

fn update(
    app: &tauri::AppHandle,
    id: &str,
    token: &str,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let root = bloom_data_dir()?;
    let _lease = game_lease(&root, id)?;
    let _edit = edit_lease(id)?;
    let stage = transaction_dir(&root, id)?;
    recover_update(&root, id, &stage)?;
    recovery::recover_repair(&root, id)?;
    let saved = read_follow(&root, id)?;
    let old = &saved.release;
    if token
        .split_once('.')
        .is_some_and(|(_, target)| target == old.review_token())
    {
        return Ok(id.into());
    }
    let link = PlayerLink::parse(&old.url)?;
    let progress_url = link.display_url();
    let fetched = link.fetch()?;
    let (next, _) = observe(&root, &saved, Ok(fetched), false)?;
    if next.revision <= old.revision || review_token(old, &next) != token {
        return Err("The release changed since your review. Check for updates again.".into());
    }
    let game = directory(&root, id);
    content_directories(&game)?;
    validate_destinations(&game, old, &next, cancel)?;
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        let incoming = stage.join("incoming");
        let original = stage.join("original");
        for folder in [&incoming, &original] {
            fs::create_dir(folder).map_err(|e| e.to_string())?;
            content_directories(folder)?;
        }
        let client = pack_download_client()?;
        let hashes: HashMap<_, _> = old.manifest.files.iter().map(|f| (&f.sha512, f)).collect();
        let incoming_files = touched(&next, old);
        for (index, file) in incoming_files.iter().enumerate() {
            check_cancel(cancel)?;
            publish_progress(
                app,
                &progress_url,
                (index * 55 / incoming_files.len()) as u8,
                &format!("Verifying {}", file.file_name),
            );
            if let Some(existing) = hashes.get(&file.sha512) {
                let source = File::open(path_for(&game, existing)).map_err(|e| e.to_string())?;
                let mut output =
                    File::create_new(path_for(&incoming, file)).map_err(|e| e.to_string())?;
                verified_copy(source, &mut output, file, cancel)?;
                output.sync_all().map_err(|e| e.to_string())?;
            } else {
                stage_file(&client, &incoming, &next, file, cancel)?;
            }
        }
        crate::pack_compatibility::runtime::verify_release(&next, |file| {
            if incoming_files.iter().any(|picked| file_key(picked) == file_key(file)) {
                path_for(&incoming, file)
            } else {
                path_for(&game, file)
            }
        })?;
        if old.manifest.minecraft_version != next.manifest.minecraft_version
            || old.manifest.loader_version != next.manifest.loader_version
        {
            let mut runtime = crate::load_instance(id)?;
            runtime.version = next.manifest.minecraft_version.clone();
            runtime.loader = "Fabric".into();
            runtime.loader_version = Some(next.manifest.loader_version.clone());
            publish_progress(app, &progress_url, 55, "Preparing Minecraft and Fabric…");
            let _progress = RuntimeOperation::begin(app, id, &progress_url)?;
            install_instance_files(app, id, &runtime, &root.join("minecraft"), cancel, 55, 96)
                .map_err(|e| {
                    if e == "__cancelled__" {
                        "Pack update cancelled.".into()
                    } else {
                        e
                    }
                })?;
        }
        check_cancel(cancel)?;
        let message = if old.manifest.minecraft_version != next.manifest.minecraft_version {
            "Backing up worlds and applying the update…"
        } else {
            "Applying pack update…"
        };
        publish_progress(app, &progress_url, 97, message);
        activate(&root, id, &stage, old, &next, cancel)
    })();
    // Recovery is idempotent before, during, and after the receipt swap.
    recover_update(&root, id, &stage)
        .map_err(|e| format!("The pack update needs recovery: {e}"))?;
    result?;
    Ok(id.to_owned())
}

fn pack_download_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .user_agent("DelightClient/PackWorkspace")
        .build()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn update_followed_pack(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
    review_token: String,
) -> Result<String, String> {
    if !follower_id(&instance_id) {
        return Err("Choose a followed instance.".into());
    }
    let cancel = state.cancel_requested.clone();
    let active = Active::begin(state.launch_active.clone(), &cancel)?;
    if state.game_running.load(Ordering::SeqCst)
        || state.content_install_active.load(Ordering::SeqCst)
    {
        return Err("Close Minecraft and wait for active downloads before updating.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _active = active;
        let result = update(&app, &instance_id, &review_token, &cancel);
        match &result {
            Ok(_) => crate::emit_launch(&app, &instance_id, "complete", 100, "Shared pack updated"),
            Err(e) => crate::emit_launch(
                &app,
                &instance_id,
                if cancel.load(Ordering::SeqCst) {
                    "cancelled"
                } else {
                    "error"
                },
                0,
                e,
            ),
        }
        result
    })
    .await
    .map_err(|e| format!("The pack update stopped unexpectedly: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) struct Installed {
        pub(super) root: PathBuf,
        pub(super) saved: FollowReceipt,
        _cleanup: Pending,
    }
    impl Installed {
        pub(super) fn new() -> Self {
            let (_, saved) = super::super::tests::sample();
            let root =
                std::env::temp_dir().join(format!("delight-update-{}", uuid::Uuid::new_v4()));
            let game = directory(&root, &saved.instance_id);
            fs::create_dir_all(&game).unwrap();
            content_directories(&game).unwrap();
            let file = &saved.release.manifest.files[0];
            fs::write(path_for(&game, file), b"grass").unwrap();
            write_new(&game.join(RECEIPT), &saved).unwrap();
            fs::create_dir(root.join("instances")).unwrap();
            let mut config = config_for(&root, &saved, &[]);
            config.name = "My Meadow".into();
            config.memory = 8192;
            write_new(
                &root
                    .join("instances")
                    .join(format!("{}.json", saved.instance_id)),
                &config,
            )
            .unwrap();
            let cleanup = Pending(root.clone());
            Self {
                root,
                saved,
                _cleanup: cleanup,
            }
        }
        pub(super) fn game(&self) -> PathBuf {
            directory(&self.root, &self.saved.instance_id)
        }
        fn stage(&self) -> PathBuf {
            let stage = transaction_dir(&self.root, &self.saved.instance_id).unwrap();
            fs::create_dir(&stage).unwrap();
            for folder in ["incoming", "original"] {
                fs::create_dir(stage.join(folder)).unwrap();
                content_directories(&stage.join(folder)).unwrap();
            }
            stage
        }
        fn next(&self) -> PlayerRelease {
            let mut next = self.saved.release.clone();
            next.revision += 1;
            next.required = true;
            next.minimum_playable_revision = next.revision;
            next.manifest.loader_version = "0.18.1".into();
            let file = &mut next.manifest.files[0];
            file.file_name = "meadow.zip".into();
            file.enabled = true;
            file.sha512 = format!("{:x}", Sha512::digest(b"stone"));
            next
        }
    }

    #[test]
    fn legacy_follow_downloads_update_into_same_library_record_and_keeps_personal_files() {
        let setup = Installed::new();
        let game = setup.game();
        // Receipt written by the first install-and-follow prototype.
        let mut legacy = serde_json::to_value(&setup.saved).unwrap();
        legacy["release"]
            .as_object_mut()
            .unwrap()
            .remove("required");
        legacy["release"]
            .as_object_mut()
            .unwrap()
            .remove("minimumPlayableRevision");
        atomic_record(&game.join(RECEIPT), &legacy).unwrap();
        let saved = read_follow(&setup.root, &setup.saved.instance_id).unwrap();
        assert_eq!(saved.release.minimum_playable_revision, 1);
        let stage = setup.stage();
        let next = setup.next();
        let change = differences(&saved.release, &next);
        assert!(change.iter().any(|c| c.kind == "changed"
            && c.before.as_deref() == Some("meadow.zip (disabled)")
            && c.after.as_deref() == Some("meadow.zip")));
        assert!(change
            .iter()
            .any(|c| c.category == "runtime" && c.after.as_deref() == Some("Fabric: 0.18.1")));
        fs::create_dir_all(game.join("saves/Meadow")).unwrap();
        fs::write(game.join("saves/Meadow/level.dat"), b"world").unwrap();
        fs::write(game.join("mods/personal.jar"), b"personal").unwrap();
        fs::write(stage.join("incoming/resourcepacks/meadow.zip"), b"stone").unwrap();
        activate(
            &setup.root,
            &saved.instance_id,
            &stage,
            &saved.release,
            &next,
            &AtomicBool::new(false),
        )
        .unwrap();
        recover_update(&setup.root, &saved.instance_id, &stage).unwrap();
        assert!(!stage.exists());
        assert_eq!(
            fs::read_dir(setup.root.join("instances")).unwrap().count(),
            1
        );
        let record: InstanceConfig = read_optional(
            &setup
                .root
                .join("instances")
                .join(format!("{}.json", saved.instance_id)),
        )
        .unwrap()
        .unwrap();
        assert_eq!(record.name, "My Meadow");
        assert_eq!(record.memory, 8192);
        assert_eq!(record.loader_version.as_deref(), Some("0.18.1"));
        assert_eq!(
            read_follow(&setup.root, &record.id)
                .unwrap()
                .release
                .revision,
            2
        );
        assert_eq!(
            fs::read(game.join("saves/Meadow/level.dat")).unwrap(),
            b"world"
        );
        assert_eq!(
            fs::read(game.join("mods/personal.jar")).unwrap(),
            b"personal"
        );
        assert_eq!(
            fs::read(game.join("resourcepacks/meadow.zip")).unwrap(),
            b"stone"
        );
        assert!(!game.join("resourcepacks/meadow.zip.disabled").exists());
    }

    #[test]
    fn failed_stage_hash_modified_managed_files_and_personal_collisions_never_overwrite() {
        let setup = Installed::new();
        let next = setup.next();
        let game = setup.game();
        let stage = setup.stage();
        let cancel = AtomicBool::new(false);
        let apply = || {
            activate(
                &setup.root,
                &setup.saved.instance_id,
                &stage,
                &setup.saved.release,
                &next,
                &cancel,
            )
        };
        fs::write(stage.join("incoming/resourcepacks/meadow.zip"), b"stOne").unwrap();
        assert!(apply().unwrap_err().contains("failed verification"));
        assert!(!stage.join("journal.json").exists());
        fs::write(stage.join("incoming/resourcepacks/meadow.zip"), b"stone").unwrap();
        fs::write(game.join("resourcepacks/meadow.zip"), b"mine").unwrap();
        assert!(apply().unwrap_err().contains("personal file"));
        assert_eq!(
            fs::read(game.join("resourcepacks/meadow.zip")).unwrap(),
            b"mine"
        );
        fs::remove_file(game.join("resourcepacks/meadow.zip")).unwrap();
        fs::write(game.join("resourcepacks/meadow.zip.disabled"), b"local").unwrap();
        assert!(apply().unwrap_err().contains("changed locally"));
        assert_eq!(
            fs::read(game.join("resourcepacks/meadow.zip.disabled")).unwrap(),
            b"local"
        );
        assert_eq!(
            read_follow(&setup.root, &setup.saved.instance_id)
                .unwrap()
                .release
                .revision,
            1
        );
    }

    #[test]
    fn minecraft_version_change_copies_worlds_before_committing() {
        let setup = Installed::new();
        let mut next = setup.next();
        next.manifest.minecraft_version = "1.20.1".into();
        let game = setup.game();
        let stage = setup.stage();
        let world = game.join("saves/Meadow");
        fs::create_dir_all(world.join("region")).unwrap();
        fs::write(world.join("level.dat"), b"old world").unwrap();
        fs::write(world.join("region/r.0.0.mca"), b"old region").unwrap();
        fs::write(path_for(&stage.join("incoming"), &next.manifest.files[0]), b"stone").unwrap();
        activate(
            &setup.root, &setup.saved.instance_id, &stage, &setup.saved.release, &next,
            &AtomicBool::new(false),
        ).unwrap();
        recover_update(&setup.root, &setup.saved.instance_id, &stage).unwrap();
        let preserved = PathBuf::from(recovery::world_backup_directory(
            &setup.root, &setup.saved.instance_id, next.revision,
        ).unwrap());
        fs::write(world.join("level.dat"), b"new world").unwrap();
        assert_eq!(fs::read(preserved.join("saves/Meadow/level.dat")).unwrap(), b"old world");
        assert_eq!(fs::read(preserved.join("saves/Meadow/region/r.0.0.mca")).unwrap(), b"old region");
        assert_eq!(read_follow(&setup.root, &setup.saved.instance_id).unwrap().release.revision, next.revision);
    }

    #[test]
    fn failed_world_backup_prevents_update_mutation() {
        let setup = Installed::new();
        let mut next = setup.next();
        next.manifest.minecraft_version = "1.20.1".into();
        let game = setup.game();
        let stage = setup.stage();
        let world = game.join("saves/Meadow");
        fs::create_dir_all(&world).unwrap();
        fs::write(world.join("level.dat"), b"original world").unwrap();
        fs::write(setup.root.join("followed-packs/backups"), b"not a backup directory").unwrap();
        fs::write(path_for(&stage.join("incoming"), &next.manifest.files[0]), b"stone").unwrap();
        let result = activate(
            &setup.root, &setup.saved.instance_id, &stage, &setup.saved.release, &next,
            &AtomicBool::new(false),
        );
        assert!(result.unwrap_err().contains("Could not back up your worlds"));
        assert!(!stage.join("journal.json").exists());
        assert!(!path_for(&game, &next.manifest.files[0]).exists());
        recover_update(&setup.root, &setup.saved.instance_id, &stage).unwrap();
        assert_eq!(fs::read(world.join("level.dat")).unwrap(), b"original world");
        let old = read_follow(&setup.root, &setup.saved.instance_id).unwrap().release;
        assert_eq!(old.revision, setup.saved.release.revision);
        assert_eq!(old.manifest.minecraft_version, setup.saved.release.manifest.minecraft_version);
        assert_eq!(fs::read(path_for(&game, &old.manifest.files[0])).unwrap(), b"grass");
    }

    #[test]
    fn interrupted_activation_restores_original_bytes_and_runtime_before_play_or_retry() {
        let setup = Installed::new();
        let stage = setup.stage();
        let game = setup.game();
        let next = setup.next();
        let old_file = &setup.saved.release.manifest.files[0];
        let new_file = &next.manifest.files[0];
        fs::write(path_for(&stage.join("incoming"), new_file), b"stone").unwrap();
        atomic_record(
            &stage.join("journal.json"),
            &UpdateJournal {
                previous: setup.saved.release.clone(),
                next: next.clone(),
            },
        )
        .unwrap();
        fs::rename(
            path_for(&game, old_file),
            path_for(&stage.join("original"), old_file),
        )
        .unwrap();
        fs::hard_link(
            path_for(&stage.join("incoming"), new_file),
            path_for(&game, new_file),
        )
        .unwrap();
        pin_config(&setup.root, &setup.saved.instance_id, &next).unwrap();
        recover_update(&setup.root, &setup.saved.instance_id, &stage).unwrap();
        recover_update(&setup.root, &setup.saved.instance_id, &stage).unwrap();
        assert!(!path_for(&game, new_file).exists());
        assert_eq!(fs::read(path_for(&game, old_file)).unwrap(), b"grass");
        let config: InstanceConfig = read_optional(
            &setup
                .root
                .join("instances")
                .join(format!("{}.json", setup.saved.instance_id)),
        )
        .unwrap()
        .unwrap();
        assert_eq!(config.name, "My Meadow");
        assert_eq!(config.loader_version.as_deref(), Some("0.16.10"));
    }

    #[test]
    fn offline_policy_survives_restart_and_skipped_required_versions() {
        let setup = Installed::new();
        let current = &setup.saved;
        let unavailable = || Err("Offline".to_owned());
        assert!(observe(&setup.root, current, unavailable(), false).is_err());
        let (playable, offline) = observe(&setup.root, current, unavailable(), true).unwrap();
        assert_eq!(playable.minimum_playable_revision, 1);
        assert!(offline);
        let mut v3 = setup.next();
        v3.revision = 3;
        v3.required = false; // The owner marked Version 2 required and Version 3 optional.
        let (fresh, offline) = observe(&setup.root, current, Ok(v3.clone()), false).unwrap();
        assert!(!offline);
        assert!(current.release.revision < fresh.minimum_playable_revision);
        let (cached, offline) = observe(&setup.root, current, unavailable(), true).unwrap();
        assert!(offline);
        assert_eq!(cached.minimum_playable_revision, 2);
        assert!(observe(&setup.root, current, Ok(current.release.clone()), false).is_err());
        let mut changed = v3;
        changed.minimum_playable_revision = 1;
        assert!(observe(&setup.root, current, Ok(changed), false).is_err());
        let lease = game_lease(&setup.root, &current.instance_id).unwrap();
        assert!(game_lease(&setup.root, &current.instance_id).is_err());
        drop(lease);
        assert!(game_lease(&setup.root, &current.instance_id).is_ok());
    }
}
