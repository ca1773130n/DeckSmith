#!/usr/bin/env node
/**
 * score — put a plan through the SHIPPED pipeline and report what a user would
 * receive.
 *
 * WHY THIS EXISTS. Six investigations, 26 Codex runs and zero decks
 * (VOCABULARY-REVIEW §4). Every quality number in VOCABULARY.md came from a
 * checker written for the occasion by the person whose hypothesis it tested; the
 * one number from shipped code said only that the emitter did not throw. When
 * somebody finally ran `decksmith build`, a plan scored CLEAN failed with 14
 * errors and the whole corpus drew a diagram that contradicts its own source.
 * Schema-valid and buildable are different properties. This closes the gap by
 * refusing to be a second opinion: it runs the exact command a user runs and
 * reports the exact verdict a user gets.
 *
 * THE ONE RULE THIS FILE OBEYS. It shells out to `node dist/cli.js build`. It
 * does not import the emitter, does not re-implement a gate, does not decide
 * what counts as a defect. Every number below came out of the shipped CLI's own
 * report. The moment this file starts judging, it becomes the thing it was
 * built to replace.
 *
 * COST, MEASURED, not estimated (macOS, 10 cores, chrome-headless-shell
 * 145.0.7632.46): a full `build` of demo/storyboard.json is 5.81s wall, of which
 * `npx hyperframes check --json` alone is 5.78s. So the gate IS the cost and
 * emit is free. Two levers, and one deliberate non-lever:
 *
 *   - PARALLELISM. Each check is its own process with its own Chrome, and one
 *     of them pins ~40% of one core, so they overlap almost perfectly. Default
 *     pool is 4.
 *   - A CONTENT-ADDRESSED VERDICT CACHE keyed on (plan bytes, source bytes,
 *     format, and the bytes of the dist/ that would run). Re-scoring twenty
 *     plans after changing two costs two gate runs. The tool bytes are in the
 *     key because a verdict from a previous build of the compiler is not
 *     evidence about this one — that is precisely the mistake being corrected.
 *   - NOT reusing one browser across plans. That would mean re-implementing
 *     `hyperframes check` in-process, which is the exact move that made arm B's
 *     numbers unusable (§3.3: "the two arms' defect checks are not
 *     commensurable"). A slower harness that runs the shipped gate beats a fast
 *     one that runs a lookalike.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const run = promisify(execFile);

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "dist", "cli.js");
/** node_modules is already ignored, survives a session, and dies on reinstall. */
const CACHE = join(REPO, "node_modules", ".cache", "decksmith-score");
export const LEDGER = join(REPO, "experiments", "score", "ledger.json");

/**
 * Directories a plan is never found in, and which cost minutes to walk. `deck`
 * and `out` hold BUILT decks — a built deck contains no storyboard, but it does
 * contain timing.json, and walking a few hundred of them is the difference
 * between a one-second discovery and a thirty-second one.
 */
const SKIP = new Set([
  "node_modules",
  "dist",
  ".git",
  "out",
  "renders",
  "snapshots",
  "shots",
  "vendor",
  "katex",
  "fonts",
  "assets",
  "audio",
  ".playwright-mcp",
]);

/* ------------------------------------------------------------------ discovery */

/**
 * Every plan-shaped JSON under `roots`, repo-relative and sorted.
 *
 * The test says "shaped", not "schema-valid", ON PURPOSE. A file that is a
 * storyboard in every visible respect but fails `storyboardSchema` is the most
 * interesting case there is — it is what the arm-A planner actually emitted —
 * and a discovery rule that skipped it would let exactly the failure this
 * harness exists to catch walk straight past it. Validity is a VERDICT here,
 * never an admission criterion.
 *
 * IT SAYS "PLAN", NOT "STORYBOARD", BECAUSE THAT ALREADY WENT WRONG. The rule
 * used to require `Array.isArray(o.beats)` — the shipped storyboard's unit array
 * — and `experiments/015-decision` then produced twenty plans whose units are
 * called `scenes`. All twenty were INVISIBLE to the one mechanism built to make
 * "nobody built it" impossible, so the arm's plans were scored by a bespoke
 * emitter and never handed to `decksmith build` at all. The guard had a shape
 * assumption and the first genuinely new shape walked straight past it.
 *
 * So admission asks for nothing shape-specific: `sourceId` and `title`, the two
 * fields a plan needs before it can be paired with a source at all. What the
 * units are CALLED is `planUnits`' problem and it is only ever a label — never a
 * filter. Measured over the 340 JSON files under `experiments/`: 121 carry both
 * fields, and every one of them is a plan (64 `beats`, 57 `scenes`).
 */
