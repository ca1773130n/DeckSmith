/**
 * T0 + T1 for a built deck: our determinism contract, then the HyperFrames gates.
 *
 * The determinism scan is here because nothing upstream runs it. `hyperframes
 * check` will happily pass a composition that calls `Math.random()` — it looks
 * fine in the one frame the inspector sampled, and then two renders of the same
 * deck differ byte for byte and every downstream diff becomes noise.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { DECK_PAGE } from "../emit/composition.js";
import { durationPlan } from "../plan/duration.js";
import type { Prefs } from "../prefs.js";
import { TIMING_FILE } from "../render/timing.js";
import { type Beat, DIAGRAMMATIC, type Finding, type Storyboard, type Verdict } from "../types.js";
import { scanBudget } from "./budget.js";
import { type CheckOptions, check } from "./check.js";
import { fidelity, readStops, type Stop } from "./fidelity.js";
import { scanTypeFloor } from "./typefloor.js";

/**
 * The duration budget reads the built composition, so it needs no argument the
 * `verify <dir>` entry point does not already have. Exported for the same reason
 * the other scans are: it is testable without a browser.
 */
export { type Canvas, profilesFor, readCanvas, scanBudget } from "./budget.js";

/**
 * The drift gate is deliberately not part of `verify()`. Everything above reads
 * one built artifact and costs seconds; drift renders the deck twice and costs
 * minutes, so folding it in would make every build pay for it. It is its own
 * entry point, called on demand.
 */
export {
  type DriftMode,
  type DriftOptions,
  type DriftReport,
  drift,
  FLOOR_DB,
  type Motion,
  type SceneWindow,
} from "./drift.js";
/**
 * The fidelity gate. Unlike `drift` it IS part of `verify()`: it costs one
 * browser and one screenshot per declared stop — 4.3s for the twelve-beat demo's
 * 37 stops against `check`'s ~60s — so folding it in is a 7% tax, and it is the
 * only gate here that can see a slide that draws nothing.
 */
export {
  type FidelityOptions,
  type FidelityReport,
  type Frame,
  fidelity,
  gradeFidelity,
  INK_FLOOR,
  inkBelow,
  type Measured,
  readStops,
  type Stop,
} from "./fidelity.js";
/**
 * The chart-collision rule, folded into `fidelity`'s report because it shares
 * that gate's browser. Exported here so the pure half is testable and so a
 * caller can see what the rule considers a collision.
 */
export {
  collectSvgTextRuns,
  gradeOverprint,
  MIN_OVERLAP,
  type Overprint,
  type Overprinted,
  overprints,
  type TextRun,
} from "./overprint.js";
/**
 * Invariant 5. Emit enforces the floor while laying a beat out, and this checks
 * that the artifact came out the way emit believed — the two are not the same
 * claim while any of that enforcement is a character count rather than a width.
 */
export { scanTypeFloor, TYPE_FLOOR_PX } from "./typefloor.js";

/**
 * Sources of per-render variance. Only render-time calls matter, so a CDN
 * `<script src>` is fine and `fetch()` is not — the former is fetched once by the
 * compiler, the latter resolves differently on every frame.
 */
