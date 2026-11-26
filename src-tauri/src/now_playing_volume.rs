use std::{collections::HashMap, path::PathBuf, ptr};
use windows::{
    core::{Interface, PWSTR},
    Win32::{
        Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, S_FALSE},
        Media::Audio::{
            eMultimedia, eRender, AudioSessionStateActive, AudioSessionStateExpired,
            Endpoints::IAudioEndpointVolume, IAudioSessionControl2, IAudioSessionManager2,
            IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
        },
        Storage::Packaging::Appx::GetApplicationUserModelId,
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
                COINIT_MULTITHREADED,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
    },
};

use crate::{
    now_playing::{AppVolume, VolumeChange, VolumeScope},
    now_playing_app_icon::registered_desktop_executable,
};

struct Apartment;

impl Apartment {
    fn open() -> Option<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()?;
        }
        Some(Self)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

struct Process(HANDLE);

impl Drop for Process {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

struct ProcessIdentity {
    app_id: Option<String>,
    image: Option<String>,
}

impl ProcessIdentity {
    fn query(pid: u32) -> Option<Self> {
        let process =
            Process(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?);
        let mut app_id = [0u16; 512];
        let mut size = app_id.len() as u32;
        let result = unsafe {
            GetApplicationUserModelId(process.0, &mut size, Some(PWSTR(app_id.as_mut_ptr())))
        };
        let app_id = (result == ERROR_SUCCESS && size > 1 && size as usize <= app_id.len())
            .then(|| String::from_utf16_lossy(&app_id[..size as usize - 1]));
        let mut image = vec![0u16; 32_768];
        let mut size = image.len() as u32;
        let image = unsafe {
            QueryFullProcessImageNameW(
                process.0,
                PROCESS_NAME_WIN32,
                PWSTR(image.as_mut_ptr()),
                &mut size,
            )
        }
        .ok()
        .map(|()| normalize_path(&String::from_utf16_lossy(&image[..size as usize])));
        Some(Self { app_id, image })
    }
}

fn normalize_path(value: &str) -> String {
    value
        .trim()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_lowercase()
}

// Unpackaged Chrome/Spotify and other common players can use a short, explicit
// desktop identity instead of a package ID. Restrict these aliases to their
// normal installation paths, and reject another install of the same player.
fn desktop_install_paths(app_id: &str) -> Vec<String> {
    let id = app_id.to_ascii_lowercase();
    let path = match id.as_str() {
        "chrome" | "chrome.exe" => r"Google\Chrome\Application\chrome.exe",
        "chromebeta" => r"Google\Chrome Beta\Application\chrome.exe",
        "chromedev" => r"Google\Chrome Dev\Application\chrome.exe",
        "chromecanary" => r"Google\Chrome SxS\Application\chrome.exe",
        "msedge" | "msedge.exe" => r"Microsoft\Edge\Application\msedge.exe",
        "msedgebeta" => r"Microsoft\Edge Beta\Application\msedge.exe",
        "msedgedev" => r"Microsoft\Edge Dev\Application\msedge.exe",
        "msedgecanary" => r"Microsoft\Edge SxS\Application\msedge.exe",
        "firefox" | "firefox.exe" => r"Mozilla Firefox\firefox.exe",
        "brave" | "brave.exe" => r"BraveSoftware\Brave-Browser\Application\brave.exe",
        "vivaldi" | "vivaldi.exe" => r"Vivaldi\Application\vivaldi.exe",
        "spotify" | "spotify.exe" => r"Spotify\Spotify.exe",
        _ if id.starts_with("chrome.") => r"Google\Chrome\Application\chrome.exe",
        _ if id.starts_with("msedge.") => r"Microsoft\Edge\Application\msedge.exe",
        _ if id.starts_with("mozilla.firefox.") => r"Mozilla Firefox\firefox.exe",
        _ if id.starts_with("brave.") => r"BraveSoftware\Brave-Browser\Application\brave.exe",
        _ => return Vec::new(),
    };
    [
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "LOCALAPPDATA",
        "APPDATA",
    ]
    .into_iter()
    .filter_map(std::env::var_os)
    .map(PathBuf::from)
    .map(|directory| normalize_path(&directory.join(path).to_string_lossy()))
    .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MatchKind<'a> {
    AppId,
    Image(&'a str),
}

fn match_process<'a>(
    app_id: &str,
    desktop_paths: &[String],
    process: &'a ProcessIdentity,
) -> Option<MatchKind<'a>> {
    if let Some(process_app_id) = &process.app_id {
        return process_app_id
            .eq_ignore_ascii_case(app_id)
            .then_some(MatchKind::AppId);
    }
    let image = process.image.as_deref()?;
    if desktop_paths.iter().any(|path| path == image) {
        return Some(MatchKind::Image(image));
    }
    // Some desktop sessions publish the executable's full DOS path as their ID.
    let source_path = normalize_path(app_id);
    (source_path.as_bytes().get(1..3) == Some(b":\\") && source_path == image)
        .then_some(MatchKind::Image(image))
}

