package org.bloomclient.cosmetics.tweaks;

import java.util.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gl.RenderPipelines;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.registry.Registries;
import net.minecraft.util.Arm;
import net.minecraft.util.Identifier;
import static org.bloomclient.cosmetics.tweaks.HudPlacement.*;
import static org.bloomclient.cosmetics.tweaks.Setting.*;

final class Hud {
    static final int WHITE = -1, WARN = 0xFFFFAA55;
    static final Feature[] ELEMENTS = Arrays.stream(Feature.values()).filter(f -> f.hud).toArray(Feature[]::new);
    private static final EquipmentSlot[] SLOTS = { EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET };
    private static ItemStack sampleArmor(int slot) {
        return switch (slot) {
            case 0 -> Items.IRON_HELMET.getDefaultStack();
            case 1 -> Items.IRON_CHESTPLATE.getDefaultStack();
            case 2 -> Items.IRON_LEGGINGS.getDefaultStack();
            default -> Items.IRON_BOOTS.getDefaultStack();
        };
    }
    private static final Identifier HOTBAR_TEXTURE = Identifier.of("minecraft","hud/hotbar");
    private static final Identifier INVENTORY_SLOT = Identifier.of("minecraft","container/slot");
    private static final EnumMap<Feature, Panel> cache = new EnumMap<>(Feature.class);
    private static boolean lastPreview;
    private static int fps, ping;
    private static long nextFps, nextPing;
    private static MinecraftClient mc() { return MinecraftClient.getInstance(); }


    interface Paint { void draw(DrawContext g); }

    static final class Panel {
        final Feature f;
        final List<Paint> parts = new ArrayList<>();
        int w, h;
        final boolean shadow;
        Panel(Feature f) {
            this.f = f;
            int own = Preferences.get(f, OWN_SHADOW);
            shadow = own == 0 ? Preferences.on(null, SHADOW) : own == 2;
        }
        void add(int x, int y, int width, int height, Paint paint) {
            w = Math.max(w,x + width);
            h = Math.max(h,y + height);
            parts.add(paint);
        }
        void text(String value, int x, int y, int color) {
            add(x,y,mc().textRenderer.getWidth(value) + (shadow ? 1 : 0),10,
                g -> g.drawText(mc().textRenderer,value,x,y,color,shadow));
        }
        void item(ItemStack stack, int x, int y, boolean bars) {
            add(x,y,16,16,g -> {
                g.drawItem(stack,x,y);
                if (bars) g.drawStackOverlay(mc().textRenderer,stack,x,y);
            });
        }
        HudPlacement rect(int width, int height) {
            var player = mc().player;
            return HudPlacement.fit(f,width,height,w,h,Preferences.get(f,SCALE) / 100f,
                Preferences.position(f,true),Preferences.position(f,false), player != null && player.getMainArm() == Arm.LEFT);
        }
        int padding() { return f == Feature.ARMOR ? 0 : 2; }
    }

    static void refresh() { cache.clear(); }
    static void draw(DrawContext g, boolean preview) {
        if (lastPreview != preview) refresh();
        lastPreview = preview;
        for (var f : ELEMENTS) {
            if (!Preferences.on(f, ENABLED)) continue;
            var p = panel(f,preview);
            if (p.h == 0) continue;
            var rect = p.rect(g.getScaledWindowWidth(),g.getScaledWindowHeight());
            var m = g.getMatrices();
            m.pushMatrix();
            m.translate(rect.x(),rect.y());
            m.scale(rect.scale(),rect.scale());
            int opacity = Preferences.get(Preferences.on(f,OWN_OPACITY) ? f : null,OPACITY);
            int padding = p.padding();
            if (opacity > 0) g.fill(-padding,-padding,p.w + padding,p.h + padding,alpha(opacity));
            for (var part : p.parts) part.draw(g);
            m.popMatrix();
        }
    }
    private static int alpha(int percent) { return Math.round(percent * 2.55f) << 24; }

    static Panel panel(Feature f, boolean preview) {
        return cache.computeIfAbsent(f,k -> build(k,preview));
    }

