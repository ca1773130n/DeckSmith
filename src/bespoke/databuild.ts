/**
 * DATA BUILDS: how a data beat's chart comes on, chosen per beat so no two
 * data beats of a deck build alike.
 *
 * WHY. Round 4 drew data beats as clean charts that build — and every one of
 * them built the same way: bars grow from zero while their counters count up,
 * no camera. An explainer varies the verb with the point: a ranking RACES, a
 * trend is TRACED with a callout on the moment that matters, a gap is the
 * DELTA highlighted, several series side by side are SMALL MULTIPLES lit one
 * after another. And the camera works on a chart as on a picture: it pushes
 * in on the value the voice names and pulls back for the whole.
 *
 * Each build is checked statically (`checkBuild`): the scene declares it on
 * its root group (`data-build`), carries the marks the build is made of, and
 * moves the camera; the shell stamps it on the scene (`data-ds-build`) so the
 * deck gate (`verify`) refuses two data beats that build alike.
 *
 * ROUND 6 dropped the bar race: bars growing from zero and sliding to their
 * rank are the animated UI the founder called old-fashioned, and `ui_motion`
 * refuses them. A chart's marks stand at their size and come on by drawing or
 * fading; the camera and the voice carry the comparison.
 */

/** A data beat's build. */
export type DataBuild = "line-callout" | "delta" | "small-multiples";

export const BUILDS: readonly DataBuild[] = ["line-callout", "delta", "small-multiples"];

/** Each data archetype's builds, best fit first; every build appears for every archetype. */
const FIT: Readonly<Record<string, readonly DataBuild[]>> = {
  "bar-compare": ["delta", "small-multiples", "line-callout"],
  "line-chart": ["line-callout", "small-multiples", "delta"],
  "data-table": ["small-multiples", "delta", "line-callout"],
};

/**
 * The build for a data beat of `archetype`, given the builds of the data beats
 * before it in deck order: the best fit the deck has not used; past three data
 * beats, the best fit that is not the previous one.
 */
export function chooseBuild(archetype: string, prior: readonly DataBuild[]): DataBuild {
  const order = FIT[archetype] ?? BUILDS;
  const used = new Set(prior);
  const last = prior[prior.length - 1];
  return order.find((b) => !used.has(b)) ?? order.find((b) => b !== last) ?? "delta";
}

/** What each build is, as the prompt says it. */
export const BUILD_NOTES: Readonly<Record<DataBuild, string>> = {
  "line-callout":
    'A LINE DRAWN WITH A CALLOUT. Axes draw on; the line traces left to right (drawSVG on its path) with a dot riding its head; at the point the voice names, the line pauses and a CALLOUT draws on — a ring on the point, a leader, and its value counted in. Put the callout in <g data-callout="1">.',
  delta:
    'HIGHLIGHT THE DELTA. The two (or few) values come on side by side, each standing at its size (it fades or draws on; a bar never grows from zero); then the GAP between them is the subject: a bracket draws across it, the gap fills in the accent, and the difference counts in big beside it. Put the bracket, fill and difference in <g data-delta="1">, and count the difference with a textContent tween.',
  "small-multiples":
    'SMALL MULTIPLES. One small panel per series or condition, three or more, side by side with the same axes; each builds in turn as the voice names it (its mark draws on, its value counts), then all light together for the comparison. Mark every panel <g data-panel="1">.',
};

/** One reason a data scene does not build as asked. */
export interface BuildFinding {
  rule: "data_build";
  message: string;
}

/**
 * Whether a data scene builds as `build` asks: it declares the build on a
 * group, carries the marks the build is made of, animates them the build's
 * way, and moves the camera. Markup and script are the fragment's (token form).
 */
export function checkBuild(
  f: { markup: string; script: string },
  build: DataBuild,
): BuildFinding[] {
  const out: BuildFinding[] = [];
  const bad = (message: string) => out.push({ rule: "data_build", message });
  const m = f.markup.replace(/<!--[\s\S]*?-->/g, "");
  const s = f.script;
  const declared = /\sdata-build\s*=\s*["']([\w-]+)["']/.exec(m)?.[1];
  if (declared !== build)
    bad(
      `this data beat builds as "${build}": declare it on the chart's root group (data-build="${build}")${declared ? `, not "${declared}"` : ""}`,
    );
  const count = (attr: string) =>
    [...m.matchAll(new RegExp(`\\s${attr}\\s*=\\s*["']?1`, "g"))].length;
  if (build === "line-callout") {
    if (!/drawSVG/.test(s)) bad("the line is traced with drawSVG");
    if (count("data-callout") < 1) bad('the callout is a <g data-callout="1">');
  }
  if (build === "delta") {
    if (count("data-delta") < 1) bad('the gap is a <g data-delta="1"> (bracket, fill, difference)');
    if (!/textContent\s*:/.test(s)) bad("the difference counts in (a textContent tween with snap)");
  }
  if (build === "small-multiples" && count("data-panel") < 3)
    bad('small multiples are three or more <g data-panel="1"> panels');
  // The camera works on a chart as on a picture: in on the value named, back for the whole.
  if (!/["'`]#SCENEID-cam(?![\w-])/.test(s))
    bad(
      'the camera ("#SCENEID-cam") never moves: push in on the value the voice names, and come back home for the whole',
    );
  return out;
}

/** The data builds of a deck's kept data scenes, in deck order, and which repeat. */
export function buildRepeats(seq: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of seq) {
    if (seen.has(b)) out.push(b);
    seen.add(b);
  }
  return out;
}
