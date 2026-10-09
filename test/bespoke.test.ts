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
import { CARDS_VERSION } from "../src/bespoke/cards.js";
import type { Fragment } from "../src/bespoke/contract.js";
import {
  assignDevices,
  Budget,
  bespokePass,
  deadlineAdmit,
  deviceName,
  GATE_STAMP,
  type GateFn,
  type GateResult,
  lanes,
  rubricProbe,
} from "../src/bespoke/pipeline.js";
import {
  critiquePrompt,
  type DeviceBeat,
  devicePrompt,
  generatePrompt,
} from "../src/bespoke/prompt.js";
import { bespokeHolds } from "../src/bespoke/scene.js";
import { selectBespoke } from "../src/bespoke/select.js";
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
  markup: `<svg id="SCENEID-svg" width="1700" height="600" viewBox="0 0 1700 600"><g id="SCENEID-a" data-cue="1"><circle id="SCENEID-dot" cx="100" cy="300" r="30" fill="#f7c948"/></g><g id="SCENEID-b" data-cue="2"></g></svg>`,
  css: "#SCENEID-svg { overflow: visible; }",
  script: `gsap.set("#SCENEID-dot", { attr: { cx: 100 } });
tl.to("#SCENEID-dot", { attr: { cx: 1500 }, duration: 4, repeat: 3, yoyo: true }, 1);`,
};

/* ----------------------------------------------------------------- selection */

