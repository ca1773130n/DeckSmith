/**
 * WHERE THE HEADLINE SITS, AND WHICH ARRANGEMENT A BEAT'S BODY TAKES — the
 * `--design v2` layout vocabulary. Nothing here runs on a classic build.
 *
 * WHY THIS EXISTS. Measured over the 219 storyboards HypePaper built 2026-10-04..07
 * (3,536 beats): four archetypes are 72% of every beat, each has exactly one
 * arrangement, and 92.7% of scenes open on the same eyebrow + 64px headline block
 * across the top of the slide. The founder's complaint — "the designs are always
 * the same" — is that number. A `Look` is the two choices that change it without
 * touching what a beat SAYS:
 *
 *   - `placement`: where the chrome (eyebrow + headline) sits. `top` is today's
 *     slide; `rail` sets it in a left column with the body beside it; `foot` puts
 *     the body first and anchors the headline under it.
 *   - `variant`: one of a small set of arrangements an archetype can draw its
 *     body in — bars as rows or as columns, a pipeline as a row, a stair or a
 *     column, a claim beside or above its figure, a comparison as columns or rows.
 *
 * THE ONE RULE A LOOK MAY NEVER BREAK: it changes geometry, never TIME. A look
 * draws the same stops at the same seconds as the classic scene (`holds`) and its
 * chrome lands when the classic chrome lands (`openSeconds`). That is what keeps
 * narration aligned: `narrate` counted stops from the classic emitter,
 * `render/timing.ts` re-derives holds from it, and `assertHoldsAgree` refuses a
 * deck whose island disagrees. The Director (`src/plan/direct.ts`) checks this
 * per candidate and drops any look that moves a hold, so a variant with a timing
 * bug degrades to the classic scene instead of shipping misaligned audio.
 *
 * WHY THE CLASSIC LOOK IS `undefined` AND NOT `{variant: "...", placement: "top"}`.
 * A classic build must emit the bytes v0.8.0 emitted. Every emitter treats an
 * absent `ctx.look` and the default look identically (`frameOf` returns the
 * classic frame for both), and only a non-default look writes anything new.
 *
 * INTERFACE FOR THE OTHER v2 TRACKS. `EmitContext.look` is the only field this
 * adds to the emit seam. A track that changes type scale or motion reads the
 * frame it is given; a track that changes fill can report `Scene` numbers the
 * Director may later score on (see `direct.ts`, "fill").
 */
import type { Archetype, Beat, Figure, Format } from "../types.js";
import { bodyBudget, chrome, chromeHeight, noteWidth, tween } from "./archetypes/title.js";
import type { EmitContext, Tween } from "./kit.js";
import { contentH, contentW, esc } from "./kit.js";
import { type Face, faceOf } from "./svg.js";

export type Placement = "top" | "rail" | "foot";

/** What `build --design v2` writes beside the deck: the Director's decisions. */
export const LOOK_FILE = "look.json";

export interface Look {
  /** One of `VARIANTS[archetype]`. The first entry is the classic arrangement. */
  variant: string;
  placement: Placement;
}

/**
 * The arrangements each archetype can draw, classic first.
 *
 * Only the four archetypes that carry 72% of beats have more than one. The other
 * nine stay classic: their volume is too small to move the sameness numbers, and
 * every variant is one more geometry that has to stay inside the 40px floor and
 * the canvas with no gate that sees a clip.
 */
export const VARIANTS: Readonly<Partial<Record<Archetype, readonly string[]>>> = {
  "split-compare": ["columns", "rows"],
  "claim-figure": ["beside", "mirror", "stacked"],
  pipeline: ["row", "stair", "column"],
  "bar-compare": ["bars", "columns", "versus"],
  // One arrangement, but its chrome may move to the foot: callouts are 7.9% of
  // beats, the largest single signature left once the four above vary.
  callout: ["panels", "rows"],
  // Same reason, 6.6% of beats, and the archetype most often set twice in a row
  // (a derivation walked over two beats) — the one adjacency a single
  // arrangement cannot avoid.
  "equation-walk": ["display"],
};

/** The classic look for an archetype: its first variant, chrome on top. */
export function classicLook(archetype: Archetype): Look {
  return { variant: VARIANTS[archetype]?.[0] ?? "classic", placement: "top" };
}

/**
 * The variant an emitter should draw. Absent look → the classic one, so a
 * classic build and a v2 build that chose the classic look are one code path.
 */
