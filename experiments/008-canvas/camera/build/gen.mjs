/**
 * Generate the three projects this experiment compares.
 *
 *   out/baseline  — today's structure: three isolated `.scene.clip` islands.
 *   out/dom       — one continuous world, CSS-transform camera (nested rig).
 *   out/viewbox   — the same world, one big SVG whose viewBox is animated.
 *
 * The plates are byte-for-byte the scenes `src/emit` ships today; nothing under
 * src/ is touched. The only transform applied to an emitted Scene is
 * `offsetTl`, which moves its relative times onto the shared clock.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { emitComposition, emitIsland } from "./emit.mjs";
import {
  BEAT_IDS,
  GSAP_SRC,
  HF_JSON,
  HERE,
  OUT,
  ROOT,
  loadPlates,
  offsetTl,
  round,
  t,
  themeCss,
} from "./common.mjs";

const W = 1920;
const H = 1080;

/* ------------------------------------------------------------- 1. baseline */

async function baseline({ sb, source, format }) {
  const three = { ...sb, beats: sb.beats.filter((b) => BEAT_IDS.includes(b.id)) };
  const html = emitComposition(three, source, format, {});
  const dir = join(OUT, "baseline");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), html);
  await writeFile(join(dir, "hyperframes.json"), HF_JSON);
  return dir;
}

/* ------------------------------------------------------ 2. the world layout */

/**
 * Anchors are the world rects of the two pipeline stages the tour enters:
 * `Window` (stage1) and `DQ-CTM` (stage2). Measured once in a browser from the
 * baseline render and baked, rather than re-derived from flex arithmetic that
 * would silently drift the moment a font metric changed.
 */
async function anchors() {
  const raw = await readFile(join(HERE, "anchors.json"), "utf8");
  return JSON.parse(raw);
}

/** Inflate a rect to 16:9 about its centre, with `pad` fraction of slack. */
function frame16x9(r, pad) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  let w = r.w * (1 + pad);
  let h = r.h * (1 + pad);
  if (w / h < W / H) w = (h * W) / H;
  else h = (w * H) / W;
  return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
}

function worldLayout(a) {
  // Plate A is the world's unit: 1920x1080 at world scale 1, origin (0,0).
  const plateA = { x: 0, y: 0, scale: 1 };
  const fA = { cx: W / 2, cy: H / 2, k: 1 };

  // Plates B and C occupy exactly the frame that the stage box opens into, so
  // the camera's landing framing IS the box. `scale = w/1920` is the reciprocal
  // of the camera scale that frames it — which is the whole type-floor rule.
  const rB = frame16x9(a.stage1, 0.1);
  const rC = frame16x9(a.stage2, 0.1);
  const plateB = { x: rB.x, y: rB.y, scale: rB.w / W };
  const plateC = { x: rC.x, y: rC.y, scale: rC.w / W };
  const fB = { cx: rB.cx, cy: rB.cy, k: W / rB.w };
  const fC = { cx: rC.cx, cy: rC.cy, k: W / rC.w };

  // The pull-back the second move arcs through: both boxes in one frame.
  const spanX = Math.abs(fC.cx - fB.cx) + Math.max(rB.w, rC.w) * 1.4;
  const fOver = { cx: (fB.cx + fC.cx) / 2, cy: (fB.cy + fC.cy) / 2, k: Math.min(1, W / spanX) };

  return { plateA, plateB, plateC, fA, fB, fC, fOver, rB, rC };
}

/* --------------------------------------------------------- 3. the schedule */

/** Lead-in: a plate's own reveal starts before the camera has finished landing. */
const LEAD = 0.7;
const MOVE1 = 1.4;
const MOVE2 = 2.2;
const DWELL = 9;
const TAIL = 0.8;

function schedule() {
  const aStart = 0;
  const move1 = { t0: aStart + DWELL, dur: MOVE1 };
  const bStart = round(move1.t0 + move1.dur - LEAD);
  const move2 = { t0: round(bStart + DWELL), dur: MOVE2 };
  const cStart = round(move2.t0 + move2.dur - LEAD);
  const total = round(cStart + DWELL + TAIL);
  return { starts: [aStart, bStart, cStart], move1, move2, total };
}

/* ------------------------------------------------------ 4. camera preamble */