describe("selection", () => {
  it("picks every narrated beat — title, callout and table too — in deck order", () => {
    const a = selectBespoke(demo.beats, { seed: demo.sourceId, narration: narration.beats });
    expect(a).toEqual(
      selectBespoke(demo.beats, { seed: demo.sourceId, narration: narration.beats }),
    );
    const camera = new Set(
      demo.beats.flatMap((b, i) =>
        b.inside !== undefined ? [b.id, demo.beats[i - 1]?.id as string] : [],
      ),
    );
    expect(a.picked.map((p) => p.beatId)).toEqual(
      demo.beats.filter((b) => !camera.has(b.id)).map((b) => b.id),
    );
    const kinds = new Set(
      a.picked.map((p) => demo.beats.find((b) => b.id === p.beatId)?.archetype),
    );
    for (const k of ["title", "callout"])
      if (demo.beats.some((b) => b.archetype === k)) expect(kinds).toContain(k);
    expect(a.picked.length + a.skipped.length).toBe(demo.beats.length);
  });

  it("refuses a beat with no narration cue, and one a camera moves through", () => {
    const silent = selectBespoke(demo.beats, { seed: "x", narration: {} });
    expect(silent.picked).toEqual([]);
    expect(silent.skipped.some((s) => /no narration cue/.test(s.reason))).toBe(true);

    const camera = demo.beats.findIndex((b) => b.inside !== undefined);
    if (camera > 0) {
      const ids = selectBespoke(demo.beats, {
        seed: demo.sourceId,
        narration: narration.beats,
      }).picked.map((p) => p.beatId);
      expect(ids).not.toContain(demo.beats[camera]?.id);
      expect(ids).not.toContain(demo.beats[camera - 1]?.id);
    }
  });

  it("draws a beat with a single cue (a title, a closing line): one cue is enough to key a scene to", () => {
    const first = demo.beats[0]?.id as string;
    const one = {
      ...narration.beats,
      [first]: (narration.beats[first] ?? []).slice(0, 1).map((g) => ({
        ...g,
        cues: g.cues.slice(0, 1),
      })),
    };
    const ids = selectBespoke(demo.beats, { seed: demo.sourceId, narration: one }).picked.map(
      (p) => p.beatId,
    );
    expect(ids).toContain(first);
  });

  it("obeys the planner's false", () => {
    const first = demo.beats[0]?.id as string;
    const vetoed = demo.beats.map((b) => (b.id === first ? ({ ...b, bespoke: false } as Beat) : b));
    const sel = selectBespoke(vetoed, { seed: demo.sourceId, narration: narration.beats });
    expect(sel.picked.map((p) => p.beatId)).not.toContain(first);
    expect(sel.skipped.find((s) => s.beatId === first)?.reason).toMatch(/bespoke:false/);
  });

  it("when the call cap cannot pay for every beat, draws the most mechanical, in deck order", () => {
    const sel = selectBespoke(demo.beats, {
      seed: demo.sourceId,
      narration: narration.beats,
      max: 2,
    });
    expect(sel.picked).toHaveLength(2);
    const kinds = sel.picked.map((p) => demo.beats.find((b) => b.id === p.beatId)?.archetype);
    for (const k of kinds) expect(["title", "callout"]).not.toContain(k);
    const order = demo.beats.map((b) => b.id);
    const at = sel.picked.map((p) => order.indexOf(p.beatId));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(sel.skipped.some((s) => /call cap pays for 2/.test(s.reason))).toBe(true);
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
      // The deck's one device call is answered with nothing: every beat takes
      // the rule catalogue's device, and the scene calls are what is counted.
      if (args.schemaPath.endsWith("devices.schema.json")) {
        await writeFile(args.outPath, JSON.stringify({ beats: [] }));
        return;
      }
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
    callSeconds: 600,
    concurrency: 2,
    effort: "medium" as const,
    art: 0,
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
    const first = await bespokePass({ ...input({ run }), prefs: prefs({ maxCalls: 40 }) });
    const n = Object.keys(first.map).length;
    // Every eligible beat, not a handful of mechanisms.
    expect(n).toBe(
      selectBespoke(demo.beats, { seed: demo.sourceId, narration: narration.beats }).picked.length,
    );
    expect(n).toBeGreaterThan(6);
    expect(calls.length).toBe(2 * n);
    expect(first.report.tokens).toBe(2000 * n);
    expect(calls.some((c) => c.prompt.includes("UNTRUSTED DATA"))).toBe(true);

    const again = fake(() => SCENE);
    const rounds: string[] = [];
    const counting: GateFn = async (m, round) => {
      rounds.push(round);
      return pass(m, round);
    };
    const second = await bespokePass({
      ...input({ run: again.run, gate: counting }),
      prefs: prefs({ maxCalls: 40 }),
    });
    expect(again.calls.length).toBe(0);
    expect(rounds).toEqual(["final"]);
    expect(Object.keys(second.map)).toEqual(Object.keys(first.map));
    expect(second.report.scenes.every((s) => s.from === "cache")).toBe(true);
  });

  it("names every scene's device before the first draft, and gives each only its own", async () => {
    const { calls, run } = fake(() => SCENE);
    const r = await bespokePass({ ...input({ run }), prefs: prefs() });
    const drafts = calls.filter((c) => c.outPath.endsWith(".draft.json"));
    expect(drafts.length).toBeGreaterThan(1);
    const devices = r.report.scenes.map((sc) => sc.device);
    expect(new Set(devices).size).toBe(devices.length);
    for (const sc of r.report.scenes) {
      const prompt = drafts.find((c) => c.outPath.endsWith(`${sc.beat}.draft.json`))?.prompt ?? "";
      expect(prompt).toContain(`THE VISUAL DEVICE: "${sc.device}"`);
      // No other scene's device: that list re-keyed every scene after an edited beat.
      for (const other of devices.filter((d) => d !== sc.device))
        expect(prompt).not.toContain(`"${other}"`);
    }
    expect(r.report.devices?.from).toBe("codex");
  });

  it("re-draws only the beat whose device changed; the device and its idea are in the scene's key", async () => {
    // Device answers by beat id; `rename` changes one beat's name, `reidea` another's idea.
    const answering = (rename?: string, reidea?: string) => {
      const calls: RunnerArgs[] = [];
      const run = async (args: RunnerArgs) => {
        if (args.schemaPath.endsWith("devices.schema.json")) {
          const ids = [...args.prompt.matchAll(/id=(\S+)/g)].map((m) => m[1] as string);
          await writeFile(
            args.outPath,
            JSON.stringify({
              beats: ids.map((id) => ({
                id,
                device: `${id}-device${id === rename ? "-new" : ""}`,
                illustrate: false,
                idea: `${id} idea${id === reidea ? " anew" : ""}`,
              })),
            }),
          );
          return;
        }
        calls.push(args);
        await writeFile(args.outPath, JSON.stringify({ review: "", plan: "p", ...SCENE }));
      };
      return { calls, run };
    };
    const a = answering();
    const first = await bespokePass({ ...input({ run: a.run }), prefs: prefs({ maxCalls: 40 }) });
    const drawn = Object.keys(first.map);
    expect(drawn.length).toBeGreaterThan(3);
    const draft = a.calls.find((c) => c.outPath.endsWith(`${drawn[1]}.draft.json`));
    expect(draft?.prompt).toContain(`${drawn[1]} idea`);
    // Forget the decided devices; the next answer renames one beat and re-ideas another.
    await rm(join(cacheDir, "devices"), { recursive: true, force: true });
    const [renamed, reideaed] = [drawn[1] as string, drawn[3] as string];
    const b = answering(renamed, reideaed);
    const second = await bespokePass({ ...input({ run: b.run }), prefs: prefs({ maxCalls: 40 }) });
    const redrawn = new Set(b.calls.map((c) => c.outPath.split("/").pop()?.split(".")[0]));
    expect([...redrawn].sort()).toEqual([renamed, reideaed].sort());
    for (const sc of second.report.scenes)
      if (sc.beat !== renamed && sc.beat !== reideaed) expect(sc.from).toBe("cache");
  });

  it("sends a card-row scene back once, keeps the redraw, and falls back if the redraw is cards too", async () => {
    const cards: Fragment = {
      ...SCENE,
      markup: SCENE.markup.replace(
        '<g id="SCENEID-b" data-cue="2"></g>',
        `<g id="SCENEID-b" data-cue="2">${[0, 1, 2, 3]
          .map(
            (i) =>
              `<rect x="${40 + i * 420}" y="120" width="380" height="320" rx="28" fill="#333"/>`,
          )
          .join("")}</g>`,
      ),
    };
    const clean: GateFn = async (m) =>
      new Map(
        Object.keys(m).map((id) => [
          id,
          {
            findings: [],
            failed: false,
            metrics: {
              fill: 0.9,
              cells: 0.8,
              maxType: 96,
              mass: 0.3,
              cueChange: [0.02, 0.03],
              kinds: [],
            },
          } satisfies GateResult,
        ]),
      );
    // Draft: cards. Critique: the content itself. Kept, from the critique.
    const once = fake((args) => (args.outPath.endsWith(".draft.json") ? cards : SCENE));
    const r1 = await bespokePass({
      ...input({ run: once.run, gate: clean }),
      prefs: prefs({ maxCalls: 4 }),
    });
    const critiques = once.calls.filter((c) => c.outPath.endsWith(".critique.json"));
    expect(critiques.length).toBeGreaterThan(0);
    expect(critiques[0]?.prompt).toMatch(/error card_row: the main visual is a row of 4/);
    expect(
      r1.report.scenes.filter((s) => s.status === "bespoke").every((s) => s.from === "critique"),
    ).toBe(true);
    expect(Object.keys(r1.map).length).toBeGreaterThan(0);

    // Cards both times: one critique each, then the archetype, and the reason says so.
    const twice = fake(() => cards);
    const r2 = await bespokePass({
      ...input({ run: twice.run, gate: clean }),
      prefs: prefs({ maxCalls: 4, cache: join(cacheDir, "b") }),
    });
    expect(Object.keys(r2.map)).toEqual([]);
    for (const s of r2.report.scenes) {
      expect(s.status).toBe("fallback");
      expect(s.reason).toMatch(/card_row/);
      expect(s.calls).toBe(2);
    }
  });

  it("never asks card_row about a data beat, whose bars of close values are alike by design", async () => {
    const bars: Fragment = {
      ...SCENE,
      markup: SCENE.markup.replace(
        '<g id="SCENEID-b" data-cue="2"></g>',
        `<g id="SCENEID-b" data-cue="2">${[0.82, 0.86, 0.9, 0.94]
          .map(
            (v, i) =>
              `<rect x="${100 + i * 400}" y="${600 - 560 * v}" width="180" height="${560 * v}" fill="#4a7"/>`,
          )
          .join("")}</g>`,
      ),
    };
    const { run } = fake(() => bars);
    const r = await bespokePass({ ...input({ run }), prefs: prefs({ maxCalls: 40 }) });
    const data = r.report.scenes.filter((s) => s.data);
    expect(data.length).toBeGreaterThan(0);
    for (const s of data) expect(s.status).toBe("bespoke");
    // The same bars on a beat that is not a chart are still a row of cards.
    const other = r.report.scenes.filter((s) => !s.data);
    expect(other.length).toBeGreaterThan(0);
    for (const s of other) expect(s.reason).toMatch(/card_row/);
  });

  it("stamps a cached rejection with card_row's version, so loosening it asks again", async () => {
    const cards: Fragment = {
      ...SCENE,
      markup: SCENE.markup.replace(
        '<g id="SCENEID-b" data-cue="2"></g>',
        `<g id="SCENEID-b" data-cue="2">${[0, 1, 2, 3].map((i) => `<rect x="${40 + i * 420}" y="120" width="380" height="320" fill="#333"/>`).join("")}</g>`,
      ),
    };
    const { run } = fake(() => cards);
    const r = await bespokePass({ ...input({ run }), prefs: prefs({ maxCalls: 4 }) });
    const rejected = r.report.scenes.find((s) => s.status === "fallback");
    const hit = await new SceneCache(cacheDir).get(rejected?.key ?? "");
    expect(hit?.verdict).toBe("rejected");
    expect(GATE_STAMP).toContain(CARDS_VERSION);
    expect(hit?.gates).toBe(GATE_STAMP);
  });

  it("asks a second critique for a beat that would fall back, and keeps what it draws", async () => {
    const bad: Fragment = { ...SCENE, css: `${SCENE.css}\n/* bad */` };
    const gate: GateFn = async (m) =>
      new Map(
        Object.entries(m).map(([id, e]) => [
          id,
          e.fragment.css.includes("bad")
            ? {
                findings: ["error text_overlap: #s3 at c1z (2.00s): text prints over text — a × b"],
                failed: true,
              }
            : { findings: [], failed: false },
        ]),
      );
    const { calls, run } = fake((args) => (args.outPath.endsWith(".critique2.json") ? SCENE : bad));
    const r = await bespokePass({ ...input({ run, gate }), prefs: prefs({ maxCalls: 3 }) });
    expect(calls.map((c) => c.outPath.split(".").slice(-2, -1)[0])).toEqual([
      "draft",
      "critique",
      "critique2",
    ]);
    const sc = r.report.scenes[0];
    expect(sc?.status).toBe("bespoke");
    expect(sc?.second).toBe(true);
    expect(sc?.reason).toMatch(/second critique/);
    // A second critique that fails too: the archetype, and the reason says which round.
    const still = fake(() => bad);
    const r2 = await bespokePass({
      ...input({ run: still.run, gate }),
      prefs: prefs({ maxCalls: 3, cache: join(cacheDir, "b") }),
    });
    expect(r2.report.scenes[0]?.status).toBe("fallback");
    expect(r2.report.scenes[0]?.reason).toMatch(/after the second critique round/);
    expect(still.calls).toHaveLength(3);
  });

  it("never has more Codex calls in flight than its lanes, pictures and scenes alike, and frees a lane on a failure", async () => {
    let live = 0;
    let most = 0;
    const slow = async (args: RunnerArgs) => {
      live++;
      most = Math.max(most, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      if (args.prompt === "fail") throw new Error("boom");
    };
    const limited = lanes(slow, 2);
    const args = (prompt: string) => ({ prompt, schemaPath: "s", outPath: "o", timeoutMs: 1 });
    const all = await Promise.allSettled(
      ["a", "fail", "b", "c", "d", "e"].map((p) => limited(args(p))),
    );
    expect(most).toBe(2);
    expect(all.filter((r) => r.status === "rejected")).toHaveLength(1);
    await limited(args("after"));
  });

  it("the device call is apart from the scene cap, but not past the quota or the clock", () => {
    let t = 0;
    const capped = new Budget(0, 10 * 60_000, () => t);
    expect(capped.take()).toMatch(/cap of 0/);
    expect(capped.takeDevice()).toBeUndefined();
    expect(capped.devices).toBe(1);
    const said = new Budget(9, 10 * 60_000, () => t);
    said.quota = true;
    expect(said.takeDevice()).toMatch(/quota/);
    const late = new Budget(9, 10 * 60_000, () => t);
    t = 9 * 60_000;
    expect(late.takeDevice()).toMatch(/wall-time/);
    expect(late.devices).toBe(0);
  });

  it("decides a call's timeout when it starts, not when it queued, and never runs one past the cap", async () => {
    let t = 0;
    const seen: number[] = [];
    // Each call takes 4 minutes of the clock; the cap is 10 minutes away.
    const slow = async (args: RunnerArgs) => {
      seen.push(args.timeoutMs);
      t += 4 * 60_000;
    };
    const one = lanes(
      slow,
      1,
      deadlineAdmit(10 * 60_000, () => t),
    );
    const args = { prompt: "p", schemaPath: "s", outPath: "o", timeoutMs: 600_000 };
    const all = await Promise.allSettled([one(args), one(args), one(args)]);
    // Queued together at t=0 with 600s each: the second starts at 4 min (6 min left),
    // the third at 8 min, two minutes from the cap.
    expect(seen).toEqual([600_000, 360_000, 120_000]);
    t = 9.75 * 60_000;
    await expect(one(args)).rejects.toThrow(/wall-time cap/);
    expect(all.every((r) => r.status === "fulfilled")).toBe(true);
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

  it("survives a beat its archetype cannot draw, as build does", async () => {
    const cf = demo.beats.find((b) => b.archetype === "claim-figure") as Beat;
    const broken = {
      ...cf,
      id: "broken",
      params: { ...cf.params, figureId: "no-such-figure" },
    } as Beat;
    const board = { ...demo, beats: [...demo.beats, broken] };
    const { run } = fake(() => SCENE);
    const r = await bespokePass({
      ...input({ run, storyboard: board, narration: narrate(demo) }),
      prefs: prefs(),
    });
    expect(Object.keys(r.map).length).toBeGreaterThan(0);
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
    // The critique judges against the rubric, with what was measured.
    expect(calls[1]?.prompt).toContain("RUBRIC");
    expect(calls[1]?.prompt).toContain("# MEASURED");
  });

  /** A scene whose script asks for flow, a counter and a focus change. */
  const RICH: Fragment = {
    ...SCENE,
    script: `${SCENE.script}
tl.to("#SCENEID-n", { textContent: 9, snap: { textContent: 1 }, duration: 1 }, 2);
tl.to("#SCENEID-dot", { opacity: 0.3, duration: 0.5 }, 3);`,
  };
  const clean = { fill: 0.9, cells: 0.8, maxType: 96, cueChange: [0.02, 0.03] };

  it("skips the critique call when every gate passed and the rubric probe is clean", async () => {
    const { calls, run } = fake(() => RICH);
    const gate: GateFn = async (m) =>
      new Map(Object.keys(m).map((id) => [id, { findings: [], failed: false, metrics: clean }]));
    const r = await bespokePass({ ...input({ run, gate }), prefs: prefs() });
    const n = Object.keys(r.map).length;
    expect(n).toBeGreaterThan(0);
    expect(calls.length).toBe(n);
    expect(r.report.scenes.every((sc) => sc.critique === "skipped" && sc.from === "draft")).toBe(
      true,
    );
    expect(r.report.scenes[0]?.kinds).toEqual(expect.arrayContaining(["flow", "counter", "focus"]));
  });

  it("still critiques a passing draft the rubric probe finds wanting", async () => {
    const { calls, run } = fake(() => RICH);
    const small = { ...clean, fill: 0.6 };
    const gate: GateFn = async (m) =>
      new Map(Object.keys(m).map((id) => [id, { findings: [], failed: false, metrics: small }]));
    const r = await bespokePass({ ...input({ run, gate }), prefs: prefs({ maxCalls: 2 }) });
    expect(calls.length).toBe(2);
    expect(r.report.scenes[0]?.critique).toBe("ran");
    expect(calls[1]?.prompt).toContain("stage fill (bbox / box area, end frame): 60%");
  });

  it("calls Codex from the scratch dir, at the configured effort", async () => {
    const { calls, run } = fake(() => SCENE);
    await bespokePass({ ...input({ run }), prefs: prefs({ maxCalls: 2, effort: "low" }) });
    expect(calls[0]?.cwd).toBe(work);
    expect(calls[0]?.config).toContain('model_reasoning_effort="low"');
  });
});

/* --------------------------------------------------------------- devices */

describe("the deck-order device pass", () => {
  let work = "";
  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "decksmith-devices-"));
  });
  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });
  const beat = (id: string, over: Partial<DeviceBeat> = {}): DeviceBeat => ({
    id,
    archetype: "pipeline",
    headline: `h ${id}`,
    intent: `i ${id}`,
    cues: 3,
    data: false,
    ...over,
  });
  const deck = [
    beat("b1", { archetype: "title", cues: 1 }),
    beat("b2"),
    beat("b3"),
    beat("b4", { archetype: "bar-compare", data: true }),
    beat("b5"),
    beat("b6", { archetype: "callout" }),
  ];
  const answer =
    (beats: unknown[]) =>
    async (args: RunnerArgs): Promise<void> => {
      await writeFile(args.outPath, JSON.stringify({ beats }));
    };

  it("gives every beat a device, none repeated, in deck order", async () => {
    const r = await assignDevices(deck, { artCap: 6, work, timeoutMs: 1000 });
    expect(r.from).toBe("rule");
    const names = r.beats.map((b) => b.device);
    expect(new Set(names).size).toBe(deck.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    r.beats.forEach((b, i) => {
      expect(b.beatId).toBe(deck[i]?.id);
    });
  });

  it("keeps every unchanged beat's device when one beat changes, and asks only about the rest", async () => {
    const cacheDir = join(work, "cache");
    const prompts: string[] = [];
    const run = async (args: RunnerArgs) => {
      prompts.push(args.prompt);
      const ids = [...args.prompt.matchAll(/id=(\S+)/g)].map((m) => m[1] as string);
      // A model that would rename everything on a second call.
      await answer(
        ids.map((id) => ({
          id,
          device: `${id}-v${prompts.length}`,
          illustrate: false,
          idea: `idea ${id}`,
        })),
      )(args);
    };
    const opts = { artCap: 6, work, timeoutMs: 1000, run, cacheDir };
    const first = await assignDevices(deck, opts);
    const edited = deck.map((b) => (b.id === "b3" ? { ...b, headline: "a new headline" } : b));
    const second = await assignDevices(edited, opts);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/ALREADY DECIDED \(keep exactly\): device "b2-v1" — idea b2/);
    expect(prompts[1]).not.toMatch(/id=b3[^\n]*\n(?: {3}[^\n]*\n)* {3}ALREADY DECIDED/);
    for (const [i, d] of second.beats.entries()) {
      if (d.beatId === "b3") expect(d.device).toBe("b3-v2");
      else {
        expect(d.device).toBe(first.beats[i]?.device);
        expect(d.idea).toBe(first.beats[i]?.idea);
      }
    }
    // Every beat decided: no call at all, even for a deck in another order.
    const third = await assignDevices([...edited].reverse(), opts);
    expect(prompts).toHaveLength(2);
    expect(third.from).toBe("cache");
  });

  it("never throws: a cache file with junk in it, or a cache it cannot write", async () => {
    const cacheDir = join(work, "cache");
    const run = answer(
      deck.map((b) => ({ id: b.id, device: `d-${b.id}`, illustrate: false, idea: "" })),
    );
    const r = await assignDevices(deck, { artCap: 6, work, timeoutMs: 1000, run, cacheDir });
    // Corrupt every file the pass wrote: null elements, non-objects, a bad device.
    const { readdir } = await import("node:fs/promises");
    const dir = join(cacheDir, "devices");
    for (const f of await readdir(dir))
      if (f.endsWith(".json"))
        await writeFile(join(dir, f), JSON.stringify({ answers: [null, 7, "x", { id: 3 }] }));
    for (const f of await readdir(join(dir, "beats")))
      await writeFile(join(dir, "beats", f), "null");
    const again = await assignDevices(deck, { artCap: 6, work, timeoutMs: 1000, run, cacheDir });
    expect(again.beats.map((b) => b.beatId)).toEqual(r.beats.map((b) => b.beatId));
    // A cache path under a file: mkdir fails, and the names still come back.
    const blocked = join(work, "blocked");
    await writeFile(blocked, "a file, not a directory");
    const unwritable = await assignDevices(deck, {
      artCap: 6,
      work,
      timeoutMs: 1000,
      run,
      cacheDir: blocked,
    });
    expect(unwritable.beats).toHaveLength(deck.length);
    expect(unwritable.note).toMatch(/device cache was not written/);
  });

  it("never illustrates a data beat or a one-cue beat, holds to the cap, and leaves some beats as motion graphics", async () => {
    const all = deck.map((b) => ({ id: b.id, device: `d-${b.id}`, illustrate: true, idea: "x" }));
    const r = await assignDevices(deck, { artCap: 2, work, timeoutMs: 1000, run: answer(all) });
    const pictured = r.beats.filter((b) => b.illustrate).map((b) => b.beatId);
    expect(pictured).toEqual(["b2", "b3"]);
    const ruled = await assignDevices(deck, { artCap: 6, work, timeoutMs: 1000 });
    const ruledPictures = ruled.beats.filter((b) => b.illustrate).map((b) => b.beatId);
    expect(ruledPictures).not.toContain("b1");
    expect(ruledPictures).not.toContain("b4");
    expect(ruledPictures.length).toBeGreaterThan(0);
    expect(ruledPictures.length).toBeLessThan(deck.length - 2);
  });

  it("takes the model's names, kebab-cased, and replaces a repeat or a blank from the catalogue", async () => {
    const run = answer([
      { id: "b1", device: "Kinetic Title!", illustrate: false, idea: "type lands" },
      { id: "b2", device: "spike train", illustrate: true, idea: "spikes fire" },
      { id: "b3", device: "spike-train", illustrate: true, idea: "again" },
      { id: "b5", device: "", illustrate: false, idea: "" },
      { id: "b6", device: "fog_lift", illustrate: false, idea: "fog lifts" },
    ]);
    const r = await assignDevices(deck, { artCap: 6, work, timeoutMs: 1000, run });
    expect(r.from).toBe("codex");
    const by = new Map(r.beats.map((b) => [b.beatId, b]));
    expect(by.get("b1")?.device).toBe("kinetic-title");
    expect(by.get("b2")?.device).toBe("spike-train");
    expect(by.get("b3")?.device).not.toBe("spike-train");
    expect(by.get("b6")?.device).toBe("fog-lift");
    expect(new Set(r.beats.map((b) => b.device)).size).toBe(deck.length);
    expect(r.note).toMatch(/b3: "spike-train" repeated/);
    expect(r.note).toMatch(/b5: no usable name/);
    expect(deviceName("  Edge   Sweep  ")).toBe("edge-sweep");
  });

  it("survives a failed call, and a rerun reads the decided names back without a call", async () => {
    const failed = await assignDevices(deck, {
      artCap: 6,
      work,
      timeoutMs: 1000,
      run: async () => {
        throw new Error("codex exec exited 1");
      },
    });
    expect(failed.from).toBe("rule");
    expect(failed.note).toMatch(/device call failed/);

    const cacheDir = join(work, "cache");
    const names = deck.map((b, i) => ({
      id: b.id,
      device: `device-${i}`,
      illustrate: false,
      idea: "",
    }));
    let calls = 0;
    const run = async (args: RunnerArgs) => {
      calls++;
      await answer(names)(args);
    };
    const first = await assignDevices(deck, { artCap: 6, work, timeoutMs: 1000, run, cacheDir });
    const second = await assignDevices(deck, { artCap: 6, work, timeoutMs: 1000, run, cacheDir });
    expect(calls).toBe(1);
    expect(second.from).toBe("cache");
    expect(second.beats).toEqual(first.beats);
  });

  it("asks nothing when the budget refuses", async () => {
    let calls = 0;
    const r = await assignDevices(deck, {
      artCap: 6,
      work,
      timeoutMs: 1000,
      take: () => "the Codex quota said no earlier in this pass",
      run: async () => {
        calls++;
      },
    });
    expect(calls).toBe(0);
    expect(r.note).toMatch(/quota/);
    expect(new Set(r.beats.map((b) => b.device)).size).toBe(deck.length);
  });

  it("is rendered into the scene prompts: this device and its planned composition", () => {
    const brief = {
      lang: "en",
      headline: "h",
      intent: "i",
      archetype: "pipeline",
      params: {},
      context: "",
      cues: [{ t0: 1, t1: 3, text: "a" }],
      duration: 6,
      region: { width: 1700, height: 658 },
      theme: resolveTheme("ink"),
      pack: "ink",
      device: "fog-lift",
      idea: "fog rolls off a city skyline from left to right as the voice names each layer",
    };
    const p = generatePrompt(brief);
    expect(p).toContain('THE VISUAL DEVICE: "fog-lift"');
    expect(p).toContain("planned this scene as: fog rolls off a city skyline");
    expect(p).toMatch(/FORBIDDEN AS THE MAIN VISUAL[\s\S]*row of rounded cards/);
    expect(p).toMatch(/TRUTHFUL PICTURES[\s\S]*SINKS/);
    expect(p).toMatch(/TEXT never below 0\.6/);
    expect(generatePrompt({ ...brief, idea: undefined })).not.toContain("planned this scene as");
    const c = critiquePrompt(brief, SCENE, [], undefined);
    expect(c).toContain('visual device: "fog-lift" — keep it (planned as: fog rolls off');
  });

  it("asks the device pass for varied compositions and truthful pictures", () => {
    const p = devicePrompt(deck, 3);
    expect(p).toMatch(/VARY THE COMPOSITION/);
    expect(p).toMatch(/two big numbers in two colours above a shape/);
    expect(p).toMatch(/larger or heavier value SINKS/);
    expect(p).toMatch(/proportional to it from zero/);
    expect(p).not.toMatch(/ALREADY DECIDED/);
  });
});

