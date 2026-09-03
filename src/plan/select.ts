/**
 * Which beats survive a budget, and why each one that did not was cut.
 *
 * A format profile caps a length (src/types.ts, `DESTINATIONS`). When the
 * narrated cut runs over, something has to go, and until now the only tool was
 * `--min-weight`: a flat threshold on the author's salience number. A threshold
 * is the wrong instrument, for three separate reasons, each of which the demo
 * exhibits at 9:16.
 *
 * 1. IT IGNORES LENGTH. Weight says how much a beat matters; it says nothing
 *    about what it costs. At `--min-weight 0.85` the demo drops b08 (14.3s,
 *    weight 0.80) while keeping b02 (39.1s, weight 0.95) whole. Two 14-second
 *    beats at 0.80 are worth more than one 39-second beat at 0.95 to anybody
 *    who is trying to fit three minutes, and a threshold cannot express that.
 * 2. IT IGNORES WHAT KIND OF BEAT IT IS. A deck is an argument. Weight is a
 *    per-beat number and has no view on the SHAPE of what is left, so a
 *    threshold will happily cut every chart and keep every claim — the exact
 *    failure mode of dropping the evidence and keeping the assertions.
 * 3. IT IGNORES THE ENDS. `--min-weight 0.85` drops b12, the caveat the deck
 *    closes on, because the author scored the caveat lowest. A cut is a cut of
 *    the MIDDLE: an explanation that stops in the middle of its evidence has no
 *    ending, whatever the weights say.
 *
 * WHAT "BETTER" MEANS HERE, in priority order. A cut is better than another when
 * it is coherent (this function never breaks an `inside` pair the author's own
 * floor left intact), then when it keeps the
 * ends and one beat of every archetype family the full deck used, then when it
 * fits, and only then when it carries more author weight. Weight is the last
 * tiebreak, not the objective — that inversion is the whole change.
 *
 * WHY NOT A PURE KNAPSACK ON WEIGHT. Because it is not neutral either: value
 * per second systematically deletes the LONGEST beats, and a beat is long
 * because its narration needed the words. Run unprotected on the demo it drops
 * b02 (the method) and b03 (the comparison figure) — the two most-explained
 * beats in the deck — for a higher weight total than the cut here. The
 * protections below exist to say what the knapsack cannot see.
 *
 * SHORTENING WOULD BE BETTER THAN DROPPING, and it is not available here. A
 * beat's length is measured speech (src/narrate), so the only way to shorten one
 * is to write a shorter sentence, which is a planner decision made before any
 * audio exists — `plan` would have to take a seconds budget and target
 * words-per-beat, and the deck would keep all twelve beats at 15s each rather
 * than nine at 20s. That is the better product and a different workstream; this
 * function is what you need once the audio is already recorded, and what `verify`
 * needs to explain an overrun it can only measure after the fact.
 *
 * PURE. No I/O, no clock, no randomness; integer arithmetic inside the optimiser
 * so the same storyboard and budget always produce byte-identical output.
 */
import {
  ARCHETYPE_FAMILY,
  type ArchetypeFamily,
  type Beat,
  type Ref,
  type Storyboard,
} from "../types.js";

/** What a caller must know about the target to make a cut. `Format` satisfies it. */
export interface SelectionBudget {
  /** The author's floor. Beats below it never enter, as `--min-weight` does today. */
  minWeight: number;
  /** The hard ceiling in seconds. Absent or `Infinity` means nothing is cut. */
  maxSeconds?: number;
  /** Named in explanations, so a cut says which profile asked for it. */
  id?: string;
}

/**
 * Why a beat is not in the cut. Machine-readable; `reason` is the prose.
 *
 * There is deliberately no `orphaned`. A beat whose `inside` container was cut
 * is KEPT and reported through `Cut.dangling` — see `dangling` for why deleting
 * it was both unnecessary and destructive.
 */
export type DropRule = "below_min_weight" | "over_budget";

export interface Dropped {
  beat: Beat;
  /** The length this beat would have contributed. */
  seconds: number;
  rule: DropRule;
  /** One sentence naming the cause, with the numbers behind it. */
  reason: string;
}

/**
 * A kept beat that cites something no kept beat shows.
 *
 * Not a drop — the beat still stands on its own drawing — but the reference in
 * it has gone dangling, and that is exactly the "as the comparison figure
 * showed" failure the caller has to be able to see. The demo has a live one:
 * b08 bar-compare cites `tbl-bench`, which only b09 data-table displays.
 *
 * `{ kind: "beat" }` is the same failure one level up: the beat happens INSIDE a
 * beat this cut does not keep, so it opens on a hard cut where the author wrote
 * a dive. See `dangling` for why that is a note and not a removal.
 */
