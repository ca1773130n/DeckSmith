/**
 * SEAM B, prototyped end to end: one layout-aware primitive, four variants that
 * differ ONLY in when the browser measurement happens.
 *
 * The primitive is an ARROW that routes between two boxes it did not lay out.
 * Emit time cannot know where the boxes are: their widths come from text in a
 * webfont, they are placed by flex, and the headline above them takes however
 * much room it takes. This is the smallest thing that is honestly impossible at
 * emit time, which is why it is the right thing to prototype.
 *
 * VARIANTS
 *   emit   geometry guessed at emit time from a character count. The status quo.
 *   parse  measured in the browser, synchronously, in the scene's IIFE — i.e.
 *          exactly where `Scene.setup` runs today. Before `document.fonts.ready`.
 *   lazy   measured on the tween's first render and memoised, which is what
 *          `cameraPreamble`/`dsFrame` in src/emit/camera.ts does today.
 *   defer  SEAM B: the scene registers a BUILDER instead of a timeline. The
 *          ready gate awaits fonts+images, runs every builder, and only then
 *          lowers `__hfTimelinesBuilding` and fires `hf-timelines-built`.
 *   defer-slow  as `defer`, with 1500ms of artificial work inside the builder,
 *          to find out whether capture waits or races.
 *
 * Every variant emits the same DOM, the same CSS and the same intent, so a
 * difference between two of them is a difference in the measurement rule and
 * nothing else.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const W = 1920;
const H = 1080;
/** Two scenes, so per-scene cost is a slope and not a single point. */
const SCENES = [
  {
    sid: "s1",
    seconds: 6,
    headline: "Compact thought, dense output",
    a: "encoder",
    b: "decoder",
    aLabel: "Windowed attention",
    bLabel: "Dequantised CTM",
  },
  {
    sid: "s2",
    seconds: 6,
    headline: "The residual path",
    a: "sampler",
    b: "refiner",
    aLabel: "Latent sampler",
    bLabel: "Iterative refiner",
  },
];

/** Invariant 10: times are rounded to 3 decimals so float drift never moves a byte. */
const t = (n) => String(Math.round(n * 1000) / 1000);

/**
 * The scene's markup. Box widths are content-sized, the row is `space-between`,
 * and the labels are set in a webfont whose metrics are nothing like the
 * fallback's — so the arrow's endpoints are unknown until the font has loaded
 * and the browser has laid the row out.
 *
 * `#sid-b` is translated by the scene's own reveal tween. That is not
 * decoration: it is what makes a memo taken at "the first time anything asked"
 * depend on WHEN it was asked, and it is the shape every real archetype has
 * (`chromeIn` translates everything it reveals).
 */
function sceneHtml(s) {
  return `        <div class="hd">
          <div class="eyebrow">Seam B</div>
          <div class="headline">${s.headline}</div>
        </div>
        <div class="row" id="${s.sid}-row">
          <div class="node" id="${s.sid}-${s.a}"><span class="probe">${s.aLabel}</span></div>
          <div class="node" id="${s.sid}-${s.b}"><span class="probe">${s.bLabel}</span></div>
        </div>
        <svg class="wires" id="${s.sid}-wires" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
          <path id="${s.sid}-arrow" class="wire" d="" />
          <path id="${s.sid}-head" class="head" d="" />
        </svg>`;
}

const CSS = `      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0b0d10; }
      body { font-family: system-ui, sans-serif; color: #e8eaed; }
      /* A face with metrics unlike the fallback's, already beside every deck we
         ship. \`block\` rather than \`swap\` so the swap is a reflow and not a
         repaint — the hazard \`parse\` is meant to expose. */
      @font-face { font-family: "DSProbe"; src: url("./katex/fonts/KaTeX_Main-Regular.woff2") format("woff2"); font-display: block; }
      .scene { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
               padding: 84px 110px; display: flex; flex-direction: column; justify-content: center; }
      .eyebrow { font-size: 42px; letter-spacing: .14em; text-transform: uppercase; color: #9aa7b5; }
      .headline { font-size: 76px; font-weight: 700; margin-bottom: 96px; }
      .row { display: flex; justify-content: space-between; align-items: center; }
      .node { border: 3px solid #3d4c5c; border-radius: 18px; padding: 38px 46px; background: #141a21; }
      .probe { font-family: "DSProbe", Georgia, serif; font-size: 56px; color: #e8eaed; white-space: nowrap; }
      .wires { position: absolute; inset: 0; pointer-events: none; }
      .wire { fill: none; stroke: #6ea8fe; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
      .head { fill: #6ea8fe; }`;

