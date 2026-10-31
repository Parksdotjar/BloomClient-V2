package org.bloomclient.cosmetics.emote;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class EmoteWheelGeometryTest {
    @Test void eachWedgeKeepsSelectingFarOutsideTheVisibleCircle() {
        for(int slot=0;slot<8;slot++)for(double distance:new double[]{50,100,500,5000}){
            double angle=-Math.PI/2+slot*Math.PI/4;
            assertEquals(slot,EmoteWheelGeometry.selection(Math.cos(angle)*distance,Math.sin(angle)*distance,100));
        }
        assertEquals(1,EmoteWheelGeometry.selection(900,-900,100));
        assertEquals(3,EmoteWheelGeometry.selection(900,900,100));
        assertEquals(5,EmoteWheelGeometry.selection(-900,900,100));
        assertEquals(7,EmoteWheelGeometry.selection(-900,-900,100));
    }
    @Test void centerCancelsAndTheRenderedWheelStillEndsAtItsRadius() {
        assertEquals(-1,EmoteWheelGeometry.selection(0,0,100));
        assertEquals(-1,EmoteWheelGeometry.selection(0,35,100));
        assertEquals(0,EmoteWheelGeometry.drawnSector(0,-75,100));
        assertEquals(-1,EmoteWheelGeometry.drawnSector(0,-500,100));
    }
    @Test void visualSeamsDoNotBecomeUnselectableLinesAcrossTheScreen() {
        double angle=-Math.PI/2+Math.PI/8;
        assertEquals(-1,EmoteWheelGeometry.drawnSector(Math.cos(angle)*80,Math.sin(angle)*80,100));
        assertTrue(EmoteWheelGeometry.selection(Math.cos(angle)*800,Math.sin(angle)*800,100)>=0);
    }
}
