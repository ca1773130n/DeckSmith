/**
 * One number that owns the frame (src/emit/archetypes/hero-number.ts).
 *
 * What the archetype promises, asserted on what it emits: the digits are reels
 * whose `y` is tweened a whole number of cells to the digit (never a counter
 * written from a callback — invariant 11), non-digits stand still, the number
 * is as large as the frame holds and never under its floor, the comparison is
 * drawn as bars only when both numbers are plain, and the scene stands on the
 * accent field or its backdrop, never the pale ground. What it looks like is
 * the frames' business, and is not claimed here.
 */
import { describe, expect, it } from "vitest";
import { heroNumber, plainNumber, turnsOf } from "../src/emit/archetypes/hero-number.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import { fieldColour, glass } from "../src/emit/backdrop.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { tweenText } from "../src/emit/kit.js";
import { MIN_FONT } from "../src/emit/svg.js";
import { PACKS } from "../src/emit/themes/packs.js";
import { type BeatOf, FORMATS, type Format, type Source } from "../src/types.js";

const source: Source = {
  id: "paper",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [
    {
      id: "gen-b1-bd",
      kind: "image",
      src: "hall.png",
      caption: "A hall",
      width: 1536,
      height: 1024,
    },
  ],
  equations: [],
  tables: [],
};

const ctx = (format: Format = FORMATS["deck-16x9"] as Format): EmitContext => ({
  source,
  format,
  theme: glass(PACKS.chalk as Theme),
  sid: "s3",
  start: 0,
  design: "v2",
});

type Params = BeatOf<"hero-number">["params"];
const beat = (params: Partial<Params> = {}): BeatOf<"hero-number"> => ({
  id: "b1",
  archetype: "hero-number",
  intent: "i",
  evidence: [],
  weight: 0.8,
  seconds: 8,
  params: {
    headline: "A quarter of the energy",
    value: "43.63",
    unit: "mJ",
    label: "EM-SNN",
    ...params,
  },
});

/** Every `font-size:Npx` the scene declares. */
const sizes = (css: string) => [...css.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));

