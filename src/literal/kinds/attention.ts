/**
 * attention — scaled dot-product attention, softmax(QKᵀ/√d), computed for real
 * over the scene's own tokens or the picture's own patches.
 *
 * WHAT IS EXACT AND WHAT IS DERIVED. The weights are always the real formula:
 * scores QKᵀ/√d, an optional causal mask, a numerically stable row softmax.
 * The queries and keys are the source's when it gives them (`heads`: per-head
 * Q and K, or `embeddings` used as both, W_Q = W_K = I). Without them there
 * are no trained projections to run, so each head's Q = K is a feature of the
 * input the head's name states, and nothing more:
 *   - "content": tokens → hashed character trigrams; patches → the patch's
 *     own pixels (4×4×3). Both z-scored per dimension across the sequence.
 *   - "position": the sinusoidal encoding of Vaswani et al. (d = 64); for
 *     patches, 32 dims of the column and 32 of the row.
 * Such a head attends to what LOOKS alike or SITS near; it never claims a
 * trained model's semantics, and the slots must not either.
 *
 * Frames: one per query on the path. Tokens: a key row over a query row,
 * a line from the query to every key (width ∝ weight), the top weights as
 * plain values, and every head's n×n matrix with the query's row outlined.
 * Patches: the picture with the first head's map over it, the query patch
 * outlined, the path so far, and every head's map beside it.
 */
import {
  type Frame,
  fillTemplate,
  fitBox,
  flat,
  fmt,
  fnv1a,
  type Gray,
  type Measure,
  type MechanismResult,
  type Prim,
  type Raster,
  type Region,
  type Rgb,
  resample,
  roughMeasure,
  TYPE,
} from "./common.js";

/* -------------------------------------------------------------------- maths */

/** Row-wise softmax of an n×m score matrix; −Infinity entries get weight 0. Stable (max-subtracted). */
export function softmaxRows(s: Float32Array, n: number, m: number): Float32Array {
  const o = new Float32Array(n * m);
  for (let i = 0; i < n; i++) {
    let mx = Number.NEGATIVE_INFINITY;
    for (let j = 0; j < m; j++) mx = Math.max(mx, s[i * m + j] as number);
    if (mx === Number.NEGATIVE_INFINITY) throw new Error(`softmaxRows: row ${i} is fully masked`);
    let z = 0;
    for (let j = 0; j < m; j++) {
      const e = Math.exp((s[i * m + j] as number) - mx);
      o[i * m + j] = e;
      z += e;
    }
    for (let j = 0; j < m; j++) o[i * m + j] = (o[i * m + j] as number) / z;
  }
  return o;
}

/**
 * softmax(Q Kᵀ / √d): Q is n×d, K is m×d, row-major. Returns the n×m weights.
 * `causal` masks key j > query i (needs n = m).
 */
export function attentionWeights(
  q: Float32Array,
  k: Float32Array,
  n: number,
  m: number,
  d: number,
  opts: { causal?: boolean } = {},
): Float32Array {
  if (q.length !== n * d || k.length !== m * d)
    throw new Error(
      `attention: Q is ${q.length} values, K ${k.length}; expected ${n}×${d}, ${m}×${d}`,
    );
  if (opts.causal && n !== m)
    throw new Error("attention: a causal mask needs as many keys as queries");
  const s = new Float32Array(n * m);
  const inv = 1 / Math.sqrt(d);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      if (opts.causal && j > i) {
        s[i * m + j] = Number.NEGATIVE_INFINITY;
        continue;
      }
      let dot = 0;
      for (let c = 0; c < d; c++) dot += (q[i * d + c] as number) * (k[j * d + c] as number);
      s[i * m + j] = dot * inv;
    }
  return softmaxRows(s, n, m);
}

