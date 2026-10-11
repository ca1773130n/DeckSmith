/**
 * operate — an input run through a chain of KNOWN operations (src/literal/ops.ts),
 * every output computed for real at build time and revealed on its sentence:
 * each op's output wipes across its input, left to right, then the camera
 * leans in on it.
 *
 * WHAT IS EXACT. The ops, with the parameters the source states (the gate
 * grounds each one in its role, src/plan/coverage.ts). WHAT IS EXAMPLE. The
 * input when it is a picture (always: a picture is never the method's own
 * intermediate) or a vector the source does not print, and any `condition`;
 * the scene then carries the example tag, and prints no computed value.
 *
 * Three layouts, one per input: a MAP (a picture: large, with the chain as a
 * column of thumbnails), PROFILES (1–2 vectors over named bins as columns, full
 * width, each result wiped in bin by bin) and a GRID (a small matrix, rows
 * revealed in turn). No layout invents a number: no ticks, no values on example
 * data.
 */
import {
  degrade,
  fromRows,
  fromVector,
  NAMED_KERNELS,
  type OpStep,
  runChain,
  statOf,
  type Tensor,
  tensor,
} from "../ops.js";
import type { Frame, MechanismResult, Prim, Raster } from "./common.js";
import { fitBox, TYPE, wrapBy } from "./common.js";
import { opStepOf, plain } from "./read.js";
import { rasterOf, sharedScale, textLines, type VerbCtx } from "./stage.js";

type Ctx = VerbCtx<"operate">;

const TITLE_H = 64;

/** The input arrays, the operand's layout, and the example degradation. */
function inputsOf(c: Ctx): {
  inputs: Tensor[];
  layout: "map" | "profile" | "grid";
  names: string[];
} {
  const d = c.lit;
  const given = [
    d.picture ? "picture" : "",
    d.vectors.length ? "vectors" : "",
    d.matrix.length ? "matrix" : "",
  ].filter(Boolean);
  if (given.length !== 1)
    throw new Error(
      `operate takes exactly one input (a \`picture\`, \`vectors\` or a \`matrix\`), got ${given.length ? given.join(" and ") : "none"}`,
    );
  if (d.picture) {
    if (!c.image) throw new Error("operate: the picture did not resolve to an image");
    return { inputs: [tensor(c.image.h, c.image.w, 3, c.image.d)], layout: "map", names: [] };
  }
  if (d.vectors.length) {
    if (d.vectors.length > 2)
      throw new Error(`operate draws one or two vectors, got ${d.vectors.length}`);
    const n = d.bins.length;
    if (n < 2 || n > 24) throw new Error(`operate's vectors need 2–24 \`bins\`, got ${n}`);
    for (const v of d.vectors)
      if (v.values.length !== n)
        throw new Error(`vector "${v.label}" has ${v.values.length} values for ${n} bins`);
    return {
      inputs: d.vectors.map((v) => fromVector(v.values)),
      layout: "profile",
      names: d.vectors.map((v) => v.label),
    };
  }
  const m = fromRows(d.matrix);
  if (m.h > 16 || m.w > 16)
    throw new Error(`operate draws a matrix of at most 16×16, got ${m.h}×${m.w}`);
  return { inputs: [m], layout: "grid", names: [] };
}

/** A computed value a slot may name: only shown when the gate finds every input stated. */
function varsOf(t: Tensor): Record<string, string> {
  return {
    max: plain(statOf(t.d, "max")),
    sum: plain(statOf(t.d, "sum")),
    mean: plain(statOf(t.d, "mean")),
  };
}

