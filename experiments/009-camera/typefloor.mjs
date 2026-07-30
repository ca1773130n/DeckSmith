/**
 * A prototype of the type-floor gate rewritten for a variable camera scale.
 *
 * Today's rule is a property of the SOURCE: an emitter writes `font-size: 40`
 * and the gate can read it without a browser, because the render scale is
 * exactly 1 everywhere and forever. Under a camera that stops being true — the
 * same 40 in the same emitter renders at 40px, 8px or 200px depending on which
 * framing you are in — so the rule has to be evaluated, not read.
 *
 * The rule this implements:
 *
 *   For every STOP time t_s and every text node n:
 *       effectiveOpacity(n, t_s) == 0   OR   finalPx(n, t_s) >= 40
 *   where finalPx = computed font-size x the element's total on-screen scale,
 *   measured from the rendered box rather than derived from the transform
 *   chain, and effectiveOpacity is the product of computed opacity up the
 *   ancestor chain (plus display/visibility).
 *
 *   Transit is exempt. It is exempt because the deck never RESTS between stops:
 *   every landing point in the island is a stop, and `planTransition` already
 *   guarantees a move is played through, never paused inside.
 *
 * This script reports, per sampled time, every violation — so a passing run is
 * evidence and a failing run names the element.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { open, loadComp } from "./browser.mjs";

const project = process.argv[2];
const extra = process.argv.slice(3).map(Number);

const html = await readFile(join(project, "index.html"), "utf8");
const islandMatch = html.match(
  /<script type="application\/hyperframes-slideshow\+json">([\s\S]*?)<\/script>/,
);
const island = islandMatch ? JSON.parse(islandMatch[1].replace(/\\u003c/g, "<")) : { slides: [] };

/** The stop list, exactly as `buildStops` in src/deck/runtime.ts derives it. */
const stops = [];
for (const s of island.slides) {
  const frags = [...new Set(s.fragments ?? [])].sort((a, b) => a - b);
  const [landing, ...rest] = frags;
  stops.push({ t: landing ?? s.startTime, sceneId: s.sceneId, fragment: 0 });
  rest.forEach((t, i) => stops.push({ t, sceneId: s.sceneId, fragment: i + 1 }));
}

const PROBE = (times) => {
  const FLOOR = 40;
  const results = [];
  for (const t of times) {
    for (const [k, tl] of Object.entries(window.__timelines)) {
      const el = document.querySelector(`[data-composition-id="${k}"]`);
      const start = Number(el?.getAttribute("data-start") ?? 0);
      tl.seek(Math.max(0, t - start));
    }

    const effOpacity = (el) => {
      let o = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === "none" || s.visibility === "hidden") return 0;
        o *= Number.parseFloat(s.opacity);
        if (o === 0) return 0;
      }
      return o;
    };

    /** Rendered size over authored size, measured from the box, not the matrix. */
    const scaleOf = (el) => {
      const r = el.getBoundingClientRect();
      if (el.namespaceURI === "http://www.w3.org/2000/svg" && el.getBBox) {
        const b = el.getBBox();
        if (b.width > 0.5) return r.width / b.width;
        if (b.height > 0.5) return r.height / b.height;
        return null;
      }
      if (el.offsetWidth > 0) return r.width / el.offsetWidth;
      if (el.offsetHeight > 0) return r.height / el.offsetHeight;
      return null;
    };

    const rows = [];
    const nodes = document.querySelectorAll("text, tspan, h1, h2, h3, p, div, span, td, th, li");
    for (const el of nodes) {
      // Only elements that directly own visible text.
      const own = [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
      );
      if (!own) continue;
      const o = effOpacity(el);
      const fs = Number.parseFloat(getComputedStyle(el).fontSize);
      const sc = scaleOf(el);
      if (sc === null || !Number.isFinite(fs)) continue;
      const final = fs * sc;
      const r = el.getBoundingClientRect();
      const onScreen = r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
      rows.push({
        id: el.id || el.parentElement?.id || el.tagName,
        text: (el.textContent || "").trim().slice(0, 26),
        authored: Math.round(fs * 10) / 10,
        scale: Math.round(sc * 1000) / 1000,
        final: Math.round(final * 10) / 10,
        opacity: Math.round(o * 1000) / 1000,
        onScreen,
      });
    }
    const visible = rows.filter((r) => r.opacity > 0.01 && r.onScreen);
    results.push({
      t,
      visibleTextNodes: visible.length,
      minFinal: visible.length ? Math.min(...visible.map((r) => r.final)) : null,
      maxFinal: visible.length ? Math.max(...visible.map((r) => r.final)) : null,
      violations: visible
        .filter((r) => r.final < FLOOR - 0.5)
        .map((r) => ({ id: r.id, text: r.text, authored: r.authored, scale: r.scale, final: r.final, opacity: r.opacity })),
    });
  }
  return results;
};

const { browser, page } = await open();
await loadComp(page, pathToFileURL(join(project, "index.html")).href);
const stopTimes = stops.map((s) => s.t);
const atStops = await page.evaluate(PROBE, stopTimes);
const inTransit = extra.length ? await page.evaluate(PROBE, extra) : [];
await browser.close();

console.log(
  JSON.stringify(
    {
      project,
      stops: stops.length,
      atStops: atStops.map((r, i) => ({ ...r, sceneId: stops[i].sceneId, fragment: stops[i].fragment })),
      inTransit,
      verdict: atStops.every((r) => r.violations.length === 0) ? "PASS" : "FAIL",
    },
    null,
    1,
  ),
);
