/**
 * Pixi scenes for experiment 008.
 *
 * Every scene exposes the same shape:
 *   { render(t), info }            // t in seconds, ABSOLUTE, pure function
 *
 * There is no Application and therefore no ticker. `autoDetectRenderer` gives a
 * renderer whose only entry point is `renderer.render(stage)`, which we call
 * from a GSAP `onUpdate`. Nothing samples a wall clock.
 */
import {
  autoDetectRenderer,
  BitmapText,
  BlurFilter,
  Color,
  Container,
  Graphics,
  Particle,
  ParticleContainer,
  Text,
  TextStyle,
  Texture,
  Ticker,
} from "pixi.js";

/* ------------------------------------------------------------------ utils */

/** mulberry32 — deterministic, no Math.random anywhere in a scene. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Smooth ramp from a to b — a pure function of t, no easing object state. */
const ramp = (t, a, b) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

/** Counters that prove nothing renders unless we ask it to. */
export const stats = { renders: 0, raf: 0, lastRenderMs: 0 };

/** Wrap rAF so we can prove Pixi never schedules one. */
export function instrumentRaf() {
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    stats.raf += 1;
    return orig(cb);
  };
}

async function makeRenderer(canvas, w, h, bg, opts = {}) {
  const renderer = await autoDetectRenderer({
    preference: "webgl",
    canvas,
    width: w,
    height: h,
    background: bg,
    antialias: true,
    resolution: opts.resolution ?? 1,
    autoDensity: false,
    clearBeforeRender: true,
    // Determinism: never let Pixi pick a different power class between runs.
    powerPreference: "high-performance",
    preferWebGLVersion: 2,
  });
  return renderer;
}

/** Hard-stop the shared ticker even though we never started one. */
export function killTickers() {
  Ticker.shared.autoStart = false;
  Ticker.shared.stop();
  if (Ticker.system) {
    Ticker.system.autoStart = false;
    Ticker.system.stop();
  }
  return {
    sharedStarted: Ticker.shared.started,
    systemStarted: Ticker.system ? Ticker.system.started : null,
  };
}

/* ------------------------------------------------------------- scene: seek */

/**
 * A scene whose every pixel is a function of t and nothing else. If a wall
 * clock leaked in anywhere, two renders would disagree.
 */
export async function seekScene(canvas, W = 1920, H = 1080) {
  const renderer = await makeRenderer(canvas, W, H, "#0b0d10");
  const stage = new Container();

  // A ring of bars whose height is a phase-shifted function of t.
  const bars = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    const g = new Graphics();
    stage.addChild(g);
    bars.push(g);
  }

  // A blurred halo — proves a filter survives a seek-driven capture.
  const halo = new Graphics().circle(0, 0, 220).fill({ color: 0x3d8bfd, alpha: 0.55 });
  halo.filters = [new BlurFilter({ strength: 24, quality: 4 })];
  halo.x = W / 2;
  halo.y = H / 2;
  stage.addChild(halo);

  const marker = new Graphics();
  stage.addChild(marker);

  function render(t) {
    const p = t / 6; // scene is 6s long
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const amp = 120 + 90 * Math.sin(p * Math.PI * 2 * 2 + i * 0.31);
      const r0 = 280;
      const g = bars[i];
      g.clear();
      g.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0);
      g.lineTo(W / 2 + Math.cos(a) * (r0 + amp), H / 2 + Math.sin(a) * (r0 + amp));
      g.stroke({ width: 10, color: new Color({ h: (i / N) * 360, s: 60, v: 95 }).toNumber() });
    }
    halo.scale.set(0.6 + 0.5 * Math.sin(p * Math.PI * 2));
    // A horizontal marker whose x is strictly t — a visual clock.
    marker.clear().rect(0, H - 24, (t / 6) * W, 24).fill(0xf2b134);

    const t0 = performance.now();
    renderer.render(stage);
    stats.lastRenderMs = performance.now() - t0;
    stats.renders += 1;
  }

  return { render, renderer, stage, info: { archetype: "seek", bars: N } };
}

