/**
 * The judging half: BUILD EVERY PLAN, then apply one gate to both arms.
 *
 * `node judge.mjs [runsDir=runs] [jobs=4]`
 *
 * PREREGISTERED §4. Arm MENU is built by the shipped `node dist/cli.js build`,
 * unedited, which is what a user runs; arm VOCAB by `emit.mjs`. Both deck
 * DIRECTORIES then go through `gate()` — the same `check()` + `scanTypeFloor()`
 * over the same five hyperframes passes — and the primary metric is zero errors
 * from that.
 *
 * Nothing here decides what a defect is. Every error counted came out of shipped
 * code. That is the one rule `scripts/score.mjs` was written to hold and this file
 * holds it too: the moment a harness starts judging, it becomes the thing it was
 * built to replace.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build as buildVocab, PlanError } from "./emit.mjs";
import { gate } from "./gate.mjs";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const DECKS = join(HERE, "out", "decks");

const bits = await import("./out/bits.mjs");
const source = bits.sourceSchema.parse(
  JSON.parse(readFileSync(join(REPO, "demo", "source.json"), "utf8")),
);

/* --------------------------------------------------------------- statistics */

/**
 * Fisher's exact test, two-tailed, computed rather than looked up.
 *
 * Sums the probability of every 2x2 table with the same margins whose probability
 * is no greater than the observed one — the standard two-tailed definition. It is
 * here because PREREGISTERED §7 branches on `p < 0.05` and a decision rule whose
 * input is an eyeballed table is not a decision rule.
 */
function fisher(a, b, c, d) {
  const lg = (n) => {
    let s = 0;
    for (let i = 2; i <= n; i++) s += Math.log(i);
    return s;
  };
  const p = (a, b, c, d) =>
    Math.exp(lg(a + b) + lg(c + d) + lg(a + c) + lg(b + d) - lg(a + b + c + d) - lg(a) - lg(b) - lg(c) - lg(d));
  const observed = p(a, b, c, d);
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  let total = 0;
  for (let i = Math.max(0, c1 - r2); i <= Math.min(r1, c1); i++) {
    const q = p(i, r1 - i, c1 - i, r2 - (c1 - i));
    if (q <= observed * (1 + 1e-9)) total += q;
  }
  return Math.min(1, total);
}

/* ------------------------------------------------------------------- builds */

async function buildMenu(planPath, out) {
  // The shipped verb, unedited, exactly as a user runs it. Its own verdict is
  // secondary S4; the primary metric comes from `gate()` over the directory it
  // wrote, so that both arms are graded by one function.
  const argv = [
    join(REPO, "dist", "cli.js"),
    "build",
    planPath,
    "--source",
    join(REPO, "demo", "source.json"),
    "-o",
    out,
    "--format",
    "deck-16x9",
    "--no-narration",
  ];
  try {
    const r = await run(process.execPath, argv, { cwd: REPO, maxBuffer: 32 << 20, timeout: 300_000 });
    return { ok: true, stdout: r.stdout, stderr: r.stderr, code: 0 };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message ?? "",
      code: err.code ?? 1,
    };
  }
}

/** `decksmith build`'s own PASS/FAIL line, for S4. */
function shippedVerdict(stdout) {
  const m = /^(PASS|FAIL) — (\d+) error\(s\), (\d+) warning\(s\)$/m.exec(stdout);
  if (!m) return null;
  return { passed: m[1] === "PASS", errors: Number(m[2]), warnings: Number(m[3]) };
}

/* -------------------------------------------------------------------- judge */

