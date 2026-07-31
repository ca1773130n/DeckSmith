/**
 * The perturbations, one axis per beat.
 *
 * Each beat is varied along the axis its own `TUNED:` constant was fitted to —
 * the pipeline by stage count, the grid by lattice size, the callout by lines
 * per panel. Every one of these is inside what `types.ts` accepts, so the
 * emitter is obliged to draw them, and the fitted constants are exactly what the
 * tuning log predicted would break. Varying axes nobody fitted anything to would
 * measure nothing.
 *
 * Level 0 is the shipped ThinkSR deck verbatim — the control. Levels rise to the
 * schema's own maximum, so the last level is the worst case the type allows
 * rather than an invented extreme.
 *
 * THIS FILE IS THE CORPUS, and `scripts/sweep.mjs` records its sha256 in the
 * ledger. Edit it and every receipt goes stale, loudly, because a verdict about
 * a different set of inputs is not evidence about this one.
 */

const WORD = "Incomprehensibilities";
const LONG =
  "Shifting the window by half its width lets information cross the boundary between two neighbouring regions";

/** Headlines of one, two and three lines at 76px in a 1700px box. */
const HEADLINES = [
  "The encoder makes the field",
  "The encoder makes the field; the partition keeps it, and nothing is discarded",
  `${LONG}, which is the whole point of the scheme and the reason the token count survives`,
];

const bars = (n) =>
  Array.from({ length: n }, (_, i) => ({
    label: i % 3 === 0 ? `${WORD} ${i}` : `M${i}`,
    value: 0.5 + i * 0.31,
    ...(i === 1 ? { tone: "a" } : {}),
  }));

const stages = (n) =>
  Array.from({ length: n }, (_, i) => ({
    label: i % 2 === 0 ? WORD : `S${i}`,
    note: i % 2 === 0 ? "shared ticks" : undefined,
  }));

const layers = (n) =>
  Array.from({ length: n }, (_, i) => ({
    label: i % 2 === 0 ? WORD : `Layer ${i}`,
    note: i % 3 === 0 ? "token count preserved" : undefined,
  }));

const lines = (n, long) =>
  Array.from({ length: n }, (_, i) => (long ? `${LONG.slice(0, 40 + i * 12)}` : `line ${i}`));

// Rounded to 2dp because a storyboard carries measurements, not raw floats.
// Unrounded, `28.9 + Math.log1p(i)` renders as "29.593147180559942" — an
// 18-character label — and the emitter drew exactly what it was handed, which
// the sweep then scored as four line-chart defects that were entirely this
// generator's doing. A perturbation must vary the CONTENT, not smuggle in a
// malformed input nothing claims to handle.
const points = (n) =>
  Array.from({ length: n }, (_, i) => ({
    x: `T=${i}`,
    y: Number((28.9 + Math.log1p(i)).toFixed(2)),
  }));

const rows = (n, cols) =>
  Array.from({ length: n }, (_, i) => [
    i % 2 === 0 ? `${WORD.slice(0, 9)}-${i}` : `M${i}`,
    ...Array.from({ length: cols - 1 }, (_, j) => (28 + i + j / 10).toFixed(3)),
  ]);

/**
 * `levels[k]` gives the params for that beat at severity k. Every entry must be
 * schema-legal — a variant `storyboardSchema` rejects is a bug in this file
 * rather than a finding, and the sweep reports it as `build-error` so the
 * difference is never silently scored as a defect.
 */
