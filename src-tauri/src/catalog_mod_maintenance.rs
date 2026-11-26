use super::{
    commit_mod_additions, download_file, incompatible, plan_dependencies_with_pins, protected_mod,
    scan_mods, source_id, stage_mods, Action, Catalog, CheckedFile, CompatibilityReport, Selected,
    Selection, Stage, STALE,
};
use crate::{
    content_downloads, content_transfer, instance_actions, workspace_install,
    workspace_player::PlayerFile, InstanceConfig, ModrinthVersion,
};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::{Cursor, Read, Seek},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

fn safe_mod_filename(name: &str) -> bool {
    name.ends_with(".jar")
        && crate::workspace_player::safe_content_name(name, ".jar")
        && !crate::cosmetics::is_managed_file(name)
}

struct LocalMod {
    source: PathBuf,
    file: CheckedFile,
    enable_from: Option<String>,
}

fn local_mod(
    config: &InstanceConfig,
    source: PathBuf,
    enable_from: Option<String>,
) -> Result<LocalMod, String> {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| {
            if enable_from.is_some() {
                name.strip_suffix(".disabled")
            } else {
                Some(name)
            }
        })
        .filter(|name| safe_mod_filename(name))
        .ok_or("Choose a regular Fabric .jar file with a valid filename.")?
        .to_owned();
    let meta = fs::symlink_metadata(&source).map_err(|_| format!("Could not read {name}."))?;
    if !meta.is_file() || instance_actions::linked(&meta) {
        return Err(format!("{name} must be a regular local file."));
    }
    let file = super::super::inspect_file(config, "mods", &source, name, &meta);
    if file.mod_id.is_none() || file.fingerprint.is_none() {
        return Err(format!(
            "{} is not a readable Fabric client mod.",
            file.file_name
        ));
    }
    Ok(LocalMod {
        source,
        file,
        enable_from,
    })
}

async fn scan(config: &InstanceConfig) -> Result<CompatibilityReport, String> {
    let config = config.clone();
    tauri::async_runtime::spawn_blocking(move || scan_mods(&config))
        .await
        .map_err(|_| "The Mods inventory could not be read.")?
}

fn selected(
    name: String,
    version: Arc<ModrinthVersion>,
    file: PlayerFile,
    enable_from: Option<String>,
) -> Selected {
    Selected {
        action: Action {
            name,
            version: version.version_number.clone(),
            file_name: file.file_name.clone(),
            kind: if enable_from.is_some() {
                "enable"
            } else {
                "install"
            },
            required_by: BTreeSet::new(),
        },
        version,
        file,
        enable_from,
    }
}

fn intended_file(picked: &Selected) -> CheckedFile {
    CheckedFile {
        category: "mods",
        file_name: picked.file.file_name.clone(),
        size: picked.file.size,
        enabled: true,
        state: super::super::FileState::Verified,
        message: String::new(),
        can_keep_local: false,
        duplicate_group: None,
        project_id: picked.file.project_id.clone(),
        version_id: picked.file.version_id.clone(),
        fingerprint: Some(picked.file.sha512.clone()),
        mod_id: None,
        mod_name: Some(picked.action.name.clone()),
    }
}

fn local_version(version: String) -> ModrinthVersion {
    ModrinthVersion {
        id: String::new(),
        project_id: None,
        version_number: version,
        version_type: String::new(),
        game_versions: Vec::new(),
        loaders: Vec::new(),
        date_published: String::new(),
        dependencies: Vec::new(),
        files: Vec::new(),
    }
}

fn reachable(
    report: &CompatibilityReport,
    versions: &HashMap<String, ModrinthVersion>,
    mut names: BTreeSet<String>,
) -> BTreeSet<String> {
    let mut next: Vec<_> = names.iter().cloned().collect();
    while let Some(name) = next.pop() {
        let Some(version) = report
            .files
            .iter()
            .find(|file| file.enabled && file.file_name == name)
            .and_then(|file| super::matched_version(file, versions))
        else {
            continue;
        };
        for dep in version
            .dependencies
            .iter()
            .filter(|dep| dep.dependency_type == "required")
        {
            for file in report.files.iter().filter(|file| {
                file.enabled
                    && super::dependency_matches(
                        dep,
                        file.project_id.as_deref(),
                        file.version_id.as_deref(),
                    )
            }) {
                if names.insert(file.file_name.clone()) {
                    next.push(file.file_name.clone());
                }
            }
        }
    }
    names
}