struct Session {
    control: ISimpleAudioVolume,
    active: bool,
}

// Keep COM interfaces and apartment initialization on the same blocking thread.
pub(crate) struct AppMixerSessions {
    sessions: Vec<Session>,
    _apartment: Apartment,
}

impl AppMixerSessions {
    pub(crate) fn find(app_id: &str) -> Option<Self> {
        // Desktop browsers can advertise an opaque, install-specific app ID
        // while the audio process is identified by its executable.
        let desktop_paths = match registered_desktop_executable(app_id) {
            Some(path) => vec![normalize_path(&path.to_string_lossy())],
            None => desktop_install_paths(app_id),
        };
        let apartment = Apartment::open()?;
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()?;
        let devices =
            unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) }.ok()?;
        let device_count = unsafe { devices.GetCount() }.ok()?;
        let mut processes = HashMap::new();
        let mut exact = Vec::new();
        let mut desktop: HashMap<String, Vec<Session>> = HashMap::new();
        for index in 0..device_count {
            let Ok(device) = (unsafe { devices.Item(index) }) else {
                continue;
            };
            let Ok(manager) =
                (unsafe { device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) })
            else {
                continue;
            };
            let Ok(sessions) = (unsafe { manager.GetSessionEnumerator() }) else {
                continue;
            };
            let Ok(count) = (unsafe { sessions.GetCount() }) else {
                continue;
            };
            for index in 0..count {
                let Ok(control) = (unsafe { sessions.GetSession(index) }) else {
                    continue;
                };
                let Ok(status) = (unsafe { control.GetState() }) else {
                    continue;
                };
                if status == AudioSessionStateExpired {
                    continue;
                }
                let Ok(details) = control.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                if unsafe { details.IsSystemSoundsSession() } != S_FALSE {
                    continue;
                }
                let Ok(pid) = (unsafe { details.GetProcessId() }) else {
                    continue;
                };
                let Some(process) = processes
                    .entry(pid)
                    .or_insert_with(|| ProcessIdentity::query(pid))
                else {
                    continue;
                };
                let Some(identity) = match_process(app_id, &desktop_paths, process) else {
                    continue;
                };
                let Ok(volume) = control.cast::<ISimpleAudioVolume>() else {
                    continue;
                };
                let session = Session {
                    control: volume,
                    active: status == AudioSessionStateActive,
                };
                match identity {
                    MatchKind::AppId => exact.push(session),
                    MatchKind::Image(path) => {
                        desktop.entry(path.to_owned()).or_default().push(session)
                    }
                }
            }
        }
        let sessions = if !exact.is_empty() {
            exact
        } else if desktop.len() == 1 {
            desktop.into_values().next()?
        } else {
            return None;
        };
        Some(Self {
            sessions,
            _apartment: apartment,
        })
    }

    pub(crate) fn apply(&self, change: Option<&VolumeChange>) -> Option<AppVolume> {
        let current = self.read()?;
        let Some(level) = change.and_then(|change| change.level_for(&current)) else {
            return Some(current);
        };

        let previous: Vec<_> = self
            .sessions
            .iter()
            .map(|session| read_volume(&session.control).map(|volume| volume.level))
            .collect::<Option<_>>()?;
        for (index, session) in self.sessions.iter().enumerate() {
            if unsafe { session.control.SetMasterVolume(level, ptr::null()) }.is_err() {
                // Keep the application group consistent if an audio device vanishes mid-write.
                for (session, value) in self.sessions[..index].iter().zip(&previous) {
                    let _ = unsafe { session.control.SetMasterVolume(*value, ptr::null()) };
                }
                return None;
            }
        }
        self.read()
    }

    fn read(&self) -> Option<AppVolume> {
        let has_active = self.sessions.iter().any(|session| session.active);
        let mut sessions = self
            .sessions
            .iter()
            .filter(|session| !has_active || session.active);
        let first = read_volume(&sessions.next()?.control)?;
        for session in sessions {
            let value = read_volume(&session.control)?;
            if (value.level - first.level).abs() > 0.005 || value.muted != first.muted {
                return None;
            }
        }
        Some(first)
    }
}