/**
 * The camera, as arithmetic.
 *
 * `smooth` is the only shaping ease. `zoomEase` composes it with an exponential
 * so scale travels in log space — a linear scale tween reads as a lurch, and
 * every "smooth zoom" implementation since Van Wijk 2004 fixes it this way.
 * `panEase` is the normalised integral of 1/k over the same path, which is
 * exactly the condition "the target point moves at constant SCREEN speed";
 * without it a pan at high zoom whips.
 *
 * All three are pure functions of the tween's own progress. Nothing here reads
 * a clock, a frame delta, or the element's current value, so `tl.seek(x)`
 * produces the same transform for a given x on every run and in any order.
 */
const CAMERA_JS = `
        function smooth(p) { return p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p); }
        function zoomEase(r) {
          if (Math.abs(r - 1) < 1e-9) return smooth;
          return function (p) { return (Math.pow(r, smooth(p)) - 1) / (r - 1); };
        }
        /* Also the exact ease for any quantity proportional to 1/k — the ring
           stroke widths use it to hold a constant device thickness. */
        function panEase(r) {
          if (Math.abs(r - 1) < 1e-9) return smooth;
          return function (p) { return (1 - Math.pow(r, -smooth(p))) / (1 - 1 / r); };
        }`;

/** One camera segment as two independent, pure `fromTo`s on the rig. */
function camSegment(from, to, t0, dur, sel = { zoom: "#zoom", pan: "#pan" }, depth = 1) {
  const r = to.k / from.k;
  const k0 = 1 + (from.k - 1) * depth;
  const k1 = 1 + (to.k - 1) * depth;
  const rr = k1 / k0;
  return [
    `tl.fromTo("${sel.zoom}", { scale: ${round(k0)} }, { scale: ${round(k1)}, duration: ${dur}, ease: zoomEase(${round(rr)}), immediateRender: false }, ${t0});`,
    `tl.fromTo("${sel.pan}", { x: ${round(-from.cx * depth)}, y: ${round(-from.cy * depth)} }, { x: ${round(-to.cx * depth)}, y: ${round(-to.cy * depth)}, duration: ${dur}, ease: panEase(${round(r)}), immediateRender: false }, ${t0});`,
  ];
}

/* ----------------------------------------------------------- 5. the worlds */

const PARALLAX = 0.42;

function ring(idSuffix, r, colour) {
  return `<rect id="ring${idSuffix}" x="${round(r.x)}" y="${round(r.y)}" width="${round(r.w)}" height="${round(r.h)}" rx="18" fill="none" stroke="${colour}" stroke-width="5" opacity="0.85" />`;
}

function plateDiv(id, sid, plate, scene) {
  // Corner radius in PLATE coordinates, so the clip lands on the world-space
  // ring rather than 18px inside or outside it at whatever scale it is seen at.
  //
  // `id="${sid}"` on the scene box is load-bearing and was missed on the first
  // pass: `grid` scopes its cell stagger as `#s2 .gcell`, so without it GSAP
  // logs "target not found" to a console nobody reads and the slide renders
  // with every cell dark. It looked plausible. It was wrong.
  const r = round(18 / plate.scale);
  return `        <div class="plate" id="${id}" style="left:${round(plate.x)}px;top:${round(plate.y)}px;transform:scale(${round(plate.scale)});border-radius:${r}px">
          <div class="scene" id="${sid}">
${scene.html}
          </div>
        </div>`;
}

function worldCss(theme) {
  return `      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${theme.bg}; }
      #rig { position: absolute; left: ${W / 2}px; top: ${H / 2}px; width: 0; height: 0; }
      #zoom, #zoomBg, #pan, #panBg { position: absolute; left: 0; top: 0; width: 0; height: 0;
                                     transform-origin: 0 0; }
      .plate { position: absolute; width: ${W}px; height: ${H}px; transform-origin: 0 0;
               overflow: hidden; border-radius: 0; }
      /* The scene box, verbatim from theme.ts, so a plate lays out exactly as a
         slide does today. */
      .plate .scene { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                      padding: 84px 110px; display: flex; flex-direction: column;
                      justify-content: center; }
      #bgfield { position: absolute; left: -4000px; top: -3000px; width: 12000px; height: 8000px;
                 background-image: radial-gradient(${theme.rule} 1.4px, transparent 1.4px);
                 background-size: 96px 96px; opacity: .5; }
      #threads { position: absolute; left: -4000px; top: -3000px; width: 12000px; height: 8000px;
                 overflow: visible; }`;
}

