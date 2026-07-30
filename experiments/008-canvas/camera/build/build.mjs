import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

await build({
  bundle: true,
  minify: false,
  logLevel: "info",
  entryPoints: [join(here, "entry.ts")],
  outfile: join(here, "emit.mjs"),
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
});
