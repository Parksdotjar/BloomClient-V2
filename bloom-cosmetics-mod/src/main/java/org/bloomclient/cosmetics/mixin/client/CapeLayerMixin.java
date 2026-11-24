package org.bloomclient.cosmetics.mixin.client;

import org.bloomclient.cosmetics.DelightWings;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

//? if <26.1 {
import net.minecraft.client.render.command.OrderedRenderCommandQueue;
import net.minecraft.client.render.entity.feature.CapeFeatureRenderer;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.client.util.math.MatrixStack;

@Mixin(CapeFeatureRenderer.class)
abstract class CapeLayerMixin {
    @Inject(method = "render(Lnet/minecraft/client/util/math/MatrixStack;Lnet/minecraft/client/render/command/OrderedRenderCommandQueue;ILnet/minecraft/client/render/entity/state/PlayerEntityRenderState;FF)V", at = @At("HEAD"), cancellable = true)
    private void delight$yieldToWings(MatrixStack matrices, OrderedRenderCommandQueue queue, int light,
                                      PlayerEntityRenderState state, float angle, float distance, CallbackInfo callback) {
        if (DelightWings.rendersOnEntity(state.id)) callback.cancel();
    }
}
//?} else {
/*import com.mojang.blaze3d.vertex.PoseStack;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.layers.CapeLayer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;

@Mixin(CapeLayer.class)
abstract class CapeLayerMixin {
    @Inject(method = "submit(Lcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/SubmitNodeCollector;ILnet/minecraft/client/renderer/entity/state/AvatarRenderState;FF)V", at = @At("HEAD"), cancellable = true)
    private void delight$yieldToWings(PoseStack matrices, SubmitNodeCollector queue, int light,
                                      AvatarRenderState state, float angle, float distance, CallbackInfo callback) {
        if (DelightWings.rendersOnEntity(state.id)) callback.cancel();
    }
}
*///?}