function head(title, theme, format, archetypeCss, extraCss) {
  return `<!doctype html>
<html lang="en" data-resolution="landscape">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="${GSAP_SRC}"></script>
    <style>
${themeCss(theme, format)}
${archetypeCss.map((c) => c.replace(/^/gm, "      ")).join("\n")}
${extraCss}
    </style>
  </head>`;
}

/* ------------------------------------------------------------- variant A */

async function domCamera({ theme, format, plates }, L, S) {
  const css = [...new Set(plates.map((p) => (p.scene.css ?? "").trim()).filter(Boolean))];
  const placements = [L.plateA, L.plateB, L.plateC];

  const tl = [];
  tl.push(`gsap.set("#zoom", { scale: ${L.fA.k} });`);
  tl.push(`gsap.set("#pan", { x: ${round(-L.fA.cx)}, y: ${round(-L.fA.cy)} });`);
  tl.push(
    `gsap.set("#zoomBg", { scale: ${round(1 + (L.fA.k - 1) * PARALLAX)} });`,
    `gsap.set("#panBg", { x: ${round(-L.fA.cx * PARALLAX)}, y: ${round(-L.fA.cy * PARALLAX)} });`,
  );
  tl.push(`gsap.set("#p1", { opacity: 1 });`);
  tl.push(`gsap.set("#p2", { opacity: 0 });`);
  tl.push(`gsap.set("#p3", { opacity: 0 });`);

  // Plate reveals, verbatim, shifted onto the shared clock.
  plates.forEach((p, i) => {
    tl.push(...offsetTl(p.scene.tl, S.starts[i]));
  });

  // Camera move 1: push in from the whole method to the Window stage.
  tl.push(...camSegment(L.fA, L.fB, S.move1.t0, S.move1.dur));
  tl.push(
    ...camSegment(L.fA, L.fB, S.move1.t0, S.move1.dur, { zoom: "#zoomBg", pan: "#panBg" }, PARALLAX),
  );
  // Move 2 arcs through an overview rather than tracking laterally at k=6:
  // a straight pan between two deep framings is a smear, not a move.
  const half = round(S.move2.dur / 2);
  tl.push(...camSegment(L.fB, L.fOver, S.move2.t0, half));
  tl.push(...camSegment(L.fOver, L.fC, round(S.move2.t0 + half), half));
  tl.push(
    ...camSegment(L.fB, L.fOver, S.move2.t0, half, { zoom: "#zoomBg", pan: "#panBg" }, PARALLAX),
    ...camSegment(
      L.fOver,
      L.fC,
      round(S.move2.t0 + half),
      half,
      { zoom: "#zoomBg", pan: "#panBg" },
      PARALLAX,
    ),
  );

  // Ring stroke widths ride 1/k so the outline holds a constant device weight.
  const sw = (f) => round(5 / f.k);
  tl.push(
    `tl.fromTo("#ringB", { strokeWidth: ${sw(L.fA)} }, { strokeWidth: ${sw(L.fB)}, duration: ${S.move1.dur}, ease: panEase(${round(L.fB.k / L.fA.k)}), immediateRender: false }, ${S.move1.t0});`,
    `tl.fromTo("#ringC", { strokeWidth: ${sw(L.fA)} }, { strokeWidth: ${sw(L.fB)}, duration: ${S.move1.dur}, ease: panEase(${round(L.fB.k / L.fA.k)}), immediateRender: false }, ${S.move1.t0});`,
    `tl.fromTo("#ringB", { strokeWidth: ${sw(L.fB)} }, { strokeWidth: ${sw(L.fOver)}, duration: ${half}, ease: panEase(${round(L.fOver.k / L.fB.k)}), immediateRender: false }, ${S.move2.t0});`,
    `tl.fromTo("#ringC", { strokeWidth: ${sw(L.fB)} }, { strokeWidth: ${sw(L.fOver)}, duration: ${half}, ease: panEase(${round(L.fOver.k / L.fB.k)}), immediateRender: false }, ${S.move2.t0});`,
    `tl.fromTo("#ringB", { strokeWidth: ${sw(L.fOver)} }, { strokeWidth: ${sw(L.fC)}, duration: ${half}, ease: panEase(${round(L.fC.k / L.fOver.k)}), immediateRender: false }, ${round(S.move2.t0 + half)});`,
    `tl.fromTo("#ringC", { strokeWidth: ${sw(L.fOver)} }, { strokeWidth: ${sw(L.fC)}, duration: ${half}, ease: panEase(${round(L.fC.k / L.fOver.k)}), immediateRender: false }, ${round(S.move2.t0 + half)});`,
  );

  // Plate visibility.
  //
  // The first cut of this faded plate A out for good, and the pull-back at the
  // middle of move 2 framed an empty world: two rings on a dot field. That is
  // the whole experiment in one frame — a camera over a space where only the
  // framed plate exists is a crossfade with extra arithmetic. Plate A is
  // therefore brought BACK for the overview, so leaving the Window box reveals
  // the method it belongs to before the camera dives into the next stage.
  //
  // It cannot simply stay on: at k=5 its own 46px label renders 230px tall
  // directly behind the grid. Visible when framed or containing, hidden when
  // neither — which is exactly the type-floor rule, stated as opacity.
  // Plate visibility, and THE PORT.
  //
  // Two failures had to be designed out here, and both are structural rather
  // than matters of taste.
  //
  // Overlapping the dissolves double-exposes text: at the middle of the
  // push-in, plate A's "Window" label is 230px tall and plate B's headline is
  // drawn straight through it. Sequencing them instead opens a hole: for ~0.4s
  // the frame holds a ring and nothing else, because the container has left and
  // the contents have not arrived.
  //
  // The fix is to empty the box you are flying into BEFORE you arrive, and keep
  // its frame. `#s1-stage1 text` is faded at the start of the move, so the
  // camera lands on a labelled, empty enclosure that the incoming plate draws
  // itself into. Nothing is ever double-exposed and nothing is ever blank.
  //
  // This is the finding with real reach: a diagram that can be ENTERED needs a
  // reserved interior. That is a property of the archetype, not of the camera —
  // `pipeline` happens to have box interiors big enough to serve as ports, and
  // `bar-compare` or `line-chart` do not.
  const m2b = round(S.move2.t0 + half);
  const port1 = `#${plates[0].sid}-stage1 text`;
  const port2 = `#${plates[0].sid}-stage2 text`;
  tl.push(
    // move 1 — empty the Window box, arrive, then dissolve the containing plate
    `tl.fromTo("${port1}", { opacity: 1 }, { opacity: 0, duration: 0.45, ease: "power1.in", immediateRender: false }, ${S.move1.t0});`,
    `tl.fromTo("#p2", { opacity: 0 }, { opacity: 1, duration: 0.55, ease: "power1.out", immediateRender: false }, ${round(S.move1.t0 + 0.6)});`,
    `tl.fromTo("#p1", { opacity: 1 }, { opacity: 0, duration: 0.4, ease: "power1.in", immediateRender: false }, ${round(S.move1.t0 + 1)});`,
    // move 2 — leave, let the method reassemble around the box just left,
    // then empty the next box and dive into it
    `tl.fromTo("#p2", { opacity: 1 }, { opacity: 0, duration: 0.55, ease: "power1.in", immediateRender: false }, ${S.move2.t0});`,
    `tl.fromTo("#p1", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out", immediateRender: false }, ${round(S.move2.t0 + 0.5)});`,
    `tl.fromTo("${port1}", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out", immediateRender: false }, ${round(S.move2.t0 + 0.5)});`,
    `tl.fromTo("${port2}", { opacity: 1 }, { opacity: 0, duration: 0.45, ease: "power1.in", immediateRender: false }, ${m2b});`,
    `tl.fromTo("#p3", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power1.out", immediateRender: false }, ${round(m2b + 0.5)});`,
    `tl.fromTo("#p1", { opacity: 1 }, { opacity: 0, duration: 0.4, ease: "power1.in", immediateRender: false }, ${round(m2b + 0.7)});`,
  );

  const island = emitIsland(
    plates.map((p, i) => ({
      sid: `p${i + 1}`,
      start: S.starts[i],
      duration: i === 2 ? round(S.total - S.starts[2]) : round(S.starts[i + 1] - S.starts[i]),
      notes: p.beat.narration ?? p.beat.intent,
      holds: p.scene.holds,
    })),
  );

  const html = `${head("Camera — CSS transform world", theme, format, css, worldCss(theme))}
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${t(S.total)}"
      data-width="${W}"
      data-height="${H}"
    >
      <div id="rig">
        <div id="zoomBg"><div id="panBg"><div id="bgfield"></div></div></div>
        <div id="zoom"><div id="pan">
          <svg id="threads" viewBox="-4000 -3000 12000 8000">
            ${ring("B", L.rB, theme.tones.a)}
            ${ring("C", L.rC, theme.tones.b)}
          </svg>
${plateDiv("p1", plates[0].sid, L.plateA, plates[0].scene)}
${plateDiv("p2", plates[1].sid, L.plateB, plates[1].scene)}
${plateDiv("p3", plates[2].sid, L.plateC, plates[2].scene)}
        </div></div>
      </div>
      <script>
        (function () {${CAMERA_JS}
          window.__timelines = window.__timelines || {};
          var tl = gsap.timeline({ paused: true });
          ${tl.join("\n          ")}
          tl.to({}, { duration: ${t(S.total)} }, 0);
          window.__timelines["main"] = tl;
        })();
      </script>
    </div>
${island}
  </body>
</html>
`;
  const dir = join(OUT, "dom");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), html);
  await writeFile(join(dir, "hyperframes.json"), HF_JSON);
  return { dir, placements, island };
}

