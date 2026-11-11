import { playInteractionSound, stopInteractionSounds, type SoundCue } from "./interaction-sounds";
import { ScrollSoundCadence } from "./scroll-sound-cadence";

// One delegated listener per input type; no polling, hover or typing sounds.
export function installInteractionSoundFeedback(options: { scroll: boolean }) {
  const clickCues = new WeakMap<Event, SoundCue>();
  const click = (event: MouseEvent) => {
    if (!event.isTrusted || event.button !== 0 || event.defaultPrevented || !(event.target instanceof Element)) return;
    const control = event.target.closest<HTMLElement>('button, [role="button"], [role="switch"], input[type="checkbox"], summary');
    if (!control || control.closest('[data-ui-sound="none"], [inert], [aria-disabled="true"]') || control.matches(':disabled, .window-control, [data-sound-stateful]')) return;
    let cue: SoundCue = "button";
    if (control.matches(".toggle, .utility-toggle, .fill-checkbox") || control.getAttribute("role") === "switch") {
      cue = control.getAttribute("aria-pressed") === "true" || control.getAttribute("aria-checked") === "true" ? "toggleOff" : "toggleOn";
    } else if (control instanceof HTMLInputElement) {
      cue = control.checked ? "toggleOn" : "toggleOff";
    }
    clickCues.set(event, cue);
  };
  // Capture the old toggle state, then play only after React accepts the click.
  // Cancelled or stopped drag clicks never reach this bubble listener.
  const acceptedClick = (event: MouseEvent) => {
    const cue = clickCues.get(event);
    if (cue && !event.defaultPrevented) void playInteractionSound(cue);
  };

  type ScrollPosition = {
    x: number; y: number; cadence: ScrollSoundCadence;
    inputAt: number; movedAt: number; started: boolean;
    directionX: number; directionY: number;
  };
  const armed = new Map<Element, ScrollPosition>();
  const positions = new WeakMap<Element, { x: number; y: number }>();
  const prime = (target: EventTarget | null) => {
    // A passive wheel handler can run after the compositor has already moved
    // the pane. Remember its position before that input arrives instead.
    if (!(target instanceof Element)) return;
    for (let node: Element | null = target; node; node = node.parentElement) {
      positions.set(node, { x: node.scrollLeft, y: node.scrollTop });
    }
  };
  const enter = (event: PointerEvent) => prime(event.target);
  const arm = (target: EventTarget | null, directionX: number, directionY: number) => {
    const now = performance.now();
    const previous = new Map(armed);
    armed.clear();
    if (!(target instanceof Element)) return;
    for (let node: Element | null = target; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) {
        const style = getComputedStyle(node);
        if (!/(auto|scroll)/.test(style.overflowY + style.overflowX)) continue;
        const old = previous.get(node);
        const baseline = positions.get(node);
        const continuing = old && now - Math.max(old.inputAt, old.movedAt) <= 180;
        const position: ScrollPosition = continuing ? old : {
          x: baseline?.x ?? node.scrollLeft, y: baseline?.y ?? node.scrollTop, cadence: new ScrollSoundCadence(),
          inputAt: now, movedAt: now, started: false, directionX, directionY,
        };
        if (position.directionX * directionX < 0 || position.directionY * directionY < 0) position.cadence.reset();
        position.inputAt = now;
        position.directionX = directionX; position.directionY = directionY;
        armed.set(node, position);
      }
    }
  };
  const wheel = (event: WheelEvent) => {
    if (!event.isTrusted || event.defaultPrevented) return;
    if (event.ctrlKey) { armed.clear(); return; }
    if (!event.deltaX && !event.deltaY) return;
    arm(event.target, Math.sign(event.deltaX), Math.sign(event.deltaY));
  };
  const key = (event: KeyboardEvent) => {
    if (!event.isTrusted || event.defaultPrevented) return;
    if (event.ctrlKey || event.altKey || event.metaKey || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)
      || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], button, [role="button"], [role="slider"]'))) {
      armed.clear(); return;
    }
    const direction = ["ArrowUp", "ArrowLeft", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey) ? -1 : 1;
    arm(event.target, ["ArrowLeft", "ArrowRight"].includes(event.key) ? direction : 0, ["ArrowLeft", "ArrowRight"].includes(event.key) ? 0 : direction);
  };
  const scroll = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const x = event.target.scrollLeft, y = event.target.scrollTop;
    positions.set(event.target, { x, y });
    const position = armed.get(event.target);
    if (!position) return;
    const now = performance.now();
    // Native smooth scrolling and trackpad inertia continue only while actual
    // movement keeps arriving. No timer or animation loop manufactures ticks.
    const idleLimit = position.started ? 140 : 220;
    if (now - Math.max(position.inputAt, position.movedAt) > idleLimit || now - position.inputAt > 1500) {
      armed.delete(event.target); return;
    }
    const moved = Math.hypot(x - position.x, y - position.y);
    position.x = x; position.y = y;
    if (!moved) return;
    position.started = true;
    position.movedAt = now;
    if (position.cadence.advance(moved, now)) void playInteractionSound("scroll");
  };
  // Clicking/focusing elsewhere must not lend a previous wheel gesture to a
  // programmatic page jump, dropdown reposition, or an unrelated reveal.
  const disarm = () => armed.clear();
  const pointerDown = (event: PointerEvent) => { disarm(); prime(event.target); };
  const quiet = () => { disarm(); stopInteractionSounds(); };
  const visibility = () => { if (document.hidden) quiet(); };
  document.addEventListener("click", click, true);
  document.addEventListener("click", acceptedClick);
  if (options.scroll) {
    prime(document.activeElement);
    document.addEventListener("wheel", wheel, { capture: true, passive: true });
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", scroll, { capture: true, passive: true });
    document.addEventListener("pointerover", enter, { capture: true, passive: true });
    document.addEventListener("pointerdown", pointerDown, true);
  }
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("blur", quiet);
  return () => {
    document.removeEventListener("click", click, true);
    document.removeEventListener("click", acceptedClick);
    document.removeEventListener("wheel", wheel, true);
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("scroll", scroll, true);
    document.removeEventListener("pointerover", enter, true);
    document.removeEventListener("pointerdown", pointerDown, true);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("blur", quiet);
    quiet();
  };
}
