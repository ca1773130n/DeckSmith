/**
 * INK AT EVERY HOLD — the gate-independent, arm-symmetric quality measurement.
 *
 * TWO MEASURES, AND THE FIRST ONE FAILED. Whole-frame ink does not separate a good
 * compositional deck from an empty one: measured, arm MENU's median hold is 16.5% of
 * the frame and arm VOCAB's is 3.4%, but the HAND-WRITTEN CONTROL — verified correct
 * by eye, frame by frame — is 3.6%, sitting among arm VOCAB's failures rather than
 * above them. The 5x gap between arms is a drawing-style difference (an archetype
 * fills its stage boxes with a panel colour; a composed plan draws outlines), not a
 * defect signal. Reported rather than deleted, because a measurement that does not
 * work is worth exactly as much as one that does, and hiding it is how you get four
 * metrics and three winners.
 *
 * BODY INK is the one that works. The headline is 1.5-2% of the frame on its own and
 * it is present in every deck of both arms, which is why it swamps the whole-frame
 * number. Count only the band the DIAGRAM lives in — y from 0.22 to 0.95, which is
 * where the arm-VOCAB prompt puts the drawing and where every archetype puts its
 * visual — and a slide whose diagram never appeared reads near zero while the
 * control does not.
 *
 * `node ink.mjs [jobs=3]`
 *
 * WHY. The pre-registered primary metric said arm VOCAB was within ten points of
 * arm MENU. Then four frames were opened and four of arm VOCAB's sixteen
 * "gate-clean" decks turned out to have no diagram at all — boxes and labels
 * present in the DOM, sized legally, positioned legally, and multiplied to zero
 * opacity by a group they were nested in. `lint`, `runtime`, `layout`, `motion`,
 * `contrast` and the 40px floor all pass on an empty frame.
 *
 * `invisible.mjs` finds that class by arithmetic over the plan. This finds it by
 * LOOKING, on both arms, with one number that does not know which arm it is
 * measuring: render the deck, seek to each hold the plan declares, and count the
 * pixels that are not background. A slide the audience stops on and sees nothing on
 * is the failure; ink is the least theory-laden way to say so.
 *
 * Frames come from `hyperframes render`, never from `hyperframes snapshot`, because
 * snapshot is not the capture path and has been measured lying about CSS 3D
 * (VOCABULARY.md §5). What is counted here is what the video contains.
 *
 * THRESHOLD. Background is the `ink` theme's #0b0d10, luma about 13. A pixel counts
 * as ink above 26 — double the background — so antialiasing fringes do not inflate
 * a blank frame. The number reported is ink as a fraction of the 1920x1080 frame.
 * `EMPTY` is 0.35% of the frame, which is calibrated below rather than guessed:
 * the emptiest hold in the hand-written control deck is well above it and
 * vocab-18's boxless flow well below.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const W = 1920;
const H = 1080;
const LUMA = 26;
/** The band the diagram lives in, excluding the headline that every deck has. */
const BODY_TOP = Math.round(0.22 * H);
const BODY_BOTTOM = Math.round(0.95 * H);
/** Calibrated against the control's own emptiest hold, printed in the summary. */
const EMPTY_BODY = 0.004;

async function render(deck, mp4) {
  await run("npx", ["hyperframes", "render", deck, "-o", mp4, "--workers", "3"], {
    cwd: join(HERE, "..", ".."),
    maxBuffer: 64 << 20,
    timeout: 600_000,
  });
}

/** Ink fractions of one frame, from the render, as raw luma: whole frame and body. */
async function inkAt(mp4, t) {
  const { stdout } = await run(
    "ffmpeg",
    ["-loglevel", "error", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer", maxBuffer: 64 << 20 },
  );
  const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  if (buf.length < W * H) return null;
  let all = 0;
  let body = 0;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    const inBody = y >= BODY_TOP && y < BODY_BOTTOM;
    for (let x = 0; x < W; x++) {
      if (buf[row + x] > LUMA) {
        all++;
        if (inBody) body++;
      }
    }
  }
  return { all: all / (W * H), body: body / (W * (BODY_BOTTOM - BODY_TOP)) };
}

/** Absolute hold times a plan declares, both vocabularies. */
function holdTimes(plan) {
  const out = [];
  let start = 0;
  if (plan.scenes) {
    for (const s of plan.scenes) {
      for (const h of s.holds ?? []) out.push(Math.round((start + h) * 1000) / 1000);
      start += s.seconds ?? 8;
    }
    return out;
  }
  // Arm MENU declares no holds: the EMITTER decides them, and it publishes them in
  // the island. Read them back off the built deck rather than guessing — guessing
  // would measure a different set of moments in each arm.
  return null;
}

/**
 * The island's fragment times, which ARE arm MENU's holds.
 *
 * `emitIsland` writes `scene.holds` into each slide as absolute `fragments`, so this
 * reads back exactly the same moments arm VOCAB declares in its own `holds` — the
 * two arms are sampled at the set each one calls a stop, and not at a grid.
 */
