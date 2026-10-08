use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::PathBuf};

fn uuid(value: &str) -> Result<String, String> {
    let id = value.replace('-', "").to_lowercase();
    if id.len() != 32 || !id.bytes().all(|v| v.is_ascii_hexdigit()) {
        return Err("Invalid Minecraft account.".into());
    }
    Ok(id)
}
fn active(account: &str) -> Result<MinecraftSession, String> {
    let session = saved_session().ok_or("Sign in to Minecraft first.")?;
    if uuid(&session.uuid)? != uuid(account)? {
        return Err("The account changed. Open Locker again.".into());
    }
    Ok(session)
}

// Fixed endpoints only. Credentials remain native and are never sent to the webview.
async fn request(
    account: &str,
    method: reqwest::Method,
    endpoint: &str,
    body: Option<Value>,
    skin: Option<(Vec<u8>, String)>,
) -> Result<reqwest::Response, String> {
    let mut session = active(account)?;
    for attempt in 0..2 {
        active(account)?;
        let mut request = bloom_http_client()?
            .request(
                method.clone(),
                format!("https://api.minecraftservices.com/minecraft/profile{endpoint}"),
            )
            .bearer_auth(&session.access_token)
            .timeout(std::time::Duration::from_secs(20));
        if let Some(ref value) = body {
            request = request.json(value);
        }
        if let Some((ref bytes, ref variant)) = skin {
            let part = reqwest::multipart::Part::bytes(bytes.clone())
                .file_name("skin.png")
                .mime_str("image/png")
                .map_err(|_| "Invalid skin type")?;
            request = request.multipart(
                reqwest::multipart::Form::new()
                    .text("variant", variant.clone())
                    .part("file", part),
            );
        }
        let response = request
            .send()
            .await
            .map_err(|_| "Minecraft could not be reached. Try again.".to_string())?;
        if response.status() == 401 && attempt == 0 {
            session = refresh_minecraft_session(&session).await?;
            save_account_session(&session, false)?;
            continue;
        }
        if !response.status().is_success() {
            return Err(match response.status().as_u16() {
                401 => "Sign in to Minecraft again.",
                403 => "Minecraft did not allow this account change.",
                429 => "Minecraft is rate limiting requests. Wait a moment and retry.",
                _ => "Minecraft could not save or load this selection. Try again.",
            }
            .into());
        }
        return Ok(response);
    }
    Err("Sign in to Minecraft again.".into())
}
async fn profile(account: &str) -> Result<Value, String> {
    let result: Value = request(account, reqwest::Method::GET, "", None, None)
        .await?
        .json()
        .await
        .map_err(|_| "Minecraft returned an invalid profile")?;
    if uuid(result["id"].as_str().unwrap_or(""))? != uuid(account)? {
        return Err("Minecraft returned a different account.".into());
    }
    Ok(result)
}
async fn texture(url: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(url).map_err(|_| "Invalid Minecraft texture")?;
    if url.host_str() != Some("textures.minecraft.net")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !matches!(url.scheme(), "http" | "https")
    {
        return Err("Untrusted Minecraft texture.".into());
    }
    url.set_scheme("https")
        .map_err(|_| "Invalid texture address")?;
    let cache_key = url.as_str().to_owned();
    if let Some(cached) = super::cache::read_json::<String>("minecraft-textures", &cache_key, None)
    {
        return Ok(cached);
    }
    let mut response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|_| "Texture client unavailable")?
        .get(url)
        .send()
        .await
        .map_err(|_| "Minecraft texture unavailable")?
        .error_for_status()
        .map_err(|_| "Minecraft texture unavailable")?;
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Texture download failed")?
    {
        if data.len() + chunk.len() > 1_048_576 {
            return Err("Minecraft texture is too large.".into());
        }
        data.extend_from_slice(&chunk);
    }
    let data_url = format!("data:image/png;base64,{}", STANDARD.encode(data));
    let _ = super::cache::write_json("minecraft-textures", &cache_key, &data_url);
    Ok(data_url)
}
fn skin_dir(account: &str) -> Result<PathBuf, String> {
    let dir = bloom_data_dir()?.join("locker-skins").join(uuid(account)?);
    fs::create_dir_all(&dir).map_err(|_| "Unable to open the skin library")?;
    Ok(dir)
}
fn validate_skin(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 33
        || bytes.len() > 1_048_576
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &bytes[12..16] != b"IHDR"
    {
        return Err("Choose a Minecraft skin PNG.".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width != 64 || !matches!(height, 32 | 64) {
        return Err("Minecraft skins must be 64 × 64 or 64 × 32 pixels.".into());
    }
    Ok(())
}
fn local_skin(account: &str, id: &str) -> Result<Vec<u8>, String> {
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid saved skin.".into());
    }
    let file = fs::File::open(skin_dir(account)?.join(format!("{id}.png")))
        .map_err(|_| "Saved skin is unavailable")?;
    let mut bytes = Vec::new();
    file.take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|_| "Unable to read saved skin")?;
    validate_skin(&bytes)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn get_minecraft_wardrobe(
    account_id: String,
    refresh: Option<bool>,
) -> Result<Value, String> {
    let normalized_account = uuid(&account_id)?;
    if refresh != Some(true) {
        if let Some(cached) =
            super::cache::read_json::<Value>("minecraft-wardrobe", &normalized_account, None)
        {
            return Ok(cached);
        }
    }
    let profile = profile(&account_id).await?;
    let mut capes = Vec::new();
    if let Some(values) = profile["capes"].as_array() {
        for cape in values.iter().take(64) {
            capes.push(json!({"id":cape["id"],"name":cape["alias"],"active":cape["state"] == "ACTIVE","texture":texture(cape["url"].as_str().unwrap_or("")).await?}));
        }
    }
    let skin = profile["skins"]
        .as_array()
        .and_then(|skins| skins.iter().find(|skin| skin["state"] == "ACTIVE"));
    let current = if let Some(skin) = skin {
        Some(
            json!({"id":"current","name":"Current skin","texture":texture(skin["url"].as_str().unwrap_or("")).await?,"variant":if skin["variant"] == "SLIM" {"slim"} else {"classic"}}),
        )
    } else {
        None
    };
    let mut skins = Vec::new();
    for entry in fs::read_dir(skin_dir(&account_id)?).map_err(|_| "Unable to read skins")? {
        let path = entry.map_err(|_| "Unable to read skins")?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("png") {
            continue;
        }
        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if let Ok(bytes) = local_skin(&account_id, id) {
            let name = fs::read_to_string(path.with_extension("txt"))
                .unwrap_or_else(|_| "Saved skin".into());
            skins.push(json!({"id":id,"name":name,"texture":format!("data:image/png;base64,{}",STANDARD.encode(bytes)),"variant":"classic"}));
        }
    }
    skins.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    let wardrobe = json!({"capes":capes,"currentSkin":current,"skins":skins});
    let _ = super::cache::write_json("minecraft-wardrobe", &normalized_account, &wardrobe);
    Ok(wardrobe)
}

#[tauri::command]
pub async fn set_official_cape(account_id: String, cape_id: Option<String>) -> Result<(), String> {
    let normalized_account = uuid(&account_id)?;
    if let Some(ref id) = cape_id {
        if let Some(cached) =
            super::cache::read_json::<Value>("minecraft-wardrobe", &normalized_account, None)
        {
            if !cached["capes"]
                .as_array()
                .is_some_and(|capes| capes.iter().any(|cape| cape["id"].as_str() == Some(id)))
            {
                return Err("This account does not own that cape.".into());
            }
        } else {
            let p = profile(&account_id).await?;
            if !p["capes"]
                .as_array()
                .is_some_and(|capes| capes.iter().any(|cape| cape["id"].as_str() == Some(id)))
            {
                return Err("This account does not own that cape.".into());
            }
        }
    }
    let method = if cape_id.is_some() {
        reqwest::Method::PUT
    } else {
        reqwest::Method::DELETE
    };
    request(
        &account_id,
        method,
        "/capes/active",
        cape_id.clone().map(|id| json!({"capeId":id})),
        None,
    )
    .await?;
    if let Some(mut cached) =
        super::cache::read_json::<Value>("minecraft-wardrobe", &normalized_account, None)
    {
        if let Some(capes) = cached["capes"].as_array_mut() {
            for cape in capes {
                cape["active"] = Value::Bool(cape_id.as_deref() == cape["id"].as_str());
            }
        }
        let _ = super::cache::write_json("minecraft-wardrobe", &normalized_account, &cached);
    }
    Ok(())
}

#[tauri::command]
pub async fn import_locker_skin(account_id: String) -> Result<Option<String>, String> {
    active(&account_id)?;
    let picked = rfd::AsyncFileDialog::new()
        .add_filter("Minecraft skin", &["png"])
        .pick_file()
        .await;
    let Some(file) = picked else {
        return Ok(None);
    };
    active(&account_id)?;
    let mut bytes = Vec::new();
    fs::File::open(file.path())
        .map_err(|_| "Unable to open skin")?
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|_| "Unable to read skin")?;
    validate_skin(&bytes)?;
    let id = format!("{:x}", Sha256::digest(&bytes));
    let path = skin_dir(&account_id)?.join(format!("{id}.png"));
    if !path.exists() {
        fs::write(&path, &bytes).map_err(|_| "Unable to save skin")?;
    }
    let name = file
        .path()
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Skin")
        .chars()
        .take(80)
        .collect::<String>();
    fs::write(path.with_extension("txt"), &name).map_err(|_| "Unable to save skin name")?;
    let normalized_account = uuid(&account_id)?;
    if let Some(mut cached) =
        super::cache::read_json::<Value>("minecraft-wardrobe", &normalized_account, None)
    {
        if let Some(skins) = cached["skins"].as_array_mut() {
            skins.retain(|skin| skin["id"].as_str() != Some(id.as_str()));
            skins.push(json!({
                "id": id,
                "name": name,
                "texture": format!("data:image/png;base64,{}", STANDARD.encode(&bytes)),
                "variant": "classic"
            }));
            skins.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        }
        let _ = super::cache::write_json("minecraft-wardrobe", &normalized_account, &cached);
    }
    Ok(Some(id))
}

