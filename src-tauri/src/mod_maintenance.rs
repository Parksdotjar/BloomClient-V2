use super::super::{assess, scan_mods_cached, FileState};
use super::*;
use crate::content_downloads;
use serde::Deserialize;
use std::{
    path::Path,
    sync::{Mutex, OnceLock},
    time::Instant,
};
use tauri::Manager;

#[path = "minecraft_mod_update.rs"]
pub(crate) mod minecraft_update;

const PENDING: &str = ".delight-mod-maintenance";
const CHANGED: &str = "The installed mods or available updates changed. Check again.";
const CACHE_TTL: Duration = Duration::from_secs(120);
const CACHE_LIMIT: usize = 8192;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModUpdate {
    file_name: String,
    title: String,
    from_version: String,
    to_version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModIssue {
    file_name: Option<String>,
    message: String,
    kind: ModIssueKind,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum ModIssueKind {
    Installed,
    Duplicate,
    Update,
    Catalog,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModMaintenance {
    updates: Vec<ModUpdate>,
    repairs_available: bool,
    dependency_issues: Vec<String>,
    issues: Vec<ModIssue>,
    complete: bool,
}


struct Candidate {
    summary: ModUpdate,
    next: Arc<ModrinthVersion>,
    file: PlayerFile,
    previous_id: String,
}

struct MaintenancePlan {
    report: CompatibilityReport,
    summary: ModMaintenance,
    protection_token: String,
    repairs: Selection,
    updates: Selection,
    replacements: BTreeMap<String, String>,
}

type VersionMap = HashMap<String, ModrinthVersion>;
type ProviderCache = HashMap<(String, String), (Instant, Option<ModrinthVersion>)>;
static PROVIDER_CACHE: OnceLock<Mutex<ProviderCache>> = OnceLock::new();

pub(in crate::pack_compatibility) async fn lookup(
    hashes: Vec<String>,
    game_and_channel: Option<(&str, &str)>,
    fresh: bool,
) -> Result<VersionMap, String> {
    if hashes.is_empty() {
        return Ok(HashMap::new());
    }
    let prefix = game_and_channel
        .map(|(game, channel)| format!("{game}/{channel}"))
        .unwrap_or_default();
    let cache = PROVIDER_CACHE.get_or_init(Mutex::default);
    let now = Instant::now();
    let mut results = HashMap::new();
    let mut remaining = BTreeSet::new();
    {
        let cache = cache
            .lock()
            .map_err(|_| "Could not read the mod check cache.")?;
        for hash in hashes {
            match cache
                .get(&(prefix.clone(), hash.clone()))
                .filter(|(time, _)| !fresh && now.saturating_duration_since(*time) < CACHE_TTL)
            {
                Some((_, Some(version))) => {
                    results.insert(hash, version.clone());
                }
                Some((_, None)) => {}
                None => {
                    remaining.insert(hash);
                }
            }
        }
    }
    let remaining: Vec<_> = remaining.into_iter().collect();
    for batch in remaining.chunks(100) {
        let (route, body) = match game_and_channel {
            Some((game, channel)) => (
                "version_files/update",
                serde_json::json!({
                    "hashes": batch, "algorithm": "sha512", "loaders": ["fabric"],
                    "game_versions": [game], "version_types": [channel],
                }),
            ),
            None => (
                "version_files",
                serde_json::json!({"hashes": batch, "algorithm": "sha512"}),
            ),
        };
        let response = crate::bloom_http_client()?
            .post(format!("https://api.modrinth.com/v2/{route}"))
            .json(&body)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|_| "Modrinth could not be reached. Check your connection and try again.")?;
        let mut found = response
            .json::<VersionMap>()
            .await
            .map_err(|_| "Modrinth returned unreadable mod information. Try again.")?;
        let mut cache = cache
            .lock()
            .map_err(|_| "Could not update the mod check cache.")?;
        if cache.len().saturating_add(batch.len()) > CACHE_LIMIT {
            cache.retain(|_, (time, _)| time.elapsed() < CACHE_TTL);
            if cache.len().saturating_add(batch.len()) > CACHE_LIMIT {
                cache.clear();
            }
        }
        for hash in batch {
            let version = found.remove(hash);
            cache.insert(
                (prefix.clone(), hash.clone()),
                (Instant::now(), version.clone()),
            );
            if let Some(version) = version {
                results.insert(hash.clone(), version);
            }
        }
    }
    Ok(results)
}

fn make_candidate(
    file: &CheckedFile,
    old: &ModrinthVersion,
    next: ModrinthVersion,
    game: &str,
) -> Option<Candidate> {
    if next.version_type != old.version_type
        || old.date_published.is_empty()
        || next.date_published <= old.date_published
    {
        return None;
    }
    candidate_for_target(file, old, next, game)
}

fn candidate_for_target(
    file: &CheckedFile, old: &ModrinthVersion, next: ModrinthVersion, game: &str,
) -> Option<Candidate> {
    let project = old.project_id.as_deref().filter(|id| source_id(id))?;
    if next.project_id.as_deref() != Some(project) || next.id == old.id || !source_id(&next.id) {
        return None;
    }
    let incoming = download_file(&next, game)?;
    if file.fingerprint.as_deref() == Some(incoming.sha512.as_str()) {
        return None;
    }
    Some(Candidate {
        summary: ModUpdate {
            file_name: file.file_name.clone(),
            title: file
                .mod_name
                .clone()
                .unwrap_or_else(|| file.file_name.clone()),
            from_version: old.version_number.clone(),
            to_version: next.version_number.clone(),
        },
        next: Arc::new(next),
        file: incoming,
        previous_id: old.id.clone(),
    })
}

async fn candidates(
    report: &CompatibilityReport,
    versions: &VersionMap,
    pins: &[PlayerFile],
    fresh: bool,
    issues: &mut Vec<ModIssue>,
) -> Result<Vec<Candidate>, String> {
    let entries: Vec<_> = report
        .files
        .iter()
        .filter(|file| file.enabled && file.mod_id.is_some() && file.duplicate_group.is_none())
        .filter_map(|file| {
            Some((
                file,
                file.fingerprint.as_ref()?,
                matched_version(file, versions)?,
            ))
        })
        .filter(|(file, _, old)| {
            file.project_id.is_some()
                && !protected_mod(pins, &file.file_name, old.project_id.as_deref())
        })
        .filter(|(_, _, old)| matches!(old.version_type.as_str(), "alpha" | "beta" | "release"))
        .collect();
    let mut available = HashMap::new();
    let channels = ["release", "beta", "alpha"].map(|channel| {
        let hashes = entries.iter()
            .filter(|(_, _, old)| old.version_type == channel)
            .map(|(_, hash, _)| (*hash).clone()).collect();
        lookup(hashes, Some((&report.minecraft_version, channel)), fresh)
    });
    for result in futures_util::future::join_all(channels).await {
        available.extend(result?);
    }
    let mut candidates = Vec::new();
    for (file, hash, old) in entries {
        let Some(next) = available
            .get(hash)
            .cloned()
            .and_then(|version| make_candidate(file, old, version, &report.minecraft_version))
        else {
            continue;
        };
        if report.files.iter().any(|other| {
            !other.enabled
                && other.project_id == next.file.project_id
                && other.version_id == next.file.version_id
        }) {
            issues.push(file_issue(
                file,
                "The updated version is already in Mods and disabled. Review both copies before changing versions.",
                ModIssueKind::Update,
            ));
            continue;
        }
        if protected_mod(pins, &next.file.file_name, next.file.project_id.as_deref())
            || report.files.iter().any(|other| {
                other.file_name != file.file_name
                    && other.file_name.eq_ignore_ascii_case(&next.file.file_name)
            })
            || candidates.iter().any(|other: &Candidate| {
                other
                    .file
                    .file_name
                    .eq_ignore_ascii_case(&next.file.file_name)
            })
            || report.files.iter().any(|other| {
                other.file_name != file.file_name
                    && other.enabled
                    && other.project_id.as_ref() == old.project_id.as_ref()
            })
        {
            issues.push(file_issue(
                file,
                "The update conflicts with another installed or managed file.",
                ModIssueKind::Update,
            ));
            continue;
        }
        candidates.push(next);
    }
    Ok(candidates)
}

fn file_issue(file: &CheckedFile, message: &str, kind: ModIssueKind) -> ModIssue {
    ModIssue {
        file_name: Some(file.file_name.clone()),
        message: message.into(),
        kind,
    }
}

fn declares_runtime_conflict(report: &CompatibilityReport, file: &CheckedFile) -> bool {
    let path = report.directory.join("mods").join(&file.file_name);
    let Ok(Some(metadata)) = content_transfer::manifest(&path, "mods") else {
        return true;
    };
    [("minecraft", Some(report.minecraft_version.as_str())), ("fabricloader", report.loader_version.as_deref())]
        .into_iter()
        .filter_map(|(id, version)| version.map(|value| (id, value)))
        .any(|(id, version)| {
            metadata["depends"].get(id).is_some_and(|required| !catalog::version_matches(version, required, true))
                || metadata["breaks"].get(id).is_some_and(|conflict| catalog::version_matches(version, conflict, false))
        })
}

fn graph_after_updates(
    report: &CompatibilityReport,
    versions: &VersionMap,
    updates: &[Candidate],
) -> (CompatibilityReport, VersionMap) {
    let mut effective = report.clone();
    let mut versions = versions.clone();
    for file in &mut effective.files {
        let Some(candidate) = updates
            .iter()
            .find(|candidate| candidate.summary.file_name == file.file_name)
        else {
            continue;
        };
        file.file_name = candidate.file.file_name.clone();
        file.fingerprint = Some(candidate.file.sha512.clone());
        file.size = candidate.file.size;
        versions.insert(
            candidate.file.sha512.clone(),
            candidate.next.as_ref().clone(),
        );
    }
    assess(&mut effective, &versions, &[]);
    (effective, versions)
}

fn planned_satisfies(
    dep: &crate::ModrinthDependency,
    report: &CompatibilityReport,
    selection: &Selection,
) -> bool {
    report.files.iter().any(|file| {
        file.enabled
            && dependency_matches(dep, file.project_id.as_deref(), file.version_id.as_deref())
    }) || selection.values().any(|entry| {
        dependency_matches(
            dep,
            entry.file.project_id.as_deref(),
            entry.file.version_id.as_deref(),
        )
    })
}

fn check_graph(
    effective: &CompatibilityReport,
    versions: &VersionMap,
    updates: &[Candidate],
    selection: &Selection,
    titles: &HashMap<String, String>,
) -> BTreeMap<String, String> {
    let mut blocked = BTreeMap::new();
    let active: Vec<_> = effective
        .files
        .iter()
        .filter(|file| file.enabled && file.project_id.is_some())
        .filter_map(|file| Some((file, matched_version(file, versions)?)))
        .collect();
    for (file, version) in &active {
        for dep in &version.dependencies {
            if dep.dependency_type != "required" || planned_satisfies(dep, effective, selection) {
                continue;
            }
            // Keep an installed version when any remaining root requires that exact version.
            if let Some(target) = updates.iter().find(|target| {
                dependency_matches(
                    dep,
                    target.file.project_id.as_deref(),
                    Some(&target.previous_id),
                )
            }) {
                blocked.insert(
                    target.summary.file_name.clone(),
                    format!(
                        "{} still requires the installed version.",
                        file.mod_name.as_deref().unwrap_or(&file.file_name)
                    ),
                );
                continue;
            }
            if let Some(target) = updates
                .iter()
                .find(|target| target.file.file_name == file.file_name)
            {
                blocked.insert(
                    target.summary.file_name.clone(),
                    format!(
                        "Update to {} skipped. Required {}{} could not be resolved.",
                        target.summary.to_version,
                        dep.project_id.as_deref().and_then(|id| titles.get(id)).map(String::as_str)
                            .or(dep.project_id.as_deref()).unwrap_or("dependency"),
                        dep.version_id.as_ref().map(|version| format!(" (version {version})")).unwrap_or_default(),
                    ),
                );
            }
        }
    }
    for target in updates {
        if let Some((other, _)) = active.iter().find(|(other, version)| {
            other.file_name != target.file.file_name
                && (incompatible(&target.next, version) || incompatible(version, &target.next))
        }) {
            blocked.insert(
                target.summary.file_name.clone(),
                format!(
                    "The update conflicts with {}.",
                    other.mod_name.as_deref().unwrap_or(&other.file_name)
                ),
            );
        }
    }
    blocked
}

fn pinned_token(pins: &[PlayerFile]) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::json!(pins).to_string().as_bytes())
    )
}

