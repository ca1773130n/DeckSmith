/**
 * Gate `card_row`: a generated scene whose main visual is the template the
 * bespoke pass exists to replace — a row of cards, a column of panels, a grid
 * of tiles. Round 2 and round 4 both recorded scenes that "still speak the
 * language of labelled cards and connectors"; the prompt forbids it, and this
 * is the cheap check that it was obeyed.
 *
 * STATIC, from the markup alone: every `<rect>` with literal geometry, moved by
 * the `translate`/`scale` of the `<g>`s around it, outside `<defs>`, clip paths,
 * masks, patterns and symbols (a reveal's clip rect is not a card). A card is a
 * rect at least `MIN_SIDE` of the box on each side and under `MAX_W`/`MAX_H` of
 * it (a ground or a band is not one). Cards are "alike" when both sides agree
 * within `ALIKE`. The scene is flagged when three or more alike cards share a
 * row (centres within half a card's height) or a column, or four make a grid —
 * and together they cover at least `MIN_AREA` of the box, so a legend's swatches
 * or a counter's plate never trip it.
 *
 * What it cannot see: cards drawn as `<path>`, positioned only by the script,
 * or placed by a `<use>`. It is a heuristic for the commonest case, not proof
 * of a good scene — the critique round and a person judge the rest.
 */

/** A card's sides, as shares of the body box. */
export const MIN_SIDE = 0.08;
export const MAX_W = 0.6;
export const MAX_H = 0.8;
/** Two cards are alike when each side is within this share of the other's. */
export const ALIKE = 0.2;
/** The cards of a row must cover this share of the box between them. */
export const MIN_AREA = 0.12;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const IDENTITY = { dx: 0, dy: 0, s: 1 };

/** Elements whose rects are never painted as themselves. */
const HIDDEN = new Set(["defs", "clippath", "mask", "pattern", "symbol", "marker"]);

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>/]+))`, "i").exec(
    attrs,
  );
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || /%/.test(v)) return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

/** A `<g transform>` as an offset and a scale; rotations and matrices are not read (undefined). */
function transformOf(t: string | undefined): { dx: number; dy: number; s: number } | undefined {
  if (!t) return IDENTITY;
  let dx = 0;
  let dy = 0;
  let s = 1;
  for (const m of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const args = (m[2] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (m[1] === "translate") {
      dx += (args[0] ?? 0) * s;
      dy += (args[1] ?? 0) * s;
    } else if (m[1] === "scale") s *= args[0] ?? 1;
    else return undefined;
  }
  return { dx, dy, s };
}

/** The cards the markup draws, in box px. */
export function cardsOf(markup: string, box: { width: number; height: number }): Rect[] {
  const body = markup.replace(/<!--[\s\S]*?-->/g, "");
  const out: Rect[] = [];
  // One frame per open element: its transform (undefined = unreadable) and whether it hides.
  const stack: Array<{
    name: string;
    t: { dx: number; dy: number; s: number } | undefined;
    hide: boolean;
  }> = [];
  for (const m of body.matchAll(/<(\/?)\s*([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const closing = m[1] === "/";
    const name = (m[2] ?? "").toLowerCase();
    const attrs = m[3] ?? "";
    const selfClosing = m[4] === "/";
    if (closing) {
      const at = stack.map((f) => f.name).lastIndexOf(name);
      if (at >= 0) stack.length = at;
      continue;
    }
    const parent = stack[stack.length - 1];
    const hide = (parent?.hide ?? false) || HIDDEN.has(name);
    if (name === "rect" && !hide) {
      let t: { dx: number; dy: number; s: number } | undefined = IDENTITY;
      for (const f of stack) {
        if (!f.t || !t) {
          t = undefined;
          break;
        }
        t = { dx: t.dx + f.t.dx * t.s, dy: t.dy + f.t.dy * t.s, s: t.s * f.t.s };
      }
      const own = transformOf(attr(attrs, "transform"));
      const x = num(attr(attrs, "x")) ?? 0;
      const y = num(attr(attrs, "y")) ?? 0;
      const w = num(attr(attrs, "width"));
      const h = num(attr(attrs, "height"));
      if (t && own && w !== undefined && h !== undefined && w > 0 && h > 0) {
        const s = t.s * own.s;
        out.push({
          x: t.dx + (own.dx + x * own.s) * t.s,
          y: t.dy + (own.dy + y * own.s) * t.s,
          w: w * s,
          h: h * s,
        });
      }
    }
    // Only a group moves what it holds (a nested <svg>'s own offset is not read).
    if (!selfClosing && name !== "rect")
      stack.push({
        name,
        t: name === "g" ? transformOf(attr(attrs, "transform")) : IDENTITY,
        hide,
      });
  }
  return out.filter(
    (r) =>
      r.w >= MIN_SIDE * box.width &&
      r.h >= MIN_SIDE * box.height &&
      r.w <= MAX_W * box.width &&
      r.h <= MAX_H * box.height,
  );
}

const alike = (a: Rect, b: Rect) =>
  Math.abs(a.w - b.w) <= ALIKE * Math.max(a.w, b.w) &&
  Math.abs(a.h - b.h) <= ALIKE * Math.max(a.h, b.h);

/** Distinct cards: a plate drawn twice at one place (a fill and an outline) counts once. */
function distinct(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rects)
    if (!out.some((o) => Math.abs(o.x - r.x) < 0.25 * r.w && Math.abs(o.y - r.y) < 0.25 * r.h))
      out.push(r);
  return out;
}

/**
 * Why the scene's main visual is a card row or a tile grid, or undefined when
 * it is not. The message names what was found, for the critique round.
 */
export function cardRow(
  markup: string,
  box: { width: number; height: number },
): string | undefined {
  const cards = distinct(cardsOf(markup, box));
  const area = box.width * box.height;
  let worst: { kind: string; n: number; cover: number } | undefined;
  for (const seed of cards) {
    const family = cards.filter((c) => alike(seed, c));
    if (family.length < 3) continue;
    const cy = (r: Rect) => r.y + r.h / 2;
    const cx = (r: Rect) => r.x + r.w / 2;
    const row = family.filter((c) => Math.abs(cy(c) - cy(seed)) <= seed.h / 2);
    const col = family.filter((c) => Math.abs(cx(c) - cx(seed)) <= seed.w / 2);
    const rows = new Set(family.map((c) => Math.round(cy(c) / (seed.h / 2))));
    const cols = new Set(family.map((c) => Math.round(cx(c) / (seed.w / 2))));
    const candidates = [
      { kind: "row", set: row, min: 3 },
      { kind: "column", set: col, min: 3 },
      { kind: "grid", set: rows.size >= 2 && cols.size >= 2 ? family : [], min: 4 },
    ];
    for (const c of candidates) {
      if (c.set.length < c.min) continue;
      const cover = c.set.reduce((s, r) => s + r.w * r.h, 0) / area;
      if (cover < MIN_AREA) continue;
      if (!worst || cover > worst.cover) worst = { kind: c.kind, n: c.set.length, cover };
    }
  }
  if (!worst) return undefined;
  return `the main visual is a ${worst.kind} of ${worst.n} alike rectangles covering ${Math.round(100 * worst.cover)}% of the box — cards or tiles, the template this scene replaces. Draw the beat's content itself (its device), not panels standing for it`;
}
