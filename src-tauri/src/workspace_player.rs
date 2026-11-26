use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Read, time::Duration};
use url::Url;

const MAX_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
const URI_PREFIX: &str = "delight://pack/";
const PLAYER_PATH: &str = "/share/pack/";
const LEGACY_PLAYER_PATH: &str = "/p/";
const INVALID_LINK: &str = "Enter a Delight player link from the pack’s sharing page.";
const INVALID_RELEASE: &str = "This player link returned an incomplete or unsupported release.";

#[derive(Debug, Clone)]
pub(crate) struct PlayerLink {
    pub(crate) base: String,
    pub(crate) code: String,
}

fn normalized_code(input: &str) -> Option<String> {
    let code = input
        .strip_suffix('/')
        .unwrap_or(input)
        .to_ascii_uppercase();
    crate::workspace_publication::valid_pack_code(&code).then_some(code)
}

pub(crate) fn is_player_uri(url: &Url) -> bool {
    url.as_str()
        .strip_prefix(URI_PREFIX)
        .and_then(normalized_code)
        .is_some()
}

impl PlayerLink {
    pub(crate) fn parse(input: &str) -> Result<Self, String> {
        Self::from_base(input, crate::workspace_publication::sharing_base()?)
    }

    pub(super) fn from_base(input: &str, base: String) -> Result<Self, String> {
        let input = input.trim();
        let code = input.strip_prefix(URI_PREFIX)
            .or_else(|| {
                let path = input.strip_prefix(&base)?;
                path.strip_prefix(PLAYER_PATH).or_else(|| path.strip_prefix(LEGACY_PLAYER_PATH))
            })
            .and_then(normalized_code)
            .ok_or(INVALID_LINK)?;
        Ok(Self { base, code })
    }

    // Previously installed instances and release fingerprints use this identity.
    pub(crate) fn url(&self) -> String {
        format!("{}{LEGACY_PLAYER_PATH}{}", self.base, self.code)
    }

    pub(crate) fn display_url(&self) -> String {
        if self.base.starts_with("http://") {
            return format!("{URI_PREFIX}{}", self.code);
        }
        self.web_url()
    }

    pub(super) fn accepts_web_url(&self, url: &str) -> bool {
        url == self.url() || url == self.web_url()
    }

    fn web_url(&self) -> String {
        format!("{}{PLAYER_PATH}{}", self.base, self.code)
    }

    pub(crate) fn fetch(&self) -> Result<PlayerRelease, String> {
        self.fetch_revision(None)
    }

    pub(super) fn fetch_revision(&self, revision: Option<u64>) -> Result<PlayerRelease, String> {
        let mut url = format!("{}/v1/workspace-packs/{}", self.base, self.code);
        if let Some(revision) = revision {
            if !(1..=MAX_SAFE_INTEGER).contains(&revision) {
                return Err(INVALID_RELEASE.into());
            }
            url.push_str(&format!("/releases/{revision}"));
        }
        let release = self.fetch_manifest(&url, false)?;
        if revision.is_some_and(|requested| requested != release.revision) {
            return Err(INVALID_RELEASE.into());
        }
        Ok(release)
    }

    pub(super) fn fetch_for_install(&self) -> Result<PlayerRelease, String> {
        self.fetch_manifest(
            &format!("{}/v1/workspace-packs/{}/install", self.base, self.code),
            true,
        )
    }

