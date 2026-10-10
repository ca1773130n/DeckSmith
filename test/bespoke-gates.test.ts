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
  ANCHOR_OVERLAP,
  ANCHOR_PX,
  type CamSample,
  type CutSample,
  changedArea,
  changedPixels,
  gradeCuts,
  gradeErrors,
  gradeLayout,
  gradeMorphs,
  gradeSeekOrder,
  gradeShots,
  gradeStillCues,
  type Layout,
  MIN_CHANGE,
  type MorphSample,
  type Probe,
  paintedShare,
  probeScenes,
  readTimingFile,
  STAGE_FILL,
  sceneWindows,
  shotsOf,
  TEXT_CONTRAST,
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
      maxType: 40,
      groups: [] as number[],
      cueStarts: [1, 4],
    };
    // Round 6: no key-label floor (the type is quiet); a word over 56px is refused instead.
    expect(gradeLayout([{ ...row, key: "end" }]).map((f) => f.rule)).toEqual([
      "stage_fill",
      "cue_groups",
    ]);
    // The same numbers mid-scene are a build in progress, not a verdict.
    expect(gradeLayout([{ ...row, key: "c1z" }])).toEqual([]);
    expect(
      gradeLayout([{ ...row, key: "end", fill: STAGE_FILL, maxType: 44, groups: [1, 2] }]),
    ).toEqual([]);
    // A group naming a cue the scene does not have.
    expect(
      gradeLayout([{ ...row, key: "end", fill: 0.9, maxType: 56, groups: [1, 3] }]).map(
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

  it("does not blame any scene for the machine's audio device", () => {
    expect(
      gradeErrors(
        [
          "console error: The AudioContext encountered an error from the audio device or the WebAudio renderer.",
        ],
        ["s2", "s3"],
      ),
    ).toEqual([]);
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
 * the scene's one 56px word (round 6's headline size), and every part sits in a cue group.
 */
type Box = { width: number; height: number };
const SVG = (b: Box, inner: string, style = "") =>
  `<svg id="SCENEID-svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}" style="position:absolute;left:0;top:0${style}">${inner}</svg>`;
const LABEL = (b: Box, size = 56) =>
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
  // A block big enough to clear seek_order's pixel tolerance: round 6's 56px
  // word alone changes fewer pixels than round 2's 72px one did.
  markup: SVG(
    b,
    `${LABEL(b)}${CORNERS(b)}${DOT(b)}<g id="SCENEID-blk" data-cue="1"><rect id="SCENEID-slab" x="${b.width / 2 - 300}" y="${b.height / 2 + 60}" width="600" height="160" fill="#4cc9f0"/></g>`,
  ),
  css: "",
  script: `${MOVE(b)}
tl.fromTo("#SCENEID-slab", { opacity: 1 }, { opacity: 0.2, duration: 0.5 }, 2);
tl.fromTo("#SCENEID-slab", { opacity: 0.2 }, { opacity: 1, duration: 0.5 }, 6);`,
});
/** Round 1's look: a 48px label and a moving dot huddled in the top-left of the box. */
const SMALL = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `<g id="SCENEID-a" data-cue="1"><text id="SCENEID-lab" x="300" y="80" font-size="40" text-anchor="middle" dominant-baseline="middle" fill="#e7f1fb">Encoder</text></g><g id="SCENEID-m" data-cue="1"><circle id="SCENEID-dot" cx="100" cy="200" r="24" fill="#f7c948"/></g>`,
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
/**
 * ROUND 6, the founder's "old-fashioned" UI motion: a word on a plate that pops
 * and slides in (a chip), and a bar that grows from zero. `ui_motion` reads
 * them off the scene's own timeline.
 */
const CHIP = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `${CORNERS(b)}${DOT(b)}<g id="SCENEID-chip" data-cue="1"><rect x="${b.width / 2 - 200}" y="${b.height / 2 - 40}" width="400" height="80" rx="40" fill="#1f3a5f"/><text x="${b.width / 2}" y="${b.height / 2}" font-size="44" text-anchor="middle" dominant-baseline="middle" fill="#e7f1fb">Encoder</text></g><g id="SCENEID-bars" data-cue="2"><rect id="SCENEID-bar" x="200" y="${b.height - 260}" width="60" height="160" fill="#f7c948"/></g>`,
  ),
  css: "",
  script: `${MOVE(b)}
gsap.set("#SCENEID-chip", { opacity: 0, y: 40, scale: 0.6, transformOrigin: "50% 50%" });
tl.to("#SCENEID-chip", { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out" }, 1.2);
gsap.set("#SCENEID-bar", { scaleY: 0, transformOrigin: "50% 100%" });
tl.to("#SCENEID-bar", { scaleY: 1, duration: 0.8 }, 4.2);`,
});
/** The same word, quiet: it fades in where it stays. Not UI motion. */
const FADE = (b: Box): Fragment => ({
  markup: SVG(b, `${LABEL(b, 44)}${CORNERS(b)}${DOT(b)}`),
  css: "",
  script: `${MOVE(b)}
gsap.set("#SCENEID-a", { opacity: 0 });
tl.to("#SCENEID-a", { opacity: 1, duration: 0.6 }, 1.1);`,
});
/** A 48px word inside the scene's own camera, pushed in to 1.3x: it renders at 62px, over the headline. */
const ZOOMED = (b: Box): Fragment => ({
  markup: SVG(b, `${LABEL(b, 48)}${CORNERS(b)}${DOT(b)}`),
  css: "",
  script: `${MOVE(b)}
gsap.set("#SCENEID-cam", { scale: 1, x: 0, y: 0, transformOrigin: "0 0" });
tl.to("#SCENEID-cam", { scale: 1.3, x: ${-(b.width * 0.15).toFixed(0)}, y: ${-(b.height * 0.15).toFixed(0)}, duration: 1, ease: "power3.inOut" }, 2);
tl.to("#SCENEID-cam", { scale: 1, x: 0, y: 0, duration: 1, ease: "power3.inOut" }, 6);`,
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

/** A second label set past the right edge of its <svg>: the frame cuts it for the whole scene. */
const CLIPPED = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `${LABEL(b)}${CORNERS(b)}${DOT(b)}<g id="SCENEID-cl" data-cue="1"><text id="SCENEID-cut" x="${b.width - 160}" y="190" font-size="56" fill="#e7f1fb">Cut in two</text></g>`,
  ),
  css: "",
  script: MOVE(b),
});
/**
 * r1 s4's glitch: an \`attr: { d }\` tween between paths of different commands
 * (V/H against L), whose numbers pair in order — an x tweened into a y.
 */
