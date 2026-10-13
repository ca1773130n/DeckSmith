/**
 * flow — data passing through stages, in two forms.
 *
 * CHAIN, the approved look (.planning/designs/2026-10-12-verb-looks.md): the
 * stages in columns, a stage's column being how many edges lead to it, and
 * revealed column by column along the wires. A stage holding tokens is a box
 * with its token row, each group's count as the source states it; a stage
 * with the source's own figure (`figure`) or an earlier verb's computed layer
 * (`show`) is that picture under its name; a stage with a `quote` is the
 * source's words on a bar; any other stage is a pill. A stage only the
 * training run has is a dashed card with the `train` tag, and `phases` then
 * shows inference with it faded. A learned stage never shows a computed
 * layer. Nothing is sized by invention: a shape is printed as the source
 * writes it, and a picture keeps its own aspect.
 */
import { existsSync, readFileSync } from "node:fs";
import { imageSize } from "../../source/assets.js";
import type { MechanismResult, Prim, Role } from "./common.js";
import { TYPE, wrapBy } from "./common.js";
import { num } from "./read.js";
import { textLines, type VerbCtx, withPushRoom } from "./stage.js";

type Ctx = VerbCtx<"flow">;
type Stage = Ctx["lit"]["stages"][number];

export function flow(c: Ctx): MechanismResult {
  // Cards and lanes of words to the region's edges: laid out inside the push.
  return withPushRoom(chain)(c);
}

/* ------------------------------------------------------------------ chain */

/** Between columns, for the wires. */
const GAP = 72;
/** Inside a card or a pill, a side. */
const PAD = 20;
/** Inside a token box, a side. */
const BOX_PAD = 30;
const CHIP_H = 80;
const CHIP_GAP = 6;
/** Between the stages of one column. */
const STACK = 16;
/** The least share of the height a column of two or more stages spans. */
const SPREAD = 0.9;
/** Between a picture and the name above it. */
const PIC_GAP = 8;
/** The least a picture is shrunk to so its column fits. */
const PIC_MIN = 110;
/** The widest a pill grows before its words wrap. */
const PILL_MAX = 480;
/** The least a picture's or a quote's column is. */
const FLEX_MIN = 320;
/** A card's room above and below what it holds. */
const CARD_PAD_Y = 14;
const LH = Math.round(TYPE.label * 1.18);
const QUOTE_LH = Math.round(TYPE.label * 1.3);
/** A token group's colour, in order, unless it names its own. */
const TONES: readonly Role[] = ["a", "b", "c", "d", "muted"];

/** A token chip, and the group it belongs to (a row breaks between groups where it can). */
type Chip = { text: string; tone: Role; group: number };
type Laid = {
  s: Stage;
  look: "box" | "picture" | "quote" | "pill";
  card: boolean;
  chips: Chip[];
  counts: string;
  aspect: number;
};

/**
 * A stage's token row: its `tokens` groups, a group of up to six drawn one
 * chip each and a larger one as one chip with its count; or a `shape` that is
 * a stated count (`tokenChips`). None: the stage holds no tokens.
 */
function chipsOf(s: Stage): { chips: Chip[]; counts: string } | undefined {
  if (s.tokens.length) {
    if (s.tokens.length > TONES.length)
      throw new Error(`stage "${s.label}" has ${s.tokens.length} token groups; at most 5`);
    const chips: Chip[] = [];
    const counts: string[] = [];
    s.tokens.forEach((g, i) => {
      const tone = g.tone ?? (TONES[i] as Role);
      const k = g.count ? num(g.count.value, `token group "${g.label}" count`) : 1;
      if (!Number.isInteger(k) || k < 1)
        throw new Error(`token group "${g.label}" count must be a whole number ≥ 1`);
      if (k <= 6) for (let q = 0; q < k; q++) chips.push({ text: g.label, tone, group: i });
      else chips.push({ text: `${g.label}×${g.count?.value}`, tone, group: i });
      if (g.name && g.count) counts.push(`${g.name} ${g.count.value}`);
    });
    return { chips, counts: counts.join(" · ") };
  }
  const t = s.shape ? tokenChips(s.shape) : undefined;
  if (!t) return undefined;
  // One unnumbered chip is a blank shape standing for nothing (r3 C s4's "extra token"
  // was an empty pink square): a stage shows a count of two or more, or its words.
  if (t.length === 1)
    throw new Error(
      `stage "${s.label}": a \`shape\` of 1 draws one blank chip; leave \`shape\` out, or give the stage a \`figure\` or a \`show\``,
    );
  return {
    chips: t.map((text) => ({ text, tone: s.learned ? "accent" : "a", group: 0 })),
    counts: "",
  };
}