    fn fetch_manifest(&self, url: &str, for_install: bool) -> Result<PlayerRelease, String> {
        let mut client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20));
        if self.base.starts_with("http://") {
            // Only the explicitly configured loopback development service uses HTTP.
            client = client.no_proxy();
        }
        let response = client
            .build()
            .map_err(|_| "Could not open the sharing service.")?
            .get(url)
            .send()
            .map_err(|_| {
                "Couldn’t reach the pack’s sharing service. Check your connection and try again."
            })?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(
                "This shared pack is unavailable. Check the player link with its creator.".into(),
            );
        }
        if for_install && response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err("The pack owner has paused new installations.".into());
        }
        if !response.status().is_success() {
            return Err("The sharing service couldn’t load this release. Try again.".into());
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_MANIFEST_BYTES)
        {
            return Err(INVALID_RELEASE.into());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Couldn’t finish loading the pack. Try again.")?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(INVALID_RELEASE.into());
        }
        let mut release: PlayerRelease = serde_json::from_slice(&bytes).map_err(|_| INVALID_RELEASE)?;
        if !self.accepts_web_url(&release.url) {
            return Err(INVALID_RELEASE.into());
        }
        release.url = self.url();
        release.validate(self)?;
        Ok(release)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayerRelease {
    pub(crate) code: String,
    pub(crate) url: String,
    pub(crate) revision: u64,
    #[serde(default)]
    pub(crate) required: bool,
    #[serde(default = "first_revision")]
    pub(crate) minimum_playable_revision: u64,
    pub(crate) release_note: String,
    pub(crate) creator: String,
    pub(crate) created_at: String,
    pub(crate) manifest: PlayerManifest,
}

fn first_revision() -> u64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayerManifest {
    pub(crate) name: String,
    pub(crate) minecraft_version: String,
    pub(crate) loader: String,
    pub(crate) loader_version: String,
    pub(crate) excluded_folders: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) mod_dependency_policy: Option<String>,
    pub(crate) files: Vec<PlayerFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayerFile {
    pub(crate) category: String,
    pub(crate) file_name: String,
    pub(crate) enabled: bool,
    pub(crate) size: u64,
    pub(crate) source: String,
    pub(crate) sha512: String,
    pub(crate) project_id: Option<String>,
    pub(crate) version_id: Option<String>,
    pub(crate) download_url: Option<String>,
}

fn plain_text(value: &str, max: usize, multiline: bool) -> bool {
    value.chars().count() <= max
        && value
            .chars()
            .all(|c| !c.is_ascii_control() || (multiline && matches!(c, '\r' | '\n' | '\t')))
}

fn reserved_device(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    stem.strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"))
        .is_some_and(|n| {
            matches!(
                n,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
}

pub(crate) fn safe_content_name(name: &str, ending: &str) -> bool {
    name.len() > ending.len()
        && name.trim() == name
        && !name.starts_with('.')
        && plain_text(name, 255, false)
        && name.encode_utf16().count() <= 255
        && !name.contains(['/', '\\', ':', '<', '>', '"', '|', '?', '*'])
        && !reserved_device(name)
        && name.to_ascii_lowercase().ends_with(ending)
}

fn runtime_id(value: &str) -> bool {
    value.len() <= 64
        && value.starts_with(|c: char| c.is_ascii_alphanumeric())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".+-_".contains(&b))
        && !value.ends_with('.')
        && !reserved_device(value)
}

fn source_id(value: Option<&str>) -> bool {
    value.is_some_and(|id| {
        !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric())
    })
}

pub(crate) fn trusted_file_url(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("cdn.modrinth.com")
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && url.fragment().is_none()
    })
}

impl PlayerFile {
    pub(super) fn validate(&self, minecraft: &str) -> Result<(), String> {
        let extension = match self.category.as_str() {
            "mods" => ".jar",
            "resourcepacks" | "shaderpacks" => ".zip",
            _ => return Err(INVALID_RELEASE.into()),
        };
        let ending = if self.enabled {
            extension.to_owned()
        } else {
            format!("{extension}.disabled")
        };
        let name = &self.file_name;
        if !safe_content_name(name, &ending) {
            return Err("A file in this release has an unsupported name or enabled state.".into());
        }
        if !(1..=MAX_SAFE_INTEGER).contains(&self.size)
            || self.sha512.len() != 128
            || !self
                .sha512
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("A file in this release is missing a valid size or checksum.".into());
        }
        let valid_source = match self.source.as_str() {
            "modrinth" => {
                source_id(self.project_id.as_deref())
                    && source_id(self.version_id.as_deref())
                    && self.download_url.as_deref().is_some_and(trusted_file_url)
            }
            "delight" => {
                self.category == "mods"
                    && *name == format!("bloom-cosmetics-{minecraft}{ending}")
                    && self.download_url.is_none()
                    && self.project_id.is_none()
                    && self.version_id.is_none()
            }
            _ => false,
        };
        if !valid_source {
            return Err("A file in this release has an unsupported source.".into());
        }
        Ok(())
    }
}

