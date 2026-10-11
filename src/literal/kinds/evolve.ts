/**
 * evolve — a state stepping through iterations under a stated rule, run for
 * real: every step is one reveal, so the state's trace grows while it is said.
 *
 * RULES (src/types.ts `LITERAL_RULES`): `recur` s' = a·s + b·x (ema: b = 1−a;
 * leaky: b = 1; linear: b stated), with a fixed threshold θ the state fires at
 * (`reset` soft subtracts θ, hard returns to 0), or θ = scale·s that each
 * input is held against; `noise`, the forward marginal x_t = √ᾱ_t·x₀ +
 * √(1−ᾱ_t)·ε of a picture on a stated schedule; `formula`, any update the
 * source prints, over `s`, `x` and its named params. The state starts at rest
 * (0); an EMA starts at its first input. `phases` split the run, and a frozen
 * phase keeps receiving inputs while the state holds.
 *
 * INPUT. `values` the source prints (exact), or `from` an earlier operate or
 * region beat: its computed tiles stream in as pictures, each reduced to its
 * mean, variance or std (example material: the picture is). No value computed
 * here is ever printed.
 */
import { LITERAL_RULES, type LiteralOpDoc } from "../../types.js";
import { evaluate, parseFormula } from "../formula.js";
import { alphaBars, seededNormals, statOf, type Tensor, tensor } from "../ops.js";
import type { Frame, MechanismResult, Prim, Raster } from "./common.js";
import { fitBox, TYPE } from "./common.js";
import { num, paramRecord } from "./read.js";
import { placeholderPicture, rasterOf, type VerbCtx } from "./stage.js";

type Ctx = VerbCtx<"evolve">;

const MAX_STEPS = 24;

/** The tiles an earlier beat computed, or placeholder tiles at plan time. */
function tilesFrom(c: Ctx, from: string): Tensor[] {
  const e = c.earlier.get(from);
  if (!e) {
    if (!c.dry)
      throw new Error(`evolve streams the tiles of "${from}", which drew no verb scene before it`);
    const p = placeholderPicture(64, 64);
    return Array.from({ length: 8 }, (_, k) =>
      tensor(16, 16, 3, cut(tensor(64, 64, 3, p.d), (k % 4) * 16, Math.floor(k / 4) * 16, 16)),
    );
  }
  const m = e.layers.material;
  if (m?.tiles?.length) return m.tiles;
  if (m?.final) {
    // An operate output, cut into a 4×3 grid of tiles in reading order (example material).
    const f = m.final;
    const tw = Math.floor(f.w / 4);
    const th = Math.floor(f.h / 3);
    if (tw < 4 || th < 4)
      throw new Error(`evolve: "${from}"'s output is too small to stream as tiles`);
    const out: Tensor[] = [];
    for (let r = 0; r < 3; r++)
      for (let q = 0; q < 4; q++) out.push(tensor(th, tw, f.c, cutRect(f, q * tw, r * th, tw, th)));
    return out;
  }
  throw new Error(`evolve: "${from}" computed nothing to stream (name an operate or region beat)`);
}

function cut(t: Tensor, x0: number, y0: number, s: number): Float32Array {
  return cutRect(t, x0, y0, s, s);
}

function cutRect(t: Tensor, x0: number, y0: number, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h * t.c);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let k = 0; k < t.c; k++)
        d[(y * w + x) * t.c + k] = t.d[((y0 + y) * t.w + x0 + x) * t.c + k] as number;
  return d;
}

interface Run {
  xs: number[];
  s: number[];
  theta: Array<number | undefined>;
  fired: boolean[];
}

