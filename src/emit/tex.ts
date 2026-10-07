/**
 * TeX, checked by the KaTeX that will draw it, before anything is drawn.
 *
 * WHY THIS EXISTS. 26 of 92 failed HypePaper builds in the week to 2026-10-07
 * died the same way: the deck was emitted, every step before `verify` passed,
 * and the gate then reported `page_error ParseError: KaTeX parse error` from a
 * `katex.render` call in the composition. The TeX had never been parsed before
 * a browser parsed it. 25 of the 26 were DeckSmith's own doing — `wrapTerms`
 * cut a `\left`/`\right` pair or a superscript in half — and the last was a
 * paper macro (`\raydir`) the source never defined. All of them are visible to
 * Node in a millisecond with the same package the deck vendors.
 *
 * So the parse happens here, with `throwOnError`, under exactly the options the
 * composition renders with. What fails gets a repair only where the repair
 * cannot change what the formula says, and the repair is reported in words. What
 * still fails is the caller's to degrade or refuse; it is never shipped as a
 * `katex.render` call that will throw.
 */
import katex from "katex";

/**
 * The attribute `equation-walk`'s fit leaves on a display it could not fit,
 * holding the formula. `fidelity` reads it and fails the deck naming that
 * formula — the one statement the layout gate's `span.mord` cannot make.
 */
export const UNFIT_ATTR = "data-ds-unfit";

/**
 * The trust predicate, as a function. `equation-walk`'s `TRUST` is the same
 * predicate as source text, because the composition needs it as text; the two
 * must agree or a TeX string passes here and fails in the deck.
 */
const trust = (c: { command: string }) => c.command === "\\htmlClass";

/** KaTeX's message for `tex`, or null when it parses. Same options the deck uses. */
export function texError(tex: string, display: boolean): string | null {
  try {
    katex.renderToString(tex, {
      displayMode: display,
      throwOnError: true,
      strict: false,
      trust,
      output: "html",
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export interface Repaired {
  /** The TeX to render: the input when it parsed, otherwise the repaired form. */
  tex: string;
  /** One sentence per repair made, in the order made. Empty when none was needed. */
  repairs: string[];
  /** KaTeX's message when even the repaired form does not parse; null otherwise. */
  error: string | null;
}

/** `\left` and `\right` as delimiters, not as the first letters of `\leftarrow`. */
const LEFT = /\\left(?![a-zA-Z])/g;
const RIGHT = /\\right(?![a-zA-Z])/g;

/**
 * Anchors with no ink. A `\label` names an equation so prose can point at it,
 * and nothing in a deck points at it; `\nonumber`/`\notag` suppress a number
 * KaTeX never prints. Taking them out removes nothing a viewer could see.
 */
const NO_INK = /\\label\{[^{}]*\}|\\nonumber(?![a-zA-Z])|\\notag(?![a-zA-Z])/g;

/** Braces that group, not the `\{` `\}` a set is written with. */
function braceBalance(tex: string): number {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  return depth;
}

const count = (tex: string, re: RegExp) => (tex.match(re) ?? []).length;

/**
 * Parse `tex`; if KaTeX refuses it, apply the repairs that cannot change its
 * meaning, one at a time, until it parses or none is left to try.
 *
 * THE REPAIRS, and why each is safe:
 *
 * - An UNBALANCED `\left`/`\right` is closed with the null delimiter `\right.`
 *   (or opened with `\left.`). The delimiter the author wrote is still drawn,
 *   at the size it was asked for; only the missing invisible partner is added.
 * - An UNBALANCED brace group is closed at the end, or opened at the start.
 * - `\label`, `\nonumber`, `\notag` are removed (see `NO_INK`).
 * - An UNDEFINED macro — a paper's own `\newcommand`, which the source never
 *   carries — is drawn as its NAME in upright type: `\raydir` becomes
 *   `\operatorname{raydir}`, an operator rather than `\mathrm` so that two in a
 *   row keep a space between them (`\camerarot \cameraint` set as `\mathrm`
 *   read "camerarotcameraint"). A degradation, not a restoration, and the sentence
 *   it returns says so; but it keeps the symbol on the slide under the name the
 *   paper gave it, where the alternatives are to drop the symbol or the slide.
 *
 * Deterministic: the same input always produces the same output and sentences,
 * which is what lets `plan` report a repair that `build` will then make.
 */
export function repairTex(input: string, display: boolean): Repaired {
  const repairs: string[] = [];
  let tex = input;
  let error = texError(tex, display);
  if (error === null) return { tex, repairs, error };

  const gone = tex.match(NO_INK) ?? [];
  if (gone.length) {
    tex = tex.replace(NO_INK, "").trim();
    repairs.push(`removed ${gone.join(", ")}, which draw nothing`);
    error = texError(tex, display);
  }

  const lefts = count(tex, LEFT);
  const rights = count(tex, RIGHT);
  if (error !== null && lefts !== rights) {
    const n = Math.abs(lefts - rights);
    tex = lefts > rights ? `${tex} ${"\\right.".repeat(n)}` : `${"\\left.".repeat(n)} ${tex}`;
    repairs.push(
      `${lefts} \\left against ${rights} \\right: added ${n} invisible ${lefts > rights ? "\\right." : "\\left."} to balance them`,
    );
    error = texError(tex, display);
  }

  const depth = braceBalance(tex);
  if (error !== null && depth !== 0) {
    const n = Math.abs(depth);
    tex = depth > 0 ? `${tex}${"}".repeat(n)}` : `${"{".repeat(n)}${tex}`;
    repairs.push(
      `${n} unclosed brace group(s): ${depth > 0 ? "closed at the end" : "opened at the start"}`,
    );
    error = texError(tex, display);
  }

  // One undefined name per round, because KaTeX reports the first it meets.
  // Bounded so a pathological input cannot spin; twelve is more distinct macros
  // than any equation in the corpus this was written against.
  const undefinedNames: string[] = [];
  for (let round = 0; error !== null && round < 12; round++) {
    const m = /Undefined control sequence: \\([a-zA-Z]+)/.exec(error);
    if (!m) break;
    const name = m[1] as string;
    const next = tex.replace(new RegExp(`\\\\${name}(?![a-zA-Z])`, "g"), `\\operatorname{${name}}`);
    if (next === tex) break;
    tex = next;
    undefinedNames.push(`\\${name}`);
    error = texError(tex, display);
  }
  if (undefinedNames.length) {
    repairs.push(
      `${undefinedNames.join(", ")} ${undefinedNames.length === 1 ? "is" : "are"} never defined in the source — drawn as ${undefinedNames.length === 1 ? "its name" : "their names"} in upright type`,
    );
  }

  return { tex, repairs, error };
}
