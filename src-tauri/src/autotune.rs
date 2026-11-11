use std::path::Path;

pub const VERSION: &str = "26.3";

pub fn benchmark_memory(ram_bytes: u64) -> Result<u32, String> {
    let ram_mb = ram_bytes / 1_048_576;
    if ram_mb < 4096 { return Err("AutoTune needs at least 4 GB of system RAM for its Minecraft test.".into()); }
    Ok(((ram_mb * 45 / 100).min(4096) / 512 * 512) as u32)
}

pub fn validate_result(value: &serde_json::Value) -> Result<(), String> {
    let invalid = || "The benchmark is incomplete or outdated. Run a fresh Minecraft 26.3 test.".to_string();
    if value["version"].as_u64() != Some(2) || value["minecraftVersion"].as_str() != Some(VERSION)
        || value["interrupted"].as_bool() != Some(false)
        || value["runId"].as_str().is_none_or(|s| s.is_empty()) { return Err(invalid()); }
    for key in ["durationSeconds", "averageFps", "onePercentLow", "averageFrameTimeMs", "p95FrameTimeMs", "peakMemoryBytes", "averageMemoryBytes", "frames", "width", "height", "completedAt"] {
        if value[key].as_f64().is_none_or(|n| !n.is_finite() || n <= 0.0) { return Err(invalid()); }
    }
    let n = |key: &str| value[key].as_f64().unwrap();
    let fps = n("averageFps");
    if !(60.0..=180.0).contains(&n("durationSeconds")) || n("frames") < 60.0
        || n("onePercentLow") > fps * 1.05 || n("averageMemoryBytes") > n("peakMemoryBytes")
        || (n("frames") / n("durationSeconds") - fps).abs() > (fps * 0.02).max(1.0)
        || (1000.0 / n("averageFrameTimeMs") - fps).abs() > (fps * 0.02).max(1.0) { return Err(invalid()); }
    Ok(())
}

pub fn require_managed_directory(directory: &Path) -> Result<(), String> {
    if directory.is_symlink() || !directory.join(".bloom-autotune-managed").is_file() {
        return Err("The benchmark folder is not a Bloom-managed test folder. Its files were left untouched.".into());
    }
    Ok(())
}

pub fn prepare_run(directory: &Path) -> Result<(), String> {
    require_managed_directory(directory)?;
    for name in ["bloom-benchmark-result.json", "bloom-benchmark-status.json"] {
        match std::fs::remove_file(directory.join(name)) {
            Ok(()) => (), Err(e) if e.kind() == std::io::ErrorKind::NotFound => (), Err(e) => return Err(e.to_string()),
        }
    }
    let saves = directory.join("saves");
    let world = saves.join("Bloom AutoTune Benchmark");
    if saves.is_symlink() || world.is_symlink() { return Err("The benchmark world must not be a linked folder.".into()); }
    if world.exists() { std::fs::remove_dir_all(world).map_err(|e| e.to_string())?; }
    let run_id = uuid::Uuid::new_v4().to_string();
    std::fs::write(directory.join("bloom-benchmark-run-id.txt"), &run_id).map_err(|e| e.to_string())?;
    let status = serde_json::json!({"state":"starting", "progress":0, "message":"Starting Minecraft 26.3", "runId":run_id});
    std::fs::write(directory.join("bloom-benchmark-status.json"), status.to_string()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn autotune_benchmark_heap_reserves_system_memory() {
        assert_eq!(benchmark_memory(4 * 1_073_741_824).unwrap(), 1536);
        assert_eq!(benchmark_memory(8 * 1_073_741_824).unwrap(), 3584);
        assert_eq!(benchmark_memory(16 * 1_073_741_824).unwrap(), 4096);
        assert!(benchmark_memory(0).is_err());
    }
    #[test]
    fn autotune_rejects_old_interrupted_and_inconsistent_samples() {
        let valid = serde_json::json!({"version":2,"minecraftVersion":"26.3","runId":"run", "interrupted":false,
            "durationSeconds":60,"averageFps":100,"onePercentLow":50,"averageFrameTimeMs":10,"p95FrameTimeMs":20,
            "peakMemoryBytes":2000,"averageMemoryBytes":1000,"frames":6000,"width":1280,"height":720,"completedAt":1});
        assert!(validate_result(&valid).is_ok());
        for (key, value) in [("version", serde_json::json!(1)), ("interrupted", serde_json::json!(true)), ("frames", serde_json::json!(10)), ("averageFrameTimeMs", serde_json::json!(1)), ("durationSeconds", serde_json::json!(5))] {
            let mut broken = valid.clone(); broken[key] = value; assert!(validate_result(&broken).is_err());
        }
    }
    #[test]
    fn autotune_new_runs_remove_stale_results_and_only_the_test_world() {
        let path = std::env::temp_dir().join(format!("bloom-autotune-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        assert!(prepare_run(&path).is_err());
        std::fs::write(path.join(".bloom-autotune-managed"), "managed").unwrap();
        std::fs::create_dir_all(path.join("saves/Bloom AutoTune Benchmark")).unwrap();
        std::fs::create_dir_all(path.join("saves/Keep me")).unwrap();
        std::fs::write(path.join("bloom-benchmark-result.json"), "old").unwrap();
        prepare_run(&path).unwrap();
        let first = std::fs::read_to_string(path.join("bloom-benchmark-run-id.txt")).unwrap();
        assert!(!path.join("bloom-benchmark-result.json").exists());
        assert!(!path.join("saves/Bloom AutoTune Benchmark").exists());
        assert!(path.join("saves/Keep me").exists());
        prepare_run(&path).unwrap();
        assert_ne!(first, std::fs::read_to_string(path.join("bloom-benchmark-run-id.txt")).unwrap());
        std::fs::remove_dir_all(path).unwrap();
    }
}
