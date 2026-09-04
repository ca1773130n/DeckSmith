import { describe, expect, it } from "vitest";
import { equationMorph } from "../src/emit/archetypes/equation-morph.js";
import { tweenText } from "../src/emit/kit.js";
import { evaluate, type Group, type MorphPlan, match, plan } from "../src/emit/morph-runtime.js";
import { ink } from "../src/emit/themes/index.js";
import type { BeatOf, Format, Source, Term } from "../src/types.js";
import { beatSchema, FORMATS } from "../src/types.js";

/* ------------------------------------------------------------ the emitter */

describe("equation-morph", () => {
  const src = (a: string, b: string): Source => ({
    id: "s",
    title: "t",
    lang: "en",
    sections: [],
    figures: [],
    equations: [
      { id: "ea", tex: a, display: true },
      { id: "eb", tex: b, display: true },
    ],
    tables: [],
  });
  const at = (a: string, b: string, sid = "s4") => ({
    source: src(a, b),
    format: FORMATS["deck-16x9"] as Format,
    theme: ink,
    sid,
  });
  const beat = (terms: Term[], seconds = 9) =>
    ({
      id: "b7-derive",
      archetype: "equation-morph",
      weight: 0.8,
      seconds,
      intent: "i",
      evidence: [],
      params: { eyebrow: "E", headline: "H", fromId: "ea", toId: "eb", terms },
    }) as BeatOf<"equation-morph">;
  const A = "\\mathbf{F}=\\mathcal{E}(\\mathbf{I})";
  const B = "\\mathbf{X}=\\mathcal{W}(\\mathcal{E}(\\mathbf{I}))";
  const enc = { tex: "\\mathcal{E}(\\mathbf{I})", label: "the encoded field", tone: "a" } as Term;
  const win = { tex: "\\mathcal{W}", label: "window partition", tone: "b" } as Term;

  it("is a beat the storyboard schema accepts", () => {
    expect(beatSchema.safeParse(beat([enc])).success).toBe(true);
  });

  it("keys the same term on BOTH sides, so the runtime can pair them", () => {
    const scene = equationMorph(beat([enc]), at(A, B));
    const setup = (scene.setup ?? []).join("\n");
    // One `\htmlClass{... ds-k-a}` per side: the key is what makes a rigid body.
    expect(setup.match(/ds-k-a/g)).toHaveLength(2);
    expect(scene.html).toContain('data-morph="a"');
    expect(scene.html).toContain('data-morph="b"');
  });

  it("drops a term that only one equation contains, and its legend row with it", () => {
    // `\mathcal{W}` is in B only. Carrying it would mean a key with nothing to
    // pair — the runtime would fade it as an unmatched body, and the legend would
    // point at a term the morph never moves.
    const scene = equationMorph(beat([enc, win]), at(A, B));
    const setup = (scene.setup ?? []).join("\n");
    expect(setup).not.toContain("ds-k-b");
    expect(scene.html.match(/class="leg"/g)).toHaveLength(1);
  });

  it("refuses a beat where no term is in both equations, and names them", () => {
    expect(() => equationMorph(beat([win]), at(A, B))).toThrow(
      /none of its 1 term\(s\) occur in both.*\\mathcal\{W\}/s,
    );
  });

  it("refuses an equation id the source does not carry", () => {
    const b = beat([enc]);
    (b.params as { toId: string }).toId = "nope";
    expect(() => equationMorph(b, at(A, B))).toThrow(/no equation "nope"/);
  });

  it("measures after fonts (Seam B) and morphs through a plugin tween, never a callback", () => {
    const scene = equationMorph(beat([enc]), at(A, B));
    // The plan needs browser geometry, so it is built inside the ready gate.
    expect(scene.measure?.join("\n")).toMatch(
      /DSMorph\.build\(document\.getElementById\("s4-morph"\)\)/,
    );
    // And reaches the timeline as ONE typed fromTo on the host, which `pace`
    // can scale and the type checker can see. Invariant 11: no onUpdate.
    const morph = scene.tl.find((t) => "dsMorph" in t.to);
    expect(morph).toBeDefined();
    expect(morph?.target).toBe("#s4-morph");
    expect(morph?.from).toEqual({ dsMorph: 0 });
    expect(morph?.to).toMatchObject({ dsMorph: 1, ease: "none" });
    expect(scene.plugins).toEqual(["dsMorph"]);
    const code = scene.tl.map(tweenText).join("\n");
    expect(code).not.toMatch(/onUpdate|onStart|onComplete/);
  });

  it("holds twice: the first equation settled, then the second", () => {
    const scene = equationMorph(beat([enc]), at(A, B));
    expect(scene.holds).toHaveLength(2);
    const morph = scene.tl.find((t) => "dsMorph" in t.to);
    const end = (morph?.at ?? 0) + Number(morph?.to.duration);
    expect(scene.holds[0]).toBeLessThan(morph?.at ?? 0);
    expect(scene.holds[1]).toBeGreaterThan(end);
    expect(scene.holds[1]).toBeLessThan(9);
  });

  it("scopes every target to its own scene", () => {
    const scene = equationMorph(beat([enc]), at(A, B, "s9"));
    for (const t of scene.tl) expect(t.target.startsWith("#s9")).toBe(true);
  });
});

