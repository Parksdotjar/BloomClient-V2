package org.bloomclient.cosmetics.tweaks;

import java.awt.Color;
import java.util.concurrent.ThreadLocalRandom;
import net.minecraft.client.MinecraftClient;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.particle.ParticlesMode;
import static org.bloomclient.cosmetics.tweaks.Setting.*;

public final class VisualTweaks {
    private static Object trailPlayer, trailWorld;
    private static double lastX, lastZ;
    private static int trailCooldown;

    static void tickParticles(MinecraftClient client) {
        var player = client.player;
        if (!particlesEnabled(client) || Preferences.get(Feature.PARTICLES, PARTICLE_TRIGGER) == 2 || player.isSpectator()) {
            trailPlayer = trailWorld = null;
            trailCooldown = 0;
            return;
        }
        double x = player.getX(), z = player.getZ();
        double dx = x - lastX, dz = z - lastZ;
        lastX = x;
        lastZ = z;
        if (trailPlayer != player || trailWorld != client.world) {
            trailPlayer = player;
            trailWorld = client.world;
            return;
        }
        if (trailCooldown > 0) trailCooldown--;
        double distance = Math.hypot(dx,dz);
        if (trailCooldown != 0 || !player.isOnGround() || distance < .04 || distance > 2) return;
        double back = .28 / distance;
        emit(client,x - dx * back,player.getY() + .1,z - dz * back,false);
        trailCooldown = Preferences.get(Feature.PARTICLES, PARTICLE_INTERVAL);
    }

    public static void blockBroken(int x, int y, int z) {
        var client = MinecraftClient.getInstance();
        if (!particlesEnabled(client) || Preferences.get(Feature.PARTICLES, PARTICLE_TRIGGER) == 1) return;
        emit(client,x + .5,y + .5,z + .5,true);
    }

    private static boolean particlesEnabled(MinecraftClient client) {
        return Preferences.on(Feature.PARTICLES, ENABLED) && DelightTweaks.playing() && client.world != null
            && client.options.getParticles().getValue() != ParticlesMode.MINIMAL;
    }

    private static void emit(MinecraftClient client, double x, double y, double z, boolean breaking) {
        var f = Feature.PARTICLES;
        var particle = switch (Preferences.get(f, PARTICLE_STYLE)) {
            case 1 -> ParticleTypes.SMALL_FLAME;
            case 2 -> ParticleTypes.ELECTRIC_SPARK;
            case 3 -> ParticleTypes.CLOUD;
            case 4 -> ParticleTypes.GLOW;
            default -> ParticleTypes.END_ROD;
        };
        int count = Preferences.get(f, PARTICLE_COUNT);
        if (client.options.getParticles().getValue() == ParticlesMode.DECREASED) count = (count + 1) / 2;
        double spread = Preferences.get(f, PARTICLE_SPREAD) / 100.0 * (breaking ? .9 : .35);
        double speed = Preferences.get(f, PARTICLE_SPEED) / 100.0 * (breaking ? .13 : .055);
        var random = ThreadLocalRandom.current();
        for (int i = 0; i < count; i++) {
            double dx = random.nextDouble(-1,1), dy = random.nextDouble(0,1), dz = random.nextDouble(-1,1);
            client.world.addParticleClient(particle,x + dx * spread,y + dy * spread * .6,z + dz * spread,
                dx * speed,(.3 + dy) * speed,dz * speed);
        }
    }

    public static boolean customOutline() { return Preferences.on(Feature.BLOCK_OUTLINE, ENABLED); }

    public static float outlineWidth(float vanillaWidth) {
        return vanillaWidth * Preferences.get(Feature.BLOCK_OUTLINE, OUTLINE_WIDTH) / 100f;
    }

    public static int outlineColor() {
        var f = Feature.BLOCK_OUTLINE;
        double phase = System.nanoTime() * 1e-9 * Preferences.get(f, OUTLINE_SPEED) / 100 * .6;
        return outlineColor(Preferences.get(f, OUTLINE_STYLE), Preferences.get(f, OUTLINE_HUE),
            Preferences.get(f, OUTLINE_SATURATION), Preferences.get(f, OUTLINE_BRIGHTNESS),
            Preferences.get(f, OUTLINE_OPACITY), phase - Math.floor(phase));
    }

    static int outlineColor(int style, int hue, int saturation, int brightness, int opacity, double phase) {
        if (style == 1) opacity = (int)Math.round(opacity * (.775 + .225 * Math.cos(2 * Math.PI * phase)));
        float colorHue = (hue / 360f) + (style == 2 ? (float)phase : 0);
        int rgb = Color.HSBtoRGB(colorHue,saturation / 100f,brightness / 100f);
        return Math.round(opacity * 2.55f) << 24 | (rgb & 0xFFFFFF);
    }
}
