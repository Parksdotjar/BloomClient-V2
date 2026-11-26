package org.bloomclient.cosmetics.tweaks;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.narration.NarrationMessageBuilder;
import net.minecraft.client.gui.screen.option.GameOptionsScreen;
import net.minecraft.client.gui.tooltip.Tooltip;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.gui.widget.OptionListWidget;
import net.minecraft.client.gui.widget.SliderWidget;
import net.minecraft.client.gui.widget.TextWidget;
import net.minecraft.text.Text;
import static org.bloomclient.cosmetics.tweaks.Setting.*;

final class TweaksSettingsMenu extends GameOptionsScreen {
    private final Feature feature;

    TweaksSettingsMenu(Screen parent, Feature feature) {
        super(parent, MinecraftClient.getInstance().options, Text.literal(feature == null ? "HUD appearance" : feature.label));
        this.feature = feature;
    }

    @Override protected void initHeader() {
        if (feature != Feature.CROSSHAIR && feature != Feature.BLOCK_OUTLINE) {
            super.initHeader();
            return;
        }
        layout.setHeaderHeight(layout.getHeaderHeight() + 54);
        layout.addHeader(new TextWidget(getTitle(), textRenderer),
            pos -> pos.alignHorizontalCenter().alignTop().marginTop(12));
        layout.addHeader(new Preview(feature), pos -> pos.alignHorizontalCenter().alignBottom().marginBottom(5));
    }

    private OptionListWidget optionList() {
        //? if <26.1 {
        return body;
        //?} else {
        /*return list;
        *///?}
    }

    @Override protected void addOptions() {
        if (feature == null) {
            optionList().addAll(List.of(control(OPACITY),control(SHADOW)));
            return;
        }
        var settings = switch (feature) {
            case ZOOM -> List.of(MODE, STRENGTH, SCROLL, SMOOTH, SENSITIVITY);
            case ARMOR -> List.of(HORIZONTAL, SLOT, EMPTY, WEAR);
            case CPS -> List.of(BUTTONS, COMBINE, LABEL);
            case FPS -> List.of(LABEL, INTERVAL, LOW_FPS);
            case COORDINATES -> List.of(DECIMALS, STACKED, FACING, CONVERT);
            case KEYS -> List.of(JUMP, SPRINT, MOUSE, PRESSED, GAP);
            case DURABILITY -> List.of(HAND, ICON, PERCENT, LOW_WEAR);
            case EFFECTS -> List.of(NAMES, AMPLIFIER, DURATION, EXPIRES);
            case COUNTER -> List.of(INVENTORY, ICON, LOW_STOCK);
            case PING -> List.of(PING_STYLE, LABEL, INTERVAL, HIGH_PING);
            case CROSSHAIR -> List.of(RETICLE_LENGTH, RETICLE_GAP, RETICLE_WIDTH, RETICLE_COLOR, RETICLE_OUTLINE);
            case SCREENSHOT -> List.of(SCREENSHOT_HUD, SCREENSHOT_DELAY);
            case CHAT_TIMESTAMPS -> List.of(TIME_FORMAT);
            case HOTBAR_SCROLL -> List.of(SCROLL_DIRECTION, SCROLL_GAIN, SCROLL_WRAP);
            case COMPASS -> List.of(COMPASS_STYLE, COMPASS_DEGREES);
            case SPEED -> List.of(SPEED_AXIS, SPEED_SMOOTHING);
            case CLOCK -> List.of(CLOCK_SOURCE, TIME_FORMAT, CLOCK_SECONDS);
            case BIOME -> List.of(BIOME_FIELDS, STACKED);
            case INVENTORY_PREVIEW -> List.of(PREVIEW_HOTBAR, SLOT, EMPTY);
            case EQUIPMENT_ALERTS -> List.of(ALERT_EQUIPMENT, ALERT_THRESHOLD);
            case PARTICLES -> List.of(PARTICLE_STYLE, PARTICLE_TRIGGER, PARTICLE_COUNT, PARTICLE_SPREAD, PARTICLE_SPEED, PARTICLE_INTERVAL);
            case BLOCK_OUTLINE -> List.of(OUTLINE_STYLE, OUTLINE_WIDTH, OUTLINE_OPACITY, OUTLINE_SPEED);
        };
        optionList().addAll(settings.stream().map(this::control).toList());
        if (feature == Feature.BLOCK_OUTLINE) {
            optionList().addHeader(Text.literal("Color"));
            optionList().addAll(List.of(control(OUTLINE_HUE),control(OUTLINE_SATURATION),control(OUTLINE_BRIGHTNESS)));
        }
        if (feature == Feature.COUNTER) addTrackedItems();
        if (!feature.hud) return;
        optionList().addHeader(Text.literal("Appearance"));
        var appearance = new ArrayList<ClickableWidget>();
        appearance.add(control(SCALE));
        appearance.add(control(OWN_OPACITY));
        if (Preferences.on(feature, OWN_OPACITY)) appearance.add(control(OPACITY));
        appearance.add(control(OWN_SHADOW));
        appearance.add(action("Reset appearance", () -> {
            Preferences.set(feature,SCALE,100);
            Preferences.set(feature,OWN_SHADOW,0);
            Preferences.set(feature,OWN_OPACITY,0);
            Preferences.set(feature,OPACITY,0);
            if (feature == Feature.ARMOR || feature == Feature.INVENTORY_PREVIEW) Preferences.set(feature,SLOT,100);
            refreshOptions();
        }));
        optionList().addAll(appearance);
    }

