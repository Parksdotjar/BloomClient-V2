package org.bloomclient.cosmetics.mixin.client;

import org.bloomclient.cosmetics.tweaks.VisualTweaks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArgs;
import org.spongepowered.asm.mixin.injection.invoke.arg.Args;

//? if <26.1 {
@Mixin(net.minecraft.client.render.WorldRenderer.class)
//?} else {
/*@Mixin(net.minecraft.client.renderer.LevelRenderer.class)
*///?}
abstract class TweaksBlockOutlineMixin {
    //? if <26.1 {
    @ModifyArgs(method = "renderTargetBlockOutline", at = @At(value = "INVOKE", ordinal = 1,
        target = "Lnet/minecraft/client/render/WorldRenderer;drawBlockOutline(Lnet/minecraft/client/util/math/MatrixStack;Lnet/minecraft/client/render/VertexConsumer;DDDLnet/minecraft/client/render/state/OutlineRenderState;IF)V"))
    //?} elif <26.2 {
    /*@ModifyArgs(method = "renderBlockOutline", at = @At(value = "INVOKE", ordinal = 1,
        target = "Lnet/minecraft/client/renderer/LevelRenderer;renderHitOutline(Lcom/mojang/blaze3d/vertex/PoseStack;Lcom/mojang/blaze3d/vertex/VertexConsumer;DDDLnet/minecraft/client/renderer/state/level/BlockOutlineRenderState;IF)V"))
    *///?} else {
    /*@ModifyArgs(method = "submitBlockOutline", at = @At(value = "INVOKE", ordinal = 1,
        target = "Lnet/minecraft/client/renderer/LevelRenderer;submitHitOutline(Lcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/SubmitNodeCollector;Lnet/minecraft/client/renderer/rendertype/RenderType;Lnet/minecraft/client/renderer/state/level/BlockOutlineRenderState;IFZ)V"))
    *///?}
    private void delightOutline(Args args) {
        if (!VisualTweaks.customOutline()) return;
        //? if <26.2 {
        int color = 6;
        //?} else {
        /*int color = 4;
        *///?}
        args.set(color,VisualTweaks.outlineColor());
        args.set(color + 1,VisualTweaks.outlineWidth(args.<Float>get(color + 1)));
    }
}
