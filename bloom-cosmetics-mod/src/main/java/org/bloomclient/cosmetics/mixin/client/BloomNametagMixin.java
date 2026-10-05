package org.bloomclient.cosmetics.mixin.client;

import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.client.render.entity.state.EntityRenderState;
import net.minecraft.entity.Entity;
import net.minecraft.text.Text;
import net.minecraft.text.Style;
import net.minecraft.text.StyleSpriteSource;
import net.minecraft.util.Identifier;
import org.bloomclient.cosmetics.BloomPresence;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(EntityRenderer.class)
public abstract class BloomNametagMixin {
    @Inject(method="updateRenderState",at=@At("RETURN"),require=0)
    private void bloom$badge(Entity entity, EntityRenderState state, float tickProgress, CallbackInfo callback) {
        if (!(entity instanceof AbstractClientPlayerEntity) || state.displayName==null || !BloomPresence.visible(entity.getUuid())) return;
        // Modify the existing label only. Vanilla owns its background, visibility,
        // centering and depth passes; there is never a second label draw here.
        if (state.displayName.getString().indexOf('\uE042')>=0) return;
        Text glyph=Text.literal("\uE042").setStyle(Style.EMPTY
            .withFont(new StyleSpriteSource.Font(Identifier.of("bloom_cosmetics","badge")))
            .withColor(0xffffff).withBold(false).withoutShadow());
        state.displayName=Text.empty().append(glyph).append(" ").append(state.displayName);
    }
}
