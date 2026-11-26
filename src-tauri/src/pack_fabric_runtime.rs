use super::{content_transfer, dependencies::catalog, instance_actions};
use crate::workspace_player::{PlayerFile, PlayerRelease};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::{Cursor, Read},
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

type Outcomes = BTreeMap<String, Option<String>>;
static GRAPH_CACHE: OnceLock<Mutex<HashMap<String, Outcomes>>> = OnceLock::new();

pub(super) fn inspect_fingerprinted(
    files: &[(String, PathBuf)],
    minecraft: &str,
    loader: &str,
    key: String,
) -> Result<Outcomes, String> {
    let cache = GRAPH_CACHE.get_or_init(Mutex::default);
    if let Some(cached) = cache
        .lock()
        .ok()
        .and_then(|entries| entries.get(&key).cloned())
    {
        return Ok(cached);
    }
    let result = inspect(files, minecraft, loader)?;
    if let Ok(mut entries) = cache.lock() {
        if entries.len() >= 64 {
            entries.clear();
        }
        entries.insert(key, result.clone());
    }
    Ok(result)
}

type Providers = BTreeMap<String, BTreeSet<String>>;
static LOADER_GRAPH: OnceLock<Mutex<HashMap<String, Providers>>> = OnceLock::new();

pub(crate) fn add_loader_providers(providers: &mut Providers, loader: &str) {
    let cache = LOADER_GRAPH.get_or_init(Mutex::default);
    let available = cache
        .lock()
        .ok()
        .and_then(|loaded| loaded.get(loader).cloned());
    let available = available.or_else(|| {
        let discovered = read_loader_providers(loader)?;
        if let Ok(mut loaded) = cache.lock() {
            if loaded.len() >= 32 {
                loaded.clear();
            }
            loaded.insert(loader.to_owned(), discovered.clone());
        }
        Some(discovered)
    });
    if let Some(available) = available {
        for (id, versions) in available {
            providers.entry(id).or_default().extend(versions);
        }
    }
}

fn read_loader_providers(loader: &str) -> Option<Providers> {
    if loader.len() > 80
        || !loader.as_bytes().first().is_some_and(u8::is_ascii_digit)
        || !loader
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-_+".contains(&byte))
    {
        return None;
    }
    const LIMIT: u64 = 8 * 1024 * 1024;
    let suffix = format!("net/fabricmc/fabric-loader/{loader}/fabric-loader-{loader}.jar");
    let local = crate::bloom_data_dir()
        .ok()?
        .join("minecraft/libraries")
        .join(&suffix);
    let mut bytes = Vec::new();
    if fs::symlink_metadata(&local).is_ok_and(|metadata| {
        metadata.is_file() && !instance_actions::linked(&metadata) && metadata.len() <= LIMIT
    }) {
        fs::File::open(local)
            .ok()?
            .take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .ok()?;
    } else {
        let client = reqwest::blocking::Client::builder()
            .user_agent("DelightClient/PackWorkspace")
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .ok()?;
        let response = client
            .get(format!("https://maven.fabricmc.net/{suffix}"))
            .send()
            .ok()?
            .error_for_status()
            .ok()?;
        response.take(LIMIT + 1).read_to_end(&mut bytes).ok()?;
    }
    if bytes.is_empty() || bytes.len() as u64 > LIMIT {
        return None;
    }
    let mut result = Providers::new();
    let mut budget = LIMIT;
    catalog::collect_providers(Cursor::new(bytes), &mut result, &mut budget, 0);
    (budget > 0
        && result
            .get("fabricloader")
            .is_some_and(|versions| versions.contains(loader)))
    .then_some(result)
}

