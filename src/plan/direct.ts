/**
 * THE DIRECTOR: which look each beat is drawn in, under `--design v2`.
 *
 * Pure and seeded. Same storyboard, source, format, theme and seed → same looks,
 * byte for byte (invariant 4: no `Math.random`, no clock). The seed is the
 * storyboard's `sourceId`, so two papers with the same beat sequence still get
 * different decks, and the en and ko decks of ONE paper get the same layouts.
 *
 * THE LLM DOES NOT CHOOSE THIS. The planner already shows mode collapse on the
 * one visual choice it makes — 124 of 218 decks open title > split-compare >
 * claim-figure — so geometry stays in code, where the 40px floor and the fit
 * arithmetic live.
 *
 * HOW A LOOK IS CHOSEN, per beat in deck order:
 *
 *   1. Candidates: `candidates(beat, format)` — the archetype's variant ×
 *      placement pairs worth drawing. The classic look is always one of them.
 *   2. Each non-classic candidate is EMITTED. One that throws (does not fit, or
 *      does not apply) is out; so is one whose timing differs from the classic
 *      scene — a look may move geometry, never a hold or the chrome's landing,
 *      or the narration `narrate` timed against the classic scene would play
 *      over the wrong frames. That second check is a guard against a bug in a
 *      variant, and it says so in the report rather than silently.
 *   3. Score, highest wins:
 *
 *        score = fit
 *              − 1.0 · [same signature as the previous beat]      (hard: see below)
 *              − 0.5 · (uses of this signature in the last 4 beats)
 *              − 0.3 · [same placement as BOTH of the last 2 beats]
 *              − 0.35 · (uses of this signature anywhere earlier in the deck)
 *              − 0.15 · [chrome on top]                          (the 92.7% mode)
 *              + 0.2 · taste(seed, signature)                     (per-paper, in [0,1))
 *
 *      Ties break on fnv1a(seed, beat.id, signature).
 *
 *   An adjacent identical signature is excluded outright whenever any other
 *   candidate survived; the −1.0 only decides between beats with no alternative.
 *
 * `fit` is `FIT_WEIGHT · Scene.fill`: the share of its body box the candidate's
 * body fills along the axis it grows on, as the emitter computed it while laying
 * out (bar-compare and pipeline report it; an emitter that does not is scored
 * `NEUTRAL_FILL`). It is the slot a better fill measure (feat/v2-fit) plugs into:
 * report a truer `Scene.fill` and the Director uses it unchanged.
 *
 * A beat the NEXT beat dives into (`inside`) keeps the classic look: the camera
 * measures its parts at runtime and would follow any layout, but a move through
 * a frame is the one place this deck already has motion it cannot test by eye.
 */
import { emitScene } from "../emit/archetypes/index.js";
import type { EmitContext, Scene, Theme } from "../emit/kit.js";
import { candidates, classicLook, type Look, signature } from "../emit/look.js";
import type { Archetype, Beat, Design, Format, Source } from "../types.js";

export interface DirectOptions {
  source: Source;
  format: Format;
  theme: Theme;
  /** Normally `storyboard.sourceId`. */
  seed: string;
  /**
   * The design every candidate is emitted under. `v2` from `emitDeck`, so each
   * look is measured as the fit engine will actually draw it; absent in tests
   * that exercise the Director on its own.
   */
  design?: Design;
  /** The emitter. `emitScene` unless a test substitutes one that misbehaves. */
  emit?: (beat: Beat, ctx: EmitContext) => Scene;
}

/** One beat's decision, as `out/look.json` records it. */
export interface BeatLook {
  beat: string;
  archetype: Archetype;
  variant: string;
  placement: Look["placement"];
  signature: string;
  /** The chosen look's `Scene.fill`, when its emitter reports one. */
  fill?: number;
  /** Candidates that drew and kept the classic timing. Always ≥ 1. */
  viable: number;
  /** Candidates that were refused, and why — the emitter's own sentence. */
  refused: { signature: string; reason: string }[];
}

export interface Direction {
  /** One per beat, in order: what `EmitContext.look` is set to. */
  looks: Look[];
  beats: BeatLook[];
  summary: LookSummary;
}

