/** Prompts for the three arms. `renderSource` is copied from src/plan/prompt.ts. */

export function renderSource(source) {
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
  for (const f of source.figures) out.push(`[figure ${f.id}] ${f.width}x${f.height} — ${f.caption}`);
  out.push("", "== EQUATIONS ==");
  for (const e of source.equations)
    out.push(`[equation ${e.id}] ${e.display ? "display" : "inline"} — ${e.tex}`);
  out.push("", "== TABLES ==");
  for (const t of source.tables) {
    out.push(`[table ${t.id}] ${t.caption ?? "(no caption)"}`);
    out.push(`  columns: ${t.columns.join(" | ")}`);
    for (const row of t.rows) out.push(`  row: ${row.join(" | ")}`);
  }
  return out.join("\n");
}

/**
 * The matched task, given verbatim to BOTH the archetype arm and the
 * compositional arm, so the only difference between them is the vocabulary.
 */
export const MATCHED_TASK = `THIS RUN

Produce exactly THREE beats, in this order, and nothing else:

  1. THE METHOD FLOW. The four stages ThinkSR runs an image through — encode,
     window, the DQ-CTM thought process, decode — with the recurrence shown as a
     loop that returns to the thought stage itself, not around the whole flow.
     Note that parameters are shared across ticks.
  2. THE CARRIER EQUATION. Equation eq-carrier, walked one symbol at a time:
     the encoder that turns the low-resolution image into a dense feature field,
     and the window partition that keeps every token.
  3. THE PARAMETER COMPARISON. The five methods in tbl-bench compared on
     parameter count in millions, smallest first, with DQ-CTM-SR distinguished.
     Its 1.129M is the second largest of the five, and the deck must say so
     rather than claim the method is cheap.`;

/** The unpinned task: the same job the shipped planner does, whole deck. */
export const FULL_TASK = `THIS RUN

Explain this source to someone who has not read it. Order it for them: what
problem, what idea, why it works, what it costs.`;

/* ------------------------------------------------------- the compositional arm */

