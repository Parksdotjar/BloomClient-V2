use super::*;

#[derive(Deserialize, Serialize)]
pub(super) struct RuntimeChange {
    instance_id: String,
    previous: String,
    previous_loader: Option<String>,
    target: String,
    target_loader: String,
    #[serde(default)]
    retained: Option<BTreeMap<String, String>>,
}

impl RuntimeChange {
    fn save(&self, root: &Path, revert: bool) -> Result<(), String> {
        instance_actions::validate_id(&self.instance_id)?;
        let mut config = crate::load_instance(&self.instance_id)?;
        if crate::readable_instance_root(&config, true)? != root
            || !config.loader.eq_ignore_ascii_case("fabric")
            || (config.version != self.previous && config.version != self.target)
        {
            return Err(
                "The instance settings changed during the update. Review the recovery files."
                    .into(),
            );
        }
        if revert {
            config.version.clone_from(&self.previous);
            config.loader_version.clone_from(&self.previous_loader);
        } else {
            config.version.clone_from(&self.target);
            config.loader_version = Some(self.target_loader.clone());
        }
        let record = crate::bloom_data_dir()?
            .join("instances")
            .join(format!("{}.json", self.instance_id));
        workspace_install::updates::atomic_record(&record, &config)
    }

    pub(super) fn activate(&self, root: &Path) -> Result<(), String> {
        self.save(root, false)
    }

