/**
 * THE COLLISION GATE — inside a chart, did two labels land on top of each other?
 *
 * WHY THIS EXISTS AND WHY IT IS OURS. `hyperframes check` has a rule for exactly
 * this, `content_overlap`, and it is STRUCTURALLY BLIND to a chart. Two reasons,
 * either of which alone is fatal:
 *
 *   - `isManagedFlowOverlap` (layoutAudit) exempts any pair of boxes that are
 *     both in normal flow under a shared flex/grid ancestor, on the sound
 *     grounds that a flex container is entitled to lay its children out however
 *     it likes. An SVG child computes `position: static`, so `isInFlow` is true
 *     of every `<text>` in the chart, and `.chartwrap` is the flex ancestor they
 *     all share. Every label pair in every chart is exempt, permanently.
 *   - `content_overlap` is not in `OFF_CANVAS`, so even if it fired it would
 *     arrive as upstream's severity and could never fail a DeckSmith build.
 *
 * MEASURED, not reasoned: `line-chart` with the three 2026-07-31 fixes reverted,
 * built as a one-beat deck and sampled at every stop inside the scene, comes
 * back `layout.findings: []` with `truncated: false`. The deck it passed is a
 * line chart whose value labels, delta labels and category labels print through
 * each other 69 times over. Neither of those two facts is reachable from here
 * without an upstream change, so the rule is ours.
 *
 * WHY SVG AND NOTHING ELSE. Scoping it wider would be re-implementing
 * `content_overlap` badly: outside SVG, elements overlap on purpose all the time
 * (a badge on a card, a caption over a plate), the flex exemption upstream
 * applies is CORRECT there, and a second opinion that disagrees with the shipped
 * gate is how two definitions of "broken" start drifting apart. Inside an `<svg>`
 * every glyph was placed by our own arithmetic at an absolute coordinate: two
 * text runs on the same pixels is never a layout engine's decision, it is always
 * our emitter getting the spacing wrong. Two archetypes emit `<text>` —
 * `line-chart` and `bar-compare` — so that is the whole blast radius.
 *
 * WHERE IT RUNS. Inside `fidelity`'s existing per-stop loop, on the page it has
 * already opened and seeked. No second browser, no second page, no second
 * `renderSeek`: the marginal cost is one `page.evaluate` per stop. It therefore
 * rides with `--fidelity`, which is right rather than merely convenient — the
 * one honest reason to pass `--no-fidelity` is a machine with no browser, and a
 * machine with no browser cannot run this either.
 *
 * AT A STOP, NOT AT A MIDPOINT. A chart builds: at t=0 the value labels have not
 * arrived and at the first hold the deltas have not. Measuring anywhere but a
 * declared stop would report a collision between a label that is on screen and
 * one that is fading in at opacity 0.3, which is motion, not a defect. The walk
 * drops anything hidden or fully transparent for the same reason.
 */
import type { Finding } from "../types.js";

/**
 * How much two runs must share, in BOTH axes, before it is a collision.
 *
 * 8px, carried across from the calibration this was fitted in (the
 * research-env perturbation sweep, 2026-07-31). Abutting boxes are the reason it
 * is not zero: a `<text>` run's client rect includes the font's leading, so two
 * lines of a stacked label overlap by a pixel or three while being perfectly
 * legible, and at 0 the sweep called every multi-line label a defect. 8px is
 * about a fifth of the 40px audience floor of invariant 5 — an overlap that
 * large is a fifth of a glyph body and is visible.
 */
export const MIN_OVERLAP = 8;

