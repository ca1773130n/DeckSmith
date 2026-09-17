import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs once in the parent process, before any worker exists: it guards
    // TMPDIR, points it at a fresh directory for this run, and removes that
    // directory when the run closes. Setting the variable here does reach the
    // workers — vitest hands `process.env` to the pool after global setup —
    // and test/wiring.test.ts holds that. See test/setup-tmpdir.ts for why a
    // guard alone left the suite's scratch behind, and src/tmpdir.ts for the
    // guard.
    globalSetup: ["./test/setup-tmpdir.ts"],
  },
});
