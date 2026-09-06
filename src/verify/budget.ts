/**
 * Does this deck fit the format it was built for?
 *
 * A format profile decides a canvas and a pacing, and — since it also decides
 * where the file is going — a length. `short-9x16` that runs 4m07s is not a
 * short: YouTube Shorts refuses it at 3 minutes and Facebook Reels at 90
 * seconds, so the build produces a file whose entire reason for existing is a
 * destination that will not take it. Every other gate passes it, because nothing
 * else in the stack knows what a format is FOR. Those numbers are not literals
 * here — `DESTINATIONS` in src/types.ts holds them, and this file names the
 * destination in the finding so a stale limit is visible from the message.
 *
 * WHAT THIS GATE IS NOW FOR. `emit` DOES trim: `planCut` in
 * src/emit/composition.ts fits the deck to the format's length before it writes
 * a byte, using the same `selectBeats` this file used to quote. The objection
 * that kept it out of `emit` for so long was never about trimming, it was about
 * SILENCE — a deck that comes out PASS with a third of its explanation gone and
 * nothing anywhere saying which third. That objection is answered by `build`
 * printing every casualty's reason (`reportCut` in src/cli.ts), not by refusing
 * to trim, and refusing cost every author a manual `--min-weight` hunt to get one
 * storyboard to produce both a deck and a short.
 *
 * So this gate is the BACKSTOP, and it now fires on exactly two things, both of
 * which are real. First, a cut `selectBeats` could not make fit at all — when
 * even the deck's two terminal beats bust the cap, no selection saves it and the
 * narration itself has to get shorter. Second, a composition built by something
 * other than `build`: the budget lives in `FORMATS`, and a library caller
 * assembling a deck by hand is not obliged to have consulted it. The finding
 * still names the overrun and still names beats rather than seconds, because
 * "you are 66 seconds over" is a fact and "these three beats, and why each"
 * is a decision.
 *
 * Measured against the NARRATED length, not the authored one. `beatSeconds` in
 * src/emit/composition.ts lengthens every beat to fit the speech recorded for
 * it, so the demo's authored 106s of beats becomes 246s of deck. A budget
 * checked against `beat.seconds` would pass the deck that is actually too long.
 * The composition's own `data-duration` is that number, already summed and
 * rounded, so this reads the built artifact rather than re-deriving it.
 */
import { selectBeats } from "../plan/select.js";
import {
  type Beat,
  destinationAt,
  type Finding,
  FORMATS,
  type Format,
  type Storyboard,
} from "../types.js";

/** What the composition root records about itself. */
export interface Canvas {
  width: number;
  height: number;
  /** `data-duration` on the root: the whole deck, narration included. */
  seconds: number;
}

/**
 * Read the root element's own attributes.
 *
 * Only the root carries `data-width`/`data-height` (`emitComposition`); scenes
 * carry an id, a start and a duration and nothing else, which is exactly the
 * attribute set EXPERIMENT-003 pinned. So "the div with all three" is an
 * unambiguous handle, and a sub-composition file — should one ever exist — reads
 * as `undefined` rather than as a deck of its own.
 */
export function readCanvas(html: string): Canvas | undefined {
  const root = /<div\b[^>]*\bid="root"[^>]*>/.exec(html)?.[0];
  if (!root) return undefined;
  const attr = (name: string): number | undefined => {
    const raw = new RegExp(`\\b${name}="([0-9.]+)"`).exec(root)?.[1];
    return raw === undefined ? undefined : Number(raw);
  };
  const width = attr("data-width");
  const height = attr("data-height");
  const seconds = attr("data-duration");
  if (width === undefined || height === undefined || seconds === undefined) return undefined;
  return { width, height, seconds };
}

/**
 * Which profiles could have produced this canvas.
 *
 * The composition records pixels, never a profile id, and `deck-16x9` and
 * `video-16x9` share 1920x1080 — they differ only in navigability. Rather than
 * guess between them, hold the deck to the most permissive budget any profile
 * with this canvas allows: a gate that fails a deck for a limit that might not
 * be its own is a gate people learn to ignore. Today the two 16:9 profiles have
 * the same (absent) budget, so the reading is exact as well as safe.
 */
export function profilesFor(width: number, height: number): Format[] {
  return Object.values(FORMATS).filter((f) => f.width === width && f.height === height);
}

