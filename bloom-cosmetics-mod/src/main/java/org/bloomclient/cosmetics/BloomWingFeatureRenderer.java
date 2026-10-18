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

public final class BloomWingFeatureRenderer extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
    public BloomWingFeatureRenderer(FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context) {
        super(context);
    }

    @Override
    public void render(MatrixStack matrices, OrderedRenderCommandQueue queue, int light, PlayerEntityRenderState state, float limbAngle, float limbDistance) {
        BloomWingService.WingAsset asset = BloomWingService.get().assetFor(state.id);
        if (asset == null) return;
        matrices.push();
        getContextModel().getRootPart().applyTransform(matrices);
        getContextModel().body.applyTransform(matrices);
        matrices.translate(asset.offsetX() / 16.0f, asset.offsetY() / 16.0f, asset.offsetZ() / 16.0f);
        matrices.scale(asset.scale(), asset.scale(), asset.scale());
        BloomHatMesh.Animation animation = asset.mesh().animation();
        if (animation.type() != BloomHatMesh.AnimationType.FLAP) {
            queue.submitCustom(matrices, RenderLayers.entityCutoutNoCull(asset.texture()),
                (entry, consumer) -> asset.mesh().render(entry, consumer, light));
            matrices.pop();
            return;
        }

        float angle = (float) Math.sin(System.nanoTime() * 1.0e-9 * animation.speed() * Math.PI * 2.0) * animation.amplitude();
        RotationAxis flapAxis = switch (animation.axis()) {
            case X -> RotationAxis.POSITIVE_X;
            case Y -> RotationAxis.POSITIVE_Y;
            case Z -> RotationAxis.POSITIVE_Z;
        };
        if (asset.mesh().hasWingFixed()) {
            queue.submitCustom(matrices, RenderLayers.entityCutoutNoCull(asset.texture()),
                (entry, consumer) -> asset.mesh().renderWingFixed(entry, consumer, light));
        }
        if (asset.mesh().hasWingLeft()) {
            matrices.push();
            BloomHatMesh.Pivot pivot = asset.mesh().leftFlapPivot();
            matrices.translate(pivot.x(), pivot.y(), pivot.z());
            matrices.multiply(flapAxis.rotationDegrees(angle));
            matrices.translate(-pivot.x(), -pivot.y(), -pivot.z());
            queue.submitCustom(matrices, RenderLayers.entityCutoutNoCull(asset.texture()),
                (entry, consumer) -> asset.mesh().renderWingLeft(entry, consumer, light));
            matrices.pop();
        }
        if (asset.mesh().hasWingRight()) {
            matrices.push();
            BloomHatMesh.Pivot pivot = asset.mesh().rightFlapPivot();
            matrices.translate(pivot.x(), pivot.y(), pivot.z());
            matrices.multiply(flapAxis.rotationDegrees(-angle));
            matrices.translate(-pivot.x(), -pivot.y(), -pivot.z());
            queue.submitCustom(matrices, RenderLayers.entityCutoutNoCull(asset.texture()),
                (entry, consumer) -> asset.mesh().renderWingRight(entry, consumer, light));
            matrices.pop();
        }
        matrices.pop();
    }
}

//?}
