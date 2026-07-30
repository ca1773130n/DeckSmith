// src/render/captions.ts
import { mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
import { pathToFileURL } from "node:url";

// src/deck/subtitles.ts
var CUE_MAX_CHARS = 84;
function pack(words, width) {
  const lines = [];
  let line2 = "";
  for (const word of words) {
    if (line2 === "") line2 = word;
    else if (line2.length + 1 + word.length <= width) line2 += ` ${word}`;
    else {
      lines.push(line2);
      line2 = word;
    }
  }
  if (line2 !== "") lines.push(line2);
  return lines;
}
function splitCue(cue, max = CUE_MAX_CHARS) {
  if (cue.text.length <= max) return [cue];
  const words = cue.text.split(/\s+/).filter(Boolean);
  const count = pack(words, max).length;
  let width = max;
  for (let w = Math.ceil(cue.text.length / count); w < max; w++) {
    if (pack(words, w).length <= count) {
      width = w;
      break;
    }
  }
  const chunks = pack(words, width);
  if (chunks.length < 2) return [cue];
  const total = chunks.reduce((n2, c) => n2 + c.length, 0);
  const span = cue.end - cue.start;
  let at = cue.start;
  return chunks.map((text2, i) => {
    const end = i === chunks.length - 1 ? cue.end : at + span * text2.length / total;
    const piece = { start: at, end, text: text2 };
    at = end;
    return piece;
  });
}

// src/emit/svg.ts
var MIN_FONT = 40;
function charUnits(c) {
  if (c === " ") return 0.3;
  const code = c.codePointAt(0) ?? 0;
  if (code > 11903) return 1.02;
  if (c >= "0" && c <= "9" || c === "." || c === ",") return 0.6;
  if ("MW@%".includes(c)) return 0.95;
  if ("mw".includes(c)) return 0.88;
  if ("ijltI:;'`|!()[]".includes(c)) return 0.33;
  if (c >= "A" && c <= "Z") return 0.72;
  if (code >= 192 && code <= 223) return 0.72;
  return 0.56;
}
function weightFactor(weight) {
  return weight >= 700 ? 1.07 : weight >= 600 ? 1.04 : 1;
}
function textWidth(text2, fontSize, weight = 400) {
  let units = 0;
  for (const c of text2) units += charUnits(c);
  return units * fontSize * weightFactor(weight);
}
function wrap(text2, fontSize, maxWidth, weight = 400) {
  if (maxWidth <= 0) return [text2];
  const lines = [];
  let line2 = "";
  const push = () => {
    if (line2) lines.push(line2);
    line2 = "";
  };
  for (const word of text2.split(/\s+/).filter(Boolean)) {
    const candidate = line2 ? `${line2} ${word}` : word;
    if (textWidth(candidate, fontSize, weight) <= maxWidth) {
      line2 = candidate;
      continue;
    }
    push();
    if (textWidth(word, fontSize, weight) <= maxWidth) {
      line2 = word;
      continue;
    }
    for (const c of word) {
      if (line2 && textWidth(line2 + c, fontSize, weight) > maxWidth) push();
      line2 += c;
    }
  }
  push();
  return lines.length > 0 ? lines : [text2];
}

// src/emit/themes/ink.ts
var ink = {
  bg: "#0b0d10",
  fg: "#e8eaed",
  muted: "#9aa7b5",
  dim: "#74808e",
  rule: "#2b333d",
  panel: "#16191e",
  accent: "#3d8bfd",
  tones: { a: "#7cc4ff", b: "#ffd166", c: "#f78da7", d: "#6ee7a8" },
  fontStack: '"Inter", system-ui, sans-serif'
};

// src/emit/themes/mono.ts
var mono = {
  bg: "#ffffff",
  fg: "#0a0a0a",
  muted: "#3a3a3a",
  dim: "#5e5e5e",
  rule: "#b0b0b0",
  panel: "#f4f4f4",
  accent: "#c8102e",
  tones: { a: "#c8102e", b: "#0a0a0a", c: "#464646", d: "#6f6f6f" },
  fontStack: '"Inter", system-ui, sans-serif',
  bodyWeight: 500
};

// src/emit/themes/paper.ts
var paper = {
  // Warm, not white: #fff under a projector is a lamp pointed at the audience.
  bg: "#faf7f2",
  fg: "#14110d",
  muted: "#57503f",
  dim: "#6b6252",
  rule: "#ded7c9",
  // A half-step off the ground. Anything darker reads as a hole in the slide,
  // and drags every tone drawn on it below AA.
  panel: "#f3eee5",
  accent: "#1f5fa8",
  tones: { a: "#1b5fa8", b: "#8a5000", c: "#a8203f", d: "#1c6b45" },
  fontStack: '"Inter", system-ui, sans-serif'
};

// src/emit/themes/index.ts
var THEMES = { ink, mono, paper };
var THEME_NAMES = Object.keys(THEMES).sort();

// src/emit/archetypes/title.ts
var EYEBROW_SIZE = 42;
var EYEBROW_LH = 1.2;
var EYEBROW_H = Math.round(EYEBROW_SIZE * EYEBROW_LH) + 22;
var HEADLINE_SIZE = 76;
var HEADLINE_LH = 1.15;
var HEADLINE_H = Math.round(HEADLINE_SIZE * HEADLINE_LH);
var BODY_SIZE = 44;
var BODY_LH = 1.45;
function noteHeight(note, width, top = 34) {
  if (!note) return 0;
  return wrap(note, BODY_SIZE, width).length * Math.round(BODY_SIZE * BODY_LH) + top;
}

// src/emit/archetypes/annotated-figure.ts
var LAB = MIN_FONT;
var LAB_LH = 1.3;
var ASCENT = LAB * 0.78;
var LAB_GAP = Math.round(LAB * LAB_LH) + 12;

// src/emit/archetypes/bar-compare.ts
var CHROME_H = { with: EYEBROW_H + HEADLINE_H, without: HEADLINE_H };
var NOTE_H = noteHeight("x", MIN_FONT, 26);

// src/emit/archetypes/claim-figure.ts
var CAP_BAND = 26 + 2 * 58;
var CLAIM_RULE = 6 + 32;

// src/source/fonts.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
function familyFor(lang) {
  const tag = lang.toLowerCase();
  if (tag.startsWith("ko")) return "Noto Sans KR";
  if (tag.startsWith("ja")) return "Noto Sans JP";
  if (tag.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(tag) ? "Noto Sans TC" : "Noto Sans SC";
  return null;
}
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
async function bundleFont(lang, glyphs, dir) {
  const family = familyFor(lang);
  if (!family) return null;
  const text2 = [...new Set(glyphs)].filter((c) => c > " ").sort().join("");
  const stamp = `/* decksmith ${createHash("sha256").update(`${family}
${text2}`).digest("hex").slice(0, 16)} */`;
  await mkdir(dir, { recursive: true });
  const cssPath = join(dir, "fonts.css");
  const cached = await readFile(cssPath, "utf8").catch(() => "");
  if (cached.startsWith(stamp)) return { family, css: cached, files: localNames(cached) };
  const res = await fetch(
    `https://fonts.googleapis.com/css2?family=${family.replaceAll(" ", "+")}:wght@400;500;700&text=${encodeURIComponent(text2)}&display=block`,
    { headers: { "User-Agent": UA } }
  );
  if (!res.ok) throw new Error(`google fonts: HTTP ${res.status}`);
  let css = await res.text();
  const remote = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1] ?? ""))];
  const slug = family.toLowerCase().replace(/[^a-z0-9]/g, "");
  const files = [];
  for (const [i, url] of remote.entries()) {
    const font = await fetch(url);
    if (!font.ok) throw new Error(`${url}: HTTP ${font.status}`);
    const name = `${slug}-${i}.woff2`;
    await writeFile(join(dir, name), Buffer.from(await font.arrayBuffer()));
    css = css.replaceAll(url, name);
    files.push(name);
  }
  css = `${stamp}
${css}`;
  await writeFile(cssPath, css);
  return { family, css, files };
}
function localNames(css) {
  return [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1] ?? "");
}