/** The recurrence, step by step, honouring the frozen phases. */
function runRule(c: Ctx, xs: number[]): Run {
  const d = c.lit;
  const frozen = (k: number) => {
    let f = false;
    for (const p of d.phases) if (k >= p.from) f = p.freeze;
    return f;
  };
  const out: Run = { xs, s: [], theta: [], fired: [] };
  if (d.rule === "recur") {
    const doc = LITERAL_RULES.recur as LiteralOpDoc;
    const P = paramRecord(d.params, doc, "recur");
    const a = P.a;
    if (a === undefined) throw new Error("recur needs `a` (the factor on the old state)");
    if (!d.how) throw new Error("recur needs `how`: ema, leaky or linear");
    const b = d.how === "ema" ? 1 - a : d.how === "leaky" ? 1 : P.b;
    if (b === undefined) throw new Error("recur linear needs `b`");
    if (P.theta !== undefined && P.scale !== undefined)
      throw new Error("recur takes `theta` or `scale`, not both");
    if (d.reset !== "none" && P.theta === undefined)
      throw new Error("a `reset` needs a fixed `theta` to fire at");
    let s = d.how === "ema" ? (xs[0] as number) : 0;
    xs.forEach((x, k) => {
      if (!frozen(k) && !(d.how === "ema" && k === 0)) s = a * s + b * x;
      let fired = false;
      if (P.theta !== undefined && s >= P.theta) {
        fired = true;
        out.s.push(s);
        if (!frozen(k)) s = d.reset === "soft" ? s - P.theta : d.reset === "hard" ? 0 : s;
      } else out.s.push(s);
      const th = P.theta ?? (P.scale !== undefined ? P.scale * (out.s[k] as number) : undefined);
      out.theta.push(th);
      out.fired.push(fired || (P.scale !== undefined && th !== undefined && x >= th));
    });
    return out;
  }
  if (d.rule === "formula") {
    if (!d.expr)
      throw new Error("evolve formula needs `expr` (the next state over s, x and its params)");
    const ast = parseFormula(d.expr);
    const P = paramRecord(d.params, { params: {} }, "formula", true);
    let s = 0;
    xs.forEach((x, k) => {
      if (!frozen(k)) s = evaluate(ast, { ...P, s, x });
      if (!Number.isFinite(s))
        throw new Error(`evolve formula leaves a finite value at step ${k + 1}`);
      out.s.push(s);
      out.theta.push(undefined);
      out.fired.push(false);
    });
    return out;
  }
  throw new Error(`evolve: rule ${d.rule} takes no input stream`);
}

export function evolve(c: Ctx): MechanismResult {
  if (c.lit.rule === "noise") return noise(c);
  const d = c.lit;
  const inp = d.input;
  if (!inp || (!inp.values.length && !inp.from))
    throw new Error("evolve needs `input`: `values` the source prints, or `from` an earlier beat");
  if (inp.values.length && inp.from) throw new Error("evolve takes `values` or `from`, not both");
  let tiles: Tensor[] = [];
  let xs: number[];
  if (inp.from) {
    if (!inp.stat)
      throw new Error("evolve: a stream `from` a beat needs `stat` (mean, var or std)");
    tiles = tilesFrom(c, inp.from).slice(0, MAX_STEPS);
    xs = tiles.map((t) => statOf(t.d, inp.stat as "mean"));
  } else xs = inp.values.map((v, k) => num(v.value, `input value ${k + 1}`));
  if (xs.length < 3 || xs.length > MAX_STEPS)
    throw new Error(`evolve steps through 3–${MAX_STEPS} inputs, got ${xs.length}`);
  for (const p of d.phases)
    if (!Number.isInteger(p.from) || p.from < 0 || p.from >= xs.length)
      throw new Error(`phase "${p.label}" starts at ${p.from}, outside 0–${xs.length - 1}`);
  const run = runRule(c, xs);
  if (run.theta.some((t) => t !== undefined) && !c.labels.threshold?.trim())
    throw new Error("evolve: a threshold needs the `threshold` slot");
  return draw(c, run, tiles);
}

/** The phases as [from, to) ranges with labels; one unnamed range when there are none. */
function phaseRanges(c: Ctx, n: number): Array<{ from: number; to: number; label?: string }> {
  const ps = [...c.lit.phases].sort((a, b) => a.from - b.from);
  if (!ps.length) return [{ from: 0, to: n }];
  const out: Array<{ from: number; to: number; label?: string }> = [];
  if ((ps[0] as { from: number }).from > 0)
    out.push({ from: 0, to: (ps[0] as { from: number }).from });
  ps.forEach((p, i) => {
    out.push({ from: p.from, to: ps[i + 1]?.from ?? n, label: p.label });
  });
  return out;
}

