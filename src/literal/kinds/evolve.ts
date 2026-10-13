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
 * INPUT. `values` the source prints (exact), or `from` an earlier operate
 * beat: its computed tiles stream in as pictures, each reduced to its
 * mean, variance or std (example material: the picture is). No value computed
 * here is ever printed.
 */
import { LITERAL_RULES, type LiteralOpDoc } from "../../types.js";
import { evaluate, parseFormula } from "../formula.js";
import { alphaBars, seededNormals, statOf, type Tensor, tensor } from "../ops.js";
import type { Frame, MechanismResult, Prim, Raster } from "./common.js";
import { type Role, TYPE, wrapBy } from "./common.js";
import { num, paramRecord } from "./read.js";
import { placeholderPicture, rasterOf, type VerbCtx, withPushRoom } from "./stage.js";

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
  throw new Error(`evolve: "${from}" computed nothing to stream (name an operate beat)`);
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
  if (c.lit.rule === "noise") return withPushRoom(noise)(c);
  if (c.lit.rule === "trace") return withPushRoom(trace)(c);
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
  return withPushRoom((cc: Ctx) => computedRows(cc, run, tiles))(c);
}

/** A slot's words, or a refusal naming what needs it. */
function need(c: Ctx, slot: string, what: string): string {
  const t = c.labels[slot]?.trim();
  if (!t) throw new Error(`evolve: ${what} needs the \`${slot}\` slot`);
  return t;
}

/**
 * A computed run as rows: each step its input (the value the source prints, or
 * the tile streaming in), then the state as a bar on the run's own range — never
 * its number. A step whose state reaches the threshold has its bar in the
 * threshold's tone, and a tick marks the threshold; a phase names its first row;
 * a frozen step's bar is dimmed.
 */