async function judgeOne(runDir, arm, i) {
  const rec = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"));
  const out = {
    arm,
    i,
    stage: rec.stage,
    ms: rec.ms,
    units: rec.units ?? null,
    jsonBytes: rec.jsonBytes ?? null,
    promptBytes: rec.promptBytes,
    schemaBytes: rec.schemaBytes,
    refsResolve: rec.refsResolve ?? null,
    schemaValid: rec.stage === "valid",
    infraLoss: rec.stage === "infra-loss",
    emitted: false,
    camera: null,
    clean: false,
    errors: null,
    warnings: null,
    rules: [],
    why: rec.stage === "valid" ? null : rec.stage,
    shipped: null,
  };
  if (rec.stage !== "valid") return out;

  const plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8"));
  out.camera =
    arm === "menu"
      ? (plan.beats ?? []).some((b) => b.inside)
      : (plan.scenes ?? []).some((s) => s.camera);

  const deck = join(DECKS, `${arm}-${String(i).padStart(2, "0")}`);
  mkdirSync(deck, { recursive: true });

  if (arm === "menu") {
    const r = await buildMenu(join(runDir, "plan.json"), deck);
    out.shipped = shippedVerdict(r.stdout);
    if (!existsSync(join(deck, "index.html"))) {
      out.why = "emit_failed";
      out.errors = 1;
      out.rules = ["build/emit_failed"];
      const tail = (r.stderr || r.stdout).trim().split("\n").slice(-2).join(" / ");
      out.detail = tail.slice(0, 400);
      return out;
    }
  } else {
    try {
      buildVocab(plan, deck, bits, { source });
    } catch (err) {
      // A refusal is a build failure against the plan, the same way `decksmith
      // build` fails on the class of defect its own emitters throw on.
      out.why = err instanceof PlanError ? "emit_refused" : "emit_threw";
      out.errors = 1;
      out.rules = [`build/${out.why}`];
      out.detail = String(err.message).slice(0, 400);
      return out;
    }
  }
  out.emitted = true;

  const g = await gate(deck, bits);
  out.clean = g.clean;
  out.errors = g.errors;
  out.warnings = g.warnings;
  out.rules = g.rules;
  out.findings = g.findings
    .filter((f) => f.severity === "error")
    .map((f) => `${f.gate}/${f.rule}: ${f.message.slice(0, 160)}`);
  if (!g.clean) out.why = "gate_errors";
  return out;
}

/* ---------------------------------------------------------------------- main */

const runsDir = join(HERE, process.argv[2] ?? "runs");
const jobs = Number(process.argv[3] ?? 4);
const entries = (await readdir(runsDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && /^(menu|vocab)-\d+$/.test(e.name))
  .map((e) => {
    const [arm, n] = e.name.split("-");
    return { dir: join(runsDir, e.name), arm, i: Number(n) };
  })
  .sort((a, b) => a.arm.localeCompare(b.arm) || a.i - b.i);

const results = new Array(entries.length);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(jobs, entries.length) }, async () => {
    for (;;) {
      const k = next++;
      if (k >= entries.length) return;
      const e = entries[k];
      results[k] = await judgeOne(e.dir, e.arm, e.i);
      const r = results[k];
      process.stderr.write(
        `  ${r.clean ? "CLEAN" : "DIRTY"}  ${r.arm}-${r.i}  ${r.errors ?? "-"} err  ${r.why ?? ""}  ${r.rules.join(",")}\n`,
      );
    }
  }),
);

/* ------------------------------------------------------------------ summary */

