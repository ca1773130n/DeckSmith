/**
 * The bespoke pass: for a few beats per deck, ask Codex for a scene, look at
 * it, ask once more, look again — and keep the archetype wherever that did not
 * produce something every gate passes. It never fails the deck.
 *
 *   select (deterministic)  →  cache  →  generate  →  static check
 *     →  build a probe deck, photograph every cue, run the gates
 *     →  critique-and-fix with the frames attached  →  static check
 *     →  probe again  →  keep what passed, fall back for the rest
 *
 * ONE critique round, not a loop. The spike measured it as the round that
 * matters — it caught a giant stray arc no gate saw — and every further round
 * is another ~4 minutes and ~60k tokens on a quota that has already stopped
 * deck production once (2026-09-08..12).
 *
 * HARD CAPS, both checked before every call: `maxCalls` Codex calls and
 * `maxSeconds` of wall time for the whole pass. A quota or rate-limit answer
 * stops all further calls at once. Whatever is left falls back to v2 — the
 * deck is never failed and never waits on a model that has said no.
 *
 * Codex only through the CLI the account already has (`codex exec`), never an
 * API key; the binary and model are preferences.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bespokeStaging,
  type DeckNarration,
  emitComposition,
  planCut,
} from "../emit/composition.js";
import type { EmitContext } from "../emit/kit.js";
import { deckLook } from "../emit/theme.js";
import { type Runner, type RunnerArgs, runCodex } from "../plan/codex.js";
import type { Prefs } from "../prefs.js";
import { planTiming } from "../render/timing.js";
import type { Beat, Format, Source, Storyboard } from "../types.js";
import { GATES_VERSION, type SceneWindow, sceneWindows } from "../verify/scenes.js";
import { cacheKey, defaultCacheDir, type KeyInput, SceneCache } from "./cache.js";
import { checkFragment, type Fragment } from "./contract.js";
import {
  type Brief,
  CONTRACT_VERSION,
  critiquePrompt,
  generatePrompt,
  PROMPT_VERSION,
  REPLY_SCHEMA,
} from "./prompt.js";
import { type BespokeMap, bespokeRegion } from "./scene.js";
import { type Skip, selectBespoke } from "./select.js";

export type BespokePrefs = NonNullable<Prefs["bespoke"]>;

/** What a gate round says about one beat's candidate scene. */
export interface GateResult {
  /** One line per finding, fed verbatim to the critique round. */
  findings: string[];
  failed: boolean;
  /** A contact sheet of the probe frames, for `codex exec -i`. */
  sheet?: string;
  /** What each cell of the sheet is. */
  legend?: string;
}

/** Builds a deck with these candidates, gates each, and says what it found — keyed by beat id. */
export type GateFn = (
  candidates: BespokeMap,
  round: "draft" | "final",
) => Promise<Map<string, GateResult>>;

export interface BespokeInput {
  storyboard: Storyboard;
  source: Source;
  format: Format;
  narration: DeckNarration;
  /** The resolved pack name, as `build` picked it. */
  theme: string;
  speed: number;
  prefs: BespokePrefs;
  /** Builds and gates a probe deck. `build` passes the browser gate (src/bespoke/probe.ts). */
  gate: GateFn;
  onStep?: (message: string) => void;
  /** Swappable for tests; the production runner is `codex exec`. */
  run?: Runner;
  now?: () => number;
  /** Scratch for prompts, replies and sheets. Default: a temp dir, removed at the end. */
  work?: string;
}

export interface SceneReport {
  beat: string;
  archetype: string;
  status: "bespoke" | "fallback";
  /** Where the scene came from, when there is one. */
  from?: "cache" | "draft" | "critique";
  /** Why it fell back, or a note on the scene kept. */
  reason?: string;
  calls: number;
  /** The last round's findings, for whoever reads this file. */
  findings: string[];
  key?: string;
  /** The scene id it was drawn at, filled in once the deck is emitted. */
  sid?: string;
}

export interface BespokeReport {
  version: 1;
  model: string;
  promptVersion: string;
  contractVersion: string;
  gates: string;
  caps: { calls: number; seconds: number };
  calls: number;
  tokens: number;
  seconds: number;
  quota: boolean;
  scenes: SceneReport[];
  skipped: Skip[];
}

