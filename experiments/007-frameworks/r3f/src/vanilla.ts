/**
 * The control. Same scene, same fonts, same seek contract — no React, no drei,
 * no Theatre. Animation comes from a PAUSED GSAP TIMELINE, which is what
 * DeckSmith already emits, tweening a plain state object that this file reads
 * on each seek.
 *
 * It exists so the r3f verdict is a comparison rather than an impression: what
 * exactly do React + drei + Theatre buy, in bytes and in lines, over the
 * primitives DeckSmith already has?
 *
 * GSAP is loaded from the composition's <head>, exactly as today, so it is not
 * in this bundle — the same treatment three.js does NOT get.
 */
import * as THREE from "three";
import { preloadFont, Text } from "troika-three-text";

declare const gsap: {
  timeline(o: { paused: boolean }): GsapTl;
};
interface GsapTl {
  fromTo(t: unknown, a: unknown, b: unknown, pos?: number): GsapTl;
  duration(): number;
  pause(): void;
  play(): void;
  totalTime(t?: number, s?: boolean): number;
  seek(t: number, s?: boolean): unknown;
}

const ACCENT = "#4dd4c8";
const FG = "#f2f4f8";
const DIM = "#7b8496";
const DURATION = 12;

const STAGES = [
  { label: "Patch Embed", sub: "196 × 768", z: 0, color: "#3d5a80", n: 7, side: 1 },
  { label: "Multi-Head Attn", sub: "12 heads", z: -5, color: "#4dd4c8", n: 7, side: -1 },
  { label: "MLP", sub: "768 → 3072 → 768", z: -10, color: "#3d5a80", n: 7, side: 1 },
  { label: "× 12 blocks", sub: "residual + LN", z: -15, color: "#3d5a80", n: 7, side: -1 },
  { label: "Class Head", sub: "1000-way", z: -20, color: "#f0a35e", n: 3, side: 1 },
];

// The animated state. GSAP tweens these numbers; nothing else moves.
const S = {
  camX: 2.5,
  camY: 3.6,
  camZ: 19,
  lookX: 0,
  lookZ: -7,
  reveal: [0, 0, 0, 0, 0],
  highlight: 0,
  caption: 0,
};

const host = document.getElementById("s1-gl") as HTMLElement;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(1920, 1080, false);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0a0c11");
scene.fog = new THREE.Fog("#0a0c11", 18, 62);
const camera = new THREE.PerspectiveCamera(38, 1920 / 1080, 0.1, 200);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(6, 12, 8);
scene.add(key);
const rim = new THREE.DirectionalLight(new THREE.Color(ACCENT).getHex(), 0.6);
rim.position.set(-8, 2, -12);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 80),
  new THREE.MeshStandardMaterial({ color: "#0d1017", roughness: 1, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -3.4, -10);
scene.add(floor);

const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** drei's <Instances>/<Instance> in vanilla: one InstancedMesh, setMatrixAt. */
interface StageRig {
  group: THREE.Group;
  mesh: THREE.InstancedMesh;
  cells: { x: number; y: number; d: number }[];
  slab: THREE.Mesh;
  ring?: THREE.Mesh;
}
const rigs: StageRig[] = [];
const dummy = new THREE.Object3D();
const texts: Text[] = [];

for (const spec of STAGES) {
  const group = new THREE.Group();
  group.position.set(0, 0.6, spec.z);
  const half = (spec.n * 0.62) / 2 + 0.5;

  const cells: { x: number; y: number; d: number }[] = [];
  for (let r = 0; r < spec.n; r++) {
    for (let c = 0; c < spec.n; c++) {
      cells.push({
        x: (c - (spec.n - 1) / 2) * 0.62,
        y: (r - (spec.n - 1) / 2) * 0.62,
        d: Math.hypot(c - (spec.n - 1) / 2, r - (spec.n - 1) / 2) / 5,
      });
    }
  }
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.44, 0.44, 0.16),
    new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.45, metalness: 0.15 }),
    cells.length,
  );
  group.add(mesh);

  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2),
    new THREE.MeshBasicMaterial({ color: FG, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
  );
  group.add(slab);

  let ring: THREE.Mesh | undefined;
  if (spec.label.startsWith("Multi")) {
    ring = new THREE.Mesh(
      new THREE.RingGeometry(half * 0.98, half * 1.04, 64),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    );
    ring.position.z = 0.02;
    group.add(ring);
  }

  // drei's <Text> in vanilla: the same troika class, constructed directly.
  for (const [str, size, col, dy, fnt] of [
    [spec.label, 0.52, spec.label.startsWith("Multi") ? ACCENT : FG, 0.35, "./assets/label.ttf"],
    [spec.sub, 0.32, DIM, -0.25, "./assets/body.ttf"],
  ] as const) {
    const t = new Text();
    t.text = str;
    t.font = fnt;
    t.fontSize = size;
    t.color = col;
    t.anchorX = spec.side > 0 ? "left" : "right";
    t.anchorY = "middle";
    t.position.set(spec.side * (half + 0.55), dy, 0);
    t.renderOrder = 10;
    t.material.depthTest = false;
    group.add(t);
    texts.push(t);
  }

  // drei's <Line> in vanilla, for lineWidth 1: THREE.Line.
  const leader = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(spec.side * half * 0.75, 0.05, 0),
      new THREE.Vector3(spec.side * (half + 0.4), 0.05, 0),
    ]),
    new THREE.LineBasicMaterial({ color: spec.label.startsWith("Multi") ? ACCENT : DIM, transparent: true, opacity: 0.55 }),
  );
  group.add(leader);

  scene.add(group);
  rigs.push({ group, mesh, cells, slab, ring });
}

