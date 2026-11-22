use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{Read, Write},
    sync::Mutex,
};
use uuid::Uuid;

const MAX_BYTES: u64 = 24 * 1024 * 1024;
const RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
static HISTORY_IO: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Thread {
    id: Uuid,
    updated: u64,
    messages: Vec<Message>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    id: Uuid,
    at: u64,
    role: MessageRole,
    text: String,
    status: MessageStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    help_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pack: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    choices: Option<Vec<String>>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum MessageRole {
    Question,
    Answer,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum MessageStatus {
    Ready,
    Pending,
    Failed,
    Clarify,
    Unsupported,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct History {
    version: u8,
    save: bool,
    selected: Option<Uuid>,
    threads: Vec<Thread>,
}

impl Default for History {
    fn default() -> Self {
        Self {
            version: 1,
            save: true,
            selected: None,
            threads: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Edit {
    Select { id: Option<Uuid> },
    SaveThread { thread: Thread, select: bool },
    Delete { id: Uuid },
    Clear,
    SetSaving { save: bool },
}

fn scope() -> Result<String, String> {
    let minecraft = super::ensure_account_store()?.active_id;
    let minecraft = minecraft
        .as_deref()
        .map(|id| Uuid::parse_str(id).map(|id| id.simple().to_string()))
        .transpose()
        .map_err(|_| "Could not identify the launcher account.")?;
    Ok(format!(
        "{}-{}",
        minecraft.as_deref().unwrap_or("guest"),
        super::social::ask_delight_profile()
            .as_deref()
            .unwrap_or("guest")
    ))
}

#[tauri::command]
pub async fn ask_delight_scope() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(scope)
        .await
        .map_err(|_| "Could not identify the launcher account.")?
}

fn history_at(
    path: &std::path::Path,
    edit: Option<Edit>,
    now: u64,
) -> Result<Option<History>, String> {
    let fail = || "Alula could not access local chat history.".to_string();
    let mut history: History = match fs::File::open(path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| fail())?;
            if bytes.len() as u64 > MAX_BYTES {
                return Err(fail());
            }
            serde_json::from_slice(&bytes).map_err(|_| fail())?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => History::default(),
        Err(_) => return Err(fail()),
    };
    if history.version != 1 {
        return Err(fail());
    }
    let previous_count = history.threads.len();
    let reading = edit.is_none();
    match edit {
        Some(Edit::Select { id }) if history.save => history.selected = id,
        Some(Edit::SaveThread { mut thread, select }) if history.save => {
            if thread.messages.len() > 60
                || serde_json::to_vec(&thread).map_err(|_| fail())?.len() > 350_000
            {
                return Err(fail());
            }
            if select {
                history.selected = Some(thread.id);
            }
            thread.updated = now;
            history.threads.retain(|item| item.id != thread.id);
            history.threads.push(thread);
        }
        Some(Edit::Delete { id }) => history.threads.retain(|item| item.id != id),
        Some(Edit::Clear) => history.threads.clear(),
        Some(Edit::SetSaving { save }) => history.save = save,
        _ => {}
    }
    history
        .threads
        .retain(|item| now.saturating_sub(item.updated) < RETENTION_MS);
    history
        .threads
        .sort_by_key(|item| std::cmp::Reverse(item.updated));
    history.threads.truncate(50);
    if history
        .selected
        .is_some_and(|id| !history.threads.iter().any(|item| item.id == id))
    {
        history.selected = None;
    }
    if !reading || history.threads.len() != previous_count {
        fs::create_dir_all(path.parent().ok_or_else(fail)?).map_err(|_| fail())?;
        let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
        let result = (|| {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(&serde_json::to_vec(&history)?)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary);
            return Err(fail());
        }
    }
    if reading {
        Ok(Some(history))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn ask_delight_history(
    account: String,
    edit: Option<Edit>,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let fail = || "Alula could not access local chat history.".to_string();
        let _guard = HISTORY_IO.lock().map_err(|_| fail())?;
        if scope()? != account {
            return Err("The launcher account changed.".into());
        }
        let root = super::bloom_data_dir()?.join("ask-delight");
        let path = root.join(format!("{account}.json"));
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| fail())?
            .as_millis() as u64;
        history_at(&path, edit, now)?
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| fail())
    })
    .await
    .map_err(|_| "Alula chat history is unavailable.")?
}

#[tauri::command]
pub async fn ask_delight_remote(account: String, body: Option<Value>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if scope()? != account {
            return Err("account_changed".into());
        }
        super::social::ask_delight_request(&account, body)
    })
    .await
    .map_err(|_| "offline")?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_restores_selection_and_isolates_accounts_and_session_chats() {
        let root = std::env::temp_dir().join(format!("ask-delight-{}", Uuid::new_v4()));
        let account = root.join("account-a.json");
        let other = root.join("account-b.json");
        let guest = root.join("guest-guest.json");
        let id = Uuid::new_v4();
        let now = RETENTION_MS * 2;
        let thread = || Thread {
            id,
            updated: 0,
            messages: vec![Message {
                id: Uuid::new_v4(),
                at: now,
                role: MessageRole::Answer,
                text: "Private question".into(),
                status: MessageStatus::Ready,
                action: Some("old-screen".into()),
                instance_id: None,
                choices: None,
                help_ids: None,
                pack: None,
            }],
        };
        history_at(
            &account,
            Some(Edit::SaveThread {
                thread: thread(),
                select: true,
            }),
            now,
        )
        .unwrap();
        history_at(&account, Some(Edit::SetSaving { save: false }), now).unwrap();
        history_at(
            &account,
            Some(Edit::SaveThread {
                thread: Thread {
                    id: Uuid::new_v4(),
                    ..thread()
                },
                select: true,
            }),
            now,
        )
        .unwrap();
        let restored = history_at(&account, None, now).unwrap().unwrap();
        assert_eq!(restored.selected, Some(id));
        assert_eq!(restored.threads.len(), 1);
        assert_eq!(restored.threads[0].messages[0].text, "Private question");
        assert_eq!(
            restored.threads[0].messages[0].action.as_deref(),
            Some("old-screen")
        );
        for path in [&other, &guest] {
            assert!(history_at(path, None, now)
                .unwrap()
                .unwrap()
                .threads
                .is_empty());
        }
        history_at(&account, Some(Edit::Clear), now).unwrap();
        assert!(history_at(&account, None, now)
            .unwrap()
            .unwrap()
            .threads
            .is_empty());
        let _ = fs::remove_file(account);
        let _ = fs::remove_dir(root);
    }
}
