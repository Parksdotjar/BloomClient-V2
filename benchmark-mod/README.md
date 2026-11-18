# Delight Benchmark

Delight Benchmark is a standardized client-side performance benchmark for Fabric on Minecraft 26.3.

## How it works

1. Install Fabric Loader, Fabric API, and Delight Benchmark.
2. Click **Delight Benchmark** on the Minecraft title screen.
3. The mod creates or reuses a private fixed-seed creative world. Delight-managed launches reset only the marked benchmark world before starting.
4. It warms the renderer for 15 seconds, then measures real frames for 60 seconds.
5. Minecraft displays average FPS, 1% low FPS, average frame time, and peak Java memory.

Every run uses the same seed and automatic camera motion for more comparable results. Results are also saved locally to `bloom-benchmark-result.json` in the game directory.

Delight Client uses the same mod in a managed mode for its AutoTune feature. Normal installations never start the benchmark automatically.

## Requirements

- Minecraft Java Edition 26.3
- Fabric Loader 0.19.5 or newer
- Fabric API
- Java 25 or newer

## Privacy

The benchmark is entirely local. It does not upload hardware information or benchmark results.

## Building

Run `gradlew.bat stageBenchmark` on Windows with JDK 25 selected in `JAVA_HOME`. This runs the sampler tests, builds the JAR and copies it to `../src-tauri/resources/bloom-autotune-benchmark-26.3.jar`. Run this after changing the sampler; Cargo embeds those exact bytes. The application VERSION is unchanged.


## Measurement contract

Managed tests use schema 2, a per-run ID shared with Delight, a 15-second warm-up and 60 seconds of measurement. All positive frame intervals, including freezes longer than one second, contribute to statistics. The 1% low is the reciprocal of the mean slowest 1% frame times; p95 uses nearest rank. Status writes are limited to twice per second and JSON files are replaced atomically where supported. Losing focus or opening a menu during measurement rejects the run.

The launcher pins Fabric Loader 0.19.5 and Fabric API 0.163.0+26.3, render/simulation distances of 12/8, an uncapped renderer and a 1280 × 720 window. It excludes global shared files and cosmetics from this private workload. Results characterize this baseline, not a particular user's modpack, shaders or multiplayer server. They do not establish a before/after improvement.
