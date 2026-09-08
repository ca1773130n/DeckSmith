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
 * `npm test` leaves about 140 directories behind; 2,306 of them across eight
 * prefixes had accumulated by the time anyone counted them, and `.gitignore` had
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
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";

let cached: string | undefined;

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
  cached ??= dirname(createRequire(import.meta.url).resolve("../package.json"));
  return cached;
}

/** True when `dir` is the package root or sits inside it. */
export function insideRoot(dir: string): boolean {
  const root = packageRoot();
  const at = resolve(dir);
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
