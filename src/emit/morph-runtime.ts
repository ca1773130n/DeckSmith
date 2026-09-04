/**
 * The keyed equation morph — TransformMatchingTex, for the DOM.
 *
 * Two KaTeX renderings in, one seek-evaluable plan out. `build()` runs once in
 * the browser, inside the ready gate (Seam B), and bakes every number; the
 * plan is then driven by a GSAP PLUGIN — `render(ratio)` is part of being
 * seeked, so it fires under `suppressEvents` where an `onUpdate` would not
 * (invariant 11). Nothing here runs on a callback.
 *
 * Four phases, kept separate on purpose:
 *   1. LIFT   — pull every ink-bearing leaf out of KaTeX's nested boxes into a
 *               flat absolutely-positioned overlay. Removes clipping, vlist
 *               stacking and transform-on-inline entirely.
 *   2. GROUP  — collect leaves into the units that move as one body. An author
 *               key makes a group; an unkeyed leaf is its own group.
 *   3. MATCH  — decide which group of A becomes which group of B.
 *   4. PLAN   — a similarity transform per group, as per-leaf segments.
 *
 * `evaluate()` turns a plan and a progress into styles. It is a pure function
 * of its arguments — two seeks to one time write the same strings — which is
 * what makes the render byte-identical across browser processes, measured on
 * the spike this is ported from (`experiments/013-vocabulary/morph/`).
 *
 * Bundled to an IIFE by `scripts/build.mjs`, vendored beside GSAP by the CLI,
 * and loaded only by a deck that has a morph in it. The pure halves — `group`,
 * `match`, `plan`, `evaluate` — are exported for the tests, which is why the
 * window registration at the bottom is guarded.
 */

/* ------------------------------------------------------------- 1. LIFT */

/**
 * KaTeX class tokens that say WHAT a box is. Sizes, tightness and vlist
 * plumbing are deliberately excluded from a leaf's identity: a superscript 2
 * and a baseline 2 are the same glyph, and matching them is the entire point.
 * Scale is what the tween is for.
 */
const SIG_CLASSES = new Set([
  "mord",
  "mbin",
  "mrel",
  "mopen",
  "mclose",
  "mpunct",
  "mop",
  "minner",
  "mathnormal",
  "mathrm",
  "mathbf",
  "mathit",
  "mathcal",
  "mathbb",
  "mathsf",
  "mathtt",
  "mathfrak",
  "amsrm",
  "boldsymbol",
  "frac-line",
  "overline-line",
  "underline-line",
  "op-symbol",
  "delimsizing",
]);

/** Ink that carries no text: rules, radicals, big delimiters drawn as SVG. */
const INKY_EMPTY = ".frac-line,.overline-line,.underline-line,.hline,.rule";

/** The class prefix an author key is carried on: `\htmlClass{ds-k-<key>}{...}`. */
export const KEY_PREFIX = "ds-k-";

