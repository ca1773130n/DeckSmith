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
 * ONE critique round for every beat, not a loop. The spike measured it as the
 * round that matters — it caught a giant stray arc no gate saw — and every
 * further round is another ~4 minutes and ~60k tokens on a quota that has
 * already stopped deck production once (2026-09-08..12). A SECOND critique only
 * for a beat that would otherwise fall back, and only while the call cap and
 * `SECOND_SECONDS` of the clock allow: with every beat drawn, the three r1
 * fallbacks (2026-10-10) were the deck's core mechanism beats, 24% of its
 * running time spent on boxes and arrows, each failing on one or two
 * collisions its first critique had moved rather than removed.
 *
 * HARD CAPS, both checked before every call: `maxCalls` Codex calls and
 * `maxSeconds` of wall time for the whole pass. A quota or rate-limit answer
 * stops all further calls at once. Whatever is left falls back to v2 — the
 * deck is never failed and never waits on a model that has said no.
 *
 * Codex only through the CLI the account already has (`codex exec`), never an
 * API key; the binary and model are preferences.
 */
import { createHash } from "node:crypto";
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
import {
  artCodexConfig,
  leanCodexConfig,
  type Runner,
  type RunnerArgs,
  runCodex,
} from "../plan/codex.js";
import type { Prefs } from "../prefs.js";
import { planTiming } from "../render/timing.js";
import type { Beat, Format, Source, Storyboard } from "../types.js";
import {
  GATES_VERSION,
  KEY_TYPE_PX,
  type Layout,
  MAX_TYPE_PX,
  type SceneWindow,
  STAGE_FILL,
  sceneWindows,
  TYPE_MAX_PX,
} from "../verify/scenes.js";
import {
  ART_EFFORT,
  ART_VERSION,
  type ArtBrief,
  ArtCache,
  type ArtCheck,
  type ArtCopies,
  type ArtRef,
  artKey,
  type DepthCopies,
  drawArt,
  STOCK_MOTIFS,
  stockAllowed,
} from "./art.js";
import { cacheKey, canonical, defaultCacheDir, type KeyInput, SceneCache } from "./cache.js";
import { CARDS_VERSION, cardRow } from "./cards.js";
import { checkFragment, type Fragment, motionKinds } from "./contract.js";
import { checkBuild, chooseBuild, type DataBuild } from "./databuild.js";
import { type CutInput, cutPicture, type DepthInfo } from "./depth.js";
import { chooseGrammar, type Grammar, type Role, roleOf } from "./grammar.js";
import {
  FLAT_MIN,
  featurePrints,
  flatEnough,
  hexRgb,
  type Inspection,
  inspectPicture,
  printDistance,
} from "./inspect.js";
import {
  type Brief,
  CONTRACT_VERSION,
  critiquePrompt,
  DEVICE_SCHEMA,
  type DeviceBeat,
  devicePrompt,
  generatePrompt,
  type Measured,
  PROMPT_VERSION,
  REPLY_SCHEMA,
} from "./prompt.js";
import { type RepairNote, repairable, repairScene } from "./repair.js";
import {
  subjectsOf as artSubjects,
  type BespokeEntry,
  type BespokeMap,
  bespokeRegion,
  chromeBand,
  cineRegion,
  staging,
} from "./scene.js";
import { type Skip, selectBespoke } from "./select.js";
import { pictureCopies } from "./sheet.js";
import { artPlacement, closest, effectiveAt, type Shot, shotSummary } from "./shots.js";

export type BespokePrefs = NonNullable<Prefs["bespoke"]>;
export type { DeviceBeat };

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
  /** Every graded frame's layout with its repair geometry (src/bespoke/repair.ts reads it). */
  layout?: Layout[];
  /** The scene id the probe deck drew it at (to read ids in `layout` back to token form). */
  sid?: string;
}

/** Which probe: the drafts, the final candidates, or a repair round's. */
export type GateRound = "draft" | "final" | "repair" | "second";

/** Builds a deck with these candidates, gates each, and says what it found — keyed by beat id. */
export type GateFn = (candidates: BespokeMap, round: GateRound) => Promise<Map<string, GateResult>>;

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
  /** Where the image tool saves pictures. Default `$CODEX_HOME` or `~/.codex` (tests point it elsewhere). */
  codexHome?: string;
  /** Inspects a drawn picture (src/bespoke/inspect.ts); swappable so tests need no Swift or Vision. */
  inspect?: (bytes: Buffer, file: string, ground?: [number, number, number]) => Promise<Inspection>;
  /** Draws the deck's WebP and the boxed copy (src/bespoke/sheet.ts); swappable so tests need no Chrome. */
  copies?: (
    png: Buffer,
    boxes: Inspection["subjects"],
    box: { width: number; height: number },
    opts: { plate?: Buffer; ground?: string; cutout?: boolean },
  ) => Promise<ArtCopies>;
  /** Vision feature prints of pictures (src/bespoke/inspect.ts); swappable so tests need no Swift. */
  prints?: (pngs: readonly string[]) => Promise<number[][]>;
  /** Cuts a picture into depth planes (src/bespoke/depth.ts); swappable so tests need no Chrome or Core ML. */
  cut?: (i: CutInput) => Promise<DepthCopies>;
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
  /** The illustration the scene was built around, and what its inspection said. */
  art?: {
    key: string;
    depicts: string;
    subjects?: number;
    check?: ArtCheck;
    /** Drawn with a backdrop (two layers), and the setting it shows. */
    plate?: boolean;
    setting?: string;
    motifs?: string[];
    /** Round 6: its depth planes' distances (far to near), the subjects', and how they were made. */
    depth?: { planes: number[]; subjects: number[]; scale: number; info: DepthInfo };
  };
  /** Given a picture by the device pass's floor, not by the model's choice (`pictureFloor`). */
  pictureForced?: boolean;
  /** The camera grammar the scene was staged in (src/bespoke/grammar.ts), and its rhetorical role. */
  grammar?: string;
  role?: string;
  /** What the camera did, one word per move (`shotSummary`). */
  shots?: string;
  /** Picture pixels per output pixel at the scene's closest shot (`effectiveAt`; gate `EFF_MIN`). */
  effective?: number;
  /** A data scene's build (src/bespoke/databuild.ts). */
  build?: string;
  /** A data beat: drawn as a chart, never on a picture. */
  data?: boolean;
  /** The scene's visual device (`assignDevices`). */
  device?: string;
  /** A second critique call was made for it (round 4: its first critique's scene failed). */
  second?: boolean;
  /** Why there is none, when one was wanted. */
  artNote?: string;
  /** What the deterministic repair did to the kept scene (src/bespoke/repair.ts). */
  repair?: RepairNote & { rounds: number };
  /** The kept scene passed only after a repair: without one, this beat fell back. */
  savedByRepair?: boolean;
  /**
   * The scene id the probe deck had it at when the gates passed the kept bytes:
   * `build` skips re-running the full motion gates on a scene at that same id
   * (it still seeks it), because the pass already ran them on exactly this scene.
   */
  gatedAt?: string;
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
  /**
   * Illustrations: the deck's cap, calls made, pictures used (drawn or cached),
   * redraws made after a rejection, and pictures rejected for text / for style.
   */
  art: {
    cap: number;
    calls: number;
    used: number;
    redraws: number;
    rejectedText: number;
    rejectedStyle: number;
    rejectedSubjects: number;
    /** Pictures refused for repeating another picture of the deck (a motif, a stock subject, or a near-identical print). */
    rejectedRepeat: number;
    /** Pictures drawn with a backdrop (two layers). */
    plates: number;
  };
  /**
   * How much the deck's pictures repeat each other: the closest pair's
   * Vision feature-print distance (`SIMILAR_MAX` is the gate) and the mean,
   * and every subject noun two pictures share.
   */
  repetition?: { minPrint?: number; meanPrint?: number; shared: string[] };
  /** Wall seconds of the pass's stages, for profiling (`build` adds its own). */
  stages?: Record<string, number>;
  /** The deck-order device pass: where its names came from, and why any were replaced. */
  devices?: { from: DeviceAssignment["from"]; note?: string };
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
  shots?: unknown;
  labels?: unknown;
}

/** Codex's own words for "no more today" — any of these stops every remaining call. */
const QUOTA = /usage limit|rate.?limit|quota|429|too many requests|exceeded|insufficient/i;

/**
 * What a cached verdict was reached under: the browser's gates and the static
 * `card_row`. A rejection stamped otherwise is asked about again.
 */
export const GATE_STAMP = `${GATES_VERSION}+${CARDS_VERSION}`;

/** One scene call's ceiling when the prefs name none (`bespoke.callSeconds`). */
const CALL_SECONDS = 600;
/** An illustration call's ceiling: MEASURED 36-49s; a stuck image tool should not hold the deck. */
const ART_SECONDS = 240;
/** A second critique starts only with this much of the wall-time cap left, seconds. */
export const SECOND_SECONDS = 420;
/** Repair rounds after the final gates, each one probe build of the repaired scenes only. */
export const REPAIR_ROUNDS = 2;

