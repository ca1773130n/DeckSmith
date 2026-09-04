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
  "equation-morph": "2",
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

THE THIRTEEN ARCHETYPES

Nine of them DRAW: they build a vector graphic out of the source's own content
and reveal it stage by stage, so the viewer watches the idea assemble. Four only
describe. The drawing ones are the default. The describing ones are what you
fall back to when a point genuinely has no shape.

DRAWING ARCHETYPES — reach here first

  pipeline       Two to six labelled stages left to right, arrowed, revealed one
                 at a time, with an optional labelled feedback arrow back to an
                 earlier stage. The tell: THINGS HANDED ALONG IN ORDER — a method,
                 a procedure, a training loop, an inference path, any sentence
                 with "then", "next", or "feeds into" in it. Each stage's note
                 carries the concrete thing that happens there: a shape, a count,
                 a rate. If the parts do not hand anything to each other but sit
                 one on top of another, that is stack.

  annotated-figure
                 A figure from the source with leader lines drawn onto it and
                 revealed in turn; notes[].x/y are fractions of the figure's own
                 box. The tell: A PLACE INSIDE A FIGURE YOU CAN POINT AT. If you
                 can say WHERE in the figure the claim lives — and the caption,
                 plus the "the document says" line the inventory prints under it,
                 usually tell you — this beats claim-figure, which just parks the
                 image beside a sentence. Up to five notes, each pointing at one
                 thing.
                 USE \`crop\` — { x, y, w, h }, the same fractions — to make the
                 beat about ONE REGION rather than a whole page. A paper figure is
                 usually several panels drawn to be read at arm's length, and a
                 beat about the third panel should show the third panel: cropped,
                 its internal type is legible from the back of a room, the notes
                 land on something the viewer can actually see, and two beats off
                 the same figure look like two different slides instead of a
                 repeat. Leave it off only when the figure's whole layout is the
                 argument.

  grid           A cols×rows lattice with up to four regions lit in turn. The
                 tell: A FIELD WITH NO ORDER — patches, windows, tokens, tiles,
                 receptive fields, masks, strides, a neighbourhood, a block-sparse
                 pattern. Regions are cell coordinates, so the lattice IS the
                 argument. It is synthetic: for a region of a real image, that is
                 annotated-figure with a \`crop\`.

  bar-compare    Two to eight bars grown from zero in order. The tell: NAMED
                 THINGS MEASURED IN ONE UNIT — speedups, parameter counts, scores,
                 latencies, costs. It is for MAGNITUDES THE EYE COMPARES: the
                 point of the beat is which one is bigger and by how much, and a
                 length carries that where a figure has to be read. If the labels
                 are steps along an axis rather than names — epochs, sizes,
                 sequence lengths — that is line-chart.

  stack          Two to seven layers drawn bottom-up as offset planes. The tell:
                 SOMETHING BUILT ON SOMETHING — a layered architecture, a protocol,
                 a hierarchy of representations, a system diagram whose point is
                 what sits above what. Nothing moves along it: the relation is ON
                 TOP OF, not THEN, which is what makes it not a pipeline.

  split-compare  Two labelled halves, each a figure or a few short lines. The
                 tell: TWO OF SOMETHING, HELD SIDE BY SIDE — before/after,
                 baseline/ours, with/without, naive/proposed. The contrast is the
                 point, so give both halves the same shape. If the whole contrast
                 is two numbers in one unit, that is bar-compare with two bars.
                 AT MOST ONE OF THE TWO HALVES IS A FIGURE when the figure has
                 panels inside it. A half is under half the canvas wide, so a
                 seven-column grid put there draws its own labels at about 11px —
                 unreadable, and invisible to every check, because text inside an
                 image is not text anything here can measure. Give a dense figure
                 a slide of its own (claim-figure), or point into one region of
                 it (annotated-figure with \`crop\`), and put words in the other
                 half.

  equation-walk  An equation, then its symbols lit one at a time. The tell: THE
                 POINT IS THE EQUATION — a definition, a loss, a bound. Each
                 terms[].tex must appear verbatim inside that equation's TeX, and
                 each label says what the symbol means, not what it is called.
                 Four terms maximum; if the equation needs more, it needs two beats.
                 An equation quoted to back a claim someone else is making is
                 evidence under another archetype, not a beat of its own.

  equation-morph One equation becoming the next, the shared terms carried
                 across. The tell: THE SOURCE DERIVES ONE LINE FROM ANOTHER — a
                 substitution, a rearrangement, a special case — and the point
                 is what moved. \`fromId\` and \`toId\` name two equations from
                 the inventory. Each terms[].tex must appear verbatim in BOTH,
                 and travels as one piece; a term in only one of them is
                 dropped. Four terms maximum.

  line-chart     A trend the source states numerically but does not plot. The
                 tell: A QUANTITY MOVING ALONG AN ORDERED AXIS — over length, over
                 scale, over training. Points come from the source's numbers;
                 deltas, if given, are the steps between consecutive points, so
                 there is always one fewer.

DESCRIBING ARCHETYPES — the fallbacks

  title          One headline, with \`eyebrow\` above it and \`sub\` beneath. The
                 tell: THE DECK OPENING, or a genuine change of subject partway
                 through. Not a chapter marker for every heading in the source.
                 On the opening beat all three carry weight and none of them is
                 decoration. \`eyebrow\` PLACES THE WORK in three or four words —
                 the field, the venue, the kind of artifact ("Image
                 super-resolution", "NeurIPS 2024", "An open-weights decoder").
                 \`sub\` states, in ONE line, the problem the work attacks or the
                 claim it lands, so the headline has something to be the answer
                 to. A headline standing alone is a title card, and a title card
                 tells a viewer who has not read the source nothing.

  claim-figure   A claim beside a figure that demonstrates it. The tell: A FIGURE
                 THAT ARGUES AS A WHOLE and has nothing worth pointing at inside
                 it — otherwise annotated-figure says strictly more, and cropped
                 to the part that matters it says more still. params.figureId
                 must name a figure in the inventory.

  data-table     A table from the source, with up to four of its rows toned and
                 held in turn. The tell: CELLS THAT MUST BE READ RATHER THAN
                 COMPARED — mixed units, text values, a decision matrix, an
                 ablation whose columns are not one quantity. The viewer READS a
                 cell here rather than measuring it against the cell beside it,
                 and a table of text values is this archetype however long the
                 table is.
                 SO NAME THE ROWS THAT CARRY THE ARGUMENT, in \`rows\` —
                 first-column values, the same way highlight names them. The
                 slide then draws those rows and states on itself how many it
                 left out, which is what lets a twenty-row table be cited as the
                 four rows it is being cited for. Without \`rows\` every row is
                 drawn, which a 16:9 slide holds five to seven of: fewer under a
                 long headline or a two-line note, more in portrait or where
                 wider columns set the type smaller. A table that fits neither
                 whole nor as the rows you named is refused rather than shrunk,
                 which fails the build. params.tableId must name a table, and
                 each rows[] and highlight[].row must match one of that table's
                 first-column values exactly.
                 THE CELLS MUST BE SHORT, and this is the constraint that
                 actually decides whether a table can be drawn. Cells do not
                 wrap — a table whose cells wrap has stopped being scannable —
                 and nothing is set below the 40px floor, so ONE ROW's
                 cells together have about 80 characters across four columns,
                 fewer across more. \`rows\` buys height, never width: naming four
                 rows of a table whose cells are sentences refuses just as the
                 whole table does. A matrix of phrases is this archetype; a
                 matrix of sentences is callout panels, or split-compare, or a
                 claim in the words the row would have used.

  callout        One to three short panels. The tell: STRUCTURE WITH NO SHAPE AT
                 ALL — a definition, the limitations the source admits to. The
                 last resort, and lines are phrases rather than sentences. It is
                 not a place to dump bullets you could not find a visual for — a
                 contrast is split-compare, a sequence is pipeline, layers are
                 stack.

RULES

1. Ask what the beat DRAWS before you ask what it says. Read the point, find its
   shape — a sequence, a field, a magnitude, a stack, a contrast, a figure worth
   pointing into — and pick the archetype that draws that shape. Only when a point
   honestly has no shape does it become a title, a claim-figure, a data-table or a
   callout. A deck of headlines and bullet panels is a failure even if every
   sentence in it is true; it is what every other slide generator already makes.
   Most beats in a good deck draw something.

   AND VARY THE SHAPE. Do not use the same archetype for two beats in a row, and
   where a point could honestly take two shapes, take the family this deck has
   not used yet — a lattice, a stack, a chart, a contrast, a figure pointed into
   are five different pictures and a deck that reaches for one of them twelve
   times has drawn one. Real measured failure: across sixty-five planned beats a
   single archetype took nineteen of them, and the deck it produced looks, slide
   after slide, exactly like every other deck this planner has ever written.
   Reaching for the same shape twice running is the reliable sign that the point
   was not read — it is the last thing that worked, reused.

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

   AND USE THE SOURCE'S OWN WORDS FOR THE THINGS IT NAMES. The work, its method,
   the parts of that method, the datasets and the measures keep the names the
   source gives them, spelled the way the source spells them. A part you rename
   is a part the viewer cannot find again in the paper, and a generic stand-in —
   "the model", "the module", "the score" — throws away the one thing that makes
   this deck about THIS work rather than about research in general. Define each
   term the first time it is used, in the same breath, in a clause short enough
   to leave the headline inside its character cap: the definition usually belongs
   in the narration or in a stage note, and the name alone belongs on the slide.

4. Weight honestly. Short formats keep only the highest-weighted beats, so a 0.9
   on a detail costs the deck its spine. Reserve 0.8 and above for beats the
   explanation is broken without; give supporting detail 0.3-0.5.

5. The deck is read at 1920x1080 from across a room, and the type scale is what
   sets the caps. Measured across the 1700px content box: a 64px headline line
   holds 53 characters, a 50px claim 68, a 40px callout line about 39 in a
   two-panel row. So headlines under 80 characters — one full line and a short
   second, which is what fits without a third — claims under 160, callout lines
   under 54. Stage and layer labels stay under 48: they sit inside stage boxes
   and label gutters that the type scale does not widen. No paragraphs.

6. EARN THE MECHANISM FIRST. The opening beats establish what problem exists, who
   has it, and what it costs them today — in the viewer's own terms, before a
   single stage, layer, symbol or component appears. A viewer who does not yet
   know why the work matters cannot tell a good mechanism from an arbitrary one,
   so every beat spent on machinery before that is spent on somebody still
   working out what the deck is for. Then the rest of the arc, in this order:
   what the idea is, why it works, what was measured, what it costs. A deck
   that opens on architecture has skipped the only part of the story the
   audience did not already have. Length is set under PREFERENCES.

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
  // PLAIN IS THE SENTENCES, NOT THE VOCABULARY, and saying only the first half
  // was how the DEFAULT tone came to mean generic. The naming requirement is
  // RULE 3's and is sent whatever the register; what changes here is the grammar
  // wrapped around the names, which is the thing a register actually is.
  plain:
    "state the claim in ordinary words — plain SENTENCES, never a plainer word swapped in for a name the source uses — and narrate in short declarative sentences with no flourish and no metaphor the source did not use.",
  academic:
    "name the mechanism or the measured result exactly and hedge precisely as much as the source does; narration carries the qualifications with the claim rather than after it.",
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
           the story: RULE 6's arc is what a minute has to deliver, not what a
           minute excuses you from.
`
}`
}
LENGTH     Write ${prefs.slides} beats. ${prefs.slides} is a FLOOR — not a ceiling, and not a target to
           come close to. LOOK FOR THEM IN THE SOURCE'S OWN SUBSTANCE: its prose,
           and the figures, tables and equations its authors thought worth
           drawing. A plan that comes back with fewer beats has usually stopped
           looking rather than run out, and it is reported as having missed the
           floor. Four of the last five came back short.${
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
           small thing. Those cost more than being short does. The way to ${prefs.slides} is to
           SPLIT a point that has two halves, never to say one of them twice.
LANGUAGE   Write every word the audience sees or hears in ${languageName(prefs.lang)}:
           headlines, eyebrows, claims, labels, notes, and every narration
           sentence. Write it in that language rather than translating an English
           draft, using the terms a specialist writing in it would use, and leave
           proper nouns and established technical terms in their usual form.
TONE       ${prefs.tone} — headlines ${TONES[prefs.tone]}
DENSITY    ${prefs.density} — ${DENSITIES[prefs.density]}

Set sourceId from the source header and lang to the language above. Omit theme —
the renderer chooses it.

THE DECK'S \`title\` IS NOT THE SOURCE'S TITLE. Write it for a viewer who has not
read the source and is deciding whether to keep watching: name what the work is
about in their terms — what it does, or what it fixes. The paper's own headline
was written for people already inside the field, and it is a string they can
read on the paper; repeating it here spends the one line that could have told
them why to stay. Copying it is measurable — fifty-two stored runs produced ONE
distinct title.

Return the storyboard only.`;
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

