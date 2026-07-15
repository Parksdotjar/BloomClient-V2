package org.bloomclient.cosmetics;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
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
import java.util.ArrayList;
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

public final class BloomCapeService {
    private static final Logger LOGGER = LoggerFactory.getLogger("Bloom Cosmetics");
    private static final String API = "https://api.north.bloomclient.org/minecraft";
    private static final long ACTIVE_PLAYER_WINDOW_MS = 20_000L;
    private static final BloomCapeService INSTANCE = new BloomCapeService();

    private final HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(4))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "Bloom-Cape-Refresh");
        thread.setDaemon(true);
        thread.setPriority(Thread.MIN_PRIORITY);
        return thread;
    });
    private final ConcurrentHashMap<UUID, Long> observedPlayers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, CapeAssignment> assignments = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<Identifier>> textureLoads = new ConcurrentHashMap<>();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean refreshing = new AtomicBoolean();

    public static BloomCapeService get() {
        return INSTANCE;
    }

    public void start() {
        if (!started.compareAndSet(false, true)) return;
        worker.scheduleWithFixedDelay(this::refreshObservedPlayers, 0, 2, TimeUnit.SECONDS);
        LOGGER.info("Bloom Cosmetics is ready for live cape updates.");
    }

    public Identifier textureFor(UUID uuid) {
        long now = System.currentTimeMillis();
        Long lastSeen = observedPlayers.get(uuid);
        if (lastSeen == null || now - lastSeen >= 1_000L) observedPlayers.put(uuid, now);
        CapeAssignment assignment = assignments.get(uuid);
        return assignment == null ? null : assignment.texture;
    }

    private void refreshObservedPlayers() {
        if (!refreshing.compareAndSet(false, true)) return;
        try {
            long cutoff = System.currentTimeMillis() - ACTIVE_PLAYER_WINDOW_MS;
            observedPlayers.entrySet().removeIf(entry -> entry.getValue() < cutoff);
            if (observedPlayers.isEmpty()) {
                // The first scheduled refresh normally runs before Minecraft has
                // rendered a player. Release the guard so the next refresh can
                // fetch capes after textureFor() observes the local player.
                refreshing.set(false);
                return;
            }

            List<UUID> players = observedPlayers.keySet().stream().limit(100).toList();
            String joined = players.stream().map(BloomCapeService::compactUuid).reduce((left, right) -> left + "," + right).orElse("");
            HttpRequest request = HttpRequest.newBuilder(URI.create(API + "/v1/capes/equipped?uuids=" + URLEncoder.encode(joined, StandardCharsets.UTF_8)))
                .timeout(Duration.ofSeconds(5))
                .header("Accept", "application/json")
                .header("User-Agent", "Bloom-Cosmetics/1.0.1")
                .GET()
                .build();
            client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    if (response.statusCode() != 200) return;
                    applyAssignments(players, response.body());
                })
                .exceptionally(error -> null)
                .whenComplete((unused, error) -> refreshing.set(false));
            return;
        } catch (Exception ignored) {
            // A temporary network failure should never affect Minecraft rendering.
        }
        refreshing.set(false);
    }

    private void applyAssignments(List<UUID> requestedPlayers, String body) {
        try {
            JsonArray items = JsonParser.parseString(body).getAsJsonObject().getAsJsonArray("items");
            Map<UUID, RemoteCape> remote = new HashMap<>();
            if (items != null) {
                for (JsonElement element : items) {
                    JsonObject item = element.getAsJsonObject();
                    UUID uuid = parseUuid(item.get("uuid").getAsString());
                    remote.put(uuid, new RemoteCape(
                        item.get("capeId").getAsString(),
                        item.get("textureRevision").getAsString()
                    ));
                }
            }

            Set<UUID> requested = new HashSet<>(requestedPlayers);
            for (UUID uuid : requested) {
                RemoteCape next = remote.get(uuid);
                if (next == null) {
                    assignments.remove(uuid);
                    continue;
                }
                String assetKey = next.capeId + ":" + next.revision;
                CapeAssignment current = assignments.get(uuid);
                if (current != null && current.assetKey.equals(assetKey) && current.texture != null) continue;
                assignments.put(uuid, new CapeAssignment(assetKey, null));
                loadTexture(next).thenAccept(identifier -> {
                    CapeAssignment latest = assignments.get(uuid);
                    if (latest != null && latest.assetKey.equals(assetKey)) {
                        latest.texture = identifier;
                    }
                });
            }
        } catch (Exception ignored) {
            // Ignore malformed remote data and keep the last known safe state.
        }
    }

    private CompletableFuture<Identifier> loadTexture(RemoteCape cape) {
        String key = cape.capeId + ":" + cape.revision;
        return textureLoads.computeIfAbsent(key, unused -> requestTexture(cape)
            .whenComplete((identifier, error) -> {
                if (error != null) textureLoads.remove(key);
            }));
    }

    private CompletableFuture<Identifier> requestTexture(RemoteCape cape) {
        String leaseUrl = API + "/v1/capes/" + URLEncoder.encode(cape.capeId, StandardCharsets.UTF_8) + "/texture";
        HttpRequest leaseRequest = HttpRequest.newBuilder(URI.create(leaseUrl))
            .timeout(Duration.ofSeconds(5))
            .header("Accept", "application/json")
            .header("User-Agent", "Bloom-Cosmetics/1.0.0")
            .GET()
            .build();
        return client.sendAsync(leaseRequest, HttpResponse.BodyHandlers.ofString())
            .thenCompose(leaseResponse -> {
                if (leaseResponse.statusCode() != 200) return CompletableFuture.failedFuture(new IllegalStateException("Cape lease unavailable"));
                JsonObject lease = JsonParser.parseString(leaseResponse.body()).getAsJsonObject();
                String revision = lease.get("revision").getAsString();
                if (!cape.revision.equals(revision)) return CompletableFuture.failedFuture(new IllegalStateException("Cape revision changed"));
                HttpRequest textureRequest = HttpRequest.newBuilder(URI.create(lease.get("url").getAsString()))
                    .timeout(Duration.ofSeconds(8))
                    .header("Accept", "image/png")
                    .header("User-Agent", "Bloom-Cosmetics/1.0.0")
                    .GET()
                    .build();
                return client.sendAsync(textureRequest, HttpResponse.BodyHandlers.ofByteArray());
            })
            .thenCompose(response -> {
                if (response.statusCode() != 200 || response.body().length > 8 * 1024 * 1024) {
                    return CompletableFuture.failedFuture(new IllegalStateException("Cape texture unavailable"));
                }
                try {
                    NativeImage image = NativeImage.read(response.body());
                    if (image.getWidth() != image.getHeight() * 2 || image.getWidth() < 64 || image.getWidth() > 2048) {
                        image.close();
                        return CompletableFuture.failedFuture(new IllegalStateException("Invalid cape dimensions"));
                    }
                    return registerTexture(cape, image);
                } catch (Exception error) {
                    return CompletableFuture.failedFuture(error);
                }
            });
    }

    private CompletableFuture<Identifier> registerTexture(RemoteCape cape, NativeImage image) {
        CompletableFuture<Identifier> result = new CompletableFuture<>();
        String safeRevision = cape.revision.toLowerCase().replaceAll("[^a-z0-9_.-]", "-");
        Identifier identifier = Identifier.of("bloom_cosmetics", "capes/" + cape.capeId + "/" + safeRevision);
        MinecraftClient minecraft = MinecraftClient.getInstance();
        minecraft.execute(() -> {
            try {
                NativeImageBackedTexture texture = new NativeImageBackedTexture(() -> "Bloom cape " + cape.capeId, image);
                minecraft.getTextureManager().registerTexture(identifier, texture);
                result.complete(identifier);
            } catch (Throwable error) {
                image.close();
                result.completeExceptionally(error);
            }
        });
        return result;
    }

    private static String compactUuid(UUID uuid) {
        return uuid.toString().replace("-", "").toLowerCase();
    }

    private static UUID parseUuid(String value) {
        String compact = value.replace("-", "").toLowerCase();
        if (compact.length() != 32) throw new IllegalArgumentException("Invalid UUID");
        return UUID.fromString(compact.substring(0, 8) + "-" + compact.substring(8, 12) + "-" + compact.substring(12, 16) + "-" + compact.substring(16, 20) + "-" + compact.substring(20));
    }

    private record RemoteCape(String capeId, String revision) {}

    private static final class CapeAssignment {
        private final String assetKey;
        private volatile Identifier texture;

        private CapeAssignment(String assetKey, Identifier texture) {
            this.assetKey = assetKey;
            this.texture = texture;
        }
    }
}
