import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

export function SidebarNavigation({ activeKey, motion, pressDuration, children }: { activeKey: string; motion: boolean; pressDuration: number; children: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const surface = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | null>(null);
  const placed = useRef(false);
  const previousKey = useRef<string | null>(null);
  const held = useRef(false);
  const interrupted = useRef(false);
  const reposition = useRef<((animate: boolean) => void) | null>(null);

  useLayoutEffect(() => {
    const container = nav.current;
    const highlight = surface.current;
    if (!container || !highlight) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const position = (animate: boolean) => {
      if (animate && held.current && placed.current) {
        interrupted.current = true;
        return;
      }
      interrupted.current = false;
      const button = container.querySelector<HTMLButtonElement>("button.active");
      if (!button) {
        animation.current?.cancel();
        highlight.hidden = true;
        placed.current = false;
        return;
      }
      const target = `translate(${button.offsetLeft}px, ${button.offsetTop}px)`;
      const from = getComputedStyle(highlight).transform;
      animation.current?.cancel();
      highlight.hidden = false;
      highlight.style.width = `${button.offsetWidth}px`;
      highlight.style.height = `${button.offsetHeight}px`;
      highlight.style.transform = target;
      if (animate && placed.current && motion && !reduced.matches && from !== "none") {
        const current = new DOMMatrixReadOnly(from);
        // One damped spring keeps the turn and slow settle continuous. Separate
        // eased segments paused at the overshoot; fading also changed edge light.
        const frames = Array.from({ length: 61 }, (_, step) => {
          const time = step / 60;
          const progress = step === 60 ? 1 : 1 - Math.exp(-9 * time)
            * (Math.cos(6.25 * time) + 9 / 6.25 * Math.sin(6.25 * time));
          const x = current.m41 + (button.offsetLeft - current.m41) * progress;
          const y = current.m42 + (button.offsetTop - current.m42) * progress;
          return { transform: `translate(${x}px, ${y}px)`, offset: time };
        });
        animation.current = highlight.animate(frames, { duration: 720, easing: "linear" });
      }
      placed.current = true;
    };
    reposition.current = position;
    const changed = previousKey.current !== null && previousKey.current !== activeKey;
    previousKey.current = activeKey;
    position(changed);
    let width = container.clientWidth;
    let height = container.clientHeight;
    const resize = new ResizeObserver(() => {
      if (container.clientWidth === width && container.clientHeight === height) return;
      width = container.clientWidth; height = container.clientHeight;
      position(false);
    });
    resize.observe(container);
    const preferenceChanged = () => position(false);
    reduced.addEventListener("change", preferenceChanged);
    return () => {
      resize.disconnect(); reduced.removeEventListener("change", preferenceChanged);
      if (reposition.current === position) reposition.current = null;
    };
  }, [activeKey, motion]);

  useLayoutEffect(() => {
    const container = nav.current;
    if (!container) return;
    let pointer: number | null = null;
    let keyTarget: HTMLButtonElement | null = null;
    let resumeFrame = 0;
    const buttonFor = (event: Event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
      return button?.parentElement === container && !button.disabled ? button : null;
    };
    const hold = () => {
      held.current = true;
      const highlight = surface.current;
      if (!highlight || animation.current?.playState !== "running") return;
      // Freeze the visible position now. Pausing the WAAPI timeline can defer
      // until the next frame and still move a fast, interrupted slide.
      const visible = getComputedStyle(highlight).transform;
      animation.current.cancel();
      animation.current = null;
      highlight.style.transform = visible;
      interrupted.current = true;
    };
    const release = () => {
      pointer = null;
      keyTarget = null;
      held.current = false;
      cancelAnimationFrame(resumeFrame);
      // A completed click may select a new route first. Outside releases resume
      // toward the existing route instead; neither path changes selection here.
      resumeFrame = requestAnimationFrame(() => {
        if (!held.current && interrupted.current) reposition.current?.(true);
      });
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || !buttonFor(event)) return;
      pointer = event.pointerId;
      hold();
    };
    const up = (event: PointerEvent) => { if (pointer === event.pointerId) release(); };
    const keyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      keyTarget = buttonFor(event);
      if (keyTarget) hold();
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === "Space" && keyTarget) release(); };
    const focusOut = () => { if (keyTarget) release(); };
    const visibility = () => { if (document.hidden) release(); };
    container.addEventListener("pointerdown", down, { passive: true });
    container.addEventListener("keydown", keyDown);
    container.addEventListener("focusout", focusOut);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelAnimationFrame(resumeFrame);
      held.current = false;
      container.removeEventListener("pointerdown", down);
      container.removeEventListener("keydown", keyDown);
      container.removeEventListener("focusout", focusOut);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useLayoutEffect(() => () => animation.current?.cancel(), []);
  return <nav ref={nav} className="sidebar-navigation" aria-label="Main navigation"
    data-press-motion={motion && pressDuration > 0 ? "on" : "off"}
    style={{ "--sidebar-press-duration": `${Math.max(0, Math.min(1500, pressDuration))}ms` } as CSSProperties}>
    <span ref={surface} className="sidebar-selection" aria-hidden="true" hidden>
      <span className="sidebar-selection-surface" />
    </span>
    {children}
  </nav>;
}
