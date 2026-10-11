/**
 * flow — data passing through stages, in three forms.
 *
 * CHAIN: the stages of an architecture or a pipeline as boxes, revealed in
 * order with the edges into them. A stage the source calls learned is a box
 * and nothing else; a fixed stage may show an earlier verb's computed layer
 * (`show`), and any stage may show the SOURCE's own figure (`figure`),
 * unedited. A shape is printed only as the source writes it; sizes are never
 * invented, so every box has one size. `phases` draws the training graph,
 * then inference with the train-only stages faded.
 *
 * GRAPH: message passing run for real on the plan's graph
 * (./message-passing.ts), W = I unless the source gives the weights.
 *
 * TIMELINE: serial runs one after another and parallel runs covering their
 * count at once, lane by lane, every lane on ONE axis. A lane's length is the
 * source's: Σ count·dur when every run's duration is stated, else the lane's
 * stated `total` (printed at its end), else its serial steps — a parallel run
 * is one step however many positions it covers, a serial run its count (four,
 * example, when none is stated) — so a lane that takes fewer serial steps is
 * visibly shorter. A run with a stated duration and no count is one block,
 * never split into steps the source does not give. The split of a total into
 * runs is example material (tagged). Runs are revealed in order; there is no
 * playhead. A run's words sit on a plate, so no seam crosses them.
 */
import type { Frame, MechanismResult, Prim } from "./common.js";
import { TYPE, wrapBy } from "./common.js";
import { messagePassing } from "./message-passing.js";
import { num } from "./read.js";
import { textLines, type VerbCtx, withPushRoom } from "./stage.js";

type Ctx = VerbCtx<"flow">;

export function flow(c: Ctx): MechanismResult {
  // Cards and lanes of words to the region's edges: laid out inside the push.
  if (c.lit.form === "chain") return withPushRoom(chain)(c);
  if (c.lit.form === "graph") return graph(c);
  return withPushRoom(timeline)(c);
}

/* ------------------------------------------------------------------ chain */

