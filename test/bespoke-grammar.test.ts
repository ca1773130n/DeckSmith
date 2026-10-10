/**
 * Round 5: the shell's camera grammars (src/bespoke/grammar.ts, compiled in
 * src/bespoke/shots.ts), the data builds (src/bespoke/databuild.ts), and the
 * gates that read them back — the camera's samples (`gradeShots`), the
 * labels' rendered size and band (`gradeLayout`), and the deck's variety
 * (`scanStagingVariety`).
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILDS,
  buildRepeats,
  checkBuild,
  chooseBuild,
  type DataBuild,
} from "../src/bespoke/databuild.js";
import {
  assignGrammars,
  chooseGrammar,
  GRAMMARS,
  type Grammar,
  grammarRepeats,
  roleOf,
} from "../src/bespoke/grammar.js";
import {
  encodePng,
  flattenOn,
  hexRgb,
  inspectPicture,
  transparentShare,
} from "../src/bespoke/inspect.js";
import { repetitionOf, rubricProbe, sharedMotifs, stockDrawn } from "../src/bespoke/pipeline.js";
import {
  CAMERA_MAX_SCALE,
  type CamMove,
  CREEP,
  cameraScript,
  closest,
  compileStaging,
  EFF_MIN,
  effectiveAt,
  frameOn,
  planeFrame,
  type Staging,
  sharpMax,
} from "../src/bespoke/shots.js";
import { decodePng } from "../src/verify/fidelity.js";
import { scanStagingVariety } from "../src/verify/index.js";
import {
  CAM_STEP,
  type CamSample,
  gradeLayout,
  gradeShots,
  type Layout,
} from "../src/verify/scenes.js";

const W = 1700;
const H = 700;
const cues = [
  { t0: 1, t1: 5 },
  { t0: 5, t1: 9.5 },
  { t0: 9.5, t1: 14 },
  { t0: 14, t1: 18 },
];
const D = 19;
const subjects = [
  { x: 100, y: 300, w: 400, h: 360 },
  { x: 650, y: 280, w: 380, h: 380 },
  { x: 1200, y: 310, w: 400, h: 350 },
];
const shots = [
  { cue: 2, at: 0, subject: 1 },
  { cue: 3, at: 0, subject: 2 },
  { cue: 3, at: 0.5, subject: 3 },
];

/** The camera at time t of a staging, as the GSAP the shell writes would put it (linear in time). */
function camAt(st: Staging, t: number): { s: number; x: number; y: number } {
  let cur = { s: st.open.s, x: st.open.x, y: st.open.y };
  for (const m of st.moves) {
    if (t < m.t) break;
    const k = m.dur > 0 ? Math.min(1, (t - m.t) / m.dur) : 1;
    cur = {
      s: cur.s + (m.s - cur.s) * k,
      x: cur.x + (m.x - cur.x) * k,
      y: cur.y + (m.y - cur.y) * k,
    };
    if (k < 1) break;
  }
  return cur;
}

function wipeAt(st: Staging, t: number): number | undefined {
  if (!st.wipes.length) return undefined;
  let w = 0;
  for (const s of st.wipes) {
    if (t < s.t) break;
    w = w + (s.share - w) * Math.min(1, (t - s.t) / s.dur);
  }
  return w;
}

/** What `probeScenes` would sample from a staging stamped `grammar`, with a backdrop. */
function samples(st: Staging, grammar: string, plate = true): CamSample[] {
  const out: CamSample[] = [];
  for (let t = CAM_STEP / 2; t < D; t += CAM_STEP) {
    const c = camAt(st, t);
    const p = planeFrame(c, 2, W, H);
    const w = wipeAt(st, t);
    out.push({
      sid: "s4",
      t,
      shot: [Math.round(c.s * 1000) / 1000, Math.round(c.x), Math.round(c.y), W, H],
      subjects: subjects.length,
      grammar,
      ...(plate ? { plate: [p.s, p.x, p.y] as [number, number, number] } : {}),
      ...(w !== undefined ? { wipe: w } : {}),
    });
  }
  return out;
}

const compile = (g: Grammar, sMax = CAMERA_MAX_SCALE) =>
  compileStaging(g, shots, cues, D, subjects, W, H, sMax);