function draw(c: Ctx, run: Run, tiles: Tensor[]): MechanismResult {
  const { width: W, height: H } = c.region;
  const n = run.xs.length;
  const rasters: Record<string, Raster> = {};
  tiles.forEach((t, k) => {
    rasters[`t${k}`] = rasterOf(t);
  });
  const top = tiles.length ? Math.round(H * 0.55) : 0;
  const chart = { x: 0, y: top + 64, w: W, h: H - top - 64 - 12 };
  const vals = [...run.xs, ...run.s, ...run.theta.filter((t): t is number => t !== undefined)];
  // The trace's own range, padded: a state that moves a little must be seen to move.
  const vlo = Math.min(...vals);
  const vhi = Math.max(...vals);
  const pad = (vhi - vlo || Math.abs(vhi) || 1) * 0.15;
  const lo = vlo - pad;
  const hi = vhi + pad;
  const X = (k: number) => chart.x + 30 + ((chart.w - 60) * (k + 0.5)) / n;
  const Y = (v: number) => chart.y + chart.h - ((v - lo) / (hi - lo)) * chart.h;
  const ranges = phaseRanges(c, n);
  const frames: Frame[] = ranges.map((rg, f) => {
    const prims: Prim[] = [];
    prims.push({
      p: "rect",
      x: chart.x,
      y: chart.y,
      w: chart.w,
      h: chart.h,
      fill: "panel",
      cam: true,
      opacity: 0.6,
    });
    prims.push({
      p: "text",
      x: 0,
      y: top + 8,
      size: TYPE.body,
      role: "fg",
      anchor: "start",
      slot: "trace",
    });
    if (run.theta.some((t) => t !== undefined))
      prims.push(
        {
          p: "line",
          x1: W - 420,
          y1: top + 34,
          x2: W - 370,
          y2: top + 34,
          role: "b",
          width: 4,
          dash: true,
        },
        {
          p: "text",
          x: W - 356,
          y: top + 10,
          size: TYPE.label,
          role: "b",
          anchor: "start",
          slot: "threshold",
        },
      );
    // Everything before this phase, already drawn.
    const seg = (
      k: number,
      ys: Array<number | undefined>,
      role: "accent" | "b",
      extra: Partial<Prim>,
    ): Prim[] => {
      const a = ys[k - 1];
      const b = ys[k];
      if (k < 1 || a === undefined || b === undefined) return [];
      return [
        {
          p: "path",
          pts: [X(k - 1), Y(a), X(k), Y(b)],
          role,
          width: role === "b" ? 4 : 6,
          cam: true,
          ...(role === "b" ? { dash: true } : {}),
          ...extra,
        } as Prim,
      ];
    };
    for (let k = 0; k < rg.from; k++) {
      prims.push({
        p: "circle",
        cx: X(k),
        cy: Y(run.xs[k] as number),
        r: 8,
        fill: "muted",
        cam: true,
      });
      prims.push(...seg(k, run.s, "accent", {}), ...seg(k, run.theta, "b", {}));
    }
    // Phase boundaries and names.
    for (const r of ranges)
      if (r.from > 0)
        prims.push({
          p: "line",
          x1: X(r.from) - (chart.w - 60) / n / 2,
          y1: chart.y,
          x2: X(r.from) - (chart.w - 60) / n / 2,
          y2: chart.y + chart.h,
          role: "rule",
          width: 3,
          dash: true,
          cam: true,
        });
    if (rg.label)
      prims.push({
        p: "text",
        x: X(rg.from) - 10,
        y: chart.y + 10,
        size: TYPE.label,
        role: "muted",
        anchor: "start",
        text: rg.label,
      });
    // This phase's steps, one reveal each.
    for (let k = rg.from; k < rg.to; k++) {
      const at = Math.min(12, k - rg.from + 1);
      prims.push({
        p: "circle",
        cx: X(k),
        cy: Y(run.xs[k] as number),
        r: 8,
        fill: run.fired[k] ? "accent" : "muted",
        cam: true,
        at,
      });
      prims.push(
        ...seg(k, run.s, "accent", { at, wipe: true }),
        ...seg(k, run.theta, "b", { at, wipe: true }),
      );
      if (k === 0)
        prims.push({
          p: "circle",
          cx: X(0),
          cy: Y(run.s[0] as number),
          r: 6,
          fill: "accent",
          cam: true,
          at,
        });
    }
    if (tiles.length) {
      // The tiles streaming in: the current one large, every one as a small tile lit on arrival.
      const big = fitBox(
        tiles[0]?.w ?? 1,
        tiles[0]?.h ?? 1,
        0,
        64,
        Math.min(top - 64, W * 0.3),
        top - 64 - 8,
      );
      prims.push({
        p: "text",
        x: 0,
        y: 8,
        size: TYPE.body,
        role: "fg",
        anchor: "start",
        slot: "state",
      });
      prims.push({ p: "rect", x: big.x, y: big.y, w: big.w, h: big.h, fill: "panel", cam: true });
      const gx = big.x + big.w + 40;
      const cols = n <= 8 ? n : Math.min(12, Math.ceil(n / 2));
      const rowsN = Math.ceil(n / cols);
      const ts = Math.min(
        (W - gx - (cols - 1) * 10) / cols,
        (top - 64 - 8 - (rowsN - 1) * 10) / rowsN,
      );
      for (let k = 0; k < n; k++) {
        const x = gx + (k % cols) * (ts + 10);
        const y = 64 + Math.floor(k / cols) * (ts + 10);
        const inPhase = k >= rg.from && k < rg.to;
        prims.push({
          p: "image",
          x,
          y,
          w: ts,
          h: ts,
          layer: `t${k}`,
          opacity: k < rg.from ? 1 : 0.25,
        });
        if (inPhase) {
          const at = Math.min(12, k - rg.from + 1);
          prims.push({ p: "image", x, y, w: ts, h: ts, layer: `t${k}`, at });
          prims.push({
            p: "image",
            x: big.x,
            y: big.y,
            w: big.w,
            h: big.h,
            layer: `t${k}`,
            cam: true,
            at,
          });
        }
      }
      if (rg.from > 0)
        prims.push({
          p: "image",
          x: big.x,
          y: big.y,
          w: big.w,
          h: big.h,
          layer: `t${rg.from - 1}`,
          cam: true,
        });
    } else
      prims.push({
        p: "text",
        x: W,
        y: 8,
        size: TYPE.label,
        role: "muted",
        anchor: "end",
        slot: "state",
      });
    return { id: `p${f}`, prims, vars: {} };
  });
  return { rasters, frames, data: { thumb: tiles.length ? `t${n - 1}` : undefined }, vars: {} };
}

