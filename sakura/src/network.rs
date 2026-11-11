//! The real, version-pinned server connection used by the native diagnostic client.
//! No launcher tokens are persisted, and offline identities are loopback-only.

use std::{
    fmt,
    future::Future,
    net::{IpAddr, SocketAddr},
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use azalea_auth::{
    certs::Certificates,
    sessionserver::{self, ClientSessionServerError, SessionServerJoinOpts},
};
use azalea_client::{
    ClientInformation, DefaultPlugins, InConfigState, InGameState, PhysicsState, WalkDirection,
    account::{Account, AccountTrait},
    disconnect::DisconnectEvent,
    join::{ConnectOpts, ConnectionFailedEvent, StartJoinServerEvent},
    local_player::{LocalGameMode, WorldHolder},
    packet::{
        config::SendConfigPacketEvent,
        game::{ResourcePackEvent, SendGamePacketEvent},
    },
    task_pool::{TaskPoolOptions, TaskPoolPlugin},
};
use azalea_entity::{Jumping, LookDirection, Position};
use azalea_protocol::{
    address::{ResolvedAddr, ServerAddr},
    connect::Connection,
    packets::{
        ClientIntention, PROTOCOL_VERSION, VERSION_NAME, config, game,
        handshake::ServerboundIntention,
        status::{ClientboundStatusPacket, ServerboundStatusRequest},
    },
};
use bevy_app::{App, AppExit, Last, PluginGroup, Update};
use bevy_ecs::prelude::*;
use uuid::Uuid;

use crate::{
    gameplay,
    shared::{ConnectionConfig, InputState, SceneSnapshot, SessionCredentials},
    world_stream,
};

const GENERIC_DISCONNECT: &str = "The server disconnected.";
type Signals = Arc<Mutex<Option<String>>>;

/// An inherited Minecraft session, deliberately not an Azalea/Microsoft login cache.
struct BloomAccount {
    username: String,
    uuid: Uuid,
    token: String,
    certs: parking_lot::Mutex<Option<Certificates>>,
    terminal: Signals,
}

impl fmt::Debug for BloomAccount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BloomAccount")
            .field("credentials", &"[redacted]")
            .finish()
    }
}

impl AccountTrait for BloomAccount {
    fn username(&self) -> &str {
        &self.username
    }
    fn uuid(&self) -> Uuid {
        self.uuid
    }
    fn access_token(&self) -> Option<String> {
        Some(self.token.clone())
    }
    fn certs(&self) -> Option<Certificates> {
        self.certs.lock().clone()
    }
    fn set_certs(&self, certs: Certificates) {
        *self.certs.lock() = Some(certs);
    }

    // Refresh belongs to Bloom's keyring-backed parent. Never acquire or cache
    // a Microsoft refresh token in the child. A failed session ends this launch.
    fn refresh(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<(), azalea_auth::AuthError>> + Send + '_>> {
        Box::pin(async move {
            set_terminal(
                &self.terminal,
                "Your Minecraft session needs refreshing. Launch Sakura again from Bloom.",
            );
            let client = reqwest::Client::new();
            azalea_auth::get_profile(&client, &self.token).await?;
            Ok(())
        })
    }

    fn join<'a>(
        &'a self,
        public_key: &'a [u8],
        private_key: &'a [u8; 16],
        server_id: &'a str,
        proxy: Option<reqwest::Proxy>,
    ) -> Pin<Box<dyn Future<Output = Result<(), ClientSessionServerError>> + Send + 'a>> {
        Box::pin(async move {
            let result = sessionserver::join(SessionServerJoinOpts {
                access_token: &self.token,
                public_key,
                private_key,
                uuid: &self.uuid,
                server_id,
                proxy,
            })
            .await;
            if let Err(error) = &result {
                let reason = match error {
                    ClientSessionServerError::InvalidSession
                    | ClientSessionServerError::ForbiddenOperation => {
                        "Your Minecraft session expired. Launch Sakura again from Bloom."
                    }
                    ClientSessionServerError::MultiplayerDisabled => {
                        "Multiplayer is disabled for this Minecraft account."
                    }
                    ClientSessionServerError::Banned => {
                        "This Minecraft account cannot join multiplayer servers."
                    }
                    _ => "Minecraft session authentication failed. Try launching again from Bloom.",
                };
                set_terminal(&self.terminal, reason);
            }
            result
        })
    }
}

