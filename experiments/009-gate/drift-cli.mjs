// src/verify/drift.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
var run = promisify(execFile);
var FLOOR_DB = 40;
var DEFAULT_RENDER_TIMEOUT_MS = 18e5;
async function drift(dir2, opts = {}) {
  const mode = opts.mode ?? "psnr";
  const floorDb = opts.floorDb ?? FLOOR_DB;
  const work = opts.workDir ?? await mkdtemp(join(tmpdir(), "decksmith-drift-"));
  const a = join(work, "a");
  const b = join(work, "b");
  const report2 = await compare(dir2, a, b, mode, floorDb, opts);
  const keep = opts.keep || !report2.passed;
  if (keep) report2.kept = { a, b };
  else if (!opts.workDir) await rm(work, { recursive: true, force: true });
  return report2;
}
async function compare(dir2, a, b, mode, floorDb, opts) {
  const empty = { mode, frames: 0, identical: 0 };
  for (const [out, label] of [
    [a, "first"],
    [b, "second"]
  ]) {
    const why = await render(dir2, out, opts);
    if (why)
      return {
        passed: false,
        findings: [finding("render_failed", `The ${label} render of ${dir2} failed: ${why}`)],
        ...empty
      };
  }
  const fa = await frames(a);
  const fb = await frames(b);
  if (fa.length === 0)
    return {
      passed: false,
      findings: [
        finding(
          "no_frames",
          `\`hyperframes render --format png-sequence\` wrote no frames to ${a}. Nothing was compared.`
        )
      ],
      ...empty
    };
  if (fa.length !== fb.length)
    return {
      passed: false,
      findings: [
        finding(
          "frame_count_differs",
          `Two renders of the same deck produced ${fa.length} and ${fb.length} frames. The composition's duration is not stable, so no frame-by-frame comparison is meaningful.`
        )
      ],
      ...empty,
      frames: fa.length
    };
  const differing = [];
  for (const [i, name] of fa.entries()) {
    if (await sha(join(a, name)) !== await sha(join(b, name))) differing.push(i + 1);
  }
  let worst;
  if (differing.length > 0) {
    const stats = await psnr(a, b, fa[0]);
    if ("error" in stats)
      return {
        passed: false,
        findings: [finding("psnr_failed", stats.error)],
        mode,
        frames: fa.length,
        identical: fa.length - differing.length
      };
    worst = stats.worst;
  }
  return judge({ mode, floorDb, frames: fa.length, differing, ...worst ? { worst } : {} });
}
function judge(m) {
  const { mode, floorDb, frames: frames2, differing, worst } = m;
  const identical = frames2 - differing.length;
  const base = { mode, frames: frames2, identical, ...worst ? { worst } : {} };
  if (differing.length === 0 || !worst)
    return {
      ...base,
      passed: true,
      findings: [
        note(
          `${frames2} frames, all byte-identical across two renders${mode === "psnr" ? " \u2014 well clear of the floor" : ""}.`
        )
      ]
    };
  const where = `worst ${worst.db.toFixed(2)} dB at frame ${worst.frame} of ${frames2}`;
  if (mode === "identical")
    return {
      ...base,
      passed: false,
      findings: [
        finding(
          "not_byte_identical",
          `${differing.length} of ${frames2} frames differ between two renders (${where}). This fixture is image-free and never scales a glyph, so it has no rasteriser noise to blame \u2014 something in the deck or the engine became render-time dependent. Differing frames: ${differing.slice(0, 8).join(", ")}${differing.length > 8 ? ", \u2026" : ""}.`
        )
      ]
    };
  if (worst.db < floorDb)
    return {
      ...base,
      passed: false,
      findings: [
        finding(
          "psnr_below_floor",
          `${differing.length} of ${frames2} frames differ between two renders, ${where}, under the ${floorDb} dB floor. That is not rasteriser noise \u2014 a blank plate, a missing reveal, a font fallen back, or a layout shift all land here. Open frame ${worst.frame} in both renders and look.`
        )
      ]
    };
  return {
    ...base,
    passed: true,
    findings: [
      note(
        `${identical} of ${frames2} frames byte-identical, ${differing.length} differing, ${where} \u2014 above the ${floorDb} dB floor.`
      )
    ]
  };
}
async function render(dir2, out, opts) {
  const args = [
    "hyperframes",
    "render",
    dir2,
    "--format",
    "png-sequence",
    "--no-browser-gpu",
    "--quiet",
    "-o",
    out
  ];
  if (opts.workers !== void 0) args.push("-w", String(opts.workers));
  try {
    await run("npx", args, {
      timeout: opts.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS,
      maxBuffer: 32 << 20
    });
    return void 0;
  } catch (err) {
    const e = err;
    return tail(e.stderr ?? "") || e.message.trim() || "no reason given";
  }
}
async function frames(dir2) {
  const names = await readdir(dir2).catch(() => []);
  return names.filter((n) => n.endsWith(".png")).sort();
}
async function sha(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
var STAT = /^n:(\d+)\b.*\bpsnr_avg:(inf|-?[\d.]+)/;
function framePattern(name) {
  const m = /^(.*?)(\d+)(\.png)$/.exec(name);
  if (!m) return void 0;
  const digits = m[2];
  return { pattern: `${m[1]}%0${digits.length}d${m[3]}`, start: Number(digits) };
}
function worstFrame(stats) {
  let worst;
  for (const line of stats.split("\n")) {
    const s = STAT.exec(line);
    if (!s) continue;
    const db = s[2] === "inf" ? Number.POSITIVE_INFINITY : Number(s[2]);
    if (!worst || db < worst.db) worst = { frame: Number(s[1]), db };
  }
  return worst;
}
async function psnr(a, b, firstFrame) {
  const seq = framePattern(firstFrame);
  if (!seq) return { error: `Cannot read a frame-number pattern out of "${firstFrame}".` };
  let stdout;
  try {
    ({ stdout } = await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-start_number",
        String(seq.start),
        "-i",
        join(a, seq.pattern),
        "-start_number",
        String(seq.start),
        "-i",
        join(b, seq.pattern),
        "-lavfi",
        "psnr=stats_file=-",
        "-f",
        "null",
        "-"
      ],
      { maxBuffer: 64 << 20 }
    ));
  } catch (err) {
    const e = err;
    if (e.code === "ENOENT")
      return { error: "ffmpeg is not on PATH, so the frames could not be compared." };
    return {
      error: `ffmpeg could not compare the two frame sequences: ${tail(e.stderr ?? e.message)}`
    };
  }
  const worst = worstFrame(stdout);
  if (!worst) return { error: `ffmpeg printed no psnr statistics. Last output: ${tail(stdout)}` };
  return { worst };
}
function finding(rule, message) {
  return { severity: "error", gate: "drift", rule, message };
}
function note(message) {
  return { severity: "info", gate: "drift", rule: "stable", message };
}
function tail(s) {
  return s.trim().split("\n").slice(-3).join(" / ").slice(0, 400);
}

// experiments/009-gate/drift-cli.ts
var argv = process.argv.slice(2);
var dir = argv.find((a) => !a.startsWith("-"));
if (!dir) {
  console.error("usage: drift-cli <built-deck-dir> [--identical] [--floor <dB>] [--keep]");
  process.exit(2);
}
var floorAt = argv.indexOf("--floor");
var report = await drift(dir, {
  mode: argv.includes("--identical") ? "identical" : "psnr",
  ...floorAt >= 0 ? { floorDb: Number(argv[floorAt + 1]) } : {},
  keep: argv.includes("--keep")
});
for (const f of report.findings) console.log(`${f.severity}: [${f.gate}/${f.rule}] ${f.message}`);
if (report.kept) console.log(`frames kept in ${report.kept.a} and ${report.kept.b}`);
console.log(
  `${report.passed ? "PASS" : "FAIL"} \u2014 mode=${report.mode} frames=${report.frames} identical=${report.identical}` + (report.worst ? ` worst=${report.worst.db.toFixed(2)}dB@${report.worst.frame}` : "")
);
process.exit(report.passed ? 0 : 1);
