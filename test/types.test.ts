/**
 * The format table is a table of promises: a canvas, a cut, and — since
 * `maxSeconds` — a length. Nothing validates it at runtime (it is the only
 * source of formats there is, so there is no boundary to validate it at), which
 * makes this file the boundary. Every rule below is one a wrong entry would
 * break silently, in a build that still says PASS.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canvasProblem,
  canvasWarnings,
  claimFigureParamsSchema,
  dataTableParamsSchema,
  FORMATS,
  type Format,
  isCustom,
  LEGIBLE_W,
  MAX_ASPECT,
  MAX_EDGE,
  MIN_EDGE,
  prefsSchema,
  resizeFormat,
  splitCompareParamsSchema,
} from "../src/types.js";
import { VERSION } from "../src/version.js";

const entries = Object.entries(FORMATS);

describe("FORMATS", () => {
  it("keys the table by each format's own id", () => {
    // `pickFormat` looks up by key and hands the value on; a key that disagreed
    // with its id would name one format in errors and build another.
    expect(entries.map(([key]) => key)).toEqual(entries.map(([, f]) => f.id));
  });

  it("declares a canvas in whole pixels", () => {
    for (const [key, f] of entries) {
      expect(`${key}: ${f.width}x${f.height}`).toBe(
        `${key}: ${Math.round(f.width)}x${Math.round(f.height)}`,
      );
      expect(f.width, key).toBeGreaterThan(0);
      expect(f.height, key).toBeGreaterThan(0);
    }
  });

  it("declares a minWeight that can keep a beat and can drop one", () => {
    // Beat weights are `z.number().min(0).max(1)`. A threshold above 1 keeps
    // nothing and throws in `layout`; below 0 it is not a filter at all.
    for (const [key, f] of entries) {
      expect(f.minWeight, key).toBeGreaterThanOrEqual(0);
      expect(f.minWeight, key).toBeLessThanOrEqual(1);
    }
  });

  it("states a duration budget for every format, including the unbudgeted ones", () => {
    // `maxSeconds` is optional in the TYPE so a test fixture need not invent a
    // length — see the field's comment. It is mandatory HERE: a shipped profile
    // with no budget is exactly the four-minute short this gate exists to catch,
    // and `Infinity` is how a profile says "no platform imposes one" out loud.
    for (const [key, f] of entries) {
      expect(f.maxSeconds, `${key} declares no maxSeconds`).toBeDefined();
      expect(f.maxSeconds ?? 0, key).toBeGreaterThan(0);
    }
  });

  it("budgets every format that exists to be posted somewhere", () => {
    // Landscape is presented or uploaded long-form and has no ceiling worth
    // encoding. Portrait and square exist for feeds, and every feed has a cap —
    // an unbudgeted one would produce an unpostable file and call it a pass.
    const feed = entries.filter(([, f]) => f.width <= f.height);
    expect(feed.length).toBeGreaterThan(0);
    for (const [key, f] of feed) {
      expect(Number.isFinite(f.maxSeconds ?? Infinity), `${key} is unbudgeted`).toBe(true);
    }
  });

  it("keeps the soft ceiling under the hard one", () => {
    // `warnSeconds` names a tighter destination than `maxSeconds` allows. At or
    // above it, it either never fires or fires only where the error already did.
    for (const [key, f] of entries.filter(([, f]) => f.warnSeconds !== undefined)) {
      expect(f.warnSeconds ?? 0, key).toBeGreaterThan(0);
      expect(f.warnSeconds ?? 0, key).toBeLessThan(f.maxSeconds ?? 0);
    }
  });

  it("gives the two 16x9 profiles the same budget, since a canvas cannot tell them apart", () => {
    // `scanBudget` resolves a built deck's format by its pixels, and these two
    // share them. Different budgets here would make the resolution a guess.
    const landscape = entries.filter(([, f]) => f.width === 1920 && f.height === 1080);
    expect(landscape.length).toBe(2);
    expect(new Set(landscape.map(([, f]: [string, Format]) => f.maxSeconds)).size).toBe(1);
  });

  it("emits the navigable wrapper for the format people click through, and no other", () => {
    // `navigable` decides whether `deck.html` exists at all. A video format with
    // it on ships a player nobody opens; a deck format with it off ships a deck
    // with no slides, which is EXPERIMENT-003 verbatim.
    expect(entries.filter(([, f]) => f.navigable).map(([key]) => key)).toEqual(["deck-16x9"]);
  });
});

/**
 * The four presets stopped being the only sizes. Everything below is a rule that
 * would otherwise be discovered by opening a frame — which is how the last seven
 * of these were discovered.
 */
const deck = FORMATS["deck-16x9"] as Format;
const short = FORMATS["short-9x16"] as Format;

