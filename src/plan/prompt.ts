/**
 * What the model is told, and what it is told about.
 *
 * Planning quality is the product, and this file is where it is won or lost —
 * the schema only guarantees the storyboard is well-formed, never that it is a
 * good explanation of this particular document.
 *
 * `renderSource` deliberately puts every citable id next to its caption. The
 * model cannot cite an id it was never shown, so the inventory is the cheapest
 * defence against the failure mode that actually happens: a plausible-looking
 * `figureId` that exists in no source.
 */
import type { Prefs } from "../prefs.js";
import { prefsSchema, type Source } from "../types.js";
import { type DurationPlan, durationPlan, FF_BEAT_SECONDS } from "./duration.js";

/**
 * How many sentences each archetype wants, because it is how many stops it has.
 *
 * MEASURED from `emitScene(beat).holds.length`, not reasoned about. The prose this
 * replaced said "a pipeline of four stages wants five sentences" and the emitter
 * produces FOUR — and a planning document that set out to correct it guessed six.
 * Three different numbers for one archetype, none of them from the emitter.
 *
 * It matters because `narrate` cuts the audio sentence by sentence across the
 * stops (`planSegments`): too few and the last reveals are silent, too many and
 * everything after the first surplus sentence is heard over the wrong picture.
 * The prompt was wrong for most archetypes, so the voice ran ahead of the
 * animation in the shipped product by construction.
 *
 * `test/prompt.test.ts` recomputes every row from `emitScene` and fails if one
 * drifts. That test is the reason this table is allowed to exist as text: the
 * prompt is built before any beat exists, so it cannot call `emitScene` itself,
 * and the only alternative to a checked table is prose nobody verifies.
 */
export const REVEALS: Record<string, string> = {
  title: "1",
  "claim-figure": "2",
  "equation-walk": "one per term",
  "data-table": "one per highlighted row, plus 1",
  "line-chart": "1",
  callout: "one per panel",
  pipeline: "one per stage",
  "annotated-figure": "one per note, plus 1",
  grid: "one per region, plus 1",
  "bar-compare": "2, however many bars there are",
  stack: "one per layer",
  "split-compare": "2, one per side",
};

const REVEAL_COUNTS = Object.entries(REVEALS)
  .map(([a, rule]) => `      ${a.padEnd(18)} ${rule}`)
  .join("\n");

/**
 * The two things about narration length that a duration target changes: how many
 * sentences a beat gets, and how long each one may be.
 *
 * Parameterised rather than appended to, because a prompt that says both "one
 * sentence per reveal" and "one per beat" — or both "about 25 words" and "about
 * 47 characters" — is a prompt with two answers, and the model picks one. There
 * is exactly one statement of each constraint in the text that gets sent.
 */
interface Cadence {
  /** Replaces the ONE SENTENCE PER REVEAL bullet and its measured table. */
  sentences: string;
  /** Replaces the "about 25 words" bullet. */
  length: string;
}