/** Sinusoidal positional encoding (Vaswani et al. 2017): PE(p, 2i) = sin(p/10000^(2i/d)), PE(p, 2i+1) = cos(…). */
export function sinusoidal(n: number, d: number): Float32Array {
  const o = new Float32Array(n * d);
  for (let p = 0; p < n; p++)
    for (let i = 0; i < d; i += 2) {
      const w = p / 10000 ** (i / d);
      o[p * d + i] = Math.sin(w);
      if (i + 1 < d) o[p * d + i + 1] = Math.cos(w);
    }
  return o;
}

/** Each column centred and scaled to unit variance across the n rows (a constant column becomes 0). */
export function zscoreColumns(x: Float32Array, n: number, d: number): Float32Array {
  const o = new Float32Array(n * d);
  for (let c = 0; c < d; c++) {
    let mu = 0;
    for (let i = 0; i < n; i++) mu += x[i * d + c] as number;
    mu /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += ((x[i * d + c] as number) - mu) ** 2;
    const sd = Math.sqrt(v / n);
    for (let i = 0; i < n; i++) o[i * d + c] = sd > 1e-9 ? ((x[i * d + c] as number) - mu) / sd : 0;
  }
  return o;
}

export const TRIGRAM_DIM = 64;
export const POSITION_DIM = 64;

/** Hashed character trigrams of each token ("#tok#"), TRIGRAM_DIM buckets, z-scored across tokens. */
export function trigramFeatures(tokens: readonly string[]): Float32Array {
  const n = tokens.length;
  const x = new Float32Array(n * TRIGRAM_DIM);
  tokens.forEach((t, i) => {
    const s = `#${t.toLowerCase()}#`;
    for (let a = 0; a + 3 <= s.length; a++) {
      const at = i * TRIGRAM_DIM + (fnv1a(s.slice(a, a + 3)) % TRIGRAM_DIM);
      x[at] = (x[at] as number) + 1;
    }
  });
  return zscoreColumns(x, n, TRIGRAM_DIM);
}

/** A patch grid's content features: each patch's pixels at 4×4, RGB, z-scored across patches. */
export function patchContent(img: Rgb, cols: number, rows: number): Float32Array {
  const small = resample(img, cols * 4, rows * 4);
  const d = 48;
  const x = new Float32Array(cols * rows * d);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p = r * cols + c;
      let k = 0;
      for (let yy = 0; yy < 4; yy++)
        for (let xx = 0; xx < 4; xx++)
          for (let ch = 0; ch < 3; ch++)
            x[p * d + k++] = small.d[((r * 4 + yy) * cols * 4 + c * 4 + xx) * 3 + ch] as number;
    }
  return zscoreColumns(x, cols * rows, d);
}

/** 2-D sinusoidal position of each patch: half the dims encode the column, half the row. */
export function patchPosition(cols: number, rows: number): Float32Array {
  const h = POSITION_DIM / 2;
  const pc = sinusoidal(cols, h);
  const pr = sinusoidal(rows, h);
  const o = new Float32Array(cols * rows * POSITION_DIM);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p = r * cols + c;
      for (let i = 0; i < h; i++) {
        o[p * POSITION_DIM + i] = pc[c * h + i] as number;
        o[p * POSITION_DIM + h + i] = pr[r * h + i] as number;
      }
    }
  return o;
}

/* ------------------------------------------------------------------ inputs */

/** A head's queries and keys as the source states them, n×d each. */
export interface GivenHead {
  q: number[][];
  k: number[][];
}

interface HeadQK {
  name: string;
  q: Float32Array;
  k: Float32Array;
  d: number;
}

function matrix(
  rows: readonly (readonly number[])[],
  what: string,
): { x: Float32Array; d: number } {
  const d = rows[0]?.length ?? 0;
  if (d === 0) throw new Error(`attention: ${what} is empty`);
  const x = new Float32Array(rows.length * d);
  rows.forEach((r, i) => {
    if (r.length !== d)
      throw new Error(`attention: ${what} row ${i} has ${r.length} values, not ${d}`);
    r.forEach((v, c) => {
      if (!Number.isFinite(v)) throw new Error(`attention: ${what}[${i}][${c}] is not a number`);
      x[i * d + c] = v;
    });
  });
  return { x, d };
}

