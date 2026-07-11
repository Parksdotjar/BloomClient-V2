# Bloom AutoTune Benchmark Mod

Private Fabric client instrumentation used by Bloom Client AutoTune.

- Targets Minecraft 26.2.
- Creates a fixed-seed benchmark world automatically.
- Uses a 15-second warm-up and 60-second measurement window.
- Records average FPS, 1% lows, frame times, and Java memory usage.
- Writes results only to the benchmark instance directory.

Build with `gradlew.bat build`. The launcher embeds the resulting remapped JAR from `src-tauri/resources`.
