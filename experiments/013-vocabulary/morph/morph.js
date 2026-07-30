/**
 * TransformMatchingTex, for the DOM.
 *
 * Two KaTeX renderings in, one seek-evaluable GSAP plan out. Nothing here runs
 * on a callback: `build()` measures once and bakes every number into a `fromTo`,
 * so the whole morph is a pure function of `t` and survives
 * `seek(t, suppressEvents)`.
 *
 * Four phases, kept separate on purpose:
 *   1. LIFT   — pull every ink-bearing leaf out of KaTeX's nested boxes into a
 *               flat absolutely-positioned overlay. Removes clipping, vlist
 *               stacking and transform-on-inline entirely.
 *   2. GROUP  — collect leaves into the units that move as one body. An author
 *               key makes a group; an unkeyed leaf is its own group.
 *   3. MATCH  — decide which group of A becomes which group of B.
 *   4. PLAN   — a similarity transform per group, expressed as fromTo per leaf.
 *
 * `apply()` is the only part that touches a timeline, and it is four lines.
 */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------- 1. LIFT */

  /**
   * KaTeX class tokens that say WHAT a box is. Everything else — sizes, tightness,
   * vlist plumbing — is deliberately excluded from a leaf's identity, because a
   * superscript 2 and a baseline 2 are the same glyph and matching them is the
   * entire point. Scale is what the tween is for.
   */
  const SIG_CLASSES = new Set([
    "mord", "mbin", "mrel", "mopen", "mclose", "mpunct", "mop", "minner",
    "mathnormal", "mathrm", "mathbf", "mathit", "mathcal", "mathbb", "mathsf",
    "mathtt", "mathfrak", "amsrm", "boldsymbol",
    "frac-line", "overline-line", "underline-line", "op-symbol", "delimsizing",
  ]);

  /** Ink that carries no text: rules, radicals, big delimiters drawn as SVG. */
  const INKY_EMPTY = ".frac-line,.overline-line,.underline-line,.hline,.rule";

  function sig(el) {
    const cls = [];
    for (const c of el.classList) if (SIG_CLASSES.has(c)) cls.push(c);
    cls.sort();
    const text = (el.textContent || "").trim();
    return (text || "∅") + " " + cls.join(" ");
  }

  /** Nearest `ds-k-<key>` on self or an ancestor, or "". */
  function keyOf(el, root) {
    for (let n = el; n && n !== root.parentNode; n = n.parentElement) {
      if (!n.classList) continue;
      for (const c of n.classList) if (c.startsWith("ds-k-")) return c.slice(5);
    }
    return "";
  }

  function leavesOf(root) {
    const seen = new Set();
    const out = [];
    for (const el of root.querySelectorAll("*")) {
      if (el.closest("svg")) continue;
      if (el.childElementCount > 0) continue;
      if (!(el.textContent || "").trim()) continue;
      out.push(el);
      seen.add(el);
    }
    for (const el of root.querySelectorAll(INKY_EMPTY)) if (!seen.has(el)) out.push(el);
    for (const el of root.querySelectorAll("svg")) if (!seen.has(el)) out.push(el);
    out.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    return out;
  }

  /**
   * Clone each leaf into a flat overlay at its measured centre.
   *
   * The clone keeps the leaf's class list (so `.mathnormal` still selects
   * Computer Modern Italic) but is given its computed font-size explicitly,
   * because the em cascade it inherited from four ancestor boxes does not come
   * with it. `xPercent/yPercent -50` is set once here so every later tween is a
   * translate about the glyph's own centre.
   */
  /**
   * Where a box's text sits, in page coordinates: [left edge, baseline].
   *
   * A zero-size inline-block on the baseline is the only reliable way to ask a
   * browser this. It matters because the clone and the original disagree about
   * their own box even when they agree about the glyph: the original leaf is
   * INLINE, so its rect is the font's content area, while the clone is
   * inline-block, so its rect is its line box. Aligning the two RECTS therefore
   * misplaces the ink by a fraction of a pixel — measured at 7,329 antialiased
   * edge pixels on `\sum` and 3,079 on a `\dfrac`. Aligning the two BASELINES is
   * exact, and needs no theory of which box model applies where.
   */
  function anchor(el) {
    const probe = document.createElement("i");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    el.appendChild(probe);
    const p = probe.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    probe.remove();
    return [r.left, p.top];
  }

  function lift(root, host, layer) {
    const H = host.getBoundingClientRect();
    const items = [];
    for (const el of leavesOf(root)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const ink = (el.textContent || "").trim() ? anchor(el) : null;
      const cs = getComputedStyle(el);
      const clone = el.cloneNode(true);
      clone.removeAttribute("id");
      const s = clone.style;
      s.position = "absolute";
      s.display = "inline-block";
      s.left = r.left - H.left + r.width / 2 + "px";
      s.top = r.top - H.top + r.height / 2 + "px";
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
      if (!(el.textContent || "").trim()) {
        s.width = r.width + "px";
        s.height = r.height + "px";
        s.borderBottomWidth = cs.borderBottomWidth;
        s.borderBottomStyle = cs.borderBottomStyle;
        s.borderBottomColor = cs.borderBottomColor;
        s.background = cs.backgroundColor;
      }
      layer.appendChild(clone);
      global.gsap.set(clone, { xPercent: -50, yPercent: -50, force3D: false });
      items.push({
        el: clone,
        ink,
        key: keyOf(el, root),
        sig: sig(el),
        text: (el.textContent || "").trim(),
        fs: parseFloat(cs.fontSize) || 1,
        cx: r.left - H.left + r.width / 2,
        cy: r.top - H.top + r.height / 2,
        w: r.width,
        h: r.height,
      });
    }

    // One reflow, then put every clone's baseline exactly where the original's
    // was. Rule-less: whatever the two box models disagree about is cancelled by
    // measuring the disagreement rather than modelling it.
    for (const it of items) {
      const want = it.ink;
      if (!want) continue;
      const got = anchor(it.el);
      const st = it.el.style;
      st.left = parseFloat(st.left) + (want[0] - got[0]) + "px";
      st.top = parseFloat(st.top) + (want[1] - got[1]) + "px";
    }
    // The centres the plan tweens against must be the CORRECTED ones.
    for (const it of items) {
      const r = it.el.getBoundingClientRect();
      it.cx = r.left - H.left + r.width / 2;
      it.cy = r.top - H.top + r.height / 2;
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
   * Manim does not actually avoid this by being cleverer — `MathTex("a^2", "+",
   * "b^2", ...)` is the AUTHOR splitting the expression into the parts that are
   * meant to survive. `\htmlClass{ds-k-<name>}{...}` is the same act, and it is
   * the only mechanism here that produces a correct morph on an ambiguous pair.
   *
   * The group's own identity is its key alone, not its contents, so `ds-k-exp`
   * can carry `x^2` onto `x^3`: the body moves and its contents dissolve.
   */
  function group(items) {
    const by = new Map();
    items.forEach((it, i) => {
      const id = it.key ? "k:" + it.key : "s:" + i;
      if (!by.has(id)) by.set(id, { id, key: it.key, leaves: [] });
      by.get(id).leaves.push(it);
    });
    const out = [];
    for (const g of by.values()) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, fs = 0;
      for (const l of g.leaves) {
        x0 = Math.min(x0, l.cx - l.w / 2); x1 = Math.max(x1, l.cx + l.w / 2);
        y0 = Math.min(y0, l.cy - l.h / 2); y1 = Math.max(y1, l.cy + l.h / 2);
        fs = Math.max(fs, l.fs);
      }
      g.cx = (x0 + x1) / 2;
      g.cy = (y0 + y1) / 2;
      g.w = x1 - x0;
      g.h = y1 - y0;
      g.fs = fs;
      g.text = g.leaves.map((l) => l.text).join("");
      // An unkeyed group is one leaf, so its identity is that leaf's signature.
      g.ident = g.key ? "k:" + g.key : "g:" + g.leaves[0].sig;
      out.push(g);
    }
    return out;
  }

  /* ------------------------------------------------------------ 3. MATCH */

  /** Bucket by identity, pair in document order. */
  function match(A, B) {
    const bucket = (gs) => {
      const m = new Map();
      gs.forEach((g, i) => {
        if (!m.has(g.ident)) m.set(g.ident, []);
        m.get(g.ident).push(i);
      });
      return m;
    };
    const bA = bucket(A);
    const bB = bucket(B);
    const pairs = [];
    const uA = new Set();
    const uB = new Set();
    for (const [k, ia] of bA) {
      const ib = bB.get(k);
      if (!ib) continue;
      for (let n = 0; n < Math.min(ia.length, ib.length); n++) {
        pairs.push([ia[n], ib[n]]);
        uA.add(ia[n]);
        uB.add(ib[n]);
      }
    }
    return {
      pairs,
      dropA: A.map((_, i) => i).filter((i) => !uA.has(i)),
      addB: B.map((_, i) => i).filter((i) => !uB.has(i)),
    };
  }

  /* ------------------------------------------------------------- 4. PLAN */

  const R = (x) => Math.round(x * 1000) / 1000;

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
   * as a collision rather than an exchange. The bow is two fromTo tweens on `y`
   * (out over the first half, back over the second) against one on `x` that runs
   * the whole way — no plugin, no callback, still a pure function of t.
   */
  function plan(A, B, m, dur, opt) {
    const arc = opt.arc ? 1 : 0;
    const steps = [];
    const push = (el, from, to, at, d, ease) =>
      steps.push({ el, from, to, at: R(at), dur: R(d), ease });

    for (const [i, j] of m.pairs) {
      const ga = A[i];
      const gb = B[j];
      const s = gb.fs / ga.fs;
      const dx = gb.cx - ga.cx;
      const dy = gb.cy - ga.cy;
      const same = ga.text === gb.text;
      // Bow perpendicular to travel, capped so a short move stays a straight one.
      const dist = Math.hypot(dx, dy);
      // SIGNED by direction of travel. An unsigned bow is worse than none: two
      // groups exchanging ends of an equation travel equal distances in opposite
      // directions, so they bow identically and still meet in the middle — the
      // collision the arc exists to avoid, now with extra motion. Rightward
      // moves bow up, leftward moves bow down, and the two paths separate.
      // Sized against the BODIES, not just the distance. A fixed 110px bow
      // separates two exponent-sized terms and does nothing for two half-slide
      // subexpressions: at the midpoint of `sum(1/n^2) = pi^2/6 -> pi^2/6 =
      // sum(1/n^2)` the two ~300px-tall bodies overlapped almost completely and
      // the frame was unreadable. The clearance a pair needs is their own height.
      const bow =
        arc && dist > 60
          ? -Math.sign(dx || 1) * (0.62 * ((ga.h + gb.h) / 2) + 0.12 * dist)
          : 0;

      for (const l of ga.leaves) {
        const tx = dx + (l.cx - ga.cx) * (s - 1);
        const ty = dy + (l.cy - ga.cy) * (s - 1);
        push(l.el, { x: 0, scale: 1 }, { x: R(tx), scale: R(s) }, 0, dur, "power2.inOut");
        if (bow) {
          push(l.el, { y: 0 }, { y: R(ty / 2 + bow) }, 0, dur / 2, "power2.out");
          push(l.el, { y: R(ty / 2 + bow) }, { y: R(ty) }, dur / 2, dur / 2, "power2.in");
        } else {
          push(l.el, { y: 0 }, { y: R(ty) }, 0, dur, "power2.inOut");
        }
        // Identical contents: an invisible handover at the end. Different
        // contents: dissolve across the back half of the move.
        if (same) push(l.el, { opacity: 1 }, { opacity: 0 }, dur, 0.12, "none");
        else push(l.el, { opacity: 1 }, { opacity: 0 }, dur * 0.45, dur * 0.55, "power1.in");
      }
      for (const l of gb.leaves) {
        const fx = -dx + (l.cx - gb.cx) * (1 / s - 1);
        const fy = -dy + (l.cy - gb.cy) * (1 / s - 1);
        if (same) {
          push(l.el, { opacity: 0 }, { opacity: 1 }, dur, 0.12, "none");
        } else {
          push(l.el, { x: R(fx), scale: R(1 / s) }, { x: 0, scale: 1 }, 0, dur, "power2.inOut");
          if (bow) {
            push(l.el, { y: R(fy) }, { y: R(fy / 2 - bow / s) }, 0, dur / 2, "power2.out");
            push(l.el, { y: R(fy / 2 - bow / s) }, { y: 0 }, dur / 2, dur / 2, "power2.in");
          } else {
            push(l.el, { y: R(fy) }, { y: 0 }, 0, dur, "power2.inOut");
          }
          push(l.el, { opacity: 0 }, { opacity: 1 }, dur * 0.45, dur * 0.55, "power1.out");
        }
      }
    }
    for (const i of m.dropA)
      for (const l of A[i].leaves)
        push(l.el, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.55 }, 0, dur * 0.45, "power1.in");
    for (const j of m.addB)
      for (const l of B[j].leaves)
        push(l.el, { opacity: 0, scale: 0.55 }, { opacity: 1, scale: 1 }, dur * 0.55, dur * 0.45, "power1.out");
    return steps;
  }

  /* ------------------------------------------------------------- driver */

  /**
   * Build a morph inside `host`, which must already contain two rendered KaTeX
   * roots marked `data-morph="a"` and `data-morph="b"`.
   *
   * Returns { steps, stats }. Nothing has been attached to a timeline yet.
   */
  function build(host, dur, opt) {
    opt = opt || {};
    const rootA = host.querySelector('[data-morph="a"]');
    const rootB = host.querySelector('[data-morph="b"]');
    const layer = document.createElement("div");
    layer.className = "ds-morph-layer";
    host.appendChild(layer);
    const A = group(lift(rootA, host, layer));
    const B = group(lift(rootB, host, layer));
    rootA.style.visibility = "hidden";
    rootB.style.visibility = "hidden";
    const m = match(A, B);
    for (const g of B) for (const l of g.leaves) global.gsap.set(l.el, { opacity: 0 });
    return {
      steps: plan(A, B, m, dur, opt),
      stats: {
        groupsA: A.length,
        groupsB: B.length,
        leavesA: A.reduce((n, g) => n + g.leaves.length, 0),
        leavesB: B.reduce((n, g) => n + g.leaves.length, 0),
        matched: m.pairs.length,
        dropped: m.dropA.length,
        added: m.addB.length,
      },
    };
  }

  /**
   * The only lines that touch a timeline.
   *
   * `immediateRender: false` on every tween after the first that touches a given
   * property of a given element, and this is not a detail — it is the whole
   * reason the arc is safe.
   *
   * A bowed path is two fromTo tweens on `y`: out over the first half, back over
   * the second. `fromTo` renders its FROM state at construction, so building the
   * second one leaves the glyph parked at the top of its arc. Then a COLD seek to
   * any time before the morph starts finds a tween GSAP has never had to render
   * and leaves it there — the equation opens with one symbol floating 166px above
   * the line. Walking the timeline down from the end fixes it, so the bug is
   * invisible to anyone who scrubs and fatal to anyone who captures, which is the
   * exact shape of this project's most expensive failures. Measured, not reasoned:
   * `out/report.json` before this line had `stateIdentical: false` at t=0.5 on six
   * of seven cases, and `true` on all seven after.
   *
   * "Every tween is a fromTo" turns out to be necessary and not sufficient. The
   * rule that is sufficient is: at most one fromTo per (element, property) may
   * render immediately.
   */
  function apply(tl, steps, at) {
    const claimed = new Set();
    for (const s of steps) {
      let first = false;
      for (const p of Object.keys(s.to)) {
        const tag = elId(s.el) + "|" + p;
        if (!claimed.has(tag)) {
          claimed.add(tag);
          first = true;
        }
      }
      tl.fromTo(
        s.el,
        s.from,
        { ...s.to, duration: s.dur, ease: s.ease, immediateRender: first },
        R(at + s.at),
      );
    }
  }

  let uid = 0;
  const IDS = new WeakMap();
  function elId(el) {
    if (!IDS.has(el)) IDS.set(el, ++uid);
    return IDS.get(el);
  }

  global.DSMorph = { build, apply, lift, group, match, plan };
})(window);