async fn plan(instance_id: String, fresh: bool) -> Result<MaintenancePlan, String> {
    instance_actions::validate_id(&instance_id)?;
    let (mut report, protected, pending) = tauri::async_runtime::spawn_blocking(move || {
        let config = crate::load_instance(&instance_id)?;
        let protected = workspace_install::updates::mod_maintenance_pins(&instance_id)?;
        // The commit checks actual file hashes again before touching active mods.
        let report = scan_mods_cached(&config)?;
        let pending = path_exists(&report.directory.join(PENDING))?;
        Ok::<_, String>((report, protected, pending))
    })
    .await
    .map_err(|_| "The mod check stopped unexpectedly. Try again.")??;
    let protection_token = pinned_token(&protected);
    let mut issues: Vec<_> = report
        .issues
        .iter()
        .map(|issue| ModIssue {
            file_name: None,
            message: issue.clone(),
            kind: ModIssueKind::Installed,
        })
        .collect();
    if pending {
        issues.push(ModIssue { file_name: None, message: "A previous mod update stopped before it finished. Press Play to restore the previous files and check again.".into(), kind: ModIssueKind::Installed });
    }
    if pending || !report.issues.is_empty() || report.files.is_empty() {
        let complete = !pending && report.issues.is_empty();
        return Ok(MaintenancePlan {
            report,
            protection_token,
            summary: ModMaintenance {
                updates: Vec::new(),
                repairs_available: false,
                dependency_issues: Vec::new(),
                complete,
                issues,
            },
            repairs: Selection::new(),
            updates: Selection::new(),
            replacements: BTreeMap::new(),
        });
    }

    let hashes = report
        .files
        .iter()
        .filter(|file| file.state != FileState::Managed)
        .filter_map(|file| file.fingerprint.clone())
        .collect();
    let versions = lookup(hashes, None, fresh).await?;
    assess(&mut report, &versions, &[]);
    if !report.missing_dependencies.is_empty() {
        report = tauri::async_runtime::spawn_blocking(move || {
            super::super::prefer_installed_fabric_requirements(&mut report, false, !fresh);
            report
        }).await.map_err(|_| "Could not verify the installed Fabric requirements.")?;
    }
    let mut candidates = candidates(&report, &versions, &protected, fresh, &mut issues).await?;
    let mut catalog = Catalog::default();
    catalog.versions.extend(
        versions
            .values()
            .filter(|version| {
                source_id(&version.id) && version.project_id.as_deref().is_some_and(source_id)
            })
            .map(|version| (version.id.clone(), Arc::new(version.clone()))),
    );
    let mut selected_updates = Selection::new();
    let mut replacements = BTreeMap::new();
    let mut update_issues = BTreeMap::new();
    while !candidates.is_empty() {
        let (effective, working_versions) = graph_after_updates(&report, &versions, &candidates);
        let dependencies =
            plan_dependencies_with_pins(&effective, &working_versions, &mut catalog, &protected, false)
                .await;
        let blocked = check_graph(
            &effective,
            &working_versions,
            &candidates,
            &dependencies.selection,
            &catalog.titles,
        );
        if !blocked.is_empty() {
            candidates.retain(|candidate| !blocked.contains_key(&candidate.summary.file_name));
            update_issues.extend(blocked);
            continue;
        }
        selected_updates = dependencies.selection;
        for candidate in &candidates {
            replacements.insert(
                candidate.summary.file_name.clone(),
                candidate.file.file_name.clone(),
            );
            selected_updates.insert(
                candidate.file.project_id.as_ref().ok_or(CHANGED)?.clone(),
                Selected {
                    action: Action {
                        name: candidate.summary.title.clone(),
                        version: candidate.summary.to_version.clone(),
                        file_name: candidate.file.file_name.clone(),
                        kind: "update",
                        required_by: BTreeSet::new(),
                    },
                    file: candidate.file.clone(),
                    version: candidate.next.clone(),
                    enable_from: None,
                },
            );
        }
        break;
    }

    let repairs = plan_dependencies_with_pins(&report, &versions, &mut catalog, &protected, false).await;
    for file in report
        .files
        .iter()
        .filter(|file| file.enabled && file.state == FileState::Issue)
    {
        if file.duplicate_group.is_some() {
            issues.push(file_issue(file, &file.message, ModIssueKind::Duplicate));
        } else if file.project_id.is_none() && !file.can_keep_local {
            let catalog_mismatch = file.mod_id.is_some() && matched_version(file, &versions).is_some();
            if catalog_mismatch && !declares_runtime_conflict(&report, file) {
                let hint = format!("Catalog could not verify this file for Minecraft {}.", report.minecraft_version);
                issues.push(file_issue(file, &hint, ModIssueKind::Catalog));
            } else {
                issues.push(file_issue(file, &file.message, ModIssueKind::Installed));
            }
        } else if file.message.starts_with("This release conflicts with") {
            issues.push(file_issue(file, &file.message, ModIssueKind::Installed));
        }
    }
    for action in &repairs.review.actions {
        for required_by in &action.required_by {
            if report.files.iter().any(|file| &file.file_name == required_by) {
                let message = format!("Requires {}. Update all can install it.", action.name);
                issues.push(ModIssue { file_name: Some(required_by.clone()), message, kind: ModIssueKind::Installed });
            }
        }
    }
    issues.extend(
        update_issues
            .into_iter()
            .map(|(file_name, message)| ModIssue {
                file_name: Some(file_name),
                message,
                kind: ModIssueKind::Update,
            }),
    );
    let updates = candidates
        .into_iter()
        .filter(|candidate| replacements.contains_key(&candidate.summary.file_name))
        .map(|candidate| candidate.summary)
        .collect();
    Ok(MaintenancePlan {
        report,
        protection_token,
        summary: ModMaintenance {
            updates,
            repairs_available: !repairs.selection.is_empty(),
            dependency_issues: repairs.review.issues,
            issues,
            complete: !catalog.incomplete,
        },
        repairs: repairs.selection,
        updates: selected_updates,
        replacements,
    })
}