export interface LookSummary {
  beats: number;
  distinct: number;
  /** Share of beats whose chrome sits on top of the slide (title excluded from the numerator). */
  modalChrome: number;
  /** Adjacent pairs with the same signature. */
  adjacentRepeats: number;
  /** The four most-used signatures' share of beats. */
  top4: number;
}

export function direct(beats: readonly Beat[], opts: DirectOptions): Direction {
  const picked: Look[] = [];
  const sigs: string[] = [];
  const out: BeatLook[] = [];
  const used = new Map<string, number>();
  const emit = opts.emit ?? emitScene;

  beats.forEach((beat, i) => {
    const ctx: EmitContext = {
      source: opts.source,
      format: opts.format,
      theme: opts.theme,
      sid: `s${i + 1}`,
      start: 0,
      ...(opts.design ? { design: opts.design } : {}),
    };
    const classic = classicLook(beat.archetype);
    const dived = beats[i + 1]?.inside?.beat === beat.id;
    const offered = dived ? [classic] : candidates(beat, opts.format);

    // The classic scene is the timing every other look must reproduce. If the
    // classic scene itself does not draw, neither will anything else here, and
    // `planCut` has already dropped the beat — this cannot be reached for it.
    const classicScene = emit(beat, ctx);
    const base = timingKey(classicScene);
    const refused: BeatLook["refused"] = [];
    const viable: { look: Look; fill: number | undefined }[] = [];
    for (const look of offered) {
      const sig = signature(beat.archetype, look);
      if (sameLook(look, classic)) {
        viable.push({ look, fill: classicScene.fill });
        continue;
      }
      try {
        const scene = emit(beat, { ...ctx, look });
        if (timingKey(scene) !== base) {
          refused.push({ signature: sig, reason: "moves a hold or the chrome's landing" });
          continue;
        }
        const shrunk = figureShare(scene, classicScene);
        if (shrunk !== undefined && shrunk < FIGURE_FLOOR) {
          refused.push({
            signature: sig,
            reason: `draws the figure at ${Math.round(shrunk * 100)}% of the classic look's area`,
          });
          continue;
        }
        viable.push({ look, fill: scene.fill });
      } catch (err) {
        refused.push({ signature: sig, reason: err instanceof Error ? err.message : String(err) });
      }
    }

    const prev = sigs[i - 1];
    const notRepeat = viable.filter((v) => signature(beat.archetype, v.look) !== prev);
    const pool = notRepeat.length > 0 ? notRepeat : viable;
    let best: Look = classic;
    let bestFill: number | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestTie = 0;
    for (const { look, fill } of pool) {
      const sig = signature(beat.archetype, look);
      const score =
        scoreOf(sig, look, fill, sigs, picked, used, opts.seed) +
        affinityOf(opts.theme, beat.archetype, look);
      const tie = fnv1a(`${opts.seed}\u0000${beat.id}\u0000${sig}`);
      if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && tie > bestTie)) {
        best = look;
        bestFill = fill;
        bestScore = score;
        bestTie = tie;
      }
    }
    const sig = signature(beat.archetype, best);
    picked.push(best);
    sigs.push(sig);
    used.set(sig, (used.get(sig) ?? 0) + 1);
    out.push({
      beat: beat.id,
      archetype: beat.archetype,
      variant: best.variant,
      placement: best.placement,
      signature: sig,
      ...(bestFill === undefined ? {} : { fill: Math.round(bestFill * 1000) / 1000 }),
      viable: viable.length,
      refused,
    });
  });

  return { looks: picked, beats: out, summary: summarize(out) };
}

/**
 * How much a fuller body is worth against the variety penalties. 0.6 means a
 * look that fills its body (1.0) beats a half-empty one (0.5) by 0.3 — enough
 * to outrank one earlier use of the same signature in the deck (0.35 is not
 * far off), not enough to beat an adjacent repeat. Columns over a two-bar row
 * band is exactly the trade this is for.
 */
