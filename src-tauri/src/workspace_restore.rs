use super::{
    access, finish, lock_file, publication, read_record, response_message, valid_pack_code, Intent,
    Publication, PublishError, Service, TERMS_VERSION,
};
use serde_json::{json, Value};
use std::io::Read;
use uuid::Uuid;

fn restore_error(response: reqwest::blocking::Response) -> PublishError {
    let status = response.status();
    let mut bytes = Vec::new();
    let _ = response.take(8 * 1024).read_to_end(&mut bytes);
    let problem: Value = serde_json::from_slice(&bytes).unwrap_or_default();
    match problem["error"].as_str().unwrap_or_default() {
        "stale_base_revision" => "stale_base".to_owned().into(),
        "restore_forbidden" => "Only the pack owner can restore a release."
            .to_owned()
            .into(),
        "release_not_found" => "That release is no longer available.".to_owned().into(),
        "publication_changed" => "This restore review changed. Open it again before publishing."
            .to_owned()
            .into(),
        "source_check_unavailable" => "Couldn’t verify this release’s file sources. Try again."
            .to_owned()
            .into(),
        _ if status.as_u16() == 422 => PublishError {
            code: "stale_review",
            message: "A file or runtime required by this release is no longer available."
                .to_owned(),
        },
        _ => response_message(status).to_owned().into(),
    }
}

#[tauri::command]
pub(crate) async fn restore_workspace_release(
    instance_id: String,
    source_revision: u64,
    base_revision: u64,
    release_note: String,
    required: bool,
    request_id: Uuid,
    accepted_terms: Option<bool>,
) -> Result<Publication, PublishError> {
    tauri::async_runtime::spawn_blocking(move || {
        if source_revision == 0 || source_revision >= base_revision || base_revision >= (1 << 53) - 1 {
            return Err("Choose an earlier release to restore.".to_owned().into());
        }
        let note = release_note.trim();
        if note.chars().count() > 1000 || (required && note.is_empty()) {
            return Err("Add a reason for requiring this update using 1,000 characters or fewer."
                .to_owned()
                .into());
        }
        let service = Service::configured()?;
        let directory = access::path(&service, &instance_id)?;
        let owner = service
            .account()?
            .map(|(account, _)| account)
            .ok_or_else(|| "signed_out".to_owned())?;
        let Some(intent) = read_record::<Intent>(&directory.join("intent.json"))? else {
            return Err("Only the pack owner can restore a release.".to_owned().into());
        };
        if intent.publisher_id != owner {
            return Err("Only the pack owner can restore a release.".to_owned().into());
        }
        if !accepted_terms.unwrap_or_default()
            && !read_record::<bool>(&service.accepted(&owner)?)?.unwrap_or_default()
        {
            return Err("Accept the sharing terms before publishing.".to_owned().into());
        }
        let pack = publication(&instance_id)?
            .filter(|record| valid_pack_code(&record.code))
            .ok_or_else(|| "This instance has no shared releases.".to_owned())?;
        let response = service.request(
            &owner,
            &format!("/v1/workspace-packs/{}/restore", pack.code),
            Some(&json!({
                "publicationId": request_id, "sourceRevision": source_revision, "baseRevision": base_revision,
                "required": required, "releaseNote": note, "termsVersion": TERMS_VERSION,
            })),
        )?;
        if !response.status().is_success() {
            return Err(restore_error(response));
        }
        let receipt = service.receipt(response)?;
        if receipt.code != pack.code || receipt.revision != base_revision + 1 {
            return Err("The sharing service returned a different restore receipt."
                .to_owned()
                .into());
        }
        // The service has committed this review. Preserve a newer local receipt
        // if a separate publication finished while this request was in flight.
        let _lock = lock_file(&directory.join("publish.lock"))?;
        finish(&service, &directory, &owner, &receipt)?;
        receipt.for_display().map_err(PublishError::from)
    })
    .await
    .map_err(|_| {
        PublishError::from(
            "The restore request stopped. Retry this review to recover the result.".to_owned(),
        )
    })?
}
