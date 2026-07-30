/**
 * Split the archetypes' SOLVER code by what it depends on.
 *
 * "Geometry" and "content shaping" are not separable by keyword — `bar` and
 * `labelSize` are both numbers computed by arithmetic — but they ARE separable
 * by PROVENANCE, and provenance is what decides whether a vocabulary can supply
 * them:
 *
 *   FORMAT-ONLY   depends only on the canvas (contentW, isPortrait) and module
 *                 constants. A camera + layout vocabulary supplies this.
 *   DATA          depends on the beat's params or the source document — the
 *                 labels, the values, the row count. No Transform primitive
 *                 knows how many rows your table has.
 *   TEXT-METRIC   a DATA dependency that flows through textWidth / wrap /
 *                 fitText / fitBoxes / MIN_FONT: fitting real strings into a box
 *                 at a legal size. This is the subset the hypothesis says is
 *                 "the part nobody talks about".
 *
 * The analysis is a forward taint over `const`/`let` bindings inside the emitter
 * body. It is deliberately crude — no scoping, no aliasing through objects — so
 * it OVER-taints rather than under-taints: a binding is data-dependent as soon
 * as any data-dependent name appears on its right-hand side. Over-tainting
 * inflates DATA, which is the direction that argues AGAINST the conclusion this
 * ends up supporting, so the bias is the safe one.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { depths } from "./scan.mjs";

const ROOT = "/Users/neo/Developer/Projects/DeckSmith/src/emit";
const isComment = (l) => /^\s*(\/\*|\*|\/\/)/.test(l);
const isBlank = (l) => l.trim() === "";

/** Roots of the document's data. `ctx.format` and `ctx.theme` are NOT data. */
const DATA_ROOT = /\bbeat\b|\bctx\.source\b|\bp\.[a-zA-Z]/;
/** Calls that measure or fit real strings. */
const METRIC = /\btextWidth\(|\bwrap\(|\bfitText\(|\bfitBoxes\(|\bMIN_FONT\b|\bunwidow\(|charUnits|\bwidest\(|\bbalance\(/;

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

/**
 * TOP-LEVEL statements of the emitter body, as [startLine, endLine, text].
 *
 * Whole statements, never fragments. Splitting on inner brackets tore a single
 * `Math.max(...)` into four pieces and, worse, stranded lambda bodies from the
 * binding that introduced them: inside `p.bars.map((b) => …)` the parameter `b`
 * carries the data taint, and a fragment that mentions only `b` was scored
 * FORMAT. One statement, one verdict — an `if (tall) { … }` block included.
 */
function statements(lines, lo, hi, delta) {
  const out = [];
  let depth = 0;
  let start = -1;
  let buf = [];
  for (let i = lo + 1; i <= hi; i++) {
    const l = lines[i];
    if (start < 0) {
      if (isBlank(l) || isComment(l)) continue;
      start = i;
    }
    if (!isComment(l)) buf.push(l);
    depth += delta[i];
    if (depth <= 0) {
      out.push([start, i, buf.join("\n")]);
      start = -1;
      buf = [];
      depth = 0;
    }
  }
  if (start >= 0) out.push([start, hi, buf.join("\n")]);
  return out;
}

const BINDING = /^\s*(?:const|let|var)\s+(?:\{([^}]*)\}|\[([^\]]*)\]|([A-Za-z_$][\w$]*))/;

function analyse(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const { delta } = depths(lines);
  const r = emitterRange(lines, delta);
  if (!r) return null;
  const [lo, hi] = r;

  const data = new Set();
  const metric = new Set();
  const counts = { FORMAT: 0, DATA: 0, METRIC: 0 };
  const rows = [];

  for (const [s, e, text] of statements(lines, lo, hi, delta)) {
    const n = e - s + 1;
    const names = [...text.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]);
    const m = text.match(BINDING);
    const bound = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "")
      .split(",")
      .map((x) => x.trim().split(":").pop().trim().replace(/\s*=.*/, ""))
      .filter((x) => /^[A-Za-z_$][\w$]*$/.test(x));
    // The right-hand side only, so `const cell = ...` does not taint itself.
    const rhs = m ? text.slice(text.indexOf("=", m[0].length - 1) + 1) : text;
    const rhsNames = [...rhs.matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]);

    const isData = DATA_ROOT.test(rhs) || rhsNames.some((x) => data.has(x));
    const isMetric = isData && (METRIC.test(rhs) || rhsNames.some((x) => metric.has(x)));
    if (isData) for (const b of bound) data.add(b);
    if (isMetric) for (const b of bound) metric.add(b);

    const cls = !isData ? "FORMAT" : isMetric ? "METRIC" : "DATA";
    counts[cls] += n;
    rows.push([s + 1, cls, lines[s].trim().slice(0, 96)]);
    void names;
  }
  return { counts, rows };
}

const files = readdirSync(join(ROOT, "archetypes"))
  .filter((f) => f.endsWith(".ts") && f !== "index.ts")
  .sort();

if (process.argv[2] === "--dump") {
  const a = analyse(join(ROOT, "archetypes", `${process.argv[3]}.ts`));
  for (const [ln, cls, t] of a.rows) console.log(`${String(ln).padStart(4)}  ${cls.padEnd(7)} ${t}`);
  process.exit(0);
}

console.log("## emitter bodies: solver lines by what the value depends on");
console.log(["archetype", "FORMAT", "DATA", "METRIC", "total", "data+metric %"].join("\t"));
const tot = { FORMAT: 0, DATA: 0, METRIC: 0 };
for (const f of files) {
  const a = analyse(join(ROOT, "archetypes", f));
  if (!a) continue;
  const c = a.counts;
  const t = c.FORMAT + c.DATA + c.METRIC;
  console.log(
    [f.replace(".ts", ""), c.FORMAT, c.DATA, c.METRIC, t, `${(((c.DATA + c.METRIC) / t) * 100).toFixed(0)}%`].join("\t"),
  );
  for (const k of Object.keys(tot)) tot[k] += c[k];
}
const T = tot.FORMAT + tot.DATA + tot.METRIC;
console.log(["TOTAL", tot.FORMAT, tot.DATA, tot.METRIC, T, `${(((tot.DATA + tot.METRIC) / T) * 100).toFixed(0)}%`].join("\t"));
