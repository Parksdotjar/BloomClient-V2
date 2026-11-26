use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[path = "workspace_access.rs"]
pub(crate) mod access;
#[path = "workspace_drafts.rs"]
pub(crate) mod drafts;
#[path = "workspace_restore.rs"]
pub(crate) mod restore;

const TERMS_VERSION: &str = "1";
pub(super) const PRODUCTION: &str = "https://api.north.bloomclient.org/minecraft";

pub(crate) fn sharing_base() -> Result<String, String> {
    Ok(Service::configured()?.base)
}

pub(crate) fn valid_pack_code(code: &str) -> bool {
    code.len() == 8
        && code
            .chars()
            .all(|c| "23456789ABCDEFGHJKLMNPQRSTUVWXYZ".contains(c))
}

// Only a transmission failure can lose a receipt. Credential acquisition and
// refresh failures happen before sending, or after an explicit HTTP 401.
pub(super) const UNCONFIRMED_REQUEST: &str =
    "Could not confirm the request with the sharing service. Try again to recover the result.";

#[derive(Debug, Serialize)]
pub(crate) struct PublishError {
    code: &'static str,
    message: String,
}

impl From<String> for PublishError {
    fn from(message: String) -> Self {
        match message.as_str() {
            "signed_out" => Self {
                code: "signed_out",
                message: "Sign in with the Delight account used for this review.".into(),
            },
            "stale_review" => Self {
                code: "stale_review",
                message: "The pack or one of its sources changed since this review. Check the contents again before publishing.".into(),
            },
            "stale_base" => Self {
                code: "stale_base",
                message: "A newer version was published. Refresh the changes before publishing.".into(),
            },
            _ => Self {
                code: "publication_error",
                message,
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Publisher {
    id: String,
    name: String,
    terms_accepted: bool,
    can_publish: bool,
    can_require: bool,
    can_edit: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Publication {
    code: String,
    player_url: String,
    revision: u64,
    release_note: String,
    #[serde(default)]
    required: bool,
    #[serde(default = "first_version")]
    minimum_playable_revision: u64,
}

impl Publication {
    fn for_display(mut self) -> Result<Self, String> {
        let link = crate::workspace_player::PlayerLink::parse(&self.player_url)?;
        if link.code != self.code {
            return Err("The saved release has an invalid player link.".into());
        }
        self.player_url = link.display_url();
        Ok(self)
    }
}

fn first_version() -> u64 {
    1
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteReceipt {
    code: String,
    url: String,
    revision: u64,
    release_note: String,
    #[serde(default)]
    required: bool,
    #[serde(default = "first_version")]
    minimum_playable_revision: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Intent {
    publisher_id: String,
    publication_id: Uuid,
}

struct Service {
    base: String,
    #[cfg(debug_assertions)]
    development: bool,
}

impl Service {
    fn configured() -> Result<Self, String> {
        #[cfg(debug_assertions)]
        if let Ok(value) = std::env::var("BLOOM_WORKSPACE_DEV_SERVICE") {
            let url =
                reqwest::Url::parse(&value).map_err(|_| "Invalid local sharing service URL.")?;
            if url.scheme() != "http"
                || !matches!(url.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
                || !std::env::var_os("BLOOM_DEV_DATA_DIR")
                    .is_some_and(|path| Path::new(&path).is_absolute())
            {
                return Err(
                    "The local sharing test requires a loopback service and an isolated profile."
                        .into(),
                );
            }
            return Ok(Self {
                base: value.trim_end_matches('/').into(),
                development: true,
            });
        }
        Ok(Self {
            base: PRODUCTION.into(),
            #[cfg(debug_assertions)]
            development: false,
        })
    }

    fn storage(&self) -> Result<PathBuf, String> {
        let namespace = format!("{:x}", Sha256::digest(self.base.as_bytes()));
        Ok(crate::bloom_data_dir()?
            .join("workspace-publications")
            .join(namespace))
    }

    fn accepted(&self, account: &str) -> Result<PathBuf, String> {
        Ok(self.storage()?.join("terms").join(format!(
            "{}-{:x}.json",
            TERMS_VERSION,
            Sha256::digest(account.as_bytes())
        )))
    }

    fn account(&self) -> Result<Option<(String, String)>, String> {
        #[cfg(debug_assertions)]
        if self.development {
            if std::env::var("BLOOM_WORKSPACE_DEV_TOKEN")
                .ok()
                .filter(|s| !s.is_empty())
                .is_none()
            {
                return Ok(None);
            }
            return Ok(std::env::var("BLOOM_WORKSPACE_DEV_PUBLISHER_ID")
                .ok()
                .filter(|id| !id.is_empty())
                .map(|id| {
                    (
                        id,
                        std::env::var("BLOOM_WORKSPACE_DEV_PUBLISHER_NAME")
                            .unwrap_or_else(|_| "Local creator".into()),
                    )
                }));
        }
        crate::social::workspace_publisher()
    }

    fn request(
        &self,
        owner: &str,
        route: &str,
        body: Option<&Value>,
    ) -> Result<reqwest::blocking::Response, String> {
        #[cfg(debug_assertions)]
        if self.development {
            if self.account()?.map(|a| a.0).as_deref() != Some(owner) {
                return Err("signed_out".into());
            }
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(50))
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| "Unable to open local service.")?;
            let url = format!("{}{route}", self.base);
            let req = match body {
                Some(data) => client.post(url).json(data),
                None => client.get(url),
            };
            return req
                .bearer_auth(std::env::var("BLOOM_WORKSPACE_DEV_TOKEN").map_err(|_| "signed_out")?)
                .send()
                .map_err(|_| UNCONFIRMED_REQUEST.into());
        }
        crate::social::workspace_request(owner, route, body)
    }

    fn receipt(&self, response: reqwest::blocking::Response) -> Result<Publication, String> {
        if !response.status().is_success() {
            return Err(response_message(response.status()).into());
        }
        let r: RemoteReceipt = response
            .json()
            .map_err(|_| "The sharing service returned an unreadable receipt. Try again.")?;
        let link = crate::workspace_player::PlayerLink::from_base(&r.url, self.base.clone())?;
        // A receipt contains a public viewer link, never an editor grant or an arbitrary external URL.
        if r.code != link.code
            || r.minimum_playable_revision == 0
            || r.minimum_playable_revision > r.revision
            || (r.required && r.minimum_playable_revision != r.revision)
            || !link.accepts_web_url(&r.url)
        {
            return Err("The sharing service returned an invalid player link. Try again.".into());
        }
        Ok(Publication {
            code: r.code,
            player_url: link.url(),
            revision: r.revision,
            release_note: r.release_note,
            required: r.required,
            minimum_playable_revision: r.minimum_playable_revision,
        })
    }
}

fn response_message(status: reqwest::StatusCode) -> &'static str {
    match status.as_u16() {
        401 | 403 => "signed_out",
        400 | 422 => "The sharing service could not validate this release. Recheck its files and release note.",
        413 => "This release exceeds the sharing service’s file limit.",
        409 => "The first release has already been created. Return to Overview to recover its player link.",
        429 => "Too many requests. Wait a moment and try again.",
        _ => "The sharing service could not confirm publication. Try again to recover the result.",
    }
}

fn read_record<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "The saved publication record is unreadable.".into()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err("The saved publication record could not be opened.".into()),
    }
}

// An OS lock is released on process exit. Leave its file in place so all open
// handles keep referring to the same lock, even across launcher restarts.
fn lock_file(path: &Path) -> Result<fs::File, String> {
    let parent = path.parent().ok_or("Invalid publication directory.")?;
    fs::create_dir_all(parent).map_err(|_| "Could not create the publication directory.")?;
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|_| "Could not open the publication lock.")?;
    file.lock()
        .map_err(|_| "Could not lock the publication record.")?;
    Ok(file)
}

// Only expose a complete, flushed record. The lock and same-volume rename
// also work on filesystems without hard links (for example an exFAT profile).
fn record_once<T: Serialize + DeserializeOwned>(path: &Path, value: &T) -> Result<T, String> {
    let _guard = lock_file(&path.with_extension("lock"))?;
    if let Some(record) = read_record(path)? {
        return Ok(record);
    }
    write_record(path, value)
}

// Callers hold the publication lock when replacing the latest confirmed release.
fn write_record<T: Serialize + DeserializeOwned>(path: &Path, value: &T) -> Result<T, String> {
    let parent = path.parent().ok_or("Invalid publication directory.")?;
    let temp = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "Could not prepare the publication record.")?;
        serde_json::to_writer(&mut file, value)
            .map_err(|_| "Could not write the publication record.")?;
        file.flush()
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not save the publication record.")?;
        drop(file);
        fs::rename(&temp, path).map_err(|_| "The publication record could not be saved. Check free space and filesystem permissions.")?;
        read_record(path)?.ok_or_else(|| "The publication record could not be reopened.".into())
    })();
    let _ = fs::remove_file(temp);
    result
}

