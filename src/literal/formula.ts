/**
 * A TINY FORMULA GRAMMAR for the expressions a source prints: numbers, names
 * (Greek letters, subscripts: α, γ, x0, C_v), + − × ÷ ^, parentheses, and
 * min max abs exp log sqrt clip. Parsed once, evaluated on numbers (the build)
 * or on INTERVALS (the truth gate).
 *
 * Why intervals: a source prints rounded numbers. "α = 0.6, γ = 2 → 1.96X" is
 * three rounded values, and a correct formula evaluated at the printed 0.6 can
 * miss the printed 1.96 at the last digit. So a check is passed when the
 * formula, over every input's printed-precision interval, reaches the output's
 * own interval: a correct formula always passes, a wrong one almost never does
 * across a table's rows. A decimal input carries half a unit of its last digit;
 * an integer input is taken as exact (a count, not a measurement).
 *
 * No variable has a default and nothing is evaluated that the expression does
 * not name. Pure.
 */

export type Ast =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "neg"; a: Ast }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Ast; b: Ast }
  | { t: "call"; fn: string; args: Ast[] };

const FNS: Readonly<Record<string, number>> = {
  min: -1,
  max: -1,
  abs: 1,
  exp: 1,
  log: 1,
  sqrt: 1,
  clip: 3,
};

/** Unicode operators and TeX spacing written as the plain grammar. */
export function normalizeExpr(s: string): string {
  return s
    .replace(/\\left|\\right|\\,|\\;|\\!/g, "")
    .replace(/\\cdot|\\times|[×·]/g, "*")
    .replace(/\\div|÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(
      /\\(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|tau|rho|eta|kappa|omega|phi|psi|xi|pi)\b/g,
      (_, g: string) => GREEK[g] ?? g,
    )
    .replace(/\s+/g, "");
}

export const GREEK: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  sigma: "σ",
  tau: "τ",
  rho: "ρ",
  eta: "η",
  kappa: "κ",
  omega: "ω",
  phi: "φ",
  psi: "ψ",
  xi: "ξ",
  pi: "π",
};

type Tok = { k: "num"; v: number } | { k: "name"; v: string } | { k: "op"; v: string };

