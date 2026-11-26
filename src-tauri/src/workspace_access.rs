use super::*;
use crate::workspace_player::PlayerLink;
use reqwest::{blocking::Response, StatusCode};

#[derive(Serialize, Deserialize)]
struct Binding {
    account: String,
    player_url: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Permission {
    role: Option<String>,
    pub(super) can_publish: bool,
    pub(super) can_require: bool,
}

fn account(service: &Service) -> Result<String, String> {
    service
        .account()?
        .map(|a| a.0)
        .ok_or_else(|| "Connect your Delight account to continue.".into())
}

fn response<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    let status = response.status();
    let mut bytes = Vec::new();
    response
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Couldn't read the sharing service response.")?;
    if bytes.len() > 1024 * 1024 {
        return Err("The sharing service response was too large.".into());
    }
    if status.is_success() {
        return serde_json::from_slice(&bytes)
            .map_err(|_| "The sharing service returned an unreadable response.".into());
    }
    let error: Value = serde_json::from_slice(&bytes).unwrap_or_default();
    Err(match error["error"].as_str().unwrap_or_default() {
        "invite_unavailable" => "This invitation has expired, was revoked, or is invalid.",
        "invite_exhausted" => "This invitation has reached its use limit.",
        "invite_needs_replacement" => "Ask the pack owner for a new invitation.",
        "invite_limit" => "This pack has 50 active links. Revoke one before creating another.",
        "sharing_paused" => "The pack owner has paused sharing.",
        "collaborator_limit" => "This pack has reached its collaborator limit.",
        "not_pack_owner" => "Only the pack owner can manage access.",
        "editor_not_found" => "This editor no longer has access. Refresh the list.",
        _ if status == StatusCode::UNAUTHORIZED => "Connect your Delight account to continue.",
        _ => "Couldn't update pack access. Try again.",
    }
    .into())
}

pub(super) fn path(service: &Service, id: &str) -> Result<PathBuf, String> {
    crate::instance_actions::validate_id(id)?;
    Ok(service.storage()?.join("instances").join(id))
}

pub(super) fn binding_exists(dir: &Path) -> Result<bool, String> {
    Ok(read_record::<Binding>(&dir.join("collaborator.json"))?.is_some())
}

pub(super) fn access(service: &Service, user: &str, code: &str) -> Result<Permission, String> {
    response(service.request(user, &format!("/v1/workspace-packs/{code}/access"), None)?)
}

fn linked_release(link: &PlayerLink) -> Result<Publication, String> {
    let head = link.fetch()?;
    Ok(Publication {
        code: head.code,
        player_url: head.url,
        revision: head.revision,
        release_note: head.release_note,
        required: head.required,
        minimum_playable_revision: head.minimum_playable_revision,
    })
}

pub(super) fn collaboration(
    service: &Service,
    dir: &Path,
) -> Result<Option<(Publication, Permission)>, String> {
    let Some((link, permission)) = collaboration_link(service, dir)? else {
        return Ok(None);
    };
    Ok(Some((linked_release(&link)?, permission)))
}

pub(super) fn collaboration_link(
    service: &Service,
    dir: &Path,
) -> Result<Option<(PlayerLink, Permission)>, String> {
    let Some(binding) = read_record::<Binding>(&dir.join("collaborator.json"))? else {
        return Ok(None);
    };
    let user = account(service)?;
    if binding.account != user {
        return Err("Switch to the Delight account linked to this working copy.".into());
    }
    let link = crate::workspace_player::PlayerLink::parse(&binding.player_url)?;
    let permission = access(service, &user, &link.code)?;
    if permission.role.as_deref() != Some("edit") {
        return Err("Your editor access to this pack was removed.".into());
    }
    Ok(Some((link, permission)))
}

async fn run<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "The access request stopped. Try again.".to_owned())?
}

#[tauri::command]
pub(crate) async fn workspace_manage_access(
    instance_id: String,
    action: Option<Value>,
) -> Result<Value, String> {
    run(move || {
        let service = Service::configured()?;
        let user = account(&service)?;
        let publication =
            publication(&instance_id)?.ok_or("Publish this pack before managing access.")?;
        let route = format!("/v1/workspace-packs/{}/access", publication.code);
        let mut result: Value = response(service.request(&user, &route, action.as_ref())?)?;
        if action.as_ref().is_some_and(|value| value["action"] == "create") {
            let token = invite_token(&service, result["url"].as_str().unwrap_or_default())?;
            result["url"] = Value::String(if service.base.starts_with("http://") {
                format!("delight://invite/{token}")
            } else {
                format!("{}/share/invite#{token}", service.base)
            });
        }
        Ok(result)
    })
    .await
}

pub(crate) fn is_invite_uri(url: &url::Url) -> bool {
    url.as_str()
        .strip_prefix("delight://invite/")
        .is_some_and(valid_token)
}

fn valid_token(token: &str) -> bool {
    token.len() == 43
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn invite_token<'a>(service: &Service, link: &'a str) -> Result<&'a str, String> {
    let link = link.trim();
    link.strip_prefix("delight://invite/")
        .or_else(|| {
            let path = link.strip_prefix(&service.base)?;
            path.strip_prefix("/share/invite#").or_else(|| path.strip_prefix("/invite/"))
        })
        .filter(|token| valid_token(token))
        .ok_or_else(|| "Paste a valid Delight pack invitation.".into())
}

