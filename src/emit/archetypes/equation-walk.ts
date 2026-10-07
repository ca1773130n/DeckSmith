/**
 * An equation, walked one symbol at a time.
 *
 * This is the most valuable thing the vocabulary does: the reader is never shown
 * a wall of TeX and left to find the symbol being discussed. Each term is wrapped
 * in `\htmlClass{term t-<tone>}{...}` so KaTeX emits a real element for it, which
 * GSAP then tints and swells in step with its legend row.
 */
import type { Term } from "../../types.js";
import { fitOf, isV2 } from "../fit.js";
import type { Emitter, Theme } from "../kit.js";
import { contentW, esc, js, raw, spotlighter } from "../kit.js";
import { frameOf } from "../look.js";
import { MIN_FONT } from "../svg.js";
import { repairTex, texError, UNFIT_ATTR } from "../tex.js";
import { ambient, BREATHE } from "../theme.js";
import {
  bodyBudget,
  chrome,
  chromeCss,
  chromeIn,
  holdsWithin,
  isPortrait,
  tween,
} from "./title.js";

/**
 * v2: the equation's wanted size, grown. `mathFit` measures the rendered line in
 * the browser and steps it DOWN until it fits the box, so a bigger ask can only
 * cost a few measuring steps — never a clipped equation. 1.3 rather than the fit
 * engine's 1.6: a 108px display asked at 173 would be a single symbol per line
 * on most of the corpus' equations, and the walk reads the terms, not the glyphs.
 */
const EQ_GROWTH = 1.3;
/** v2: the legend's type, and the air between its rows. Classic is 48 and 30. */
const LEG_SIZE_V2 = 60;
const LEG_GAP_V2 = 36;
/** `.eqslide`'s minimum gap between the equation and its legend. */
const EQ_GAP = 64;

/**
 * How tall a display will come out, from its source — the fit engine's
 * prediction for this archetype, and an ESTIMATE in a way the SVG archetypes'
 * are not: KaTeX sets the line and `mathFit` re-sets it in the browser.
 *
 * Calibrated on the 30 equation-walk holds of the 2026-10-07 fill eval, where a
 * flat 1.3em per line under-predicted fill by 0.1–0.25 on most of them: a line
 * with sub- and superscripts is ~1.5em of ink, a fraction or a matrix adds
 * about an em, a big operator with limits half of one, and a display too wide
 * for the box at the size chosen here is broken by `mathFit` into as many lines
 * as it is box-widths long. Residual error is about ±0.12 of a region; `verify`
 * reports anything past 0.2.
 */
function displayHeight(raw: string, size: number, statements: number, box: number): number {
  const tall = /\\[dt]?frac|\\binom|\\begin\{([bpvBV]?matrix|cases|array|aligned)/.test(raw);
  const big = /\\(sum|prod|int|oint|bigcup|bigcap)/.test(raw);
  const em = 1.5 + (tall ? 1 : 0) + (big ? 0.5 : 0);
  const lines = Math.max(statements, Math.ceil((texUnits(raw) * size) / (box * 0.95)));
  return lines * size * em + (lines - 1) * size * 0.5;
}

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

/**
 * The normal form, with three maps back into the original, per normalised
 * character `i`:
 *
 * - `map[i]`  where the token it came from began;
 * - `ends[i]` where that token ended — past all six characters of `\rVert`;
 * - `lead[i]` where it began INCLUDING a sizing hint folded away just before it,
 *   so the `(` of `\left(` leads back to the `\left`.
 *
 * `ends` and `lead` exist because the span used to be found by reading the NEXT
 * normalised character's start, which is past any `\right` folded away in
 * between: a term ending at `a_{\le t}` in `\left(x, a_{\le t}\right)` was
 * wrapped as `\htmlClass{..}{a_{\le t}\right}` — a `\right` inside a group its
 * `\left` is outside of, which KaTeX refuses. At the other end, a term opening
 * on `\left|` was wrapped from the `|`, leaving `\left\htmlClass{..}{|...`.
 * Those two were 19 and 3 of the 26 KaTeX parse errors HypePaper's decks died
 * on at `verify` in the week to 2026-10-07.
 */
function normalise(tex: string): { text: string; map: number[]; ends: number[]; lead: number[] } {
  let out = "";
  const map: number[] = [];
  const ends: number[] = [];
  const lead: number[] = [];
  /** Where a run of folded-away hints began, waiting for the character it sizes. */
  let hint: number | null = null;
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
    const len = hit ? hit.len : 1;
    const chars = hit ? hit.to : (tex[i] as string);
    if (chars === "") hint ??= i;
    for (const ch of chars) {
      out += ch;
      map.push(i);
      ends.push(i + len);
      lead.push(hint ?? i);
      hint = null;
    }
    i += len;
  }
  return { text: out, map, ends, lead };
}

