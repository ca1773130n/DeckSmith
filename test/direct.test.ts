/**
 * The Director (src/plan/direct.ts) and the `design` switch that runs it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emitScene } from "../src/emit/archetypes/index.js";
import { emitDeck } from "../src/emit/composition.js";
import type { Scene } from "../src/emit/kit.js";
import { signature } from "../src/emit/look.js";
import { ink } from "../src/emit/themes/ink.js";
import { direct, fnv1a, summarize } from "../src/plan/direct.js";
import { prefsFromFlags } from "../src/prefs.js";
import {
  type Beat,
  FORMATS,
  type Format,
  prefsSchema,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";

const format = FORMATS["deck-16x9"] as Format;
const repo = (rel: string) => new URL(`../${rel}`, import.meta.url);
const demo = storyboardSchema.parse(JSON.parse(readFileSync(repo("demo/storyboard.json"), "utf8")));
const source = sourceSchema.parse(JSON.parse(readFileSync(repo("demo/source.json"), "utf8")));
const opts = { source, format, theme: ink, seed: demo.sourceId };

/** Six comparisons in a row — the worst case for "no two adjacent beats alike". */
const sixSplits: Beat[] = Array.from({ length: 6 }, (_, i) => ({
  id: `b${i}`,
  archetype: "split-compare",
  intent: "Contrast.",
  evidence: [],
  weight: 0.5,
  seconds: 7,
  params: {
    eyebrow: "Setting",
    headline: `Comparison number ${i}`,
    left: { label: "Before", lines: ["One", "Two"] },
    right: { label: "After", lines: ["Three", "Four"] },
  },
})) as Beat[];