export function variantOf(ctx: EmitContext, archetype: Archetype): string {
  return ctx.look?.variant ?? classicLook(archetype).variant;
}

/**
 * `archetype:variant@placement` — what the sameness metrics count. Two beats
 * with the same signature look the same at a glance; two with different ones do
 * not, whatever their text says.
 */
export function signature(archetype: Archetype, look?: Look): string {
  const l = look ?? classicLook(archetype);
  return `${archetype}:${l.variant}@${l.placement}`;
}

/**
 * Whether the canvas is wide enough to set a headline in a column beside the
 * body. 16:9 only in practice: at 1:1 the rail would be 292px and a 64px
 * headline would set three words a line.
 */
export function railable(format: Format): boolean {
  return format.width / format.height >= 1.5;
}

/**
 * The looks the Director may choose between for one beat, before any is emitted.
 *
 * Not the full variant × placement product: some pairs are geometry nobody
 * should draw. A claim set beside its figure inside a 1,058px rail body leaves
 * the figure a 440px column, and a pipeline column across the full 1,700px top
 * body is a stack of slabs. Off 16:9 only the classic variant is offered, at
 * either end of the slide — the portrait arrangements ARE the stacked variants.
 */
export function candidates(beat: Beat, format: Format): Look[] {
  const a = beat.archetype;
  const classic = classicLook(a);
  if (!railable(format)) return [classic, { ...classic, placement: "foot" }];
  switch (a) {
    case "split-compare":
      return [
        classic,
        { variant: "rows", placement: "top" },
        { variant: "columns", placement: "foot" },
        { variant: "rows", placement: "rail" },
      ];
    case "claim-figure":
      return [
        classic,
        { variant: "mirror", placement: "top" },
        { variant: "stacked", placement: "top" },
        { variant: "beside", placement: "foot" },
        { variant: "mirror", placement: "foot" },
        { variant: "stacked", placement: "rail" },
      ];
    case "pipeline":
      return [
        classic,
        { variant: "stair", placement: "top" },
        { variant: "row", placement: "foot" },
        // Not in the rail: a stair needs the full width to step across. Set
        // beside a rail its boxes came out ~180px wide with the labels broken
        // over three lines (seen on a ja deck, 2026-10-07).
        { variant: "stair", placement: "foot" },
        { variant: "column", placement: "rail" },
      ];
    case "bar-compare":
      return [
        classic,
        { variant: "columns", placement: "top" },
        { variant: "bars", placement: "rail" },
        { variant: "columns", placement: "rail" },
        { variant: "bars", placement: "foot" },
        { variant: "columns", placement: "foot" },
        // Two values, set as figures (the emitter refuses any other count).
        { variant: "versus", placement: "top" },
        { variant: "versus", placement: "foot" },
      ];
    case "callout":
      return [
        classic,
        { variant: "panels", placement: "foot" },
        // Short panels as the rows of a table (the emitter refuses long ones).
        { variant: "rows", placement: "top" },
        { variant: "rows", placement: "foot" },
      ];
    case "equation-walk":
      return [classic, { variant: "display", placement: "foot" }];
    default:
      // The other nine stay classic until their volume justifies a variant.
      return [classic];
  }
}

/* ------------------------------------------------------------------ frames */

/** The rail's share of the content width, and the channel between rail and body. */
export const RAIL_SHARE = 0.34;
export const RAIL_GAP = 72;
/** The accent bar above a rail headline: its height plus the space under it. */
const KICK_H = 8;
const KICK_GAP = 30;
/** `foot`: the space above the rule, the rule, and the space under it. */
const FOOT_TOP = 40;
const FOOT_RULE = 3;
const FOOT_PAD = 28;
export const FOOT_SEP = FOOT_TOP + FOOT_RULE + FOOT_PAD;
/** An aside shorter than this is a thumbnail of evidence, not evidence. */
const ASIDE_MIN = 200;
/**
 * Nor may it be drawn at less than this share of its own pixel size. Paper
 * figures are extracted at about the scale they print, so their text is near
 * the smallest readable size already; a 1098px results table squeezed into the
 * 578px rail set its numbers at 7-8px (ko s9, review 2026-10-08).
 */
const ASIDE_MIN_SCALE = 0.7;
const ASIDE_GAP = 40;
const ASIDE_PAD = 12;

