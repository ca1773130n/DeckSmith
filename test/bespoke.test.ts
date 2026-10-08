/**
 * The bespoke pass without a model or a browser: which beats it picks, what it
 * caches under which key, where a bespoke scene's stops go, what the emitter
 * writes for one, and how the pass spends — and stops spending — Codex calls.
 *
 * The runner and the gate are injected (`BespokeInput.run`, `.gate`), so every
 * branch of the pipeline is driven here with canned replies and canned verdicts.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheKey, canonical, type KeyInput, SceneCache } from "../src/bespoke/cache.js";
import type { Fragment } from "../src/bespoke/contract.js";
import { Budget, bespokePass, type GateFn, type GateResult } from "../src/bespoke/pipeline.js";
import { bespokeHolds } from "../src/bespoke/scene.js";
import { selectBespoke, target } from "../src/bespoke/select.js";
import { emitScene } from "../src/emit/archetypes/index.js";
import {
  BESPOKE_CSP,
  type DeckNarration,
  emitComposition,
  emitDeck,
} from "../src/emit/composition.js";
import { resolveTheme } from "../src/emit/theme.js";
import { stopCount } from "../src/narrate/narrate.js";
import type { RunnerArgs } from "../src/plan/codex.js";
import { planTiming } from "../src/render/timing.js";
import {
  type Beat,
  FORMATS,
  type Format,
  type Storyboard,
  sourceSchema,
  storyboardSchema,
} from "../src/types.js";

const repo = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const demo = storyboardSchema.parse(
  JSON.parse(await readFile(repo("demo/storyboard.json"), "utf8")),
);
const source = sourceSchema.parse(JSON.parse(await readFile(repo("demo/source.json"), "utf8")));
const deck16 = FORMATS["deck-16x9"] as Format;

/** A narration for every beat: one segment per stop, two cues each, 5s a segment. */
function narrate(board: Storyboard): DeckNarration {
  const ink = resolveTheme("ink");
  const beats: DeckNarration["beats"] = {};
  for (const [i, beat] of board.beats.entries()) {
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

const narration = narrate(demo);

/** A scene that keeps the contract, moving on every cue. */
const SCENE: Fragment = {
  markup: `<svg id="SCENEID-svg" width="1700" height="600" viewBox="0 0 1700 600"><circle id="SCENEID-dot" cx="100" cy="300" r="30" fill="#f7c948"/></svg>`,
  css: "#SCENEID-svg { overflow: visible; }",
  script: `gsap.set("#SCENEID-dot", { attr: { cx: 100 } });
tl.to("#SCENEID-dot", { attr: { cx: 1500 }, duration: 4, repeat: 3, yoyo: true }, 1);`,
};

/* ----------------------------------------------------------------- selection */

describe("selection", () => {
  it("is deterministic, picks mechanisms, and never a title or a callout", () => {
    const a = selectBespoke(demo.beats, { seed: demo.sourceId, narration: narration.beats });
    const b = selectBespoke(demo.beats, { seed: demo.sourceId, narration: narration.beats });
    expect(a).toEqual(b);
    expect(a.picked.length).toBe(target(demo.beats.length));
    const kinds = new Map(demo.beats.map((x) => [x.id, x.archetype]));
    for (const p of a.picked)
      expect(["title", "callout", "data-table"]).not.toContain(kinds.get(p.beatId));
    expect(a.picked.length + a.skipped.length).toBe(demo.beats.length);
  });

  it("aims for a third of the deck, held to four to six", () => {
    expect(target(6)).toBe(4);
    expect(target(15)).toBe(5);
    expect(target(40)).toBe(6);
  });

  it("refuses a beat with no narration, and one a camera moves through", () => {
    const silent = selectBespoke(demo.beats, { seed: "x", narration: {} });
    expect(silent.picked).toEqual([]);
    expect(silent.skipped.some((s) => /no narration/.test(s.reason))).toBe(true);

    const camera = demo.beats.findIndex((b) => b.inside !== undefined);
    if (camera > 0) {
      const sel = selectBespoke(demo.beats, {
        seed: demo.sourceId,
        narration: narration.beats,
        max: 40,
        min: 40,
      });
      const ids = sel.picked.map((p) => p.beatId);
      expect(ids).not.toContain(demo.beats[camera]?.id);
      expect(ids).not.toContain(demo.beats[camera - 1]?.id);
    }
  });

  it("obeys the planner's false and favours its true", () => {
    const candidate = selectBespoke(demo.beats, { seed: demo.sourceId, narration: narration.beats })
      .picked[0]?.beatId as string;
    const vetoed = demo.beats.map((b) =>
      b.id === candidate ? ({ ...b, bespoke: false } as Beat) : b,
    );
    expect(
      selectBespoke(vetoed, { seed: demo.sourceId, narration: narration.beats }).picked.map(
        (p) => p.beatId,
      ),
    ).not.toContain(candidate);

    const loser = selectBespoke(demo.beats, {
      seed: demo.sourceId,
      narration: narration.beats,
    }).skipped.find((s) => s.reason.startsWith("scored"))?.beatId;
    if (loser) {
      const hinted = demo.beats.map((b) =>
        b.id === loser ? ({ ...b, bespoke: true } as Beat) : b,
      );
      expect(
        selectBespoke(hinted, { seed: demo.sourceId, narration: narration.beats }).picked.map(
          (p) => p.beatId,
        ),
      ).toContain(loser);
    }
  });

  it("lowers its count to what the call cap can pay for", () => {
    const sel = selectBespoke(demo.beats, {
      seed: demo.sourceId,
      narration: narration.beats,
      max: 2,
    });
    expect(sel.picked.length).toBe(2);
  });
});

/* --------------------------------------------------------------------- cache */

describe("cache keys", () => {
  const base: KeyInput = {
    promptVersion: "p1",
    contractVersion: "c1",
    model: "default",
    lang: "en",
    beat: { id: "b1", archetype: "pipeline", intent: "x", params: { headline: "h", stages: [] } },
    context: "paper",
    cues: [{ t0: 1, t1: 3, text: "hello" }],
    duration: 9,
    holds: [1.5, 4],
    region: { width: 1700, height: 600 },
    pack: { name: "ink", accent: "#fff" },
  };

  it("ignores key order and changes with every input that changes the scene", () => {
    expect(canonical({ a: 1, b: { c: 2, d: 3 } })).toBe(canonical({ b: { d: 3, c: 2 }, a: 1 }));
    const k = cacheKey(base);
    expect(cacheKey(JSON.parse(JSON.stringify(base)))).toBe(k);
    const variants: Array<Partial<KeyInput>> = [
      { promptVersion: "p2" },
      { contractVersion: "c2" },
      { model: "gpt-x" },
      { lang: "ko" },
      { context: "other paper" },
      { cues: [{ t0: 1, t1: 3.1, text: "hello" }] },
      { cues: [{ t0: 1, t1: 3, text: "hullo" }] },
      { duration: 9.5 },
      { holds: [1.5, 4.1] },
      { region: { width: 1700, height: 610 } },
      { pack: { name: "signal", accent: "#fff" } },
      { beat: { ...base.beat, params: { headline: "h2", stages: [] } } },
    ];
    for (const v of variants) expect(cacheKey({ ...base, ...v })).not.toBe(k);
  });

  describe("storage", () => {
    let dir = "";
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "decksmith-cache-"));
    });
    afterEach(async () => rm(dir, { recursive: true, force: true }));

    it("round-trips, and treats another shape as a miss", async () => {
      const cache = new SceneCache(dir);
      const key = cacheKey(base);
      expect(await cache.get(key)).toBeUndefined();
      await cache.put({
        version: 1,
        key,
        verdict: "accepted",
        fragment: SCENE,
        note: "n",
        calls: 2,
        model: "m",
        promptVersion: "p",
      });
      expect((await cache.get(key))?.fragment).toEqual(SCENE);
      await writeFile(join(dir, `${key}.json`), JSON.stringify({ version: 99, key }));
      expect(await cache.get(key)).toBeUndefined();
    });
  });
});

