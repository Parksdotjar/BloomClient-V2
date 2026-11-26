use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub(crate) struct PendingLinks(Mutex<Vec<String>>);

#[tauri::command]
pub(crate) fn take_workspace_player_links(pending: State<'_, PendingLinks>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap_or_else(|e| e.into_inner()))
}

#[cfg(desktop)]
pub(crate) fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn enqueue(app: &AppHandle, urls: Vec<url::Url>) {
    let state = app.state::<PendingLinks>();
    let mut pending = state.0.lock().unwrap_or_else(|e| e.into_inner());
    for url in urls.iter().filter(|url| crate::workspace_player::is_player_uri(url)
        || crate::workspace_publication::access::is_invite_uri(url)) {
        if !pending.iter().any(|queued| queued == url.as_str()) {
            if pending.len() == 16 {
                pending.remove(0);
            }
            pending.push(url.to_string());
        }
    }
    if !pending.is_empty() {
        drop(pending);
        show_main_window(app);
        let _ = app.emit_to("main", "workspace-player-link", ());
    }
}

#[cfg(desktop)]
pub(crate) fn listen(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_deep_link::DeepLinkExt;
    let handle = app.clone();
    app.deep_link().on_open_url(move |event| enqueue(&handle, event.urls()));
    if let Some(urls) = app.deep_link().get_current()? {
        enqueue(app, urls);
    }
    Ok(())
}
