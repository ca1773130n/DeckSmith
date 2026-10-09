/**
 * Which beats get a bespoke scene. A deterministic rule, so the same storyboard
 * always asks the model about the same beats, and a cache hit is a cache hit.
 *
 * WHAT IS WORTH A MODEL CALL. A bespoke scene earns its cost where the fixed
 * vocabulary is weakest: a beat that explains a MECHANISM — a process, an
 * equation, a curve, a comparison — and that the narration talks over for many
 * seconds while the v2 archetype has finished building after five (measured in
 * the spike: v2's s3 and s7 froze for 15-20s of speech). Title cards, callouts
 * and tables say a thing rather than show one, so they never qualify.
 *
 * WHAT NEVER QUALIFIES, whatever it scores:
 *  - a beat with no narration: its cues are the keyframes, and without them a
 *    generated scene has nothing to stay in step with;
 *  - a beat a camera enters or leaves (`inside`): the dive is aimed at a part
 *    the archetype drew, which a bespoke scene does not draw;
 *  - a beat the planner marked `bespoke: false`.
 *
 * The planner's `bespoke: true` is a strong hint, not an order: it adds a large
 * bonus, so it wins a tie with anything, but an ineligible beat stays ineligible.
 */

import type { z } from "zod";
import { fnv1a } from "../emit/motion.js";
import type { Archetype, Beat, segmentSchema } from "../types.js";

type Segment = z.infer<typeof segmentSchema>;

/** How mechanical each archetype's subject usually is. Absent = never bespoke. */
const BASE: Readonly<Partial<Record<Archetype, number>>> = {
  pipeline: 3,
  "equation-walk": 3,
  "equation-morph": 3,
  "line-chart": 2.5,
  stack: 2.5,
  grid: 2,
  "split-compare": 2,
  "bar-compare": 1.5,
  "annotated-figure": 1,
  "claim-figure": 1,
};

/**
 * Words that say the beat explains how something works, in the four languages
 * the decks are built in. A hit is evidence, not proof: each distinct word adds
 * half a point, capped, so a beat cannot win on vocabulary alone.
 */
const MECHANISM = [
  // en
  "pipeline",
  "process",
  "step",
  "stage",
  "flow",
  "mechanism",
  "loss",
  "objective",
  "equation",
  "curve",
  "gradient",
  "attention",
  "encoder",
  "decoder",
  "align",
  "trade-off",
  "tradeoff",
  "versus",
  "compare",
  "converge",
  "scale",
  "update",
  "sample",
  "iterat",
  "propagat",
  "margin",
  "penal",
  "token",
  "layer",
  "feature",
  "distance",
  "how ",
  // ko
  "과정",
  "단계",
  "구조",
  "손실",
  "수식",
  "곡선",
  "비교",
  "정렬",
  "흐름",
  "메커니즘",
  "학습",
  "인코더",
  "디코더",
  "토큰",
  "거리",
  "마진",
  "벌점",
  "갱신",
  "샘플",
  // ja
  "仕組み",
  "過程",
  "段階",
  "損失",
  "式",
  "曲線",
  "比較",
  "流れ",
  "学習",
  "整合",
  "距離",
  "エンコーダ",
  "トークン",
  "更新",
  // zh
  "机制",
  "过程",
  "步骤",
  "损失",
  "公式",
  "曲线",
  "比较",
  "流程",
  "训练",
  "对齐",
  "距离",
  "编码器",
  "更新",
  "采样",
];

export interface Pick {
  beatId: string;
  score: number;
  /** Why it scored what it did, for `bespoke.json`. */
  why: string[];
}

export interface Skip {
  beatId: string;
  reason: string;
}

export interface Selection {
  picked: Pick[];
  skipped: Skip[];
}

export interface SelectOptions {
  /** Hashed with each beat id to break ties, so two decks tie differently. */
  seed: string;
  /** Narration, by beat id. A beat without segments is ineligible. */
  narration?: Readonly<Record<string, readonly Segment[]>>;
  /** Fewest beats to aim for when that many are eligible. Default 4. */
  min?: number;
  /** Most beats. Default 6; the call cap may lower it further. */
  max?: number;
}

/** The number of beats a deck of `n` kept beats aims for: a third, held to [min, max]. */
export function target(n: number, min = 4, max = 6): number {
  return Math.max(min, Math.min(max, Math.round(n / 3)));
}

export function selectBespoke(beats: readonly Beat[], opts: SelectOptions): Selection {
  const min = opts.min ?? 4;
  const max = opts.max ?? 6;
  const skipped: Skip[] = [];
  const scored: Pick[] = [];

  for (const [i, beat] of beats.entries()) {
    const base = BASE[beat.archetype];
    const segments = opts.narration?.[beat.id] ?? [];
    const cues = segments.reduce((n, s) => n + s.cues.length, 0);
    const camera = beat.inside !== undefined || beats[i + 1]?.inside?.beat === beat.id;
    const hint = beat.bespoke;

    if (hint === false) {
      skipped.push({ beatId: beat.id, reason: "the planner marked it bespoke:false" });
      continue;
    }
    if (base === undefined) {
      skipped.push({ beatId: beat.id, reason: `${beat.archetype} says rather than shows` });
      continue;
    }
    if (camera) {
      skipped.push({ beatId: beat.id, reason: "a camera move enters or leaves it" });
      continue;
    }
    if (segments.length === 0) {
      skipped.push({
        beatId: beat.id,
        reason: "no narration — nothing to keep in step with",
      });
      continue;
    }
    if (cues < 2) {
      skipped.push({ beatId: beat.id, reason: "one narration cue — nothing to build over" });
      continue;
    }

    const why = [`${beat.archetype} +${base}`];
    let score = base;
    const text = [
      beat.intent,
      beat.claim ?? "",
      (beat.params as { headline?: string }).headline ?? "",
      beat.narration ?? "",
    ]
      .join(" ")
      .toLowerCase();
    const hits = MECHANISM.filter((w) => text.includes(w));
    if (hits.length) {
      const add = Math.min(2, hits.length * 0.5);
      score += add;
      why.push(`mechanism words +${add} (${hits.slice(0, 4).join(", ")})`);
    }
    if (beat.evidence.some((e) => e.kind === "equation")) {
      score += 1;
      why.push("cites an equation +1");
    }
    score += beat.weight;
    why.push(`weight +${beat.weight}`);
    if (hint === true) {
      score += 10;
      why.push("planner hint +10");
    }
    scored.push({ beatId: beat.id, score: Math.round(score * 1000) / 1000, why });
  }

  // Highest score first; a tie goes to the hash, never to position, so the rule
  // does not quietly prefer the front of the deck.
  const tie = (id: string) => fnv1a(`${opts.seed}:${id}`);
  const ranked = [...scored].sort((a, b) => b.score - a.score || tie(a.beatId) - tie(b.beatId));
  const want = Math.min(target(beats.length, min, max), max);
  const picked = ranked.slice(0, want);
  for (const p of ranked.slice(want))
    skipped.push({ beatId: p.beatId, reason: `scored ${p.score}, below the ${want} chosen` });
  // In deck order, which is the order a reader of `bespoke.json` expects.
  const order = new Map(beats.map((b, i) => [b.id, i]));
  picked.sort((a, b) => (order.get(a.beatId) ?? 0) - (order.get(b.beatId) ?? 0));
  return { picked, skipped };
}
