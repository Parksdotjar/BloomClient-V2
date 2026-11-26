package org.bloomclient.cosmetics.tweaks;

/** GUI coordinates shared by rendering, hit testing, snapping and persistence. */
record HudPlacement(int x, int y, int w, int h, float scale) {
    static final int HOTBAR_WIDTH = 182;
    static final int HOTBAR_HEIGHT = 22;
    static final int HOTBAR_SLOT_SIZE = 20;
    // The visible offhand frame ends seven pixels before the main hotbar.
    static final int OFFHAND_GAP = 7;
    private static final int DURABILITY_GAP = 4;

    static HudPlacement fit(Feature feature, int width, int height, int contentWidth, int contentHeight,
                            float requestedScale, double anchorX, double anchorY, boolean offhandOnRight) {
        int availableWidth = Math.max(1, width);
        int availableHeight = Math.max(1, height);
        float scale = Math.min(requestedScale, Math.min(availableWidth / (float)contentWidth,
            availableHeight / (float)contentHeight));
        int w = Math.min(availableWidth, (int)Math.ceil(contentWidth * scale));
        int h = Math.min(availableHeight, (int)Math.ceil(contentHeight * scale));
        int x = Double.isNaN(anchorX) ? defaultX(feature, width, w, offhandOnRight)
            : origin(width,w,anchorX);
        int y = Double.isNaN(anchorY) ? defaultY(feature, width, height, w, h, offhandOnRight)
            : origin(height,h,anchorY);
        return new HudPlacement(Math.clamp(x,0,travel(width,w)),Math.clamp(y,0,travel(height,h)),w,h,scale);
    }

    private static int defaultX(Feature feature, int width, int w, boolean offhandOnRight) {
        int hotbarEdge = width / 2 + (offhandOnRight ? -HOTBAR_WIDTH / 2 : HOTBAR_WIDTH / 2);
        return switch (feature) {
            case ARMOR -> offhandOnRight ? hotbarEdge - OFFHAND_GAP - w : hotbarEdge + OFFHAND_GAP;
            case DURABILITY -> {
                int x = durabilityX(hotbarEdge, w, offhandOnRight);
                yield x >= 0 && x + w <= width ? x : offhandOnRight ? hotbarEdge : hotbarEdge - w;
            }
            case FPS, COORDINATES -> 6;
            default -> insetOrigin(width,w,feature.x);
        };
    }

    private static int defaultY(Feature feature, int width, int height, int w, int h, boolean offhandOnRight) {
        return switch (feature) {
            case ARMOR -> height - h;
            case DURABILITY -> {
                int edge = width / 2 + (offhandOnRight ? -HOTBAR_WIDTH / 2 : HOTBAR_WIDTH / 2);
                int x = durabilityX(edge, w, offhandOnRight);
                yield height - h - (x < 0 || x + w > width ? HOTBAR_HEIGHT : 0);
            }
            case COORDINATES -> 6;
            case FPS -> 20;
            default -> insetOrigin(height,h,feature.y);
        };
    }

    private static int durabilityX(int hotbarEdge, int width, boolean offhandOnRight) {
        int offset = OFFHAND_GAP + HOTBAR_SLOT_SIZE + DURABILITY_GAP;
        return offhandOnRight ? hotbarEdge - offset - width : hotbarEdge + offset;
    }

    static int travel(int screen, int size) { return Math.max(0,screen - size); }

    private static int origin(int screen, int size, double anchor) {
        return (int)Math.round(Math.clamp(anchor,0,1) * travel(screen,size));
    }

    private static int insetOrigin(int screen, int size, double anchor) {
        int inset = 6;
        return inset + origin(screen - 2 * inset,size,anchor);
    }

    static double anchor(int origin, int screen, int size) {
        return Math.clamp(origin / (double)Math.max(1,travel(screen,size)),0,1);
    }

    enum Corner {
        TOP_LEFT(false, false), TOP_RIGHT(true, false), BOTTOM_LEFT(false, true), BOTTOM_RIGHT(true, true);

        static final int HANDLE_RADIUS = 2;
        final boolean right, bottom;

        Corner(boolean right, boolean bottom) {
            this.right = right;
            this.bottom = bottom;
        }

        int x(HudPlacement rect) { return rect.x + (right ? rect.w - 1 : 0); }
        int y(HudPlacement rect) { return rect.y + (bottom ? rect.h - 1 : 0); }

        boolean contains(HudPlacement rect, double px, double py) {
            return Math.abs(px - x(rect)) <= HANDLE_RADIUS + 0.5
                && Math.abs(py - y(rect)) <= HANDLE_RADIUS + 0.5;
        }

        int scale(HudPlacement start, double dx, double dy) {
            double horizontal = right ? start.w : -start.w;
            double vertical = bottom ? start.h : -start.h;
            double change = (dx * horizontal + dy * vertical) / (horizontal * horizontal + vertical * vertical);
            return Setting.SCALE.clamp((int)Math.round(100 * start.scale * (1 + change)));
        }

        double anchorX(HudPlacement start, HudPlacement resized, int width) {
            return anchor(start.x + (right ? 0 : start.w - resized.w), width, resized.w);
        }

        double anchorY(HudPlacement start, HudPlacement resized, int height) {
            return anchor(start.y + (bottom ? 0 : start.h - resized.h), height, resized.h);
        }
    }

    boolean contains(double px, double py) {
        return px >= x && py >= y && px < x + w && py < y + h;
    }
}