    private static Panel build(Feature f, boolean preview) {
        var p = new Panel(f);
        var player = mc().player;
        if (player == null) return p;
        switch (f) {
            case ARMOR -> armor(p,preview);
            case CPS -> {
                int left = DelightTweaks.clicks(true), right = DelightTweaks.clicks(false);
                String value = switch (Preferences.get(f,BUTTONS)) {
                    case 1 -> Integer.toString(left);
                    case 2 -> Integer.toString(right);
                    default -> Preferences.on(f,COMBINE) ? Integer.toString(left + right) : left + " | " + right;
                };
                p.text(value + (Preferences.on(f,LABEL) ? "" : " CPS"),0,0,WHITE);
            }
            case FPS, PING -> performance(p);
            case COORDINATES -> coordinates(p);
            case KEYS -> keys(p);
            case COUNTER -> counter(p);
            case EFFECTS -> effects(p);
            case COMPASS -> WorldReadouts.compass(p,player.getYaw());
            case SPEED -> WorldReadouts.speed(p);
            case CLOCK -> WorldReadouts.clock(p,mc());
            case BIOME -> WorldReadouts.biome(p,mc());
            case INVENTORY_PREVIEW -> {
                if (preview || DelightTweaks.inventoryPreviewHeld()) inventoryPreview(p,preview);
            }
            case EQUIPMENT_ALERTS -> equipmentAlerts(p);
            case DURABILITY -> {
                int hand = Preferences.get(f,HAND);
                if (hand != 1) durability(p,player.getMainHandStack());
                if (hand != 0) durability(p,player.getOffHandStack());
            }
            default -> {}
        }
        if (preview && p.h == 0) p.text(f.label,0,0,WHITE);
        return p;
    }

    private static void armor(Panel p, boolean preview) {
        var f = p.f;
        var player = mc().player;
        boolean sample = preview && Arrays.stream(SLOTS).allMatch(s -> player.getEquippedStack(s).isEmpty());
        boolean horizontal = Preferences.on(f,HORIZONTAL);
        var armor = new ArrayList<ItemStack>(SLOTS.length);
        for (int i = 0; i < SLOTS.length; i++) {
            ItemStack stack = sample ? sampleArmor(i) : player.getEquippedStack(SLOTS[i]);
            if (!stack.isEmpty() || !Preferences.on(f,EMPTY)) armor.add(stack);
        }
        int style = Preferences.get(f,WEAR), opacity = Preferences.get(f,SLOT);
        boolean durabilityAbove = horizontal && style > 0 && armor.stream().anyMatch(stack -> stack.isDamageable());
        int x = 0, y = durabilityAbove ? 12 : 0;
        int fromY = horizontal ? 0 : 1;
        int slotHeight = horizontal ? HOTBAR_HEIGHT : HOTBAR_SLOT_SIZE;
        for (var stack : armor) {
            int sx = x, sy = y;
            p.add(sx,sy,HOTBAR_SLOT_SIZE,slotHeight,g -> {
                if (opacity > 0) g.drawGuiTexture(RenderPipelines.GUI_TEXTURED,HOTBAR_TEXTURE,HOTBAR_WIDTH,HOTBAR_HEIGHT,
                    21,fromY,sx,sy,HOTBAR_SLOT_SIZE,slotHeight,alpha(opacity) | 0xFFFFFF);
            });
            int cell = HOTBAR_SLOT_SIZE;
            if (!stack.isEmpty()) {
                p.item(stack,x + 2,y + (horizontal ? 3 : 2),style == 0);
                if (style > 0 && stack.isDamageable()) {
                    String label = remaining(stack,style == 2);
                    p.text(label,horizontal ? x : x + 23,horizontal ? 0 : y + 5,WHITE);
                    if (horizontal) cell = Math.max(cell,mc().textRenderer.getWidth(label) + 2);
                }
            }
            if (horizontal) x += cell;
            else y += HOTBAR_SLOT_SIZE;
        }
    }

    private static String remaining(ItemStack s, boolean percent) {
        int left = s.getMaxDamage() - s.getDamage();
        return percent ? Math.round(100f * left / s.getMaxDamage()) + "%" : Integer.toString(left);
    }

    private static void inventoryPreview(Panel p, boolean preview) {
        var inventory = mc().player.getInventory();
        int rows = Preferences.on(p.f, PREVIEW_HOTBAR) ? 4 : 3;
        int opacity = Preferences.get(p.f, SLOT);
        for (int row = 0; row < rows; row++) {
            for (int column = 0; column < 9; column++) {
                var stack = inventory.getStack(((row + 1) % 4) * 9 + column);
                if (stack.isEmpty() && Preferences.on(p.f, EMPTY) && !preview) continue;
                int x = column * 18, y = row * 18;
                p.add(x,y,18,18,g -> {
                    if (opacity > 0) g.drawGuiTexture(RenderPipelines.GUI_TEXTURED,INVENTORY_SLOT,x,y,18,18,alpha(opacity) | 0xFFFFFF);
                });
                if (!stack.isEmpty()) p.item(stack,x + 1,y + 1,true);
            }
        }
        if (p.h > 0) {
            p.w = 9 * 18;
            p.h = rows * 18;
        }
    }

