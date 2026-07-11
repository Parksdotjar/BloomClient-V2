package dev.bloomclient.benchmark;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.Identifier;
import net.minecraft.world.Difficulty;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.level.levelgen.WorldOptions;
import net.minecraft.world.level.levelgen.presets.WorldPresets;

public final class BloomBenchmarkClient implements ClientModInitializer {
    private static final String WORLD_FOLDER = "Bloom AutoTune Benchmark";
    private static final long WORLD_SEED = -6202809933377939275L;
    private static final long WARMUP_NANOS = 15_000_000_000L;
    private static final long BENCHMARK_NANOS = 60_000_000_000L;
    private static final Path GAME_DIR = FabricLoader.getInstance().getGameDir();
    private static final Path STATUS_FILE = GAME_DIR.resolve("bloom-benchmark-status.json");
    private static final Path RESULT_FILE = GAME_DIR.resolve("bloom-benchmark-result.json");
    private final List<Double> frameTimesMs = new ArrayList<>();
    private long worldReadyAt;
    private long benchmarkStartedAt;
    private long previousFrame;
    private long memoryTotal;
    private long memorySamples;
    private long peakMemory;
    private boolean openingWorld;
    private boolean announced;
    private boolean complete;

    @Override
    public void onInitializeClient() {
        try { Files.deleteIfExists(RESULT_FILE); } catch (IOException ignored) {}
        writeStatus("starting", 0, "Preparing the fixed Bloom benchmark world");
        ClientTickEvents.END_CLIENT_TICK.register(this::onTick);
        HudElementRegistry.addLast(Identifier.fromNamespaceAndPath("bloom_autotune", "frame_sampler"), (graphics, deltaTracker) -> sampleFrame());
    }

    private void onTick(Minecraft minecraft) {
        if (complete) return;
        if (minecraft.level == null) {
            if (!openingWorld) {
                openingWorld = true;
                Path level = GAME_DIR.resolve("saves").resolve(WORLD_FOLDER).resolve("level.dat");
                writeStatus("world", 3, Files.exists(level) ? "Opening the fixed benchmark world" : "Creating the fixed benchmark world");
                if (Files.exists(level)) {
                    minecraft.createWorldOpenFlows().openWorld(WORLD_FOLDER, () -> openingWorld = false);
                } else {
                    LevelSettings settings = new LevelSettings(
                        WORLD_FOLDER,
                        GameType.CREATIVE,
                        new LevelSettings.DifficultySettings(Difficulty.PEACEFUL, false, true),
                        true,
                        WorldDataConfiguration.DEFAULT
                    );
                    minecraft.createWorldOpenFlows().createFreshLevel(
                        WORLD_FOLDER,
                        settings,
                        new WorldOptions(WORLD_SEED, true, false),
                        WorldPresets::createNormalWorldDimensions,
                        minecraft.gui.screen()
                    );
                }
            }
            return;
        }
        if (worldReadyAt == 0) {
            worldReadyAt = System.nanoTime();
            writeStatus("warmup", 5, "Warming up chunks and the renderer");
        }
        if (minecraft.player != null) {
            float rotation = (float)(((System.nanoTime() - worldReadyAt) / 1_000_000_000.0) * 8.0 % 360.0);
            minecraft.player.setYRot(rotation);
            minecraft.player.setXRot(-8.0F + (float)Math.sin(rotation * Math.PI / 180.0) * 5.0F);
            if (!announced) {
                announced = true;
                minecraft.player.sendSystemMessage(Component.literal("Bloom AutoTune is warming up. The benchmark will run automatically and Minecraft will close when finished."));
            }
        }
    }

