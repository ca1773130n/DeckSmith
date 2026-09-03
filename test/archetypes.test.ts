import { describe, expect, it } from "vitest";
import { emitScene, emitters } from "../src/emit/archetypes/index.js";
import { chartScale } from "../src/emit/archetypes/line-chart.js";
import { bodyBudget, noteHeight, noteWidth } from "../src/emit/archetypes/title.js";
import type { EmitContext, Theme } from "../src/emit/kit.js";
import { tweenText } from "../src/emit/kit.js";
import { baseCss } from "../src/emit/theme.js";
import { type Beat, beatSchema, type Format, type Source } from "../src/types.js";

const theme: Theme = {
  bg: "#0b0d10",
  fg: "#e8eaed",
  muted: "#b8c4d2",
  dim: "#74808e",
  rule: "#2b333d",
  panel: "#16191e",
  accent: "#3d8bfd",
  tones: { a: "#7cc4ff", b: "#ffd166", c: "#f78da7", d: "#6ee7a8" },
  fontStack: '"Inter", system-ui, sans-serif',
};

const source: Source = {
  id: "src",
  title: "A paper",
  lang: "en",
  sections: [],
  figures: [
    { id: "f1", src: "figure_000.jpg", caption: "A <wide> figure", width: 1980, height: 1000 },
    { id: "f2", src: "figure_001.jpg", caption: "A square one", width: 1000, height: 1000 },
    { id: "f3", src: "figure_002.jpg", caption: "A strip", width: 1980, height: 520 },
  ],
  equations: [
    {
      id: "e1",
      tex: "\\mathbf{F}=\\mathcal{E}(\\mathbf{I}),\\quad \\mathbf{X}=\\mathcal{W}(\\mathbf{F})",
      display: true,
    },
  ],
  tables: [
    {
      id: "t1",
      columns: ["Method", "Params", "Set5", "Average"],
      rows: [
        ["CARN", "1.592M", "32.13", "28.970"],
        ["SwinIR", "0.930M", "32.44", "29.258"],
        ["Ours", "1.129M", "32.16", "28.983"],
      ],
    },
  ],
};

const format: Format = {
  id: "deck-16x9",
  width: 1920,
  height: 1080,
  minWeight: 0,
  navigable: true,
};

const ctx = (sid: string): EmitContext => ({ source, format, theme, sid });

/**
 * The `{from}, {to}` pair of every `tl.fromTo(...)` in some emitted code. Brace
 * matching rather than a regex because a `to` object can nest — grid's carries a
 * whole `stagger: { ... }` — and a non-greedy `\{[^}]*\}` silently truncates it,
 * which would make every assertion below pass for the wrong reason.
 */
function fromToVars(code: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const call of code.matchAll(/tl\.fromTo\(/g)) {
    let depth = 0;
    const objects: string[] = [];
    let start = 0;
    for (let i = call.index; i < code.length; i++) {
      const ch = code[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) objects.push(code.slice(start, i + 1));
      } else if (ch === ")" && depth === 0) break;
    }
    const [from, to] = objects;
    if (from && to) pairs.push([from, to]);
  }
  return pairs;
}

const core = { intent: "i", evidence: [], weight: 0.5, seconds: 9 };

