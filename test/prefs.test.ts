import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { systemPrompt } from "../src/plan/prompt.js";
import { CONFIG_FILE, loadPrefs, prefsFromFlags } from "../src/prefs.js";
import { prefsSchema, type Source } from "../src/types.js";

const roots: string[] = [];

/** A throwaway project directory, optionally with a config file at its root. */
async function project(config?: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "decksmith-prefs-"));
  roots.push(root);
  if (config !== undefined)
    await writeFile(join(root, CONFIG_FILE), JSON.stringify(config, null, 2));
  return root;
}

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("loadPrefs", () => {
  it("falls back to the schema's defaults when nothing is configured", async () => {
    expect(await loadPrefs({}, await project())).toEqual(prefsSchema.parse({}));
  });

  it("lets the config file beat the defaults and overrides beat the file", async () => {
    const root = await project({ slides: 8, lang: "ko", tone: "punchy" });
    const prefs = await loadPrefs({ tone: "academic" }, root);

    expect(prefs.slides).toBe(8); // file over default
    expect(prefs.lang).toBe("ko"); // file over default
    expect(prefs.tone).toBe("academic"); // override over file
    expect(prefs.density).toBe("normal"); // default, unmentioned by either
  });

  /**
   * The beat count, when nobody names one.
   *
   * `slides` is one of the three knobs the owner asked to hold, so a number the
   * user typed or wrote in the config file is obeyed verbatim even when it cannot
   * flow. What is derived is the case where nobody said anything — and until now
   * that derivation read a clock, which is flat: 48 to 240 seconds all returned
   * twelve, for every document ever ingested.
   */
  it("sizes an unstated beat count to the document, and obeys a stated one verbatim", async () => {
    const root = await project();
    const thin: Source = {
      id: "s",
      title: "t",
      lang: "en",
      sections: [{ id: "a", depth: 1, heading: "h", text: "x".repeat(2_000) }],
      figures: [],
      equations: [],
      tables: [],
    };

    // Nobody said: the document decides, and it is not the schema's twelve.
    expect((await loadPrefs({}, root, thin)).slides).toBe(6);
    // The old path is untouched — no source, a duration, the tempo number.
    expect((await loadPrefs({ duration: 120 }, root)).slides).toBe(12);
    // A flag wins over the document.
    expect((await loadPrefs({ slides: 20 }, root, thin)).slides).toBe(20);
    // So does the config file, which is the same "somebody said" as a flag.
    expect((await loadPrefs({}, await project({ slides: 20 }), thin)).slides).toBe(20);
    // Including when what the user typed IS the schema default: absence is the
    // only thing that means unstated, which is why this runs through `merged`.
    expect((await loadPrefs({ slides: 12 }, root, thin)).slides).toBe(12);
  });

  it("finds the config by walking up from a subdirectory", async () => {
    const root = await project({ theme: "dusk" });
    const deep = join(root, "papers", "draft");
    await mkdir(deep, { recursive: true });

    expect((await loadPrefs({}, deep)).theme).toBe("dusk");
  });

  it("merges the narration block field by field instead of replacing it", async () => {
    const root = await project({ narration: { enabled: true, rate: "+10%" } });
    const prefs = await loadPrefs({ narration: { voice: "en-US-AvaNeural" } }, root);

    expect(prefs.narration).toEqual({
      enabled: true,
      rate: "+10%",
      voice: "en-US-AvaNeural",
      pitch: "+0Hz",
      subtitles: true,
      density: "high",
    });
  });

  it("merges the images block field by field, the same way", async () => {
    const root = await project({ images: { enabled: true, style: "woodcut" } });
    const prefs = await loadPrefs({ images: { max: 2 } }, root);

    expect(prefs.images).toEqual({ enabled: true, provider: "codex", style: "woodcut", max: 2 });
  });

  it("rejects an unknown config key by name, and lists the real ones", async () => {
    const root = await project({ slideCount: 9 });
    await expect(loadPrefs({}, root)).rejects.toThrow(/unknown preference "slideCount"/);
    await expect(loadPrefs({}, root)).rejects.toThrow(/slides/);
  });

  it("rejects an unknown key inside narration by its dotted name", async () => {
    const root = await project({ narration: { speed: "+10%" } });
    await expect(loadPrefs({}, root)).rejects.toThrow(/unknown preference "narration.speed"/);
  });

  it("rejects an unknown key inside images by its dotted name, and a block that is not one", async () => {
    await expect(loadPrefs({}, await project({ images: { size: "big" } }))).rejects.toThrow(
      /unknown preference "images.size".*provider/,
    );
    await expect(loadPrefs({}, await project({ images: true }))).rejects.toThrow(
      /"images" must be an object/,
    );
  });

  it("holds the picture cap to a whole number, naming the field", async () => {
    await expect(loadPrefs({ images: { max: 2.5 } }, await project())).rejects.toThrow(
      /images\.max/,
    );
  });

  it("rejects a value the schema does not allow, naming the file", async () => {
    const root = await project({ tone: "shouty" });
    await expect(loadPrefs({}, root)).rejects.toThrow(new RegExp(CONFIG_FILE));
  });
});