async fn resolve_additions(
    report: &mut CompatibilityReport,
    versions: &HashMap<String, ModrinthVersion>,
    mut selection: Selection,
    direct: BTreeSet<String>,
    catalog: &mut Catalog,
    pins: &[PlayerFile],
) -> Result<Selection, String> {
    super::super::assess(report, versions, &[]);
    let roots = reachable(report, versions, direct);
    for file in report
        .files
        .iter()
        .filter(|file| file.enabled && roots.contains(&file.file_name))
    {
        if file.duplicate_group.is_some() {
            return Err(format!(
                "Choose one enabled version of {} in Mods before installing.",
                file.file_name
            ));
        }
        if let Some(version) = super::matched_version(file, versions) {
            if report
                .files
                .iter()
                .filter(|other| other.enabled)
                .any(|other| {
                    super::matched_version(other, versions).is_some_and(|other| {
                        incompatible(version, other) || incompatible(other, version)
                    })
                })
            {
                return Err(format!("{} conflicts with an enabled mod.", file.file_name));
            }
        }
    }
    report
        .missing_dependencies
        .retain(|dep| dep.required_by.iter().any(|name| roots.contains(name)));
    let plan = plan_dependencies_with_pins(report, versions, catalog, pins, true).await;
    if let Some(issue) = plan.review.issues.first() {
        return Err(issue.clone());
    }
    if let Some(dependency) = plan
        .selection
        .values()
        .find(|dep| dep.enable_from.is_some())
    {
        return Err(format!(
            "Enable {} in Mods first. You chose to keep that dependency disabled.",
            dependency.action.name
        ));
    }
    for (project, dep) in plan.selection {
        if selection.insert(project, dep).is_some() {
            return Err(
                "The mods require conflicting releases. Review the installed versions.".into(),
            );
        }
    }
    if selection
        .values()
        .any(|item| protected_mod(pins, &item.file.file_name, item.file.project_id.as_deref()))
    {
        return Err(
            "This file is managed by the shared pack. Open its release to change it.".into(),
        );
    }
    Ok(selection)
}

fn apply_additions(
    config: &InstanceConfig,
    report: &CompatibilityReport,
    selection: &Selection,
    local_sources: &BTreeMap<String, PathBuf>,
    cancel: &AtomicBool,
    on_file: impl FnMut(usize, u64),
) -> Result<(), String> {
    if selection.is_empty() {
        return Ok(());
    }
    let stage = stage_mods(
        config,
        report,
        selection,
        &BTreeMap::new(),
        local_sources,
        cancel,
        on_file,
    )?;
    if cancel.load(Ordering::SeqCst) {
        return Err("__cancelled__".into());
    }
    let current = crate::load_instance(&config.id)?;
    commit_mod_additions(&current, report, selection, &stage)
}

