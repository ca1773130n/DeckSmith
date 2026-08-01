/**
 * Refuse a `TMPDIR` that points inside the source tree.
 *
 * `os.tmpdir()` reads `$TMPDIR` at call time, and thirteen places here ask it
 * for scratch — the server's work root, the MCP cache, `codex.ts`, `drift.ts`,
 * and seven test files that `mkdtemp` a directory per case. That code is right.
 * The environment is not: agent sessions in this repo run with
 *
 *     TMPDIR=/Users/neo/Developer/Projects/DeckSmith
 *
 * which is not in any shell profile — a clean login shell has it empty — so it
 * is injected per session. Every `mkdtemp` then lands in the project root. One
 * `npm test` leaves about 140 directories behind; 1,596 of them had accumulated
 * by the time anyone looked, and `.gitignore` had grown six entries papering
 * over it, which is how it stayed invisible.
 *
 * Deleting the variable rather than setting one: `os.tmpdir()` already knows the
 * platform default when it is unset, and inventing a path here would be a second
 * opinion about a question the platform answers.
 *
 * SAID OUT LOUD, once, because a guard that silently corrects its environment is
 * how the environment stays broken.
 */
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** True when `dir` is the repo or sits inside it. */
function insideRepo(dir) {
  const at = resolve(dir);
  return at === REPO || at.startsWith(REPO + sep);
}

const before = tmpdir();
if (insideRepo(before)) {
  delete process.env.TMPDIR;
  const after = tmpdir();
  if (insideRepo(after)) {
    throw new Error(
      `tmpdir: ${after} is still inside ${REPO}. Set TMPDIR to a real temp directory.`,
    );
  }
  // Vitest runs this once per worker, and a dozen identical lines is not twelve
  // times the warning. `VITEST_WORKER_ID` is absent outside vitest, so a script
  // that imports this still says it.
  const worker = process.env.VITEST_WORKER_ID;
  if (worker === undefined || worker === "1") {
    process.stderr.write(
      `tmpdir: TMPDIR pointed at ${before}, inside the source tree, so every mkdtemp ` +
        `would land in the repo. Using ${after}. Fix the environment — this only stops the mess.\n`,
    );
  }
}

export { insideRepo };
