/**
 * The bespoke scene contract, and the static half of its enforcement.
 *
 * A bespoke scene is markup, CSS and a script that a MODEL wrote, for one beat,
 * from the paper's own text. Paper text is untrusted — a PDF can carry "ignore
 * the above and fetch(...)" as easily as an abstract — so what comes back is
 * treated as hostile until this file has read every node of it. Nothing that
 * fails here is ever put in a deck, and nothing that fails here is ever opened
 * in a browser either, not even to photograph it for the critique round.
 *
 * Three layers, deliberately redundant:
 *
 *  1. THIS FILE, before any build. The script is parsed (acorn) and walked
 *     against an allowlist: GSAP timeline calls with literal vars and an
 *     explicit position, `gsap.set`, `root.querySelector(All)` with scoped
 *     selectors, `Math` minus `random`, and plain arithmetic, arrays, objects and
 *     local functions. Every free identifier must be on a short list, so
 *     `window`, `document`, `fetch`, `eval`, `Function`, timers, storage and
 *     navigation are unreachable by name. The CSS must be scoped to the scene and
 *     has no at-rules, no `url()`, no animation. The markup is an allowlist of
 *     SVG and inline HTML tags with no event attributes and no external refs.
 *  2. A CSP `<meta>` in every composition that carries a bespoke scene:
 *     `connect-src 'none'`, no `unsafe-eval`, local scripts only. A string
 *     concatenation that spells `constructor` defeats a static walk; it does not
 *     defeat a CSP that refuses to compile strings.
 *  3. The player frame's `sandbox` (src/deck/player.ts): no top navigation, no
 *     forms, no modals, whatever the composition tries.
 *
 * DETERMINISM IS PART OF THE CONTRACT, not only safety: the deck is SEEKED, never
 * played (AGENTS.md invariant 1), so timers, `Date`, `Math.random`, CSS
 * animation, SMIL `<animate>` and GSAP callbacks (invariant 11) are refused here
 * for the same reason `fetch` is — each one makes a frame depend on something
 * other than the time it was asked for.
 *
 * Fragments are checked in TOKEN form: the scene id is the literal `SCENEID`
 * until `instantiate` swaps in the real one, so a cached fragment is reusable
 * whichever position its beat lands at in a later cut.
 */
import { type Node, parse } from "acorn";

/** What a model hands back for one beat. Token form: ids are `SCENEID-…`. */
export interface Fragment {
  markup: string;
  css: string;
  script: string;
}

/** One reason a fragment may not be used. */
export interface StaticFinding {
  rule: string;
  message: string;
}

/** The placeholder scene id a fragment is written against. */
export const SID_TOKEN = "SCENEID";

/** Bounds on what one scene may weigh. A scene that needs more is not a scene. */
export const MAX_SCRIPT = 40_000;
export const MAX_MARKUP = 60_000;
export const MAX_CSS = 12_000;

/** The fragment with the real scene id in place of the token. */
export function instantiate(f: Fragment, sid: string): Fragment {
  const swap = (s: string) => s.split(SID_TOKEN).join(sid);
  return { markup: swap(f.markup), css: swap(f.css), script: swap(f.script) };
}

/** Every reason this fragment may not be built. Empty means it may. */
export function checkFragment(f: Fragment, ctx: FragmentContext = {}): StaticFinding[] {
  return [
    ...checkMarkup(f.markup, ctx),
    ...checkCueGroups(f.markup),
    ...checkCss(f.css),
    ...checkScript(f.script),
  ];
}

/* ----------------------------------------------------------------- selectors */

/**
 * A selector is scoped when it starts with the scene's own id and the next
 * character cannot continue that id: `#SCENEID`, `#SCENEID .x`, `#SCENEID-dot3`
 * — but not `#SCENEIDX`, which after instantiation is `#s70` against `#s7`.
 */
const SCOPED = new RegExp(`^#${SID_TOKEN}(?![A-Za-z0-9_])`);

export function scopedSelector(selector: string): boolean {
  const parts = selector.split(",").map((p) => p.trim());
  return parts.length > 0 && parts.every((p) => p.length > 0 && SCOPED.test(p));
}

/* -------------------------------------------------------------------- markup */

