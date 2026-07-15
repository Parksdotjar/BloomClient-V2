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

public final class BloomHatService {
    private static final Logger LOGGER = LoggerFactory.getLogger("Bloom Cosmetics");
    private static final String API = "https://api.north.bloomclient.org/minecraft";
    private static final long ACTIVE_PLAYER_WINDOW_MS = 20_000L;
    private static final BloomHatService INSTANCE = new BloomHatService();

    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).followRedirects(HttpClient.Redirect.NORMAL).build();
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "Bloom-Hat-Refresh");
        thread.setDaemon(true);
        thread.setPriority(Thread.MIN_PRIORITY);
        return thread;
    });
    private final ConcurrentHashMap<UUID, Long> observedPlayers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, HatAssignment> assignments = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<HatAsset>> assetLoads = new ConcurrentHashMap<>();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean refreshing = new AtomicBoolean();

    public static BloomHatService get() { return INSTANCE; }

    public void start() {
        if (!started.compareAndSet(false, true)) return;
        worker.scheduleWithFixedDelay(this::refreshObservedPlayers, 0, 2, TimeUnit.SECONDS);
        LOGGER.info("Bloom Cosmetics is ready for live 3D hat updates.");
    }

    public HatAsset assetFor(int entityId) {
        MinecraftClient minecraft = MinecraftClient.getInstance();
        if (minecraft.world == null) return null;
        Entity entity = minecraft.world.getEntityById(entityId);
        if (!(entity instanceof AbstractClientPlayerEntity player)) return null;
        UUID uuid = player.getUuid();
        long now = System.currentTimeMillis();
        Long lastSeen = observedPlayers.get(uuid);
        if (lastSeen == null || now - lastSeen >= 1_000L) observedPlayers.put(uuid, now);
        HatAssignment assignment = assignments.get(uuid);
        return assignment == null ? null : assignment.asset;
    }

    private void refreshObservedPlayers() {
        if (!refreshing.compareAndSet(false, true)) return;
        try {
            long cutoff = System.currentTimeMillis() - ACTIVE_PLAYER_WINDOW_MS;
            observedPlayers.entrySet().removeIf(entry -> entry.getValue() < cutoff);
            if (observedPlayers.isEmpty()) { refreshing.set(false); return; }
            List<UUID> players = observedPlayers.keySet().stream().limit(100).toList();
            String joined = players.stream().map(BloomHatService::compactUuid).reduce((left, right) -> left + "," + right).orElse("");
            HttpRequest request = HttpRequest.newBuilder(URI.create(API + "/v1/hats/equipped?uuids=" + URLEncoder.encode(joined, StandardCharsets.UTF_8)))
                .timeout(Duration.ofSeconds(5)).header("Accept", "application/json").header("User-Agent", "Bloom-Cosmetics/1.1.0").GET().build();
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
            Map<UUID, RemoteHat> remote = new HashMap<>();
            if (items != null) for (JsonElement element : items) {
                JsonObject item = element.getAsJsonObject();
                JsonArray offset = item.getAsJsonArray("offset");
                UUID uuid = parseUuid(item.get("uuid").getAsString());
                remote.put(uuid, new RemoteHat(
                    item.get("hatId").getAsString(), item.get("modelRevision").getAsString(), item.get("textureRevision").getAsString(),
                    item.get("modelUrl").getAsString(), item.get("textureUrl").getAsString(),
                    offset.get(0).getAsFloat(), offset.get(1).getAsFloat(), offset.get(2).getAsFloat(),
                    item.get("scale").getAsFloat(), item.get("hideWithHelmet").getAsBoolean()
                ));
            }

            Set<UUID> requested = new HashSet<>(requestedPlayers);
            for (UUID uuid : requested) {
                RemoteHat next = remote.get(uuid);
                if (next == null) { assignments.remove(uuid); continue; }
                String assetKey = next.hatId + ":" + next.modelRevision + ":" + next.textureRevision;
                HatAssignment current = assignments.get(uuid);
                if (current != null && current.assetKey.equals(assetKey) && current.asset != null) continue;
                assignments.put(uuid, new HatAssignment(assetKey, current == null ? null : current.asset));
                loadAsset(next).thenAccept(asset -> {
                    HatAssignment latest = assignments.get(uuid);
                    if (latest != null && latest.assetKey.equals(assetKey)) latest.asset = asset;
                }).exceptionally(error -> null);
            }
        } catch (Exception ignored) {
            // Keep the last safe assignment if a transient response is malformed.
        }
    }

    private CompletableFuture<HatAsset> loadAsset(RemoteHat hat) {
        String key = hat.hatId + ":" + hat.modelRevision + ":" + hat.textureRevision;
        return assetLoads.computeIfAbsent(key, unused -> downloadModel(hat).thenCombine(downloadTexture(hat), (mesh, texture) ->
            new HatAsset(mesh, texture, hat.offsetX, hat.offsetY, hat.offsetZ, hat.scale, hat.hideWithHelmet)
        ).whenComplete((asset, error) -> { if (error != null) assetLoads.remove(key); }));
    }

    private CompletableFuture<BloomHatMesh> downloadModel(RemoteHat hat) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(hat.modelUrl)).timeout(Duration.ofSeconds(8))
            .header("Accept", "application/json").header("User-Agent", "Bloom-Cosmetics/1.1.0").GET().build();
        return client.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray()).thenCompose(response -> {
            if (response.statusCode() != 200 || response.body().length > 2 * 1024 * 1024) return CompletableFuture.failedFuture(new IllegalStateException("Hat model unavailable"));
            try { return CompletableFuture.completedFuture(BloomHatMesh.parse(new String(response.body(), StandardCharsets.UTF_8))); }
            catch (Exception error) { return CompletableFuture.failedFuture(error); }
        });
    }

    private CompletableFuture<Identifier> downloadTexture(RemoteHat hat) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(hat.textureUrl)).timeout(Duration.ofSeconds(8))
            .header("Accept", "image/png").header("User-Agent", "Bloom-Cosmetics/1.1.0").GET().build();
        return client.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray()).thenCompose(response -> {
            if (response.statusCode() != 200 || response.body().length > 8 * 1024 * 1024) return CompletableFuture.failedFuture(new IllegalStateException("Hat texture unavailable"));
            try {
                NativeImage image = NativeImage.read(response.body());
                if (image.getWidth() < 1 || image.getHeight() < 1 || image.getWidth() > 4096 || image.getHeight() > 4096) {
                    image.close();
                    return CompletableFuture.failedFuture(new IllegalStateException("Invalid hat texture dimensions"));
                }
                return registerTexture(hat, image);
            } catch (Exception error) { return CompletableFuture.failedFuture(error); }
        });
    }

    private CompletableFuture<Identifier> registerTexture(RemoteHat hat, NativeImage image) {
        CompletableFuture<Identifier> result = new CompletableFuture<>();
        String safeRevision = hat.textureRevision.toLowerCase().replaceAll("[^a-z0-9_.-]", "-");
        Identifier identifier = Identifier.of("bloom_cosmetics", "hats/" + hat.hatId + "/" + safeRevision);
        MinecraftClient minecraft = MinecraftClient.getInstance();
        minecraft.execute(() -> {
            try {
                minecraft.getTextureManager().registerTexture(identifier, new NativeImageBackedTexture(() -> "Bloom hat " + hat.hatId, image));
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

    private record RemoteHat(String hatId, String modelRevision, String textureRevision, String modelUrl, String textureUrl,
                             float offsetX, float offsetY, float offsetZ, float scale, boolean hideWithHelmet) {}
    private static final class HatAssignment {
        private final String assetKey;
        private volatile HatAsset asset;
        private HatAssignment(String assetKey, HatAsset asset) { this.assetKey = assetKey; this.asset = asset; }
    }
    public record HatAsset(BloomHatMesh mesh, Identifier texture, float offsetX, float offsetY, float offsetZ,
                           float scale, boolean hideWithHelmet) {}
}