export class Budget {
  calls = 0;
  /** Illustration calls, capped apart from `calls` (`prefs.art`). */
  art = 0;
  /** Second draws after a rejected picture: one per beat at most, under the same cap plus one each. */
  redraws = 0;
  rejectedText = 0;
  rejectedStyle = 0;
  rejectedSubjects = 0;
  rejectedRepeat = 0;
  /** Device-pass calls (one a deck at most). */
  devices = 0;
  tokens = 0;
  quota = false;
  constructor(
    readonly cap: number,
    readonly deadline: number,
    readonly now: () => number,
    /** The per-call ceiling, seconds: the per-scene timeout. */
    readonly callSeconds = CALL_SECONDS,
  ) {}
  /** Undefined if a call may go ahead (and is counted), else why not. */
  take(): string | undefined {
    if (this.quota) return "the Codex quota said no earlier in this pass";
    if (this.calls >= this.cap) return `the deck's cap of ${this.cap} Codex calls is spent`;
    if (this.deadline - this.now() < 60_000) return "the bespoke pass's wall-time cap is spent";
    this.calls++;
    return undefined;
  }
  /** As `take`, for an illustration call against its own cap. */
  takeArt(cap: number): string | undefined {
    if (this.quota) return "the Codex quota said no earlier in this pass";
    if (this.art >= cap) return `the deck's ${cap} illustrations are spent`;
    if (this.deadline - this.now() < 120_000)
      return "the bespoke pass's wall-time cap is too close";
    this.art++;
    return undefined;
  }
  /** The deck's one device call: apart from the scene cap, but not past the quota or the clock. */
  takeDevice(): string | undefined {
    if (this.quota) return "the Codex quota said no earlier in this pass";
    if (this.deadline - this.now() < 120_000)
      return "the bespoke pass's wall-time cap is too close";
    this.devices++;
    return undefined;
  }
  /** One redraw of a rejected picture: not against the art cap, but against the clock and the quota. */
  takeRedraw(): string | undefined {
    if (this.quota) return "the Codex quota said no earlier in this pass";
    if (this.deadline - this.now() < 180_000)
      return "the bespoke pass's wall-time cap is too close";
    this.redraws++;
    return undefined;
  }
  seconds(): number {
    return Math.max(
      30,
      Math.min(this.callSeconds, Math.floor((this.deadline - this.now()) / 1000)),
    );
  }
}

/**
 * `run`, with at most `n` calls in flight across every kind — pictures, the
 * device call and scenes alike. The lanes of `pool` bound the scene calls only;
 * every beat's picture starts at once, and with every beat of a deck now drawn
 * that would put a dozen Codex processes on the machine together.
 *
 * `admit` is asked once a lane is free, just before the call starts: a call
 * can wait minutes for one (drafts queue behind 240s pictures), so a budget or
 * timeout decided when it was queued is stale by then. It returns the args to
 * run with, or throws to refuse.
 */
export function lanes(run: Runner, n: number, admit?: (args: RunnerArgs) => RunnerArgs): Runner {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return async (args) => {
    if (active < Math.max(1, n)) active++;
    else await new Promise<void>((go) => waiting.push(go));
    try {
      await run(admit ? admit(args) : args);
    } finally {
      release();
    }
  };
}

/**
 * The wall-time cap, applied when a call actually starts (`lanes`' admit): a
 * call that waited past the deadline is refused, and none may run past it.
 */
export function deadlineAdmit(deadline: number, now: () => number) {
  return (args: RunnerArgs): RunnerArgs => {
    const left = deadline - now();
    if (left < 30_000)
      throw new Error(
        "the bespoke pass's wall-time cap is too close: this call waited for a lane past it",
      );
    return { ...args, timeoutMs: Math.min(args.timeoutMs, left) };
  };
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

/** Grammars that need two subjects or more: a one-subject picture is staged as a zoom-out instead. */
export const ONE_SUBJECT_UNSTAGEABLE: readonly string[] = ["follow", "rack", "cutaway", "parallax"];

/** Below this share of the frame, a cue "barely moves" by the rubric's measure (static_hold's floor is 0.015%). */
export const RUBRIC_CUE_CHANGE = 0.005;
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
export function rubricProbe(
  m: Measured | undefined,
  warnings: readonly string[] = [],
  art = false,
): string[] {
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
  // The type is quiet (`TYPE_SCALE`): a diagram's one label reaches the body
  // size; nothing declares more than the headline, and (round 6) nothing RENDERS
  // more, camera zoom included. The 88px focal word this asked for until
  // 2026-10-10 is what the founder called "too large".
  if (!art && (m.maxType ?? 0) < KEY_TYPE_PX) out.push(`no label reaches ${KEY_TYPE_PX}px`);
  if ((m.maxDeclared ?? 0) > MAX_TYPE_PX + 0.5)
    out.push(`a label is ${Math.round(m.maxDeclared ?? 0)}px — nothing over ${MAX_TYPE_PX}px`);
  if ((m.maxType ?? 0) > TYPE_MAX_PX)
    out.push(
      `a word renders at ${Math.round(m.maxType ?? 0)}px, over the ${TYPE_MAX_PX - 0.5}px headline`,
    );
  // Round 6: no UI animated into place (the gate holds it; the rubric says it too).
  if (m.uiMotion?.length) out.push(`UI animated into place: ${m.uiMotion.slice(0, 3).join("; ")}`);
  // A scene on a picture moves by the picture — the shell's camera through its
  // depth, focus and light — so its own script is not held to kinds of motion.
  if (!art) {
    const kinds = m.kinds ?? [];
    if (kinds.length < 3) out.push(`only ${kinds.length} kind(s) of motion`);
    if (!kinds.some((k) => EXPLAINING.includes(k)))
      out.push("no flow, camera, counter or morph — the motion is fades and draws");
  }
  // A scene built on an illustration explains it by staging shots on its subjects,
  // and names them where they are.
  const want = Math.min(2, m.subjects ?? 2);
  // Push-ins are what tour, follow, rack and cutaway are made of; a wipe, a
  // zoom-out and a parallax truck stage the picture otherwise.
  const pushes = ["tour", "follow", "rack", "cutaway"].includes(m.grammar ?? "tour");
  if (art && pushes && m.shots !== undefined && m.shots < want)
    out.push(`only ${m.shots} push-in(s) on the picture's subjects`);
  if (art && m.establishing === false)
    out.push(
      m.grammar === "zoom-out"
        ? "a zoom-out does not open close on its detail"
        : "it does not open on the whole picture",
    );
  (m.cueChange ?? []).forEach((c, i) => {
    if (c < RUBRIC_CUE_CHANGE) out.push(`cue ${i + 1} barely moves (${(100 * c).toFixed(2)}%)`);
  });
  return out;
}

/**
 * Archetypes whose beat IS its numbers. Round 3 illustrated them like any other
 * beat and the scene painted the table over the picture (ja s12: nine numbers
 * on a robot). A data beat gets no picture and the chart that builds instead.
 */
export const DATA_ARCHETYPES: readonly string[] = ["line-chart", "bar-compare", "data-table"];

export function isDataBeat(beat: Pick<Beat, "archetype">): boolean {
  return DATA_ARCHETYPES.includes(beat.archetype);
}

/** A reply's shot list, kept only where it is the shape the schema promised. */
export function readShots(raw: unknown): Shot[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is Shot =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as Shot).cue === "number" &&
        typeof (s as Shot).at === "number" &&
        typeof (s as Shot).subject === "number",
    )
    .slice(0, 24)
    .map((s) => ({ cue: s.cue, at: s.at, subject: s.subject }));
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

/* -------------------------------------------------------------- devices */

/** One beat's device, as the deck-order pass decided it. */
export interface BeatDevice {
  beatId: string;
  /** Kebab-case name of the scene's main visual device. Unique in the deck. */
  device: string;
  /** Whether the beat gets an illustration; otherwise its scene is pure motion graphics. */
  illustrate: boolean;
  /** What the scene shows, how it is composed and how it moves, when the model gave it. */
  idea?: string;
  /** An illustrated beat's planned setting and subjects (round 5): the deck's pictures planned together. */
  setting?: string;
  subjects?: string[];
  /** Where the name came from: the model, or the rule catalogue (no call, a bad or repeated name). */
  from: "codex" | "rule";
  /** Illustrated only because of the picture floor (`pictureFloor`), not by the model's choice. */
  forced?: true;
  /** What the beat's narration does (src/bespoke/grammar.ts `roleOf`). */
  role: Role;
  /** An illustrated beat's camera grammar (`chooseGrammar`), never the previous illustrated beat's. */
  grammar?: Grammar;
  /** A data beat's build (src/bespoke/databuild.ts `chooseBuild`), never one an earlier data beat used. */
  build?: DataBuild;
}

/** What `assignDevices` returns: one entry per beat, in deck order. */
export interface DeviceAssignment {
  beats: BeatDevice[];
  /** `cache`: read back from a previous run, no call. */
  from: "codex" | "cache" | "rule";
  /** Why the model's answer was not used, or was used only in part. */
  note?: string;
}

export interface DeviceOptions {
  /** The model runner. Absent: the rule catalogue only, no call. */
  run?: Runner;
  /** Asked before the call: undefined lets it go ahead (src/bespoke/pipeline.ts `Budget`). */
  take?: () => string | undefined;
  /** Illustrations the deck may draw. */
  artCap: number;
  model?: string;
  bin?: string;
  config?: readonly string[];
  /** Scratch for the prompt, schema and reply. */
  work: string;
  timeoutMs: number;
  /** Where a decided assignment is kept, so a rerun asks nothing. */
  cacheDir?: string;
  onUsage?: (tokens: number) => void;
}

/** Bump with any change to the device prompt or the rules applied to its answer. */
export const DEVICE_VERSION = "devices-2";

/**
 * Devices for a beat the model gave none for (no call, a failed call, a name
 * repeated or not a name). By archetype first, then a shared pool; each used
 * once per deck. None is a layout: the catalogue is the prompt's own rule.
 */