/* ------------------------------------------------------------- variant B */

/**
 * The same world, rendered as one SVG whose viewBox is animated.
 *
 * The plates go in `<foreignObject>` so the CONTENT is identical to variant A
 * and the only variable is the renderer.
 *
 * The first cut drove the viewBox from an `onUpdate` — the obvious way, since x
 * and width appear to need different eases. It rendered a completely static
 * frame and the reason is invariant 1 with teeth: `timeline.seek(t)` defaults to
 * `suppressEvents = true`, so onUpdate NEVER FIRES under a seek, and a seek is
 * the only thing capture ever does. HyperFrames' own transport calls
 * `totalTime(t, suppressEvents)`. An onUpdate camera plays perfectly in a
 * browser and renders a frozen video.
 *
 * The fix is also the better camera. Interpolating the whole viewBox string with
 * a single ease `e` gives
 *     x(p) = x0 + (x1-x0)e ,  w(p) = w0 + (w1-w0)e
 * and because x = cx - w/2 is affine, that is IDENTICALLY
 *     cx(p) = cx0 + (cx1-cx0)e ,  w(p) = w0 + (w1-w0)e.
 * Choosing e = panEase(r) makes w exactly exponential (log-space zoom) AND the
 * centre exactly linear in the same parameter (constant screen speed). One
 * `fromTo`, no callbacks, and geometrically the ideal camera rather than an
 * approximation to it.
 */
