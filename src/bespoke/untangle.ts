/**
 * The commonest cause of a generated scene failing `seek_order`, removed
 * without a model call: two tweens on ONE target animating ONE property over
 * overlapping time.
 *
 * WHY THAT DEPENDS ON SEEK HISTORY. A GSAP timeline renders its children in
 * start order when the playhead moves forward and in reverse order when it
 * moves back, so inside the overlap the later tween wins on a forward seek and
 * the earlier one on a backward seek. MEASURED 2026-10-09: a ko scene tweened
 * `#SCENEID-sources` to opacity 0.3 (in an array) and to 0 at the same second;
 * the frame at 8.73s differed by 19,517px between ascending and descending
 * seeks, and the beat fell back after its critique round.
 *
 * THE FIX keeps the LATER intent, which is what a forward viewing shows:
 *  - an earlier tween that overlaps a later one on the same (target, property)
 *    is shortened to end where the later one starts;
 *  - two that start at the same second: the earlier-written one loses that
 *    target (from its array) or that property (from its vars), and is removed
 *    if nothing is left.
 * Only tweens it can read exactly — a literal position, a literal target or a
 * top-level variable holding literal selectors, no stagger/repeat/keyframes on
 * the one it edits — are touched; anything else is left for the gate to judge.
 */
import { type Node, parse } from "acorn";

type AnyNode = Node & Record<string, unknown>;

/** Vars that are not animated properties. */
const META = new Set([
  "duration",
  "ease",
  "delay",
  "stagger",
  "repeat",
  "yoyo",
  "repeatDelay",
  "immediateRender",
  "overwrite",
  "transformOrigin",
  "snap",
  "keyframes",
]);

interface Tween {
  call: AnyNode;
  statement: AnyNode | undefined;
  targets: string[];
  /** The target argument when it is an array literal of strings (editable). */
  array?: AnyNode;
  vars: AnyNode;
  props: string[];
  start: number;
  end: number;
  /** Plain enough to shorten or strip. */
  plain: boolean;
  duration?: AnyNode;
}

const num = (n: AnyNode | undefined) =>
  n?.type === "Literal" && typeof n.value === "number" ? n.value : undefined;
const str = (n: AnyNode | undefined) =>
  n?.type === "Literal" && typeof n.value === "string" ? n.value : undefined;

function propOf(obj: AnyNode, key: string): AnyNode | undefined {
  for (const p of obj.properties as AnyNode[]) {
    if (p.type !== "Property" || p.computed) continue;
    const k = p.key as AnyNode;
    if ((k.type === "Identifier" ? k.name : k.value) === key) return p;
  }
  return undefined;
}

function keys(obj: AnyNode): string[] {
  return (obj.properties as AnyNode[]).flatMap((p) => {
    if (p.type !== "Property" || p.computed) return [];
    const k = p.key as AnyNode;
    const name = String(k.type === "Identifier" ? k.name : k.value);
    const v = p.value as AnyNode;
    if ((name === "attr" || name === "css") && v.type === "ObjectExpression")
      return keys(v).map((x) => `${name}.${x}`);
    return META.has(name) ? [] : [name];
  });
}

