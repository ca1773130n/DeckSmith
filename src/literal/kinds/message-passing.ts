/**
 * message-passing — a graph neural network's layers, run for real on the
 * source's small graph: every node gathers its neighbours' features, hop by
 * hop, and the features spread as colour.
 *
 * WHAT IS EXACT. h_v^{l+1} = σ(W_l · AGG({h_u : u ∈ N(v)} ∪ {h_v})) with AGG
 * the source's: "sum", "mean", "max", or "gcn" (Kipf & Welling 2017: Σ_u
 * h_u / √(d̃_u d̃_v), d̃ counting the self-loop). W_l and σ are the source's
 * when it gives them; otherwise W = I and σ = identity — pure propagation
 * (SGC, Wu et al. 2019), which is what message passing does before anything
 * is learned. Messages are the per-edge terms the aggregate sums.
 *
 * Layout: Fruchterman–Reingold from a seeded start, a fixed number of
 * iterations with a linear cooling schedule, then turned to its principal
 * axis and stretched to the region — the same graph, the same picture.
 * Features colour the nodes: one dimension on the heat ramp; two to four as a
 * mix of the theme's tones (dimension i ↔ tone i); strength is √(|x| / max),
 * the max taken over every layer, so a colour means the same at every hop.
 *
 * Frames: layer 0, then each layer with the messages that made it drawn on
 * their edges (width ∝ size) and the focus node's l-hop field outlined.
 */
import {
  type Frame,
  fillTemplate,
  type LiteralSlot,
  type Measure,
  type MechanismResult,
  mulberry32,
  type Prim,
  type Region,
  r2,
  roughMeasure,
  TYPE,
} from "./common.js";

/* -------------------------------------------------------------------- maths */

export type Aggregate = "sum" | "mean" | "max" | "gcn";

/** Neighbour lists (with or without self), undirected unless `directed` (then u→v means v hears u). */
export function neighbourLists(
  n: number,
  edges: ReadonlyArray<readonly [number, number]>,
  directed: boolean,
): number[][] {
  const N: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    if (u === v) continue;
    if (!(N[v] as number[]).includes(u)) (N[v] as number[]).push(u);
    if (!directed && !(N[u] as number[]).includes(v)) (N[u] as number[]).push(v);
  }
  for (const l of N) l.sort((a, b) => a - b);
  return N;
}

export interface LayerResult {
  h: number[][];
  /** messages[v] = [[u, coefficient, message vector], …] — what v aggregated. */
  messages: Array<Array<{ from: number; coef: number; m: number[] }>>;
}

/** One message-passing layer. */
export function mpLayer(
  h: readonly (readonly number[])[],
  N: readonly (readonly number[])[],
  agg: Aggregate,
  selfLoops: boolean,
  W?: readonly (readonly number[])[],
  relu = false,
): LayerResult {
  const n = h.length;
  const d = (h[0] as readonly number[]).length;
  const deg = N.map((l) => l.length + (selfLoops ? 1 : 0));
  const out: number[][] = [];
  const messages: LayerResult["messages"] = [];
  for (let v = 0; v < n; v++) {
    const from = [...(selfLoops ? [v] : []), ...(N[v] as number[])];
    const ms = from.map((u) => {
      const coef =
        agg === "mean"
          ? 1 / from.length
          : agg === "gcn"
            ? 1 / Math.sqrt((deg[u] as number) * (deg[v] as number))
            : 1;
      return { from: u, coef, m: (h[u] as number[]).map((x) => coef * x) };
    });
    let a: number[];
    if (!from.length) a = new Array(d).fill(0);
    else if (agg === "max")
      a = Array.from({ length: d }, (_, c) =>
        Math.max(...from.map((u) => (h[u] as number[])[c] as number)),
      );
    else a = Array.from({ length: d }, (_, c) => ms.reduce((s, x) => s + (x.m[c] as number), 0));
    let y = a;
    if (W) y = W.map((row) => row.reduce((s, w, c) => s + w * (a[c] as number), 0));
    if (relu) y = y.map((x) => Math.max(0, x));
    out.push(y);
    messages.push(ms.filter((x) => x.from !== v));
  }
  return { h: out, messages };
}