function tokens(src: string): Tok[] {
  const s = normalizeExpr(src);
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i);
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?/i.exec(rest);
    if (num) {
      out.push({ k: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[\p{L}][\p{L}\p{M}\p{N}_']*/u.exec(rest);
    if (name) {
      out.push({ k: "name", v: name[0] });
      i += name[0].length;
      continue;
    }
    const c = s[i] as string;
    if (!"+-*/^(),".includes(c)) throw new Error(`formula: cannot read "${c}" in "${src}"`);
    out.push({ k: "op", v: c });
    i++;
  }
  return out;
}

/** Parse an expression; throws with the expression on anything it cannot read. */
export function parseFormula(src: string): Ast {
  const ts = tokens(src);
  let p = 0;
  const peek = () => ts[p];
  const eat = (v: string) => {
    const t = ts[p];
    if (t?.k !== "op" || t.v !== v) throw new Error(`formula: expected "${v}" in "${src}"`);
    p++;
  };
  const isOp = (v: string) => {
    const t = peek();
    return !!t && t.k === "op" && t.v === v;
  };
  const sum = (): Ast => {
    let a = product();
    while (isOp("+") || isOp("-")) {
      const op = (ts[p++] as { v: string }).v as "+" | "-";
      a = { t: "bin", op, a, b: product() };
    }
    return a;
  };
  const product = (): Ast => {
    let a = unary();
    while (isOp("*") || isOp("/")) {
      const op = (ts[p++] as { v: string }).v as "*" | "/";
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Ast => {
    if (isOp("-")) {
      p++;
      return { t: "neg", a: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return power();
  };
  const power = (): Ast => {
    const a = atom();
    if (isOp("^")) {
      p++;
      return { t: "bin", op: "^", a, b: unary() };
    }
    return a;
  };
  const atom = (): Ast => {
    const t = ts[p++];
    if (!t) throw new Error(`formula: "${src}" ends too early`);
    if (t.k === "num") return { t: "num", v: t.v };
    if (t.k === "name") {
      if (isOp("(")) {
        const arity = FNS[t.v];
        if (arity === undefined)
          throw new Error(`formula: "${t.v}" is not a function (${Object.keys(FNS).join(", ")})`);
        p++;
        const args: Ast[] = [sum()];
        while (isOp(",")) {
          p++;
          args.push(sum());
        }
        eat(")");
        if (arity > 0 && args.length !== arity)
          throw new Error(`formula: ${t.v} takes ${arity} argument(s)`);
        if (arity < 0 && args.length < 2) throw new Error(`formula: ${t.v} takes two or more`);
        return { t: "call", fn: t.v, args };
      }
      return { t: "var", name: t.v };
    }
    if (t.v === "(") {
      const a = sum();
      eat(")");
      return a;
    }
    throw new Error(`formula: unexpected "${t.v}" in "${src}"`);
  };
  const ast = sum();
  if (p !== ts.length)
    throw new Error(`formula: "${src}" has something left over after position ${p}`);
  return ast;
}

/** The variable names an expression reads. */
export function variablesOf(ast: Ast): string[] {
  const out = new Set<string>();
  const walk = (a: Ast) => {
    if (a.t === "var") out.add(a.name);
    else if (a.t === "neg") walk(a.a);
    else if (a.t === "bin") {
      walk(a.a);
      walk(a.b);
    } else if (a.t === "call") a.args.forEach(walk);
  };
  walk(ast);
  return [...out];
}

/** Evaluate on numbers; a name with no value throws. */
export function evaluate(ast: Ast, env: Readonly<Record<string, number>>): number {
  switch (ast.t) {
    case "num":
      return ast.v;
    case "var": {
      const v = env[ast.name];
      if (v === undefined) throw new Error(`formula: "${ast.name}" has no value`);
      return v;
    }
    case "neg":
      return -evaluate(ast.a, env);
    case "bin": {
      const a = evaluate(ast.a, env);
      const b = evaluate(ast.b, env);
      return ast.op === "+"
        ? a + b
        : ast.op === "-"
          ? a - b
          : ast.op === "*"
            ? a * b
            : ast.op === "/"
              ? a / b
              : a ** b;
    }
    case "call": {
      const v = ast.args.map((x) => evaluate(x, env));
      switch (ast.fn) {
        case "min":
          return Math.min(...v);
        case "max":
          return Math.max(...v);
        case "abs":
          return Math.abs(v[0] as number);
        case "exp":
          return Math.exp(v[0] as number);
        case "log":
          return Math.log(v[0] as number);
        case "sqrt":
          return Math.sqrt(v[0] as number);
        default:
          return Math.min(Math.max(v[0] as number, v[1] as number), v[2] as number);
      }
    }
  }
}

/* ------------------------------------------------------------- intervals */

export type Iv = readonly [number, number];
const ALL: Iv = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
const span = (xs: number[]): Iv => {
  if (xs.some(Number.isNaN)) return ALL;
  return [Math.min(...xs), Math.max(...xs)];
};

function ipow(a: Iv, b: Iv): Iv {
  if (b[0] === b[1] && Number.isInteger(b[0])) {
    const n = b[0];
    const lo = a[0] ** n;
    const hi = a[1] ** n;
    if (n >= 0 && n % 2 === 0 && a[0] < 0 && a[1] > 0) return [0, Math.max(lo, hi)];
    if (n < 0 && a[0] <= 0 && a[1] >= 0) return ALL;
    return span([lo, hi]);
  }
  if (a[0] > 0) return span([a[0] ** b[0], a[0] ** b[1], a[1] ** b[0], a[1] ** b[1]]);
  return ALL;
}

/** Evaluate on intervals: the result holds every value the expression takes over the inputs' boxes. */
export function evaluateIv(ast: Ast, env: Readonly<Record<string, Iv>>): Iv {
  switch (ast.t) {
    case "num":
      return [ast.v, ast.v];
    case "var": {
      const v = env[ast.name];
      if (!v) throw new Error(`formula: "${ast.name}" has no value`);
      return v;
    }
    case "neg": {
      const a = evaluateIv(ast.a, env);
      return [-a[1], -a[0]];
    }
    case "bin": {
      const a = evaluateIv(ast.a, env);
      const b = evaluateIv(ast.b, env);
      switch (ast.op) {
        case "+":
          return [a[0] + b[0], a[1] + b[1]];
        case "-":
          return [a[0] - b[1], a[1] - b[0]];
        case "*":
          return span([a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]);
        case "/":
          if (b[0] <= 0 && b[1] >= 0) return ALL;
          return span([a[0] / b[0], a[0] / b[1], a[1] / b[0], a[1] / b[1]]);
        default:
          return ipow(a, b);
      }
    }
    case "call": {
      const v = ast.args.map((x) => evaluateIv(x, env));
      const mono = (f: (x: number) => number, x: Iv): Iv => [f(x[0]), f(x[1])];
      switch (ast.fn) {
        case "min":
          return [Math.min(...v.map((x) => x[0])), Math.min(...v.map((x) => x[1]))];
        case "max":
          return [Math.max(...v.map((x) => x[0])), Math.max(...v.map((x) => x[1]))];
        case "abs": {
          const x = v[0] as Iv;
          if (x[0] >= 0) return x;
          if (x[1] <= 0) return [-x[1], -x[0]];
          return [0, Math.max(-x[0], x[1])];
        }
        case "exp":
          return mono(Math.exp, v[0] as Iv);
        case "log": {
          const x = v[0] as Iv;
          return x[0] > 0 ? mono(Math.log, x) : ALL;
        }
        case "sqrt": {
          const x = v[0] as Iv;
          return x[1] < 0 ? ALL : [Math.sqrt(Math.max(0, x[0])), Math.sqrt(x[1])];
        }
        default: {
          const [x, lo, hi] = v as [Iv, Iv, Iv];
          return [Math.min(Math.max(x[0], lo[0]), hi[0]), Math.min(Math.max(x[1], lo[1]), hi[1])];
        }
      }
    }
  }
}

/**
 * A printed number as the interval it stands for: "0.6" is [0.55, 0.65], "2"
 * is exactly 2 for an input (`exact`), [1.5, 2.5] for an output. Undefined
 * when the text is not one plain number.
 */
export function printed(value: string, exact = false): Iv | undefined {
  const m = /^\s*([-−]?)(\d+)(?:\.(\d+))?\s*$/.exec(value.replace(/,/g, ""));
  if (!m) return undefined;
  const v = Number(`${m[1] ? "-" : ""}${m[2]}${m[3] ? `.${m[3]}` : ""}`);
  if (!m[3] && exact) return [v, v];
  const h = 0.5 * 10 ** -(m[3]?.length ?? 0);
  return [v - h, v + h];
}

export interface FormulaCheck {
  inputs: ReadonlyArray<{ name: string; value: string }>;
  output: string;
}

/**
 * Whether one check passes: the formula over its inputs' printed intervals
 * (with `fixed` ones added) reaches the printed output's interval. Returns the
 * reason when it does not.
 */
export function checkPasses(
  ast: Ast,
  check: FormulaCheck,
  fixed: Readonly<Record<string, Iv>> = {},
): { ok: true } | { ok: false; why: string } {
  const env: Record<string, Iv> = { ...fixed };
  for (const inp of check.inputs) {
    const iv = printed(inp.value, true);
    if (!iv) return { ok: false, why: `"${inp.value}" is not one number` };
    env[inp.name] = iv;
  }
  const out = printed(check.output);
  if (!out) return { ok: false, why: `"${check.output}" is not one number` };
  const missing = variablesOf(ast).filter((v) => !env[v]);
  if (missing.length) return { ok: false, why: `it gives no value for ${missing.join(", ")}` };
  // Naive interval arithmetic widens an expression that reads a variable twice ((1−α²)/(1−α)
  // spans 1.28…1.99 for α in 0.55…0.65, where the truth is 1.55…1.65). So every input box is
  // cut into pieces and each piece evaluated: still an enclosure, and a tight one.
  // A piece whose enclosure is unbounded (a divisor or a log argument that may cross zero there)
  // says nothing: it would "reach" every output, so a formula that is wrong everywhere else
  // would pass on it. Only bounded pieces count; none bounded is a refusal.
  const got = evaluateSplit(ast, env, 8).filter(
    (iv) => Number.isFinite(iv[0]) && Number.isFinite(iv[1]),
  );
  if (!got.length)
    return {
      ok: false,
      why: "the formula cannot be bounded over the printed inputs (a divisor or a log argument crosses zero)",
    };
  if (!got.some((iv) => iv[1] >= out[0] && iv[0] <= out[1])) {
    const lo = Math.min(...got.map((iv) => iv[0]));
    const hi = Math.max(...got.map((iv) => iv[1]));
    return {
      ok: false,
      why: `the formula gives ${fmtIv([lo, hi])} where the source prints ${check.output}`,
    };
  }
  return { ok: true };
}

/**
 * The expression over every piece of its inputs' boxes, each cut into `k`. Only the
 * variables it reads are cut, and `k` shrinks so there are at most 4096 pieces (k^n
 * grows fast; a coarser cut is still an enclosure, only a wider one).
 */
export function evaluateSplit(ast: Ast, env: Readonly<Record<string, Iv>>, k0: number): Iv[] {
  const read = new Set(variablesOf(ast));
  const names = Object.keys(env).filter(
    (n) => read.has(n) && (env[n] as Iv)[0] !== (env[n] as Iv)[1],
  );
  let k = Math.max(1, k0);
  while (k > 1 && k ** names.length > 4096) k--;
  const out: Iv[] = [];
  const walk = (i: number, cur: Record<string, Iv>) => {
    if (i === names.length) {
      out.push(evaluateIv(ast, cur));
      return;
    }
    const n = names[i] as string;
    const [lo, hi] = env[n] as Iv;
    for (let j = 0; j < k; j++)
      walk(i + 1, { ...cur, [n]: [lo + ((hi - lo) * j) / k, lo + ((hi - lo) * (j + 1)) / k] });
  };
  walk(0, { ...env });
  return out;
}

const fmtIv = (iv: Iv) =>
  iv[0] === iv[1]
    ? String(+iv[0].toPrecision(6))
    : `${+iv[0].toPrecision(4)}…${+iv[1].toPrecision(4)}`;
