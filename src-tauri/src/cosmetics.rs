use super::*;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path, sync::Mutex};

include!(concat!(env!("OUT_DIR"), "/cosmetics_bundle.rs"));
const MANIFEST: &str = ".bloom-cosmetics.json";
const FILE: &str = "bloom-cosmetics-1.21.11.jar";
static INSTALL_LOCK: Mutex<()> = Mutex::new(());
// The cape backend is live. Development/emergency builds can still compile the
// integration out explicitly with BLOOM_COSMETICS_ENABLED=false.
pub fn live() -> bool { option_env!("BLOOM_COSMETICS_ENABLED") != Some("false") }

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Preferences { pub enabled: bool }
impl Default for Preferences { fn default() -> Self { Self { enabled: true } } }
#[derive(serde::Serialize, serde::Deserialize)]
struct Ownership {
    sha256: String, disabled: bool,
    #[serde(default)] global_disabled: bool,
    #[serde(default)] previous_sha256: Option<String>,
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn preferences() -> Result<Preferences, String> {
    let path = bloom_data_dir()?.join("cosmetics-preferences.json");
    if !path.exists() { return Ok(Preferences::default()); }
    serde_json::from_slice(&fs::read(path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("bloom-part");
    use std::io::Write;
    let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temporary)
        .map_err(|_|"An interrupted cape update needs attention. Remove only the .bloom-part file after closing Minecraft.".to_string())?;
    let result = (|| { file.write_all(bytes)?; file.sync_all()?; drop(file); fs::rename(&temporary,path) })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result.map_err(|e|e.to_string())
}
fn mod_id(path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let entry = archive.by_name("fabric.mod.json").ok()?;
    if entry.size() > 65536 { return None; }
    let mut bytes=Vec::new(); entry.take(65537).read_to_end(&mut bytes).ok()?;
    serde_json::from_slice::<serde_json::Value>(&bytes).ok()?["id"].as_str().map(str::to_owned)
}
pub fn supported(config: &InstanceConfig) -> bool {
    config.visible && config.loader.eq_ignore_ascii_case("fabric") && config.version == "1.21.11"
}
pub fn reconcile(config: &InstanceConfig) -> Result<(), String> {
    if !live() || !supported(config) { return Ok(()); }
    let _guard = INSTALL_LOCK.lock().map_err(|_|"Cape installer is busy")?;
    let mods = Path::new(&config.directory).join("mods");
    fs::create_dir_all(&mods).map_err(|e|e.to_string())?;
    let manifest_path=mods.join(MANIFEST);
    let ownership: Option<Ownership> = if manifest_path.exists() {
        Some(serde_json::from_slice(&fs::read(&manifest_path).map_err(|e|e.to_string())?).map_err(|_|"The cape ownership record is invalid; no files were changed.")?)
    } else { None };
    let installed=mods.join(FILE); let disabled=mods.join(format!("{FILE}.disabled"));
    if let Some(ref record)=ownership {
        let path=if installed.exists(){&installed}else{&disabled};
        if path.exists() && {
            let actual=digest(&fs::read(path).map_err(|e|e.to_string())?);
            actual != record.sha256 && Some(&actual) != record.previous_sha256.as_ref()
        } {
            return Err("The managed Bloom cape mod was modified. Move it out of mods before repairing; it was not overwritten.".into());
        }
        if installed.exists() && disabled.exists() { return Err("Both enabled and disabled Bloom cape files exist. Close Minecraft and resolve the duplicate before retrying.".into()); }
        // Only an explicit disabled record or its owned `.disabled` file means the
        // player opted out. An enabled manifest with both files missing is an
        // interrupted/deleted managed install and must be repaired below.
        if record.disabled || (!record.global_disabled && disabled.exists()) { return Ok(()); }
    }
    if !preferences()?.enabled {
        if ownership.is_some() && installed.exists() {
            if disabled.exists() { return Err("Both enabled and disabled Bloom cape files exist.".into()); }
            let mut record=ownership.unwrap();record.global_disabled=true;
            atomic(&manifest_path,&serde_json::to_vec(&record).map_err(|e|e.to_string())?)?;
            fs::rename(installed,disabled).map_err(|e|e.to_string())?;
        }
        return Ok(());
    }
    if ownership.as_ref().is_some_and(|record|record.global_disabled) && disabled.exists() {
        if installed.exists() { return Err("Both enabled and disabled cape files exist. No files were replaced.".into()); }
        fs::rename(&disabled,&installed).map_err(|e|e.to_string())?;
    }
    for entry in fs::read_dir(&mods).map_err(|e|e.to_string())? {
        let path=entry.map_err(|e|e.to_string())?.path();
        if path.extension().and_then(|v|v.to_str()) != Some("jar") { continue; }
        if mod_id(&path).as_deref()==Some("bloom_cosmetics") && (path != installed || ownership.is_none()) {
            return Err("Another Bloom cosmetics mod is already in this instance. Move it out of mods, then retry; no user files were removed.".into());
        }
    }
    if let Some(version)=config.loader_version.as_deref() {
        let numbers:Vec<u32>=version.split('.').map(|v|v.parse().unwrap_or(0)).collect();
        if numbers.as_slice() < [0,19,2].as_slice() { return Err("Bloom capes need Fabric Loader 0.19.2 or newer. Update the instance loader or disable Bloom cosmetics.".into()); }
    }
    if BUNDLED_JAR.is_empty() { return Err("This development build has no cape renderer. Build cosmetics first or disable the integration.".into()); }
    let sha=digest(BUNDLED_JAR);
    if sha != BUNDLED_SHA { return Err("The bundled cape renderer failed its checksum.".into()); }
    if ownership.as_ref().is_some_and(|o|o.sha256==sha) && installed.exists() && digest(&fs::read(&installed).map_err(|e|e.to_string())?)==sha {
        if ownership.as_ref().is_some_and(|o|o.global_disabled || o.previous_sha256.is_some()) {
            atomic(&manifest_path,&serde_json::to_vec(&Ownership{sha256:sha,disabled:false,global_disabled:false,previous_sha256:None}).map_err(|e|e.to_string())?)?;
        }
        return Ok(());
    }
    if installed.exists() && ownership.is_none() { return Err("The cape filename is occupied by an unmanaged file.".into()); }
    let previous=ownership.as_ref().map(|o|o.sha256.clone());
    atomic(&manifest_path,&serde_json::to_vec(&Ownership{sha256:sha.clone(),disabled:false,global_disabled:false,previous_sha256:previous}).map_err(|e|e.to_string())?)?;
    atomic(&installed,BUNDLED_JAR)?;
    atomic(&manifest_path,&serde_json::to_vec(&Ownership{sha256:sha,disabled:false,global_disabled:false,previous_sha256:None}).map_err(|e|e.to_string())?)
}

#[tauri::command]
pub fn get_cosmetics_preferences() -> Result<serde_json::Value,String> {
    Ok(serde_json::json!({"enabled":preferences()?.enabled,"available":live()}))
}
#[tauri::command]
pub fn set_cosmetics_preferences(enabled:bool,state:tauri::State<'_,LauncherState>) -> Result<(),String> {
    let active = state.launch_active.lock().map_err(|_|"Launcher busy")?;
    if *active { return Err("Close Minecraft before changing its cosmetics integration.".into()); }
    let _guard=INSTALL_LOCK.lock().map_err(|_|"Cape installer busy")?;
    atomic(&bloom_data_dir()?.join("cosmetics-preferences.json"),&serde_json::to_vec(&Preferences{enabled}).map_err(|e|e.to_string())?)
}
#[tauri::command]
pub async fn reconcile_cosmetics(state:tauri::State<'_,LauncherState>) -> Result<Vec<String>,String> {
    let active=state.launch_active.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let busy=active.lock().map_err(|_|"Launcher busy")?;
        if *busy { return Ok(Vec::new()); }
        let mut errors=Vec::new();
        for config in list_instances_blocking()? { if let Err(error)=reconcile(&config) { errors.push(format!("{}: {}",config.name,error)); } }
        Ok(errors)
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn cosmetics_request(method:String,path:String,body:Option<serde_json::Value>,account_id:Option<String>) -> Result<serde_json::Value,String> {
    let authorized=matches!((method.as_str(),path.as_str()),("GET","/v1/cosmetics/me")|("PUT","/v1/capes/equipped")|("PUT","/v1/cosmetics/badge"));
    if !authorized && !(method=="GET" && path=="/v1/capes") { return Err("Unsupported cape operation".into()); }
    if !live() { return Err("Capes are awaiting backend activation and multiplayer verification in this build.".into()); }
    let mut session=if authorized { Some(saved_session().ok_or("Sign in to Minecraft first.")?) } else { None };
    if let Some(ref value)=session { if account_id.as_deref()!=Some(value.uuid.as_str()) { return Err("The account changed. Open Locker again.".into()); } }
    for attempt in 0..2 {
        let mut request=bloom_backend_request(reqwest::Method::from_bytes(method.as_bytes()).map_err(|e|e.to_string())?,&path,12)?;
        if let Some(ref s)=session { request=request.bearer_auth(&s.access_token); }
        if let Some(ref value)=body { request=request.json(value); }
        let response=request.send().await.map_err(|_|"The cape service could not be reached.".to_string())?;
        if response.status()==401 && attempt==0 {
            if let Some(ref s)=session { let refreshed=refresh_minecraft_session(s).await?; save_account_session(&refreshed,false)?; session=Some(refreshed); continue; }
        }
        if !response.status().is_success() { return Err(format!("The cape service could not complete this action ({}).",response.status())); }
        return response.json().await.map_err(|_|"Invalid cape service response.".into());
    }
    Err("Sign in again to update your cape.".into())
}

// Environment handoff is inherited only by the child; no long-lived token is
// written to disk, logged, or exposed in command-line arguments.
pub fn attach_session(process:&mut std::process::Command,config:&InstanceConfig,session:&MinecraftSession) {
    if !live() || !supported(config) || !preferences().map(|p|p.enabled).unwrap_or(false) { return; }
    let result=(|| -> Result<serde_json::Value,reqwest::Error> {
        reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(4)).build()?
            .post(format!("{}/v1/cosmetics/sessions",BACKEND_URL.trim_end_matches('/')))
            .bearer_auth(&session.access_token).send()?.error_for_status()?.json()
    })();
    if let Ok(value)=result {
        if let Some(token)=value["token"].as_str().filter(|v|v.starts_with("bcs_") && v.len()==47) {
            process.env("BLOOM_COSMETICS_SESSION",token).env("BLOOM_COSMETICS_UUID",&session.uuid);
        }
    }
}

pub fn is_managed_file(file:&str) -> bool { file==FILE || file==format!("{FILE}.disabled") }

pub fn set_file_enabled(config:&InstanceConfig,file:&str,enabled:bool)->Result<bool,String>{
    if !is_managed_file(file) { return Ok(false); }
    let _guard=INSTALL_LOCK.lock().map_err(|_|"Cape installer busy")?;
    let folder=Path::new(&config.directory).join("mods");let path=folder.join(MANIFEST);
    if !path.exists(){return Ok(false);}
    let mut record:Ownership=serde_json::from_slice(&fs::read(&path).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let source=folder.join(file);let target=folder.join(if enabled{FILE.to_owned()}else{format!("{FILE}.disabled")});
    if digest(&fs::read(&source).map_err(|e|e.to_string())?)!=record.sha256{return Err("Managed cape file has changed; no files were replaced.".into());}
    if source!=target { if target.exists(){return Err("Target cape file already exists.".into());}fs::rename(source,target).map_err(|e|e.to_string())?; }
    record.disabled=!enabled;record.global_disabled=false;
    atomic(&path,&serde_json::to_vec(&record).map_err(|e|e.to_string())?)?;Ok(true)
}
