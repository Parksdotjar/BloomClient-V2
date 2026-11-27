import { Vector3, type PerspectiveCamera } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Coordinates in the locker's 32-pixel player rig, measured from the feet.
export const lockerAnchors = {
  body: [0, 18, 0], head: [0, 32, 0], back: [0, 19, -3],
  shoulders: [0, 23, 0], feet: [0, 3, 0],
} as const;

export function lockerPreviewZoom(canvas: HTMLCanvasElement, camera: PerspectiveCamera, controls: OrbitControls, focus: Vector3) {
  const home = controls.target.clone();
  let fullDistance = camera.position.distanceTo(home);
  let scale = 1;
  function apply() {
    const offset = camera.position.clone().sub(controls.target).setLength(fullDistance * scale);
    controls.target.lerpVectors(home, focus, (1 - scale) / 0.72);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }
  function wheel(event: WheelEvent) {
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    scale = Math.min(1, Math.max(0.28, scale * Math.exp(Math.max(-400, Math.min(400, pixels)) * 0.0016)));
    apply();
  }
  canvas.addEventListener("wheel", wheel, { passive: false });
  return {
    resize(distance: number) { fullDistance = distance; apply(); },
    dispose() { canvas.removeEventListener("wheel", wheel); },
  };
}
