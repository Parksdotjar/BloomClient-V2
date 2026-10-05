package org.bloomclient.cosmetics;

import net.minecraft.client.MinecraftClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URI;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

public final class BloomPresence {
    private static final ConcurrentHashMap<UUID,Long> BADGES = new ConcurrentHashMap<>();
    private static final AtomicBoolean BUSY = new AtomicBoolean();
    private static volatile long nextHeartbeat;
    private static volatile boolean expired;
    public static void update(UUID uuid, boolean visible) {
        if (visible) BADGES.put(uuid,System.currentTimeMillis()+180_000); else BADGES.remove(uuid);
    }
    public static boolean visible(UUID uuid) {
        Long until=BADGES.get(uuid);
        if (until==null) return false;
        if (until<System.currentTimeMillis()) { BADGES.remove(uuid); return false; }
        return true;
    }
    public static void retain(java.util.Collection<UUID> uuids) { BADGES.keySet().retainAll(uuids); }
    public static void start() { BloomCosmeticsRuntime.scheduleRefresh(BloomPresence::heartbeat); }
    private static void heartbeat() {
        long now=System.currentTimeMillis();
        MinecraftClient client=MinecraftClient.getInstance();
        if (expired || now<nextHeartbeat || client.world==null || client.player==null) return;
        String token=System.getenv("BLOOM_COSMETICS_SESSION"), identity=System.getenv("BLOOM_COSMETICS_UUID");
        UUID local=client.getSession().getUuidOrNull();
        if (token==null || !token.matches("bcs_[A-Za-z0-9_-]{43}") || identity==null || local==null
            || !local.toString().replace("-","").equalsIgnoreCase(identity.replace("-",""))) return;
        if (!BUSY.compareAndSet(false,true)) return;
        nextHeartbeat=now+60_000;
        HttpRequest request=HttpRequest.newBuilder(URI.create(BloomCosmeticsRuntime.API_BASE+"/v1/cosmetics/sessions/current"))
            .timeout(Duration.ofSeconds(5)).header("Authorization","Bearer "+token)
            .PUT(HttpRequest.BodyPublishers.noBody()).build();
        BloomCosmeticsRuntime.HTTP.sendAsync(request,HttpResponse.BodyHandlers.discarding())
            .thenAccept(response->{ if(response.statusCode()==401) expired=true; })
            .whenComplete((result,error)->BUSY.set(false));
    }
}
