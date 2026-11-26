package org.bloomclient.cosmetics.tweaks;

import java.time.LocalTime;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

final class AdditionalTweaksTest {
    @Test void compassHeadingKeepsFractionalCameraMotionAcrossNorth() {
        assertEquals(359.75f,WorldReadouts.heading(179.75f));
        assertEquals(0f,WorldReadouts.heading(180f));
        assertEquals(.25f,WorldReadouts.heading(180.25f));
        assertEquals(359.75f,WorldReadouts.heading(-180.25f));
    }

    @Test void crosshairDefaultsMatchTheApprovedReticle() {
        assertEquals(3,Setting.RETICLE_LENGTH.initial);
        assertEquals(0,Setting.RETICLE_GAP.initial);
        assertEquals(1,Setting.RETICLE_WIDTH.initial);
        assertEquals("Black",Setting.RETICLE_COLOR.choices[Setting.RETICLE_COLOR.initial]);
        assertEquals("Off",Setting.RETICLE_OUTLINE.choices[Setting.RETICLE_OUTLINE.initial]);
    }

    @Test void inGameClockUsesVanillaDayBoundaryAndSunrise() {
        assertEquals(LocalTime.of(6,0),WorldReadouts.gameTime(0));
        assertEquals(LocalTime.NOON,WorldReadouts.gameTime(6000));
        assertEquals(LocalTime.MIDNIGHT,WorldReadouts.gameTime(18000));
        assertEquals(WorldReadouts.gameTime(18000),WorldReadouts.gameTime(-6000));
        assertEquals(WorldReadouts.gameTime(0),WorldReadouts.gameTime(24000));
    }

    @Test void hotbarScrollingRespectsDirectionAndOptionalWrapping() {
        assertEquals(8,DelightTweaks.hotbarSlot(1,0,9,false));
        assertEquals(0,DelightTweaks.hotbarSlot(-1,8,9,false));
        assertEquals(0,DelightTweaks.hotbarSlot(1,0,9,true));
        assertEquals(8,DelightTweaks.hotbarSlot(-1,8,9,true));
        assertEquals(6,DelightTweaks.hotbarSlot(-2,4,9,true));
    }

    @Test void blockOutlineStylesKeepTheirColorOrOpacityContracts() {
        assertEquals(0xFFFF0000,VisualTweaks.outlineColor(0,0,100,100,100,.4));
        assertEquals(0xFFFF0000,VisualTweaks.outlineColor(1,0,100,100,100,0));
        assertEquals(0x8CFF0000,VisualTweaks.outlineColor(1,0,100,100,100,.5));
        assertEquals(0xFF00FFFF,VisualTweaks.outlineColor(2,0,100,100,100,.5));
    }
}
