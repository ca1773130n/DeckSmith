/**
 * An equation, walked one symbol at a time.
 *
 * This is the most valuable thing the vocabulary does: the reader is never shown
 * a wall of TeX and left to find the symbol being discussed. Each term is wrapped
 * in `\htmlClass{term t-<tone>}{...}` so KaTeX emits a real element for it, which
 * GSAP then tints and swells in step with its legend row.
 */
import type { Term } from "../../types.js";
import type { Emitter, Theme } from "../kit.js";
import { contentW, esc, js, spotlighter } from "../kit.js";
import { MIN_FONT } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import { chrome, chromeCss, chromeIn, holdsWithin, isPortrait, tween } from "./title.js";

/** `output: "html"` suppresses KaTeX's hidden MathML mirror, which the layout inspector reads as overlapping text. */
/**
 * `trust` is a PREDICATE, not `true`.
 *
 * The TeX rendered here comes out of an uploaded document, and `trust: true`
 * tells KaTeX to honour every command it otherwise refuses — including
 * `\href{javascript:...}` and `\includegraphics`. That is script injection into
 * the deck page, from a stranger's markdown, and the deck is served with
 * `allow-same-origin` so injected script runs as the server's own origin and can
 * reach /api. The two findings are one chain and this is the end of it worth
 * closing, because it is the end that costs nothing.
 *
 * `\htmlClass` is the only trusted command the vocabulary actually needs — it is
 * what wraps a term so `equation-walk` can tint it. Everything else goes back to
 * KaTeX's default refusal.
 */
const TRUST = 'function (c) { return c.command === "\\\\htmlClass"; }';
export const OPTS = `{ displayMode: true, trust: ${TRUST}, strict: false, output: "html" }`;
export const INLINE_OPTS = `{ displayMode: false, trust: ${TRUST}, strict: false, output: "html" }`;

/**
 * Fold away the ways LaTeX spells the same thing.
 *
 * A term has to be found in the equation before it can be highlighted, and a
 * literal substring test says no far too often: the planner writes what a person
 * would write, so `\|\cdot\|_1` never matches an equation that spells the same
 * norm `\left\|\cdot\right\|_1`, and neither matches `\lVert\cdot\rVert_1`.
 * A whole twelve-slide deck died on exactly that, at the last stage, after the
 * planner had already been paid for.
 *
 * So compare on a normal form — no whitespace, no `\left`/`\right` sizing hints,
 * one spelling per delimiter — while keeping a map back to the original offsets,
 * because it is the ORIGINAL span that has to be wrapped. Rewriting the equation
 * into its normal form would be the easy version and the wrong one: it would
 * silently restyle the author's TeX.
 */
const SYNONYMS: [RegExp, string][] = [
  [/\\left(?=[([|\\.])/g, ""],
  [/\\right(?=[)\]|\\.])/g, ""],
  [/\\lVert|\\rVert/g, "\\|"],
  [/\\lvert|\\rvert/g, "|"],
  [/\\mathrm\{d\}/g, "d"],
];

/** The normal form, plus `map[i]` = where normalised character `i` began. */
function normalise(tex: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < tex.length; ) {
    if (/\s/.test(tex[i] as string)) {
      i++;
      continue;
    }
    const rest = tex.slice(i);
    const hit = SYNONYMS.map(([re, to]) => {
      re.lastIndex = 0;
      const m = new RegExp(`^(?:${re.source})`).exec(rest);
      return m ? { len: m[0].length, to } : null;
    }).find(Boolean);
    if (hit) {
      for (const ch of hit.to) {
        out += ch;
        map.push(i);
      }
      i += hit.len;
      continue;
    }
    out += tex[i];
    map.push(i);
    i++;
  }
  return { text: out, map };
}

/** Where `term` sits in `tex`, comparing normal forms. Null when it is absent. */
export function locate(tex: string, term: string): { start: number; end: number } | null {
  const hay = normalise(tex);
  const needle = normalise(term).text;
  if (needle === "") return null;
  const at = hay.text.indexOf(needle);
  if (at < 0) return null;
  const start = hay.map[at] as number;
  const lastNorm = at + needle.length - 1;
  const lastOrig = hay.map[lastNorm] as number;
  // The original span runs to the end of the character the last normalised one
  // came from, which for a folded synonym is longer than one character.
  let end = lastOrig + 1;
  while (
    end < tex.length &&
    (hay.map[lastNorm + 1] ?? tex.length) > end &&
    /\s/.test(tex[end] as string)
  ) {
    end++;
  }
  end = Math.max(end, hay.map[lastNorm + 1] ?? lastOrig + 1);
  return { start, end: Math.min(end, tex.length) };
}

