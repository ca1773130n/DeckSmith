/**
 * The paper arc — the shape a research-talk deck is asked for, and the three
 * places that shape is honoured.
 *
 * Every assertion here is about something the corpus says the planner does NOT
 * do on its own: zero of fifteen committed full-deck plans carry two closing
 * beats, and the limitations beat sits at n-1 where nothing protected it.
 */
import { describe, expect, it } from "vitest";
import { arcProblems, paperArcRequested, requiredRoles } from "../src/plan/arc.js";
import { SCHEMA, schemaFor } from "../src/plan/codex.js";
import { systemPrompt } from "../src/plan/prompt.js";
import { selectBeats } from "../src/plan/select.js";
import type { Beat, BeatRole, Storyboard } from "../src/types.js";
import { prefsSchema, storyboardSchema } from "../src/types.js";
import { scanPaperArc } from "../src/verify/index.js";

const paper = prefsSchema.parse({ genre: "paper" });
const general = prefsSchema.parse({});

const beat = (id: string, archetype: string, over: Partial<Beat> = {}): Beat =>
  ({
    id,
    intent: "i",
    evidence: [],
    weight: 0.8,
    seconds: 9,
    archetype,
    params:
      archetype === "callout"
        ? { headline: "H", panels: [{ label: "p", lines: ["l"] }] }
        : { headline: "H", eyebrow: "E", sub: "s" },
    ...over,
  }) as unknown as Beat;

/** A deck that satisfies the arc: intro, background, …body…, limitations, conclusion. */
const shaped = (
  over: { roles?: Partial<Record<number, BeatRole>>; n?: number } = {},
): Storyboard => {
  const n = over.n ?? 9;
  const beats = Array.from({ length: n }, (_, i) =>
    beat(`b${i + 1}`, i % 2 === 0 ? "title" : "callout"),
  );
  const roles: Partial<Record<number, BeatRole>> = {
    0: "intro",
    1: "background",
    [n - 2]: "limitations",
    [n - 1]: "conclusion",
    ...over.roles,
  };
  for (const [i, role] of Object.entries(roles)) {
    const b = beats[Number(i)];
    if (b && role) (b as { role?: BeatRole }).role = role;
  }
  // The closing pair must not share an archetype — the deck under test is a
  // GOOD deck, so it gets that right and the collision is asserted separately.
  const lim = beats[n - 2];
  const con = beats[n - 1];
  if (lim && con && lim.archetype === con.archetype)
    (con as { archetype: string }).archetype = lim.archetype === "callout" ? "title" : "callout";
  return { sourceId: "s", title: "t", lang: "en", theme: "ink", beats } as Storyboard;
};

describe("the arc is asked for, never sniffed", () => {
  it("is off unless the author declared it", () => {
    expect(paperArcRequested(general)).toBe(false);
    expect(paperArcRequested(paper)).toBe(true);
    // The whole feature is silent on a general deck, however broken its shape.
    const wrong = shaped();
    for (const b of wrong.beats) (b as { role?: BeatRole }).role = undefined;
    expect(arcProblems(wrong, general)).toEqual([]);
    expect(scanPaperArc(wrong, general)).toEqual([]);
  });

  it("scales what it demands to what the deck can hold", () => {
    // Four reserved slides out of five is a table of contents, not a deck.
    expect(requiredRoles(12)).toEqual(["intro", "background", "limitations", "conclusion"]);
    expect(requiredRoles(8)).toEqual(["intro", "background", "limitations", "conclusion"]);
    expect(requiredRoles(6)).toEqual(["limitations", "conclusion"]);
    expect(requiredRoles(4)).toEqual([]);
  });

  it("says nothing about a deck too short to carry a shape", () => {
    const tiny = shaped({ n: 4 });
    expect(arcProblems(tiny, paper)).toEqual([]);
  });
});

