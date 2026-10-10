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
 * Also here, because they share the repair round: the literal-scene checks a
 * schema cannot express (a picture that names a beat with no picture, a table
 * cell holding a number the source never states, a claim a kind's truth rules
 * forbid).
 */
import type { Beat, BeatPart, Literal, LiteralKindDoc, Source, Storyboard } from "../types.js";
import { beatPartSchema, LITERAL_KIND_DOCS, literalSlotProblems } from "../types.js";

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
    /limitation|\blimits?\b|weakness|future|further|open (question|problem)|한계|향후|탐구|후속|제약|限界|今後|局限|未来|未來|展望/i,
  ],
  [
    "prior-work",
    /related work|prior work|previous work|literature|background|existing (work|method|approach)|관련 ?연구|선행 ?연구|기존 ?연구|관련 ?작업|関連研究|先行研究|相关工作|相關工作/i,
  ],
  ["experiments", /experiment|evaluat|\bresults?\b|benchmark|실험|평가|実験|評価|实验|實驗|评估/i],
  [
    "method",
    /method|approach|architecture|\bhow\b.*\b(solve|address|work)|proposed|방법|기법|어떻게|제안|手法|方法|提案|提出/i,
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
 */
export function sourceParts(source: Source): SourcePart[] {
  const title = source.title.trim();
  const stack: Array<{ depth: number; part: BeatPart | undefined }> = [];
  const by = new Map<BeatPart, SourcePart["sections"]>();
  const seen = new Set<BeatPart>();
  for (const s of source.sections) {
    while (stack.length && (stack[stack.length - 1]?.depth ?? 0) >= s.depth) stack.pop();
    const inherited = [...stack].reverse().find((e) => e.part)?.part;
    const own = s.heading.trim() === title ? undefined : partOfHeading(s.heading);
    const part = inherited ?? own;
    stack.push({ depth: s.depth, part });
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
  for (const b of body) {
    if (!b.part) continue;
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
  return new Set(text.match(NUMBER) ?? []);
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
 * What breaks a kind's truth rules (src/types.ts `LiteralKindDoc`): a
 * requirement the source's text never meets, and a banned claim in `said`
 * (the beat's takeaway and the scene's labels) that no `unlessGiven` field of
 * `lit` lifts. Generic over the rules, so a kind gets its checks by carrying
 * them in its entry. Empty when it keeps them.
 */
export function literalTruthProblems(
  rules: Pick<LiteralKindDoc, "requires" | "mustNotClaim">,
  lit: object,
  said: readonly string[],
  source: string,
): string[] {
  const out: string[] = [];
  for (const r of rules.requires ?? [])
    if (!r.anyOf.some((re) => re.test(source)))
      out.push(`needs the source to give ${r.what}, and the source never does`);
  const given = (field: string) => {
    const v = (lit as Record<string, unknown>)[field];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null;
  };
  for (const b of rules.mustNotClaim ?? []) {
    if (b.unlessGiven?.some(given)) continue;
    const hits = [
      ...new Set(
        said.flatMap(
          (t) =>
            t.match(new RegExp(b.pattern.source, `${b.pattern.flags.replace("g", "")}g`)) ?? [],
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

/** The numbers in `texts` the source never states, once each. `{name}` (a computed value) is not a number. */
function unstated(texts: readonly string[], stated: ReadonlySet<string>): string[] {
  return [...new Set(texts.flatMap((t) => t.replace(/\{\w+\}/g, " ").match(NUMBER) ?? []))].filter(
    (n) => !stated.has(n),
  );
}

/** Every word a literal scene puts on screen, whatever its kind. */
function literalTexts(lit: Literal): string[] {
  const own = lit.labels.map((l) => l.text);
  if (lit.kind === "table") return [...own, ...lit.columns, ...lit.rows.flat()];
  if (lit.kind === "scale")
    return [
      ...own,
      ...lit.groups.flatMap((g) => [
        g.label,
        g.unit,
        ...g.items.flatMap((it) => [it.label, it.value]),
      ]),
    ];
  return own;
}

/**
 * The literal-scene checks no schema can express. Run on every plan; a plan
 * with no `literal` has nothing to find.
 *
 * `takeaways` asks for a takeaway on every beat but the title, which is what a
 * plan shown the field (src/plan/codex.ts) was asked for.
 */
export function literalFindings(
  storyboard: Storyboard,
  source: Source,
  opts: { takeaways?: boolean } = {},
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
  let stated: ReadonlySet<string> | undefined;
  let text: string | undefined;
  beats.forEach((beat, i) => {
    const lit: Literal | undefined = beat.literal;
    if (!lit) return;
    stated ??= sourceNumbers(source);
    // Every word on screen — labels, cells, scale names and values — carries only the source's numbers.
    const said = unstated(literalTexts(lit), stated);
    if (said.length)
      out.push(
        `${beat.id}'s ${lit.kind} scene says ${said.map((n) => `"${n}"`).join(", ")}, which the source never states. A scene's words carry only the source's numbers.`,
      );
    for (const p of literalSlotProblems(lit.kind, lit.labels))
      out.push(`${beat.id}'s ${lit.kind} scene ${p}.`);
    const rules = LITERAL_KIND_DOCS[lit.kind];
    if (rules.requires?.length || rules.mustNotClaim?.length) {
      text ??= sourceText(source);
      const said = [beat.takeaway ?? "", ...lit.labels.map((l) => l.text)];
      for (const p of literalTruthProblems(rules, lit, said, text))
        out.push(`${beat.id}'s ${lit.kind} scene ${p}.`);
    }
    if (beat.archetype === "title") {
      out.push(
        `${beat.id} is the title and carries \`literal\`. A title names the deck; it draws no mechanism.`,
      );
      return;
    }
    if ("picture" in lit) {
      const j = beats.findIndex((b) => b.id === lit.picture);
      const owner = beats[j];
      if (!owner || j > i)
        out.push(
          `${beat.id}'s ${lit.kind} scene runs on the picture of "${lit.picture}", which is ${owner ? "a later beat" : "not a beat in this plan"}. Name this beat or an earlier one that carries the picture.`,
        );
      else if (!hasPicture(owner))
        out.push(
          `${beat.id}'s ${lit.kind} scene runs on the picture of "${lit.picture}", which has none. Give that beat a figure or an illustration brief, or name a beat that has one.`,
        );
    } else if (lit.kind === "table") {
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
    } else if (lit.kind === "scale") {
      const items = lit.groups.flatMap((g) => g.items);
      if (!items.length) out.push(`${beat.id}'s scale has no values.`);
      const bad = items.filter(
        (it) => !/^\d+(\.\d+)?$/.test(it.value) || !(stated as ReadonlySet<string>).has(it.value),
      );
      if (bad.length)
        out.push(
          `${beat.id}'s scale draws ${bad.map((it) => `"${it.value}"`).join(", ")}, which the source never states as a number. A scale draws only values the source reports, written as it writes them.`,
        );
    } else if (lit.kind === "recap") {
      if (!lit.beats.length) out.push(`${beat.id}'s recap names no beats.`);
      for (const id of lit.beats) {
        const j = beats.findIndex((b) => b.id === id);
        if (j < 0 || j >= i || !beats[j]?.literal)
          out.push(
            `${beat.id}'s recap names "${id}", which is not an earlier beat drawn as a literal scene.`,
          );
      }
    }
  });
  return out;
}
