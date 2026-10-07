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

  it("keeps the classic look on a beat the next beat's camera dives into", () => {
    const [a, b] = sixSplits as [Beat, Beat];
    const inside = { ...b, inside: { beat: a.id, element: "side0" } } as Beat;
    const d = direct([a, inside], opts);
    expect(d.beats[0]?.signature).toBe(signature("split-compare"));
    expect(d.beats[0]?.viable).toBe(1);
  });

  it("prefers the look that fills its body", () => {
    // Two bars: rows draw a thin band, columns stand the full height.
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
      expect(direct([twoBars], { ...opts, seed: `paper-${k}` }).beats[0]?.variant).toBe("columns");
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
    // looks, motion together), after reading the demo's final-hold frames.
    expect(sha(emitDeck(demo, source, format, "", { design: "v2" }).composition)).toBe(
      "050ad974852d641d8445bcab7549b1483ebd29a8887891486c05b86aaa3d32ab",
    );
  });

  it("is a preference: --design reaches the schema, and is absent unless stated", () => {
    expect(prefsFromFlags({ design: "v2" }).design).toBe("v2");
    // Optional with no default, so a pack written without it carries no new key.
    expect("design" in prefsSchema.parse({})).toBe(false);
    expect(() => prefsSchema.parse({ design: "v3" })).toThrow();
  });
});
