/**
 * Refuse a `TMPDIR` that points inside the package root.
 *
 * `os.tmpdir()` reads `$TMPDIR` at call time, and twenty places here ask it for
 * scratch — six in `src/` (the server's work root, the MCP cache, the CLI's
 * harvest directory, `codex.ts`, `providers.ts`, `drift.ts`) and fourteen across
 * twelve test files that `mkdtemp` a directory per case. That code is right. The
 * environment is not: agent sessions in this repo run with
 *
 *     TMPDIR=/Users/neo/Developer/Projects/DeckSmith
 *
 * which is not in any shell profile — a clean login shell has it empty — so it
 * is injected per session. Every `mkdtemp` then lands in the project root. One
 * `npm test` leaves about 140 directories behind, and 2,306 of them over eight
 * prefixes had accumulated by the time they were swept on 2026-09-09. (A count a
 * day earlier, over a wider set of prefixes, read 2,333; both are dated in
 * `.gitignore` so the pair does not read as a contradiction.) `.gitignore` had
 * grown fourteen entries papering over it, which is how it stayed invisible.
 *
 * This lives in `src/` rather than `scripts/` because `scripts/` is outside
 * `files: ["dist", "README.md"]` and, more decisively, because `build:server`
 * transpiles `src/server/*.ts` WITHOUT bundling: a `../../scripts/tmpdir.mjs`
 * import would survive into `dist/server/main.js` and resolve to nothing.
 *
 * NO TOP-LEVEL SIDE EFFECT, deliberately. `src/index.ts` re-exports `guardTmpdir`
 * so `src/server/main.ts` can reach it — the barrel is that file's only route to
 * any of our code — and a module that deleted an environment variable on import
 * would delete it for anyone who typed `import { emitDeck } from
 * "@jokerized/decksmith"`. That is not hypothetical: an absent `TMPDIR` is
 * inherited by every child we spawn without an explicit env (puppeteer in
 * `capture.ts`, `captions.ts` and `harvest.ts`; ffmpeg; edge-tts), so this is a
 * decision an executable makes about its own process, not something an import
 * does to its host. The three entry points call it. Nothing else does.
 *
 * Deleting the variable rather than setting one: `os.tmpdir()` already knows the
 * platform default when it is unset, and inventing a path here would be a second
 * opinion about a question the platform answers.
 *
 * SAID OUT LOUD, once, because a guard that silently corrects its environment is
 * how the environment stays broken.
 */
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

let cached: string | undefined;

/**
 * `dir` with its symlinks resolved, absolute.
 *
 * BOTH SIDES OF THE COMPARISON HAVE TO GO THROUGH THIS. Module resolution hands
 * back a real path — `require.resolve` calls `realpath` unless someone passes
 * `--preserve-symlinks` — while `$TMPDIR` is whatever the environment wrote. So
 * a checkout reached through a symlink compared unequal to its own root:
 *
 *     ln -s <repo> link/repo && cd link/repo && TMPDIR=$PWD node dist/cli.js --version
 *
 * printed no warning and kept writing into the tree, while the identical command
 * through the real path fixed itself. That is the same invisible failure the
 * `require.resolve` detour below exists to prevent, one line further on.
 *
 * A PATH THAT DOES NOT EXIST STILL HAS TO ANSWER, which is why this walks up
 * instead of giving up. `realpathSync` refuses a path that is not on disk, and
 * `os.tmpdir()` never asked for one to be — it reads the variable and hands it
 * back — so `TMPDIR=<repo>/notyet` is an ordinary shape, not an edge case. The
 * first cut returned the merely-resolved path there, and the two holes met: a
 * TMPDIR that reached the repo through a symlink AND did not exist yet resolved
 * to nothing the root matched, and the guard was a silent no-op.
 *
 *     ln -s <repo> link/repo && TMPDIR=link/repo/notyet node dist/cli.js --version
 *
 * printed the version and nothing else, while the same path spelled out in full
 * warned. Resolving the nearest EXISTING ancestor and putting the unresolved
 * tail back closes it, and the walk terminates because the repo root exists.
 *
 * That fallback also carried a claim that does not survive being checked —
 * "nothing can `mkdtemp` into a directory that is not there, so it fails loudly".
 * True of `mkdtemp`, and `src/server/main.ts` does not use it: at module load it
 * runs `mkdirSync(options.work, { recursive: true })`, which CREATES the missing
 * parents. Measured 2026-09-08 with the hole open — `<repo>/notyet/decksmith-server`
 * appeared in the checkout, and because it was empty `git status` had nothing to
 * report about it. Silent, which is the failure mode this whole file exists for.
 */
