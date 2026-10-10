/**
 * v2's motion grammar (src/emit/motion.ts) and the deck player's half of it
 * (src/deck/motion.ts).
 *
 * The first block is the one that matters most and the most boring: `classic`
 * is the default and is v0.8.0, byte for byte. Everything after it is about
 * `design: "v2"` decks, and each assertion is the founder's complaint turned
 * into a number the plan set: modal entrance ≤ 40% (from 92%), ≥ 3 seam kinds
 * per deck of 10+ beats (from 1), top-2 ease share ≤ 60% (from 85%), and motion
 * WHILE the narrator talks, on a cue boundary, never on a frame a gate holds.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gsap } from "gsap";
import { describe, expect, it } from "vitest";
import { holdTime, parseMotion, seamLead, spanFor } from "../src/deck/motion.js";
import { buildStops, type SlideSpec } from "../src/deck/runtime.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import { type DeckNarration, emitDeck, openSeconds } from "../src/emit/composition.js";
import type { Scene, Tween } from "../src/emit/kit.js";
import {
  CHROME_OUT,
  chromeOut,
  EMPH_TOTAL,
  ENTRANCES,
  emphasize,
  ensureSeamKinds,
  fnv1a,
  isEntrance,
  MOTION_EASES,
  type MotionBeat,
  planMotion,
  restyleChrome,
  restyleEntrance,
  SEAM_CLEAR,
  SEAMS,
  seamIn,
  seamOut,
} from "../src/emit/motion.js";
import { resolveTheme } from "../src/emit/theme.js";
import { stopCount } from "../src/narrate/narrate.js";
import { designFor, loadPrefs, prefsFromFlags } from "../src/prefs.js";
import {
  type Archetype,
  FORMATS,
  type Format,
  type Storyboard,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";
import { scanDeterminism } from "../src/verify/index.js";
import { motionStats, topTwoEaseShare } from "../src/verify/motion.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const demo = storyboardSchema.parse(JSON.parse(readFileSync(repo("demo/storyboard.json"), "utf8")));
const source = sourceSchema.parse(JSON.parse(readFileSync(repo("demo/source.json"), "utf8")));
const deck16 = FORMATS["deck-16x9"] as Format;
const ink = resolveTheme("ink");

/**
 * Narration for `board`, one two-cue segment per stop, so every scene has
 * speech to time emphasis to. `seconds` is long enough that the voice runs past
 * the last reveal, as it does on real HypePaper decks (`beatSeconds` then
 * extends the scene to hold the sentence).
 */
function narrationFor(board: Storyboard): DeckNarration {
  const beats: DeckNarration["beats"] = {};
  board.beats.forEach((beat, i) => {
    const holds = emitScene(beat, {
      source,
      format: deck16,
      theme: ink,
      sid: `s${i + 1}`,
      start: 0,
    }).holds;
    beats[beat.id] = Array.from({ length: stopCount(holds) }, (_, stop) => ({
      stop,
      text: `Sentence ${stop} about ${beat.id}.`,
      audio: `${beat.id}-${stop}.mp3`,
      seconds: 4.2,
      cues: [
        { start: 0, end: 1.9, text: "First half," },
        { start: 2.1, end: 4.2, text: "second half." },
      ],
    }));
  });
  return { voice: "en-US-AvaMultilingualNeural", dir: "audio", beats };
}

const narration = narrationFor(demo);

/* ------------------------------------------------------------- the switch */