/**
 * The measurement and the routing, as ONE browser-side function shared by every
 * variant that measures. Identical text in all of them, so nothing but its
 * calling moment varies.
 *
 * It reads the two boxes' rects relative to the SVG's own box and divides out
 * nothing — the SVG is the canvas, 1:1 — then routes an elbow from the right
 * edge of A to the left edge of B and puts a head on the tip. Rounded to 3
 * decimals for the same reason times are.
 */
function measureFn(s) {
  return `function dsMeasure() {
              var host = document.getElementById('${s.sid}-wires').getBoundingClientRect();
              var ra = document.getElementById('${s.sid}-${s.a}').getBoundingClientRect();
              var rb = document.getElementById('${s.sid}-${s.b}').getBoundingClientRect();
              var r3 = function (n) { return Math.round(n * 1000) / 1000; };
              var x1 = r3(ra.right - host.left + 14), y1 = r3(ra.top + ra.height / 2 - host.top);
              var x2 = r3(rb.left - host.left - 26), y2 = r3(rb.top + rb.height / 2 - host.top);
              var mx = r3((x1 + x2) / 2);
              var d = 'M' + x1 + ' ' + y1 + ' L' + mx + ' ' + y1 + ' L' + mx + ' ' + y2 + ' L' + x2 + ' ' + y2;
              var head = 'M' + r3(x2 + 26) + ' ' + y2 + ' L' + x2 + ' ' + r3(y2 - 15) + ' L' + x2 + ' ' + r3(y2 + 15) + ' Z';
              return { d: d, head: head, len: Math.abs(mx - x1) + Math.abs(y2 - y1) + Math.abs(x2 - mx) };
            }`;
}

/** What every variant animates, given a routed path. One place, so the only
 *  difference between variants is where `geom` came from. */
function timelineFn(s) {
  return `function dsBuild(tl, geom) {
              var arrow = document.getElementById('${s.sid}-arrow');
              var head = document.getElementById('${s.sid}-head');
              arrow.setAttribute('d', geom.d);
              head.setAttribute('d', geom.head);
              arrow.style.strokeDasharray = geom.len;
              tl.fromTo('#${s.sid} .hd', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 0.15);
              tl.fromTo('#${s.sid} .node', { opacity: 0 }, { opacity: 1, duration: 0.6, stagger: 0.18, ease: 'power2.out' }, 0.3);
              tl.fromTo('#${s.sid}-${s.b}', { x: 90 }, { x: 0, duration: 0.8, ease: 'power2.out' }, 0.3);
              // A SLOW tween that is still running long after the arrow draws.
              // This is the ordinary case, not a contrivance: every archetype
              // staggers reveals across its beat, so "the DOM" is a function of
              // t for most of a scene. What it makes true is that a measurement
              // taken "whenever something first asked" has no single answer.
              tl.fromTo('#${s.sid}-${s.a}', { y: 0 }, { y: -70, duration: 4.4, ease: 'none' }, 0.3);
              tl.fromTo('#${s.sid}-arrow', { strokeDashoffset: geom.len }, { strokeDashoffset: 0, duration: 0.9, ease: 'none' }, 1.4);
              tl.fromTo('#${s.sid}-head', { opacity: 0 }, { opacity: 1, duration: 0.2 }, 2.2);
              return tl;
            }`;
}

/**
 * Emit time's best guess: 0.52em per character at 56px, plus the box padding
 * and border. It is a bounding box around ink it has never seen.
 */
