/**
 * The guard that keeps scratch out of the source tree.
 *
 * Worth its own file because the failure it prevents is INVISIBLE: nothing
 * throws when the guard is missing or wrong, directories just quietly reappear
 * in the checkout, and 2,306 of them accumulated across eight prefixes before
 * anyone counted. So the assertions here are about the ways it can be wrong
 * without saying so — resolving the package root to the wrong place, going quiet
 * when it fires, and touching a `TMPDIR` that was fine.
 *
 * Every case saves and restores the environment it moves: vitest workers share
 * one process, so a leaked variable is a different file's failure.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardTmpdir, insideRoot, packageRoot } from "../src/tmpdir.js";

type Name = "TMPDIR" | "TMP" | "VITEST_WORKER_ID";
const NAMES: Name[] = ["TMPDIR", "TMP", "VITEST_WORKER_ID"];

let saved: Partial<Record<Name, string>>;
let written: string[];

/** `undefined` has to become an ABSENT variable, not the string "undefined". */
function setEnv(name: Name, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  saved = {};
  for (const name of NAMES) saved[name] = process.env[name];
  // Pinned, not inherited: the guard dedups its warning by worker id, and which
  // worker this file lands in depends on `--maxWorkers`. Worker 1 is the one
  // that speaks.
  process.env.VITEST_WORKER_ID = "1";

  // Captured rather than ignored — "said out loud" is a behaviour this file
  // asserts on, and silencing it keeps a passing run quiet.
  written = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  for (const name of NAMES) setEnv(name, saved[name]);
  vi.restoreAllMocks();
});

describe("packageRoot", () => {
  // THE ONE THAT CATCHES THE TRAP. The positional form of this computation —
  // `resolve(dirname(fileURLToPath(import.meta.url)), "..")` — is correct in
  // `src/` and in all three depth-one bundles, so it looks right everywhere it
  // can land today and fails SILENTLY the moment anything changes depth: the
  // root becomes `dist/`, nothing is ever inside it, and the guard is a no-op
  // that prints nothing. Asserting on the manifest's own name is what makes that
  // loud instead.
  it("resolves to the directory holding this package's manifest", async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot(), "package.json"), "utf8"));
    expect(manifest.name).toBe("@jokerized/decksmith");
  });

  it("is stable across calls", () => {
    expect(packageRoot()).toBe(packageRoot());
  });
});

describe("insideRoot", () => {
  it("counts the root itself and anything under it", () => {
    expect(insideRoot(packageRoot())).toBe(true);
    expect(insideRoot(join(packageRoot(), "src", "tmpdir.ts"))).toBe(true);
  });

  it("does not count a sibling whose name merely starts the same way", () => {
    // A prefix test without the separator would call this one inside, which is
    // how a guard ends up deleting a TMPDIR that was never the problem.
    expect(insideRoot(`${packageRoot()}-elsewhere`)).toBe(false);
  });
});

describe("guardTmpdir", () => {
  it("moves os.tmpdir() out of the source tree and says so", () => {
    process.env.TMPDIR = packageRoot();
    expect(insideRoot(tmpdir())).toBe(true);

    guardTmpdir();

    expect(insideRoot(tmpdir())).toBe(false);
    expect(process.env.TMPDIR).toBeUndefined();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain(packageRoot());
  });

  it("is a no-op the second time, and stays quiet", () => {
    process.env.TMPDIR = join(packageRoot(), "nested");
    guardTmpdir();
    const after = tmpdir();

    expect(() => guardTmpdir()).not.toThrow();
    expect(tmpdir()).toBe(after);
    expect(written).toHaveLength(1);
  });

  it("still fixes the environment on a worker that does not do the talking", () => {
    process.env.VITEST_WORKER_ID = "7";
    process.env.TMPDIR = packageRoot();

    guardTmpdir();

    expect(insideRoot(tmpdir())).toBe(false);
    expect(written).toHaveLength(0);
  });

  it("throws rather than stripping variables until it likes the answer", () => {
    // `os.tmpdir()` consults TMPDIR, then TMP, then TEMP on POSIX. With the
    // first two poisoned, deleting TMPDIR is not enough — and the guard refuses
    // to keep going, because at that point the environment is being deliberate.
    process.env.TMPDIR = packageRoot();
    process.env.TMP = join(packageRoot(), "also-here");

    expect(() => guardTmpdir()).toThrow(/still inside/);
  });

  it("leaves a legitimate TMPDIR completely alone", async () => {
    const real = await mkdtemp(join(tmpdir(), "decksmith-guard-"));
    try {
      process.env.TMPDIR = real;

      guardTmpdir();

      expect(process.env.TMPDIR).toBe(real);
      expect(tmpdir()).toBe(real);
      expect(written).toHaveLength(0);
    } finally {
      await rm(real, { recursive: true, force: true });
    }
  });
});
