/**
 * SECTION COVERAGE: a plan of an analysis covers every part the analysis has,
 * in the order a talk covers them.
 *
 * The measured failure (2026-10-10, the EM-SNN ko deck): the source is a paper
 * analysis with sections Q1 problem, Q2 related work, Q3 method, Q4 experiments,
 * Q5 future directions, Q6 summary, Q8 limits. The plan opened on a title,
 * spent twelve beats on the method and the numbers, and closed on one callout:
 * the problem got the title slide only, and the related work, the future
 * directions and the summary got nothing. Nothing checked, so nothing said.
 *
 * So the parts are DETECTED from the headings, generically — a lexicon over
 * en/ko/ja/zh heading words, not this paper's Q-numbers — and the plan is held
 * to them the way `variety.ts` holds it to its shapes: `codexPlanner` sends a
 * plan that misses one back once, naming what is missing, and refuses the
 * repair if it still does.
 *
 * WHAT IT DOES NOT DO. It never decides a document is a paper analysis from one
 * lucky word: fewer than `MIN_PARTS` distinct parts and the check is off, and
 * every deck planned before this is planned as it was (the same caution
 * `prefs.genre` records about heading lexicons in general). A heading the
 * lexicon does not know is not required; it is still in the source, and the
 * planner may cover it where it fits.
 *
 * Also here, because they share the repair round: the literal-scene truth
 * gate (a number on screen the source never states, an op parameter not
 * stated IN ITS ROLE, a variant the source never names, example material
 * without its tag, a formula its table does not bear out, a picture that
 * names a beat with no picture).
 */

import { bespokeRegion } from "../bespoke/scene.js";
import { deckLook } from "../emit/theme.js";
import { drawProblems } from "../literal/check.js";
import { checkPasses, GREEK, normalizeExpr, parseFormula, printed } from "../literal/formula.js";
import { tokenChips } from "../literal/kinds/flow.js";
import { placeForm } from "../literal/kinds/place.js";
import { leavesPicture } from "../literal/kinds/recap.js";
import { tileRatio } from "../literal/kinds-shared.js";
import type {
  Beat,
  BeatPart,
  Literal,
  LiteralKindDoc,
  LiteralOpDoc,
  Source,
  Storyboard,
} from "../types.js";
import {
  beatPartSchema,
  FORMATS,
  GENERATED_FIGURE_PREFIX,
  LITERAL_KIND_DOCS,
  LITERAL_OPS,
  LITERAL_ROLE_NOUNS,
  LITERAL_RULES,
  literalSlotProblems,
  literalSlotsOf,
} from "../types.js";
import { charsPerSecond } from "./duration.js";

/** The order a deck covers its parts in. */
export const PART_ORDER: readonly BeatPart[] = beatPartSchema.options;

/** What each part is, for the prompt and the findings. */
export const PART_NAMES: Record<BeatPart, string> = {
  intro: "introduction / the problem",
  "prior-work": "prior work",
  method: "the method",
  experiments: "experiments (setup and results)",
  limits: "limits and future directions",
  summary: "summary",
};

/**
 * Heading words, per part, TRIED IN THIS ORDER. The order is the point: a
 * heading naming two parts goes to the more specific one — "Limitations of the
 * results" is limits, "How does the paper solve this problem?" is the method
 * and not the problem, "Conclusion and future work" is the summary.
 */
const LEXICON: ReadonlyArray<readonly [BeatPart, RegExp]> = [
  ["summary", /summar|conclu|takeaway|요약|결론|まとめ|結論|总结|结论|總結/i],
  [
    "limits",
    /limitation|\blimits?\b|weakness|future|further|open (question|problem)|한계|향후|탐구|후속|제약|限界|今後|局限|未来|未來|展望|进一步|進一步/i,
  ],
  [
    "prior-work",
    /related work|prior work|previous work|literature|background|existing (work|method|approach)|관련 ?연구|선행 ?연구|기존 ?연구|관련 ?작업|関連研究|先行研究|相关工作|相關工作|相关研究|相關研究/i,
  ],
  ["experiments", /experiment|evaluat|\bresults?\b|benchmark|실험|평가|実験|評価|实验|實驗|评估/i],
  [
    "method",
    /method|approach|architecture|algorithm|\bhow\b.*\b(solve|address|work)|proposed|방법|기법|알고리즘|어떻게|제안|手法|方法|アルゴリズム|算法|提案|提出|如何/i,
  ],
  [
    "intro",
    /introduction|problem|motivation|overview|문제|서론|소개|동기|はじめに|序論|問題|问题|引言|动机/i,
  ],
];

/** Fewer distinct parts than this and the source is not treated as an analysis. */
export const MIN_PARTS = 3;

/**
 * And one of these must be among them. "Overview", "How it works" and
 * "Summary" are three parts of any article; an analysis of a paper also
 * reports what was done before it or what it measured. Without this, a plain
 * article switched the check on and was held to a paper's order (review,
 * 2026-10-10).
 */
const PAPER_PARTS: readonly BeatPart[] = ["prior-work", "experiments"];

/** A back-matter heading, after any "6", "A." or "Appendix A" numbering. */
const BACK_MATTER =
  /^(?:(?:\d+|[A-Z])(?:\.\d+)*\.?\s+)?(?:appendi(?:x|ces)|supplementary|references|bibliography|acknowledge?ments?|부록|참고\s*문헌|감사의\s*글|付録|参考文献|謝辞|附录|致谢)(?![\p{L}\p{N}])/iu;

const REFERENCES =
  /^(?:\d+\.?\s+)?(?:references|bibliography|참고\s*문헌|参考文献)(?![\p{L}\p{N}])/iu;

/** The part a heading names, or undefined. */
export function partOfHeading(heading: string): BeatPart | undefined {
  for (const [part, re] of LEXICON) if (re.test(heading)) return part;
  return undefined;
}

export interface SourcePart {
  part: BeatPart;
  /** Sections of this part that carry text, in source order: each must be cited. */
  sections: Array<{ id: string; heading: string }>;
}

/**
 * The parts this source has, in deck order, or `[]` when it is not an analysis.
 *
 * A section takes its parent's part when the parent has one (the subsections of
 * "Experiments" are experiments, whatever they are called), and its own
 * heading's part otherwise. The document's title heading is not a section of
 * any part. Only sections with text are listed: an empty parent is covered by
 * covering its children.
 *
 * Back matter — an appendix, the references, the acknowledgements — and
 * everything under or after the references is in no part: a talk is not held to its appendix. Two
 * arXiv papers (FlashAttention, Chinchilla; 2026-10-14) each had 32 sections
 * to cite for a 14-slide deck, about half of them appendix, and every plan was
 * refused for missing one or for running long to cite them all.
 */
export function sourceParts(source: Source): SourcePart[] {
  const title = source.title.trim();
  const stack: Array<{ depth: number; part: BeatPart | undefined; back: boolean }> = [];
  const by = new Map<BeatPart, SourcePart["sections"]>();
  const seen = new Set<BeatPart>();
  // What follows the references is appendix, named so or not ("E Experiment Details").
  let after = false;
  for (const s of source.sections) {
    while (stack.length && (stack[stack.length - 1]?.depth ?? 0) >= s.depth) stack.pop();
    const heading = s.heading.trim();
    after ||= REFERENCES.test(heading);
    const back = after || stack.some((e) => e.back) || BACK_MATTER.test(heading);
    const inherited = [...stack].reverse().find((e) => e.part)?.part;
    const own = heading === title ? undefined : partOfHeading(s.heading);
    const part = back ? undefined : (inherited ?? own);
    stack.push({ depth: s.depth, part, back });
    if (!part) continue;
    seen.add(part);
    if (s.text.trim()) by.set(part, [...(by.get(part) ?? []), { id: s.id, heading: s.heading }]);
  }
  if (seen.size < MIN_PARTS || !PAPER_PARTS.some((p) => seen.has(p))) return [];
  return PART_ORDER.filter((p) => by.has(p)).map((p) => ({ part: p, sections: by.get(p) ?? [] }));
}

const sectionsCited = (beat: Beat): string[] =>
  beat.evidence.filter((r) => r.kind === "section").map((r) => r.id);

/**
 * Where a plan departs from the source's parts, as sentences a repair can act
 * on. Empty when the source has no detected parts.
 */
export function coverageFindings(storyboard: Storyboard, source: Source): string[] {
  const parts = sourceParts(source);
  if (!parts.length) return [];
  const out: string[] = [];
  const partOf = new Map<string, BeatPart>();
  for (const p of parts) for (const s of p.sections) partOf.set(s.id, p.part);
  // A title slide names the deck; it covers nothing.
  const body = storyboard.beats.filter((b) => b.archetype !== "title");

  const unlabelled = body.filter((b) => !b.part).map((b) => b.id);
  if (unlabelled.length)
    out.push(
      `Beats ${unlabelled.join(", ")} carry no \`part\`. Every beat but the title names the part of the source it covers.`,
    );

  for (const { part, sections } of parts) {
    const beats = body.filter((b) => b.part === part);
    if (!beats.length) {
      out.push(
        `The source has ${PART_NAMES[part]} (${sections.map((s) => `[section ${s.id}] ${s.heading.trim()}`).join("; ")}) and no beat covers it. Add beats with part "${part}" in its place in the order.`,
      );
      continue;
    }
    const cited = new Set(beats.flatMap(sectionsCited));
    for (const s of sections.filter((s) => !cited.has(s.id)))
      out.push(
        `No "${part}" beat cites [section ${s.id}] ${s.heading.trim()}. Each section of a part is covered by a beat that cites it.`,
      );
  }

  // A beat labelled with a part says what it covers; its evidence must agree.
  // Only for a part the source has: a deck's summary over a source with no
  // summary section (`--genre paper` asks for one) can only cite what it sums up.
  const has = new Set(parts.map((p) => p.part));
  for (const b of body) {
    if (!b.part || !has.has(b.part)) continue;
    const own = sectionsCited(b).filter((id) => partOf.has(id));
    if (own.length && !own.some((id) => partOf.get(id) === b.part))
      out.push(
        `${b.id} is part "${b.part}" but cites only ${own.map((id) => `${partOf.get(id)} sections (${id})`).join(", ")}. Label it with the part it covers, or cite the section it is accountable to.`,
      );
  }

  // The order. Reported once, at the first step backwards.
  const rank = (p: BeatPart) => PART_ORDER.indexOf(p);
  let prev: Beat | undefined;
  for (const b of body) {
    if (!b.part) continue;
    if (prev?.part && rank(b.part) < rank(prev.part)) {
      out.push(
        `${b.id} (part "${b.part}") comes after ${prev.id} (part "${prev.part}"). The deck covers its parts in this order: ${PART_ORDER.join(", ")}.`,
      );
      break;
    }
    prev = b;
  }
  return out;
}

/** The figure ids a beat shows, wherever its params put them. */
function figureIds(beat: Beat): string[] {
  const p = beat.params as Record<string, unknown>;
  return [p, p.left, p.right, p.backdrop].flatMap((v) => {
    const id = (v as { figureId?: unknown } | undefined)?.figureId;
    return typeof id === "string" ? [id] : [];
  });
}

/** A caption that says its figure is a picture of something rather than a chart. */
const PICTURE_CAPTION =
  /qualitative|visuali[sz]|photo|camera|\bviews?\b|\bframes?\b|\bscenes?\b|定性|可视化|视图|画面|정성|시각화|장면|可視化|定性的/iu;

/**
 * Advice for a plan whose source is about pictures: at least three of its own
 * figures are captioned as views, frames or qualitative examples, and no beat
 * runs `region` or `operate`. r1 drew a driving paper's only imagery at 55%
 * width beside text, its panels unreadable, with neither verb used once. Sent
 * back once with the other findings; a plan that still ignores it is kept.
 */
