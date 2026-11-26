package org.bloomclient.cosmetics.tweaks;

enum Setting {
    ENABLED("Enabled", "Off", "On"),
    OPACITY("Background opacity", 0, 100, 5, 0, "%"),
    SHADOW("Text shadow", "Off", "On"),
    OWN_OPACITY("Background", "Use global", "Custom"),
    OWN_SHADOW("Text shadow", "Use global", "Off", "On"),
    SCALE("Scale", 50, 200, 10, 100, "%"),
    SNAP("Snap", "Off", "On"),
    EDITOR_TOP("Editor controls", "Bottom", "Top"),
    MODE("Zoom mode", "Hold", "Toggle"),
    STRENGTH("Magnification", 2, 12, 1, 4, "×"),
    SCROLL("Scroll to adjust", "Off", "On"),
    SMOOTH("Smooth transition", "Off", "On"),
    SENSITIVITY("Zoom sensitivity", 10, 100, 5, 35, "%"),
    HORIZONTAL("Layout", "Vertical", "Horizontal"),
    SLOT("Slot opacity", 0, 100, 5, 100, "%"),
    EMPTY("Empty slots", "Show", "Hide"),
    WEAR("Durability", "Bar", "Points", "Percent"),
    BUTTONS("Mouse buttons", "Both", "Left", "Right"),
    COMBINE("Click counts", "Separate", "Combined"),
    LABEL("Label", "Show", "Hide"),
    INTERVAL("Refresh interval", 100, 2000, 100, 500, " ms"),
    LOW_FPS("Warn below", 0, 120, 5, 0, " FPS"),
    DECIMALS("Precision", "Block", "One decimal"),
    STACKED("Layout", "One line", "Stacked"),
    FACING("Facing", "Off", "On"),
    CONVERT("Dimension conversion", "Off", "On"),
    JUMP("Jump", "Hide", "Show"),
    SPRINT("Sprint", "Hide", "Show"),
    MOUSE("Mouse keys", "Hide", "Show"),
    PRESSED("Pressed opacity", 10, 100, 5, 65, "%"),
    GAP("Key spacing", 0, 6, 1, 2, " px"),
    HAND("Hand", "Main hand", "Offhand", "Both"),
    PERCENT("Readout", "Remaining", "Percent"),
    ICON("Item icon", "Show", "Hide"),
    LOW_WEAR("Warn below", 0, 50, 5, 15, "%"),
    NAMES("Effect names", "Show", "Hide"),
    AMPLIFIER("Effect level", "Show", "Hide"),
    DURATION("Time remaining", "Show", "Hide"),
    EXPIRES("Warn below", 0, 30, 1, 5, " s"),
    INVENTORY("Count from", "Inventory", "Hotbar"),
    LOW_STOCK("Warn below", 0, 64, 1, 8, ""),
    PING_STYLE("Display", "Number", "Signal bars", "Number and bars"),
    HIGH_PING("Warn above", 0, 500, 10, 150, " ms"),
    RETICLE_LENGTH("Length", 2, 12, 1, 3, " px"),
    RETICLE_GAP("Center gap", 0, 8, 1, 0, " px"),
    RETICLE_WIDTH("Thickness", 1, 5, 1, 1, " px"),
    RETICLE_COLOR("Color", 1, "White", "Black", "Lime", "Cyan", "Red", "Gold"),
    RETICLE_OUTLINE("Outline", 1, "On", "Off"),
    SCREENSHOT_HUD("Hide HUD", "Yes", "No"),
    SCREENSHOT_DELAY("Capture delay", 0, 3, 1, 0, " s"),
    TIME_FORMAT("Time format", "24-hour", "12-hour"),
    SCROLL_DIRECTION("Direction", "Vanilla", "Reversed"),
    SCROLL_GAIN("Sensitivity", 25, 200, 25, 100, "%"),
    SCROLL_WRAP("Wrap at edges", "Yes", "No"),
    COMPASS_STYLE("Display", "Direction", "Compass strip"),
    COMPASS_DEGREES("Degrees", "Show", "Hide"),
    SPEED_AXIS("Measure", "Horizontal", "All directions"),
    SPEED_SMOOTHING("Smoothing", "On", "Off"),
    CLOCK_SOURCE("Time source", "Local time", "In-game time"),
    CLOCK_SECONDS("Seconds", "Hide", "Show"),
    BIOME_FIELDS("Show", "Biome and dimension", "Biome", "Dimension"),
    PREVIEW_HOTBAR("Hotbar row", "Hide", "Show"),
    ALERT_EQUIPMENT("Watch", "Armor and held tools", "Armor only", "Held tools only"),
    ALERT_THRESHOLD("Warn at", 5, 50, 5, 15, "%"),
    PARTICLE_TRIGGER("Trigger", "Trail and block breaks", "Trail", "Block breaks"),
    PARTICLE_STYLE("Style", "Sparks", "Embers", "Electric", "Mist", "Glow"),
    PARTICLE_COUNT("Particles per burst", 1, 12, 1, 5, ""),
    PARTICLE_SPREAD("Spread", 10, 150, 5, 45, "%"),
    PARTICLE_SPEED("Speed", 0, 200, 10, 100, "%"),
    PARTICLE_INTERVAL("Trail interval", 2, 12, 1, 4, " ticks"),
    OUTLINE_STYLE("Style", "Solid", "Pulse", "Rainbow"),
    OUTLINE_HUE("Hue", 0, 359, 1, 172, "°"),
    OUTLINE_SATURATION("Saturation", 0, 100, 1, 75, "%"),
    OUTLINE_BRIGHTNESS("Brightness", 10, 100, 1, 100, "%"),
    OUTLINE_OPACITY("Opacity", 10, 100, 1, 90, "%"),
    OUTLINE_WIDTH("Thickness", 50, 300, 10, 150, "%"),
    OUTLINE_SPEED("Animation speed", 25, 200, 5, 100, "%");

    final String label, unit;
    final String[] choices;
    final int min, max, step, initial;

    Setting(String label, String... choices) {
        this(label, 0, choices);
    }

    Setting(String label, int initial, String... choices) {
        this(label, 0, choices.length - 1, 1, initial, "", choices);
    }

    Setting(String label, int min, int max, int step, int initial, String unit, String... choices) {
        this.label = label;
        this.min = min;
        this.max = max;
        this.step = step;
        this.initial = initial;
        this.unit = unit;
        this.choices = choices;
    }

    int clamp(int n) {
        return min + Math.round((Math.clamp(n, min, max) - min) / (float)step) * step;
    }

    String display(int value) {
        return label + ": " + (choices.length == 0 ? value + unit : choices[value]);
    }
}
