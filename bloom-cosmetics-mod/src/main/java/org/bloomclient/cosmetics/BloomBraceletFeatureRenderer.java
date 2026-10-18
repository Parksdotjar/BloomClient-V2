//? if <26.1 {
package org.bloomclient.cosmetics;

import net.minecraft.client.render.RenderLayers;
import net.minecraft.client.render.command.OrderedRenderCommandQueue;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.RotationAxis;

public final class BloomBraceletFeatureRenderer extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
    public BloomBraceletFeatureRenderer(FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context) { super(context); }
    @Override public void render(MatrixStack matrices, OrderedRenderCommandQueue queue, int light, PlayerEntityRenderState state, float limbAngle, float limbDistance) {
        BloomBraceletService.BraceletAsset asset = BloomBraceletService.get().assetFor(state.id);
        if (asset == null) return;
        matrices.push();
        getContextModel().getRootPart().applyTransform(matrices);
        if (asset.leftArm()) getContextModel().leftArm.applyTransform(matrices); else getContextModel().rightArm.applyTransform(matrices);
        matrices.translate(asset.offsetX()/16f, asset.offsetY()/16f, asset.offsetZ()/16f);
        matrices.translate(asset.pivotX()/16f, asset.pivotY()/16f, asset.pivotZ()/16f);
        matrices.multiply(RotationAxis.POSITIVE_X.rotationDegrees(asset.rotationX()));
        matrices.multiply(RotationAxis.POSITIVE_Y.rotationDegrees(asset.rotationY()));
        matrices.multiply(RotationAxis.POSITIVE_Z.rotationDegrees(asset.rotationZ()));
        matrices.translate(-asset.pivotX()/16f, -asset.pivotY()/16f, -asset.pivotZ()/16f);
        matrices.scale(asset.scale(), asset.scale(), asset.scale());
        queue.submitCustom(matrices, RenderLayers.entityCutoutNoCull(asset.texture()), (entry, consumer) -> asset.mesh().render(entry, consumer, light));
        matrices.pop();
    }
}

//?}