#[derive(Resource)]
struct ConnectionSignals(Signals);

#[derive(Resource)]
struct RequestedDistance(u8);
fn configure_client(
    mut clients: Query<&mut ClientInformation, Added<ClientInformation>>,
    distance: Res<RequestedDistance>,
) {
    for mut information in &mut clients {
        information.view_distance = distance.0;
    }
}

fn set_terminal(signals: &Signals, message: impl Into<String>) {
    let mut value = signals.lock().unwrap_or_else(|e| e.into_inner());
    if value.is_none() {
        *value = Some(message.into());
    }
}

fn clean_text(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(240)
        .collect()
}

fn record_disconnect(signals: &Signals, reason: Option<String>) {
    let reason = reason.filter(|value| !value.is_empty());
    let mut terminal = signals.lock().unwrap_or_else(|e| e.into_inner());
    // A TCP close can accompany a protocol Disconnect in the same update.
    // Keep the server's useful reason, but never replace a local auth/pack error.
    if terminal.is_none() || (reason.is_some() && terminal.as_deref() == Some(GENERIC_DISCONNECT)) {
        *terminal = Some(match reason {
            Some(reason) => format!("Disconnected: {reason}"),
            None => GENERIC_DISCONNECT.to_owned(),
        });
    }
}

fn connection_events(
    mut failures: MessageReader<ConnectionFailedEvent>,
    mut disconnects: MessageReader<DisconnectEvent>,
    signals: Res<ConnectionSignals>,
) {
    for _ in failures.read() {
        set_terminal(&signals.0, "Could not connect to the Minecraft server.");
    }
    for event in disconnects.read() {
        let reason = event.reason.as_ref().map(|v| clean_text(&v.to_string()));
        record_disconnect(&signals.0, reason);
    }
}

fn reject_resource_packs(
    mut events: MessageReader<ResourcePackEvent>,
    config_query: Query<(), With<InConfigState>>,
    mut commands: Commands,
    signals: Res<ConnectionSignals>,
) {
    for event in events.read() {
        if config_query.contains(event.entity) {
            commands.trigger(SendConfigPacketEvent::new(
                event.entity,
                config::ServerboundResourcePack {
                    id: event.id,
                    action: config::s_resource_pack::Action::Declined,
                },
            ));
        } else {
            commands.trigger(SendGamePacketEvent::new(
                event.entity,
                game::ServerboundResourcePack {
                    id: event.id,
                    action: game::s_resource_pack::Action::Declined,
                },
            ));
        }
        if event.required {
            set_terminal(
                &signals.0,
                "This server requires a resource pack. Sakura cannot apply server resource packs yet.",
            );
        }
    }
}

pub fn run(
    config: ConnectionConfig,
    input: Arc<Mutex<InputState>>,
    output: Arc<Mutex<SceneSnapshot>>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "Could not start Sakura's network runtime.".to_owned())?;
    let result = tokio::task::LocalSet::new().block_on(
        &runtime,
        run_async(config, input, output.clone(), stop.clone()),
    );
    runtime.shutdown_timeout(Duration::from_millis(250));
    let mut scene = output.lock().unwrap_or_else(|e| e.into_inner());
    scene.connected = false;
    scene.sections.clear();
    scene.revision = scene.revision.wrapping_add(1);
    scene.status = match &result {
        Ok(()) => "Disconnected".to_owned(),
        Err(reason) => reason.clone(),
    };
    result
}

