package org.bloomclient.cosmetics;

import net.fabricmc.api.ClientModInitializer;

public final class BloomCosmeticsClient implements ClientModInitializer {
    public static String apiBase() { return BloomCosmeticsRuntime.API_BASE; }
    @Override
    public void onInitializeClient() {
        BloomCapeService.get().start();
        BloomPresence.start();
        org.bloomclient.cosmetics.emote.BloomEmotes.init();
    }
}