export function operate(c: Ctx): MechanismResult {
  const d = c.lit;
  if (!d.chain.length || d.chain.length > 6)
    throw new Error(`operate runs a chain of 1–6 steps, got ${d.chain.length}`);
  const steps: OpStep[] = d.chain.map((s, k) => opStepOf(s, k + 1));
  const { inputs, layout, names } = inputsOf(c);
  if (d.compare === "condition" && !d.condition)
    throw new Error("operate: `compare` condition needs a `condition`");
  if (d.compare === "params" && !d.alt) throw new Error("operate: `compare` params needs `alt`");
  if (d.condition && !c.labels.condition?.trim())
    throw new Error("operate: a `condition` needs the `condition` slot");
  if (d.compare === "params" && !c.labels.alt?.trim())
    throw new Error("operate: `compare` params needs the `alt` slot");
  const conditioned = d.condition
    ? inputs.map((t) => degrade(t, d.condition?.how ?? "contrast", d.condition?.amount ?? 0))
    : undefined;
  // The chain runs on the degraded input unless the two are compared; then on both.
  const main = runChain(conditioned && d.compare !== "condition" ? conditioned : inputs, steps);
  let other: Tensor | undefined;
  if (d.compare === "condition" && conditioned) other = runChain(conditioned, steps).at(-1);
  if (d.compare === "params" && d.alt) {
    const k = d.alt.step;
    if (!Number.isInteger(k) || k < 1 || k > steps.length)
      throw new Error(`operate: alt.step ${k} is not a step (1–${steps.length})`);
    const src = d.chain[k - 1] as (typeof d.chain)[number];
    const alt = steps.slice();
    alt[k - 1] = opStepOf({ ...src, how: d.alt.how ?? src.how, params: d.alt.params }, k);
    other = runChain(inputs, alt).at(-1);
  }
  const final = main.at(-1) as Tensor;
  const ins = inputs.length;
  const lay = { main, ins, steps, conditioned, other, names };
  const r =
    layout === "map"
      ? mapLayout(c, lay)
      : layout === "profile"
        ? profileLayout(c, lay)
        : gridLayout(c, lay);
  return {
    ...r,
    vars: varsOf(final),
    material: { final },
  };
}

interface Lay {
  main: Tensor[];
  ins: number;
  steps: OpStep[];
  conditioned: Tensor[] | undefined;
  other: Tensor | undefined;
  names: string[];
}

/* -------------------------------------------------------------- the map */

