use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use rand::{rngs::OsRng, RngCore};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha512};
use uuid::Uuid;
use vodozemac::{
    olm::{Account, AccountPickle, OlmMessage, Session, SessionConfig, SessionPickle},
    Curve25519PublicKey,
};

use super::bloom_data_dir;

const SOCIAL_API: &str = "https://api.north.bloomclient.org/minecraft/v1/social";
const SOCIAL_AUTH: &str = "https://bloomclient.org/v1/social/native/authorize";
const KEYRING_SERVICE: &str = "Bloom Client Social";

#[derive(Default)]
struct AuthRuntime {
    attempt: Option<AuthAttempt>,
}

struct AuthAttempt {
    verifier: String,
    challenge: String,
    state: String,
}

static AUTH_RUNTIME: OnceLock<Mutex<AuthRuntime>> = OnceLock::new();
fn auth_runtime() -> &'static Mutex<AuthRuntime> {
    AUTH_RUNTIME.get_or_init(|| Mutex::new(AuthRuntime::default()))
}

static SOCIAL_VAULT_IO: OnceLock<Mutex<()>> = OnceLock::new();
fn social_vault_io() -> &'static Mutex<()> {
    SOCIAL_VAULT_IO.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialUser {
    id: String,
    username: Option<String>,
    display_name: Option<String>,
    minecraft_uuid: Option<String>,
    minecraft_username: Option<String>,
    avatar_url: Option<String>,
    provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialMessage {
    id: String,
    conversation_id: String,
    friend_id: String,
    #[serde(default)]
    group_id: Option<String>,
    sender_id: String,
    kind: String,
    text: Option<String>,
    target_id: Option<String>,
    emoji: Option<String>,
    reaction_operation: Option<String>,
    image_data_url: Option<String>,
    #[serde(default)]
    attachment: Option<AttachmentDescriptor>,
    #[serde(default)]
    pinned: bool,
    #[serde(default)]
    edited_at: Option<u64>,
    created_at: u64,
    delivery_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlainEvent {
    version: u8,
    id: String,
    kind: String,
    text: Option<String>,
    target_id: Option<String>,
    emoji: Option<String>,
    operation: Option<String>,
    attachment: Option<AttachmentDescriptor>,
    #[serde(default)]
    subject_sender_id: Option<String>,
    #[serde(default)]
    subject_created_at: Option<u64>,
    created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentDescriptor {
    blob_id: String,
    content_key: String,
    mime_type: String,
    width: u32,
    height: u32,
    byte_size: usize,
    ciphertext_hash: String,
}

const MESSAGE_RETENTION_MS: u64 = 24 * 60 * 60 * 1_000;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SocialVault {
    account_pickle: String,
    sessions: HashMap<String, String>,
    device_refresh: HashMap<String, u64>,
    device_identities: HashMap<String, String>,
    messages: Vec<SocialMessage>,
    cursor: u64,
    group_cursor: u64,
    profile: Option<SocialUser>,
    contact_security: HashMap<String, ContactSecurityRecord>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ContactSecurityRecord {
    known_fingerprint: String,
    observed_fingerprint: String,
    verified_fingerprint: Option<String>,
    verified_at: Option<u64>,
    first_seen_at: u64,
    last_changed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialEncryptionDetails {
    friend_id: String,
    status: String,
    safety_number: String,
    qr_payload: String,
    first_seen_at: u64,
    last_changed_at: Option<u64>,
    verified_at: Option<u64>,
    local_device_count: usize,
    friend_device_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialAuthStart {
    authorization_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialSessionState {
    signed_in: bool,
    user: Option<SocialUser>,
    needs_username: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRequests {
    incoming: Vec<SocialUser>,
    outgoing: Vec<SocialUser>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialConversation {
    id: String,
    friend: SocialUser,
    updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialGroup {
    id: String,
    name: String,
    icon_data_url: Option<String>,
    owner_id: String,
    updated_at: u64,
    members: Vec<SocialUser>,
    can_manage: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialInstanceInvite {
    id: String,
    sender: SocialUser,
    recipient: SocialUser,
    share_mode: String,
    role: String,
    instance_name: String,
    minecraft_version: String,
    loader: String,
    icon_data_url: Option<String>,
    status: String,
    created_at: u64,
    updated_at: u64,
    expires_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialInstanceInviteTarget {
    recipient_id: String,
    share_code: String,
    role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialSnapshot {
    session: SocialSessionState,
    friends: Vec<SocialUser>,
    requests: SocialFriendRequests,
    conversations: Vec<SocialConversation>,
    groups: Vec<SocialGroup>,
    invites: Vec<SocialInstanceInvite>,
    messages: Vec<SocialMessage>,
    sync_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialChange {
    cursor: String,
    changed: bool,
    scopes: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialMessageSync {
    messages: Vec<SocialMessage>,
    sync_warning: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenBundle {
    access_token: String,
    refresh_token: String,
    access_expires_at: u64,
    refresh_expires_at: u64,
    user: Option<SocialUser>,
    needs_username: Option<bool>,
}

#[derive(Deserialize)]
struct NativeApproval {
    code: String,
    profile: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedTokens {
    access_token: String,
    refresh_token: String,
    access_expires_at: u64,
    refresh_expires_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeResponse {
    user: SocialUser,
    needs_username: bool,
}

#[derive(Deserialize)]
struct FriendsResponse {
    friends: Vec<SocialUser>,
}

#[derive(Deserialize)]
struct RequestsResponse {
    incoming: Vec<SocialUser>,
    outgoing: Vec<SocialUser>,
}

#[derive(Deserialize)]
struct ConversationsResponse {
    conversations: Vec<SocialConversation>,
}

#[derive(Deserialize)]
struct GroupsResponse {
    groups: Vec<SocialGroup>,
}

#[derive(Deserialize)]
struct InstanceInvitesResponse {
    invites: Vec<SocialInstanceInvite>,
    #[serde(default, rename = "newInviteIds")]
    new_invite_ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInviteClaim {
    claim_token: String,
    share_code: String,
    share_mode: String,
    role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialInstanceInviteSendResult {
    invites: Vec<SocialInstanceInvite>,
    warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialShareContext {
    session: SocialSessionState,
    friends: Vec<SocialUser>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrekeyBundle {
    device_id: String,
    curve25519_key: String,
    one_time_key: String,
}

#[derive(Deserialize)]
struct PrekeyResponse {
    devices: Vec<PrekeyBundle>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentity {
    device_id: String,
    curve25519_key: String,
    ed25519_key: String,
}

#[derive(Deserialize)]
struct DevicesResponse {
    devices: Vec<DeviceIdentity>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireEnvelope {
    sequence: u64,
    conversation_id: String,
    #[serde(default)]
    group_id: Option<String>,
    sender_id: String,
    sender_device_id: String,
    sender_curve25519_key: String,
    event_kind: String,
    ciphertext: String,
    created_at: u64,
}

#[derive(Deserialize)]
struct EnvelopeResponse {
    envelopes: Vec<WireEnvelope>,
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn random_urlsafe(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn credential(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, name).map_err(|error| error.to_string())
}

fn get_secret(name: &str) -> Option<String> {
    credential(name).ok()?.get_password().ok()
}
fn set_secret(name: &str, value: &str) -> Result<(), String> {
    credential(name)?
        .set_password(value)
        .map_err(|error| format!("Windows could not save Bloom Social securely: {error}"))
}
fn delete_secret(name: &str) -> Result<(), String> {
    match credential(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn active_profile() -> Option<String> {
    get_secret("active-profile").filter(|value| Uuid::parse_str(value).is_ok())
}

fn profile_secret(name: &str) -> String {
    active_profile()
        .map(|profile| format!("{name}:{profile}"))
        .unwrap_or_else(|| name.to_string())
}

fn activate_profile(profile: &str, migrate_legacy: bool) -> Result<(), String> {
    if Uuid::parse_str(profile).is_err() {
        return Err("Bloom rejected an invalid Social profile.".into());
    }
    if migrate_legacy {
        for name in ["tokens", "device-id", "vault-key"] {
            let target = format!("{name}:{profile}");
            if get_secret(&target).is_none() {
                if let Some(value) = get_secret(name) {
                    set_secret(&target, &value)?;
                }
            }
        }
        let legacy = social_root()?.join("vault.bin");
        let target = social_root()?.join(format!("vault-{profile}.bin"));
        if legacy.exists() && !target.exists() {
            std::fs::copy(legacy, target).map_err(|error| error.to_string())?;
        }
    }
    set_secret("active-profile", profile)?;
    if migrate_legacy {
        // The unscoped token is only a migration source. Leaving it behind can
        // silently resurrect an old account after the user signs out.
        delete_secret("tokens")?;
    }
    Ok(())
}

fn device_id() -> Result<String, String> {
    let name = profile_secret("device-id");
    if let Some(value) = get_secret(&name) {
        return Ok(value);
    }
    let value = Uuid::new_v4().to_string();
    set_secret(&name, &value)?;
    Ok(value)
}

fn vault_key() -> Result<[u8; 32], String> {
    let name = profile_secret("vault-key");
    if let Some(value) = get_secret(&name) {
        let bytes = URL_SAFE_NO_PAD
            .decode(value)
            .map_err(|_| "Bloom Social's secure storage key is invalid.".to_string())?;
        return bytes
            .try_into()
            .map_err(|_| "Bloom Social's secure storage key has the wrong length.".to_string());
    }
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    set_secret(&name, &URL_SAFE_NO_PAD.encode(key))?;
    Ok(key)
}

fn social_root() -> Result<std::path::PathBuf, String> {
    let root = bloom_data_dir()?.join("social");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn encrypt_vault(vault: &SocialVault) -> Result<Vec<u8>, String> {
    let key = vault_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "Bloom Social could not open secure storage.".to_string())?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let plaintext = serde_json::to_vec(vault).map_err(|error| error.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_ref())
        .map_err(|_| "Bloom Social could not encrypt local history.".to_string())?;
    let mut output = Vec::with_capacity(5 + nonce.len() + ciphertext.len());
    output.extend_from_slice(b"BSV1");
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

fn decrypt_vault(bytes: &[u8]) -> Result<SocialVault, String> {
    if bytes.len() < 17 || &bytes[..4] != b"BSV1" {
        return Err("Bloom Social's local vault is invalid.".into());
    }
    let key = vault_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "Bloom Social could not open secure storage.".to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&bytes[4..16]), &bytes[16..])
        .map_err(|_| "Bloom Social could not unlock local history.".to_string())?;
    serde_json::from_slice(&plaintext).map_err(|error| error.to_string())
}

fn load_vault() -> Result<SocialVault, String> {
    let path = social_root()?.join(
        active_profile()
            .map(|profile| format!("vault-{profile}.bin"))
            .unwrap_or_else(|| "vault.bin".into()),
    );
    if !path.exists() {
        let key = vault_key()?;
        let account = Account::new();
        let vault = SocialVault {
            account_pickle: account.pickle().encrypt(&key),
            ..Default::default()
        };
        save_vault(&vault)?;
        return Ok(vault);
    }
    decrypt_vault(&std::fs::read(path).map_err(|error| error.to_string())?)
}

fn save_vault(vault: &SocialVault) -> Result<(), String> {
    let path = social_root()?.join(
        active_profile()
            .map(|profile| format!("vault-{profile}.bin"))
            .unwrap_or_else(|| "vault.bin".into()),
    );
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, encrypt_vault(vault)?).map_err(|error| error.to_string())?;
    std::fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn load_account(vault: &SocialVault) -> Result<Account, String> {
    let key = vault_key()?;
    let pickle = AccountPickle::from_encrypted(&vault.account_pickle, &key)
        .map_err(|_| "Bloom Social could not unlock the encryption identity.".to_string())?;
    Ok(Account::from_pickle(pickle))
}

fn save_account(vault: &mut SocialVault, account: &Account) -> Result<(), String> {
    vault.account_pickle = account.pickle().encrypt(&vault_key()?);
    Ok(())
}

fn load_session(vault: &SocialVault, device: &str) -> Result<Option<Session>, String> {
    let Some(value) = vault.sessions.get(device) else {
        return Ok(None);
    };
    let pickle = SessionPickle::from_encrypted(value, &vault_key()?)
        .map_err(|_| "A Bloom Social conversation key could not be unlocked.".to_string())?;
    Ok(Some(Session::from_pickle(pickle)))
}

fn save_session(vault: &mut SocialVault, device: &str, session: &Session) -> Result<(), String> {
    vault
        .sessions
        .insert(device.to_string(), session.pickle().encrypt(&vault_key()?));
    Ok(())
}

fn load_tokens() -> Option<SavedTokens> {
    serde_json::from_str(&get_secret(&profile_secret("tokens"))?).ok()
}

fn save_tokens(bundle: &TokenBundle) -> Result<(), String> {
    let name = profile_secret("tokens");
    set_secret(
        &name,
        &serde_json::to_string(&SavedTokens {
            access_token: bundle.access_token.clone(),
            refresh_token: bundle.refresh_token.clone(),
            access_expires_at: bundle.access_expires_at,
            refresh_expires_at: bundle.refresh_expires_at,
        })
        .map_err(|error| error.to_string())?,
    )
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .user_agent(concat!(
            "BloomClient/",
            env!("CARGO_PKG_VERSION"),
            " Social"
        ))
        .build()
        .map_err(|error| error.to_string())
}

fn refresh_tokens(tokens: &SavedTokens) -> Result<SavedTokens, String> {
    let response = http_client()?
        .post(format!("{SOCIAL_API}/native/refresh"))
        .json(&serde_json::json!({ "refreshToken": tokens.refresh_token }))
        .send()
        .map_err(|error| format!("Bloom Social could not refresh your sign-in: {error}"))?;
    if !response.status().is_success() {
        return Err("Your Bloom Social sign-in expired. Sign in again.".into());
    }
    let bundle: TokenBundle = response.json().map_err(|error| error.to_string())?;
    save_tokens(&bundle)?;
    Ok(SavedTokens {
        access_token: bundle.access_token,
        refresh_token: bundle.refresh_token,
        access_expires_at: bundle.access_expires_at,
        refresh_expires_at: bundle.refresh_expires_at,
    })
}

fn current_tokens() -> Result<SavedTokens, String> {
    let tokens = load_tokens().ok_or_else(|| "Sign in to your Bloom account first.".to_string())?;
    if tokens.refresh_expires_at <= timestamp() {
        return Err("Your Bloom Social sign-in expired. Sign in again.".into());
    }
    if tokens.access_expires_at <= timestamp() + 30_000 {
        refresh_tokens(&tokens)
    } else {
        Ok(tokens)
    }
}

fn request<T: DeserializeOwned>(
    method: reqwest::Method,
    route: &str,
    body: Option<serde_json::Value>,
) -> Result<T, String> {
    let tokens = current_tokens()?;
    let client = http_client()?;
    let mut request = client
        .request(method, format!("{SOCIAL_API}{route}"))
        .bearer_auth(tokens.access_token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .map_err(|error| format!("Bloom Social is unavailable: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let value: serde_json::Value = response.json().unwrap_or_default();
        return Err(value
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("social_request_failed")
            .replace('_', " "));
    }
    response.json().map_err(|error| error.to_string())
}

fn request_empty(
    method: reqwest::Method,
    route: &str,
    body: Option<serde_json::Value>,
) -> Result<(), String> {
    let tokens = current_tokens()?;
    let client = http_client()?;
    let mut request = client
        .request(method, format!("{SOCIAL_API}{route}"))
        .bearer_auth(tokens.access_token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .map_err(|error| format!("Bloom Social is unavailable: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err("Bloom Social could not finish that request.".into())
    }
}

fn device_directory(user_id: &str) -> Result<Vec<DeviceIdentity>, String> {
    let response: DevicesResponse = request(
        reqwest::Method::GET,
        &format!("/users/{user_id}/devices"),
        None,
    )?;
    if response.devices.is_empty() {
        return Err("This Bloom account does not have an active encryption device.".into());
    }
    Ok(response.devices)
}

fn identity_fingerprint(user_id: &str, devices: &[DeviceIdentity]) -> String {
    let mut ordered = devices.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.device_id.cmp(&right.device_id));
    let mut digest = Sha256::new();
    digest.update(b"bloom-social-device-directory-v1\0");
    digest.update(user_id.as_bytes());
    for device in ordered {
        digest.update([0]);
        digest.update(device.device_id.as_bytes());
        digest.update([0]);
        digest.update(device.curve25519_key.as_bytes());
        digest.update([0]);
        digest.update(device.ed25519_key.as_bytes());
    }
    digest.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn observe_contact_identity(
    vault: &mut SocialVault,
    friend_id: &str,
    observed: &str,
) -> String {
    let current_time = timestamp();
    let record = vault
        .contact_security
        .entry(friend_id.to_string())
        .or_insert_with(|| ContactSecurityRecord {
            known_fingerprint: observed.to_string(),
            observed_fingerprint: observed.to_string(),
            verified_fingerprint: None,
            verified_at: None,
            first_seen_at: current_time,
            last_changed_at: None,
        });
    if record.observed_fingerprint != observed {
        record.observed_fingerprint = observed.to_string();
        record.last_changed_at = Some(current_time);
    }
    if record.known_fingerprint != record.observed_fingerprint {
        "key_changed".into()
    } else if record.verified_fingerprint.as_deref() == Some(record.known_fingerprint.as_str()) {
        "verified".into()
    } else {
        "not_verified".into()
    }
}

fn safety_number(
    local_user_id: &str,
    local_fingerprint: &str,
    friend_id: &str,
    friend_fingerprint: &str,
) -> (String, String) {
    let mut identities = [
        (local_user_id, local_fingerprint),
        (friend_id, friend_fingerprint),
    ];
    identities.sort_by(|left, right| left.0.cmp(right.0));
    let payload = serde_json::json!({
        "type": "bloom.social.verification",
        "version": 1,
        "identities": identities.iter().map(|(id, fingerprint)| serde_json::json!({
            "userId": id,
            "fingerprint": fingerprint,
        })).collect::<Vec<_>>(),
    });
    let canonical = serde_json::to_vec(&payload).unwrap_or_default();
    let digest = Sha512::digest(&canonical);
    let groups = (0..12)
        .map(|index| {
            let offset = index * 4;
            let value = u32::from_be_bytes(digest[offset..offset + 4].try_into().unwrap());
            format!("{:05}", value % 100_000)
        })
        .collect::<Vec<_>>()
        .join(" ");
    (groups, URL_SAFE_NO_PAD.encode(canonical))
}

fn encryption_details(
    vault: &mut SocialVault,
    friend_id: &str,
    decision: Option<bool>,
) -> Result<SocialEncryptionDetails, String> {
    let local = vault
        .profile
        .as_ref()
        .ok_or_else(|| "Sign in to Bloom Social first.".to_string())?;
    let local_id = local.id.clone();
    let local_devices = device_directory(&local_id)?;
    let friend_devices = device_directory(friend_id)?;
    let local_fingerprint = identity_fingerprint(&local_id, &local_devices);
    let friend_fingerprint = identity_fingerprint(friend_id, &friend_devices);
    let mut status = observe_contact_identity(vault, friend_id, &friend_fingerprint);
    if let Some(verified) = decision {
        let record = vault.contact_security.get_mut(friend_id).ok_or("missing identity")?;
        record.known_fingerprint = record.observed_fingerprint.clone();
        record.verified_fingerprint = verified.then(|| record.observed_fingerprint.clone());
        record.verified_at = verified.then(timestamp);
        status = if verified { "verified".into() } else { "not_verified".into() };
    }
    let record = vault.contact_security.get(friend_id).ok_or("missing identity")?;
    let (number, qr_payload) = safety_number(
        &local_id,
        &local_fingerprint,
        friend_id,
        &record.observed_fingerprint,
    );
    Ok(SocialEncryptionDetails {
        friend_id: friend_id.to_string(),
        status,
        safety_number: number,
        qr_payload,
        first_seen_at: record.first_seen_at,
        last_changed_at: record.last_changed_at,
        verified_at: record.verified_at,
        local_device_count: local_devices.len(),
        friend_device_count: friend_devices.len(),
    })
}

fn upload_blob(friend_id: &str, ciphertext: Vec<u8>) -> Result<serde_json::Value, String> {
    let tokens = current_tokens()?;
    let response = http_client()?
        .post(format!("{SOCIAL_API}/blobs?recipientId={friend_id}"))
        .bearer_auth(tokens.access_token)
        .header("content-type", "application/octet-stream")
        .body(ciphertext)
        .send()
        .map_err(|error| format!("Bloom could not upload the encrypted screenshot: {error}"))?;
    if !response.status().is_success() {
        return Err("Bloom could not store the encrypted screenshot.".into());
    }
    response.json().map_err(|error| error.to_string())
}

fn download_blob(blob_id: &str) -> Result<Vec<u8>, String> {
    let tokens = current_tokens()?;
    let response = http_client()?
        .get(format!("{SOCIAL_API}/blobs/{blob_id}"))
        .bearer_auth(tokens.access_token)
        .send()
        .map_err(|error| format!("Bloom could not download an encrypted screenshot: {error}"))?;
    if !response.status().is_success() {
        return Err("The encrypted screenshot is unavailable.".into());
    }
    response
        .bytes()
        .map(|value| value.to_vec())
        .map_err(|error| error.to_string())
}

fn normalize_screenshot(path: &std::path::Path) -> Result<(Vec<u8>, u32, u32), String> {
    use image::GenericImageView;
    let input = std::fs::read(path)
        .map_err(|error| format!("Bloom could not read that screenshot: {error}"))?;
    if input.len() > 32 * 1024 * 1024 {
        return Err("That screenshot is too large to process.".into());
    }
    let image = image::load_from_memory(&input)
        .map_err(|_| "Choose a valid PNG, JPEG, or WebP screenshot.".to_string())?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 || width > 4096 || height > 4096 {
        return Err("Screenshots must be no larger than 4096 by 4096 pixels.".into());
    }
    let mut output = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| format!("Bloom could not normalize that screenshot: {error}"))?;
    let bytes = output.into_inner();
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("The normalized screenshot is larger than 8 MiB.".into());
    }
    Ok((bytes, width, height))
}

fn encrypt_screenshot(
    friend_id: &str,
    plaintext: &[u8],
    width: u32,
    height: u32,
) -> Result<(AttachmentDescriptor, String), String> {
    let mut content_key = [0u8; 32];
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut content_key);
    OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(&content_key)
        .map_err(|_| "Bloom could not prepare screenshot encryption.".to_string())?;
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "Bloom could not encrypt that screenshot.".to_string())?;
    let mut ciphertext = Vec::with_capacity(nonce.len() + encrypted.len());
    ciphertext.extend_from_slice(&nonce);
    ciphertext.extend_from_slice(&encrypted);
    let ciphertext_hash = format!("{:x}", Sha256::digest(&ciphertext));
    let uploaded = upload_blob(friend_id, ciphertext)?;
    let blob_id = uploaded
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Bloom did not return an encrypted screenshot ID.".to_string())?
        .to_string();
    Ok((
        AttachmentDescriptor {
            blob_id,
            content_key: URL_SAFE_NO_PAD.encode(content_key),
            mime_type: "image/png".into(),
            width,
            height,
            byte_size: plaintext.len(),
            ciphertext_hash,
        },
        format!("data:image/png;base64,{}", STANDARD.encode(plaintext)),
    ))
}

fn decrypt_screenshot(descriptor: &AttachmentDescriptor) -> Result<String, String> {
    let ciphertext = download_blob(&descriptor.blob_id)?;
    if format!("{:x}", Sha256::digest(&ciphertext)) != descriptor.ciphertext_hash
        || ciphertext.len() < 29
    {
        return Err("Bloom rejected a damaged encrypted screenshot.".into());
    }
    let key = URL_SAFE_NO_PAD
        .decode(&descriptor.content_key)
        .map_err(|_| "The screenshot key is invalid.".to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "The screenshot key is invalid.".to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&ciphertext[..12]), &ciphertext[12..])
        .map_err(|_| "Bloom could not authenticate this screenshot.".to_string())?;
    let decoded = image::load_from_memory(&plaintext)
        .map_err(|_| "Bloom rejected an invalid decrypted screenshot.".to_string())?;
    use image::GenericImageView;
    if decoded.dimensions() != (descriptor.width, descriptor.height)
        || plaintext.len() != descriptor.byte_size
    {
        return Err("Bloom rejected mismatched screenshot details.".into());
    }
    Ok(format!(
        "data:{};base64,{}",
        descriptor.mime_type,
        STANDARD.encode(plaintext)
    ))
}

fn identity_keys() -> Result<(String, String), String> {
    let vault = load_vault()?;
    let keys = load_account(&vault)?.identity_keys();
    Ok((keys.curve25519.to_base64(), keys.ed25519.to_base64()))
}

fn upload_prekeys() -> Result<(), String> {
    let mut vault = load_vault()?;
    let mut account = load_account(&vault)?;
    if account.one_time_keys().len() < 25 {
        account.generate_one_time_keys(50);
    }
    let keys = account
        .one_time_keys()
        .into_iter()
        .map(|(id, key)| serde_json::json!({ "id": id.to_base64(), "key": key.to_base64() }))
        .collect::<Vec<_>>();
    if !keys.is_empty() {
        request_empty(
            reqwest::Method::PUT,
            "/prekeys",
            Some(serde_json::json!({ "keys": keys })),
        )?;
        account.mark_keys_as_published();
        save_account(&mut vault, &account)?;
        save_vault(&vault)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn social_prepare_sign_in() -> Result<SocialAuthStart, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let verifier = random_urlsafe(48);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let state = random_urlsafe(32);
        let authorization_url = format!("{SOCIAL_AUTH}?challenge={challenge}&state={state}");
        auth_runtime()
            .lock()
            .map_err(|_| "The sign-in manager is busy.".to_string())?
            .attempt = Some(AuthAttempt {
            verifier,
            challenge,
            state,
        });
        Ok(SocialAuthStart { authorization_url })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_poll_sign_in() -> Result<Option<SocialSessionState>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (verifier, challenge, state) = {
            let runtime = auth_runtime().lock().map_err(|_| "The sign-in manager is busy.".to_string())?;
            let Some(attempt) = runtime.attempt.as_ref() else { return Ok(None); };
            (attempt.verifier.clone(), attempt.challenge.clone(), attempt.state.clone())
        };
        let response = http_client()?.post(format!("{SOCIAL_API}/native/status")).json(&serde_json::json!({
            "challenge": challenge, "state": state,
        })).send().map_err(|error| format!("Bloom could not check account approval: {error}"))?;
        if response.status() == reqwest::StatusCode::ACCEPTED { return Ok(None); }
        if response.status() == reqwest::StatusCode::FORBIDDEN {
            auth_runtime().lock().map_err(|_| "The sign-in manager is busy.".to_string())?.attempt = None;
            return Err("Bloom account connection was cancelled.".into());
        }
        if !response.status().is_success() {
            return Err("Bloom could not check that account approval. Try connecting again.".into());
        }
        let approval: NativeApproval = response.json().map_err(|error| error.to_string())?;
        if Uuid::parse_str(&approval.profile).is_err() {
            return Err("Bloom sign-in returned an invalid account profile.".into());
        }
        let code = approval.code;
        let profile = approval.profile;
        activate_profile(&profile, false)?;
        let (curve, signing) = identity_keys()?;
        let response = http_client()?.post(format!("{SOCIAL_API}/native/exchange")).json(&serde_json::json!({
            "code": code, "verifier": verifier, "deviceId": device_id()?, "deviceName": "Bloom Client on Windows",
            "curve25519Key": curve, "ed25519Key": signing,
        })).send().map_err(|error| format!("Bloom could not finish sign-in: {error}"))?;
        if !response.status().is_success() { return Err("Bloom could not verify that sign-in. Please try again.".into()); }
        let bundle: TokenBundle = response.json().map_err(|error| error.to_string())?;
        if bundle.user.as_ref().map(|user| user.id.as_str()) != Some(profile.as_str()) {
            return Err("Bloom rejected a mismatched account profile.".into());
        }
        save_tokens(&bundle)?;
        let mut vault = load_vault()?;
        vault.profile = bundle.user.clone();
        save_vault(&vault)?;
        if let Err(error) = upload_prekeys() {
            eprintln!("[Bloom Social] signed in, but prekey upload will retry later: {error}");
        }
        auth_runtime().lock().map_err(|_| "The sign-in manager is busy.".to_string())?.attempt = None;
        Ok(Some(SocialSessionState { signed_in: true, user: bundle.user, needs_username: bundle.needs_username.unwrap_or(false) }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_session_state() -> Result<SocialSessionState, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if load_tokens().is_none() {
            return Ok(SocialSessionState {
                signed_in: false,
                user: None,
                needs_username: false,
            });
        }
        match request::<MeResponse>(reqwest::Method::GET, "/me", None) {
            Ok(me) => {
                if active_profile().is_none() {
                    activate_profile(&me.user.id, true)?;
                }
                let mut vault = load_vault()?;
                vault.profile = Some(me.user.clone());
                save_vault(&vault)?;
                Ok(SocialSessionState {
                    signed_in: true,
                    user: Some(me.user),
                    needs_username: me.needs_username,
                })
            }
            Err(error) => {
                // A temporary API or network failure must not make the client
                // appear signed out. Preserve the last verified local profile;
                // the snapshot refresh will surface the connectivity problem.
                let cached = load_vault()?.profile;
                if cached.is_some() {
                    eprintln!("[Bloom Social] session refresh deferred: {error}");
                    Ok(SocialSessionState {
                        signed_in: true,
                        user: cached,
                        needs_username: false,
                    })
                } else {
                    Err(error)
                }
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_set_username(username: String) -> Result<SocialUser, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let value: serde_json::Value = request(
            reqwest::Method::PUT,
            "/me/username",
            Some(serde_json::json!({ "username": username })),
        )?;
        let user: SocialUser =
            serde_json::from_value(value.get("user").cloned().ok_or("missing user")?)
                .map_err(|error| error.to_string())?;
        let mut vault = load_vault()?;
        vault.profile = Some(user.clone());
        save_vault(&vault)?;
        Ok(user)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn advance_envelope_cursor(vault: &mut SocialVault, groups: bool, sequence: u64) {
    if groups {
        vault.group_cursor = vault.group_cursor.max(sequence);
    } else {
        vault.cursor = vault.cursor.max(sequence);
    }
}

fn prune_expired_messages(vault: &mut SocialVault) {
    let cutoff = timestamp().saturating_sub(MESSAGE_RETENTION_MS);
    vault.messages.retain(|message| {
        message.pinned
            || message.created_at > cutoff
            || message.delivery_state == "pending"
            || message.delivery_state == "failed"
    });
}

fn create_inbound_session(
    vault: &mut SocialVault,
    account: &mut Account,
    session_key: &str,
    sender_curve25519_key: &str,
    prekey: &vodozemac::olm::PreKeyMessage,
) -> Result<Vec<u8>, String> {
    let curve = Curve25519PublicKey::from_base64(sender_curve25519_key)
        .map_err(|_| "The sender's encryption identity was invalid.".to_string())?;
    let result = account
        .create_inbound_session(SessionConfig::version_1(), curve, prekey)
        .map_err(|_| "Bloom could not establish the encrypted conversation.".to_string())?;
    save_session(vault, session_key, &result.session)?;
    Ok(result.plaintext)
}

fn decrypt_envelopes(vault: &mut SocialVault, groups: bool) -> Result<Option<String>, String> {
    let cursor = if groups {
        vault.group_cursor
    } else {
        vault.cursor
    };
    let route = if groups {
        "group-envelopes"
    } else {
        "envelopes"
    };
    let response: EnvelopeResponse = request(
        reqwest::Method::GET,
        &format!("/{route}?after={cursor}"),
        None,
    )?;
    if response.envelopes.is_empty() {
        return Ok(None);
    }
    let mut account = load_account(vault)?;
    let mut warning = None;
    for envelope in response.envelopes {
        let message: OlmMessage = match serde_json::from_str(&envelope.ciphertext) {
            Ok(message) => message,
            Err(_) => {
                warning.get_or_insert_with(|| {
                    "Bloom skipped a damaged encrypted message.".to_string()
                });
                advance_envelope_cursor(vault, groups, envelope.sequence);
                continue;
            }
        };
        let inbound_session_key =
            format!("in:{}:{}", envelope.sender_id, envelope.sender_device_id);
        let plaintext = match (&message, load_session(vault, &inbound_session_key)?) {
            (_, Some(mut session)) => {
                match session.decrypt(&message) {
                    Ok(value) => {
                        save_session(vault, &inbound_session_key, &session)?;
                        value
                    }
                    // A sender can legitimately establish a fresh Olm session on
                    // the same device after restoring or rotating its local vault.
                    // Replace the stale inbound session when the new message proves
                    // itself with a valid pre-key instead of retrying the old ratchet.
                    Err(_) => {
                        match &message {
                            OlmMessage::PreKey(prekey) => match create_inbound_session(
                                vault,
                                &mut account,
                                &inbound_session_key,
                                &envelope.sender_curve25519_key,
                                prekey,
                            ) {
                                Ok(value) => value,
                                Err(_) => {
                                    warning.get_or_insert_with(|| "Bloom skipped a message whose encryption session could not be renewed.".to_string());
                                    advance_envelope_cursor(vault, groups, envelope.sequence);
                                    continue;
                                }
                            },
                            _ => {
                                warning.get_or_insert_with(|| "Bloom skipped a message from an expired encryption session.".to_string());
                                advance_envelope_cursor(vault, groups, envelope.sequence);
                                continue;
                            }
                        }
                    }
                }
            }
            (OlmMessage::PreKey(prekey), None) => match create_inbound_session(
                vault,
                &mut account,
                &inbound_session_key,
                &envelope.sender_curve25519_key,
                prekey,
            ) {
                Ok(value) => value,
                Err(_) => {
                    warning.get_or_insert_with(|| "Bloom skipped a message whose encryption session could not be established.".to_string());
                    advance_envelope_cursor(vault, groups, envelope.sequence);
                    continue;
                }
            },
            _ => {
                warning.get_or_insert_with(|| "Bloom skipped a message sent before its encryption session was established.".to_string());
                advance_envelope_cursor(vault, groups, envelope.sequence);
                continue;
            }
        };
        let event: PlainEvent = match serde_json::from_slice(&plaintext) {
            Ok(event) => event,
            Err(_) => {
                warning.get_or_insert_with(|| {
                    "Bloom skipped an invalid decrypted message.".to_string()
                });
                advance_envelope_cursor(vault, groups, envelope.sequence);
                continue;
            }
        };
        if event.version != 1
            || event.kind != envelope.event_kind
            || !["message", "reaction", "pin", "edit"].contains(&event.kind.as_str())
        {
            warning.get_or_insert_with(|| {
                "Bloom skipped an unsupported encrypted message.".to_string()
            });
            advance_envelope_cursor(vault, groups, envelope.sequence);
            continue;
        }
        if event.kind == "pin" {
            let Some(target_id) = event.target_id.as_ref().filter(|value| !value.is_empty()) else {
                warning
                    .get_or_insert_with(|| "Bloom skipped an invalid encrypted pin.".to_string());
                advance_envelope_cursor(vault, groups, envelope.sequence);
                continue;
            };
            let operation = event.operation.as_deref();
            let updating = operation == Some("update");
            let pinned = operation == Some("add") || updating;
            if !pinned && operation != Some("remove") {
                warning
                    .get_or_insert_with(|| "Bloom skipped an invalid encrypted pin.".to_string());
                advance_envelope_cursor(vault, groups, envelope.sequence);
                continue;
            }
            if let Some(message) = vault
                .messages
                .iter_mut()
                .find(|message| message.id == *target_id)
            {
                if updating {
                    let valid_text = event.text.as_ref().is_some_and(|text| {
                        !text.trim().is_empty() && text.chars().count() <= 2000
                    });
                    if message.sender_id == envelope.sender_id && valid_text {
                        message.text = event.text.clone();
                        message.edited_at = Some(event.created_at);
                        message.pinned = true;
                    }
                } else {
                    message.pinned = pinned;
                }
            } else if pinned {
                if updating
                    && event.subject_sender_id.as_deref() != Some(envelope.sender_id.as_str())
                {
                    advance_envelope_cursor(vault, groups, envelope.sequence);
                    continue;
                }
                let image_data_url = match event
                    .attachment
                    .as_ref()
                    .map(decrypt_screenshot)
                    .transpose()
                {
                    Ok(value) => value,
                    Err(_) => {
                        warning.get_or_insert_with(|| {
                            "Bloom skipped a damaged pinned screenshot.".to_string()
                        });
                        advance_envelope_cursor(vault, groups, envelope.sequence);
                        continue;
                    }
                };
                vault.messages.push(SocialMessage {
                    id: target_id.clone(),
                    conversation_id: envelope.conversation_id.clone(),
                    friend_id: if groups {
                        String::new()
                    } else {
                        envelope.sender_id.clone()
                    },
                    group_id: envelope.group_id.clone(),
                    sender_id: event
                        .subject_sender_id
                        .clone()
                        .unwrap_or_else(|| envelope.sender_id.clone()),
                    kind: "message".into(),
                    text: event.text.clone(),
                    target_id: None,
                    emoji: None,
                    reaction_operation: None,
                    image_data_url,
                    attachment: event.attachment.clone(),
                    pinned: true,
                    edited_at: updating.then_some(event.created_at),
                    created_at: event
                        .subject_created_at
                        .unwrap_or(event.created_at)
                        .min(envelope.created_at),
                    delivery_state: "delivered".into(),
                });
            }
            advance_envelope_cursor(vault, groups, envelope.sequence);
            continue;
        }
        if event.kind == "edit" && event.operation.as_deref() == Some("edit") {
            let target = event.target_id.as_deref().unwrap_or_default();
            let valid_text = event.text.as_ref().is_some_and(|text| {
                !text.trim().is_empty() && text.chars().count() <= 2000
            });
            if valid_text {
                if let Some(message) = vault.messages.iter_mut().find(|message| {
                    message.id == target
                        && message.sender_id == envelope.sender_id
                        && message.kind == "message"
                        && if groups {
                            message.group_id == envelope.group_id
                        } else {
                            message.group_id.is_none()
                                && message.conversation_id == envelope.conversation_id
                        }
                }) {
                    message.text = event.text.clone();
                    message.edited_at = Some(event.created_at);
                }
            }
            advance_envelope_cursor(vault, groups, envelope.sequence);
            continue;
        }
        if !vault.messages.iter().any(|item| item.id == event.id) {
            let image_data_url = match event
                .attachment
                .as_ref()
                .map(decrypt_screenshot)
                .transpose()
            {
                Ok(value) => value,
                Err(_) => {
                    warning.get_or_insert_with(|| {
                        "Bloom skipped a damaged encrypted screenshot.".to_string()
                    });
                    advance_envelope_cursor(vault, groups, envelope.sequence);
                    continue;
                }
            };
            vault.messages.push(SocialMessage {
                id: event.id,
                conversation_id: envelope.conversation_id,
                friend_id: if groups {
                    String::new()
                } else {
                    envelope.sender_id.clone()
                },
                group_id: envelope.group_id,
                sender_id: envelope.sender_id,
                kind: event.kind,
                text: event.text,
                target_id: event.target_id,
                emoji: event.emoji,
                reaction_operation: event.operation,
                image_data_url,
                attachment: event.attachment,
                pinned: false,
                edited_at: None,
                created_at: envelope.created_at,
                delivery_state: "delivered".into(),
            });
        }
        advance_envelope_cursor(vault, groups, envelope.sequence);
    }
    save_account(vault, &account)?;
    prune_expired_messages(vault);
    vault.messages.sort_by_key(|message| message.created_at);
    if vault.messages.len() > 10_000 {
        vault.messages.drain(..vault.messages.len() - 10_000);
    }
    Ok(warning)
}

fn decrypt_new_envelopes(vault: &mut SocialVault) -> Result<Option<String>, String> {
    let direct_warning = decrypt_envelopes(vault, false)?;
    let group_warning = decrypt_envelopes(vault, true)?;
    Ok(direct_warning.or(group_warning))
}

fn snapshot() -> Result<SocialSnapshot, String> {
    let me: MeResponse = request(reqwest::Method::GET, "/me", None)?;
    let friends: FriendsResponse = request(reqwest::Method::GET, "/friends", None)?;
    let requests: RequestsResponse = request(reqwest::Method::GET, "/friend-requests", None)?;
    let conversations: ConversationsResponse =
        request(reqwest::Method::GET, "/conversations", None)?;
    let groups: GroupsResponse = request(reqwest::Method::GET, "/groups", None)?;
    let invites: InstanceInvitesResponse =
        request(reqwest::Method::GET, "/instance-invites", None)?;
    let _vault_guard = social_vault_io()
        .lock()
        .map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
    let mut vault = load_vault()?;
    vault.profile = Some(me.user.clone());
    let sync_warning = match decrypt_new_envelopes(&mut vault) {
        Ok(warning) => {
            save_vault(&vault)?;
            warning
        }
        Err(error) => {
            // A stale or damaged envelope must not make the account, friends, and
            // already-decrypted local history disappear. Keep the last known-good
            // vault untouched so a later client can retry the encrypted envelope.
            eprintln!("[Bloom Social] encrypted sync paused: {error}");
            vault = load_vault()?;
            Some(error)
        }
    };
    prune_expired_messages(&mut vault);
    save_vault(&vault)?;
    Ok(SocialSnapshot {
        session: SocialSessionState {
            signed_in: true,
            user: Some(me.user),
            needs_username: me.needs_username,
        },
        friends: friends.friends,
        requests: SocialFriendRequests {
            incoming: requests.incoming,
            outgoing: requests.outgoing,
        },
        conversations: conversations.conversations,
        groups: groups.groups,
        invites: invites.invites,
        messages: vault.messages,
        sync_warning,
    })
}

#[tauri::command]
pub async fn social_snapshot() -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let result = snapshot();
        if let Err(error) = &result {
            eprintln!("[Bloom Social] snapshot failed: {error}");
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_wait_for_updates(cursor: Option<String>) -> Result<SocialChange, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let route = match cursor.filter(|value| !value.is_empty()) {
            Some(value) => format!("/changes?after={value}&waitMs=15000"),
            None => "/changes?waitMs=0".to_string(),
        };
        request(reqwest::Method::GET, &route, None)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_sync_messages() -> Result<SocialMessageSync, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _vault_guard = social_vault_io()
            .lock()
            .map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
        let mut vault = load_vault()?;
        let sync_warning = match decrypt_new_envelopes(&mut vault) {
            Ok(warning) => warning,
            Err(error) => {
                eprintln!("[Bloom Social] incremental encrypted sync paused: {error}");
                vault = load_vault()?;
                Some(error)
            }
        };
        prune_expired_messages(&mut vault);
        save_vault(&vault)?;
        Ok(SocialMessageSync {
            messages: vault.messages,
            sync_warning,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_encryption_details(
    friend_id: String,
) -> Result<SocialEncryptionDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _vault_guard = social_vault_io()
            .lock()
            .map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
        let mut vault = load_vault()?;
        let details = encryption_details(&mut vault, &friend_id, None)?;
        save_vault(&vault)?;
        Ok(details)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_acknowledge_identity(
    friend_id: String,
    verified: bool,
) -> Result<SocialEncryptionDetails, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _vault_guard = social_vault_io()
            .lock()
            .map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
        let mut vault = load_vault()?;
        let details = encryption_details(&mut vault, &friend_id, Some(verified))?;
        save_vault(&vault)?;
        Ok(details)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_share_context() -> Result<SocialShareContext, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let me: MeResponse = request(reqwest::Method::GET, "/me", None)?;
        let friends: FriendsResponse = request(reqwest::Method::GET, "/friends", None)?;
        Ok(SocialShareContext {
            session: SocialSessionState {
                signed_in: true,
                user: Some(me.user),
                needs_username: me.needs_username,
            },
            friends: friends.friends,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_send_friend_request(username: String) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        request_empty(
            reqwest::Method::POST,
            "/friend-requests",
            Some(serde_json::json!({ "username": username })),
        )?;
        snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_accept_friend_request(user_id: String) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _: serde_json::Value = request(
            reqwest::Method::POST,
            &format!("/friend-requests/{user_id}/accept"),
            None,
        )?;
        snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_decline_friend_request(user_id: String) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        request_empty(
            reqwest::Method::DELETE,
            &format!("/friend-requests/{user_id}"),
            None,
        )?;
        snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_remove_friend(user_id: String) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        request_empty(
            reqwest::Method::DELETE,
            &format!("/friends/{user_id}"),
            None,
        )?;
        snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_create_instance_invites(
    request_key: String,
    instance_name: String,
    minecraft_version: String,
    loader: String,
    icon_data_url: Option<String>,
    share_mode: String,
    invites: Vec<SocialInstanceInviteTarget>,
    note: Option<String>,
) -> Result<SocialInstanceInviteSendResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let note = note.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
        if note.as_ref().is_some_and(|value| value.chars().count() > 280) {
            return Err("Keep the invite message under 280 characters.".into());
        }
        let response: InstanceInvitesResponse = request(
            reqwest::Method::POST,
            "/instance-invites",
            Some(serde_json::json!({
                "requestKey": request_key,
                "instanceName": instance_name,
                "minecraftVersion": minecraft_version,
                "loader": loader,
                "iconDataUrl": icon_data_url,
                "shareMode": share_mode,
                "invites": invites,
            })),
        )?;
        let mut warning = None;
        if let Some(note) = note {
            for invite in response.invites.iter().filter(|invite| response.new_invite_ids.contains(&invite.id)) {
                let event = PlainEvent {
                    version: 1,
                    id: Uuid::new_v4().to_string(),
                    kind: "message".into(),
                    text: Some(note.clone()),
                    target_id: None,
                    emoji: None,
                    operation: None,
                    attachment: None,
                    subject_sender_id: None,
                    subject_created_at: None,
                    created_at: timestamp(),
                };
                if let Err(error) = send_event(invite.recipient.id.clone(), event, None) {
                    eprintln!("[Bloom Social] invite note delivery will not block the durable invite: {error}");
                    warning.get_or_insert_with(|| "The invites were sent, but a personal message could not be delivered to every recipient.".to_string());
                }
            }
        }
        Ok(SocialInstanceInviteSendResult { invites: response.invites, warning })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_claim_instance_invite(
    invite_id: String,
) -> Result<InstanceInviteClaim, String> {
    tauri::async_runtime::spawn_blocking(move || {
        request(
            reqwest::Method::POST,
            &format!("/instance-invites/{invite_id}/claim"),
            Some(serde_json::json!({})),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn update_instance_invite(
    invite_id: String,
    action: &str,
    claim_token: Option<String>,
) -> Result<SocialSnapshot, String> {
    let _: serde_json::Value = request(
        reqwest::Method::POST,
        &format!("/instance-invites/{invite_id}/{action}"),
        Some(serde_json::json!({ "claimToken": claim_token })),
    )?;
    snapshot()
}

#[tauri::command]
pub async fn social_complete_instance_invite(
    invite_id: String,
    claim_token: String,
) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_instance_invite(invite_id, "complete", Some(claim_token))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_release_instance_invite(
    invite_id: String,
    claim_token: String,
) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        update_instance_invite(invite_id, "release", Some(claim_token))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_decline_instance_invite(invite_id: String) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || update_instance_invite(invite_id, "decline", None))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_revoke_instance_invite(invite_id: String) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || update_instance_invite(invite_id, "revoke", None))
        .await
        .map_err(|error| error.to_string())?
}

fn encrypt_for_recipient(
    vault: &mut SocialVault,
    account: &Account,
    recipient_id: &str,
    plaintext: &[u8],
) -> Result<Vec<serde_json::Value>, String> {
    let mut encrypted = Vec::new();
    let outbound_prefix = format!("out:{recipient_id}:");
    let identity_prefix = format!("{recipient_id}:");
    let directory: DevicesResponse = request(
        reqwest::Method::GET,
        &format!("/users/{recipient_id}/devices"),
        None,
    )?;
    if directory.devices.is_empty() {
        return Err("This person does not have an active encryption device.".into());
    }
    let observed_fingerprint = identity_fingerprint(recipient_id, &directory.devices);
    if observe_contact_identity(vault, recipient_id, &observed_fingerprint) == "key_changed" {
        save_vault(vault)?;
        return Err("This person's encryption identity changed. Review Encryption before sending.".into());
    }
    let live_identities = directory
        .devices
        .iter()
        .map(|device| (device.device_id.clone(), device.curve25519_key.clone()))
        .collect::<HashMap<_, _>>();

    // A device id can survive a local account reset while its Olm identity changes.
    // Reusing that old outbound session makes every new message undecryptable, so
    // validate the identity behind every cached session before encrypting.
    let cached_targets = vault
        .sessions
        .keys()
        .filter_map(|key| key.strip_prefix(&outbound_prefix).map(str::to_string))
        .collect::<Vec<_>>();
    for device_id in cached_targets {
        let identity_key = format!("{identity_prefix}{device_id}");
        let cached_identity = vault.device_identities.get(&identity_key);
        let live_identity = live_identities.get(&device_id);
        if cached_identity != live_identity {
            vault
                .sessions
                .remove(&format!("{outbound_prefix}{device_id}"));
        }
    }
    vault.device_identities.retain(|key, _| {
        !key.starts_with(&identity_prefix)
            || live_identities.contains_key(&key[identity_prefix.len()..])
    });

    let mut target_devices = vault
        .sessions
        .keys()
        .filter_map(|key| key.strip_prefix(&outbound_prefix).map(str::to_string))
        .collect::<Vec<_>>();
    let excluded = target_devices.join(",");
    let bundles: PrekeyResponse = request(
        reqwest::Method::GET,
        &format!("/users/{recipient_id}/prekey-bundle?exclude={excluded}"),
        None,
    )?;
    vault
        .device_refresh
        .insert(recipient_id.to_string(), timestamp());
    for bundle in &bundles.devices {
        if !target_devices.contains(&bundle.device_id) {
            target_devices.push(bundle.device_id.clone());
        }
        vault.device_identities.insert(
            format!("{identity_prefix}{}", bundle.device_id),
            bundle.curve25519_key.clone(),
        );
    }
    for (device_id, curve_key) in &live_identities {
        if vault
            .sessions
            .contains_key(&format!("{outbound_prefix}{device_id}"))
        {
            vault
                .device_identities
                .insert(format!("{identity_prefix}{device_id}"), curve_key.clone());
        }
    }
    for target in target_devices {
        let outbound_session_key = format!("{outbound_prefix}{target}");
        let mut session = if let Some(session) = load_session(&vault, &outbound_session_key)? {
            session
        } else {
            let bundle = bundles
                .devices
                .iter()
                .find(|bundle| bundle.device_id == target)
                .ok_or_else(|| {
                    "Your friend needs to open Bloom Social once before receiving messages."
                        .to_string()
                })?;
            let identity = Curve25519PublicKey::from_base64(&bundle.curve25519_key)
                .map_err(|_| "Your friend's encryption identity was invalid.".to_string())?;
            let one_time = Curve25519PublicKey::from_base64(&bundle.one_time_key)
                .map_err(|_| "Your friend's one-time key was invalid.".to_string())?;
            account
                .create_outbound_session(SessionConfig::version_1(), identity, one_time)
                .map_err(|_| "Bloom could not create an encrypted conversation.".to_string())?
        };
        let ciphertext = serde_json::to_string(
            &session
                .encrypt(&plaintext)
                .map_err(|_| "Bloom could not encrypt this message.".to_string())?,
        )
        .map_err(|error| error.to_string())?;
        save_session(vault, &outbound_session_key, &session)?;
        encrypted.push(serde_json::json!({ "deviceId": target, "ciphertext": ciphertext }));
    }
    if encrypted.is_empty() {
        return Err(
            "That person needs to open Bloom Social once before receiving messages.".into(),
        );
    }
    Ok(encrypted)
}

fn send_event(
    friend_id: String,
    event: PlainEvent,
    local_image_data_url: Option<String>,
) -> Result<SocialMessage, String> {
    let _vault_guard = social_vault_io()
        .lock()
        .map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
    let mut vault = load_vault()?;
    if event.operation.as_deref() == Some("reply") {
        let target = event.target_id.as_deref().ok_or("Reply target not found.")?;
        if !vault.messages.iter().any(|message| {
            message.id == target
                && message.friend_id == friend_id
                && message.group_id.is_none()
                && message.kind == "message"
        }) {
            return Err("Reply target not found.".into());
        }
    }
    let account = load_account(&vault)?;
    let plaintext = serde_json::to_vec(&event).map_err(|error| error.to_string())?;
    let encrypted = encrypt_for_recipient(&mut vault, &account, &friend_id, &plaintext)?;
    let result: serde_json::Value = request(
        reqwest::Method::POST,
        "/envelopes",
        Some(serde_json::json!({
            "recipientId": friend_id, "clientNonce": random_urlsafe(24), "eventKind": event.kind, "envelopes": encrypted,
        })),
    )?;
    let conversation_id = result
        .get("conversationId")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let message = SocialMessage {
        id: event.id,
        conversation_id,
        friend_id: friend_id.clone(),
        group_id: None,
        sender_id: vault
            .profile
            .as_ref()
            .map(|user| user.id.clone())
            .unwrap_or_default(),
        kind: event.kind,
        text: event.text,
        target_id: event.target_id,
        emoji: event.emoji,
        reaction_operation: event.operation,
        image_data_url: local_image_data_url,
        attachment: event.attachment,
        pinned: false,
        edited_at: None,
        created_at: event.created_at,
        delivery_state: "sent".into(),
    };
    vault.messages.push(message.clone());
    save_vault(&vault)?;
    Ok(message)
}

#[tauri::command]
pub async fn social_send_message(
    friend_id: String,
    text: String,
    reply_to: Option<String>,
) -> Result<SocialMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let body = text.trim().to_string();
        if body.is_empty() || body.chars().count() > 2000 {
            return Err("Messages must contain between 1 and 2,000 characters.".into());
        }
        send_event(
            friend_id,
            PlainEvent {
                version: 1,
                id: Uuid::new_v4().to_string(),
                kind: "message".into(),
                text: Some(body),
                target_id: reply_to.clone(),
                emoji: None,
                operation: reply_to.map(|_| "reply".into()),
                attachment: None,
                subject_sender_id: None,
                subject_created_at: None,
                created_at: timestamp(),
            },
            None,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_react(
    friend_id: String,
    message_id: String,
    emoji: String,
    add: bool,
) -> Result<SocialMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if emoji.is_empty() || emoji.chars().count() > 8 {
            return Err("Choose one Unicode emoji reaction.".into());
        }
        send_event(
            friend_id,
            PlainEvent {
                version: 1,
                id: Uuid::new_v4().to_string(),
                kind: "reaction".into(),
                text: None,
                target_id: Some(message_id),
                emoji: Some(emoji),
                operation: Some(if add { "add" } else { "remove" }.into()),
                attachment: None,
                subject_sender_id: None,
                subject_created_at: None,
                created_at: timestamp(),
            },
            None,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_edit_message(
    friend_id: String,
    message_id: String,
    text: String,
) -> Result<SocialMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let body = text.trim().to_string();
        if body.is_empty() || body.chars().count() > 2000 {
            return Err("Messages must contain between 1 and 2,000 characters.".into());
        }
        let _vault_guard = social_vault_io()
            .lock()
            .map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
        let mut vault = load_vault()?;
        let me = vault.profile.as_ref().map(|user| user.id.clone()).ok_or("Bloom account profile is unavailable.")?;
        let original = vault.messages.iter().find(|message| {
            message.id == message_id && message.friend_id == friend_id && message.group_id.is_none()
                && message.kind == "message" && message.sender_id == me && message.text.is_some()
        }).cloned().ok_or("You can only edit your own text messages.")?;
        let event = PlainEvent {
            version: 1,
            id: Uuid::new_v4().to_string(),
            kind: if original.pinned { "pin" } else { "edit" }.into(),
            text: Some(body.clone()),
            target_id: Some(message_id.clone()),
            emoji: None,
            operation: Some(if original.pinned { "update" } else { "edit" }.into()),
            attachment: original.attachment.clone(),
            subject_sender_id: Some(me),
            subject_created_at: Some(original.created_at),
            created_at: timestamp(),
        };
        let account = load_account(&vault)?;
        let encrypted = encrypt_for_recipient(&mut vault, &account, &friend_id, &serde_json::to_vec(&event).map_err(|error| error.to_string())?)?;
        let _: serde_json::Value = request(reqwest::Method::POST, "/envelopes", Some(serde_json::json!({
            "recipientId": friend_id, "clientNonce": random_urlsafe(24), "eventKind": event.kind, "envelopes": encrypted,
        })))?;
        let updated = vault.messages.iter_mut().find(|message| message.id == message_id).ok_or("Message not found.")?;
        updated.text = Some(body);
        updated.edited_at = Some(event.created_at);
        let result = updated.clone();
        save_vault(&vault)?;
        Ok(result)
    }).await.map_err(|error| error.to_string())?
}

fn pin_event(message: &SocialMessage, pinned: bool) -> PlainEvent {
    PlainEvent {
        version: 1,
        id: Uuid::new_v4().to_string(),
        kind: "pin".into(),
        text: pinned.then(|| message.text.clone()).flatten(),
        target_id: Some(message.id.clone()),
        emoji: None,
        operation: Some(if pinned { "add" } else { "remove" }.into()),
        attachment: if pinned {
            message.attachment.clone()
        } else {
            None
        },
        subject_sender_id: Some(message.sender_id.clone()),
        subject_created_at: Some(message.created_at),
        created_at: timestamp(),
    }
}

fn update_attachment_retention(
    attachment: Option<&AttachmentDescriptor>,
    pinned: bool,
) -> Result<(), String> {
    if let Some(attachment) = attachment {
        let _: serde_json::Value = request(
            reqwest::Method::PATCH,
            &format!("/blobs/{}", attachment.blob_id),
            Some(serde_json::json!({ "pinned": pinned })),
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn social_pin_message(
    friend_id: String,
    message_id: String,
    pinned: bool,
) -> Result<SocialMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _vault_guard = social_vault_io()
            .lock()
            .map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
        let mut vault = load_vault()?;
        let message = vault.messages.iter().find(|message| message.id == message_id && message.friend_id == friend_id && message.group_id.is_none() && message.kind == "message").cloned().ok_or("Message not found.")?;
        if message.pinned == pinned { return Ok(message); }
        let event = pin_event(&message, pinned);
        let account = load_account(&vault)?;
        let plaintext = serde_json::to_vec(&event).map_err(|error| error.to_string())?;
        let encrypted = encrypt_for_recipient(&mut vault, &account, &friend_id, &plaintext)?;
        let _: serde_json::Value = request(reqwest::Method::POST, "/envelopes", Some(serde_json::json!({
            "recipientId": friend_id, "clientNonce": random_urlsafe(24), "eventKind": "pin", "envelopes": encrypted,
        })))?;
        update_attachment_retention(message.attachment.as_ref(), pinned)?;
        let updated = vault.messages.iter_mut().find(|item| item.id == message_id).ok_or("Message not found.")?;
        updated.pinned = pinned;
        let result = updated.clone();
        prune_expired_messages(&mut vault);
        save_vault(&vault)?;
        Ok(result)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_send_screenshot(friend_id: String) -> Result<Option<SocialMessage>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Screenshot", &["png", "jpg", "jpeg", "webp"])
            .pick_file()
        else {
            return Ok(None);
        };
        let (bytes, width, height) = normalize_screenshot(&path)?;
        let (attachment, image_data_url) = encrypt_screenshot(&friend_id, &bytes, width, height)?;
        send_event(
            friend_id,
            PlainEvent {
                version: 1,
                id: Uuid::new_v4().to_string(),
                kind: "message".into(),
                text: None,
                target_id: None,
                emoji: None,
                operation: None,
                attachment: Some(attachment),
                subject_sender_id: None,
                subject_created_at: None,
                created_at: timestamp(),
            },
            Some(image_data_url),
        )
        .map(Some)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_create_group(
    name: String,
    member_ids: Vec<String>,
) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _: serde_json::Value = request(
            reqwest::Method::POST,
            "/groups",
            Some(serde_json::json!({ "name": name, "memberIds": member_ids })),
        )?;
        snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_update_group(
    group_id: String,
    name: Option<String>,
    icon_data_url: Option<String>,
) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut body = serde_json::Map::new();
        if let Some(name) = name {
            body.insert("name".into(), serde_json::Value::String(name));
        }
        if let Some(icon) = icon_data_url {
            body.insert("iconDataUrl".into(), serde_json::Value::String(icon));
        }
        let _: serde_json::Value = request(
            reqwest::Method::PATCH,
            &format!("/groups/{group_id}"),
            Some(body.into()),
        )?;
        snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_add_group_member(
    group_id: String,
    user_id: String,
) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _: serde_json::Value = request(
            reqwest::Method::POST,
            &format!("/groups/{group_id}/members"),
            Some(serde_json::json!({ "userId": user_id })),
        )?;
        snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_remove_group_member(
    group_id: String,
    user_id: String,
) -> Result<SocialSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _: serde_json::Value = request(
            reqwest::Method::DELETE,
            &format!("/groups/{group_id}/members/{user_id}"),
            None,
        )?;
        snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

fn send_group_event(group_id: String, event: PlainEvent) -> Result<SocialMessage, String> {
    let groups: GroupsResponse = request(reqwest::Method::GET, "/groups", None)?;
    let group = groups
        .groups
        .into_iter()
        .find(|group| group.id == group_id)
        .ok_or("Group chat not found.")?;
    let _vault_guard = social_vault_io()
        .lock()
        .map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
    let mut vault = load_vault()?;
    if event.operation.as_deref() == Some("reply") {
        let target = event.target_id.as_deref().ok_or("Reply target not found.")?;
        if !vault.messages.iter().any(|message| {
            message.id == target
                && message.group_id.as_deref() == Some(group_id.as_str())
                && message.kind == "message"
        }) {
            return Err("Reply target not found.".into());
        }
    }
    let account = load_account(&vault)?;
    let me = vault
        .profile
        .as_ref()
        .map(|user| user.id.clone())
        .ok_or("Bloom account profile is unavailable.")?;
    let plaintext = serde_json::to_vec(&event).map_err(|error| error.to_string())?;
    let mut batches = Vec::new();
    for member in group.members.iter().filter(|member| member.id != me) {
        let label = member.display_name.as_deref().or(member.username.as_deref()).unwrap_or("A group member");
        let envelopes = encrypt_for_recipient(&mut vault, &account, &member.id, &plaintext).map_err(|error| {
            if error.contains("encryption identity changed") {
                format!("{label}'s encryption identity changed. Review Encryption in your direct message with them before sending to this group.")
            } else { error }
        })?;
        batches.push((member.id.clone(), envelopes));
    }
    if batches.is_empty() {
        return Err("Add someone to this group before sending a message.".into());
    }
    let client_nonce = random_urlsafe(24);
    for (recipient_id, envelopes) in batches {
        let _: serde_json::Value = request(
            reqwest::Method::POST,
            &format!("/groups/{group_id}/envelopes"),
            Some(serde_json::json!({
                "recipientId": recipient_id, "clientNonce": client_nonce, "eventKind": event.kind, "envelopes": envelopes,
            })),
        )?;
    }
    let message = SocialMessage {
        id: event.id,
        conversation_id: group_id.clone(),
        friend_id: String::new(),
        group_id: Some(group_id),
        sender_id: me,
        kind: event.kind,
        text: event.text,
        target_id: event.target_id,
        emoji: event.emoji,
        reaction_operation: event.operation,
        image_data_url: None,
        attachment: event.attachment,
        pinned: false,
        edited_at: None,
        created_at: event.created_at,
        delivery_state: "sent".into(),
    };
    vault.messages.push(message.clone());
    save_vault(&vault)?;
    Ok(message)
}

#[tauri::command]
pub async fn social_send_group_message(
    group_id: String,
    text: String,
    reply_to: Option<String>,
) -> Result<SocialMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let body = text.trim().to_string();
        if body.is_empty() || body.chars().count() > 2000 {
            return Err("Messages must contain between 1 and 2,000 characters.".into());
        }
        send_group_event(
            group_id,
            PlainEvent {
                version: 1,
                id: Uuid::new_v4().to_string(),
                kind: "message".into(),
                text: Some(body),
                target_id: reply_to.clone(),
                emoji: None,
                operation: reply_to.map(|_| "reply".into()),
                attachment: None,
                subject_sender_id: None,
                subject_created_at: None,
                created_at: timestamp(),
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_react_group(
    group_id: String,
    message_id: String,
    emoji: String,
    add: bool,
) -> Result<SocialMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if emoji.is_empty() || emoji.chars().count() > 8 {
            return Err("Choose one Unicode emoji reaction.".into());
        }
        send_group_event(
            group_id,
            PlainEvent {
                version: 1,
                id: Uuid::new_v4().to_string(),
                kind: "reaction".into(),
                text: None,
                target_id: Some(message_id),
                emoji: Some(emoji),
                operation: Some(if add { "add" } else { "remove" }.into()),
                attachment: None,
                subject_sender_id: None,
                subject_created_at: None,
                created_at: timestamp(),
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_edit_group_message(
    group_id: String,
    message_id: String,
    text: String,
) -> Result<SocialMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let body = text.trim().to_string();
        if body.is_empty() || body.chars().count() > 2000 {
            return Err("Messages must contain between 1 and 2,000 characters.".into());
        }
        let groups: GroupsResponse = request(reqwest::Method::GET, "/groups", None)?;
        let group = groups.groups.into_iter().find(|group| group.id == group_id).ok_or("Group chat not found.")?;
        let _vault_guard = social_vault_io().lock().map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
        let mut vault = load_vault()?;
        let account = load_account(&vault)?;
        let me = vault.profile.as_ref().map(|user| user.id.clone()).ok_or("Bloom account profile is unavailable.")?;
        let original = vault.messages.iter().find(|message| {
            message.id == message_id && message.group_id.as_deref() == Some(group_id.as_str())
                && message.kind == "message" && message.sender_id == me && message.text.is_some()
        }).cloned().ok_or("You can only edit your own text messages.")?;
        let event = PlainEvent {
            version: 1,
            id: Uuid::new_v4().to_string(),
            kind: if original.pinned { "pin" } else { "edit" }.into(),
            text: Some(body.clone()),
            target_id: Some(message_id.clone()),
            emoji: None,
            operation: Some(if original.pinned { "update" } else { "edit" }.into()),
            attachment: original.attachment.clone(),
            subject_sender_id: Some(me.clone()),
            subject_created_at: Some(original.created_at),
            created_at: timestamp(),
        };
        let plaintext = serde_json::to_vec(&event).map_err(|error| error.to_string())?;
        let mut batches = Vec::new();
        for member in group.members.iter().filter(|member| member.id != me) {
            let envelopes = encrypt_for_recipient(&mut vault, &account, &member.id, &plaintext)?;
            batches.push((member.id.clone(), envelopes));
        }
        let client_nonce = random_urlsafe(24);
        for (recipient_id, envelopes) in batches {
            let _: serde_json::Value = request(reqwest::Method::POST, &format!("/groups/{group_id}/envelopes"), Some(serde_json::json!({
                "recipientId": recipient_id, "clientNonce": client_nonce, "eventKind": event.kind, "envelopes": envelopes,
            })))?;
        }
        let updated = vault.messages.iter_mut().find(|message| message.id == message_id).ok_or("Message not found.")?;
        updated.text = Some(body);
        updated.edited_at = Some(event.created_at);
        let result = updated.clone();
        save_vault(&vault)?;
        Ok(result)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_pin_group_message(
    group_id: String,
    message_id: String,
    pinned: bool,
) -> Result<SocialMessage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let groups: GroupsResponse = request(reqwest::Method::GET, "/groups", None)?;
        let group = groups.groups.into_iter().find(|group| group.id == group_id).ok_or("Group chat not found.")?;
        let _vault_guard = social_vault_io()
            .lock()
            .map_err(|_| "Bloom Social's local message store is busy.".to_string())?;
        let mut vault = load_vault()?;
        let message = vault.messages.iter().find(|message| message.id == message_id && message.group_id.as_deref() == Some(group_id.as_str()) && message.kind == "message").cloned().ok_or("Message not found.")?;
        if message.pinned == pinned { return Ok(message); }
        let event = pin_event(&message, pinned);
        let plaintext = serde_json::to_vec(&event).map_err(|error| error.to_string())?;
        let account = load_account(&vault)?;
        let me = vault.profile.as_ref().map(|user| user.id.clone()).ok_or("Bloom account profile is unavailable.")?;
        let mut batches = Vec::new();
        for member in group.members.iter().filter(|member| member.id != me) {
            let label = member.display_name.as_deref().or(member.username.as_deref()).unwrap_or("A group member");
            let envelopes = encrypt_for_recipient(&mut vault, &account, &member.id, &plaintext).map_err(|error| {
                if error.contains("encryption identity changed") {
                    format!("{label}'s encryption identity changed. Review Encryption in your direct message with them before changing pins in this group.")
                } else { error }
            })?;
            batches.push((member.id.clone(), envelopes));
        }
        if batches.is_empty() { return Err("Add someone to this group before pinning a message.".into()); }
        let client_nonce = random_urlsafe(24);
        for (recipient_id, envelopes) in batches {
            let _: serde_json::Value = request(reqwest::Method::POST, &format!("/groups/{group_id}/envelopes"), Some(serde_json::json!({
                "recipientId": recipient_id, "clientNonce": client_nonce, "eventKind": "pin", "envelopes": envelopes,
            })))?;
        }
        let updated = vault.messages.iter_mut().find(|item| item.id == message_id).ok_or("Message not found.")?;
        updated.pinned = pinned;
        let result = updated.clone();
        prune_expired_messages(&mut vault);
        save_vault(&vault)?;
        Ok(result)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn social_sign_out() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let token_name = profile_secret("tokens");
        delete_secret(&token_name)?;
        // Clear the pre-profile migration credential too, otherwise it can be
        // picked up on the next launch and restore an account the user removed.
        delete_secret("tokens")?;
        delete_secret("active-profile")
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod security_tests {
    use super::*;

    fn device(id: &str, curve: &str, signing: &str) -> DeviceIdentity {
        DeviceIdentity {
            device_id: id.into(),
            curve25519_key: curve.into(),
            ed25519_key: signing.into(),
        }
    }

    #[test]
    fn safety_number_is_symmetric_and_grouped() {
        let (first, _) = safety_number("a", "fingerprint-a", "b", "fingerprint-b");
        let (second, _) = safety_number("b", "fingerprint-b", "a", "fingerprint-a");
        assert_eq!(first, second);
        assert_eq!(first.split_whitespace().count(), 12);
        assert!(first.split_whitespace().all(|group| group.len() == 5));
    }

    #[test]
    fn device_order_does_not_change_the_identity() {
        let first = vec![device("two", "curve-2", "sign-2"), device("one", "curve-1", "sign-1")];
        let second = vec![device("one", "curve-1", "sign-1"), device("two", "curve-2", "sign-2")];
        assert_eq!(identity_fingerprint("friend", &first), identity_fingerprint("friend", &second));
    }

    #[test]
    fn an_observed_change_requires_an_explicit_decision() {
        let mut vault = SocialVault::default();
        assert_eq!(observe_contact_identity(&mut vault, "friend", "first"), "not_verified");
        assert_eq!(observe_contact_identity(&mut vault, "friend", "second"), "key_changed");
        assert_eq!(vault.contact_security["friend"].known_fingerprint, "first");
    }
}