fn read_volume(control: &ISimpleAudioVolume) -> Option<AppVolume> {
    let level = unsafe { control.GetMasterVolume() }.ok()?;
    let muted = unsafe { control.GetMute() }.ok()?.as_bool();
    (0.0..=1.0).contains(&level).then_some(AppVolume {
        level,
        muted,
        scope: VolumeScope::App,
        target_id: None,
    })
}

pub(crate) fn read_or_set_volume(
    mixer: Option<&AppMixerSessions>,
    change: Option<&VolumeChange>,
) -> Option<AppVolume> {
    match mixer {
        Some(mixer) => mixer.apply(change),
        None => default_output_volume(change),
    }
}

fn default_output_volume(change: Option<&VolumeChange>) -> Option<AppVolume> {
    let _apartment = Apartment::open()?;
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()?;
    let endpoint = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }.ok()?;
    let id = unsafe { endpoint.GetId() }.ok()?;
    let target_id = unsafe { id.to_string() };
    unsafe { CoTaskMemFree(Some(id.0.cast())) };
    let control: IAudioEndpointVolume = unsafe { endpoint.Activate(CLSCTX_ALL, None) }.ok()?;
    let mut volume = AppVolume {
        level: unsafe { control.GetMasterVolumeLevelScalar() }.ok()?,
        muted: unsafe { control.GetMute() }.ok()?.as_bool(),
        scope: VolumeScope::System,
        target_id: Some(target_id.ok()?),
    };
    if let Some(level) = change.and_then(|change| change.level_for(&volume)) {
        let _ = unsafe { control.SetMasterVolumeLevelScalar(level, ptr::null()) };
        volume.level = unsafe { control.GetMasterVolumeLevelScalar() }.ok()?;
    }
    (0.0..=1.0).contains(&volume.level).then_some(volume)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_package_matches_the_exact_app_identity() {
        let process = ProcessIdentity {
            app_id: Some("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify".into()),
            image: Some(r"c:\windowsapps\spotify.exe".into()),
        };
        assert_eq!(
            match_process(
                "spotifyab.spotifymusic_zpdnekdrzrea0!spotify",
                &[],
                &process
            ),
            Some(MatchKind::AppId),
        );
        assert_eq!(match_process("spotify.exe", &[], &process), None);
    }

    #[test]
    #[ignore = "requires packaged Spotify with a live mixer session"]
    fn reads_spotifys_packaged_mixer_without_changing_it() {
        let mixer = AppMixerSessions::find("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify")
            .expect("a matching Spotify mixer session");
        let volume = mixer.apply(None).expect("Spotify mixer volume");
        assert_eq!(volume.scope, VolumeScope::App);
        assert!(volume.target_id.is_none());
    }

    #[test]
    fn a_desktop_alias_requires_the_specific_install_image() {
        let process = ProcessIdentity {
            app_id: None,
            image: Some(r"c:\arbitrary\chrome.exe".into()),
        };
        assert_eq!(
            match_process("Chrome", &[r"c:\google\chrome.exe".into()], &process),
            None
        );
        let zen_path = r"c:\program files\zen browser\zen.exe";
        let zen = ProcessIdentity { app_id: None, image: Some(zen_path.into()) };
        assert_eq!(
            match_process("F0DC299D809B9700", &[zen_path.into()], &zen),
            Some(MatchKind::Image(zen_path)),
        );
        assert_eq!(match_process("F0DC299D809B9700", &[], &zen), None);
        assert_eq!(
            match_process(r"C:\ARBITRARY\chrome.exe", &[], &process),
            Some(MatchKind::Image(r"c:\arbitrary\chrome.exe")),
        );
    }
}
