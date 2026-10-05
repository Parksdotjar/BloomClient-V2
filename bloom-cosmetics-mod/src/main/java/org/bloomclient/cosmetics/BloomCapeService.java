package org.bloomclient.cosmetics;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URLEncoder;
import java.net.URI;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.HexFormat;

public final class BloomCapeService {
    private static final Logger LOGGER = LoggerFactory.getLogger("Bloom Cosmetics");
    private static final BloomCapeService INSTANCE = new BloomCapeService();
    private static final int MAX_STATIC_BYTES = 40 * 1024 * 1024;
    private static final int MAX_ATLAS_BYTES = 32 * 1024 * 1024;

    private final ConcurrentHashMap<UUID, Long> observedPlayers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, CapeAssignment> assignments = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<LoadedCape>> capeLoads = new ConcurrentHashMap<>();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean refreshing = new AtomicBoolean();
    private final AtomicLong allocated = new AtomicLong();
    private volatile long nextRefresh;
    private int failures;

    public static BloomCapeService get() {
        return INSTANCE;
    }

    public void start() {
        if (!started.compareAndSet(false, true)) return;
        BloomCosmeticsRuntime.scheduleRefresh(this::refreshObservedPlayers);
        LOGGER.info("Bloom Cosmetics is ready for live static and animated cape updates.");
    }

    public Identifier textureFor(UUID uuid) {
        MinecraftClient minecraft = MinecraftClient.getInstance();
        UUID identity = BloomCosmeticsRuntime.stableIdentity(minecraft, uuid);
        BloomCosmeticsRuntime.observe(observedPlayers, identity);
        CapeAssignment assignment = assignments.get(identity);
        return assignment == null || assignment.cape == null ? null : assignment.cape.textureNow();
    }

    public Identifier elytraTextureFor(UUID uuid) {
        MinecraftClient minecraft = MinecraftClient.getInstance();
        UUID identity = BloomCosmeticsRuntime.stableIdentity(minecraft, uuid);
        BloomCosmeticsRuntime.observe(observedPlayers, identity);
        CapeAssignment assignment = assignments.get(identity);
        return assignment == null || assignment.cape == null ? null : assignment.cape.elytraNow();
    }

