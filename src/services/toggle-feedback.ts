import { useEffect, useLayoutEffect, useRef } from "react";

/** A one-shot thumb response to a confirmed state change, never to initial render. */
export function useToggleFeedback(value: boolean) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previousValue = useRef(value);
  const active = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    const button = buttonRef.current;
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