const MORPHY = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `${LABEL(b)}${CORNERS(b)}${DOT(b)}<g id="SCENEID-p" data-cue="1"><path id="SCENEID-land" d="M1200 100 V300 H1400 Z" fill="#4cc9f0"/></g>`,
  ),
  css: "",
  script: `${MOVE(b)}
gsap.set("#SCENEID-land", { attr: { d: "M1200 100 V300 H1400 Z" } });
tl.to("#SCENEID-land", { attr: { d: "M1200 100 L1200 300 L1400 300 Z" }, duration: 2, ease: "none" }, 3);`,
});
/** The focal label held at 0.25 opacity: light on the ink ground at about 1.6:1. */
const FAINT = (b: Box): Fragment => ({
  markup: GOOD(b).markup,
  css: "",
  script: `${MOVE(b)}
gsap.set("#SCENEID-a", { opacity: 0.25 });`,
});

/**
 * Build the demo deck in v2 with `fixtures` as bespoke scenes on the beats
 * `idOf` names, and probe those scenes. Each set gets a deck of its own: a
 * scene probed just before another can render it first (their transition
 * overlaps), which hides the build-time from-state seek_order looks for.
 */
async function probeFixtures(
  dir: string,
  fixtures: Record<string, (b: Box) => Fragment>,
  idOf: Record<string, string>,
): Promise<{ probe: Probe; sidOf: Map<string, string> }> {
  const sidOf = new Map<string, string>();
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
  const probe = await probeScenes(sceneWindows(timing, wanted), {
    open: () => openDeck(dir, { watch: errors }),
    errors,
  });
  return { probe, sidOf };
}

