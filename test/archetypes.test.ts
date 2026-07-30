import { describe, expect, it } from "vitest";
import { emitScene, emitters } from "../src/emit/archetypes/index.js";
import { chartScale } from "../src/emit/archetypes/line-chart.js";
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

  it("sets table cells at the 40px floor however wide the table is", () => {
    // Deriving the size from the table's width shrank six columns to 37px, which
    // is unreadable projected and clean through every gate (invariant 10). The
    // size is now derived, but only ever *upwards*: a table that would not fit at
    // the floor is still set at the floor and allowed to trip the layout gate,
    // which someone can see.
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
    expect(cellSize(wide)).toBe(40);
    // ...and the three-column table it shares a deck with is not held there.
    expect(cellSize(beats[3] as Beat)).toBeGreaterThan(40);
  });

  it("data-table refuses a highlight that matches no row", () => {
    const bad = structuredClone(beats[3]) as Extract<Beat, { archetype: "data-table" }>;
    bad.params.highlight = [{ row: "Nonexistent", tone: "a" }];
    expect(() => emitScene(bad, ctx("s4"))).toThrow(/no row labelled/);
  });
});