function read(script: string): Tween[] | undefined {
  let program: AnyNode;
  try {
    program = parse(script, {
      ecmaVersion: 2022,
      sourceType: "script",
      allowReturnOutsideFunction: true,
    }) as unknown as AnyNode;
  } catch {
    return undefined;
  }
  // Top-level `var x = "sel"` / `var x = ["a", "b"]`.
  const names = new Map<string, string[]>();
  for (const st of program.body as AnyNode[]) {
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations as AnyNode[]) {
      const id = d.id as AnyNode;
      const init = d.init as AnyNode | undefined;
      if (id.type !== "Identifier" || !init) continue;
      const s = str(init);
      if (s !== undefined) names.set(id.name as string, [s]);
      else if (init.type === "ArrayExpression") {
        const all = (init.elements as AnyNode[]).map(str);
        if (all.every((x) => x !== undefined)) names.set(id.name as string, all as string[]);
      }
    }
  }
  const out: Tween[] = [];
  for (const st of program.body as AnyNode[]) {
    if (st.type !== "ExpressionStatement") continue;
    const call = st.expression as AnyNode;
    if (call.type !== "CallExpression") continue;
    const callee = call.callee as AnyNode;
    if (callee.type !== "MemberExpression" || (callee.object as AnyNode).name !== "tl") continue;
    const method = (callee.property as AnyNode).name;
    if (method !== "to" && method !== "set") continue;
    const [t, vars, at] = call.arguments as AnyNode[];
    const start = num(at);
    if (!t || !vars || vars.type !== "ObjectExpression" || start === undefined) continue;
    let targets: string[] | undefined;
    let array: AnyNode | undefined;
    if (str(t) !== undefined) targets = [str(t) as string];
    else if (t.type === "ArrayExpression") {
      const all = (t.elements as AnyNode[]).map(str);
      if (all.every((x) => x !== undefined)) {
        targets = all as string[];
        array = t;
      }
    } else if (t.type === "Identifier") targets = names.get(t.name as string);
    if (!targets) continue;
    const dNode = propOf(vars, "duration");
    const duration = method === "set" ? 0 : (num(dNode?.value as AnyNode) ?? 0.5);
    const repeat = num(propOf(vars, "repeat")?.value as AnyNode) ?? 0;
    const repeatDelay = num(propOf(vars, "repeatDelay")?.value as AnyNode) ?? 0;
    const complex = ["stagger", "keyframes", "repeat", "delay"].some((k) => propOf(vars, k));
    out.push({
      call,
      statement: st,
      targets,
      ...(array ? { array } : {}),
      vars,
      props: keys(vars),
      start,
      end: start + (duration + repeatDelay) * (repeat + 1),
      plain:
        method === "to" &&
        !complex &&
        (dNode === undefined || num(dNode.value as AnyNode) !== undefined),
      ...(dNode ? { duration: dNode } : {}),
    });
  }
  return out;
}

interface Edit {
  from: number;
  to: number;
  text: string;
}

/** One fix for the first tangle found, or undefined when there is none it can fix. */
function oneFix(script: string, tweens: Tween[]): Edit | undefined {
  for (let i = 0; i < tweens.length; i++)
    for (let j = 0; j < tweens.length; j++) {
      if (i === j) continue;
      const a = tweens[i] as Tween;
      const b = tweens[j] as Tween;
      // `a` is the one that yields: it starts first, or at the same time and is written first.
      if (!(a.start < b.start || (a.start === b.start && i < j))) continue;
      if (!(a.end > b.start + 1e-3 && b.end > a.start - 1e-3)) continue;
      const target = a.targets.find((x) => b.targets.includes(x));
      const shared = a.props.filter((p) => b.props.includes(p));
      if (!target || shared.length === 0 || !a.plain) continue;
      if (a.start < b.start) {
        const d = Math.round((b.start - a.start) * 1000) / 1000;
        if (a.duration)
          return {
            from: (a.duration.value as AnyNode).start,
            to: (a.duration.value as AnyNode).end,
            text: String(d),
          };
        return { from: a.vars.start + 1, to: a.vars.start + 1, text: ` duration: ${d},` };
      }
      // Same second. Strip the target, else the properties, else the whole tween.
      if (a.array && a.targets.length > 1) {
        const el = (a.array.elements as AnyNode[]).find((e) => str(e) === target) as AnyNode;
        const els = a.array.elements as AnyNode[];
        const k = els.indexOf(el);
        const next = els[k + 1];
        const prev = els[k - 1];
        return next
          ? { from: el.start, to: next.start, text: "" }
          : { from: (prev as AnyNode).end, to: el.end, text: "" };
      }
      if (a.targets.length === 1 && a.props.length > shared.length) {
        const p = (a.vars.properties as AnyNode[]).find((x) => {
          if (x.type !== "Property") return false;
          const k = x.key as AnyNode;
          return shared.includes(String(k.type === "Identifier" ? k.name : k.value));
        });
        if (p) {
          const end = script.slice(p.end).match(/^\s*,\s*/)?.[0].length ?? 0;
          return { from: p.start, to: p.end + end, text: "" };
        }
      }
      if (a.targets.length === 1 && a.statement)
        return {
          from: a.statement.start,
          to: a.statement.end,
          text: "/* untangled: a later tween at the same second owns this property */",
        };
    }
  return undefined;
}

/**
 * The script with every overlap it can read removed, or undefined when it
 * found none to remove. Bounded: at most 40 fixes.
 */
export function untangle(script: string): string | undefined {
  let out = script;
  let changed = false;
  for (let n = 0; n < 40; n++) {
    const tweens = read(out);
    if (!tweens) return undefined;
    const edit = oneFix(out, tweens);
    if (!edit) break;
    out = out.slice(0, edit.from) + edit.text + out.slice(edit.to);
    changed = true;
  }
  return changed ? out : undefined;
}