describe.skipIf(chrome === null)("the gates, in the renderer's browser", () => {
  let dir = "";
  let probe: Probe;
  let sidOf = new Map<string, string>();
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
    ({ probe, sidOf } = await probeFixtures(dir, fixtures, idOf));
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
  it("fails a small drawing in a corner of its box", () => {
    expect(rulesFor("SMALL")).toEqual(expect.arrayContaining(["stage_fill"]));
  });
  it("fails an arrowhead shown before its line is drawn, and only that", () => {
    expect(new Set(rulesFor("STRAY"))).toEqual(new Set(["stray_marker"]));
  });
  it("fails a cue-2 group on screen during cue 1, and only that", () => {
    expect(new Set(rulesFor("EARLY"))).toEqual(new Set(["early_reveal"]));
  });
});

describe.skipIf(chrome === null)("the r1 review's gates, in the renderer's browser", () => {
  let dir = "";
  let probe: Probe;
  let sidOf = new Map<string, string>();
  // Spaced out, so no fixture is probed right after another.
  const fixtures = { GOOD, CLIPPED, MORPHY, FAINT };
  const at = ["pipeline", "grid", "stack", "line-chart"].map(
    (a) => demo.beats.find((b) => b.archetype === a)?.id as string,
  );
  const idOf = Object.fromEntries(Object.keys(fixtures).map((k, i) => [k, at[i] as string]));
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-gates-r1-"));
    ({ probe, sidOf } = await probeFixtures(dir, fixtures, idOf));
  }, 300_000);
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  const rulesFor = (name: keyof typeof fixtures) =>
    probe.findings
      .filter((f) => f.message.startsWith(`#${sidOf.get(idOf[name] as string)}`))
      .map((f) => f.rule);

  it("passes the good scene on every new gate", () => {
    expect(rulesFor("GOOD")).toEqual([]);
  });
  it("fails a word the frame cuts in two while it is held, and only that", () => {
    expect(new Set(rulesFor("CLIPPED"))).toEqual(new Set(["text_clipped"]));
    expect(rulesFor("GOOD")).not.toContain("text_clipped");
  });
  it("fails a path tween between paths of different commands, and only that", () => {
    expect(rulesFor("MORPHY")).toContain("morph_glitch");
    // The thrown shape may also cross the label on its way: that is the glitch too.
    for (const r of rulesFor("MORPHY"))
      expect(["morph_glitch", "graphic_crosses_text"]).toContain(r);
    // The matched tween in the same deck (the dot) is measured and passes.
    expect(probe.morphs.some((m) => m.id.endsWith("-land"))).toBe(true);
  });
  it("fails a word held under 3:1 contrast, and only that", () => {
    expect(new Set(rulesFor("FAINT"))).toEqual(new Set(["dim_text"]));
  });
});

/**
 * Round 6's gates in a deck of their own: a scene that animates UI into place,
 * one that fades its word where it stays, and one whose camera zooms a word
 * past the headline. (In the deck above they shifted its other scenes' windows
 * and masked ORDERED's seek-history defect.)
 */
