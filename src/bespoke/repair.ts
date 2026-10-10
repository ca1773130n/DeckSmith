/**
 * Deterministic repair of a generated scene the gates refused for a reason a
 * person would fix by hand in seconds — instead of throwing the scene away.
 *
 * ROUND 2 LOST 4 OF 21 BEATS to `text_overlap` / `graphic_crosses_text` after
 * the critique round: big type collides more, and a model fixing one collision
 * by rewriting coordinates makes the next one. Round 2 also kept three scenes
 * that ended on a frame of ghosts. None of that needs another model call:
 *
 *  - LABEL COLLISIONS are solved as constraint relaxation over the frames the
 *    probe measured. Each colliding label's unit — the `<text>`, or the
 *    smallest `<g>` holding it with its plate and no other label — gets ONE
 *    constant offset, the smallest (in rings of `STEP` px, sixteen directions
 *    in a fixed order) that clears every other label by `LABEL_GAP`, every
 *    stroke sample by `STROKE_GAP`, every shape painted over it, and stays in
 *    the box, at EVERY measured frame, with the camera's scale at each frame
 *    applied. The offset becomes a wrapping `<g transform="translate()">` in
 *    the markup, so the scene's own tweens on the unit are untouched.
 *  - A DIMMED END (`end_dimmed`): the elements dimming parts the scene had lit
 *    are tweened back to opacity 1 just before the scene ends.
 *  - A CAMERA LEFT ZOOMED (`camera_end`): the camera is tweened home.
 *  - DIMMED WORDS (`dim_text`): a literal opacity under `TEXT_ALPHA_MIN` (but
 *    not 0: hidden is not dim) in a tween or set whose targets hold text is
 *    raised to it (`liftText`). Shapes in the same target are raised with it.
 *
 * Every repair is appended as ordinary contract code (a `tl.to` with literal
 * vars at a literal second, or a wrapper `<g>`), goes through `checkFragment`
 * like a model's, and is gated again before it is used. Deterministic: the same
 * geometry gives the same bytes, so a repaired scene caches like any other.
 */
import { type Node, parse } from "acorn";
import type { Geo, Layout } from "../verify/scenes.js";
import { type Fragment, SID_TOKEN } from "./contract.js";
import { untangle } from "./untangle.js";

/** Error rules this module can fix. A scene failing anything else is not repaired. */
export const REPAIRABLE = new Set([
  "graphic_crosses_text",
  "text_overlap",
  // verify's own SVG-label overprint: the same collision, seen by another gate.
  "svg_text_overprint",
  "end_dimmed",
  "camera_end",
  // Words dimmed under 3:1: their dimming opacity lifted to `TEXT_ALPHA_MIN` (`liftText`).
  "dim_text",
  // Two tweens on one property over overlapping time (src/bespoke/untangle.ts).
  "seek_order",
]);

/** Clearance a moved label keeps from every other label, px. */
export const LABEL_GAP = 16;
/** Clearance from every visible stroke sample, px. */
export const STROKE_GAP = 10;
/** Ring step, px. */
export const STEP = 8;
/**
 * The farthest a label may move: its own height times this, at least
 * `MIN_REACH` px. A nudge, not a relocation — MEASURED 2026-10-09 with a flat
 * 320px reach, the solver cleared a two-line label's overlap by carrying its
 * second line onto the illustration, away from its plate: every gate passed and
 * the label no longer read as one. A collision that needs more than this is the
 * critique round's to redesign.
 */
export const REACH = 0.8;
export const MIN_REACH = 32;

/** The `error <rule>:` lines of a gate's findings, by rule. */
export function errorRules(findings: readonly string[]): string[] {
  return [
    ...new Set(
      findings.map((f) => /^error ([\w-]+):/.exec(f)?.[1]).filter((r): r is string => !!r),
    ),
  ];
}

/** Whether every error in `findings` is one this module can fix (and there is one). */
export function repairable(findings: readonly string[]): boolean {
  const rules = errorRules(findings);
  return rules.length > 0 && rules.every((r) => REPAIRABLE.has(r));
}

/* ----------------------------------------------------------------- geometry */

