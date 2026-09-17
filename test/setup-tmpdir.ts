/**
 * The test run's own temp directory: made before any worker starts, removed
 * after the last test file finishes. Named in `globalSetup`, so it runs once, in
 * the parent vitest process.
 *
 * WHY IT OWNS A DIRECTORY, not just the guard. Eighteen `mkdtemp(join(tmpdir(),
 * …))` sites across thirteen test files make a directory per case, and ten of
 * those files never remove theirs. This file used to be a `setupFiles` entry
 * that only called `guardTmpdir()`, and a guard moves scratch, it does not
 * remove it: an unset `TMPDIR` sends the same directories to the platform temp
 * directory, which held 3,146 under the suite's ten prefixes on 2026-09-18. Nor
 * does the guard fire for a `TMPDIR` that is some OTHER checkout: a git worktree
 * run from a session whose `TMPDIR` is the main repo is not inside its own
 * package root, so the variable is left alone and the directories land in the
 * main repo. Measured the same day with `TMPDIR` set to an empty directory, one
 * `npm test` left 111 directories behind. See
 * `.planning/2026-09-18-test-tmpdir-leak.md`.
 *
 * WHY THE PARENT REACHES THE WORKERS. `os.tmpdir()` is read at call time, so
 * computing a path here would not reach a forked test — but setting the
 * VARIABLE does: vitest copies `process.env` into the pool's env when it starts
 * running files, which is after `globalSetup`, and each worker's children
 * (Chrome, ffmpeg, node) inherit it from there. `test/wiring.test.ts` asserts
 * both, from inside a worker and from a child of one, because a change here that
 * stopped reaching them would fail nothing else and bring the litter back.
 *
 * ONE DIRECTORY PER RUN rather than per test file: it is removed after every
 * worker is done, so a background write a test left running cannot land in a
 * directory that has already gone and fail the run with an unhandled ENOENT.
 *
 * The guard still runs first, so the run directory itself never lands in this
 * checkout. From a worktree pointed at another checkout it does, for the length
 * of the run, and teardown removes it.
 *
 * TypeScript rather than `.mjs` because vitest transforms it natively, which
 * keeps `npm test` free of any build precondition, and `scripts/build.mjs`
 * already drops the tests' declarations so it costs nothing at publish.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardTmpdir } from "../src/tmpdir.js";

export default function setup(): () => void {
  guardTmpdir();
  const before = process.env.TMPDIR;
  const run = mkdtempSync(join(tmpdir(), "decksmith-test-"));
  process.env.TMPDIR = run;

  return () => {
    // Restored before the removal, so nothing vitest does while closing asks
    // for a temp directory that no longer exists.
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(run, { recursive: true, force: true, maxRetries: 3 });
  };
}
