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
import { bodyBudget, chrome, chromeCss, chromeHeight, chromeIn } from "../emit/archetypes/title.js";
import type { EmitContext, Scene, Theme } from "../emit/kit.js";
import { contentW, PAD_Y, refHeight, refWidth } from "../emit/kit.js";
import { faceOf } from "../emit/svg.js";
import type { Beat, Format } from "../types.js";
import { type ArtRef, artHref, planeHref } from "./art.js";
import { type Fragment, instantiate } from "./contract.js";
import type { DataBuild } from "./databuild.js";
import type { Grammar } from "./grammar.js";
import {
  artPlacement,
  type Box,
  cameraScript,
  compileStaging,
  type DepthStage,
  planeId,
  type Staging,
  sharpMax,
  subjectId,
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

/**
 * ROUND 6: an illustrated scene is the whole frame. Its picture is a full-bleed
 * shot behind the deck's own headline (which keeps its place and its entrance),
 * so its box is the frame, and the headline's band at the top is the one place
 * the scene's own words may not go (`chromeBand`).
 */
export function cineRegion(format: Format): { width: number; height: number } {
  return { width: refWidth(format), height: refHeight(format) };
}

/** How far down the frame the headline reaches, px: the scene's own words stay below it. */
export function chromeBand(beat: Beat, ctx: Pick<EmitContext, "format" | "theme">): number {
  const p = beat.params as { eyebrow?: string; headline: string };
  const face = faceOf(ctx.theme.fontStack);
  return Math.round(
    PAD_Y + chromeHeight(p.eyebrow, p.headline, contentW(ctx.format), face) + BODY_TOP,
  );
}

/** Whether a scene's script moves the shell's camera (`#SCENEID-cam`). */
export function usesCamera(script: string): boolean {
  return /#[\w]+-cam(?![\w-])/.test(script);
}

/**
 * The shell's (round 6): every word under a scene's own camera keeps the size it
 * declares. For each camera tween — the wrapper's `scale`, or the svg's
 * `viewBox` — the words get the inverse scale about their own centres over the
 * same span, so a push-in enlarges the drawing and never the type (the r1
 * review found labels at 75-80px under zoom; `type_scale` holds the rendered
 * size). Tweens marked `data: "shell"`, which `ui_motion` does not count.
 */
export function quietWords(sid: string): string {
  return `// The shell's: the words keep their declared size under the camera.
(function () {
  var cam = root.querySelector("#${sid}-cam");
  if (!cam) return;
  var svg = root.querySelector("#${sid}-svg");
  var W = svg ? parseFloat(svg.getAttribute("width")) : 0;
  var html = "p, span, div, b, strong, em, small, i, sub, sup";
  var words = Array.prototype.filter.call(cam.querySelectorAll("text, " + html), function (el) {
    if (el.closest(".katex") && !el.classList.contains("katex")) return false;
    if (el.tagName.toLowerCase() === "text") return true;
    if (el.parentElement && el.parentElement.closest(html) && cam.contains(el.parentElement.closest(html))) return false;
    return Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); }) || el.classList.contains("katex");
  });
  if (!words.length) return;
  var scaleOf = function (tw, from) {
    var v = from ? tw.vars.startAt || {} : tw.vars;
    if (tw.targets()[0] === cam) return typeof v.scale === "number" ? v.scale : undefined;
    var box = v.attr && v.attr.viewBox;
    if (typeof box !== "string" || !W) return undefined;
    var w = parseFloat(box.trim().split(/[s,]+/)[2]);
    return w > 0 ? W / w : undefined;
  };
  tl.getChildren(false, true, false).forEach(function (tw) {
    var t = tw.targets();
    if (t.length !== 1 || (t[0] !== cam && t[0] !== svg)) return;
    var a = scaleOf(tw, true), b = scaleOf(tw, false);
    if (!a || !b || Math.abs(a - b) < 0.001) return;
    tl.fromTo(words, { scale: 1 / a }, { scale: 1 / b, duration: tw.duration(), ease: tw.vars.ease, repeat: tw.vars.repeat || 0, yoyo: !!tw.vars.yoyo, transformOrigin: "50% 50%", immediateRender: false, data: "shell" }, tw.startTime());
  });
})();`;
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
  // Round 6: the picture is the shell's depth planes; a scene's own copy of it goes.
  if (art.depth)
    return markup.replace(
      /<image\b[^>]*\sdata-art\s*=\s*(["']?)1\1[^>]*?(\/>|>\s*<\/image>)/gi,
      "",
    );
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
 * An illustrated entry's subjects in box px and the camera moves its shots
 * compile to. In a depth scene (round 6) the subjects are where the depth
 * planes put them.
 */
export function staging(
  entry: BespokeEntry,
  box: { width: number; height: number },
): { subjects: Box[]; staged: Staging } {
  const art = entry.art;
  const none: Staging = {
    grammar: entry.grammar ?? "tour",
    open: { s: 1, x: 0, y: 0 },
    moves: [],
    wipes: [],
  };
  if (!art?.subjects?.length || !entry.stage) return { subjects: [], staged: none };
  const subjects = subjectsOf(art, box);
  const staged = compileStaging(
    entry.grammar ?? "tour",
    entry.fragment.shots ?? [],
    entry.stage.cues,
    entry.stage.duration,
    subjects,
    box.width,
    box.height,
    sharpMax(art, box),
  );
  return { subjects, staged };
}

/** The picture's subjects in box px: from its depth planes when it has them. */
export function subjectsOf(art: ArtRef, box: { width: number; height: number }): Box[] {
  const placed = subjectsInBox(art.subjects ?? [], art, box);
  const cut = art.depth?.subjects;
  if (!cut?.length) return placed;
  return (art.subjects ?? []).flatMap((_, i) => {
    const d = cut.find((c) => c.subject === i + 1);
    return d ? [d.box] : [];
  });
}

/**
 * ROUND 6: the picture as depth planes, far to near, each a frame-sized layer
 * the camera script moves at its own distance (shots.ts `planeFrame`). The
 * backdrop's planes cover the frame; each subject is its own plane, holding a
 * `.ds-life` wrapper its breathing moves. Then the air in front of them: the
 * light that sweeps, the vignette, and the scrims under the headline and the
 * subtitles. Nothing here is text, and the farthest plane keeps round 5's
 * `#sid-plate` id (the gates read the backdrop's parallax off it). A plane in
 * a push-in is mostly outside the frame by design, so each carries
 * hyperframes' `data-layout-allow-overflow` (its `escaped_container` warning
 * would otherwise send every scene to a critique call).
 */
export function depthLayers(
  sid: string,
  art: ArtRef,
  W: number,
  H: number,
  theme: Theme,
  band: number,
): string {
  const d = art.depth;
  if (!d) return "";
  const svg = (inner: string) =>
    `<svg aria-hidden="true" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0">${inner}</svg>`;
  const layers = [
    ...d.planes.map((p, i) => ({
      z: p.z,
      html: `<div class="ds-plane" data-layout-allow-overflow id="${planeId(sid, i)}" data-ds-z="${p.z}">${svg(`<image${i === 0 ? ' data-art="1" data-ds-plate="1"' : ""} href="${planeHref(p)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/><image class="ds-soft" id="${planeId(sid, i)}-soft" href="${planeHref(p.soft)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none" opacity="0"/>`)}</div>`,
    })),
    ...d.subjects.map((p) => ({
      z: p.z,
      html: `<div class="ds-plane" data-layout-allow-overflow id="${subjectId(sid, p.subject)}" data-ds-z="${p.z}"><div class="ds-life" data-ds-life="${p.subject}">${svg(`<image href="${planeHref(p)}" x="${p.box.x}" y="${p.box.y}" width="${p.box.w}" height="${p.box.h}" preserveAspectRatio="none"/><image class="ds-soft" id="${subjectId(sid, p.subject)}-soft" href="${planeHref(p.soft)}" x="${p.box.x}" y="${p.box.y}" width="${p.box.w}" height="${p.box.h}" preserveAspectRatio="none" opacity="0"/>`)}</div></div>`,
    })),
  ]
    // Far first: a near plane of the backdrop (a foreground frame) paints over the subjects.
    .sort((a, b) => b.z - a.z)
    .map((l) => l.html);
  const glow = theme.accent;
  return `${layers.join("\n")}
<div class="ds-air" aria-hidden="true">
<div class="ds-light" data-layout-allow-overflow id="${sid}-light" style="background:radial-gradient(closest-side,${hexA(glow, 0.16)},${hexA(glow, 0)} 72%)"></div>
<div class="ds-vignette" style="background:radial-gradient(ellipse at 50% 50%,${hexA(theme.bg, 0)} 60%,${hexA(theme.bg, 0.4)} 100%)"></div>
<div class="ds-scrim" style="height:${Math.round(band + 60)}px;background:linear-gradient(${hexA(theme.bg, 0.7)},${hexA(theme.bg, 0.3)} ${Math.round((100 * band) / (band + 60))}%,${hexA(theme.bg, 0)})"></div>
<div class="ds-scrim ds-scrim-low" style="height:${Math.round(H * 0.2)}px;background:linear-gradient(${hexA(theme.bg, 0)},${hexA(theme.bg, 0.45)})"></div>
</div>`;
}

/** `#rrggbb` with an alpha, as `rgba()`. */
export function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex.trim());
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => Number.parseInt(h as string, 16));
  return `rgba(${r},${g},${b},${a})`;
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
  // ROUND 6: a picture cut into depth planes makes the scene a full-frame shot.
  const cine = entry.art?.depth !== undefined;
  const { width, height } = cine ? cineRegion(ctx.format) : bespokeRegion(beat, ctx);
  // An illustrated scene is STAGED by the shell (round 4): its subjects are
  // known boxes, and the camera follows the scene's shot list in its grammar
  // (src/bespoke/shots.ts) — in round 6 through the picture's depth planes.
  const { subjects, staged } = staging(entry, { width, height });
  const { moves } = staged;
  const art = entry.art;
  const depth: DepthStage | undefined =
    cine && art?.depth && subjects.length
      ? {
          planes: art.depth.planes,
          subjects: art.depth.subjects.map((s) => ({ subject: s.subject, z: s.z, box: s.box })),
          duration: entry.stage?.duration ?? 0,
        }
      : undefined;
  const shot =
    moves.length || staged.wipes.length || staged.open.s !== 1 || depth
      ? cameraScript(sid, moves, width, height, {
          open: staged.open,
          wipes: staged.wipes,
          ...(depth ? { depth } : {}),
        })
      : "";
  // A scene that moves its own camera (not a full-frame shot, whose words sit
  // outside the camera on #sid-fx) keeps its words at their declared size.
  const quiet = !cine && (usesCamera(f.script) || /\bviewBox\b/.test(f.script));
  const script = [shot, f.script, quiet ? quietWords(sid) : ""].filter(Boolean).join("\n");
  // THE CAMERA is the shell's: a wrapper the size of the box, transformed from
  // its top-left corner, so a scene frames a part by tweening its scale/x/y —
  // seek-safe like any tween, and it carries HTML overlays (KaTeX) with the
  // SVG, which a viewBox camera does not. A scene that moves it is clipped to
  // its box, so a push-in never paints over the headline. A viewBox camera
  // (an `attr: { viewBox }` tween) zooms past the box as well.
  const camera = cine || usesCamera(script) || /\bviewBox\b/.test(script);
  const box = `<div class="ds-bespoke${cine ? " ds-cine" : ""}" id="${sid}-g"${camera ? " data-ds-clip" : ""}${subjects.length ? ` data-ds-grammar="${staged.grammar}"` : ""}${entry.build ? ` data-ds-build="${entry.build}"` : ""}${depth ? ` data-ds-depth="${depth.planes.length}"` : ""}>
${cine && art ? depthLayers(sid, art, width, height, theme, chromeBand(beat, ctx)) : ""}
<div class="ds-cam" id="${sid}-cam">
${cine ? "" : withArt(f.markup, art, subjects.length ? { width, height } : undefined)}
${subjectLayer(subjects, width, height)}
</div>${
    cine
      ? `
<div class="ds-fx" id="${sid}-fx">
${withArt(f.markup, art)}
</div>`
      : ""
  }
</div>`;
  const head = chrome(sid, p.eyebrow, p.headline, contentW(ctx.format), face);
  return {
    // A full-frame shot comes FIRST in the document and the headline after it,
    // positioned above it: nothing the picture paints is "over" the headline,
    // and the headline keeps its place at the top of the scene.
    html: cine ? `${box}\n${head}` : `${head}\n${box}`,
    tl: chromeIn(sid, p.eyebrow !== undefined),
    script,
    holds: entry.holds,
    // Vendored only when a scene morphs, so no other deck carries its bytes.
    ...(usesMorph(f.script) ? { plugins: ["morphSVG"] } : {}),
    css: [
      chromeCss(theme),
      cine
        ? `#${sid}{justify-content:flex-start}#${sid}-g{position:absolute;left:0;top:0;width:${width}px;height:${height}px;overflow:hidden;color:${theme.fg};background:${theme.bg}}#${sid}-e,#${sid}-h{position:relative;z-index:2}`
        : `#${sid}-g{position:relative;flex:none;width:${width}px;height:${height}px;margin-top:${BODY_TOP}px;color:${theme.fg}${camera ? ";overflow:hidden" : ""}}`,
      `#${sid}-cam{position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0}`,
      ...(cine
        ? [
            `#${sid}-g .ds-plane{position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0}`,
            `#${sid}-g .ds-life{position:absolute;left:0;top:0;width:${width}px;height:${height}px}`,
            `#${sid}-g .ds-air>div{position:absolute;left:0;pointer-events:none}`,
            // Plain alpha, not a blend mode: a blend over six frame-sized layers is
            // composited on the CPU in the gates' browser.
            `#${sid}-g .ds-light{top:${Math.round(-0.2 * height)}px;width:${Math.round(0.6 * width)}px;height:${Math.round(1.4 * height)}px}`,
            `#${sid}-g .ds-vignette{top:0;width:${width}px;height:${height}px}`,
            `#${sid}-g .ds-scrim{top:0;width:${width}px}`,
            `#${sid}-g .ds-scrim-low{top:auto;bottom:0}`,
            // The scene's own drawing is FIXED to the frame (round 6): the picture
            // moves under it, so its words never zoom past the type scale.
            `#${sid}-fx{position:absolute;left:0;top:0;width:${width}px;height:${height}px}`,
          ]
        : []),
      // The illustration's edges, feathered by the shell unless the scene masks
      // it itself: its flat ground meets a pack ground that is often a
      // gradient, and an unmasked picture showed as a lighter rectangle.
      // A picture whose copy is feathered already (alpha baked in by the pass)
      // needs none: MEASURED 2026-10-09, this CSS mask made every screenshot of
      // its scene ~0.7s slower (13.5s against 4.1s for one scene's 13 frames).
      ...(art && !cine && !art.feathered && !art.cutout
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