pub(crate) fn install_catalog(
    app: &tauri::AppHandle,
    task: &content_downloads::ContentDownload,
    config: &InstanceConfig,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let _edit = workspace_install::updates::edit_lease(&config.id)?;
    let pins = workspace_install::updates::mod_maintenance_pins(&config.id)?;
    content_downloads::progress(
        app,
        &task.id,
        3,
        "Checking required dependencies".into(),
        0,
        0,
        0,
    );
    let (physical, selection, title) = tauri::async_runtime::block_on(async {
        let mut working = scan(config).await?;
        let mut versions = super::super::lookup_versions(&working.files).await?;
        let physical = working.clone();
        super::super::assess(&mut working, &versions, &[]);
        let mut catalog = Catalog::default();
        let project = task.project_id.as_str();
        if !source_id(project) {
            return Err("This mod has an invalid catalog identifier.".into());
        }
        let mut selection = Selection::new();
        let title = catalog.title(project).await;
        let root_name = if let Some(current) = working
            .files
            .iter()
            .find(|file| file.enabled && file.project_id.as_deref() == Some(project))
        {
            current.file_name.clone()
        } else {
            let version = catalog
                .compatible(project, &config.version)
                .await?
                .ok_or_else(|| {
                    format!(
                        "{title} has no compatible Fabric release for Minecraft {}.",
                        config.version
                    )
                })?;
            let file = download_file(&version, &config.version)
                .ok_or_else(|| format!("{title} has no verified mod download."))?;
            if working.files.iter().any(|existing| {
                existing.file_name.eq_ignore_ascii_case(&file.file_name)
                    || (!existing.enabled && existing.project_id.as_deref() == Some(project))
            }) {
                return Err(format!(
                    "A copy of {title} is already in Mods. Enable or review that file first."
                ));
            }
            let root = selected(title.clone(), version.clone(), file, None);
            let name = root.file.file_name.clone();
            versions.insert(root.file.sha512.clone(), version.as_ref().clone());
            working.files.push(intended_file(&root));
            selection.insert(project.to_owned(), root);
            name
        };
        let selection = resolve_additions(
            &mut working,
            &versions,
            selection,
            BTreeSet::from([root_name]),
            &mut catalog,
            &pins,
        )
        .await?;
        Ok::<_, String>((physical, selection, title))
    })?;
    let total = selection.values().map(|item| item.file.size).sum();
    apply_additions(
        config,
        &physical,
        &selection,
        &BTreeMap::new(),
        cancel,
        |done, bytes| {
            let progress = 8 + (done * 88 / selection.len().max(1)) as u8;
            content_downloads::progress(
                app,
                &task.id,
                progress,
                format!("Installing {title}"),
                bytes,
                total,
                0,
            );
        },
    )?;
    Ok(title)
}

pub(crate) fn install_local(
    config: &InstanceConfig,
    paths: Vec<PathBuf>,
    enable_from: Option<String>,
) -> Result<Vec<String>, String> {
    let local = paths
        .into_iter()
        .map(|path| local_mod(config, path, enable_from.clone()))
        .collect::<Result<Vec<_>, _>>()?;
    install_local_mods(config, local, false)
}

pub(crate) fn replace_local(config: &InstanceConfig, path: PathBuf) -> Result<Vec<String>, String> {
    install_local_mods(config, vec![local_mod(config, path, None)?], true)
}

pub(crate) fn install_local_verified(
    config: &InstanceConfig,
    path: PathBuf,
    expected_sha512: &str,
) -> Result<(), String> {
    let local = local_mod(config, path, None)?;
    if local.file.fingerprint.as_deref() != Some(expected_sha512) {
        return Err("The source mod changed. Review the file and try again.".into());
    }
    install_local_mods(config, vec![local], false).map(|_| ())
}

