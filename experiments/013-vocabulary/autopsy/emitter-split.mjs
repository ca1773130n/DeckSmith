/**
 * Split each emitter body by WHAT ITS OUTPUT FEEDS, not by what its identifiers
 * look like. A statement inside `const tl = [...]` is choreography whatever it
 * mentions; a string in `css: [...]` is a stylesheet whatever it mentions. This
 * is structural, so each rule is checkable by eye, unlike a keyword classifier.
 *
 * Buckets:
 *   CHOREO   `const tl`, `tl.push`, `setup`, and the `tl:`/`holds:`/`setup:` keys
 *   CSS      the `css: [...]` array — reported again split by CSS PROPERTY below
 *   MARKUP   statements whose value is a template literal containing a tag
 *   SOLVER   everything else in the body: budgets, layout, fitting, data
 *   SCAFFOLD signature, destructuring, `return {`, closing braces
 *
 * CSS is additionally counted by DECLARATION rather than by line, because one
 * emitted rule can carry ten decisions of three different kinds.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { depths } from "./scan.mjs";

const ROOT = "/Users/neo/Developer/Projects/DeckSmith/src/emit";
const bare = (l) => l.replace(/`[^`]*`/g, "``").replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
const isComment = (l) => /^\s*(\/\*|\*|\/\/)/.test(l);
const isBlank = (l) => l.trim() === "";

/** The emitter export in each archetype file: `export const foo: Emitter<...> = (`. */
function emitterRange(lines, delta) {
  for (let i = 0; i < lines.length; i++) {
    if (!/^export const \w+: Emitter</.test(lines[i])) continue;
    let d = 0;
    for (let j = i; j < lines.length; j++) {
      d += delta[j];
      if (j > i && d <= 0) return [i, j];
    }
  }
  return null;
}

/* --------------------------------------------------------------- CSS props */

const LAYOUT_PROPS =
  /^(display|grid|grid-.*|flex|flex-.*|justify-.*|align-.*|place-.*|gap|row-gap|column-gap|margin.*|padding.*|width|height|max-width|max-height|min-width|min-height|position|top|left|right|bottom|inset|overflow.*|transform|transform-origin|text-align|white-space|vertical-align|box-sizing|float|clear|order|columns|column-.*)$/;
const TYPE_PROPS = /^(font|font-.*|line-height|letter-spacing|word-spacing|text-transform|text-indent|tab-size)$/;
const PAINT_PROPS =
  /^(color|background.*|border.*|outline.*|fill|fill-opacity|stroke.*|opacity|box-shadow|text-shadow|filter|mix-blend-mode|border-radius|visibility|content|list-style.*|text-decoration.*|paint-order)$/;
const MOTION_PROPS = /^(animation.*|transition.*|will-change)$/;

/** Strip `${...}` interpolations, nesting-aware, so CSS braces can be matched. */
function deinterp(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "$" && s[i + 1] === "{") {
      let d = 1;
      i += 2;
      for (; i < s.length && d > 0; i++) {
        if (s[i] === "{") d++;
        else if (s[i] === "}") d--;
      }
      out += "V";
      i--;
      continue;
    }
    out += s[i];
  }
  return out;
}

