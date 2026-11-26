package org.bloomclient.cosmetics.tweaks;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class HudPlacementTest {
    private static HudPlacement fit(int width, int height, int contentWidth, int contentHeight,
                                    float scale, double x, double y) {
        return HudPlacement.fit(Feature.CPS,width,height,contentWidth,contentHeight,scale,x,y,false);
    }

    @Test void draggedPixelsRoundTripThroughSavedAnchors() {
        var layout = fit(321,201,33,29,1.5f,0,0);
        for (int x = 0; x <= 321 - layout.w(); x++) {
            double saved = HudPlacement.anchor(x,321,layout.w());
            assertEquals(x,fit(321,201,33,29,1.5f,saved,0).x());
        }
    }

    @Test void oversizedContentFitsAndUsesTheSameHitArea() {
        var r = fit(320,180,68,700,2f,1,1);
        assertEquals(0,r.y());
        assertEquals(180,r.y() + r.h());
        assertEquals(320,r.x() + r.w());
        assertTrue(r.contains(r.x(),r.y()));
        assertTrue(r.contains(r.x() + r.w() - .01,r.y() + r.h() - .01));
        assertFalse(r.contains(r.x() + r.w(),r.y()));
        assertFalse(r.contains(r.x(),r.y() + r.h()));
    }

    @Test void cornerAnchorsSurviveResizeAndScaleChanges() {
        for (int width : new int[]{320,854,1920}) {
            for (float scale : new float[]{.5f,1f,1.3f,2f}) {
                var r = fit(width,240,24,76,scale,1,1);
                assertEquals(width,r.x() + r.w());
                assertEquals(240,r.y() + r.h());
                assertEquals(scale,r.scale());
            }
        }
    }

    @Test void eachHandleScalesProportionallyAroundItsOppositeCorner() {
        int width = 320, height = 240;
        var original = fit(width,height,60,30,1f,.5,.5);
        for (var corner : HudPlacement.Corner.values()) {
            assertTrue(corner.contains(original,corner.x(original),corner.y(original)));
            assertFalse(corner.contains(original,original.x() + 30,original.y() + 15));
            int scale = corner.scale(original,corner.right ? 30 : -30,corner.bottom ? 15 : -15);
            assertEquals(150,scale);
            var resized = fit(width,height,60,30,scale / 100f,0,0);
            var positioned = fit(width,height,60,30,scale / 100f,
                corner.anchorX(original,resized,width),corner.anchorY(original,resized,height));
            assertEquals(original.x() + (corner.right ? 0 : original.w()),
                positioned.x() + (corner.right ? 0 : positioned.w()));
            assertEquals(original.y() + (corner.bottom ? 0 : original.h()),
                positioned.y() + (corner.bottom ? 0 : positioned.h()));
        }
    }

    @Test void handleDragUsesTheExistingScaleLimitsAndScreenEdges() {
        var corner = HudPlacement.Corner.BOTTOM_RIGHT;
        var original = fit(320,240,60,30,1f,1,1);
        assertEquals(50,corner.scale(original,-500,-500));
        assertEquals(200,corner.scale(original,500,500));
        var resized = fit(320,240,60,30,2f,0,0);
        assertEquals(1,corner.anchorX(original,resized,320));
        assertEquals(1,corner.anchorY(original,resized,240));
    }

    @Test void everyFeatureCanReachTheBottomEdge() {
        for (var feature : Feature.values()) {
            double bottom = HudPlacement.anchor(240 - 16,240,16);
            var positioned = HudPlacement.fit(feature,320,240,40,16,1f,.75,bottom,false);
            assertEquals(240,positioned.y() + positioned.h());
        }
    }

    @Test void equipmentDefaultsMirrorTheOffhandGapAndShareTheBottomEdge() {
        for (int width : new int[]{427,854,960}) {
            for (boolean offhandOnRight : new boolean[]{false,true}) {
                var armor = HudPlacement.fit(Feature.ARMOR,width,240,20,80,1f,Double.NaN,Double.NaN,offhandOnRight);
                var durability = HudPlacement.fit(Feature.DURABILITY,width,240,48,16,1f,Double.NaN,Double.NaN,offhandOnRight);
                int gap = offhandOnRight ? width / 2 - 91 - (armor.x() + armor.w()) : armor.x() - (width / 2 + 91);
                assertEquals(7,gap);
                assertEquals(240,armor.y() + armor.h());
                assertEquals(240,durability.y() + durability.h());
                assertEquals(4,offhandOnRight ? armor.x() - (durability.x() + durability.w()) : durability.x() - (armor.x() + armor.w()));
            }
        }
    }

    @Test void defaultsFitNarrowWindowsAndPutCoordinatesAboveFps() {
        var durability = HudPlacement.fit(Feature.DURABILITY,320,240,48,16,1f,Double.NaN,Double.NaN,false);
        assertEquals(251,durability.x() + durability.w());
        assertEquals(218,durability.y() + durability.h());
        var coordinates = HudPlacement.fit(Feature.COORDINATES,320,240,86,10,1f,Double.NaN,Double.NaN,false);
        var fps = HudPlacement.fit(Feature.FPS,320,240,38,10,1f,Double.NaN,Double.NaN,false);
        assertEquals(coordinates.x(),fps.x());
        assertTrue(coordinates.y() + coordinates.h() < fps.y());
    }
}
