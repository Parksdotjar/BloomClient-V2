package org.bloomclient.cosmetics.emote;

import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.Click;
import net.minecraft.client.input.KeyInput;
import net.minecraft.text.Text;
import net.minecraft.client.util.InputUtil;
import java.util.*;

public final class EmoteWheelScreen extends Screen {
    private int page, selected=-1, radius;
    private boolean keyboard, finished;
    private double lastX=-1,lastY=-1;
    private final List<int[]> spans=new ArrayList<>();
    public EmoteWheelScreen(){super(Text.literal("Bloom Emotes"));}
    @Override public boolean shouldPause(){return false;}
    @Override protected void init(){
        radius=Math.max(60,Math.min(115,Math.min(width/2-12,height/2-32)));
        spans.clear();
        for(int y=-radius;y<=radius;y++) {
            int start=-radius,prior=EmoteWheelGeometry.drawnSector(-radius,y,radius);
            for(int x=-radius+1;x<=radius+1;x++) {
                int next=x>radius?-1:EmoteWheelGeometry.drawnSector(x,y,radius);
                if(next!=prior){if(prior>=0)spans.add(new int[]{start,y,x,prior});start=x;prior=next;}
            }
        }
    }
    private int pages(){return Math.max(1,(EmoteCatalog.entries().size()+7)/8);}
    private EmoteCatalog.Entry entry(int slot){int n=page*8+slot;return slot>=0&&n<EmoteCatalog.entries().size()?EmoteCatalog.entries().get(n):null;}
    private void dismiss(){finished=true;net.minecraft.client.MinecraftClient.getInstance().setScreen(null);}
    private void choose(int slot){var e=entry(slot);if(e!=null&&!finished){dismiss();BloomEmotes.play(e);}}
    private void pointer(double x,double y){
        x=Math.floor(x);y=Math.floor(y);
        if(x!=lastX||y!=lastY){keyboard=false;lastX=x;lastY=y;}
        if(!keyboard)selected=EmoteWheelGeometry.selection(x-width/2,y-height/2,radius);
    }
    private void releaseSelection(){
        if(finished)return;
        var client=net.minecraft.client.MinecraftClient.getInstance();
        if(!client.isWindowFocused()||client.player==null||client.world==null){dismiss();return;}
        // Read the current pointer, not the previous rendered frame, on a quick flick.
        pointer(client.mouse.getScaledX(client.getWindow()),client.mouse.getScaledY(client.getWindow()));
        if(entry(selected)!=null)choose(selected);
        else {
            if(!keyboard&&EmoteWheelGeometry.center(lastX-width/2,lastY-height/2,radius))BloomEmotes.stopLocal();
            dismiss();
        }
    }
    @Override public void tick(){
        var client=net.minecraft.client.MinecraftClient.getInstance();
        if(!client.isWindowFocused()||client.player==null||client.world==null){dismiss();return;}
        if(Boolean.FALSE.equals(BloomEmotes.physicalWheelKeyHeld()))releaseSelection();
    }
    private void navigate(int direction){
        keyboard=true;
        if(selected<0)selected=direction>0?7:0;
        for(int i=0;i<8;i++){selected=Math.floorMod(selected+direction,8);if(entry(selected)!=null)break;}
    }
    private String label(String name){
        int max=(int)(radius*.72);
        if(textRenderer.getWidth(name)<=max)return name;
        while(!name.isEmpty()&&textRenderer.getWidth(name+"…")>max)name=name.substring(0,name.offsetByCodePoints(name.length(),-1));
        return name+"…";
    }
    @Override public void render(DrawContext graphics,int mx,int my,float delta){
        pointer(mx,my);
        int cx=width/2,cy=height/2;
        graphics.fill(0,0,width,height,0x66000000);
        for(int y=-(int)(radius*.36);y<=(int)(radius*.36);y++){int half=(int)Math.sqrt(radius*radius*.36*.36-y*y);graphics.fill(cx-half,cy+y,cx+half+1,cy+y+1,0xFF000000);}
        for(var s:spans){int color=entry(s[3])==null?0xFF050505:s[3]==selected?0xFF28171F:0xFF000000;graphics.fill(cx+s[0],cy+s[1],cx+s[2],cy+s[1]+1,color);}
        for(int i=0;i<8;i++){
            var e=entry(i);if(e==null)continue;
            double angle=-Math.PI/2+i*Math.PI/4;
            int x=cx+(int)(Math.cos(angle)*radius*.68),y=cy+(int)(Math.sin(angle)*radius*.68);
            graphics.drawCenteredTextWithShadow(textRenderer,Integer.toString(i+1),x,y-9,0xFFAC7D96);
            graphics.drawCenteredTextWithShadow(textRenderer,label(e.name()),x,y+3,0xFFF4F1F3);
        }
        graphics.drawCenteredTextWithShadow(textRenderer,EmoteCatalog.entries().isEmpty()?"No emotes":BloomEmotes.isActive()?"Stop":"Emotes",cx,cy-4,0xFFF4F1F3);
        graphics.drawCenteredTextWithShadow(textRenderer,(page+1)+" / "+pages(),cx,cy+radius+9,0xFFBBBBBB);
        graphics.drawCenteredTextWithShadow(textRenderer,"C: Auto camera "+(EmoteSettings.autoThirdPerson?"on":"off"),cx,cy+radius+23,0xFFBBBBBB);
    }
    @Override public boolean mouseClicked(Click click,boolean doubled){
        if(BloomEmotes.key.matchesMouse(click))return true;
        if(click.button()!=0)return true;
        int slot=EmoteWheelGeometry.selection(click.x()-width/2,click.y()-height/2,radius);
        if(slot>=0)choose(slot);
        else if(Math.hypot(click.x()-width/2,click.y()-height/2)<radius*.36){BloomEmotes.stopLocal();dismiss();}
        return true;
    }
    @Override public boolean mouseReleased(Click click){
        if(BloomEmotes.key.matchesMouse(click)){releaseSelection();return true;}
        return super.mouseReleased(click);
    }
    @Override public boolean keyReleased(KeyInput input){
        if(BloomEmotes.key.matchesKey(input)){releaseSelection();return true;}
        return super.keyReleased(input);
    }
    @Override public boolean mouseScrolled(double x,double y,double horizontal,double vertical){
        if(vertical!=0){page=Math.floorMod(page+(vertical<0?1:-1),pages());selected=-1;}return true;
    }
    @Override public boolean keyPressed(KeyInput input){
        int code=input.key();
        if(code==InputUtil.GLFW_KEY_ESCAPE){dismiss();return true;}
        if(BloomEmotes.key.matchesKey(input))return true; // Ignore hold-key repeat.
        if(code>=InputUtil.GLFW_KEY_1&&code<=InputUtil.GLFW_KEY_8){choose(code-InputUtil.GLFW_KEY_1);return true;}
        if(code==InputUtil.GLFW_KEY_C){EmoteSettings.toggleCamera();return true;}
        if(code==InputUtil.GLFW_KEY_LEFT||code==InputUtil.GLFW_KEY_RIGHT||code==InputUtil.GLFW_KEY_UP||code==InputUtil.GLFW_KEY_DOWN){navigate(code==InputUtil.GLFW_KEY_RIGHT||code==InputUtil.GLFW_KEY_DOWN?1:-1);return true;}
        if(code==InputUtil.GLFW_KEY_PAGE_UP||code==InputUtil.GLFW_KEY_PAGE_DOWN){page=Math.floorMod(page+(code==InputUtil.GLFW_KEY_PAGE_DOWN?1:-1),pages());selected=-1;return true;}
        if(code==InputUtil.GLFW_KEY_ENTER){if(selected>=0)choose(selected);else{BloomEmotes.stopLocal();dismiss();}return true;}
        return super.keyPressed(input);
    }
}
