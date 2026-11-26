use super::{access, finish, lock_file, publication, read_record, Service, TERMS_VERSION};
use crate::{pack_compatibility, workspace_install, workspace_player::PlayerLink};
use serde_json::{json, Value};
use std::{io::Read, path::PathBuf};
use uuid::Uuid;

struct DraftTarget {
    service: Service,
    account: String,
    directory: PathBuf,
    code: String,
    working_copy: Option<PlayerLink>,
}

impl DraftTarget {
    fn load(instance_id: &str) -> Result<Self, String> {
        let service = Service::configured()?;
        let directory = access::path(&service, instance_id)?;
        let account = service
            .account()?
            .map(|(account, _)| account)
            .ok_or("Connect your Delight account to use drafts.")?;
        let working_copy = access::collaboration_link(&service, &directory)?.map(|(link, _)| link);
        let code = if let Some(link) = &working_copy {
            link.code.clone()
        } else {
            publication(instance_id)?
                .ok_or("Create a shared pack before opening drafts.")?
                .code
        };
        if !super::valid_pack_code(&code) {
            return Err("This shared pack’s local record is invalid.".into());
        }
        Ok(Self {
            service,
            account,
            directory,
            code,
            working_copy,
        })
    }

    fn request(
        &self,
        id: Option<Uuid>,
        body: Option<&Value>,
    ) -> Result<reqwest::blocking::Response, String> {
        let mut route = format!("/v1/workspace-packs/{}/drafts", self.code);
        if let Some(id) = id {
            route.push_str(&format!("/{id}"));
        }
        self.service
            .request(&self.account, &route, body)
            .map_err(|error| {
                if error == "signed_out" {
                    "Connect your Delight account to use drafts.".into()
                } else {
                    error
                }
            })
    }
}

fn draft_error(code: &str, status: reqwest::StatusCode) -> &'static str {
    match code {
        "drafts_forbidden" => "Your account doesn’t have access to these drafts.",
        "draft_not_found" => "This draft is no longer available.",
        "draft_changed" => "This draft changed. Open the latest draft and review it again.",
        "draft_limit" => "This pack has reached its saved draft limit.",
        "invalid_draft" => "Check the draft and try again.",
        "invalid_draft_note" => "Keep the draft note to 1,000 characters.",
        "draft_author_removed" => "The draft’s author no longer has editor access.",
        "stale_base_revision" => "A newer release is available. Review your changes against it before submitting or publishing.",
        "required_update_needs_note" => "Add a reason for requiring this update.",
        "invalid_update_policy" => "Choose an update policy.",
        "sharing_terms_required" => "Accept the sharing terms before publishing.",
        "source_check_unavailable" => "Couldn’t verify a file source. Try again.",
        _ if status.as_u16() == 401 => "Connect your Delight account to use drafts.",
        _ if status.as_u16() == 403 => "Your account doesn’t have permission for this action.",
        _ if status.as_u16() == 413 => "This draft exceeds the sharing service’s file limit.",
        _ if status.as_u16() == 422 => "The sharing service couldn’t validate the draft’s files. Review them and try again.",
        _ if status.as_u16() == 429 => "Too many requests. Wait a moment and try again.",
        _ => "The sharing service couldn’t confirm this draft. Refresh and try again.",
    }
}

