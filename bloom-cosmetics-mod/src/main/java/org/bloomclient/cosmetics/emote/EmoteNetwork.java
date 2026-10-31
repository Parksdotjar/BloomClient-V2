package org.bloomclient.cosmetics.emote;

import com.google.gson.*;
import net.minecraft.client.MinecraftClient;
import org.bloomclient.cosmetics.BloomCosmeticsClient;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** All state changes run on the Minecraft client thread; callbacks are connection-generation guarded. */
final class EmoteNetwork {
    private static final HttpClient HTTP=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private static WebSocket socket;
    private static boolean connecting, ready, sending;
    private static final ArrayDeque<String> queue=new ArrayDeque<>();
    private static int generation, failures;
    private static long retryAt, lastRenew, lastSubscription, connectStarted;
    private static String token=EmoteDevelopment.ENDPOINT==null?System.getenv("BLOOM_COSMETICS_SESSION"):EmoteDevelopment.token(), identity, scope, subscription="";
    private static JsonObject outgoing;
    private static long outgoingStarted;
    private static CompletableFuture<WebSocket> pending;
    private static final Map<UUID,Long> seen=new HashMap<>();
    private static final Map<UUID,Remote> remote=new HashMap<>();
    private static double serverOffset;
    private record Remote(String playback,long expires,boolean accepted,JsonObject event){}
    private static void later(int epoch,Runnable task){MinecraftClient.getInstance().execute(()->{if(epoch==generation)task.run();});}
    private static JsonObject message(String type){JsonObject m=new JsonObject();m.addProperty("type",type);return m;}
    private static void send(JsonObject data){
        if(socket==null||!ready)return;
        if(queue.size()>=32){failed();return;}
        queue.add(data.toString());pump();
    }
    private static void pump(){
        if(sending||socket==null||queue.isEmpty())return;
        int epoch=generation;sending=true;
        try{socket.sendText(queue.remove(),true).whenComplete((ws,error)->later(epoch,()->{
            sending=false;if(error!=null)failed();else pump();
        }));}catch(Exception error){failed();}
    }
    private static void sendStart(){
        if(outgoing==null)return;
        JsonObject m=outgoing.deepCopy();
        double elapsed=Math.max(0,(System.nanoTime()-outgoingStarted)/1e9);
        double duration=m.get("duration").getAsDouble();
        String mode=m.get("mode").getAsString();
        if(mode.equals("once")&&elapsed>=duration)return;
        m.addProperty("offset",mode.equals("loop")?elapsed%duration:Math.min(elapsed,duration));send(m);
    }
    static void disconnect(){
        generation++;if(pending!=null)pending.cancel(true);pending=null;
        if(socket!=null)socket.abort();socket=null;connecting=false;ready=false;sending=false;queue.clear();scope=null;subscription="";outgoing=null;
        seen.clear();remote.clear();retryAt=0;failures=0;lastSubscription=0;
        BloomEmotes.clearRemote();
    }
    private static void failed(){
        EmoteDevelopment.trace("Relay disconnected; retry scheduled");
        generation++;if(pending!=null)pending.cancel(true);pending=null;if(socket!=null)socket.abort();socket=null;connecting=false;ready=false;sending=false;queue.clear();
        BloomEmotes.clearRemote();remote.clear();seen.clear();
        retryAt=System.currentTimeMillis()+Math.min(60000,1000L<<Math.min(6,failures++))+ThreadLocalRandom.current().nextLong(500);
    }
    static void start(EmoteCatalog.Entry entry,String id){
        outgoing=message("start");outgoing.addProperty("emote",entry.id());outgoing.addProperty("revision",entry.revision());
        outgoing.addProperty("playbackId",id);outgoing.addProperty("mode",entry.playback());outgoing.addProperty("duration",entry.duration());
        outgoingStarted=System.nanoTime();sendStart();lastRenew=System.currentTimeMillis();
    }
    static void stop(String id){JsonObject m=message("stop");m.addProperty("playbackId",id);send(m);outgoing=null;}
    static void tick(MinecraftClient client){
        long now=System.currentTimeMillis();
        var account=client.getSession().getUuidOrNull();
        if(account==null || client.player==null || !account.equals(client.player.getUuid())){if(socket!=null||connecting)disconnect();return;}
        String currentIdentity=account.toString();
        if(identity!=null&&!identity.equals(currentIdentity)){disconnect();token=null;}
        identity=currentIdentity;
        var server=client.getCurrentServerEntry();
        if(server==null&&EmoteDevelopment.ENDPOINT==null){if(socket!=null||connecting)disconnect();return;}
        String nextScope=hash((EmoteDevelopment.ENDPOINT!=null?EmoteDevelopment.ENDPOINT:server.address.trim().toLowerCase(Locale.ROOT))+"|"+client.world.getRegistryKey().getValue());
        if(scope!=null&&!scope.equals(nextScope))disconnect();
        scope=nextScope;
        if(connecting&&now-connectStarted>20000){failed();return;}
        for(var item:List.copyOf(remote.entrySet()))if(item.getValue().expires()<now){BloomEmotes.remoteStop(item.getKey(),item.getValue().playback());remote.remove(item.getKey());}
        if(socket==null){if(!connecting&&now>=retryAt)connect(client);return;}
        if(!ready)return;
        var ids=new JsonArray();Set<UUID> observed=new HashSet<>();
        client.world.getPlayers().stream().limit(100).forEach(p->{observed.add(p.getUuid());ids.add(p.getUuid().toString());});
        seen.keySet().retainAll(observed);
        for(var id:List.copyOf(remote.keySet()))if(!observed.contains(id)){BloomEmotes.remoteStop(id,remote.get(id).playback());remote.remove(id);}
        // A newly loaded entity may need another tick before it has a grounded pose.
        // Retry only never-started playback; movement-cancelled playback stays suppressed.
        for(var state:List.copyOf(remote.values()))if(!state.accepted())receive(state.event());
        String newSubscription=ids.toString();
        if(!newSubscription.equals(subscription)||now-lastSubscription>10000){
            subscription=newSubscription;lastSubscription=now;JsonObject m=message("subscribe");m.addProperty("scope",scope);m.add("players",ids);send(m);
            JsonObject ping=message("ping");ping.addProperty("echo",now);send(ping);
        }
        if(outgoing!=null&&now-lastRenew>=10000){
            lastRenew=now;JsonObject renew=message("renew");renew.addProperty("playbackId",outgoing.get("playbackId").getAsString());send(renew);
        }
    }
    private static void connect(MinecraftClient client){
        connecting=true;connectStarted=System.currentTimeMillis();int epoch=generation;String expectedIdentity=identity;
        String minecraftToken=client.getSession().getAccessToken();
        CompletableFuture<String> session;
        if(token!=null&&token.matches("bcs_[A-Za-z0-9_-]{43}"))session=CompletableFuture.completedFuture(token);
        else {
            var request=HttpRequest.newBuilder(URI.create(BloomCosmeticsClient.apiBase()+"/v1/cosmetics/sessions"))
                .timeout(Duration.ofSeconds(8)).header("Authorization","Bearer "+minecraftToken).POST(HttpRequest.BodyPublishers.noBody()).build();
            session=HTTP.sendAsync(request,HttpResponse.BodyHandlers.ofString()).thenApply(response->{
                if(response.statusCode()!=201)throw new IllegalStateException("Session unavailable");
                JsonObject body=JsonParser.parseString(response.body()).getAsJsonObject();
                String candidate=body.get("token").getAsString();
                if(!candidate.matches("bcs_[A-Za-z0-9_-]{43}")||!body.get("uuid").getAsString().replace("-","").equalsIgnoreCase(expectedIdentity.replace("-","")))throw new IllegalStateException("Identity mismatch");
                return candidate;
            });
        }
        session.whenComplete((value,error)->later(epoch,()->{
            if(error!=null){failed();return;}
            token=value;
            String base=EmoteDevelopment.ENDPOINT!=null?EmoteDevelopment.ENDPOINT:BloomCosmeticsClient.apiBase();
            URI endpoint=URI.create(base.replaceFirst("^https:","wss:").replaceFirst("^http:","ws:")+"/v1/emotes/socket");
            pending=HTTP.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5)).header("Authorization","Bearer "+token).buildAsync(endpoint,new Listener(epoch));
            pending.whenComplete((ws,problem)->{
                if(problem!=null)later(epoch,()->{
                    Throwable cause=problem instanceof CompletionException?problem.getCause():problem;
                    if(cause instanceof WebSocketHandshakeException handshake&&(handshake.getResponse().statusCode()==401||handshake.getResponse().statusCode()==403))token=null;
                    failed();
                });
                else MinecraftClient.getInstance().execute(()->{if(epoch!=generation)ws.abort();});
            });
        }));
    }
    private static String hash(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
    private static UUID uuid(String s){String v=s.replace("-","");return UUID.fromString(v.substring(0,8)+"-"+v.substring(8,12)+"-"+v.substring(12,16)+"-"+v.substring(16,20)+"-"+v.substring(20));}
    private static void receive(JsonObject m){
        String type=m.get("type").getAsString();long now=System.currentTimeMillis();
        if(type.equals("hello")){
            if(m.get("protocol").getAsInt()!=1||!uuid(m.get("uuid").getAsString()).equals(UUID.fromString(identity))){token=null;throw new IllegalStateException("Identity mismatch");}
            serverOffset=m.get("serverTime").getAsDouble()-now;ready=true;connecting=false;failures=0;subscription="";lastSubscription=0;
            EmoteDevelopment.trace("Relay authenticated as "+identity);
            tick(MinecraftClient.getInstance());sendStart();return;
        }
        if(!ready)throw new IllegalStateException("Missing handshake");
        if(type.equals("pong")){double sent=m.get("echo").getAsDouble();serverOffset=m.get("serverTime").getAsDouble()-(sent+now)/2;return;}
        if(type.equals("snapshot")){
            Set<UUID> present=new HashSet<>();
            for(var e:m.getAsJsonArray("playing")){JsonObject p=e.getAsJsonObject();present.add(uuid(p.get("uuid").getAsString()));receive(p);}
            for(var id:List.copyOf(remote.keySet()))if(!present.contains(id)){BloomEmotes.remoteStop(id,remote.get(id).playback());remote.remove(id);}
            return;
        }
        if(!type.equals("start")&&!type.equals("stop"))return;
        UUID player=uuid(m.get("uuid").getAsString());
        long sequence=m.get("sequence").getAsLong();
        long prior=seen.getOrDefault(player,-1L);
        if(sequence<prior)return;
        if(seen.size()>=512&&!seen.containsKey(player)){failed();return;}
        seen.put(player,sequence);
        String playback=m.get("playbackId").getAsString();
        if(type.equals("stop")){BloomEmotes.remoteStop(player,playback);if(remote.containsKey(player)&&remote.get(player).playback().equals(playback))remote.remove(player);return;}
        double elapsed=Math.max(0,(now+serverOffset-m.get("startedAt").getAsDouble())/1000);
        long expiry=(long)(m.get("expiresAt").getAsDouble()-serverOffset);
        if(expiry<=now)return;
        Remote previous=remote.get(player);
        // Snapshots renew leases but must not resurrect a pose cancelled by observed movement.
        boolean accepted=sequence==prior&&previous!=null&&previous.playback().equals(playback)&&previous.accepted();
        if(!accepted)accepted=BloomEmotes.remoteStart(player,m.get("emote").getAsString(),m.get("revision").getAsString(),playback,elapsed);
        remote.put(player,new Remote(playback,Math.min(expiry,now+31000),accepted,m));
    }
    private static final class Listener implements WebSocket.Listener {
        private final int epoch;private final StringBuilder buffer=new StringBuilder();
        Listener(int epoch){this.epoch=epoch;}
        @Override public void onOpen(WebSocket ws){
            MinecraftClient.getInstance().execute(()->{if(epoch==generation)socket=ws;else ws.abort();});ws.request(1);
        }
        @Override public CompletionStage<?> onBinary(WebSocket ws,java.nio.ByteBuffer bytes,boolean last){ws.abort();later(epoch,EmoteNetwork::failed);return null;}
        @Override public CompletionStage<?> onText(WebSocket ws,CharSequence chars,boolean last){
            if(buffer.length()+chars.length()>65536){ws.abort();later(epoch,EmoteNetwork::failed);return null;}
            buffer.append(chars);
            if(last){String text=buffer.toString();buffer.setLength(0);later(epoch,()->{try{receive(JsonParser.parseString(text).getAsJsonObject());}catch(Exception ignored){failed();}});}
            ws.request(1);return null;
        }
        @Override public CompletionStage<?> onClose(WebSocket ws,int code,String reason){later(epoch,()->{if(code==1008)token=null;failed();});return null;}
        @Override public void onError(WebSocket ws,Throwable error){later(epoch,EmoteNetwork::failed);}
    }
}