const per = (arm) => results.filter((r) => r.arm === arm);
const summarise = (arm) => {
  const all = per(arm);
  const infra = all.filter((r) => r.infraLoss);
  const counted = all.filter((r) => !r.infraLoss);
  const clean = counted.filter((r) => r.clean);
  const rules = {};
  for (const r of counted) for (const x of r.rules) rules[x] = (rules[x] ?? 0) + 1;
  const secs = counted.map((r) => r.ms / 1000).sort((a, b) => a - b);
  const bytesPerUnit = counted
    .filter((r) => r.jsonBytes && r.units)
    .map((r) => Math.round(r.jsonBytes / r.units))
    .sort((a, b) => a - b);
  const median = (xs) => (xs.length ? xs[Math.floor(xs.length / 2)] : null);
  return {
    launched: all.length,
    infraLoss: infra.length,
    n: counted.length,
    clean: clean.length,
    rate: counted.length ? Number((clean.length / counted.length).toFixed(4)) : null,
    schemaValid: counted.filter((r) => r.schemaValid).length,
    emitted: counted.filter((r) => r.emitted).length,
    refsResolve: counted.filter((r) => r.refsResolve === true).length,
    usedCamera: counted.filter((r) => r.camera === true).length,
    cleanWithCamera: counted.filter((r) => r.camera === true && r.clean).length,
    cleanWithoutCamera: counted.filter((r) => r.camera === false && r.clean).length,
    withoutCamera: counted.filter((r) => r.camera === false).length,
    onlyTypeFloor: counted.filter(
      (r) => r.rules.length === 1 && r.rules[0] === "typography/type_below_floor",
    ).length,
    medianSeconds: median(secs),
    medianJsonBytesPerUnit: median(bytesPerUnit),
    errorRules: Object.fromEntries(Object.entries(rules).sort((a, b) => b[1] - a[1])),
    shippedPass: counted.filter((r) => r.shipped?.passed).length,
    shippedReported: counted.filter((r) => r.shipped).length,
  };
};

const menu = summarise("menu");
const vocab = summarise("vocab");
const delta = vocab.rate !== null && menu.rate !== null ? Number((vocab.rate - menu.rate).toFixed(4)) : null;
const p =
  menu.n && vocab.n
    ? Number(fisher(menu.clean, menu.n - menu.clean, vocab.clean, vocab.n - vocab.clean).toFixed(5))
    : null;

/** PREREGISTERED §7, transcribed. Exactly one branch fires. */
function decide(pA, pB, d, pv) {
  if (pB >= 0.6 && d >= -0.1) return { rule: "R1", verdict: "BUILD THE VOCABULARY AND EXPOSE IT TO THE PLANNER" };
  if (d <= -0.25 && pv < 0.05) return { rule: "R2", verdict: "DO NOT EXPOSE IT TO THE PLANNER — measured downgrade" };
  if (d < -0.1) return { rule: "R3", verdict: "DO NOT EXPOSE IT YET — direction against, underpowered" };
  return { rule: "R4", verdict: "NEITHER ARM IS RELIABLE — the finding is about the pipeline" };
}

const decision = menu.rate !== null && vocab.rate !== null ? decide(menu.rate, vocab.rate, delta, p) : null;
const spec = JSON.parse(readFileSync(join(runsDir, "spec.json"), "utf8"));
const summary = { at: new Date().toISOString(), spec, menu, vocab, delta, fisherTwoTailed: p, decision };

mkdirSync(join(HERE, "out"), { recursive: true });
writeFileSync(join(HERE, "out", "results.json"), `${JSON.stringify({ summary, results }, null, 2)}\n`);

const row = (r) =>
  `${`${r.arm}-${String(r.i).padStart(2, "0")}`.padEnd(9)}  ${(r.clean ? "CLEAN" : "DIRTY").padEnd(5)}  ` +
  `${String(r.errors ?? "-").padStart(3)} err  ${String(r.units ?? "-").padStart(2)}u  ` +
  `${String(Math.round(r.ms / 1000)).padStart(4)}s  ${r.camera ? "cam" : "   "}  ${r.why ?? ""} ${r.rules.join(",")}`;
process.stdout.write(`${results.map(row).join("\n")}\n\n`);
process.stdout.write(
  `PRIMARY — gate-clean rate\n` +
    `  arm MENU   ${menu.clean}/${menu.n}  ${((menu.rate ?? 0) * 100).toFixed(1)}%   (${menu.infraLoss} infra loss)\n` +
    `  arm VOCAB  ${vocab.clean}/${vocab.n}  ${((vocab.rate ?? 0) * 100).toFixed(1)}%   (${vocab.infraLoss} infra loss)\n` +
    `  delta ${delta}   Fisher two-tailed p = ${p}\n` +
    `  ${decision?.rule}: ${decision?.verdict}\n`,
);