function chain(c: Ctx): MechanismResult {
  const d = c.lit;
  const { width: W, height: H } = c.region;
  const n = d.stages.length;
  if (n < 2 || n > 10) throw new Error(`flow chain draws 2–10 stages, got ${n}`);
  const ids = new Map(d.stages.map((s, i) => [s.id, i]));
  if (ids.size !== n) throw new Error("flow chain: stage ids must be unique");
  for (const s of d.stages) {
    if (s.learned && s.show)
      throw new Error(
        `stage "${s.label}" is learned and shows a computed layer; a learned stage is a box`,
      );
    if (s.show && s.figure) throw new Error(`stage "${s.label}" shows a layer and a figure; one`);
  }
  if (d.stages.some((s) => s.learned) && !c.labels.learned?.trim())
    throw new Error("flow chain: a learned stage needs the `learned` slot");
  if (d.phases && (!c.labels.train?.trim() || !c.labels.infer?.trim()))
    throw new Error("flow chain: `phases` needs the `train` and `infer` slots");
  const edges: Array<{ from: string; to: string; skip?: boolean | undefined }> = d.edges.length
    ? d.edges
    : d.stages.slice(1).map((s, i) => ({ from: (d.stages[i] as { id: string }).id, to: s.id }));
  for (const e of edges)
    if (!ids.has(e.from) || !ids.has(e.to))
      throw new Error(`edge ${e.from} → ${e.to} names a stage that does not exist`);
  const titleH = d.phases ? 64 : 0;
  // What a dashed card means is said once, under the chain, not as a tag in
  // every learned card (r2 b06: the tag inside the card was noise).
  const learnedAny = d.stages.some((s) => s.learned);
  const keyH = learnedAny ? Math.round(TYPE.label * 1.2) + 16 : 0;
  const perRow = n <= 5 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / perRow);
  const gapX = 72;
  const gapY = 72;
  const bw = (W - (perRow - 1) * gapX) / perRow;
  const rowH = (H - titleH - keyH - (rows - 1) * gapY) / rows;
  const size = TYPE.label;
  const lh = Math.round(size * 1.18);
  // Inside the card. A text prim's y is its line box's top and CJK ink rises
  // about 0.1em above that, so 0.4em puts the glyph tops 0.3em under the edge;
  // lines wrap half an em short of each side, less the 3px halo. r1 set the
  // label at y+12 in a card as tall as the region: the glyph tops of a Han
  // label were cut by the region's edge, and its line ran out of the card.
  const padX = Math.round(size * 0.5);
  const padTop = Math.round(size * 0.4);
  const padBot = Math.round(size * 0.4);
  const innerW = bw - 2 * padX - 6;
  const chipGap = 12;
  const laid = d.stages.map((s) => {
    const label = wrapBy(s.label, size, innerW, c.measure);
    const wide = label.find((l) => c.measure(l, size) > innerW);
    if (wide)
      throw new Error(
        `stage "${s.label}": "${wide}" is wider than its card (${Math.floor(innerW)}px inside); shorten it or use fewer stages`,
      );
    const tokens = s.shape ? tokenChips(s.shape) : undefined;
    // One unnumbered chip is a blank shape standing for nothing (r3 C s4's "extra token"
    // was an empty pink square): a stage shows a count of two or more, or its words.
    if (tokens?.length === 1)
      throw new Error(
        `stage "${s.label}": a \`shape\` of 1 draws one blank chip; leave \`shape\` out, or give the stage a \`figure\` or a \`show\``,
      );
    // A count of a few tokens is the stage's picture, so its chips are large.
    const chipH = Math.round(size * (tokens && tokens.length <= 6 ? 2.4 : 1.5));
    const chips = tokens ? layChips(tokens, innerW, chipH, chipGap, (t) => c.measure(t, size)) : [];
    const chipsH = chips.length ? Math.max(...chips.map((q) => q.y + chipH)) + 16 : 0;
    const shape = s.shape && !tokens ? wrapBy(s.shape, size, innerW, c.measure) : [];
    const need = padTop + label.length * lh + 6 + chipsH + shape.length * lh + padBot;
    return { label, chips, chipH, chipsH, shape, need };
  });
  // A card is as tall as its own words and tokens — never the tallest card's
  // height with a blank body under a short label (r2 b06's third card) — and a
  // stage showing a picture takes the room a picture wants.
  const heights = d.stages.map((s, i) =>
    s.show || s.figure
      ? Math.min(rowH, bw * 1.2)
      : Math.min(rowH, (laid[i] as (typeof laid)[number]).need),
  );
  // One row descends the region as a staircase, first stage at the top and
  // last at the bottom, so a chain of short cards uses the frame's height
  // instead of a band through its middle (r2: a 170px band in a 1080 frame).
  const stairs = rows === 1 && n >= 2;
  const pos = (i: number) => {
    const r = Math.floor(i / perRow);
    const q = i % perRow;
    const h = heights[i] as number;
    const y = stairs
      ? titleH + ((rowH - h) * i) / (n - 1)
      : titleH + r * (rowH + gapY) + (rowH - h) / 2;
    return { x: q * (bw + gapX), y, h };
  };
  const boxes: Prim[][] = d.stages.map((s, i) => {
    const { x, y } = pos(i);
    const bh = heights[i] as number;
    const { label, chips, chipH, chipsH, shape, need } = laid[i] as (typeof laid)[number];
    if (need > bh + 0.5)
      throw new Error(
        `stage "${s.label}" needs ${Math.ceil(need)}px and has ${Math.floor(bh)}px; shorten its label or use fewer stages`,
      );
    const out: Prim[] = [
      { p: "rect", x, y, w: bw, h: bh, fill: "panel", radius: 10, cam: true },
      s.learned
        ? {
            p: "path",
            pts: [x, y, x + bw, y, x + bw, y + bh, x, y + bh],
            closed: true,
            role: "accent",
            width: 3,
            dash: true,
            cam: true,
          }
        : { p: "rect", x, y, w: bw, h: bh, role: "rule", width: 3, radius: 10, cam: true },
      ...textLines(label, x + bw / 2, y + padTop, size, "fg", { cam: true }, "middle"),
    ];
    const chipTop = y + padTop + label.length * lh + 6;
    for (const q of chips) {
      const cx = x + padX + 3 + q.x;
      const cy = chipTop + q.y;
      if (q.text !== "…")
        out.push({
          p: "rect",
          x: cx,
          y: cy,
          w: q.w,
          h: chipH,
          fill: s.learned ? "accent" : "a",
          radius: 8,
          opacity: 0.85,
          cam: true,
        });
      if (q.text)
        out.push({
          p: "text",
          x: cx + q.w / 2,
          y: cy + (chipH - size) / 2 - size * 0.05,
          size,
          role: q.text === "…" ? "muted" : "auto",
          anchor: "middle",
          text: q.text,
          cam: true,
        });
    }
    const visTop = chipTop + chipsH;
    const visBot = y + bh - padBot - shape.length * lh - 6;
    if (s.show || s.figure) {
      if (visBot - visTop < 110)
        throw new Error(
          `stage "${s.label}" has ${Math.floor(visBot - visTop)}px for its picture; shorten its words or use fewer stages`,
        );
      out.push({
        p: "image",
        x: x + padX,
        y: visTop,
        w: bw - 2 * padX,
        h: visBot - visTop,
        layer: s.show ? `from:${s.show}:thumb` : `fig:${s.figure}`,
        fit: true,
        cam: true,
      } as Prim);
    }
    out.push(...textLines(shape, x + bw / 2, visBot + 6, size, "muted", { cam: true }, "middle"));
    return out;
  });
  const edgePrims = (e: (typeof edges)[number], dim: boolean): Prim[] => {
    const a = ids.get(e.from) as number;
    const b = ids.get(e.to) as number;
    const pa = pos(a);
    const pb = pos(b);
    const base = {
      role: "muted" as const,
      width: 4,
      cam: true,
      wipe: true,
      ...(dim ? { opacity: 0.15 } : {}),
    };
    const sameRow = Math.floor(a / perRow) === Math.floor(b / perRow);
    const aMid = pa.y + pa.h / 2;
    if (!e.skip && sameRow && Math.abs(b - a) === 1) {
      const fwd = a < b;
      const xOut = fwd ? pa.x + bw + 6 : pa.x - 6;
      const xIn = fwd ? pb.x - 8 : pb.x + bw + 8;
      // Level with the next card: straight across.
      if (aMid > pb.y + 16 && aMid < pb.y + pb.h - 16)
        return [{ p: "line", x1: xOut, y1: aMid, x2: xIn, y2: aMid, arrow: true, ...base } as Prim];
      // A step of the staircase: across, then down (or up) into the card.
      const xb = pb.x + bw / 2;
      const down = pb.y > aMid;
      const yEnd = down ? pb.y - 4 : pb.y + pb.h + 4;
      return [
        {
          p: "path",
          pts: [xOut, aMid, xb, aMid, xb, down ? yEnd - 12 : yEnd + 12],
          ...base,
        } as Prim,
        {
          p: "line",
          x1: xb,
          y1: down ? yEnd - 14 : yEnd + 14,
          x2: xb,
          y2: yEnd,
          arrow: true,
          ...base,
        } as Prim,
      ];
    }
    const xa = pa.x + bw / 2;
    const xb = pb.x + bw / 2;
    const bMid = pb.y + pb.h / 2;
    // A skip down the staircase: down out of the source, then across into the target's side.
    if (stairs && a < b && bMid > pa.y + pa.h + 16) {
      return [
        {
          p: "path",
          pts: [xa, pa.y + pa.h, xa, bMid, pb.x - 20, bMid],
          ...base,
          dash: !!e.skip,
        } as Prim,
        {
          p: "line",
          x1: pb.x - 22,
          y1: bMid,
          x2: pb.x - 6,
          y2: bMid,
          arrow: true,
          ...base,
        } as Prim,
      ];
    }
    // A jump between rows, or a skip with no room under it: over the boxes (or
    // under), then into the target, kept inside the region.
    const up = !sameRow ? pb.y > pa.y : true;
    const lane = sameRow ? Math.max(4, Math.min(pa.y, pb.y) - 30) : (pa.y + pa.h + pb.y) / 2;
    const yIn = sameRow ? pb.y : pb.y;
    return [
      {
        p: "path",
        pts: [
          xa,
          sameRow ? (up ? pa.y : pa.y + pa.h) : pa.y + pa.h,
          xa,
          lane,
          xb,
          lane,
          xb,
          yIn - 12,
        ],
        ...base,
        dash: !!e.skip,
      } as Prim,
      { p: "line", x1: xb, y1: yIn - 14, x2: xb, y2: yIn - 4, arrow: true, ...base } as Prim,
    ];
  };
  // The key for a dashed card, under the first stage, where the staircase leaves room.
  const key: Prim[] = learnedAny
    ? [
        {
          p: "path",
          pts: [0, H - keyH + 8, 64, H - keyH + 8, 64, H - 8, 0, H - 8],
          closed: true,
          role: "accent",
          width: 3,
          dash: true,
          cam: true,
        },
        {
          p: "text",
          x: 84,
          y: H - keyH + 8,
          size: TYPE.label,
          role: "accent",
          anchor: "start",
          slot: "learned",
          cam: true,
        },
      ]
    : [];
  const train = (s: (typeof d.stages)[number]) => s.phase === "train";
  // The order a stage comes in: every stage on the training graph; on inference, the ones that stay.
  const order = (infer: boolean) => {
    const m = new Map<number, number>();
    let k = 0;
    d.stages.forEach((s, i) => {
      if (!(infer && train(s))) m.set(i, Math.min(12, ++k));
    });
    return m;
  };
  const frame = (infer: boolean): Frame => {
    const prims: Prim[] = [];
    if (d.phases)
      prims.push({
        p: "text",
        x: 0,
        y: 6,
        size: TYPE.body,
        role: "fg",
        anchor: "start",
        slot: infer ? "infer" : "train",
      });
    const rank = order(infer);
    d.stages.forEach((s, i) => {
      const dim = infer && train(s);
      const at = rank.get(i);
      for (const p of boxes[i] as Prim[])
        prims.push({
          ...p,
          ...(at && at > 1 ? { at } : {}),
          ...(dim ? { opacity: 0.15 } : {}),
        } as Prim);
    });
    for (const e of edges) {
      const a = ids.get(e.from) as number;
      const b = ids.get(e.to) as number;
      const dim = infer && (train(d.stages[a] as never) || train(d.stages[b] as never));
      const at = Math.max(rank.get(a) ?? 0, rank.get(b) ?? 0);
      for (const p of edgePrims(e, dim))
        prims.push({
          ...p,
          ...(at > 1 && !dim ? { at } : { at: undefined, wipe: undefined }),
        } as Prim);
    }
    prims.push(...key);
    return { id: infer ? "infer" : "train", prims, vars: {}, preview: true };
  };
  const frames = [frame(false)];
  if (d.phases) frames.push(frame(true));
  const shown = d.stages.find((s) => s.show);
  return {
    rasters: {},
    frames,
    data: { thumb: shown ? `from:${shown.show}:thumb` : undefined },
    vars: {},
  };
}