/**
 * Where `term` sits in `tex`, comparing normal forms. Null when it is absent.
 *
 * The span starts at the first matched character's token — with the `\left`
 * that sizes it, when the term opens on a sized delimiter — and ends where the
 * last matched character's token ends. Never further: whatever follows the term
 * in the equation, a `\right` included, is not the term's.
 */
export function locate(tex: string, term: string): { start: number; end: number } | null {
  const hay = normalise(tex);
  const needle = normalise(term).text;
  if (needle === "") return null;
  const at = hay.text.indexOf(needle);
  if (at < 0) return null;
  const start = hay.lead[at] as number;
  const end = hay.ends[at + needle.length - 1] as number;
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
): { tex: string; used: Term[]; missing: Term[]; broken: Term[] } {
  // Every placement is parsed by KaTeX before it is kept — but only when the
  // equation parsed BEFORE any wrapping, because otherwise every placement
  // would be refused for a fault that is not its own. A caller with an equation
  // KaTeX refuses must repair or degrade it first (see `prepareWalk`).
  const checked = texError(tex, true) === null;
  let parts: { text: string; raw: boolean }[] = [{ text: tex, raw: true }];
  const used: Term[] = [];
  const missing: Term[] = [];
  /** Found in the TeX, but no wrapping of it parses. A subset of `missing`. */
  const broken: Term[] = [];
  const joined = (ps: { text: string }[]) => ps.map((p) => p.text).join("");
  for (const term of terms) {
    let placed = false;
    let found = false;
    for (let i = 0; i < parts.length && !placed; i++) {
      const part = parts[i] as { text: string; raw: boolean };
      if (!part.raw) continue;
      const at = locate(part.text, term.tex);
      if (!at) continue;
      found = true;
      const body = `\\htmlClass{${cls(term)}}{${part.text.slice(at.start, at.end)}}`;
      // Bare first, then as a group of its own. The group is what a span needs
      // when the TeX before it takes ONE token as an argument — `x^\alpha`
      // wrapped bare is `x^\htmlClass{..}{\alpha}`, a superscript with no
      // argument, and that was three of HypePaper's 26 parse errors. Bare is
      // tried first because a group changes a relation's spacing to an ordinary
      // atom's, and most spans do not need one.
      for (const text of [body, `{${body}}`]) {
        const next = parts.toSpliced(
          i,
          1,
          { text: part.text.slice(0, at.start), raw: true },
          { text, raw: false },
          { text: part.text.slice(at.end), raw: true },
        );
        if (checked && texError(joined(next), true) !== null) continue;
        parts = next;
        used.push(term);
        placed = true;
        break;
      }
    }
    if (!placed) {
      missing.push(term);
      if (found) broken.push(term);
    }
  }
  if (used.length === 0) {
    throw new Error(
      `equation-walk ${beatId}: none of its ${terms.length} term(s) ${broken.length ? "can be highlighted in" : "occur in"} the equation. ` +
        `Terms: ${terms.map((t) => JSON.stringify(t.tex)).join(", ")}. Equation: ${JSON.stringify(tex)}`,
    );
  }
  return { tex: joined(parts), used, missing, broken };
}

/** One sentence per term the walk could not highlight. */
function droppedTerms(eqId: string, missing: Term[], broken: Term[]): string[] {
  return missing.map((t) =>
    broken.includes(t)
      ? `term ${JSON.stringify(t.tex)} is in ${eqId} but no span around it parses, so it is not highlighted and its legend row ("${t.label}") is left out`
      : `term ${JSON.stringify(t.tex)} does not occur in ${eqId}, so its legend row ("${t.label}") is left out`,
  );
}

