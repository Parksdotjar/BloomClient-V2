package dev.bloomclient.benchmark;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class FrameStatisticsTest {
    @Test void longFreezesReduceTheOnePercentLow() {
        var frames = new ArrayList<>(Collections.nCopies(99, 10.0));
        frames.add(2010.0);
        var measured = FrameStatistics.calculate(frames, 3.0);
        assertEquals(100.0 / 3, measured.averageFps(), .0001);
        assertEquals(1000.0 / 2010, measured.onePercentLow(), .0001);
        assertEquals(30.0, measured.averageMs(), .0001);
        assertEquals(10.0, measured.p95Ms());
    }
    @Test void percentileUsesNearestRank() {
        var frames = new ArrayList<Double>();
        for (int i = 1; i <= 100; i++) frames.add((double) i);
        assertEquals(95.0, FrameStatistics.calculate(frames, 5.05).p95Ms());
    }
    @Test void invalidMeasurementsNeverBecomeResults() {
        assertThrows(IllegalArgumentException.class, () -> FrameStatistics.calculate(List.of(), 60));
        assertThrows(IllegalArgumentException.class, () -> FrameStatistics.calculate(List.of(Double.NaN), 60));
        assertThrows(IllegalArgumentException.class, () -> FrameStatistics.calculate(List.of(10.0), 0));
    }
}