/**
 * A stage's `shape` as the tokens it counts, when it is a count the source
 * states: a whole number (that many chips, unlabelled), or one symbol with an
 * optional offset, alone or as the end of a run from 1 ("γ", "γ+1", "1…γ+1"),
 * drawn as 1, 2, …, the symbol, so no value of the symbol is invented.
 * Anything else ("H×W×C", "256×256") is not a count and stays words.
 */
export function tokenChips(shape: string): string[] | undefined {
  const t = shape.trim().replace(/\s+/g, "");
  if (/^\d{1,2}$/.test(t)) {
    const k = Number(t);
    if (k >= 1 && k <= 16) return Array.from({ length: k }, () => "");
  }
  // A count too many to draw one by one is its first two and its last, as a symbol's is.
  if (/^\d+$/.test(t) && Number(t) > 16) return ["1", "2", "…", t];
  const end = /^(?:1(?:…|\.\.\.?|–|-|~))?(\p{L}(?:[+−-]\d{1,2})?)$/u.exec(t)?.[1];
  return end ? ["1", "2", "…", end] : undefined;
}

/** Chips laid left to right in rows `w` wide, each as wide as its text needs. */
function layChips(
  tokens: readonly string[],
  w: number,
  h: number,
  gap: number,
  measure: (t: string) => number,
): Array<{ x: number; y: number; w: number; text: string }> {
  const out: Array<{ x: number; y: number; w: number; text: string }> = [];
  let x = 0;
  let y = 0;
  for (const text of tokens) {
    const cw = text ? Math.max(h, measure(text) + h * 0.5) : h * 0.8;
    if (x > 0 && x + cw > w) {
      x = 0;
      y += h + gap;
    }
    out.push({ x, y, w: cw, text });
    x += cw + gap;
  }
  // Centred under the label, row by row.
  for (const row of new Set(out.map((q) => q.y))) {
    const inRow = out.filter((q) => q.y === row);
    const last = inRow[inRow.length - 1] as (typeof out)[number];
    const slack = (w - (last.x + last.w)) / 2;
    for (const q of inRow) q.x += slack;
  }
  return out;
}