/** What `prepareWalk` decided about one equation and its terms. */
export interface PreparedWalk {
  /** The TeX to render, repaired and term-wrapped. Absent when `plain`. */
  tex?: string;
  /** The repaired TeX without wrappers, for measuring. The source TeX when `plain`. */
  raw: string;
  /** Set when KaTeX refuses the equation even after repair. */
  plain?: { error: string };
  used: Term[];
  missing: Term[];
  notes: string[];
}

/**
 * Everything the walk needs to draw one equation, decided in Node — so `plan`
 * can report it and `build` cannot ship a `katex.render` call that throws.
 *
 * The equation is parsed and, if KaTeX refuses it, repaired (`repairTex`). Each
 * term is repaired the same way, so a term spelled with the paper's own macro
 * still finds it once both are drawn as names. Then the terms are wrapped, each
 * wrapping parsed before it is kept.
 *
 * An equation no repair makes parseable is DEGRADED, not dropped and not
 * shipped: `plain` is set and the slide shows the TeX source as text, with the
 * terms still marked so the walk still walks. `notes` says, in words, every
 * repair, degradation and dropped term — `plan` prints them and `build` reports
 * them as the beat's warnings.
 */
export function prepareWalk(
  eq: { id: string; tex: string },
  terms: readonly Term[],
  beatId: string,
): PreparedWalk {
  const fixed = repairTex(eq.tex, true);
  const notes = fixed.repairs.map((r) => `${eq.id} repaired before drawing: ${r}`);
  const repairedTerms = terms.map((t) => ({ ...t, tex: repairTex(t.tex, false).tex }));
  if (fixed.error !== null) {
    notes.push(
      `${eq.id} does not parse even after repair (${fixed.error}), so it is shown as its TeX source in plain text — ${JSON.stringify(eq.tex)}`,
    );
    // Located against the source as written: that is the text on the slide.
    const parts = segment(eq.tex, [...terms]);
    if (parts.used.length === 0) {
      throw new Error(
        `equation-walk ${beatId}: none of its ${terms.length} term(s) occur in the equation. ` +
          `Terms: ${terms.map((t) => JSON.stringify(t.tex)).join(", ")}. Equation: ${JSON.stringify(eq.tex)}`,
      );
    }
    notes.push(...droppedTerms(eq.id, parts.missing, []));
    return {
      raw: eq.tex,
      plain: { error: fixed.error },
      used: parts.used,
      missing: parts.missing,
      notes,
    };
  }
  const walk = wrapTerms(fixed.tex, repairedTerms, beatId);
  // Back to the planner's own terms, so the legend and the chips are keyed by the
  // objects the storyboard holds — the repaired TeX is only for finding them.
  const back = (ts: Term[]) => ts.map((t) => terms[repairedTerms.indexOf(t)] as Term);
  const used = back(walk.used);
  const missing = back(walk.missing);
  notes.push(...droppedTerms(eq.id, missing, back(walk.broken)));
  return { tex: walk.tex, raw: fixed.tex, used, missing, notes };
}

/** The source cut at each term's first occurrence, for a slide drawn as plain text. */
function segment(
  tex: string,
  terms: Term[],
): { parts: { text: string; term?: Term }[]; used: Term[]; missing: Term[] } {
  let parts: { text: string; term?: Term }[] = [{ text: tex }];
  const used: Term[] = [];
  const missing: Term[] = [];
  for (const term of terms) {
    const i = parts.findIndex((p) => !p.term && locate(p.text, term.tex));
    const part = parts[i];
    const at = part && locate(part.text, term.tex);
    if (!part || !at) {
      missing.push(term);
      continue;
    }
    parts = parts.toSpliced(
      i,
      1,
      { text: part.text.slice(0, at.start) },
      { text: part.text.slice(at.start, at.end), term },
      { text: part.text.slice(at.end) },
    );
    used.push(term);
  }
  return { parts, used, missing };
}

/** The plain-text form of an equation KaTeX refuses: escaped source, terms marked. */
function plainHtml(tex: string, terms: Term[]): string {
  return segment(tex, terms)
    .parts.map((p) =>
      p.term ? `<span class="term t-${p.term.tone}">${esc(p.text)}</span>` : esc(p.text),
    )
    .join("");
}

/**
 * A legend chip's contents: the term's TeX for KaTeX when it parses inline
 * (repaired if it had to be), and its source as plain text when it does not —
 * a chip is where a viewer reads WHICH symbol, so it is never left empty.
 */
