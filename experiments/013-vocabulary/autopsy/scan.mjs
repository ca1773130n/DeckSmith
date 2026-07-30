/**
 * Character-level bracket scanner.
 *
 * A regex that blanks string literals cannot see a NESTED template literal, and
 * this codebase has them: `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`
 * leaves two unbalanced braces behind, which silently derails a depth-based
 * splitter — data-table's emitter never appeared to close, so it was dropped
 * from the first run of every table here. Anything counting brackets in this
 * repo has to tokenise properly.
 */

const CODE = 0;
const DQ = 1;
const SQ = 2;
const TPL = 3;
const BLOCK = 4;

/**
 * Net bracket delta per line, counting only brackets that are CODE.
 * Returns `{ delta[], inString[] }`, `inString[i]` true when line i begins
 * inside a multi-line string or comment.
 */
export function scanLines(lines) {
  const delta = new Array(lines.length).fill(0);
  const inString = new Array(lines.length).fill(false);
  // Stack of states. `${` inside a template pushes CODE with a brace counter.
  const stack = [{ state: CODE, braces: 0 }];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const top0 = stack[stack.length - 1];
    inString[i] = top0.state !== CODE || stack.length > 1;
    let d = 0;
    for (let k = 0; k < l.length; k++) {
      const c = l[k];
      const top = stack[stack.length - 1];
      if (top.state === BLOCK) {
        if (c === "*" && l[k + 1] === "/") {
          stack.pop();
          k++;
        }
        continue;
      }
      if (top.state === DQ || top.state === SQ) {
        if (c === "\\") k++;
        else if ((top.state === DQ && c === '"') || (top.state === SQ && c === "'")) stack.pop();
        continue;
      }
      if (top.state === TPL) {
        if (c === "\\") k++;
        else if (c === "`") stack.pop();
        else if (c === "$" && l[k + 1] === "{") {
          stack.push({ state: CODE, braces: 0 });
          k++;
        }
        continue;
      }
      // CODE
      if (c === "/" && l[k + 1] === "/") break;
      if (c === "/" && l[k + 1] === "*") {
        stack.push({ state: BLOCK });
        k++;
        continue;
      }
      // A regex literal. `.replace(/'/g, "…")` otherwise opens a quote state
      // that never closes and drags the depth of every following line with it —
      // which is exactly what made kit.ts and theme.ts unbalanced.
      const prev = l.slice(0, k).replace(/\s+$/, "");
      const regexOk = prev === "" || /[(,=:[!&|?{;]$/.test(prev) || /\b(return|typeof|case|of|in)$/.test(prev);
      if (c === "/" && regexOk) {
        let cls = false;
        let j = k + 1;
        for (; j < l.length; j++) {
          const q = l[j];
          if (q === "\\") j++;
          else if (q === "[") cls = true;
          else if (q === "]") cls = false;
          else if (q === "/" && !cls) break;
        }
        if (j < l.length) {
          k = j;
          continue;
        }
      }
      if (c === '"') {
        stack.push({ state: DQ });
        continue;
      }
      if (c === "'") {
        stack.push({ state: SQ });
        continue;
      }
      if (c === "`") {
        stack.push({ state: TPL });
        continue;
      }
      if (c === "(" || c === "[") {
        d++;
        continue;
      }
      if (c === ")" || c === "]") {
        d--;
        continue;
      }
      if (c === "{") {
        top.braces++;
        d++;
        continue;
      }
      if (c === "}") {
        // A `}` that closes a `${` returns to the template, and is not code.
        if (top.braces === 0 && stack.length > 1) {
          stack.pop();
          continue;
        }
        top.braces--;
        d--;
      }
    }
    delta[i] = d;
  }
  return { delta, inString };
}

/** Convenience: cumulative depth BEFORE each line. */
export function depths(lines) {
  const { delta, inString } = scanLines(lines);
  const before = new Array(lines.length).fill(0);
  let d = 0;
  for (let i = 0; i < lines.length; i++) {
    before[i] = d;
    d += delta[i];
  }
  return { before, delta, inString };
}
