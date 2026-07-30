/**
 * The whole vanilla-three.js side of the spike.
 *
 * Contract with DeckSmith's shell: a scene's `setup` calls `DS3D.mount(sid, spec)`
 * once, which builds an imperative three.js scene into `#<sid> canvas.ds3d` and
 * registers a handle at `window.__3d[sid]`. The scene's `tl` statements then tween
 * `__3d[sid].s` — a plain object of numbers — on the same paused GSAP timeline
 * every other archetype uses.
 *
 * Nothing here reads a clock. `render()` is a pure function of `s`, so seeking the
 * timeline to t twice paints the same pixels twice.
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { gauss, rng } from "./rng.mjs";

const PALETTE = ["#7dd3fc", "#fca5a5", "#fcd34d", "#a7f3d0"];

/**
 * Turn a plain object of numbers into one whose every assignment repaints.
 *
 * This is the load-bearing trick. GSAP's `seek(t, suppressEvents)` may swallow
 * `onUpdate` — HyperFrames' runtime calls it both ways in different code paths —
 * but it can never swallow the property assignment itself, because that IS the
 * tween. Driving the render from the setter makes the 3D frame a function of the
 * timeline position and of nothing else.
 */
function reactive(initial, onChange) {
  const raw = { ...initial };
  const obj = {};
  for (const k of Object.keys(raw)) {
    Object.defineProperty(obj, k, {
      enumerable: true,
      configurable: true,
      get: () => raw[k],
      set: (v) => {
        if (raw[k] === v) return;
        raw[k] = v;
        onChange();
      },
    });
  }
  return obj;
}

function makeRenderer(canvas, w, h) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1); // never devicePixelRatio: that is machine state, not input
  renderer.setSize(w, h, false);
  return renderer;
}

function lights(scene) {
  scene.add(new AmbientLight(0xffffff, 1.1));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 6, 5);
  scene.add(key);
  const fill = new DirectionalLight(0x88aaff, 0.9);
  fill.position.set(-5, 2, -3);
  scene.add(fill);
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/** Project a world point to CSS pixels, so a DOM label can be pinned to it. */
function project(v, camera, w, h) {
  const p = v.clone().project(camera);
  return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
}

function labels(root) {
  return Array.from(root.querySelectorAll("[data-anchor]"));
}

