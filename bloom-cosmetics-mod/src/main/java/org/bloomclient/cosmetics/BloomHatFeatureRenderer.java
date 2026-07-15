package org.bloomclient.cosmetics;

import net.minecraft.client.render.RenderLayers;
import net.minecraft.client.render.command.OrderedRenderCommandQueue;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.client.util.math.MatrixStack;

public final class BloomHatFeatureRenderer extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
    public BloomHatFeatureRenderer(FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context) {
        super(context);
    }

    @Override
    public void render(MatrixStack matrices, OrderedRenderCommandQueue queue, int light, PlayerEntityRenderState state, float limbAngle, float limbDistance) {
        BloomHatService.HatAsset asset = BloomHatService.get().assetFor(state.id);
        if (asset == null || (asset.hideWithHelmet() && !state.equippedHeadStack.isEmpty())) return;
        matrices.push();
        getContextModel().getRootPart().applyTransform(matrices);
        getContextModel().head.applyTransform(matrices);
        matrices.translate(asset.offsetX() / 16.0f, asset.offsetY() / 16.0f, asset.offsetZ() / 16.0f);
        matrices.scale(asset.scale(), asset.scale(), asset.scale());
        queue.submitCustom(matrices, RenderLayers.entityCutoutNoCull(asset.texture()),
            (entry, consumer) -> asset.mesh().render(entry, consumer, light));
        matrices.pop();
    }
}
