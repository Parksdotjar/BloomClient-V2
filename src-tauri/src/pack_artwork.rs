use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, UNIX_EPOCH},
};

use crate::{bloom_http_client, cache, existing_content_folder, instance_actions, load_instance};
use serde::Deserialize;

#[derive(Deserialize)]
struct Version {
    project_id: String,
}
#[derive(Deserialize)]
struct Project {
    id: String,
    icon_url: Option<String>,
}

fn fingerprints(folder: &Path) -> Result<Vec<(String, String)>, String> {
    let mut files = Vec::new();
    for entry in folder.read_dir().map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let lower = name.to_ascii_lowercase();
        if name.starts_with('.')
            || !lower.trim_end_matches(".disabled").ends_with(".zip")
            || !entry.file_type().is_ok_and(|kind| kind.is_file())
        {
            continue;
        }
        let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if instance_actions::linked(&metadata) { continue; }
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok());
        let key = format!(
            "{}\n{}\n{:?}",
            entry.path().display(),
            metadata.len(),
            modified
        );
        let hash = cache::read_json::<String>("pack-fingerprint", &key, None).or_else(|| {
            let hash = mc_launcher_core::io::hash::sha1_file(&entry.path()).ok()?;
            let _ = cache::write_json("pack-fingerprint", &key, &hash);
            Some(hash)
        });
        if let Some(hash) = hash {
            files.push((name, hash));
        }
    }
    Ok(files)
}

// Resolve by file content so renaming, toggling or importing an older pack keeps its identity.
#[tauri::command]
pub async fn get_pack_artwork(
    instance_id: String,
    category: String,
    for_sharing: Option<bool>,
) -> Result<HashMap<String, String>, String> {
    crate::instance_actions::validate_id(&instance_id)?;
    if !matches!(category.as_str(), "shaderpacks" | "resourcepacks") {
        return Err("Unsupported pack category".into());
    }
    let files = tauri::async_runtime::spawn_blocking(move || {
        match existing_content_folder(&load_instance(&instance_id)?, &category, for_sharing.unwrap_or(false))? {
            Some(folder) => fingerprints(&folder),
            None => Ok(Vec::new()),
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    if files.is_empty() { return Ok(HashMap::new()); }
    let client = bloom_http_client()?;
    let mut artwork = HashMap::new();
    let mut missing = Vec::new();
    for (_, hash) in &files {
        if let Some(icon) = cache::read_json::<Option<String>>(
            "pack-project-icon",
            hash,
            Some(Duration::from_secs(86400 * 7)),
        ) {
            artwork.insert(hash.clone(), icon);
        } else {
            missing.push(hash.as_str());
        }
    }
    missing.sort_unstable();
    missing.dedup();
    for batch in missing.chunks(100) {
        let request = client
            .post("https://api.modrinth.com/v2/version_files")
            .json(&serde_json::json!({ "algorithm": "sha1", "hashes": batch }))
            .timeout(Duration::from_secs(8));
        let Ok(response) = request.send().await.and_then(|r| r.error_for_status()) else {
            break;
        };
        let Ok(versions) = response.json::<HashMap<String, Version>>().await else {
            break;
        };
        let mut ids: Vec<_> = versions
            .values()
            .map(|version| &version.project_id)
            .collect();
        ids.sort_unstable();
        ids.dedup();
        let mut icons = HashMap::new();
        if !ids.is_empty() {
            let request = client
                .get("https://api.modrinth.com/v2/projects")
                .query(&[("ids", serde_json::json!(ids).to_string())])
                .timeout(Duration::from_secs(8));
            let Ok(response) = request.send().await.and_then(|r| r.error_for_status()) else {
                break;
            };
            let Ok(projects) = response.json::<Vec<Project>>().await else {
                break;
            };
            for project in projects {
                if let Some(url) = project
                    .icon_url
                    .filter(|url| cache::trusted_catalog_artwork_url(url))
                {
                    icons.insert(project.id, url);
                }
            }
        }
        for &hash in batch {
            let icon = versions
                .get(hash)
                .and_then(|v| icons.get(&v.project_id))
                .cloned();
            let _ = cache::write_json("pack-project-icon", hash, &icon);
            artwork.insert(hash.to_owned(), icon);
        }
    }
    let result: HashMap<_, _> = files
        .into_iter()
        .filter_map(|(name, hash)| artwork.get(&hash)?.as_ref().map(|url| (name, url.clone())))
        .collect();
    tauri::async_runtime::spawn(cache::warm_catalog_artwork(
        result.values().cloned().collect(),
    ));
    Ok(result
        .into_iter()
        .map(|(name, url)| {
            let source = cache::get_cached_catalog_artwork(url.clone())
                .ok()
                .flatten()
                .unwrap_or(url);
            (name, source)
        })
        .collect())
}
