use super::{atomic_record, read_optional};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

const RUNNING: &str = "Close Minecraft before updating or launching this followed instance.";

pub(crate) struct FollowGame {
    _operation: File,
    marker: PathBuf,
    input: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct ChildMarker {
    nonce: uuid::Uuid,
    executable: String,
    pid: Option<u32>,
    started: Option<u64>,
}

impl ChildMarker {
    fn argument(&self) -> String {
        format!("-Ddelight.follow.launch={}", self.nonce)
    }
}

pub(crate) struct LaunchIdentity<'a> {
    owner: &'a FollowGame,
    marker: ChildMarker,
}

fn child_input(path: &Path) -> Result<File, String> {
    match File::create_new(path) {
        Ok(file) => drop(file),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => return Err(RUNNING.into()),
        Err(error) => return Err(error.to_string()),
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // The duplicated stdin handle in Java holds the same file-sharing reservation.
        options.share_mode(0);
    }
    let file = options.open(path).map_err(|_| RUNNING.to_owned())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != 0
        || fs::symlink_metadata(path).is_ok_and(|m| crate::instance_actions::linked(&m))
    {
        return Err("The followed instance's process guard is damaged.".into());
    }
    #[cfg(unix)]
    {
        // flock belongs to the open file description, including the child's dup'd stdin.
        file.try_lock().map_err(|_| RUNNING.to_owned())?;
    }
    Ok(file)
}

fn java_name(value: &OsStr) -> bool {
    ["java", "java.exe", "javaw.exe"]
        .iter()
        .any(|name| value.eq_ignore_ascii_case(name))
}

// Read arguments only for plausible children of this persisted launch. They may contain
// account credentials, so no argument list is logged, persisted, or returned to the UI.
fn surviving_child(marker: &ChildMarker) -> Result<bool, String> {
    let mut system = System::new();
    let self_pid = Pid::from_u32(std::process::id());
    let candidates = [self_pid, Pid::from_u32(marker.pid.unwrap_or_default())];
    let scope = if candidates[0] == candidates[1] {
        ProcessesToUpdate::Some(&candidates[..1])
    } else if marker.pid.is_some() {
        ProcessesToUpdate::Some(&candidates)
    } else {
        ProcessesToUpdate::All
    };
    system.refresh_processes_specifics(scope, true, ProcessRefreshKind::nothing());
    if system.process(self_pid).is_none() {
        return Err("Could not check whether Minecraft is still running.".into());
    }
    let mut pids = Vec::new();
    for process in system.processes().values() {
        if marker.pid.is_some_and(|pid| pid != process.pid().as_u32())
            || matches!(
                process.status(),
                ProcessStatus::Zombie | ProcessStatus::Dead
            )
            || marker
                .started
                .is_some_and(|start| process.start_time() != 0 && start != process.start_time())
        {
            continue;
        }
        let name = process.name().to_string_lossy();
        // Linux's process name can be shortened to 15 bytes.
        if java_name(process.name())
            || process.name().eq_ignore_ascii_case(&marker.executable)
            || (cfg!(target_os = "linux")
                && name.len() == 15
                && marker.executable.starts_with(name.as_ref()))
        {
            pids.push(process.pid());
        }
    }
    if pids.is_empty() {
        return Ok(false);
    }
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    let argument = marker.argument();
    for pid in pids {
        if let Some(process) = system.process(pid) {
            if process
                .cmd()
                .iter()
                .any(|part| part == OsStr::new(&argument))
            {
                return Ok(true);
            }
            if process.cmd().is_empty() {
                return Err(
                    "Could not verify that the previous Minecraft process has closed.".into(),
                );
            }
        }
    }
    Ok(false)
}

impl FollowGame {
    pub(super) fn acquire(lock: File, folder: PathBuf, id: &str) -> Result<Self, String> {
        let lease = Self {
            _operation: lock,
            marker: folder.join(format!("{id}.child.json")),
            input: folder.join(format!("{id}.stdin")),
        };
        let prior: Option<ChildMarker> = read_optional(&lease.marker)?;
        // A surviving child's inherited handle catches even a launcher crash during spawn.
        let _probe = child_input(&lease.input)?;
        if let Some(prior) = prior {
            if surviving_child(&prior)? {
                return Err(RUNNING.into());
            }
            fs::remove_file(&lease.marker).map_err(|e| e.to_string())?;
        }
        Ok(lease)
    }

