/** Rescore every completed run offline from runs/<arm>-NN/. */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkArchetype, checkComposition } from "./coherence.mjs";
import { compositionSchema, stripNulls } from "./schema.mjs";
import { assertRefsResolve, storyboardSchema } from "./out/planbits.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const source = JSON.parse(readFileSync(join(ROOT, "demo", "source.json"), "utf8"));
const RUNS = join(HERE, "runs");

const rows = [];
for (const d of readdirSync(RUNS).sort()) {
  const dir = join(RUNS, d);
  if (!statSync(dir).isDirectory() || d.startsWith("_")) continue;
  const arm = d.split("-")[0];
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
  } catch {
    continue;
  }
  const rec = {
    run: d,
    arm,
    ms: meta.ms,
    exit: meta.exit,
    tokensUsed: meta.tokensUsed,
    outChars: meta.outChars,
    promptChars: meta.promptChars,
    schemaChars: meta.schemaChars,
  };
  try {
    const log = readFileSync(join(dir, "codex.log"), "utf8");
    const t = /tokens used[:\s]*([\d,]+)/i.exec(log);
    if (t) rec.tokensUsed = Number(t[1].replace(/,/g, ""));
  } catch {}
  let raw;
  try {
    raw = readFileSync(join(dir, "out.json"), "utf8");
  } catch {
    rec.stage = "no-output";
    rows.push(rec);
    continue;
  }
  if (!raw.trim()) {
    rec.stage = "no-output";
    rows.push(rec);
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    rec.stage = "not-json";
    rows.push(rec);
    continue;
  }
  const isB = arm.startsWith("B");
  const v = (isB ? compositionSchema : storyboardSchema).safeParse(stripNulls(parsed));
  if (!v.success) {
    rec.stage = "schema-fail";
    rec.issues = v.error.issues.map((x) => `${x.path.join(".") || "(root)"}: ${x.message}`);
    rows.push(rec);
    continue;
  }
  rec.stage = "valid";
  const units = isB ? v.data.scenes : v.data.beats;
  rec.units = units.length;
  rec.jsonChars = JSON.stringify(v.data).length;
  if (isB) {
    rec.objects = units.reduce((a, s) => a + s.objects.length, 0);
    rec.anims = units.reduce((a, s) => a + s.anims.length, 0);
  }
  if (!isB) {
    try {
      assertRefsResolve(v.data, source);
      rec.refsResolve = true;
    } catch {
      rec.refsResolve = false;
    }
  }
  const c = isB ? checkComposition(v.data, source) : checkArchetype(v.data, source);
  rec.shared = c.shared;
  rec.algebra = c.algebra;
  rec.soft = c.soft;
  rec.emitFail = c.emitFail ?? [];
  rec.coherent = c.shared.length === 0 && c.algebra.length === 0 && rec.emitFail.length === 0;
  rows.push(rec);
}

writeFileSync(join(HERE, "scores.json"), JSON.stringify(rows, null, 2));

const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : 0);
const arms = [...new Set(rows.map((r) => r.arm))].sort();
const lines = [];
for (const arm of arms) {
  const r = rows.filter((x) => x.arm === arm);
  const valid = r.filter((x) => x.stage === "valid");
  const coh = valid.filter((x) => x.coherent);
  lines.push(
    [
      `arm ${arm}  n=${r.length}`,
      `  schema-valid   ${valid.length}/${r.length}`,
      `  refs resolve   ${arm.startsWith("B") ? "n/a (checked inside coherence)" : `${valid.filter((x) => x.refsResolve).length}/${valid.length}`}`,
      `  fully coherent ${coh.length}/${valid.length}`,
      `  shared defects  total ${valid.reduce((a, x) => a + x.shared.length, 0)}  median/plan ${med(valid.map((x) => x.shared.length))}`,
      `  algebra defects total ${valid.reduce((a, x) => a + x.algebra.length, 0)}  median/plan ${med(valid.map((x) => x.algebra.length))}`,
      `  soft overlaps   total ${valid.reduce((a, x) => a + x.soft.length, 0)}`,
      `  emitter refuses  ${valid.filter((x) => x.emitFail.length).length}/${valid.length} plans, ${valid.reduce((a, x) => a + x.emitFail.length, 0)} beats`,
      `  wall clock s   median ${(med(r.map((x) => x.ms)) / 1000).toFixed(0)}  min ${(Math.min(...r.map((x) => x.ms)) / 1000).toFixed(0)}  max ${(Math.max(...r.map((x) => x.ms)) / 1000).toFixed(0)}`,
      `  tokens used    median ${med(r.filter((x) => x.tokensUsed).map((x) => x.tokensUsed))}`,
      `  json chars     median ${med(valid.map((x) => x.jsonChars))}  per unit ${Math.round(med(valid.map((x) => x.jsonChars / x.units)))}`,
      `  units          median ${med(valid.map((x) => x.units))}`,
      arm.startsWith("B")
        ? `  objects/anims  median ${med(valid.map((x) => x.objects))} / ${med(valid.map((x) => x.anims))}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
const report = lines.join("\n\n");
writeFileSync(join(HERE, "summary.txt"), `${report}\n`);
console.log(report);
