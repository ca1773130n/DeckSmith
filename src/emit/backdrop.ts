/**
 * A diagram drawn over a full-bleed picture.
 *
 * The founder's bar is explainer-video motion, and what he hates is a deck of
 * cards on one pale ground. Stage gives a picture the whole frame but has no
 * room for a mechanism; the diagram archetypes draw the mechanism on the pack's
 * ground. A `backdrop` (src/types.ts) puts the second over the first: the
 * picture covers the frame and drifts, a scrim darkens it, and the panels are
 * drawn as dark glass with light ink.
 *
 * ONE WRAPPER, NOT FOUR EMITTERS TAUGHT A SECOND PALETTE. Every archetype paints
 * through its `Theme` — panel, ink, rule, tones — so the archetype is emitted
 * unchanged with the GLASS theme (`glass`) and this file adds the picture under
 * it. Geometry, holds and stop counts are therefore the archetype's own: only
 * colours move, which is also why the measuring passes (`planCut`, `narrate`,
 * `timing`) can run through it without disagreeing with the build.
 *
 * THE ARCHETYPES' CSS IS UNSCOPED (`.panel{background:…}`) and the shell emits
 * each distinct block once for the whole deck, so a glass `.panel` rule would
 * repaint every callout in the deck — or lose to a pale one emitted later. So a
 * backdrop scene's stylesheet is scoped to the scene (`scopeCss`), raising every
 * one of its rules by the same one id, so their order among themselves is kept.
 *
 * WHAT KEEPS THE WORDS READABLE IS THE SCRIM, NOT THE PICTURE — stage's rule,
 * applied to the whole frame because a diagram's words are everywhere. At
 * `SCRIM` black over a pure-white pixel the ground is 97/255; every glass ink —
 * `MUTED`, and each tone after `readable` lifts it — clears 4.5:1 on that, so
 * the contrast gate passes on any picture rather than on the one tried. Text on
 * a glass panel sits on the panel's own fill over that, darker still.
 */
import type { Archetype, Backdrop, Beat, Figure } from "../types.js";
import { BACKDROP_ARCHETYPES } from "../types.js";
import { tween } from "./archetypes/title.js";
import type { EmitContext, Scene, Theme, Tween } from "./kit.js";
import { esc, reserveRef } from "./kit.js";

/** Black at this alpha over the whole picture — see the header. */
export const SCRIM = 0.62;
/** The picture's entrance, and how far it drifts over the beat. */
const MEDIA_IN = 0.8;
const DRIFT_TO = 1.06;

/** Glass inks. Light on the scrim's dark; `MUTED` is the floor the header measures. */
const FG = "#f4f6fa";
const MUTED = "#e1e6ee";
const DIM = "#dde3ec";
const RULE = "#8f9ab0";
/** A panel: dark, but not opaque, so the scene still reads through it. */
const PANEL = "rgba(8,12,20,0.66)";

/** The backdrop a beat asks for, if its archetype takes one. */
export function backdropOf(beat: Beat): Backdrop | undefined {
  if (!(BACKDROP_ARCHETYPES as readonly Archetype[]).includes(beat.archetype)) return undefined;
  return (beat.params as { backdrop?: Backdrop }).backdrop;
}

/**
 * The figure a beat's backdrop resolves to, or undefined when it has none.
 *
 * A PENDING backdrop — a brief `illustrate` has not drawn — is drawn without
 * one rather than refused: the planner's own passes (`assertInsideResolves`)
 * emit beats before `illustrate` runs, and `assertRefsResolve` refuses a
 * pending brief before any build gets here.
 */
export function backdropFigure(beat: Beat, ctx: EmitContext): Figure | undefined {
  const id = backdropOf(beat)?.figureId;
  if (id === undefined) return undefined;
  const who = `${beat.archetype} ${beat.id}`;
  const fig = ctx.source.figures.find((f) => f.id === id);
  if (!fig) throw new Error(`${who}: no backdrop figure "${id}" in source ${ctx.source.id}`);
  if (fig.kind !== "image") {
    throw new Error(`${who}: backdrop "${id}" is a ${fig.kind}; a backdrop is a still picture`);
  }
  return fig;
}

/** The scrim's ground over a pure-white pixel: the worst case every ink is held to. */
const WORST_GROUND = Math.round(255 * (1 - SCRIM));

/** WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (shift: number) => {
    const x = ((n >> shift) & 255) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(16) + 0.7152 * lin(8) + 0.0722 * lin(0);
}

/** Contrast of `hex` on the worst-case ground. */
export function onWorstGround(hex: string): number {
  const g = WORST_GROUND / 255;
  const lg = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
  const l = luminance(hex);
  return (Math.max(l, lg) + 0.05) / (Math.min(l, lg) + 0.05);
}

/**
 * The least lift toward white that makes `hex` clear 4.5:1 on the worst-case
 * ground — so a tone keeps as much of its hue as legibility allows, and a dark
 * pack's tones, already light, mostly stay as they are. Not `#rrggbb`: kept.
 */