describe("resizeFormat", () => {
  it("changes the pixels and nothing else", () => {
    // The whole design in one assertion: a canvas count implies no floor, no
    // budget and no navigability, so every other field must survive untouched.
    const post = resizeFormat(short, 1080, 1350);
    expect([post.width, post.height]).toEqual([1080, 1350]);
    expect(post.minWeight).toBe(short.minWeight);
    expect(post.maxSeconds).toBe(short.maxSeconds);
    expect(post.warnSeconds).toBe(short.warnSeconds);
    expect(post.navigable).toBe(short.navigable);
  });

  it("names itself after its canvas, because the base's name would now be wrong", () => {
    // `short-9x16` is printed in cut explanations and budget findings. Over a
    // 4:5 canvas it names a profile that is not what was built.
    expect(resizeFormat(short, 1080, 1350).id).toBe("custom-1080x1350");
    expect(isCustom(resizeFormat(short, 1080, 1350))).toBe(true);
  });

  it("returns the preset itself when the canvas is the one it already had", () => {
    // Identity, not merely equality: stating the size you were getting anyway
    // must not rename the format, and must not cost it the destinations its
    // name is what looks up. That is what keeps the shipped 16:9 build
    // byte-identical whether or not --width/--height were typed.
    expect(resizeFormat(deck, 1920, 1080)).toBe(deck);
    expect(isCustom(deck)).toBe(false);
  });

  it("carries no duration budget of its own onto a canvas nobody named", () => {
    // `DESTINATIONS` is keyed by preset id and a custom id is in no table, so a
    // resized deck-16x9 stays unbudgeted rather than inheriting a number from a
    // platform that has never seen this aspect ratio.
    const wide = resizeFormat(deck, 2560, 1440);
    expect(wide.maxSeconds).toBe(Number.POSITIVE_INFINITY);
    expect(wide.warnSeconds).toBeUndefined();
  });
});

describe("canvasProblem", () => {
  it("accepts the shapes people actually ask for", () => {
    for (const [w, h] of [
      [1080, 1350], // Instagram 4:5
      [1080, 1920], // 9:16
      [3840, 2160], // 4K
      [1280, 720],
      [100, 100], // legal and terrible, on purpose
      [MIN_EDGE, MIN_EDGE],
      [MAX_EDGE, MAX_EDGE / 2],
    ] as const) {
      expect(canvasProblem(w, h), `${w}x${h}`).toBeUndefined();
    }
  });

  it("refuses zero, negative and non-integer canvases by name", () => {
    for (const [w, h] of [
      [0, 1080],
      [-1920, 1080],
      [1920, 0],
      [1920, -1080],
      [1920.5, 1080],
      [Number.NaN, 1080],
      [1920, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(canvasProblem(w, h), `${w}x${h}`).toBeTruthy();
    }
    // The message says WHICH flag, because the caller typed two numbers.
    expect(canvasProblem(1920, 0)).toContain("--height");
    expect(canvasProblem(0, 1080)).toContain("--width");
  });

  it("refuses a canvas too small to draw on and one too large to capture", () => {
    expect(canvasProblem(MIN_EDGE - 1, 720)).toContain(String(MIN_EDGE));
    expect(canvasProblem(MAX_EDGE + 1, 1080)).toContain("Chrome");
    expect(canvasProblem(1080, MAX_EDGE + 1)).toContain("Chrome");
  });

  it("refuses a ratio past the point the scene padding eats the frame", () => {
    // Both directions. The wide one is the derivable failure — at 11.4:1 the
    // content box is zero — and the tall one is refused for the same reason the
    // rule is a single number a person can remember.
    expect(canvasProblem(8000, 900)).toBeTruthy(); // 8.9:1
    expect(canvasProblem(900, 8000)).toBeTruthy();
    expect(canvasProblem(32000, 1080)).toBeTruthy(); // the absurd one, by ratio and by edge
    // Just inside is allowed, so the bound is the bound and not a fudge.
    expect(canvasProblem(1600, 200)).toBeUndefined(); // exactly MAX_ASPECT:1
    expect(canvasProblem(200 * MAX_ASPECT + 200, 200)).toBeTruthy();
  });
});

describe("canvasWarnings", () => {
  it("says nothing about the sizes people actually ask for", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1350],
      [1080, 1080],
    ] as const) {
      expect(canvasWarnings(w, h), `${w}x${h}`).toEqual([]);
    }
  });

  it("warns that a 100x100 deck will be unreadable, and still allows it", () => {
    // The owner's case: legal, terrible, and it must SAY so rather than either
    // refusing or shipping a frame of grey smears in silence.
    expect(canvasProblem(100, 100)).toBeUndefined();
    const warnings = canvasWarnings(100, 100);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("100px wide");
  });

  it("warns below the width where the smallest type stops surviving a codec", () => {
    expect(canvasWarnings(LEGIBLE_W, 540)).toEqual([]);
    expect(canvasWarnings(LEGIBLE_W - 1, 540)).toHaveLength(1);
  });

  it("warns when the padding is about to take the slide, before the error does", () => {
    // 5:1 is legal (MAX_ASPECT is 8) and is still a canvas where the scene
    // padding takes nearly half the height. A gap between "allowed" and
    // "silent" is exactly where a bad canvas hides.
    const [warning] = canvasWarnings(5000, 1000);
    expect(warning).toMatch(/height to draw in/);
  });
});