const beats: Beat[] = [
  {
    ...core,
    id: "b1",
    archetype: "title",
    params: { eyebrow: "Paper analysis", headline: "A <headline>", sub: "and a sub" },
  },
  {
    ...core,
    id: "b2",
    archetype: "claim-figure",
    params: { eyebrow: "Problem", headline: "H", claim: "The claim", figureId: "f2" },
  },
  {
    ...core,
    id: "b3",
    archetype: "equation-walk",
    params: {
      eyebrow: "Method",
      headline: "H",
      equationId: "e1",
      terms: [
        { tex: "\\mathcal{E}", label: "encoder", tone: "a" },
        { tex: "\\mathcal{W}", label: "window partition", tone: "b" },
      ],
    },
  },
  {
    ...core,
    id: "b4",
    archetype: "data-table",
    params: {
      headline: "H",
      tableId: "t1",
      highlight: [
        { row: "SwinIR", tone: "d" },
        { row: "Ours", tone: "b" },
      ],
      note: "A note",
    },
  },
  {
    ...core,
    id: "b5",
    archetype: "line-chart",
    params: {
      headline: "H",
      xLabel: "ticks",
      yLabel: "PSNR",
      points: [
        { x: "T=0", y: 28.91 },
        { x: "T=1", y: 29.88 },
        { x: "T=2", y: 30.18 },
        { x: "T=4", y: 30.47 },
      ],
      deltas: ["+0.97", "+0.30", "+0.29"],
      readout: "diminishing returns",
    },
  },
  {
    ...core,
    id: "b6",
    archetype: "callout",
    params: {
      headline: "H",
      panels: [
        { label: "abstract", lines: ["28.10 → 30.28"] },
        { label: "sweep table", lines: ["28.91 → 30.47"] },
      ],
      note: "the source does not explain the gap",
    },
  },
  {
    ...core,
    id: "b7",
    archetype: "pipeline",
    params: {
      headline: "A <headline>",
      stages: [
        { label: "Patchify", note: "192x192x3" },
        { label: "Encode", note: "12 blocks", tone: "a" },
        { label: "Decode" },
      ],
      loop: { to: 1, label: "refine" },
      note: "one pass per tick",
    },
  },
  {
    ...core,
    id: "b8",
    archetype: "annotated-figure",
    params: {
      eyebrow: "Method",
      headline: "A <headline>",
      figureId: "f2",
      notes: [
        { x: 0.25, y: 0.3, text: "the shallow branch", tone: "a" },
        { x: 0.75, y: 0.7, text: "the fusion point" },
      ],
    },
  },
  {
    ...core,
    id: "b9",
    archetype: "grid",
    params: {
      headline: "A <headline>",
      cols: 8,
      rows: 6,
      regions: [
        { x: 0, y: 0, w: 3, h: 3, label: "window 0", tone: "a" },
        { x: 4, y: 2, w: 2, h: 2, label: "window 1", tone: "b" },
      ],
      note: "windows do not overlap",
    },
  },
  {
    ...core,
    id: "b10",
    archetype: "bar-compare",
    params: {
      headline: "A <headline>",
      unit: "M params",
      bars: [
        { label: "CARN", value: 1.592 },
        { label: "SwinIR", value: 0.93, tone: "a" },
        { label: "Ours", value: 1.129, tone: "b" },
      ],
      note: "smaller is better",
    },
  },
  {
    ...core,
    id: "b11",
    archetype: "stack",
    params: {
      headline: "A <headline>",
      layers: [
        { label: "Pixels", note: "the input" },
        { label: "Features", note: "12 blocks" },
        { label: "Windows" },
      ],
      note: "built bottom-up",
    },
  },
  {
    ...core,
    id: "b12",
    archetype: "split-compare",
    params: {
      headline: "A <headline>",
      left: { label: "Before", figureId: "f2" },
      right: { label: "After", lines: ["sharper edges", "no ringing"] },
      note: "same crop, same scale",
    },
  },
];

