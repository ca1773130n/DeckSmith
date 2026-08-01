/**
 * Re-derive `ADVANCE`, `TABULAR_*`, `weightFactor` and `KERN_SLACK` in
 * src/emit/svg.ts, in the engine that draws the deck.
 *
 * Those numbers decide whether a beat fits, and every archetype reads them. They
 * were eyeball fits for most of this project's life, and a bucket that is wrong
 * costs either a clipped slide (too narrow) or a refusal of a beat that would
 * have drawn (too wide). This is what makes them checkable rather than folklore:
 *
 *     node scripts/measure-type.mjs
 *
 * Prints the table as it should appear in the source. Paste it, then run
 * `npm run check` — test/svg.test.ts holds the result against ten pinned widths.
 *
 * WHAT IT MEASURES, AND THE TWO TRAPS IN DOING IT.
 *
 *  1. THE ISOLATED ADVANCE, kerning off. `width("nn" + c + "nn") - width("nnnn")`
 *     is NOT the advance — it folds in the n/c kern pair, which Inter sets
 *     negative for the capitals that lean, so T measures 0.528 against a true
 *     0.653 and every all-caps eyebrow then predicts short.
 *  2. THE FACE HAS TO LOAD. A `file://` woff2 is refused as a font subresource
 *     and `font-display: block` serves fallback metrics until something asks for
 *     the face, either of which silently measures SF Pro instead. So the woff2
 *     is inlined as a data: URI, every weight is explicitly loaded, and the run
 *     aborts if Inter and a deliberately absent family measure the same.
 *
 * WHY INTER. A Latin deck ships no font bundle — `familyFor` returns null and
 * HyperFrames resolves Inter itself from its own allowlist (src/source/fonts.ts)
 * — so Inter is what the rendered video is set in. The face comes from the same
 * Google Fonts endpoint `bundleFont` already calls. Needs network and the Chrome
 * `render` already requires.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getInstalledBrowsers } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = join(tmpdir(), "decksmith-type");

/** Everything the deck can set and this table is willing to claim it knows. */
const CHARS = [
  ...Array.from({ length: 0x7e - 0x20 }, (_, i) => String.fromCodePoint(0x21 + i)),
  ..."·—–…×÷°±≈≤≥→←↑↓↔⟶“”‘’«»€£¥§¶†‡•‰′″",
  ..."ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ",
  " ",
];

/** The four the type scale uses. `weightFactor` must answer for exactly these. */
const WEIGHTS = [400, 500, 600, 700];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

async function interWoff2() {
  const out = join(WORK, "inter.woff2");
  if (existsSync(out)) return out;
  await mkdir(WORK, { recursive: true });
  const text = [...new Set([...CHARS, "n"])].sort().join("");
  const res = await fetch(
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700" +
      `&text=${encodeURIComponent(text)}&display=block`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) throw new Error(`google fonts: HTTP ${res.status}`);
  const url = /url\((https:\/\/[^)]+)\)/.exec(await res.text())?.[1];
  if (!url) throw new Error("google fonts returned css with no woff2 in it");
  const bin = await fetch(url, { headers: { "User-Agent": UA } });
  await writeFile(out, Buffer.from(await bin.arrayBuffer()));
  return out;
}

async function chrome() {
  const installed = await getInstalledBrowsers({
    cacheDir: process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer"),
  });
  const found =
    installed.find((b) => b.browser === "chrome-headless-shell") ??
    installed.find((b) => b.browser === "chrome");
  if (!found) throw new Error("no Chrome. `npx puppeteer browsers install chrome`");
  return found.executablePath;
}

