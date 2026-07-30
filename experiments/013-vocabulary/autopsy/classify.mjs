/**
 * Statement-level classifier for the emit layer.
 *
 * Physical-line counting misattributes multi-line calls (a five-line `tween(...)`
 * has four lines that mention no timing at all), so lines are grouped into
 * STATEMENTS by bracket depth and the whole statement is classified once. A line
 * that opens a BLOCK (`{` at end of line) closes the current statement and raises
 * the base depth, so a 300-line emitter arrow function is not one statement.
 * String-literal lines that look like a CSS rule are classified individually,
 * because a `css: [...]` array is a list of unrelated decisions, not one.
 *
 * Classification reads the statement's CODE text only. Comments inherit the class
 * of the statement they precede — a 20-line rationale above `fitBoxes` counts as
 * the geometry it explains, not as undifferentiated prose — but never vote.
 *
 * Categories, per the autopsy brief, plus two the brief has no box for:
 *   GEOMETRY   where things go
 *   CHOREO     when and how they arrive
 *   SHAPING    what to draw, fitted to the box at a legal size
 *   CHROME     eyebrow / headline / note
 *   STYLE      theme-driven appearance: colour, weight, radius, stroke
 *   SCAFFOLD   imports, signatures, return-object braces, error paths
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/Users/neo/Developer/Projects/DeckSmith/src/emit";

/** Blank out string and template contents so brace depth is not fooled by CSS. */
function bare(line) {
  return line
    .replace(/\\./g, "")
    .replace(/`(?:[^`$]|\$(?!\{))*`/g, "``")
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .replace(/\/\/.*$/, "");
}

function depthDelta(line) {
  let d = 0;
  for (const c of bare(line)) {
    if (c === "(" || c === "[" || c === "{") d++;
    else if (c === ")" || c === "]" || c === "}") d--;
  }
  return d;
}

const isComment = (l) => /^\s*(\/\*|\*|\/\/)/.test(l);
const isBlank = (l) => l.trim() === "";
/**
 * Ends by opening something whose contents are separate decisions:
 *   - an array literal (`css: [`, `const tl = [`) — one statement per element;
 *   - a function body or control block — one statement per statement;
 *   - the emitter's `return {` — html/tl/holds/css are four different jobs.
 * NOT a plain object literal (`const img = {`, `interface NoteBox {`), whose
 * fields are one coherent thing, and NOT `(`, so a call whose arguments span
 * five lines stays one statement.
 */
const opensBlock = (l) => {
  const b = bare(l);
  if (/\[\s*$/.test(b)) return true;
  return /(=>|\)|\belse|\btry|\bdo)\s*\{\s*$/.test(b) || /^\s*return \{\s*$/.test(b);
};
const isImport = (l) => /^\s*(import\b|export \{)/.test(l);

/**
 * Rules are tried in order. The order IS a judgement call, recorded here so a
 * reader can disagree with a specific rule rather than with the totals. The
 * `alt` ruleset moves `wrap`/`fitBoxes` from GEOMETRY to SHAPING; both totals are
 * reported, because those two functions genuinely do both jobs.
 */
function rules(alt) {
  const fitters = /\bwrap\(|wrapTokens|fitBoxes\(|\bFit\b|FitRequest/;
  const base = [
    [
      "CHOREO",
      /\btl\b|tween\(|fromTo|holds|holdsWithin|stagger|duration|\bdelay\b|ambient\(|DRIFT|BREATHE|PULSE|GLINT|SWEEP|drawFrom\(|\bease\b|beat\.seconds|\bsetup\b|katex\.render|prefers-reduced-motion|ds-live|@keyframes|animation|transition/,
    ],
    [
      "CHROME",
      /chrome\(|chromeIn\(|chromeCss\(|chromeHeight\(|noteCss\(|noteHeight\(|noteWidth\(|unwidow\(|p\.eyebrow|p\.headline|\.headline|\.eyebrow|EYEBROW_|HEADLINE_|ORPHAN_WORDS|NOTE_MAX_W|\bbodyBudget\(/,
    ],
    [
      "GEOMETRY",
      /tracks\(|contentW\(|contentH\(|isPortrait\(|\bsvg\(|\brect\(|roundRect\(|\bline\(|\bcircle\(|\bpath\(|\bgroup\(|\barrow\(|\belbow\(|arrowDefs\(|pullBack|headId|PAD_[XY]|REF_W|refWidth|refHeight|zoomOf|\bviewBox|\bBox\b|\bPt\b|\bTrack\b|display:\s*(grid|flex)|grid-template|grid-column|grid-row|flex-direction|justify-|align-|position:|\bmargin|\bpadding|\bgap\b|max-width|max-height|min-height|\bx0\b|\by0\b|\bcx\b|\bcy\b|\bMath\.(hypot|sign|atan2)|_(GAP|PAD|TOP|BOX|COL|ROW|W|H|LIFT|DROP|INSET|MARGIN)\b|\b(GAP|PAD|BOX|COL|ROW)_|\.(x|y|w|h)\b|\b(width|height|boxW|boxH|stageW|stageH|plotW|plotH|colW|rowH|pitch|span|inner|half)\b/,
    ],
    [
      "SHAPING",
      /fitText\(|textWidth\(|charUnits|weightFactor|MIN_FONT|\bfont-size|\besc\(|mathy\(|\bp\.[a-z]|\.params|toFixed|Number\(|parseFloat|maxLines|truncat|\bMath\.(min|max)\(|\.map\(|\.slice\(|\.filter\(|\bsize\b|\brows\b|\bcols\b|\bcells\b|\blabels?\b|\bvalues?\b/,
    ],
    [
      "STYLE",
      /theme\.|\bt\.(fg|bg|muted|dim|rule|panel|accent|tones)|color:|background|border|\bfill\b|stroke|opacity|letter-spacing|font-weight|line-height|radius|\btone\b|text-transform/,
    ],
  ];
  if (!alt) base[2][1] = new RegExp(`${fitters.source}|${base[2][1].source}`);
  else base[3][1] = new RegExp(`${fitters.source}|${base[3][1].source}`);
  return base;
}

export function classifyFile(path, alt = false) {
  const RULES = rules(alt);
  const match = (text) => {
    for (const [name, re] of RULES) if (re.test(text)) return name;
    return null;
  };
  /**
   * Code decides. Where the code is uninformative — `const STAGE_GAP = 30;` is
   * just a number — the doc comment that justifies it decides instead. Comments
   * never OVERRIDE code, so a rationale mentioning the headline cannot flip a
   * geometry statement.
   */
  const classify = (codeText, commentText) =>
    match(codeText) ?? (commentText ? match(commentText) : null) ?? "SCAFFOLD";

  const lines = readFileSync(path, "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  const out = new Array(lines.length).fill(null);
  let depth = 0;
  let base = 0;
  let start = -1;
  let pending = -1;
  let code = [];
  let notes = [];
  let lastClosed = "SCAFFOLD";

  /**
   * Block openers, innermost last. A statement the rules cannot read — `top,`,
   * `i++`, `return plan;` — is doing whatever the block it sits in is doing, so
   * it inherits rather than falling to SCAFFOLD. Without this, splitting an
   * emitter into per-statement units charges every closing brace and every
   * one-token object field to a category that means "we could not tell".
   */
  const stack = [];
  const close = (end) => {
    const s = start;
    let cls = code.some(isImport) ? "IMPORT" : classify(code.join("\n"), notes.join("\n"));
    if (cls === "SCAFFOLD") {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].cls !== "SCAFFOLD" && stack[k].cls !== "IMPORT") {
          cls = stack[k].cls;
          break;
        }
      }
    }
    lastClosed = cls;
    for (let k = s; k <= end; k++) if (out[k] === null) out[k] = cls;
    start = -1;
    code = [];
    notes = [];
    pending = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (start < 0) {
      if (isBlank(l)) {
        out[i] = "BLANK";
        pending = -1;
        continue;
      }
      if (isComment(l)) {
        if (pending < 0) pending = i;
        notes.push(l);
        continue;
      }
      start = pending >= 0 ? pending : i;
      pending = -1;
    }
    if (isComment(l)) notes.push(l);
    else code.push(l);
    const before = depth;
    depth += depthDelta(l);
    if (opensBlock(l) && depth > before) {
      close(i);
      stack.push({ depth: before, cls: lastClosed });
      base = depth;
      continue;
    }
    if (depth <= base) {
      while (stack.length > 0 && depth <= stack[stack.length - 1].depth) stack.pop();
      base = Math.min(base, depth);
      close(i);
    }
  }
  if (start >= 0) close(lines.length - 1);
  for (let i = 0; i < out.length; i++) {
    if (out[i] === null) out[i] = isBlank(lines[i]) ? "BLANK" : "SCAFFOLD";
  }

  const tally = {};
  const codeT = {};
  for (let i = 0; i < lines.length; i++) {
    tally[out[i]] = (tally[out[i]] ?? 0) + 1;
    if (!isBlank(lines[i]) && !isComment(lines[i])) codeT[out[i]] = (codeT[out[i]] ?? 0) + 1;
  }
  return { lines, cls: out, tally, code: codeT };
}

const CATS = ["GEOMETRY", "CHOREO", "SHAPING", "CHROME", "STYLE", "SCAFFOLD", "IMPORT"];

const alt = process.argv.includes("--alt");
if (process.argv[2] === "--dump") {
  const r = classifyFile(process.argv[3], alt);
  for (let i = 0; i < r.lines.length; i++) {
    console.log(`${String(i + 1).padStart(4)} ${r.cls[i].padEnd(8)} ${r.lines[i]}`);
  }
  process.exit(0);
}

const files = readdirSync(join(ROOT, "archetypes"))
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .sort();
const rows = [];
for (const f of files) rows.push([f.replace(".ts", ""), classifyFile(join(ROOT, "archetypes", f), alt)]);
for (const f of ["kit.ts", "svg.ts", "theme.ts"]) {
  rows.push([`[shared] ${f}`, classifyFile(join(ROOT, f), alt)]);
}

const mode = process.argv.includes("--raw") ? "tally" : "code";
console.log(`# ruleset=${alt ? "alt (wrap/fitBoxes -> SHAPING)" : "brief (wrap/fitBoxes -> GEOMETRY)"}  counting=${mode === "code" ? "code lines" : "all lines"}`);
console.log(["file", ...CATS, "TOTAL"].join("\t"));
const sums = Object.fromEntries(CATS.map((c) => [c, 0]));
const shared = Object.fromEntries(CATS.map((c) => [c, 0]));
for (const [name, r] of rows) {
  const t = r[mode];
  const tot = CATS.reduce((a, c) => a + (t[c] ?? 0), 0);
  console.log([name, ...CATS.map((c) => t[c] ?? 0), tot].join("\t"));
  for (const c of CATS) (name.startsWith("[shared]") ? shared : sums)[c] += t[c] ?? 0;
}
console.log(["TWELVE", ...CATS.map((c) => sums[c]), CATS.reduce((a, c) => a + sums[c], 0)].join("\t"));
console.log(["SHARED", ...CATS.map((c) => shared[c]), CATS.reduce((a, c) => a + shared[c], 0)].join("\t"));
const pct = (o) => {
  const t = CATS.reduce((a, c) => a + o[c], 0);
  return CATS.map((c) => `${((100 * o[c]) / t).toFixed(1)}%`);
};
console.log(["TWELVE%", ...pct(sums), ""].join("\t"));
console.log(["SHARED%", ...pct(shared), ""].join("\t"));