describe("the rhetorical role of a beat", () => {
  it("reads the archetype, then the narration's own words, in four languages", () => {
    expect(roleOf({ archetype: "split-compare" })).toBe("compare");
    expect(roleOf({ archetype: "pipeline" })).toBe("process");
    expect(
      roleOf({
        archetype: "grid",
        narration: "Compared with GPT-4, it is faster than ever, unlike prior work.",
      }),
    ).toBe("compare");
    expect(roleOf({ archetype: "grid", narration: "기존 방법에 비해 반면 더 빠르다, 대비" })).toBe(
      "compare",
    );
    expect(roleOf({ archetype: "grid", narration: "首先编码，然后解码，最后迭代" })).toBe(
      "process",
    );
    expect(roleOf({ archetype: "grid", narration: "実は、鍵は隠れた層にある" })).toBe("reveal");
    expect(
      roleOf({ archetype: "title", narration: "It is 3x faster and 12% more accurate." }),
    ).not.toBe("define");
    expect(roleOf({ archetype: "unknown" })).toBe("define");
  });
});

describe("choosing a grammar", () => {
  it("never repeats the previous grammar, and gives up to seven illustrated beats seven different ones", () => {
    const roles = [
      "compare",
      "compare",
      "compare",
      "compare",
      "compare",
      "compare",
      "compare",
    ] as const;
    const gs = assignGrammars(roles);
    expect(new Set(gs).size).toBe(7);
    expect(gs[0]).toBe("rack");
    gs.slice(1).forEach((g, i) => {
      expect(g).not.toBe(gs[i]);
    });
    // Past seven, it still never repeats the one before.
    const many = assignGrammars([...roles, ...roles]);
    many.slice(1).forEach((g, i) => {
      expect(g).not.toBe(many[i]);
    });
    expect(chooseGrammar("process", ["follow"])).toBe("wipe");
    expect(chooseGrammar("reveal", [])).toBe("zoom-out");
  });

  it("counts the deck's repeats and its distinct grammars", () => {
    expect(grammarRepeats(["tour", "rack", "rack", "wipe"])).toEqual({
      distinct: 3,
      adjacent: [[2, "rack"]],
    });
  });
});

