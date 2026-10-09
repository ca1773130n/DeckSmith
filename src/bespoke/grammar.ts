/**
 * SHOT GRAMMARS: how the shell's camera tells one illustrated scene, chosen per
 * beat by what the narration is doing, and never the same on two scenes in a row.
 *
 * WHY. Round 4 staged every illustrated scene in one grammar — the whole
 * picture, a push in on each subject the voice names, the whole again. That is
 * how an explainer cuts one shot, and also, scene after scene, the "same
 * animation every card" the founder dislikes, one level up. An explainer
 * editor picks the move by the sentence: two things weighed against each other
 * get a rack between them; a process gets a camera that travels along it; a
 * "turns out" gets a close detail that pulls back to show where it sits; a
 * number gets a hard cut to the thing measured. So does this file:
 *
 *   tour      establish → push in on each named subject → reveal (round 4's)
 *   follow    establish → push in on the first subject → TRACK along the
 *             others at one scale, slow and continuous (a process, a pipeline)
 *   rack      establish → A → whip to B → back to A → a two-shot of both →
 *             reveal (a comparison, a cause and its effect)
 *   zoom-out  OPENS CLOSE on the key detail, pulls back to a two-subject
 *             frame, then to the whole (a reveal of context)
 *   wipe      the picture is wiped on subject by subject as the voice names
 *             each, the camera wide and creeping (a reveal, a sequence)
 *   cutaway   wide, and HARD CUTS to a close insert of what is measured, then
 *             back (a number, a detail)
 *   parallax  a slow lateral truck across the scene at a medium scale, the
 *             backdrop sliding slower than the subjects (a setting, a definition)
 *
 * The role is read from the beat deterministically (archetype, then the
 * narration's own words in en/ko/zh/ja); the grammar is the role's best fit
 * that the deck has not just used. `chooseGrammar` is a pure function of the
 * role and the grammars before it, so it slots into the up-front, deck-order
 * device pass (`assignDevices`) as one more field beside a beat's device.
 */

/** What the narration of a beat is doing, rhetorically. */
export type Role = "compare" | "cause" | "process" | "reveal" | "quantify" | "define";

export const ROLES: readonly Role[] = [
  "compare",
  "cause",
  "process",
  "reveal",
  "quantify",
  "define",
];

/** How the shell's camera tells an illustrated scene. */
export type Grammar = "tour" | "follow" | "rack" | "zoom-out" | "wipe" | "cutaway" | "parallax";

export const GRAMMARS: readonly Grammar[] = [
  "tour",
  "follow",
  "rack",
  "zoom-out",
  "wipe",
  "cutaway",
  "parallax",
];

/** Each role's grammars, best fit first. Every grammar appears for every role, so a choice always exists. */
export const FIT: Readonly<Record<Role, readonly Grammar[]>> = {
  compare: ["rack", "cutaway", "parallax", "tour", "zoom-out", "wipe", "follow"],
  cause: ["follow", "rack", "wipe", "zoom-out", "tour", "cutaway", "parallax"],
  process: ["follow", "wipe", "parallax", "tour", "rack", "cutaway", "zoom-out"],
  reveal: ["zoom-out", "wipe", "parallax", "cutaway", "tour", "rack", "follow"],
  quantify: ["cutaway", "zoom-out", "rack", "tour", "wipe", "parallax", "follow"],
  define: ["parallax", "tour", "zoom-out", "wipe", "cutaway", "rack", "follow"],
};

/** An archetype's usual role: what the fixed layout it replaces was drawn to say. */
const ARCHETYPE_ROLE: Readonly<Record<string, Role>> = {
  "split-compare": "compare",
  "bar-compare": "compare",
  pipeline: "process",
  stack: "process",
  "equation-walk": "process",
  "equation-morph": "cause",
  "line-chart": "quantify",
  "data-table": "quantify",
  callout: "reveal",
  "claim-figure": "reveal",
  "annotated-figure": "define",
  grid: "define",
  title: "define",
};

/**
 * The narration's own signals, per role, in the four languages decks are
 * written in. Each match adds one to the role; the archetype adds two.
 */
const CUES: Readonly<Record<Role, readonly RegExp[]>> = {
  compare: [
    /\b(vs\.?|versus|compared?|than|whereas|unlike|instead of|rather than|outperform\w*|beats?)\b/i,
    /비해|보다|대비|반면|달리|비교/,
    /相比|比起|对比|而不是|优于|不同于/,
    /比べ|より|一方|に対して|対照/,
  ],
  cause: [
    /\b(because|so that|leads? to|causes?|therefore|results? in|due to|which means|hence)\b/i,
    /때문|따라서|그래서|결과|덕분|이어진/,
    /因为|导致|所以|因此|从而|使得/,
    /ため|結果|引き起こ|よって|だから|つながる/,
  ],
  process: [
    /\b(step|then|first|next|finally|pipeline|stage|loop|iterat\w*|each round|in turn)\b/i,
    /단계|다음|먼저|마지막|반복|과정|순서/,
    /步骤|然后|首先|接着|最后|流程|迭代|循环/,
    /ステップ|次に|まず|最後|繰り返|手順|段階/,
  ],
  reveal: [
    /\b(actually|turns out|hidden|surprising\w*|the key|insight|in fact|secret|really)\b/i,
    /사실|숨은|놀랍|핵심|알고 보니|실제로/,
    /实际上|其实|关键|隐藏|竟然|事实上/,
    /実は|実際|鍵|隠れ|意外|本当は/,
  ],
  quantify: [
    /\d+(\.\d+)?\s*(%|x\b|times\b|points?\b|ms\b|percent)/i,
    /\d+(\.\d+)?\s*(배|퍼센트|포인트|점)/,
    /\d+(\.\d+)?\s*(倍|个百分点|分)/,
    /\d+(\.\d+)?\s*(倍|ポイント|パーセント)/,
  ],
  define: [
    /\b(is called|we call|defined? as|means|consists of|is a)\b/i,
    /라고 부|정의|란 |이란/,
    /称为|定义|是指|即/,
    /と呼ぶ|定義|とは/,
  ],
};