fn decode(response: reqwest::blocking::Response) -> Result<Value, String> {
    const RESPONSE_LIMIT: u64 = 2 * 1024 * 1024;
    let status = response.status();
    let mut bytes = Vec::new();
    response
        .take(RESPONSE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Couldn’t read the draft from the sharing service.")?;
    if bytes.len() as u64 > RESPONSE_LIMIT {
        return Err("The draft response is too large to display.".into());
    }
    if status.is_success() {
        return serde_json::from_slice(&bytes)
            .map_err(|_| "The sharing service returned an unreadable draft.".into());
    }
    let error: Value = serde_json::from_slice(&bytes).unwrap_or_default();
    Err(draft_error(error["error"].as_str().unwrap_or_default(), status).into())
}

async fn blocking(
    work: impl FnOnce() -> Result<Value, String> + Send + 'static,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "The draft request stopped. Try again.".to_owned())?
}

#[tauri::command]
pub(crate) async fn get_workspace_drafts(instance_id: String) -> Result<Value, String> {
    blocking(move || decode(DraftTarget::load(&instance_id)?.request(None, None)?)).await
}

#[tauri::command]
pub(crate) async fn get_workspace_draft(
    instance_id: String,
    draft_id: Uuid,
) -> Result<Value, String> {
    blocking(move || decode(DraftTarget::load(&instance_id)?.request(Some(draft_id), None)?)).await
}

#[tauri::command]
pub(crate) async fn save_workspace_draft(
    instance_id: String,
    review_token: String,
    excluded_folders: Vec<String>,
    excluded_local_files: Option<Vec<pack_compatibility::ExcludedLocalFile>>,
    base_revision: u64,
    note: String,
    draft_id: Option<Uuid>,
    version: Option<u64>,
) -> Result<Value, String> {
    let report =
        pack_compatibility::check_pack_compatibility(instance_id.clone(), excluded_local_files)
            .await?;
    let manifest = report
        .reviewed_manifest(&review_token, &excluded_folders)
        .ok_or("The local files changed. Check the contents again before saving.")?;
    blocking(move || {
        let target = DraftTarget::load(&instance_id)?;
        let link = target
            .working_copy
            .as_ref()
            .ok_or("Open an editor working copy to save a draft.")?;
        let base = workspace_install::working_copy_base(&instance_id, link)?;
        let manifest = retain_working_copy_base(base_revision, &base, manifest)?;
        let id = draft_id.unwrap_or_else(Uuid::new_v4);
        let mut body = json!({
            "action":"save", "id":id, "baseRevision":base_revision,
            "note":note.trim(), "manifest":manifest,
        });
        if let Some(version) = version {
            body["version"] = json!(version);
        }
        decode(target.request(None, Some(&body))?)
    })
    .await
}

// A local working-copy label is for the player's library, not the public pack.
pub(super) fn retain_working_copy_base(
    base_revision: u64,
    base: &crate::workspace_player::PlayerRelease,
    mut manifest: Value,
) -> Result<Value, String> {
    if base_revision != base.revision {
        return Err(format!(
            "This working copy starts at version {}. Open that version’s changes to continue.",
            base.revision
        ));
    }
    manifest["name"] = json!(&base.manifest.name);
    Ok(manifest)
}

#[tauri::command]
pub(crate) async fn change_workspace_draft(
    instance_id: String,
    draft_id: Uuid,
    version: u64,
    action: String,
    note: Option<String>,
    required: Option<bool>,
    release_note: Option<String>,
    accepted_terms: Option<bool>,
) -> Result<Value, String> {
    blocking(move || {
        let target = DraftTarget::load(&instance_id)?;
        let mut body = json!({"action":action,"id":draft_id,"version":version});
        match action.as_str() {
            "submit" | "withdraw" | "discard" => {}
            "return" => {
                body["reviewNote"] = json!(note.as_deref().unwrap_or_default().trim());
            }
            "publish" => {
                if !accepted_terms.unwrap_or(false)
                    && !read_record::<bool>(&target.service.accepted(&target.account)?)?
                        .unwrap_or(false)
                {
                    return Err("Accept the sharing terms before publishing.".into());
                }
                body["required"] = json!(required.unwrap_or(false));
                body["termsVersion"] = json!(TERMS_VERSION);
                if let Some(note) = release_note {
                    body["releaseNote"] = json!(note.trim());
                }
            }
            _ => return Err("Choose a valid draft action.".into()),
        }
        let response = target.request(None, Some(&body))?;
        if action != "publish" || !response.status().is_success() {
            return decode(response);
        }
        let receipt = target.service.receipt(response)?;
        if receipt.code != target.code {
            return Err("The review receipt belongs to a different pack.".into());
        }
        let _lock = lock_file(&target.directory.join("publish.lock"))?;
        finish(
            &target.service,
            &target.directory,
            &target.account,
            &receipt,
        )?;
        serde_json::to_value(receipt.for_display()?)
            .map_err(|_| "Couldn’t open the published draft.".into())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace_player::{PlayerManifest, PlayerRelease};

    #[test]
    fn retains_the_public_pack_name_and_requires_the_working_copy_base() {
        let base = PlayerRelease {
            code: "PACK2345".into(),
            url: "https://api.north.bloomclient.org/minecraft/p/PACK2345".into(),
            revision: 12,
            minimum_playable_revision: 1,
            required: false,
            creator: "Owner".into(),
            created_at: "2026-11-24T17:00:00Z".into(),
            release_note: String::new(),
            manifest: PlayerManifest {
                name: "Treetop build".into(),
                minecraft_version: "1.21.1".into(),
                loader: "fabric".into(),
                loader_version: "0.16.10".into(),
                excluded_folders: vec![],
                mod_dependency_policy: None,
                files: vec![],
            },
        };
        let proposed = json!({"name":"My local working copy","loaderVersion":"0.16.12"});
        let saved = retain_working_copy_base(12, &base, proposed.clone()).unwrap();
        assert_eq!(
            saved,
            json!({"name":"Treetop build","loaderVersion":"0.16.12"})
        );
        assert!(retain_working_copy_base(13, &base, proposed).is_err());
    }
}