async fn until_cancelled<T>(
    future: impl Future<Output = Result<T, String>>,
    stop: &AtomicBool,
    seconds: u64,
) -> Result<T, String> {
    tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(seconds), future) =>
            result.map_err(|_| "The server connection timed out.".to_owned())?,
        _ = async {
            while !stop.load(Ordering::Relaxed) { tokio::time::sleep(Duration::from_millis(40)).await; }
        } => Err("Connection cancelled.".to_owned()),
    }
}

async fn run_async(
    config: ConnectionConfig,
    input: Arc<Mutex<InputState>>,
    output: Arc<Mutex<SceneSnapshot>>,
    stop: Arc<AtomicBool>,
) -> Result<(), String> {
    if let Some(session) = &config.session {
        crate::player_skin::start(session.minecraft_access_token.clone(), output.clone());
    }
    let parsed = parse_server_address(&config.address)?;
    if config.session.is_none() && !offline_host_allowed(&parsed.host) {
        return Err("A Minecraft account session is required. Offline diagnostics are restricted to localhost.".into());
    }
    set_status(&output, "Resolving server…");
    let address = until_cancelled(
        async {
            // Azalea's resolver attempts SRV lookup before checking literal IPs.
            // Literal loopback diagnostics must never depend on DNS or redirects.
            if let Ok(ip) = parsed.host.parse::<IpAddr>() {
                Ok(ResolvedAddr {
                    socket: SocketAddr::new(ip, parsed.port),
                    server: parsed,
                })
            } else {
                ResolvedAddr::new(parsed)
                    .await
                    .map_err(|_| "Could not resolve the server address.".to_owned())
            }
        },
        &stop,
        8,
    )
    .await?;
    if config.session.is_none() && !address.socket.ip().is_loopback() {
        return Err("Offline diagnostics cannot connect outside the local computer.".into());
    }
    set_status(&output, "Checking server version…");
    until_cancelled(probe(&address), &stop, 8).await?;
    let terminal = Arc::new(Mutex::new(None));
    let account: Account = if let Some(session) = config.session {
        validate_session(&session)?;
        BloomAccount {
            uuid: Uuid::parse_str(&session.uuid)
                .map_err(|_| "Invalid Minecraft account identifier.")?,
            username: session.username,
            token: session.minecraft_access_token,
            certs: parking_lot::Mutex::new(None),
            terminal: terminal.clone(),
        }
        .into()
    } else {
        validate_username(&config.username)?;
        Account::offline(&config.username)
    };

    let mut app = App::new();
    app.add_plugins(DefaultPlugins.build().disable::<azalea_physics::PhysicsPlugin>().set(TaskPoolPlugin {
        task_pool_options: TaskPoolOptions {
            max_total_threads: 4,
            ..Default::default()
        },
    }));
    app.add_plugins(crate::movement_input::MovementPlugin);
    app.insert_resource(ConnectionSignals(terminal.clone()));
    app.insert_resource(RequestedDistance(config.render_distance));
    app.add_systems(
        Update,
        configure_client.before(azalea_client::client_information::send_client_information),
    );
    app.init_resource::<world_stream::Changes>();
    app.init_resource::<crate::lighting::Environment>();
    app.init_resource::<gameplay::Chat>();
    app.init_resource::<crate::inventory_state::InventoryUi>();
    app.init_resource::<crate::hud_state::HudState>();
    app.init_resource::<crate::entity_state::VisualMetadata>();
    app.add_systems(
        Last,
        (
            connection_events,
            reject_resource_packs,
            world_stream::capture,
            crate::lighting::capture,
            gameplay::receive_chat,
            crate::inventory_state::capture,
            crate::hud_state::capture,
            crate::entity_state::capture,
        ),
    );
    let (ecs, start, mut exit) = azalea_client::start_ecs_runner(app.main_mut());
    let (entity_tx, mut entity_rx) = tokio::sync::mpsc::unbounded_channel();
    ecs.write().write_message(StartJoinServerEvent {
        account,
        connect_opts: ConnectOpts {
            address,
            server_proxy: None,
            sessionserver_proxy: None,
        },
        start_join_callback_tx: Some(entity_tx),
    });
    start();
    set_status(&output, "Joining Minecraft 26.1…");

    let joined_at = Instant::now();
    let mut entity = None;
    let mut controls = gameplay::Controls::default();
    let mut camera_revision = 0;
    type SnapshotJob = tokio::task::JoinHandle<(
        u64,
        Vec<(
            world_stream::Key,
            u64,
            Option<Arc<crate::shared::SectionSnapshot>>,
        )>,
    )>;
    let mut mesh_task: Option<SnapshotJob> = None;
    let mut last_hud = Instant::now();
    let mut first_sections = false;
    let mut previous_world: Option<Arc<parking_lot::RwLock<azalea_world::World>>> = None;
    let mut world_epoch = 0u64;
    let mut packet_epoch = 0u64;
    let mut ever_joined = false;
    let result = loop {
        if stop.load(Ordering::Relaxed) {
            break Ok(());
        }
        if let Some(reason) = terminal.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            break Err(reason);
        }
        if exit.try_recv().is_ok() {
            break Err("Sakura's connection runtime stopped.".to_owned());
        }
        if entity.is_none() {
            if let Ok(id) = entity_rx.try_recv() {
                entity = Some(id);
                if let Some(mut information) = ecs.write().get_mut::<ClientInformation>(id) {
                    information.view_distance = config.render_distance;
                }
            }
        }
        if let Some(id) = entity {
            let (position, world, in_game) = {
                let mut ecs = ecs.write();
                let state = {
                    let mut state = input.lock().unwrap_or_else(|e| e.into_inner());
                    // Preserve the server's teleport/spawn orientation instead of
                    // immediately overwriting it with the previous mouse angle.
                    let revision = ecs
                        .resource::<crate::entity_state::VisualMetadata>()
                        .camera_revision;
                    if revision != camera_revision {
                        camera_revision = revision;
                        if let Some(look) = ecs.get::<LookDirection>(id) {
                            if look.y_rot().is_finite() && look.x_rot().is_finite() {
                                state.yaw = look.y_rot();
                                state.pitch = look.x_rot().clamp(-90.0, 90.0);
                            }
                        }
                    }
                    let copy = state.clone();
                    state.chat_submit = None;
                    state.inventory_actions.clear();
                    copy
                };
                let inventory_open = crate::inventory_state::is_open(&ecs);
                if let Some(mut physics) = ecs.get_mut::<PhysicsState>(id) {
                    physics.move_direction = if inventory_open {
                        WalkDirection::None
                    } else {
                        walk_direction(state.forward, state.strafe)
                    };

                }
                if ecs.get::<crate::movement_input::Controls>(id).is_none() {ecs.entity_mut(id).insert(crate::movement_input::Controls::default());}
                if let Some(mut c)=ecs.get_mut::<crate::movement_input::Controls>(id) {
                    c.sprint=!inventory_open && state.sprint;c.sneak=!inventory_open && state.sneak;c.jump=!inventory_open && state.jump;
                    c.sprint_tap=state.sprint_tap;c.fly_tap=state.fly_tap;
                }
                let eye_height=crate::movement_input::eye_height(ecs.get::<azalea_entity::Pose>(id));
                {
                    let mut snapshot=output.lock().unwrap_or_else(|e|e.into_inner());snapshot.eye_height=eye_height;
                    snapshot.fov_multiplier=ecs.get::<azalea_entity::PlayerAbilities>(id).zip(ecs.get::<azalea_entity::Attributes>(id)).map_or(1.,|(a,attrs)| {
                        let ratio=if a.walking_speed>0. {attrs.movement_speed.calculate() as f32/a.walking_speed}else{1.};
                        ((if a.flying {1.1}else{1.})*(ratio+1.)*0.5).clamp(0.1,1.5)
                    });
                }
                if let Some(mut jumping) = ecs.get_mut::<Jumping>(id) {
                    jumping.0 = !inventory_open && state.jump;
                }
                if state.yaw.is_finite() && state.pitch.is_finite() {
                    if let Some(mut look) = ecs.get_mut::<LookDirection>(id) {
                        look.update(LookDirection::new(state.yaw, state.pitch));
                    }
                }
                if ecs.get::<InGameState>(id).is_some() && ecs.get::<LocalGameMode>(id).is_some() {
                    controls.apply(&mut ecs, id, &state);
                    crate::inventory_state::publish(
                        &mut ecs,
                        id,
                        &mut output.lock().unwrap_or_else(|e| e.into_inner()),
                    );
                    crate::hud_state::publish(
                        &mut ecs,
                        id,
                        &mut output.lock().unwrap_or_else(|e| e.into_inner()),
                    );
                    if last_hud.elapsed() >= Duration::from_millis(100) {
                        if let (Some(holder),Some(pos))=(ecs.get::<WorldHolder>(id).map(|h|h.shared.clone()),ecs.get::<Position>(id).map(|p|[p.x,p.y+eye_height as f64,p.z])) {
                            ecs.resource_scope(|ecs, mut env: Mut<crate::lighting::Environment>| {
                                let world=holder.read();
                                env.atmosphere.sample(&world,pos,Instant::now());
                                let fallback=env.fog_color.unwrap_or(match env.dimension {
                                    crate::lighting::Dimension::Nether=>[0.2,0.03137255,0.03137255],
                                    crate::lighting::Dimension::End=>[0.09411765,0.07450981,0.09411765],
                                    _=>[0.7529412,0.84705883,1.],
                                });
                                if let Some((fog,water))=env.weather.blend(&world,pos,fallback) {
                                    env.atmosphere.fog_color=Some(fog);env.atmosphere.water_color=water;
                                }
                                if env.rain>0.001 {env.weather.sample(&world,pos,ecs.resource::<world_stream::Changes>());} else {env.weather.clear();}
                            });
                        }
                    }
                    output.lock().unwrap_or_else(|e| e.into_inner()).environment = ecs.resource::<crate::lighting::Environment>().clone();
                    if last_hud.elapsed() >= Duration::from_millis(100) {
                        gameplay::snapshot(
                            &mut ecs,
                            id,
                            &mut output.lock().unwrap_or_else(|e| e.into_inner()),
                        );
                        {
                            let changes=ecs.resource::<world_stream::Changes>();
                            let mut scene=output.lock().unwrap_or_else(|e|e.into_inner());
                            let eye=scene.player_position;let sky=scene.environment.sky_level(Instant::now());
                            if let Some(holder)=ecs.get::<WorldHolder>(id){let world=holder.shared.read();for entity in &mut scene.entities {let mut p=entity.position;p[1]+=entity.height as f64*0.85;entity.light=changes.sample(p.map(|v|v.floor() as i32));crate::lighting::shadows(entity,eye,&world,changes,sky);}}
                            let p=scene.target.unwrap_or_else(||scene.player_position.map(|v|v.floor() as i32));
                            let block=ecs.get::<WorldHolder>(id).and_then(|h|h.shared.read().get_block_state(azalea_core::position::BlockPos::new(p[0],p[1],p[2]))).map(|s|u32::from(s.id())).unwrap_or(0);
                            scene.light_debug=crate::lighting::DebugSample{position:p,state:block,light:changes.sample(p),revision:changes.revision(),pending:changes.pending()};
                        }
                        last_hud = Instant::now();
                    }
                }
                let position = ecs.get::<Position>(id).map(|p| [p.x, p.y, p.z]);
                let world = ecs.get::<WorldHolder>(id).map(|v| v.shared.clone());
                (
                    position,
                    world,
                    ecs.get::<InGameState>(id).is_some() && ecs.get::<LocalGameMode>(id).is_some(),
                )
            };
            if position.is_some_and(|position| {
                position
                    .iter()
                    .any(|v| !v.is_finite() || v.abs() > 30_000_000.0)
            }) {
                break Err("The server sent an invalid player position.".into());
            }
            let world_changed = match (&world, &previous_world) {
                (Some(next), Some(previous)) => !Arc::ptr_eq(next, previous),
                (None, None) => false,
                _ => true,
            };
            let next_packet_epoch = ecs.read().resource::<world_stream::Changes>().epoch;
            if world_changed || next_packet_epoch != packet_epoch || !in_game {
                let mut scene = output.lock().unwrap_or_else(|e| e.into_inner());
                if scene.connected || !scene.sections.is_empty() {
                    scene.sections.clear();
                    scene.connected = false;
                    scene.revision = scene.revision.wrapping_add(1);
                }
                previous_world = world.clone();
                world_epoch = world_epoch.wrapping_add(1);
                packet_epoch = next_packet_epoch;
                scene.world_epoch = world_epoch;
            }
            if in_game {
                if !ever_joined {
                    println!(
                        "{}",
                        serde_json::json!({"event":"joined","elapsed_ms":joined_at.elapsed().as_secs_f64()*1000.0})
                    );
                }
                ever_joined = true;
                let mut scene = output.lock().unwrap_or_else(|e| e.into_inner());
                scene.connected = true;
                scene.status = "Connected · Sakura Alpha · Minecraft 26.1".into();
                if let Some(position) = position {
                    scene.player_position = position;
                }
            }
            if let (Some(position), Some(world)) = (position, world) {
                if mesh_task.as_ref().is_some_and(|task| task.is_finished()) {
                    if let Ok((task_epoch, snapshots)) = mesh_task.take().unwrap().await {
                        if in_game && task_epoch == world_epoch {
                            let ecs = ecs.read();
                            let changes = ecs.resource::<world_stream::Changes>();
                            let mut scene = output.lock().unwrap_or_else(|e| e.into_inner());
                            let mut changed = false;
                            for (key, revision, snapshot) in snapshots {
                                if !changes.fresh(&key, revision)
                                    || changes.unloaded.contains(&[key[0], key[2]])
                                {
                                    continue;
                                }
                                if let Some(snapshot) = snapshot {
                                    scene.sections.insert(key, snapshot);
                                    changed = true;
                                } else {
                                    changed |= scene.sections.remove(&key).is_some();
                                }
                            }
                            if changed {
                                scene.revision = scene.revision.wrapping_add(1);
                            }
                            if !first_sections && !scene.sections.is_empty() {
                                first_sections = true;
                                println!(
                                    "{}",
                                    serde_json::json!({"event":"metrics","stage":"first_sections","elapsed_ms":joined_at.elapsed().as_secs_f64()*1000.0,"sections":scene.sections.len()})
                                );
                            }
                        }
                    }
                }
                if in_game && mesh_task.is_none() {
                    let work = {
                        let mut ecs = ecs.write();
                        let mut changes = ecs.resource_mut::<world_stream::Changes>();
                        let mut scene = output.lock().unwrap_or_else(|e| e.into_inner());
                        let center = [
                            (position[0].floor() as i32).div_euclid(16),
                            (position[2].floor() as i32).div_euclid(16),
                        ];
                        let previous = scene.sections.len();
                        scene.sections.retain(|key, _| {
                            !changes.unloaded.contains(&[key[0], key[2]])
                                && (key[0] - center[0]).abs()
                                    <= i32::from(config.render_distance) + 1
                                && (key[2] - center[1]).abs()
                                    <= i32::from(config.render_distance) + 1
                        });
                        if previous != scene.sections.len() {
                            scene.revision = scene.revision.wrapping_add(1);
                        }
                        changes.unloaded.clear();
                        drop(scene);
                        match world_stream::prepare(
                            &world,
                            &mut changes,
                            position,
                            config.render_distance,
                        ) {
                            Ok(work) => work,
                            Err(reason) => break Err(reason),
                        }
                    };
                    if !work.is_empty() {
                        mesh_task = Some(tokio::task::spawn_blocking(move || {
                            (world_epoch, world_stream::expand(work))
                        }));
                    }
                }
            }
        }
        if !ever_joined && joined_at.elapsed() > Duration::from_secs(60) {
            break Err("Server login timed out. Check the server version and refresh your Minecraft session in Bloom.".into());
        }
        tokio::time::sleep(Duration::from_millis(16)).await;
    };
    // Let a queued resource-pack decline flush, then close all sockets and tasks.
    tokio::time::sleep(Duration::from_millis(35)).await;
    let result = match result {
        Err(reason) if reason == GENERIC_DISCONNECT => Err(terminal
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .unwrap_or(reason)),
        other => other,
    };
    ecs.write().write_message(AppExit::Success);
    let _ = tokio::time::timeout(Duration::from_secs(2), &mut exit).await;
    result
}