/** Archetypes that say little about the role: their prior counts one, not two. */
const GENERIC = new Set(["grid", "title", "annotated-figure"]);

/**
 * The role a beat plays: its archetype's prior (two, or one for a generic
 * layout) against the narration's own signals (each match one, at most three
 * per role). Ties go to the more specific role.
 */
export function roleOf(beat: {
  archetype: string;
  intent?: string;
  claim?: string;
  narration?: string;
}): Role {
  const text = [beat.intent, beat.claim, beat.narration].filter(Boolean).join(" \n ");
  const score = new Map<Role, number>(ROLES.map((r) => [r, 0]));
  const prior = ARCHETYPE_ROLE[beat.archetype];
  if (prior) score.set(prior, GENERIC.has(beat.archetype) ? 1 : 2);
  for (const r of ROLES) {
    let n = 0;
    for (const re of CUES[r])
      n += [...text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))].length;
    score.set(r, (score.get(r) ?? 0) + Math.min(3, n));
  }
  // Ties go to the earlier role in `ROLES`: compare, cause and process are the
  // specific ones, define the catch-all.
  let best: Role = "define";
  let top = 0;
  for (const r of ROLES) {
    const s = score.get(r) ?? 0;
    if (s > top) {
      best = r;
      top = s;
    }
  }
  return best;
}

/**
 * The grammar for a beat of role `role`, given the grammars of the illustrated
 * beats before it in deck order: best fit first, one the deck has not used,
 * else one not used by the last two — so never the previous one.
 * Deterministic.
 */
export function chooseGrammar(role: Role, prior: readonly Grammar[]): Grammar {
  // The previous grammar is always among the last two, and every role lists all
  // seven: a grammar outside the last two always exists.
  const recent = new Set(prior.slice(-2));
  const used = new Set(prior);
  const options = FIT[role];
  return options.find((g) => !used.has(g)) ?? options.find((g) => !recent.has(g)) ?? "tour";
}

/** `chooseGrammar` over a deck's beats in order. */
export function assignGrammars(roles: readonly Role[]): Grammar[] {
  const out: Grammar[] = [];
  for (const r of roles) out.push(chooseGrammar(r, out));
  return out;
}

/**
 * A deck's grammars as the gate reads them: how many distinct ones, and which
 * consecutive pairs repeat. `seq` is the deck's illustrated scenes in order.
 */
export function grammarRepeats(seq: readonly string[]): {
  distinct: number;
  adjacent: Array<[number, string]>;
} {
  const adjacent: Array<[number, string]> = [];
  for (let i = 1; i < seq.length; i++)
    if (seq[i] === seq[i - 1]) adjacent.push([i, seq[i] as string]);
  return { distinct: new Set(seq).size, adjacent };
}

/** The wanted diversity of `n` illustrated scenes: all different up to four, then at least four. */
export function diversityWanted(n: number): number {
  return Math.min(n, 4);
}

/** What the prompt tells a scene its grammar does, so its shot list and its own motion fit it. */
export const GRAMMAR_NOTES: Readonly<Record<Grammar, string>> = {
  tour: "ESTABLISHING on the whole picture, a PUSH IN on each subject the voice names (held, creeping), a REVEAL to the whole at the last cue",
  follow:
    "a short establishing shot, a push in on the first subject, then the camera TRACKS slowly along the others at one scale — the viewer travels along the process; the whole again at the last cue. Name the subjects in the order the process passes through them",
  rack: "establishing, then a RACK between two subjects — A, a quick whip to B, back to A — then a two-shot holding both, and the whole at the last cue. Shot list: the two subjects being weighed, A first",
  "zoom-out":
    "the scene OPENS CLOSE on one detail (the first subject in your shots) and PULLS BACK in two steps — to it and its neighbour, then to the whole — so the context is the reveal. Name the detail first",
  wipe: "the camera stays wide and creeps; the PICTURE IS WIPED ON left to right, each subject appearing as the voice names it (your shots say when). Do not reveal the picture yourself — no mask, clip or fade on it",
  cutaway:
    "wide, and on each shot a HARD CUT to a close insert of that subject, held, then a hard cut back to the wide — for the thing measured or the detail that matters",
  parallax:
    "a slow lateral TRUCK across the scene at a medium scale, the backdrop sliding slower than the subjects (depth), passing each subject as the voice names it; it settles on the whole at the last cue",
};
