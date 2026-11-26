use crate::{
    content_transfer, fabric_loader, instance_actions, notifications, pack_compatibility,
    pack_compatibility::dependencies::{
        catalog::{collect_providers, has_provider},
        maintenance,
    },
    workspace_install::updates, InstanceConfig, LauncherState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs, io::ErrorKind,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

pub(crate) const LAUNCH_CONFLICT: &str = "Choose a mod version in Mods before launching.";
const CHANGED: &str = "These mod files changed. Open Choose version again.";
type Inventory = BTreeMap<String, Vec<ModFile>>;
type Providers = BTreeMap<String, BTreeSet<String>>;

#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candidate {
    file_name: String,
    sha512: String,
}

#[derive(Clone)]
struct ModFile {
    path: PathBuf,
    file_name: String,
    meta: Value,
}

impl ModFile {
    fn candidate(&self) -> Result<Candidate, String> {
        Ok(Candidate { file_name: self.file_name.clone(), sha512: content_transfer::hash(&self.path)? })
    }

    fn version(&self) -> &str {
        self.meta["version"].as_str().unwrap_or_default()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Conflict {
    mod_id: String,
    name: String,
    candidates: Vec<Candidate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DuplicateReport {
    conflicts: Vec<Conflict>,
    archived: usize,
    restorable_files: Vec<String>,
}

fn inventory(folder: &Path) -> Result<Inventory, String> {
    let meta = match fs::symlink_metadata(folder) {
        Ok(meta) => meta,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Inventory::new()),
        Err(error) => return Err(error.to_string()),
    };
    if !meta.is_dir() || instance_actions::linked(&meta) {
        return Err("The Mods folder must be a regular local directory.".into());
    }
    let mut files = Inventory::new();
    for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let Ok(file_name) = entry.file_name().into_string() else { continue };
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if instance_actions::linked(&metadata) || !pack_compatibility::fabric_discovers_file(&file_name, &metadata) {
            continue;
        }
        let path = entry.path();
        let Ok(Some(meta)) = content_transfer::manifest(&path, "mods") else { continue };
        if let Some(id) = pack_compatibility::fabric_primary_id(&meta) {
            files.entry(id.to_owned()).or_default().push(ModFile { path, file_name, meta });
        }
    }
    for group in files.values_mut() {
        group.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    }
    Ok(files)
}

fn conflicts(files: &Inventory) -> Result<Vec<Conflict>, String> {
    files.iter().filter(|(_, group)| group.len() > 1).map(|(id, group)| {
        Ok(Conflict {
            mod_id: id.clone(),
            name: group[0].meta["name"].as_str().unwrap_or(id).chars().filter(|c| !c.is_control()).take(100).collect(),
            candidates: group.iter().map(ModFile::candidate).collect::<Result<_, _>>()?,
        })
    }).collect()
}

fn protect(config: &InstanceConfig, file: &ModFile) -> Result<bool, String> {
    Ok(crate::cosmetics::is_managed_file(&file.file_name) ||
        updates::mod_maintenance_pins(&config.id)?.iter().any(|pin| {
            pin.file_name.trim_end_matches(".disabled").eq_ignore_ascii_case(&file.file_name)
        }))
}

fn verify_pin(config: &InstanceConfig, keep: &Candidate) -> Result<(), String> {
    if updates::mod_maintenance_pins(&config.id)?.iter().any(|pin|
        pin.file_name.trim_end_matches(".disabled").eq_ignore_ascii_case(&keep.file_name)
            && (!pin.enabled || pin.sha512 != keep.sha512)
    ) {
        return Err("The followed pack expects different bytes for this file. Repair its release in Pack Workspace.".into());
    }
    Ok(())
}

fn providers(config: &InstanceConfig, files: &Inventory, removed: &BTreeSet<&str>) -> Result<Providers, String> {
    let mut result = Providers::new();
    result.insert("minecraft".into(), BTreeSet::from([config.version.clone()]));
    if let Some(loader) = fabric_loader::current_version(config) {
        result.insert("fabricloader".into(), BTreeSet::from([loader]));
    }
    let mut budget = 128 * 1024 * 1024;
    for file in files.values().flatten().filter(|item| !removed.contains(item.file_name.as_str())) {
        collect_providers(fs::File::open(&file.path).map_err(|_| CHANGED)?, &mut result, &mut budget, 0);
    }
    if budget == 0 {
        return Err("Delight could not verify all bundled dependencies. Review this version in Mods.".into());
    }
    Ok(result)
}

fn verify_choice(config: &InstanceConfig, files: &Inventory, group: &[ModFile], keep: &ModFile) -> Result<(), String> {
    let removed: BTreeSet<_> = group.iter().filter(|file| file.file_name != keep.file_name).map(|file| file.file_name.as_str()).collect();
    let previous = providers(config, files, &BTreeSet::new())?;
    let next = providers(config, files, &removed)?;
    for file in files.values().flatten().filter(|file| !removed.contains(file.file_name.as_str())) {
        if let Some(depends) = file.meta["depends"].as_object() {
            for (id, predicate) in depends {
                if id == "java" {
                    // Do not infer the Java version from the configured runtime's display name.
                    if file.file_name == keep.file_name && group.iter().any(|other| other.meta["depends"]["java"] != *predicate) {
                        return Err("The versions require different Java runtimes. Install the intended version with a compatible Java runtime.".into());
                    }
                    continue;
                }
                if (file.file_name == keep.file_name || previous.get(id) != next.get(id))
                    && !has_provider(&next, id, predicate, false)
                {
                    return Err(format!("{} needs a compatible {id}.", file.file_name));
                }
            }
        }
        if let Some(breaks) = file.meta["breaks"].as_object() {
            for (id, predicate) in breaks {
                if (file.file_name == keep.file_name || previous.get(id) != next.get(id))
                    && has_provider(&next, id, predicate, true)
                {
                    return Err(format!("{} may conflict with {id}.", file.file_name));
                }
            }
        }
    }
    Ok(())
}

fn keep_safe(
    config: &InstanceConfig,
    files: &Inventory,
    group: &[ModFile],
    keep: &ModFile,
    candidates: &[Candidate],
) -> Result<usize, String> {
    let selected = candidates.iter().find(|f| f.file_name == keep.file_name).ok_or(CHANGED)?;
    verify_pin(config, selected)?;
    let removals = group.iter().zip(candidates).filter(|(file, _)| file.file_name != keep.file_name);
    let mut originals = BTreeMap::new();
    for (file, candidate) in removals {
        if protect(config, file)? {
            return Err("A version is managed by Delight or the followed pack. Use its managed update or repair.".into());
        }
        originals.insert(candidate.file_name.clone(), candidate.sha512.clone());
    }
    if candidates.windows(2).any(|pair| pair[0].sha512 != pair[1].sha512) {
        verify_choice(config, files, group, keep)?;
    }
    let root = crate::readable_instance_root(config, true)?;
    let fresh = inventory(&root.join("mods"))?;
    let same_metadata = files.iter().flat_map(|(id, list)| list.iter().map(move |file| (id, &file.file_name, &file.meta)))
        .eq(fresh.iter().flat_map(|(id, list)| list.iter().map(move |file| (id, &file.file_name, &file.meta))));
    if !same_metadata || group.iter().map(ModFile::candidate).collect::<Result<Vec<_>, _>>()? != candidates {
        return Err(CHANGED.into());
    }
    let count = originals.len();
    maintenance::archive_duplicate_mods(config, originals)?;
    Ok(count)
}

fn choose_automatically<'a>(
    config: &InstanceConfig, files: &Inventory, group: &'a [ModFile], candidates: &[Candidate], newest: bool,
) -> Result<Option<&'a ModFile>, String> {
    let mut protected = Vec::new();
    for file in group {
        if protect(config, file)? { protected.push(file); }
    }
    if protected.len() > 1 { return Ok(None); }
    if candidates.windows(2).all(|pair| pair[0].sha512 == pair[1].sha512) {
        let keep = protected.first().copied().or_else(|| group.first());
        if let Some(keep) = keep {
            return Ok(verify_pin(config, &keep.candidate()?).is_ok().then_some(keep));
        }
        return Ok(None);
    }
    // A protected selection is eligible only if the resulting mod set still works.
    if let Some(keep) = protected.first() {
        return Ok((verify_pin(config, &keep.candidate()?).is_ok() && verify_choice(config, files, group, keep).is_ok()).then_some(*keep));
    }
    if !newest {
        let possible: Vec<_> = group.iter().filter(|file| {
            file.meta["depends"].get("minecraft").is_none_or(|requirement| {
                let installed = BTreeMap::from([("minecraft".into(), BTreeSet::from([config.version.clone()]))]);
                has_provider(&installed, "minecraft", requirement, true)
            })
        }).collect();
        return Ok(match possible.as_slice() {
            [keep] if verify_choice(config, files, group, keep).is_ok() => Some(*keep),
            _ => None,
        });
    }
    let mut ranked = Vec::new();
    for file in group {
        let Ok(version) = semver::Version::parse(file.version()) else { return Ok(None); };
        ranked.push((version, file));
    }
    // A bulk click follows the installed stable track where there is a stable candidate.
    if ranked.iter().any(|(version, _)| version.pre.is_empty()) {
        ranked.retain(|(version, _)| version.pre.is_empty());
    }
    ranked.sort_by(|(a, _), (b, _)| b.cmp_precedence(a));
    let mut entries = ranked.iter().peekable();
    while let Some((version, keep)) = entries.next() {
        let tied: Vec<_> = std::iter::once(*keep).chain(std::iter::from_fn(|| {
            if entries.peek().is_some_and(|(next, _)| next.cmp_precedence(version).is_eq()) {
                entries.next().map(|(_, candidate)| *candidate)
            } else { None }
        })).collect();
        let eligible: Vec<_> = tied.into_iter()
            .filter(|candidate| verify_choice(config, files, group, candidate).is_ok()).collect();
        if let Some(first) = eligible.first() {
            let hash = first.candidate()?.sha512;
            if eligible.iter().all(|file| file.candidate().is_ok_and(|entry| entry.sha512 == hash)) {
                return Ok(Some(*first));
            }
            return Ok(None);
        }
    }
    Ok(None)
}

