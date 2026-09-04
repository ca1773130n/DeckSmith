// The showcase deck: every one of the twelve archetypes, on the real ThinkSR
// analysis. Regenerate with `node demo/build.mjs && npx decksmith build ...`,
// or just run `npm run demo`.
import { writeFile } from "node:fs/promises";

const source = {
  id: "thinksr",
  title: "ThinkSR: compact thought, dense output",
  lang: "en",
  sections: [
    { id: "sec1", depth: 1, heading: "The mismatch", text: "CTM's thought representation is compact; super-resolution needs a dense spatial field." },
    { id: "sec2", depth: 2, heading: "Method", text: "A persistent dense carrier, read and updated by a compact thought process." },
    { id: "sec3", depth: 2, heading: "Results", text: "Competitive with CNN baselines; behind recent lightweight transformers." },
  ],
  // `sectionId` and `mention` are what the planner has instead of eyes: which
  // part of the argument a picture sits in, and the sentence the prose refers to
  // it by. `ingest` reads both off a real document; this source is hand-written,
  // so they are written out here — a field the demo never carries is a field no
  // end-to-end run ever exercises.
  figures: [
    {
      id: "fig-compare",
      src: "fig-compare.jpg",
      caption: "Figure 1 — CTM, a window-wise adaptation, and DQ-CTM compared.",
      width: 1373,
      height: 692,
      sectionId: "sec1",
      mention: "Figure 1 puts CTM beside a window-wise adaptation and DQ-CTM; the three differ only in what each hands the thought block.",
    },
    {
      id: "fig-arch",
      src: "fig-arch.jpg",
      caption: "Figure 2 — One DQ-CTM tick: the compact thought path above, the dense key-value path below.",
      width: 1373,
      height: 381,
      sectionId: "sec2",
      mention: "Figure 2 draws a single tick, with the compact thought path along the top and the dense key-value path underneath it.",
    },
    {
      id: "fig-progress",
      src: "fig-progress.jpg",
      caption: "Figure 4 — Reconstruction at T=0 through T=4 against bicubic and ground truth.",
      width: 1298,
      height: 578,
      sectionId: "sec3",
      mention: "Figure 4 shows the reconstruction at T=0 through T=4 on three crops, against bicubic and the ground truth.",
    },
    {
      id: "fig-error",
      src: "fig-error.jpg",
      caption: "Figure 5 — Absolute-error maps on the same crops, one shared colour scale.",
      width: 1298,
      height: 915,
      sectionId: "sec3",
      mention: "Figure 5 maps the absolute error over the same three crops on one shared colour scale, so what a tick fails to fix stays visible.",
    },
  ],
  equations: [
    { id: "eq-carrier", tex: "\\mathbf{F}=\\mathcal{E}(\\mathbf{I}_{\\mathrm{LR}}),\\qquad \\mathbf{X}=\\mathcal{W}(\\mathbf{F})", display: true },
    // The same statement with the carrier substituted in. It is a SECOND
    // equation in the source rather than a rewrite of the first, because
    // `equation-morph` carries terms between two equations the source states —
    // the beat is the substitution, so both sides have to exist to be cited.
    { id: "eq-composed", tex: "\\mathbf{X}=\\mathcal{W}\\big(\\mathcal{E}(\\mathbf{I}_{\\mathrm{LR}})\\big)", display: true },
  ],
  tables: [
    {
      id: "tbl-bench",
      caption: "Table 1 — ×4 lightweight super-resolution, average over five benchmarks.",
      columns: ["Method", "Params", "Average"],
      rows: [
        ["CARN", "1.592M", "28.970"],
        ["IMDN", "0.715M", "28.968"],
        ["RFDN", "0.550M", "29.022"],
        ["CATANet", "0.535M", "29.482"],
        ["DQ-CTM-SR", "1.129M", "28.983"],
      ],
    },
  ],
};