/**
 * The budget finding for one built composition, if there is one.
 *
 * `storyboard` is optional because `decksmith verify <dir>` has only the
 * directory. With it, the message can name the beats to drop; without it, the
 * overrun alone still says the useful half. `kept` is the list `build` actually
 * emitted — scenes are beats in order, so a scene's window is the narrated
 * length of the beat at the same index, and getting that pairing wrong would
 * attribute one beat's seconds to another. Absent, it is re-derived with the
 * flat threshold, which is the same list only while the budget cut nothing.
 */
export function scanBudget(
  html: string,
  storyboard?: Storyboard,
  kept?: readonly Beat[],
): Finding[] {
  const canvas = readCanvas(html);
  if (!canvas) return [];

  const profiles = profilesFor(canvas.width, canvas.height);
  if (profiles.length === 0) {
    // Not pedantry: a canvas no profile declares gets no budget check at all,
    // and "no rule applied" is indistinguishable from "the rule passed".
    return [
      {
        severity: "warning",
        gate: "budget",
        rule: "unknown_canvas",
        message: `This deck's canvas is ${canvas.width}x${canvas.height}, which no format in FORMATS declares, so no duration budget applies to it.`,
      },
    ];
  }

  const names = profiles.map((f) => f.id).join(" / ");
  // An absent budget is an unbudgeted format, never a zero-length one.
  const cap = (f: Format) => f.maxSeconds ?? Number.POSITIVE_INFINITY;
  const maxSeconds = Math.max(...profiles.map(cap));
  const warnSeconds = Math.max(...profiles.map((f) => f.warnSeconds ?? cap(f)));

  if (canvas.seconds > maxSeconds) {
    // Name the place the number comes from. "3m00s" is a house rule until it is
    // "3m00s, the limit at YouTube Shorts" — and a limit with a name attached is
    // one a reader can check, and notice has moved.
    const loosest = profiles.find((f) => cap(f) === maxSeconds);
    const at = loosest ? destinationAt(loosest.id, maxSeconds) : undefined;
    return [
      {
        severity: "error",
        gate: "budget",
        rule: "over_budget",
        message:
          `This deck's narrated cut runs ${clock(canvas.seconds)} and ${names} allows ${clock(maxSeconds)}` +
          `${at ? ` — the limit at ${at.name}` : ""}. ` +
          remedy(html, canvas.seconds - maxSeconds, maxSeconds, profiles, storyboard, kept),
      },
    ];
  }
  if (canvas.seconds > warnSeconds) {
    const tighter = profiles.find((f) => (f.warnSeconds ?? cap(f)) === warnSeconds);
    const at = tighter ? destinationAt(tighter.id, warnSeconds) : undefined;
    return [
      {
        severity: "warning",
        gate: "budget",
        rule: "near_budget",
        message: `This deck's narrated cut runs ${clock(canvas.seconds)}, over the ${clock(warnSeconds)} that ${at ? `${at.name}, the tightest destination for ${tighter?.id ?? names}, accepts` : `the tightest destination for ${tighter?.id ?? names} accepts`}. It is postable, but not everywhere.`,
      },
    ];
  }
  return [];
}

/**
 * What to actually do about an overrun, in beats rather than in seconds.
 *
 * "You are 66 seconds over" is a fact; "here are the three beats a budgeted cut
 * drops, and why each one" is a decision someone can make. Two answers, in this
 * order, because they are not the same answer:
 *
 * 1. WHAT A GOOD CUT LOOKS LIKE — `selectBeats`, which fits the budget while
 *    protecting the deck's ends and one beat of every archetype family. This
 *    goes first because it is the cut a person would actually want.
 * 2. WHAT `--min-weight` CAN EXPRESS — the flat threshold, retained because it
 *    is the flag that exists today and the only one `build` reads. It is a
 *    worse cut, and the message now shows both so the difference is visible
 *    rather than asserted: on the demo the threshold drops bar-compare and the
 *    closing caveat, and the selection keeps both inside the same three minutes.
 */
