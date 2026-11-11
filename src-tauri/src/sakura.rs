//! Native engine boundary: fixed executable, verified vanilla assets, private account pipe.
use super::*;
use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, Read, Write},
    path::PathBuf,
    process::{Child, Stdio},
    time::{Duration, Instant},
};

pub(super) const VERSION: &str = "26.1";

#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Engine {
    #[default]
    Java,
    Sakura,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct Settings {
    pub server: String,
    pub render_distance: u8,
    pub fps_limit: u16,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            server: String::new(),
            render_distance: 8,
            fps_limit: 0,
        }
    }
}
impl Settings {
    pub(super) fn validate(&self) -> Result<(), String> {
        let server = self.server.trim();
        if server.is_empty()
            || server.len() > 253
            || server
                .chars()
                .any(|c| c.is_whitespace() || c.is_control() || "/\\@?#".contains(c))
        {
            return Err("Enter a Minecraft server address, such as play.example.com:25565.".into());
        }
        if let Ok(address) = server.parse::<std::net::SocketAddr>() {
            if address.port() == 0 {
                return Err("The server port must be between 1 and 65535.".into());
            }
        } else if server.parse::<std::net::IpAddr>().is_err() {
            let host = if let Some((host, port)) = server.split_once(':') {
                if port.parse::<u16>().ok().filter(|port| *port > 0).is_none() {
                    return Err("The server port must be between 1 and 65535.".into());
                }
                host
            } else {
                server
            };
            if host.is_empty()
                || !host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
            {
                return Err("Use a server hostname or IP address, not a URL.".into());
            }
        }
        if !(2..=16).contains(&self.render_distance) {
            return Err("Sakura render distance must be between 2 and 16 chunks.".into());
        }
        if self.fps_limit > 1000 {
            return Err("Sakura frame limit must be 0 (VSync) or at most 1000 FPS.".into());
        }
        Ok(())
    }
}