function mapLayout(c: Ctx, L: Lay): Omit<MechanismResult, "vars"> {
  const { width: W, height: H } = c.region;
  const d = c.lit;
  const rasters: Record<string, Raster> = {};
  const input = L.main[0] as Tensor;
  if (d.condition && d.compare !== "condition") rasters.c0 = rasterOf(L.conditioned?.[0] as Tensor);
  rasters.s0 = rasterOf(input);
  L.steps.forEach((_, k) => {
    rasters[`s${k + 1}`] = rasterOf(L.main[L.ins + k] as Tensor);
  });
  if (L.other) {
    // The two sides of a comparison share one display scale: a weaker map must look weaker.
    const fin = L.main.at(-1) as Tensor;
    const k = fin.c === 1 && L.other.c === 1 ? sharedScale([fin, L.other]) : undefined;
    rasters.cmp = rasterOf(fin, k);
    rasters.alt = rasterOf(L.other, k);
  }
  const aspect = input.w / input.h;
  const MW = Math.round(W * 0.64);
  const B = fitBox(input.w, input.h, 0, TITLE_H, MW, H - TITLE_H);
  // The chain as a column of thumbnails beside the picture: the input, then every op.
  const col = { x: B.x + B.w + 40, w: W - (B.x + B.w + 40) };
  const items = [
    { key: "s0", label: c.labels.input ?? "" },
    ...d.chain.map((s, k) => ({ key: `s${k + 1}`, label: s.label })),
  ];
  if (d.condition && d.compare !== "condition")
    items.splice(1, 0, { key: "c0", label: c.labels.condition ?? "" });
  const gap = 14;
  const th = Math.min(150, (H - 8 - (items.length - 1) * gap) / items.length);
  const tw = Math.min(col.w * 0.42, th * aspect);
  const labelW = col.w - tw - 20;
  if (labelW < 160)
    throw new Error(
      "operate: the chain's column has no room for its labels; use a wider region or fewer steps",
    );
  const column = (active: number): Prim[] =>
    items.flatMap((it, j) => {
      const y = 6 + j * (th + gap);
      const lines = wrapBy(it.label, TYPE.label, labelW, c.measure);
      if (lines.length > 2 || (lines.length * 47 > th && th < 94))
        throw new Error(
          `operate: step label "${it.label}" needs ${lines.length} lines beside its thumbnail; shorten it`,
        );
      const ty = y + Math.max(0, (th - lines.length * 47) / 2);
      return [
        {
          p: "image",
          x: col.x,
          y,
          w: tw,
          h: th,
          layer: it.key,
          opacity: j <= active ? 1 : 0.3,
        } as Prim,
        ...(j === active
          ? [
              {
                p: "rect",
                x: col.x - 4,
                y: y - 4,
                w: tw + 8,
                h: th + 8,
                role: "accent",
                width: 4,
                radius: 6,
              } as Prim,
            ]
          : []),
        ...textLines(lines, col.x + tw + 20, ty, TYPE.label, j === active ? "fg" : "muted"),
      ];
    });
  const title = (t: string): Prim[] => [
    { p: "text", x: B.x, y: 6, size: TYPE.body, role: "fg", anchor: "start", text: t },
  ];
  const titleSlot = (slot: string): Prim[] => [
    { p: "text", x: B.x, y: 6, size: TYPE.body, role: "fg", anchor: "start", slot },
  ];
  const ground: Prim = { p: "rect", x: B.x, y: B.y, w: B.w, h: B.h, fill: "panel", cam: true };
  const pic = (layer: string, extra: Partial<Prim> = {}): Prim =>
    ({ p: "image", x: B.x, y: B.y, w: B.w, h: B.h, layer, cam: true, ...extra }) as Prim;
  // An output wipes in over its input on its own ground: a translucent map never mixes with the picture under it.
  const over = (layer: string): Prim[] => [
    { ...ground, at: 1, wipe: true } as Prim,
    pic(layer, { at: 1, wipe: true }),
  ];
  const frames: Frame[] = [];
  frames.push({
    id: "in",
    prims: [...titleSlot("input"), ground, pic("s0"), ...column(0)],
    vars: {},
  });
  let at = 1;
  let prev = "s0";
  if (d.condition && d.compare !== "condition") {
    frames.push({
      id: "cond",
      prims: [...titleSlot("condition"), ground, pic("s0"), ...over("c0"), ...column(1)],
      vars: {},
    });
    prev = "c0";
    at = 2;
  }
  d.chain.forEach((s, k) => {
    const key = `s${k + 1}`;
    const last = k === d.chain.length - 1 && d.compare === "none";
    const inset = kernelInset(L.steps[k] as OpStep, B, c);
    frames.push({
      id: key,
      prims: [
        ...(last ? titleSlot("output") : title(s.label)),
        ground,
        pic(prev),
        ...over(key),
        ...inset,
        ...column(k + at),
      ],
      vars: {},
    });
    prev = key;
  });
  if (L.other) {
    // Side by side: the chain's output, and the same chain on the degraded input (or with the other parameters).
    // Full width, the column set aside: the two results are the point of this step.
    const half0 = (W - 24) / 2;
    const bh = Math.min(half0 / aspect, H - TITLE_H - 56);
    const half = bh * aspect;
    const y = TITLE_H + 56;
    const B = { x: (W - 2 * half - 24) / 2 };
    frames.push({
      id: "compare",
      prims: [
        ...titleSlot("output"),
        {
          p: "text",
          x: B.x,
          y: y - 52,
          size: TYPE.label,
          role: "muted",
          anchor: "start",
          slot: d.compare === "condition" ? "input" : "output",
        },
        {
          p: "text",
          x: B.x + half + 24,
          y: y - 52,
          size: TYPE.label,
          role: "muted",
          anchor: "start",
          slot: d.compare === "condition" ? "condition" : "alt",
        },
        { p: "rect", x: B.x, y, w: half, h: bh, fill: "panel", cam: true },
        { p: "image", x: B.x, y, w: half, h: bh, layer: "cmp", cam: true },
        { p: "rect", x: B.x + half + 24, y, w: half, h: bh, fill: "panel", cam: true },
        {
          p: "image",
          x: B.x + half + 24,
          y,
          w: half,
          h: bh,
          layer: "alt",
          cam: true,
          at: 1,
          wipe: true,
        },
      ],
      vars: {},
    });
  }
  return { rasters, frames, data: { thumb: L.other ? "alt" : prev } };
}

/** A named kernel's numbers (definitional) or the stated weights, as a small grid over the picture. */
function kernelInset(
  step: OpStep,
  B: { x: number; y: number; w: number; h: number },
  c: Ctx,
): Prim[] {
  if (step.op !== "conv") return [];
  const k =
    step.how && NAMED_KERNELS[step.how]
      ? NAMED_KERNELS[step.how]
      : step.how === "weights"
        ? step.weights
        : undefined;
  if (!k || k.length > 5 || (k[0]?.length ?? 0) > 5) return [];
  const cells = k.map((r) => r.map((v) => plain(v)));
  const cw = Math.max(72, ...cells.flat().map((t) => c.measure(t, TYPE.label) + 20));
  const ch = 56;
  const w = cw * (k[0]?.length ?? 0) + 24;
  const h = ch * k.length + 24;
  const x0 = B.x + B.w - w - 16;
  const y0 = B.y + 16;
  return [
    { p: "rect", x: x0, y: y0, w, h, fill: "panel", role: "accent", width: 3, radius: 8, at: 2 },
    ...cells.flatMap((row, j) =>
      row.map(
        (t, i) =>
          ({
            p: "text",
            x: x0 + 12 + i * cw + cw / 2,
            y: y0 + 12 + j * ch + 6,
            size: TYPE.label,
            role: "fg",
            anchor: "middle",
            text: t,
            at: 2,
          }) as Prim,
      ),
    ),
  ];
}