function remedy(
  html: string,
  over: number,
  maxSeconds: number,
  profiles: readonly Format[],
  storyboard?: Storyboard,
  emitted?: readonly Beat[],
): string {
  const generic = `Cut beats from the storyboard or shorten their narration by ${clock(over)}.`;
  if (!storyboard) return generic;

  // Scenes are the beats a format kept, in order, so a scene's window is the
  // narrated length of the beat at the same index. Any profile sharing this
  // canvas would keep the same list; take the first.
  const windows = sceneSeconds(html);
  const profile = profiles[0];
  const kept = emitted ?? storyboard.beats.filter((b) => b.weight >= (profile?.minWeight ?? 0));
  if (windows.length !== kept.length) return generic;

  const seconds = Object.fromEntries(kept.map((b, i) => [b.id, windows[i] ?? 0]));
  const budget = {
    minWeight: profile?.minWeight ?? 0,
    maxSeconds,
    ...(profile && { id: profile.id }),
  };
  const cut = selectBeats(storyboard, budget, seconds);
  // `below_min_weight` drops are not news: the author asked for them, and they
  // are already absent from the deck this finding is about.
  const casualties = cut.dropped.filter((d) => d.rule !== "below_min_weight");
  const selection = cut.fits
    ? `A budgeted cut keeps ${cut.kept.length} of ${kept.length} beats in ${clock(cut.seconds)}, dropping ${casualties.length}. ` +
      casualties.map((d) => `${d.beat.id} (${d.beat.archetype}): ${d.reason}`).join(" ") +
      (cut.dangling.length > 0
        ? ` Check the wording first: ${cut.dangling.map((d) => d.reason).join(" ")}`
        : "") +
      " "
    : `No cut of these beats fits ${clock(maxSeconds)} — the narration itself has to get shorter. `;

  // THE DECK'S OWN ENDING IS OFTEN THE BEAT NAMED HERE, and it is left named on
  // purpose. `protect()` in src/plan/select.ts refuses to release the terminals
  // to the OPTIMISER, so it is tempting to exclude them here too — but this
  // advice names `--min-weight`, and that flag is a flat floor that cannot say
  // "except the last beat". Excluding the ending from the list while still
  // recommending the threshold that deletes it would make the two halves of one
  // sentence disagree, which is worse than advice the author can weigh. The
  // honest fix for "my conclusion keeps getting cut" is a weight, or
  // `--genre paper`, which pins the closing pair inside the optimiser where a
  // pin can actually be expressed.
  const byWeight = kept
    .map((beat, i) => ({ beat, seconds: windows[i] ?? 0 }))
    .sort((a, b) => a.beat.weight - b.beat.weight);

  const drop: Array<{ beat: Beat; seconds: number }> = [];
  let saved = 0;
  for (const candidate of byWeight) {
    if (saved >= over) break;
    drop.push(candidate);
    saved += candidate.seconds;
  }
  if (saved < over) return selection + generic; // Nothing short of a rewrite fits.

  const named = drop.map((d) => `${d.beat.id} (weight ${d.beat.weight})`).join(", ");
  // The threshold that would drop exactly these: just above the heaviest one cut.
  const raiseTo = Math.max(...drop.map((d) => d.beat.weight));
  return (
    selection +
    `The flag you have is blunter. Dropping the ${drop.length} lowest-weighted beat(s) — ${named} — saves ${clock(saved)}. ` +
    // Name the flag, not just the concept. The advice used to say "raise
    // minWeight" without saying how, which reads as "edit the format table".
    `Pass --min-weight ${Math.round((raiseTo + 0.01) * 100) / 100} to ${profiles.map((f) => f.id).join("/")}, or cut them from the storyboard.`
  );
}

/** Each scene's window, in slide order. Attribute order is `sceneHtml`'s. */
function sceneSeconds(html: string): number[] {
  const out: number[] = [];
  const scene = /data-composition-id="s\d+"[\s\S]{0,200}?data-duration="([0-9.]+)"/g;
  for (const m of html.matchAll(scene)) out.push(Number(m[1]));
  return out;
}

/**
 * Seconds as a length a person can compare to a platform limit.
 *
 * Rounded UP, because a cut 0.4s over the cap is over the cap, and a message
 * that prints the ceiling as the running time is a message nobody believes.
 */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "any length";
  const whole = Math.ceil(seconds);
  const m = Math.floor(whole / 60);
  return m === 0 ? `${whole}s` : `${m}m${String(whole % 60).padStart(2, "0")}s`;
}
