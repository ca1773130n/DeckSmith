/**
 * What can be silently wrong in a stack slide.
 *
 * The pile grows upward and its labels overhang it at both ends, so "does it
 * still fit" is not something reading the markup answers — it is answered by
 * measuring every drawn point and every set line against the box they were
 * promised. That measurement is done once, here, against the schema's smallest
 * and largest parameter sets and against the one point between them that is not
 * interpolation — where the notes are still set under their labels.
 */
import { describe, expect, it } from "vitest";
import { stack, stackLayout } from "../src/emit/archetypes/stack.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { tweenText } from "../src/emit/kit.js";
import { MIN_FONT, textWidth } from "../src/emit/svg.js";
import { type BeatOf, FORMATS } from "../src/types.js";

const theme: Theme = {
  bg: "#0b0d10",
  fg: "#e8eaed",
  muted: "#b8c4d2",
  dim: "#74808e",
  rule: "#2b333d",
  panel: "#16191e",
  accent: "#3d8bfd",
  tones: { a: "#7cc4ff", b: "#ffd166", c: "#f78da7", d: "#6ee7a8" },
  fontStack: '"Inter", system-ui, sans-serif',
};

const format = FORMATS["deck-16x9"] as (typeof FORMATS)[string];
const ctx = (sid: string): EmitContext => ({
  source: { id: "s", title: "t", lang: "en", sections: [], figures: [], equations: [], tables: [] },
  format,
  theme,
  sid,
});

type Params = BeatOf<"stack">["params"];
const beat = (params: Params, seconds = 9): BeatOf<"stack"> => ({
  id: "b",
  intent: "i",
  evidence: [],
  weight: 0.5,
  seconds,
  archetype: "stack",
  params,
});

/** The schema's minimum: two layers, no eyebrow, no notes. */
const MIN: Params = {
  headline: "Two layers, nothing else",
  layers: [{ label: "Shallow features" }, { label: "Deep features" }],
};

/** The schema's maximum: seven layers, every optional field present. */
const MAX: Params = {
  eyebrow: "Architecture",
  headline: "Six residual groups on a shallow stem",
  note: "Every block keeps the resolution; only the channel count moves.",
  layers: [
    { label: "Shallow feature extraction", note: "3x3 conv, 60ch" },
    { label: "Residual group 1", note: "6 RSTB blocks" },
    { label: "Residual group 2", note: "6 RSTB blocks" },
    { label: "Residual group 3", note: "6 RSTB blocks" },
    { label: "Residual group 4", note: "6 RSTB blocks" },
    { label: "Deep feature refinement", note: "conv + long skip" },
    { label: "Reconstruction", note: "pixel shuffle x4" },
  ],
};

/* ------------------------------------------------------------ ink extraction */

interface Ink {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  what: string;
}

const nums = (s: string) => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
const attr = (tag: string, name: string) =>
  Number(new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(tag)?.[1] ?? Number.NaN);
const unesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Every point the scene draws, as boxes. Shapes give their own coordinates;
 * text is measured through the same metrics the emitter sized it with, which is
 * the point — a second width model in the test would agree until it mattered.
 */
