import { readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { codexCommand, codexPlanner, SCHEMA } from "../src/plan/codex.js";
import { renderSource } from "../src/plan/prompt.js";
import { assertRefsResolve, pendingIllustrations } from "../src/plan/refs.js";
import { prefsSchema, sourceSchema, storyboardSchema } from "../src/types.js";

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

/**
 * A brief with no figure beside it is a slot `illustrate` has not reached. Every
 * reader that needs the figure refuses it; only the planner is allowed to keep
 * it, and only when it was asked to produce one.
 */
describe("assertRefsResolve with a pending illustration", () => {
  const brief = { prompt: "a lighthouse on a headland at dusk", caption: "The lighthouse" };
  const { figureId: _resolved, ...unresolved } = beat.params;
  const pendingBeat = { ...beat, params: { ...unresolved, illustration: brief } };
  const split = {
    ...beat,
    id: "b02-split",
    archetype: "split-compare",
    params: {
      headline: "Before and after",
      left: { label: "Before", illustration: brief },
      right: { label: "After", lines: ["sharper"] },
    },
  };

  it("refuses it by default, naming the slot and the command that fills it", () => {
    expect(() => assertRefsResolve(plan(pendingBeat), source)).toThrow(
      'beat "b01-arch" params.figureId: asks for an illustration that has not been generated — run `decksmith illustrate`',
    );
    expect(() => assertRefsResolve(plan(pendingBeat), source, { pending: "refuse" })).toThrow(
      /decksmith illustrate/,
    );
  });

  it("keeps it when the caller says so", () => {
    expect(() => assertRefsResolve(plan(pendingBeat), source, { pending: "allow" })).not.toThrow();
  });

  it("treats a split-compare side with a brief as pending, and a bare side as a list", () => {
    expect(() => assertRefsResolve(plan(split), source)).toThrow(
      /params\.left\.figureId: asks for an illustration/,
    );
    const listed = {
      ...split,
      params: { ...split.params, left: { label: "Before", lines: ["x"] } },
    };
    expect(() => assertRefsResolve(plan(listed), source)).not.toThrow();
    expect(pendingIllustrations(plan(split))).toEqual([
      { beatId: "b02-split", where: "params.left.figureId" },
    ]);
  });

  it("stops being pending once the brief has a figure beside it", () => {
    // What `illustrate` leaves behind: both fields, the figure registered.
    const drawn = plan({ ...beat, params: { ...beat.params, illustration: brief } });
    expect(pendingIllustrations(drawn)).toEqual([]);
    expect(() => assertRefsResolve(drawn, source)).not.toThrow();
  });

  it("reports a dangling id before a pending brief, since no command fixes the former", () => {
    const both = plan({ ...pendingBeat, evidence: [{ kind: "equation", id: "eq-psnr" }] });
    expect(() => assertRefsResolve(both, source)).toThrow(/do not exist.*eq-psnr/s);
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

  // The schema always admits a brief, so the model can write one it was never
  // invited to. That is not a plan to run `illustrate` on — the user did not ask
  // for pictures — and the message has to name the flag, not the next command.
  const asksForAPicture = RECORDED.replace(
    '"figureId":"fig-arch"',
    '"illustration":{"prompt":"a refinement loop as gears","caption":"The loop"}',
  );

  it("refuses a brief the prompt never invited, and names the flag that would", async () => {
    await expect(replay(asksForAPicture)).rejects.toThrow(/b01-arch.*--images/s);
    await expect(replay(asksForAPicture)).rejects.not.toThrow(/decksmith illustrate/);
  });

  it("keeps a pending brief when images are on, and tells the model it may write one", async () => {
    let sent = "";
    const result = await codexPlanner(source, {
      prefs: prefsSchema.parse({ images: { enabled: true } }),
      run: async ({ prompt, outPath }) => {
        sent = prompt;
        await writeFile(outPath, asksForAPicture);
      },
    });
    expect(sent).toContain("ILLUSTRATIONS");
    const [first] = result.beats;
    expect(first?.archetype).toBe("claim-figure");
    expect(first?.archetype === "claim-figure" ? first.params.figureId : "x").toBeUndefined();
    expect(pendingIllustrations(result)).toEqual([
      { beatId: "b01-arch", where: "params.figureId" },
    ]);
  });
});

/**
 * The argv is a contract with a binary the suite may never spawn, so it is
 * pinned by reading it. The read-only line is what the planner has always sent;
 * the workspace-write line is what `illustrate`'s Codex rung sends, fenced to its
 * scratch directory three ways.
 */
describe("codexCommand", () => {
  const args = { prompt: "p", schemaPath: "/s.json", outPath: "/o.json", timeoutMs: 1 };

  it("sends the read-only planner line unchanged when nothing extra is asked", () => {
    expect(codexCommand(args)).toEqual({
      argv: [
        "exec",
        "--output-schema",
        "/s.json",
        "-o",
        "/o.json",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        "--color",
        "never",
        "-",
      ],
    });
    expect(codexCommand({ ...args, model: "m" }).argv).toContain("--model");
  });

  it("adds -C for a cwd and nothing else under read-only", () => {
    const { argv, env } = codexCommand({ ...args, cwd: "/work" });
    expect(argv.slice(5, 9)).toEqual(["-C", "/work", "--sandbox", "read-only"]);
    expect(argv).not.toContain("-c");
    expect(env).toBeUndefined();
  });

  it("fences workspace-write to the cwd: the flag, the two overrides, and TMPDIR", () => {
    const { argv, env } = codexCommand({ ...args, cwd: "/work", sandbox: "workspace-write" });
    expect(argv.slice(5, 13)).toEqual([
      "-C",
      "/work",
      "--sandbox",
      "workspace-write",
      "-c",
      "sandbox_workspace_write.exclude_tmpdir_env_var=true",
      "-c",
      "sandbox_workspace_write.exclude_slash_tmp=true",
    ]);
    expect(argv.slice(-5)).toEqual([
      "--skip-git-repo-check",
      "--ephemeral",
      "--color",
      "never",
      "-",
    ]);
    // The process environment comes along — `codex` needs its PATH and its
    // login — with only TMPDIR moved.
    expect(env?.TMPDIR).toBe("/work");
    expect(env?.PATH).toBe(process.env.PATH);
  });

  it("refuses workspace-write with nowhere to fence it to", () => {
    expect(() => codexCommand({ ...args, sandbox: "workspace-write" })).toThrow(/needs a cwd/);
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

  it("offers claim-figure both a figureId and a brief, each declinable with null", () => {
    // The "at least one" rule is a refinement, which `z.toJSONSchema` drops on
    // purpose: the model sees one flat object and `storyboardSchema.parse`
    // enforces the rule on the way back. What has to survive is that both keys
    // are present, required, and nullable — strict mode admits nothing else.
    type Node = { properties?: Record<string, Node>; required?: string[]; const?: unknown };
    const find = (node: unknown): Node | undefined => {
      if (Array.isArray(node)) return node.map(find).find(Boolean);
      if (node === null || typeof node !== "object") return undefined;
      const o = node as Node;
      if (o.properties?.archetype?.const === "claim-figure") return o;
      return Object.values(o).map(find).find(Boolean);
    };
    const params = find(SCHEMA)?.properties?.params;
    expect(params?.required).toEqual(expect.arrayContaining(["figureId", "illustration"]));
    expect(JSON.stringify(params?.properties?.figureId)).toContain('"null"');
    expect(JSON.stringify(params?.properties?.illustration)).toContain('"null"');
    expect(JSON.stringify(params?.properties?.illustration)).toContain('"caption"');
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

describe("what the planner's schema does and does not offer", () => {
  const json = JSON.stringify(SCHEMA);

  it("hides params whose range the backend cannot express", () => {
    // `tilt` is 0-18 degrees in zod. `forStructuredOutput` strips `minimum` and
    // `maximum` because no structured-output backend takes them, so the model
    // would see an unbounded number — and, because every property is listed in
    // `required`, be invited to write one. `storyboardSchema.safeParse` then
    // rejects anything over 18 and throws away the WHOLE storyboard: ten minutes
    // of planning lost to a range nobody showed the model.
    expect(json).not.toContain('"tilt"');
    expect(json).not.toMatch(/"required":\[[^\]]*"tilt"/);
  });

  it("carries no numeric bounds at all, which is why hiding is the remedy", () => {
    // If this ever becomes false, a bounded param could be exposed safely and
    // this whole mechanism deserves revisiting.
    expect(json).not.toContain("minimum");
    expect(json).not.toContain("maximum");
  });

  it("leaves the rest of the params alone", () => {
    expect(json).toContain('"layers"');
    expect(json).toContain('"headline"');
  });
});