export function pictureFindings(storyboard: Storyboard, source: Source): string[] {
  const pictures = source.figures.filter(
    (f) => !f.id.startsWith(GENERATED_FIGURE_PREFIX) && PICTURE_CAPTION.test(f.caption),
  );
  if (pictures.length < 3) return [];
  const used = storyboard.beats.some(
    (b) => b.literal?.kind === "region" || b.literal?.kind === "operate",
  );
  if (used) return [];
  return [
    `This source is about pictures — ${pictures.length} of its figures are views or examples (${pictures
      .slice(0, 3)
      .map((f) => f.id)
      .join(
        ", ",
      )}…) — and no beat runs \`region\` or \`operate\`. Mark the things a view turns on with \`region\` (each numbered, with what the source says of it), or compute an \`operate\` on a picture.`,
  ];
}

/** Archetypes that draw a beat as words in boxes or columns. */
const WORD_ARCHETYPES = new Set([
  "split-compare",
  "callout",
  "stack",
  "pipeline",
  "grid",
  "kinetic",
]);

/**
 * Advice for a plan that draws its MECHANISM as slideware, sent back once with
 * the other findings (as `pictureFindings` is): r2 never chose \`operate\` or
 * \`evolve\` on two papers and drew their method beats as two bullet columns, a
 * chain of name cards and a 2×2 grid of numbers.
 *
 *  - a beat of part "method" with no \`literal\`, drawn as words, is routed to
 *    the verb its evidence allows: a flow showing a figure it cites, place
 *    curves or evolve on an equation, else operate on example vectors or
 *    evolve (an update over steps, lanes of serial against parallel work);
 *  - a flow chain whose stages are mostly names (no count, figure or layer);
 *  - a beat whose claim states two or more of the source's numbers, drawn as
 *    words, is a place strip, plane or combos;
 *  - a split-compare with two lines or fewer a side is a setup detail: a
 *    caption of the result beat that uses it.
 *
 * Advice, not a refusal: whether a verb is honest for a beat depends on what the
 * source prints, which a heuristic cannot settle; the planner gets one look.
 */
export function slidewareFindings(storyboard: Storyboard, source: Source): string[] {
  const out: string[] = [];
  const stated = sourceNumbers(source);
  for (const beat of storyboard.beats) {
    const lit = beat.literal;
    const words = !lit && WORD_ARCHETYPES.has(beat.archetype);
    if (words && beat.part === "method") {
      const figs = [
        ...figureIds(beat),
        ...beat.evidence.filter((e) => e.kind === "figure").map((e) => e.id),
      ].filter(
        (id) => !id.startsWith(GENERATED_FIGURE_PREFIX) && source.figures.some((f) => f.id === id),
      );
      const eq = beat.evidence.some((e) => e.kind === "equation");
      out.push(
        figs.length
          ? `${beat.id} explains the method as ${beat.archetype} words while it cites ${figs[0]}: draw its mechanism as a \`flow\` chain whose stages show that figure (\`figure\`), mark the things it shows with \`region\`, or draw it with another verb. Words in columns are slideware for a mechanism.`
          : eq
            ? `${beat.id} explains the method as ${beat.archetype} words while it cites an equation: when the source prints values the rule produces, draw it as a \`place\` plane with \`curves\` (one per stated value of the fixed parameter) or an \`evolve\` formula grounded by its checks; a rule over distributions or arrays is \`operate\` on example \`vectors\`.`
            : `${beat.id} explains the method as ${beat.archetype} words. Draw it with a verb: \`operate\` on example \`vectors\` for a rule over distributions or arrays, \`evolve\` for an update over steps or lanes of serial against parallel work — or keep it only if none is honest.`,
      );
    }
    if (lit?.kind === "flow" && lit.form === "chain") {
      const bare = lit.stages.filter(
        (st) => !(st.show || st.figure || (st.shape && tokenChips(st.shape))),
      );
      if (bare.length * 2 > lit.stages.length)
        out.push(
          `${beat.id}'s flow chain is mostly name cards (${bare.map((st) => `"${st.label}"`).join(", ")} hold nothing): give each stage what it holds (a stated count, the source's figure, an earlier computed layer), or draw the mechanism as an \`evolve\` (its steps, or lanes of serial against parallel work).`,
        );
    }
    const nums = ((beat.claim ?? "").match(/\d+(?:[.,]\d+)?/g) ?? []).filter((n) => stated.has(n));
    if (words && beat.part !== "method" && new Set(nums).size >= 2)
      out.push(
        `${beat.id} states ${[...new Set(nums)].slice(0, 4).join(", ")} in its claim and draws them as ${beat.archetype} words: place them — a \`place\` strip (one axis, one dot per setting: an ablation), a plane, or combos.`,
      );
    // A series over steps drawn by the line-chart archetype builds in seconds and then
    // holds still (r3 B s13: 14s under 1% change), its main series unnamed; the place
    // plane steps it on the narration, names each series and leads with the subject.
    if (!lit && beat.archetype === "line-chart")
      out.push(
        `${beat.id} draws a series as a line-chart, which builds in seconds and then stands still while it is spoken. Draw it as \`place\` plane, \`connect\` true, \`reveal\` groups — one group per series named as the source names it, items its rows over the steps — so each series arrives on its sentence and the one the headline names leads.`,
      );
    if (lit?.kind === "place" && lit.form === "sets") {
      const thin = (lit.sets?.rings ?? []).filter((r) => r.items.length < 3);
      if (thin.length)
        out.push(
          `${beat.id}'s place sets has ${thin.map((r) => `"${r.label}" with ${r.items.length}`).join(", ")}: rings of one or two names are two lists of words (r3: two-column name lists). Say them in a caption, or use sets only where each ring holds three or more.`,
        );
    }
    if (!lit && beat.archetype === "split-compare") {
      const p = beat.params as { left?: { lines?: string[] }; right?: { lines?: string[] } };
      if ((p.left?.lines?.length ?? 0) <= 2 && (p.right?.lines?.length ?? 0) <= 2)
        out.push(
          `${beat.id} is a split-compare of two lines a side: a setup detail, not a beat. Say it in the \`caption\` of the result beat that uses it, or draw it with a verb.`,
        );
    }
  }
  out.push(...textShareFindings(storyboard), ...latinWordFindings(storyboard));
  return out;
}

/** Scripts whose deck shows few Latin words: a Latin phrase there is untranslated text. */
const NON_LATIN_LANG = /^(zh|ja|ko|yue|ru|uk|el|ar|he|hi|th)\b/i;

/**
 * Advice: an eyebrow or a scene's slot words left in English in a deck in another
 * script (r3: "SPECULATIVE DECODING" over a Korean scene): two or more Latin
 * words, no letter of another script, not all of them names (an acronym, a model
 * with a digit). Names (items, rows, members) are the source's own and not checked.
 */
export function latinWordFindings(storyboard: Storyboard): string[] {
  if (!NON_LATIN_LANG.test(storyboard.lang ?? "")) return [];
  // A word that reads as a name: an acronym, a model with a digit (NAVSIM, T5-XXL, GPT-4).
  const name = (w: string) => /\d/.test(w) || (w.match(/\p{Lu}/gu)?.length ?? 0) >= 2;
  const latin = (t: string) => {
    const words = t
      .trim()
      .split(/\s+/)
      .filter((w) => /\p{Script=Latin}/u.test(w));
    return (
      words.length >= 2 &&
      !words.every(name) &&
      ![...t].some((ch) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch))
    );
  };
  const out: string[] = [];
  for (const beat of storyboard.beats) {
    const p = beat.params as { eyebrow?: unknown };
    const texts = [
      ...(typeof p.eyebrow === "string" ? [["eyebrow", p.eyebrow]] : []),
      ...(beat.literal?.labels ?? []).map((l) => [l.slot, l.text]),
    ] as Array<[string, string]>;
    for (const [slot, t] of texts)
      if (latin(t))
        out.push(
          `${beat.id}'s ${slot} "${t}" is in English in a ${storyboard.lang} deck. Write it in the deck's language; keep only a name in the source's form.`,
        );
  }
  return out;
}

/** Archetypes that are text and nothing else when they carry no `literal`. */
const TEXT_ARCHETYPES = new Set(["split-compare", "callout", "kinetic", "hero-number"]);
/** The most of a deck's spoken time text-only beats may take. */
export const TEXT_SHARE = 0.2;
/** The longest a kinetic statement may be spoken over, seconds. */
export const KINETIC_SECONDS = 8;

/**
 * Advice against a deck that is mostly text: r3 opened one deck with 75s of
 * bullet columns, held kinetic statements at 2–11% fill for 22–29s, and spent
 * about a third of its runtime on split-compare, callout, kinetic and
 * hero-number. Measured by the narration each beat speaks (its characters at the
 * deck language's speaking rate): text-only beats at most `TEXT_SHARE` of it,
 * never two in a row, and a kinetic beat at most `KINETIC_SECONDS`.
 */
export function textShareFindings(storyboard: Storyboard): string[] {
  const out: string[] = [];
  const cps = charsPerSecond(storyboard.lang ?? "en");
  const len = (b: Storyboard["beats"][number]) => [...(b.narration ?? "")].length;
  const total = storyboard.beats.reduce((a, b) => a + len(b), 0);
  if (!total) return out;
  const text = storyboard.beats.filter((b) => !b.literal && TEXT_ARCHETYPES.has(b.archetype));
  const share = text.reduce((a, b) => a + len(b), 0) / total;
  if (share > TEXT_SHARE)
    out.push(
      `Text-only beats (${text.map((b) => `${b.id} ${b.archetype}`).join(", ")}) take ${Math.round(100 * share)}% of the spoken time; keep them under ${Math.round(100 * TEXT_SHARE)}%. Draw the rest with a verb, or fold a text beat into the caption of the beat that shows its point.`,
    );
  storyboard.beats.forEach((b, i) => {
    const prev = storyboard.beats[i - 1];
    if (prev && text.includes(b) && text.includes(prev))
      out.push(
        `${prev.id} (${prev.archetype}) and ${b.id} (${b.archetype}) are two text-only beats in a row. Draw one of them with a verb or a figure.`,
      );
    if (!b.literal && b.archetype === "kinetic" && len(b) / cps > KINETIC_SECONDS)
      out.push(
        `${b.id} is a kinetic statement spoken for about ${Math.round(len(b) / cps)}s; a kinetic beat holds at most ${KINETIC_SECONDS}s. Cut its narration to one or two sentences, or show the problem it states (an \`evolve\`: lanes of the serial steps, or the state step by step).`,
      );
  });
  return out;
}

/** Whether a beat carries a picture a literal scene can run on: a figure or a brief for one. */
function hasPicture(beat: Beat): boolean {
  const p = beat.params as Record<string, unknown>;
  const slot = (v: unknown) =>
    !!v &&
    typeof v === "object" &&
    ((v as { figureId?: unknown }).figureId !== undefined ||
      (v as { illustration?: unknown }).illustration !== undefined);
  return slot(p) || slot(p.left) || slot(p.right) || slot(p.backdrop);
}

/**
 * Number tokens: "30.56", "0.9106", "75.1%" → 75.1, "1/8" (a fraction is one
 * number). Digits glued to a letter are part of a name (RICE1, Q8, 4K), not a
 * number, on both sides of the comparison.
 */
const NUMBER = /(?<![\p{L}\d.,/])\d+(?:[.,]\d+)*(?:\/\d+)?/gu;

/**
 * Every number the source states, as WHOLE tokens. A substring test let an
 * invented "31" through because "131.59" contains it (review, 2026-10-10).
 * LaTeX commands are spaces first, so `1\times10^{-3}` states 1 and 10.
 */
function sourceNumbers(source: Source): ReadonlySet<string> {
  const text = sourceText(source).replace(/\\[A-Za-z]+/g, " ");
  const out = new Set(text.match(NUMBER) ?? []);
  // "10K tokens" states 10000 as much as "10,000 tokens" does.
  const scale: Record<string, number> = { K: 1e3, k: 1e3, M: 1e6, B: 1e9 };
  for (const m of text.matchAll(/(?<![\p{L}\d.,])(\d+(?:\.\d+)?)([KkMB])(?![\p{L}\d])/gu)) {
    const n = Math.round(Number(m[1]) * (scale[m[2] as string] as number));
    if (Number.isSafeInteger(n)) out.add(String(n));
  }
  return out;
}