fn archive_identical_copies(
    config: &InstanceConfig, files: &mut Inventory, id: &str, mods: &Path,
) -> Result<usize, String> {
    let Some(group) = files.get(id) else { return Ok(0) };
    let mut by_hash = BTreeMap::<String, Vec<ModFile>>::new();
    for file in group {
        by_hash.entry(file.candidate()?.sha512).or_default().push(file.clone());
    }
    let mut archived = 0;
    for (hash, copies) in by_hash.into_iter().filter(|(_, group)| group.len() > 1) {
        let candidates = copies.iter().map(ModFile::candidate).collect::<Result<Vec<_>, _>>()?;
        if candidates.iter().any(|candidate| candidate.sha512 != hash) {
            return Err(CHANGED.into());
        }
        if let Some(keep) = choose_automatically(config, files, &copies, &candidates, false)? {
            archived += keep_safe(config, files, &copies, keep, &candidates)?;
            *files = inventory(mods)?;
        }
    }
    Ok(archived)
}

fn assess(config: &InstanceConfig, app: &AppHandle, repair: Option<bool>) -> Result<DuplicateReport, String> {
    if !config.loader.eq_ignore_ascii_case("fabric") {
        return Ok(DuplicateReport { conflicts: vec![], archived: 0, restorable_files: vec![] });
    }
    let root = crate::readable_instance_root(config, true)?;
    let mods = root.join("mods");
    let mut files = inventory(&mods)?;
    let mut archived = 0;
    if let Some(newest) = repair {
        let ids: Vec<_> = files.iter().filter(|(_, group)| group.len() > 1).map(|(id, _)| id.clone()).collect();
        for id in ids {
            archived += archive_identical_copies(config, &mut files, &id, &mods)?;
            let Some(group) = files.get(&id).filter(|group| group.len() > 1) else { continue };
            let candidates = group.iter().map(ModFile::candidate).collect::<Result<Vec<_>, _>>()?;
            if let Some(keep) = choose_automatically(config, &files, group, &candidates, newest)? {
                archived += keep_safe(config, &files, group, keep, &candidates)?;
                files = inventory(&mods)?;
            }
        }
    }
    let conflicts = conflicts(&files)?;
    notifications::observe_mod_conflicts(app, config, conflicts.iter().map(|conflict| conflict.mod_id.as_str()));
    let backups = saved_versions(root);
    let restorable_files = files.iter().filter_map(|(id, group)| {
        let [current] = group.as_slice() else { return None };
        if protect(config, current).ok()? { return None; }
        previous_version(&backups, id, current).ok().flatten().map(|_| current.file_name.clone())
    }).collect();
    Ok(DuplicateReport { conflicts, archived, restorable_files })
}

