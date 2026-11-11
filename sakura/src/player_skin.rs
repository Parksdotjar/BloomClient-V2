//! Account skin download is independent of joining and never runs in a frame.
use crate::shared::{PlayerSkin, SceneSnapshot};
use std::sync::{Arc, Mutex};

pub fn start(token: String, scene: Arc<Mutex<SceneSnapshot>>) {
    tokio::spawn(async move {
        let Ok(client) = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(8)).build() else { return };
        let Ok(profile) = azalea_auth::get_profile(&client, &token).await else { return };
        drop(token);
        let Some(skin) = profile.skins.iter().find(|s| s["state"] == "ACTIVE") else { return };
        let Some(address) = skin["url"].as_str() else { return };
        let Ok(mut url) = reqwest::Url::parse(address) else { return };
        if url.host_str() != Some("textures.minecraft.net") || !url.username().is_empty()
            || url.password().is_some() || url.port().is_some()
            || !matches!(url.scheme(), "http" | "https") { return; }
        let _ = url.set_scheme("https");
        let Ok(response) = client.get(url).send().await else { return };
        let Ok(mut response) = response.error_for_status() else { return };
        let mut bytes = Vec::new();
        while let Ok(Some(chunk)) = response.chunk().await {
            if bytes.len() + chunk.len() > 256 * 1024 { return; }
            bytes.extend_from_slice(&chunk);
        }
        let Ok(reader) = image::ImageReader::new(std::io::Cursor::new(&bytes)).with_guessed_format() else { return };
        if reader.into_dimensions().ok() != Some((64,64)) { return; }
        let Ok(image) = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png) else { return };
        let data = Arc::new(PlayerSkin { rgba: image.into_rgba8().into_raw(), slim: skin["variant"] == "SLIM" });
        if let Ok(mut scene) = scene.lock() { scene.local_skin = Some(data); }
    });
}
