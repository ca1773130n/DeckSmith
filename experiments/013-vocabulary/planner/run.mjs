/**
 * Three arms, same source, same machinery.
 *
 *   A0  the shipped archetype planner, verbatim — the real-world baseline.
 *   A   the shipped archetype planner + the matched three-beat task.
 *   B   the compositional vocabulary + the same matched three-beat task.
 *
 * Everything is spawned exactly the way src/plan/codex.ts spawns it, so the
 * only thing that differs between arms is the schema and the prompt.
 *
 *   node run.mjs <arm> <n> [concurrency]
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkArchetype, checkComposition } from "./coherence.mjs";
import { compositionPrompt, FULL_TASK, MATCHED_TASK, renderSource as rs } from "./prompts.mjs";
import { COMPOSITION_JSON_SCHEMA, compositionSchema, stripNulls } from "./schema.mjs";
import {
  assertRefsResolve,
  prefsSchema,
  renderSource,
  SCHEMA,
  storyboardSchema,
  systemPrompt,
} from "./out/planbits.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const source = JSON.parse(readFileSync(join(ROOT, "demo", "source.json"), "utf8"));
const prefs = prefsSchema.parse({});

const ARMS = {
  A0: {
    schema: SCHEMA,
    prompt: () =>
      `${systemPrompt(prefs)}\n\nDo not search the web and do not read files. Everything you need is below.\nReturn the storyboard as your final message, conforming to the supplied schema.\n\n${renderSource(source)}`,
    validate: (raw) => storyboardSchema.safeParse(stripNulls(raw)),
    check: (v) => checkArchetype(v, source),
    refs: (v) => assertRefsResolve(v, source),
  },
  A: {
    schema: SCHEMA,
    prompt: () =>
      `${systemPrompt(prefs)}\n\n${MATCHED_TASK}\n\nDo not search the web and do not read files. Everything you need is below.\nReturn the storyboard as your final message, conforming to the supplied schema.\n\n${renderSource(source)}`,
    validate: (raw) => storyboardSchema.safeParse(stripNulls(raw)),
    check: (v) => checkArchetype(v, source),
    refs: (v) => assertRefsResolve(v, source),
  },
  B0: {
    schema: COMPOSITION_JSON_SCHEMA,
    prompt: () => compositionPrompt(source, FULL_TASK),
    validate: (raw) => compositionSchema.safeParse(stripNulls(raw)),
    check: (v) => checkComposition(v, source),
    refs: () => {},
  },
  B: {
    schema: COMPOSITION_JSON_SCHEMA,
    prompt: () => compositionPrompt(source),
    validate: (raw) => compositionSchema.safeParse(stripNulls(raw)),
    check: (v) => checkComposition(v, source),
    refs: () => {},
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
    "-",
  ];
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn("codex", argv, { stdio: ["pipe", "pipe", "pipe"], cwd: ROOT });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("close", (code) =>
      resolve({ code, stdout: out, stderr: err, ms: Date.now() - t0 }) || clearTimeout(timer),
    );
    child.stdin.end(prompt);
  });
}

async function one(armName, i) {
  const arm = ARMS[armName];
  const dir = join(HERE, "runs", `${armName}-${String(i).padStart(2, "0")}`);
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
    ms: r.ms,
    exit: r.code,
    promptChars: prompt.length,
    schemaChars: JSON.stringify(arm.schema).length,
  };
  let raw = "";
  try {
    raw = readFileSync(outPath, "utf8");
  } catch {}
  rec.outChars = raw.length;

  const tok = /tokens used[:\s]*([\d,]+)/i.exec(r.stdout);
  if (tok) rec.tokensUsed = Number(tok[1].replace(/,/g, ""));

  if (r.code !== 0 || raw.trim() === "") {
    rec.stage = "no-output";
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
  rec.units = (v.data.beats ?? v.data.scenes).length;
  rec.jsonChars = JSON.stringify(v.data).length;
  try {
    arm.refs(v.data);
    rec.refsResolve = true;
  } catch (e) {
    rec.refsResolve = false;
    rec.refsError = String(e.message).slice(0, 400);
  }
  const c = arm.check(v.data);
  rec.shared = c.shared;
  rec.algebra = c.algebra;
  rec.soft = c.soft;
  rec.emitFail = c.emitFail ?? [];
  rec.coherent = c.shared.length === 0 && c.algebra.length === 0 && rec.emitFail.length === 0;
  writeFileSync(join(dir, "result.json"), JSON.stringify(rec, null, 2));
  return rec;
}

const [arm, nStr, cStr] = process.argv.slice(2);
const n = Number(nStr ?? 8);
const conc = Number(cStr ?? 3);

const jobs = Array.from({ length: n }, (_, i) => i + 1);
const results = [];
async function worker() {
  for (;;) {
    const i = jobs.shift();
    if (i === undefined) return;
    const r = await one(arm, i);
    results.push(r);
    console.log(
      `${arm}-${i} ${r.stage} ${(r.ms / 1000).toFixed(0)}s units=${r.units ?? "-"} shared=${r.shared?.length ?? "-"} algebra=${r.algebra?.length ?? "-"} soft=${r.soft?.length ?? "-"}`,
    );
  }
}
await Promise.all(Array.from({ length: conc }, worker));
writeFileSync(join(HERE, "runs", `${arm}-summary.json`), JSON.stringify(results, null, 2));
console.log("done", arm, results.length);
void rs;