export interface BespokeResult {
  map: BespokeMap;
  report: BespokeReport;
}

interface Reply {
  review: string;
  plan: string;
  markup: string;
  css: string;
  script: string;
}

/** Codex's own words for "no more today" — any of these stops every remaining call. */
const QUOTA = /usage limit|rate.?limit|quota|429|too many requests|exceeded|insufficient/i;

/** One Codex call's ceiling. A generation took 174-202s and a critique 238-329s in the spike. */
const CALL_SECONDS = 900;

export class Budget {
  calls = 0;
  tokens = 0;
  quota = false;
  constructor(
    readonly cap: number,
    readonly deadline: number,
    readonly now: () => number,
  ) {}
  /** Undefined if a call may go ahead (and is counted), else why not. */
  take(): string | undefined {
    if (this.quota) return "the Codex quota said no earlier in this pass";
    if (this.calls >= this.cap) return `the deck's cap of ${this.cap} Codex calls is spent`;
    if (this.deadline - this.now() < 60_000) return "the bespoke pass's wall-time cap is spent";
    this.calls++;
    return undefined;
  }
  seconds(): number {
    return Math.max(30, Math.min(CALL_SECONDS, Math.floor((this.deadline - this.now()) / 1000)));
  }
}

/** Run `fn` over `items`, at most `n` at once, in order of completion. */
async function pool<T>(
  items: readonly T[],
  n: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, lane));
}

/** The paper the prompt may quote for this beat: its cited sections, equations and figure captions. */
export function contextFor(beat: Beat, source: Source): string {
  const ids = (kind: string) =>
    new Set(beat.evidence.filter((e) => e.kind === kind).map((e) => e.id));
  const sections = ids("section");
  const eqs = ids("equation");
  const figs = ids("figure");
  const parts = [
    ...source.sections
      .filter((s) => sections.has(s.id))
      .map((s) => `### ${s.heading}\n${s.text.slice(0, 1400)}`),
    ...source.equations.filter((e) => eqs.has(e.id)).map((e) => `equation ${e.id}: ${e.tex}`),
    ...source.figures.filter((f) => figs.has(f.id)).map((f) => `figure ${f.id}: ${f.caption}`),
  ];
  return parts.join("\n\n").slice(0, 6000) || "(no excerpt cited)";
}

