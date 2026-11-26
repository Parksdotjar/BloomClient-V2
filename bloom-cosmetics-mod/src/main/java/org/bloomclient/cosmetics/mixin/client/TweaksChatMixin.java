package org.bloomclient.cosmetics.mixin.client;

import java.time.LocalTime;
import java.util.Map;
import java.util.WeakHashMap;
import org.bloomclient.cosmetics.tweaks.DelightTweaks;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

//? if <26.1 {
import net.minecraft.client.gui.hud.ChatHudLine;
@Mixin(net.minecraft.client.gui.hud.ChatHud.class)
//?} else {
/*import net.minecraft.client.multiplayer.chat.GuiMessage;
@Mixin(net.minecraft.client.gui.components.ChatComponent.class)
*///?}
abstract class TweaksChatMixin {
    @Unique private final Map<Object, LocalTime> delightReceived = new WeakHashMap<>();

    //? if <26.1 {
    @ModifyVariable(method = "addVisibleMessage", at = @At("HEAD"), argsOnly = true)
    private ChatHudLine delightTimestamp(ChatHudLine line) {
        var decorated = DelightTweaks.timestampChat(line.content(),delightReceived.computeIfAbsent(line, key -> LocalTime.now()));
        return decorated == line.content() ? line : new ChatHudLine(line.creationTick(),decorated,line.signature(),line.indicator());
    }
    //?} else {
    /*@ModifyVariable(method = "addMessageToDisplayQueue", at = @At("HEAD"), argsOnly = true)
    private GuiMessage delightTimestamp(GuiMessage line) {
        var decorated = DelightTweaks.timestampChat(line.content(),delightReceived.computeIfAbsent(line, key -> LocalTime.now()));
        return decorated == line.content() ? line : new GuiMessage(line.addedTime(),decorated,line.signature(),line.source(),line.tag());
    }
    *///?}
}
