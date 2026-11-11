import { useEffect, useLayoutEffect, useRef } from "react";
import { playInteractionSound } from "./interaction-sounds";

const soundIntents = new WeakMap<HTMLButtonElement, { value: boolean; at: number }>();

/** Arm only the deliberate activation; loading or refreshing state is silent. */
export function requestToggleSound(button: HTMLButtonElement, value: boolean) {
  if (!button.disabled && !button.closest('[data-ui-sound="none"]')) soundIntents.set(button, { value, at: performance.now() });
}

/** A one-shot thumb response to a confirmed state change, never to initial render. */
export function useToggleFeedback(value: boolean) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previousValue = useRef(value);
  const active = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    const button = buttonRef.current;
    const intent = button ? soundIntents.get(button) : undefined;
    if (button) soundIntents.delete(button);
    if (intent?.value === value && performance.now() - intent.at < 5000) void playInteractionSound(value ? "toggleOn" : "toggleOff");
    const thumb = button?.querySelector<HTMLElement>(":scope > span");
    // Capture the interrupted squash before canceling it, so quick reversals
    // continue from their visible shape instead of jumping back to a circle.
    const startScale = thumb && active.current ? getComputedStyle(thumb).scale : "1 1";
    active.current?.cancel();
    active.current = null;
    if (!button || !thumb || button.disabled || document.hidden || typeof thumb.animate !== "function") return;
    const root = document.documentElement;
    if (root.dataset.animations !== "on" || root.dataset.performance === "ultra"
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const animation = thumb.animate([
      { scale: startScale === "none" ? "1 1" : startScale, offset: 0 },
      { scale: "1.22 .84", offset: .32 },
      { scale: "1.06 .97", offset: .72 },
      { scale: "1 1", offset: 1 },
    ], { duration: 220, easing: "cubic-bezier(.22,.72,.2,1)" });
    active.current = animation;
    animation.onfinish = () => {
      if (active.current === animation) active.current = null;
    };
  }, [value]);

  useEffect(() => () => {
    active.current?.cancel();
    active.current = null;
  }, []);

  return buttonRef;
}
