package org.bloomclient.cosmetics.mixin.client;

import net.minecraft.client.MinecraftClient;
import org.bloomclient.cosmetics.tweaks.CameraTweaks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MinecraftClient.class)
abstract class TweaksScreenshotMixin {
    //? if <26.1 {
    @Inject(method = "render", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/render/GameRenderer;render(Lnet/minecraft/client/render/RenderTickCounter;Z)V"))
    //?} else {
    /*@Inject(method = "renderFrame", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/renderer/GameRenderer;extract(Lnet/minecraft/client/DeltaTracker;Z)V"))
    *///?}
    private void delightPrepareScreenshot(CallbackInfo ci) {
        CameraTweaks.beginScreenshot();
    }

    //? if <26.1 {
    @Inject(method = "render", at = @At(value = "INVOKE", shift = At.Shift.AFTER,
        target = "Lnet/minecraft/client/render/GameRenderer;render(Lnet/minecraft/client/render/RenderTickCounter;Z)V"))
    //?} elif <26.3 {
    /*@Inject(method = "renderFrame", at = @At(value = "INVOKE", shift = At.Shift.AFTER,
        target = "Lnet/minecraft/client/renderer/GameRenderer;render(Lnet/minecraft/client/DeltaTracker;Z)V"))
    *///?} else {
    /*@Inject(method = "renderFrame", at = @At(value = "INVOKE", shift = At.Shift.AFTER,
        target = "Lnet/minecraft/client/renderer/GameRenderer;render()V"))
    *///?}
    private void delightCaptureScreenshot(CallbackInfo ci) {
        CameraTweaks.finishScreenshot();
    }
}