type Box = [number, number, number, number];

/** One unit's offset, in the units of the unit's parent (screen px / its scale). */
export interface Move {
  u: string;
  dx: number;
  dy: number;
}

const overlapOf = (a: Box, b: Box): [number, number] => [
  Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]),
  Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]),
];
const contains = (outer: Box, inner: Box) =>
  outer[0] <= inner[0] + 1 &&
  outer[1] <= inner[1] + 1 &&
  outer[0] + outer[2] >= inner[0] + inner[2] - 1 &&
  outer[1] + outer[3] >= inner[1] + inner[3] - 1;
const shifted = (b: Box, dx: number, dy: number): Box => [b[0] + dx, b[1] + dy, b[2], b[3]];

/** Directions tried at each ring, in this order: vertical first (labels sit in rows), then sideways, then between. */
const ANGLES = [
  -90, 90, 180, 0, -135, -45, 135, 45, -112.5, -67.5, 112.5, 67.5, -157.5, -22.5, 157.5, 22.5,
];

/**
 * Offsets that clear every collision in `frames`, or the units it could not
 * clear. Pure: the probe measured `frames` (src/verify/scenes.ts, `geo`).
 */
export function solveNudges(frames: readonly Geo[]): { moves: Move[]; unresolved: string[] } {
  const moves = new Map<string, [number, number]>();
  const scaleIn = frames.map((f) => {
    const m = new Map<string, number>();
    for (const l of f.labels) if (l.u) m.set(l.u, l.s);
    return m;
  });
  const off = (fi: number, u: string | null): [number, number] => {
    if (!u) return [0, 0];
    const d = moves.get(u);
    if (!d) return [0, 0];
    const s = scaleIn[fi]?.get(u) ?? 1;
    return [d[0] * s, d[1] * s];
  };

  /** What `label` (at frame fi, offset by its unit's move, or by `trial`) collides with. */
  const clashes = (
    fi: number,
    li: number,
    trial?: [number, number],
  ): Array<{ kind: "label" | "stroke" | "shape"; other?: number }> => {
    const f = frames[fi] as Geo;
    const L = f.labels[li] as Geo["labels"][number];
    const strict = trial === undefined;
    const [ox, oy] = trial ?? off(fi, L.u);
    const box = shifted(L.b, ox, oy);
    const out: Array<{ kind: "label" | "stroke" | "shape"; other?: number }> = [];
    f.labels.forEach((M, mi) => {
      if (mi === li || (L.u !== null && M.u === L.u)) return;
      const [mx, my] = off(fi, M.u);
      const [ix, iy] = overlapOf(box, shifted(M.b, mx, my));
      const g = strict ? -4 : LABEL_GAP;
      if (ix > -g && iy > -g) out.push({ kind: "label", other: mi });
    });
    const inset = strict ? 4 : -STROKE_GAP;
    for (const [px, py, pu] of f.points) {
      if (L.u !== null && pu === L.u) continue;
      const [qx, qy] = off(fi, pu);
      const x = px + qx;
      const y = py + qy;
      if (
        x > box[0] + inset &&
        x < box[0] + box[2] - inset &&
        y > box[1] + inset &&
        y < box[1] + box[3] - inset
      ) {
        out.push({ kind: "stroke" });
        break;
      }
    }
    for (const B of f.boxes) {
      if ((L.u !== null && B.u === L.u) || B.o <= L.o) continue;
      const [bx, by] = off(fi, B.u);
      const bb = shifted(B.b, bx, by);
      if (contains(bb, box)) continue; // its plate
      const [ix, iy] = overlapOf(bb, box);
      if (strict ? ix > 4 && iy > 4 && ix * iy > 0.15 * box[2] * box[3] : ix > 0 && iy > 0) {
        out.push({ kind: "shape" });
        break;
      }
    }
    return out;
  };

  /** A unit's own strokes and shapes, moved by `d`, must not land on another label either. */
  const carried = (fi: number, u: string, d: [number, number]): boolean => {
    const f = frames[fi] as Geo;
    const s = scaleIn[fi]?.get(u) ?? 1;
    const [dx, dy] = [d[0] * s, d[1] * s];
    for (const M of f.labels) {
      if (M.u === u) continue;
      const [mx, my] = off(fi, M.u);
      const mb = shifted(M.b, mx, my);
      for (const [px, py, pu] of f.points)
        if (pu === u) {
          const x = px + dx;
          const y = py + dy;
          if (x > mb[0] + 4 && x < mb[0] + mb[2] - 4 && y > mb[1] + 4 && y < mb[1] + mb[3] - 4)
            return true;
        }
      for (const B of f.boxes)
        if (B.u === u && B.o > M.o) {
          const bb = shifted(B.b, dx, dy);
          if (contains(bb, mb)) continue;
          const [ix, iy] = overlapOf(bb, mb);
          if (ix > 0 && iy > 0) return true;
        }
    }
    return false;
  };

  /** Every (frame, label index) belonging to unit `u`. */
  const ofUnit = (u: string) =>
    frames.flatMap((f, fi) =>
      f.labels.flatMap((l, li) => (l.u === u ? [[fi, li] as [number, number]] : [])),
    );

  /** Whether moving `u` by `d` (parent units) is clear at every frame. */
  const clear = (u: string, d: [number, number]): boolean => {
    for (const [fi, li] of ofUnit(u)) {
      const f = frames[fi] as Geo;
      const L = f.labels[li] as Geo["labels"][number];
      const s = L.s || 1;
      const t: [number, number] = [d[0] * s, d[1] * s];
      const was = L.b;
      const inBox = was[0] >= 0 && was[1] >= 0 && was[0] + was[2] <= f.w && was[1] + was[3] <= f.h;
      const nb = shifted(was, t[0], t[1]);
      if (inBox && (nb[0] < 4 || nb[1] < 4 || nb[0] + nb[2] > f.w - 4 || nb[1] + nb[3] > f.h - 4))
        return false;
      if (clashes(fi, li, t).length) return false;
      if (carried(fi, u, d)) return false;
    }
    return true;
  };

  // Who moves: per collision, the label that can; between two labels, the
  // smaller one (it reads second), then the later-painted.
  const movers: string[] = [];
  const unresolved: string[] = [];
  const partner = new Map<string, string>();
  frames.forEach((f, fi) => {
    f.labels.forEach((L, li) => {
      for (const c of clashes(fi, li)) {
        let mover = L.u;
        if (c.kind === "label" && c.other !== undefined) {
          const M = f.labels[c.other] as Geo["labels"][number];
          const firstL = L.fs < M.fs || (L.fs === M.fs && L.o > M.o);
          const pick = firstL ? [L, M] : [M, L];
          mover = pick[0]?.u ?? pick[1]?.u ?? null;
          const other = mover === L.u ? M.u : L.u;
          if (mover && other && !partner.has(mover)) partner.set(mover, other);
        }
        if (!mover) unresolved.push(`${L.a} (cannot move)`);
        else if (!movers.includes(mover)) movers.push(mover);
      }
    });
  });

  const stillClashing = (u: string) =>
    frames.some((f, fi) =>
      f.labels.some(
        (l, li) =>
          (l.u === u ||
            clashes(fi, li).some((c) => c.other !== undefined && f.labels[c.other]?.u === u)) &&
          clashes(fi, li).length > 0,
      ),
    );

  const reach = (u: string) =>
    Math.max(
      MIN_REACH,
      ...ofUnit(u).map(([fi, li]) => {
        const L = frames[fi]?.labels[li] as Geo["labels"][number];
        return (REACH * L.b[3]) / (L.s || 1);
      }),
    );
  const place = (u: string): boolean => {
    for (let r = STEP; r <= reach(u); r += STEP)
      for (const a of ANGLES) {
        const rad = (a * Math.PI) / 180;
        const d: [number, number] = [
          Math.round(r * Math.cos(rad) * 10) / 10,
          Math.round(r * Math.sin(rad) * 10) / 10,
        ];
        if (clear(u, d)) {
          moves.set(u, d);
          return true;
        }
      }
    return false;
  };

  for (const u of movers) {
    if (!stillClashing(u)) continue;
    if (place(u)) continue;
    const p = partner.get(u);
    if (p && !moves.has(p) && place(p)) continue;
    unresolved.push(u);
  }
  // Whatever still collides after every move is unresolved.
  frames.forEach((f, fi) => {
    f.labels.forEach((L, li) => {
      if (clashes(fi, li).length && !unresolved.includes(L.u ?? L.a)) unresolved.push(L.u ?? L.a);
    });
  });
  return {
    moves: [...moves].map(([u, [dx, dy]]) => ({ u, dx, dy })),
    unresolved: [...new Set(unresolved)],
  };
}

