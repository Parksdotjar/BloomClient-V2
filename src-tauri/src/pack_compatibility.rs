use crate::{content_transfer, fabric_loader, instance_actions, InstanceConfig, ModrinthVersion};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Mutex, OnceLock},
    time::SystemTime,
};

#[path = "pack_dependencies.rs"]
pub(crate) mod dependencies;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum FileState {
    Verified,
    Managed,
    Issue,
    #[serde(rename = "localOnly")]
    LocalOnly,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExcludedLocalFile {
    file_name: String,
    #[serde(rename = "sha512")]
    fingerprint: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckedFile {
    category: &'static str,
    file_name: String,
    size: u64,
    enabled: bool,
    state: FileState,
    message: String,
    can_keep_local: bool,
    duplicate_group: Option<String>,
    project_id: Option<String>,
    version_id: Option<String>,
    #[serde(rename = "sha512")]
    fingerprint: Option<String>,
    #[serde(skip)]
    mod_id: Option<String>,
    #[serde(skip)]
    mod_name: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MissingDependency {
    project_id: Option<String>,
    version_id: Option<String>,
    required_by: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibilityReport {
    instance_id: String,
    name: String,
    review_token: Option<String>,
    minecraft_version: String,
    loader: String,
    loader_version: Option<String>,
    files: Vec<CheckedFile>,
    issues: Vec<String>,
    excluded_folders: Vec<String>,
    excluded_local_files: Vec<ExcludedLocalFile>,
    missing_dependencies: Vec<MissingDependency>,
    #[serde(skip)]
    fabric_runtime_verified: bool,
    #[serde(skip)]
    directory: PathBuf,
}

fn inspect_file(
    config: &InstanceConfig,
    category: &'static str,
    path: &Path,
    name: String,
    metadata: &fs::Metadata,
) -> CheckedFile {
    let size = metadata.len();
    let lower = name.to_ascii_lowercase();
    let mut file = CheckedFile {
        category,
        file_name: name,
        size,
        enabled: !lower.ends_with(".disabled"),
        state: FileState::Issue,
        message: String::new(),
        can_keep_local: false,
        duplicate_group: None,
        project_id: None,
        version_id: None,
        fingerprint: None,
        mod_id: None,
        mod_name: None,
    };
    if category == "mods" && crate::cosmetics::is_managed_file(&file.file_name) {
        if let Some(hash) =
            crate::cosmetics::current_bundle_fingerprint(config, &file.file_name, path, size)
        {
            file.state = FileState::Managed;
            file.fingerprint = Some(hash);
            file.message = "Delight supplies this cosmetic separately on each installation.".into();
        } else {
            file.message = "This cosmetic differs from Delight’s bundled copy. Check the instance’s cosmetics installation and recheck.".into();
        }
        return file;
    }
    let extension = if category == "mods" { ".jar" } else { ".zip" };
    if !lower
        .strip_suffix(".disabled")
        .unwrap_or(&lower)
        .ends_with(extension)
    {
        file.message = format!("This folder supports {extension} files for sharing. Move this file to a backup or use a supported release.");
        return file;
    }
    match content_transfer::manifest(path, category) {
        Ok(Some(meta)) if category == "mods" => {
            file.mod_name = meta["name"].as_str().filter(|name| !name.is_empty())
                .map(|name| name.chars().take(200).collect());
            if meta["environment"] == "server" {
                file.message =
                    "This mod is for dedicated servers. Use its client release in this instance."
                        .into();
                return file;
            }
            if config.loader.eq_ignore_ascii_case("fabric")
                && fabric_discovers_file(&file.file_name, metadata)
            {
                file.mod_id = fabric_primary_id(&meta).map(str::to_owned);
            }
        }
        Ok(_) => {}
        Err(reason) => {
            file.message = reason;
            return file;
        }
    }
    match content_transfer::hash(path) {
        Ok(hash) => file.fingerprint = Some(hash),
        Err(_) => {
            file.message =
                "Delight could not read the whole file. Close any program changing it and recheck."
                    .into()
        }
    }
    file
}

#[derive(PartialEq, Eq)]
struct FileStamp {
    size: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
    fabric: bool,
}

type ScanCache = HashMap<PathBuf, (FileStamp, CheckedFile)>;
static SCAN_CACHE: OnceLock<Mutex<ScanCache>> = OnceLock::new();

fn scan_category(
    config: &InstanceConfig,
    category: &'static str,
    report: &mut CompatibilityReport,
    cached: bool,
) -> Result<(), String> {
    let dir = Path::new(&config.directory).join(category);
    let entries_error =
        || format!("Could not read the {category} folder. Check its permissions and try again.");
    let meta = match fs::symlink_metadata(&dir) {
        Ok(meta) => meta,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(entries_error()),
    };
    if instance_actions::linked(&meta) || !meta.is_dir() {
        report.issues.push(format!("The {category} folder must be a local directory. Review the folder in this instance and recheck."));
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|_| entries_error())? {
        let entry = entry.map_err(|_| entries_error())?;
        let name = entry.file_name().into_string().map_err(|_| {
            format!("A file in {category} has an unreadable name. Rename it and try again.")
        })?;
        if crate::is_content_metadata(category, &name) {
            continue;
        }
        let meta = fs::symlink_metadata(entry.path()).map_err(|_| entries_error())?;
        if instance_actions::linked(&meta) {
            report.issues.push(format!(
                "{category}/{name} is linked. Use a regular local file to verify its contents."
            ));
        } else if meta.is_dir() {
            report.issues.push(format!("{category}/{name} is unpacked. Use its packaged release from Modrinth to verify it."));
        } else if meta.is_file() {
            let path = entry.path();
            let stamp = meta.modified().ok().map(|modified| FileStamp {
                size: meta.len(),
                modified,
                created: meta.created().ok(),
                fabric: config.loader.eq_ignore_ascii_case("fabric"),
            });
            let cache = SCAN_CACHE.get_or_init(Mutex::default);
            let cacheable = cached && !crate::cosmetics::is_managed_file(&name);
            let prior = cacheable.then(|| {
                let entries = cache.lock().ok()?;
                let (previous, file) = entries.get(&path)?;
                (Some(previous) == stamp.as_ref()).then(|| file.clone())
            }).flatten();
            let file = prior.unwrap_or_else(|| inspect_file(config, category, &path, name, &meta));
            if cacheable && file.fingerprint.is_some() {
                if let (Some(stamp), Ok(mut entries)) = (stamp, cache.lock()) {
                    if entries.len() >= 8192 {
                        entries.retain(|entry, _| entry.exists());
                        if entries.len() >= 8192 {
                            entries.clear();
                        }
                    }
                    entries.insert(path, (stamp, file.clone()));
                }
            }
            report.files.push(file);
        } else {
            report.issues.push(format!(
                "{category}/{name} cannot be shared as a regular file."
            ));
        }
    }
    Ok(())
}

fn unsupported_content(root: &Path, name: &str) -> Result<bool, String> {
    let dir = root.join(name);
    let problem =
        || format!("Could not inspect the {name} folder. Check its permissions and try again.");
    match fs::symlink_metadata(&dir) {
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
        Err(_) => Err(problem()),
        Ok(meta) if instance_actions::linked(&meta) || !meta.is_dir() => Ok(true),
        Ok(_) => fs::read_dir(dir)
            .map_err(|_| problem())?
            .next()
            .transpose()
            .map(|entry| entry.is_some())
            .map_err(|_| problem()),
    }
}

fn scan(config: &InstanceConfig) -> Result<CompatibilityReport, String> {
    scan_inventory(config, true, false)
}

fn scan_mods(config: &InstanceConfig) -> Result<CompatibilityReport, String> {
    scan_inventory(config, false, false)
}

fn scan_mods_cached(config: &InstanceConfig) -> Result<CompatibilityReport, String> {
    scan_inventory(config, false, true)
}

fn scan_inventory(config: &InstanceConfig, sharing: bool, cached: bool) -> Result<CompatibilityReport, String> {
    let root = crate::readable_instance_root(config, true)?;
    let mut report = CompatibilityReport {
        instance_id: config.id.clone(),
        name: config.name.clone(),
        review_token: None,
        minecraft_version: config.version.clone(),
        loader: config.loader.clone(),
        loader_version: None,
        files: Vec::new(),
        issues: Vec::new(),
        excluded_folders: Vec::new(),
        excluded_local_files: Vec::new(),
        missing_dependencies: Vec::new(),
        fabric_runtime_verified: false,
        directory: root.to_path_buf(),
    };
    if !sharing && config.loader.eq_ignore_ascii_case("vanilla") {
        return Ok(report);
    }
    if config.loader.eq_ignore_ascii_case("fabric") {
        report.loader_version = fabric_loader::current_version(config);
        if report.loader_version.is_none() {
            report.issues.push("Select a Fabric Loader version in instance settings or launch the instance once, then recheck.".into());
        }
    } else if sharing {
        report.issues.push("The first shared release currently supports Fabric. Choose a Fabric instance to continue.".into());
    } else {
        report.issues.push("Mod maintenance currently supports Fabric instances.".into());
    }
    scan_category(config, "mods", &mut report, cached)?;
    if sharing {
        for category in ["resourcepacks", "shaderpacks"] {
            scan_category(config, category, &mut report, cached)?;
        }
        for dir in ["config", "defaultconfigs", "kubejs", "scripts", "global_packs", "datapacks"] {
            if unsupported_content(root, dir)? {
                report.excluded_folders.push(dir.to_string());
            }
        }
    }
    report
        .files
        .sort_by(|a, b| (a.category, &a.file_name).cmp(&(b.category, &b.file_name)));
    report.issues.sort();
    Ok(report)
}

async fn lookup_sources(files: &[CheckedFile], fresh: bool) -> Result<HashMap<String, ModrinthVersion>, String> {
    let hashes = files.iter().filter(|file| file.state != FileState::Managed)
        .filter_map(|file| file.fingerprint.clone()).collect();
    dependencies::maintenance::lookup(hashes, None, fresh).await
}

async fn lookup_versions(files: &[CheckedFile]) -> Result<HashMap<String, ModrinthVersion>, String> {
    lookup_sources(files, false).await
}

fn source_issue(
    file: &CheckedFile,
    hash: &str,
    version: &ModrinthVersion,
    game: &str,
) -> Option<String> {
    if !version.game_versions.iter().any(|v| v == game) {
        return Some(format!(
            "Install a release that lists support for Minecraft {game}, then recheck."
        ));
    }
    if file.category == "mods"
        && !version
            .loaders
            .iter()
            .any(|v| v.eq_ignore_ascii_case("fabric"))
    {
        return Some(
            "This release does not list Fabric support. Choose the Fabric version and recheck."
                .into(),
        );
    }
    if file.category == "resourcepacks" && !version.loaders.iter().any(|v| v == "minecraft") {
        return Some("Choose a Minecraft resource-pack release from Modrinth and recheck.".into());
    }
    if file.category == "shaderpacks"
        && !version
            .loaders
            .iter()
            .any(|v| matches!(v.as_str(), "iris" | "canvas" | "vanilla"))
    {
        return Some(
            "Choose a shader release that lists Iris, Canvas or vanilla compatibility and recheck."
                .into(),
        );
    }
    if version.id.is_empty() || version.project_id.as_deref().unwrap_or_default().is_empty() {
        return Some("Modrinth could not identify the project and version. Choose a catalog release and recheck.".into());
    }
    let matched = version.files.iter().find(|source| {
        source
            .hashes
            .get("sha512")
            .is_some_and(|value| value == hash)
            && source.size == file.size
            && crate::workspace_player::trusted_file_url(&source.url)
    });
    if matched.is_none() {
        return Some("The installed file has no matching Modrinth download. Replace it with a catalog copy and recheck.".into());
    }
    None
}

fn assess(
    report: &mut CompatibilityReport,
    versions: &HashMap<String, ModrinthVersion>,
    local_choices: &[ExcludedLocalFile],
) {
    for file in &mut report.files {
        if file.state == FileState::Managed {
            continue;
        }
        file.state = FileState::Issue;
        file.can_keep_local = false;
        let Some(hash) = file.fingerprint.as_deref() else {
            continue;
        };
        let Some(version) = versions.get(hash) else {
            file.can_keep_local = true;
            file.message = "Modrinth has no match for this exact file.".into();
            continue;
        };
        if let Some(issue) = source_issue(file, hash, version, &report.minecraft_version) {
            file.can_keep_local = file.category != "mods" || !file.enabled;
            file.message = issue;
            continue;
        }
        file.state = FileState::Verified;
        file.project_id = version.project_id.clone();
        file.version_id = Some(version.id.clone());
        file.message = format!(
            "Exact file verified on Modrinth · {}",
            version.version_number
        );
    }

    // Remember compatible, enabled providers before marking their duplicate
    // group. The group blocks publication on its own; its dependents do not
    // also need an install warning for a file already present.
    let installed: Vec<_> = report.files.iter()
        .filter(|file| file.enabled && file.state == FileState::Verified)
        .map(|file| (file.project_id.clone(), file.version_id.clone()))
        .collect();
    mark_duplicate_groups(&mut report.files);
    let requested = local_choices
        .iter()
        .map(|file| (file.file_name.as_str(), file.fingerprint.as_str()))
        .collect::<HashSet<_>>();
    report.excluded_local_files.clear();
    for file in report.files.iter_mut().filter(|file| file.can_keep_local) {
        let Some(hash) = file.fingerprint.as_ref() else {
            continue;
        };
        if requested.contains(&(file.file_name.as_str(), hash.as_str())) {
            file.state = FileState::LocalOnly;
            file.message = "This file stays on this instance. Followers won’t receive it.".into();
            report.excluded_local_files.push(ExcludedLocalFile {
                file_name: file.file_name.clone(),
                fingerprint: hash.clone(),
            });
        }
    }

    let renderers: HashSet<_> = report.files.iter()
        .filter(|file| file.enabled && file.project_id.is_some())
        .filter_map(|file| file.mod_id.clone())
        .collect();
    let mut missing = BTreeMap::<_, Vec<String>>::new();
    for file in report
        .files
        .iter_mut()
        .filter(|f| f.enabled && f.state == FileState::Verified)
    {
        let version = &versions[file.fingerprint.as_ref().unwrap()];
        if file.category == "shaderpacks"
            && !version.loaders.iter().any(|loader| {
                loader == "vanilla"
                    || (matches!(loader.as_str(), "iris" | "canvas") && renderers.contains(loader))
            })
        {
            file.state = FileState::Issue;
            let supported = version
                .loaders
                .iter()
                .filter(|v| matches!(v.as_str(), "iris" | "canvas"))
                .cloned()
                .collect::<Vec<_>>()
                .join(" or ");
            file.message = format!(
                "Install and enable a supported shader loader ({supported}), then recheck."
            );
            continue;
        }
        for dep in &version.dependencies {
            let present = installed.iter().any(|(project, version)| {
                dependency_matches(dep, project.as_deref(), version.as_deref())
            });
            if dep.dependency_type == "required" && !present {
                let requesters = missing
                    .entry((dep.project_id.clone(), dep.version_id.clone()))
                    .or_default();
                if !requesters.contains(&file.file_name) {
                    requesters.push(file.file_name.clone());
                }
                if file.state != FileState::Issue {
                    file.state = FileState::Issue;
                    file.message = "This file needs a dependency. Review dependencies to see what’s missing.".into();
                }
            } else if dep.dependency_type == "incompatible" && present {
                let target = dep.project_id.as_deref().or(dep.version_id.as_deref())
                    .unwrap_or("another installed file");
                file.state = FileState::Issue;
                file.message = format!(
                    "This release conflicts with {target}. Choose compatible versions and recheck."
                );
            }
        }
    }
    report.missing_dependencies = missing.into_iter()
        .map(|((project_id, version_id), required_by)| MissingDependency {
            project_id, version_id, required_by,
        })
        .collect();
}

fn dependency_matches(dep: &crate::ModrinthDependency, project: Option<&str>, version: Option<&str>) -> bool {
    (dep.project_id.is_some() || dep.version_id.is_some())
        && (dep.project_id.is_none() || dep.project_id.as_deref() == project)
        && (dep.version_id.is_none() || dep.version_id.as_deref() == version)
}

pub(crate) fn fabric_discovers_file(name: &str, metadata: &fs::Metadata) -> bool {
    // Match Fabric's top-level discovery: .jar is case-sensitive and hidden
    // files, including the Windows Hidden attribute, do not load.
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x2 != 0 {
            return false;
        }
    }
    metadata.is_file() && !name.starts_with('.') && name.ends_with(".jar")
}

pub(crate) fn fabric_primary_id(metadata: &serde_json::Value) -> Option<&str> {
    if metadata["environment"] == "server" {
        return None;
    }
    let id = metadata["id"].as_str()?;
    let mut chars = id.bytes();
    let valid = (2..=64).contains(&id.len())
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"_-".contains(&c));
    valid.then_some(id)
}

fn mark_duplicate_groups(files: &mut [CheckedFile]) {
    let mut counts = HashMap::new();
    for file in files.iter().filter(|file| file.enabled) {
        if let Some(id) = &file.mod_id {
            *counts.entry(id.clone()).or_insert(0) += 1;
        }
    }
    for file in files {
        file.duplicate_group = file.mod_id.as_ref().filter(|id| {
            file.enabled && counts.get(*id).is_some_and(|count| *count > 1)
        }).cloned();
        if let Some(id) = &file.duplicate_group {
            file.state = FileState::Issue;
            file.can_keep_local = false;
            file.message = format!("Multiple enabled files provide {id}. Choose which one to keep enabled.");
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DuplicateCandidate {
    file_name: String,
    #[serde(rename = "sha512")]
    fingerprint: String,
}

fn move_without_replacing(source: &Path, destination: &Path, reviewed_hash: &str) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if !metadata.is_file() || instance_actions::linked(&metadata) {
        return Err(std::io::Error::other("The mod is no longer a regular file."));
    }
    // The content and filesystem identity stay the same. Creating the second
    // name first also refuses a concurrent destination instead of replacing it.
    fs::hard_link(source, destination)?;
    let matches_review = content_transfer::hash(destination).is_ok_and(|hash| hash == reviewed_hash);
    if !same_file::is_same_file(source, destination).unwrap_or(false) {
        return Err(std::io::Error::other("The mod moved while Delight was changing it."));
    }
    if !matches_review {
        if same_file::is_same_file(source, destination).unwrap_or(false) {
            let _ = fs::remove_file(destination);
        }
        return Err(std::io::Error::other("The mod contents changed. Check again and choose a version."));
    }
    if let Err(error) = fs::remove_file(source) {
        if same_file::is_same_file(source, destination).unwrap_or(false) {
            let _ = fs::remove_file(destination);
        }
        return Err(error);
    }
    Ok(())
}

fn resolve_duplicate_versions(
    config: &InstanceConfig,
    mod_id: &str,
    keep_file_name: &str,
    candidates: &[DuplicateCandidate],
) -> Result<(), String> {
    let changed = "These mod files changed since the check. Check again and choose a version.";
    if !config.loader.eq_ignore_ascii_case("fabric") || candidates.len() < 2 {
        return Err(changed.into());
    }
    let Some(folder) = crate::existing_content_folder(config, "mods", true)? else {
        return Err(changed.into());
    };
    let expected: HashMap<_, _> = candidates.iter().map(|candidate| {
        (candidate.file_name.as_str(), candidate.fingerprint.as_str())
    }).collect();
    if expected.len() != candidates.len() || !expected.contains_key(keep_file_name) {
        return Err(changed.into());
    }
    let entries_error = "Could not read the mods folder. Check its permissions and try again.";
    let mut matching = 0;
    let mut planned = Vec::new();
    for entry in fs::read_dir(&folder).map_err(|_| entries_error)? {
        let entry = entry.map_err(|_| entries_error)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        let metadata = entry.metadata().map_err(|_| entries_error)?;
        if instance_actions::linked(&metadata) || !fabric_discovers_file(name, &metadata)
            || crate::cosmetics::is_managed_file(name)
        {
            continue;
        }
        let path = entry.path();
        let Ok(Some(manifest)) = content_transfer::manifest(&path, "mods") else { continue; };
        if fabric_primary_id(&manifest) != Some(mod_id) {
            continue;
        }
        let hash = content_transfer::hash(&path).map_err(|_| changed)?;
        if expected.get(name).copied() != Some(hash.as_str()) {
            return Err(changed.into());
        }
        matching += 1;
        if name != keep_file_name {
            let target = folder.join(format!("{name}.disabled"));
            match fs::symlink_metadata(&target) {
                Err(error) if error.kind() == ErrorKind::NotFound => {},
                Ok(_) => return Err(format!("A disabled copy of {name} already exists. Resolve that filename in the mods folder and check again.")),
                Err(_) => return Err(entries_error.into()),
            }
            planned.push((path, target, hash));
        }
    }
    if matching != expected.len() {
        return Err(changed.into());
    }
    let mut completed: Vec<(PathBuf, PathBuf, String)> = Vec::new();
    for (source, destination, reviewed_hash) in planned {
        if let Err(error) = move_without_replacing(&source, &destination, &reviewed_hash) {
            let mut rollback_failed = false;
            for (original, disabled, hash) in completed.iter().rev() {
                rollback_failed |= move_without_replacing(disabled, original, hash).is_err();
            }
            let name = source.file_name().and_then(|value| value.to_str()).unwrap_or("this file");
            if rollback_failed {
                return Err(format!("Could not disable {name} or restore all filenames. Check the mods folder and run the check again. ({error})"));
            }
            return Err(format!("Could not disable {name}. Check the mods folder and try again. ({error})"));
        }
        completed.push((source, destination, reviewed_hash));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn resolve_pack_mod_conflict(
    instance_id: String,
    mod_id: String,
    keep_file_name: String,
    candidates: Vec<DuplicateCandidate>,
    state: tauri::State<'_, crate::LauncherState>,
) -> Result<(), String> {
    instance_actions::validate_id(&instance_id)?;
    let active = state.launch_active.clone();
    let running = state.game_running.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = active.try_lock().map_err(|_| "The launcher is busy. Try again.")?;
        crate::validate_content_install_activity("mods", *guard, running.load(Ordering::SeqCst))?;
        let _edit = crate::workspace_install::updates::edit_lease(&instance_id)?;
        resolve_duplicate_versions(&crate::load_instance(&instance_id)?, &mod_id, &keep_file_name, &candidates)
    })
    .await
    .map_err(|_| "The mod change stopped unexpectedly. Check the mods folder and try again.")?
}

impl CompatibilityReport {
    fn manifest(&self) -> Option<serde_json::Value> {
        if !self.issues.is_empty() || self.loader_version.is_none() {
            return None;
        }
        let mut files = Vec::with_capacity(self.files.len());
        for file in &self.files {
            let source = match file.state {
                FileState::Verified => "modrinth",
                FileState::Managed => "delight",
                FileState::Issue => return None,
                FileState::LocalOnly => continue,
            };
            files.push(serde_json::json!({
                "category": file.category, "fileName": file.file_name, "size": file.size,
                "enabled": file.enabled, "source": source, "sha512": file.fingerprint,
                "projectId": file.project_id, "versionId": file.version_id,
            }));
        }
        let mut manifest = serde_json::json!({
            "name": self.name, "minecraftVersion": self.minecraft_version,
            "loader": self.loader.to_ascii_lowercase(), "loaderVersion": self.loader_version,
            "excludedFolders": self.excluded_folders, "files": files,
        });
        if self.fabric_runtime_verified {
            manifest["modDependencyPolicy"] = serde_json::json!("fabric");
        }
        Some(manifest)
    }

    fn snapshot_token(&self) -> Option<String> {
        use sha2::{Digest, Sha256};
        let snapshot =
            serde_json::json!([self.instance_id, self.manifest()?, self.excluded_local_files]);
        Some(format!(
            "{:x}",
            Sha256::digest(snapshot.to_string().as_bytes())
        ))
    }

    pub(super) fn reviewed_manifest(
        &self,
        expected: &str,
        omissions: &[String],
    ) -> Option<serde_json::Value> {
        if self.review_token.as_deref() != Some(expected) || self.excluded_folders != omissions {
            return None;
        }
        self.manifest()
    }
}

#[tauri::command]
pub(crate) async fn check_pack_compatibility(
    instance_id: String,
    excluded_local_files: Option<Vec<ExcludedLocalFile>>,
) -> Result<CompatibilityReport, String> {
    let (mut report, _) = read_assessment(instance_id, excluded_local_files).await?;
    report.review_token = report.snapshot_token();
    Ok(report)
}

#[tauri::command]
pub(crate) async fn preview_pack_publication(instance_id: String) -> Result<CompatibilityReport, String> {
    let (mut report, _) = read_assessment_mode(instance_id, None, true).await?;
    report.review_token = report.snapshot_token();
    Ok(report)
}

async fn read_assessment(
    instance_id: String,
    excluded_local_files: Option<Vec<ExcludedLocalFile>>,
) -> Result<(CompatibilityReport, HashMap<String, ModrinthVersion>), String> {
    read_assessment_mode(instance_id, excluded_local_files, false).await
}

async fn read_assessment_mode(
    instance_id: String,
    excluded_local_files: Option<Vec<ExcludedLocalFile>>,
    preview: bool,
) -> Result<(CompatibilityReport, HashMap<String, ModrinthVersion>), String> {
    instance_actions::validate_id(&instance_id)?;
    let mut report = tauri::async_runtime::spawn_blocking(move || {
        scan_inventory(&crate::load_instance(&instance_id)?, true, preview)
    }).await.map_err(|_| "The instance check stopped unexpectedly. Retry the check.")??;
    let check_loader = async {
        let Some(pin) = &report.loader_version else { return Ok::<_, String>(None); };
        let versions = fabric_loader::available(&report.minecraft_version).await
            .map_err(|_| "Could not check this Minecraft and Fabric combination. Retry when connected.")?;
        Ok(fabric_loader::check_available(pin, &versions).err().map(|_| {
            format!("Fabric Loader {pin} is unavailable for Minecraft {}.", report.minecraft_version)
        }))
    };
    let (versions, loader_issue) = futures_util::future::join(
        lookup_sources(&report.files, !preview), check_loader,
    ).await;
    let versions = versions?;
    report.issues.extend(loader_issue?);
    let choices = if preview {
        report.files.iter().filter_map(|file| {
            let hash = file.fingerprint.as_ref()?;
            let no_source = versions.get(hash).is_none_or(|version| {
                (file.category != "mods" || !file.enabled)
                    && source_issue(file, hash, version, &report.minecraft_version).is_some()
            });
            (file.state != FileState::Managed && no_source)
                .then(|| ExcludedLocalFile { file_name: file.file_name.clone(), fingerprint: hash.clone() })
        }).collect()
    } else {
        excluded_local_files.unwrap_or_default()
    };
    assess(&mut report, &versions, &choices);
    if !report.excluded_local_files.is_empty() || !report.missing_dependencies.is_empty() {
        report = tauri::async_runtime::spawn_blocking(move || {
            prefer_installed_fabric_requirements(&mut report, true, preview);
            if !report.excluded_local_files.is_empty() {
                check_local_omissions(&mut report);
            }
            report
        }).await.map_err(|_| "Could not verify the files that stay on this device.")?;
    }
    Ok((report, versions))
}

#[path = "pack_fabric_runtime.rs"]
pub(crate) mod runtime;

fn prefer_installed_fabric_requirements(report: &mut CompatibilityReport, sharing: bool, cached: bool) {
    const CATALOG_HINT: &str = "This file needs a dependency.";
    if report.missing_dependencies.is_empty() || !report.loader.eq_ignore_ascii_case("fabric") {
        return;
    }
    let Some(loader) = &report.loader_version else { return; };
    let mods = report.directory.join("mods");
    let candidates: Vec<_> = report.files.iter().filter(|file| file.category == "mods" && file.enabled
        && file.duplicate_group.is_none()
        && (!sharing || file.state == FileState::Verified || file.state == FileState::Managed
            || file.message.starts_with(CATALOG_HINT))).collect();
    let files: Vec<_> = candidates.iter()
        .map(|file| (file.file_name.clone(), mods.join(&file.file_name))).collect();
    let stamps: Vec<_> = candidates.iter()
        .map(|file| (&file.file_name, &file.fingerprint)).collect();
    use sha2::{Digest, Sha256};
    let key = format!("{:x}", Sha256::digest(serde_json::json!([report.minecraft_version, loader, stamps]).to_string()));
    let result = if cached && candidates.iter().all(|file| file.fingerprint.is_some()) {
        runtime::inspect_fingerprinted(&files, &report.minecraft_version, loader, key)
    } else {
        runtime::inspect(&files, &report.minecraft_version, loader)
    };
    let Ok(outcomes) = result else { return; };
    let mut satisfied = HashSet::new();
    for file in &mut report.files {
        match outcomes.get(&file.file_name) {
            Some(Some(issue)) if sharing || file.message.starts_with(CATALOG_HINT) => {
                file.state = FileState::Issue;
                file.message.clone_from(issue);
            }
            Some(None) if file.message.starts_with(CATALOG_HINT) => {
                file.state = FileState::Verified;
                file.message = "Exact download verified. Fabric requirements are satisfied.".into();
                satisfied.insert(file.file_name.clone());
            }
            _ => {}
        }
    }
    if !satisfied.is_empty() {
        report.fabric_runtime_verified |= sharing;
        for dep in &mut report.missing_dependencies {
            dep.required_by.retain(|source| !satisfied.contains(source));
        }
        report.missing_dependencies.retain(|dep| !dep.required_by.is_empty());
    }
}

fn check_local_omissions(report: &mut CompatibilityReport) {
    use dependencies::catalog::{collect_providers, has_provider};
    let directory = report.directory.join("mods");
    let is_mod = |file: &&CheckedFile| file.category == "mods" && file.enabled;
    let mut omitted = BTreeMap::new();
    let mut budget = 64 * 1024 * 1024;
    for file in report.files.iter().filter(is_mod).filter(|file| file.state == FileState::LocalOnly) {
        if let Ok(input) = fs::File::open(directory.join(&file.file_name)) {
            collect_providers(input, &mut omitted, &mut budget, 0);
        }
    }
    let unresolved = "Could not verify bundled dependencies for the mods that stay on this device.";
    if budget == 0 {
        report.issues.push(unresolved.into());
        return;
    }
    if omitted.is_empty() {
        return;
    }
    let mut requirements = Vec::new();
    for (index, file) in report.files.iter().enumerate().filter(|(_, file)| is_mod(file) && file.state == FileState::Verified) {
        let Ok(Some(meta)) = content_transfer::manifest(&directory.join(&file.file_name), "mods") else { continue; };
        let Some(required) = meta["depends"].as_object() else { continue; };
        for (id, predicate) in required {
            if has_provider(&omitted, id, predicate, true) {
                requirements.push((index, id.clone(), predicate.clone()));
            }
        }
    }
    if requirements.is_empty() {
        return;
    }
    let mut delivered = BTreeMap::new();
    for file in report.files.iter().filter(is_mod).filter(|file| matches!(file.state, FileState::Verified | FileState::Managed)) {
        if let Ok(input) = fs::File::open(directory.join(&file.file_name)) {
            collect_providers(input, &mut delivered, &mut budget, 0);
        }
    }
    for (index, id, predicate) in requirements {
        if !has_provider(&delivered, &id, &predicate, true) {
            if budget == 0 {
                report.issues.push(unresolved.into());
                return;
            }
            let file = &mut report.files[index];
            file.state = FileState::Issue;
            file.message = format!("Needs {id}, which is only available on this device. Add a shareable release of that dependency.");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fabric_description_newlines_are_read_without_rewriting_the_jar() {
        let bytes = b"{\"id\":\"works\",\"description\":\"First\nSecond\",\"depends\":{\"fabricloader\":\"*\"}}";
        assert!(serde_json::from_slice::<serde_json::Value>(bytes).is_err());
        let parsed = content_transfer::parse_fabric_metadata(bytes).unwrap();
        assert_eq!(parsed["description"], "First\nSecond");
        assert_eq!(parsed["id"], "works");
        assert!(content_transfer::parse_fabric_metadata(b"{\"id\":\"bad\",").is_err());
    }

    #[test]
    #[ignore = "checks the selected local instance without changing it"]
    fn inspect_real_instance_read_only() {
        let id = std::env::var("DELIGHT_READ_ONLY_INSTANCE").expect("select an instance id");
        let config = crate::load_instance(&id).unwrap();
        let mut elapsed = Vec::new();
        let mut results = Vec::new();
        for _ in 0..2 {
            let start = std::time::Instant::now();
            results.push(scan_mods_cached(&config).unwrap());
            elapsed.push(start.elapsed());
        }
        let first = &results[0];
        let warm = &results[1];
        assert_eq!(first.files.len(), warm.files.len());
        assert!(first.files.iter().zip(&warm.files).all(|(a,b)| a.fingerprint == b.fingerprint));
        eprintln!("{} mod files: cold {:?}, warm {:?}", first.files.len(), elapsed[0], elapsed[1]);
        for file in &warm.files {
            if file.file_name.to_lowercase().contains("bettergrassify") {
                assert_eq!(file.mod_id.as_deref(), Some("bettergrass"));
                assert!(file.fingerprint.is_some());
                eprintln!("BetterGrassify metadata accepted without reinstall");
            }
        }
        let latest = tauri::async_runtime::block_on(dependencies::maintenance::check_mod_maintenance(id.clone()));
        match latest {
            Ok(report) => {
                let json = serde_json::to_value(report).unwrap();
                eprintln!("Maintenance complete: {}. Eligible updates: {}.", json["complete"], json["updates"].as_array().unwrap().len());
                for issue in json["issues"].as_array().unwrap() {
                    if issue["fileName"].as_str().is_some_and(|name| name.starts_with("bbe-")) {
                        eprintln!("BBE: {}", issue["message"]);
                    }
                }
            }
            Err(error) => eprintln!("Live provider check unavailable: {error}"),
        }
        if let Ok(target) = std::env::var("DELIGHT_READ_ONLY_TARGET") {
            let result = tauri::async_runtime::block_on(
                dependencies::maintenance::minecraft_update::preview_minecraft_mod_update(id.clone(), target),
            ).unwrap();
            let preview = serde_json::to_value(result).unwrap();
            eprintln!("Minecraft {} preview: {} changes, {} blockers, ready: {}",
                preview["target"], preview["changes"].as_array().unwrap().len(),
                preview["issues"].as_array().unwrap().len(), !preview["token"].is_null());
        }
        match tauri::async_runtime::block_on(preview_pack_publication(id)) {
            Ok(review) => {
                eprintln!("Sharing preview: {} reviewed files, {} stay on device, {} instance-level issues, publish ready: {}",
                    review.files.len(), review.excluded_local_files.len(), review.issues.len(), review.review_token.is_some());
                for file in review.files.iter().filter(|file| file.state == FileState::Issue).take(8) {
                    eprintln!("{}: {}", file.file_name, file.message);
                }
            }
            Err(error) => eprintln!("Live sharing preview unavailable: {error}"),
        }
    }

    #[test]
    fn nested_shader_archives_use_a_whole_shaders_directory_component() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("delight-shader-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        for (entry, valid) in [
            ("shaders/program.fsh", true),
            ("Shader-main/release/shaders/program.fsh", true),
            ("Shader-main/notshaders/program.fsh", false),
            ("Shader-main/shaders", false),
        ] {
            let path = root.join("example.zip");
            let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
            zip.start_file(entry, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"example").unwrap();
            zip.finish().unwrap();
            assert_eq!(
                content_transfer::manifest(&path, "shaderpacks").is_ok(),
                valid,
                "{entry}"
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    // A separate process isolates the app data override from concurrently running tests.
    #[cfg(debug_assertions)]
    #[test]
    fn inventory_artwork_and_preflight_preserve_missing_and_linked_folders() {
        const WORKER: &str = "DELIGHT_TEST_READONLY_INVENTORY";
        let Some(sandbox) = std::env::var_os(WORKER) else {
            let sandbox =
                std::env::temp_dir().join(format!("delight-inventory-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&sandbox).unwrap();
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "pack_compatibility::tests::inventory_artwork_and_preflight_preserve_missing_and_linked_folders", "--nocapture"])
                .env(WORKER,&sandbox)
                .env("BLOOM_DEV_DATA_DIR", sandbox.join("profile"))
                .output().unwrap();
            fs::remove_dir_all(sandbox).unwrap();
            assert!(
                output.status.success(),
                "{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        };
        let sandbox = std::path::PathBuf::from(sandbox);
        let game = sandbox.join("game");
        let mut config: InstanceConfig = serde_json::from_value(json!({"id":"test","name":"Test","version":"1.21.1",
            "directory":game,"loader":"Vanilla","java":"Automatic","memory":4096,"jvmArguments":"",
            "mods":true,"resourcePacks":true,"shaderPacks":true,"config":true,"customResolution":false,"visible":true,"shortcut":false})).unwrap();
        crate::write_instance(&config).unwrap();
        let list = |category: &str, for_sharing| {
            tauri::async_runtime::block_on(crate::list_instance_content(
                "test".into(),
                category.into(),
                for_sharing,
            ))
        };
        let art = |for_sharing| {
            tauri::async_runtime::block_on(crate::pack_artwork::get_pack_artwork(
                "test".into(),
                "resourcepacks".into(),
                for_sharing,
            ))
        };
        let check = || tauri::async_runtime::block_on(check_pack_compatibility("test".into(), None));

        for flag in [None, Some(true)] {
            assert!(list("mods", flag).is_err());
            assert!(art(flag).is_err());
        }
        assert!(check().is_err());
        assert!(!game.exists());

        fs::create_dir(&game).unwrap();
        for flag in [None, Some(true)] {
            assert!(list("mods", flag).unwrap().is_empty());
            assert!(art(flag).unwrap().is_empty());
        }
        assert!(check().unwrap().files.is_empty());
        assert_eq!(fs::read_dir(&game).unwrap().count(), 0);

        fs::create_dir(game.join("shaderpacks")).unwrap();
        fs::write(
            game.join("shaderpacks/MyShader.zip.txt"),
            "personal Iris settings",
        )
        .unwrap();
        fs::write(game.join("shaderpacks/notes.txt"), "unrecognized file").unwrap();
        assert_eq!(
            list("shaderpacks", Some(true))
                .unwrap()
                .iter()
                .map(|f| &f.file_name)
                .collect::<Vec<_>>(),
            ["notes.txt"]
        );
        assert_eq!(
            check()
                .unwrap()
                .files
                .iter()
                .map(|f| &f.file_name)
                .collect::<Vec<_>>(),
            ["notes.txt"]
        );

        let external = sandbox.join("other");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("outside.txt"), "outside the instance").unwrap();
        fn link_dir(source: &Path, destination: &Path) {
            #[cfg(windows)]
            junction::create(source, destination).unwrap();
            #[cfg(not(windows))]
            std::os::unix::fs::symlink(source, destination).unwrap();
        }
        link_dir(&external, &game.join("resourcepacks"));
        assert_eq!(
            list("resourcepacks", None).unwrap()[0].file_name,
            "outside.txt"
        );
        assert!(list("resourcepacks", Some(true)).unwrap().is_empty());
        assert!(art(Some(true)).unwrap().is_empty());
        let report = check().unwrap();
        assert!(!report.files.iter().any(|f| f.file_name == "outside.txt"));
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.contains("resourcepacks")));

        // Windows directory junctions are available without symlink privileges. Exercise a file
        // link as well wherever the operating system grants that privilege.
        let linked_file = game.join("shaderpacks/linked.zip");
        #[cfg(windows)]
        let file_link =
            std::os::windows::fs::symlink_file(external.join("outside.txt"), &linked_file);
        #[cfg(not(windows))]
        let file_link = std::os::unix::fs::symlink(external.join("outside.txt"), &linked_file);
        if file_link.is_ok() {
            assert!(!list("shaderpacks", Some(true))
                .unwrap()
                .iter()
                .any(|f| f.file_name == "linked.zip"));
            assert!(check()
                .unwrap()
                .issues
                .iter()
                .any(|msg| msg.contains("linked.zip")));
        }

        let linked_root = sandbox.join("linked-game");
        link_dir(&game, &linked_root);
        config.directory = linked_root.to_string_lossy().into_owned();
        crate::write_instance(&config).unwrap();
        assert!(list("mods", Some(true)).is_err());
        assert!(art(Some(true)).is_err());
        assert!(check().is_err());
        assert!(!game.join("mods").exists());
    }

    fn item(name: &str, hash: &str) -> CheckedFile {
        CheckedFile {
            category: "mods",
            file_name: name.into(),
            size: 42,
            enabled: true,
            state: FileState::Issue,
            message: String::new(),
            can_keep_local: false,
            project_id: None,
            version_id: None,
            fingerprint: Some(hash.into()),
            mod_id: Some(name.into()),
            mod_name: None,
            duplicate_group: None,
        }
    }

    fn report(files: Vec<CheckedFile>) -> CompatibilityReport {
        CompatibilityReport {
            name: "Sample".into(),
            review_token: None,
            instance_id: "test".into(),
            minecraft_version: "1.21.1".into(),
            loader: "Fabric".into(),
            loader_version: Some("0.16.10".into()),
            files,
            issues: vec![],
            excluded_folders: vec![],
            excluded_local_files: vec![],
            missing_dependencies: vec![],
            fabric_runtime_verified: false,
            directory: PathBuf::new(),
        }
    }

    #[test]
    fn groups_real_enabled_fabric_ids_and_resolves_only_the_reviewed_files() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("delight-mod-conflict-{}", uuid::Uuid::new_v4()));
        let mods = root.join("mods");
        fs::create_dir_all(&mods).unwrap();
        let config: InstanceConfig = serde_json::from_value(json!({
            "id":"test","name":"Test","version":"1.21.1","directory":root,
            "loader":"Fabric","loaderVersion":"0.16.10","java":"Automatic","memory":4096,
            "jvmArguments":"","mods":true,"resourcePacks":true,"shaderPacks":true,"config":true,
            "customResolution":false,"visible":true,"shortcut":false
        })).unwrap();
        let jar = |name: &str, id: &str, environment: &str| {
            let path = mods.join(name);
            let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
            zip.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
            write!(zip, "{}", json!({"id":id,"name":"Same display name","version":"1.0","environment":environment})).unwrap();
            zip.finish().unwrap();
            DuplicateCandidate { file_name: name.into(), fingerprint: content_transfer::hash(&path).unwrap() }
        };
        let first = jar("first.jar", "same_id", "*");
        let second = jar("second.jar", "same_id", "client");
        jar("disabled.jar.disabled", "same_id", "*");
        jar("upper.JAR", "same_id", "*");
        jar(".hidden.jar", "same_id", "*");
        jar("server.jar", "same_id", "server");
        jar("other.jar", "different_id", "*");
        let mut checked = scan(&config).unwrap();
        for file in &mut checked.files { file.can_keep_local = true; }
        mark_duplicate_groups(&mut checked.files);
        let group: Vec<_> = checked.files.iter().filter(|file| file.duplicate_group.is_some()).collect();
        assert_eq!(group.iter().map(|file| file.file_name.as_str()).collect::<Vec<_>>(), ["first.jar", "second.jar"]);
        assert!(group.iter().all(|file| !file.can_keep_local && file.state == FileState::Issue));

        let candidates = [first, second];
        let collision = mods.join("second.jar.disabled");
        fs::write(&collision, "old disabled file").unwrap();
        assert!(resolve_duplicate_versions(&config, "same_id", "first.jar", &candidates).is_err());
        assert_eq!(fs::read_to_string(&collision).unwrap(), "old disabled file");
        assert!(mods.join("second.jar").is_file());
        fs::remove_file(&collision).unwrap();
        let unexpected = jar("third.jar", "same_id", "*");
        assert!(resolve_duplicate_versions(&config, "same_id", "first.jar", &candidates).is_err());
        assert!(mods.join("third.jar").is_file());
        fs::remove_file(mods.join(unexpected.file_name)).unwrap();
        resolve_duplicate_versions(&config, "same_id", "first.jar", &candidates).unwrap();
        assert_eq!(content_transfer::hash(&mods.join("first.jar")).unwrap(), candidates[0].fingerprint);
        assert_eq!(content_transfer::hash(&collision).unwrap(), candidates[1].fingerprint);
        assert!(!mods.join("second.jar").exists());
        assert!(mods.join("disabled.jar.disabled").is_file());
        let mut checked = scan(&config).unwrap();
        mark_duplicate_groups(&mut checked.files);
        assert!(!checked.files.iter().any(|file| file.duplicate_group.is_some()));
        fs::remove_dir_all(root).unwrap();
    }

    fn release(
        project: &str,
        id: &str,
        hash: &str,
        dependencies: serde_json::Value,
    ) -> ModrinthVersion {
        serde_json::from_value(json!({"project_id":project,"id":id,"version_number":"1.0","version_type":"release",
            "game_versions":["1.21.1"],"loaders":["fabric"],"dependencies":dependencies,
            "files":[{"url":"https://cdn.modrinth.com/data/example.jar","filename":"example.jar","size":42,"primary":true,"hashes":{"sha512":hash}}]})).unwrap()
    }

    #[test]
    fn an_unlisted_resource_pack_can_stay_on_the_source_device() {
        let mut optional = item("custom-palette.zip", "a");
        optional.category = "resourcepacks";
        let mut review = report(vec![optional]);
        let exclusion = ExcludedLocalFile { file_name: "custom-palette.zip".into(), fingerprint: "a".into() };
        assess(&mut review, &HashMap::new(), &[exclusion]);
        assert_eq!(review.files[0].state, FileState::LocalOnly);
        assert_eq!(review.manifest().unwrap()["files"], json!([]));
    }

    #[test]
    fn omitting_an_optional_file_does_not_hide_a_missing_runtime_dependency() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("delight-omit-{}", uuid::Uuid::new_v4()));
        let mods = root.join("mods");
        fs::create_dir_all(&mods).unwrap();
        let write = |name: &str, metadata: serde_json::Value| {
            let mut archive = zip::ZipWriter::new(fs::File::create(mods.join(name)).unwrap());
            archive.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
            archive.write_all(metadata.to_string().as_bytes()).unwrap();
            archive.finish().unwrap();
        };
        write("consumer.jar", json!({"id":"consumer","version":"1.0.0","depends":{"local_api":"*"}}));
        write("custom.jar", json!({"id":"local_api","version":"1.0.0"}));
        write("provided.jar", json!({"id":"another","version":"1.0.0","provides":["local_api"]}));
        let mut checked = report(vec![item("consumer.jar", "aa"), item("custom.jar", "bb")]);
        checked.directory = root.clone();
        checked.files[0].state = FileState::Verified;
        checked.files[1].state = FileState::LocalOnly;
        let mut redundant = checked.clone();
        let mut provider = item("provided.jar", "cc");
        provider.state = FileState::Verified;
        redundant.files.push(provider);
        check_local_omissions(&mut checked);
        assert!(checked.files[0].message.contains("Needs local_api"));
        assert!(checked.manifest().is_none());
        check_local_omissions(&mut redundant);
        assert!(redundant.manifest().is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn verifies_the_exact_download_and_target_and_requires_trusted_transport() {
        let hash = "a".repeat(128);
        let f = item("mod.jar", &hash);
        let mut r = release("A", "one", &hash, json!([]));
        assert!(source_issue(&f, &hash, &r, "1.21.1").is_none());
        assert!(source_issue(&f, "different", &r, "1.21.1").is_some());
        assert!(source_issue(&f, &hash, &r, "1.20").is_some());
        r.files[0].size += 1;
        assert!(source_issue(&f, &hash, &r, "1.21.1").is_some());
        r.files[0].size = 42;
        for url in ["http://cdn.modrinth.com/x.jar", "https://example.org/x.jar"] {
            r.files[0].url = url.into();
            assert!(source_issue(&f, &hash, &r, "1.21.1").is_some());
        }
        r.files[0].url = "https://cdn.modrinth.com/x.jar".into();
        r.loaders = vec!["neoforge".into()];
        assert!(source_issue(&f, &hash, &r, "1.21.1").is_some());
    }

    #[test]
    fn publication_is_bound_to_reviewed_pins_state_and_omissions() {
        let hash = "a".repeat(128);
        let mut initial = report(vec![item("client.jar", &hash)]);
        let versions = HashMap::from([(hash.clone(), release("provider", "v1", &hash, json!([])))]);
        assess(&mut initial, &versions, &[]);
        initial.excluded_folders.push("config".into());
        let token = initial.snapshot_token().unwrap();
        initial.review_token = Some(token.clone());
        assert!(initial.reviewed_manifest(&token, &[]).is_none());
        let manifest = initial
            .reviewed_manifest(&token, &["config".into()])
            .unwrap();
        assert_eq!(manifest["files"][0]["sha512"], hash);
        assert_eq!(manifest["files"][0]["versionId"], "v1");
        assert_eq!(manifest["files"][0]["enabled"], true);
        initial.files[0].enabled = false;
        assert_ne!(initial.snapshot_token().as_deref(), Some(token.as_str()));
        initial.files[0].enabled = true;
        initial.files[0].fingerprint = Some("b".repeat(128));
        assert_ne!(initial.snapshot_token().as_deref(), Some(token.as_str()));
        initial.files[0].fingerprint = Some(hash);
        initial.name.push('x');
        assert_ne!(initial.snapshot_token().as_deref(), Some(token.as_str()));
        initial.files[0].state = FileState::Issue;
        assert!(initial.snapshot_token().is_none());
    }

    #[test]
    fn keeps_only_the_exact_selected_mod_local_and_never_serializes_it_to_the_manifest() {
        let public_hash = "a".repeat(128);
        let private_hash = "b".repeat(128);
        let versions = HashMap::from([(
            public_hash.clone(),
            release("provider", "v1", &public_hash, json!([])),
        )]);
        let choice = ExcludedLocalFile {
            file_name: "private.jar".into(),
            fingerprint: private_hash.clone(),
        };
        let files = || vec![item("catalog.jar", &public_hash), item("private.jar", &private_hash)];
        let mut selected = report(files());
        assess(&mut selected, &versions, std::slice::from_ref(&choice));
        assert_eq!(selected.files[1].state, FileState::LocalOnly);
        assert_eq!(selected.excluded_local_files, [choice.clone()]);
        let manifest = selected.manifest().unwrap();
        assert_eq!(manifest["files"].as_array().unwrap().len(), 1);
        assert!(!manifest.to_string().contains("private.jar"));
        assert!(!manifest.to_string().contains(&private_hash));
        let token = selected.snapshot_token().unwrap();

        let mut changed = report(vec![
            item("catalog.jar", &public_hash),
            item("private.jar", &"c".repeat(128)),
        ]);
        assess(&mut changed, &versions, std::slice::from_ref(&choice));
        assert!(changed.snapshot_token().is_none());
        assert!(changed.excluded_local_files.is_empty());

        let mut recognized = report(files());
        let mut versions = versions;
        versions.insert(
            private_hash.clone(),
            release("catalog", "v2", &private_hash, json!([])),
        );
        assess(&mut recognized, &versions, &[choice]);
        assert_eq!(recognized.files[1].state, FileState::Verified);
        assert!(recognized.excluded_local_files.is_empty());
        assert_ne!(recognized.snapshot_token().unwrap(), token);
    }

    #[test]
    fn publication_keeps_the_verified_bundled_fingerprint_without_a_provider() {
        let hash = "c".repeat(128);
        let mut file = item("bloom-cosmetics-26.3.jar.disabled", &hash);
        file.state = FileState::Managed;
        file.enabled = false;
        let mut report = report(vec![file]);
        assess(&mut report, &HashMap::new(), &[]);
        let manifest = report.manifest().unwrap();
        assert_eq!(manifest["files"][0]["source"], "delight");
        assert_eq!(manifest["files"][0]["enabled"], false);
        assert_eq!(manifest["files"][0]["sha512"], hash);
        assert!(manifest["files"][0]["projectId"].is_null());
    }

    #[test]
    fn required_dependency_matches_enabled_project_and_version_on_the_same_file() {
        let mut versions = HashMap::from([
            (
                "a".into(),
                release(
                    "A",
                    "a",
                    "a",
                    json!([{"project_id":"B","version_id":"right","dependency_type":"required"}]),
                ),
            ),
            ("b".into(), release("B", "wrong", "b", json!([]))),
            ("c".into(), release("C", "right", "c", json!([]))),
        ]);
        let check = |versions: &HashMap<_, _>, enabled| {
            let mut b = item("base", "b");
            b.enabled = enabled;
            let mut r = report(vec![
                item("mod", "a"),
                b,
                item("other", "c"),
                item("local", "unknown"),
            ]);
            assess(&mut r, versions, &[]);
            assert_eq!(r.files[3].state, FileState::Issue);
            r.files[0].state
        };
        assert_eq!(check(&versions, true), FileState::Issue);
        versions.get_mut("b").unwrap().id = "right".into();
        assert_eq!(check(&versions, false), FileState::Issue);
        assert_eq!(check(&versions, true), FileState::Verified);
    }

    #[test]
    fn duplicate_providers_do_not_generate_missing_dependency_warnings_for_their_dependents() {
        let mut first = item("first.jar", "first");
        first.mod_id = Some("fabric_api".into());
        let mut second = item("second.jar", "second");
        second.mod_id = first.mod_id.clone();
        let mut report = report(vec![first, second, item("consumer.jar", "consumer")]);
        let versions = HashMap::from([
            ("first".into(), release("api", "first", "first", json!([]))),
            ("second".into(), release("api", "second", "second", json!([]))),
            ("consumer".into(), release("consumer", "consumer", "consumer",
                json!([{"project_id":"api","version_id":"second","dependency_type":"required"}]))),
        ]);
        assess(&mut report, &versions, &[]);
        assert!(report.missing_dependencies.is_empty());
        assert_eq!(report.files[2].state, FileState::Verified);
        assert!(report.files[..2].iter().all(|file| file.duplicate_group.is_some()));
        assert!(report.snapshot_token().is_none());
    }

    #[test]
    fn checks_pack_kinds_and_shader_loader() {
        let mut shader = item("shader.zip", "s");
        shader.category = "shaderpacks";
        shader.mod_id = None;
        let mut versions = HashMap::from([
            ("s".into(), release("shader", "one", "s", json!([]))),
            ("i".into(), release("iris", "two", "i", json!([]))),
        ]);
        assert!(source_issue(&shader, "s", &versions["s"], "1.21.1").is_some());
        versions.get_mut("s").unwrap().loaders = vec!["iris".into()];
        let mut r = report(vec![shader]);
        assess(&mut r, &versions, &[]);
        assert_eq!(r.files[0].state, FileState::Issue);
        r.files.push(item("iris", "i"));
        assess(&mut r, &versions, &[]);
        assert_eq!(r.files[0].state, FileState::Verified);
        r.files[0].category = "resourcepacks";
        assert!(source_issue(&r.files[0], "s", &versions["s"], "1.21.1").is_some());
        versions.get_mut("s").unwrap().loaders = vec!["minecraft".into()];
        assert!(source_issue(&r.files[0], "s", &versions["s"], "1.21.1").is_none());
    }

    #[test]
    fn scans_locally_preserves_disabled_files_and_reports_unsupported_content() {
        use std::io::Write;
        let root = std::env::temp_dir().join(format!("delight-preflight-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("mods")).unwrap();
        fs::create_dir_all(root.join("scripts")).unwrap();
        fs::write(root.join("scripts/pack.zs"), "example").unwrap();
        fs::create_dir_all(root.join("saves/Private world")).unwrap();
        fs::create_dir_all(root.join("resourcepacks/unpacked")).unwrap();
        let config: InstanceConfig = serde_json::from_value(json!({"id":"test","name":"Test","version":"1.21.1",
            "directory":root,"loader":"Fabric","loaderVersion":"0.16.10","java":"Automatic","memory":4096,"jvmArguments":"",
            "mods":true,"resourcePacks":true,"shaderPacks":true,"config":true,"customResolution":false,"visible":true,"shortcut":false})).unwrap();
        let source = root.join("mods/test.jar.disabled");
        let mut zip = zip::ZipWriter::new(fs::File::create(&source).unwrap());
        zip.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(br#"{"id":"test","name":"Test","version":"1.0"}"#)
            .unwrap();
        zip.finish().unwrap();
        fs::write(root.join("mods/.bloom-cosmetics.json"), "internal").unwrap();
        fs::write(root.join("mods/bloom-cosmetics-26.3.jar"), "different").unwrap();
        let scan = scan(&config).unwrap();
        assert_eq!(scan.files.len(), 2);
        let f = scan
            .files
            .iter()
            .find(|f| f.file_name == "test.jar.disabled")
            .unwrap();
        assert!(!f.enabled);
        assert_eq!(
            f.fingerprint.as_deref(),
            Some(content_transfer::hash(&source).unwrap().as_str())
        );
        assert_eq!(scan.files[0].state, FileState::Issue);
        assert_eq!(scan.excluded_folders, ["scripts"]);
        assert_eq!(scan.issues.len(), 1);
        assert!(scan.issues[0].contains("unpacked"));
        assert!(!root.join("shaderpacks").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
