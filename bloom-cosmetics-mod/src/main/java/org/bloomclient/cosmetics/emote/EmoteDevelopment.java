package org.bloomclient.cosmetics.emote;

import java.net.URI;
import net.fabricmc.loader.api.FabricLoader;

/** Opt-in loopback harness. Fabric production launches cannot enable this override. */
final class EmoteDevelopment {
    static final String ENDPOINT=endpoint();
    private static String endpoint(){
        if(!FabricLoader.getInstance().isDevelopmentEnvironment())return null;
        String value=System.getProperty("bloom.emotes.testEndpoint");
        if(value==null)return null;
        URI uri=URI.create(value);
        if(!"http".equals(uri.getScheme())||!"127.0.0.1".equals(uri.getHost())||uri.getPort()<1||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||!uri.getPath().isEmpty())throw new IllegalArgumentException("Emote test endpoint must be http://127.0.0.1:port");
        return value;
    }
    static String token(){return ENDPOINT==null?null:System.getProperty("bloom.emotes.testSession");}
    static void trace(String message){if(ENDPOINT!=null)org.slf4j.LoggerFactory.getLogger("BloomEmoteTest").info(message);}
}
