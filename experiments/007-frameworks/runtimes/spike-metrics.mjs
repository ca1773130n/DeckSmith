// Spike: how wrong is DeckSmith's hand-rolled textWidth() heuristic vs real
// font metrics from opentype.js? This is the concrete "delete our code" case
// for the text-and-layout family (opentype.js / Satori).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';

const root = '/Users/neo/Developer/Projects/DeckSmith';
const dir = new URL('.', import.meta.url).pathname;

// bundle the real module (read-only: output goes into our own dir)
execSync(
  `${root}/node_modules/.bin/esbuild ${root}/src/emit/svg.ts --bundle --format=esm --platform=node --outfile=${dir}out/svg.mjs --log-level=error`,
  { cwd: root },
);
const { textWidth } = await import(dir + 'out/svg.mjs');

const font = opentype.parse(readFileSync(dir + 'out/inter-0.ttf').buffer);
// opentype.js 2.0 throws on Inter's ccmp lookup (substFormat 2, lookupType 6),
// so we sum glyph advances + kerning by hand instead of using getAdvanceWidth().
const scale = (size) => size / font.unitsPerEm;
const real = (s, size) => {
  const gs = [...s].map((c) => font.charToGlyph(c));
  let w = 0;
  for (let i = 0; i < gs.length; i++) {
    w += gs[i].advanceWidth || 0;
    if (i + 1 < gs.length) w += font.getKerningValue(gs[i], gs[i + 1]) || 0;
  }
  return w * scale(size);
};

const samples = [
  'Backpropagation', 'The chain rule, applied backwards', 'Reconstruction',
  'i', 'W', 'lll', 'MMM', 'Loss', 'Gradient descent converges',
  'f(x) = wx + b', '역전파 알고리즘', 'Attention Is All You Need',
  '1,234,567', 'AVAVAV',
];

let worst = 0;
let sum = 0;
const rows = [];
for (const s of samples) {
  const est = textWidth(s, 48);
  const act = real(s, 48);
  const err = act === 0 ? 0 : ((est - act) / act) * 100;
  sum += Math.abs(err);
  worst = Math.max(worst, Math.abs(err));
  rows.push(`${JSON.stringify(s).padEnd(38)} est=${est.toFixed(1).padStart(7)} real=${act.toFixed(1).padStart(7)} err=${err.toFixed(1).padStart(6)}%`);
}
console.log(rows.join('\n'));
console.log(`\nmean |err| = ${(sum / samples.length).toFixed(1)}%   worst = ${worst.toFixed(1)}%`);
console.log(`opentype.js parse+measure of 14 strings: deterministic by construction (pure integer glyph advances)`);
