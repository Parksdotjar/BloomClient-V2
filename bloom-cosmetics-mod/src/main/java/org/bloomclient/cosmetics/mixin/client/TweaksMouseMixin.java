package org.bloomclient.cosmetics.mixin.client;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import org.bloomclient.cosmetics.tweaks.DelightTweaks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.invoke.arg.Args;

//? if <26.1 {
@Mixin(net.minecraft.client.Mouse.class)
//?} else {
/*@Mixin(net.minecraft.client.MouseHandler.class)
*///?}
abstract class TweaksMouseMixin {
    //? if <26.1 {
    @Inject(method = "onMouseButton", at = @At("HEAD"))
    private void count(long window, net.minecraft.client.input.MouseInput button, int action, CallbackInfo ci) {
    //?} else {
    /*@Inject(method = "onButton", at = @At("HEAD"))
    private void count(long window, net.minecraft.client.input.MouseButtonInfo button, int action, CallbackInfo ci) {
    *///?}
        DelightTweaks.click(button.button(), action);
    }

    //? if <26.1 {
    @Inject(method = "onMouseScroll", at = @At("HEAD"), cancellable = true)
    //?} else {
    /*@Inject(method = "onScroll", at = @At("HEAD"), cancellable = true)
    *///?}
    private void scroll(long window, double horizontal, double vertical, CallbackInfo ci) {
        if (DelightTweaks.scroll(vertical)) ci.cancel();
    }

    //? if <26.1 {
    @ModifyArgs(method = "onMouseScroll", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/input/Scroller;update(DD)Lorg/joml/Vector2i;"))
    //?} else {
    /*@ModifyArgs(method = "onScroll", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/ScrollWheelHandler;onMouseScroll(DD)Lorg/joml/Vector2i;"))
    *///?}
    private void delightHotbarScrollSensitivity(Args scroll) {
        double gain = DelightTweaks.hotbarScrollFactor();
        if (gain != 1) {
            scroll.set(0,scroll.<Double>get(0) * gain);
            scroll.set(1,scroll.<Double>get(1) * gain);
        }
    }

    //? if <26.1 {
    @WrapOperation(method = "onMouseScroll", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/input/Scroller;scrollCycling(DII)I"))
    //?} else {
    /*@WrapOperation(method = "onScroll", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/ScrollWheelHandler;getNextScrollWheelSelection(DII)I"))
    *///?}
    private int delightHotbarSelection(double delta, int selected, int slots, Operation<Integer> original) {
        return DelightTweaks.customHotbarScroll() ? DelightTweaks.hotbarSlot(delta,selected,slots) : original.call(delta,selected,slots);
    }

    //? if <26.1 {
    @ModifyArgs(method = "updateMouse", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/network/ClientPlayerEntity;changeLookDirection(DD)V"))
    //?} else {
    /*@ModifyArgs(method = "turnPlayer", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/player/LocalPlayer;turn(DD)V"))
    *///?}
    private void sensitivity(Args angles) {
        double gain = DelightTweaks.sensitivity();
        if (gain != 1) {
            angles.set(0, angles.<Double>get(0) * gain);
            angles.set(1, angles.<Double>get(1) * gain);
        }
    }
}