    private void sampleFrame() {
        if (complete || worldReadyAt == 0) return;
        long now = System.nanoTime();
        long elapsed = now - worldReadyAt;
        if (elapsed < WARMUP_NANOS) {
            int progress = 5 + (int)(elapsed * 15 / WARMUP_NANOS);
            writeStatus("warmup", progress, "Warming up chunks and the renderer");
            previousFrame = now;
            return;
        }
        if (benchmarkStartedAt == 0) {
            benchmarkStartedAt = now;
            previousFrame = now;
            frameTimesMs.clear();
            writeStatus("benchmark", 20, "Measuring real Minecraft frame times");
            return;
        }
        double deltaMs = (now - previousFrame) / 1_000_000.0;
        previousFrame = now;
        if (deltaMs > 0.0 && deltaMs < 1000.0) frameTimesMs.add(deltaMs);
        long used = Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory();
        memoryTotal += used;
        memorySamples++;
        peakMemory = Math.max(peakMemory, used);
        long measured = now - benchmarkStartedAt;
        int progress = 20 + (int)(Math.min(measured, BENCHMARK_NANOS) * 79 / BENCHMARK_NANOS);
        if (frameTimesMs.size() % 30 == 0) writeStatus("benchmark", progress, "Measuring real Minecraft frame times");
        if (measured >= BENCHMARK_NANOS) finish(measured);
    }

    private void finish(long measuredNanos) {
        complete = true;
        List<Double> sorted = new ArrayList<>(frameTimesMs);
        sorted.sort(Comparator.naturalOrder());
        double seconds = measuredNanos / 1_000_000_000.0;
        double averageFps = frameTimesMs.size() / seconds;
        int worstCount = Math.max(1, (int)Math.ceil(sorted.size() * 0.01));
        double worstAverage = sorted.subList(Math.max(0, sorted.size() - worstCount), sorted.size()).stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
        double onePercentLow = worstAverage == 0.0 ? 0.0 : 1000.0 / worstAverage;
        double averageFrameTime = frameTimesMs.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
        double p95FrameTime = sorted.get(Math.min(sorted.size() - 1, (int)Math.floor(sorted.size() * 0.95)));
        long averageMemory = memorySamples == 0 ? 0 : memoryTotal / memorySamples;
        Minecraft minecraft = Minecraft.getInstance();
        int width = minecraft.getWindow().getWidth();
        int height = minecraft.getWindow().getHeight();
        String json = String.format(java.util.Locale.ROOT,
            "{\"version\":1,\"minecraftVersion\":\"26.2\",\"seed\":%d,\"durationSeconds\":%.3f,\"averageFps\":%.3f,\"onePercentLow\":%.3f,\"averageFrameTimeMs\":%.3f,\"p95FrameTimeMs\":%.3f,\"averageMemoryBytes\":%d,\"peakMemoryBytes\":%d,\"frames\":%d,\"width\":%d,\"height\":%d,\"completedAt\":%d}",
            WORLD_SEED, seconds, averageFps, onePercentLow, averageFrameTime, p95FrameTime, averageMemory, peakMemory, frameTimesMs.size(), width, height, System.currentTimeMillis());
        try { Files.writeString(RESULT_FILE, json, StandardCharsets.UTF_8); } catch (IOException error) { writeStatus("error", 0, "Could not save benchmark results: " + error.getMessage()); return; }
        writeStatus("complete", 100, "Minecraft benchmark complete");
        if (minecraft.player != null) minecraft.player.sendSystemMessage(Component.literal("Bloom AutoTune benchmark complete. Returning results to Bloom Client…"));
        Thread closer = new Thread(() -> { try { Thread.sleep(2500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); } minecraft.execute(minecraft::stop); }, "Bloom benchmark closer");
        closer.setDaemon(true);
        closer.start();
    }

    private static void writeStatus(String state, int progress, String message) {
        String safe = message.replace("\\", "\\\\").replace("\"", "\\\"");
        String json = String.format("{\"state\":\"%s\",\"progress\":%d,\"message\":\"%s\"}", state, progress, safe);
        try { Files.writeString(STATUS_FILE, json, StandardCharsets.UTF_8); } catch (IOException ignored) {}
    }
}
