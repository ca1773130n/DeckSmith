/**
 * An equation becoming the next one.
 *
 * The keyed morph — the 3Blue1Brown move — and the one thing in the vocabulary
 * that shows a DERIVATION rather than a statement: the terms the author keys
 * travel from where they sit in the first line to where they sit in the second,
 * as rigid bodies, and everything else dissolves. Which terms are keyed is the
 * animation: `a^2+b^2=c^2` to `c^2-b^2=a^2` is a glyph riot unkeyed and a
 * three-body exchange keyed, on the same two strings.
 *
 * The keying reuses `equation-walk`'s: a term is located in the TeX by normal
 * form and wrapped in `\htmlClass{term t-<tone> ds-k-<tone>}{...}`, so KaTeX
 * emits a real element the runtime can find. It must be found in BOTH lines
 * to be a key at all — a term on one side only is dropped, with its legend
 * row, exactly as the walk drops a term it cannot place.
 *
 * Geometry is measured in the browser, after fonts (Seam B), and the morph
 * reaches the timeline as ONE typed `fromTo` on the host driving a GSAP plugin.
 * See `src/emit/morph-runtime.ts` for why that, and not a callback.
 */
import type { Term } from "../../types.js";
import type { Emitter } from "../kit.js";
import { contentW, js } from "../kit.js";
import { MIN_FONT } from "../svg.js";
import { ambient, BREATHE } from "../theme.js";
import {
  equationSize,
  INLINE_OPTS,
  legendCss,
  legendRows,
  locate,
  OPTS,
  texUnits,
  wrapTerms,
} from "./equation-walk.js";
import { chrome, chromeCss, chromeIn, holdsWithin, tween } from "./title.js";

/** How long the morph itself takes. The rest of the beat is the two holds. */
const MORPH_SECONDS = 1.6;

export const equationMorph: Emitter<"equation-morph"> = (beat, ctx) => {
  const { sid, theme } = ctx;
  const p = beat.params;

  const find = (id: string) => {
    const eq = ctx.source.equations.find((e) => e.id === id);
    if (!eq)
      throw new Error(`equation-morph ${beat.id}: no equation "${id}" in source ${ctx.source.id}`);
    return eq;
  };
  const a = find(p.fromId);
  const b = find(p.toId);

  // A key pairs a body in A with a body in B, so a term the runtime could find
  // on one side only would be a key with nothing to pair — faded out as an
  // unmatched body, under a legend row claiming it travelled.
  const both = p.terms.filter((t) => locate(a.tex, t.tex) && locate(b.tex, t.tex));
  if (both.length === 0) {
    throw new Error(
      `equation-morph ${beat.id}: none of its ${p.terms.length} term(s) occur in both equations. ` +
        `Terms: ${p.terms.map((t) => JSON.stringify(t.tex)).join(", ")}. ` +
        `From: ${JSON.stringify(a.tex)}. To: ${JSON.stringify(b.tex)}`,
    );
  }
  const cls = (t: Term) => `term t-${t.tone} ds-k-${t.tone}`;
  const wa = wrapTerms(a.tex, both, beat.id, cls).tex;
  const wb = wrapTerms(b.tex, both, beat.id, cls).tex;

  // Both lines at ONE size — the morph scales bodies, not lines — sized as the
  // walk sizes a single statement, against the wider of the two.
  const size = Math.max(
    MIN_FONT,
    Math.min(
      equationSize(a.tex.length > b.tex.length ? a.tex : b.tex),
      Math.floor(contentW(ctx.format) / Math.max(texUnits(a.tex), texUnits(b.tex))),
    ),
  );

  const html = `${chrome(sid, p.eyebrow, p.headline, contentW(ctx.format))}
<div class="eqslide">
  <div class="morph" id="${sid}-morph" style="font-size:${size}px">
    <div class="side" data-morph="a" id="${sid}-eqa"></div>
    <div class="side" data-morph="b" id="${sid}-eqb"></div>
  </div>
  <div class="legend">
    ${legendRows(sid, both, theme)}
  </div>
</div>`;

  const setup = [
    `var OPTS = ${OPTS};`,
    `katex.render('${js(wa)}', document.getElementById("${sid}-eqa"), OPTS);`,
    `katex.render('${js(wb)}', document.getElementById("${sid}-eqb"), OPTS);`,
    ...both.map(
      (t) =>
        `katex.render('${js(t.tex)}', document.getElementById("${sid}-chip-${t.tone}"), ${INLINE_OPTS});`,
    ),
  ];

  // The first line has to be READ before it moves, and the second after: the
  // morph sits between two holds, late enough that a short beat still opens
  // on a settled line and early enough that the result is held too.
  const first = 1.8;
  const at =
    Math.round(
      Math.max(2.6, Math.min(beat.seconds - MORPH_SECONDS - 0.9, beat.seconds * 0.45)) * 100,
    ) / 100;

  const tl = [
    ...chromeIn(sid, p.eyebrow !== undefined),
    tween(`#${sid}-morph`, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.7 }, 0.8),
    ...both.map((t, i) =>
      tween(
        `#${sid}-leg-${t.tone}`,
        { opacity: 0, x: -18 },
        { opacity: 1, x: 0, duration: 0.5 },
        1 + i * 0.15,
      ),
    ),
    // ONE tween, on the host, driving the plugin. Its ease is "none" because the
    // plan carries its own eases per segment; `pace` scales this duration and
    // the plan, being in fractions of it, scales with it.
    tween(
      `#${sid}-morph`,
      { dsMorph: 0 },
      { dsMorph: 1, duration: MORPH_SECONDS, ease: "none" },
      at,
    ),
  ];

  return {
    html,
    tl,
    setup,
    // SEAM B: the plan is browser geometry after fonts, so it is built inside
    // the ready gate, and the plugin tween above finds it on the host.
    measure: [`DSMorph.build(document.getElementById("${sid}-morph"));`],
    plugins: ["dsMorph"],
    holds: holdsWithin([first, at + MORPH_SECONDS + 0.4], beat.seconds),
    css: [
      chromeCss(theme),
      ".eqslide{display:flex;flex-direction:column;justify-content:space-evenly;gap:64px;flex:1;min-height:0}",
      ".katex-display{margin:0 !important}",
      // Both sides in one grid cell, so the host is as tall as the taller line
      // and neither needs a guessed height; the overlay is absolute over it.
      // Padded by the room an arc needs, so a bowing glyph stays inside its
      // offset parent and the layout gate's `escaped_container` stays quiet; the
      // bow is capped to the same 0.8em in `plan`.
      `.morph{position:relative;display:grid;place-items:center;text-align:center;padding:0.8em 0.5em;color:${theme.fg}}`,
      ".side{grid-area:1/1}",
      // B is measured, never seen: the runtime lifts its glyphs into the overlay
      // and drives them from there. Hidden by the sheet so nothing is captured
      // before the gate has built the plan.
      '.side[data-morph="b"]{visibility:hidden}',
      ".ds-morph-layer{position:absolute;inset:0}",
      ".term{display:inline-block}",
      // Keys are tinted from the start, on BOTH lines — the colour is what lets
      // a viewer follow a body across the move. Scoped under `.morph` because
      // `equation-walk` tweens `.t-<tone>` from the foreground colour, and a
      // bare rule on the class would win that cascade and cancel its walk.
      ...(["a", "b", "c", "d"] as const).map(
        (tone) => `.morph .t-${tone}{color:${theme.tones[tone]}}`,
      ),
      legendCss(theme),
      ambient(sid, "-morph", BREATHE),
    ].join("\n"),
  };
};
