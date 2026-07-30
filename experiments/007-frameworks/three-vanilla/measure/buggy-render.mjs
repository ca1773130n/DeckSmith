/**
 * Would the growing-Line2 bug have survived every gate?
 *
 * Rebuilds the deck with the naive `setPositions(subarray)` version, renders it,
 * and looks for the discontinuity. `hyperframes render` splits the timeline
 * across N worker Chromes; each worker cold-loads the page and paints its slice
 * start first, so a geometry whose size is frozen on first paint gets frozen at
 * a DIFFERENT size in each worker. The seam lands mid-video, at a worker
 * boundary, and no lint/contrast/motion gate looks at it.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(here, "src/three-scenes.mjs"), "utf8");

const FIXED_ALLOC = /  const flat = new Float32Array\(path\.length \* 3\);[\s\S]*?  scene\.add\(trail\);/;
const FIXED_RENDER = /    \/\/ Only the heights move[\s\S]*?    trail\.geometry\.instanceCount = n;/;

let buggy = src.replace(
  FIXED_ALLOC,
  `  const flat = new Float32Array(path.length * 3);
  scene.add(trail);`,
);
buggy = buggy.replace(
  FIXED_RENDER,
  `    for (let i = 0; i <= n; i++) {
      flat[i * 3] = path[i].x;
      flat[i * 3 + 1] = path[i].y * g + 0.08;
      flat[i * 3 + 2] = path[i].z;
    }
    trail.geometry.setPositions(flat.subarray(0, (n + 1) * 3));`,
);
if (buggy === src) throw new Error("patch did not apply — the source moved");
writeFileSync(join(here, "src/three-scenes.buggy.mjs"), buggy);

mkdirSync(join(here, "out-buggy"), { recursive: true });
await esbuild.build({
  entryPoints: [join(here, "src/three-scenes.buggy.mjs")],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "DS3D",
  target: "chrome120",
  outfile: join(here, "out-buggy/three-scene.js"),
});
cpSync(join(here, "out/index.html"), join(here, "out-buggy/index.html"));

const hf = "/Users/neo/Developer/Projects/DeckSmith/node_modules/.bin/hyperframes";
const say = (s) => process.stdout.write(`${s}\n`);

say("--- gates on the buggy build ---");
try {
  say(execFileSync("node", [hf, "check", join(here, "out-buggy")], { encoding: "utf8" }).split("\n").filter((l) => /error\(s\)|Check|◇ \d/.test(l)).join("\n"));
} catch (e) {
  say(`check exited nonzero:\n${String(e.stdout).split("\n").filter((l) => /error\(s\)|Check/.test(l)).join("\n")}`);
}

say("--- render x2 ---");
for (const name of ["buggy-1", "buggy-2"]) {
  execFileSync("node", [hf, "render", join(here, "out-buggy"), "-o", join(here, `renders/${name}.mp4`), "-f", "30"], { encoding: "utf8" });
}
say(execFileSync("shasum", ["-a", "256", join(here, "renders/buggy-1.mp4"), join(here, "renders/buggy-2.mp4")], { encoding: "utf8" }));
