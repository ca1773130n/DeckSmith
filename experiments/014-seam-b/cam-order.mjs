/**
 * Is the SHIPPED camera's memo order-dependent?
 *
 * `dsFrame()` (src/emit/camera.ts, `cameraPreamble`) measures on the dive
 * tween's first render and memoises. `hyperframes render` hands each worker a
 * CONTIGUOUS frame range and its own browser — `distributeFrames` in
 * hyperframes' cli.js — so worker k's FIRST seek is at `startFrame/fps`, not at
 * zero. That makes "the tween's first render" a different instant per worker,
 * and the memo is taken there.
 *
 * This drives a real built deck the way the runtime drives it —
 * `totalTime(t, suppressEvents)` — from the four first-seek positions four
 * workers would actually start from, and reads back the rig's transform at the
 * landing. Usage:  node cam-order.mjs <built-deck-dir> [sid]
 */
import { homedir } from "node:os";
import { join } from "node:path";

const DECK = process.argv[2] ?? "/tmp/seamb-cam";
const SID = process.argv[3] ?? "s1";
/** The landing, and a mid-flight frame. Both inside the dive's tail. */
const READ_AT = [9.9, 10.2, 10.4, 10.79];
/** Where a worker's first seek lands: cold, before the dive, mid-dive, past the
 *  scene entirely. 594 frames / 4 workers puts one boundary at t=9.9. */
const FIRST_SEEK = [null, 4.97, 9.9, 10.4, 14.87, 19.7];

async function chromePath() {
  if (process.env.DECKSMITH_CHROME) return process.env.DECKSMITH_CHROME;
  const { getInstalledBrowsers } = await import("@puppeteer/browsers");
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir });
  const found =
    installed.find((b) => b.browser === "chrome-headless-shell") ??
    installed.find((b) => b.browser === "chrome");
  if (!found) throw new Error("no chrome installed");
  return found.executablePath;
}

const RIG = `(sid) => {
  const z = document.querySelector('#' + sid + ' .ds-zoom');
  const p = document.querySelector('#' + sid + ' .ds-pan');
  const m = (el) => el ? getComputedStyle(el).transform : 'missing';
  return 'zoom=' + m(z) + ' pan=' + m(p) + ' op=' + (z ? getComputedStyle(z).opacity : '-');
}`;

async function run() {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    args: ["--allow-file-access-from-files", "--hide-scrollbars"],
  });
  const out = {};
  for (const first of FIRST_SEEK) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(`file://${DECK}/index.html`, { waitUntil: "load" });
    await page.waitForFunction("window.__hfTimelinesBuilding === false", { timeout: 20000 });
    const seek = (t) =>
      page.evaluate(
        (s, time) => {
          const tl = window.__timelines[s];
          tl.totalTime(Math.min(time, tl.duration()), true);
        },
        SID,
        t,
      );
    // A worker's very first seek, if it has one. Everything after is the same.
    if (first !== null) await seek(first);
    const row = {};
    for (const t of READ_AT) {
      await seek(t);
      row[t] = await page.evaluate(`(${RIG})('${SID}')`);
    }
    out[first === null ? "cold" : `first@${first}`] = row;
    await page.close();
  }
  await browser.close();

  const base = out.cold;
  const diffs = [];
  for (const [k, row] of Object.entries(out)) {
    for (const t of READ_AT) if (row[t] !== base[t]) diffs.push({ order: k, t, got: row[t], cold: base[t] });
  }
  console.log(JSON.stringify({ deck: DECK, sid: SID, out, orderStable: diffs.length === 0, diffs }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
