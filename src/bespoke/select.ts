/**
 * Which beats get a bespoke scene: under `--design v2`, every beat that can
 * have one — title, numbers, comparisons and closing claims as well as
 * mechanisms. Until 2026-10-10 this picked 4-6 "mechanism" beats and left the
 * rest to the archetype templates; the founder's verdict on those ("why do I
 * need to see those hardcoded same UI blocks in every slide") is why the
 * templates are now only the fallback for a scene that fails its gates.
 *
 * WHAT NEVER QUALIFIES:
 *  - a beat with no narration cue: its cues are the keyframes, and without them
 *    a generated scene has nothing to stay in step with;
 *  - a beat a camera enters or leaves (`inside`): the dive is aimed at a part
 *    the archetype drew, which a bespoke scene does not draw;
 *  - a beat the planner marked `bespoke: false` that cites a figure or a table
 *    of the paper — the two reasons the planner is told a `false` is for (a
 *    real figure the viewer must see, a table read row by row).
 *
 * A `false` on a beat that cites NEITHER is not obeyed (2026-10-10). r3's
 * b12 was one: a comparison citing only a section, which the planner kept as
 * six grey row plates held still for 16 seconds — exactly the "hardcoded UI
 * blocks" the founder named, and with nothing the archetype had to keep.
 *
 * Deterministic, so the same storyboard always asks about the same beats and a
 * cache hit is a cache hit. When the call cap cannot pay two calls for every
 * beat (`max`), the most mechanical beats are drawn and the rest keep their
 * archetype. Picks come back in deck order.
 */

import type { z } from "zod";
import { fnv1a } from "../emit/motion.js";
import type { Archetype, Beat, segmentSchema } from "../types.js";

type Segment = z.infer<typeof segmentSchema>;

/**
 * How mechanical each archetype's subject usually is: the order beats are
 * picked in when the call cap cannot pay for all of them. Absent = 0.
 */
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
  /** Priority when the cap cannot pay for every beat. */
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
  /** Narration, by beat id. A beat without a cue is ineligible. */
  narration?: Readonly<Record<string, readonly Segment[]>>;
  /**
   * Most beats: what the call cap pays for at two calls a beat. When fewer
   * than the eligible, the most mechanical win (a mechanism gains most from a
   * scene that moves with the voice); the rest keep their archetype.
   */
  max?: number;
}

export function selectBespoke(beats: readonly Beat[], opts: SelectOptions): Selection {
  const scored: Pick[] = [];
  const skipped: Skip[] = [];
  for (const [i, beat] of beats.entries()) {
    const segments = opts.narration?.[beat.id] ?? [];
    const cues = segments.reduce((n, s) => n + s.cues.length, 0);
    const camera = beat.inside !== undefined || beats[i + 1]?.inside?.beat === beat.id;
    const keeps = beat.evidence.some((e) => e.kind === "figure" || e.kind === "table");
    if (beat.bespoke === false && keeps) {
      skipped.push({
        beatId: beat.id,
        reason: "the planner marked it bespoke:false, and it shows a figure or table of the paper",
      });
      continue;
    }
    if (camera) {
      skipped.push({ beatId: beat.id, reason: "a camera move enters or leaves it" });
      continue;
    }
    if (cues === 0) {
      skipped.push({ beatId: beat.id, reason: "no narration cue — nothing to keep in step with" });
      continue;
    }
    const base = BASE[beat.archetype] ?? 0;
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
    if (beat.bespoke === true) {
      score += 10;
      why.push("planner hint +10");
    }
    if (beat.bespoke === false) why.push("planner's false not kept: it cites no figure or table");
    scored.push({ beatId: beat.id, score: Math.round(score * 1000) / 1000, why });
  }

  // Highest score first; a tie goes to the hash, never to position.
  const tie = (id: string) => fnv1a(`${opts.seed}:${id}`);
  const ranked = [...scored].sort((a, b) => b.score - a.score || tie(a.beatId) - tie(b.beatId));
  const want = Math.max(0, opts.max ?? ranked.length);
  const picked = ranked.slice(0, want);
  for (const p of ranked.slice(want))
    skipped.push({
      beatId: p.beatId,
      reason: `scored ${p.score}; the call cap pays for ${want} beat(s)`,
    });
  // In deck order: the device pass and the budget spend in it.
  const order = new Map(beats.map((b, i) => [b.id, i]));
  picked.sort((a, b) => (order.get(a.beatId) ?? 0) - (order.get(b.beatId) ?? 0));
  return { picked, skipped };
}
