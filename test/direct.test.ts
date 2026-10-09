/**
 * The Director (src/plan/direct.ts) and the `design` switch that runs it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emitScene } from "../src/emit/archetypes/index.js";
import { emitDeck } from "../src/emit/composition.js";
import type { Scene } from "../src/emit/kit.js";
import { beatSignature, signature } from "../src/emit/look.js";
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

  /**
   * A STAGE HAS NO CHROME. Its look's `top` is a default no slide shows, and
   * counting it charged the beat after two stages a samePlacement penalty for
   * a run of top headlines that was not there, pushing it off its classic
   * layout for no visual reason. So the beat after two stages is directed
   * exactly as if they were not there, and the summary counts no stage as top.
   */
  it("directs the beat after two stages as if no chrome came before it", () => {
    const stageOf = (id: string, placement: "bottom-left" | "right"): Beat =>
      ({
        id,
        archetype: "stage",
        intent: "Show it.",
        evidence: [],
        weight: 0.8,
        seconds: 6,
        params: { headline: "The model", figureId: "fig-compare", placement },
      }) as Beat;
    const stages = [stageOf("st1", "bottom-left"), stageOf("st2", "right")];
    const drawn = demo.beats.filter((b) => b.archetype !== "title" && b.archetype !== "stage");
    // Under a pack that leans to top chrome, where a phantom run of two tops
    // decides the pick: counted, it moved 6 of these 14 beats off the top.
    const leaning = { ...opts, theme: { ...ink, forms: { affinity: { placement: { top: 1 } } } } };
    const moved = drawn.filter(
      (b) =>
        beatSignature(b, direct([...stages, b], leaning).looks[2]) !==
        beatSignature(b, direct([b], leaning).looks[0]),
    );
    expect(moved.map((b) => b.id)).toEqual([]);

    const d = direct(stages, opts);
    expect(d.summary.modalChrome).toBe(0);
    // Two stages with their words in different places are two looks, not one.
    expect(d.beats.map((b) => b.signature)).toEqual([
      "stage:classic@bottom-left",
      "stage:classic@right",
    ]);
    expect(d.summary.distinct).toBe(2);
  });

  it("gives hero-number and kinetic no chrome either: they set their own words", () => {
    const full: Beat[] = [
      {
        id: "hn1",
        archetype: "hero-number",
        intent: "Land it.",
        evidence: [],
        weight: 0.8,
        seconds: 8,
        params: { headline: "A quarter of the energy", value: "43.63", unit: "mJ", label: "ours" },
      },
      {
        id: "kn1",
        archetype: "kinetic",
        intent: "Say it.",
        evidence: [],
        weight: 0.8,
        seconds: 8,
        params: {
          headline: "Spikes stay sparse",
          phrases: [{ text: "Haze lowers contrast", key: "contrast" }, { text: "edges fade" }],
        },
      },
    ] as Beat[];
    const leaning = { ...opts, theme: { ...ink, forms: { affinity: { placement: { top: 1 } } } } };
    expect(direct(full, leaning).summary.modalChrome).toBe(0);
    const drawn = demo.beats.filter((b) => b.archetype !== "title" && b.archetype !== "stage");
    const moved = drawn.filter(
      (b) =>
        beatSignature(b, direct([...full, b], leaning).looks[2]) !==
        beatSignature(b, direct([b], leaning).looks[0]),
    );
    expect(moved.map((b) => b.id)).toEqual([]);
  });

  it("keeps the chrome off the top of all but about half the slides", () => {
    // The 92.7% mode the founder called "always the same" is chrome on top.
    // 0.5 until 2026-10-09; 8 of 15 since a beat may no longer repeat the
    // previous beat's placement: two of the demo's foot/foot pairs now move to
    // the top, the only other place their archetypes offer. Alternating is the
    // less "same" deck of the two.
    expect(direct(demo.beats, opts).summary.modalChrome).toBeLessThanOrEqual(8 / 15);
  });

  it("never sets two neighbours' chrome in the same place when it can move it", () => {
    // ko deck review, 2026-10-09: foot under a rule on b09 then b10, b13 then
    // b14. Only `top` repeats in the demo, and only where an archetype has no
    // other look (annotated-figure, grid, stack, data-table, line-chart).
    const d = direct(demo.beats, opts).beats;
    for (let i = 1; i < d.length; i++) {
      const [a, b] = [d[i - 1], d[i]];
      if (a?.placement === b?.placement)
        expect(`${a?.beat}/${b?.beat}@${b?.placement}`).toMatch(/@top$/);
    }
    expect(
      d.filter((b, i) => i > 0 && b.placement === "foot" && d[i - 1]?.placement === "foot"),
    ).toEqual([]);
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
    // Whatever it picks is not one of those.
    const chosen = real.beats[0]?.signature;
    expect(real.beats[0]?.refused.map((r) => r.signature)).not.toContain(chosen);
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

  it("holds a look's figure to what v0.8.0 drew when that was bigger than v2's classic look", () => {
    // ja s4 (fix-round Tier A, 2026-10-08): v2's classic look already drew the
    // figure smaller than v0.8.0 (its plate is capped at 1.25x), and a rail look
    // at 80% of THAT was 64% of what the founder had seen.
    const b09 = demo.beats.find((b) => b.id === "b09") as Beat;
    const areas = (beat: Beat, ctx: Parameters<typeof emitScene>[1]): Scene => ({
      ...emitScene(beat, ctx),
      figureArea: ctx.design !== "v2" ? 1000 : ctx.look ? 650 : 700,
    });
    const d = direct([b09], { ...opts, design: "v2", emit: areas });
    const reasons = d.beats[0]?.refused.map((r) => r.reason) ?? [];
    expect(reasons.some((r) => /65% of the classic look's area/.test(r))).toBe(true);
    expect(d.beats[0]?.signature).toBe(signature("claim-figure"));
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
    // Then the last part of s2, s3, s4, s8, s13, s14 restores the slide to full
    // instead of dimming its neighbour (only the spotlight tweens move). Then the
    // rows of s14's table share its height and no row is lifted out of line.
    // Then s9's claim stops growing into its strip figure's classic height, so
    // the foot look keeps the figure at 1383x384 (classic draws it 1373x381).
    // Then the 2026-10-09 ko-deck round, re-pinned after reading the demo's
    // hold frames: no beat repeats the previous beat's placement (s3 row@foot
    // → row@top, s14 panels@foot → rows@top), split-compare s13 grows its list
    // and stops its divider at the lists, callout panels centre their content
    // with balanced lines, and the stage headline is balanced.
    expect(sha(emitDeck(demo, source, format, "", { design: "v2" }).composition)).toBe(
      "aea9805f916a64516c51cf04841a66bb2a46d27250fbf38e027433a3e3a61ad1",
    );
  });

  it("is a preference: --design reaches the schema, and is absent unless stated", () => {
    expect(prefsFromFlags({ design: "v2" }).design).toBe("v2");
    // Optional with no default, so a pack written without it carries no new key.
    expect("design" in prefsSchema.parse({})).toBe(false);
    expect(() => prefsSchema.parse({ design: "v3" })).toThrow();
  });
});
