package dev.bloomclient.benchmark;

import java.util.List;

/** Frame-weighted statistics: real stalls must remain in the input. */
public record FrameStatistics(double averageFps, double onePercentLow, double averageMs, double p95Ms) {
    public static FrameStatistics calculate(List<Double> frames, double seconds) {
        if (frames.isEmpty() || !Double.isFinite(seconds) || seconds <= 0
                || frames.stream().anyMatch(ms -> !Double.isFinite(ms) || ms <= 0)) {
            throw new IllegalArgumentException("No valid frame measurements");
        }
        List<Double> sorted = frames.stream().sorted().toList();
        int worstCount = Math.max(1, (int) Math.ceil(sorted.size() * .01));
        double worst = sorted.subList(sorted.size() - worstCount, sorted.size()).stream().mapToDouble(Double::doubleValue).average().orElseThrow();
        return new FrameStatistics(frames.size() / seconds, 1000.0 / worst,
                frames.stream().mapToDouble(Double::doubleValue).average().orElseThrow(),
                sorted.get(Math.max(0, (int) Math.ceil(sorted.size() * .95) - 1)));
    }
}