/** A figure's width over height; a file not there yet (plan time) is laid out 16:9 and drawn at its own aspect inside that box. */
function aspectOf(file: string | undefined): number {
  if (!file || !existsSync(file)) return 16 / 9;
  const { width, height } = imageSize(readFileSync(file));
  return width / height;
}

function chain(c: Ctx): MechanismResult {
  const d = c.lit;
  const { width: W, height: H } = c.region;
  const n = d.stages.length;
  if (n < 2 || n > 10) throw new Error(`flow chain draws 2–10 stages, got ${n}`);
  const ids = new Map(d.stages.map((s, i) => [s.id, i]));
  if (ids.size !== n) throw new Error("flow chain: stage ids must be unique");
  const edges = d.edges.length
    ? d.edges
    : d.stages.slice(1).map((s, i) => ({
        from: (d.stages[i] as Stage).id,
        to: s.id,
        via: undefined as string | undefined,
      }));
  for (const e of edges)
    if (!ids.has(e.from) || !ids.has(e.to))
      throw new Error(`edge ${e.from} → ${e.to} names a stage that does not exist`);
  const train = (i: number) => (d.stages[i] as Stage).phase === "train";
  if (d.stages.some((_, i) => train(i)) && !c.labels.train?.trim())
    throw new Error("flow chain: a training-only stage needs the `train` slot, its tag");
  if (d.phases && !d.stages.some((_, i) => train(i)))
    throw new Error("flow chain: `phases` needs a stage whose `phase` is train");

  // A stage's column: the longest run of edges into it. A loop never settles.
  const col: number[] = d.stages.map(() => 0);
  for (let pass = 0; ; pass++) {
    let moved = false;
    for (const e of edges) {
      const a = ids.get(e.from) as number;
      const b = ids.get(e.to) as number;
      if ((col[b] as number) < (col[a] as number) + 1) {
        col[b] = (col[a] as number) + 1;
        moved = true;
      }
    }
    if (!moved) break;
    if (pass >= n)
      throw new Error(
        "flow chain: its edges run in a loop; a flow runs one way (a loop is an `evolve`)",
      );
  }
  const cols = Math.max(...col) + 1;
  if (cols > 4)
    throw new Error(
      `flow chain runs ${cols} stages deep and the scene holds 4 columns: make consecutive steps one stage, or draw the sequence as an \`evolve\``,
    );

  const laid: Laid[] = d.stages.map((s) => {
    if (s.learned && s.show)
      throw new Error(
        `stage "${s.label}" is learned and shows a computed layer; a learned stage is a box`,
      );
    const t = chipsOf(s);
    const holds = [t, s.show || s.figure, s.quote].filter(Boolean).length;
    if (s.show && s.figure) throw new Error(`stage "${s.label}" shows a layer and a figure; one`);
    if (holds > 1)
      throw new Error(
        `stage "${s.label}" holds more than one of tokens, a picture and a quote; one`,
      );
    const look = t ? "box" : s.show || s.figure ? "picture" : s.quote ? "quote" : "pill";
    return {
      s,
      look,
      card: s.phase === "train" && look !== "box" && look !== "pill",
      chips: t?.chips ?? [],
      counts: t?.counts ?? "",
      aspect: s.figure ? aspectOf(c.assets[s.figure]) : 16 / 9,
    };
  });

  const m = (t: string, size: number = TYPE.label) => c.measure(t, size);
  const chipW = (q: Chip) =>
    q.text === "…" ? m("…", TYPE.body) + 8 : q.text ? Math.max(64, m(q.text, TYPE.body) + 20) : 56;
  const rowW = (qs: Chip[]) => qs.reduce((a, q) => a + chipW(q), 0) + CHIP_GAP * (qs.length - 1);
  const tagW = c.labels.train ? m(c.labels.train) + 14 : 0;
  const nameLine = (l: Laid) => m(l.s.label, TYPE.headline);
  // What a stage needs across, before its column is widened.
  const natural = (l: Laid) => {
    if (l.look === "box")
      return (
        2 * BOX_PAD +
        Math.max(
          nameLine(l) + (l.s.shape && !tokenChips(l.s.shape) ? 14 + m(l.s.shape) : 0),
          rowW(l.chips),
          l.counts ? m(l.counts) : 0,
        )
      );
    if (l.look === "pill") return Math.min(PILL_MAX, m(l.s.label) + 2 * PAD + 4);
    return FLEX_MIN;
  };
  // The least it can be: chips and a pill's words wrap, a name and a single chip do not.
  const least = (l: Laid) => {
    const unit = (t: string) => Math.max(...wrapBy(t, TYPE.label, 1, m).map((u) => m(u)));
    if (l.look === "box")
      return (
        2 * BOX_PAD +
        Math.max(
          nameLine(l) + (l.s.shape && !tokenChips(l.s.shape) ? 14 + m(l.s.shape) : 0),
          ...l.chips.map(chipW),
          l.counts ? unit(l.counts) : 0,
        )
      );
    if (l.look === "pill") return unit(l.s.label) + 2 * PAD + 4;
    return FLEX_MIN;
  };
  const colsOf = (k: number) => laid.map((_, i) => i).filter((i) => col[i] === k);
  const colMin = Array.from({ length: cols }, (_, k) =>
    Math.max(...colsOf(k).map((i) => least(laid[i] as Laid))),
  );
  const colNat = Array.from({ length: cols }, (_, k) =>
    Math.max(...colsOf(k).map((i) => natural(laid[i] as Laid))),
  );
  const flex = colMin.map((_, k) =>
    colsOf(k).some((i) => ["picture", "quote"].includes((laid[i] as Laid).look)),
  );
  if (colMin.reduce((a, w) => a + w, 0) + GAP * (cols - 1) > W)
    throw new Error(
      `flow chain needs ${Math.ceil(colMin.reduce((a, w) => a + w, 0) + GAP * (cols - 1))}px across and has ${Math.floor(W)}px; shorten the widest stage's words, or give fewer columns`,
    );

  // Down each column: every stage's parts at its column's width, pictures shrunk to fit.
  type Part = {
    x: number;
    y: number;
    w: number;
    h: number;
    head: string[];
    note: string[];
    tagLine: number;
    pw: number;
    ph: number;
    quote: string[];
    chipRows: Array<Array<Chip & { x: number; w: number }>>;
    counts: string[];
  };
  const partOf = (l: Laid, cw: number): Part => {
    const inner =
      l.look === "box" ? cw - 2 * BOX_PAD : l.look === "pill" ? 0 : cw - (l.card ? 2 * PAD : 0);
    const part: Part = {
      x: 0,
      y: 0,
      w: cw,
      h: 0,
      head: [],
      note: [],
      tagLine: -1,
      pw: 0,
      ph: 0,
      quote: [],
      chipRows: [],
      counts: [],
    };
    const words = l.s.shape && !tokenChips(l.s.shape) ? l.s.shape : "";
    if (l.look === "box") {
      let row: Part["chipRows"][number] = [];
      let x = 0;
      const groupW = (g: number) => rowW(l.chips.filter((q) => q.group === g));
      for (const [j, q] of l.chips.entries()) {
        const w = chipW(q);
        // A group that would split across rows starts the next row, when it fits there whole.
        const opens = j > 0 && l.chips[j - 1]?.group !== q.group;
        const whole = opens && x + groupW(q.group) > inner && groupW(q.group) <= inner;
        if (row.length && (x + w > inner || whole)) {
          part.chipRows.push(row);
          row = [];
          x = 0;
        }
        row.push({ ...q, x, w });
        x += w + CHIP_GAP;
      }
      if (row.length) part.chipRows.push(row);
      part.note = words ? [words] : [];
      part.counts = l.counts ? wrapBy(l.counts, TYPE.label, inner, m) : [];
      part.h =
        BOX_PAD +
        Math.round(TYPE.headline * 1.2) +
        28 +
        part.chipRows.length * (CHIP_H + CHIP_GAP) -
        CHIP_GAP +
        (part.counts.length ? 22 + part.counts.length * LH : 0) +
        BOX_PAD;
      if (l.s.phase === "train") part.tagLine = 0;
      return part;
    }
    if (l.look === "pill") {
      const pw = Math.min(cw, PILL_MAX);
      part.head = wrapBy(l.s.label, TYPE.label, pw - 2 * PAD - 4, m);
      part.note = words ? wrapBy(words, TYPE.label, pw - 2 * PAD - 4, m) : [];
      part.w = Math.min(
        pw,
        Math.max(...[...part.head, ...part.note].map((t) => m(t))) + 2 * PAD + 4,
      );
      if (l.s.phase === "train") part.tagLine = part.head.length + part.note.length;
      part.h = (part.head.length + part.note.length + (part.tagLine >= 0 ? 1 : 0)) * LH + 16;
      return part;
    }
    part.head = wrapBy(l.s.label, TYPE.label, inner, m);
    part.note = words ? wrapBy(words, TYPE.label, inner, m) : [];
    if (l.card) {
      // The tag after the last line of the name, or on its own line when that is full.
      const last = part.head.at(-1) ?? "";
      part.tagLine = m(last) + tagW <= inner ? part.head.length - 1 : part.head.length;
    }
    const headLines = Math.max(part.head.length + part.note.length, part.tagLine + 1);
    const pads = l.card ? 2 * CARD_PAD_Y : 0;
    if (l.look === "picture") {
      part.pw = inner;
      part.ph = inner / l.aspect;
      part.h = pads + headLines * LH + PIC_GAP + part.ph;
    } else {
      part.quote = wrapBy(l.s.quote ?? "", TYPE.label, inner - 26, m);
      part.h = pads + headLines * LH + 14 + part.quote.length * QUOTE_LH;
    }
    return part;
  };
  /**
   * Every stage laid out at the given widths: its parts placed, or why it does
   * not fit, and the smallest picture it leaves (the measure of a layout).
   */
  const layout = (colW: number[]) => {
    const parts = laid.map((l, i) => partOf(l, colW[col[i] as number] as number));
    let fail = "";
    let smallest = Infinity;
    let tallest = 0;
    for (let k = 0; k < cols; k++) {
      const here = colsOf(k).map((i) => parts[i] as Part);
      const total = here.reduce((a, p) => a + p.h, 0) + STACK * (here.length - 1);
      tallest = Math.max(tallest, total);
      const pics = here.filter((p) => p.ph > 0);
      if (total > H) {
        // The pictures share what the words leave: all capped at one height, the
        // tallest shrunk first, so no picture is cut down for another's sake.
        let left = H - (total - pics.reduce((a, p) => a + p.ph, 0));
        let cap = Infinity;
        const asc = pics.map((p) => p.ph).sort((x, y) => x - y);
        for (const [j, h] of asc.entries()) {
          if (h * (asc.length - j) <= left) left -= h;
          else {
            cap = left / (asc.length - j);
            break;
          }
        }
        if (!pics.length || cap < PIC_MIN) {
          fail ||= `flow chain: column ${k + 1} needs ${Math.ceil(total)}px down and has ${Math.floor(H)}px; give it fewer stages, or shorter words`;
          continue;
        }
        for (const p of pics)
          if (p.ph > cap) {
            p.h -= p.ph - cap;
            p.pw *= cap / p.ph;
            p.ph = cap;
          }
      }
      for (const p of pics) smallest = Math.min(smallest, p.ph);
      // A column of two or more spreads down SPREAD of the height, so a few small
      // stages still give the scene its height (the deck's content box gate).
      const used = Math.min(total, H);
      const span = here.length > 1 ? Math.max(used, H * SPREAD) : used;
      const step = here.length > 1 ? STACK + (span - used) / (here.length - 1) : 0;
      let y = (H - span) / 2;
      for (const p of here) {
        p.y = y;
        y += p.h + step;
      }
    }
    const rows = parts.reduce((a, p) => a + p.chipRows.length, 0);
    return { parts, fail, smallest, tallest, rows };
  };
  // A layout that fits; then a token row on the fewest lines; then the largest smallest picture; then the shortest tallest column.
  const rank = (r: ReturnType<typeof layout>) => [
    r.fail ? 1 : 0,
    r.rows,
    -Math.round(r.smallest),
    Math.round(r.tallest),
  ];
  const before = (a: number[], b: number[]) => {
    const j = a.findIndex((x, q) => x !== b[q]);
    return j >= 0 && (a[j] as number) < (b[j] as number);
  };
  // The widths: each column holding a picture or a quote tried across what it
  // may take, the layout kept by `rank`. The other columns keep the width they ask for (a token row on one line), and
  // give it up, in proportion, only when nothing fits that way.
  const flexK = colMin.map((_, k) => k).filter((k) => flex[k]);
  const steps = Math.max(2, Math.floor(1200 ** (1 / Math.max(1, flexK.length))));
  const search = (fixed: number[], squeeze: boolean) => {
    const free = W - GAP * (cols - 1) - fixed.reduce((a, w, k) => a + (flex[k] ? 0 : w), 0);
    let tries: number[][] = [[]];
    for (const k of flexK) {
      const others = flexK.reduce((a, q) => a + (q === k ? 0 : (colMin[q] as number)), 0);
      const lo = colMin[k] as number;
      const hi = Math.max(lo, free - others);
      const opts = Array.from({ length: steps }, (_, j) => lo + ((hi - lo) * j) / (steps - 1));
      tries = tries.flatMap((t) => opts.map((o) => [...t, o]));
    }
    let best: { w: number[]; r: ReturnType<typeof layout> } | undefined;
    for (const t of tries) {
      const w = fixed.map((x, k) => (flex[k] ? (t[flexK.indexOf(k)] as number) : x));
      if (w.reduce((a, x) => a + x, 0) + GAP * (cols - 1) > W + 0.5) continue;
      if (squeeze) {
        // What the flex columns leave, the others take back up to what they ask for, in proportion.
        const rest = W - GAP * (cols - 1) - w.reduce((a, x) => a + x, 0);
        const want = colNat.reduce((a, x, k) => a + (flex[k] ? 0 : x - (colMin[k] as number)), 0);
        if (want > 0)
          w.forEach((x, k) => {
            if (!flex[k]) w[k] = x + ((colNat[k] as number) - x) * Math.min(1, rest / want);
          });
      }
      const r = layout(w);
      if (!best || before(rank(r), rank(best.r))) best = { w, r };
    }
    return best;
  };
  const flexLeast = flexK.reduce((a, k) => a + (colMin[k] as number), 0);
  const natFixed = colNat.reduce((a, w, k) => a + (flex[k] ? 0 : w), 0);
  let best = natFixed + flexLeast + GAP * (cols - 1) <= W ? search(colNat, false) : undefined;
  if (!best || best.r.fail) best = search(colMin, true);
  if (!best || best.r.fail) throw new Error(best?.r.fail ?? "flow chain: no layout");
  const colW = best.w;
  const parts = best.r.parts;
  // Any width left over goes to the wires when no column takes it, and the rest centres the flow.
  const extra = Math.max(0, W - colW.reduce((a, w) => a + w, 0) - GAP * (cols - 1));
  const gap = GAP + Math.min(200, extra / (cols - 1));
  const span = colW.reduce((a, w) => a + w, 0) + gap * (cols - 1);
  const colX = colW.map(
    (_, k) => (W - span) / 2 + colW.slice(0, k).reduce((a, w) => a + w + gap, 0),
  );
  parts.forEach((p, i) => {
    p.x = colX[col[i] as number] as number;
    // A card closes round what it holds, not its column's width.
    const l = laid[i] as Laid;
    if (l.look === "picture" || l.look === "quote") {
      const words = [...p.head, ...p.note].map(
        (t, j) => m(t) + (j === p.tagLine && l.card ? tagW : 0),
      );
      if (l.card && p.tagLine >= p.head.length + p.note.length) words.push(tagW);
      const inner = Math.max(...words, p.pw, ...p.quote.map((t) => m(t) + 26));
      p.w = Math.min(p.w, inner + (l.card ? 2 * PAD : 0));
    }
  });

  // Each stage's prims, and the band of its height a wire meets.
  const band: Array<[number, number]> = [];
  const right: number[] = [];
  const stagePrims = laid.map((l, i): Prim[] => {
    const p = parts[i] as Part;
    const out: Prim[] = [];
    const dashed = l.s.phase === "train";
    const tag = (x: number, y: number): Prim => ({
      p: "text",
      x,
      y,
      size: TYPE.label,
      role: "b",
      anchor: "start",
      slot: "train",
    });
    if (l.look === "box") {
      out.push({ p: "rect", x: p.x, y: p.y, w: p.w, h: p.h, fill: "panel", radius: 24 });
      out.push(
        dashed
          ? {
              p: "path",
              pts: [p.x, p.y, p.x + p.w, p.y, p.x + p.w, p.y + p.h, p.x, p.y + p.h],
              closed: true,
              role: "b",
              width: 3,
              dash: true,
            }
          : { p: "rect", x: p.x, y: p.y, w: p.w, h: p.h, role: "accent", width: 3, radius: 24 },
      );
      const nx = p.x + BOX_PAD;
      const ny = p.y + BOX_PAD;
      out.push({
        p: "text",
        x: nx,
        y: ny,
        size: TYPE.headline,
        role: "fg",
        anchor: "start",
        weight: 600,
        text: l.s.label,
      });
      let after = nx + nameLine(l) + 14;
      for (const t of p.note) {
        out.push({
          p: "text",
          x: after,
          y: ny + (TYPE.headline - TYPE.label) * 0.8,
          size: TYPE.label,
          role: "muted",
          anchor: "start",
          text: t,
        });
        after += m(t) + 14;
      }
      if (dashed) out.push(tag(after, ny + (TYPE.headline - TYPE.label) * 0.8));
      const top = ny + Math.round(TYPE.headline * 1.2) + 28;
      p.chipRows.forEach((row, r) => {
        const cy = top + r * (CHIP_H + CHIP_GAP);
        for (const q of row) {
          if (q.text !== "…")
            out.push({
              p: "rect",
              x: nx + q.x,
              y: cy,
              w: q.w,
              h: CHIP_H,
              fill: q.tone,
              radius: 12,
            });
          if (q.text)
            out.push({
              p: "text",
              x: nx + q.x + q.w / 2,
              y: cy + (CHIP_H - TYPE.body) / 2 - TYPE.body * 0.05,
              size: TYPE.body,
              role: q.text === "…" ? "muted" : "auto",
              anchor: "middle",
              weight: 600,
              text: q.text,
            });
        }
      });
      const bottom = top + p.chipRows.length * (CHIP_H + CHIP_GAP) - CHIP_GAP;
      out.push(...textLines(p.counts, nx, bottom + 22, TYPE.label, "muted"));
      band[i] = [top, bottom];
      right[i] = p.x + p.w;
      return out;
    }
    if (l.look === "pill") {
      out.push({ p: "rect", x: p.x, y: p.y, w: p.w, h: p.h, fill: "panel", radius: 12 });
      out.push(
        dashed
          ? {
              p: "path",
              pts: [p.x, p.y, p.x + p.w, p.y, p.x + p.w, p.y + p.h, p.x, p.y + p.h],
              closed: true,
              role: "b",
              width: 3,
              dash: true,
            }
          : { p: "rect", x: p.x, y: p.y, w: p.w, h: p.h, role: "rule", width: 2, radius: 12 },
      );
      out.push(...textLines(p.head, p.x + PAD, p.y + 8, TYPE.label, "fg"));
      out.push(...textLines(p.note, p.x + PAD, p.y + 8 + p.head.length * LH, TYPE.label, "muted"));
      if (dashed) out.push(tag(p.x + PAD, p.y + 8 + (p.head.length + p.note.length) * LH));
      band[i] = [p.y, p.y + p.h];
      right[i] = p.x + p.w;
      return out;
    }
    const ix = p.x + (l.card ? PAD : 0);
    const iy = p.y + (l.card ? CARD_PAD_Y : 0);
    if (l.card)
      out.push({
        p: "path",
        pts: [p.x, p.y, p.x + p.w, p.y, p.x + p.w, p.y + p.h, p.x, p.y + p.h],
        closed: true,
        role: "b",
        width: 3,
        dash: true,
      });
    out.push(...textLines(p.head, ix, iy, TYPE.label, "fg"));
    out.push(...textLines(p.note, ix, iy + p.head.length * LH, TYPE.label, "muted"));
    if (p.tagLine >= 0)
      out.push(
        tag(
          p.tagLine < p.head.length ? ix + m(p.head[p.tagLine] as string) + 14 : ix,
          iy + p.tagLine * LH,
        ),
      );
    const bodyY = iy + Math.max(p.head.length + p.note.length, p.tagLine + 1) * LH;
    if (l.look === "picture") {
      const y = bodyY + PIC_GAP;
      out.push({
        p: "image",
        x: ix,
        y,
        w: p.pw,
        h: p.ph,
        layer: l.s.show ? `from:${l.s.show}:thumb` : `fig:${l.s.figure}`,
        fit: true,
      });
      band[i] = [y, y + p.ph];
      right[i] = l.card ? p.x + p.w : Math.max(ix + p.pw, ...p.head.map((t) => ix + m(t)));
    } else {
      const y = bodyY + 14;
      const h = p.quote.length * QUOTE_LH;
      out.push({ p: "rect", x: ix, y, w: 6, h, fill: "c" });
      out.push(...textLines(p.quote, ix + 26, y + (QUOTE_LH - LH) / 2, TYPE.label, "fg"));
      band[i] = [y, y + h];
      right[i] = l.card
        ? p.x + p.w
        : Math.max(...[...p.head, ...p.quote].map((t) => ix + m(t)), ix + 26);
    }
    return out;
  });

  // The wires. A column whose every stage feeds one and the same stage of the
  // next column is joined to it by ONE wire (the look's inputs: a frame and three pills).
  type Wire = { a: number; b: number; via?: string | undefined; bundle?: number };
  const wires: Wire[] = [];
  const bundled = new Set<number>();
  for (let k = 0; k < cols - 1; k++) {
    const here = laid.map((_, i) => i).filter((i) => col[i] === k);
    const outs = here.map((i) => edges.filter((e) => ids.get(e.from) === i));
    const to = outs[0]?.[0]?.to;
    if (
      here.length > 1 &&
      outs.every((o) => o.length === 1 && o[0]?.to === to && !o[0]?.via) &&
      col[ids.get(to as string) as number] === k + 1
    ) {
      wires.push({ a: here[0] as number, b: ids.get(to as string) as number, bundle: k });
      for (const i of here) bundled.add(i);
    }
  }
  for (const e of edges) {
    const a = ids.get(e.from) as number;
    if (!bundled.has(a)) wires.push({ a, b: ids.get(e.to) as number, via: e.via });
  }
  const mid = (i: number) => {
    const [y0, y1] = band[i] as [number, number];
    return (y0 + y1) / 2;
  };
  // Where a wire leaves its stage and meets the next, spread down the band in the order of the other end.
  const spread = (i: number, ws: Wire[], end: "a" | "b", w: Wire) => {
    const [y0, y1] = band[i] as [number, number];
    const mine = ws
      .filter((q) => q[end] === i)
      .sort((p, q) => mid(end === "a" ? p.b : p.a) - mid(end === "a" ? q.b : q.a));
    return y0 + ((y1 - y0) * (mine.indexOf(w) + 1)) / (mine.length + 1);
  };
  const toneOf = (w: Wire): Role => {
    if (!w.via) return "muted";
    const g = (d.stages[w.a] as Stage).tokens.findIndex((t) => t.label === w.via);
    if (g < 0)
      throw new Error(
        `edge from "${(d.stages[w.a] as Stage).label}" goes via "${w.via}", which is not one of its token groups`,
      );
    return (d.stages[w.a] as Stage).tokens[g]?.tone ?? (TONES[g] as Role);
  };
  const wirePrims = (w: Wire): Prim => {
    let x1: number;
    let y1: number;
    if (w.bundle !== undefined) {
      const here = parts.filter((_, i) => col[i] === w.bundle);
      x1 =
        Math.max(
          ...laid
            .map((_, i) => i)
            .filter((i) => col[i] === w.bundle)
            .map((i) => right[i] as number),
        ) + 6;
      y1 = (Math.min(...here.map((p) => p.y)) + Math.max(...here.map((p) => p.y + p.h))) / 2;
    } else {
      x1 = (right[w.a] as number) + 6;
      y1 = spread(w.a, wires, "a", w);
    }
    const x2 = (parts[w.b] as Part).x - 6;
    const y2 = spread(w.b, wires, "b", w);
    const between = parts.filter(
      (_, i) =>
        (col[i] as number) > (col[w.a] as number) && (col[i] as number) < (col[w.b] as number),
    );
    let pts: number[];
    if (!between.length) {
      // A cubic from edge to edge, level where it leaves and where it arrives.
      const xm = (x1 + x2) / 2;
      pts = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const u = 1 - t;
        pts.push(
          u * u * u * x1 + 3 * u * u * t * xm + 3 * u * t * t * xm + t * t * t * x2,
          u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
        );
      }
    } else {
      // Past the columns between: over them, else under them.
      const over = Math.min(...between.map((p) => p.y)) - 24;
      const under = Math.max(...between.map((p) => p.y + p.h)) + 24;
      const lane = over >= 8 ? over : under <= H - 8 ? under : NaN;
      if (Number.isNaN(lane))
        throw new Error(
          `edge "${(d.stages[w.a] as Stage).label}" → "${(d.stages[w.b] as Stage).label}" has no room past the column between; give that column fewer stages`,
        );
      const xa = x1 + gap / 2 - 6;
      const xb = x2 - gap / 2 + 6;
      pts = [x1, y1, xa, y1, xa, lane, xb, lane, xb, y2, x2, y2];
    }
    return {
      p: "path",
      pts,
      role: toneOf(w),
      width: 4,
      ...(train(w.a) || train(w.b) ? { dash: true } : {}),
      wipe: true,
    };
  };

  // Revealed column by column: what enters at once, then each later stage in turn with its wires.
  const step: number[] = d.stages.map(() => 1);
  let k = 1;
  for (let q = 1; q < cols; q++)
    laid
      .map((_, i) => i)
      .filter((i) => col[i] === q)
      .sort((a, b) => (parts[a] as Part).y - (parts[b] as Part).y)
      .forEach((i) => {
        k = Math.min(12, k + 1);
        step[i] = k;
      });
  const frame = (infer: boolean) => {
    const prims: Prim[] = [];
    const put = (p: Prim, i: number, dim: boolean) =>
      prims.push({
        ...p,
        cam: true,
        ...(dim
          ? { opacity: 0.15, wipe: undefined }
          : (step[i] as number) > 1
            ? { at: step[i] }
            : {}),
      } as Prim);
    stagePrims.forEach((ps, i) => {
      for (const p of ps) put(p, i, infer && train(i));
    });
    for (const w of wires) put(wirePrims(w), w.b, infer && (train(w.a) || train(w.b)));
    return { id: infer ? "infer" : "train", prims, vars: {}, preview: true };
  };
  const frames = [frame(false)];
  if (d.phases) frames.push(frame(true));
  const shown = d.stages.find((s) => s.show);
  return {
    rasters: {},
    frames,
    data: { thumb: shown ? `from:${shown.show}:thumb` : undefined, columns: cols },
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
