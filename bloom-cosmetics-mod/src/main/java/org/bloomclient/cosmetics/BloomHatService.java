//? if <26.1 {
package org.bloomclient.cosmetics;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.entity.Entity;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.http.HttpResponse;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

public final class BloomHatService {
    private static final Logger LOGGER = LoggerFactory.getLogger("Bloom Cosmetics");
    private static final BloomHatService INSTANCE = new BloomHatService();

    private final ConcurrentHashMap<UUID, Long> observedPlayers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, HatAssignment> assignments = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<BloomCosmeticsRuntime.ModelTexture>> resources =
        new ConcurrentHashMap<>();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean refreshing = new AtomicBoolean();

    public static BloomHatService get() {
        return INSTANCE;
    }

    public void start() {
        if (!started.compareAndSet(false, true)) return;
        BloomCosmeticsRuntime.scheduleRefresh(this::refreshObservedPlayers);
        LOGGER.info("Bloom Cosmetics is ready for live 3D hat updates.");
    }

    public HatAsset assetFor(int entityId) {
        MinecraftClient minecraft = MinecraftClient.getInstance();
        if (minecraft.world == null) return null;
        Entity entity = minecraft.world.getEntityById(entityId);
        if (!(entity instanceof AbstractClientPlayerEntity player)) return null;

        UUID identity = BloomCosmeticsRuntime.stableIdentity(minecraft, player);
        BloomCosmeticsRuntime.observe(observedPlayers, identity);
        HatAssignment assignment = assignments.get(identity);
        return assignment == null ? null : assignment.asset;
    }

    private void refreshObservedPlayers() {
        if (!refreshing.compareAndSet(false, true)) return;
        try {
            List<UUID> players = BloomCosmeticsRuntime.activePlayers(observedPlayers);
            if (players.isEmpty()) {
                refreshing.set(false);
                return;
            }

            var request = BloomCosmeticsRuntime.get(
                BloomCosmeticsRuntime.equippedUrl("hats", players), "application/json", 5);
            BloomCosmeticsRuntime.HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    if (response.statusCode() == 200) applyAssignments(players, response.body());
                })
                .exceptionally(error -> null)
                .whenComplete((unused, error) -> refreshing.set(false));
            return;
        } catch (Exception ignored) {
            // Temporary service failures must never affect rendering.
        }
        refreshing.set(false);
    }

    private void applyAssignments(List<UUID> requestedPlayers, String body) {
        try {
            JsonArray items = JsonParser.parseString(body).getAsJsonObject().getAsJsonArray("items");
            Map<UUID, RemoteHat> remote = new HashMap<>();
            if (items != null) {
                for (JsonElement element : items) {
                    JsonObject item = element.getAsJsonObject();
                    JsonArray offset = item.getAsJsonArray("offset");
                    remote.put(BloomCosmeticsRuntime.parseUuid(item.get("uuid").getAsString()), new RemoteHat(
                        item.get("hatId").getAsString(),
                        item.get("modelRevision").getAsString(),
                        item.get("textureRevision").getAsString(),
                        item.get("modelUrl").getAsString(),
                        item.get("textureUrl").getAsString(),
                        BloomCosmeticsRuntime.arrayFloat(offset, 0),
                        BloomCosmeticsRuntime.arrayFloat(offset, 1),
                        BloomCosmeticsRuntime.arrayFloat(offset, 2),
                        item.get("scale").getAsFloat(),
                        item.get("hideWithHelmet").getAsBoolean()
                    ));
                }
            }

            for (UUID uuid : requestedPlayers) {
                RemoteHat next = remote.get(uuid);
                if (next == null) {
                    assignments.remove(uuid);
                    continue;
                }

                String assignmentKey = assignmentKey(next);
                HatAssignment current = assignments.get(uuid);
                if (current != null && current.key.equals(assignmentKey) && current.asset != null) continue;

                assignments.put(uuid, new HatAssignment(
                    assignmentKey,
                    current == null ? null : current.asset
                ));
                loadAsset(next).thenAccept(asset -> {
                    HatAssignment latest = assignments.get(uuid);
                    if (latest != null && latest.key.equals(assignmentKey)) latest.asset = asset;
                }).exceptionally(error -> null);
            }
        } catch (Exception ignored) {
            // Keep the last safe assignment if a transient response is malformed.
        }
    }

    private CompletableFuture<HatAsset> loadAsset(RemoteHat hat) {
        return loadResource(hat).thenApply(resource -> new HatAsset(
            resource.mesh(),
            resource.texture(),
            hat.offsetX(),
            hat.offsetY(),
            hat.offsetZ(),
            hat.scale(),
            hat.hideWithHelmet()
        ));
    }

    private CompletableFuture<BloomCosmeticsRuntime.ModelTexture> loadResource(RemoteHat hat) {
        String key = resourceKey(hat);
        return resources.computeIfAbsent(key, unused -> BloomCosmeticsRuntime.loadModelTexture(
            "hats",
            hat.hatId(),
            hat.textureRevision(),
            hat.modelUrl(),
            hat.textureUrl(),
            false
        ).whenComplete((resource, error) -> {
            if (error != null) resources.remove(key);
        }));
    }

    private static String resourceKey(RemoteHat hat) {
        return hat.hatId() + ":" + hat.modelRevision() + ":" + hat.textureRevision();
    }

    private static String assignmentKey(RemoteHat hat) {
        return BloomCosmeticsRuntime.placementKey(
            resourceKey(hat),
            hat.offsetX(),
            hat.offsetY(),
            hat.offsetZ(),
            hat.scale(),
            hat.hideWithHelmet() ? 1.0f : 0.0f
        );
    }

    private record RemoteHat(
        String hatId,
        String modelRevision,
        String textureRevision,
        String modelUrl,
        String textureUrl,
        float offsetX,
        float offsetY,
        float offsetZ,
        float scale,
        boolean hideWithHelmet
    ) {}

    private static final class HatAssignment {
        private final String key;
        private volatile HatAsset asset;

        private HatAssignment(String key, HatAsset asset) {
            this.key = key;
            this.asset = asset;
        }
    }

    public record HatAsset(
        BloomHatMesh mesh,
        Identifier texture,
        float offsetX,
        float offsetY,
        float offsetZ,
        float scale,
        boolean hideWithHelmet
    ) {}
}

//?}
