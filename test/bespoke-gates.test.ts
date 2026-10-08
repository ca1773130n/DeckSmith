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
import { type BespokeMap, bespokeRegion } from "../src/bespoke/scene.js";
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
  KEY_TYPE_PX,
  MIN_CHANGE,
  type Probe,
  paintedShare,
  probeScenes,
  readTimingFile,
  STAGE_FILL,
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

  it("stage_fill, type_hierarchy and cue_groups grade the settled frame only", () => {
    const row = {
      sid: "s5",
      t: 9,
      crossings: [],
      occlusions: [],
      overlaps: [],
      small: [],
      off: [],
      fill: 0.6,
      maxType: 56,
      groups: [] as number[],
      cueStarts: [1, 4],
    };
    expect(gradeLayout([{ ...row, key: "end" }]).map((f) => f.rule)).toEqual([
      "stage_fill",
      "type_hierarchy",
      "cue_groups",
    ]);
    // The same numbers mid-scene are a build in progress, not a verdict.
    expect(gradeLayout([{ ...row, key: "c1z" }])).toEqual([]);
    expect(
      gradeLayout([{ ...row, key: "end", fill: STAGE_FILL, maxType: KEY_TYPE_PX, groups: [1, 2] }]),
    ).toEqual([]);
    // A group naming a cue the scene does not have.
    expect(
      gradeLayout([{ ...row, key: "end", fill: 0.9, maxType: 80, groups: [1, 3] }]).map(
        (f) => f.rule,
      ),
    ).toEqual(["cue_groups"]);
  });

  it("early_reveal: a cue group showing before its cue fails, inside the 0.5s slack it does not", () => {
    const row = {
      sid: "s5",
      key: "c1z",
      crossings: [],
      occlusions: [],
      overlaps: [],
      small: [],
      off: [],
      cueStarts: [1, 4],
    };
    const shown = [{ id: "s5-second", cue: 2 }];
    expect(gradeLayout([{ ...row, t: 3.0, revealed: shown }]).map((f) => f.rule)).toEqual([
      "early_reveal",
    ]);
    expect(gradeLayout([{ ...row, t: 3.6, revealed: shown }])).toEqual([]);
    expect(gradeLayout([{ ...row, t: 3.0, revealed: [{ id: "s5-first", cue: 1 }] }])).toEqual([]);
  });

  it("stray_marker: one finding per frame that shows an arrowhead without its line", () => {
    const f = gradeLayout([
      {
        sid: "s5",
        key: "c1a",
        t: 1.5,
        crossings: [],
        occlusions: [],
        overlaps: [],
        small: [],
        off: [],
        strays: ["s5-wire (an arrowhead at the end of a line not drawn that far)"],
      },
    ]);
    expect(f.map((x) => x.rule)).toEqual(["stray_marker"]);
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

  it("measures how much of a box a drawing paints, against the same frame without it", () => {
    const px = (vals: number[]) => new Uint8Array(vals);
    // 4x1 frame at 1920/4 scale: the box covers the middle two pixels.
    const shown = {
      width: 4,
      height: 1,
      channels: 3,
      pixels: px([0, 0, 0, 200, 200, 200, 0, 0, 0, 9, 9, 9]),
    };
    const hidden = {
      width: 4,
      height: 1,
      channels: 3,
      pixels: px([0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 9, 9]),
    };
    expect(paintedShare(shown, hidden, { x: 480, y: 0, w: 960, h: 270 })).toBe(0.5);
    expect(paintedShare(hidden, hidden, { x: 0, y: 0, w: 1920, h: 270 })).toBe(0);
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

/**
 * Fixtures sized to the beat's own body box (`bespokeRegion`), because the
 * stage-fill gate measures against it. Corner marks span the box, the label is
 * the scene's one 72px focal element, and every part sits in a cue group.
 */
type Box = { width: number; height: number };
const SVG = (b: Box, inner: string, style = "") =>
  `<svg id="SCENEID-svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}" style="position:absolute;left:0;top:0${style}">${inner}</svg>`;
const LABEL = (b: Box, size = 72) =>
  `<g id="SCENEID-a" data-cue="1"><text id="SCENEID-lab" x="${b.width / 2}" y="${b.height / 2}" font-size="${size}" text-anchor="middle" dominant-baseline="middle" fill="#e7f1fb">Encoder output</text></g>`;
const CORNERS = (b: Box) =>
  `<g id="SCENEID-c" data-cue="1">${[
    [30, 30],
    [b.width - 30, 30],
    [30, b.height - 30],
    [b.width - 30, b.height - 30],
  ]
    .map(([x, y], i) => `<circle id="SCENEID-k${i}" cx="${x}" cy="${y}" r="20" fill="#4cc9f0"/>`)
    .join("")}</g>`;
const DOT = (b: Box) =>
  `<g id="SCENEID-m" data-cue="1"><circle id="SCENEID-dot" cx="100" cy="${b.height - 110}" r="30" fill="#f7c948"/></g>`;
const MOVE = (b: Box) => `gsap.set("#SCENEID-dot", { attr: { cx: 100 } });
tl.to("#SCENEID-dot", { attr: { cx: ${b.width - 100} }, duration: 3, repeat: 9, yoyo: true, ease: "none" }, 0.9);`;

/** Moves through every cue, fills its box, nothing crosses its label, seekable. */
const GOOD = (b: Box): Fragment => ({
  markup: SVG(b, `${LABEL(b)}${CORNERS(b)}${DOT(b)}`),
  css: "",
  script: MOVE(b),
});
/** Draws, then holds still. */
const STILL = (b: Box): Fragment => ({
  markup: SVG(b, `${LABEL(b)}${CORNERS(b)}`),
  css: "",
  script: `gsap.set("#SCENEID-lab", { opacity: 0 });
tl.to("#SCENEID-lab", { opacity: 1, duration: 0.5 }, 1);`,
});
/**
 * A stroke straight through the label — the spike's stray arc, in miniature.
 * The path also runs round the box first, so its bounding box CONTAINS the
 * label: a container is a plate for a fill, never for a stroke through text.
 */
const CROSSING = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `${LABEL(b)}${CORNERS(b)}<g id="SCENEID-x" data-cue="1"><path id="SCENEID-arc" d="M100 60 H${b.width - 100} V${b.height - 60} H100 V${b.height / 2} H${b.width - 100}" fill="none" stroke="#4cc9f0" stroke-width="4"/></g>${DOT(b)}`,
  ),
  css: "",
  script: MOVE(b),
});
/** The equation-walk bug: a second fromTo on a target, from-state written at build time. */
const ORDERED = (b: Box): Fragment => ({
  markup: GOOD(b).markup,
  css: "",
  script: `${MOVE(b)}
tl.fromTo("#SCENEID-lab", { opacity: 1 }, { opacity: 0.2, duration: 0.5 }, 2);
tl.fromTo("#SCENEID-lab", { opacity: 0.2 }, { opacity: 1, duration: 0.5 }, 6);`,
});
/** Round 1's look: a 48px label and a moving dot huddled in the top-left of the box. */
const SMALL = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `<g id="SCENEID-a" data-cue="1"><text id="SCENEID-lab" x="300" y="80" font-size="48" text-anchor="middle" dominant-baseline="middle" fill="#e7f1fb">Encoder</text></g><g id="SCENEID-m" data-cue="1"><circle id="SCENEID-dot" cx="100" cy="200" r="24" fill="#f7c948"/></g>`,
  ),
  css: "",
  script: `gsap.set("#SCENEID-dot", { attr: { cx: 100 } });
tl.to("#SCENEID-dot", { attr: { cx: 500 }, duration: 3, repeat: 9, yoyo: true, ease: "none" }, 0.9);`,
});
/** An arrow drawn late with a marker: its head shows from the start, where no line is yet. */
const STRAY = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `<defs><marker id="SCENEID-head" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#4cc9f0"/></marker></defs>${LABEL(b)}${CORNERS(b)}${DOT(b)}<g id="SCENEID-w" data-cue="1"><path id="SCENEID-wire" d="M120 140 L${b.width - 120} 140" fill="none" stroke="#4cc9f0" stroke-width="5" marker-end="url(#SCENEID-head)"/></g>`,
  ),
  css: "",
  script: `${MOVE(b)}
gsap.set("#SCENEID-wire", { drawSVG: "0% 0%" });
tl.to("#SCENEID-wire", { drawSVG: "0% 100%", duration: 1, ease: "none" }, 7);`,
});
/** A group tagged for cue 2 that is on screen from the first frame. */
const EARLY = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `${LABEL(b)}${CORNERS(b)}${DOT(b)}<g id="SCENEID-late" data-cue="2"><rect id="SCENEID-tag" x="${b.width - 400}" y="${b.height - 200}" width="240" height="80" fill="#f7c948"/></g>`,
  ),
  css: "",
  script: MOVE(b),
});