describe.skipIf(chrome === null)("round 6's gates, in the renderer's browser", () => {
  let dir = "";
  let probe: Probe;
  const sidOf = new Map<string, string>();
  const ids = demo.beats
    .filter((b) => ["pipeline", "stack", "grid"].includes(b.archetype))
    .map((b) => b.id);
  const fixtures = { CHIP, FADE, ZOOMED };
  const idOf = Object.fromEntries(Object.keys(fixtures).map((k, i) => [k, ids[i] as string]));

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-gates6-"));
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
      narration: narrate(),
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
      gates: ["layout"],
    });
  }, 300_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const rulesFor = (name: keyof typeof fixtures) =>
    probe.findings
      .filter((f) => f.message.startsWith(`#${sidOf.get(idOf[name] as string)}`))
      .map((f) => f.rule);

  it("fails a word on a plate that pops and slides in, and a bar that grows — and only those (round 6)", () => {
    expect(new Set(rulesFor("CHIP"))).toEqual(new Set(["ui_motion"]));
    const end = probe.layout.find(
      (l) => l.sid === sidOf.get(idOf.CHIP as string) && l.key === "end",
    );
    expect(end?.uiMotion?.some((u) => /^plate .*-chip \(/.test(u))).toBe(true);
    expect(end?.uiMotion?.some((u) => /^bar .*-bar \(scaleY\)/.test(u))).toBe(true);
  });
  it("passes a word that only fades in where it stays", () => {
    expect(rulesFor("FADE")).toEqual([]);
  });
  it("fails a word the scene's camera zooms past the headline size, as rendered (round 6)", () => {
    expect(rulesFor("ZOOMED")).toContain("type_scale");
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

/* ------------------------------------------------- round 4: staging graders */

describe("the r1 review's graders (2026-10-10)", () => {
  const cut = (t: number, share?: number): CutSample => ({
    sid: "s12",
    t,
    cut: share === undefined ? [] : [{ id: "s12-chip", share }],
  });
  it("text_clipped: a word cut for three samples in a row fails; one sliding out during a move does not", () => {
    expect(gradeCuts([cut(1, 0.4), cut(1.5, 0.45), cut(2, 0.4)]).map((f) => f.rule)).toEqual([
      "text_clipped",
    ]);
    expect(gradeCuts([cut(1, 0.7), cut(1.5, 0.3), cut(2), cut(2.5, 0.5)])).toEqual([]);
    // Wholly in or wholly out is not cut.
    expect(gradeCuts([cut(1), cut(1.5), cut(2)])).toEqual([]);
  });
  it("morph_glitch: a shape that leaves both of its ends' union fails; a tween inside it does not", () => {
    const m = (mid: [number, number, number, number], o = 1): MorphSample => ({
      sid: "s4",
      id: "s4-land",
      start: 18,
      dur: 1,
      boxes: [
        { f: 0, b: [1000, 300, 600, 300], o: 1 },
        { f: 0.5, b: mid, o },
        { f: 1, b: [1000, 280, 640, 320], o: 1 },
      ],
    });
    expect(gradeMorphs([m([60, 100, 1580, 500])]).map((f) => f.rule)).toEqual(["morph_glitch"]);
    expect(gradeMorphs([m([990, 285, 640, 310])])).toEqual([]);
    // Invisible on the way: nothing to see.
    expect(gradeMorphs([m([60, 100, 1580, 500], 0)])).toEqual([]);
  });
  it("dim_text: graded at held frames (a cue's end, the end), not mid-fade", () => {
    const row = (key: string): Layout => ({
      sid: "s13",
      key,
      t: 5,
      crossings: [],
      occlusions: [],
      overlaps: [],
      small: [],
      off: [],
      faint: ["s13-pct [x 1100-1300, y 300-400] 1.6:1"],
    });
    expect(gradeLayout([row("c2z")]).map((f) => f.rule)).toEqual(["dim_text"]);
    expect(gradeLayout([row("end")]).map((f) => f.rule)).toContain("dim_text");
    expect(gradeLayout([row("c2a")]).map((f) => f.rule)).toEqual([]);
    expect(TEXT_CONTRAST).toBe(3);
  });
});

describe("seek_order's pixel count (round 4)", () => {
  const frame = (paint: (x: number, y: number) => boolean) => {
    const w = 64;
    const h = 64;
    const pixels = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (paint(x, y)) pixels.set([255, 255, 255], (y * w + x) * 3);
    return { width: w, height: h, channels: 3, pixels };
  };
  it("ignores a change that is only an outline (a re-rasterised edge) and keeps a changed area", () => {
    const blank = frame(() => false);
    const outline = frame((x, y) => (x === 10 || x === 11) && y > 5 && y < 50);
    expect(changedPixels(blank, outline)).toBe(88);
    expect(changedArea(blank, outline)).toBe(0);
    const patch = frame((x, y) => x >= 20 && x < 40 && y >= 20 && y < 40);
    expect(changedArea(blank, patch)).toBe(18 * 18);
  });
});

describe("the staging graders (round 4)", () => {
  const row = (key: string, t: number, over: Partial<Layout> = {}): Layout => ({
    sid: "s4",
    key,
    t,
    crossings: [],
    occlusions: [],
    overlaps: [],
    small: [],
    off: [],
    subjects: 3,
    ...over,
  });
  // A box 1700 x 700; a shot is [scale, x, y, w, h].
  const wide: CamSample["shot"] = [1, 0, 0, 1700, 700];
  const on = (cx: number, cy: number, s = 1.8): CamSample["shot"] => [
    s,
    Math.round(850 - cx * s),
    Math.round(350 - cy * s),
    1700,
    700,
  ];

  /** The camera every 0.5s: `plan` is [from, to, shot] spans; wide elsewhere. */
  const cams = (
    plan: Array<[number, number, CamSample["shot"]]>,
    over: Partial<CamSample> = {},
  ): CamSample[] => {
    const out: CamSample[] = [];
    for (let t = 0.25; t < 18; t += 0.5)
      out.push({
        sid: "s4",
        t,
        shot: (plan.find(([a, b]) => t >= a && t < b)?.[2] ?? wide) as CamSample["shot"],
        subjects: 3,
        ...over,
      });
    return out;
  };
  const opens = new Map([["s4", 1]]);

  it("shot_variety: an establishing shot and two held push-ins on different subjects pass", () => {
    const staged = cams([
      [5, 9, on(300, 380)],
      [10, 13, on(1300, 360)],
    ]);
    expect(gradeShots(staged, opens)).toEqual([]);
    expect(shotsOf(staged).close).toHaveLength(2);
  });

  it("shot_variety: two push-ins inside ONE cue still count — the camera is sampled, not the cue ends", () => {
    expect(
      gradeShots(
        cams([
          [5, 7, on(300, 380)],
          [7.6, 9, on(1300, 360)],
        ]),
        opens,
      ),
    ).toEqual([]);
  });

  it("shot_variety: round 3's gentle pans (1.1-1.4x) are not push-ins, and fail", () => {
    const f = gradeShots(
      cams([
        [5, 9, on(300, 380, 1.25)],
        [10, 13, on(1300, 360, 1.35)],
      ]),
      opens,
    );
    expect(f.map((x) => x.rule)).toEqual(["shot_variety"]);
    expect(f[0]?.message).toMatch(/holds 0 distinct push-in/);
  });

  it("shot_variety: a camera passing through is not a shot; one subject twice is one shot; opening pushed in fails", () => {
    // A single sample at 1.8x is a move in transit, not a held shot; so are two
    // close samples aimed at different subjects (a pan between them).
    expect(shotsOf(cams([[6, 6.5, on(1300, 360)]])).close).toEqual([]);
    expect(
      shotsOf(
        cams([
          [6, 6.5, on(300, 380)],
          [6.5, 7, on(1300, 360)],
        ]),
      ).close,
    ).toEqual([]);
    const f = gradeShots(
      cams([
        [0, 5, on(300, 380)],
        [8, 12, on(320, 390, 1.9)],
      ]),
      opens,
    );
    expect(f[0]?.message).toMatch(/opens pushed in/);
    expect(f[0]?.message).toMatch(/holds 1 distinct push-in/);
  });

  it("shot_variety: a close-open scene may open pushed in; a tour may not", () => {
    const opening = (open?: "close"): CamSample[] =>
      [1, 1.5, 2, 4.5, 5, 8, 8.5].map((t, i) => ({
        sid: "s7",
        t,
        shot: (i < 3
          ? [1.8, -200, -100, 1700, 700]
          : i < 5
            ? [1.8, -1400, -100, 1700, 700]
            : [1, 0, 0, 1700, 700]) as CamSample["shot"],
        subjects: 3,
        ...(open ? { open } : {}),
      }));
    expect(gradeShots(opening(), new Map([["s7", 1]])).map((f) => f.message)).toEqual([
      expect.stringMatching(/opens pushed in/),
    ]);
    expect(gradeShots(opening("close"), new Map([["s7", 1]]))).toEqual([]);
  });

  it("shot_variety: a scene without an illustration is not graded on shots", () => {
    expect(gradeShots(cams([[0, 18, on(300, 300)]], { subjects: 0 }), opens)).toEqual([]);
  });

  it("label_anchor: a label on its subject passes; far away or over another subject fails", () => {
    const ok = gradeLayout([
      row("end", 16, {
        anchors: [
          { id: "s4-a", k: 1, d: 0, o: 0 },
          { id: "s4-b", k: 2, d: 40, o: 0.1 },
        ],
      }),
    ]);
    expect(ok.filter((f) => f.rule === "label_anchor")).toEqual([]);
    const far = gradeLayout([
      row("c2z", 8, { anchors: [{ id: "s4-a", k: 1, d: ANCHOR_PX + 60, o: 0 }] }),
    ]);
    expect(far.map((f) => f.rule)).toEqual(["label_anchor"]);
    expect(far[0]?.message).toMatch(/away from the subject it names/);
    const over = gradeLayout([
      row("c2z", 8, { anchors: [{ id: "s4-a", k: 1, d: 0, o: ANCHOR_OVERLAP + 0.2 }] }),
    ]);
    expect(over[0]?.message).toMatch(/covers another subject/);
  });

  it("type_hierarchy: an illustrated scene reads its picture first, so its 40px names pass; a diagram still needs 44px", () => {
    const end = (subjects: number) =>
      gradeLayout([
        row("end", 16, {
          subjects,
          fill: 0.95,
          maxType: 40,
          groups: [1, 2],
          cueStarts: [1, 5],
          anchors: [
            { id: "a", k: 1, d: 0, o: 0 },
            { id: "b", k: 2, d: 0, o: 0 },
          ],
        }),
      ]).map((f) => f.rule);
    expect(end(3)).toEqual([]);
    expect(end(0)).toEqual(["type_hierarchy"]);
  });

  it("type_scale: no word in a bespoke scene over the 56px headline, illustrated or not (round 6)", () => {
    const end = (subjects: number, maxType: number) =>
      gradeLayout([
        row("end", 16, { subjects, fill: 0.95, maxType, groups: [1, 2], cueStarts: [1, 5] }),
      ]).map((f) => f.rule);
    expect(end(3, 56)).toEqual([]);
    expect(end(0, 44)).toEqual([]);
    expect(end(0, 64)).toEqual(["type_scale"]);
    expect(end(3, 96)).toEqual(["type_scale"]);
  });

  it("type_ceiling: no scene declares type over 56px, picture or not (founder, 2026-10-10)", () => {
    const end = (subjects: number, maxDeclared: number) =>
      gradeLayout([
        row("end", 16, {
          subjects,
          fill: 0.95,
          maxType: 44,
          maxDeclared,
          groups: [1, 2],
          cueStarts: [1, 5],
          anchors: [
            { id: "a", k: 1, d: 0, o: 0 },
            { id: "b", k: 2, d: 0, o: 0 },
          ],
        }),
      ]).map((f) => f.rule);
    // The declared size: the rendered one is `type_scale`'s (below).
    expect(end(0, 56)).toEqual([]);
    expect(end(0, 88)).toEqual(["type_ceiling"]);
    expect(end(3, 64)).toEqual(["type_ceiling"]);
  });

  it("data_over_picture: a table's worth of numbers on the illustration fails, a counter does not", () => {
    expect(gradeLayout([row("c2z", 8, { onPicture: 2, subjects: 0 })])).toEqual([]);
    // Round 3's ja s12 painted nine numbers over its robot.
    const f = gradeLayout([row("c2z", 8, { onPicture: 9, subjects: 0 })]);
    expect(f.map((x) => x.rule)).toEqual(["data_over_picture"]);
  });
});
