// Three artifacts, three shapes: a Node CLI, a library entry, and a browser
// bundle that gets inlined into every generated deck. Plus a declarations pass,
// because esbuild does not emit .d.ts and `import { emitDeck } from "decksmith"`
// is useless to a TypeScript consumer without one. esbuild directly rather than
// a build framework — there is no fourth case coming.
import { execFileSync } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const shared = { bundle: true, minify: false, logLevel: "info" };

// Keep runtime deps external: they're installed, and bundling them into a CLI
// buys nothing but a slower build.
const node = { ...shared, platform: "node", target: "node22", format: "esm", packages: "external" };

await build({
  ...node,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node" },
});

// Sibling of dist/cli.js on purpose: both read dist/deck-runtime.js relative to
// their own import.meta.url, so the step layer stays one file in the package no
// matter which entry point pulled it in.
await build({ ...node, entryPoints: ["src/index.ts"], outfile: "dist/index.js" });

await build({
  ...shared,
  entryPoints: ["src/deck/runtime.ts"],
  outfile: "dist/deck-runtime.js",
  platform: "browser",
  target: "es2022",
  format: "iife",
  minify: true,
});

// Declarations. tsconfig.json is noEmit and includes test/ — it exists to gate,
// not to build — so override it on the command line rather than fork a second
// config that would drift from it. Because test/ is in the input set, tsc puts
// rootDir at the project root and our types one level deeper than we want to
// publish: lift them, and drop the tests' declarations, which no consumer can
// reach and every consumer would download.
//
// Spawned through require.resolve rather than the name `tsc`: a `prepare` on a
// git install runs from a directory whose node_modules/.bin may not be on PATH,
// and a missing types pass is the kind of failure that only shows up in the
// consumer's editor.
const require = createRequire(import.meta.url);
execFileSync(
  process.execPath,
  [
    require.resolve("typescript/bin/tsc"),
    "-p",
    "tsconfig.json",
    "--declaration",
    "--emitDeclarationOnly",
    "--noEmit",
    "false",
    "--outDir",
    "dist/.types",
  ],
  { stdio: "inherit" },
);
await rm("dist/types", { recursive: true, force: true });
await rename("dist/.types/src", "dist/types");
await rm("dist/.types", { recursive: true, force: true });
console.log("  dist/types/index.d.ts");