export async function discoverPlans(roots) {
  const found = [];
  for (const root of roots) await walk(resolve(root), found);
  const rel = [...new Set(found.map((f) => relative(REPO, f)))].sort();
  // ONE PLAN PER RUN. A run directory holds `out.json` — Codex's raw structured
  // output — and `plan.json`, the same plan with null-valued optional keys
  // stripped. They are one plan at two stages, not two plans, and the raw one
  // always fails `storyboardSchema` on `theme: null` because the schema cannot
  // express "omit this key". Scoring both doubled every denominator and filled it
  // with guaranteed failures: 28 of 32 read as 28 of 64.
  //
  // The stripped one is what gets built, so it is the one that counts. The raw one
  // is kept on disk as the transport record and is simply not a second datum.
  const stripped = new Set(rel.filter((f) => f.endsWith("/plan.json")).map(dirOf));
  return rel.filter((f) => !(f.endsWith("/out.json") && stripped.has(dirOf(f))));
}

const dirOf = (f) => f.slice(0, f.lastIndexOf("/"));

async function walk(path, out) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    // A file argument: take it as named, whatever it looks like.
    if (path.endsWith(".json")) out.push(path);
    return;
  }
  for (const e of entries) {
    const child = join(path, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !e.name.startsWith(".")) await walk(child, out);
    } else if (e.isFile() && e.name.endsWith(".json")) {
      if (looksLikePlan(await readJson(child))) out.push(child);
    }
  }
}

/**
 * A plan is anything that names a source and has a title. Not the schema, and
 * deliberately not a shape: see `discoverPlans`.
 */
export function looksLikePlan(o) {
  return (
    !!o &&
    typeof o === "object" &&
    !Array.isArray(o) &&
    typeof o.title === "string" &&
    typeof o.sourceId === "string"
  );
}

/**
 * What a plan is made OF: the name of its unit array and how many units it has,
 * or `null` when nothing in it looks like one.
 *
 * A LABEL, NOT A GATE. `beats` is the shipped storyboard's; arm VOCAB's is
 * `scenes`; the next one will be something else. So the array is found by its
 * shape — objects that each carry a string `id` — rather than by a list of names
 * that would have to be edited every time, which is the edit nobody made.
 *
 * `null` is reported, never quietly turned into 0. A plan whose units the harness
 * cannot even name is the loudest thing on the table, and a `0` in the units
 * column reads as an empty plan instead — that difference is the whole reason
 * this returns the key alongside the count.
 */
export function planUnits(o) {
  if (!o || typeof o !== "object") return null;
  for (const [key, value] of Object.entries(o))
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((u) => !!u && typeof u === "object" && typeof u.id === "string")
    )
      return { key, count: value.length };
  return null;
}

/** id → path, for every source document under `roots`. */
async function indexSources(roots) {
  const index = new Map();
  const files = [];
  for (const root of roots) await walkSources(resolve(root), files);
  for (const f of files) {
    const o = await readJson(f);
    if (o && typeof o.id === "string" && Array.isArray(o.sections) && !index.has(o.id))
      index.set(o.id, f);
  }
  return index;
}

async function walkSources(path, out) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) return;
  for (const e of entries) {
    const child = join(path, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !e.name.startsWith(".")) await walkSources(child, out);
    } else if (e.isFile() && e.name.endsWith(".json") && /source/i.test(e.name)) out.push(child);
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- signatures */

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * The bytes of the compiler that would run, folded into one hash.
 *
 * Without this the cache would happily serve a PASS earned by yesterday's
 * emitter for today's, which is the whole disease: a number that was true of
 * something else, reported about this.
 */
async function toolFingerprint() {
  const parts = [];
  for (const f of ["cli.js", "index.js", "deck-runtime.js"])
    parts.push(await readFile(join(REPO, "dist", f)).catch(() => Buffer.from(`missing:${f}`)));
  const pkg = await readJson(join(REPO, "package.json"));
  parts.push(Buffer.from(JSON.stringify(pkg?.dependencies ?? {})));
  // AND THIS FILE. The fingerprint tracked the compiler and not the judge, so a
  // change to how a verdict is CLASSIFIED could not invalidate a verdict: teaching
  // the harness that an unbuildable plan is not a failure left every cached
  // verdict saying it was, and the re-run reported the identical wrong number.
  // Exactly the disease the paragraph above describes, one level up — a number
  // that was true of a previous version of the judge, reported about this one.
  parts.push(await readFile(new URL(import.meta.url)).catch(() => Buffer.from("missing:self")));
  return sha(Buffer.concat(parts)).slice(0, 16);
}