function guessGeometry(s) {
  const wOf = (label) => Math.round(label.length * 56 * 0.52) + 92 + 6;
  const pad = 110;
  const aw = wOf(s.aLabel);
  const bw = wOf(s.bLabel);
  const boxH = 56 * 1.2 + 76 + 6;
  const cy = H / 2 + 120;
  const x1 = pad + aw + 14;
  const x2 = W - pad - bw - 26;
  const mx = (x1 + x2) / 2;
  const y = Math.round(cy);
  return {
    d: `M${x1} ${y} L${mx} ${y} L${mx} ${y} L${x2} ${y}`,
    head: `M${x2 + 26} ${y} L${x2} ${y - 15} L${x2} ${y + 15} Z`,
    len: Math.abs(x2 - x1),
    boxH,
  };
}

function sceneScript(variant, s) {
  const common = `${measureFn(s)}\n            ${timelineFn(s)}`;
  if (variant === "emit") {
    const g = guessGeometry(s);
    return `${timelineFn(s)}
            window.__timelines = window.__timelines || {};
            window.__dsCost = window.__dsCost || {};
            var t0 = performance.now();
            var tl = dsBuild(gsap.timeline({ paused: true }), ${JSON.stringify({ d: g.d, head: g.head, len: g.len })});
            window.__dsCost['${s.sid}'] = performance.now() - t0;
            window.__timelines['${s.sid}'] = tl;`;
  }
  if (variant === "parse") {
    return `${common}
            window.__timelines = window.__timelines || {};
            window.__dsCost = window.__dsCost || {};
            var t0 = performance.now();
            // Measured HERE, which is where \`Scene.setup\` runs today: during
            // parse, before the webfont has loaded and before layout is final.
            var tl = dsBuild(gsap.timeline({ paused: true }), dsMeasure());
            window.__dsCost['${s.sid}'] = performance.now() - t0;
            window.__timelines['${s.sid}'] = tl;`;
  }
  if (variant === "lazy") {
    // The camera's rule, transplanted: values are functions, evaluated on the
    // tween's first render and memoised. `immediateRender: false`, as there.
    return `${measureFn(s)}
            window.__timelines = window.__timelines || {};
            window.__dsCost = window.__dsCost || {};
            var dsGeom = null;
            function dsLazy() {
              if (dsGeom) return dsGeom;
              var t0 = performance.now();
              dsGeom = dsMeasure();
              var arrow = document.getElementById('${s.sid}-arrow');
              document.getElementById('${s.sid}-head').setAttribute('d', dsGeom.head);
              arrow.setAttribute('d', dsGeom.d);
              arrow.style.strokeDasharray = dsGeom.len;
              window.__dsCost['${s.sid}'] = performance.now() - t0;
              window.__dsMeasuredAt = (window.__dsMeasuredAt || []).concat(['${s.sid}']);
              return dsGeom;
            }
            var tl = gsap.timeline({ paused: true });
            tl.fromTo('#${s.sid} .hd', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 0.15);
            tl.fromTo('#${s.sid} .node', { opacity: 0 }, { opacity: 1, duration: 0.6, stagger: 0.18, ease: 'power2.out' }, 0.3);
            tl.fromTo('#${s.sid}-${s.b}', { x: 90 }, { x: 0, duration: 0.8, ease: 'power2.out' }, 0.3);
            tl.fromTo('#${s.sid}-${s.a}', { y: 0 }, { y: -70, duration: 4.4, ease: 'none' }, 0.3);
            tl.fromTo('#${s.sid}-arrow', { strokeDashoffset: function () { return dsLazy().len; } }, { strokeDashoffset: 0, duration: 0.9, ease: 'none', immediateRender: false }, 1.4);
            tl.fromTo('#${s.sid}-head', { opacity: 0 }, { opacity: 1, duration: 0.2 }, 2.2);
            window.__timelines['${s.sid}'] = tl;`;
  }
  // defer / defer-slow: SEAM B. Register a builder; the ready gate runs it.
  // `DS_SLOW_MS` per scene, so the barrier's own budget can be found by walking
  // it up until the engine stops waiting.
  const ms = Number(process.env.DS_SLOW_MS ?? 1500);
  const slow =
    variant === "defer-slow" ? `\n              await new Promise(function (r) { setTimeout(r, ${ms}); });` : "";
  return `${common}
            window.__dsBuilders = window.__dsBuilders || [];
            window.__dsCost = window.__dsCost || {};
            window.__dsBuilders.push(async function () {${slow}
              var t0 = performance.now();
              var tl = dsBuild(gsap.timeline({ paused: true }), dsMeasure());
              window.__dsCost['${s.sid}'] = performance.now() - t0;
              window.__timelines = window.__timelines || {};
              window.__timelines['${s.sid}'] = tl;
            });`;
}

