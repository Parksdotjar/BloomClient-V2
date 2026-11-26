use serde::Deserialize;
use tauri::AppHandle;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MediaAction {
    Play,
    Pause,
    Previous,
    Next,
}

#[cfg(windows)]
pub(crate) use platform::NowPlayingState;

#[cfg(not(windows))]
#[derive(Default)]
pub(crate) struct NowPlayingState;

#[tauri::command]
pub(crate) fn start_now_playing(app: AppHandle, observation_id: String) {
    #[cfg(windows)]
    platform::start(app, observation_id);
    #[cfg(not(windows))]
    let _ = (app, observation_id);
}

#[tauri::command]
pub(crate) fn stop_now_playing(app: AppHandle, observation_id: String) {
    #[cfg(windows)]
    platform::stop(&app, &observation_id);
    #[cfg(not(windows))]
    let _ = (app, observation_id);
}

#[tauri::command]
pub(crate) async fn control_now_playing(
    app: AppHandle,
    observation_id: String,
    session_id: String,
    action: MediaAction,
) -> bool {
    #[cfg(windows)]
    return platform::control(&app, &observation_id, session_id, action).await;
    #[cfg(not(windows))]
    {
        let _ = (app, observation_id, session_id, action);
        false
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum VolumeScope {
    App,
    System,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppVolume {
    pub(crate) level: f32,
    pub(crate) muted: bool,
    pub(crate) scope: VolumeScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) target_id: Option<String>,
}

#[cfg(windows)]
pub(crate) struct VolumeChange {
    level: f32,
    scope: VolumeScope,
    target_id: Option<String>,
}

#[cfg(windows)]
impl VolumeChange {
    pub(crate) fn level_for(&self, volume: &AppVolume) -> Option<f32> {
        (self.scope == volume.scope && self.target_id == volume.target_id).then_some(self.level)
    }
}

#[tauri::command]
pub(crate) async fn get_now_playing_volume(
    app: AppHandle,
    observation_id: String,
    session_id: String,
) -> Option<AppVolume> {
    #[cfg(windows)]
    return platform::volume(&app, &observation_id, session_id, None).await;
    #[cfg(not(windows))]
    {
        let _ = (app, observation_id, session_id);
        None
    }
}

#[tauri::command]
pub(crate) async fn set_now_playing_volume(
    app: AppHandle,
    observation_id: String,
    session_id: String,
    level: f32,
    scope: VolumeScope,
    target_id: Option<String>,
) -> Option<AppVolume> {
    if !(0.0..=1.0).contains(&level) {
        return None;
    }
    #[cfg(windows)]
    return platform::volume(
        &app,
        &observation_id,
        session_id,
        Some(VolumeChange {
            level,
            scope,
            target_id,
        }),
    )
    .await;
    #[cfg(not(windows))]
    {
        let _ = (app, observation_id, session_id, scope, target_id);
        None
    }
}

#[cfg(windows)]
mod platform {
    use super::{AppVolume, MediaAction, VolumeChange};
    use crate::{
        now_playing_app_icon::read_app_icon,
        now_playing_volume::{read_or_set_volume, AppMixerSessions},
    };
    use serde::Serialize;
    use std::{
        sync::{Arc, Mutex, OnceLock},
        time::Duration,
    };
    use tauri::{async_runtime, AppHandle, Emitter, Manager};
    use tokio::{
        sync::{mpsc, oneshot},
        time::timeout,
    };
    use uuid::Uuid;
    use windows::{
        ApplicationModel::AppInfo,
        Foundation::TypedEventHandler,
        Media::Control::{
            GlobalSystemMediaTransportControlsSession as Session,
            GlobalSystemMediaTransportControlsSessionManager as SessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackInfo as PlaybackInfo,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
        },
    };

    const EVENT_NAME: &str = "desktop-now-playing";
    const SYSTEM_TIMEOUT: Duration = Duration::from_secs(3);
    #[derive(Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SessionSnapshot {
        session_id: String,
        title: String,
        artist: String,
        source: String,
        is_playing: bool,
        can_play: bool,
        can_pause: bool,
        can_previous: bool,
        can_next: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        app_icon: Option<String>,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ObservationSnapshot<'a> {
        observation_id: &'a str,
        session: Option<SessionSnapshot>,
    }

    enum Message {
        Refresh,
        Volume {
            session_id: String,
            change: Option<VolumeChange>,
            result: oneshot::Sender<Option<AppVolume>>,
        },
        Control {
            session_id: String,
            action: MediaAction,
            result: oneshot::Sender<bool>,
        },
    }

    struct Observer {
        id: String,
        commands: mpsc::Sender<Message>,
        task: async_runtime::JoinHandle<()>,
    }

    impl Drop for Observer {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    #[derive(Default)]
    pub(crate) struct NowPlayingState(Mutex<Option<Observer>>);

    pub(super) fn start(app: AppHandle, observation_id: String) {
        if observation_id.is_empty() || observation_id.len() > 100 {
            return;
        }
        let state = app.state::<NowPlayingState>();
        let Ok(mut active) = state.0.lock() else {
            return;
        };
        if matches!(&*active, Some(observer) if observer.id == observation_id) {
            return;
        }
        let (commands, events) = mpsc::channel(16);
        let task = async_runtime::spawn(observe(
            app.clone(),
            observation_id.clone(),
            commands.clone(),
            events,
        ));
        *active = Some(Observer {
            id: observation_id,
            commands,
            task,
        });
    }

    pub(super) fn stop(app: &AppHandle, observation_id: &str) {
        let state = app.state::<NowPlayingState>();
        if let Ok(mut active) = state.0.lock() {
            if matches!(&*active, Some(observer) if observer.id == observation_id) {
                *active = None;
            }
        };
    }

    pub(super) async fn control(
        app: &AppHandle,
        observation_id: &str,
        session_id: String,
        action: MediaAction,
    ) -> bool {
        let (result, reply) = oneshot::channel();
        {
            let state = app.state::<NowPlayingState>();
            let Ok(active) = state.0.lock() else {
                return false;
            };
            let Some(observer) = active.as_ref().filter(|item| item.id == observation_id) else {
                return false;
            };
            if observer
                .commands
                .try_send(Message::Control {
                    session_id,
                    action,
                    result,
                })
                .is_err()
            {
                return false;
            }
        }
        reply.await.unwrap_or(false)
    }

    pub(super) async fn volume(
        app: &AppHandle,
        observation_id: &str,
        session_id: String,
        change: Option<VolumeChange>,
    ) -> Option<AppVolume> {
        let (result, reply) = oneshot::channel();
        {
            let state = app.state::<NowPlayingState>();
            let active = state.0.lock().ok()?;
            let observer = active.as_ref().filter(|item| item.id == observation_id)?;
            observer
                .commands
                .try_send(Message::Volume {
                    session_id,
                    change,
                    result,
                })
                .ok()?;
        }
        reply.await.ok().flatten()
    }

    struct ManagerEvents {
        manager: SessionManager,
        current_changed: Option<i64>,
        sessions_changed: Option<i64>,
    }

    impl ManagerEvents {
        fn new(manager: SessionManager, messages: &mpsc::Sender<Message>) -> Self {
            let sender = messages.clone();
            let current_changed = manager
                .CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
                    let _ = sender.try_send(Message::Refresh);
                    Ok(())
                }))
                .ok();
            let sender = messages.clone();
            let sessions_changed = manager
                .SessionsChanged(&TypedEventHandler::new(move |_, _| {
                    let _ = sender.try_send(Message::Refresh);
                    Ok(())
                }))
                .ok();
            Self {
                manager,
                current_changed,
                sessions_changed,
            }
        }
    }

    impl Drop for ManagerEvents {
        fn drop(&mut self) {
            if let Some(token) = self.current_changed {
                let _ = self.manager.RemoveCurrentSessionChanged(token);
            }
            if let Some(token) = self.sessions_changed {
                let _ = self.manager.RemoveSessionsChanged(token);
            }
        }
    }

    struct ObservedSession {
        session: Session,
        id: String,
        source: String,
        playback_changed: Option<i64>,
        media_changed: Option<i64>,
        source_app_id: Option<String>,
        icon: Arc<OnceLock<Option<String>>>,
        icon_task: OnceLock<async_runtime::JoinHandle<()>>,
    }

    impl ObservedSession {
        fn new(session: Session, messages: &mpsc::Sender<Message>) -> Self {
            let sender = messages.clone();
            let playback_changed = session
                .PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
                    let _ = sender.try_send(Message::Refresh);
                    Ok(())
                }))
                .ok();
            let sender = messages.clone();
            let media_changed = session
                .MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
                    let _ = sender.try_send(Message::Refresh);
                    Ok(())
                }))
                .ok();
            let source_app_id = session.SourceAppUserModelId().ok();
            let source = source_app_id
                .as_ref()
                .and_then(|id| {
                    AppInfo::GetFromAppUserModelId(id)
                        .and_then(|app| app.DisplayInfo())
                        .and_then(|info| info.DisplayName())
                        .ok()
                        .and_then(|name| clean_label(&name.to_string()))
                        .or_else(|| source_label(&id.to_string()))
                })
                .unwrap_or_else(|| "Windows media".to_owned());
            Self {
                session,
                id: Uuid::new_v4().to_string(),
                source,
                playback_changed,
                media_changed,
                source_app_id: source_app_id
                    .map(|id| id.to_string())
                    .filter(|id| !id.is_empty()),
                icon: Arc::new(OnceLock::new()),
                icon_task: OnceLock::new(),
            }
        }

        fn load_icon(&self, messages: &mpsc::Sender<Message>) {
            let Some(app_id) = self.source_app_id.clone() else {
                return;
            };
            self.icon_task.get_or_init(|| {
                let icon = self.icon.clone();
                let messages = messages.clone();
                async_runtime::spawn(async move {
                    let image = timeout(SYSTEM_TIMEOUT, read_app_icon(&app_id))
                        .await
                        .ok()
                        .flatten();
                    let _ = icon.set(image);
                    let _ = messages.send(Message::Refresh).await;
                })
            });
        }

        async fn snapshot(&self) -> Option<SessionSnapshot> {
            let media = match self.session.TryGetMediaPropertiesAsync() {
                Ok(operation) => timeout(SYSTEM_TIMEOUT, async { operation.await })
                    .await
                    .ok()
                    .and_then(Result::ok),
                Err(_) => None,
            };
            let title = media
                .as_ref()
                .and_then(|properties| properties.Title().ok())
                .and_then(|title| clean_label(&title.to_string()))
                .unwrap_or_else(|| self.source.clone());
            let artist = media
                .as_ref()
                .and_then(|properties| properties.Artist().ok())
                .and_then(|artist| clean_label(&artist.to_string()))
                .unwrap_or_default();
            let playback = self.session.GetPlaybackInfo().ok()?;
            let status = playback.PlaybackStatus().ok()?;
            if !matches!(status, PlaybackStatus::Playing | PlaybackStatus::Paused) {
                return None;
            }
            let controls = playback.Controls().ok();
            Some(SessionSnapshot {
                session_id: self.id.clone(),
                title,
                artist,
                source: self.source.clone(),
                is_playing: status == PlaybackStatus::Playing,
                can_play: controls
                    .as_ref()
                    .is_some_and(|c| c.IsPlayEnabled().unwrap_or(false)),
                can_pause: controls
                    .as_ref()
                    .is_some_and(|c| c.IsPauseEnabled().unwrap_or(false)),
                can_previous: controls
                    .as_ref()
                    .is_some_and(|c| c.IsPreviousEnabled().unwrap_or(false)),
                can_next: controls
                    .as_ref()
                    .is_some_and(|c| c.IsNextEnabled().unwrap_or(false)),
                app_icon: self.icon.get().cloned().flatten(),
            })
        }
    }

    impl Drop for ObservedSession {
        fn drop(&mut self) {
            if let Some(token) = self.playback_changed {
                let _ = self.session.RemovePlaybackInfoChanged(token);
            }
            if let Some(token) = self.media_changed {
                let _ = self.session.RemoveMediaPropertiesChanged(token);
            }
            if let Some(task) = self.icon_task.get() {
                task.abort();
            }
        }
    }

    fn clean_label(value: &str) -> Option<String> {
        let clean: String = value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .filter(|c| !c.is_control())
            .take(160)
            .collect();
        (!clean.is_empty()).then_some(clean)
    }

    fn source_label(app_id: &str) -> Option<String> {
        let name = app_id.rsplit(['/', '\\', '!']).next()?;
        let name = name
            .strip_suffix(".exe")
            .or_else(|| name.strip_suffix(".EXE"))
            .unwrap_or(name);
        clean_label(name)
    }

    async fn get_manager() -> Option<SessionManager> {
        let operation = SessionManager::RequestAsync().ok()?;
        timeout(SYSTEM_TIMEOUT, async { operation.await })
            .await
            .ok()?
            .ok()
    }

    fn emit_snapshot(app: &AppHandle, observation_id: &str, session: Option<SessionSnapshot>) {
        let state = app.state::<NowPlayingState>();
        if let Ok(active) = state.0.lock() {
            if matches!(&*active, Some(observer) if observer.id == observation_id) {
                let _ = app.emit(
                    EVENT_NAME,
                    ObservationSnapshot {
                        observation_id,
                        session,
                    },
                );
            }
        };
    }

    fn refresh_sessions(
        manager: &SessionManager,
        sessions: &mut Vec<ObservedSession>,
        messages: &mpsc::Sender<Message>,
    ) {
        let Ok(system_sessions) = manager.GetSessions() else {
            sessions.clear();
            return;
        };
        let system_sessions: Vec<_> = system_sessions.into_iter().collect();
        sessions.retain(|observed| system_sessions.contains(&observed.session));
        for session in system_sessions {
            if !sessions.iter().any(|observed| observed.session == session) {
                sessions.push(ObservedSession::new(session, messages));
            }
        }
    }

    fn playback_status(session: &Session) -> Option<PlaybackStatus> {
        session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()
    }

    fn current_session_index<'a>(
        current: &Session,
        sessions: impl Iterator<Item = &'a Session> + Clone,
    ) -> Option<usize> {
        if let Some(index) = sessions.clone().position(|session| session == current) {
            return Some(index);
        }

        // Windows can return a distinct COM wrapper for the current session.
        // Only use the app ID when it identifies exactly one listed session.
        let source = current.SourceAppUserModelId().ok()?.to_string();
        if source.is_empty() {
            return None;
        }
        let mut matching = sessions.enumerate().filter_map(|(index, session)| {
            session
                .SourceAppUserModelId()
                .ok()
                .filter(|id| id.to_string().eq_ignore_ascii_case(&source))
                .map(|_| index)
        });
        let index = matching.next()?;
        matching.next().is_none().then_some(index)
    }

    fn choose_session<'a>(
        manager: &SessionManager,
        sessions: &'a [ObservedSession],
        selected: Option<&str>,
    ) -> Option<&'a ObservedSession> {
        let retained = selected.and_then(|id| sessions.iter().find(|observed| observed.id == id));
        let current = manager
            .GetCurrentSession()
            .ok()
            .and_then(|current| {
                current_session_index(&current, sessions.iter().map(|item| &item.session))
            })
            .map(|index| &sessions[index]);
        let playing = |session: &&ObservedSession| {
            playback_status(&session.session) == Some(PlaybackStatus::Playing)
        };
        current
            .filter(playing)
            .or_else(|| retained.filter(playing))
            .or_else(|| sessions.iter().find(playing))
            .or_else(|| {
                retained.filter(|session| {
                    playback_status(&session.session) == Some(PlaybackStatus::Paused)
                })
            })
    }

    fn action_allowed(playback: &PlaybackInfo, action: MediaAction) -> bool {
        let Ok(controls) = playback.Controls() else {
            return false;
        };
        let Ok(status) = playback.PlaybackStatus() else {
            return false;
        };
        match action {
            MediaAction::Play => {
                status == PlaybackStatus::Paused && controls.IsPlayEnabled().unwrap_or(false)
            }
            MediaAction::Pause => {
                status == PlaybackStatus::Playing && controls.IsPauseEnabled().unwrap_or(false)
            }
            MediaAction::Previous => controls.IsPreviousEnabled().unwrap_or(false),
            MediaAction::Next => controls.IsNextEnabled().unwrap_or(false),
        }
    }

    async fn apply_action(
        app: &AppHandle,
        observation_id: &str,
        observed: &ObservedSession,
        action: MediaAction,
    ) -> bool {
        let operation = {
            let state = app.state::<NowPlayingState>();
            let Ok(active) = state.0.lock() else {
                return false;
            };
            if !matches!(&*active, Some(observer) if observer.id == observation_id) {
                return false;
            }
            let session = &observed.session;
            let Ok(playback) = session.GetPlaybackInfo() else {
                return false;
            };
            if !action_allowed(&playback, action) {
                return false;
            }
            match action {
                MediaAction::Play => session.TryPlayAsync(),
                MediaAction::Pause => session.TryPauseAsync(),
                MediaAction::Previous => session.TrySkipPreviousAsync(),
                MediaAction::Next => session.TrySkipNextAsync(),
            }
        };
        match operation {
            Ok(operation) => timeout(SYSTEM_TIMEOUT, async { operation.await })
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or(false),
            Err(_) => false,
        }
    }

    async fn app_volume(
        app: &AppHandle,
        observation_id: &str,
        manager: &SessionManager,
        selected: &ObservedSession,
        change: Option<VolumeChange>,
    ) -> Option<AppVolume> {
        let source = selected.source_app_id.clone()?;
        let session = selected.session.clone();
        let manager = manager.clone();
        let app = app.clone();
        let observation_id = observation_id.to_owned();
        async_runtime::spawn_blocking(move || {
            let mixer = AppMixerSessions::find(&source);
            let state = app.state::<NowPlayingState>();
            let active = state.0.lock().ok()?;
            if !active
                .as_ref()
                .is_some_and(|observer| observer.id == observation_id)
                || !still_selected(&manager, &session)
                || !session
                    .SourceAppUserModelId()
                    .ok()
                    .is_some_and(|id| id.to_string().eq_ignore_ascii_case(&source))
            {
                return None;
            }
            read_or_set_volume(mixer.as_ref(), change.as_ref())
        })
        .await
        .ok()
        .flatten()
    }

    fn still_selected(manager: &SessionManager, target: &Session) -> bool {
        let Ok(sessions) = manager.GetSessions() else {
            return false;
        };
        let sessions = sessions.into_iter().collect::<Vec<_>>();
        if !sessions.contains(target) {
            return false;
        }
        if let Some(current) = manager
            .GetCurrentSession()
            .ok()
            .filter(|session| playback_status(session) == Some(PlaybackStatus::Playing))
        {
            return current_session_index(&current, sessions.iter())
                .is_some_and(|index| &sessions[index] == target);
        }
        match playback_status(target) {
            Some(PlaybackStatus::Playing) => true,
            Some(PlaybackStatus::Paused) => !sessions
                .iter()
                .any(|session| playback_status(session) == Some(PlaybackStatus::Playing)),
            _ => false,
        }
    }

    async fn observe(
        app: AppHandle,
        observation_id: String,
        messages: mpsc::Sender<Message>,
        mut events: mpsc::Receiver<Message>,
    ) {
        let Some(manager) = get_manager().await else {
            emit_snapshot(&app, &observation_id, None);
            return;
        };
        let subscriptions = ManagerEvents::new(manager, &messages);
        let manager = &subscriptions.manager;
        let mut sessions = Vec::new();
        let mut last_snapshot: Option<Option<SessionSnapshot>> = None;
        let mut message = Message::Refresh;
        loop {
            refresh_sessions(manager, &mut sessions, &messages);
            let selected_id = last_snapshot
                .as_ref()
                .and_then(Option::as_ref)
                .map(|session| session.session_id.as_str());
            let selected = choose_session(manager, &sessions, selected_id);
            let refresh = match message {
                Message::Control {
                    session_id,
                    action,
                    result,
                } => {
                    let accepted = match selected {
                        Some(session) if session.id == session_id => {
                            apply_action(&app, &observation_id, session, action).await
                        }
                        _ => false,
                    };
                    let _ = result.send(accepted);
                    true
                }
                Message::Volume {
                    session_id,
                    change,
                    result,
                } => {
                    let value = match selected {
                        Some(session) if session.id == session_id => {
                            app_volume(&app, &observation_id, manager, session, change).await
                        }
                        _ => None,
                    };
                    let _ = result.send(value);
                    false
                }
                Message::Refresh => true,
            };
            if refresh {
                let snapshot = match selected {
                    Some(session) => {
                        session.load_icon(&messages);
                        session.snapshot().await
                    }
                    None => None,
                };
                if last_snapshot.as_ref() != Some(&snapshot) {
                    emit_snapshot(&app, &observation_id, snapshot.clone());
                    last_snapshot = Some(snapshot);
                }
            }

            let Some(next) = events.recv().await else {
                return;
            };
            message = next;
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn source_label_omits_the_executable_directory() {
            assert_eq!(
                source_label(r"C:\Users\someone\MusicApp.exe").as_deref(),
                Some("MusicApp")
            );
        }

        #[test]
        fn a_volume_drag_only_applies_to_its_original_scope_and_output() {
            use super::super::VolumeScope;

            let app = AppVolume {
                level: 0.5,
                muted: false,
                scope: VolumeScope::App,
                target_id: None,
            };
            let endpoint = AppVolume {
                scope: VolumeScope::System,
                target_id: Some("current-output".into()),
                ..app
            };
            let app_drag = VolumeChange {
                level: 0.8,
                scope: VolumeScope::App,
                target_id: None,
            };
            let output_drag = VolumeChange {
                level: 0.8,
                scope: VolumeScope::System,
                target_id: endpoint.target_id.clone(),
            };
            assert_eq!(app_drag.level_for(&app), Some(0.8));
            assert_eq!(app_drag.level_for(&endpoint), None);
            assert_eq!(output_drag.level_for(&app), None);
            assert_eq!(output_drag.level_for(&endpoint), Some(0.8));
            assert_eq!(
                VolumeChange {
                    target_id: Some("disconnected-output".into()),
                    ..output_drag
                }
                .level_for(&endpoint),
                None
            );
        }

        #[test]
        #[ignore = "requires a Windows default audio output"]
        fn can_read_default_output_without_changing_it() {
            use super::super::VolumeScope;

            let volume = read_or_set_volume(None, None).expect("a default audio output");
            assert_eq!(volume.scope, VolumeScope::System);
            assert!(volume.target_id.is_some_and(|id| !id.is_empty()));
            assert!((0.0..=1.0).contains(&volume.level));
        }

        #[test]
        #[ignore = "requires a single listed session for the current Windows playback"]
        fn can_read_volume_for_current_listed_playback() {
            async_runtime::block_on(async {
                let manager = get_manager().await.expect("Windows media service");
                let current = manager.GetCurrentSession().expect("current media session");
                assert_eq!(playback_status(&current), Some(PlaybackStatus::Playing));
                let sessions: Vec<_> = manager.GetSessions().unwrap().into_iter().collect();
                let index = current_session_index(&current, sessions.iter())
                    .expect("the current session is in the Windows session list");
                let listed = sessions[index].clone();
                let source = listed.SourceAppUserModelId().unwrap().to_string();
                let volume = async_runtime::spawn_blocking(move || {
                    let mixer = AppMixerSessions::find(&source);
                    assert!(still_selected(&manager, &listed));
                    read_or_set_volume(mixer.as_ref(), None).expect("a readable volume target")
                })
                .await
                .unwrap();
                assert!((0.0..=1.0).contains(&volume.level));
            });
        }

        #[test]
        #[ignore = "requires a media app with an accessible Windows mixer session"]
        fn can_read_app_volume_without_changing_playback() {
            let session = async_runtime::block_on(async {
                let manager = get_manager()
                    .await
                    .expect("Windows media service is available");
                let selected = match std::env::var("DELIGHT_TEST_MEDIA_APP_ID") {
                    Ok(id) => manager
                        .GetSessions()
                        .expect("Windows media sessions")
                        .into_iter()
                        .find(|item| item.SourceAppUserModelId().is_ok_and(|source| {
                            source.to_string().eq_ignore_ascii_case(&id)
                        }))
                        .expect("the requested media app has a session"),
                    Err(_) => manager.GetCurrentSession().expect("A media session is current"),
                };
                assert!(matches!(
                    playback_status(&selected),
                    Some(PlaybackStatus::Playing | PlaybackStatus::Paused)
                ));
                selected.SourceAppUserModelId().unwrap().to_string()
            });
            let mixer = AppMixerSessions::find(&session).expect("A matching audio mixer session");
            let volume = mixer
                .apply(None)
                .expect("The app's mixer state is readable");
            assert!((0.0..=1.0).contains(&volume.level));
        }

        #[test]
        #[ignore = "requires an interactive Windows desktop with system media services"]
        fn can_access_system_media_session_manager() {
            async_runtime::block_on(async {
                let manager = get_manager()
                    .await
                    .expect("Windows media service is available");
                assert!(manager.GetSessions().is_ok());
            });
        }
    }
}