pub(crate) fn before_play(app: &AppHandle, config: &InstanceConfig) -> Result<(), String> {
    let _edit = updates::edit_lease(&config.id)?;
    let report = assess(config, app, Some(false))?;
    if report.conflicts.is_empty() { Ok(()) } else { Err(LAUNCH_CONFLICT.into()) }
}

#[tauri::command]
pub(crate) async fn check_mod_duplicates(app: AppHandle, instance_id: String, state: tauri::State<'_, LauncherState>, repair: Option<bool>) -> Result<DuplicateReport, String> {
    instance_actions::validate_id(&instance_id)?;
    if repair == Some(true) {
        return crate::run_mod_edit(&state, move || {
            let config = crate::load_instance(&instance_id)?;
            maintenance::restore_before_play(&config)?;
            let _edit = updates::edit_lease(&instance_id)?;
            assess(&config, &app, Some(false))
        }).await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _edit = updates::edit_lease(&instance_id)?;
        assess(&crate::load_instance(&instance_id)?, &app, None)
    }).await.map_err(|_| CHANGED)?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NewestReport {
    archived: usize,
    remaining: usize,
    errors: Vec<String>,
}

#[tauri::command]
pub(crate) async fn keep_newest_mod_versions(app: AppHandle, state: tauri::State<'_, LauncherState>) -> Result<NewestReport, String> {
    crate::run_mod_edit(&state, move || {
        let mut result = NewestReport { archived: 0, remaining: 0, errors: vec![] };
        for config in crate::list_instances_blocking()?.into_iter().filter(|config| config.loader.eq_ignore_ascii_case("fabric")) {
            let report = (|| {
                maintenance::restore_before_play(&config)?;
                let _edit = updates::edit_lease(&config.id)?;
                assess(&config, &app, Some(true))
            })();
            match report {
                Ok(report) => {
                    result.archived += report.archived;
                    result.remaining += report.conflicts.len();
                }
                Err(error) => result.errors.push(format!("{} — {error}", config.name)),
            }
        }
        Ok(result)
    }).await
}

