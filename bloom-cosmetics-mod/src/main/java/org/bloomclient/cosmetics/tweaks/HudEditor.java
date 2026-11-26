package org.bloomclient.cosmetics.tweaks;

import net.minecraft.client.gui.Click;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import static org.bloomclient.cosmetics.tweaks.Setting.*;

final class HudEditor extends TweaksScreen {
    private Feature selected;
    private boolean dragging;
    private record Resize(HudPlacement.Corner corner, HudPlacement start, double mouseX, double mouseY) {}
    private Resize resize;
    private double offsetX, offsetY;
    private int guideX = -1, guideY = -1;

    HudEditor(Screen parent) { super("Edit HUD",parent); }
    void select(Feature f) { selected = f; }

    @Override protected void init() {
        super.init();
        int base = Math.min(252,width - 12), left = (width - base)/2;
        boolean controlsOnTop = Preferences.on(null,EDITOR_TOP);
        int y = controlsOnTop ? 24 : height - 48;
        boolean anyDisabled = false;
        for (var f : Hud.ELEMENTS) if (!Preferences.on(f,ENABLED)) anyDisabled = true;
        int third = (base - 8)/3;
        button("Add HUD…",left,y,third,() -> show(TweaksMenu.add(this))).active = anyDisabled;
        button("Snap: " + (Preferences.on(null,SNAP) ? "ON" : "OFF"),left + third + 4,y,third,() -> {
            Preferences.set(null,SNAP,Preferences.on(null,SNAP) ? 0 : 1);
            clearAndInit();
        });
        button(controlsOnTop ? "Controls ↓" : "Controls ↑",left + 2 * (third + 4),y,base - 2 * (third + 4),() -> {
            Preferences.set(null,EDITOR_TOP,controlsOnTop ? 0 : 1);
            clearAndInit();
        });
        gear(selected == null ? "HUD" : selected.label,left,y + 24,() -> show(TweaksMenu.settings(this,selected))).active = selected != null;
        button("Reset position",left + 24,y + 24,base - 90,() -> {
            Preferences.resetPosition(selected);
            Preferences.save();
        }).active = selected != null;
        button("Done",left + base - 62,y + 24,62,this::back);
    }

    @Override public void renderBackground(DrawContext g,int mx,int my,float delta) {
        // Keep the game visible at its normal brightness.
    }

    @Override public void render(DrawContext g,int mx,int my,float delta) {
        Hud.draw(g,true);
        Feature hovered = resize == null ? hovered(mx,my) : selected;
        boolean empty = true;
        for (var f : Hud.ELEMENTS) if (Preferences.on(f,ENABLED)) {
            empty = false;
            var r = Hud.panel(f,true).rect(width,height);
            if (selected == f || hovered == f) g.drawStrokedRectangle(r.x(),r.y(),r.w(),r.h(),selected == f ? -1 : 0x99FFFFFF);
        }
        if (hovered != null) {
            var rect = Hud.panel(hovered,true).rect(width,height);
            int radius = HudPlacement.Corner.HANDLE_RADIUS;
            for (var corner : HudPlacement.Corner.values()) {
                int x = corner.x(rect), y = corner.y(rect);
                g.fill(x - radius,y - radius,x + radius + 1,y + radius + 1,
                    corner.contains(rect,mx,my) ? 0xFFFFFFFF : 0xDFFFFFFF);
            }
        }
        if (guideX >= 0) {
            int x = Math.min(guideX, width - 1);
            g.fill(x,0,x + 1,height,0x88FFFFFF);
        }
        if (guideY >= 0) {
            int y = Math.min(guideY, height - 1);
            g.fill(0,y,width,y + 1,0x88FFFFFF);
        }
        g.drawCenteredTextWithShadow(textRenderer,getTitle(),width / 2,8,-1);
        if (empty) g.drawCenteredTextWithShadow(textRenderer,"No HUD elements enabled",width / 2,height / 2 - 5,-1);
        super.render(g,mx,my,delta);
        drawGears(g);
    }

    private Feature hovered(double x, double y) {
        for (int i = Hud.ELEMENTS.length - 1; i >= 0; i--) {
            var f = Hud.ELEMENTS[i];
            if (!Preferences.on(f,ENABLED)) continue;
            var r = Hud.panel(f,true).rect(width,height);
            if (r.contains(x,y) || cornerAt(r,x,y) != null) return f;
        }
        return null;
    }

    private HudPlacement.Corner cornerAt(HudPlacement rect, double x, double y) {
        for (var corner : HudPlacement.Corner.values()) if (corner.contains(rect,x,y)) return corner;
        return null;
    }

    @Override public boolean mouseClicked(Click click, boolean doubled) {
        if (super.mouseClicked(click,doubled)) return true;
        if (click.button() != DelightTweaks.PRIMARY) return false;
        var target = hovered(click.x(),click.y());
        if (target == null) return false;
        selected = target;
        var rect = Hud.panel(selected,true).rect(width,height);
        var corner = cornerAt(rect,click.x(),click.y());
        if (corner == null) {
            offsetX = click.x() - rect.x();
            offsetY = click.y() - rect.y();
            dragging = true;
        } else {
            resize = new Resize(corner,rect,click.x(),click.y());
        }
        clearAndInit();
        return true;
    }
    @Override public boolean mouseDragged(Click click,double dx,double dy) {
        if (click.button() != DelightTweaks.PRIMARY || (!dragging && resize == null)) return super.mouseDragged(click,dx,dy);
        if (resize != null) {
            var corner = resize.corner();
            int scale = corner.scale(resize.start(),click.x() - resize.mouseX(),click.y() - resize.mouseY());
            Preferences.set(selected,SCALE,scale);
            var resized = Hud.panel(selected,true).rect(width,height);
            Preferences.move(selected,corner.anchorX(resize.start(),resized,width),corner.anchorY(resize.start(),resized,height));
            return true;
        }
        var r = Hud.panel(selected,true).rect(width,height);
        int x = axis(click.x() - offsetX,r.w(),width,true);
        int y = axis(click.y() - offsetY,r.h(),height,false);
        Preferences.move(selected,HudPlacement.anchor(x,width,r.w()),HudPlacement.anchor(y,height,r.h()));
        return true;
    }

    private int axis(double desired,int size,int screen,boolean horizontal) {
        int end = HudPlacement.travel(screen,size);
        int pos = Math.clamp((int)Math.round(desired),0,end);
        int result = pos, guide = -1, best = 4;
        if (Preferences.on(null,SNAP)) {
            var targets = new java.util.ArrayList<Integer>();
            targets.add(0);
            targets.add(screen/2);
            targets.add(screen);
            for (var f : Hud.ELEMENTS) if (f != selected && Preferences.on(f,ENABLED)) {
                var other = Hud.panel(f,true).rect(width,height);
                int start = horizontal ? other.x() : other.y(), span = horizontal ? other.w() : other.h();
                targets.add(start);
                targets.add(start + span);
                targets.add(start + span / 2);
            }
            for (int target : targets) for (int offset : new int[]{0,size / 2,size}) {
                int next = target - offset, distance = Math.abs(next - pos);
                if (distance < best && next >= 0 && next <= end) {
                    best = distance;
                    result = next;
                    guide = target;
                }
            }
        }
        if (horizontal) guideX = guide; else guideY = guide;
        return result;
    }
    @Override public boolean mouseReleased(Click click) {
        if (click.button() != DelightTweaks.PRIMARY || (!dragging && resize == null)) return super.mouseReleased(click);
        dragging = false;
        resize = null;
        guideX = guideY = -1;
        Preferences.save();
        return true;
    }
}
