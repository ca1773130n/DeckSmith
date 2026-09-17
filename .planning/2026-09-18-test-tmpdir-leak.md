# The test suite's temp-directory leak

**Date** 2026-09-18. Branch `fix/test-tmpdir-leak`, from `origin/main` at `3e5f90a`.

## What was reported

Four `npm run check` runs on 2026-09-17, in sessions whose `TMPDIR` was the repo
root, left 562 directories: `decksmith-server-*` 256, `ds-mcp-*` 68,
`ds-harvest-*` 64, `ds-images-*` 40, `decksmith-pack-*` 36, `decksmith-narrate-*`
36, `ds-playback-*` 24, `decksmith-assets-*` 24, `ds-prov-*` 8,
`decksmith-transcode-*` 4. `vitest.config.ts` already named
`test/setup-tmpdir.ts` in `setupFiles`.

**Read that as a snapshot, not as four identical runs.** Nine of the ten
prefixes are exactly four times what one `npm test` leaves under "Measurement"
below — 17, 16, 10, 9, 9, 6, 6, 2 and 1 against 68, 64, 40, 36, 36, 24, 24, 8
and 4. `decksmith-server-*` is not: 256 is 64 a run, against 35 measured, where
four runs would give 140. The ten prefixes also sum to 560, not the 562
reported. So whatever those sessions were doing made `decksmith-server-*`
directories beyond the four suites — `test/server.test.ts` is the only thing in
this repo that makes them, so a partial or repeated run of that file is the
likely extra. The controlled numbers are the ones under "Measurement"; this
count is what was reported, and only nine of its rows scale.

## Why that setup file neither prevented it nor cleaned it up

It only ran `guardTmpdir()`, which does two things and neither is cleanup:

1. **It moves scratch; it never removes it.** When `TMPDIR` resolves inside the
   package root, the guard unsets it, and `os.tmpdir()` falls back to the platform
   default. Every `mkdtemp` in the suite still leaves its directory behind, just
   somewhere else. On this machine
   `/var/folders/tf/xmh95cgj521b9xcpry37lrmc0000gn/T` held 3,146 directories
   under the same ten prefixes on 2026-09-18 (plus two `decksmith-plan-*`).
   Those were counted and left alone, because this session did not create them.
2. **It only knows about its own checkout.** `packageRoot()` is the directory
   holding the package's own `package.json`. In a git worktree that is the
   worktree, so a `TMPDIR` pointing at the main checkout is not "inside" it and
   the guard does nothing. Measured in this branch's worktree with
   `TMPDIR=/Users/neo/Developer/Projects/DeckSmith`: `insideRoot(tmpdir())` was
   `false` and `TMPDIR` was still set after `guardTmpdir()`. With the guard
   present, that is the only way a run puts these directories in a repo root.
   It is an inference, not a measurement, that the four runs above took this
   route.

## Measurement

Conditions for both runs: macOS (Darwin 25.3.0), node 24.14.0, npm 11.9.0,
vitest 3.2.7. `npm test` was run through `heavy.sh` with `HEAVY_KEEP_TMPDIR=1` and
`TMPDIR` set to a fresh, empty directory under `~/.blackhole/DeckSmith/2026-09-18/`.

**Before** (`3e5f90a`): 49 files, 1,635 tests passed, 112 entries left.

| prefix | left | made by | removed? |
| --- | --- | --- | --- |
| `decksmith-server-` | 35 | `test/server.test.ts` `scratch()` | no (its `afterEach` closes servers, not directories) |
| `ds-mcp-` | 17 | `test/mcp.test.ts` `work()` | no |
| `ds-harvest-` | 16 | `test/harvest.test.ts` `work()` | no (its `afterEach` closes servers) |
| `ds-images-` | 10 | `test/images.test.ts` `dir()` | no |
| `decksmith-pack-` | 9 | `test/pack.test.ts` `dir()` | no |
| `decksmith-narrate-` | 9 | `test/narrate.test.ts` `dir()` | no |
| `decksmith-assets-` | 6 | `test/source.test.ts` `work()` | no |
| `ds-playback-` | 6 | `test/render.test.ts` | no |
| `ds-prov-` | 2 | `test/provider.test.ts` | no |
| `decksmith-transcode-` | 1 | `test/transcode.test.ts` `beforeAll` | no |
| `node-compile-cache` | 1 | npm itself | a cache, reused |

`node-compile-cache` is not the suite's: `npm --version` alone creates it,
because npm's `lib/cli.js` calls `module.enableCompileCache()` before vitest
starts. It has a fixed name and is reused from one run to the next.

**All ten prefixes come from tests, not from `src/`.** The `src/` temp
directories were checked one by one:

- `cli.ts` `decksmith-harvest-`, `images/providers.ts` `decksmith-image-`,
  `mcp/tools.ts` `harvest-` and `plan/codex.ts` `decksmith-plan-` are each
  removed in a `finally`.