/* ------------------------------------------------------------------- markup */

interface Tag {
  name: string;
  start: number;
  end: number;
  close: boolean;
  self: boolean;
}

/** Start and end tags in document order, comments skipped — the order the probe's `tag:index` counts. */
function tags(markup: string): Tag[] {
  const out: Tag[] = [];
  for (const m of markup.matchAll(/<!--[\s\S]*?-->|<(\/?)\s*([A-Za-z][\w:.-]*)([^>]*)>/g)) {
    if (m[0].startsWith("<!--")) continue;
    out.push({
      name: (m[2] ?? "").toLowerCase(),
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
      close: m[1] === "/",
      self: /\/\s*$/.test(m[3] ?? ""),
    });
  }
  return out;
}

/** The start tag `tag:index` addresses, and where its element ends. */
function locate(markup: string, address: string): { open: Tag; end: number } | undefined {
  const [name, n] = address.split("#")[0]?.split(":") ?? [];
  const k = Number(n);
  if (!name || !Number.isInteger(k)) return undefined;
  const all = tags(markup);
  let seen = 0;
  for (let i = 0; i < all.length; i++) {
    const t = all[i] as Tag;
    if (t.close || t.name !== name) continue;
    if (seen++ !== k) continue;
    if (t.self) return { open: t, end: t.end };
    let depth = 1;
    for (let j = i + 1; j < all.length; j++) {
      const u = all[j] as Tag;
      if (u.name !== name || u.self) continue;
      depth += u.close ? -1 : 1;
      if (depth === 0) return { open: t, end: u.end };
    }
    return undefined;
  }
  return undefined;
}

