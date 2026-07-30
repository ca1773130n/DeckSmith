/**
 * Bundle the scene code + Pixi into an IIFE the compositions load as a plain
 * <script>, and measure what Pixi actually costs in a real minified build.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { brotliCompressSync, gzipSync } from "node:zlib";
import * as esbuild from "esbuild";

const HERE = new URL(".", import.meta.url).pathname;
const out = `${HERE}vendor`;
mkdirSync(out, { recursive: true });

const common = {
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome120"],
  legalComments: "none",
  logLevel: "error",
};

// 1) what we actually ship: scenes + whatever of Pixi they pull in
await esbuild.build({
  ...common,
  entryPoints: [`${HERE}src/scenes.js`],
  globalName: "DP",
  outfile: `${out}/deckpixi.iife.js`,
});

// 2) byte profiles, for the bundle-cost answer
const profiles = {
  "pixi-full": `import * as P from "pixi.js"; window.P = P;`,
  "pixi-2d-min": `import { autoDetectRenderer, Container, Graphics } from "pixi.js";
                  window.P = { autoDetectRenderer, Container, Graphics };`,
  "pixi-text": `import { autoDetectRenderer, Container, Text, TextStyle } from "pixi.js";
                window.P = { autoDetectRenderer, Container, Text, TextStyle };`,
  "pixi-particles": `import { autoDetectRenderer, Container, Graphics, Particle, ParticleContainer } from "pixi.js";
                     window.P = { autoDetectRenderer, Container, Graphics, Particle, ParticleContainer };`,
  "pixi-filters": `import { autoDetectRenderer, Container, Graphics, BlurFilter, Filter, GlProgram } from "pixi.js";
                   window.P = { autoDetectRenderer, Container, Graphics, BlurFilter, Filter, GlProgram };`,
};

const tmp = `${HERE}.tmp`;
mkdirSync(tmp, { recursive: true });
const rows = [];
for (const [name, src] of Object.entries(profiles)) {
  writeFileSync(`${tmp}/${name}.js`, src);
  await esbuild.build({ ...common, entryPoints: [`${tmp}/${name}.js`], outfile: `${tmp}/${name}.bundle.js` });
  const buf = readFileSync(`${tmp}/${name}.bundle.js`);
  rows.push({
    profile: name,
    minBytes: buf.length,
    gzipBytes: gzipSync(buf, { level: 9 }).length,
    brotliBytes: brotliCompressSync(buf).length,
  });
}
const ours = readFileSync(`${out}/deckpixi.iife.js`);
rows.push({
  profile: "008-spike (scenes + pixi)",
  minBytes: ours.length,
  gzipBytes: gzipSync(ours, { level: 9 }).length,
  brotliBytes: brotliCompressSync(ours).length,
});
rmSync(tmp, { recursive: true, force: true });

// GSAP + a stand-in for what a DeckSmith deck ships today, for scale.
const gsap = readFileSync(`${HERE}node_modules/gsap/dist/gsap.min.js`);
rows.push({
  profile: "gsap 3.14.2 (reference, already shipped)",
  minBytes: gsap.length,
  gzipBytes: gzipSync(gsap, { level: 9 }).length,
  brotliBytes: brotliCompressSync(gsap).length,
});

const pkg = JSON.parse(readFileSync(`${HERE}node_modules/pixi.js/package.json`, "utf8"));
const licenseFile = readFileSync(`${HERE}node_modules/pixi.js/LICENSE`, "utf8");
const report = {
  pixiVersion: pkg.version,
  licenseField: pkg.license,
  licenseFileFirstLines: licenseFile.split("\n").slice(0, 3).join(" | ").trim(),
  licenseFileSha: null,
  transitiveDeps: Object.keys(pkg.dependencies ?? {}),
  rows,
};
mkdirSync(`${HERE}out`, { recursive: true });
writeFileSync(`${HERE}out/bundle-report.json`, JSON.stringify(report, null, 2));

for (const r of rows) {
  console.log(
    `${r.profile.padEnd(38)} min ${(r.minBytes / 1024).toFixed(1).padStart(7)} KB   ` +
      `gzip ${(r.gzipBytes / 1024).toFixed(1).padStart(6)} KB   br ${(r.brotliBytes / 1024).toFixed(1).padStart(6)} KB`,
  );
}
console.log(`\npixi.js ${pkg.version}  license field: ${pkg.license}`);
console.log(`LICENSE file: ${report.licenseFileFirstLines}`);

// copy vendor + assets into each project so a render needs no network
for (const p of ["seek", "text", "swarm"]) {
  const dir = `${HERE}proj/${p}`;
  mkdirSync(`${dir}/vendor`, { recursive: true });
  cpSync(`${out}/deckpixi.iife.js`, `${dir}/vendor/deckpixi.iife.js`);
  cpSync(`${HERE}node_modules/gsap/dist/gsap.min.js`, `${dir}/vendor/gsap.min.js`);
  try {
    cpSync(`${HERE}assets`, `${dir}/assets`, { recursive: true });
  } catch {}
}
console.log("\nvendor copied into proj/{seek,text,swarm}");
