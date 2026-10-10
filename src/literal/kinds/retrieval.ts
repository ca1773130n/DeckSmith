/**
 * retrieval — a query scored against every item, for real, and the top k
 * taken: the scores are plain values and the match is drawn term by term.
 *
 * WHAT IS EXACT. "cosine": cos(q, d) over the source's vectors (or TF-IDF
 * vectors of the given texts: raw counts × smooth idf ln((1+N)/(1+n)) + 1).
 * "bm25": Okapi BM25 over the given texts (Robertson & Zaragoza 2009),
 * k1 = 1.2, b = 0.75, idf = ln(1 + (N − n + 0.5)/(n + 0.5)), each distinct
 * query term once. Tokens are lower-cased runs of letters and digits; no stop
 * list (idf already discounts common words, and a stop list is one language).
 * Ties keep the input order.
 *
 * Frames: the query and the items as given; every item's score as a bar split
 * by what each query term (or, for vectors, each strongest dimension)
 * contributed; the items re-ordered by score with the top k joined to the
 * query.
 */
import {
  type Frame,
  fillTemplate,
  type LiteralSlot,
  type Measure,
  type MechanismResult,
  type Prim,
  type Region,
  type Role,
  roughMeasure,
  TYPE,
} from "./common.js";

/* -------------------------------------------------------------------- maths */

export function tokenize(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length)
    throw new Error(`retrieval: vectors of ${a.length} and ${b.length} dimensions`);
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return d / Math.sqrt(na * nb);
}

/** Okapi BM25 of each document for the query's distinct terms, with each term's share. */
export function bm25(
  query: string,
  docs: readonly string[],
  k1 = 1.2,
  b = 0.75,
): { terms: string[]; idf: number[]; scores: number[]; parts: number[][] } {
  const toks = docs.map(tokenize);
  const N = docs.length;
  const avgdl = toks.reduce((s, t) => s + t.length, 0) / Math.max(1, N);
  const terms = [...new Set(tokenize(query))];
  const idf = terms.map((t) => {
    const n = toks.filter((d) => d.includes(t)).length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  });
  const parts = toks.map((d) =>
    terms.map((t, i) => {
      const f = d.filter((x) => x === t).length;
      if (!f) return 0;
      return (
        ((idf[i] as number) * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / (avgdl || 1)))
      );
    }),
  );
  return { terms, idf, scores: parts.map((p) => p.reduce((s, x) => s + x, 0)), parts };
}

/** TF-IDF vectors (raw tf × smooth idf) over the union vocabulary, in first-seen order. */
export function tfidf(
  texts: readonly string[],
  corpus: readonly string[],
): { vocab: string[]; vecs: number[][] } {
  const toks = corpus.map(tokenize);
  const vocab: string[] = [];
  const seen = new Set<string>();
  for (const t of [...texts.flatMap(tokenize), ...toks.flat()])
    if (!seen.has(t)) {
      seen.add(t);
      vocab.push(t);
    }
  const N = corpus.length;
  const idf = vocab.map(
    (v) => Math.log((1 + N) / (1 + toks.filter((d) => d.includes(v)).length)) + 1,
  );
  const vecs = texts.map((s) => {
    const tk = tokenize(s);
    return vocab.map((v, i) => tk.filter((x) => x === v).length * (idf[i] as number));
  });
  return { vocab, vecs };
}

/* ------------------------------------------------------------------- input */

export interface RetrievalInput {
  query: { text?: string; vector?: number[] };
  items: Array<{ label: string; text?: string; vector?: number[] }>;
  /** Default: cosine when every item has a vector, else bm25. */
  method?: "cosine" | "bm25" | "tfidf";
  k?: number;
  k1?: number;
  b?: number;
  measure?: Measure;
}

export const SLOTS: Readonly<Record<string, LiteralSlot>> = {
  query: { what: "over the query: what it is" },
  score: { what: "over the scores: what is computed (BM25, cosine similarity)" },
  topk: { what: "beside the kept items: the cut", vars: ["k"] },
};

export const TAKEAWAY =
  "Every item is scored against the query ({method}); ranked by score, “{top}” comes first ({score}) and the top {k} are kept.";

const TONES: Role[] = ["a", "b", "c", "d"];

/* ---------------------------------------------------------------- the kind */