function givenHeads(heads: readonly GivenHead[], n: number): HeadQK[] {
  return heads.map((h, i) => {
    const q = matrix(h.q, `heads[${i}].q`);
    const k = matrix(h.k, `heads[${i}].k`);
    if (h.q.length !== n || h.k.length !== n)
      throw new Error(
        `attention: heads[${i}] has ${h.q.length} queries and ${h.k.length} keys, not ${n}`,
      );
    if (q.d !== k.d) throw new Error(`attention: heads[${i}] Q is ${q.d}-d, K is ${k.d}-d`);
    return { name: `given-${i}`, q: q.x, k: k.x, d: q.d };
  });
}

export interface TokenAttentionInput {
  tokens: string[];
  /** Per-head queries and keys, when the source gives them. */
  heads?: GivenHead[];
  /** Token vectors, when the source gives embeddings: Q = K = these. */
  embeddings?: number[][];
  causal?: boolean;
  /** The query positions the scene walks, in order. Default: every token. */
  path?: number[];
  measure?: Measure;
}

export interface PatchAttentionInput {
  image: Rgb;
  /** Patches along the longer side; the other follows the picture's aspect. */
  grid: number;
  heads?: GivenHead[];
  /** Patch indices (row-major) the scene walks. Default: 4 patches, farthest-point over content. */
  path?: number[];
}

/* --------------------------------------------------------------- the slots */

/** One sentence the frames alone must convey. */
export const TAKEAWAY =
  "Each query's weights are a softmax over its scores with every key, so they sum to 1; the query “{query}” weights “{top}” most ({weight}).";

/* ------------------------------------------------------------------ tokens */