impl PlayerRelease {
    pub(crate) fn review_token(&self) -> String {
        // Serialize the validated, typed release so insignificant JSON formatting
        // cannot change the token between the preview and the install request.
        let data = serde_json::to_vec(self).expect("a typed player release serializes to JSON");
        format!("{:x}", Sha256::digest(data))
    }

    pub(super) fn validate(&self, link: &PlayerLink) -> Result<(), String> {
        let manifest = &self.manifest;
        if self.manifest.mod_dependency_policy.as_deref().is_some_and(|policy| policy != "fabric") {
            return Err(INVALID_RELEASE.into());
        }
        if self.code != link.code
            || self.url != link.url()
            || !(1..=MAX_SAFE_INTEGER).contains(&self.revision)
            || !(1..=self.revision).contains(&self.minimum_playable_revision)
            || (self.required && self.minimum_playable_revision != self.revision)
            || manifest.name.trim().is_empty()
            || !plain_text(&manifest.name, 80, false)
            || self.creator.trim().is_empty()
            || !plain_text(&self.creator, 256, false)
            || !plain_text(&self.release_note, 1000, true)
            || self.created_at.is_empty()
            || !plain_text(&self.created_at, 64, false)
            || manifest.loader != "fabric"
            || !runtime_id(&manifest.minecraft_version)
            || !runtime_id(&manifest.loader_version)
            || manifest.files.len() > 1500
        {
            return Err(INVALID_RELEASE.into());
        }
        let mut folders = HashSet::new();
        for folder in &manifest.excluded_folders {
            if !matches!(
                folder.as_str(),
                "config" | "defaultconfigs" | "kubejs" | "scripts" | "global_packs" | "datapacks"
            ) || !folders.insert(folder)
            {
                return Err(INVALID_RELEASE.into());
            }
        }
        let mut paths = HashSet::new();
        let mut total = 0u64;
        for file in &manifest.files {
            file.validate(&manifest.minecraft_version)?;
            let name = file.file_name.to_lowercase();
            if !paths.insert((
                &file.category,
                name.trim_end_matches(".disabled").to_owned(),
            )) {
                return Err("This release contains two files with the same destination.".into());
            }
            // Each size is validated first. Bound the total to an exact JS integer
            // for the download estimate and native download progress.
            total += file.size;
            if total > MAX_SAFE_INTEGER {
                return Err(INVALID_RELEASE.into());
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn get_workspace_release(
    player_url: String,
    revision: Option<u64>,
) -> Result<PlayerRelease, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let link = PlayerLink::parse(&player_url)?;
        let mut release = link.fetch_revision(revision)?;
        release.url = link.display_url();
        Ok(release)
    })
    .await
    .map_err(|_| "The release lookup stopped. Try again.".to_owned())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayerPreview {
    player_url: String,
    installed_instance_id: Option<String>,
    release: PlayerRelease,
    review_token: String,
    download_bytes: u64,
}

#[tauri::command]
pub(crate) async fn preview_player_pack(link: String) -> Result<PlayerPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let link = PlayerLink::parse(&link)?;
        // Follow identity belongs to the canonical link; it survives local renames
        // and an unavailable sharing service.
        let (installed_instance_id, mut release) =
            match crate::workspace_install::installed_release(&link.url())? {
                Some((id, release)) => {
                    release.validate(&link)?;
                    (Some(id), release)
                }
                None => (None, link.fetch_for_install()?),
            };
        let download_bytes = release
            .manifest
            .files
            .iter()
            .filter(|f| f.source == "modrinth")
            .map(|f| f.size)
            .sum();
        let review_token = release.review_token();
        let player_url = link.display_url();
        release.url = player_url.clone();
        Ok(PlayerPreview {
            player_url,
            installed_instance_id,
            download_bytes,
            review_token,
            release,
        })
    })
    .await
    .map_err(|_| "The player-link lookup stopped. Try again.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{io::Write, net::TcpListener};

    const BASE: &str = "https://api.north.bloomclient.org/minecraft";

    fn link() -> PlayerLink {
        PlayerLink::from_base("delight://pack/PACK2345", BASE.to_owned()).unwrap()
    }

    fn release() -> PlayerRelease {
        serde_json::from_value(json!({
            "code":"PACK2345","revision":1,"url":link().url(),"creator":"Meadow creator",
            "releaseNote":"Optional texture pack included.","createdAt":"2026-11-25T00:00:00.000Z",
            "manifest":{"name":"Meadow","minecraftVersion":"1.21.1","loader":"fabric","loaderVersion":"0.16.10",
                "excludedFolders":["config"],"files":[
                    {"category":"resourcepacks","fileName":"Lower Shield.zip.disabled","enabled":false,
                    "source":"modrinth","size":10,"sha512":"a".repeat(128),"versionId":"Example2","projectId":"Example1",
                    "downloadUrl":"https://cdn.modrinth.com/data/Example1/versions/Example2/Lower%20Shield.zip"},
                    {"category":"mods","fileName":"bloom-cosmetics-1.21.1.jar","enabled":true,"source":"delight","size":32,"sha512":"b".repeat(128)}]}
        })).unwrap()
    }

    #[test]
    fn public_links_and_protocol_links_share_one_configured_identity() {
        let canonical = link().url();
        let display = format!("{BASE}/share/pack/PACK2345");
        for value in [
            &canonical,
            &display,
            " delight://pack/pack2345 ",
            &format!("{BASE}/p/pack2345/"),
        ] {
            assert_eq!(
                PlayerLink::from_base(value, BASE.into()).unwrap().url(),
                canonical
            );
        }
        assert_eq!(link().display_url(), display);
        assert!(link().accepts_web_url(&canonical));
        assert!(link().accepts_web_url(&display));
        assert!(!link().accepts_web_url("delight://pack/PACK2345"));
        assert!(is_player_uri(
            &Url::parse("delight://pack/PACK2345").unwrap()
        ));
        assert!(!is_player_uri(&Url::parse(&canonical).unwrap()));
        let dev = "http://127.0.0.1:19471";
        let local = format!("{dev}/p/PACK2345");
        assert_eq!(
            PlayerLink::from_base(&local, dev.into()).unwrap().url(),
            local
        );
        let local_display = "delight://pack/PACK2345";
        assert_eq!(
            PlayerLink::from_base(&local, dev.into()).unwrap().display_url(),
            local_display
        );
        assert_eq!(
            PlayerLink::from_base(local_display, dev.into()).unwrap().url(),
            local
        );
        for value in [
            "https://example.com/p/PACK2345",
            "https://api.north.bloomclient.org/p/PACK2345",
            "https://api.north.bloomclient.org/minecraft.evil.test/share/pack/PACK2345",
            "https://api.north.bloomclient.org/minecraft/share/pack/PACK2345#draft",
            "delight://pack/PACK2345?draft=1",
            "delight://pack/PACK2345#settings",
            "delight://pack/PACK2345/settings",
            "delight://collaborator/PACK2345",
            "delight://pack/OOOOOOOO",
            "PACK2345",
            &local,
        ] {
            assert!(
                PlayerLink::from_base(value, BASE.to_owned()).is_err(),
                "{value}"
            );
        }
        assert!(PlayerLink::from_base(&local, "http://127.0.0.1:49171".into()).is_err());
    }

    #[test]
    fn previews_validate_the_response_and_bind_approval_to_contents() {
        let pack = release();
        pack.validate(&link()).unwrap();
        let token = pack.review_token();
        let mut changed = pack.clone();
        changed.release_note.push('!');
        assert_ne!(changed.review_token(), token);
        changed = pack.clone();
        changed.manifest.files[0].sha512 = "2".repeat(128);
        changed.validate(&link()).unwrap();
        assert_ne!(changed.review_token(), token);
        changed.url.push_str("/other");
        assert!(changed.validate(&link()).is_err());
        changed = pack.clone();
        changed.manifest.excluded_folders.push("worlds".into());
        assert!(changed.validate(&link()).is_err());
        changed = pack;
        changed.manifest.loader_version = "../shared".into();
        assert!(changed.validate(&link()).is_err());
    }

    #[test]
    fn validates_pins_destinations_and_resource_status_before_install() {
        let release = release();
        let resource = &release.manifest.files[0];
        for filename in [
            "nested/file.zip.disabled",
            "AUX.zip.disabled",
            "COM¹.zip.disabled",
            ".file.zip.disabled",
            "file.zip",
            "file.zip.disabled:metadata",
            "bad\\file.zip.disabled",
        ] {
            let mut file = resource.clone();
            file.file_name = filename.into();
            assert!(file.validate("1.21.1").is_err(), "{filename}");
        }
        for url in [
            "https://example.org/file",
            "http://cdn.modrinth.com/file",
            "https://cdn.modrinth.com:4001/file",
            "https://user@cdn.modrinth.com/file",
            "https://cdn.modrinth.com/file#part",
        ] {
            let mut file = resource.clone();
            file.download_url = Some(url.into());
            assert!(file.validate("1.21.1").is_err());
        }
        let mut managed = release.manifest.files[1].clone();
        managed.sha512.clear();
        assert!(managed.validate("1.21.1").is_err());
        managed = release.manifest.files[1].clone();
        managed.download_url = resource.download_url.clone();
        assert!(managed.validate("1.21.1").is_err());
        let mut duplicate = resource.clone();
        duplicate.file_name.make_ascii_uppercase();
        let mut pack = release;
        pack.manifest.files.push(duplicate);
        assert!(pack.validate(&link()).is_err());
    }

    #[test]
    fn retrieval_is_anonymous_and_stops_on_redirects_and_oversized_manifests() {
        fn fetch_error(status: &str, headers: &str, for_install: bool) -> String {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let reply = format!("HTTP/1.1 {status}\r\n{headers}\r\nConnection: close\r\n\r\n");
            let server = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = std::io::BufReader::new(&socket);
                let mut line = String::new();
                use std::io::BufRead;
                reader.read_line(&mut line).unwrap();
                let path = if for_install {
                    "/v1/workspace-packs/PACK2345/install"
                } else {
                    "/v1/workspace-packs/PACK2345"
                };
                assert!(line.starts_with(&format!("GET {path} ")));
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                        break;
                    }
                    assert!(!line.to_ascii_lowercase().starts_with("authorization:"));
                }
                socket.write_all(reply.as_bytes()).unwrap();
            });
            let link = PlayerLink {
                base,
                code: "PACK2345".into(),
            };
            let result = if for_install { link.fetch_for_install() } else { link.fetch() };
            server.join().unwrap();
            result.unwrap_err()
        }
        let moved = fetch_error("302 Found", "Location: /changed\r\nContent-Length: 0", false);
        assert_eq!(
            moved,
            "The sharing service couldn’t load this release. Try again."
        );
        let too_large = fetch_error(
            "200 OK",
            &format!("Content-Length: {}", MAX_MANIFEST_BYTES + 1),
            false,
        );
        assert_eq!(too_large, INVALID_RELEASE);
        let missing = fetch_error("404 Not Found", "Content-Length: 0", false);
        assert!(missing.contains("unavailable"));
        let paused = fetch_error("403 Forbidden", "Content-Length: 0", true);
        assert_eq!(paused, "The pack owner has paused new installations.");
    }
}
