package org.bloomclient.cosmetics.emote;

import com.zigythebird.playeranim.api.PlayerAnimationFactory;
import com.zigythebird.playeranim.api.PlayerAnimationAccess;
import com.zigythebird.playeranim.animation.PlayerAnimationController;
import com.zigythebird.playeranimcore.enums.PlayState;
import com.zigythebird.playeranimcore.api.firstPerson.FirstPersonMode;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.option.Perspective;
import net.minecraft.util.Identifier;
import net.minecraft.client.util.InputUtil;
import java.util.*;

public final class BloomEmotes {
    private static final Identifier LAYER = Identifier.of("bloom_cosmetics", "emotes");
    public static KeyBinding key;
    private static final Map<UUID, Playback> active = new HashMap<>();
    private static Object world;
    private static Perspective previousCamera;
    private static boolean cameraOwned;
    private static final EmoteKeyGesture gesture = new EmoteKeyGesture();
    private static long nextNetworkTick;
    private record Playback(EmoteCatalog.Entry emote, String playbackId, long started, double x, double y, double z, float health) {}
    private BloomEmotes() {}
    // Screen opening clears Minecraft's logical key state. Poll the real keyboard
    // for the hold gesture, including SDL on 26.3, without using GLFW directly.
    static Boolean physicalWheelKeyHeld(){
        var bound=KeyBindingHelper.getBoundKeyOf(key);
        if(bound.getCategory()!=InputUtil.Type.KEYSYM)return null;
        if(bound.getCode()<0)return false;
        return InputUtil.isKeyPressed(MinecraftClient.getInstance().getWindow(),bound.getCode());
    }
    public static void init() {
        EmoteCatalog.load();
        EmoteSettings.load();
        PlayerAnimationFactory.ANIMATION_DATA_FACTORY.registerFactory(LAYER, 1000, player -> {
            PlayerAnimationController controller = new PlayerAnimationController(player, (c,s,a) -> PlayState.STOP);
            controller.setFirstPersonMode(FirstPersonMode.DISABLED);
            return controller;
        });
        key = KeyBindingHelper.registerKeyBinding(new KeyBinding("key.bloom_cosmetics.emotes", InputUtil.GLFW_KEY_B,
            KeyBinding.Category.create(Identifier.of("bloom_cosmetics", "controls"))));
        ClientTickEvents.END_CLIENT_TICK.register(BloomEmotes::tick);
    }
    private static PlayerAnimationController controller(AbstractClientPlayerEntity player) {
        return (PlayerAnimationController) PlayerAnimationAccess.getPlayerAnimationLayer(player, LAYER);
    }
    public static boolean isActive() {
        var client = MinecraftClient.getInstance();
        return client.player != null && active.containsKey(client.player.getUuid());
    }
    private static EmotePlaybackPolicy.State state(AbstractClientPlayerEntity player, Playback playback) {
        var client = MinecraftClient.getInstance();
        boolean local = player == client.player;
        boolean unavailable = !player.isAlive() || player.isSpectator() || player.hasVehicle()
            || player.isSwimming() || player.isGliding();
        boolean moved = playback != null && Math.abs(player.getX()-playback.x())
            + Math.abs(player.getY()-playback.y()) + Math.abs(player.getZ()-playback.z()) > .04;
        boolean movement = local && (client.options.forwardKey.isPressed() || client.options.backKey.isPressed()
            || client.options.leftKey.isPressed() || client.options.rightKey.isPressed() || client.options.jumpKey.isPressed());
        boolean action = player.isUsingItem() || player.handSwinging
            || local && (client.options.attackKey.isPressed() || client.options.useKey.isPressed());
        return new EmotePlaybackPolicy.State(unavailable, !player.isOnGround(), moved, movement, action,
            playback != null && player.getHealth() < playback.health(), local && !client.isWindowFocused());
    }
    public static void play(EmoteCatalog.Entry entry) {
        var client = MinecraftClient.getInstance();
        if (client.player == null || EmotePlaybackPolicy.cancels(entry.traversal(), state(client.player, null))) return;
        stopLocal();
        String playbackId = UUID.randomUUID().toString();
        if(!start(client.player, entry, playbackId, 0))return;
        if (EmoteSettings.autoThirdPerson && client.options.getPerspective() == Perspective.FIRST_PERSON) {
            previousCamera = client.options.getPerspective();
            client.options.setPerspective(Perspective.THIRD_PERSON_BACK);
            cameraOwned = true;
        }
        EmoteNetwork.start(entry, playbackId);
    }
    private static boolean start(AbstractClientPlayerEntity player, EmoteCatalog.Entry entry, String id, double elapsed) {
        var c = controller(player);
        if (c == null || EmotePlaybackPolicy.cancels(entry.traversal(), state(player, null))) return false;
        c.removeAllModifiers();
        double phase=entry.playback().equals("loop")?elapsed%entry.duration():Math.min(elapsed,entry.duration());
        c.triggerAnimation(entry.clip(), (float)(Math.max(0, phase) * 20));
        // The author owns entry/exit easing. Automatic fades would multiply the
        // first/last 0.2 seconds of the clip and change the editor's motion.
        active.put(player.getUuid(), new Playback(entry,id,System.nanoTime()-(long)(elapsed*1_000_000_000),player.getX(),player.getY(),player.getZ(),player.getHealth()));
        EmoteDevelopment.trace("Playing "+entry.id()+" on "+player.getUuid());
        return true;
    }
    public static boolean remoteStart(UUID uuid, String emote, String revision, String id, double elapsed) {
        var client = MinecraftClient.getInstance();
        if (client.world == null || client.player == null) return false;
        if (uuid.equals(client.player.getUuid())) return true;
        var entry = EmoteCatalog.find(emote,revision);
        if (entry == null || elapsed < 0 || (entry.playback().equals("once") && elapsed >= entry.duration())) return true;
        var prior = active.get(uuid);
        if (prior != null && prior.playbackId().equals(id)) return true;
        for (var player : client.world.getPlayers()) if (player.getUuid().equals(uuid)) return start(player,entry,id,elapsed);
        return false;
    }
    public static void remoteStop(UUID uuid, String id) {
        var client = MinecraftClient.getInstance();
        var p = active.get(uuid);
        if (client.world == null || p == null || !p.playbackId().equals(id)) return;
        for (var player : client.world.getPlayers()) if (player.getUuid().equals(uuid)) { var c=controller(player); if(c!=null)c.stop(); }
        active.remove(uuid);
    }
    public static void stopLocal() {
        var client = MinecraftClient.getInstance();
        if (client.player != null) {
            var p=active.remove(client.player.getUuid());
            var c=controller(client.player); if(c!=null)c.stop();
            if(p!=null){EmoteNetwork.stop(p.playbackId());EmoteDevelopment.trace("Local playback stopped");}
        }
        if (cameraOwned && client.options.getPerspective() == Perspective.THIRD_PERSON_BACK) client.options.setPerspective(previousCamera);
        cameraOwned=false;
    }
    public static void clearRemote() {
        var client = MinecraftClient.getInstance();
        for(var uuid:List.copyOf(active.keySet())) if(client.player==null || !uuid.equals(client.player.getUuid())) remoteStop(uuid,active.get(uuid).playbackId());
    }
    private static void tick(MinecraftClient client) {
        if (world != client.world) {
            stopLocal(); active.clear(); EmoteNetwork.disconnect(); world=client.world;
        }
        if (client.player == null || client.world == null) { while(key.wasPressed()) {} gesture.reset();return; }
        if (cameraOwned && client.options.getPerspective()!=Perspective.THIRD_PERSON_BACK) cameraOwned=false;
        Boolean physical=physicalWheelKeyHeld();
        boolean held=physical!=null?physical:key.isPressed();
        boolean pressed=false;
        while(key.wasPressed()) pressed=true;
        var local=active.get(client.player.getUuid());
        switch(gesture.update(pressed, held, client.currentScreen==null && client.isWindowFocused(), local!=null && local.emote().traversal())) {
            case STOP_TRAVERSAL -> stopLocal();
            case OPEN_WHEEL -> client.setScreen(new EmoteWheelScreen());
            default -> { }
        }
        Set<UUID> present=new HashSet<>();
        for(var player:client.world.getPlayers()) {
            UUID uuid=player.getUuid();present.add(uuid);
            var p=active.get(uuid);if(p==null)continue;
            boolean ended=p.emote().playback().equals("once") && (System.nanoTime()-p.started())/1e9>=p.emote().duration();
            if(ended || EmotePlaybackPolicy.cancels(p.emote().traversal(), state(player,p))) {
                if(player==client.player)stopLocal();else remoteStop(uuid,p.playbackId());
            }
        }
        active.keySet().retainAll(present);
        if(System.nanoTime()>nextNetworkTick) {nextNetworkTick=System.nanoTime()+1_000_000_000;EmoteNetwork.tick(client);}
    }
}
