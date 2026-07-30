/**
 * Bundle the proof with the repo's own esbuild and run it. Writes only into
 * this experiment's directory; never touches dist/ or node_modules.
 */
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..");
const bundle = join(here, ".render.mjs");

execFileSync(
  join(root, "node_modules", ".bin", "esbuild"),
  [join(here, "render.ts"), "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`],
  { stdio: "inherit" },
);
execFileSync(process.execPath, [bundle], { stdio: "inherit" });
