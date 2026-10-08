/**
 * The three motion gates (src/verify/scenes.ts): their graders on numbers, and
 * then each one in the renderer's own browser on a scene built to fail it.
 *
 * The browser half is skipped without Chrome, like test/fill-browser.test.ts.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Fragment } from "../src/bespoke/contract.js";
import type { BespokeMap } from "../src/bespoke/scene.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import type { DeckNarration } from "../src/emit/composition.js";
import { resolveTheme } from "../src/emit/theme.js";
import { stopCount } from "../src/narrate/narrate.js";
import { chromePath, openDeck } from "../src/render/capture.js";
import type { Timing } from "../src/render/timing.js";
import { FORMATS, type Format, sourceSchema, storyboardSchema } from "../src/types.js";
import {
  changedPixels,
  gradeErrors,
  gradeLayout,
  gradeSeekOrder,
  gradeStillCues,
  MIN_CHANGE,
  type Probe,
  probeScenes,
  readTimingFile,
  sceneWindows,
} from "../src/verify/scenes.js";

describe("the graders", () => {
  it("static_hold: a cue that barely changes fails, a short cue is exempt", () => {
    const total = 1920 * 1080;
    const still = gradeStillCues([{ sid: "s3", cue: 1, t0: 4, t1: 9, changed: 40, total }]);
    expect(still.map((f) => f.rule)).toEqual(["static_hold"]);
    expect(still[0]?.severity).toBe("error");
    expect(
      gradeStillCues([
        { sid: "s3", cue: 1, t0: 4, t1: 9, changed: Math.ceil(total * MIN_CHANGE) + 1, total },
      ]),
    ).toEqual([]);
    expect(gradeStillCues([{ sid: "s3", cue: 1, t0: 4, t1: 4.8, changed: 0, total }])).toEqual([]);
  });

  it("graphic_crosses_text and friends: one finding per kind per frame", () => {
    const f = gradeLayout([
      {
        sid: "s2",
        key: "c1z",
        t: 3,
        crossings: ["s2-arc through s2-label"],
        occlusions: [],
        overlaps: [],
        small: [],
        off: [],
      },
      {
        sid: "s2",
        key: "end",
        t: 9,
        crossings: [],
        occlusions: ["s2-box over s2-label"],
        overlaps: ["a × b"],
        small: ["x@30px"],
        off: ["s2-y"],
      },
    ]);
    expect(f.map((x) => x.rule)).toEqual([
      "graphic_crosses_text",
      "graphic_crosses_text",
      "text_overlap",
      "bespoke_type_floor",
      "off_canvas",
    ]);
  });

  it("seek_order: antialiasing is tolerated, a state leak is not", () => {
    expect(
      gradeSeekOrder([{ sid: "s8", key: "c1a", t: 1.5, order: "descending", px: 50 }]),
    ).toEqual([]);
    const f = gradeSeekOrder(
      [{ sid: "s8", key: "c1a", t: 1.5, order: "descending", px: 13958 }],
      "warning",
    );
    expect(f[0]?.rule).toBe("seek_order");
    expect(f[0]?.severity).toBe("warning");
  });

  it("pins a script error to its scene, and a request to every scene probed", () => {
    const named = gradeErrors(
      ["console error: decksmith bespoke #s4: x is not defined"],
      ["s2", "s4"],
    );
    expect(named.map((f) => f.message.slice(0, 3))).toEqual(["#s4"]);
    const loose = gradeErrors(["network request: https://evil.example/"], ["s2", "s4"]);
    expect(loose.map((f) => f.rule)).toEqual(["page_error", "page_error"]);
  });

  it("counts changed pixels across channel layouts", () => {
    const a = {
      width: 2,
      height: 1,
      channels: 4,
      pixels: new Uint8Array([0, 0, 0, 255, 10, 10, 10, 255]),
    };
    const b = {
      width: 2,
      height: 1,
      channels: 3,
      pixels: new Uint8Array([0, 0, 0, 200, 200, 200]),
    };
    expect(changedPixels(a, b)).toBe(1);
  });

  it("reads each scene's cues off the manifest, on the scene's own clock", () => {
    const timing = {
      scenes: [{ id: "s1", start: 10, duration: 8, holds: [1], open: 0.9 }],
      segments: [
        {
          id: "s1.0",
          scene: "s1",
          stop: 0,
          audio: "a",
          hold: 11,
          start: 10.9,
          duration: 5,
          cues: [
            { start: 0.05, end: 2, text: "a" },
            { start: 2, end: 5, text: "b" },
          ],
        },
      ],
    } as unknown as Timing;
    expect(sceneWindows(timing)[0]?.cues).toEqual([
      { t0: 0.95, t1: 2.9, text: "a" },
      { t0: 2.9, t1: 5.9, text: "b" },
    ]);
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

function narrate(): DeckNarration {
  const ink = resolveTheme("ink");
  const beats: DeckNarration["beats"] = {};
  for (const [i, beat] of demo.beats.entries()) {
    const holds = emitScene(beat, {
      source,
      format: deck16,
      theme: ink,
      sid: `s${i + 1}`,
      start: 0,
    }).holds;
    beats[beat.id] = Array.from({ length: stopCount(holds) }, (_, stop) => ({
      stop,
      text: `Sentence ${stop}.`,
      audio: `${beat.id}-${stop}.mp3`,
      seconds: 5,
      cues: [
        { start: 0, end: 2.4, text: "First half," },
        { start: 2.5, end: 5, text: "second half." },
      ],
    }));
  }
  return { voice: "test", dir: "audio", beats };
}

const SVG = (inner: string) =>
  `<svg id="SCENEID-svg" width="1700" height="560" viewBox="0 0 1700 560" style="position:absolute;left:0;top:0">${inner}</svg>`;
const LABEL = `<text id="SCENEID-lab" x="850" y="280" font-size="56" text-anchor="middle" dominant-baseline="middle" fill="#e7f1fb">Encoder output</text>`;

/** Moves through every cue, nothing crosses its label, seekable. */
const GOOD: Fragment = {
  markup: SVG(`${LABEL}<circle id="SCENEID-dot" cx="100" cy="460" r="30" fill="#f7c948"/>`),
  css: "",
  script: `gsap.set("#SCENEID-dot", { attr: { cx: 100 } });
tl.to("#SCENEID-dot", { attr: { cx: 1600 }, duration: 3, repeat: 9, yoyo: true, ease: "none" }, 0.9);`,
};
/** Draws, then holds still. */
const STILL: Fragment = {
  markup: SVG(LABEL),
  css: "",
  script: `gsap.set("#SCENEID-lab", { opacity: 0 });
tl.to("#SCENEID-lab", { opacity: 1, duration: 0.5 }, 1);`,
};
/** A stroke straight through the label — the spike's stray arc, in miniature. */
const CROSSING: Fragment = {
  markup: SVG(
    `${LABEL}<path id="SCENEID-arc" d="M100 280 L1600 280" stroke="#4cc9f0" stroke-width="4"/><circle id="SCENEID-dot" cx="100" cy="460" r="30" fill="#f7c948"/>`,
  ),
  css: "",
  script: GOOD.script,
};
/** The equation-walk bug: a second fromTo on a target, from-state written at build time. */
const ORDERED: Fragment = {
  markup: SVG(`${LABEL}<circle id="SCENEID-dot" cx="100" cy="460" r="30" fill="#f7c948"/>`),
  css: "",
  script: `${GOOD.script}
tl.fromTo("#SCENEID-lab", { opacity: 1 }, { opacity: 0.2, duration: 0.5 }, 2);
tl.fromTo("#SCENEID-lab", { opacity: 0.2 }, { opacity: 1, duration: 0.5 }, 6);`,
};

