/** Bundles the 3D runtime and writes a DeckSmith-shaped HyperFrames composition. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { BEATS, emitScene3d, esc } from "./emit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });

const GSAP_SRC = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
const FORMAT = { width: 1920, height: 1080 };

// IIFE with a global, because composition.ts emits classic <script> tags and a
// bare `import` would need type="module" — which changes execution order.
const bundle = await esbuild.build({
  entryPoints: [join(here, "src/three-scenes.mjs")],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "DS3D",
  target: "chrome120",
  legalComments: "none",
  outfile: join(out, "three-scene.js"),
  metafile: true,
  write: true,
});
writeFileSync(join(out, "meta.json"), JSON.stringify(bundle.metafile));

const t = (n) => String(Math.round(n * 1000) / 1000);
const statement = (s) => {
  const line = s.trim().startsWith(".") ? `tl${s.trim()}` : s.trim();
  return line.endsWith(";") ? line : `${line};`;
};

const cssSet = new Set();
const scenes = [];
let start = 0;
BEATS.forEach((beat, i) => {
  const sid = `s${i + 1}`;
  const scene = emitScene3d(beat, { sid, format: FORMAT });
  if (scene.css) cssSet.add(scene.css.trim());
  scenes.push(`      <div
        id="${sid}"
        class="scene clip"
        data-composition-id="${sid}"
        data-start="${t(start)}"
        data-duration="${t(beat.seconds)}"
        data-label="${esc(beat.headline)}"
      >
${scene.html}
        <script>
          (function () {
            ${(scene.setup ?? []).map(statement).join("\n            ")}
            window.__timelines = window.__timelines || {};
            var tl = gsap.timeline({ paused: true });
            ${scene.tl.map(statement).join("\n            ")}
            window.__timelines["${sid}"] = tl;
          })();
        </script>
      </div>`);
  start += beat.seconds;
});

const html = `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <title>three-vanilla 3D spike</title>
    <meta name="viewport" content="width=${FORMAT.width}, height=${FORMAT.height}" />
    <script src="${GSAP_SRC}"></script>
    <script src="./three-scene.js"></script>
    <style>
      html, body { margin: 0; padding: 0; background: #0a0e16; }
      #root { position: relative; width: ${FORMAT.width}px; height: ${FORMAT.height}px; overflow: hidden;
        background: radial-gradient(120% 100% at 70% 20%, #16203a 0%, #0a0e16 60%);
        font-family: "Inter", "Helvetica Neue", Arial, sans-serif; color: #f2f5f9; }
      .scene { position: absolute; inset: 0; }
      .clip { overflow: hidden; }
${[...cssSet].map((c) => c.replace(/^/gm, "      ")).join("\n")}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${t(start)}"
      data-width="${FORMAT.width}"
      data-height="${FORMAT.height}"
    >
${scenes.join("\n")}
      <script>
        (function () {
          window.__timelines = window.__timelines || {};
          var tl = gsap.timeline({ paused: true });
          tl.to({}, { duration: ${t(start)} });
          window.__timelines["main"] = tl;
        })();
      </script>
    </div>
  </body>
</html>
`;
writeFileSync(join(out, "index.html"), html);
console.log("wrote out/index.html and out/three-scene.js");
