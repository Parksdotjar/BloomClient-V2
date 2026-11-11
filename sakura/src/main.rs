mod atmosphere;
mod weather;
mod movement_input;
mod light_properties;
mod lighting;
mod assets;
mod entity_state;
#[cfg(test)]
mod entity_acceptance;
mod gameplay;
mod gui_assets;
mod hud_state;
mod inventory_state;
mod mob_models;
#[cfg(test)]
mod native_acceptance;
mod network;
mod renderer;
mod shared;
mod player_skin;
mod world_stream;

use shared::{ConnectionConfig, InputState, RendererConfig, SceneSnapshot, SessionCredentials};
use std::{
    io::{self, IsTerminal, Read},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

const HELP: &str = "Sakura — native Minecraft 26.1 alpha

\
  sakura --capabilities
\
  sakura --server <address> --session-stdin --assets <26.1.jar> --cache-dir <directory>
\
  sakura --server 127.0.0.1:25565 --offline-user SakuraTest --headless
\
  sakura --renderer-smoke --assets <26.1.jar> --cache-dir <directory>
\
  sakura --asset-benchmark --assets <26.1.jar> --cache-dir <directory>
\
  --render-distance 2..16 (default 8), --fps-limit 0..1000 (0 = vsync)

\
Private stdin credentials: Minecraft access token, UUID and username JSON.
\
Offline development login is restricted to literal loopback addresses.
\
Click to capture mouse; WASD, Space, Shift; left click mines, right click uses.
\
1–9 or wheel selects hotbar; E opens inventory; T opens chat; Escape releases mouse/menu.
";

struct Options {
    address: String,
    offline_user: Option<String>,
    session_stdin: bool,
    headless: bool,
    timeout: Duration,
    assets: Option<PathBuf>,
    cache_dir: Option<PathBuf>,
    renderer: RendererConfig,
    renderer_smoke: bool,
    asset_benchmark: bool,
}

fn parse_options(args: &[String]) -> Result<Options, String> {
    let mut options = Options {
        address: String::new(),
        offline_user: None,
        session_stdin: false,
        headless: false,
        timeout: Duration::from_secs(30),
        assets: None,
        cache_dir: None,
        renderer: RendererConfig::default(),
        renderer_smoke: false,
        asset_benchmark: false,
    };
    let mut arguments = args.iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--server" => {
                options.address = arguments.next().ok_or("Missing server address")?.clone()
            }
            "--offline-user" => {
                options.offline_user =
                    Some(arguments.next().ok_or("Missing offline username")?.clone())
            }
            "--session-stdin" => options.session_stdin = true,
            "--headless" => options.headless = true,
            "--renderer-smoke" => options.renderer_smoke = true,
            "--asset-benchmark" => options.asset_benchmark = true,
            "--assets" => {
                options.assets = Some(PathBuf::from(
                    arguments.next().ok_or("Missing asset JAR path")?,
                ))
            }
            "--cache-dir" => {
                options.cache_dir = Some(PathBuf::from(
                    arguments.next().ok_or("Missing cache directory")?,
                ))
            }
            "--render-distance" => {
                options.renderer.render_distance = arguments
                    .next()
                    .ok_or("Missing render distance")?
                    .parse()
                    .map_err(|_| "Invalid render distance")?;
                if !(2..=16).contains(&options.renderer.render_distance) {
                    return Err("Render distance must be 2–16 chunks".into());
                }
            }
            "--fps-limit" => {
                options.renderer.fps_limit = arguments
                    .next()
                    .ok_or("Missing frame limit")?
                    .parse()
                    .map_err(|_| "Invalid frame limit")?;
                if options.renderer.fps_limit > 1000 {
                    return Err("Frame limit must be 0–1000".into());
                }
            }
            "--timeout-seconds" => {
                let seconds: u64 = arguments
                    .next()
                    .ok_or("Missing timeout")?
                    .parse()
                    .map_err(|_| "Invalid timeout")?;
                if !(1..=300).contains(&seconds) {
                    return Err("Timeout must be between 1 and 300 seconds".into());
                }
                options.timeout = Duration::from_secs(seconds);
            }
            _ => {
                return Err(
                    "Unknown argument; use --help. Credentials are never command arguments.".into(),
                );
            }
        }
    }
    if options.renderer_smoke || options.asset_benchmark {
        return Ok(options);
    }
    if options.address.is_empty()
        || options.address.len() > 255
        || options
            .address
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("Provide a valid server address using --server".into());
    }
    if options.offline_user.is_some() == options.session_stdin {
        return Err("Choose private session stdin or a loopback development username".into());
    }
    if let Some(name) = &options.offline_user {
        validate_username(name)?;
        if !literal_loopback(&options.address) {
            return Err("Offline development login requires 127.0.0.1 or [::1]; other servers require a Minecraft session".into());
        }
    }
    Ok(options)
}

