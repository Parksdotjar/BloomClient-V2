use serde::Serialize;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentDownload {
    pub id: String,
    pub instance_id: String,
    pub instance_name: String,
    pub project_id: String,
    pub category: String,
    pub title: String,
    pub version: String,
    pub icon_url: Option<String>,
    pub state: String,
    pub message: String,
    pub progress: u8,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub bytes_per_second: u64,
    pub completed_at: Option<u64>,
    pub revision: u64,
}

impl ContentDownload {
    pub fn pending(&self) -> bool {
        matches!(self.state.as_str(), "queued" | "installing" | "cancelling")
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueueSnapshot {
    session_id: String,
    revision: u64,
    tasks: Vec<ContentDownload>,
}

pub(crate) struct ContentQueue {
    tasks: Vec<ContentDownload>,
    session_id: String,
    revision: u64,
    last_progress: Instant,
}

impl Default for ContentQueue {
    fn default() -> Self {
        Self {
            tasks: Vec::new(),
            session_id: uuid::Uuid::new_v4().to_string(),
            revision: 0,
            last_progress: Instant::now(),
        }
    }
}

impl ContentQueue {
    pub fn snapshot(&self) -> QueueSnapshot {
        QueueSnapshot {
            session_id: self.session_id.clone(),
            revision: self.revision,
            tasks: self.tasks.clone(),
        }
    }

    pub fn contains(&self, instance: &str, project: &str, category: &str) -> bool {
        self.tasks.iter().any(|task| {
            task.pending()
                && task.instance_id == instance
                && task.project_id == project
                && task.category == category
        })
    }

    pub fn enqueue(&mut self, mut task: ContentDownload) -> Result<(), String> {
        if self.tasks.iter().filter(|task| task.pending()).count() >= 100 {
            return Err("The download queue is full. Wait for an installation to finish.".into());
        }
        self.revision += 1;
        task.revision = self.revision;
        self.tasks.push(task);
        self.prune();
        Ok(())
    }

    fn prune(&mut self) {
        let mut excess = self
            .tasks
            .iter()
            .filter(|task| !task.pending())
            .count()
            .saturating_sub(100);
        self.tasks.retain(|task| {
            if excess > 0 && !task.pending() {
                excess -= 1;
                false
            } else {
                true
            }
        });
    }

    pub fn begin_next(&mut self) -> Option<ContentDownload> {
        if self
            .tasks
            .iter()
            .any(|task| matches!(task.state.as_str(), "installing" | "cancelling"))
        {
            return None;
        }
        let task = self.tasks.iter_mut().find(|task| task.state == "queued")?;
        self.revision += 1;
        task.revision = self.revision;
        task.state = "installing".into();
        task.message = format!("Resolving {}", task.title);
        task.progress = 0;
        Some(task.clone())
    }

    pub fn finish(&mut self, id: &str, state: &str, message: String) -> Option<ContentDownload> {
        let task = self
            .tasks
            .iter_mut()
            .find(|task| task.id == id && task.pending())?;
        self.revision += 1;
        task.revision = self.revision;
        task.state = state.into();
        task.message = message;
        if state == "installed" {
            task.progress = 100;
        }
        task.bytes_per_second = 0;
        task.completed_at = Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        );
        let finished = task.clone();
        self.prune();
        Some(finished)
    }

    // Returns whether the worker's cancellation token must be signalled.
    pub fn cancel(&mut self, id: &str) -> Result<bool, String> {
        let task = self
            .tasks
            .iter_mut()
            .find(|task| task.id == id)
            .ok_or("Download no longer exists.")?;
        if !task.pending() {
            return Ok(false);
        }
        if task.state == "queued" {
            self.finish(id, "cancelled", "Removed from queue".into());
            return Ok(false);
        }
        self.revision += 1;
        task.revision = self.revision;
        task.state = "cancelling".into();
        task.message = "Cancelling installation…".into();
        Ok(true)
    }

    pub fn dismiss(&mut self, id: &str) -> Result<(), String> {
        if self
            .tasks
            .iter()
            .any(|task| task.id == id && task.pending())
        {
            return Err("Cancel this download before dismissing it.".into());
        }
        self.tasks.retain(|task| task.id != id);
        self.revision += 1;
        Ok(())
    }

    fn progress(
        &mut self,
        id: &str,
        progress: u8,
        message: String,
        received: u64,
        total: u64,
        speed: u64,
    ) -> bool {
        // Keep telemetry bounded even with parallel file workers. Lifecycle changes never wait.
        if progress < 99 && self.last_progress.elapsed() < Duration::from_millis(100) {
            return false;
        }
        let Some(task) = self
            .tasks
            .iter_mut()
            .find(|task| task.id == id && task.state == "installing")
        else {
            return false;
        };
        self.last_progress = Instant::now();
        self.revision += 1;
        task.revision = self.revision;
        task.progress = task.progress.max(progress.min(99));
        task.message = message;
        task.downloaded_bytes = received;
        task.total_bytes = total;
        task.bytes_per_second = speed;
        true
    }
}

pub(crate) fn publish(app: &tauri::AppHandle, snapshot: &QueueSnapshot) {
    let _ = app.emit("content-downloads-changed", snapshot);
}

pub(crate) fn progress(
    app: &tauri::AppHandle,
    id: &str,
    percent: u8,
    message: String,
    received: u64,
    total: u64,
    speed: u64,
) {
    let state = app.state::<super::LauncherState>();
    let snapshot = state
        .content_install_queue
        .lock()
        .ok()
        .and_then(|mut queue| {
            queue
                .progress(id, percent, message, received, total, speed)
                .then(|| queue.snapshot())
        });
    if let Some(snapshot) = snapshot {
        publish(app, &snapshot);
    }
}

#[tauri::command]
pub(crate) fn get_content_downloads(
    state: tauri::State<'_, super::LauncherState>,
) -> Result<QueueSnapshot, String> {
    Ok(state
        .content_install_queue
        .lock()
        .map_err(|_| "The content queue is busy.")?
        .snapshot())
}

#[tauri::command]
pub(crate) fn cancel_content_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::LauncherState>,
    task_id: String,
) -> Result<QueueSnapshot, String> {
    let mut queue = state
        .content_install_queue
        .lock()
        .map_err(|_| "The content queue is busy.")?;
    if queue.cancel(&task_id)? {
        state
            .content_cancel_requested
            .store(true, std::sync::atomic::Ordering::SeqCst);
    }
    let snapshot = queue.snapshot();
    drop(queue);
    publish(&app, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn dismiss_content_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::LauncherState>,
    task_id: String,
) -> Result<QueueSnapshot, String> {
    let mut queue = state
        .content_install_queue
        .lock()
        .map_err(|_| "The content queue is busy.")?;
    queue.dismiss(&task_id)?;
    let snapshot = queue.snapshot();
    drop(queue);
    publish(&app, &snapshot);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task(id: &str) -> ContentDownload {
        ContentDownload {
            id: id.into(),
            instance_id: "same-instance".into(),
            instance_name: "SMP".into(),
            project_id: id.into(),
            category: "mods".into(),
            title: id.into(),
            version: "1".into(),
            icon_url: None,
            state: "queued".into(),
            message: "Queued".into(),
            progress: 0,
            downloaded_bytes: 0,
            total_bytes: 0,
            bytes_per_second: 0,
            completed_at: None,
            revision: 0,
        }
    }
    #[test]
    fn rapid_installs_keep_fifo_identity_and_every_completion() {
        let mut queue = ContentQueue::default();
        for id in ["one", "two", "three", "four"] {
            queue.enqueue(task(id)).unwrap();
        }
        for id in ["one", "two", "three", "four"] {
            assert_eq!(queue.begin_next().unwrap().id, id);
            assert!(
                queue.begin_next().is_none(),
                "Only one content task writes dependencies at once"
            );
            assert!(queue.contains("same-instance", id, "mods"));
            queue.finish(id, "installed", "Installed".into());
        }
        assert!(queue.begin_next().is_none());
        assert_eq!(
            queue
                .snapshot()
                .tasks
                .iter()
                .filter(|task| task.state == "installed")
                .count(),
            4
        );
        assert!(queue
            .tasks
            .windows(2)
            .all(|tasks| tasks[0].revision < tasks[1].revision));
    }
    #[test]
    fn cancel_and_failure_preserve_the_remaining_queue() {
        let mut queue = ContentQueue::default();
        for id in ["one", "two", "three", "four"] {
            queue.enqueue(task(id)).unwrap();
        }
        queue.begin_next();
        assert!(!queue.cancel("two").unwrap());
        assert!(queue.cancel("one").unwrap());
        assert!(queue.dismiss("one").is_err());
        assert!(!queue.progress("one", 99, "late progress".into(), 1, 2, 3));
        queue.finish("one", "cancelled", "Cancelled".into());
        assert_eq!(queue.begin_next().unwrap().id, "three");
        queue.finish("three", "error", "Network error".into());
        assert_eq!(queue.begin_next().unwrap().id, "four");
        queue.finish("four", "installed", "Installed".into());
        assert!(!queue.cancel("four").unwrap());
        queue.dismiss("two").unwrap();
        assert_eq!(queue.tasks.len(), 3);
    }
    #[test]
    fn terminal_retention_never_discards_pending_work() {
        let mut queue = ContentQueue::default();
        queue.enqueue(task("waiting")).unwrap();
        for i in 0..105 {
            let id = i.to_string();
            queue.enqueue(task(&id)).unwrap();
            queue.finish(&id, "installed", "Installed".into());
        }
        assert_eq!(queue.tasks.len(), 101);
        assert_eq!(queue.begin_next().unwrap().id, "waiting");
    }
    #[test]
    fn duplicate_identity_is_scoped_and_late_progress_cannot_revive_completion() {
        let mut queue = ContentQueue::default();
        queue.enqueue(task("mod")).unwrap();
        assert!(queue.contains("same-instance", "mod", "mods"));
        assert!(!queue.contains("other-instance", "mod", "mods"));
        assert!(!queue.contains("same-instance", "mod", "resourcepacks"));
        queue.begin_next();
        assert!(queue.contains("same-instance", "mod", "mods"));
        queue.last_progress = Instant::now() - Duration::from_secs(1);
        assert!(queue.progress("mod", 65, "Downloading".into(), 65, 100, 1));
        queue.last_progress = Instant::now() - Duration::from_secs(1);
        assert!(queue.progress("mod", 42, "Downloading".into(), 42, 100, 1));
        assert_eq!(queue.tasks[0].progress, 65);
        queue.finish("mod", "installed", "Installed".into());
        assert!(!queue.progress("mod", 99, "late worker".into(), 99, 100, 1));
        assert!(!queue.contains("same-instance", "mod", "mods"));
        assert_eq!(queue.tasks[0].state, "installed");
    }
}
