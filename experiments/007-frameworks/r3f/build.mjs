/**
 * Bundle the R3F scene and emit a HyperFrames composition around it, in the
 * exact shape src/emit/composition.ts produces: one #root with
 * data-composition-id/start/duration/width/height, one scene div per beat with
 * its own data-composition-id, a paused root timeline registered at
 * window.__timelines["main"], and a __renderReady gate.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
const SID = "s1";
const DURATION = 12;

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "assets"), { recursive: true });

const result = await build({
  entryPoints: [path.join(here, "src/main.tsx")],
  bundle: true,
  format: "iife",
  target: "chrome120",
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: path.join(out, "scene.js"),
});

await writeFile(path.join(out, "meta.json"), JSON.stringify(result.metafile));
await cp(path.join(here, "assets"), path.join(out, "assets"), { recursive: true });

const bundle = await readFile(path.join(out, "scene.js"));
const bytes = bundle.byteLength;
const gz = (await import("node:zlib")).gzipSync(bundle).byteLength;

const html = `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <title>ViT-B/16 encoder stack</title>
    <meta name="viewport" content="width=1920, height=1080" />
    <style>
      html, body { margin: 0; padding: 0; background: #0a0c11; }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
      .scene { position: absolute; inset: 0; }
      .gl { position: absolute; inset: 0; }
      .gl canvas { display: block; width: 1920px !important; height: 1080px !important; }
      .hud {
        position: absolute; left: 96px; top: 84px;
        font: 700 64px/1.1 "Helvetica Neue", Arial, sans-serif;
        color: #f2f4f8; letter-spacing: -0.01em;
      }
      .hud small { display: block; margin-top: 18px; font: 400 42px/1.3 Arial, sans-serif; color: #aab3c4; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${DURATION}"
      data-width="1920"
      data-height="1080"
    >
      <div
        id="${SID}"
        class="scene clip"
        data-composition-id="${SID}"
        data-start="0"
        data-duration="${DURATION}"
        data-label="ViT-B/16 encoder stack"
      >
        <div class="gl" id="${SID}-gl"></div>
        <div class="hud" id="${SID}-hud">
          ViT-B/16
          <small>an image is 196 patch tokens, and every block sees all of them</small>
        </div>
        <script src="./scene.js" data-sid="${SID}"></script>
      </div>
      <script>
        (function () {
          window.__timelines = window.__timelines || {};
          var tl = gsap.timeline({ paused: true });
          tl.to({}, { duration: ${DURATION} });
          window.__timelines["main"] = tl;
        })();
      </script>
    </div>
  </body>
</html>
`;

// GSAP is still in the head: the root timeline is GSAP's, exactly as the real
// shell emits it. Only the scene timeline is Theatre's.
const withGsap = html.replace(
  "  </head>",
  '    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>\n  </head>',
);

await writeFile(path.join(out, "index.html"), withGsap);

const sha = createHash("sha256").update(bundle).digest("hex").slice(0, 16);
const assetBytes = (await Promise.all(
  ["label.ttf", "body.ttf"].map(async (f) => (await stat(path.join(out, "assets", f))).size),
)).reduce((a, b) => a + b, 0);

console.log(
  JSON.stringify(
    { bundleBytes: bytes, bundleGzip: gz, fontBytes: assetBytes, bundleSha: sha },
    null,
    2,
  ),
);