export interface Dangling {
  beat: Beat;
  ref: Ref | { kind: "beat"; id: string };
  reason: string;
}

export interface Cut {
  /** In storyboard order. */
  kept: Beat[];
  /** In storyboard order. */
  dropped: Dropped[];
  /** Sum of the kept beats' seconds, rounded to 3dp like every other time here. */
  seconds: number;
  /** References inside `kept` whose subject is not in `kept`. */
  dangling: Dangling[];
  /** False when even the protected core does not fit — nothing here can save it. */
  fits: boolean;
}

/**
 * The cut for one budget.
 *
 * `seconds` maps a beat id to its NARRATED length — what `beatSeconds` in
 * src/emit/composition.ts produces, or what a built composition's scene windows
 * report. Beats absent from the map fall back to their authored `beat.seconds`,
 * which is what an un-narrated storyboard has and all it has.
 */
export function selectBeats(
  storyboard: Storyboard,
  budget: SelectionBudget,
  seconds: Readonly<Record<string, number>> = {},
): Cut {
  const len = (b: Beat) => seconds[b.id] ?? b.seconds;
  const dropped: Dropped[] = [];
  const where = budget.id ? `${budget.id}'s` : "the";

  // 1. The author's floor, first and on its own. It is a statement about the
  //    beats, not about the budget, so it applies whether or not anything is
  //    over — and a beat cut here is never reported as a budget casualty.
  const live = storyboard.beats.filter((b) => {
    if (b.weight >= budget.minWeight) return true;
    dropped.push({
      beat: b,
      seconds: len(b),
      rule: "below_min_weight",
      reason: `Weight ${b.weight} is below ${where} floor of ${budget.minWeight}.`,
    });
    return false;
  });

  // 2. A beat orphaned by the FLOOR keeps its place and loses its camera.
  //    This used to cascade — drop the container, drop everything inside it —
  //    on the belief that the dependent "cannot be emitted at all". That is not
  //    true of this emitter and never was: `enteredParts` in
  //    src/emit/composition.ts reads the relation off the SURVIVING beats, so a
  //    dependent whose container is gone simply gets no dive and draws itself,
  //    which test/camera.test.ts has pinned since the camera landed. Cascading
  //    therefore deleted content that renders perfectly well — and deleted it
  //    for the author's own `--min-weight`, which could take a 0.95 beat out of
  //    the deck because the 0.1 beat in front of it went. The relation is
  //    reported instead — `dangling` carries it, which is the same treatment a
  //    dangling citation gets and for the same reason: only the author can decide
  //    whether the wording still reads.
  //
  //    Inside the OPTIMISER the dependency stays hard, because there the choice
  //    is the machine's rather than the author's — see `knapsack`.
  const total = live.reduce((s, b) => s + len(b), 0);
  const cap = budget.maxSeconds ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(cap) || total <= cap) {
    return finish(live, dropped, storyboard, len);
  }

  // 3. Protect the load-bearing beats: the two ends, and one representative of
  //    each archetype family present. Everything else goes to the optimiser.
  const protectedIds = protect(live, len, cap);

  // 4. Maximise author weight over the rest, subject to the cap and to `inside`.
  const keep = knapsack(live, len, cap, protectedIds);
  if (!keep) {
    // The protected core alone busts the cap. Give the optimiser everything —
    // an over-length honest answer beats an exception nobody can act on.
    const all = knapsack(live, len, cap, new Set());
    const chosen = all ?? [live[0] as Beat];
    return budgetDrops(live, chosen, dropped, storyboard, len, cap, budget, false);
  }
  return budgetDrops(live, keep, dropped, storyboard, len, cap, budget, true);
}

/* ------------------------------------------------------------- protections */