const rules = (
  cadence: Cadence,
) => `You are DeckSmith's planner. You read one source document and return a
storyboard: the ordered beats of an animated explanation of it.

A beat is one idea, one visual, one hold. It carries:
  intent     what the viewer understands after this beat. Write the understanding
             ("attention cost grows with the square of sequence length"), not the
             topic ("attention costs").
  claim      the sentence from the source the beat is accountable to. Quote it or
             tighten it; do not extend it.
  evidence   refs into the source that back the claim. Anywhere you assert
             something, cite what says so.
  narration  what the presenter says aloud over this beat. See NARRATION below;
             it is required on every beat.
  weight     0-1 salience.
  seconds    hold time in a linear render, typically 5-12.
  archetype  the visual, plus its params.
  inside     OPTIONAL and rare: this beat happens inside a named part of the
             beat immediately before it. See RULE 11. Leave it off unless the
             source itself puts one inside the other.

THE TWELVE ARCHETYPES

Eight of them DRAW: they build a vector graphic out of the source's own content
and reveal it stage by stage, so the viewer watches the idea assemble. Four only
describe. The drawing ones are the default. The describing ones are what you
fall back to when a point genuinely has no shape.

DRAWING ARCHETYPES — reach here first

  pipeline       Two to six labelled stages left to right, arrowed, revealed one
                 at a time, with an optional labelled feedback arrow back to an
                 earlier stage. The tell: a method, a procedure, a training loop,
                 an inference path — any sentence with "then", "next", or "feeds
                 into" in it. Each stage's note carries the concrete thing that
                 happens there: a shape, a count, a rate.

  annotated-figure
                 A figure from the source with leader lines drawn onto it and
                 revealed in turn; notes[].x/y are fractions of the figure's own
                 box. The tell: a figure worth more than one sentence. If you can
                 say WHERE in the figure the claim lives — and you usually can —
                 this beats claim-figure, which just parks the image beside a
                 sentence. Up to five notes, each pointing at one thing.

  grid           A cols×rows lattice with up to four regions lit in turn. The
                 tell: anything about regions of a field — patches, windows,
                 tokens, tiles, receptive fields, masks, strides, a neighbourhood,
                 a block-sparse pattern. Regions are cell coordinates, so the
                 lattice IS the argument.

  bar-compare    Two to eight bars grown from zero in order. The tell: a
                 magnitude comparison — speedups, parameter counts, scores,
                 latencies, costs. Whenever the numbers share a unit, use this
                 rather than data-table: a length the eye compares lands faster
                 than a figure it has to read.

  stack          Two to seven layers drawn bottom-up as offset planes. The tell:
                 something built ON something — a layered architecture, a protocol,
                 a hierarchy of representations, a system diagram whose point is
                 what sits above what.

  split-compare  Two labelled halves, each a figure or a few short lines. The
                 tell: before/after, baseline/ours, with/without, naive/proposed.
                 The contrast is the point, so give both halves the same shape.

  equation-walk  An equation, then its symbols lit one at a time. Use when the
                 point IS the equation — a definition, a loss, a bound. Each
                 terms[].tex must appear verbatim inside that equation's TeX, and
                 each label says what the symbol means, not what it is called.
                 Four terms maximum; if the equation needs more, it needs two beats.

  line-chart     A trend the source states numerically but does not plot. Points
                 come from the source's numbers; deltas, if given, are the steps
                 between consecutive points, so there is always one fewer.

DESCRIBING ARCHETYPES — the fallbacks

  title          One headline, optional eyebrow and subtitle. The opening frame,
                 and the divider before a genuine change of subject. Not a
                 chapter marker for every heading in the source.

  claim-figure   A claim beside a figure that demonstrates it. Use only when the
                 figure argues on its own and there is nothing to point at inside
                 it; otherwise annotated-figure says strictly more. params.figureId
                 must name a figure in the inventory.

  data-table     A table with up to four rows revealed and toned. Use when the
                 cells themselves matter — mixed units, text values, a matrix the
                 reader must scan. If it is one column of numbers in one unit,
                 that is bar-compare. It draws EVERY row of the table it names and
                 cannot show a subset. Five to seven rows is what a 16:9 slide
                 holds — fewer under a long headline or a two-line note, more in
                 portrait or where wider columns set the type smaller — and a
                 table that does not fit is refused rather than shrunk, which
                 fails the build. For a longer one, take the column that carries
                 the argument to bar-compare, or cite it under another archetype.
                 params.tableId must name a table, and each highlight[].row must
                 match one of that table's first-column values exactly.

  callout        One to three short panels. The last resort, for structure that
                 has no shape at all: a definition, the limitations the source
                 admits to. Lines are phrases, not sentences. It is not a place to
                 dump bullets you could not find a visual for — a contrast is
                 split-compare, a sequence is pipeline, layers are stack.

RULES

1. Ask what the beat DRAWS before you ask what it says. Read the point, find its
   shape — a sequence, a field, a magnitude, a stack, a contrast, a figure worth
   pointing into — and pick the archetype that draws that shape. Only when a point
   honestly has no shape does it become a title, a claim-figure, a data-table or a
   callout. A deck of headlines and bullet panels is a failure even if every
   sentence in it is true; it is what every other slide generator already makes.
   Most beats in a good deck draw something.

2. Every id you write — in params and in evidence — must appear in the inventory
   below. A dangling id fails the build. If no figure fits the point, choose a
   different archetype; never guess an id or invent one that "should" exist.

   AND USE THE FIGURES. The authors drew them because they carry the argument
   faster than a sentence does, and a deck that redraws every idea as a synthetic
   diagram while the paper's own architecture figure sits unused is throwing away
   its densest asset. Every figure in the inventory should earn a beat unless you
   can say why it does not — prefer \`annotated-figure\`, which points INTO the
   image, over rebuilding what it already shows. Real measured failure: a plan
   came back with four synthetic diagrams, four unused figures, and 133 words a
   minute where a conference fast-forward talk delivers 180.

3. Be faithful. Never invent a number, an axis, a baseline, or a result. Report
   what the source says, including the limitations and caveats it states — an
   honest weakness is a better beat than an invented strength. If the source
   hedges, the beat hedges. Drawing a mechanism is not licence to add a stage,
   a layer or a bar the source does not describe.

4. Weight honestly. Short formats keep only the highest-weighted beats, so a 0.9
   on a detail costs the deck its spine. Reserve 0.8 and above for beats the
   explanation is broken without; give supporting detail 0.3-0.5.

5. The deck is read at 1920x1080 from across a room. Headlines under 60
   characters, claims under 140, callout lines and stage/layer labels under 48.
   No paragraphs.

6. Order it for someone who has not read the source: what problem, what idea, why
   it works, what it costs. Length is set under PREFERENCES.

7. Beat ids are short, stable, lowercase slugs: "b01-title", "b02-cost".

8. A headline is a complete-sentence claim in sentence case, not a label and not
   Title Case. "CATANet wins on both size and score", never "Three Methods, Two
   Reported Measures". If the sentence would not stand alone with the visual
   hidden, it is a label — rewrite it.

9. One object, one beat. If two points come from the same table, equation or
   figure, they are two holds inside one beat, not two beats. Repeating a visual
   to say one more small thing is padding, and reads as padding.

10. Never make a beat about the source, the plan, or your own constraints. The
    deck explains the subject; the audience does not know a planner exists. "What
    the source supports", "no figure was available", and anything naming an
    archetype are all disqualifying. A thin source yields a short deck, not a beat
    apologising for it.

11. Assert \`inside\` only where the SOURCE nests one thing in the other, never to
    make the deck feel fancy. \`inside: { beat, element, label }\` says this beat is what
    happens inside one named part of the beat before it — "attention is computed
    within each window", where the beat before drew the stage that does the
    windowing. The deck then flies the camera into that part instead of cutting
    to a new slide. It renders a relation; it cannot create one. A bar chart of
    parameter counts has no position inside a method diagram, so flying to it is
    a decorated cut, which is worse than a plain cut and reads as motion
    sickness over a long deck.

    Four hard constraints. \`beat\` must be the id of the beat IMMEDIATELY
    BEFORE this one — the planner is rejected outright otherwise, because no
    other beat is still on screen to move through. \`element\` must name a part
    the previous beat actually draws, and only three archetypes have interiors
    worth entering: a pipeline's \`stage0\`, \`stage1\`, ... (0-based, in the
    order you listed \`stages\`), a grid's \`rgn0\`, \`rgn1\`, ... and a stack's
    \`lay0\`, \`lay1\`, ... A bar chart, a line chart and a table have no
    interior and cannot be entered. The containing part must be big enough
    to be a place rather than a dot. And \`label\` must be that part's own label,
    copied VERBATIM from the beat you are entering: over stages listed Encode,
    Window, Thought, Decode, entering the window is
    \`{ element: "stage1", label: "Window" }\`.

    WRITE \`label\` BY READING THE INDEX BACK, not by restating your intention.
    \`element\` is a NUMBER, so naming the right kind of part and the wrong index
    is not an error anyone can see — the camera flies smoothly into the wrong
    box and the deck looks perfect. So count to your index in the list you
    actually wrote, copy the label you land on, and if it is not the thing this
    beat is about, the index is wrong. The build compares the two and rejects
    the deck when they disagree.

    Expect at most one transition in five to qualify, and none at all in a deck
    whose beats are a list of separate findings. Leaving it off is always a
    correct answer.

NARRATION

Every beat carries \`narration\`: what the presenter SAYS while the beat is on
screen. It is speech, not a caption. A voice reads it aloud, so write what a
person standing beside the slide would say, and nothing a person would not.

  - Full sentences in spoken register. No fragments, no bullet grammar, and
    nothing the voice cannot pronounce — say "the loss averaged over the batch",
    not "L_batch"; say "order n squared", not "O(n^2)".
${cadence.sentences}
${cadence.length}
  - Never read the headline back. The audience has already read it. Say the thing
    the slide does not show: why it works, what it costs, what to notice.
  - Claim what the DATA says, never where a thing sits on the picture. You are
    writing over a diagram you cannot see: the archetype decides the order the
    bars, rows, stages and layers are drawn in, a short format drops the beats it
    does not keep, and none of that is visible from here. So "the second largest"
    — which is checkable against your own params — and never "second from the
    top", which is a guess about a rendering. The same goes for "above", "below",
    "on the left", "the third one along" and "the rightmost bar". A viewer who
    hears a position looks at the wrong thing, and the deck contradicts itself in
    the one place nothing verifies: out loud.
  - No "as you can see", "in this slide", "here we have", "let us take a look",
    "moving on". The deck does not narrate itself; it explains a subject.`;

