//! Explicit opt-in metadata acceptance against a disposable vanilla 26.1 server.
//! Uses a dedicated offline operator account and removes only its own tagged
//! fixtures. Never starts a server or changes a user's server configuration.
use crate::{
    network,
    shared::{ConnectionConfig, EntitySnapshot, InputState, SceneSnapshot},
};
use azalea_registry::builtin::ItemKind;
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

const TAG: &str = "sakura_metadata_test";
const PLAYER: &str = "sakuraentities";

struct FixtureConnection {
    input: Arc<Mutex<InputState>>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<Result<(), String>>>,
    restore_peaceful: bool,
}
impl Drop for FixtureConnection {
    fn drop(&mut self) {
        // This also runs on assertion failure, so fixture entities do not linger.
        let mut cleanup = vec![format!("/kill @e[tag={TAG}]")];
        if self.restore_peaceful {
            cleanup.push("/difficulty peaceful".into());
        }
        for command in cleanup {
            if let Ok(mut input) = self.input.lock() {
                input.chat_submit = Some(command);
            }
            thread::sleep(Duration::from_millis(250));
        }
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn wait_until(seconds: u64, predicate: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if predicate() {
            return true;
        }
        thread::sleep(Duration::from_millis(25));
    }
    false
}
fn command(input: &Arc<Mutex<InputState>>, value: String) {
    assert!(
        wait_until(3, || input.lock().unwrap().chat_submit.is_none()),
        "Previous fixture command was not consumed"
    );
    input.lock().unwrap().chat_submit = Some(value);
    assert!(
        wait_until(3, || input.lock().unwrap().chat_submit.is_none()),
        "Fixture command was not sent"
    );
}
fn near(entity: &EntitySnapshot, kind: &str, x: f64, z: f64) -> bool {
    entity.kind == kind
        && (entity.position[0] - x).abs() < 0.2
        && (entity.position[2] - z).abs() < 0.2
}
fn angle_near(actual: f32, expected: f32) -> bool {
    ((actual - expected + 180.).rem_euclid(360.) - 180.).abs() < 2.
}
fn entity(scene: &Arc<Mutex<SceneSnapshot>>, kind: &str, x: f64, z: f64) -> EntitySnapshot {
    assert!(
        wait_until(5, || scene
            .lock()
            .unwrap()
            .entities
            .iter()
            .any(|e| near(e, kind, x, z))),
        "Server did not publish fixture {kind} at ({x},{z})"
    );
    scene
        .lock()
        .unwrap()
        .entities
        .iter()
        .find(|e| near(e, kind, x, z))
        .unwrap()
        .clone()
}
fn by_id(
    scene: &Arc<Mutex<SceneSnapshot>>,
    id: i32,
    test: impl Fn(&EntitySnapshot) -> bool,
) -> bool {
    scene
        .lock()
        .unwrap()
        .entities
        .iter()
        .find(|entity| entity.id == id)
        .is_some_and(test)
}

#[test]
#[ignore = "requires disposable flat vanilla 26.1 on127.0.0.1:25579 and operator SakuraEntities"]
fn vanilla_entity_variants_metadata_rotation_visibility_and_removal() {
    let input = Arc::new(Mutex::new(InputState::default()));
    let scene = Arc::new(Mutex::new(SceneSnapshot::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let (worker_input, worker_scene, worker_stop) = (input.clone(), scene.clone(), stop.clone());
    let worker = thread::spawn(move || {
        network::run(
            ConnectionConfig {
                address: "127.0.0.1:25579".into(),
                username: PLAYER.into(),
                session: None,
                render_distance: 3,
            },
            worker_input,
            worker_scene,
            worker_stop,
        )
    });
    let mut fixture = FixtureConnection {
        input: input.clone(),
        stop,
        worker: Some(worker),
        restore_peaceful: false,
    };
    assert!(
        wait_until(15, || {
            let state = scene.lock().unwrap();
            state.connected && !state.sections.is_empty()
        }),
        "Could not join disposable vanilla fixture: {}",
        scene.lock().unwrap().status
    );
    command(&input, "/say SAKURA_ENTITY_OPERATOR_READY".into());
    assert!(
        wait_until(4, || scene
            .lock()
            .unwrap()
            .chat
            .iter()
            .any(|line| line.contains("SAKURA_ENTITY_OPERATOR_READY"))),
        "Fixture account lacks operator permission"
    );
    let ground = scene.lock().unwrap().player_position[1].round() as i32;
    assert!(
        (-1024..=1024).contains(&ground),
        "Unexpected fixture height"
    );
    command(&input, format!("/kill @e[tag={TAG}]"));
    command(&input, "/gamemode creative".into());
    command(&input, "/clear @s".into());
    // All mutations stay in this explicit disposable fixture. Normal difficulty
    // permits the size-bearing slime; the guard restores peaceful even on failure.
    fixture.restore_peaceful = true;
    command(&input, "/difficulty normal".into());
    command(&input, format!("/tp @s 160.5 {ground} 160.5 90 15"));
    assert!(
        wait_until(5, || {
            let p = scene.lock().unwrap().player_position;
            (p[0] - 160.5).abs() < 0.2 && (p[2] - 160.5).abs() < 0.2
        }),
        "Fixture player teleport did not reach network state"
    );
    assert!(
        wait_until(3, || {
            let input = input.lock().unwrap();
            angle_near(input.yaw, 90.) && angle_near(input.pitch, 15.)
        }),
        "Server teleport rotation was overwritten by stale native mouse input"
    );

    let spawn = |kind: &str, x: i32, z: i32, suffix: &str, extra: &str| {
        command(
            &input,
            format!(
                "/summon minecraft:{kind} {x}.0 {ground} {z}.0 {{Tags:[\"{TAG}\",\"sakura_meta_{suffix}\"],NoAI:1b,NoGravity:1b,Invulnerable:1b,PersistenceRequired:1b,{extra}}}"
            ),
        );
    };
    spawn(
        "cow",
        160,
        164,
        "cow",
        "variant:\"minecraft:warm\",Rotation:[90f,15f]",
    );
    spawn(
        "pig",
        163,
        164,
        "pig",
        "variant:\"minecraft:cold\",Age:-24000",
    );
    spawn("chicken", 166, 164, "chicken", "variant:\"minecraft:warm\"");
    spawn("sheep", 157, 164, "sheep", "Color:14b,Sheared:1b");
    spawn("slime", 154, 164, "slime", "Size:2");
    spawn(
        "villager",
        157,
        158,
        "villager",
        "VillagerData:{type:\"minecraft:snow\",profession:\"minecraft:librarian\",level:2}",
    );
    command(
        &input,
        format!(
            "/summon minecraft:item 166.0 {} 158.0 {{Tags:[\"{TAG}\",\"sakura_meta_item\"],NoGravity:1b,PickupDelay:32767s,Age:-32768s,Item:{{id:\"minecraft:diamond\",count:3}}}}",
            ground + 1
        ),
    );

    let cow = entity(&scene, "Cow", 160., 164.);
    assert!(
        wait_until(3, || by_id(&scene, cow.id, |e| e.variant == "warm")),
        "Warm cow registry variant was lost"
    );
    assert!(
        wait_until(3, || by_id(&scene, cow.id, |e| angle_near(e.yaw, 90.)
            && angle_near(e.pitch, 15.)
            && e.head_yaw.is_finite())),
        "Spawn body rotation did not reach the visual snapshot"
    );
    let pig = entity(&scene, "Pig", 163., 164.);
    assert!(
        wait_until(3, || by_id(&scene, pig.id, |e| e.variant == "cold"
            && e.baby)),
        "Cold variant or baby metadata was lost"
    );
    let chicken = entity(&scene, "Chicken", 166., 164.);
    assert!(
        wait_until(3, || by_id(&scene, chicken.id, |e| e.variant == "warm")),
        "Warm chicken registry variant was lost"
    );
    let sheep = entity(&scene, "Sheep", 157., 164.);
    assert!(
        wait_until(3, || by_id(&scene, sheep.id, |e| e.sheep_color == 14
            && e.sheared)),
        "Sheep color/sheared bitfield was lost"
    );
    let slime = entity(&scene, "Slime", 154., 164.);
    assert!(
        wait_until(3, || by_id(&scene, slime.id, |e| e.size == 3)),
        "Slime size metadata was lost"
    );
    let villager = entity(&scene, "Villager", 157., 158.);
    assert!(
        wait_until(3, || by_id(&scene, villager.id, |e| e.villager_type
            == "snow"
            && e.villager_profession == "librarian")),
        "Villager biome/profession metadata was lost"
    );
    let item = entity(&scene, "Item", 166., 158.);
    assert!(
        wait_until(3, || by_id(&scene, item.id, |e| e.item_id
            == ItemKind::Diamond as u32
            && e.item_count == 3)),
        "Dropped-item identity/count did not reach the visual snapshot"
    );

    command(
        &input,
        format!("/tp @e[tag=sakura_meta_cow,limit=1] 160.0 {ground} 164.0 180 30"),
    );
    assert!(
        wait_until(3, || by_id(&scene, cow.id, |e| angle_near(e.yaw, 180.)
            && angle_near(e.pitch, 30.)
            && angle_near(e.head_yaw, 180.))),
        "Teleport/RotateHead updates left stale body/head rotation"
    );
    command(
        &input,
        "/data merge entity @e[tag=sakura_meta_sheep,limit=1] {Color:11b,Sheared:0b}".into(),
    );
    assert!(
        wait_until(3, || by_id(&scene, sheep.id, |e| e.sheep_color == 11
            && !e.sheared)),
        "Changed sheep metadata was not published"
    );
    command(
        &input,
        "/data merge entity @e[tag=sakura_meta_pig,limit=1] {Age:0}".into(),
    );
    assert!(
        wait_until(3, || by_id(&scene, pig.id, |e| !e.baby)),
        "Baby-to-adult metadata did not update"
    );
    command(
        &input,
        "/effect give @e[tag=sakura_meta_cow,limit=1] minecraft:invisibility 30 0 true".into(),
    );
    assert!(
        wait_until(3, || !by_id(&scene, cow.id, |_| true)),
        "Invisible entity remained in visible snapshots"
    );
    command(
        &input,
        "/effect clear @e[tag=sakura_meta_cow,limit=1] minecraft:invisibility".into(),
    );
    assert!(
        wait_until(3, || by_id(&scene, cow.id, |e| e.variant == "warm")),
        "Visible entity did not reappear"
    );

    // The real native attack path must produce damage on the server, not just a
    // local swing or an optimistic health change.
    command(
        &input,
        "/data merge entity @e[tag=sakura_meta_cow,limit=1] {Invulnerable:0b,Health:10f}".into(),
    );
    command(&input, format!("/tp @s 160.5 {ground} 161.5 0 0"));
    assert!(
        wait_until(3, || {
            let p = scene.lock().unwrap().player_position;
            (p[0] - 160.5).abs() < 0.1 && (p[2] - 161.5).abs() < 0.1
        }),
        "Combat fixture teleport did not settle"
    );
    command(&input, "/execute if entity @e[tag=sakura_meta_cow,limit=1,nbt={Health:10.0f}] run say SAKURA_ATTACK_BASELINE".into());
    assert!(
        wait_until(3, || scene
            .lock()
            .unwrap()
            .chat
            .iter()
            .any(|line| line.contains("SAKURA_ATTACK_BASELINE"))),
        "Server did not confirm the attack target's initial health"
    );
    {
        let player = scene.lock().unwrap().player_position;
        let mut input = input.lock().unwrap();
        let dx = 160.0 - player[0];
        let dz = 164.0 - player[2];
        let dy = ground as f64 + 0.8 - (player[1] + 1.62);
        input.yaw = (-dx).atan2(dz).to_degrees() as f32;
        input.pitch = (-dy).atan2(dx.hypot(dz)).to_degrees() as f32;
    }
    // Let the authoritative client's pick system observe the new view direction
    // before sending the distinct mouse-down edge.
    thread::sleep(Duration::from_millis(150));
    input.lock().unwrap().attack = true;
    thread::sleep(Duration::from_millis(250));
    input.lock().unwrap().attack = false;
    command(&input, "/execute if entity @e[tag=sakura_meta_cow,limit=1] unless entity @e[tag=sakura_meta_cow,limit=1,nbt={Health:10.0f}] run say SAKURA_ENTITY_ATTACK_OK".into());
    assert!(
        wait_until(3, || scene
            .lock()
            .unwrap()
            .chat
            .iter()
            .any(|line| line.contains("SAKURA_ENTITY_ATTACK_OK"))),
        "Native attack did not change real server health"
    );

    let ids = [
        cow.id,
        pig.id,
        chicken.id,
        sheep.id,
        slime.id,
        villager.id,
        item.id,
    ];
    command(&input, format!("/kill @e[tag={TAG}]"));
    assert!(
        wait_until(5, || scene
            .lock()
            .unwrap()
            .entities
            .iter()
            .all(|entity| !ids.contains(&entity.id))),
        "Despawned fixture entities remained in renderer snapshots"
    );
    assert!(
        scene.lock().unwrap().connected,
        "Server disconnected during metadata acceptance"
    );
    command(&input, "/difficulty peaceful".into());
    fixture.restore_peaceful = false;
    println!(
        "Entity acceptance: 7 real fixture types, variants, growth, rotation, visibility, attack damage and despawn passed."
    );
}

#[test]
fn angle_assertion_accepts_protocol_wrap_and_rejects_stale_rotation() {
    assert!(angle_near(-180., 180.));
    assert!(angle_near(-90., 270.));
    assert!(!angle_near(0., 90.));
}