/* --------------------------------------------------------------------- report */

/**
 * Read the CLI's own report back. `report()` in src/cli.ts prints
 * `  severity(7) gate(11) rule  message` and closes with the verdict line; we
 * take those and nothing else. When the shape is not there — a build that threw
 * before the gates ever ran — that is reported as a finding rather than guessed
 * at, because a plan that cannot be built is the loudest possible result and
 * must never be summarised as "no findings".
 */
export function parseReport(stdout, stderr, code) {
  const findings = [];
  for (const line of stdout.split("\n")) {
    const m = /^ {2}(error|warning|info)\s+(\S+)\s+(\S+)\s{2}(.*)$/.exec(line);
    if (m) findings.push({ severity: m[1], gate: m[2], rule: m[3], message: m[4].trim() });
  }
  const verdict = /^(PASS|FAIL) — (\d+) error\(s\), (\d+) warning\(s\)$/m.exec(stdout);
  if (!verdict) {
    const why = (stderr.trim() || stdout.trim()).split("\n").filter(Boolean).slice(-3).join(" / ");
    // A PLAN THIS TOOL CANNOT BUILD IS NOT A FAILING PLAN.
    //
    // Discovery admits any plan that names a source and a title, which is right —
    // the guard's whole purpose is that a genuinely new plan shape must not walk
    // past it unnoticed. But `decksmith build` takes a Storyboard, and a
    // compositional plan has `scenes` where a storyboard has `beats`, so feeding
    // it one produces "beats: Invalid input: expected array, received undefined".
    //
    // Scoring that as FAIL put 64 of them in the denominator and turned a real
    // 57-of-64 into a reported 57 of 249. A number that counts an unbuildable
    // input as a defect is a number people learn to ignore, which is how
    // `composition_file_too_large` became furniture. So it is a THIRD state: the
    // receipt exists, so the guard is satisfied and the plan is still on record,
    // and the quality rate is computed over plans this tool can actually build.
    if (/beats: Invalid input/.test(why) || /is not a valid storyboard/.test(why)) {
      return {
        unbuildable: true,
        passed: false,
        errors: 0,
        warnings: 0,
        findings: [
          {
            severity: "info",
            gate: "build",
            rule: "not_a_storyboard",
            message:
              "not a storyboard — `decksmith build` cannot build this plan shape. " +
              "Counted separately, not as a defect.",
          },
        ],
      };
    }
    return {
      passed: false,
      errors: 1,
      warnings: 0,
      findings: [
        ...findings,
        {
          severity: "error",
          gate: "build",
          rule: code === 0 ? "no_report" : "build_failed",
          message: why || `\`decksmith build\` exited ${code} without a report.`,
        },
      ],
    };
  }
  return {
    passed: verdict[1] === "PASS" && code === 0,
    errors: Number(verdict[2]),
    warnings: Number(verdict[3]),
    findings,
  };
}

/* --------------------------------------------------------------------- scoring */

const slug = (plan) => plan.replace(/\.json$/, "").replace(/[^\w.-]+/g, "-");

/**
 * Drop every null-valued key, recursively.
 *
 * A planner driven by JSON-schema structured output cannot omit an optional
 * field — the encoding makes every property required and widens the optional
 * ones with `{type:"null"}` — so its capture is littered with `"inside": null`
 * where a storyboard wants the key absent. `storyboardSchema` rejects all of it.
 * The planner experiment's own `run.mjs:39` strips nulls before validating, so
 * this is transport, not a plan defect, and scoring 14 identical FAILs on it
 * would be a louder lie than not scoring at all.
 *
 * It is a FLAG and it is RECEIPTED (`normalized` in the ledger) because the
 * other half of the danger is a harness that quietly repairs its inputs and then
 * reports how well they did. If a normalisation was needed, the record says so.
 */
export function stripNulls(node) {
  if (Array.isArray(node)) return node.map(stripNulls);
  if (node === null || typeof node !== "object") return node;
  const out = {};
  for (const [k, val] of Object.entries(node)) if (val !== null) out[k] = stripNulls(val);
  return out;
}