#[tauri::command]
pub(crate) async fn check_mod_maintenance(instance_id: String) -> Result<ModMaintenance, String> {
    Ok(plan(instance_id, false).await?.summary)
}

#[derive(Serialize, Deserialize)]
struct Journal {
    originals: BTreeMap<String, String>,
    incoming: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    runtime: Option<minecraft_update::RuntimeChange>,
}

fn path_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn regular(path: &Path, hash: &str) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && !instance_actions::linked(&metadata))
        && content_transfer::hash(path).is_ok_and(|actual| actual == hash)
}

fn regular_directory(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .is_ok_and(|meta| meta.is_dir() && !instance_actions::linked(&meta))
    {
        Ok(())
    } else {
        Err("The mod update needs a regular local directory.".into())
    }
}

fn valid_snapshot_name(name: &str, hash: &str) -> bool {
    (crate::workspace_player::safe_content_name(name, ".jar")
        || crate::workspace_player::safe_content_name(name, ".jar.disabled"))
        && hash.len() == 128
        && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn restore(root: &Path, pending: &Path) -> Result<(), String> {
    if !path_exists(pending)? {
        return Ok(());
    }
    regular_directory(pending)?;
    let journal_path = pending.join("journal.json");
    if path_exists(&journal_path)? {
        let info = fs::symlink_metadata(&journal_path).map_err(|e| e.to_string())?;
        if !info.is_file() || instance_actions::linked(&info) || info.len() > 1024 * 1024 {
            return Err("The interrupted mod update record could not be verified.".into());
        }
        let journal: Journal =
            serde_json::from_reader(File::open(journal_path).map_err(|e| e.to_string())?)
                .map_err(|_| "The interrupted mod update record could not be read.")?;
        if journal
            .originals
            .iter()
            .chain(&journal.incoming)
            .any(|(name, hash)| !valid_snapshot_name(name, hash))
        {
            return Err("The interrupted mod update record contains invalid file names.".into());
        }
        let mods = root.join("mods");
        let incoming = pending.join("incoming");
        let originals = pending.join("original");
        for path in [&mods, &incoming, &originals] {
            regular_directory(path)?;
        }
        for (name, hash) in &journal.incoming {
            let live = mods.join(name);
            let staged = incoming.join(name);
            if path_exists(&live)? && same_file::is_same_file(&live, &staged).unwrap_or(false) {
                if !regular(&live, hash) {
                    return Err(format!(
                        "{} changed during recovery. The backup is at {}.",
                        name,
                        originals.display()
                    ));
                }
                fs::remove_file(&live).map_err(|e| e.to_string())?;
            }
        }
        if let Some(runtime) = &journal.runtime {
            runtime.recover(root)?;
        }
        for (name, hash) in &journal.originals {
            let backup = originals.join(name);
            let live = mods.join(name);
            if !regular(&backup, hash) {
                return Err(format!("The backup for {name} could not be verified."));
            }
            if !path_exists(&live)? {
                fs::hard_link(backup, live).map_err(|e| e.to_string())?;
            } else if !regular(&live, hash) {
                return Err(format!(
                    "Move the changed copy of {} aside to restore the backup at {}.",
                    name,
                    originals.display()
                ));
            }
        }
    }
    fs::remove_dir_all(pending).map_err(|e| e.to_string())
}

pub(crate) fn restore_before_play(config: &InstanceConfig) -> Result<(), String> {
    let root = Path::new(&config.directory);
    let pending = root.join(PENDING);
    if !path_exists(&pending)? {
        return Ok(());
    }
    let root = crate::readable_instance_root(config, true)?;
    let _edit = workspace_install::updates::edit_lease(&config.id)?;
    restore(root, &pending)
}

pub(super) fn commit_updates(
    config: &InstanceConfig,
    report: &CompatibilityReport,
    selection: &Selection,
    replacements: &BTreeMap<String, String>,
    stage: &Stage,
) -> Result<Option<PathBuf>, String> {
    if inventory_token(&scan_mods(config)?) != inventory_token(report) {
        return Err(CHANGED.into());
    }
    let root = crate::readable_instance_root(config, true)?;
    let mods = root.join("mods");
    regular_directory(&mods)?;
    let mut originals = BTreeMap::new();
    let mut incoming = BTreeMap::new();
    for entry in selection.values() {
        let file = &entry.file;
        if !regular(&stage.0.join(&file.file_name), &file.sha512) {
            return Err(CHANGED.into());
        }
        if let Some(from) = &entry.enable_from {
            originals.insert(from.clone(), file.sha512.clone());
        }
        if incoming
            .insert(file.file_name.clone(), file.sha512.clone())
            .is_some()
        {
            return Err(CHANGED.into());
        }
    }
    for from in replacements.keys() {
        let hash = report
            .files
            .iter()
            .find(|file| &file.file_name == from)
            .and_then(|file| file.fingerprint.clone())
            .ok_or(CHANGED)?;
        originals.insert(from.clone(), hash);
    }
    for (name, hash) in &originals {
        if !valid_snapshot_name(name, hash) || !regular(&mods.join(name), hash) {
            return Err(CHANGED.into());
        }
    }
    for name in incoming.keys() {
        if path_exists(&mods.join(name))?
            && !originals.keys().any(|key| key.eq_ignore_ascii_case(name))
        {
            return Err(format!("A mod already uses the filename {name}."));
        }
    }
    let journal = Journal {
        originals,
        incoming,
        runtime: None,
    };
    commit_journal(root, journal, &stage.0)
}

pub(crate) fn archive_duplicate_mods(config: &InstanceConfig, originals: BTreeMap<String, String>) -> Result<(), String> {
    if originals.is_empty() {
        return Ok(());
    }
    let root = crate::readable_instance_root(config, true)?;
    commit_journal(root, Journal { originals, incoming: BTreeMap::new(), runtime: None }, root).map(|_| ())
}

fn commit_journal(root: &Path, journal: Journal, stage: &Path) -> Result<Option<PathBuf>, String> {
    let mods = root.join("mods");
    regular_directory(&mods)?;
    if journal.originals.iter().any(|(name, hash)| !valid_snapshot_name(name, hash)) {
        return Err(CHANGED.into());
    }
    let pending = root.join(PENDING);
    let backup = root.join(format!(".delight-mod-backup-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&pending).map_err(|e| format!("Could not start the mod update. {e}"))?;
    let prepare = || -> Result<(), String> {
        let orig = pending.join("original");
        let next = pending.join("incoming");
        fs::create_dir(&orig).map_err(|e| e.to_string())?;
        fs::create_dir(&next).map_err(|e| e.to_string())?;
        for (name, hash) in &journal.originals {
            let file = orig.join(name);
            // Copy originals so writing a file in place cannot also change its backup.
            fs::copy(mods.join(name), &file).map_err(|e| e.to_string())?;
            if !regular(&file, hash) {
                return Err(CHANGED.into());
            }
            fs::OpenOptions::new().write(true).open(&file)
                .and_then(|file| file.sync_all())
                .map_err(|e| e.to_string())?;
        }
        for name in journal.incoming.keys() {
            fs::hard_link(stage.join(name), next.join(name)).map_err(|e| e.to_string())?;
        }
        if journal.runtime.is_some() && path_exists(&stage.join("saves"))? {
            regular_directory(&stage.join("saves"))?;
            fs::rename(stage.join("saves"), pending.join("saves")).map_err(|e| e.to_string())?;
        }
        let temporary = pending.join("journal.tmp");
        let record = File::create_new(&temporary).map_err(|e| e.to_string())?;
        serde_json::to_writer(&record, &journal).map_err(|e| e.to_string())?;
        record.sync_all().map_err(|e| e.to_string())?;
        drop(record);
        fs::rename(temporary, pending.join("journal.json")).map_err(|e| e.to_string())
    };
    if let Err(error) = prepare() {
        let _ = fs::remove_dir_all(&pending);
        return Err(error);
    }
    let activate = || -> Result<(), String> {
        for (name, hash) in &journal.originals {
            let file = mods.join(name);
            if !regular(&file, hash) {
                return Err(CHANGED.into());
            }
            fs::remove_file(file).map_err(|e| e.to_string())?;
        }
        for (name, hash) in &journal.incoming {
            let source = pending.join("incoming").join(name);
            if !regular(&source, hash) {
                return Err(CHANGED.into());
            }
            fs::hard_link(source, mods.join(name)).map_err(|e| e.to_string())?;
        }
        if let Some(runtime) = &journal.runtime {
            runtime.activate(root)?;
        }
        fs::rename(&pending, &backup).map_err(|e| e.to_string())
    };
    if let Err(error) = activate() {
        restore(root, &pending).map_err(|restore| format!("{error} {restore}"))?;
        return Err(error);
    }
    if journal.originals.is_empty() && journal.runtime.is_none() {
        let _ = fs::remove_dir_all(&backup);
        Ok(None)
    } else {
        let _ = fs::remove_dir_all(backup.join("incoming"));
        Ok(Some(backup.join("original")))
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModUpdateResult {
    applied: bool,
    skipped: Vec<ModIssue>,
}

fn retain_required_updates(selection: &mut Selection, repairs: &Selection) {
    let mut keep: BTreeSet<_> = selection.iter().filter(|(project, entry)| {
        entry.action.kind == "update" || repairs.contains_key(*project)
    }).map(|(project, _)| project.clone()).collect();
    let mut pending: Vec<_> = keep.iter().cloned().collect();
    while let Some(project) = pending.pop() {
        for dependency in selection[&project].version.dependencies.iter()
            .filter(|dependency| dependency.dependency_type == "required")
        {
            for (project, _) in selection.iter().filter(|(project, entry)| {
                dependency_matches(dependency, Some(project), Some(&entry.version.id))
            }) {
                if keep.insert(project.clone()) {
                    pending.push(project.clone());
                }
            }
        }
    }
    selection.retain(|project, _| keep.contains(project));
}

fn preserve_compatible_updates(
    config: &InstanceConfig,
    report: &CompatibilityReport,
    stage: &Stage,
    selection: &mut Selection,
    replacements: &mut BTreeMap<String, String>,
    repairs: &Selection,
    cancel: &AtomicBool,
) -> Result<Vec<ModIssue>, String> {
    let mut skipped = Vec::new();
    while !selection.is_empty() {
        if cancel.load(Ordering::SeqCst) {
            return Err("__cancelled__".into());
        }
        let Err(issue) = catalog::check_staged_fabric_requirements(config, report, stage, selection, replacements) else {
            break;
        };
        if issue.files.is_empty() {
            return Err(issue.message);
        }
        for (old, _) in replacements.iter().filter(|(_, new)| issue.files.contains(*new)) {
            skipped.push(ModIssue {
                file_name: Some(old.clone()),
                message: format!("Update skipped. {}", issue.message),
                kind: ModIssueKind::Update,
            });
        }
        let before = selection.len();
        selection.retain(|_, entry| !issue.files.contains(&entry.file.file_name));
        if selection.len() == before {
            return Err(issue.message);
        }
        replacements.retain(|_, new| !issue.files.contains(new));
        retain_required_updates(selection, repairs);
    }
    Ok(skipped)
}

#[tauri::command]
pub(crate) async fn update_instance_mods(
    app: tauri::AppHandle,
    instance_id: String,
    state: tauri::State<'_, LauncherState>,
) -> Result<ModUpdateResult, String> {
    let plan = plan(instance_id.clone(), true).await?;
    let (mut selection, mut replacements) = if plan.updates.is_empty() {
        (plan.repairs.clone(), BTreeMap::new())
    } else {
        (plan.updates, plan.replacements)
    };
    if selection.is_empty() {
        return if plan.summary.complete {
            Ok(ModUpdateResult::default())
        } else {
            Err("Could not finish checking for compatible mod updates. Check again.".into())
        };
    }
    crate::run_mod_edit(&state, move || {
        let config = crate::load_instance(&instance_id)?;
        if crate::readable_instance_root(&config, true)? != plan.report.directory {
            return Err(CHANGED.into());
        }
        let total_bytes = selection
            .values()
            .filter(|entry| entry.enable_from.is_none())
            .map(|entry| entry.file.size)
            .fold(0u64, u64::saturating_add);
        with_download(&app, &config, "Mod updates", total_bytes, |result: &ModUpdateResult| result.applied, |cancel, task_id| {
            let stage = prepare_mods(
                &config,
                &plan.report,
                &selection,
                &replacements,
                &BTreeMap::new(),
                cancel,
                |done, bytes| {
                    content_downloads::progress(
                        &app,
                        task_id,
                        (done * 92 / selection.len()) as u8,
                        "Preparing mod updates".into(),
                        bytes,
                        total_bytes,
                        0,
                    )
                },
            )?;
            let skipped = preserve_compatible_updates(
                &config, &plan.report, &stage, &mut selection, &mut replacements,
                &plan.repairs, cancel,
            )?;
            if cancel.load(Ordering::SeqCst) {
                return Err("__cancelled__".into());
            }
            if selection.is_empty() {
                return Ok(ModUpdateResult { applied: false, skipped });
            }
            let _game = workspace_install::updates::mod_maintenance_game_lease(&instance_id)?;
            let _edit = workspace_install::updates::edit_lease(&instance_id)?;
            let current = crate::load_instance(&instance_id)?;
            let pins = workspace_install::updates::mod_maintenance_pins(&instance_id)?;
            if current.directory != config.directory
                || pinned_token(&pins) != plan.protection_token
                || selection.values().any(|entry| {
                    protected_mod(
                        &pins,
                        &entry.file.file_name,
                        entry.file.project_id.as_deref(),
                    )
                })
            {
                return Err(CHANGED.into());
            }
            if cancel.load(Ordering::SeqCst) {
                return Err("__cancelled__".into());
            }
            content_downloads::progress(
                &app,
                task_id,
                99,
                "Applying verified files".into(),
                total_bytes,
                total_bytes,
                0,
            );
            commit_updates(&current, &plan.report, &selection, &replacements, &stage)?;
            Ok(ModUpdateResult { applied: true, skipped })
        })
    })
    .await
}

fn with_download<T>(
    app: &tauri::AppHandle,
    config: &InstanceConfig,
    title: &str,
    total_bytes: u64,
    applied: impl FnOnce(&T) -> bool,
    operation: impl FnOnce(&AtomicBool, &str) -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<LauncherState>();
    let task_id = uuid::Uuid::new_v4().to_string();
    let snapshot = {
        let mut queue = state
            .content_install_queue
            .lock()
            .map_err(|_| "The content queue is busy.")?;
        state
            .content_cancel_requested
            .store(false, Ordering::SeqCst);
        queue.enqueue(content_downloads::ContentDownload {
            id: task_id.clone(),
            instance_id: config.id.clone(),
            instance_name: config.name.clone(),
            project_id: format!("maintenance-{task_id}"),
            category: "mods".into(),
            title: title.into(),
            version: String::new(),
            icon_url: None,
            state: "installing".into(),
            message: "Preparing verified files".into(),
            progress: 0,
            downloaded_bytes: 0,
            total_bytes,
            bytes_per_second: 0,
            completed_at: None,
            revision: 0,
        })?;
        queue.snapshot()
    };
    content_downloads::publish(app, &snapshot);
    let mut result = operation(&state.content_cancel_requested, &task_id);
    let changed = result.as_ref().is_ok_and(applied);
    let (status, message) = match &result {
        Ok(_) if changed => ("installed", "Installed".into()),
        Ok(_) => ("installed", "No compatible updates applied".into()),
        Err(error) if error == "__cancelled__" => {
            result = Err("Mod maintenance was cancelled.".into());
            ("cancelled", "Cancelled".into())
        }
        Err(error) => ("error", error.clone()),
    };
    if let Ok(mut queue) = state.content_install_queue.lock() {
        queue.finish(&task_id, status, message);
        let snapshot = queue.snapshot();
        drop(queue);
        content_downloads::publish(app, &snapshot);
    }
    if status != "cancelled" && (changed || result.is_err()) {
        crate::notifications::record_mod_update(app, config, &task_id, result.is_ok());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(
        project: &str,
        id: &str,
        release_date: &str,
        dependencies: serde_json::Value,
    ) -> ModrinthVersion {
        serde_json::from_value(serde_json::json!({
            "id": id, "project_id": project, "version_number": id,
            "version_type": "release", "date_published": release_date,
            "game_versions": ["1.21.1"], "loaders": ["fabric"], "dependencies": dependencies,
            "files": [{
                "filename": format!("{id}.jar"), "size": 42, "primary": true,
                "url": format!("https://cdn.modrinth.com/data/{id}.jar"),
                "hashes": {"sha512": format!("{:x}", sha2::Sha512::digest(id.as_bytes()))}
            }]
        }))
        .unwrap()
    }

    fn test_file(version: &ModrinthVersion) -> CheckedFile {
        let file = &version.files[0];
        CheckedFile {
            category: "mods",
            file_name: file.filename.clone(),
            size: file.size,
            enabled: true,
            state: FileState::Verified,
            message: String::new(),
            can_keep_local: false,
            duplicate_group: None,
            project_id: version.project_id.clone(),
            version_id: Some(version.id.clone()),
            fingerprint: file.hashes.get("sha512").cloned(),
            mod_id: version.project_id.clone(),
            mod_name: version.project_id.clone(),
        }
    }

    fn inventory(versions: &[&ModrinthVersion]) -> (CompatibilityReport, VersionMap) {
        let files: Vec<_> = versions.iter().map(|version| test_file(version)).collect();
        let known = files
            .iter()
            .zip(versions)
            .map(|(file, version)| (file.fingerprint.clone().unwrap(), (*version).clone()))
            .collect();
        (
            CompatibilityReport {
                instance_id: "example".into(),
                name: "Example".into(),
                review_token: None,
                minecraft_version: "1.21.1".into(),
                loader: "Fabric".into(),
                loader_version: Some("0.16.12".into()),
                files,
                issues: Vec::new(),
                excluded_folders: Vec::new(),
                excluded_local_files: Vec::new(),
                missing_dependencies: Vec::new(),
                fabric_runtime_verified: false,
                directory: PathBuf::new(),
            },
            known,
        )
    }

    #[test]
    fn staged_updates_keep_sodium_when_an_installed_addon_pins_it() {
        use std::io::Write;
        let root = Stage(std::env::temp_dir().join(format!("delight-sodium-test-{}", uuid::Uuid::new_v4())));
        let mods = root.0.join("mods");
        fs::create_dir_all(&mods).unwrap();
        let stage = Stage(root.0.join("incoming"));
        fs::create_dir(&stage.0).unwrap();
        let config: InstanceConfig = serde_json::from_value(serde_json::json!({
            "id": "test", "name": "Test", "loader": "Fabric", "version": "26.3",
            "directory": root.0, "java": "Automatic", "memory": 4096, "jvmArguments": "",
            "mods": true, "resourcePacks": true, "shaderPacks": true, "config": true,
            "customResolution": false, "visible": true, "shortcut": false
        })).unwrap();
        let empty = serde_json::json!([]);
        let sodium = version("sodium", "sodium-old", "", empty.clone());
        let reese = version("reese", "reese-old", "", empty.clone());
        let addon = version("addon", "addon-old", "", empty.clone());
        let independent = version("other", "other-old", "", empty.clone());
        let (mut report, _) = inventory(&[&sodium, &reese, &addon, &independent]);
        report.directory = root.0.clone();
        report.minecraft_version = "26.3".into();
        report.loader_version = None;
        let write_jar = |dir: &Path, name: &str, id: &str, version: &str, depends| {
            let mut jar = zip::ZipWriter::new(File::create_new(dir.join(name)).unwrap());
            jar.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
            jar.write_all(&serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1, "id": id, "version": version, "depends": depends
            })).unwrap()).unwrap();
            jar.finish().unwrap();
        };
        let no_deps = serde_json::json!({});
        write_jar(&mods, "sodium-old.jar", "sodium", "0.9.2+mc26.3", no_deps.clone());
        write_jar(&mods, "reese-old.jar", "reese", "2.2.5", serde_json::json!({"sodium": "=0.9.2+mc26.3"}));
        write_jar(&mods, "addon-old.jar", "addon", "1.0", serde_json::json!({"sodium": "=0.9.2+mc26.3"}));
        write_jar(&mods, "other-old.jar", "other", "1.0", no_deps.clone());
        write_jar(&stage.0, "sodium-new.jar", "sodium", "0.9.3+mc26.3", no_deps.clone());
        write_jar(&stage.0, "reese-new.jar", "reese", "2.2.6", serde_json::json!({"sodium": "=0.9.3+mc26.3"}));
        write_jar(&stage.0, "other-new.jar", "other", "2.0", no_deps);
        let mut selection = Selection::new();
        let mut replacements = BTreeMap::new();
        for (project, old, new) in [
            ("sodium", "sodium-old", "sodium-new"),
            ("reese", "reese-old", "reese-new"),
            ("other", "other-old", "other-new"),
        ] {
            let version = version(project, new, "", empty.clone());
            let file_name = format!("{new}.jar");
            let path = stage.0.join(&file_name);
            let file = PlayerFile {
                category: "mods".into(),
                file_name,
                enabled: true,
                size: fs::metadata(&path).unwrap().len(),
                source: "modrinth".into(),
                sha512: content_transfer::hash(&path).unwrap(),
                project_id: Some(project.into()),
                version_id: Some(version.id.clone()),
                download_url: None,
            };
            replacements.insert(format!("{old}.jar"), file.file_name.clone());
            selection.insert(project.into(), Selected {
                action: Action {
                    name: project.into(), version: "new".into(), file_name: file.file_name.clone(),
                    kind: "update", required_by: BTreeSet::new(),
                },
                file, version: Arc::new(version), enable_from: None,
            });
        }
        let skipped = preserve_compatible_updates(
            &config, &report, &stage, &mut selection, &mut replacements, &Selection::new(),
            &AtomicBool::new(false),
        ).unwrap();
        assert_eq!(selection.keys().map(String::as_str).collect::<Vec<_>>(), ["other"]);
        assert_eq!(replacements, BTreeMap::from([("other-old.jar".into(), "other-new.jar".into())]));
        assert_eq!(skipped.iter().filter_map(|issue| issue.file_name.as_deref()).collect::<Vec<_>>(),
            ["sodium-old.jar", "reese-old.jar"]);
        assert!(mods.join("sodium-old.jar").is_file() && mods.join("reese-old.jar").is_file());
    }

    #[test]
    fn update_resolves_required_dependencies_of_the_new_version() {
        let before = version(
            "app",
            "before1",
            "2025-01-01",
            serde_json::json!([
                {"project_id":"oldDep","dependency_type":"required"}
            ]),
        );
        let after = version(
            "app",
            "after2",
            "2025-02-01",
            serde_json::json!([
                {"project_id":"newDep","dependency_type":"required"},
                {"project_id":"other","dependency_type":"optional"}
            ]),
        );
        let new_dep = version("newDep", "dep3", "2025-01-01", serde_json::json!([]));
        let (mut installed, versions) = inventory(&[&before]);
        assess(&mut installed, &versions, &[]);
        assert_eq!(
            installed.missing_dependencies[0].project_id.as_deref(),
            Some("oldDep")
        );
        let mut wrong_game = after.clone();
        wrong_game.game_versions = vec!["1.21.2".into()];
        assert!(make_candidate(&installed.files[0], &before, wrong_game, "1.21.1").is_none());
        let mut wrong_loader = after.clone();
        wrong_loader.loaders = vec!["forge".into()];
        assert!(make_candidate(&installed.files[0], &before, wrong_loader, "1.21.1").is_none());
        let mut beta = after.clone();
        beta.version_type = "beta".into();
        assert!(make_candidate(&installed.files[0], &before, beta, "1.21.1").is_none());
        let update = make_candidate(&installed.files[0], &before, after, "1.21.1").unwrap();
        let updates = vec![update];
        let (effective, known) = graph_after_updates(&installed, &versions, &updates);
        let mut catalog = Catalog::default();
        catalog
            .choices
            .insert("newDep".into(), Some(Arc::new(new_dep)));
        catalog
            .titles
            .insert("newDep".into(), "New dependency".into());
        let plan =
            tauri::async_runtime::block_on(plan_dependencies(&effective, &known, &mut catalog));
        assert_eq!(
            plan.selection
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["newDep"]
        );
        assert!(check_graph(&effective, &known, &updates, &plan.selection, &catalog.titles).is_empty());
    }

    #[test]
    fn an_enabled_mod_can_pin_the_previous_version_and_followed_paths_are_protected() {
        let before = version("library", "lib1", "2025-01-01", serde_json::json!([]));
        let after = version("library", "lib2", "2025-02-01", serde_json::json!([]));
        let app = version(
            "app",
            "app3",
            "2025-02-01",
            serde_json::json!([
                {"project_id":"library", "version_id":"lib1", "dependency_type":"required"}
            ]),
        );
        let (installed, versions) = inventory(&[&before, &app]);
        let update = make_candidate(&installed.files[0], &before, after, "1.21.1").unwrap();
        let pins = [update.file.clone()];
        assert!(protected_mod(&pins, "LIB2.jar.disabled", None));
        assert!(protected_mod(&pins, "renamed.jar", Some("library")));
        let updates = vec![update];
        let (effective, known) = graph_after_updates(&installed, &versions, &updates);
        let blockers = check_graph(&effective, &known, &updates, &Selection::new(), &HashMap::new());
        assert_eq!(
            blockers.get("lib1.jar").map(String::as_str),
            Some("app still requires the installed version.")
        );
    }

    #[test]
    fn interrupted_replacement_recovers_unmodified_and_replaced_originals() {
        let root =
            std::env::temp_dir().join(format!("delight-maintenance-test-{}", uuid::Uuid::new_v4()));
        let _cleanup = Stage(root.clone());
        let pending = root.join(PENDING);
        let mods = root.join("mods");
        let original = pending.join("original");
        let incoming = pending.join("incoming");
        for directory in [&mods, &original, &incoming] {
            fs::create_dir_all(directory).unwrap();
        }
        fs::write(original.join("keep.jar"), b"keep").unwrap();
        fs::write(original.join("swap.jar"), b"original").unwrap();
        fs::write(mods.join("keep.jar"), b"keep").unwrap();
        fs::write(incoming.join("swap.jar"), b"replacement").unwrap();
        fs::write(incoming.join("addon.jar"), b"dependency").unwrap();
        fs::hard_link(incoming.join("swap.jar"), mods.join("swap.jar")).unwrap();
        fs::hard_link(incoming.join("addon.jar"), mods.join("addon.jar")).unwrap();
        let checksums = |dir: &Path, names: &[&str]| {
            names
                .iter()
                .map(|name| {
                    (
                        name.to_string(),
                        content_transfer::hash(&dir.join(name)).unwrap(),
                    )
                })
                .collect()
        };
        let journal = Journal {
            originals: checksums(&original, &["keep.jar", "swap.jar"]),
            incoming: checksums(&incoming, &["swap.jar", "addon.jar"]),
            runtime: None,
        };
        fs::write(
            pending.join("journal.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();
        restore(&root, &pending).unwrap();
        assert_eq!(fs::read(mods.join("keep.jar")).unwrap(), b"keep");
        assert_eq!(fs::read(mods.join("swap.jar")).unwrap(), b"original");
        assert!(!mods.join("addon.jar").exists());
        assert!(!pending.exists());
    }
}
