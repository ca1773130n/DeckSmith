/**
 * The deterministic repair (src/bespoke/repair.ts) and the end-state gates it
 * answers (`end_dimmed`, `camera_end` in src/verify/scenes.ts): the solver and
 * the markup surgery on numbers, then the whole loop in the renderer's browser
 * — a scene the gates refuse, repaired with no model call, passing them.
 *
 * The browser half is skipped without Chrome, like test/bespoke-gates.test.ts.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArtRef } from "../src/bespoke/art.js";
import { checkFragment, checkScript, type Fragment } from "../src/bespoke/contract.js";
import {
  applyMoves,
  BAND_GAP,
  fitPlates,
  homeCamera,
  relight,
  repairable,
  repairScene,
  settleAt,
  solveNudges,
} from "../src/bespoke/repair.js";
import { type BespokeMap, bespokeRegion } from "../src/bespoke/scene.js";
import { untangle } from "../src/bespoke/untangle.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import type { DeckNarration } from "../src/emit/composition.js";
import { resolveTheme } from "../src/emit/theme.js";
import { stopCount } from "../src/narrate/narrate.js";
import { chromePath, openDeck } from "../src/render/capture.js";
import type { Timing } from "../src/render/timing.js";
import { FORMATS, type Format, sourceSchema, storyboardSchema } from "../src/types.js";
import {
  END_DIMMED,
  endState,
  type Geo,
  gradeLayout,
  type Layout,
  probeScenes,
  readTimingFile,
  sceneWindows,
} from "../src/verify/scenes.js";
import { testPng } from "./fixtures/png.js";

/* ------------------------------------------------------------------ numbers */

const frame = (over: Partial<Geo> = {}): Geo => ({
  w: 1700,
  h: 600,
  labels: [],
  boxes: [],
  points: [],
  parts: [],
  ...over,
});

