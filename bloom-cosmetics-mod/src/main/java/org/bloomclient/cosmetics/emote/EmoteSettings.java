package org.bloomclient.cosmetics.emote;

import com.google.gson.*;
import net.fabricmc.loader.api.FabricLoader;
import java.nio.file.*;

public final class EmoteSettings {
    public static boolean autoThirdPerson=true;
    private static JsonObject saved=new JsonObject();
    private static Path path() {return FabricLoader.getInstance().getConfigDir().resolve("bloom-emotes.json");}
    public static void load() {
        try {if(Files.exists(path())) {saved=JsonParser.parseString(Files.readString(path())).getAsJsonObject(); if(saved.has("autoThirdPerson"))autoThirdPerson=saved.get("autoThirdPerson").getAsBoolean();}}
        catch(Exception ignored) {saved=new JsonObject();autoThirdPerson=true;}
    }
    public static void toggleCamera() {
        boolean next=!autoThirdPerson;
        saved.addProperty("autoThirdPerson",next);
        Path temp=path().resolveSibling("bloom-emotes.json.tmp");
        try {
            Files.createDirectories(path().getParent());Files.writeString(temp,new GsonBuilder().setPrettyPrinting().create().toJson(saved));
            try {Files.move(temp,path(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
            catch(AtomicMoveNotSupportedException e){Files.move(temp,path(),StandardCopyOption.REPLACE_EXISTING);}
            autoThirdPerson=next;
        } catch(Exception e){saved.addProperty("autoThirdPerson",autoThirdPerson);}
    }
}
