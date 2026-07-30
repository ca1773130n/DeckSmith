/**
 * Arm VOCAB's build path: a composition of objects, transforms and a camera in,
 * a hyperframes deck directory out.
 *
 * WHY THIS FILE EXISTS. `VOCABULARY-REVIEW` §4: six investigations, 26 Codex runs
 * and zero decks. Arm MENU has a shipped build path (`node dist/cli.js build`);
 * arm VOCAB has none, and a plan nobody built is not data. So one is written, on
 * the pattern already proved in `experiments/014-seam-b/emit.mjs` — a standalone
 * composition the real tools can be pointed at.
 *
 * ==================== THE ONE RULE THIS FILE OBEYS ====================
 *
 * IT DOES NOT REPAIR ITS INPUT. It places every object at the fraction the plan
 * gave, at the `fontPx` the plan gave. It does not clamp a position into the
 * stage, does not shrink type to clear the 40px floor, does not re-flow a label
 * that will not fit, does not drop an object that overlaps another, and does not
 * reorder anything. That prohibition IS the experiment: arm MENU's archetypes
 * refit — `bar-compare` recomputes its bar width from its own wrapped label — and
 * seven of them throw rather than emit an illegible slide, and the whole question
 * is whether a planner can do that arithmetic itself. An emitter that quietly
 * fixed things would be `scripts/score.mjs`'s "harness that repairs its inputs
 * and then reports how well they did", one layer down.
 *
 * The three places it is allowed to REFUSE, each mirroring a shipped refusal:
 *   - a tween whose `target` names no object     (arm MENU: assertRefsResolve throws)
 *   - `highlight` whose `part` is not a verbatim substring of the target's tex,
 *     or which targets something that is not a tex object
 *                                               (arm MENU: equation-walk.ts:144/228 throws)
 *   - a hold inside the camera's move window     (arm MENU: assertStopsOutsideMove throws)
 * A refusal is reported as a build failure against that plan, which is what
 * `decksmith build` does with the same class of defect. It is never a repair.
 *
 * ==================== WHAT IT MUST GET RIGHT ====================
 *
 * Invariant 1  — SEEK, NOT PLAY. The timeline is `paused: true` and only seeked.
 * Invariant 2  — every tween is `fromTo()`. There is no `from()` in this file.
 * Invariant 3  — every selector is a globally unique element id, `#<sid>-<objid>`,
 *                so nothing can reach into another scene.
 * Invariant 4  — no Date.now, no Math.random, no network in the emitted page.
 * Invariant 5  — the 40px floor is NOT enforced here. It is the plan's job and it
 *                is what the gate measures. See "does not repair" above.
 * Invariant 10 — every time rounded to 3 decimals, once, by `t()`/`r3()`.
 * Invariant 11 — NO CALLBACKS. Not one `onUpdate`, `onStart` or `onComplete`.
 *                Everything visible is a tweened property of the thing being
 *                seeked. `countTo` tweens `textContent` with a `snap`, directly on
 *                the target, which is what `bar-compare` already ships — a Manim
 *                ValueTracker implemented seek-safely.
 * VOCABULARY §2.5 — at most one `fromTo` per (element, property) may render
 *                immediately, so every tween after the first touching a given
 *                (element, property) carries `immediateRender: false`. Without it
 *                a cold seek to a time before the second tween finds a state GSAP
 *                has never had to render, and the scene opens with its glyph
 *                parked mid-arc. Invisible to anyone who scrubs, fatal to anyone
 *                who captures.
 *
 * Geometry needs NO browser measurement, which is the one real gift of a
 * fraction-based algebra: an object's centre is `at.x * 1920`, so a stroke length
 * and the camera's landing transform are both arithmetic at emit time. No
 * `dsFrame`, no lazy memo, and therefore none of the twelfth case — `hyperframes
 * render` shards frames contiguously, so anything measured lazily measures under
 * different conditions in every worker.
 *
 * ==================== THE THREE-LEVEL OBJECT ====================
 *
 *   .o    the ANCHOR. Zero-size point at the object's declared centre. Carries
 *         `left`/`top` in px and the object's `opacity`. GSAP owns its transform:
 *         `moveTo` tweens x/y here, and children nested by `parent` ride along.
 *   .ctr  the CENTRING wrapper. `translate(-50%,-50%)`, CSS only, GSAP NEVER
 *         touches it. This level exists because GSAP's CSSPlugin takes ownership
 *         of an element's whole transform the first time it tweens any transform
 *         property on it — so `scaleTo` on an element that was centred by its own
 *         CSS transform would have re-decomposed and then fought that centring.
 *         One level of indirection lets "centred on a point" and "scaled" coexist.
 *   .ink  the drawn thing. GSAP owns `scale`, `color`, `textContent`, `clipPath`,
 *         `transformOrigin`. Its box is what `growFrom` and `scaleTo` scale.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const W = 1920;
const H = 1080;

/** Invariant 10. Rounded exactly once so two roundings never move a byte. */
const r3 = (n) => Math.round(n * 1000) / 1000;
const t = (n) => String(r3(n));