/**
 * SVG and a little inline HTML. Lower-cased, because SVG's camelCase tag names
 * (`linearGradient`) arrive in either case from a model.
 *
 * Absent ON PURPOSE: `script`, `style`, `iframe`, `object`, `embed`, `img`,
 * `image`, `foreignObject`, `a`, `form`, `input`, `video`, `audio`, `link`,
 * `meta`, `base`, `canvas`, and every SMIL element (`animate`, `set`,
 * `animateMotion`, `animateTransform`), which run on the wall clock and so
 * break seek-only capture exactly as a CSS animation would.
 */
const TAGS = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "line",
  "polyline",
  "polygon",
  "rect",
  "circle",
  "ellipse",
  "text",
  "tspan",
  "marker",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "pattern",
  "symbol",
  "use",
  "title",
  "desc",
  "filter",
  "fegaussianblur",
  "femerge",
  "femergenode",
  "feoffset",
  "feflood",
  "fecomposite",
  "fecolormatrix",
  "feblend",
  "fedropshadow",
  "femorphology",
  "div",
  "span",
  "b",
  "strong",
  "em",
  "i",
  "sub",
  "sup",
  "br",
  "small",
  "p",
  // Only as the beat's illustration: `<image data-art="1">` with NO href — the
  // shell writes the href, to a file of its own naming (see `checkMarkup`).
  "image",
]);

/** What `checkFragment` needs to know about the beat beyond the fragment. */
export interface FragmentContext {
  /** Whether the beat has an illustration a scene may place (`<image data-art="1">`). */
  art?: boolean;
}

/** Ids the shell owns inside a bespoke scene: the body box, eyebrow, headline, camera. */
const SHELL_IDS = /^SCENEID-(g|e|h|cam)$/;

/** `url(#SCENEID-…)` is a reference inside the scene; every other `url(` is a fetch. */
const LOCAL_URL = new RegExp(`url\\(\\s*['"]?#${SID_TOKEN}-[\\w-]+['"]?\\s*\\)`, "g");

