package org.bloomclient.cosmetics.tweaks;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;
import org.slf4j.LoggerFactory;
import static org.bloomclient.cosmetics.tweaks.Setting.*;

public final class CameraTweaks {
    private static final int[] CROSSHAIR_COLORS = {
        0xFFFFFFFF, 0xFF111111, 0xFFA6FF40, 0xFF54EBFF, 0xFFFF5353, 0xFFFFCF46
    };
    private static int captureDelay = -1;
    private static boolean capturing, restoreHud;

    public static boolean crosshair(DrawContext g, int centerX, int centerY) {
        if (!Preferences.on(Feature.CROSSHAIR, ENABLED)) return false;
        drawCrosshair(g,centerX,centerY);
        return true;
    }

    static void drawCrosshair(DrawContext g, int centerX, int centerY) {
        var f = Feature.CROSSHAIR;
        int length = Preferences.get(f, RETICLE_LENGTH);
        int gap = Preferences.get(f, RETICLE_GAP);
        int thickness = Preferences.get(f, RETICLE_WIDTH);
        int color = CROSSHAIR_COLORS[Preferences.get(f, RETICLE_COLOR)];
        if (!Preferences.on(f, RETICLE_OUTLINE)) {
            drawArms(g,centerX,centerY,length,gap,thickness,1,color == 0xFF111111 ? 0xCCFFFFFF : 0xDD000000);
        }
        drawArms(g,centerX,centerY,length,gap,thickness,0,color);
    }

    private static void drawArms(DrawContext g, int x, int y, int length, int gap, int thickness, int border, int color) {
        int near = gap + 1, far = near + length;
        int low = thickness / 2, high = thickness - low;
        g.fill(x - far + 1 - border,y - low - border,x - near + 1 + border,y + high + border,color);
        g.fill(x + near - border,y - low - border,x + far + border,y + high + border,color);
        g.fill(x - low - border,y - far + 1 - border,x + high + border,y - near + 1 + border,color);
        g.fill(x - low - border,y + near - border,x + high + border,y + far + border,color);
        if (gap == 0) g.fill(x - low - border,y - low - border,x + high + border,y + high + border,color);
    }

    static void tick(boolean requested) {
        if (!screenshotReady()) {
            captureDelay = -1;
        } else if (requested) {
            captureDelay = Preferences.get(Feature.SCREENSHOT, SCREENSHOT_DELAY) * 20;
        } else if (captureDelay > 0) {
            captureDelay--;
        }
    }

    private static boolean screenshotReady() {
        return DelightTweaks.playing() && Preferences.on(Feature.SCREENSHOT, ENABLED);
    }

    public static void beginScreenshot() {
        if (captureDelay != 0 || !screenshotReady()) return;
        captureDelay = -1;
        var client = MinecraftClient.getInstance();
        restoreHud = !Preferences.on(Feature.SCREENSHOT, SCREENSHOT_HUD) && !hudHidden(client);
        if (restoreHud) toggleHud(client);
        capturing = true;
    }

    public static void finishScreenshot() {
        if (!capturing) return;
        capturing = false;
        var client = MinecraftClient.getInstance();
        try {
            saveScreenshot(client);
        } catch (RuntimeException e) {
            LoggerFactory.getLogger("Delight Tweaks").warn("Could not take the screenshot", e);
            DelightTweaks.showChat(Text.literal("Could not take the screenshot"));
        } finally {
            if (restoreHud) toggleHud(client);
            restoreHud = false;
        }
    }

    private static boolean hudHidden(MinecraftClient client) {
        //? if <26.1 {
        return client.options.hudHidden;
        //?} elif <26.2 {
        /*return client.options.hideGui;
        *///?} else {
        /*return client.gui.hud.isHidden();
        *///?}
    }

    private static void toggleHud(MinecraftClient client) {
        //? if <26.1 {
        client.options.hudHidden = !client.options.hudHidden;
        //?} elif <26.2 {
        /*client.options.hideGui = !client.options.hideGui;
        *///?} else {
        /*client.gui.hud.toggle();
        *///?}
    }

    private static void saveScreenshot(MinecraftClient client) {
        //? if <26.1 {
        net.minecraft.client.util.ScreenshotRecorder.saveScreenshot(client.runDirectory, client.getFramebuffer(),
            message -> client.execute(() -> DelightTweaks.showChat(message)));
        //?} elif <26.2 {
        /*net.minecraft.client.Screenshot.grab(client.gameDirectory, client.getMainRenderTarget(),
            message -> client.execute(() -> DelightTweaks.showChat(message)));
        *///?} else {
        /*net.minecraft.client.Screenshot.grab(client, false);
        *///?}
    }
}