/* ------------------------------------------------------------ rubric probe */

describe("the rubric probe", () => {
  const kinds = ["flow", "counter", "focus"];
  const ok = {
    fill: 0.9,
    cells: 0.8,
    maxType: 56,
    maxDeclared: 56,
    kinds,
    cueChange: [0.02, 0.03],
  };
  it("is clean only when every measurable criterion is", () => {
    expect(rubricProbe(ok)).toEqual([]);
    expect(rubricProbe(undefined)).toEqual(["nothing was measured"]);
    expect(rubricProbe({ ...ok, fill: 0.7 })).toHaveLength(1);
    expect(rubricProbe({ ...ok, mass: 0.2 })).toEqual([]);
    expect(rubricProbe({ ...ok, mass: 0.08 })).toHaveLength(1);
    expect(rubricProbe({ ...ok, dimmed: 0.3 })).toEqual([]);
    expect(rubricProbe({ ...ok, dimmed: 0.7 })).toHaveLength(1);
    // Quiet type (founder, 2026-10-10): one label reaches 44px, none passes 56.
    expect(rubricProbe({ ...ok, maxType: 40 })).toHaveLength(1);
    expect(rubricProbe({ ...ok, maxType: 70, maxDeclared: 44 })).toEqual([]);
    expect(rubricProbe({ ...ok, maxDeclared: 88 })).toHaveLength(1);
    expect(rubricProbe({ ...ok, kinds: ["draw", "focus", "stagger"] })).toHaveLength(1);
    expect(rubricProbe({ ...ok, kinds: ["flow"] })).toHaveLength(1);
    expect(rubricProbe({ ...ok, cueChange: [0.02, 0.001] })).toHaveLength(1);
    expect(rubricProbe(ok, ["overlapping_gsap_tweens: x"])).toHaveLength(1);
  });
});