describe("prefsFromFlags", () => {
  it("omits what was not passed, so an unstated flag cannot outrank the file", () => {
    expect(prefsFromFlags({ lang: "ja" })).toEqual({ lang: "ja" });
  });

  it("parses numeric flags and groups the narration ones", () => {
    expect(prefsFromFlags({ slides: "6", speed: "1.5", narrate: true, voice: "v" })).toEqual({
      slides: 6,
      animationSpeed: 1.5,
      narration: { enabled: true, voice: "v" },
    });
  });

  it("refuses a non-numeric slide count", () => {
    expect(() => prefsFromFlags({ slides: "lots" })).toThrow(/--slides expects a number/);
  });

  it("groups the image flags into their block and parses the cap", () => {
    expect(
      prefsFromFlags({ images: true, imageProvider: "svg", imageStyle: "woodcut", imageMax: "2" }),
    ).toEqual({ images: { enabled: true, provider: "svg", style: "woodcut", max: 2 } });
    // One image flag alone must not drag the block's other defaults in over the
    // config file's — the same rule the narration block follows.
    expect(prefsFromFlags({ imageModel: "m" })).toEqual({ images: { model: "m" } });
  });

  it("refuses a non-numeric picture cap by its flag", () => {
    expect(() => prefsFromFlags({ imageMax: "some" })).toThrow(/--image-max expects a number/);
  });
});