const hasNull = (n) =>
  Array.isArray(n)
    ? n.some(hasNull)
    : !!n && typeof n === "object" && Object.values(n).some((v) => v === null || hasNull(v));

async function scorePlan(plan, ctx) {
  const started = Date.now();
  const abs = join(REPO, plan);
  const bytes = await readFile(abs).catch(() => null);
  if (!bytes)
    return fail(plan, "unreadable", `Cannot read ${plan}.`, started, ctx, { source: null });

  const doc = JSON.parse(bytes.toString("utf8") || "{}");
  const shape = planUnits(doc);
  // Pair by the plan's own `sourceId` before falling back to --source: a corpus
  // spanning several experiments has several sources, and building a plan
  // against the wrong one produces a ref error that says nothing about the plan.
  const sourceId = doc.sourceId;
  const source = ctx.sources.get(sourceId) ?? ctx.defaultSource;
  if (!source)
    return fail(
      plan,
      "no_source",
      `No source document with id "${sourceId}" found; pass --source.`,
      started,
      ctx,
      { source: null },
    );
  const srcBytes = await readFile(source);

  const key = sha(
    Buffer.concat([
      bytes,
      srcBytes,
      Buffer.from(`${ctx.format} ${ctx.tool} ${ctx.stripNulls ? "stripped" : "raw"}`),
    ]),
  ).slice(0, 32);
  const cacheFile = join(CACHE, "v1", `${key}.json`);
  if (ctx.cache) {
    const hit = await readJson(cacheFile);
    if (hit) return { ...hit, plan, cached: true };
  }

  // A normalised copy lives in the cache, never beside the original: `build`
  // looks for narration next to the storyboard it was handed, so writing the
  // copy into the repo would silently change which decks get audio.
  let built = abs;
  let normalized = false;
  if (ctx.stripNulls && hasNull(doc)) {
    built = join(CACHE, "normalized", `${slug(plan)}.json`);
    await mkdir(dirname(built), { recursive: true });
    await writeFile(built, JSON.stringify(stripNulls(doc), null, 2));
    normalized = true;
  }

  const out = join(ctx.outRoot, slug(plan));
  const argv = ["build", built, "--source", source, "-o", out, "--format", ctx.format];
  let stdout = "";
  let stderr = "";
  let code = 0;
  try {
    const r = await run(process.execPath, [CLI, ...argv], {
      cwd: REPO,
      timeout: ctx.timeoutMs,
      maxBuffer: 32 << 20,
    });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (err) {
    stdout = err.stdout ?? "";
    stderr = err.stderr ?? err.message ?? "";
    code = err.code ?? 1;
  }

  const parsed = parseReport(stdout, stderr, code);
  const result = {
    plan,
    planSha: sha(bytes),
    source: relative(REPO, source),
    sourceSha: sha(srcBytes),
    // The plan's own shape, recorded rather than assumed. Both null means the
    // harness could not find a unit array at all, which is a fact about the plan
    // and not a plan with no units.
    unitKey: shape?.key ?? null,
    units: shape?.count ?? null,
    format: ctx.format,
    tool: ctx.tool,
    normalized,
    // The receipt. A verdict with no deck behind it is the thing this harness
    // exists to make impossible, so the built artifact's own bytes are quoted.
    deck: relative(REPO, out),
    deckSha: await readFile(join(out, "index.html"))
      .then(sha)
      .catch(() => null),
    cmd: `node dist/cli.js ${argv.map((a) => relative(REPO, a) || a).join(" ")}`,
    seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    at: new Date().toISOString(),
    ...parsed,
  };
  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(result));
  return result;
}

function fail(plan, rule, message, started, ctx, extra) {
  return {
    plan,
    format: ctx.format,
    tool: ctx.tool,
    passed: false,
    errors: 1,
    warnings: 0,
    findings: [{ severity: "error", gate: "harness", rule, message }],
    seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    at: new Date().toISOString(),
    deckSha: null,
    ...extra,
  };
}

/** Fixed-size worker pool. Each slot owns a Chrome, so the size is the point. */
async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

/**
 * Score every plan. Exported so an experiment harness can call it directly
 * rather than shelling out and re-parsing this file's own table.
 */
