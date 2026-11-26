package org.bloomclient.cosmetics.mixin.client;

import net.minecraft.util.math.BlockPos;
import org.bloomclient.cosmetics.tweaks.VisualTweaks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

//? if <26.1 {
@Mixin(net.minecraft.client.network.ClientPlayerInteractionManager.class)
//?} else {
/*@Mixin(net.minecraft.client.multiplayer.MultiPlayerGameMode.class)
*///?}
abstract class TweaksBlockBreakMixin {
    //? if <26.1 {
    @Inject(method = "breakBlock", at = @At("RETURN"))
    //?} else {
    /*@Inject(method = "destroyBlock", at = @At("RETURN"))
    *///?}
    private void delightBlockParticles(BlockPos pos, CallbackInfoReturnable<Boolean> cir) {
        if (cir.getReturnValueZ()) VisualTweaks.blockBroken(pos.getX(),pos.getY(),pos.getZ());
    }
}