#[tauri::command]
pub(crate) async fn choose_mod_version(
    app: AppHandle, state: tauri::State<'_, LauncherState>, instance_id: String, mod_id: String,
    keep_file_name: String, candidates: Vec<Candidate>,
) -> Result<DuplicateReport, String> {
    instance_actions::validate_id(&instance_id)?;
    crate::run_mod_edit(&state, move || {
        let config = crate::load_instance(&instance_id)?;
        maintenance::restore_before_play(&config)?;
        let _edit = updates::edit_lease(&instance_id)?;
        let root = crate::readable_instance_root(&config, true)?;
        let files = inventory(&root.join("mods"))?;
        let group = files.get(&mod_id).filter(|files| files.len() > 1).ok_or(CHANGED)?;
        let keep = group.iter().find(|file| file.file_name == keep_file_name).ok_or(CHANGED)?;
        let actual = group.iter().map(ModFile::candidate).collect::<Result<Vec<_>, _>>()?;
        if actual.len() != candidates.len() || actual.iter().any(|file| !candidates.contains(file)) { return Err(CHANGED.into()); }
        let archived = keep_safe(&config, &files, group, keep, &actual)?;
        Ok(DuplicateReport { archived, ..assess(&config, &app, None)? })
    }).await
}

pub(crate) fn verify_staged_mods(folder: &Path) -> Result<(), String> {
    let files = inventory(folder)?;
    match files.iter().find(|(_, group)| group.len() > 1) {
        Some((id, _)) => Err(format!("This pack contains more than one enabled copy of {id}. Choose one version and retry.")),
        None => Ok(()),
    }
}

pub(crate) fn verify_enable(folder: &Path, source: &Path) -> Result<(), String> {
    let Some(meta) = content_transfer::manifest(source, "mods")? else { return Ok(()); };
    if let Some(id) = pack_compatibility::fabric_primary_id(&meta) {
        if inventory(folder)?.contains_key(id) {
            return Err(format!("A version of {id} is already enabled. Disable it before enabling this copy."));
        }
    }
    Ok(())
}

