package org.bloomclient.cosmetics.tweaks;

import java.io.IOException;
import java.nio.file.*;
import java.util.Arrays;
import java.util.Properties;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.LoggerFactory;

final class Preferences {
    private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("delight-tweaks.properties");
    private static final Properties values = new Properties();
    private static final int[][] numbers = new int[Feature.values().length + 1][Setting.values().length];
    private static final double[][] positions = new double[Feature.values().length][2];
    private static boolean dirty;

    static void load() {
        if (Files.isRegularFile(FILE)) {
            try (var reader = Files.newBufferedReader(FILE)) {
                values.load(reader);
            } catch (IOException | IllegalArgumentException e) {
                LoggerFactory.getLogger("Delight Tweaks").warn("Could not read HUD preferences", e);
            }
        }
        for (var s : Setting.values()) numbers[0][s.ordinal()] = read(null,s);
        for (var f : Feature.values()) {
            for (var s : Setting.values()) numbers[f.ordinal() + 1][s.ordinal()] = read(f,s);
            positions[f.ordinal()][0] = readPosition(f,true);
            positions[f.ordinal()][1] = readPosition(f,false);
        }
    }

    static String key(Feature f, String name) {
        return (f == null ? "GLOBAL" : f.name()) + "." + name;
    }

    static int get(Feature f, Setting s) {
        return numbers[f == null ? 0 : f.ordinal() + 1][s.ordinal()];
    }

    private static int read(Feature f, Setting s) {
        int fallback = switch (s) {
            case ENABLED -> f == Feature.ZOOM ? 1 : 0;
            case SHADOW, SMOOTH, SCROLL, JUMP -> 1;
            default -> s.initial;
        };
        try {
            String saved = values.getProperty(key(f, s.name()));
            return saved == null ? fallback : s.clamp(Integer.parseInt(saved));
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    static boolean on(Feature f, Setting s) { return get(f, s) != 0; }
    static void set(Feature f, Setting s, int value) {
        int clamped = s.clamp(value);
        numbers[f == null ? 0 : f.ordinal() + 1][s.ordinal()] = clamped;
        put(key(f, s.name()), Integer.toString(clamped));
    }
    static java.util.List<String> tracked() {
        String list = values.getProperty("COUNTER.items", values.getProperty("COUNTER.item", "minecraft:arrow"));
        return Arrays.stream(list.split(",")).filter(s -> !s.isBlank()).distinct().limit(6).toList();
    }

    static void track(String id, boolean enable) {
        var items = new java.util.LinkedHashSet<>(tracked());
        if (!enable) items.remove(id);
        else if (items.size() < 6) items.add(id);
        put("COUNTER.items", String.join(",",items));
    }

    static double position(Feature f, boolean horizontal) {
        return positions[f.ordinal()][horizontal ? 0 : 1];
    }

    private static double readPosition(Feature f, boolean horizontal) {
        try {
            double n = Double.parseDouble(values.getProperty(key(f, horizontal ? "x" : "y"), "NaN"));
            return Double.isFinite(n) ? Math.clamp(n, 0, 1) : Double.NaN;
        } catch (NumberFormatException ignored) {
            return Double.NaN;
        }
    }

    static void resetPosition(Feature f) {
        Arrays.fill(positions[f.ordinal()], Double.NaN);
        dirty |= values.remove(key(f, "x")) != null;
        dirty |= values.remove(key(f, "y")) != null;
    }

    static void move(Feature f, double x, double y) {
        positions[f.ordinal()][0] = x;
        positions[f.ordinal()][1] = y;
        put(key(f, "x"), Double.toString(x));
        put(key(f, "y"), Double.toString(y));
    }

    private static void put(String key, String value) {
        if (!value.equals(values.setProperty(key, value))) dirty = true;
    }

    static void save() {
        if (!dirty) return;
        try {
            Path temp = FILE.resolveSibling(FILE.getFileName() + ".tmp");
            try (var writer = Files.newBufferedWriter(temp)) {
                values.store(writer, "Delight Tweaks");
            }
            try {
                Files.move(temp, FILE, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, FILE, StandardCopyOption.REPLACE_EXISTING);
            }
            dirty = false;
        } catch (IOException e) {
            LoggerFactory.getLogger("Delight Tweaks").warn("Could not save HUD preferences", e);
        }
    }
}