describe("what the arc refuses", () => {
  it("accepts a deck that has the shape", () => {
    expect(arcProblems(shaped(), paper)).toEqual([]);
  });

  it("names a role the plan never wrote", () => {
    const s = shaped();
    (s.beats[1] as { role?: BeatRole }).role = undefined;
    expect(arcProblems(s, paper).join(" ")).toMatch(/No beat carries role "background"/);
  });

  it("refuses a deck that does not END on its conclusion", () => {
    // The half of the request no committed plan has produced on its own: the
    // conclusion exists but something follows it.
    const s = shaped();
    s.beats.push(beat("bTail", "callout"));
    const said = arcProblems(s, paper).join(" ");
    expect(said).toMatch(/ends on "bTail"/);
    expect(said).toMatch(/not on its conclusion/);
  });

  it("refuses a background beat buried in the middle of the deck", () => {
    const s = shaped();
    (s.beats[1] as { role?: BeatRole }).role = undefined;
    (s.beats[4] as { role?: BeatRole }).role = "background";
    expect(arcProblems(s, paper).join(" ")).toMatch(/not in the first three slides/);
  });

  it("refuses a closing pair that is two of the same picture", () => {
    const s = shaped();
    const n = s.beats.length;
    (s.beats[n - 1] as { archetype: string }).archetype = (
      s.beats[n - 2] as { archetype: string }
    ).archetype;
    expect(arcProblems(s, paper).join(" ")).toMatch(/both `\w+`.*RULE 1/s);
  });

  it("refuses one job claimed by two slides", () => {
    const s = shaped();
    (s.beats[4] as { role?: BeatRole }).role = "conclusion";
    expect(arcProblems(s, paper).join(" ")).toMatch(/2 beats carry role "conclusion"/);
  });

  it("reports as a warning on the storyboard gate, never as an error", () => {
    const s = shaped();
    (s.beats[1] as { role?: BeatRole }).role = undefined;
    const found = scanPaperArc(s, paper);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(f.severity).toBe("warning");
      expect(f.gate).toBe("storyboard");
      expect(f.rule).toBe("paper_arc");
    }
  });
});

/**
 * Every case below was found by an adversarial review of the first cut of this
 * feature, reproduced against the built artifact, and survived a second agent
 * trying to refute it. They are the defects, not hypotheticals.
 */
describe("what the review caught", () => {
  it("does not claim the pair is broken when the pair is intact", () => {
    // A trailing slide after the conclusion. The ending IS wrong — something
    // follows the conclusion — but limitations still immediately precedes it.
    // Keying adjacency to index n-2 reported BOTH, one of them false, and
    // acting on the false one (swapping the two roles) silenced it while
    // putting the takeaway before the caveat. A gate that rewards the harmful
    // edit is worse than no gate.
    const s = shaped();
    s.beats.push(beat("bTail", "callout"));
    const said = arcProblems(s, paper);
    expect(said.join(" ")).toMatch(/ends on "bTail"/);
    expect(said.join(" ")).not.toMatch(/immediately before the conclusion/);
  });

  it("still catches a genuinely unpaired ending", () => {
    const s = shaped();
    const n = s.beats.length;
    (s.beats[n - 2] as { role?: BeatRole }).role = undefined;
    (s.beats[0] as { role?: BeatRole }).role = "limitations";
    expect(arcProblems(s, paper).join(" ")).toMatch(/immediately before the conclusion/);
  });

  it("never demands a role the prompt did not ask for", () => {
    // `--slides 5` takes the prompt's short branch, which names only the
    // ending. The floor is not a ceiling, so a nine-beat plan carrying exactly
    // those two roles is obedient — and grading it against the four-role tier
    // is a bound the model was never shown.
    const short = prefsSchema.parse({ genre: "paper", slides: 5 });
    const s = shaped({ n: 9 });
    (s.beats[0] as { role?: BeatRole }).role = undefined;
    (s.beats[1] as { role?: BeatRole }).role = undefined;
    expect(arcProblems(s, short)).toEqual([]);
    // The prompt and the scan read one table, so what was asked for matches.
    expect(systemPrompt(short)).not.toContain('role: "background"');
  });

  it("keeps the ends when a pin makes the optimiser infeasible", () => {
    // A role beat diving into an expensive container states a requirement the
    // DP cannot satisfy on its own. The fallback used to retry with NO
    // protections, which surrendered the terminals too and could return a
    // one-beat deck — against a docstring promising "the ends are never
    // released".
    const s = shaped({ n: 9 });
    s.beats.forEach((b) => {
      (b as { seconds: number }).seconds = 20;
      (b as { weight: number }).weight = 0.8;
    });
    const lim = s.beats[7] as { inside?: unknown; seconds: number };
    lim.inside = { beat: s.beats[6]?.id, element: "stage1" };
    (s.beats[6] as { seconds: number }).seconds = 60;
    const cut = selectBeats(s, { id: "t", minWeight: 0, maxSeconds: 70 });
    expect(cut.kept.length).toBeGreaterThan(0);
    // Whatever else it gave up, the deck still opens and closes where it should.
    expect(cut.kept[0]?.id).toBe(s.beats[0]?.id);
    expect(cut.kept[cut.kept.length - 1]?.id).toBe(s.beats[s.beats.length - 1]?.id);
  });
});

