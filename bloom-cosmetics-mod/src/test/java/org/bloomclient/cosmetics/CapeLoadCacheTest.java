package org.bloomclient.cosmetics;

import org.junit.jupiter.api.Test;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class CapeLoadCacheTest {
    @Test void immediateFailureDoesNotPoisonTheNextLookup() {
        var cache = new CapeLoadCache<String>();
        assertTrue(cache.get("cape:revision", () -> CompletableFuture.failedFuture(
            new IllegalStateException("temporary failure"))).isCompletedExceptionally());
        assertEquals("texture", cache.get("cape:revision", () -> CompletableFuture.completedFuture("texture")).join());
    }

    @Test void thrownLoaderCanAlsoBeRetried() {
        var cache = new CapeLoadCache<String>();
        assertTrue(cache.get("cape:revision", () -> { throw new IllegalStateException("offline"); }).isCompletedExceptionally());
        assertEquals("texture", cache.get("cape:revision", () -> CompletableFuture.completedFuture("texture")).join());
    }

    @Test void playersShareOnePendingDownloadAndRetryAfterItFails() {
        var cache = new CapeLoadCache<String>();
        var download = new CompletableFuture<String>();
        var first = cache.get("cape:revision", () -> download);
        assertSame(first, cache.get("cape:revision", () -> { fail("Duplicate download"); return null; }));
        download.completeExceptionally(new IllegalStateException("timeout"));
        assertTrue(first.isCompletedExceptionally());
        assertEquals("texture", cache.get("cape:revision", () -> CompletableFuture.completedFuture("texture")).join());
    }

    @Test void leavingViewDisposesCompletedTexturesExactlyOnce() {
        var cache = new CapeLoadCache<String>();
        var disposed = new AtomicInteger();
        var pending = new CompletableFuture<String>();
        cache.get("old", () -> CompletableFuture.completedFuture("old"));
        cache.get("visible", () -> CompletableFuture.completedFuture("visible"));
        cache.get("pending", () -> pending);
        cache.retain(Set.of("visible"), texture -> disposed.incrementAndGet());
        assertEquals(1, disposed.get());
        pending.complete("pending");
        cache.retain(Set.of("visible"), texture -> disposed.incrementAndGet());
        cache.retain(Set.of("visible"), texture -> disposed.incrementAndGet());
        assertEquals(2, disposed.get());
    }
}
