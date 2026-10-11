/**
 * Gate `card_row`: a generated scene whose main visual is the template the
 * bespoke pass exists to replace — a row of cards, a column of panels, a grid
 * of tiles. Round 2 and round 4 both recorded scenes that "still speak the
 * language of labelled cards and connectors"; the prompt forbids it, and this
 * is the cheap check that it was obeyed.
 *
 * STATIC, from the markup alone: every `<rect>` with literal geometry, moved by
 * the `translate`/`scale` (and the `rotate(0)` or axis-aligned `matrix`) of the
 * `<g>`s around it and by the `x`/`y`/`viewBox` of a nested `<svg>`, outside
 * `<defs>`, clip paths, masks, patterns and symbols (a reveal's clip rect is not
 * a card); and every `<div>` placed by `left`/`top`/`width`/`height` in px, in
 * its inline style or in a `#id` rule of the scene's css. A card is a
 * rect at least `MIN_SIDE` of the box on each side and under `MAX_W`/`MAX_H` of
 * it (a ground or a band is not one). Cards are "alike" when both sides agree
 * within `ALIKE`. The scene is flagged when three or more alike cards share a
 * row (centres within half a card's height) or a column, or four make a grid —
 * and together they cover at least `MIN_AREA` of the box, so a legend's swatches
 * or a counter's plate never trip it.
 *
 * What it cannot see: cards drawn as `<path>`, positioned only by the script,
 * placed by a `<use>`, rotated, or laid out by flex/grid/class rules rather than
 * px boxes. It is a heuristic for the commonest case, not proof of a good scene
 * — the critique round and a person judge the rest.
 *
 * A DATA beat is never asked (src/bespoke/pipeline.ts): its prompt asks for
 * bars, and four bars of close values (PSNR 35.4 against 36.2) are alike
 * rectangles in a row by every measure here.
 */

/** A card's sides, as shares of the body box. */
export const MIN_SIDE = 0.08;
export const MAX_W = 0.6;
export const MAX_H = 0.8;
/** Two cards are alike when each side is within this share of the other's. */
export const ALIKE = 0.2;
/** The cards of a row must cover this share of the box between them. */
export const MIN_AREA = 0.12;
/**
 * Bump with any change to what `cardRow` flags. Part of the gate stamp a cached
 * rejection carries (src/bespoke/pipeline.ts `GATE_STAMP`), so loosening this
 * check releases the scenes it refused instead of keeping them archetypes.
 */
export const CARDS_VERSION = `cards-2:${MIN_SIDE}/${MAX_W}/${MAX_H}/${ALIKE}/${MIN_AREA}`;

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
    } else if (m[1] === "scale") {
      // A non-uniform scale is not a card's size any more: unreadable.
      if (args[1] !== undefined && args[1] !== args[0]) return undefined;
      s *= args[0] ?? 1;
    } else if (m[1] === "rotate" && (args[0] ?? 0) % 360 === 0) {
      // rotate(0) — the resting value of a tween — moves nothing.
    } else if (
      m[1] === "matrix" &&
      args.length === 6 &&
      args[1] === 0 &&
      args[2] === 0 &&
      (args[0] as number) > 0 &&
      args[0] === args[3]
    ) {
      dx += (args[4] as number) * s;
      dy += (args[5] as number) * s;
      s *= args[0] as number;
    } else return undefined;
  }
  return { dx, dy, s };
}

type Frame = { dx: number; dy: number; s: number };

/** A nested `<svg>` as an offset and a scale: its x/y, and its viewBox mapped to its width. */
function svgFrame(attrs: string): Frame | undefined {
  const x = num(attr(attrs, "x")) ?? 0;
  const y = num(attr(attrs, "y")) ?? 0;
  const vb = attr(attrs, "viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const w = num(attr(attrs, "width"));
  const h = num(attr(attrs, "height"));
  if (vb?.length !== 4 || vb.some((v) => !Number.isFinite(v)) || w === undefined)
    return { dx: x, dy: y, s: 1 };
  const [vx, vy, vw, vh] = vb as [number, number, number, number];
  if (vw <= 0 || vh <= 0) return undefined;
  const s = w / vw;
  // A viewBox stretched out of its aspect is not a card's shape any more.
  if (h !== undefined && Math.abs(h / vh - s) > 0.01 * s) return undefined;
  return { dx: x - vx * s, dy: y - vy * s, s };
}

/** `prop: value` pairs of a declaration block, lower-cased names. */
function decls(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of block.split(";")) {
    const at = d.indexOf(":");
    if (at > 0) out.set(d.slice(0, at).trim().toLowerCase(), d.slice(at + 1).trim());
  }
  return out;
}