describe("the label solver", () => {
  it("keeps the scene's own words BAND_GAP clear of a shell label, moving only the scene's (round 5)", () => {
    // A shell label (never moved) and the scene's word 20px to its right, camera home.
    const f = frame({
      cs: 1,
      labels: [
        { a: "text:9", u: null, o: 9, b: [600, 200, 240, 80], s: 1, fs: 64, c: 1 },
        { a: "text:0", u: "g:0", o: 1, b: [860, 200, 300, 80], s: 1, fs: 72 },
      ],
    });
    expect(
      repairable([
        "error label_band: #s3 at end (9.00s): a label is where the scene's own words go — x",
      ]),
    ).toBe(true);
    const { moves, unresolved } = solveNudges([f]);
    expect(unresolved).toEqual([]);
    const m = moves.find((x) => x.u === "g:0") as { dx: number; dy: number };
    const nb: [number, number, number, number] = [860 + m.dx, 200 + m.dy, 300, 80];
    const gx = Math.max(600 - (nb[0] + nb[2]), nb[0] - (600 + 240));
    const gy = Math.max(200 - (nb[1] + nb[3]), nb[1] - (200 + 80));
    expect(Math.max(gx, gy)).toBeGreaterThanOrEqual(BAND_GAP);
    expect(moves.some((x) => x.u === null)).toBe(false);
  });

  it("moves the smaller of two overlapping labels, and only as far as it must", () => {
    const f = frame({
      labels: [
        { a: "text:0", u: "g:0", o: 1, b: [600, 280, 400, 90], s: 1, fs: 72 },
        { a: "text:1", u: "g:1", o: 3, b: [900, 340, 200, 64], s: 1, fs: 52 },
      ],
    });
    const { moves, unresolved } = solveNudges([f]);
    expect(unresolved).toEqual([]);
    expect(moves).toHaveLength(1);
    const m = moves[0] as { u: string; dx: number; dy: number };
    expect(m.u).toBe("g:1");
    // Clear of the big label by the gap, and no farther than the nearest ring that clears it.
    const moved: [number, number, number, number] = [900 + m.dx, 340 + m.dy, 200, 64];
    const gapX = Math.max(600 - (moved[0] + 200), moved[0] - 1000);
    const gapY = Math.max(280 - (moved[1] + 64), moved[1] - 370);
    expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(16);
    expect(Math.hypot(m.dx, m.dy)).toBeLessThan(64);
  });

  it("nudges, never relocates: a collision only a long move would clear is left unresolved", () => {
    // Line two of a label printed into line one, with the plate's stroke round both:
    // the only clear places are far from the plate, and a label carried there no
    // longer reads as one.
    const plate = (y: number) =>
      Array.from({ length: 50 }, (_, i) => [560 + i * 8, y, null] as [number, number, null]);
    const f = frame({
      labels: [
        { a: "text:0", u: "text:0", o: 2, b: [600, 280, 320, 104], s: 1, fs: 83 },
        { a: "text:1", u: "text:1", o: 3, b: [600, 364, 320, 62], s: 1, fs: 50 },
      ],
      points: [...plate(270), ...plate(436)],
    });
    expect(solveNudges([f]).unresolved).not.toEqual([]);
  });

  it("lifts a label off a stroke through it, at every frame, in the camera's units", () => {
    // A horizontal wire at y 330 through the label; at the second frame the
    // camera has zoomed 2x, so the same move is twice as far on screen.
    const wire = (y: number) =>
      Array.from({ length: 160 }, (_, i) => [100 + i * 10, y, null] as [number, number, null]);
    const f1 = frame({
      labels: [{ a: "text:0", u: "text:0", o: 1, b: [600, 300, 300, 60], s: 1, fs: 60 }],
      points: wire(330),
    });
    const f2 = frame({
      labels: [{ a: "text:0", u: "text:0", o: 1, b: [400, 260, 600, 120], s: 2, fs: 120 }],
      points: wire(320),
    });
    const { moves, unresolved } = solveNudges([f1, f2]);
    expect(unresolved).toEqual([]);
    const m = moves[0] as { dx: number; dy: number };
    // Frame 1: the box clears y 330 by 10px. Frame 2: twice the move clears y 320.
    const y1 = 300 + m.dy;
    expect(y1 + 60 + 10 <= 330 || y1 - 10 >= 330).toBe(true);
    const y2 = 260 + 2 * m.dy;
    expect(y2 + 120 + 10 <= 320 || y2 - 10 >= 320).toBe(true);
  });

  it("never leaves the box, and moves a label's plate with it", () => {
    // A label at the top edge crossed by a wire: up is out of the box, so it goes down.
    const f = frame({
      labels: [{ a: "text:0", u: "g:2", o: 2, b: [700, 10, 300, 60], s: 1, fs: 60 }],
      boxes: [{ a: "rect:0", u: "g:2", o: 1, b: [680, 0, 340, 80] }],
      points: Array.from(
        { length: 60 },
        (_, i) => [600 + i * 10, 40, null] as [number, number, null],
      ),
    });
    const { moves } = solveNudges([f]);
    const m = moves[0] as { dy: number };
    expect(m.dy).toBeGreaterThan(0);
  });

  it("says what it cannot clear: a label that cannot move", () => {
    const f = frame({
      labels: [
        { a: "div:0", u: null, o: 1, b: [600, 280, 400, 90], s: 1, fs: 72 },
        { a: "span:0", u: null, o: 2, b: [700, 300, 200, 64], s: 1, fs: 52 },
      ],
    });
    expect(solveNudges([f]).unresolved.length).toBeGreaterThan(0);
  });
});