describe("design: classic is the default and v2 is opt-in", () => {
  it("leaves classic bytes alone whether `design` is absent or said", () => {
    const absent = emitDeck(demo, source, deck16, "/*rt*/", { narration });
    const said = emitDeck(demo, source, deck16, "/*rt*/", { narration, design: "classic" });
    expect(said.composition).toBe(absent.composition);
    expect(said.page).toBe(absent.page);
    expect(absent.page).not.toContain("decksmith-motion+json");
  });

  it("builds a different deck under v2, from the option or from the storyboard", () => {
    const classic = emitDeck(demo, source, deck16, "/*rt*/", { narration }).composition;
    const byOption = emitDeck(demo, source, deck16, "/*rt*/", { narration, design: "v2" });
    const byBoard = emitDeck({ ...demo, design: "v2" }, source, deck16, "/*rt*/", { narration });
    expect(byOption.composition).not.toBe(classic);
    expect(byBoard.composition).toBe(byOption.composition);
    expect(byOption.page).toContain('type="application/decksmith-motion+json"');
  });

  it("lets the option override a v2 storyboard back to classic", () => {
    const classic = emitDeck(demo, source, deck16, "/*rt*/", { narration }).composition;
    const back = emitDeck({ ...demo, design: "v2" }, source, deck16, "/*rt*/", {
      narration,
      design: "classic",
    }).composition;
    expect(back).toBe(classic);
  });

  it("is a preference: unset (classic) by default, `--design v2` by flag, anything else refused", async () => {
    expect((await loadPrefs({}, "/")).design).toBeUndefined();
    expect((await loadPrefs(prefsFromFlags({ design: "v2" }), "/")).design).toBe("v2");
    await expect(loadPrefs(prefsFromFlags({ design: "v3" }), "/")).rejects.toThrow(/design/);
  });

  it("lets `--design classic` roll a v2 storyboard back", async () => {
    const said = await loadPrefs(prefsFromFlags({ design: "classic" }), "/");
    const unsaid = await loadPrefs({}, "/");
    expect(designFor(said, "v2")).toBe("classic");
    expect(designFor(unsaid, "v2")).toBe("v2");
    expect(designFor(unsaid, undefined)).toBe("classic");
    const v2prefs = await loadPrefs(prefsFromFlags({ design: "v2" }), "/");
    expect(designFor(v2prefs, undefined)).toBe("v2");
  });

  it("keeps a stored storyboard parsing to the same object (no default is injected)", () => {
    expect("design" in demo).toBe(false);
  });
});

/* ---------------------------------------------------------------- the plan */

const ARCHS: Archetype[] = [
  "title",
  "split-compare",
  "claim-figure",
  "pipeline",
  "bar-compare",
  "callout",
  "equation-walk",
  "line-chart",
];

/** A deterministic pseudo-storyboard of `n` beats for seed `k`. */
function beatsFor(k: number, n: number): MotionBeat[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    archetype: i === 0 ? "title" : (ARCHS[fnv1a(`${k}:${i}`) % ARCHS.length] as Archetype),
  }));
}