/**
 * A slot that can hold a picture can hold a brief for one instead. Both fields
 * are optional so every stored plan still validates; the one thing the schema
 * must refuse is a claim-figure with nothing to show at all.
 */
describe("illustration slots", () => {
  const base = { headline: "H", claim: "c" };
  const brief = { prompt: "a lighthouse on a headland at dusk", caption: "The lighthouse" };

  it("lets a claim-figure carry a figure, a brief, or both", () => {
    expect(claimFigureParamsSchema.safeParse({ ...base, figureId: "f" }).success).toBe(true);
    expect(claimFigureParamsSchema.safeParse({ ...base, illustration: brief }).success).toBe(true);
    // Both is what `illustrate` leaves behind: the brief stays as provenance.
    expect(
      claimFigureParamsSchema.safeParse({ ...base, figureId: "f", illustration: brief }).success,
    ).toBe(true);
  });

  it("refuses a claim-figure with neither, at figureId", () => {
    const result = claimFigureParamsSchema.safeParse(base);
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.path)).toEqual([["figureId"]]);
  });

  it("lets a split-compare side carry a brief, and still lets a side be a list", () => {
    const side = (extra: Record<string, unknown>) =>
      splitCompareParamsSchema.safeParse({
        headline: "H",
        left: { label: "A", ...extra },
        right: { label: "B", lines: ["x"] },
      }).success;
    expect(side({ illustration: brief })).toBe(true);
    expect(side({ lines: ["y"] })).toBe(true);
    expect(side({ figureId: "f", illustration: brief })).toBe(true);
  });
});

/**
 * `data-table.rows` is a subset, and like the illustration slots it is OPTIONAL
 * because every plan under `experiments/` predates it. A field that a stored
 * plan has to grow in order to keep validating is a field that invalidates the
 * archive, and the archive is what `drift` compares against.
 */
describe("data-table row selection", () => {
  const base = { headline: "H", tableId: "t", highlight: [] };

  it("validates a beat that names no subset, exactly as before", () => {
    const parsed = dataTableParamsSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    // Absent, not defaulted to every row or to none: the emitter reads the
    // difference between "not asked" and "asked for nothing".
    expect(parsed.success ? "rows" in parsed.data : true).toBe(false);
  });

  it("takes row labels, and refuses a subset that names nothing", () => {
    expect(dataTableParamsSchema.safeParse({ ...base, rows: ["EDSR", "SwinIR"] }).success).toBe(
      true,
    );
    // An empty array is a beat asking for a table with no rows in it, which is
    // a mistake rather than a whole table.
    const empty = dataTableParamsSchema.safeParse({ ...base, rows: [] });
    expect(empty.success).toBe(false);
    expect(empty.success ? [] : empty.error.issues.map((i) => i.path)).toEqual([["rows"]]);
  });
});

describe("prefsSchema.images", () => {
  it("resolves every field when the block is omitted, like narration", () => {
    // A `.deck` manifest carries every preference, so an omitted block has to
    // read fully populated rather than as `{}`.
    expect(prefsSchema.parse({}).images).toEqual({
      enabled: false,
      provider: "codex",
      style: "flat vector illustration",
      max: 4,
    });
  });

  it("refuses a provider it does not have and a fractional cap, and allows zero", () => {
    expect(prefsSchema.safeParse({ images: { provider: "dalle" } }).success).toBe(false);
    expect(prefsSchema.safeParse({ images: { max: 2.5 } }).success).toBe(false);
    expect(prefsSchema.safeParse({ images: { max: -1 } }).success).toBe(false);
    // Zero is "every picture by the tool", which is a legal way to spend nothing.
    expect(prefsSchema.safeParse({ images: { max: 0 } }).success).toBe(true);
  });
});

/**
 * WHAT THE BINARIES SAY THEY ARE.
 *
 * Both entry points hardcoded `"0.1.0"` and both went on saying it: 0.1.2,
 * installed from the registry, answered `decksmith --version` with `0.1.0`.
 * Nothing catches a wrong string that is still a string — no gate compared it to
 * anything — and the one moment it is read is a user establishing which version
 * they have while chasing a bug, which is the worst moment to be lied to.
 */
describe("the version the package reports", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };

  it("is the one in package.json", () => {
    expect(VERSION).toBe(manifest.version);
  });

  it("is a version, not a placeholder", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