pub(crate) fn verify_mod_changes(
    live: &Path, incoming: &Path, retired: impl Iterator<Item = String>,
) -> Result<(), String> {
    let mut planned = inventory(live)?;
    let retired: BTreeSet<_> = retired.collect();
    for files in planned.values_mut() {
        files.retain(|file| !retired.contains(&file.file_name.to_ascii_lowercase()));
    }
    for (id, staged) in inventory(incoming)? {
        planned.entry(id).or_default().extend(staged);
    }
    if let Some((id, _)) = planned.iter().find(|(_, group)| group.len() > 1) {
        return Err(format!("This change would leave more than one enabled copy of {id}. Choose a version in Mods first."));
    }
    Ok(())
}

fn saved_versions(root: &Path) -> Vec<Inventory> {
    let Ok(entries) = fs::read_dir(root) else { return vec![] };
    let mut paths = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(suffix) = name.to_str().and_then(|name| name.strip_prefix(".delight-mod-backup-")) else { continue };
        if uuid::Uuid::parse_str(suffix).is_err() { continue; }
        let Ok(meta) = fs::symlink_metadata(entry.path()) else { continue };
        if meta.is_dir() && !instance_actions::linked(&meta) {
            paths.push((meta.modified().ok(), entry.path()));
        }
    }
    paths.sort_by(|a, b| b.cmp(a));
    paths.into_iter().filter_map(|(_, path)| inventory(&path.join("original")).ok()).collect()
}