    private static void equipmentAlerts(Panel p) {
        var player = mc().player;
        int watch = Preferences.get(p.f, ALERT_EQUIPMENT);
        if (watch != 2) for (var slot : SLOTS) warnAbout(p,player.getEquippedStack(slot));
        if (watch != 1) {
            warnAbout(p,player.getMainHandStack());
            warnAbout(p,player.getOffHandStack());
        }
    }

    private static void warnAbout(Panel p, ItemStack stack) {
        if (!stack.isDamageable()) return;
        int percent = (100 * (stack.getMaxDamage() - stack.getDamage())) / stack.getMaxDamage();
        if (percent > Preferences.get(p.f, ALERT_THRESHOLD)) return;
        if (p.h == 0) p.text("Low durability",0,0,WARN);
        p.text(stack.getName().getString() + " " + percent + "%",0,p.h + 1,WHITE);
    }

    private static void durability(Panel p, ItemStack stack) {
        if (!stack.isDamageable()) return;
        int y = p.h == 0 ? 0 : p.h + 2;
        boolean icon = !Preferences.on(p.f,ICON);
        if (icon) p.item(stack,0,y,false);
        float percent = 100f * (stack.getMaxDamage() - stack.getDamage()) / stack.getMaxDamage();
        p.text(remaining(stack,Preferences.on(p.f,PERCENT)),icon ? 19 : 0,y + (icon ? 4 : 0),
            percent < Preferences.get(p.f,LOW_WEAR) ? WARN : WHITE);
    }

    private static void performance(Panel p) {
        long now = System.nanoTime() / 1_000_000;
        int interval = Preferences.get(p.f,INTERVAL);
        boolean label = !Preferences.on(p.f,LABEL);
        if (p.f == Feature.FPS) {
            if (now >= nextFps) { fps = mc().getCurrentFps(); nextFps = now + interval; }
            p.text(fps + (label ? " FPS" : ""),0,0,fps < Preferences.get(p.f,LOW_FPS) ? WARN : WHITE);
        } else {
            if (now >= nextPing) {
                var connection = mc().getNetworkHandler();
                var info = connection == null ? null : connection.getPlayerListEntry(mc().player.getUuid());
                ping = info == null ? -1 : info.getLatency();
                nextPing = now + interval;
            }
            int threshold = Preferences.get(p.f,HIGH_PING);
            int color = threshold > 0 && ping > threshold ? WARN : WHITE;
            int style = Preferences.get(p.f,PING_STYLE);
            if (style != 0) {
                int bars = ping < 0 ? 0 : ping < 150 ? 5 : ping < 300 ? 4 : ping < 600 ? 3 : ping < 1000 ? 2 : 1;
                p.add(0,0,10,10,g -> {
                    for (int i = 0; i < 5; i++) g.fill(i * 2,8 - i * 2,i * 2 + 2,10,i < bars ? color : 0x66555555);
                });
            }
            if (style != 1) p.text((ping < 0 ? "—" : Integer.toString(ping)) + (label ? " ms" : ""),style == 0 ? 0 : 13,0,color);
        }
    }

    private static String coord(double n, boolean decimal) {
        return decimal ? String.format(Locale.ROOT,"%.1f",n) : Integer.toString((int)Math.floor(n));
    }
    private static void coordinates(Panel p) {
        var player = mc().player;
        boolean decimal = Preferences.on(p.f,DECIMALS);
        String[] xyz = { "X " + coord(player.getX(),decimal), "Y " + coord(player.getY(),decimal), "Z " + coord(player.getZ(),decimal) };
        if (Preferences.on(p.f,STACKED)) for (int i = 0; i < 3; i++) p.text(xyz[i],0,i * 10,WHITE);
        else p.text(String.join("  ",xyz),0,0,WHITE);
        if (Preferences.on(p.f,FACING)) p.text(player.getHorizontalFacing().toString(),0,p.h,WHITE);
        if (Preferences.on(p.f,CONVERT)) {
            String dim = mc().world.getRegistryKey().getValue().toString();
            boolean nether = dim.equals("minecraft:the_nether");
            if (nether || dim.equals("minecraft:overworld")) {
                double scale = nether ? 8 : .125;
                p.text((nether ? "Overworld " : "Nether ") + coord(player.getX()*scale,decimal) + ", " + coord(player.getZ()*scale,decimal),0,p.h,WHITE);
            }
        }
    }

