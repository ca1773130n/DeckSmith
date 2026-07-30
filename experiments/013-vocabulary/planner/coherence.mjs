/**
 * Coherence: the properties a schema cannot express.
 *
 * Two classes, kept apart on purpose.
 *
 *   SHARED  — defect shapes BOTH vocabularies can commit. Dangling source ref,
 *             narration sentence count against reveal count, over-long
 *             headline, duplicate ids, a number not in the source. These make
 *             the arms directly comparable.
 *   ALGEBRA — defect shapes only a compositional plan can commit, because in
 *             the archetype arm the emitter owns the property. Dangling
 *             internal ref, timing overrun, off-stage, invisible object,
 *             conflicting tween, op/kind mismatch, text below the floor.
 *
 * Collision is reported separately and flagged SOFT: it is measured on
 * bounding boxes, and a bounding box is not ink.
 */

import { emitScene, FORMATS, THEMES } from "./out/planbits.mjs";

const SENT = /[.!?](?:\s|$)/g;
export function sentenceCount(s) {
  if (!s || !s.trim()) return 0;
  return (s.trim().match(SENT) ?? []).length || 1;
}

function srcIds(source) {
  return {
    section: new Set(source.sections.map((s) => s.id)),
    figure: new Set(source.figures.map((f) => f.id)),
    equation: new Set(source.equations.map((e) => e.id)),
    table: new Set(source.tables.map((t) => t.id)),
  };
}

/** Every number that appears anywhere in the source, for fidelity checks. */
function sourceNumbers(source) {
  const text = JSON.stringify(source);
  const out = new Set();
  for (const m of text.matchAll(/-?\d+(?:\.\d+)?/g)) out.add(Number(m[0]));
  return out;
}

/* --------------------------------------------------------------- archetypes */

/**
 * How many reveals a beat has: the REAL number, taken from the emitter's own
 * `holds` array, not a formula.
 *
 * The formula I wrote first said "stages + 1" and friends, and the
 * hand-authored demo/storyboard.json — the gold — failed it ten times out of
 * twelve beats. A check the gold fails is measuring the wrong thing. The
 * emitter groups reveals (five bars are two holds, not six), so the emitter is
 * the only authority on the count.
 */
function revealsOf(beat, source) {
  const ctx = { source, format: FORMATS["deck-16x9"], theme: THEMES.ink, sid: "s1" };
  return emitScene(beat, ctx).holds.length;
}

