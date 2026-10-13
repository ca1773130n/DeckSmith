/**
 * The box a formula takes, before a browser sets it. A scene's formula is
 * typeset by the KaTeX the deck vendors, in the page (`ds-tex`, src/emit/
 * composition.ts `mathSetup`); the layout needs its size at build, in Node,
 * where KaTeX computes heights but no widths. So the width is estimated off
 * KaTeX's own parse tree: glyphs measured in the deck's face, the spacing KaTeX
 * puts around relations and operators, a fraction as wide as its wider part, a
 * script at its script size. An estimate: the layout keeps a margin over it,
 * and the page's own gates (text_clipped, overlap) see what the browser drew.
 */
import katex from "katex";
import { GREEK } from "../formula.js";
import type { Measure } from "./common.js";

/** KaTeX's script size against the text size (\scriptstyle). */
const SCRIPT = 0.7;
/**
 * The margin kept over the estimate. MEASURED 2026-10-14 against KaTeX in Chrome
 * at 64px on five of the sources' formulas (a fraction, a root, Σ with limits, a
 * long run of words): the bare estimate came to 91–105% of the real width, so
 * the margin keeps every one at or over it (100–115%).
 */
const MARGIN = 1.1;

type Node = {
  type: string;
  text?: string;
  family?: string;
  body?: Node | Node[];
  base?: Node;
  sup?: Node;
  sub?: Node;
  numer?: Node;
  denom?: Node;
  name?: string;
  symbol?: boolean;
};

/** Width and height, in em, of a list of nodes. */
function size(nodes: readonly Node[], em: (s: string) => number): { w: number; h: number } {
  let w = 0;
  let h = 1.2;
  for (const n of nodes) {
    const s = one(n, em);
    w += s.w;
    h = Math.max(h, s.h);
  }
  return { w, h };
}

function list(n: Node | Node[] | undefined): Node[] {
  return !n ? [] : Array.isArray(n) ? n : [n];
}

function glyph(text: string): string {
  const name = text.replace(/^\\/, "");
  return GREEK[name] ?? (text.startsWith("\\") ? name.slice(0, 1) : text);
}

function one(n: Node, em: (s: string) => number): { w: number; h: number } {
  switch (n.type) {
    case "mathord":
    case "textord":
      return { w: em(glyph(n.text ?? "")), h: 1.2 };
    case "atom": {
      // KaTeX's thick space around a relation, medium around a binary operator.
      const pad = n.family === "rel" ? 0.56 : n.family === "bin" ? 0.44 : 0;
      return { w: em(glyph(n.text ?? "")) + pad, h: 1.2 };
    }
    case "spacing":
      return { w: 0.33, h: 1.2 };
    case "op":
      // A symbol (\sum) is one large glyph; a word (\min) is set upright.
      return {
        w: n.symbol ? 1.45 : em((n.name ?? "").replace(/^\\/, "")) + 0.2,
        h: n.symbol ? 2.2 : 1.2,
      };
    case "supsub": {
      const base = one(n.base ?? { type: "ordgroup" }, em);
      // A big operator's limits stand above and below it in display style (Σ, ∏).
      if (n.base?.type === "op") {
        const sup = size(list(n.sup), em);
        const sub = size(list(n.sub), em);
        return {
          w: Math.max(base.w, sup.w * SCRIPT, sub.w * SCRIPT) + 0.17,
          h: base.h + (n.sup ? sup.h * SCRIPT + 0.2 : 0) + (n.sub ? sub.h * SCRIPT + 0.2 : 0),
        };
      }
      const script = Math.max(size(list(n.sup), em).w * SCRIPT, size(list(n.sub), em).w * SCRIPT);
      return { w: base.w + script + 0.05, h: base.h + 0.45 };
    }
    case "genfrac": {
      const a = size(list(n.numer), em);
      const b = size(list(n.denom), em);
      return { w: Math.max(a.w, b.w) + 0.24, h: a.h + b.h + 0.2 };
    }
    case "sqrt": {
      const s = size(list(n.body), em);
      return { w: s.w + 1.1, h: s.h + 0.2 };
    }
    case "leftright": {
      const s = size(list(n.body), em);
      return { w: s.w + 0.8, h: s.h };
    }
    default:
      return size(list(n.body), em);
  }
}

/** The box of `tex` set in display style at `px`, in px: an estimate, with a margin. */
export function texBox(tex: string, px: number, measure: Measure): { w: number; h: number } {
  // KaTeX's internal parser (`__parse`): untyped and not a stable API, so a
  // KaTeX upgrade that moves it fails here, loudly, at build.
  const parse = (katex as unknown as { __parse: (t: string, o: object) => Node[] }).__parse;
  if (typeof parse !== "function")
    throw new Error(
      "literal: this KaTeX has no `__parse`; a formula cannot be measured (src/literal/kinds/tex.ts)",
    );
  const tree = parse(`\\displaystyle ${tex}`, {});
  const em = (s: string) => measure(s, px) / px;
  const s = size(tree, em);
  return { w: Math.ceil(s.w * px * MARGIN), h: Math.ceil(s.h * px) };
}