/* ------------------------------------------------------------- scene: text */

/** The three sample lines every band renders, identically. */
export const TEXT_ROWS = [
  { y: 12, size: 88, weight: 700, s: "생성형 슬라이드" },
  { y: 124, size: 56, weight: 700, s: "카메라는 시간의 순수 함수" },
  { y: 204, size: 40, weight: 400, s: "Seeking, not playing — 40px 0123456789" },
];

/**
 * One band of Pixi text, laid out to the same grid as the DOM and SVG bands.
 * `mode` picks Pixi's canvas-raster path (`Text`) or its glyph-atlas path
 * (`BitmapText`).
 */
export async function textScene(canvas, W, H, opts = {}) {
  const resolution = opts.resolution ?? 1;
  const mode = opts.mode ?? "text";
  const renderer = await makeRenderer(canvas, W, H, "#0b0d10", { resolution });
  const stage = new Container();

  const mk = (size, weight) =>
    new TextStyle({
      fontFamily: ["Noto Sans KR", "Inter", "system-ui", "sans-serif"],
      fontSize: size,
      fontWeight: String(weight),
      fill: 0xe8eaed,
      letterSpacing: 0,
    });

  const made = [];
  for (const r of TEXT_ROWS) {
    const style = mk(r.size, r.weight);
    const tx =
      mode === "bitmap"
        ? new BitmapText({ text: r.s, style })
        : new Text({ text: r.s, style, resolution });
    tx.x = 40;
    tx.y = r.y;
    stage.addChild(tx);
    made.push(tx);
  }

  function render() {
    renderer.render(stage);
    stats.renders += 1;
  }
  return {
    render,
    renderer,
    stage,
    info: {
      archetype: "text",
      mode,
      resolution,
      widths: made.map((t) => Math.round(t.width)),
    },
  };
}

/* -------------------------------------------------- scene: 60k data swarm */

/**
 * The thing SVG genuinely cannot do: one GPU-resident sprite per data point,
 * 60,000 of them, morphing between three real layouts of the same dataset —
 * raw sample cloud -> histogram of a measured quantity -> grouped by label.
 *
 * Every particle's home position in every layout is precomputed once from a
 * seeded RNG, so `render(t)` is a pure interpolation.
 */
export function swarmData(W, H, count) {
  const r = rng(20260727);
  const PAL = [0x3d8bfd, 0x2ec4a6, 0xf2b134, 0xe5566d, 0x9b8bfd];

  // layout 0: raw cloud (gaussian-ish)
  // layout 1: histogram of the sampled quantity
  // layout 2: grouped by label into five columns
  const ax = new Float32Array(count);
  const ay = new Float32Array(count);
  const bx = new Float32Array(count);
  const by = new Float32Array(count);
  const cx = new Float32Array(count);
  const cy = new Float32Array(count);
  const tint = new Uint32Array(count);
  const phase = new Float32Array(count);

  const gauss = () => (r() + r() + r() + r() + r() + r() - 3) / 3; // ~N(0,1), bounded

  const BINS = 96;
  const binCount = new Int32Array(BINS);
  const value = new Float32Array(count);
  const label = new Uint8Array(count);

  for (let i = 0; i < count; i++) {
    value[i] = clamp01(0.5 + gauss() * 0.22);
    phase[i] = r();
    ax[i] = W / 2 + gauss() * 520;
    ay[i] = H / 2 + gauss() * 300;
  }
  // Colour by quintile of the measured value, not by a fixed cut — a gaussian
  // sample would otherwise leave three of the five bins empty.
  const sorted = Float32Array.from(value).sort();
  const q = [1, 2, 3, 4].map((k) => sorted[Math.floor((k * count) / 5)]);
  for (let i = 0; i < count; i++) {
    let g = 0;
    while (g < 4 && value[i] >= q[g]) g++;
    label[i] = g;
    tint[i] = PAL[g];
  }

  // histogram
  const binW = (W - 240) / BINS;
  for (let i = 0; i < count; i++) {
    const b = Math.min(BINS - 1, Math.floor(value[i] * BINS));
    const k = binCount[b]++;
    const col = 26; // dots across a bin
    bx[i] = 120 + b * binW + (k % col) * (binW / col);
    by[i] = H - 90 - Math.floor(k / col) * 3.6;
  }

  // grouped columns
  const groupN = [0, 0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const g = label[i];
    const k = groupN[g]++;
    const col = 46;
    cx[i] = 200 + g * 340 + (k % col) * 5.4;
    cy[i] = H - 120 - Math.floor(k / col) * 5.4;
  }

  return { ax, ay, bx, by, cx, cy, tint, phase, count };
}