/**
 * What each register means where it lands: the headline and the spoken line. A
 * one-word instruction ("punchy") gets a plausible-sounding average deck, so each
 * tone is spelled out in terms of the two things the model actually writes.
 *
 * Only the chosen line is sent. Showing the model all four invites it to blend
 * them, and the three it did not ask for are tokens spent on nothing.
 */
const TONES: Record<Prefs["tone"], string> = {
  plain:
    "state the claim in ordinary words, and narrate in short declarative sentences with no flourish and no metaphor the source did not use.",
  academic:
    "name the mechanism or the measured result exactly and hedge precisely as much as the source does; narration keeps the technical vocabulary and defines each term once, the first time it is spoken.",
  conversational:
    'address the audience directly and may say "you"; narration uses contractions, short sentences and the occasional aside, like explaining it to a sharp colleague at a whiteboard.',
  punchy:
    "are short and load-bearing — cut every word the claim survives losing; narration leads with the verb, one hard sentence per reveal, no wind-up.",
};

/** How much text a slide may carry before the point should have been a diagram. */
const DENSITIES: Record<Prefs["density"], string> = {
  sparse:
    "one idea on screen. A headline, the visual, and at most two short labels or lines. Three stages, not six. If the point needs more words than that, it needed a different visual.",
  normal:
    "a headline, the visual, and the few labels the visual needs to be readable. Notes are phrases, not sentences.",
  dense:
    "a slide may carry the full set — every stage noted, every bar labelled, a note line under the visual. The moment it reads as a paragraph it should have been a diagram, or two beats.",
};

