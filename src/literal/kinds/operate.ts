/**
 * operate — the approved look (.planning/designs/2026-10-12-verb-looks/
 * 1-operate.png): what the source states on top, as chips, then one CELL per
 * computed stage joined in reading order, each revealed on its sentence. Two
 * forms:
 *
 * TERMS: a stated formula evaluated term by term on the values the source gives
 * — the equation above, a cell a term, the terms combined into the result beside
 * the source's own reported number, which it must match.
 *
 * CHAIN: an input run through KNOWN operations (src/literal/ops.ts), every output
 * computed for real at build time — the input, then each step's output, a cell
 * each: a picture or a matrix as itself, vectors as bars over their bins on each
 * cell's own scale; a `compare` adds the other side's cell.
 *
 * WHAT IS EXACT. The ops and terms, with the values the source states (the gate
 * grounds each in its role, src/plan/coverage.ts). WHAT IS EXAMPLE. A chain's
 * input when it is a picture (always: a picture is never the method's own
 * intermediate) or a vector the source does not print, and any `condition`;
 * the scene then carries the example tag, and prints no computed value. No
 * cell invents a number: no ticks, no values on example data.
 */

import { evaluate, parseFormula } from "../formula.js";
import {
  degrade,
  fromRows,
  fromVector,
  type OpStep,
  runChain,
  statOf,
  type Tensor,
  tensor,
} from "../ops.js";
import type { MechanismResult, Prim, Raster } from "./common.js";
import { fitBox, shiftPrim, TYPE, wrapBy } from "./common.js";
import { num, opStepOf, plain } from "./read.js";
import { rasterOf, sharedScale, textLines, type VerbCtx, withPushRoom } from "./stage.js";
import { texBox } from "./tex.js";

type Ctx = VerbCtx<"operate">;

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
  if (c.lit.terms) return withPushRoom(terms)(c);
  const d = c.lit;
  for (const slot of ["input", "output"])
    if (!c.labels[slot]?.trim()) throw new Error(`operate: a chain needs slot "${slot}"`);
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
  const r = withPushRoom((cc: Ctx) => ({ ...chainCells(cc, lay, layout), vars: {} }))(c);
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

/* ------------------------------------------------------------- the cells */

/** One cell of a chain: what it is titled and what it shows. */
interface Cell {
  title: string;
  /** The title in the output's own words (the `output` slot, with its computed vars). */
  slot?: "input" | "output";
  tensors: Tensor[];
  /** Its step: revealed then; the input is there from the start. */
  at: number;
  last?: boolean;
}

const CELL_GAP_X = 64;
const CELL_GAP_Y = 28;
const CELL_LINE = Math.round(TYPE.label * 1.18);

/**
 * A chain in the approved operate look (1-operate.png): the parameters the
 * source states as chips on top, then one cell per stage — the input, each
 * step's output, and what it is compared with — joined by arrows in reading
 * order, each output revealed on its sentence, the last framed in the accent.
 * A picture or a matrix is drawn as itself; vectors as bars over their bins,
 * on each cell's own scale (display scaling, never printed).
 */
