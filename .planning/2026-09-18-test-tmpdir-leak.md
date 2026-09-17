# The test suite's temp-directory leak

**Date** 2026-09-18. Branch `fix/test-tmpdir-leak`, from `origin/main` at `3e5f90a`.

## What was reported

Four `npm run check` runs on 2026-09-17, in sessions whose `TMPDIR` was the repo
root, left 562 directories: `decksmith-server-*` 256, `ds-mcp-*` 68,
`ds-harvest-*` 64, `ds-images-*` 40, `decksmith-pack-*` 36, `decksmith-narrate-*`
36, `ds-playback-*` 24, `decksmith-assets-*` 24, `ds-prov-*` 8,
`decksmith-transcode-*` 4. `vitest.config.ts` already named
`test/setup-tmpdir.ts` in `setupFiles`.

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
directory.

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

## Not covered

- A vitest process that is killed with SIGKILL or crashes skips teardown and
  leaves one run directory, instead of the roughly 111 it would have left
  before. What happens on SIGINT was not measured.
- In watch mode the run directory lasts until vitest exits.
- From a worktree whose `TMPDIR` is the main checkout, the run directory lives
  in the main checkout for the length of the run. `/decksmith-*/` ignores it,
  and teardown removes it. The guard still does not cover that shape, and
  widening it is a `src/tmpdir.ts` change that was not made here.
- The 3,146 directories already in the platform temp directory were not removed.
  This session did not create them.