/* ---------------------------------------------------------- the profiles */

/**
 * Vectors over named bins as COLUMNS, one group per bin — a distribution over
 * tokens is categorical, and r3 drew it as piecewise-linear "mountains". Each
 * column stands at its value (a static shape revealed by a wipe, never grown).
 * Each step's output is drawn solid in the accent, with the inputs it came from
 * as their own colours' height marks across the bin. When an output and an
 * earlier one SUM to an input (min(p, q) and max(0, p − q) sum to p), the output
 * is stacked on the earlier one under that input's mark, so the identity is
 * visible, computed, not asserted. Values are printed only on stated vectors
 * (no `example` tag): an example's numbers would read as the paper's.
 */
function profileLayout(c: Ctx, L: Lay): Omit<MechanismResult, "vars"> {
  const { width: W, height: H } = c.region;
  const d = c.lit;
  const n = d.bins.length;
  const binW = W / n;
  for (const b of d.bins)
    if (c.measure(b, TYPE.label) > binW - 8)
      throw new Error(
        `operate: bin "${b}" is wider than its column at 40px; use fewer or shorter bins`,
      );
  const stated = !c.labels.example?.trim();
  const legendH = 56;
  const valueH = stated ? TYPE.label * 1.2 + 6 : 0;
  const top = TITLE_H + legendH + valueH;
  const bottom = H - 60;
  const colW = Math.min(binW * 0.62, 220);
  const values = (t: Tensor) => Array.from({ length: t.w }, (_, i) => t.d[i] as number);
  const inputs = L.main.slice(0, L.ins);
  const roleOf = (k: number) => (k ? "b" : "a") as "a" | "b";
  // An output that, with an earlier output, sums to an input: stacked on that output.
  const near = (a: readonly number[], b: readonly number[]) =>
    // Float32 arrays: equal to six significant digits.
    a.length === b.length &&
    a.every((v, i) => Math.abs(v - (b[i] as number)) <= 1e-5 * Math.max(1, Math.abs(v)));
  const stackOf = (k: number): { on: number; input: number } | undefined => {
    const out = values(L.main[L.ins + k] as Tensor);
    for (let j = 0; j < k; j++) {
      const below = values(L.main[L.ins + j] as Tensor);
      if (below.length !== out.length) continue;
      const sum = out.map((v, i) => v + (below[i] as number));
      const input = inputs.findIndex((t) => near(values(t), sum));
      if (input >= 0 && out.some((v) => v > 0) && below.some((v) => v > 0)) return { on: j, input };
    }
    return undefined;
  };
  // Headroom over the tallest column, so a height mark never meets the legend.
  const ymaxOf = (vs: number[][]) => Math.max(1e-9, ...vs.flat()) * 1.08;
  const yminOf = (vs: number[][]) => Math.min(0, ...vs.flat());
  /** The ground, the zero line and the bin names, on one scale. */
  const ground = (ymin: number, ymax: number, named: boolean): Prim[] => {
    const y = (v: number) => bottom - ((v - ymin) / (ymax - ymin)) * (bottom - top);
    return [
      {
        p: "rect",
        x: 0,
        y: top - 8,
        w: W,
        h: bottom - top + 16,
        fill: "panel",
        opacity: 0.5,
        cam: true,
      },
      { p: "line", x1: 0, y1: y(0), x2: W, y2: y(0), role: "rule", width: 2, cam: true },
      ...(named
        ? d.bins.map(
            (b, i) =>
              ({
                p: "text",
                x: (i + 0.5) * binW,
                y: bottom + 12,
                size: TYPE.label,
                role: "muted",
                anchor: "middle",
                text: b,
              }) as Prim,
          )
        : []),
    ];
  };
  const scale = (ymin: number, ymax: number) => (v: number) =>
    bottom - ((v - ymin) / (ymax - ymin)) * (bottom - top);
  /** Columns of `vs` in bin `i`'s slot `slot` of `slots`, from `base` (stacked) upward. */
  const columns = (
    vs: readonly number[],
    y: (v: number) => number,
    role: "a" | "b" | "accent",
    slot: number,
    slots: number,
    extra: Partial<Prim>,
    base?: readonly number[],
  ): Prim[] => {
    const w = colW / slots;
    const m = vs.length;
    const cx = (i: number) => (m === n ? (i + 0.5) * binW : ((i + 0.5) * W) / m);
    const cw = m === n ? w : Math.min(w, (W / m) * 0.62);
    return vs.flatMap((v, i) => {
      const b = base?.[i] ?? 0;
      const y0 = y(b);
      const y1 = y(b + v);
      const h = Math.abs(y0 - y1);
      if (h < 0.5) return [];
      return [
        {
          p: "rect",
          x: cx(i) - (m === n ? colW / 2 : cw / 2) + slot * cw,
          y: Math.min(y0, y1),
          w: Math.max(2, cw - 4),
          h,
          fill: role,
          radius: 3,
          cam: true,
          ...extra,
        } as Prim,
      ];
    });
  };
  /** A vector's height marks across each bin: what an output is compared against. */
  const marks = (vs: readonly number[], y: (v: number) => number, role: "a" | "b"): Prim[] =>
    vs.map(
      (v, i) =>
        ({
          p: "line",
          x1: (i + 0.5) * binW - colW / 2 - 10,
          y1: y(v),
          x2: (i + 0.5) * binW + colW / 2 + 10,
          y2: y(v),
          role,
          width: 5,
          cam: true,
        }) as Prim,
    );
  /** Each column's value above it, on stated vectors only. */
  const printed = (
    vs: readonly number[],
    y: (v: number) => number,
    role: "fg" | "accent",
    extra: Partial<Prim>,
    base?: readonly number[],
  ): Prim[] =>
    stated && vs.length === n
      ? vs.map(
          (v, i) =>
            ({
              p: "text",
              x: (i + 0.5) * binW,
              y: y((base?.[i] ?? 0) + Math.max(0, v)) - TYPE.label * 1.2 - 4,
              size: TYPE.label,
              role,
              anchor: "middle",
              text: plain(v),
              ...extra,
            }) as Prim,
        )
      : [];
  const legend = (label: string, role: "a" | "b" | "accent", x: number): Prim[] => [
    { p: "rect", x, y: TITLE_H + 12, w: 32, h: 24, fill: role, radius: 4 },
    {
      p: "text",
      x: x + 44,
      y: TITLE_H + 4,
      size: TYPE.label,
      role: "fg",
      anchor: "start",
      text: label,
    },
  ];
  const legends = L.names.flatMap((nm, k) => legend(nm, roleOf(k), k * (W / 3)));
  const title = (p: Partial<Prim>): Prim =>
    ({ p: "text", x: 0, y: 6, size: TYPE.body, role: "fg", anchor: "start", ...p }) as Prim;
  // The inputs, side by side in each bin, each wiped in on its own step.
  const ins = inputs.map(values);
  const y0 = scale(yminOf(ins), ymaxOf(ins));
  const frames: Frame[] = [
    {
      id: "in",
      prims: [
        title({ slot: "input" }),
        ...legends,
        ...ground(yminOf(ins), ymaxOf(ins), true),
        ...ins.flatMap((vs, k) => [
          ...columns(vs, y0, roleOf(k), k, ins.length, { at: k + 1, wipe: true }),
          ...(ins.length === 1 ? printed(vs, y0, "fg", { at: k + 1 }) : []),
        ]),
      ],
      vars: {},
    },
  ];
  d.chain.forEach((s, k) => {
    const out = values(L.main[L.ins + k] as Tensor);
    const last = k === d.chain.length - 1 && !L.other;
    const st = stackOf(k);
    const below = st ? values(L.main[L.ins + st.on] as Tensor) : undefined;
    const sameLen = out.length === n;
    const shownVs = sameLen
      ? [...ins, out, ...(below ? [out.map((v, i) => v + (below[i] as number))] : [])]
      : [out];
    const ymin = yminOf(shownVs);
    const ymax = ymaxOf(shownVs);
    const y = scale(ymin, ymax);
    frames.push({
      id: `s${k + 1}`,
      prims: [
        title(last ? { slot: "output" } : { text: s.label }),
        ...legends,
        ...(last
          ? [
              {
                p: "text",
                x: W,
                y: TITLE_H + 4,
                size: TYPE.label,
                role: "accent",
                anchor: "end",
                text: s.label,
              } as Prim,
            ]
          : []),
        ...ground(ymin, ymax, sameLen),
        // What it is stacked on, in place from the start, quiet.
        ...(below ? columns(below, y, "accent", 0, 1, { opacity: 0.4 }) : []),
        ...columns(out, y, "accent", 0, 1, { at: 1, wipe: true }, below),
        // The inputs' heights across each bin: the output against what it came from.
        ...(sameLen ? ins.flatMap((vs, j) => marks(vs, y, roleOf(j))) : []),
        ...printed(out, y, "accent", { at: 1 }, below),
      ],
      vars: {},
    });
  });
  if (L.other) {
    const main = values(L.main.at(-1) as Tensor);
    const other = values(L.other);
    const vs = [main, other];
    const y = scale(yminOf(vs), ymaxOf(vs));
    frames.push({
      id: "compare",
      prims: [
        title({ slot: d.compare === "params" ? "alt" : "condition" }),
        ...ground(yminOf(vs), ymaxOf(vs), main.length === n),
        ...columns(main, y, "accent", 0, 2, { opacity: 0.45 }),
        ...columns(other, y, "b", 1, 2, { at: 1, wipe: true }),
      ],
      vars: {},
    });
  }
  return { rasters: {}, frames, data: {} };
}

