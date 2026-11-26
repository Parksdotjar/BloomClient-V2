package org.bloomclient.cosmetics.tweaks;

import java.util.ArrayDeque;
import java.time.LocalTime;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.minecraft.util.Identifier;
import net.minecraft.text.Text;

public final class DelightTweaks implements ClientModInitializer {
    static final int PRIMARY = InputUtil.GLFW_MOUSE_BUTTON_LEFT;
    static final int SECONDARY = InputUtil.GLFW_MOUSE_BUTTON_RIGHT;
    private static KeyBinding menu, zoom, capture, inventoryPreview;
    private static boolean zooming, toggled;
    private static int strength;
    private static double factor = 1;
    private static long lastFrame;
    private static final ArrayDeque<Long> left = new ArrayDeque<>(), right = new ArrayDeque<>();

    @Override public void onInitializeClient() {
        Preferences.load();
        var category = KeyBinding.Category.create(Identifier.of("bloom_cosmetics", "tweaks"));
        //? if <26.1 {
        int shift = InputUtil.GLFW_KEY_RIGHT_SHIFT;
        //?} else {
        /*int shift = com.mojang.blaze3d.platform.InputConstants.KEY_RSHIFT;
        *///?}
        menu = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.delight_tweaks.menu", shift, category));
        zoom = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.delight_tweaks.zoom", InputUtil.GLFW_KEY_C, category));
        capture = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.delight_tweaks.screenshot", InputUtil.GLFW_KEY_F8, category));
        inventoryPreview = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.delight_tweaks.inventory_preview", InputUtil.GLFW_KEY_I, category));
        ClientTickEvents.END_CLIENT_TICK.register(DelightTweaks::tick);
        HudElementRegistry.attachElementAfter(VanillaHudElements.HOTBAR, Identifier.of("bloom_cosmetics", "tweaks"),
            (graphics, delta) -> {
                var client = MinecraftClient.getInstance();
                if (client.player != null && !(client.currentScreen instanceof HudEditor)) {
                    Hud.draw(graphics, false);
                }
            });
    }

    public static void open(Screen parent) {
        MinecraftClient.getInstance().setScreen(TweaksMenu.home(parent));
    }

    static boolean playing() {
        var client = MinecraftClient.getInstance();
        return client.player != null && client.currentScreen == null && client.isWindowFocused();
    }

    private static void tick(MinecraftClient client) {
        Hud.refresh();
        while (menu.wasPressed()) if (playing()) open(null);
        boolean captureRequested = false;
        while (capture.wasPressed()) captureRequested = true;
        CameraTweaks.tick(captureRequested);
        while (inventoryPreview.wasPressed()) { /* Consume presses because the preview uses held state. */ }
        WorldReadouts.sampleSpeed(client);
        VisualTweaks.tickParticles(client);
        boolean available = playing() && Preferences.on(Feature.ZOOM, Setting.ENABLED);
        while (zoom.wasPressed()) if (available) toggled = !toggled;
        boolean active = available && (Preferences.on(Feature.ZOOM, Setting.MODE) ? toggled : zoom.isPressed());
        if (!available || !Preferences.on(Feature.ZOOM, Setting.MODE)) toggled = false;
        if (active && !zooming) strength = Preferences.get(Feature.ZOOM, Setting.STRENGTH);
        zooming = active;
        if (!available) factor = 1;
        if (!playing()) {
            left.clear();
            right.clear();
        }
    }

    public static float fov(float original) {
        long now = System.nanoTime();
        double seconds = Math.clamp((now - lastFrame) * 1e-9, 0, .25);
        lastFrame = now;
        double target = zooming && playing() ? 1.0 / strength : 1;
        if (Preferences.on(Feature.ZOOM, Setting.SMOOTH) && playing()) {
            factor += (target - factor) * -Math.expm1(-seconds * 19);
        } else factor = target;
        if (Math.abs(target - factor) < .0001) factor = target;
        return (float)(original * factor);
    }

    public static double sensitivity() {
        return zooming && playing() ? Preferences.get(Feature.ZOOM, Setting.SENSITIVITY) / 100.0 : 1;
    }

    public static boolean scroll(double amount) {
        if (!zooming || !playing() || !Preferences.on(Feature.ZOOM, Setting.SCROLL) || amount == 0) return false;
        strength = Math.clamp(strength + (int)Math.signum(amount), 2, 12);
        return true;
    }

    static boolean inventoryPreviewHeld() {
        return playing() && inventoryPreview.isPressed();
    }

    public static double hotbarScrollFactor() {
        var client = MinecraftClient.getInstance();
        if (!playing() || client.player.isSpectator() || !Preferences.on(Feature.HOTBAR_SCROLL, Setting.ENABLED)) return 1;
        double gain = Preferences.get(Feature.HOTBAR_SCROLL, Setting.SCROLL_GAIN) / 100.0;
        return Preferences.on(Feature.HOTBAR_SCROLL, Setting.SCROLL_DIRECTION) ? -gain : gain;
    }

    public static boolean customHotbarScroll() {
        return Preferences.on(Feature.HOTBAR_SCROLL, Setting.ENABLED);
    }

    public static int hotbarSlot(double delta, int selected, int slots) {
        return hotbarSlot(delta, selected, slots, Preferences.on(Feature.HOTBAR_SCROLL, Setting.SCROLL_WRAP));
    }

    static int hotbarSlot(double delta, int selected, int slots, boolean stopAtEdges) {
        int next = selected - (int)delta;
        return stopAtEdges ? Math.clamp(next,0,slots - 1) : Math.floorMod(next,slots);
    }

    public static Text timestampChat(Text message, LocalTime received) {
        var f = Feature.CHAT_TIMESTAMPS;
        if (!Preferences.on(f, Setting.ENABLED)) return message;
        String stamp = WorldReadouts.formatTime(received, Preferences.on(f, Setting.TIME_FORMAT), false);
        return Text.empty().append(Text.literal("[" + stamp + "] ").withColor(0xAAAAAA)).append(message);
    }

    static void refreshChat() {
        var client = MinecraftClient.getInstance();
        //? if <26.1 {
        client.inGameHud.getChatHud().reset();
        //?} elif <26.2 {
        /*client.gui.getChat().rescaleChat();
        *///?} else {
        /*client.gui.hud.getChat().rescaleChat();
        *///?}
    }

    static void showChat(Text message) {
        var client = MinecraftClient.getInstance();
        //? if <26.1 {
        client.inGameHud.getChatHud().addMessage(message);
        //?} elif <26.2 {
        /*client.gui.getChat().addClientSystemMessage(message);
        *///?} else {
        /*client.gui.hud.getChat().addClientSystemMessage(message);
        *///?}
    }

    public static void click(int button, int action) {
        if (action != 1 || (button != PRIMARY && button != SECONDARY) || !playing() || !Preferences.on(Feature.CPS, Setting.ENABLED)) return;
        var queue = button == PRIMARY ? left : right;
        recent(queue);
        queue.addLast(System.nanoTime());
    }

    private static int recent(ArrayDeque<Long> queue) {
        long cutoff = System.nanoTime() - 1_000_000_000L;
        while (!queue.isEmpty() && queue.peekFirst() <= cutoff) queue.removeFirst();
        return queue.size();
    }

    static int clicks(boolean primary) { return recent(primary ? left : right); }
}