    private static void keys(Panel p) {
        var o = mc().options;
        var keys = List.of(o.forwardKey,o.leftKey,o.backKey,o.rightKey);
        int gap = Preferences.get(p.f,GAP);
        int unit = 16;
        for (var k : keys) unit = Math.max(unit,mc().textRenderer.getWidth(k.getBoundKeyLocalizedText()) + 6);
        for (int i = 0; i < 4; i++) {
            var k = keys.get(i);
            int col = i == 0 ? 1 : i - 1;
            key(p,k.getBoundKeyLocalizedText().getString(),col * (unit + gap),i == 0 ? 0 : 14 + gap,unit,k.isPressed());
        }
        if (Preferences.on(p.f,JUMP)) key(p,o.jumpKey.getBoundKeyLocalizedText().getString(),0,p.h + gap,p.w,o.jumpKey.isPressed());
        if (Preferences.on(p.f,SPRINT)) key(p,o.sprintKey.getBoundKeyLocalizedText().getString(),0,p.h + gap,p.w,o.sprintKey.isPressed());
        if (Preferences.on(p.f,MOUSE)) {
            int y = p.h + gap, half = (p.w - gap) / 2;
            key(p,o.attackKey.getBoundKeyLocalizedText().getString(),0,y,half,o.attackKey.isPressed());
            key(p,o.useKey.getBoundKeyLocalizedText().getString(),half + gap,y,half,o.useKey.isPressed());
        }
    }
    private static void key(Panel p,String label,int x,int y,int width,boolean down) {
        int color = down ? alpha(Preferences.get(p.f,PRESSED)) | 0xFFFFFF : 0x77000000;
        p.add(x,y,width,14,g -> g.fill(x,y,x + width,y + 14,color));
        String fit = mc().textRenderer.trimToWidth(label,Math.max(1,width - 2));
        p.text(fit,x + (width - mc().textRenderer.getWidth(fit))/2,y + 3,down ? 0xFF222222 : WHITE);
    }

    static String heldId() {
        return Registries.ITEM.getId(mc().player.getMainHandStack().getItem()).toString();
    }

    static String itemName(String id) {
        var key = Identifier.tryParse(id);
        if (key == null || mc().player == null) return id;
        var stack = Registries.ITEM.get(key).getDefaultStack();
        return stack.getName().getString();
    }

    static void trackHeld() {
        if (!mc().player.getMainHandStack().isEmpty()) Preferences.track(heldId(),true);
    }
    private static void counter(Panel p) {
        for (String id : Preferences.tracked()) countItem(p,id);
    }
    private static void countItem(Panel p,String entry) {
        var id = Identifier.tryParse(entry);
        if (id == null) return;
        var item = Registries.ITEM.get(id);
        var inventory = mc().player.getInventory();
        int count = 0, end = Preferences.on(p.f,INVENTORY) ? 9 : inventory.size();
        for (int i = 0; i < end; i++) {
            var stack = inventory.getStack(i);
            if (stack.getItem() == item) count += stack.getCount();
        }
        boolean icon = !Preferences.on(p.f,ICON);
        int y = p.h == 0 ? 0 : p.h + 1;
        if (icon) p.item(item.getDefaultStack(),0,y,false);
        String label = icon ? Integer.toString(count) : itemName(entry) + " " + count;
        p.text(label,icon ? 19 : 0,y + (icon ? 4 : 0),count < Preferences.get(p.f,LOW_STOCK) ? WARN : WHITE);
    }

    private static void effects(Panel p) {
        for (var instance : mc().player.getStatusEffects()) {
            var effect = instance.getEffectType();
            var id = effect.getKey().orElseThrow().getValue();
            var texture = Identifier.of(id.getNamespace(),"textures/mob_effect/" + id.getPath() + ".png");
            int y = p.h == 0 ? 0 : p.h + 1;
            p.add(0,y,18,18,g -> g.drawTexture(RenderPipelines.GUI_TEXTURED,texture,0,y,0f,0f,18,18,18,18));
            var parts = new ArrayList<String>();
            if (!Preferences.on(p.f,NAMES)) parts.add(effect.value().getName().getString());
            if (!Preferences.on(p.f,AMPLIFIER) && instance.getAmplifier() > 0) parts.add(Integer.toString(instance.getAmplifier() + 1));
            int secs = (instance.getDuration() + 19) / 20;
            if (!Preferences.on(p.f,DURATION)) parts.add(instance.isInfinite() ? "∞" : String.format(Locale.ROOT,"%d:%02d",secs/60,secs%60));
            if (!parts.isEmpty()) p.text(String.join(" ",parts),21,y + 4,!instance.isInfinite() && secs < Preferences.get(p.f,EXPIRES) ? WARN : WHITE);
        }
    }
}