/**
 * The document plus every id the model is allowed to cite, and nothing else.
 *
 * The figure block carries two facts beyond the caption — the section the image
 * sat under and the prose that refers to it — because a planner that cannot see
 * the picture has nothing else to decide what the picture is FOR.
 */
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
  if (!source.figures.length) {
    out.push("(none — no annotated-figure or claim-figure beat is possible)");
  } else {
    const n = source.figures.length;
    // The count as a fact, said once. What to DO about a figure is RULE 2's job;
    // this line exists so the model can notice it has planned around three of
    // four pictures, which it cannot do from a list it never counted.
    out.push(`${n === 1 ? "1 figure" : `${n} figures`} in this document.`);
    const headings = new Map(source.sections.map((s) => [s.id, s.heading]));
    for (const f of source.figures) {
      out.push("", `[figure ${f.id}] ${f.width}x${f.height} — ${f.caption}`);
      const heading = f.sectionId === undefined ? undefined : headings.get(f.sectionId);
      // WHERE IT SITS, then WHAT THE DOCUMENT SAYS ABOUT IT. The model cannot
      // see the image; these two lines are everything it has for deciding which
      // point the picture belongs to, and without them the only usable signal
      // was a caption, which says what a figure is and never what it is for.
      if (f.sectionId !== undefined) {
        out.push(`  under: [section ${f.sectionId}]${heading ? ` ${heading}` : ""}`);
      }
      if (f.mention) out.push(`  the document says: ${clip(f.mention)}`);
    }
  }

  out.push("", "== EQUATIONS ==");
  for (const e of source.equations)
    out.push(`[equation ${e.id}] ${e.display ? "display" : "inline"} — ${e.tex}`);
  if (!source.equations.length)
    out.push("(none — no equation-walk or equation-morph beat is possible)");

  out.push("", "== TABLES ==");
  for (const t of source.tables) {
    out.push(`[table ${t.id}] ${t.caption ?? "(no caption)"}`);
    out.push(`  columns: ${t.columns.join(" | ")}`);
    // Rows are rendered in full: `data-table.rows` and `highlight[].row` both
    // match a first-column value verbatim, so the model has to see every row in
    // order to name the ones its beat draws. Printing all of them is what makes
    // a table longer than a slide usable rather than merely visible — the subset
    // is chosen from what is listed here.
    for (const row of t.rows) out.push(`  row: ${row.join(" | ")}`);
  }
  if (!source.tables.length) out.push("(none — no data-table beat is possible)");

  return out.join("\n");
}

/**
 * A referencing paragraph, cut to the part that says what the figure is for.
 *
 * The whole paragraph is already in `== DOCUMENT ==` above, so what is worth
 * paying for here is proximity to the id, not a second copy of the prose. Cut on
 * a space so the line ends on a word rather than mid-token.
 */
function clip(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}