/**
 * Wrap each term where it first occurs, and report which ones were wrapped.
 *
 * Segments are tracked as raw/wrapped so a later term cannot match inside an
 * earlier term's `\htmlClass{...}` and produce nested markup that highlights the
 * wrong span.
 *
 * A term that cannot be found is DROPPED rather than thrown on, and the caller
 * drops its legend row with it — the two go together, which is what keeps this
 * honest. Silently highlighting nothing is the failure this archetype exists to
 * avoid, and a legend line pointing at an unhighlighted symbol is that failure;
 * a shorter legend is not. Losing an entire deck to one mis-spelled term is a
 * worse answer than either. If NOTHING matches, the beat has no work to do and
 * that is still an error.
 */
export function wrapTerms(
  tex: string,
  terms: Term[],
  beatId: string,
  /** The class the wrapper carries; the morph adds its key to the walk's tint. */
  cls: (t: Term) => string = (t) => `term t-${t.tone}`,
): { tex: string; used: Term[]; missing: Term[] } {
  let parts: { text: string; raw: boolean }[] = [{ text: tex, raw: true }];
  const used: Term[] = [];
  const missing: Term[] = [];
  for (const term of terms) {
    let placed = false;
    for (let i = 0; i < parts.length && !placed; i++) {
      const part = parts[i] as { text: string; raw: boolean };
      if (!part.raw) continue;
      const at = locate(part.text, term.tex);
      if (!at) continue;
      parts = parts.toSpliced(
        i,
        1,
        { text: part.text.slice(0, at.start), raw: true },
        {
          text: `\\htmlClass{${cls(term)}}{${part.text.slice(at.start, at.end)}}`,
          raw: false,
        },
        { text: part.text.slice(at.end), raw: true },
      );
      used.push(term);
      placed = true;
    }
    if (!placed) missing.push(term);
  }
  if (used.length === 0) {
    throw new Error(
      `equation-walk ${beatId}: none of its ${terms.length} term(s) occur in the equation. ` +
        `Terms: ${terms.map((t) => JSON.stringify(t.tex)).join(", ")}. Equation: ${JSON.stringify(tex)}`,
    );
  }
  return { tex: parts.map((part) => part.text).join(""), used, missing };
}

/**
 * Display equations want to live between 68px and 108px.
 *
 * The equation is the whole argument of this archetype and it was the smallest
 * thing on the slide — 72px of TeX centred in a 1700px box, measured at 46% fill
 * with a 1920x316 band under it. It is sized off the source length rather than
 * off `textWidth` because TeX is not the string that gets set: `\mathcal{W}(F)`
 * is fourteen characters and three glyphs.
 *
 * This is the *wanted* size, not the final one. The old comment here claimed
 * "KaTeX's own `\displaystyle` box will shrink to the container if the estimate
 * runs wide". It does not — it overflows, silently, because the composition is
 * the size it says it is and no gate reads past the canvas edge. At 9:16 that
 * truncated `X = \mathcal{W}(F)` to "X =" and then left the legend explaining a
 * symbol the viewer could not see, which is worse than a clip: the slide
 * asserted something false. `statements` and the `size` cap below are what make
 * the claim true.
 */
export function equationSize(tex: string): number {
  return tex.length > 120 ? 68 : tex.length > 90 ? 80 : tex.length > 55 ? 92 : 108;
}

/**
 * Control sequences that select a font or a layout rather than draw a glyph.
 * `\mathbf{F}` is one glyph, not two. Anything else spelled `\word` — `\alpha`,
 * `\sum`, `\to` — is counted as the one glyph it renders as.
 */
const NO_INK =
  /\\(math[a-z]+|text[a-z]*|bm|boldsymbol|displaystyle|textstyle|scriptstyle|left|right|operatorname|limits|nolimits|htmlClass|hspace|phantom|[,;:!])/g;

/**
 * Em width of one rendered glyph, measured rather than guessed.
 *
 * The demo's carrier equation renders at 14.66em in KaTeX's Computer Modern
 * across the fourteen glyphs this counts, so 0.9. It is high for a glyph advance
 * because display math also pays thickspace either side of every relation and
 * sets parentheses wide, and because a subscript is counted here at full weight.
 * Erring wide is the safe direction: it costs air, where erring narrow clips.
 */
