import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Runs inside each worker before the test file is imported, which is what it
    // has to be: `os.tmpdir()` is read at call time, so repointing it in the
    // parent process would not reach a forked test. See scripts/tmpdir.mjs for
    // what it is guarding against and why the fix is not in the call sites.
    setupFiles: ["./scripts/tmpdir.mjs"],
  },
});