    pub(crate) fn prepare(&self, command: &Command) -> Result<LaunchIdentity<'_>, String> {
        let marker = ChildMarker {
            nonce: uuid::Uuid::new_v4(),
            executable: Path::new(command.get_program())
                .file_name()
                .ok_or("Could not identify the Java executable.")?
                .to_string_lossy()
                .into_owned(),
            pid: None,
            started: None,
        };
        // Write first. A crash between spawn and recording the PID can still find the exact child.
        atomic_record(&self.marker, &marker)?;
        Ok(LaunchIdentity {
            owner: self,
            marker,
        })
    }
}

impl LaunchIdentity<'_> {
    pub(crate) fn argument(&self) -> String {
        self.marker.argument()
    }
    pub(crate) fn stdin(&self) -> Result<Stdio, String> {
        child_input(&self.owner.input).map(Stdio::from)
    }
    pub(crate) fn record_child(&self, pid: u32) -> Result<(), String> {
        let mut system = System::new();
        let process_id = Pid::from_u32(pid);
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[process_id]),
            true,
            ProcessRefreshKind::nothing(),
        );
        let started = system
            .process(process_id)
            .map(|p| p.start_time())
            .filter(|time| *time > 0);
        atomic_record(
            &self.owner.marker,
            &ChildMarker {
                nonce: self.marker.nonce,
                executable: self.marker.executable.clone(),
                pid: Some(pid),
                started,
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::Child,
        time::{Duration, Instant},
    };

    const HELPER: &str =
        "workspace_install::updates::follow_game_process::tests::java_child_fixture";
    const CHILD_ENV: &str = "DELIGHT_TEST_FOLLOW_CHILD_READY";

    #[test]
    fn java_child_fixture() {
        if let Some(ready) = std::env::var_os(CHILD_ENV) {
            fs::write(ready, b"ready").unwrap();
            std::thread::sleep(Duration::from_secs(30));
        }
    }

    struct Running(Child);
    impl Drop for Running {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn child_survives_launcher_exit_with_pre_spawn_or_pid_marker_and_reused_pid_is_safe() {
        let folder = std::env::temp_dir().join(format!("follow-process-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&folder).unwrap();
        let _cleanup = super::super::Pending(folder.clone());
        let lock = folder.join("operation");
        File::create_new(&lock).unwrap();
        let acquire = || FollowGame::acquire(File::open(&lock).unwrap(), folder.clone(), "sample");
        for (inherited, recorded) in [(true, false), (false, false), (false, true)] {
            let lease = acquire().unwrap();
            let mut command = Command::new(std::env::current_exe().unwrap());
            let identity = lease.prepare(&command).unwrap();
            let ready = folder.join(format!("ready-{inherited}-{recorded}"));
            command
                .args(["--exact", HELPER, "--skip", &identity.argument()])
                .env(CHILD_ENV, &ready)
                .stdin(if inherited {
                    identity.stdin().unwrap()
                } else {
                    Stdio::null()
                })
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let mut child = Running(command.spawn().unwrap());
            if recorded {
                identity.record_child(child.0.id()).unwrap();
            }
            drop(command);
            drop(identity);
            drop(lease);
            let start = Instant::now();
            while !ready.exists() {
                assert!(
                    child.0.try_wait().unwrap().is_none()
                        && start.elapsed() < Duration::from_secs(10)
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            // The only surviving handle belongs to the child. The latter two cases
            // simulate a JVM that closed stdin, on either side of persisting its PID.
            if inherited {
                assert!(child_input(&folder.join("sample.stdin")).is_err());
            }
            let blocked = acquire()
                .err()
                .expect("A surviving child must keep its instance busy");
            if !inherited {
                assert_eq!(blocked, RUNNING);
            }
            drop(child);
            assert!(acquire().is_ok());
        }
        let lease = acquire().unwrap();
        let identity = lease
            .prepare(&Command::new(std::env::current_exe().unwrap()))
            .unwrap();
        // Force a matching PID, executable and start time, but a different launch token.
        identity.record_child(std::process::id()).unwrap();
        drop(identity);
        drop(lease);
        acquire()
            .unwrap_or_else(|error| panic!("A reused PID blocked the next operation: {error}"));
    }
}