fn finish(
    service: &Service,
    dir: &Path,
    owner: &str,
    receipt: &Publication,
) -> Result<Publication, String> {
    record_once(&service.accepted(owner)?, &true)?;
    if receipt.revision == 1 {
        return record_once(&dir.join("receipt.json"), receipt);
    }
    save_head(dir, receipt)
}

fn save_head(dir: &Path, receipt: &Publication) -> Result<Publication, String> {
    let path = dir.join("receipt.json");
    let cached: Publication =
        read_record(&path)?.ok_or("Find the published pack before updating it.")?;
    if receipt.code != cached.code || receipt.player_url != cached.player_url {
        return Err("The release belongs to another pack.".into());
    }
    if receipt.revision > cached.revision {
        return write_record(&path, receipt);
    }
    Ok(cached)
}

fn recover(service: &Service, dir: &Path, intent: &Intent) -> Result<Option<Publication>, String> {
    let response = service.request(
        &intent.publisher_id,
        &format!("/v1/workspace-publications/{}", intent.publication_id),
        None,
    )?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    finish(
        service,
        dir,
        &intent.publisher_id,
        &service.receipt(response)?,
    )
    .map(Some)
}

fn publication(instance_id: &str) -> Result<Option<Publication>, String> {
    crate::instance_actions::validate_id(instance_id)?;
    let service = Service::configured()?;
    let dir = service.storage()?.join("instances").join(instance_id);
    if let Some(receipt) = read_record(&dir.join("receipt.json"))? {
        return Ok(Some(receipt));
    }
    let intent_path = dir.join("intent.json");
    if read_record::<Intent>(&intent_path)?.is_none() {
        return Ok(None);
    }
    let _guard = lock_file(&dir.join("publish.lock"))?;
    if let Some(receipt) = read_record(&dir.join("receipt.json"))? {
        return Ok(Some(receipt));
    }
    let Some(intent) = read_record::<Intent>(&intent_path)? else {
        return Ok(None);
    };
    if service.account()?.as_ref().map(|a| &a.0) != Some(&intent.publisher_id) {
        return Err(
            "Sign in with the original publisher to check the previous publication attempt.".into(),
        );
    }
    recover(&service, &dir, &intent)
}

