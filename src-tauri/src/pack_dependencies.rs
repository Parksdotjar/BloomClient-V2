use super::{
    dependency_matches, fabric_discovers_file, fabric_primary_id, move_without_replacing,
    read_assessment, scan, scan_mods, CheckedFile, CompatibilityReport, ExcludedLocalFile,
};
use crate::{
    content_transfer, instance_actions, workspace_install, workspace_player::PlayerFile,
    InstanceConfig, LauncherState, ModrinthProject, ModrinthVersion,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    fs::{self, File},
    io::ErrorKind,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

const MAX_DEPENDENCIES: usize = 128;
const STALE: &str = "The instance or dependency plan changed. Review dependencies again.";
const UNLISTED: &str = "Modrinth no longer lists that required project or version.";

#[path = "mod_maintenance.rs"]
pub(crate) mod maintenance;

#[path = "catalog_mod_maintenance.rs"]
pub(crate) mod catalog;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Action {
    name: String,
    version: String,
    file_name: String,
    kind: &'static str,
    required_by: BTreeSet<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DependencyReview {
    review_token: Option<String>,
    actions: Vec<Action>,
    issues: Vec<String>,
}

#[derive(Clone)]
struct Selected {
    action: Action,
    file: PlayerFile,
    version: Arc<ModrinthVersion>,
    enable_from: Option<String>,
}

type Selection = BTreeMap<String, Selected>;

struct Plan {
    review: DependencyReview,
    selection: Selection,
    inventory: String,
}

struct Request {
    project: Option<String>,
    version: Option<String>,
    required_by: Vec<String>,
}

fn protected_mod(pins: &[PlayerFile], file_name: &str, project: Option<&str>) -> bool {
    let name = file_name.to_ascii_lowercase();
    let name = name.strip_suffix(".disabled").unwrap_or(&name);
    pins.iter().any(|pin| {
        let pinned = pin.file_name.to_ascii_lowercase();
        name == pinned.strip_suffix(".disabled").unwrap_or(&pinned)
            || (project.is_some() && pin.project_id.as_deref() == project)
    })
}

#[derive(Default)]
struct Catalog {
    versions: HashMap<String, Arc<ModrinthVersion>>,
    choices: HashMap<String, Option<Arc<ModrinthVersion>>>,
    titles: HashMap<String, String>,
    incomplete: bool,
}

fn source_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

async fn read_catalog<T: serde::de::DeserializeOwned>(
    path: &str,
    query: &[(&str, String)],
) -> Result<T, String> {
    crate::bloom_http_client()?
        .get(format!("https://api.modrinth.com/v2/{path}"))
        .query(query)
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| {
            if error.status() == Some(reqwest::StatusCode::NOT_FOUND) {
                UNLISTED
            } else {
                "Modrinth could not confirm that dependency. Check your connection and retry."
            }
        })?
        .json()
        .await
        .map_err(|_| "Modrinth returned invalid dependency information.".into())
}

fn fabric_release(version: &ModrinthVersion, game: &str) -> bool {
    version.game_versions.iter().any(|value| value == game)
        && version
            .loaders
            .iter()
            .any(|value| value.eq_ignore_ascii_case("fabric"))
}

fn download_file(version: &ModrinthVersion, game: &str) -> Option<PlayerFile> {
    if !fabric_release(version, game) {
        return None;
    }
    let valid = |file: &crate::ModrinthFile| {
        if !file.filename.ends_with(".jar") || crate::cosmetics::is_managed_file(&file.filename) {
            return None;
        }
        let candidate = PlayerFile {
            category: "mods".into(),
            file_name: file.filename.clone(),
            enabled: true,
            size: file.size,
            source: "modrinth".into(),
            sha512: file.hashes.get("sha512")?.clone(),
            project_id: version.project_id.clone(),
            version_id: Some(version.id.clone()),
            download_url: Some(file.url.clone()),
        };
        candidate.validate(game).ok()?;
        Some(candidate)
    };
    version
        .files
        .iter()
        .filter(|file| file.primary)
        .find_map(valid)
        .or_else(|| version.files.iter().find_map(valid))
}

impl Catalog {
    async fn version(&mut self, id: &str) -> Result<Arc<ModrinthVersion>, String> {
        if let Some(version) = self.versions.get(id) {
            return Ok(version.clone());
        }
        if !source_id(id) {
            return Err("A dependency has an invalid Modrinth version.".into());
        }
        let version: ModrinthVersion = read_catalog(&format!("version/{id}"), &[])
            .await.inspect_err(|issue| self.incomplete |= issue != UNLISTED)?;
        if version.id != id || !version.project_id.as_deref().is_some_and(source_id) {
            return Err("Modrinth returned a different dependency version.".into());
        }
        let version = Arc::new(version);
        self.versions.insert(id.into(), version.clone());
        Ok(version)
    }

    async fn title(&mut self, project: &str) -> String {
        if let Some(title) = self.titles.get(project) {
            return title.clone();
        }
        let title = read_catalog::<ModrinthProject>(&format!("project/{project}"), &[])
            .await
            .ok()
            .filter(|result| result.id == project && !result.title.is_empty())
            .map(|result| result.title)
            .unwrap_or_else(|| project.to_owned());
        self.titles.insert(project.into(), title.clone());
        title
    }

    async fn compatible(
        &mut self,
        project: &str,
        game: &str,
    ) -> Result<Option<Arc<ModrinthVersion>>, String> {
        if let Some(choice) = self.choices.get(project) {
            return Ok(choice.clone());
        }
        let mut versions: Vec<ModrinthVersion> = read_catalog(
            &format!("project/{project}/version"),
            &[
                ("loaders", "[\"fabric\"]".into()),
                ("game_versions", serde_json::json!([game]).to_string()),
                ("include_changelog", "false".into()),
            ],
        )
        .await.inspect_err(|issue| self.incomplete |= issue != UNLISTED)?;
        versions.retain(|version| {
            version.project_id.as_deref() == Some(project) && download_file(version, game).is_some()
        });
        versions.sort_by(|a, b| {
            (b.version_type == "release", &b.date_published, &b.id).cmp(&(
                a.version_type == "release",
                &a.date_published,
                &a.id,
            ))
        });
        let choice = versions.into_iter().next().map(Arc::new);
        self.choices.insert(project.into(), choice.clone());
        Ok(choice)
    }
}

fn matched_version<'a>(
    file: &CheckedFile,
    versions: &'a HashMap<String, ModrinthVersion>,
) -> Option<&'a ModrinthVersion> {
    versions.get(file.fingerprint.as_deref()?)
}

