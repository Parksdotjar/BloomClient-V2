package dev.bloomclient.benchmark.mixin;

import dev.bloomclient.benchmark.BloomBenchmarkClient;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

// Sampled per frame, not from a HUD element: HUD caching mods (e.g. Gnetum) skip HUD elements on most frames.
@Mixin(Minecraft.class)
abstract class MinecraftMixin {
    @Inject(method = "runTick", at = @At("TAIL"))
    private void bloom_autotune$sampleFrame(CallbackInfo ci) {
        BloomBenchmarkClient.onFrame();
    }
}