describe("planMotion", () => {
  it("is a pure function of the storyboard", () => {
    const beats = beatsFor(1, 14);
    expect(planMotion("paper-a", beats)).toEqual(planMotion("paper-a", beats));
    expect(planMotion("paper-a", beats)).not.toEqual(planMotion("paper-b", beats));
  });

  it("fades every beat in, and never repeats a seam back to back", () => {
    // One entrance verb since 2026-10-10 ("animated UI elements" are the
    // founder's old-fashioned): variety between scenes is the seams' job.
    for (let k = 0; k < 300; k++) {
      const beats = beatsFor(k, 6 + (k % 20));
      const { entrances, seams } = planMotion(`seed-${k}`, beats);
      expect(new Set(entrances)).toEqual(new Set(["fade"]));
      for (let i = 1; i < seams.length; i++) expect(seams[i]).not.toBe(seams[i - 1]);
    }
  });

  it("uses at least three seam kinds in every deck of ten or more beats", () => {
    for (let k = 0; k < 300; k++) {
      const { seams } = planMotion(`seed-${k}`, beatsFor(k, 10 + (k % 15)));
      expect(new Set(seams).size, `seed-${k}: ${seams.join(",")}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("tops up a two-kind run of seams to three without making a repeat", () => {
    const seams = [
      "push",
      "dissolve",
      "push",
      "dissolve",
      "push",
      "dive",
      "push",
      "dissolve",
    ] as Parameters<typeof ensureSeamKinds>[0];
    ensureSeamKinds(seams, 3);
    expect(new Set(seams.filter((s) => s !== "dive")).size).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < seams.length; i++) expect(seams[i]).not.toBe(seams[i - 1]);
    expect(seams[5]).toBe("dive");
  });

  it("reaches every entrance verb and every seam kind across decks", () => {
    const verbs = new Set<string>();
    const seams = new Set<string>();
    for (let k = 0; k < 50; k++) {
      const plan = planMotion(`seed-${k}`, beatsFor(k, 16));
      for (const e of plan.entrances) verbs.add(e);
      for (const s of plan.seams) seams.add(s);
    }
    expect([...verbs].sort()).toEqual([...ENTRANCES].sort());
    expect([...seams].sort()).toEqual([...SEAMS].sort());
  });

  it("keeps the camera's move where a beat is inside the one before it", () => {
    const beats: MotionBeat[] = [
      { id: "a", archetype: "pipeline" },
      { id: "b", archetype: "grid", inside: { beat: "a" } },
      { id: "c", archetype: "callout" },
    ];
    expect(planMotion("x", beats).seams[0]).toBe("dive");
  });

  it("picks the seam from the relation between the beats", () => {
    const beats: MotionBeat[] = [
      { id: "t", archetype: "title" },
      { id: "q1", archetype: "bar-compare", role: "background" },
      { id: "q2", archetype: "line-chart", role: "background" },
      { id: "l", archetype: "callout", role: "limitations" },
      { id: "z", archetype: "callout", role: "conclusion" },
    ];
    // title → lift; same family → push; role boundary → zoom; into the close → dissolve.
    expect(planMotion("x", beats).seams).toEqual(["lift", "push", "zoom", "dissolve"]);
  });
});

/* -------------------------------------------------------------- entrances */

function demoScenes(): { sid: string; scene: Scene }[] {
  return demo.beats.map((beat, i) => {
    const sid = `s${i + 1}`;
    return { sid, scene: emitScene(beat, { source, format: deck16, theme: ink, sid, start: 0 }) };
  });
}

describe("restyleEntrance", () => {
  it("moves no hold, no voice and no tween's end, for every verb on every archetype", () => {
    for (const { sid, scene } of demoScenes()) {
      for (const verb of ENTRANCES) {
        const out = restyleEntrance(scene, sid, verb);
        expect(out.holds).toEqual(scene.holds);
        expect(openSeconds(out)).toBe(openSeconds(scene));
        expect(out.tl).toHaveLength(scene.tl.length);
        out.tl.forEach((t, j) => {
          const before = scene.tl[j] as Tween;
          const end = (x: Tween) => Math.round((x.at + Number(x.to.duration ?? 0.5)) * 1000);
          expect(t.target).toBe(before.target);
          expect(end(t)).toBe(end(before));
          if (!isEntrance(before)) expect(t).toBe(before);
        });
      }
    }
  });

  it("fades the chrome in place: opacity alone, on a gentle ease", () => {
    const { sid, scene } = demoScenes()[2] as { sid: string; scene: Scene };
    const h = restyleEntrance(scene, sid, "fade").tl.find((t) => t.target === `#${sid}-h`) as Tween;
    expect(h.from).toEqual({ opacity: 0 });
    expect(h.to.ease).toBe("sine.out");
    expect(Object.keys(h.to).sort()).toEqual(["duration", "ease", "opacity"]);
  });

  it("takes every slide, pop and grow out of an entrance, on every archetype", () => {
    // The founder, 2026-10-10: no plates, chips, cards, labels or boxes sliding
    // or popping in as the motion. Includes the `immediateRender: false`
    // reveals of a card's own lines, which used to be skipped.
    const moves = /^(x|y|xPercent|yPercent|scale|scaleX|scaleY|rotation|clipPath|filter)$/;
    let entrances = 0;
    for (const { sid, scene } of demoScenes()) {
      const out = restyleEntrance(scene, sid, "fade");
      out.tl.forEach((t, j) => {
        const before = scene.tl[j] as Tween;
        if (!isEntrance(before)) return;
        const transient = scene.tl.some(
          (o) => o !== before && o.target === before.target && o.to.opacity === 0,
        );
        if (transient) return;
        entrances++;
        expect(
          Object.keys(t.from).filter((k) => moves.test(k)),
          `${sid} ${t.target}`,
        ).toEqual([]);
        expect(
          Object.keys(t.to).filter((k) => moves.test(k)),
          `${sid} ${t.target}`,
        ).toEqual([]);
      });
    }
    expect(entrances).toBeGreaterThan(40);
  });

  it("leaves a transient part's path alone (pipeline's travelling pulse)", () => {
    const pipeline = demoScenes().find((s) => s.scene.html.includes("-pulse0")) as {
      sid: string;
      scene: Scene;
    };
    const pulse = (sc: Scene) => sc.tl.filter((t) => t.target.endsWith("-pulse0"));
    for (const verb of ENTRANCES) {
      expect(pulse(restyleEntrance(pipeline.scene, pipeline.sid, verb))).toEqual(
        pulse(pipeline.scene),
      );
    }
  });

  it("starts the chrome no sooner than SEAM_CLEAR and ends it where it ended", () => {
    for (const { sid, scene } of demoScenes()) {
      const out = restyleEntrance(scene, sid, "fade");
      for (const t of out.tl.filter((x) => /-[eh]$/.test(x.target))) {
        expect(t.at).toBeGreaterThanOrEqual(SEAM_CLEAR);
      }
    }
  });
});

/* -------------------------------------------------------------------- seams */

describe("seams", () => {
  it("writes the v0.8.0 dissolve, byte for byte, when the plan says dissolve", () => {
    const [t] = seamOut("dissolve", "s3", 12.345, 0.4);
    expect(t).toEqual({
      target: "#s3",
      from: { opacity: 1 },
      to: { opacity: 0, duration: 0.4, ease: "power2.in", immediateRender: false },
      at: 12.345,
    });
  });

  it("settles every incoming move before the scene's first stop", () => {
    for (const kind of SEAMS) {
      for (const t of seamIn(kind, "s2", 0.4, 1.4)) {
        expect(t.at + Number(t.to.duration)).toBeLessThanOrEqual(1.35 + 1e-9);
      }
      expect(seamIn(kind, "s2", 0.4, 0.3)).toEqual([]);
    }
  });

  /**
   * THE LEGIBILITY RULE: two lines of type are never on screen together. Over
   * the handoff, the outgoing scene's type (its root's visibility times its
   * chrome's own fade, `chromeOut`) and the incoming scene's eyebrow and
   * headline are never BOTH above 2% — for every seam, every entrance verb, and
   * the stock `chromeIn` a bespoke scene is wrapped in (`restyleChrome`).
   *
   * Was "never both at or above one half", which passed while r3's s12→s13 and
   * s13→s14 frames showed two headlines and two eyebrows overprinted: a 40%
   * headline over a 45% one is not legible either.
   */
  it("never shows two headlines at once, for every seam × entrance verb", () => {
    const over = 0.4;
    const scene = demoScenes()[2] as { sid: string; scene: Scene };
    const html = `<div id="s1-e"></div><h2 id="s1-h"></h2>`;
    const at = (t: Tween, tau: number): number => {
      const d = Number(t.to.duration ?? 0.5);
      const q = Math.min(1, Math.max(0, (tau - t.at) / d));
      const ease = gsap.parseEase(String(t.to.ease ?? "power1.out"));
      const from = Number(t.from.opacity);
      const to = Number(t.to.opacity);
      return q <= 0 ? from : from + (to - from) * ease(q);
    };
    const outChrome = chromeOut("s1", html, 0, over);
    expect(outChrome.map((t) => t.target)).toEqual(["#s1-e", "#s1-h"]);
    for (const seam of SEAMS) {
      const [out] = seamOut(seam, "s1", 0, over) as [Tween];
      for (const verb of ENTRANCES) {
        const incoming = [
          restyleEntrance(scene.scene, scene.sid, verb),
          restyleChrome(scene.scene, scene.sid, verb),
        ].map((sc) => sc.tl.filter((t) => /-[eh]$/.test(t.target)));
        for (const chrome of incoming)
          for (let tau = 0; tau <= over + 1e-9; tau += 1 / 120) {
            const root = at(out, tau);
            const outgoing = Math.max(...outChrome.map((t) => root * at(t, tau)));
            for (const t of chrome) {
              const shown = tau < t.at ? 0 : at(t, tau);
              expect(
                outgoing > 0.02 && shown > 0.02,
                `${seam} × ${verb}: ${t.target} at ${tau.toFixed(3)}s (${outgoing.toFixed(2)} / ${shown.toFixed(2)})`,
              ).toBe(false);
            }
          }
      }
    }
  });

  it("clears only the chrome the scene draws, inside the handoff", () => {
    expect(chromeOut("s4", `<h2 id="s4-h"></h2>`, 10.5, 0.4)).toEqual([
      {
        target: "#s4-h",
        from: { opacity: 1 },
        to: { opacity: 0, duration: 0.16, ease: "sine.inOut", immediateRender: false },
        at: 10.5,
      },
    ]);
    expect(CHROME_OUT * 0.4).toBeLessThan(SEAM_CLEAR);
    expect(chromeOut("s4", "", 10.5, 0.4)).toEqual([]);
  });

  it("has no hard-edged seam: nothing sweeps a clip across a whole slide", () => {
    // r3 (2026-10-10): `wipe` left half a robot and a lone chip on an empty slide.
    expect(SEAMS as readonly string[]).not.toContain("wipe");
    for (const k of [0, 3, 7, 11])
      for (const seam of planMotion(`seed-${k}`, beatsFor(k, 16)).seams)
        expect(seam).not.toBe("wipe");
  });
});

/* ---------------------------------------------------------- whole decks */

/** Each `tl.fromTo` in each scene, as objects. Raw-JS values are skipped. */
function sceneTweens(composition: string): Map<string, Tween[]> {
  const out = new Map<string, Tween[]>();
  const parts = composition.split(/<div\s+id="(s\d+)"\s+class="scene clip"/);
  for (let i = 1; i < parts.length; i += 2) {
    const list: Tween[] = [];
    for (const line of (parts[i + 1] ?? "").split("\n")) {
      const m = /tl\.fromTo\("([^"]+)", (\{.*?\}), (\{.*\}), (-?[\d.]+)\);$/.exec(line.trim());
      if (!m) continue;
      try {
        const from = new Function(`return ${m[2]}`)();
        const to = new Function(`return ${m[3]}`)();
        list.push({ target: m[1] as string, from, to, at: Number(m[4]) });
      } catch {
        // a camera ease names a function declared in the scene's measure
      }
    }
    out.set(parts[i] as string, list);
  }
  return out;
}

const v2 = emitDeck(demo, source, deck16, "/*rt*/", { narration, design: "v2" });
const classic = emitDeck(demo, source, deck16, "/*rt*/", { narration });

describe("a v2 deck, against the plan's M4 targets", () => {
  it("measures v0.8.0 as the audit did", () => {
    const s = motionStats(classic.composition);
    expect(s.modalScenes / s.scenes).toBeGreaterThan(0.85);
    expect(new Set(s.seams)).toEqual(new Set(["dissolve"]));
    expect(topTwoEaseShare(s)).toBeGreaterThan(0.7);
  });

  it("opens at most 40% of scenes on the stock fade-up", () => {
    const s = motionStats(v2.composition);
    expect(s.modalScenes / s.scenes).toBeLessThanOrEqual(0.4);
  });

  it("joins its scenes with at least three kinds of seam", () => {
    expect(new Set(motionStats(v2.composition).seams).size).toBeGreaterThanOrEqual(3);
  });

  it("slides, pops and sweeps nothing in: every reveal in the deck is an opacity fade", () => {
    // Founder, 2026-10-10. Every opacity 0 → 1 reveal in the v2 composition,
    // chrome and parts alike, carries no travel, scale, clip or blur — except a
    // transient that leaves again (pipeline's travelling pulse is the figure's
    // own motion, not an arrival).
    const moves = /^(x|y|xPercent|yPercent|scale|scaleX|scaleY|rotation|clipPath|filter)$/;
    let reveals = 0;
    for (const [sid, list] of sceneTweens(v2.composition)) {
      for (const t of list) {
        if (t.from.opacity !== 0 || t.to.opacity !== 1 || t.target === `#${sid}`) continue;
        if (list.some((o) => o.target === t.target && o.to.opacity === 0)) continue;
        reveals++;
        expect(
          Object.keys(t.from).filter((k) => moves.test(k)),
          `${sid} ${t.target}`,
        ).toEqual([]);
      }
    }
    expect(reveals).toBeGreaterThan(40);
  });

  it("writes only eases from the allow-list, and no tween of its own over a second", () => {
    const allowed = new Set<string>(MOTION_EASES);
    const classicEases = new Set(Object.keys(motionStats(classic.composition).eases));
    for (const ease of Object.keys(motionStats(v2.composition).eases)) {
      expect(allowed.has(ease) || classicEases.has(ease), ease).toBe(true);
    }
    for (const list of sceneTweens(v2.composition).values()) {
      for (const t of list) {
        if (allowed.has(String(t.to.ease)) && !classicEases.has(String(t.to.ease))) {
          expect(Number(t.to.duration ?? 0)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("is deterministic and passes the determinism scan", () => {
    const again = emitDeck(demo, source, deck16, "/*rt*/", { narration, design: "v2" });
    expect(again.composition).toBe(v2.composition);
    expect(again.page).toBe(v2.page);
    expect(scanDeterminism(v2.composition, "index.html")).toEqual([]);
  });

  it("keeps every scene's window, so the timing manifest still lines up", () => {
    const windows = (html: string) =>
      [
        ...html.matchAll(/id="(s\d+)"[^>]*?data-start="([\d.]+)"[^>]*?data-duration="([\d.]+)"/g),
      ].map((m) => m.slice(1).join(":"));
    expect(windows(v2.composition)).toEqual(windows(classic.composition));
  });

  /**
   * `overlapping_gsap_tweens`, checked by us: two tweens on one selector writing
   * one property must not overlap in time, or GSAP resolves the frame by
   * last-write-wins and a seek reproduces it differently from a play. v0.8.0
   * already has a few (annotated-figure's dim runs 50ms into its restore); the
   * rule here is that v2 adds none.
   */
  it("adds no pair of tweens writing one property of one part at once", () => {
    const overlaps = (composition: string): Set<string> => {
      const found = new Set<string>();
      for (const [sid, list] of sceneTweens(composition)) {
        for (let a = 0; a < list.length; a++) {
          for (let b = a + 1; b < list.length; b++) {
            const x = list[a] as Tween;
            const y = list[b] as Tween;
            const ys = y.target.split(",").map((q) => q.trim());
            const shared = x.target
              .split(",")
              .map((q) => q.trim())
              .filter((q) => ys.includes(q));
            const props = Object.keys(x.to).filter(
              (k) =>
                k in y.to &&
                !["duration", "ease", "immediateRender", "stagger", "svgOrigin"].includes(k),
            );
            if (shared.length === 0 || props.length === 0) continue;
            const end = (t: Tween) =>
              t.at + Number(t.to.duration ?? 0.5) + Number(t.to.stagger ?? 0) * 12;
            if (x.at < end(y) - 1e-6 && y.at < end(x) - 1e-6) {
              found.add(`${sid} ${shared.join("|")} ${props.join("|")} @${x.at}/${y.at}`);
            }
          }
        }
      }
      return found;
    };
    const before = overlaps(classic.composition);
    const added = [...overlaps(v2.composition)].filter((o) => !before.has(o));
    expect(added).toEqual([]);
  });
});

/* --------------------------------------------------------------- emphasis */

describe("emphasis during the narration hold", () => {
  const holdsOf = (html: string) =>
    JSON.parse(
      /<script type="application\/hyperframes-slideshow\+json">([\s\S]*?)<\/script>/.exec(
        html,
      )?.[1] ?? "{}",
    ) as { slides: SlideSpec[] };

  it("is counted by motionStats: none in classic, most scenes in v2", () => {
    expect(motionStats(classic.composition).emphasisScenes).toBe(0);
    expect(motionStats(v2.composition).emphasisScenes).toBeGreaterThanOrEqual(
      demo.beats.length / 2,
    );
  });

  it("adds motion after the build, in most narrated scenes of a real-shaped deck", () => {
    const emphasised = [...sceneTweens(v2.composition).values()].filter((list) =>
      list.some(
        (t) =>
          t.to.immediateRender === false &&
          ("scale" in t.to || "filter" in t.to || "textDecorationColor" in t.to) &&
          !t.target.match(/^#s\d+$/),
      ),
    );
    expect(emphasised.length).toBeGreaterThanOrEqual(Math.ceil(demo.beats.length / 2));
  });

  it("times each emphasis to a cue boundary of the sentence about it", () => {
    const sid = "s3";
    const scene = restyleEntrance(demoScenes()[2]?.scene as Scene, sid, "fade");
    const seg = { stop: 0, seconds: 6, cues: [{ start: 0 }, { start: 2.5 }] };
    const lastHold = Math.max(...scene.holds);
    const { scene: out } = emphasize(scene, sid, {
      segments: [seg],
      starts: [lastHold - 0.5],
      end: lastHold + 8,
      kinds: ["glow"],
      accent: ink.accent,
    });
    const added = out.tl.slice(scene.tl.length);
    expect(added.length).toBeGreaterThan(0);
    // The sentence starts before the build has settled, so its first boundary
    // is skipped and the second (2.5s in) is the one used.
    expect(added[0]?.at).toBeCloseTo(lastHold - 0.5 + 2.5, 3);
  });

  it("is back at rest on every hold, so no gate frame changes", () => {
    for (const [sid, list] of sceneTweens(v2.composition)) {
      const slide = holdsOf(v2.page as string).slides.find((s) => s.sceneId === sid);
      const start = slide?.startTime ?? 0;
      const holds = (slide?.fragments ?? []).map((f) => f - start);
      const classicList = sceneTweens(classic.composition).get(sid) ?? [];
      const added = list.filter(
        (t) =>
          t.to.immediateRender === false &&
          ("filter" in t.to ||
            "textDecorationColor" in t.to ||
            ("scale" in t.to && !t.target.match(/^#s\d+$/))) &&
          !classicList.some((c) => c.target === t.target && c.at === t.at),
      );
      for (const t of added) {
        const end = t.at + Number(t.to.duration);
        for (const h of holds)
          expect(h > t.at - 1e-6 && h < end + 1e-6, `${sid} ${t.target}`).toBe(false);
      }
    }
  });

  it("hands the deck player each narrated stop's quiet stretch", () => {
    const island = /<script type="application\/decksmith-motion\+json">([\s\S]*?)<\/script>/.exec(
      v2.page as string,
    )?.[1];
    const motion = parseMotion(island);
    expect(motion?.seams).toBe(true);
    const stops = buildStops(holdsOf(v2.page as string).slides);
    const spans = stops.map((s) => (motion ? spanFor(motion, s) : undefined)).filter(Boolean);
    expect(spans.length).toBeGreaterThanOrEqual(demo.beats.length / 2);
    for (const span of spans) {
      expect((span?.to ?? 0) - (span?.at ?? 0)).toBeGreaterThanOrEqual(0.5);
      expect((span?.to ?? 0) - (span?.from ?? 0)).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("is EMPH_TOTAL long and needs a stretch that long", () => {
    expect(EMPH_TOTAL).toBeCloseTo(1.5, 6);
  });
});

/* ------------------------------------------------------------- the player */

describe("the deck player's half (src/deck/motion.ts)", () => {
  const span = { stop: 1, at: 10, from: 8, to: 20 };

  it("follows the audio clock through the stop's stretch and no further", () => {
    expect(holdTime(span, 0)).toBe(10); // the sentence began before the hold: clamp
    expect(holdTime(span, 3)).toBe(11);
    expect(holdTime(span, 30)).toBe(20);
  });

  it("finds a stop's stretch by its time, not its index", () => {
    const motion = { seams: true, holds: { s2: [span] } };
    const stop = { t: 10.0004, slide: 1, fragment: 1, notes: "", sceneId: "s2" };
    expect(spanFor(motion, stop)).toBe(span);
    expect(spanFor(motion, { ...stop, t: 10.5 })).toBeUndefined();
    expect(spanFor(motion, { ...stop, sceneId: "s3" })).toBeUndefined();
  });

  it("refuses a malformed island instead of breaking the deck", () => {
    expect(parseMotion("not json")).toBeNull();
    expect(parseMotion(undefined)).toBeNull();
    expect(
      parseMotion('{"seams":true,"holds":{"s1":[{"at":1,"from":0,"to":0.5}]}}')?.holds,
    ).toEqual({});
  });

  it("glides into the next slide from its start when the old policy would cut", () => {
    const slides: SlideSpec[] = [
      { sceneId: "s1", startTime: 0, endTime: 20, fragments: [1.5, 3] },
      { sceneId: "s2", startTime: 20, endTime: 40, fragments: [21.6, 24] },
    ];
    const stops = buildStops(slides);
    const last = stops[1];
    const next = stops[2];
    if (!last || !next) throw new Error("stops");
    expect(seamLead(3, last, next, slides, 2.5)).toBe(20);
    // A short step already glides through the seam: nothing to change.
    expect(seamLead(19.5, last, next, slides, 2.5)).toBeNull();
    // Backwards, or a fragment inside the slide: not a seam.
    expect(seamLead(24, stops[3], stops[2] as never, slides, 2.5)).toBeNull();
    expect(seamLead(21.6, next, stops[3] as never, slides, 2.5)).toBeNull();
  });

  it("is wired into the runtime: the island is read, steps lead, holds follow the audio", () => {
    const runtime = readFileSync(repo("src/deck/runtime.ts"), "utf8");
    expect(runtime).toContain("parseMotion(doc.querySelector(MOTION_ISLAND)");
    expect(runtime).toMatch(/seamLead\(shown, was, stop, slides, MAX_SPAN\)/);
    expect(runtime).toMatch(/progress\(audio\.currentTime\)/);
    expect(runtime).toMatch(/voice\.onProgress\(/);
    // Reduced motion is asked at both call sites.
    expect(runtime.match(/prefers-reduced-motion: reduce/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