    pub(super) fn recover(&self, root: &Path) -> Result<(), String> {
        self.save(root, true)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VersionPreview {
    token: Option<String>,
    target: String,
    loader_version: String,
    changes: Vec<VersionChange>,
    issues: Vec<String>,
    backs_up_worlds: bool,
    create_copy: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionChange {
    name: String,
    detail: String,
    kind: &'static str,
}

struct VersionPlan {
    preview: VersionPreview,
    source: InstanceConfig,
    inventory: CompatibilityReport,
    selection: Selection,
    replacements: BTreeMap<String, String>,
}

fn named(file: &CheckedFile) -> String {
    file.mod_name
        .clone()
        .unwrap_or_else(|| file.file_name.clone())
}

fn target_metadata_support(
    config: &InstanceConfig,
    file: &CheckedFile,
    target: &str,
    loader: &str,
) -> bool {
    let Ok(Some(meta)) = content_transfer::manifest(
        &Path::new(&config.directory)
            .join("mods")
            .join(&file.file_name),
        "mods",
    ) else {
        return false;
    };
    let Some(deps) = meta["depends"].as_object() else {
        return false;
    };
    let supports = deps.get("minecraft").is_some_and(|predicate| {
        predicate.as_str() != Some("*") && catalog::version_matches(target, predicate, false)
    });
    supports
        && deps
            .get("fabricloader")
            .is_none_or(|predicate| catalog::version_matches(loader, predicate, false))
}

fn world_data(root: &Path) -> Result<bool, String> {
    let path = root.join("saves");
    if !path_exists(&path)? {
        return Ok(false);
    }
    regular_directory(&path)?;
    Ok(fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .next()
        .transpose()
        .map_err(|error| error.to_string())?
        .is_some())
}

async fn target_runtime(config: &InstanceConfig, target: &str) -> Result<(String, bool), String> {
    let (releases, loaders) = futures_util::future::join(
        crate::get_minecraft_releases(),
        crate::fabric_loader::available(target),
    )
    .await;
    let releases = releases?;
    let index = |version: &str| releases.iter().position(|release| release["id"] == version);
    let target_order = index(target).ok_or("Choose a supported Minecraft release.")?;
    let downgrade = index(&config.version).is_none_or(|source_order| target_order > source_order);
    let loaders = loaders?;
    let loader = loaders
        .iter()
        .find(|entry| entry.stable)
        .or_else(|| loaders.first())
        .ok_or("Fabric Loader does not offer a runtime for this Minecraft version.")?;
    Ok((loader.version.clone(), downgrade))
}

async fn build_plan(
    instance_id: String,
    target: String,
    fresh: bool,
) -> Result<VersionPlan, String> {
    instance_actions::validate_id(&instance_id)?;
    if target.is_empty()
        || target.len() > 32
        || !target
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-_".contains(&byte))
    {
        return Err("Choose a supported Minecraft release.".into());
    }
    let source = crate::load_instance(&instance_id)?;
    if !source.loader.eq_ignore_ascii_case("fabric") || source.version == target {
        return Err("Choose a different Minecraft version for a Fabric instance.".into());
    }
    let followed = workspace_install::updates::is_follow(&instance_id);
    let (loader_version, downgrade) = target_runtime(&source, &target).await?;
    let config = source.clone();
    let (inventory, backs_up_worlds) = tauri::async_runtime::spawn_blocking(move || {
        let inventory = if fresh {
            scan_mods(&config)?
        } else {
            scan_mods_cached(&config)?
        };
        let worlds = world_data(&inventory.directory)?;
        if path_exists(&inventory.directory.join(PENDING))? {
            return Err("Recover the previous mod change before updating Minecraft.".into());
        }
        Ok::<_, String>((inventory, worlds))
    })
    .await
    .map_err(|_| "Could not inspect the instance.")??;
    let mut issues: Vec<_> = inventory
        .issues
        .iter()
        .filter(|issue| !issue.starts_with("Select a Fabric Loader version"))
        .cloned()
        .collect();
    let create_copy = followed || (downgrade && backs_up_worlds);
    let backs_up_worlds = backs_up_worlds && !create_copy;

    let mut effective = inventory.clone();
    effective.minecraft_version.clone_from(&target);
    effective.loader_version = Some(loader_version.clone());
    effective.issues.clear();
    let hashes = inventory
        .files
        .iter()
        .filter(|file| file.enabled && file.state != FileState::Managed)
        .filter_map(|file| file.fingerprint.clone())
        .collect();
    let mut versions = lookup(hashes, None, fresh).await?;
    let channels = ["release", "beta", "alpha"].map(|channel| {
        let roots = inventory
            .files
            .iter()
            .filter_map(|file| {
                let hash = file.fingerprint.as_ref()?;
                (file.enabled
                    && file.state != FileState::Managed
                    && versions.get(hash).is_some_and(|version| {
                        version.version_type == channel
                            && super::super::super::source_issue(file, hash, version, &target)
                                .is_some()
                    }))
                .then(|| hash.clone())
            })
            .collect();
        lookup(roots, Some((&target, channel)), fresh)
    });
    let mut available = HashMap::new();
    for result in futures_util::future::join_all(channels).await {
        available.extend(result?);
    }

    let release_fallback = versions
        .iter()
        .filter(|(hash, old)| {
            matches!(old.version_type.as_str(), "alpha" | "beta")
                && !available.contains_key(*hash)
                && !fabric_release(old, &target)
        })
        .map(|(hash, _)| hash.clone())
        .collect();
    available.extend(lookup(release_fallback, Some((&target, "release")), fresh).await?);

    let mut selection = Selection::new();
    let mut replacements = BTreeMap::new();
    let mut changes = Vec::new();
    let mut picked_ids = BTreeSet::new();
    effective.files.retain_mut(|file| {
        if !file.enabled { return true; }
        let name = named(file);
        if file.state == FileState::Managed {
            replacements.insert(file.file_name.clone(), String::new());
            return false;
        }
        let (Some(hash), Some(mod_id)) = (file.fingerprint.clone(), file.mod_id.clone()) else {
            issues.push(format!("{name} could not be verified for the target version. {}", file.message));
            return true;
        };
        if !picked_ids.insert(mod_id) {
            issues.push(format!("{name} has more than one active version. Choose one in Mods before updating."));
        }
        let Some(old) = versions.get(&hash) else {
            if !target_metadata_support(&source, file, &target, &loader_version) {
                issues.push(format!("{name} is a local mod. Delight could not verify its Minecraft {target} support."));
            }
            return true;
        };
        if super::super::super::source_issue(file, &hash, old, &target).is_none() {
            return true;
        }
        if target_metadata_support(&source, file, &target, &loader_version) {
            let mut retained = old.clone();
            retained.game_versions.push(target.clone());
            versions.insert(hash, retained);
            return true;
        }
        if let Some(next) = available.get(&hash)
            .filter(|next| next.project_id == old.project_id)
            .and_then(|next| candidate_for_target(file, old, next.clone(), &target)) {
            if let Some(project) = next.file.project_id.clone() {
                if selection.contains_key(&project) {
                    issues.push(format!("{name} has multiple active files from the same project."));
                    return true;
                }
                let new_name = next.file.file_name.clone();
                changes.push(VersionChange { name: name.clone(), detail: next.summary.to_version.clone(), kind: "update" });
                replacements.insert(file.file_name.clone(), new_name.clone());
                file.file_name = new_name.clone();
                file.size = next.file.size;
                file.fingerprint = Some(next.file.sha512.clone());
                versions.insert(next.file.sha512.clone(), next.next.as_ref().clone());
                selection.insert(project, Selected {
                    action: Action { name, version: next.summary.to_version, file_name: new_name, kind: "update", required_by: BTreeSet::new() },
                    version: next.next, file: next.file, enable_from: None,
                });
                return true;
            }
        }
        if available.contains_key(&hash) {
            issues.push(format!("{name} has a target release, but Delight could not verify its download."));
            return true;
        }
        changes.push(VersionChange { name, detail: format!("No compatible Fabric build found on this release channel for Minecraft {target}."), kind: "remove" });
        replacements.insert(file.file_name.clone(), String::new());
        false
    });
    assess(&mut effective, &versions, &[]);
    let mut catalog = Catalog::default();
    let dependencies = plan_dependencies(&effective, &versions, &mut catalog).await;
    issues.extend(dependencies.review.issues);
    for (project, picked) in dependencies.selection {
        if picked.enable_from.is_some() {
            issues.push(format!(
                "{} is disabled. Enable it in Mods if you want to use it for this update.",
                picked.action.name
            ));
            continue;
        }
        changes.push(VersionChange {
            name: picked.action.name.clone(),
            detail: picked.action.version.clone(),
            kind: "dependency",
        });
        if selection.insert(project, picked).is_some() {
            issues.push("Two versions of a required dependency were selected. Review the dependency in Mods.".into());
        }
    }
    let mut filenames = BTreeSet::new();
    for entry in selection.values() {
        let name = &entry.file.file_name;
        if !filenames.insert(name.to_ascii_lowercase())
            || inventory.files.iter().any(|file| {
                file.file_name.eq_ignore_ascii_case(name)
                    && !replacements.contains_key(&file.file_name)
            })
        {
            issues.push(format!("A different mod already uses the filename {name}."));
        }
    }
    let active_verified = effective.files.iter().filter(|file| file.enabled);
    for file in active_verified {
        if file.message.starts_with("This release conflicts with") {
            issues.push(format!("{}: {}", named(file), file.message));
        }
    }
    issues.sort();
    issues.dedup();
    let token = issues.is_empty().then(|| {
        let files: Vec<_> = selection.values().map(|picked| &picked.file).collect();
        let snapshot = serde_json::json!([
            inventory_token(&inventory),
            target,
            loader_version,
            &replacements,
            files,
            backs_up_worlds,
            create_copy
        ]);
        format!("{:x}", Sha256::digest(snapshot.to_string().as_bytes()))
    });
    Ok(VersionPlan {
        preview: VersionPreview {
            target,
            loader_version,
            changes,
            issues,
            backs_up_worlds,
            create_copy,
            token,
        },
        source,
        inventory,
        selection,
        replacements,
    })
}

#[tauri::command]
pub(crate) async fn preview_minecraft_mod_update(
    instance_id: String,
    target: String,
) -> Result<VersionPreview, String> {
    Ok(build_plan(instance_id, target, false).await?.preview)
}

#[tauri::command]
pub(crate) async fn apply_minecraft_mod_update(
    app: tauri::AppHandle,
    instance_id: String,
    target: String,
    token: String,
    state: tauri::State<'_, LauncherState>,
) -> Result<InstanceConfig, String> {
    let plan = build_plan(instance_id.clone(), target, true).await?;
    if plan.preview.token.as_deref() != Some(&token) {
        return Err(
            "The instance or available files changed. Check the Minecraft version again.".into(),
        );
    }
    crate::run_mod_edit(&state, move || {
        let config = crate::load_instance(&instance_id)?;
        if inventory_token(&scan_mods(&config)?) != inventory_token(&plan.inventory)
            || config.loader_version != plan.source.loader_version
        {
            return Err(CHANGED.into());
        }
        let _game = workspace_install::updates::mod_maintenance_game_lease(&instance_id)?;
        let _edit = workspace_install::updates::edit_lease(&instance_id)?;
        let root = crate::readable_instance_root(&config, true)?;
        let mut target_config = config.clone();
        target_config.version.clone_from(&plan.preview.target);
        target_config.loader_version = Some(plan.preview.loader_version.clone());
        let mut stage_inventory = plan.inventory.clone();
        stage_inventory
            .loader_version
            .clone_from(&target_config.loader_version);
        let total = plan
            .selection
            .values()
            .map(|entry| entry.file.size)
            .fold(0u64, u64::saturating_add);
        with_download(
            &app,
            &config,
            "Minecraft version update",
            total,
            |_| true,
            |cancel, task_id| {
                let stage = stage_mods(
                    &target_config,
                    &stage_inventory,
                    &plan.selection,
                    &plan.replacements,
                    &BTreeMap::new(),
                    cancel,
                    |done, bytes| {
                        content_downloads::progress(
                            &app,
                            task_id,
                            (done * 90 / plan.selection.len()) as u8,
                            "Preparing verified mods".into(),
                            bytes,
                            total,
                            0,
                        );
                    },
                )?;
                if plan.preview.backs_up_worlds {
                    content_downloads::progress(
                        &app,
                        task_id,
                        92,
                        "Backing up worlds".into(),
                        total,
                        total,
                        0,
                    );
                    workspace_install::updates::recovery::copy_saves(
                        &root.join("saves"),
                        &stage.0.join("saves"),
                        cancel,
                    )?;
                }
                if cancel.load(Ordering::SeqCst) {
                    return Err("__cancelled__".into());
                }
                let checked = crate::load_instance(&instance_id)?;
                if inventory_token(&scan_mods(&checked)?) != inventory_token(&plan.inventory)
                    || checked.loader_version != plan.source.loader_version
                    || (!plan.preview.create_copy
                        && (workspace_install::updates::is_follow(&instance_id)
                            || world_data(root)? != plan.preview.backs_up_worlds))
                {
                    return Err(CHANGED.into());
                }
                if plan.preview.create_copy {
                    return install_copy(root, target_config, &plan, &stage, cancel);
                }
                crate::content_folder(&config, "mods")?;
                let originals = plan
                    .inventory
                    .files
                    .iter()
                    .filter(|file| plan.replacements.contains_key(&file.file_name))
                    .map(|file| {
                        Ok((
                            file.file_name.clone(),
                            file.fingerprint.clone().ok_or(CHANGED)?,
                        ))
                    })
                    .collect::<Result<BTreeMap<_, _>, String>>()?;
                let incoming = plan
                    .selection
                    .values()
                    .map(|entry| (entry.file.file_name.clone(), entry.file.sha512.clone()))
                    .collect();
                let runtime = RuntimeChange {
                    instance_id: instance_id.clone(),
                    previous: config.version.clone(),
                    previous_loader: config.loader_version.clone(),
                    target: plan.preview.target.clone(),
                    target_loader: plan.preview.loader_version.clone(),
                    retained: snapshot_files(&plan.inventory).ok().map(|mut files| {
                        files.retain(|name, _| !plan.replacements.contains_key(name));
                        files
                    }),
                };
                commit_journal(
                    root,
                    Journal {
                        originals,
                        incoming,
                        runtime: Some(runtime),
                    },
                    &stage.0,
                )?;
                crate::load_instance(&instance_id)
            },
        )
    })
    .await
}

fn install_copy(
    source: &Path,
    mut config: InstanceConfig,
    plan: &VersionPlan,
    stage: &Stage,
    cancel: &AtomicBool,
) -> Result<InstanceConfig, String> {
    let parent = source
        .parent()
        .ok_or("Could not find the instance's parent folder.")?;
    regular_directory(parent)?;
    let id = format!("version-copy-{}", uuid::Uuid::new_v4());
    let destination = parent.join(&id);
    let records = crate::bloom_data_dir()?.join("instances");
    regular_directory(&records)?;
    let record = records.join(format!("{id}.json"));
    if path_exists(&record)? {
        return Err("The new instance already exists. Check again.".into());
    }
    fs::create_dir(&destination)
        .map_err(|e| format!("Could not create a separate instance. {e}"))?;
    let result = (|| {
        let mods = destination.join("mods");
        fs::create_dir(&mods).map_err(|e| e.to_string())?;
        for file in plan
            .inventory
            .files
            .iter()
            .filter(|file| !plan.replacements.contains_key(&file.file_name))
        {
            let original = source.join("mods").join(&file.file_name);
            let Some(hash) = &file.fingerprint else {
                continue;
            }; // Unreadable disabled files stay on the original.
            if !valid_snapshot_name(&file.file_name, hash) || !regular(&original, hash) {
                return Err(CHANGED.into());
            }
            let copy = mods.join(&file.file_name);
            fs::copy(original, &copy).map_err(|e| e.to_string())?;
            if !regular(&copy, hash) {
                return Err(CHANGED.into());
            }
        }
        for entry in plan.selection.values() {
            let file = &entry.file;
            fs::hard_link(stage.0.join(&file.file_name), mods.join(&file.file_name))
                .map_err(|e| e.to_string())?;
        }
        crate::mod_duplicates::verify_staged_mods(&mods)?;
        if cancel.load(Ordering::SeqCst) {
            return Err("__cancelled__".into());
        }
        config.id = id;
        config.name = format!(
            "{} ({})",
            config.name.chars().take(44).collect::<String>(),
            config.version
        );
        config.directory = destination.to_string_lossy().into_owned();
        config.shortcut = false;
        workspace_install::updates::atomic_record(&record, &config)
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&destination);
        return Err(error);
    }
    Ok(config)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MinecraftModRecovery {
    previous: String,
}

fn latest_recovery(config: &InstanceConfig) -> Result<Option<(PathBuf, Journal)>, String> {
    let root = crate::readable_instance_root(config, true)?;
    let mut newest: Option<(std::time::SystemTime, PathBuf, Journal)> = None;
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with(".delight-mod-backup-")
        {
            continue;
        }
        let path = entry.path();
        if regular_directory(&path).is_err() {
            continue;
        }
        let record = path.join("journal.json");
        let Ok(info) = fs::symlink_metadata(&record) else {
            continue;
        };
        if !info.is_file() || instance_actions::linked(&info) || info.len() > 1024 * 1024 {
            continue;
        }
        let Ok(input) = File::open(&record) else {
            continue;
        };
        let Ok(journal) = serde_json::from_reader::<_, Journal>(input) else {
            continue;
        };
        if !journal.runtime.as_ref().is_some_and(|runtime| {
            runtime.instance_id == config.id
                && runtime.target == config.version
                && Some(&runtime.target_loader) == config.loader_version.as_ref()
        }) {
            continue;
        }
        let Ok(time) = info.modified() else {
            continue;
        };
        if newest.as_ref().is_none_or(|(prior, _, _)| time > *prior) {
            newest = Some((time, path, journal));
        }
    }
    Ok(newest.map(|(_, path, journal)| (path, journal)))
}

#[tauri::command]
pub(crate) async fn get_minecraft_mod_recovery(
    instance_id: String,
) -> Result<Option<MinecraftModRecovery>, String> {
    instance_actions::validate_id(&instance_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = crate::load_instance(&instance_id)?;
        if workspace_install::updates::is_follow(&instance_id) {
            return Ok(None);
        }
        Ok(latest_recovery(&config)?
            .and_then(|(_, journal)| journal.runtime)
            .map(|runtime| MinecraftModRecovery {
                previous: runtime.previous,
            }))
    })
    .await
    .map_err(|_| "Could not look up the Minecraft recovery point.")?
}

#[tauri::command]
pub(crate) async fn open_minecraft_mod_recovery(instance_id: String) -> Result<(), String> {
    instance_actions::validate_id(&instance_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let config = crate::load_instance(&instance_id)?;
        let (backup, _) =
            latest_recovery(&config)?.ok_or("There is no recovery point for this version.")?;
        tauri_plugin_opener::open_path(&backup, None::<&str>)
            .map_err(|error| format!("Could not open the recovery folder: {error}"))
    })
    .await
    .map_err(|_| "Could not open the recovery folder.")?
}

fn world_fingerprints(
    path: &Path,
    output: &mut BTreeMap<PathBuf, String>,
    prefix: &Path,
) -> Result<(), String> {
    regular_directory(path)?;
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
        if instance_actions::linked(&metadata) {
            return Err("This world contains linked files.".into());
        }
        let relative = prefix.join(entry.file_name());
        if metadata.is_dir() {
            world_fingerprints(&entry.path(), output, &relative)?;
        } else if metadata.is_file() {
            output.insert(relative, content_transfer::hash(&entry.path())?);
        } else {
            return Err("Could not verify a world file.".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn restore_minecraft_mod_update(
    instance_id: String,
    previous: String,
    state: tauri::State<'_, LauncherState>,
) -> Result<InstanceConfig, String> {
    instance_actions::validate_id(&instance_id)?;
    crate::run_mod_edit(&state, move || {
        let config = crate::load_instance(&instance_id)?;
        if workspace_install::updates::is_follow(&instance_id) { return Err(CHANGED.into()); }
        let root = crate::readable_instance_root(&config, true)?;
        let (backup, journal) = latest_recovery(&config)?.ok_or("There is no recovery point for this version.")?;
        let runtime = journal.runtime.ok_or(CHANGED)?;
        let previous_loader = runtime.previous_loader.filter(|loader| !loader.is_empty())
            .ok_or("The previous Fabric Loader version is unknown. The backup is still available.")?;
        if previous != runtime.previous || path_exists(&root.join(PENDING))? {
            return Err(CHANGED.into());
        }
        let inventory = scan_mods(&config)?;
        if !inventory.issues.is_empty() { return Err(CHANGED.into()); }
        let live = snapshot_files(&inventory)?;
        let mut saved = runtime.retained.ok_or("This recovery point predates inventory tracking. Open the backup to recover it.")?;
        saved.extend(journal.incoming.clone());
        if live != saved {
            return Err("The Mods folder changed after the update. Open the backup to recover the previous files.".into());
        }
        let worlds = world_data(root)?;
        if worlds {
            let mut current_worlds = BTreeMap::new();
            let mut saved_worlds = BTreeMap::new();
            world_fingerprints(&root.join("saves"), &mut current_worlds, Path::new(""))?;
            if path_exists(&backup.join("saves"))? {
                world_fingerprints(&backup.join("saves"), &mut saved_worlds, Path::new(""))?;
            }
            if current_worlds != saved_worlds {
                return Err("World files changed after the update. Open the backup to recover those worlds separately.".into());
            }
        }
        let source = backup.join("original");
        regular_directory(&source)?;
        for (name, hash) in &journal.originals {
            if !valid_snapshot_name(name, hash) || !regular(&source.join(name), hash) {
                return Err("A saved mod no longer matches the recovery point.".into());
            }
            if live.contains_key(name) && !journal.incoming.contains_key(name) { return Err(CHANGED.into()); }
        }
        let mut retained = live;
        retained.retain(|name, _| !journal.incoming.contains_key(name));
        let reverse = Journal {
            originals: journal.incoming,
            incoming: journal.originals,
            runtime: Some(RuntimeChange {
                instance_id: instance_id.clone(), previous: config.version.clone(), previous_loader: config.loader_version.clone(),
                target: previous, target_loader: previous_loader, retained: Some(retained),
            }),
        };
        let stage = Stage(root.join(format!(".delight-dependencies-{}", uuid::Uuid::new_v4())));
        fs::create_dir(&stage.0).map_err(|e| e.to_string())?;
        for (name, hash) in &reverse.incoming {
            let restored = stage.0.join(name);
            fs::copy(source.join(name), &restored).map_err(|e| e.to_string())?;
            if !regular(&restored, hash) { return Err(CHANGED.into()); }
        }
        if worlds {
            workspace_install::updates::recovery::copy_saves(
                &root.join("saves"), &stage.0.join("saves"), &AtomicBool::new(false),
            )?;
        }
        commit_journal(root, reverse, &stage.0)?;
        crate::load_instance(&instance_id)
    }).await
}

fn snapshot_files(report: &CompatibilityReport) -> Result<BTreeMap<String, String>, String> {
    report
        .files
        .iter()
        .map(|file| {
            Ok((
                file.file_name.clone(),
                file.fingerprint
                    .clone()
                    .ok_or("A mod could not be verified for recovery.")?,
            ))
        })
        .collect()
}