fn release_rejected_intent(
    path: &Path,
    first_attempt: bool,
    status: u16,
    error: Option<&str>,
) -> Result<(), String> {
    // A prior timed-out POST could still commit. Only discard the key when
    // the sole request for it was explicitly rejected before the insert.
    let rejected = matches!(status, 400 | 401 | 403 | 404 | 405 | 413 | 422 | 429)
        || (status == 503
            && matches!(
                error,
                Some("source_check_unavailable" | "pack_code_unavailable")
            ));
    if first_attempt && rejected {
        fs::remove_file(path)
            .map_err(|_| "The rejected publication attempt could not be cleared.")?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_workspace_publication(
    instance_id: String,
    refresh: Option<bool>,
) -> Result<Option<Publication>, String> {
    let receipt = tauri::async_runtime::spawn_blocking(move || {
        let cached = publication(&instance_id)?;
        if !refresh.unwrap_or(false) { return Ok(cached); }
        let Some(cached) = cached else {
            return Ok(None);
        };
        let head = crate::workspace_player::PlayerLink::parse(&cached.player_url)?.fetch()?;
        if head.revision <= cached.revision { return Ok(Some(cached)); }
        let receipt = Publication {
            code: head.code,
            player_url: head.url,
            revision: head.revision,
            release_note: head.release_note,
            required: head.required,
            minimum_playable_revision: head.minimum_playable_revision,
        };
        let dir = Service::configured()?
            .storage()?
            .join("instances")
            .join(&instance_id);
        let _guard = lock_file(&dir.join("publish.lock"))?;
        save_head(&dir, &receipt).map(Some)
    })
    .await
    .map_err(|_| "The publication lookup stopped unexpectedly.")??;
    receipt.map(Publication::for_display).transpose()
}

#[tauri::command]
pub(crate) async fn get_workspace_release_history(
    instance_id: String,
) -> Result<Vec<ReleaseSummary>, String> {
    let link = if let Some(followed) =
        crate::workspace_install::get_followed_pack(instance_id.clone()).await?
    {
        followed.player_url
    } else {
        tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
            let service = Service::configured()?;
            let dir = access::path(&service, &instance_id)?;
            if let Some((record, _)) = access::collaboration(&service, &dir)? {
                return Ok(record.player_url);
            }
            publication(&instance_id)?.map(|record| record.player_url).ok_or("This instance has no shared releases.".into())
        }).await.map_err(|_| "The release history lookup stopped unexpectedly.")??
    };
    tauri::async_runtime::spawn_blocking(move || {
        let link = crate::workspace_player::PlayerLink::parse(&link)?;
        let mut client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none());
        if link.base.starts_with("http://") {
            client = client.no_proxy();
        }
        let response = client
            .build()
            .map_err(|_| "Could not open the sharing service.")?
            .get(format!(
                "{}/v1/workspace-packs/{}/releases",
                link.base, link.code
            ))
            .send()
            .and_then(|response| response.error_for_status())
            .map_err(|_| "Couldn’t load the release history. Try again.")?;
        let mut bytes = Vec::new();
        const LIMIT: u64 = 8 * 1024 * 1024;
        response
            .take(LIMIT + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Couldn’t finish loading release history.")?;
        if bytes.len() as u64 > LIMIT {
            return Err("The release history is too large to display.".into());
        }
        serde_json::from_slice(&bytes).map_err(|_| "The release history is unreadable.".into())
    })
    .await
    .map_err(|_| "The release history lookup stopped unexpectedly.")?
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseSummary {
    revision: u64,
    required: bool,
    minimum_playable_revision: u64,
    created_at: String,
    release_note: String,
    creator: String,
}

#[tauri::command]
pub(crate) async fn get_pack_publisher(
    instance_id: Option<String>,
) -> Result<Option<Publisher>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let service = Service::configured()?;
        let Some((id, name)) = service.account()? else {
            return Ok(None);
        };
        let terms_accepted = read_record::<bool>(&service.accepted(&id)?)?.unwrap_or(false);
        let (can_publish, can_require, can_edit) = if let Some(instance_id) = instance_id {
            crate::instance_actions::validate_id(&instance_id)?;
            let dir = service.storage()?.join("instances").join(instance_id);
            if let Some((_, permission)) = access::collaboration(&service, &dir)? {
                (permission.can_publish, permission.can_require, true)
            } else {
                let owner = match read_record::<Intent>(&dir.join("intent.json"))? {
                Some(intent) => intent.publisher_id == id,
                None => !dir
                    .join("receipt.json")
                    .try_exists()
                    .map_err(|_| "Could not check the publisher record.")?,
                };
                (owner, owner, owner)
            }
        } else {
            (true, true, true)
        };
        Ok(Some(Publisher {
            id,
            name,
            terms_accepted,
            can_publish,
            can_require,
            can_edit,
        }))
    })
    .await
    .map_err(|_| "The publisher lookup stopped unexpectedly.")?
}