describe("untangling tweens that fight over one property", () => {
  it("strips the target from the earlier of two tweens that start together (the ko scene)", () => {
    const script = `tl.to(['#SCENEID-a','#SCENEID-src','#SCENEID-b'],{opacity:0.3,duration:0.4},8.68);
tl.to('#SCENEID-src',{opacity:0,duration:0.3},8.68);`;
    expect(
      untangle(script),
    ).toBe(`tl.to(['#SCENEID-a','#SCENEID-b'],{opacity:0.3,duration:0.4},8.68);
tl.to('#SCENEID-src',{opacity:0,duration:0.3},8.68);`);
  });

  it("ends an earlier tween where a later one on the same property starts, through a variable", () => {
    const script = `var dot = "#SCENEID-dot";
tl.to(dot, { attr: { cy: 100 }, duration: 6 }, 1);
tl.to("#SCENEID-dot", { attr: { cy: 500, cx: 9 }, duration: 6 }, 2);`;
    const out = untangle(script) as string;
    expect(out).toContain("tl.to(dot, { attr: { cy: 100 }, duration: 1 }, 1);");
    expect(checkScript(out)).toEqual([]);
    // A set inside a default-length tween, and a tween with no duration written.
    expect(
      untangle(`tl.to("#SCENEID-x", { x: 5 }, 1);\ntl.set("#SCENEID-x", { x: 0 }, 1.2);`),
    ).toContain('tl.to("#SCENEID-x", { duration: 0.2, x: 5 }, 1);');
  });

  it("strips the property, or the whole tween, when that is all the overlap is", () => {
    expect(
      untangle(`tl.to("#SCENEID-x", { x: 5, opacity: 1, duration: 1 }, 2);
tl.to("#SCENEID-x", { opacity: 0, duration: 1 }, 2);`),
    ).toContain('tl.to("#SCENEID-x", { x: 5, duration: 1 }, 2);');
    expect(
      untangle(`tl.to("#SCENEID-x", { opacity: 1, duration: 1 }, 2);
tl.to("#SCENEID-x", { opacity: 0, duration: 1 }, 2);`),
    ).toMatch(/^\/\* untangled/);
  });

  it("leaves alone what it cannot read exactly, and says there was nothing", () => {
    // Different properties, different targets, sequential tweens: no tangle.
    expect(
      untangle(`tl.to("#SCENEID-x", { x: 5, duration: 1 }, 1);
tl.to("#SCENEID-x", { y: 5, duration: 1 }, 1.5);
tl.to("#SCENEID-y", { x: 5, duration: 1 }, 1.5);
tl.to("#SCENEID-x", { x: 0, duration: 1 }, 2);`),
    ).toBeUndefined();
    // A pulse (repeat) that yields to nothing it can shorten safely.
    expect(
      untangle(`tl.to("#SCENEID-x", { scale: 1.1, duration: 0.4, yoyo: true, repeat: 5 }, 1);
tl.to("#SCENEID-x", { scale: 1, duration: 0.4 }, 2);`),
    ).toBeUndefined();
  });
});