/**
 * The ready gate. The shipped one awaits images and fonts, then lowers the flag
 * and fires the event. Seam B adds exactly one thing: run the registered
 * builders — awaiting each, so an async measurement is covered by the same
 * barrier — BEFORE the flag drops.
 *
 * Ordering is guaranteed by document order and nothing cleverer: this script is
 * the last child of #root, so every scene's builder is already in the array by
 * the time it runs.
 */
function readyGate(variant) {
  const build =
    variant === "defer" || variant === "defer-slow"
      ? `
          var builders = window.__dsBuilders || [];
          var t0 = performance.now();
          for (var i = 0; i < builders.length; i++) await builders[i]();
          window.__dsBuildMs = performance.now() - t0;`
      : "";
  return `
      <script>
        (async function () {
          await Promise.all(
            Array.prototype.map.call(document.images, function (img) {
              return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
            }).concat([document.fonts ? document.fonts.ready : Promise.resolve()]),
          );${build}
          window.__dsReadyMs = performance.now();
          window.__hfTimelinesBuilding = false;
          window.dispatchEvent(new Event("hf-timelines-built"));
        })();
      </script>`;
}

function deck(variant) {
  let start = 0;
  const scenes = SCENES.map((s) => {
    const html = `      <div
        id="${s.sid}"
        class="scene clip"
        data-composition-id="${s.sid}"
        data-start="${t(start)}"
        data-duration="${t(s.seconds)}"
        data-label="${s.headline}"
      >
${sceneHtml(s)}
        <script>
          (function () {
            ${sceneScript(variant, s)}
          })();
        </script>
      </div>`;
    start += s.seconds;
    return html;
  });
  const total = start;
  return `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <title>Seam B — ${variant}</title>
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="./vendor/gsap.min.js"></script>
    <style>
${CSS}
    </style>
  </head>
  <body>
    <script>window.__hfTimelinesBuilding = true;</script>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${t(total)}"
      data-width="${W}"
      data-height="${H}"
    >
${scenes.join("\n")}
      <script>
        (function () {
          window.__timelines = window.__timelines || {};
          var tl = gsap.timeline({ paused: true });
          tl.to({}, { duration: ${t(total)} });
          window.__timelines["main"] = tl;
        })();
      </script>${readyGate(variant)}
    </div>
  </body>
</html>
`;
}

export const VARIANTS = ["emit", "parse", "lazy", "defer", "defer-slow"];

export function build(variant, outDir) {
  mkdirSync(join(outDir, "vendor"), { recursive: true });
  mkdirSync(join(outDir, "katex", "fonts"), { recursive: true });
  cpSync(join(REPO, "demo/deck/vendor/gsap.min.js"), join(outDir, "vendor/gsap.min.js"));
  cpSync(
    join(REPO, "demo/deck/katex/fonts/KaTeX_Main-Regular.woff2"),
    join(outDir, "katex/fonts/KaTeX_Main-Regular.woff2"),
  );
  writeFileSync(
    join(outDir, "hyperframes.json"),
    `${JSON.stringify({ $schema: "https://hyperframes.heygen.com/schema/hyperframes.json", paths: { assets: "assets" } }, null, 2)}\n`,
  );
  writeFileSync(join(outDir, "index.html"), deck(variant));
  return outDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const v of VARIANTS) {
    build(v, join(HERE, "out", v));
    console.log(`built ${v} -> experiments/014-seam-b/out/${v}`);
  }
}