describe("systemPrompt", () => {
  it("states the requested slide count, language and tone", () => {
    const prompt = systemPrompt(
      prefsSchema.parse({ slides: 7, lang: "ko", tone: "punchy", density: "sparse" }),
    );

    // "Write 7 beats", not "about 7 beats". Four of the last five real plans came
    // back short of the target — 8, 9, 9 and 10 against 12 — and the prompt was
    // telling them that was fine ("a target to come close to, not a quota to
    // fill").
    expect(prompt).toMatch(/Write 7 beats/);
    // A FLOOR, and the word is load-bearing. It used to say every missing beat
    // was duration the finished video does not use, which stopped being true when
    // `durationPlan` started restriking the budget on the count that actually
    // comes back: a short plan now fills its target with fewer points in it. The
    // cost is real and it is a different cost, so the prompt says the different
    // thing — and `scanBeatCount` reports the miss, because a prompt rule about a
    // count can be met cosmetically like any other.
    expect(prompt).toContain("is a FLOOR");
    // The anti-padding half has to survive, or the cure is worse: RULE 9 exists
    // because a visual repeated to say one more small thing reads as padding.
    expect(prompt).toContain("PADDING");
    // And the escape hatch is gone. "If the source genuinely will not carry N
    // distinct points, say fewer" is permission to return a ceiling, which is
    // exactly what a floor cannot have.
    expect(prompt).not.toContain("say fewer");
    expect(prompt).toContain("Korean (ko)");
    expect(prompt).toMatch(/TONE\s+punchy/);
    expect(prompt).toMatch(/DENSITY\s+sparse/);
    // The chosen register only — the other three would just invite blending.
    expect(prompt).not.toContain("conversational");
  });

  it("keeps the rules that earned their place, and demands narration", () => {
    const prompt = systemPrompt(prefsSchema.parse({}));

    expect(prompt).toContain("NARRATION");
    expect(prompt).toMatch(/ONE SENTENCE PER REVEAL/);
    expect(prompt).toMatch(/as you can see/);
    expect(prompt).toMatch(/complete-sentence claim in sentence case/);
    expect(prompt).toMatch(/must appear in the inventory/);
    expect(prompt).toMatch(/Never make a beat about the source/);
    expect(prompt).toMatch(/Ask what the beat DRAWS/);
  });

  /**
   * The three things the prompt was not asking for, each measured on real runs.
   *
   * A rule that only ships under a preference is a rule most decks never see, and
   * all three of these were shipped that way: the context requirement lived
   * inside a FORMAT block gated on a duration AND a beat under eight seconds, the
   * terminology requirement lived inside the `academic` tone while the DEFAULT is
   * `plain`, and the deck title was ordered copied from the source header.
   */
  it("demands the problem before the mechanism, whatever the preferences", () => {
    // Unconditional: no duration, no short beat, no tone.
    for (const prefs of [
      prefsSchema.parse({}),
      prefsSchema.parse({ duration: 300 }),
      prefsSchema.parse({ duration: 60, tone: "punchy" }),
    ]) {
      const prompt = systemPrompt(prefs);
      expect(prompt).toMatch(/EARN THE MECHANISM FIRST/);
      expect(prompt).toMatch(/what problem exists, who\s+has it, and what it costs them today/);
    }
  });

  it("states the arc once, and the fast-forward block defers to it", () => {
    // The sentence that used to carry it — "the viewer must come away knowing the
    // problem, the idea, what it costs, and what was measured" — was inside the
    // gated block, so it was RULE 6's content stated a second time in the one
    // configuration that saw both. The block keeps its framing and points at the
    // rule instead.
    const ff = systemPrompt(prefsSchema.parse({ duration: 60 }));
    expect(ff).toContain("CONFERENCE FAST-FORWARD TALK");
    expect(ff).not.toContain("must come away knowing");
    expect(ff).toMatch(/RULE 6's arc is what a minute has to deliver/);
    expect(ff.match(/what was measured/g)?.length).toBe(1);
  });

  it("asks for the source's own names in every register, not just the academic one", () => {
    // `plain` is the DEFAULT, and its only line said "state the claim in ordinary
    // words" — which is how the default tone came to mean generic vocabulary.
    const plain = systemPrompt(prefsSchema.parse({}));
    expect(plain).toMatch(/USE THE SOURCE'S OWN WORDS FOR THE THINGS IT NAMES/);
    expect(plain).toMatch(/Define each\s+term the first time it is used/);
    // Plain still means plain SENTENCES, which is the half worth keeping.
    expect(plain).toMatch(/plain SENTENCES, never a plainer word swapped in for a name/);
    // And it is said once, in the rules, not again inside a register.
    for (const tone of ["plain", "academic", "conversational", "punchy"] as const) {
      const prompt = systemPrompt(prefsSchema.parse({ tone }));
      expect(prompt.match(/USE THE SOURCE'S OWN WORDS/g)?.length).toBe(1);
      expect(prompt).not.toContain("keeps the technical vocabulary");
    }
    // The definition must not be smuggled into a headline the 60-character cap
    // then breaks — RULE 5 and this rule have to be satisfiable together.
    expect(plain).toMatch(/short enough\s+to leave the headline inside its character cap/);
  });

  it("orders the deck's own title written, not copied off the source", () => {
    // 52 stored runs produced 1 distinct title, because the prompt said to copy
    // the header. `sourceId` still comes from it — `assertRefsResolve` and the
    // receipts are keyed on that.
    const prompt = systemPrompt(prefsSchema.parse({}));
    expect(prompt).not.toContain("Set sourceId and title from the source header");
    expect(prompt).toMatch(/Set sourceId from the source header/);
    expect(prompt).toMatch(/THE DECK'S `title` IS NOT THE SOURCE'S TITLE/);
    expect(prompt).toMatch(/a viewer who has not\s+read the source/);
  });
});
