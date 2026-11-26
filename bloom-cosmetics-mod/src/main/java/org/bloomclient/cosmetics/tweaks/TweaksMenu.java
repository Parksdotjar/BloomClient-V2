package org.bloomclient.cosmetics.tweaks;

import java.util.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.DirectionalLayoutWidget;
import net.minecraft.client.gui.widget.ThreePartsLayoutWidget;
import net.minecraft.screen.ScreenTexts;
import net.minecraft.text.Text;
import net.minecraft.client.gui.tooltip.Tooltip;
import static org.bloomclient.cosmetics.tweaks.Setting.*;

final class TweaksMenu extends TweaksScreen {
    private enum Page { HOME, MODUALS, ADD }
    private interface Row { void add(int x, int y, int width); }
    private final Page kind;
    private ModualsList moduals;
    private int firstCategory;
    private int page;

    private TweaksMenu(String title, Screen parent, Page kind) {
        super(title, parent);
        this.kind = kind;
    }

    static TweaksMenu home(Screen parent) { return new TweaksMenu("Delight Tweaks", parent, Page.HOME); }
    static TweaksSettingsMenu settings(Screen parent, Feature f) { return new TweaksSettingsMenu(parent,f); }
    static TweaksMenu add(HudEditor editor) { return new TweaksMenu("Add HUD", editor, Page.ADD); }


    @Override protected void init() {
        super.init();
        int w = Math.min(240, width - 20), x = (width - w) / 2;
        if (kind == Page.HOME) {
            int top = height / 2 - 22;
            button("Edit HUD", x, top, w, () -> show(new HudEditor(this))).active =
                MinecraftClient.getInstance().player != null;
            button("Moduals", x, top + 24, w, () -> show(new TweaksMenu("Moduals", this, Page.MODUALS)));
            return;
        }
        int footer = height - 26;
        if (kind == Page.MODUALS) {
            double scroll = moduals == null ? 0 : moduals.getScrollY();
            var frame = new ThreePartsLayoutWidget(this);
            frame.addHeader(getTitle(), textRenderer);
            moduals = addDrawableChild(new ModualsList(width, frame.getContentHeight(), frame.getHeaderHeight(), firstCategory,
                f -> show(settings(this, f)), () -> show(settings(this, null))));
            moduals.setScrollY(scroll);
            firstCategory = moduals.firstCategory;
            var done = ButtonWidget.builder(ScreenTexts.DONE, b -> back()).width(Math.min(200, w)).build();
            if (moduals.lastCategoryStart == 0) frame.addFooter(done);
            else {
                var footerRow = DirectionalLayoutWidget.horizontal().spacing(4);
                footerRow.add(categoryArrow("<", "Previous categories", -1)).active = firstCategory > 0;
                footerRow.add(done);
                footerRow.add(categoryArrow(">", "Next categories", 1)).active = firstCategory < moduals.lastCategoryStart;
                frame.addFooter(footerRow);
            }
            frame.refreshPositions();
            frame.forEachChild(this::addDrawableChild);
            return;
        }
        var rows = new ArrayList<Row>();
        for (var f : Hud.ELEMENTS) if (!Preferences.on(f, ENABLED)) {
            rows.add((rx,ry,rw) -> button(f.label, rx, ry, rw, () -> {
                Preferences.set(f, ENABLED, 1);
                ((HudEditor)parent).select(f);
                show(parent);
            }));
        }
        int capacity = Math.max(1, (footer - 28) / 24);
        int pages = Math.max(1, (rows.size() + capacity - 1) / capacity);
        page = Math.min(page, pages - 1);
        int start = page * capacity, count = Math.min(capacity, rows.size() - start);
        int top = Math.max(28, (footer + 26 - count * 24) / 2);
        for (int i = 0; i < count; i++) rows.get(start + i).add(x, top + i * 24, w);
        if (pages == 1) button("Done", x, footer, w, this::back);
        else {
            button("<", x, footer, 24, () -> { page--; clearAndInit(); }).active = page > 0;
            button("Done  (" + (page + 1) + "/" + pages + ")", x + 28, footer, w - 56, this::back);
            button(">", x + w - 24, footer, 24, () -> { page++; clearAndInit(); }).active = page + 1 < pages;
        }
    }

    private ButtonWidget categoryArrow(String icon, String label, int step) {
        var title = Text.literal(label);
        return ButtonWidget.builder(Text.literal(icon), b -> {
            firstCategory += step;
            clearAndInit();
        }).width(20).tooltip(Tooltip.of(title)).narrationSupplier(ignored -> title).build();
    }

    @Override public void render(DrawContext g, int mx, int my, float delta) {
        super.render(g,mx,my,delta);
        if (kind != Page.MODUALS) g.drawCenteredTextWithShadow(textRenderer, getTitle(), width / 2, 12, -1);
        drawGears(g);
    }
}
