/** Distance, rather than wheel-event count, determines the scroll tick rhythm. */
export class ScrollSoundCadence {
  private distance = 0;
  private lastTick = -Infinity;
  private lastMovement = -Infinity;

  advance(movedPixels: number, now: number): boolean {
    if (!Number.isFinite(movedPixels) || !Number.isFinite(now) || movedPixels <= 0) return false;
    // A new gesture starts fresh. Never drain a backlog after scrolling stops.
    if (now - this.lastMovement > 180 || now < this.lastMovement) this.reset();
    this.lastMovement = now;
    this.distance += movedPixels;
    if (this.distance < 24) return false;
    if (now - this.lastTick < 25) {
      // Carry one pending detent, not a queue of sounds from a large page jump.
      this.distance = 24 + this.distance % 24;
      return false;
    }
    this.distance %= 24;
    this.lastTick = now;
    return true;
  }

  reset() {
    this.distance = 0;
    this.lastTick = -Infinity;
    this.lastMovement = -Infinity;
  }
}