async function viewboxCamera({ theme, format, plates }, L, S) {
  const css = [...new Set(plates.map((p) => (p.scene.css ?? "").trim()).filter(Boolean))];

  const fo = (id, sid, plate, scene) =>
    `        <foreignObject id="${id}" x="${round(plate.x)}" y="${round(plate.y)}" width="${round(W * plate.scale)}" height="${round(H * plate.scale)}">
          <div xmlns="http://www.w3.org/1999/xhtml" class="plate-inner" style="transform:scale(${round(plate.scale)})">
            <div class="scene" id="${sid}">
${scene.html}
            </div>
          </div>
        </foreignObject>`;

  const segs = [
    { t0: S.move1.t0, dur: S.move1.dur, a: L.fA, b: L.fB },
    { t0: S.move2.t0, dur: round(S.move2.dur / 2), a: L.fB, b: L.fOver },
    {
      t0: round(S.move2.t0 + S.move2.dur / 2),
      dur: round(S.move2.dur / 2),
      a: L.fOver,
      b: L.fC,
    },
  ];

  const vb = (f) => {
    const w = W / f.k;
    const h = H / f.k;
    return `${round(f.cx - w / 2)} ${round(f.cy - h / 2)} ${round(w)} ${round(h)}`;
  };

  const tl = [];
  tl.push(`world.setAttribute("viewBox", "${vb(L.fA)}");`);
  plates.forEach((p, i) => tl.push(...offsetTl(p.scene.tl, S.starts[i])));
  for (const s of segs) {
    tl.push(
      `tl.fromTo("#world", { attr: { viewBox: "${vb(s.a)}" } }, { attr: { viewBox: "${vb(s.b)}" }, duration: ${s.dur}, ease: panEase(${round(s.b.k / s.a.k)}), immediateRender: false }, ${s.t0});`,
    );
  }
  const half2 = round(S.move2.t0 + S.move2.dur / 2);
  tl.push(
    `tl.fromTo("#p1", { opacity: 1 }, { opacity: 0, duration: 0.55, ease: "power1.in", immediateRender: false }, ${round(S.move1.t0 + 0.35)});`,
    `tl.fromTo("#p2", { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "power1.out", immediateRender: false }, ${round(S.move1.t0 + 0.95)});`,
    `tl.fromTo("#p2", { opacity: 1 }, { opacity: 0, duration: 0.55, ease: "power1.in", immediateRender: false }, ${S.move2.t0});`,
    `tl.fromTo("#p1", { opacity: 0 }, { opacity: 0.95, duration: 0.5, ease: "power1.out", immediateRender: false }, ${round(S.move2.t0 + 0.55)});`,
    `tl.fromTo("#p1", { opacity: 0.95 }, { opacity: 0, duration: 0.45, ease: "power1.in", immediateRender: false }, ${round(half2 + 0.2)});`,
    `tl.fromTo("#p3", { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "power1.out", immediateRender: false }, ${round(S.move2.t0 + S.move2.dur - 0.45)});`,
  );

  const extra = `      #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${theme.bg}; }
      #world { display: block; width: ${W}px; height: ${H}px; }
      .plate-inner { width: ${W}px; height: ${H}px; transform-origin: 0 0; position: relative; }
      .plate-inner .scene { position: absolute; top: 0; left: 0; width: 100%; height: 100%;
                            padding: 84px 110px; display: flex; flex-direction: column;
                            justify-content: center; }`;

  const html = `${head("Camera — SVG viewBox world", theme, format, css, extra)}
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${t(S.total)}"
      data-width="${W}"
      data-height="${H}"
    >
      <svg id="world" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
        <rect x="-4000" y="-3000" width="12000" height="8000" fill="${theme.bg}" />
        ${ring("B", L.rB, theme.tones.a)}
        ${ring("C", L.rC, theme.tones.b)}
${fo("p1", plates[0].sid, L.plateA, plates[0].scene)}
${fo("p2", plates[1].sid, L.plateB, plates[1].scene)}
${fo("p3", plates[2].sid, L.plateC, plates[2].scene)}
      </svg>
      <script>
        (function () {${CAMERA_JS}
          var world = document.getElementById("world");
          window.__timelines = window.__timelines || {};
          var tl = gsap.timeline({ paused: true });
          ${tl.join("\n          ")}
          tl.to({}, { duration: ${t(S.total)} }, 0);
          window.__timelines["main"] = tl;
        })();
      </script>
    </div>
  </body>
</html>
`;
  const dir = join(OUT, "viewbox");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), html);
  await writeFile(join(dir, "hyperframes.json"), HF_JSON);
  return dir;
}

/* -------------------------------------------------------------------- run */

const ctx = await loadPlates();
const S = schedule();
await baseline(ctx);

let L = null;
try {
  L = worldLayout(await anchors());
} catch {
  console.log("no anchors.json yet — baseline only. Run measure.mjs next.");
}
if (L) {
  await domCamera(ctx, L, S);
  await viewboxCamera(ctx, L, S);
  await writeFile(
    join(OUT, "layout.json"),
    `${JSON.stringify({ layout: L, schedule: S }, null, 2)}\n`,
  );
}
console.log(
  JSON.stringify(
    { total: S.total, starts: S.starts, move1: S.move1, move2: S.move2, framings: L && {
      fA: L.fA, fB: L.fB, fC: L.fC, fOver: L.fOver,
      plateScales: [L.plateA.scale, L.plateB.scale, L.plateC.scale] } },
    null,
    1,
  ),
);
