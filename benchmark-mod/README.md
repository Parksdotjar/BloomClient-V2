# Bloom Benchmark

Bloom Benchmark is a standardized client-side performance benchmark for Fabric on Minecraft 26.2.

## How it works

1. Install Fabric Loader, Fabric API, and Bloom Benchmark.
2. Click **Bloom Benchmark** on the Minecraft title screen.
3. The mod creates or reuses a private fixed-seed creative world.
4. It warms the renderer for 15 seconds, then measures real frames for 60 seconds.
5. Minecraft displays average FPS, 1% low FPS, average frame time, and peak Java memory.

Every run uses the same seed and automatic camera motion for more comparable results. Results are also saved locally to `bloom-benchmark-result.json` in the game directory.

Bloom Client uses the same mod in a managed mode for its AutoTune feature. Normal installations never start the benchmark automatically.

## Requirements

- Minecraft Java Edition 26.2
- Fabric Loader 0.19.3 or newer
- Fabric API
- Java 25 or newer

## Privacy

The benchmark is entirely local. It does not upload hardware information or benchmark results.

## Building

Run `gradlew.bat build` on Windows. The release JAR is written to `build/libs`.