/** The forward marginal of the picture at checkpoints of a stated schedule. */
function noise(c: Ctx): MechanismResult {
  const d = c.lit;
  if (!c.image) throw new Error("evolve noise needs its `picture`");
  if (!d.schedule)
    throw new Error("evolve noise needs `schedule` (linear or cosine), as the source states it");
  const P = paramRecord(d.params, LITERAL_RULES.noise as LiteralOpDoc, "noise");
  const T = P.T;
  if (T === undefined) throw new Error("evolve noise needs `T`");
  const abar = alphaBars(d.schedule, T, P.betaStart, P.betaEnd);
  const { width: W, height: H } = c.region;
  const img = c.image;
  const n = seededNormals(11);
  const eps = Float32Array.from({ length: img.d.length }, () => n());
  const K = 6;
  const ts = Array.from({ length: K }, (_, k) => Math.round((k * T) / (K - 1)));
  const rasters: Record<string, Raster> = {};
  ts.forEach((t, k) => {
    const a = t === 0 ? 1 : (abar[t - 1] as number);
    const s = Math.sqrt(a);
    const q = Math.sqrt(1 - a);
    // Pixels in [−1, 1] as the process defines them; drawn back in [0, 1].
    const dd = img.d.map((v, i) => (s * (2 * v - 1) + q * (eps[i] as number) + 1) / 2);
    rasters[`x${k}`] = rasterOf(tensor(img.h, img.w, 3, dd));
  });
  const top = 64;
  const ph = Math.round((H - top) * 0.62);
  const big = fitBox(img.w, img.h, 0, top, W, ph);
  const chart = { x: 0, y: top + ph + 24, w: W, h: H - top - ph - 24 };
  const X = (t: number) => chart.x + (chart.w * t) / T;
  const Y = (v: number) => chart.y + chart.h - v * chart.h;
  const curve = (f: (a: number) => number, role: "a" | "b", k: number): Prim => {
    const pts: number[] = [];
    const t0 = ts[k - 1] as number;
    const t1 = ts[k] as number;
    for (let i = 0; i <= 24; i++) {
      const t = t0 + ((t1 - t0) * i) / 24;
      const a = t <= 0 ? 1 : (abar[Math.min(T, Math.round(t)) - 1] as number);
      pts.push(X(t), Y(f(a)));
    }
    return { p: "path", pts, role, width: 5, cam: true, at: k, wipe: true };
  };
  const prims: Prim[] = [
    { p: "text", x: 0, y: 8, size: TYPE.body, role: "fg", anchor: "start", slot: "state" },
    { p: "rect", x: big.x, y: big.y, w: big.w, h: big.h, fill: "panel", cam: true },
    { p: "image", x: big.x, y: big.y, w: big.w, h: big.h, layer: "x0", cam: true },
    ...ts.slice(1).map(
      (_, j) =>
        ({
          p: "image",
          x: big.x,
          y: big.y,
          w: big.w,
          h: big.h,
          layer: `x${j + 1}`,
          cam: true,
          at: j + 1,
        }) as Prim,
    ),
    { p: "rect", x: chart.x, y: chart.y, w: chart.w, h: chart.h, fill: "panel", opacity: 0.6 },
    {
      p: "text",
      x: chart.w,
      y: chart.y - 52,
      size: TYPE.label,
      role: "muted",
      anchor: "end",
      slot: "trace",
    },
    ...ts
      .slice(1)
      .flatMap((_, j) => [
        curve(Math.sqrt, "a", j + 1),
        curve((a) => Math.sqrt(1 - a), "b", j + 1),
      ]),
  ];
  return {
    rasters,
    frames: [{ id: "noise", prims, vars: {} }],
    data: { thumb: `x${K - 1}` },
    vars: {},
  };
}