/** Everything the source states, as one text: title, sections, tables, figure captions. */
function sourceText(source: Source): string {
  return [
    source.title,
    ...source.sections.flatMap((s) => [s.heading, s.text]),
    ...source.tables.flatMap((t) => [t.caption ?? "", ...t.columns, ...t.rows.flat()]),
    ...source.figures.map((f) => f.caption),
  ].join("\n");
}

/**
 * What breaks a kind's claim bans (src/types.ts `LiteralKindDoc.mustNotClaim`):
 * a banned claim in `said` (the beat's takeaway and the scene's labels). Empty
 * when it keeps them.
 */
export function literalTruthProblems(
  rules: Pick<LiteralKindDoc, "mustNotClaim">,
  said: readonly string[],
): string[] {
  const out: string[] = [];
  for (const b of rules.mustNotClaim ?? []) {
    const hits = [
      ...new Set(
        said.flatMap((t) =>
          [...t.matchAll(new RegExp(b.pattern.source, `${b.pattern.flags.replace("g", "")}g`))]
            .filter((m) => !negated(t, m.index ?? 0, m[0].length))
            .map((m) => m[0]),
        ),
      ),
    ];
    if (hits.length)
      out.push(
        `claims ${b.what} (${hits.map((h) => `"${h}"`).join(", ")}) in its takeaway or labels, which it cannot show: ${b.because}`,
      );
  }
  return out;
}

/**
 * Whether a banned word is negated BY THE WORD GOVERNING IT — "not semantic",
 * "nothing is learned", "without trained weights", "학습 없이", "学習せず",
 * "不需要训练" — so a plan that states the scene's limit honestly is not
 * refused for it. Conservative: the negator must stand directly before the
 * banned word (one auxiliary or article between at most), or directly after it
 * in Korean and Japanese.
 */
function negated(text: string, at: number, len: number): boolean {
  const before = text.slice(Math.max(0, at - 40), at);
  const after = text.slice(at + len, at + len + 6);
  return (
    /(?:^|[^\p{L}'])(?:not|no|never|without|nothing|non|isn't|aren't|wasn't|weren't|doesn't|don't|didn't)(?:[\s-]+(?:a|an|the|any|is|are|was|were|be|been|being))?[\s-]+$/iu.test(
      before,
    ) ||
    /^\s?(?:없|않|아니|아닌)/.test(after) ||
    /^(?:し)?(?:ない|ず|せず|なし)/.test(after) ||
    /(?:不|没|無|无|非)(?:需要|用|经|經)?$/.test(before)
  );
}

/** A number's position is a reference, not a value: "Section 3", "Figure 1", "Table 2", "Eq. 4". */
const REFERENCE =
  /(?:section|sec\.|figure|fig\.|table|tab\.|eq\.|equation|chapter|appendix|algorithm|line|page|§|그림|표|図|表|节|章|第)\s*$/iu;

/** The numbers a text states in reading order, as written, signs kept, references left out. */
function numberTokens(source: string): Array<{ v: number; s: string }> {
  const text = source.replace(/\\[A-Za-z]+/g, " ");
  const out: Array<{ v: number; s: string }> = [];
  const re = /(?<![\p{L}\d.])(\d{1,3}(?:,\d{3})+(?![\d.])|\d+(?:\.\d+)?(?:e[-+]?\d+)?)/giu;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (REFERENCE.test(text.slice(Math.max(0, at - 14), at))) continue;
    // A sign is the character directly before, when that is not a range's dash ("1-2").
    const prev = text[at - 1] ?? "";
    const signed = (prev === "-" || prev === "−") && !/[\p{L}\d)]/u.test(text[at - 2] ?? "");
    const s = (m[1] as string).replace(/,/g, "");
    const v = Number(s);
    if (Number.isFinite(v)) out.push({ v: signed ? -v : v, s: signed ? `-${s}` : s });
  }
  return out;
}

/**
 * The source's numbers in reading order, signs kept, references left out. A
 * list "[0.5,0.25]" or "1,2,3" is its numbers one by one; "1,000" is one
 * thousand; "1e-3" is one number.
 */
export function numberSequence(source: string): number[] {
  return numberTokens(source).map((t) => t.v);
}

/** Whether `row` appears in `seq` whole, in order, with its signs. */
function containsRow(seq: readonly number[], row: readonly number[]): boolean {
  const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  if (!row.length) return false;
  for (let i = 0; i + row.length <= seq.length; i++)
    if (row.every((x, j) => eq(x, seq[i + j] as number))) return true;
  return false;
}

/**
 * A field of "the source's own" numbers is grounded when every row of it is
 * printed in the source, whole, in order, signs included. A one-column matrix
 * is read as its column, and a row of one number is never evidence: any "1" in
 * the text would match.
 */
function groundedRows(v: readonly (readonly number[])[], seq: readonly number[]): boolean {
  const rows = v.length && v.every((r) => r.length === 1) ? [v.flat()] : v.map((r) => [...r]);
  return rows.length > 0 && rows.every((r) => r.length > 1 && containsRow(seq, r));
}

/** The numbers in `texts` the source never states, once each. `{name}` (a computed value) is not a number. */
function unstated(texts: readonly string[], stated: ReadonlySet<string>): string[] {
  return [...new Set(texts.flatMap((t) => t.replace(/\{\w+\}/g, " ").match(NUMBER) ?? []))].filter(
    (n) => !stated.has(n),
  );
}

/** Every word a literal scene puts on screen, whatever its kind. */
function literalTexts(lit: Literal): string[] {
  const own = lit.labels.map((l) => l.text);
  switch (lit.kind) {
    case "operate":
      return [
        ...own,
        ...lit.given.flatMap((g) => [g.value, g.what]),
        ...(lit.terms?.reported ? [lit.terms.reported] : []),
        ...lit.chain.map((s) => s.label),
        ...lit.vectors.map((v) => v.label),
        ...lit.bins,
      ];
    case "evolve":
      return [
        ...own,
        ...lit.phases.map((p) => p.label),
        ...lit.tags.map((t) => t.label),
        ...lit.note,
        // A figure's trace is the figure's words, read off it: not the prose's to ground.
        ...(lit.picture
          ? []
          : lit.steps.flatMap((st) => [st.lead ?? "", ...st.parts.map((q) => q.text)])),
        ...lit.lanes.flatMap((l) => [
          l.label,
          l.total?.value ?? "",
          ...l.runs.flatMap((r) => [r.label, r.count?.value ?? ""]),
        ]),
      ];
    case "flow":
      return [
        ...own,
        ...lit.stages.flatMap((s) => [
          s.label,
          s.shape ?? "",
          s.quote ?? "",
          ...s.tokens.flatMap((g) => [g.label, g.name ?? "", g.count?.value ?? ""]),
        ]),
      ];
    case "place":
      return [
        ...own,
        ...lit.axes.map((a) => a.name),
        ...lit.items.flatMap((it) => [it.label, ...it.values, it.group ?? ""]),
        ...lit.curves.map((c) => c.label),
        ...(lit.margins
          ? [
              lit.margins.ours,
              ...lit.margins.metrics.map((m) => m.name),
              ...lit.margins.settings.flatMap((st) => [
                st.name,
                ...st.values.flatMap((v) => [v.ours, v.best, v.rival]),
              ]),
            ]
          : []),
        ...(lit.lengths?.groups.flatMap((g) => [
          g.label,
          g.unit,
          ...g.items.flatMap((it) => [it.label, it.value]),
          // A tiled group prints its quotient: a number on screen like any other.
          ...(lit.lengths?.tile ? [tileRatio(g.items) ?? ""] : []),
        ]) ?? []),
        ...(lit.combos
          ? [
              ...lit.combos.components,
              ...lit.combos.reported.flatMap((r) => [...r.with, r.result]),
              ...lit.combos.settings.flatMap((st) => [st.name, st.value]),
              ...lit.combos.others,
            ]
          : []),
        ...(lit.sets?.rings.flatMap((r) => [r.label, ...r.items]) ?? []),
      ];
    case "prior-work":
      return [
        ...own,
        ...lit.lanes.flatMap((l) => [
          l.family,
          l.members,
          l.gap,
          ...l.numbers.flatMap((n) => [n.label, n.value]),
        ]),
      ];
    case "table":
      return [...own, ...lit.columns, ...lit.rows.flat()];
    case "region":
      // On screen: each mark's words and the outcome; `thing` is the locator's.
      return [
        ...own,
        ...lit.marks.map((m) => m.text),
        ...(lit.outcome ? [lit.outcome.title, ...lit.outcome.lines] : []),
      ];
    default:
      return own;
  }
}

/** A word that marks a scene as an example, in the deck's languages. */
const EXAMPLE_WORD =
  /\b(?:example|illustrative|illustration|toy|hypothetical)\b|예시|예제|가상|例|示例|示意|イメージ/i;

/**
 * A name counts as the source's when it is at least two characters and a whole
 * word of it. "Whole" is per script: a Latin name ends where Latin letters and
 * digits do, so Korean's attached particles do not hide it, and "Net" is still
 * not found in "Network"; a Hangul name ends anywhere, for the same particles;
 * Han and kana have no word boundaries.
 */
const named = (source: string, t: string) => {
  const n = t.trim();
  if ([...n].length < 2) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const latin = (c: string) => /[\p{Script=Latin}\p{N}]/u.test(c);
  const first = [...n][0] as string;
  const last = [...n].at(-1) as string;
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
  const before = latin(first)
    ? "(?<![\\p{Script=Latin}\\p{N}])"
    : cjk.test(first)
      ? ""
      : "(?<![\\p{L}\\p{N}])";
  const after = latin(last) ? "(?![\\p{Script=Latin}\\p{N}])" : "";
  return new RegExp(`${before}${esc}${after}`, "iu").test(source);
};

/**
 * The source as PASSAGES: each paragraph and each list item of a section, and
 * each table whole. A number is attributed to a name only when both sit in one
 * passage — the source saying "X: 5.08 M" is evidence that 5.08 M is X's; the
 * two anywhere in the text is not (review, 2026-10-11: a scene credited a
 * source's number to an invented method).
 */
function passages(source: Source): string[] {
  const out: string[] = [];
  for (const s of source.sections)
    for (const block of s.text.split(/\n\s*\n/))
      out.push(...block.split(/\n(?=\s*(?:[-*•]|\d+[.)])\s)/));
  for (const t of source.tables)
    out.push([t.caption ?? "", ...t.columns, ...t.rows.map((r) => r.join(" | "))].join("\n"));
  for (const f of source.figures) out.push(f.caption);
  return out.map((p) => p.trim()).filter(Boolean);
}

/**
 * The source's sentences: a passage split where a sentence ends ("다. ", ". ",
 * "。"). A decimal point is no end, having no space after it. A table is one
 * sentence: its cells are read together.
 */
