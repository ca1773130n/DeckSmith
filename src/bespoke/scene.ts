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
import { type ArtRef, artHref, plateHref } from "./art.js";
import { calloutLayer, calloutZones, withZone, type Zone } from "./callouts.js";
import { type Fragment, instantiate } from "./contract.js";
import type { DataBuild } from "./databuild.js";
import type { Grammar } from "./grammar.js";
import {
  artPlacement,
  type Box,
  cameraScript,
  compileStaging,
  type Staging,
  sharpMax,
  subjectsInBox,
} from "./shots.js";

/** One beat's bespoke scene, ready to emit. */
export interface BespokeEntry {
  /** Token form, already through `checkFragment`. */
  fragment: Fragment;
  /** Scene-relative seconds, one per stop, from `bespokeHolds`. */
  holds: number[];
  /** The beat's illustration, when it has one: `<image data-art="1">` shows it (src/bespoke/art.ts). */
  art?: ArtRef;
  /**
   * The narration cues on the scene's clock and its length, from the same
   * timing the cue windows came from: what the shell's camera is timed to
   * (src/bespoke/shots.ts). Present on an illustrated scene.
   */
  stage?: { cues: ReadonlyArray<{ t0: number; t1: number }>; duration: number };
  /** The camera grammar an illustrated scene is staged in (src/bespoke/grammar.ts). Absent: "tour". */
  grammar?: Grammar;
  /** A data scene's build (src/bespoke/databuild.ts), stamped on the scene for the deck gate. */
  build?: DataBuild;
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

/** Whether a scene's script moves the shell's camera (`#SCENEID-cam`). */
export function usesCamera(script: string): boolean {
  return /#[\w]+-cam(?![\w-])/.test(script);
}

/**
 * The illustration's href AND its placement, written by the shell into the
 * scene's one `<image data-art="1">` — the contract refuses an href from the
 * model, so the deck only ever references a file the build copied under its
 * own name; and the picture always covers the body box (`slice`), so the
 * subject boxes the camera and the labels are anchored to are where the
 * picture's subjects are, whatever the scene wrote.
 */
export function withArt(
  markup: string,
  art: ArtRef | undefined,
  box?: { width: number; height: number },
  clip?: string,
): string {
  if (!art) return markup;
  const href = (s: string) =>
    s.replace(
      /<image\b([^>]*?)\sdata-art\s*=\s*(["']?)1\2/gi,
      (m) => `${m} href="${artHref(art)}"`,
    );
  if (!box) return href(markup);
  return href(
    markup.replace(/<image\b([^>]*?)(\/?)>/gi, (m, attrs: string, close: string) => {
      if (!/\sdata-art\s*=\s*(["']?)1\1/i.test(` ${attrs}`)) return m;
      // A wiped-on picture is the shell's to reveal: the scene's own clip or mask goes.
      const owned = clip
        ? /x|y|width|height|preserveAspectRatio|clip-path|mask/
        : /x|y|width|height|preserveAspectRatio/;
      const kept = attrs.replace(
        new RegExp(`\\s(${owned.source})\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "gi"),
        "",
      );
      const at = artPlacement(box);
      return `<image${kept} x="${at.x}" y="${at.y}" width="${at.w}" height="${at.h}" preserveAspectRatio="xMidYMid slice"${clip ? ` clip-path="url(#${clip})"` : ""}${close}>`;
    }),
  );
}

/**
 * The subjects' boxes as the gates see them: invisible rects inside the camera
 * (so they move with it), after the scene's markup (so the repair pass's
 * `tag:index` addresses of the scene's own elements do not shift).
 */
export function subjectLayer(subjects: readonly Box[], width: number, height: number): string {
  if (!subjects.length) return "";
  return `<svg class="ds-subjects" aria-hidden="true" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none">${subjects
    .map(
      (b, i) =>
        `<rect data-ds-subject="${i + 1}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" visibility="hidden"/>`,
    )
    .join("")}</svg>`;
}

/**
 * An illustrated entry's subjects in body px, its labels' zones, and the camera
 * moves its shots compile to — each push-in framing the subject together with
 * its label's zone, so the label the camera arrives for is in the shot.
 */
export function staging(
  entry: BespokeEntry,
  box: { width: number; height: number },
): { subjects: Box[]; zones: Zone[]; staged: Staging } {
  const art = entry.art;
  const none: Staging = {
    grammar: entry.grammar ?? "tour",
    open: { s: 1, x: 0, y: 0 },
    moves: [],
    wipes: [],
  };
  if (!art?.subjects?.length || !entry.stage) return { subjects: [], zones: [], staged: none };
  const subjects = subjectsInBox(art.subjects, art, box);
  const zones = calloutZones(subjects, box.width, box.height);
  const labelled = new Set((entry.fragment.labels ?? []).map((l) => l.subject));
  const targets = subjects.map((s, i) =>
    labelled.has(i + 1)
      ? withZone(
          s,
          zones.find((z) => z.subject === i + 1),
        )
      : s,
  );
  const staged = compileStaging(
    entry.grammar ?? "tour",
    entry.fragment.shots ?? [],
    entry.stage.cues,
    entry.stage.duration,
    targets,
    box.width,
    box.height,
    sharpMax(art, box),
  );
  return { subjects, zones, staged };
}

/**
 * The backdrop layer (round 5): the setting, behind the camera's wrapper and
 * moved by its own twin of every camera tween at `PARALLAX` of the zoom. It
 * covers the whole body box, the label band included; the shell's wipe clip,
 * when the grammar is "wipe", is defined here too.
 */
export function plateLayer(
  sid: string,
  art: ArtRef | undefined,
  width: number,
  height: number,
  wipe: boolean,
): string {
  const defs = wipe
    ? `<defs><clipPath id="${sid}-wipeclip" clipPathUnits="userSpaceOnUse"><rect id="${sid}-wipe" x="0" y="0" width="0" height="${height}"/></clipPath></defs>`
    : "";
  if (!art?.plate)
    return wipe
      ? `<svg class="ds-shell" aria-hidden="true" width="0" height="0" style="position:absolute">${defs}</svg>`
      : "";
  return `<div class="ds-plate" id="${sid}-plate"><svg aria-hidden="true" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="position:absolute;left:0;top:0">${defs}<image data-ds-plate="1" href="${plateHref(art.plate)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"${wipe ? ` clip-path="url(#${sid}-wipeclip)"` : ""}/></svg></div>`;
}

/** CSS feather for an illustration's edges: 6% at the sides, 10% top and bottom. */
export const ART_FEATHER =
  "-webkit-mask-image:linear-gradient(to right,transparent,#000 6%,#000 94%,transparent),linear-gradient(to bottom,transparent,#000 10%,#000 90%,transparent);-webkit-mask-composite:source-in;mask-composite:intersect";

/** Whether a scene's script tweens `morphSVG` (MorphSVGPlugin must be registered first). */
export function usesMorph(script: string): boolean {
  return /\bmorphSVG\b/.test(script);
}

export function bespokeScene(beat: Beat, ctx: EmitContext, entry: BespokeEntry): Scene {
  const p = beat.params as { eyebrow?: string; headline: string };
  const { sid, theme } = ctx;
  const face = faceOf(theme.fontStack);
  const f = instantiate(entry.fragment, sid);
  const { width, height } = bespokeRegion(beat, ctx);
  // An illustrated scene is STAGED by the shell (round 4): the picture covers
  // the box, its subjects are known boxes, and the camera follows the scene's
  // shot list in one fixed grammar (src/bespoke/shots.ts).
  const { subjects, zones, staged } = staging(entry, { width, height });
  const { moves } = staged;
  const wipe = staged.wipes.length > 0;
  const plate = subjects.length > 0 && entry.art?.plate !== undefined;
  const shot =
    moves.length || wipe || staged.open.s !== 1
      ? cameraScript(sid, moves, width, height, { open: staged.open, plate, wipes: staged.wipes })
      : "";
  const callouts = subjects.length
    ? calloutLayer(sid, f.labels ?? [], zones, staged, theme, width, height)
    : { markup: "", script: "" };
  const script = [shot, callouts.script, f.script].filter(Boolean).join("\n");
  // THE CAMERA is the shell's: a wrapper the size of the body box, transformed
  // from its top-left corner, so a scene frames a part by tweening its
  // scale/x/y — seek-safe like any tween, and it carries HTML overlays (KaTeX)
  // with the SVG, which a viewBox camera does not. A scene that moves it is
  // clipped to its box, so a push-in never paints over the headline.
  // A viewBox camera (an `attr: { viewBox }` tween) zooms past the box as well.
  const camera = usesCamera(script) || /\bviewBox\b/.test(script);
  return {
    html: `${chrome(sid, p.eyebrow, p.headline, contentW(ctx.format), face)}
<div class="ds-bespoke" id="${sid}-g"${camera ? " data-ds-clip" : ""}${subjects.length ? ` data-ds-grammar="${staged.grammar}"` : ""}${entry.build ? ` data-ds-build="${entry.build}"` : ""}>
${subjects.length ? plateLayer(sid, entry.art, width, height, wipe) : ""}
<div class="ds-cam" id="${sid}-cam">
${withArt(f.markup, entry.art, subjects.length ? { width, height } : undefined, wipe ? `${sid}-wipeclip` : undefined)}
${subjectLayer(subjects, width, height)}
${callouts.markup}
</div>
</div>`,
    tl: chromeIn(sid, p.eyebrow !== undefined),
    script,
    holds: entry.holds,
    // Vendored only when a scene morphs, so no other deck carries its bytes.
    ...(usesMorph(f.script) ? { plugins: ["morphSVG"] } : {}),
    css: [
      chromeCss(theme),
      `#${sid}-g{position:relative;flex:none;width:${width}px;height:${height}px;margin-top:${BODY_TOP}px;color:${theme.fg}${camera ? ";overflow:hidden" : ""}}`,
      `#${sid}-cam{position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0}`,
      ...(plate
        ? [
            `#${sid}-plate{position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0}`,
          ]
        : []),
      // The illustration's edges, feathered by the shell unless the scene masks
      // it itself: its flat ground meets a pack ground that is often a
      // gradient, and an unmasked picture showed as a lighter rectangle.
      // A picture whose copy is feathered already (alpha baked in by the pass)
      // needs none: MEASURED 2026-10-09, this CSS mask made every screenshot of
      // its scene ~0.7s slower (13.5s against 4.1s for one scene's 13 frames).
      // A cutout (round 5: subjects on a transparent ground) has no edge to feather.
      ...(entry.art && !entry.art.feathered && !entry.art.cutout
        ? [`#${sid}-g image[data-art]:not([mask]){${ART_FEATHER}}`]
        : []),
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