fn set_status(output: &Arc<Mutex<SceneSnapshot>>, message: &str) {
    output.lock().unwrap_or_else(|e| e.into_inner()).status = message.to_owned();
}

async fn probe(address: &ResolvedAddr) -> Result<(), String> {
    let mut connection = Connection::new(&address.socket)
        .await
        .map_err(|_| "The Minecraft server is not reachable.")?;
    connection
        .write(ServerboundIntention {
            protocol_version: PROTOCOL_VERSION,
            hostname: address.server.host.clone(),
            port: address.server.port,
            intention: ClientIntention::Status,
        })
        .await
        .map_err(|_| "Could not send the server status request.")?;
    let mut connection = connection.status();
    connection
        .write(ServerboundStatusRequest {})
        .await
        .map_err(|_| "Could not request server status.")?;
    let response = connection
        .read()
        .await
        .map_err(|_| "The server returned an invalid status response.")?;
    match response {
        ClientboundStatusPacket::StatusResponse(response)
            if response.version.protocol == PROTOCOL_VERSION =>
        {
            Ok(())
        }
        ClientboundStatusPacket::StatusResponse(response) => Err(format!(
            "This server uses {} (protocol {}). Sakura currently requires Minecraft {VERSION_NAME} (protocol {PROTOCOL_VERSION}).",
            clean_text(&response.version.name),
            response.version.protocol,
        )),
        _ => Err("The server returned an unexpected status packet.".into()),
    }
}

