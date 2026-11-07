package org.bloomclient.cosmetics;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class CapeHttpTest {
    private HttpServer server;
    private ExecutorService workers;
    private final CountDownLatch release = new CountDownLatch(1);

    @BeforeEach void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        workers = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(workers);
        server.start();
    }

    @AfterEach void stop() {
        release.countDown();
        server.stop(0);
        workers.shutdownNow();
    }

    private HttpRequest request(String path, long timeoutMs) {
        return HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + path))
            .timeout(Duration.ofMillis(timeoutMs)).GET().build();
    }

    @Test void stalledBodyTimesOutAfterHeadersAndNextRequestCanSucceed() throws Exception {
        var headers = new CountDownLatch(1);
        var calls = new AtomicInteger();
        server.createContext("/texture", exchange -> {
            try (exchange) {
                exchange.sendResponseHeaders(200, 4);
                var out = exchange.getResponseBody();
                if (calls.incrementAndGet() == 1) {
                    out.write(1); out.flush(); headers.countDown();
                    try { release.await(4, TimeUnit.SECONDS); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                } else out.write(new byte[]{1, 2, 3, 4});
            }
        });
        var stalled = CapeHttp.get(request("/texture", 1000), 16);
        assertTrue(headers.await(3, TimeUnit.SECONDS), "The response body, not connection establishment, must stall");
        assertThrows(ExecutionException.class, () -> stalled.get(3, TimeUnit.SECONDS));
        assertArrayEquals(new byte[]{1, 2, 3, 4}, CapeHttp.get(request("/texture", 3000), 16).get(4, TimeUnit.SECONDS).body());
    }

    @Test void oversizedChunkedBodyFailsBeforeTheServerFinishes() throws Exception {
        server.createContext("/large", exchange -> {
            try (exchange) {
                exchange.sendResponseHeaders(200, 0);
                exchange.getResponseBody().write(new byte[17]);
                exchange.getResponseBody().flush();
                try { release.await(4, TimeUnit.SECONDS); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
            }
        });
        var error = assertThrows(ExecutionException.class,
            () -> CapeHttp.get(request("/large", 3000), 16).get(2, TimeUnit.SECONDS));
        assertTrue(error.getCause().getMessage().contains("download limit"));
    }

    @Test void exactLimitIsAccepted() throws Exception {
        server.createContext("/exact", exchange -> {
            try (exchange) { exchange.sendResponseHeaders(200, 16); exchange.getResponseBody().write(new byte[16]); }
        });
        assertEquals(16, CapeHttp.get(request("/exact", 3000), 16).get(4, TimeUnit.SECONDS).body().length);
    }

    @Test void redirectCannotBypassTheTrustedAssetHostCheck() throws Exception {
        var redirected = new AtomicInteger();
        server.createContext("/redirect", exchange -> {
            try (exchange) { exchange.getResponseHeaders().add("Location", "/destination"); exchange.sendResponseHeaders(302, -1); }
        });
        server.createContext("/destination", exchange -> {
            redirected.incrementAndGet();
            try (exchange) { exchange.sendResponseHeaders(200, -1); }
        });
        assertEquals(302, CapeHttp.get(request("/redirect", 3000), 16).get(4, TimeUnit.SECONDS).statusCode());
        assertEquals(0, redirected.get());
    }
}