const RULE_DEVICES: Readonly<Record<string, readonly string[]>> = {
  title: ["particle-assembly", "light-sweep", "dawn-reveal"],
  "claim-figure": ["lens-focus", "horizon-reveal"],
  "equation-walk": ["term-spotlight", "balance-scale"],
  "equation-morph": ["term-morph", "shape-shift"],
  "data-table": ["track-race", "heat-strip"],
  "line-chart": ["traced-curve", "rising-tide"],
  "bar-compare": ["draining-light-bars", "rising-water"],
  "hero-number": ["counter-burst", "odometer-roll"],
  callout: ["light-beam", "ink-bloom"],
  pipeline: ["conveyor-flow", "relay-baton"],
  "annotated-figure": ["magnifier-sweep", "x-ray-scan"],
  grid: ["constellation", "mosaic-assemble"],
  stack: ["layer-peel", "stacking-tower"],
  "split-compare": ["tug-of-war", "twin-horizons"],
  stage: ["orbit-system", "ripple-wave"],
  kinetic: ["drifting-particles", "light-trail"],
};

/**
 * A device that is TYPE or a UI ELEMENT doing the moving: kinetic type, giant
 * lettering, a title, words; cards, chips, labels, plates, tiles, badges,
 * gauges and stamps. The founder (2026-10-10): "graphic animation by animated
 * UI elements is old-fashioned, and the fonts are too large" — the motion comes
 * from the picture. r3's `kinetic-title` drew EM-SNN as 350px letterforms the
 * type gates cannot see (they are paths, not text).
 *
 * Applied to every answer, cached ones included, so DEVICE_VERSION is NOT
 * bumped: a beat whose decided device is one of these is simply undecided
 * again, and every other beat keeps its device and the scene cached under it.
 */
const UI_DEVICE =
  /(^|-)(kinetic|type|typo|typography|word|words|letter|letters|lettering|title|headline|text|card|cards|chip|chips|label|labels|tile|tiles|plate|plates|badge|badges|gauge|gauges|stamp|stamps)(-|$)/;

/** Whether a device name is type or a UI element rather than a picture (`UI_DEVICE`). */
export function isUiDevice(name: string): boolean {
  return UI_DEVICE.test(name);
}
const POOL = [
  "particle-swarm",
  "ripple-wave",
  "orbit-system",
  "pendulum-swing",
  "domino-chain",
  "growing-tree",
  "tide-flow",
  "signal-pulse",
  "prism-split",
  "magnet-pull",
  "sand-timer",
  "beam-scan",
];

/**
 * The fewest pictures a deck's device pass leaves it (round 6): every eligible
 * beat, at most the art cap — the motion is the picture's own.
 */
export function pictureFloor(eligible: number, artCap: number): number {
  return Math.min(artCap, eligible);
}
/** A model's name made a kebab-case device name, or "" when nothing is left of it. */
export function deviceName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 4)
    .join("-")
    .slice(0, 32)
    .replace(/-+$/, "");
}

/** A cached or replied answer, kept only when it is the shape the schema promised. */
type Answer = {
  id: string;
  device: string;
  illustrate: boolean;
  idea: string;
  setting?: string;
  subjects?: unknown;
};
function answersOf(raw: unknown): Answer[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter(
      (a): a is Record<string, unknown> =>
        typeof a === "object" && a !== null && typeof (a as { id?: unknown }).id === "string",
    )
    .map((a) => ({
      id: a.id as string,
      device: typeof a.device === "string" ? a.device : "",
      illustrate: a.illustrate === true,
      idea: typeof a.idea === "string" ? a.idea : "",
      ...(typeof a.setting === "string" ? { setting: a.setting } : {}),
      ...(Array.isArray(a.subjects) ? { subjects: a.subjects } : {}),
    }));
}
/**
 * THE DECK-ORDER DEVICE PASS. Runs once, before any picture or scene is asked
 * for — scenes generate two at a time, so their devices cannot come from
 * finished scenes — and gives every bespoke beat one visual device, no two
 * alike, with one line on how its scene is composed. One Codex call names them
 * from the beats' content; whatever it does not name well (or at all, or
 * twice), and every beat when there is no call, takes the next unused name from
 * the rule catalogue. Illustration is decided here too: every beat with two
 * cues, data beats included (round 6), at most `artCap`.
 *
 * STICKY PER BEAT. A decided device is also cached under its beat's own content,
 * and a later run whose deck changed (one beat edited, a different call cap)
 * keeps every unchanged beat's device and idea — the call is told they are
 * decided — so the scenes cached under them still hit; only the changed beats
 * are named anew. Every beat decided already: no call at all.
 *
 * Round 5 adds a camera grammar and a data build to this same pass, in deck
 * order: keep it one function, one typed result. It never throws: no answer, a
 * broken cache file or a cache it cannot write all end in names.
 */
export async function assignDevices(
  beats: readonly DeviceBeat[],
  opts: DeviceOptions,
): Promise<DeviceAssignment> {
  const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex").slice(0, 32);
  const model = opts.model ?? "default";
  const key = hash({ v: DEVICE_VERSION, model, art: opts.artCap, beats });
  const dir = opts.cacheDir ? join(opts.cacheDir, "devices") : undefined;
  const beatFile = (b: DeviceBeat) =>
    dir ? join(dir, "beats", `${hash({ v: DEVICE_VERSION, model, beat: b })}.json`) : undefined;
  const read = async (file: string | undefined): Promise<unknown> => {
    if (!file) return undefined;
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      return undefined; // A miss, or a file another version wrote: ask again.
    }
  };
  let answers: Answer[] | undefined = answersOf(
    ((await read(dir ? join(dir, `${key}.json`) : undefined)) as { answers?: unknown })?.answers,
  );
  // A deck cached with a type or UI device in it is asked again for that beat
  // alone: the per-beat cache below keeps every other beat decided.
  if (answers?.some((a) => isUiDevice(deviceName(a.device)))) answers = undefined;
  let from: DeviceAssignment["from"] = answers ? "cache" : "rule";
  let note: string | undefined;

  // The beats decided by an earlier run, each under its own content.
  const decided = new Map<string, Answer>();
  if (!answers)
    for (const b of beats) {
      const hit = answersOf([await read(beatFile(b))])?.[0];
      const name = deviceName(hit?.device);
      if (hit && name && !isUiDevice(name)) decided.set(b.id, { ...hit, id: b.id });
    }
  if (!answers && beats.length && decided.size === beats.length) {
    answers = [...decided.values()];
    from = "cache";
  }
  if (!answers && opts.run && beats.length) {
    const refused = opts.take?.();
    if (refused) note = `no device call: ${refused}`;
    else {
      const schemaPath = join(opts.work, "devices.schema.json");
      const outPath = join(opts.work, "devices.json");
      const prompt = devicePrompt(beats, opts.artCap, decided);
      try {
        await writeFile(schemaPath, JSON.stringify(DEVICE_SCHEMA));
        await writeFile(join(opts.work, "devices.prompt.md"), prompt);
        await opts.run({
          prompt,
          schemaPath,
          outPath,
          timeoutMs: opts.timeoutMs,
          cwd: opts.work,
          ...(opts.config ? { config: opts.config } : {}),
          ...(opts.model ? { model: opts.model } : {}),
          ...(opts.bin ? { bin: opts.bin } : {}),
          ...(opts.onUsage ? { onUsage: opts.onUsage } : {}),
        });
        const reply = answersOf(
          (JSON.parse(await readFile(outPath, "utf8")) as { beats?: unknown }).beats,
        );
        if (!reply) throw new Error("the reply has no beats list");
        answers = reply;
        from = "codex";
      } catch (err) {
        note = `the device call failed (${err instanceof Error ? err.message.split("\n").slice(-1)[0]?.slice(0, 200) : err}); rule catalogue used${decided.size ? ` for the ${beats.length - decided.size} undecided beat(s)` : ""}`;
      }
    }
  }
  // What an earlier run decided wins over a new answer: its scenes are cached under it.
  if (decided.size) {
    const byNew = new Map((answers ?? []).map((a) => [a.id, a]));
    for (const [id, a] of decided) byNew.set(id, a);
    answers = [...byNew.values()];
  }

  const byId = new Map((answers ?? []).map((a) => [a.id, a]));
  const used = new Set<string>();
  const ruled: string[] = [];
  const nextRule = (archetype: string): string => {
    for (const d of [...(RULE_DEVICES[archetype] ?? []), ...POOL]) if (!used.has(d)) return d;
    let n = 2;
    while (used.has(`${POOL[0]}-${n}`)) n++;
    return `${POOL[0]}-${n}`;
  };
  // Decided beats claim their names first, so a new beat cannot take one.
  for (const id of decided.keys()) {
    const d = deviceName(decided.get(id)?.device);
    if (d) used.add(d);
  }
  let pictures = 0;
  const out: BeatDevice[] = [];
  // Round 5: the camera grammar and the data build ride in this same pass, in
  // deck order, each a pure choice given the ones before it.
  const grammars: Grammar[] = [];
  const builds: DataBuild[] = [];
  // Which beats ask for a picture: the model's choice where it gave one, else
  // every other eligible beat — and never fewer than `pictureFloor` of the
  // eligible ones. Round 6: every beat with two cues is pictured, data beats
  // included (their subjects ARE the quantities): the motion is the picture's own.
  const eligibleOf = (b: DeviceBeat) => b.cues >= 2;
  const wants = beats.map((b, i) => {
    const a = byId.get(b.id);
    return a ? a.illustrate === true : i % 2 === 0;
  });
  const eligibleIdx = beats.flatMap((b, i) => (eligibleOf(b) ? [i] : []));
  const floor = pictureFloor(eligibleIdx.length, opts.artCap);
  const chosen = eligibleIdx.filter((i) => wants[i]).length;
  let marked = chosen;
  const forced = new Set<number>();
  for (const step of [2, 1])
    for (let k = 0; k < eligibleIdx.length && marked < floor; k += step) {
      const i = eligibleIdx[k] as number;
      if (!wants[i]) {
        wants[i] = true;
        forced.add(i);
        marked++;
      }
    }
  const floorNote = forced.size
    ? `picture floor: ${[...forced].map((i) => beats[i]?.id).join(", ")} given a picture (${answers ? "the model" : "the rule"} marked ${chosen} of ${eligibleIdx.length} eligible beats; the floor is ${floor})`
    : undefined;
  for (const [bi, b] of beats.entries()) {
    const a = byId.get(b.id);
    let device = deviceName(a?.device);
    let origin: BeatDevice["from"] = "codex";
    if (!device || isUiDevice(device) || (used.has(device) && !decided.has(b.id))) {
      if (a)
        ruled.push(
          `${b.id}: ${!device ? "no usable name" : isUiDevice(device) ? `"${device}" is type or a UI element, not a picture` : `"${device}" repeated`}`,
        );
      device = nextRule(b.archetype);
      origin = "rule";
    }
    used.add(device);
    const illustrate = eligibleOf(b) && wants[bi] === true && pictures < opts.artCap;
    if (illustrate) pictures++;
    const role = roleOf(b);
    const grammar = illustrate ? chooseGrammar(role, grammars) : undefined;
    if (grammar) grammars.push(grammar);
    const build = b.data ? chooseBuild(b.archetype, builds) : undefined;
    if (build) builds.push(build);
    out.push({
      beatId: b.id,
      device,
      illustrate,
      ...(illustrate && forced.has(bi) ? { forced: true } : {}),
      role,
      ...(grammar ? { grammar } : {}),
      ...(build ? { build } : {}),
      ...(origin === "codex" && a?.idea ? { idea: a.idea.slice(0, 400) } : {}),
      // Round 5: the picture's plan, for an illustrated beat only.
      ...(illustrate && typeof a?.setting === "string" && a.setting.trim()
        ? { setting: a.setting.trim().slice(0, 120) }
        : {}),
      ...(illustrate && Array.isArray(a?.subjects)
        ? {
            subjects: (a.subjects as unknown[])
              .filter((x): x is string => typeof x === "string" && x.trim() !== "")
              .map((x) => x.trim().slice(0, 60))
              .slice(0, 4),
          }
        : {}),
      from: a ? origin : "rule",
    });
  }
  if (ruled.length)
    note = [note, `rule catalogue for ${ruled.join(", ")}`].filter(Boolean).join("; ");
  if (floorNote) note = [note, floorNote].filter(Boolean).join("; ");
  if (dir && from === "codex" && answers) {
    try {
      await mkdir(join(dir, "beats"), { recursive: true });
      await writeFile(
        join(dir, `${key}.json`),
        JSON.stringify({ version: DEVICE_VERSION, answers }),
      );
      // Per beat, only what the model named and the deck kept.
      for (const [i, b] of beats.entries()) {
        const d = out[i] as BeatDevice;
        const file = beatFile(b);
        if (d.from !== "codex" || !file) continue;
        const a = byId.get(b.id) as Answer;
        await writeFile(
          file,
          JSON.stringify({
            id: b.id,
            device: d.device,
            illustrate: a.illustrate,
            idea: a.idea,
            ...(a.setting ? { setting: a.setting } : {}),
            ...(a.subjects ? { subjects: a.subjects } : {}),
          }),
        );
      }
    } catch (err) {
      note = [
        note,
        `the device cache was not written (${err instanceof Error ? err.message : err})`,
      ]
        .filter(Boolean)
        .join("; ");
    }
  }
  return { beats: out, from, ...(note ? { note } : {}) };
}