/** Each move as a wrapping `<g transform="translate(dx dy)">`, applied from the end so positions hold. */
export function applyMoves(markup: string, moves: readonly Move[]): string {
  const spots = moves
    .map((m) => ({ m, at: locate(markup, m.u) }))
    .filter((x): x is { m: Move; at: { open: Tag; end: number } } => x.at !== undefined)
    .sort((a, b) => b.at.open.start - a.at.open.start);
  let out = markup;
  for (const { m, at } of spots)
    out = `${out.slice(0, at.open.start)}<g transform="translate(${m.dx} ${m.dy})">${out.slice(at.open.start, at.end)}</g>${out.slice(at.end)}`;
  return out;
}

/**
 * A PLATE TOO SMALL FOR ITS TEXT — the commonest crossing round 4 still lost
 * scenes to (MEASURED 2026-10-09: zh run a, three of three fallbacks were a
 * summary plate whose own border ran through its CJK text; en, a token disc
 * round its own symbol). The model guesses a label's width. At a measured frame
 * where the label is at scale 1 (camera home), a filled `<rect>` or `<circle>`
 * painted before a label and covering at least half of it, but not all of it
 * with a margin, is that label's plate, and it is grown — by the deltas the
 * measured boxes call for, so a plate inside a translated group grows in its
 * own units — to hold the label with `PLATE_PAD` of the label's height round
 * it. Only a plate whose markup size IS its measured size (no scale between,
 * not resized by a tween) is touched; anything else is left to the nudges.
 */
export const PLATE_PAD = 0.3;

