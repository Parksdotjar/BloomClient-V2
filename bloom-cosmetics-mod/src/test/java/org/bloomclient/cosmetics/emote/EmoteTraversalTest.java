package org.bloomclient.cosmetics.emote;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.bloomclient.cosmetics.emote.EmoteKeyGesture.Action.*;

class EmoteTraversalTest {
    @Test void traversalSurvivesRepeatedRunJumpLandAndIdleWhileStationaryEmotesCancel() {
        var idle = new EmotePlaybackPolicy.State(false,false,false,false,false,false,false);
        var run = new EmotePlaybackPolicy.State(false,false,true,true,false,false,false);
        var jump = new EmotePlaybackPolicy.State(false,true,true,true,false,false,false);
        var fall = new EmotePlaybackPolicy.State(false,true,true,false,false,false,false);
        var use = new EmotePlaybackPolicy.State(false,false,true,false,true,true,false);
        var unfocused = new EmotePlaybackPolicy.State(false,false,false,false,false,false,true);
        for (int lap=0;lap<100;lap++) for (var state : new EmotePlaybackPolicy.State[]{idle,run,jump,fall,idle,use,unfocused}) {
            assertFalse(EmotePlaybackPolicy.cancels(true,state),"Traversal must persist through locomotion");
            assertEquals(state!=idle,EmotePlaybackPolicy.cancels(false,state),"Ordinary cancellation stays intact");
        }
    }

    @Test void incompatiblePlayerStatesStillStopBothModes() {
        var unavailable=new EmotePlaybackPolicy.State(true,false,false,false,false,false,false);
        assertTrue(EmotePlaybackPolicy.cancels(true,unavailable));
        assertTrue(EmotePlaybackPolicy.cancels(false,unavailable));
    }

    @Test void stoppingTraversalDoesNotOpenTheWheelUntilAnotherPhysicalPress() {
        var key=new EmoteKeyGesture();
        assertEquals(OPEN_WHEEL,key.update(true,true,true,false));
        assertEquals(NONE,key.update(true,true,false,false));
        assertEquals(NONE,key.update(false,false,true,true)); // wheel release starts traversal
        assertEquals(STOP_TRAVERSAL,key.update(true,true,true,true));
        for(int repeat=0;repeat<20;repeat++) assertEquals(NONE,key.update(true,true,true,false));
        assertEquals(NONE,key.update(false,false,true,false));
        assertEquals(OPEN_WHEEL,key.update(true,true,true,false));
    }

    @Test void quickTapStopsTraversalButTypingInChatDoesNot() {
        var key=new EmoteKeyGesture();
        assertEquals(NONE,key.update(true,true,false,true));
        assertEquals(NONE,key.update(false,false,true,true));
        assertEquals(STOP_TRAVERSAL,key.update(true,false,true,true));
        assertEquals(NONE,key.update(true,false,true,false));
        key.reset();
        assertEquals(OPEN_WHEEL,key.update(true,true,true,false));
    }
}