export interface Leaf {
  el: HTMLElement;
  key: string;
  sig: string;
  text: string;
  /** Font size in layout px. */
  fs: number;
  /** Centre and box, in the host's own layout px. */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface Group {
  ident: string;
  key: string;
  leaves: Leaf[];
  cx: number;
  cy: number;
  w: number;
  h: number;
  fs: number;
  text: string;
}

function sig(el: Element): string {
  const cls: string[] = [];
  for (const c of el.classList) if (SIG_CLASSES.has(c)) cls.push(c);
  cls.sort();
  const text = (el.textContent ?? "").trim();
  return `${text || "∅"} ${cls.join(" ")}`;
}

/** Nearest `ds-k-<key>` on self or an ancestor below `root`, or "". */
function keyOf(el: Element, root: Element): string {
  for (let n: Element | null = el; n && n !== root.parentElement; n = n.parentElement) {
    for (const c of n.classList) if (c.startsWith(KEY_PREFIX)) return c.slice(KEY_PREFIX.length);
  }
  return "";
}

function leavesOf(root: Element): Element[] {
  const seen = new Set<Element>();
  const out: Element[] = [];
  for (const el of root.querySelectorAll("*")) {
    if (el.closest("svg")) continue;
    if (el.childElementCount > 0) continue;
    if (!(el.textContent ?? "").trim()) continue;
    out.push(el);
    seen.add(el);
  }
  for (const el of root.querySelectorAll(INKY_EMPTY)) if (!seen.has(el)) out.push(el);
  for (const el of root.querySelectorAll("svg")) if (!seen.has(el)) out.push(el);
  out.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return out;
}

/**
 * Where a box's text sits, in page coordinates: [left edge, baseline].
 *
 * A zero-size inline-block on the baseline is the only reliable way to ask a
 * browser this. It matters because the clone and the original disagree about
 * their own box even when they agree about the glyph: the original leaf is
 * INLINE, so its rect is the font's content area, while the clone is
 * inline-block, so its rect is its line box. Aligning the two RECTS misplaces
 * the ink by a fraction of a pixel — measured at 7,329 antialiased edge pixels
 * on `\sum` and 3,079 on a `\dfrac`. Aligning the two BASELINES is exact.
 */
function anchor(el: Element): [number, number] {
  const probe = document.createElement("i");
  probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  el.appendChild(probe);
  const p = probe.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  probe.remove();
  return [r.left, p.top];
}

/**
 * Clone each leaf into a flat overlay at its measured centre.
 *
 * The clone keeps the leaf's class list (so `.mathnormal` still selects
 * Computer Modern Italic) but is given its computed font-size explicitly,
 * because the em cascade it inherited from four ancestor boxes does not come
 * with it. It is anchored by its top-left, NOT centred with a
 * `translate(-50%, -50%)`: a resting clone must carry no transform at all,
 * because a transformed glyph is rasterised on Chrome's composited path and
 * that path differed between a cold render worker and a warm one — one
 * `\big)` in 424 pixels, held for 31 frames — where untransformed text did
 * not. Motion is `translate(x, y) scale(s)` about the box centre, which is
 * the default `transform-origin`, so the plan's arithmetic is unchanged.
 *
 * `k` is the host's on-screen scale — `.scene` carries `zoomOf(format)` on
 * every canvas but 1920 wide — so rects, which are screen px, are divided back
 * into the layout px the styles are written in. The camera does the same.
 */
function lift(root: Element, host: HTMLElement, layer: HTMLElement): Leaf[] {
  const H = layer.getBoundingClientRect();
  const k = host.offsetWidth ? host.getBoundingClientRect().width / host.offsetWidth : 1;
  const items: Leaf[] = [];
  for (const el of leavesOf(root)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const text = (el.textContent ?? "").trim();
    const ink = text ? anchor(el) : null;
    const cs = getComputedStyle(el);
    const clone = el.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    const s = clone.style;
    s.position = "absolute";
    s.display = "inline-block";
    s.left = `${(r.left - H.left) / k}px`;
    s.top = `${(r.top - H.top) / k}px`;
    s.fontSize = cs.fontSize;
    s.fontFamily = cs.fontFamily;
    s.fontStyle = cs.fontStyle;
    s.fontWeight = cs.fontWeight;
    s.color = cs.color;
    s.lineHeight = "1";
    s.whiteSpace = "pre";
    s.margin = "0";
    // A `\frac` rule is a border-bottom on a zero-height box, so the measured
    // rect IS the border. Under the default content-box the copied border would
    // be added to that height and the rule would draw a full stroke-width low.
    s.boxSizing = "border-box";
    if (!text) {
      s.width = `${r.width / k}px`;
      s.height = `${r.height / k}px`;
      s.borderBottomWidth = cs.borderBottomWidth;
      s.borderBottomStyle = cs.borderBottomStyle;
      s.borderBottomColor = cs.borderBottomColor;
      s.background = cs.backgroundColor;
    }
    layer.appendChild(clone);
    items.push({
      el: clone,
      key: keyOf(el, root),
      sig: sig(el),
      text,
      fs: Number.parseFloat(cs.fontSize) || 1,
      cx: 0,
      cy: 0,
      w: r.width / k,
      h: r.height / k,
    });
    if (ink) (clone as unknown as { __ink: [number, number] }).__ink = ink;
  }

  // One reflow, then put every clone's baseline exactly where the original's
  // was. Rule-less: whatever the two box models disagree about is cancelled by
  // measuring the disagreement rather than modelling it.
  for (const it of items) {
    const want = (it.el as unknown as { __ink?: [number, number] }).__ink;
    if (!want) continue;
    const got = anchor(it.el);
    const st = it.el.style;
    st.left = `${Number.parseFloat(st.left) + (want[0] - got[0]) / k}px`;
    st.top = `${Number.parseFloat(st.top) + (want[1] - got[1]) / k}px`;
  }
  // The centres the plan moves against must be the CORRECTED ones.
  for (const it of items) {
    const r = it.el.getBoundingClientRect();
    it.cx = (r.left - H.left + r.width / 2) / k;
    it.cy = (r.top - H.top + r.height / 2) / k;
  }
  return items;
}

/* ------------------------------------------------------------ 2. GROUP */

/**
 * The unit that moves as one body.
 *
 * This is the whole quality argument of the file. Matching GLYPH BY GLYPH is
 * what a naive reading of TransformMatchingTex suggests and it is visibly
 * wrong: in `a^2+b^2=c^2 -> c^2-b^2=a^2` the three `2`s are interchangeable
 * under any text-plus-class identity, so they pair left-to-right and stay put
 * while their bases cross over. The audience sees the letters swap and the
 * exponents refuse to follow, which asserts something false about the algebra.
 *
 * Manim does not avoid this by being cleverer — `MathTex("a^2", "+", "b^2",
 * ...)` is the AUTHOR splitting the expression into the parts meant to
 * survive. `\htmlClass{ds-k-<key>}{...}` is the same act, and it is the only
 * mechanism here that produces a correct morph on an ambiguous pair.
 *
 * A group's identity is its key alone, not its contents, so `ds-k-exp` can
 * carry `x^2` onto `x^3`: the body moves and its contents dissolve.
 */
export function group(items: Leaf[]): Group[] {
  const by = new Map<string, { key: string; leaves: Leaf[] }>();
  items.forEach((it, i) => {
    const id = it.key ? `k:${it.key}` : `s:${i}`;
    if (!by.has(id)) by.set(id, { key: it.key, leaves: [] });
    by.get(id)?.leaves.push(it);
  });
  const out: Group[] = [];
  for (const g of by.values()) {
    let x0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    let fs = 0;
    for (const l of g.leaves) {
      x0 = Math.min(x0, l.cx - l.w / 2);
      x1 = Math.max(x1, l.cx + l.w / 2);
      y0 = Math.min(y0, l.cy - l.h / 2);
      y1 = Math.max(y1, l.cy + l.h / 2);
      fs = Math.max(fs, l.fs);
    }
    out.push({
      // An unkeyed group is one leaf, so its identity is that leaf's signature.
      ident: g.key ? `k:${g.key}` : `g:${g.leaves[0]?.sig}`,
      key: g.key,
      leaves: g.leaves,
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      w: x1 - x0,
      h: y1 - y0,
      fs,
      text: g.leaves.map((l) => l.text).join(""),
    });
  }
  return out;
}

/* ------------------------------------------------------------ 3. MATCH */

export interface Match {
  pairs: [number, number][];
  dropA: number[];
  addB: number[];
}

/**
 * Bucket by identity, then pair NEAREST FIRST within a bucket.
 *
 * Document order — the spike's rule — sends the wrong twin across the slide:
 * `F = E(I), X = W(F)` has two `=` and its successor one, and pairing the
 * first `=` with it flew a glyph 800px over the equation while the `=` sitting
 * 40px from its destination faded out. Nearest-first is what a viewer expects
 * of a symbol that did not move. Ties fall to document order, so it is still a
 * pure function of the two layouts.
 */
export function match(A: Group[], B: Group[]): Match {
  const bucket = (gs: Group[]) => {
    const m = new Map<string, number[]>();
    gs.forEach((g, i) => {
      if (!m.has(g.ident)) m.set(g.ident, []);
      m.get(g.ident)?.push(i);
    });
    return m;
  };
  const bA = bucket(A);
  const bB = bucket(B);
  const pairs: [number, number][] = [];
  const uA = new Set<number>();
  const uB = new Set<number>();
  for (const [k, ia] of bA) {
    const ib = bB.get(k);
    if (!ib) continue;
    const byDistance = ia
      .flatMap((a) => ib.map((b) => [a, b] as const))
      .sort(
        (p, q) =>
          Math.hypot(
            (A[p[0]] as Group).cx - (B[p[1]] as Group).cx,
            (A[p[0]] as Group).cy - (B[p[1]] as Group).cy,
          ) -
          Math.hypot(
            (A[q[0]] as Group).cx - (B[q[1]] as Group).cx,
            (A[q[0]] as Group).cy - (B[q[1]] as Group).cy,
          ),
      );
    for (const [a, b] of byDistance) {
      if (uA.has(a) || uB.has(b)) continue;
      pairs.push([a, b]);
      uA.add(a);
      uB.add(b);
    }
  }
  pairs.sort((p, q) => p[0] - q[0]);
  return {
    pairs,
    dropA: A.map((_, i) => i).filter((i) => !uA.has(i)),
    addB: B.map((_, i) => i).filter((i) => !uB.has(i)),
  };
}

/* ------------------------------------------------------------- 4. PLAN */

export type Prop = "x" | "y" | "s" | "o";
export type Ease =
  | "none"
  | "power1.in"
  | "power1.out"
  | "power2.in"
  | "power2.out"
  | "power2.inOut";

/**
 * One property of one leaf, over one slice of the morph.
 *
 * Times are FRACTIONS of the morph, not seconds: the plan is evaluated against
 * the plugin tween's ratio, so `pace()` scaling the tween's `duration` scales
 * all of this with it, and the plan never has to know how long it takes.
 */
export interface Step {
  el: HTMLElement;
  prop: Prop;
  from: number;
  to: number;
  at: number;
  dur: number;
  ease: Ease;
}

const R = (x: number) => Math.round(x * 1000) / 1000;

/**
 * One similarity transform per matched group, expressed per leaf.
 *
 * A group's leaves move RIGIDLY: every leaf gets the same scale and the
 * translation that the group's own centre-to-centre move implies for its
 * position within the body. `a^2` therefore arrives with its exponent still
 * attached, which is the whole reason groups exist.
 *
 * The B side is placed by the INVERSE transform — B's leaves start where they
 * would sit inside A's box — so when the contents differ the two renderings
 * dissolve into each other while sharing one trajectory.
 *
 * `arc` bows the path. Two glyphs swapping ends of an equation travel the same
 * straight line in opposite directions and pile up in the middle, which reads
 * as a collision rather than an exchange. The bow is two segments on `y` — out
 * over the first half, back over the second — against one on `x` that runs
 * the whole way.
 */
export function plan(A: Group[], B: Group[], m: Match, opt: { arc?: boolean }): Step[] {
  const arc = opt.arc ? 1 : 0;
  const steps: Step[] = [];
  const push = (
    el: HTMLElement,
    prop: Prop,
    from: number,
    to: number,
    at: number,
    dur: number,
    ease: Ease,
  ) => steps.push({ el, prop, from: R(from), to: R(to), at: R(at), dur: R(dur), ease });

  for (const [i, j] of m.pairs) {
    const ga = A[i] as Group;
    const gb = B[j] as Group;
    const s = gb.fs / ga.fs;
    const dx = gb.cx - ga.cx;
    const dy = gb.cy - ga.cy;
    const same = ga.text === gb.text;
    // Bow perpendicular to travel, capped so a short move stays a straight one.
    // SIGNED by direction of travel: an unsigned bow is worse than none, since
    // two groups exchanging ends travel equal distances in opposite directions
    // and would bow identically and still meet in the middle. Sized against the
    // BODIES: the clearance an exchanging pair needs is their own height, and
    // two opposite bows of 0.62h give them 1.24h. The spike added 0.12 of the
    // distance on top; on a slide that put a 100px body 120px up, into the
    // headline. Capped at 0.8em, which is the host's padding — the room there
    // is between a headline and a legend. ponytail: two fraction-tall bodies
    // exchanging ends will overlap at the midpoint under this cap; lift it
    // when a real deck shows one.
    const dist = Math.hypot(dx, dy);
    const bow =
      arc && dist > 60
        ? -Math.sign(dx || 1) * Math.min(0.62 * ((ga.h + gb.h) / 2), 0.8 * Math.max(ga.fs, gb.fs))
        : 0;

    for (const l of ga.leaves) {
      const tx = dx + (l.cx - ga.cx) * (s - 1);
      const ty = dy + (l.cy - ga.cy) * (s - 1);
      push(l.el, "x", 0, tx, 0, 1, "power2.inOut");
      push(l.el, "s", 1, s, 0, 1, "power2.inOut");
      if (bow) {
        push(l.el, "y", 0, ty / 2 + bow, 0, 0.5, "power2.out");
        push(l.el, "y", ty / 2 + bow, ty, 0.5, 0.5, "power2.in");
      } else {
        push(l.el, "y", 0, ty, 0, 1, "power2.inOut");
      }
      // Identical contents: a handover across the last twelfth, when the two
      // are on top of each other. Different contents: dissolve across the back
      // half of the move.
      if (same) push(l.el, "o", 1, 0, 0.88, 0.12, "none");
      else push(l.el, "o", 1, 0, 0.45, 0.55, "power1.in");
    }
    for (const l of gb.leaves) {
      const fx = -dx + (l.cx - gb.cx) * (1 / s - 1);
      const fy = -dy + (l.cy - gb.cy) * (1 / s - 1);
      if (same) {
        push(l.el, "o", 0, 1, 0.88, 0.12, "none");
        continue;
      }
      push(l.el, "x", fx, 0, 0, 1, "power2.inOut");
      push(l.el, "s", 1 / s, 1, 0, 1, "power2.inOut");
      if (bow) {
        push(l.el, "y", fy, fy / 2 - bow / s, 0, 0.5, "power2.out");
        push(l.el, "y", fy / 2 - bow / s, 0, 0.5, 0.5, "power2.in");
      } else {
        push(l.el, "y", fy, 0, 0, 1, "power2.inOut");
      }
      push(l.el, "o", 0, 1, 0.45, 0.55, "power1.out");
    }
  }
  for (const i of m.dropA) {
    for (const l of (A[i] as Group).leaves) {
      push(l.el, "o", 1, 0, 0, 0.45, "power1.in");
      push(l.el, "s", 1, 0.55, 0, 0.45, "power1.in");
    }
  }
  for (const j of m.addB) {
    for (const l of (B[j] as Group).leaves) {
      push(l.el, "o", 0, 1, 0.55, 0.45, "power1.out");
      push(l.el, "s", 0.55, 1, 0.55, 0.45, "power1.out");
    }
  }
  // `evaluate` lets a later segment on the same property override an earlier
  // one, which is what makes the arc's two halves one path. Stable, so two
  // segments starting together keep the order they were planned in.
  return steps.sort((p, q) => p.at - q.at);
}

/* --------------------------------------------------------- 5. EVALUATE */

/** GSAP's power eases, closed form, so a plan needs no GSAP to be evaluated. */
const EASES: Record<Ease, (u: number) => number> = {
  none: (u) => u,
  "power1.in": (u) => u * u,
  "power1.out": (u) => 1 - (1 - u) * (1 - u),
  "power2.in": (u) => u * u * u,
  "power2.out": (u) => 1 - (1 - u) ** 3,
  "power2.inOut": (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
};

export interface MorphPlan {
  leaves: { el: HTMLElement; side: "a" | "b" }[];
  steps: Step[];
}

/**
 * Write the morph at progress `v` in [0, 1] into every leaf's style.
 *
 * Every leaf is written every time, from its resting state forward — A drawn,
 * B hidden, nothing moved — so a cold seek to any progress produces the same
 * strings as a walk to it. That is the property the capture depends on.
 */
export function evaluate(p: MorphPlan, v: number): void {
  const state = new Map<HTMLElement, { x: number; y: number; s: number; o: number }>();
  for (const { el, side } of p.leaves) state.set(el, { x: 0, y: 0, s: 1, o: side === "a" ? 1 : 0 });
  for (const st of p.steps) {
    if (v < st.at) continue;
    const u = st.dur <= 0 ? 1 : Math.min(1, (v - st.at) / st.dur);
    const s = state.get(st.el);
    if (s) s[st.prop] = st.from + (st.to - st.from) * EASES[st.ease](u);
  }
  for (const [el, s] of state) {
    // None at rest — see `lift` for why a resting glyph must not be transformed.
    const x = R(s.x);
    const y = R(s.y);
    const sc = R(s.s);
    el.style.transform =
      x === 0 && y === 0 && sc === 1 ? "" : `translate(${x}px, ${y}px) scale(${sc})`;
    el.style.opacity = String(R(s.o));
    // A fully faded leaf is also hidden, so the layout gate does not read two
    // renderings of one line — B under A at rest, A under B after — as text
    // overprinting text. Still a function of `v` alone.
    el.style.visibility = s.o <= 0 ? "hidden" : "";
  }
}

/* ----------------------------------------------------------- the driver */

const PLANS = new WeakMap<Element, MorphPlan>();

export interface Stats {
  groupsA: number;
  groupsB: number;
  leavesA: number;
  leavesB: number;
  matched: number;
  dropped: number;
  added: number;
}

/**
 * Build the morph inside `host`, which must already contain two rendered KaTeX
 * roots marked `data-morph="a"` and `data-morph="b"`. Runs in `measure`, after
 * fonts; the plan is kept for the plugin tween on the same host to find.
 */
export function build(host: HTMLElement, opt: { arc?: boolean } = { arc: true }): Stats {
  const rootA = host.querySelector('[data-morph="a"]');
  const rootB = host.querySelector('[data-morph="b"]');
  if (!rootA || !rootB) throw new Error(`dsMorph: #${host.id} has no data-morph="a"/"b" roots`);
  const layer = document.createElement("div");
  layer.className = "ds-morph-layer";
  host.appendChild(layer);
  // B is `visibility:hidden` by the stylesheet, which measures exactly as if it
  // were shown; A is hidden once its clones stand in for it.
  const la = lift(rootA, host, layer);
  const lb = lift(rootB, host, layer);
  (rootA as HTMLElement).style.visibility = "hidden";
  (rootB as HTMLElement).style.visibility = "hidden";
  const A = group(la);
  const B = group(lb);
  const m = match(A, B);
  const p: MorphPlan = {
    leaves: [
      ...la.map((l) => ({ el: l.el, side: "a" as const })),
      ...lb.map((l) => ({ el: l.el, side: "b" as const })),
    ],
    steps: plan(A, B, m, opt),
  };
  PLANS.set(host, p);
  evaluate(p, 0);
  return {
    groupsA: A.length,
    groupsB: B.length,
    leavesA: la.length,
    leavesB: lb.length,
    matched: m.pairs.length,
    dropped: m.dropA.length,
    added: m.addB.length,
  };
}

interface PluginState {
  plan: MorphPlan;
  end: number;
}

/**
 * `dsMorph` as a GSAP property: `tl.fromTo(host, { dsMorph: 0 }, { dsMorph: 1 })`.
 *
 * A plugin's `render` is called by the timeline as part of being seeked, so
 * this runs under `suppressEvents` — the capture path — where an `onUpdate`
 * does not. The tween's own ease must be "none": the plan carries its eases
 * per segment, and a second ease on top would warp every one of them.
 */
export const DSMorphPlugin = {
  name: "dsMorph",
  init(this: PluginState, target: Element, value: unknown): void {
    const p = PLANS.get(target);
    // Loud, not silent: a tween on a host nothing measured would otherwise
    // animate nothing with every gate green.
    if (!p)
      throw new Error(
        `dsMorph: nothing built for #${target.id}; DSMorph.build must run in measure`,
      );
    this.plan = p;
    this.end = Number(value);
  },
  render(ratio: number, d: PluginState): void {
    evaluate(d.plan, d.end * ratio);
  },
};

if (typeof window !== "undefined") {
  const w = window as unknown as { DSMorph: unknown; DSMorphPlugin: unknown };
  w.DSMorph = { build, evaluate };
  w.DSMorphPlugin = DSMorphPlugin;
}