const NONDETERMINISM: ReadonlyArray<[RegExp, string]> = [
  [/\bMath\.random\s*\(/, "math_random"],
  [/\bDate\.now\s*\(/, "date_now"],
  [/\bnew\s+Date\s*\(\s*\)/, "date_now"],
  [/\bperformance\.now\s*\(/, "performance_now"],
  [/\bfetch\s*\(/, "runtime_fetch"],
  [/\bXMLHttpRequest\b/, "runtime_fetch"],
];

/**
 * What `verify` runs on top of the HyperFrames gates.
 *
 * `fidelity` is opt-OUT rather than opt-in: it is the only gate that can see a
 * slide the audience gets nothing from, and a gate that has to be asked for is a
 * gate that is not on when it matters. The switch exists for the one honest
 * case — a machine with no browser, where it would only emit its own warning.
 */
export interface VerifyOptions extends CheckOptions {
  /** Default true. `false` skips the frame measurement entirely. */
  fidelity?: boolean;
}

/**
 * Run every gate DeckSmith owns over a built project directory.
 *
 * The storyboard is optional because `decksmith verify <dir>` is handed a built
 * directory and nothing else; pass it from `build`, where one is in hand, to get
 * the beat-level gates as well. `kept` — the cut `build` emitted — is optional
 * for the same reason, and for a second one: without it the budget gate falls
 * back to the flat threshold, which is the right list only while the budget has
 * cut nothing.
 */
export async function verify(
  dir: string,
  opts: VerifyOptions = {},
  storyboard?: Storyboard,
  kept?: readonly Beat[],
): Promise<Verdict> {
  const html = await readCompositions(dir);
  const determinism = html.flatMap(([file, text]) => scanDeterminism(text, file));
  const narration = scanNarration(
    await readFile(join(dir, DECK_PAGE), "utf8").catch(() => ""),
    await listFiles(dir),
  );
  const budget = html.flatMap(([, text]) => scanBudget(text, storyboard, kept));
  const type = html.flatMap(([file, text]) => scanTypeFloor(text, file));
  // Needs the manifest AND the beats it was built from, so it runs only where
  // both are in hand — `build`, not `verify <dir>`. Absent either, silence: a
  // check that cannot see its inputs must not report that it found nothing.
  const lead = kept ? await readTiming(dir).then((t) => (t ? scanNarrationLead(kept, t) : [])) : [];
  const ours = [...determinism, ...narration, ...budget, ...type, ...lead];
  // ONE READING OF THE STOPS, HANDED TO BOTH GATES.
  //
  // `fidelity` already worked this out for itself and `check` never knew the
  // deck had stops at all — which is why the layout gate was sampling nine
  // midpoints of a 92s deck and never once looking at a frame the audience
  // holds on. The two must agree about what a stop is, and the cheapest way to
  // guarantee that is for there to be one list.
  const stops = await declaredStops(dir);
  // Both boot a Chrome, and they boot different ones, so they overlap almost
  // perfectly rather than contending: `check` is a child process pinning ~40% of
  // one core (scripts/score.mjs measured that), this one is in-process.
  const [verdict, frames] = await Promise.all([
    check(dir, { ...opts, at: stops.map((s) => s.t) }),
    opts.fidelity === false ? null : fidelity(dir, { stops }),
  ]);
  const seen = [...ours, ...(frames?.findings ?? [])];
  return {
    passed: verdict.passed && seen.every((f) => f.severity !== "error"),
    findings: [
      ...seen,
      // `scanBeatCount` is deliberately NOT here. It needs the preferences the
      // deck was asked for, and `verify <dir>` is handed a built directory and
      // nothing else — the same gating `scanNarrationLead` gets above, and for
      // the same reason: a check that cannot see its inputs must not report that
      // it found nothing. It runs at `plan` and `build`, where prefs exist.
      ...(storyboard
        ? [
            ...scanDiagrammatic(storyboard),
            ...scanHeadlines(storyboard),
            ...scanRepeatedObject(storyboard),
          ]
        : []),
      ...verdict.findings,
    ],
  };
}

/**
 * The stops the built deck declares, read once for both browser gates.
 *
 * An empty list is ordinary and is handled by both callers without ceremony:
 * `check` falls back to the default midpoint grid, and `fidelity` says it did
 * not measure. A deck with no declared stops is a deck that never claims the
 * audience is looking at anything in particular, which is a fact about the deck
 * rather than a failure of the gate.
 */
async function declaredStops(dir: string): Promise<Stop[]> {
  return readStops(
    await readFile(join(dir, TIMING_FILE), "utf8").catch(() => null),
    await readFile(join(dir, DECK_PAGE), "utf8").catch(() => null),
  );
}

/** Only one island, and only in the presented page — so a regex is honest here. */
const NARRATION_ISLAND =
  /<script type="application\/decksmith-narration\+json">([\s\S]*?)<\/script>/;

/**
 * Every mp3 the narration island promises is actually in the deck.
 *
 * Nothing else notices this. `hyperframes check` never opens `deck.html`, and
 * the runtime treats a missing file exactly like a browser that refused to
 * autoplay — it clears the subtitles and moves on. So a deck that lost its audio
 * on the way to a web host presents in silence and says nothing about why, which
 * is the failure mode a gate exists for.
 */
export function scanNarration(page: string, files: ReadonlySet<string>): Finding[] {
  const island = NARRATION_ISLAND.exec(page)?.[1];
  if (!island) return [];
  let parsed: { dir?: unknown; scenes?: unknown };
  try {
    // The emitter escapes every `<` as \u003c, so the only literal `</script>`
    // in the page is the tag that closes the island. JSON.parse reads them back.
    parsed = JSON.parse(island) as { dir?: unknown; scenes?: unknown };
  } catch {
    return [
      {
        severity: "error",
        gate: "narration",
        rule: "island_unparseable",
        message: `${DECK_PAGE} carries a narration island that is not valid JSON, so the deck will present in silence.`,
      },
    ];
  }
  const dir = typeof parsed.dir === "string" && parsed.dir ? `${parsed.dir}/` : "";
  const scenes = (parsed.scenes ?? {}) as Record<string, Array<{ audio?: unknown }>>;

  const missing = new Set<string>();
  for (const segments of Object.values(scenes)) {
    for (const s of segments ?? []) {
      // A URL is somebody else's to serve; only the paths we shipped are ours.
      if (typeof s?.audio !== "string" || /^[a-z][a-z0-9+.-]*:|^\//i.test(s.audio)) continue;
      if (!files.has(`${dir}${s.audio}`)) missing.add(s.audio);
    }
  }
  if (missing.size === 0) return [];
  return [
    {
      severity: "error",
      gate: "narration",
      rule: "audio_missing",
      message: `${missing.size} narration file(s) named by ${DECK_PAGE} are not in the deck: ${[...missing].sort().slice(0, 5).join(", ")}. Re-run \`decksmith build\` with --narration.`,
    },
  ];
}

/**
 * The manifest `build` wrote, or `undefined` if there is not one.
 *
 * Absent is ORDINARY, not an error: an un-narrated deck has no timing.json, and
 * `build` deliberately writes none when the narration cannot be placed — that
 * failure is already reported where it happens, and reporting it twice from a
 * gate would say the deck is broken in two ways when it is broken in one.
 */
async function readTiming(
  dir: string,
): Promise<Parameters<typeof scanNarrationLead>[1] | undefined> {
  const raw = await readFile(join(dir, TIMING_FILE), "utf8").catch(() => "");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.scenes) && Array.isArray(parsed?.segments) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Deck-relative paths of everything that shipped, for the narration gate. */
async function listFiles(dir: string): Promise<Set<string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return new Set(
    entries
      .filter((e) => e.isFile())
      .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/")),
  );
}

/**
 * What a beat that draws nothing could have drawn instead. Naming the specific
 * alternative is the whole value of the finding: "be more visual" changes no
 * plan, "these three numbers share a unit, so they are bars" does.
 */
const INSTEAD: Record<string, string> = {
  title: "past the opening frame a divider draws nothing — cut it, or draw what it announces",
  "claim-figure": "annotated-figure — same figure, but pointing at where in it the claim lives",
  "data-table": "bar-compare, if the numbers share a unit",
  callout:
    "pipeline if it names steps, stack if it names layers, split-compare if it contrasts two things, grid if it is about regions of a field",
};

/**
 * Warn when a deck mostly talks. A deck of headlines and bullet panels is what
 * every other slide generator already makes, and passes every other gate here
 * with room to spare — nothing else in the pipeline notices it at all.
 *
 * A warning rather than an error: a genuinely shapeless source can honestly
 * yield such a deck, and this is a judgement about explanation, not a broken
 * build.
 */
export function scanDiagrammatic(storyboard: Storyboard): Finding[] {
  const flat = storyboard.beats.filter((b) => !DIAGRAMMATIC.has(b.archetype));
  const drawn = storyboard.beats.length - flat.length;
  if (drawn * 2 >= storyboard.beats.length) return [];

  const named = flat
    .map((b) => `${b.id} (${b.archetype}: ${INSTEAD[b.archetype] ?? "something that draws"})`)
    .join("; ");
  return [
    {
      severity: "warning",
      gate: "storyboard",
      rule: "text_heavy_deck",
      message: `Only ${drawn} of ${storyboard.beats.length} beats draw anything; the rest are text. Text-only beats, and what each might have drawn instead: ${named}.`,
    },
  ];
}

/**
 * Warn when a headline reads the visual's own labels back as a list.
 *
 * FOUND BY WATCHING A RENDER, not by a gate. "ThinkSR links encoding, windows,
 * thought ticks, and decoding" sat over a pipeline whose four stages are Encoder,
 * Windows, Shared DQ-CTM ticks and Decoder. Cover the four names and the sentence
 * asserts nothing the arrows had not already drawn — it is RULE 8's label with
 * commas where the Title Case used to be. It passes RULE 8 as written, because it
 * IS a complete sentence in sentence case with a verb in it.
 *
 * WHY THIS IS A DETECTOR AND NOT A PROMPT RULE. It was tried as a prompt rule
 * first — an example-led sharpening of RULE 8 carrying that exact bad headline and
 * its good twin — and a real Codex run answered "ThinkSR runs through encoder,
 * windows, ticks, and decoder". Same beat, same four labels, verb swapped. Whether
 * a sentence "asserts nothing" is a judgement the writer makes about their own
 * output, so it can always be met cosmetically. The label strings are not a
 * judgement, so a check on them has teeth the instruction did not.
 *
 * TWO CONDITIONS, and it needs both. Naming your own parts is not the defect —
 * "A dense carrier is read and updated by compact thought" names all three of its
 * stages and is the good headline on the same archetype, because the names sit in
 * different grammatical positions with a relation asserted between them. And
 * coordination is not the defect either: "One pass in, one pass out, and a loop in
 * the middle" is three coordinated fragments and the sharpest line in the shipped
 * demo, because it names no stage at all — it says what the shape DOES. The defect
 * is the two together, which is why this counts labels landing in SEPARATE
 * coordinated fragments rather than counting either alone.
 *
 * A warning, never an error. Incidence is about one beat in twelve, the judgement
 * is editorial, and `plan` already tells the author to read the storyboard before
 * building — which is the moment this is for.
 */
export function scanHeadlines(storyboard: Storyboard): Finding[] {
  const findings: Finding[] = [];
  for (const beat of storyboard.beats) {
    const headline = (beat.params as { headline?: unknown }).headline;
    if (typeof headline !== "string" || !headline) continue;

    const labels = partLabels(beat.params);
    if (labels.length < 3) continue; // fewer than three parts cannot make a list

    // Coordination is the comma-and-conjunction structure, so split on exactly
    // that. A label counts once, for the first fragment it lands in: "updated by
    // compact thought" matches both `Compact thought` and `Updated carrier`, and
    // letting one fragment score twice would turn the good headline into a hit.
    const fragments = headline.split(/,|\band\b|\bor\b/i).filter((f) => f.trim());
    if (fragments.length < 3) continue;

    const hit = new Set<string>();
    const spent = new Set<number>();
    for (const label of labels) {
      const at = fragments.findIndex((f, i) => !spent.has(i) && mentions(f, label));
      if (at >= 0) {
        spent.add(at);
        hit.add(label);
      }
    }
    if (hit.size < 3) continue;

    findings.push({
      severity: "warning",
      gate: "storyboard",
      rule: "headline_recites_labels",
      message: `${beat.id}: the headline "${headline}" lists ${hit.size} of this beat's own labels (${[...hit].join(", ")}) in separate clauses. Cover them and check what the sentence still asserts; if the answer is nothing the visual did not already draw, it is a label with commas in it (RULE 8).`,
    });
  }
  return findings;
}

/**
 * Warn when two beats draw the SAME PICTURE from the same object (RULE 9).
 *
 * FOUND IN A REAL PLAN, not by a gate. `b10-params` and `b11-average` both cite
 * `tbl-bench` and both emit a bar-compare over the same five methods — one
 * picture, drawn twice, with a different number on the bars. RULE 9 already
 * forbids it in prose ("One object, one beat... Repeating a visual to say one
 * more small thing is padding, and reads as padding") and the planner did it
 * anyway, which is the same shape of failure `scanHeadlines` documents: a rule
 * about whether something is padding is a judgement the writer makes about their
 * own output, so it can always be met cosmetically.
 *
 * THREE CONDITIONS, and it needs all of them, because the loose version condemns
 * the shipped demo. Measured over the 134 plans in `experiments/` and `demo/`:
 *
 *   same evidence id alone                  fires on 10 plans, INCLUDING demo/storyboard.json
 *   + same archetype + identical labels     fires on 4, demo clear, every hit the same five bars
 *
 * What the two extra conditions buy is the difference between padding and
 * progressive disclosure. `demo/storyboard.json` cites `tbl-bench` from a
 * bar-compare and then a data-table — the shape, then the numbers — and that is a
 * deck teaching, not repeating. So is a pipeline followed by the paper's own
 * annotated figure. Two bar-compares over the identical five bars is neither;
 * there is no reading of it in which the second picture shows something the first
 * did not. A0-05 draws three bar-compares off one table with DIFFERENT bars in
 * each and is deliberately left alone — different bars are a different picture,
 * and whether three of them is too many is editorial.
 *
 * A camera dive is exempt: `inside` says this beat is what happens within a part
 * of the one before it, so sharing the object is the entire point of the relation
 * (RULE 11) rather than a repeat of it.
 *
 * A warning, never an error — same reason as `scanHeadlines`. Merging two beats
 * into two holds of one beat is a rewrite only the author can perform.
 */
export function scanRepeatedObject(storyboard: Storyboard): Finding[] {
  const byObject = new Map<string, Beat[]>();
  for (const beat of storyboard.beats) {
    for (const ref of beat.evidence ?? []) {
      // A section is a place in the source, not a picture; two beats reading the
      // same section is ordinary, and RULE 9 names only tables, equations and
      // figures.
      if (ref.kind === "section") continue;
      const seen = byObject.get(ref.id) ?? [];
      if (!seen.includes(beat)) seen.push(beat);
      byObject.set(ref.id, seen);
    }
  }

  const findings: Finding[] = [];
  for (const [id, beats] of byObject) {
    for (let i = 0; i < beats.length; i++) {
      for (let j = i + 1; j < beats.length; j++) {
        const a = beats[i] as Beat;
        const b = beats[j] as Beat;
        if (a.archetype !== b.archetype) continue;
        if (b.inside?.beat === a.id) continue;
        const left = partLabels(a.params as Record<string, unknown>).map((s) => s.toLowerCase());
        const right = partLabels(b.params as Record<string, unknown>).map((s) => s.toLowerCase());
        // No labels at all means nothing was compared, so nothing is proven the
        // same. Silence beats a finding built on two empty lists.
        if (!left.length || left.length !== right.length) continue;
        if (left.join("|") !== right.join("|")) continue;
        findings.push({
          severity: "warning",
          gate: "storyboard",
          rule: "object_drawn_twice",
          message: `${a.id} and ${b.id} both cite "${id}" and both draw a ${a.archetype} over the same parts (${left.join(", ")}). That is one picture twice; make them two holds inside one beat (RULE 9), or give the second one something else to draw.`,
        });
      }
    }
  }
  return findings;
}

/**
 * Warn when the plan came back with fewer beats than were asked for.
 *
 * `--slides` IS A FLOOR, and this is the half of that with teeth. The other half
 * is the prompt's LENGTH block, which now says so in words — and words are not
 * enough here for the reason `scanHeadlines` records two functions up: a real
 * Codex run answered a sharpened RULE 8 by swapping one verb. Four of the last
 * five plans came back short of their target (8, 9, 9 and 10 against 12) against
 * a prompt that already asked for the number. Whether a source "genuinely will
 * not carry twelve points" is a judgement the writer makes about their own
 * output, so it can always be met cosmetically. A COUNT is not a judgement.
 *
 * REPORTED, NEVER REPAIRED, which is the same shape as `cut.dangling`. The two
 * repairs available are both worse than the shortfall: truncating to what came
 * back throws away slides the author asked for, and padding to reach the number
 * is exactly what RULE 9 forbids — "a visual repeated to say one more small
 * thing" costs more than being short does. Re-asking the planner is a fresh
 * Codex round-trip on a single-shot planner with no retry machinery, spent on a
 * rule it has already been given. So the deck is built at the count it has —
 * `durationPlan` restrikes the whole budget there, which is what stops the
 * shortfall becoming a video that quietly misses its duration — and the author
 * is told what it cost, at `plan`, before a minute of TTS is spent on it.
 *
 * NAMING THE NUMBERS IS THE WHOLE VALUE, same argument as `INSTEAD` above: "the
 * plan is short" changes nothing, "each surviving slide now runs 7.5s instead of
 * 5.0s and has to carry 102 characters where the prompt budgeted 66" is a fact
 * the author can act on — by adding the missing beat, or by accepting the deck
 * they have.
 *
 * A warning, never an error. A source that honestly carries eight points is a
 * real thing, and only the author can tell that from a planner that stopped
 * early.
 */
export function scanBeatCount(storyboard: Storyboard, prefs: Prefs): Finding[] {
  const got = storyboard.beats.length;
  if (got >= prefs.slides) return [];

  // Both budgets, so the message can price the shortfall rather than announce
  // it. `asked` is the one the planner was WRITTEN to — it is what `systemPrompt`
  // put in front of the model — and `has` is the one the deck is BUILT at.
  const asked = durationPlan(prefs);
  const has = durationPlan(prefs, got);
  const cost =
    prefs.duration === undefined
      ? `Each missing beat is a point the deck never makes.`
      : `The ${prefs.duration}s is not lost, it is redistributed: each surviving slide runs ${has.beatSeconds}s instead of ${asked.beatSeconds}s and has to carry ${has.chars} characters where the prompt budgeted ${asked.chars}. So what is short is the number of points, not the video.`;

  return [
    {
      severity: "warning",
      gate: "storyboard",
      rule: "beats_under_target",
      message: `${prefs.slides} beats were asked for and the plan returned ${got}. ${cost} Split a point that has two halves and write the missing beat by hand, or re-plan — padding to reach the number costs more than being short does (RULE 9). The deck is being built for ${got} beats, not ${prefs.slides}.`,
    },
  ];
}

/**
 * How far a name may precede the thing it names before a viewer notices.
 *
 * A second, which is generous on purpose. The word position inside a cue is
 * estimated proportionally by character offset — the same model `splitCue`
 * already uses — so it carries a few hundred milliseconds of error, and a
 * threshold tighter than that would be reporting its own arithmetic.
 */
export const LEAD_SECONDS = 1;

/**
 * Archetypes whose parts are EMPHASISED rather than introduced.
 *
 * `equation-walk` draws the whole equation at 0.8s — `#sid-eq`, one fade — and
 * its `terms` are then `color` and `scale` tweens on symbols that have been on
 * screen the entire time. Naming one before its hold is naming something the
 * viewer is already looking at, so the finding is about emphasis arriving late
 * rather than a picture missing a part, and it fired on two of two real plans for
 * exactly that reason.
 *
 * Same precedent, same reasoning as `partLabels`' deliberate exclusion of
 * `highlight[].row`: a data-table's rows are drawn with the table.
 *
 * The exclusion lives HERE and not in `partLabels`, because `scanHeadlines` wants
 * the opposite answer — a headline reciting an equation's term labels is RULE 8's
 * defect whether or not the symbols are already visible.
 */
const EMPHASISED = new Set(["equation-walk", "data-table"]);

/**
 * Warn when the narration names a part before that part is on screen.
 *
 * `scanHeadlines` one level down, and the reason it did not exist until now is
 * worth keeping: THE DEFECT WAS NOT REACHABLE. Measured across all 136 plans in
 * `experiments/` and `demo/` — 1103 named parts over 337 containers, every word
 * placed on the scene clock at the speed a 60-second target derives — the lead
 * came out at median −6.87s, p90 −2.47s, maximum +0.87s, and **zero** parts were
 * named more than a second early. Transplanting §9's own defect sentence onto a
 * real pipeline produced zero early names too. The build ran roughly four times
 * faster than the voice, so the narration simply could not outrun the picture.
 *
 * `fillFactor` is what makes it reachable. Slowing each scene's build to fill its
 * sentence takes that same measurement from 0 of 1103 to 222 of 1103 — the words
 * stay put and the pictures they describe move later. So this ships in the same
 * change as the stretch, not after it: the detector is not a smoke alarm for a
 * fire already burning, it is the one fitted before the gas is turned on.
 *
 * CONSERVATIVE BY CONSTRUCTION, in three ways, because a warning that cries wolf
 * is a warning people learn to scroll past:
 *   - a part is assumed to appear at the EARLIEST hold that could be its own,
 *     `holds[min(j, last)]`. Where an archetype spends its first hold on a
 *     landing rather than a part, the real appearance is later than this and the
 *     finding is missed rather than invented.
 *   - only labels the narration actually names are considered, by the same
 *     five-character prefix match `scanHeadlines` uses — tuned on exactly this
 *     problem, where the headline said "encoding" and the stage was `Encoder`.
 *   - the word's time inside its cue is estimated proportionally, and the
 *     threshold is a whole second.
 *
 * A warning, never an error. Which sentence describes which reveal is editorial,
 * and `place` already guarantees the containment that matters — no sentence ends
 * before the reveal it speaks over appears (`assertFits`).
 */
export function scanNarrationLead(
  beats: readonly Beat[],
  timing: {
    scenes: readonly { id: string; start: number; holds: readonly number[] }[];
    segments: readonly {
      scene: string;
      start: number;
      cues: readonly { start: number; end: number; text: string }[];
    }[];
  },
): Finding[] {
  const findings: Finding[] = [];
  for (const [i, scene] of timing.scenes.entries()) {
    const beat = beats[i];
    if (!beat || scene.holds.length === 0) continue;
    if (EMPHASISED.has(beat.archetype)) continue;
    const labels = partLabels(beat.params as Record<string, unknown>);
    if (labels.length === 0) continue;
    const mine = timing.segments.filter((s) => s.scene === scene.id);
    if (mine.length === 0) continue;

    const early: string[] = [];
    for (const [j, label] of labels.entries()) {
      const appears = scene.start + (scene.holds[Math.min(j, scene.holds.length - 1)] as number);
      const said = firstMention(mine, label);
      if (said !== undefined && said + LEAD_SECONDS < appears) {
        early.push(`"${label}" at ${said.toFixed(1)}s, drawn at ${appears.toFixed(1)}s`);
      }
    }
    if (early.length > 0) {
      findings.push({
        severity: "warning",
        gate: "narration",
        rule: "name_before_reveal",
        message: `${beat.id}: the narration names ${early.length} part(s) more than ${LEAD_SECONDS}s before they are drawn — ${early.join("; ")}. The viewer hears the word over a picture that does not have it yet. Reorder the sentence, or let the beat build faster.`,
      });
    }
  }
  return findings;
}

/** When a label is first spoken, in absolute seconds, or `undefined`. */
function firstMention(
  segments: readonly {
    start: number;
    cues: readonly { start: number; end: number; text: string }[];
  }[],
  label: string,
): number | undefined {
  for (const segment of segments) {
    for (const cue of segment.cues) {
      const words = cue.text.split(/\s+/);
      let at = 0;
      for (const word of words) {
        if (mentions(word, label)) {
          // Proportional within the cue, which is the model `splitCue` uses to
          // decide where a cue breaks in the first place.
          const share = cue.text.length > 0 ? at / cue.text.length : 0;
          return segment.start + cue.start + share * (cue.end - cue.start);
        }
        at += word.length + 1;
      }
    }
  }
  return undefined;
}

/**
 * The text of every part an archetype reveals one at a time.
 *
 * `left`/`right` are split-compare's two sides, which are the same thing under
 * different keys. `highlight[].row` is deliberately absent: a data-table's
 * highlighted rows are the source's own row names, so a headline quoting them is
 * citing the table rather than reciting a label the emitter drew.
 */
function partLabels(params: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["stages", "layers", "panels", "regions", "bars", "terms", "notes"]) {
    const list = params[key];
    if (!Array.isArray(list)) continue;
    for (const part of list) {
      const text =
        (part as { label?: unknown; text?: unknown }).label ?? (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) out.push(text.trim());
    }
  }
  for (const key of ["left", "right"]) {
    const side = params[key] as { label?: unknown } | undefined;
    if (side && typeof side.label === "string" && side.label.trim()) out.push(side.label.trim());
  }
  return out;
}

/**
 * Does this fragment name that part?
 *
 * Prefix matching on five characters, because the planner inflects: the headline
 * said "encoding" and "decoding" where the stages are `Encoder` and `Decoder`, and
 * a substring test scored 1 of 4 on the very headline this exists to catch. Five
 * is long enough that "the" and "with" cannot collide and short enough to hold
 * "windo|ws" against "windo|wing".
 */
function mentions(fragment: string, label: string): boolean {
  const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const have = words(fragment);
  const want = words(label).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!want.length) return false;
  return want.some((w) =>
    have.some(
      (h) =>
        (h.length >= 5 && w.startsWith(h.slice(0, 5))) ||
        (w.length >= 5 && h.startsWith(w.slice(0, 5))) ||
        h === w,
    ),
  );
}

/** Words that would match everything. `shared` is here for `Shared DQ-CTM ticks`. */
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "per",
  "one",
  "its",
  "shared",
  "same",
]);

