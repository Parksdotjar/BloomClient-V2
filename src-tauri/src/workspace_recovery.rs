use super::*;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
struct RepairEntry {
    index: usize,
    installed_exists: bool,
    alternate_exists: bool,
}

#[derive(Deserialize, Serialize)]
struct RepairJournal {
    release_token: String,
    backup: Option<Uuid>,
    entries: Vec<RepairEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepairResult {
    repaired_files: usize,
    backup_directory: Option<String>,
}

fn backup_home(root: &Path, id: &str) -> PathBuf {
    root.join("followed-packs").join("backups").join(id)
}

fn create_backup_home(root: &Path, id: &str) -> Result<PathBuf, String> {
    check_real_directory(&root.join("followed-packs"))?;
    let home = backup_home(root, id);
    make_directory(home.parent().ok_or("The backup location is invalid.")?)?;
    make_directory(&home)?;
    Ok(home)
}

fn repair_stage(root: &Path, id: &str) -> PathBuf {
    root.join("followed-packs").join("repairs").join(id)
}

fn repair_backup(root: &Path, id: &str, key: Uuid) -> PathBuf {
    backup_home(root, id).join(format!("files-{key}"))
}

fn alternate_name(file: &PlayerFile) -> String {
    if file.enabled {
        format!("{}.disabled", file.file_name)
    } else {
        file.file_name[..file.file_name.len() - ".disabled".len()].to_owned()
    }
}

fn file_paths(directory: &Path, file: &PlayerFile) -> [PathBuf; 2] {
    [
        path_for(directory, file),
        directory.join(&file.category).join(alternate_name(file)),
    ]
}

fn regular_file(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !instance_actions::linked(&metadata) => {
            Ok(Some(metadata))
        }
        Ok(_) => Err(format!(
            "{} is a folder or linked file. Move it out of the pack folder before repairing.",
            path.file_name().unwrap_or_default().to_string_lossy()
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not inspect {}: {error}", path.display())),
    }
}

pub(super) fn repair_reason(root: &Path, id: &str, release: &PlayerRelease) -> Option<String> {
    if repair_stage(root, id).try_exists().unwrap_or(false) {
        return Some("A pack repair was interrupted.".into());
    }
    let game = require_real_game(root, id).ok()?;
    // Regular polling only checks filesystem metadata. The repair rehashes every untouched file.
    for file in &release.manifest.files {
        let paths = file_paths(&game, file);
        if let Err(error) = check_real_directory(&game.join(&file.category)) {
            return Some(error);
        }
        match (regular_file(&paths[0]), regular_file(&paths[1])) {
            (Ok(Some(kept)), Ok(None)) if kept.len() == file.size => {}
            (Err(error), _) | (_, Err(error)) => return Some(error),
            _ => return Some(format!("{} is missing or changed.", file.file_name)),
        }
    }
    None
}

fn repair_entries(
    game: &Path,
    release: &PlayerRelease,
    cancel: &AtomicBool,
) -> Result<Vec<RepairEntry>, String> {
    let mut entries = Vec::new();
    for (index, file) in release.manifest.files.iter().enumerate() {
        check_cancel(cancel)?;
        let [installed, alternate] = file_paths(game, file);
        let installed_exists = regular_file(&installed)?.is_some();
        let alternate_exists = regular_file(&alternate)?.is_some();
        if alternate_exists || !installed_exists || check_file(&installed, file, cancel).is_err() {
            entries.push(RepairEntry {
                index,
                installed_exists,
                alternate_exists,
            });
        }
    }
    check_cancel(cancel)?;
    Ok(entries)
}

fn backup_paths(
    directory: &Path,
    file: &PlayerFile,
    entry: &RepairEntry,
) -> impl Iterator<Item = PathBuf> {
    file_paths(directory, file)
        .into_iter()
        .zip([entry.installed_exists, entry.alternate_exists])
        .filter_map(|(path, present)| present.then_some(path))
}

fn repair_journal_matches(journal: &RepairJournal, release: &PlayerRelease) -> bool {
    let mut seen = HashSet::new();
    !journal.entries.is_empty()
        && journal.release_token == release.review_token()
        && journal.backup.is_some()
            == journal
                .entries
                .iter()
                .any(|entry| entry.installed_exists || entry.alternate_exists)
        && journal
            .entries
            .iter()
            .all(|entry| entry.index < release.manifest.files.len() && seen.insert(entry.index))
}

pub(super) fn recover_repair(root: &Path, id: &str) -> Result<(), String> {
    let stage = repair_stage(root, id);
    if !exists(&stage)? {
        return Ok(());
    }
    check_real_directory(&root.join("followed-packs/repairs"))?;
    check_real_directory(&stage)?;
    let journal_path = stage.join("repair.json");
    let Some(journal) = read_optional::<RepairJournal>(&journal_path)? else {
        return retire(&stage);
    };
    let game = require_real_game(root, id)?;
    let release = read_follow(root, id)?.release;
    if !repair_journal_matches(&journal, &release) {
        return Err(
            "The interrupted repair belongs to another release. The backup was preserved.".into(),
        );
    }
    let committed = stage.join("committed.json");
    if regular_file(&committed)?.is_some() {
        if same_file::is_same_file(&committed, &journal_path).map_err(|error| error.to_string())? {
            return retire(&stage);
        }
        return Err("The repair completion record is invalid. The backup was preserved.".into());
    }
    let incoming = stage.join("incoming");
    let backup = journal.backup.map(|key| repair_backup(root, id, key));
    check_real_directory(&incoming)?;
    if let Some(backup) = &backup {
        check_real_directory(&root.join("followed-packs/backups"))?;
        check_real_directory(&backup_home(root, id))?;
        check_real_directory(backup)?;
    }
    for entry in journal.entries {
        let file = &release.manifest.files[entry.index];
        check_real_directory(&game.join(&file.category))?;
        check_real_directory(&incoming.join(&file.category))?;
        let live = path_for(&game, file);
        let staged = path_for(&incoming, file);
        if regular_file(&live)?.is_some()
            && same_file::is_same_file(&live, &staged).map_err(|error| error.to_string())?
        {
            // An external edit after a crash can change the staged hard link as well.
            check_file(&live, file, &AtomicBool::new(false))?;
            fs::remove_file(&live).map_err(|error| error.to_string())?;
        }
        if let Some(backup) = &backup {
            check_real_directory(&backup.join(&file.category))?;
            let live = backup_paths(&game, file, &entry);
            for (source, target) in backup_paths(backup, file, &entry).zip(live) {
                if regular_file(&source)?.is_none() {
                    // The original was left untouched when the move never started.
                    continue;
                }
                if regular_file(&target)?.is_none() {
                    fs::hard_link(&source, &target).map_err(|error| {
                        format!("Could not recover {}: {error}", target.display())
                    })?;
                } else if !same_file::is_same_file(&source, &target)
                    .map_err(|error| error.to_string())?
                {
                    return Err(format!("Move the local file {} aside so Delight can finish recovering your pack. The backup is at {}.", target.display(), backup.display()));
                }
            }
        }
    }
    // Retire first. If the process stops during cleanup, the file copies remain safe.
    retire(&stage)?;
    if let Some(backup) = backup {
        drop(Pending(backup));
    }
    Ok(())
}

fn activate_repair(
    root: &Path,
    id: &str,
    stage: &Path,
    release: &PlayerRelease,
    entries: Vec<RepairEntry>,
    cancel: &AtomicBool,
) -> Result<RepairResult, String> {
    let game = require_real_game(root, id)?;
    content_directories(&game)?;
    let incoming = stage.join("incoming");
    if repair_entries(&game, release, cancel)? != entries {
        return Err("The local files changed during repair. Try again.".into());
    }
    crate::mod_duplicates::verify_mod_changes(&game.join("mods"), &incoming.join("mods"),
        entries.iter().filter_map(|entry| {
            let file = &release.manifest.files[entry.index];
            (file.category == "mods").then(|| file.file_name.trim_end_matches(".disabled").to_ascii_lowercase())
        }))?;
    for entry in &entries {
        let file = &release.manifest.files[entry.index];
        check_file(&path_for(&incoming, file), file, cancel)?;
    }
    let key = entries
        .iter()
        .any(|entry| entry.installed_exists || entry.alternate_exists)
        .then(Uuid::new_v4);
    let backup = key.map(|key| repair_backup(root, id, key));
    if let Some(backup) = &backup {
        create_backup_home(root, id)?;
        fs::create_dir(backup)
            .map_err(|error| format!("Could not create the local file backup: {error}"))?;
        if let Err(error) = content_directories(backup) {
            drop(Pending(backup.clone()));
            return Err(error);
        }
    }
    let journal_path = stage.join("repair.json");
    let journal = RepairJournal {
        release_token: release.review_token(),
        backup: key,
        entries,
    };
    if let Err(error) = atomic_record(&journal_path, &journal) {
        if let Some(backup) = backup {
            drop(Pending(backup));
        }
        return Err(error);
    }
    // Test the no-clobber mechanism before moving any live files.
    fs::hard_link(&journal_path, stage.join("link-check"))
        .map_err(|error| format!("This drive cannot safely repair the pack: {error}"))?;
    for entry in &journal.entries {
        check_cancel(cancel)?;
        let file = &release.manifest.files[entry.index];
        if let Some(backup) = &backup {
            let targets = backup_paths(backup, file, entry);
            for (source, target) in backup_paths(&game, file, entry).zip(targets) {
                regular_file(&source)?
                    .ok_or("A local file moved while Delight was repairing the pack.")?;
                // Links create a backup without overwriting a destination. Drop the
                // original pathname only after the backup points at the same bytes.
                fs::hard_link(&source, &target)
                    .map_err(|error| format!("Could not back up {}: {error}", source.display()))?;
                if !same_file::is_same_file(&source, &target).map_err(|error| error.to_string())? {
                    return Err("A local file changed while Delight was backing it up.".into());
                }
                fs::remove_file(&source).map_err(|error| error.to_string())?;
            }
        }
        fs::hard_link(path_for(&incoming, file), path_for(&game, file))
            .map_err(|error| format!("Could not restore {}: {error}", file.file_name))?;
    }
    fs::hard_link(journal_path, stage.join("committed.json")).map_err(|error| error.to_string())?;
    Ok(RepairResult {
        repaired_files: journal.entries.len(),
        backup_directory: backup.map(|path| path.to_string_lossy().into_owned()),
    })
}

fn repair(app: &tauri::AppHandle, id: &str, cancel: &AtomicBool) -> Result<RepairResult, String> {
    let root = bloom_data_dir()?;
    let _lease = game_lease(&root, id)?;
    let _edit = edit_lease(id)?;
    recover_update(&root, id, &transaction_dir(&root, id)?)?;
    recover_repair(&root, id)?;
    let game = require_real_game(&root, id)?;
    let release = read_follow(&root, id)?.release;
    let progress_url = PlayerLink::parse(&release.url)?.display_url();
    publish_progress(app, &progress_url, 0, "Checking installed pack files…");
    content_directories(&game)?;
    let entries = repair_entries(&game, &release, cancel)?;
    if entries.is_empty() {
        return Ok(RepairResult {
            repaired_files: 0,
            backup_directory: None,
        });
    }
    let stage = repair_stage(&root, id);
    make_directory(stage.parent().ok_or("The repair location is invalid.")?)?;
    fs::create_dir(&stage).map_err(|error| error.to_string())?;
    let result = (|| {
        let incoming = stage.join("incoming");
        fs::create_dir(&incoming).map_err(|error| error.to_string())?;
        content_directories(&incoming)?;
        let client = pack_download_client()?;
        for (index, entry) in entries.iter().enumerate() {
            check_cancel(cancel)?;
            let file = &release.manifest.files[entry.index];
            publish_progress(
                app,
                &progress_url,
                (5 + index * 80 / entries.len()) as u8,
                &format!("Restoring {}", file.file_name),
            );
            let reusable = file_paths(&game, file)
                .into_iter()
                .find(|path| check_file(path, file, cancel).is_ok());
            if let Some(path) = reusable {
                let source = File::open(path).map_err(|error| error.to_string())?;
                let mut output = File::create_new(path_for(&incoming, file))
                    .map_err(|error| error.to_string())?;
                verified_copy(source, &mut output, file, cancel)?;
                output.sync_all().map_err(|error| error.to_string())?;
            } else {
                stage_file(&client, &incoming, &release, file, cancel)?;
            }
        }
        crate::pack_compatibility::runtime::verify_release(&release, |file| {
            if entries.iter().any(|entry| file_key(&release.manifest.files[entry.index]) == file_key(file)) {
                path_for(&incoming, file)
            } else {
                path_for(&game, file)
            }
        })?;
        publish_progress(
            app,
            &progress_url,
            93,
            "Backing up local files and applying the repair…",
        );
        activate_repair(&root, id, &stage, &release, entries, cancel)
    })();
    recover_repair(&root, id)
        .map_err(|error| format!("The pack repair needs recovery: {error}"))?;
    result
}

#[tauri::command]
pub(crate) async fn repair_followed_pack(
    app: tauri::AppHandle,
    state: tauri::State<'_, LauncherState>,
    instance_id: String,
) -> Result<RepairResult, String> {
    if !follower_id(&instance_id) {
        return Err("Choose a followed instance.".into());
    }
    let cancel = state.cancel_requested.clone();
    let active = Active::begin(state.launch_active.clone(), &cancel)?;
    if state.game_running.load(Ordering::SeqCst)
        || state.content_install_active.load(Ordering::SeqCst)
    {
        return Err("Close Minecraft and wait for active downloads before repairing.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _active = active;
        let result = repair(&app, &instance_id, &cancel);
        match &result {
            Ok(_) => crate::emit_launch(&app, &instance_id, "complete", 100, "Pack files checked"),
            Err(error) => crate::emit_launch(
                &app,
                &instance_id,
                if cancel.load(Ordering::SeqCst) {
                    "cancelled"
                } else {
                    "error"
                },
                0,
                error,
            ),
        }
        result
    })
    .await
    .map_err(|error| format!("The pack repair stopped unexpectedly: {error}"))?
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorldBackup {
    from_revision: u64,
    to_revision: u64,
    from_minecraft: String,
    to_minecraft: String,
}

pub(crate) fn copy_saves(source: &Path, destination: &Path, cancel: &AtomicBool) -> Result<(), String> {
    let mut paths = vec![(source.to_path_buf(), destination.to_path_buf())];
    while let Some((source, destination)) = paths.pop() {
        check_cancel(cancel)?;
        let metadata = fs::symlink_metadata(&source).map_err(|error| error.to_string())?;
        if instance_actions::linked(&metadata) {
            return Err(format!(
                "{} is linked. Copy the linked world into saves before updating.",
                source.display()
            ));
        }
        if metadata.is_dir() {
            fs::create_dir(&destination).map_err(|error| error.to_string())?;
            for entry in fs::read_dir(&source).map_err(|error| error.to_string())? {
                let entry = entry.map_err(|error| error.to_string())?;
                paths.push((entry.path(), destination.join(entry.file_name())));
            }
        } else if metadata.is_file() {
            copy_world_file(&source, &destination, &metadata, cancel)?;
        } else {
            return Err(format!("{} is not a regular world file.", source.display()));
        }
    }
    Ok(())
}

fn copy_world_file(
    source: &Path,
    destination: &Path,
    metadata: &fs::Metadata,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let mut input = File::open(source).map_err(|error| error.to_string())?;
    let mut output = File::create_new(destination).map_err(|error| error.to_string())?;
    let mut bytes_written = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        check_cancel(cancel)?;
        let count = input.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
        bytes_written += count as u64;
    }
    output.sync_all().map_err(|error| error.to_string())?;
    let final_metadata = regular_file(source)?.ok_or("A world file disappeared during backup.")?;
    if bytes_written != metadata.len()
        || metadata.len() != final_metadata.len()
        || metadata.modified().ok() != final_metadata.modified().ok()
    {
        return Err(
            "A world file changed during backup. Close any other launchers and try again.".into(),
        );
    }
    Ok(())
}

pub(super) fn backup_worlds(
    root: &Path,
    id: &str,
    previous: &PlayerRelease,
    next: &PlayerRelease,
    cancel: &AtomicBool,
) -> Result<(), String> {
    if previous.manifest.minecraft_version == next.manifest.minecraft_version {
        return Ok(());
    }
    let saves = require_real_game(root, id)?.join("saves");
    if !exists(&saves)? {
        return Ok(());
    }
    check_real_directory(&saves)
        .map_err(|_| "The saves folder is linked or inaccessible.".to_owned())?;
    if fs::read_dir(&saves)
        .map_err(|error| error.to_string())?
        .next()
        .is_none()
    {
        return Ok(());
    }
    let home = create_backup_home(root, id)?;
    let key = Uuid::new_v4();
    let staging = home.join(format!(".worlds-{key}"));
    fs::create_dir(&staging).map_err(|error| error.to_string())?;
    let pending = Pending(staging);
    copy_saves(&saves, &pending.0.join("saves"), cancel)?;
    let record = WorldBackup {
        from_revision: previous.revision,
        to_revision: next.revision,
        from_minecraft: previous.manifest.minecraft_version.clone(),
        to_minecraft: next.manifest.minecraft_version.clone(),
    };
    write_new(&pending.0.join("backup.json"), &record)?;
    check_cancel(cancel)?;
    let published = home.join(format!(
        "worlds-v{}-to-v{}-{key}",
        previous.revision, next.revision
    ));
    fs::rename(&pending.0, published).map_err(|error| error.to_string())
}

pub(super) fn world_backup_directory(root: &Path, id: &str, revision: u64) -> Option<String> {
    let home = backup_home(root, id);
    for path in [root.join("followed-packs/backups"), home.clone()] {
        check_real_directory(&path).ok()?;
    }
    fs::read_dir(home)
        .ok()?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            if !entry.file_name().to_string_lossy().starts_with("worlds-v") {
                return None;
            }
            let directory = entry.path();
            check_real_directory(&directory).ok()?;
            let record = read_optional::<WorldBackup>(&directory.join("backup.json")).ok()??;
            if record.to_revision != revision {
                return None;
            }
            Some((entry.metadata().ok()?.modified().ok()?, directory))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, directory)| directory.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_install::updates::tests::Installed;

    fn stage(setup: &Installed) -> PathBuf {
        let stage = repair_stage(&setup.root, &setup.saved.instance_id);
        fs::create_dir_all(stage.join("incoming")).unwrap();
        content_directories(&stage.join("incoming")).unwrap();
        stage
    }

    #[test]
    fn repair_verifies_pinned_files_and_preserves_both_local_variants() {
        let setup = Installed::new();
        let game = setup.game();
        let id = &setup.saved.instance_id;
        let release = &setup.saved.release;
        let file = &release.manifest.files[0];
        let [installed, alternate] = file_paths(&game, file);
        fs::write(&installed, b"local").unwrap(); // Same length as the real file.
        fs::write(&alternate, b"custom enabled variant").unwrap();
        let personal = game.join("resourcepacks/mine.zip");
        fs::write(&personal, b"my pack").unwrap();
        let stage = stage(&setup);
        let cancel = AtomicBool::new(false);
        let incoming = path_for(&stage.join("incoming"), file);
        fs::write(&incoming, b"wrong").unwrap();
        let entries = || repair_entries(&game, release, &cancel).unwrap();
        assert_eq!(entries().len(), 1);
        assert!(activate_repair(&setup.root, id, &stage, release, entries(), &cancel).is_err());
        assert_eq!(fs::read(&installed).unwrap(), b"local");
        assert_eq!(fs::read(&alternate).unwrap(), b"custom enabled variant");

        fs::write(&incoming, b"grass").unwrap();
        let repaired =
            activate_repair(&setup.root, id, &stage, release, entries(), &cancel).unwrap();
        assert_eq!(repaired.repaired_files, 1);
        recover_repair(&setup.root, id).unwrap();
        assert!(!stage.exists());
        assert!(!alternate.exists());
        assert_eq!(fs::read(&installed).unwrap(), b"grass");
        assert_eq!(fs::read(&personal).unwrap(), b"my pack");
        let backup = PathBuf::from(repaired.backup_directory.unwrap());
        let [backed_up, backed_up_alternate] = file_paths(&backup, file);
        assert_eq!(fs::read(backed_up).unwrap(), b"local");
        assert_eq!(
            fs::read(backed_up_alternate).unwrap(),
            b"custom enabled variant"
        );
        assert_eq!(
            read_follow(&setup.root, id).unwrap().release.review_token(),
            release.review_token()
        );
    }

    #[test]
    fn interrupted_repair_rolls_back_and_keeps_a_colliding_folder() {
        let setup = Installed::new();
        let id = &setup.saved.instance_id;
        let game = setup.game();
        let release = &setup.saved.release;
        let file = &release.manifest.files[0];
        let [live, alternate] = file_paths(&game, file);
        fs::create_dir(&alternate).unwrap();
        let cancel = AtomicBool::new(false);
        assert!(repair_entries(&game, release, &cancel)
            .unwrap_err()
            .contains("folder or linked"));
        assert!(alternate.is_dir());
        fs::remove_dir(&alternate).unwrap();
        fs::write(&live, b"locally changed").unwrap();
        let stage = stage(&setup);
        let incoming = path_for(&stage.join("incoming"), file);
        fs::write(&incoming, b"grass").unwrap();
        let key = Uuid::new_v4();
        create_backup_home(&setup.root, id).unwrap();
        let backup = repair_backup(&setup.root, id, key);
        fs::create_dir(&backup).unwrap();
        content_directories(&backup).unwrap();
        let journal = RepairJournal {
            release_token: release.review_token(),
            backup: Some(key),
            entries: repair_entries(&game, release, &cancel).unwrap(),
        };
        atomic_record(&stage.join("repair.json"), &journal).unwrap();
        fs::rename(&live, path_for(&backup, file)).unwrap();
        fs::hard_link(&incoming, &live).unwrap();
        recover_repair(&setup.root, id).unwrap();
        recover_repair(&setup.root, id).unwrap();
        assert!(!backup.exists());
        assert_eq!(fs::read(live).unwrap(), b"locally changed");
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn world_backup_never_follows_a_link_to_an_external_world() {
        let setup = Installed::new();
        let game = setup.game();
        let id = &setup.saved.instance_id;
        let saves = game.join("saves");
        fs::create_dir(&saves).unwrap();
        let external = setup.root.join("other-world");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("level.dat"), b"untouched").unwrap();
        let linked = saves.join("Linked world");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&external, &linked).unwrap();
        #[cfg(windows)]
        assert!(std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(&linked)
            .arg(&external)
            .output()
            .unwrap()
            .status
            .success());
        let old = &setup.saved.release;
        let mut next = old.clone();
        next.revision += 1;
        next.manifest.minecraft_version = "1.20.1".into();
        let result = backup_worlds(&setup.root, id, old, &next, &AtomicBool::new(false));
        #[cfg(windows)]
        fs::remove_dir(&linked).unwrap();
        #[cfg(unix)]
        fs::remove_file(&linked).unwrap();
        assert!(result.unwrap_err().contains("linked"));
        assert_eq!(fs::read(external.join("level.dat")).unwrap(), b"untouched");
        assert!(world_backup_directory(&setup.root, id, next.revision).is_none());
        assert_eq!(
            fs::read_dir(backup_home(&setup.root, id)).unwrap().count(),
            0
        );
    }
}