// One sentence per stop, in reveal order — `narrate` cuts the audio on the same
// boundaries the emitter cuts the animation, so a spare sentence lands on the
// wrong reveal and a missing one leaves a reveal silent. The counts below are
// what `stopsFor` reports for these params, which is why they look arbitrary.
const script = {
  b01: "This paper puts a thought process that stays small up against a task whose output has to stay large — every pixel of it.",
  b02: [
    "The encoder does the heavy lifting first, in the style SwinIR established.",
    "Then the field is cut into windows, and nothing is pooled away on the way through.",
    "The thought machine sits here in the middle, working on what the windows hold.",
    "Only at the very end does the decoder upsample, four times over.",
    "That loop is a single tick, and it runs in place rather than around the whole pipeline.",
    "Every tick reuses the same weights, so thinking for longer costs time and not memory.",
  ].join(" "),
  b03: [
    // Not "look at the bottom row": the beat crops to that row, so there is no
    // other row on screen to be the bottom of, and the instruction sends a
    // viewer hunting for something that was cropped away. Narration may only
    // point at what the FRAME shows, never at the source figure it came from.
    "The three approaches sit side by side here, and they differ only in what they hand the thought block.",
    "The windows come first: the field is partitioned, and each one is handled on its own.",
    "The block in the middle is shared, the same weights for every window.",
    "And what comes out is still a dense field, one query for every position in it.",
  ].join(" "),
  b04: [
    "Picture the feature map as a grid of tokens.",
    "Attention runs inside one window at a time.",
    "The next window does the same, and at this stage the two never mix.",
    "Count the tokens before a tick and after it and you get the same number.",
  ].join(" "),
  b05: [
    "The encoder turns the low-resolution image into a dense feature field.",
    "The partition then cuts that field into windows without throwing any of it away.",
  ].join(" "),
  b06: [
    "Take the carrier out of the first line and put it where F stands in the second.",
    "The encoder's output slides inside the window read, and the two statements become one composition.",
  ].join(" "),
  b07: [
    "At the bottom is the carrier, and it keeps every token it started with.",
    "Above it sit the queries — one for each position, rather than one for each window.",
    "Synchronisation is the part that remembers: every neuron carries its own history.",
    "The compact state on top is what actually changes from one tick to the next.",
  ].join(" "),
  b08: [
    // The authors' own drawing of a tick, so the narration may point only at
    // what that drawing shows — two rows, and what each of them does to the
    // carrier. Same rule as b03: never at the source figure it was taken from.
    "This is the authors' own drawing of one tick, and the two rows are the two halves of it.",
    "The compact state runs along the top and ends in a dense query projection; underneath, the carrier is read as dense keys and values and comes back updated, added to what arrived.",
  ].join(" "),
  b09: [
    // "second from the top" was wrong AND unknowable: the bars are drawn in the
    // order they are listed, so DQ-CTM-SR is fourth from the top and second by
    // value. Ordinals in narration are claims about the DATA — see the NARRATION
    // rules in src/plan/prompt.ts, which exist because of this sentence.
    "On parameters the method is the second largest here, at 1.13 million.",
    "So this is not the cheap option, and the paper never claims it is.",
  ].join(" "),
  b10: [
    "These are five-benchmark averages at four times upscaling.",
    "CATANet is the one to beat, at 29.48.",
    "The method here comes in at 28.98 — ahead of two CNN baselines, behind the transformer.",
    "Only that last row was trained for this paper. Every other number is quoted.",
  ].join(" "),
  b11: [
    "The first tick is worth almost a full decibel.",
    "The fourth is worth under a tenth, and training stopped there, so nothing past it is demonstrated.",
  ].join(" "),
  b12: [
    "On the left each column is one more tick, and in the top two rows the detail keeps arriving.",
    "On the right is what is still wrong, on the same three crops — and the bottom row stays bright at every tick.",
  ].join(" "),
  b13: [
    "One warning to carry into the paper itself.",
    "The abstract reports this sweep running from 28.10 up to 30.28.",
    "The table for the same sweep says 28.91 to 30.47, and the body quotes a gain of 1.46 decibels where the table gives 0.59.",
  ].join(" "),
};

const beat = (id, archetype, params, extra = {}) => ({
  id, archetype, params,
  intent: extra.intent ?? "…",
  narration: script[id],
  evidence: extra.evidence ?? [],
  weight: extra.weight ?? 0.8,
  seconds: extra.seconds ?? 9,
});

