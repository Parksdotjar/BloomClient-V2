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

import java.net.http.HttpResponse;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/** Live bracelet assignments; all network and decoding work stays off the render thread. */
public final class BloomBraceletService {
    private static final BloomBraceletService INSTANCE = new BloomBraceletService();

    private final ConcurrentHashMap<UUID, Long> observedPlayers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, BraceletAssignment> assignments = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<BloomCosmeticsRuntime.ModelTexture>> resources =
        new ConcurrentHashMap<>();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean refreshing = new AtomicBoolean();

    public static BloomBraceletService get() {
        return INSTANCE;
    }

    public void start() {
        if (!started.compareAndSet(false, true)) return;
        BloomCosmeticsRuntime.scheduleRefresh(this::refreshObservedPlayers);
    }

    public BraceletAsset assetFor(int entityId) {
        MinecraftClient minecraft = MinecraftClient.getInstance();
        if (minecraft.world == null) return null;
        Entity entity = minecraft.world.getEntityById(entityId);
        if (!(entity instanceof AbstractClientPlayerEntity player)) return null;

        UUID identity = BloomCosmeticsRuntime.stableIdentity(minecraft, player);
        BloomCosmeticsRuntime.observe(observedPlayers, identity);
        BraceletAssignment assignment = assignments.get(identity);
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
                BloomCosmeticsRuntime.equippedUrl("bracelets", players), "application/json", 5);
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
            Map<UUID, RemoteBracelet> remote = new HashMap<>();
            if (items != null) {
                for (JsonElement element : items) {
                    JsonObject item = element.getAsJsonObject();
                    JsonArray offset = item.getAsJsonArray("offset");
                    JsonArray rotation = item.getAsJsonArray("rotation");
                    JsonArray pivot = item.getAsJsonArray("pivot");
                    remote.put(
                        BloomCosmeticsRuntime.parseUuid(item.get("uuid").getAsString()),
                        new RemoteBracelet(
                            item.get("braceletId").getAsString(),
                            item.get("modelRevision").getAsString(),
                            item.get("textureRevision").getAsString(),
                            item.get("modelUrl").getAsString(),
                            item.get("textureUrl").getAsString(),
                            BloomCosmeticsRuntime.arrayFloat(offset, 0),
                            BloomCosmeticsRuntime.arrayFloat(offset, 1),
                            BloomCosmeticsRuntime.arrayFloat(offset, 2),
                            BloomCosmeticsRuntime.arrayFloat(rotation, 0),
                            BloomCosmeticsRuntime.arrayFloat(rotation, 1),
                            BloomCosmeticsRuntime.arrayFloat(rotation, 2),
                            BloomCosmeticsRuntime.arrayFloat(pivot, 0),
                            BloomCosmeticsRuntime.arrayFloat(pivot, 1),
                            BloomCosmeticsRuntime.arrayFloat(pivot, 2),
                            item.get("scale").getAsFloat(),
                            "left".equals(item.get("arm").getAsString())
                        )
                    );
                }
            }

            for (UUID uuid : requestedPlayers) {
                RemoteBracelet next = remote.get(uuid);
                if (next == null) {
                    assignments.remove(uuid);
                    continue;
                }

                String assignmentKey = assignmentKey(next);
                BraceletAssignment current = assignments.get(uuid);
                if (current != null && current.key.equals(assignmentKey) && current.asset != null) continue;

                assignments.put(uuid, new BraceletAssignment(
                    assignmentKey,
                    current == null ? null : current.asset
                ));
                loadAsset(next).thenAccept(asset -> {
                    BraceletAssignment latest = assignments.get(uuid);
                    if (latest != null && latest.key.equals(assignmentKey)) latest.asset = asset;
                }).exceptionally(error -> null);
            }
        } catch (Exception ignored) {
            // Keep the last safe assignment if a transient response is malformed.
        }
    }

    private CompletableFuture<BraceletAsset> loadAsset(RemoteBracelet bracelet) {
        return loadResource(bracelet).thenApply(resource -> new BraceletAsset(
            resource.mesh(),
            resource.texture(),
            bracelet.offsetX(),
            bracelet.offsetY(),
            bracelet.offsetZ(),
            bracelet.rotationX(),
            bracelet.rotationY(),
            bracelet.rotationZ(),
            bracelet.pivotX(),
            bracelet.pivotY(),
            bracelet.pivotZ(),
            bracelet.scale(),
            bracelet.leftArm()
        ));
    }

    private CompletableFuture<BloomCosmeticsRuntime.ModelTexture> loadResource(RemoteBracelet bracelet) {
        String key = resourceKey(bracelet);
        return resources.computeIfAbsent(key, unused -> BloomCosmeticsRuntime.loadModelTexture(
            "bracelets",
            bracelet.braceletId(),
            bracelet.textureRevision(),
            bracelet.modelUrl(),
            bracelet.textureUrl(),
            false
        ).whenComplete((resource, error) -> {
            if (error != null) resources.remove(key);
        }));
    }

    private static String resourceKey(RemoteBracelet bracelet) {
        return bracelet.braceletId() + ":" + bracelet.modelRevision() + ":" + bracelet.textureRevision();
    }

    private static String assignmentKey(RemoteBracelet bracelet) {
        return BloomCosmeticsRuntime.placementKey(
            resourceKey(bracelet),
            bracelet.offsetX(),
            bracelet.offsetY(),
            bracelet.offsetZ(),
            bracelet.rotationX(),
            bracelet.rotationY(),
            bracelet.rotationZ(),
            bracelet.pivotX(),
            bracelet.pivotY(),
            bracelet.pivotZ(),
            bracelet.scale(),
            bracelet.leftArm() ? 1.0f : 0.0f
        );
    }

    private record RemoteBracelet(
        String braceletId,
        String modelRevision,
        String textureRevision,
        String modelUrl,
        String textureUrl,
        float offsetX,
        float offsetY,
        float offsetZ,
        float rotationX,
        float rotationY,
        float rotationZ,
        float pivotX,
        float pivotY,
        float pivotZ,
        float scale,
        boolean leftArm
    ) {}

    private static final class BraceletAssignment {
        private final String key;
        private volatile BraceletAsset asset;

        private BraceletAssignment(String key, BraceletAsset asset) {
            this.key = key;
            this.asset = asset;
        }
    }

    public record BraceletAsset(
        BloomHatMesh mesh,
        Identifier texture,
        float offsetX,
        float offsetY,
        float offsetZ,
        float rotationX,
        float rotationY,
        float rotationZ,
        float pivotX,
        float pivotY,
        float pivotZ,
        float scale,
        boolean leftArm
    ) {}
}

//?}
