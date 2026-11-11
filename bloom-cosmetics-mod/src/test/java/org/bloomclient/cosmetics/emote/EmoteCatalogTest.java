package org.bloomclient.cosmetics.emote;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class EmoteCatalogTest {
    @Test void actualControllerFinishesOneShotsHoldsAndRepeatsLoopsWithoutBundledDemos() throws Exception {
        var state=new com.zigythebird.playeranimcore.animation.AnimationData(0,0,false);
        for(String mode:new String[]{"once","hold","loop"}){
            String loop=mode.equals("hold")?"\"hold_on_last_frame\"":mode.equals("loop")?"true":"false";
            String json="{\"format_version\":\"1.8.0\",\"animations\":{\"test\":{\"animation_length\":1,\"loop\":"+loop+",\"bones\":{\"body\":{\"position\":{\"0\":[0,0,0],\"1\":[0,-6,0]}}}}}}";
            var clip=com.zigythebird.playeranimcore.loading.UniversalAnimLoader.loadAnimations(new java.io.ByteArrayInputStream(json.getBytes(java.nio.charset.StandardCharsets.UTF_8))).get("test");
            var controller=new com.zigythebird.playeranimcore.animation.HumanoidAnimationController((c,s,a)->com.zigythebird.playeranimcore.enums.PlayState.STOP,com.zigythebird.playeranimcore.molang.MolangLoader::createNewEngine);
            controller.triggerAnimation(clip);
            for(int i=0;i<60;i++){controller.tick(state);controller.setupAnim(state);}
            assertEquals(!mode.equals("once"),controller.isActive(),mode);
            if(mode.equals("hold")){
                var before=new com.zigythebird.playeranimcore.bones.PlayerAnimBone("body");controller.get3DTransform(before);
                assertTrue(Math.abs(before.getPosY())>.1,"Hold should retain its body offset");
                for(int i=0;i<50;i++){controller.tick(state);controller.setupAnim(state);}
                var after=new com.zigythebird.playeranimcore.bones.PlayerAnimBone("body");controller.get3DTransform(after);
                assertEquals(before.getPosY(),after.getPosY(),.001);
            }
            controller.stop();assertFalse(controller.isActive());
        }
    }
    @Test void blockbenchVectorExportsAndSineEasingLoadInTheActualLibrary() throws Exception {
        String json="""
            {"format_version":"1.8.0","geckolib_format_version":2,"animations":{"nod":{"animation_length":1,"bones":{"head":{"rotation":{"0":{"vector":[0,0,0]},"0.5":{"vector":[15,0,0],"easing":"easeInOutSine"},"1":{"vector":[0,0,0],"easing":"linear"}}}}}}}
            """;
        var clips=com.zigythebird.playeranimcore.loading.UniversalAnimLoader.loadAnimations(new java.io.ByteArrayInputStream(json.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        assertEquals(20,clips.get("nod").length(),0.01);
        assertNotNull(clips.get("nod").getBone("head"));
    }
    @Test void realPalParserAcceptsEveryAuthoredClipIncludingAnEmptyLibrary() throws Exception {
        EmoteCatalog.load();
        try(var stream=EmoteCatalog.class.getResourceAsStream("/assets/bloom_cosmetics/emotes/catalog.json")){
            assertNotNull(stream);
            var catalog=com.google.gson.JsonParser.parseReader(new java.io.InputStreamReader(stream,java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
            assertEquals(catalog.getAsJsonArray("entries").size(),EmoteCatalog.entries().size(),"Malformed clips must fail rather than silently emptying the wheel");
        }
        for(var entry:EmoteCatalog.entries()) {
            assertFalse(entry.clip().boneAnimations().isEmpty(),entry.id());
            assertEquals(entry.duration()*20,entry.clip().length(),0.01,entry.id());
            assertSame(entry,EmoteCatalog.find(entry.id(),entry.revision()));
            assertNull(EmoteCatalog.find(entry.id(),"unknown"));
        }
    }
}
