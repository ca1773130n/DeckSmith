/**
 * The package's own version, read from the manifest rather than retyped.
 *
 * Both executables hardcoded `"0.1.0"`, and both kept saying it: 0.1.2 installed
 * from the registry answered `decksmith --version` with `0.1.0`. Nothing catches
 * that — a wrong string is a valid string, the gates never compare it to
 * anything, and the one place it is visible is a user asking which version they
 * have while chasing a bug.
 *
 * DEPTH ONE IS WHY THIS FILE EXISTS AT ALL. `../package.json` has to resolve
 * from three places: this module under `tsx`, and the two esbuild bundles, where
 * `import.meta.url` becomes the OUTPUT file's. `src/version.ts`, `dist/cli.js`
 * and `dist/mcp.js` are all exactly one level below the package root, so one
 * relative path answers for all three. Resolving it from `src/mcp/main.ts`
 * instead would need `../../` in the source and `../` in the bundle.
 *
 * npm puts `package.json` in every tarball whatever `files` says, so this
 * resolves for a consumer too.
 */
import { createRequire } from "node:module";

export const VERSION: string = createRequire(import.meta.url)("../package.json").version;
