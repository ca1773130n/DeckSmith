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
import { leanCodexConfig, type Runner, type RunnerArgs, runCodex } from "../plan/codex.js";
import type { Prefs } from "../prefs.js";
import { planTiming } from "../render/timing.js";
import type { Beat, Format, Source, Storyboard } from "../types.js";
import {
  GATES_VERSION,
  KEY_TYPE_PX,
  type SceneWindow,
  STAGE_FILL,
  sceneWindows,
} from "../verify/scenes.js";
import { cacheKey, defaultCacheDir, type KeyInput, SceneCache } from "./cache.js";
import { checkFragment, type Fragment, motionKinds } from "./contract.js";
import {
  type Brief,
  CONTRACT_VERSION,
  critiquePrompt,
  generatePrompt,
  type Measured,
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
  /** What the probe measured: the rubric probe reads it, the critique round is told it. */
  metrics?: Measured;
  /** Warnings about the scene itself (not the storyboard's), by rule. Any one sends it to critique. */
  warnings?: string[];
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
  /** Motion kinds the kept scene's script uses. */
  kinds?: string[];
  /** The probe's measures of the kept scene (or of the last candidate, on a fallback). */
  metrics?: Measured;
  /** Whether a critique call was made, skipped because the rubric probe was clean, or never reached. */
  critique?: "ran" | "skipped" | "none";
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

/** Below this share of the frame, a cue "barely moves" by the rubric's measure (static_hold's floor is 0.015%). */
export const RUBRIC_CUE_CHANGE = 0.005;
/** The focal size the prompt asks for; the gate's floor is `KEY_TYPE_PX`. */
export const RUBRIC_FOCAL_PX = 88;
/**
 * The share of its box a settled drawing should paint. MEASURED 2026-10-08:
 * round 1's sixteen scenes painted 3.9-15.6% (median ~9%) — thin outlines and
 * small captions — and round 2's first twenty 10-57% (median ~25%).
 */
export const RUBRIC_MASS = 0.12;
/**
 * More than this share of the drawn parts under 0.6 opacity at the settled
 * frame, and the end is not a summary. Round 2's first full run left zh s6 and
 * en s6 ending on a frame of ghosts with one lit part.
 */
export const RUBRIC_DIMMED = 0.5;
/** Motion kinds that are more than fade-and-draw; a scene should use one. */
const EXPLAINING = ["flow", "camera", "counter", "morph"];

/**
 * The rubric probe: is a scene that passed every gate also clean by the
 * rubric's MEASURABLE half? Free — it reads what the probe already measured —
 * and it decides whether the critique call (~4 minutes, ~30k tokens) is spent.
 * Empty means clean. What it cannot measure (is this the right picture for the
 * sentence?) it does not pretend to; that is the reason a clean scene is still
 * looked at by a person in the preview.
 */
export function rubricProbe(m: Measured | undefined, warnings: readonly string[] = []): string[] {
  if (!m) return ["nothing was measured"];
  const out: string[] = [];
  for (const w of warnings) out.push(`warning: ${w}`);
  if (m.fill === undefined || m.fill < STAGE_FILL) out.push("the drawing does not fill the stage");
  if (m.mass !== undefined && m.mass < RUBRIC_MASS)
    out.push(`the drawing is thin: it paints ${Math.round(100 * m.mass)}% of its box`);
  if (m.dimmed !== undefined && m.dimmed > RUBRIC_DIMMED)
    out.push(`the end frame is mostly dimmed (${Math.round(100 * m.dimmed)}% of its parts)`);
  if (m.cells !== undefined && m.cells < 0.6)
    out.push(`something is drawn in only ${Math.round(100 * m.cells)}% of the 6x4 grid`);
  if ((m.maxType ?? 0) < Math.max(KEY_TYPE_PX, RUBRIC_FOCAL_PX))
    out.push(`no focal label reaches ${RUBRIC_FOCAL_PX}px`);
  const kinds = m.kinds ?? [];
  if (kinds.length < 3) out.push(`only ${kinds.length} kind(s) of motion`);
  if (!kinds.some((k) => EXPLAINING.includes(k)))
    out.push("no flow, camera, counter or morph — the motion is fades and draws");
  (m.cueChange ?? []).forEach((c, i) => {
    if (c < RUBRIC_CUE_CHANGE) out.push(`cue ${i + 1} barely moves (${(100 * c).toFixed(2)}%)`);
  });
  return out;
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

/** A gate's measures with the candidate's motion kinds added. */
function withKinds(m: Measured | undefined, f: Fragment | undefined): Measured | undefined {
  if (!m) return undefined;
  return f ? { ...m, kinds: motionKinds(f.script) } : m;
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
  // Tool-less, single-turn calls (see TOOL_FEATURES), at the configured effort.
  // Only for the production runner: a test's runner never spawns anything.
  const effort = prefs.effort ?? "medium";
  const config = [
    ...(input.run ? [] : await leanCodexConfig(prefs.cli ?? "codex")),
    ...(effort === "default" ? [] : [`model_reasoning_effort="${effort}"`]),
  ];

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
    /** The measures (with the script's motion kinds) of the draft and of the fix. */
    draftMetrics?: Measured;
    draftWarnings: string[];
    fixedMetrics?: Measured;
    critique: "ran" | "skipped" | "none";
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
      draftWarnings: [],
      critique: "none",
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
        // The scratch dir, so no project's AGENTS.md is read into the call.
        cwd: work,
        config,
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
  // With no fresh draft there is nothing for a critique round to look at, and
  // the final round gates the cached scenes anyway: one probe build, not two.
  const gateA = fresh.some((b) => b.draft)
    ? await gate(draftMap, "draft")
    : new Map<string, GateResult>();
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
    b.draftWarnings = g.warnings ?? [];
    b.draftMetrics = withKinds(g.metrics, b.draft);
  }

  // Round 2: one critique-and-fix per drafted beat that needs one, frames
  // attached. A draft that passed every gate AND is clean by the rubric probe
  // is kept as it is: the call would cost minutes to restate a clean bill.
  const drafted = work1.filter((b) => b.draft && !b.stop);
  for (const b of drafted) {
    if (!b.draftPassed) continue;
    const issues = rubricProbe(b.draftMetrics, b.draftWarnings);
    if (issues.length === 0) {
      b.critique = "skipped";
      step(
        `bespoke: ${b.beat.id} — every gate passed and the rubric probe is clean; no critique call`,
      );
    } else step(`bespoke: ${b.beat.id} — to critique: ${issues.slice(0, 3).join("; ")}`);
  }
  await pool(
    drafted.filter((b) => b.critique !== "skipped"),
    prefs.concurrency,
    async (b) => {
      const g = gateA.get(b.beat.id);
      b.critique = "ran";
      const f = await call(
        b,
        "critique",
        critiquePrompt(
          b.brief,
          b.draft as Fragment,
          b.draftFindings,
          g?.sheet ? g.legend : undefined,
          b.draftMetrics,
        ),
        g?.sheet ? [g.sheet] : [],
      );
      if (!f) return;
      b.fixed = f;
      b.fixedFindings = statics(f);
    },
  );

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
      critique: b.critique,
      ...extra,
    });
    const gb = gateB.get(b.beat.id);
    if (b.cached) {
      if (gb && !gb.failed) {
        map[b.beat.id] = { fragment: b.cached, holds: b.holds };
        const metrics = withKinds(gb.metrics, b.cached);
        scenes.push(
          report1("bespoke", {
            from: "cache",
            kinds: motionKinds(b.cached.script),
            ...(metrics ? { metrics } : {}),
          }),
        );
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
    let metrics: Measured | undefined;
    if (b.fixed && b.fixedFindings.length === 0 && gb && !gb.failed) {
      fragment = b.fixed;
      from = "critique";
      metrics = withKinds(gb.metrics, b.fixed);
    } else if (b.draft && b.draftPassed) {
      // The fix round broke a draft that had passed: keep the draft.
      fragment = b.draft;
      from = "draft";
      metrics = b.draftMetrics;
      note = b.fixed
        ? `the critique round's scene failed (${(b.fixedFindings.length ? b.fixedFindings : (gb?.findings ?? [])).slice(0, 2).join("; ")}); kept the draft, which passed`
        : b.critique === "skipped"
          ? "every gate passed and the rubric probe was clean; kept the draft without a critique call"
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
          kinds: motionKinds(fragment.script),
          ...(metrics ? { metrics } : {}),
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
    const last = b.fixed ? withKinds(gb?.metrics, b.fixed) : b.draftMetrics;
    scenes.push(report1("fallback", { reason, findings, ...(last ? { metrics: last } : {}) }));
  }

  if (!input.work) await rm(work, { recursive: true, force: true });
  const r = report();
  step(
    `bespoke: ${Object.keys(map).length} of ${selection.picked.length} beats drawn bespoke, ${r.calls} Codex call(s), ${r.tokens} tokens, ${r.seconds}s${r.quota ? " — the quota said no" : ""}`,
  );
  return { map, report: r };
}