// drei's <Billboard> in vanilla: copy the camera's quaternion. One line.
const caption = new THREE.Group();
caption.position.set(-1.0, -3.6, -6);
for (const [str, size, col, dy, fnt, w] of [
  ["Attention is all-to-all", 0.5, ACCENT, 0, "./assets/label.ttf", 0],
  [
    "every patch token attends to every other, so the receptive field is the whole image at layer one.",
    0.32,
    FG,
    -0.46,
    "./assets/body.ttf",
    9,
  ],
] as const) {
  const t = new Text();
  t.text = str;
  t.font = fnt;
  t.fontSize = size;
  t.color = col;
  t.anchorX = "center";
  t.anchorY = dy === 0 ? "middle" : "top";
  t.textAlign = "center";
  if (w) t.maxWidth = w;
  t.position.y = dy;
  t.renderOrder = 20;
  t.material.depthTest = false;
  caption.add(t);
  texts.push(t);
}
scene.add(caption);

const target = new THREE.Vector3();

/** Apply state -> scene graph, then draw. The whole "useFrame" layer. */
function apply(): void {
  camera.position.set(S.camX, S.camY, S.camZ);
  target.set(S.lookX, 0.6, S.lookZ);
  camera.lookAt(target);
  camera.updateMatrixWorld();

  caption.visible = S.caption > 0.001;
  caption.quaternion.copy(camera.quaternion);
  for (const t of caption.children as Text[]) t.material.opacity = S.caption;

  rigs.forEach((rig, i) => {
    const p = ease(S.reveal[i]);
    rig.group.visible = p > 0.001;
    if (!rig.group.visible) return;
    (rig.slab.material as THREE.MeshBasicMaterial).opacity = 0.16 * p;
    rig.slab.scale.set(0.6 + 0.4 * p, 0.6 + 0.4 * p, 1);
    if (rig.ring) {
      rig.ring.visible = S.highlight > 0.001;
      (rig.ring.material as THREE.MeshBasicMaterial).opacity = S.highlight * 0.9;
      rig.ring.scale.setScalar(0.9 + S.highlight * 0.12);
    }
    rig.cells.forEach((cell, k) => {
      const q = ease((p - cell.d * 0.35) / (1 - cell.d * 0.35 || 1));
      dummy.position.set(cell.x, cell.y, (1 - q) * 2.4);
      dummy.scale.setScalar(0.001 + q * 0.999);
      dummy.updateMatrix();
      rig.mesh.setMatrixAt(k, dummy.matrix);
    });
    rig.mesh.instanceMatrix.needsUpdate = true;
  });

  renderer.render(scene, camera);
}

/**
 * The animation, as a paused GSAP timeline over a plain object. This is the
 * direct answer to "what does Theatre.js give us that GSAP does not": the
 * keyframes below are the same keyframes, expressed in a third of the bytes,
 * with no project state JSON, no studio, and no second animation runtime.
 */
const tl = gsap.timeline({ paused: true });
tl.fromTo(S, { camX: 2.5, camY: 3.6, camZ: 19, lookX: 0, lookZ: -7 },
  { camX: 11, camY: 5.6, camZ: 12.5, lookX: 0, lookZ: -9, duration: 3.4, ease: "power2.inOut" }, 0)
  .fromTo(S, { camX: 11, camY: 5.6, camZ: 12.5, lookX: 0, lookZ: -9 },
    { camX: 14.5, camY: 4.0, camZ: 5.5, lookX: -0.4, lookZ: -7.5, duration: 3.6, ease: "power1.inOut" }, 3.4)
  .fromTo(S, { camX: 14.5, camY: 4.0, camZ: 5.5, lookX: -0.4, lookZ: -7.5 },
    { camX: 10.5, camY: 3.2, camZ: 9, lookX: 0, lookZ: -9, duration: 4, ease: "power1.inOut" }, 7);

STAGES.forEach((_, i) => {
  tl.fromTo(S.reveal, { [i]: 0 }, { [i]: 1, duration: 1.2, ease: "power2.out" }, 0.2 + i * 1.4);
});
tl.fromTo(S, { highlight: 0 }, { highlight: 1, duration: 1, ease: "power2.out" }, 6.6)
  .fromTo(S, { highlight: 1 }, { highlight: 0, duration: 1, ease: "power2.in" }, 10.2)
  .fromTo(S, { caption: 0 }, { caption: 1, duration: 1, ease: "power2.out" }, 7.4);

// Pad to the full duration so duration() matches the composition.
tl.fromTo({ _: 0 }, { _: 0 }, { _: 1, duration: 0.01 }, DURATION - 0.01);

const adapter = {
  duration: () => DURATION,
  pause() {},
  play() {},
  timeScale: () => 1,
  totalTime(t?: number) {
    if (typeof t !== "number") return tl.totalTime();
    tl.totalTime(t, true);
    apply();
    return t;
  },
  seek(t: number) {
    return this.totalTime(t);
  },
};

declare global {
  interface Window {
    __timelines: Record<string, unknown>;
    __hfTimelinesBuilding: boolean;
  }
}
window.__timelines = window.__timelines || {};
window.__hfTimelinesBuilding = true;

Promise.all([
  ...["./assets/label.ttf", "./assets/body.ttf"].map(
    (font) => new Promise<void>((res) => preloadFont({ font }, () => res())),
  ),
  ...texts.map((t) => new Promise<void>((res) => t.sync(() => res()))),
]).then(() => {
  adapter.totalTime(DURATION * 0.75);
  adapter.totalTime(0);
  renderer.getContext().finish();
  window.__timelines.s1 = adapter;
  window.__hfTimelinesBuilding = false;
  window.dispatchEvent(new Event("hf-timelines-built"));
});
