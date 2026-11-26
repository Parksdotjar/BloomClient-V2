package org.bloomclient.cosmetics.tweaks;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.tooltip.Tooltip;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

abstract class TweaksScreen extends Screen {
    final Screen parent;
    private final List<ButtonWidget> gears = new ArrayList<>();
    private static final String[] COG = {
        "...##...", ".#.##.#.", ".######.", "###..###",
        "###..###", ".######.", ".#.##.#.", "...##..."
    };

    TweaksScreen(String title, Screen parent) {
        super(Text.literal(title));
        this.parent = parent;
    }

    @Override protected void init() { gears.clear(); }

    void show(Screen screen) { MinecraftClient.getInstance().setScreen(screen); }

    ButtonWidget button(String label, int x, int y, int w, Runnable action) {
        return addDrawableChild(ButtonWidget.builder(Text.literal(label), b -> action.run()).dimensions(x, y, w, 20).build());
    }

    ButtonWidget gear(String label, int x, int y, Runnable action) {
        var b = addDrawableChild(gearButton(label, x, y, 20, action));
        gears.add(b);
        return b;
    }

    static ButtonWidget gearButton(String label, int x, int y, int size, Runnable action) {
        var name = Text.literal(label + " settings");
        return ButtonWidget.builder(Text.empty(), ignored -> action.run())
            .dimensions(x, y, size, size).tooltip(Tooltip.of(name)).narrationSupplier(ignored -> name).build();
    }

    void drawGears(DrawContext g) {
        for (var b : gears) drawGear(g, b);
    }

    static void drawGear(DrawContext g, ButtonWidget b) {
        int x = b.getX() + (b.getWidth() - 8) / 2;
        int y = b.getY() + (b.getHeight() - 8) / 2;
        for (int row = 0; row < 8; row++) for (int col = 0; col < 8; col++) {
            if (COG[row].charAt(col) == '#') g.fill(x + col, y + row, x + col + 1, y + row + 1, b.active ? -1 : 0xFF777777);
        }
    }

    void back() { show(parent); }
    @Override public void close() { back(); }
    @Override public void removed() { Preferences.save(); }
}