const COMPOSITION_RULES = `You are DeckSmith's planner. You read one source document and return a
COMPOSITION: the ordered scenes of an animated explanation of it, each scene
built out of primitive objects and tweens rather than chosen from a menu.

There are no slide templates. You place every shape yourself and you animate
every shape yourself. This is more work and it is also the whole point: the
picture is whatever the idea needs, not the nearest preset.

THE STAGE

1920 x 1080. All positions and sizes are FRACTIONS of it: x and y run 0 to 1,
and \`at\` is the CENTRE of the object, never its corner. \`size\` is {w, h}, also
fractions. \`fontPx\` is literal pixels at 1920x1080.

Keep everything inside x 0.05-0.95 and y 0.08-0.92. The headline lives around
y 0.12; the drawing occupies roughly y 0.28-0.80.

THE OBJECTS

  text      A run of type. \`text\` carries it, \`fontPx\` sizes it.
  tex       A LaTeX expression. \`tex\` carries it. Rendered by KaTeX.
  rect      A box. Needs \`size\`. \`fill\` is "none", "tone" or "surface".
  ellipse   As rect, but round.
  arrow     A polyline with a head on the last point. Needs \`points\`, at least
            two, in stage fractions, in draw order.
  polyline  As arrow, without the head. Use for a feedback path that loops back.
  image     A source figure. Needs \`figureId\` from the inventory, and \`size\`.
  group     Draws nothing itself. Other objects name it as \`parent\`, and a tween
            on the group moves, fades or scales all of them together.

Every object carries \`tone\`: "a", "b", "c", "d" pick the theme's accent colours,
"muted" is the low-emphasis grey. \`opacity\` is the object's state at t = 0,
BEFORE any tween runs — so an object that fades in must start at 0.

THE TWEENS

Each entry in \`anims\` is one tween on one object over the window
[start, start + dur). It is a fromTo: the property is at its start value for
every t at or before \`start\`, at its end value for every t at or after
\`start + dur\`, and interpolated between.

  fadeIn      opacity 0 -> 1.
  fadeOut     opacity 1 -> 0.
  draw        stroke drawn from its first point to its last. arrow, polyline and
              rect only — there is no stroke to draw on text or an image.
  growFrom    scale one axis from 0 to full. \`anchor\` says which edge it grows
              out of: a bar rising from a baseline is anchor "bottom". rect and
              ellipse only.
  moveTo      \`toPos\` is the new centre, in stage fractions.
  scaleTo     \`to\` is the new scale factor; 1 is unchanged.
  recolor     \`toTone\` is the new tone.
  highlight   Emphasise one part of a \`tex\` object. \`part\` is a substring of
              that object's \`tex\`, verbatim, and it must actually occur in it.
  countTo     Roll a number on a \`text\` object from \`from\` to \`to\`.
  morphInto   \`toObject\` names another object in the same scene; this one
              becomes it. Both must exist.

CRITICAL — the render seeks, it does not play. A frame is produced by setting an
absolute time and reading the scene. There is no clock, no per-frame callback and
no event. Every visible change must therefore be a tween in \`anims\` with a real
start and duration. A property nothing tweens keeps its authored value forever.

TIMING

\`seconds\` is the scene's whole length. Every tween must satisfy
start + dur <= seconds. \`holds\` are the absolute seconds inside the scene where
the render freezes so the voice can speak — one hold per reveal, each placed
AFTER the tween it belongs to has finished, and every hold within [0, seconds].
The first hold is the beat landing; each later one is the next thing appearing.

WHAT MAKES A COMPOSITION WRONG

A schema cannot catch any of these and they are the failures that actually
happen. Check each one before you answer.

  - A tween whose \`target\` is not an object id in the same scene.
  - A \`parent\` or a \`toObject\` that names no object.
  - A tween that runs past \`seconds\`, or a hold outside [0, seconds].
  - Two objects on top of each other. Lay the scene out on a grid and give every
    label its own space; overlapping boxes are the commonest way this goes wrong.
  - Anything outside the stage, or a bar whose height puts its top above y 0.
  - An object that starts at opacity 0 and is never faded in. It is invisible for
    the whole scene, and nothing will tell you.
  - Two tweens changing the same property of the same object over overlapping
    windows.
  - \`draw\` on text, \`growFrom\` on text, \`highlight\` on something that is not a
    tex object.
  - Audience text below 40px. That is a hard floor, and it applies to every
    label, note and axis tick, not just the headline. Headlines are 72-96px,
    labels 44-56px.

CONTENT RULES

1. Every id you cite — figureId, and every evidence id — must appear in the
   inventory below. A dangling id fails the build.
2. Be faithful. Never invent a number, a stage, a bar or a baseline the source
   does not state.
3. Read at 1920x1080 from across a room. Headlines under 60 characters, claims
   under 140, labels under 48. No paragraphs.
4. Scene ids are short stable lowercase slugs: "s01-flow".
5. A headline is a complete-sentence claim in sentence case, not a label.
6. Weight honestly: 0.8 and above only for scenes the explanation breaks without.
7. Never make a scene about the source, the plan, or your own constraints.

NARRATION

Every scene carries \`narration\`: what the presenter SAYS while it is on screen.
It is speech, not a caption.

  - Full sentences in spoken register. Nothing the voice cannot pronounce — say
    "order n squared", not "O(n^2)".
  - ONE SENTENCE PER HOLD, in order, separated by a single space. A scene with
    five holds wants five sentences. Get the count wrong and the voice runs
    ahead of the animation.
  - About 25 words a sentence.
  - Never read the headline back.
  - Claim what the DATA says, never where a thing sits on the picture. No
    "above", "on the left", "the rightmost bar".
  - No "as you can see", "in this slide", "here we have".`;

export function compositionPrompt(source, task = MATCHED_TASK) {
  return `${COMPOSITION_RULES}

${task}

PREFERENCES — chosen by the person who asked for this deck.

LENGTH     Aim for about ${task === MATCHED_TASK ? "3" : "11"} scenes.
LANGUAGE   English.
TONE       plain — headlines state the claim in ordinary words, and narration is
           short declarative sentences with no flourish.
DENSITY    normal — a headline, the drawing, and the few labels the drawing needs.

Set sourceId and title from the source header, and lang to the language above.

Do not search the web and do not read files. Everything you need is below.
Return the composition as your final message, conforming to the supplied schema.

${renderSource(source)}`;
}