export function tokenAttention(input: TokenAttentionInput, region: Region): MechanismResult {
  const { tokens } = input;
  const n = tokens.length;
  if (n < 2) throw new Error("attention: needs at least two tokens");
  const measure = input.measure ?? roughMeasure;
  let heads: HeadQK[];
  if (input.heads?.length) heads = givenHeads(input.heads, n);
  else if (input.embeddings) {
    if (input.embeddings.length !== n)
      throw new Error(`attention: ${input.embeddings.length} embeddings for ${n} tokens`);
    const e = matrix(input.embeddings, "embeddings");
    heads = [{ name: "embedding", q: e.x, k: e.x, d: e.d }];
  } else {
    const c = trigramFeatures(tokens);
    const p = sinusoidal(n, POSITION_DIM);
    heads = [
      { name: "content", q: c, k: c, d: TRIGRAM_DIM },
      { name: "position", q: p, k: p, d: POSITION_DIM },
    ];
  }
  const weights = heads.map((h) => attentionWeights(h.q, h.k, n, n, h.d, { causal: input.causal }));
  const path = input.path ?? tokens.map((_, i) => i);
  for (const i of path)
    if (!Number.isInteger(i) || i < 0 || i >= n)
      throw new Error(`attention: path names token ${i}`);

  // Layout: keys on top, queries below, every head's matrix under them.
  const { width: W, height: H } = region;
  const size = TYPE.label;
  const padX = 18;
  const gap = 14;
  const boxH = size + 28;
  const widths = tokens.map((t) => measure(t, size) + 2 * padX);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (n - 1);
  if (total > W)
    throw new Error(
      `attention: ${n} tokens need ${Math.round(total)}px at ${size}px, the region is ${W}px; pass fewer tokens`,
    );
  const x0 = (W - total) / 2;
  const xs = widths.map((_, i) => x0 + widths.slice(0, i).reduce((a, b) => a + b, 0) + gap * i);
  const keyY = size + 20; // room for the weight values above the keys
  const qY = keyY + boxH + Math.round(H * 0.22);
  const matTop = qY + boxH + 40;
  const matSide = Math.min(H - matTop - (size + 24), (W - 80 * (heads.length - 1)) / heads.length);
  if (matSide < 80)
    throw new Error(`attention: the region (${W}×${H}) leaves no room for the matrices`);
  const matX0 = (W - (heads.length * matSide + 80 * (heads.length - 1))) / 2;

  const rasters: Record<string, Raster> = {};
  weights.forEach((w, h) => {
    rasters[`matrix-${h}`] = { heat: normalizeMax({ w: n, h: n, d: w }), role: "accent", alpha: 1 };
  });

  const frames: Frame[] = path.map((qi, s) => {
    const w0 = weights[0] as Float32Array;
    const row = Array.from(w0.subarray(qi * n, qi * n + n));
    const maxw = Math.max(...row);
    const top = row.indexOf(maxw);
    const prims: Prim[] = [];
    const cx = (i: number) => (xs[i] as number) + (widths[i] as number) / 2;
    // Lines from the query to every key, thickness and opacity by weight.
    row.forEach((wj, j) => {
      if (wj <= 0) return;
      prims.push({
        p: "line",
        id: `l${j}`,
        x1: cx(qi),
        y1: qY,
        x2: cx(j),
        y2: keyY + boxH,
        role: "accent",
        width: 2 + 14 * (wj / maxw),
        opacity: 0.15 + 0.85 * (wj / maxw),
      });
    });
    tokens.forEach((t, j) => {
      prims.push({
        p: "rect",
        id: `k${j}`,
        x: xs[j] as number,
        y: keyY,
        w: widths[j] as number,
        h: boxH,
        heat: (row[j] as number) / maxw,
        role: "rule",
        width: 2,
        radius: 8,
      });
      prims.push({
        p: "text",
        id: `kt${j}`,
        x: cx(j),
        y: keyY + 14,
        size,
        role: "auto",
        anchor: "middle",
        text: t,
      });
      prims.push({
        p: "rect",
        id: `q${j}`,
        x: xs[j] as number,
        y: qY,
        w: widths[j] as number,
        h: boxH,
        fill: j === qi ? "accent" : "panel",
        role: j === qi ? "accent" : "rule",
        width: 2,
        radius: 8,
      });
      prims.push({
        p: "text",
        id: `qt${j}`,
        x: cx(j),
        y: qY + 14,
        size,
        role: j === qi ? "auto" : "muted",
        anchor: "middle",
        text: t,
        weight: j === qi ? 700 : 500,
      });
    });
    // The three largest weights, as plain values over their keys.
    const order = row.map((v, j) => [v, j] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [v, j] of order.slice(0, 3))
      prims.push({
        p: "text",
        id: `v${j}`,
        x: cx(j),
        y: 0,
        size,
        role: "accent",
        anchor: "middle",
        text: fmt(v),
        weight: 700,
      });
    // Every head's matrix, the query's row outlined; the path so far as a dashed trail.
    heads.forEach((hd, h) => {
      const mx = matX0 + h * (matSide + 80);
      prims.push({
        p: "image",
        id: `m${h}`,
        x: mx,
        y: matTop,
        w: matSide,
        h: matSide,
        layer: `matrix-${h}`,
        pixelated: true,
      });
      prims.push({
        p: "rect",
        id: `mf${h}`,
        x: mx,
        y: matTop,
        w: matSide,
        h: matSide,
        role: "rule",
        width: 2,
      });
      const cell = matSide / n;
      prims.push({
        p: "rect",
        id: `mr${h}`,
        x: mx,
        y: matTop + qi * cell,
        w: matSide,
        h: cell,
        role: "fg",
        width: 4,
      });
      // The path so far: every earlier query's row, outlined thin.
      for (const i of new Set(path.slice(0, s)))
        if (i !== qi)
          prims.push({
            p: "rect",
            id: `mv${h}-${i}`,
            x: mx,
            y: matTop + i * cell,
            w: matSide,
            h: cell,
            role: "muted",
            width: 2,
          });
      prims.push({
        p: "text",
        id: `mh${h}`,
        x: mx + matSide / 2,
        y: matTop + matSide + 12,
        size,
        role: "muted",
        anchor: "middle",
        ...headSlot(hd.name, h),
      });
    });
    return {
      id: `q${s}`,
      prims,
      vars: { query: tokens[qi] as string, top: tokens[top] as string, weight: fmt(maxw) },
    };
  });

  const last = frames[frames.length - 1] as Frame;
  return {
    rasters,
    frames,
    data: { heads: heads.map((h) => h.name), weights, n },
    vars: last.vars,
  };
}