function foreignUrl(value: string): boolean {
  return /url\s*\(/i.test(value.replace(LOCAL_URL, ""));
}

/** CSS that would run on its own clock, fetch, or reach outside the scene. */
function badStyle(value: string): string | undefined {
  const v = value.toLowerCase();
  if (foreignUrl(value)) return "url()";
  for (const word of [
    "@",
    "expression",
    "behavior",
    "-moz-binding",
    "javascript:",
    "animation",
    "transition",
    "\\",
  ]) {
    if (v.includes(word)) return word;
  }
  if (/position\s*:\s*fixed/.test(v)) return "position:fixed";
  return undefined;
}

export function checkMarkup(markup: string, ctx: FragmentContext = {}): StaticFinding[] {
  const out: StaticFinding[] = [];
  const bad = (rule: string, message: string) => out.push({ rule, message });
  if (markup.length > MAX_MARKUP) bad("markup_size", `markup is ${markup.length} bytes`);
  if (/<!(?!--)/.test(markup))
    bad("markup_declaration", "markup carries a <! declaration or CDATA");
  if (/<\?/.test(markup)) bad("markup_declaration", "markup carries a processing instruction");
  // Comments are dropped before tags are read, so a tag inside one is not run —
  // and a `-->` smuggled into an attribute cannot open a window either, because
  // nothing here is fed to a parser that treats comments specially.
  const body = markup.replace(/<!--[\s\S]*?-->/g, "");
  if (/<!--/.test(body)) bad("markup_declaration", "an unterminated comment");

  const ids = new Set<string>();
  const tag = /<\/?\s*([A-Za-z][\w:.-]*)([^>]*)>/g;
  for (const m of body.matchAll(tag)) {
    const name = (m[1] ?? "").toLowerCase();
    if (!TAGS.has(name)) {
      bad("markup_tag", `<${m[1]}> is not allowed in a bespoke scene`);
      continue;
    }
    if (m[0].startsWith("</")) continue;
    const attrs = m[2] ?? "";
    if (name === "image") {
      // The illustration, and only it: the shell supplies the href, so a model
      // can neither name a file nor reach one, and a beat without a picture
      // cannot show one.
      if (!/\sdata-art\s*=\s*["']?1["']?(?=[\s/>]|$)/.test(` ${attrs}`))
        bad(
          "markup_art",
          '<image> is only the beat\'s illustration: <image data-art="1" …> with no href',
        );
      else if (!ctx.art)
        bad("markup_art", "<image data-art> places an illustration this beat does not have");
      if (/\s(xlink:)?href\s*=/i.test(` ${attrs}`))
        bad(
          "markup_ref",
          "<image href=…>: the shell writes the illustration's href, never the scene",
        );
    }
    for (const a of attrs.matchAll(/([^\s=/"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
      const attr = (a[1] ?? "").toLowerCase();
      const raw = a[2] ?? "";
      const value = raw.replace(/^["']|["']$/g, "");
      if (attr.startsWith("on")) bad("markup_event", `<${name} ${attr}=…> is an event handler`);
      else if (attr === "href" || attr === "xlink:href") {
        if (!value.startsWith(`#${SID_TOKEN}-`))
          bad("markup_ref", `<${name} ${attr}="${value.slice(0, 40)}"> reaches outside the scene`);
      } else if (attr === "src" || attr === "srcset" || attr === "action" || attr === "formaction")
        bad("markup_ref", `<${name} ${attr}=…> loads something`);
      else if (attr === "style") {
        const why = badStyle(value);
        if (why) bad("markup_style", `<${name} style=…> uses ${why}`);
      } else if (attr === "id") {
        if (!new RegExp(`^${SID_TOKEN}-[\\w-]+$`).test(value))
          bad("markup_id", `id "${value}" is not scoped — every id is ${SID_TOKEN}-<name>`);
        else if (SHELL_IDS.test(value))
          bad(
            "markup_id",
            `id "${value}" is the shell's — the body box, eyebrow, headline or camera`,
          );
        else if (ids.has(value)) bad("markup_id", `id "${value}" is used twice`);
        ids.add(value);
      } else if (attr === "data-cue") {
        // The cue a group arrives on: `early_reveal` holds the scene to it.
        if (!/^[1-9][0-9]?$/.test(value))
          bad("markup_cue", `data-cue="${value.slice(0, 20)}" is not a cue number (1, 2, 3 …)`);
      } else if ((attr === "d" && name === "path") || (attr === "points" && name !== "svg")) {
        // Geometry is numbers and path commands. Anything else is a console
        // error in every scene of the page (MEASURED 2026-10-09: one draft's
        // d="M 95 240 H  sixty" failed all five drafts of a deck as page_error).
        if (!/^[\sMmLlHhVvCcSsQqTtAaZz0-9.,eE+-]*$/.test(value))
          bad("markup_geometry", `<${name} ${attr}="${value.slice(0, 40)}"> is not path data`);
      } else if (foreignUrl(value)) bad("markup_ref", `<${name} ${attr}=…> uses url()`);
      if (/javascript:/i.test(value)) bad("markup_ref", `<${name} ${attr}=…> names javascript:`);
    }
    const size = /font-size\s*[:=]\s*["']?\s*([\d.]+)/i.exec(attrs);
    if (size && Number(size[1]) < 40)
      bad(
        "markup_type_floor",
        `<${name}> sets font-size ${size[1]} — audience text is 40px or more`,
      );
  }
  return out;
}

/**
 * Semantic grouping (Vector Prism, arXiv 2512.14336): the parts a cue brings on
 * move as one group, and the group says which cue that is — which is also what
 * `early_reveal` holds the scene to. A whole scene needs at least two.
 */
function checkCueGroups(markup: string): StaticFinding[] {
  const body = markup.replace(/<!--[\s\S]*?-->/g, "");
  const n = [...body.matchAll(/\sdata-cue\s*=/gi)].length;
  return n >= 2
    ? []
    : [
        {
          rule: "markup_cue",
          message: `${n} element(s) carry data-cue — group each part a cue introduces in a <g id="${SID_TOKEN}-…" data-cue="N">`,
        },
      ];
}

/* ----------------------------------------------------------------------- css */

export function checkCss(css: string): StaticFinding[] {
  const out: StaticFinding[] = [];
  const bad = (rule: string, message: string) => out.push({ rule, message });
  if (css.length > MAX_CSS) bad("css_size", `css is ${css.length} bytes`);
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const why = badStyle(text);
  if (why) bad("css_forbidden", `the stylesheet uses ${why}`);
  if (/<\/?\s*style/i.test(text)) bad("css_forbidden", "the stylesheet closes its own tag");
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth < 0 || depth > 1) {
      bad("css_nesting", "nested or unbalanced braces");
      return out;
    }
  }
  if (depth !== 0) bad("css_nesting", "unbalanced braces");
  for (const rule of text.split("}")) {
    const open = rule.indexOf("{");
    if (open < 0) {
      if (rule.trim()) bad("css_syntax", `stray text "${rule.trim().slice(0, 40)}"`);
      continue;
    }
    const selector = rule.slice(0, open).trim();
    if (!scopedSelector(selector))
      bad("css_scope", `"${selector.slice(0, 60)}" is not scoped to #${SID_TOKEN}`);
    for (const m of rule.slice(open + 1).matchAll(/font-size\s*:\s*([\d.]+)px/gi)) {
      if (Number(m[1]) < 40)
        bad("css_type_floor", `font-size ${m[1]}px — audience text is 40px or more`);
    }
  }
  return out;
}

/* -------------------------------------------------------------------- script */

/**
 * Names that may be used without being declared. The shell passes `tl` and
 * `root` in; the rest are the pure parts of the language. `Array` is here for
 * `Array.from` over a NodeList, and nothing else on it is reachable that matters.
 */
const GLOBALS = new Set([
  "tl",
  "root",
  "gsap",
  "Math",
  "Number",
  "Array",
  "parseFloat",
  "parseInt",
  "isFinite",
  "Infinity",
  "NaN",
  "undefined",
]);

/**
 * Names refused anywhere — as an identifier, a property or a string. Spelling
 * one in a string is how a static walk is usually evaded (`x["constructor"]`),
 * so the string form is refused too; a concatenation that assembles one at run
 * time is the CSP's to stop.
 */
const DENY_NAMES = new Set([
  "eval",
  "Function",
  "constructor",
  "__proto__",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "window",
  "document",
  "globalThis",
  "self",
  "top",
  "parent",
  "frames",
  "opener",
  "location",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "navigator",
  "sendBeacon",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "cookie",
  "importScripts",
  "Worker",
  "SharedWorker",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "requestAnimationFrame",
  "requestIdleCallback",
  "queueMicrotask",
  "Date",
  "performance",
  "crypto",
  "postMessage",
  "alert",
  "confirm",
  "prompt",
  "Reflect",
  "Proxy",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "srcdoc",
  "createElement",
  "createElementNS",
  "appendChild",
  "parentNode",
  "parentElement",
  "ownerDocument",
  "ownerSVGElement",
  "defaultView",
  "contentWindow",
  "contentDocument",
  "getRootNode",
  "closest",
  "baseURI",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "getBBox",
  "getBoundingClientRect",
  "getClientRects",
  "getComputedTextLength",
  "getComputedStyle",
  "offsetWidth",
  "offsetHeight",
  "clientWidth",
  "clientHeight",
  "scrollWidth",
  "scrollHeight",
  "toString",
  "fromCharCode",
  "fromCodePoint",
  "String",
  "Symbol",
  "Object",
  "JSON",
  "atob",
  "btoa",
]);

/** GSAP: what a seek-only scene may ask of it. No `from`, no `to` off the timeline, no ticker. */
const GSAP_OK = new Set(["set", "utils"]);
const UTILS_OK = new Set(["interpolate", "clamp", "mapRange", "normalize", "snap", "wrap"]);
/** The scene's timeline: tweens at explicit positions, and nothing that plays it or calls back. */
const TL_OK = new Set(["to", "fromTo", "set"]);
const ROOT_OK = new Set(["querySelector", "querySelectorAll"]);

/** Vars keys that make state depend on something other than the seek time. */
const VAR_DENY = /^(on[A-Z]\w*|callbackScope|paused|repeatRefresh)$/;

/** Node types the walk accepts. Anything else — `new`, `this`, classes, `with`, labels, loops without a bound — is refused. */
const NODES = new Set([
  "Program",
  "ExpressionStatement",
  "VariableDeclaration",
  "VariableDeclarator",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "BlockStatement",
  "ReturnStatement",
  "IfStatement",
  "ForStatement",
  "ForOfStatement",
  "BreakStatement",
  "ContinueStatement",
  "EmptyStatement",
  "ConditionalExpression",
  "BinaryExpression",
  "LogicalExpression",
  "UnaryExpression",
  "UpdateExpression",
  "AssignmentExpression",
  "SequenceExpression",
  "ObjectExpression",
  "Property",
  "ArrayExpression",
  "SpreadElement",
  "Literal",
  "TemplateLiteral",
  "TemplateElement",
  "CallExpression",
  "MemberExpression",
  "Identifier",
  "ArrayPattern",
  "ObjectPattern",
  "AssignmentPattern",
  "ChainExpression",
]);

type AnyNode = Node & Record<string, unknown>;

function children(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range")
      continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v && typeof v === "object" && "type" in v) out.push(v as AnyNode);
    } else if (value && typeof value === "object" && "type" in value) out.push(value as AnyNode);
  }
  return out;
}

/** Every name the script declares anywhere: one flat scope, which over-admits only the script's own locals. */
function declared(root: AnyNode): Set<string> {
  const names = new Set<string>();
  const bind = (p: AnyNode | null | undefined) => {
    if (!p) return;
    if (p.type === "Identifier") names.add(p.name as string);
    else if (p.type === "ArrayPattern") for (const e of p.elements as AnyNode[]) bind(e);
    else if (p.type === "ObjectPattern")
      for (const prop of p.properties as AnyNode[]) bind((prop.value ?? prop.argument) as AnyNode);
    else if (p.type === "AssignmentPattern") bind(p.left as AnyNode);
    else if (p.type === "RestElement") bind(p.argument as AnyNode);
  };
  const walk = (n: AnyNode) => {
    if (n.type === "VariableDeclarator") bind(n.id as AnyNode);
    if (n.type === "FunctionDeclaration" && n.id) bind(n.id as AnyNode);
    if (
      n.type === "FunctionDeclaration" ||
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression"
    )
      for (const p of n.params as AnyNode[]) bind(p);
    for (const c of children(n)) walk(c);
  };
  walk(root);
  return names;
}

/** The leftmost string a target expression starts with, if it is built from one. */
function leadingString(n: AnyNode): string | undefined {
  if (n.type === "Literal" && typeof n.value === "string") return n.value;
  if (n.type === "TemplateLiteral") {
    const first = (n.quasis as AnyNode[])[0];
    return (first?.value as { cooked?: string } | undefined)?.cooked ?? "";
  }
  if (n.type === "BinaryExpression" && n.operator === "+") return leadingString(n.left as AnyNode);
  return undefined;
}

/** Whether an expression contains a string literal or template — i.e. could spell a property name. */
function spellsName(n: AnyNode): boolean {
  if (n.type === "Literal") return typeof n.value === "string";
  if (n.type === "TemplateLiteral") return true;
  return children(n).some(spellsName);
}

/** Whether an expression contains a function — one GSAP would call later, outside this check's reach. */
function holdsFunction(n: AnyNode): boolean {
  if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") return true;
  return children(n).some(holdsFunction);
}

function memberName(n: AnyNode): string | undefined {
  if (n.type !== "MemberExpression") return undefined;
  const p = n.property as AnyNode;
  if (!n.computed && p.type === "Identifier") return p.name as string;
  if (p.type === "Literal" && typeof p.value === "string") return p.value;
  return undefined;
}

function rootName(n: AnyNode): string | undefined {
  let at = n;
  while (at.type === "MemberExpression") at = at.object as AnyNode;
  return at.type === "Identifier" ? (at.name as string) : undefined;
}

export function checkScript(script: string): StaticFinding[] {
  const out: StaticFinding[] = [];
  const bad = (rule: string, message: string) => out.push({ rule, message });
  if (script.length > MAX_SCRIPT) bad("script_size", `script is ${script.length} bytes`);

  let program: AnyNode;
  try {
    program = parse(script, {
      ecmaVersion: 2022,
      sourceType: "script",
      allowReturnOutsideFunction: true,
    }) as unknown as AnyNode;
  } catch (err) {
    return [{ rule: "script_syntax", message: err instanceof Error ? err.message : String(err) }];
  }
  const locals = declared(program);
  for (const name of locals) {
    if (GLOBALS.has(name)) bad("script_shadow", `"${name}" is redeclared — it is the shell's`);
  }

  const visit = (n: AnyNode, parentNode?: AnyNode) => {
    if (!NODES.has(n.type)) {
      bad("script_node", `${n.type} is not allowed in a bespoke scene`);
      return;
    }
    switch (n.type) {
      case "Identifier": {
        const name = n.name as string;
        if (DENY_NAMES.has(name)) bad("script_name", `"${name}" is not reachable from a scene`);
        // A reference, not a property name or an object key: those are checked
        // where they occur. A free name must be one the shell provides.
        const isKey =
          (parentNode?.type === "MemberExpression" &&
            parentNode.property === n &&
            !parentNode.computed) ||
          (parentNode?.type === "Property" && parentNode.key === n && !parentNode.computed);
        if (!isKey && !locals.has(name) && !GLOBALS.has(name))
          bad(
            "script_global",
            `"${name}" is not defined in a scene — only ${[...GLOBALS].join(", ")}`,
          );
        break;
      }
      case "Literal": {
        if (typeof n.value === "string") {
          const s = n.value;
          if (DENY_NAMES.has(s))
            bad("script_name", `the string "${s}" names something unreachable`);
          if (/random\s*\(/i.test(s))
            bad("script_random", `"${s.slice(0, 40)}" is GSAP's random()`);
          if (/url\s*\(/i.test(s) && foreignUrl(s))
            bad("script_url", `"${s.slice(0, 40)}" loads a url()`);
          if (/javascript:/i.test(s)) bad("script_url", "a javascript: string");
        }
        if ((n as { regex?: unknown }).regex)
          bad("script_node", "regular expressions are not needed");
        break;
      }
      case "TemplateElement": {
        const s = (n.value as { cooked?: string }).cooked ?? "";
        if (/random\s*\(/i.test(s)) bad("script_random", "a template spells GSAP's random()");
        if (/url\s*\(/i.test(s) && foreignUrl(s)) bad("script_url", "a template loads a url()");
        break;
      }
      case "ForStatement":
        if (!n.test) bad("script_loop", "a for loop with no condition never ends");
        break;
      case "VariableDeclaration":
        break;
      case "Property": {
        const key = n.key as AnyNode;
        const name = key.type === "Identifier" ? (key.name as string) : String(key.value ?? "");
        if (n.kind !== "init" || n.method)
          bad("script_node", "getters, setters and methods are not needed");
        if (VAR_DENY.test(name))
          bad(
            "script_callback",
            `"${name}" — GSAP callbacks and paused state are refused (invariant 11)`,
          );
        if (DENY_NAMES.has(name)) bad("script_name", `"${name}" is not reachable from a scene`);
        if (name === "repeat") {
          const v = n.value as AnyNode;
          const num = v.type === "Literal" ? v.value : undefined;
          if (typeof num !== "number" || num < 0 || num > 60)
            bad(
              "script_repeat",
              "repeat must be a literal between 0 and 60 — infinite loops have no end state to seek to",
            );
        }
        if (
          name === "from" &&
          (n.value as AnyNode).type === "Literal" &&
          (n.value as AnyNode).value === "random"
        )
          bad("script_random", 'stagger from:"random" is Math.random');
        break;
      }
      case "MemberExpression": {
        // A computed key may index (`pts[i]`, `tones[k]`) but may not SPELL a
        // name: a string, a template or a concatenation in the brackets is how
        // `el["owner" + "Document"]` walks out of the scene past every list above.
        if (n.computed && spellsName(n.property as AnyNode))
          bad(
            "script_computed",
            "a computed property built from strings — index with a number or a variable",
          );
        const name = memberName(n);
        if (name !== undefined && DENY_NAMES.has(name))
          bad("script_name", `".${name}" is not reachable from a scene`);
        const obj = n.object as AnyNode;
        if (obj.type === "Identifier") {
          const o = obj.name as string;
          const allowed =
            o === "gsap" ? GSAP_OK : o === "tl" ? TL_OK : o === "root" ? ROOT_OK : undefined;
          if (allowed && (name === undefined || !allowed.has(name)))
            bad("script_api", `${o}.${name ?? "[…]"} is not part of the scene contract`);
          if (o === "Math" && (name === undefined || name === "random"))
            bad(
              "script_random",
              `Math.${name ?? "[…]"} is refused — a frame must be a function of time alone`,
            );
        }
        if (
          obj.type === "MemberExpression" &&
          rootName(obj) === "gsap" &&
          memberName(obj) === "utils"
        ) {
          if (name === undefined || !UTILS_OK.has(name))
            bad("script_api", `gsap.utils.${name ?? "[…]"} is not part of the scene contract`);
        }
        break;
      }
      case "AssignmentExpression": {
        const left = n.left as AnyNode;
        if (left.type === "Identifier") {
          if (!locals.has(left.name as string))
            bad("script_global", `assigns to "${left.name}", which the scene did not declare`);
        } else if (left.type === "MemberExpression") {
          const r = rootName(left);
          if (r && GLOBALS.has(r))
            bad("script_api", `assigns into ${r} — the shell's objects are read-only to a scene`);
          if (holdsFunction(n.right as AnyNode))
            bad(
              "script_callback",
              "stores a function on an object — nothing may call scene code later",
            );
        }
        break;
      }
      case "CallExpression":
        checkCall(n, bad);
        break;
    }
    for (const c of children(n)) visit(c, n);
  };
  visit(program);
  // One message per distinct finding: a model that wrote `Date` nine times needs to hear it once.
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.rule}|${f.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The value of `key` in an object literal, if it is written there. */
function prop(obj: AnyNode, key: string): AnyNode | undefined {
  for (const p of obj.properties as AnyNode[]) {
    if (p.type !== "Property") continue;
    const k = p.key as AnyNode;
    const name = k.type === "Identifier" && !p.computed ? k.name : k.value;
    if (name === key) return p.value as AnyNode;
  }
  return undefined;
}

/**
 * `morphSVG` takes path data or a SELECTOR, and MorphSVG resolves a selector
 * against the whole document — so a selector here is a target like any other
 * and must be the scene's own. Path data (`"M0 0 …"`) reads nothing.
 */
function checkMorph(vars: AnyNode, what: string, bad: (rule: string, message: string) => void) {
  const v = prop(vars, "morphSVG");
  if (!v) return;
  const shape = v.type === "ObjectExpression" ? prop(v, "shape") : v;
  const s = shape ? leadingString(shape) : undefined;
  if (s === undefined) {
    bad("script_morph", `${what}: morphSVG needs a literal — "#${SID_TOKEN}-…" or path data`);
    return;
  }
  if (!/^\s*[Mm]/.test(s) && !scopedSelector(s.length ? s : "?"))
    bad(
      "script_scope",
      `${what} morphs to "${s.slice(0, 50)}", which is not scoped to #${SID_TOKEN}`,
    );
}

/**
 * The kinds of motion a scene's timeline uses, read off its tweens' vars —
 * for the report, and for the rubric probe that decides whether a scene that
 * passed every gate still needs the critique round. Static, so it is a
 * statement about what the script ASKS for; the frames say whether it shows.
 */
export const MOTION_KINDS = [
  "draw",
  "morph",
  "camera",
  "counter",
  "stagger",
  "flow",
  "move",
  "scale",
  "focus",
  "recolor",
] as const;
export type MotionKind = (typeof MOTION_KINDS)[number];

export function motionKinds(script: string): MotionKind[] {
  let program: AnyNode;
  try {
    program = parse(script, {
      ecmaVersion: 2022,
      sourceType: "script",
      allowReturnOutsideFunction: true,
    }) as unknown as AnyNode;
  } catch {
    return [];
  }
  const kinds = new Set<MotionKind>();
  const keysOf = (o: AnyNode): string[] =>
    (o.properties as AnyNode[]).flatMap((p) => {
      if (p.type !== "Property") return [];
      const k = p.key as AnyNode;
      const name = String(k.type === "Identifier" ? k.name : k.value);
      const v = p.value as AnyNode;
      return v.type === "ObjectExpression" && (name === "attr" || name === "css")
        ? keysOf(v).map((x) => `${name}.${x}`)
        : [name];
    });
  const num = (v: AnyNode | undefined) =>
    v?.type === "Literal" && typeof v.value === "number" ? v.value : undefined;
  const walk = (n: AnyNode) => {
    if (n.type === "CallExpression") {
      const callee = n.callee as AnyNode;
      const obj = callee.type === "MemberExpression" ? (callee.object as AnyNode) : undefined;
      const method = memberName(callee);
      if (
        obj?.type === "Identifier" &&
        obj.name === "tl" &&
        (method === "to" || method === "fromTo")
      ) {
        const args = n.arguments as AnyNode[];
        const vars = args[method === "fromTo" ? 2 : 1];
        const target = leadingString(args[0] as AnyNode) ?? "";
        if (vars?.type === "ObjectExpression") {
          const keys = keysOf(vars);
          const has = (re: RegExp) => keys.some((k) => re.test(k));
          const repeat = num(prop(vars, "repeat")) ?? 0;
          if (has(/^drawSVG$/)) kinds.add("draw");
          if (has(/^morphSVG$/)) kinds.add("morph");
          if (has(/^attr\.viewBox$/) || /-cam(?![\w-])/.test(target)) kinds.add("camera");
          if (has(/^(textContent|innerText)$/)) kinds.add("counter");
          if (has(/^stagger$/)) kinds.add("stagger");
          const moves = has(
            /^(x|y|xPercent|yPercent|keyframes|strokeDashoffset|attr\.(cx|cy|x|y|x1|y1|x2|y2|points|d))$/,
          );
          if (moves && (repeat > 0 || has(/^keyframes$/) || has(/^strokeDashoffset$/)))
            kinds.add("flow");
          else if (moves) kinds.add("move");
          if (has(/^(scale|scaleX|scaleY|rotation|attr\.(r|rx|ry|width|height))$/))
            kinds.add("scale");
          const o = num(prop(vars, "opacity"));
          if (o !== undefined && o > 0.05 && o < 0.7) kinds.add("focus");
          if (has(/^(fill|stroke|color|attr\.(fill|stroke)|backgroundColor)$/))
            kinds.add("recolor");
        }
      }
    }
    for (const c of children(n)) walk(c);
  };
  walk(program);
  return MOTION_KINDS.filter((k) => kinds.has(k));
}

function checkCall(n: AnyNode, bad: (rule: string, message: string) => void): void {
  const callee = n.callee as AnyNode;
  const args = n.arguments as AnyNode[];
  if (callee.type !== "MemberExpression") return;
  const obj = callee.object as AnyNode;
  const method = memberName(callee);
  const on = obj.type === "Identifier" ? (obj.name as string) : undefined;

  const scopedTarget = (t: AnyNode | undefined, what: string) => {
    if (!t) return bad("script_target", `${what} has no target`);
    if (t.type === "ArrayExpression") {
      for (const e of t.elements as AnyNode[]) scopedTarget(e, what);
      return;
    }
    const s = leadingString(t);
    if (s !== undefined && !scopedSelector(s.length ? s : "?"))
      bad(
        "script_scope",
        `${what} targets "${s.slice(0, 50)}", which is not scoped to #${SID_TOKEN}`,
      );
  };

  if (on === "root" && (method === "querySelector" || method === "querySelectorAll")) {
    scopedTarget(args[0], `root.${method}`);
    return;
  }
  if ((on === "tl" && method && TL_OK.has(method)) || (on === "gsap" && method === "set")) {
    const what = `${on}.${method}`;
    // Function-based values run when GSAP first renders the tween — later, at a
    // time this walk cannot see, and on every worker's own schedule.
    if (args.some(holdsFunction))
      bad(
        "script_callback",
        `${what} is handed a function — tween values are data, not code (invariant 11)`,
      );
    scopedTarget(args[0], what);
    const vars = method === "fromTo" ? [args[1], args[2]] : [args[1]];
    for (const v of vars) {
      if (v?.type !== "ObjectExpression")
        bad("script_vars", `${what} needs its vars as an object literal, so they can be read here`);
      else checkMorph(v, what, bad);
    }
    if (on === "tl") {
      const posIndex = method === "fromTo" ? 3 : 2;
      const pos = args[posIndex];
      if (!pos)
        bad("script_position", `${what} has no position — every tween sits at an explicit time`);
      else if (pos.type === "Literal" && typeof pos.value === "string")
        bad(
          "script_position",
          `${what} at "${pos.value}" — relative positions depend on insertion order; use seconds`,
        );
    }
  }
}
