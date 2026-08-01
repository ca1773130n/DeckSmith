#!/usr/bin/env node
/**
 * sweep — push every archetype along its own axis until it breaks, and report
 * what the SHIPPED gates say about each result.
 *
 * WHY THIS EXISTS. Every `TUNED:` constant in `src/emit/` was fitted against one
 * deck. `demo/storyboard.json` is a four-stage pipeline, a 12x8 grid, five bars
 * and eight chart points — one point in a space the schema says is 2..6 stages,
 * any lattice, 2..8 bars and any number of points. Nothing ever asked what
 * happens at the other end of those ranges. Run once as a scratch experiment on
 * 2026-07-31 it found NINE layout defects at content the schema accepts and the
 * shipped demo never reaches:
 *
 *   grid              a note 11px past the canvas at 4x3, 18x12 and 24x16
 *   claim-figure      a long claim 27px past the bottom
 *   annotated-figure  a caption 81px BELOW the canvas under a 3-line headline
 *   line-chart        value, delta and category labels overprinting — 69 pairs
 *                     at 16 points
 *
 * All nine are fixed. This file is what stops them coming back — and moving it
 * in-repo immediately found three more, which is the argument for it in one
 * line: a `claim-figure` caption at y=1087 on a 1080 canvas, an
 * `annotated-figure` caption crushed to a 1.7px box, and a `stack` label
 * measured at weight 600 and drawn at 700 so its second line printed through the
 * note beneath. Two came from sampling the deck's own stops; the third came from
 * the collision rule and turned up on a real deck in `experiments/018-duration`,
 * not on a perturbation at all.
 *
 * THE LAST TWO IT REPORTED ARE NOW FIXED TOO. `b09-data-table` at 9 and 10 rows
 * pushed its headline off the top of the canvas and its note off the bottom —
 * `.scene` is centred, so an over-tall table overflows symmetrically and the
 * gate names the two elements that are not at fault. `data-table` now measures
 * the height its rows will actually be drawn at against the height the canvas
 * actually has, and declines the beat rather than draw past it, so those cells
 * are `refused` and they have moved from `OPEN` into `CORPUS` with that verdict
 * pinned. `OPEN` is empty; it stays here because the next unfixed defect needs
 * somewhere to be that is not silence.
 *
 * THE ONE RULE THIS FILE OBEYS, inherited from `scripts/score.mjs`: it shells out
 * to `node dist/cli.js build` and reports that command's own verdict. IT CONTAINS
 * NO DOM PREDICATE AT ALL. The scratch version had one — a text-range overflow
 * and collision measure — and it had to, because the repo's gate could not see
 * six of the nine defects. Rather than ship a second, drifting definition of
 * "broken", both halves were moved INTO the gate:
 *
 *   - the six overflows are found by `hyperframes check` once it is told to
 *     sample the deck's own stops (`CheckOptions.at`). It was sampling nine
 *     midpoints of a 92s deck and never once looking at a frame the audience
 *     holds on.
 *   - the three collisions are found by `src/verify/overprint.ts`, which had to
 *     be written because upstream's `content_overlap` exempts SVG text
 *     permanently and structurally.
 *
 * The consequence is the point: all nine now fail `decksmith build`, not merely
 * this sweep. A rule only the sweep runs is a rule that regresses between sweep
 * runs.
 *
 * WHAT WAS DELETED ON THE WAY IN. The scratch harness built each cell twice —
 * once here, once in a Remotion baseline — to answer a one-off comparison
 * question. That question is answered (see the 2026-07-31 robustness report).
 * The Remotion arm, its static file server, its measure page and
 * `@remotion/renderer` are all gone; none of them is a test dependency of this
 * repository and none should become one.
 *
 * COST, measured: `npm run build` plus five 12-beat level-decks, each built and
 * fully gated at its own stops. 58–62s on an M-series laptop, over five runs
 * whose verdict tables were byte-identical. Refusals cost a rebuild of the level
 * they occur in. `--level` builds one of the five when that is all you need.
 *
 * WHAT MAKES A RUN RED (`process.exitCode = 1`), all of it via `auditCorpus`:
 *   - a CORPUS cell that stopped matching its pinned verdict and rules
 *   - an OPEN cell that changed in either direction, including being fixed
 *   - a DEFECT or a build failure at any cell that is in neither table
 *   - an error that names no scene, so it could not be filed against a cell
 *   - a gate that did not RUN: see `blind` below. A sweep whose instrument was
 *     switched off reports every corpus cell clean, and that is the one result
 *     this file exists to make impossible.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { parseReport, toolFingerprint } from "./score.mjs";
import { CELLS, deckBeat, LEVELS } from "./sweep-perturbations.mjs";

const run = promisify(execFile);

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "dist", "cli.js");
/** node_modules is already ignored, survives a session, and dies on reinstall. */
const CACHE = join(REPO, "node_modules", ".cache", "decksmith-sweep");
export const LEDGER = join(REPO, "experiments", "sweep", "ledger.json");
export const CORPUS_FILE = join(REPO, "scripts", "sweep-perturbations.mjs");