/* ------------------------------------------------------------ the runtime */

/** A leaf with just enough of an element to be written to. */
const leaf = (cx: number, cy: number, w = 20, h = 30, text = "x", fs = 48) => ({
  el: { style: {} as Record<string, string> } as unknown as HTMLElement,
  key: "",
  sig: text,
  text,
  fs,
  cx,
  cy,
  w,
  h,
});

const groupOf = (key: string, leaves: ReturnType<typeof leaf>[]): Group => {
  const x0 = Math.min(...leaves.map((l) => l.cx - l.w / 2));
  const x1 = Math.max(...leaves.map((l) => l.cx + l.w / 2));
  const y0 = Math.min(...leaves.map((l) => l.cy - l.h / 2));
  const y1 = Math.max(...leaves.map((l) => l.cy + l.h / 2));
  return {
    ident: key ? `k:${key}` : `g:${leaves[0]?.sig}`,
    key,
    leaves,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    w: x1 - x0,
    h: y1 - y0,
    fs: Math.max(...leaves.map((l) => l.fs)),
    text: leaves.map((l) => l.text).join(""),
  };
};

describe("morph plan", () => {
  it("moves a keyed group rigidly: one scale, and every leaf lands where the body implies", () => {
    // `a^2` at the left of A becomes `a^2` at the right of B, at 1.5x the size.
    const a = groupOf("k", [leaf(100, 100, 20, 30, "a"), leaf(120, 85, 10, 15, "2", 34)]);
    const b = groupOf("k", [leaf(400, 100, 30, 45, "a", 72), leaf(430, 77.5, 15, 22.5, "2", 51)]);
    const steps = plan([a], [b], match([a], [b]), { arc: false });
    const s = steps.filter((st) => st.prop === "s" && st.el === a.leaves[0]?.el);
    const s2 = steps.filter((st) => st.prop === "s" && st.el === a.leaves[1]?.el);
    expect(s[0]?.to).toBe(1.5);
    expect(s2[0]?.to).toBe(1.5);
    // The exponent travels with its base: its own centre offset, scaled.
    const x2 = steps.find((st) => st.prop === "x" && st.el === a.leaves[1]?.el);
    const dx = b.cx - a.cx;
    expect(x2?.to).toBeCloseTo(dx + (120 - a.cx) * 0.5, 3);
  });

  it("pairs twins by distance, so the `=` that did not move is the one that stays", () => {
    // Two `=` in A, one in B, 40px from the second. Document order would fly
    // the first one 800px across; the viewer expects the near one to slide.
    const eqA1 = groupOf("", [leaf(100, 100, 30, 20, "=")]);
    const eqA2 = groupOf("", [leaf(900, 100, 30, 20, "=")]);
    const eqB = groupOf("", [leaf(940, 100, 30, 20, "=")]);
    const m = match([eqA1, eqA2], [eqB]);
    expect(m.pairs).toEqual([[1, 0]]);
    expect(m.dropA).toEqual([0]);
  });

  it("dissolves an unmatched body out and a new one in, on opposite halves", () => {
    const a = groupOf("", [leaf(100, 100, 20, 30, "p")]);
    const b = groupOf("", [leaf(300, 100, 20, 30, "q")]);
    const steps = plan([a], [b], match([a], [b]), { arc: false });
    const out = steps.find((st) => st.el === a.leaves[0]?.el && st.prop === "o");
    const inn = steps.find((st) => st.el === b.leaves[0]?.el && st.prop === "o");
    expect(out).toMatchObject({ from: 1, to: 0, at: 0 });
    expect(inn).toMatchObject({ from: 0, to: 1 });
    expect(inn?.at ?? 0).toBeGreaterThanOrEqual(out?.dur ?? 1);
  });

  it("bows a rightward move up and a leftward move down, so an exchange does not collide", () => {
    const a1 = groupOf("l", [leaf(100, 100, 40, 60, "l")]);
    const a2 = groupOf("r", [leaf(500, 100, 40, 60, "r")]);
    const b1 = groupOf("l", [leaf(500, 100, 40, 60, "l")]);
    const b2 = groupOf("r", [leaf(100, 100, 40, 60, "r")]);
    const steps = plan([a1, a2], [b1, b2], match([a1, a2], [b1, b2]), { arc: true });
    const yl = steps.filter((st) => st.el === a1.leaves[0]?.el && st.prop === "y");
    const yr = steps.filter((st) => st.el === a2.leaves[0]?.el && st.prop === "y");
    expect(yl[0]?.to ?? 0).toBeLessThan(0);
    expect(yr[0]?.to ?? 0).toBeGreaterThan(0);
    // Out over the first half, back over the second, and it ends on the line.
    expect(yl).toHaveLength(2);
    expect(yl[1]?.to).toBe(0);
  });
});