/* ------------------------------------------------------------------ graph */

function graph(c: Ctx): MechanismResult {
  const d = c.lit;
  const r = messagePassing(
    {
      nodes: d.nodes,
      edges: d.edges.map((e) => [e.from, e.to] as [string, string]),
      directed: d.directed,
      layers: d.layers,
      aggregate: d.aggregate,
      ...(d.weights.length ? { weights: d.weights } : {}),
      ...(d.focus ? { focus: d.focus } : {}),
      measure: c.measure,
    },
    c.region,
  );
  if (!c.labels.layer?.trim() || !c.labels.field?.trim())
    throw new Error("flow graph needs the `layer` and `field` slots");
  // The graph is the material: the camera leans in on it at each layer.
  return {
    ...r,
    frames: r.frames.map((f) => ({
      ...f,
      prims: f.prims.map((p) => (p.p === "text" ? p : { ...p, cam: true })),
    })),
  };
}

/* --------------------------------------------------------------- timeline */

type Run = Ctx["lit"]["lanes"][number]["runs"][number];

/** How lanes are measured: stated durations, stated totals, or steps (example). */
type Scale = "dur" | "total" | "steps";

function timeline(c: Ctx): MechanismResult {
  const d = c.lit;
  const { width: W, height: H } = c.region;
  const lanes = d.lanes;
  if (lanes.length < 1 || lanes.length > 4)
    throw new Error(`flow timeline draws 1–4 lanes, got ${lanes.length}`);
  const unit = c.labels.unit?.trim();
  if (!unit) throw new Error("flow timeline needs the `unit` slot: what one run is");
  for (const l of lanes)
    if (!l.runs.length || l.runs.length > 8)
      throw new Error(`lane "${l.label}" needs 1–8 runs, got ${l.runs.length}`);
  const count = (r: Run) => (r.count ? num(r.count.value, `run "${r.label}" count`) : undefined);
  for (const l of lanes)
    for (const r of l.runs) {
      const k = count(r);
      if (k !== undefined && (!Number.isInteger(k) || k < 1))
        throw new Error(`run "${r.label}" count must be a whole number ≥ 1`);
    }
  const dur = (r: Run) => (r.dur ? num(r.dur.value, `run "${r.label}" dur`) : undefined);
  // The serial steps a run takes, which is what a lane's length tracks when no time is
  // stated: a parallel run is ONE step however many positions it covers, a serial run its
  // count — one when it is a stated duration (a measured span is not split into steps the
  // source never gives), four when nothing is stated (example).
  const steps = (r: Run) => (r.parallel ? 1 : (count(r) ?? (r.dur ? 1 : 4)));
  // A serial run's blocks: its count, else one block.
  const blocksOf = (r: Run) => {
    const k = r.parallel ? 1 : (count(r) ?? (r.dur ? 1 : 4));
    return k <= 24 ? k : 1;
  };
  const scale: Scale = lanes.every((l) => l.runs.every((r) => r.dur))
    ? "dur"
    : lanes.every((l) => l.total)
      ? "total"
      : "steps";
  if (scale === "steps" && lanes.some((l) => l.total))
    throw new Error(
      "flow timeline: give every lane a `total`, or none (lane lengths are compared only on stated totals)",
    );
  // A run's share of its lane: its stated time when the lane states every run's, else its steps.
  const weight = (l: (typeof lanes)[number], r: Run) =>
    l.runs.every((q) => q.dur) ? (r.parallel ? 1 : (count(r) ?? 1)) * (dur(r) as number) : steps(r);
  const time = lanes.map((l) =>
    scale === "dur"
      ? l.runs.reduce((a, r) => a + weight(l, r), 0)
      : scale === "total"
        ? num(l.total?.value ?? "", `lane "${l.label}" total`)
        : l.runs.reduce((a, r) => a + steps(r), 0),
  );
  if (time.some((t) => !(t > 0)))
    throw new Error("flow timeline: every lane's time must be positive");
  const tmax = Math.max(...time);
  // On example steps, lanes of one length say nothing a timeline exists to say: r3 drew a
  // parallel verify as long as K serial runs, and early exit as long as the full run.
  if (lanes.length > 1 && scale === "steps" && Math.min(...time) / tmax > 0.95)
    throw new Error(
      "flow timeline: every lane takes the same number of serial steps, so they are drawn one length; give the runs' `count`, `dur` or the lanes' `total` the source states, or draw it as a chain",
    );
  // A stated total is printed at its lane's end, with the unit when the unit is a short word.
  const unitShort = c.measure(unit, TYPE.label) <= 120 ? unit : "";
  const endText = (i: number) => {
    const l = lanes[i] as (typeof lanes)[number];
    return lanes.every((q) => q.total) && l.total
      ? [l.total.value, unitShort].filter(Boolean).join(" ")
      : "";
  };
  const endW = Math.max(
    0,
    ...lanes.map((_, i) => (endText(i) ? c.measure(endText(i), TYPE.label) + 24 : 0)),
  );
  const lw = Math.min(
    W * 0.3,
    Math.max(...lanes.map((l) => Math.min(W * 0.3, c.measure(l.label, TYPE.label) + 30))),
  );
  const tw = W - lw - 20 - endW;
  const unitH = 60;
  const gap = 28;
  const lineH = Math.round(TYPE.label * 1.18);
  // Pass 1, across: each run's span, and where its words go. Words too wide for the
  // run sit under the lane, wrapped to the track and pulled left to stay in the
  // region; labels under one lane that would collide stack downwards.
  type Under = { lines: string[]; left: number; top: number };
  const across = lanes.map((l, i) => {
    const len = (tw * (time[i] as number)) / tmax;
    const unitW = len / l.runs.reduce((a, r) => a + weight(l, r), 0);
    const under: Under[] = [];
    let x = lw;
    const runs = l.runs.map((r) => {
      const k = count(r);
      const span = unitW * weight(l, r);
      const words = [r.label, ...(k !== undefined && r.count ? [`×${r.count.value}`] : [])].join(
        " ",
      );
      const ww = c.measure(words, TYPE.label);
      let below: Under | undefined;
      // In the run on a plate, when it fits with the plate's margin.
      if (ww + 2 * PLATE_PAD > span - 8) {
        const lines = ww <= W - x ? [words] : wrapBy(words, TYPE.label, tw, c.measure);
        if (lines.length > 2)
          throw new Error(`run "${r.label}" has no room for its words; shorten it`);
        const w = Math.max(...lines.map((t) => c.measure(t, TYPE.label)));
        const left = Math.max(lw, Math.min(x + 4, W - w));
        const h = lines.length * lineH;
        let top = 0;
        for (let moved = true; moved; ) {
          moved = false;
          for (const u of under) {
            const uw = Math.max(...u.lines.map((t) => c.measure(t, TYPE.label)));
            const apart = left >= u.left + uw + 16 || u.left >= left + w + 16;
            const ub = u.top + u.lines.length * lineH;
            if (!apart && top < ub && u.top < top + h) {
              top = ub;
              moved = true;
            }
          }
        }
        below = { lines, left, top };
        under.push(below);
      }
      const run = { r, k, x, span, words, ww, below };
      x += span;
      return run;
    });
    const band = under.length
      ? Math.max(...under.map((u) => u.top + u.lines.length * lineH)) + 2
      : 0;
    return { len, runs, band };
  });
  // Pass 2, down: a lane's under-labels widen the gap after it, so they never sit on
  // the next lane. The last lane's labels share the unit's row, as one line always did.
  const gaps = across.slice(0, -1).map((a) => Math.max(gap, a.band + 8));
  const lastExtra = Math.max(0, (across.at(-1)?.band ?? 0) - lineH - 2);
  const lh = Math.min(
    260,
    (H - unitH - gaps.reduce((a, g) => a + g, 0) - lastExtra) / lanes.length,
  );
  if (lh < 60)
    throw new Error(
      "flow timeline: the run labels under the lanes leave them no room; shorten them",
    );
  const prims: Prim[] = [];
  let at = 0;
  let y = 0;
  lanes.forEach((l, i) => {
    const { len, runs } = across[i] as (typeof across)[number];
    const label = wrapBy(l.label, TYPE.label, lw - 20, c.measure);
    if (label.length > 2)
      throw new Error(`lane label "${l.label}" needs ${label.length} lines; shorten it`);
    prims.push(...textLines(label, 0, y + (lh - label.length * 47) / 2, TYPE.label, "fg"));
    // The lane's time: the whole axis, so a shorter lane's saved time is visible as empty.
    prims.push({
      p: "rect",
      x: lw,
      y,
      w: tw,
      h: lh,
      fill: "panel",
      opacity: 0.5,
      radius: 6,
      cam: true,
    });
    prims.push({ p: "rect", x: lw, y: y + lh / 2 - 2, w: len, h: 4, fill: "rule", cam: true });
    runs.forEach(({ r, k, x, span, words, ww, below }, j) => {
      at = Math.min(12, at + 1);
      const role = j % 2 ? "b" : "a";
      const inner: Prim[] = [];
      if (r.parallel) {
        // One step covering its count at once: the positions stacked in one column.
        const m = Math.min(12, k ?? 4);
        const sh = (lh - 16) / m;
        for (let q = 0; q < m; q++)
          inner.push({
            p: "rect",
            x: x + 2,
            y: y + 8 + q * sh,
            w: Math.max(4, span - 4),
            h: Math.max(2, sh - 3),
            fill: role,
            radius: 3,
            cam: true,
            at,
            wipe: true,
          });
      } else {
        const blocks = blocksOf(r);
        const bw = span / blocks;
        for (let q = 0; q < blocks; q++)
          inner.push({
            p: "rect",
            x: x + q * bw + 2,
            y: y + 8,
            w: Math.max(3, bw - 4),
            h: lh - 16,
            fill: role,
            radius: 4,
            cam: true,
            at,
            wipe: true,
            opacity: 0.85,
          });
      }
      prims.push(...inner);
      if (!below) {
        // On a plate, so the seams between blocks and stacked positions never cross the words.
        const ph = TYPE.label * 1.2 + 12;
        prims.push(
          {
            p: "rect",
            x: x + span / 2 - ww / 2 - PLATE_PAD,
            y: y + lh / 2 - ph / 2,
            w: ww + 2 * PLATE_PAD,
            h: ph,
            fill: "panel",
            opacity: 0.92,
            radius: 8,
            at,
            cam: true,
          },
          {
            p: "text",
            x: x + span / 2,
            y: y + lh / 2 - TYPE.label * 0.6,
            size: TYPE.label,
            role: "fg",
            anchor: "middle",
            text: words,
            at,
            cam: true,
          },
        );
      } else
        prims.push(
          ...textLines(below.lines, below.left, y + lh + 2 + below.top, TYPE.label, "muted", {
            at,
            cam: true,
          }),
        );
    });
    // The stated total at the lane's end, with the lane's last run.
    const end = endText(i);
    if (end)
      prims.push({
        p: "text",
        x: lw + len + 16,
        y: y + lh / 2 - TYPE.label * 0.6,
        size: TYPE.label,
        role: "accent",
        anchor: "start",
        weight: 700,
        text: end,
        at,
        // With the lanes under the camera: outside it, a push slid the bar's end over it.
        cam: true,
      });
    y += lh + (gaps[i] ?? 0);
  });
  prims.push({
    p: "text",
    x: W,
    y: H - unitH + 10,
    size: TYPE.label,
    role: "muted",
    anchor: "end",
    slot: "unit",
  });
  return { rasters: {}, frames: [{ id: "lanes", prims, vars: {} }], data: { scale }, vars: {} };
}

/** Room around a run's words on their plate, px a side. */
const PLATE_PAD = 14;