/** Hop distance from `s` to every node (Infinity when unreachable), along message direction. */
export function hops(N: readonly (readonly number[])[], s: number): number[] {
  const n = N.length;
  // Messages flow u → v when u ∈ N[v]; the field of s is who reaches s.
  const dist = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  dist[s] = 0;
  const queue = [s];
  while (queue.length) {
    const v = queue.shift() as number;
    for (const u of N[v] as number[])
      if (dist[u] === Number.POSITIVE_INFINITY) {
        dist[u] = (dist[v] as number) + 1;
        queue.push(u);
      }
  }
  return dist;
}

/** Fruchterman–Reingold in the unit square, seeded start, `iters` steps of linear cooling. */
export function forceLayout(
  n: number,
  edges: ReadonlyArray<readonly [number, number]>,
  seed: number,
  iters = 300,
): Array<[number, number]> {
  const rng = mulberry32(seed);
  const pos: Array<[number, number]> = Array.from({ length: n }, () => [rng(), rng()]);
  const k = Math.sqrt(1 / Math.max(1, n));
  for (let it = 0; it < iters; it++) {
    const t = 0.1 * (1 - it / iters);
    const disp: Array<[number, number]> = Array.from({ length: n }, () => [0, 0]);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const pi = pos[i] as [number, number];
        const pj = pos[j] as [number, number];
        let dx = pi[0] - pj[0];
        let dy = pi[1] - pj[1];
        let dd = Math.hypot(dx, dy);
        if (dd < 1e-6) {
          dx = 1e-3 * (i - j);
          dy = 1e-3;
          dd = Math.hypot(dx, dy);
        }
        const f = (k * k) / dd;
        const di = disp[i] as [number, number];
        const dj = disp[j] as [number, number];
        di[0] += (dx / dd) * f;
        di[1] += (dy / dd) * f;
        dj[0] -= (dx / dd) * f;
        dj[1] -= (dy / dd) * f;
      }
    for (const [u, v] of edges) {
      const pu = pos[u] as [number, number];
      const pv = pos[v] as [number, number];
      const dx = pu[0] - pv[0];
      const dy = pu[1] - pv[1];
      const dd = Math.max(1e-6, Math.hypot(dx, dy));
      const f = (dd * dd) / k;
      const du = disp[u] as [number, number];
      const dv = disp[v] as [number, number];
      du[0] -= (dx / dd) * f;
      du[1] -= (dy / dd) * f;
      dv[0] += (dx / dd) * f;
      dv[1] += (dy / dd) * f;
    }
    for (let i = 0; i < n; i++) {
      const d = disp[i] as [number, number];
      const l = Math.max(1e-9, Math.hypot(d[0], d[1]));
      const p = pos[i] as [number, number];
      p[0] += (d[0] / l) * Math.min(l, t);
      p[1] += (d[1] / l) * Math.min(l, t);
    }
  }
  // Turn the principal axis horizontal (a slide is wide), then scale each axis to 0..1.
  const mx = pos.reduce((s, p) => s + p[0], 0) / n;
  const my = pos.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pos) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const rot = pos.map(
    ([x, y]) => [c * (x - mx) + s * (y - my), -s * (x - mx) + c * (y - my)] as [number, number],
  );
  const xs = rot.map((p) => p[0]);
  const ys = rot.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return rot.map(([x, y]) => [
    x1 > x0 ? (x - x0) / (x1 - x0) : 0.5,
    y1 > y0 ? (y - y0) / (y1 - y0) : 0.5,
  ]);
}

/* ------------------------------------------------------------------- input */

export interface GraphInput {
  nodes: Array<{ id: string; label?: string; features: number[] }>;
  edges: Array<[string, string]>;
  directed?: boolean;
  layers: number;
  aggregate: Aggregate;
  selfLoops?: boolean;
  /** Per layer, d_out × d_in, when the source gives them. */
  weights?: number[][][];
  relu?: boolean;
  /** The node whose receptive field is outlined (default: the first). */
  focus?: string;
  seed?: number;
  measure?: Measure;
}

