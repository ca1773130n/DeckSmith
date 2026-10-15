/**
 * Reading a verb's plan into numbers and op steps: every number is written as
 * the source writes it ("0.6", "1,024") and read here; a name an op does not
 * take, a variant it does not have, a value that is not a number, is refused
 * with the reason, at plan time (the verb's dry run) as at build time.
 */
import { LITERAL_OPS, type LiteralOpDoc, type LiteralOpName } from "../../types.js";
import type { OpStep } from "../ops.js";

/** A number as the source writes it. */
export function num(value: string, what: string): number {
  const v = Number(value.replace(/,/g, "").replace(/−/g, "-").trim());
  if (!value.trim() || !Number.isFinite(v))
    throw new Error(`${what} must be one number as the source writes it, got "${value}"`);
  return v;
}

export interface PlanParam {
  name: string;
  value: string;
  symbol?: string | undefined;
}

/** A param list as numbers by name, against what the op (or rule) takes. */
export function paramRecord(
  params: readonly PlanParam[],
  doc: Pick<LiteralOpDoc, "params">,
  what: string,
  free = false,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    const decl = doc.params?.[p.name];
    if (!decl && !free)
      throw new Error(
        `${what} takes no parameter "${p.name}"${doc.params ? ` (it takes ${Object.keys(doc.params).join(", ")})` : ""}`,
      );
    if (p.name in out) throw new Error(`${what} gives "${p.name}" twice`);
    const v = num(p.value, `${what}'s ${p.name}`);
    if (decl?.int && !Number.isInteger(v))
      throw new Error(`${what}'s ${p.name} must be a whole number, got ${p.value}`);
    out[p.name] = v;
  }
  return out;
}

/** The schema's op step (src/types.ts `literalSchema` operate.chain). */
export interface PlanStep {
  op: LiteralOpName;
  how?: string | undefined;
  stat?: "mean" | "var" | "std" | undefined;
  over?: "all" | "channel" | "row" | undefined;
  params: readonly PlanParam[];
  weights: readonly (readonly number[])[];
  of: readonly number[];
  expr?: string | undefined;
  label: string;
}

/** A chain step read against the library: its variant, enums and params checked. */
export function opStepOf(s: PlanStep, k: number): OpStep {
  const doc = LITERAL_OPS[s.op] as LiteralOpDoc;
  const what = `step ${k} (${s.op})`;
  if (s.how && doc.how && !(s.how in doc.how))
    throw new Error(
      `${what} has no variant "${s.how}" (it has ${Object.keys(doc.how).join(", ")})`,
    );
  if (s.how && !doc.how) throw new Error(`${what} takes no \`how\``);
  const how = s.how ?? doc.defaultHow;
  if (doc.how && !how)
    throw new Error(`${what} needs \`how\` (${Object.keys(doc.how).join(", ")})`);
  for (const [field, v] of [
    ["stat", s.stat],
    ["over", s.over],
  ] as const)
    if (v !== undefined && !doc.enums?.[field]?.[v])
      throw new Error(
        `${what} takes no \`${field}\` ${v}${doc.enums?.[field] ? ` (${Object.keys(doc.enums[field]).join(", ")})` : ""}`,
      );
  return {
    op: s.op,
    ...(how ? { how } : {}),
    ...(s.stat ? { stat: s.stat } : {}),
    ...(s.over ? { over: s.over } : {}),
    params: paramRecord(s.params, doc, what, s.op === "formula"),
    ...(s.weights.length ? { weights: s.weights } : {}),
    ...(s.of.length ? { of: s.of } : {}),
    ...(s.expr ? { expr: s.expr } : {}),
  };
}

/** A computed value as words: up to 3 significant decimals, no float dust. */
export function plain(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return String(Number(v.toFixed(d)));
}
