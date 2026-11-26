package org.bloomclient.cosmetics.mixin.client;

import org.bloomclient.cosmetics.tweaks.DelightTweaks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

//? if <26.1 {
@Mixin(net.minecraft.client.render.GameRenderer.class)
//?} else {
/*@Mixin(net.minecraft.client.Camera.class)
*///?}
abstract class TweaksFovMixin {
    //? if <26.1 {
    @Inject(method = "getFov", at = @At("RETURN"), cancellable = true)
    private void delightZoom(net.minecraft.client.render.Camera camera, float delta, boolean worldFov, CallbackInfoReturnable<Float> result) {
        if (worldFov) result.setReturnValue(DelightTweaks.fov(result.getReturnValueF()));
    }
    //?} else {
    /*@Inject(method = "calculateFov", at = @At("RETURN"), cancellable = true)
    private void delightZoom(float delta, CallbackInfoReturnable<Float> result) {
        result.setReturnValue(DelightTweaks.fov(result.getReturnValueF()));
    }
    *///?}
}