- `verify/drift.ts` `decksmith-drift-` is removed when the gate passes and kept
  when it fails, which is deliberate: the report's `kept` field names the
  directory. Render and PSNR failures come back as findings rather than
  exceptions.
- `decksmith-server` and `decksmith-mcp` are fixed-name work roots, not
  `mkdtemp`. The server sweeps job directories by age.

The leftover directories' contents agree. 16 of the 17 `ds-mcp-*` directories
were empty, and none of the 111 held a nested `harvest-*`, `decksmith-*`, `ds-*`,
`hf-*` or `puppeteer*` directory. No `src/` change was needed.

## The fix

`test/setup-tmpdir.ts` is now a `globalSetup` file, and `vitest.config.ts` lists
it there in place of `setupFiles`. In the parent vitest process it runs the guard,
then `mkdtemp`s `decksmith-test-*` under whatever `os.tmpdir()` now answers, and
sets `TMPDIR` to that directory. Its teardown restores `TMPDIR` and removes the
directory. A signal skips the teardown, so an `exit` listener removes it then,
as described under "Stopped by a signal" below.

That `TMPDIR` reaching the workers was checked, not assumed. Vitest 3.2.7 builds
the pool's env as `{ …, ...process.env, ...config.env }` inside `executeTests`
(`vitest/dist/chunks/coverage.DfSpMS-b.js`), and that runs after
`initializeGlobalSetup`. Tinypool forks each worker with that env. A new test in
`test/wiring.test.ts` asserts that `tmpdir()` inside a worker is a
`decksmith-test-*` directory, and that a child `node` started with no explicit
env answers the same. Run with a config that has no `globalSetup`, it fails:
`expected 'tmp.0hIf9n' to match /^decksmith-test-/`.

The other options, and why they lost:

- **An `rm` for each of the 18 `mkdtemp` sites**, in the ten of thirteen files
  that do not already remove theirs. It is the most local fix, but it is also the
  one the next new test file forgets.
- **A per-file directory in `setupFiles`, removed in `afterAll`.** Everything
  stays inside the worker, but the directory is removed as soon as that file's
  hooks finish, and anything the file left running in the background could
  still write into it. That would surface as an ENOENT unhandled rejection and
  fail the run. This is a risk read from the design, not something measured.
  Teardown in `globalSetup` runs only after every file is done.

One `src/tmpdir.ts` change came with the move, added after review. The guard's
warning was deduped by `VITEST_WORKER_ID`, because `setupFiles` ran the guard
once per worker and a dozen identical lines is not twelve times the warning.
From `globalSetup` it runs once, in the parent, which carries no worker id, so
the dedup stopped suppressing anything the suite prints — and the processes that
still carry an id are the ones a test SPAWNS, which inherit it from their
worker and whose `TMPDIR` nobody is watching. The dedup is gone, and the test
that asserted a silent worker now asserts the warning is printed with
`VITEST_WORKER_ID` set.

## After

The same conditions, on this branch: 49 files, 1,636 tests passed (the one new
test), **0 directories left by the suite**. The only entry was npm's
`node-compile-cache`.

In the same window, a snapshot of the platform temp directory gained three
entries: `playwright-artifacts-*`, `playwright_chromiumdev_profile-*`, and the
`com.google.chrome.for.testing.*` that holds that profile's `SingletonSocket`.
They belong to a Playwright browser somewhere else on the machine. This repo has
no Playwright dependency.

Two more cases, run on a one-test config that uses the same `globalSetup` and
`mkdtemp`s a directory before failing:

- **A failing run** still removed its run directory. Only npm's cache was left.
- **`TMPDIR` set to this checkout**: the guard fired and said so, the run directory
  went to `/tmp/decksmith-test-*`, and it was gone afterwards. `npx`'s own
  `node-compile-cache` still landed in the checkout, as `.gitignore` already
  records, because npm creates it before any of our code runs.

Nothing that should outlive a run is inside the run directory. It only holds
what tests `mkdtemp` under `os.tmpdir()`. No test writes output a person asked
to keep, browser caches live under `~/.cache`, and `sweep`, `drift` and the
`measure-*` scripts do not run under vitest.

## Stopped by a signal

Added after review, the same day. Two findings held.

**Nothing tested the removal itself.** With the `rmSync` deleted from the
teardown, `test/wiring.test.ts`, `pack` and `transcode` still passed (63 tests),
and the run left its `decksmith-test-*` directory holding 9 `decksmith-pack-*`
and 1 `decksmith-transcode-*`.

**A signal skipped the teardown.** Vitest 3.2.7 calls the teardown only from
`Vitest.close()`. On SIGINT or SIGTERM its handler (`addCleanupListeners`,
`cli-api.DVe0nWUx.js:5614`) calls `process.exit()` instead. A one-test vitest
whose test signals its own process left the run directory, with the test's
`probe-*` still in it, for both signals (exit 130 and 143). The reviewer counted
74 and 75 entries left by full-suite runs stopped the same way.