fn append_release(
    service: &Service,
    instance_id: &str,
    publisher_id: &str,
    note: &str,
    manifest: Value,
    base: u64,
    required: bool,
) -> Result<Publication, String> {
    let dir = access::path(service, instance_id)?;
    let collaboration = access::collaboration_link(service, &dir)?;
    let (code, manifest) = if let Some((link, grant)) = &collaboration {
        if !grant.can_publish || (required && !grant.can_require) {
            return Err("Your account cannot publish this release.".into());
        }
        let working_base = crate::workspace_install::working_copy_base(instance_id, link)?;
        (link.code.clone(), drafts::retain_working_copy_base(base, &working_base, manifest)?)
    } else {
        let cached: Publication = read_record(&dir.join("receipt.json"))?
            .ok_or("Create the shared pack before publishing an update.")?;
        let owner: Intent = read_record(&dir.join("intent.json"))?
            .ok_or("The original publisher record is missing.")?;
        if owner.publisher_id != publisher_id {
            return Err("Switch to the original publisher account.".into());
        }
        (cached.code, manifest)
    };
    let mut body = json!({ "publisherId": publisher_id, "termsVersion": TERMS_VERSION, "releaseNote": note,
        "manifest": manifest, "baseRevision": base, "required": required });
    // The same reviewed update has the same idempotency key across crashes and restarts.
    let mut digest = Sha256::new();
    digest.update(code.as_bytes());
    digest.update(serde_json::to_vec(&body).map_err(|_| "The release could not be prepared.")?);
    let mut key = [0; 16];
    key.copy_from_slice(&digest.finalize()[..16]);
    body["publicationId"] = json!(Uuid::from_bytes(key));
    let route = format!("/v1/workspace-packs/{code}/releases");
    let response = service.request(publisher_id, &route, Some(&body))?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            403 => "Your account cannot publish this release.",
            409 => "stale_base",
            422 => "stale_review",
            _ => response_message(response.status()),
        }
        .into());
    }
    let receipt = service.receipt(response)?;
    if base.checked_add(1) != Some(receipt.revision) {
        return Err("The sharing service returned an unexpected release version.".into());
    }
    if collaboration.is_some() {
        record_once(&service.accepted(publisher_id)?, &true)?;
        Ok(receipt)
    } else {
        finish(service, &dir, publisher_id, &receipt)
    }
}