/** The demo's source and figures — the only thing a perturbation cannot vary. */
const SOURCE = join(REPO, "demo", "source.json");
const ASSETS = join(REPO, "demo", "assets");

/**
 * The beat fields a perturbation does not vary. Nine seconds each, which is
 * inside the duration budget for twelve beats and keeps every beat in the cut —
 * a beat the budget drops is a beat this sweep never measured.
 */
const CORE = { intent: "the perturbation sweep", evidence: [], weight: 1, seconds: 9 };

/* --------------------------------------------------------------- the corpus */

/**
 * THE CORPUS: the cells that were real defects, and what the gates must say
 * about them now.
 *
 * WHY AN EXACT SET AND NOT A COUNT. "Fewer errors than the 69 we had" passes on
 * a half-reverted fix: reverting `86b8535` alone takes `b10-line-chart` L4 from
 * 0 collisions to 6, and reverting `701ae1d` alone also takes it to 6. Both are
 * regressions and both are "fewer than 69". `expect: []` is the only assertion
 * that fails on either.
 *
 * WHY THIS IS THE THING THAT MAKES THE SWEEP WORTH RUNNING. These are the cells
 * whose history is known: each FAILED before the named commit and passes after,
 * so `npm run sweep` on a tree with any of those commits reverted must go red.
 * That is a property somebody can check by reverting one commit, and it is the
 * only reason to believe a green sweep means anything.
 *
 * WHY `verdict` AND NOT JUST `expect`. `record()` starts every cell with
 * `rules: []`, so `refused`, `cut` and `build-error` all carry an empty rule
 * list — indistinguishable, to a comparison on rules alone, from "measured and
 * clean". Pointing the sweep at a format that does not exist makes all 53 cells
 * fail to build and STILL printed `9/9 known defects still fixed`, exit 0. That
 * is not a corner case: three of the nine cells here are held clean by a fix
 * whose mechanism IS a new refusal path (`MIN_PLATE`, `MIN_STAGE`), so moving
 * either threshold turns the cell `refused` — a real behaviour change that the
 * old comparison scored as green. The verdict is pinned so that "nothing
 * happened" can never read as "nothing is wrong".
 *
 * WHAT IT CANNOT DO ALONE, said plainly because the gap matters: every entry
 * here expects CLEAN, so a predicate that has silently stopped firing satisfies
 * all of them. Nothing in a corpus of fixed bugs can prove the instrument still
 * works. Two other things carry that proof: `test/verify.test.ts` drives both
 * halves of the collision rule and the widened sampling with inputs whose answer
 * is known and is not "nothing", and `blind()` below fails the run when a gate
 * reports that it did not run at all.
 *
 * `was` and `fixed` are load-bearing documentation, not decoration: they are how
 * the next person reproduces the failure this cell exists to catch.
 *
 * WHICH OF THESE ARE PROVEN LIVE, because "it is in the corpus" and "it would
 * catch the regression" are different claims and only one of them was tested:
 *
 *   b10-line-chart:2/3/4  PROVEN. `git checkout b3e5f35^ -- line-chart.ts` and
 *                         the sweep goes red on all three, reporting 12, 32 and
 *                         69 pairs — 69 being the same number the 2026-07-31
 *                         scratch run recorded, from a different predicate.
 *   b11-claim-figure:2    PROVEN. It failed in this file's first run and passed
 *   b03-annotated-figure  after the fix, both observed.
 *   b04-grid:0/3/4        NOT PROVEN. `git checkout b7a1f26^ -- grid.ts` — the
 *                         whole of that commit, it touched nothing else — leaves
 *                         the note's bottom at y=1046.8 on a 1080 canvas at all
 *                         three lattices, 33px clear, and every gate green. The
 *                         11px overflow the commit message records does not
 *                         reproduce on this tree. These three are kept because
 *                         the history is real and they cost nothing to check;
 *                         they should not be counted as evidence that the sweep
 *                         would catch a grid regression until somebody makes one
 *                         reproduce.
 */