fn literal_loopback(address: &str) -> bool {
    let host = if let Some(rest) = address.strip_prefix('[') {
        let Some((host, suffix)) = rest.split_once(']') else {
            return false;
        };
        if !suffix.is_empty() && !valid_port_suffix(suffix) {
            return false;
        }
        host
    } else if address == "::1" {
        address
    } else {
        let (host, suffix) = address
            .split_once(':')
            .map_or((address, ""), |(h, p)| (h, p));
        if !suffix.is_empty() && suffix.parse::<u16>().map_or(true, |port| port == 0) {
            return false;
        }
        if address.ends_with(':') {
            return false;
        }
        host
    };
    host.parse::<std::net::IpAddr>()
        .is_ok_and(|ip| ip.is_loopback())
}

fn valid_port_suffix(suffix: &str) -> bool {
    suffix
        .strip_prefix(':')
        .and_then(|port| port.parse::<u16>().ok())
        .is_some_and(|port| port > 0)
}

fn validate_username(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 16
        || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err("Minecraft username must be 1–16 letters, digits or underscores".into());
    }
    Ok(())
}

fn read_session(reader: impl Read) -> Result<SessionCredentials, String> {
    let mut bytes = Vec::new();
    reader
        .take(16_385)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read private session input")?;
    if bytes.len() > 16_384 {
        return Err("Private session input exceeds its size limit".into());
    }
    // Do not forward serde errors: they may contain credential values.
    let session: SessionCredentials =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid private session input")?;
    if session.minecraft_access_token.len() < 16
        || session.minecraft_access_token.len() > 12_000
        || !session
            .minecraft_access_token
            .bytes()
            .all(|byte| byte.is_ascii_graphic())
        || uuid::Uuid::parse_str(&session.uuid).is_err()
    {
        return Err("Invalid Minecraft session credentials".into());
    }
    validate_username(&session.username)?;
    Ok(session)
}

fn read_private_session() -> Result<SessionCredentials, String> {
    if io::stdin().is_terminal() {
        return Err("Session input must arrive through a private pipe, followed by EOF".into());
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("sakura-session-input".into())
        .spawn(move || {
            let _ = sender.send(read_session(io::stdin().lock()));
        })
        .map_err(|_| "Could not read private session input")?;
    receiver
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "Private session input timed out; the launcher must close its input pipe")?
}

