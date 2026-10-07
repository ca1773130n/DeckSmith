/**
 * Measure the Latin faces the v2 style packs set, and write `src/emit/faces.ts`.
 *
 * `scripts/measure-type.mjs` derives Inter's table in svg.ts. This is the same
 * method for the faces a pack can choose — Source Serif 4, Space Grotesk and IBM
 * Plex Sans — with one difference that matters: the face is read out of the
 * VENDORED `@fontsource-variable/*` package, which is the exact file a built deck
 * ships (`vendorFace` in src/build/files.ts), not out of Google's endpoint. No
 * network is needed.
 *
 *     npm run build && node scripts/measure-faces.mjs [--write] [corpus.json ...]
 *
 * WHAT IT MEASURES, PER FACE
 *
 *  - `advance`: the isolated advance of every character svg.ts tabulates,
 *    kerning, `calt` and `liga` off, at 400/500/600/700, divided by that
 *    weight's factor, max over the weights, rounded UP at 3dp. Exactly Inter's
 *    recipe, so `textWidth`'s promise — never under-predict — carries over.
 *  - `weight`: the mean advance ratio against 400, rounded DOWN at 3dp. Any
 *    factor keeps the bound true, because `advance` is divided by the same
 *    number; the measured mean is what keeps it tight.
 *  - `tabularFigure` / `tabularSeparator`: under `font-variant-numeric:
 *    tabular-nums`, which `data-table` sets. A face with no `tnum` feature sets
 *    proportional figures there, and this measures whatever the browser draws.
 *  - `kernSlack`: the worst ratio of a SHAPED run (kerning on, as decks draw it)
 *    to the per-character prediction, over every string in the corpus and its
 *    uppercase, at every weight. Rounded up; never below 1.
 *
 * THE FALLBACK IS PART OF THE FACE. A pack's stack is `"<face>", "Inter", ...`
 * and every Latin deck vendors Inter, so a glyph the face lacks is drawn by
 * Inter. The measuring page declares the same pair, so a missing glyph is
 * measured as what will really draw it rather than as this machine's fallback.
 * The run aborts if the face and a deliberately absent family measure the same.
 *
 * It also prints, per face, the mean and worst over-prediction across the
 * corpus (`fit error`) beside Inter's, and the drawn widths `test/svg.test.ts`
 * pins.
 */
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getInstalledBrowsers } from "@puppeteer/browsers";
import puppeteer from "puppeteer-core";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(REPO, "package.json"));
const WRITE = process.argv.includes("--write");
const EXTRA = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** The same character set `measure-type.mjs` tabulates for Inter. */
const CHARS = [
  ...Array.from({ length: 0x7e - 0x20 }, (_, i) => String.fromCodePoint(0x21 + i)),
  ..."·—–…×÷°±≈≤≥→←↑↓↔⟶“”‘’«»€£¥§¶†‡•‰′″",
  ..."ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ",
  " ",
];
const WEIGHTS = [400, 500, 600, 700];

/** id → [npm package, family as the package declares it, family as decks name it]. */
const FACES = {
  inter: ["@fontsource-variable/inter", "Inter Variable", "Inter"],
  "source-serif-4": [
    "@fontsource-variable/source-serif-4",
    "Source Serif 4 Variable",
    "Source Serif 4",
  ],
  "space-grotesk": [
    "@fontsource-variable/space-grotesk",
    "Space Grotesk Variable",
    "Space Grotesk",
  ],
  "ibm-plex-sans": [
    "@fontsource-variable/ibm-plex-sans",
    "IBM Plex Sans Variable",
    "IBM Plex Sans",
  ],
};

/** Strings `test/svg.test.ts` pins drawn widths for, per face. */
const PINS = [
  ["Reconstruction", 64, 700],
  ["MEASURED AGAINST THE BROWSER", 42, 500],
  ["Latency drops 38% at 2× throughput", 40, 400],
  ["Wolf Tavern — 29.88", 40, 600],
];

/** `@font-face` rules for one package, every url inlined, family renamed. */
function faceCss(id) {
  const [pkg, declared, named] = FACES[id];
  const dir = dirname(require.resolve(`${pkg}/index.css`));
  const css = readFileSync(join(dir, "index.css"), "utf8");
  return css
    .replaceAll(`font-family: '${declared}'`, `font-family: '${named}'`)
    .replace(/url\(\.\/files\/([^)]+)\) format\('woff2-variations'\)/g, (_, f) => {
      const b64 = readFileSync(join(dir, "files", f)).toString("base64");
      return `url(data:font/woff2;base64,${b64}) format('woff2')`;
    });
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