/**
 * ONE SENTENCE PER REVEAL is what a deck with all the time in the world wants,
 * and it is why the demo says 195.9 seconds of things over 12 slides. A duration
 * target cannot be met by shortening those 37 sentences — 60 seconds over 37
 * stops is four words each — so it is met by narrating fewer stops. The lower two
 * densities lean on `planSegments`, which fills the early stops and leaves the
 * rest silent rather than inventing copy for them.
 *
 * The reveal-count table is sent ONLY at `high`, where it is the constraint. At
 * the other two it would be telling the model to count something it must not use.
 */
function cadenceFor(prefs: Prefs, plan: DurationPlan): Cadence {
  // WHAT WAS HERE, and why it is gone. At `low` this said "ONE SENTENCE PER
  // BEAT", justified by "THAT SENTENCE IS HEARD OVER THE BEAT'S FIRST FRAME,
  // before the stages, panels or layers after the first have been drawn."
  //
  // That reason is FALSE, and has been since §11: the voice now starts when the
  // headline lands and runs continuously while the reveals play underneath it.
  // Nothing removed the rule when its reason went, so the planner went on being
  // told to write one self-contained line per slide — and it did, twelve times,
  // and the result narrates slide by slide instead of explaining anything. The
  // owner: "they don't explain the paper well and they don't have a flow. just
  // sentence by sentence."
  //
  // The count is now DERIVED from what the beat's seconds can hold
  // (`durationPlan.sentences`), because that is the thing that actually decides
  // whether a beat can hold a paragraph — see `SENTENCES_PER_BEAT`.
  const n = plan.sentences ?? (prefs.narration.density === "medium" ? 2 : 1);
  const sentences =
    prefs.narration.density === "high"
      ? `  - ONE SENTENCE PER REVEAL, in reveal order, separated by a single space. A beat
    lands and then reveals its stages, terms, notes, bars or layers one at a time,
    and the audio is cut sentence by sentence across those stops — so the first
    sentence covers the beat arriving and each later sentence belongs to the thing
    that appears next. Get the count wrong and the voice runs ahead of the
    animation, systematically, for the whole beat.
${REVEAL_COUNTS}`
      : `  - ${n === 1 ? "ONE SENTENCE" : `${n} SENTENCES`} FOR THIS BEAT, spoken as ONE CONTINUOUS TAKE. The voice starts the
    moment the headline lands and runs to the end of the beat without a pause you
    can hear, and the beat's reveals play underneath it. The picture is still
    assembling while you talk.
  - THE DECK IS ONE SCRIPT, NOT ${prefs.slides} CAPTIONS. Read your narration end to end,
    ignoring the slide boundaries: it has to work as a single spoken paragraph
    that argues from the problem to the idea to the evidence to the cost. So a
    beat's line continues the one before it — it may open with a pronoun, a
    consequence or a contrast, and it must not restate what the previous line
    already established.
  - THE WORST THING YOU CAN WRITE is a line that would read identically if the
    other beats did not exist. "The carrier keeps spatial detail while thought
    stays compact." is a caption: true, self-contained, and it explains nothing
    that the slide has not already drawn. Compare a line that knows what came
    before: "That carrier is what lets the thought block stay small — it holds
    the picture so the thinking does not have to."
  - LEAD WITH WHAT IS DRAWN FIRST. The beat reveals its stages, layers and notes
    one at a time, in the order you list them in \`params\`, and the voice starts
    before the first one has landed. So the first thing your narration names must
    be the first thing the beat draws, and a part must not be named before it
    appears.
    You control both lists, so make them agree — reorder \`params\` to match what
    you want to say, or say it in the order the picture arrives. "The decoder
    reassembles what the bottleneck kept" over stages listed Encoder,
    Bottleneck, Decoder names the third stage while the first is still drawing;
    either open on the encoder, or list the stages in the order you say them.
    BARS ARE NOT IN THIS RULE, and the example that used to be here was a bar
    example that did not clear its own gate. A bar chart is TWO reveals however
    many bars it has — the reveal table above says so — so the bars land
    together and naming the fourth one first costs the viewer nothing.`;

  // A character count, not a word count, because the budget is seconds of speech
  // and characters per second is the thing that was measured. Both are given: the
  // seconds are the reason, and a reason is what the model holds onto.
  //
  // A RANGE, NOT A CEILING. "Keep each sentence to about N characters" was read
  // as a limit to stay safely under: against a 47-character budget a real run
  // wrote 40.1 on average, and against 66 it wrote 51.1 — 77% of what it was
  // given, both times. The seconds are reserved whether or not they are used, so
  // an under-length sentence buys the deck nothing and spends the difference on
  // silence. The floor is what makes that cost legible.
  //
  // It also used to end "there is no way to say it faster", which stopped being
  // true when `durationPlan` started deriving the speaking rate. The budget below
  // is already the fast-speech budget; saying otherwise told the model to solve a
  // constraint that had been solved for it.
  // THE BUDGET IS THE BEAT'S, NOT ONE SENTENCE'S, and conflating the two shipped
  // a real defect: at a 300-second target over twelve slides the prompt said
  // "ONE SENTENCE PER BEAT" in one bullet and "each sentence runs 290-341
  // characters" in the next, which is an instruction to write a 341-character
  // sentence. Now the beat gets a total and a sentence count, and dividing is
  // the model's business.
  //
  // AND IT IS THE BUDGET AT THE REQUESTED COUNT, because that is the only count
  // that exists while the prompt is being written. The beat count and this
  // character count are ONE budget, not two independent targets: `durationPlan`
  // restrikes both at whatever the plan comes back with, so returning ten beats
  // against a twelve-beat request does not shorten the video, it makes each of
  // the ten owe more characters than the number printed here. The LENGTH block
  // in `systemPrompt` is where that is said out loud, because it is the argument
  // for writing every beat rather than a note about arithmetic.
  const floor = plan.chars === undefined ? 0 : Math.round(plan.chars * 0.85);
  const length =
    plan.chars === undefined
      ? "  - Keep each sentence to about 25 words. It has to be said in one breath."
      : `  - This beat's narration runs ${floor}-${plan.chars} characters IN TOTAL across its
    ${n === 1 ? "one sentence" : `${n} sentences`}, and you should write to the TOP of that range. It is spoken in
    ${plan.speechSeconds}s${plan.rate === "+0%" ? "" : ` at a ${plan.rate} speaking rate`}, and those seconds are reserved whether you use them or
    not — narration that comes in short does not make the deck shorter, it makes
    the slide sit in silence. Under ${floor} the slide captions instead of explaining,
    which is the most common way this goes wrong. Over ${plan.chars} is what makes a deck
    miss its duration.`;

  return { sentences, length };
}

