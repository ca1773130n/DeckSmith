/**
 * Patch the REAL built composition three ways, so every screenshot below is of
 * the slide the deck actually ships and not of a mock-up.
 *
 * Each patch adds only: one wrapper element, one CSS rule, and `fromTo`
 * statements on the scene's existing paused timeline.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { morph, push } from "./fragments.mjs";

const DIR = new URL(".", import.meta.url).pathname;
const base = readFileSync(`${DIR}base.html`, "utf8");

/** A seek hook so the driver can land on an exact composition time. */
const HOOK = `
<script>
window.__go = function (sid, t) {
  document.querySelectorAll("[data-composition-id].scene").forEach(function (e) {
    e.style.display = e.id === sid ? "" : "none";
  });
  window.__timelines[sid].seek(t);
};
document.documentElement.className = "";           // ambient off: still document
</script>`;

function withHook(html) {
  return html.replace("</body>", `${HOOK}\n</body>`);
}

/** Insert `open`…`close` around the run of markup between two anchors. */
function wrap(html, startAfter, endBefore, open, close) {
  const i = html.indexOf(startAfter) + startAfter.length;
  const j = html.indexOf(endBefore, i);
  if (i < startAfter.length || j < 0) throw new Error("anchor not found: " + startAfter.slice(0, 40));
  return html.slice(0, i) + open + html.slice(i, j) + close + html.slice(j);
}

function addCss(html, css) {
  return html.replace("</style>", `${css}\n</style>`);
}

/** Append statements to one scene's timeline, just before it is registered. */
function addTl(html, sid, statements) {
  const anchor = `window.__timelines["${sid}"] = tl;`;
  return html.replace(anchor, statements.join("\n            ") + "\n            " + anchor);
}

/* =============================================================== P1 — camera */
{
  const SID = "s2";
  const STAGE = { w: 1700, h: 330 }; // the pipeline SVG's viewBox
  // The camera box is the content region: the pipe wrap plus the note. In CSS
  // pixels the SVG is 1700x330 at 1:1, so SVG coords == camera coords here.
  const rect = (i) => ({ x: 2 + i * 448.84, y: 2, w: 349.49, h: 192 });
  const wide = { k: 1, x: 0, y: 0 };
  const shots = [
    // land wide, then push onto each stage as it is revealed, then pull back for the loop
    { at: 2.4, dur: 0.9, from: wide, to: push(rect(1), 1.55, STAGE) },
    { at: 3.8, dur: 0.9, from: push(rect(1), 1.55, STAGE), to: push(rect(2), 1.75, STAGE) },
    { at: 5.2, dur: 0.9, from: push(rect(2), 1.75, STAGE), to: push(rect(3), 1.55, STAGE) },
    { at: 6.0, dur: 1.0, from: push(rect(3), 1.55, STAGE), to: wide },
  ];
  const tl = shots.map(
    (s) =>
      `tl.fromTo("#${SID}-cam", { scale: ${r(s.from.k)}, x: ${r(s.from.x)}, y: ${r(s.from.y)} }, ` +
      `{ scale: ${r(s.to.k)}, x: ${r(s.to.x)}, y: ${r(s.to.y)}, duration: ${s.dur}, ease: "power2.inOut" }, ${s.at});`,
  );
  let h = wrap(
    base,
    `<h2 class="headline" id="s2-h">One pass in, one pass out, and a loop in the middle</h2>`,
    `        <script>`,
    `\n<div class="ds-cam" id="s2-cam">`,
    `</div>\n`,
  );
  h = addCss(
    h,
    `.ds-cam{transform-origin:0 0}
      #s2{overflow:hidden}`,
  );
  h = addTl(h, SID, tl);
  writeFileSync(`${DIR}p1-camera.html`, withHook(h));
  console.log("P1 camera →", tl.length, "shots");
}

/* ========================================================== P2 — figure morph */
{
  const SID = "s3";
  // The plate the emitter already built, read straight out of the emitted CSS:
  //   #s3-plate{left:408px;top:-15px;width:884px;height:236.24px}  PLATE pad = 14
  const plate = { w: 884, h: 236.24, pad: 14 };
  const A = { x: 0.02, y: 0.52, w: 0.96, h: 0.46 }; // the shipped crop: the whole (c) row
  // B pushes onto the DQ-CTM block and the dense token field it produces.
  // Height is SNAPPED so the two crops share an aspect ratio — see fragments.mjs.
  const Bw = 0.52;
  const B = { x: 0.42, y: 0.585, w: Bw, h: (Bw * A.h) / A.w };
  const m = morph(SID, null, plate, A, B, { at: 5.2, dur: 1.2 });
  let h = addCss(base, m.css);
  h = addTl(h, SID, [
    // the crop-A annotations retire, the figure pushes in, one crop-B label arrives
    `tl.fromTo("#${SID}-ov", { opacity: 1 }, { opacity: 0, duration: 0.4 }, 5.0);`,
    ...m.tl,
    `tl.fromTo("#${SID}-morphlab", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5 }, 6.2);`,
  ]);
  h = h.replace(
    `<div class="af-cap" id="s3-cap">`,
    `<div class="af-morphlab" id="s3-morphlab">One DQ-CTM block, one query for every position it hands back</div>\n<div class="af-cap" id="s3-cap">`,
  );
  h = addCss(
    h,
    `.af-morphlab{position:absolute;left:110px;bottom:150px;width:1700px;font-size:44px;font-weight:600;color:#ffd166;opacity:0}`,
  );
  writeFileSync(`${DIR}p2-morph.html`, withHook(h));
  console.log("P2 morph → scale", m.geo.k.toFixed(4), "dx", (m.geo.b.left - m.geo.a.left).toFixed(2), "dy", (m.geo.b.top - m.geo.a.top).toFixed(2));
}