function computedRows(c: Ctx, run: Run, tiles: Tensor[]): MechanismResult {
  const d = c.lit;
  const n = run.xs.length;
  const thetas = run.theta.filter((t): t is number => t !== undefined);
  const vals = [...run.s, ...thetas];
  const lo = Math.min(0, ...vals);
  const hi = Math.max(lo + 1e-9, ...vals);
  const f = (v: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const frozen = (k: number) => {
    let z = false;
    for (const p of d.phases) if (k >= p.from) z = p.freeze;
    return z;
  };
  const tags: RowTag[] = [
    { tag: "x", label: need(c, "state", "the inputs' legend"), tone: "b" },
    { tag: "s", label: need(c, "trace", "the state's bar"), tone: "accent" },
    ...(thetas.length
      ? [{ tag: "th", label: need(c, "threshold", "a threshold"), tone: "c" as const }]
      : []),
  ];
  const phaseAt = new Map(d.phases.map((p) => [p.from, p.label]));
  const rows: Row[] = run.xs.map((_, k) => {
    const th = run.theta[k];
    return {
      ...(phaseAt.has(k) ? { lead: phaseAt.get(k) } : {}),
      parts: tiles.length ? [] : [{ text: d.input?.values[k]?.value ?? "", tag: "x" }],
      ...(tiles.length ? { image: `t${k}` } : {}),
      bars: [
        {
          value: f(run.s[k] as number),
          tag: run.fired[k] ? "th" : "s",
          ...(th !== undefined ? { mark: { at: f(th), tag: "th" } } : {}),
          ...(frozen(k) ? { dim: true } : {}),
        },
      ],
    };
  });
  const rasters: Record<string, Raster> = {};
  tiles.forEach((t, k) => {
    rasters[`t${k}`] = rasterOf(t);
  });
  const r = rowsLook(c, rows, tags, d.note, {
    rasters,
    aspect: tiles[0] ? tiles[0].w / tiles[0].h : 1,
  });
  return { ...r, data: { thumb: tiles.length ? `t${n - 1}` : undefined } };
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
  // Each checkpoint a row: the noised picture, then the signal's share √ᾱ and
  // the noise's √(1−ᾱ) as two bars.
  const share = (t: number) => (t === 0 ? 1 : (abar[t - 1] as number));
  const r = rowsLook(
    c,
    ts.map((t, k) => ({
      parts: [],
      image: `x${k}`,
      bars: [
        { value: Math.sqrt(share(t)), tag: "sig" },
        { value: Math.sqrt(1 - share(t)), tag: "noi" },
      ],
    })),
    [
      { tag: "sig", label: need(c, "trace", "the signal's bar"), tone: "a" },
      { tag: "noi", label: need(c, "noise", "the noise's bar"), tone: "b" },
    ],
    d.note,
    { rasters, aspect: img.w / img.h },
  );
  return { ...r, data: { thumb: `x${K - 1}` } };
}

/* ------------------------------------------------------------------- rows */

/**
 * THE ROW LOOK (the approved evolve, .planning/designs/2026-10-12-verb-looks/
 * 2-evolve.png): one row per step, its number, what it carries on from (muted)
 * and its parts in their tags' tones; the legend and the source's note beside.
 * One frame per step: the step's row is lit on a panel, its parts arriving run
 * by run (a struck part is crossed out as it arrives), the rows before it stay
 * at ROW_DONE, the rows after it show only their numbers. Frames crossfade, so
 * the lit row walks down the trace; each frame's push leans in on the lit row
 * and `settle`s back to rest before the next, or every row would jump between
 * two frames and break that walk. Too many
 * rows for the height: a window of them, the lit one second from the bottom. A
 * short trace is spread down the scene, as a chain's column is: the deck's gate
 * wants the content to span the region (src/verify/fill.ts).
 */
export interface RowTag {
  tag: string;
  label: string;
  tone: Role;
  strike?: boolean;
}
export interface Row {
  lead?: string;
  parts: ReadonlyArray<{ text: string; tag: string }>;
  /** A picture at the row's start: a raster layer. */
  image?: string;
  /** Bars after the words, each 0..1 of its rail in its tag's tone; a tick at `mark`; `dim` when frozen. */
  bars?: ReadonlyArray<{
    value: number;
    tag: string;
    mark?: { at: number; tag: string };
    dim?: boolean;
  }>;
}

const ROW_SIZE = TYPE.label;
const ROW_H_MAX = 80;
const ROW_H_MIN = 56;
const ROW_GAP = 10;
const ROW_PAD = 24;
const ROW_DONE = 0.6;
const ROW_SPREAD = 0.9;
const LEAD_SHARE = 0.35;
const SIDE_GAP = 56;
const SWATCH = 38;
const BAR_H = 18;
const BAR_GAP = 8;
const BAR_MIN = 160;

export function rowsLook(
  c: Ctx,
  rows: readonly Row[],
  tags: readonly RowTag[],
  note: readonly string[],
  opts: { rasters?: Record<string, Raster>; aspect?: number } = {},
): MechanismResult {
  const { width: W, height: H } = c.region;
  const n = rows.length;
  const byTag = new Map(tags.map((t) => [t.tag, t]));
  const tagOf = (tag: string, i: number) => {
    const t = byTag.get(tag);
    if (!t)
      throw new Error(`evolve: step ${i + 1} names the tag "${tag}", which \`tags\` does not name`);
    return t;
  };
  const m = c.measure;
  const space = m(" ", ROW_SIZE) || ROW_SIZE * 0.3;
  const pictures = rows.some((r) => r.image);
  const aspect = opts.aspect ?? 1;
  // The side: the lit step's picture large (when the rows carry pictures), the
  // legend, then the note under a rule.
  const sideW = Math.round(
    Math.min(520, Math.max(380, ...tags.map((t) => SWATCH + 20 + m(t.label, ROW_SIZE)))),
  );
  const bigH = pictures ? Math.round(Math.min(sideW / aspect, H * 0.45)) : 0;
  const bigW = Math.round(bigH * aspect);
  const legendY = bigH ? bigH + 30 : 0;
  const noteLines = note.flatMap((l) => wrapBy(l, ROW_SIZE, sideW, m));
  const LINE = Math.round(ROW_SIZE * 1.35);
  const sideH =
    legendY + tags.length * (SWATCH + 34) + (noteLines.length ? 30 + noteLines.length * LINE : 0);
  if (sideH > H)
    throw new Error(
      `evolve: the legend and note are ${sideH}px tall and the scene holds ${H}px: a shorter \`note\``,
    );
  const rowsW = W - sideW - SIDE_GAP;
  const rowH = Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, Math.floor((H + ROW_GAP) / n) - ROW_GAP));
  const idxW = m(String(n), ROW_SIZE);
  const thumbH = rowH - 12;
  const thumbW = Math.round(thumbH * aspect);
  const textX = ROW_PAD + idxW + 22 + (pictures ? thumbW + 16 : 0);
  const room = rowsW - textX - ROW_PAD;
  // The row's words laid left to right.
  const laid = rows.map((r, i) => {
    let x = 0;
    const parts = r.parts.map((p) => {
      const t = tagOf(p.tag, i);
      const w = m(p.text, ROW_SIZE);
      const at = { x, w, text: p.text, tag: t };
      x += w + space;
      return at;
    });
    const partsW = Math.max(0, x - space);
    if (partsW > room)
      throw new Error(
        `evolve: step ${i + 1}'s parts are ${Math.round(partsW)}px wide and a row holds ${Math.round(room)}px: split the step, or give fewer words`,
      );
    // The lead keeps its last whole words, at most LEAD_SHARE of the row: what the
    // step carries on from, not the whole sentence so far.
    const words = (r.lead?.trim() ?? "").replace(/^…\s*/, "").split(/\s+/).filter(Boolean);
    const cap = Math.min(room - partsW, room * LEAD_SHARE);
    let keep = words.length;
    const text = (k: number) =>
      (k < words.length ? "… " : "") + words.slice(words.length - k).join(" ");
    while (keep > 0 && m(text(keep), ROW_SIZE) + space > cap) keep--;
    const lead = keep ? text(keep) : "";
    const leadW = lead ? m(lead, ROW_SIZE) + space : 0;
    return { lead, end: leadW + partsW, parts: parts.map((q) => ({ ...q, x: q.x + leadW })) };
  });
  // The bars, one column for every row: after the widest row's words.
  const bars = rows.some((r) => r.bars?.length);
  const wordsW = Math.max(0, ...laid.map((l) => l.end));
  const barX = textX + (wordsW ? wordsW + 2 * space : 0);
  const barW = rowsW - ROW_PAD - barX;
  if (bars && barW < BAR_MIN)
    throw new Error(
      `evolve: the rows' words leave ${Math.round(barW)}px for the bars: shorter words`,
    );
  const fit = Math.max(2, Math.floor((H + ROW_GAP) / (rowH + ROW_GAP)));
  const shown = Math.min(n, fit);
  const pitch = Math.max(rowH + ROW_GAP, shown > 1 ? (ROW_SPREAD * H - rowH) / (shown - 1) : 0);
  const top = Math.max(0, (H - ((shown - 1) * pitch + rowH)) / 2);

  const sx = rowsW + SIDE_GAP;
  const side: Prim[] = [];
  tags.forEach((t, i) => {
    const y = legendY + i * (SWATCH + 34);
    side.push(
      { p: "rect", x: sx, y, w: SWATCH, h: SWATCH, fill: t.tone, radius: 8 },
      {
        p: "text",
        x: sx + SWATCH + 20,
        y: y + (SWATCH - ROW_SIZE * 1.18) / 2,
        size: ROW_SIZE,
        role: "fg",
        anchor: "start",
        text: t.label,
      },
    );
  });
  if (noteLines.length) {
    let y = legendY + tags.length * (SWATCH + 34) + 4;
    side.push({ p: "rect", x: sx, y, w: sideW, h: 2, fill: "rule" });
    y += 28;
    for (const l of noteLines) {
      side.push({ p: "text", x: sx, y, size: ROW_SIZE, role: "muted", anchor: "start", text: l });
      y += LINE;
    }
  }

  const frames: Frame[] = rows.map((row, k) => {
    // The window: the lit row second from the bottom, inside the trace.
    const first = Math.max(0, Math.min(n - shown, k - shown + 2));
    const prims: Prim[] = [...side];
    if (row.image)
      prims.push({ p: "image", x: sx, y: 0, w: bigW, h: bigH, layer: row.image, at: 1 });
    for (let j = first; j < first + shown; j++) {
      const y = top + (j - first) * pitch;
      const ty = y + (rowH - ROW_SIZE * 1.18) / 2;
      if (j === k)
        prims.push({
          p: "rect",
          x: 0,
          y,
          w: rowsW,
          h: rowH,
          fill: "panel",
          role: "rule",
          width: 3,
          radius: 14,
          cam: true,
        });
      prims.push({
        p: "text",
        x: ROW_PAD + idxW,
        y: ty,
        size: ROW_SIZE,
        role: "muted",
        anchor: "end",
        text: String(j + 1),
        cam: true,
      });
      if (j > k) continue;
      const R = rows[j] as Row;
      const L = laid[j] as (typeof laid)[number];
      const done = j < k ? { opacity: ROW_DONE } : {};
      const lit = (step: number) => (j === k ? { at: Math.min(12, step) } : {});
      if (R.image)
        prims.push({
          p: "image",
          x: textX - thumbW - 16,
          y: y + 6,
          w: thumbW,
          h: thumbH,
          layer: R.image,
          cam: true,
          ...done,
          ...lit(1),
        });
      if (L.lead)
        prims.push({
          p: "text",
          x: textX,
          y: ty,
          size: ROW_SIZE,
          role: "muted",
          anchor: "start",
          text: L.lead,
          cam: true,
          ...done,
        });
      // The lit row's parts arrive run by run: consecutive parts of one tag together.
      let step = 0;
      L.parts.forEach((q, i) => {
        if (i === 0 || L.parts[i - 1]?.tag !== q.tag) step++;
        prims.push({
          p: "text",
          x: textX + q.x,
          y: ty,
          size: ROW_SIZE,
          role: q.tag.tone,
          anchor: "start",
          text: q.text,
          cam: true,
          ...done,
          ...lit(step),
        });
        if (q.tag.strike)
          prims.push({
            p: "line",
            x1: textX + q.x,
            y1: ty + ROW_SIZE * 0.62,
            x2: textX + q.x + q.w,
            y2: ty + ROW_SIZE * 0.62,
            role: q.tag.tone,
            width: 4,
            cam: true,
            ...done,
            ...(j === k ? { at: Math.min(12, step), wipe: true } : {}),
          });
      });
      // Then its bars, drawn out from the left.
      const bs = R.bars ?? [];
      const bh = bs.length * BAR_H + (bs.length - 1) * BAR_GAP;
      bs.forEach((bar, q) => {
        const by = y + (rowH - bh) / 2 + q * (BAR_H + BAR_GAP);
        const t = tagOf(bar.tag, j);
        prims.push(
          { p: "rect", x: barX, y: by, w: barW, h: BAR_H, fill: "rule", radius: 4, cam: true },
          {
            p: "rect",
            x: barX,
            y: by,
            w: Math.max(3, bar.value * barW),
            h: BAR_H,
            fill: t.tone,
            radius: 4,
            cam: true,
            ...(bar.dim ? { opacity: 0.45 } : done),
            ...(j === k ? { at: Math.min(12, step + 1), wipe: true } : {}),
          },
        );
        if (bar.mark)
          prims.push({
            p: "line",
            x1: barX + bar.mark.at * barW,
            y1: by - 8,
            x2: barX + bar.mark.at * barW,
            y2: by + BAR_H + 8,
            role: tagOf(bar.mark.tag, j).tone,
            width: 4,
            cam: true,
            ...done,
          });
      });
    }
    // The push leans in on the lit row and is back at rest before the next frame.
    const litY = top + (k - first) * pitch + rowH / 2;
    return {
      id: `s${k}`,
      prims,
      vars: {},
      settle: true,
      focus: { x: rowsW / 2, y: litY },
    };
  });
  return { rasters: opts.rasters ?? {}, frames, data: {}, vars: {} };
}

