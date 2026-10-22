import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { codexCommand, codexPlanner, SCHEMA, schemaFor } from "../src/plan/codex.js";
import { renderSource } from "../src/plan/prompt.js";
import { assertRefsResolve, pendingIllustrations } from "../src/plan/refs.js";
import { literalSchema, prefsSchema, sourceSchema, storyboardSchema } from "../src/types.js";

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

  it("catches a dangling equation on either side of a morph", () => {
    const morph = {
      id: "b04-morph",
      intent: "i",
      weight: 0.5,
      archetype: "equation-morph",
      params: {
        headline: "H",
        fromId: "eq-loss",
        toId: "eq-nowhere",
        terms: [{ tex: "\\hat{x}", label: "estimate", tone: "a" }],
      },
    };
    expect(() => assertRefsResolve(plan(beat, morph), source)).toThrow(
      /b04-morph.*params\.toId.*eq-nowhere/s,
    );
  });

  it("catches a dangling figure on a stage, before build spends anything on it", () => {
    const stage = (figureId: string) => ({
      id: "b02-stage",
      intent: "i",
      weight: 0.7,
      archetype: "stage",
      params: { headline: "The loop", figureId, placement: "bottom-left" },
    });
    expect(() => assertRefsResolve(plan(beat, stage("fig-arch")), source)).not.toThrow();
    expect(() => assertRefsResolve(plan(beat, stage("fig-hero")), source)).toThrow(
      /b02-stage.*params\.figureId.*fig-hero/s,
    );
  });

  it("catches a dangling id in evidence, which the schema cannot see", () => {
    const broken = plan({ ...beat, evidence: [{ kind: "equation", id: "eq-psnr" }] });

    expect(() => assertRefsResolve(broken, source)).toThrow(/evidence.*eq-psnr/s);
  });

  it("has nothing to resolve in a line chart's second series", () => {
    // A CHANGE DELIBERATELY NOT MADE, recorded where a reader would look for it.
    // `line-chart.compare` was the fifth of five places the reshape was expected
    // to touch, and it is the one that legitimately collapses: `compare.points`
    // are LITERALS — numbers and category names the plan wrote down — not ids
    // into `source`, so there is no reference here for this gate to dangle.
    //
    // What can actually go wrong with them — a series of the wrong length, or
    // one over different categories — is a params invariant, and
    // `lineChartParamsSchema` refuses it before a beat has been spent on it
    // (test/types.test.ts). Adding a case to the switch above would be a gate
    // that can never fire, which is worse than no gate: it reads as coverage.
    const chart = {
      id: "b05-chart",
      intent: "i",
      weight: 0.5,
      archetype: "line-chart",
      params: {
        headline: "H",
        xLabel: "Steps",
        yLabel: "PSNR (dB)",
        points: [
          { x: "T=0", y: 28.91 },
          { x: "T=1", y: 30.47 },
        ],
        compare: {
          label: "Without pretraining",
          points: [
            { x: "T=0", y: 27.4 },
            { x: "T=1", y: 28.4 },
          ],
        },
      },
    };
    expect(() => assertRefsResolve(plan(beat, chart), source)).not.toThrow();
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

  // Its OWN directory, named by the path the run was handed. Counting
  // `decksmith-plan-*` in the shared tmpdir raced every planner run in a test
  // file running in parallel: CI on 2026-09-17 saw 1 before and 0 after, on a
  // tree that had passed two hours earlier.
  it("cleans up its temp directory even when the run fails", async () => {
    let dir = "";
    await expect(
      codexPlanner(source, {
        run: async ({ outPath }) => {
          dir = dirname(outPath);
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
    expect(dir).toContain("decksmith-plan-");
    await expect(stat(dir)).rejects.toThrow(/ENOENT/);
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
 * The variety rule is enforced where the plan comes back (src/plan/variety.ts):
 * one repair round carrying the reasons and the plan's own JSON, then a refusal.
 */
describe("codexPlanner variety repair", () => {
  const twice = JSON.parse(RECORDED) as { beats: Array<Record<string, unknown>> };
  // b01 and b02 both claim-figure, side by side.
  const adjacent = JSON.stringify({
    ...twice,
    beats: [twice.beats[0], { ...twice.beats[0], id: "b01b-arch" }, ...twice.beats.slice(1)],
  });

  // The repair keeps all four beats and only moves b01b away from its twin.
  const reordered = JSON.stringify({
    ...twice,
    beats: [twice.beats[0], twice.beats[1], { ...twice.beats[0], id: "b01b-arch" }, twice.beats[2]],
  });

  it("sends a plan that breaks it back once, with the reasons and the plan, and keeps the repair", async () => {
    const prompts: string[] = [];
    const repaired: string[][] = [];
    const result = await codexPlanner(source, {
      onRepair: (broken) => repaired.push([...broken]),
      run: async ({ prompt, outPath }) => {
        prompts.push(prompt);
        await writeFile(outPath, prompts.length === 1 ? adjacent : reordered);
      },
    });
    expect(prompts).toHaveLength(2);
    expect(repaired).toEqual([
      [expect.stringMatching(/b01-arch and b01b-arch are both `claim-figure`/)],
    ]);
    expect(prompts[1]).toContain("BREAKS THE VARIETY RULES");
    // The reasons themselves, not just the header: a repair asked for blind
    // re-rolls the shapes instead of fixing the named ones.
    for (const reason of repaired[0] ?? []) expect(prompts[1]).toContain(`  - ${reason}`);
    expect(prompts[1]).toContain('"id":"b01b-arch"');
    expect(result.beats.map((b) => b.id)).toEqual([
      "b01-arch",
      "b02-loss",
      "b01b-arch",
      "b03-psnr",
    ]);
  });

  it("keeps a plan the second repair fixes", async () => {
    const prompts: string[] = [];
    const result = await codexPlanner(source, {
      run: async ({ prompt, outPath }) => {
        prompts.push(prompt);
        await writeFile(outPath, prompts.length < 3 ? adjacent : reordered);
      },
    });
    expect(prompts).toHaveLength(3);
    expect(result.beats.map((b) => b.id)).toContain("b01b-arch");
  });

  it("refuses a repair that drops beats, even when what is left is varied", async () => {
    let calls = 0;
    await expect(
      codexPlanner(source, {
        run: async ({ outPath }) => {
          calls++;
          await writeFile(outPath, calls === 1 ? adjacent : RECORDED);
        },
      }),
    ).rejects.toThrow(/returned 3 beats for a plan of 4/);
    expect(calls).toBe(4);
  });

  // Each ask starts from an empty out file, so a second run that writes nothing
  // is reported as nothing — not as the first plan read back and refused again.
  it("says the repair wrote no final message, rather than re-reading the first plan", async () => {
    let calls = 0;
    await expect(
      codexPlanner(source, {
        run: async ({ outPath }) => {
          calls++;
          if (calls === 1) await writeFile(outPath, adjacent);
        },
      }),
    ).rejects.toThrow(/no final message/);
    expect(calls).toBe(2);
  });

  it("refuses, naming the rule, when the repair still breaks it", async () => {
    let calls = 0;
    await expect(
      codexPlanner(source, {
        run: async ({ outPath }) => {
          calls++;
          await writeFile(outPath, adjacent);
        },
      }),
    ).rejects.toThrow(/variety rule .* after 3 repairs:\n.*b01b-arch/s);
    // Three deck repairs, then two asks for b01b on its own, neither a beat.
    expect(calls).toBe(6);
  });

  it("redraws a beat still beside its own shape after the last repair, offered only shapes that fit", async () => {
    const schemas: unknown[] = [];
    const reshaped: Array<[string, readonly string[]]> = [];
    const table = twice.beats[2];
    const result = await codexPlanner(source, {
      onReshape: (beat, shapes) => reshaped.push([beat, shapes]),
      run: async ({ schemaPath, outPath }) => {
        if (!schemaPath.endsWith("beat.schema.json")) return writeFile(outPath, adjacent);
        schemas.push(JSON.parse(await readFile(schemaPath, "utf8")));
        await writeFile(outPath, JSON.stringify({ beat: { ...table, id: "anything" } }));
      },
    });
    // b01b sat between claim-figure b01 and equation-walk b02: neither is offered.
    const offered = (
      schemas[0] as {
        properties: { beat: { anyOf: Array<{ properties: { archetype: { const: string } } }> } };
      }
    ).properties.beat.anyOf.map((v) => v.properties.archetype.const);
    expect(offered).toContain("data-table");
    expect(offered).not.toContain("claim-figure");
    expect(offered).not.toContain("equation-walk");
    expect(offered).not.toContain("title");
    expect(reshaped.map(([b]) => b)).toEqual(["b01b-arch"]);
    // The redraw keeps the beat's id, whatever the answer called it.
    expect(result.beats.map((b) => `${b.id} ${b.archetype}`)).toEqual([
      "b01-arch claim-figure",
      "b01b-arch data-table",
      "b02-loss equation-walk",
      "b03-psnr data-table",
    ]);
  });

  // A schema or reference miss is one number or one id: it goes through the same one
  // repair, not straight to a failed run (HypePaper, 2026-10-12: 40 of 109 plans).
  it("repairs a plan that does not validate, sending the issue and the plan", async () => {
    const prompts: string[] = [];
    const bad = RECORDED.replace('"tableId":"tab-psnr"', '"figureId":"fig-arch"');
    const result = await codexPlanner(source, {
      run: async ({ prompt, outPath }) => {
        prompts.push(prompt);
        await writeFile(outPath, prompts.length === 1 ? bad : RECORDED);
      },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("IS REFUSED FOR");
    expect(prompts[1]).toMatch(/ {2}- beats\.2\.params/);
    expect(result.beats).toHaveLength(3);
  });

  it("repairs a plan citing an id the source lacks", async () => {
    let calls = 0;
    const result = await codexPlanner(source, {
      run: async ({ outPath }) => {
        calls++;
        await writeFile(
          outPath,
          calls === 1
            ? RECORDED.replace('"figureId":"fig-arch"', '"figureId":"fig-ghost"')
            : RECORDED,
        );
      },
    });
    expect(calls).toBe(2);
    expect(result.beats[0]?.id).toBe("b01-arch");
  });

  // Chinchilla, round 27: 24 beats and one invented figure id; told only of the id,
  // the repair kept 24 and the last round refused it for a length never told.
  it("tells a refused plan it is too long, too, and keeps the repair that merges", async () => {
    const prompts: string[] = [];
    const long = JSON.parse(RECORDED) as { beats: Array<{ id: string }> };
    const extra = (id: string, i: number) => ({ ...long.beats[i], id });
    long.beats.push(extra("b04-loss", 1), extra("b05-psnr", 2));
    const bad = JSON.stringify(long).replace('"figureId":"fig-arch"', '"figureId":"fig-ghost"');
    const result = await codexPlanner(source, {
      prefs: prefsSchema.parse({ slides: 3 }),
      run: async ({ prompt, outPath }) => {
        prompts.push(prompt);
        await writeFile(outPath, prompts.length === 1 ? bad : RECORDED);
      },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("IS REFUSED FOR");
    expect(prompts[1]).toContain("IS TOO LONG");
    expect(prompts[1]).toContain("5 beats against a target of 3; at most 4 may come back");
    expect(result.beats).toHaveLength(3);
  });

  it("with images off, never suggests a picture brief in the repair", async () => {
    const prompts: string[] = [];
    await codexPlanner(source, {
      run: async ({ prompt, outPath }) => {
        prompts.push(prompt);
        await writeFile(outPath, prompts.length === 1 ? adjacent : reordered);
      },
    });
    expect(prompts[1]).not.toMatch(/illustration briefs|backdrop brief/);
  });

  it("asks once when the first plan is already varied", async () => {
    let calls = 0;
    await codexPlanner(source, {
      run: async ({ outPath }) => {
        calls++;
        await writeFile(outPath, RECORDED);
      },
    });
    expect(calls).toBe(1);
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

  // 2026-10-16: stripped, an empty `terms` came back and was refused as a raw
  // zod path, twice in a row, on Chinchilla. Codex enforces both live.
  it("keeps array bounds, so the model cannot send an empty `terms`", () => {
    const json = JSON.stringify(SCHEMA);
    expect(json).toMatch(/"terms":\{[^{}]*"minItems":1,"maxItems":4/);
    expect(json).toContain('"minItems":2');
  });

  it("makes a formerly-optional field nullable rather than dropping it", () => {
    const title = (SCHEMA as { properties: Record<string, { anyOf?: unknown[] }> }).properties
      .theme;
    expect(JSON.stringify(title)).toContain('"null"');
  });

  it("hides picture briefs when images are off, and only then", () => {
    const off = JSON.stringify(schemaFor(prefsSchema.parse({})));
    const on = JSON.stringify(schemaFor(prefsSchema.parse({ images: { enabled: true } })));
    expect(off).not.toMatch(/"(illustration|backdrop)"/);
    expect(on).toMatch(/"illustration"/);
    expect(on).toMatch(/"backdrop"/);
    // With the brief gone a figure archetype's id is its only picture, so it
    // cannot be declined with null (claim-figure and stage, 2026-10-14).
    const nullableIds = (s: string) =>
      (s.match(/"figureId":\{"anyOf":\[\{"type":"string"\},\{"type":"null"\}\]\}/g) ?? []).length;
    expect(nullableIds(off)).toBe(0);
    expect(nullableIds(on)).toBeGreaterThanOrEqual(2);
  });

  // 2026-10-16: inlined into all sixteen archetypes the schema was 327 KB, and
  // from that day every deck ask carrying it failed on max_output_tokens.
  it("carries the literal scene once, in $defs, and every archetype refers to it", () => {
    const schema = schemaFor(prefsSchema.parse({ design: "v2" })) as {
      $defs: { literal: unknown };
      properties: { beats: { items: { anyOf: Array<{ properties: { literal: unknown } }> } } };
    };
    expect(schema.$defs.literal).toBeDefined();
    const variants = schema.properties.beats.items.anyOf;
    expect(variants).toHaveLength(16);
    for (const v of variants) expect(v.properties.literal).toEqual({ $ref: "#/$defs/literal" });
    expect(JSON.stringify(schema).length).toBeLessThan(100_000);
  });

  it("offers operate as a formula with terms, or as a chain, never neither", () => {
    const variants: Array<{ properties: Record<string, unknown> }> = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) {
        n.forEach(walk);
        return;
      }
      if (!n || typeof n !== "object") return;
      const p = (n as { properties?: { kind?: { const?: string } } }).properties;
      if (p?.kind?.const === "operate") variants.push(n as (typeof variants)[number]);
      Object.values(n).forEach(walk);
    };
    // `literal` is offered only to a deck that draws scenes: v2.
    walk(schemaFor(prefsSchema.parse({ design: "v2" })));
    // One pair: the literal is offered once, in `$defs`, and referenced per archetype.
    const formulas = variants.filter((v) => "terms" in v.properties);
    const chains = variants.filter((v) => "chain" in v.properties);
    expect(formulas).toHaveLength(1);
    expect(formulas.length + chains.length).toBe(variants.length);
    expect(chains).toHaveLength(formulas.length);
    for (const formula of formulas) {
      // The formula's three fields are required, not nullable; no chain beside them.
      for (const k of ["equation", "given", "terms"])
        expect((formula.properties[k] as { anyOf?: unknown }).anyOf).toBeUndefined();
      expect(formula.properties).not.toHaveProperty("chain");
    }
    for (const chain of chains) expect(chain.properties).not.toHaveProperty("equation");
    // Absent keys parse back to zod's defaults: the storyboard schema is unchanged.
    expect(
      literalSchema.parse({
        kind: "operate",
        equation: "x",
        given: [],
        terms: { term: "a", from: 0, to: "1", combine: "sum" },
      }).kind,
    ).toBe("operate");
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
    // Briefs are offered only when pictures can be drawn: images on.
    const params = find(schemaFor(prefsSchema.parse({ images: { enabled: true } })))?.properties
      ?.params;
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
    expect((planned?.params as { eyebrow?: string } | undefined)?.eyebrow).toBeUndefined();
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

  it("offers a stage with exactly the placements the emitter has a scrim for", () => {
    expect(json).toContain('"stage"');
    expect(json).toContain('["none","bottom-left","center","top-left","right"]');
  });
});
