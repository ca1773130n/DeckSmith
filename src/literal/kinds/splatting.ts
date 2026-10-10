/**
 * splatting — 3D points become anisotropic Gaussians, and the Gaussians are
 * rendered by EWA splatting along a camera path, for real, in TypeScript.
 *
 * WHAT IS EXACT. Each Gaussian's covariance is Σ = R S Sᵀ Rᵀ (given scales and
 * a rotation quaternion), or — from bare points — the covariance of the point
 * and its k nearest neighbours, regularised. Projection is the EWA local
 * affine approximation 3D Gaussian Splatting renders with (Zwicker et al.
 * 2002; Kerbl et al. 2023): Σ' = J W Σ Wᵀ Jᵀ + 0.3 I, J the Jacobian of the
 * pinhole projection at the mean. Splats are sorted by depth and composited
 * front to back: α = min(0.99, o · exp(−½ dᵀ Σ'⁻¹ d)), skipped under 1/255,
 * C += c α T, T ← T (1 − α), stopped when T < 1e-4. The scene is the source's
 * when it gives one; the colours and opacities drawn are the inputs'.
 *
 * Frames at the first pose: the points, the splats (2σ ellipses), the render;
 * then the render at every further pose. Beside them, the camera path seen
 * from above with the camera's position and heading.
 */
import {
  type DataRgb,
  type Frame,
  fillTemplate,
  fitBox,
  flat,
  type LiteralSlot,
  type MechanismResult,
  type Prim,
  type Raster,
  type Region,
  type Rgb,
  type Rgba,
  TYPE,
} from "./common.js";

/* -------------------------------------------------------------------- maths */

export type Vec3 = [number, number, number];
/** A symmetric 3×3 matrix as [xx, xy, xz, yy, yz, zz]. */
export type Sym3 = [number, number, number, number, number, number];