export const CORPUS = {
  "b04-grid:0": {
    verdict: "ok",
    expect: [],
    was: "canvas_overflow — note 11px past the canvas",
    fixed: "b7a1f26",
  },
  "b04-grid:3": {
    verdict: "ok",
    expect: [],
    was: "canvas_overflow at 18x12",
    fixed: "b7a1f26",
  },
  "b04-grid:4": {
    verdict: "ok",
    expect: [],
    was: "canvas_overflow at 24x16",
    fixed: "b7a1f26",
  },
  // TWO defects on one cell, and the second is what the widened sampling found.
  // 3b96ff8 stopped a 216-char claim rendering 27px below the canvas by falling
  // back to the stacked layout; the caption underneath was then never budgeted
  // and landed at y=1087.16 on a 1080 canvas. Both are `canvas_overflow`, seven
  // weeks and one gate apart.
  "b11-claim-figure:2": {
    verdict: "ok",
    expect: [],
    was: "canvas_overflow — claim off the bottom, then the caption after it",
    fixed: "3b96ff8 + the bodyBudget floor in claim-figure.ts",
  },
  // THE ONLY TWO CELLS HERE WHOSE PINNED VERDICT IS NOT `ok`, and the verdict is
  // the whole content of the fix: `data-table` measures the height its rows will
  // be DRAWN at — the size the width solve chose, the padding already closed to
  // its floor, the rules between the rows — against the height the canvas has,
  // which is the content box plus the `PAD_Y` that `.scene` may overflow into at
  // each end. It declines the beat rather than draw past that. `refused` is a
  // correct outcome, not a defect (see the help text), but it must not become
  // `ok` by accident either — a table that silently starts drawing again at 9
  // rows is the old bug back.
  //
  // NEITHER CELL IS NEAR THE LINE, which is what makes them worth pinning: both
  // are over by more than the rounding in any of the three measurements.
  "b09-data-table:3": {
    verdict: "refused",
    expect: [],
    was: "canvas_overflow at 9 rows x 5 columns — 10 rows at 52px type stand 875px against the 782px this slide has, and `.scene` pins to the top padding once the body exceeds the content box, so the whole overrun went downward and put the note off the bottom",
    fixed: "the data-table canvas-height gate, 0ae7c18",
  },
  "b09-data-table:4": {
    verdict: "refused",
    expect: [],
    was: "the same at 10 rows x 6 columns, and half again as far over: 962px against the same 782px",
    fixed: "the data-table canvas-height gate, 0ae7c18",
  },
  // Also two. 33aba64 charged the headline's real wrapped height and stopped the
  // caption rendering 81px BELOW the canvas; `stageBudget`'s 360px floor then
  // crushed the same caption into a 1.7px box instead, which reads as
  // `clipped_text` + `text_box_overflow`. A floor that reports room it does not
  // have only moves which gate notices.
  "b03-annotated-figure:3": {
    verdict: "ok",
    expect: [],
    was: "canvas_overflow, then clipped_text + text_box_overflow",
    fixed: "33aba64 + the stageBudget floor in annotated-figure.ts",
  },
  "b03-annotated-figure:4": {
    verdict: "ok",
    expect: [],
    was: "canvas_overflow, then clipped_text + text_box_overflow",
    fixed: "33aba64 + the stageBudget floor in annotated-figure.ts",
  },
  "b10-line-chart:2": {
    verdict: "ok",
    expect: [],
    was: "svg_text_overprint",
    fixed: "b3e5f35",
  },
  "b10-line-chart:3": {
    verdict: "ok",
    expect: [],
    was: "svg_text_overprint",
    fixed: "b3e5f35 + 86b8535",
  },
  "b10-line-chart:4": {
    verdict: "ok",
    expect: [],
    // 69 was the 2026-07-31 scratch number and this file reproduced it exactly
    // from an independent implementation. It is 71 now, and the two extra pairs
    // are the point of a later fix rather than drift: `overprints` used to exempt
    // any two runs with the same string, so two DIFFERENT labels both reading
    // "30" were allowed to sit on top of each other. Identity is now per text
    // node. If a revert of these three commits ever reports 69 again, the string
    // comparison is back.
    was: "svg_text_overprint — 71 pairs at 16 points (69 before the same-string exemption went)",
    fixed: "b3e5f35 + 86b8535 + 701ae1d",
  },
};