fn installed_satisfies(file: &CheckedFile, project: &str, exact: Option<&str>) -> bool {
    file.enabled
        && file.project_id.as_deref() == Some(project)
        && exact.is_none_or(|version| file.version_id.as_deref() == Some(version))
}

fn disabled_copy<'a>(
    report: &'a CompatibilityReport,
    project: &str,
    exact: Option<&str>,
) -> Option<&'a CheckedFile> {
    report.files.iter().find(|file| {
        !file.enabled
            && file.category == "mods"
            && file.project_id.as_deref() == Some(project)
            && exact.is_none_or(|version| file.version_id.as_deref() == Some(version))
            && file
                .file_name
                .strip_suffix(".disabled")
                .is_some_and(|name| name.ends_with(".jar"))
    })
}

fn incompatible(a: &ModrinthVersion, b: &ModrinthVersion) -> bool {
    a.dependencies.iter().any(|dep| {
        dep.dependency_type == "incompatible"
            && dependency_matches(dep, b.project_id.as_deref(), Some(&b.id))
    })
}

async fn resolve_root(
    report: &CompatibilityReport,
    versions: &HashMap<String, ModrinthVersion>,
    catalog: &mut Catalog,
    selection: &mut Selection,
    root: Request,
    exact_pins: &BTreeMap<String, BTreeSet<String>>,
    protected: &[PlayerFile],
    allow_enable: bool,
) -> Result<(), String> {
    let game = &report.minecraft_version;
    let mut pending = VecDeque::from([root]);
    let mut requests = 0;
    while let Some(request) = pending.pop_front() {
        requests += 1;
        if requests > MAX_DEPENDENCIES || selection.len() >= MAX_DEPENDENCIES {
            return Err("This dependency chain is too large to install automatically.".into());
        }
        let pinned = match request.version.as_deref() {
            Some(id) => Some(catalog.version(id).await?),
            None => None,
        };
        let project = request
            .project
            .as_deref()
            .or_else(|| pinned.as_ref()?.project_id.as_deref())
            .filter(|id| source_id(id))
            .ok_or("Modrinth did not identify this required dependency.")?;
        if pinned
            .as_ref()
            .is_some_and(|version| version.project_id.as_deref() != Some(project))
        {
            return Err("A dependency’s project and exact version disagree on Modrinth.".into());
        }
        if report
            .files
            .iter()
            .any(|file| installed_satisfies(file, project, request.version.as_deref()))
        {
            continue;
        }
        let title = catalog.title(project).await;
        let required_version = exact_pins
            .get(project)
            .map(|pins| {
                if pins.len() == 1 {
                    Ok(pins.first().unwrap().as_str())
                } else {
                    Err(format!("{title} is required at different exact versions."))
                }
            })
            .transpose()?;
        let exact = request.version.as_deref().or(required_version);
        if request
            .version
            .as_deref()
            .zip(required_version)
            .is_some_and(|(a, b)| a != b)
        {
            return Err(format!("{title} is required at different exact versions."));
        }
        if let Some(existing) = selection.get_mut(project) {
            if exact.is_some_and(|version| version != existing.version.id) {
                return Err(format!("{title} is required at different exact versions."));
            }
            existing.action.required_by.extend(request.required_by);
            continue;
        }
        if let Some(file) = report.files.iter().find(|file| {
            file.enabled
                && matched_version(file, versions)
                    .is_some_and(|version| version.project_id.as_deref() == Some(project))
        }) {
            return Err(format!(
                "{title} requires a different compatible file. Review the installed {} before changing versions.",
                file.file_name
            ));
        }
        if !allow_enable && disabled_copy(report, project, None).is_some() {
            return Err(format!("{title} is disabled. It was left disabled."));
        }
        let disabled = disabled_copy(report, project, exact);
        let version = if let Some(version) = &pinned {
            version.clone()
        } else if let Some(id) =
            exact.or_else(|| disabled.and_then(|file| file.version_id.as_deref()))
        {
            catalog.version(id).await?
        } else {
            catalog.compatible(project, game).await?.ok_or_else(|| {
                format!("{title} has no verified Fabric download for Minecraft {game}.")
            })?
        };
        let mut file = download_file(&version, game).ok_or_else(|| {
            format!("{title} has no verified Fabric download for Minecraft {game}.")
        })?;
        let enable_from = if let Some(disabled) = disabled {
            let hash = disabled.fingerprint.as_deref().ok_or(STALE)?;
            let source = version
                .files
                .iter()
                .find(|file| {
                    file.hashes.get("sha512").is_some_and(|value| value == hash)
                        && file.size == disabled.size
                        && crate::workspace_player::trusted_file_url(&file.url)
                })
                .ok_or(STALE)?;
            file.file_name = disabled
                .file_name
                .strip_suffix(".disabled")
                .ok_or(STALE)?
                .to_owned();
            file.download_url = Some(source.url.clone());
            file.sha512 = hash.to_owned();
            file.size = disabled.size;
            file.validate(game)?;
            Some(disabled.file_name.clone())
        } else {
            None
        };
        if protected_mod(protected, &file.file_name, Some(project)) {
            return Err(format!("{title} is managed by the shared pack. Review its release in Pack Workspace."));
        }
        if report.files.iter().any(|entry| {
            entry.category == "mods" && entry.file_name.eq_ignore_ascii_case(&file.file_name)
        }) || selection
            .values()
            .any(|entry| entry.file.file_name.eq_ignore_ascii_case(&file.file_name))
        {
            return Err(format!(
                "A mod already uses the filename {}.",
                file.file_name
            ));
        }
        for installed in report
            .files
            .iter()
            .filter(|file| file.enabled)
            .filter_map(|file| matched_version(file, versions))
            .chain(selection.values().map(|picked| picked.version.as_ref()))
        {
            if incompatible(installed, &version) || incompatible(&version, installed) {
                return Err(format!("{title} conflicts with an enabled or planned mod."));
            }
        }
        for dependency in version
            .dependencies
            .iter()
            .filter(|dep| dep.dependency_type == "required")
        {
            pending.push_back(Request {
                project: dependency.project_id.clone(),
                version: dependency.version_id.clone(),
                required_by: vec![title.clone()],
            });
        }
        selection.insert(
            project.to_owned(),
            Selected {
                action: Action {
                    name: title,
                    version: version.version_number.clone(),
                    file_name: file.file_name.clone(),
                    kind: if enable_from.is_some() {
                        "enable"
                    } else {
                        "install"
                    },
                    required_by: request.required_by.into_iter().collect(),
                },
                file,
                version,
                enable_from,
            },
        );
    }
    Ok(())
}