const FIT_WEIGHT = 0.6;
/** What an emitter that reports no `fill` is scored as: neither full nor hollow. */
const NEUTRAL_FILL = 0.5;

function scoreOf(
  sig: string,
  look: Look,
  fill: number | undefined,
  sigs: readonly string[],
  picked: readonly Look[],
  used: ReadonlyMap<string, number>,
  seed: string,
): number {
  const fit = FIT_WEIGHT * (fill ?? NEUTRAL_FILL);
  const n = sigs.length;
  const adjacent = sigs[n - 1] === sig ? 1 : 0;
  const recent = sigs.slice(Math.max(0, n - 4)).filter((s) => s === sig).length;
  const lastTwo = picked.slice(Math.max(0, n - 2));
  const samePlacement =
    lastTwo.length === 2 && lastTwo.every((l) => l.placement === look.placement) ? 1 : 0;
  const deck = used.get(sig) ?? 0;
  const modal = look.placement === "top" ? 1 : 0;
  const taste = fnv1a(`${seed}\u0000taste\u0000${sig}`) / 0x100000000;
  return (
    fit -
    1.0 * adjacent -
    0.5 * recent -
    0.3 * samePlacement -
    0.35 * deck -
    0.15 * modal +
    0.2 * taste
  );
}

/**
 * The least share of the classic look's figure area another look may draw the
 * figure at. The review (2026-10-08) measured v2's rail and foot looks shrinking
 * the paper's own figure to 43-61% of its classic area (ja s4, ko s6, en s5) to
 * make room for a headline: fill went up because white plate and bigger text
 * count as ink, and the most informative thing on the slide got smaller. A
 * look that keeps 80% or more is still a different slide; one below it is not
 * worth the variety.
 */
export const FIGURE_FLOOR = 0.8;

/** A look's figure area over the classic look's, when both report one. */
function figureShare(scene: Scene, classic: Scene): number | undefined {
  if (!scene.figureArea || !classic.figureArea) return undefined;
  return scene.figureArea / classic.figureArea;
}

/**
 * What a style pack adds for a look it leans towards (`Theme.forms.affinity`).
 * Weighted under one earlier use of the signature (0.35), so a pack shifts which
 * of the near-equal looks a deck takes without overriding fit or variety.
 */
const AFFINITY_WEIGHT = 0.25;

function affinityOf(theme: Theme, archetype: Archetype, look: Look): number {
  const a = theme.forms?.affinity;
  if (!a) return 0;
  const byPlacement = a.placement?.[look.placement] ?? 0;
  const byVariant = a.variant?.[`${archetype}:${look.variant}`] ?? 0;
  return AFFINITY_WEIGHT * (byPlacement + byVariant);
}

/** The parts of a scene a look must not change: its holds, and when its chrome lands. */
function timingKey(scene: Scene): string {
  const chrome = scene.tl
    .filter((t) => /-[eh]$/.test(t.target))
    .map((t) => `${t.target}@${t.at}+${typeof t.to.duration === "number" ? t.to.duration : 0}`);
  return JSON.stringify({ holds: scene.holds, chrome });
}

function sameLook(a: Look, b: Look): boolean {
  return a.variant === b.variant && a.placement === b.placement;
}

/** The sameness numbers for one deck. Also used by the corpus measurement. */
export function summarize(
  beats: readonly Pick<BeatLook, "archetype" | "signature" | "placement">[],
): LookSummary {
  const count = new Map<string, number>();
  for (const b of beats) count.set(b.signature, (count.get(b.signature) ?? 0) + 1);
  const top4 = [...count.values()]
    .sort((a, b) => b - a)
    .slice(0, 4)
    .reduce((a, b) => a + b, 0);
  const total = beats.length || 1;
  return {
    beats: beats.length,
    distinct: count.size,
    modalChrome:
      beats.filter((b) => b.archetype !== "title" && b.placement === "top").length / total,
    adjacentRepeats: beats.filter((b, i) => i > 0 && beats[i - 1]?.signature === b.signature)
      .length,
    top4: top4 / total,
  };
}

/** 32-bit FNV-1a. Deterministic, dependency-free, and enough to spread ties. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