pub(super) fn inspect(
    files: &[(String, PathBuf)],
    minecraft: &str,
    loader: &str,
) -> Result<BTreeMap<String, Option<String>>, String> {
    let mut providers = BTreeMap::from([
        ("minecraft".into(), BTreeSet::from([minecraft.to_owned()])),
        ("fabricloader".into(), BTreeSet::from([loader.to_owned()])),
    ]);
    let mut budget = 128 * 1024 * 1024;
    let mut roots = Vec::new();
    for (name, path) in files {
        let metadata = fs::symlink_metadata(path).map_err(|_| format!("Could not read {name}."))?;
        if !metadata.is_file() || instance_actions::linked(&metadata) {
            return Err(format!("{name} must be a regular, verified file."));
        }
        let manifest = content_transfer::manifest(path, "mods")?
            .ok_or_else(|| format!("Could not verify {name}."))?;
        catalog::collect_providers(
            fs::File::open(path).map_err(|_| format!("Could not read {name}."))?,
            &mut providers,
            &mut budget,
            0,
        );
        if budget == 0 {
            return Err("Could not verify all bundled Fabric dependencies.".into());
        }
        roots.push((name.clone(), manifest));
    }
    if roots.iter().any(|(_, metadata)| {
        metadata["depends"]["mixinextras"].is_string()
            || metadata["depends"]["mixinextras"].is_array()
            || !metadata["breaks"]["mixinextras"].is_null()
    }) {
        add_loader_providers(&mut providers, loader);
    }
    Ok(roots
        .into_iter()
        .map(|(file_name, meta)| {
            let label = meta["name"].as_str().unwrap_or(&file_name);
            let missing = meta["depends"].as_object().and_then(|depends| {
                depends.iter().find(|(id, predicate)| {
                    id.as_str() != "java"
                        && !catalog::has_provider(&providers, id, predicate, false)
                })
            });
            let conflict = meta["breaks"].as_object().and_then(|breaks| {
                breaks
                    .iter()
                    .find(|(id, predicate)| catalog::has_provider(&providers, id, predicate, false))
            });
            let issue = if meta["environment"] == "server" {
                Some(format!("{label} is a server-only mod."))
            } else if let Some((id, predicate)) = missing {
                let range = predicate
                    .as_str()
                    .filter(|range| *range != "*")
                    .map(|range| format!(" ({range})"))
                    .unwrap_or_default();
                Some(format!("{label} needs {id}{range}."))
            } else {
                conflict.map(|(id, _)| format!("{label} conflicts with {id}."))
            };
            (file_name, issue)
        })
        .collect())
}

pub(crate) fn verify_release(
    release: &PlayerRelease,
    path: impl Fn(&PlayerFile) -> PathBuf,
) -> Result<(), String> {
    if release.manifest.mod_dependency_policy.as_deref() != Some("fabric") {
        return Ok(());
    }
    let files: Vec<_> = release
        .manifest
        .files
        .iter()
        .filter(|file| file.category == "mods" && file.enabled)
        .map(|file| (file.file_name.clone(), path(file)))
        .collect();
    let outcomes = inspect(
        &files,
        &release.manifest.minecraft_version,
        &release.manifest.loader_version,
    )?;
    outcomes.into_values().flatten().next().map_or(Ok(()), Err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::{Cursor, Write};

    fn archive(metadata: serde_json::Value, bundled: Option<&[u8]>) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("fabric.mod.json", options).unwrap();
        zip.write_all(metadata.to_string().as_bytes()).unwrap();
        if let Some(file) = bundled {
            zip.start_file("META-INF/lib.jar", options).unwrap();
            zip.write_all(file).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn fabric_requirements_use_versions_and_nested_aliases() {
        let root = std::env::temp_dir().join(format!("delight-runtime-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let client = root.join("client.jar");
        let provider = root.join("provider.jar");
        fs::write(
            &client,
            archive(
                json!({"id":"client","version":"1.0","depends":{"embedded_api":">=1.2","minecraft":">=1.21.1- <1.21.2-"}}),
                None,
            ),
        )
        .unwrap();
        let nested = archive(
            json!({"id":"loader_support","version":"1.4","provides":["embedded_api"]}),
            None,
        );
        fs::write(
            &provider,
            archive(
                json!({"id":"provider","version":"1.0","jars":[{"file":"META-INF/lib.jar"}]}),
                Some(&nested),
            ),
        )
        .unwrap();
        let mut files = vec![("client.jar".to_owned(), client)];
        assert!(inspect(&files, "1.21.1", "0.16.10").unwrap()["client.jar"]
            .as_deref()
            .unwrap()
            .contains("embedded_api"));
        files.push(("provider.jar".to_owned(), provider));
        assert!(inspect(&files, "1.21.1", "0.16.10")
            .unwrap()
            .into_values()
            .all(|issue| issue.is_none()));
        fs::remove_dir_all(root).unwrap();
    }
}
