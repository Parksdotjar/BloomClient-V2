package org.bloomclient.cosmetics.emote;

import com.google.gson.*;
import com.zigythebird.playeranimcore.animation.*;
import com.zigythebird.playeranimcore.bones.PlayerAnimBone;
import com.zigythebird.playeranimcore.enums.PlayState;
import com.zigythebird.playeranimcore.molang.MolangLoader;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class EmotePlaybackTest {
    private static Animation load(JsonObject json, String name) throws IOException {
        return EmoteCatalog.loadClip(new ByteArrayInputStream(json.toString().getBytes(StandardCharsets.UTF_8)), name);
    }
    private static HumanoidAnimationController at(Animation clip, double seconds) {
        var controller = new HumanoidAnimationController((c,s,a)->PlayState.STOP, MolangLoader::createNewEngine);
        controller.triggerAnimation(clip, (float)(seconds*20));
        controller.setupAnim(new AnimationData(0,0,false));
        return controller;
    }
    private static PlayerAnimBone bone(HumanoidAnimationController controller, String name) {
        var result=new PlayerAnimBone(name);controller.get3DTransform(result);return result;
    }
    private JsonObject fixture() throws IOException {
        try(var stream=getClass().getResourceAsStream("/creator.json")) {
            assertNotNull(stream);
            return JsonParser.parseReader(new InputStreamReader(stream,StandardCharsets.UTF_8)).getAsJsonObject();
        }
    }
    @Test void bodyFullTurnsKeepDirectionThroughHalfTurnsAndEndUpright() throws Exception {
        var data=JsonParser.parseString("""
            {"format_version":"1.8.0","animations":{"flip":{"animation_length":5,"bones":{"body":{
            "rotation":{"0":[0,0,0],"1":[-90,0,0],"2":[-180,0,0],"3":[-270,0,0],"4":[-360,0,0],"5":[-360,0,0]}}}}}}
            """).getAsJsonObject();
        var clip=load(data,"flip");var controller=at(clip,0);var state=new AnimationData(0,0,false);int tick=0;
        for(int frame=0;frame<400;frame++) {
            double time=frame/80.0;state.setPartialTick(0);
            while(tick<(int)Math.floor(time*20)){controller.tick(state);tick++;}
            state.setPartialTick((float)(time*20-tick));controller.setupAnim(state);
            assertEquals(-90*Math.min(time,4),Math.toDegrees(bone(controller,"body").getRotX()),.02,"Unwrapped turn at "+time);
        }
        var finalPose=bone(controller,"body");assertEquals(1,Math.cos(finalPose.getRotX()),.00001);
        controller.stop();assertFalse(controller.isActive());
    }
    @Test void editorLayersAndEasingMatchActualPlaybackBetweenKeys() throws Exception {
        var fixture=fixture();
        var clip=load(fixture.getAsJsonObject("animation"),"curve_layers");
        assertNotNull(clip);
        var playing=at(clip,0);var state=new AnimationData(0,0,false);int tick=0;
        for(var item:fixture.getAsJsonArray("samples")) {
            var sample=item.getAsJsonObject();double time=sample.get("time").getAsDouble();
            state.setPartialTick(0);
            while(tick<(int)Math.floor(time*20)){playing.tick(state);tick++;}
            state.setPartialTick((float)(time*20-tick));playing.setupAnim(state);
            // Check ordinary tick/render playback and remote-start fractional seeking.
            for(var controller:List.of(playing,at(clip,time))) {
                var pose=sample.getAsJsonObject("pose");var actual=bone(controller,"right_arm");
                var rotation=pose.getAsJsonArray("rotation");var position=pose.getAsJsonArray("position");
                double[] r={-Math.toDegrees(actual.getRotX()),-Math.toDegrees(actual.getRotY()),Math.toDegrees(actual.getRotZ())};
                double[] p={-actual.getPosX(),actual.getPosY(),actual.getPosZ()};
                for(int axis=0;axis<3;axis++) {
                    assertEquals(rotation.get(axis).getAsDouble(),r[axis],.04,"rotation axis "+axis+" at "+time);
                    assertEquals(position.get(axis).getAsDouble(),p[axis],.003,"position axis "+axis+" at "+time);
                }
            }
        }
    }
    @Test void reverseOrderedVectorKeysRetainSineEasingAndConstantChannels() throws Exception {
        var data=JsonParser.parseString("""
            {"format_version":"1.8.0","animations":{"test":{"animation_length":12,"bones":{"right_arm":{
            "rotation":{"10":[0,0,0],"2":[0,0,0],"0.5":{"vector":[80,0,0],"easing":"easeInOutSine"},"0":[0,0,0]},
            "position":{"vector":[1,2,3]}}}}}}
            """).getAsJsonObject();
        var clip=load(data,"test");
        var actual=bone(at(clip,.125),"right_arm");
        assertEquals(80*(1-Math.cos(Math.PI*.25))/2,Math.toDegrees(actual.getRotX()),.001);
        assertEquals(1,actual.getPosX(),.001);assertEquals(2,actual.getPosY(),.001);assertEquals(3,actual.getPosZ(),.001);
        assertEquals(0,bone(at(clip,11),"right_arm").getRotX(),.001);
        data.getAsJsonObject("animations").getAsJsonObject("test").getAsJsonObject("bones").getAsJsonObject("right_arm")
            .add("position",JsonParser.parseString("[4,5,6]"));
        assertEquals(5,bone(at(load(data,"test"),.125),"right_arm").getPosY(),.001);
    }
    private static double[] vector(JsonElement value) {
        var array=(value.isJsonObject()?value.getAsJsonObject().get("vector"):value).getAsJsonArray();
        return new double[]{array.get(0).getAsDouble(),array.get(1).getAsDouble(),array.get(2).getAsDouble()};
    }
    private static double[] sample(JsonElement track,double time) {
        if(track.isJsonArray()||track.getAsJsonObject().has("vector"))return vector(track);
        var frames=new ArrayList<>(track.getAsJsonObject().entrySet());
        frames.sort(Comparator.comparingDouble(e->Double.parseDouble(e.getKey())));
        if(time<=Double.parseDouble(frames.getFirst().getKey()))return vector(frames.getFirst().getValue());
        for(int i=1;i<frames.size();i++) {
            var a=frames.get(i-1);var b=frames.get(i);double end=Double.parseDouble(b.getKey());
            if(time>end)continue;
            double start=Double.parseDouble(a.getKey()),t=(time-start)/(end-start);
            var value=b.getValue();String easing=value.isJsonObject()&&value.getAsJsonObject().has("easing")?value.getAsJsonObject().get("easing").getAsString().toLowerCase(Locale.ROOT):"linear";
            t=switch(easing){case "easeinsine"->1-Math.cos(t*Math.PI/2);case "easeoutsine"->Math.sin(t*Math.PI/2);case "easeinoutsine"->(1-Math.cos(t*Math.PI))/2;default->t;};
            var from=vector(a.getValue());var to=vector(value);
            for(int axis=0;axis<3;axis++)from[axis]+=(to[axis]-from[axis])*t;
            return from;
        }
        return vector(frames.getLast().getValue());
    }
    @Test void bundledLoopsRepeatTheirMotionAcrossThreeSeams() throws Exception {
        EmoteCatalog.load();
        for(var entry:EmoteCatalog.entries()) {
            if(!entry.playback().equals("loop"))continue;
            JsonObject bones;
            try(var stream=EmoteCatalog.class.getResourceAsStream("/assets/bloom_cosmetics/emotes/"+entry.revision()+".json")) {
                assertNotNull(stream);
                bones=JsonParser.parseReader(new InputStreamReader(stream,StandardCharsets.UTF_8)).getAsJsonObject()
                    .getAsJsonObject("animations").getAsJsonObject(entry.clip().getNameOrId()).getAsJsonObject("bones");
            }
            var controller=at(entry.clip(),0);var state=new AnimationData(0,0,false);int tick=0;
            for(int frame=0;frame<=entry.duration()*80*3+4;frame++) {
                double time=frame/80.0,phase=time%entry.duration();state.setPartialTick(0);
                while(tick<(int)Math.floor(time*20)){controller.tick(state);tick++;}
                state.setPartialTick((float)(time*20-tick));controller.setupAnim(state);
                for(var part:bones.entrySet()) {
                    var actual=bone(controller,part.getKey());
                    for(var channel:part.getValue().getAsJsonObject().entrySet()) {
                        var expected=sample(channel.getValue(),phase);
                        double[] value=channel.getKey().equals("rotation")?
                            new double[]{Math.toDegrees(actual.getRotX()),Math.toDegrees(actual.getRotY()),Math.toDegrees(actual.getRotZ())}:
                            new double[]{actual.getPosX(),actual.getPosY(),actual.getPosZ()};
                        for(int axis=0;axis<3;axis++)assertEquals(expected[axis],value[axis],channel.getKey().equals("rotation")?.04:.003,
                            entry.id()+" loop "+part.getKey()+" "+channel.getKey()+" axis "+axis+" at "+time);
                    }
                }
            }
        }
    }
    @Test void reviewOnlyTraversalClipKeepsItsMotionForTenMovingLoops() throws Exception {
        JsonObject data;
        try(var stream=getClass().getResourceAsStream("/traversal.json")) {
            assertNotNull(stream);
            data=JsonParser.parseReader(new InputStreamReader(stream,StandardCharsets.UTF_8)).getAsJsonObject();
        }
        var clip=load(data,"comet_run");
        var bones=data.getAsJsonObject("animations").getAsJsonObject("comet_run").getAsJsonObject("bones");
        var controller=at(clip,0);var state=new AnimationData(1,1,true);int tick=0;
        for(int frame=0;frame<=640;frame++) {
            double time=frame/80.0,phase=time%.8;state.setPartialTick(0);
            while(tick<(int)Math.floor(time*20)){controller.tick(state);tick++;}
            state.setPartialTick((float)(time*20-tick));controller.setupAnim(state);
            assertTrue(controller.isActive(),"Moving must not end traversal");
            for(var part:bones.entrySet()) {
                var actual=bone(controller,part.getKey());
                for(var channel:part.getValue().getAsJsonObject().entrySet()) {
                    var expected=sample(channel.getValue(),phase);
                    double[] value=channel.getKey().equals("rotation")?
                        new double[]{Math.toDegrees(actual.getRotX()),Math.toDegrees(actual.getRotY()),Math.toDegrees(actual.getRotZ())}:
                        new double[]{actual.getPosX(),actual.getPosY(),actual.getPosZ()};
                    for(int axis=0;axis<3;axis++)assertEquals(expected[axis],value[axis],channel.getKey().equals("rotation")?.04:.003,
                        "Traversal "+part.getKey()+" "+channel.getKey()+" at "+time);
                }
            }
        }
        controller.stop();assertFalse(controller.isActive());
    }
    @Test void everyBundledEmotePlaysAllExportedTransformsInNumericTimeOrder() throws Exception {
        EmoteCatalog.load();
        for(var entry:EmoteCatalog.entries()) {
            JsonObject bones;
            try(var stream=EmoteCatalog.class.getResourceAsStream("/assets/bloom_cosmetics/emotes/"+entry.revision()+".json")) {
                assertNotNull(stream);
                bones=JsonParser.parseReader(new InputStreamReader(stream,StandardCharsets.UTF_8)).getAsJsonObject()
                    .getAsJsonObject("animations").getAsJsonObject(entry.clip().getNameOrId()).getAsJsonObject("bones");
            }
            for(int frame=0;frame<entry.duration()*80;frame++) {
                double time=frame/80.0;var controller=at(entry.clip(),time);
                for(var bone:bones.entrySet()) {
                    var actual=bone(controller,bone.getKey());
                    for(var channel:bone.getValue().getAsJsonObject().entrySet()) {
                        var expected=sample(channel.getValue(),time);
                        double[] value=channel.getKey().equals("rotation")?
                            new double[]{Math.toDegrees(actual.getRotX()),Math.toDegrees(actual.getRotY()),Math.toDegrees(actual.getRotZ())}:
                            new double[]{actual.getPosX(),actual.getPosY(),actual.getPosZ()};
                        // PAL accumulates float segment lengths; allow its subpixel
                        // rounding plus the editor's existing bake tolerance.
                        double tolerance=channel.getKey().equals("rotation")?.04:.003;
                        for(int axis=0;axis<3;axis++)assertEquals(expected[axis],value[axis],tolerance,entry.id()+" "+bone.getKey()+" "+channel.getKey()+" axis "+axis+" at "+time);
                    }
                }
            }
        }
    }
}
