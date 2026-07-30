/**
 * The generation half. `node run.mjs <menu|vocab> <n> <concurrency>`
 *
 * One batch per arm, launched once, with NO interim analysis and no stopping rule
 * (PREREGISTERED §6). The batch size is fixed in the pre-registration, so there is
 * nothing to stop early and no optional stopping to bias the result.
 *
 * Everything is spawned exactly the way `src/plan/codex.ts:runCodex` spawns it —
 * same argv, same read-only sandbox, same `--ephemeral` — so the only thing that
 * differs between arms is the schema and the guidance. The MODEL AND REASONING
 * EFFORT ARE PINNED on the command line rather than left to the local Codex
 * config, because `VOCABULARY-REVIEW` §7 could not attribute the previous 26 runs
 * to any model: "run.mjs passes no --model; the numbers are tied to whatever the
 * local Codex default was on the day."
 *
 * It refuses to launch if the guidance byte budget is out of the ±10% band
 * (PREREGISTERED §2.1). A budget nothing enforces is not a budget.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { menuPrompt, measure, vocabPrompt } from "./prompt.mjs";
import { COMPOSITION_JSON_SCHEMA, compositionSchema, stripNulls } from "./vocab.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

/** Pinned, so every number in the report is attributable to one model. */
export const MODEL = "gpt-5.5";
export const EFFORT = "medium";

const bits = await import("./out/bits.mjs");
const source = bits.sourceSchema.parse(
  JSON.parse(readFileSync(join(REPO, "demo", "source.json"), "utf8")),
);

const ARMS = {
  menu: {
    schema: bits.SCHEMA,
    prompt: () => menuPrompt(bits, source),
    validate: (raw) => bits.storyboardSchema.safeParse(stripNulls(raw)),
    units: (v) => v.beats,
    refs: (v) => bits.assertRefsResolve(v, source),
  },
  vocab: {
    schema: COMPOSITION_JSON_SCHEMA,
    prompt: () => vocabPrompt(bits, source),
    validate: (raw) => compositionSchema.safeParse(stripNulls(raw)),
    units: (v) => v.scenes,
    // The arm-VOCAB analogue: every evidence id must exist in the source. Written
    // out rather than reused because `assertRefsResolve` walks `beats`.
    refs: (v) => {
      const ids = new Set([
        ...source.sections.map((s) => s.id),
        ...source.figures.map((f) => f.id),
        ...source.equations.map((e) => e.id),
        ...source.tables.map((t) => t.id),
      ]);
      for (const sc of v.scenes) {
        for (const e of sc.evidence ?? []) {
          if (!ids.has(e.id)) throw new Error(`scene ${sc.id} cites ${e.id}, which is not in the source`);
        }
        for (const o of sc.objects ?? []) {
          if (o.kind === "image" && o.figureId && !ids.has(o.figureId)) {
            throw new Error(`scene ${sc.id} draws figure ${o.figureId}, which is not in the source`);
          }
        }
      }
    },
  },
};

function runCodex({ prompt, schemaPath, outPath, timeoutMs = 15 * 60_000 }) {
  const argv = [
    "exec",
    "--output-schema",
    schemaPath,
    "-o",
    outPath,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "--model",
    MODEL,
    "-c",
    `model_reasoning_effort="${EFFORT}"`,
    "-",
  ];
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn("codex", argv, { stdio: ["pipe", "pipe", "pipe"], cwd: REPO });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: out, stderr: err, ms: Date.now() - t0 });
    });
    child.stdin.end(prompt);
  });
}

