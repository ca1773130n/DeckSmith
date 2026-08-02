/**
 * Re-derive `CUE_OVERHEAD` and the speedups in `RATE_STEPS`, in src/plan/duration.ts.
 *
 * Both decide how fast a fast-forward deck speaks, which puts them in SHIPPED
 * OUTPUT rather than in a gate — no gate looks at either, which is how a wrong
 * `CUE_OVERHEAD` survived long enough to ship a deck whose captions ran at 23.0
 * cps against a ceiling of 22. This is what makes them checkable:
 *
 *     node scripts/measure-cue-rate.mjs
 *
 * Synthesises the anchor deck — the 37 segments of `demo/audio/narration.json` —
 * at every step in `RATE_STEPS`, and reports the two quantities the constants
 * claim. Needs edge-tts, ffprobe, a network, and about ten minutes.
 *
 * THE THREE TRAPS IN DOING IT.
 *
 *  1. EVERY RATE IS SYNTHESISED FRESH, `+0%` INCLUDED. edge-tts is a network
 *     service and does not repeat itself: the segment stored at 4.700s comes
 *     back from a fresh call at 4.850. Judging a fresh `+10%` against the STORED
 *     `+0%` folds that drift into the answer, so the baseline is re-measured in
 *     the same session as the thing it anchors.
 *  2. THE MEAN IS AGGREGATE, NOT A MEAN OF RATES. `SPEECH_CPS.latin` is total
 *     characters over total seconds — 2829 / 195.912 = 14.440 on the stored
 *     artifact. The mean of the 37 per-segment rates is 14.596, a different
 *     number about a different thing, and pairing it with the p95 gives a ratio
 *     that is wrong by a percent and a half.
 *  3. p95 OVER 39 CUES IS THE SECOND-HIGHEST CUE. It moves when one cue's window
 *     moves, so a single step reading high is not a trend. The median-to-mean
 *     ratio is reported next to it because it is the stable one, and it is what
 *     says whether the SHAPE of the distribution is changing with rate.
 *
 * Uses `parseCues` and `p95CueRate` from the built package rather than its own
 * copies: a harness that measures a slightly different quantity than the code
 * does is how a constant ends up true of nothing.
 */
import "./tmpdir.mjs";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = process.argv[2] ?? join(tmpdir(), "decksmith-cue-rate");

const { parseCues, p95CueRate, SPEECH_CPS } = await import(join(REPO, "dist", "index.js"));

/** Must match `RATE_STEPS` and `CUE_OVERHEAD` in src/plan/duration.ts. */
const RATE_STEPS = [
  ["+0%", 1.0],
  ["+10%", 1.187],
  ["+20%", 1.252],
  ["+30%", 1.394],
  ["+40%", 1.533],
];
const CUE_OVERHEAD = 1.28;

/** The anchor deck's segments, in manifest order. */
async function segments() {
  const dir = join(REPO, "demo", "audio");
  const manifest = JSON.parse(await readFile(join(dir, "narration.json"), "utf8"));
  const out = [];
  for (const stops of Object.values(manifest.beats)) {
    for (const seg of stops) {
      const per = JSON.parse(
        await readFile(join(dir, seg.audio.replace(/\.mp3$/, ".json")), "utf8"),
      );
      out.push({ text: per.text, voice: per.voice });
    }
  }
  return out;
}

/**
 * edge-tts through `uv`, so it resolves against a locked environment rather
 * than whichever interpreter happens to be first on PATH.
 */
async function speak(text, voice, rate, audio, subs) {
  await run("uv", [
    "run",
    "--with",
    "edge-tts",
    "python",
    "-m",
    "edge_tts",
    "-v",
    voice,
    `--rate=${rate}`,
    "--pitch=+0Hz",
    "-t",
    text,
    "--write-media",
    audio,
    "--write-subtitles",
    subs,
  ]);
}

async function seconds(audio) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    audio,
  ]);
  const s = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(s) || s <= 0) throw new Error(`ffprobe gave nothing for ${audio}`);
  return s;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const segs = await segments();
process.stderr.write(`${segs.length} segments, voice ${segs[0].voice}, work ${WORK}\n`);

const results = {};
for (const [rate] of RATE_STEPS) {
  const dir = join(WORK, rate.replace(/[+%]/g, "") || "0");
  await mkdir(dir, { recursive: true });
  let chars = 0;
  let secs = 0;
  const cues = [];
  for (const [i, seg] of segs.entries()) {
    const audio = join(dir, `${i}.mp3`);
    const subs = join(dir, `${i}.srt`);
    await speak(seg.text, seg.voice, rate, audio, subs);
    secs += await seconds(audio);
    cues.push(...parseCues(await readFile(subs, "utf8")));
    chars += seg.text.length;
    if ((i + 1) % 10 === 0) process.stderr.write(`  ${rate}: ${i + 1}/${segs.length}\n`);
  }
  const rates = cues.map((c) => c.text.length / (c.end - c.start)).filter(Number.isFinite);
  const mean = chars / secs;
  results[rate] = {
    cues: cues.length,
    meanCps: mean,
    p95Cue: p95CueRate(cues),
    ratio: p95CueRate(cues) / mean,
    medianRatio: median(rates) / mean,
  };
}

await writeFile(join(WORK, "results.json"), `${JSON.stringify(results, null, 2)}\n`);

/* ------------------------------------------------------------------- report */

const base = results["+0%"].meanCps;
console.log("rate   table  MEASURED  meanCps  p95cue  p95/mean  med/mean   code says  vs artifact");
for (const [rate, speedup] of RATE_STEPS) {
  const r = results[rate];
  // What src/plan/duration.ts computes for this step: cps * speedup * CUE_OVERHEAD.
  const says = SPEECH_CPS.latin * speedup * CUE_OVERHEAD;
  console.log(
    `${rate.padEnd(6)} ${speedup.toFixed(3)} ${(r.meanCps / base).toFixed(3).padStart(9)}` +
      ` ${r.meanCps.toFixed(3).padStart(8)} ${r.p95Cue.toFixed(3).padStart(7)}` +
      ` ${r.ratio.toFixed(4).padStart(9)} ${r.medianRatio.toFixed(4).padStart(9)}` +
      ` ${says.toFixed(3).padStart(11)} ${(((says - r.p95Cue) / r.p95Cue) * 100).toFixed(1).padStart(11)}%`,
  );
}
const ratios = RATE_STEPS.map(([r]) => results[r].ratio);
console.log(
  `\nCUE_OVERHEAD is ${CUE_OVERHEAD}. Measured p95/mean spans ${Math.min(...ratios).toFixed(4)}` +
    `-${Math.max(...ratios).toFixed(4)} with no trend in rate; med/mean is the stable read.` +
    `\nA "MEASURED" column that disagrees with "table" means RATE_STEPS overstates what --rate buys.`,
);
