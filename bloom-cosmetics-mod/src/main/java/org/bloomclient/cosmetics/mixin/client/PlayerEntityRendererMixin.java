package org.bloomclient.cosmetics.mixin.client;

import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.PlayerEntityRenderer;
import net.minecraft.client.render.entity.feature.FeatureRendererContext;
import net.minecraft.client.render.entity.model.PlayerEntityModel;
import net.minecraft.client.render.entity.state.PlayerEntityRenderState;
import org.bloomclient.cosmetics.BloomHatFeatureRenderer;
import org.bloomclient.cosmetics.BloomWingFeatureRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(PlayerEntityRenderer.class)
public abstract class PlayerEntityRendererMixin {
    @SuppressWarnings("unchecked")
    @Inject(method = "<init>", at = @At("TAIL"))
    private void bloom$addHatRenderer(EntityRendererFactory.Context context, boolean thinArms, CallbackInfo callback) {
        FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel> renderer =
            (FeatureRendererContext<PlayerEntityRenderState, PlayerEntityModel>) (Object) this;
        ((LivingEntityRendererAccessor) (Object) this).bloom$addFeature(new BloomHatFeatureRenderer(renderer));
        ((LivingEntityRendererAccessor) (Object) this).bloom$addFeature(new BloomWingFeatureRenderer(renderer));
    }
}
