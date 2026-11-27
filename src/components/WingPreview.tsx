import { playerSkin } from "../services/player-skin";
import { useEffect, useRef, useState } from "react";
import {
  AmbientLight, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, DirectionalLight, DoubleSide,
  Group, LinearSRGBColorSpace, NoColorSpace, Matrix4, Mesh, MeshStandardMaterial, NearestFilter, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CapeObject, SkinObject } from "skinview3d";
import { inferModelType, loadCapeToCanvas, loadSkinToCanvas } from "skinview-utils";
import { invoke } from "../services/invoke";
import type { CapeAnimation } from "./CapePreview";
import type { Wardrobe } from "./MinecraftWardrobe";
import { readWingRuntime, type Tint, type WingColors, type WingRevision } from "../services/delight-wings";

import { registerLockerCard } from "./locker-card-renderer";
import { lockerAnchors, lockerPreviewZoom } from "./locker-preview-zoom";
import { cosmeticDaylightMaterial } from "../services/cosmetic-daylight";
import { cosmeticShade } from "../services/cosmetic-shading";

const mannequin = [
  [[8, 8, 8], [0, 28, 0]], [[8, 12, 4], [0, 18, 0]],
  [[4, 12, 4], [6, 18, 0]], [[4, 12, 4], [-6, 18, 0]],
  [[4, 12, 4], [2, 6, 0]], [[4, 12, 4], [-2, 6, 0]],
] as const;