pub(super) fn validate(config: &InstanceConfig) -> Result<(), String> {
    if config.engine != Engine::Sakura {
        return Ok(());
    }
    if config.version != VERSION || config.loader != "Vanilla" || config.loader_version.is_some() {
        return Err("Sakura Alpha supports vanilla Minecraft 26.1 servers. Java loaders cannot run in Sakura.".into());
    }
    config
        .sakura
        .as_ref()
        .ok_or("Configure this Sakura instance's server first.")?
        .validate()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Availability {
    available: bool,
    minecraft: &'static str,
    message: String,
}

fn executable(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../sakura/target/release")
        .join(if cfg!(windows) {
            "sakura.exe"
        } else {
            "sakura"
        });
    #[cfg(all(not(debug_assertions), target_os = "macos"))]
    let path = std::env::current_exe().map_err(|error| error.to_string())?
        .parent().ok_or("The Bloom application directory is unavailable.")?.join("sakura");
    #[cfg(all(not(debug_assertions), not(target_os = "macos")))]
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/sakura")
        .join(if cfg!(windows) {
            "sakura.exe"
        } else {
            "sakura"
        });
    let _ = app;
    if !path.is_file() {
        return Err(if cfg!(debug_assertions) { "Sakura is not installed in this build. Run npm run build:sakura, then reopen New Instance." } else { "Sakura is unavailable in this installation. Reinstall Bloom to restore the native engine." }.into());
    }
    path.canonicalize()
        .map_err(|_| "The bundled Sakura executable is unavailable.".into())
}

fn supported_caps(value: &serde_json::Value) -> bool {
    value["engine"] == "sakura"
        && value["schema"] == 1
        && value["minecraft"] == VERSION
        && value["stage"] == "alpha"
        && value["playable"] == true
        && value["asset_renderer"] == true
        && value["requires_private_session"] == true
}

fn checked_executable(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    static CHECKED: OnceLock<Mutex<Option<launch_cache::Stamp>>> = OnceLock::new();
    let path = executable(app)?;
    let stamp =
        launch_cache::Stamp::read(&path).ok_or("Could not inspect the bundled Sakura engine.")?;
    let mut cached = CHECKED
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Sakura availability check is busy.")?;
    if cached.as_ref() == Some(&stamp) {
        return Ok(path);
    }
    let mut child = command_without_console(&path)
        .arg("--capabilities")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Sakura could not start: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(3);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The bundled Sakura engine did not respond.".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let mut output = String::new();
    if let Some(stdout) = child.stdout.take() {
        stdout
            .take(16_384)
            .read_to_string(&mut output)
            .map_err(|_| "Invalid Sakura capability response.")?;
    }
    let caps = output.lines().find_map(|line| {
        serde_json::from_str::<serde_json::Value>(line)
            .ok()
            .filter(supported_caps)
    });
    if !status.success() || caps.is_none() {
        return Err("This Sakura build is not a compatible playable 26.1 Alpha. Rebuild Sakura before using it.".into());
    }
    *cached = Some(stamp);
    Ok(path)
}

#[tauri::command]
pub(super) async fn get_sakura_availability(app: tauri::AppHandle) -> Availability {
    let result = tauri::async_runtime::spawn_blocking(move || checked_executable(&app)).await;
    match result {
        Ok(Ok(_)) => Availability {
            available: true,
            minecraft: VERSION,
            message: "Minecraft 26.1 servers · Native Alpha".into(),
        },
        Ok(Err(message)) => Availability {
            available: false,
            minecraft: VERSION,
            message,
        },
        Err(_) => Availability {
            available: false,
            minecraft: VERSION,
            message: "Sakura could not be checked.".into(),
        },
    }
}

pub(super) struct Prepared {
    executable: PathBuf,
    assets: PathBuf,
    cache: PathBuf,
}

pub(super) fn prepare(
    app: &tauri::AppHandle,
    config: &InstanceConfig,
    cancel: &AtomicBool,
    repair: bool,
) -> Result<Prepared, String> {
    validate(config)?;
    let executable = checked_executable(app)?;
    let root = bloom_data_dir()?.join("minecraft");
    let assets = root
        .join("versions")
        .join(VERSION)
        .join(format!("{VERSION}.jar"));
    let receipt_key = format!("v1:{}:{VERSION}", assets.display());
    let valid = !repair
        && cache::read_json::<launch_cache::Receipt>("sakura-assets", &receipt_key, None)
            .map(|r| r.valid_files())
            .unwrap_or(false);
    if !valid {
        if cancel.load(Ordering::SeqCst) {
            return Err("__cancelled__".into());
        }
        emit_launch(
            app,
            &config.id,
            "installing",
            3,
            "Preparing official Minecraft textures",
        );
        let version = mc_launcher_core::install::client::fetch_vanilla_version(VERSION)
            .map_err(|e| format!("Could not look up official Minecraft textures: {e}"))?;
        let client = version
            .downloads
            .get("client")
            .ok_or("Minecraft's official client download is missing.")?;
        let url =
            url::Url::parse(&client.url).map_err(|_| "Invalid official asset download URL.")?;
        if url.scheme() != "https"
            || !matches!(
                url.host_str(),
                Some(
                    "piston-data.mojang.com"
                        | "resources.download.minecraft.net"
                        | "launcher.mojang.com"
                )
            )
        {
            return Err(
                "Minecraft asset metadata did not point to an official HTTPS download.".into(),
            );
        }
        let checksum = &client.sha1;
        if checksum.len() != 40 || !checksum.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Minecraft asset metadata is missing its checksum.".into());
        }
        let plan = mc_launcher_core::net::download::DownloadPlan {
            tasks: vec![mc_launcher_core::net::download::DownloadTask {
                url: client.url.clone(),
                destination: assets.clone(),
                checksum: Some(mc_launcher_core::net::download::Checksum::Sha1(
                    checksum.clone(),
                )),
                label: "Minecraft 26.1 texture archive".into(),
            }],
        };
        execute_download_plan(
            app,
            &config.id,
            &plan,
            cancel,
            5,
            90,
            "Downloading official Minecraft textures",
            false,
        )?;
        if let Some(receipt) = launch_cache::Receipt::capture(VERSION.into(), vec![assets.clone()])
        {
            let _ = cache::write_json("sakura-assets", &receipt_key, &receipt);
        }
    }
    let cache = bloom_data_dir()?.join("sakura/cache");
    std::fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
    Ok(Prepared {
        executable,
        assets,
        cache,
    })
}

