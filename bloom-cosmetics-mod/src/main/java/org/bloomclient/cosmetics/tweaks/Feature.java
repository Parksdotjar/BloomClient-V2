package org.bloomclient.cosmetics.tweaks;

enum Feature {
    ZOOM("Zoom"), ARMOR("Armor HUD", 1, .77), CPS("CPS", 0, .12),
    FPS("FPS", 0, 0), COORDINATES("Coordinates", 0, .2), KEYS("Keystrokes", 0, .4),
    DURABILITY("Held-item Durability", 1, .88), EFFECTS("Effects HUD", 1, .25),
    COUNTER("Item Counter", 1, .58), PING("Ping", 0, .07),
    CROSSHAIR("Crosshair"), SCREENSHOT("Screenshot Tools"),
    CHAT_TIMESTAMPS("Chat Timestamps"), HOTBAR_SCROLL("Hotbar Scroll Controls"),
    COMPASS("Compass", .5, 0), SPEED("Speed Meter", 0, .28),
    CLOCK("Clock", 1, 0), BIOME("Biome & Dimension", 0, .34),
    INVENTORY_PREVIEW("Inventory Preview", .5, .86), EQUIPMENT_ALERTS("Equipment Alerts", .5, .12),
    PARTICLES("Particles"), BLOCK_OUTLINE("Block Outline");

    final String label;
    final double x, y;
    final boolean hud;

    Feature(String label, double x, double y) {
        this.label = label;
        this.x = x;
        this.y = y;
        this.hud = true;
    }

    Feature(String label) {
        this.label = label;
        this.x = this.y = 0;
        this.hud = false;
    }
}