/**
 * THE OPEN DEFECTS: real, reported by every run, and nobody has fixed them.
 *
 * EMPTY, as of the `data-table` height floor. The two cells that lived here —
 * `b09-data-table` at 9 and 10 rows — are in `CORPUS` now with the verdict they
 * actually have, `refused`. The table stays because the mechanism is what
 * matters, and the next defect that is reported before it is fixed needs it.
 *
 * WHY ANYTHING WOULD BE PINNED HERE AT ALL, given the argument above that a
 * corpus of fixed bugs must not carry unfixed ones. An entry here is not in
 * `CORPUS` and is not evidence that anything works; it is here so that the
 * cells in neither table can be held to "no defect". Without a baseline for the
 * ones that are known-broken, the only honest rule left is "print DEFECTs and
 * exit 0" — which is what this script did, so a brand-new overflow at
 * `b12-callout` was reported in full and passed CI. Only the pinned cells could
 * turn a run red; the rest could break in silence.
 *
 * A CHANGE IN EITHER DIRECTION IS RED, including a fix. That is deliberate and
 * it is the objection to a baseline file answered rather than dodged: repairing
 * `data-table` turned this run red ONCE, with a message saying the cell had
 * stopped matching and belonged in `CORPUS` with what fixed it — which is
 * exactly the bookkeeping that happened. Two lines at the moment the knowledge
 * exists is the cheapest this is ever going to be, and cheaper than the
 * alternative, which is a table that quietly stops describing the tree.
 */
export const OPEN = {};

/* -------------------------------------------------------------- the sweeper */

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const key = (cell) => `${cell.beatId}:${cell.level}`;

/**
 * Build one level as ONE deck.
 *
 * Twelve scenes per CLI run instead of one turns ~52 builds into 5, and the gate
 * is the whole cost of a build (`scripts/score.mjs` measured that). The beats
 * keep their own ids so a cut or a refusal names them.
 *
 * A REFUSAL THROWS THE WHOLE BUILD, which is why this is a loop. An archetype
 * that declines to draw content it cannot lay out raises before any deck exists,
 * and the message names the beat — so the refusal is recorded, that beat is
 * dropped, and the level is rebuilt without it. It terminates because every pass
 * removes at least one beat.
 *
 * A GATE FAILURE DOES NOT. `decksmith build` exits 1 on an error finding but
 * still writes the deck and still prints the whole report, so one successful
 * emit yields a verdict covering every beat at once. Collapsing the two into
 * "the build failed" is what the scratch version did, and it lost 13 cells.
 */
