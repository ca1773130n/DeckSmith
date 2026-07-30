import { gzipSync } from "node:zlib";
import { readFileSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

mkdirSync("out", { recursive: true });
const common = {
  bundle: true, minify: true, format: "iife", target: "chrome120", legalComments: "none",
  jsx: "automatic", write: true,
  define: { "process.env.NODE_ENV": '"production"', "process.env.THEATRE_STUDIO": "false" },
  loader: { ".js": "jsx" },
};
const builds = [
  ["r3f-drei", "cloud-r3f.jsx"],
  ["r3f-drei-theatre", "cloud-theatre.jsx"],
];
for (const [name, entry] of builds) {
  try {
    await esbuild.build({ ...common, entryPoints: [entry], outfile: `out/${name}.js` });
    const b = readFileSync(`out/${name}.js`);
    console.log(name.padEnd(20), "min", String(b.length).padStart(8), "gzip", String(gzipSync(b).length).padStart(7));
  } catch (e) {
    console.log(name, "FAILED", e.message.split("\n").slice(0, 4).join(" | "));
  }
}