/**
 * The box a body lays out in, and how the chrome is set around it.
 *
 * Every emitter that has variants asks for one of these in place of the
 * `contentW` / `bodyBudget` / `chrome()` trio it used before. For the classic
 * frame each member is EXACTLY that trio — same arguments, same strings — which
 * is what keeps a classic build byte-identical (test/look.test.ts holds it).
 */
export interface Frame {
  readonly placement: Placement;
  /** Width the body lays out in, reference px. */
  readonly w: number;
  /** The column a closing note under the body sets in. */
  readonly noteW: number;
  /**
   * Height the body may take: the content box less the chrome when the chrome
   * is stacked with the body, less `below` (a note, a caption band), less the
   * body's own top margin `top`. `floor` is `bodyBudget`'s last resort.
   */
  budget(below?: number, top?: number, floor?: number): number;
  /** The scene's HTML: chrome and body in this placement's arrangement. */
  compose(body: string): string;
  /** Scoped CSS this placement needs. Empty for the classic frame. */
  readonly css: string;
  /** Tweens this placement adds (the rail's accent bar, an aside). Never a hold. */
  readonly tl: Tween[];
}

/**
 * What a frame needs to know about the beat beyond its chrome: which figures
 * the body already draws, so an aside never repeats one, and the beat's own
 * evidence, which is the only place an aside may come from.
 */
export interface FrameInput {
  eyebrow: string | undefined;
  headline: string;
  /** Figure ids the body draws. */
  drawn?: readonly (string | undefined)[];
  /** The beat's `evidence`. An aside is drawn only from a figure cited here. */
  evidence?: readonly { kind: string; id: string }[];
}

export function frameOf(ctx: EmitContext, input: FrameInput): Frame {
  const { format, sid } = ctx;
  const face = faceOf(ctx.theme.fontStack);
  const W = contentW(format);
  const placement = ctx.look?.placement ?? "top";
  const { eyebrow, headline } = input;

  if (placement === "rail") return railFrame(ctx, input, face);

  if (placement === "foot") {
    return {
      placement,
      w: W,
      noteW: noteWidth(format),
      // The chrome still shares the column with the body, so it is charged as
      // it is on top; the body's own top margin is zeroed by the CSS below and
      // the separator above the chrome is charged instead.
      budget: (below = 0, _top = 34, floor) =>
        bodyBudget(format, eyebrow, headline, below + FOOT_SEP, 0, floor, face),
      compose: (body) =>
        `<div class="lk-main" id="${sid}-lkm">${body}</div>\n<div class="lk-foot" id="${sid}-lk">${chrome(sid, eyebrow, headline, W, face)}</div>`,
      css: [
        // The body takes the height the chrome leaves and centres in it, so the
        // headline sits on the slide's foot rather than floating under a short
        // body — and a body that grows into its box (callout's `.panels`) still
        // can, because it is now a flex child of something.
        `#${sid} .lk-main{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}`,
        `#${sid} .lk-main>:first-child{margin-top:0}`,
        `#${sid} .lk-foot{margin-top:${FOOT_TOP}px;padding-top:${FOOT_PAD}px;border-top:${FOOT_RULE}px solid ${ctx.theme.rule}}`,
      ].join("\n"),
      tl: [],
    };
  }

  return {
    placement: "top",
    w: W,
    noteW: noteWidth(format),
    budget: (below = 0, top = 34, floor) =>
      bodyBudget(format, eyebrow, headline, below, top, floor, face),
    compose: (body) => `${chrome(sid, eyebrow, headline, W, face)}\n${body}`,
    css: "",
    tl: [],
  };
}

/** The rail column's width for a format. Exported for the viability check. */
export function railWidth(format: Format): number {
  return Math.round(contentW(format) * RAIL_SHARE);
}

/** The chrome's height set in the rail, accent bar included. */
export function railChromeHeight(
  format: Format,
  eyebrow: string | undefined,
  headline: string,
  face: Face,
): number {
  return KICK_H + KICK_GAP + chromeHeight(eyebrow, headline, railWidth(format), face);
}