describe("a tool-less codex call", () => {
  it("turns every tool feature, web search and each configured MCP server off", async () => {
    const { leanCodexConfig, codexCommand, TOOL_FEATURES } = await import("../src/plan/codex.js");
    const list = async () =>
      JSON.stringify([
        { name: "hypepaper", enabled: true },
        { name: "off-already", enabled: false },
        { name: "bad name; rm", enabled: true },
      ]);
    const config = await leanCodexConfig("codex", list);
    for (const f of TOOL_FEATURES) expect(config).toContain(`features.${f}=false`);
    expect(config).toContain('web_search="disabled"');
    expect(config).toContain("mcp_servers.hypepaper.enabled=false");
    expect(config.join(" ")).not.toContain("off-already");
    expect(config.join(" ")).not.toContain("rm");
    const { argv } = codexCommand({
      prompt: "p",
      schemaPath: "s",
      outPath: "o",
      timeoutMs: 1,
      cwd: "/w",
      config: ["features.shell_tool=false"],
    });
    expect(argv.join(" ")).toContain("-C /w --sandbox read-only");
    expect(argv.join(" ")).toContain("-c features.shell_tool=false");
  });
});

describe("a scene that morphs", () => {
  it("registers MorphSVG for that deck only", async () => {
    const { bespokeScene, usesMorph } = await import("../src/bespoke/scene.js");
    const beat = demo.beats.find((b) => b.archetype === "pipeline") as (typeof demo.beats)[number];
    const ctx = { source, format: deck16, theme: resolveTheme("ink"), sid: "s3", start: 0 };
    const morph = {
      ...SCENE,
      script: `${SCENE.script}\ntl.to("#SCENEID-dot", { morphSVG: "#SCENEID-b", duration: 1 }, 2);`,
    };
    expect(usesMorph(morph.script)).toBe(true);
    expect(bespokeScene(beat, ctx, { fragment: morph, holds: [1] }).plugins).toEqual(["morphSVG"]);
    expect(bespokeScene(beat, ctx, { fragment: SCENE, holds: [1] }).plugins).toBeUndefined();
  });
});

describe("pinning a verify finding to a probed scene", () => {
  const windows = [{ sid: "s10", beatId: "b11", start: 140, duration: 20, cues: [] }];
  it("by selector, by beat, and by time — but never another scene's", async () => {
    const { attribute } = await import("../src/bespoke/probe.js");
    const f = (message: string, beatId?: string) => ({
      severity: "error" as const,
      gate: "g",
      rule: "r",
      message,
      ...(beatId ? { beatId } : {}),
    });
    expect(attribute(f("x [#s10-a t=150s]"), windows)).toBe("s10");
    expect(attribute(f("x", "b11"), windows)).toBe("s10");
    expect(attribute(f("x at t=150.2s"), windows)).toBe("s10");
    expect(attribute(f("x [#s9-chart t=148.489s]"), windows)).toBeUndefined();
  });
});