fn inventory_token(report: &CompatibilityReport) -> String {
    let files: Vec<_> = report
        .files
        .iter()
        .map(|file| {
            (
                file.category,
                &file.file_name,
                file.size,
                file.enabled,
                &file.fingerprint,
                &file.mod_id,
            )
        })
        .collect();
    let snapshot = serde_json::json!([
        report.instance_id,
        report.name,
        report.minecraft_version,
        report.loader,
        report.loader_version,
        report.directory,
        report.excluded_folders,
        files
    ]);
    format!("{:x}", Sha256::digest(snapshot.to_string().as_bytes()))
}

async fn build_plan(
    instance_id: String,
    excluded_local_files: Option<Vec<ExcludedLocalFile>>,
) -> Result<Plan, String> {
    let (report, versions) = read_assessment(instance_id, excluded_local_files).await?;
    Ok(plan_dependencies(&report, &versions, &mut Catalog::default()).await)
}

async fn plan_dependencies(
    report: &CompatibilityReport,
    versions: &HashMap<String, ModrinthVersion>,
    catalog: &mut Catalog,
) -> Plan {
    plan_dependencies_with_pins(report, versions, catalog, &[], true).await
}

async fn plan_dependencies_with_pins(
    report: &CompatibilityReport,
    versions: &HashMap<String, ModrinthVersion>,
    catalog: &mut Catalog,
    protected: &[PlayerFile],
    allow_enable: bool,
) -> Plan {
    let inventory = inventory_token(report);
    let mut selection = Selection::new();
    let mut issues = BTreeSet::new();
    if !report.loader.eq_ignore_ascii_case("fabric")
        || report.loader_version.is_none()
        || !report.issues.is_empty()
    {
        return Plan {
            review: DependencyReview {
                review_token: None,
                actions: Vec::new(),
                issues: if report.issues.is_empty() {
                    vec!["Choose a supported Fabric runtime before installing dependencies.".into()]
                } else {
                    report.issues.clone()
                },
            },
            selection,
            inventory,
        };
    }
    let mut requests = Vec::new();
    let mut exact_pins = BTreeMap::<String, BTreeSet<String>>::new();
    for requirement in &report.missing_dependencies {
        let mut request = Request {
            project: requirement.project_id.clone(),
            version: requirement.version_id.clone(),
            required_by: requirement.required_by.clone(),
        };
        if let Some(pin) = &request.version {
            match catalog.version(pin).await {
                Ok(version) => {
                    if request.project.is_none() {
                        request.project = version.project_id.clone();
                    }
                    if let Some(project) = request
                        .project
                        .as_ref()
                        .filter(|project| version.project_id.as_ref() == Some(*project))
                    {
                        exact_pins
                            .entry(project.clone())
                            .or_default()
                            .insert(pin.clone());
                    }
                }
                Err(issue) => {
                    issues.insert(issue);
                    continue;
                }
            }
        }
        requests.push(request);
    }
    requests.sort_by_key(|request| request.version.is_none());
    for request in requests {
        // A failed root cannot leak a partial transitive chain into another
        // independent root's plan. Shared successful providers are reused.
        let mut tentative = selection.clone();
        match resolve_root(
            report,
            versions,
            catalog,
            &mut tentative,
            request,
            &exact_pins,
            protected,
            allow_enable,
        )
        .await
        {
            Ok(()) => selection = tentative,
            Err(issue) => {
                issues.insert(issue);
            }
        }
    }
    let actions: Vec<_> = selection
        .values()
        .map(|entry| entry.action.clone())
        .collect();
    let issues: Vec<_> = issues.into_iter().collect();
    let review_token = (!actions.is_empty()).then(|| {
        let pins: Vec<_> = selection
            .values()
            .map(|entry| (&entry.file, &entry.enable_from))
            .collect();
        let snapshot = serde_json::json!([
            inventory,
            report.excluded_local_files,
            actions,
            issues,
            pins
        ]);
        format!("{:x}", Sha256::digest(snapshot.to_string().as_bytes()))
    });
    Plan {
        review: DependencyReview {
            review_token,
            actions,
            issues,
        },
        selection,
        inventory,
    }
}

