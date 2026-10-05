package org.bloomclient.cosmetics.mixin.client;

import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.entity.player.SkinTextures;
import net.minecraft.util.AssetInfo;
import net.minecraft.util.Identifier;
import org.bloomclient.cosmetics.BloomCapeService;
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
        Identifier cape = BloomCapeService.get().textureFor(player.getUuid());
        if (cape == null) return;
        Identifier elytra = BloomCapeService.get().elytraTextureFor(player.getUuid());

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
        AssetInfo.TextureAsset bloomElytra = new AssetInfo.TextureAsset() {
            @Override
            public Identifier id() { return elytra == null ? cape : elytra; }

            @Override
            public Identifier texturePath() { return elytra == null ? cape : elytra; }
        };
        callback.setReturnValue(new SkinTextures(
            current.body(),
            bloomCape,
            bloomElytra,
            current.model(),
            current.secure()
        ));
    }
}