fn install_local_mods(
    config: &InstanceConfig,
    local: Vec<LocalMod>,
    allow_replace: bool,
) -> Result<Vec<String>, String> {
    let _edit = workspace_install::updates::edit_lease(&config.id)?;
    let pins = workspace_install::updates::mod_maintenance_pins(&config.id)?;
    let (physical, selection, sources, names, replacements) = tauri::async_runtime::block_on(async {
        let physical = scan(config).await?;
        let mut working = physical.clone();
        let mut direct = BTreeSet::new();
        let mut replacements = BTreeMap::new();
        for item in &local {
            let filename = &item.file.file_name;
            if item.enable_from.is_none() && working.files.iter().any(|file| file.fingerprint == item.file.fingerprint) {
                continue;
            }
            let existing: Vec<_> = working.files.iter()
                .filter(|file| file.enabled && file.mod_id == item.file.mod_id)
                .collect();
            if !existing.is_empty() {
                if existing.len() != 1 || !physical.files.iter().any(|file| file.file_name == existing[0].file_name) {
                    return Err("Choose one enabled version in Mods before installing this file.".into());
                }
                if item.enable_from.is_some() || local.len() != 1 {
                    return Err("A version is already enabled. Import the replacement by itself or use Update all.".into());
                }
                if !allow_replace {
                    return Err(format!("Replace installed mod: {} is already enabled.", existing[0].file_name));
                }
                let old = existing[0].file_name.clone();
                if protected_mod(&pins, &old, None) || crate::cosmetics::is_managed_file(&old) {
                    return Err("This version is managed. Use its normal update or repair action.".into());
                }
                replacements.insert(old.clone(), filename.clone());
                working.files.retain(|file| file.file_name != old);
            } else if allow_replace {
                return Err("The mod to replace changed. Drop the file again.".into());
            }
            if let Some(copy) = working
                .files
                .iter()
                .find(|file| file.file_name.eq_ignore_ascii_case(filename))
            {
                if item.enable_from.is_none() && copy.fingerprint == item.file.fingerprint {
                    continue;
                }
                return Err(format!("A file named {filename} already exists in Mods."));
            }
            if !direct.insert(filename.clone()) {
                return Err(format!("Select a single file named {filename}."));
            }
            working
                .files
                .retain(|file| Some(&file.file_name) != item.enable_from.as_ref());
            working.files.push(item.file.clone());
        }
        let versions = match super::super::lookup_versions(&working.files).await {
            Ok(versions) => versions,
            // Explicit local installs can still proceed if the staged Fabric
            // metadata verifies their requirements against local files.
            Err(_) if pins.is_empty() => HashMap::new(),
            Err(error) => return Err(error),
        };
        super::super::assess(&mut working, &versions, &[]);
        let mut selection = Selection::new();
        let mut sources = BTreeMap::new();
        for item in local
            .iter()
            .filter(|item| direct.contains(&item.file.file_name))
        {
            let file = working
                .files
                .iter()
                .find(|file| file.file_name == item.file.file_name)
                .ok_or(STALE)?;
            let sha512 = file.fingerprint.as_ref().ok_or(STALE)?;
            let version = versions.get(sha512);
            if version.is_some() && file.project_id.is_none() {
                return Err(format!("{} {}", file.file_name, file.message));
            }
            let meta = content_transfer::manifest(&item.source, "mods")?.ok_or(STALE)?;
            let title = file
                .mod_name
                .clone()
                .unwrap_or_else(|| file.file_name.clone());
            let player_file = PlayerFile {
                category: "mods".into(),
                file_name: file.file_name.clone(),
                enabled: true,
                size: file.size,
                source: if version.is_some() {
                    "modrinth"
                } else {
                    "local"
                }
                .into(),
                sha512: sha512.clone(),
                project_id: file.project_id.clone(),
                version_id: file.version_id.clone(),
                download_url: None,
            };
            let version = version.cloned().unwrap_or_else(|| {
                local_version(meta["version"].as_str().unwrap_or("Local file").into())
            });
            let key = player_file
                .project_id
                .clone()
                .unwrap_or_else(|| format!("local:{}", file.file_name));
            if selection
                .insert(
                    key,
                    selected(
                        title,
                        Arc::new(version),
                        player_file,
                        item.enable_from.clone(),
                    ),
                )
                .is_some()
            {
                return Err(format!("Select one version of {}.", file.file_name));
            }
            if item.enable_from.is_none() {
                sources.insert(file.file_name.clone(), item.source.clone());
            }
        }
        let names = direct.iter().cloned().collect();
        let selection = resolve_additions(
            &mut working,
            &versions,
            selection,
            direct,
            &mut Catalog::default(),
            &pins,
        )
        .await?;
        Ok::<_, String>((physical, selection, sources, names, replacements))
    })?;
    if !replacements.is_empty() {
        let cancel = AtomicBool::new(false);
        let stage = stage_mods(config, &physical, &selection, &replacements, &sources, &cancel, |_, _| {})?;
        super::maintenance::commit_updates(config, &physical, &selection, &replacements, &stage)?;
    } else { apply_additions(
        config,
        &physical,
        &selection,
        &sources,
        &AtomicBool::new(false),
        |_, _| {},
    )?; }
    Ok(names)
}