fn execute() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.is_empty() || args == ["--help"] || args == ["-h"] {
        print!("{HELP}");
        return Ok(());
    }
    if args == ["--capabilities"] {
        println!(
            "{}",
            serde_json::json!({"engine":"sakura", "schema":1, "minecraft":"26.1", "stage":"alpha", "playable":true, "requires_private_session":true, "java_mods":false, "asset_renderer":true, "inventory_gui":true, "full_vanilla_parity":false})
        );
        return Ok(());
    }
    let input = Arc::new(Mutex::new(InputState::default()));
    let scene = Arc::new(Mutex::new(SceneSnapshot::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let options = parse_options(&args)?;
    if options.renderer_smoke || options.asset_benchmark {
        let pack = assets::load(
            options
                .assets
                .as_deref()
                .ok_or("Provide --assets with the verified Minecraft 26.1 client JAR")?,
            options.cache_dir.as_deref().ok_or("Provide --cache-dir")?,
        )?;
        println!(
            "{}",
            serde_json::json!({"event":"metrics","stage":"assets","cache_hit":pack.cache_hit,"elapsed_ms":pack.load_ms,"texture_layers":pack.texture_layers,"block_states":pack.models.len(),"unsupported_block_models":pack.unsupported_block_models})
        );
        if options.asset_benchmark {
            return Ok(());
        }
        let timer_stop = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            timer_stop.store(true, Ordering::Release);
        });
        return renderer::run(input, scene, stop, Arc::new(pack), options.renderer, options.cache_dir.as_deref());
    }
    let session = if options.session_stdin {
        Some(read_private_session()?)
    } else {
        None
    };
    let username = session
        .as_ref()
        .map(|s| s.username.clone())
        .or(options.offline_user)
        .ok_or("Missing username")?;
    // Asset baking/cache reads overlap the server handshake, with a single bounded worker.
    let asset_worker = if !options.headless {
        let jar = options
            .assets
            .clone()
            .ok_or("Provide --assets with the verified Minecraft 26.1 client JAR")?;
        let cache = options.cache_dir.clone().ok_or("Provide --cache-dir")?;
        Some(
            std::thread::Builder::new()
                .name("sakura-assets".into())
                .spawn(move || assets::load(&jar, &cache))
                .map_err(|_| "Could not start asset loader")?,
        )
    } else {
        None
    };
    let config = ConnectionConfig {
        address: options.address,
        username,
        session,
        render_distance: options.renderer.render_distance,
    };
    let network_input = input.clone();
    let network_scene = scene.clone();
    let network_stop = stop.clone();
    let worker = std::thread::Builder::new()
        .name("sakura-network".into())
        .spawn(move || {
            let result = network::run(
                config,
                network_input,
                network_scene.clone(),
                network_stop.clone(),
            );
            if let Err(error) = &result {
                if let Ok(mut snapshot) = network_scene.lock() {
                    snapshot.status = error.clone();
                    snapshot.connected = false;
                }
            }
            result
        })
        .map_err(|_| "Could not start network worker")?;
    let result = if options.headless {
        let deadline = Instant::now() + options.timeout;
        while !worker.is_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let snapshot = scene.lock().map_err(|_| "Scene state was interrupted")?;
        println!(
            "{}",
            serde_json::json!({"stage":"alpha", "connected":snapshot.connected, "sections":snapshot.sections.len(), "blocks":snapshot.sections.values().map(|s|s.blocks.iter().filter(|b|**b!=0).count()).sum::<usize>(), "revision":snapshot.revision, "status":snapshot.status})
        );
        if snapshot.connected && !snapshot.sections.is_empty() {
            Ok(())
        } else {
            Err("No live server terrain received during diagnostic session".into())
        }
    } else {
        match asset_worker
            .unwrap()
            .join()
            .map_err(|_| "Asset loader stopped unexpectedly".to_owned())
            .and_then(|r| r)
        {
            Ok(pack) => {
                println!(
                    "{}",
                    serde_json::json!({"event":"metrics","stage":"assets","cache_hit":pack.cache_hit,"elapsed_ms":pack.load_ms})
                );
                renderer::run(input, scene, stop.clone(), Arc::new(pack), options.renderer, options.cache_dir.as_deref())
            }
            Err(error) => Err(error),
        }
    };
    stop.store(true, Ordering::Release);
    // Network cancellation is bounded internally; never leave a background client running.
    let network_result = worker
        .join()
        .map_err(|_| "Network worker stopped unexpectedly")?;
    result.and(network_result)
}

fn main() {
    if let Err(error) = execute() {
        println!("{}", serde_json::json!({"event":"error","message":error}));
        eprintln!("Sakura: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_login_cannot_target_public_hosts_or_ambiguous_addresses() {
        for address in ["127.0.0.1", "127.0.0.1:25579", "[::1]:25579", "::1"] {
            assert!(literal_loopback(address), "{address}");
        }
        for address in [
            "mc.example.com",
            "localhost",
            "127.0.0.1.evil.example",
            "127.0.0.1:0",
            "127.0.0.1:",
            "[::1]:99999",
            "[::1]evil",
            "192.168.1.1",
        ] {
            assert!(!literal_loopback(address), "{address}");
        }
    }

    #[test]
    fn invalid_session_errors_do_not_echo_secrets() {
        let secret = "secret-that-must-not-be-printed";
        let error = read_session(
            format!("{{\"minecraft_access_token\":\"{secret}\",\"uuid\":12}}").as_bytes(),
        )
        .err()
        .unwrap();
        assert!(!error.contains(secret));
        assert_eq!(error, "Invalid private session input");
        assert!(read_session(vec![b'x'; 16_385].as_slice()).is_err());
    }

    #[test]
    fn cli_requires_exactly_one_authentication_method() {
        let args = |words: &[&str]| words.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        assert!(parse_options(&args(&["--server", "127.0.0.1"])).is_err());
        assert!(
            parse_options(&args(&[
                "--server",
                "127.0.0.1",
                "--offline-user",
                "Sakura",
                "--session-stdin"
            ]))
            .is_err()
        );
        assert!(
            parse_options(&args(&[
                "--server",
                "127.0.0.1",
                "--offline-user",
                "Sakura"
            ]))
            .is_ok()
        );
        assert!(parse_options(&args(&["--server", "example.org", "--session-stdin"])).is_ok());
    }
}
