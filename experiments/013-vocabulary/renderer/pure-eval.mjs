/**
 * A host-free evaluator for `Scene.tl`.
 *
 * The claim under test: DeckSmith's animation vocabulary is already a pure
 * function of t, and GSAP is only the thing that happens to be applying it. If
 * that is true, then Remotion's frame-purity buys nothing the vocabulary does
 * not already have, and the renderer choice is independent of the vocabulary
 * choice. If it is false, the host is load-bearing.
 *
 * This file evaluates the SAME statement text the deck ships, with no GSAP, and
 * `compare.mjs` checks it against what GSAP actually painted in a browser.
 *
 * Deliberately naive: 130 lines, no dependency, no dynamic import of the deck's
 * own code. If a naive evaluator matches, the vocabulary is portable; if it
 * needs to grow to match, the size it has to grow to IS the cost estimate.
 */

/* ---------------------------------------------------------------- parsing */

export function statements(src) {
  const out = [];
  let i = 0;
  for (;;) {
    const at = src.indexOf("tl.fromTo(", i);
    if (at < 0) break;
    let depth = 0;
    let j = at + "tl.fromTo".length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    out.push(src.slice(at, j + 1));
    i = j + 1;
  }
  return out;
}

function splitArgs(stmt) {
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
    else if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

/** The property bags are JS object literals with string/number/object values. */
function bag(src) {
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${src});`)();
}

export function parse(stmt) {
  const a = splitArgs(stmt);
  const selector = bag(a[0]);
  const from = bag(a[1]);
  const to = bag(a[2]);
  const at = Number(a[3]);
  return {
    selector,
    from,
    to,
    at,
    duration: to.duration ?? 0.5,
    // GSAP's DEFAULT EASE IS power1.out, NOT linear. Getting this wrong is a
    // ~4% error at mid-tween, which is exactly the size of error that looks
    // like noise in a screenshot diff and is not.
    ease: to.ease ?? "power1.out",
    stagger: to.stagger,
  };
}

/* ------------------------------------------------------------------ eases */

const pow =
  (n) =>
  ({
    out: (p) => 1 - (1 - p) ** n,
    in: (p) => p ** n,
    inOut: (p) => (p < 0.5 ? (2 * p) ** n / 2 : 1 - (2 - 2 * p) ** n / 2),
  });

export function easeFn(spec) {
  if (typeof spec === "function") return spec;
  if (spec === "none" || spec === "linear") return (p) => p;
  const back = /^back\.(in|out|inOut)\(([-\d.]+)\)$/.exec(spec);
  if (back) {
    const s = Number(back[2]);
    const o = (p) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2;
    if (back[1] === "out") return o;
    if (back[1] === "in") return (p) => 1 - o(1 - p);
    return (p) => (p < 0.5 ? (1 - o(1 - 2 * p)) / 2 : (1 + o(2 * p - 1)) / 2);
  }
  const m = /^power(\d)\.(in|out|inOut)$/.exec(spec);
  if (m) return pow(Number(m[1]) + 1)[m[2]];
  return (p) => p; // unknown: linear, and `compare.mjs` will say so loudly
}

/* ------------------------------------------------------------- evaluation */

/** Per-element delay from `stagger`, closed form. */
function offset(stagger, index, count) {
  if (stagger === undefined) return 0;
  if (typeof stagger === "number") return stagger * index;
  const each = stagger.each ?? (stagger.amount ?? 0) / Math.max(1, count - 1);
  if (stagger.grid) {
    const [rows, cols] = stagger.grid;
    // GSAP measures grid distance from the `from` anchor; "start" is index 0,
    // which for a row-major grid is (0,0) and reduces to plain index order.
    if ((stagger.from ?? "start") === "start") return each * index;
    const r = Math.floor(index / cols);
    const c = index % cols;
    return each * (r + c) * (rows > 0 ? 1 : 1);
  }
  return each * index;
}

const NUMERIC = new Set(["opacity", "x", "y", "scale", "scaleX", "scaleY", "width", "fillOpacity"]);

/**
 * The value of every numeric property this statement touches, at time `t`, for
 * element `index` of `count` matched by the selector.
 *
 * `immediateRender: false` semantics: before the tween's own start the element
 * carries no value from this tween at all, so an unstarted tween reports
 * nothing rather than its `from`. After it ends GSAP holds the `to` state.
 */
export function evaluate(tw, t, index = 0, count = 1) {
  const start = tw.at + offset(tw.stagger, index, count);
  const raw = (t - start) / (tw.duration || 1e-9);
  const p = raw <= 0 ? 0 : raw >= 1 ? 1 : easeFn(tw.ease)(raw);
  const out = {};
  for (const k of Object.keys(tw.to)) {
    if (!NUMERIC.has(k)) continue;
    const a = tw.from[k];
    const b = tw.to[k];
    if (typeof a !== "number" || typeof b !== "number") continue;
    out[k] = a + (b - a) * p;
  }
  return { started: raw > 0, out };
}
