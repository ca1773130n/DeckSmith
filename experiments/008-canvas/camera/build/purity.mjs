/**
 * Is the camera a pure function of t?
 *
 * The disqualifying failure mode named in the brief is a camera that eases
 * toward a target using frame deltas: it converges, so seeking forward through
 * every frame LOOKS right and any other access order does not. So the test is
 * not "does it animate" — it is "does the state at t depend on how you got
 * there". Three orders (ascending, descending, shuffled by a fixed-seed LCG).
 *
 * Two digests per sample:
 *   camera — the viewBox string, or the rig's two computed matrices.
 *   dom    — every inline style GSAP wrote, over every element in the document.
 *            This is the authoritative one: it is the timeline's whole output,
 *            with no compositor in the loop to blame.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OUT } from "./common.mjs";
import { open, loadComp } from "./browser.mjs";

const project = process.argv[2] ?? "dom";
const TIMES = [];
for (let i = 0; i <= 60; i++) TIMES.push(Math.round(i * 0.5 * 1000) / 1000);

function shuffled(a) {
  const out = a.slice();
  let s = 12345;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function sample(order) {
  const { browser, page } = await open();
  await loadComp(page, pathToFileURL(join(OUT, project, "index.html")).href);
  const seen = new Map();
  for (const t of order) {
    const digest = await page.evaluate((tt) => {
      // Seek every registered timeline the way the engine does: root at t,
      // children at t minus their own data-start.
      for (const [k, tl] of Object.entries(window.__timelines)) {
        const el = document.querySelector(`[data-composition-id="${k}"]`);
        const start = Number(el?.getAttribute("data-start") ?? 0);
        tl.seek(Math.max(0, tt - start));
      }
      const world = document.getElementById("world");
      const zoom = document.getElementById("zoom");
      const camera = world
        ? world.getAttribute("viewBox")
        : zoom
          ? `${getComputedStyle(zoom).transform}|${getComputedStyle(document.getElementById("pan")).transform}`
          : "none";
      // COMPUTED style, not the inline attribute. A `fromTo` with
      // immediateRender:false writes no inline style until the playhead first
      // enters it, so an ascending pass from t=0 has attributes that a
      // descending pass already has — a difference in what has been TOUCHED,
      // not in what is SHOWN. The baseline deck has exactly the same property,
      // which is how we know it is an artifact of the probe and not of the
      // camera. Computed style always exists, so it compares like with like.
      const parts = [];
      for (const el of document.querySelectorAll("[id]")) {
        const s = getComputedStyle(el);
        parts.push(
          `${el.id}|${s.transform}|${s.opacity}|${s.strokeDashoffset}|${s.strokeWidth}|${el.getAttribute("viewBox") ?? ""}`,
        );
      }
      return { camera, dom: parts.join("\n") };
    }, t);
    seen.set(t, {
      camera: digest.camera,
      dom: createHash("sha256").update(digest.dom).digest("hex").slice(0, 16),
    });
  }
  await browser.close();
  return seen;
}

const asc = await sample(TIMES);
const desc = await sample(TIMES.slice().reverse());
const rnd = await sample(shuffled(TIMES));

const bad = { camera: [], dom: [] };
for (const t of TIMES) {
  const [a, b, c] = [asc.get(t), desc.get(t), rnd.get(t)];
  if (a.camera !== b.camera || a.camera !== c.camera) bad.camera.push({ t, a: a.camera, b: b.camera, c: c.camera });
  if (a.dom !== b.dom || a.dom !== c.dom) bad.dom.push({ t, a: a.dom, b: b.dom, c: c.dom });
}
console.log(
  JSON.stringify(
    {
      project,
      samples: TIMES.length,
      cameraMismatches: bad.camera.length,
      domMismatches: bad.dom.length,
      distinctCameraStates: new Set([...asc.values()].map((v) => v.camera)).size,
      firstCameraDiffs: bad.camera.slice(0, 3),
      firstDomDiffs: bad.dom.slice(0, 3),
    },
    null,
    1,
  ),
);