describe("the planner is only ever shown what it may return", () => {
  it("hides `role` from a general-genre schema, and the default schema is unchanged", () => {
    const generalSchemaJson = JSON.stringify(schemaFor(general));
    expect(generalSchemaJson).not.toContain('"role"');
    // `SCHEMA` is the exported default-prefs schema; it must stay identical.
    expect(JSON.stringify(SCHEMA)).toBe(generalSchemaJson);
  });

  it("shows `role` as an enum when the arc was asked for", () => {
    const json = JSON.stringify(schemaFor(paper));
    expect(json).toContain('"role"');
    // AN ENUM, WHICH IS THE WHOLE REASON THIS IS SAFE. `forStructuredOutput`
    // strips numeric and length bounds — that is how `tilt` came to be required
    // as an unbounded number `safeParse` then rejected, discarding whole runs —
    // but it does not strip `enum`, so the model sees exactly the four values
    // the schema will accept.
    expect(json).toMatch(/"enum":\["intro","background","limitations","conclusion"\]/);
  });

  it("still parses a plan that carries a role", () => {
    const s = shaped();
    expect(storyboardSchema.safeParse(s).success).toBe(true);
  });
});

describe("the prompt asks for the arc, and only when asked", () => {
  it("leaves a general prompt byte-identical", () => {
    expect(systemPrompt(general)).toBe(systemPrompt(prefsSchema.parse({ genre: "general" })));
    expect(systemPrompt(general)).not.toContain("PAPER ARC");
  });

  it("names all four jobs, and the positions the ending must hold", () => {
    const text = systemPrompt(paper);
    expect(text).toContain("PAPER ARC");
    for (const role of ["intro", "background", "limitations", "conclusion"])
      expect(text).toContain(`role: "${role}"`);
    expect(text).toContain("THE SECOND-TO-LAST beat");
    expect(text).toContain("THE LAST beat");
  });

  it("asks only for the ending when the deck is short", () => {
    const short = systemPrompt(prefsSchema.parse({ genre: "paper", slides: 5 }));
    expect(short).toContain("only the ENDING is required");
    expect(short).not.toContain('role: "background"');
  });

  it("does not restate what RULE 6 owns, or trip the archetype counters", () => {
    const text = systemPrompt(paper);
    // Tripwires the existing suite pins: one "what was measured" (RULE 6 owns
    // it) and one "The tell:" per archetype.
    expect(text.match(/what was measured/g)?.length ?? 0).toBe(1);
    // `\s+`, not a space: the catalogue wraps, so four of the thirteen read
    // "The\n tell:". This is the same regex test/prompt.test.ts uses.
    expect(text.match(/The\s+tell:/g)?.length).toBe(13);
  });
});

describe("the cut does not delete a beat that carries a role", () => {
  /** Nine beats at 20s each; a cap that forces roughly half of them out. */
  const board = (): Storyboard => {
    const s = shaped({ n: 9 });
    s.beats.forEach((b, i) => {
      (b as { seconds: number }).seconds = 20;
      // The limitations beat is the deck's lowest-weighted, which is exactly
      // the shape the note in select.ts says a threshold reaches for first.
      (b as { weight: number }).weight = b.role === "limitations" ? 0.4 : 0.9 - i * 0.01;
    });
    return s;
  };

  it("keeps the limitations beat at n-1, which used to be dropped", () => {
    const s = board();
    const cut = selectBeats(s, { id: "t", minWeight: 0, maxSeconds: 100 });
    const kept = cut.kept.map((b) => b.id);
    const limitations = s.beats.find((b) => b.role === "limitations");
    expect(limitations).toBeDefined();
    expect(kept).toContain(limitations?.id);
    // And the deck still ends on its conclusion.
    expect(cut.kept[cut.kept.length - 1]?.role).toBe("conclusion");
  });

  it("drops a roleless beat of the same weight in its place", () => {
    // The protection has to COST something, or it is not doing anything: an
    // unroled beat weighted the same as the limitations beat is released first.
    const s = board();
    const filler = s.beats[4] as { weight: number; role?: BeatRole };
    filler.weight = 0.4;
    const cut = selectBeats(s, { id: "t", minWeight: 0, maxSeconds: 100 });
    const kept = new Set(cut.kept.map((b) => b.id));
    expect(kept.has(s.beats[s.beats.length - 2]?.id as string)).toBe(true);
    expect(kept.has(s.beats[4]?.id as string)).toBe(false);
  });
});