/**
 * Interpolate every point to time `t`. Shared by the Pixi and SVG backends so
 * the comparison measures the renderer, not the arithmetic.
 */
export function swarmStep(d, t, put) {
  const k1 = ramp(t, 1.6, 4.0);
  const k2 = ramp(t, 4.6, 7.0);
  for (let i = 0; i < d.count; i++) {
    const s = d.phase[i] * 0.9;
    const a1 = clamp01((k1 * 1.9 - s) / 1.0);
    const a2 = clamp01((k2 * 1.9 - s) / 1.0);
    const e1 = a1 * a1 * (3 - 2 * a1);
    const e2 = a2 * a2 * (3 - 2 * a2);
    const x1 = d.ax[i] + (d.bx[i] - d.ax[i]) * e1;
    const y1 = d.ay[i] + (d.by[i] - d.ay[i]) * e1;
    put(i, x1 + (d.cx[i] - x1) * e2, y1 + (d.cy[i] - y1) * e2, e1);
  }
}

export async function swarmScene(canvas, W, H, count = 60000) {
  const renderer = await makeRenderer(canvas, W, H, "#0b0d10");
  const stage = new Container();

  // A 6px round dot, drawn once into a texture and shared by every particle.
  const dot = new Graphics().circle(4, 4, 3.4).fill(0xffffff);
  const tex = renderer.generateTexture({ target: dot, resolution: 2 });

  const d = swarmData(W, H, count);
  const { ax, ay, tint } = d;

  const pc = new ParticleContainer({
    dynamicProperties: { position: true, color: true, scale: true, rotation: false, uvs: false },
  });
  const parts = new Array(count);
  for (let i = 0; i < count; i++) {
    const p = new Particle({ texture: tex, x: ax[i], y: ay[i], tint: tint[i], alpha: 0.85 });
    p.anchorX = 0.5;
    p.anchorY = 0.5;
    parts[i] = p;
    pc.addParticle(p);
  }
  stage.addChild(pc);

  function render(t) {
    swarmStep(d, t, (i, x, y, e1) => {
      const p = parts[i];
      p.x = x;
      p.y = y;
      p.scaleX = p.scaleY = 0.5 + 0.5 * (1 - Math.abs(e1 - 0.5) * 2) * 0.6;
    });
    pc.update();
    const t0 = performance.now();
    renderer.render(stage);
    stats.lastRenderMs = performance.now() - t0;
    stats.renders += 1;
  }

  return { render, renderer, stage, info: { archetype: "swarm", count } };
}

/** The same 60,000 points as SVG <circle> elements — the honest control. */
export function swarmSvg(host, W, H, count = 60000) {
  const d = swarmData(W, H, count);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  const nodes = new Array(count);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("r", "3.4");
    c.setAttribute("cx", d.ax[i]);
    c.setAttribute("cy", d.ay[i]);
    c.setAttribute("fill", `#${d.tint[i].toString(16).padStart(6, "0")}`);
    c.setAttribute("opacity", "0.85");
    frag.appendChild(c);
    nodes[i] = c;
  }
  svg.appendChild(frag);
  host.appendChild(svg);

  function render(t) {
    const t0 = performance.now();
    swarmStep(d, t, (i, x, y) => {
      const c = nodes[i];
      c.setAttribute("cx", x);
      c.setAttribute("cy", y);
    });
    stats.lastRenderMs = performance.now() - t0;
    stats.renders += 1;
  }
  return { render, info: { archetype: "swarm-svg", count } };
}

export { Ticker };
