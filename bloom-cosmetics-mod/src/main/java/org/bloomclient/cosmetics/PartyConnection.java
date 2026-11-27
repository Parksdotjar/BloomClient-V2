package org.bloomclient.cosmetics;

import com.google.gson.JsonObject;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import java.nio.file.*;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Reports this launch's multiplayer connection locally. Sharing requires launcher consent. */
final class PartyConnection {
    private static Object connection;
    private static String visit;
    private static long nextReport;

    static void start() {
        String location = System.getenv("DELIGHT_PARTY_CONNECTION");
        if (location == null) return;
        Path path = Path.of(location);
        ExecutorService writer = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "Delight party connection");
            thread.setDaemon(true);
            return thread;
        });
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            var server = client.getCurrentServerEntry();
            Object current = client.player == null || server == null ? null : client.getNetworkHandler();
            long now = System.currentTimeMillis();
            if (current == connection && (current == null || now < nextReport)) return;
            if (current != connection) visit = UUID.randomUUID().toString();
            connection = current;
            nextReport = now + 5000;
            JsonObject report = new JsonObject();
            if (current != null) {
                report.addProperty("server", server.address);
                report.addProperty("visit", visit);
                report.addProperty("time", now);
            }
            writer.execute(() -> {
                try {
                    if (!report.has("server")) { Files.deleteIfExists(path); return; }
                    Path tmp = path.resolveSibling(path.getFileName() + ".tmp");
                    Files.writeString(tmp, report.toString());
                    Files.move(tmp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } catch (java.io.IOException ignored) { /* Launcher expires missing heartbeats. */ }
            });
        });
    }
}