export function checkArchetype(sb, source) {
  const known = srcIds(source);
  const nums = sourceNumbers(source);
  const shared = [];
  const emitFail = [];
  const seen = new Set();

  if (sb.sourceId !== source.id) shared.push(`sourceId "${sb.sourceId}" is not "${source.id}"`);

  sb.beats.forEach((b, i) => {
    const at = `beat[${i}] ${b.id}`;
    if (seen.has(b.id)) shared.push(`${at}: duplicate beat id`);
    seen.add(b.id);

    for (const ref of b.evidence ?? [])
      if (!known[ref.kind]?.has(ref.id)) shared.push(`${at}: evidence ${ref.kind} "${ref.id}" absent`);

    const p = b.params;
    const cite = (kind, id, where) => {
      if (id && !known[kind].has(id)) shared.push(`${at}: ${where} "${id}" is no ${kind}`);
    };
    if (b.archetype === "claim-figure" || b.archetype === "annotated-figure")
      cite("figure", p.figureId, "figureId");
    if (b.archetype === "equation-walk") cite("equation", p.equationId, "equationId");
    if (b.archetype === "data-table") cite("table", p.tableId, "tableId");
    if (b.archetype === "split-compare") {
      cite("figure", p.left.figureId, "left.figureId");
      cite("figure", p.right.figureId, "right.figureId");
    }

    if (p.headline && p.headline.length > 60)
      shared.push(`${at}: headline ${p.headline.length} chars > 60`);
    if (b.claim && b.claim.length > 140) shared.push(`${at}: claim ${b.claim.length} chars > 140`);

    // Does the beat even emit? The emitters are layout solvers that refuse a
    // beat they cannot lay out at the 40px floor. A throw here is a LOUD
    // failure — a build error, not a wrong render — and is counted apart.
    let want = null;
    try {
      want = revealsOf(b, source);
    } catch (e) {
      emitFail.push(`${at}: ${String(e.message).slice(0, 120)}`);
    }
    if (want !== null) {
      const got = sentenceCount(b.narration);
      if (got !== want) shared.push(`${at}: narration ${got} sentences, ${want} holds`);
    }

    // equation-walk: each term's tex must occur verbatim in the equation.
    if (b.archetype === "equation-walk") {
      const eq = source.equations.find((e) => e.id === p.equationId);
      if (eq) for (const t of p.terms)
        if (!eq.tex.includes(t.tex)) shared.push(`${at}: term "${t.tex}" not in equation tex`);
    }
    // bar-compare: every value must exist in the source. (Not applied to
    // line-chart: the gold reads its points off a figure, so a number absent
    // from the text is legitimate there.)
    if (b.archetype === "bar-compare")
      for (const bar of p.bars)
        if (!nums.has(bar.value)) shared.push(`${at}: bar value ${bar.value} not in source`);

    if (b.inside) {
      const prev = sb.beats[i - 1];
      if (!prev || prev.id !== b.inside.beat)
        shared.push(`${at}: inside.beat "${b.inside.beat}" is not the immediately preceding beat`);
      else {
        const m = /^(stage|rgn|lay)(\d+)$/.exec(b.inside.element);
        const n = m
          ? prev.archetype === "pipeline"
            ? prev.params.stages.length
            : prev.archetype === "grid"
              ? prev.params.regions.length
              : prev.archetype === "stack"
                ? prev.params.layers.length
                : -1
          : -1;
        if (!m || n < 0 || Number(m[2]) >= n)
          shared.push(`${at}: inside.element "${b.inside.element}" is not a part of ${prev.archetype}`);
      }
    }
  });

  return { shared, algebra: [], soft: [], emitFail };
}

/* ------------------------------------------------------------- compositional */

const STROKEABLE = new Set(["arrow", "polyline", "rect", "ellipse"]);
const GROWABLE = new Set(["rect", "ellipse"]);

/**
 * Mean advance width per character, in ems, for the deck's own sans stack.
 * MEASURED, not guessed — measure-advance.mjs renders the actual strings this
 * experiment produced, in the theme's real font (Inter), in Chromium, and
 * divides. Over 23 strings: mean 0.571, median 0.560, and 0.485-0.510 for the
 * headline-length strings that are the ones at risk of overflowing. 0.50 is
 * used here, at the conservative end, so a flagged overflow is real to within
 * about 3% rather than an artefact of the constant.
 *
 * Using the model's declared `size` instead would have been the "bounding box
 * is not ink" mistake in reverse: the model declares a box its own text does
 * not fit in, and the pilot did exactly that — a 74px headline it sized at
 * 0.84 of the stage measures 1997px on a 1920px stage.
 */
export const EM_PER_CHAR = 0.5;

function boxOf(o) {
  if (o.kind === "group") return null;
  // Text is measured from its glyphs. A declared `size` on a text object is the
  // model's guess at its own metrics and is exactly what we are testing.
  if (o.kind === "text" && o.text) {
    const px = o.fontPx ?? 48;
    return {
      x: o.at.x,
      y: o.at.y,
      w: (o.text.length * px * EM_PER_CHAR) / 1920,
      h: (px * 1.35) / 1080,
    };
  }
  if (o.size) return { x: o.at.x, y: o.at.y, w: o.size.w, h: o.size.h };
  return null;
}

function overlapFrac(a, b) {
  const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const oy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  if (ox <= 0 || oy <= 0) return 0;
  return (ox * oy) / Math.min(a.w * a.h, b.w * b.h);
}

/** Windows over which each op writes a property, for conflict detection. */
const WRITES = {
  fadeIn: "opacity",
  fadeOut: "opacity",
  draw: "stroke",
  growFrom: "scale",
  scaleTo: "scale",
  moveTo: "pos",
  recolor: "tone",
  highlight: "emph",
  countTo: "text",
  morphInto: "shape",
};

