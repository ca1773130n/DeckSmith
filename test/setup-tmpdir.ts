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
 * WHY AN `exit` LISTENER AS WELL AS THE TEARDOWN, AND WHY PREPENDED. Vitest
 * calls the teardown only from `Vitest.close()`. On SIGINT or SIGTERM, vitest
 * 3.2.7's own handler (`addCleanupListeners` in `vitest/dist/chunks/cli-api.*.js`)
 * calls `process.exit()` directly, so `close()` never runs. Measured on
 * 2026-09-18, a run stopped that way left its whole directory behind, with
 * everything its tests had made inside it. That handler is also registered on
 * `exit`, and calling `process.exit()` from inside an `exit` listener ends the
 * process before any later listener runs. A plain `process.once("exit")` added
 * here would come after it and never run. `prependOnceListener` puts this one
 * first. It uses `rmSync` because an `exit` listener cannot wait on anything.
 * SIGKILL still skips both. So does a crash that kills node outright. And a
 * signal sent to the vitest process alone, not its group, can leave forked
 * workers running with nobody to report to, and they can still write under
 * the old path after it is removed.
 *
 * The guard still runs first, so the run directory itself never lands in this
 * checkout. From a worktree pointed at another checkout it does, for the length
 * of the run, and it is removed on the way out.
 *
 * TypeScript rather than `.mjs` because vitest transforms it natively, which
 * keeps `npm test` free of any build precondition, and `scripts/build.mjs`
 * already drops the tests' declarations so it costs nothing at publish.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardTmpdir } from "../src/tmpdir.js";

/** Tries before `removeRunDir` gives up, pausing 25 ms longer after each one. */
const ATTEMPTS = 8;

/**
 * `rmSync`, retried with a pause that actually happens.
 *
 * Node's own retry does not do this for short delays. On node 24.14.0,
 * `rmSync` with `maxRetries` 3 or 5 and `retryDelay` 100 gave up on a
 * directory it could not empty after 1 ms, with no pause at all, while
 * `retryDelay` 400 took 2,022 ms. The delay looks truncated to whole seconds.
 * The pause matters on the way out after a signal. Children the signal also
 * reached can go on writing for a few milliseconds: on 2026-09-18, a SIGINT
 * sent to the whole process group failed with ENOTEMPTY 98 ms after the
 * signal, because an `npm exec` child was just then creating
 * `node-compile-cache` in the run directory.
 *
 * Only ENOTEMPTY and EBUSY are retried. Anything else will not get better by
 * waiting. `Atomics.wait` because an `exit` listener cannot await.
 */
export function removeRunDir(dir: string): void {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= ATTEMPTS || (code !== "ENOTEMPTY" && code !== "EBUSY")) throw error;
      Atomics.wait(pause, 0, 0, 25 * attempt);
    }
  }
}

export default function setup(): () => void {
  guardTmpdir();
  const before = process.env.TMPDIR;
  const run = mkdtempSync(join(tmpdir(), "decksmith-test-"));
  process.env.TMPDIR = run;

  const onExit = (): void => {
    try {
      removeRunDir(run);
    } catch (error) {
      // A throw from the first `exit` listener stops every listener after it,
      // vitest's own terminal cleanup included (checked on node 24.14.0). Name
      // the directory instead, so it can be removed by hand.
      process.stderr.write(`setup-tmpdir: could not remove ${run} on exit: ${String(error)}\n`);
    }
  };
  process.prependOnceListener("exit", onExit);

  return () => {
    process.off("exit", onExit);
    // Restored before the removal, so nothing vitest does while closing asks
    // for a temp directory that no longer exists.
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    removeRunDir(run);
  };
}