/** A gate's measures with the candidate's motion kinds added. */
function withKinds(m: Measured | undefined, f: Fragment | undefined): Measured | undefined {
  if (!m) return undefined;
  return f ? { ...m, kinds: motionKinds(f.script) } : m;
}

/**
 * Two pictures of a deck closer than this by Vision's feature print are the
 * same picture drawn twice. CALIBRATED 2026-10-10 on round 4's 38 pictures:
 * pairs within a deck — all of them friendly robots, in other poses — sat at
 * 0.49-0.89 (cross-deck 0.53-0.90), so a print alone does not see a repeated
 * MOTIF; that is `sharedMotifs`' job. This bar catches the near-duplicate.
 */
export const SIMILAR_MAX = 0.45;

/** A subject's head noun: its last word, singular. */
function head(m: string): string {
  const w =
    m
      .toLowerCase()
      .replace(/[^a-z\s-]/g, " ")
      .trim()
      .split(/\s+/)
      .pop() ?? "";
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/** Generic nouns two different pictures may share without repeating each other. */
const GENERIC = new Set([
  "",
  "figure",
  "person",
  "object",
  "shape",
  "item",
  "thing",
  "group",
  "set",
  "pile",
  "stack",
  "row",
  "part",
  "piece",
  "block",
  "box",
  "card",
  "dot",
  "icon",
  "room",
  "table",
  "desk",
  "shelf",
  "floor",
  "wall",
  "background",
  "scene",
]);

/** The subject nouns `motifs` shares with any of `others`. */
export function sharedMotifs(
  motifs: readonly string[],
  others: ReadonlyArray<readonly string[]>,
): string[] {
  const mine = new Set(motifs.map(head).filter((h) => !GENERIC.has(h)));
  const out = new Set<string>();
  for (const o of others) for (const m of o) if (mine.has(head(m))) out.add(head(m));
  return [...out];
}

/** The stock subjects (`STOCK_MOTIFS`) a picture draws that its beat does not name. */
export function stockDrawn(
  drawn: { motifs: readonly string[]; depicts: string },
  allowed: readonly string[],
): string[] {
  const text = [...drawn.motifs, drawn.depicts].join(" ").toLowerCase();
  return STOCK_MOTIFS.filter((m) => !allowed.includes(m) && new RegExp(`\\b${m}`).test(text));
}

/** How much a deck's kept pictures repeat each other (`BespokeReport.repetition`). */
export function repetitionOf(arts: readonly ArtRef[]): BespokeReport["repetition"] {
  const ds: number[] = [];
  for (let i = 0; i < arts.length; i++)
    for (let j = i + 1; j < arts.length; j++) {
      const a = arts[i]?.print;
      const b = arts[j]?.print;
      if (a && b) ds.push(printDistance(a, b));
    }
  const shared = new Set<string>();
  arts.forEach((a, i) => {
    for (const m of sharedMotifs(
      a.motifs ?? [],
      arts.slice(i + 1).map((o) => o.motifs ?? []),
    ))
      shared.add(m);
  });
  return {
    ...(ds.length
      ? {
          minPrint: Math.min(...ds),
          meanPrint: Math.round((1000 * ds.reduce((x, y) => x + y, 0)) / ds.length) / 1000,
        }
      : {}),
    shared: [...shared],
  };
}

export async function bespokePass(input: BespokeInput): Promise<BespokeResult> {
  const { storyboard, source, format, narration, prefs } = input;
  const step = input.onStep ?? (() => {});
  const now = input.now ?? Date.now;
  const started = now();
  const budget = new Budget(
    prefs.maxCalls,
    started + prefs.maxSeconds * 1000,
    now,
    prefs.callSeconds ?? CALL_SECONDS,
  );
  const model = prefs.model ?? "default";
  const scenes: SceneReport[] = [];
  /** Each beat's kept illustration, by beat id: what the deck's repetition is measured on. */
  const artOf = new Map<string, ArtRef>();
  const report = (): BespokeReport => ({
    version: 1,
    model,
    promptVersion: PROMPT_VERSION,
    gates: GATE_STAMP,
    contractVersion: CONTRACT_VERSION,
    caps: { calls: prefs.maxCalls, seconds: prefs.maxSeconds },
    calls: budget.calls,
    tokens: budget.tokens,
    seconds: Math.round((now() - started) / 1000),
    quota: budget.quota,
    art: {
      cap: prefs.art,
      calls: budget.art,
      used: scenes.filter((sc) => sc.status === "bespoke" && sc.art).length,
      redraws: budget.redraws,
      rejectedText: budget.rejectedText,
      rejectedStyle: budget.rejectedStyle,
      rejectedSubjects: budget.rejectedSubjects,
      rejectedRepeat: budget.rejectedRepeat,
      plates: scenes.filter((sc) => sc.status === "bespoke" && sc.art?.plate).length,
    },
    repetition: repetitionOf(
      [...artOf]
        .filter(([id]) => scenes.some((sc) => sc.beat === id && sc.status === "bespoke"))
        .map(([, a]) => a),
    ),
    stages,
    ...(deviceReport
      ? {
          devices: {
            from: deviceReport.from,
            ...(deviceReport.note ? { note: deviceReport.note } : {}),
          },
        }
      : {}),
    scenes,
    skipped,
  });
  let deviceReport: DeviceAssignment | undefined;
  let skipped: Skip[] = [];
  // Wall seconds from the pass's start at which each stage ended (profiling).
  const stages: Record<string, number> = {};
  const mark = (stage: string) => {
    stages[stage] = Math.round((now() - started) / 100) / 10;
  };

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
  // Every beat that can have a scene, as many as the call cap pays two calls
  // for; the clock may still stop some, and those keep their archetype.
  const selection = selectBespoke(kept, {
    seed: storyboard.sourceId,
    narration: narration.beats,
    max: Math.floor(prefs.maxCalls / 2),
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
  const cacheDir = prefs.cache ?? defaultCacheDir();
  const cache = new SceneCache(cacheDir);
  const artCache = new ArtCache(join(cacheDir, "art"));
  const run = lanes(input.run ?? runCodex, prefs.concurrency, deadlineAdmit(budget.deadline, now));
  // Tool-less, single-turn calls (see TOOL_FEATURES), at the configured effort.
  // Only for the production runner: a test's runner never spawns anything.
  const effort = prefs.effort ?? "medium";
  const config = [
    ...(input.run ? [] : await leanCodexConfig(prefs.cli ?? "codex")),
    ...(effort === "default" ? [] : [`model_reasoning_effort="${effort}"`]),
  ];
  // The illustration call keeps one tool, the image tool (`artCodexConfig`).
  const artConfig = [
    ...(input.run ? [] : await artCodexConfig(prefs.cli ?? "codex")),
    `model_reasoning_effort="${ART_EFFORT}"`,
  ];
  const artCap = prefs.art;

  // THE DEVICE PASS, before any picture or scene is asked for (see `assignDevices`).
  const deviceBeats: DeviceBeat[] = [];
  for (const p of selection.picked) {
    const beat = kept.find((b) => b.id === p.beatId) as Beat;
    const params = beat.params as { headline: string };
    deviceBeats.push({
      id: beat.id,
      archetype: beat.archetype,
      headline: params.headline,
      intent: beat.intent,
      ...(beat.claim ? { claim: beat.claim } : {}),
      ...(beat.narration ? { narration: beat.narration } : {}),
      cues: windows.get(beat.id)?.cues.length ?? 0,
      data: isDataBeat(beat),
    });
  }
  const devices = await assignDevices(deviceBeats, {
    run,
    take: () => budget.takeDevice(),
    artCap,
    ...(prefs.model ? { model: prefs.model } : {}),
    ...(prefs.cli ? { bin: prefs.cli } : {}),
    config,
    work,
    timeoutMs: budget.seconds() * 1000,
    cacheDir,
    onUsage: (n) => {
      budget.tokens += n;
    },
  });
  mark("devices");
  deviceReport = devices;
  const deviceOf = new Map(devices.beats.map((d) => [d.beatId, d]));
  step(
    `bespoke: devices (${devices.from}) — ${devices.beats.map((d) => `${d.beatId} ${d.device}${d.illustrate ? "+art" : ""}`).join(", ")}${devices.note ? ` — ${devices.note}` : ""}`,
  );

  interface Beat1 {
    beat: Beat;
    brief: Brief;
    keyInput: KeyInput;
    key: string;
    holds: number[];
    window: SceneWindow;
    calls: number;
    device: BeatDevice;
    artBrief: ArtBrief;
    art?: ArtRef;
    /** Why the beat has no illustration, when one was wanted. */
    artNote?: string;
    cached?: Fragment;
    draft?: Fragment;
    draftFindings: string[];
    draftPassed?: boolean;
    fixed?: Fragment;
    /** Where `fixed` came from: the critique call, or the deterministic repair of the draft. */
    fixedFrom?: "critique" | "draft";
    fixedFindings: string[];
    /** The last gate verdict on `fixed`. */
    fixedGate?: GateResult;
    /** The measures (with the script's motion kinds) of the draft and of the fix. */
    draftMetrics?: Measured;
    draftWarnings: string[];
    critique: "ran" | "skipped" | "none";
    /** A second critique replaced the first one's failing scene (round 4). */
    second?: boolean;
    repair?: RepairNote & { rounds: number };
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
    const device = deviceOf.get(beat.id) as BeatDevice;
    // Round 6: an illustrated beat is a full-frame shot (src/bespoke/scene.ts).
    const region = device.illustrate ? cineRegion(format) : bespokeRegion(beat, { format, theme });
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
      ...(isDataBeat(beat) ? { data: true } : {}),
      device: device.device,
      ...(device.idea ? { idea: device.idea } : {}),
      ...(device.grammar ? { grammar: device.grammar } : {}),
      ...(device.build ? { build: device.build } : {}),
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
      device: device.device,
      ...(device.idea ? { idea: device.idea } : {}),
      ...(device.grammar ? { grammar: device.grammar } : {}),
      ...(device.build ? { build: device.build } : {}),
    };
    work1.push({
      beat,
      brief,
      keyInput,
      key: cacheKey(keyInput),
      holds,
      window: w,
      calls: 0,
      device,
      artBrief: {
        lang: storyboard.lang,
        headline: params.headline,
        intent: beat.intent,
        ...(beat.claim ? { claim: beat.claim } : {}),
        ...(beat.narration ? { narration: beat.narration } : {}),
        context: brief.context,
        theme,
        pack: input.theme,
        device: device.device,
        ...(isDataBeat(beat) ? { data: true } : {}),
        ...(device.setting ? { setting: device.setting } : {}),
        ...(device.subjects?.length ? { subjects: device.subjects } : {}),
      },
      draftFindings: [],
      fixedFindings: [],
      draftWarnings: [],
      critique: "none",
    });
  }

  const subjectsOf = (b: Beat1) => (b.art?.subjects ? artSubjects(b.art, b.brief.region) : []);
  const entry = (b: Beat1, fragment: Fragment) => ({
    fragment,
    holds: b.holds,
    ...(b.device.grammar && b.art?.subjects?.length ? { grammar: b.device.grammar } : {}),
    // A data beat with a picture (round 6) is staged on it, not built as a chart.
    ...(b.device.build && !b.art ? { build: b.device.build } : {}),
    ...(b.art ? { art: b.art } : {}),
    ...(b.art?.subjects?.length
      ? {
          stage: {
            cues: b.window.cues.map((c) => ({ t0: c.t0, t1: c.t1 })),
            duration: b.window.duration,
            ...(b.brief.grammar ? { grammar: b.brief.grammar } : {}),
          },
        }
      : {}),
  });
  const statics = (b: Beat1, f: Fragment) => {
    return checkFragment(f, {
      art: b.art !== undefined,
      subjects: subjectsOf(b).length,
      cues: b.window.cues.length,
    })
      .concat(b.device.build && !b.art ? checkBuild(f, b.device.build) : [])
      .map((x) => `${x.rule}: ${x.message}`);
  };
  const quota = (msg: string) => {
    if (QUOTA.test(msg)) budget.quota = true;
  };
  // The compiled text reader lives beside the cache root, not in one deck's cache:
  // it is compiled once per machine (~25s), not once per cache directory.
  const toolDir = join(defaultCacheDir(), "..", "tools");
  const ground = hexRgb(theme.bg);
  const inspect =
    input.inspect ??
    ((bytes: Buffer, file: string, g?: [number, number, number]) =>
      inspectPicture(bytes, file, toolDir, g));
  const copiesOf =
    input.copies ??
    ((
      png: Buffer,
      boxes: Inspection["subjects"],
      box: { width: number; height: number },
      o: { plate?: Buffer; ground?: string; cutout?: boolean },
    ) => pictureCopies(png, boxes, box, 0.84, o));
  const printsOf = input.prints ?? ((pngs: readonly string[]) => featurePrints(pngs, toolDir));
  const cutOf = input.cut ?? cutPicture;
  const frame = cineRegion(format);
  /**
   * ROUND 6: the kept picture cut into depth planes for the shell's camera
   * (src/bespoke/depth.ts) and stored beside it. A picture that cannot be cut
   * (no Chrome to draw the planes) is not used: round 6 shows pictures only
   * through their planes, and the beat is drawn without one.
   */
  const withDepth = async (b: Beat1, key: string, art: ArtRef): Promise<ArtRef | undefined> => {
    const same = art.depth?.frame.width === frame.width && art.depth?.frame.height === frame.height;
    if (art.depth && same) return art;
    const t0 = now();
    try {
      const png = await readFile(art.png ?? art.file);
      const plate = art.plate ? await readFile(art.plate.png) : undefined;
      const cut = await cutOf({
        subjects: png,
        ...(plate ? { plate } : {}),
        boxes: art.subjects ?? [],
        frame,
        work,
        tag: `${b.beat.id}.depth`,
        toolDir,
      });
      const ref = await artCache.putDepth(key, cut);
      const i = cut.info;
      step(
        `bespoke: ${b.beat.id} depth in ${Math.round((now() - t0) / 1000)}s — ${cut.planes.length} plane(s) at z ${cut.planes.map((p) => p.z).join("/")}, ${cut.subjects.length} subject plane(s), ${i.model}${i.reason ? ` (${i.reason})` : ""}, upscale ${i.upscale}x${i.upscaleReason ? ` (${i.upscaleReason})` : ""}`,
      );
      return ref;
    } catch (err) {
      b.artNote = `no illustration: its depth planes could not be cut (${err instanceof Error ? err.message.split("\n")[0]?.slice(0, 160) : err})`;
      step(`bespoke: ${b.beat.id} — ${b.artNote}`);
      return undefined;
    }
  };

  /**
   * What each beat's picture shows, claimed the moment a picture is accepted —
   * synchronously, before any await, so two pictures arriving together cannot
   * both pass as the first of their kind. The repetition check reads these.
   */
  const claims = new Map<
    string,
    { motifs?: string[]; depicts: string; setting?: string; print?: number[] }
  >();
  const claim = (b: Beat1, x: Drawing) =>
    claims.set(b.beat.id, {
      motifs: x.drawn.motifs,
      depicts: x.drawn.depicts,
      ...(x.drawn.setting ? { setting: x.drawn.setting } : {}),
      ...(x.print ? { print: x.print } : {}),
    });
  /** What the deck's other pictures show, for the illustrator to steer clear of. */
  const avoidFor = (b: Beat1) =>
    [...claims]
      .filter(([id]) => id !== b.beat.id)
      .map(([, a]) =>
        [a.motifs?.length ? a.motifs.join(", ") : a.depicts.slice(0, 90), a.setting]
          .filter(Boolean)
          .join(" in "),
      );

  /** One draw, inspected: the pictures, what they depict, and what the inspection says. */
  const drawInspected = async (b: Beat1, tag: string, retry?: string) => {
    const drawn = await drawArt(b.artBrief, {
      run,
      work,
      tag,
      model,
      timeoutMs: Math.min(ART_SECONDS, budget.seconds()) * 1000,
      config: artConfig,
      ...(prefs.cli ? { bin: prefs.cli } : {}),
      ...(input.codexHome ? { home: input.codexHome } : {}),
      ...(retry ? { retry } : {}),
      avoid: avoidFor(b),
      onUsage: (n) => {
        budget.tokens += n;
      },
    });
    const file = join(work, `${tag}.png`);
    await writeFile(file, drawn.bytes);
    const unread = (err: unknown): Inspection => ({
      subjects: [],
      flat: { soft: 1, palette: 0, score: 0, coverage: 0 },
      text: null,
      unread: `the picture could not be inspected: ${err instanceof Error ? err.message : err}`,
    });
    const seen = await inspect(drawn.bytes, file, ground).catch(unread);
    // The backdrop is read for writing too: it is on screen as much as the subjects.
    let plateText: string[] | null = [];
    if (drawn.plate) {
      const pf = join(work, `${tag}.plate.png`);
      await writeFile(pf, drawn.plate.bytes);
      plateText = (await inspect(drawn.plate.bytes, pf, ground).catch(unread)).text;
    }
    const print = await printsOf([seen.flatFile ?? file])
      .then((v) => v[0])
      .catch(() => undefined);
    return { drawn, seen, plateText, print };
  };
  type Drawing = Awaited<ReturnType<typeof drawInspected>>;

  /** Why a picture is refused, or undefined when it is kept. */
  const refusal = (b: Beat1, x: Drawing): string | undefined => {
    const { seen } = x;
    const text = [...(seen.text ?? []), ...(x.plateText ?? [])];
    if (text.length)
      return `it has writing in it (${text
        .slice(0, 3)
        .map((s) => `"${s.slice(0, 24)}"`)
        .join(", ")}) — draw NO text, letters or numbers anywhere, in either picture`;
    if (!flatEnough(seen.flat))
      return `it is shaded like a 3D render (flatness ${seen.flat.score} under ${FLAT_MIN}) — use only flat, uniform fills with hard edges, no gradients, no shading, no shadows`;
    // One blob cannot be staged: the camera and the labels need subjects to point at.
    if (seen.subjects.length < 2)
      return `its subjects touch or overlap (${seen.subjects.length} separate subject found) — draw three or four subjects with clear empty space between them, nothing linking them`;
    // REPETITION across the deck (round 5): a stock stand-in, a subject another
    // picture already shows, or a near-identical picture.
    const stock = stockDrawn(x.drawn, stockAllowed(b.artBrief));
    if (stock.length)
      return `it repeats the deck's stock stand-in (${stock.join(", ")}) — draw the paper's own subjects, no ${stock.join(" or ")}`;
    const others = [...claims].filter(([id]) => id !== b.beat.id).map(([, a]) => a);
    const shared = sharedMotifs(
      x.drawn.motifs,
      others.map((a) => a.motifs ?? []),
    );
    if (shared.length)
      return `it repeats a subject another scene of this deck already shows (${shared.join(", ")}) — draw different subjects`;
    const print = x.print;
    const twin = print
      ? others.find((a) => a.print && printDistance(a.print, print) < SIMILAR_MAX)
      : undefined;
    if (twin)
      return `it looks like another scene of this deck (${twin.depicts.slice(0, 80)}) — a different setting and different subjects`;
    return undefined;
  };
  const count = (why: string) => {
    if (why.startsWith("it has writing")) budget.rejectedText++;
    else if (why.startsWith("it is shaded")) budget.rejectedStyle++;
    else if (why.startsWith("its subjects")) budget.rejectedSubjects++;
    else budget.rejectedRepeat++;
  };
  /** Which of two refused pictures to keep: never one with writing; then flat; then not a repeat; then more subjects. */
  const rank = (b: Beat1, x: Drawing) =>
    (flatEnough(x.seen.flat) ? 10 : 0) +
    (/repeats|looks like/.test(refusal(b, x) ?? "") ? 0 : 5) +
    Math.min(4, x.seen.subjects.length) +
    x.seen.flat.score;

  /**
   * The beat's illustration: from the art cache, or a call to the account's
   * image tool, inspected (src/bespoke/inspect.ts) — writing in it, a shaded
   * render, one subject, or a picture repeating another of the deck is
   * redrawn ONCE with the reason; of two refused pictures the one without
   * writing, flat and not a repeat is kept, and one with writing never is.
   * A picture that cannot be had is not a failure — the beat is drawn without
   * one, and the report says why. A data beat is never illustrated.
   */
  const illustrate = async (b: Beat1) => {
    if (artCap <= 0) return;
    if (!b.device.illustrate) {
      b.artNote = "pure motion graphics (the device pass gave it no picture)";
      return;
    }
    if (!b.device.illustrate) {
      b.artNote = "pure motion graphics (the device pass gave it no picture)";
      return;
    }
    const key = artKey(b.artBrief, model);
    const cachedArt = await artCache.get(key);
    const hit = cachedArt ? await withDepth(b, key, cachedArt) : undefined;
    if (cachedArt && !hit) return;
    if (hit) {
      b.art = hit;
      artOf.set(b.beat.id, hit);
      claims.set(b.beat.id, {
        ...(hit.motifs ? { motifs: hit.motifs } : {}),
        depicts: hit.depicts,
        ...(hit.setting ? { setting: hit.setting } : {}),
        ...(hit.print ? { print: hit.print } : {}),
      });
      step(`bespoke: ${b.beat.id} illustration from cache`);
      return;
    }
    const refused = budget.takeArt(artCap);
    if (refused) {
      b.artNote = refused;
      return;
    }
    const tag = `${b.beat.id}.art`;
    const t0 = now();
    try {
      const tries = [await drawInspected(b, tag)];
      const rejected: string[] = [];
      let why = refusal(b, tries[0] as Drawing);
      if (why) {
        rejected.push(why);
        count(why);
        step(`bespoke: ${tag} refused — ${why.split(" — ")[0]}; drawing it again`);
        const again = budget.takeRedraw();
        if (again) step(`bespoke: ${tag} not redrawn — ${again}`);
        else {
          const second = await drawInspected(b, `${tag}2`, why);
          tries.push(second);
          why = refusal(b, second);
          if (why) {
            rejected.push(why);
            count(why);
          }
        }
      }
      // The kept picture: one that passed, else the best without writing (`rank`).
      const ok = tries.filter((t) => !t.seen.text?.length && !t.plateText?.length);
      const pick =
        tries.find((t) => refusal(b, t) === undefined) ??
        [...ok].sort((x, y) => rank(b, y) - rank(b, x))[0];
      if (!pick) {
        b.artNote = `no illustration: every draw had writing in it (${rejected.length} refused)`;
        step(`bespoke: ${tag} — ${b.artNote}`);
        return;
      }
      const { drawn, seen } = pick;
      claim(b, pick);
      const check: ArtCheck = {
        flat: seen.flat.score,
        flatOk: flatEnough(seen.flat),
        text: seen.text,
        attempts: tries.length,
        rejected,
      };
      // The deck's WebPs and the draft call's composite and boxed copies; a
      // Chrome that cannot draw them costs bytes (the PNGs ship) and the
      // numbered boxes, never the picture.
      const at = artPlacement(b.brief.region);
      const copies = await copiesOf(
        drawn.bytes,
        seen.subjects,
        { width: at.w, height: at.h },
        {
          ...(drawn.plate ? { plate: drawn.plate.bytes } : {}),
          ground: theme.bg,
          cutout: seen.cutout === true,
        },
      ).catch((err): ArtCopies => {
        step(`bespoke: ${tag} copies not drawn — ${err instanceof Error ? err.message : err}`);
        return {};
      });
      // A backdrop is used only where the subjects in front of it let it show:
      // drawn on a transparent ground, or keyed onto one in the deck's copy.
      const layered =
        drawn.plate !== undefined && (seen.cutout === true || copies.webp !== undefined);
      b.art = await artCache.put(
        key,
        drawn.bytes,
        {
          width: drawn.width,
          height: drawn.height,
          depicts: drawn.depicts,
          model,
          artVersion: ART_VERSION,
          subjects: seen.subjects,
          check,
          ...(seen.cutout || layered ? { cutout: true } : {}),
          ...(layered && drawn.plate
            ? { plate: { width: drawn.plate.width, height: drawn.plate.height } }
            : {}),
          ...(drawn.motifs.length ? { motifs: drawn.motifs } : {}),
          ...(drawn.setting ? { setting: drawn.setting } : {}),
          ...(pick.print ? { print: pick.print } : {}),
        },
        copies,
        layered ? drawn.plate?.bytes : undefined,
      );
      const deep = await withDepth(b, key, b.art);
      if (!deep) {
        b.art = undefined;
        return;
      }
      b.art = deep;
      artOf.set(b.beat.id, b.art);
      step(
        `bespoke: ${tag} in ${Math.round((now() - t0) / 1000)}s (${drawn.width}x${drawn.height}${layered ? ` over a ${drawn.plate?.width}x${drawn.plate?.height} backdrop` : ", no backdrop"}, ${seen.subjects.length} subjects [${drawn.motifs.join(", ")}], flat ${seen.flat.score}, text ${seen.text === null ? `unchecked: ${seen.unread}` : seen.text.length}, ${tries.length} draw(s))`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      quota(msg);
      b.artNote = `no illustration: ${msg.split("\n").slice(-2).join(" ").slice(0, 200)}`;
      step(`bespoke: ${tag} failed — ${b.artNote}`);
    }
  };

  /** Illustration first, then the scene cache under a key that names it. */
  const prepare = async (b: Beat1) => {
    await illustrate(b);
    if (b.art) {
      const subjects = subjectsOf(b);
      // A picture whose subjects merged into one cannot be followed, racked, cut
      // between or trucked across (MEASURED 2026-10-10: ko s3 fell back on "a follow
      // never tracks", zh r6b s8 on "a parallax truck travels 0%"): it is staged as
      // a zoom-out instead.
      const g = b.device.grammar;
      if (subjects.length < 2 && g && ONE_SUBJECT_UNSTAGEABLE.includes(g)) {
        b.device = { ...b.device, grammar: "zoom-out" };
        b.brief = { ...b.brief, grammar: "zoom-out" };
        b.keyInput = { ...b.keyInput, grammar: "zoom-out" };
        step(`bespoke: ${b.beat.id} has one subject; staged as a zoom-out, not a ${g}`);
      }
      b.brief = {
        ...b.brief,
        art: {
          depicts: b.art.depicts,
          width: b.art.width,
          height: b.art.height,
          ...(b.art.plate
            ? { plate: true, ...(b.art.setting ? { setting: b.art.setting } : {}) }
            : {}),
          ...(subjects.length ? { subjects } : {}),
          ...(b.art.depth ? { band: chromeBand(b.beat, { format, theme }) } : {}),
        },
      };
    }
    b.key = cacheKey({ ...b.keyInput, ...(b.art ? { art: b.art.key } : {}) });
    // A hit costs nothing, and a cached rejection is a free fallback.
    const hit = await cache.get(b.key);
    if (hit?.verdict === "accepted" && hit.fragment && statics(b, hit.fragment).length === 0) {
      b.cached = hit.fragment;
      step(`bespoke: ${b.beat.id} from cache`);
    } else if (hit?.verdict === "rejected" && hit.gates === GATE_STAMP) {
      b.stop = `cached rejection: ${hit.note}`;
      b.earned = true;
      step(`bespoke: ${b.beat.id} — cached rejection, keeping the archetype`);
    }
  };

  const call = async (
    b: Beat1,
    kind: "draft" | "critique" | "critique2",
    prompt: string,
    images: string[],
  ) => {
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
      return {
        markup: reply.markup ?? "",
        css: reply.css ?? "",
        script: reply.script ?? "",
        ...(b.art?.subjects?.length ? { shots: readShots(reply.shots) } : {}),
      } as Fragment;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      quota(msg);
      b.stop = `${kind} call failed: ${msg.split("\n").slice(-2).join(" ").slice(0, 240)}`;
      step(`bespoke: ${tag} failed — ${b.stop}`);
      return undefined;
    }
  };

  // Round 1. Every beat's picture starts at once (an art call is ~60s and
  // light), so no beat's draft waits for a lane to free up before its picture
  // is even asked for; the drafts then run at the concurrency cap, each as soon
  // as its own picture is in.
  const ready = new Map(work1.map((b) => [b, prepare(b)]));
  void Promise.all(ready.values()).then(() => mark("pictures"));
  await pool(work1, prefs.concurrency, async (b) => {
    await ready.get(b);
    if (b.cached || b.stop) return;
    const images = b.art
      ? [b.art.composite ?? b.art.png ?? b.art.file, ...(b.art.boxed ? [b.art.boxed] : [])]
      : [];
    const f = await call(b, "draft", generatePrompt(b.brief), images);
    if (!f) return;
    b.draft = f;
    b.draftFindings = statics(b, f);
  });
  mark("drafts");
  const fresh = work1.filter((b) => b.draft !== undefined);

  // Gate the drafts that passed the static walk. Nothing that failed it is opened in a browser.
  const draftMap: Record<string, BespokeEntry> = {};
  for (const b of work1) {
    if (b.cached) draftMap[b.beat.id] = entry(b, b.cached);
    else if (b.draft && b.draftFindings.length === 0) draftMap[b.beat.id] = entry(b, b.draft);
  }
  const regionOf = new Map(work1.map((b) => [b.beat.id, b.brief.region]));
  const dataBeats = new Set(work1.filter((b) => b.brief.data).map((b) => b.beat.id));
  const gate = async (m: BespokeMap, round: GateRound) => {
    if (Object.keys(m).length === 0) return new Map<string, GateResult>();
    try {
      const out = await input.gate(m, round);
      // `card_row` (src/bespoke/cards.ts): read off the markup, judged with the
      // browser's gates so a draft it flags still goes to its critique with frames.
      // Never on a data beat: its prompt asks for bars, and bars of close values
      // are alike rectangles in a row (a 0.82-0.94 chart was flagged and cached).
      for (const [id, e] of Object.entries(m)) {
        if (dataBeats.has(id)) continue;
        const region = regionOf.get(id);
        const why = region ? cardRow(e.fragment.markup, region, e.fragment.css) : undefined;
        if (!why) continue;
        const g = out.get(id) ?? { findings: [], failed: false };
        out.set(id, { ...g, findings: [...g.findings, `error card_row: ${why}`], failed: true });
      }
      return out;
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
  const gateA = fresh.length ? await gate(draftMap, "draft") : new Map<string, GateResult>();
  mark("draft gates");
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

  /** Repair `f` from gate verdict `g`; on success it becomes the beat's candidate. */
  const tryRepair = (
    b: Beat1,
    f: Fragment,
    g: GateResult | undefined,
    from: "critique" | "draft",
  ) => {
    if (!g) return false;
    const fixed = repairScene(f, g, {
      duration: b.window.duration,
      lastCueStart: b.window.cues[b.window.cues.length - 1]?.t0 ?? 0,
    });
    if (!fixed) return false;
    b.fixed = fixed.fragment;
    b.fixedFrom = from;
    b.fixedFindings = statics(b, fixed.fragment);
    b.fixedGate = undefined;
    b.repair = { ...fixed.note, rounds: (b.repair?.rounds ?? 0) + 1 };
    step(
      `bespoke: ${b.beat.id} — repaired ${fixed.note.rules.join(", ")} (${fixed.note.moved} label(s) moved, ${fixed.note.relit} relit${fixed.note.camera ? ", camera home" : ""}${fixed.note.untangled ? ", overlapping tweens untangled" : ""}${fixed.note.lifted ? `, ${fixed.note.lifted} dimmed word opacity(ies) lifted` : ""})`,
    );
    return true;
  };

  // Round 2: one critique-and-fix per drafted beat that needs one, frames
  // attached. A draft that passed every gate AND is clean by the rubric probe
  // is kept as it is: the call would cost minutes to restate a clean bill. A
  // draft whose only failures a deterministic repair can fix (label
  // collisions, a dimmed end, a camera left zoomed), and which is otherwise
  // clean by the rubric, is repaired instead of critiqued: no call at all.
  const drafted = work1.filter((b) => b.draft && !b.stop);
  for (const b of drafted) {
    const issues = rubricProbe(b.draftMetrics, b.draftWarnings, b.art !== undefined);
    if (b.draftPassed) {
      if (issues.length === 0) {
        b.critique = "skipped";
        step(
          `bespoke: ${b.beat.id} — every gate passed and the rubric probe is clean; no critique call`,
        );
      } else step(`bespoke: ${b.beat.id} — to critique: ${issues.slice(0, 3).join("; ")}`);
      continue;
    }
    // The repair relights the end, so the rubric's dimmed-end line is not a reason to critique.
    const rest = issues.filter((i) => !i.startsWith("the end frame is mostly dimmed"));
    if (rest.length === 0 && repairable(b.draftFindings)) {
      if (tryRepair(b, b.draft as Fragment, gateA.get(b.beat.id), "draft")) b.critique = "skipped";
    }
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
        [...(g?.sheet ? [g.sheet] : []), ...(b.art?.boxed ? [b.art.boxed] : [])],
      );
      if (!f) return;
      b.fixed = f;
      b.fixedFrom = "critique";
      b.fixedFindings = statics(b, f);
    },
  );

  const candidates = (pick: (b: Beat1) => boolean) => {
    const m: Record<string, BespokeEntry> = {};
    for (const b of work1) {
      if (!pick(b)) continue;
      if (b.cached) m[b.beat.id] = entry(b, b.cached);
      else if (b.fixed && b.fixedFindings.length === 0) m[b.beat.id] = entry(b, b.fixed);
    }
    return m;
  };
  mark("critiques");
  const gateB = await gate(
    candidates(() => true),
    "final",
  );
  mark("final gates");
  for (const b of work1) if (b.fixed && !b.cached) b.fixedGate = gateB.get(b.beat.id);

  // Round 3, only where needed: the deterministic repair of a candidate the
  // gates refused for collisions or its end state, re-gated. At most
  // `REPAIR_ROUNDS`, each a probe build of only the repaired scenes, and only
  // while the wall-time cap leaves room for one.
  const repairRounds = async (only?: ReadonlySet<string>) => {
    for (let round = 1; round <= REPAIR_ROUNDS; round++) {
      const todo = work1.filter((b) => {
        if (b.cached || (only && !only.has(b.beat.id))) return false;
        if (b.fixed && b.fixedFindings.length === 0) {
          const g = b.fixedGate;
          return g?.failed === true && repairable(g.findings);
        }
        // No fix to repair (the critique call never came back): repair the draft.
        return (
          !b.fixed &&
          b.draft !== undefined &&
          b.draftPassed === false &&
          repairable(b.draftFindings)
        );
      });
      if (todo.length === 0) break;
      if (budget.deadline - now() < 60_000) {
        step("bespoke: no repair round — the wall-time cap is too close");
        break;
      }
      const repaired = todo.filter((b) =>
        b.fixed
          ? tryRepair(b, b.fixed, b.fixedGate, b.fixedFrom ?? "critique")
          : tryRepair(b, b.draft as Fragment, gateA.get(b.beat.id), "draft"),
      );
      if (repaired.length === 0) break;
      const ids = new Set(repaired.map((b) => b.beat.id));
      const gateC = await gate(
        candidates((b) => ids.has(b.beat.id)),
        "repair",
      );
      for (const b of repaired) b.fixedGate = gateC.get(b.beat.id);
    }
  };
  await repairRounds();
  mark("repairs");

  // Round 4: a SECOND critique, for a beat that would otherwise fall back —
  // its critique's scene still fails and there is no passing draft to keep —
  // with the second scene's own frames and findings, then its gates and repairs.
  const passes = (b: Beat1) =>
    b.fixed !== undefined && b.fixedFindings.length === 0 && b.fixedGate?.failed === false;
  const again = work1.filter(
    (b) => !b.cached && !b.stop && b.critique === "ran" && b.fixed && !passes(b) && !b.draftPassed,
  );
  if (again.length && budget.deadline - now() < SECOND_SECONDS * 1000)
    step(
      `bespoke: no second critique for ${again.length} beat(s) — the wall-time cap is too close`,
    );
  else if (again.length) {
    await pool(again, prefs.concurrency, async (b) => {
      const g = b.fixedGate;
      const findings = b.fixedFindings.length ? b.fixedFindings : (g?.findings ?? []);
      const f = await call(
        b,
        "critique2",
        critiquePrompt(
          b.brief,
          b.fixed as Fragment,
          findings,
          g?.sheet ? g.legend : undefined,
          withKinds(g?.metrics, b.fixed),
        ),
        [...(g?.sheet ? [g.sheet] : []), ...(b.art?.boxed ? [b.art.boxed] : [])],
      );
      if (!f) {
        // No second scene: the first one's verdict stands, and so does its cacheability.
        b.stop = undefined;
        return;
      }
      b.fixed = f;
      b.fixedFrom = "critique";
      b.fixedFindings = statics(b, f);
      b.fixedGate = undefined;
      b.repair = undefined;
      b.second = true;
    });
    const ids = new Set(again.filter((b) => b.second).map((b) => b.beat.id));
    if (ids.size) {
      const gateD = await gate(
        candidates((b) => ids.has(b.beat.id)),
        "second",
      );
      for (const b of again) if (ids.has(b.beat.id)) b.fixedGate = gateD.get(b.beat.id);
      await repairRounds(ids);
    }
  }
  mark("second critiques");
  const map: Record<string, BespokeEntry> = {};
  for (const b of work1) {
    /** What the shell's camera does with this fragment: its moves, and the picture's sharpness at the closest one. */
    const shot = (f: Fragment): Partial<SceneReport> => {
      if (!b.art?.subjects?.length) return {};
      const e = entry(b, f);
      const st = staging(e, b.brief.region).staged;
      return {
        shots: shotSummary(st.moves, st.grammar, st.open),
        effective: effectiveAt(b.art, b.brief.region, closest(st)),
      };
    };
    const report1 = (status: "bespoke" | "fallback", extra: Partial<SceneReport>): SceneReport => ({
      beat: b.beat.id,
      archetype: b.beat.archetype,
      status,
      calls: b.calls,
      findings: [],
      key: b.key,
      critique: b.critique,
      ...(b.art
        ? {
            art: {
              key: b.art.key,
              depicts: b.art.depicts,
              subjects: subjectsOf(b).length,
              ...(b.art.check ? { check: b.art.check } : {}),
              ...(b.art.plate ? { plate: true } : {}),
              ...(b.art.setting ? { setting: b.art.setting } : {}),
              ...(b.art.motifs ? { motifs: b.art.motifs } : {}),
              ...(b.art.depth
                ? {
                    depth: {
                      planes: b.art.depth.planes.map((p) => p.z),
                      subjects: b.art.depth.subjects.map((p) => p.z),
                      scale: b.art.depth.scale,
                      info: b.art.depth.info,
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(b.brief.data ? { data: true } : {}),
      device: b.device.device,
      ...(b.second ? { second: true } : {}),
      ...(b.device.forced ? { pictureForced: true } : {}),
      role: b.device.role,
      ...(b.device.grammar && b.art?.subjects?.length ? { grammar: b.device.grammar } : {}),
      ...(b.device.build ? { build: b.device.build } : {}),
      ...(b.artNote ? { artNote: b.artNote } : {}),
      ...(b.repair ? { repair: b.repair } : {}),
      ...extra,
    });
    const gb = b.fixed ? b.fixedGate : gateB.get(b.beat.id);
    if (b.cached) {
      if (gb && !gb.failed) {
        map[b.beat.id] = entry(b, b.cached);
        const metrics = withKinds(gb.metrics, b.cached);
        scenes.push(
          report1("bespoke", {
            from: "cache",
            ...shot(b.cached),
            ...(gb.sid ? { gatedAt: gb.sid } : {}),
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
    let gatedAt: string | undefined;
    if (b.fixed && b.fixedFindings.length === 0 && gb && !gb.failed) {
      fragment = b.fixed;
      gatedAt = gb.sid;
      from = b.fixedFrom ?? "critique";
      metrics = withKinds(gb.metrics, b.fixed);
      if (b.second) note = "kept the second critique's scene";
      if (b.repair)
        note = `kept the ${b.second ? "second critique's" : from} scene after ${b.repair.rounds} repair round(s)`;
    } else if (b.draft && b.draftPassed) {
      // The fix round broke a draft that had passed: keep the draft.
      fragment = b.draft;
      from = "draft";
      metrics = b.draftMetrics;
      gatedAt = gateA.get(b.beat.id)?.sid;
      note = b.fixed
        ? `the critique round's scene failed (${(b.fixedFindings.length ? b.fixedFindings : (gb?.findings ?? [])).slice(0, 2).join("; ")}); kept the draft, which passed`
        : b.critique === "skipped"
          ? "every gate passed and the rubric probe was clean; kept the draft without a critique call"
          : `no critique round (${b.stop ?? "no reply"}); kept the draft, which passed`;
      // The repair was of the failing fix, not of what is kept.
      if (b.repair) b.repair = undefined;
    }
    if (fragment) {
      map[b.beat.id] = entry(b, fragment);
      await cache.put({
        version: 1,
        key: b.key,
        verdict: "accepted",
        fragment,
        note: note ?? `kept the ${from} scene`,
        calls: b.calls,
        model,
        promptVersion: PROMPT_VERSION,
        gates: GATE_STAMP,
        ...(b.art ? { art: b.art.key } : {}),
      });
      scenes.push(
        report1("bespoke", {
          from: from as "draft" | "critique",
          ...shot(fragment),
          ...(note ? { reason: note } : {}),
          kinds: motionKinds(fragment.script),
          ...(metrics ? { metrics } : {}),
          // Kept only because a repair cleared it: without one it fell back.
          ...(b.repair ? { savedByRepair: true } : {}),
          ...(gatedAt ? { gatedAt } : {}),
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
        : `failed the gates after the ${b.repair ? "repair" : b.second ? "second critique" : "critique"} round: ${findings.slice(0, 3).join("; ") || "no finding recorded"}`;
    if (earned && !b.stop?.startsWith("cached rejection")) {
      await cache.put({
        version: 1,
        key: b.key,
        verdict: "rejected",
        note: reason,
        calls: b.calls,
        model,
        promptVersion: PROMPT_VERSION,
        gates: GATE_STAMP,
      });
    }
    const last = b.fixed ? withKinds(gb?.metrics, b.fixed) : b.draftMetrics;
    scenes.push(report1("fallback", { reason, findings, ...(last ? { metrics: last } : {}) }));
  }

  if (!input.work) await rm(work, { recursive: true, force: true });
  const r = report();
  // Per beat, in deck order: what it got and, on a fallback, why.
  const order = new Map(kept.map((b, i) => [b.id, i]));
  for (const sc of [...scenes].sort((a, b) => (order.get(a.beat) ?? 0) - (order.get(b.beat) ?? 0)))
    step(
      `bespoke: ${sc.beat} (${sc.archetype}) ${sc.status === "bespoke" ? `bespoke from ${sc.from}` : "FALLBACK"} · device ${sc.device ?? "-"} · ${sc.art ? "illustrated" : "motion graphics"}${sc.status === "fallback" ? ` — ${(sc.reason ?? "").slice(0, 200)}` : ""}`,
    );
  const drawn = Object.keys(map).length;
  step(
    `bespoke: ${drawn} of ${kept.length} beats drawn bespoke (${Math.round((100 * drawn) / Math.max(1, kept.length))}%; ${scenes.length - drawn} fell back, ${skipped.length} not eligible), ${r.calls} scene call(s) + ${budget.devices} device call + ${r.art.calls} illustration(s), ${r.tokens} tokens, ${r.seconds}s${r.quota ? " — the quota said no" : ""}`,
  );
  return { map, report: r };
}