function real(dir: string): string {
  let at = resolve(dir);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(at), ...tail);
    } catch {
      const up = dirname(at);
      // `dirname("/")` is `"/"`, so this is the walk running out of filesystem:
      // even the root would not answer, and there is nothing better to say than
      // what we were given.
      if (up === at) return resolve(dir);
      tail.unshift(basename(at));
      at = up;
    }
  }
}

/**
 * The directory holding our own `package.json`, found by RESOLVING it rather
 * than by counting `..` segments off `import.meta.url`.
 *
 * The positional form gives the same answer everywhere this module can land
 * today — `src/` under vitest, and the depth-one bundles `dist/cli.js`,
 * `dist/mcp.js` and `dist/index.js`, which is the convention `src/version.ts`
 * relies on and explains at length. The problem is how it FAILS: at any other
 * depth the root silently becomes `dist/`, nothing is ever inside it, and the
 * guard turns into a no-op that prints nothing and throws nothing. Nobody would
 * notice until the directories came back. `require.resolve` throws
 * MODULE_NOT_FOUND there instead, which is the whole reason for the detour.
 *
 * One consequence, stated rather than left to be discovered: in a published
 * install this resolves to `node_modules/@jokerized/decksmith`, and nobody's
 * TMPDIR is inside that, so the guard is a deliberate no-op for consumers. It
 * protects this checkout — the mess is ours. Do NOT "fix" the asymmetry by
 * testing `process.cwd()`: a user who legitimately works inside their temp
 * directory would have their `TMPDIR` deleted for it.
 *
 * Exported for the test that asserts the depth is still right.
 */
export function packageRoot(): string {
  cached ??= real(dirname(createRequire(import.meta.url).resolve("../package.json")));
  return cached;
}

/** True when `dir` is the package root or sits inside it, symlinks resolved. */
export function insideRoot(dir: string): boolean {
  const root = packageRoot();
  const at = real(dir);
  return at === root || at.startsWith(root + sep);
}

/**
 * Unset a `TMPDIR` that resolves inside the package root, and say so.
 *
 * Idempotent by construction rather than by a flag: once the variable is gone
 * `os.tmpdir()` answers from the platform default, so a second call finds
 * nothing to do and stays silent.
 */
export function guardTmpdir(): void {
  const before = tmpdir();
  if (!insideRoot(before)) return;

  delete process.env.TMPDIR;
  const after = tmpdir();
  if (insideRoot(after)) {
    // TMP and TEMP are the next two `os.tmpdir()` consults on POSIX. Throwing
    // rather than deleting those as well: at that point the environment is
    // saying something deliberate, and a guard that keeps stripping variables
    // until it likes the answer is no longer a guard.
    throw new Error(
      `tmpdir: ${after} is still inside ${packageRoot()}. Set TMPDIR to a real temp directory.`,
    );
  }

  // Vitest runs this once per worker, and a dozen identical lines is not twelve
  // times the warning. `VITEST_WORKER_ID` is absent outside vitest, so a binary
  // that calls this still says it.
  const worker = process.env.VITEST_WORKER_ID;
  if (worker === undefined || worker === "1") {
    process.stderr.write(
      `tmpdir: TMPDIR pointed at ${before}, inside the source tree, so every mkdtemp ` +
        `would land in the repo. Using ${after}. Fix the environment — this only stops the mess.\n`,
    );
  }
}
