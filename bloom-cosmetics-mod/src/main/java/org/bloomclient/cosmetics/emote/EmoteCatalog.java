package org.bloomclient.cosmetics.emote;

import com.google.gson.*;
import com.zigythebird.playeranimcore.animation.Animation;
import com.zigythebird.playeranimcore.loading.UniversalAnimLoader;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Bundled, immutable clips; never resolves a player-supplied URL or resource-pack override. */
public final class EmoteCatalog {
    public record Entry(String id, String name, String revision, String playback, boolean traversal, double duration, Animation clip) {}
    private static final String BASE = "/assets/bloom_cosmetics/emotes/";
    private static List<Entry> entries = List.of();
    public static List<Entry> entries() { return entries; }
    public static Entry find(String id, String revision) {
        return entries.stream().filter(e -> e.id().equals(id) && e.revision().equals(revision)).findFirst().orElse(null);
    }
    static Animation loadClip(InputStream stream, String name) throws IOException {
        JsonObject data = JsonParser.parseReader(new InputStreamReader(stream, StandardCharsets.UTF_8)).getAsJsonObject();
        JsonObject clip = data.getAsJsonObject("animations").getAsJsonObject(name);
        if (clip == null) throw new IOException("Missing animation: " + name);
        // PAL constructs segment lengths in JSON member order. JavaScript moves
        // integer keys ("1", "2") before fractional keys, and native JSON maps may
        // sort lexically ("10" before "2"). Restore numeric order at this boundary
        // so both existing exports and future editor layers retain every sample.
        for (JsonElement bone : clip.getAsJsonObject("bones").asMap().values()) {
            JsonObject tracks = bone.getAsJsonObject();
            for (String channel : List.of("rotation", "position")) {
                JsonElement track = tracks.get(channel);
                if (track == null || !track.isJsonObject() || track.getAsJsonObject().has("vector")) continue;
                JsonObject ordered = new JsonObject();
                track.getAsJsonObject().entrySet().stream()
                    .sorted(Comparator.comparingDouble(e -> Double.parseDouble(e.getKey())))
                    .forEach(e -> ordered.add(e.getKey(), e.getValue()));
                tracks.add(channel, ordered);
            }
        }
        return UniversalAnimLoader.loadAnimations(data).get(name);
    }
    public static void load() {
        List<Entry> loaded = new ArrayList<>();
        try (InputStream stream = EmoteCatalog.class.getResourceAsStream(BASE + "catalog.json")) {
            if (stream == null) throw new IOException("Bundled emote catalog missing");
            JsonObject catalog = JsonParser.parseReader(new InputStreamReader(stream, StandardCharsets.UTF_8)).getAsJsonObject();
            if (catalog.get("schemaVersion").getAsInt() != 1) throw new IOException("Unsupported catalog");
            for (JsonElement item : catalog.getAsJsonArray("entries")) {
                JsonObject e = item.getAsJsonObject();
                String revision = e.get("revision").getAsString();
                if (!revision.matches("[a-f0-9]{64}")) throw new IOException("Invalid revision");
                try (InputStream animation = EmoteCatalog.class.getResourceAsStream(BASE + revision + ".json")) {
                    if (animation == null) throw new IOException("Missing clip");
                    Animation clip = loadClip(animation, e.get("animation").getAsString());
                    if (clip == null) throw new IOException("Invalid animation");
                    boolean traversal = e.has("traversal") && e.get("traversal").getAsBoolean();
                    if (traversal && !e.get("playback").getAsString().equals("loop")) throw new IOException("Traversal must loop");
                    loaded.add(new Entry(e.get("id").getAsString(), e.get("name").getAsString(), revision,
                        e.get("playback").getAsString(), traversal, e.get("duration").getAsDouble(), clip));
                }
            }
            entries = List.copyOf(loaded);
        } catch (Exception error) {
            org.slf4j.LoggerFactory.getLogger("BloomEmotes").error("Bundled emotes could not be loaded", error);
            entries = List.of();
        }
    }
}