/* ======================================================= P3 — match-cut handoff
 *
 * The synthesis under test: KEEP THE STOP, LOSE THE CUT — without touching the
 * runtime, which still does `el.style.display = "none"` at the boundary
 * (src/deck/runtime.ts:231).
 *
 * The trick is that a cut you cannot see is not a cut. s2's last stop pushes the
 * camera onto its DQ-CTM box; s3's first stop opens with the figure's own DQ-CTM
 * block at THE SAME SCREEN RECT, then pulls out to the whole row. Two isolated
 * coordinate spaces, matched at one frame. The planner already knows the two
 * beats are about the same object — that is what a storyboard IS.
 */
{
  const S2 = { w: 1700, h: 330 };
  const dq = { x: 899.67, y: 2, w: 349.49, h: 192 };
  const held = push(dq, 1.75, S2);

  // s2: end held on the DQ-CTM box instead of pulling back to wide
  let h = wrap(
    base,
    `<h2 class="headline" id="s2-h">One pass in, one pass out, and a loop in the middle</h2>`,
    `        <script>`,
    `\n<div class="ds-cam" id="s2-cam">`,
    `</div>\n`,
  );
  h = addCss(h, `.ds-cam{transform-origin:0 0}\n      #s2{overflow:hidden}`);
  h = addTl(h, "s2", [
    `tl.fromTo("#s2-cam", { scale: 1, x: 0, y: 0 }, { scale: ${r(held.k)}, x: ${r(held.x)}, y: ${r(held.y)}, duration: 1.0, ease: "power2.inOut" }, 5.4);`,
  ]);

  // s3 opens ON the figure's own DQ-CTM block, occupying the SAME screen rect
  // that s2's DQ-CTM box just vacated, then pulls out to the authored framing.
  //
  // Two tweens do it. The plate becomes the target rect (left/top/width/height,
  // absolutely positioned so nothing else relayouts), and the img inside it is
  // scaled so the figure's block fills that rect. Both sets of numbers are the
  // solution of `proto/solve.mjs`, measured against the real DOM:
  //
  //   k = targetW / (F.w * imgW)          F = the block in figure coordinates
  //   dx = pad - (imgLeft + k*F.x*imgW)   dy likewise
  const M = {
    k: 5.4136,
    dx: -2150.32,
    dy: -1396.53,
    plate: { left: 544.19, top: 23.42, w: 611.61, h: 336 },
  };
  const HOME = { left: 408, top: -15, w: 884, h: 236.24 };
  const OUT_AT = 0.55;
  const OUT_DUR = 1.35;

  // the plate's own entrance is wrong now — we open ON the plate, not before it
  h = h.replace(
    `tl.fromTo("#s3-plate", { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.8 }, 0.7);`,
    `tl.fromTo("#s3-plate", { opacity: 1 }, { opacity: 1, duration: 0.01 }, 0);`,
  );
  // the headline arrives after the pull-out, so it does not compete with the match
  h = h
    .replace(`{ opacity: 1, y: 0, duration: 0.5 }, 0.15);`, `{ opacity: 1, y: 0, duration: 0.5 }, 1.7);`)
    .replace(`{ opacity: 1, y: 0, duration: 0.6 }, 0.3);`, `{ opacity: 1, y: 0, duration: 0.6 }, 1.85);`)
    .replace(`tl.fromTo("#s3-cap", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1);`,
             `tl.fromTo("#s3-cap", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 2.1);`);
  h = addCss(h, `#s3-plate img{transform-origin:0 0;will-change:transform}`);
  h = addTl(h, "s3", [
    `tl.fromTo("#s3-plate img", { scale: ${M.k}, x: ${M.dx}, y: ${M.dy} }, { scale: ${M.k}, x: ${M.dx}, y: ${M.dy}, duration: ${OUT_AT} }, 0);`,
    `tl.fromTo("#s3-plate", { left: ${M.plate.left}, top: ${M.plate.top}, width: ${M.plate.w}, height: ${M.plate.h} }, { left: ${M.plate.left}, top: ${M.plate.top}, width: ${M.plate.w}, height: ${M.plate.h}, duration: ${OUT_AT} }, 0);`,
    `tl.fromTo("#s3-plate img", { scale: ${M.k}, x: ${M.dx}, y: ${M.dy} }, { scale: 1, x: 0, y: 0, duration: ${OUT_DUR}, ease: "power2.inOut" }, ${OUT_AT});`,
    `tl.fromTo("#s3-plate", { left: ${M.plate.left}, top: ${M.plate.top}, width: ${M.plate.w}, height: ${M.plate.h} }, { left: ${HOME.left}, top: ${HOME.top}, width: ${HOME.w}, height: ${HOME.h}, duration: ${OUT_DUR}, ease: "power2.inOut" }, ${OUT_AT});`,
    // the annotations are authored in whole-crop coordinates, so they may only
    // arrive once the pull-out has landed.
    `tl.fromTo("#s3-ov", { opacity: 0 }, { opacity: 0, duration: ${OUT_AT + OUT_DUR} }, 0);`,
  ]);
  writeFileSync(`${DIR}p3-matchcut.html`, withHook(h));
  console.log("P3 matchcut → s2 holds DQ-CTM at k", held.k, "; s3 opens at k", M.k);
}

/* ------------------------------------------------------ control: same, unpatched */
writeFileSync(`${DIR}p0-control.html`, withHook(base));

function r(n) {
  return Math.round(n * 100) / 100;
}
