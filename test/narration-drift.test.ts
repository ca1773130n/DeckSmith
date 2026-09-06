/**
 * Narration that belongs to a different version of the storyboard.
 *
 * This was found in the SHIPPED demo, not hypothesised: a thirteenth beat was
 * inserted at position six and the beats after it renumbered, while the audio on
 * disk still mapped the old ids. Beats six through twelve each spoke the slide
 * after them, the thirteenth spoke nothing, and `build` printed
 * `PASS — 0 error(s), 0 warning(s)`.
 */
import { describe, expect, it } from "vitest";
import type { Storyboard } from "../src/types.js";
import { scanNarrationDrift } from "../src/verify/index.js";

const beat = (id: string, narration?: string) =>
  ({
    id,
    intent: "i",
    evidence: [],
    weight: 0.8,
    seconds: 9,
    archetype: "title",
    params: { headline: "H", eyebrow: "E", sub: "s" },
    ...(narration === undefined ? {} : { narration }),
  }) as unknown as Storyboard["beats"][number];

const board = (...beats: Storyboard["beats"]): Storyboard =>
  ({ sourceId: "s", title: "t", lang: "en", theme: "ink", beats }) as Storyboard;

const said = (text: string) => [{ text }];

describe("scanNarrationDrift", () => {
  it("says nothing when the audio says what the beat says", () => {
    const sb = board(beat("b1", "One sentence. And a second."), beat("b2", "Another beat."));
    const narration = {
      // The splitter cuts at stop boundaries and the concatenation is rejoined
      // with a space, which is why whitespace is normalised rather than compared.
      beats: {
        b1: [{ text: "One sentence." }, { text: "And a second." }],
        b2: said("Another beat."),
      },
    };
    expect(scanNarrationDrift(sb, narration)).toEqual([]);
  });

  it("catches the renumbering that shipped: every id present, every voice one slide late", () => {
    const sb = board(
      beat("b1", "The opening."),
      beat("b2", "The new middle beat."),
      beat("b3", "The old middle beat."),
    );
    // Audio recorded BEFORE b2 was inserted: b2 still holds what is now b3's line.
    const narration = { beats: { b1: said("The opening."), b2: said("The old middle beat.") } };
    const found = scanNarrationDrift(sb, narration);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("b2");
    expect(found[0]?.message).toMatch(/does not say what 1 beat\(s\) say they say/);
  });

  it("is an error, because the artifact it lets through speaks over the wrong pictures", () => {
    const sb = board(beat("b1", "What the beat says."));
    const found = scanNarrationDrift(sb, { beats: { b1: said("Something else entirely.") } });
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.gate).toBe("storyboard");
    expect(found[0]?.rule).toBe("narration_drift");
  });

  it("names re-narrating, and says why it is cheap", () => {
    const sb = board(beat("b1", "What the beat says."));
    const message = scanNarrationDrift(sb, { beats: { b1: said("Stale.") } })[0]?.message ?? "";
    expect(message).toContain("decksmith narrate");
    expect(message).toMatch(/keyed by TEXT/);
  });

  it("stays silent on a beat that was deliberately left unspoken", () => {
    // A lower narration density leaves beats without segments on purpose, and a
    // missing recording is the existing error's case, not this one's.
    const sb = board(beat("b1", "Spoken."), beat("b2", "Not recorded."), beat("b3"));
    const narration = { beats: { b1: said("Spoken."), b3: said("orphaned audio") } };
    expect(scanNarrationDrift(sb, narration)).toEqual([]);
  });

  it("lists every drifted beat in one finding, not one finding each", () => {
    const sb = board(beat("b1", "One."), beat("b2", "Two."), beat("b3", "Three."));
    const narration = {
      beats: { b1: said("One."), b2: said("Wrong."), b3: said("Also wrong.") },
    };
    const found = scanNarrationDrift(sb, narration);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain("b2, b3");
    expect(found[0]?.message).not.toContain("b1,");
  });
});