export async function bespokePass(input: BespokeInput): Promise<BespokeResult> {
  const { storyboard, source, format, narration, prefs } = input;
  const step = input.onStep ?? (() => {});
  const now = input.now ?? Date.now;
  const started = now();
  const budget = new Budget(prefs.maxCalls, started + prefs.maxSeconds * 1000, now);
  const model = prefs.model ?? "default";
  const scenes: SceneReport[] = [];
  const report = (): BespokeReport => ({
    version: 1,
    model,
    promptVersion: PROMPT_VERSION,
    gates: GATES_VERSION,
    contractVersion: CONTRACT_VERSION,
    caps: { calls: prefs.maxCalls, seconds: prefs.maxSeconds },
    calls: budget.calls,
    tokens: budget.tokens,
    seconds: Math.round((now() - started) / 1000),
    quota: budget.quota,
    scenes,
    skipped,
  });
  let skipped: Skip[] = [];

  // A generated scene is keyed to cue SECONDS; a paced deck moves every one.
  if (input.speed !== 1) {
    step("bespoke: skipped — the deck is paced (speed ≠ 1), so cue times are not the scene's");
    return { map: {}, report: report() };
  }

  const { theme } = deckLook(storyboard, input.theme);
  // A beat its archetype cannot draw is dropped here exactly as `build` drops
  // it (`onBeatError`), silently, because `build` already says so: the pass
  // must stage the deck `build` will emit, and must never be what fails it.
  const base = {
    theme: input.theme,
    design: "v2" as const,
    narration,
    speed: 1,
    onBeatError: () => {},
  };
  const cut = planCut(storyboard, source, format, base);
  const kept = cut.kept;
  const selection = selectBespoke(kept, {
    seed: storyboard.sourceId,
    narration: narration.beats,
    max: Math.min(6, Math.floor(prefs.maxCalls / 2)),
  });
  skipped = selection.skipped;
  if (selection.picked.length === 0) {
    step("bespoke: no beat qualifies");
    return { map: {}, report: report() };
  }

  // Stage each pick: its stops, and the shell's opening, with the archetype's own functions.
  const ctxFor = (sid: string): EmitContext => ({
    source,
    format,
    theme,
    sid,
    start: 0,
    design: "v2",
  });
  const placeholder: Record<string, { fragment: Fragment; holds: number[] }> = {};
  for (const p of selection.picked) {
    const beat = kept.find((b) => b.id === p.beatId) as Beat;
    const segments = narration.beats[beat.id] ?? [];
    const { holds } = bespokeStaging(beat, ctxFor("s0"), segments, 1);
    placeholder[beat.id] = { fragment: { markup: "", css: "", script: "" }, holds };
  }
  // The deck as it will be timed, with empty bespoke scenes: the cue windows the
  // model is given are read off THIS, so they are the deck's own to the millisecond.
  const composition = emitComposition(storyboard, source, format, {
    ...base,
    bespoke: placeholder,
  });
  const timing = planTiming({
    storyboard,
    source,
    format,
    speed: 1,
    composition,
    beats: kept,
    narration,
    theme: input.theme,
    bespoke: placeholder,
  });
  const windows = new Map<string, SceneWindow>();
  for (const w of sceneWindows(timing)) {
    const i = Number(w.sid.slice(1)) - 1;
    const beat = kept[i];
    if (beat && placeholder[beat.id]) windows.set(beat.id, { ...w, beatId: beat.id });
  }

  const work = input.work ?? (await mkdtemp(join(tmpdir(), "decksmith-bespoke-")));
  await mkdir(work, { recursive: true });
  const schemaPath = join(work, "reply.schema.json");
  await writeFile(schemaPath, JSON.stringify(REPLY_SCHEMA));
  const cache = new SceneCache(prefs.cache ?? defaultCacheDir());
  const run = input.run ?? runCodex;

  interface Beat1 {
    beat: Beat;
    brief: Brief;
    key: string;
    holds: number[];
    calls: number;
    cached?: Fragment;
    draft?: Fragment;
    draftFindings: string[];
    draftPassed?: boolean;
    fixed?: Fragment;
    fixedFindings: string[];
    stop?: string;
    /** A fallback the beat earned (gates), as opposed to one the budget imposed. */
    earned?: boolean;
  }
  const work1: Beat1[] = [];
  for (const p of selection.picked) {
    const beat = kept.find((b) => b.id === p.beatId) as Beat;
    const w = windows.get(beat.id);
    const holds = placeholder[beat.id]?.holds ?? [];
    if (!w) {
      scenes.push({
        beat: beat.id,
        archetype: beat.archetype,
        status: "fallback",
        reason: "no scene window",
        calls: 0,
        findings: [],
      });
      continue;
    }
    const params = beat.params as { eyebrow?: string; headline: string };
    const region = bespokeRegion(beat, { format, theme });
    const brief: Brief = {
      lang: storyboard.lang,
      ...(params.eyebrow ? { eyebrow: params.eyebrow } : {}),
      headline: params.headline,
      intent: beat.intent,
      ...(beat.claim ? { claim: beat.claim } : {}),
      ...(beat.narration ? { narration: beat.narration } : {}),
      archetype: beat.archetype,
      params: beat.params,
      context: contextFor(beat, source),
      cues: w.cues,
      duration: w.duration,
      region,
      theme,
      pack: input.theme,
    };
    const keyInput: KeyInput = {
      promptVersion: PROMPT_VERSION,
      contractVersion: CONTRACT_VERSION,
      model,
      lang: storyboard.lang,
      beat: {
        id: beat.id,
        archetype: beat.archetype,
        intent: beat.intent,
        ...(beat.claim ? { claim: beat.claim } : {}),
        ...(beat.narration ? { narration: beat.narration } : {}),
        params: beat.params,
      },
      context: brief.context,
      cues: w.cues,
      duration: w.duration,
      holds,
      region,
      pack: { name: input.theme, ...theme },
    };
    work1.push({
      beat,
      brief,
      key: cacheKey(keyInput),
      holds,
      calls: 0,
      draftFindings: [],
      fixedFindings: [],
    });
  }

  // Cache first: a hit costs nothing, and a cached rejection is a free fallback.
  for (const b of work1) {
    const hit = await cache.get(b.key);
    if (hit?.verdict === "accepted" && hit.fragment && checkFragment(hit.fragment).length === 0) {
      b.cached = hit.fragment;
      step(`bespoke: ${b.beat.id} from cache`);
    } else if (hit?.verdict === "rejected" && hit.gates === GATES_VERSION) {
      b.stop = `cached rejection: ${hit.note}`;
      b.earned = true;
      step(`bespoke: ${b.beat.id} — cached rejection, keeping the archetype`);
    }
  }

  const call = async (b: Beat1, kind: "draft" | "critique", prompt: string, images: string[]) => {
    const refused = budget.take();
    if (refused) {
      b.stop = refused;
      return undefined;
    }
    b.calls++;
    const tag = `${b.beat.id}.${kind}`;
    const outPath = join(work, `${tag}.json`);
    await writeFile(join(work, `${tag}.prompt.md`), prompt);
    const t0 = now();
    try {
      const args: RunnerArgs = {
        prompt,
        schemaPath,
        outPath,
        timeoutMs: budget.seconds() * 1000,
        ...(prefs.model ? { model: prefs.model } : {}),
        ...(prefs.cli ? { bin: prefs.cli } : {}),
        ...(images.length ? { images } : {}),
        onUsage: (n) => {
          budget.tokens += n;
        },
      };
      await run(args);
      const reply = JSON.parse(await readFile(outPath, "utf8")) as Reply;
      step(`bespoke: ${tag} in ${Math.round((now() - t0) / 1000)}s`);
      return { markup: reply.markup ?? "", css: reply.css ?? "", script: reply.script ?? "" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (QUOTA.test(msg)) budget.quota = true;
      b.stop = `${kind} call failed: ${msg.split("\n").slice(-2).join(" ").slice(0, 240)}`;
      step(`bespoke: ${tag} failed — ${b.stop}`);
      return undefined;
    }
  };
  const statics = (f: Fragment) => checkFragment(f).map((x) => `${x.rule}: ${x.message}`);

  // Round 1: drafts, in parallel up to the concurrency cap.
  const fresh = work1.filter((b) => !b.cached && !b.stop);
  await pool(fresh, prefs.concurrency, async (b) => {
    const f = await call(b, "draft", generatePrompt(b.brief), []);
    if (!f) return;
    b.draft = f;
    b.draftFindings = statics(f);
  });

  // Gate the drafts that passed the static walk. Nothing that failed it is opened in a browser.
  const draftMap: Record<string, { fragment: Fragment; holds: number[] }> = {};
  for (const b of work1) {
    if (b.cached) draftMap[b.beat.id] = { fragment: b.cached, holds: b.holds };
    else if (b.draft && b.draftFindings.length === 0)
      draftMap[b.beat.id] = { fragment: b.draft, holds: b.holds };
  }
  const gate = async (m: BespokeMap, round: "draft" | "final") => {
    if (Object.keys(m).length === 0) return new Map<string, GateResult>();
    try {
      return await input.gate(m, round);
    } catch (err) {
      // No browser, a build that threw: nothing can be shown to pass, so nothing is used.
      const why = `the ${round} gates could not run: ${err instanceof Error ? err.message.split("\n")[0] : err}`;
      step(`bespoke: ${why}`);
      return new Map<string, GateResult>(
        Object.keys(m).map((id) => [id, { findings: [why], failed: true }]),
      );
    }
  };
  const gateA = await gate(draftMap, "draft");
  for (const b of work1) {
    const g = gateA.get(b.beat.id);
    if (!g) continue;
    if (b.cached) {
      // A cached scene that no longer passes is not used; it is not re-asked about either.
      if (g.failed) {
        b.cached = undefined;
        b.stop = `the cached scene now fails: ${g.findings.slice(0, 2).join("; ")}`;
      }
      continue;
    }
    b.draftFindings = g.findings;
    b.draftPassed = !g.failed;
  }

  // Round 2: one critique-and-fix per drafted beat, frames attached when there are frames.
  const drafted = work1.filter((b) => b.draft && !b.stop);
  await pool(drafted, prefs.concurrency, async (b) => {
    const g = gateA.get(b.beat.id);
    const f = await call(
      b,
      "critique",
      critiquePrompt(
        b.brief,
        b.draft as Fragment,
        b.draftFindings,
        g?.sheet ? g.legend : undefined,
      ),
      g?.sheet ? [g.sheet] : [],
    );
    if (!f) return;
    b.fixed = f;
    b.fixedFindings = statics(f);
  });

  const finalMap: Record<string, { fragment: Fragment; holds: number[] }> = {};
  for (const b of work1) {
    if (b.cached) finalMap[b.beat.id] = { fragment: b.cached, holds: b.holds };
    else if (b.fixed && b.fixedFindings.length === 0)
      finalMap[b.beat.id] = { fragment: b.fixed, holds: b.holds };
  }
  const gateB = await gate(finalMap, "final");

  const map: Record<string, { fragment: Fragment; holds: number[] }> = {};
  for (const b of work1) {
    const report1 = (status: "bespoke" | "fallback", extra: Partial<SceneReport>): SceneReport => ({
      beat: b.beat.id,
      archetype: b.beat.archetype,
      status,
      calls: b.calls,
      findings: [],
      key: b.key,
      ...extra,
    });
    const gb = gateB.get(b.beat.id);
    if (b.cached) {
      if (gb && !gb.failed) {
        map[b.beat.id] = { fragment: b.cached, holds: b.holds };
        scenes.push(report1("bespoke", { from: "cache" }));
      } else {
        scenes.push(
          report1("fallback", {
            reason: b.stop ?? "the cached scene failed the final gates",
            findings: gb?.findings ?? [],
          }),
        );
      }
      continue;
    }
    let fragment: Fragment | undefined;
    let from: SceneReport["from"];
    let note: string | undefined;
    if (b.fixed && b.fixedFindings.length === 0 && gb && !gb.failed) {
      fragment = b.fixed;
      from = "critique";
    } else if (b.draft && b.draftPassed) {
      // The fix round broke a draft that had passed: keep the draft.
      fragment = b.draft;
      from = "draft";
      note = b.fixed
        ? `the critique round's scene failed (${(b.fixedFindings.length ? b.fixedFindings : (gb?.findings ?? [])).slice(0, 2).join("; ")}); kept the draft, which passed`
        : `no critique round (${b.stop ?? "no reply"}); kept the draft, which passed`;
    }
    if (fragment) {
      map[b.beat.id] = { fragment, holds: b.holds };
      await cache.put({
        version: 1,
        key: b.key,
        verdict: "accepted",
        fragment,
        note: note ?? `kept the ${from} scene`,
        calls: b.calls,
        model,
        promptVersion: PROMPT_VERSION,
        gates: GATES_VERSION,
      });
      scenes.push(
        report1("bespoke", {
          from: from as "draft" | "critique",
          ...(note ? { reason: note } : {}),
        }),
      );
      continue;
    }
    // Fell back. Cached only when the GATES said so after a full attempt.
    const findings = b.fixed
      ? b.fixedFindings.length
        ? b.fixedFindings
        : (gb?.findings ?? [])
      : b.draftFindings;
    const earned = b.earned || (b.fixed !== undefined && !b.stop);
    const reason =
      b.stop && !b.fixed
        ? b.stop
        : `failed the gates after the critique round: ${findings.slice(0, 3).join("; ") || "no finding recorded"}`;
    if (earned && !b.stop?.startsWith("cached rejection")) {
      await cache.put({
        version: 1,
        key: b.key,
        verdict: "rejected",
        note: reason,
        calls: b.calls,
        model,
        promptVersion: PROMPT_VERSION,
        gates: GATES_VERSION,
      });
    }
    scenes.push(report1("fallback", { reason, findings }));
  }

  if (!input.work) await rm(work, { recursive: true, force: true });
  const r = report();
  step(
    `bespoke: ${Object.keys(map).length} of ${selection.picked.length} beats drawn bespoke, ${r.calls} Codex call(s), ${r.tokens} tokens, ${r.seconds}s${r.quota ? " — the quota said no" : ""}`,
  );
  return { map, report: r };
}