    private void addTrackedItems() {
        optionList().addHeader(Text.literal("Tracked items"));
        var track = action("Track held item", () -> {
            Hud.trackHeld();
            refreshOptions();
        });
        var player = MinecraftClient.getInstance().player;
        track.active = player != null && !player.getMainHandStack().isEmpty()
            && Preferences.tracked().size() < 6 && !Preferences.tracked().contains(Hud.heldId());
        track.setTooltip(Tooltip.of(Text.literal("Track up to six items from your main hand.")));
        var items = new ArrayList<ClickableWidget>();
        items.add(track);
        for (var id : Preferences.tracked()) {
            items.add(action("Remove " + Hud.itemName(id), () -> {
                Preferences.track(id,false);
                refreshOptions();
            }));
        }
        optionList().addAll(items);
    }

    private void refreshOptions() {
        double scroll = optionList().getScrollY();
        optionList().setFocused(null);
        optionList().replaceEntries(List.of());
        addOptions();
        optionList().setScrollY(scroll);
    }

    private ButtonWidget action(String label, Runnable action) {
        return ButtonWidget.builder(Text.literal(label), b -> action.run()).width(150).build();
    }

    private ClickableWidget control(Setting setting) {
        int n = Preferences.get(feature,setting);
        if (setting.choices.length == 0) return new ValueSlider(setting,n);
        return ButtonWidget.builder(Text.literal(setting.display(n)), b -> {
            int next = (Preferences.get(feature,setting) + 1) % setting.choices.length;
            Preferences.set(feature,setting,next);
            b.setMessage(Text.literal(setting.display(next)));
            if (feature == Feature.CHAT_TIMESTAMPS && setting == TIME_FORMAT) DelightTweaks.refreshChat();
            if (setting == OWN_OPACITY) refreshOptions();
        }).width(150).build();
    }

    @Override public void removed() {
        super.removed();
        Preferences.save();
    }

    private final class ValueSlider extends SliderWidget {
        private final Setting setting;

        ValueSlider(Setting setting, int initial) {
            super(0, 0, 150, 20, Text.literal(setting.display(initial)), (initial - setting.min) / (double)(setting.max - setting.min));
            this.setting = setting;
        }

        private int number() { return setting.clamp((int)Math.round(setting.min + value * (setting.max - setting.min))); }
        @Override protected void updateMessage() { setMessage(Text.literal(setting.display(number()))); }
        @Override protected void applyValue() { Preferences.set(feature,setting,number()); }
    }

    private static final class Preview extends ClickableWidget {
        private final Feature feature;

        Preview(Feature feature) {
            super(0,0,48,48,Text.empty());
            this.feature = feature;
            active = false;
        }

        @Override protected void renderWidget(DrawContext g, int mx, int my, float delta) {
            int x = getX() + getWidth() / 2, y = getY() + getHeight() / 2;
            g.fill(getX(),getY(),getX() + getWidth(),getY() + getHeight(),0xCC75818C);
            if (feature == Feature.CROSSHAIR) {
                CameraTweaks.drawCrosshair(g,x,y);
            } else {
                int thickness = Math.max(1,Math.round(VisualTweaks.outlineWidth(1)));
                int left = x - 11, right = x + 12, top = y - 11, bottom = y + 12;
                int color = VisualTweaks.outlineColor();
                g.fill(left,top,right,top + thickness,color);
                g.fill(left,bottom - thickness,right,bottom,color);
                g.fill(left,top + thickness,left + thickness,bottom - thickness,color);
                g.fill(right - thickness,top + thickness,right,bottom - thickness,color);
            }
        }

        @Override protected void appendClickableNarrations(NarrationMessageBuilder narration) {}
    }
}
