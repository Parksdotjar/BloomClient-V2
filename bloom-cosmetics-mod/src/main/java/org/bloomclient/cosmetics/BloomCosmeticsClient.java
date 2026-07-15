package org.bloomclient.cosmetics;

import net.fabricmc.api.ClientModInitializer;

public final class BloomCosmeticsClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        BloomCapeService.get().start();
        BloomHatService.get().start();
        BloomWingService.get().start();
    }
}
