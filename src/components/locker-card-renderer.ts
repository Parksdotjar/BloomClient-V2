import { WebGLRenderer } from "three";

type Card = { visible: boolean; paint: (renderer: WebGLRenderer, now: number) => void };

class LockerCardRenderer {
  private renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  private cards = new Map<Element, Card>();
  private frame = 0;
  private observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const card = this.cards.get(entry.target);
      if (card) card.visible = entry.isIntersecting;
    }
  }, { rootMargin: "80px" });

  private draw = (now: number) => {
    this.frame = requestAnimationFrame(this.draw);
    for (const card of this.cards.values()) {
      if (card.visible) card.paint(this.renderer, now);
    }
  };

  add(target: HTMLCanvasElement, paint: Card["paint"]) {
    this.cards.set(target, { visible: true, paint });
    this.observer.observe(target);
    if (!this.frame) this.frame = requestAnimationFrame(this.draw);
    return () => {
      this.observer.unobserve(target);
      this.cards.delete(target);
      if (this.cards.size) return;
      cancelAnimationFrame(this.frame);
      this.observer.disconnect();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      shared = undefined;
    };
  }
}

let shared: LockerCardRenderer | undefined;

// Each card keeps its last frame in the DOM so clipping, scrolling and hit testing stay native.
export function registerLockerCard(target: HTMLCanvasElement, render: Card["paint"], needsPaint: () => boolean) {
  const surface = target.getContext("2d", { alpha: true });
  if (!surface) throw new Error("Locker card canvas unavailable");
  shared ??= new LockerCardRenderer();
  return shared.add(target, (renderer, now) => {
    if (!target.width || !target.height || !needsPaint()) return;
    if (renderer.domElement.width !== target.width || renderer.domElement.height !== target.height) {
      renderer.setSize(target.width, target.height, false);
    }
    render(renderer, now);
    surface.globalCompositeOperation = "copy";
    surface.drawImage(renderer.domElement, 0, 0);
  });
}
