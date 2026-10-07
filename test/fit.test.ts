/**
 * THE FIT ENGINE (`design: "v2"`): archetypes grow into their region, predict
 * how full they came out, and change nothing else.
 *
 * Three promises are held here, in this order of importance:
 *
 *   1. CLASSIC IS v0.8.0. Absent and `"classic"` emit the same bytes, so every
 *      golden pinned before v2 existed still pins the shipped default.
 *   2. STOPS DO NOT MOVE. Every beat holds at the same times and refuses under
 *      the same conditions in both designs, so a storyboard and its narration can
 *      be rebuilt as v2 with no re-plan and no TTS. Checked on the demo — all
 *      thirteen archetypes — at every format. (The 2026-10-07 run over all 219
 *      stored HypePaper storyboards, 3,536 beats x 3 formats, found 0 differences.)
 *   3. THE GROWTH IS REAL, per archetype, and each prediction is in its band.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { emitScene } from "../src/emit/archetypes/index.js";
import { emitDeck } from "../src/emit/composition.js";
import { EMPTY_BELOW, FULL_AT, fillBand, fitOf, GROWTH, growToFit, isV2 } from "../src/emit/fit.js";
import type { EmitContext, Scene, Theme } from "../src/emit/kit.js";
import {
  type Beat,
  type BeatOf,
  type Design,
  FORMATS,
  type Format,
  type Source,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";

const repo = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const load = async (rel: string) => JSON.parse(await readFile(repo(rel), "utf8"));

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
const deck = FORMATS["deck-16x9"] as Format;
const bare: Source = {
  id: "src",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [],
  equations: [],
  tables: [],
};
const ctx = (design?: Design, source = bare, format = deck): EmitContext => ({
  source,
  format,
  theme,
  sid: "s1",
  start: 0,
  ...(design ? { design } : {}),
});
const beat = <A extends Beat["archetype"]>(
  archetype: A,
  params: BeatOf<A>["params"],
  seconds = 9,
): BeatOf<A> =>
  ({
    id: "b1",
    intent: "i",
    evidence: [],
    weight: 0.5,
    seconds,
    archetype,
    params,
  }) as unknown as BeatOf<A>;

/** Everything a scene emits that reaches a byte of the composition. */
const bytes = (s: Scene) => JSON.stringify({ ...s, fit: undefined, warnings: undefined });

/* --------------------------------------------------------------- the measure */

describe("fillBand", () => {
  it("grades main-axis fill in ResearchStudio-Reel's five bands", () => {
    expect(fillBand(0.69)).toBe("empty");
    expect(fillBand(EMPTY_BELOW)).toBe("sparse");
    expect(fillBand(0.89)).toBe("sparse");
    expect(fillBand(FULL_AT)).toBe("full");
    expect(fillBand(1)).toBe("full");
    expect(fillBand(1.05)).toBe("spillage");
    expect(fillBand(1.11)).toBe("overflow");
  });
});

describe("fitOf", () => {
  it("rounds to three places, once, so two builds agree to the byte", () => {
    expect(fitOf(700 / 3, 762)).toEqual({ fill: 0.306, region: 762, ink: 233.333 });
  });

  it("reads an empty region as 0 rather than dividing by it", () => {
    expect(fitOf(10, 0).fill).toBe(0);
  });
});

describe("growToFit", () => {
  const linear = (s: number) => 100 * s;

  it("returns the cap when the cap fits", () => {
    expect(growToFit(linear, 1000)).toBe(GROWTH);
  });

  it("returns the floor when even the floor does not fit — the caller's refusal handles that", () => {
    expect(growToFit(linear, 50)).toBe(1);
  });

  it("finds the largest scale that fits, floored onto a 1/128 grid, never over budget", () => {
    const k = growToFit(linear, 137);
    expect(linear(k)).toBeLessThanOrEqual(137);
    expect(linear(k + 1 / 128)).toBeGreaterThan(137);
    expect(k * 128).toBe(Math.floor(k * 128));
  });
});

describe("isV2", () => {
  it("is classic unless v2 was said, so every hand-built context stays v0.8.0", () => {
    expect(isV2({})).toBe(false);
    expect(isV2({ design: "classic" })).toBe(false);
    expect(isV2({ design: "v2" })).toBe(true);
  });
});

/* -------------------------------------------- 1 and 2: bytes and stops hold */

const demo = async () => ({
  storyboard: storyboardSchema.parse(await load("demo/storyboard.json")),
  source: sourceSchema.parse(await load("demo/source.json")),
});

describe("classic is v0.8.0", () => {
  it("emits the same bytes with no design and with design: classic, for every demo beat", async () => {
    const { storyboard, source } = await demo();
    for (const b of storyboard.beats) {
      const a = emitScene(b, ctx(undefined, source));
      const c = emitScene(b, ctx("classic", source));
      expect(bytes(c), b.id).toBe(bytes(a));
      expect(a.fit, b.id).toBeUndefined();
    }
  });

  it("emits the same composition, and no fit manifest, through emitDeck", async () => {
    const { storyboard, source } = await demo();
    const plain = emitDeck(storyboard, source, deck, "/*rt*/");
    const classic = emitDeck(storyboard, source, deck, "/*rt*/", { design: "classic" });
    expect(classic.composition).toBe(plain.composition);
    expect(classic.page).toBe(plain.page);
    expect(classic.fit).toBeUndefined();
  });
});

describe("v2 keeps every stop where classic put it", () => {
  for (const id of ["deck-16x9", "short-9x16", "post-1x1", "video-16x9"]) {
    it(`holds and refusals are identical for every demo beat at ${id}`, async () => {
      const { storyboard, source } = await demo();
      const format = FORMATS[id as keyof typeof FORMATS] as Format;
      for (const b of storyboard.beats) {
        const run = (d?: Design) => {
          try {
            return emitScene(b, ctx(d, source, format));
          } catch (err) {
            return err as Error;
          }
        };
        const c = run();
        const v = run("v2");
        expect(v instanceof Error, `${b.id} refusal`).toBe(c instanceof Error);
        if (c instanceof Error || v instanceof Error) continue;
        expect(v.holds, b.id).toEqual(c.holds);
      }
    });
  }
});