/** px, or undefined for anything else (%, auto, calc). */
function px(v: string | undefined): number | undefined {
  const m =
    v === undefined ? null : /^(-?\d+(?:\.\d+)?)(px)?$/i.exec(v.replace(/!important/i, "").trim());
  return m ? Number(m[1]) : undefined;
}

/** Whether a declaration block paints a box: a background, a border or a shadow. */
function painted(d: Map<string, string>): boolean {
  for (const [k, v] of d) {
    if (!/^(background|background-color|border|border-width|outline|box-shadow)$/.test(k)) continue;
    if (!/^(none|transparent|0|0px|initial|unset)$/i.test(v.trim())) return true;
  }
  return false;
}

/**
 * The cards the markup draws, in box px. `css` is the scene's stylesheet: a
 * `<div>` placed and sized by its `#id` rule is read like one placed inline.
 */
export function cardsOf(markup: string, box: { width: number; height: number }, css = ""): Rect[] {
  const body = markup.replace(/<!--[\s\S]*?-->/g, "");
  const rules = new Map<string, Map<string, string>>();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/#([\w-]+)\s*\{([^}]*)\}/g))
    rules.set(
      m[1] as string,
      new Map([...(rules.get(m[1] as string) ?? []), ...decls(m[2] ?? "")]),
    );
  const out: Rect[] = [];
  // One frame per open element: its transform (undefined = unreadable) and whether it hides.
  const stack: Array<{ name: string; t: Frame | undefined; hide: boolean }> = [];
  const placed = (own: Frame | undefined): Frame | undefined => {
    let t: Frame | undefined = IDENTITY;
    for (const f of [...stack.map((x) => x.t), own]) {
      if (!f || !t) return undefined;
      t = { dx: t.dx + f.dx * t.s, dy: t.dy + f.dy * t.s, s: t.s * f.s };
    }
    return t;
  };
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
    let frame: Frame | undefined = IDENTITY;
    if (name === "rect" && !hide) {
      const t = placed(transformOf(attr(attrs, "transform")));
      const x = num(attr(attrs, "x")) ?? 0;
      const y = num(attr(attrs, "y")) ?? 0;
      const w = num(attr(attrs, "width"));
      const h = num(attr(attrs, "height"));
      if (t && w !== undefined && h !== undefined && w > 0 && h > 0)
        out.push({ x: t.dx + x * t.s, y: t.dy + y * t.s, w: w * t.s, h: h * t.s });
    } else if (name === "div") {
      // Inline style over the #id rule, as the cascade has it.
      const id = attr(attrs, "id");
      const d = new Map([
        ...(id ? (rules.get(id) ?? []) : []),
        ...decls(attr(attrs, "style") ?? ""),
      ]);
      const left = px(d.get("left"));
      const top = px(d.get("top"));
      const w = px(d.get("width"));
      const h = px(d.get("height"));
      const t = placed(IDENTITY);
      if (
        !hide &&
        t &&
        left !== undefined &&
        top !== undefined &&
        w &&
        h &&
        w > 0 &&
        h > 0 &&
        painted(d)
      )
        out.push({ x: t.dx + left * t.s, y: t.dy + top * t.s, w: w * t.s, h: h * t.s });
      // A div placed in px carries what it holds there.
      frame = left !== undefined && top !== undefined ? { dx: left, dy: top, s: 1 } : IDENTITY;
    } else if (name === "g") frame = transformOf(attr(attrs, "transform"));
    // The outermost <svg> is the body box itself; a nested one places what it holds.
    else if (name === "svg" && stack.some((f) => f.name === "svg")) frame = svgFrame(attrs);
    if (!selfClosing && name !== "rect") stack.push({ name, t: frame, hide });
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
  css = "",
): string | undefined {
  const cards = distinct(cardsOf(markup, box, css));
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