function railFrame(ctx: EmitContext, input: FrameInput, face: Face): Frame {
  const { format, sid, theme } = ctx;
  const { eyebrow, headline } = input;
  const R = railWidth(format);
  const w = contentW(format) - R - RAIL_GAP;
  const H = contentH(format);
  const head = railChromeHeight(format, eyebrow, headline, face);
  // A headline that will not set in the rail is a refusal, not a clip: the
  // Director takes the next look. The classic look is always last in line.
  if (head > H) {
    throw new Error(
      `rail: the headline needs ${Math.ceil(head)}px in a ${R}px column and the slide has ${H}px`,
    );
  }

  const aside = asideFor(ctx, input, R, H - head - ASIDE_GAP);
  const asideHtml = aside
    ? `\n<div class="lk-aside" id="${sid}-ax"><img src="assets/${esc(aside.fig.src)}" alt="${esc(aside.fig.caption)}" /></div>`
    : "";
  const tl: Tween[] = [
    // The accent bar draws out from the rail's edge as the eyebrow arrives — the
    // same instant `chromeIn` starts, so the chrome still lands at the classic
    // second and `openSeconds` is unmoved (the id ends `-k`, not `-e`/`-h`).
    tween(
      `#${sid}-k`,
      { scaleX: 0, transformOrigin: "0% 50%" },
      { scaleX: 1, transformOrigin: "0% 50%", duration: 0.5, ease: "power2.out" },
      0.15,
    ),
  ];
  if (aside) {
    tl.push(
      tween(
        `#${sid}-ax`,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" },
        0.9,
      ),
    );
  }
  return {
    placement: "rail",
    w,
    noteW: Math.min(1600, w),
    // Nothing is stacked above the body: it has the whole column height, less
    // whatever hangs under it. Its own top margin is zeroed by the CSS.
    budget: (below = 0, _top = 34, floor = 320) => Math.max(floor, H - below),
    compose: (body) =>
      `<div class="lk-rail" id="${sid}-lk">\n<div class="lk-head"><div class="lk-kick" id="${sid}-k"></div>\n${chrome(sid, eyebrow, headline, R, face)}${asideHtml}</div>\n<div class="lk-body">${body}</div>\n</div>`,
    css: [
      `#${sid} .lk-rail{display:grid;grid-template-columns:${R}px ${w}px;column-gap:${RAIL_GAP}px;align-items:center}`,
      `#${sid} .lk-kick{width:84px;height:${KICK_H}px;border-radius:${KICK_H / 2}px;background:${theme.accent};margin-bottom:${KICK_GAP}px}`,
      `#${sid} .lk-body>:first-child{margin-top:0}`,
      ...(aside
        ? [
            `#${sid} .lk-aside{margin-top:${ASIDE_GAP}px;background:#fff;border:1px solid ${theme.rule};border-radius:10px;padding:${ASIDE_PAD}px;display:flex;justify-content:center}`,
            `#${sid} .lk-aside img{display:block;max-width:100%;max-height:${aside.h}px;width:auto;height:auto}`,
          ]
        : []),
    ].join("\n"),
    tl,
  };
}

/**
 * A figure the beat already cites, set in the rail's empty lower band.
 *
 * CONSTRAINED SO IT CANNOT INVENT OR CROWD: only a still the beat's own
 * `evidence` names, only one the body does not already draw, only when the band
 * left under the headline holds a plate at least `ASIDE_MIN` tall, and never more
 * than 30% of the rail's area. No caption: a caption would be audience text in a
 * 578px column, and it would have to be 40px. The figure's caption rides as `alt`.
 */
function asideFor(
  ctx: EmitContext,
  input: FrameInput,
  railW: number,
  room: number,
): { fig: Figure; h: number } | undefined {
  if (room < ASIDE_MIN + 2 * ASIDE_PAD) return undefined;
  const drawn = new Set(input.drawn ?? []);
  for (const ref of input.evidence ?? []) {
    if (ref.kind !== "figure" || drawn.has(ref.id)) continue;
    const fig = ctx.source.figures.find((f) => f.id === ref.id);
    // An aside is an `<img>`: only an image can be one. A clip would be its
    // video file, and a piece its script — both draw nothing.
    if (fig?.kind !== "image" || fig.width <= 0 || fig.height <= 0) continue;
    const inner = railW - 2 * ASIDE_PAD;
    const cap = Math.floor(
      Math.min(room - 2 * ASIDE_PAD, (0.3 * railW * contentH(ctx.format)) / inner),
    );
    const h = Math.min(cap, Math.round((inner * fig.height) / fig.width));
    if (h < ASIDE_MIN) continue;
    // The plate is width-bound at `inner` or height-bound at `h`; either way
    // this is the scale the figure is painted at.
    if (Math.min(inner / fig.width, h / fig.height) < ASIDE_MIN_SCALE) continue;
    return { fig, h };
  }
  return undefined;
}
