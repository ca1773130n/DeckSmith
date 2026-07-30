/**
 * How much of GSAP does the vocabulary actually use?
 *
 * The renderer question turns on one measurable fact: is `Scene.tl` a *program*
 * written in GSAP, or is it *data* wearing a GSAP costume? If every statement is
 * a declarative (target, from, to, at, duration, ease) tuple, the vocabulary is
 * already frame-pure and any host can evaluate it. If a meaningful fraction
 * needs GSAP semantics — function values, keyframes, stagger resolution,
 * plugin eases — then the host is load-bearing and swapping it is a rewrite.
 *
 * Reads a BUILT deck (demo/deck/index.html), not the emitters, so what is
 * counted is what actually shipped into the document.
 */
import { readFileSync } from "node:fs";

const html = readFileSync(process.argv[2] ?? "demo/deck/index.html", "utf8");

/** Every `tl.fromTo(...)` statement, balanced-paren scanned (regex mis-splits on nested objects). */
function statements(src) {
  const out = [];
  let i = 0;
  for (;;) {
    const at = src.indexOf("tl.fromTo(", i);
    if (at < 0) break;
    let depth = 0;
    let j = at + "tl.fromTo".length;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(at, j + 1));
    i = j + 1;
  }
  return out;
}

/** Split the argument list at top-level commas. */
function args(stmt) {
  const inner = stmt.slice(stmt.indexOf("(") + 1, stmt.lastIndexOf(")"));
  const parts = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (c === quote && inner[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

/**
 * What a statement needs from its host.
 *
 *  "declarative"  — target, two literal property bags, a literal position.
 *                   Evaluable by lerp(from, to, ease(clamp((t-at)/dur))).
 *  "stagger"      — same, but the target is a SET and offsets are derived.
 *                   Still closed form; needs the host to expand a set.
 *  "fn-value"     — a property whose value is a JS function. GSAP resolves it
 *                   once, at the tween's first render. Not a pure function of t
 *                   unless the function is itself memoised, which ours is.
 *  "custom-ease"  — ease is a JS identifier, not a named GSAP ease string.
 */
function classify(stmt) {
  const a = args(stmt);
  const to = a[2] ?? "";
  const flags = [];
  if (/:\s*function\s*\(/.test(to) || /:\s*\(\s*\)\s*=>/.test(to)) flags.push("fn-value");
  if (/\bstagger\s*:/.test(to)) flags.push("stagger");
  if (/\bease\s*:\s*[A-Za-z_$][\w$]*\s*[,}]/.test(to)) flags.push("custom-ease");
  if (/\bkeyframes\s*:/.test(to)) flags.push("keyframes");
  if (/\brepeat\s*:/.test(to)) flags.push("repeat");
  if (/\bonUpdate|onStart|onComplete|onRepeat/.test(to)) flags.push("CALLBACK");
  return flags.length ? flags : ["declarative"];
}

/** Which CSS/transform properties the vocabulary animates at all. */
function props(stmt) {
  const a = args(stmt);
  const bag = `${a[1] ?? ""} ${a[2] ?? ""}`;
  const skip = new Set([
    "duration",
    "ease",
    "stagger",
    "delay",
    "immediateRender",
    "amount",
    "each",
    "grid",
    "from",
    "repeat",
    "repeatDelay",
    "yoyo",
  ]);
  const found = new Set();
  for (const m of bag.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) {
    if (!skip.has(m[1])) found.add(m[1]);
  }
  return [...found];
}

const stmts = statements(html);
const tally = new Map();
const propTally = new Map();
const easeTally = new Map();

for (const s of stmts) {
  for (const f of classify(s)) tally.set(f, (tally.get(f) ?? 0) + 1);
  for (const p of props(s)) propTally.set(p, (propTally.get(p) ?? 0) + 1);
  const e = /\bease\s*:\s*("([^"]+)"|[A-Za-z_$][\w$]*)/.exec(args(s)[2] ?? "");
  const key = e ? (e[2] ?? e[1]) : "(none: linear)";
  easeTally.set(key, (easeTally.get(key) ?? 0) + 1);
}

const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const pct = (n) => `${((100 * n) / stmts.length).toFixed(1)}%`;

console.log(`statements: ${stmts.length}`);
console.log("\n-- host semantics required --");
for (const [k, v] of sorted(tally)) console.log(`  ${k.padEnd(14)} ${String(v).padStart(4)}  ${pct(v)}`);
console.log("\n-- animated properties --");
for (const [k, v] of sorted(propTally)) console.log(`  ${k.padEnd(14)} ${String(v).padStart(4)}`);
console.log("\n-- eases --");
for (const [k, v] of sorted(easeTally)) console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}`);

// Anything a pure lerp evaluator could NOT reproduce, printed in full.
const hard = stmts.filter((s) => !classify(s).includes("declarative"));
console.log(`\n-- ${hard.length} non-declarative statement(s) --`);
for (const s of hard) console.log(`  ${s.replace(/\s+/g, " ").slice(0, 220)}`);