/* ----------------------------------------------------------------- patches */

/** Farthest-point order over feature rows, from the row of largest norm: `count` well-spread picks. */
export function farthestPoints(x: Float32Array, n: number, d: number, count: number): number[] {
  const dist2 = (a: number, b: number) => {
    let s = 0;
    for (let c = 0; c < d; c++) s += ((x[a * d + c] as number) - (x[b * d + c] as number)) ** 2;
    return s;
  };
  let first = 0;
  let best = -1;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < d; c++) s += (x[i * d + c] as number) ** 2;
    if (s > best) {
      best = s;
      first = i;
    }
  }
  const picks = [first];
  const near = new Float32Array(n).fill(Number.POSITIVE_INFINITY);
  while (picks.length < Math.min(count, n)) {
    const last = picks[picks.length - 1] as number;
    let far = -1;
    let at = 0;
    for (let i = 0; i < n; i++) {
      near[i] = Math.min(near[i] as number, dist2(i, last));
      if ((near[i] as number) > far) {
        far = near[i] as number;
        at = i;
      }
    }
    picks.push(at);
  }
  return picks;
}

export function patchAttention(input: PatchAttentionInput, region: Region): MechanismResult {
  const { image } = input;
  const landscape = image.w >= image.h;
  const cols = landscape ? input.grid : Math.max(2, Math.round((input.grid * image.w) / image.h));
  const rows = landscape ? Math.max(2, Math.round((input.grid * image.h) / image.w)) : input.grid;
  const n = cols * rows;
  if (input.grid < 2 || n > 1024)
    throw new Error(`attention: a ${cols}×${rows} patch grid is out of range`);
  const content = patchContent(image, cols, rows);
  let heads: HeadQK[];
  if (input.heads?.length) heads = givenHeads(input.heads, n);
  else {
    const p = patchPosition(cols, rows);
    heads = [
      { name: "content", q: content, k: content, d: 48 },
      { name: "position", q: p, k: p, d: POSITION_DIM },
    ];
  }
  const weights = heads.map((h) => attentionWeights(h.q, h.k, n, n, h.d));
  const path = input.path ?? farthestPoints(content, n, 48, 4);
  for (const i of path)
    if (!Number.isInteger(i) || i < 0 || i >= n)
      throw new Error(`attention: path names patch ${i}`);

  const { width: W, height: H } = region;
  const size = TYPE.label;
  const big = fitBox(image.w, image.h, 0, 0, W * 0.6, H - (size + 24));
  const sideX = W * 0.6 + 60;
  const sideW = W - sideX;
  const slotH = (H - 0) / heads.length;
  const smalls = heads.map((_, h) =>
    fitBox(image.w, image.h, sideX, h * slotH, sideW, slotH - (size + 24)),
  );
  // The picture at the size it is drawn, at most 960 px wide (cost bound).
  const sw = Math.min(960, Math.round(big.w));
  const shown = resample(image, sw, Math.max(1, Math.round((sw * image.h) / image.w)));
  const rasters: Record<string, Raster> = { image: { rgb: shown } };
  path.forEach((qi, s) => {
    weights.forEach((w, h) => {
      rasters[`map-${h}-${s}`] = {
        // A spotlight: patches the query weights little fade toward the panel colour (dark or light), so it reads on any picture.
        heat: spotlight(normalizeMax({ w: cols, h: rows, d: w.slice(qi * n, qi * n + n) })),
        role: "panel",
        alpha: 0.78,
      };
    });
  });
  const frames: Frame[] = path.map((qi, s) => {
    const prims: Prim[] = [];
    const panels = [big, ...smalls];
    panels.forEach((b, pi) => {
      const h = Math.max(0, pi - 1);
      prims.push({ p: "image", id: `img${pi}`, x: b.x, y: b.y, w: b.w, h: b.h, layer: "image" });
      prims.push({
        p: "image",
        id: `map${pi}`,
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        layer: `map-${h}-${s}`,
        pixelated: true,
      });
      const cw = b.w / cols;
      const ch = b.h / rows;
      const qc = qi % cols;
      const qr = Math.floor(qi / cols);
      prims.push({
        p: "rect",
        id: `qp${pi}`,
        x: b.x + qc * cw,
        y: b.y + qr * ch,
        w: cw,
        h: ch,
        role: "fg",
        width: pi === 0 ? 6 : 4,
      });
      if (pi === 0 && s > 0)
        prims.push({
          p: "path",
          id: "trail",
          pts: flat(
            path
              .slice(0, s + 1)
              .map(
                (i) =>
                  [b.x + ((i % cols) + 0.5) * cw, b.y + (Math.floor(i / cols) + 0.5) * ch] as const,
              ),
          ),
          role: "fg",
          width: 5,
          dash: true,
        });
    });
    prims.push({
      p: "text",
      id: "ql",
      x: big.x,
      y: big.y + big.h + 10,
      size,
      role: "muted",
      anchor: "start",
      slot: "query",
    });
    smalls.forEach((b, h) => {
      prims.push({
        p: "text",
        id: `hl${h}`,
        x: b.x,
        y: b.y + b.h + 10,
        size,
        role: "muted",
        anchor: "start",
        ...headSlot((heads[h] as HeadQK).name, h),
      });
    });
    const row = (weights[0] as Float32Array).subarray(qi * n, qi * n + n);
    let top = 0;
    for (let j = 1; j < n; j++) if ((row[j] as number) > (row[top] as number)) top = j;
    return {
      id: `q${s}`,
      prims,
      vars: { query: `#${qi}`, top: `#${top}`, weight: fmt(row[top] as number) },
    };
  });
  return {
    rasters,
    frames,
    data: { heads: heads.map((h) => h.name), cols, rows, path, weights },
    vars: (frames[frames.length - 1] as Frame).vars,
  };
}