describe("each grammar, compiled and read back by the gate", () => {
  for (const g of GRAMMARS)
    it(`"${g}" compiles to a camera the gate reads as "${g}", ending home`, () => {
      const st = compile(g);
      expect(st.grammar).toBe(g);
      const findings = gradeShots(samples(st, g), new Map([["s4", 1]]));
      expect(findings.map((f) => f.message)).toEqual([]);
      const last = st.moves[st.moves.length - 1];
      expect(last).toMatchObject({ s: 1, x: 0, y: 0 });
      expect(last ? last.t + last.dur : 0).toBeLessThanOrEqual(D - 0.5);
    });

  it("every grammar keeps its own promise on any scene, whatever its cues and shots (200 random scenes)", () => {
    // A deterministic generator: the same 200 scenes every run.
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const broken: string[] = [];
    for (let n = 0; n < 200; n++) {
      const k = 3 + Math.floor(rnd() * 3);
      const cs: Array<{ t0: number; t1: number }> = [];
      let t = 0.8 + rnd() * 0.6;
      for (let i = 0; i < k; i++) {
        const d = 3 + rnd() * 2.5;
        cs.push({ t0: t, t1: t + d });
        t += d;
      }
      const dur = t + 1;
      const m = 3 + Math.floor(rnd() * 2);
      const subs = Array.from({ length: m }, (_, i) => ({
        x: Math.round(40 + (i * (W - 80)) / m + rnd() * 40),
        y: Math.round(200 + rnd() * 120),
        w: Math.round((W - 80) / m - 80),
        h: Math.round(260 + rnd() * 120),
      }));
      // As the static check holds a scene to: none (the shell's default), or two or more subjects named.
      const pick = () => ({
        cue: 1 + Math.floor(rnd() * k),
        at: Math.round(rnd() * 90) / 100,
        subject: 1 + Math.floor(rnd() * m),
      });
      const sh = rnd() < 0.2 ? [] : Array.from({ length: 2 + Math.floor(rnd() * 3) }, pick);
      if (sh.length && new Set(sh.map((x) => x.subject)).size < 2)
        (sh[1] as { subject: number }).subject = ((sh[0]?.subject ?? 1) % m) + 1;
      for (const g of GRAMMARS) {
        const st = compileStaging(g, sh, cs, dur, subs, W, H, 1.85);
        const out: CamSample[] = [];
        for (let x = CAM_STEP / 2; x < dur; x += CAM_STEP) {
          const c = camAt(st, x);
          const pf = planeFrame(c, 2, W, H);
          const w = wipeAt(st, x);
          out.push({
            sid: "s1",
            t: x,
            shot: [Math.round(c.s * 1000) / 1000, Math.round(c.x), Math.round(c.y), W, H],
            subjects: m,
            grammar: g,
            plate: [pf.s, pf.x, pf.y],
            ...(w !== undefined ? { wipe: w } : {}),
          });
        }
        for (const f of gradeShots(out, new Map([["s1", cs[0]?.t0 ?? 0]])))
          broken.push(`scene ${n} ${g}: ${f.message}`);
        const last = st.moves[st.moves.length - 1];
        if (last && (last.s !== 1 || last.t + last.dur > dur - 0.5))
          broken.push(`scene ${n} ${g}: not home by the end`);
      }
    }
    expect(broken.slice(0, 8)).toEqual([]);
  });

  it("each grammar is told apart from round 4's tour by the gate (a tour stamped as another grammar fails)", () => {
    const tour = compile("tour");
    for (const g of GRAMMARS.filter((x) => x !== "tour")) {
      const f = gradeShots(samples(tour, g), new Map([["s4", 1]]));
      expect(f.length, g).toBeGreaterThan(0);
    }
  });

  it("each grammar's camera differs from every other's", () => {
    const sig = (st: Staging) =>
      JSON.stringify([st.open, st.moves.map((m) => [m.kind, m.s]), st.wipes.length]);
    const sigs = GRAMMARS.map((g) => sig(compile(g)));
    expect(new Set(sigs).size).toBe(GRAMMARS.length);
  });

  it("a zoom-out that pushes back in, or a wipe that never uncovers the picture, is refused", () => {
    const z = compile("zoom-out");
    const pushed = {
      ...z,
      moves: [
        ...z.moves.slice(0, -1),
        { ...(z.moves[0] as CamMove), t: 12, s: 2 },
        z.moves[z.moves.length - 1] as CamMove,
      ],
    };
    expect(
      gradeShots(samples(pushed, "zoom-out"), new Map([["s4", 1]])).some((f) =>
        /only pulls back/.test(f.message),
      ),
    ).toBe(true);
    const w = compile("wipe");
    const shown = { ...w, wipes: [{ t: 0, dur: 0.1, share: 1, subject: 0 }] };
    expect(
      gradeShots(samples(shown, "wipe"), new Map([["s4", 1]])).some((f) =>
        /never wipes/.test(f.message),
      ),
    ).toBe(true);
    const none = { ...w, wipes: [{ t: 2, dur: 0.5, share: 0.3, subject: 1 }] };
    expect(
      gradeShots(samples(none, "wipe"), new Map([["s4", 1]])).some((f) =>
        /never wipes/.test(f.message),
      ),
    ).toBe(true);
  });

  it("a backdrop that zooms with the subjects is no parallax, and the gate says so", () => {
    const st = compile("tour");
    const flat = samples(st, "tour").map((r) => ({
      ...r,
      plate: [r.shot[0], r.shot[1], r.shot[2]] as [number, number, number],
    }));
    expect(gradeShots(flat).some((f) => /no parallax/.test(f.message))).toBe(true);
  });
});