    private void refreshObservedPlayers() {
        if (System.currentTimeMillis() < nextRefresh) return;
        if (!refreshing.compareAndSet(false, true)) return;
        try {
            List<UUID> players = BloomCosmeticsRuntime.activePlayers(observedPlayers);
            if (MinecraftClient.getInstance().world == null) { observedPlayers.clear(); players = List.of(); }
            assignments.keySet().retainAll(players);
            BloomPresence.retain(players);
            var used = assignments.values().stream().map(value -> value.assetKey).collect(java.util.stream.Collectors.toSet());
            capeLoads.forEach((key, future) -> {
                if (!used.contains(key) && future.isDone() && capeLoads.remove(key, future)) {
                    future.thenAccept(LoadedCape::close);
                }
            });
            if (players.isEmpty()) {
                refreshing.set(false);
                return;
            }
            var request = BloomCosmeticsRuntime.get(
                BloomCosmeticsRuntime.equippedUrl("capes", players), "application/json", 5);
            final List<UUID> requestedPlayers = players;
            BloomCosmeticsRuntime.HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    if (response.statusCode() == 200 && response.body().length() <= 1024 * 1024) {
                        applyAssignments(requestedPlayers, response.body()); failures=0; nextRefresh=System.currentTimeMillis()+5_000;
                    } else backoff();
                })
                .exceptionally(error -> { backoff(); return null; })
                .whenComplete((unused, error) -> refreshing.set(false));
            return;
        } catch (Exception ignored) {
            // A temporary network failure should never affect Minecraft rendering.
        }
        refreshing.set(false);
    }

    private void backoff() { failures=Math.min(5,failures+1); nextRefresh=System.currentTimeMillis()+Math.min(60_000,2_000L<<failures); }

    private void applyAssignments(List<UUID> requestedPlayers, String body) {
        try {
            JsonArray items = JsonParser.parseString(body).getAsJsonObject().getAsJsonArray("items");
            Map<UUID, RemoteCape> remote = new HashMap<>();
            if (items != null) {
                for (JsonElement element : items) {
                    JsonObject item = element.getAsJsonObject();
                    UUID uuid = BloomCosmeticsRuntime.parseUuid(item.get("uuid").getAsString());
                    if (!requestedPlayers.contains(uuid)) continue;
                    BloomPresence.update(uuid,item.has("badgeVisible") && item.get("badgeVisible").getAsBoolean());
                    if (!item.has("capeId") || item.get("capeId").isJsonNull()) continue;
                    remote.put(uuid, new RemoteCape(
                        item.get("capeId").getAsString(),
                        item.get("textureRevision").getAsString(),
                        item.has("textureUrl") ? item.get("textureUrl").getAsString() : null,
                        item.get("textureSha256").getAsString(),
                        item.has("elytraUrl") && !item.get("elytraUrl").isJsonNull() ? item.get("elytraUrl").getAsString() : null,
                        item.has("elytraSha256") && !item.get("elytraSha256").isJsonNull() ? item.get("elytraSha256").getAsString() : null,
                        parseAnimation(item)
                    ));
                }
            }

            for (UUID uuid : requestedPlayers) {
                RemoteCape next = remote.get(uuid);
                if (next == null) {
                    assignments.remove(uuid);
                    continue;
                }
                String assetKey = next.assetKey();
                CapeAssignment current = assignments.get(uuid);
                if (current != null && current.assetKey.equals(assetKey) && current.cape != null) continue;
                assignments.put(uuid, new CapeAssignment(assetKey, null));
                loadCape(next).thenAccept(cape -> {
                    CapeAssignment latest = assignments.get(uuid);
                    if (latest != null && latest.assetKey.equals(assetKey)) latest.cape = cape;
                }).exceptionally(error -> null);
            }
        } catch (Exception ignored) {
            // Ignore malformed remote data and keep the last known safe state.
        }
    }

    private RemoteAnimation parseAnimation(JsonObject item) {
        if (!item.has("animation") || item.get("animation").isJsonNull()) return null;
        JsonObject value = item.getAsJsonObject("animation");
        return new RemoteAnimation(
            value.get("revision").getAsString(),
            value.get("atlasUrl").getAsString(),
            value.get("sha256").getAsString(),
            value.get("frameCount").getAsInt(),
            value.get("columns").getAsInt(),
            value.get("rows").getAsInt(),
            value.get("frameWidth").getAsInt(),
            value.get("frameHeight").getAsInt(),
            value.get("fps").getAsDouble(),
            !value.has("loop") || value.get("loop").getAsBoolean()
        );
    }

    private CompletableFuture<LoadedCape> loadCape(RemoteCape cape) {
        return capeLoads.computeIfAbsent(cape.assetKey(), unused -> requestCape(cape)
            .whenComplete((loaded, error) -> {
                if (error != null) capeLoads.remove(cape.assetKey());
            }));
    }

    private CompletableFuture<LoadedCape> requestCape(RemoteCape cape) {
        CompletableFuture<LoadedCape> loaded;
        if (cape.animation != null) {
            loaded = requestAnimatedCape(cape, cape.animation)
                .exceptionallyCompose(error -> requestStaticCape(cape));
        } else loaded = requestStaticCape(cape);
        if (cape.elytraUrl == null || cape.elytraSha256 == null) return loaded;
        return loaded.thenCompose(value -> requestElytra(cape).thenApply(asset -> {
            value.attachElytra(asset.identifier, asset.size);
            return value;
        }).exceptionally(error -> value));
    }

    private CompletableFuture<LoadedTexture> requestElytra(RemoteCape cape) {
        if (!safeAssetUrl(cape.elytraUrl)) return CompletableFuture.failedFuture(new IllegalStateException("Untrusted elytra asset URL"));
        var request = BloomCosmeticsRuntime.get(cape.elytraUrl, "image/png", 8);
        return BloomCosmeticsRuntime.HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofInputStream())
            .thenCompose(response -> decodeElytraResponse(cape, response.statusCode(), readBounded(response.body(), MAX_STATIC_BYTES)));
    }

    private CompletableFuture<LoadedCape> requestAnimatedCape(RemoteCape cape, RemoteAnimation animation) {
        if (!safeAssetUrl(animation.atlasUrl)) return CompletableFuture.failedFuture(new IllegalStateException("Untrusted cape asset URL"));
        var request = BloomCosmeticsRuntime.get(animation.atlasUrl, "image/png", 12);
        return BloomCosmeticsRuntime.HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofInputStream())
            .thenCompose(response -> decodeAnimationResponse(cape, animation, response.statusCode(), readBounded(response.body(), MAX_ATLAS_BYTES)));
    }

    private CompletableFuture<LoadedCape> requestStaticCape(RemoteCape cape) {
        if (cape.textureUrl != null && !cape.textureUrl.isBlank()) {
            if (!safeAssetUrl(cape.textureUrl)) return CompletableFuture.failedFuture(new IllegalStateException("Untrusted cape asset URL"));
            var request = BloomCosmeticsRuntime.get(cape.textureUrl, "image/png", 8);
            return BloomCosmeticsRuntime.HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofInputStream())
                .thenCompose(response -> decodeStaticResponse(cape, response.statusCode(), readBounded(response.body(), MAX_STATIC_BYTES)));
        }
        String leaseUrl = BloomCosmeticsRuntime.API_BASE + "/v1/capes/"
            + URLEncoder.encode(cape.capeId, StandardCharsets.UTF_8) + "/texture";
        var leaseRequest = BloomCosmeticsRuntime.get(leaseUrl, "application/json", 5);
        return BloomCosmeticsRuntime.HTTP.sendAsync(leaseRequest, HttpResponse.BodyHandlers.ofString())
            .thenCompose(leaseResponse -> {
                if (leaseResponse.statusCode() != 200) return CompletableFuture.failedFuture(new IllegalStateException("Cape lease unavailable"));
                JsonObject lease = JsonParser.parseString(leaseResponse.body()).getAsJsonObject();
                if (!cape.revision.equals(lease.get("revision").getAsString())) {
                    return CompletableFuture.failedFuture(new IllegalStateException("Cape revision changed"));
                }
                String url=lease.get("url").getAsString();
                if (!safeAssetUrl(url)) return CompletableFuture.failedFuture(new IllegalStateException("Untrusted cape asset URL"));
                var textureRequest = BloomCosmeticsRuntime.get(url, "image/png", 8);
                return BloomCosmeticsRuntime.HTTP.sendAsync(textureRequest, HttpResponse.BodyHandlers.ofInputStream());
            })
            .thenCompose(response -> decodeStaticResponse(cape, response.statusCode(), readBounded(response.body(), MAX_STATIC_BYTES)));
    }

    private static byte[] readBounded(InputStream input, int limit) {
        try (input) { byte[] bytes=input.readNBytes(limit+1); if(bytes.length>limit) throw new IllegalStateException("Cape exceeds download limit"); return bytes; }
        catch (Exception error) { throw new java.util.concurrent.CompletionException(error); }
    }

    private static boolean safePng(byte[] bytes, int maxWidth, int maxHeight) {
        if(bytes.length<33 || ByteBuffer.wrap(bytes).getLong()!=0x89504e470d0a1a0aL) return false;
        int width=ByteBuffer.wrap(bytes,16,4).getInt(),height=ByteBuffer.wrap(bytes,20,4).getInt();
        return width>0 && height>0 && width<=maxWidth && height<=maxHeight;
    }

    private static boolean safeAssetUrl(String value) {
        try {
            URI uri=URI.create(value);
            return "https".equalsIgnoreCase(uri.getScheme())
                && "api.north.bloomclient.org".equalsIgnoreCase(uri.getHost())
                && uri.getUserInfo()==null && uri.getPort()==-1
                && uri.getPath().startsWith("/minecraft/v1/capes/");
        } catch (Exception ignored) { return false; }
    }

    private static boolean sha256(byte[] bytes, String expected) {
        if (expected==null || !expected.matches("[a-f0-9]{64}")) return false;
        try { return MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(bytes),HexFormat.of().parseHex(expected)); }
        catch (Exception ignored) { return false; }
    }

    private boolean reserve(long bytes) {
        long value=allocated.addAndGet(bytes);
        if(value>128L*1024*1024) { allocated.addAndGet(-bytes); return false; }
        return true;
    }

    private CompletableFuture<LoadedCape> decodeStaticResponse(RemoteCape cape, int status, byte[] bytes) {
        if (status != 200 || !sha256(bytes,cape.textureSha256) || !safePng(bytes,4096,2048)) {
            return CompletableFuture.failedFuture(new IllegalStateException("Cape texture unavailable"));
        }
        try {
            NativeImage image = NativeImage.read(bytes);
            if (!validFrameDimensions(image.getWidth(), image.getHeight())) {
                image.close();
                return CompletableFuture.failedFuture(new IllegalStateException("Invalid cape dimensions"));
            }
            long size=(long)image.getWidth()*image.getHeight()*4;
            if(!reserve(size)) { image.close(); return CompletableFuture.failedFuture(new IllegalStateException("Cape memory budget reached")); }
            return BloomCosmeticsRuntime.registerTexture(
                    "capes", cape.capeId, cape.revision, "Bloom cape " + cape.capeId, image)
                .thenApply(identifier -> new LoadedCape(List.of(identifier),0,false,size,allocated))
                .whenComplete((result,error)->{if(error!=null)allocated.addAndGet(-size);});
        } catch (Exception error) {
            return CompletableFuture.failedFuture(error);
        }
    }

    private CompletableFuture<LoadedTexture> decodeElytraResponse(RemoteCape cape, int status, byte[] bytes) {
        if (status != 200 || !sha256(bytes,cape.elytraSha256) || !safePng(bytes,4096,2048)) {
            return CompletableFuture.failedFuture(new IllegalStateException("Elytra texture unavailable"));
        }
        try {
            NativeImage image = NativeImage.read(bytes);
            if (!validFrameDimensions(image.getWidth(), image.getHeight())) {
                image.close();
                return CompletableFuture.failedFuture(new IllegalStateException("Invalid elytra dimensions"));
            }
            long size=(long)image.getWidth()*image.getHeight()*4;
            if(!reserve(size)) { image.close(); return CompletableFuture.failedFuture(new IllegalStateException("Cape memory budget reached")); }
            return BloomCosmeticsRuntime.registerTexture(
                    "elytra", cape.capeId, cape.revision, "Bloom elytra " + cape.capeId, image)
                .thenApply(identifier -> new LoadedTexture(identifier,size))
                .whenComplete((result,error)->{if(error!=null)allocated.addAndGet(-size);});
        } catch (Exception error) {
            return CompletableFuture.failedFuture(error);
        }
    }

    private CompletableFuture<LoadedCape> decodeAnimationResponse(
        RemoteCape cape,
        RemoteAnimation animation,
        int status, byte[] bytes
    ) {
        if (status != 200 || !animation.valid() || !sha256(bytes,animation.sha256) || !safePng(bytes,4096,4096)) {
            return CompletableFuture.failedFuture(new IllegalStateException("Cape animation unavailable"));
        }
        NativeImage atlas;
        try {
            atlas = NativeImage.read(bytes);
        } catch (Exception error) {
            return CompletableFuture.failedFuture(error);
        }
        if (atlas.getWidth() != animation.columns * animation.frameWidth
            || atlas.getHeight() != animation.rows * animation.frameHeight
            || atlas.getWidth() > 4096 || atlas.getHeight() > 4096) {
            atlas.close();
            return CompletableFuture.failedFuture(new IllegalStateException("Invalid cape animation atlas"));
        }

        List<CompletableFuture<Identifier>> registrations = new ArrayList<>(animation.frameCount);
        long size=(long)animation.frameWidth*animation.frameHeight*animation.frameCount*4;
        if(!reserve(size)) { atlas.close(); return CompletableFuture.failedFuture(new IllegalStateException("Cape memory budget reached")); }
        try {
            for (int index = 0; index < animation.frameCount; index++) {
                int sourceX = (index % animation.columns) * animation.frameWidth;
                int sourceY = (index / animation.columns) * animation.frameHeight;
                NativeImage frame = new NativeImage(animation.frameWidth, animation.frameHeight, true);
                for (int y = 0; y < animation.frameHeight; y++) {
                    for (int x = 0; x < animation.frameWidth; x++) {
                        frame.setColorArgb(x, y, atlas.getColorArgb(sourceX + x, sourceY + y));
                    }
                }
                registrations.add(BloomCosmeticsRuntime.registerTexture(
                    "capes", cape.capeId,
                    animation.revision + "-frame-" + index,
                    "Bloom animated cape " + cape.capeId + " frame " + index,
                    frame
                ));
            }
        } catch (Throwable error) {
            atlas.close();
            allocated.addAndGet(-size);
            registrations.forEach(future->future.thenAccept(BloomCapeService::destroyTexture));
            return CompletableFuture.failedFuture(error);
        }
        atlas.close();
        return CompletableFuture.allOf(registrations.toArray(CompletableFuture[]::new))
            .thenApply(unused -> new LoadedCape(
                registrations.stream().map(CompletableFuture::join).toList(),
                animation.fps,
                animation.loop, size, allocated
            )).whenComplete((result,error)->{
                if(error!=null) { allocated.addAndGet(-size); registrations.forEach(future->future.thenAccept(BloomCapeService::destroyTexture)); }
            });
    }

    private boolean validFrameDimensions(int width, int height) {
        return width == height * 2 && width >= 64 && width <= 4096
            && height >= 32 && height <= 2048 && width % 64 == 0 && height % 32 == 0;
    }

    private record RemoteCape(String capeId, String revision, String textureUrl, String textureSha256, String elytraUrl, String elytraSha256, RemoteAnimation animation) {
        private String assetKey() {
            return capeId + ":" + revision + (animation == null ? "" : ":animated:" + animation.revision);
        }
    }

    private record RemoteAnimation(
        String revision,
        String atlasUrl,
        String sha256,
        int frameCount,
        int columns,
        int rows,
        int frameWidth,
        int frameHeight,
        double fps,
        boolean loop
    ) {
        private boolean valid() {
            return revision != null && !revision.isBlank() && atlasUrl != null && !atlasUrl.isBlank()
                && sha256 != null && sha256.matches("[a-f0-9]{64}")
                && frameCount >= 1 && frameCount <= 120 && columns >= 1 && rows >= 1
                && columns * rows >= frameCount && frameWidth >= 64 && frameWidth <= 2048
                && frameHeight >= 32 && frameHeight <= 1024 && frameWidth == frameHeight * 2
                && frameWidth % 64 == 0 && frameHeight % 32 == 0
                && (long)frameWidth * frameHeight * frameCount * 4 <= 32L * 1024 * 1024
                && (long)columns * frameWidth <= 4096 && (long)rows * frameHeight <= 4096
                && Double.isFinite(fps) && fps >= 1.0 && fps <= 30.0;
        }
    }

    private static final class LoadedCape {
        private final List<Identifier> frames;
        private final double fps;
        private final boolean loop;
        private final long startedAtNanos = System.nanoTime();
        private final AtomicLong size;
        private final AtomicLong allocated;
        private final AtomicBoolean closed = new AtomicBoolean();
        private volatile Identifier elytra;

        private LoadedCape(List<Identifier> frames, double fps, boolean loop, long size, AtomicLong allocated) {
            this.frames = frames;
            this.fps = fps;
            this.loop = loop;
            this.size = new AtomicLong(size); this.allocated = allocated;
        }

        private void attachElytra(Identifier identifier, long bytes) {
            if (closed.get()) { destroyTexture(identifier); allocated.addAndGet(-bytes); return; }
            elytra = identifier;
            size.addAndGet(bytes);
        }

        private void close() {
            if(!closed.compareAndSet(false,true))return;
            frames.forEach(BloomCapeService::destroyTexture);
            if (elytra != null && !frames.contains(elytra)) destroyTexture(elytra);
            allocated.addAndGet(-size.get());
        }

        private Identifier textureNow() {
            if(closed.get()) return null;
            if (frames.size() == 1 || fps <= 0.0) return frames.getFirst();
            long elapsedNanos = Math.max(0L, System.nanoTime() - startedAtNanos);
            long frame = (long) Math.floor(elapsedNanos / 1_000_000_000.0 * fps);
            int index = loop ? (int) (frame % frames.size()) : (int) Math.min(frame, frames.size() - 1L);
            return frames.get(index);
        }

        private Identifier elytraNow() { return !closed.get() && elytra != null ? elytra : textureNow(); }
    }

    private record LoadedTexture(Identifier identifier, long size) {}

    private static void destroyTexture(Identifier id) {
        MinecraftClient client=MinecraftClient.getInstance();
        client.execute(()->client.getTextureManager().destroyTexture(id));
    }

    private static final class CapeAssignment {
        private final String assetKey;
        private volatile LoadedCape cape;

        private CapeAssignment(String assetKey, LoadedCape cape) {
            this.assetKey = assetKey;
            this.cape = cape;
        }
    }
}