async function buildLevel(level, opts, onCell) {
  const source = JSON.parse(await readFile(SOURCE, "utf8"));
  const results = new Map();
  let pending = CELLS.filter((c) => c.level === level).map((cell) => ({
    cell,
    beat: deckBeat(cell, source, CORE),
  }));
  if (pending.length === 0) return results;

  // The CLI resolves a figure's `src` relative to the SOURCE FILE's directory,
  // so a perturbed source in a bare temp dir makes every figure vanish — which
  // the lint gate correctly reports as `missing_local_asset`, and which failed
  // all five builds the first time. The assets travel with the source.
  const dir = join(CACHE, "decks", `level-${level}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "assets"), { recursive: true });
  for (const fig of source.figures) await cp(join(ASSETS, fig.src), join(dir, "assets", fig.src));
  const srcPath = join(dir, "source.json");
  await writeFile(srcPath, JSON.stringify(source));

  const sbPath = join(dir, "storyboard.json");
  const out = join(dir, "deck");
  for (let attempt = 0; attempt < CELLS.length && pending.length > 0; attempt++) {
    await writeFile(
      sbPath,
      JSON.stringify({
        sourceId: source.id,
        title: `sweep level ${level}`,
        beats: pending.map((p) => p.beat),
      }),
    );
    await rm(out, { recursive: true, force: true });
    const argv = ["build", sbPath, "--source", srcPath, "-o", out, "--format", opts.format];
    let stdout = "";
    let stderr = "";
    let code = 0;
    const started = Date.now();
    try {
      const r = await run(process.execPath, [CLI, ...argv], {
        cwd: REPO,
        timeout: opts.timeoutMs,
        maxBuffer: 32 << 20,
      });
      stdout = r.stdout;
      stderr = r.stderr;
    } catch (err) {
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      code = err.code ?? 1;
    }
    const seconds = Number(((Date.now() - started) / 1000).toFixed(2));
    const parsed = parseReport(stdout, stderr, code);

    // No verdict line means the run died before the gates: a refusal, or an
    // input this tool cannot build at all. `parseReport` marks both with a
    // `build` gate finding.
    const died = parsed.findings.find((f) => f.gate === "build");
    if (died) {
      const why = `${stdout}\n${stderr}`;
      const hit = pending.find((p) => why.includes(`${p.beat.archetype} ${p.beat.id}:`));
      if (!hit) {
        for (const p of pending)
          results.set(
            key(p.cell),
            await onCell(record(p.cell, "build-error", { reason: died.message })),
          );
        return results;
      }
      const reason = new RegExp(`${hit.beat.archetype} ${hit.beat.id}: [^\\n]*`).exec(why)?.[0];
      // REFUSED IS NOT A DEFECT. A system that says "these panels do not fit,
      // shorten them" has behaved correctly; one that draws them off the bottom
      // of the slide has not. Collapsing the two would score honesty as failure.
      results.set(
        key(hit.cell),
        await onCell(
          record(hit.cell, "refused", { reason: (reason ?? died.message).trim().slice(0, 160) }),
        ),
      );
      pending = pending.filter((p) => p !== hit);
      continue;
    }

    // Before reading a single verdict: did the gates that produce them run?
    for (const b of await blind(parsed, out, level)) results.set(b.where, b);

    // The deck exists and every gate ran. Scene N is the Nth beat that SURVIVED
    // the duration budget — `build` prints what it cut, so the mapping is read
    // off the run rather than assumed. Assuming it is how a finding about one
    // archetype gets filed against another.
    const cut = new Set([...stderr.matchAll(/^build:\s+cut (\S+) /gm)].map((m) => m[1]));
    const scenes = pending.filter((p) => !cut.has(p.beat.id));
    const perCell = new Map(pending.map((p) => [key(p.cell), []]));
    const orphans = [];
    for (const f of parsed.findings) {
      if (f.severity !== "error") continue;
      const at = /#s(\d+)\b/.exec(f.message)?.[1];
      const owner = at ? scenes[Number(at) - 1] : undefined;
      if (owner) perCell.get(key(owner.cell)).push(f);
      // A deck-level error names no scene — a determinism hit, a missing audio
      // file. It belongs to no cell and must not be filed against s1 by
      // accident, so it is reported separately and loudly.
      else orphans.push(f);
    }
    for (const p of pending) {
      const mine = perCell.get(key(p.cell));
      results.set(
        key(p.cell),
        await onCell(
          record(p.cell, cut.has(p.beat.id) ? "cut" : mine.length ? "DEFECT" : "ok", {
            deck: relative(REPO, out),
            scene: cut.has(p.beat.id) ? null : `s${scenes.indexOf(p) + 1}`,
            rules: [...new Set(mine.map((f) => f.rule))].sort(),
            findings: mine.map((f) => `${f.rule}  ${f.message}`),
            seconds,
          }),
        ),
      );
    }
    if (orphans.length > 0)
      results.set(`level-${level}:orphans`, {
        where: `level-${level}:orphans`,
        level,
        verdict: "deck-error",
        rules: [...new Set(orphans.map((f) => f.rule))].sort(),
        why:
          `level ${level}: ${orphans.length} error(s) name no scene, so they could not be ` +
          `filed against any cell: ${orphans.map((f) => f.rule).join(", ")}`,
      });
    return results;
  }
  return results;
}

/**
 * DID THE INSTRUMENT RUN? Answered per level, before any verdict is read.
 *
 * MEASURED, and it is the worst failure this harness had. With
 * `DECKSMITH_CHROME` pointed at a path that does not exist, `fidelity` catches
 * the launch failure and returns one `not_measured` finding at severity
 * **warning**; the loop below keeps only errors, so it was dropped. The run then
 * printed a verdict table CHARACTER-FOR-CHARACTER identical to a healthy one,
 * `corpus: 9/9 known defects still fixed`, and exit 0 — on a third of the user
 * CPU, because two thirds of the work never happened. `svg_text_overprint` lives
 * in that pass, so `b10-line-chart:2/3/4` — the only three cells whose catch is
 * PROVEN by reverting a commit — report clean on a browserless machine whether
 * the fix is there or not. `hyperframes check` finds its own Chrome and is
 * unaffected, which is what made the degradation invisible.
 *
 * Warning is the right severity for the PRODUCT: `decksmith build` on a machine
 * with no browser should say so and carry on. It is the wrong severity for this
 * file, whose entire output is a claim about what the browser saw. So the sweep
 * escalates it, and escalates it here rather than in `src/verify/` — the gate
 * keeps its judgement, the harness states its own requirement.
 *
 * THE SECOND CHECK is the one a stub cannot make. `collectSvgTextRuns` finds a
 * scene by `data-composition-id` and collects `<text>` inside `<svg>`; rename
 * the attribute or stop emitting chart labels as SVG text and it returns `[]`
 * forever, silently, with every corpus cell still green and every unit test
 * still passing. Every level deck contains `bar-compare` and `line-chart`, so
 * both strings are in every built `index.html` — and if a chart ever stops being
 * in the deck, the collision rule measured nothing at that level anyway, which
 * is the same finding stated differently.
 */
async function blind(parsed, out, level) {
  const found = [];
  const at = (what, why) => ({
    where: `level-${level}:${what}`,
    level,
    verdict: "blind",
    rules: [],
    why: `level ${level}: ${why} — every verdict at this level is unverified`,
  });
  const notMeasured = parsed.findings.find(
    (f) => f.gate === "fidelity" && f.rule === "not_measured",
  );
  if (notMeasured)
    found.push(at("fidelity", `the fidelity pass did not run (${notMeasured.message})`));

  const why = measurable(await readFile(join(out, "index.html"), "utf8").catch(() => ""));
  if (why) found.push(at("deck", why));
  return found;
}

/**
 * Is there anything in this deck for the collision rule to look at? The reason
 * why not, or `null`.
 *
 * Split out and exported so the contract can be checked without building a deck
 * — `experiments/sweep/swept.test.mjs` drives it — and stated once, so the
 * strings it looks for sit next to the reason they matter rather than being
 * guessed at twice.
 */
export function measurable(html) {
  if (!html.includes("data-composition-id="))
    return (
      "the built deck names no scene with `data-composition-id`, which is how " +
      "`collectSvgTextRuns` finds a scene at all"
    );
  if (!/<text[\s>]/.test(html))
    return (
      "the built deck contains no SVG `<text>`, so the collision rule read nothing " +
      "(every level deck draws a bar-compare and a line-chart, so this should be impossible)"
    );
  return null;
}

function record(cell, verdict, extra) {
  return {
    key: key(cell),
    beatId: cell.beatId,
    level: cell.level,
    axis: cell.axis,
    verdict,
    rules: [],
    findings: [],
    at: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Run every cell. Exported so a future harness can call it without re-parsing
 * this file's own table.
 *
 * Levels run one at a time, deliberately. Each build boots its own Chrome for
 * `hyperframes check` and a second in-process one for `fidelity`; five of those
 * in parallel is ten browsers on a laptop, to save well under a minute on a run
 * that takes one. `levels` narrows it further when only one is being looked at.
 */
export async function sweep(opts = {}) {
  const o = { format: "deck-16x9", timeoutMs: 600_000, onCell: (r) => r, levels: null, ...opts };
  const results = new Map();
  for (const level of o.levels ?? [...Array(LEVELS).keys()])
    for (const [k, v] of await buildLevel(level, o, o.onCell)) results.set(k, v);
  return results;
}

/* --------------------------------------------------------------------- audit */

/**
 * The cells a run of these `only` levels is entitled to make claims about.
 *
 * `--level 2` builds 12 of the 53, so nine of the eleven pinned cells were never
 * measured. Held to the whole table, a partial run reports them missing and goes
 * red every time — and a red that everybody learns to ignore is the same as no
 * check at all. Held to this one, it audits what it built and says so.
 */
export function pinnedFor(only = null, corpus = CORPUS, open = OPEN) {
  const all = { ...corpus, ...open };
  if (only === null) return all;
  return Object.fromEntries(
    Object.entries(all).filter(([k]) => only.includes(Number(k.split(":")[1]))),
  );
}

/**
 * Everything that must be true of a run, in one function, so that the sweep and
 * the guard test in `experiments/sweep/swept.test.mjs` cannot drift apart about
 * what "green" means. An entry per disagreement; empty means the run is clean.
 *
 * A MISSING CELL IS A FAILURE, not a skip. If a table names a cell the sweep
 * never produced — a renamed beat, a level that stopped existing — the guarantee
 * is gone and saying nothing would look identical to saying "clean".
 */
export function auditCorpus(results, corpus = CORPUS, open = OPEN, only = null) {
  const bad = [];
  const pinned = pinnedFor(only, corpus, open);
  for (const [k, want] of Object.entries(pinned)) {
    const got = results.get(k);
    if (!got) {
      bad.push({
        key: k,
        why: `not in this sweep at all (was ${want.was}, fixed by ${want.fixed})`,
      });
      continue;
    }
    const rules = got.rules ?? [];
    const show = (v, r) => `${v} [${r.join(", ") || "no rules"}]`;
    // BOTH, and this is the whole point of pinning the verdict: `refused`, `cut`
    // and `build-error` all carry an empty rule list, so on rules alone a cell
    // that never got measured is identical to one measured and found clean.
    if (got.verdict !== want.verdict || rules.join("|") !== want.expect.join("|"))
      bad.push({
        key: k,
        why:
          `expected ${show(want.verdict, want.expect)}, got ${show(got.verdict, rules)} — ` +
          `this cell was ${want.was} before ${want.fixed}`,
      });
  }

  // The other forty-two. They have no pinned history, so the only thing claimed
  // about them is that they are not broken — which is a claim worth failing on.
  for (const [k, got] of results) {
    if (pinned[k]) continue;
    if (got.key && (got.verdict === "DEFECT" || got.verdict === "build-error"))
      bad.push({
        key: k,
        why:
          `NEW ${got.verdict} at a cell with no history: [${(got.rules ?? []).join(", ") || got.reason || "?"}]. ` +
          "Fix it, or pin it in OPEN with what it is and why it is not fixed yet.",
      });
    // A gate that reported it did not run, and an error nobody could file
    // against a cell. Neither is a defect in a deck; both mean the numbers above
    // are not measuring what they claim to.
    if (got.verdict === "blind" || got.verdict === "deck-error") bad.push({ key: k, why: got.why });
  }
  return bad;
}

/* --------------------------------------------------------------------- ledger */

/**
 * The receipt file the guard test reads.
 *
 * It carries the corpus file's sha256 and the tool fingerprint, and those two
 * are the whole point: a verdict earned by different perturbations, or by a
 * different `dist/`, is a fact about something else. Replaced rather than
 * merged — unlike `score`'s ledger, one run of this covers every cell there is,
 * so a partial merge could only ever mix two tools' answers together.
 */
export async function updateLedger(results, meta, path = LEDGER) {
  const cells = {};
  const levels = [];
  for (const [k, r] of [...results].sort(([a], [b]) => a.localeCompare(b))) {
    // Deck- and level-wide entries have no cell behind them. They are the
    // "the instrument was off" and "this error names no scene" results, and a
    // receipt that dropped them would be a receipt that looks perfect.
    if (!r.key) {
      levels.push({
        where: k,
        level: r.level,
        verdict: r.verdict,
        rules: r.rules ?? [],
        why: r.why ?? null,
      });
      continue;
    }
    cells[k] = {
      verdict: r.verdict,
      // The axis, so the receipt says what was varied and not only how far.
      axis: r.axis ?? null,
      rules: r.rules ?? [],
      reason: r.reason ?? null,
      deck: r.deck ?? null,
      scene: r.scene ?? null,
    };
  }
  const ledger = { ...meta, updated: new Date().toISOString(), levels, cells };

  // REWRITE ONLY WHEN SOMETHING CHANGED. `updated` alone made every run dirty a
  // tracked file, so `npm run sweep` could never be run on a clean tree without
  // leaving a diff — and a diff that is always there is a diff nobody reads.
  const prev = JSON.parse(await readFile(path, "utf8").catch(() => "null"));
  const bones = (o) => JSON.stringify({ ...o, updated: null });
  if (prev && bones(prev) === bones(ledger)) return prev;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

/** The bytes that would have to change before a receipt stops being about them. */
export async function sweepFingerprint() {
  return toolFingerprint([
    await readFile(new URL(import.meta.url)).catch(() => Buffer.from("missing:self")),
    await readFile(CORPUS_FILE).catch(() => Buffer.from("missing:corpus")),
  ]);
}

export async function corpusSha() {
  return sha(await readFile(CORPUS_FILE));
}

/* ------------------------------------------------------------------------- CLI */

const MARK = { ok: "ok", DEFECT: "DEFECT", refused: "refused", cut: "cut", "build-error": "ERROR" };

function table(results) {
  const rows = [...results.values()].filter((r) => r.key);
  const w = Math.max(4, ...rows.map((r) => r.beatId.length));
  return rows
    .map((r) =>
      [
        r.beatId.padEnd(w),
        `L${r.level}`,
        (MARK[r.verdict] ?? r.verdict).padEnd(8),
        (r.rules ?? []).join(",") || (r.reason ?? ""),
      ]
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

async function main() {
  const { values: v } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      format: { type: "string", default: "deck-16x9" },
      json: { type: "string" },
      ledger: { type: "string" },
      level: { type: "string", multiple: true },
      "no-ledger": { type: "boolean", default: false },
      "no-fail": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (v.help) {
    process.stdout.write(`sweep — push every archetype along its own axis and gate what comes out.

  npm run sweep [-- options]

  --format <id>  output profile (default deck-16x9)
  --level <n>    build only these level-decks (repeatable, 0..${LEVELS - 1}); no receipt
                 is written for a partial run unless --ledger names a file
  --json <f>     write the full result set here
  --no-ledger    do not record receipts in experiments/sweep/ledger.json
  --no-fail      report everything but exit 0

Every verdict here is \`decksmith build\`'s own. \`refused\` is NOT a defect: an
archetype that declines to draw what it cannot lay out has behaved correctly.

The run is RED when any of these is true:
  - one of the ${Object.keys(CORPUS).length} cells in CORPUS stopped matching its pinned verdict, which
    means one of the layout fixes it names has been reverted
  - ${
    Object.keys(OPEN).length === 0
      ? "an OPEN cell changed, INCLUDING being fixed — but OPEN is empty today"
      : `one of the ${Object.keys(OPEN).length} cells in OPEN changed, INCLUDING being fixed — say so there`
  }
  - any other cell produced a DEFECT or failed to build
  - a gate reported that it did not run, so the verdicts are not evidence
`);
    return;
  }

  const only = v.level?.length ? v.level.map(Number) : null;
  const bogus = only?.filter((n) => !Number.isInteger(n) || n < 0 || n >= LEVELS);
  if (bogus?.length) {
    process.stderr.write(
      `sweep: no such level: ${bogus.join(", ")} (there are 0..${LEVELS - 1})\n`,
    );
    process.exitCode = 2;
    return;
  }

  const tool = await sweepFingerprint();
  const planSha = await corpusSha();
  const cells = only ? CELLS.filter((c) => only.includes(c.level)) : CELLS;
  process.stderr.write(
    `sweep: ${cells.length} cell(s) over ${only ? `level(s) ${only.join(", ")}` : `${LEVELS} level-deck(s)`}, tool ${tool}\n`,
  );
  const started = Date.now();
  const results = await sweep({
    format: v.format,
    levels: only,
    onCell: (r) => {
      process.stderr.write(
        `  ${(MARK[r.verdict] ?? r.verdict).padEnd(8)} ${r.beatId} L${r.level}` +
          `${r.rules?.length ? `  ${r.rules.join(",")}` : ""}${r.reason ? `  ${r.reason}` : ""}\n`,
      );
      return r;
    },
  });
  const wall = ((Date.now() - started) / 1000).toFixed(1);

  process.stdout.write(`\n${table(results)}\n`);

  const tally = {};
  for (const r of results.values()) if (r.key) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
  process.stdout.write(
    `\n${[...Object.entries(tally)].map(([k, n]) => `${n} ${MARK[k] ?? k}`).join(", ")} ` +
      `over ${[...results.values()].filter((r) => r.key).length} cell(s) in ${wall}s\n`,
  );

  // A defect is reported with the two things somebody reproducing it needs and
  // had to go and find in `sweep-perturbations.mjs`: WHICH axis this level moved
  // along, and WHERE the deck it happened in is sitting on disk.
  for (const r of results.values())
    if (r.verdict === "DEFECT") {
      process.stdout.write(
        `\n${r.key}  ${r.axis}, level ${r.level} of ${LEVELS - 1}` +
          `${r.scene ? ` (scene ${r.scene})` : ""}\n  deck: ${r.deck}\n`,
      );
      for (const f of r.findings) process.stdout.write(`  ${f}\n`);
    }
  for (const r of results.values())
    if (r.verdict === "blind" || r.verdict === "deck-error")
      process.stdout.write(`\n!! ${r.why}\n`);

  const regressed = auditCorpus(results, CORPUS, OPEN, only);
  // Counted off the cells this run actually built, not off the tables, so that
  // `--level 2` cannot report having checked nine fixes it never went near.
  const pinned = Object.keys(pinnedFor(only));
  const fixed = pinned.filter((k) => CORPUS[k]).length;
  const open = pinned.filter((k) => OPEN[k]).length;
  const measured = [...results.values()].filter((r) => r.key).length;
  process.stdout.write(
    regressed.length === 0
      ? `\ncorpus: ${fixed}/${fixed} known defect(s) still fixed, ${open} still open, ` +
          `${measured - fixed - open} other cell(s) undefective\n`
      : `\ncorpus: ${regressed.length} FAILURE(S) against ${pinned.length} pinned cell(s)\n${regressed
          .map((r) => `  ${r.key}  ${r.why}`)
          .join("\n")}\n`,
  );

  // A PARTIAL RUN MUST NOT LEAVE A WHOLE-RUN RECEIPT. `--level 2` measures 12 of
  // 53 cells; writing that to the ledger would hand the guard test a receipt
  // whose missing cells look exactly like cells that were never in the corpus.
  if (!v["no-ledger"] && (v.ledger || !only)) {
    const path = v.ledger ? resolve(v.ledger) : LEDGER;
    await updateLedger(
      results,
      { tool, planSha, corpus: CORPUS, open: OPEN, format: v.format },
      path,
    );
    process.stdout.write(`receipts → ${relative(REPO, path)}\n`);
  } else if (only && !v["no-ledger"]) {
    process.stdout.write("no receipt written: a partial run is not evidence about the corpus\n");
  }
  if (v.json)
    await writeFile(resolve(v.json), `${JSON.stringify([...results.values()], null, 2)}\n`);
  if (regressed.length > 0 && !v["no-fail"]) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
