use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Filters {
    pub category: String,
    pub environment: String,
    pub loader: String,
    pub sort: String,
}

impl Filters {
    pub(super) fn validate(&self) -> Result<(), String> {
        let tag = |value: &str| value.len() <= 80 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
        if !tag(&self.category) || !tag(&self.loader)
            || !["any", "client", "server", "both", "either"].contains(&self.environment.as_str())
            || !["auto", "relevance", "downloads", "follows", "newest", "updated"].contains(&self.sort.as_str()) {
            return Err("Choose valid catalog filters.".into());
        }
        Ok(())
    }
    pub(super) fn is_default(&self) -> bool {
        self.category.is_empty() && self.environment == "any" && self.loader == "fabric" && self.sort == "auto"
    }
    pub(super) fn facets(&self, game: &str) -> Vec<Vec<String>> {
        let mut facets = vec![vec!["project_type:mod".into()]];
        if !game.is_empty() { facets.push(vec![format!("versions:{game}")]); }
        if !self.category.is_empty() { facets.push(vec![format!("categories:{}", self.category)]); }
        if !self.loader.is_empty() { facets.push(vec![format!("categories:{}", self.loader)]); }
        let environments: &[&str] = match self.environment.as_str() {
            "client" => &["client_only", "client_only_server_optional", "singleplayer_only"],
            "server" => &["server_only", "server_only_client_optional", "dedicated_server_only"],
            "both" => &["client_and_server"],
            "either" => &["client_or_server", "client_or_server_prefers_both"],
            _ => &[],
        };
        if !environments.is_empty() { facets.push(environments.iter().map(|value| format!("environment:{value}")).collect()); }
        facets
    }
}

#[derive(Deserialize)]
struct Category { name: String, project_type: String }
#[derive(Deserialize)]
struct Loader { name: String, supported_project_types: Vec<String> }
#[derive(Deserialize)]
struct GameVersion { version: String, version_type: String }
#[derive(Serialize, Deserialize)]
pub(crate) struct Choices { categories: Vec<String>, loaders: Vec<String>, versions: Vec<String> }

async fn get<T: serde::de::DeserializeOwned>(tag: &str) -> Result<T, String> {
    super::bloom_http_client()?.get(format!("https://api.modrinth.com/v2/tag/{tag}"))
        .timeout(std::time::Duration::from_secs(15)).send().await.and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("Could not load filter choices: {error}"))?
        .json().await.map_err(|error| format!("Invalid filter choices: {error}"))
}

#[tauri::command]
pub(crate) async fn get_catalog_filter_choices() -> Result<Choices, String> {
    if let Some(choices) = super::cache::read_json("catalog-filter-choices", "v1", Some(std::time::Duration::from_secs(86400))) { return Ok(choices); }
    let response = futures_util::try_join!(get::<Vec<Category>>("category"), get::<Vec<Loader>>("loader"), get::<Vec<GameVersion>>("game_version"));
    let (categories, loaders, versions) = match response {
        Ok(value) => value,
        Err(error) => return super::cache::read_json("catalog-filter-choices", "v1", None).ok_or(error),
    };
    let mut categories: Vec<_> = categories.into_iter().filter(|item| item.project_type == "mod").map(|item| item.name).collect();
    categories.sort(); categories.dedup();
    let choices = Choices { categories, loaders: loaders.into_iter().filter(|item| item.supported_project_types.iter().any(|kind| kind == "mod")).map(|item| item.name).collect(),
        versions: versions.into_iter().filter(|item| item.version_type == "release").map(|item| item.version).collect() };
    let _ = super::cache::write_json("catalog-filter-choices", "v1", &choices);
    Ok(choices)
}

pub(super) fn matching_version<'a>(versions: &'a [super::ModrinthVersion], game: &str, loader: &str) -> Option<&'a super::ModrinthVersion> {
    let matches = |version: &&super::ModrinthVersion| (game.is_empty() || version.game_versions.iter().any(|value| value == game))
        && (loader.is_empty() || version.loaders.iter().any(|value| value == loader));
    versions.iter().filter(matches).find(|version| version.version_type == "release").or_else(|| versions.iter().find(matches))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn filters() -> Filters { Filters { category: "optimization".into(), environment: "client".into(), loader: "fabric".into(), sort: "downloads".into() } }
    #[test]
    fn facets_combine_dimensions_and_group_equivalent_environments() {
        let value = filters(); value.validate().unwrap(); let facets = value.facets("26.3");
        for facet in ["project_type:mod", "versions:26.3", "categories:optimization", "categories:fabric"] { assert!(facets.contains(&vec![facet.into()])); }
        assert!(facets.contains(&vec!["environment:client_only".into(), "environment:client_only_server_optional".into(), "environment:singleplayer_only".into()]));
    }
    #[test]
    fn defaults_and_all_choices_do_not_add_unwanted_facets() {
        let mut value=filters(); value.category.clear();value.environment="any".into();value.sort="auto".into();assert!(value.is_default());
        value.loader.clear();assert_eq!(value.facets(""),vec![vec!["project_type:mod"]]);
        for bad in ["../fabric", "fabric\"],[\"project_type:shader", "fabric:foo"] { value.loader=bad.into(); assert!(value.validate().is_err()); }
        value.loader="fabric".into();value.sort="unknown".into();assert!(value.validate().is_err());
    }
    #[test]
    fn selected_file_matches_loader_and_minecraft_together() {
        let versions: Vec<super::super::ModrinthVersion> = serde_json::from_value(serde_json::json!([
            {"id":"wrong-loader","version_number":"1","version_type":"release","game_versions":["26.3"],"loaders":["forge"],"files":[]},
            {"id":"wrong-game","version_number":"2","version_type":"release","game_versions":["1.21.1"],"loaders":["fabric"],"files":[]},
            {"id":"correct","version_number":"3","version_type":"beta","game_versions":["26.3"],"loaders":["fabric"],"files":[]}
        ])).unwrap();
        assert_eq!(matching_version(&versions,"26.3","fabric").unwrap().id,"correct");
        assert!(matching_version(&versions,"26.3","quilt").is_none());
    }
}
