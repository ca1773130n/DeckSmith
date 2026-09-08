/**
 * The one place that RUNS the guard for the test suite.
 *
 * `src/tmpdir.ts` is side-effect-free on purpose — the library barrel re-exports
 * it, and an import must not rewrite a consumer's environment — so naming it
 * directly in `setupFiles` would load the module and guard nothing. Hence three
 * lines of glue rather than a clever config entry.
 *
 * TypeScript rather than `.mjs` because vitest transforms it natively, which
 * keeps `npm test` free of any build precondition, and `scripts/build.mjs`
 * already drops the tests' declarations so it costs nothing at publish.
 */
import { guardTmpdir } from "../src/tmpdir.js";

guardTmpdir();
