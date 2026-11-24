package org.bloomclient.cosmetics;

import com.google.gson.Gson;
import org.joml.Matrix4f;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipInputStream;

/** Runtime-only data compiled by Delight Animations. Coordinates are in model units. */
final class DelightWingData {
    static final String RESOURCE = "/assets/bloom_cosmetics/delight-wings/";
    private static final int MIB = 1024 * 1024;
    private static final Gson JSON = new Gson();

    record Colors(String left, String right, String trim) {
        private static int parse(String hex) {
            if (hex == null || !hex.matches("#[a-fA-F0-9]{6}")) throw new IllegalArgumentException("Invalid wing color");
            return Integer.parseInt(hex.substring(1), 16);
        }
        void validate() { parse(left); parse(right); parse(trim); }
        int forTint(String tint) {
            return parse(switch (tint) {
                case "left" -> left;
                case "right" -> right;
                case "trim" -> trim;
                default -> throw new IllegalArgumentException("Invalid tint slot");
            });
        }
    }
    record Item(String id, String revision, String name, Colors defaults) {}
    record Catalog(int format, List<Item> entries) {}
    record Frame(int time, float[][] matrices) {}
    record Batch(int matrix, String texture, String tint, String color, float[] vertices) {
        int rgb(Colors selected) { return "fixed".equals(tint) ? Colors.parse(color) : selected.forTint(tint); }
    }
    record Model(int format, String id, int duration, List<Frame> frames, List<Batch> batches) {
        Matrix4f[] pose(long timeMs) {
            int time = (int) Math.floorMod(timeMs, duration);
            int lo = 0, hi = frames.size() - 1;
            while (hi - lo > 1) {
                int middle = (lo + hi) >>> 1;
                if (frames.get(middle).time <= time) lo = middle;
                else hi = middle;
            }
            Frame a = frames.get(lo), b = frames.get(hi);
            float alpha = (float) (time - a.time) / (b.time - a.time);
            Matrix4f[] matrices = new Matrix4f[a.matrices.length];
            for (int i = 0; i < matrices.length; i++) {
                float[] components = new float[16];
                for (int j = 0; j < 16; j++) components[j] = a.matrices[i][j] + alpha * (b.matrices[i][j] - a.matrices[i][j]);
                matrices[i] = new Matrix4f().set(components);
            }
            return matrices;
        }
    }
    record Asset(Model model, Map<String, byte[]> textures) {}

    static Map<String, Item> catalog() throws IOException {
        Catalog catalog = JSON.fromJson(new String(resource("catalog.json", MIB), StandardCharsets.UTF_8), Catalog.class);
        if (catalog.format != 1 || catalog.entries.size() > 80) throw new IOException("Invalid Wing catalog");
        Map<String, Item> byRevision = new HashMap<>();
        for (Item item : catalog.entries) {
            if (!item.id.matches("[a-z0-9][a-z0-9_-]{0,63}") || !item.revision.matches("[0-9a-f]{64}") ||
                byRevision.putIfAbsent(item.revision, item) != null) throw new IOException("Invalid Wing entry");
            item.defaults.validate();
        }
        return Map.copyOf(byRevision);
    }

    static Asset read(Item item) throws IOException {
        byte[] archive = resource(item.revision + ".zip", 4 * MIB);
        if (!digest(archive).equals(item.revision)) throw new IOException("Wing revision checksum failed");
        Map<String, byte[]> files = new HashMap<>();
        int total = 0;
        try (ZipInputStream zip = new ZipInputStream(new java.io.ByteArrayInputStream(archive))) {
            for (var next = zip.getNextEntry(); next != null; next = zip.getNextEntry()) {
                String name = next.getName();
                if (!name.matches("wing\\.json|preview\\.png|(?:flat|texture-[0-9]{1,3})\\.png") || files.size() >= 70)
                    throw new IOException("Invalid wing asset path");
                byte[] content = zip.readNBytes(4 * MIB + 1);
                total += content.length;
                if (content.length > 4 * MIB || total > 12 * MIB || files.putIfAbsent(name, content) != null)
                    throw new IOException("Wing archive exceeds its limits");
            }
        }
        Model model = JSON.fromJson(new String(files.remove("wing.json"), StandardCharsets.UTF_8), Model.class);
        files.remove("preview.png");
        if (model.format != 1 || !item.id.equals(model.id) || model.duration < 1 || model.duration > 10_000 ||
            model.frames.size() < 2 || model.frames.size() > 800 || model.frames.getFirst().time != 0 ||
            model.frames.getLast().time != model.duration || model.batches.size() > 300)
            throw new IOException("Invalid wing runtime data");
        int count = model.frames.getFirst().matrices.length;
        if (count < 1 || count > 34) throw new IOException("Invalid wing matrix count");
        int previous = -1;
        for (Frame frame : model.frames) {
            if (frame.time <= previous || frame.matrices.length != count) throw new IOException("Invalid wing frame");
            for (float[] matrix : frame.matrices) if (matrix.length != 16 || !bounded(matrix)) throw new IOException("Invalid wing matrix");
            previous = frame.time;
        }
        int vertices = 0;
        for (Batch batch : model.batches) {
            if (batch.matrix < 0 || batch.matrix >= count || batch.vertices.length % 32 != 0 ||
                !bounded(batch.vertices) || !files.containsKey(batch.texture)) throw new IOException("Invalid wing mesh");
            batch.rgb(item.defaults);
            vertices += batch.vertices.length / 8;
        }
        if (vertices > 9216) throw new IOException("Wing vertex limit exceeded");
        return new Asset(model, Map.copyOf(files));
    }

    private static boolean bounded(float[] values) {
        for (float value : values) if (!Float.isFinite(value) || Math.abs(value) > 1024) return false;
        return true;
    }
    private static byte[] resource(String name, int limit) throws IOException {
        try (InputStream stream = DelightWingData.class.getResourceAsStream(RESOURCE + name)) {
            if (stream == null) throw new IOException("Missing wing resource");
            byte[] bytes = new BufferedInputStream(stream).readNBytes(limit + 1);
            if (bytes.length > limit) throw new IOException("Wing resource exceeds its limit");
            return bytes;
        }
    }
    private static String digest(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }
}
