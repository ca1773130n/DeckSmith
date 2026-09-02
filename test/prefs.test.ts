import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { systemPrompt } from "../src/plan/prompt.js";
import { CONFIG_FILE, loadPrefs, prefsFromFlags } from "../src/prefs.js";
import { prefsSchema } from "../src/types.js";

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

    expect(prefs.images).toEqual({ enabled: true, provider: "auto", style: "woodcut", max: 2 });
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
});
