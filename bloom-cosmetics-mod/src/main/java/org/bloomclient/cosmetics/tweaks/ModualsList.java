package org.bloomclient.cosmetics.tweaks;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.Selectable;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.ElementListWidget;
import net.minecraft.text.Text;
import static org.bloomclient.cosmetics.tweaks.Setting.ENABLED;

final class ModualsList extends ElementListWidget<ModualsList.Entry> {
    private static final int ROW_HEIGHT = 18;
    private static final int BUTTON_HEIGHT = 16;
    private static final int BUTTON_GAP = 4;
    private static final int COLUMN_GAP = 10;
    private static final int LABEL_INSET = 3;
    private static final int DOT_SIZE = 5;
    private static final int DOT_INSET = 4;
    private static final int[] ON_DOT = {
        0xFFD9FFBD, 0xFFAEF898, 0xFF83EB79, 0xFF58D864, 0xFF36BC50, 0xFF1C9A3F, 0xFF107637
    };
    private static final int[] OFF_DOT = {
        0xFFFFBAB3, 0xFFFFA49B, 0xFFFA8A83, 0xFFF27370, 0xFFE96263, 0xFFD45157, 0xFFBC424D
    };

    private record Cell(String label, List<ButtonWidget> buttons, Feature feature) {
        int minWidth() {
            int width = MinecraftClient.getInstance().textRenderer.getWidth(label) + 2 * LABEL_INSET;
            for (var button : buttons) width += button.getWidth() + BUTTON_GAP;
            return width;
        }
    }

    private record Column(List<Cell> cells) {
        int minWidth() {
            return cells.stream().mapToInt(Cell::minWidth).max().orElseThrow();
        }
    }

    private record PositionedCell(Cell cell, int left, int width) {}

    final int firstCategory, lastCategoryStart;

    ModualsList(int width, int height, int y, int requestedCategory, Consumer<Feature> settings, Runnable appearance) {
        super(MinecraftClient.getInstance(), width, height, y, ROW_HEIGHT);
        var appearanceButton = ButtonWidget.builder(Text.literal("Open"), b -> appearance.run())
            .dimensions(0, 0, 52, BUTTON_HEIGHT).narrationSupplier(ignored -> Text.literal("HUD appearance")).build();
        var hud = category("HUD", settings, Feature.FPS, Feature.COORDINATES, Feature.EFFECTS, Feature.PING,
            Feature.COMPASS, Feature.SPEED, Feature.CLOCK, Feature.BIOME);
        hud.cells().add(new Cell("HUD appearance", List.of(appearanceButton), null));
        var categories = List.of(
            category("Visual", settings, Feature.ZOOM, Feature.CROSSHAIR, Feature.SCREENSHOT,
                Feature.PARTICLES, Feature.BLOCK_OUTLINE),
            category("Input", settings, Feature.CPS, Feature.KEYS, Feature.CHAT_TIMESTAMPS, Feature.HOTBAR_SCROLL),
            hud,
            category("Equipment", settings, Feature.ARMOR, Feature.DURABILITY, Feature.COUNTER,
                Feature.INVENTORY_PREVIEW, Feature.EQUIPMENT_ALERTS));

        int available = getRowWidth() - 4;
        int last = categories.size() - 1;
        while (last > 0 && minBandWidth(categories.subList(last - 1, categories.size())) <= available) {
            last--;
        }
        lastCategoryStart = last;
        firstCategory = Math.clamp(requestedCategory, 0, lastCategoryStart);
        int end = firstCategory + 1;
        while (end < categories.size() && minBandWidth(categories.subList(firstCategory, end + 1)) <= available) {
            end++;
        }
        addBand(categories.subList(firstCategory, end), available);
    }

    @Override public int getRowWidth() { return Math.min(880, getWidth() - 28); }
    @Override protected int getScrollbarX() { return getRowRight() + 8; }

    private static int minBandWidth(List<Column> columns) {
        return columns.stream().mapToInt(Column::minWidth).sum() + (columns.size() - 1) * COLUMN_GAP;
    }