#[derive(Serialize)]
struct PrivateSession<'a> {
    minecraft_access_token: &'a str,
    uuid: &'a str,
    username: &'a str,
}

fn arguments(config: &InstanceConfig, prepared: &Prepared) -> Vec<std::ffi::OsString> {
    let settings = config.sakura.as_ref().expect("validated Sakura settings");
    vec![
        "--server".into(),
        settings.server.trim().into(),
        "--assets".into(),
        prepared.assets.as_os_str().to_owned(),
        "--cache-dir".into(),
        prepared.cache.as_os_str().to_owned(),
        "--session-stdin".into(),
        "--render-distance".into(),
        settings.render_distance.to_string().into(),
        "--fps-limit".into(),
        settings.fps_limit.to_string().into(),
    ]
}

struct ReapChild(Child);
impl Drop for ReapChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

pub(super) fn run(
    app: &tauri::AppHandle,
    config: &InstanceConfig,
    prepared: Prepared,
    session: &MinecraftSession,
    cancel: &AtomicBool,
    game_running: &AtomicBool,
    started: Instant,
    debug_logging: bool,
) -> Result<(), String> {
    validate(config)?;
    if cancel.load(Ordering::SeqCst) {
        return Err("__cancelled__".into());
    }
    let child = command_without_console(&prepared.executable)
        .args(arguments(config, &prepared))
        .current_dir(&config.directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Sakura could not start: {e}"))?;
    let mut child = ReapChild(child);
    {
        let mut input = child
            .0
            .stdin
            .take()
            .ok_or("Sakura's private sign-in pipe is unavailable.")?;
        serde_json::to_writer(
            &mut input,
            &PrivateSession {
                minecraft_access_token: &session.access_token,
                uuid: &session.uuid,
                username: &session.username,
            },
        )
        .map_err(|_| "Could not deliver the Minecraft session to Sakura.")?;
        input
            .write_all(b"\n")
            .map_err(|_| "Sakura closed its private sign-in pipe.")?;
    }
    game_running.store(true, Ordering::SeqCst);
    let _ = app.emit("minecraft-process-state", true);
    emit_launch(app, &config.id, "launching", 96, "Opening Sakura");
    emit_game_log(
        app,
        &config.id,
        "launcher",
        format!(
            "Sakura timing: Play to process {} ms",
            started.elapsed().as_millis()
        ),
    );
    let (send, receive) = std::sync::mpsc::sync_channel(128);
    fn read_pipe(
        pipe: impl Read + Send + 'static,
        stream: &'static str,
        sender: std::sync::mpsc::SyncSender<(&'static str, String)>,
    ) {
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(pipe);
            loop {
                let mut bytes = Vec::new();
                if reader
                    .by_ref()
                    .take(16_385)
                    .read_until(b'\n', &mut bytes)
                    .unwrap_or(0)
                    == 0
                {
                    break;
                }
                if bytes.len() > 16_384 {
                    break;
                }
                if sender
                    .send((
                        stream,
                        String::from_utf8_lossy(&bytes).trim_end().to_owned(),
                    ))
                    .is_err()
                {
                    break;
                }
            }
        });
    }
    if let Some(pipe) = child.0.stdout.take() {
        read_pipe(pipe, "stdout", send.clone());
    }
    if let Some(pipe) = child.0.stderr.take() {
        read_pipe(pipe, "stderr", send.clone());
    }
    drop(send);
    let mut ready = false;
    let mut failure = None;
    let mut exited = None;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("__cancelled__".into());
        }
        let mut pipes_closed = false;
        loop {
            let (stream, raw) = match receive.try_recv() {
                Ok(line) => line,
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    pipes_closed = true;
                    break;
                }
            };
            let line = raw.replace(&session.access_token, "[redacted]");
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                match event["event"].as_str() {
                    Some("ready") => {
                        if !ready {
                            ready = true;
                            emit_launch(app, &config.id, "running", 100, "Sakura is ready");
                        }
                        emit_game_log(app, &config.id, "sakura", line);
                    }
                    Some("joined") => emit_game_log(app, &config.id, "sakura", line),
                    Some("error") => {
                        failure = Some(
                            event["message"]
                                .as_str()
                                .unwrap_or("Sakura could not join the server.")
                                .to_owned(),
                        );
                        emit_game_log(app, &config.id, "stderr", line);
                    }
                    Some("metrics") => emit_game_log(app, &config.id, "sakura", line),
                    _ if debug_logging => emit_game_log(app, &config.id, stream, line),
                    _ => {}
                }
            } else if debug_logging || stream == "stderr" {
                emit_game_log(app, &config.id, stream, line);
            }
        }
        if exited.is_none() {
            exited = child
                .0
                .try_wait()
                .map_err(|e| e.to_string())?
                .map(|status| (status, Instant::now()));
        }
        // A child can exit before its pipe readers deliver the final auth/error
        // event. Drain them before deciding whether a keyring refresh is needed.
        if let Some((status, _)) =
            exited.filter(|(_, at)| pipes_closed || at.elapsed() >= Duration::from_millis(250))
        {
            if let Some(error) = failure {
                return Err(error);
            }
            if !status.success() || !ready {
                return Err(format!(
                    "Sakura closed before the session completed (exit {}).",
                    status.code().unwrap_or(-1)
                ));
            }
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[tauri::command]
pub(super) fn update_sakura_settings(
    instance_id: String,
    name: String,
    settings: Settings,
) -> Result<InstanceConfig, String> {
    let mut config = load_instance(&instance_id)?;
    if config.engine != Engine::Sakura {
        return Err("This is not a Sakura instance.".into());
    }
    if name.trim().is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Use an instance name of 1–80 characters without control characters.".into());
    }
    config.name = name.trim().to_owned();
    config.sakura = Some(settings);
    validate(&config)?;
    write_instance(&config)?;
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_instances_keep_java_and_unknown_engines_fail_closed() {
        let config: InstanceConfig = serde_json::from_value(serde_json::json!({"id":"old","name":"Old","version":"26.1","directory":"test","java":"Automatic","memory":4096,"jvmArguments":"","mods":true,"resourcePacks":true,"shaderPacks":true,"config":true,"customResolution":false,"visible":true,"shortcut":false})).unwrap();
        assert!(config.engine == Engine::Java);
        assert!(config.sakura.is_none());
        assert!(serde_json::from_str::<Engine>("\"untrusted\"").is_err());
    }
    #[test]
    fn native_settings_validate_bounds_and_server_not_a_url() {
        let mut settings = Settings {
            server: "play.example.com:25565".into(),
            ..Default::default()
        };
        assert!(settings.validate().is_ok());
        settings.server = "https://example.com".into();
        assert!(settings.validate().is_err());
        settings.server = "localhost".into();
        settings.render_distance = 17;
        assert!(settings.validate().is_err());
        settings.render_distance = 8;
        settings.fps_limit = 1001;
        assert!(settings.validate().is_err());
        settings.fps_limit = 0;
        for address in ["127.0.0.1:25565", "[::1]:25565", "::1", "play.example.com"] {
            settings.server = address.into();
            assert!(settings.validate().is_ok(), "{address}");
        }
        for address in ["localhost:0", "localhost:", "localhost:65536", "[::1]:0"] {
            settings.server = address.into();
            assert!(settings.validate().is_err(), "{address}");
        }
    }
    #[test]
    fn diagnostics_cannot_be_offered_as_playable() {
        assert!(!supported_caps(
            &serde_json::json!({"engine":"sakura","schema":1,"minecraft":"26.1","stage":"diagnostic-prototype","playable":false})
        ));
        assert!(supported_caps(
            &serde_json::json!({"engine":"sakura","schema":1,"minecraft":"26.1","stage":"alpha","playable":true,"asset_renderer":true,"requires_private_session":true})
        ));
    }
    #[test]
    fn private_pipe_contains_no_refresh_token() {
        let payload = serde_json::to_value(PrivateSession {
            minecraft_access_token: "test",
            uuid: "test",
            username: "test",
        })
        .unwrap();
        assert_eq!(payload.as_object().unwrap().len(), 3);
        assert!(payload.get("refresh_token").is_none());
    }
    fn native_config() -> InstanceConfig {
        serde_json::from_value(serde_json::json!({"id":"native","name":"Native","engine":"sakura","sakura":{"server":"localhost:25565","renderDistance":8,"fpsLimit":0},"version":"26.1","directory":"test","java":"Automatic","memory":4096,"jvmArguments":"","mods":false,"resourcePacks":false,"shaderPacks":false,"config":false,"customResolution":false,"visible":true,"shortcut":false})).unwrap()
    }
    #[test]
    fn native_configuration_round_trips_without_java_fallback() {
        let config = native_config();
        assert!(validate(&config).is_ok());
        let mut saved: InstanceConfig =
            serde_json::from_slice(&serde_json::to_vec(&config).unwrap()).unwrap();
        assert!(saved.engine == Engine::Sakura);
        assert_eq!(saved.sakura.as_ref().unwrap().server, "localhost:25565");
        saved.version = "26.2".into();
        assert!(validate(&saved).is_err());
        saved.version = VERSION.into();
        saved.loader = "Fabric".into();
        assert!(validate(&saved).is_err());
        saved.loader = "Vanilla".into();
        saved.sakura = None;
        assert!(validate(&saved).is_err());
    }
    #[test]
    fn command_line_contains_only_public_launch_options() {
        let config = native_config();
        let prepared = Prepared {
            executable: "trusted/sakura.exe".into(),
            assets: "minecraft/26.1.jar".into(),
            cache: "sakura/cache".into(),
        };
        let args = arguments(&config, &prepared)
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            args,
            [
                "--server",
                "localhost:25565",
                "--assets",
                "minecraft/26.1.jar",
                "--cache-dir",
                "sakura/cache",
                "--session-stdin",
                "--render-distance",
                "8",
                "--fps-limit",
                "0"
            ]
        );
        assert!(!args
            .iter()
            .any(|arg| arg.contains("token") || arg.contains("username") || arg.contains("uuid")));
    }
    #[test]
    #[ignore = "Reads selected account availability from the local OS keyring; prints only a boolean"]
    fn selected_account_available() {
        println!("selected_account_available={}", saved_session().is_some());
    }

    #[test]
    #[ignore = "Requires a disposable online-mode vanilla 26.1 server on loopback port 25579 and the selected Bloom account"]
    fn authenticated_loopback_acceptance() {
        account_acceptance(false);
    }

    #[test]
    #[ignore = "Opens Sakura for visual acceptance against online-mode loopback port 25579; closes after 45 seconds"]
    fn authenticated_window_acceptance() {
        account_acceptance(true);
    }

    fn account_acceptance(windowed: bool) {
        let stored = match saved_session() {
            Some(session) => session,
            None => panic!("No selected Minecraft session is available in the OS keyring."),
        };
        // Exercise Bloom's real account validation/refresh API, never an offline identity.
        let session = match tauri::async_runtime::block_on(launch_session(&stored)) {
            Ok(session) => session, Err(_) => panic!("The selected Minecraft session could not be validated or refreshed. No credential details were printed."),
        };
        if session.access_token != stored.access_token
            || session.expires_at != stored.expires_at
            || session.username != stored.username
        {
            assert!(
                save_account_session(&session, true).is_ok(),
                "Could not save the refreshed session securely."
            );
        }
        let executable = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../sakura/target/release")
            .join(if cfg!(windows) {
                "sakura.exe"
            } else {
                "sakura"
            });
        assert!(
            executable.is_file(),
            "Build the optimized Sakura executable before this acceptance test."
        );
        let mut process = command_without_console(executable);
        process.args([
            "--server",
            "127.0.0.1:25579",
            "--session-stdin",
            "--timeout-seconds",
            "12",
            "--render-distance",
            "4",
        ]);
        if windowed {
            let data = bloom_data_dir().unwrap();
            process
                .arg("--assets")
                .arg(data.join("minecraft/versions/26.1/26.1.jar"))
                .arg("--cache-dir")
                .arg(data.join("sakura/cache"));
        } else {
            process.arg("--headless");
        }
        let process_started = Instant::now();
        let child = process
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();
        let mut child = ReapChild(match child {
            Ok(child) => child,
            Err(_) => panic!("The optimized Sakura engine could not start."),
        });
        {
            let mut input = child.0.stdin.take().unwrap();
            assert!(
                serde_json::to_writer(
                    &mut input,
                    &PrivateSession {
                        minecraft_access_token: &session.access_token,
                        uuid: &session.uuid,
                        username: &session.username
                    }
                )
                .is_ok(),
                "The private sign-in pipe failed."
            );
            assert!(
                input.write_all(b"\n").is_ok(),
                "The private sign-in pipe closed early."
            );
        }
        fn drain(
            pipe: impl Read + Send + 'static,
            started: Instant,
            timings: bool,
        ) -> std::thread::JoinHandle<Vec<u8>> {
            std::thread::spawn(move || {
                let mut reader = std::io::BufReader::new(pipe).take(131_072);
                let mut bytes = Vec::new();
                loop {
                    let mut line = Vec::new();
                    if reader.read_until(b'\n', &mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    if timings {
                        if let Ok(record) = serde_json::from_slice::<serde_json::Value>(&line) {
                            if matches!(
                                record["event"].as_str(),
                                Some(
                                    "joined"
                                        | "ready"
                                        | "renderer_first_present"
                                        | "first_world_present"
                                )
                            ) {
                                println!(
                                    "{}",
                                    serde_json::json!({"stage":record["event"],"process_elapsed_ms":started.elapsed().as_millis()})
                                );
                            } else if record["event"] == "metrics" && record["stage"] == "assets" {
                                println!(
                                    "{}",
                                    serde_json::json!({"stage":"assets","process_elapsed_ms":started.elapsed().as_millis(),"cache_hit":record["cache_hit"].as_bool(),"load_ms":record["elapsed_ms"].as_u64()})
                                );
                            }
                        }
                    }
                    bytes.extend(line);
                }
                bytes
            })
        }
        let stdout = drain(child.0.stdout.take().unwrap(), process_started, windowed);
        let stderr = drain(child.0.stderr.take().unwrap(), process_started, false);
        let deadline = Instant::now() + Duration::from_secs(if windowed { 45 } else { 35 });
        let success = loop {
            match child.0.try_wait() {
                Ok(Some(status)) => break status.success(),
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                _ => {
                    let _ = child.0.kill();
                    let _ = child.0.wait();
                    break windowed;
                }
            }
        };
        let output = stdout.join().unwrap_or_default();
        let error_output = stderr.join().unwrap_or_default();
        let has_secret = |bytes: &[u8]| {
            bytes
                .windows(session.access_token.len())
                .any(|window| window == session.access_token.as_bytes())
        };
        assert!(!has_secret(&output) && !has_secret(&error_output), "A child process attempted to log its session credential; captured output was withheld.");
        let records = String::from_utf8_lossy(&output)
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .collect::<Vec<_>>();
        let joined = records.iter().any(|record| record["event"] == "joined");
        let terrain = records.iter().any(|record| {
            (record["connected"] == true || windowed && record["event"] == "first_world_present")
                && record["sections"].as_u64().unwrap_or(0) > 0
        });
        if windowed {
            assert!(
                records.iter().any(|record| record["event"] == "ready"),
                "No first-present readiness event arrived."
            );
            for record in &records {
                if matches!(
                    record["event"].as_str(),
                    Some("renderer_first_present" | "first_world_present")
                ) {
                    println!(
                        "{}",
                        serde_json::json!({"event":record["event"],"elapsed_ms":record["elapsed_ms"].as_u64(),"sections":record["sections"].as_u64(),"assets_cache_hit":record["assets_cache_hit"].as_bool()})
                    );
                }
            }
        }
        assert!(
            success && joined && terrain,
            "Authenticated loopback acceptance failed; private child output was withheld."
        );
        println!("authenticated_loopback_join=true live_terrain=true credential_output=false");
    }
}
