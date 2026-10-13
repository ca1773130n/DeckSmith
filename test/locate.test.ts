/**
 * `locateMarks` (src/plan/locate.ts): a region's things found in ITS panel by a
 * runner shown that panel, the boxes written into the storyboard, an empty reply
 * asked again, and a second miss refused naming the beat. The runner is fake;
 * the figure is decoded through ffmpeg as the build decodes it.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodePng } from "../src/bespoke/inspect.js";
import type { RunnerArgs } from "../src/plan/codex.js";
import { locateMarks, readBoxes, readSteps, transcribeTraces } from "../src/plan/locate.js";
import { sourceSchema, storyboardSchema } from "../src/types.js";

describe("readBoxes", () => {
  it("takes one box per thing, clamps a hair past the edge, refuses the rest", () => {
    const m = (x: number, y: number, w: number, h: number) => ({ thing: "t", x, y, w, h });
    expect(readBoxes({ marks: [m(0.1, 0.2, 0.3, 0.4)] }, 1)).toEqual([
      { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
    ]);
    expect(readBoxes({ marks: [m(-0.01, 0.5, 0.2, 0.505)] }, 1)).toEqual([
      { x: 0, y: 0.5, w: 0.19, h: 0.5 },
    ]);
    expect(readBoxes({ marks: [] }, 2)).toBe("0 boxes for 2 things");
    expect(readBoxes({}, 1)).toBe("no boxes for 1 things");
    expect(readBoxes({ marks: [m(0.5, 0.5, 0.6, 0.1)] }, 1)).toMatch(/outside the picture/);
    expect(readBoxes({ marks: [m(0.5, 0.5, 0, 0.1)] }, 1)).toMatch(/has no box/);
  });
});

describe("locateMarks", () => {
  let dir = "";
  // Two dark panels side by side on white, 120×80 each, under one title band.
  const W = 300;
  const H = 140;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "decksmith-locate-test-"));
    const px = new Uint8Array(W * H * 3).fill(255);
    const paint = (x0: number, y0: number, w: number, h: number, v: number) => {
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) px.fill(v, (y * W + x) * 3, (y * W + x) * 3 + 3);
    };
    paint(10, 10, 280, 12, 200);
    paint(10, 40, 120, 80, 60);
    paint(170, 40, 120, 80, 90);
    await writeFile(
      join(dir, "fig1.png"),
      encodePng({ width: W, height: H, channels: 3, pixels: px }),
    );
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const source = sourceSchema.parse({
    id: "s",
    title: "t",
    sections: [{ id: "sec1", depth: 1, heading: "h", text: "x" }],
    figures: [{ id: "fig1", src: "fig1.png", caption: "Figure 1", width: W, height: H }],
    equations: [],
    tables: [],
  });
  const board = storyboardSchema.parse({
    sourceId: "s",
    title: "t",
    beats: [
      {
        id: "b01",
        intent: "what the model weighed",
        archetype: "stage",
        params: { headline: "h", placement: "center", figureId: "fig1" },
        literal: {
          kind: "region",
          picture: "b01",
          panel: 2,
          marks: [
            // The planner's guess is replaced.
            { thing: "the sign", text: "sign", box: { x: 0, y: 0, w: 1, h: 1 } },
            { thing: "the barrel", text: "barrel" },
          ],
        },
      },
    ],
  });

  it("shows the runner the panel, asks again after an empty reply, and writes its boxes", async () => {
    const calls: RunnerArgs[] = [];
    const sizes: string[] = [];
    const run = async (a: RunnerArgs) => {
      calls.push(a);
      const png = await readFile(a.images?.[0] as string);
      sizes.push(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
      const marks =
        calls.length === 1
          ? []
          : [
              { thing: "the sign", x: 0.1, y: 0.2, w: 0.1, h: 0.2 },
              { thing: "the barrel", x: 0.5, y: 0.5, w: 0.2, h: 0.1 },
            ];
      await writeFile(a.outPath, JSON.stringify({ marks }));
    };
    const out = await locateMarks(board, source, dir, { run });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.prompt).toMatch(/1\. the sign\n2\. the barrel/);
    // The second panel alone, the title band dropped: what the build will show.
    expect(sizes).toEqual(["120x80", "120x80"]);
    const lit = out.beats[0]?.literal;
    expect(lit?.kind === "region" && lit.marks.map((m) => m.box)).toEqual([
      { x: 0.1, y: 0.2, w: 0.1, h: 0.2 },
      { x: 0.5, y: 0.5, w: 0.2, h: 0.1 },
    ]);
  });

  it("refuses, naming the beat, when the things are not found twice", async () => {
    const run = async (a: RunnerArgs) => writeFile(a.outPath, JSON.stringify({ marks: [] }));
    await expect(locateMarks(board, source, dir, { run })).rejects.toThrow(
      /b01's things were not found in its picture twice over \(0 boxes for 2 things\)/,
    );
  });

  it("reads a figure trace's rows off its panel, the tags as the schema's choices", async () => {
    const traced = storyboardSchema.parse({
      ...board,
      beats: [
        {
          ...board.beats[0],
          literal: {
            kind: "evolve",
            rule: "trace",
            picture: "b01",
            panel: 1,
            read: "the drafts, row by row",
            tags: [
              { tag: "ok", label: "accepted", tone: "d" },
              { tag: "no", label: "rejected", tone: "c", strike: true },
            ],
          },
        },
      ],
    });
    const seen: string[] = [];
    const run = async (a: RunnerArgs) => {
      seen.push(a.prompt, JSON.stringify(JSON.parse(await readFile(a.schemaPath, "utf8"))));
      const steps = [
        {
          lead: "",
          parts: [
            { text: "the cat", tag: "ok" },
            { text: "sat", tag: "no" },
          ],
        },
        { lead: "… cat", parts: [{ text: "lay", tag: "ok" }] },
      ];
      await writeFile(a.outPath, JSON.stringify({ steps }));
    };
    const out = await transcribeTraces(traced, source, dir, { run });
    expect(seen[0]).toMatch(/Read off it: the drafts, row by row/);
    expect(seen[0]).toMatch(/- no: rejected/);
    expect(seen[1]).toContain('"enum":["ok","no"]');
    const lit = out.beats[0]?.literal;
    expect(lit?.kind === "evolve" && lit.steps).toEqual([
      {
        parts: [
          { text: "the cat", tag: "ok" },
          { text: "sat", tag: "no" },
        ],
      },
      { lead: "… cat", parts: [{ text: "lay", tag: "ok" }] },
    ]);
  });
});

describe("readSteps", () => {
  it("takes 2–24 rows of tagged parts, and refuses an unknown tag or an empty row", () => {
    const row = (tag = "ok", text = "a") => ({ lead: "", parts: [{ text, tag }] });
    expect(readSteps({ steps: [row(), row()] }, ["ok"])).toHaveLength(2);
    expect(readSteps({ steps: [row()] }, ["ok"])).toBe("1 rows (2–24)");
    expect(readSteps({ steps: [row(), row("x")] }, ["ok"])).toMatch(/row 2 tags "a" with "x"/);
    expect(readSteps({ steps: [row(), row("ok", " ")] }, ["ok"])).toMatch(/row 2 has no parts/);
  });
});
