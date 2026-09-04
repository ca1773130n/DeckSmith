// Four artifacts, four shapes: a Node CLI, an MCP server, a library entry, and a
// browser bundle that gets inlined into every generated deck. Plus a
// declarations pass, because esbuild does not emit .d.ts and
// `import { emitDeck } from "@jokerized/decksmith"` is useless to a TypeScript
// consumer without one. esbuild directly rather than a build framework — there
// is no fifth case coming.
import { execFileSync } from "node:child_process";
import { access, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

// EMPTY IT FIRST. `files` is `["dist", "README.md"]`, so the tarball is whatever
// the directory happens to hold — and nothing here ever removed anything. A tree
// where `npm run serve` had run carried `dist/server/` into the package: 0.1.0
// went to npm with 78 entries against 0.1.3's 71, eight of them server files
// nobody asked for. CI publishes from a fresh checkout so it never saw this; a
// hand-publish does, and the first publish of any new package has to be one,
// because npm requires the package to exist before OIDC can attach to it.
// `prepare` runs this before `npm pack`/`npm publish`, so wiping here is what
// makes the tarball equal the build — and a local build equal a CI one.
await rm("dist", { recursive: true, force: true });

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

// THE MCP SERVER, which `package.json` has always declared as the
// `decksmith-mcp` binary and this script never built. A separate `build:mcp`
// script did, and nothing ran it: `prepare` runs `build`, so every publish
// shipped a manifest promising an executable that was not in the tarball. npm
// said so on its way past — "No bin file found at dist/mcp.js" — in the middle
// of a successful publish, twice, and 0.1.0 and 0.1.1 are both out there like
// that. Built here so the thing that produces the package produces all of it,
// and `build:mcp` is gone rather than left to drift from this line.
await build({ ...node, entryPoints: ["src/mcp/main.ts"], outfile: "dist/mcp.js" });

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

// The equation morph's runtime, vendored into a deck by the CLI. Same shape as
// the step layer: an IIFE the composition loads by `<script src>`, so its
// globals exist before any scene script runs.
await build({
  ...shared,
  entryPoints: ["src/emit/morph-runtime.ts"],
  outfile: "dist/ds-morph.js",
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

// EVERYTHING THE MANIFEST PROMISES EXISTS.
//
// This is the check that was missing. `bin` named `dist/mcp.js` for as long as
// the MCP server has existed and nothing built it, so two releases went to npm
// declaring an executable that was not in the tarball — `npx decksmith-mcp`
// against either of them is a broken symlink. npm noticed both times and said
// so in a warning, in the middle of an otherwise successful publish, which is
// exactly the shape of a thing nobody reads.
//
// Here rather than in a test, because `prepare` runs this on the consumer's
// machine during a git install, where no test suite runs at all.
const { bin, main, types } = require("../package.json");
const promised = { ...bin, main, types, "ds-morph": "dist/ds-morph.js" };
const missing = [];
for (const [name, file] of Object.entries(promised)) {
  if (!file) continue;
  await access(new URL(`../${file}`, import.meta.url)).catch(() =>
    missing.push(`${name} -> ${file}`),
  );
}
if (missing.length > 0) {
  throw new Error(
    `the build finished without producing what package.json promises:\n  ${missing.join("\n  ")}`,
  );
}