export function checkComposition(comp, source) {
  const known = srcIds(source);
  const nums = sourceNumbers(source);
  const shared = [];
  const algebra = [];
  const soft = [];
  const seenScene = new Set();

  if (comp.sourceId !== source.id) shared.push(`sourceId "${comp.sourceId}" is not "${source.id}"`);

  comp.scenes.forEach((sc, i) => {
    const at = `scene[${i}] ${sc.id}`;
    if (seenScene.has(sc.id)) shared.push(`${at}: duplicate scene id`);
    seenScene.add(sc.id);

    for (const ref of sc.evidence ?? [])
      if (!known[ref.kind]?.has(ref.id)) shared.push(`${at}: evidence ${ref.kind} "${ref.id}" absent`);

    const byId = new Map();
    for (const o of sc.objects) {
      if (byId.has(o.id)) algebra.push(`${at}: duplicate object id "${o.id}"`);
      byId.set(o.id, o);
    }

    for (const o of sc.objects) {
      const where = `${at} obj ${o.id}`;
      if (o.parent && !byId.has(o.parent)) algebra.push(`${where}: parent "${o.parent}" absent`);
      if (o.parent && byId.get(o.parent)?.kind !== "group")
        algebra.push(`${where}: parent "${o.parent}" is not a group`);
      if (o.kind === "image") {
        if (!o.figureId) algebra.push(`${where}: image with no figureId`);
        else if (!known.figure.has(o.figureId)) shared.push(`${where}: figureId "${o.figureId}" absent`);
      }
      if (o.kind === "text" && !o.text) algebra.push(`${where}: text object with no text`);
      if (o.kind === "tex" && !o.tex) algebra.push(`${where}: tex object with no tex`);
      if ((o.kind === "arrow" || o.kind === "polyline") && (o.points?.length ?? 0) < 2)
        algebra.push(`${where}: ${o.kind} with fewer than 2 points`);
      if ((o.kind === "rect" || o.kind === "ellipse" || o.kind === "image") && !o.size)
        algebra.push(`${where}: ${o.kind} with no size`);
      if (o.kind === "text" && o.text && (o.fontPx ?? 0) < 40)
        algebra.push(`${where}: fontPx ${o.fontPx ?? "unset"} below the 40px floor`);
      // The model declared a box for text it cannot measure.
      if (o.kind === "text" && o.text && o.size) {
        const real = (o.text.length * (o.fontPx ?? 48) * EM_PER_CHAR) / 1920;
        if (real > o.size.w * 1.25)
          algebra.push(
            `${where}: declared w ${o.size.w} but the text renders ${real.toFixed(2)} wide`,
          );
      }

      const pts = o.points ?? [];
      for (const p of pts)
        if (p.x < -0.02 || p.x > 1.02 || p.y < -0.02 || p.y > 1.02)
          algebra.push(`${where}: point (${p.x}, ${p.y}) off stage`);
      const b = boxOf(o);
      if (b) {
        if (
          b.x - b.w / 2 < -0.02 ||
          b.x + b.w / 2 > 1.02 ||
          b.y - b.h / 2 < -0.02 ||
          b.y + b.h / 2 > 1.02
        )
          algebra.push(`${where}: box extends off stage`);
      } else if (o.kind !== "group" && !pts.length) {
        if (o.at.x < 0 || o.at.x > 1 || o.at.y < 0 || o.at.y > 1)
          algebra.push(`${where}: centre off stage`);
      }
    }

    // collisions — SOFT, bounding boxes not ink
    const boxes = sc.objects
      .filter((o) => o.kind === "text" || o.kind === "rect" || o.kind === "image")
      .map((o) => [o, boxOf(o)])
      .filter(([, b]) => b);
    for (let a = 0; a < boxes.length; a++)
      for (let c = a + 1; c < boxes.length; c++) {
        const f = overlapFrac(boxes[a][1], boxes[c][1]);
        // a label inside its own box is legitimate; only flag same-kind pairs
        // and >60% coverage.
        if (f > 0.6 && boxes[a][0].kind === boxes[c][0].kind)
          soft.push(`${at}: "${boxes[a][0].id}" and "${boxes[c][0].id}" overlap ${Math.round(f * 100)}%`);
      }

    // tweens
    const touched = new Set();
    const writes = [];
    for (const an of sc.anims ?? []) {
      const where = `${at} anim ${an.op}->${an.target}`;
      const t = byId.get(an.target);
      if (!t) {
        algebra.push(`${where}: target "${an.target}" is not an object in this scene`);
        continue;
      }
      touched.add(an.target);
      if (an.start + an.dur > sc.seconds + 1e-6)
        algebra.push(`${where}: ends at ${(an.start + an.dur).toFixed(2)}s, scene is ${sc.seconds}s`);
      if (an.op === "draw" && !STROKEABLE.has(t.kind))
        algebra.push(`${where}: draw on a ${t.kind}`);
      if (an.op === "growFrom") {
        if (!GROWABLE.has(t.kind)) algebra.push(`${where}: growFrom on a ${t.kind}`);
        if (!an.anchor) algebra.push(`${where}: growFrom with no anchor`);
      }
      if (an.op === "moveTo" && !an.toPos) algebra.push(`${where}: moveTo with no toPos`);
      if (an.op === "scaleTo" && an.to === undefined) algebra.push(`${where}: scaleTo with no to`);
      if (an.op === "recolor" && !an.toTone) algebra.push(`${where}: recolor with no toTone`);
      if (an.op === "countTo" && (an.from === undefined || an.to === undefined))
        algebra.push(`${where}: countTo without from/to`);
      if (an.op === "highlight") {
        if (t.kind !== "tex") algebra.push(`${where}: highlight on a ${t.kind}`);
        else if (!an.part) algebra.push(`${where}: highlight with no part`);
        else if (!t.tex?.includes(an.part))
          shared.push(`${where}: part "${an.part}" not verbatim in the tex`);
      }
      if (an.op === "morphInto") {
        if (!an.toObject) algebra.push(`${where}: morphInto with no toObject`);
        else if (!byId.has(an.toObject))
          algebra.push(`${where}: morphInto toObject "${an.toObject}" absent`);
      }
      writes.push([an.target, WRITES[an.op] ?? an.op, an.start, an.start + an.dur, an.op]);
    }
    for (let a = 0; a < writes.length; a++)
      for (let c = a + 1; c < writes.length; c++) {
        const [ta, pa, s0, e0] = writes[a];
        const [tb, pb, s1, e1] = writes[c];
        if (ta === tb && pa === pb && s0 < e1 - 1e-6 && s1 < e0 - 1e-6)
          algebra.push(`${at}: two "${pa}" tweens on "${ta}" overlap in time`);
      }

    // invisible forever
    for (const o of sc.objects)
      if ((o.opacity ?? 1) === 0 && !touched.has(o.id) && !(o.parent && touched.has(o.parent)))
        algebra.push(`${at}: "${o.id}" starts invisible and is never animated`);

    // holds
    for (const h of sc.holds ?? [])
      if (h < 0 || h > sc.seconds + 1e-6) algebra.push(`${at}: hold ${h}s outside [0, ${sc.seconds}]`);

    const want = (sc.holds ?? []).length;
    const got = sentenceCount(sc.narration);
    if (got !== want) shared.push(`${at}: narration ${got} sentences, ${want} holds`);

    const head = sc.objects.find((o) => o.kind === "text" && (o.fontPx ?? 0) >= 64);
    if (head?.text && head.text.length > 60)
      shared.push(`${at}: headline ${head.text.length} chars > 60`);
    if (sc.claim && sc.claim.length > 140) shared.push(`${at}: claim ${sc.claim.length} chars > 140`);

    // numeric fidelity: any number that reads as a bar value
    for (const an of sc.anims ?? [])
      if (an.op === "countTo" && an.to !== undefined && !nums.has(an.to))
        shared.push(`${at}: countTo ${an.to} not a number in the source`);
  });

  return { shared, algebra, soft, emitFail: [] };
}
