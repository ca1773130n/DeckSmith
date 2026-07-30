/** The control build: same scene, no React, no drei, no Theatre. */
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out-vanilla");
const DURATION = 12;

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "assets"), { recursive: true });

const r = await build({
  entryPoints: [path.join(here, "src/vanilla.ts")],
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: true,
  legalComments: "none",
  metafile: true,
  outfile: path.join(out, "scene.js"),
});
await writeFile(path.join(out, "meta.json"), JSON.stringify(r.metafile));
await cp(path.join(here, "assets"), path.join(out, "assets"), { recursive: true });

const src = await readFile(path.join(here, "out/index.html"), "utf8");
await writeFile(path.join(out, "index.html"), src);

const b = await readFile(path.join(out, "scene.js"));
console.log(JSON.stringify({ bundleBytes: b.byteLength, bundleGzip: gzipSync(b).byteLength }, null, 2));
