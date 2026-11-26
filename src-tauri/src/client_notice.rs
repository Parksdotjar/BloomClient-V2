use serde::{Deserialize, Serialize};
use std::time::Duration;

const FEED_URL: &str = "https://delightproductions.org/v1/content/client-notice";
const MAX_FEED_BYTES: usize = 8_192;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientNotice {
    id: String,
    message: String,
    created_at: u64,
    expires_at: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientNoticeFeed {
    #[serde(deserialize_with = "Option::deserialize")]
    notice: Option<ClientNotice>,
    server_time: u64,
}

#[tauri::command]
pub(crate) async fn get_client_notice() -> Result<ClientNoticeFeed, String> {
    let mut response = crate::bloom_http_client()?
        .get(FEED_URL)
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(Duration::from_secs(6))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|_| "Client notice feed unavailable")?;
    if response.url().as_str() != FEED_URL {
        return Err("Unexpected client notice feed address".into());
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read client notice feed")?
    {
        if body.len().saturating_add(chunk.len()) > MAX_FEED_BYTES {
            return Err("Unexpected client notice feed size".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "Invalid client notice feed".into())
}
