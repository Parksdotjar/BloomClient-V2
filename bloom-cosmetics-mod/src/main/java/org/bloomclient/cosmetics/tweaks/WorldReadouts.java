package org.bloomclient.cosmetics.tweaks;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import static org.bloomclient.cosmetics.tweaks.Hud.WHITE;
import static org.bloomclient.cosmetics.tweaks.Setting.*;

final class WorldReadouts {
    private static final String[] DIRECTIONS = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};
    private static final String[] HEADINGS = new String[360];
    private static final int COMPASS_CENTER = 66;
    private static final int COMPASS_RANGE = 60;
    static {
        for (int heading = 0; heading < HEADINGS.length; heading++) {
            HEADINGS[heading] = direction(heading) + " " + heading + "°";
        }
    }
    private static final DateTimeFormatter[] TIME_FORMATS = {
        DateTimeFormatter.ofPattern("HH:mm"), DateTimeFormatter.ofPattern("HH:mm:ss"),
        DateTimeFormatter.ofPattern("h:mm a"), DateTimeFormatter.ofPattern("h:mm:ss a")
    };
    private static Object trackedPlayer, trackedWorld;
    private static double lastX, lastY, lastZ, horizontalSpeed, totalSpeed;

    static void sampleSpeed(MinecraftClient client) {
        var player = client.player;
        if (player == null || client.world == null || !Preferences.on(Feature.SPEED, ENABLED)) {
            trackedPlayer = trackedWorld = null;
            horizontalSpeed = totalSpeed = 0;
            return;
        }
        double x = player.getX(), y = player.getY(), z = player.getZ();
        double dx = x - lastX, dy = y - lastY, dz = z - lastZ;
        lastX = x;
        lastY = y;
        lastZ = z;
        double horizontal = Math.hypot(dx, dz);
        double total = Math.hypot(horizontal, dy);
        if (trackedPlayer != player || trackedWorld != client.world || total > 16) {
            trackedPlayer = player;
            trackedWorld = client.world;
            horizontalSpeed = totalSpeed = 0;
            return;
        }
        double weight = Preferences.on(Feature.SPEED, SPEED_SMOOTHING) ? 1 : .35;
        horizontalSpeed += (horizontal * 20 - horizontalSpeed) * weight;
        totalSpeed += (total * 20 - totalSpeed) * weight;
    }

    static void speed(Hud.Panel panel) {
        double measured = Preferences.on(panel.f, SPEED_AXIS) ? totalSpeed : horizontalSpeed;
        panel.text(String.format(Locale.ROOT, "%.1f b/s", measured),0,0,WHITE);
    }

    static void compass(Hud.Panel panel, float yaw) {
        boolean degrees = !Preferences.on(panel.f, COMPASS_DEGREES);
        if (!Preferences.on(panel.f, COMPASS_STYLE)) {
            panel.text(headingLabel(heading(yaw), degrees),0,0,WHITE);
            return;
        }
        panel.add(0,0,133,29,g -> drawCompassStrip(g,degrees,panel.shadow));
    }

    private static void drawCompassStrip(DrawContext g, boolean degrees, boolean shadow) {
        var client = MinecraftClient.getInstance();
        var renderer = client.textRenderer;
        float heading = heading(cameraYaw(client));
        int whole = (int)heading;
        var matrix = g.getMatrices();
        matrix.pushMatrix();
        matrix.translate(whole - heading,0);
        int first = 15 * Math.floorDiv(whole - COMPASS_RANGE,15);
        for (int tick = first; tick <= whole + COMPASS_RANGE; tick += 15) {
            int alpha = Math.min(255,(int)((COMPASS_RANGE - Math.abs(tick - heading)) * 36));
            if (alpha < 4) continue;
            int x = COMPASS_CENTER + tick - whole;
            boolean major = tick % 45 == 0;
            int lineAlpha = major ? alpha : alpha * 3 / 5;
            g.fill(x,9,x + 1,major ? 15 : 12,lineAlpha << 24 | 0xFFFFFF);
            if (major) {
                String marker = DIRECTIONS[Math.floorMod(tick / 45, DIRECTIONS.length)];
                g.drawText(renderer,marker,x - client.textRenderer.getWidth(marker) / 2,0,alpha << 24 | 0xFFFFFF,shadow);
            }
        }
        matrix.popMatrix();
        g.fill(COMPASS_CENTER,16,COMPASS_CENTER + 1,19,WHITE);
        String label = headingLabel(heading,degrees);
        g.drawText(renderer,label,COMPASS_CENTER - client.textRenderer.getWidth(label) / 2,19,WHITE,shadow);
    }

    private static float cameraYaw(MinecraftClient client) {
        //? if <26.1 {
        var camera = client.gameRenderer.getCamera();
        return camera.isReady() ? camera.getYaw() : client.player.getYaw();
        //?} elif <26.2 {
        /*var camera = client.gameRenderer.getMainCamera();
        return camera.isInitialized() ? camera.yRot() : client.player.getYRot();
        *///?} else {
        /*var camera = client.gameRenderer.mainCamera();
        return camera.isInitialized() ? camera.yRot() : client.player.getYRot();
        *///?}
    }

    static float heading(float yaw) {
        float angle = (yaw + 180f) % 360f;
        return angle < 0 ? angle + 360f : angle;
    }

    private static String direction(int heading) {
        return DIRECTIONS[((heading + 22) / 45) % DIRECTIONS.length];
    }

    private static String headingLabel(float heading, boolean degrees) {
        int rounded = Math.round(heading) % 360;
        return degrees ? HEADINGS[rounded] : direction(rounded);
    }

    static void clock(Hud.Panel panel, MinecraftClient client) {
        LocalTime time = Preferences.on(panel.f, CLOCK_SOURCE) ? gameTime(client.world.getTimeOfDay()) : LocalTime.now();
        panel.text(formatTime(time, Preferences.on(panel.f, TIME_FORMAT), Preferences.on(panel.f, CLOCK_SECONDS)),0,0,WHITE);
    }

    static LocalTime gameTime(long ticks) {
        return LocalTime.ofSecondOfDay((Math.floorMod(ticks, 24000L) * 86400 / 24000 + 21600) % 86400);
    }

    static String formatTime(LocalTime time, boolean twelveHour, boolean seconds) {
        return TIME_FORMATS[(twelveHour ? 2 : 0) + (seconds ? 1 : 0)].format(time);
    }

    static void biome(Hud.Panel panel, MinecraftClient client) {
        var entry = client.world.getBiome(client.player.getBlockPos());
        var key = entry.getKey();
        String biome = key.map(value -> worldName("biome",value.getValue())).orElse("Unknown biome");
        String dimension = worldName("dimension",client.world.getRegistryKey().getValue());
        int fields = Preferences.get(panel.f,BIOME_FIELDS);
        if (fields == 1) panel.text(biome,0,0,WHITE);
        else if (fields == 2) panel.text(dimension,0,0,WHITE);
        else if (Preferences.on(panel.f, STACKED)) {
            panel.text(biome,0,0,WHITE);
            panel.text(dimension,0,11,WHITE);
        } else panel.text(biome + " | " + dimension,0,0,WHITE);
    }

    private static String worldName(String type, Identifier id) {
        String path = id.getPath().replace('_',' ').replace('/',' ');
        var name = new StringBuilder(path.length());
        boolean wordStart = true;
        for (char c : path.toCharArray()) {
            name.append(wordStart ? Character.toUpperCase(c) : c);
            wordStart = c == ' ';
        }
        return Text.translatableWithFallback(type + "." + id.getNamespace() + "." + id.getPath(),name.toString()).getString();
    }
}
