package org.bloomclient.cosmetics;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Bounded downloads with a deadline covering headers AND the response body. */
final class CapeHttp {
    private static final HttpClient HTTP = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(4))
        // Leased textures are served by the trusted API itself. Never follow a
        // redirect around the renderer's asset-host validation.
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();

    private CapeHttp() {}

    static CompletableFuture<HttpResponse<byte[]>> get(HttpRequest request, int limit) {
        return get(HTTP, request, limit);
    }

    private static CompletableFuture<HttpResponse<byte[]>> get(HttpClient client, HttpRequest request, int limit) {
        var subscriber = new AtomicReference<LimitedBody>();
        var aborted = new AtomicBoolean();
        var transfer = client.sendAsync(request, info -> {
            var body = new LimitedBody(limit);
            subscriber.set(body);
            if (aborted.get()) body.cancel();
            return body;
        });
        var result = transfer.copy().orTimeout(
            Math.max(1, request.timeout().orElse(Duration.ofSeconds(12)).toMillis()), TimeUnit.MILLISECONDS);
        result.whenComplete((response, error) -> {
            if (error != null) {
                aborted.set(true);
                transfer.cancel(true);
                var body = subscriber.get();
                if (body != null) body.cancel();
            }
        });
        return result;
    }

    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final int limit;
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private Flow.Subscription subscription;

        LimitedBody(int limit) {
            if (limit < 1) throw new IllegalArgumentException("Invalid cape response limit");
            this.limit = limit;
        }

        @Override public CompletionStage<byte[]> getBody() { return result; }

        @Override public synchronized void onSubscribe(Flow.Subscription next) {
            if (subscription != null || result.isDone()) { next.cancel(); return; }
            subscription = next;
            next.request(Long.MAX_VALUE);
        }

        @Override public synchronized void onNext(List<ByteBuffer> buffers) {
            if (result.isDone()) return;
            for (ByteBuffer buffer : buffers) {
                if (buffer.remaining() > limit - bytes.size()) {
                    subscription.cancel();
                    result.completeExceptionally(new IllegalStateException("Cape response exceeds download limit"));
                    return;
                }
                byte[] chunk = new byte[Math.min(8192, buffer.remaining())];
                while (buffer.hasRemaining()) {
                    int count = Math.min(chunk.length, buffer.remaining());
                    buffer.get(chunk, 0, count);
                    bytes.write(chunk, 0, count);
                }
            }
        }

        @Override public synchronized void onError(Throwable error) { result.completeExceptionally(error); }
        @Override public synchronized void onComplete() {
            if (!result.isDone()) result.complete(bytes.toByteArray());
        }

        synchronized void cancel() {
            if (subscription != null) subscription.cancel();
            result.cancel(false);
        }
    }
}