export function fitPlates(
  markup: string,
  frames: readonly Geo[] | Geo | undefined,
): { markup: string; grown: number } {
  const list = frames === undefined ? [] : Array.isArray(frames) ? frames : [frames as Geo];
  const edits = new Map<number, { open: Tag; attrs: Record<string, number> }>();
  for (const f of list) {
    for (const L of f.labels) {
      if (Math.abs((L.s || 1) - 1) > 0.02) continue;
      const lb = L.b;
      const pad = Math.max(6, PLATE_PAD * lb[3]);
      for (const B of f.boxes) {
        const kind = B.a.split(":")[0];
        if (B.o >= L.o || (kind !== "rect" && kind !== "circle")) continue;
        const [ix, iy] = overlapOf(B.b, lb);
        if (ix <= 0 || iy <= 0 || ix * iy < 0.5 * lb[2] * lb[3]) continue;
        const at = locate(markup, B.a);
        if (!at || edits.has(at.open.start)) continue;
        const head = markup.slice(at.open.start, at.open.end);
        if (/\stransform\s*=/.test(head)) continue;
        const num = (k: string) => {
          const m = new RegExp(`\\s${k}\\s*=\\s*["']?(-?[\\d.]+)["']?`).exec(head);
          return m ? Number(m[1]) : undefined;
        };
        if (kind === "rect") {
          const fits =
            B.b[0] <= lb[0] - 6 &&
            B.b[1] <= lb[1] - 6 &&
            B.b[0] + B.b[2] >= lb[0] + lb[2] + 6 &&
            B.b[1] + B.b[3] >= lb[1] + lb[3] + 6;
          if (fits) continue;
          const [x, y, w, h] = [num("x") ?? 0, num("y") ?? 0, num("width"), num("height")];
          // Markup size = measured size: no scale between them, no tween resizing it.
          if (
            w === undefined ||
            h === undefined ||
            Math.abs(w - B.b[2]) > 3 ||
            Math.abs(h - B.b[3]) > 3
          )
            continue;
          const left = Math.max(0, B.b[0] - (lb[0] - pad));
          const top = Math.max(0, B.b[1] - (lb[1] - pad));
          const right = Math.max(0, lb[0] + lb[2] + pad - (B.b[0] + B.b[2]));
          const bottom = Math.max(0, lb[1] + lb[3] + pad - (B.b[1] + B.b[3]));
          const r = (v: number) => Math.round(v);
          edits.set(at.open.start, {
            open: at.open,
            attrs: {
              x: r(x - left),
              y: r(y - top),
              width: r(w + left + right),
              height: r(h + top + bottom),
            },
          });
        } else {
          const radius = num("r");
          if (radius === undefined || Math.abs(2 * radius - B.b[2]) > 3) continue;
          const cx = B.b[0] + B.b[2] / 2;
          const cy = B.b[1] + B.b[3] / 2;
          const need = Math.max(
            ...[
              [lb[0], lb[1]],
              [lb[0] + lb[2], lb[1]],
              [lb[0], lb[1] + lb[3]],
              [lb[0] + lb[2], lb[1] + lb[3]],
            ].map(([px, py]) => Math.hypot((px as number) - cx, (py as number) - cy)),
          );
          if (need + 4 <= radius) continue;
          edits.set(at.open.start, { open: at.open, attrs: { r: Math.ceil(need + 6) } });
        }
      }
    }
  }
  let out = markup;
  for (const e of [...edits.values()].sort((a, b) => b.open.start - a.open.start)) {
    let head = out.slice(e.open.start, e.open.end);
    for (const [k, v] of Object.entries(e.attrs)) {
      const re = new RegExp(`(\\s${k}\\s*=\\s*)(["']?)-?[\\d.]+\\2`);
      head = re.test(head)
        ? head.replace(re, `$1"${v}"`)
        : head.replace(/^<\s*(rect|circle)/i, `$& ${k}="${v}"`);
    }
    out = out.slice(0, e.open.start) + head + out.slice(e.open.end);
  }
  return { markup: out, grown: edits.size };
}

/** When the end-state repairs land: after the last cue starts, finished before the end frame. */
export function settleAt(duration: number, lastCueStart: number): number {
  const t = Math.min(Math.max(duration - 1.8, lastCueStart + 0.2), duration - 1.4);
  return Math.max(0, Math.round(t * 100) / 100);
}