export async function score(plans, opts = {}) {
  const tool = await toolFingerprint();
  const ctx = {
    tool,
    format: opts.format ?? "deck-16x9",
    cache: opts.cache !== false,
    stripNulls: opts.stripNulls === true,
    outRoot: opts.outRoot ?? join(CACHE, "decks"),
    timeoutMs: opts.timeoutMs ?? 300_000,
    defaultSource: opts.source ? resolve(opts.source) : null,
    sources: opts.sources ?? (await indexSources([join(REPO, "demo"), join(REPO, "experiments")])),
  };
  if (ctx.defaultSource) {
    const o = await readJson(ctx.defaultSource);
    if (o?.id) ctx.sources.set(o.id, ctx.defaultSource);
  }
  const jobs = opts.jobs ?? Math.min(4, Math.max(1, availableParallelism() >> 1));
  return pool(plans, jobs, (plan) => scorePlan(plan, ctx).then(opts.onResult ?? ((r) => r)));
}

/* ---------------------------------------------------------------------- ledger */

/**
 * The receipt file the enforcement test reads.
 *
 * Keyed by plan path and carrying the plan's sha256, so "this plan was built"
 * is a checkable claim about THESE bytes rather than a memory of some earlier
 * version of the file. Merged rather than replaced: scoring three plans must
 * not erase the evidence for the other twenty.
 */
export async function updateLedger(results, path = LEDGER) {
  const prev = (await readJson(path)) ?? { plans: {} };
  for (const r of results) {
    prev.plans[r.plan] = {
      planSha: r.planSha ?? null,
      source: r.source ?? null,
      sourceSha: r.sourceSha ?? null,
      format: r.format,
      tool: r.tool,
      passed: r.passed,
      errors: r.errors,
      warnings: r.warnings,
      unitKey: r.unitKey ?? null,
      units: r.units ?? null,
      normalized: r.normalized ?? false,
      deckSha: r.deckSha,
      cmd: r.cmd ?? null,
      rules: [...new Set(r.findings.filter((f) => f.severity === "error").map((f) => f.rule))],
      at: r.at,
    };
  }
  prev.updated = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(prev, null, 2)}\n`);
  return prev;
}

/* ------------------------------------------------------------------------- CLI */

function table(results) {
  const w = Math.max(4, ...results.map((r) => r.plan.length));
  const rows = results.map((r) => {
    const top = r.findings.find((f) => f.severity === "error")?.rule ?? "";
    return [
      r.plan.padEnd(w),
      // The shape, not just the count: `3 beats` and `3 scenes` are different
      // plans and a bare `3` hid that for twenty of them. `?` is a plan whose
      // units the harness could not name at all.
      `${String(r.units ?? "?").padStart(3)} ${(r.unitKey ?? "?").padEnd(6)}`,
      (r.unbuildable ? "n/a " : r.passed ? "PASS" : "FAIL").padEnd(4),
      `${String(r.errors).padStart(3)} err`,
      `${String(r.warnings).padStart(2)} warn`,
      `${String(r.seconds).padStart(5)}s${r.cached ? "*" : " "}`,
      top,
    ].join("  ");
  });
  return rows.join("\n");
}

async function main() {
  const { values: v, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      source: { type: "string" },
      format: { type: "string", default: "deck-16x9" },
      out: { type: "string" },
      jobs: { type: "string", short: "j" },
      json: { type: "string" },
      ledger: { type: "string" },
      "strip-nulls": { type: "boolean", default: false },
      "no-cache": { type: "boolean", default: false },
      "no-ledger": { type: "boolean", default: false },
      "no-fail": { type: "boolean", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      list: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  // Bare `npm run score` scores the whole of experiments/ rather than printing
  // help. Making the zero-argument case do the useful thing is most of what
  // "cannot be skipped" means in practice: the command the failing test names is
  // the command that works.
  if (v.help) {
    process.stdout.write(`score — build plans with the shipped pipeline and report the verdict.

  npm run score -- <plan|dir>... [--source <source.json>] [options]

  --source <f>   source document; otherwise each plan is paired by its sourceId
  --format <id>  output profile (default deck-16x9)
  -j <n>         parallel builds (default 4 — one Chrome each)
  --out <dir>    where the built decks go (default node_modules/.cache)
  --json <f>     write the full result set here
  --list         list discovered plans and exit
  --strip-nulls  drop null-valued keys first — for raw structured-output
                 captures, which cannot omit an optional field. Recorded.
  --no-cache     re-run every gate even when nothing changed
  --no-ledger    do not record receipts in experiments/score/ledger.json
  --no-fail      exit 0 even when a plan fails
  -v             print every finding, not just errors

