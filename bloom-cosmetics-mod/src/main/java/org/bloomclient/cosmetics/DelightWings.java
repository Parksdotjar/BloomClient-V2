package org.bloomclient.cosmetics;

import com.google.gson.Gson;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

public final class DelightWings {
    private static final Logger LOG = LoggerFactory.getLogger("Delight Wings");
    private static final Gson JSON = new Gson();
    private static final UUID PREVIEW_PLAYER = UUID.nameUUIDFromBytes(
        "OfflinePlayer:DelightPreview".getBytes(StandardCharsets.UTF_8));
    private static final String PREVIEW_BASE = "http://127.0.0.1:19192";
    private static final DelightWings INSTANCE = new DelightWings(false);
    private static final DelightWings HATS = new DelightWings(true);
    private final boolean hat;

    private DelightWings(boolean hat) { this.hat = hat; }
    private final boolean localPreview = "1".equals(System.getenv("DELIGHT_WINGS_GAME_PREVIEW"));
    private final ConcurrentHashMap<UUID, Long> observed = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<Renderable>> loaded = new ConcurrentHashMap<>();
    private final EquipmentSource liveEquipment = new EquipmentSource();
    private final EquipmentSource previewEquipment = new EquipmentSource();
    private Map<String, DelightWingData.Item> catalog = Map.of();

    private static final class EquipmentSource {
        private final AtomicBoolean refreshing = new AtomicBoolean();
        private volatile Map<UUID, Selection> equipment = Map.of();
        private long lastSuccess;
    }

    private record Selection(String uuid, String id, String revision, DelightWingData.Colors colors) {}
    private record Response(List<Selection> items) {}
    private record Renderable(DelightWingData.Model model, Map<String, Identifier> textures) {}
    record Equipped(DelightWingData.Model model, Map<String, Identifier> textures, DelightWingData.Colors colors) {}

    public static DelightWings get() { return INSTANCE; }
    static DelightWings hats() { return HATS; }

    public static boolean rendersOnEntity(int entityId) {
        return DelightWingLayer.equipped(entityId) != null;
    }

    public void start() {
        try {
            Map<String, DelightWingData.Item> matching = new HashMap<>();
            DelightWingData.catalog().forEach((key, item) -> {
                if (item.hat() == hat) matching.put(key, item);
            });
            catalog = Map.copyOf(matching);
        }
        catch (IOException | RuntimeException error) { LOG.warn("Could not load the bundled wing catalog"); }
        if (!catalog.isEmpty()) BloomCosmeticsRuntime.scheduleRefresh(this::refresh);
    }

    Equipped forPlayer(UUID id, boolean ownPlayer) {
        if (catalog.isEmpty()) return null;
        // The local Locker uses a fixed preview identity, even for an authenticated game session.
        boolean usePreview = localPreview && ownPlayer;
        if (!usePreview) BloomCosmeticsRuntime.observe(observed, id);
        Selection selected = usePreview ? previewEquipment.equipment.get(PREVIEW_PLAYER) : liveEquipment.equipment.get(id);
        CompletableFuture<Renderable> future = selected == null ? null : loaded.get(selected.revision);
        if (future == null || !future.isDone() || future.isCompletedExceptionally()) return null;
        Renderable asset = future.getNow(null);
        return asset == null ? null : new Equipped(asset.model, asset.textures, selected.colors);
    }

    private void refresh() {
        refresh(liveEquipment, BloomCosmeticsRuntime.API_BASE, BloomCosmeticsRuntime.activePlayers(observed));
        if (localPreview) refresh(previewEquipment, PREVIEW_BASE, List.of(PREVIEW_PLAYER));
    }

    private void refresh(EquipmentSource source, String base, List<UUID> players) {
        if (!source.refreshing.compareAndSet(false, true)) return;
        if (players.isEmpty()) {
            source.equipment = Map.of();
            source.refreshing.set(false);
            return;
        }
        String remoteUrl = BloomCosmeticsRuntime.equippedUrl(hat ? "hats" : "wings", players);
        String url = base + remoteUrl.substring(BloomCosmeticsRuntime.API_BASE.length());
        final var request = BloomCosmeticsRuntime.get(url, "application/json", 5);
        CapeHttp.get(request, 64 * 1024)
            .whenComplete((response, error) -> {
                try {
                    if (error == null && response.statusCode() == 200) {
                        Response result = JSON.fromJson(new String(response.body(), StandardCharsets.UTF_8), Response.class);
                        source.equipment = readEquipment(players, result);
                        source.lastSuccess = System.currentTimeMillis();
                    }
                } catch (RuntimeException ignored) {
                    // A stale assignment expires after a short transient outage.
                } finally {
                    if (System.currentTimeMillis() - source.lastSuccess > 20_000) source.equipment = Map.of();
                    source.refreshing.set(false);
                }
            });
    }

    private Map<UUID, Selection> readEquipment(List<UUID> asked, Response result) {
        Map<UUID, Selection> next = new HashMap<>();
        if (result == null || result.items == null || result.items.size() > 100)
            throw new IllegalArgumentException("Invalid Wings equipment response");
        for (Selection selected : result.items) {
            UUID player = BloomCosmeticsRuntime.parseUuid(selected.uuid);
            var item = catalog.get(selected.revision);
            if (!asked.contains(player) || item == null || !item.id().equals(selected.id)) continue;
            if (selected.colors == null) continue;
            selected.colors.validate(hat);
            if ("back".equals(item.slot())) { selected.colors.forTint("rightOuter"); selected.colors.forTint("plunger"); }
            next.put(player, selected);
            loaded.computeIfAbsent(item.revision(), unused -> load(item));
        }
        return Map.copyOf(next);
    }

    private CompletableFuture<Renderable> load(DelightWingData.Item item) {
        try {
            var asset = DelightWingData.read(item);
            Map<String, CompletableFuture<Identifier>> textures = new HashMap<>();
            for (var image : asset.textures().entrySet()) {
                NativeImage png = NativeImage.read(new ByteArrayInputStream(image.getValue()));
                textures.put(image.getKey(), BloomCosmeticsRuntime.registerTexture(
                    "delight-wings", item.id(), item.revision() + "/" + image.getKey(), item.name(), png));
            }
            var all = CompletableFuture.allOf(textures.values().toArray(CompletableFuture[]::new));
            return all.thenApply(unused -> {
                Map<String, Identifier> result = new HashMap<>();
                textures.forEach((name, future) -> result.put(name, future.join()));
                return new Renderable(asset.model(), Map.copyOf(result));
            });
        } catch (IOException | RuntimeException error) {
            LOG.warn("Could not load a validated wing revision");
            return CompletableFuture.failedFuture(error);
        }
    }
}