export const SLOTS: Readonly<Record<string, LiteralSlot>> = {
  layer: { what: "which layer the colours show", vars: ["l", "L"] },
  field: {
    what: "the focus node's outline: the nodes its features now come from",
    vars: ["count", "l"],
  },
};

export const TAKEAWAY =
  "Each layer, every node aggregates its neighbours' features ({agg}); after {L} layers {focus}'s colour carries {count} nodes, everything within {L} hops.";

/* ---------------------------------------------------------------- the kind */

export function messagePassing(input: GraphInput, region: Region): MechanismResult {
  const n = input.nodes.length;
  if (n < 2 || n > 60) throw new Error(`message-passing: ${n} nodes; draw 2..60`);
  const index = new Map(input.nodes.map((v, i) => [v.id, i]));
  if (index.size !== n) throw new Error("message-passing: node ids must be unique");
  const d = (input.nodes[0] as { features: number[] }).features.length;
  if (d < 1 || d > 4)
    throw new Error(`message-passing: features must be 1..4 dimensions to draw, got ${d}`);
  for (const v of input.nodes)
    if (v.features.length !== d || v.features.some((x) => !Number.isFinite(x)))
      throw new Error(`message-passing: node ${v.id} features must be ${d} numbers`);
  const edges = input.edges.map(([a, b]) => {
    const u = index.get(a);
    const v = index.get(b);
    if (u === undefined || v === undefined)
      throw new Error(`message-passing: edge ${a}–${b} names a missing node`);
    return [u, v] as [number, number];
  });
  if (!Number.isInteger(input.layers) || input.layers < 1 || input.layers > 8)
    throw new Error(`message-passing: layers must be 1..8, got ${input.layers}`);
  const N = neighbourLists(n, edges, !!input.directed);
  const selfLoops = input.selfLoops ?? true;
  const H: number[][][] = [input.nodes.map((v) => [...v.features])];
  const msgs: LayerResult["messages"][] = [];
  for (let l = 0; l < input.layers; l++) {
    const W = input.weights?.[l];
    const r = mpLayer(H[l] as number[][], N, input.aggregate, selfLoops, W, input.relu);
    if ((r.h[0] as number[]).length > 4)
      throw new Error("message-passing: a layer's output must stay 1..4 dimensions");
    H.push(r.h);
    msgs.push(r.messages);
  }
  const focus = input.focus === undefined ? 0 : index.get(input.focus);
  if (focus === undefined) throw new Error(`message-passing: focus "${input.focus}" is not a node`);
  const dist = hops(N, focus);

  // Layout.
  const { width: W, height: Hh } = region;
  const size = TYPE.label;
  const measure = input.measure ?? roughMeasure;
  const unit = forceLayout(n, edges, input.seed ?? 1);
  const r = Math.max(22, Math.min(48, Math.min(W, Hh) / (3 * Math.sqrt(n))));
  const labelW = Math.max(0, ...input.nodes.map((v) => measure(v.label ?? v.id, size)));
  const box = {
    x: labelW / 2 + r,
    y: size + 24 + r,
    w: W - labelW - 2 * r,
    h: Hh - (size + 24) - 2 * r - (size + 12),
  };
  // Each axis fills the box (the layout was turned to its principal axis first).
  const P = unit.map(([x, y]) => [box.x + x * box.w, box.y + y * box.h] as [number, number]);

  // Colour: one scale for every layer, so a colour means the same at every hop.
  const mx = Array.from({ length: d }, (_, c) =>
    Math.max(1e-12, ...H.flatMap((hl) => hl.map((v) => Math.abs(v[c] as number)))),
  );
  const paint = (v: readonly number[]): Pick<Extract<Prim, { p: "circle" }>, "heat" | "mix"> =>
    v.length === 1
      ? { heat: Math.sqrt(Math.abs(v[0] as number) / (mx[0] as number)) }
      : { mix: v.map((x, c) => r2(Math.sqrt(Math.abs(x) / (mx[c] as number)))) };

  const frames: Frame[] = H.map((hl, l) => {
    const prims: Prim[] = [];
    edges.forEach(([u, v], e) => {
      const pu = P[u] as [number, number];
      const pv = P[v] as [number, number];
      prims.push({
        p: "line",
        id: `e${e}`,
        x1: pu[0],
        y1: pu[1],
        x2: pv[0],
        y2: pv[1],
        role: "rule",
        width: 3,
      });
    });
    if (l > 0) {
      const ms = msgs[l - 1] as LayerResult["messages"];
      const big = Math.max(1e-12, ...ms.flatMap((m) => m.map((x) => Math.hypot(...x.m))));
      ms.forEach((list, v) => {
        list.forEach(({ from, m }) => {
          const s = Math.hypot(...m) / big;
          if (s < 0.02) return;
          const pu = P[from] as [number, number];
          const pv = P[v] as [number, number];
          const len = Math.hypot(pv[0] - pu[0], pv[1] - pu[1]);
          const ux = (pv[0] - pu[0]) / len;
          const uy = (pv[1] - pu[1]) / len;
          // Offset sideways so u→v and v→u do not overlap; stop at the target's rim.
          const ox = -uy * 7;
          const oy = ux * 7;
          prims.push({
            p: "line",
            id: `m${from}-${v}`,
            x1: pu[0] + ux * r + ox,
            y1: pu[1] + uy * r + oy,
            x2: pv[0] - ux * (r + 4) + ox,
            y2: pv[1] - uy * (r + 4) + oy,
            role: "accent",
            // Multi-dimensional features: the arrow is the colour of what it carries, at full strength.
            ...(m.length > 1
              ? { mix: hueOf(m.map((x, c) => Math.abs(x) / (mx[c] as number))) }
              : {}),
            width: 2 + 8 * s,
            opacity: 0.35 + 0.65 * s,
            arrow: true,
          });
        });
      });
    }
    hl.forEach((v, i) => {
      const [x, y] = P[i] as [number, number];
      const inField = (dist[i] as number) <= l;
      prims.push({
        p: "circle",
        id: `n${i}`,
        cx: x,
        cy: y,
        r,
        ...paint(v),
        role: i === focus ? "fg" : inField ? "fg" : "rule",
        width: i === focus ? 8 : inField ? 4 : 2,
      });
      const node = input.nodes[i] as { id: string; label?: string };
      prims.push({
        p: "text",
        id: `t${i}`,
        x,
        y: y + r + 6,
        size,
        role: i === focus ? "fg" : "muted",
        anchor: "middle",
        text: node.label ?? node.id,
      });
    });
    const count = dist.filter((x) => x <= l).length;
    prims.push({
      p: "text",
      id: "layer",
      x: 0,
      y: 0,
      size,
      role: "fg",
      anchor: "start",
      slot: "layer",
      vars: { l, L: input.layers },
    });
    prims.push({
      p: "text",
      id: "field",
      x: W,
      y: 0,
      size,
      role: "muted",
      anchor: "end",
      slot: "field",
      vars: { count, l },
    });
    return { id: `l${l}`, prims, vars: { l, L: input.layers, count } };
  });
  const focusNode = input.nodes[focus] as { id: string; label?: string };
  return {
    rasters: {},
    frames,
    data: { features: H, layout: unit, hops: dist },
    vars: {
      agg: input.aggregate,
      L: input.layers,
      focus: focusNode.label ?? focusNode.id,
      count: dist.filter((x) => x <= input.layers).length,
    },
  };
}

export function takeaway(r: MechanismResult): string {
  return fillTemplate(TAKEAWAY, r.vars);
}

/** Weights rescaled so the largest is 1: a hue at full strength (all zero stays zero). */
function hueOf(w: readonly number[]): number[] {
  const top = Math.max(...w);
  return w.map((x) => r2(top > 0 ? x / top : 0));
}
