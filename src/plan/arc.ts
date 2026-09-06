/**
 * The paper arc: what a research-talk deck must open and close with.
 *
 * A research talk has a shape a general explainer does not. It opens on the
 * problem and on the ground the work stands on, and it closes on what the work
 * does NOT do and then on what to take away. DeckSmith's planner writes the
 * opening well already — 13 of 15 committed full-deck runs open with a `title` —
 * and the ending badly: 10 of 15 close with a `callout`, but ZERO of 15 carry
 * two, because the limitation arrives as a subordinate clause inside the
 * conclusion ("The idea works, but the strongest lightweight models remain
 * ahead") rather than as its own slide. Splitting that clause into a slide is
 * the actual behaviour change this module asks for.
 *
 * WHY THIS FILE EXISTS AT ALL, rather than the rule living where it is enforced:
 * three directories read this definition and none of them can own it — the
 * prompt (src/plan/prompt.ts) asks the model for the arc, the scan
 * (src/verify/index.ts) reports where a plan missed it, and the cut
 * (src/plan/select.ts) refuses to delete a beat that carries a role. Restating
 * the rule three times is how the three fall out of step; deriving it from one
 * table is how they cannot.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO. It never decides that a document is
 * a research paper. `prefs.genre` is declared by the author and nothing here
 * sniffs it — see the field's own note in src/types.ts for the measurement that
 * settled that. And it never requires a beat the source cannot support: RULE 3
 * forbids inventing a baseline or a result, so a source that says nothing about
 * prior work honestly yields no `background` beat, and this file's job is then
 * to report the gap rather than to have manufactured one.
 */
import type { Prefs } from "../prefs.js";
import type { Beat, BeatRole, Storyboard } from "../types.js";

/** Every structural job, in the order a deck performs them. */
export const ARC_ROLES: readonly BeatRole[] = ["intro", "background", "limitations", "conclusion"];

/**
 * Roles required at a given deck length, and why the list shortens.
 *
 * Four reserved slides out of five is not a deck, it is a table of contents. At
 * `--duration 60` a deck is about five beats, so asking for the full arc there
 * is asking for something nobody could deliver, and a gate that fires on the
 * impossible is one people learn to ignore. The thresholds:
 *
 *   n >= 8   the full arc. 8 is this project's own definition of a full-deck
 *            run — the corpus count of "15 committed full-deck plans" is beats
 *            >= 8 — not a number chosen here.
 *   5..7     the ending only. An `intro` is what the planner already writes
 *            unprompted 13 times in 15, and `background` is the beat most likely
 *            to have no source material behind it, so those two are the ones to
 *            give up first when the budget is short.
 *   n < 5    nothing. There is no room for a shape.
 *
 * Read off the beat count the plan actually came back with, not off
 * `prefs.slides`: the floor the author asked for and the deck the planner
 * returned are different numbers, and `scanBeatCount` already owns the gap
 * between them.
 */
export function requiredRoles(beatCount: number): readonly BeatRole[] {
  if (beatCount >= 8) return ARC_ROLES;
  if (beatCount >= 5) return ["limitations", "conclusion"];
  return [];
}

/** Whether the paper arc was asked for at all. Declared, never sniffed. */
export function paperArcRequested(prefs: Pick<Prefs, "genre">): boolean {
  return prefs.genre === "paper";
}

/** The beats carrying a structural role, by role. Later duplicates are reported, not kept. */
export function arcBeats(storyboard: Storyboard): Map<BeatRole, Beat[]> {
  const by = new Map<BeatRole, Beat[]>();
  for (const beat of storyboard.beats) {
    if (!beat.role) continue;
    by.set(beat.role, [...(by.get(beat.role) ?? []), beat]);
  }
  return by;
}

/**
 * Ids of every beat carrying a role — what the cut refuses to release.
 *
 * Takes a beat list rather than a Storyboard because the cut works over the
 * surviving beats, not over the plan.
 */
export function arcIds(beats: readonly Beat[]): Set<string> {
  return new Set(beats.filter((b) => b.role).map((b) => b.id));
}

