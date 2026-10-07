#!/usr/bin/env node
/**
 * The M4 motion metrics, classic against v2, over stored HypePaper runs.
 *
 *   npm run build
 *   node experiments/019-motion/stats.mjs ~/.blackhole/HypePaper/2026-10-0[4-7]/decksmith/runs/*\/*.*
 *
 * Each argument is a run directory holding storyboard.json, source.json and
 * (optionally) audio/narration.json. EMIT ONLY: no Chrome, no codex, no TTS —
 * the same storyboard and narration built both ways, so the difference is the
 * design and nothing else. Prints one line per design.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  emitDeck,
  FORMATS,
  motionStats,
  narrationSchema,
  sourceSchema,
  storyboardSchema,
} from "../../dist/index.js";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const agg = {};
for (const design of ["classic", "v2"]) agg[design] = { decks: 0, scenes: 0, modal: 0, emph: 0, tweens: 0, eases: {}, kinds: [] };

for (const dir of process.argv.slice(2)) {
  if (!existsSync(join(dir, "storyboard.json"))) continue;
  const storyboard = storyboardSchema.parse(read(join(dir, "storyboard.json")));
  const source = sourceSchema.parse(read(join(dir, "source.json")));
  const np = join(dir, "audio", "narration.json");
  const narration = existsSync(np) ? { ...narrationSchema.parse(read(np)), dir: "audio" } : undefined;
  for (const design of ["classic", "v2"]) {
    const a = agg[design];
    const deck = emitDeck(storyboard, source, FORMATS["deck-16x9"], "", {
      design,
      ...(narration ? { narration } : {}),
      onBeatError: () => {},
    });
    const s = motionStats(deck.composition);
    a.decks++;
    a.scenes += s.scenes;
    a.modal += s.modalScenes;
    a.emph += s.emphasisScenes;
    a.tweens += s.tweens;
    for (const [k, v] of Object.entries(s.eases)) a.eases[k] = (a.eases[k] ?? 0) + v;
    if (s.scenes >= 10) a.kinds.push(new Set(s.seams).size);
  }
}

for (const [design, a] of Object.entries(agg)) {
  const counts = Object.entries(a.eases).sort((x, y) => y[1] - x[1]);
  const top2 = ((counts[0]?.[1] ?? 0) + (counts[1]?.[1] ?? 0)) / a.tweens;
  const kinds = [...a.kinds].sort((x, y) => x - y);
  const pct = (n) => `${(100 * n).toFixed(1)}%`;
  console.log(
    `${design}: ${a.decks} decks, ${a.scenes} scenes — modal entrance ${pct(a.modal / a.scenes)}, ` +
      `scenes with emphasis ${pct(a.emph / a.scenes)}, ` +
      `top-2 ease ${pct(top2)} (${counts.slice(0, 3).map(([k, v]) => `${k} ${pct(v / a.tweens)}`).join(", ")}), ` +
      `seam kinds per 10+ beat deck min ${kinds[0]} median ${kinds[Math.floor(kinds.length / 2)]} (n=${kinds.length})`,
  );
}