// src/render/timing.ts
var WIDE = /[ᄀ-ᇿ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠￠-￦]/u;
function cueMax(text2, max = CUE_MAX_CHARS) {
  const chars = [...text2];
  const wide = chars.filter((c) => WIDE.test(c)).length;
  if (wide === 0) return max;
  const em = 0.485 + (0.8 - 0.485) * (wide / chars.length);
  return Math.max(24, Math.round(max * 0.485 / em));
}
function wrap2(text2, max = Math.floor(cueMax(text2) / 2)) {
  if (text2.length <= max) return text2;
  const words = text2.split(/\s+/).filter(Boolean);
  if (words.length < 2) return text2;
  const middle = text2.length / 2;
  let best = 1;
  let bestGap = Number.POSITIVE_INFINITY;
  let at = 0;
  for (let i = 0; i < words.length - 1; i++) {
    at += words[i].length + (i > 0 ? 1 : 0);
    const gap = Math.abs(at - middle);
    if (gap < bestGap) {
      bestGap = gap;
      best = i + 1;
    }
  }
  return `${words.slice(0, best).join(" ")}
${words.slice(best).join(" ")}`;
}

// src/render/captions.ts
var DECK_FONT_CSS = "assets/fonts/fonts.css";
function cssString(value) {
  return `"${value.replace(/["\\]/g, "")}"`;
}
function escapeHtml(text2) {
  return text2.replace(/[&<>]/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;");
}
function captionPage(cues, style, fontHref) {
  const stack2 = [cssString(style.font), '"Helvetica Neue"', "Helvetica", "Arial", "sans-serif"];
  const padY = Math.round(style.fontSize * 0.2);
  const padX = Math.round(style.fontSize * 0.35);
  const link = fontHref ? `<link rel="stylesheet" href="${fontHref}">` : "";
  const bands = cues.map((cue, i) => `<div class="cue" id="c${i}"><span>${escapeHtml(wrap2(cue.text))}</span></div>`).join("\n");
  return `<!doctype html>
<meta charset="utf-8">
${link}
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  #stage {
    position: relative;
    width: ${style.width}px;
    height: ${style.height}px;
    overflow: hidden;
  }
  .cue {
    position: absolute;
    left: ${style.marginX}px;
    right: ${style.marginX}px;
    bottom: ${style.marginV}px;
    visibility: hidden;
    text-align: center;
    font-family: ${stack2.join(", ")};
    font-size: ${style.fontSize}px;
    font-weight: 700;
    line-height: var(--line, ${Math.round(style.fontSize * 1.6)}px);
  }
  .cue.on { visibility: visible; }
  .cue span {
    display: inline;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    /* 70% OPAQUE. Measured against both a dark and a light slide: 50% loses the
       text over a light figure, 100% reads as a hole cut in the picture. */
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    padding: ${padY}px ${padX}px;
    white-space: pre-wrap;
  }
</style>
<div id="stage">
${bands}
</div>
`;
}
function measure(count) {
  const doc = document;
  const probe = doc.getElementById("c0");
  if (probe) {
    probe.classList.add("on");
    const span = probe.querySelector("span");
    const before = span.textContent ?? "";
    span.textContent = "Hg";
    doc.documentElement.style.setProperty("--line", `${span.getBoundingClientRect().height}px`);
    span.textContent = before;
    probe.classList.remove("on");
  }
  const rects = [];
  for (let i = 0; i < count; i++) {
    const el = doc.getElementById(`c${i}`);
    if (!el) continue;
    el.classList.add("on");
    const r = el.querySelector("span").getBoundingClientRect();
    el.classList.remove("on");
    rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
  }
  return rects;
}
async function chromePath() {
  const explicit = process.env.DECKSMITH_CHROME || process.env.CHROME_PATH;
  if (explicit) return explicit;
  const { getInstalledBrowsers } = await import("@puppeteer/browsers");
  const cacheDir = process.env.PUPPETEER_CACHE_DIR || join2(homedir(), ".cache", "puppeteer");
  const installed = await getInstalledBrowsers({ cacheDir }).catch(() => []);
  const found = installed.find((b) => b.browser === "chrome-headless-shell") ?? installed.find((b) => b.browser === "chrome");
  if (found) return found.executablePath;
  throw new Error(
    "no Chrome to draw the captions with. `render` needs one for the capture too; run `npx puppeteer browsers install chrome`, or set DECKSMITH_CHROME to a Chrome binary."
  );
}
async function renderCaptions(cues, style, deck, work) {
  if (cues.length === 0) throw new Error("renderCaptions was given no cues.");
  const fontCss = join2(deck, DECK_FONT_CSS);
  const href = await import("node:fs/promises").then((fs) => fs.stat(fontCss).catch(() => null)) ? pathToFileURL(fontCss).href : null;
  const page = join2(work, "captions.html");
  await mkdir2(work, { recursive: true });
  await writeFile2(page, captionPage(cues, style, href));
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: await chromePath(),
    headless: true,
    args: ["--force-device-scale-factor=1", "--hide-scrollbars"]
  });
  try {
    const tab = await browser.newPage();
    await tab.setViewport({ width: style.width, height: style.height, deviceScaleFactor: 1 });
    await tab.goto(pathToFileURL(page).href, { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
    const rects = await tab.evaluate(measure, cues.length);
    const box = union(rects);
    const files = [];
    for (const [i, cue] of cues.entries()) {
      void cue;
      const name = `cap${String(i).padStart(4, "0")}.png`;
      await tab.evaluate((id2) => document.getElementById(id2)?.classList.add("on"), `c${i}`);
      await tab.screenshot({
        path: join2(work, name),
        type: "png",
        omitBackground: true,
        clip: { x: box.x, y: box.y, width: box.width, height: box.height }
      });
      await tab.evaluate((id2) => document.getElementById(id2)?.classList.remove("on"), `c${i}`);
      files.push(name);
    }
    return { files, ...box };
  } finally {
    await browser.close();
  }
}
function union(rects) {
  const left = Math.floor(Math.min(...rects.map((r) => r.x)));
  const top = Math.floor(Math.min(...rects.map((r) => r.y)));
  const right = Math.ceil(Math.max(...rects.map((r) => r.x + r.w)));
  const bottom = Math.ceil(Math.max(...rects.map((r) => r.y + r.h)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// src/render/ffmpeg.ts
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
var run = promisify(execFile);
function burnStyle(width, height, font = "Arial") {
  return {
    width,
    height,
    font,
    // MEASURED, not guessed. `splitCue` caps a cue at 84 characters and `wrap`
    // breaks it near the middle, so the longer of the two lines runs to about
    // 46 characters in real caption prose. Bold Arial advances 0.485em per
    // character on that prose (measured in a browser over the demo's own
    // narration), so 46 characters at F px is 22.3F wide, and the usable width
    // here is 978px. F = 40 leaves 9% of headroom; F = 45 — which is what
    // "4% of the width" looked like on paper — overflows to a THIRD line, and a
    // three-line band covers the bottom of the slide.
    fontSize: Math.round(width * 0.037),
    // Clear of the play button, the progress bar and the handle every vertical
    // player draws across the bottom eighth of the frame.
    marginV: Math.round(height * 0.09),
    marginX: Math.round(width * 0.04)
  };
}
export {
  bundleFont,
  burnStyle,
  captionPage,
  cueMax,
  renderCaptions,
  splitCue,
  wrap2 as wrap
};