describe.skipIf(chrome === null)("the gates, in the renderer's browser", () => {
  let dir = "";
  let probe: Probe;
  const sidOf = new Map<string, string>();
  const ids = demo.beats
    .filter((b) =>
      [
        "pipeline",
        "stack",
        "grid",
        "bar-compare",
        "split-compare",
        "line-chart",
        "annotated-figure",
      ].includes(b.archetype),
    )
    .map((b) => b.id);
  const fixtures = { GOOD, STILL, CROSSING, ORDERED, SMALL, STRAY, EARLY };
  const idOf = Object.fromEntries(Object.keys(fixtures).map((k, i) => [k, ids[i] as string]));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-gates-"));
    const narration = narrate();
    const bespoke: Record<string, { fragment: Fragment; holds: number[] }> = {};
    for (const [name, make] of Object.entries(fixtures)) {
      const id = idOf[name] as string;
      const i = demo.beats.findIndex((b) => b.id === id);
      const beat = demo.beats[i] as (typeof demo.beats)[number];
      const ink = resolveTheme("ink");
      const holds = emitScene(beat, {
        source,
        format: deck16,
        theme: ink,
        sid: `s${i + 1}`,
        start: 0,
      }).holds;
      bespoke[id] = { fragment: make(bespokeRegion(beat, { format: deck16, theme: ink })), holds };
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
    const wanted = new Set(Object.values(idOf).map((id) => sidOf.get(id) as string));
    const errors: string[] = [];
    probe = await probeScenes(sceneWindows(timing, wanted), {
      open: () => openDeck(dir, { watch: errors }),
      errors,
    });
  }, 300_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const rulesFor = (name: keyof typeof fixtures) =>
    probe.findings
      .filter((f) => f.message.startsWith(`#${sidOf.get(idOf[name] as string)}`))
      .map((f) => f.rule);

  it("passes a scene that keeps moving, fills its box, keeps clear of its label and seeks cleanly", () => {
    expect(rulesFor("GOOD")).toEqual([]);
  });
  it("measures what each scene paints at its settled frame, and leaves the page as it found it", () => {
    const mass = (name: keyof typeof fixtures) =>
      probe.layout.find((l) => l.sid === sidOf.get(idOf[name] as string) && l.key === "end")
        ?.mass ?? -1;
    expect(mass("GOOD")).toBeGreaterThan(0);
    expect(mass("SMALL")).toBeLessThan(mass("GOOD"));
    // Hiding the body to measure it must not leak into the seeks after it.
    expect(rulesFor("GOOD")).not.toContain("seek_order");
  });
  it("fails a scene that holds still over its narration", () => {
    expect(rulesFor("STILL")).toContain("static_hold");
  });
  it("fails a stroke through a label", () => {
    expect(rulesFor("CROSSING")).toContain("graphic_crosses_text");
    expect(rulesFor("CROSSING")).not.toContain("static_hold");
  });
  it("fails a frame that depends on seek history", () => {
    expect(rulesFor("ORDERED")).toContain("seek_order");
  });
  it("fails a small drawing in a corner of its box, with no label that reads first", () => {
    expect(rulesFor("SMALL")).toEqual(expect.arrayContaining(["stage_fill", "type_hierarchy"]));
  });
  it("fails an arrowhead shown before its line is drawn, and only that", () => {
    expect(new Set(rulesFor("STRAY"))).toEqual(new Set(["stray_marker"]));
  });
  it("fails a cue-2 group on screen during cue 1, and only that", () => {
    expect(new Set(rulesFor("EARLY"))).toEqual(new Set(["early_reveal"]));
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