#[tauri::command]
pub async fn apply_locker_skin(
    account_id: String,
    skin_id: String,
    variant: String,
) -> Result<(), String> {
    if !matches!(variant.as_str(), "classic" | "slim") {
        return Err("Choose Classic or Slim arms.".into());
    }
    let bytes = local_skin(&account_id, &skin_id)?;
    request(
        &account_id,
        reqwest::Method::POST,
        "/skins",
        None,
        Some((bytes, variant.clone())),
    )
    .await?;
    let normalized_account = uuid(&account_id)?;
    if let Some(mut cached) =
        super::cache::read_json::<Value>("minecraft-wardrobe", &normalized_account, None)
    {
        if let Some(saved) = cached["skins"]
            .as_array()
            .and_then(|skins| {
                skins
                    .iter()
                    .find(|skin| skin["id"].as_str() == Some(skin_id.as_str()))
            })
            .cloned()
        {
            let mut current = saved;
            current["id"] = Value::String("current".into());
            current["variant"] = Value::String(variant);
            current["name"] = Value::String("Current skin".into());
            cached["currentSkin"] = current;
            let _ = super::cache::write_json("minecraft-wardrobe", &normalized_account, &cached);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_and_bad_png() {
        assert!(uuid("../account").is_err());
        assert!(validate_skin(b"not a skin").is_err());
        let mut png = vec![0; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&64u32.to_be_bytes());
        png[20..24].copy_from_slice(&64u32.to_be_bytes());
        assert!(validate_skin(&png).is_ok());
        png[16..20].copy_from_slice(&4096u32.to_be_bytes());
        assert!(validate_skin(&png).is_err());
    }
}
