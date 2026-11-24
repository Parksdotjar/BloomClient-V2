package org.bloomclient.cosmetics;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import org.joml.Matrix3f;
import org.joml.Matrix4f;
import org.joml.Vector3f;

//? if <26.1 {
import net.fabricmc.fabric.api.client.rendering.v1.LivingEntityFeatureRendererRegistrationCallback;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayers;
import net.minecraft.client.render.command.OrderedRenderCommandQueue;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.render.entity.feature.FeatureRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import net.minecraft.client.util.math.MatrixStack;
//?} else {
/*import com.mojang.blaze3d.vertex.PoseStack;
import net.fabricmc.fabric.api.client.rendering.v1.LivingEntityRenderLayerRegistrationCallback;
import net.minecraft.client.model.player.PlayerModel;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.entity.RenderLayerParent;
import net.minecraft.client.renderer.entity.layers.RenderLayer;
import net.minecraft.client.renderer.entity.player.AvatarRenderer;
import net.minecraft.client.renderer.entity.state.AvatarRenderState;
import net.minecraft.client.renderer.rendertype.RenderTypes;
import net.minecraft.client.renderer.texture.OverlayTexture;
*///?}

//? if <26.1 {
final class DelightWingLayer extends FeatureRenderer<PlayerEntityRenderState, PlayerEntityModel> {
    DelightWingLayer(FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context) { super(context); }

    @SuppressWarnings("unchecked")
    static void register() {
        LivingEntityFeatureRendererRegistrationCallback.EVENT.register((entityType, renderer, helper, context) -> {
            if (renderer instanceof PlayerEntityRenderer player) helper.register(new DelightWingLayer(player));
        });
    }

    @Override
    public void render(MatrixStack matrices, OrderedRenderCommandQueue queue, int light, PlayerEntityRenderState state, float limbAngle, float limbDistance) {
        DelightWings.Equipped asset = equipped(state.id);
        if (asset == null) return;
        matrices.push();
        try {
            getContextModel().getRootPart().applyTransform(matrices);
            getContextModel().body.applyTransform(matrices);
            matrices.scale(.0625f, -.0625f, -.0625f);
            matrices.translate(0, -5, -2);
            var animated = asset.model().pose(System.nanoTime() / 1_000_000L);
            for (var batch : asset.model().batches()) {
                var texture = asset.textures().get(batch.texture());
                if (texture == null) continue;
                var transform = animated[batch.matrix()];
                int tint = gameColor(batch.rgb(asset.colors()));
                queue.submitCustom(matrices, RenderLayers.entityCutoutNoCull(texture), (entry, consumer) ->
                    emit(batch.vertices(), transform, (point, normal, u, v) ->
                        consumer.vertex(entry, point.x, point.y, point.z).color(tint)
                            .texture(u, v).overlay(OverlayTexture.DEFAULT_UV).light(light)
                            .normal(entry, normal.x, normal.y, normal.z)));
            }
        } finally { matrices.pop(); }
    }
//?} else {
/*final class DelightWingLayer extends RenderLayer<AvatarRenderState, PlayerModel> {
    DelightWingLayer(RenderLayerParent<AvatarRenderState, PlayerModel> context) { super(context); }

    static void register() {
        LivingEntityRenderLayerRegistrationCallback.EVENT.register((entityType, renderer, helper, context) -> {
            if (renderer instanceof AvatarRenderer<?> player) helper.register(new DelightWingLayer(player));
        });
    }

    @Override
    public void submit(PoseStack matrices, SubmitNodeCollector queue, int light, AvatarRenderState state, float limbAngle, float limbDistance) {
        DelightWings.Equipped asset = equipped(state.id);
        if (asset == null) return;
        matrices.pushPose();
        try {
            getParentModel().root().translateAndRotate(matrices);
            getParentModel().body.translateAndRotate(matrices);
            matrices.scale(.0625f, -.0625f, -.0625f);
            matrices.translate(0, -5, -2);
            var animated = asset.model().pose(System.nanoTime() / 1_000_000L);
            for (var batch : asset.model().batches()) {
                var texture = asset.textures().get(batch.texture());
                if (texture == null) continue;
                var transform = animated[batch.matrix()];
                int tint = gameColor(batch.rgb(asset.colors()));
                queue.submitCustomGeometry(matrices, RenderTypes.entityCutout(texture), (entry, consumer) ->
                    emit(batch.vertices(), transform, (point, normal, u, v) ->
                        consumer.addVertex(entry, point).setColor(tint)
                            .setUv(u, v).setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(entry, normal)));
            }
        } finally { matrices.popPose(); }
    }
*///?}

    static DelightWings.Equipped equipped(int entityId) {
        MinecraftClient client = MinecraftClient.getInstance();
        //? if <26.1 {
        if (client.world == null || !(client.world.getEntityById(entityId) instanceof AbstractClientPlayerEntity player)) return null;
        //?} else {
        /*if (client.world == null || !(client.world.getEntity(entityId) instanceof AbstractClientPlayerEntity player)) return null;
        *///?}
        if (player.isInvisible()) return null;
        return DelightWings.get().forPlayer(BloomCosmeticsRuntime.stableIdentity(client, player), player == client.player);
    }

    private static int gameColor(int rgb) {
        int r = Math.max(16, rgb >> 16 & 255), g = Math.max(16, rgb >> 8 & 255), b = Math.max(16, rgb & 255);
        return 0xff000000 | (r << 16) | (g << 8) | b;
    }

    private interface VertexWriter { void write(Vector3f point, Vector3f normal, float u, float v); }

    private static void emit(float[] vertices, Matrix4f matrix, VertexWriter write) {
        Matrix3f normals = matrix.normal(new Matrix3f());
        Vector3f point = new Vector3f(), normal = new Vector3f();
        for (int i = 0; i < vertices.length; i += 8) {
            matrix.transformPosition(point.set(vertices[i], vertices[i + 1], vertices[i + 2]));
            normals.transform(normal.set(vertices[i + 3], vertices[i + 4], vertices[i + 5])).normalize();
            write.write(point, normal, vertices[i + 6], vertices[i + 7]);
        }
    }
}