describe("morph evaluate", () => {
  const mk = (): MorphPlan => {
    const a = leaf(0, 0);
    const b = leaf(0, 0);
    return {
      leaves: [
        { el: a.el, side: "a" },
        { el: b.el, side: "b" },
      ],
      steps: [
        { el: a.el, prop: "y", from: 0, to: -50, at: 0, dur: 0.5, ease: "none" },
        { el: a.el, prop: "y", from: -50, to: 20, at: 0.5, dur: 0.5, ease: "none" },
        { el: a.el, prop: "x", from: 0, to: 100, at: 0, dur: 1, ease: "none" },
        { el: b.el, prop: "o", from: 0, to: 1, at: 0.5, dur: 0.5, ease: "none" },
      ],
    };
  };
  const style = (p: MorphPlan, i: number) => {
    const l = p.leaves[i];
    if (!l) throw new Error(`no leaf ${i}`);
    return (l.el as unknown as { style: Record<string, string> }).style;
  };

  it("at 0 is the resting state: A drawn, B hidden, nothing moved", () => {
    const p = mk();
    evaluate(p, 0);
    expect(style(p, 0).transform).toBe("translate(-50%, -50%) translate(0px, 0px) scale(1)");
    expect(style(p, 0).opacity).toBe("1");
    expect(style(p, 1).opacity).toBe("0");
    // Hidden as well as transparent, so a layout gate never reads B under A.
    expect(style(p, 1).visibility).toBe("hidden");
    expect(style(p, 0).visibility).toBe("");
  });

  it("lets a later segment on the same property take over, which is what makes an arc", () => {
    const p = mk();
    evaluate(p, 0.25);
    expect(style(p, 0).transform).toBe("translate(-50%, -50%) translate(25px, -25px) scale(1)");
    evaluate(p, 0.75);
    expect(style(p, 0).transform).toBe("translate(-50%, -50%) translate(75px, -15px) scale(1)");
    expect(style(p, 1).opacity).toBe("0.5");
  });

  it("is a pure function of its argument: seeking back restores the earlier frame exactly", () => {
    const p = mk();
    evaluate(p, 1);
    evaluate(p, 0.25);
    const late = { ...style(p, 0) };
    const q = mk();
    evaluate(q, 0.25);
    expect(late).toEqual(style(q, 0));
  });
});