/** The source's own steps, as rows. */
function trace(c: Ctx): MechanismResult {
  const d = c.lit;
  if (d.tags.length < 1 || d.tags.length > 4)
    throw new Error(`evolve trace tags its parts with 1–4 \`tags\`, got ${d.tags.length}`);
  if (new Set(d.tags.map((t) => t.tag)).size !== d.tags.length)
    throw new Error("evolve trace: two `tags` share a name");
  // A figure's trace is read off it by `plan` (src/plan/locate.ts): at plan time,
  // before that, six rows stand in for it.
  const steps =
    d.picture && !d.steps.length && c.dry
      ? Array.from({ length: 6 }, () => ({
          parts: d.tags.map((t) => ({ text: "a few words", tag: t.tag })),
        }))
      : d.steps;
  if (d.picture && !steps.length)
    throw new Error(
      "evolve trace: the steps of a figure's trace are read off it by `decksmith plan`; this one has none",
    );
  if (steps.length < 2 || steps.length > MAX_STEPS)
    throw new Error(`evolve trace steps through 2–${MAX_STEPS} rows, got ${steps.length}`);
  steps.forEach((st, i) => {
    if (!st.parts.length || st.parts.some((p) => !p.text.trim()))
      throw new Error(`evolve trace: step ${i + 1} has an empty part, or none`);
  });
  return rowsLook(c, steps, d.tags, d.note);
}