/** Every string the demo sets, plus every extra corpus file, uppercased and split. */
async function corpus() {
  const seen = new Set();
  const walk = (v) => {
    if (typeof v === "string") {
      if (!v.trim() || v.length > 400) return;
      for (const s of [v, ...v.split(/\s+/).filter(Boolean)]) {
        seen.add(s);
        seen.add(s.toUpperCase());
      }
    } else if (Array.isArray(v)) for (const x of v) walk(x);
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
  };
  for (const f of ["demo/storyboard.json", "demo/source.json", ...EXTRA]) {
    walk(JSON.parse(await readFile(f.startsWith("/") ? f : join(REPO, f), "utf8")));
  }
  return [...seen].filter((s) => [...s].every((c) => CHARS.includes(c)));
}

const up3 = (x) => Math.ceil(x * 1000 - 1e-9) / 1000;
const down3 = (x) => Math.floor(x * 1000 + 1e-9) / 1000;

const runs = await corpus();
const browser = await puppeteer.launch({ executablePath: await chrome(), headless: true });
const results = {};
try {
  const tab = await browser.newPage();
  await tab.setContent(
    `<!doctype html><meta charset="utf-8"><style>${Object.keys(FACES).map(faceCss).join("\n")}
body{margin:0}span{position:absolute;white-space:pre;font-size:1000px}</style>`,
  );
  await tab.evaluate(
    async (names, weights) => {
      for (const n of names)
        for (const w of weights) await document.fonts.load(`${w} 100px "${n}"`, "AaĀ→");
      await document.fonts.ready;
    },
    Object.values(FACES).map((f) => f[2]),
    WEIGHTS,
  );

  for (const id of Object.keys(FACES)) {
    const family = FACES[id][2];
    // The face, then Inter: what a pack's stack draws a missing glyph with.
    const stack = id === "inter" ? '"Inter"' : `"${family}", "Inter"`;
    const loaded = await tab.evaluate((stack) => {
      const el = document.createElement("span");
      el.textContent = "Rag MMMM wiq 0123";
      el.style.fontFamily = stack;
      document.body.appendChild(el);
      const a = el.getBoundingClientRect().width;
      el.style.fontFamily = "__no_such_family__";
      const b = el.getBoundingClientRect().width;
      el.remove();
      return a !== b;
    }, stack);
    if (!loaded)
      throw new Error(`${family} did not load — every number would be the fallback face`);

    const adv = await tab.evaluate(
      (stack, chars, weights) => {
        const el = document.createElement("span");
        el.style.fontFamily = stack;
        el.style.fontKerning = "none";
        el.style.fontFeatureSettings = '"kern" 0, "calt" 0, "liga" 0';
        document.body.appendChild(el);
        const out = {};
        for (const w of weights)
          for (const tab of [false, true])
            for (const c of chars) {
              el.style.fontWeight = String(w);
              el.style.fontVariantNumeric = tab ? "tabular-nums" : "normal";
              el.textContent = c;
              out[`${w}|${tab ? "T" : "P"}|${c}`] = el.getBoundingClientRect().width / 1000;
            }
        el.remove();
        return out;
      },
      stack,
      CHARS,
      WEIGHTS,
    );
    const shaped = await tab.evaluate(
      (stack, items, weights, pins) => {
        const el = document.createElement("span");
        el.style.fontFamily = stack;
        document.body.appendChild(el);
        const out = [];
        for (const w of weights) {
          el.style.fontWeight = String(w);
          for (const s of items) {
            el.textContent = s;
            out.push({ w, s, whole: el.getBoundingClientRect().width / 1000 });
          }
        }
        const drawn = pins.map(([s, size, w]) => {
          el.style.fontWeight = String(w);
          el.style.fontSize = `${size}px`;
          el.textContent = s;
          return el.getBoundingClientRect().width;
        });
        el.remove();
        return { out, drawn };
      },
      stack,
      runs,
      WEIGHTS,
      PINS,
    );
    results[id] = { adv, shaped };
  }
} finally {
  await browser.close();
}

/* ------------------------------------------------------------------- derive */