function chainCells(
  c: Ctx,
  L: Lay,
  layout: "map" | "profile" | "grid",
): Omit<MechanismResult, "vars"> {
  const { width: W, height: H } = c.region;
  const d = c.lit;
  const m = c.measure;
  const n = L.steps.length;
  const cells: Cell[] = [{ title: "", slot: "input", tensors: L.main.slice(0, L.ins), at: 0 }];
  if (d.condition && d.compare !== "condition")
    cells.push({ title: c.labels.condition ?? "", tensors: L.conditioned ?? [], at: 0 });
  d.chain.forEach((s, k) => {
    cells.push({
      title: s.label,
      ...(k === n - 1 ? { slot: "output" as const, last: true } : {}),
      tensors: [L.main[L.ins + k] as Tensor],
      at: k + 1,
    });
  });
  if (L.other)
    cells.push({
      title: (d.compare === "condition" ? c.labels.condition : c.labels.alt) ?? "",
      tensors: [L.other],
      at: n + 1,
    });

  // The chips: every parameter the chain states, with the step it belongs to.
  const chips = d.chain.flatMap((s) =>
    s.params.map((p) => ({ lead: `${p.symbol ?? p.name} =`, value: p.value, what: s.label })),
  );
  const sp = m(" ", TYPE.label) || TYPE.label * 0.3;
  const chipH = 64;
  const chipWs = chips.map(
    (q) => m(q.lead, TYPE.label) + m(q.value, TYPE.label) + m(q.what, TYPE.label) + 2 * sp + 48,
  );
  const chipRows: number[][] = [];
  let rowW = W + 1;
  chipWs.forEach((w, i) => {
    if (rowW + w + 16 > W) {
      chipRows.push([]);
      rowW = 0;
    }
    chipRows.at(-1)?.push(i);
    rowW += w + 16;
  });
  if (chipWs.some((w) => w > W))
    throw new Error(
      "operate: a parameter's chip is wider than the scene; shorten its step's label",
    );
  const chipsH = chipRows.length ? chipRows.length * (chipH + 14) + 22 : 0;

  // The cells' grid: the column count that gives each cell the most room.
  const aspect =
    layout === "profile"
      ? 1.5
      : Math.max(0.5, Math.min(2.5, (L.main[0] as Tensor).w / (L.main[0] as Tensor).h));
  // Two vectors in: their names, in their tones, on a second line of the input's title.
  const named = layout === "profile" && L.names.length > 1;
  const titleLines = (cell: Cell, w: number) =>
    cell.slot
      ? cell.slot === "input" && named
        ? 2
        : 1
      : wrapBy(cell.title, TYPE.label, w, m).length;
  let best = { cols: 1, w: 0, h: 0, titleH: 0 };
  for (let cols = 1; cols <= cells.length; cols++) {
    const rows = Math.ceil(cells.length / cols);
    let w = (W - (cols - 1) * CELL_GAP_X) / cols;
    const lines = Math.max(...cells.map((cell) => titleLines(cell, w)));
    const titleH = lines * CELL_LINE + 10;
    const hRoom = (H - chipsH - (rows - 1) * CELL_GAP_Y) / rows - titleH;
    let h = w / aspect;
    if (h > hRoom) {
      h = hRoom;
      w = h * aspect;
    }
    if (lines <= 2 && w * h > best.w * best.h) best = { cols, w, h, titleH };
  }
  if (best.h < 100)
    throw new Error(
      `operate: ${cells.length} cells leave each ${Math.round(best.h)}px tall; draw fewer steps, or state fewer parameters`,
    );
  const { cols, w: cw, h: ch, titleH } = best;
  const rows = Math.ceil(cells.length / cols);
  const gridW = cols * cw + (cols - 1) * CELL_GAP_X;
  const ox = (W - gridW) / 2;
  const oy =
    chipsH + Math.max(0, (H - chipsH - (rows * (titleH + ch) + (rows - 1) * CELL_GAP_Y)) / 2);

  const prims: Prim[] = [];
  chipRows.forEach((row, r) => {
    let x = 0;
    for (const i of row) {
      const q = chips[i] as (typeof chips)[number];
      const y = r * (chipH + 14);
      prims.push({
        p: "rect",
        x,
        y,
        w: chipWs[i] as number,
        h: chipH,
        fill: "panel",
        role: "rule",
        width: 2,
        radius: 14,
      });
      let tx = x + 24;
      const ty = y + (chipH - TYPE.label * 1.18) / 2;
      for (const [s, role, weight] of [
        [q.lead, "fg", 500],
        [q.value, "b", 700],
        [q.what, "muted", 500],
      ] as const) {
        prims.push({
          p: "text",
          x: tx,
          y: ty,
          size: TYPE.label,
          role,
          anchor: "start",
          weight,
          text: s,
        });
        tx += m(s, TYPE.label) + sp;
      }
      x += (chipWs[i] as number) + 16;
    }
  });

  const rasters: Record<string, Raster> = {};
  // A comparison's two sides share one display scale: a weaker map must look weaker.
  const fin = L.main.at(-1) as Tensor;
  const shared =
    L.other && fin.c === 1 && L.other.c === 1 ? sharedScale([fin, L.other]) : undefined;
  const bins = d.bins;
  const binsFit = bins.length > 0 && bins.every((b) => m(b, TYPE.label) <= cw / bins.length - 6);
  cells.forEach((cell, i) => {
    const x = ox + (i % cols) * (cw + CELL_GAP_X);
    const y = oy + Math.floor(i / cols) * (titleH + ch + CELL_GAP_Y);
    const at = cell.at ? { at: Math.min(12, cell.at) } : {};
    // Its title, then the cell: framed from the start, filled on its step.
    if (cell.slot)
      prims.push({
        p: "text",
        x,
        y,
        size: TYPE.label,
        role: cell.last ? "accent" : "fg",
        anchor: "start",
        slot: cell.slot,
      });
    else prims.push(...textLines(wrapBy(cell.title, TYPE.label, cw, m), x, y, TYPE.label, "muted"));
    const cy = y + titleH;
    prims.push({
      p: "rect",
      x,
      y: cy,
      w: cw,
      h: ch,
      fill: "panel",
      role: cell.last ? "accent" : "rule",
      width: cell.last ? 4 : 2,
      radius: 12,
      cam: true,
    });
    if (i > 0 && i % cols)
      prims.push({
        p: "text",
        x: x - CELL_GAP_X / 2,
        y: cy + (ch - TYPE.label * 1.18) / 2,
        size: TYPE.label,
        role: "b",
        anchor: "middle",
        text: "→",
        cam: true,
        ...at,
      });
    if (layout === "profile") {
      // Bars over the bins, the cell's vectors side by side, on the cell's own scale.
      const vs = cell.tensors.map((t) => Array.from({ length: t.w }, (_, b) => t.d[b] as number));
      const lo = Math.min(0, ...vs.flat());
      const hi = Math.max(1e-9, ...vs.flat());
      const nb = vs[0]?.length ?? 0;
      const pad = 12;
      const labelH = binsFit ? CELL_LINE : 0;
      const base = cy + ch - pad - labelH - ((0 - lo) / (hi - lo)) * (ch - 2 * pad - labelH);
      const slot = (cw - 2 * pad) / nb;
      const bw = (slot * 0.7) / vs.length;
      vs.forEach((v, j) => {
        v.forEach((val, b) => {
          const top = cy + ch - pad - labelH - ((val - lo) / (hi - lo)) * (ch - 2 * pad - labelH);
          prims.push({
            p: "rect",
            x: x + pad + b * slot + slot * 0.15 + j * bw,
            y: Math.min(top, base),
            w: bw,
            h: Math.max(2, Math.abs(base - top)),
            fill: cell.at === 0 ? (j ? "b" : "a") : cell.last ? "accent" : "a",
            cam: true,
            ...at,
          });
        });
      });
      if (binsFit)
        bins.forEach((b, k) => {
          prims.push({
            p: "text",
            x: x + pad + (k + 0.5) * slot,
            y: cy + ch - pad - labelH,
            size: TYPE.label,
            role: "muted",
            anchor: "middle",
            text: b,
            cam: true,
          });
        });
    } else {
      const t = cell.tensors[0] as Tensor;
      const key = `c${i}`;
      rasters[key] = rasterOf(t, cell.last || i === cells.length - 1 ? shared : undefined);
      const B = fitBox(t.w, t.h, x + 4, cy + 4, cw - 8, ch - 8);
      prims.push({
        p: "image",
        x: B.x,
        y: B.y,
        w: B.w,
        h: B.h,
        layer: key,
        cam: true,
        ...(layout === "grid" ? { pixelated: true } : {}),
        ...at,
      });
    }
  });
  // Two vectors in: their names, in their tones, under the input's title.
  if (named) {
    let x = ox;
    L.names.forEach((nm, j) => {
      prims.push({
        p: "text",
        x,
        y: oy + CELL_LINE,
        size: TYPE.label,
        role: j ? "b" : "a",
        anchor: "start",
        weight: 700,
        text: nm,
      });
      x += m(nm, TYPE.label) + 2 * sp;
    });
  }
  return {
    rasters,
    frames: [{ id: "chain", prims, vars: {} }],
    data: { thumb: `c${cells.length - 1}` },
  };
}

