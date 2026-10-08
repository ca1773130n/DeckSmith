/**
 * A bespoke scene as the emitter sees it: the deck's own chrome on top, the
 * generated drawing in the body box below it, the generated script inside the
 * scene's timeline closure.
 *
 * THE SHELL KEEPS WHAT THE DECK OWNS. The eyebrow and headline are drawn by
 * `chrome()` and revealed by `chromeIn()` exactly as every archetype draws
 * them, so the headline wraps, scales and enters like its neighbours, and
 * `openSeconds` finds it — which is what puts the voice where it was. The
 * handoff into the next scene is the shell's too (`layout` appends it), so a
 * generated scene cannot leave a scene lit or cut to black. The model draws
 * only the body.
 *
 * THE HOLDS ARE PART OF THE ENTRY, not derived here, because they are derived
 * from the narration (see `bespokeHolds`) and `emitScene` never sees narration.
 * They are computed ONCE, in the bespoke pass, and travel with the fragment, so
 * `planCut`, `layout` and the timing manifest all read the same numbers through
 * `emitScene` — the property `stageScene`'s header says the three callers need.
 */
import { bodyBudget, chrome, chromeCss, chromeIn } from "../emit/archetypes/title.js";
import type { EmitContext, Scene } from "../emit/kit.js";
import { contentW } from "../emit/kit.js";
import { faceOf } from "../emit/svg.js";
import type { Beat } from "../types.js";
import { type Fragment, instantiate } from "./contract.js";

/** One beat's bespoke scene, ready to emit. */
export interface BespokeEntry {
  /** Token form, already through `checkFragment`. */
  fragment: Fragment;
  /** Scene-relative seconds, one per stop, from `bespokeHolds`. */
  holds: number[];
}

/** The file `build` writes beside a deck with the bespoke pass's account of itself. */
export const BESPOKE_FILE = "bespoke.json";

/** Keyed by beat id: a scene id is a position, and a cut can move it. */
export type BespokeMap = Readonly<Record<string, BespokeEntry>>;

/** Space the body box leaves under the chrome — the same 34px `bodyBudget` charges by default. */
export const BODY_TOP = 34;

/** The box the generated drawing gets, in reference px. The prompt quotes it. */
export function bespokeRegion(beat: Beat, ctx: Pick<EmitContext, "format" | "theme">) {
  const p = beat.params as { eyebrow?: string; headline: string };
  const face = faceOf(ctx.theme.fontStack);
  return {
    width: contentW(ctx.format),
    height: Math.round(bodyBudget(ctx.format, p.eyebrow, p.headline, 0, BODY_TOP, 320, face)),
  };
}

export function bespokeScene(beat: Beat, ctx: EmitContext, entry: BespokeEntry): Scene {
  const p = beat.params as { eyebrow?: string; headline: string };
  const { sid, theme } = ctx;
  const face = faceOf(theme.fontStack);
  const f = instantiate(entry.fragment, sid);
  const { width, height } = bespokeRegion(beat, ctx);
  return {
    html: `${chrome(sid, p.eyebrow, p.headline, contentW(ctx.format), face)}
<div class="ds-bespoke" id="${sid}-g">
${f.markup}
</div>`,
    tl: chromeIn(sid, p.eyebrow !== undefined),
    script: f.script,
    holds: entry.holds,
    css: [
      chromeCss(theme),
      `#${sid}-g{position:relative;flex:none;width:${width}px;height:${height}px;margin-top:${BODY_TOP}px;color:${theme.fg}}`,
      f.css,
    ].join("\n"),
  };
}

/**
 * Where a bespoke scene's stops go, given the stops its archetype had and the
 * narration that will be spoken over it.
 *
 * THE STOP COUNT IS KEPT, because `narrate` recorded the narration against it
 * and `assertNarrationStaging` refuses a deck whose beats moved. Only the
 * POSITIONS move: an archetype's holds sit where its reveals land, all inside
 * the first few seconds; a bespoke scene keeps explaining for the whole of the
 * speech, so a stop belongs where its sentence starts.
 *
 * WHY THIS LEAVES THE VOICE WHERE IT WAS. `speechPlan` starts sentence i at
 * `max(end of i-1, hold[stop_i])`. The new hold of every speaking stop past the
 * first IS that start, computed with the old holds, so recomputing with the new
 * ones returns the same starts; the first sentence starts at `open` regardless.
 * The last hold never moves earlier than the archetype's own, so `beatSeconds`'
 * `lastHold + SETTLE` term cannot shrink the scene either.
 *
 * Silent stops (narration density below `high`) are spread evenly between the
 * speaking stops either side of them.
 */
export function bespokeHolds(
  archetypeHolds: readonly number[],
  starts: ReadonlyMap<number, number>,
  speechEnd: number,
): number[] {
  const old = [...new Set(archetypeHolds.filter((h) => Number.isFinite(h) && h > 0))].sort(
    (a, b) => a - b,
  );
  const n = old.length;
  if (n === 0) return [];
  const anchor: Array<number | undefined> = old.map((_, i) => (i === 0 ? old[0] : starts.get(i)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const known = anchor[i];
    if (known !== undefined) {
      out.push(known);
      continue;
    }
    // Between the previous anchor and the next one (or the end of speech).
    let j = i + 1;
    while (j < n && anchor[j] === undefined) j++;
    const lo = out[i - 1] ?? 0;
    const hi = j < n ? (anchor[j] as number) : Math.max(speechEnd, lo + 0.1 * (n - i));
    out.push(lo + ((hi - lo) * 1) / (j - i + 1));
  }
  const last = n - 1;
  out[last] = Math.max(out[last] as number, old[last] as number);
  // Strictly increasing, 3dp (invariant 10), each at least 50ms after the last.
  for (let i = 0; i < n; i++) {
    const v = Math.round((out[i] as number) * 1000) / 1000;
    out[i] = i > 0 ? Math.max(v, (out[i - 1] as number) + 0.05) : v;
    out[i] = Math.round((out[i] as number) * 1000) / 1000;
  }
  return out;
}