const derived = {};
for (const [id, { adv, shaped }] of Object.entries(results)) {
  const weight = {};
  for (const w of WEIGHTS) {
    const rs = CHARS.map((c) => adv[`${w}|P|${c}`] / adv[`400|P|${c}`]).filter(
      (r) => Number.isFinite(r) && r > 0,
    );
    weight[w] = w === 400 ? 1 : down3(rs.reduce((a, b) => a + b, 0) / rs.length);
  }
  const best = (c, mode) =>
    Math.max(...WEIGHTS.map((w) => (adv[`${w}|${mode}|${c}`] ?? 0) / weight[w]));
  const advance = {};
  for (const c of CHARS) advance[c] = up3(best(c, "P"));
  const tabularFigure = Math.max(...[..."0123456789"].map((c) => up3(best(c, "T"))));
  const tabularSeparator = Math.max(up3(best(".", "T")), up3(best(",", "T")));
  const sum = (s) => [...s].reduce((n, c) => n + (advance[c] ?? 1.02), 0);
  const ratios = shaped.out.map((r) => r.whole / (sum(r.s) * weight[r.w]));
  const kernSlack = Math.max(1, up3(Math.max(...ratios)));
  const worstRuns = shaped.out
    .map((r, i) => ({ s: r.s, w: r.w, ratio: ratios[i] }))
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 4);
  const predicted = shaped.out.map((r) => (sum(r.s) * weight[r.w] * kernSlack) / r.whole);
  derived[id] = {
    advance,
    weight,
    tabularFigure,
    tabularSeparator,
    kernSlack,
    fit: {
      mean: predicted.reduce((a, b) => a + b, 0) / predicted.length,
      worst: Math.max(...predicted),
      under: predicted.filter((p) => p < 1).length,
      n: predicted.length,
    },
    drawn: shaped.drawn,
    worstRuns,
  };
}

for (const [id, d] of Object.entries(derived)) {
  console.log(
    `${id.padEnd(15)} weight ${JSON.stringify(d.weight)} tab ${d.tabularFigure}/${d.tabularSeparator} ` +
      `kern ${d.kernSlack}  fit mean ${d.fit.mean.toFixed(4)} worst ${d.fit.worst.toFixed(4)} ` +
      `under ${d.fit.under}/${d.fit.n}`,
  );
  for (const r of d.worstRuns)
    console.log(`  worst ${r.ratio.toFixed(4)} @${r.w} ${JSON.stringify(r.s.slice(0, 60))}`);
  console.log(
    `  drawn ${PINS.map((p, i) => `${JSON.stringify(p[0])}@${p[1]}/${p[2]}=${d.drawn[i].toFixed(2)}`).join("  ")}`,
  );
}

if (WRITE) {
  const faces = Object.entries(derived).filter(([id]) => id !== "inter");
  const body = faces
    .map(([id, d]) => {
      const rows = [];
      let line = "";
      for (const c of CHARS) {
        const entry = `${JSON.stringify(c)}: ${d.advance[c]},`;
        if (`${line} ${entry}`.length > 92) {
          rows.push(`      ${line.trim()}`);
          line = "";
        }
        line += ` ${entry}`;
      }
      if (line.trim()) rows.push(`      ${line.trim()}`);
      return `  "${id}": {
    family: "${FACES[id][2]}",
    weight: { 400: ${d.weight[400]}, 500: ${d.weight[500]}, 600: ${d.weight[600]}, 700: ${d.weight[700]} },
    tabularFigure: ${d.tabularFigure},
    tabularSeparator: ${d.tabularSeparator},
    kernSlack: ${d.kernSlack},
    // biome-ignore format: a measured table reads as a grid.
    advance: {
${rows.join("\n")}
    },
  },`;
    })
    .join("\n");
  const src = `// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured advances; 0.707 is H's width, not 1/sqrt(2).
/**
 * GENERATED by \`node scripts/measure-faces.mjs --write\`. Do not edit by hand.
 *
 * Advance tables for the Latin faces the v2 style packs set, measured in Chrome
 * from the vendored @fontsource-variable packages — the files a built deck
 * ships. Same recipe as Inter's \`ADVANCE\` in svg.ts: isolated advances with
 * kerning off, max over 400/500/600/700 after dividing by that weight's factor,
 * rounded up. \`test/svg.test.ts\` holds the result against drawn widths read
 * out of the same browser. Re-run the script, never re-type a number.
 */
export interface FaceMetrics {
  /** The CSS family a deck names it by — what \`vendorFace\` declares. */
  family: string;
  /** Mean advance ratio against 400, per weight the type scales use. */
  weight: Readonly<Record<400 | 500 | 600 | 700, number>>;
  tabularFigure: number;
  tabularSeparator: number;
  kernSlack: number;
  advance: Readonly<Record<string, number>>;
}

export type MeasuredFace = ${faces.map(([id]) => `"${id}"`).join(" | ")};

export const FACE_METRICS: Readonly<Record<MeasuredFace, FaceMetrics>> = {
${body}
};
`;
  await writeFile(join(REPO, "src/emit/faces.ts"), src);
  console.log("wrote src/emit/faces.ts");
}
