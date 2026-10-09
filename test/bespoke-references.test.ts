/**
 * The reference scenes (src/bespoke/references.ts) are the bar every generated
 * scene is shown and held to — so each must pass the static contract, every
 * browser gate, and the rubric probe, in a real deck, timed to its own cues.
 * A reference that stops passing stops being a reference.
 *
 * The browser half is skipped without Chrome, like test/bespoke-gates.test.ts.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArtRef } from "../src/bespoke/art.js";
import { checkFragment, motionKinds } from "../src/bespoke/contract.js";
import { rubricProbe } from "../src/bespoke/pipeline.js";
import { generatePrompt } from "../src/bespoke/prompt.js";
import {
  paint,
  pickReferences,
  placesArt,
  REFERENCE_BOX,
  REFERENCES,
} from "../src/bespoke/references.js";
import type { BespokeEntry, BespokeMap } from "../src/bespoke/scene.js";
import { unitsInPicture } from "../src/bespoke/shots.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import { bespokeStaging, type DeckNarration } from "../src/emit/composition.js";
import { resolveTheme } from "../src/emit/theme.js";
import { stopCount } from "../src/narrate/narrate.js";
import { chromePath, openDeck } from "../src/render/capture.js";
import type { Timing } from "../src/render/timing.js";
import { FORMATS, type Format, sourceSchema, storyboardSchema } from "../src/types.js";
import { type Probe, probeScenes, readTimingFile, sceneWindows } from "../src/verify/scenes.js";
import { testPng } from "./fixtures/png.js";

const ink = resolveTheme("ink");

describe("the references, statically", () => {
  it("each keeps the contract once painted, and asks for three or more kinds of motion", () => {
    for (const r of REFERENCES) {
      expect(checkFragment(r.fragment, { art: placesArt(r) }), r.name).toEqual([]);
      const painted = paint(r.fragment, ink);
      expect(`${painted.markup}${painted.script}`, r.name).not.toMatch(/\{\{\w+\}\}/);
      const kinds = motionKinds(r.fragment.script);
      expect(kinds.length, r.name).toBeGreaterThanOrEqual(3);
      expect(
        kinds.some((k) => ["flow", "camera", "counter", "morph"].includes(k)),
        r.name,
      ).toBe(true);
    }
  });

  it("between them, show every verb the prompt names", () => {
    const all = new Set(REFERENCES.flatMap((r) => motionKinds(r.fragment.script)));
    for (const k of ["flow", "camera", "counter", "morph", "stagger", "draw", "focus"])
      expect(all.has(k as never), k).toBe(true);
  });

  it("a beat is shown two different ones, best fit first, in the deck's palette", () => {
    const two = pickReferences("bar-compare");
    expect(two.map((r) => r.name)).toEqual(["growth", "gather"]);
    expect(new Set(pickReferences("pipeline").map((r) => r.name)).size).toBe(2);
    const prompt = generatePrompt({
      lang: "en",
      headline: "h",
      intent: "i",
      archetype: "bar-compare",
      params: {},
      context: "",
      cues: [{ t0: 1, t1: 3, text: "a" }],
      duration: 6,
      region: { width: 1700, height: 658 },
      theme: ink,
      pack: "ink",
      device: "growth-curve",
    });
    expect(prompt).toContain('Reference 1: "growth"');
    expect(prompt).toContain(ink.accent);
    expect(prompt).not.toMatch(/\{\{\w+\}\}/);
  });

  it("a beat with an illustration is shown the illustrated one first, and told how to place it", () => {
    expect(pickReferences("bar-compare", 2, true).map((r) => r.name)).toEqual([
      "illustrated",
      "growth",
    ]);
    // Never to a beat without a picture: its scene could not keep the contract.
    for (const a of ["pipeline", "stack", "bar-compare", "split-compare", "nothing"])
      expect(pickReferences(a).some(placesArt)).toBe(false);
    const prompt = generatePrompt({
      lang: "en",
      headline: "h",
      intent: "i",
      archetype: "bar-compare",
      params: {},
      context: "",
      cues: [{ t0: 1, t1: 3, text: "a" }],
      duration: 6,
      region: { width: 1700, height: 658 },
      theme: ink,
      pack: "ink",
      device: "growth-curve",
      art: { depicts: "a robot at a table", width: 1536, height: 1024 },
    });
    expect(prompt).toContain("THE ILLUSTRATION (attached image)");
    expect(prompt).toContain('data-art="1"');
    expect(prompt).toContain("#SCENEID-cam");
  });
});

/* -------------------------------------------------------------- the browser */

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const chrome = await chromePath("probe scenes with").catch(() => null);
const demo = storyboardSchema.parse(
  JSON.parse(await readFile(repo("demo/storyboard.json"), "utf8")),
);
const source = sourceSchema.parse(JSON.parse(await readFile(repo("demo/source.json"), "utf8")));
const deck16 = FORMATS["deck-16x9"] as Format;
// dist/, because a built deck needs dist/deck-runtime.js (`npm run build`), as in test/deck-motion.test.ts.
const buildDeck = async (...args: Parameters<typeof import("../src/index.js").buildDeck>) =>
  ((await import(repo("dist/index.js"))) as typeof import("../src/index.js")).buildDeck(...args);