/* ------------------------------------------------------------------- staging */

describe("a bespoke scene's stops", () => {
  it("keeps the count, moves each speaking stop to its sentence, never shrinks the last", () => {
    const holds = bespokeHolds(
      [1.95, 2.85, 3.65],
      new Map([
        [1, 9.6],
        [2, 14.1],
      ]),
      18.5,
    );
    expect(holds).toEqual([1.95, 9.6, 14.1]);
    // A silent middle stop lands between its neighbours.
    const silent = bespokeHolds([1.95, 2.85, 3.65], new Map([[2, 9.6]]), 14);
    expect(silent).toHaveLength(3);
    expect(silent[1]).toBeGreaterThan(1.95);
    expect(silent[1]).toBeLessThan(9.6);
    // Motion that outran the speech keeps its last hold.
    expect(bespokeHolds([2, 6], new Map(), 3).at(-1)).toBe(6);
  });
});

describe("emitting a bespoke scene", () => {
  const beat = demo.beats.find((b) => b.archetype === "pipeline") as Beat;
  const bespoke = { [beat.id]: { fragment: SCENE, holds: [1.5, 6] } };

  it("puts the generated scene, the shell's chrome and a CSP in the deck — and only then", () => {
    const plain = emitComposition(demo, source, deck16, { design: "v2", narration });
    const generated = emitComposition(demo, source, deck16, { design: "v2", narration, bespoke });
    expect(plain).not.toContain("Content-Security-Policy");
    expect(generated).toContain(`content="${BESPOKE_CSP}"`);
    expect(generated).toContain("decksmith bespoke #");
    const sid = /id="(s\d+)-dot"/.exec(generated)?.[1] as string;
    expect(generated).toContain(`id="${sid}-h"`);
    expect(generated).toContain(`"#${sid}-dot"`);
    expect(generated).not.toContain("SCENEID");
    expect(BESPOKE_CSP).toContain("connect-src 'none'");
    expect(BESPOKE_CSP).not.toContain("unsafe-eval");
  });

  it("writes stops the timing manifest and the island agree on", () => {
    const deck = emitDeck(demo, source, deck16, "", { design: "v2", narration, bespoke });
    const timing = planTiming({
      storyboard: demo,
      source,
      format: deck16,
      speed: 1,
      composition: deck.composition,
      beats: deck.cut.kept,
      narration,
      bespoke,
    });
    const i = deck.cut.kept.findIndex((b) => b.id === beat.id);
    expect(timing.scenes[i]?.holds).toEqual([1.5, 6]);
    // The deck player seeks through the scene while its sentences play.
    expect(deck.page).toContain(`"s${i + 1}": [`);
  });

  it("leaves every other scene exactly as v2 draws it", () => {
    const plain = emitComposition(demo, source, deck16, { design: "v2", narration });
    const generated = emitComposition(demo, source, deck16, { design: "v2", narration, bespoke });
    // One chunk per scene; a later scene may START later if this one runs
    // longer, so the clock is compared apart from the body.
    const scenes = (html: string) =>
      html
        .split(/\n {6}<div\n {8}id="s/)
        .slice(1)
        // …and the deck's spanning timeline, whose length is the sum of all.
        .map((chunk) =>
          (chunk.split("// Spans the deck")[0] ?? "").replace(/data-start="[\d.]+"/, ""),
        );
    const a = scenes(plain);
    const b = scenes(generated);
    const i = demo.beats.findIndex((x) => x.id === beat.id);
    expect(b.length).toBe(a.length);
    a.forEach((chunk, j) => {
      if (j === i) expect(b[j]).not.toBe(chunk);
      else expect(b[j]).toBe(chunk);
    });
  });
});

/* ------------------------------------------------------------------ the pass */

describe("the bespoke pass", () => {
  let cacheDir = "";
  let work = "";
  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "decksmith-bespoke-cache-"));
    work = await mkdtemp(join(tmpdir(), "decksmith-bespoke-work-"));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  /** A runner that answers every call with `reply(call)`, and counts. */
  function fake(reply: (args: RunnerArgs, n: number) => Fragment | Error) {
    const calls: RunnerArgs[] = [];
    const run = async (args: RunnerArgs) => {
      calls.push(args);
      const r = reply(args, calls.length);
      if (r instanceof Error) throw r;
      await writeFile(args.outPath, JSON.stringify({ review: "", plan: "p", ...r }));
      args.onUsage?.(1000);
    };
    return { calls, run };
  }
  const pass: GateFn = async (m) =>
    new Map(Object.keys(m).map((id) => [id, { findings: [], failed: false } satisfies GateResult]));
  const prefs = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    maxCalls: 12,
    maxSeconds: 1800,
    concurrency: 2,
    cache: cacheDir,
    ...over,
  });
  const input = (over: Record<string, unknown> = {}) => ({
    storyboard: demo,
    source,
    format: deck16,
    narration,
    theme: "ink",
    speed: 1,
    gate: pass,
    work,
    ...over,
  });

  it("draws the picks, two calls each, and a rebuild costs nothing", async () => {
    const { calls, run } = fake(() => SCENE);
    const first = await bespokePass({ ...input({ run }), prefs: prefs() });
    const n = Object.keys(first.map).length;
    expect(n).toBe(target(demo.beats.length));
    expect(calls.length).toBe(2 * n);
    expect(first.report.tokens).toBe(2000 * n);
    expect(calls.some((c) => c.prompt.includes("UNTRUSTED DATA"))).toBe(true);

    const again = fake(() => SCENE);
    const second = await bespokePass({ ...input({ run: again.run }), prefs: prefs() });
    expect(again.calls.length).toBe(0);
    expect(Object.keys(second.map)).toEqual(Object.keys(first.map));
    expect(second.report.scenes.every((s) => s.from === "cache")).toBe(true);
  });

  it("the budget refuses past its call cap, its deadline, and a quota answer", () => {
    let t = 0;
    const b = new Budget(2, 10 * 60_000, () => t);
    expect(b.take()).toBeUndefined();
    expect(b.take()).toBeUndefined();
    expect(b.take()).toMatch(/cap of 2/);
    const late = new Budget(9, 10 * 60_000, () => t);
    t = 9.5 * 60_000;
    expect(late.take()).toMatch(/wall-time/);
    t = 0;
    const said = new Budget(9, 10 * 60_000, () => t);
    said.quota = true;
    expect(said.take()).toMatch(/quota/);
  });

  it("never spends past the call cap; the rest fall back", async () => {
    const { calls, run } = fake(() => SCENE);
    const r = await bespokePass({ ...input({ run }), prefs: prefs({ maxCalls: 3 }) });
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(r.report.calls).toBeLessThanOrEqual(3);
    // A cap of 3 pays for one full beat; the draft that got no critique round
    // is kept only because it passed its gates.
    expect(r.report.scenes.length).toBe(1);
  });

  it("stops every call once the quota says no, and caches nothing it did not earn", async () => {
    const { calls, run } = fake(
      () => new Error("codex exec exited 1.\nYou've hit your usage limit."),
    );
    const r = await bespokePass({ ...input({ run }), prefs: prefs() });
    expect(r.report.quota).toBe(true);
    expect(Object.keys(r.map)).toEqual([]);
    expect(calls.length).toBe(2); // the two in flight when the first refusal came back
    expect(r.report.scenes.every((s) => s.status === "fallback")).toBe(true);
    const second = fake(() => SCENE);
    await bespokePass({ ...input({ run: second.run }), prefs: prefs() });
    expect(second.calls.length).toBeGreaterThan(0);
  });

  it("stops at the wall-time cap", async () => {
    let t = 0;
    const { calls, run } = fake(() => {
      t += 10 * 60 * 1000;
      return SCENE;
    });
    const r = await bespokePass({
      ...input({ run, now: () => t }),
      prefs: prefs({ maxSeconds: 900, concurrency: 1 }),
    });
    expect(calls.length).toBeLessThan(4);
    expect(r.report.scenes.some((s) => /wall-time/.test(s.reason ?? ""))).toBe(true);
  });

  it("refuses a scene that breaks the contract without ever gating it, and falls back", async () => {
    const evil: Fragment = { ...SCENE, script: `fetch("https://evil.example");` };
    const gated: string[] = [];
    const gate: GateFn = async (m) => {
      gated.push(...Object.values(m).map((e) => e.fragment.script));
      return pass(m, "draft");
    };
    const { run } = fake(() => evil);
    const r = await bespokePass({ ...input({ run, gate }), prefs: prefs() });
    expect(gated.some((s) => s.includes("fetch"))).toBe(false);
    expect(Object.keys(r.map)).toEqual([]);
    expect(r.report.scenes.every((s) => s.status === "fallback")).toBe(true);
    expect(r.report.scenes[0]?.reason).toMatch(/script_name/);
  });

  it("keeps a passing draft when the fix round breaks it, and caches a scene the gates refused twice", async () => {
    const draft = SCENE;
    const broken: Fragment = {
      ...SCENE,
      script: `${SCENE.script}\ntl.to("#SCENEID-dot", { x: 1 }, 2);`,
    };
    const { run } = fake((args) =>
      args.prompt.includes("strict motion-design reviewer") ? broken : draft,
    );
    const gate: GateFn = async (m, round) =>
      new Map(
        Object.keys(m).map((id) => [
          id,
          {
            findings: round === "final" ? ["error static_hold: x"] : [],
            failed: round === "final",
          },
        ]),
      );
    const r = await bespokePass({ ...input({ run, gate }), prefs: prefs() });
    expect(r.report.scenes.every((s) => s.status === "bespoke" && s.from === "draft")).toBe(true);

    await rm(cacheDir, { recursive: true, force: true });
    const always: GateFn = async (m) =>
      new Map(
        Object.keys(m).map((id) => [
          id,
          { findings: ["error graphic_crosses_text: x"], failed: true },
        ]),
      );
    const failing = await bespokePass({ ...input({ run, gate: always }), prefs: prefs() });
    expect(Object.keys(failing.map)).toEqual([]);
    const again = fake(() => SCENE);
    const second = await bespokePass({
      ...input({ run: again.run, gate: always }),
      prefs: prefs(),
    });
    expect(again.calls.length).toBe(0);
    expect(second.report.scenes.every((s) => /cached rejection/.test(s.reason ?? ""))).toBe(true);
  });

  it("does nothing on a paced deck, whose cue times are not the scene's", async () => {
    const { calls, run } = fake(() => SCENE);
    const r = await bespokePass({ ...input({ run, speed: 0.8 }), prefs: prefs() });
    expect(calls.length).toBe(0);
    expect(r.map).toEqual({});
  });

  it("sends the frames to the critique round", async () => {
    const sheet = join(work, "sheet.png");
    await writeFile(sheet, "png");
    const { calls, run } = fake(() => SCENE);
    const gate: GateFn = async (m) =>
      new Map(
        Object.keys(m).map((id) => [
          id,
          { findings: [], failed: false, sheet, legend: "c1s = 1s" },
        ]),
      );
    await bespokePass({ ...input({ run, gate }), prefs: prefs({ maxCalls: 2 }) });
    expect(calls[1]?.images).toEqual([sheet]);
    expect(calls[1]?.prompt).toContain("c1s = 1s");
  });
});