/** Count declarations inside every `selector{...}` block in a chunk of CSS text. */
function cssDecls(raw) {
  const text = deinterp(raw);
  const out = { layout: 0, type: 0, paint: 0, motion: 0, other: 0 };
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    for (const d of m[1].split(";")) {
      const prop = d.split(":")[0]?.trim().replace(/^\$\{.*\}$/, "");
      if (!prop || /[${}`]/.test(prop) || !/^[a-z-]+$/.test(prop)) continue;
      if (LAYOUT_PROPS.test(prop)) out.layout++;
      else if (TYPE_PROPS.test(prop)) out.type++;
      else if (PAINT_PROPS.test(prop)) out.paint++;
      else if (MOTION_PROPS.test(prop)) out.motion++;
      else out.other++;
    }
  }
  return out;
}

/* ------------------------------------------------------------ the split */

function splitEmitter(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const { delta } = depths(lines);
  const r = emitterRange(lines, delta);
  if (!r) return null;
  const [lo, hi] = r;

  const tag = new Array(lines.length).fill(null);
  let depth = 0;
  let stmtStart = -1;
  let stmt = [];
  let inCss = -1; // depth at which the `css: [` array sits, -1 when outside
  let inTl = -1;
  const cssText = [];
  const cssProp = (t) => t;

  const settle = (end) => {
    const text = stmt.join("\n");
    let cls;
    if (inCss >= 0) cls = "CSS";
    else if (inTl >= 0) cls = "CHOREO";
    else if (/^\s*(const|let)\s+(tl|setup)\b|^\s*tl\.push|^\s*(tl|holds|setup):/.test(text))
      cls = "CHOREO";
    else if (/holdsWithin\(|tween\(|\.fromTo\(/.test(text)) cls = "CHOREO";
    else if (/`[^`]*<[a-z]/.test(text) || /^\s*html:/.test(text)) cls = "MARKUP";
    else if (/^\s*(export const \w+: Emitter|return \{|\};?$|\}$|const \{ ?sid)/.test(text.trim()))
      cls = "SCAFFOLD";
    else cls = "SOLVER";
    for (let k = stmtStart; k <= end; k++) if (tag[k] === null) tag[k] = cls;
    stmtStart = -1;
    stmt = [];
  };

  for (let i = lo; i <= hi; i++) {
    const l = lines[i];
    if (stmtStart < 0) {
      if (isBlank(l)) {
        tag[i] = "BLANK";
        continue;
      }
      if (isComment(l)) {
        tag[i] = "COMMENT";
        continue;
      }
      stmtStart = i;
    }
    if (isComment(l)) {
      tag[i] = "COMMENT";
      continue;
    }
    if (inCss >= 0) cssText.push(l);
    stmt.push(l);
    const before = depth;
    depth += delta[i];
    // Entering / leaving the css and tl arrays.
    if (inCss < 0 && /^\s*css:\s*\[\s*$/.test(bare(l))) {
      inCss = before;
      tag[i] = "CSS";
      stmtStart = -1;
      stmt = [];
      continue;
    }
    if (inCss >= 0 && depth <= inCss) {
      tag[i] = "CSS";
      inCss = -1;
      stmtStart = -1;
      stmt = [];
      continue;
    }
    if (inTl < 0 && /^\s*(const (tl|setup)\s*(:[^=]*)?=\s*\[|tl:\s*\[|setup:\s*\[)\s*$/.test(bare(l))) {
      inTl = before;
      tag[i] = "CHOREO";
      stmtStart = -1;
      stmt = [];
      continue;
    }
    if (inTl >= 0 && depth <= inTl) {
      tag[i] = "CHOREO";
      inTl = -1;
      stmtStart = -1;
      stmt = [];
      continue;
    }
    if (inCss >= 0 || inTl >= 0) {
      if (depth <= (inCss >= 0 ? inCss : inTl) + 1) {
        tag[i] = inCss >= 0 ? "CSS" : "CHOREO";
        stmtStart = -1;
        stmt = [];
      }
      continue;
    }
    if (/[{[]\s*$/.test(bare(l)) && depth > before) settle(i);
    else if (depth <= 0 || /;\s*$/.test(bare(l)) || /^\s*[)\]}]/.test(bare(l))) settle(i);
  }
  if (stmtStart >= 0) settle(hi);

  const code = {};
  for (let i = lo; i <= hi; i++) {
    if (tag[i] === "BLANK" || tag[i] === "COMMENT" || tag[i] === null) continue;
    code[tag[i]] = (code[tag[i]] ?? 0) + 1;
  }
  const comments = tag.slice(lo, hi + 1).filter((t) => t === "COMMENT").length;
  return { code, comments, span: hi - lo + 1, css: cssDecls(cssText.join("\n")), tag };
}

const files = readdirSync(join(ROOT, "archetypes"))
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .sort();

const splitEmitterTagged = splitEmitter;
const B = ["SOLVER", "CHOREO", "MARKUP", "CSS", "SCAFFOLD"];
console.log("## emitter bodies, code lines by what the statement feeds");
console.log(["archetype", ...B, "code", "comment", "span"].join("\t"));
const tot = Object.fromEntries(B.map((b) => [b, 0]));
const css = { layout: 0, type: 0, paint: 0, motion: 0, other: 0 };
for (const f of files) {
  const s = splitEmitter(join(ROOT, "archetypes", f));
  if (!s) {
    console.log(`${f}\t(no emitter export found)`);
    continue;
  }
  const c = B.reduce((a, b) => a + (s.code[b] ?? 0), 0);
  console.log([f.replace(".ts", ""), ...B.map((b) => s.code[b] ?? 0), c, s.comments, s.span].join("\t"));
  for (const b of B) tot[b] += s.code[b] ?? 0;
  for (const k of Object.keys(css)) css[k] += s.css[k];
}
console.log(["TOTAL", ...B.map((b) => tot[b]), B.reduce((a, b) => a + tot[b], 0), "", ""].join("\t"));
console.log("");
console.log("## CSS declarations emitted by the twelve emitter bodies, by property kind");
console.log(Object.entries(css).map(([k, v]) => `${k}\t${v}`).join("\n"));
const cssTot = Object.values(css).reduce((a, b) => a + b, 0);
console.log(`total\t${cssTot}`);

/* Dump mode: the head line of every SOLVER statement, so the 1013 solver lines
   can be read as ~300 named bindings and hand-split into geometry vs shaping. */
if (process.argv[2] === "--solver") {
  for (const f of files) {
    const path = join(ROOT, "archetypes", f);
    const lines = readFileSync(path, "utf8").split("\n");
    const { delta } = depths(lines);
    const r = emitterRange(lines, delta);
    if (!r) continue;
    const s = splitEmitterTagged(path);
    console.log(`\n### ${f.replace(".ts", "")}`);
    let prev = null;
    for (let i = r[0]; i <= r[1]; i++) {
      if (s.tag[i] !== "SOLVER") { prev = s.tag[i]; continue; }
      if (prev === "SOLVER") { prev = "SOLVER"; continue; }
      prev = "SOLVER";
      console.log(`${String(i + 1).padStart(4)}  ${lines[i].trim().slice(0, 110)}`);
    }
  }
}