export interface Gaussian {
  mean: Vec3;
  cov: Sym3;
  color: DataRgb;
  opacity: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  if (l === 0) throw new Error("splatting: zero-length vector");
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Σ = R S Sᵀ Rᵀ from scales and a unit quaternion (w, x, y, z). */
export function covFromScaleRotation(
  scale: Vec3,
  q: [number, number, number, number] = [1, 0, 0, 0],
): Sym3 {
  const l = Math.hypot(...q);
  const [w, x, y, z] = q.map((v) => v / l) as [number, number, number, number];
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const M = (i: number, j: number) => {
    let s = 0;
    for (let k = 0; k < 3; k++)
      s += (R[i]?.[k] as number) * (R[j]?.[k] as number) * (scale[k] as number) ** 2;
    return s;
  };
  return [M(0, 0), M(0, 1), M(0, 2), M(1, 1), M(1, 2), M(2, 2)];
}

/** Covariance of each point with its k nearest neighbours, plus `reg`·I, so every splat is anisotropic and finite. */
export function covFromNeighbours(points: readonly Vec3[], k: number, reg: number): Sym3[] {
  return points.map((p) => {
    const near = points
      .map((q, j) => [dot(sub(q, p), sub(q, p)), j] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, k + 1)
      .map(([, j]) => points[j] as Vec3);
    const mu: Vec3 = [0, 0, 0];
    for (const q of near)
      for (let c = 0; c < 3; c++) mu[c] = (mu[c] as number) + (q[c] as number) / near.length;
    const C: Sym3 = [reg, 0, 0, reg, 0, reg];
    for (const q of near) {
      const d = sub(q, mu);
      C[0] += (d[0] * d[0]) / near.length;
      C[1] += (d[0] * d[1]) / near.length;
      C[2] += (d[0] * d[2]) / near.length;
      C[3] += (d[1] * d[1]) / near.length;
      C[4] += (d[1] * d[2]) / near.length;
      C[5] += (d[2] * d[2]) / near.length;
    }
    return C;
  });
}

export interface Camera {
  eye: Vec3;
  /** Rows: right, down, forward (camera x right, y down, z into the scene). */
  W: [Vec3, Vec3, Vec3];
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/** A pinhole camera at `eye` looking at `target`, world +y up, `fov` the vertical field of view in degrees. */
export function lookAt(eye: Vec3, target: Vec3, w: number, h: number, fov: number): Camera {
  const f = norm(sub(target, eye));
  const r = norm(cross(f, [0, 1, 0]));
  const d = cross(f, r);
  const fy = h / 2 / Math.tan((fov * Math.PI) / 360);
  return { eye, W: [r, d, f], fx: fy, fy, cx: w / 2, cy: h / 2 };
}

export interface Splat2D {
  u: number;
  v: number;
  depth: number;
  /** Σ' as [a, b, c] = [[a, b], [b, c]]. */
  cov: [number, number, number];
  /** Inverse of Σ' (the conic). */
  conic: [number, number, number];
  radius: number;
  color: DataRgb;
  opacity: number;
}

/** EWA projection of one Gaussian: Σ' = J W Σ Wᵀ Jᵀ + `lowpass`·I. Undefined behind the near plane. */
export function project(g: Gaussian, cam: Camera, lowpass = 0.3, near = 0.05): Splat2D | undefined {
  const pw = sub(g.mean, cam.eye);
  const t: Vec3 = [dot(cam.W[0], pw), dot(cam.W[1], pw), dot(cam.W[2], pw)];
  if (t[2] <= near) return undefined;
  const [x, y, z] = t;
  const J = [
    [cam.fx / z, 0, (-cam.fx * x) / (z * z)],
    [0, cam.fy / z, (-cam.fy * y) / (z * z)],
  ];
  const S = [
    [g.cov[0], g.cov[1], g.cov[2]],
    [g.cov[1], g.cov[3], g.cov[4]],
    [g.cov[2], g.cov[4], g.cov[5]],
  ];
  // T = J W (2×3), Σ' = T Σ Tᵀ.
  const T = [0, 1].map((i) =>
    [0, 1, 2].map((j) => {
      let s = 0;
      for (let k = 0; k < 3; k++) s += (J[i]?.[k] as number) * (cam.W[k]?.[j] as number);
      return s;
    }),
  );
  const TS = [0, 1].map((i) =>
    [0, 1, 2].map((j) => {
      let s = 0;
      for (let k = 0; k < 3; k++) s += (T[i]?.[k] as number) * (S[k]?.[j] as number);
      return s;
    }),
  );
  const m = (i: number, j: number) => {
    let s = 0;
    for (let k = 0; k < 3; k++) s += (TS[i]?.[k] as number) * (T[j]?.[k] as number);
    return s;
  };
  const a = m(0, 0) + lowpass;
  const b = m(0, 1);
  const c = m(1, 1) + lowpass;
  const det = a * c - b * b;
  if (!(det > 0)) return undefined;
  const mid = (a + c) / 2;
  const lmax = mid + Math.sqrt(Math.max(0.1, mid * mid - det));
  return {
    u: cam.fx * (x / z) + cam.cx,
    v: cam.fy * (y / z) + cam.cy,
    depth: z,
    cov: [a, b, c],
    conic: [c / det, -b / det, a / det],
    radius: Math.ceil(3 * Math.sqrt(lmax)),
    color: g.color,
    opacity: g.opacity,
  };
}

/** Front-to-back alpha compositing of depth-sorted splats over `bg`; also returns the final transmittance. */
export function rasterize(
  splats: readonly Splat2D[],
  w: number,
  h: number,
  bg: DataRgb,
): { img: Rgb; T: Float32Array } {
  const order = [...splats].sort((p, q) => p.depth - q.depth);
  const C = new Float32Array(w * h * 3);
  const T = new Float32Array(w * h).fill(1);
  for (const s of order) {
    const x0 = Math.max(0, Math.floor(s.u - s.radius));
    const x1 = Math.min(w - 1, Math.ceil(s.u + s.radius));
    const y0 = Math.max(0, Math.floor(s.v - s.radius));
    const y1 = Math.min(h - 1, Math.ceil(s.v + s.radius));
    const [A, B, Cc] = s.conic;
    // Only the row span where α can reach 1/255: A dx² + 2B dy dx + C dy² ≤ −2 ln(1/(255 o)).
    // Exact (the α test below still decides each pixel), so it changes no byte, only the cost.
    const lim = -2 * Math.log(1 / (255 * s.opacity));
    if (!(lim > 0)) continue;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - s.v;
      const disc = B * B * dy * dy - A * (Cc * dy * dy - lim);
      if (disc < 0) continue;
      const r = Math.sqrt(disc) / A;
      const c = s.u - 0.5 - (B * dy) / A;
      const xa = Math.max(x0, Math.floor(c - r) - 1);
      const xb = Math.min(x1, Math.ceil(c + r) + 1);
      for (let x = xa; x <= xb; x++) {
        const i = y * w + x;
        const Ti = T[i] as number;
        if (Ti < 1e-4) continue;
        const dx = x + 0.5 - s.u;
        const power = -0.5 * (A * dx * dx + 2 * B * dx * dy + Cc * dy * dy);
        if (power > 0) continue;
        const alpha = Math.min(0.99, s.opacity * Math.exp(power));
        if (alpha < 1 / 255) continue;
        const k = alpha * Ti;
        C[i * 3] = (C[i * 3] as number) + s.color[0] * k;
        C[i * 3 + 1] = (C[i * 3 + 1] as number) + s.color[1] * k;
        C[i * 3 + 2] = (C[i * 3 + 2] as number) + s.color[2] * k;
        T[i] = Ti * (1 - alpha);
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const Ti = T[i] as number;
    C[i * 3] = (C[i * 3] as number) + bg[0] * Ti;
    C[i * 3 + 1] = (C[i * 3 + 1] as number) + bg[1] * Ti;
    C[i * 3 + 2] = (C[i * 3 + 2] as number) + bg[2] * Ti;
  }
  return { img: { w, h, d: C }, T };
}

/** A render over black (premultiplied colour, transmittance T) as straight-alpha RGBA, α = 1 − T. */
export function straightAlpha(r: { img: Rgb; T: Float32Array }): Rgba {
  const n = r.img.w * r.img.h;
  const d = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = 1 - (r.T[i] as number);
    for (let c = 0; c < 3; c++)
      d[i * 4 + c] = a > 1e-6 ? Math.min(1, (r.img.d[i * 3 + c] as number) / a) : 0;
    d[i * 4 + 3] = a;
  }
  return { w: r.img.w, h: r.img.h, d };
}

/* ------------------------------------------------------------------- input */

export interface SplatInput {
  /** The source's Gaussians … */
  gaussians?: Array<{
    mean: Vec3;
    scale: Vec3;
    rotation?: [number, number, number, number];
    color: DataRgb;
    opacity: number;
  }>;
  /** … or its points, made Gaussians by their neighbours' covariance. */
  points?: Array<{ p: Vec3; color: DataRgb }>;
  /** Neighbours per point (default 8), regulariser (default 1e-4), opacity (default 0.8). */
  neighbours?: number;
  regularise?: number;
  opacity?: number;
  /** An orbit about the scene's centroid (default: 6 poses over 90°, radius 1.9× the scene's extent). */
  orbit?: { poses?: number; arc?: number; radius?: number; height?: number };
  fov?: number;
  /** Render width (default 512; the cost is linear in its square); the height keeps the region's aspect. */
  renderWidth?: number;
  /** Composite onto this colour instead of keeping alpha (default: keep alpha; the deck's ground shows). */
  background?: DataRgb;
}

export const SLOTS: Readonly<Record<string, LiteralSlot>> = {
  points: { what: "stage 1: the input points", vars: ["n"] },
  splats: { what: "stage 2: each point as an anisotropic Gaussian, drawn at 2σ", vars: ["n"] },
  render: {
    what: "stage 3: the Gaussians sorted by depth and alpha-composited",
    vars: ["pose", "poses"],
  },
  path: { what: "the inset: the camera path seen from above" },
};

export const TAKEAWAY =
  "Each of the {n} points becomes an oriented Gaussian; projected, sorted by depth and alpha-blended, they render the scene from any camera on the path.";

/* ---------------------------------------------------------------- the kind */

export function splatting(input: SplatInput, region: Region): MechanismResult {
  let gs: Gaussian[];
  if (input.gaussians?.length)
    gs = input.gaussians.map((g) => ({
      mean: g.mean,
      cov: covFromScaleRotation(g.scale, g.rotation),
      color: g.color,
      opacity: g.opacity,
    }));
  else if (input.points && input.points.length >= 4) {
    const pts = input.points.map((p) => p.p);
    const covs = covFromNeighbours(pts, input.neighbours ?? 8, input.regularise ?? 1e-4);
    gs = input.points.map((p, i) => ({
      mean: p.p,
      cov: covs[i] as Sym3,
      color: p.color,
      opacity: input.opacity ?? 0.8,
    }));
  } else throw new Error("splatting: needs gaussians, or at least four points");
  if (gs.length > 5000)
    throw new Error(`splatting: ${gs.length} Gaussians is over the 5000 the cost bound allows`);

  const n = gs.length;
  const centroid: Vec3 = [0, 0, 0];
  for (const g of gs)
    for (let c = 0; c < 3; c++) centroid[c] = (centroid[c] as number) + (g.mean[c] as number) / n;
  let extent = 0;
  for (const g of gs) extent = Math.max(extent, Math.hypot(...sub(g.mean, centroid)));
  const poses = input.orbit?.poses ?? 6;
  const arc = ((input.orbit?.arc ?? 90) * Math.PI) / 180;
  const radius = input.orbit?.radius ?? 1.9 * extent;
  const height = input.orbit?.height ?? 0.6 * extent;
  const { width: W, height: H } = region;
  const size = TYPE.label;
  const mainBox = { x: 0, y: size + 24, w: W * 0.7, h: H - (size + 24) };
  const rw = input.renderWidth ?? 512;
  const rh = Math.round((rw * mainBox.h) / mainBox.w);
  const fov = input.fov ?? 50;
  // No background baked in unless the source asks: the render keeps its alpha, so the
  // deck's own ground (dark or light) shows through where no splat covers.
  const bg = input.background;
  const eyes: Vec3[] = Array.from({ length: poses }, (_, i) => {
    const a = poses === 1 ? 0 : -arc / 2 + (arc * i) / (poses - 1);
    return [
      centroid[0] + radius * Math.sin(a),
      centroid[1] + height,
      centroid[2] + radius * Math.cos(a),
    ];
  });
  const cams = eyes.map((e) => lookAt(e, centroid, rw, rh, fov));
  const rasters: Record<string, Raster> = {};
  const projected = cams.map((cam, i) => {
    const sp = gs.map((g) => project(g, cam)).filter((s): s is Splat2D => s !== undefined);
    rasters[`render-${i}`] = bg
      ? { rgb: rasterize(sp, rw, rh, bg).img }
      : { rgba: straightAlpha(rasterize(sp, rw, rh, [0, 0, 0])) };
    return sp;
  });

  const panel = fitBox(rw, rh, mainBox.x, mainBox.y, mainBox.w, mainBox.h);
  const k = panel.w / rw;
  // The inset: the scene and the path from above (x right, z down the page).
  const inset = {
    x: W * 0.7 + 50,
    y: size + 24,
    w: W * 0.3 - 50,
    h: H - (size + 24) - (size + 20),
  };
  const span = Math.max(radius * 1.1, extent);
  const sc = Math.min(inset.w, inset.h) / (2 * span);
  const IX = (p: Vec3) => inset.x + inset.w / 2 + (p[0] - centroid[0]) * sc;
  const IY = (p: Vec3) => inset.y + inset.h / 2 + (p[2] - centroid[2]) * sc;
  const insetPrims = (pose: number): Prim[] => {
    const out: Prim[] = gs.map((g, i) => ({
      p: "circle",
      id: `ip${i}`,
      cx: IX(g.mean),
      cy: IY(g.mean),
      r: 3,
      rgb: g.color,
    }));
    out.push({
      p: "path",
      id: "ipath",
      pts: flat(eyes.map((e) => [IX(e), IY(e)] as const)),
      role: "muted",
      width: 3,
      dash: true,
    });
    const e = eyes[pose] as Vec3;
    const f = (cams[pose] as Camera).W[2];
    out.push({
      p: "line",
      id: "idir",
      x1: IX(e),
      y1: IY(e),
      x2: IX(e) + f[0] * 70,
      y2: IY(e) + f[2] * 70,
      role: "accent",
      width: 4,
      arrow: true,
    });
    out.push({ p: "circle", id: "icam", cx: IX(e), cy: IY(e), r: 12, fill: "accent" });
    out.push({
      p: "text",
      id: "ilab",
      x: inset.x,
      y: inset.y + inset.h + 12,
      size,
      role: "muted",
      anchor: "start",
      slot: "path",
    });
    return out;
  };
  const base = (stage: "points" | "splats" | "render", pose: number): Prim[] => [
    {
      p: "rect",
      id: "panel",
      ...panel,
      fill: stage === "render" ? undefined : "panel",
      role: "rule",
      width: 2,
    },
    {
      p: "text",
      id: "stage",
      x: 0,
      y: 0,
      size,
      role: "fg",
      anchor: "start",
      slot: stage,
      vars: { n, pose: pose + 1, poses },
    },
  ];
  const s0 = [...(projected[0] as Splat2D[])].sort((p, q) => q.depth - p.depth); // far first, for drawing
  const pointsFrame: Frame = {
    id: "points",
    prims: [
      ...base("points", 0),
      ...s0.map(
        (s, i): Prim => ({
          p: "circle",
          id: `pt${i}`,
          cx: panel.x + s.u * k,
          cy: panel.y + s.v * k,
          r: 5,
          rgb: s.color,
        }),
      ),
      ...insetPrims(0),
    ],
    vars: { n, pose: 1, poses },
  };
  const splatsFrame: Frame = {
    id: "splats",
    prims: [
      ...base("splats", 0),
      ...s0.flatMap((s, i): Prim[] => {
        const [a, b, c] = s.cov;
        const mid = (a + c) / 2;
        const r = Math.sqrt(Math.max(0, mid * mid - (a * c - b * b)));
        const l1 = mid + r;
        const l2 = Math.max(1e-6, mid - r);
        const ang = (Math.atan2(l1 - a, b || 1e-12) * 180) / Math.PI;
        return [
          {
            p: "ellipse",
            id: `sp${i}`,
            cx: panel.x + s.u * k,
            cy: panel.y + s.v * k,
            rx: 2 * Math.sqrt(l1) * k,
            ry: 2 * Math.sqrt(l2) * k,
            angle: b === 0 && a >= c ? 0 : b === 0 ? 90 : ang,
            rgb: s.color,
            opacity: 0.35 * s.opacity + 0.15,
          },
        ];
      }),
      ...insetPrims(0),
    ],
    vars: { n, pose: 1, poses },
  };
  const renders: Frame[] = cams.map((_, i) => ({
    id: `render-${i}`,
    prims: [
      ...base("render", i),
      { p: "image", id: "render", ...panel, layer: `render-${i}` },
      ...insetPrims(i),
    ],
    vars: { n, pose: i + 1, poses },
  }));
  return {
    rasters,
    frames: [pointsFrame, splatsFrame, ...renders],
    data: { n, renderSize: [rw, rh], visible: projected.map((p) => p.length) },
    vars: { n },
  };
}

export function takeaway(r: MechanismResult): string {
  return fillTemplate(TAKEAWAY, r.vars);
}