export function retrieval(input: RetrievalInput, region: Region): MechanismResult {
  const { items } = input;
  if (items.length < 2) throw new Error("retrieval: needs at least two items");
  const method =
    input.method ?? (input.query.vector && items.every((i) => i.vector) ? "cosine" : "bm25");
  let scores: number[];
  let parts: number[][];
  let partNames: string[];
  if (method === "bm25") {
    if (!input.query.text || items.some((i) => !i.text))
      throw new Error("retrieval: bm25 needs the query's and every item's text");
    const r = bm25(
      input.query.text,
      items.map((i) => i.text as string),
      input.k1,
      input.b,
    );
    scores = r.scores;
    parts = r.parts;
    partNames = r.terms;
  } else {
    let q: number[];
    let ds: number[][];
    let names: string[];
    if (method === "cosine") {
      if (!input.query.vector || items.some((i) => !i.vector))
        throw new Error("retrieval: cosine needs the query's and every item's vector");
      q = input.query.vector;
      ds = items.map((i) => i.vector as number[]);
      names = q.map((_, i) => `#${i}`);
    } else {
      if (!input.query.text || items.some((i) => !i.text))
        throw new Error("retrieval: tfidf needs the query's and every item's text");
      const corpus = items.map((i) => i.text as string);
      const t = tfidf([input.query.text, ...corpus], corpus);
      q = t.vecs[0] as number[];
      ds = t.vecs.slice(1);
      names = t.vocab;
    }
    scores = ds.map((d) => cosine(q, d));
    // Each dimension's share of the cosine: q_i d_i / (|q||d|); the strongest four overall, the rest together.
    const nq = Math.hypot(...q);
    const shares = ds.map((d) => {
      const nd = Math.hypot(...d);
      return d.map((x, i) => (nq && nd ? ((q[i] as number) * x) / (nq * nd) : 0));
    });
    const strength = names.map((_, i) =>
      shares.reduce((s, sh) => s + Math.abs(sh[i] as number), 0),
    );
    const keep = strength
      .map((s, i) => [s, i] as const)
      .filter(([s]) => s > 0)
      .sort((a, b) => b[0] - a[0] || a[1] - b[1])
      .slice(0, 4)
      .map(([, i]) => i);
    partNames = keep.map((i) => names[i] as string);
    parts = shares.map((sh) => keep.map((i) => sh[i] as number));
  }
  const k = Math.min(input.k ?? 3, items.length);
  const rank = scores
    .map((s, i) => [s, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .map(([, i]) => i);

  // Layout: the query on the left; a row per item on the right — its label, its
  // score, and under the label the score as a bar split by part.
  const measure = input.measure ?? roughMeasure;
  const { width: W, height: H } = region;
  const size = TYPE.label;
  const top = size + 24;
  const lineH = Math.round(size * 1.15);
  const barH = 16;
  const rowH = 8 + lineH + 8 + barH + 16;
  const rows = items.length;
  if (top + rows * rowH > H)
    throw new Error(
      `retrieval: ${rows} items need ${top + rows * rowH}px, the region is ${H}px; pass at most ${Math.floor((H - top) / rowH)}`,
    );
  const qW = W * 0.26;
  const rx = qW + 90;
  const scoreW = measure("0.000", size) + 24;
  const labelW = W - rx - scoreW;
  const ellipsize = (s: string) => {
    if (measure(s, size) <= labelW) return s;
    let t = s;
    while (t.length > 1 && measure(`${t}…`, size) > labelW) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };
  const labels = items.map((i) => ellipsize(i.label));
  const queryLines = wrapWords(
    input.query.text ?? partNames.join(" "),
    qW - 40,
    TYPE.body,
    measure,
  );
  if (queryLines.length > 6)
    throw new Error("retrieval: the query wraps past six lines; shorten it");
  const qBoxH = queryLines.length * (TYPE.body + 14) + 40;
  const qy = top + 10;
  const smax = Math.max(1e-12, ...scores.map(Math.abs));
  const rowY = (pos: number) => top + pos * rowH;
  // A tone per part that contributes, strongest first, four at most; the rest share "dim".
  const total = partNames.map((_, t) => parts.reduce((s, p) => s + Math.max(0, p[t] as number), 0));
  const toneOf: Role[] = partNames.map(() => "dim");
  total
    .map((v, t) => [v, t] as const)
    .filter(([v]) => v > 0)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, TONES.length)
    .forEach(([, t], j) => {
      toneOf[t] = TONES[j] as Role;
    });

  const queryPrims = (): Prim[] => {
    const out: Prim[] = [
      { p: "text", id: "qh", x: 0, y: 0, size, role: "muted", anchor: "start", slot: "query" },
      {
        p: "rect",
        id: "qbox",
        x: 0,
        y: qy,
        w: qW,
        h: qBoxH,
        fill: "panel",
        role: "accent",
        width: 4,
        radius: 12,
      },
    ];
    queryLines.forEach((ln, i) => {
      out.push({
        p: "text",
        id: `ql${i}`,
        x: 20,
        y: qy + 20 + i * (TYPE.body + 14),
        size: TYPE.body,
        role: "fg",
        anchor: "start",
        text: ln,
      });
    });
    // The parts the bars are split by, each in its tone; a part that matched nothing is dim.
    let cy = qy + qBoxH + 30;
    partNames.forEach((t, i) => {
      const tone = toneOf[i] as Role;
      out.push({ p: "rect", id: `ch${i}`, x: 0, y: cy + 8, w: 28, h: 28, fill: tone, radius: 4 });
      out.push({
        p: "text",
        id: `ct${i}`,
        x: 44,
        y: cy,
        size,
        role: tone === "dim" ? "muted" : tone,
        anchor: "start",
        text: t,
      });
      cy += size + 18;
    });
    return out;
  };
  const rowPrims = (i: number, pos: number, scored: boolean, kept: boolean): Prim[] => {
    const y = rowY(pos);
    const out: Prim[] = [];
    if (kept)
      out.push({
        p: "rect",
        id: `bg${i}`,
        x: rx - 16,
        y: y + 2,
        w: W - rx + 16,
        h: rowH - 4,
        fill: "panel",
        role: "accent",
        width: 3,
        radius: 10,
      });
    out.push({
      p: "text",
      id: `lb${i}`,
      x: rx,
      y: y + 8,
      size,
      role: kept || !scored ? "fg" : "muted",
      anchor: "start",
      text: labels[i] as string,
    });
    if (!scored) return out;
    const by = y + 8 + lineH + 8;
    let x = rx;
    const ps = parts[i] as number[];
    ps.forEach((v, t) => {
      if (v <= 0) return;
      const w = (v / smax) * labelW;
      out.push({ p: "rect", id: `bar${i}-${t}`, x, y: by, w, h: barH, fill: toneOf[t] as Role });
      x += w;
    });
    // A cosine's dimensions beyond the four drawn (and negative shares) are the remainder.
    const drawn = ps.reduce((s, v) => s + Math.max(0, v), 0);
    const rest = (scores[i] as number) - drawn;
    if (rest > 1e-9) {
      const w = (rest / smax) * labelW;
      if (w > 0.5) out.push({ p: "rect", id: `bar${i}-r`, x, y: by, w, h: barH, fill: "dim" });
    }
    out.push({
      p: "text",
      id: `sc${i}`,
      x: W,
      y: y + 8,
      size,
      role: kept ? "accent" : "fg",
      anchor: "end",
      text: (scores[i] as number).toFixed(3),
      weight: 700,
    });
    return out;
  };
  const header = (): Prim[] => [
    { p: "text", id: "sh", x: W, y: 0, size, role: "muted", anchor: "end", slot: "score" },
  ];
  const frames: Frame[] = [
    {
      id: "given",
      prims: [...queryPrims(), ...items.flatMap((_, i) => rowPrims(i, i, false, false))],
      vars: {},
    },
    {
      id: "scored",
      prims: [
        ...queryPrims(),
        ...header(),
        ...items.flatMap((_, i) => rowPrims(i, i, true, false)),
      ],
      vars: {},
    },
  ];
  const ranked: Prim[] = [
    ...queryPrims(),
    ...header(),
    {
      p: "text",
      id: "cutl",
      x: rx,
      y: 0,
      size,
      role: "accent",
      anchor: "start",
      slot: "topk",
      vars: { k },
    },
  ];
  rank.forEach((i, pos) => {
    ranked.push(...rowPrims(i, pos, true, pos < k));
  });
  rank.slice(0, k).forEach((i, pos) => {
    ranked.push({
      p: "line",
      id: `j${i}`,
      x1: qW,
      y1: qy + qBoxH / 2,
      x2: rx - 20,
      y2: rowY(pos) + rowH / 2,
      role: "accent",
      width: 2 + 8 * ((scores[i] as number) / smax),
    });
  });
  ranked.push({
    p: "line",
    id: "cut",
    x1: rx - 16,
    y1: rowY(k),
    x2: W,
    y2: rowY(k),
    role: "accent",
    width: 3,
    dash: true,
  });
  const topI = rank[0] as number;
  frames.push({ id: "ranked", prims: ranked, vars: { k } });
  return {
    rasters: {},
    frames,
    data: {
      method,
      scores,
      rank,
      parts,
      partNames,
      truncated: labels.map((l, i) => l !== (items[i] as { label: string }).label),
    },
    vars: {
      method,
      top: (items[topI] as { label: string }).label,
      score: (scores[topI] as number).toFixed(3),
      k,
    },
  };
}

/** Greedy word wrap to `width` px. */
export function wrapWords(text: string, width: number, size: number, measure: Measure): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && measure(t, size) > width) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function takeaway(r: MechanismResult): string {
  return fillTemplate(TAKEAWAY, r.vars);
}