fn validate_username(username: &str) -> Result<(), String> {
    if username.is_empty()
        || username.len() > 16
        || !username
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || v == b'_')
    {
        return Err(
            "Minecraft usernames must contain 1–16 letters, numbers or underscores.".into(),
        );
    }
    Ok(())
}

fn validate_session(session: &SessionCredentials) -> Result<(), String> {
    validate_username(&session.username)?;
    if session.minecraft_access_token.is_empty() || session.minecraft_access_token.len() > 16_384 {
        return Err("The inherited Minecraft session is missing or invalid.".into());
    }
    Ok(())
}

fn offline_host_allowed(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn parse_server_address(address: &str) -> Result<ServerAddr, String> {
    let address = address.trim();
    if address.is_empty() || address.len() > 260 || address.chars().any(char::is_whitespace) {
        return Err(
            "Enter a Minecraft server hostname or IP address, with an optional port.".into(),
        );
    }
    if let Ok(socket) = address.parse::<SocketAddr>() {
        if socket.port() == 0 {
            return Err("The server port must be between 1 and 65535.".into());
        }
        return Ok(socket.into());
    }
    if let Ok(ip) = address.parse::<IpAddr>() {
        return Ok(ServerAddr {
            host: ip.to_string(),
            port: 25565,
        });
    }
    let (host, port) = match address.split_once(':') {
        Some((host, port)) => (
            host,
            port.parse::<u16>()
                .ok()
                .filter(|v| *v != 0)
                .ok_or("The server port must be between 1 and 65535.")?,
        ),
        None => (address, 25565),
    };
    if host.is_empty()
        || host.len() > 253
        || !host
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || matches!(v, b'-' | b'.'))
    {
        return Err("Use a server hostname or IP address, not a URL.".into());
    }
    Ok(ServerAddr {
        host: host.to_owned(),
        port,
    })
}