describe("the markup surgery", () => {
  const markup = `<svg id="SCENEID-svg" width="1700" height="600" viewBox="0 0 1700 600">
<!-- <g> in a comment is not an element -->
<g id="SCENEID-a" data-cue="1"><text id="SCENEID-t0" x="10" y="10" font-size="60">a</text></g>
<g id="SCENEID-b" data-cue="1"><g><rect x="0" y="0" width="5" height="5"/></g><text x="20" y="20" font-size="60">b</text></g>
</svg>`;

  it("wraps the addressed unit in a translate, and keeps the contract", () => {
    const out = applyMoves(markup, [
      { u: "g:1", dx: 0, dy: -24 },
      { u: "text:0", dx: 12.5, dy: 0 },
    ]);
    expect(out).toContain(
      '<g transform="translate(0 -24)"><g id="SCENEID-b" data-cue="1"><g><rect x="0" y="0" width="5" height="5"/></g><text x="20" y="20" font-size="60">b</text></g></g>',
    );
    expect(out).toContain(
      '<g transform="translate(12.5 0)"><text id="SCENEID-t0" x="10" y="10" font-size="60">a</text></g>',
    );
    expect(checkFragment({ markup: out, css: "", script: "" })).toEqual([]);
  });

  it("relights by id, names what has none, and lands before the end frame", () => {
    const at = settleAt(12, 9.5);
    expect(at).toBeLessThanOrEqual(12 - 1.4);
    expect(at).toBeGreaterThanOrEqual(9.5);
    const f = relight({ markup, css: "", script: "" }, ["g:0#s4-a", "text:1"], at, "s4");
    expect(f.markup).toContain('<text id="SCENEID-lit1" x="20"');
    expect(f.script).toContain(
      `tl.to(["#SCENEID-a", "#SCENEID-lit1"], { opacity: 1, duration: 0.5, ease: "power2.out" }, ${at});`,
    );
    expect(checkFragment(f)).toEqual([]);
  });

  it("sends the camera home — the shell's wrapper, or a viewBox", () => {
    const f = { markup, css: "", script: "" };
    expect(homeCamera(f, "#s4-cam at scale 1.50, x -200, y -80", 9).script).toContain(
      'tl.to("#SCENEID-cam", { scale: 1, x: 0, y: 0, duration: 0.8, ease: "power3.inOut" }, 9);',
    );
    const vb = homeCamera(f, "#s4-svg viewBox 400 100 850 300", 9);
    expect(vb.script).toContain('attr: { viewBox: "0 0 1700 600" }');
    expect(checkFragment(vb)).toEqual([]);
  });

  it("repairs only what it can: a scene failing anything else is left alone", () => {
    expect(repairable(["error text_overlap: x", "warning contrast: y"])).toBe(true);
    expect(repairable(["error text_overlap: x", "error static_hold: y"])).toBe(false);
    expect(repairable([])).toBe(false);
    // A seek_order the untangler can explain is repaired; one it cannot is not.
    const tangled = {
      markup,
      css: "",
      script: `tl.to("#SCENEID-a", { x: 5, duration: 2 }, 1);\ntl.to("#SCENEID-a", { x: 0, duration: 1 }, 2);`,
    };
    const fixed = repairScene(
      tangled,
      { findings: ["error seek_order: x"] },
      { duration: 9, lastCueStart: 6 },
    );
    expect(fixed?.note.untangled).toBe(true);
    expect(fixed?.fragment.script).toContain("{ x: 5, duration: 1 }, 1)");
    expect(
      repairScene(
        { markup, css: "", script: `tl.to("#SCENEID-a", { x: 5, duration: 2 }, 1);` },
        { findings: ["error seek_order: x"] },
        { duration: 9, lastCueStart: 6 },
      ),
    ).toBeUndefined();
    const f = { markup, css: "", script: "" };
    expect(
      repairScene(f, { findings: ["error stage_fill: x"] }, { duration: 9, lastCueStart: 6 }),
    ).toBeUndefined();
  });
});