/**
 * The beats a cut may not touch until it has tried everything else.
 *
 * TERMINALS. The first beat frames and the last resolves; a video that stops
 * mid-evidence has no ending, and the demo's closing caveat — its lowest-weighted
 * beat — is precisely the one a threshold reaches for first.
 *
 * TOP TIER. Every beat at the deck's HIGHEST weight. Weight is an ordinal
 * ranking, not a price: an author writing 0.95 against 0.80 is saying "this one
 * matters more", not "this one is worth 1.19 of those". Summing it as if it were
 * cardinal is what lets an optimiser trade the demo's 39-second method overview
 * — the author's joint-highest beat, and the thing the paper is about — for two
 * cheaper 0.80s that add up to more. Measured: without this rule the 3m00s cut
 * carries 8.40 of summed weight against 7.80, and has no pipeline beat in it.
 * Whatever the author put at the top is the spine; below the top, value per
 * second decides.
 *
 * COVERAGE, by FAMILY and not by archetype. Per-archetype coverage is vacuous
 * on a deck like the demo where all twelve beats have distinct archetypes: it
 * would protect everything and cut nothing. Families are the four things a beat
 * can BE (see `ARCHETYPE_FAMILY`), and one of each is the least a cut can keep
 * and still be the same argument.
 *
 * A PICTURE THE AUTHORS DREW, which family coverage does not imply. The beats
 * that carry a source figure are spread across families — `claim-figure` is
 * `frame`, `annotated-figure` and a two-figure `split-compare` are `structure` —
 * and the cheapest representative of a family is regularly the beat without the
 * picture in it: the title is what `frame` usually elects, and a grid outruns a
 * full-plate figure on weight per second every time. So a cut can satisfy every
 * rule above and still come back with no image of the source anywhere in it,
 * which is the one thing a deck cannot get back by rewording. One carrier is
 * protected, chosen exactly as a family representative is and released exactly
 * as one. On the demo at its narrated lengths — the only lengths a cut is ever
 * struck on — it costs nothing at all: the split-compare of the two result
 * figures is already `structure`'s representative. That is what this protection
 * looks like on a deck that used its figures in the first place.
 *
 * If the protected core does not fit, protections are released back to the
 * optimiser worst-value-per-second first, in ONE list rather than in tiers — a
 * tiered release gives up a whole family before it gives up one expensive
 * favourite, which at 90 seconds cost the demo its only equation for a beat that
 * was 43% of the budget on its own. The ends are never released; if they alone
 * do not fit, `selectBeats` reports `fits: false` and the answer is a rewrite.
 */
function protect(live: Beat[], len: (b: Beat) => number, cap: number): Set<string> {
  const ids = new Set<string>();
  const first = live[0];
  const last = live[live.length - 1];
  if (first) ids.add(first.id);
  if (last) ids.add(last.id);

  const top = Math.max(...live.map((b) => b.weight));
  const tier = live.filter((b) => b.weight === top && !ids.has(b.id));
  for (const b of tier) ids.add(b.id);

  // Best of each family by WEIGHT PER SECOND, not by weight. Coverage is about
  // presence, and the cheapest good way to be present leaves the most budget for
  // everything else — protecting the demo's 39-second pipeline as the whole of
  // `structure` spends a fifth of a three-minute short on one protection and
  // then cannot afford the equation walk, which is how a 90-second cut ended up
  // with no `formal` beat in it at all. Ties: higher weight, then earlier.
  const rate = (b: Beat) => b.weight / len(b);
  const better = (b: Beat, held: Beat) =>
    rate(b) > rate(held) || (rate(b) === rate(held) && b.weight > held.weight);
  const reps = new Map<ArchetypeFamily, Beat>();
  for (const b of live) {
    const fam = ARCHETYPE_FAMILY[b.archetype];
    const held = reps.get(fam);
    if (!held || better(b, held)) reps.set(fam, b);
  }
  const coverage = [...reps.values()].filter((b) => !ids.has(b.id));
  for (const b of coverage) ids.add(b.id);

  // The cheapest beat that carries a figure the source really has, chosen the
  // same way and for the same reason: presence, at the least cost to the rest.
  let cheapest: Beat | undefined;
  for (const b of live) {
    if (!figuresShown(b.params as Record<string, unknown>).length) continue;
    if (!cheapest || better(b, cheapest)) cheapest = b;
  }
  const picture = cheapest && !ids.has(cheapest.id) ? [cheapest] : [];
  for (const b of picture) ids.add(b.id);

  // A protection that cannot be honoured is not a protection: pretending
  // otherwise makes the optimiser infeasible instead of making the cut worse in
  // a stated way. Terminals are excluded from the list, so they survive it.
  const ends = new Set([first?.id, last?.id]);
  const releasable = [...tier, ...coverage, ...picture]
    .filter((b) => !ends.has(b.id))
    .sort((a, b) => rate(a) - rate(b) || len(b) - len(a));
  const cost = () => live.filter((b) => ids.has(b.id)).reduce((s, b) => s + len(b), 0);
  for (const b of releasable) {
    if (cost() <= cap) break;
    ids.delete(b.id);
  }
  return ids;
}

/* -------------------------------------------------------------- the optimiser */

