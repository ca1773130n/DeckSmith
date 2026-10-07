/**
 * Layout sameness, classic against `--design v2`, over real storyboards.
 *
 *   npm run build
 *   node experiments/019-layout-variety/measure.mjs <run-dir>...
 *
 * A run dir is anything holding `storyboard.json` and `source.json` (HypePaper's
 * `runs/<run>/<paper>.<lang>/`). Each storyboard is laid out at deck-16x9 through
 * the real `emitDeck` path — the cut, then the Director — and its looks are
 * counted. No browser, no network, no LLM.
 *
 * Metrics, pooled over every beat of every deck:
 *   top4      share of beats on the four most-used signatures (archetype:variant@placement)
 *   modal     share of beats whose chrome sits on top of the slide (title excluded)
 *   adjacent  adjacent beat pairs, within a deck, with an identical signature
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classicLook,
  emitDeck,
  FORMATS,
  signature,
  sourceSchema,
  storyboardSchema,
  summarize,
} from "../../dist/index.js";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("usage: measure.mjs <run-dir>...");
  process.exit(2);
}
const format = FORMATS["deck-16x9"];
const pooled = { classic: [], v2: [] };
const adjacent = { classic: 0, v2: 0 };
const refusals = new Map();
let decks = 0;
let failed = 0;
for (const dir of dirs) {
  const sb = storyboardSchema.parse(JSON.parse(readFileSync(join(dir, "storyboard.json"), "utf8")));
  const src = sourceSchema.parse(JSON.parse(readFileSync(join(dir, "source.json"), "utf8")));
  let deck;
  try {
    deck = emitDeck(sb, src, format, "", { design: "v2", onBeatError: () => {} });
  } catch (err) {
    failed++;
    console.error(`${dir}: ${err.message}`);
    continue;
  }
  decks++;
  const classic = deck.looks.beats.map((b) => ({
    archetype: b.archetype,
    placement: classicLook(b.archetype).placement,
    signature: signature(b.archetype),
  }));
  pooled.classic.push(...classic);
  pooled.v2.push(...deck.looks.beats);
  adjacent.classic += summarize(classic).adjacentRepeats;
  adjacent.v2 += deck.looks.summary.adjacentRepeats;
  for (const b of deck.looks.beats) {
    for (const r of b.refused) {
      // Strip the beat id and the numbers so one reason counts once.
      const why = r.reason.replace(/^[a-z-]+ [^ :]+: /, "").replace(/\d+(\.\d+)?/g, "N");
      const key = `${r.signature} — ${why}`;
      refusals.set(key, (refusals.get(key) ?? 0) + 1);
    }
  }
}

const pct = (x) => `${(100 * x).toFixed(1)}%`;
console.log(`decks=${decks} failed=${failed}`);
for (const name of ["classic", "v2"]) {
  const s = summarize(pooled[name]);
  console.log(
    `${name.padEnd(8)} beats=${s.beats} signatures=${s.distinct} top4=${pct(s.top4)} modal=${pct(s.modalChrome)} adjacent=${adjacent[name]}`,
  );
}
const counts = new Map();
for (const b of pooled.v2) counts.set(b.signature, (counts.get(b.signature) ?? 0) + 1);
console.log("\nv2 signatures, most used first:");
for (const [sig, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 16)) {
  console.log(`  ${pct(n / pooled.v2.length).padStart(6)}  ${sig}`);
}
console.log("\nrefused candidates, most common reasons:");
for (const [k, n] of [...refusals].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(n).padStart(5)}  ${k}`);
}