function wingGeometry(data: number[]) {
  const points: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i < data.length; i += 8) {
    points.push(data[i], data[i + 1], data[i + 2]);
    normals.push(data[i + 3], data[i + 4], data[i + 5]);
    uv.push(data[i + 6], 1 - data[i + 7]);
    if (i % 32 === 0) {
      const start = i / 8;
      indices.push(start, start + 1, start + 3, start + 1, start + 2, start + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute("position", new BufferAttribute(Float32Array.from(points), 3));
  geometry.setAttribute("normal", new BufferAttribute(Float32Array.from(normals), 3));
  geometry.setAttribute("uv", new BufferAttribute(Float32Array.from(uv), 2));
  return geometry;
}

export function WingPreview({ item, colors, motion, accountId, cosmeticOnly = false, skinTexture, variant, front = false, additional, capeTexture, capeAnimation }: {
  additional?: { item: WingRevision; colors: WingColors };
  capeTexture?: string;
  capeAnimation?: CapeAnimation | null;
  item: WingRevision; colors: WingColors; motion: boolean; accountId?: string; cosmeticOnly?: boolean; front?: boolean; skinTexture?: string; variant?: "classic" | "slim";
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ colors, motion, additional, revision: item.revision });
  const swap = useRef<((item: WingRevision, extra?: WingRevision) => () => void) | undefined>(undefined);
  const hat = item.slot === "hat";
  const hasHat = hat || additional?.item.slot === "hat";
  const additionalItem = additional?.item;
  const faceFront = front || hat;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [avatar, setAvatar] = useState<{ texture: string; variant?: "classic" | "slim" }>();
  const [skinReady, setSkinReady] = useState(false);
  const skinTarget = useRef<{ mesh: SkinObject; surface: HTMLCanvasElement; texture: CanvasTexture; fallback: Group } | undefined>(undefined);
  state.current = { colors, motion, additional, revision: item.revision };

  useEffect(() => {
    let active = true;
    setAvatar(undefined);
    if (cosmeticOnly) return;
    if (skinTexture) {
      setAvatar({ texture: skinTexture, variant });
      return;
    }
    if (!accountId) return;
    async function lookup() {
      const wardrobe = await invoke<Wardrobe>("get_minecraft_wardrobe", { accountId, refresh: false }).catch(() => null);
      if (!active) return;
      if (wardrobe?.currentSkin?.texture) {
        setAvatar({ texture: wardrobe.currentSkin.texture, variant: wardrobe.currentSkin.variant });
        return;
      }
      const texture = await playerSkin(accountId!).catch(() => "");
      if (active && texture) setAvatar({ texture });
    }
    void lookup();
    return () => { active = false; };
  }, [accountId, skinTexture, variant, cosmeticOnly]);

  useEffect(() => {
    if (!canvas.current) return;
    const target = canvas.current;
    const ratio = Math.min(2, window.devicePixelRatio);
    let renderer: WebGLRenderer | undefined;
    let unregister: (() => void) | undefined;
    let dirty = true;
    let animated = false;
    let lastColors: WingColors | undefined;
    let lastMotion: boolean | undefined;
    setStatus("loading");
    try {
      if (cosmeticOnly) {
        unregister = registerLockerCard(target, draw, () => {
          const { colors, motion } = state.current;
          return dirty || colors !== lastColors || motion !== lastMotion || (motion && animated);
        });
      } else {
        renderer = new WebGLRenderer({ canvas: target, alpha: true, antialias: true, powerPreference: "low-power" });
        renderer.setPixelRatio(ratio);
      }
    }
    catch { setStatus("error"); return; }
    const stop = new AbortController();
    const scene = new Scene(), camera = new PerspectiveCamera(35, 1, 1, 180);
    camera.position.set(-7, hasHat ? 29 : 25, faceFront ? 55 : -55);
    const key = new DirectionalLight("#fff8f0", 1.6);
    key.position.set(-10, 30, hat ? 15 : -15);
    scene.add(key, new AmbientLight("#dce5fa", 1.55));
    const dispose: {dispose(): void}[] = [];
    if (!cosmeticOnly) {
      const rig = new MeshStandardMaterial({ color: "#798697", roughness: .9 });
      dispose.push(rig);
      const fallback = new Group();
      scene.add(fallback);
      for (const [size, point] of mannequin) {
        const geometry = new BoxGeometry(...size);
        dispose.push(geometry);
        const mesh = new Mesh(geometry, rig);
        mesh.position.set(point[0], point[1], point[2]);
        fallback.add(mesh);
      }
      const skin = new SkinObject();
      skin.position.y = 24;
      skin.visible = false;
      scene.add(skin);
      const skinCanvas = document.createElement("canvas");
      const skinMap = new CanvasTexture(skinCanvas);
      skinMap.magFilter = skinMap.minFilter = NearestFilter;
      skinMap.generateMipmaps = false;
      skinMap.colorSpace = SRGBColorSpace;
      skin.map = skinMap;
      skinTarget.current = { mesh: skin, surface: skinCanvas, texture: skinMap, fallback };
      const skinResources = new Set<{dispose(): void}>();
      skin.traverse(part => {
        if (part instanceof Mesh) {
          skinResources.add(part.geometry);
          (Array.isArray(part.material) ? part.material : [part.material]).forEach(material => skinResources.add(material));
        }
      });
      dispose.push(skinMap, ...skinResources);
    }
    let drawCape: ((now: number) => void) | undefined;
    if (capeTexture && !cosmeticOnly) {
      const cape = new CapeObject();
      cape.position.set(0, 32, -2);
      cape.rotation.x = Math.PI * .06;
      cape.visible = false;
      scene.add(cape);
      const surface = document.createElement("canvas");
      const map = new CanvasTexture(surface);
      map.colorSpace = SRGBColorSpace;
      map.minFilter = map.magFilter = NearestFilter;
      map.generateMipmaps = false;
      cape.map = map;
      dispose.push(map, cape.cape.geometry, cape.cape.material as MeshStandardMaterial);
      const paint = (source: HTMLImageElement | HTMLCanvasElement) => {
        loadCapeToCanvas(surface, source);
        map.needsUpdate = true;
        cape.visible = true;
      };
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = capeTexture;
      void image.decode().then(() => { if (!stop.signal.aborted) paint(image); }).catch(() => {});
      if (capeAnimation) {
        const atlas = new Image();
        atlas.crossOrigin = "anonymous";
        atlas.src = capeAnimation.atlasUrl;
        void atlas.decode().then(() => {
          if (stop.signal.aborted) return;
          const frame = document.createElement("canvas");
          const { frameWidth, frameHeight, frameCount, columns, fps, loop } = capeAnimation;
          frame.width = frameWidth;
          frame.height = frameHeight;
          const context = frame.getContext("2d")!;
          const started = performance.now();
          let previous = -1;
          drawCape = now => {
            if (!state.current.motion) return;
            const elapsed = Math.floor((now - started) / 1000 * fps);
            const index = loop ? elapsed % frameCount : Math.min(elapsed, frameCount - 1);
            if (index === previous) return;
            previous = index;
            context.clearRect(0, 0, frameWidth, frameHeight);
            context.drawImage(atlas, index % columns * frameWidth, Math.floor(index / columns) * frameHeight,
              frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
            paint(frame);
          };
        }).catch(() => {});
      }
    }
    const controls = new OrbitControls(camera, target);
    controls.enabled = !cosmeticOnly;
    controls.enablePan = controls.enableZoom = false;
    controls.rotateSpeed = .65;
    controls.minPolarAngle = .55;
    controls.maxPolarAngle = 1.91;
    controls.target.set(0, cosmeticOnly ? 25 : hasHat ? 20 : 18, 0);
    const zoom = cosmeticOnly ? undefined : lockerPreviewZoom(target, camera, controls,
      new Vector3(...lockerAnchors[front ? "body" : hat ? "head" : "back"]));
    let cardSize: Vector3 | undefined;
    function fit() {
      const width = target.clientWidth, height = target.clientHeight;
      if (!width || !height) return;
      if (renderer) renderer.setSize(width, height, false);
      else {
        target.width = Math.floor(width * ratio);
        target.height = Math.floor(height * ratio);
        dirty = true;
      }
      camera.aspect = width / height;
      const distance = Math.max(hasHat ? 70 : 55, 23 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect) + 5);
      if (cosmeticOnly) {
        const tangent = Math.tan(camera.fov * Math.PI / 360);
        const cardDistance = cardSize ? Math.max(cardSize.y / 2, cardSize.x / (2 * camera.aspect)) / tangent * 1.12 + cardSize.z / 2 : distance;
        camera.position.copy(controls.target).add(new Vector3(0, 0, hat ? cardDistance : -cardDistance));
      } else zoom?.resize(distance);
      camera.updateProjectionMatrix();
      controls.update();
    }
    const resize = new ResizeObserver(fit);
    resize.observe(target);
    fit();
    let handle = 0;
    async function loadCosmetic(revision: WingRevision, secondary: boolean, group: Group, signal: AbortSignal, resources: {dispose(): void}[]) {
      const { model, files } = await readWingRuntime(revision, signal);
      if (signal.aborted) throw new Error("Preview canceled");
      const wear = new Group();
      if (model.slot === "hat") wear.position.set(0, 31.375, 0);
      else wear.position.set(0, 19, -2);
      group.add(wear);
      const textures = new Map<string, CanvasTexture>();
      for (const path of new Set(model.batches.map(batch => batch.texture))) {
        const image = await createImageBitmap(new Blob([new Uint8Array(files[path])], { type: "image/png" }));
        if (signal.aborted) { image.close(); throw new Error("Preview canceled"); }
        const surface = document.createElement("canvas");
        surface.width = image.width;
        surface.height = image.height;
        surface.getContext("2d")!.drawImage(image, 0, 0);
        image.close();
        const texture = new CanvasTexture(surface);
        texture.colorSpace = NoColorSpace;
        texture.magFilter = texture.minFilter = NearestFilter;
        texture.generateMipmaps = false;
        textures.set(path, texture);
        resources.push(texture);
      }
      const materials = new Map<string, { finish: ReturnType<typeof cosmeticDaylightMaterial>; tint: Tint | "fixed"; shade?: string; shineRow?: number }>();
      const bodies = model.batches.map(batch => {
        const key = [batch.texture, batch.tint, batch.color, batch.shineRow].join(":");
        if (!materials.has(key)) {
          const finish = cosmeticDaylightMaterial(textures.get(batch.texture)!, batch.color);
          materials.set(key, { finish, tint: batch.tint, shade: batch.color, shineRow: batch.shineRow });
          resources.push(finish);
        }
        const geometry = wingGeometry(batch.vertices);
        const mesh = new Mesh(geometry, materials.get(key)!.finish);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        wear.add(mesh);
        resources.push(geometry);
        return { mesh, joint: batch.matrix };
      });
      const matrices = model.frames[0].matrices.map(() => new Matrix4());
      if (cosmeticOnly) {
        animated = model.batches.some(batch => batch.shineRow !== undefined) ||
          model.frames.some(frame => frame.matrices.some((matrix, joint) =>
            matrix.some((value, axis) => value !== model.frames[0].matrices[joint][axis])));
        for (const { mesh, joint } of bodies) mesh.matrix.fromArray(model.frames[0].matrices[joint]);
        wear.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(wear);
        controls.target.copy(bounds.getCenter(new Vector3()));
        cardSize = bounds.getSize(new Vector3());
        fit();
      }
      return (elapsed: number) => {
        const { colors, motion, additional } = state.current;
        const palette = secondary ? additional?.colors : colors;
        if (!palette) return;
        const time = motion ? elapsed % model.duration : Math.min(825, model.duration);
        const upper = Math.max(1, model.frames.findIndex(frame => frame.time >= time));
        const a = model.frames[upper - 1], b = model.frames[upper];
        const ratio = (time - a.time) / (b.time - a.time);
        matrices.forEach((matrix, joint) => {
          matrix.fromArray(a.matrices[joint].map((value, axis) => value + ratio * (b.matrices[joint][axis] - value)));
        });
        for (const { finish, tint, shade, shineRow } of materials.values()) {
          if (tint === "fixed") continue;
          const color = palette[tint] ?? "#ffffff";
          if (shade) {
            const center = Math.floor((elapsed % 5000) / 45) - 2;
            const distance = motion && shineRow !== undefined ? Math.abs(shineRow - center) : 3;
            const shine = [0.23, 0.14, 0.07][distance] ?? 0;
            const rgb = (hex: string) => Number.parseInt(hex.slice(1), 16);
            const chosen = rgb(color), base = rgb(revision.defaults[tint]!), original = rgb(shade);
            finish.uniforms.tint.value.setHex(cosmeticShade(chosen, base, original, shine), LinearSRGBColorSpace);
          } else finish.uniforms.tint.value.setHex(parseInt(color.slice(1), 16), LinearSRGBColorSpace);
        }
        for (const { mesh, joint } of bodies) {
          mesh.matrix.copy(matrices[joint]);
          mesh.matrixWorldNeedsUpdate = true;
        }
      };
    }
    let active: { group: Group; update: ((elapsed: number) => void)[]; release: () => void; revision: string } | undefined;
    swap.current = (primary, extra) => {
      const request = new AbortController();
      const group = new Group();
      const resources: {dispose(): void}[] = [];
      const release = () => { group.removeFromParent(); resources.splice(0).forEach(resource => resource.dispose()); };
      const models = [loadCosmetic(primary, false, group, request.signal, resources)];
      if (extra) models.push(loadCosmetic(extra, true, group, request.signal, resources));
      void Promise.all(models).then(update => {
        if (request.signal.aborted) { release(); return; }
        active?.release();
        scene.add(group);
        active = { group, update, release, revision: primary.revision };
        dirty = true;
        setStatus("ready");
      }).catch(() => {
        const canceled = request.signal.aborted;
        request.abort();
        release();
        if (!canceled) setStatus("error");
      });
      return () => request.abort();
    };
    const started = performance.now();
    function draw(output: WebGLRenderer, now: number) {
      lastColors = state.current.colors;
      lastMotion = state.current.motion;
      dirty = false;
      if (active?.revision === state.current.revision) active.update.forEach(pose => pose(now - started));
      drawCape?.(now);
      output.render(scene, camera);
    }
    if (renderer) {
      const detailRenderer = renderer;
      const frame = (now: number) => {
        draw(detailRenderer, now);
        handle = requestAnimationFrame(frame);
      };
      handle = requestAnimationFrame(frame);
    }
    return () => {
      swap.current = undefined;
      active?.release();
      zoom?.dispose();
      stop.abort(); resize.disconnect(); cancelAnimationFrame(handle);
      skinTarget.current = undefined;
      controls.dispose();
      dispose.forEach(resource => resource.dispose());
      unregister?.();
      renderer?.dispose();
    };
  }, [cosmeticOnly, front, faceFront, hat, hasHat, capeTexture, capeAnimation]);

  useEffect(() => swap.current?.(item, additionalItem), [item.revision, additionalItem?.revision, cosmeticOnly, front, faceFront, hat, hasHat, capeTexture, capeAnimation]);

  useEffect(() => {
    const rig = skinTarget.current;
    if (!rig) return;
    let active = true;
    rig.mesh.visible = false;
    rig.fallback.visible = !cosmeticOnly;
    setSkinReady(false);
    if (avatar && !cosmeticOnly) {
      const image = new Image();
      if (!avatar.texture.startsWith("data:")) image.crossOrigin = "anonymous";
      image.src = avatar.texture;
      void image.decode().then(() => {
        if (!active) return;
        loadSkinToCanvas(rig.surface, image);
        rig.mesh.modelType = avatar.variant === "slim" ? "slim" : avatar.variant === "classic" ? "default" : inferModelType(rig.surface);
        rig.texture.needsUpdate = true;
        rig.mesh.visible = true;
        rig.fallback.visible = false;
        setSkinReady(true);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [avatar, cosmeticOnly, front, faceFront, hat, hasHat, capeTexture, capeAnimation]);

  return <div className={cosmeticOnly ? "wing-preview wing-card-preview" : "locker-preview wing-preview"}>
    <canvas ref={canvas} aria-label={hat ? "Live hat preview" : item.slot === "back" ? "Live back cosmetic preview" : "Live wing preview"} data-ready={status === "ready"} data-skin={skinReady}
      title={cosmeticOnly ? undefined : "Drag to rotate, scroll to zoom"}/>
    {!cosmeticOnly && status === "error" && <small role="status">Live preview unavailable</small>}
  </div>;
}
