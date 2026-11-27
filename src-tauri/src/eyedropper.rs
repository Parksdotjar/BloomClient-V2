#[tauri::command]
pub(crate) async fn capture_picker_view(window: tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(windows)]
    {
        use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};
        let (send, receive) = tokio::sync::oneshot::channel();
        window.with_webview(move |view| unsafe {
            let Ok(core) = view.controller().CoreWebView2() else { return };
            let method = CoTaskMemPWSTR::from("Page.captureScreenshot");
            let args = CoTaskMemPWSTR::from(r#"{"format":"png","captureBeyondViewport":false}"#);
            let callback = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, json| {
                let result = status.map_err(|e| e.to_string()).and_then(|_| {
                    #[derive(serde::Deserialize)]
                    struct Capture { data: String }
                    serde_json::from_str::<Capture>(&json).map(|c| c.data).map_err(|e| e.to_string())
                });
                let _ = send.send(result);
                Ok(())
            }));
            let _ = core.CallDevToolsProtocolMethod(*method.as_ref().as_pcwstr(), *args.as_ref().as_pcwstr(), &callback);
        }).map_err(|e| e.to_string())?;
        return tokio::time::timeout(std::time::Duration::from_secs(8), receive).await
            .map_err(|_| "The color sample timed out.")?
            .map_err(|_| "Could not capture the launcher for color sampling.")?;
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err("Launcher capture is unavailable.".into())
    }
}
