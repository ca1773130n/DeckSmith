/**
 * THE GATE — one function, both arms, all shipped code.
 *
 * PREREGISTERED §4. The primary metric is "zero errors from this", and the whole
 * reason it is written as one function over a deck DIRECTORY is that arm MENU's
 * deck and arm VOCAB's deck are then graded by the identical thing. The previous
 * attempt scored arm A's headlines by character count and arm B's by measured
 * geometry (`VOCABULARY-REVIEW` §3.3) and the two numbers were never comparable.
 *
 * It imports and re-implements nothing:
 *   check(dir)                 src/verify/check.ts — `npx hyperframes check --json`,
 *                              five passes (lint, runtime, layout, motion, contrast)
 *                              with the shipped camera-transit regrade.
 *   scanTypeFloor(html, file)  src/verify/typefloor.ts — invariant 5, the 40px floor,
 *                              read off the artifact rather than guessed from input.
 *
 * `decksmith build`'s narration, budget and diagrammatic scans are deliberately
 * NOT here: they take a `Storyboard` and have no arm-VOCAB counterpart, so
 * including them would put gates on one arm only. Arm MENU's full shipped verdict
 * is collected separately by `npm run score` and reported as secondary S4.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function gate(dir, bits, opts = {}) {
  const verdict = await bits.check(dir, { timeoutMs: opts.timeoutMs ?? 240_000 });
  const html = await readFile(join(dir, "index.html"), "utf8").catch(() => "");
  const type = html ? bits.scanTypeFloor(html, "index.html") : [];
  // 017 §4 folds fidelity into the primary: a deck whose diagram never appears is
  // not clean, however many other gates it satisfies. Only when `bits` exports it,
  // so 015 can still be re-run against its own pre-registration unchanged.
  const fid = bits.fidelity && opts.fidelity !== false ? await bits.fidelity(dir) : undefined;
  const findings = [...type, ...verdict.findings, ...(fid?.findings ?? [])];
  const errors = findings.filter((f) => f.severity === "error");
  return {
    clean: errors.length === 0,
    errors: errors.length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    rules: [...new Set(errors.map((f) => `${f.gate}/${f.rule}`))].sort(),
    // S5: the new gate's contribution, separable from check's.
    fidelityErrors: (fid?.findings ?? []).filter((f) => f.severity === "error").length,
    findings,
  };
}