/** One painted run of text, in device pixels. */
export interface TextRun {
  /**
   * Which text node this rect came from, numbered in document order.
   *
   * IDENTITY, NOT THE STRING. Chrome hands back one client rect per line box, so
   * a wrapped `<text>` yields several runs that necessarily overlap; those are
   * one label, not a collision. The first version told them apart by comparing
   * `text`, which also exempted two GENUINELY different labels that happened to
   * agree — on the first 40 characters, since that is all `text` keeps — and
   * exempted a real collision between two elements showing the same rounded
   * value, which is exactly what a chart with repeated y-labels produces.
   */
  node: number;
  /** The run's string, truncated — for the message only, never for comparison. */
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Two runs that share pixels, and how many. */
export interface Overprint {
  a: string;
  b: string;
  /** Overlap extent, `[x, y]`, rounded. */
  overlap: [number, number];
}

/**
 * Serialised into the page: every visible text run inside this scene's SVGs.
 *
 * TEXT RANGES, NOT ELEMENT BOXES. `<g class="ptlab">` wraps every value label in
 * the chart, so its own box spans the entire plot and overlaps everything;
 * measuring elements would report the chart colliding with itself on every deck
 * ever built. A `Range` over the text node measures the glyphs, which is what
 * the audience sees overlapping.
 *
 * The walk starts at the SCENE and only begins collecting once it is inside an
 * `<svg>`, so the visibility test is applied to every ancestor on the way down —
 * a chart hidden inside a collapsed wrapper contributes nothing, rather than
 * contributing runs measured at a stale position.
 */
export function collectSvgTextRuns(sid: string): TextRun[] {
  const scene = document.querySelector(`[data-composition-id="${CSS.escape(sid)}"]`);
  if (!scene) return [];
  const runs: TextRun[] = [];
  let nodes = 0;

  const walk = (el: Element, inSvg: boolean): void => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    if (Number(style.opacity) === 0) return;
    const within = inSvg || el.tagName.toLowerCase() === "svg";

    if (within) {
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== 3 || !node.textContent?.trim()) continue;
        const id = nodes++;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width > 0 && rect.height > 0)
            runs.push({
              node: id,
              text: node.textContent.trim().slice(0, 40),
              x: rect.x,
              y: rect.y,
              w: rect.width,
              h: rect.height,
            });
        }
      }
    }
    for (const child of Array.from(el.children)) walk(child, within);
  };
  walk(scene, false);
  return runs;
}

/**
 * Every pair of runs that shares more than `minOverlap` pixels in both axes.
 *
 * Pure and exported so the predicate can be tested without a browser — the same
 * reason `inkBelow` is. Quadratic on purpose: a chart has tens of labels, not
 * thousands, and a spatial index here would be code nobody can check by reading.
 *
 * ONE NODE'S OWN RECTS ARE SKIPPED. A `<text>` that Chrome breaks into two line
 * boxes yields two runs which necessarily overlap; that is one label, and without
 * this the sweep's very first run reported hundreds of them. The test is
 * `TextRun.node`, not the string — see there for why comparing the string
 * exempted real collisions too.
 */
export function overprints(runs: readonly TextRun[], minOverlap = MIN_OVERLAP): Overprint[] {
  const out: Overprint[] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i] as TextRun;
      const b = runs[j] as TextRun;
      if (a.node === b.node) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > minOverlap && oy > minOverlap)
        out.push({ a: a.text, b: b.text, overlap: [Math.round(ox), Math.round(oy)] });
    }
  }
  return out;
}

/** One scene's collisions at one stop. */
export interface Overprinted {
  sid: string;
  t: number;
  pairs: Overprint[];
}

/**
 * Findings for the scenes whose chart labels print through each other.
 *
 * One finding per SCENE, not per pair and not per stop — the same shape, and the
 * same reason, as `gradeFidelity`. `line-chart` at sixteen points collides 69
 * times at one stop; sixty-nine lines saying "two labels overlap" is a report
 * nobody reads, and the defect is one defect: the chart does not have room for
 * its labels. The worst stop is named because that is the frame to open, and
 * three example pairs because a repair needs to know WHICH labels.
 */
export function gradeOverprint(rows: readonly Overprinted[]): Finding[] {
  const byScene = new Map<string, Overprinted[]>();
  for (const row of rows) {
    if (row.pairs.length === 0) continue;
    const seen = byScene.get(row.sid);
    if (seen) seen.push(row);
    else byScene.set(row.sid, [row]);
  }
  return [...byScene].map(([sid, hits]) => {
    const worst = hits.reduce((a, b) => (a.pairs.length >= b.pairs.length ? a : b));
    const examples = worst.pairs
      .slice(0, 3)
      .map((p) => `"${p.a}" over "${p.b}" (${p.overlap[0]}x${p.overlap[1]}px)`)
      .join(", ");
    return {
      severity: "error" as const,
      gate: "overprint",
      rule: "svg_text_overprint",
      // `#${sid}`, NOT `${sid}`. Every finding in this project names its element
      // as a selector — `check` writes `[#s11-cap t=92.4s]` — and anything reading
      // the report back looks for one. Written bare, `scripts/sweep.mjs` could not
      // tell which beat this was about, filed it as a deck-level orphan, and
      // reported the offending cell as CLEAN. Found by reverting `b3e5f35` and
      // watching the corpus stay green over twelve real collisions.
      message:
        `#${sid} draws chart labels on top of each other: ${worst.pairs.length} overlapping ` +
        `pair(s) at t=${worst.t}s${hits.length > 1 ? ` (worst of ${hits.length} stops)` : ""} — ` +
        `${examples}. The labels do not fit, so give them room or draw fewer of them; ` +
        `\`hyperframes check\` cannot see this (SVG text is exempt from content_overlap).`,
    };
  });
}