/**
 * Bring the elements dimming lit parts back to full strength at `at`. Targets
 * are the probe's `tag:index[#id]@opacity`, ids in the probe deck's form
 * (`sid-…`); an element without an id gets one (`SCENEID-lit<k>`). The opacity
 * each holds is its tween's from state (every tween is a fromTo); a target
 * without one is left alone.
 */
export function relight(
  f: Fragment,
  targets: readonly string[],
  at: number,
  sid: string,
): Fragment {
  let markup = f.markup;
  const selectors: Array<{ sel: string; op: number }> = [];
  const unnamed: Array<{ address: string; k: number; op: number }> = [];
  targets.forEach((target, k) => {
    const [t = "", o] = target.split("@");
    const op = Number(o);
    if (o === undefined || !Number.isFinite(op)) return;
    const id = t.split("#")[1];
    if (id)
      selectors.push({
        sel: `#${id.startsWith(`${sid}-`) ? SID_TOKEN + id.slice(sid.length) : id}`,
        op,
      });
    else unnamed.push({ address: t, k, op });
  });
  // Ids are injected from the last start tag back, so earlier positions hold.
  const spots = unnamed
    .map((x) => ({ ...x, at: locate(markup, x.address) }))
    .filter((x) => x.at !== undefined)
    .sort((a, b) => (b.at?.open.start ?? 0) - (a.at?.open.start ?? 0));
  for (const s of spots) {
    const open = s.at?.open as Tag;
    const head = markup.slice(open.start, open.end);
    const named = head.replace(/^<\s*([A-Za-z][\w:.-]*)/, `$& id="${SID_TOKEN}-lit${s.k}"`);
    markup = markup.slice(0, open.start) + named + markup.slice(open.end);
    selectors.push({ sel: `#${SID_TOKEN}-lit${s.k}`, op: s.op });
  }
  if (!selectors.length) return f;
  // One fromTo per opacity they are dimmed to, from that opacity.
  const byOp = new Map<number, Set<string>>();
  for (const { sel, op } of selectors) byOp.set(op, (byOp.get(op) ?? new Set()).add(sel));
  const tweens = [...byOp.entries()]
    .sort(([a], [b]) => a - b)
    .map(
      ([op, sels]) =>
        `tl.fromTo([${[...sels]
          .sort()
          .map((x) => JSON.stringify(x))
          .join(
            ", ",
          )}], { opacity: ${op} }, { opacity: 1, duration: 0.5, ease: "power2.out", immediateRender: false }, ${at});`,
    );
  return {
    ...f,
    markup,
    script: `${f.script}
// End-state repair (the shell's, not the model's): the last cue ends with what the scene lit at full strength.
${tweens.join("\n")}`,
  };
}