/**
 * Where a plan departs from the arc it was asked for, as sentences.
 *
 * ORDER IS CHECKED, NOT JUST PRESENCE, and only where order is the point. The
 * user's requirement is specifically that the deck END on the conclusion with
 * limitations immediately before it — an ending is a position, not a topic — so
 * those two are checked against the last two slots. The opening pair is checked
 * for presence and for being early, because "the first couple of slides" is a
 * region rather than an index, and a deck that opens title, problem, background
 * is not wrong.
 *
 * Returns an empty array when the arc was not requested, when the deck is too
 * short to carry it, or when the plan satisfied it.
 */
export function arcProblems(
  storyboard: Storyboard,
  prefs: Pick<Prefs, "genre" | "slides">,
): string[] {
  if (!paperArcRequested(prefs)) return [];
  const beats = storyboard.beats;
  // THE SCAN MAY NOT DEMAND WHAT THE PROMPT DID NOT ASK FOR, and the two are
  // keyed off different numbers: `paperArc` tiers on `prefs.slides`, which is
  // the FLOOR the prompt was written to, while the deck that came back has its
  // own length. A model told "this deck is short, so only the ENDING is
  // required" and then told the floor is not a ceiling can honestly return nine
  // beats carrying exactly the two roles it was shown — and grading that against
  // the four-role tier is this project's own "a bound the model cannot see is a
  // bound it crosses", with the run's ten minutes already spent.
  //
  // `min` is right in both directions: a plan shorter than the floor cannot be
  // held to the floor's tier either.
  const need = requiredRoles(Math.min(prefs.slides, beats.length));
  if (!need.length) return [];

  const out: string[] = [];
  const by = arcBeats(storyboard);

  for (const role of need) {
    const held = by.get(role) ?? [];
    if (held.length === 0) {
      out.push(
        `No beat carries role "${role}". A paper deck is meant to have one, and the source may not support it — write the beat, or drop \`--genre paper\` for this document.`,
      );
      continue;
    }
    if (held.length > 1) {
      out.push(
        `${held.length} beats carry role "${role}" (${held.map((b) => b.id).join(", ")}). A structural job belongs to one slide.`,
      );
    }
  }

  // The ending is a position. `conclusion` last, `limitations` immediately
  // before it — which is the half of the request that no committed plan has
  // ever produced on its own.
  const last = beats[beats.length - 1];
  if (need.includes("conclusion") && by.has("conclusion") && last?.role !== "conclusion") {
    out.push(
      `The deck ends on "${last?.id}" (${last?.archetype}), not on its conclusion. The conclusion is the last thing the viewer sees or it is not a conclusion.`,
    );
  }
  // ADJACENCY IS RELATIVE TO THE CONCLUSION, not to index n-2. Keying it to the
  // last-but-one slot told an author whose deck had one trailing slide that the
  // pair was broken when it was not — and the two messages then disagreed, one
  // true and one false. Worse, acting on the false one by swapping the roles
  // silenced it and left the takeaway landing BEFORE the caveat: a gate that
  // rewards the harmful edit, which is the failure this project names first.
  const limIdx = beats.findIndex((b) => b.role === "limitations");
  const conIdx = beats.findIndex((b) => b.role === "conclusion");
  if (need.includes("limitations") && limIdx >= 0 && conIdx >= 0 && limIdx !== conIdx - 1) {
    out.push(
      `The limitations beat is not the slide immediately before the conclusion. The two are a pair and the caveat comes first.`,
    );
  }

  // The opening is a region, not an index.
  const openingWindow = beats.slice(0, 3).map((b) => b.role);
  for (const role of need.filter((r) => r === "intro" || r === "background")) {
    if (by.has(role) && !openingWindow.includes(role)) {
      out.push(
        `The "${role}" beat is not in the first three slides. It is what the rest of the deck is understood against, so it has to arrive before the mechanism does.`,
      );
    }
  }

  // RULE 1 applies to the closing pair like any other neighbours, and the two
  // roles collide on `callout` by default — this is the concrete way a deck
  // satisfies the arc and still reads as two identical text slides in a row.
  const lim = by.get("limitations")?.[0];
  const con = by.get("conclusion")?.[0];
  if (lim && con && lim.archetype === con.archetype) {
    out.push(
      `The limitations and conclusion beats are both \`${lim.archetype}\`. Two of the same picture running is what RULE 1 forbids; draw the conclusion where the source states it.`,
    );
  }

  return out;
}
