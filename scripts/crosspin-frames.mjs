/**
 * Compare two KEPT frame sequences rendered at DIFFERENT hyperframes pins.
 *
 * WHY `decksmith drift` CANNOT DO THIS. drift renders one deck TWICE AT THE
 * SAME INSTALLED PIN, so it measures run-to-run and worker-order stability and
 * is structurally incapable of seeing a cross-pin change. It is the right
 * instrument for "is this deck reproducible" and the wrong one for "did the bump
 * move anything". Nothing in this repo has ever compared two pins frame by
 * frame; issue #70 has no step for it either.
 *
 * WHAT IT IS LOOKING FOR. From a decompile of 0.8.27 against 0.8.30/0.8.31: the
 * element-activation window is floored to the frame grid with
 * `Math.floor(t*fps+1e-9)/fps`, gated on `window.__HF_EXPORT_RENDER_SEEK_CONFIG`,
 * which ONLY `hyperframes render` sets. `lint`, `check`, `verify`, the deck
 * player and `decksmith frames` are all blind to it by construction. If it bites,
 * it moves scene boundaries one frame earlier and nothing else — so the shape of
 * the differing set matters more than its size, and this reports the shape.
 *
 * A CAVEAT THIS PRINTS RATHER THAN HIDES. Whether the deck under test can see
 * that change at all depends on its own timings: flooring a boundary already on
 * the 1/30 grid is the identity. Pass `--deck <dir>` and it reads timing.json and
 * says how many boundaries are even eligible. A silent deck built from integer
 * beats has none, and a green result on one proves nothing about the change.
 *
 *   node scripts/crosspin-frames.mjs <framesA> <framesB> [--deck <dir>] [--floor 40]
 *
 * Exits non-zero when the frame COUNTS differ (the composition's duration moved,
 * and nothing frame-by-frame is meaningful after that), or when the worst
 * per-frame PSNR falls below the floor.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Mirrors `STAT` in src/verify/drift.ts, which dist does not export. */
const STAT = /^n:(\d+)\b.*\bpsnr_avg:(inf|-?[\d.]+)/;

/** `frame_000001.png` → `frame_%06d.png`, as src/verify/drift.ts derives it. */
function framePattern(name) {
  const m = /^(.*?)(\d+)(\.png)$/.exec(name);
  if (!m) return undefined;
  return { pattern: `${m[1]}%0${m[2].length}d${m[3]}`, start: Number(m[2]) };
}

async function frames(dir) {
  const names = await readdir(dir).catch(() => []);
  return names.filter((n) => n.endsWith(".png")).sort();
}

async function sha(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out + err) : reject(new Error(err.slice(-2000))),
    );
  });
}