/** Send the camera home at `at`: the shell's wrapper, or the svg's viewBox. */
export function homeCamera(f: Fragment, camOff: string, at: number): Fragment {
  // The probe says where the camera is ("#sN-cam at scale S, x X, y Y", or
  // "#sN-svg viewBox X Y W H"), so the move home is a fromTo from there.
  const m = /-cam at scale (-?[\d.]+), x (-?[\d.]+), y (-?[\d.]+)/.exec(camOff);
  if (m)
    return {
      ...f,
      script: `${f.script}
// End-state repair: the camera returns to the whole scene before it ends.
tl.fromTo("#${SID_TOKEN}-cam", { scale: ${m[1]}, x: ${m[2]}, y: ${m[3]} }, { scale: 1, x: 0, y: 0, duration: 0.8, ease: "power3.inOut", immediateRender: false }, ${at});`,
    };
  const from = /-svg viewBox (-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+)/.exec(camOff)?.[1];
  const svg = /<svg\b[^>]*\bid\s*=\s*["']SCENEID-svg["'][^>]*>/i.exec(f.markup)?.[0] ?? "";
  const w = /\swidth\s*=\s*["']?([\d.]+)/.exec(svg)?.[1];
  const h = /\sheight\s*=\s*["']?([\d.]+)/.exec(svg)?.[1];
  if (!from || !w || !h) return f;
  return {
    ...f,
    script: `${f.script}
// End-state repair: the camera returns to the whole scene before it ends.
tl.fromTo("#${SID_TOKEN}-svg", { attr: { viewBox: "${from}" } }, { attr: { viewBox: "0 0 ${w} ${h}" }, duration: 0.8, ease: "power3.inOut", immediateRender: false }, ${at});`,
  };
}

/** What a repair did, for the report. */
/**
 * The lowest opacity a word is dimmed to: dark ink at 0.6 over a pale ground
 * is ~4:1, a pack tone ~3:1 (the `dim_text` floor). The prompt asks for it.
 */
export const TEXT_ALPHA_MIN = 0.6;

type AnyNode = Node & Record<string, unknown>;

/** The ids in `markup` whose element is, or holds, words (an SVG <text>, or text of its own). */
export function textHolders(markup: string): Set<string> {
  const out = new Set<string>();
  const stack: Array<{ name: string; id?: string }> = [];
  const mark = () => {
    for (const f of stack) if (f.id) out.add(f.id);
  };
  for (const m of markup.matchAll(/<(\/?)\s*([A-Za-z][\w:.-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) {
      const top = stack[stack.length - 1]?.name;
      if (m[5].trim() && top !== "style" && top !== "script") mark();
      continue;
    }
    const name = (m[2] ?? "").toLowerCase();
    if (m[1] === "/") {
      const at = stack.map((f) => f.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const id = /(?:^|\s)id\s*=\s*["']([^"']+)["']/.exec(m[3] ?? "")?.[1];
    if (m[4] === "/") continue;
    stack.push({ name, ...(id ? { id } : {}) });
    if (name === "text" || name === "foreignobject") mark();
  }
  return out;
}

/**
 * `dim_text`'s repair: every literal `opacity`/`autoAlpha` in (0, TEXT_ALPHA_MIN)
 * in a `tl.*`/`gsap.set` whose targets — `#id` selectors, literally or through a
 * top-level variable — include an element holding words, raised to
 * TEXT_ALPHA_MIN. Undefined when there is nothing it can read to lift.
 */
export function liftText(f: Fragment): { fragment: Fragment; lifted: number } | undefined {
  const words = textHolders(f.markup);
  let program: AnyNode;
  try {
    program = parse(f.script, {
      ecmaVersion: 2022,
      sourceType: "script",
      allowReturnOutsideFunction: true,
    }) as unknown as AnyNode;
  } catch {
    return undefined;
  }
  const str = (n: AnyNode | undefined) =>
    n?.type === "Literal" && typeof n.value === "string" ? n.value : undefined;
  const names = new Map<string, string[]>();
  for (const st of program.body as AnyNode[]) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations as AnyNode[]) {
      const id = d.id as AnyNode;
      const init = d.init as AnyNode | undefined;
      if (id.type !== "Identifier" || !init) continue;
      if (str(init) !== undefined) names.set(id.name as string, [str(init) as string]);
      else if (init.type === "ArrayExpression")
        names.set(
          id.name as string,
          (init.elements as AnyNode[]).map(str).filter((x): x is string => x !== undefined),
        );
    }
  }
  const selectors = (t: AnyNode | undefined): string[] => {
    if (!t) return [];
    if (str(t) !== undefined) return [str(t) as string];
    if (t.type === "Identifier") return names.get(t.name as string) ?? [];
    if (t.type === "ArrayExpression") return (t.elements as AnyNode[]).flatMap(selectors);
    return [];
  };
  const holdsWords = (t: AnyNode | undefined) =>
    selectors(t)
      .flatMap((sel) => sel.split(","))
      .some((sel) => {
        const id = /^\s*#([\w-]+)\s*$/.exec(sel)?.[1];
        return id !== undefined && words.has(id);
      });
  const edits: Array<[number, number]> = [];
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) visit(x);
      return;
    }
    const node = n as AnyNode;
    if (node.type === "CallExpression") {
      const callee = node.callee as AnyNode;
      const obj = callee.type === "MemberExpression" ? (callee.object as AnyNode).name : undefined;
      const method =
        callee.type === "MemberExpression" ? (callee.property as AnyNode).name : undefined;
      const args = node.arguments as AnyNode[];
      if ((obj === "tl" || (obj === "gsap" && method === "set")) && holdsWords(args[0])) {
        const varsList = method === "fromTo" ? [args[1], args[2]] : [args[1]];
        for (const vars of varsList) {
          if (vars?.type !== "ObjectExpression") continue;
          for (const p of vars.properties as AnyNode[]) {
            if (p.type !== "Property" || p.computed) continue;
            const k = p.key as AnyNode;
            const key = k.type === "Identifier" ? k.name : k.value;
            const v = p.value as AnyNode;
            if (
              (key === "opacity" || key === "autoAlpha") &&
              v.type === "Literal" &&
              typeof v.value === "number" &&
              v.value > 0 &&
              v.value < TEXT_ALPHA_MIN
            )
              edits.push([v.start, v.end]);
          }
        }
      }
    }
    for (const [k, v] of Object.entries(node))
      if (k !== "type" && v && typeof v === "object") visit(v);
  };
  visit(program.body);
  if (!edits.length) return undefined;
  let script = f.script;
  for (const [a, b] of edits.sort((x, y) => y[0] - x[0]))
    script = `${script.slice(0, a)}${TEXT_ALPHA_MIN}${script.slice(b)}`;
  return { fragment: { ...f, script }, lifted: edits.length };
}

export interface RepairNote {
  /** Overlapping tweens on one property were untangled (`seek_order`). */
  untangled?: boolean;
  /** Dimming opacities on words raised to `TEXT_ALPHA_MIN` (`dim_text`). */
  lifted?: number;
  moved: number;
  /** Plates grown to hold their text (`fitPlates`). */
  grown?: number;
  relit: number;
  camera: boolean;
  rules: string[];
}

/**
 * The repaired scene, or undefined when the findings include something this
 * cannot fix or the solver cannot clear every collision. Never a model call.
 */
export function repairScene(
  f: Fragment,
  g: { findings: readonly string[]; layout?: readonly Layout[]; sid?: string },
  scene: { duration: number; lastCueStart: number },
): { fragment: Fragment; note: RepairNote } | undefined {
  if (!repairable(g.findings)) return undefined;
  const rules = errorRules(g.findings);
  const layout = g.layout ?? [];
  const sid = g.sid ?? "";
  let out = f;
  const note: RepairNote = { moved: 0, relit: 0, camera: false, rules };
  if (
    ["graphic_crosses_text", "text_overlap", "svg_text_overprint"].some((r) => rules.includes(r))
  ) {
    const frames = layout.map((l) => l.geo).filter((x): x is Geo => x !== undefined);
    if (!frames.length) return undefined;
    // A plate too small for its text is grown first; the scene is gated again
    // before anything is nudged, because the frames measured the old plate.
    const plates = rules.includes("graphic_crosses_text")
      ? fitPlates(out.markup, frames)
      : { markup: out.markup, grown: 0 };
    if (plates.grown) {
      out = { ...out, markup: plates.markup };
      note.grown = plates.grown;
    } else {
      const { moves, unresolved } = solveNudges(frames);
      if (unresolved.length || !moves.length) return undefined;
      out = { ...out, markup: applyMoves(out.markup, moves) };
      note.moved = moves.length;
    }
  }
  if (rules.includes("seek_order")) {
    const script = untangle(out.script);
    if (!script) return undefined;
    out = { ...out, script };
    note.untangled = true;
  }
  if (rules.includes("dim_text")) {
    const lifted = liftText(out);
    if (!lifted) return undefined;
    out = lifted.fragment;
    note.lifted = lifted.lifted;
  }
  const end = layout.find((l) => l.key === "end");
  const at = settleAt(scene.duration, scene.lastCueStart);
  if (rules.includes("end_dimmed")) {
    const targets = end?.relight ?? [];
    if (!targets.length || !sid) return undefined;
    out = relight(out, targets, at, sid);
    note.relit = targets.length;
  }
  if (rules.includes("camera_end")) {
    if (!end?.camOff) return undefined;
    const homed = homeCamera(out, end.camOff, at);
    if (homed === out) return undefined;
    out = homed;
    note.camera = true;
  }
  return { fragment: out, note };
}