/**
 * Sent only when images are on, and nothing above changes when they are off:
 * RULE 2 still says a dangling id fails the build, and the inventory still says
 * a figure-less source allows no claim-figure. This block is the one exception
 * to both, stated once, so it must be absent whenever the exception does not
 * apply — a deck that never asked for a picture is planned from the same prompt
 * it always was.
 */
function illustrations(images: Prefs["images"]): string {
  return `

ILLUSTRATIONS

A claim-figure, or either side of a split-compare, may carry
\`illustration: { prompt, caption }\` INSTEAD of \`figureId\` when no figure in
the inventory fits the point — including when the inventory has no figures at
all. A picture is generated from the brief after planning and shown where the
figure would have been. This is the one exception to RULE 2: a brief cites
nothing, so it can never dangle.

  - \`prompt\` describes a SCENE — the objects, their arrangement, the mood — and
    never asks for text, labels, numbers, charts or diagrams. Nothing inside a
    picture can be read or checked: the 40px floor sees DOM text only, so a
    number in a picture is one nobody can verify and nobody can read from the
    back of the room. Anything that must be read goes in the caption, the
    claim or the lines.
  - \`caption\` is the line the audience reads with the picture.
  - The picture ILLUSTRATES; it is not evidence. \`evidence\` still cites the
    section the beat is accountable to, never the picture.
  - Write \`figureId\` OR \`illustration\`, never both. A figure in the
    inventory always wins over a brief for one.
  - At most ${images.max} pictures in the whole deck; a split-compare with two
    briefs spends two. Past that, find the point's shape and draw it.`;
}