describe.skipIf(chrome === null)("the gates, in the renderer's browser", () => {
  let dir = "";
  let probe: Probe;
  const sidOf = new Map<string, string>();
  const ids = demo.beats
    .filter((b) =>
      ["pipeline", "stack", "grid", "bar-compare", "split-compare"].includes(b.archetype),
    )
    .map((b) => b.id);
  const assign: Record<string, Fragment> = {
    [ids[0] as string]: GOOD,
    [ids[1] as string]: STILL,
    [ids[2] as string]: CROSSING,
    [ids[3] as string]: ORDERED,
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-gates-"));
    const narration = narrate();
    const bespoke: Record<string, { fragment: Fragment; holds: number[] }> = {};
    for (const [id, fragment] of Object.entries(assign)) {
      const i = demo.beats.findIndex((b) => b.id === id);
      const beat = demo.beats[i] as (typeof demo.beats)[number];
      const holds = emitScene(beat, {
        source,
        format: deck16,
        theme: resolveTheme("ink"),
        sid: `s${i + 1}`,
        start: 0,
      }).holds;
      bespoke[id] = { fragment, holds };
    }
    const built = await buildDeck(demo, source, dir, {
      design: "v2",
      narration,
      theme: "ink",
      assetsFrom: repo("demo"),
      bespoke: bespoke as BespokeMap,
    });
    for (const [i, b] of built.cut.kept.entries()) sidOf.set(b.id, `s${i + 1}`);
    const timing = (await readTimingFile(dir)) as Timing;
    const wanted = new Set(Object.keys(assign).map((id) => sidOf.get(id) as string));
    const errors: string[] = [];
    probe = await probeScenes(sceneWindows(timing, wanted), {
      open: () => openDeck(dir, { watch: errors }),
      errors,
    });
  }, 240_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const rulesFor = (id: string) =>
    probe.findings.filter((f) => f.message.startsWith(`#${sidOf.get(id)}`)).map((f) => f.rule);

  it("passes a scene that keeps moving, keeps clear of its label and seeks cleanly", () => {
    expect(rulesFor(ids[0] as string)).toEqual([]);
  });
  it("fails a scene that holds still over its narration", () => {
    expect(rulesFor(ids[1] as string)).toContain("static_hold");
  });
  it("fails a stroke through a label", () => {
    expect(rulesFor(ids[2] as string)).toContain("graphic_crosses_text");
    expect(rulesFor(ids[2] as string)).not.toContain("static_hold");
  });
  it("fails a frame that depends on seek history", () => {
    expect(rulesFor(ids[3] as string)).toContain("seek_order");
  });
});

