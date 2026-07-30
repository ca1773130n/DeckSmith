/**
 * CASE THIRTEEN, counted: content that is never visible at any hold, in a deck the
 * gate calls clean.
 *
 * `vocab-18` is gate-clean with ZERO errors and its first slide is a headline over
 * three grey arrows: four stage boxes and five labels are on the plate and none of
 * them is ever visible. The cause is compositional and the prompt walks the planner
 * straight into it. Two rules that are each correct:
 *
 *   "opacity is the object's state at t = 0 … an object that should fade in must be
 *    authored at opacity 0"
 *   "group … one tween on the group moves, fades or scales all of them together"
 *
 * compose into a contradiction the prompt never resolves: author the children at 0,
 * fade the GROUP in, and CSS multiplies 1 x 0 = 0 forever. Every box in vocab-18's
 * flow is authored `opacity: 0` inside a group that is faded in, and nothing ever
 * touches the box's own opacity.
 *
 * WHY NO GATE SEES IT. An invisible element overflows nothing, occludes nothing,
 * contrasts with nothing and its tweens land on real numbers. `lint`, `runtime`,
 * `layout`, `motion` and `contrast` all pass. So does the 40px floor — the sizes
 * are declared and legal. This is invariant 11's shape in a new place: a deck that
 * plays perfectly in the author's head and renders an empty frame.
 *
 * AND IT IS AN ALGEBRA-ONLY DISEASE. In arm MENU, revealing what a beat draws is
 * the emitter's job, not the plan's — a `pipeline` beat cannot omit the reveal of
 * its own stage box, because the plan never mentions opacity at all. The menu
 * cannot express this error. That asymmetry is the finding, and it does not show up
 * in the primary metric at all.
 *
 * The arithmetic below mirrors what the browser does: effective opacity is the
 * PRODUCT down the parent chain, and each element's own value is the last fromTo to
 * have finished before t — with the first tween's `from` applying before that,
 * because a `fromTo` renders its from-state at construction and every later one on
 * the same (element, property) carries `immediateRender: false` (VOCABULARY §2.5).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every tween that moves an object's own opacity, as [start, end, from, to]. */
function opacityTweens(scene, id) {
  const out = [];
  for (const a of scene.anims ?? []) {
    if (a.target === id && a.op === "fadeIn") out.push([a.start, a.start + a.dur, 0, 1]);
    if (a.target === id && a.op === "fadeOut") out.push([a.start, a.start + a.dur, 1, 0]);
    // `morphInto` hands over: the source ends at 0, the destination arrives at 1.
    if (a.target === id && a.op === "morphInto") out.push([a.start, a.start + a.dur, 1, 0]);
    if (a.toObject === id && a.op === "morphInto") out.push([a.start, a.start + a.dur, 0, 1]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

function ownOpacityAt(scene, o, t) {
  const tweens = opacityTweens(scene, o.id);
  if (tweens.length === 0) return o.opacity === undefined ? 1 : o.opacity;
  const done = tweens.filter(([, end]) => end <= t);
  if (done.length) return done[done.length - 1][3];
  // Before the first tween finishes: mid-flight counts as its `from` for the
  // purpose of "was this ever visible at a stop", which is the strict reading.
  return tweens[0][2];
}

function effectiveOpacityAt(scene, byId, o, t) {
  let v = ownOpacityAt(scene, o, t);
  let p = o.parent;
  const guard = new Set([o.id]);
  while (p && byId.has(p) && !guard.has(p)) {
    guard.add(p);
    const parent = byId.get(p);
    v *= ownOpacityAt(scene, parent, t);
    p = parent.parent;
  }
  return v;
}

/** Objects that draw something. A group draws nothing, so it cannot be "invisible". */
const DRAWS = new Set(["text", "tex", "rect", "ellipse", "arrow", "polyline", "image"]);

export function invisibleAtEveryHold(plan) {
  const rows = [];
  for (const scene of plan.scenes ?? []) {
    const byId = new Map((scene.objects ?? []).map((o) => [o.id, o]));
    const holds = scene.holds ?? [];
    for (const o of scene.objects ?? []) {
      if (!DRAWS.has(o.kind)) continue;
      const everVisible = holds.some((h) => effectiveOpacityAt(scene, byId, o, h) > 0.01);
      if (!everVisible) rows.push({ scene: scene.id, id: o.id, kind: o.kind });
    }
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { results } = JSON.parse(readFileSync(join(HERE, "out", "results.json"), "utf8"));
  const cleanOf = new Map(results.filter((r) => r.arm === "vocab").map((r) => [r.i, r.clean]));
  let affected = 0;
  let cleanAffected = 0;
  const per = [];
  for (let i = 1; i <= 20; i++) {
    const n = String(i).padStart(2, "0");
    const path = join(HERE, "runs", `vocab-${n}`, "plan.json");
    let plan;
    try {
      plan = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    const rows = invisibleAtEveryHold(plan);
    const total = (plan.scenes ?? []).reduce(
      (s, sc) => s + (sc.objects ?? []).filter((o) => DRAWS.has(o.kind)).length,
      0,
    );
    per.push({ run: `vocab-${n}`, clean: cleanOf.get(i) === true, invisible: rows.length, total, rows });
    if (rows.length) {
      affected++;
      if (cleanOf.get(i)) cleanAffected++;
      process.stdout.write(
        `  vocab-${n}  ${(cleanOf.get(i) ? "CLEAN" : "DIRTY").padEnd(5)}  ` +
          `${String(rows.length).padStart(2)}/${String(total).padEnd(2)} drawables never visible at any hold: ` +
          `${rows.slice(0, 9).map((r) => `${r.scene}/${r.id}`).join(" ")}${rows.length > 9 ? " …" : ""}\n`,
      );
    }
  }
  process.stdout.write(
    `\n  plans with content that is never visible at any hold: ${affected}/20\n` +
      `  of those, the gate reports ZERO ERRORS on: ${cleanAffected}\n` +
      `  arm MENU, structurally: 0 — the plan never mentions opacity; revealing what a\n` +
      `  beat draws is the archetype's job, so the error is not expressible.\n`,
  );
  process.stdout.write(`${JSON.stringify({ per }, null, 2).slice(0, 0)}`);
}
