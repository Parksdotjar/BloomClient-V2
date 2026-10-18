package org.bloomclient.cosmetics;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.texture.NativeImageBackedTexture;
import net.minecraft.util.Identifier;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Shared, low-overhead infrastructure for every live Bloom cosmetic type. */
final class BloomCosmeticsRuntime {
    static final String API_BASE = "https://api.north.bloomclient.org/minecraft";
    static final String USER_AGENT = "Bloom-Cosmetics/1.5.0";
    static final long ACTIVE_PLAYER_WINDOW_MS = 20_000L;
    static final HttpClient HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(4))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build();

    private static final ScheduledExecutorService REFRESH_WORKER = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "Bloom-Cosmetics-Refresh");
        thread.setDaemon(true);
        thread.setPriority(Thread.MIN_PRIORITY);
        return thread;
    });

    private BloomCosmeticsRuntime() {}

    static void scheduleRefresh(Runnable refresh) {
        REFRESH_WORKER.scheduleWithFixedDelay(refresh, 0, 2, TimeUnit.SECONDS);
    }

    static void observe(ConcurrentHashMap<UUID, Long> observedPlayers, UUID uuid) {
        long now = System.currentTimeMillis();
        observedPlayers.compute(uuid, (ignored, lastSeen) ->
            lastSeen == null || now - lastSeen >= 1_000L ? now : lastSeen);
    }

    static List<UUID> activePlayers(ConcurrentHashMap<UUID, Long> observedPlayers) {
        long cutoff = System.currentTimeMillis() - ACTIVE_PLAYER_WINDOW_MS;
        observedPlayers.entrySet().removeIf(entry -> entry.getValue() < cutoff);
        return observedPlayers.keySet().stream().limit(100).toList();
    }

    static UUID stableIdentity(MinecraftClient minecraft, AbstractClientPlayerEntity player) {
        return stableIdentity(minecraft, player.getUuid(), player == minecraft.player);
    }

    static UUID stableIdentity(MinecraftClient minecraft, UUID entityUuid) {
        boolean localPlayer = minecraft.player != null && minecraft.player.getUuid().equals(entityUuid);
        return stableIdentity(minecraft, entityUuid, localPlayer);
    }

    private static UUID stableIdentity(MinecraftClient minecraft, UUID entityUuid, boolean localPlayer) {
        if (!localPlayer) return entityUuid;
        UUID accountUuid = minecraft.getSession().getUuidOrNull();
        return accountUuid == null ? entityUuid : accountUuid;
    }

    static HttpRequest get(String url, String accept, int timeoutSeconds) {
        return HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofSeconds(timeoutSeconds))
            .header("Accept", accept)
            .header("User-Agent", USER_AGENT)
            .GET()
            .build();
    }

    static String equippedUrl(String category, List<UUID> players) {
        String joined = players.stream().map(BloomCosmeticsRuntime::compactUuid)
            .reduce((left, right) -> left + "," + right).orElse("");
        return API_BASE + "/v1/" + category + "/equipped?uuids="
            + URLEncoder.encode(joined, StandardCharsets.UTF_8);
    }

    static CompletableFuture<Identifier> registerTexture(
        String category,
        String cosmeticId,
        String revision,
        String displayName,
        NativeImage image
    ) {
        CompletableFuture<Identifier> result = new CompletableFuture<>();
        Identifier identifier = Identifier.of(
            "bloom_cosmetics",
            safePath(category) + "/" + safePath(cosmeticId) + "/" + safePath(revision)
        );
        MinecraftClient minecraft = MinecraftClient.getInstance();
        minecraft.execute(() -> {
            try {
                minecraft.getTextureManager().registerTexture(
                    identifier,
                    new NativeImageBackedTexture(() -> displayName, image)
                );
                result.complete(identifier);
            } catch (Throwable error) {
                image.close();
                result.completeExceptionally(error);
            }
        });
        return result;
    }

    //? if <26.1 {
    static CompletableFuture<ModelTexture> loadModelTexture(
        String category,
        String cosmeticId,
        String textureRevision,
        String modelUrl,
        String textureUrl,
        boolean wingModel
    ) {
        return downloadModel(modelUrl, category, wingModel).thenCombine(
            downloadTexture(category, cosmeticId, textureRevision, textureUrl),
            ModelTexture::new
        );
    }

    private static CompletableFuture<BloomHatMesh> downloadModel(
        String url,
        String category,
        boolean wingModel
    ) {
        return HTTP.sendAsync(get(url, "application/json", 8), HttpResponse.BodyHandlers.ofByteArray())
            .thenCompose(response -> {
                if (response.statusCode() != 200 || response.body().length > 2 * 1024 * 1024) {
                    return CompletableFuture.failedFuture(
                        new IllegalStateException(category + " model unavailable")
                    );
                }
                try {
                    String source = new String(response.body(), StandardCharsets.UTF_8);
                    BloomHatMesh mesh = wingModel
                        ? BloomHatMesh.parseWing(source)
                        : BloomHatMesh.parse(source);
                    return CompletableFuture.completedFuture(mesh);
                } catch (Exception error) {
                    return CompletableFuture.failedFuture(error);
                }
            });
    }

    private static CompletableFuture<Identifier> downloadTexture(
        String category,
        String cosmeticId,
        String textureRevision,
        String url
    ) {
        return HTTP.sendAsync(get(url, "image/png", 8), HttpResponse.BodyHandlers.ofByteArray())
            .thenCompose(response -> {
                if (response.statusCode() != 200 || response.body().length > 8 * 1024 * 1024) {
                    return CompletableFuture.failedFuture(
                        new IllegalStateException(category + " texture unavailable")
                    );
                }
                try {
                    NativeImage image = NativeImage.read(response.body());
                    if (image.getWidth() < 1 || image.getHeight() < 1
                        || image.getWidth() > 4096 || image.getHeight() > 4096) {
                        image.close();
                        return CompletableFuture.failedFuture(
                            new IllegalStateException("Invalid " + category + " texture dimensions")
                        );
                    }
                    return registerTexture(
                        category,
                        cosmeticId,
                        textureRevision,
                        "Bloom " + category + " " + cosmeticId,
                        image
                    );
                } catch (Exception error) {
                    return CompletableFuture.failedFuture(error);
                }
            });
    }

    //?}

    static String compactUuid(UUID uuid) {
        return uuid.toString().replace("-", "").toLowerCase(Locale.ROOT);
    }

    static UUID parseUuid(String value) {
        String compact = value.replace("-", "").toLowerCase(Locale.ROOT);
        if (compact.length() != 32) throw new IllegalArgumentException("Invalid UUID");
        return UUID.fromString(compact.substring(0, 8) + "-" + compact.substring(8, 12) + "-"
            + compact.substring(12, 16) + "-" + compact.substring(16, 20) + "-" + compact.substring(20));
    }

    static float arrayFloat(com.google.gson.JsonArray values, int index) {
        return values == null || values.size() <= index ? 0.0f : values.get(index).getAsFloat();
    }

    static String placementKey(String resourceKey, float... values) {
        StringBuilder key = new StringBuilder(resourceKey);
        for (float value : values) key.append(':').append(Float.floatToIntBits(value));
        return key.toString();
    }

    private static String safePath(String value) {
        return value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_.-]", "-");
    }

    //? if <26.1 {
    record ModelTexture(BloomHatMesh mesh, Identifier texture) {}
    //?}
}