#[tauri::command]
pub(crate) async fn review_pack_dependencies(
    instance_id: String,
    excluded_local_files: Option<Vec<ExcludedLocalFile>>,
) -> Result<DependencyReview, String> {
    Ok(build_plan(instance_id, excluded_local_files).await?.review)
}

struct Stage(PathBuf);

impl Drop for Stage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn stage_selection(
    config: &InstanceConfig,
    selection: &Selection,
    inventory: &str,
) -> Result<Stage, String> {
    let report = scan(config)?;
    if inventory_token(&report) != inventory {
        return Err(STALE.into());
    }
    stage_mods(config, &report, selection, &BTreeMap::new(), &BTreeMap::new(),
        &AtomicBool::new(false), |_, _| {})
}

fn stage_mods(
    config: &InstanceConfig,
    report: &CompatibilityReport,
    selection: &Selection,
    replacements: &BTreeMap<String, String>,
    local_sources: &BTreeMap<String, PathBuf>,
    cancel: &AtomicBool,
    on_file: impl FnMut(usize, u64),
) -> Result<Stage, String> {
    let stage = prepare_mods(config, report, selection, replacements, local_sources, cancel, on_file)?;
    catalog::check_staged_fabric_requirements(config, report, &stage, selection, replacements)
        .map_err(|issue| issue.message)?;
    Ok(stage)
}