/**
 * The rules, then the preferences the person asking for the deck chose. They go
 * last because they are the part the model is most likely to drift from, and the
 * end of a prompt is the part it holds hardest.
 */
export function systemPrompt(prefs: Prefs): string {
  // THE REQUESTED COUNT, and it has to be — this builds the prompt, so the plan
  // whose beat count would restrike the budget does not exist yet. Every other
  // caller passes `storyboard.beats.length` (see `durationPlan`'s header) and
  // someone will eventually try to "fix" this one to match. It cannot be fixed;
  // what it can be is honest, which is why the LENGTH block below now says the
  // budget is restruck on whatever comes back.
  const plan = durationPlan(prefs);
  return `${rules(cadenceFor(prefs, plan))}${prefs.images.enabled ? illustrations(prefs.images) : ""}

PREFERENCES — chosen by the person who asked for this deck.
${
  prefs.duration === undefined
    ? ""
    : `\nDURATION   The finished video runs about ${prefs.duration} seconds. That budget is already
           spent below: it is where the ${prefs.slides}-beat floor and the sentence length
           come from. Do not restate it, and never mention it in a beat.
${
  (plan.beatSeconds ?? 99) > FF_BEAT_SECONDS
    ? ""
    : `
FORMAT     This is a CONFERENCE FAST-FORWARD TALK — the one-minute teaser an author
           gives to make the room want the full session. ${prefs.slides} slides in
           ${prefs.duration} seconds is about ${(plan.beatSeconds ?? 0).toFixed(0)} seconds each, and the voice runs at
           ${plan.rate}, roughly 180 words a minute. That is the format, not an accident,
           so write for it: every second carries a word, every slide carries a
           picture, and the whole thing is ONE breathless argument that still
           lands. Compress by cutting hedges and restatement, never by cutting
           the story — the viewer must come away knowing the problem, the idea,
           what it costs, and what was measured.
`
}`
}
LENGTH     Write ${prefs.slides} beats. ${prefs.slides} is a FLOOR — not a ceiling, and not a target to
           come close to. Four of the last five plans came back short of it, and a
           plan that comes back short is now reported as having missed it.${
             prefs.duration === undefined
               ? `
           Each beat you leave out is a piece of the explanation the viewer never
           gets.`
               : `
           BEING SHORT DOES NOT MAKE THE VIDEO SHORTER. The ${prefs.duration}-second budget is
           restruck on however many beats you return, so the seconds of a beat you
           leave out are handed to the beats that survive — and each of those then
           has to carry MORE than the ${plan.chars ?? 0} characters budgeted above, which is not
           what you will have written. What a short plan costs is points, not
           length: ${prefs.slides} slides' worth of explanation delivered as fewer.`
}
           What is still forbidden is PADDING to reach it: a beat restating an
           earlier one, a divider nobody needed, a visual repeated to say one more
           small thing. Those cost more than being short does. So when the source
           looks as though it will not carry ${prefs.slides} distinct points, split a point that
           has two halves — that is the way to the number, and dropping one is not.