// Azalea 0.16 names right/left opposite to its positive-left physics impulse.
fn walk_direction(forward: f32, strafe: f32) -> WalkDirection {
    match (forward > 0.1, forward < -0.1, strafe > 0.1, strafe < -0.1) {
        (true, _, true, _) => WalkDirection::ForwardLeft,
        (true, _, _, true) => WalkDirection::ForwardRight,
        (_, true, true, _) => WalkDirection::BackwardLeft,
        (_, true, _, true) => WalkDirection::BackwardRight,
        (true, _, _, _) => WalkDirection::Forward,
        (_, true, _, _) => WalkDirection::Backward,
        (_, _, true, _) => WalkDirection::Left,
        (_, _, _, true) => WalkDirection::Right,
        _ => WalkDirection::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_disconnect_preserves_network_nbt_message() {
        let message = "Sakura fixture: configuration test complete";
        let mut bytes = vec![2, 8];
        bytes.extend_from_slice(&(message.len() as u16).to_be_bytes());
        bytes.extend_from_slice(message.as_bytes());
        let parsed = azalea_protocol::read::deserialize_packet::<config::ClientboundConfigPacket>(
            &mut std::io::Cursor::new(bytes.as_slice()),
        )
        .expect("valid configuration disconnect packet");
        let config::ClientboundConfigPacket::Disconnect(packet) = parsed else {
            panic!("disconnect variant expected")
        };
        assert_eq!(packet.reason.to_string(), message);
    }

    #[test]
    fn disconnect_reason_wins_over_tcp_close_but_preserves_local_errors() {
        let signals = Arc::new(Mutex::new(None));
        record_disconnect(&signals, None);
        record_disconnect(&signals, Some("Server restarting".into()));
        record_disconnect(&signals, None);
        assert_eq!(
            signals.lock().unwrap().as_deref(),
            Some("Disconnected: Server restarting")
        );
        *signals.lock().unwrap() = Some("Session expired".into());
        record_disconnect(&signals, Some("Disconnected".into()));
        assert_eq!(signals.lock().unwrap().as_deref(), Some("Session expired"));
    }

    #[test]
    fn offline_access_is_literal_loopback_only() {
        for address in ["localhost", "LOCALHOST", "127.0.0.1", "::1"] {
            assert!(offline_host_allowed(address));
        }
        for address in [
            "localhost.example.com",
            "192.168.1.10",
            "example.com",
            "0.0.0.0",
            "::",
            "127.0.0.1.example.com",
        ] {
            assert!(!offline_host_allowed(address));
        }
    }

    #[test]
    fn parse_addresses_without_silently_discarding_components() {
        assert_eq!(parse_server_address("[::1]:25566").unwrap().port, 25566);
        assert_eq!(parse_server_address("::1").unwrap().host, "::1");
        assert_eq!(parse_server_address("example.com").unwrap().port, 25565);
        for invalid in [
            "example.com:25565:extra",
            "https://example.com",
            "localhost:0",
            "user@host",
            "a b",
            "localhost:65536",
        ] {
            assert!(parse_server_address(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn account_debug_redacts_the_token() {
        let account = BloomAccount {
            username: "SakuraTest".into(),
            uuid: Uuid::nil(),
            token: "secret-never-print".into(),
            certs: parking_lot::Mutex::new(None),
            terminal: Arc::new(Mutex::new(None)),
        };
        let debug = format!("{account:?}");
        assert!(debug.contains("redacted"));
        assert!(!debug.contains("secret-never-print"));
    }

    #[test]
    fn malformed_controls_do_not_start_walking() {
        assert_eq!(walk_direction(f32::NAN, f32::NAN), WalkDirection::None);
        assert_eq!(walk_direction(1.0, -1.0), WalkDirection::ForwardRight);
    }
}