function readable(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = Number.parseInt(hex.slice(1), 16);
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const ch = (shift: number) => {
      const c = (n >> shift) & 255;
      return Math.round(c + (255 - c) * t)
        .toString(16)
        .padStart(2, "0");
    };
    const c = `#${ch(16)}${ch(8)}${ch(0)}`;
    if (onWorstGround(c) >= 4.5) return c;
  }
  return "#ffffff";
}

/**
 * The theme a backdrop scene is drawn in: the pack's type and forms, glass
 * colours, and its tones lifted only as far as they must go to read on the
 * scrim (`readable`).
 */
export function glass(theme: Theme): Theme {
  return {
    ...theme,
    bg: "#0b0f17",
    fg: FG,
    muted: MUTED,
    dim: DIM,
    rule: RULE,
    panel: PANEL,
    accent: readable(theme.accent),
    tones: {
      a: readable(theme.tones.a),
      b: readable(theme.tones.b),
      c: readable(theme.tones.c),
      d: readable(theme.tones.d),
    },
  };
}

/**
 * Every top-level rule of `css` raised by the scene's id. A selector already
 * rooted at the scene (`#s3 .panel`) repeats the id (`#s3#s3 .panel`, the same
 * element) so it stays exactly one id above the rules it used to beat; any
 * other selector is put under the scene. At-rules — the `.ds-live` ambient
 * rule, already scoped by its own construction — are left alone.
 */
export function scopeCss(css: string, sid: string): string {
  const rooted = new RegExp(`^#${sid}(?![\\w-])`);
  const scope = (sel: string) => {
    const s = sel.trim();
    if (s === "") return s;
    return rooted.test(s) ? s.replace(rooted, `#${sid}#${sid}`) : `#${sid} ${s}`;
  };
  let out = "";
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) {
      out += css.slice(i);
      break;
    }
    // The block's end, counting nested braces (an @media holds whole rules).
    let depth = 0;
    let close = open;
    for (; close < css.length; close++) {
      if (css[close] === "{") depth++;
      else if (css[close] === "}" && --depth === 0) break;
    }
    const prelude = css.slice(i, open);
    const lead = /^\s*/.exec(prelude)?.[0] ?? "";
    const head = prelude.trim();
    const sel = head.startsWith("@") ? head : splitSelectors(head).map(scope).join(",");
    out += `${lead}${sel}${css.slice(open, close + 1)}`;
    i = close + 1;
  }
  return out;
}

/** A selector list split at its top-level commas — not those inside `:is(…)`. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i));
      start = i + 1;
    }
  }
  out.push(list.slice(start));
  return out;
}

/**
 * `scene`, emitted with the `glass` theme, set over `fig`.
 *
 * The picture sits UNDER the archetype's own html at `z-index:-1` inside a
 * scene that isolates its stacking, so no in-flow element has to be told it is
 * on a picture. It stops `reserveRef` above the bottom edge, as stage's does,
 * so a deck with burned captions keeps its strip clear.
 *
 * `fit` is dropped: the fill gate measures ink off the frame's modal colour,
 * and a full-bleed picture has none, so its prediction could only disagree.
 */
export function overBackdrop(scene: Scene, fig: Figure, ctx: EmitContext, seconds: number): Scene {
  const { sid, format } = ctx;
  const reserve = reserveRef(format);
  const html = [
    // `data-layout-allow-overflow`: the picture drifts past its box on purpose
    // and the box clips it; the box itself never moves.
    `<div class="bd-m" id="${sid}-bd" data-layout-allow-overflow><img id="${sid}-bdi" src="assets/${esc(fig.src)}" alt="${esc(fig.caption)}" /></div>`,
    `<div class="bd-sc" id="${sid}-bdsc"></div>`,
    scene.html,
  ].join("\n");
  const tl: Tween[] = [
    tween(`#${sid}-bd`, { opacity: 0 }, { opacity: 1, duration: MEDIA_IN, ease: "power2.out" }, 0),
    // Slow and linear across the whole beat: a camera drifting over a scene,
    // which is ambient life the frames can seek to, not a CSS loop.
    tween(
      `#${sid}-bdi`,
      { scale: 1 },
      { scale: DRIFT_TO, duration: Math.max(2, seconds), ease: "none" },
      0,
    ),
    ...scene.tl,
  ];
  const { fit: _fit, ...rest } = scene;
  return {
    ...rest,
    html,
    tl,
    css: [
      `#${sid},#${sid} .scene{z-index:0;isolation:isolate}`,
      `#${sid} .bd-m,#${sid} .bd-sc{position:absolute;left:0;top:0;right:0;bottom:${reserve}px;z-index:-1}`,
      `#${sid} .bd-m{overflow:hidden}`,
      `#${sid} .bd-m>img{display:block;width:100%;height:100%;object-fit:cover}`,
      `#${sid} .bd-sc{background:rgba(0,0,0,${SCRIM})}`,
      // The body's colour is the deck's ink, which every archetype's text that
      // sets none inherits.
      `#${sid}{color:${FG}}`,
      ...(scene.css ? [scopeCss(scene.css, sid)] : []),
    ].join("\n"),
  };
}
