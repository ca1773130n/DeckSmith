/**
 * Does a browser-measured timeline still seek?
 *
 * Loads each variant in a real Chrome, drives the scene timelines the way the
 * HyperFrames runtime drives them — `totalTime(t, suppressEvents)` — and reads
 * back a signature of everything the arrow primitive owns. Then asks the only
 * question that matters: is the signature at time t the same when t is reached
 * from below, from above, out of order, and cold in a fresh page?
 *
 * The runtime is absent here on purpose. A file:// load has no hyperframes
 * runtime, so nothing seeks but this script — which means an ordering effect
 * found here is the composition's, not the engine's. The real capture path is
 * exercised separately by `shots.mjs`.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VARIANTS } from "./emit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Times inside s1: two before the arrow draws, three inside it, one after. */
const TIMES = [0.2, 1.0, 1.6, 1.85, 2.3, 4.0];

async function chromePath() {
  if (process.env.DECKSMITH_CHROME) return process.env.DECKSMITH_CHROME;
  const { getInstalledBrowsers } = await import("@puppeteer/browsers");
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir });
  const found =
    installed.find((b) => b.browser === "chrome-headless-shell") ??
    installed.find((b) => b.browser === "chrome");
  if (!found) throw new Error("no chrome; run `npx puppeteer browsers install chrome`");
  return found.executablePath;
}

/** Everything the primitive wrote or animated, as one string. */
const SIGNATURE = `(sid) => {
  const g = (id) => document.getElementById(id);
  const arrow = g(sid + '-arrow');
  const cs = getComputedStyle(arrow);
  const box = (id) => { const r = g(id).getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100).join(','); };
  return [
    'd=' + arrow.getAttribute('d'),
    'head=' + g(sid + '-head').getAttribute('d'),
    'dash=' + cs.strokeDasharray + '/' + cs.strokeDashoffset,
    'a=' + box(sid === 's1' ? 's1-encoder' : 's2-sampler'),
    'b=' + box(sid === 's1' ? 's1-decoder' : 's2-refiner'),
  ].join(' | ');
}`;

async function openDeck(browser, variant) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto(`file://${join(HERE, "out", variant, "index.html")}`, { waitUntil: "load" });
  // The engine's own barrier, reproduced: nothing may be seeked until the
  // composition says it has stopped building.
  await page.waitForFunction("window.__hfTimelinesBuilding === false", { timeout: 20000 });
  return page;
}

async function seek(page, sid, t) {
  await page.evaluate(
    (s, time) => {
      window.__timelines[s].totalTime(time, true);
    },
    sid,
    t,
  );
}

async function signatureAt(page, sid, t) {
  await seek(page, sid, t);
  return page.evaluate(`(${SIGNATURE})('${sid}')`);
}

async function run() {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    args: ["--allow-file-access-from-files", "--font-render-hinting=none", "--hide-scrollbars"],
  });
  const report = {};
  for (const variant of VARIANTS) {
    const page = await openDeck(browser, variant);
    const cost = await page.evaluate(() => ({
      perScene: window.__dsCost ?? {},
      buildMs: window.__dsBuildMs ?? null,
      readyMs: window.__dsReadyMs ?? null,
    }));

    const asc = {};
    for (const t of TIMES) asc[t] = await signatureAt(page, "s1", t);
    const desc = {};
    for (const t of [...TIMES].reverse()) desc[t] = await signatureAt(page, "s1", t);
    // The order a sharded render produces: a worker starts in the middle of the
    // deck and its very first seek is a late one.
    const jump = {};
    for (const t of [4.0, 0.2, 2.3, 1.0, 1.85, 1.6]) jump[t] = await signatureAt(page, "s1", t);
    await page.close();

    // Cold: a fresh page whose FIRST seek is the time under test. This is the
    // sharded-render case exactly, and no in-page ordering can hide it.
    const cold = {};
    for (const t of TIMES) {
      const p = await openDeck(browser, variant);
      cold[t] = await signatureAt(p, "s1", t);
      await p.close();
    }

    const rows = TIMES.map((t) => ({
      t,
      asc: asc[t],
      desc: desc[t],
      jump: jump[t],
      cold: cold[t],
      agree: asc[t] === desc[t] && asc[t] === jump[t] && asc[t] === cold[t],
    }));
    report[variant] = { cost, rows, seekStable: rows.every((r) => r.agree) };
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
