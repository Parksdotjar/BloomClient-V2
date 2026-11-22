export type FloatingMenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function fitFloatingMenu(
  bounds: DOMRect,
  width: number,
  contentHeight: number,
  preferredLeft: number,
): FloatingMenuPosition {
  const edge = 8, gap = 5;
  const below = window.innerHeight - bounds.bottom - edge - gap;
  const above = bounds.top - edge - gap;
  const desired = Math.min(380, contentHeight);
  const up = below < desired && above > below;
  const maxHeight = Math.min(380, Math.max(1, up ? above : below));
  const size = Math.min(width, window.innerWidth - edge * 2);
  return { width: size, maxHeight,
    top: up ? bounds.top - gap - Math.min(desired, maxHeight) : bounds.bottom + gap,
    left: Math.max(edge, Math.min(preferredLeft, window.innerWidth - size - edge)) };
}
