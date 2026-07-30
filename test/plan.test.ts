import { readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { codexPlanner, SCHEMA } from "../src/plan/codex.js";
import { renderSource } from "../src/plan/prompt.js";
import { assertRefsResolve } from "../src/plan/refs.js";
import { sourceSchema, storyboardSchema } from "../src/types.js";

const source = sourceSchema.parse({
  id: "thinksr",
  title: "Thinking in Super-Resolution",
  lang: "en",
  sections: [
    { id: "sec-intro", depth: 1, heading: "Introduction", text: "Upscalers hallucinate detail." },
    { id: "sec-cost", depth: 2, heading: "Cost", text: "Each refinement step doubles latency." },
    { id: "sec-limits", depth: 2, heading: "Limits", text: "Gains flatten past four steps." },
  ],
  figures: [
    {
      id: "fig-arch",
      src: "fig-arch.webp",
      caption: "The refinement loop",
      width: 1200,
      height: 800,
    },
  ],
  equations: [{ id: "eq-loss", tex: "\\mathcal{L} = \\|x - \\hat{x}\\|_2^2", display: true }],
  tables: [
    {
      id: "tab-psnr",
      caption: "PSNR by step count",
      columns: ["Steps", "PSNR"],
      rows: [
        ["1", "28.1"],
        ["4", "31.7"],
      ],
    },
  ],
});

const beat = {
  id: "b01-arch",
  intent: "The upscaler refines its own output rather than predicting it once.",
  claim: "Each refinement step doubles latency.",
  evidence: [
    { kind: "figure", id: "fig-arch" },
    { kind: "section", id: "sec-cost" },
  ],
  weight: 0.9,
  archetype: "claim-figure",
  params: {
    headline: "Refine, don't guess",
    claim: "Each pass costs another forward.",
    figureId: "fig-arch",
  },
};

const plan = (...beats: unknown[]) =>
  storyboardSchema.parse({ sourceId: "thinksr", title: "Thinking in Super-Resolution", beats });

const storyboard = plan(beat);

describe("assertRefsResolve", () => {
  it("accepts a storyboard whose every id is in the source", () => {
    expect(() => assertRefsResolve(storyboard, source)).not.toThrow();
  });

  it("catches a dangling figure id and names the offender", () => {
    const broken = plan({ ...beat, params: { ...beat.params, figureId: "fig-teaser" } });

    expect(() => assertRefsResolve(broken, source)).toThrow(
      /b01-arch.*params\.figureId.*fig-teaser/s,
    );
  });

  it("catches a dangling id in evidence, which the schema cannot see", () => {
    const broken = plan({ ...beat, evidence: [{ kind: "equation", id: "eq-psnr" }] });

    expect(() => assertRefsResolve(broken, source)).toThrow(/evidence.*eq-psnr/s);
  });
});

describe("renderSource", () => {
  it("lists every id the model is allowed to cite", () => {
    const rendered = renderSource(source);
    const ids = [
      ...source.sections.map((s) => s.id),
      ...source.figures.map((f) => f.id),
      ...source.equations.map((e) => e.id),
      ...source.tables.map((t) => t.id),
    ];

    for (const id of ids) expect(rendered).toContain(id);
  });

  it("carries the captions and table rows that make an id citable", () => {
    const rendered = renderSource(source);

    expect(rendered).toContain("The refinement loop");
    expect(rendered).toContain("\\mathcal{L}");
    // `data-table.highlight[].row` matches a first-column value verbatim, so the
    // rows have to survive rendering or the model cannot produce a valid one.
    expect(rendered).toContain("row: 4 | 31.7");
  });
});

/* ------------------------------------------------------- the response path */

/**
 * What a good run returns: one beat per archetype, every id drawn from `source`.
 * Serialised rather than passed as an object, so `codexPlanner` runs the same
 * JSON.parse it runs live and a slice of this string is a genuine truncation.
 */
const RECORDED = JSON.stringify({
  sourceId: "thinksr",
  title: "Thinking in Super-Resolution",
  beats: [
    beat,
    {
      id: "b02-loss",
      intent: "The objective is plain L2 against the reference.",
      weight: 0.7,
      archetype: "equation-walk",
      params: {
        headline: "The loss is not the clever part",
        equationId: "eq-loss",
        terms: [{ tex: "\\hat{x}", label: "the current estimate", tone: "a" }],
      },
    },
    {
      id: "b03-psnr",
      intent: "Gains flatten after four steps.",
      evidence: [{ kind: "table", id: "tab-psnr" }],
      weight: 0.8,
      archetype: "data-table",
      params: {
        headline: "Four steps is where it stops paying",
        tableId: "tab-psnr",
        highlight: [{ row: "4", tone: "b" }],
      },
    },
  ],
});

/** Drives the real parse/validate/integrity path with a canned final message. */
const replay = (body: string) =>
  codexPlanner(source, {
    run: async ({ outPath }) => {
      await writeFile(outPath, body);
    },
  });

describe("codexPlanner response path", () => {
  it("turns a recorded final message into a valid Storyboard", async () => {
    const result = await replay(RECORDED);
    expect(result.beats.map((b) => b.archetype)).toEqual([
      "claim-figure",
      "equation-walk",
      "data-table",
    ]);
    // Defaulted fields the schema fills in, so the model never has to invent them.
    expect(result.theme).toBe("ink");
  });

  it("rejects a body citing a figure the source does not have", async () => {
    const bad = RECORDED.replace('"figureId":"fig-arch"', '"figureId":"fig-ghost"');
    await expect(replay(bad)).rejects.toThrow(/no figure "fig-ghost"/);
  });

  it("rejects a beat whose params do not match its archetype", async () => {
    const bad = RECORDED.replace('"tableId":"tab-psnr"', '"figureId":"fig-arch"');
    await expect(replay(bad)).rejects.toThrow(/does not validate/);
  });

  it("reports truncated JSON as truncated JSON, not as a schema failure", async () => {
    await expect(replay(RECORDED.slice(0, 220))).rejects.toThrow(/was not JSON/);
  });

  it("says so when Codex writes no final message at all", async () => {
    await expect(replay("   ")).rejects.toThrow(/no final message/);
  });

  it("cleans up its temp directory even when the run fails", async () => {
    const before = await readdir(tmpdir());
    await expect(
      codexPlanner(source, {
        run: () => Promise.reject(new Error("boom")),
      }),
    ).rejects.toThrow("boom");
    const after = await readdir(tmpdir());
    expect(after.filter((d) => d.startsWith("decksmith-plan-")).length).toBe(
      before.filter((d) => d.startsWith("decksmith-plan-")).length,
    );
  });
});

describe("the schema handed to Codex", () => {
  it("is legal structured output: closed objects, no unsupported keywords", () => {
    const banned = new Set(["$schema", "default", "minimum", "maximum", "minLength", "oneOf"]);
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        for (const [i, n] of node.entries()) walk(n, `${path}[${i}]`);
        return;
      }
      if (node === null || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        expect(banned.has(key), `${path}.${key} is not accepted by structured outputs`).toBe(false);
        walk(value, `${path}.${key}`);
      }
      if ((node as { type?: string }).type === "object") {
        expect((node as { additionalProperties?: boolean }).additionalProperties).toBe(false);
      }
    };
    walk(SCHEMA, "schema");
  });

  it("requires every property, because strict mode 400s otherwise", () => {
    // Found by the first live call: leaving an optional key out of `required`
    // is rejected, not defaulted. Optionality is expressed as nullability.
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        for (const [i, n] of node.entries()) walk(n, `${path}[${i}]`);
        return;
      }
      if (node === null || typeof node !== "object") return;
      const o = node as {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      if (o.type === "object" && o.properties) {
        expect(o.required ?? [], `${path} must require every property`).toEqual(
          Object.keys(o.properties),
        );
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(SCHEMA, "schema");
  });

  it("makes a formerly-optional field nullable rather than dropping it", () => {
    const title = (SCHEMA as { properties: Record<string, { anyOf?: unknown[] }> }).properties
      .theme;
    expect(JSON.stringify(title)).toContain('"null"');
  });

  it("turns the nulls back into absent fields before validating", async () => {
    const withNulls = JSON.parse(RECORDED) as {
      theme?: unknown;
      beats: Array<{ params: Record<string, unknown> }>;
    };
    const [recorded] = withNulls.beats;
    if (!recorded) throw new Error("the recorded reply must have a beat to null a field on");
    withNulls.theme = null;
    recorded.params.eyebrow = null;

    const result = await replay(JSON.stringify(withNulls));
    const [planned] = result.beats;
    expect(result.theme).toBe("ink");
    expect(planned).toBeDefined();
    expect(planned?.params.eyebrow).toBeUndefined();
  });
});