/** 1 − v: where a spotlight darkens. */
function spotlight(g: Gray): Gray {
  const d = new Float32Array(g.d.length);
  for (let i = 0; i < d.length; i++) d[i] = 1 - (g.d[i] as number);
  return { w: g.w, h: g.h, d };
}

/** A map divided by its maximum, so the strongest weight draws at full strength. */
function normalizeMax(g: Gray): Gray {
  let mx = 0;
  for (let i = 0; i < g.d.length; i++) mx = Math.max(mx, g.d[i] as number);
  const d = new Float32Array(g.d.length);
  for (let i = 0; i < d.length; i++) d[i] = mx > 0 ? (g.d[i] as number) / mx : 0;
  return { w: g.w, h: g.h, d };
}

export function takeaway(r: MechanismResult): string {
  return fillTemplate(TAKEAWAY, r.vars);
}

/** The patch mode's sentence: a patch has no word to name. */
export const TAKEAWAY_PATCHES =
  "Each patch's weights over every patch are a softmax that sums to 1; the outlined query patch weights the patches that look like it most, and nearby patches most in the position head.";

/**
 * A head's caption slot: a derived head is captioned by what it compares
 * (`content`, `position`), the source's own heads (and embeddings) by number.
 */
function headSlot(name: string, h: number): { slot: string; vars?: Record<string, number> } {
  if (name === "content" || name === "position") return { slot: name };
  return { slot: "head", vars: { h: h + 1 } };
}
