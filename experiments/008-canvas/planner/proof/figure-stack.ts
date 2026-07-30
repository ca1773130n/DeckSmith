/**
 * `stack`, rewritten under the split. Geometry only.
 *
 * This is src/emit/archetypes/stack.ts with one thing removed: the timeline.
 * Everything that decides where a plane goes is imported from the real emitter's
 * own solver (`stackLayout`), unchanged and unforked, which is the point — the
 * geometry half of an archetype is not what this refactor touches.
 *
 * What is gone is lines 321-346 of the original: `first = 0.9`,
 * `step = min(0.8, max(0.4, (seconds - 2.4)/count))`, seven `tl.push(tween(...))`
 * calls and seven `holds.push(at + 0.62)` calls. In their place the figure
 * declares what its elements *are* — seven items, each with a caption that
 * trails it, the top one carrying the beat's weight — and the planner decides
 * when. The emitter no longer names a single duration.
 *
 * Two things it now says that it could not say before:
 *   - `weight`, so "the top plane is the point" is data rather than a comment
 *     next to the `ambient()` call.
 *   - `focus`, a box in the camera layer's coordinates, so a camera can frame
 *     the plane that is arriving. Both are arithmetic over numbers `stackLayout`
 *     already produced; neither needs a measurement or a clock.
 */
import type { BeatOf, Format } from "../../../../src/types.js";
import type { EmitContext } from "../../../../src/emit/kit.js";
import { esc } from "../../../../src/emit/kit.js";
import { circle, group, id, line, MIN_FONT, n, path, svg, text } from "../../../../src/emit/svg.js";
import { ambient, BREATHE } from "../../../../src/emit/theme.js";
import { chrome, chromeCss } from "../../../../src/emit/archetypes/title.js";
import { type StackLayout, stackLayout } from "../../../../src/emit/archetypes/stack.js";
import type { Cue, Figure } from "./motion.js";

const PAD_X = 110;
const PAD_Y = 84;
const NUM_X = 48;

/** The content area: `.scene` minus its padding. */
export const CONTENT = { w: 1920 - 2 * PAD_X, h: 1080 - 2 * PAD_Y };

/**
 * The camera budget, and the only place this refactor costs the *geometry*
 * anything.
 *
 * A camera can only move inside slack, and today every archetype fills its box —
 * so a camera on `stack` as it stands would have to crop a label to move at all.
 * The figure therefore solves its diagram against a frame inset by this much and
 * centres the result, permanently. The price is exact and worth stating: the
 * pile is 10% narrower and 10% shorter than it would otherwise be, whether or
 * not any camera is ever planned over it — because a geometry that changed with
 * the animation style would put choreography back inside the emitter, which is
 * the thing this whole design is trying to end.
 */
const CAM_ROOM = 0.1;

/** Copied from the real emitter — unexported there, and pure geometry. */
function slab(x0: number, y0: number, L: StackLayout, fill: string, lift: number, stroke: string) {
  const { w, sx, sy, t } = L;
  const top = `M${n(x0)},${n(y0)} L${n(x0 + w)},${n(y0)} L${n(x0 + w + sx)},${n(y0 - sy)} L${n(x0 + sx)},${n(y0 - sy)} Z`;
  const front = `M${n(x0)},${n(y0)} L${n(x0)},${n(y0 + t)} L${n(x0 + w)},${n(y0 + t)} L${n(x0 + w)},${n(y0)} Z`;
  const side = `M${n(x0 + w)},${n(y0)} L${n(x0 + w)},${n(y0 + t)} L${n(x0 + w + sx)},${n(y0 + t - sy)} L${n(x0 + w + sx)},${n(y0 - sy)} Z`;
  const edge = { stroke, "stroke-width": 2, "stroke-opacity": 0.75 };
  return (
    path(front, { fill, "fill-opacity": n(lift * 0.5), ...edge }) +
    path(side, { fill, "fill-opacity": n(lift * 0.3), ...edge }) +
    path(top, { fill, "fill-opacity": n(lift), stroke, "stroke-width": 2 })
  );
}