What changed:

- `setup` prepends a one-shot `exit` listener that removes the directory, and
  the teardown takes that listener off again. Prepending is required: vitest's
  handler is registered on `exit` as well and calls `process.exit()` from there,
  and that ends the process before any later listener runs. A throw from the
  first listener would also stop vitest's own terminal cleanup (checked on node
  24.14.0), so a failure goes to stderr with the path instead.
- Both paths remove the directory through `removeRunDir`. It retries ENOTEMPTY
  and EBUSY up to 8 times, pausing 25 ms longer each time with `Atomics.wait`.
  Node's own `maxRetries` does not pause for short delays. Against a directory
  `rmSync` could not empty (it held an immutable file), node 24.14.0 with three
  retries gave up after 1 ms at `retryDelay` 100, took 2,008 ms at 400, and took
  10,017 ms at 1,000. The delay is applied in whole seconds. This mattered in
  practice: with only the listener in place, one SIGINT to the process group
  failed with ENOTEMPTY 98 ms after the signal, because an `npm exec` child was
  creating `node-compile-cache` in the run directory at that moment. The error
  was reported on stderr.
- Four tests in `test/wiring.test.ts`. One calls setup and teardown in-process.
  Two start a real vitest that is stopped by SIGINT or SIGTERM. Those use
  `pool: "threads"`, so no forked worker outlives them. The fourth runs
  `removeRunDir` while a child keeps writing into the directory for 120 ms.
  Seven mutants of the setup file each fail at least one of them: the file as
  it was before review, no removal in the teardown, `once` instead of
  prepending, no `off`, no listener, no pause, and a single attempt.

Full-suite runs, each signalled once the run directory held about 40 entries
or more, with `TMPDIR` set to an empty directory. Processes still alive 5 s
after vitest exited were stopped by PID, and the directory was checked again
after that. In all but the first three runs, a `stat` loop also recorded the
directory's inode every 20 ms or so.

| removal | signal | runs | run directory at the end |
| --- | --- | --- | --- |
| listener, `rmSync` with `maxRetries: 3` | to the vitest pid | 7 | gone in 4, back in 3 |
| listener, `rmSync` with `maxRetries: 3` | SIGINT to the process group | 2 | gone in 1, ENOTEMPTY in 1 (left holding `node-compile-cache`) |
| listener, `removeRunDir` | SIGINT to the process group | 4 | gone in 4 |
| listener, `removeRunDir` | SIGINT and SIGTERM to the vitest pid | 2 | gone in 2 |

Each of the three that came back had been removed first and then put back by
something still running. One run shows it directly: gone at .735 s, back at
.774 s under a new inode, then holding 15 `decksmith-server-*`. Another shows
it through modes: `ds-harvest-*/deck` and its parents were 755, the mark of a
recursive `mkdir`, where `mkdtemp` makes 700. The third looked like that one
(9 `decksmith-server-*`, mode 700) but was not being watched. All three came
from a signal to the pid alone, which leaves forked workers running; the
table's last row had no such case, but two runs are not enough to say it
cannot happen.

Every signalled run also left vitest's own project directory in `TMPDIR`: a
random 21-character name holding `ssr/`, which `TestProject.close()` removes on
a normal exit. Vitest makes it before global setup runs, so it is not inside the
run directory. Five of the six SIGINTs to the process group left one vitest
worker alive 5 s later, and one SIGTERM to the pid left five `chrome-headless-shell`
processes as well.

## Not covered

- ~~A vitest process that is killed with SIGKILL or crashes skips teardown and
  leaves one run directory, instead of the roughly 111 it would have left
  before. What happens on SIGINT was not measured.~~ **Closed 2026-09-18**, see
  "Stopped by a signal": SIGINT and SIGTERM skipped the teardown as well, and now
  remove the directory through the `exit` listener. 11 of 15 signalled
  full-suite runs ended with it gone, and all 6 after `removeRunDir` was added.
- SIGKILL, or a crash that ends node without an `exit` event, still leaves the
  run directory.
- After a signal to the vitest pid alone, forked workers keep running, and what
  they write can recreate the run directory. That happened in at least 2 of 9
  such runs. Any signal also leaves vitest's own project directory (`ssr/`)
  beside the run directory.
- In watch mode the run directory lasts until vitest exits.
- From a worktree whose `TMPDIR` is the main checkout, the run directory lives
  in the main checkout for the length of the run. `/decksmith-*/` ignores it,
  and teardown removes it. The guard still does not cover that shape, and
  widening it is a `src/tmpdir.ts` change that was not made here.
- The 3,146 directories already in the platform temp directory were not removed.
  This session did not create them.
