package org.bloomclient.cosmetics.emote;

/** Drawing is bounded; selection follows the same wedge to the edge of the screen. */
final class EmoteWheelGeometry {
    private EmoteWheelGeometry() {}
    static boolean center(double x,double y,int radius) { return Math.hypot(x,y)<radius*.36; }
    static int selection(double x,double y,int radius) {
        if(center(x,y,radius))return -1;
        double angle=(Math.atan2(y,x)+Math.PI/2+Math.PI/8+Math.PI*2)%(Math.PI*2);
        return (int)(angle/(Math.PI/4));
    }
    static int drawnSector(double x,double y,int radius) {
        if(Math.hypot(x,y)>radius)return -1;
        int slot=selection(x,y,radius);if(slot<0)return -1;
        double angle=(Math.atan2(y,x)+Math.PI/2+Math.PI/8+Math.PI*2)%(Math.PI*2);
        double within=angle%(Math.PI/4);
        return within<.012||within>Math.PI/4-.012?-1:slot;
    }
}