async function main() {
  const args = process.argv.slice(2);
  const floorAt = args.indexOf("--floor");
  const deckAt = args.indexOf("--deck");
  const deck = deckAt === -1 ? null : args[deckAt + 1];
  // Spelled out because the terse form was WRONG and silently disarmed the gate:
  // `args[args.indexOf("--floor") + 1] ?? 40` reads args[0] — a directory path —
  // when the flag is absent, `??` does not catch the resulting NaN, and every
  // `db < NaN` is false, so `belowFloor` stayed empty and the comparison always
  // passed. Caught on 2026-09-09 by the flag reading `"floor": null` in output
  // that was otherwise green.
  const floor = floorAt === -1 ? 40 : Number(args[floorAt + 1]);
  if (!Number.isFinite(floor)) {
    process.stderr.write(`crosspin-frames: --floor needs a number, got ${args[floorAt + 1]}\n`);
    process.exit(2);
  }
  const positional = args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    return !(args[i - 1] === "--floor" || args[i - 1] === "--deck");
  });
  const [dirA, dirB] = positional;
  if (!dirA || !dirB) {
    process.stderr.write(
      "usage: node scripts/crosspin-frames.mjs <framesA> <framesB> [--deck <dir>] [--floor 40]\n",
    );
    process.exit(2);
  }

  const a = await frames(dirA);
  const b = await frames(dirB);
  const report = { a: dirA, b: dirB, framesA: a.length, framesB: b.length, floor };

  if (a.length === 0 || b.length === 0) {
    process.stdout.write(
      `${JSON.stringify({ ...report, error: "a sequence is empty" }, null, 2)}\n`,
    );
    process.exit(1);
  }
  if (a.length !== b.length) {
    process.stdout.write(
      `${JSON.stringify({ ...report, error: "frame counts differ — the composition's duration moved; nothing frame-by-frame is meaningful" }, null, 2)}\n`,
    );
    process.exit(1);
  }

  // Which frames differ at all, by content hash.
  const differing = [];
  for (let i = 0; i < a.length; i++) {
    const [ha, hb] = await Promise.all([sha(join(dirA, a[i])), sha(join(dirB, b[i]))]);
    if (ha !== hb) differing.push(i);
  }

  // Per-frame PSNR, parsed the way src/verify/drift.ts parses it.
  const pa = framePattern(a[0]);
  const pb = framePattern(b[0]);
  let worst;
  const belowFloor = [];
  if (pa && pb) {
    const stats = await run("ffmpeg", [
      "-hide_banner",
      "-nostats",
      "-start_number",
      String(pa.start),
      "-i",
      join(dirA, pa.pattern),
      "-start_number",
      String(pb.start),
      "-i",
      join(dirB, pb.pattern),
      "-lavfi",
      "psnr=stats_file=-",
      "-f",
      "null",
      "-",
    ]);
    for (const line of stats.split("\n")) {
      const s = STAT.exec(line);
      if (!s) continue;
      const db = s[2] === "inf" ? Number.POSITIVE_INFINITY : Number(s[2]);
      const frame = Number(s[1]);
      if (!worst || db < worst.db) worst = { frame, db };
      if (db < floor) belowFloor.push({ frame, db });
    }
  }

  // Where the differing frames SIT. The hypothesised change moves scene
  // boundaries and nothing else, so interior differences mean something else.
  let boundaries = null;
  if (deck) {
    const t = JSON.parse(await readFile(join(deck, "timing.json"), "utf8"));
    const fps = 30;
    const mt = (x) => Math.floor(x * fps + 1e-9) / fps;
    const edges = new Set();
    let eligible = 0;
    for (const s of t.scenes) {
      for (const v of [s.start, s.start + s.duration]) {
        edges.add(Math.round(v * fps));
        if (Math.ceil(v * fps - 1e-9) !== Math.ceil(mt(v) * fps - 1e-9)) eligible++;
      }
    }
    const near = (i) => [...edges].some((e) => Math.abs(e - i) <= 1);
    boundaries = {
      sceneBoundaries: edges.size,
      eligibleToShift: eligible,
      note:
        eligible === 0
          ? "NO boundary of this deck is off the 1/30 grid, so the render-time flooring change cannot move any frame here. A green result proves nothing about that change."
          : `${eligible} boundary values are off the grid and would each move one frame earlier under the flooring change.`,
      differingAtBoundary: differing.filter(near).length,
      differingInInterior: differing.filter((i) => !near(i)).length,
    };
  }

  Object.assign(report, {
    frames: a.length,
    identical: a.length - differing.length,
    differing: differing.length,
    differingFrames: differing.slice(0, 200),
    worst:
      worst && Number.isFinite(worst.db)
        ? worst
        : { frame: null, db: "inf (every frame identical)" },
    belowFloor,
    boundaries,
    pass: belowFloor.length === 0,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) {
    process.stderr.write(
      `crosspin FAIL: ${belowFloor.length} frame(s) below the ${floor} dB floor\n`,
    );
    process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(`crosspin-frames: ${e?.stack ?? e}\n`);
  process.exit(1);
});
