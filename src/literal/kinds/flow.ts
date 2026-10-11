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
 * count at once, lane by lane. A lane's length is the source's: Σ count·dur
 * when every run's duration is stated, else the lane's stated `total`, else
 * every lane has one length and the number of runs is the difference. The
 * split of a total into runs is example material (tagged). Runs are revealed
 * in order; there is no playhead.
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
  const perRow = n <= 5 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / perRow);
  const gapX = 72;
  const gapY = 72;
  const bw = (W - (perRow - 1) * gapX) / perRow;
  const rowH = (H - titleH - (rows - 1) * gapY) / rows;
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
  const chipH = Math.round(size * 1.5);
  const chipGap = 12;
  const laid = d.stages.map((s) => {
    const label = wrapBy(s.label, size, innerW, c.measure);
    const wide = label.find((l) => c.measure(l, size) > innerW);
    if (wide)
      throw new Error(
        `stage "${s.label}": "${wide}" is wider than its card (${Math.floor(innerW)}px inside); shorten it or use fewer stages`,
      );
    const tokens = s.shape ? tokenChips(s.shape) : undefined;
    const chips = tokens ? layChips(tokens, innerW, chipH, chipGap, (t) => c.measure(t, size)) : [];
    const chipsH = chips.length ? Math.max(...chips.map((q) => q.y + chipH)) + 16 : 0;
    const shape = s.shape && !tokens ? wrapBy(s.shape, size, innerW, c.measure) : [];
    const learned = s.learned ? 1 : 0;
    const need = padTop + label.length * lh + 6 + chipsH + (shape.length + learned) * lh + padBot;
    return { label, chips, chipsH, shape, learned, need };
  });
  // A card is as tall as its words and tokens, not the region; only a stage
  // showing a picture takes the room a picture wants.
  const pictures = d.stages.some((s) => s.show || s.figure);
  const bh = pictures
    ? Math.min(rowH, bw * 1.2)
    : Math.min(rowH, Math.max(...laid.map((l) => l.need)));
  const pos = (i: number) => {
    const r = Math.floor(i / perRow);
    const q = i % perRow;
    return { x: q * (bw + gapX), y: titleH + r * (rowH + gapY) + (rowH - bh) / 2 };
  };
  const boxes: Prim[][] = d.stages.map((s, i) => {
    const { x, y } = pos(i);
    const { label, chips, chipsH, shape, learned, need } = laid[i] as (typeof laid)[number];
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
    const visBot = y + bh - padBot - (shape.length + learned) * lh - 6;
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
    if (s.learned)
      out.push({
        p: "text",
        x: x + bw / 2,
        y: y + bh - padBot - lh,
        size,
        role: "accent",
        anchor: "middle",
        slot: "learned",
        cam: true,
      });
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
    const sameRow = Math.abs(pa.y - pb.y) < 1;
    if (!e.skip && sameRow && Math.abs(b - a) === 1) {
      const [l, r] = a < b ? [pa, pb] : [pb, pa];
      const y = l.y + bh / 2;
      return [
        {
          p: "line",
          x1: l.x + bw + 6,
          y1: y,
          x2: r.x - 8,
          y2: y,
          arrow: true,
          ...base,
          ...(a > b ? { x1: r.x - 8, x2: l.x + bw + 6 } : {}),
        } as Prim,
      ];
    }
    // A skip, or a jump between rows: up and over the boxes (or down and under), then into the target.
    const up = !sameRow ? pb.y > pa.y : true;
    const ya = up ? pa.y : pa.y + bh;
    const yb = up ? pb.y : pb.y + bh;
    const lane = sameRow ? (up ? pa.y - 30 : pa.y + bh + 30) : (pa.y + bh + pb.y) / 2;
    const xa = pa.x + bw / 2;
    const xb = pb.x + bw / 2;
    const yIn = sameRow ? yb : pb.y;
    return [
      {
        p: "path",
        pts: [
          xa,
          sameRow ? ya : pa.y + bh,
          xa,
          lane,
          xb,
          lane,
          xb,
          sameRow ? yIn - (up ? 12 : -12) : yIn - 12,
        ],
        ...base,
        dash: !!e.skip,
      } as Prim,
      {
        p: "line",
        x1: xb,
        y1: sameRow ? yIn - (up ? 14 : -14) : yIn - 14,
        x2: xb,
        y2: sameRow ? yIn - (up ? 4 : -4) : yIn - 4,
        arrow: true,
        ...base,
      } as Prim,
    ];
  };
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
    return { id: infer ? "infer" : "train", prims, vars: {} };
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

function timeline(c: Ctx): MechanismResult {
  const d = c.lit;
  const { width: W, height: H } = c.region;
  const lanes = d.lanes;
  if (lanes.length < 1 || lanes.length > 4)
    throw new Error(`flow timeline draws 1–4 lanes, got ${lanes.length}`);
  if (!c.labels.unit?.trim())
    throw new Error("flow timeline needs the `unit` slot: what one run is");
  for (const l of lanes)
    if (!l.runs.length || l.runs.length > 8)
      throw new Error(`lane "${l.label}" needs 1–8 runs, got ${l.runs.length}`);
  const count = (r: (typeof lanes)[number]["runs"][number]) =>
    r.count ? num(r.count.value, `run "${r.label}" count`) : undefined;
  for (const l of lanes)
    for (const r of l.runs) {
      const k = count(r);
      if (k !== undefined && (!Number.isInteger(k) || k < 1))
        throw new Error(`run "${r.label}" count must be a whole number ≥ 1`);
    }
  // Steps a run takes: a parallel run one, a serial run its count (4 when the source gives none: example).
  const steps = (r: (typeof lanes)[number]["runs"][number]) => (r.parallel ? 1 : (count(r) ?? 4));
  const allDur = lanes.every((l) => l.runs.every((r) => r.dur && (r.parallel || r.count)));
  const allTotal = lanes.every((l) => l.total);
  if (!allDur && !allTotal && lanes.some((l) => l.total))
    throw new Error(
      "flow timeline: give every lane a `total`, or none (lane lengths are compared only on stated totals)",
    );
  const time = lanes.map((l) =>
    allDur
      ? l.runs.reduce((a, r) => a + steps(r) * num(r.dur?.value ?? "", `run "${r.label}" dur`), 0)
      : allTotal
        ? num(l.total?.value ?? "", `lane "${l.label}" total`)
        : 1,
  );
  if (time.some((t) => !(t > 0)))
    throw new Error("flow timeline: every lane's time must be positive");
  const lw = Math.min(
    W * 0.3,
    Math.max(...lanes.map((l) => Math.min(W * 0.3, c.measure(l.label, TYPE.label) + 30))),
  );
  const tw = W - lw - 20;
  const unitH = 60;
  const gap = 28;
  const lh = Math.min(260, (H - unitH - (lanes.length - 1) * gap) / lanes.length);
  const tmax = Math.max(...time);
  const prims: Prim[] = [];
  let at = 0;
  lanes.forEach((l, i) => {
    const y = i * (lh + gap);
    const label = wrapBy(l.label, TYPE.label, lw - 20, c.measure);
    if (label.length > 2)
      throw new Error(`lane label "${l.label}" needs ${label.length} lines; shorten it`);
    prims.push(...textLines(label, 0, y + (lh - label.length * 47) / 2, TYPE.label, "fg"));
    const len = (tw * (time[i] as number)) / tmax;
    const total = l.runs.reduce((a, r) => a + steps(r), 0);
    const stepW = len / total;
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
    let x = lw;
    l.runs.forEach((r, j) => {
      at = Math.min(12, at + 1);
      const k = count(r);
      const span = stepW * steps(r);
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
        const blocks = steps(r) <= 24 ? steps(r) : 1;
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
      const words = [r.label, ...(k !== undefined && r.count ? [`×${r.count.value}`] : [])].join(
        " ",
      );
      if (c.measure(words, TYPE.label) <= span - 8)
        prims.push({
          p: "text",
          x: x + span / 2,
          y: y + lh / 2 - TYPE.label * 0.6,
          size: TYPE.label,
          role: "auto",
          anchor: "middle",
          text: words,
          at,
        });
      else if (c.measure(words, TYPE.label) <= W - x)
        prims.push({
          p: "text",
          x: x + 4,
          y: y + lh + 2,
          size: TYPE.label,
          role: "muted",
          anchor: "start",
          text: words,
          at,
        });
      else throw new Error(`run "${r.label}" has no room for its words; shorten it`);
      x += span;
    });
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
  return { rasters: {}, frames: [{ id: "lanes", prims, vars: {} }], data: {}, vars: {} };
}