// An archive owns the versions it ships. Complete required dependencies
// without moving or upgrading the files it selected.
pub(crate) fn complete_pack_import(
    config: &InstanceConfig,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let (physical, selection, remaining) = tauri::async_runtime::block_on(async {
        let physical = scan(config).await?;
        let mut working = physical.clone();
        let versions = super::super::lookup_versions(&working.files).await?;
        super::super::assess(&mut working, &versions, &[]);
        let plan =
            plan_dependencies_with_pins(&working, &versions, &mut Catalog::default(), &[], true).await;
        if let Some(item) = plan
            .selection
            .values()
            .find(|item| item.enable_from.is_some())
        {
            return Err(format!(
                "{} is disabled. Review dependencies in Mods.",
                item.action.name
            ));
        }
        Ok::<_, String>((
            physical,
            plan.selection,
            plan.review.issues.into_iter().next(),
        ))
    })?;
    apply_additions(
        config,
        &physical,
        &selection,
        &BTreeMap::new(),
        cancel,
        |_, _| {},
    )?;
    remaining.map_or(Ok(()), Err)
}

const NESTED_JAR_BUDGET: u64 = 128 * 1024 * 1024;

pub(crate) fn collect_providers(
    input: impl Read + Seek,
    providers: &mut BTreeMap<String, BTreeSet<String>>,
    budget: &mut u64,
    depth: usize,
) {
    let Ok(mut archive) = zip::ZipArchive::new(input) else {
        return;
    };
    let meta = {
        let Ok(entry) = archive.by_name("fabric.mod.json") else {
            return;
        };
        if entry.size() > 256 * 1024 {
            return;
        }
        let mut bytes = Vec::new();
        if entry.take(256 * 1024 + 1).read_to_end(&mut bytes).is_err() || bytes.len() > 256 * 1024 {
            return;
        }
        let Ok(meta) = content_transfer::parse_fabric_metadata(&bytes) else {
            return;
        };
        meta
    };
    if meta["environment"] == "server" {
        return;
    }
    let version = meta["version"].as_str().unwrap_or_default();
    if let Some(id) = super::fabric_primary_id(&meta) {
        providers
            .entry(id.to_owned())
            .or_default()
            .insert(version.to_owned());
    }
    if let Some(aliases) = meta["provides"].as_array() {
        for alias in aliases.iter().filter_map(serde_json::Value::as_str) {
            providers
                .entry(alias.to_owned())
                .or_default()
                .insert(version.to_owned());
        }
    }
    if depth == 4 {
        return;
    }
    if let Some(jars) = meta["jars"].as_array() {
        for name in jars.iter().filter_map(|entry| entry["file"].as_str()) {
            let Ok(entry) = archive.by_name(name) else {
                continue;
            };
            let size = entry.size();
            if size > *budget || size > 32 * 1024 * 1024 {
                *budget = 0;
                return;
            }
            *budget -= size;
            let mut bytes = Vec::new();
            if entry.take(size + 1).read_to_end(&mut bytes).is_ok() && bytes.len() as u64 == size {
                collect_providers(Cursor::new(bytes), providers, budget, depth + 1);
            }
        }
    }
}

fn numeric_version(value: &str) -> Option<Vec<u32>> {
    let value = value.split_once('+').map_or(value, |(version, _)| version);
    let mut parts = value
        .split('.')
        .map(str::parse)
        .collect::<Result<Vec<u32>, _>>()
        .ok()?;
    while parts.last() == Some(&0) {
        parts.pop();
    }
    Some(parts)
}

fn fabric_semver(value: &str) -> Option<(semver::Version, bool)> {
    if let Ok(version) = semver::Version::parse(value) {
        return Some((version, false));
    }
    let split = value.find(['-', '+']).unwrap_or(value.len());
    let (core, suffix) = value.split_at(split);
    let parts = core.split('.').count();
    if !(1..=3).contains(&parts) {
        return None;
    }
    let empty_prerelease = suffix == "-";
    let suffix = if empty_prerelease { "-0" } else { suffix };
    let padded = format!("{core}{}{suffix}", ".0".repeat(3 - parts));
    Some((semver::Version::parse(&padded).ok()?, empty_prerelease))
}

fn compare_versions(actual: &str, expected: &str) -> Option<std::cmp::Ordering> {
    if let (Some((actual, empty_actual)), Some((expected, empty_expected))) =
        (fabric_semver(actual), fabric_semver(expected))
    {
        return Some(actual.cmp_precedence(&expected).then_with(|| empty_expected.cmp(&empty_actual)));
    }
    Some(numeric_version(actual)?.cmp(&numeric_version(expected)?))
}