describe("direct", () => {
  it("is a pure function of its inputs", () => {
    expect(direct(demo.beats, opts)).toEqual(direct(demo.beats, opts));
  });

  it("never sets two adjacent beats in the same look when it has an alternative", () => {
    const d = direct(sixSplits, opts);
    expect(d.summary.adjacentRepeats).toBe(0);
    for (const b of d.beats) expect(b.viable).toBeGreaterThan(1);
  });

  it("spreads a run of one archetype across its looks instead of alternating two", () => {
    const d = direct(sixSplits, opts);
    expect(new Set(d.beats.map((b) => b.signature)).size).toBeGreaterThanOrEqual(3);
  });

  it("moves the chrome off the top of most slides", () => {
    // The 92.7% mode the founder called "always the same" is chrome on top.
    expect(direct(demo.beats, opts).summary.modalChrome).toBeLessThanOrEqual(0.5);
  });

  it("gives two papers with the same beats different decks", () => {
    const seeds = ["paper-a", "paper-b", "paper-c", "paper-d"].map((seed) =>
      direct(demo.beats, { ...opts, seed })
        .beats.map((b) => b.signature)
        .join(),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("refuses a look that would move a hold, and says why", () => {
    // A variant with a timing bug must degrade to the classic slide, never ship
    // audio aimed at the wrong frames.
    const shifty = (beat: Beat, ctx: Parameters<typeof emitScene>[1]): Scene => {
      const scene = emitScene(beat, ctx);
      return ctx.look?.placement === "foot"
        ? { ...scene, holds: scene.holds.map((h) => h + 0.5) }
        : scene;
    };
    const d = direct(sixSplits, { ...opts, emit: shifty });
    for (const b of d.beats) {
      expect(b.placement).not.toBe("foot");
      expect(b.refused).toContainEqual({
        signature: "split-compare:columns@foot",
        reason: "moves a hold or the chrome's landing",
      });
    }
  });

  it("refuses a look that draws the paper's figure under 80% of the classic look's area", () => {
    // Review 2026-10-08: rail and foot looks shrank figures to 43-61% of their
    // classic area (ja s4, ko s6) to make room for a headline. The demo's
    // architecture figure does the same: the rail would draw it at 43%.
    const b09 = demo.beats.find((b) => b.id === "b09") as Beat;
    const real = direct([b09], { ...opts, design: "v2" });
    const shrunk = (real.beats[0]?.refused ?? [])
      .map((r) => /(\d+)% of the classic look's area/.exec(r.reason)?.[1])
      .filter((x): x is string => x !== undefined)
      .map(Number);
    expect(shrunk.length).toBeGreaterThan(0);
    for (const pct of shrunk) expect(pct).toBeLessThan(80);
    expect(real.beats[0]?.placement).toBe("top");
    // The same looks, drawing the figure as large as classic does, are not refused for it.
    const classicArea = emitScene(b09, {
      source,
      format,
      theme: ink,
      sid: "s1",
      start: 0,
      design: "v2",
    }).figureArea as number;
    expect(classicArea).toBeGreaterThan(100_000);
    const full = (beat: Beat, ctx: Parameters<typeof emitScene>[1]): Scene => ({
      ...emitScene(beat, ctx),
      figureArea: classicArea,
    });
    const kept = direct([b09], { ...opts, design: "v2", emit: full });
    expect(kept.beats[0]?.refused.some((r) => /classic look's area/.test(r.reason))).toBe(false);
  });

  it("keeps the classic look on a beat the next beat's camera dives into", () => {
    const [a, b] = sixSplits as [Beat, Beat];
    const inside = { ...b, inside: { beat: a.id, element: "side0" } } as Beat;
    const d = direct([a, inside], opts);
    expect(d.beats[0]?.signature).toBe(signature("split-compare"));
    expect(d.beats[0]?.viable).toBe(1);
  });

  it("prefers the look that fills its body", () => {
    // Two bars: rows draw a thin band, two columns leave the plot empty, and a
    // versus sets the two values as the slide's figures.
    const twoBars = {
      id: "b1",
      archetype: "bar-compare",
      intent: "Compare.",
      evidence: [],
      weight: 0.5,
      seconds: 7,
      params: {
        eyebrow: "Result",
        headline: "Humans beat the best model",
        bars: [
          { label: "GPT-5", value: 58.4 },
          { label: "Human", value: 87.6 },
        ],
      },
    } as Beat;
    // Over many papers, not one: one seed's taste could land on columns by luck.
    for (let k = 0; k < 12; k++) {
      expect(direct([twoBars], { ...opts, seed: `paper-${k}` }).beats[0]?.variant).toBe("versus");
    }
  });
});

describe("summarize", () => {
  it("counts the modal chrome without the title, and adjacency within the deck", () => {
    const s = summarize([
      { archetype: "title", signature: "title:classic@top", placement: "top" },
      { archetype: "callout", signature: "callout:panels@top", placement: "top" },
      { archetype: "callout", signature: "callout:panels@top", placement: "top" },
      { archetype: "pipeline", signature: "pipeline:stair@rail", placement: "rail" },
    ]);
    expect(s.modalChrome).toBe(0.5);
    expect(s.adjacentRepeats).toBe(1);
    expect(s.distinct).toBe(3);
    expect(s.top4).toBe(1);
  });
});

describe("fnv1a", () => {
  it("is the standard 32-bit FNV-1a", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    expect(fnv1a("foobar")).toBe(0xbf9cf968);
  });
});

describe("design: the switch", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");

  it("does nothing unless asked: no Director, no looks, the classic composition", () => {
    const plain = emitDeck(demo, source, format, "");
    expect(plain.looks).toBeUndefined();
    expect(emitDeck(demo, source, format, "", { design: "classic" }).composition).toBe(
      plain.composition,
    );
  });

  it("v2 draws a different deck on the same clock", () => {
    const plain = emitDeck(demo, source, format, "");
    const v2 = emitDeck(demo, source, format, "", { design: "v2" });
    expect(v2.looks?.beats).toHaveLength(plain.cut.kept.length);
    expect(v2.composition).not.toBe(plain.composition);
    // Same stops at the same seconds: the slideshow island's fragments agree.
    const island = (html: string) =>
      html.match(
        /<script type="application\/hyperframes-slideshow\+json">([\s\S]*?)<\/script>/,
      )?.[1];
    expect(island(v2.composition)).toBe(island(plain.composition));
  });

  it("v2's golden: the demo composition, pinned", () => {
    // Re-pin deliberately, after LOOKING at the frames, when a v2 look changes.
    // Re-pinned 2026-10-08 on the merged preview/design-v2 branch (fit growth,
    // looks, motion together), after reading the demo's final-hold frames. And
    // again in the review fix round: the only change is two claims' stagger
    // (s9 0.05 → 0.032, s15 → 0.018), so their last word lands by the stop.
    // Then the figure floor: s9 leaves the foot look, which drew its figure at
    // 70% of the top look's area, for the top look at 1542x428 (was 1286x357),
    // and both plates hug their images. Then callout titles capped at 0.9 of the
    // headline (s2 60 → 57px) and s14 set as the rows of a table at the foot.
    expect(sha(emitDeck(demo, source, format, "", { design: "v2" }).composition)).toBe(
      "b336d73c0e8b5fa66a32508854561604cae43a9295c10655ec815aa9465f1a4f",
    );
  });

  it("is a preference: --design reaches the schema, and is absent unless stated", () => {
    expect(prefsFromFlags({ design: "v2" }).design).toBe("v2");
    // Optional with no default, so a pack written without it carries no new key.
    expect("design" in prefsSchema.parse({})).toBe(false);
    expect(() => prefsSchema.parse({ design: "v3" })).toThrow();
  });
});