describe("archetypes", () => {
  it("covers every archetype in the beat union", () => {
    // Read off the discriminated union itself, not off the fixtures below: an
    // archetype nobody wrote a fixture for is exactly the one that would slip
    // through, and this way it fails here instead of at runtime.
    const union = beatSchema.options.map((o) => o.shape.archetype.value).sort();
    expect(Object.keys(emitters).sort()).toEqual(union);
    expect([...new Set(beats.map((b) => b.archetype))].sort()).toEqual(union);
  });

  it("never lets two archetypes define the same class differently", () => {
    // One stylesheet serves the whole deck, so a class name is deck-global while
    // the file declaring it looks local. line-chart's portrait wrapper was once
    // `.stackwrap`, which is stack.ts's class: line-chart's rule wanted the
    // wrapper to stretch, stack's `align-self:center` said don't, and both
    // applied to both elements. It rendered correctly only because the chart
    // happened to be exactly its box's width — nothing caught it, and no gate
    // reads CSS. Identical text across archetypes is fine: that is a shared
    // helper like `chromeCss`, emitted once per scene and deduplicated later.
    // class -> archetype -> everything that archetype says about that class.
    // Several rules under one class are normal (`.a{}` plus `.a .b{}`); what is
    // not is two archetypes saying DIFFERENT things about the same name.
    const owners = new Map<string, Map<string, string[]>>();
    for (const beat of beats) {
      const css = emitScene(beat, ctx("s7")).css ?? "";
      for (const rule of css.split("\n")) {
        // The leading class is the rule's subject: `.a .b{}` is a rule about `.a`.
        const cls = /^\s*\.([A-Za-z0-9_-]+)/.exec(rule)?.[1];
        if (!cls) continue;
        const byArch = owners.get(cls) ?? new Map<string, string[]>();
        byArch.set(beat.archetype, [...(byArch.get(beat.archetype) ?? []), rule.trim()]);
        owners.set(cls, byArch);
      }
    }
    const clashes = [...owners]
      .filter(([, byArch]) => new Set([...byArch.values()].map((r) => r.join("\n"))).size > 1)
      .map(([cls, byArch]) => `${cls}: ${[...byArch.keys()].join(" vs ")}`);
    expect(clashes).toEqual([]);
  });

  for (const beat of beats) {
    describe(beat.archetype, () => {
      const sid = "s7";
      const scene = emitScene(beat, ctx(sid));
      const code = [...(scene.setup ?? []), ...scene.tl.map(tweenText)].join("\n");

      it("scopes every timeline target to its own scene", () => {
        const targets = scene.tl.map((t) => t.target);
        expect(targets.length).toBeGreaterThan(0);
        for (const target of targets) expect(target.startsWith(`#${sid}`)).toBe(true);
      });

      it("uses fromTo only", () => {
        expect(code).not.toMatch(/\.from\(/);
      });

      it("declares a transform origin in both halves of a tween, or in neither", () => {
        // An origin named only in the `to` vars is an origin *change*, and GSAP's
        // smoothOrigin absorbs a change with a compensating translate that never
        // unwinds. line-chart's dots came to rest 9px off the polyline they mark
        // and grid's cells 2.08px outside their own svg; only the latter overflowed
        // anything, so only the latter was ever reported.
        for (const [from, to] of fromToVars(code)) {
          for (const key of ["transformOrigin", "svgOrigin"]) {
            const origin = (vars: string) => vars.match(new RegExp(`${key}:\\s*("[^"]*")`))?.[1];
            if (origin(to)) expect(origin(from), `${key} in to-vars only`).toBe(origin(to));
          }
        }
      });

      it("holds inside the beat's own window, in order", () => {
        expect(scene.holds.length).toBeGreaterThan(0);
        expect([...scene.holds].sort((a, b) => a - b)).toEqual(scene.holds);
        for (const h of scene.holds) expect(h).toBeLessThan(beat.seconds);
      });

      it("escapes source text", () => {
        expect(scene.html).not.toMatch(/<(headline|wide)>/);
      });

      it("gives one focal element ambient life, gated three ways", () => {
        const css = scene.css ?? "";
        const rules = [
          ...css.matchAll(
            /@media \(prefers-reduced-motion: no-preference\)\{([^{}]+)\{[^{}]*\}\}/g,
          ),
        ];
        // One focal element per archetype — ambient motion is not decoration.
        expect(rules).toHaveLength(1);
        expect(rules[0]?.[1]).toMatch(new RegExp(`^\\.ds-live #${sid}\\b`));

        // Nothing may animate outside that gate: a composition without `.ds-live`
        // is what `render` and `check` see, and it has to be exactly still.
        const ungated = css.replace(/@media[^{]*\{[^{}]*\{[^{}]*\}\}/g, "");
        expect(ungated).not.toContain("animation");
        expect(ungated).not.toContain("ds-live");
      });
    });
  }

  it("ambient keyframes move only transform, opacity and filter", () => {
    // Anything else reflows, and a reflow at a held stop can push audience text
    // out of frame — which nothing downstream would catch, since no gate ever
    // sees `.ds-live`.
    const frames = baseCss(theme, format);
    const keyframes = frames.slice(frames.indexOf("@keyframes"));
    expect(keyframes).toContain("@keyframes");
    const props = [...keyframes.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    expect(props.length).toBeGreaterThan(0);
    for (const prop of props) expect(["transform", "opacity", "filter"]).toContain(prop);
  });

  it("claim-figure only full-bleeds a genuine strip", () => {
    const layout = (figureId: string) => {
      const beat = structuredClone(beats[1]) as Extract<Beat, { archetype: "claim-figure" }>;
      beat.params.figureId = figureId;
      return emitScene(beat, ctx("s2")).html;
    };
    expect(layout("f2")).toContain("cf-beside");
    // 1.98 is the aspect that overflowed the canvas when full-bled (EXPERIMENT-002).
    expect(layout("f1")).toContain("cf-beside");
    expect(layout("f3")).toContain("cf-under");
  });

  it("claim-figure refuses a brief that has not been drawn, by name and with the command", () => {
    // `emitDeck` is public, so a pending slot can arrive without
    // `assertRefsResolve` having run; `no figure "undefined"` is not an answer.
    const pending: Beat = {
      ...core,
      id: "b2",
      archetype: "claim-figure",
      params: {
        headline: "H",
        claim: "The claim",
        illustration: { prompt: "a lighthouse at dusk", caption: "c" },
      },
    };
    expect(() => emitScene(pending, ctx("s2"))).toThrow(
      "claim-figure b2: illustration not generated — run `decksmith illustrate`",
    );
  });

  it("equation-walk highlights each term through KaTeX-emitted classes", () => {
    const scene = emitScene(beats[2] as Beat, ctx("s3"));
    const setup = (scene.setup ?? []).join("\n");
    expect(setup).toContain('output: "html"');
    expect(setup).toContain("htmlClass{term t-a}");
    expect(setup).toContain("htmlClass{term t-b}");
    expect(scene.tl.map((t) => t.target)).toContain("#s3 .t-a");
    expect(scene.tl.map((t) => t.target)).toContain("#s3 .t-b");
  });

  // RUN the emitted predicate against real KaTeX rather than asserting on its
  // text. This shipped broken for one build and no gate saw it: the source read
  // `c.command === "\htmlClass"`, and `\h` is not an escape, so the string was
  // `htmlClass` while KaTeX passes `\htmlClass` — the predicate was ALWAYS
  // FALSE. Every term class was silently dropped, so `#s5 .t-a` matched nothing
  // and the highlight walk animated air, with lint, check and drift all green.
  // A `toContain` on the source text would have passed the bug just as happily;
  // only executing it can tell the two spellings apart.
  it("equation-walk's KaTeX trust predicate admits \\htmlClass and still refuses \\href", async () => {
    const katex = (await import("katex")).default;
    const scene = emitScene(beats[2] as Beat, ctx("s3"));

    // The literal the browser will compare against, decoded the way a JS engine
    // would. `"\\htmlClass"` decodes to `\htmlClass`; the broken `"\htmlClass"`
    // is not even valid JSON, so this throws rather than quietly comparing the
    // wrong string — which is the whole point.
    const literal = (scene.setup ?? []).join("\n").match(/c\.command === ("(?:[^"\\]|\\.)*")/)?.[1];
    expect(literal).toBeTruthy();
    let admits: string | undefined;
    try {
      admits = JSON.parse(literal as string);
    } catch {
      // `"\htmlClass"` lands here. In JS that is the string `htmlClass`, so the
      // predicate would compare against a name KaTeX never sends.
      throw new Error(
        `the emitted trust literal ${literal} does not denote a backslash-prefixed command; ` +
          `it needs to be written "\\\\\\\\htmlClass" in the TS source`,
      );
    }

    // KaTeX's own answer for what it calls this command. Asserting against a
    // hand-written `"\\htmlClass"` here would just re-state the emitter's
    // assumption; asking KaTeX makes the two independent.
    const seen: string[] = [];
    katex.renderToString("\\htmlClass{term t-a}{x}", {
      trust: (c) => {
        seen.push(c.command);
        return true;
      },
      strict: false,
      output: "html",
    });
    expect(seen).toContain(admits);

    const trust = (c: { command: string }) => c.command === admits;
    const wrapped = katex.renderToString("\\htmlClass{term t-a}{x}", {
      trust,
      strict: false,
      output: "html",
    });
    expect(wrapped).toMatch(/class="[^"]*\bt-a\b/);

    // The other direction, from the same literal: TeX arrives from uploaded
    // documents, and the deck runs with `allow-same-origin`.
    const hostile = katex.renderToString("\\href{javascript:alert(1)}{x}", {
      trust,
      strict: false,
      output: "html",
    });
    expect(hostile).not.toContain("<a ");
    expect(hostile).not.toContain("javascript:");
  });

  it("equation-walk refuses a beat where NO term is in the equation", () => {
    const bad = structuredClone(beats[2]) as Extract<Beat, { archetype: "equation-walk" }>;
    bad.params.terms = [{ tex: "\\mathcal{Q}", label: "not there", tone: "a" }];
    // One unplaceable term among several is now dropped along with its legend
    // row rather than killing the deck — see test/arch-equation-walk.test.ts.
    // A beat where nothing at all matches still has no work to do, and still
    // throws; only the wording moved.
    expect(() => emitScene(bad, ctx("s3"))).toThrow(/none of its 1 term\(s\) occur/);
  });

  it("line-chart derives a scale that spans the data", () => {
    for (const ys of [
      [28.91, 30.47],
      [0, 1000, 340],
      [-4, -1.5],
      [7, 7],
    ]) {
      const s = chartScale(ys);
      expect(s.min).toBeLessThanOrEqual(Math.min(...ys));
      expect(s.max).toBeGreaterThanOrEqual(Math.max(...ys));
      expect(s.max).toBeGreaterThan(s.min);
    }
  });

  it("line-chart draws the axis it computed and measures the line without the DOM", () => {
    const scene = emitScene(beats[4] as Beat, ctx("s5"));
    const s = chartScale([28.91, 29.88, 30.18, 30.47]);
    expect(scene.html).toContain(`>${s.min.toFixed(s.decimals)}<`);
    expect(scene.html).toContain(`>${s.max.toFixed(s.decimals)}<`);
    expect(scene.tl.join("\n")).not.toContain("getTotalLength");
    expect(scene.tl.map(tweenText).join("\n")).toMatch(
      /strokeDasharray: \d+(\.\d+)?, strokeDashoffset/,
    );
  });

  it("line-chart keeps its outermost labels inside the svg frame", () => {
    // Both of these were container_overflow at the layout gate: the y-axis name
    // hung 13px above the frame, and the last value label 3px past its right edge.
    const scene = emitScene(beats[4] as Beat, ctx("s5"));
    const width = Number(/<svg[^>]*\swidth="(\d+)"/.exec(scene.html)?.[1]);
    // A 40px glyph's cap sits ~32px above its baseline, so the baseline cannot.
    const axname = Number(/<text class="axname" x="0" y="(\d+)"/.exec(scene.html)?.[1]);
    expect(axname).toBeGreaterThanOrEqual(40);
    const values = [...scene.html.matchAll(/<text class="pv" x="([\d.]+)"[^>]*>([^<]+)</g)];
    const last = values[values.length - 1] as RegExpMatchArray;
    // Centred on the last x, so half the label hangs past it — 0.58em at 40px.
    expect(Number(last[1]) + ((last[2] as string).length * 40 * 0.58) / 2).toBeLessThanOrEqual(
      width,
    );
  });

  /**
   * `points` has no maximum in the schema. A value sits over every point and a
   * delta over every midpoint, so both are spaced by the step between points: at
   * 5 points the step is ~250px and 40px labels clear, at 16 it is ~75px and
   * "28.90" prints straight through its neighbour — 69 overlapping pairs on one
   * slide, with every gate green.
   *
   * Thinned rather than shrunk, because 40px IS the audience floor. The test is
   * two-sided on purpose: a rule that drops labels whenever a chart gets busy
   * would also strip the demo's own five-point chart, which is correct as drawn.
   */
  it("thins chart labels as the points crowd, and leaves a sparse chart alone", () => {
    const chart = (n: number) => {
      const b = structuredClone(beats[4]) as Extract<Beat, { archetype: "line-chart" }>;
      b.params.points = Array.from({ length: n }, (_, i) => ({
        x: `T=${i}`,
        y: Number((28.9 + Math.log1p(i)).toFixed(2)),
      }));
      b.params.deltas = Array.from({ length: n - 1 }, (_, i) => `+${(0.9 / (i + 1)).toFixed(2)}`);
      const html = emitScene(b, ctx("s4")).html;
      return {
        values: (html.match(/class="pv"/g) ?? []).length,
        deltas: (html.match(/class="dv"/g) ?? []).length,
      };
    };

    // Sparse: every point labelled, every delta shown.
    expect(chart(5)).toEqual({ values: 5, deltas: 4 });
    // Crowded: the deltas go first — they sit half a step from a value either
    // side, so they are the first thing to have nowhere to be.
    expect(chart(8).deltas).toBe(0);
    // Denser still: the values thin too, and never to fewer than the two that
    // carry the range.
    for (const n of [12, 16, 24]) {
      const { values, deltas } = chart(n);
      expect(deltas, `${n} points`).toBe(0);
      expect(values, `${n} points`).toBeLessThan(n);
      expect(values, `${n} points`).toBeGreaterThanOrEqual(2);
    }

    // The demo's own chart is unchanged — it is five points and reads correctly.
    const demo = emitScene(beats[4] as Beat, ctx("s4")).html;
    expect((demo.match(/class="dv"/g) ?? []).length).toBe(3);
  });

  it("refuses a table too wide to draw at the floor, and holds the floor otherwise", () => {
    // Deriving the size from the table's width shrank six columns to 37px, which
    // is unreadable projected and clean through every gate (invariant 5). The
    // size is now derived, but only ever *upwards*, and these assertions are
    // unchanged.
    //
    // WIDTH IS NOW REFUSED TOO, and this case is the reversal.
    //
    // It used to say a too-wide table "is still set at the floor and allowed to
    // trip the layout gate, which someone can see" — the argument being that
    // width, unlike height, runs off the canvas visibly and the gate reports it.
    // Height was refused first, because a centred `.scene` hid it.
    //
    // The visibility argument was right and still insufficient, and what settled
    // it was the archetype finally being CHOSEN. While the prompt steered the
    // planner away from data-table this path never ran; the moment that steer
    // was removed, a 7-column decision matrix planned from a real 38k-word
    // document built FAIL with 34 `canvas_overflow` errors — one per cell, all
    // on one beat, arriving after a browser had laid the whole deck out, with no
    // sentence anywhere about what to do. One refusal naming the widest column
    // and three levers is worth more than 34 findings, and `onBeatError` then
    // drops that beat and keeps the deck instead of failing the build.
    //
    // So the floor still holds for a table that FITS at it — that half is
    // unchanged and asserted below — and a table that does not is refused.
    const wide = structuredClone(beats[3]) as Extract<Beat, { archetype: "data-table" }>;
    wide.params.tableId = "t2";
    wide.params.highlight = [];
    const cellSize = (beat: Beat) => {
      const css = emitScene(beat, {
        ...ctx("s4"),
        source: {
          ...source,
          tables: [
            ...source.tables,
            {
              id: "t2",
              columns: [
                "Configuration name",
                "Reconstruction accuracy",
                "Latency per image (ms)",
                "Sustained throughput",
                "Cost per thousand",
                "Notes",
              ],
              rows: [
                [
                  "Baseline transformer, no pooling",
                  "71.2416",
                  "18.4392",
                  "1204.5510",
                  "$0.003142",
                  "quoted",
                ],
              ],
            },
          ],
        },
      }).css;
      return Number(/table\{[^}]*font-size:\s*(\d+)px/.exec(css ?? "")?.[1] ?? 0);
    };
    // `t2` is six columns of long text: 2843px of demand against a 1700px box,
    // so it cannot be drawn at the floor and is refused by name.
    expect(() => cellSize(wide)).toThrow(/needs 2843px of width at the 40px floor/);
    expect(() => cellSize(wide)).toThrow(/"Configuration name" column is the widest/);
    // ...and the three-column table it shares a deck with fits, and is not held
    // at the floor: the solve is still upwards-only for anything that fits.
    expect(cellSize(beats[3] as Beat)).toBeGreaterThan(40);
  });

  /**
   * `.cf-beside` gives the claim a fixed 560px column and centres the row on its
   * tallest item, so a long claim grew the row past the body box and — being
   * centred — hung off BOTH ends. A 215-character claim rendered 27px below the
   * canvas with every gate green.
   *
   * Nothing about the figure's size fixes it: the column is fixed, so the claim's
   * height is fixed by its own text. The measure is what fixes it, so an
   * over-tall claim falls back to the full-width stack rather than being clipped.
   */
  it("stacks a claim too tall to sit beside the figure", () => {
    const long =
      "Shifting the window by half its width lets information cross the boundary between two neighbouring regions";
    const layoutOf = (claim: string) => {
      const b = structuredClone(beats[1]) as Extract<Beat, { archetype: "claim-figure" }>;
      b.params.claim = claim;
      b.params.figureId = "f2";
      const html = emitScene(b, ctx("s4")).html;
      return html.includes("cf-stack") ? "stacked" : html.includes("cf-under") ? "under" : "beside";
    };
    // Short claims keep the side-by-side reading the archetype exists for...
    expect(layoutOf("Reconstruction improves.")).toBe("beside");
    expect(
      layoutOf("Reconstruction improves monotonically across ticks on all 100 validation images."),
    ).toBe("beside");
    // ...and one that cannot fit the column takes the whole measure instead.
    expect(layoutOf(`${long}. ${long}.`)).toBe("stacked");
  });

  /**
   * Swept rather than sampled, because the thing that was wrong here was a
   * MISSING dimension rather than a wrong number: `cell` was solved from the
   * table's width and the row COUNT was never asked about at all, so a table
   * grew downwards out of its box without anything in the emitter noticing.
   *
   * What that looked like, and why it had to become a refusal: `.scene` is
   * `justify-content:center`, so an over-tall column hangs off BOTH ends, and
   * the elements that leave the canvas are `#sN-h` and `#sN-note` — the headline
   * above, the note below, the table itself apparently fine. The sweep reported
   * that at 9 rows x 5 columns and again at 10 x 6 (`scripts/sweep.mjs`), and it
   * sat open, because a report naming the headline gives the author no reason to
   * think about the row count.
   *
   * The property, not the pixel: the verdict is monotone in the rows, both
   * halves happen, and where the boundary falls is decided by the height the
   * rows are DRAWN at — so it moves with the type size and with the chrome, and
   * is pinned at four combinations of the two rather than at one.
   *
   * FOUR AND NOT ONE, because one chrome is how the first version of this rule
   * passed while being wrong twice over. It charged the 40px floor rather than
   * the size actually set, and charged the content box rather than the canvas —
   * an under-count and an over-count that cancel at exactly the 16:9 chrome
   * below, and nowhere else. Sampled there alone it looked exact; a chrome
   * tighter by 136px refused a table that renders clean, and at 9:16 it let
   * three row counts draw off the canvas, which is the defect it was written to
   * close.
   */
  it("refuses a table whose drawn rows will not fit the canvas, and not before", () => {
    const tall: Format = { ...format, id: "short-9x16", width: 1080, height: 1920 };
    // The sweep's own b09 chrome: a headline that sets on two lines at 16:9, and
    // a one-line note.
    const sweep = {
      headline: "The encoder makes the field; the partition keeps it, and nothing is discarded",
      note: "Comparison figures are quoted from their papers.",
    };

    const short = (i: number) => `M${i}`;
    const long = (i: number) => `Ablation variant ${i}`;

    interface Case {
      what: string;
      fmt: Format;
      cols: number;
      label: (i: number) => string;
      /** The column headings, which count towards the width solve as much as the cells do. */
      metric: string;
      eyebrow?: string;
      headline: string;
      note: string;
      /** The size the width solve lands on, and so the height each row costs. */
      cell: number;
      /** The most rows this chrome draws. Measured against the emitter, not derived. */
      last: number;
    }

    // EVERY `last` HERE WAS MEASURED, NOT DERIVED — one table per deck, built and
    // read from the real DOM, because the first attempt put every row count in
    // ONE deck and data-table emits `table{}`/`td{}`/`th{}` UNSCOPED, so they all
    // rendered with a single padding and the numbers were somebody else's. That
    // artifact said portrait held 11 rows where it holds 23.
    //
    // Four of the five are the exact last row count that renders inside the
    // canvas. The tight-chrome case stops one short of its measured 6, because
    // `noteHeight` predicts two lines where the browser sets one; refusing a
    // table that would have fitted is the safe side of that gap.
    //
    // NOT ONE `cell` MOVED WHEN `charUnits` STOPPED BEING EYEBALLED, which is
    // not luck. The measured table is narrower than the old buckets for wide
    // headings and briefly bought this case 43px — until the width solve started
    // charging `TH_TRACKING`, which `th` is drawn with and the solve had never
    // asked for. The two errors were opposite and close in size, and every size
    // here landed back where it was.
    //
    // The wide-column case reads "Peak signal to noise ratio" rather than
    // "Benchmark metric average" for that reason: measured honestly, the old
    // heading solves to exactly 40, and a fixture on the MIN_FONT floor is a
    // table too wide for its box — a different case, whose row boundary says
    // nothing about this one. The rebuilt case still draws 8 rows at 42px, which
    // was put through the gate stack as a real deck rather than derived.
    //
    // EVERY FIXTURE HERE FITS THE BOX WIDTHWISE, which `cell > MIN_FONT` below
    // asserts and is not a detail: the width solve only ever clamps to 40 when
    // the table is too wide for the box, and such a table is drawn overflowing
    // its sides ON PURPOSE. Sampled with one, the "more rows fit at a smaller
    // size" case built a deck that failed the gate on ten `td`s in columns five
    // and six — nothing to do with the row count, and no evidence about it.
    const CASES: Case[] = [
      {
        what: "16:9, three short columns — type at the 52px cap",
        fmt: format,
        cols: 3,
        label: short,
        metric: "Metric",
        ...sweep,
        cell: 52,
        last: 7,
      },
      // SAME FORMAT, SAME CHROME, SAME COLUMN COUNT, DIFFERENT ANSWER — the
      // property the rule turns on, and the one an earlier version of this test
      // asserted the opposite of by pinning the verdict as column-independent.
      // What moved is the type: wider headings solve to 42px, a 42px row stands
      // 12px shorter than a 52px one, and two more of them fit.
      {
        what: "16:9, three wide columns — same count, 42px type, two more rows",
        fmt: format,
        cols: 3,
        label: long,
        metric: "Peak signal to noise ratio",
        ...sweep,
        cell: 42,
        last: 8,
      },
      {
        what: "16:9, six columns — twice the columns, a third boundary again",
        fmt: format,
        cols: 6,
        label: long,
        metric: "Metric",
        ...sweep,
        cell: 49,
        last: 7,
      },
      {
        what: "9:16, three short columns — the same rule against twice the height",
        fmt: tall,
        cols: 3,
        label: short,
        metric: "Metric",
        ...sweep,
        cell: 52,
        last: 23,
      },
      // THE CASE THAT CATCHES AN OVER-STRICT RULE, and the one the first version
      // failed: an eyebrow and a two-line note leave 478px here against the
      // 614px above, and six rows still draw. The demo ships five.
      {
        what: "a tighter 16:9 chrome with an eyebrow, shaped like the demo's b09",
        fmt: format,
        cols: 3,
        label: short,
        metric: "Metric",
        eyebrow: "Quantitative comparison · ×4",
        headline: "Competitive with CNN baselines, behind recent models",
        note: "Comparison figures are quoted from their papers; only DQ-CTM-SR was trained here.",
        cell: 52,
        last: 5,
      },
    ];

    const verdict = (c: Case, n: number) => {
      const beat = structuredClone(beats[3]) as Extract<Beat, { archetype: "data-table" }>;
      beat.params.eyebrow = c.eyebrow;
      beat.params.headline = c.headline;
      beat.params.note = c.note;
      beat.params.tableId = "t3";
      beat.params.highlight = [];
      const where = `${n} rows x ${c.cols} cols — ${c.what}`;
      expect(beatSchema.safeParse(beat).success, where).toBe(true);
      const table = {
        id: "t3",
        columns: [
          "Method",
          ...Array.from({ length: c.cols - 1 }, (_, j) => `${c.metric} ${j + 1}`),
        ],
        rows: Array.from({ length: n }, (_, i) => [
          c.label(i),
          ...Array.from({ length: c.cols - 1 }, (_, j) => (28.9 + i + j / 10).toFixed(3)),
        ]),
      };
      // Caught and re-read OUTSIDE the try, so an assertion of this test's own
      // cannot be mistaken for the emitter refusing.
      let css: string | undefined;
      let refusal: string | undefined;
      try {
        css = emitScene(beat, {
          ...ctx("s4"),
          format: c.fmt,
          source: { ...source, tables: [...source.tables, table] },
        }).css;
      } catch (err) {
        refusal = (err as Error).message;
      }
      if (refusal !== undefined) {
        // The message names the row count, the height it wanted and the size it
        // wanted it at — the last of which is the whole reason these cases
        // differ from one another.
        expect(refusal, where).toMatch(
          /^data-table b4: table "t3" has \d+ rows, which with the header stand \d+px tall at \d+px type/,
        );
        return "refused";
      }
      const set = Number((css as string).match(/table\{[^}]*font-size:(\d+)px/)?.[1]);
      // The size the rows are actually set at, which is what decides where this
      // case's boundary falls — and, being above the floor, proof that the width
      // solve did not clamp and so that this table fits its box.
      expect(set, `${where}: set at ${set}px`).toBe(c.cell);
      expect(set, `${where}: clamped to the floor, so this table overruns its box`).toBeGreaterThan(
        40,
      );
      return "drawn";
    };

    for (const c of CASES) {
      let seenRefusal = false;
      // Two past the boundary, so every leg sees both answers and none of the
      // assertions below is carried by another case. Scanning to 12 was how the
      // 9:16 leg came to assert nothing at all: it refuses at 24.
      for (let n = 1; n <= c.last + 2; n++) {
        const got = verdict(c, n);
        // Monotone: rows only ever cost height, so a table that fits cannot be
        // one row longer than a table that does not.
        if (seenRefusal) expect(got, `${n} rows after a refusal — ${c.what}`).toBe("refused");
        seenRefusal ||= got === "refused";
        expect(got, `${n} rows — ${c.what}`).toBe(n <= c.last ? "drawn" : "refused");
      }
      expect(seenRefusal, `never refused anything — ${c.what}`).toBe(true);
    }
  });

  it("data-table refuses a highlight that matches no row", () => {
    const bad = structuredClone(beats[3]) as Extract<Beat, { archetype: "data-table" }>;
    bad.params.highlight = [{ row: "Nonexistent", tone: "a" }];
    expect(() => emitScene(bad, ctx("s4"))).toThrow(/no row labelled/);
  });

  /**
   * Swept rather than sampled, for the same reason grid's note is: the panels'
   * height cap was derived from the panels' own content and never asked what the
   * slide had left, so it grew with the text right past the box. Three panels of
   * four lines wanted 834px of a 693px box at 16:9 — and `.panels` is
   * `flex:1;min-height:0`, so the box was clamped and the TEXT overflowed, out
   * through the border, over the note, off the bottom, clipped by `.scene` with
   * nothing anywhere reporting it.
   *
   * The property, not the pixel: whatever a callout emits fits the budget the
   * rest of the archetypes measure themselves against. A beat too tall for that
   * is refused, which `onBeatError` can act on — silence is the only answer that
   * is wrong.
   */
  it("never emits panels taller than the slide has room for, at any panel or line count", () => {
    const tall: Format = { ...format, id: "reel-9x16", width: 1080, height: 1920 };
    const LINES = [
      "PSNR-Y 28.10 → 30.28",
      "The source defines windowing over the dense field and never says what happens at the edge",
      "Set5 32.44",
    ];
    let refused = 0;
    let drawn = 0;
    for (const nPanels of [1, 2, 3]) {
      for (const nLines of [1, 2, 4, 8]) {
        for (const fmt of [format, tall]) {
          const beat = structuredClone(beats[5]) as Extract<Beat, { archetype: "callout" }>;
          beat.params.headline = "A headline of moderate length";
          beat.params.panels = Array.from({ length: nPanels }, (_, i) => ({
            label: `panel ${i}`,
            lines: Array.from({ length: nLines }, (_, j) => LINES[j % LINES.length] as string),
          }));
          const where = `${nPanels}p x ${nLines}l ${fmt.id}`;
          expect(beatSchema.safeParse(beat).success, where).toBe(true);
          let html: string;
          try {
            html = emitScene(beat, { ...ctx("s4"), format: fmt }).html;
          } catch (err) {
            expect((err as Error).message, where).toMatch(/^callout b6: \d+px of panel/);
            refused++;
            continue;
          }
          drawn++;
          const budget = bodyBudget(
            fmt,
            beat.params.eyebrow,
            beat.params.headline,
            noteHeight(beat.params.note, noteWidth(fmt)),
          );
          const cap = Number(/class="panels"[^>]*max-height:(\d+)px/.exec(html)?.[1]);
          expect(cap, where).toBeGreaterThan(0);
          expect(cap, `${where} overflows`).toBeLessThanOrEqual(budget);
        }
      }
    }
    // Neither half of the gate is vacuous: the sweep both draws and refuses.
    expect(drawn).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});