/**
 * Maximum total weight that fits, honouring `inside` and the protected set.
 *
 * A 0/1 knapsack, but not a plain one: `inside` makes a beat's admissibility
 * depend on its immediate predecessor, so the state carries one extra bit —
 * "was the beat before this one kept". That is enough because the schema
 * already forces `inside.beat` to BE the immediately preceding beat
 * (storyboardSchema), so no longer-range dependency can exist.
 *
 * Time is quantised to centiseconds with each cost rounded UP and the capacity
 * rounded DOWN, so a cut this returns is never secretly over the cap. Integer
 * throughout: floating-point sums would make the answer depend on beat order.
 *
 * Ties go to KEEPING the beat. Two cuts of equal weight are not equally good —
 * the one with more beats in it explains more — and it makes the result
 * independent of iteration order, which is what invariant 10 is about.
 *
 * Returns undefined when the protected beats alone do not fit.
 */
function knapsack(
  live: Beat[],
  len: (b: Beat) => number,
  cap: number,
  locked: ReadonlySet<string>,
): Beat[] | undefined {
  const n = live.length;
  const K = Math.floor(cap * 100);
  const cost = live.map((b) => Math.ceil(len(b) * 100));
  const value = live.map((b) => Math.round(b.weight * 1000));
  // A dependency binds only where the container is still the beat in front. The
  // floor may already have broken the pair, and when it has, this optimiser must
  // not go on enforcing a relation the deck has already given up — it would drop
  // a beat that the emitter draws fine, to protect a camera move that cannot
  // happen either way.
  const dep = live.map((b, i) => i > 0 && b.inside?.beat === live[i - 1]?.id);
  const forced = live.map((b) => locked.has(b.id));

  const width = (K + 1) * 2;
  const NONE = Number.NEGATIVE_INFINITY;
  let next = new Float64Array(width); // i = n: nothing left to add.
  const choice = new Uint8Array(n * width);

  for (let i = n - 1; i >= 0; i--) {
    const cur = new Float64Array(width);
    const c = cost[i] as number;
    for (let t = 0; t <= K; t++) {
      for (let p = 0; p < 2; p++) {
        const canKeep = (!dep[i] || p === 1) && c <= t;
        const keep = canKeep ? (value[i] as number) + (next[(t - c) * 2 + 1] as number) : NONE;
        const drop = forced[i] ? NONE : (next[t * 2] as number);
        const take = canKeep && keep >= drop;
        cur[t * 2 + p] = take ? keep : drop;
        choice[i * width + t * 2 + p] = take ? 1 : 0;
      }
    }
    next = cur;
  }
  if (!Number.isFinite(next[K * 2] as number)) return undefined;

  const kept: Beat[] = [];
  let t = K;
  let p = 0;
  for (let i = 0; i < n; i++) {
    if (choice[i * width + t * 2 + p] === 1) {
      kept.push(live[i] as Beat);
      t -= cost[i] as number;
      p = 1;
    } else p = 0;
  }
  return kept;
}

/* ------------------------------------------------------------ explanations */

/** Attach a reason to every beat the budget removed, then assemble the Cut. */
function budgetDrops(
  live: Beat[],
  chosen: Beat[],
  dropped: Dropped[],
  storyboard: Storyboard,
  len: (b: Beat) => number,
  cap: number,
  budget: SelectionBudget,
  fits: boolean,
): Cut {
  const keptIds = new Set(chosen.map((b) => b.id));
  const families = new Map<ArchetypeFamily, number>();
  for (const b of chosen) {
    const fam = ARCHETYPE_FAMILY[b.archetype];
    families.set(fam, (families.get(fam) ?? 0) + 1);
  }
  const lightest = Math.min(...chosen.map((b) => b.weight));
  const target = budget.id ? `${budget.id}'s ${clock(cap)}` : clock(cap);

  for (const b of live) {
    if (keptIds.has(b.id)) continue;
    const fam = ARCHETYPE_FAMILY[b.archetype];
    const still = families.get(fam) ?? 0;
    // Say what it cost and what it was worth, then say what the deck still has
    // of its kind — because "why this one" is always half about the alternative.
    const rate = (b.weight / len(b)).toFixed(3);
    dropped.push({
      beat: b,
      seconds: len(b),
      rule: "over_budget",
      reason:
        `Cut to fit ${target}: ${len(b).toFixed(1)}s for weight ${b.weight} is ${rate} weight per second, ` +
        // The empty case is not a rhetorical flourish — a budget shorter than
        // the shortest beat keeps nothing, and "below every beat kept" would be
        // vacuously true of a comparison against no beats at all.
        (chosen.length === 0
          ? `and ${target} is shorter than any beat in this deck.`
          : b.weight < lightest
            ? `below every beat kept.`
            : `and the beats kept buy more per second.`) +
        // A count and not the ids: the reason for ONE beat's removal should not
        // recite the rest of the deck, and `Cut.kept` already has the names.
        ` Its family (${fam}) still has ${still} beat(s) in the cut.`,
    });
  }
  return finish(chosen, dropped, storyboard, len, fits);
}

