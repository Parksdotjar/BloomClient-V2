//! The reference button event is decoded once, never during a click or frame.
use crate::assets::AssetPack;
use rodio::{OutputStreamBuilder, Source, buffer::SamplesBuffer};
use std::{
    sync::mpsc::{self, SyncSender},
    time::Duration,
};
pub struct UiAudio {
    clicks: SyncSender<f32>,
}
impl UiAudio {
    pub fn new(assets: &AssetPack) -> Self {
        let sound = assets
            .gui
            .sounds
            .get("ui.button.click")
            .and_then(|sounds| sounds.first())
            .cloned();
        let (clicks, events) = mpsc::sync_channel::<f32>(8);
        // Device setup overlaps window/GPU creation. The UI never waits on
        // an audio driver, file read, decode, or a full sound command queue.
        let _ = std::thread::Builder::new()
            .name("sakura-ui-audio".into())
            .spawn(move || {
                let Some(sound) = sound else {
                    return;
                };
                let Ok(file) = std::fs::File::open(&sound.path) else {
                    return;
                };
                if !file.metadata().is_ok_and(|m| m.len() <= 1024 * 1024) {
                    return;
                }
                let Ok(decoder) = rodio::Decoder::try_from(file) else {
                    return;
                };
                let click = SamplesBuffer::new(
                    decoder.channels(),
                    decoder.sample_rate(),
                    decoder
                        .take_duration(Duration::from_secs(2))
                        .collect::<Vec<f32>>(),
                );
                let Ok(stream) = OutputStreamBuilder::open_default_stream() else {
                    eprintln!("Sakura UI audio unavailable; continuing without a playback device.");
                    return;
                };
                while let Ok(volume) = events.recv() {
                    stream.mixer().add(
                        click
                            .clone()
                            .amplify(volume * sound.volume * 0.25)
                            .speed(sound.pitch),
                    );
                }
            });
        Self { clicks }
    }
    pub fn click(&self, volume: f32) {
        if volume <= 0. {
            return;
        }
        let _ = self.clicks.try_send(volume.clamp(0., 1.));
    }
}