describe.skipIf(chrome === null)("seek_order on v2's equation-walk", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it("finds the build-time from-state in classic, and not in v2, where it was fixed", async () => {
    const narration = narrate();
    const walk = demo.beats.findIndex((b) => b.archetype === "equation-walk");
    const found: Record<string, number> = {};
    for (const design of ["classic", "v2"] as const) {
      const dir = await mkdtemp(join(tmpdir(), `decksmith-walk-${design}-`));
      dirs.push(dir);
      const built = await buildDeck(demo, source, dir, {
        design,
        narration,
        theme: "ink",
        assetsFrom: repo("demo"),
      });
      const sid = `s${built.cut.kept.findIndex((b) => b.id === demo.beats[walk]?.id) + 1}`;
      const timing = (await readTimingFile(dir)) as Timing;
      const p = await probeScenes(sceneWindows(timing, new Set([sid])), {
        open: () => openDeck(dir),
        gates: ["seek"],
        sparse: true,
        cold: false,
      });
      // The bug's signature is EARLY: before the take-back runs, a page that has
      // never been past it shows the term swollen. (A 529px difference at a
      // later cue end remains on v2 with emphasis on; see the README.)
      found[design] = p.seek.filter((d) => d.px > 200 && /^c1[sa]$/.test(d.key)).length;
    }
    expect(found.classic).toBeGreaterThan(0);
    expect(found.v2).toBe(0);
  }, 240_000);
});
