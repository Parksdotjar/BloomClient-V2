package org.bloomclient.cosmetics.emote;

/** Shared by local and observed players. Traversal replaces the walking pose only. */
final class EmotePlaybackPolicy {
    record State(boolean unavailable, boolean airborne, boolean moved, boolean movementInput,
                 boolean actionInput, boolean damaged, boolean unfocused) {}

    static boolean cancels(boolean traversal, State state) {
        return state.unavailable() || (!traversal && (state.airborne() || state.moved()
            || state.movementInput() || state.actionInput() || state.damaged() || state.unfocused()));
    }
}