fn prepare_mods(
    config: &InstanceConfig,
    report: &CompatibilityReport,
    selection: &Selection,
    replacements: &BTreeMap<String, String>,
    local_sources: &BTreeMap<String, PathBuf>,
    cancel: &AtomicBool,
    mut on_file: impl FnMut(usize, u64),
) -> Result<Stage, String> {
    let root = crate::readable_instance_root(config, true)?;
    let stage = root.join(format!(".delight-dependencies-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage).map_err(|error| format!("Could not stage dependency files. {error}"))?;
    let stage = Stage(stage);
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("DelightClient/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())?;
    let mut active_ids: BTreeSet<_> = report
        .files
        .iter()
        .filter(|file| file.enabled && !replacements.contains_key(&file.file_name))
        .filter_map(|file| file.mod_id.clone())
        .collect();
    let mut bytes_done = 0u64;
    for (index, picked) in selection.values().enumerate() {
        let file = &picked.file;
        let path = stage.0.join(&file.file_name);
        let mut output = File::create_new(&path).map_err(|e| e.to_string())?;
        if picked.enable_from.is_some() || local_sources.contains_key(&file.file_name) {
            let source = if let Some(disabled) = &picked.enable_from {
                crate::existing_content_folder(config, "mods", true)?.ok_or(STALE)?.join(disabled)
            } else {
                local_sources[&file.file_name].clone()
            };
            let metadata = fs::symlink_metadata(&source).map_err(|_| STALE)?;
            if !metadata.is_file() || instance_actions::linked(&metadata) {
                return Err(STALE.into());
            }
            workspace_install::verified_copy(
                File::open(source).map_err(|_| STALE)?,
                &mut output,
                file,
                cancel,
            )?;
        } else {
            workspace_install::download_verified_modrinth(&client, &mut output, file, cancel)?;
        }
        output.sync_all().map_err(|e| e.to_string())?;
        let metadata = output.metadata().map_err(|e| e.to_string())?;
        drop(output);
        let manifest = content_transfer::manifest(&path, "mods")?
            .ok_or_else(|| format!("{} does not declare a Fabric mod.", file.file_name))?;
        let id = fabric_primary_id(&manifest)
            .filter(|_| manifest["environment"] != "server" && fabric_discovers_file(&file.file_name, &metadata))
            .ok_or_else(|| format!("{} is not a supported Fabric client mod.", file.file_name))?;
        if let Some((before, _)) = replacements.iter().find(|(_, after)| *after == &file.file_name) {
            let original_id = report.files.iter().find(|entry| &entry.file_name == before)
                .and_then(|entry| entry.mod_id.as_deref()).ok_or(STALE)?;
            if original_id != id {
                return Err(format!("{} declares a different Fabric mod ID. The installed file was kept.", file.file_name));
            }
        }
        if !active_ids.insert(id.to_owned()) {
            return Err(format!(
                "{} would enable a second copy of {id}. Resolve that mod in the instance first.",
                picked.action.name
            ));
        }
        if picked.enable_from.is_none() && !local_sources.contains_key(&file.file_name) {
            bytes_done = bytes_done.saturating_add(file.size);
        }
        on_file(index + 1, bytes_done);
    }
    Ok(stage)
}

fn commit_selection(
    config: &InstanceConfig,
    selection: &Selection,
    stage: &Stage,
    inventory: &str,
) -> Result<(), String> {
    if inventory_token(&scan(config)?) != inventory {
        return Err(STALE.into());
    }
    commit_additions(config, selection, stage)
}

fn commit_mod_additions(
    config: &InstanceConfig,
    report: &CompatibilityReport,
    selection: &Selection,
    stage: &Stage,
) -> Result<(), String> {
    if inventory_token(&scan_mods(config)?) != inventory_token(report) {
        return Err(STALE.into());
    }
    commit_additions(config, selection, stage)
}

fn commit_additions(
    config: &InstanceConfig,
    selection: &Selection,
    stage: &Stage,
) -> Result<(), String> {
    let root = crate::readable_instance_root(config, true)?;
    let mods = root.join("mods");
    match fs::symlink_metadata(&mods) {
        Ok(metadata) if metadata.is_dir() && !instance_actions::linked(&metadata) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {
            fs::create_dir(&mods)
                .map_err(|e| format!("Could not create the mods directory. {e}"))?;
        }
        _ => return Err("The mods folder must be a regular local directory.".into()),
    }
    for picked in selection.values() {
        let incoming = stage.0.join(&picked.file.file_name);
        if !fs::symlink_metadata(&incoming)
            .is_ok_and(|metadata| metadata.is_file() && !instance_actions::linked(&metadata))
            || !content_transfer::hash(&incoming).is_ok_and(|hash| hash == picked.file.sha512)
        {
            return Err(STALE.into());
        }
        match fs::symlink_metadata(mods.join(&picked.file.file_name)) {
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            _ => return Err(STALE.into()),
        }
    }
    let mut completed: Vec<&Selected> = Vec::new();
    for picked in selection.values() {
        let file = &picked.file;
        let destination = mods.join(&file.file_name);
        let incoming = stage.0.join(&file.file_name);
        let result = if let Some(source) = &picked.enable_from {
            move_without_replacing(&mods.join(source), &destination, &file.sha512)
        } else {
            fs::hard_link(&incoming, &destination)
        };
        if let Err(error) = result {
            let mut restored = true;
            for previous in completed.into_iter().rev() {
                let destination = mods.join(&previous.file.file_name);
                if let Some(source) = &previous.enable_from {
                    restored &= move_without_replacing(
                        &destination,
                        &mods.join(source),
                        &previous.file.sha512,
                    )
                    .is_ok();
                } else if same_file::is_same_file(
                    &destination,
                    stage.0.join(&previous.file.file_name),
                )
                .unwrap_or(false)
                    && content_transfer::hash(&destination)
                        .is_ok_and(|hash| hash == previous.file.sha512)
                {
                    restored &= fs::remove_file(destination).is_ok();
                } else {
                    restored = false;
                }
            }
            if !restored {
                return Err(format!("Could not install {} or restore all filenames. Review the mods folder before trying again. {error}", file.file_name));
            }
            return Err(format!("Could not install {}. {error}", file.file_name));
        }
        completed.push(picked);
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn apply_pack_dependencies(
    instance_id: String,
    review_token: String,
    excluded_local_files: Option<Vec<ExcludedLocalFile>>,
    state: tauri::State<'_, LauncherState>,
) -> Result<(), String> {
    let plan = build_plan(instance_id.clone(), excluded_local_files).await?;
    if plan.review.review_token.as_deref() != Some(review_token.as_str())
        || plan.selection.is_empty()
    {
        return Err(STALE.into());
    }
    let active = state.launch_active.clone();
    let running = state.game_running.clone();
    let installing = state.content_install_active.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let check_activity = || -> Result<_, String> {
            let activity = active
                .try_lock()
                .map_err(|_| "The launcher is busy. Try again.")?;
            crate::validate_content_install_activity(
                "mods",
                *activity,
                running.load(Ordering::SeqCst),
            )?;
            if installing.load(Ordering::SeqCst) {
                return Err("Wait for the current content installation to finish.".into());
            }
            Ok(activity)
        };
        drop(check_activity()?);
        let config = crate::load_instance(&instance_id)?;
        let stage = stage_selection(&config, &plan.selection, &plan.inventory)?;
        let _activity = check_activity()?;
        let _edit = workspace_install::updates::edit_lease(&instance_id)?;
        let current = crate::load_instance(&instance_id)?;
        if current.directory != config.directory {
            return Err(STALE.into());
        }
        commit_selection(&current, &plan.selection, &stage, &plan.inventory)
    })
    .await
    .map_err(|_| {
        "The dependency installation stopped unexpectedly. Review the mods folder and try again."
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pack_compatibility::{FileState, MissingDependency};

    fn release(project: &str, version: &str, required: &[&str]) -> Arc<ModrinthVersion> {
        let dependencies: Vec<_> = required
            .iter()
            .map(|id| serde_json::json!({"project_id": id, "dependency_type": "required"}))
            .collect();
        Arc::new(
            serde_json::from_value(serde_json::json!({
                "id": version, "project_id": project, "version_number": "1",
                "version_type": "release", "game_versions": ["1.21.1"], "loaders": ["fabric"],
                "dependencies": dependencies, "files": [{
                    "filename": format!("{project}.jar"), "size": 42, "primary": true,
                    "url": format!("https://cdn.modrinth.com/data/{project}.jar"),
                    "hashes": {"sha512": "a".repeat(128)}
                }]
            }))
            .unwrap(),
        )
    }

    fn report() -> CompatibilityReport {
        CompatibilityReport {
            instance_id: "test".into(),
            name: "Test".into(),
            review_token: None,
            minecraft_version: "1.21.1".into(),
            loader: "Fabric".into(),
            loader_version: Some("0.16.10".into()),
            files: Vec::new(),
            issues: Vec::new(),
            excluded_folders: Vec::new(),
            excluded_local_files: Vec::new(),
            missing_dependencies: Vec::new(),
                fabric_runtime_verified: false,
            directory: PathBuf::new(),
        }
    }

    fn request(project: &str, exact: Option<&str>) -> MissingDependency {
        MissingDependency {
            project_id: Some(project.into()),
            version_id: exact.map(str::to_owned),
            required_by: vec!["consumer.jar".into()],
        }
    }

    fn installed(project: &str, version: &str, enabled: bool, file_name: &str) -> CheckedFile {
        CheckedFile {
            category: "mods",
            file_name: file_name.into(),
            size: 42,
            enabled,
            state: FileState::Verified,
            message: String::new(),
            can_keep_local: false,
            duplicate_group: None,
            project_id: Some(project.into()),
            version_id: Some(version.into()),
            fingerprint: Some("a".repeat(128)),
            mod_id: enabled.then(|| project.into()),
            mod_name: None,
        }
    }

    #[test]
    fn deduplicates_transitives_and_can_install_independent_dependencies() {
        let mut report = report();
        report.missing_dependencies = vec![
            request("one", None),
            request("two", None),
            request("bad", None),
        ];
        let mut catalog = Catalog::default();
        for (project, required) in [
            ("one", vec!["shared"]),
            ("two", vec!["shared"]),
            ("shared", vec![]),
            ("bad", vec!["side", "missing"]),
            ("side", vec![]),
        ] {
            catalog.titles.insert(project.into(), project.into());
            catalog
                .choices
                .insert(project.into(), Some(release(project, project, &required)));
        }
        catalog
            .titles
            .insert("missing".into(), "Unavailable".into());
        catalog.choices.insert("missing".into(), None);
        let plan = tauri::async_runtime::block_on(plan_dependencies(
            &report,
            &HashMap::new(),
            &mut catalog,
        ));
        assert_eq!(
            plan.selection.keys().collect::<Vec<_>>(),
            ["one", "shared", "two"]
        );
        assert_eq!(
            plan.selection["shared"].action.required_by,
            BTreeSet::from(["one".into(), "two".into()])
        );
        assert!(plan.review.issues[0].contains("Unavailable"));
        assert!(plan.review.review_token.is_some());
    }

    #[test]
    fn reuses_exact_disabled_file_and_refuses_a_second_enabled_version() {
        let mut report = report();
        report.missing_dependencies = vec![request("lib", Some("wanted"))];
        report.files = vec![installed("lib", "wanted", false, "local-lib.jar.disabled")];
        let mut catalog = Catalog::default();
        catalog
            .versions
            .insert("wanted".into(), release("lib", "wanted", &[]));
        catalog.titles.insert("lib".into(), "Library".into());
        let empty = HashMap::new();
        let plan = tauri::async_runtime::block_on(plan_dependencies(&report, &empty, &mut catalog));
        let enable = &plan.selection["lib"];
        assert_eq!(enable.action.kind, "enable");
        assert_eq!(enable.file.file_name, "local-lib.jar");
        assert_eq!(
            enable.enable_from.as_deref(),
            Some("local-lib.jar.disabled")
        );

        let automatic = tauri::async_runtime::block_on(plan_dependencies_with_pins(
            &report, &empty, &mut catalog, &[], false,
        ));
        assert!(automatic.selection.is_empty());
        assert_eq!(automatic.review.issues, ["Library is disabled. It was left disabled."]);

        report.files = vec![installed("lib", "wrong", true, "other-lib.jar")];
        let versions = HashMap::from([(
            "a".repeat(128),
            Arc::try_unwrap(release("lib", "wrong", &[])).ok().unwrap(),
        )]);
        let plan =
            tauri::async_runtime::block_on(plan_dependencies(&report, &versions, &mut catalog));
        assert!(plan.selection.is_empty());
        assert!(plan.review.issues[0].contains("other-lib.jar"));
        assert!(plan.review.review_token.is_none());
    }

    #[test]
    fn prevents_dependency_changes_for_unsupported_instances() {
        let mut report = report();
        report.loader = "Vanilla".into();
        let plan = tauri::async_runtime::block_on(plan_dependencies(
            &report,
            &HashMap::new(),
            &mut Catalog::default(),
        ));
        assert!(plan.selection.is_empty());
        assert!(plan.review.issues[0].contains("Fabric"));
    }

    #[test]
    fn stages_and_enables_an_exact_local_jar_without_replacing_files() {
        use std::io::Write;

        let root =
            std::env::temp_dir().join(format!("delight-dependency-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let root = Stage(root);
        let mods = root.0.join("mods");
        fs::create_dir(&mods).unwrap();
        let disabled = mods.join("local-lib.jar.disabled");
        let destination = mods.join("local-lib.jar");
        let mut zip = zip::ZipWriter::new(File::create_new(&disabled).unwrap());
        zip.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(
            br#"{"schemaVersion":1,"id":"library","version":"1.0.0","environment":"client"}"#,
        )
        .unwrap();
        zip.finish().unwrap().sync_all().unwrap();
        let checked_bytes = fs::read(&disabled).unwrap();
        let config: InstanceConfig = serde_json::from_value(serde_json::json!({
            "id": "dependency-test", "name": "Test dependencies", "version": "1.21.1",
            "directory": root.0, "loader": "Fabric", "loaderVersion":"0.16.10",
            "java":"Automatic", "memory":4096, "jvmArguments":"", "mods":true,
            "resourcePacks":true, "shaderPacks":true, "config":true,
            "customResolution":false, "visible":true, "shortcut":false
        }))
        .unwrap();
        let version = release("lib", "wanted", &[]);
        let mut file = download_file(&version, &config.version).unwrap();
        file.file_name = "local-lib.jar".into();
        file.size = checked_bytes.len() as u64;
        file.sha512 = content_transfer::hash(&disabled).unwrap();
        let selection = Selection::from([(
            "lib".into(),
            Selected {
                action: Action {
                    name: "Library".into(),
                    version: "1.0.0".into(),
                    file_name: file.file_name.clone(),
                    kind: "enable",
                    required_by: BTreeSet::new(),
                },
                file,
                version,
                enable_from: Some("local-lib.jar.disabled".into()),
            },
        )]);
        let inventory = inventory_token(&scan(&config).unwrap());

        let stage = stage_selection(&config, &selection, &inventory).unwrap();
        fs::write(&destination, b"existing file").unwrap();
        assert!(commit_selection(&config, &selection, &stage, &inventory).is_err());
        assert_eq!(fs::read(&disabled).unwrap(), checked_bytes);
        assert_eq!(fs::read(&destination).unwrap(), b"existing file");
        fs::remove_file(&destination).unwrap();
        fs::write(stage.0.join("local-lib.jar"), b"changed after staging").unwrap();
        assert!(commit_selection(&config, &selection, &stage, &inventory).is_err());
        assert_eq!(fs::read(&disabled).unwrap(), checked_bytes);
        assert!(!destination.exists());
        drop(stage);

        let stage = stage_selection(&config, &selection, &inventory).unwrap();
        commit_selection(&config, &selection, &stage, &inventory).unwrap();
        assert_eq!(fs::read(destination).unwrap(), checked_bytes);
        assert!(!disabled.exists());
    }
}