fn previous_version<'a>(backups: &'a [Inventory], id: &str, current: &ModFile) -> Result<Option<&'a ModFile>, String> {
    if !backups.iter().any(|backup| backup.contains_key(id)) { return Ok(None); }
    let active_hash = current.candidate()?.sha512;
    for group in backups.iter().filter_map(|backup| backup.get(id)) {
        let mut versions = BTreeMap::new();
        for candidate in group {
            let hash = candidate.candidate()?.sha512;
            if hash != active_hash { versions.insert(hash, candidate); }
        }
        if versions.len() == 1 { return Ok(versions.into_values().next()); }
        let mut ranked = versions.into_values()
            .filter_map(|file| semver::Version::parse(file.version()).ok().map(|version| (version, file)))
            .collect::<Vec<_>>();
        ranked.sort_by(|(a, _), (b, _)| b.cmp_precedence(a));
        if let Some((version, file)) = ranked.first() {
            if ranked.get(1).is_none_or(|(next, _)| next.cmp_precedence(version).is_lt()) {
                return Ok(Some(*file));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub(crate) async fn restore_previous_mod_version(
    app: AppHandle, state: tauri::State<'_, LauncherState>, instance_id: String, file_name: String,
) -> Result<DuplicateReport, String> {
    instance_actions::validate_id(&instance_id)?;
    crate::run_mod_edit(&state, move || {
        let config = crate::load_instance(&instance_id)?;
        maintenance::restore_before_play(&config)?;
        let root = crate::readable_instance_root(&config, true)?;
        let files = inventory(&root.join("mods"))?;
        let (id, group) = files.iter().find(|(_, group)| group.iter().any(|file| file.file_name == file_name))
            .ok_or("This mod is no longer enabled.")?;
        let [current] = group.as_slice() else { return Err(LAUNCH_CONFLICT.into()) };
        let backups = saved_versions(root);
        let candidate = previous_version(&backups, id, current)?.ok_or("No previous version is available in local backups.")?;
        crate::pack_compatibility::dependencies::catalog::replace_local(&config, candidate.path.clone())?;
        assess(&config, &app, None)
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("delight-mod-duplicates-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(path.join("mods")).unwrap();
            Self(path)
        }

        fn config(&self) -> InstanceConfig {
            serde_json::from_value(json!({
                "id": "duplicate-fixture", "name": "Fixture", "loader": "Fabric",
                "loaderVersion": "0.19.5", "version": "26.3", "directory": self.0,
                "java": "Automatic", "memory": 4096, "jvmArguments": "", "mods": true,
                "resourcePacks": true, "shaderPacks": true, "config": true,
                "customResolution": false, "visible": true, "shortcut": false
            })).unwrap()
        }

        fn jar(&self, name: &str, id: &str, version: &str, depends: Value) {
            let mut jar = zip::ZipWriter::new(fs::File::create(self.0.join("mods").join(name)).unwrap());
            jar.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
            jar.write_all(&serde_json::to_vec(&json!({
                "schemaVersion": 1, "id": id, "version": version, "depends": depends
            })).unwrap()).unwrap();
            jar.finish().unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            if self.0.parent() == Some(std::env::temp_dir().as_path()) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn bulk_chooses_newest_compatible_with_dependents_and_backs_up_removed_files() {
        let fixture = Fixture::new();
        fixture.jar("new.jar", "test-api", "2.0.0+26.3", json!({"minecraft": "~26.3-"}));
        fixture.jar("safe.jar", "test-api", "1.0.0+26.3", json!({"minecraft": "~26.3-"}));
        fixture.jar("earlier.jar", "test-api", "0.9.0+26.3", json!({"minecraft": "~26.3-"}));
        fixture.jar("addon.jar", "test-addon", "1.0.0", json!({"test-api": ">=1.0.0 <2.0.0"}));
        let mut config = fixture.config();
        let files = inventory(&fixture.0.join("mods")).unwrap();
        let group = &files["test-api"];
        let selected = group.iter().find(|file| file.file_name == "safe.jar").unwrap();
        assert!(verify_choice(&config, &files, group, selected).is_ok());
        config.version = "26.3-pre.1".into();
        assert!(verify_choice(&config, &files, group, selected).is_ok());
        config.version = "26.4".into();
        assert!(verify_choice(&config, &files, group, selected).unwrap_err().contains("compatible minecraft"));
        config.version = "26.3".into();
        let candidates = conflicts(&files).unwrap().remove(0).candidates;
        assert!(choose_automatically(&config, &files, group, &candidates, false).unwrap().is_none());
        let keep = choose_automatically(&config, &files, group, &candidates, true).unwrap().unwrap();
        assert_eq!(keep.file_name, "safe.jar");
        assert_eq!(keep_safe(&config, &files, group, keep, &candidates).unwrap(), 2);
        assert!(conflicts(&inventory(&fixture.0.join("mods")).unwrap()).unwrap().is_empty());
        let backup = saved_versions(&fixture.0);
        assert_eq!(backup[0]["test-api"].len(), 2);
    }

    #[test]
    fn identical_copy_is_safe_to_archive_without_an_automatic_upgrade() {
        let fixture = Fixture::new();
        let mods = fixture.0.join("mods");
        fixture.jar("a.jar", "test-copy", "1.0.0", json!({}));
        fs::copy(mods.join("a.jar"), mods.join("b.jar")).unwrap();
        fixture.jar("older.jar.disabled", "test-copy", "0.9.0", json!({}));
        let files = inventory(&mods).unwrap();
        let group = &files["test-copy"];
        let candidates = conflicts(&files).unwrap().remove(0).candidates;
        assert_eq!(group.len(), 2);
        let config = fixture.config();
        let keep = choose_automatically(&config, &files, group, &candidates, false).unwrap().unwrap();
        assert_eq!(keep_safe(&config, &files, group, keep, &candidates).unwrap(), 1);
        assert!(mods.join("older.jar.disabled").is_file());
        assert_eq!(saved_versions(&fixture.0)[0]["test-copy"][0].candidate().unwrap().sha512, candidates[0].sha512);
    }

    #[test]
    fn identical_pair_is_archived_inside_a_group_with_different_releases() {
        let fixture = Fixture::new();
        let mods = fixture.0.join("mods");
        fixture.jar("old.jar", "test-mixed", "1.0.0", json!({}));
        fixture.jar("new.jar", "test-mixed", "2.0.0", json!({}));
        fs::copy(mods.join("new.jar"), mods.join("new-copy.jar")).unwrap();
        let mut files = inventory(&mods).unwrap();
        assert_eq!(archive_identical_copies(&fixture.config(), &mut files, "test-mixed", &mods).unwrap(), 1);
        assert_eq!(files["test-mixed"].len(), 2);
        assert!(mods.join("old.jar").is_file());
        assert_eq!(saved_versions(&fixture.0)[0]["test-mixed"].len(), 1);
    }
}