LANGUAGE   Write every word the audience sees or hears in ${languageName(prefs.lang)}:
           headlines, eyebrows, claims, labels, notes, and every narration
           sentence. Write it in that language rather than translating an English
           draft, using the terms a specialist writing in it would use, and leave
           proper nouns and established technical terms in their usual form.
TONE       ${prefs.tone} — headlines ${TONES[prefs.tone]}
DENSITY    ${prefs.density} — ${DENSITIES[prefs.density]}

Set sourceId and title from the source header, and lang to the language above.
Omit theme — the renderer chooses it. Return the storyboard only.`;
}

/**
 * The default prompt, for callers that have no preferences in hand. Kept so the
 * planner's other entry points keep working unchanged.
 */
export const SYSTEM = systemPrompt(prefsSchema.parse({}));

/**
 * "ko" is a tag, "Korean" is a language. The model handles either, but the name
 * is what makes the instruction unambiguous when the tag is regional ("pt-BR").
 * Unknown tags fall through to the tag itself rather than failing a plan.
 */
function languageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
    return name && name !== tag ? `${name} (${tag})` : tag;
  } catch {
    return tag;
  }
}

/** The document plus every id the model is allowed to cite, and nothing else. */
export function renderSource(source: Source): string {
  const out = [
    `SOURCE ${source.id}`,
    `TITLE ${source.title}`,
    `LANG ${source.lang}`,
    "",
    "== DOCUMENT ==",
  ];

  for (const section of source.sections) {
    out.push("", `${"#".repeat(section.depth)} ${section.heading}    [section ${section.id}]`);
    if (section.text.trim()) out.push(section.text.trim());
  }

  out.push("", "== FIGURES ==");
  for (const f of source.figures)
    out.push(`[figure ${f.id}] ${f.width}x${f.height} — ${f.caption}`);
  if (!source.figures.length)
    out.push("(none — no annotated-figure or claim-figure beat is possible)");

  out.push("", "== EQUATIONS ==");
  for (const e of source.equations)
    out.push(`[equation ${e.id}] ${e.display ? "display" : "inline"} — ${e.tex}`);
  if (!source.equations.length) out.push("(none — no equation-walk beat is possible)");

  out.push("", "== TABLES ==");
  for (const t of source.tables) {
    out.push(`[table ${t.id}] ${t.caption ?? "(no caption)"}`);
    out.push(`  columns: ${t.columns.join(" | ")}`);
    // Rows are rendered in full: `data-table.highlight[].row` must match a
    // first-column value verbatim, so the model has to see them to cite them.
    for (const row of t.rows) out.push(`  row: ${row.join(" | ")}`);
  }
  if (!source.tables.length) out.push("(none — no data-table beat is possible)");

  return out.join("\n");
}