#[tauri::command]
pub(crate) async fn publish_workspace_release(
    instance_id: String,
    review_token: String,
    excluded_folders: Vec<String>,
    excluded_local_files: Option<Vec<crate::pack_compatibility::ExcludedLocalFile>>,
    release_note: String,
    accepted_terms: bool,
    publisher_id: String,
    base_revision: Option<u64>,
    required: Option<bool>,
) -> Result<Publication, PublishError> {
    crate::instance_actions::validate_id(&instance_id)?;
    // A previous successful POST is authoritative even if the local files have
    // since changed. Recover its receipt before asking for a fresh snapshot.
    let base = base_revision.unwrap_or(0);
    let required = required.unwrap_or(false);
    if base == 0 {
        if let Some(receipt) = get_workspace_publication(instance_id.clone(), None).await? {
            return Ok(receipt);
        }
    }
    let review = crate::pack_compatibility::check_pack_compatibility(
        instance_id.clone(),
        excluded_local_files,
    )
    .await?;
    let manifest = review
        .reviewed_manifest(&review_token, &excluded_folders)
        .ok_or_else(|| "stale_review".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Publication, String> {
        let service = Service::configured()?;
        if service.account()?.map(|a| a.0).as_deref() != Some(&publisher_id) {
            return Err("signed_out".into());
        }
        if !accepted_terms
            && !read_record::<bool>(&service.accepted(&publisher_id)?)?.unwrap_or(false)
        {
            return Err("Accept the sharing terms before publishing.".into());
        }
        let note = release_note.trim();
        if note.chars().count() > 1000 {
            return Err("Keep the release note to 1,000 characters.".into());
        }
        if required && note.is_empty() {
            return Err("Add a release note for this required update.".into());
        }
        let dir = service.storage()?.join("instances").join(&instance_id);
        let _guard = lock_file(&dir.join("publish.lock"))?;
        if base != 0 {
            return append_release(
                &service,
                &instance_id,
                &publisher_id,
                note,
                manifest,
                base,
                required,
            );
        }
        if access::binding_exists(&dir)? {
            return Err("This working copy belongs to an existing pack. Review its latest version.".into());
        }
        if let Some(receipt) = read_record(&dir.join("receipt.json"))? {
            return Ok(receipt);
        }
        let intent_path = dir.join("intent.json");
        let first_attempt = read_record::<Intent>(&intent_path)?.is_none();
        let intent = record_once(
            &intent_path,
            &Intent {
                publisher_id: publisher_id.clone(),
                publication_id: Uuid::new_v4(),
            },
        )?;
        if intent.publisher_id != publisher_id {
            return Err("Sign in with the original publisher to continue.".into());
        }
        let body = json!({ "publicationId": intent.publication_id, "publisherId": publisher_id,
            "termsVersion": TERMS_VERSION, "releaseNote": note, "manifest": manifest });
        let response = match service.request(&publisher_id, "/v1/workspace-packs", Some(&body)) {
            Ok(response) => response,
            Err(error) => {
                if error != UNCONFIRMED_REQUEST {
                    release_rejected_intent(&intent_path, first_attempt, 401, None)?;
                }
                return Err(error);
            }
        };
        let status = response.status();
        if !status.is_success() {
            if status == reqwest::StatusCode::CONFLICT {
                if let Some(receipt) = recover(&service, &dir, &intent)? {
                    return Ok(receipt);
                }
            }
            let problem = response.json::<Value>().ok();
            release_rejected_intent(
                &intent_path,
                first_attempt,
                status.as_u16(),
                problem.as_ref().and_then(|p| p["error"].as_str()),
            )?;
            return Err(if status == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
                "stale_review"
            } else {
                response_message(status)
            }
            .into());
        }
        let receipt = service.receipt(response)?;
        finish(&service, &dir, &publisher_id, &receipt)
    })
    .await
    .map_err(|_| {
        PublishError::from(
            "The publication task stopped unexpectedly. Retry to recover the result.".to_owned(),
        )
    })?
    .and_then(Publication::for_display)
    .map_err(PublishError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_old_creator_receipt_advances_atomically_without_reverting_to_a_stale_version() {
        let root = std::env::temp_dir().join(format!("delight-revision-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("receipt.json");
        fs::write(&path, br#"{"code":"ABCD2345","playerUrl":"https://example.com/p/ABCD2345","revision":1,"releaseNote":"First release"}"#).unwrap();
        let first: Publication = read_record(&path).unwrap().unwrap();
        assert!(!first.required);
        assert_eq!(first.minimum_playable_revision, 1);
        let mut second = first.clone();
        second.revision = 2;
        second.minimum_playable_revision = 2;
        second.required = true;
        save_head(&root, &second).unwrap();
        assert_eq!(save_head(&root, &first).unwrap().revision, 2);
        let mut foreign = second;
        foreign.code = "ABCD6789".into();
        assert!(save_head(&root, &foreign).is_err());
        assert_eq!(
            read_record::<Publication>(&path)
                .unwrap()
                .unwrap()
                .minimum_playable_revision,
            2
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_and_restarted_requests_use_one_durable_key() {
        let root = std::env::temp_dir().join(format!("delight-publication-{}", Uuid::new_v4()));
        let path = root.join("instance").join("intent.json");
        let gate = std::sync::Barrier::new(8);
        std::thread::scope(|s| {
            let attempts: Vec<_> = (0..8)
                .map(|_| {
                    s.spawn(|| {
                        gate.wait();
                        record_once(
                            &path,
                            &Intent {
                                publisher_id: "creator".into(),
                                publication_id: Uuid::new_v4(),
                            },
                        )
                        .unwrap()
                        .publication_id
                    })
                })
                .collect();
            let results: Vec<_> = attempts.into_iter().map(|a| a.join().unwrap()).collect();
            let restored: Intent = read_record(&path).unwrap().unwrap();
            assert!(results.iter().all(|id| *id == restored.publication_id));
            assert_eq!(restored.publisher_id, "creator");
        });
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_definitively_rejected_first_attempts_release_the_publisher() {
        let root = std::env::temp_dir().join(format!("delight-intent-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("intent.json");
        fs::write(&path, "original").unwrap();
        release_rejected_intent(&path, true, 503, Some("publication_unavailable")).unwrap();
        release_rejected_intent(&path, false, 422, Some("pack_runtime_changed")).unwrap();
        release_rejected_intent(&path, true, 409, Some("publication_changed")).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        release_rejected_intent(&path, true, 422, Some("pack_runtime_changed")).unwrap();
        assert!(!path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unreadable_existing_receipt_cannot_be_replaced() {
        let root = std::env::temp_dir().join(format!("delight-receipt-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("receipt.json");
        fs::write(&path, "corrupted").unwrap();
        assert!(record_once(&path, &true).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "corrupted");
        fs::remove_dir_all(root).unwrap();
    }
}