/* --------------------------------------------------------------- the grid */

function gridLayout(c: Ctx, L: Lay): Omit<MechanismResult, "vars"> {
  const { width: W, height: H } = c.region;
  const d = c.lit;
  const grid = (
    t: Tensor,
    x0: number,
    y0: number,
    w: number,
    h: number,
    reveal: boolean,
  ): Prim[] => {
    const cw = w / t.w;
    const ch = h / t.h;
    const lo = statOf(t.d, "min");
    const hi = statOf(t.d, "max");
    const out: Prim[] = [];
    for (let r = 0; r < t.h; r++)
      for (let q = 0; q < t.w; q++)
        out.push({
          p: "rect",
          x: x0 + q * cw + 2,
          y: y0 + r * ch + 2,
          w: cw - 4,
          h: ch - 4,
          heat: hi > lo ? ((t.d[r * t.w + q] as number) - lo) / (hi - lo) : 0.5,
          radius: 4,
          cam: true,
          ...(reveal ? { at: Math.min(r + 1, 12) } : {}),
        });
    return out;
  };
  // Cells fill the area they are given (a heat grid need not be square): one grid alone
  // takes the whole region, two side by side take half each.
  const gh = H - TITLE_H - 10;
  const side = (W - 80) / 2;
  const input = L.main[0] as Tensor;
  const frames: Frame[] = [
    {
      id: "in",
      prims: [
        { p: "text", x: 0, y: 6, size: TYPE.body, role: "fg", anchor: "start", slot: "input" },
        ...grid(input, 0, TITLE_H + 10, W, gh, true),
      ],
      vars: {},
    },
  ];
  let prev = input;
  d.chain.forEach((s, k) => {
    const out = L.main[L.ins + k] as Tensor;
    const last = k === d.chain.length - 1 && !L.other;
    frames.push({
      id: `s${k + 1}`,
      prims: [
        last
          ? { p: "text", x: 0, y: 6, size: TYPE.body, role: "fg", anchor: "start", slot: "output" }
          : { p: "text", x: 0, y: 6, size: TYPE.body, role: "fg", anchor: "start", text: s.label },
        ...grid(prev, 0, TITLE_H + 10, side, gh, false).map((p) => ({ ...p, opacity: 0.5 })),
        {
          p: "line",
          x1: side + 12,
          y1: TITLE_H + gh / 2,
          x2: side + 68,
          y2: TITLE_H + gh / 2,
          role: "muted",
          width: 4,
          arrow: true,
        },
        ...grid(out, side + 80, TITLE_H + 10, side, gh, true),
      ],
      vars: {},
    });
    prev = out;
  });
  if (L.other) {
    frames.push({
      id: "compare",
      prims: [
        { p: "text", x: 0, y: 6, size: TYPE.body, role: "fg", anchor: "start", slot: "output" },
        {
          p: "text",
          x: side + 80,
          y: 6,
          size: TYPE.body,
          role: "fg",
          anchor: "start",
          slot: d.compare === "params" ? "alt" : "condition",
        },
        ...grid(prev, 0, TITLE_H + 10, side, gh, false),
        ...grid(L.other, side + 80, TITLE_H + 10, side, gh, true),
      ],
      vars: {},
    });
  }
  return { rasters: {}, frames, data: {} };
}