function ink(svg: string): Ink[] {
  const out: Ink[] = [];
  const add = (x: number, y: number, what: string) =>
    out.push({ x0: x, x1: x, y0: y, y1: y, what });

  for (const [, d] of svg.matchAll(/<path [^>]*d="([^"]+)"/g)) {
    const v = nums(d ?? "");
    for (let i = 0; i + 1 < v.length; i += 2) add(v[i] as number, v[i + 1] as number, "path");
  }
  for (const tag of svg.match(/<line [^>]*\/>/g) ?? []) {
    add(attr(tag, "x1"), attr(tag, "y1"), "line");
    add(attr(tag, "x2"), attr(tag, "y2"), "line");
  }
  for (const tag of svg.match(/<circle [^>]*\/>/g) ?? []) {
    const r = attr(tag, "r");
    const cx = attr(tag, "cx");
    const cy = attr(tag, "cy");
    out.push({ x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r, what: "circle" });
  }
  for (const [, head, body] of svg.matchAll(/<text ([^>]*)>([\s\S]*?)<\/text>/g)) {
    const tag = `<text ${head}>`;
    const size = attr(tag, "font-size");
    const weight = Number.isNaN(attr(tag, "font-weight")) ? 400 : attr(tag, "font-weight");
    const anchor = /text-anchor="([a-z]+)"/.exec(tag)?.[1] ?? "start";
    const runs = [
      ...(body ?? "").matchAll(/<tspan x="([\d.-]+)" dy="([\d.-]+)">([^<]*)<\/tspan>/g),
    ];
    const lines = runs.length
      ? runs.map((r) => ({ x: Number(r[1]), dy: Number(r[2]), s: unesc(r[3] ?? "") }))
      : [{ x: attr(tag, "x"), dy: 0, s: unesc(body ?? "") }];
    let y = attr(tag, "y");
    for (const l of lines) {
      y += l.dy;
      const w = textWidth(l.s, size, weight);
      const x = anchor === "middle" ? l.x - w / 2 : anchor === "end" ? l.x - w : l.x;
      // Cap height above the baseline, descender below — the ink, not the em box.
      out.push({ x0: x, x1: x + w, y0: y - size * 0.75, y1: y + size * 0.25, what: `"${l.s}"` });
    }
  }
  return out;
}

function svgOf(html: string): { body: string; w: number; h: number } {
  const m = /<svg [^>]*width="([\d.]+)" height="([\d.]+)"[^>]*>([\s\S]*)<\/svg>/.exec(html);
  if (!m) throw new Error("no svg");
  return { body: m[3] as string, w: Number(m[1]), h: Number(m[2]) };
}

/* ---------------------------------------------------------------------- tests */