async function one(armName, i, dirRoot) {
  const arm = ARMS[armName];
  const dir = join(dirRoot, `${armName}-${String(i).padStart(2, "0")}`);
  mkdirSync(dir, { recursive: true });
  const schemaPath = join(dir, "schema.json");
  const outPath = join(dir, "out.json");
  const prompt = arm.prompt();
  writeFileSync(schemaPath, JSON.stringify(arm.schema));
  writeFileSync(join(dir, "prompt.txt"), prompt);

  const r = await runCodex({ prompt, schemaPath, outPath });
  writeFileSync(join(dir, "codex.log"), `${r.stdout}\n---STDERR---\n${r.stderr}`);

  const rec = {
    arm: armName,
    i,
    model: MODEL,
    effort: EFFORT,
    ms: r.ms,
    exit: r.code,
    promptBytes: Buffer.byteLength(prompt),
    schemaBytes: Buffer.byteLength(JSON.stringify(arm.schema)),
  };
  let raw = "";
  try {
    raw = readFileSync(outPath, "utf8");
  } catch {}
  rec.outBytes = Buffer.byteLength(raw);

  // PREREGISTERED §4: a run the CLI never answered is an INFRASTRUCTURE LOSS, not
  // a vocabulary failure. It is excluded from the denominator, counted separately,
  // and not re-run.
  if (r.code !== 0 || raw.trim() === "") {
    rec.stage = "infra-loss";
    writeFileSync(join(dir, "result.json"), JSON.stringify(rec, null, 2));
    return rec;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    rec.stage = "not-json";
    rec.error = String(e).slice(0, 300);
    writeFileSync(join(dir, "result.json"), JSON.stringify(rec, null, 2));
    return rec;
  }
  const v = arm.validate(parsed);
  if (!v.success) {
    rec.stage = "schema-fail";
    rec.issues = v.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`);
    writeFileSync(join(dir, "result.json"), JSON.stringify(rec, null, 2));
    return rec;
  }
  rec.stage = "valid";
  rec.units = arm.units(v.data).length;
  rec.jsonBytes = Buffer.byteLength(JSON.stringify(v.data));
  try {
    arm.refs(v.data);
    rec.refsResolve = true;
  } catch (e) {
    rec.refsResolve = false;
    rec.refsError = String(e.message).slice(0, 400);
  }
  // The validated, null-stripped plan is what gets built. Written beside the raw
  // capture rather than instead of it, so both are on disk.
  writeFileSync(join(dir, "plan.json"), `${JSON.stringify(v.data, null, 2)}\n`);
  writeFileSync(join(dir, "result.json"), JSON.stringify(rec, null, 2));
  return rec;
}

const [armName, nStr, cStr, tag] = process.argv.slice(2);
if (!ARMS[armName]) {
  process.stderr.write("usage: node run.mjs <menu|vocab> <n> <concurrency> [tag]\n");
  process.exit(2);
}

const spec = measure(bits, source, COMPOSITION_JSON_SCHEMA);
if (!spec.inBand) {
  process.stderr.write(
    `refusing to launch: arm VOCAB guidance is ${spec.vocab.guidance} B, outside the ` +
      `pre-registered band [${spec.band[0]}, ${spec.band[1]}] (PREREGISTERED §2.1).\n`,
  );
  process.exit(3);
}
process.stderr.write(
  `spec: menu guidance ${spec.menu.guidance} B + schema ${spec.menu.schema} B; ` +
    `vocab guidance ${spec.vocab.guidance} B (${spec.ratio}x) + schema ${spec.vocab.schema} B\n`,
);

const n = Number(nStr ?? 20);
const conc = Number(cStr ?? 5);
const dirRoot = join(HERE, tag ? `runs-${tag}` : "runs");
mkdirSync(dirRoot, { recursive: true });
writeFileSync(join(dirRoot, "spec.json"), `${JSON.stringify(spec, null, 2)}\n`);

const jobs = Array.from({ length: n }, (_, i) => i + 1);
const results = [];
await Promise.all(
  Array.from({ length: conc }, async () => {
    for (;;) {
      const i = jobs.shift();
      if (i === undefined) return;
      const r = await one(armName, i, dirRoot);
      results.push(r);
      process.stdout.write(
        `${armName}-${i} ${r.stage} ${(r.ms / 1000).toFixed(0)}s units=${r.units ?? "-"} refs=${r.refsResolve ?? "-"}\n`,
      );
    }
  }),
);
results.sort((a, b) => a.i - b.i);
writeFileSync(join(dirRoot, `${armName}-batch.json`), `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(`done ${armName}: ${results.length} run(s)\n`);