/** Every string the demo sets, plus its uppercase and its words. */
async function runs() {
  const seen = new Set();
  const walk = (v) => {
    if (typeof v === "string") {
      if (!v.trim()) return;
      for (const s of [v, v.toUpperCase(), ...v.split(/\s+/).filter(Boolean)]) {
        seen.add(s);
        seen.add(s.toUpperCase());
      }
    } else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  for (const f of ["demo/storyboard.json", "demo/source.json"]) {
    walk(JSON.parse(await readFile(join(REPO, f), "utf8")));
  }
  return [...seen].filter((s) => [...s].every((c) => CHARS.includes(c)));
}

const b64 = (await readFile(await interWoff2())).toString("base64");
const page = join(WORK, "measure.html");
await writeFile(
  page,
  `<!doctype html><meta charset="utf-8"><style>
${WEIGHTS.map(
  (w) =>
    `@font-face{font-family:Inter;font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2');}`,
).join("\n")}
body{margin:0}span{position:absolute;white-space:pre;font-family:Inter;font-size:1000px}</style>`,
);

const browser = await puppeteer.launch({ executablePath: await chrome(), headless: true });
const tab = await browser.newPage();
await tab.goto(pathToFileURL(page).href, { waitUntil: "load" });
await tab.evaluate(async (weights) => {
  await Promise.all(weights.map((w) => document.fonts.load(`${w} 100px Inter`)));
  await document.fonts.ready;
}, WEIGHTS);
const loaded = await tab.evaluate(() => {
  const el = document.createElement("span");
  el.textContent = "MMMM";
  document.body.appendChild(el);
  const a = el.getBoundingClientRect().width;
  el.style.fontFamily = "__no_such_family__";
  const b = el.getBoundingClientRect().width;
  el.remove();
  return a !== b;
});
if (!loaded) throw new Error("Inter did not load — every number would be the fallback face");

const advances = await tab.evaluate(
  (chars, weights) => {
    const el = document.createElement("span");
    el.style.fontKerning = "none";
    el.style.fontFeatureSettings = '"kern" 0, "calt" 0, "liga" 0';
    document.body.appendChild(el);
    const at = (s, weight, tabular) => {
      el.style.fontWeight = String(weight);
      el.style.fontVariantNumeric = tabular ? "tabular-nums" : "normal";
      el.textContent = s;
      return el.getBoundingClientRect().width / 1000;
    };
    const out = {};
    for (const weight of weights)
      for (const tabular of [false, true])
        for (const c of chars)
          out[`${weight}|${tabular ? "T" : "P"}|${c}`] = at(c, weight, tabular);
    el.remove();
    return out;
  },
  CHARS,
  WEIGHTS,
);

const corpus = await runs();
const shaped = await tab.evaluate(
  (items, weights) => {
    const el = document.createElement("span");
    document.body.appendChild(el);
    const out = [];
    for (const weight of weights) {
      el.style.fontWeight = String(weight);
      for (const s of items) {
        el.textContent = s;
        out.push({ weight, s, whole: el.getBoundingClientRect().width / 1000 });
      }
    }
    el.remove();
    return out;
  },
  corpus,
  WEIGHTS,
);
await browser.close();

/* ------------------------------------------------------------------- report */

/** Must match `weightFactor` in src/emit/svg.ts. The two are one unit. */
const factor = (w) => (w >= 700 ? 1.045 : w >= 600 ? 1.03 : w >= 500 ? 1.015 : 1);
const up3 = (x) => Math.ceil(x * 1000) / 1000;
const best = (c, mode) =>
  Math.max(...WEIGHTS.map((w) => (advances[`${w}|${mode}|${c}`] ?? 0) / factor(w)));

const table = {};
for (const c of CHARS) if (best(c, "P") > 0) table[c] = up3(best(c, "P"));

console.log("/* paste into ADVANCE in src/emit/svg.ts */");
for (const [title, set] of [
  ["digits, PROPORTIONAL — see `TABULAR_FIGURE` for a table's", "0123456789.,"],
  ["capitals", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
  ["lowercase", "abcdefghijklmnopqrstuvwxyz"],
  ["ASCII punctuation", "!\"#$%&'()*+-/:;<=>?@[\\]^_`{|}~ "],
  ["dashes, arrows, marks", "·—–…×÷°±≈≤≥→←↑↓↔⟶“”‘’«»€£¥§¶†‡•‰′″"],
  [
    "Latin-1 letters — the accent rides above, so ï advances exactly as i does",
    "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ",
  ],
]) {
  console.log(`  /* ${title} */`);
  let line = "";
  for (const c of [...set].filter((c) => table[c] !== undefined)) {
    const entry = `${JSON.stringify(c)}: ${table[c]},`;
    if (`${line} ${entry}`.length > 94) {
      console.log(`  ${line.trim()}`);
      line = "";
    }
    line += ` ${entry}`;
  }
  if (line.trim()) console.log(`  ${line.trim()}`);
}

const figures = [..."0123456789"].map((c) => up3(best(c, "T")));
console.log(
  `\nTABULAR_FIGURE    = ${Math.max(...figures)}   (all ten agree: ${new Set(figures).size === 1})`,
);
console.log(`TABULAR_SEPARATOR = ${Math.max(up3(best(".", "T")), up3(best(",", "T")))}`);

console.log("\nweightFactor, measured as the mean advance ratio against 400:");
for (const w of WEIGHTS.slice(1)) {
  const rs = CHARS.map((c) => advances[`${w}|P|${c}`] / advances[`400|P|${c}`]).filter(
    (r) => Number.isFinite(r) && r > 0,
  );
  console.log(
    `  ${w}: ${(rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(4)}   (code says ${factor(w)})`,
  );
}

const excess = shaped
  .map((r) => ({
    ...r,
    ratio: r.whole / ([...r.s].reduce((n, c) => n + (table[c] ?? 1.02), 0) * factor(r.weight)),
  }))
  .sort((a, b) => b.ratio - a.ratio);
const over = excess.filter((r) => r.ratio > 1);
console.log(
  `\nKERN_SLACK must be >= ${up3(excess[0].ratio)}` +
    `   (${over.length} of ${excess.length} runs exceed their sum; worst ${excess[0].ratio.toFixed(4)} on ${JSON.stringify(excess[0].s.slice(0, 40))})`,
);