/* ------------------------------------------------------------------ terms */

/**
 * THE APPROVED LOOK (.planning/designs/2026-10-12-verb-looks/1-operate.png): a
 * stated formula evaluated term by term. On top the source's own equation and
 * the values it states, each a chip; then one cell a term — its value computed
 * for real from those values, the cell lit by it — joined by `between` (×α);
 * then the terms combined into the result, large, beside the source's own
 * number it matches. Every number is a consequence of stated values, so the
 * scene prints them; one that does not match the source is refused, at plan.
 */
const TEX_PX = 64;
const TEX_MIN_PX = 58;
const CELL_MAX = 226;
const RESULT_PX = 96;

function terms(c: Ctx): MechanismResult {
  const d = c.lit;
  const t = d.terms as NonNullable<typeof d.terms>;
  const { width: W, height: H } = c.region;
  const m = c.measure;
  // The values the terms run on, by name and by symbol.
  const env: Record<string, number> = {};
  for (const g of d.given) {
    const v = num(g.value, `given "${g.name}"`);
    env[g.name] = v;
    if (g.symbol) env[g.symbol] = v;
  }
  const to = /^-?\d+$/.test(t.to.trim()) ? Number(t.to) : env[t.to.trim()];
  if (to === undefined || !Number.isInteger(to))
    throw new Error(
      `operate terms: \`to\` is "${t.to}", neither a whole number nor a given's name`,
    );
  const n = to - t.from + 1;
  if (n < 2 || n > 9) throw new Error(`operate terms draws 2–9 cells, got ${n}`);
  const ast = parseFormula(t.term);
  const vals = Array.from({ length: n }, (_, i) => {
    const v = evaluate(ast, { ...env, k: t.from + i });
    if (!Number.isFinite(v)) throw new Error(`operate terms: term ${i + 1} is not a finite number`);
    return v;
  });
  const result =
    t.combine === "sum" ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a * b, 1);
  // Printed at the source's own precision when it reports the result, else two places.
  const places = t.reported ? (t.reported.split(".")[1]?.length ?? 0) : 2;
  const fmt = (v: number) => (vals.every(Number.isInteger) ? String(v) : v.toFixed(2));
  const res = result.toFixed(places);
  if (t.reported) {
    const rep = num(t.reported, "operate terms `reported`");
    if (Math.abs(result - rep) > 0.5 * 10 ** -places + 1e-9)
      throw new Error(
        `operate terms: the terms come to ${result.toFixed(places + 2)}, and the source reports ${t.reported}: they are not the source's terms or values`,
      );
    if (!c.labels.match?.trim())
      throw new Error("operate terms: a `reported` result needs the `match` slot");
  }
  if (!c.labels.cell?.trim())
    throw new Error("operate terms needs the `cell` slot: each cell's title, with {n}");

  const prims: Prim[] = [];
  // Top: the equation, and the given values as chips beside it — or, when the two
  // do not fit across, in a row under it, the equation at the least size whose
  // scripts still read (KaTeX sets them at 0.7: 58px keeps them over 40).
  const chipH = 72;
  // A chip's three pieces, a space apart: an SVG text drops its own edge spaces.
  const chipText = (g: (typeof d.given)[number]) =>
    [`${g.symbol ?? g.name} =`, g.value, g.what] as const;
  const sp = m(" ", TYPE.label) || TYPE.label * 0.3;
  const chipWs = d.given.map(
    (g) => chipText(g).reduce((a, s) => a + m(s, TYPE.label), 0) + 2 * sp + 52,
  );
  const chipW = Math.max(0, ...chipWs);
  const wide = d.equation?.trim() ? texBox(d.equation, TEX_PX, m) : undefined;
  const across = !wide || !d.given.length || wide.w + 72 + chipW <= W;
  const eqPx = across ? TEX_PX : TEX_MIN_PX;
  const eq = d.equation?.trim() ? texBox(d.equation, eqPx, m) : undefined;
  const eqW = eq?.w ?? 0;
  if (eqW > W)
    throw new Error(
      `operate terms: the equation is ${eqW}px wide and the scene holds ${Math.round(W)}px; draw a shorter one the source prints`,
    );
  const chipsRow =
    d.given.reduce((a, _, i) => a + (chipWs[i] as number), 0) + 16 * (d.given.length - 1);
  if (!across && chipsRow > W)
    throw new Error(
      `operate terms: the given values' chips are ${Math.round(chipsRow)}px wide in a row: give shorter \`what\`s`,
    );
  const stackH = d.given.length * (chipH + 16) - 16;
  const topH = across
    ? Math.max(eq?.h ?? 0, stackH)
    : (eq?.h ?? 0) + (d.given.length ? 16 + chipH : 0);
  const gap = eq && d.given.length ? 72 : 0;
  if (eq && d.equation)
    prims.push({
      p: "tex",
      x: 0,
      y: across ? (topH - eq.h) / 2 : 0,
      w: eq.w,
      h: eq.h,
      size: eqPx,
      tex: d.equation,
      role: "fg",
    });
  d.given.forEach((g, i) => {
    const x = across ? eqW + gap : chipWs.slice(0, i).reduce((a, w) => a + w + 16, 0);
    const y = across ? (topH - stackH) / 2 + i * (chipH + 16) : (eq?.h ?? 0) + 16;
    const w = across ? chipW : (chipWs[i] as number);
    const [lead, value, what] = chipText(g);
    prims.push({
      p: "rect",
      x,
      y,
      w,
      h: chipH,
      fill: "panel",
      role: "rule",
      width: 2,
      radius: 14,
    });
    let tx = x + 26;
    const ty = y + (chipH - TYPE.label * 1.18) / 2;
    for (const [s, role, weight] of [
      [lead, "fg", 500],
      [value, "b", 700],
      [what, "muted", 500],
    ] as const) {
      prims.push({
        p: "text",
        x: tx,
        y: ty,
        size: TYPE.label,
        role,
        anchor: "start",
        weight,
        text: s,
      });
      tx += m(s, TYPE.label) + sp;
    }
  });

  // The cells, one a term, joined by `between`.
  const between = t.between?.trim() ?? "";
  const opW = between ? m(between, TYPE.label) + 26 : 24;
  const labelH = 58;
  const resultH = RESULT_PX * 1.15;
  const capLines = c.labels.cells?.trim() ? wrapBy(c.labels.cells, TYPE.label, W, m) : [];
  const capH = capLines.length * Math.round(TYPE.label * 1.25);
  const room = H - topH - 48 - labelH - 24 - capH - 40 - resultH;
  const cell = Math.floor(Math.min(CELL_MAX, (W - (n - 1) * opW) / n, room));
  if (cell < 110)
    throw new Error(`operate terms: ${n} cells come to ${cell}px each here; draw fewer terms`);
  const rowW = n * cell + (n - 1) * opW;
  // A cell's number at the headline size, or the body size when the cell is small.
  const valuePx =
    Math.max(...vals.map((v) => m(fmt(v), TYPE.headline))) + 24 <= cell ? TYPE.headline : TYPE.body;
  const x0 = 0;
  const cy = topH + 48 + labelH;
  const top = Math.max(...vals.map((v) => Math.abs(v))) || 1;
  vals.forEach((v, i) => {
    const x = x0 + i * (cell + opW);
    const at = Math.min(12, i + 1);
    prims.push(
      {
        p: "text",
        x: x + cell / 2,
        y: cy - labelH,
        size: TYPE.label,
        role: "muted",
        anchor: "middle",
        slot: "cell",
        vars: { n: i + 1 },
      },
      { p: "rect", x, y: cy, w: cell, h: cell, role: "a", width: 3, radius: 22, cam: true },
      {
        p: "rect",
        x,
        y: cy,
        w: cell,
        h: cell,
        heat: 0.15 + 0.75 * (Math.abs(v) / top),
        radius: 22,
        cam: true,
        at,
      },
      { p: "rect", x, y: cy, w: cell, h: cell, role: "a", width: 3, radius: 22, cam: true, at },
      {
        p: "text",
        x: x + cell / 2,
        y: cy + (cell - valuePx * 1.18) / 2,
        size: valuePx,
        role: "auto",
        anchor: "middle",
        weight: 700,
        text: fmt(v),
        cam: true,
        at,
      },
    );
    if (i && between)
      prims.push({
        p: "text",
        x: x - opW / 2,
        y: cy + (cell - TYPE.label * 1.18) / 2,
        size: TYPE.label,
        role: "b",
        anchor: "middle",
        text: between,
        cam: true,
        at,
      });
  });
  let y = cy + cell + 24;
  for (const l of capLines) {
    prims.push({ p: "text", x: x0, y, size: TYPE.label, role: "muted", anchor: "start", text: l });
    y += Math.round(TYPE.label * 1.25);
  }
  // The terms combined, then the result, then the source's own number.
  y += 40;
  const joiner = t.combine === "sum" ? " + " : " × ";
  const resW = m(res, RESULT_PX) + 40;
  const matchW = t.reported ? m(c.labels.match ?? "", TYPE.label) + 56 : 0;
  const lineRoom = W - resW - (matchW ? matchW + 40 : 0) - 40;
  const all = vals.map(fmt);
  let line = `${all.join(joiner)} =`;
  if (m(line, TYPE.label) > lineRoom) line = `${all[0]}${joiner}…${joiner}${all.at(-1)} =`;
  if (m(line, TYPE.label) > lineRoom)
    throw new Error(
      "operate terms: the result line does not fit beside its result; a shorter `match`",
    );
  const lineW = m(line, TYPE.label);
  const base = y + resultH * 0.72;
  prims.push(
    {
      p: "text",
      x: x0,
      y: base - TYPE.label * 0.9,
      size: TYPE.label,
      role: "muted",
      anchor: "start",
      text: line,
      at: Math.min(12, n + 1),
    },
    {
      p: "text",
      x: x0 + lineW + 40,
      y: base - RESULT_PX * 0.9,
      size: RESULT_PX,
      role: "a",
      anchor: "start",
      weight: 700,
      text: res,
      cam: true,
      at: Math.min(12, n + 2),
    },
  );
  if (t.reported) {
    const mx = x0 + lineW + 40 + resW;
    const mh = 72;
    prims.push(
      {
        p: "rect",
        x: mx,
        y: base - mh + 10,
        w: matchW,
        h: mh,
        role: "d",
        width: 2,
        radius: 14,
        at: Math.min(12, n + 3),
      },
      {
        p: "text",
        x: mx + 28,
        y: base - mh + 10 + (mh - TYPE.label * 1.18) / 2,
        size: TYPE.label,
        role: "d",
        anchor: "start",
        slot: "match",
        at: Math.min(12, n + 3),
      },
    );
  }
  // Centred down the scene; across, the wider of the top and the row sets the left edge.
  const contentH = y + resultH;
  const dy = Math.max(0, (H - contentH) / 2);
  const topW = across ? eqW + gap + chipW : Math.max(eqW, chipsRow);
  const dx = Math.max(0, (W - Math.max(rowW, topW)) / 2);
  return {
    rasters: {},
    frames: [{ id: "terms", prims: prims.map((q) => shiftPrim(q, dx, dy)), vars: {} }],
    data: { result: res },
    vars: {},
  };
}
