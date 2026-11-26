package org.bloomclient.cosmetics.mixin.client;

import com.llamalad7.mixinextras.injector.wrapoperation.Operation;
import com.llamalad7.mixinextras.injector.wrapoperation.WrapOperation;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.util.Identifier;
import org.bloomclient.cosmetics.tweaks.CameraTweaks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;

//? if <26.1 {
import com.mojang.blaze3d.pipeline.RenderPipeline;
@Mixin(net.minecraft.client.gui.hud.InGameHud.class)
//?} elif <26.2 {
/*import com.mojang.blaze3d.pipeline.RenderPipeline;
@Mixin(net.minecraft.client.gui.Gui.class)
*///?} elif <26.3 {
/*import com.mojang.blaze3d.pipeline.RenderPipeline;
@Mixin(net.minecraft.client.gui.Hud.class)
*///?} else {
/*import com.mojang.renderpearl.api.pipeline.RenderPipeline;
@Mixin(net.minecraft.client.gui.Hud.class)
*///?}
abstract class TweaksCrosshairMixin {
    //? if <26.1 {
    @WrapOperation(method = "renderCrosshair", at = @At(value = "INVOKE", ordinal = 0,
        target = "Lnet/minecraft/client/gui/DrawContext;drawGuiTexture(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/util/Identifier;IIII)V"))
    //?} elif <26.3 {
    /*@WrapOperation(method = "extractCrosshair", at = @At(value = "INVOKE", ordinal = 0,
        target = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;blitSprite(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIII)V"))
    *///?} else {
    /*@WrapOperation(method = "extractCrosshair", at = @At(value = "INVOKE", ordinal = 0,
        target = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;blitSprite(Lcom/mojang/renderpearl/api/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIII)V"))
    *///?}
    private void delightCrosshair(DrawContext g, RenderPipeline pipeline, Identifier sprite,
                                  int x, int y, int width, int height, Operation<Void> original) {
        if (!CameraTweaks.crosshair(g,x + width / 2,y + height / 2)) {
            original.call(g,pipeline,sprite,x,y,width,height);
        }
    }
}
