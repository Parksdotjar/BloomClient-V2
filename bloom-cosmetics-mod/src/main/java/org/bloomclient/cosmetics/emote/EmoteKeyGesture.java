package org.bloomclient.cosmetics.emote;

/** One action per physical press, including a quick tap to stop traversal. */
final class EmoteKeyGesture {
    enum Action { NONE, OPEN_WHEEL, STOP_TRAVERSAL }
    private boolean latched;

    Action update(boolean pressed, boolean held, boolean available, boolean traversal) {
        if (!held) latched = false;
        if (!pressed || latched || !available) return Action.NONE;
        if (traversal) { latched = held; return Action.STOP_TRAVERSAL; }
        if (held) { latched = true; return Action.OPEN_WHEEL; }
        return Action.NONE;
    }

    void reset() { latched = false; }
}
