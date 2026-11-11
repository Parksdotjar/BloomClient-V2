use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
#[derive(Serialize, Deserialize)]
#[serde(default)]
pub struct UiOptions {
    pub gui_scale: u8,
    pub volume: f32,
    pub brightness: f32,
    pub smooth_lighting: bool,
    #[serde(skip)]
    path: Option<PathBuf>,
}
impl Default for UiOptions {
    fn default() -> Self {
        Self {
            gui_scale: 0,
            volume: 1.,
            brightness: 0.5,
            smooth_lighting: true,
            path: None,
        }
    }
}
impl UiOptions {
    pub fn load(cache: Option<&Path>) -> Self {
        let path = cache.map(|p| p.join("ui-options.json"));
        let mut options = path
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|v| serde_json::from_slice::<Self>(&v).ok())
            .unwrap_or_default();
        options.brightness=if options.brightness.is_finite(){options.brightness.clamp(0.,1.)}else{0.5};
        options.gui_scale = options.gui_scale.min(8);
        options.volume = if options.volume.is_finite() {
            options.volume.clamp(0., 1.)
        } else {
            1.
        };
        options.path = path;
        options
    }
    pub fn save(&self) -> Result<(), String> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let temporary = path.with_extension("json.tmp");
        std::fs::write(
            &temporary,
            serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())
    }
}