export function stackFigure(beat: BeatOf<"stack">, ctx: EmitContext & { format: Format }): Figure {
  const { sid, theme } = ctx;
  const p = beat.params;
  // The diagram is solved against an inset frame; the chrome is not, because the
  // chrome is not on the camera and does not need the room.
  const inset: Format = {
    ...ctx.format,
    width: Math.round(ctx.format.width * (1 - CAM_ROOM)),
    height: Math.round(ctx.format.height * (1 - CAM_ROOM)),
  };
  const L = stackLayout(p, inset);
  const count = p.layers.length;
  const last = count - 1;

  /**
   * The camera's viewport is a box of known size — not a flex-centred column
   * whose position must be predicted. Everything the camera needs is therefore
   * exact by construction: the diagram is centred inside a viewport this file
   * dimensions itself, so a focus box is `svgLeft + x`, and there is nothing to
   * measure and nothing that could disagree with the browser.
   */
  const full = stackLayout(p, ctx.format);
  const viewH = Math.max(L.height, Math.round(CONTENT.h - full.chromeH - 20 - full.noteH));
  const svgLeft = (CONTENT.w - L.width) / 2;
  const svgTop = (viewH - L.height) / 2;

  const cues: Cue[] = [
    ...(p.eyebrow ? [{ sel: `#${sid}-e`, role: "eyebrow" as const, step: -1, dir: "up" as const }] : []),
    { sel: `#${sid}-h`, role: "headline", step: -1, dir: "up" },
  ];

  const body = p.layers
    .map((layer, i) => {
      const y0 = L.yBase - i * L.rise;
      const mid = y0 - L.sy / 2;
      const top = i === last;
      const tint = top ? theme.tones.b : theme.accent;
      const stroke = top ? theme.tones.b : theme.rule;
      const lift = 0.09 + 0.13 * (i / Math.max(1, last));

      const leader = line(
        { x: L.x0 + L.w + L.sx / 2 + 8, y: mid },
        { x: L.labelX - 14, y: mid },
        { stroke: theme.rule, "stroke-width": 2 },
      );
      const dot = circle({ x: L.x0 + L.w + L.sx / 2 + 8, y: mid }, 6, { fill: tint });
      const block = L.lines[i] ?? { label: [], note: [], noteW: 0, labelMaxW: L.colW };
      const labelH = block.label.length * L.labelSize * 1.16;
      const noteH = block.note.length > 0 ? 6 + block.note.length * MIN_FONT * 1.16 : 0;
      const label = text(
        layer.label,
        { x: L.labelX, y: L.inline ? mid : mid - noteH / 2 },
        {
          size: L.labelSize,
          weight: top ? 700 : 600,
          fill: top ? theme.tones.b : theme.fg,
          maxWidth: block.labelMaxW,
          lineHeight: 1.16,
          vAlign: "middle",
        },
      );
      const note =
        layer.note === undefined
          ? ""
          : text(
              layer.note,
              L.inline ? { x: L.labelX + L.colW, y: mid } : { x: L.labelX, y: mid + labelH / 2 + 3 },
              {
                size: MIN_FONT,
                fill: theme.muted,
                anchor: L.inline ? "end" : "start",
                maxWidth: L.inline ? undefined : L.colW,
                lineHeight: 1.16,
                vAlign: "middle",
              },
            );
      const num = text(
        String(i + 1),
        { x: NUM_X, y: mid },
        { size: MIN_FONT, weight: 600, fill: theme.dim, anchor: "end", vAlign: "middle" },
      );

      // The plane is an item and owns the stop; its caption is a tag that trails
      // it. That relationship is what the original expressed as `at` and
      // `at + 0.2`, and expressing it as structure is what lets a rhythm change
      // the 0.2 without an emitter knowing a rhythm exists.
      cues.push({
        sel: `#${id(sid, "lay", i)}`,
        role: "item",
        step: i,
        dir: "up",
        weight: top ? 0.95 : 0.3 + 0.05 * i,
        focus: {
          x: svgLeft,
          y: svgTop + mid - L.rise / 2,
          w: L.width,
          h: L.rise,
        },
      });
      cues.push({ sel: `#${id(sid, "cap", i)}`, role: "tag", step: i, after: 1 });

      return (
        group(slab(L.x0, y0, L, tint, lift, stroke), { id: id(sid, "lay", i), class: "lay" }) +
        group(num + leader + dot + label + note, { id: id(sid, "cap", i), class: "cap" })
      );
    })
    .join("");

  if (p.note) cues.push({ sel: `#${sid}-note`, role: "note", step: count, dir: "up" });

  const noteHtml = p.note ? `\n<div class="stnote" id="${sid}-note">${esc(p.note)}</div>` : "";
  // The chrome and the tail note sit OUTSIDE the camera. Only the diagram is on
  // it, which is what stops a push-in from cropping the claim.
  const html = `${chrome(sid, p.eyebrow, p.headline)}
<div class="stackwrap" style="height:${viewH}px">
  <div class="cam" id="${sid}-cam"><div class="camin" style="left:${svgLeft}px;top:${svgTop}px">${svg(id(sid, "stack"), L.width, L.height, body)}</div></div>
</div>${noteHtml}`;

  return {
    html,
    cues,
    stage: {
      sel: `#${sid}-cam`,
      w: CONTENT.w,
      h: viewH,
      safe: { x: svgLeft, y: svgTop, w: L.width, h: L.height },
    },
    css: [
      chromeCss(theme),
      // The wrap is the viewport and clips; the cam is what transforms. Both are
      // explicitly sized, so the coordinates the planner reasons in are the
      // coordinates the browser lays out.
      ".stackwrap{position:relative;overflow:hidden;margin-top:20px;width:100%;flex:none}",
      ".cam{position:absolute;inset:0;will-change:transform}",
      ".camin{position:absolute}",
      `.stnote{font-size:40px;line-height:1.55;color:${theme.muted};margin-top:28px;max-width:1600px}`,
      ambient(sid, `-lay${last}`, BREATHE),
    ].join("\n"),
  };
}