#[cfg(test)]
mod link_tests {
    use super::*;

    #[test]
    fn invitation_accepts_the_configured_fragment_and_legacy_links() {
        let service = Service {
            base: PRODUCTION.into(),
            #[cfg(debug_assertions)]
            development: false,
        };
        let token = "A".repeat(43);
        for url in [
            format!("{PRODUCTION}/share/invite#{token}"),
            format!("{PRODUCTION}/invite/{token}"),
            format!("delight://invite/{token}"),
        ] {
            assert_eq!(invite_token(&service, &url).unwrap(), token);
        }
        for url in [
            format!("https://example.com/share/invite#{token}"),
            format!("{PRODUCTION}/share/invite?token={token}"),
            format!("{PRODUCTION}/share/invite#{token}/pasted"),
            format!("http://127.0.0.1:19471/share/invite#{token}"),
        ] {
            assert!(invite_token(&service, &url).is_err());
        }
    }
}

#[tauri::command]
pub(crate) async fn workspace_invitation(link: String, accept: bool) -> Result<Value, String> {
    run(move || {
        let service = Service::configured()?;
        let token = invite_token(&service, &link)?;
        let route = "/v1/workspace-invites";
        let mut value: Value = if accept {
            response(service.request(
                &account(&service)?,
                route,
                Some(&json!({"action":"accept","token":token})),
            )?)?
        } else {
            let mut client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none());
            if service.base.starts_with("http://") {
                client = client.no_proxy();
            }
            response(
                client
                    .build()
                    .map_err(|_| "Couldn't open the sharing service.")?
                    .post(format!("{}{route}", service.base))
                    .json(&json!({"action":"preview","token":token}))
                    .send()
                    .map_err(|_| "Couldn't reach the sharing service.")?,
            )?
        };
        let player = crate::workspace_player::PlayerLink::parse(
            value["playerUrl"].as_str().unwrap_or_default(),
        )?;
        value["playerUrl"] = Value::String(player.display_url());
        Ok(value)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Collaboration {
    publication: Publication,
    can_publish: bool,
    working_base_revision: u64,
}

#[tauri::command]
pub(crate) async fn get_workspace_collaboration(
    instance_id: String,
) -> Result<Option<Collaboration>, String> {
    run(move || {
        let service = Service::configured()?;
        let Some((link, permission)) = collaboration_link(&service, &path(&service, &instance_id)?)?
        else {
            return Ok(None);
        };
        let working_base_revision = crate::workspace_install::working_copy_base(&instance_id, &link)?.revision;
        Ok(Some(Collaboration {
            publication: linked_release(&link)?.for_display()?,
            can_publish: permission.can_publish,
            working_base_revision,
        }))
    })
    .await
}

#[tauri::command]
pub(crate) async fn workspace_can_edit(player_url: String) -> Result<bool, String> {
    run(move || {
        let service = Service::configured()?;
        let Some((user, _)) = service.account()? else {
            return Ok(false);
        };
        let link = crate::workspace_player::PlayerLink::parse(&player_url)?;
        Ok(access(&service, &user, &link.code)?.role.as_deref() == Some("edit"))
    })
    .await
}

pub(super) fn bind(
    service: &Service,
    user: &str,
    instance_id: &str,
    player_url: &str,
) -> Result<(), String> {
    let dir = path(service, instance_id)?;
    let _guard = lock_file(&dir.join("publish.lock"))?;
    if read_record::<Intent>(&dir.join("intent.json"))?.is_some()
        || read_record::<Publication>(&dir.join("receipt.json"))?.is_some()
    {
        return Err("That instance already belongs to a shared pack.".into());
    }
    let saved = record_once(
        &dir.join("collaborator.json"),
        &Binding {
            account: user.to_owned(),
            player_url: player_url.to_owned(),
        },
    )?;
    if saved.account != user || saved.player_url != player_url {
        return Err("That instance already belongs to another collaboration.".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn create_workspace_working_copy(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::LauncherState>,
    player_url: String,
    revision: Option<u64>,
) -> Result<String, String> {
    let active = state.launch_active.clone();
    let cancel = state.cancel_requested.clone();
    run(move || {
        let service = Service::configured()?;
        let user = account(&service)?;
        let link = crate::workspace_player::PlayerLink::parse(&player_url)?;
        let url = link.url();
        let authorize = || -> Result<(), String> {
            if access(&service, &user, &link.code)?.role.as_deref() != Some("edit") {
                return Err("This account doesn't have editor access.".into());
            }
            Ok(())
        };
        authorize()?;
        // Keep the existing library ID for the original working copy. Opening a
        // different base explicitly creates a separate copy, preserving local work.
        let identity = match revision {
            Some(revision) => serde_json::to_vec(&(&user, &url, revision)),
            None => serde_json::to_vec(&(&user, &url)),
        }.map_err(|e| e.to_string())?;
        let id = format!("-edit-{:x}", Sha256::digest(identity));
        crate::workspace_install::working_copy(&app, &link, &id, revision, active, &cancel, || {
            authorize()?;
            bind(&service, &user, &id, &url)
        })?;
        Ok(id)
    })
    .await
}
