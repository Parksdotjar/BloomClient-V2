import { useEffect, useRef, useState } from "react";
import {
  AmbientLight, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, DirectionalLight, DoubleSide,
  Group, Matrix4, Mesh, MeshStandardMaterial, NearestFilter, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SkinObject } from "skinview3d";
import { inferModelType, loadSkinToCanvas } from "skinview-utils";
import { invoke } from "../services/invoke";
import type { Wardrobe } from "./MinecraftWardrobe";
import { readWingRuntime, wingThumbnail, type Tint, type WingColors, type WingRevision } from "../services/delight-wings";

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

function visibleTint(color: string) {
  const hex = color.slice(1).match(/../g) ?? ["ff", "ff", "ff"];
  return "#" + hex.map(value => Math.max(16, parseInt(value, 16)).toString(16).padStart(2, "0")).join("");
}

export function WingPreview({ item, colors, motion, accountId, cosmeticOnly = false, skinTexture, variant, front = false }: {
  item: WingRevision; colors: WingColors; motion: boolean; accountId?: string; cosmeticOnly?: boolean; front?: boolean; skinTexture?: string; variant?: "classic" | "slim";
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ colors, motion });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [avatar, setAvatar] = useState<{ texture: string; variant?: "classic" | "slim" }>();
  const [skinReady, setSkinReady] = useState(false);
  const skinTarget = useRef<{ mesh: SkinObject; surface: HTMLCanvasElement; texture: CanvasTexture; fallback: Group } | undefined>(undefined);
  state.current = { colors, motion };

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
      const texture = await invoke<string>("get_minecraft_skin", { accountId }).catch(() => "");
      if (active && texture) setAvatar({ texture });
    }
    void lookup();
    return () => { active = false; };
  }, [accountId, skinTexture, variant, cosmeticOnly]);

  useEffect(() => {
    if (!canvas.current) return;
    const target = canvas.current;
    let renderer: WebGLRenderer;
    setStatus("loading");
    try { renderer = new WebGLRenderer({ canvas: target, alpha: true, antialias: true, powerPreference: "low-power" }); }
    catch { setStatus("error"); return; }
    const stop = new AbortController();
    const scene = new Scene(), camera = new PerspectiveCamera(35, 1, 1, 180);
    camera.position.set(-7, 25, front ? 55 : -55);
    const key = new DirectionalLight("#fff8f0", 1.6);
    key.position.set(-10, 30, -15);
    scene.add(key, new AmbientLight("#dce5fa", 1.55));
    const rig = new MeshStandardMaterial({ color: "#798697", roughness: .9 });
    const dispose: {dispose(): void}[] = [rig];
    const fallback = new Group();
    fallback.visible = !cosmeticOnly;
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
    const controls = new OrbitControls(camera, target);
    controls.enabled = !cosmeticOnly;
    controls.enablePan = controls.enableZoom = false;
    controls.rotateSpeed = .65;
    controls.minPolarAngle = .55;
    controls.maxPolarAngle = 1.91;
    controls.target.set(0, cosmeticOnly ? 25 : 18, 0);
    const wear = new Group();
    wear.position.set(0, 19, -2);
    scene.add(wear);
    let cardSize: Vector3 | undefined;
    function fit() {
      const width = target.clientWidth, height = target.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const distance = Math.max(55, 23 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect) + 5);
      if (cosmeticOnly) {
        const tangent = Math.tan(camera.fov * Math.PI / 360);
        const cardDistance = cardSize ? Math.max(cardSize.y / 2, cardSize.x / (2 * camera.aspect)) / tangent * 1.12 + cardSize.z / 2 : distance;
        camera.position.copy(controls.target).add(new Vector3(0, 0, -cardDistance));
      } else camera.position.sub(controls.target).setLength(distance).add(controls.target);
      camera.updateProjectionMatrix();
      controls.update();
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    const resize = new ResizeObserver(fit);
    resize.observe(target);
    fit();
    let handle = 0;
    void readWingRuntime(item, stop.signal).then(async ({ model, files }) => {
      const textures = new Map<string, CanvasTexture>();
      for (const path of new Set(model.batches.map(batch => batch.texture))) {
        const image = await createImageBitmap(new Blob([new Uint8Array(files[path])], { type: "image/png" }));
        if (stop.signal.aborted) { image.close(); return; }
        const surface = document.createElement("canvas");
        surface.width = image.width;
        surface.height = image.height;
        surface.getContext("2d")!.drawImage(image, 0, 0);
        image.close();
        const texture = new CanvasTexture(surface);
        texture.colorSpace = SRGBColorSpace;
        texture.magFilter = texture.minFilter = NearestFilter;
        texture.generateMipmaps = false;
        textures.set(path, texture);
        dispose.push(texture);
      }
      const materials = new Map<string, { finish: MeshStandardMaterial; tint: Tint | "fixed" }>();
      const bodies = model.batches.map(batch => {
        const key = [batch.texture, batch.tint, batch.color].join(":");
        if (!materials.has(key)) {
          const finish = new MeshStandardMaterial({ map: textures.get(batch.texture), color: batch.color,
            alphaTest: .5, side: DoubleSide, roughness: 1 });
          materials.set(key, { finish, tint: batch.tint });
          dispose.push(finish);
        }
        const geometry = wingGeometry(batch.vertices);
        const mesh = new Mesh(geometry, materials.get(key)!.finish);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        wear.add(mesh);
        dispose.push(geometry);
        return { mesh, joint: batch.matrix };
      });
      const matrices = model.frames[0].matrices.map(() => new Matrix4());
      if (cosmeticOnly) {
        for (const { mesh, joint } of bodies) mesh.matrix.fromArray(model.frames[0].matrices[joint]);
        wear.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(wear);
        controls.target.copy(bounds.getCenter(new Vector3()));
        cardSize = bounds.getSize(new Vector3());
        fit();
      }
      setStatus("ready");
      const started = performance.now();
      function draw(now: number) {
        const { colors, motion } = state.current;
        const time = motion ? (now - started) % model.duration : Math.min(825, model.duration);
        const upper = Math.max(1, model.frames.findIndex(frame => frame.time >= time));
        const a = model.frames[upper - 1], b = model.frames[upper];
        const ratio = (time - a.time) / (b.time - a.time);
        matrices.forEach((matrix, joint) => {
          matrix.fromArray(a.matrices[joint].map((value, axis) => value + ratio * (b.matrices[joint][axis] - value)));
        });
        for (const { finish, tint } of materials.values()) if (tint !== "fixed") finish.color.set(visibleTint(colors[tint]));
        for (const { mesh, joint } of bodies) {
          mesh.matrix.copy(matrices[joint]);
          mesh.matrixWorldNeedsUpdate = true;
        }
        renderer.render(scene, camera);
        handle = requestAnimationFrame(draw);
      }
      handle = requestAnimationFrame(draw);
    }).catch(() => { if (!stop.signal.aborted) setStatus("error"); });
    return () => {
      stop.abort(); resize.disconnect(); cancelAnimationFrame(handle);
      skinTarget.current = undefined;
      controls.dispose();
      dispose.forEach(resource => resource.dispose());
      renderer.dispose();
    };
  }, [item.id, item.revision, cosmeticOnly, front]);

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
  }, [avatar, item.revision, cosmeticOnly]);

  return <div className={cosmeticOnly ? "wing-preview wing-card-preview" : "locker-preview wing-preview"}>
    <canvas ref={canvas} aria-label="Live wing preview" data-ready={status === "ready"} data-skin={skinReady}
      title={cosmeticOnly ? undefined : "Drag to rotate the player"}/>
    {!cosmeticOnly && status !== "ready" && <img alt={item.name} src={wingThumbnail(item)}/>}
    {!cosmeticOnly && status === "error" && <small role="status">Live preview unavailable</small>}
  </div>;
}