function holdsFromDeck(deckDir) {
  const page = readFileSync(join(deckDir, "deck.html"), "utf8");
  const m = /<script type="application\/hyperframes-slideshow\+json">([\s\S]*?)<\/script>/.exec(page);
  if (!m) return [];
  const island = JSON.parse(m[1]);
  return [...new Set((island.slides ?? []).flatMap((s) => s.fragments ?? []))].sort((a, b) => a - b);
}

async function one(job) {
  const mp4 = join(OUT, `${job.name}.mp4`);
  // A plan the emitter refused has no deck, and a deck that does not exist is not a
  // blank slide — it is a build failure the primary metric already counted. Skipped
  // rather than scored 0, which would double-count it as an empty frame.
  if (!existsSync(join(job.deck, "index.html"))) return { name: job.name, arm: job.arm, notBuilt: true };
  if (!job.skipRender) {
    try {
      await render(job.deck, mp4);
    } catch (err) {
      return { name: job.name, arm: job.arm, error: String(err.message).slice(0, 160) };
    }
  }
  const times = job.holds.filter((t) => t > 0.05);
  const rows = [];
  for (const t of times) {
    const m = await inkAt(mp4, t);
    if (m) rows.push({ t, ...m });
  }
  const med = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const empties = rows.filter((r) => r.body < EMPTY_BODY);
  return {
    name: job.name,
    arm: job.arm,
    holds: rows.length,
    minBody: rows.length ? Math.min(...rows.map((r) => r.body)) : null,
    medianBody: med(rows.map((r) => r.body)),
    medianAll: med(rows.map((r) => r.all)),
    emptyHolds: empties.length,
    emptyAt: empties.map((r) => r.t),
    perHold: rows,
  };
}

/* ---------------------------------------------------------------------- main */

const jobs = [];
for (const arm of ["menu", "vocab"]) {
  for (let i = 1; i <= 20; i++) {
    const n = String(i).padStart(2, "0");
    const deck = join(OUT, "decks", `${arm}-${n}`);
    let holds;
    try {
      const plan = JSON.parse(readFileSync(join(HERE, "runs", `${arm}-${n}`, "plan.json"), "utf8"));
      holds = holdTimes(plan) ?? holdsFromDeck(deck);
    } catch {
      continue;
    }
    if (!holds?.length) continue;
    jobs.push({ name: `${arm}-${n}`, arm, deck, holds, skipRender: process.env.DS15_REUSE === "1" });
  }
}
// The hand-written control, as the calibration point for EMPTY.
jobs.push({
  name: "control-task",
  arm: "control",
  deck: join(OUT, "control-task"),
  holds: holdTimes(JSON.parse(readFileSync(join(HERE, "control", "task.json"), "utf8"))),
  skipRender: process.env.DS15_REUSE === "1",
});

const jobCount = Number(process.argv[2] ?? 3);
const results = new Array(jobs.length);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(jobCount, jobs.length) }, async () => {
    for (;;) {
      const k = next++;
      if (k >= jobs.length) return;
      results[k] = await one(jobs[k]);
      const r = results[k];
      process.stderr.write(
        r.notBuilt
          ? `  ${r.name}  (not built — the emitter refused the plan)\n`
          : `  ${r.name}  min body ${(100 * (r.minBody ?? 0)).toFixed(2)}%  median body ${(100 * (r.medianBody ?? 0)).toFixed(2)}%` +
              `  median frame ${(100 * (r.medianAll ?? 0)).toFixed(2)}%` +
              `${r.emptyHolds ? `   EMPTY BODY at ${r.emptyAt.join(",")}` : ""}\n`,
      );
    }
  }),
);

writeFileSync(join(OUT, "ink.json"), `${JSON.stringify(results, null, 2)}\n`);

for (const arm of ["menu", "vocab"]) {
  const rows = results.filter((r) => r.arm === arm && !r.notBuilt && !r.error);
  const bad = rows.filter((r) => r.emptyHolds > 0);
  const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  process.stdout.write(
    `arm ${arm.toUpperCase().padEnd(5)}  ${rows.length} decks measured  ` +
      `decks with a hold whose BODY IS EMPTY: ${bad.length}` +
      `${bad.length ? ` — ${bad.map((r) => r.name).join(", ")}` : ""}\n` +
      `${" ".repeat(11)}median body ink ${(100 * med(rows.map((r) => r.medianBody))).toFixed(2)}%   ` +
      `median whole-frame ink ${(100 * med(rows.map((r) => r.medianAll))).toFixed(2)}%\n`,
  );
}
const ctl = results.find((r) => r.arm === "control");
process.stdout.write(
  `control    hand-written, verified by eye: min body ${(100 * (ctl?.minBody ?? 0)).toFixed(2)}%  ` +
    `median body ${(100 * (ctl?.medianBody ?? 0)).toFixed(2)}%  median frame ${(100 * (ctl?.medianAll ?? 0)).toFixed(2)}%\n` +
    `           EMPTY_BODY threshold ${(100 * EMPTY_BODY).toFixed(2)}% — the control must sit well above it or this measure is worthless\n`,
);