export function chipSetup(sid: string, term: Term): string {
  const fixed = repairTex(term.tex, false);
  const el = `document.getElementById("${sid}-chip-${term.tone}")`;
  return fixed.error === null
    ? `katex.render('${js(fixed.tex)}', ${el}, ${INLINE_OPTS});`
    : `${el}.textContent = '${js(term.tex)}';`;
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

/** The size an equation shown as plain source is set at: the legend's own size. */
const PLAIN_FONT = 48;

/**
 * Fit the rendered display to its box, measured — SEAM B, after fonts.
 *
 * `equationSize` and `texUnits` pick a size from a glyph count, and a count is
 * not a width. On HypePaper's decks it was wrong in the dangerous direction:
 * `\text{K-Score} = 0.1 \cdot \text{Faithfulness} + 0.4 \cdot \text{Visual
 * Correctness} + ...` was set at the 40px floor and still ran 173px off the
 * right edge of the canvas, and the gate could only say `span.mord`. So the
 * browser measures what KaTeX actually drew, and in this order:
 *
 *  1. it fits as estimated — nothing changes;
 *  2. it fits on one line at some size between the floor and the wanted size —
 *     set that size;
 *  3. it does not fit on one line even at the floor — re-render it inline, where
 *     KaTeX breaks after a top-level relation or binary operator exactly as TeX
 *     does, at the wanted size, and shrink toward the floor until the widest
 *     unbreakable piece fits and the slide does not spill vertically;
 *  4. nothing fits — leave it at the floor and mark it with `UNFIT_ATTR`, so
 *     `fidelity` fails the deck with the formula in the message.
 *
 * Every step is a measurement taken once, inside the ready gate, before the
 * timeline exists; the result is ordinary layout, not a value written from a
 * callback (invariant 11). The terms keep their `\htmlClass` wrappers across a
 * re-render, so the walk's tweens find them either way.
 */
function mathFit(
  sid: string,
  targets: string[],
  shown: string[],
  raw: string,
  want: number,
  floor: number,
): string[] {
  return [
    `var dsEqFit = (function () {
                var box = document.getElementById("${sid}-eq");
                var slide = box && box.parentNode;
                var bw = box ? box.getBoundingClientRect().width : 0;
                if (!(bw > 0) || !slide) return "unmeasured";
                var targets = [${targets.map((id) => `"${id}"`).join(", ")}].map(function (id) { return document.getElementById(id); });
                var TEX = [${shown.map((s) => `'${js(s)}'`).join(", ")}];
                var spill0 = slide.scrollHeight - slide.clientHeight;
                function extent(each) {
                  var w = 0;
                  targets.forEach(function (t) {
                    var lo = Infinity, hi = -Infinity;
                    Array.prototype.forEach.call(t.querySelectorAll(".katex-html > .base"), function (b) {
                      var r = b.getBoundingClientRect();
                      if (each) w = Math.max(w, r.width);
                      else { lo = Math.min(lo, r.left); hi = Math.max(hi, r.right); }
                    });
                    if (!each && hi > lo) w = Math.max(w, hi - lo);
                  });
                  return w;
                }
                function fits(each) {
                  return extent(each) <= bw + 0.5 && slide.scrollHeight - slide.clientHeight <= Math.max(1, spill0 + 1);
                }
                function settle(each, size) {
                  size = Math.max(${floor}, Math.min(${want}, Math.floor(size)));
                  box.style.fontSize = size + "px";
                  while (!fits(each) && size > ${floor}) {
                    size = Math.max(${floor}, size - 2);
                    box.style.fontSize = size + "px";
                  }
                  return fits(each);
                }
                if (fits(false)) return "fits";
                var size = parseFloat(box.style.fontSize);
                if (settle(false, (size * bw) / extent(false))) return "scaled";
                targets.forEach(function (t, i) { katex.render("\\\\displaystyle " + TEX[i], t, ${INLINE_OPTS}); });
                box.className += " eq-broken";
                box.style.fontSize = "${want}px";
                var wb = extent(true);
                if (settle(true, wb > bw ? (${want} * bw) / wb : ${want})) return "broken";
                box.setAttribute("${UNFIT_ATTR}", '${js(raw)}');
                return "unfit";
              })()`,
  ];
}

/**
 * Grow each legend chip to hold the glyphs KaTeX set in it.
 *
 * A chip is a painted box with 2px of vertical padding, and the layout gate
 * measures text against the nearest painted box. `x^{\text{gt}}_{<i}` or a
 * `\frac` sets glyph boxes above and below the line box, so the chip failed
 * `text_box_overflow` on its own superscript — measured on HypePaper deck
 * 0ef77cae: the `gt` sat 10px above the chip's top edge. Padding is added only
 * where a glyph box actually crosses an edge, so a chip that already held its
 * term is untouched.
 */
export function chipFit(sid: string, terms: Term[]): string[] {
  if (terms.length === 0) return [];
  return [
    `[${terms.map((t) => `"${t.tone}"`).join(", ")}].forEach(function (tone) {
                var chip = document.getElementById("${sid}-chip-" + tone);
                var r = chip && chip.getBoundingClientRect();
                if (!r || !(r.height > 0)) return;
                var k = chip.offsetHeight / r.height;
                var top = r.top, bottom = r.bottom;
                Array.prototype.forEach.call(chip.querySelectorAll("span"), function (el) {
                  for (var n = el.firstChild; n; n = n.nextSibling) {
                    if (n.nodeType === 3 && n.nodeValue.trim()) {
                      var q = el.getBoundingClientRect();
                      top = Math.min(top, q.top);
                      bottom = Math.max(bottom, q.bottom);
                      return;
                    }
                  }
                });
                var cs = getComputedStyle(chip);
                if (top < r.top) chip.style.paddingTop = parseFloat(cs.paddingTop) + Math.ceil((r.top - top) * k) + "px";
                if (bottom > r.bottom) chip.style.paddingBottom = parseFloat(cs.paddingBottom) + Math.ceil((bottom - r.bottom) * k) + "px";
              })`,
  ];
}

/** The walk's swell on a term the width of one glyph — the pulse it was designed as. */
const SWELL = 1.16;
/** How far a swollen term may grow past each of its own edges, in ems. */
const SWELL_EM = 0.06;

/**
 * Each term's swell, from its rendered width, into `dsSwell[tone]`.
 *
 * Scaling about the centre grows a term by `(s - 1) / 2` of its width on each
 * side. A one-glyph term at `SWELL` grows ~0.05em a side and stays inside the
 * thick space KaTeX sets around a relation; a 600px term at the same scale
 * grows 48px a side, over its neighbours — measured on HypePaper deck 0ef77cae,
 * where `G_\theta(...)` covered the `\big\|` before it and the minus after it.
 * So the growth a side is capped at `SWELL_EM` and the scale is whatever that
 * allows, never more than `SWELL`: a long term is told by its tint, a short
 * one by its tint and its pulse.
 *
 * `k` divides screen px back into layout px, as `cameraMeasure` and the morph
 * runtime do; the font size is a layout length.
 */
function swellFit(sid: string, terms: Term[]): string[] {
  return [
    `var dsSwell = (function () {
                var out = {};
                var box = document.getElementById("${sid}-eq");
                var k = box && box.offsetWidth ? box.getBoundingClientRect().width / box.offsetWidth : 1;
                var em = box ? parseFloat(getComputedStyle(box).fontSize) : 0;
                [${terms.map((t) => `"${t.tone}"`).join(", ")}].forEach(function (tone) {
                  var w = 0;
                  Array.prototype.forEach.call(document.querySelectorAll("#${sid} .t-" + tone), function (el) {
                    w = Math.max(w, el.getBoundingClientRect().width / k);
                  });
                  out[tone] = w > 0 && em > 0 ? Math.min(${SWELL}, Math.round((1 + (2 * ${SWELL_EM} * em) / w) * 1000) / 1000) : ${SWELL};
                });
                return out;
              })()`,
  ];
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
    // `flex:none`: beside a long label the chip used to SHRINK below its own
    // nowrap TeX, which then ran out of the painted box into the label — on a
    // HypePaper deck, "pixelcoord" 91px past the chip's right edge.
    `.chip{display:inline-block;flex:none;min-width:72px;text-align:center;background:${theme.panel};border-radius:10px;padding:2px 20px;white-space:nowrap;font-weight:700}`,
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
  // Parsed, repaired and checked in Node before a byte is emitted: see
  // `prepareWalk`, and `src/emit/tex.ts` for why.
  const walk = prepareWalk(eq, p.terms, beat.id);
  const terms = walk.used;
  const v2 = isV2(ctx);
  /** The equation's height once the fit has settled — ESTIMATED, for the prediction only. */
  let eqH = 2 * PLAIN_FONT * 1.5;

  const legend = legendRows(sid, terms, theme);
  const chips = terms.map((t) => chipSetup(sid, t));

  let eqHtml: string;
  let setup: string[];
  let measure: string[];
  if (walk.plain) {
    // KaTeX refuses this equation even repaired. Its source, as text, with the
    // terms marked — the walk still walks, and nothing on the slide throws.
    eqHtml = `<div class="eq eq-plain" id="${sid}-eq" style="font-size:${PLAIN_FONT}px">${plainHtml(eq.tex, terms)}</div>`;
    setup = chips;
    measure = [...chipFit(sid, terms), ...swellFit(sid, terms)];
  } else {
    // Split the raw TeX and the term-wrapped TeX the same way: the delimiters are
    // untouched by `wrapTerms`, so the two lists line up piece for piece.
    // Measuring the raw one keeps `\htmlClass{term t-a}{...}`'s class name —
    // eight characters that render as nothing — out of the width estimate.
    //
    // A split is kept only if every statement parses on its own: `\qquad` inside
    // a `\left(...\right)` is not a boundary between two equations, and cutting
    // there hands KaTeX two halves of one.
    const wrapped = walk.tex as string;
    const split = statements(wrapped, isPortrait(ctx.format));
    const stacked = split.length > 1 && split.every((s) => texError(s, true) === null);
    const raw = statements(walk.raw, stacked);
    const shown = stacked ? split : [wrapped];
    // The largest size at which the widest statement still fits the box, never
    // above what the archetype wanted. Floored at the invariant-5 minimum rather
    // than at the archetype's own 68: at that point an unreadably small equation
    // and a clipped one are both planner problems, and only one of them lies.
    //
    // The wanted size is asked of the LONGEST STATEMENT, not of the whole
    // display: once the two halves are on their own lines they are each short,
    // and asking the joined string would hold both at the size a line twice as
    // long wanted.
    //
    // This is still an ESTIMATE, from a glyph count. `mathFit` below measures the
    // rendered line and corrects it; see there for what happens when it is wrong.
    const longest = raw.reduce((a, b) => (b.length > a.length ? b : a));
    const want = v2 ? Math.round(equationSize(longest) * EQ_GROWTH) : equationSize(longest);
    const size = Math.max(
      MIN_FONT,
      Math.min(want, Math.floor(contentW(ctx.format) / Math.max(...raw.map(texUnits)))),
    );
    eqH = displayHeight(walk.raw, size, shown.length, contentW(ctx.format));
    const body =
      shown.length === 1
        ? ""
        : shown.map((_, i) => `<div id="${sid}-eq${i}"></div>`).join("\n    ");
    eqHtml = `<div class="eq${shown.length === 1 ? "" : " eqstack"}" id="${sid}-eq" style="font-size:${size}px">${body}</div>`;
    const targets = shown.map((_, i) => `${sid}-eq${shown.length === 1 ? "" : i}`);
    setup = [
      `var OPTS = ${OPTS};`,
      ...shown.map(
        (part, i) => `katex.render('${js(part)}', document.getElementById("${targets[i]}"), OPTS);`,
      ),
      ...chips,
    ];
    // Chips first: a chip that grows to hold its glyphs moves the legend, and the
    // equation's fit has to be measured against the legend it will really have.
    measure = [
      ...chipFit(sid, terms),
      ...mathFit(sid, targets, shown, walk.raw, want, MIN_FONT),
      // Last: it measures each term at the size the fit settled on.
      ...swellFit(sid, terms),
    ];
  }

  const slide = `<div class="eqslide">
  ${eqHtml}
  <div class="legend">
    ${legend}
  </div>
</div>`;
  // `--design v2` may move the chrome under the equation (src/emit/look.ts).
  // The classic string is kept as it was rather than routed through the frame:
  // this emitter has always measured its headline as Latin, and the frame
  // measures with the deck's face, which would re-break CJK headlines.
  const F =
    ctx.look?.placement === "foot"
      ? frameOf(ctx, { eyebrow: p.eyebrow, headline: p.headline, evidence: beat.evidence })
      : undefined;
  const html = F
    ? F.compose(slide)
    : `${chrome(sid, p.eyebrow, p.headline, contentW(ctx.format))}
${slide}`;

  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    ...(F?.tl ?? []),
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

  // How far each term swells is MEASURED (`swellFit`): `1.16` on a symbol is a
  // pulse, and on a 600px `G_\theta(x_t^i, x_{<i}^{gt}, t)` it is 48px of term
  // pushed over the `\big\|` and the minus either side of it.
  const swell = (t: Term) => raw(`dsSwell.${t.tone}`);
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
        { color: colour, scale: swell(term), duration: 0.5 },
        at,
      ),
    );
    const prev = terms[i - 1];
    if (prev) {
      tl.push(
        tween(`#${sid} .t-${prev.tone}`, { scale: swell(prev) }, { scale: 1, duration: 0.4 }, at),
      );
    }
    holds.push(at + 0.6);
  });

  const last = terms[terms.length - 1];
  if (last) {
    const at = first + terms.length * step;
    tl.push(
      tween(`#${sid} .t-${last.tone}`, { scale: swell(last) }, { scale: 1, duration: 0.4 }, at),
      // The equation is one statement again before the beat ends: the walk was
      // the argument, and what it leaves behind is the whole line, readable.
      ...spot.restore(at),
    );
  }

  // v2's prediction. ESTIMATED rather than solved, unlike the SVG archetypes:
  // KaTeX's line height and the browser-side `mathFit` are not knowable here
  // (see `displayHeight`), and a legend row is charged its 1.2 line box.
  // `.eqslide` is `space-evenly`, so of the slack only the gap BETWEEN the two
  // blocks is inside the painted extent. `verify` holds this against the
  // browser; a wrong estimate is reported, not hidden.
  const region = F ? F.budget(0, 0, 0) : bodyBudget(ctx.format, p.eyebrow, p.headline, 0, 0, 0);
  const legSize = v2 ? LEG_SIZE_V2 : 48;
  const legGap = v2 ? LEG_GAP_V2 : 30;
  const legH = terms.length * legSize * 1.2 + Math.max(0, terms.length - 1) * legGap;
  const slack = Math.max(0, region - eqH - legH - EQ_GAP);

  return {
    html,
    tl,
    setup,
    measure,
    ...(walk.notes.length ? { warnings: walk.notes } : {}),
    holds: holdsWithin(holds, beat.seconds),
    ...(v2 ? { fit: fitOf(eqH + EQ_GAP + legH + slack / 3, region) } : {}),
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
      `.eqslide{display:flex;flex-direction:column;justify-content:space-evenly;gap:${EQ_GAP}px;flex:1;min-height:0}`,
      ".katex-display{margin:0 !important}",
      `.eq{text-align:center;color:${theme.fg}}`,
      // Only present when the display was split into statements, and the split
      // only happens in a box too narrow to set them side by side. `.katex-display`
      // has its margin zeroed above, so without an explicit gap the two lines
      // would touch and read as one equation broken mid-expression.
      ".eqstack{display:flex;flex-direction:column;gap:32px}",
      // Set by `mathFit` when one line will not fit at the floor: the display is
      // re-rendered inline, where KaTeX breaks after a top-level relation or
      // operator, and the lines it breaks into are centred and spaced as lines.
      ".eq-broken{line-height:1.5}",
      // An equation KaTeX refuses, shown as its source. Wraps anywhere, because
      // TeX source has few spaces and must not run off the slide either. The
      // deck's own face, not a monospace one: a family the bundle does not
      // declare falls back silently (invariant 9).
      ".eq-plain{white-space:pre-wrap;overflow-wrap:anywhere}",
      // Transforms do not apply to inline boxes, and KaTeX spans are inline.
      ".term{display:inline-block}",
      legendCss(theme),
      // Scoped, because `legendCss` is the shared block every walk emits once.
      ...(v2
        ? [`#${sid} .legend{gap:${LEG_GAP_V2}px}`, `#${sid} .leg{font-size:${LEG_SIZE_V2}px}`]
        : []),
      // The block, not the term under discussion: which term that is, is a fact
      // about the paused timeline, and CSS cannot see it. The terms are also the
      // one thing here GSAP tints and swells, so a rule on them would win the
      // cascade and cancel the walk.
      ambient(sid, "-eq", BREATHE),
      ...(F?.css ? [F.css] : []),
    ].join("\n"),
  };
};