describe("stack geometry", () => {
  for (const [name, params] of [
    ["minimal params", MIN],
    ["maximal params", MAX],
    // The middle is not interpolation: it is the other composition, where the
    // notes are set under their labels rather than beside them.
    ["stacked notes", { ...MAX, layers: MAX.layers.slice(0, 4) }],
  ] as const) {
    it(`keeps every drawn point inside the svg box — ${name}`, () => {
      const { body, w, h } = svgOf(stack(beat(params), ctx("s1")).html);
      const marks = ink(body);
      expect(marks.length).toBeGreaterThan(20);
      const escaped = marks.filter((m) => m.x0 < -0.5 || m.x1 > w + 0.5 || m.y0 < -0.5 || m.y1 > h);
      expect(escaped).toEqual([]);
    });

    it(`keeps the whole slide inside the canvas — ${name}`, () => {
      const L = stackLayout(params, format);
      // The scene is chrome, a 20px margin, the diagram, then the note; `.scene`
      // padding is 84px top and bottom. The pile grows upward, so this is the
      // sum that decides whether the top layer leaves the slide.
      expect(L.chromeH + 20 + L.height + L.noteH).toBeLessThanOrEqual(format.height - 168);
      expect(L.width).toBe(format.width - 220);
    });

    it(`never sets audience type below the floor — ${name}`, () => {
      const { body } = svgOf(stack(beat(params), ctx("s1")).html);
      const sizes = [...body.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(MIN_FONT);
    });
  }

  it("aligns every label on one spine", () => {
    const L = stackLayout(MAX, format);
    const { body } = svgOf(stack(beat(MAX), ctx("s1")).html);
    // Labels are start-anchored, so their own x is the spine. Notes hang off the
    // far edge; the numerals have their own. Three columns, three x values.
    const round = (v: number) => Math.round(v * 100) / 100;
    const xs = new Set([...body.matchAll(/<text x="([\d.]+)"/g)].map((m) => Number(m[1])));
    expect([...xs].sort((a, b) => a - b)).toEqual([48, L.labelX, L.labelX + L.colW].map(round));
  });
});

describe("stack timeline", () => {
  const scene = stack(beat(MAX), ctx("s7"));

  it("scopes every selector to its own scene", () => {
    const selectors = scene.tl.map((t) => t.target);
    expect(selectors.length).toBe(scene.tl.length);
    for (const s of selectors) expect(s.startsWith("#s7")).toBe(true);
  });

  it("never emits from()", () => {
    for (const t of scene.tl) expect(tweenText(t)).toMatch(/^tl\.fromTo\(/);
  });

  it("holds once per settled reveal, in order, inside the beat", () => {
    // One per layer plus one for the slide note. A hold landing on an unsettled
    // frame is what makes deck navigation show a half-built pile.
    expect(scene.holds.length).toBe(MAX.layers.length + 1);
    expect([...scene.holds].sort((a, b) => a - b)).toEqual(scene.holds);
    expect(new Set(scene.holds).size).toBe(scene.holds.length);
    expect(scene.holds[0]).toBeGreaterThan(0.9);
    expect(scene.holds[scene.holds.length - 1]).toBeLessThanOrEqual(9 - 0.15);
  });

  it("clamps holds into a beat shorter than its own reveal schedule", () => {
    const short = stack(beat(MAX, 2), ctx("s7"));
    for (const h of short.holds) expect(h).toBeLessThanOrEqual(2 - 0.15);
  });

  it("breathes on the focal plane only, gated and scoped", () => {
    expect(scene.css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(scene.css).toContain(`.ds-live #s7-lay${MAX.layers.length - 1}{animation:ds-breathe`);
    // The plane's entrance owns opacity and transform; CSS animation outranks
    // inline style, so the ambient rule must move neither.
    expect(scene.css).not.toContain("ds-drift");
  });

  it("renders byte-identically twice", () => {
    const a = stack(beat(MAX), ctx("s7"));
    const b = stack(beat(MAX), ctx("s7"));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("escapes label, note and headline text", () => {
    const s = stack(
      beat({ headline: "a <b>", note: "n <b>", layers: [{ label: "x <b>" }, { label: "y" }] }),
      ctx("s1"),
    );
    expect(s.html).not.toMatch(/<b>/);
    expect(s.html).toContain("&lt;b&gt;");
  });
});

describe("stack label fitting", () => {
  /**
   * The archetype's hardest decision. Seven layers each carrying a note is two
   * lines of audience type per layer — ~106px — and after an eyebrow, a headline
   * and a slide note there is nowhere near 7x106 left. The rise cannot absorb
   * it, and shrinking type is forbidden, so the composition has to change.
   */
  it("moves the note beside its label when the pile is too tall to stack them", () => {
    expect(stackLayout(MIN, format).inline).toBe(false);
    const four = stackLayout({ ...MAX, layers: MAX.layers.slice(0, 4) }, format);
    expect(four.inline).toBe(false);
    expect(four.fits).toBe(true);

    const max = stackLayout(MAX, format);
    expect(max.inline).toBe(true);
    expect(max.fits).toBe(true);
    // Which is only worth doing if it actually bought the room it claimed to.
    expect(max.rise).toBeGreaterThan(max.blockH + 10);
  });

  it("gives every label a column wide enough for the line it was wrapped to", () => {
    for (const params of [MIN, MAX]) {
      const L = stackLayout(params, format);
      expect(L.labelSize).toBeGreaterThanOrEqual(MIN_FONT);
      expect(L.labelX + L.colW).toBeLessThanOrEqual(L.width);
      for (const l of L.lines) {
        for (const line of l.label) {
          expect(textWidth(line, L.labelSize, 600)).toBeLessThanOrEqual(l.labelMaxW);
        }
        // An inline note is set on one line by contract and must clear the label.
        if (L.inline && l.note.length > 0) {
          expect(l.note.length).toBe(1);
          expect(l.labelMaxW + l.noteW).toBeLessThanOrEqual(L.colW + 1e-6);
        }
      }
    }
  });

  it("refuses when nothing fits, rather than crowding the labels", () => {
    // A headline that wraps plus a long note leaves too little for seven layers.
    //
    // THIS CASE USED TO SAY "crowded labels are a compromise; a pile hanging off
    // the top is a defect", and drew the crowded pile. Both halves were right and
    // the conclusion no longer follows: `fits` is `room >= blockH + 10`, where
    // `room` is the rise one layer gets and `blockH` is the tallest label block,
    // so `fits === false` IS "adjacent labels overlap" stated in arithmetic. A
    // deck that draws it does not ship either — `svg_text_overprint` reports it
    // as an error, which is how it was found: a Korean deck with five noted
    // layers, four overlapping pairs on one slide. The compromise was between a
    // visible defect and a build failure with a worse message.
    //
    // So it refuses, `onBeatError` drops the one beat, and the other eleven
    // survive — which is what every other archetype here already does.
    const cramped: Params = {
      ...MAX,
      headline: "Six residual transformer groups sitting on a single shallow convolutional stem",
      note: "Every block keeps the resolution and only the channel count moves, while the long skip carries the stem all the way to the tail of the network.",
    };
    const L = stackLayout(cramped, format);
    expect(L.fits).toBe(false);
    // The layout still solves — the refusal is the emitter's, and it reports the
    // two numbers the author needs to act on.
    expect(L.chromeH + 20 + L.height + L.noteH).toBeLessThanOrEqual(format.height - 168);
    expect(() => stack(beat(cramped), ctx("s1"))).toThrow(/7 layers with 7 note\(s\)/);
    expect(() => stack(beat(cramped), ctx("s1"))).toThrow(/drop a layer, or shorten the notes/);

    // And a stack that DOES fit still draws, entirely inside its own box — the
    // assertion this case used to make about the crowded one.
    const { body, w, h } = svgOf(stack(beat(MAX), ctx("s1")).html);
    for (const m of ink(body)) {
      expect(m.x0).toBeGreaterThanOrEqual(-0.5);
      expect(m.x1).toBeLessThanOrEqual(w + 0.5);
      expect(m.y0).toBeGreaterThanOrEqual(-0.5);
      expect(m.y1).toBeLessThanOrEqual(h);
    }
  });
});

/**
 * The pile fills the height portrait actually has.
 *
 * `RISE_MAX` was one number chosen against a 570px landscape budget. Portrait has
 * roughly 1400px for the same four layers, so the same cap left the pile sitting
 * in the middle of 600px of nothing — a slide that passes every gate and reads as
 * unfinished.
 */
describe("stack in portrait", () => {
  const short = FORMATS["short-9x16"] as (typeof FORMATS)[string];

  it("rises further than the landscape cap, and grows the slabs to match", () => {
    for (const p of [MIN, MAX]) {
      const wide = stackLayout(p, format);
      const tall = stackLayout(p, short);
      expect(tall.rise).toBeGreaterThan(wide.rise);
      // The rise and the slab move together, or four layers stop reading as one
      // pile and start reading as four diagrams.
      expect(tall.sy).toBeGreaterThan(wide.sy);
      expect(tall.t).toBeGreaterThanOrEqual(wide.t);
    }
  });

  it("still ends inside the height it was solved against", () => {
    for (const p of [MIN, MAX]) {
      const L = stackLayout(p, short);
      expect(L.height).toBeLessThanOrEqual(L.avail);
      expect(L.yBase - (p.layers.length - 1) * L.rise - L.sy).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it("uses more of the portrait budget than the landscape cap allowed", () => {
    const L = stackLayout(MAX, short);
    expect(L.height / L.avail).toBeGreaterThan(0.6);
  });

  it("leaves the landscape pile exactly as it was", () => {
    for (const p of [MIN, MAX]) {
      const L = stackLayout(p, format);
      expect(L.rise).toBeLessThanOrEqual(180);
      expect(L.sy).toBeLessThanOrEqual(100);
      expect(L.t).toBeLessThanOrEqual(18);
    }
  });
});