const GLYPH_EM = 0.9;

/** Estimated rendered width of a display, in ems. */
export function texUnits(tex: string): number {
  let ems = 0;
  for (const m of tex.matchAll(/\\qquad|\\quad/g)) ems += m[0] === "\\qquad" ? 2 : 1;
  const glyphs = tex
    .replace(/\\q?quad/g, "")
    .replace(NO_INK, "")
    .replace(/[{}\s_^]/g, "");
  return ems + glyphs.length * GLYPH_EM;
}

/**
 * The display's own statements, for a box too narrow to set them on one line.
 *
 * `\qquad` between two equations is the author saying "these are two things".
 * Portrait is 860 wide against 16:9's 1700, so `F = E(I_LR), \qquad X = W(F)`
 * cannot be set across it at any size a phone can read — but each half can, at
 * full size, stacked. That is the arrangement the box wants; shrinking one line
 * until it fits is the arrangement it does not.
 */
function statements(tex: string, stacked: boolean): string[] {
  if (!stacked) return [tex];
  const parts = tex
    .split(/\\qquad|\\quad|\\\\/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [tex];
}

/** One row per term: a chip KaTeX fills in `setup`, and the label. Shared with the morph. */
export function legendRows(sid: string, terms: Term[], theme: Theme): string {
  return terms
    .map(
      (t) =>
        `<div class="leg" id="${sid}-leg-${t.tone}"><span class="chip" id="${sid}-chip-${t.tone}" style="color:${theme.tones[t.tone]}"></span><span>${esc(t.label)}</span></div>`,
    )
    .join("\n    ");
}

export function legendCss(theme: Theme): string {
  return [
    // `width:fit-content` + auto margins, not `align-items:center`: centring
    // each row individually gave the legend a ragged left edge, because a short
    // label indented its own chip further than a long one did. The column is
    // centred as one block and the rows start on a shared spine.
    ".legend{display:flex;flex-direction:column;gap:30px;width:fit-content;margin-inline:auto}",
    `.leg{display:flex;gap:26px;align-items:baseline;max-width:1400px;font-size:48px;color:${theme.muted}}`,
    // A common chip width, so the labels share a spine too — the glyphs inside
    // are one symbol each and their natural widths differ by a few pixels.
    `.chip{display:inline-block;min-width:72px;text-align:center;background:${theme.panel};border-radius:10px;padding:2px 20px;white-space:nowrap;font-weight:700}`,
  ].join("\n");
}

export const equationWalk: Emitter<"equation-walk"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  const eq = ctx.source.equations.find((e) => e.id === p.equationId);
  if (!eq) {
    throw new Error(
      `equation-walk ${beat.id}: no equation "${p.equationId}" in source ${ctx.source.id}`,
    );
  }

  // Wrapped first, because which terms could be placed decides the legend. A row
  // for a term the equation never showed is the one thing worse than no row.
  const walk = wrapTerms(eq.tex, p.terms, beat.id);
  const terms = walk.used;

  const legend = legendRows(sid, terms, theme);

  // Split the raw TeX and the term-wrapped TeX the same way: the delimiters are
  // untouched by `wrapTerms`, so the two lists line up piece for piece. Measuring
  // the raw one keeps `\htmlClass{term t-a}{...}`'s class name — eight characters
  // that render as nothing — out of the width estimate.
  const stacked = isPortrait(ctx.format);
  const raw = statements(eq.tex, stacked);
  const shown = statements(walk.tex, stacked);
  // The largest size at which the widest statement still fits the box, never
  // above what the archetype wanted. Floored at the invariant-5 minimum rather
  // than at the archetype's own 68: at that point an unreadably small equation
  // and a clipped one are both planner problems, and only one of them lies.
  //
  // The wanted size is asked of the LONGEST STATEMENT, not of the whole display:
  // once the two halves are on their own lines they are each short, and asking
  // the joined string would hold both at the size a line twice as long wanted.
  const longest = raw.reduce((a, b) => (b.length > a.length ? b : a));
  const size = Math.max(
    MIN_FONT,
    Math.min(
      equationSize(longest),
      Math.floor(contentW(ctx.format) / Math.max(...raw.map(texUnits))),
    ),
  );

  const body =
    shown.length === 1 ? "" : shown.map((_, i) => `<div id="${sid}-eq${i}"></div>`).join("\n    ");
  const html = `${chrome(sid, p.eyebrow, p.headline, contentW(ctx.format))}
<div class="eqslide">
  <div class="eq${shown.length === 1 ? "" : " eqstack"}" id="${sid}-eq" style="font-size:${size}px">${body}</div>
  <div class="legend">
    ${legend}
  </div>
</div>`;

  const setup = [
    `var OPTS = ${OPTS};`,
    ...shown.map(
      (part, i) =>
        `katex.render('${js(part)}', document.getElementById("${sid}-eq${shown.length === 1 ? "" : i}"), OPTS);`,
    ),
    ...terms.map(
      (t) =>
        `katex.render('${js(t.tex)}', document.getElementById("${sid}-chip-${t.tone}"), ${INLINE_OPTS});`,
    ),
  ];

  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(`#${sid}-eq`, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7 }, 0.8),
  ];

  // Space the walk over whatever the beat was given, so a four-term walk in a
  // seven-second beat still finishes inside its own slide.
  const first = 1.8;
  const step = Math.max(
    0.7,
    Math.min(1.9, (beat.seconds - first - 0.9) / Math.max(1, terms.length - 1)),
  );
  const holds: number[] = [];

  // The walk is a reading order, so the light walks with it: the term under
  // discussion is at full weight and the rest of the equation steps back to
  // DIM. `lit` mode, because every term is on screen from the equation's own
  // entrance — this moves a light over a settled line rather than revealing it.
  const spot = spotlighter(sid, ".term");

  terms.forEach((term, i) => {
    const at = first + i * step;
    const colour = theme.tones[term.tone];
    tl.push(
      tween(
        `#${sid}-leg-${term.tone}`,
        { opacity: 0, x: -18 },
        { opacity: 1, x: 0, duration: 0.5 },
        at,
      ),
      ...spot.lit(`.t-${term.tone}`, at),
      // The tint stays for the rest of the slide — it is what ties the symbol to
      // its legend chip. Only the swell is taken back, on the next term's cue.
      tween(
        `#${sid} .t-${term.tone}`,
        { color: theme.fg, scale: 1 },
        { color: colour, scale: 1.16, duration: 0.5 },
        at,
      ),
    );
    const prev = terms[i - 1];
    if (prev) {
      tl.push(tween(`#${sid} .t-${prev.tone}`, { scale: 1.16 }, { scale: 1, duration: 0.4 }, at));
    }
    holds.push(at + 0.6);
  });

  const last = terms[terms.length - 1];
  if (last) {
    const at = first + terms.length * step;
    tl.push(
      tween(`#${sid} .t-${last.tone}`, { scale: 1.16 }, { scale: 1, duration: 0.4 }, at),
      // The equation is one statement again before the beat ends: the walk was
      // the argument, and what it leaves behind is the whole line, readable.
      ...spot.restore(at),
    );
  }

  return {
    html,
    tl,
    setup,
    holds: holdsWithin(holds, beat.seconds),
    css: [
      chromeCss(theme),
      // `flex:1`, not `height:68vh`. 68vh is 734px measured against the viewport,
      // which knows nothing about how tall this scene's chrome turned out to be:
      // the block centred itself inside its own 734px box and so came to rest
      // 108px above the canvas centre with a 316px band under it. Growing into
      // whatever `.scene` has spare cannot overflow — there is nothing spare left
      // to overflow with — and it centres against the real remainder.
      // `space-evenly`, so the equation and its legend divide the box between
      // them instead of huddling in the middle of it with a band above and below.
      ".eqslide{display:flex;flex-direction:column;justify-content:space-evenly;gap:64px;flex:1;min-height:0}",
      ".katex-display{margin:0 !important}",
      `.eq{text-align:center;color:${theme.fg}}`,
      // Only present when the display was split into statements, and the split
      // only happens in a box too narrow to set them side by side. `.katex-display`
      // has its margin zeroed above, so without an explicit gap the two lines
      // would touch and read as one equation broken mid-expression.
      ".eqstack{display:flex;flex-direction:column;gap:32px}",
      // Transforms do not apply to inline boxes, and KaTeX spans are inline.
      ".term{display:inline-block}",
      legendCss(theme),
      // The block, not the term under discussion: which term that is, is a fact
      // about the paused timeline, and CSS cannot see it. The terms are also the
      // one thing here GSAP tints and swells, so a rule on them would win the
      // cascade and cancel the walk.
      ambient(sid, "-eq", BREATHE),
    ].join("\n"),
  };
};
