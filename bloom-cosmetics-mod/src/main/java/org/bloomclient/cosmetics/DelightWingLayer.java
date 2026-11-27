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
    private final boolean hat;
    DelightWingLayer(FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> context, boolean hat) {
        super(context);
        this.hat = hat;
    }

    @SuppressWarnings("unchecked")
    static void register() {
        LivingEntityFeatureRendererRegistrationCallback.EVENT.register((entityType, renderer, helper, context) -> {
            if (renderer instanceof PlayerEntityRenderer player) {
                helper.register(new DelightWingLayer(player, false));
                helper.register(new DelightWingLayer(player, true));
            }
        });
    }

    @Override
    public void render(MatrixStack matrices, OrderedRenderCommandQueue queue, int light, PlayerEntityRenderState state, float limbAngle, float limbDistance) {
        DelightWings.Equipped asset = equipped(state.id, hat);
        if (asset == null) return;
        matrices.push();
        try {
            getContextModel().getRootPart().applyTransform(matrices);
            (hat ? getContextModel().head : getContextModel().body).applyTransform(matrices);
            matrices.scale(.0625f, -.0625f, -.0625f);
            if (hat) matrices.translate(0, 7.375f, 0);
            else matrices.translate(0, -5, -2);
            long milliseconds = System.nanoTime() / 1_000_000L;
            var animated = asset.model().pose(milliseconds);
            for (var batch : asset.model().batches()) {
                var texture = asset.textures().get(batch.texture());
                if (texture == null) continue;
                var transform = animated[batch.matrix()];
                int tint = (asset.model().defaults() != null && batch.color() != null && !"fixed".equals(batch.tint())) ? batch.accentColor(asset.colors(), asset.model().defaults(), milliseconds) : 0xff000000 | batch.rgb(asset.colors());
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
    private final boolean hat;
    DelightWingLayer(RenderLayerParent<AvatarRenderState, PlayerModel> context, boolean hat) {
        super(context);
        this.hat = hat;
    }

    static void register() {
        LivingEntityRenderLayerRegistrationCallback.EVENT.register((entityType, renderer, helper, context) -> {
            if (renderer instanceof AvatarRenderer<?> player) {
                helper.register(new DelightWingLayer(player, false));
                helper.register(new DelightWingLayer(player, true));
            }
        });
    }

    @Override
    public void submit(PoseStack matrices, SubmitNodeCollector queue, int light, AvatarRenderState state, float limbAngle, float limbDistance) {
        DelightWings.Equipped asset = equipped(state.id, hat);
        if (asset == null) return;
        matrices.pushPose();
        try {
            getParentModel().root().translateAndRotate(matrices);
            (hat ? getParentModel().head : getParentModel().body).translateAndRotate(matrices);
            matrices.scale(.0625f, -.0625f, -.0625f);
            if (hat) matrices.translate(0, 7.375f, 0);
            else matrices.translate(0, -5, -2);
            long milliseconds = System.nanoTime() / 1_000_000L;
            var animated = asset.model().pose(milliseconds);
            for (var batch : asset.model().batches()) {
                var texture = asset.textures().get(batch.texture());
                if (texture == null) continue;
                var transform = animated[batch.matrix()];
                int tint = (asset.model().defaults() != null && batch.color() != null && !"fixed".equals(batch.tint())) ? batch.accentColor(asset.colors(), asset.model().defaults(), milliseconds) : 0xff000000 | batch.rgb(asset.colors());
                queue.submitCustomGeometry(matrices, RenderTypes.entityCutout(texture), (entry, consumer) ->
                    emit(batch.vertices(), transform, (point, normal, u, v) ->
                        consumer.addVertex(entry, point).setColor(tint)
                            .setUv(u, v).setOverlay(OverlayTexture.NO_OVERLAY).setLight(light).setNormal(entry, normal)));
            }
        } finally { matrices.popPose(); }
    }
*///?}

    static DelightWings.Equipped equipped(int entityId) {
        return equipped(entityId, false);
    }

    private static DelightWings.Equipped equipped(int entityId, boolean hat) {
        MinecraftClient client = MinecraftClient.getInstance();
        //? if <26.1 {
        if (client.world == null || !(client.world.getEntityById(entityId) instanceof AbstractClientPlayerEntity player)) return null;
        //?} else {
        /*if (client.world == null || !(client.world.getEntity(entityId) instanceof AbstractClientPlayerEntity player)) return null;
        *///?}
        if (player.isInvisible()) return null;
        //? if <26.1 {
        if (hat && !player.getEquippedStack(net.minecraft.entity.EquipmentSlot.HEAD).isEmpty()) return null;
        //?} else {
        /*if (hat && !player.getItemBySlot(net.minecraft.entity.EquipmentSlot.HEAD).isEmpty()) return null;
        *///?}
        return (hat ? DelightWings.hats() : DelightWings.get()).forPlayer(BloomCosmeticsRuntime.stableIdentity(client, player), player == client.player);
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