/** Flag render-time nondeterminism in one composition file (invariant 7). */
export function scanDeterminism(html: string, file: string): Finding[] {
  const findings: Finding[] = [];
  const lines = html.split("\n");
  for (const [pattern, rule] of NONDETERMINISM) {
    const i = lines.findIndex((line) => pattern.test(line));
    if (i < 0) continue;
    findings.push({
      severity: "error",
      gate: "determinism",
      rule,
      message: `${file}:${i + 1} calls \`${lines[i]?.match(pattern)?.[0]}\` at render time, so two renders of this deck will not be identical.`,
    });
  }
  return findings;
}

async function readCompositions(dir: string): Promise<Array<[string, string]>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  const files = entries
    // The wrapper is a presented page, not a rendered one: it hosts the
    // composition and runs our step layer, whose rAF loop legitimately reads a
    // clock. Scanning it for render-time determinism fails the build for code
    // that is never rendered.
    .filter(
      (e) =>
        e.isFile() &&
        e.name.endsWith(".html") &&
        e.name !== DECK_PAGE &&
        !e.parentPath.includes("node_modules"),
    )
    .map((e) => join(e.parentPath, e.name));
  return Promise.all(
    files.map(async (f) => [relative(dir, f), await readFile(f, "utf8")] as [string, string]),
  );
}
