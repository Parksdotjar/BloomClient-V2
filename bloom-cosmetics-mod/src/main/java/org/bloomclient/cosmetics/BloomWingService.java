package org.bloomclient.cosmetics;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.entity.Entity;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class BloomWingService {
    private static final Logger LOGGER = LoggerFactory.getLogger("Bloom Cosmetics");
    private static final String API = "https://api.north.bloomclient.org/minecraft";
    private static final long ACTIVE_PLAYER_WINDOW_MS = 20_000L;
    private static final BloomWingService INSTANCE = new BloomWingService();

    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).followRedirects(HttpClient.Redirect.NORMAL).build();
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "Bloom-Wing-Refresh");
        thread.setDaemon(true);
        thread.setPriority(Thread.MIN_PRIORITY);
        return thread;
    });
    private final ConcurrentHashMap<UUID, Long> observedPlayers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, WingAssignment> assignments = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<WingAsset>> assetLoads = new ConcurrentHashMap<>();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean refreshing = new AtomicBoolean();

    public static BloomWingService get() { return INSTANCE; }

    public void start() {
        if (!started.compareAndSet(false, true)) return;
        worker.scheduleWithFixedDelay(this::refreshObservedPlayers, 0, 2, TimeUnit.SECONDS);
        LOGGER.info("Bloom Cosmetics is ready for live torso-anchored wing updates.");
    }

    public WingAsset assetFor(int entityId) {
        MinecraftClient minecraft = MinecraftClient.getInstance();
        if (minecraft.world == null) return null;
        Entity entity = minecraft.world.getEntityById(entityId);
        if (!(entity instanceof AbstractClientPlayerEntity player)) return null;
        observe(player.getUuid());
        WingAssignment assignment = assignments.get(player.getUuid());
        return assignment == null ? null : assignment.asset;
    }

    public boolean shouldHideCape(UUID uuid) {
        observe(uuid);
        WingAssignment assignment = assignments.get(uuid);
        return assignment != null && assignment.asset != null && assignment.asset.hideCape();
    }

    private void observe(UUID uuid) {
        long now = System.currentTimeMillis();
        Long lastSeen = observedPlayers.get(uuid);
        if (lastSeen == null || now - lastSeen >= 1_000L) observedPlayers.put(uuid, now);
    }

    private void refreshObservedPlayers() {
        if (!refreshing.compareAndSet(false, true)) return;
        try {
            long cutoff = System.currentTimeMillis() - ACTIVE_PLAYER_WINDOW_MS;
            observedPlayers.entrySet().removeIf(entry -> entry.getValue() < cutoff);
            if (observedPlayers.isEmpty()) { refreshing.set(false); return; }
            List<UUID> players = observedPlayers.keySet().stream().limit(100).toList();
            String joined = players.stream().map(BloomWingService::compactUuid).reduce((left, right) -> left + "," + right).orElse("");
            HttpRequest request = HttpRequest.newBuilder(URI.create(API + "/v1/wings/equipped?uuids=" + URLEncoder.encode(joined, StandardCharsets.UTF_8)))
                .timeout(Duration.ofSeconds(5)).header("Accept", "application/json").header("User-Agent", "Bloom-Cosmetics/1.2.0").GET().build();
            client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> { if (response.statusCode() == 200) applyAssignments(players, response.body()); })
                .exceptionally(error -> null)
                .whenComplete((unused, error) -> refreshing.set(false));
            return;
        } catch (Exception ignored) {}
        refreshing.set(false);
    }

    private void applyAssignments(List<UUID> requestedPlayers, String body) {
        try {
            JsonArray items = JsonParser.parseString(body).getAsJsonObject().getAsJsonArray("items");
            Map<UUID, RemoteWing> remote = new HashMap<>();
            if (items != null) for (JsonElement element : items) {
                JsonObject item = element.getAsJsonObject();
                JsonArray offset = item.getAsJsonArray("offset");
                UUID uuid = parseUuid(item.get("uuid").getAsString());
                remote.put(uuid, new RemoteWing(
                    item.get("wingId").getAsString(), item.get("modelRevision").getAsString(), item.get("textureRevision").getAsString(),
                    item.get("modelUrl").getAsString(), item.get("textureUrl").getAsString(),
                    offset.get(0).getAsFloat(), offset.get(1).getAsFloat(), offset.get(2).getAsFloat(),
                    item.get("scale").getAsFloat(), item.get("hideCape").getAsBoolean()
                ));
            }

            Set<UUID> requested = new HashSet<>(requestedPlayers);
            for (UUID uuid : requested) {
                RemoteWing next = remote.get(uuid);
                if (next == null) { assignments.remove(uuid); continue; }
                String assetKey = next.wingId + ":" + next.modelRevision + ":" + next.textureRevision;
                WingAssignment current = assignments.get(uuid);
                if (current != null && current.assetKey.equals(assetKey) && current.asset != null) continue;
                assignments.put(uuid, new WingAssignment(assetKey, current == null ? null : current.asset));
                loadAsset(next).thenAccept(asset -> {
                    WingAssignment latest = assignments.get(uuid);
                    if (latest != null && latest.assetKey.equals(assetKey)) latest.asset = asset;
                }).exceptionally(error -> null);
            }
        } catch (Exception ignored) {
            // Keep the last safe assignment if a transient response is malformed.
        }
    }

    private CompletableFuture<WingAsset> loadAsset(RemoteWing wing) {
        String key = wing.wingId + ":" + wing.modelRevision + ":" + wing.textureRevision;
        return assetLoads.computeIfAbsent(key, unused -> downloadModel(wing).thenCombine(downloadTexture(wing), (mesh, texture) ->
            new WingAsset(mesh, texture, wing.offsetX, wing.offsetY, wing.offsetZ, wing.scale, wing.hideCape)
        ).whenComplete((asset, error) -> { if (error != null) assetLoads.remove(key); }));
    }

    private CompletableFuture<BloomHatMesh> downloadModel(RemoteWing wing) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(wing.modelUrl)).timeout(Duration.ofSeconds(8))
            .header("Accept", "application/json").header("User-Agent", "Bloom-Cosmetics/1.2.0").GET().build();
        return client.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray()).thenCompose(response -> {
            if (response.statusCode() != 200 || response.body().length > 2 * 1024 * 1024) return CompletableFuture.failedFuture(new IllegalStateException("Wing model unavailable"));
            try { return CompletableFuture.completedFuture(BloomHatMesh.parseWing(new String(response.body(), StandardCharsets.UTF_8))); }
            catch (Exception error) { return CompletableFuture.failedFuture(error); }
        });
    }

    private CompletableFuture<Identifier> downloadTexture(RemoteWing wing) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(wing.textureUrl)).timeout(Duration.ofSeconds(8))
            .header("Accept", "image/png").header("User-Agent", "Bloom-Cosmetics/1.2.0").GET().build();
        return client.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray()).thenCompose(response -> {
            if (response.statusCode() != 200 || response.body().length > 8 * 1024 * 1024) return CompletableFuture.failedFuture(new IllegalStateException("Wing texture unavailable"));
            try {
                NativeImage image = NativeImage.read(response.body());
                if (image.getWidth() < 1 || image.getHeight() < 1 || image.getWidth() > 4096 || image.getHeight() > 4096) {
                    image.close();
                    return CompletableFuture.failedFuture(new IllegalStateException("Invalid wing texture dimensions"));
                }
                return registerTexture(wing, image);
            } catch (Exception error) { return CompletableFuture.failedFuture(error); }
        });
    }

    private CompletableFuture<Identifier> registerTexture(RemoteWing wing, NativeImage image) {
        CompletableFuture<Identifier> result = new CompletableFuture<>();
        String safeRevision = wing.textureRevision.toLowerCase().replaceAll("[^a-z0-9_.-]", "-");
        Identifier identifier = Identifier.of("bloom_cosmetics", "wings/" + wing.wingId + "/" + safeRevision);
        MinecraftClient minecraft = MinecraftClient.getInstance();
        minecraft.execute(() -> {
            try {
                minecraft.getTextureManager().registerTexture(identifier, new NativeImageBackedTexture(() -> "Bloom wings " + wing.wingId, image));
                result.complete(identifier);
            } catch (Throwable error) { image.close(); result.completeExceptionally(error); }
        });
        return result;
    }

    private static String compactUuid(UUID uuid) { return uuid.toString().replace("-", "").toLowerCase(); }
    private static UUID parseUuid(String value) {
        String compact = value.replace("-", "").toLowerCase();
        if (compact.length() != 32) throw new IllegalArgumentException("Invalid UUID");
        return UUID.fromString(compact.substring(0, 8) + "-" + compact.substring(8, 12) + "-" + compact.substring(12, 16) + "-" + compact.substring(16, 20) + "-" + compact.substring(20));
    }

    private record RemoteWing(String wingId, String modelRevision, String textureRevision, String modelUrl, String textureUrl,
                              float offsetX, float offsetY, float offsetZ, float scale, boolean hideCape) {}
    private static final class WingAssignment {
        private final String assetKey;
        private volatile WingAsset asset;
        private WingAssignment(String assetKey, WingAsset asset) { this.assetKey = assetKey; this.asset = asset; }
    }
    public record WingAsset(BloomHatMesh mesh, Identifier texture, float offsetX, float offsetY, float offsetZ,
                            float scale, boolean hideCape) {}
}