    private void addBand(List<Column> columns, int available) {
        int spare = Math.max(0, available - minBandWidth(columns));
        int rowCount = columns.stream().mapToInt(column -> column.cells().size()).max().orElseThrow();
        for (int row = 0; row < rowCount; row++) {
            var cells = new ArrayList<PositionedCell>();
            int left = 0;
            for (var column : columns) {
                int columnWidth = column.minWidth() + spare / columns.size();
                if (row < column.cells().size()) {
                    cells.add(new PositionedCell(column.cells().get(row), left, columnWidth));
                }
                left += columnWidth + COLUMN_GAP;
            }
            addEntry(new Entry(cells));
        }
    }

    private static Column category(String title, Consumer<Feature> settings, Feature... features) {
        var cells = new ArrayList<Cell>();
        cells.add(new Cell(title, List.of(), null));
        for (var feature : features) {
            var toggle = ButtonWidget.builder(toggleLabel(feature), b -> {
                Preferences.set(feature, ENABLED, Preferences.on(feature, ENABLED) ? 0 : 1);
                if (feature == Feature.CHAT_TIMESTAMPS) DelightTweaks.refreshChat();
                b.setMessage(toggleLabel(feature));
            }).dimensions(0, 0, 44, BUTTON_HEIGHT)
                .narrationSupplier(ignored -> Text.literal(feature.label + ": " + toggleLabel(feature).getString())).build();
            var gear = TweaksScreen.gearButton(feature.label, 0, 0, BUTTON_HEIGHT, () -> settings.accept(feature));
            cells.add(new Cell(feature.label, List.of(toggle, gear), feature));
        }
        return new Column(cells);
    }

    private static Text toggleLabel(Feature feature) {
        return Text.literal(Preferences.on(feature, ENABLED) ? "ON" : "OFF");
    }

    private static void drawStatusDot(DrawContext g, int x, int y, boolean enabled) {
        int[] shades = enabled ? ON_DOT : OFF_DOT;
        for (int row = 0; row < DOT_SIZE; row++) {
            int inset = row == 0 || row == DOT_SIZE - 1 ? 1 : 0;
            for (int column = inset; column < DOT_SIZE - inset; column++) {
                g.fill(x + column,y + row,x + column + 1,y + row + 1,shades[row + column - 1]);
            }
        }
    }

    static final class Entry extends ElementListWidget.Entry<Entry> {
        private final List<PositionedCell> cells;
        private final List<ButtonWidget> buttons;

        Entry(List<PositionedCell> cells) {
            this.cells = cells;
            this.buttons = cells.stream().flatMap(cell -> cell.cell().buttons().stream()).toList();
        }

        @Override public List<? extends Element> children() { return buttons; }
        @Override public List<? extends Selectable> selectableChildren() { return buttons; }

        @Override public void render(DrawContext g, int mx, int my, boolean hovered, float delta) {
            for (var positioned : cells) {
                drawCell(g, positioned, hovered ? mx : -1, hovered ? my : -1, delta);
            }
        }

        private void drawCell(DrawContext g, PositionedCell positioned, int mx, int my, float delta) {
            int x = getContentX() + positioned.left(), y = getContentY(), right = x + positioned.width();
            var cell = positioned.cell();
            var controls = cell.buttons();
            var renderer = MinecraftClient.getInstance().textRenderer;
            boolean heading = controls.isEmpty();
            g.drawText(renderer, cell.label(), x + (heading ? 0 : LABEL_INSET), y + (heading ? 1 : 4),
                heading ? 0xFFE2E2E2 : -1, true);
            if (heading) {
                g.fill(x, y + 13, right, y + 14, 0x66FFFFFF);
                return;
            }
            for (int i = controls.size() - 1; i >= 0; i--) {
                var button = controls.get(i);
                right -= button.getWidth();
                button.setX(right);
                button.setY(y);
                button.render(g, mx, my, delta);
                right -= BUTTON_GAP;
            }
            if (cell.feature() != null) {
                var toggle = controls.getFirst();
                int dotX = toggle.getX() + toggle.getWidth() - DOT_SIZE - DOT_INSET;
                int dotY = toggle.getY() + (toggle.getHeight() - DOT_SIZE) / 2;
                drawStatusDot(g, dotX, dotY, Preferences.on(cell.feature(), ENABLED));
                TweaksScreen.drawGear(g, controls.getLast());
            }
        }
    }
}