/** GSAP ease names for the four the vocabulary offers. */
const EASE = { linear: "none", out: "power2.out", inOut: "power2.inOut", back: "back.out(1.6)" };

/** `Dive.fade` and `HANDOFF_SECONDS` from src/emit/camera.ts, so seams behave as shipped. */
const CAM_FADE = 0.35;
const HANDOFF = 0.4;

/** Kinds whose geometry is `points` in absolute stage coordinates, not `at` + `size`. */
const WIRE = new Set(["arrow", "polyline"]);

export class PlanError extends Error {}

/* ------------------------------------------------------------------ palette */

/** The `ink` theme's own numbers, read from the shipped theme rather than retyped,
 *  so the contrast pass grades both arms against one palette. */
function palette(bits) {
  return bits.resolveTheme("ink");
}

const colourOf = (pal, tone) =>
  tone === "muted" ? pal.muted : tone ? (pal.tones[tone] ?? pal.fg) : pal.fg;

/* ----------------------------------------------------------------- geometry */

const px = (frac, span) => r3(frac * span);

/**
 * Stroke length in stage px, exact and computed here.
 *
 * `draw` needs a `strokeDasharray`; the alternative is reading `getTotalLength()`
 * on the tween's first render, which is the lazy measurement that costs 201 of
 * 594 frames when the worker count changes.
 */