describe("the end-state gates", () => {
  const row = (key: string, parts: Geo["parts"]): Layout => ({
    sid: "s4",
    key,
    t: 1,
    crossings: [],
    occlusions: [],
    overlaps: [],
    small: [],
    off: [],
    fill: 0.9,
    maxType: 96,
    groups: [1],
    cueStarts: [1],
    geo: frame({ parts }),
  });

  it("end_dimmed counts only what the scene had lit — a halo drawn translucent is not dimmed", () => {
    const rows = [
      row("c1z", [
        { a: "text:0", al: 1, dim: [] },
        { a: "circle:0", al: 0.4, dim: [] },
        { a: "rect:0", al: 1, dim: [] },
      ]),
      row("end", [
        { a: "text:0", al: 0.3, dim: ["g:0#s4-a"] },
        { a: "circle:0", al: 0.4, dim: ["circle:0"] },
        { a: "rect:0", al: 1, dim: [] },
      ]),
    ];
    endState(rows);
    const end = rows[1] as Layout;
    expect(end.litDimmed).toBeCloseTo(1 / 3);
    expect(end.relight).toEqual(["g:0#s4-a"]);
    expect(gradeLayout(rows).map((f) => f.rule)).toEqual(["end_dimmed"]);
    expect(END_DIMMED).toBeLessThan(1 / 3);
  });

  it("camera_end fails a settled frame the camera has not come home to — and only the settled frame", () => {
    const zoomed = { ...row("end", []), camOff: "#s4-cam at scale 1.50, x -200, y -80" };
    expect(gradeLayout([zoomed]).map((f) => f.rule)).toEqual(["camera_end"]);
    expect(gradeLayout([{ ...zoomed, key: "c1z" }])).toEqual([]);
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
const buildDeck = async (...args: Parameters<typeof import("../src/index.js").buildDeck>) =>
  ((await import(repo("dist/index.js"))) as typeof import("../src/index.js")).buildDeck(...args);
const ink = resolveTheme("ink");

function narrate(): DeckNarration {
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

type Box = { width: number; height: number };
const SVG = (b: Box, inner: string) =>
  `<svg id="SCENEID-svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}" style="position:absolute;left:0;top:0">${inner}</svg>`;
const BASE = (b: Box) =>
  `<g id="SCENEID-a" data-cue="1"><text id="SCENEID-lab" x="${b.width / 2}" y="${b.height / 2}" font-size="72" text-anchor="middle" dominant-baseline="middle" fill="#e7f1fb">Encoder output</text></g><g id="SCENEID-c" data-cue="1">${[
    [30, 30],
    [b.width - 30, 30],
    [30, b.height - 30],
    [b.width - 30, b.height - 30],
  ]
    .map(([x, y], i) => `<circle id="SCENEID-k${i}" cx="${x}" cy="${y}" r="20" fill="#4cc9f0"/>`)
    .join(
      "",
    )}</g><g id="SCENEID-m" data-cue="1"><circle id="SCENEID-dot" cx="100" cy="${b.height - 110}" r="30" fill="#f7c948"/></g>`;
const MOVE = (b: Box) => `gsap.set("#SCENEID-dot", { attr: { cx: 100 } });
tl.to("#SCENEID-dot", { attr: { cx: ${b.width - 100} }, duration: 3, repeat: 9, yoyo: true, ease: "none" }, 0.9);`;

/** A second label printed over the first, and a wire straight through the first. */
const COLLIDE = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `${BASE(b)}<g id="SCENEID-n" data-cue="1"><text id="SCENEID-note" x="${b.width / 2 + 160}" y="${b.height / 2 + 30}" font-size="52" text-anchor="middle" dominant-baseline="middle" fill="#f7c948">decoder</text></g><g id="SCENEID-w" data-cue="1"><line id="SCENEID-wire" x1="140" y1="${b.height / 2}" x2="${b.width / 2 - 360}" y2="${b.height / 2}" stroke="#4cc9f0" stroke-width="6"/><line id="SCENEID-wire2" x1="${b.width / 2 - 200}" y1="${b.height / 2 - 4}" x2="${b.width / 2 + 40}" y2="${b.height / 2 - 4}" stroke="#4cc9f0" stroke-width="6"/></g>`,
  ),
  css: "",
  script: MOVE(b),
});
/** Lit in cue 1, dimmed in cue 2, and left dimmed: an end of ghosts. */
const DIMMED = (b: Box): Fragment => ({
  markup: SVG(b, BASE(b)),
  css: "",
  script: `${MOVE(b)}
tl.to(["#SCENEID-lab", "#SCENEID-c"], { opacity: 0.3, duration: 0.5 }, 3.2);`,
});
/** A push-in on the camera that never comes back. */
const ZOOMED = (b: Box): Fragment => ({
  markup: SVG(b, BASE(b)),
  css: "",
  script: `${MOVE(b)}
gsap.set("#SCENEID-cam", { scale: 1, x: 0, y: 0, transformOrigin: "0 0" });
tl.to("#SCENEID-cam", { scale: 1.04, x: ${-(b.width * 0.02).toFixed(1)}, y: ${-(b.height * 0.02).toFixed(1)}, duration: 1, ease: "power3.inOut" }, 3.2);`,
});
/** Two tweens fighting over one property: the later wins going forward, the earlier going back. */
const TANGLED = (b: Box): Fragment => ({
  markup: SVG(b, BASE(b)),
  css: "",
  script: `${MOVE(b)}
tl.to("#SCENEID-dot", { attr: { cy: 120 }, duration: 6 }, 1);
tl.to("#SCENEID-dot", { attr: { cy: ${b.height - 60} }, duration: 6 }, 2);`,
});
/** A scene placing the beat's illustration: the shell writes its href, the build copies it. */
const PICTURE = (b: Box): Fragment => ({
  markup: SVG(
    b,
    `<g id="SCENEID-p" data-cue="1"><image id="SCENEID-pic" data-art="1" x="0" y="0" width="${b.width}" height="${b.height}" preserveAspectRatio="xMidYMid slice"/></g>${BASE(b)}`,
  ),
  css: "",
  script: MOVE(b),
});

describe.skipIf(chrome === null)("repair, in the renderer's browser", () => {
  const dirs: string[] = [];
  const fixtures = { COLLIDE, DIMMED, ZOOMED, PICTURE, TANGLED };
  const ids = demo.beats
    .filter((b) =>
      ["pipeline", "stack", "grid", "bar-compare", "split-compare"].includes(b.archetype),
    )
    .map((b) => b.id);
  const idOf = Object.fromEntries(Object.keys(fixtures).map((k, i) => [k, ids[i] as string]));
  let art: ArtRef;
  const findingsOf = new Map<string, string[]>();
  const after = new Map<string, string[]>();
  const repaired = new Map<string, Fragment>();
  let deck1 = "";

  /** Build a deck with these fragments, probe them as the bespoke pass does, and say what each failed. */
  const run = async (fragments: Record<string, Fragment>) => {
    const dir = await mkdtemp(join(tmpdir(), "decksmith-repair-"));
    dirs.push(dir);
    const bespoke: Record<string, { fragment: Fragment; holds: number[]; art?: ArtRef }> = {};
    for (const [name, fragment] of Object.entries(fragments)) {
      const id = idOf[name] as string;
      const i = demo.beats.findIndex((b) => b.id === id);
      const beat = demo.beats[i] as (typeof demo.beats)[number];
      const holds = emitScene(beat, {
        source,
        format: deck16,
        theme: ink,
        sid: `s${i + 1}`,
        start: 0,
      }).holds;
      bespoke[id] = { fragment, holds, ...(name === "PICTURE" ? { art } : {}) };
    }
    const built = await buildDeck(demo, source, dir, {
      design: "v2",
      narration: narrate(),
      theme: "ink",
      assetsFrom: repo("demo"),
      bespoke: bespoke as BespokeMap,
    });
    const sidOf = new Map(built.cut.kept.map((b, i) => [b.id, `s${i + 1}`]));
    const timing = (await readTimingFile(dir)) as Timing;
    const wanted = new Set(
      Object.keys(fragments).map((n) => sidOf.get(idOf[n] as string) as string),
    );
    const errors: string[] = [];
    const probe = await probeScenes(sceneWindows(timing, wanted), {
      open: () => openDeck(dir, { watch: errors }),
      errors,
      geometry: true,
    });
    const out = new Map<
      string,
      {
        findings: string[];
        layout: Layout[];
        sid: string;
        window: { duration: number; last: number };
      }
    >();
    for (const w of sceneWindows(timing, wanted)) {
      const name = Object.keys(fragments).find(
        (n) => sidOf.get(idOf[n] as string) === w.sid,
      ) as string;
      out.set(name, {
        findings: probe.findings
          .filter((f) => f.message.startsWith(`#${w.sid}`))
          .map((f) => `${f.severity} ${f.rule}: ${f.message}`),
        layout: probe.layout.filter((l) => l.sid === w.sid),
        sid: w.sid,
        window: { duration: w.duration, last: w.cues[w.cues.length - 1]?.t0 ?? 0 },
      });
    }
    return { dir, out };
  };

  beforeAll(async () => {
    const box = (name: string) => {
      const beat = demo.beats.find((b) => b.id === idOf[name]) as (typeof demo.beats)[number];
      return bespokeRegion(beat, { format: deck16, theme: ink });
    };
    const scratch = await mkdtemp(join(tmpdir(), "decksmith-repair-art-"));
    dirs.push(scratch);
    const file = join(scratch, "picture.png");
    await writeFile(file, testPng(640, 360));
    art = { key: "k", name: "k.png", file, width: 640, height: 360, depicts: "discs" };
    const first = Object.fromEntries(
      Object.entries(fixtures).map(([n, make]) => [n, make(box(n))]),
    ) as Record<string, Fragment>;
    const one = await run(first);
    deck1 = one.dir;
    const fixes: Record<string, Fragment> = {};
    for (const [name, r] of one.out) {
      findingsOf.set(name, r.findings);
      const fixed = repairScene(first[name] as Fragment, r, {
        duration: r.window.duration,
        lastCueStart: r.window.last,
      });
      if (fixed) {
        repaired.set(name, fixed.fragment);
        fixes[name] = fixed.fragment;
      }
    }
    if (Object.keys(fixes).length) {
      const two = await run(fixes);
      for (const [name, r] of two.out) after.set(name, r.findings);
    }
  }, 400_000);

  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  const rules = (list: string[] | undefined) =>
    [...new Set((list ?? []).map((f) => /^\w+ ([\w-]+):/.exec(f)?.[1]))].sort();

  it("the gates refuse each broken scene for what is broken, and only that", () => {
    expect(rules(findingsOf.get("COLLIDE"))).toEqual(["graphic_crosses_text", "text_overlap"]);
    expect(rules(findingsOf.get("DIMMED"))).toEqual(["end_dimmed"]);
    expect(rules(findingsOf.get("ZOOMED"))).toEqual(["camera_end"]);
    expect(rules(findingsOf.get("TANGLED"))).toEqual(["seek_order"]);
  });

  it("the repaired scenes pass every gate, with no model call, keeping the contract", () => {
    for (const name of ["COLLIDE", "DIMMED", "ZOOMED", "TANGLED"]) {
      const f = repaired.get(name);
      expect(f, name).toBeDefined();
      expect(checkFragment(f as Fragment), name).toEqual([]);
      expect(after.get(name), name).toEqual([]);
    }
  });

  it("places the illustration under the build's own name, and the page loads it", async () => {
    expect(findingsOf.get("PICTURE")).toEqual([]);
    expect((await stat(join(deck1, "assets", "bespoke", "k.png"))).size).toBeGreaterThan(0);
    const html = await readFile(join(deck1, "index.html"), "utf8");
    expect(html).toMatch(/<image id="s\d+-pic" data-art="1" href="assets\/bespoke\/k\.png"/);
  });
});

describe("a plate too small for its text (round 4)", () => {
  const geo = (box: [number, number, number, number]): Geo => ({
    w: 1700,
    h: 700,
    labels: [{ a: "text:0", u: "g:1", o: 3, b: [600, 620, 440, 80], s: 1, fs: 64 }],
    boxes: [{ a: "rect:0", u: "g:1", o: 2, b: box }],
    points: [],
    parts: [],
  });
  const markup = (rect: string) =>
    `<svg id="SCENEID-svg" width="1700" height="700"><g id="SCENEID-sum">${rect}<text id="SCENEID-t" x="820" y="660" font-size="64">条件分布的乘积</text></g></svg>`;

  it("is grown to hold its text with a margin, and nothing else moves", () => {
    const before = markup('<rect id="SCENEID-p" x="640" y="630" width="360" height="60" rx="20"/>');
    const { markup: after, grown } = fitPlates(before, geo([640, 630, 360, 60]));
    expect(grown).toBe(1);
    const head = /<rect[^>]*>/.exec(after)?.[0] ?? "";
    const n = (k: string) => Number(new RegExp(` ${k}="([\\d.]+)"`).exec(head)?.[1]);
    expect(n("x")).toBeLessThanOrEqual(600 - 6);
    expect(n("y")).toBeLessThanOrEqual(620 - 6);
    expect(n("x") + n("width")).toBeGreaterThanOrEqual(1040 + 6);
    expect(n("y") + n("height")).toBeGreaterThanOrEqual(700 - 6);
    expect(head).toContain('rx="20"');
    expect(after.replace(/<rect[^>]*>/, "")).toBe(before.replace(/<rect[^>]*>/, ""));
  });

  it("leaves a rect alone when its markup is not what was measured (a transform, a tween)", () => {
    const moved = markup(
      '<rect id="SCENEID-p" x="640" y="630" width="360" height="60" transform="scale(1.1)"/>',
    );
    expect(fitPlates(moved, geo([640, 630, 360, 60])).grown).toBe(0);
    const tweened = markup('<rect id="SCENEID-p" x="640" y="630" width="10" height="60"/>');
    expect(fitPlates(tweened, geo([640, 630, 360, 60])).grown).toBe(0);
  });

  it("is a repair: a scene failing only on its plate is grown, not critiqued", () => {
    const f = {
      markup: markup('<rect id="SCENEID-p" x="640" y="630" width="360" height="60"/>'),
      css: "",
      script: "",
    };
    const layout = [
      {
        sid: "s4",
        key: "end",
        t: 9,
        crossings: [],
        occlusions: [],
        overlaps: [],
        small: [],
        off: [],
        geo: geo([640, 630, 360, 60]),
      },
    ] as Layout[];
    const r = repairScene(
      f,
      {
        findings: ["error graphic_crosses_text: #s4 at end: rect through text"],
        layout,
        sid: "s4",
      },
      { duration: 10, lastCueStart: 6 },
    );
    expect(r?.note.grown).toBe(1);
  });
});

describe("a disc too small for its symbol, inside a moving group (round 4)", () => {
  it("is grown in its own units, whatever the group's translation", () => {
    // The group is translated by (300, 40): the disc's markup is at (100,100) r 30,
    // measured at (400,140); the symbol inside measures 60x76.
    const markup = `<svg id="SCENEID-svg" width="1700" height="700"><g id="SCENEID-tok"><circle id="SCENEID-disc" cx="100" cy="100" r="30"/><text id="SCENEID-sym" x="100" y="100" font-size="60">∑</text></g></svg>`;
    const g: Geo = {
      w: 1700,
      h: 700,
      labels: [{ a: "text:0", u: "g:0", o: 3, b: [370, 102, 60, 76], s: 1, fs: 60 }],
      boxes: [{ a: "circle:0", u: "g:0", o: 2, b: [370, 110, 60, 60] }],
      points: [],
      parts: [],
    };
    const { markup: out, grown } = fitPlates(markup, [g]);
    expect(grown).toBe(1);
    const r = Number(/<circle[^>]* r="(\d+)"/.exec(out)?.[1]);
    // Corners of the symbol's box are ~48px from the disc's centre.
    expect(r).toBeGreaterThanOrEqual(Math.ceil(Math.hypot(30, 38)) + 4);
    expect(out).toContain('cx="100" cy="100"');
  });
});