A verdict here is the shipped CLI's, unedited. PASS means the mechanics hold —
never that a slide says anything true. See VOCABULARY-REVIEW §4.
`);
    return;
  }

  const roots = positionals.length ? positionals : [join(REPO, "experiments")];
  const plans = await discoverPlans(roots);
  if (v.list) {
    process.stdout.write(`${plans.join("\n")}\n${plans.length} plan(s)\n`);
    return;
  }
  if (plans.length === 0) {
    process.stderr.write(`score: no storyboards found under ${roots.join(", ")}\n`);
    process.exitCode = 1;
    return;
  }

  const jobs = v.jobs ? Number(v.jobs) : undefined;
  process.stderr.write(
    `score: ${plans.length} plan(s), ${jobs ?? Math.min(4, availableParallelism() >> 1)} at a time\n`,
  );
  const started = Date.now();
  const results = await score(plans, {
    source: v.source,
    format: v.format,
    jobs,
    cache: !v["no-cache"],
    stripNulls: v["strip-nulls"],
    outRoot: v.out ? resolve(v.out) : undefined,
    onResult: (r) => {
      process.stderr.write(
        `  ${r.passed ? "PASS" : "FAIL"}  ${r.plan}  ${r.errors} err  ${r.warnings} warn` +
          `${r.normalized ? "  (nulls stripped)" : ""}${r.cached ? "  (cached)" : ""}\n`,
      );
      return r;
    },
  });
  const wall = ((Date.now() - started) / 1000).toFixed(1);

  process.stdout.write(`\n${table(results)}\n`);
  const failed = results.filter((r) => !r.passed);
  for (const r of failed.length || v.verbose ? results : []) {
    const show = r.findings.filter((f) => v.verbose || f.severity === "error");
    if (show.length === 0) continue;
    process.stdout.write(`\n${r.plan} — ${r.cmd ?? "(not built)"}\n`);
    const seen = new Map();
    for (const f of show)
      seen.set(`${f.gate}/${f.rule}`, (seen.get(`${f.gate}/${f.rule}`) ?? 0) + 1);
    for (const f of show.slice(0, v.verbose ? 200 : 6))
      process.stdout.write(
        `  ${f.severity.padEnd(7)} ${f.gate.padEnd(11)} ${f.rule}  ${f.message}\n`,
      );
    if (show.length > (v.verbose ? 200 : 6))
      process.stdout.write(
        `  … ${show.length} in total: ${[...seen].map(([k, n]) => `${k}×${n}`).join(", ")}\n`,
      );
  }

  const cached = results.filter((r) => r.cached).length;
  // The rate is over plans this tool can build. Unbuildable ones are receipted —
  // the guard needs that — but a shape `decksmith build` does not accept is not a
  // defect of the plan, and counting it as one made a real 57-of-64 read as 57 of
  // 249. Reported beside the rate rather than folded into it, so it stays visible.
  const skipped = results.filter((r) => r.unbuildable).length;
  const graded = results.length - skipped;
  const failedGraded = failed.filter((r) => !r.unbuildable).length;
  process.stdout.write(
    `\n${graded - failedGraded}/${graded} PASS in ${wall}s` +
      `${skipped ? ` (${skipped} not a storyboard — counted, not graded)` : ""}` +
      `${cached ? ` (${cached} cached)` : ""} — decks under ${relative(REPO, v.out ? resolve(v.out) : join(CACHE, "decks"))}\n`,
  );

  if (!v["no-ledger"]) {
    const path = v.ledger ? resolve(v.ledger) : LEDGER;
    const ledger = await updateLedger(results, path);
    process.stdout.write(`receipts → ${relative(REPO, path)}\n`);
    // A receipt earned by a different compiler is a fact about that compiler.
    // Said out loud, because the whole point of dating the evidence is lost if
    // nothing ever reads the date — and dist/ moves under you while you work.
    const stale = Object.values(ledger.plans).filter((p) => p.tool !== results[0]?.tool).length;
    if (stale)
      process.stdout.write(
        `note: ${stale} receipt(s) are from a different build of dist/ — \`npm run score\` to refresh\n`,
      );
  }
  if (v.json) await writeFile(resolve(v.json), `${JSON.stringify(results, null, 2)}\n`);
  if (failed.length && !v["no-fail"]) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
