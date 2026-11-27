package org.bloomclient.cosmetics;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

final class DelightModelCosmeticsTest {
    @Test
    void bundledBunnyEarsLoadWithFourIndependentColorRegions() throws Exception {
        var hat = DelightWingData.catalog().values().stream()
            .filter(item -> item.id().equals("bunny-ears") && item.hat())
            .findFirst().orElseThrow();
        assertEquals(new DelightWingData.Colors("#eab6ce", "#eab6ce", "#ffffff", "#ffffff"), hat.defaults());
        var model = DelightWingData.read(hat).model();
        assertEquals("hat", model.slot());
        assertEquals(1, model.duration());
        assertEquals(1, model.pose(1735).length);

        var custom = new DelightWingData.Colors("#ef0001", "#02fe03", "#0405ee", "#fef106");
        var expected = Map.of("left", 0xef0001, "right", 0x02fe03, "trim", 0x0405ee, "rightOuter", 0xfef106);
        var renderedRegions = new HashSet<String>();
        for (var batch : model.batches()) {
            assertTrue(batch.vertices().length > 0);
            assertEquals(expected.get(batch.tint()).intValue(), batch.rgb(custom));
            renderedRegions.add(batch.tint());
        }
        assertEquals(expected.keySet(), renderedRegions);
    }

    @Test
    void syringeShineCoversFiveLiquidTexelsAndRepeatsDownward() throws Exception {
        var item = DelightWingData.catalog().values().stream().filter(i -> "green-syringe".equals(i.id())).findFirst().orElseThrow();
        var model = DelightWingData.read(item).model();
        var defaults = item.defaults();
        var lit = new HashSet<Integer>();
        long center = 12 * 45;
        for (var batch : model.batches()) {
            int original = 0xff000000 | Integer.parseInt(batch.color().substring(1), 16);
            assertEquals(original, batch.accentColor(defaults, defaults, 3000));
            int color = batch.accentColor(defaults, defaults, center);
            assertEquals(color, batch.accentColor(defaults, defaults, center + 5000));
            if (color != original) {
                assertEquals("rightOuter", batch.tint());
                lit.add(batch.shineRow());
            }
            if (Integer.valueOf(10).equals(batch.shineRow())) {
                long peak = Integer.toUnsignedLong(color);
                long inner = Integer.toUnsignedLong(batch.accentColor(defaults, defaults, center + 45));
                long outer = Integer.toUnsignedLong(batch.accentColor(defaults, defaults, center + 90));
                assertTrue(peak > inner && inner > outer);
            }
            if (Integer.valueOf(13).equals(batch.shineRow())) {
                assertEquals(original, color);
                assertNotEquals(original, batch.accentColor(defaults, defaults, center + 45));
            }
        }
        assertEquals(Set.of(8,9,10,11,12), lit);
    }

    @Test
    void allSyringeSectionsUseNeutralHighlightsForBlack() throws Exception {
        var item = DelightWingData.catalog().values().stream().filter(i -> "green-syringe".equals(i.id())).findFirst().orElseThrow();
        var black = new DelightWingData.Colors("#000000", "#000000", "#000000", "#000000", "#000000");
        Set<Integer> liquid = new HashSet<>();
        for (var batch : DelightWingData.read(item).model().batches()) {
            for (long time : new long[]{540, 3000}) {
                int rgb = batch.accentColor(black, item.defaults(), time);
                int gray = rgb & 255;
                assertEquals(gray, rgb >> 8 & 255);
                assertEquals(gray, rgb >> 16 & 255);
                if (time == 3000 && "rightOuter".equals(batch.tint())) liquid.add(gray);
            }
        }
        assertTrue(liquid.contains(0) && liquid.stream().anyMatch(v -> v > 0 && v <= 77));
    }

    @Test
    void existingWingPackageStillLoadsWithoutHatMetadata() throws Exception {
        var wing = DelightWingData.catalog().values().stream()
            .filter(item -> item.id().equals("eclipse-angel-wings"))
            .findFirst().orElseThrow();
        assertFalse(wing.hat());
        assertNull(wing.defaults().rightOuter());
        var model = DelightWingData.read(wing).model();
        assertNull(model.slot());
        assertTrue(model.pose(235).length > 1);
        assertTrue(model.batches().stream().allMatch(batch ->
            Set.of("left", "right", "trim", "fixed").contains(batch.tint())));
    }
}