function strokeLength(o) {
  if (!WIRE.has(o.kind)) {
    const w = px(o.size?.w ?? 0, W);
    const h = px(o.size?.h ?? 0, H);
    return o.kind === "ellipse" ? r3((Math.PI * (w + h)) / 2) : r3(2 * (w + h));
  }
  const pts = (o.points ?? []).map((p) => [px(p.x, W), px(p.y, H)]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return r3(len) || 1;
}

/* ------------------------------------------------------------------- markup */

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const aid = (sid, id) => `${sid}-${id}`;
const iid = (sid, id) => `${sid}-${id}-i`;

/**
 * `at` IS ABSOLUTE, AT EVERY DEPTH, and `base` is what makes that true.
 *
 * A child nested in a group's anchor inherits that anchor's offset, so writing the
 * child's own `at` into its `left/top` would place it at the SUM of the two. Found
 * by opening the artifact: `vocab-20` parented four stage boxes to four groups at
 * the same coordinates, and the boxes landed at (0.34, 0.94) — half off the bottom
 * of the frame, under the note. The plan was right and this function was wrong: the
 * prompt says positions are "FRACTIONS of it [the stage]" and says nothing about a
 * parent re-basing them, so the emitter has to subtract the inherited offset. Not a
 * repair of the plan — a repair of this file against the specification the model
 * was handed.
 */
function objectHtml(sid, o, children, pal, figures, texSplit, base = { x: 0, y: 0 }) {
  // A wire's anchor sits at the stage origin: its points are already absolute, so
  // an anchor offset to `at` would move the whole path by it. `at` is unused for
  // arrow and polyline, which the prompt states.
  const wire = WIRE.has(o.kind);
  const left = r3((wire ? 0 : px(o.at?.x ?? 0, W)) - base.x);
  const top = r3((wire ? 0 : px(o.at?.y ?? 0, H)) - base.y);
  const op = o.opacity === undefined ? 1 : o.opacity;
  const ink = inkHtml(sid, o, pal, figures, texSplit);
  const body = ink && !wire ? `<div class="ctr">${ink}</div>` : ink;
  const kids = children.length ? `\n${children.join("\n")}` : "";
  return `          <div class="o" id="${aid(sid, o.id)}" style="left:${left}px;top:${top}px;opacity:${op}">${body}${kids}</div>`;
}

function inkHtml(sid, o, pal, figures, texSplit) {
  const id = iid(sid, o.id);
  const colour = colourOf(pal, o.tone);
  const w = o.size?.w === undefined ? null : px(o.size.w, W);
  const h = o.size?.h === undefined ? null : px(o.size.h, H);
  const size = o.fontPx === undefined ? "" : `font-size:${r3(o.fontPx)}px;`;

  switch (o.kind) {
    // A group draws nothing. Its children are nested inside its anchor, so a
    // transform on the anchor already moves all of them.
    case "group":
      return "";

    case "text": {
      const box = w === null ? "white-space:pre;" : `width:${w}px;`;
      return `<div class="ink tx" id="${id}" style="${size}${box}color:${colour}">${esc(o.text ?? "")}</div>`;
    }

    case "tex": {
      // ONE element, ONE KaTeX render, whatever the highlights.
      //
      // The highlighted parts are wrapped in `\htmlClass{...}` inside the TeX
      // source (`texSplit`), which is the mechanism `equation-walk.ts:149` already
      // ships, so KaTeX emits a real element for the part INSIDE one layout.
      // MEASURED, on the control: rendering the pieces as three sibling KaTeX
      // roots instead produced three `layout content_overlap` errors on
      // `\mathcal{E}(\mathbf{I}_{\mathrm{LR}})` — the adjacent roots' boxes
      // collide. One root, no collision, and the control goes clean.
      const tex = texSplit.get(o.id) ?? o.tex ?? "";
      return `<div class="ink tex" id="${id}" style="${size}color:${colour}">${esc(tex)}</div>`;
    }

    case "rect":
    case "ellipse": {
      const fill = o.fill === "tone" ? colour : o.fill === "surface" ? pal.panel : "none";
      const round = o.kind === "ellipse" ? "border-radius:50%;" : "border-radius:14px;";
      return `<div class="ink shape" id="${id}" style="width:${w ?? 0}px;height:${h ?? 0}px;${round}background:${fill};border:3px solid ${colour}"></div>`;
    }

    case "image": {
      const fig = figures.get(o.figureId);
      // A figureId the source does not contain must not become a silently blank
      // slide: emit the src the plan named so the runtime pass reports the 404.
      const src = fig ? `assets/${fig.src}` : `assets/${String(o.figureId)}`;
      return `<img class="ink fig" id="${id}" src="${esc(src)}" alt="" style="width:${w ?? 0}px;${h === null ? "" : `height:${h}px;`}" />`;
    }

    case "arrow":
    case "polyline": {
      const pts = (o.points ?? []).map((p) => `${px(p.x, W)},${px(p.y, H)}`);
      const d = pts.length ? `M${pts.join(" L")}` : "";
      const len = strokeLength(o);
      const head = o.kind === "arrow" ? arrowHead(o, colour) : "";
      return `<svg class="ink wire" id="${id}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${colour}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${len}" stroke-dashoffset="0" />${head}</svg>`;
    }

    default:
      return "";
  }
}

/** A solid head on the last point, aimed along the last segment. */
function arrowHead(o, colour) {
  const pts = (o.points ?? []).map((p) => [px(p.x, W), px(p.y, H)]);
  if (pts.length < 2) return "";
  const [x2, y2] = pts[pts.length - 1];
  const [x1, y1] = pts[pts.length - 2];
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = (dx, dy) =>
    `${r3(x2 + dx * Math.cos(a) - dy * Math.sin(a))},${r3(y2 + dx * Math.sin(a) + dy * Math.cos(a))}`;
  return `<polygon points="${p(0, 0)} ${p(-26, -14)} ${p(-26, 14)}" fill="${colour}" />`;
}

/* ------------------------------------------------------------- tex splitting */

/**
 * Every `highlight` on one tex object, resolved into ONE split of its source.
 *
 * Done in a pre-pass rather than per anim because two highlights on one equation
 * would otherwise each rewrite the element's children and the second would delete
 * the first's target — a tween pointing at nothing, which GSAP performs silently
 * and no gate can see. This is the same class of failure as invariant 11 and it is
 * the emitter's to get right.
 *
 * Throws on a part that is not a verbatim substring, and on a highlight aimed at
 * something that is not a tex object, because that is what `equation-walk.ts`
 * does at lines 144 and 228 and because "renders nothing, complains about
 * nothing" is the defect class VOCABULARY.md §1 names as the algebra's own.
 */
function planTexSplits(sid, scene, byId) {
  const wanted = new Map();
  for (const a of scene.anims ?? []) {
    if (a.op !== "highlight") continue;
    const o = byId.get(a.target);
    if (!o) {
      throw new PlanError(`highlight targets "${a.target}", which is not an object in ${sid}`);
    }
    if (o.kind !== "tex") {
      // DS15_PERMISSIVE is the SENSITIVITY ARM and is never on for the reported
      // number. It makes this op do what VOCABULARY.md §1 says the defect looks
      // like — "renders nothing, complains about nothing" — so the cost of
      // counting it can be measured instead of argued. See README §5.
      if (process.env.DS15_PERMISSIVE) continue;
      throw new PlanError(
        `highlight targets "${a.target}", which is a ${o.kind} and not a tex object`,
      );
    }
    const part = a.part ?? "";
    const i = (o.tex ?? "").indexOf(part);
    if (!part || i < 0) {
      throw new PlanError(
        `highlight part ${JSON.stringify(part)} is not a verbatim substring of ${a.target}'s tex`,
      );
    }
    const list = wanted.get(o.id) ?? [];
    list.push({ start: i, end: i + part.length });
    wanted.set(o.id, list);
  }

  const splits = new Map();
  const keys = new Map();
  for (const [id, ranges] of wanted) {
    const tex = byId.get(id).tex ?? "";
    // Outermost first, so a containing range is seen before what it contains.
    const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
    const kept = [];
    for (const r of sorted) {
      if (kept.some((k) => k.start === r.start && k.end === r.end)) continue;
      kept.push(r);
    }
    // NESTING IS LEGAL AND CROSSING IS NOT.
    //
    // `\htmlClass{a}{x \htmlClass{b}{y} z}` is valid KaTeX, and "light the
    // encoder, then light its argument" is a thing a walk-the-equation beat
    // genuinely wants — 4 of 20 arm-VOCAB runs asked for exactly that, and an
    // earlier version of this function threw on all four. That refusal was a
    // limitation of a right-to-left splice, not of the vocabulary, and counting it
    // as a plan defect would have inflated the headline by 20 points. A PARTIAL
    // overlap is different: it cannot be expressed as nested markup at all, and
    // wrapping it anyway highlights the wrong extent — the failure
    // `equation-walk.ts:118` warns about. That one is still refused.
    for (const a of kept) {
      for (const b of kept) {
        if (a === b) continue;
        const crosses = a.start < b.start && b.start < a.end && a.end < b.end;
        if (crosses) {
          throw new PlanError(
            `highlight parts partially overlap inside ${id}'s tex (${a.start}-${a.end} and ${b.start}-${b.end}); ` +
              `nest them or cut them apart`,
          );
        }
      }
    }
    for (const [n, r] of kept.entries()) keys.set(`${id}|${r.start}|${r.end}`, `${iid(sid, id)}-h${n}`);

    // Render the interval [lo, hi), wrapping each range that is top-level within
    // it and recursing into what that range contains.
    const wrap = (lo, hi, pool) => {
      const tops = pool.filter((r) => !pool.some((o) => o !== r && o.start <= r.start && r.end <= o.end));
      let out = "";
      let cursor = lo;
      for (const r of tops.sort((a, b) => a.start - b.start)) {
        out += tex.slice(cursor, r.start);
        const inside = pool.filter((o) => o !== r && r.start <= o.start && o.end <= r.end);
        const cls = keys.get(`${id}|${r.start}|${r.end}`);
        out += `\\htmlClass{${cls}}{${wrap(r.start, r.end, inside)}}`;
        cursor = r.end;
      }
      return out + tex.slice(cursor, hi);
    };
    splits.set(id, wrap(0, tex.length, kept));
  }
  return { splits, keys };
}

/* ----------------------------------------------------------------- timeline */

/**
 * A tween, as GSAP source text — the one place in this file where a tween becomes
 * text, mirroring `tweenText` in src/emit/kit.ts.
 *
 * `seen` carries the (element, property) pairs an earlier tween already touched,
 * so a second one gets `immediateRender: false` (VOCABULARY §2.5). Not a repair of
 * the plan: the plan asked for two tweens and gets two. It is `fromTo`
 * construction, which is the emitter's job.
 */
function stmt(seen, target, from, to, dur, ease, at) {
  const props = Object.keys(to);
  const repeat = props.some((k) => seen.has(`${target}|${k}`));
  for (const k of props) seen.add(`${target}|${k}`);
  const vars = { ...to, duration: r3(dur), ease };
  if (repeat) vars.immediateRender = false;
  return `tl.fromTo("${target}", ${varsText(from)}, ${varsText(vars)}, ${t(at)});`;
}

function varsText(v) {
  const parts = Object.entries(v).map(([k, val]) => `${k}: ${valText(val)}`);
  return parts.length ? `{ ${parts.join(", ")} }` : "{}";
}
function valText(v) {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  return varsText(v);
}

const ORIGIN = {
  left: "0% 50%",
  right: "100% 50%",
  top: "50% 0%",
  bottom: "50% 100%",
  centre: "50% 50%",
};

function animStatements(sid, a, byId, pal, seen, setup, texKeys) {
  const o = byId.get(a.target);
  if (!o) throw new PlanError(`anim targets "${a.target}", which is not an object in ${sid}`);
  const anchor = `#${aid(sid, a.target)}`;
  const ink = `#${iid(sid, a.target)}`;
  const ease = EASE[a.ease] ?? "power2.out";
  const at = a.start;
  const d = a.dur;
  const out = [];

  switch (a.op) {
    case "fadeIn":
      out.push(stmt(seen, anchor, { opacity: 0 }, { opacity: 1 }, d, ease, at));
      break;

    case "fadeOut":
      out.push(stmt(seen, anchor, { opacity: 1 }, { opacity: 0 }, d, ease, at));
      break;

    case "draw": {
      if (WIRE.has(o.kind)) {
        const len = strokeLength(o);
        out.push(
          stmt(seen, `${ink} path`, { strokeDashoffset: len }, { strokeDashoffset: 0 }, d, ease, at),
        );
      } else {
        // A box has no dash to offset. The honest reading of "draw this rect" is a
        // left-to-right reveal of the whole box; nothing is invented beyond that.
        out.push(
          stmt(
            seen,
            ink,
            { clipPath: "inset(0% 100% 0% 0%)" },
            { clipPath: "inset(0% 0% 0% 0%)" },
            d,
            ease,
            at,
          ),
        );
      }
      break;
    }

    case "growFrom": {
      const anch = a.anchor ?? "centre";
      const axis = anch === "top" || anch === "bottom" ? "scaleY" : "scaleX";
      setup.push(
        `document.getElementById(${JSON.stringify(iid(sid, a.target))}).style.transformOrigin = ${JSON.stringify(ORIGIN[anch] ?? ORIGIN.centre)}`,
      );
      out.push(stmt(seen, ink, { [axis]: 0 }, { [axis]: 1 }, d, ease, at));
      break;
    }

    case "moveTo": {
      const dx = r3(px(a.toPos?.x ?? o.at.x, W) - px(o.at.x, W));
      const dy = r3(px(a.toPos?.y ?? o.at.y, H) - px(o.at.y, H));
      out.push(stmt(seen, anchor, { x: 0, y: 0 }, { x: dx, y: dy }, d, ease, at));
      break;
    }

    case "scaleTo":
      out.push(stmt(seen, ink, { scale: 1 }, { scale: r3(a.to ?? 1) }, d, ease, at));
      break;

    case "recolor": {
      const to = colourOf(pal, a.toTone);
      const from = colourOf(pal, o.tone);
      if (WIRE.has(o.kind)) {
        out.push(stmt(seen, `${ink} path`, { stroke: from }, { stroke: to }, d, ease, at));
      } else if (o.kind === "rect" || o.kind === "ellipse") {
        out.push(stmt(seen, ink, { borderColor: from }, { borderColor: to }, d, ease, at));
      } else {
        out.push(stmt(seen, ink, { color: from }, { color: to }, d, ease, at));
      }
      break;
    }

    case "highlight": {
      // `planTexSplits` already validated the part and emitted the span; this is
      // only the tween that lights it.
      const i = (o.tex ?? "").indexOf(a.part ?? "");
      const key = texKeys.get(`${o.id}|${i}|${i + (a.part ?? "").length}`);
      if (!key) {
        if (process.env.DS15_PERMISSIVE) break; // sensitivity arm: silently nothing
        throw new PlanError(`highlight on ${o.id} did not resolve to a span`);
      }
      // A CLASS selector, scoped by the scene id it is built from, so invariant 3
      // holds: `s2-eq-i-h0` cannot exist in another scene.
      // COLOUR ONLY, and the scale that used to be here is gone for a measured
      // reason: a 1.1 scale on an inline KaTeX span grows its children's boxes into
      // their neighbours' and the layout pass reports three `content_overlap`
      // errors on the control. Emphasis that breaks the equation it emphasises is
      // not emphasis.
      out.push(
        stmt(seen, `.${key}`, { color: colourOf(pal, o.tone) }, { color: pal.tones.b }, d, ease, at),
      );
      break;
    }

    case "countTo": {
      // A ValueTracker done seek-safely: the number is a TWEENED PROPERTY of the
      // element, snapped, never written from an onUpdate. Invariant 11.
      const from = a.from ?? 0;
      const to = a.to ?? 0;
      const step = Number.isInteger(from) && Number.isInteger(to) ? 1 : 0.001;
      out.push(
        stmt(
          seen,
          ink,
          { textContent: r3(from) },
          { textContent: r3(to), snap: { textContent: step } },
          d,
          ease,
          at,
        ),
      );
      break;
    }

    case "morphInto": {
      const dst = byId.get(a.toObject);
      if (!dst) {
        throw new PlanError(`morphInto names "${a.toObject}", which is not an object in ${sid}`);
      }
      // The part-level box morph: carry this object's box onto the other's and
      // cross-fade. Four floats per object, which is what VOCABULARY §2.1 costs it
      // at, rather than the 120.6 KB of Bezier coordinates outline morphing costs.
      const dx = r3(px(dst.at.x, W) - px(o.at.x, W));
      const dy = r3(px(dst.at.y, H) - px(o.at.y, H));
      const k = o.size?.w && dst.size?.w ? r3(dst.size.w / o.size.w) : 1;
      out.push(stmt(seen, anchor, { x: 0, y: 0 }, { x: dx, y: dy }, d, ease, at));
      out.push(stmt(seen, ink, { scale: 1 }, { scale: k }, d, ease, at));
      out.push(stmt(seen, anchor, { opacity: o.opacity ?? 1 }, { opacity: 0 }, d, ease, at));
      out.push(stmt(seen, `#${aid(sid, dst.id)}`, { opacity: 0 }, { opacity: 1 }, d, ease, at));
      break;
    }

    default:
      throw new PlanError(`unknown op "${a.op}"`);
  }
  return out;
}

/* ------------------------------------------------------------------- camera */

/**
 * The dive, as pure arithmetic on the target's declared centre.
 *
 * Neutral framing is the IDENTITY transform — scale about the frame's centre, then
 * translate the plate by (centre − target) — so both tweens start at 1/0, the
 * values an element has before an `immediateRender: false` fromTo has ever run.
 * Same construction as `src/emit/camera.ts:diveStatements`, and for the same
 * reason: a rig whose rest state needed setting would show the wrong framing for
 * every frame before the move.
 *
 * The scene then DIPS OUT and ends, which is the shipped shape. PREREGISTERED §3
 * and vocab.mjs:cameraSchema say why: an arm-VOCAB camera that landed and then
 * held would fail `canvas_overflow` at that hold for a reason arm MENU's `inside`
 * structurally avoids, and the metric would be measuring my camera semantics.
 */
function cameraStatements(sid, cam, byId, seen) {
  const target = byId.get(cam.on);
  if (!target) throw new PlanError(`camera.on "${cam.on}" is not an object in ${sid}`);
  const k = r3(cam.k);
  const dx = r3((W / 2 - px(target.at.x, W)) * k);
  const dy = r3((H / 2 - px(target.at.y, H)) * k);
  return [
    stmt(seen, `#${sid} .ds-zoom`, { scale: 1 }, { scale: k }, cam.dur, "power2.inOut", cam.t0),
    stmt(seen, `#${sid} .ds-pan`, { x: 0, y: 0 }, { x: dx, y: dy }, cam.dur, "power2.inOut", cam.t0),
    stmt(seen, `#${sid}`, { opacity: 1 }, { opacity: 0 }, CAM_FADE, "power2.in", r3(cam.t0 + cam.dur)),
  ];
}

/* -------------------------------------------------------------------- scene */

function sceneBlock(scene, sid, start, pal, figures) {
  const objects = scene.objects ?? [];
  const byId = new Map(objects.map((o) => [o.id, o]));
  const seen = new Set();
  const setup = [];
  const { splits, keys } = planTexSplits(sid, scene, byId);

  // Nest by `parent`, in the plan's own order. A `parent` naming no object leaves
  // the child at the top level and the orphan is REPORTED, never reparented.
  const orphans = [];
  const childrenOf = new Map();
  for (const o of objects) {
    if (o.parent === undefined) continue;
    if (!byId.has(o.parent)) orphans.push(o.id);
    else childrenOf.set(o.parent, [...(childrenOf.get(o.parent) ?? []), o.id]);
  }
  const seenIds = new Set();
  const render = (o, base) => {
    if (seenIds.has(o.id)) return ""; // a parent cycle draws once, not forever
    seenIds.add(o.id);
    // What this object's own anchor contributes to its children's inherited offset.
    const mine = WIRE.has(o.kind)
      ? base
      : { x: px(o.at?.x ?? 0, W), y: px(o.at?.y ?? 0, H) };
    const kids = (childrenOf.get(o.id) ?? [])
      .map((cid) => render(byId.get(cid), mine))
      .filter(Boolean);
    return objectHtml(sid, o, kids, pal, figures, splits, base);
  };
  const inner = objects
    .filter((o) => o.parent === undefined || !byId.has(o.parent))
    .map((o) => render(o, { x: 0, y: 0 }))
    .filter(Boolean)
    .join("\n");

  const tl = [];
  for (const a of scene.anims ?? []) {
    tl.push(...animStatements(sid, a, byId, pal, seen, setup, keys));
  }

  const cam = scene.camera;
  let transit;
  if (cam) {
    // The emitter's half of the guarantee `assertStopsOutsideMove` gives arm MENU.
    for (const h of scene.holds ?? []) {
      if (h > cam.t0 && h < cam.t0 + cam.dur) {
        throw new PlanError(
          `hold at ${h}s is inside the camera move [${cam.t0}, ${r3(cam.t0 + cam.dur)}] in ${sid}`,
        );
      }
    }
    tl.push(...cameraStatements(sid, cam, byId, seen));
    transit = `${t(start + cam.t0)},${t(start + cam.t0 + cam.dur + CAM_FADE)}`;
  }

  const plate = cam
    ? `        <div class="ds-zoom"><div class="ds-pan"><div class="plate">\n${inner}\n        </div></div></div>`
    : `        <div class="plate">\n${inner}\n        </div>`;

  // Two KaTeX setups, and only ever one per element: `.tex:not(.split)` renders
  // its own text content, `.texpart` renders the pre-split fragment off its
  // data attribute. `throwOnError:false` so bad TeX leaves its source on screen
  // rather than blanking the slide — the shipped `mathSetup` rule.
  const math = [];
  if (inner.includes('class="ink tex"')) {
    // `trust` is a PREDICATE and not `true`, copied from equation-walk.ts:32: the
    // TeX comes out of a model, and `trust: true` would enable `\href` and
    // `\includegraphics` — a network fetch at render time, which is invariant 4.
    math.push(
      `Array.prototype.forEach.call(document.querySelectorAll("#${sid} .tex"), function (el) {` +
        ` try { katex.render(el.textContent, el, { displayMode: false, output: "html", strict: false,` +
        ` throwOnError: false, trust: function (c) { return c.command === "\\\\htmlClass"; } }); } catch (e) {} })`,
    );
  }

  const statements = [...math, ...setup].map((s) =>
    s.trim().endsWith(";") ? s.trim() : `${s.trim()};`,
  );

  // The CLIP, not the slide: a scene the camera leaves from ends on its dip, so it
  // gets no handoff overlap. Everything else overlaps the next scene by HANDOFF,
  // which is what the shipped shell does.
  const clip = r3((scene.seconds ?? 8) + (cam ? 0 : HANDOFF));

  return {
    html: `      <div
        id="${sid}"
        class="scene clip"
        data-composition-id="${sid}"
        data-start="${t(start)}"
        data-duration="${t(clip)}"${transit ? `\n        data-ds-transit="${transit}"` : ""}
        data-label="${esc(scene.intent ?? sid)}"
      >
${plate}
        <script>
          (function () {
            ${statements.join("\n            ")}
            window.__timelines = window.__timelines || {};
            var tl = gsap.timeline({ paused: true });
            ${tl.join("\n            ")}
            window.__timelines["${sid}"] = tl;
          })();
        </script>
      </div>`,
    orphans,
  };
}

/* --------------------------------------------------------------------- page */

function css(pal) {
  return `      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${pal.bg}; }
      body { font-family: ${pal.fontStack}; color: ${pal.fg}; font-weight: ${pal.bodyWeight ?? 400}; }
      .scene { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
      .ds-zoom, .ds-pan { position: absolute; inset: 0; transform-origin: 50% 50%; }
      .plate { position: absolute; inset: 0; }
      /* An object is a POINT (.o), its ink hangs off that point centred (.ctr), and
         the ink is what gets scaled (.ink). Three levels because GSAP takes over an
         element's whole transform the first time it tweens one property of it — so
         a centring transform on the same element as a scaleTo would fight it. */
      .o { position: absolute; width: 0; height: 0; }
      /* max-content, because .ctr is an absolutely positioned box inside a
         ZERO-WIDTH anchor, so shrink-to-fit gives it width 0 and everything
         inside wraps at every opportunity. MEASURED on the control: the carrier
         equation broke across three lines at fontPx 76 before this. */
      .ctr { position: absolute; left: 0; top: 0; width: max-content;
             transform: translate(-50%, -50%); }
      .ink { position: relative; }
      .tx { text-align: center; line-height: 1.15; }
      /* An equation is ONE line. If the plan sized it too big it leaves the canvas
         and the layout gate says so, which is the defect worth surfacing; wrapping
         it into a legible column would hide the plan's mistake. */
      .tex { line-height: 1.2; white-space: nowrap; }
      .wire { position: absolute; left: 0; top: 0; overflow: visible; }
      .fig { display: block; }`;
}

export function compose(plan, bits, figures) {
  const pal = palette(bits);
  const blocks = [];
  const orphans = [];
  let start = 0;
  const scenes = plan.scenes ?? [];
  scenes.forEach((scene, i) => {
    const sid = `s${i + 1}`;
    const b = sceneBlock(scene, sid, start, pal, figures);
    blocks.push(b.html);
    orphans.push(...b.orphans.map((o) => `${sid}:${o}`));
    start = r3(start + (scene.seconds ?? 8));
  });
  const total = r3(start);

  const html = `<!doctype html>
<html lang="${esc(plan.lang ?? "en")}" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <title>${esc(plan.title ?? "composition")}</title>
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="./vendor/gsap.min.js"></script>
    <link rel="stylesheet" href="./katex/katex.min.css" />
    <script src="./vendor/katex.min.js"></script>
    <style>
${css(pal)}
    </style>
  </head>
  <body>
    <script>window.__hfTimelinesBuilding = true;</script>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${t(total)}"
      data-width="${W}"
      data-height="${H}"
    >
${blocks.join("\n")}
      <script>
        (function () {
          window.__timelines = window.__timelines || {};
          var tl = gsap.timeline({ paused: true });
          tl.to({}, { duration: ${t(total)} });
          window.__timelines["main"] = tl;
        })();
      </script>
      <script>
        Promise.all(
          Array.prototype.map
            .call(document.images, function (img) {
              return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
            })
            .concat([document.fonts ? document.fonts.ready : Promise.resolve()]),
        ).then(function () {
          window.__hfTimelinesBuilding = false;
          window.dispatchEvent(new Event("hf-timelines-built"));
        });
      </script>
    </div>
  </body>
</html>
`;
  return { html, orphans, seconds: total, scenes: scenes.length };
}

/**
 * Everything a hyperframes project needs beside the composition, copied from the
 * built demo deck so the fonts, the KaTeX build and the GSAP build are the ones
 * the shipped decks use. A different KaTeX would make the contrast and layout
 * passes measure a different thing in each arm.
 */
function scaffold(outDir, assetsFrom) {
  const demo = join(REPO, "demo", "deck");
  cpSync(join(demo, "vendor"), join(outDir, "vendor"), { recursive: true });
  cpSync(join(demo, "katex"), join(outDir, "katex"), { recursive: true });
  cpSync(join(demo, "assets"), join(outDir, "assets"), { recursive: true });
  if (assetsFrom) cpSync(assetsFrom, join(outDir, "assets"), { recursive: true });
  writeFileSync(
    join(outDir, "hyperframes.json"),
    `${JSON.stringify(
      {
        $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
        paths: { assets: "assets" },
      },
      null,
      2,
    )}\n`,
  );
}

/** Plan in, deck directory out. Throws `PlanError` on a defect it refuses. */
export function build(plan, outDir, bits, opts = {}) {
  const figures = new Map((opts.source?.figures ?? []).map((f) => [f.id, f]));
  const out = compose(plan, bits, figures);
  mkdirSync(outDir, { recursive: true });
  scaffold(outDir, opts.assetsFrom);
  writeFileSync(join(outDir, "index.html"), out.html);
  return { dir: outDir, ...out };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [planPath, outDir] = process.argv.slice(2);
  const bits = await import("./out/bits.mjs");
  const source = JSON.parse(readFileSync(join(REPO, "demo", "source.json"), "utf8"));
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const res = build(plan, outDir, bits, { source });
  console.log(`built ${res.scenes} scene(s), ${res.seconds}s -> ${res.dir}`);
  if (res.orphans.length) console.log(`orphan parents: ${res.orphans.join(", ")}`);
}