// When Fabric has a predicate we don't understand, verify the provider's
// presence and leave the specialized version comparison to Fabric Loader.
fn version_term(version: &str, term: &str) -> Option<bool> {
    if term == "*" {
        return Some(true);
    }
    for (operator, expected) in [">=", "<=", ">", "<", "="]
        .into_iter()
        .filter_map(|operator| term.strip_prefix(operator).map(|value| (operator, value)))
    {
        if operator == "=" {
            return if version == expected {
                Some(true)
            } else {
                Some(compare_versions(version, expected)?.is_eq())
            };
        }
        let order = compare_versions(version, expected)?;
        return Some(match operator {
            ">=" => !order.is_lt(),
            "<=" => !order.is_gt(),
            ">" => order.is_gt(),
            _ => order.is_lt(),
        });
    }
    if let Some(prefix) = term.strip_suffix(".x").or_else(|| term.strip_suffix(".*")) {
        let base = prefix
            .split('.')
            .map(str::parse)
            .collect::<Result<Vec<u32>, _>>()
            .ok()?;
        let mut actual = numeric_version(version)?;
        actual.resize(actual.len().max(base.len()), 0);
        return Some(actual.starts_with(&base));
    }
    if let Some(value) = term.strip_prefix('~').or_else(|| term.strip_prefix('^')) {
        // Fabric ranges compare the full lower bound, including an empty prerelease
        // such as ~26.3-, then constrain the numeric major or minor components.
        let lower_bound = compare_versions(version, value)?;
        let components = |text: &str| numeric_version(text.split(['-', '+']).next()?);
        let actual = components(version)?;
        let expected = components(value)?;
        let width = if term.starts_with('~') { 2 } else { 1 };
        return Some(!lower_bound.is_lt()
            && (0..width).all(|index| actual.get(index).unwrap_or(&0) == expected.get(index).unwrap_or(&0)));
    }
    if version == term {
        return Some(true);
    }
    Some(compare_versions(version, term)?.is_eq())
}

pub(crate) fn version_matches(version: &str, predicate: &serde_json::Value, unknown_matches: bool) -> bool {
    let matches = |text: &str| {
        text.split_whitespace()
            .all(|term| version_term(version, term).unwrap_or(unknown_matches))
    };
    match predicate {
        serde_json::Value::String(value) => matches(value),
        serde_json::Value::Array(values) => values
            .iter()
            .filter_map(serde_json::Value::as_str)
            .any(matches),
        _ => unknown_matches,
    }
}

type Providers = BTreeMap<String, BTreeSet<String>>;

pub(crate) fn has_provider(
    providers: &Providers,
    id: &str,
    predicate: &serde_json::Value,
    unknown_matches: bool,
) -> bool {
    providers.get(id).is_some_and(|versions| {
        versions
            .iter()
            .any(|version| version_matches(version, predicate, unknown_matches))
    })
}

pub(super) struct StagedIssue {
    pub(super) files: BTreeSet<String>,
    pub(super) message: String,
}

impl From<&str> for StagedIssue {
    fn from(message: &str) -> Self {
        Self { files: BTreeSet::new(), message: message.into() }
    }
}

fn merge_providers(target: &mut Providers, source: &Providers) {
    for (id, versions) in source {
        target.entry(id.clone()).or_default().extend(versions.iter().cloned());
    }
}