/** Order the drops, find the dangling references, round the total. */
function finish(
  kept: Beat[],
  dropped: Dropped[],
  storyboard: Storyboard,
  len: (b: Beat) => number,
  fits = true,
): Cut {
  const order = new Map(storyboard.beats.map((b, i) => [b.id, i]));
  const at = (id: string) => order.get(id) ?? 0;
  return {
    kept: [...kept].sort((a, b) => at(a.id) - at(b.id)),
    dropped: [...dropped].sort((a, b) => at(a.beat.id) - at(b.beat.id)),
    // Rounded like every other time in this pipeline: a total that carries float
    // drift is a total that moves bytes in a message nobody changed.
    seconds: Math.round(kept.reduce((s, b) => s + len(b), 0) * 1000) / 1000,
    dangling: dangling(kept),
    fits,
  };
}

/**
 * References in the cut whose subject nobody in the cut draws.
 *
 * A beat's `evidence` says what it is accountable to; its params say what it
 * actually PUTS ON SCREEN. When those differ — b08 cites the benchmark table
 * and draws bars — the citation is carried by another beat, and cutting that
 * beat leaves the reference pointing at nothing. Reported rather than repaired:
 * dropping the citing beat as well would lose the claim to save the footnote,
 * and force-keeping the shower would let a footnote overrule the budget. The
 * author is the only one who can decide which.
 *
 * A broken `inside` is the same shape of problem and gets the same answer. The
 * beat draws itself perfectly well without its container — the emitter reads the
 * relation off the surviving beats and simply emits no camera — but the author
 * wrote a dive and will get a hard cut, and the narration at that beat may say
 * so out loud. That is a sentence to re-read, not a beat to delete.
 */
function dangling(kept: Beat[]): Dangling[] {
  const shown = new Set(kept.flatMap(shows));
  const here = new Set(kept.map((b) => b.id));
  const out: Dangling[] = [];
  for (const b of kept) {
    // The schema forces `inside.beat` to be the IMMEDIATELY preceding beat, so
    // "still in the cut" and "still adjacent" are the same question only while
    // nothing between them was dropped — hence the index check, not just the set.
    const container = b.inside?.beat;
    const i = kept.indexOf(b);
    if (container !== undefined && (!here.has(container) || kept[i - 1]?.id !== container)) {
      out.push({
        beat: b,
        ref: { kind: "beat", id: container },
        reason: `${b.id} happens inside "${container}", which this cut does not keep before it, so it opens on a cut where the storyboard asked for a camera move.`,
      });
    }
    const own = new Set(shows(b));
    for (const ref of b.evidence) {
      if (ref.kind === "section" || own.has(ref.id) || shown.has(ref.id)) continue;
      out.push({
        beat: b,
        ref,
        reason: `${b.id} cites ${ref.kind} "${ref.id}", which no beat in this cut shows.`,
      });
    }
  }
  return out;
}

/**
 * What a beat PUTS ON SCREEN, as source ids — params, never `evidence`. The two
 * differ exactly where `dangling` is interesting: b08 is accountable to the
 * benchmark table and shows bars.
 */
function shows(beat: Beat): string[] {
  const p = beat.params as Record<string, unknown>;
  return [...figuresShown(p), p.tableId, p.equationId].filter(
    (v): v is string => typeof v === "string",
  );
}

/**
 * The figure ids alone, which is the question `protect` asks. A split-compare
 * keeps its figures one level down, one per side, so this is not a flat field
 * read — and a side is as often a list as a picture, hence the filter.
 */
function figuresShown(params: Record<string, unknown>): string[] {
  const sides = ["left", "right"].map(
    (side) => (params[side] as { figureId?: unknown } | undefined)?.figureId,
  );
  return [params.figureId, ...sides].filter((v): v is string => typeof v === "string");
}

/** Seconds as a platform quotes them. Ceiling, so a cut over the cap reads over. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "any length";
  const whole = Math.ceil(seconds);
  const m = Math.floor(whole / 60);
  return m === 0 ? `${whole}s` : `${m}m${String(whole % 60).padStart(2, "0")}s`;
}