export const PERTURBATIONS = {
  "b01-title": {
    axis: "headline length",
    levels: [0, 1, 2].map((k) => ({
      eyebrow: "Paper analysis",
      headline: HEADLINES[k],
      sub: WORD,
    })),
  },
  "b02-pipeline": {
    axis: "stage count (schema 2..6)",
    levels: [2, 3, 4, 5, 6].map((n) => ({
      headline: HEADLINES[1],
      stages: stages(n),
      note: "Parameters are shared across every tick.",
    })),
  },
  "b03-annotated-figure": {
    axis: "note count and length",
    levels: [1, 2, 3, 4, 5].map((n) => ({
      eyebrow: "Architecture",
      headline: HEADLINES[n > 3 ? 2 : 1],
      notes: Array.from({ length: n }, (_, i) => ({
        x: 0.15 + i * 0.17,
        y: 0.7,
        text: i % 2 === 0 ? LONG.slice(0, 24) : WORD,
        tone: ["a", "b", "c", "d"][i % 4],
      })),
    })),
  },
  "b04-grid": {
    axis: "lattice size",
    levels: [
      [4, 3],
      [8, 6],
      [12, 8],
      [18, 12],
      [24, 16],
    ].map(([cols, rowsN]) => ({
      headline: HEADLINES[1],
      cols,
      rows: rowsN,
      regions: [
        { x: 0, y: 0, w: Math.min(3, cols), h: Math.min(3, rowsN), label: WORD, tone: "a" },
        {
          x: Math.max(0, cols - 3),
          y: Math.max(0, rowsN - 3),
          w: Math.min(3, cols),
          h: Math.min(3, rowsN),
          label: "the next window",
          tone: "b",
        },
      ],
      note: "Token count is identical before and after the update.",
    })),
  },
  "b05-equation-walk": {
    axis: "equation length",
    levels: [
      "y = \\mathcal{E}(x)",
      "\\mathbf{F}=\\mathcal{E}(\\mathbf{I}_{\\mathrm{LR}}),\\qquad \\mathbf{X}=\\mathcal{W}(\\mathbf{F})",
      "\\mathbf{Y} = \\sum_{i=1}^{N} \\alpha_i \\mathcal{W}(\\mathbf{F}_i) + \\beta \\mathcal{E}(\\mathbf{I}_i) - \\gamma \\mathcal{D}(\\mathbf{Z}_i)",
    ].map((tex) => ({
      headline: HEADLINES[1],
      tex,
      terms: [
        { tex: "\\mathcal{E}", label: LONG.slice(0, 46), tone: "a" },
        { tex: "\\mathcal{W}", label: WORD, tone: "b" },
      ],
    })),
  },
  "b06-stack": {
    axis: "layer count (schema 2..7)",
    levels: [2, 4, 5, 6, 7].map((n) => ({
      headline: HEADLINES[1],
      layers: layers(n),
      note: "built bottom-up",
    })),
  },
  "b07-split-compare": {
    axis: "line count and length",
    levels: [1, 2, 3, 4, 6].map((n) => ({
      headline: HEADLINES[1],
      left: { label: "Window-wise CTM", lines: lines(n, n > 2) },
      right: { label: WORD, lines: lines(n, n > 2) },
      note: "Same window partition; different interface.",
    })),
  },
  "b08-bar-compare": {
    axis: "bar count (schema 2..8)",
    levels: [2, 4, 6, 8].map((n) => ({
      headline: HEADLINES[1],
      unit: "M params",
      bars: bars(n),
      note: "Smaller is better.",
    })),
  },
  "b09-data-table": {
    axis: "row and column count",
    levels: [
      [3, 3],
      [5, 3],
      [7, 4],
      [9, 5],
      [10, 6],
    ].map(([n, cols]) => ({
      headline: HEADLINES[1],
      columns: ["Method", ...Array.from({ length: cols - 1 }, (_, j) => `Metric ${j + 1}`)],
      rows: rows(n, cols),
      highlight: [],
      note: "Comparison figures are quoted from their papers.",
    })),
  },
  "b10-line-chart": {
    axis: "point count",
    levels: [2, 5, 8, 12, 16].map((n) => ({
      headline: HEADLINES[1],
      xLabel: "thought ticks",
      yLabel: "PSNR-Y (dB)",
      points: points(n),
      deltas: Array.from({ length: n - 1 }, (_, i) => `+${(0.9 / (i + 1)).toFixed(2)}`),
      readout: "Trained to the last tick.",
    })),
  },
  "b11-claim-figure": {
    axis: "claim length",
    levels: [
      "Reconstruction improves.",
      "Reconstruction improves monotonically across ticks on all 100 validation images.",
      `${LONG}. ${LONG}.`,
    ].map((claim) => ({ eyebrow: "Qualitative", headline: HEADLINES[1], claim })),
  },
  "b12-callout": {
    axis: "panels and lines per panel",
    levels: [
      [1, 2],
      [2, 2],
      [2, 4],
      [3, 4],
      [3, 8],
    ].map(([panels, perPanel]) => ({
      headline: HEADLINES[1],
      panels: Array.from({ length: panels }, (_, i) => ({
        label: i === 0 ? "abstract" : `${WORD} ${i}`,
        lines: Array.from({ length: perPanel }, (_, j) =>
          j % 2 === 0 ? "PSNR-Y 28.10 → 30.28" : LONG.slice(0, 52),
        ),
      })),
      note: "The body states a different gain from the table.",
    })),
  },
};

/** Every (beat, level) pair, flattened and in a fixed order. */
export const CELLS = Object.entries(PERTURBATIONS).flatMap(([beatId, spec]) =>
  spec.levels.map((props, level) => ({ beatId, level, axis: spec.axis, props })),
);

/** How many levels the deepest axis has — one level-deck is built per index. */
export const LEVELS = Math.max(...Object.values(PERTURBATIONS).map((s) => s.levels.length));

/**
 * A cell's params, as a beat the shipped storyboard schema accepts.
 *
 * The perturbations above inline their data — a table's rows, an equation's TeX
 * — because that is what makes them readable as a corpus. A DeckSmith beat
 * refers to the SOURCE by id instead, so for those three archetypes the inline
 * data is injected into a copy of the source under a fresh id. The two figures
 * are the demo's own, by id, because a figure's pixels are not a thing this file
 * can perturb.
 *
 * `src` is mutated on purpose: one source copy per level-deck accumulates every
 * table and equation that deck needs.
 */
export function deckBeat(cell, src, core) {
  const { beatId, props, level } = cell;
  const tag = `${beatId}-${level}`;
  const id = beatId.slice(0, 3);
  const beat = (archetype, params) => ({ ...core, id, archetype, params });

  switch (beatId) {
    case "b03-annotated-figure":
      return beat("annotated-figure", { ...props, figureId: "fig-compare" });
    case "b05-equation-walk": {
      const eqId = `eq-${tag}`;
      src.equations.push({ id: eqId, tex: props.tex, display: true });
      const { tex, ...rest } = props;
      return beat("equation-walk", { ...rest, equationId: eqId });
    }
    case "b09-data-table": {
      const tblId = `tbl-${tag}`;
      src.tables.push({ id: tblId, caption: "Table", columns: props.columns, rows: props.rows });
      const { columns, rows: r, ...rest } = props;
      return beat("data-table", { ...rest, tableId: tblId });
    }
    case "b11-claim-figure":
      return beat("claim-figure", { ...props, figureId: "fig-progress" });
    default:
      return beat(beatId.replace(/^b\d+-/, ""), props);
  }
}