function placeLabels(root, camera, anchors, w, h, visible) {
  for (const el of labels(root)) {
    const i = Number(el.dataset.anchor);
    const a = anchors[i];
    if (!a) continue;
    const p = project(a, camera, w, h);
    el.style.transform = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)`;
    el.style.opacity = String(visible ? visible(i) : 1);
  }
}

/* ---------------------------------------------------------------- cloud --- */

/**
 * 12,000 embeddings falling out of noise into three labelled clusters.
 * The shape a "what an embedding space is" slide actually wants.
 */
function cloud(root, canvas, spec) {
  const { width: w, height: h } = spec;
  const N = spec.count ?? 12000;
  const next = rng(spec.seed);
  const renderer = makeRenderer(canvas, w, h);
  const scene = new Scene();
  const camera = new PerspectiveCamera(38, w / h, 0.1, 100);

  const centres = [
    new Vector3(-1.7, 0.35, 0.2),
    new Vector3(1.5, -0.5, -0.6),
    new Vector3(0.1, 1.35, 0.9),
  ];
  const from = new Float32Array(N * 3);
  const to = new Float32Array(N * 3);
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const tone = centres.map((_, i) => new Color(PALETTE[i]));

  for (let i = 0; i < N; i++) {
    const k = i % 3;
    const c = centres[k];
    // scattered start: a wide shell, so the assembly reads as "order from noise"
    const r = 5.5 + next() * 2.5;
    const th = next() * Math.PI * 2;
    const ph = Math.acos(2 * next() - 1);
    from[i * 3] = r * Math.sin(ph) * Math.cos(th);
    from[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.55;
    from[i * 3 + 2] = r * Math.cos(ph);
    to[i * 3] = c.x + gauss(next) * 0.42;
    to[i * 3 + 1] = c.y + gauss(next) * 0.42;
    to[i * 3 + 2] = c.z + gauss(next) * 0.42;
    const t = tone[k];
    col[i * 3] = t.r;
    col[i * 3 + 1] = t.g;
    col[i * 3 + 2] = t.b;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setAttribute("color", new BufferAttribute(col, 3));
  const points = new Points(
    geo,
    new PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.95 }),
  );
  scene.add(points);
  lights(scene);

  const anchors = centres;
  const s = reactive({ assemble: 0, orbit: 0, tag: 0 }, () => render());

  function render() {
    const a = smooth(Math.min(1, Math.max(0, s.assemble)));
    for (let i = 0; i < N * 3; i++) {
      // per-point stagger: index-derived, not random, so it is stable
      const d = ((i / 3) % 97) / 97;
      const t = Math.min(1, Math.max(0, (a - d * 0.35) / 0.65));
      pos[i] = lerp(from[i], to[i], smooth(t));
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();

    const ang = lerp(-0.55, 0.5, s.orbit);
    const rad = lerp(9.5, 6.4, a);
    camera.position.set(Math.sin(ang) * rad, lerp(2.6, 1.5, s.orbit), Math.cos(ang) * rad);
    camera.lookAt(0, 0.15, 0);
    camera.updateMatrixWorld();

    placeLabels(root, camera, anchors, w, h, () => Math.min(1, Math.max(0, s.tag)));
    renderer.render(scene, camera);
  }
  return { s, render, renderer };
}

/* --------------------------------------------------------------- layers --- */

/** Five slabs of a pipeline, exploding apart while the camera swings to 3/4. */
function layers(root, canvas, spec) {
  const { width: w, height: h } = spec;
  const renderer = makeRenderer(canvas, w, h);
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, w / h, 0.1, 100);
  lights(scene);

  const names = spec.layers;
  const group = new Group();
  const slabs = names.map((_, i) => {
    const g = new Group();
    const box = new Mesh(
      new BoxGeometry(4.2, 0.34, 2.6),
      new MeshStandardMaterial({
        color: new Color(PALETTE[i % PALETTE.length]),
        roughness: 0.45,
        metalness: 0.12,
        transparent: true,
      }),
    );
    const edge = new LineSegments(
      new EdgesGeometry(box.geometry),
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
    );
    g.add(box, edge);
    group.add(g);
    return { g, box, edge };
  });
  scene.add(group);

  const anchors = names.map(() => new Vector3());
  const s = reactive({ explode: 0, cam: 0, reveal: 0 }, () => render());

  function render() {
    const e = smooth(Math.min(1, Math.max(0, s.explode)));
    slabs.forEach(({ g, box, edge }, i) => {
      const k = i - (names.length - 1) / 2;
      g.position.set(0, k * lerp(0.36, 1.15, e), 0);
      g.rotation.z = 0;
      const enter = Math.min(1, Math.max(0, s.reveal - i));
      const o = smooth(enter);
      box.material.opacity = o * 0.96;
      edge.material.opacity = o * 0.5;
      g.position.x = lerp(-3.2, 0, o);
      anchors[i].set(2.35, g.position.y + 0.1, 0).add(new Vector3(g.position.x, 0, 0));
    });
    group.rotation.y = lerp(0.0, -0.62, smooth(s.cam));
    const ang = lerp(0, 0.42, smooth(s.cam));
    camera.position.set(Math.sin(ang) * 11.5, lerp(0.6, 4.6, smooth(s.cam)), Math.cos(ang) * 11.5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    group.updateMatrixWorld(true);
    const world = anchors.map((a) => a.clone().applyMatrix4(group.matrixWorld));
    // Labels wait for the slabs to separate; five pinned captions on a closed
    // stack is five captions in the same 80 pixels.
    placeLabels(root, camera, world, w, h, (i) =>
      Math.min(1, Math.max(0, s.reveal - i)) * smooth(Math.min(1, Math.max(0, (e - 0.1) / 0.35))),
    );
    renderer.render(scene, camera);
  }
  return { s, render, renderer };
}

/* -------------------------------------------------------------- surface --- */

/** A loss landscape with a marker walking a fixed gradient-descent path. */
function surface(root, canvas, spec) {
  const { width: w, height: h } = spec;
  const renderer = makeRenderer(canvas, w, h);
  const scene = new Scene();
  const camera = new PerspectiveCamera(36, w / h, 0.1, 100);
  lights(scene);

  const f = (x, y) => 0.95 * Math.sin(x * 1.15) * Math.cos(y * 1.15) + 0.16 * (x * x + y * y) - 0.6;
  const SEG = 72;
  const SPAN = 7;
  const geo = new PlaneGeometry(SPAN, SPAN, SEG, SEG);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const lo = new Color("#1e3a8a");
  const hi = new Color("#fcd34d");
  let min = 1e9;
  let max = -1e9;
  const zs = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const z = f(p.getX(i), p.getY(i));
    zs[i] = z;
    min = Math.min(min, z);
    max = Math.max(max, z);
  }
  for (let i = 0; i < p.count; i++) {
    const c = lo.clone().lerp(hi, (zs[i] - min) / (max - min));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  const mesh = new Mesh(
    geo,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, flatShading: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);

  // EdgesGeometry on a plane yields only its outline — every interior edge is
  // coplanar, so it is filtered out. A wireframe MeshBasicMaterial over a coarse
  // copy of the same grid is what actually draws the contour lines.
  const coarse = new PlaneGeometry(SPAN, SPAN, 20, 20);
  const cp = coarse.attributes.position;
  const cz = new Float32Array(cp.count);
  for (let i = 0; i < cp.count; i++) cz[i] = f(cp.getX(i), cp.getY(i));
  const wire = new Mesh(
    coarse,
    new MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.16 }),
  );
  wire.rotation.x = -Math.PI / 2;
  scene.add(wire);

  const ball = new Mesh(
    new SphereGeometry(0.22, 28, 18),
    new MeshStandardMaterial({ color: 0xfff1f1, emissive: new Color("#f43f5e"), emissiveIntensity: 1.4 }),
  );
  scene.add(ball);

  // Gradient descent from a fixed start: the path is precomputed, so the marker
  // is at exactly the same place at t=0.7 in every render.
  const path = [];
  let px = -2.9;
  let py = 2.5;
  for (let i = 0; i < 220; i++) {
    const eps = 1e-3;
    const gx = (f(px + eps, py) - f(px - eps, py)) / (2 * eps);
    const gy = (f(px, py + eps) - f(px, py - eps)) / (2 * eps);
    // 0.02, not 0.06: at the larger rate 98% of the arc is walked in the first
    // quarter of the steps and the marker sits still for three seconds.
    px -= gx * 0.02;
    py -= gy * 0.02;
    path.push(new Vector3(px, f(px, py), py));
  }
  // A GL line is one pixel wide on every platform — `linewidth` is silently
  // ignored. Line2/LineGeometry/LineMaterial (examples/jsm/lines) draw the line as
  // camera-facing quads instead; this is precisely what drei's <Line> wraps.
  const trailMat = new LineMaterial({
    color: 0xff5470,
    linewidth: 7,
    transparent: true,
    opacity: 0.95,
    resolution: new Vector2(w, h),
  });
  const trail = new Line2(new LineGeometry(), trailMat);
  trail.frustumCulled = false;
  // Allocate the WHOLE path now and reveal it with instanceCount, rather than
  // calling setPositions() with a longer array each frame. Growing the buffer is
  // the obvious way to write this and it is silently wrong under seeking:
  // WebGLBindingStates freezes `geometry._maxInstanceCount` on the geometry's
  // FIRST render and WebGLRenderer clamps every later draw to it, so the trail
  // ends up capped at whatever length it had on whichever frame the capture
  // happened to paint first. The pixels then depend on seek history, not on
  // seek target — invariant 1, violated by a buffer resize.
  const flat = new Float32Array(path.length * 3);
  scene.add(trail);

  const anchors = [new Vector3(-2.9, f(-2.9, 2.5) + 0.5, 3.7), new Vector3()];
  const s = reactive({ grow: 0, walk: 0, cam: 0, tag: 0 }, () => render());

  function render() {
    const g = smooth(Math.min(1, Math.max(0, s.grow)));
    for (let i = 0; i < p.count; i++) p.setZ(i, zs[i] * g);
    p.needsUpdate = true;
    geo.computeVertexNormals();
    for (let i = 0; i < cp.count; i++) cp.setZ(i, cz[i] * g);
    cp.needsUpdate = true;
    wire.position.y = 0.03;

    const n = Math.max(1, Math.round(smooth(Math.min(1, Math.max(0, s.walk))) * (path.length - 1)));
    for (let i = 0; i <= n; i++) {
      flat[i * 3] = path[i].x;
      flat[i * 3 + 1] = path[i].y * g + 0.08;
      flat[i * 3 + 2] = path[i].z;
    }
    trail.geometry.setPositions(flat.subarray(0, (n + 1) * 3));
    trail.visible = s.walk > 0.02;
    const cur = path[n];
    ball.position.set(cur.x, cur.y * g + 0.18, cur.z);
    ball.visible = s.walk > 0;
    anchors[1].copy(ball.position).add(new Vector3(0, 0.45, 0));
    anchors[0].y = f(-2.9, 2.5) * g + 0.5;

    const ang = lerp(0.35, 0.95, smooth(s.cam));
    camera.position.set(Math.sin(ang) * 9.2, lerp(6.2, 3.4, smooth(s.cam)), Math.cos(ang) * 9.2);
    camera.lookAt(0, -0.2, 0);
    camera.updateMatrixWorld();
    // The start pin hands off to the moving one: two labels alive at once would
    // collide over the headline, which `hyperframes check` calls content_overlap.
    const walk = Math.min(1, Math.max(0, s.walk));
    placeLabels(root, camera, anchors, w, h, (i) =>
      i === 0
        ? Math.min(1, Math.max(0, s.tag)) * (1 - Math.min(1, Math.max(0, (walk - 0.08) / 0.22)))
        : Math.min(1, Math.max(0, (walk - 0.05) / 0.15)),
    );
    renderer.render(scene, camera);
  }
  /** Diagnostic only: lets the measurement harness compare derived state, not just pixels. */
  const probe = () => ({
    n: Math.max(1, Math.round(smooth(Math.min(1, Math.max(0, s.walk))) * (path.length - 1))),
    ball: [ball.position.x, ball.position.y, ball.position.z].map((v) => v.toFixed(6)),
    trailSegments: trail.geometry.attributes.instanceStart?.count ?? -1,
    instanceCount: trail.geometry.instanceCount,
    camera: [camera.position.x, camera.position.y, camera.position.z].map((v) => v.toFixed(6)),
  });
  return { s, render, renderer, probe };
}

const KINDS = { cloud, layers, surface };

/**
 * One entry point, called from a scene's `setup`. Returns the handle the
 * timeline tweens. The first render happens here so a deck parked at t=0 —
 * which is what `snapshot` and the first captured frame both do — is painted.
 */
export function mount(sid, spec) {
  const root = document.getElementById(sid);
  const canvas = root.querySelector("canvas.ds3d");
  const handle = KINDS[spec.kind](root, canvas, spec);
  handle.render();
  window.__3d = window.__3d || {};
  window.__3d[sid] = handle;
  return handle;
}