describe("the shell's camera script", () => {
  it("moves the backdrop by a twin of every camera tween, as a plane twice as far away (round 6)", () => {
    const st = compile("follow");
    const depth = { planes: [{ z: 2 }], subjects: [], duration: D };
    const js = cameraScript("s4", st.moves, W, H, { open: st.open, depth });
    const cam = js.split("\n").filter((l) => l.startsWith('tl.fromTo("#s4-cam"'));
    const plate = js.split("\n").filter((l) => l.startsWith('tl.fromTo("#s4-plate"'));
    expect(plate.length).toBe(cam.length);
    const push = st.moves[0] as CamMove;
    const pf = planeFrame(push, 2, W, H);
    expect(pf.s).toBeLessThan(push.s);
    expect(js).toContain(`scale: ${pf.s}, x: ${pf.x}, y: ${pf.y}`);
  });

  it("opens a zoom-out close, and wipes a wiped picture on in steps", () => {
    const z = compile("zoom-out");
    expect(z.open.s).toBeGreaterThanOrEqual(1.5);
    const zs = cameraScript("s4", z.moves, W, H, { open: z.open });
    expect(zs).toContain(`gsap.set("#s4-cam", { scale: ${z.open.s}`);
    const w = compile("wipe");
    expect(w.wipes.length).toBeGreaterThan(1);
    expect(w.wipes[w.wipes.length - 1]?.share).toBe(1);
    const depth = {
      planes: [{ z: 2 }],
      subjects: subjects.map((box, i) => ({ subject: i + 1, z: 1, box })),
      duration: D,
    };
    const ws = cameraScript("s4", w.moves, W, H, { wipes: w.wipes, depth });
    // Round 6: a wipe lights the subjects in turn; nothing is clipped away.
    expect(ws).not.toContain("#s4-wipe");
    expect(
      ws.split("\n").filter((l) => /^tl\.fromTo\("#s4-subj\d > \.ds-life", \{ opacity/.test(l)),
    ).toHaveLength(subjects.length);
  });
});

describe("effective resolution", () => {
  it("caps every push-in where a picture pixel spans at most 1/EFF_MIN output pixels", () => {
    // Round 6: depth planes stored at 1.6 picture px per frame px (after the 2x upscale).
    const art = { width: 1915, height: 821, depth: { scale: 1.6 } };
    const box = { width: 1728, height: 700 };
    const top = sharpMax(art, box);
    expect(top).toBeLessThan(CAMERA_MAX_SCALE);
    expect(effectiveAt(art, box, top)).toBeGreaterThanOrEqual(EFF_MIN - 0.001);
    expect(effectiveAt(art, box, CAMERA_MAX_SCALE)).toBeLessThan(EFF_MIN);
    for (const g of GRAMMARS) {
      const st = compileStaging(g, shots, cues, D, subjects, box.width, box.height, top);
      // The creep a held shot adds stays under the ceiling too.
      expect(closest(st) * CREEP, g).toBeLessThanOrEqual(top + 0.001);
    }
    expect(frameOn({ x: 600, y: 300, w: 120, h: 120 }, W, H, top).s).toBe(top);
    // Small subjects frame at the ceiling itself: the held shot's creep stays under it too.
    const small = [
      { x: 200, y: 300, w: 120, h: 120 },
      { x: 800, y: 320, w: 120, h: 120 },
      { x: 1400, y: 300, w: 120, h: 120 },
    ];
    for (const g of GRAMMARS) {
      const st = compileStaging(g, shots, cues, D, small, box.width, box.height, top);
      expect(closest(st) * CREEP, g).toBeLessThanOrEqual(top + 0.001);
    }
    // Never under 1: too coarse to push in on is staged wide, never zoomed out of.
    expect(sharpMax({ width: 400, height: 200 }, box)).toBe(1);
    // A picture that could not be upscaled is still staged at a real push-in
    // (the staging wins over the last hundredths of sharpness), and reported soft.
    const coarse = { width: 1915, height: 821 };
    const at = sharpMax(coarse, box);
    expect(at).toBe(1.55);
    const st = compileStaging("tour", shots, cues, D, subjects, box.width, box.height, at);
    expect(closest(st)).toBeGreaterThanOrEqual(1.5);
    expect(effectiveAt(coarse, box, closest(st))).toBeLessThan(EFF_MIN);
  });
});

describe("data builds", () => {
  it("gives each data beat of a deck its own build, best fit first", () => {
    const prior: DataBuild[] = [];
    for (const a of ["bar-compare", "bar-compare", "line-chart"]) prior.push(chooseBuild(a, prior));
    expect(new Set(prior).size).toBe(3);
    expect(prior[0]).toBe("delta");
    // A fourth reuses one, never the one before it.
    expect(chooseBuild("data-table", prior)).not.toBe(prior[2]);
    expect(buildRepeats(["delta", "line-callout", "delta"])).toEqual(["delta"]);
    // Round 6: no bar race — bars that grow and slide to their rank are UI motion.
    expect(BUILDS).not.toContain("bar-race");
  });

  const cam =
    'tl.fromTo("#SCENEID-cam", { scale: 1, x: 0, y: 0 }, { scale: 1.8, x: -300, y: -100, duration: 1 }, 4);';
  const ok: Record<DataBuild, { markup: string; script: string }> = {
    "line-callout": {
      markup: '<g data-build="line-callout"><path id="SCENEID-l"/><g data-callout="1"/></g>',
      script: `tl.fromTo("#SCENEID-l", { drawSVG: "0% 100%" }, { drawSVG: "0% 100%", duration: 2 }, 1);\n${cam}`,
    },
    delta: {
      markup: '<g data-build="delta"><g data-delta="1"/></g>',
      script: `tl.fromTo("#SCENEID-d", { textContent: 0 }, { textContent: 12, snap: { textContent: 1 }, duration: 1 }, 3);\n${cam}`,
    },
    "small-multiples": {
      markup:
        '<g data-build="small-multiples"><g data-panel="1"/><g data-panel="1"/><g data-panel="1"/></g>',
      script: cam,
    },
  };

  for (const b of BUILDS)
    it(`"${b}" passes with its marks and a camera, and fails without them`, () => {
      expect(checkBuild(ok[b], b)).toEqual([]);
      // Declared as another build.
      expect(checkBuild(ok[b], b === "delta" ? "line-callout" : "delta").length).toBeGreaterThan(0);
      // No camera.
      expect(
        checkBuild({ ...ok[b], script: ok[b].script.replace(cam, "") }, b).some((f) =>
          /camera/.test(f.message),
        ),
      ).toBe(true);
      // Its marks gone.
      const bare = { ...ok[b], markup: `<g data-build="${b}"></g>` };
      expect(checkBuild(bare, b).length).toBeGreaterThan(0);
    });
});

describe("the deck's variety, in verify", () => {
  const scene = (n: number, g?: string, b?: string) =>
    `<div class="ds-bespoke" id="s${n}-g"${g ? ` data-ds-grammar="${g}"` : ""}${b ? ` data-ds-build="${b}"` : ""}>`;
  it("refuses two consecutive illustrated scenes in one grammar, and two data scenes that build alike", () => {
    const fine = scanStagingVariety([
      scene(2, "rack") + scene(3) + scene(5, "follow"),
      scene(7, "wipe") + scene(8, undefined, "delta") + scene(9, undefined, "small-multiples"),
    ]);
    expect(fine.filter((f) => f.severity === "error")).toEqual([]);
    const bad = scanStagingVariety([
      scene(2, "rack") +
        scene(4, "rack") +
        scene(6, undefined, "delta") +
        scene(9, undefined, "delta"),
    ]);
    expect(bad.map((f) => f.rule).sort()).toEqual([
      "build_repeat",
      "grammar_diversity",
      "grammar_repeat",
    ]);
    expect(bad.find((f) => f.rule === "grammar_repeat")?.message).toMatch(/#s4/);
  });
});

describe("quiet type and no UI motion (round 6)", () => {
  const row = (over: Partial<Layout>): Layout => ({
    sid: "s4",
    key: "end",
    t: 18,
    crossings: [],
    occlusions: [],
    overlaps: [],
    small: [],
    off: [],
    ...over,
  });
  it("refuses a word rendered over the headline size, at any graded frame", () => {
    expect(
      gradeLayout([row({ key: "c2a", maxType: 56 })]).filter((f) => f.rule === "type_scale"),
    ).toEqual([]);
    expect(gradeLayout([row({ key: "c2a", maxType: 64 })]).map((f) => f.rule)).toContain(
      "type_scale",
    );
    expect(gradeLayout([row({ key: "c2a", maxType: 96 })]).map((f) => f.rule)).toContain(
      "type_scale",
    );
  });
  it("asks a scene on a picture for no cue groups of its own; a diagram still needs them", () => {
    const end = { fill: 0.95, maxType: 44, groups: [] as number[], cueStarts: [1, 5] };
    expect(gradeLayout([row({ ...end, subjects: 3 })]).map((f) => f.rule)).not.toContain(
      "cue_groups",
    );
    expect(gradeLayout([row({ ...end, subjects: 0 })]).map((f) => f.rule)).toContain("cue_groups");
  });
  it("refuses UI animated into place, named", () => {
    const f = gradeLayout([row({ uiMotion: ["plate s4-chip (y/scale)", "bar s4-bar1 (scaleY)"] })]);
    expect(f.filter((x) => x.rule === "ui_motion")).toHaveLength(1);
    expect(f.find((x) => x.rule === "ui_motion")?.message).toMatch(/s4-chip.*s4-bar1/);
    expect(gradeLayout([row({ uiMotion: [] })]).filter((x) => x.rule === "ui_motion")).toEqual([]);
  });
});

describe("repetition across a deck's pictures", () => {
  it("finds a subject two pictures share, by its head noun, and not generic words", () => {
    expect(sharedMotifs(["red robots", "a cup"], [["blue robot"], ["kettle"]])).toEqual(["robot"]);
    expect(sharedMotifs(["stack of cards"], [["box"], ["row of tiles"]])).toEqual([]);
  });
  it("names a stock stand-in a picture draws, unless its beat names it", () => {
    expect(stockDrawn({ motifs: ["friendly robot"], depicts: "" }, [])).toEqual(["robot"]);
    expect(stockDrawn({ motifs: ["robot arm"], depicts: "" }, ["robot"])).toEqual([]);
    expect(stockDrawn({ motifs: ["harbour crane"], depicts: "a crane loads crates" }, [])).toEqual(
      [],
    );
  });
  it("measures the closest pair of prints and every shared subject", () => {
    const art = (print: number[], motifs: string[]) =>
      ({
        key: "k",
        name: "n",
        file: "f",
        width: 1,
        height: 1,
        depicts: "",
        print,
        motifs,
      }) as never;
    const r = repetitionOf([
      art([0, 0], ["boat"]),
      art([0.3, 0.4], ["crane"]),
      art([1, 0], ["blue boat"]),
    ]);
    expect(r?.minPrint).toBe(0.5);
    expect(r?.shared).toEqual(["boat"]);
  });
});

describe("a subjects layer on a transparent ground", () => {
  it("is laid on the pack's ground for inspection, and written back as a PNG the reader can open", async () => {
    const w = 4;
    const h = 2;
    const px = new Uint8Array(w * h * 4);
    // Half transparent, half opaque red.
    for (let i = 0; i < w * h; i++) {
      const opaque = i % w < 2;
      px.set(opaque ? [255, 0, 0, 255] : [0, 0, 0, 0], i * 4);
    }
    const f = { width: w, height: h, channels: 4, pixels: px };
    expect(transparentShare(f)).toBeGreaterThan(0.3);
    const flat = flattenOn(f, hexRgb("#102030"));
    expect(flat.channels).toBe(3);
    expect([...flat.pixels.slice(0, 3)]).toEqual([255, 0, 0]);
    expect([...flat.pixels.slice(9, 12)]).toEqual([16, 32, 48]);
    const back = await decodePng(encodePng(flat));
    expect(back.width).toBe(w);
    expect([...back.pixels]).toEqual([...flat.pixels]);
  });
});

describe("the rubric probe, by grammar", () => {
  const m = {
    fill: 0.9,
    cells: 0.9,
    mass: 0.5,
    dimmed: 0,
    kinds: ["fade", "draw", "transform"],
    cueChange: [0.02, 0.03],
    subjects: 3,
    anchored: 3,
  };
  it("asks push-ins only of the grammars made of them, and an opening of each grammar's own", () => {
    expect(rubricProbe({ ...m, grammar: "wipe", shots: 0, establishing: true }, [], true)).toEqual(
      [],
    );
    expect(
      rubricProbe({ ...m, grammar: "tour", shots: 0, establishing: true }, [], true),
    ).toContain("only 0 push-in(s) on the picture's subjects");
    expect(
      rubricProbe({ ...m, grammar: "zoom-out", shots: 1, establishing: false }, [], true),
    ).toContain("a zoom-out does not open close on its detail");
  });
});

describe("inspecting a subjects layer", () => {
  it("finds the subjects of a picture on a transparent ground, laid on the pack's ground first", async () => {
    const w = 320;
    const h = 160;
    const px = new Uint8Array(w * h * 4);
    // Two flat blobs with transparent ground between and around them.
    for (let y = 40; y < 120; y++)
      for (let x = 0; x < w; x++)
        if ((x > 30 && x < 110) || (x > 200 && x < 290))
          px.set([200, 60, 40, 255], (y * w + x) * 4);
    const dir = await mkdtemp(join(tmpdir(), "decksmith-cutout-"));
    try {
      const file = join(dir, "s.png");
      const seen = await inspectPicture(
        encodePng({ width: w, height: h, channels: 4, pixels: px }),
        file,
        join(dir, "tools"),
        [16, 32, 48],
      );
      expect(seen.cutout).toBe(true);
      expect(seen.subjects).toHaveLength(2);
      expect(seen.flatFile).toBe(`${file}.flat.png`);
      expect((await stat(`${file}.flat.png`)).size).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