function sentences(source: Source): string[] {
  const tables = source.tables.map((t) =>
    [t.caption ?? "", ...t.columns, ...t.rows.map((r) => r.join(" | "))].join("\n"),
  );
  return [
    ...passages(source)
      .filter((p) => !tables.includes(p))
      .flatMap((p) => p.split(/(?<=[.!?])\s+|(?<=[。！？])/)),
    ...tables,
  ]
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The number tokens a text states, as written (`NUMBER`). */
const numbersIn = (t: string): string[] => t.replace(/\\[A-Za-z]+/g, " ").match(NUMBER) ?? [];

/** The names a list of them holds: "A · B", "A/B", "A, B" → each one. */
const namesIn = (t: string): string[] =>
  t
    .split(/\s*(?:[·•/,、;&|]|\s(?:and|및|und|et)\s)\s*/u)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * A word that says a result was measured WITHOUT a component: an ablation.
 * "不使用视觉解码器：87.97" is OneVL's own ablation row; "not using" and
 * "remove" are as common as "without" in each language.
 */
const ABLATION_WORD =
  /\bwithout\b|\bw\/o\b|ablat|\bremov|\bexclud|\bdrop|제거|빼고|없이|사용하지\s*않|미사용|除去|去掉|去除|移除|不使用|未使用|不用|消融|なし|除い|抜い|使用しない|用いない|使わない/iu;

/**
 * Metrics whose better direction is a convention, so a plan cannot flip it:
 * higher for a quality or an accuracy, lower for a distance, an error or a cost.
 * A metric named in neither is the plan's call.
 */
const HIGHER_IS_BETTER =
  /\b(?:PSNR|SSIM|MS-SSIM|accuracy|acc|precision|recall|F1|mAP|AP|IoU|mIoU|BLEU|ROUGE|AUC|top-?[15]|speed ?up|throughput)\b|정확도|정밀도|재현율|精度|准确率|正解率/iu;
const LOWER_IS_BETTER =
  /\b(?:LPIPS|NIQE|BRISQUE|FID|KID|MSE|RMSE|MAE|ADE|FDE|error|loss|energy|params?|parameters|latency|FLOPs|MACs|SOPs?|mJ|ms|perplexity|PPL|WER|CER|EPE)\b|오차|손실|에너지|파라미터|지연|誤差|損失|能耗|参数|エネルギー|パラメータ|延迟/iu;

/* ------------------------------------------------------ parameter grounding */

/**
 * The source as one text the binding rules read: TeX Greek as letters
 * (`\alpha` → α), `{=}` as `=`, math delimiters dropped. `1\times10^{-3}` keeps
 * its digits.
 */
function bindingText(source: Source): string {
  return passages(source).map(normalizeTex).join("\n\n");
}

function normalizeTex(t: string): string {
  return t
    .replace(
      /\\(alpha|beta|gamma|delta|epsilon|varepsilon|theta|lambda|mu|sigma|tau|rho|eta|kappa|omega|phi|psi|xi|pi)\b/g,
      (_, g: string) => GREEK[g.replace(/^var/, "")] ?? g,
    )
    .replace(/\{=\}/g, "=")
    .replace(/[{}$]/g, "")
    .replace(/\\[,;!]/g, " ");
}

/** A planner's symbol as the source would write it: "alpha" or "\alpha" → α. */
function symbolOf(s: string | undefined): string | undefined {
  if (!s?.trim()) return undefined;
  const t = s.trim().replace(/^\\/, "");
  return GREEK[t.toLowerCase()] ?? t;
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every place a symbol stands alone: not inside a Latin or Greek word, whatever follows in another script. */
function symbolAt(text: string, sym: string): number[] {
  // A particle of another script may follow it ("α이다", "θ는"); a letter of its own may not.
  const own = "\\p{Script=Latin}\\p{Script=Greek}\\p{N}_";
  const re = new RegExp(`(?<![${own}])${reEsc(sym)}(?![${own}])`, "gu");
  return [...text.matchAll(re)].map((m) => m.index ?? 0);
}

/** A window of `r` characters around [at, at+len) holds one of `nouns`. */
const near = (text: string, at: number, len: number, nouns: RegExp, r = 40) =>
  nouns.test(text.slice(Math.max(0, at - r), at + len + r));

/** The symbol a value is bound to where it stands ("α=0.6", "α: 0.6"), or undefined. */
function boundSymbol(text: string, at: number): string | undefined {
  const before = text.slice(Math.max(0, at - 16), at);
  const m = /([\p{L}][\p{L}\p{N}_^']{0,5})\s*(?:=|＝|:|≈)\s*$/u.exec(before);
  if (!m) return undefined;
  const s = m[1] as string;
  // A symbol, not a word: a Greek letter, a subscripted name, or at most two Latin letters.
  return /[Ͱ-Ͽ]|_/.test(s) || s.length <= 2 ? s : undefined;
}

/**
 * Whether a number is grounded IN ITS ROLE: some occurrence of the value, as a
 * whole token, either carries the symbol the source binds to it there (then
 * the plan must give that symbol, and the symbol must stand within 40
 * characters of the role's nouns somewhere), or is unbound and itself stands
 * within 40 characters of them. `mustBind`: only a binding grounds it (a
 * formula's own symbol). Returns why not, or undefined.
 */
export function paramProblem(
  value: string,
  symbol: string | undefined,
  nouns: RegExp,
  role: string,
  text: string,
  mustBind = false,
): string | undefined {
  const v = value.trim().replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(v))
    return `${role} "${value}" is not one number as the source writes it`;
  const sym = symbolOf(symbol);
  const re = new RegExp(`(?<![\\p{L}\\d.,])${reEsc(v)}(?![\\d]|\\.\\d)`, "gu");
  const at = [...text.matchAll(re)].map((m) => m.index ?? 0);
  if (!at.length) return `${role} ${value} is not stated in the source`;
  const others = new Set<string>();
  for (const i of at) {
    const b = boundSymbol(text, i);
    if (b) {
      if (sym !== b) {
        others.add(b);
        continue;
      }
      if (symbolAt(text, b).some((j) => near(text, j, b.length, nouns))) return undefined;
      continue;
    }
    if (mustBind) continue;
    if (sym && !symbolAt(text, sym).some((j) => near(text, j, sym.length, nouns))) continue;
    if (near(text, i, v.length, nouns)) return undefined;
  }
  if (others.size && !sym)
    return `${role} ${value} is printed only as ${[...others].map((o) => `${o}=${value}`).join(", ")}: give that symbol, and only if the source names it as the ${role}`;
  if (others.size)
    return `${role} ${value} is printed as ${[...others].map((o) => `${o}=${value}`).join(", ")}, not as ${sym}`;
  if (mustBind) return `${role} ${value} is never printed bound to ${sym ?? "its symbol"}`;
  return `${role} ${value} is printed, but never as the ${role}${sym ? ` (${sym} never stands beside its name)` : ""}`;
}

/**
 * Whether one of the source's tables has a column headed by the symbol alone and
 * a cell of it holding the value: a table binds its column's values to its
 * header as "γ = 2" binds in prose. arXiv 2211.17192's Table 1 heads a column
 * γ (written "γ\\gamma", the page's MathML and its TeX) over 2, 3, 2, 5, 2,
 * 10, and a curve fixed at γ = 2 was refused as never printed bound to γ.
 */
function columnStates(source: Source, symbol: string, value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return source.tables.some((t) =>
    t.columns.some(
      (col, j) => symbolColumn(col, symbol) && t.rows.some((r) => (r[j] ?? "").trim() === v),
    ),
  );
}

/** Whether a column header is the symbol alone ("γ", or "γ\\gamma": MathML then TeX). */
function symbolColumn(col: string, symbol: string): boolean {
  const sym = symbolOf(symbol);
  if (!sym) return false;
  const h = normalizeTex(col).replace(/\s+/g, "");
  return h === sym || h === sym + sym;
}

/** The passages that name an op (or rule), normalised. */
const passagesNaming = (ps: readonly string[], nouns: RegExp) => ps.filter((p) => nouns.test(p));

/** Why an op step is not grounded, as sentences. */
function opProblems(
  step: Extract<Literal, { kind: "operate" }>["chain"][number],
  k: number,
  text: string,
  ps: readonly string[],
  seq: readonly number[],
): string[] {
  const doc = LITERAL_OPS[step.op] as LiteralOpDoc;
  const out: string[] = [];
  const where = `step ${k} (${step.op}${step.how ? ` ${step.how}` : ""})`;
  const naming = passagesNaming(ps, doc.nouns);
  const hint = "draw that step as a `flow` stage";
  if (step.op !== "formula" && !naming.length) {
    out.push(`${where}: the source never names this operation; ${hint}`);
    return out;
  }
  const how = step.how ?? doc.defaultHow;
  const variant = how ? doc.how?.[how] : undefined;
  if (variant && step.how && !naming.some((p) => variant.words.test(p)))
    out.push(`${where}: no passage that names the operation says ${variant.what}; ${hint}`);
  for (const [field, v] of [
    ["stat", step.stat],
    ["over", step.over],
  ] as const) {
    const w = v ? doc.enums?.[field]?.[v] : undefined;
    if (w && !naming.some((p) => w.words.test(p)))
      out.push(
        `${where}: no passage that names the operation says ${w.what} (\`${field}\` ${v}); ${hint}`,
      );
  }
  if (step.op === "quantize" && !step.how)
    out.push(`${where}: \`how\` (floor or round) must be given and stated; ${hint}`);
  if (step.op === "formula") {
    if (step.expr)
      out.push(
        ...formulaProblems(step.expr, step.checks, step.params, text, ps).map(
          (p) => `${where}: ${p}`,
        ),
      );
    for (const p of step.params) {
      const why = paramProblem(p.value, p.symbol ?? p.name, /./, p.name, text, true);
      if (why) out.push(`${where}: ${why}`);
    }
    return out;
  }
  for (const p of step.params) {
    const decl = doc.params?.[p.name];
    if (!decl) continue;
    const why = paramProblem(p.value, p.symbol, decl.nouns, decl.what, text);
    if (why) out.push(`${where}: ${why}; ${hint}`);
  }
  if (step.weights.length && !groundedRows(step.weights, seq))
    out.push(
      `${where}: its \`weights\` are not printed in the source row by row; give them exactly, or draw it as a \`flow\` stage`,
    );
  return out;
}

/* --------------------------------------------------------- formula grounding */

/** The number positions of a check in a passage, in order inside a window of 6 numbers, or undefined. */
function locate(tokens: readonly { v: number }[], want: readonly number[]): number[] | undefined {
  const eq = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  for (let s = 0; s < tokens.length; s++) {
    if (!eq((tokens[s] as { v: number }).v, want[0] as number)) continue;
    const pos = [s];
    let j = s;
    for (const w of want.slice(1)) {
      let found = -1;
      for (let q = j + 1; q < Math.min(tokens.length, s + 6); q++)
        if (eq((tokens[q] as { v: number }).v, w)) {
          found = q;
          break;
        }
      if (found < 0) break;
      pos.push(found);
      j = found;
    }
    if (pos.length === want.length) return pos;
  }
  return undefined;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const isInt = (s: string) => !/\./.test(s);

/**
 * Why a formula is not grounded by its checks: each check passes under
 * interval arithmetic (src/literal/formula.ts) with its numbers in order in
 * one passage; every variable takes two values or more; and where two checks
 * or more sit in one passage (a flattened table), EVERY row of it at their
 * period, shaped like them, passes too — a plan cannot pick the rows that fit.
 * When the checks' rows also print a fixed parameter, every row printing THAT
 * value: the other rows are another curve's.
 */
export function formulaProblems(
  expr: string,
  checks: ReadonlyArray<{ inputs: ReadonlyArray<{ name: string; value: string }>; output: string }>,
  fixed: ReadonlyArray<{ name: string; value: string }>,
  _text: string,
  ps: readonly string[],
): string[] {
  let ast: ReturnType<typeof parseFormula>;
  try {
    ast = parseFormula(expr);
  } catch (e) {
    return [(e as Error).message.replace(/^formula: /, "")];
  }
  const out: string[] = [];
  if (checks.length < 2)
    return [
      `formula "${expr}" needs two checks or more the source prints, so each variable is seen to vary`,
    ];
  const fx: Record<string, readonly [number, number]> = {};
  for (const f of fixed) {
    const iv = printed(f.value, true);
    if (!iv) return [`fixed ${f.name} "${f.value}" is not one number`];
    fx[f.name] = iv;
  }
  const names = [...new Set(checks.flatMap((c) => c.inputs.map((i) => i.name)))];
  for (const n of names) {
    const vals = new Set(checks.map((c) => c.inputs.find((i) => i.name === n)?.value));
    if (vals.size < 2)
      out.push(
        `formula "${expr}": ${n} takes one value across the checks, so nothing shows the formula depends on it`,
      );
  }
  const toks = ps.map((p) => numberTokens(normalizeTex(p)));
  const byPassage = new Map<number, Array<{ pos: number[]; check: (typeof checks)[number] }>>();
  checks.forEach((c, k) => {
    const want = [...c.inputs.map((i) => Number(i.value)), Number(c.output)];
    const r = checkPasses(ast, c, fx);
    if (!r.ok) out.push(`formula "${expr}", check ${k + 1}: ${r.why}`);
    const hit = toks.map((t, j) => [j, locate(t, want)] as const).find(([, pos]) => pos);
    if (!hit) {
      out.push(
        `formula "${expr}", check ${k + 1}: ${want.join(", ")} are not printed together, in order, in one passage of the source`,
      );
      return;
    }
    const [j, pos] = hit as readonly [number, number[]];
    byPassage.set(j, [...(byPassage.get(j) ?? []), { pos, check: c }]);
  });
  // Every row of a table the checks cite, at their period.
  for (const [j, cs] of byPassage) {
    if (cs.length < 2) continue;
    const t = toks[j] as Array<{ v: number; s: string }>;
    const first = cs[0] as (typeof cs)[number];
    const off = first.pos.map((p) => p - (first.pos[0] as number));
    if (!cs.every((c) => c.pos.every((p, q) => p - (c.pos[0] as number) === off[q]))) continue;
    const starts = cs.map((c) => c.pos[0] as number).sort((a, b) => a - b);
    const g = starts.slice(1).reduce((acc, x, q) => gcd(acc, x - (starts[q] as number)), 0);
    const shape = first.pos.map((p) => isInt((t[p] as { s: string }).s));
    const fits = (s0: number) =>
      s0 >= 0 &&
      s0 + (off.at(-1) as number) < t.length &&
      off.every((o, q) => isInt((t[s0 + o] as { s: string }).s) === shape[q]);
    // The row period: the smallest divisor of the checks' spacing past one row's span whose
    // next row is shaped like theirs.
    let P = 0;
    for (let d = (off.at(-1) as number) + 1; d <= g; d++)
      if (g % d === 0 && fits((starts[0] as number) + d)) {
        P = d;
        break;
      }
    if (!P) continue;
    // A fixed parameter printed in the checks' own rows, at one offset from each: the
    // curve is that parameter's, so only the rows printing the same value are its rows.
    // Measured on arXiv 2211.17192's Table 1, (α, γ, ops, speed) rows: a curve for
    // α = 0.8 was refused for not fitting the α = 0.6, 0.7 and 0.9 rows.
    const near = (v: number, w: number) => Math.abs(v - w) <= 1e-9 * Math.max(1, Math.abs(w));
    const keyed = fixed.flatMap((f) => {
      const w = Number(f.value);
      const offs = cs.map((c) => {
        const s0 = c.pos[0] as number;
        let best: number | undefined;
        for (let q = Math.max(0, s0 - P + 1); q < Math.min(t.length, s0 + P); q++)
          if (!c.pos.includes(q) && near((t[q] as { v: number }).v, w))
            if (best === undefined || Math.abs(q - s0) < Math.abs(best)) best = q - s0;
        return best;
      });
      const o = offs[0];
      return o !== undefined && offs.every((x) => x === o) ? [{ o, w }] : [];
    });
    const names_ = first.check.inputs.map((i) => i.name);
    const test = (s0: number) => {
      if (keyed.some(({ o, w }) => !near((t[s0 + o] as { v: number } | undefined)?.v ?? NaN, w)))
        return;
      const row = off.map((o) => t[s0 + o] as { v: number; s: string });
      const check = {
        inputs: names_.map((n, q) => ({ name: n, value: (row[q] as { s: string }).s })),
        output: (row.at(-1) as { s: string }).s,
      };
      const r = checkPasses(ast, check, fx);
      if (!r.ok)
        out.push(
          `formula "${expr}": the row ${row.map((x) => x.s).join(", ")} of the table its checks come from does not fit (${r.why}); a curve is grounded by every row of its table, not the rows that fit`,
        );
    };
    // Every row of the table, outward from the first check's while rows keep their shape.
    for (const dir of [-1, 1])
      for (let s0 = (starts[0] as number) + dir * P; fits(s0); s0 += dir * P) test(s0);
  }
  return out;
}

/** Whether an expression is printed verbatim in the source, spaces, operators and TeX braces aside. */
function verbatim(expr: string, text: string): boolean {
  const e = normalizeExpr(expr).replace(/[{}$]/g, "");
  return e.length >= 5 && normalizeExpr(text).replace(/[{}$]/g, "").includes(e);
}

/**
 * Whether one row of one of the source's tables states every value of `item`
 * and names every part of its label and group (each split on ·, /, …): a part
 * is a cell of that row ("EnDe", "T5-small"), the table's caption, or a column
 * header with that row's value in it ("temp=0", "Temp 0" for a Temp column
 * holding 0).
 *
 * A table is the passage a tabulated number sits in, but its row's name is in
 * one cell and its condition in a column header. Measured on arXiv 2211.17192's
 * Table 2, where "EnDe, temp=0 → 3.4X" is one row: requiring the label in the
 * same passage as the value refused every row, and the planner fell back to
 * labelling four points "T5-small" with the real distinction in a legend.
 *
 * A point whose axes are one measure under two conditions (α at t=0 against α
 * at t=1) may take its values from several rows: each row names every part,
 * the values sit in one column, and each row's condition cell is the one its
 * axis names (its numbers in that axis's name and not in the others', or the
 * cell itself named there). Measured on arXiv 2211.17192's Table 3, printed
 * one row per (model, sampling): the diagonal plane the planner is told to
 * draw for exactly this case was refused on every point.
 */
function tableRowStates(
  source: Source,
  item: { label: string; values: readonly string[]; group?: string | undefined },
  axes: ReadonlyArray<{ name: string }> = [],
): boolean {
  const parts = [...new Set([...namesIn(item.label), ...namesIn(item.group ?? "")])];
  const want = item.values.flatMap((v) => numbersIn(v));
  if (!parts.length || !want.length) return false;
  // "LaMDA 100M" names the cell "LaMDA (100M)": brackets are not part of a name.
  const unbracket = (x: string) =>
    x
      .replace(/[()[\]（）]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  const cellNames = (c: string, part: string) =>
    named(c, part) || named(unbracket(c), unbracket(part));
  return source.tables.some((t) => {
    const namesAll = (row: readonly string[]) =>
      parts.every((part) => {
        if (row.some((c) => cellNames(c, part)) || named(t.caption ?? "", part)) return true;
        const m = /^(.*?\S)\s*[=:]?\s*(-?\d+(?:\.\d+)?)$/u.exec(part);
        if (!m) return false;
        const [, head, value] = m as unknown as [string, string, string];
        // A one-letter head ("γ=2") is too short for `named`; a column headed by it alone is.
        return t.columns.some(
          (col, j) =>
            (named(col, head) || symbolColumn(col, head)) &&
            numbersIn(row[j] ?? "").includes(value),
        );
      });
    // A cell read with its column's header: "MIMIC-III · 512" at 512, 52.8 is row
    // MIMIC-III, column 512, cell 52.8 (FlashAttention's Table 5, 2026-10-15).
    const byColumn = t.rows.some((row) =>
      t.columns.some((col, j) => {
        const got = new Set([...numbersIn(col), ...numbersIn(row[j] ?? "")]);
        return (
          want.every((n) => got.has(n)) &&
          parts.every(
            (part) =>
              row.some((c) => cellNames(c, part)) ||
              named(t.caption ?? "", part) ||
              cellNames(col, part),
          )
        );
      }),
    );
    if (byColumn) return true;
    const rows = t.rows.filter(namesAll);
    if (
      rows.some((row) => {
        const got = new Set(row.flatMap((c) => numbersIn(c)));
        return want.every((n) => got.has(n));
      })
    )
      return true;
    return splitRowsState(t.columns.length, rows, item.values, axes);
  });
}

/** Whether each value sits in one column of its own row, that row's condition cell named by its axis. */
function splitRowsState(
  width: number,
  rows: ReadonlyArray<readonly string[]>,
  values: readonly string[],
  axes: ReadonlyArray<{ name: string }>,
): boolean {
  if (values.length < 2 || values.length !== axes.length) return false;
  const vs = values.map((v) => numbersIn(v));
  if (vs.some((v) => v.length !== 1)) return false;
  const axisNums = axes.map((a) => new Set(numbersIn(a.name)));
  const conditionOf = (cell: string, k: number) => {
    const ns = numbersIn(cell);
    const inAxis = (q: number) =>
      ns.length ? ns.every((n) => axisNums[q]?.has(n)) : named(axes[q]?.name ?? "", cell.trim());
    return inAxis(k) && axes.every((_, q) => q === k || !inAxis(q));
  };
  for (let j = 0; j < width; j++)
    for (let c = 0; c < width; c++) {
      if (c === j) continue;
      const picked = vs.map(([v], k) =>
        rows.find(
          (row) => numbersIn(row[j] ?? "").includes(v as string) && conditionOf(row[c] ?? "", k),
        ),
      );
      if (picked.every(Boolean) && new Set(picked).size === picked.length) return true;
    }
  return false;
}

/** A passage that is a list item ("- X", "1. X"): one row of a list. */
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s/u;

/**
 * Whether a two-value point is one row of a table the source wrote as a list:
 * a list item naming the label states one value as its k-th number, and the
 * nearest passage before it that is not a list item — the header the list
 * hangs from — states the other as ITS k-th. Measured on OneVL's horizon table,
 * flattened to "附录表格报告 1 s、2 s、3 s、4 s 时的 L2 误差" and then
 * "- OneVL：0.13、0.48、1.18、2.25、1.01": a `connect` series of OneVL's L2
 * error over the horizons is the source's own row, and requiring the horizon
 * beside the error refused every point of it.
 */
function listRowStates(
  ps: readonly string[],
  item: { label: string; values: readonly string[] },
): boolean {
  if (item.values.length !== 2) return false;
  const [a, b] = item.values.map((v) => numbersIn(v));
  if (a?.length !== 1 || b?.length !== 1) return false;
  const esc = item.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return ps.some((p, i) => {
    if (!LIST_ITEM.test(p) || !named(p, item.label)) return false;
    let h = i - 1;
    while (h >= 0 && LIST_ITEM.test(ps[h] as string)) h--;
    if (h < 0) return false;
    const head = numbersIn(ps[h] as string);
    const row = numbersIn(p.replace(new RegExp(esc, "giu"), " "));
    return head.some((x, k) => (x === a[0] && row[k] === b[0]) || (x === b[0] && row[k] === a[0]));
  });
}

/* ------------------------------------------------------------ the word forms */

/**
 * What ties a word form's names and numbers to the source, beyond each number
 * being stated somewhere: a reported value sits beside the name it is credited
 * to, an ablation result is one the source reports as an ablation, a margin's
 * values are the setting's own and its rival is named beside them, the first
 * set holds only what the source gives a result for, a point's values sit with
 * its label. Each a sentence a repair can act on; empty when it holds.
 */
function wordGrounding(lit: Literal, source: Source, text: string): string[] {
  const out: string[] = [];
  const ps = passages(source);
  const has = (p: string, name: string) => named(p, name);
  const states = (p: string, value: string) => {
    const want = numbersIn(value);
    const got = new Set(numbersIn(p));
    return want.length > 0 && want.every((n) => got.has(n));
  };
  const unnamed = (names: readonly string[]) => names.filter((n) => !named(text, n));
  if (lit.kind === "prior-work") {
    for (const lane of lit.lanes) {
      const members = namesIn(lane.members);
      const missing = unnamed(members);
      if (missing.length)
        out.push(
          `names ${missing.map((m) => `"${m}"`).join(", ")} in lane "${lane.family}", which the source never names. A lane's \`members\` are the source's own names for the methods, separated by ·`,
        );
      for (const n of lane.numbers)
        if (!ps.some((p) => states(p, n.value) && members.some((m) => has(p, m))))
          out.push(
            `credits "${n.value}" to lane "${lane.family}" (${lane.members}), and the source never states it beside any of those names`,
          );
    }
    return out;
  }
  if (lit.kind !== "place") return out;
  const axesConv = (name: string, lower: boolean) => {
    const conv = LOWER_IS_BETTER.test(name)
      ? true
      : HIGHER_IS_BETTER.test(name)
        ? false
        : undefined;
    if (conv !== undefined && lower !== conv)
      out.push(
        `gives ${name} lowerIsBetter ${lower}; ${name} is ${conv ? "lower" : "higher"} is better, so the scene would read backwards`,
      );
  };
  const form = placeForm(lit);
  if (form === "points") {
    for (const a of lit.axes) axesConv(a.name, a.lowerIsBetter);
    for (const it of lit.items)
      if (
        !ps.some((p) => has(p, it.label) && it.values.every((v) => states(p, v))) &&
        !tableRowStates(source, it, lit.axes) &&
        !listRowStates(ps, it)
      )
        out.push(
          `places "${it.label}" at ${it.values.join(", ")}, and no passage of the source states ${it.values.length > 1 ? "those values" : "that value"} with "${it.label}" named. Each item's values sit in one passage with its name`,
        );
  }
  if (form === "margins" && lit.margins) {
    const m = lit.margins;
    const missing = unnamed([m.ours, ...m.settings.map((s) => s.name)]);
    if (missing.length)
      out.push(`names ${missing.map((x) => `"${x}"`).join(", ")}, which the source never names`);
    m.metrics.forEach((met, i) => {
      axesConv(met.name, met.lowerIsBetter);
      for (const st of m.settings) {
        const v = st.values[i];
        if (!v) continue;
        const rivals = namesIn(v.rival);
        const ok = ps.some(
          (p) =>
            has(p, st.name) &&
            has(p, m.ours) &&
            states(p, v.ours) &&
            states(p, v.best) &&
            rivals.length > 0 &&
            rivals.every((r) => has(p, r)),
        );
        if (!ok)
          out.push(
            `places ${st.name} on ${met.name} by ${m.ours} ${v.ours} against ${v.rival} ${v.best}, and no passage of the source states both values with ${st.name}, ${m.ours} and ${v.rival} named. Give that setting's own values and the method the source names as best beside them, or use \`place\` plane with each method grounded in its own passage`,
          );
      }
    });
    const bad = m.settings.flatMap((st) =>
      st.values.flatMap((v) => [v.ours, v.best]).filter((x) => !/^-?\d+(\.\d+)?$/.test(x.trim())),
    );
    if (bad.length)
      out.push(
        `gives ${bad.map((x) => `"${x}"`).join(", ")} as margin values; each is one number, exactly as the source writes it (the metric's name goes in \`metrics\`)`,
      );
  }
  if (form === "sets" && lit.sets) {
    const missing = unnamed(lit.sets.rings.flatMap((r) => r.items.flatMap(namesIn)));
    if (missing.length)
      out.push(
        `holds ${missing.map((m) => `"${m}"`).join(", ")}, which the source never names. An item is the source's own name for a dataset, a condition or a setting`,
      );
    const result = (s: string) => /%/.test(s) || numbersIn(s).some((n) => /\.\d/.test(n));
    const ss = sentences(source);
    const bare = (lit.sets.rings[0]?.items ?? [])
      .flatMap(namesIn)
      .filter((it) => named(text, it) && !ss.some((s) => has(s, it) && result(s)));
    if (bare.length)
      out.push(
        `puts ${bare.map((m) => `"${m}"`).join(", ")} in its first set, which holds what the source shows results for, and the source states no result beside it. Move it out a set`,
      );
  }
  if (form === "combos" && lit.combos) {
    const cb = lit.combos;
    for (const r of cb.reported) {
      if (r.with.length >= cb.components.length) continue;
      const removed = cb.components.filter((c) => !r.with.includes(c));
      const ok = ps.some(
        (p) => states(p, r.result) && ABLATION_WORD.test(p) && removed.every((c) => has(p, c)),
      );
      if (!ok)
        out.push(
          `reports "${r.result}" for ${r.with.length ? r.with.join(" + ") : "none of its components"} (without ${removed.join(", ")}), and the source never reports that number as a result without ${removed.join(", ")}. A cell holds only an ablation the source reports; leave it empty`,
        );
    }
  }
  return out;
}

/* ---------------------------------------------------------- the verbs' rules */

/** Why a verb's numbers, variants and inputs are not grounded, and whether it runs on example material. */
function verbGrounding(
  lit: Literal,
  source: Source,
  ctx: { text: string; ps: readonly string[]; seq: readonly number[]; stated: ReadonlySet<string> },
): { problems: string[]; example: boolean } {
  const { text, ps, seq } = ctx;
  const out: string[] = [];
  let example = false;
  const role = (
    n: { value: string; symbol?: string | undefined } | undefined,
    nouns: RegExp,
    what: string,
  ) => {
    if (!n) return;
    const why = paramProblem(n.value, n.symbol, nouns, what, text);
    if (why) out.push(`${why}; show it as a \`flow\` diagram`);
  };
  switch (lit.kind) {
    case "operate": {
      if (lit.terms) {
        // The source's own equation, its stated values, and the result it reports:
        // the terms between are their consequence, computed (src/literal/kinds/operate.ts).
        // A sentence's own punctuation after a display equation is prose, not math:
        // the source prints "…D^{0.28}}," and a faithful copy leaves the comma off.
        const bare = (t: string) => t.replace(/\s+/g, "").replace(/[,.;]+$/, "");
        if (lit.equation && !source.equations.some((e) => bare(e.tex) === bare(lit.equation ?? "")))
          out.push("shows an `equation` that is not one the source prints; copy its TeX exactly");
        for (const g of lit.given) {
          const why = paramProblem(g.value, g.symbol ?? g.name, /./, g.name, text, true);
          if (why) out.push(`${why}; give only values the source states`);
        }
        if (lit.terms.reported && !ctx.stated.has(lit.terms.reported.trim()))
          out.push(`reports ${lit.terms.reported}, which the source does not state`);
        break;
      }
      lit.chain.forEach((s, k) => {
        out.push(...opProblems(s, k + 1, text, ps, seq));
      });
      if (lit.compare === "params" && lit.alt) {
        const src = lit.chain[lit.alt.step - 1];
        if (src)
          out.push(
            ...opProblems(
              { ...src, how: lit.alt.how ?? src.how, params: lit.alt.params },
              lit.alt.step,
              text,
              ps,
              seq,
            ).map((p) => `alt ${p}`),
          );
      }
      const vecs =
        lit.vectors.length > 0 &&
        !groundedRows(
          lit.vectors.map((v) => v.values),
          seq,
        );
      const mat = lit.matrix.length > 0 && !groundedRows(lit.matrix, seq);
      example = !!lit.picture || vecs || mat || !!lit.condition;
      if (lit.picture && !lit.labels.find((l) => l.slot === "caption")?.text.trim())
        out.push(
          "runs on a picture, which is example material: give `caption`, saying the stated operations run on an example image",
        );
      break;
    }
    case "evolve": {
      if (lit.rule === "lanes") {
        for (const l of lit.lanes) {
          role(l.total, LITERAL_ROLE_NOUNS.duration, `lane "${l.label}"'s total`);
          for (const r of l.runs) {
            role(r.count, LITERAL_ROLE_NOUNS.count, `run "${r.label}"'s count`);
            role(r.dur, LITERAL_ROLE_NOUNS.duration, `run "${r.label}"'s duration`);
          }
        }
        const allDur = lit.lanes.every((l) =>
          l.runs.every((r) => r.dur && (r.parallel || r.count)),
        );
        example =
          !allDur &&
          (lit.lanes.some((l) => l.runs.length > 1 && !!l.total) ||
            lit.lanes.some((l) => l.runs.some((r) => !r.count)));
        break;
      }
      const doc = LITERAL_RULES[lit.rule] as LiteralOpDoc;
      if (lit.rule !== "formula" && !passagesNaming(ps, doc.nouns).length)
        out.push(`the source never names the ${lit.rule} rule; draw it as a \`flow\` diagram`);
      const naming = passagesNaming(ps, doc.nouns);
      const variant = lit.how ? doc.how?.[lit.how] : undefined;
      if (lit.rule === "recur" && variant && !naming.some((p) => variant.words.test(p)))
        out.push(`no passage that names the rule says ${variant.what} (\`how\` ${lit.how})`);
      for (const [field, v] of [
        ["reset", lit.reset],
        ["schedule", lit.schedule],
      ] as const) {
        const w = v ? doc.enums?.[field]?.[v] : undefined;
        if (w && !naming.some((p) => w.words.test(p)))
          out.push(`no passage that names the rule says ${w.what} (\`${field}\` ${v})`);
      }
      for (const p of lit.params) {
        const decl = doc.params?.[p.name];
        const why =
          lit.rule === "formula"
            ? paramProblem(p.value, p.symbol ?? p.name, /./, p.name, text, true)
            : decl
              ? paramProblem(p.value, p.symbol, decl.nouns, decl.what, text)
              : undefined;
        if (why) out.push(`${why}; show it as a \`flow\` diagram`);
      }
      if (lit.rule === "formula" && lit.expr && !verbatim(lit.expr, text))
        out.push(...formulaProblems(lit.expr, lit.checks, lit.params, text, ps));
      if (
        lit.input?.stat &&
        !naming.some((p) =>
          (lit.input?.stat === "var"
            ? /varian|분산|分散|方差/i
            : lit.input?.stat === "std"
              ? /standard deviation|\bstd\b|표준편차|標準偏差|标准差/i
              : /\bmean\b|averag|평균|平均|均值/i
          ).test(p),
        )
      )
        out.push(
          `no passage that names the rule says the ${lit.input.stat} of its input (\`stat\`)`,
        );
      const values = lit.input?.values ?? [];
      if (
        values.length &&
        !groundedRows([values.map((v) => Number(v.value.replace(/,/g, "")))], seq)
      )
        out.push(
          "gives input `values` the source does not print in that order; give its own values, or stream `from` an earlier beat",
        );
      example = lit.rule === "noise" || !!lit.input?.from;
      break;
    }
    case "flow": {
      if (lit.form === "chain") {
        example = lit.stages.some((s) => !!s.show);
        // A chain of boxes holding only their names is slideware: r1 drew
        // speculative decoding as three empty 500×630 rectangles.
        if (
          !lit.stages.some(
            (s) =>
              s.tokens.length || s.show || s.figure || s.quote || (s.shape && tokenChips(s.shape)),
          )
        )
          out.push(
            "is a chain of empty boxes: no stage holds tokens (`tokens`), shows a layer (`show`) or a figure (`figure`), quotes the source (`quote`) or states a count (`shape`, e.g. γ or 4). Draw the mechanism as an `evolve` (its steps, or lanes of serial against parallel work), or give the stages what they hold",
          );
        for (const s of lit.stages) {
          for (const g of s.tokens)
            role(g.count, LITERAL_ROLE_NOUNS.count, `token group "${g.label}"'s count`);
          if (s.show && s.learned)
            out.push(
              `stage "${s.label}" is learned and shows a computed layer; a learned stage is drawn as a box, never as an output`,
            );
          if (s.figure) {
            const fig = source.figures.find((f) => f.id === s.figure);
            if (!fig || s.figure.startsWith(GENERATED_FIGURE_PREFIX))
              out.push(
                `stage "${s.label}" shows figure "${s.figure}", which is not one of the source's own figures`,
              );
          }
        }
      }
      break;
    }
    case "region":
      // The source's own figure, its things marked: no stated number, nothing
      // example about it.
      break;
    case "place":
      for (const c of lit.curves) {
        out.push(
          ...formulaProblems(c.expr, c.checks, c.fixed, text, ps).map(
            (p) => `curve "${c.label}": ${p}`,
          ),
        );
        for (const f of c.fixed) {
          const why = paramProblem(f.value, f.symbol ?? f.name, /./, f.name, text, true);
          if (why && !columnStates(source, f.symbol ?? f.name, f.value))
            out.push(`curve "${c.label}": ${why}`);
        }
      }
      break;
    case "prior-work":
      example = lit.lanes.some((l) => !!l.from);
      break;
    default:
      break;
  }
  return { problems: out, example };
}

/**
 * A word that names a trained component. A learned family or stage is never shown by a
 * computed layer: a network the build does not have cannot be drawn working. The `Net`
 * suffix (DehazeNet, AOD-Net, U-Net) is matched case-sensitively, so "Internet" is not.
 */
const LEARNED_WORD =
  /\blearn(?:ed|t|able|ing-based)\b|\btrained\b|neural|network|\bnets?\b|\b(?:CNN|RNN|GNN|LSTM|MLP|ViT|GAN)s?\b|transformer|encoder|decoder|backbone|\bdeep\b|딥러닝|深層学習|深度学习|학습된|학습 가능|학습 기반|신경망|네트워크|인코더|디코더|백본|学習済み|学習可能|学習ベース|ニューラル|ネットワーク|エンコーダ|デコーダ|バックボーン|可学习|学到的|基于学习|神经|网络|编码器|解码器|骨干/iu;
const NET_SUFFIX = /[A-Za-z0-9][\w-]*Net\b/u;

/** The learned words a text holds that no negator governs ("not learned" is honest). */
function learnedIn(text: string): string[] {
  const hits = [
    ...[...text.matchAll(new RegExp(LEARNED_WORD.source, "giu"))]
      .filter((m) => !negated(text, m.index ?? 0, m[0].length))
      .map((m) => m[0]),
    ...(text.match(new RegExp(NET_SUFFIX.source, "gu")) ?? []),
  ];
  // "Net" inside "SFRDP-Net" is one hit, named whole.
  return [...new Set(hits)].filter((h, _, all) => !all.some((o) => o !== h && o.includes(h)));
}

/**
 * The words that name what an earlier verb scene computed: each op's variant words where the
 * variant has its own (sobel, absolute), else the op's nouns (a combine's nouns hold "sum" and
 * "difference", which name anything); a rule's likewise. Empty for a scene whose layer
 * is not an operation's output (a crop, a formula, a brought-back picture).
 */
function methodWords(lit: Literal): RegExp[] {
  const own = (r: RegExp | undefined) => (r && r.source !== "." ? [r] : []);
  if (lit.kind === "operate")
    return lit.chain.flatMap((s) => {
      const doc = LITERAL_OPS[s.op] as LiteralOpDoc;
      const v = own(doc.how?.[s.how ?? doc.defaultHow ?? ""]?.words);
      return v.length ? v : own(doc.nouns);
    });
  if (lit.kind === "evolve") {
    const doc = LITERAL_RULES[lit.rule] as LiteralOpDoc;
    const v = own(lit.how ? doc.how?.[lit.how]?.words : undefined);
    return v.length ? v : own(doc.nouns);
  }
  return [];
}

/**
 * Why a computed layer shown under a name credits it to the wrong thing. A flow stage that
 * shows one must not be a learned component, and its label names the operation that made
 * it (`members` undefined). A prior-work lane that shows one must also BE
 * the operation that computed it: its family or members name that operation, and the
 * source names every member beside it, or the picture is credited to methods that never
 * ran it. This is the general form of the rule that let a lane run the dark channel prior
 * only under the family that is it (src/plan/coverage.ts before the verbs, 2026-10-11).
 */
function creditProblems(
  shown: Literal | undefined,
  words: string,
  members: readonly string[] | undefined,
  ps: readonly string[],
  what: string,
): string[] {
  const out: string[] = [];
  const learned = learnedIn(words);
  if (learned.length)
    out.push(
      `${what} shows a computed layer under ${learned.map((w) => `"${w}"`).join(", ")}, a learned component; a network the build does not have is never drawn working. Show it by the source's numbers, or as a box`,
    );
  if (!shown) return out;
  const res = methodWords(shown);
  if (!members) {
    // A stage: its label names the operation whose output it shows, so the picture is never
    // credited to another part of the method. A layer no operation made (a crop) names none.
    if (res.length && !res.some((r) => r.test(words)))
      out.push(
        `${what} shows what an earlier scene computed, and its label does not name that operation; a stage shows a computed layer only under the name of the operation that made it`,
      );
    return out;
  }
  if (!res.length) {
    out.push(
      `${what} shows a ${shown.kind} scene's layer, which is no operation's output; a lane shows what an earlier \`operate\` or \`evolve\` scene computed`,
    );
    return out;
  }
  if (!res.some((r) => r.test(words)))
    out.push(
      `${what} shows what an earlier scene computed, and neither its family nor its members name that operation. A lane shows a computed layer only under the method that IS it; show any other family by its numbers`,
    );
  const apart = members.filter(
    (m) =>
      !res.some((r) => r.test(m)) && !ps.some((p) => named(p, m) && res.some((r) => r.test(p))),
  );
  if (apart.length)
    out.push(
      `${what} names ${apart.map((m) => `"${m}"`).join(", ")}, which the source never names beside the operation its picture computed; the picture would be credited to them`,
    );
  return out;
}

/** What makes two consecutive beats the same slide: the verb, its form and its operand. */
function repetitionKey(lit: Literal): string {
  switch (lit.kind) {
    case "operate":
      return `operate|${lit.picture ?? (lit.vectors.length ? "vectors" : "matrix")}`;
    case "evolve":
      return `evolve|${lit.rule}|${lit.input?.from ?? lit.picture ?? "values"}`;
    case "flow":
      return `flow|${lit.form}`;
    case "place":
      return `place|${placeForm(lit)}|${lit.axes.map((a) => a.name).join("·")}`;
    case "region":
      return `region|${lit.picture}`;
    default:
      return lit.kind;
  }
}

/** The forms that draw words and numbers only: once a deck each. */
function wordForm(lit: Literal): string | undefined {
  if (lit.kind !== "place") return undefined;
  const f = placeForm(lit);
  if (f !== "points") return `place ${f}`;
  return lit.form === "strip" ? "place strip" : undefined;
}

/**
 * A literal scene's own checks at plan time, run as the build runs it: the
 * scene's region (`bespokeRegion`, from the beat's headline and eyebrow) and the
 * deck's theme and language face, once per format size a deck can be built in.
 * Each problem once, with the formats it fails in.
 */
function gateProblems(beat: Beat, lit: Literal, storyboard: Storyboard): string[] {
  const { theme } = deckLook({ theme: storyboard.theme ?? "ink", lang: storyboard.lang ?? "en" });
  const eyebrow = lit.labels.find((l) => l.slot === "eyebrow")?.text.trim() || undefined;
  const params = beat.params as Record<string, unknown> | undefined;
  const staged = {
    ...beat,
    params: { ...params, headline: String(params?.headline ?? "") },
  } as Beat;
  const seen = new Map<string, string[]>();
  const sizes = new Set<string>();
  for (const format of Object.values(FORMATS)) {
    const region = bespokeRegion(staged, { format, theme }, eyebrow);
    const key = `${region.width}x${region.height}`;
    if (sizes.has(key)) continue;
    sizes.add(key);
    for (const p of drawProblems(lit, region, theme))
      seen.set(p, [...(seen.get(p) ?? []), format.id]);
  }
  return [...seen].map(([p, ids]) => ` in ${ids.join(", ")}: ${p}`);
}

/** The earlier beat a scene names (`from`, `show`, a recap's), checked to have drawn what it needs. */
function earlierProblem(
  beats: readonly Beat[],
  i: number,
  id: string,
  what: string,
  ok: (prior: Literal) => boolean,
  need: string,
): string | undefined {
  const j = beats.findIndex((b) => b.id === id);
  const prior = beats[j]?.literal;
  if (j < 0 || j >= i || !prior)
    return `${what} names "${id}", which is not an earlier beat drawn as a literal scene`;
  if (!ok(prior)) return `${what} names "${id}", a ${prior.kind} scene, which leaves ${need}`;
  return undefined;
}

/** A scene whose content is read off the paper's own figure: a region's marks, a figure trace. */
const readsOff = (lit: Literal) =>
  lit.kind === "region" || (lit.kind === "evolve" && lit.rule === "trace" && !!lit.picture);

type GroundingCtx = { text: string; ps: string[]; seq: number[]; stated: ReadonlySet<string> };
const groundingCtx = (source: Source): GroundingCtx => ({
  text: bindingText(source),
  ps: passages(source).map(normalizeTex),
  seq: numberSequence(sourceText(source)),
  stated: sourceNumbers(source),
});

/** Words no paper decides, by deck language; any other language gets the slot's English name. */
const STOCK: Record<"example" | "input" | "output", Record<string, string>> = {
  example: { ko: "예시", ja: "例", zh: "示例" },
  input: { ko: "입력", ja: "入力", zh: "输入" },
  output: { ko: "출력", ja: "出力", zh: "输出" },
};

/**
 * Fills the slots whose words the code knows (2026-10-15): the `example` tag on
 * a scene running on example material, and an op chain's `input` and `output`
 * titles. Left to the planner, FlashAttention's b02 (unseen-paper round 15) was
 * refused for its missing tag alone, and its b11 first for a chain's `input`. A
 * slot the planner did fill is kept as written.
 */
export function withStockLabels(storyboard: Storyboard, source: Source): Storyboard {
  const lang = storyboard.lang.split("-")[0] ?? "en";
  const word = (slot: keyof typeof STOCK) => STOCK[slot][lang] ?? slot;
  let ctx: GroundingCtx | undefined;
  const ctxOf = () => {
    ctx ??= groundingCtx(source);
    return ctx;
  };
  return {
    ...storyboard,
    beats: storyboard.beats.map((beat) => {
      const lit = beat.literal;
      if (!lit) return beat;
      const has = (slot: string) => lit.labels.some((l) => l.slot === slot && l.text.trim());
      const missing: (keyof typeof STOCK)[] = [];
      if (lit.kind === "operate" && !lit.terms && lit.chain.length)
        missing.push(...(["input", "output"] as const).filter((s) => !has(s)));
      if (!has("example") && verbGrounding(lit, source, ctxOf()).example) missing.push("example");
      const slots = literalSlotsOf(lit.kind);
      if (!missing.some((s) => slots[s])) return beat;
      const labels = [
        ...lit.labels.filter((l) => !missing.includes(l.slot as keyof typeof STOCK)),
        ...missing.filter((s) => slots[s]).map((slot) => ({ slot, text: word(slot) })),
      ];
      return { ...beat, literal: { ...lit, labels } };
    }),
  };
}

/**
 * The literal-scene checks no schema can express. Run on every plan; a plan
 * with no `literal` has nothing to find.
 *
 * `takeaways` asks for a takeaway on every beat but the title, which is what a
 * plan shown the field (src/plan/codex.ts) was asked for. `panels`, when the
 * caller could read the figures, holds a `region`'s `panel` to the panels the
 * build will find.
 */
export function literalFindings(
  storyboard: Storyboard,
  source: Source,
  /** `panels`: each source figure's panel count as the build finds it (`figurePanels`). */
  opts: {
    takeaways?: boolean;
    panels?: Readonly<Record<string, number>>;
  } = {},
): string[] {
  const out: string[] = [];
  const beats = storyboard.beats;
  if (opts.takeaways) {
    const bare = beats.filter((b) => b.archetype !== "title" && !b.takeaway?.trim());
    if (bare.length)
      out.push(
        `Beats ${bare.map((b) => b.id).join(", ")} carry no \`takeaway\`. Every beat but the title states the one thing the viewer can explain after it.`,
      );
  }
  let ctx: GroundingCtx | undefined;
  const ctxOf = () => {
    ctx ??= groundingCtx(source);
    return ctx;
  };
  let prevKey: { id: string; key: string } | undefined;
  beats.forEach((beat, i) => {
    const lit: Literal | undefined = beat.literal;
    if (!lit) {
      prevKey = undefined;
      return;
    }
    const c = ctxOf();
    const at = `${beat.id}'s ${lit.kind} scene`;
    // Every word on screen — labels, step names, items, cells — carries only the source's numbers.
    const said = unstated(literalTexts(lit), c.stated);
    if (said.length)
      out.push(
        `${at} says ${said.map((n) => `"${n}"`).join(", ")}, which the source never states. A scene's words carry only the source's numbers.`,
      );
    for (const p of literalSlotProblems(lit.kind, lit.labels)) out.push(`${at} ${p}.`);
    const rules = LITERAL_KIND_DOCS[lit.kind];
    if (rules.mustNotClaim?.length) {
      const src = sourceText(source).toLowerCase();
      const drawn = literalTexts(lit).filter(
        (t) => t.trim() && !src.includes(t.trim().toLowerCase()),
      );
      for (const p of literalTruthProblems(rules, [
        beat.takeaway ?? "",
        ...lit.labels.map((l) => l.text),
        ...drawn,
      ]))
        out.push(`${at} ${p}.`);
    }
    // The numbers in their roles, the variants in their words, the inputs by where they come from.
    const g = verbGrounding(lit, source, c);
    for (const p of g.problems) out.push(`${at}: ${p}.`);
    const tag = lit.labels.find((l) => l.slot === "example")?.text.trim();
    if (g.example && !tag)
      out.push(
        `${at} runs on example material (a picture, an unprinted input, a degradation, a split the source does not state), so it needs the \`example\` slot: a tag in the deck's language saying it is an example.`,
      );
    if (tag && !EXAMPLE_WORD.test(tag))
      out.push(
        `${at}'s \`example\` tag "${tag}" does not say "example" (example · 예시 · 例 · 示例).`,
      );
    // A computed value is printed only where every input is the source's.
    const vars = lit.labels.filter((l) => /\{(?:max|sum|mean)\}/.test(l.text));
    if (vars.length && g.example)
      out.push(
        `${at} prints a computed value (${vars.map((l) => l.slot).join(", ")}) on example material; that number would read as the paper's. Remove it, or give inputs the source prints.`,
      );
    if (beat.archetype === "title") {
      out.push(
        `${beat.id} is the title and carries \`literal\`. A title names the deck; it draws no mechanism.`,
      );
      return;
    }
    // The picture it runs on, and the earlier scenes it brings back.
    const pic = "picture" in lit ? lit.picture : undefined;
    if (pic !== undefined) {
      const j = beats.findIndex((b) => b.id === pic);
      const owner = beats[j];
      // NAME THE BEATS THAT CARRY ONE (2026-10-18). Chinchilla's b07 named
      // "fig1", a figure, while b05 carried it; told only "not a beat", the
      // scene redraw — which cannot give a beat a figure — was dropped.
      const carriers = beats.slice(0, i + 1).filter(hasPicture);
      const byFigure = carriers.find((b) => figureIds(b).includes(pic));
      const which = byFigure
        ? `"${pic}" is a figure; ${byFigure.id} carries it, so name ${byFigure.id}.`
        : carriers.length
          ? `Name one that carries a picture: ${carriers.map((b) => b.id).join(", ")}.`
          : "No beat up to this one carries a picture: draw it without one.";
      if (!owner || j > i)
        out.push(
          `${at} runs on the picture of "${pic}", which is ${owner ? "a later beat" : "not a beat in this plan"}. ${which}`,
        );
      else if (!hasPicture(owner))
        out.push(
          `${at} runs on the picture of "${pic}", which has none. Give that beat a figure or an illustration brief, or ${which[0]?.toLowerCase()}${which.slice(1)}`,
        );
      else if (readsOff(lit)) {
        // A region's things and a figure trace's rows are read off the paper's own
        // figure, in ONE panel: on a whole multi-panel figure the locator's boxes
        // missed (measured 2026-10-13: 0 of 3 on a four-panel figure, 11 of 11 on
        // single panels).
        const what = lit.kind === "region" ? "marks things in" : "reads its trace off";
        const own = figureIds(owner).filter(
          (id) =>
            !id.startsWith(GENERATED_FIGURE_PREFIX) && source.figures.some((f) => f.id === id),
        );
        const fig = own.find((id) => opts.panels?.[id] !== undefined);
        const n = fig === undefined ? undefined : opts.panels?.[fig];
        const panel = (lit as { panel?: number }).panel;
        if (!own.length)
          out.push(
            `${at} ${what} "${pic}", which shows none of the source's own figures. Name the beat that cites the paper's figure.`,
          );
        // A trace is read off the whole figure as well as off a panel of it.
        else if (n !== undefined && n > 1 && panel === undefined && lit.kind === "region")
          out.push(
            `${at} ${what} ${fig}, which has ${n} panels: give \`panel\` (1–${n}, reading order), the one it is in.`,
          );
        else if (n !== undefined && panel !== undefined && panel > n)
          out.push(
            `${at} ${what} panel ${panel} of ${fig}, which has ${n}. Give \`panel\` 1–${n}.`,
          );
      }
    }
    const refs: Array<[string, string, (p: Literal) => boolean, string]> = [];
    if (lit.kind === "evolve" && lit.input?.from)
      refs.push([
        lit.input.from,
        "its input",
        (p) => p.kind === "operate",
        "no computed tiles to stream (name an operate beat)",
      ]);
    if (lit.kind === "flow")
      for (const s of lit.stages)
        if (s.show) refs.push([s.show, `stage "${s.label}"`, leavesPicture, "no picture to show"]);
    if (lit.kind === "prior-work")
      for (const l of lit.lanes)
        if (l.from) refs.push([l.from, `lane "${l.family}"`, leavesPicture, "no picture to show"]);
    if (lit.kind === "recap") {
      if (!lit.beats.length) out.push(`${beat.id}'s recap names no beats.`);
      for (const id of lit.beats)
        refs.push([
          id,
          "the recap",
          leavesPicture,
          "no picture to bring back. Name earlier scenes that computed a picture",
        ]);
    }
    for (const [id, what, ok, need] of refs) {
      const why = earlierProblem(beats, i, id, what, ok, need);
      if (why) out.push(`${at}: ${why}.`);
    }
    // A computed layer shown under a name is credited to that name.
    const shownBy = (id: string) => beats.slice(0, i).find((b) => b.id === id)?.literal;
    if (lit.kind === "flow")
      for (const s of lit.stages)
        if (s.show)
          for (const p of creditProblems(
            shownBy(s.show),
            `${s.label} ${s.shape ?? ""}`,
            undefined,
            c.ps,
            `stage "${s.label}"`,
          ))
            out.push(`${at}: ${p}.`);
    if (lit.kind === "prior-work")
      for (const l of lit.lanes)
        if (l.from)
          for (const p of creditProblems(
            shownBy(l.from),
            `${l.family} ${l.members}`,
            namesIn(l.members),
            c.ps,
            `lane "${l.family}"`,
          ))
            out.push(`${at}: ${p}.`);
    if (lit.kind === "table") {
      if (!lit.columns.length || !lit.rows.length)
        out.push(`${beat.id}'s table has no ${lit.columns.length ? "rows" : "columns"}.`);
      const bad = lit.highlight.filter(
        (h) => !Number.isInteger(h) || h < 0 || h >= lit.rows.length,
      );
      if (bad.length)
        out.push(
          `${beat.id}'s table highlights row ${bad.join(", ")}, which it does not have (rows count from 0).`,
        );
      const off = lit.marks.filter(
        (m) => !(lit.rows[m.row] && m.col >= 0 && m.col < (lit.rows[m.row] as string[]).length),
      );
      if (off.length)
        out.push(
          `${beat.id}'s table marks ${off.map((m) => `(${m.row}, ${m.col})`).join(", ")}, which is no cell of it (rows and columns count from 0).`,
        );
    }
    if (lit.kind === "place" && lit.figure) {
      const fig = source.figures.find((f) => f.id === lit.figure);
      if (!fig || lit.figure.startsWith(GENERATED_FIGURE_PREFIX))
        out.push(
          `${beat.id}'s place shows figure "${lit.figure}", which is not one of the source's own figures.`,
        );
    }
    if (lit.kind === "place" && placeForm(lit) === "lengths") {
      const items = lit.lengths?.groups.flatMap((gr) => gr.items) ?? [];
      if (!items.length) out.push(`${beat.id}'s lengths have no values.`);
      const bad = items.filter((it) => !/^\d+(\.\d+)?$/.test(it.value) || !c.stated.has(it.value));
      if (bad.length)
        out.push(
          `${beat.id}'s lengths draw ${bad.map((it) => `"${it.value}"`).join(", ")}, which the source never states as a number. Lengths draw only values the source reports, written as it writes them.`,
        );
    }
    for (const p of wordGrounding(lit, source, c.text)) out.push(`${at} ${p}.`);
    // Drawn as the build draws it, in every format: a gate pass means the build draws it.
    for (const p of gateProblems(beat, lit, storyboard)) out.push(`${at} cannot be drawn${p}.`);
    // Two beats in a row with the same verb, form and operand are the same slide.
    const key = repetitionKey(lit);
    if (prevKey && prevKey.key === key)
      out.push(
        `${beat.id} draws the same scene as ${prevKey.id} (${key.replace(/\|/g, " ")}). Merge them into one scene (a longer chain, a \`compare\`), or draw the second another way.`,
      );
    prevKey = { id: beat.id, key };
  });
  // A SCENE THAT REPEATS ANOTHER IS THE LATER BEAT'S FINDING (2026-10-16), led by
  // its id so the scene pass owns it: redrawn on its own, or dropped if it stays.
  // Said of the deck ("The plan draws `place strip` 2 times"), it was no scene's,
  // so when two scenes redrawn side by side both came back as a strip,
  // FlashAttention's round 22 was refused after its scenes had settled.
  const tables = beats.filter((b) => b.literal?.kind === "table");
  for (const t of tables.slice(1))
    out.push(
      `${t.id} draws a table, and so does ${tables[0]?.id}. A table reads like a report: keep at most one, and draw this one as what it lists — results as \`place\` (margin or plane), what was and was not evaluated as \`place\` sets, experiments not run as \`place\` combos, earlier approaches as \`prior-work\`, reported costs as \`place\` length — or leave \`literal\` null where nothing is honest.`,
    );
  // The same example vectors in two operate beats are one chart drawn twice (r3 C: a
  // sampling rule's p and q again under the acceptance rate): run both chains on one.
  const byVectors = new Map<string, string[]>();
  for (const b of beats) {
    const l = b.literal;
    if (l?.kind !== "operate" || !l.vectors.length) continue;
    const key = JSON.stringify(l.vectors.map((v) => v.values));
    byVectors.set(key, [...(byVectors.get(key) ?? []), b.id]);
  }
  for (const [first, ...rest] of byVectors.values())
    for (const id of rest)
      out.push(
        `${id} runs operate on the same vectors as ${first}, so the deck shows one chart twice. Give its chain to ${first} (one longer chain), or draw ${id} another way.`,
      );
  const forms = new Map<string, string[]>();
  for (const b of beats) {
    const f = b.literal && wordForm(b.literal);
    if (f) forms.set(f, [...(forms.get(f) ?? []), b.id]);
  }
  for (const [f, [first, ...rest]] of forms)
    for (const id of rest)
      out.push(
        `${id} draws \`${f}\`, as ${first} already does. It draws no picture, so a second one is the same slide again: draw ${id} another way, or with \`literal\` null.`,
      );
  return out;
}
