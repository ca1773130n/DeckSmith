/**
 * A runnable front end for the drift gate, until `src/cli.ts` grows a
 * `decksmith drift` subcommand (that file is owned elsewhere).
 *
 *   npx esbuild experiments/009-gate/drift-cli.ts --bundle --platform=node \
 *     --format=esm --packages=external --outfile=experiments/009-gate/drift-cli.mjs
 *   node experiments/009-gate/drift-cli.mjs <built-deck-dir> [--identical] [--floor 40] [--keep]
 */
import { drift } from "../../src/verify/drift.js";

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("-"));
if (!dir) {
  console.error("usage: drift-cli <built-deck-dir> [--identical] [--floor <dB>] [--keep]");
  process.exit(2);
}
const floorAt = argv.indexOf("--floor");

const report = await drift(dir, {
  mode: argv.includes("--identical") ? "identical" : "psnr",
  ...(floorAt >= 0 ? { floorDb: Number(argv[floorAt + 1]) } : {}),
  keep: argv.includes("--keep"),
});

for (const f of report.findings) console.log(`${f.severity}: [${f.gate}/${f.rule}] ${f.message}`);
if (report.kept) console.log(`frames kept in ${report.kept.a} and ${report.kept.b}`);
console.log(
  `${report.passed ? "PASS" : "FAIL"} — mode=${report.mode} frames=${report.frames} identical=${report.identical}` +
    (report.worst ? ` worst=${report.worst.db.toFixed(2)}dB@${report.worst.frame}` : ""),
);
process.exit(report.passed ? 0 : 1);
