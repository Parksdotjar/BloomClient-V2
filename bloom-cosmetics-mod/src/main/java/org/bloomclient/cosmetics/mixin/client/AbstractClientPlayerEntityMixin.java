package org.bloomclient.cosmetics.mixin.client;

import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.entity.player.SkinTextures;
import net.minecraft.util.AssetInfo;
import net.minecraft.util.Identifier;
import org.bloomclient.cosmetics.BloomCapeService;
import org.bloomclient.cosmetics.BloomWingService;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(AbstractClientPlayerEntity.class)
public abstract class AbstractClientPlayerEntityMixin {
    @Inject(method = "getSkin", at = @At("RETURN"), cancellable = true)
    private void bloom$applyCape(CallbackInfoReturnable<SkinTextures> callback) {
        AbstractClientPlayerEntity player = (AbstractClientPlayerEntity) (Object) this;
        SkinTextures current = callback.getReturnValue();
        if (BloomWingService.get().shouldHideCape(player.getUuid())) {
            callback.setReturnValue(new SkinTextures(
                current.body(),
                null,
                null,
                current.model(),
                current.secure()
            ));
            return;
        }
        Identifier cape = BloomCapeService.get().textureFor(player.getUuid());
        if (cape == null) return;

        AssetInfo.TextureAsset bloomCape = new AssetInfo.TextureAsset() {
            @Override
            public Identifier id() {
                return cape;
            }

            @Override
            public Identifier texturePath() {
                return cape;
            }
        };
        callback.setReturnValue(new SkinTextures(
            current.body(),
            bloomCape,
            bloomCape,
            current.model(),
            current.secure()
        ));
    }
}
