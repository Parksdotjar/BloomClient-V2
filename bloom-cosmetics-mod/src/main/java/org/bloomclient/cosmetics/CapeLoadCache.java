package org.bloomclient.cosmetics;

import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** Shares in-flight textures, but never retains a failed attempt. */
final class CapeLoadCache<T> {
    private final ConcurrentHashMap<String, CompletableFuture<T>> loads = new ConcurrentHashMap<>();

    CompletableFuture<T> get(String key, Supplier<CompletableFuture<T>> loader) {
        var pending = new CompletableFuture<T>();
        var existing = loads.putIfAbsent(key, pending);
        if (existing != null) return existing;
        // Install the entry before starting work. A synchronous failure inside
        // computeIfAbsent used to remove an entry that had not been inserted yet.
        try {
            loader.get().whenComplete((value, error) -> {
                if (error != null) {
                    loads.remove(key, pending);
                    pending.completeExceptionally(error);
                } else pending.complete(value);
            });
        } catch (Throwable error) {
            loads.remove(key, pending);
            pending.completeExceptionally(error);
        }
        return pending;
    }

    void retain(Set<String> used, Consumer<T> dispose) {
        loads.forEach((key, future) -> {
            if (!used.contains(key) && future.isDone() && loads.remove(key, future)) {
                future.thenAccept(dispose);
            }
        });
    }
}
