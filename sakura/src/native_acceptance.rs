//! Explicit opt-in acceptance against a disposable, flat, loopback vanilla server.
//! Never starts a server or changes a user's world/server configuration.

use crate::{
    network,
    shared::{ConnectionConfig, InputState, SceneSnapshot},
};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

struct ConnectionGuard {
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<Result<(), String>>>,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
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

#[test]
#[ignore = "requires disposable vanilla 26.1 on 127.0.0.1:25579 and operator sakurainventory"]
fn vanilla_weather_biomes_sprint_sneak_and_flight() {
    let input=Arc::new(Mutex::new(InputState::default()));let scene=Arc::new(Mutex::new(SceneSnapshot::default()));let stop=Arc::new(AtomicBool::new(false));
    let (i,s,t)=(input.clone(),scene.clone(),stop.clone());
    let worker=thread::spawn(move||network::run(ConnectionConfig{address:"127.0.0.1:25579".into(),username:"sakurainventory".into(),session:None,render_distance:4},i,s,t));
    let _guard=ConnectionGuard{stop,worker:Some(worker)};
    assert!(wait_until(15,||scene.lock().unwrap().connected));
    let cmd=|text:&str|{input.lock().unwrap().chat_submit=Some(text.into());thread::sleep(Duration::from_millis(250));};
    cmd("/gamemode creative");cmd("/tp @s 160.5 -60 160.5 0 0");
    cmd("/fill 145 -60 145 175 -45 175 air");cmd("/fill 145 -61 145 175 -61 175 stone");
    cmd("/fillbiome 144 -64 144 176 -44 176 plains");cmd("/weather rain");
    assert!(wait_until(12,||{let s=scene.lock().unwrap();s.environment.rain>0.1 && s.environment.weather.columns.iter().any(|c|!c.snow)}),"real rain columns: {:?}",scene.lock().unwrap().environment);
    cmd("/fill 157 -56 157 163 -56 163 stone");
    assert!(wait_until(5,||scene.lock().unwrap().environment.weather.columns.iter().any(|c|c.x==160 && c.z==160 && c.floor>=-55)),"roof clips precipitation");
    cmd("/fill 157 -56 157 163 -56 163 air");
    cmd("/fillbiome 144 -64 144 176 -44 176 snowy_plains");
    assert!(wait_until(5,||{let s=scene.lock().unwrap();!s.environment.weather.columns.is_empty() && s.environment.weather.columns.iter().all(|c|c.snow)}),"live biome change selects snow");
    cmd("/fillbiome 144 -64 144 176 -44 176 desert");
    assert!(wait_until(5,||scene.lock().unwrap().environment.weather.columns.is_empty()),"dry biomes suppress rain and snow");
    cmd("/fillbiome 144 -64 144 176 -44 176 plains");cmd("/weather clear");
    let walk=|sprint:bool,sneak:bool| {
        cmd("/tp @s 160.5 -60 160.5 0 0");thread::sleep(Duration::from_millis(250));
        let start=scene.lock().unwrap().player_position;
        {let mut i=input.lock().unwrap();i.forward=1.;i.sprint=sprint;i.sneak=sneak;}
        thread::sleep(Duration::from_millis(1100));let end=scene.lock().unwrap().player_position;
        {let mut i=input.lock().unwrap();i.forward=0.;i.sprint=false;i.sneak=false;}
        thread::sleep(Duration::from_millis(300));
        (end[0]-start[0]).hypot(end[2]-start[2])
    };
    let normal=walk(false,false);let sprint=walk(true,false);let sneak=walk(false,true);
    cmd("/tp @s 160.5 -60 160.5 0 0");
    {let mut i=input.lock().unwrap();i.forward=1.;i.sprint_tap+=1;}
    assert!(wait_until(2,||scene.lock().unwrap().fov_multiplier>1.1),"double-tap pulse starts sprint and FOV response");
    input.lock().unwrap().forward=0.;
    assert!(wait_until(2,||scene.lock().unwrap().fov_multiplier<1.01),"releasing W stops sprint");
    assert!(normal>3.5 && normal<5.3,"walk distance {normal}");
    assert!(sprint>normal*1.17 && sprint<normal*1.45,"sprint {sprint} vs walk {normal}");
    assert!(sneak<normal*0.45 && sneak>normal*0.20,"sneak {sneak} vs walk {normal}");
    input.lock().unwrap().sneak=true;
    assert!(wait_until(2,||scene.lock().unwrap().eye_height==1.27),"crouched camera height");
    input.lock().unwrap().sneak=false;
    assert!(wait_until(2,||scene.lock().unwrap().eye_height==1.62));
    cmd("/tp @s 160.5 -60 160.5 0 0");
    {let mut i=input.lock().unwrap();i.fly_tap+=1;i.jump=true;}
    assert!(wait_until(3,||scene.lock().unwrap().player_position[1]>-56.),"creative double jump ascent");
    input.lock().unwrap().jump=false;thread::sleep(Duration::from_millis(800));
    let hovering=scene.lock().unwrap().player_position[1];thread::sleep(Duration::from_millis(600));
    assert!((scene.lock().unwrap().player_position[1]-hovering).abs()<0.1,"creative flight must hover without gravity drift");
    input.lock().unwrap().sneak=true;
    assert!(wait_until(3,||scene.lock().unwrap().player_position[1]<hovering-1.),"Shift descends during flight");
    assert_eq!(scene.lock().unwrap().eye_height,1.62,"descending is not crouching");
    input.lock().unwrap().sneak=false;
    input.lock().unwrap().fly_tap+=1;
    assert!(wait_until(4,||scene.lock().unwrap().player_position[1]< -59.9),"flight toggle returns to normal gravity");
    cmd("/gamemode survival");input.lock().unwrap().fly_tap+=1;
    thread::sleep(Duration::from_millis(500));
    assert!((scene.lock().unwrap().player_position[1]+60.).abs()<0.05,"survival cannot grant itself flight");
    cmd("/gamemode creative");cmd("/tp @s 50.5 -60 50.5 0 10");
    println!("weather and movement: walk={normal:.3}, sprint={sprint:.3}, sneak={sneak:.3}");
}

#[test]
#[ignore = "requires disposable vanilla 26.1 on 127.0.0.1:25579 and operator sakurainventory"]
fn vanilla_environment_packets_and_camera_media() {
    use crate::atmosphere::Medium;
    let input=Arc::new(Mutex::new(InputState::default()));let scene=Arc::new(Mutex::new(SceneSnapshot::default()));let stop=Arc::new(AtomicBool::new(false));
    let (i,s,t)=(input.clone(),scene.clone(),stop.clone());
    let worker=thread::spawn(move||network::run(ConnectionConfig{address:"127.0.0.1:25579".into(),username:"sakurainventory".into(),session:None,render_distance:4},i,s,t));
    let _guard=ConnectionGuard{stop,worker:Some(worker)};
    assert!(wait_until(15,||scene.lock().unwrap().connected));
    let cmd=|text:&str|{input.lock().unwrap().chat_submit=Some(text.into());thread::sleep(Duration::from_millis(220));};
    cmd("/gamemode creative");cmd("/tp @s 80.5 -58 112.5 180 0");
    cmd("/fill 77 -60 109 83 -53 115 stone hollow");
    for (block,medium) in [("water",Medium::Water),("lava",Medium::Lava),("powder_snow",Medium::PowderSnow),("air",Medium::Air)] {
        cmd("/fill 78 -59 110 82 -54 114 air");
        cmd(&format!("/fill 78 -59 110 82 -54 114 {block}"));
        assert!(wait_until(5,||scene.lock().unwrap().environment.atmosphere.medium==medium),"camera medium {block}: {:?}, at {:?}",{let s=scene.lock().unwrap();s.environment.atmosphere.medium},{let s=scene.lock().unwrap();s.player_position});
    }
    input.lock().unwrap().chat_submit=Some("/summon minecraft:lightning_bolt 80 -53 112".into());
    assert!(wait_until(4,||scene.lock().unwrap().environment.atmosphere.flashing()),"real lightning spawn must flash");
    assert!(wait_until(5,||!scene.lock().unwrap().environment.atmosphere.flashing()),"flash must expire");
    assert!(scene.lock().unwrap().environment.atmosphere.game_time>0,"server game clock");
    cmd("/weather thunder");
    assert!(wait_until(8,||scene.lock().unwrap().environment.thunder>0.),"weather packets");
    cmd("/weather clear");cmd("/gamemode creative");cmd("/tp @s 50.5 -60 50.5 0 10");
}

#[test]
#[ignore = "requires an explicitly prepared disposable flat vanilla 26.1 server on 127.0.0.1:25579"]
fn vanilla_loopback_movement_and_ground_collision() {
    let input = Arc::new(Mutex::new(InputState::default()));
    let scene = Arc::new(Mutex::new(SceneSnapshot::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let worker_input = input.clone();
    let worker_scene = scene.clone();
    let worker_stop = stop.clone();
    let worker = thread::spawn(move || {
        network::run(
            ConnectionConfig {
                address: "127.0.0.1:25579".into(),
                username: "SakuraMovement".into(),
                session: None,
                render_distance: 4,
            },
            worker_input,
            worker_scene,
            worker_stop,
        )
    });
    let mut guard = ConnectionGuard {
        stop,
        worker: Some(worker),
    };
    assert!(
        wait_until(15, || {
            let state = scene.lock().unwrap();
            state.connected && !state.sections.is_empty()
        }),
        "No real terrain received: {}",
        scene.lock().unwrap().status
    );
    thread::sleep(Duration::from_millis(750));
    let start = scene.lock().unwrap().player_position;
    input.lock().unwrap().forward = 1.0;
    let moved = wait_until(3, || {
        let current = scene.lock().unwrap().player_position;
        (current[0] - start[0]).hypot(current[2] - start[2]) > 2.0
    });
    input.lock().unwrap().forward = 0.0;
    assert!(
        moved,
        "Movement input did not change the live player position"
    );
    thread::sleep(Duration::from_millis(250));
    // At Minecraft yaw zero the camera faces +Z, so screen-right is -X.
    for (strafe, sign) in [(1.,-1.),(-1.,1.)] {
        let start_x=scene.lock().unwrap().player_position[0];
        {let mut state=input.lock().unwrap();state.yaw=0.;state.strafe=strafe;}
        let moved=wait_until(3,|| (scene.lock().unwrap().player_position[0]-start_x)*sign>1.);
        input.lock().unwrap().strafe=0.;
        assert!(moved,"strafe must follow the rendered camera's handedness");
        thread::sleep(Duration::from_millis(250));
    }
    let ground = scene.lock().unwrap().player_position[1];
    assert!(
        (ground - start[1]).abs() < 0.05,
        "Player did not remain on the flat ground"
    );
    input.lock().unwrap().jump = true;
    let jumped = wait_until(2, || {
        scene.lock().unwrap().player_position[1] > ground + 0.5
    });
    input.lock().unwrap().jump = false;
    assert!(
        jumped,
        "Jump input did not lift the player above the ground"
    );
    assert!(
        wait_until(3, || (scene.lock().unwrap().player_position[1] - ground)
            .abs()
            < 0.05),
        "Player did not land on the server's ground"
    );
    assert!(
        scene.lock().unwrap().connected,
        "Server disconnected during movement"
    );
    guard.stop.store(true, Ordering::Release);
    let began_shutdown = Instant::now();
    assert!(guard.worker.take().unwrap().join().unwrap().is_ok());
    assert!(
        began_shutdown.elapsed() < Duration::from_secs(3),
        "Disconnect did not finish promptly"
    );
}

#[test]
#[ignore = "requires the disposable loopback vanilla server with SakuraGameplay operator permission"]
fn vanilla_loopback_inventory_mining_placement_chat_and_idle_terrain() {
    let input = Arc::new(Mutex::new(InputState::default()));
    let scene = Arc::new(Mutex::new(SceneSnapshot::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let (i, s, t) = (input.clone(), scene.clone(), stop.clone());
    let worker = thread::spawn(move || {
        network::run(
            ConnectionConfig {
                address: "127.0.0.1:25579".into(),
                username: "SakuraGameplay".into(),
                session: None,
                render_distance: 3,
            },
            i,
            s,
            t,
        )
    });
    let _guard = ConnectionGuard {
        stop,
        worker: Some(worker),
    };
    assert!(wait_until(15, || {
        let scene = scene.lock().unwrap();
        scene.connected && !scene.sections.is_empty()
    }));
    let command = |text: String| {
        input.lock().unwrap().chat_submit = Some(text);
        thread::sleep(Duration::from_millis(180));
    };
    thread::sleep(Duration::from_millis(600));
    let ground = scene.lock().unwrap().player_position[1].round() as i32;
    command("/gamemode creative".into());
    command(format!("/tp @s 0.5 {ground} 0.5 0 0"));
    command("/clear @s".into());
    command("/give @s minecraft:oak_planks 64".into());
    assert!(
        wait_until(3, || scene
            .lock()
            .unwrap()
            .hotbar
            .iter()
            .any(|s| s.name == "OakPlanks" && s.count == 64)),
        "Server inventory did not reach HUD"
    );
    command(format!("/setblock 0 {} 2 minecraft:stone", ground + 1));
    assert!(
        wait_until(3, || scene.lock().unwrap().target
            == Some([0, ground + 1, 2])),
        "Real raycast did not hit test block"
    );
    input.lock().unwrap().attack = true;
    thread::sleep(Duration::from_millis(180));
    input.lock().unwrap().attack = false;
    command(format!(
        "/execute if block 0 {} 2 minecraft:air run say SAKURA_BREAK_OK",
        ground + 1
    ));
    assert!(
        wait_until(3, || scene
            .lock()
            .unwrap()
            .chat
            .iter()
            .any(|s| s.contains("SAKURA_BREAK_OK"))),
        "Server did not confirm broken block"
    );
    command(format!("/setblock 0 {} 2 minecraft:stone", ground + 1));
    assert!(wait_until(3, || scene.lock().unwrap().target
        == Some([0, ground + 1, 2])));
    input.lock().unwrap().use_item += 1;
    thread::sleep(Duration::from_millis(300));
    command(format!(
        "/execute if block 0 {} 1 minecraft:oak_planks run say SAKURA_PLACE_OK",
        ground + 1
    ));
    assert!(
        wait_until(3, || scene
            .lock()
            .unwrap()
            .chat
            .iter()
            .any(|s| s.contains("SAKURA_PLACE_OK"))),
        "Server did not confirm placed block"
    );
    // Let initial chunk/light delivery settle, then prove idle terrain has no rebuild churn.
    thread::sleep(Duration::from_secs(2));
    let revision = scene.lock().unwrap().revision;
    thread::sleep(Duration::from_millis(600));
    assert_eq!(
        scene.lock().unwrap().revision,
        revision,
        "Stationary, unchanged terrain was rebuilt"
    );
    // Leave this disposable fixture navigable for subsequent runs.
    command(format!("/setblock 0 {} 1 minecraft:air", ground + 1));
    command(format!("/setblock 0 {} 2 minecraft:air", ground + 1));
}

#[test]
#[ignore = "requires the disposable offline vanilla 26.1 server with SakuraInventory operator permission; uses fixture area50,-60,50"]
fn vanilla_loopback_real_crafting_containers_and_cursor() {
    use crate::shared::{
        InventoryAction, InventoryActionKind as Action, InventoryKind, InventorySlotRole,
    };
    let input = Arc::new(Mutex::new(InputState::default()));
    let scene = Arc::new(Mutex::new(SceneSnapshot::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let (i, s, t) = (input.clone(), scene.clone(), stop.clone());
    let worker = thread::spawn(move || {
        network::run(
            ConnectionConfig {
                address: "127.0.0.1:25579".into(),
                username: "sakurainventory".into(),
                session: None,
                render_distance: 3,
            },
            i,
            s,
            t,
        )
    });
    let _guard = ConnectionGuard {
        stop,
        worker: Some(worker),
    };
    assert!(wait_until(15, || scene.lock().unwrap().connected));
    let command = |text: &str| {
        input.lock().unwrap().chat_submit = Some(text.to_owned());
        thread::sleep(Duration::from_millis(220));
    };
    let snapshot = || scene.lock().unwrap().inventory.clone();
    let action = |kind: Action| {
        let before = snapshot();
        let description = format!("{kind:?} menu={} epoch={}", before.menu_id, before.epoch);
        assert!(input.lock().unwrap().queue_inventory(InventoryAction {
            menu_id: before.menu_id,
            epoch: before.epoch,
            kind
        }));
        assert!(
            wait_until(3, || snapshot().revision > before.revision),
            "Inventory action was not applied: {description}; current={:?}",
            snapshot()
        );
        thread::sleep(Duration::from_millis(120));
    };
    let slot = |name: &str| {
        snapshot()
            .slots
            .iter()
            .find(|slot| {
                slot.stack.name == name
                    && matches!(
                        slot.role,
                        InventorySlotRole::Player | InventorySlotRole::Hotbar
                    )
            })
            .map(|slot| slot.index)
            .unwrap_or_else(|| panic!("Missing fixture item {name}"))
    };
    let cursor = |name: &str, count: u16| {
        assert!(
            wait_until(3, || {
                let inv = snapshot();
                inv.cursor.name == name && inv.cursor.count == count
            }),
            "Unexpected carried item: wanted {name} x{count}, got {:?}",
            snapshot().cursor
        );
    };
    let close = || {
        action(Action::Close);
        assert!(wait_until(3, || !snapshot().open));
    };
    command("/gamemode survival");
    command("/tp @s 50.5 -60 50.5 0 0");
    command("/clear @s");
    command("/give @s minecraft:oak_log 4");
    assert!(wait_until(3, || snapshot().slots.iter().any(|s| s
        .stack
        .name
        == "OakLog"
        && s.stack.count == 4)));
    action(Action::OpenPlayer);
    assert_eq!(snapshot().kind, InventoryKind::Player);
    let logs = slot("OakLog");
    action(Action::Pickup {
        slot: Some(logs),
        right: false,
    });
    cursor("OakLog", 4);
    action(Action::Pickup {
        slot: Some(1),
        right: true,
    });
    cursor("OakLog", 3);
    action(Action::Pickup {
        slot: Some(logs),
        right: false,
    });
    assert!(
        wait_until(3, || snapshot().slots[0].stack.name == "OakPlanks"
            && snapshot().slots[0].stack.count == 4),
        "2x2 result was not supplied by the real server"
    );
    action(Action::Pickup {
        slot: Some(0),
        right: false,
    });
    cursor("OakPlanks", 4);
    action(Action::Pickup {
        slot: Some(37),
        right: false,
    });
    assert!(
        wait_until(3, || snapshot().slots[1].stack.count == 0),
        "Server did not consume the crafting ingredient"
    );
    close();
    command(
        "/execute if items entity @s hotbar.1 minecraft:oak_planks run say SAKURA_LOG_RECIPE_OK",
    );
    assert!(wait_until(3, || scene
        .lock()
        .unwrap()
        .chat
        .iter()
        .any(|s| s.contains("SAKURA_LOG_RECIPE_OK"))));
    action(Action::OpenPlayer);
    let planks = slot("OakPlanks");
    action(Action::Pickup {
        slot: Some(planks),
        right: false,
    });
    for cell in 1..=4 {
        action(Action::Pickup {
            slot: Some(cell),
            right: true,
        });
    }
    assert!(wait_until(3, || snapshot().slots[0].stack.name == "CraftingTable"));
    action(Action::Pickup {
        slot: Some(0),
        right: false,
    });
    action(Action::Pickup {
        slot: Some(37),
        right: false,
    });
    close();
    command("/execute if items entity @s hotbar.1 minecraft:crafting_table run say SAKURA_2X2_OK");
    assert!(wait_until(3, || scene
        .lock()
        .unwrap()
        .chat
        .iter()
        .any(|s| s.contains("SAKURA_2X2_OK"))));

    command("/give @s minecraft:oak_planks 8");
    command("/give @s minecraft:stick 2");
    command("/setblock 50 -59 52 minecraft:crafting_table");
    assert!(wait_until(3, || scene.lock().unwrap().target == Some([50, -59, 52])));
    input.lock().unwrap().use_item += 1;
    assert!(wait_until(3, || snapshot().open
        && snapshot().kind == InventoryKind::Crafting));
    let planks = slot("OakPlanks");
    action(Action::Pickup {
        slot: Some(planks),
        right: false,
    });
    for cell in [1, 2, 3] {
        action(Action::Pickup {
            slot: Some(cell),
            right: true,
        });
    }
    action(Action::Pickup {
        slot: Some(planks),
        right: false,
    });
    let sticks = slot("Stick");
    action(Action::Pickup {
        slot: Some(sticks),
        right: false,
    });
    for cell in [5, 8] {
        action(Action::Pickup {
            slot: Some(cell),
            right: true,
        });
    }
    assert!(
        wait_until(3, || snapshot().slots[0].stack.name == "WoodenPickaxe"),
        "3x3 recipe result missing"
    );
    action(Action::QuickMove { slot: 0 });
    assert!(wait_until(3, || snapshot().slots.iter().any(|s| s
        .stack
        .name
        == "WoodenPickaxe"
        && matches!(
            s.role,
            InventorySlotRole::Player | InventorySlotRole::Hotbar
        ))));
    close();
    command(
        "/execute if items entity @s inventory.* minecraft:wooden_pickaxe run say SAKURA_3X3_OK",
    );
    command("/execute if items entity @s hotbar.* minecraft:wooden_pickaxe run say SAKURA_3X3_OK");
    assert!(wait_until(3, || scene
        .lock()
        .unwrap()
        .chat
        .iter()
        .any(|s| s.contains("SAKURA_3X3_OK"))));

    command("/setblock 54 -59 52 minecraft:air");
    command("/setblock 54 -59 52 minecraft:chest");
    command("/tp @s 54.5 -60 50.5 0 0");
    assert!(wait_until(3, || scene.lock().unwrap().target == Some([54, -59, 52])));
    input.lock().unwrap().use_item += 1;
    assert!(wait_until(3, || snapshot().open
        && matches!(snapshot().kind, InventoryKind::Chest { .. })));
    let planks = slot("OakPlanks");
    action(Action::QuickMove { slot: planks });
    assert!(wait_until(3, || snapshot().slots.iter().any(|s| s.role
        == InventorySlotRole::Storage
        && s.stack.name == "OakPlanks")));
    let storage = snapshot()
        .slots
        .iter()
        .find(|s| s.role == InventorySlotRole::Storage && s.stack.name == "OakPlanks")
        .unwrap()
        .index;
    action(Action::Pickup {
        slot: Some(storage),
        right: true,
    });
    cursor("OakPlanks", 3);
    action(Action::Pickup {
        slot: Some(1),
        right: false,
    });
    action(Action::SwapHotbar { slot: 1, hotbar: 8 });
    assert!(wait_until(3, || snapshot()
        .slots
        .iter()
        .any(|s| s.role == InventorySlotRole::Hotbar
            && s.stack.name == "OakPlanks"
            && s.stack.count == 3)));
    let stale = snapshot();
    close();
    assert!(input.lock().unwrap().queue_inventory(InventoryAction {
        menu_id: stale.menu_id,
        epoch: stale.epoch,
        kind: Action::Pickup {
            slot: Some(storage),
            right: false
        }
    }));
    thread::sleep(Duration::from_millis(180));
    assert!(!snapshot().open);
    assert_eq!(snapshot().cursor.count, 0);
    command(
        "/execute if items entity @s hotbar.8 minecraft:oak_planks run say SAKURA_CHEST_SWAP_OK",
    );
    assert!(wait_until(3, || scene
        .lock()
        .unwrap()
        .chat
        .iter()
        .any(|s| s.contains("SAKURA_CHEST_SWAP_OK"))));
    action(Action::OpenPlayer);
    action(Action::Drop {
        slot: 44,
        whole_stack: false,
    });
    assert!(wait_until(3, || snapshot().slots[44].stack.count == 2));
    close();

    command("/give @s minecraft:raw_iron 1");
    command("/give @s minecraft:coal 1");
    command("/setblock 58 -59 52 minecraft:air");
    command("/setblock 58 -59 52 minecraft:furnace");
    command("/tp @s 58.5 -60 50.5 0 0");
    assert!(wait_until(3, || scene.lock().unwrap().target == Some([58, -59, 52])));
    input.lock().unwrap().use_item += 1;
    assert!(wait_until(3, || snapshot().open
        && snapshot().kind == InventoryKind::Furnace));
    for (name, target) in [("RawIron", 0), ("Coal", 1)] {
        let source = slot(name);
        action(Action::Pickup {
            slot: Some(source),
            right: false,
        });
        action(Action::Pickup {
            slot: Some(target),
            right: false,
        });
    }
    assert!(
        wait_until(3, || snapshot()
            .properties
            .iter()
            .any(|(id, value)| *id == 0 && *value > 0)),
        "Real furnace burn properties missing"
    );
    assert!(
        wait_until(15, || snapshot().slots[2].stack.name == "IronIngot"),
        "Furnace did not produce the real smelting output"
    );
    action(Action::QuickMove { slot: 2 });
    close();
    command(
        "/execute if items entity @s inventory.* minecraft:iron_ingot run say SAKURA_FURNACE_OK",
    );
    command("/execute if items entity @s hotbar.* minecraft:iron_ingot run say SAKURA_FURNACE_OK");
    assert!(wait_until(3, || scene
        .lock()
        .unwrap()
        .chat
        .iter()
        .any(|s| s.contains("SAKURA_FURNACE_OK"))));
    println!(
        "vanilla_inventory: server2x2=true server3x3=true chest=true furnace=true cursor_split=true hotbar_swap=true drop=true stale_menu_rejected=true"
    );
}

#[test]
#[ignore = "disposable offline vanilla26.1 loopback25579 with operator sakurainventory; tests server inventory/HUD at50,-60,50"]
fn vanilla_inventory_conservation_recipe_book_remainders_and_hud() {
    use crate::shared::{InventoryAction, InventoryActionKind as Action, InventoryKind};
    let input = Arc::new(Mutex::new(InputState::default()));
    let scene = Arc::new(Mutex::new(SceneSnapshot::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let (i, s, t) = (input.clone(), scene.clone(), stop.clone());
    let worker = thread::spawn(move || {
        network::run(
            ConnectionConfig {
                address: "127.0.0.1:25579".into(),
                username: "sakurainventory".into(),
                session: None,
                render_distance: 3,
            },
            i,
            s,
            t,
        )
    });
    let _guard = ConnectionGuard {
        stop,
        worker: Some(worker),
    };
    assert!(wait_until(15, || scene.lock().unwrap().connected));
    let command = |text: &str| {
        input.lock().unwrap().chat_submit = Some(text.into());
        thread::sleep(Duration::from_millis(200));
    };
    let inv = || scene.lock().unwrap().inventory.clone();
    let hud = || scene.lock().unwrap().hud.clone();
    let action = |kind: Action| {
        let before = inv();
        assert!(input.lock().unwrap().queue_inventory(InventoryAction {
            menu_id: before.menu_id,
            epoch: before.epoch,
            kind
        }));
        thread::sleep(Duration::from_millis(180));
    };
    let find = |name: &str| {
        inv()
            .slots
            .iter()
            .find(|s| {
                s.stack.name == name
                    && matches!(
                        s.role,
                        crate::shared::InventorySlotRole::Player
                            | crate::shared::InventorySlotRole::Hotbar
                    )
            })
            .map(|s| s.index)
            .unwrap_or_else(|| panic!("Missing {name}"))
    };
    let count = |name: &str| {
        let snapshot = inv();
        snapshot
            .slots
            .iter()
            .filter(|s| s.stack.name == name)
            .map(|s| u32::from(s.stack.count))
            .sum::<u32>()
            + if snapshot.cursor.name == name {
                u32::from(snapshot.cursor.count)
            } else {
                0
            }
    };
    let pickup = |slot: u16, right: bool| {
        action(Action::Pickup {
            slot: Some(slot),
            right,
        })
    };
    command("/gamemode survival");
    command("/tp @s 50.5 -60 50.5 0 0");
    command("/clear @s");
    command("/give @s minecraft:oak_planks 9");
    assert!(wait_until(3, || count("OakPlanks") == 9));
    assert_eq!(hud().game_mode, 0);
    assert_eq!(
        hud().air,
        300,
        "Fresh outdoor survival player must retain vanilla's omitted air default"
    );
    action(Action::OpenPlayer);
    pickup(find("OakPlanks"), false);
    action(Action::Distribute {
        slots: vec![9, 10, 11],
        right: false,
    });
    assert!(wait_until(3, || inv().slots[9].stack.count == 3
        && inv().slots[10].stack.count == 3
        && inv().slots[11].stack.count == 3
        && inv().cursor.count == 0));
    assert_eq!(count("OakPlanks"), 9);
    pickup(9, false);
    action(Action::PickupAll { slot: 9 });
    assert!(wait_until(3, || inv().cursor.count == 9));
    assert_eq!(count("OakPlanks"), 9);
    action(Action::Distribute {
        slots: vec![12, 13, 13],
        right: true,
    });
    assert!(wait_until(3, || inv().cursor.count == 7
        && inv().slots[12].stack.count == 1
        && inv().slots[13].stack.count == 1));
    pickup(36, false);
    action(Action::Close);
    command(
        r#"/item replace entity @s hotbar.1 with minecraft:oak_planks[custom_name={text:"Marked"}] 4"#,
    );
    action(Action::OpenPlayer);
    pickup(36, false);
    pickup(37, false);
    assert!(wait_until(3, || inv().cursor.count == 4
        && inv()
            .cursor
            .custom_name
            .as_ref()
            .is_some_and(|t| t.plain == "Marked")
        && inv().slots[37].stack.count == 7));
    assert_ne!(
        inv().cursor.component_fingerprint,
        inv().slots[37].stack.component_fingerprint
    );
    action(Action::PickupAll { slot: 36 });
    thread::sleep(Duration::from_millis(200));
    assert_eq!(
        inv().cursor.count,
        4,
        "Different custom-name components were merged"
    );
    pickup(36, false);
    assert_eq!(count("OakPlanks"), 13);
    action(Action::Close);

    // A full player inventory contains only logs, leaving no legal destination
    // for the different plank result. Shift crafting must consume nothing.
    command("/clear @s");
    command("/give @s minecraft:oak_log 2304");
    assert!(wait_until(3, || count("OakLog") == 2304));
    action(Action::OpenPlayer);
    pickup(36, false);
    pickup(1, true);
    pickup(36, false);
    assert!(wait_until(3, || inv().slots[0].stack.name == "OakPlanks"));
    action(Action::QuickMove { slot: 0 });
    thread::sleep(Duration::from_millis(250));
    assert_eq!(count("OakLog"), 2304);
    assert_eq!(inv().slots[1].stack.count, 1);
    assert_eq!(inv().slots[0].stack.count, 4);
    action(Action::Close);
    assert!(wait_until(3, || inv().slots[1].stack.count == 0
        && count("OakLog") == 2304));

    // The recipe book uses server-provided display IDs and the real placement
    // packet. Shift crafting all eight logs must produce exactly32 planks.
    command("/clear @s");
    command("/give @s minecraft:oak_log 8");
    command("/recipe take @s minecraft:oak_planks");
    command("/recipe give @s minecraft:oak_planks");
    action(Action::OpenPlayer);
    assert!(
        wait_until(3, || inv()
            .recipes
            .iter()
            .any(|r| r.result.name == "OakPlanks")),
        "Recipe list {:?}; connection {}",
        inv()
            .recipes
            .iter()
            .map(|r| &r.result.name)
            .collect::<Vec<_>>(),
        scene.lock().unwrap().status
    );
    let recipe = inv()
        .recipes
        .iter()
        .find(|r| r.result.name == "OakPlanks")
        .unwrap()
        .id;
    action(Action::PlaceRecipe {
        recipe_id: recipe,
        craft_all: true,
    });
    assert!(wait_until(3, || inv().slots[0].stack.name == "OakPlanks"));
    action(Action::QuickMove { slot: 0 });
    assert!(wait_until(3, || count("OakPlanks") == 32 && count("OakLog") == 0));
    action(Action::Close);

    // Cake verifies three milk-bucket remainders and closing both temporary
    // inputs and a carried result with enough destination capacity.
    command("/clear @s");
    command("/give @s minecraft:milk_bucket 3");
    command("/give @s minecraft:wheat 3");
    command("/give @s minecraft:sugar 2");
    command("/give @s minecraft:egg 1");
    command("/setblock 50 -59 52 minecraft:crafting_table");
    input.lock().unwrap().use_item += 1;
    assert!(wait_until(3, || inv().open && inv().kind == InventoryKind::Crafting));
    for target in [1, 2, 3] {
        pickup(find("MilkBucket"), false);
        pickup(target, false);
    }
    pickup(find("Wheat"), false);
    for target in [7, 8, 9] {
        pickup(target, true);
    }
    pickup(find("Sugar"), false);
    for target in [4, 6] {
        pickup(target, true);
    }
    pickup(find("Egg"), false);
    pickup(5, false);
    assert!(wait_until(3, || inv().slots[0].stack.name == "Cake"));
    pickup(0, false);
    pickup(10, false);
    assert!(wait_until(3, || count("Bucket") == 3 && count("Cake") == 1));
    action(Action::Close);
    assert!(wait_until(3, || count("Bucket") == 3 && inv().cursor.count == 0));
    action(Action::OpenPlayer);
    pickup(find("Cake"), false);
    action(Action::Close);
    assert!(wait_until(3, || inv().cursor.count == 0 && count("Cake") == 1));

    command("/attribute @s minecraft:max_health base set 40");
    command("/effect give @s minecraft:absorption 60 1 true");
    command("/effect give @s minecraft:regeneration 60 0 false");
    command("/experience set @s 7 levels");
    command("/experience set @s 5 points");
    command("/item replace entity @s armor.chest with minecraft:diamond_chestplate");
    command("/item replace entity @s weapon.offhand with minecraft:shield");
    command(
        r#"/item replace entity @s hotbar.0 with minecraft:diamond_sword[damage=100,enchantments={"minecraft:sharpness":1},custom_name={text:"HUD blade",color:"gold"}]"#,
    );
    command(r#"/title @s title {text:"Inventory verified",color:"gold",bold:true}"#);
    command(r#"/title @s subtitle {text:"Server data",italic:true}"#);
    command(r#"/title @s actionbar {text:"HUD verified",color:"aqua"}"#);
    command("/bossbar remove sakura_test:hud");
    command(r#"/bossbar add sakura_test:hud {text:"Reference HUD",color:"red"}"#);
    command("/bossbar set sakura_test:hud players @s");
    command("/bossbar set sakura_test:hud value 35");
    command("/bossbar set sakura_test:hud color purple");
    assert!(wait_until(4, || hud().max_health == 40.
        && hud().absorption >= 8.
        && hud().armor >= 8
        && hud().level == 7
        && hud().experience > 0.
        && hud().offhand.name == "Shield"));
    assert!(
        hud()
            .effects
            .iter()
            .any(|e| e.name == "regeneration" && e.show_icon)
    );
    assert!(
        hud()
            .title
            .as_ref()
            .is_some_and(|t| t.text.plain == "Inventory verified" && t.text.json.contains("gold"))
    );
    assert_eq!(hud().subtitle.plain, "Server data");
    assert!(
        hud()
            .action_bar
            .as_ref()
            .is_some_and(|t| t.text.plain == "HUD verified")
    );
    assert!(
        hud()
            .boss_bars
            .iter()
            .any(|b| b.name.plain == "Reference HUD"
                && (b.progress - 0.35).abs() < 0.001
                && b.color == 5)
    );
    assert!(wait_until(3, || inv().slots.iter().any(|s| s.stack.name
        == "DiamondSword"
        && s.stack.damage == 100
        && s.stack.max_damage == 1561
        && s.stack.enchantment_glint)));
    command("/gamemode spectator");
    assert!(wait_until(3, || hud().game_mode == 3));
    command("/bossbar remove sakura_test:hud");
    command("/effect clear @s");
    command("/attribute @s minecraft:max_health base set 20");
    command("/gamemode survival");
    println!(
        "vanilla_ui_data: drag=true doubleclick=true component_safe=true full_destination=true recipe_book=true repeated_craft=true remainders=true cursor_close=true hud=true"
    );
}

#[test]
#[ignore = "requires the explicitly prepared disposable vanilla 26.1 loopback server"]
fn vanilla_lighting_sources_roofs_boundaries_and_clock() {
    use crate::lighting::LightSample;
    let input=Arc::new(Mutex::new(InputState::default()));let scene=Arc::new(Mutex::new(SceneSnapshot::default()));let stop=Arc::new(AtomicBool::new(false));
    let (i,s,t)=(input.clone(),scene.clone(),stop.clone());let worker=thread::spawn(move||network::run(ConnectionConfig{address:"127.0.0.1:25579".into(),username:"sakurainventory".into(),session:None,render_distance:4},i,s,t));
    let _guard=ConnectionGuard{stop,worker:Some(worker)};
    assert!(wait_until(15,||scene.lock().unwrap().connected));
    let cmd=|text:&str|{input.lock().unwrap().chat_submit=Some(text.into());thread::sleep(Duration::from_millis(220));};
    let sample=|p:[i32;3]|->LightSample{let scene=scene.lock().unwrap();let key=p.map(|v|v.div_euclid(16));let Some(s)=scene.sections.get(&key) else{return Default::default()};let [x,y,z]=p.map(|v|v.rem_euclid(16) as usize+1);let n=x+18*(z+18*y);let known=s.light_known[n];LightSample{block:(known&1!=0).then_some(s.light[n]&15),sky:(known&2!=0).then_some(s.light[n]>>4)}};
    cmd("/gamemode creative");cmd("/tp @s 16.5 -59 112.5 180 0");cmd("/gamerule minecraft:advance_time false");cmd("/time set noon");cmd("/weather clear");
    cmd("/fill -17 -59 96 33 -55 126 air");cmd("/fill -17 -60 96 33 -60 126 stone");
    cmd("/setblock 15 -59 111 glowstone");
    for (d,l) in [(0,15),(1,14),(2,13),(7,8),(14,1),(15,0)] {assert!(wait_until(6,||sample([15+d,-59,111]).block==Some(l)),"source distance {d}: {:?}; status {:?}; raw {:?}",sample([15+d,-59,111]),{let s=scene.lock().unwrap();s.status.clone()}, {let s=scene.lock().unwrap();s.light_debug.clone()});}
    assert_eq!(sample([16,-59,111]).sky,Some(15));
    cmd("/setblock 23 -59 111 glowstone");cmd("/setblock 15 -59 111 air");
    assert!(wait_until(6,||sample([16,-59,111]).block==Some(8)),"surviving overlapping source");
    cmd("/setblock 23 -59 111 air");assert!(wait_until(6,||sample([16,-59,111]).block==Some(0)),"removed sources must settle to zero");
    cmd("/setblock -1 -59 111 glowstone");assert!(wait_until(6,||sample([0,-59,111]).block==Some(14)),"negative coordinate boundary");cmd("/setblock -1 -59 111 air");
    cmd("/setblock 15 -59 111 torch");assert!(wait_until(6,||sample([16,-59,111]).block==Some(13)),"torch emission is 14");
    assert_eq!(sample([15,-59,111]).block,Some(14));
    cmd("/setblock 15 -59 111 air");assert!(wait_until(6,||sample([16,-59,111]).block==Some(0)),"removing torch clears its light");
    cmd("/fill 12 -59 108 20 -53 116 stone hollow");cmd("/setblock 16 -58 112 torch");
    assert!(wait_until(6,||sample([16,-58,112]).block==Some(14)),"torch lights sealed room");
    assert_eq!(sample([16,-58,117]).block,Some(0),"solid walls contain torch light");
    cmd("/setblock 16 -58 112 air");assert!(wait_until(6,||sample([16,-58,112]).block==Some(0)),"sealed room returns to dark");
    // A roof blocks direct sky; removal restores the whole column. Four walls isolate side paths.
    cmd("/fill 12 -59 108 20 -40 116 stone hollow");cmd("/fill 13 -40 109 19 -40 115 air");
    assert!(wait_until(6,||sample([16,-58,112]).sky==Some(15)),"open shaft keeps full downward sky");
    cmd("/fill 12 -40 108 20 -40 116 stone");assert!(wait_until(6,||sample([16,-58,112]).sky==Some(0)),"roof removal propagation across sections");
    cmd("/fill 13 -40 109 19 -40 115 air");assert!(wait_until(6,||sample([16,-58,112]).sky==Some(15)),"sky returns after roof opens");
    let sky=sample([16,-58,112]).sky;cmd("/time set midnight");
    assert!(wait_until(6,||{let s=scene.lock().unwrap();(s.environment.time(Instant::now())-18000.).abs()<10.}));assert_eq!(sample([16,-58,112]).sky,sky,"time cannot rewrite raw skylight");
    cmd("/time set noon");cmd("/weather clear");
    // Rejoining obtains vanilla's independently calculated complete light arrays.
    // Compare them with our incremental result, including partial/transparent states.
    cmd("/fill 13 -58 109 19 -41 115 air");
    cmd("/setblock 16 -58 112 torch");
    for (x,block) in [(13,"glass"),(14,"oak_leaves[persistent=true]"),(15,"water"),(17,"oak_slab[type=bottom]"),(18,"oak_stairs[facing=west,half=bottom,shape=straight]")] {
        cmd(&format!("/setblock {x} -57 112 {block}"));
    }
    cmd("/setblock 16 -58 112 glowstone"); // Keep an emitter alive even after water spreads.
    thread::sleep(Duration::from_secs(3));
    let mut incremental=Vec::new();
    for y in -59..=-40 {for z in 108..=116 {for x in 12..=20 {let p=[x,y,z];let l=sample(p);if l.complete(){incremental.push((p,l));}}}}
    assert!(incremental.len()>1500,"fixture must have complete light snapshots");
    drop(_guard);
    let second=Arc::new(Mutex::new(SceneSnapshot::default()));let i=Arc::new(Mutex::new(InputState::default()));let stop=Arc::new(AtomicBool::new(false));let (s,t)=(second.clone(),stop.clone());
    let worker=thread::spawn(move||network::run(ConnectionConfig{address:"127.0.0.1:25579".into(),username:"sakurainventory".into(),session:None,render_distance:4},i,s,t));
    let _second_guard=ConnectionGuard{stop,worker:Some(worker)};
    assert!(wait_until(15,||{let s=second.lock().unwrap();s.connected&&s.sections.contains_key(&[1,-3,7])&&s.sections.contains_key(&[0,-4,6])}));
    let s=second.lock().unwrap();
    for (p,expected) in incremental {let key=p.map(|v|v.div_euclid(16));let section=s.sections.get(&key).expect("reference section");let [x,y,z]=p.map(|v|v.rem_euclid(16) as usize+1);let n=x+18*(z+18*y);let known=section.light_known[n];let actual=LightSample{block:(known&1!=0).then_some(section.light[n]&15),sky:(known&2!=0).then_some(section.light[n]>>4)};assert_eq!(expected,actual,"incremental differs from vanilla at {p:?}");}
    println!("lighting_acceptance: torches=true torch_removal=true sealed_walls=true source_range=true decreases=true overlap=true negative_boundary=true vertical_roof=true time_separate=true vanilla_rejoin_oracle=true");
}