/** Which demo beat each reference stands in for: one of the archetypes it fits. */
const SLOT: Record<string, string> = {
  route: "b03",
  zoom: "b08",
  growth: "b10",
  gather: "b13",
  illustrated: "b09",
};

describe.skipIf(chrome === null)("the references, in the renderer's browser", () => {
  let dir = "";
  let probe: Probe;
  const sidOf = new Map<string, string>();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-refs-"));
    const artFile = join(dir, "source-art.png");
    const png = testPng(768, 432);
    await writeFile(artFile, png);
    const art: ArtRef = {
      key: "test",
      name: "test.png",
      file: artFile,
      width: 768,
      height: 432,
      depicts: "three discs",
      // The illustrated reference's own subjects, as shares of this picture placed
      // under the reference box's label band (\`slice\`): the reference is a layout for them.
      subjects: unitsInPicture(
        REFERENCES.find((r) => r.name === "illustrated")?.subjects ?? [],
        { width: 768, height: 432 },
        REFERENCE_BOX,
      ),
    };
    const beats: DeckNarration["beats"] = {};
    const bespoke: Record<string, BespokeEntry> = {};
    for (const [i, beat] of demo.beats.entries()) {
      const ctx = { source, format: deck16, theme: ink, sid: `s${i + 1}`, start: 0 };
      const n = stopCount(emitScene(beat, ctx).holds);
      const ref = REFERENCES.find((r) => SLOT[r.name] === beat.id);
      if (!ref) {
        beats[beat.id] = Array.from({ length: n }, (_, stop) => ({
          stop,
          text: "Sentence.",
          audio: `${beat.id}-${stop}.mp3`,
          seconds: 3,
          cues: [{ start: 0, end: 3, text: "Sentence." }],
        }));
        continue;
      }
      // The whole reference is spoken over the first stop, its cues placed so
      // the scene's own clock reads the reference's cue times exactly.
      const v2 = { ...ctx, design: "v2" as const };
      const { open } = bespokeStaging(beat, v2, [], 1);
      const last = (ref.cues[ref.cues.length - 1] as { t1: number }).t1;
      const segments = [
        {
          stop: 0,
          text: ref.cues.map((c) => c.text).join(" "),
          audio: `${beat.id}-0.mp3`,
          seconds: last - open,
          cues: ref.cues.map((c) => ({
            start: +(c.t0 - open).toFixed(3),
            end: +(c.t1 - open).toFixed(3),
            text: c.text,
          })),
        },
        ...Array.from({ length: n - 1 }, (_, k) => ({
          stop: k + 1,
          text: "",
          audio: `${beat.id}-${k + 1}.mp3`,
          seconds: 0.2,
          cues: [],
        })),
      ];
      beats[beat.id] = segments;
      bespoke[beat.id] = {
        fragment: paint(ref.fragment, ink),
        holds: bespokeStaging(beat, v2, segments, 1).holds,
        ...(placesArt(ref)
          ? {
              art,
              stage: {
                cues: ref.cues.map((c) => ({ t0: c.t0, t1: c.t1 })),
                duration: ref.duration,
              },
            }
          : {}),
      };
    }
    const built = await buildDeck(demo, source, dir, {
      design: "v2",
      narration: { voice: "test", dir: "audio", beats },
      theme: "ink",
      assetsFrom: repo("demo"),
      bespoke: bespoke as BespokeMap,
    });
    for (const [i, b] of built.cut.kept.entries()) sidOf.set(b.id, `s${i + 1}`);
    const timing = (await readTimingFile(dir)) as Timing;
    const wanted = new Set(Object.values(SLOT).map((id) => sidOf.get(id) as string));
    const errors: string[] = [];
    probe = await probeScenes(sceneWindows(timing, wanted), {
      open: () => openDeck(dir, { watch: errors }),
      errors,
      // As the bespoke pass probes: with geometry, so the end-state gates run too.
      geometry: true,
    });
  }, 300_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  for (const r of REFERENCES) {
    it(`"${r.name}" passes every gate and the rubric probe`, () => {
      const sid = sidOf.get(SLOT[r.name] as string) as string;
      const mine = probe.findings.filter((f) => f.message.startsWith(`#${sid}`));
      expect(mine.map((f) => `${f.rule}: ${f.message}`)).toEqual([]);
      const end = probe.layout.find((l) => l.sid === sid && l.key === "end");
      expect(end?.fill ?? 0).toBeGreaterThanOrEqual(0.85);
      expect(end?.mass ?? 0).toBeGreaterThanOrEqual(0.12);
      const cueChange = probe.cueChanges
        .filter((c) => c.sid === sid)
        .map((c) => c.changed / c.total);
      expect(cueChange.length).toBe(r.cues.length);
      expect(
        rubricProbe(
          {
            ...(end?.fill !== undefined ? { fill: end.fill } : {}),
            ...(end?.cells !== undefined ? { cells: end.cells } : {}),
            ...(end?.maxType !== undefined ? { maxType: end.maxType } : {}),
            ...(end?.mass !== undefined ? { mass: end.mass } : {}),
            ...(end?.dimmed !== undefined ? { dimmed: end.dimmed } : {}),
            kinds: motionKinds(r.fragment.script),
            cueChange,
          },
          [],
          placesArt(r),
        ),
      ).toEqual([]);
    });
  }
});