describe("hero-number", () => {
  it("rolls each digit's reel a whole number of cells to that digit, with tweens alone", () => {
    const scene = heroNumber(beat(), ctx());
    const cell = Number(/\.hn-s>span\{height:(\d+)px/.exec(scene.css ?? "")?.[1]);
    expect(cell).toBeGreaterThan(0);
    const reels = scene.tl.filter((t) => /-r\d+$/.test(t.target));
    expect(reels.map((t) => t.target)).toEqual(["#s3-r0", "#s3-r1", "#s3-r2", "#s3-r3"]);
    [4, 3, 6, 3].forEach((digit, i) => {
      const t = reels[i];
      const stops = turnsOf(i) * 10 + digit;
      expect(t?.from).toEqual({ y: 0 });
      expect(t?.to.y).toBe(-stops * cell);
      // The cell it lands on is the digit: the strip counts 0-9 from the top.
      const strip = new RegExp(`id="s3-r${i}">((?:<span>\\d</span>)+)</span>`).exec(
        scene.html,
      )?.[1];
      const cells = [...(strip ?? "").matchAll(/<span>(\d)<\/span>/g)].map((m) => m[1]);
      expect(cells).toHaveLength(stops + 1);
      expect(cells[stops]).toBe(String(digit));
    });
    // Invariant 11: no callback anywhere, and every tween a fromTo.
    const code = scene.tl.map(tweenText).join("\n");
    expect(code).not.toMatch(/on(Update|Start|Complete|Repeat)/);
    expect(code).not.toMatch(/\.from\(/);
    expect(code).not.toMatch(/textContent|innerHTML|innerText/);
  });

  it("lands the most significant reel first and turns the least significant most", () => {
    expect([0, 1, 2, 3].map((i) => turnsOf(i))).toEqual([1, 2, 3, 3]);
    const scene = heroNumber(beat(), ctx());
    const ends = scene.tl
      .filter((t) => /-r\d+$/.test(t.target))
      .map((t) => t.at + Number(t.to.duration));
    expect([...ends].sort((a, b) => a - b)).toEqual(ends);
  });

  it("leaves a character that is not a digit standing still", () => {
    const scene = heroNumber(beat({ value: "1/4", unit: undefined }), ctx());
    expect(scene.html).toContain('<span class="hn-c">/</span>');
    expect(scene.tl.filter((t) => /-r\d+$/.test(t.target))).toHaveLength(2);
  });

  it("clips the reels with a clip-path the audits read, and tells them the overflow is meant", () => {
    const scene = heroNumber(beat(), ctx());
    expect(scene.css).toMatch(/\.hn-r\{height:\d+px;clip-path:inset\(0\)\}/);
    expect(scene.css).not.toMatch(/\.hn-r\{[^}]*overflow:hidden/);
    expect(scene.html).toMatch(
      /class="hn-r" data-layout-allow-overflow data-layout-allow-occlusion/,
    );
  });

  it("sets a short number larger than a long one, and every size at or above the floor", () => {
    const big = (s: string) => Number(/\.hn-n\{font-size:(\d+)px/.exec(s)?.[1]);
    const one = heroNumber(beat({ value: "1", unit: undefined }), ctx());
    const long = heroNumber(beat({ value: "175.21" }), ctx());
    expect(big(one.css ?? "")).toBeGreaterThan(big(long.css ?? ""));
    for (const s of [one, long])
      for (const n of sizes(s.css ?? "")) expect(n).toBeGreaterThanOrEqual(MIN_FONT);
  });

  it("draws the comparison as two bars to one scale only when both numbers are plain", () => {
    const bars = heroNumber(beat({ compare: { value: "175.21", label: "SFRDP-Net" } }), ctx());
    expect(bars.html).toContain('id="s3-b0" style="width:100%"');
    expect(bars.html).toContain('id="s3-b1" style="width:24.9%"');
    // The baseline grows first, then the value against it.
    const at = (id: string) => bars.tl.find((t) => t.target === id)?.at ?? -1;
    expect(at("#s3-b0")).toBeLessThan(at("#s3-b1"));

    const figure = heroNumber(
      beat({ value: "1/4", compare: { value: "1", label: "dense" } }),
      ctx(),
    );
    expect(figure.html).not.toContain("hn-bars");
    expect(figure.html).toContain('class="hn-vs"');
    expect(plainNumber("1,024")).toBe(1024);
    expect(plainNumber("75.1%")).toBeUndefined();
    expect(plainNumber("1/4")).toBeUndefined();
  });

  it("holds once, after the sentence has landed", () => {
    const scene = heroNumber(beat({ compare: { value: "175.21", label: "SFRDP-Net" } }), ctx());
    const head = scene.tl.find((t) => t.target === "#s3-h");
    expect(scene.holds).toEqual([
      Math.round(((head?.at ?? 0) + Number(head?.to.duration)) * 100) / 100,
    ]);
    for (const t of scene.tl) expect(t.at).toBeLessThan(scene.holds[0] as number);
  });

  it("refuses what it cannot draw, by name, rather than shrinking it", () => {
    expect(() => heroNumber(beat({ value: "about half" }), ctx())).toThrow(/no digit to roll/);
    expect(() => heroNumber(beat({ value: "1234567890123456" }), ctx())).toThrow(
      /does not fit across/,
    );
    expect(() =>
      heroNumber(beat({ headline: "A sentence that goes on ".repeat(8) }), ctx()),
    ).toThrow(/headline sets on \d+ lines/);
  });

  it("stands on the accent field without a backdrop, and on its picture with one", () => {
    const theme = PACKS.chalk as Theme;
    const plain = emitScene(beat(), { ...ctx(), theme });
    expect(plain.html).toMatch(/^<div class="fd" id="s3-fd"/);
    expect(plain.css).toContain(`background:${fieldColour(theme.accent)}`);
    // Drawn in glass inks either way: white digits, not the pack's dark ink.
    expect(plain.css).toContain("color:#f4f6fa");

    const over = emitScene(beat({ backdrop: { figureId: "gen-b1-bd" } }), { ...ctx(), theme });
    expect(over.html).toMatch(/^<div class="bd-m"/);
    expect(over.html).not.toContain('class="fd"');
  });
});
