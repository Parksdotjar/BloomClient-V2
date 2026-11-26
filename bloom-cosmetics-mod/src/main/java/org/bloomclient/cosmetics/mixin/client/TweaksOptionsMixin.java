package org.bloomclient.cosmetics.mixin.client;

import org.bloomclient.cosmetics.tweaks.DelightTweaks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;

//? if <26.1 {
import net.minecraft.client.gui.screen.option.OptionsScreen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.DirectionalLayoutWidget;
import net.minecraft.client.gui.widget.Widget;

@Mixin(OptionsScreen.class)
abstract class TweaksOptionsMixin {
    @ModifyArg(method = "init", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/widget/ThreePartsLayoutWidget;addFooter(Lnet/minecraft/client/gui/widget/Widget;)Lnet/minecraft/client/gui/widget/Widget;"))
    private Widget delightFooter(Widget done) {
        var row = DirectionalLayoutWidget.horizontal().spacing(4);
        ((ButtonWidget)done).setWidth(150);
        row.add(ButtonWidget.builder(Text.literal("Delight Tweaks…"), b -> DelightTweaks.open((Screen)(Object)this)).width(150).build());
        row.add(done);
        return row;
    }
}
//?} else {
/*import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.layouts.LayoutElement;
import net.minecraft.client.gui.layouts.LinearLayout;
import net.minecraft.client.gui.screens.options.OptionsScreen;

@Mixin(OptionsScreen.class)
abstract class TweaksOptionsMixin {
    @ModifyArg(method = "init", at = @At(value = "INVOKE", target = "Lnet/minecraft/client/gui/layouts/HeaderAndFooterLayout;addToFooter(Lnet/minecraft/client/gui/layouts/LayoutElement;)Lnet/minecraft/client/gui/layouts/LayoutElement;"))
    private LayoutElement delightFooter(LayoutElement done) {
        var row = LinearLayout.horizontal().spacing(4);
        ((Button)done).setWidth(150);
        row.addChild(Button.builder(Text.literal("Delight Tweaks…"), b -> DelightTweaks.open((Screen)(Object)this)).width(150).build());
        row.addChild(done);
        return row;
    }
}
*///?}
