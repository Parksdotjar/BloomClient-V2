package org.bloomclient.cosmetics;

//? if <26.1 {
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.LoggerFactory;
import net.minecraft.client.option.Perspective;
import net.minecraft.client.util.ScreenshotRecorder;

/** Optional screenshots from an explicit local Fabric development run. */
final class DelightWingPreview {
    private int readyTicks;

    static void register() {
        if (!FabricLoader.getInstance().isDevelopmentEnvironment() || !Boolean.getBoolean("delight.wings.capture")) return;
        new DelightWingPreview().listen();
    }

    private void listen() {
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            if (client.player == null || readyTicks >= 28) return;
            var player = BloomCosmeticsRuntime.stableIdentity(client, client.player);
            if (DelightWings.get().forPlayer(player, true) == null) return;
            readyTicks++;
            if (readyTicks == 1) {
                client.options.setPerspective(Perspective.THIRD_PERSON_BACK);
            }
            if (readyTicks == 20 || readyTicks == 28) {
                String name = "delight-wing-preview-" + readyTicks + ".png";
                ScreenshotRecorder.saveScreenshot(client.runDirectory, name, client.getFramebuffer(), 1,
                    ignored -> LoggerFactory.getLogger("Delight Wings").info("Captured local wing preview {}", name));
            }
        });
    }
}
//?} else {
/*final class DelightWingPreview {
    static void register() {}
}
*///?}