pub(super) fn check_staged_fabric_requirements(
    config: &InstanceConfig,
    report: &CompatibilityReport,
    stage: &Stage,
    selection: &Selection,
    replacements: &BTreeMap<String, String>,
) -> Result<(), StagedIssue> {
    let mut providers = BTreeMap::<_, BTreeSet<_>>::new();
    providers.insert("minecraft".into(), BTreeSet::from([config.version.clone()]));
    if let Some(version) = &report.loader_version {
        providers.insert("fabricloader".into(), BTreeSet::from([version.clone()]));
        // An official Fabric Loader can itself be a nested provider.
        super::super::runtime::add_loader_providers(&mut providers, version);
    }
    let mut budget = NESTED_JAR_BUDGET;
    let mods = Path::new(&config.directory).join("mods");
    let installed: Vec<_> = report
        .files
        .iter()
        .filter(|file| {
            file.category == "mods"
                && file.enabled
                && (file.mod_id.is_some() || file.state == super::super::FileState::Managed)
        })
        .collect();
    let mut replaced = BTreeMap::new();
    for file in &installed {
        if let Ok(input) = fs::File::open(mods.join(&file.file_name)) {
            let destination = match replacements.get(&file.file_name) {
                Some(next) => replaced.entry(next.clone()).or_insert_with(Providers::new),
                None => &mut providers,
            };
            collect_providers(input, destination, &mut budget, 0);
        }
    }
    let mut previous = providers.clone();
    for removed in replaced.values() {
        merge_providers(&mut previous, removed);
    }
    let mut incoming = BTreeMap::new();
    for picked in selection.values() {
        let path = stage.0.join(&picked.file.file_name);
        let input = fs::File::open(path).map_err(|_| STALE)?;
        let mut declared = Providers::new();
        collect_providers(input, &mut declared, &mut budget, 0);
        merge_providers(&mut providers, &declared);
        incoming.insert(picked.file.file_name.clone(), declared);
    }
    for picked in selection.values() {
        let path = stage.0.join(&picked.file.file_name);
        let meta = content_transfer::manifest(&path, "mods").map_err(|error| StagedIssue { files: BTreeSet::new(), message: error })?.ok_or(STALE)?;
        if let Some(required) = meta["depends"].as_object() {
            for (id, predicate) in required {
                if id == "java" || (id == "fabricloader" && report.loader_version.is_none()) {
                    continue;
                }
                if !has_provider(&providers, id, predicate, true) {
                    let name = &picked.action.name;
                    if budget == 0 && !providers.contains_key(id) {
                        return Err(StagedIssue::from("Could not verify every bundled Fabric dependency."));
                    }
                    return Err(StagedIssue {
                        files: BTreeSet::from([picked.file.file_name.clone()]),
                        message: format!("{name} needs a compatible {id}."),
                    });
                }
            }
        }
        if let Some(breaks) = meta["breaks"].as_object() {
            if let Some(id) = breaks.iter().find_map(|(id, predicate)| {
                has_provider(&providers, id, predicate, false).then_some(id)
            }) {
                return Err(StagedIssue {
                    files: BTreeSet::from([picked.file.file_name.clone()]),
                    message: format!("{} conflicts with {id}.", picked.action.name),
                });
            }
        }
    }
    for file in installed
        .into_iter()
        .filter(|file| !replacements.contains_key(&file.file_name))
    {
        let Ok(Some(meta)) = content_transfer::manifest(&mods.join(&file.file_name), "mods") else {
            continue;
        };
        if let Some(dependencies) = meta["depends"].as_object() {
            if let Some((id, predicate)) = dependencies.iter().find(|(id, predicate)| {
                has_provider(&previous, id, predicate, true)
                    && !has_provider(&providers, id, predicate, true)
            }) {
                return Err(StagedIssue {
                    files: replaced.iter().filter(|(_, declared)| has_provider(declared, id, predicate, true))
                        .map(|(name, _)| name.clone()).collect(),
                    message: format!("{} still needs its installed {id} version.", file.mod_name.as_deref().unwrap_or(&file.file_name)),
                });
            }
        }
        if let Some(breaks) = meta["breaks"].as_object() {
            if let Some((id, predicate)) = breaks.iter().find(|(id, predicate)| {
                !has_provider(&previous, id, predicate, false)
                    && has_provider(&providers, id, predicate, false)
            }) {
                return Err(StagedIssue {
                    files: incoming.iter().filter(|(_, declared)| has_provider(declared, id, predicate, false))
                        .map(|(name, _)| name.clone()).collect(),
                    message: format!("{} conflicts with the proposed {id}.", file.mod_name.as_deref().unwrap_or(&file.file_name)),
                });
            }
        }
    }
    Ok(())
}