const storyboard = {
  sourceId: "thinksr",
  title: "ThinkSR: compact thought, dense output",
  lang: "en",
  theme: "ink",
  beats: [
    beat("b01", "title", {
      eyebrow: "Paper analysis · dense prediction × continuous thought",
      headline: "Compact thought collides with dense output",
      sub: "Dense-Query Continuous Thought Machine (DQ-CTM)",
    }, { intent: "Name the tension the paper is about.", weight: 0.95, seconds: 6 }),

    beat("b02", "pipeline", {
      eyebrow: "Method",
      headline: "One pass in, one pass out, and a loop in the middle",
      stages: [
        { label: "Encode", note: "SwinIR-style" },
        { label: "Window", note: "no pooling", tone: "a" },
        { label: "DQ-CTM", note: "shared ticks", tone: "b" },
        { label: "Decode", note: "×4 upsample" },
      ],
      loop: { from: 2, to: 2, label: "one thought tick" },
      note: "Parameters are shared across every tick.",
    }, { intent: "The recurrence sits after the encoder, not around it.", evidence: [{ kind: "section", id: "sec2" }], weight: 0.95 }),

    beat("b03", "annotated-figure", {
      eyebrow: "Architecture",
      headline: "Every window keeps its own position-wise query",
      figureId: "fig-compare",
      crop: { x: 0.02, y: 0.52, w: 0.96, h: 0.46 },
      notes: [
        { x: 0.30, y: 0.78, text: "window partitioning", tone: "a" },
        { x: 0.52, y: 0.78, text: "the shared DQ-CTM block", tone: "b" },
        { x: 0.86, y: 0.78, text: "pixel-wise dense field", tone: "c" },
      ],
    }, { intent: "DQ-CTM produces one query per position, not one per window.", evidence: [{ kind: "figure", id: "fig-compare" }], weight: 0.9 }),

    beat("b04", "grid", {
      eyebrow: "Representation",
      headline: "Attention is computed inside windows, and no token is pooled away",
      cols: 12, rows: 8,
      regions: [
        { x: 0, y: 0, w: 4, h: 4, label: "one window", tone: "a" },
        { x: 6, y: 3, w: 4, h: 4, label: "the next window", tone: "b" },
      ],
      note: "Token count is identical before and after the update.",
    }, { intent: "The carrier keeps every position across ticks.", weight: 0.85 }),

    beat("b05", "equation-walk", {
      eyebrow: "1 · Persistent dense carrier",
      headline: "The encoder makes the field; the partition keeps it",
      equationId: "eq-carrier",
      terms: [
        { tex: "\\mathcal{E}", label: "SwinIR-style encoder — LR in, dense feature field out", tone: "a" },
        { tex: "\\mathcal{W}", label: "window partition — every token survives it", tone: "b" },
      ],
    }, { intent: "Encoding and partitioning, with nothing discarded.", evidence: [{ kind: "equation", id: "eq-carrier" }], weight: 0.85 }),

    // THE WALK, THEN THE SUBSTITUTION. b05 names the two symbols; this beat
    // uses them. The three terms are keyed because they are what the algebra
    // preserves — the carrier travels inside the window read, and the reader
    // watches the two statements collapse into one rather than being shown a
    // second slide and asked to spot the difference.
    beat("b06", "equation-morph", {
      eyebrow: "1 · Persistent dense carrier",
      headline: "Substituting the carrier leaves one composition",
      fromId: "eq-carrier",
      toId: "eq-composed",
      terms: [
        { tex: "\\mathcal{E}(\\mathbf{I}_{\\mathrm{LR}})", label: "the encoded carrier — it moves, it is not recomputed", tone: "a" },
        { tex: "\\mathcal{W}", label: "the window read, now applied directly", tone: "b" },
        { tex: "\\mathbf{X}", label: "the output, unchanged by the rewrite", tone: "c" },
      ],
    }, {
      intent: "The two lines are one function, written apart.",
      evidence: [{ kind: "equation", id: "eq-carrier" }, { kind: "equation", id: "eq-composed" }],
      weight: 0.8,
    }),

    beat("b07", "stack", {
      eyebrow: "2 · Compact thought",
      headline: "The thought state is a stack the carrier is read through",
      layers: [
        { label: "Dense carrier", note: "token count preserved" },
        { label: "Dense queries", note: "one per position" },
        { label: "Synchronisation", note: "neuron-level history" },
        { label: "Compact state", note: "evolves per tick" },
      ],
    }, { intent: "The compact state never replaces the dense carrier.", weight: 0.8 }),

    // THE PAPER'S OWN TICK DIAGRAM, not a redrawing of it. This beat used to be
    // a split-compare of two lists whose content b03, b04 and b06 already make,
    // while Figure 2 — the one picture that shows a whole tick — went unused in
    // a deck built from the paper it came out of.
    beat("b08", "claim-figure", {
      eyebrow: "3 · One dense tick",
      headline: "One tick reads the carrier and adds its update back",
      claim: "A persistent dense carrier, read and updated by a compact thought process.",
      figureId: "fig-arch",
    }, { intent: "What one tick does to the carrier.", evidence: [{ kind: "figure", id: "fig-arch" }, { kind: "section", id: "sec2" }], weight: 0.9 }),

    beat("b09", "bar-compare", {
      eyebrow: "Cost",
      headline: "The method is mid-pack on parameters, not the smallest",
      unit: "M params",
      bars: [
        { label: "CATANet", value: 0.535, tone: "a" },
        { label: "RFDN", value: 0.550 },
        { label: "IMDN", value: 0.715 },
        { label: "DQ-CTM-SR", value: 1.129, tone: "c" },
        { label: "CARN", value: 1.592 },
      ],
      note: "Smaller is better; DQ-CTM-SR is second largest here.",
    }, { intent: "Where the method sits on cost.", evidence: [{ kind: "table", id: "tbl-bench" }], weight: 0.8 }),

    beat("b10", "data-table", {
      eyebrow: "Quantitative comparison · ×4",
      headline: "Competitive with CNN baselines, behind recent models",
      tableId: "tbl-bench",
      highlight: [
        { row: "CATANet", tone: "a" },
        { row: "DQ-CTM-SR", tone: "c" },
      ],
      note: "Comparison figures are quoted from their papers; only DQ-CTM-SR was trained here.",
    }, { intent: "The honest standing against the field.", evidence: [{ kind: "table", id: "tbl-bench" }], weight: 0.85 }),

    beat("b11", "line-chart", {
      eyebrow: "Thought sweep · 100 validation images",
      headline: "Each extra tick buys less than the one before it",
      xLabel: "thought ticks", yLabel: "PSNR-Y (dB)",
      points: [
        { x: "T=0", y: 28.91 }, { x: "T=1", y: 29.88 },
        { x: "T=2", y: 30.18 }, { x: "T=3", y: 30.38 }, { x: "T=4", y: 30.47 },
      ],
      deltas: ["+0.97", "+0.30", "+0.20", "+0.09"],
      readout: "Trained to T=4. Nothing beyond it is demonstrated.",
    }, { intent: "Progressive refinement, with diminishing returns.", weight: 0.95 }),

    // Two figures the paper draws over the SAME three crops, which is what makes
    // them a pair rather than two beats: the reconstruction says what arrived,
    // the error map says what did not.
    // ONE figure and a list, not two figures. Both of these are multi-panel
    // grids — seven columns and three rows — and side by side each got 770px of
    // a 1920 canvas, which drew every internal label at around 11px. The slide
    // passed every gate: the labels are inside a JPEG, so the type floor cannot
    // see them, and nothing else measures whether a picture is legible. It was
    // found by opening the frame. The error map is what the right-hand list is
    // ABOUT, so it stays as evidence and the paper keeps it.
    beat("b12", "split-compare", {
      eyebrow: "Qualitative",
      headline: "Where the ticks help, and where they do not",
      left: { label: "Reconstruction, T=1 → T=4", figureId: "fig-progress" },
      right: {
        label: "Absolute error, same crops",
        lines: [
          "typical crop — error fades by T=2",
          "strong improvement — texture arrives late",
          "difficult crop — stays bright at every tick",
        ],
      },
      note: "Rows are the same three crops in both: typical, strong improvement, difficult.",
    }, { intent: "The improvement is visible, and so is what is left over.", evidence: [{ kind: "figure", id: "fig-progress" }, { kind: "figure", id: "fig-error" }], weight: 0.75 }),

    beat("b13", "callout", {
      eyebrow: "Read it with care",
      headline: "The same experiment reports three different numbers",
      panels: [
        { label: "abstract", lines: ["PSNR-Y 28.10 → 30.28", "L1 0.0346 → 0.0235"] },
        { label: "sweep table", lines: ["PSNR-Y 28.91 → 30.47", "L1 0.0386 → 0.0229"] },
      ],
      note: "The body states a 1.4611 dB gain where the table gives 0.59 dB.",
    }, { intent: "A caveat a reader must carry into the paper.", weight: 0.7, seconds: 8 }),
  ],
};

await writeFile(new URL("./source.json", import.meta.url), `${JSON.stringify(source, null, 2)}\n`);
await writeFile(new URL("./storyboard.json", import.meta.url), `${JSON.stringify(storyboard, null, 2)}\n`);
console.log(`demo: ${storyboard.beats.length} beats, ${new Set(storyboard.beats.map((b) => b.archetype)).size} archetypes`);
